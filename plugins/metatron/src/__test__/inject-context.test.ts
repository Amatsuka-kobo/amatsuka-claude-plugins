// SessionStart・SubagentStart 注入 hook の検証。
// ケース ID は metatron 設計書 §13-1 の inject-context.ts の表(I1〜I21・I10b)に対応する。
// S1〜S10 は `harness-docs/design/2026-10-04-metatron-recording-timing-and-subagent-injection-design.md` の 3 と 7 に対応する。
// 形式の正本はファイル契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §13。
//
// 実行は tsx 経由の子プロセス(stdin に SessionStart の JSON を流し stdout を読む)。
// plugins/codiel/src/hooks/__test__/guard-write.test.ts と同型。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterAll, expect, test } from "vitest"
import {
  findSection,
  parseArchitecture,
  UNCLOSED_FENCE_WARNING
} from "../lib/architecture.js"
import { ADR_ENV, type Features, GOTCHAS_ENV } from "../lib/features.js"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-context.ts", import.meta.url))
const PLUGIN_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url))
)
const CLI = path.join(PLUGIN_ROOT, "scripts", "metatron.mjs")

// 記録のタイミング。文書があるときだけ、CLI 案内の後に置く。
const RECORDING_LINES = [
  "依頼の完了報告の前に、判断と失敗に ADR・GOTCHAS へ残すものが無いか確かめる。",
  "残すなら updating-architecture か recording-gotchas の承認手順で記録する。",
  "codiel run の報告に出た候補は、run の中でなく次のターンの初めに確かめる。",
  "docs/intents/domains/ の候補は /metatron:update で取り込める。"
]

// 委譲の注意。サブエージェントには SubagentStart hook が両文書を注入するので、依頼文へ写させない。
const DELEGATION_LINES = [
  "サブエージェントには SubagentStart hook が ARCHITECTURE と GOTCHAS を注入する。",
  "委譲の依頼文には、両文書の原文も要約も書き写さない。"
]

// 実装と同じ文面を独立に持つ。CLI 案内・記録のタイミング・委譲の注意は縮退で一切変えてはならない要素なので、
// 「完全な形で残る」を部分一致ではなく全文一致で確かめる(I13)。
const GUIDE = [
  "# metatron: プロジェクトの前提と落とし穴",
  "",
  "これらの文書と `.claude/rules/metatron/` の 3 ファイルは metatron の管理下にある。**直接編集は PreToolUse hook が拒否する。**",
  `記録・更新・全文取得は次の CLI を使う(絶対パス。M = ${CLI}):`,
  "  読む:     node M get gotchas --query <語> / node M get adr / node M get architecture",
  "  記録:     node M append-gotcha --input <一時ファイル>",
  '  タグ:     node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "..."',
  "  文書更新: node M stage-architecture --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "  ADR:     node M stage-adr --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "  規律:     node M get rules [--name conventions|protected-paths|testing-policy]",
  "  規律更新: node M stage-rules --input <一時ファイル> → node M commit-rules --staging-id <id>",
  "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。",
  ...RECORDING_LINES,
  ...DELEGATION_LINES
].join("\n")

/** 削れない部分だけの出力の長さ。これより小さい予算では、削れない部分だけが出る。 */
const GUIDE_OUTPUT_LENGTH = `${GUIDE}\n`.length

// サブエージェント向けの削れない部分。CLI の案内・記録のタイミング・委譲の注意は載せない。
const SUBAGENT_GUIDE = [
  "# metatron: プロジェクトの前提と落とし穴",
  "",
  "以下の文書は前提として読むだけにし、直接編集しない。"
].join("\n")

// 文書がまだ 1 つも無いときの案内(設計書 §8-7 の限定)。
// `/metatron:init` はまさにこの状態で使うコマンドなので、案内を落とすと init を始められない。
const INIT_GUIDE = [
  "# metatron: プロジェクトの前提と落とし穴",
  "",
  "このプロジェクトにはまだ ARCHITECTURE も GOTCHAS も無い。**`/metatron:init` で作成する。**",
  "init は `.claude/rules/metatron/` の 3 ファイル(規約・保護パス・テスト方針)も併せて作る。",
  "作成後はこれらが metatron の管理下に入り、直接編集は PreToolUse hook が拒否する。",
  `記録・更新・全文取得は次の CLI を使う(絶対パス。M = ${CLI}):`,
  "  読む:     node M get gotchas --query <語> / node M get adr / node M get architecture",
  "  記録:     node M append-gotcha --input <一時ファイル>",
  '  タグ:     node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "..."',
  "  文書更新: node M stage-architecture --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "  ADR:     node M stage-adr --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "  規律:     node M get rules [--name conventions|protected-paths|testing-policy]",
  "  規律更新: node M stage-rules --input <一時ファイル> → node M commit-rules --staging-id <id>",
  "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。"
].join("\n")

// --- 2 変数の組み合わせごとの文面(設計書 2026-10-08 の 3-1)-------------------
// 両方有効の変種は上の固定文字列と一致することを V0 で確かめ、改修前とのバイト一致の根拠にする。

function titleFor(f: Features): string {
  return f.gotchas
    ? "# metatron: プロジェクトの前提と落とし穴"
    : "# metatron: プロジェクトの前提"
}

function cliLinesFor(f: Features): string[] {
  const reads = f.adr
    ? f.gotchas
      ? "node M get gotchas --query <語> / node M get adr / node M get architecture"
      : "node M get adr / node M get architecture"
    : f.gotchas
      ? "node M get gotchas --query <語> / node M get architecture"
      : "node M get architecture"
  return [
    `記録・更新・全文取得は次の CLI を使う(絶対パス。M = ${CLI}):`,
    `  読む:     ${reads}`,
    ...(f.gotchas
      ? [
          "  記録:     node M append-gotcha --input <一時ファイル>",
          '  タグ:     node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "..."'
        ]
      : []),
    "  文書更新: node M stage-architecture --input <一時ファイル> → node M commit-architecture --staging-id <id>",
    ...(f.adr
      ? [
          "  ADR:     node M stage-adr --input <一時ファイル> → node M commit-architecture --staging-id <id>"
        ]
      : []),
    "  規律:     node M get rules [--name conventions|protected-paths|testing-policy]",
    "  規律更新: node M stage-rules --input <一時ファイル> → node M commit-rules --staging-id <id>",
    "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。"
  ]
}

function recordingLinesFor(f: Features): string[] {
  if (f.adr && f.gotchas) return RECORDING_LINES
  if (f.adr)
    return [
      "依頼の完了報告の前に、判断に ADR へ残すものが無いか確かめる。",
      "残すなら updating-architecture の承認手順で記録する。",
      ...RECORDING_LINES.slice(2)
    ]
  if (f.gotchas)
    return [
      "依頼の完了報告の前に、失敗に GOTCHAS へ残すものが無いか確かめる。",
      "残すなら recording-gotchas の承認手順で記録する。",
      ...RECORDING_LINES.slice(2)
    ]
  return []
}

