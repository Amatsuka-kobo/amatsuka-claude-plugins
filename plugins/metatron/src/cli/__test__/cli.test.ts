// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §12(CLI の入出力規約)の検証。
// ケース ID は metatron 設計書 §13-1 の `scan.ts` / CLI 統合の表(S5・S6)に対応する。
//
// - S5: 全読み取り系サブコマンドが、どんな異常環境でも exit 0 かつ妥当な JSON を出力する。
// - S6: 書き込み系の拒否時に、非 0 終了・stdout は妥当な JSON・対象ファイルがバイト単位で不変。
//
// 加えて stage → commit の正常系を CLI 経由で通しで検証する。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, expect, test } from "vitest"
import { findSection, parseArchitecture } from "../../lib/architecture.js"
import { lockPathFor } from "../../lib/file-lock.js"
import { computeRecordHash, stagingDirFor } from "../../lib/staging.js"
import { runTs } from "../../testing/run-ts.js"
import { MAX_DIFF_LINES } from "../diff.js"
import { READ_SUBCOMMANDS, WRITE_SUBCOMMANDS } from "../main.js"
import { USAGE_LINES } from "../paths.js"

const CLI = fileURLToPath(new URL("../../metatron-cli.ts", import.meta.url))

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    for (const target of [stagingDirFor(dir), dir]) {
      try {
        fs.rmSync(target, { recursive: true, force: true })
      } catch {
        // 後始末の失敗はテスト結果に影響させない
      }
    }
  }
})

function mkTmp(): string {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-cli-"))
  const dir = fs.realpathSync(raw)
  tmpDirs.push(dir)
  return dir
}

function writeFile(root: string, relative: string, body: string): string {
  const abs = path.join(root, relative)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
  return abs
}

interface CliRun {
  status: number
  stdout: string
  json: Record<string, unknown> | null
}

// execFileSync は非 0 終了で例外を投げる。CLI の契約は「非 0 でも stdout に JSON」なので、
// 例外に載ってくる stdout / status を取り出して同じ形で返す。
function runCli(args: string[], cwd: string): CliRun {
  let status = 0
  let stdout = ""
  try {
    stdout = runTs(CLI, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8"
    })
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    status = typeof failure.status === "number" ? failure.status : -1
    stdout = String(failure.stdout ?? "")
  }
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status, stdout, json }
}

function snapshot(files: string[]): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>()
  for (const file of files) {
    try {
      out.set(file, fs.readFileSync(file))
    } catch {
      out.set(file, null)
    }
  }
  return out
}

function expectUnchanged(before: Map<string, Buffer | null>): void {
  for (const [file, buf] of before) {
    let now: Buffer | null
    try {
      now = fs.readFileSync(file)
    } catch {
      now = null
    }
    if (buf === null) {
      expect(now, `${file} が新規作成されている`).toBeNull()
      continue
    }
    expect(now, `${file} が消えている`).not.toBeNull()
    expect(
      (now as Buffer).equals(buf),
      `${file} がバイト単位で変化している`
    ).toBe(true)
  }
}

// ---------------------------------------------------------------------------
// フィクスチャ
// ---------------------------------------------------------------------------

const ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "## システム概要",
  "",
  "概要です。",
  "",
  "```mermaid",
  "graph TD",
  "  A[App] --> B[API]",
  "```",
  "",
  "## 技術スタック",
  "",
  "- TypeScript",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  "{",
  '  "frontend": ["src/app/**"]',
  "}",
  "```",
  "",
  "## 規約",
  "",
  "規約です。",
  ""
].join("\n")

// 契約 §4-2 規則 5: ファイル終端に達してもフェンスが閉じていない。
const ARCHITECTURE_UNCLOSED = [
  "# ARCHITECTURE",
  "",
  "## システム概要",
  "",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "",
  "## 規約",
  "",
  "規約です。",
  ""
].join("\n")

