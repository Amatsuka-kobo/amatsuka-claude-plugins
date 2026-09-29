#!/usr/bin/env node
// 測定 CLI。git の差分か Claude Code の会話記録(jsonl)から、書かれた日本語の違反を数える。
// 使い方: measure.mjs (--git <range> | --transcripts <dir> [--since YYYY-MM-DD])
//   [--data-dir <dir>] [--format json|text]

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  extractBlocks,
  extractLines,
  hasIgnoreMarker,
  isHtml,
  type Source
} from "./lib/extract.js"
import { type Analyzer, lint, overlaps, type Violation } from "./lib/lint.js"
import { sentenceLines } from "./lib/morph.js"
import { buildRules, type Rule } from "./lib/rules.js"
import { loadAnalyzer } from "./morph-runtime.js"

// 集計の単位。違反の例に出すため、違反にパスを添える
type Found = Violation & { path: string }
interface Tally {
  lines: number
  sentences: number
  found: Found[]
}
type Range = { start: number; end: number }

// 形態素解析の層にかけた文を数える。ranges を渡したときは、その範囲と重なる文だけを数える
function countSentences(src: Source, ranges?: Range[]): number {
  return sentenceLines(extractBlocks(src)).filter(
    (s) =>
      !ranges || ranges.some((r) => s.line <= r.end && r.start <= s.endLine)
  ).length
}