function delegationLinesFor(f: Features): string[] {
  return f.gotchas
    ? DELEGATION_LINES
    : [
        "サブエージェントには SubagentStart hook が ARCHITECTURE を注入する。",
        "委譲の依頼文には、ARCHITECTURE の原文も要約も書き写さない。"
      ]
}

function guideFor(f: Features): string {
  return [
    titleFor(f),
    "",
    "これらの文書と `.claude/rules/metatron/` の 3 ファイルは metatron の管理下にある。**直接編集は PreToolUse hook が拒否する。**",
    ...cliLinesFor(f),
    ...recordingLinesFor(f),
    ...delegationLinesFor(f)
  ].join("\n")
}

function subagentGuideFor(f: Features): string {
  return [
    titleFor(f),
    "",
    "以下の文書は前提として読むだけにし、直接編集しない。"
  ].join("\n")
}

function initGuideFor(f: Features): string {
  return [
    titleFor(f),
    "",
    f.gotchas
      ? "このプロジェクトにはまだ ARCHITECTURE も GOTCHAS も無い。**`/metatron:init` で作成する。**"
      : "このプロジェクトにはまだ ARCHITECTURE が無い。**`/metatron:init` で作成する。**",
    "init は `.claude/rules/metatron/` の 3 ファイル(規約・保護パス・テスト方針)も併せて作る。",
    "作成後はこれらが metatron の管理下に入り、直接編集は PreToolUse hook が拒否する。",
    ...cliLinesFor(f)
  ].join("\n")
}

/** 4 通りすべての記録のタイミングと委譲の注意の行。漏れの検査に使う。 */
const ALL_SESSION_ONLY_LINES = [
  { adr: true, gotchas: true },
  { adr: true, gotchas: false },
  { adr: false, gotchas: true },
  { adr: false, gotchas: false }
].flatMap((f) => [...recordingLinesFor(f), ...delegationLinesFor(f)])

/** 設定の読み取りを必ず例外にする故障注入モジュール(I3c 用)。 */
const FAULT_CONFIG = fileURLToPath(
  new URL("../testing/fault-config.mjs", import.meta.url)
)

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 後始末の失敗はテスト結果に影響させない
    }
  }
})

function mkTmp(): string {
  // /tmp が symlink である環境で docRoot の実体パスと食い違わないよう realpath で解決する。
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-inject-"))
  )
  tmpDirs.push(dir)
  return dir
}

function write(root: string, rel: string, body: string): string {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, "utf8")
  return full
}

function md(lines: string[]): string {
  return `${lines.join("\n")}\n`
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // hook 自身の位置からプラグインルートを組み立てる規則を検証したいので、環境変数の上書きを外す。
  delete env.CLAUDE_PLUGIN_ROOT
  // 2 変数はテストを起動したシェルから継承せず、呼び出し側が features で明示する。
  delete env[ADR_ENV]
  delete env[GOTCHAS_ENV]
  return env
}

/** 2 変数を有効にした値だけを入れ、無効な側は未設定のままにする。 */
function featureEnv(features: Features): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  if (features.adr) env[ADR_ENV] = "1"
  if (features.gotchas) env[GOTCHAS_ENV] = "1"
  return env
}

const BOTH_ON: Features = { adr: true, gotchas: true }

/** 4 通りの組み合わせ。先頭は両方有効。 */
const COMBOS: Features[] = [
  BOTH_ON,
  { adr: true, gotchas: false },
  { adr: false, gotchas: true },
  { adr: false, gotchas: false }
]

function label(features: Features): string {
  return `ADR ${features.adr ? "有効" : "無効"} / GOTCHAS ${features.gotchas ? "有効" : "無効"}`
}

/**
 * hook を起動し、出力の hookEventName と additionalContext を返す。何も出力しなかった場合は null。
 * input は hook の stdin に流す JSON。
 */
function runHook(
  cwd: string,
  input: Record<string, unknown>,
  features: Features,
  extraEnv: NodeJS.ProcessEnv = {}
): { eventName: string; content: string } | null {
  const out = runTs(HOOK, [], {
    cwd,
    env: { ...childEnv(), ...featureEnv(features), ...extraEnv },
    input: JSON.stringify(input)
  })
  if (out.trim() === "") return null
  const parsed = JSON.parse(out) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string }
  }
  return {
    eventName: parsed.hookSpecificOutput.hookEventName,
    content: parsed.hookSpecificOutput.additionalContext
  }
}

/** SessionStart の注入結果の additionalContext。何も出力しなかった場合は null。 */
function inject(
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
  features: Features = BOTH_ON
): string | null {
  const result = runHook(
    cwd,
    {
      session_id: "s1",
      transcript_path: path.join(cwd, "t.jsonl"),
      cwd,
      hook_event_name: "SessionStart",
      source: "startup"
    },
    features,
    extraEnv
  )
  if (result === null) return null
  expect(result.eventName).toBe("SessionStart")
  return result.content
}

/** SubagentStart の注入結果の additionalContext。何も出力しなかった場合は null。 */
function injectSubagent(
  cwd: string,
  features: Features = BOTH_ON
): string | null {
  const result = runHook(
    cwd,
    {
      session_id: "s1",
      transcript_path: path.join(cwd, "t.jsonl"),
      cwd,
      hook_event_name: "SubagentStart",
      agent_id: "agent-1",
      agent_type: "general-purpose"
    },
    features
  )
  if (result === null) return null
  expect(result.eventName).toBe("SubagentStart")
  return result.content
}

// --- fixtures ---------------------------------------------------------------

function adrEntry(n: number, title: string, status: string): string[] {
  return [
    `### ADR-${String(n).padStart(3, "0")}: ${title}`,
    "",
    `- 状態: ${status}`,
    "- 決定日: 2026-08-16",
    "- 決定者: あまつか工房",
    "",
    "#### 背景",
    "DB に置くと差分レビューができない。",
    "#### 採用した結論",
    "Markdown に置く。",
    ""
  ]
}

const ARCH_HEAD = [
  "# ARCHITECTURE",
  "",
  "## システム概要",
  "",
  "この擬似プロジェクトは注入 hook の検証のために置いてある。段落は複数の文からなる。",
  "",
  "```mermaid",
  "graph TD",
  "  A[app] --> B[api]",
  "## これは見出しではない",
  "```",
  "",
  "## 技術スタック",
  "",
  "| 項目 | 値 |",
  "| --- | --- |",
  "| 言語 | TypeScript |",
  "",
  "Node 26 と pnpm を使う。",
  "",
  "## レイヤー構造",
  "",
  "上から UI・アプリケーション・ドメインの 3 層とする。依存は上から下へだけ許す。",
  "",
  "## 保護パス",
  "",
  "- docs/ARCHITECTURE.md は metatron の管理下にある。",
  ""
]

function architecture(adrCount = 1): string {
  const lines = [...ARCH_HEAD]
  if (adrCount > 0) {
    lines.push("## ADR 一覧", "")
    for (let n = 1; n <= adrCount; n++) {
      lines.push(...adrEntry(n, `記録の置き場を決める ${n}`, "採用"))
    }
  }
  return md(lines)
}