/** 設定と ARCHITECTURE を持つ一時プロジェクト。docRoot はこのディレクトリに固定される。 */
function project(): string {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)
  return root
}

function docs(root: string): { architecture: string } {
  return {
    architecture: path.join(root, "docs", "ARCHITECTURE.md")
  }
}

// ---------------------------------------------------------------------------
// S5: 読み取り系は、どんな異常環境でも exit 0 かつ妥当な JSON
// ---------------------------------------------------------------------------

const READ_INVOCATIONS: string[][] = [
  ["get", "config"],
  ["get", "architecture"],
  ["get", "architecture", "--section", "システム概要"],
  ["get", "domains"],
  ["scan"],
  ["diff-architecture"]
]

test("SC1: 全サブコマンドが usage に掲載されている", () => {
  const usage = USAGE_LINES.join("\n")
  for (const subcommand of [...READ_SUBCOMMANDS, ...WRITE_SUBCOMMANDS]) {
    expect(usage, `${subcommand} が usage に無い`).toContain(subcommand)
  }
})

test("SC2: 全書き込み系サブコマンドが cli-usage.md に掲載されている", () => {
  const reference = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "references",
      "cli-usage.md"
    ),
    "utf8"
  )
  for (const subcommand of WRITE_SUBCOMMANDS) {
    expect(reference, `${subcommand} が cli-usage.md に無い`).toContain(
      subcommand
    )
  }
})

function expectAllReadsSucceed(root: string, label: string): void {
  for (const args of READ_INVOCATIONS) {
    const run = runCli(args, root)
    const where = `${label}: ${args.join(" ")}`
    expect(run.status, `${where} が非 0 終了した`).toBe(0)
    expect(run.json, `${where} の stdout が JSON ではない`).not.toBeNull()
    const json = run.json as Record<string, unknown>
    expect(typeof json.command, `${where} に command が無い`).toBe("string")
    expect(typeof json.ok, `${where} に ok が無い`).toBe("boolean")
  }
}

test("S5: 空ディレクトリでも読み取り系は exit 0 で JSON を返す", () => {
  expectAllReadsSucceed(mkTmp(), "空ディレクトリ")
})

test("S5: ARCHITECTURE が無い環境でも読み取り系は exit 0", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "sample", scripts: { test: "vitest" } })
  )
  fs.mkdirSync(path.join(root, "src", "app"), { recursive: true })
  expectAllReadsSucceed(root, "文書なし")
})

test("S5: 壊れた設定ファイルでも読み取り系は exit 0(既定値へ落ちる)", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{ これは JSON ではない")
  writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)
  expectAllReadsSucceed(root, "壊れた設定")

  const run = runCli(["get", "config"], root)
  const json = run.json as Record<string, unknown>
  expect(json.ok).toBe(true)
  expect((json.warnings as string[]).length).toBeGreaterThan(0)
  const architecture = json.architecture as Record<string, unknown>
  expect(architecture.relative).toBe("docs/ARCHITECTURE.md")
})

test("S5: 未閉フェンスの ARCHITECTURE でも読み取り系は exit 0(警告つきで継続)", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE_UNCLOSED)
  expectAllReadsSucceed(root, "未閉フェンス")

  const run = runCli(["get", "architecture"], root)
  const json = run.json as Record<string, unknown>
  expect(json.ok).toBe(true)
  expect((json.warnings as string[]).join("\n")).toContain("フェンス")
})

// ---------------------------------------------------------------------------
// S6: 書き込み系の拒否 — 非 0 終了・妥当な JSON・ファイルはバイト単位で不変
// ---------------------------------------------------------------------------

interface Rejection {
  name: string
  args: string[]
  /** 期待する `error` の値。 */
  error: string
  /** 入力 JSON を書き出す場合の中身。`--input` は自動で付ける。 */
  input?: unknown
  /** 既定の環境ではなく未閉フェンスの ARCHITECTURE を使う。 */
  unclosed?: boolean
  /** 期待する終了コード。既定は「非 0 であること」だけを見る。 */
  status?: number
}

