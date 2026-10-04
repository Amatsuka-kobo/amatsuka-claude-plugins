// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §12(CLI の入出力規約)の検証。
// ケース ID は metatron 設計書 §13-1 の `scan.ts` / CLI 統合の表(S5・S6)に対応する。
//
// - S5: 全読み取り系サブコマンドが、どんな異常環境でも exit 0 かつ妥当な JSON を出力する。
// - S6: 書き込み系の拒否時に、非 0 終了・stdout は妥当な JSON・対象ファイルがバイト単位で不変。
//
// 加えて stage → commit の正常系を CLI 経由で通しで検証する。

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, expect, test } from "vitest"
import { findSection, parseArchitecture } from "../../lib/architecture.js"
import { RULES_ADMIN_NOTICE } from "../../lib/rules.js"
import { stagingDirFor } from "../../lib/staging.js"
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

/** 設定と ARCHITECTURE を持つ一時プロジェクト。docRoot はこのディレクトリに固定される。 */
function project(): string {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)
  return root
}

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
  ["get", "gotchas-template"],
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
    name: "init-gotchas は内容のある台帳を拒否する",
    args: ["init-gotchas"],
    error: "already_exists"
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
// GOTCHAS 台帳の初回生成(CLI 経由の通し)
// ---------------------------------------------------------------------------

test("get gotchas-template → init-gotchas で作成し、再実行は拒否する", () => {
  const root = project()
  const gotchasPath = path.join(root, "docs", "GOTCHAS.md")

  const before = runCli(["get", "gotchas-template"], root)
  expect(before.status).toBe(0)
  const beforeJson = before.json as Record<string, unknown>
  expect(beforeJson.ok).toBe(true)
  expect(beforeJson.exists).toBe(false)
  expect(beforeJson.hasContent).toBe(false)
  expect(beforeJson.next).not.toBeNull()

  const initialized = runCli(["init-gotchas"], root)
  expect(initialized.status).toBe(0)
  expect((initialized.json as Record<string, unknown>).created).toBe(true)

  const after = runCli(["get", "gotchas-template"], root)
  expect(after.status).toBe(0)
  const afterJson = after.json as Record<string, unknown>
  expect(afterJson.exists).toBe(true)
  expect(afterJson.hasContent).toBe(true)
  expect(afterJson.next).toBeNull()
  expect(fs.readFileSync(gotchasPath, "utf8")).toBe(afterJson.template)

  const snapshotBeforeRetry = snapshot([gotchasPath])
  const retry = runCli(["init-gotchas"], root)
  expect(retry.status).not.toBe(0)
  expect((retry.json as Record<string, unknown>).error).toBe("already_exists")
  expectUnchanged(snapshotBeforeRetry)
})

test("台帳が無い状態でも get gotchas-template は ok: true", () => {
  const root = mkTmp()

  const run = runCli(["get", "gotchas-template"], root)

  expect(run.status).toBe(0)
  const json = run.json as Record<string, unknown>
  expect(json.ok).toBe(true)
  expect(json.exists).toBe(false)
  expect(json.hasContent).toBe(false)
})