/** 段階 4 を踏ませるための巨大な ARCHITECTURE。 */
function hugeArchitecture(sections = 10, padding = 600): string {
  const lines = [...ARCH_HEAD]
  for (let n = 1; n <= sections; n++) {
    lines.push(
      `## 追加の節 ${n}`,
      "",
      `節 ${n} の最初の散文行である。${"あ".repeat(padding)}`,
      ""
    )
  }
  return md(lines)
}

/** 先頭パイプの無い GFM テーブル。GFM は行頭・行末のパイプを省略できる。 */
const PIPELESS_TABLE = [
  "Language | Framework",
  "------- | -------",
  "TypeScript | Node"
]

/** 段階 4 を踏ませたうえで、表の扱いだけを見るための ARCHITECTURE。 */
function tableArchitecture(sections = 10, padding = 600): string {
  const lines = [
    "# ARCHITECTURE",
    "",
    "## 表だけの節",
    "",
    ...PIPELESS_TABLE,
    "",
    "## 表のあとに散文がある節",
    "",
    ...PIPELESS_TABLE,
    "",
    "表のあとに置いた散文行である。",
    ""
  ]
  for (let n = 1; n <= sections; n++) {
    lines.push(
      `## 追加の節 ${n}`,
      "",
      `節 ${n} の最初の散文行である。${"あ".repeat(padding)}`,
      ""
    )
  }
  return md(lines)
}

function gotchaEntry(n: number, tag?: string, padding = 0): string[] {
  const label = tag === undefined ? "" : `[${tag}] `
  return [
    `### [2026-08-16] GOTCHA-${String(n).padStart(3, "0")}: ${label}失敗 ${n} のタイトル`,
    "",
    `**タスク**: タスク ${n}`,
    `**失敗内容**: 失敗 ${n} の内容${"い".repeat(padding)}`,
    `**原因 (推測)**: 原因 ${n}`,
    "**対策**: 実装前に docs/ARCHITECTURE.md を Read する。",
    "**昇格候補**: No",
    ""
  ]
}

/** 新しいものが上。tagged に入れた番号にはタグを付ける。 */
function gotchas(count: number, tagged: number[] = [], padding = 0): string {
  const lines = [
    "# GOTCHAS",
    "",
    "このプロジェクトで AI が実際にやってしまった失敗のパターンを蓄積する。",
    "",
    "## 運用ルール",
    "",
    "- 新しいものを上に追加する。",
    "",
    "## 記入テンプレート",
    "",
    "### [YYYY-MM-DD] GOTCHA-NNN: 失敗のタイトル",
    "",
    "**タスク**: (何をしようとしていたか)",
    "",
    "## 失敗パターン一覧",
    ""
  ]
  for (let n = count; n >= 1; n--) {
    lines.push(
      ...gotchaEntry(n, tagged.includes(n) ? "解決済み" : undefined, padding)
    )
  }
  return md(lines)
}

function project(opts: {
  arch?: string
  gotchas?: string
  config?: unknown
}): string {
  const root = mkTmp()
  if (opts.arch !== undefined) write(root, "docs/ARCHITECTURE.md", opts.arch)
  if (opts.gotchas !== undefined) write(root, "docs/GOTCHAS.md", opts.gotchas)
  if (opts.config !== undefined) {
    write(
      root,
      "metatron.config.json",
      typeof opts.config === "string"
        ? opts.config
        : `${JSON.stringify(opts.config, null, 2)}\n`
    )
  }
  return root
}

function configWith(maxChars: number, extra: Record<string, unknown> = {}) {
  return { version: 1, injection: { maxChars, ...extra } }
}

/** `### 直近 N 件(全文)` 以降。全文対象の判定に使う。 */
function recentBlock(content: string): string {
  const at = content.indexOf("### 直近")
  return at === -1 ? "" : content.slice(at)
}

// --- I1 〜 I7 ---------------------------------------------------------------

test("I1: 両ファイルあり — ARCHITECTURE 全文 + 目次 + 直近 5 件 + CLI 案内", () => {
  const root = project({ arch: architecture(), gotchas: gotchas(7) })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content.startsWith(GUIDE)).toBe(true)
  expect(content).toContain("## 技術的前提(docs/ARCHITECTURE.md)")
  expect(content).toContain("## システム概要")
  expect(content).toContain(
    "上から UI・アプリケーション・ドメインの 3 層とする。"
  )
  expect(content).toContain("## 既知の落とし穴(docs/GOTCHAS.md: 全 7 件)")
  expect(content).toContain("### 目次(新しい順)")
  expect(content).toContain("- [2026-08-16] GOTCHA-007: 失敗 7 のタイトル")
  expect(content).toContain("### 直近 5 件(全文)")

  const recent = recentBlock(content)
  for (const n of [7, 6, 5, 4, 3]) {
    expect(recent).toContain(
      `### [2026-08-16] GOTCHA-00${n}: 失敗 ${n} のタイトル`
    )
  }
  expect(recent).not.toContain("GOTCHA-002")
})

test("I2: GOTCHAS 無し — ARCHITECTURE のみ、例外なし", () => {
  const root = project({ arch: architecture() })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.startsWith(GUIDE)).toBe(true)
  expect(content).toContain("## 技術的前提(docs/ARCHITECTURE.md)")
  expect(content).not.toContain("既知の落とし穴")
})

// 設計書 §8-7 の「何も出力しない」は「**文書の内容を**出力しない」の意味に限定する。
// CLI 案内まで落とすと、AI は CLI の絶対パスを知る手段が無く `/metatron:init` を開始できない
// (§3-3・§8-3 の「CLI の発見性はモデルコンテキストで担保する」と両立しない)。
test("I3: 両方無し — CLI 案内だけを出力する(/metatron:init への言及つき)", () => {
  const root = project({})
  const content = inject(root)
  if (content === null) throw new Error("CLI 案内が注入されなかった")
  expect(content).toBe(`${INIT_GUIDE}\n`)
  expect(content).toContain("/metatron:init")
  expect(content).toContain(`M = ${CLI}`)
  // 文書が無いのだから、文書の内容に由来する見出しは 1 つも出ない。
  expect(content).not.toContain("## 技術的前提")
  expect(content).not.toContain("## 既知の落とし穴")
})

test("I3b: injection.enabled: false かつ両方無し — 何も出力しない", () => {
  const root = project({
    config: { version: 1, injection: { enabled: false } }
  })
  expect(inject(root)).toBe(null)
})

// 設定の読み取り自体が例外で失敗したときは案内も出さない。
// 機構が壊れている状態で出すと、誤った CLI パスを広告しかねないためである。
// loadConfig は例外を投げない契約なので、モジュール解決の層で故障を注入する。
test("I3c: 設定の読み取りが例外 — 案内も含め何も出力しない", () => {
  // 文書が揃っていて本来なら必ず注入される状態でも、出力が止まることを確かめる。
  const root = project({ arch: architecture(), gotchas: gotchas(3) })
  expect(inject(root)).not.toBe(null) // 故障注入なしなら出る
  expect(
    inject(root, {
      NODE_OPTIONS: `--import ${pathToFileURL(FAULT_CONFIG).href}`
    })
  ).toBe(null)
})