const REJECTIONS: Rejection[] = [
  {
    name: "stage-architecture に ADR 一覧 の本文を渡す",
    args: ["stage-architecture"],
    input: { sections: [{ heading: "ADR 一覧", body: "### ADR-001: x" }] },
    error: "unknown_heading"
  },
  {
    name: "stage-architecture に廃止済みの overview キーを渡す",
    args: ["stage-architecture"],
    input: { sections: [{ heading: "overview", body: "概要" }] },
    error: "retired_overview_key"
  },
  {
    name: "stage-architecture に未知の見出しを渡す",
    args: ["stage-architecture"],
    input: { sections: [{ heading: "自作セクション", body: "本文" }] },
    error: "unknown_heading"
  },
  {
    name: "stage-architecture に壊れたドメインマップを渡す",
    args: ["stage-architecture"],
    input: {
      sections: [
        {
          heading: "ドメインマップ",
          body: '```json metatron:domains\n{ "frontend": }\n```'
        }
      ]
    },
    error: "invalid_domains"
  },
  {
    name: "未閉フェンスの ARCHITECTURE への stage-architecture",
    args: ["stage-architecture"],
    input: { sections: [{ heading: "技術スタック", body: "- 新しい依存" }] },
    error: "unclosed_fence",
    unclosed: true
  },
  {
    name: "stage-architecture に存在しない節の remove を渡す",
    args: ["stage-architecture"],
    input: { sections: [{ heading: "テスト方針", remove: true }] },
    error: "section_not_found"
  },
  {
    name: "stage-architecture に body と remove を同時に渡す",
    args: ["stage-architecture"],
    input: {
      sections: [{ heading: "システム概要", body: "本文", remove: true }]
    },
    error: "invalid_input"
  },
  {
    name: "commit-architecture に未知の stagingId",
    args: [
      "commit-architecture",
      "--staging-id",
      "00000000-0000-4000-8000-000000000000"
    ],
    error: "unknown_id"
  },
  {
    name: "commit-architecture に stagingId 無し",
    args: ["commit-architecture"],
    error: "missing_staging_id",
    status: 2
  }
]

test("S6: 書き込み系の拒否は非 0 終了・妥当な JSON・ファイル不変", () => {
  for (const [index, rejection] of REJECTIONS.entries()) {
    const root = mkTmp()
    writeFile(root, "metatron.config.json", "{}")
    writeFile(
      root,
      "docs/ARCHITECTURE.md",
      rejection.unclosed === true ? ARCHITECTURE_UNCLOSED : ARCHITECTURE
    )
    const { architecture } = docs(root)
    const before = snapshot([architecture])

    const args = [...rejection.args]
    if (rejection.input !== undefined) {
      const inputPath = writeFile(
        root,
        `input-${index}.json`,
        JSON.stringify(rejection.input)
      )
      args.push("--input", inputPath)
    }

    const run = runCli(args, root)
    expect(run.status, `${rejection.name}: exit 0 で通ってしまった`).not.toBe(0)
    if (rejection.status !== undefined) {
      expect(run.status, rejection.name).toBe(rejection.status)
    }
    expect(
      run.json,
      `${rejection.name}: stdout が JSON ではない`
    ).not.toBeNull()
    const json = run.json as Record<string, unknown>
    expect(json.ok, rejection.name).toBe(false)
    expect(json.error, rejection.name).toBe(rejection.error)
    expect(typeof json.message, rejection.name).toBe("string")
    if (args[0].startsWith("stage-")) {
      expect(json.stagingId ?? null, rejection.name).toBeNull()
    }
    expectUnchanged(before)
  }
})

// ---------------------------------------------------------------------------
// stage → commit の正常系(CLI 経由の通し)
// ---------------------------------------------------------------------------

