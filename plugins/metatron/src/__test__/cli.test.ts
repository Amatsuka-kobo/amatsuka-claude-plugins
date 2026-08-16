// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §11(CLI の入出力規約)の検証。
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
import { findSection, parseArchitecture } from "../lib/architecture.js"
import { stagingDirFor } from "../lib/staging.js"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../metatron-cli.ts", import.meta.url))

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

const GOTCHAS = [
  "# GOTCHAS",
  "",
  "## 失敗パターン一覧",
  "",
  "### [2026-08-10] GOTCHA-001: 既存のエントリ",
  "",
  "**タスク**: 何かをしようとした",
  "**失敗内容**: 間違えた",
  "**原因 (推測)**: 確認しなかった",
  "**対策**: 実行前に対象ファイルを Read して確認する",
  "**昇格候補**: No",
  ""
].join("\n")

function docs(root: string): { architecture: string; gotchas: string } {
  return {
    architecture: path.join(root, "docs", "ARCHITECTURE.md"),
    gotchas: path.join(root, "docs", "GOTCHAS.md")
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
  ["get", "gotchas"],
  [
    "get",
    "gotchas",
    "--recent",
    "3",
    "--exclude-tagged",
    "--promotion-candidates"
  ],
  ["get", "adr"],
  ["scan"],
  ["diff-architecture"]
]

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

test("S5: ARCHITECTURE も GOTCHAS も無い環境でも読み取り系は exit 0", () => {
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
  writeFile(root, "docs/GOTCHAS.md", GOTCHAS)
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
    name: "stage-architecture に ADR 一覧 を渡す",
    args: ["stage-architecture"],
    input: { sections: [{ heading: "ADR 一覧", body: "### ADR-001: x" }] },
    error: "adr_heading"
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
    input: { sections: [{ heading: "規約", body: "新しい規約" }] },
    error: "unclosed_fence",
    unclosed: true
  },
  {
    name: "stage-adr の状態変更で reason を省略",
    args: ["stage-adr"],
    input: { mode: "status", id: "ADR-001", status: "廃止" },
    error: "invalid_input"
  },
  {
    name: "stage-adr の状態が値域外",
    args: ["stage-adr"],
    input: {
      mode: "add",
      title: "値域外の状態",
      status: "検討中",
      decidedBy: "team",
      background: "背景",
      options: ["A: 良い/悪い"],
      conclusion: "結論",
      rationale: "理由",
      impact: "影響"
    },
    error: "invalid_status"
  },
  {
    name: "append-gotcha の promotionCandidate が値域外",
    args: ["append-gotcha"],
    input: {
      title: "やらかした",
      task: "t",
      mistake: "m",
      cause: "c",
      countermeasure: "実行前に Read する",
      promotionCandidate: "Maybe"
    },
    error: "invalid_input"
  },
  {
    name: "tag-gotcha の tag が値域外",
    args: [
      "tag-gotcha",
      "--id",
      "GOTCHA-001",
      "--tag",
      "未対応",
      "--reason",
      "r"
    ],
    error: "invalid_tag"
  },
  {
    name: "tag-gotcha の対象 ID が存在しない",
    args: [
      "tag-gotcha",
      "--id",
      "GOTCHA-999",
      "--tag",
      "解決済み",
      "--reason",
      "直した"
    ],
    error: "not_found"
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
    writeFile(root, "docs/GOTCHAS.md", GOTCHAS)
    const { architecture, gotchas } = docs(root)
    const before = snapshot([architecture, gotchas])

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

test("stage-adr → commit-architecture で ADR が採番されて末尾に追加される", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  const architecture = writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)
  const inputPath = writeFile(
    root,
    "adr.json",
    JSON.stringify({
      mode: "add",
      title: "CLI を stage と commit の 2 段階にする",
      decidedBy: "team",
      background: "承認の有無を CLI は判定できない",
      options: ["A: 1 コマンドで書く / 差分を見せずに書けてしまう"],
      conclusion: "2 段階にする",
      rationale: "diff を計算せずに書く経路をコマンド体系から無くせる",
      impact: "plugins/metatron/src/cli"
    })
  )

  const beforeBuf = fs.readFileSync(architecture)
  const staged = runCli(["stage-adr", "--input", inputPath], root)
  expect(staged.status).toBe(0)
  const stagedJson = staged.json as Record<string, unknown>
  expect(stagedJson.ok).toBe(true)
  expect(stagedJson.assignedId).toBe("ADR-001")
  expect(fs.readFileSync(architecture).equals(beforeBuf)).toBe(true)

  const committed = runCli(
    ["commit-architecture", "--staging-id", stagedJson.stagingId as string],
    root
  )
  expect(committed.status).toBe(0)
  expect((committed.json as Record<string, unknown>).written).toBe(true)

  const listed = runCli(["get", "adr"], root)
  expect(listed.status).toBe(0)
  const listedJson = listed.json as Record<string, unknown>
  expect(listedJson.ok).toBe(true)
  expect(listedJson.total).toBe(1)
  const entries = listedJson.entries as Record<string, unknown>[]
  expect(entries[0].id).toBe("ADR-001")
  expect(entries[0].status).toBe("採用")

  // ADR は末尾の節に入り、既存セクションはバイト単位で不変。
  const afterDoc = parseArchitecture(fs.readFileSync(architecture, "utf8"))
  const beforeDoc = parseArchitecture(beforeBuf.toString("utf8"))
  for (const heading of ["システム概要", "技術スタック", "ドメインマップ"]) {
    expect(
      findSection(afterDoc, heading)?.raw,
      `${heading} が変化している`
    ).toBe(findSection(beforeDoc, heading)?.raw)
  }
})