test("I4: 壊れた設定 — 既定値で注入し、警告を 1 行添える", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: '{ "version": 1, "paths": '
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.startsWith(GUIDE)).toBe(true)
  expect(content).toContain("※注意: 設定を読めなかったため既定値を使用します。")
  // 既定パスで解決されている
  expect(content).toContain("## 技術的前提(docs/ARCHITECTURE.md)")
})

// 文書が 1 つも無い分岐でも、設定由来の理由(壊れた設定・未知 version・パス不正)は
// 呼び出し元へ返す(契約 §2)。理由を伏せたまま「文書が無い」とだけ案内すると、
// 独自パスへ文書を置いた利用者は見失った原因が分からず、既定パスへ重複して作りかねない。
test("I4b: 壊れた設定 + 両方無し — CLI 案内に続けて設定の警告が出る", () => {
  const root = project({ config: '{ "version": 1, "paths": ' })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toBe(
    `${INIT_GUIDE}\n\n※注意: 設定を読めなかったため既定値を使用します。\n`
  )
})

test("I4c: 未知 version + 両方無し — CLI 案内に続けて設定の警告が出る", () => {
  const root = project({ config: { version: 2 } })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toBe(
    `${INIT_GUIDE}\n\n※注意: 設定の version(2)が未知のため、全項目に既定値を使用します。\n`
  )
})

test("I4d: paths が絶対パス + 既定パスにも文書なし — 拒否の理由が出る", () => {
  const root = project({
    config: { version: 1, paths: { architecture: "/tmp/metatron-abs/arch.md" } }
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toBe(
    `${INIT_GUIDE}\n\n※注意: paths.architecture が絶対パス(/tmp/metatron-abs/arch.md)のため、` +
      "既定値 docs/ARCHITECTURE.md を使用します。" +
      "マシン固有の絶対パスはリポジトリの可搬性を失わせるため受け付けません。\n"
  )
})

// 設定ファイルが無いのも、正しい設定があるのも正常な状態であり、警告にしない(契約 §2)。
test("I4e: 正常な設定 + 両方無し — CLI 案内のみで警告は出ない", () => {
  const root = project({
    config: { version: 1, injection: { maxChars: 9000 } }
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toBe(`${INIT_GUIDE}\n`)
  expect(content).not.toContain("※注意:")
})

test("I5: injection.enabled: false — 何も出力しない", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: { version: 1, injection: { enabled: false } }
  })
  expect(inject(root)).toBe(null)
})

test("I6: エントリ 3 件(N=5 未満)— 3 件全部を全文、破綻しない", () => {
  const root = project({ arch: architecture(), gotchas: gotchas(3) })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toContain("## 既知の落とし穴(docs/GOTCHAS.md: 全 3 件)")
  expect(content).toContain("### 直近 3 件(全文)")
  const recent = recentBlock(content)
  for (const n of [3, 2, 1]) {
    expect(recent).toContain(`### [2026-08-16] GOTCHA-00${n}:`)
  }
})

test("I7: 無効化済みが直近に含まれる — 全文対象から除外し、その分遡って埋める", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(7, [7, 6])
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  // 目次には打ち消し線 + タグで残る
  expect(content).toContain(
    "- [2026-08-16] GOTCHA-007: ~~失敗 7 のタイトル~~([解決済み])"
  )
  expect(content).toContain(
    "- [2026-08-16] GOTCHA-006: ~~失敗 6 のタイトル~~([解決済み])"
  )

  const recent = recentBlock(content)
  expect(recent).toContain("### 直近 5 件(全文)")
  expect(recent).not.toContain("GOTCHA-007")
  expect(recent).not.toContain("GOTCHA-006")
  for (const n of [5, 4, 3, 2, 1]) {
    expect(recent).toContain(`### [2026-08-16] GOTCHA-00${n}:`)
  }
})

// --- I8 / I9 / I13(不変条件)------------------------------------------------

const BUDGETS = [9000, 4000, 2500, 2000, 1500, 1000]

// 削れない部分の長さは CLI の絶対パス(チェックアウトの場所)で変わる。
// そのため予算と削れない部分の大小は実行時に比べ、小さい予算は I8b で別に扱う。
test("I8: 削れない部分以上の予算では maxChars 以下に収まり、10,000 を超えない", () => {
  const cases = [
    { arch: architecture(1), gotchas: gotchas(3) },
    { arch: architecture(40), gotchas: gotchas(200, [], 200) },
    { arch: hugeArchitecture(20, 1200), gotchas: gotchas(400, [3, 5], 400) },
    { arch: hugeArchitecture(3, 40), gotchas: gotchas(1) }
  ]
  const budgets = BUDGETS.filter((b) => b >= GUIDE_OUTPUT_LENGTH)
  // 予算の絞り込みで検査が空にならないこと(素通しの検証にしない)
  expect(budgets.length).toBeGreaterThan(2)
  for (const fixture of cases) {
    for (const maxChars of budgets) {
      const root = project({ ...fixture, config: configWith(maxChars) })
      const content = inject(root)
      if (content === null) throw new Error("注入されなかった")
      expect(content.length).toBeLessThanOrEqual(maxChars)
      expect(content.length).toBeLessThanOrEqual(10_000)
    }
  }
})

test("I8b: 削れない部分より小さい予算では、削れない部分だけを出す", () => {
  const budgets = [
    ...BUDGETS.filter((b) => b < GUIDE_OUTPUT_LENGTH),
    GUIDE_OUTPUT_LENGTH - 1
  ]
  for (const maxChars of budgets) {
    const root = project({
      arch: hugeArchitecture(3, 40),
      gotchas: gotchas(1),
      config: configWith(maxChars)
    })
    const content = inject(root)
    if (content === null) throw new Error("注入されなかった")
    expect(content).toBe(`${GUIDE}\n`)
    expect(content.length).toBeLessThanOrEqual(10_000)
  }
})

test("I9: CLI 案内は常に出力の先頭にある", () => {
  for (const maxChars of BUDGETS) {
    const root = project({
      arch: hugeArchitecture(12, 800),
      gotchas: gotchas(120, [], 300),
      config: configWith(maxChars)
    })
    const content = inject(root)
    if (content === null) throw new Error("注入されなかった")
    expect(content.indexOf(GUIDE)).toBe(0)
  }
})