test("stage-architecture → commit-architecture で対象セクションだけが差し替わる", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  const architecture = writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)
  const inputPath = writeFile(
    root,
    "stage.json",
    JSON.stringify({
      sections: [{ heading: "技術スタック", body: "- TypeScript\n- Node.js" }],
      reason: "依存の追加を反映"
    })
  )

  const beforeBuf = fs.readFileSync(architecture)
  const staged = runCli(["stage-architecture", "--input", inputPath], root)
  expect(staged.status).toBe(0)
  const stagedJson = staged.json as Record<string, unknown>
  expect(stagedJson.ok).toBe(true)
  expect(stagedJson.valid).toBe(true)
  expect(typeof stagedJson.stagingId).toBe("string")
  const diff = stagedJson.diff as Record<string, unknown>
  expect(diff.unified as string).toContain("+- Node.js")

  // stage は書き込まない。
  expect(fs.readFileSync(architecture).equals(beforeBuf)).toBe(true)

  const committed = runCli(
    ["commit-architecture", "--staging-id", stagedJson.stagingId as string],
    root
  )
  expect(committed.status).toBe(0)
  const committedJson = committed.json as Record<string, unknown>
  expect(committedJson.ok).toBe(true)
  expect(committedJson.written).toBe(true)
  expect(committedJson.path).toBe(architecture)

  const after = fs.readFileSync(architecture, "utf8")
  const beforeDoc = parseArchitecture(beforeBuf.toString("utf8"))
  const afterDoc = parseArchitecture(after)

  expect(findSection(afterDoc, "技術スタック")?.body).toContain("- Node.js")
  // 対象セクション以外はバイト単位で不変。
  expect(afterDoc.preamble).toBe(beforeDoc.preamble)
  for (const heading of ["システム概要", "ドメインマップ", "規約"]) {
    expect(
      findSection(afterDoc, heading)?.raw,
      `${heading} が変化している`
    ).toBe(findSection(beforeDoc, heading)?.raw)
  }

  // 単回使用: 同じ stagingId での再 commit は失敗する。
  const again = runCli(
    ["commit-architecture", "--staging-id", stagedJson.stagingId as string],
    root
  )
  expect(again.status).not.toBe(0)
  expect((again.json as Record<string, unknown>).error).toBe("already_used")
})

// ---------------------------------------------------------------------------
// 巨大な文書での diff の省略
//
// 上限を超えると `diff.unified` は案内文だけになる。呼び出し元が「提示できる差分が
// 返っていない」ことを機械的に判別できなければ、省略されたまま承認を求めてしまう。
// ---------------------------------------------------------------------------

function stackLines(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `- dep-${String(index).padStart(4, "0")}`
  )
}

function architectureWithStack(stack: readonly string[]): string {
  return [
    "# ARCHITECTURE",
    "",
    "## システム概要",
    "",
    "概要です。",
    "",
    "## 技術スタック",
    "",
    ...stack,
    "",
    "## 規約",
    "",
    "規約です。",
    ""
  ].join("\n")
}

// CLI の行数え(末尾の改行 1 個は行として数えない)に合わせる。
function lineCount(text: string): number {
  return text.replace(/\n$/, "").split("\n").length
}

function stageDiff(root: string, input: unknown): Record<string, unknown> {
  const inputPath = writeFile(root, "stage.json", JSON.stringify(input))
  const staged = runCli(["stage-architecture", "--input", inputPath], root)
  expect(staged.status, staged.stdout).toBe(0)
  const json = staged.json as Record<string, unknown>
  expect(json.ok).toBe(true)
  return json.diff as Record<string, unknown>
}