test("空白のみの台帳は exists: true / hasContent: false となり雛形で作り直す", () => {
  const root = project()
  const gotchasPath = writeFile(root, "docs/GOTCHAS.md", "   \n\n")

  const before = runCli(["get", "gotchas-template"], root)
  expect(before.status).toBe(0)
  const beforeJson = before.json as Record<string, unknown>
  expect(beforeJson.exists).toBe(true)
  expect(beforeJson.hasContent).toBe(false)

  const initialized = runCli(["init-gotchas"], root)
  expect(initialized.status).toBe(0)
  expect((initialized.json as Record<string, unknown>).created).toBe(true)
  expect(fs.readFileSync(gotchasPath, "utf8")).toBe(beforeJson.template)
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
  // stage-adr の diff も省略の有無を機械的に返す。
  expect((stagedJson.diff as Record<string, unknown>).truncated).toBe(false)
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

test("N10: ADR を 2 件足すと区切りが入り、get adr の raw には含まれない", () => {
  const root = mkTmp()
  writeFile(root, "metatron.config.json", "{}")
  const architecture = writeFile(root, "docs/ARCHITECTURE.md", ARCHITECTURE)

  const addAdr = (filename: string, title: string, impact: string): void => {
    const inputPath = writeFile(
      root,
      filename,
      JSON.stringify({
        mode: "add",
        title,
        decidedBy: "team",
        background: `${title}の背景`,
        options: ["A: 採用する", "B: 採用しない"],
        conclusion: `${title}を採用する`,
        rationale: `${title}が要件に合うため`,
        impact
      })
    )
    const staged = runCli(["stage-adr", "--input", inputPath], root)
    expect(staged.status, staged.stdout).toBe(0)
    const stagedJson = staged.json as Record<string, unknown>
    expect(stagedJson.ok).toBe(true)

    const committed = runCli(
      ["commit-architecture", "--staging-id", stagedJson.stagingId as string],
      root
    )
    expect(committed.status, committed.stdout).toBe(0)
    expect((committed.json as Record<string, unknown>).written).toBe(true)
  }

  addAdr("adr-1.json", "最初の判断", "最初の影響範囲。")
  addAdr("adr-2.json", "2 番目の判断", "2 番目の影響範囲。")

  const after = fs.readFileSync(architecture, "utf8")
  expect(after.startsWith(ARCHITECTURE)).toBe(true)
  expect(after).toContain(
    "最初の影響範囲。\n\n---\n\n### ADR-002: 2 番目の判断"
  )
  expect(after.match(/\n\n---\n\n/g)).toHaveLength(1)

  const listed = runCli(["get", "adr"], root)
  expect(listed.status, listed.stdout).toBe(0)
  const listedJson = listed.json as Record<string, unknown>
  expect(listedJson.total).toBe(2)
  const entries = listedJson.entries as Record<string, unknown>[]
  expect(entries.map((entry) => entry.id)).toEqual(["ADR-001", "ADR-002"])
  for (const entry of entries) {
    const raw = String(entry.raw)
    expect(
      raw.split(/\r?\n/).some((line) => /^ {0,3}-{3,}[ \t]*$/.test(line))
    ).toBe(false)
  }
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

// ---------------------------------------------------------------------------
// rules(設計書 §6)
// ---------------------------------------------------------------------------

const RULES_BODY = `# 規約\n\n${RULES_ADMIN_NOTICE}\n\n- ブランチを切らない。\n`

test("S7: get rules は未作成でも exit 0。--name で 1 件に絞れる。値域外は unknown_rules_name", () => {
  const root = project()

  const all = runCli(["get", "rules"], root)
  expect(all.status).toBe(0)
  expect(
    ((all.json as Record<string, unknown>).rules as unknown[]).length
  ).toBe(3)
  expect(
    (
      (all.json as Record<string, unknown>).rules as {
        exists: boolean
        error: string | null
      }[]
    )[0].error
  ).toBe("not_created")

  const one = runCli(["get", "rules", "--name", "conventions"], root)
  expect(one.status).toBe(0)
  expect(
    ((one.json as Record<string, unknown>).rules as unknown[]).length
  ).toBe(1)

  const bad = runCli(["get", "rules", "--name", "nope"], root)
  expect(bad.status).toBe(0)
  expect((bad.json as Record<string, unknown>).error).toBe("unknown_rules_name")
})

test("S8: stage-rules → commit-rules で rules ファイルが作られ、再 commit は already_used", () => {
  const root = project()
  const input = writeFile(
    root,
    "in.json",
    JSON.stringify({ name: "conventions", body: RULES_BODY })
  )
  const target = path.join(
    root,
    ".claude",
    "rules",
    "metatron",
    "conventions.md"
  )

  const staged = runCli(["stage-rules", "--input", input], root)
  expect(staged.status).toBe(0)
  const id = (staged.json as Record<string, unknown>).stagingId as string
  expect(typeof id).toBe("string")
  // stage は書き込まない。
  expect(fs.existsSync(target)).toBe(false)

  const committed = runCli(["commit-rules", "--staging-id", id], root)
  expect(committed.status).toBe(0)
  expect(fs.readFileSync(target, "utf8")).toBe(RULES_BODY)

  const again = runCli(["commit-rules", "--staging-id", id], root)
  expect(again.status).not.toBe(0)
  expect((again.json as Record<string, unknown>).error).toBe("already_used")

  const read = runCli(["get", "rules", "--name", "conventions"], root)
  expect(
    ((read.json as Record<string, unknown>).rules as { exists: boolean }[])[0]
      .exists
  ).toBe(true)
})

test("S9: kind 不一致の commit は staging_kind_mismatch で拒否され、対象ファイルは不変", () => {
  const root = project()
  const archPath = path.join(root, "docs", "ARCHITECTURE.md")
  const before = fs.readFileSync(archPath, "utf8")
  const rulesTarget = path.join(
    root,
    ".claude",
    "rules",
    "metatron",
    "conventions.md"
  )

  // rules の stagingId を commit-architecture へ渡す。
  const rulesInput = writeFile(
    root,
    "r.json",
    JSON.stringify({ name: "conventions", body: RULES_BODY })
  )
  const rulesStaged = runCli(["stage-rules", "--input", rulesInput], root)
  const wrong1 = runCli(
    [
      "commit-architecture",
      "--staging-id",
      (rulesStaged.json as Record<string, unknown>).stagingId as string
    ],
    root
  )
  expect(wrong1.status).not.toBe(0)
  expect((wrong1.json as Record<string, unknown>).error).toBe(
    "staging_kind_mismatch"
  )
  expect(fs.existsSync(rulesTarget)).toBe(false)

  // architecture の stagingId を commit-rules へ渡す。
  const archInput = writeFile(
    root,
    "a.json",
    JSON.stringify({
      sections: [{ heading: "システム概要", body: "新しい概要。" }]
    })
  )
  const archStaged = runCli(["stage-architecture", "--input", archInput], root)
  const wrong2 = runCli(
    [
      "commit-rules",
      "--staging-id",
      (archStaged.json as Record<string, unknown>).stagingId as string
    ],
    root
  )
  expect(wrong2.status).not.toBe(0)
  expect((wrong2.json as Record<string, unknown>).error).toBe(
    "staging_kind_mismatch"
  )
  expect(fs.readFileSync(archPath, "utf8")).toBe(before)

  // 拒否された staging は消費されていない。正しいコマンドなら通る。
  const ok = runCli(
    [
      "commit-architecture",
      "--staging-id",
      (archStaged.json as Record<string, unknown>).stagingId as string
    ],
    root
  )
  expect(ok.status).toBe(0)
})

test("S10: docRoot と起動ディレクトリがずれていると get config が warnings で知らせる", () => {
  const root = project()
  const sub = path.join(root, "packages", "web")
  fs.mkdirSync(sub, { recursive: true })

  const same = runCli(["get", "config"], root)
  expect(same.status).toBe(0)
  expect(
    ((same.json as Record<string, unknown>).warnings as string[]).some((w) =>
      w.includes("起動ディレクトリ")
    )
  ).toBe(false)
  const rules = (same.json as Record<string, unknown>).rules as {
    relative: string
  }
  expect(rules.relative).toBe(".claude/rules/metatron")

  const differs = runCli(["get", "config"], sub)
  expect(differs.status).toBe(0)
  const warnings = (differs.json as Record<string, unknown>)
    .warnings as string[]
  expect(warnings.some((w) => w.includes("起動ディレクトリ"))).toBe(true)
  expect(warnings.some((w) => w.includes(".claude/rules/"))).toBe(true)
})

test("S11: 移行後の ARCHITECTURE(3 節なし)で diff-architecture が section_missing を出さない", () => {
  // 移行後の姿。テスト方針 / 保護パス / 規約 を持たない ARCHITECTURE。
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
  for (const moved of ["テスト方針", "保護パス", "規約"]) {
    expect(missing, moved).not.toContain(moved)
  }
})

// ---------------------------------------------------------------------------
// scan-adr-candidates / shrink-adr-candidate(codiel intent 駆動化の設計書 §6.11)
// ---------------------------------------------------------------------------

const CANDIDATE_ENTRY = [
  "### 認証トークンはサーバーでだけ保持する [ADR 候補: frontend-3]",
  "- 制約: ブラウザの保存領域に認証トークンを置かない",
  "- 決定日: 2026-10-01",
  "- 出典 intent: docs/intents/2026-09-30-login-rework.md",
  "- 関連 ADR: なし(ADR 候補)",
  "#### 背景",
  "XSS でトークンが漏れた。",
  "#### 検討した選択肢",
  "1. localStorage",
  "2. HttpOnly Cookie",
  "#### 採用した結論",
  "HttpOnly Cookie にする。",
  "#### 理由",
  "スクリプトから読めない。",
  "#### 影響範囲",
  "src/app/auth"
]

const CANDIDATE_REFERENCE = [
  "### 認証トークンはサーバーでだけ保持する",
  "- 制約: ブラウザの保存領域に認証トークンを置かない",
  "- 関連 ADR: ADR-001(候補 ID: frontend-3)"
]

function durableDoc(entryLines: readonly string[]): string {
  return [
    "# frontend",
    "",
    "## 意図的な制約",
    "",
    ...entryLines,
    "",
    "## 出典",
    "",
    "なし",
    ""
  ].join("\n")
}

/** git リポジトリで、ARCHITECTURE と候補 frontend-3 を持つ持続層がある。 */
function candidateProject(): { root: string; durable: string } {
  const root = project()
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" })
  const durable = writeFile(
    root,
    "docs/intents/domains/frontend.md",
    durableDoc(CANDIDATE_ENTRY)
  )
  return { root, durable }
}

function scanCandidates(root: string): Record<string, unknown>[] {
  const run = runCli(["scan-adr-candidates"], root)
  expect(run.status).toBe(0)
  const json = run.json as Record<string, unknown>
  return json.candidates as Record<string, unknown>[]
}

/** 候補 frontend-3 を stage-adr → commit-architecture で ADR-001 にする。 */
function adoptCandidate(root: string): void {
  const inputPath = writeFile(
    root,
    "adr-input.json",
    JSON.stringify({
      mode: "add",
      title: "認証トークンはサーバーでだけ保持する",
      decidedBy: "team",
      background: [
        "XSS でトークンが漏れた。",
        "- 出典 intent: docs/intents/2026-09-30-login-rework.md",
        "ADR 候補 ID: frontend-3"
      ].join("\n"),
      options: ["localStorage", "HttpOnly Cookie"],
      conclusion: "HttpOnly Cookie にする。",
      rationale: "スクリプトから読めない。",
      impact: "src/app/auth"
    })
  )
  const staged = runCli(["stage-adr", "--input", inputPath], root)
  expect(staged.status).toBe(0)
  const stagingId = (staged.json as Record<string, unknown>).stagingId
  const committed = runCli(
    ["commit-architecture", "--staging-id", stagingId as string],
    root
  )
  expect(committed.status).toBe(0)
}

function shrinkArgs(
  file: string,
  adr: string,
  hash: string | undefined
): string[] {
  const args = [
    "shrink-adr-candidate",
    "--file",
    file,
    "--candidate-id",
    "frontend-3",
    "--adr",
    adr
  ]
  return hash === undefined ? args : [...args, "--hash", hash]
}

test("scan-adr-candidates は git リポジトリの外では走査せず exit 0 で空を返す", () => {
  const root = mkTmp()
  writeFile(
    root,
    "docs/intents/domains/frontend.md",
    durableDoc(CANDIDATE_ENTRY)
  )

  const run = runCli(["scan-adr-candidates"], root)

  expect(run.status).toBe(0)
  expect(run.json).toMatchObject({
    command: "scan-adr-candidates",
    ok: true,
    repoRoot: null,
    candidates: []
  })
})

test("stage-adr と commit-architecture は持続層に触れず、確定した ADR を adoptedAs が指し、shrink-adr-candidate が exit 0 で縮める", () => {
  const { root, durable } = candidateProject()
  const [candidate] = scanCandidates(root)
  expect(candidate.candidateId).toBe("frontend-3")
  expect(candidate.adoptedAs).toBeNull()

  const beforeAdr = snapshot([durable])
  adoptCandidate(root)
  expectUnchanged(beforeAdr)
  expect(scanCandidates(root)[0].adoptedAs).toBe("ADR-001")

  const args = shrinkArgs(
    candidate.file as string,
    "ADR-001",
    candidate.hash as string
  )
  const shrunk = runCli(args, root)
  expect(shrunk.status).toBe(0)
  expect(shrunk.json).toMatchObject({
    command: "shrink-adr-candidate",
    ok: true,
    written: true,
    alreadyShrunk: false,
    file: durable,
    candidateId: "frontend-3",
    adr: "ADR-001"
  })
  expect(fs.readFileSync(durable, "utf8")).toBe(durableDoc(CANDIDATE_REFERENCE))
  expect(scanCandidates(root)).toStrictEqual([])

  // 既に参照形なら何もせず exit 0。
  const beforeRetry = snapshot([durable])
  const again = runCli(args, root)
  expect(again.status).toBe(0)
  expect(again.json).toMatchObject({
    ok: true,
    written: false,
    alreadyShrunk: true
  })
  expectUnchanged(beforeRetry)
})

test("shrink-adr-candidate の拒否は終了コード 3 と shrinkPending を返し、持続層を変えない", () => {
  const { root, durable } = candidateProject()
  const [candidate] = scanCandidates(root)
  adoptCandidate(root)
  const outside = writeFile(
    root,
    "docs/intents/frontend.md",
    durableDoc(CANDIDATE_ENTRY)
  )
  const hash = candidate.hash as string

  const cases = [
    { error: "hash_mismatch", file: durable, adr: "ADR-001", hash: "0" },
    { error: "adr_not_found", file: durable, adr: "ADR-009", hash },
    { error: "outside_domains_dir", file: outside, adr: "ADR-001", hash }
  ]
  for (const c of cases) {
    const before = snapshot([durable, outside])
    const run = runCli(shrinkArgs(c.file, c.adr, c.hash), root)
    expect(run.status, c.error).toBe(3)
    expect(run.json, c.error).toMatchObject({
      ok: false,
      error: c.error,
      written: false,
      shrinkPending: { file: c.file, candidateId: "frontend-3", adr: c.adr }
    })
    expectUnchanged(before)
  }
})

test("shrink-adr-candidate の書き込みの失敗も終了コード 3 と shrinkPending を返す", () => {
  if (process.getuid?.() === 0) return // root は権限を無視するため検証にならない
  const { root, durable } = candidateProject()
  const [candidate] = scanCandidates(root)
  adoptCandidate(root)
  const dir = path.dirname(durable)
  const before = snapshot([durable])

  fs.chmodSync(dir, 0o555)
  let run: CliRun
  try {
    run = runCli(shrinkArgs(durable, "ADR-001", candidate.hash as string), root)
  } finally {
    fs.chmodSync(dir, 0o755)
  }

  expect(run.status).toBe(3)
  expect(run.json).toMatchObject({
    ok: false,
    error: "write_failed",
    shrinkPending: { file: durable, candidateId: "frontend-3", adr: "ADR-001" }
  })
  expectUnchanged(before)
  expect(fs.readdirSync(dir)).toStrictEqual(["frontend.md"])
})

test("shrink-adr-candidate のオプションが欠けると終了コード 2 で、shrinkPending を返さない", () => {
  const { root, durable } = candidateProject()
  const before = snapshot([durable])

  const run = runCli(shrinkArgs(durable, "ADR-001", undefined), root)

  expect(run.status).toBe(2)
  expect(run.json).toMatchObject({ ok: false, error: "missing_option" })
  expect((run.json as Record<string, unknown>).shrinkPending).toBeUndefined()
  expectUnchanged(before)
})

// ---------------------------------------------------------------------------
// scan-gotcha-candidates / remove-gotcha-candidate(記録のタイミングとサブエージェントへの
// 注入の設計書 2-1)
// ---------------------------------------------------------------------------

const GOTCHA_CANDIDATE_ENTRY = [
  "### キャッシュを消し忘れた [GOTCHAS 候補]",
  "- date: 2026-10-01",
  "- run: login-rework try-2",
  "- task: ログイン画面を直す",
  "- mistake: ビルドのキャッシュを消さずに確認した",
  "- cause: 古い成果物が残っていた(推測)",
  "- countermeasure: 確認の前に pnpm run clean を実行する",
  "- promotionCandidate: Yes"
]

function gotchaDurableDoc(parent: string): string {
  return [
    "# frontend",
    "",
    `## ${parent}`,
    "",
    ...GOTCHA_CANDIDATE_ENTRY,
    "",
    "## 出典",
    "",
    "なし",
    ""
  ].join("\n")
}

/** git リポジトリで、ARCHITECTURE と GOTCHAS 候補を持つ持続層がある。 */
function gotchaCandidateProject(parent = "GOTCHAS 候補"): {
  root: string
  durable: string
} {
  const root = project()
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" })
  const durable = writeFile(
    root,
    "docs/intents/domains/frontend.md",
    gotchaDurableDoc(parent)
  )
  return { root, durable }
}

function scanGotchaCandidates(root: string): Record<string, unknown>[] {
  const run = runCli(["scan-gotcha-candidates"], root)
  expect(run.status).toBe(0)
  const json = run.json as Record<string, unknown>
  return json.candidates as Record<string, unknown>[]
}

function removeArgs(
  file: string,
  hash: string | undefined,
  fileHash: string | undefined
): string[] {
  const args = ["remove-gotcha-candidate", "--file", file]
  if (hash !== undefined) args.push("--hash", hash)
  if (fileHash !== undefined) args.push("--file-hash", fileHash)
  return args
}

test("scan-gotcha-candidates は git リポジトリの外では走査せず exit 0 で空を返す", () => {
  const root = mkTmp()
  writeFile(
    root,
    "docs/intents/domains/frontend.md",
    gotchaDurableDoc("GOTCHAS 候補")
  )

  const run = runCli(["scan-gotcha-candidates"], root)

  expect(run.status).toBe(0)
  expect(run.json).toMatchObject({
    command: "scan-gotcha-candidates",
    ok: true,
    repoRoot: null,
    candidates: []
  })
})

test("scan-gotcha-candidates は候補を返し、台帳に同じタイトルがあれば ledgerMatches に ID が出る", () => {
  const { root, durable } = gotchaCandidateProject()
  const before = snapshot([durable])

  const run = runCli(["scan-gotcha-candidates"], root)

  expect(run.status).toBe(0)
  expect(run.json).toMatchObject({
    command: "scan-gotcha-candidates",
    ok: true,
    repoRoot: root,
    warnings: []
  })
  const [candidate] = (run.json as Record<string, unknown>)
    .candidates as Record<string, unknown>[]
  expect(candidate).toMatchObject({
    file: durable,
    relative: "docs/intents/domains/frontend.md",
    heading: "### キャッシュを消し忘れた [GOTCHAS 候補]",
    title: "キャッシュを消し忘れた",
    fields: {
      date: "2026-10-01",
      run: "login-rework try-2",
      task: "ログイン画面を直す",
      promotionCandidate: "Yes"
    },
    problems: [],
    ledgerMatches: []
  })
  expect(candidate.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(candidate.fileHash).toMatch(/^[0-9a-f]{64}$/)
  expectUnchanged(before)

  writeFile(
    root,
    "docs/GOTCHAS.md",
    `${GOTCHAS}\n### [2026-08-11] GOTCHA-002: キャッシュを消し忘れた\n\n**タスク**: t\n**失敗内容**: m\n**原因 (推測)**: c\n**対策**: p\n**昇格候補**: No\n`
  )
  expect(scanGotchaCandidates(root)[0].ledgerMatches).toStrictEqual([
    "GOTCHA-002"
  ])
})

test("remove-gotcha-candidate は exit 0 でエントリを消し、空になった `## GOTCHAS 候補` も消す", () => {
  const { root, durable } = gotchaCandidateProject()
  const [candidate] = scanGotchaCandidates(root)

  const run = runCli(
    removeArgs(
      candidate.file as string,
      candidate.hash as string,
      candidate.fileHash as string
    ),
    root
  )

  expect(run.status).toBe(0)
  expect(run.json).toMatchObject({
    command: "remove-gotcha-candidate",
    ok: true,
    written: true,
    file: durable,
    title: "キャッシュを消し忘れた"
  })
  expect(fs.readFileSync(durable, "utf8")).toBe(
    "# frontend\n\n## 出典\n\nなし\n"
  )
  expect(scanGotchaCandidates(root)).toStrictEqual([])
})

test("remove-gotcha-candidate は親が `## GOTCHAS 候補` 以外なら見出しを残す", () => {
  const { root, durable } = gotchaCandidateProject("意図的な制約")
  const [candidate] = scanGotchaCandidates(root)

  const run = runCli(
    removeArgs(
      candidate.file as string,
      candidate.hash as string,
      candidate.fileHash as string
    ),
    root
  )

  expect(run.status).toBe(0)
  expect(fs.readFileSync(durable, "utf8")).toBe(
    "# frontend\n\n## 意図的な制約\n\n## 出典\n\nなし\n"
  )
})

test("remove-gotcha-candidate の拒否は終了コード 3 と removePending を返し、持続層を変えない", () => {
  const { root, durable } = gotchaCandidateProject()
  const [candidate] = scanGotchaCandidates(root)
  const outside = writeFile(
    root,
    "docs/intents/frontend.md",
    gotchaDurableDoc("GOTCHAS 候補")
  )
  const hash = candidate.hash as string
  const fileHash = candidate.fileHash as string

  const cases = [
    { error: "file_changed", file: durable, hash, fileHash: "0" },
    { error: "candidate_not_found", file: durable, hash: "0", fileHash },
    { error: "outside_domains_dir", file: outside, hash, fileHash },
    {
      error: "file_not_found",
      file: path.join(root, "docs/intents/domains/none.md"),
      hash,
      fileHash
    }
  ]
  for (const c of cases) {
    const before = snapshot([durable, outside])
    const run = runCli(removeArgs(c.file, c.hash, c.fileHash), root)
    expect(run.status, c.error).toBe(3)
    expect(run.json, c.error).toMatchObject({
      ok: false,
      error: c.error,
      written: false,
      removePending: { file: c.file, hash: c.hash }
    })
    expectUnchanged(before)
  }
})

test("remove-gotcha-candidate は git リポジトリの外では not_git_repository で終了コード 3", () => {
  const root = project()
  const durable = writeFile(
    root,
    "docs/intents/domains/frontend.md",
    gotchaDurableDoc("GOTCHAS 候補")
  )
  const before = snapshot([durable])

  const run = runCli(removeArgs(durable, "0", "0"), root)

  expect(run.status).toBe(3)
  expect(run.json).toMatchObject({
    ok: false,
    error: "not_git_repository",
    written: false
  })
  expectUnchanged(before)
})

test("remove-gotcha-candidate の書き込みの失敗も終了コード 3 と removePending を返す", () => {
  if (process.getuid?.() === 0) return // root は権限を無視するため検証にならない
  const { root, durable } = gotchaCandidateProject()
  const [candidate] = scanGotchaCandidates(root)
  const dir = path.dirname(durable)
  const before = snapshot([durable])

  fs.chmodSync(dir, 0o555)
  let run: CliRun
  try {
    run = runCli(
      removeArgs(
        durable,
        candidate.hash as string,
        candidate.fileHash as string
      ),
      root
    )
  } finally {
    fs.chmodSync(dir, 0o755)
  }

  expect(run.status).toBe(3)
  expect(run.json).toMatchObject({
    ok: false,
    error: "write_failed",
    written: false,
    removePending: { file: durable, hash: candidate.hash }
  })
  expectUnchanged(before)
  expect(fs.readdirSync(dir)).toStrictEqual(["frontend.md"])
})

test("remove-gotcha-candidate のオプションが欠けると終了コード 2 で、removePending を返さない", () => {
  const { root, durable } = gotchaCandidateProject()
  const [candidate] = scanGotchaCandidates(root)
  const before = snapshot([durable])

  for (const args of [
    removeArgs(durable, candidate.hash as string, undefined),
    removeArgs(durable, undefined, candidate.fileHash as string),
    ["remove-gotcha-candidate"]
  ]) {
    const run = runCli(args, root)
    expect(run.status).toBe(2)
    expect(run.json).toMatchObject({ ok: false, error: "missing_option" })
    expect((run.json as Record<string, unknown>).removePending).toBeUndefined()
  }
  expectUnchanged(before)
})