test("I13: 縮退の全段階で CLI 案内が完全な形で残る", () => {
  const seen = new Set<string>()
  for (const maxChars of [...BUDGETS, 900, 800]) {
    const root = project({
      arch: hugeArchitecture(12, 800),
      gotchas: gotchas(120, [], 300),
      config: configWith(maxChars)
    })
    const content = inject(root)
    if (content === null) throw new Error("注入されなかった")
    expect(content.startsWith(GUIDE)).toBe(true)
    seen.add(
      `${content.includes("### 直近")}/${content.includes("### 目次")}/${content.includes("ほか")}/${content.includes("- ADR-")}/${content.includes("を Read すること")}`
    )
  }
  // 予算を変えることで実際に複数の段階を通っていること(素通しの検証にしない)
  expect(seen.size).toBeGreaterThan(2)
})

test("I13b: 記録のタイミングと委譲の注意は CLI 案内の直後にあり、縮退の最終段階でも残る", () => {
  // 最終段階(ARCHITECTURE は Read の案内だけ、GOTCHAS は目次なし)を踏む予算を、
  // 削れない部分の長さから組み立てる。
  const root = project({
    arch: hugeArchitecture(12, 800),
    gotchas: gotchas(120, [], 300),
    config: configWith(GUIDE_OUTPUT_LENGTH + 250)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toContain(
    `全文は ${path.join(root, "docs/ARCHITECTURE.md")} を Read すること。`
  )
  expect(content).not.toContain("### 目次")
  expect(content.startsWith(`${GUIDE}\n\n`)).toBe(true)
  expect(content).toContain(
    `※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。\n${[...RECORDING_LINES, ...DELEGATION_LINES].join("\n")}`
  )
})

test("I13c: 文書が無いときの案内には記録のタイミングも委譲の注意も載せない", () => {
  const root = project({})
  for (const features of COMBOS) {
    const content = inject(root, {}, features)
    if (content === null)
      throw new Error(`${label(features)}: 注入されなかった`)
    for (const line of ALL_SESSION_ONLY_LINES) {
      expect(content, label(features)).not.toContain(line)
    }
  }
})

test("I13d: 記録のタイミングは 4 通りの組み合わせのどれでも合計 200 文字以内", () => {
  for (const features of COMBOS) {
    expect(
      recordingLinesFor(features).join("\n").length,
      label(features)
    ).toBeLessThanOrEqual(200)
  }
  // 両方無効では 1 行も出さない
  expect(recordingLinesFor({ adr: false, gotchas: false })).toEqual([])
})

// 出力が maxChars を超えるが、これは仕様であって不具合ではない。CLI 案内は縮退の対象外であり
//(§8-5)、破ってはならない真の上限はプラットフォームの 10,000 文字だけである(§8-3)。
test("CLI 案内が maxChars より長い場合は maxChars を超えてでも案内を残す(仕様)", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: configWith(200)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toBe(`${GUIDE}\n`)
  // maxChars を超えていること自体を固定する(超えない実装への退行はこの規律の破壊にあたる)
  expect(content.length).toBeGreaterThan(200)
  expect(content.length).toBeLessThanOrEqual(10_000)
})

// --- I10 / I10b / I11 / I12(段階縮退)---------------------------------------

test("I10: 予算超過(GOTCHAS 巨大)— 段階 1→2 の順で削られ、ARCHITECTURE は全文が保たれる", () => {
  const root = project({
    arch: architecture(0),
    gotchas: gotchas(200),
    config: configWith(4000)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content.length).toBeLessThanOrEqual(4000)
  // 段階 1: 直近の全文が 0 件まで削られている
  expect(content).not.toContain("### 直近")
  // 段階 2: 目次が 50 件に制限され、残りの取得方法が案内される
  expect(content).toContain(
    "- ほか 150 件は `node M get gotchas` で取得すること。"
  )
  expect(content).toContain("- [2026-08-16] GOTCHA-200: 失敗 200 のタイトル")
  expect(content).not.toContain("GOTCHA-150:")
  // ARCHITECTURE は全文のまま(Mermaid ごと)
  expect(content).toContain("```mermaid")
  expect(content).toContain(
    "上から UI・アプリケーション・ドメインの 3 層とする。"
  )
  expect(content).not.toContain("を Read すること")
})

test("I10b: 予算超過(ADR 多数)— 段階 3 で ADR 一覧が全廃され、レイヤー構造 / 保護パス は残る", () => {
  const root = project({
    arch: architecture(40),
    gotchas: gotchas(3),
    config: configWith(2000)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content.length).toBeLessThanOrEqual(2000)
  expect(content).toContain(
    "ADR 一覧は割愛した。`node M get adr` で取得すること。"
  )
  expect(content).not.toContain("- ADR-001:")
  expect(content).not.toContain("## ADR 一覧")
  // 振る舞いを直接変える節は最後まで残す
  expect(content).toContain("## レイヤー構造")
  expect(content).toContain(
    "上から UI・アプリケーション・ドメインの 3 層とする。"
  )
  expect(content).toContain("## 保護パス")
  expect(content).toContain(
    "- docs/ARCHITECTURE.md は metatron の管理下にある。"
  )
  // 段階 4 には進んでいない(全文が保たれている)
  expect(content).toContain("```mermaid")
})

test("I11: 予算超過(ARCHITECTURE 巨大)— 段階 4 で目次 + 要約に縮退し、文の途中で切れない", () => {
  const root = project({
    arch: hugeArchitecture(10, 600),
    gotchas: gotchas(3),
    config: configWith(2500)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content.length).toBeLessThanOrEqual(2500)
  expect(content).toContain(
    `全文は ${path.join(root, "docs/ARCHITECTURE.md")} を Read すること(以下は目次と各節の要約 1 行)。`
  )
  // 要約はフェンス外の最初の散文行。文の途中では切らない(句点で終わる)
  expect(content).toContain(
    "- システム概要: この擬似プロジェクトは注入 hook の検証のために置いてある。"
  )
  // 表の行は採らない
  expect(content).toContain("- 技術スタック: Node 26 と pnpm を使う。")
  expect(content).not.toContain("| 言語 | TypeScript |")
  // Mermaid の中身も採らない
  expect(content).not.toContain("```mermaid")
  expect(content).not.toContain("graph TD")
  for (const line of content.split("\n")) {
    if (line.startsWith("- 追加の節 ")) expect(line.endsWith("。")).toBe(true)
  }
})

test("I11b: 段階 4 — 先頭パイプの無い表だけの節は要約を持たず、見出しのみへフォールバックする", () => {
  const root = project({
    arch: tableArchitecture(),
    gotchas: gotchas(3),
    config: configWith(2500)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content).toContain("(以下は目次と各節の要約 1 行)。")
  // 表のヘッダー行は散文ではない。要約に採らない
  expect(content).toContain("- 表だけの節\n")
  expect(content).not.toContain("- 表だけの節:")
  expect(content).not.toContain("Language | Framework")
  expect(content).not.toContain("TypeScript | Node")
})

test("I11c: 段階 4 — 表の後に散文行がある節は、表を飛ばして散文行を要約に採る", () => {
  const root = project({
    arch: tableArchitecture(),
    gotchas: gotchas(3),
    config: configWith(2500)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content).toContain(
    "- 表のあとに散文がある節: 表のあとに置いた散文行である。"
  )
})

test("I12: 極端な超過(両方巨大)— 段階 5 まで進み、それでも maxChars 以下に収まる", () => {
  const root = project({
    arch: hugeArchitecture(10, 600),
    gotchas: gotchas(200, [], 200),
    config: configWith(2200)
  })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content.length).toBeLessThanOrEqual(2200)
  expect(content.startsWith(GUIDE)).toBe(true)
  expect(content).not.toContain("### 目次")
  expect(content).toContain("一覧は `node M get gotchas` で取得すること。")
  expect(content).toContain("を Read すること")
})

// --- I14 〜 I21 -------------------------------------------------------------

// 読めないファイルは「無い」として扱う(§8-7)。例外を投げないこと、そして
// 文書の内容が 1 行も漏れないことを見る。CLI 案内は I3 と同じ理由で残る。
test("I14: 読み取り権限なし — 例外を投げず、CLI 案内だけを出力する", () => {
  const root = project({ arch: architecture(), gotchas: gotchas(3) })
  if (process.getuid?.() === 0) return // root は権限を無視するため検証にならない
  fs.chmodSync(path.join(root, "docs/ARCHITECTURE.md"), 0o000)
  fs.chmodSync(path.join(root, "docs/GOTCHAS.md"), 0o000)
  try {
    const content = inject(root)
    if (content === null) throw new Error("CLI 案内が注入されなかった")
    expect(content).toBe(`${INIT_GUIDE}\n`)
    expect(content).not.toContain("## システム概要")
    // 案内の例示にも GOTCHA-003 は出るので、GOTCHAS の中身に固有の文字列で見る。
    expect(content).not.toContain("失敗 3 のタイトル")
  } finally {
    fs.chmodSync(path.join(root, "docs/ARCHITECTURE.md"), 0o644)
    fs.chmodSync(path.join(root, "docs/GOTCHAS.md"), 0o644)
  }
})

test("I15: 注入文中の CLI パスは絶対パスで、metatron.mjs を指す", () => {
  const root = project({ arch: architecture() })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(path.isAbsolute(CLI)).toBe(true)
  expect(content).toContain(`M = ${CLI}`)
  expect(CLI.endsWith(`${path.sep}scripts${path.sep}metatron.mjs`)).toBe(true)
  // 組み立て規則(プラグインルート + /scripts/metatron.mjs)が正しいことを、
  // ビルド成果物の有無に依存せず確かめる。
  expect(
    fs.existsSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"))
  ).toBe(true)
  expect(fs.existsSync(path.join(PLUGIN_ROOT, "build.ts"))).toBe(true)
  if (fs.existsSync(path.join(PLUGIN_ROOT, "scripts"))) {
    // ビルド済みの環境では実体も指していること
    expect(fs.existsSync(CLI)).toBe(true)
  }
})

test("I16: CLI 呼び出しは --input <path> 形式で書かれている", () => {
  const root = project({ arch: architecture() })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toContain("node M append-gotcha --input <一時ファイル>")
  expect(content).toContain("node M stage-architecture --input <一時ファイル>")
  expect(content).toContain("node M stage-adr --input <一時ファイル>")
  expect(content).toContain("--input <path> で渡す")
})

test("I17: 縮退時の Read 案内は解決済みの実パスを指す(設定変更に追随)", () => {
  const root = project({
    config: {
      version: 1,
      paths: { architecture: "documents/arch.md", gotchas: "documents/g.md" },
      injection: { maxChars: 2500 }
    }
  })
  write(root, "documents/arch.md", hugeArchitecture(10, 600))
  write(root, "documents/g.md", gotchas(3))

  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content).toContain("## 技術的前提(documents/arch.md)")
  expect(content).toContain("## 既知の落とし穴(documents/g.md: 全 3 件)")
  expect(content).toContain(
    `全文は ${path.join(root, "documents/arch.md")} を Read すること`
  )
  expect(content).not.toContain("docs/ARCHITECTURE.md を Read")
})

test("I18: Mermaid を含む ARCHITECTURE — セクション分割が CLI と一致し、図が途中で切れない", () => {
  const arch = architecture(0)
  const root = project({ arch, gotchas: gotchas(2) })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  // 同一パーサ(lib)が切り出す範囲と、注入に載る範囲が一致すること
  const doc = parseArchitecture(
    fs.readFileSync(path.join(root, "docs/ARCHITECTURE.md"), "utf8")
  )
  const overview = findSection(doc, "システム概要")
  if (overview === undefined) throw new Error("システム概要が分解できていない")
  expect(content).toContain(overview.raw.replace(/\s+$/, ""))

  // フェンス内の `## ` は見出しにされない
  expect(doc.sections.map((s) => s.heading)).toEqual([
    "システム概要",
    "技術スタック",
    "レイヤー構造",
    "保護パス"
  ])
  expect(content).toContain("## これは見出しではない")
  const fences = content.split("```").length - 1
  expect(fences % 2).toBe(0)
})

test("I19: ADR は予算に余裕があっても全文で載らず、タイトル + 状態のみ", () => {
  const root = project({ arch: architecture(2), gotchas: gotchas(2) })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")

  expect(content).toContain("## ADR 一覧")
  expect(content).toContain("- ADR-001: 記録の置き場を決める 1(採用)")
  expect(content).toContain("- ADR-002: 記録の置き場を決める 2(採用)")
  expect(content).toContain(
    "ADR の全文は `node M get adr` で取得すること(注入には載せない)。"
  )
  expect(content).not.toContain("#### 背景")
  expect(content).not.toContain("DB に置くと差分レビューができない。")
})

test("I20: 未閉フェンスの ARCHITECTURE — 注入は継続し、警告が 1 行付く", () => {
  const arch = md([
    "# ARCHITECTURE",
    "",
    "## システム概要",
    "",
    "未閉フェンスを持つ文書である。",
    "",
    "```ts",
    "const a = 1",
    "",
    "## 技術スタック",
    "",
    "TypeScript を使う。"
  ])
  const root = project({ arch, gotchas: gotchas(2) })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.startsWith(GUIDE)).toBe(true)
  expect(content).toContain(`※注意: ${UNCLOSED_FENCE_WARNING}`)
  expect(content).toContain("未閉フェンスを持つ文書である。")
})

test("I21: CLI 案内は get adr / stage-adr / tag-gotcha / commit-architecture を含む", () => {
  const root = project({ arch: architecture(), gotchas: gotchas(2) })
  const content = inject(root)
  if (content === null) throw new Error("注入されなかった")
  for (const fragment of [
    "node M get gotchas",
    "node M get adr",
    "node M get architecture",
    "node M append-gotcha --input",
    "node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason",
    "node M stage-architecture --input",
    "node M stage-adr --input",
    "node M commit-architecture --staging-id <id>"
  ]) {
    expect(content).toContain(fragment)
  }
})

test("I22: CLI 案内は get rules / stage-rules / commit-rules を含む", () => {
  const root = mkTmp()
  write(root, "docs/ARCHITECTURE.md", architecture())

  const out = inject(root)
  expect(out).not.toBeNull()
  expect(out).toContain("get rules")
  expect(out).toContain("stage-rules --input")
  expect(out).toContain("commit-rules --staging-id")
})

test("I23: rules 本文は注入されない(metatron は rules を読まない)", () => {
  const root = mkTmp()
  write(root, "docs/ARCHITECTURE.md", architecture())
  write(
    root,
    ".claude/rules/metatron/conventions.md",
    "# 規約\n\nRULES-BODY-TOKEN\n"
  )

  const out = inject(root)
  expect(out).not.toBeNull()
  expect(out).not.toContain("RULES-BODY-TOKEN")
})

// --- SubagentStart(設計書 2026-10-04 の 3)------------------------------------

/** サブエージェント向けに出てはならない、SessionStart 向けの要素。 */
function expectNoSessionOnlyParts(content: string): void {
  expect(content).not.toContain("node M")
  expect(content).not.toContain(CLI)
  expect(content).not.toContain("記録・更新・全文取得は次の CLI を使う")
  for (const line of ALL_SESSION_ONLY_LINES) {
    expect(content).not.toContain(line)
  }
}

test("S1: SubagentStart — 見出しと読むだけの 1 行の後に、ARCHITECTURE・ADR 一覧・GOTCHAS の目次と直近が出る", () => {
  const root = project({ arch: architecture(2), gotchas: gotchas(7) })
  const content = injectSubagent(root)
  if (content === null) throw new Error("注入されなかった")
  const archPath = path.join(root, "docs/ARCHITECTURE.md")

  expect(content.startsWith(`${SUBAGENT_GUIDE}\n\n`)).toBe(true)
  expectNoSessionOnlyParts(content)
  expect(content).toContain("## 技術的前提(docs/ARCHITECTURE.md)")
  expect(content).toContain(
    "上から UI・アプリケーション・ドメインの 3 層とする。"
  )
  expect(content).toContain("## ADR 一覧")
  expect(content).toContain("- ADR-001: 記録の置き場を決める 1(採用)")
  expect(content).toContain(
    `ADR の全文は ${archPath} の \`## ADR 一覧\` を Read すること(注入には載せない)。`
  )
  expect(content).not.toContain("DB に置くと差分レビューができない。")
  expect(content).toContain("## 既知の落とし穴(docs/GOTCHAS.md: 全 7 件)")
  expect(content).toContain("### 目次(新しい順)")
  expect(content).toContain("### 直近 5 件(全文)")

  // 直近の全文には新しい 5 件の見出しと本文が入り、それより古いエントリは入らない
  const recent = recentBlock(content)
  for (const n of [7, 6, 5, 4, 3]) {
    expect(recent).toContain(
      `### [2026-08-16] GOTCHA-00${n}: 失敗 ${n} のタイトル`
    )
    expect(recent).toContain(`**失敗内容**: 失敗 ${n} の内容`)
    expect(recent).toContain(`**原因 (推測)**: 原因 ${n}`)
  }
  for (const n of [2, 1]) {
    expect(recent).not.toContain(`GOTCHA-00${n}`)
    expect(recent).not.toContain(`失敗 ${n} の内容`)
  }
})

test("S2: SubagentStart で文書が無い — 何も出力しない(設定の警告があっても出さない)", () => {
  expect(injectSubagent(project({}))).toBe(null)
  expect(injectSubagent(project({ config: '{ "version": 1, "paths": ' }))).toBe(
    null
  )
})

test("S3: SubagentStart で injection.enabled: false — 何も出力しない", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: { version: 1, injection: { enabled: false } }
  })
  expect(injectSubagent(root)).toBe(null)
})