test("MAX_DIFF_LINES を超える文書では diff の省略が機械的に判別できる", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  const stack = stackLines(MAX_DIFF_LINES + 100)
  const before = architectureWithStack(stack)
  expect(lineCount(before)).toBeGreaterThan(MAX_DIFF_LINES)
  writeFile(root, "docs/ARCHITECTURE.md", before)

  const diff = stageDiff(root, {
    sections: [{ heading: "技術スタック", body: "- TypeScript\n- Node.js" }],
    reason: "依存の整理"
  })

  expect(diff.truncated, "省略されたことが出力から判別できない").toBe(true)
  expect(typeof diff.truncatedReason, "省略の理由が返っていない").toBe("string")
  expect(diff.beforeLines).toBe(lineCount(before))
  expect(diff.afterLines).toBeGreaterThan(0)
  expect(diff.maxLines).toBe(MAX_DIFF_LINES)
})

test("diff が省略されても sections には完全な before / after が残る", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  const stack = stackLines(MAX_DIFF_LINES + 100)
  writeFile(root, "docs/ARCHITECTURE.md", architectureWithStack(stack))

  const diff = stageDiff(root, {
    sections: [{ heading: "技術スタック", body: "- TypeScript\n- Node.js" }]
  })

  expect(diff.truncated).toBe(true)
  const sections = diff.sections as {
    heading: string
    before: string | null
    after: string | null
  }[]
  const section = sections.find((entry) => entry.heading === "技術スタック")
  expect(section, "対象セクションが sections に無い").toBeDefined()
  const body = section?.before ?? ""
  // 代替提示の材料になるのは全文だけ。先頭と末尾の両方が欠けていないことを見る。
  expect(body).toContain(stack[0])
  expect(body).toContain(stack[stack.length - 1])
  expect(lineCount(body)).toBeGreaterThanOrEqual(stack.length)
  expect(section?.after ?? "").toContain("- Node.js")
})

test("MAX_DIFF_LINES 以下なら省略されず unified がそのまま返る", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  const stack = stackLines(MAX_DIFF_LINES - 200)
  const before = architectureWithStack(stack)
  expect(lineCount(before)).toBeLessThanOrEqual(MAX_DIFF_LINES)
  writeFile(root, "docs/ARCHITECTURE.md", before)

  const diff = stageDiff(root, {
    sections: [
      { heading: "技術スタック", body: [...stack, "- dep-added"].join("\n") }
    ]
  })

  expect(diff.truncated, "省略していないのに truncated が立っている").toBe(
    false
  )
  expect(diff.truncatedReason).toBeNull()
  expect(diff.beforeLines).toBe(lineCount(before))
  expect(diff.unified as string).toContain("+- dep-added")
})

test("S9: 廃止した種別の staging は commit-architecture が受け付けず、対象ファイルは不変", () => {
  const root = project()
  const archPath = path.join(root, "docs", "ARCHITECTURE.md")
  const before = fs.readFileSync(archPath, "utf8")

  // 改修前の stage-adr が残した staging を模す。recordHash も打ち直し、改竄ではなく
  // 廃止した種別として unknown_id で拒否されることを確かめる。
  const archInput = writeFile(
    root,
    "a.json",
    JSON.stringify({
      sections: [{ heading: "システム概要", body: "新しい概要。" }]
    })
  )
  const staged = runCli(["stage-architecture", "--input", archInput], root)
  const stagingId = (staged.json as Record<string, unknown>).stagingId as string
  const recordPath = path.join(stagingDirFor(root), `${stagingId}.json`)
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"))
  const legacy = { ...record, kind: "adr" }
  legacy.recordHash = computeRecordHash(legacy)
  fs.writeFileSync(recordPath, JSON.stringify(legacy))

  const run = runCli(["commit-architecture", "--staging-id", stagingId], root)
  expect(run.status).toBe(1)
  expect(run.json).toMatchObject({ ok: false, error: "unknown_id" })
  expect(fs.readFileSync(archPath, "utf8")).toBe(before)
})