const USAGE =
  "使い方: measure.mjs (--git <range> | --transcripts <dir> [--since YYYY-MM-DD]) [--data-dir <dir>] [--format json|text]"

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`)
  process.exit(2)
}

// --- --git ---

type Added = { path: string; hunks: { start: number; lines: string[] }[] }

// git diff -U0 の出力から、ファイルごとに加わった行を連続する塊で取り出す。削除されたファイルは返さない
function parseDiff(diff: string): Added[] {
  const files: Added[] = []
  let cur: Added | null = null
  let inHeader = false
  let hunk: { start: number; lines: string[] } | null = null
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      cur = null
      hunk = null
      inHeader = true
    } else if (inHeader && l.startsWith("+++ ")) {
      const p = l.slice(4)
      if (p.startsWith("b/")) {
        cur = { path: p.slice(2), hunks: [] }
        files.push(cur)
      }
    } else if (l.startsWith("@@ ")) {
      inHeader = false
      const m = /^@@ -\S+ \+(\d+)/.exec(l)
      hunk = cur && m ? { start: Number(m[1]), lines: [] } : null
      if (hunk) cur?.hunks.push(hunk)
    } else if (!inHeader && hunk && l.startsWith("+")) {
      hunk.lines.push(l.slice(1))
    }
  }
  return files
}

function measureGit(
  range: string,
  rules: Rule[],
  analyzer: Analyzer | null
): Tally {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"]
    })
  const diff = git(
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    range
  )
  // 範囲の終点。a..b と a...b は b(空なら HEAD)、コミット 1 つだけなら作業ツリーを読む
  const dots = /\.\.\.?/.exec(range)
  const end = dots ? range.slice(dots.index + dots[0].length) || "HEAD" : null
  const top = git("rev-parse", "--show-toplevel").trim()
  const tally: Tally = { lines: 0, sentences: 0, found: [] }
  for (const file of parseDiff(diff)) {
    let text: string
    try {
      text =
        end === null
          ? fs.readFileSync(path.join(top, file.path), "utf8")
          : git("show", `${end}:${file.path}`)
    } catch {
      continue
    }
    const whole: Source = { path: file.path, text }
    // 先頭に目印を持つファイルは、違反だけでなく行数にも入れない
    if (hasIgnoreMarker(whole)) continue
    const ranges: Range[] = file.hunks
      .filter((h) => h.lines.length > 0)
      .map((h) => ({ start: h.start, end: h.start + h.lines.length - 1 }))
    if (isHtml(file.path)) {
      // HTML は変更後のファイル全体からブロックを取り出し、加わった行と重なるものだけを数える
      const seen = new Set<number>()
      for (const b of extractBlocks(whole))
        for (const n of b.lineOf)
          if (ranges.some((r) => r.start <= n && n <= r.end)) seen.add(n)
      tally.lines += seen.size
      if (analyzer) tally.sentences += countSentences(whole, ranges)
      for (const v of lint(whole, { rules, analyzer }))
        if (overlaps(v, ranges)) tally.found.push({ ...v, path: file.path })
      continue
    }
    // 形態素解析の層は変更後のファイル全体から段落を組み、加わった行と重なる違反だけを数える
    if (analyzer) {
      tally.sentences += countSentences(whole, ranges)
      for (const v of lint(whole, { rules: [], analyzer }))
        if (overlaps(v, ranges)) tally.found.push({ ...v, path: file.path })
    }
    for (const h of file.hunks) {
      const frag: Source = { path: file.path, text: h.lines.join("\n") }
      tally.lines += extractLines(frag).length
      for (const v of lint(frag, { rules }))
        tally.found.push({
          ...v,
          path: file.path,
          line: v.line + h.start - 1,
          endLine: v.endLine + h.start - 1
        })
    }
  }
  return tally
}

// --- --transcripts ---

// 設計書のセクション 7-1 の matcher と同じ
const TOOL =
  /^(Write|Edit|MultiEdit|NotebookEdit|mcp__.+__(replace_content|replace_symbol_body|insert_after_symbol|insert_before_symbol|replace_in_files|create_text_file|replace_lines|insert_at_line))$/

type Input = Record<string, unknown>

// 設計書のセクション 7-2 の順にパスを探し、本文を集める。edits[] の各要素は別の本文にする
function sourcesOf(input: Input): Source[] {
  const p = [input.file_path, input.notebook_path, input.relative_path].find(
    (v): v is string => typeof v === "string" && v !== ""
  )
  if (p === undefined) return []
  const bodies: unknown[] = [
    input.content,
    input.new_string,
    input.new_source,
    input.body,
    input.repl
  ]
  if (Array.isArray(input.edits))
    for (const e of input.edits) bodies.push((e as Input | null)?.new_string)
  const cellType =
    input.cell_type === "markdown" || input.cell_type === "code"
      ? input.cell_type
      : undefined
  return bodies
    .filter((b): b is string => typeof b === "string" && b !== "")
    .map((text) => ({ path: p, text, cellType }))
}

function writerOf(file: string): string {
  const m = /^agent-(.+)\.jsonl$/.exec(path.basename(file))
  if (!m || path.basename(path.dirname(file)) !== "subagents") return "main"
  try {
    const meta = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(file), `agent-${m[1]}.meta.json`),
        "utf8"
      )
    ) as { agentType?: unknown }
    if (typeof meta.agentType === "string") return meta.agentType
  } catch {}
  return "unknown"
}

function measureTranscripts(
  dir: string,
  since: string | undefined,
  rules: Rule[],
  analyzer: Analyzer | null
): Map<string, Tally> {
  const byWriter = new Map<string, Tally>()
  const files = (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
  for (const rel of files) {
    const file = path.join(dir, rel)
    const writer = writerOf(file)
    const tally = byWriter.get(writer) ?? { lines: 0, sentences: 0, found: [] }
    byWriter.set(writer, tally)
    for (const l of fs.readFileSync(file, "utf8").split("\n")) {
      let rec: {
        type?: unknown
        timestamp?: unknown
        message?: { content?: unknown }
      }
      try {
        rec = JSON.parse(l)
      } catch {
        continue
      }
      if (rec?.type !== "assistant") continue
      // timestamp は UTC の ISO 形式なので、先頭の日付を文字列で比べる
      if (
        since !== undefined &&
        !(
          typeof rec.timestamp === "string" &&
          rec.timestamp.slice(0, 10) >= since
        )
      )
        continue
      const content = rec.message?.content
      if (!Array.isArray(content)) continue
      for (const c of content as Input[]) {
        if (c?.type !== "tool_use" || typeof c.name !== "string") continue
        if (!TOOL.test(c.name) || typeof c.input !== "object" || !c.input)
          continue
        for (const src of sourcesOf(c.input as Input)) {
          if (hasIgnoreMarker(src)) continue
          // 書き込み後のファイルが無いので、どちらの層も本文そのものに当て、全体を編集範囲とする
          tally.lines += isHtml(src.path)
            ? new Set(extractBlocks(src).flatMap((b) => b.lineOf)).size
            : extractLines(src).length
          if (analyzer) tally.sentences += countSentences(src)
          for (const v of lint(src, { rules, analyzer }))
            tally.found.push({ ...v, path: src.path })
        }
      }
    }
  }
  return byWriter
}

// --- 出力 ---

type Morph = { used: boolean; reason?: string }

// --data-dir を渡されたら、AMATSUKA_NATIVE_JAPANESE_MORPH を見ずに使う(設計書のセクション 5-5)。
// 省略時は CLAUDE_PLUGIN_DATA を使い、こちらは hook と同じく off なら使わない
function openAnalyzer(dataDir: string | undefined): {
  analyzer: Analyzer | null
  morph: Morph
} {
  let dir = dataDir
  if (dir === undefined) {
    if (process.env.AMATSUKA_NATIVE_JAPANESE_MORPH === "off")
      return {
        analyzer: null,
        morph: { used: false, reason: "AMATSUKA_NATIVE_JAPANESE_MORPH=off" }
      }
    dir = process.env.CLAUDE_PLUGIN_DATA
    if (!dir)
      return {
        analyzer: null,
        morph: {
          used: false,
          reason: "--data-dir も CLAUDE_PLUGIN_DATA も指定されていない"
        }
      }
  }
  const analyzer = loadAnalyzer(dir)
  return analyzer
    ? { analyzer, morph: { used: true } }
    : {
        analyzer: null,
        morph: {
          used: false,
          reason: `${dir} に取得物が無いか、読み込みに失敗した`
        }
      }
}

function report(
  tally: Tally,
  rules: Rule[],
  byWriter: Map<string, Tally> | null,
  morph: Morph
) {
  const regexIds = new Set(rules.map((r) => r.id))
  const counts = new Map<string, number>()
  const examples: Record<string, Found[]> = {}
  for (const v of tally.found) {
    counts.set(v.ruleId, (counts.get(v.ruleId) ?? 0) + 1)
    const ex = examples[v.ruleId] ?? []
    examples[v.ruleId] = ex
    if (ex.length < 3) ex.push(v)
  }
  const violations = tally.found.length
  return {
    morph,
    lines: tally.lines,
    sentences: tally.sentences,
    violations,
    per100Lines:
      tally.lines === 0
        ? 0
        : Math.round((violations / tally.lines) * 100 * 100) / 100,
    // 多い順。同数なら id の順
    byRule: [...counts]
      .map(([ruleId, count]) => ({
        ruleId,
        layer: (regexIds.has(ruleId) ? "regex" : "morph") as "regex" | "morph",
        count
      }))
      .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId)),
    ...(byWriter && {
      // main を先に、残りは書き手の名前の順に並べる
      byWriter: [...byWriter]
        .sort(([a], [b]) =>
          a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)
        )
        .map(([writer, t]) => ({
          writer,
          lines: t.lines,
          violations: t.found.length
        }))
    }),
    examples
  }
}

function toText(r: ReturnType<typeof report>): string {
  const out = [
    `形態素解析: ${r.morph.used ? "使った" : `使っていない(${r.morph.reason ?? "理由不明"})`}`,
    `検査した行: ${r.lines}  文: ${r.sentences}  違反: ${r.violations}  100 行あたり: ${r.per100Lines}`
  ]
  // 正規表現の層と形態素解析の層を分けて並べる
  for (const layer of ["regex", "morph"] as const) {
    const rows = r.byRule.filter((b) => b.layer === layer)
    if (rows.length === 0) continue
    out.push(
      "",
      `規則ごとの違反(${layer === "regex" ? "正規表現" : "形態素解析"}の層):`
    )
    for (const b of rows) out.push(`  ${b.count}\t${b.ruleId}`)
  }
  if (r.byWriter) {
    out.push("", "書き手ごと:")
    for (const w of r.byWriter)
      out.push(`  ${w.writer}\t${w.lines} 行\t${w.violations} 件`)
  }
  out.push("", "違反の例:")
  for (const [id, vs] of Object.entries(r.examples)) {
    out.push(`  ${id}`)
    for (const v of vs)
      out.push(`    ${v.path}:${v.line} 「${v.match}」 ${v.text.trim()}`)
  }
  return `${out.join("\n")}\n`
}

// --- 入口 ---

let values: {
  git?: string
  transcripts?: string
  since?: string
  "data-dir"?: string
  format?: string
}
try {
  ;({ values } = parseArgs({
    options: {
      git: { type: "string" },
      transcripts: { type: "string" },
      since: { type: "string" },
      "data-dir": { type: "string" },
      format: { type: "string", default: "text" }
    }
  }))
} catch (e) {
  fail((e as Error).message)
}
if ((values.git === undefined) === (values.transcripts === undefined))
  fail("--git と --transcripts のどちらか 1 つを指定する")
if (values.format !== "json" && values.format !== "text")
  fail("--format は json か text")
if (values.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.since))
  fail("--since は YYYY-MM-DD")
if (values.since !== undefined && values.transcripts === undefined)
  fail("--since は --transcripts と一緒に使う")

// 実行のたびに読み、規則を組み立て直す(キャッシュしない)
const rules = buildRules(
  fs.readFileSync(
    new URL("../references/discipline.md", import.meta.url),
    "utf8"
  )
)

const { analyzer, morph } = openAnalyzer(values["data-dir"])

let result: ReturnType<typeof report>
try {
  if (values.git !== undefined) {
    result = report(measureGit(values.git, rules, analyzer), rules, null, morph)
  } else {
    const byWriter = measureTranscripts(
      values.transcripts as string,
      values.since,
      rules,
      analyzer
    )
    const all: Tally = { lines: 0, sentences: 0, found: [] }
    for (const t of byWriter.values()) {
      all.lines += t.lines
      all.sentences += t.sentences
      all.found.push(...t.found)
    }
    result = report(all, rules, byWriter, morph)
  }
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`)
  process.exit(1)
}

process.stdout.write(
  values.format === "json" ? `${JSON.stringify(result)}\n` : toText(result)
)