test("S4: SubagentStart の設定の警告は SessionStart と同じく載る", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: '{ "version": 1, "paths": '
  })
  const content = injectSubagent(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.startsWith(SUBAGENT_GUIDE)).toBe(true)
  expect(content).toContain("※注意: 設定を読めなかったため既定値を使用します。")
})

test("S5: SubagentStart で目次から外れた GOTCHAS は、台帳の絶対パスを Read する案内になる", () => {
  const root = project({
    arch: architecture(0),
    gotchas: gotchas(200),
    config: configWith(4000)
  })
  const content = injectSubagent(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.length).toBeLessThanOrEqual(4000)
  expect(content).not.toContain("### 直近")
  expect(content).toContain(
    `- ほか 150 件は ${path.join(root, "docs/GOTCHAS.md")} を Read すること。`
  )
  expectNoSessionOnlyParts(content)
})

test("S6: SubagentStart で ADR 一覧を割愛したときは、ARCHITECTURE の `## ADR 一覧` を Read する案内になる", () => {
  const root = project({
    arch: architecture(40),
    gotchas: gotchas(3),
    config: configWith(1500)
  })
  const content = injectSubagent(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.length).toBeLessThanOrEqual(1500)
  expect(content).toContain(
    `ADR 一覧は割愛した。${path.join(root, "docs/ARCHITECTURE.md")} の \`## ADR 一覧\` を Read すること。`
  )
  expect(content).not.toContain("- ADR-001:")
  expect(content).toContain("```mermaid")
  expectNoSessionOnlyParts(content)
})