test("S12: ロックが取られている間、commit-architecture は lock_timeout で失敗し、書き換えない", () => {
  const root = project()
  const archPath = path.join(root, "docs", "ARCHITECTURE.md")
  const before = fs.readFileSync(archPath, "utf8")
  const input = writeFile(
    root,
    "a.json",
    JSON.stringify({
      sections: [{ heading: "システム概要", body: "新しい概要。" }]
    })
  )
  const staged = runCli(["stage-architecture", "--input", input], root)
  const stagingId = (staged.json as Record<string, unknown>).stagingId as string
  fs.writeFileSync(lockPathFor(archPath), "held\n")

  const run = runCli(["commit-architecture", "--staging-id", stagingId], root)
  expect(run.status).toBe(1)
  expect(run.json).toMatchObject({ ok: false, error: "lock_timeout" })
  expect(fs.readFileSync(archPath, "utf8")).toBe(before)

  // ロックが外れれば、同じ staging で書き込める。
  fs.rmSync(lockPathFor(archPath))
  const ok = runCli(["commit-architecture", "--staging-id", stagingId], root)
  expect(ok.status).toBe(0)
})

test("S13: 廃止したサブコマンドは unknown_subcommand で終了コード 2、get の対象は unknown_target で終了コード 0", () => {
  const root = project()
  const before = snapshot([path.join(root, "docs", "ARCHITECTURE.md")])
  for (const subcommand of [
    "stage-adr",
    "stage-gotcha",
    "commit-gotchas",
    "init-gotchas",
    "append-gotcha",
    "tag-gotcha",
    "scan-adr-candidates",
    "shrink-adr-candidate",
    "scan-gotcha-candidates",
    "remove-gotcha-candidate"
  ]) {
    const run = runCli([subcommand], root)
    expect(run.status, subcommand).toBe(2)
    expect(run.json, subcommand).toMatchObject({
      ok: false,
      error: "unknown_subcommand"
    })
  }
  for (const target of ["adr", "gotchas", "gotchas-template"]) {
    const run = runCli(["get", target], root)
    expect(run.status, target).toBe(0)
    expect(run.json, target).toMatchObject({
      ok: false,
      error: "unknown_target"
    })
  }
  expectUnchanged(before)
})

test("S14: get config は gotchas と features を返さず、案内は残るサブコマンドだけ", () => {
  const root = project()
  const run = runCli(["get", "config"], root)
  const json = run.json as Record<string, unknown>
  expect(json.gotchas).toBeUndefined()
  expect(json.features).toBeUndefined()
  expect(Object.keys(json.cli as Record<string, unknown>).sort()).toEqual([
    "commitArchitecture",
    "linkClaudeMd",
    "path",
    "stageArchitecture"
  ])
  expect(Object.keys(json.inputSchemas as Record<string, unknown>)).toEqual([
    "stage-architecture"
  ])
})

test("S15: 残った ## ADR 一覧 は diff-architecture が legacy_section を出し、stage-architecture の remove で消せる", () => {
  const root = project()
  const archPath = path.join(root, "docs", "ARCHITECTURE.md")
  const original = fs.readFileSync(archPath, "utf8")
  fs.writeFileSync(
    archPath,
    `${original.replace(/\n+$/, "")}\n\n## ADR 一覧\n\n### ADR-001: 古い判断\n`
  )

  const diff = runCli(["diff-architecture"], root)
  const findings = (diff.json as Record<string, unknown>).findings as {
    kind: string
    section: string
  }[]
  expect(findings).toContainEqual(
    expect.objectContaining({ kind: "legacy_section", section: "ADR 一覧" })
  )

  const input = writeFile(
    root,
    "remove.json",
    JSON.stringify({ sections: [{ heading: "ADR 一覧", remove: true }] })
  )
  const staged = runCli(["stage-architecture", "--input", input], root)
  expect(staged.status, staged.stdout).toBe(0)
  const stagingId = (staged.json as Record<string, unknown>).stagingId as string
  const committed = runCli(
    ["commit-architecture", "--staging-id", stagingId],
    root
  )
  expect(committed.status, committed.stdout).toBe(0)
  const after = fs.readFileSync(archPath, "utf8")
  expect(after).not.toContain("## ADR 一覧")
  expect(after.replace(/\n+$/, "")).toBe(original.replace(/\n+$/, ""))
})

