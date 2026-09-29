#!/usr/bin/env node
// PostToolUse で、書き込んだ日本語を規律の規則で検査し、違反を {"decision":"block"} で差し戻す。
// 同じ違反(パス・規則 id・match の組)は 1 セッションで 1 回だけ差し戻す。
// どの失敗でも何も書かず exit 0 で終える。

import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { hasIgnoreMarker, isHtml, type Source } from "./lib/extract.js"
import {
  type Analyzer,
  findEditRanges,
  lint,
  overlaps,
  type Violation
} from "./lib/lint.js"
import { buildRules } from "./lib/rules.js"
import { loadAnalyzer } from "./morph-runtime.js"

const MAX_LISTED = 10
// 本文でファイル全体を置き換えるツール。ファイル全体を編集範囲とする
const WHOLE_FILE = /^(Write|mcp__.+__create_text_file)$/

type Input = Record<string, unknown>
type Range = { start: number; end: number }

function main(): void {
  if (process.env.AMATSUKA_NATIVE_JAPANESE_CHECK === "off") return
  const hook = JSON.parse(fs.readFileSync(0, "utf8")) as Input | null
  const input = hook?.tool_input as Input | null | undefined
  if (typeof input !== "object" || input === null) return

  // パスと本文の集め方は設計書のセクション 7-2 の順。edits[] の各要素は別の本文にする
  const given = [
    input.file_path,
    input.notebook_path,
    input.relative_path
  ].find((v): v is string => typeof v === "string" && v !== "")
  const raw: unknown[] = [
    input.content,
    input.new_string,
    input.new_source,
    input.body,
    input.repl
  ]
  if (Array.isArray(input.edits))
    for (const e of input.edits) raw.push((e as Input | null)?.new_string)
  const bodies = raw.filter(
    (b): b is string => typeof b === "string" && b !== ""
  )
  if (given === undefined || bodies.length === 0) return

  const cwd = typeof hook?.cwd === "string" ? hook.cwd : process.cwd()
  const file = path.resolve(cwd, given)
  // ディレクトリへの replace_in_files は対象を列挙できず、目印の判定もできないので検査しない
  if (fs.statSync(file).isDirectory()) return
  const cellType =
    input.cell_type === "markdown" || input.cell_type === "code"
      ? input.cell_type
      : input.notebook_path !== undefined
        ? cellTypeOf(file, input.cell_id)
        : undefined
  // ノートのファイルは JSON なので本文をそのまま探せない。書いたセルを書き込み後の全体とみなす
  const wholeText =
    input.notebook_path !== undefined
      ? (bodies[0] as string)
      : fs.readFileSync(file, "utf8")
  const whole: Source = { path: file, text: wholeText, cellType }
  if (hasIgnoreMarker(whole)) return

  // 実行のたびに読み、規則を組み立て直す(キャッシュしない)
  const rules = buildRules(
    fs.readFileSync(
      new URL("../references/discipline.md", import.meta.url),
      "utf8"
    )
  )
  const analyzer: Analyzer | null =
    process.env.AMATSUKA_NATIVE_JAPANESE_MORPH === "off"
      ? null
      : loadAnalyzer(process.env.CLAUDE_PLUGIN_DATA)

  const perBody: (Range | null)[] =
    WHOLE_FILE.test(String(hook?.tool_name)) ||
    input.notebook_path !== undefined
      ? bodies.map(() => ({ start: 1, end: wholeText.split("\n").length }))
      : findEditRanges(wholeText, bodies)
  const ranges = perBody.filter((r): r is Range => r !== null)

  // 形態素解析の層は書き込み後のファイル全体のブロックに当て、編集範囲と重なる違反だけを残す。
  // 解析で例外が起きたら、読み込みの失敗と同じく正規表現の層の結果だけで続ける(設計書のセクション 7-4)
  let morphFound: Violation[] = []
  if (analyzer) {
    try {
      morphFound = lint(whole, { rules: [], analyzer }).filter((v) =>
        overlaps(v, ranges)
      )
    } catch {}
  }

  let found: Violation[]
  if (isHtml(file)) {
    // HTML は正規表現の層も書き込み後のファイル全体のブロックに当て、編集範囲と重なる違反だけを残す
    found = lint(whole, { rules }).filter((v) => overlaps(v, ranges))
  } else {
    // 正規表現の層は今回の本文にだけ当て、ファイルに元からある違反を差し戻さない。
    // 行番号は、本文が見つかればファイルの中の位置に直す
    found = bodies.flatMap((text, i) => {
      const shift = (perBody[i]?.start ?? 1) - 1
      return lint({ path: file, text, cellType }, { rules }).map((v) => ({
        ...v,
        line: v.line + shift,
        endLine: v.endLine + shift
      }))
    })
  }
  found.push(...morphFound)
  if (found.length === 0) return

  const fresh = unrecorded(hook?.session_id, file, found)
  if (fresh.length === 0) return
  fresh.sort((a, b) => a.line - b.line)
  const listed = fresh
    .slice(0, MAX_LISTED)
    .map((v) => `- L${v.line}: 「${v.match}」(${v.category})→ ${v.advice}`)
  if (fresh.length > MAX_LISTED)
    listed.push(`- ほか ${fresh.length - MAX_LISTED} 件`)
  const reason = [
    `[native-japanese] ${file} に書いた日本語に、書き方の規律の違反が ${fresh.length} 件ある。該当箇所を書き直す。`,
    ...listed,
    "引用・固有名詞・識別子・コード例として意図して書いた箇所と、検査の誤りと判断した箇所は、直さずに残してよい。直すときは、否定・条件・確信度を元の文のまま保つ。"
  ].join("\n")
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`)
}

// NotebookEdit の replace は cell_type を省けるので、書き込み後のノートから cell_id のセルの種類を取る。
// 取れなければ code とみなす
function cellTypeOf(file: string, cellId: unknown): "markdown" | "code" {
  try {
    const nb = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cells?: { id?: unknown; cell_type?: unknown }[]
    }
    const cell =
      typeof cellId === "string"
        ? nb.cells?.find((c) => c.id === cellId)
        : undefined
    return cell?.cell_type === "markdown" ? "markdown" : "code"
  } catch {
    return "code"
  }
}

// 記録に無い違反だけを返し、記録に加える。記録の読み書きに失敗したら記録なしとして扱う
function unrecorded(
  sessionId: unknown,
  file: string,
  found: Violation[]
): Violation[] {
  const key = (v: Violation) => JSON.stringify([file, v.ruleId, v.match])
  // session_id をファイル名に使うので、パスを作れる字を含むものは記録しない
  if (typeof sessionId !== "string" || !/^[\w.-]+$/.test(sessionId))
    return found
  const dir = path.join(os.tmpdir(), "native-japanese")
  const record = path.join(dir, `${sessionId}.json`)
  let seen = new Set<string>()
  try {
    const keys = JSON.parse(fs.readFileSync(record, "utf8")) as unknown
    if (Array.isArray(keys)) seen = new Set(keys.map(String))
  } catch {}
  const fresh = found.filter((v) => !seen.has(key(v)))
  if (fresh.length === 0) return fresh
  try {
    for (const v of fresh) seen.add(key(v))
    fs.mkdirSync(dir, { recursive: true })
    // 並行する書き込みで壊れないよう、一時ファイルに書いてから rename で置き換える
    const tmp = path.join(dir, `.${sessionId}.${randomUUID()}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify([...seen]))
    fs.renameSync(tmp, record)
  } catch {}
  return fresh
}

// stdout を書き切らせるため process.exit は呼ばず、例外だけを握りつぶして終える
try {
  main()
} catch {}