test("S7: SubagentStart で目次まで割愛したときは、台帳の絶対パスを Read する案内になる", () => {
  const root = project({
    arch: hugeArchitecture(10, 600),
    gotchas: gotchas(200, [], 200),
    config: configWith(1200)
  })
  const content = injectSubagent(root)
  if (content === null) throw new Error("注入されなかった")
  expect(content.length).toBeLessThanOrEqual(1200)
  expect(content).not.toContain("### 目次")
  expect(content).toContain(
    `一覧は ${path.join(root, "docs/GOTCHAS.md")} を Read すること。`
  )
  expectNoSessionOnlyParts(content)
})

test("S8: SubagentStart は削れない部分以上の予算で maxChars 以下に収まり、先頭に削れない部分がある", () => {
  for (const maxChars of [...BUDGETS, 500, SUBAGENT_GUIDE.length + 1]) {
    const root = project({
      arch: hugeArchitecture(12, 800),
      gotchas: gotchas(120, [], 300),
      config: configWith(maxChars)
    })
    const content = injectSubagent(root)
    if (content === null) throw new Error("注入されなかった")
    expect(content.startsWith(SUBAGENT_GUIDE)).toBe(true)
    expect(content.length).toBeLessThanOrEqual(maxChars)
    expectNoSessionOnlyParts(content)
  }
})

test("S9: SubagentStart で削れない部分より小さい予算では、削れない部分だけを出す", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: configWith(10)
  })
  expect(injectSubagent(root)).toBe(`${SUBAGENT_GUIDE}\n`)
})