test("S10: get config は rules を返さず、stage-rules / commit-rules / get rules は未知のコマンドになる", () => {
  const root = project()
  const config = runCli(["get", "config"], root)
  expect(config.status).toBe(0)
  expect((config.json as Record<string, unknown>).rules).toBeUndefined()

  for (const args of [
    ["stage-rules", "--input", "x.json"],
    ["commit-rules", "--staging-id", "x"]
  ]) {
    expect(runCli(args, root).status, args[0]).not.toBe(0)
  }
  const get = runCli(["get", "rules"], root)
  expect((get.json as Record<string, unknown>).error).toBe("unknown_target")
})

test("S11: 保護パス・テスト方針が無い ARCHITECTURE で diff-architecture が section_missing を出し、規約は出さない", () => {
  const root = project()
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    "# ARCHITECTURE\n\n## システム概要\n\n概要。\n\n## コマンド定義\n\n| 種別 | コマンド |\n| --- | --- |\n| test | `pnpm test` |\n"
  )

  const r = runCli(["diff-architecture"], root)
  expect(r.status).toBe(0)
  const findings = (r.json as Record<string, unknown>).findings as {
    kind: string
    section?: string
  }[]
  const missing = findings
    .filter((f) => f.kind === "section_missing")
    .map((f) => f.section)
  expect(missing).toContain("保護パス")
  expect(missing).toContain("テスト方針")
  expect(missing).not.toContain("規約")
})

test("LC1: link-claude-md は ARCHITECTURE が無ければ拒否し、あれば CLAUDE.md へ追記する", () => {
  const empty = mkTmp()
  writeFile(empty, "metatron.config.json", "{}")
  const refused = runCli(["link-claude-md"], empty)
  expect(refused.status).not.toBe(0)
  expect(refused.json).toMatchObject({ error: "architecture_missing" })

  const root = project()
  writeFile(root, "docs/GOTCHAS.md", "# GOTCHAS\n")
  const linked = runCli(["link-claude-md"], root)
  expect(linked.status).toBe(0)
  // GOTCHAS の台帳があっても足すのは ARCHITECTURE だけ。
  expect(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toBe(
    "@docs/ARCHITECTURE.md\n"
  )
  // 設定ファイルがあるプロジェクトでは設定を書き換えない。
  expect(linked.json).toMatchObject({ configCreated: false })
  expect(fs.readFileSync(path.join(root, "metatron.config.json"), "utf8")).toBe(
    "{}"
  )
})

test("LC2: link-claude-md は metatron.config.json が無ければ最小の設定を作る", () => {
  const root = mkTmp()
  fs.mkdirSync(path.join(root, ".git"))
  writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)
  const linked = runCli(["link-claude-md"], root)
  expect(linked.status).toBe(0)
  expect(linked.json).toMatchObject({ configCreated: true, written: true })
  expect(
    JSON.parse(fs.readFileSync(path.join(root, "metatron.config.json"), "utf8"))
  ).toStrictEqual({ version: 1 })
})

test("LC3: 空白を含むパスは飛ばし、既存の設定は上書きしない", () => {
  const root = project()
  const config = '{"version":1,"paths":{"architecture":"my docs/A.md"}}'
  writeFile(root, "metatron.config.json", config)
  writeFile(root, "my docs/A.md", ARCHITECTURE)
  const linked = runCli(["link-claude-md"], root)
  expect(linked.status).toBe(0)
  expect(linked.json).toMatchObject({
    added: [],
    skipped: ["my docs/A.md"],
    configCreated: false
  })
  expect(fs.readFileSync(path.join(root, "metatron.config.json"), "utf8")).toBe(
    config
  )
})
