// SessionStart 注入 hook の検証。
// ケース ID は metatron 設計書 §13-1 の inject-context.ts の表(I1〜I21・I10b)に対応する。
// 形式の正本はファイル契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §12。
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
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-context.ts", import.meta.url))
const PLUGIN_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url))
)
const CLI = path.join(PLUGIN_ROOT, "scripts", "metatron.mjs")

// 実装と同じ文面を独立に持つ。CLI 案内は縮退で一切変えてはならない要素なので、
// 「完全な形で残る」を部分一致ではなく全文一致で確かめる(I13)。
const GUIDE = [
  "# metatron: プロジェクトの前提と落とし穴",
  "",
  "これらの文書は metatron の管理下にある。**直接編集は PreToolUse hook が拒否する。**",
  `記録・更新・全文取得は次の CLI を使う(絶対パス。M = ${CLI}):`,
  "  読む:     node M get gotchas --query <語> / node M get adr / node M get architecture",
  "  記録:     node M append-gotcha --input <一時ファイル>",
  '  タグ:     node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "..."',
  "  文書更新: node M stage-architecture --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "  ADR:     node M stage-adr --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。",
  "※この案内はメインセッション向け。サブエージェントには別途パスが渡される。"
].join("\n")

// 文書がまだ 1 つも無いときの案内(設計書 §8-7 の限定)。
// `/metatron:init` はまさにこの状態で使うコマンドなので、案内を落とすと init を始められない。
const INIT_GUIDE = [
  "# metatron: プロジェクトの前提と落とし穴",
  "",
  "このプロジェクトにはまだ ARCHITECTURE も GOTCHAS も無い。**`/metatron:init` で作成する。**",
  "作成後はこれらの文書が metatron の管理下に入り、直接編集は PreToolUse hook が拒否する。",
  `記録・更新・全文取得は次の CLI を使う(絶対パス。M = ${CLI}):`,
  "  読む:     node M get gotchas --query <語> / node M get adr / node M get architecture",
  "  記録:     node M append-gotcha --input <一時ファイル>",
  '  タグ:     node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "..."',
  "  文書更新: node M stage-architecture --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "  ADR:     node M stage-adr --input <一時ファイル> → node M commit-architecture --staging-id <id>",
  "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。",
  "※この案内はメインセッション向け。サブエージェントには別途パスが渡される。"
].join("\n")

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
  return env
}

/** 注入結果の additionalContext。何も出力しなかった場合は null。 */
function inject(cwd: string, extraEnv: NodeJS.ProcessEnv = {}): string | null {
  const out = runTs(HOOK, [], {
    cwd,
    env: { ...childEnv(), ...extraEnv },
    input: JSON.stringify({
      session_id: "s1",
      transcript_path: path.join(cwd, "t.jsonl"),
      cwd,
      hook_event_name: "SessionStart",
      source: "startup"
    })
  })
  if (out.trim() === "") return null
  const parsed = JSON.parse(out) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string }
  }
  expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart")
  return parsed.hookSpecificOutput.additionalContext
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

test("I8: どんな入力でも maxChars 以下に収まり、10,000 を超えない", () => {
  const cases = [
    { arch: architecture(1), gotchas: gotchas(3) },
    { arch: architecture(40), gotchas: gotchas(200, [], 200) },
    { arch: hugeArchitecture(20, 1200), gotchas: gotchas(400, [3, 5], 400) },
    { arch: hugeArchitecture(3, 40), gotchas: gotchas(1) }
  ]
  for (const fixture of cases) {
    for (const maxChars of BUDGETS) {
      const root = project({ ...fixture, config: configWith(maxChars) })
      const content = inject(root)
      if (content === null) throw new Error("注入されなかった")
      expect(content.length).toBeLessThanOrEqual(maxChars)
      expect(content.length).toBeLessThanOrEqual(10_000)
    }
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