test("S10: hook_event_name が無い・文字列でない入力は SessionStart として扱う", () => {
  const root = project({ arch: architecture(), gotchas: gotchas(3) })
  for (const eventName of [undefined, 123, null]) {
    const input: Record<string, unknown> = { session_id: "s1", cwd: root }
    if (eventName !== undefined) input.hook_event_name = eventName
    const result = runHook(root, input, BOTH_ON)
    if (result === null) throw new Error("注入されなかった")
    expect(result.eventName).toBe("SessionStart")
    expect(result.content.startsWith(GUIDE)).toBe(true)
  }
})

// maxChars の値域は 10,000 を超える値も受け付ける。組み立ての予算はプラットフォームの上限で頭打ちにする。
test("I24・S11: maxChars が 10,000 を超えても、両イベントの出力は 10,000 文字以下に収まる", () => {
  // ARCHITECTURE だけで 15,000 文字を超え、maxChars をそのまま予算にすると上限を破る入力
  const arch = hugeArchitecture(25, 600)
  expect(arch.length).toBeGreaterThan(15_000)
  const root = project({
    arch,
    gotchas: gotchas(30, [], 100),
    config: configWith(20_000)
  })

  const session = inject(root)
  if (session === null) throw new Error("SessionStart で注入されなかった")
  expect(session.startsWith(GUIDE)).toBe(true)
  expect(session.length).toBeLessThanOrEqual(10_000)

  const subagent = injectSubagent(root)
  if (subagent === null) throw new Error("SubagentStart で注入されなかった")
  expect(subagent.startsWith(SUBAGENT_GUIDE)).toBe(true)
  expect(subagent.length).toBeLessThanOrEqual(10_000)
})

// --- 2 変数による注入の切り替え(設計書 2026-10-08 の 3・受け入れ基準 A1〜A3)--------

/** 無効な側の内容と記録を促す行が 1 つも出ていないこと(A1)。 */
function expectDisabledPartsAbsent(content: string, features: Features): void {
  const where = label(features)
  if (!features.adr) expect(content, where).not.toMatch(/ADR/)
  if (!features.gotchas) expect(content, where).not.toMatch(/gotcha/i)
}

test("V0: 両方有効の変種は改修前の固定文字列と一致する(A2)", () => {
  expect(guideFor(BOTH_ON)).toBe(GUIDE)
  expect(subagentGuideFor(BOTH_ON)).toBe(SUBAGENT_GUIDE)
  expect(initGuideFor(BOTH_ON)).toBe(INIT_GUIDE)
})

test("V1: SessionStart — 4 通りの組み合わせで削れない部分が 3-1 の文面になり、無効な側の内容が出ない", () => {
  const root = project({ arch: architecture(2), gotchas: gotchas(7) })
  for (const features of COMBOS) {
    const where = label(features)
    const content = inject(root, {}, features)
    if (content === null) throw new Error(`${where}: 注入されなかった`)
    expect(content.startsWith(`${guideFor(features)}\n\n`), where).toBe(true)
    expect(content, where).toContain("## 技術的前提(docs/ARCHITECTURE.md)")
    expectDisabledPartsAbsent(content, features)
    if (features.adr) {
      expect(content, where).toContain(
        "- ADR-001: 記録の置き場を決める 1(採用)"
      )
    }
    if (features.gotchas) {
      expect(content, where).toContain(
        "## 既知の落とし穴(docs/GOTCHAS.md: 全 7 件)"
      )
      expect(content, where).toContain("### 直近 5 件(全文)")
    }
  }
})

test("V2: SubagentStart — 4 通りの組み合わせで SessionStart と同じ規則に従う", () => {
  const root = project({ arch: architecture(2), gotchas: gotchas(7) })
  for (const features of COMBOS) {
    const where = label(features)
    const content = injectSubagent(root, features)
    if (content === null) throw new Error(`${where}: 注入されなかった`)
    expect(content.startsWith(`${subagentGuideFor(features)}\n\n`), where).toBe(
      true
    )
    expectNoSessionOnlyParts(content)
    expectDisabledPartsAbsent(content, features)
    expect(content, where).toContain(
      "上から UI・アプリケーション・ドメインの 3 層とする。"
    )
    if (features.adr) expect(content, where).toContain("## ADR 一覧")
    if (features.gotchas)
      expect(content, where).toContain("### 直近 5 件(全文)")
  }
})

test("V3: 文書が無いときの案内は 4 通りの組み合わせで 3-1 の文面になる", () => {
  const root = project({})
  for (const features of COMBOS) {
    expect(inject(root, {}, features), label(features)).toBe(
      `${initGuideFor(features)}\n`
    )
  }
})

test("V4: GOTCHAS.md だけがあり GOTCHAS が無効なら文書ゼロとして扱う", () => {
  const root = project({ gotchas: gotchas(3) })
  for (const features of COMBOS) {
    const where = label(features)
    const session = inject(root, {}, features)
    const subagent = injectSubagent(root, features)
    if (features.gotchas) {
      expect(session?.startsWith(`${guideFor(features)}\n\n`), where).toBe(true)
      expect(subagent, where).toContain("### 直近 3 件(全文)")
    } else {
      expect(session, where).toBe(`${initGuideFor(features)}\n`)
      expect(subagent, where).toBe(null)
    }
  }
})

test("V5: ADR が無効なら、縮退で ADR 一覧を割愛する予算でも割愛の案内を出さない", () => {
  const root = project({
    arch: architecture(40),
    gotchas: gotchas(3),
    config: configWith(2000)
  })
  for (const features of COMBOS.filter((f) => !f.adr)) {
    const session = inject(root, {}, features)
    const subagent = injectSubagent(root, features)
    if (session === null || subagent === null)
      throw new Error(`${label(features)}: 注入されなかった`)
    for (const content of [session, subagent]) {
      expect(content.length).toBeLessThanOrEqual(2000)
      expect(content).not.toContain("割愛した")
      expectDisabledPartsAbsent(content, features)
      // ADR 一覧を出さない分、ARCHITECTURE の本文は全文で残る
      expect(content).toContain("```mermaid")
    }
  }
})

test("V6: どの組み合わせでも、予算が足りなければ削れない部分だけが完全な形で残る", () => {
  const root = project({
    arch: architecture(),
    gotchas: gotchas(3),
    config: configWith(10)
  })
  for (const features of COMBOS) {
    expect(inject(root, {}, features), label(features)).toBe(
      `${guideFor(features)}\n`
    )
    expect(injectSubagent(root, features), label(features)).toBe(
      `${subagentGuideFor(features)}\n`
    )
  }
})

test("V7: 2 変数が未設定の環境では ADR・GOTCHAS の内容も記録を促す行も出ない(A1)", () => {
  const root = project({ arch: architecture(3), gotchas: gotchas(5) })
  const none = { adr: false, gotchas: false }
  const session = inject(root, {}, none)
  const subagent = injectSubagent(root, none)
  if (session === null || subagent === null) throw new Error("注入されなかった")
  for (const content of [session, subagent]) {
    expect(content).not.toMatch(/ADR/)
    expect(content).not.toMatch(/gotcha/i)
    expect(content).not.toContain("依頼の完了報告の前に")
    expect(content).not.toContain("既知の落とし穴")
  }
})
