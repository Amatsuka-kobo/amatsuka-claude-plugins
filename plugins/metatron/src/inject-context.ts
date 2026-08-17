#!/usr/bin/env node
// SessionStart 注入 hook。
//
// 仕様の正本は metatron 設計書 §8(注入)と、ファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` §12(hook 出力の形式)。
//
// この層は第 2 層(機構自身の動作)であり、**フェイルオープン**する。
// 読めない・壊れている・例外が出た、のいずれでも**文書の内容**は出力せず exit 0 で終える。
// 注入の失敗が「セッションを開始できない」という不釣り合いに大きな損害へ化けるためである。
//
// 不変条件が 4 つある。実装を変えるときはこれを壊さないこと。
//
// 0. **文書が 1 つも無くても CLI 案内だけは出す(§8-7 の限定)。**
//    `/metatron:init` はまさにその状態で使うコマンドであり、案内を落とすと
//    AI は CLI の絶対パスを知る手段を持たず、init を開始できない。
//    例外は 2 つだけ。`injection.enabled: false`(利用者が明示的に切っている)と、
//    設定の解決が例外で失敗した場合(壊れた機構が誤った CLI パスを広告しないため)。
// 1. **CLI 案内は常に出力の先頭にあり、どの縮退段階でも完全な形で残る。**
//    プラットフォームが 10,000 文字で退避に倒したとき、モデルへ渡るのは先頭のプレビューである。
//    先頭に無ければ、最も短くて最も代替の効かない要素が最初に見えなくなる(設計書 §8-3)。
// 2. **出力の総文字数は maxChars(既定 9000)以下に収めることを目標とする。** 段階縮退を尽くす(§8-5)。
//    ただし maxChars が CLI 案内の長さ(約 700 文字)を下回る場合は CLI 案内を優先し、maxChars を超える。
//    不変条件 1 が maxChars より上位にあるためである(§8-3 の優先 1、§8-5 の
//    「CLI 案内には決して手を付けない」)。破ってはならない真の上限はプラットフォームの
//    10,000 文字であり、これは常に守る。
// 3. **セクション分解は必ず lib のパーサを使う。** 素朴な文字列処理で代替すると、
//    CLI が 1 セクションと見なす範囲と注入が切り出す範囲が食い違い、Mermaid を含む節で壊れる(§8-6)。

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { type AdrEntry, parseAdrDocument } from "./lib/adr.js"
import {
  ADR_HEADING,
  type ArchitectureDocument,
  type ArchitectureSection,
  type FenceScan,
  readArchitectureFile,
  scanFences
} from "./lib/architecture.js"
import { loadConfig, type ResolvedConfig } from "./lib/config.js"
import { injectContext } from "./lib/emit.js"
import { type GotchaEntry, parseGotchas } from "./lib/gotchas.js"

/** 設計書 §8-5 段階 2。目次をこの件数に制限する。 */
const STAGE2_TOC_LIMIT = 50
/** 警告行の上限。予算を食わせないために切り詰める。 */
const MAX_WARNING_LINES = 3
/** stdin が閉じない環境で hook 自体が固まらないようにする保険。 */
const STDIN_TIMEOUT_MS = 2000

// ---------------------------------------------------------------------------
// CLI の絶対パス
// ---------------------------------------------------------------------------

// hook 自身の位置からプラグインルートを求める。ソース(src/)からもバンドル(scripts/)からも
// 1 階層上がプラグインルートになる。これにより、AI は metatron がどこにインストールされて
// いるかを知らなくても CLI を呼べる(契約 §12)。
function pluginRoot(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT
  if (typeof fromEnv === "string" && fromEnv !== "")
    return path.resolve(fromEnv)
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

function metatronCliPath(env: NodeJS.ProcessEnv): string {
  return path.join(pluginRoot(env), "scripts", "metatron.mjs")
}

// ---------------------------------------------------------------------------
// CLI 案内(優先 1・不可欠。縮退で決して手を付けない)
// ---------------------------------------------------------------------------

const GUIDE_TITLE = "# metatron: プロジェクトの前提と落とし穴"

// 呼び出し規約は契約 §11。長い入力は一時ファイルへ書き `--input <path>` で渡す形に統一する。
// 2 つの文面が同じ呼び出し規約を広告するよう、この部分だけは共有する。
function cliLines(cli: string): string[] {
  return [
    `記録・更新・全文取得は次の CLI を使う(絶対パス。M = ${cli}):`,
    "  読む:     node M get gotchas --query <語> / node M get adr / node M get architecture",
    "  記録:     node M append-gotcha --input <一時ファイル>",
    '  タグ:     node M tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "..."',
    "  文書更新: node M stage-architecture --input <一時ファイル> → node M commit-architecture --staging-id <id>",
    "  ADR:     node M stage-adr --input <一時ファイル> → node M commit-architecture --staging-id <id>",
    "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。",
    "※この案内はメインセッション向け。サブエージェントには別途パスが渡される。"
  ]
}

// 文書が 1 つ以上あるときの案内。
function buildGuide(cli: string): string {
  return [
    GUIDE_TITLE,
    "",
    "これらの文書は metatron の管理下にある。**直接編集は PreToolUse hook が拒否する。**",
    ...cliLines(cli)
  ].join("\n")
}

// 文書がまだ 1 つも無いときの案内(設計書 §8-7 の限定)。
// 「metatron の管理下にある」という前提の文は事実に合わないので、
// **まだ文書が無く `/metatron:init` で作れる**ことが分かる文面に差し替える。
function buildInitGuide(cli: string): string {
  return [
    GUIDE_TITLE,
    "",
    "このプロジェクトにはまだ ARCHITECTURE も GOTCHAS も無い。**`/metatron:init` で作成する。**",
    "作成後はこれらの文書が metatron の管理下に入り、直接編集は PreToolUse hook が拒否する。",
    ...cliLines(cli)
  ].join("\n")
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

function trimEnd(text: string): string {
  return text.replace(/\s+$/, "")
}

interface ArchSource {
  doc: ArchitectureDocument
  adrEntries: AdrEntry[]
  warnings: string[]
}

interface GotchasSource {
  entries: GotchaEntry[]
  warnings: string[]
}

// 存在しない・読めない・中身が空白だけ、はいずれも「無い」として扱う。
// readArchitectureFile は ENOENT を黙って、それ以外の読み取り失敗を warnings に積む。
function readArchitecture(config: ResolvedConfig): ArchSource | null {
  const file = readArchitectureFile(config.architecturePath)
  if (!file.exists) return null
  if (file.text.trim() === "") return null
  return {
    doc: file.doc,
    adrEntries: parseAdrDocument(file.text).entries,
    warnings: file.warnings
  }
}

function readGotchas(config: ResolvedConfig): GotchasSource | null {
  let text: string
  try {
    text = fs.readFileSync(config.gotchasPath, "utf8")
  } catch {
    return null
  }
  if (text.trim() === "") return null
  const doc = parseGotchas(text)
  return { entries: doc.entries, warnings: doc.warnings }
}

// ---------------------------------------------------------------------------
// 要約規則(設計書 §8-4・§8-5 段階 4)
// ---------------------------------------------------------------------------

// 文の途中で切らない。句点があればそこまで、無ければ行全体を採る。
function firstSentence(text: string): string {
  const at = text.indexOf("。")
  if (at >= 0) return text.slice(0, at + 1)
  return text
}

// 表の区切り行。パイプを含み、罫線の文字(ハイフン・コロン・パイプ・空白)だけからなる。
function isTableDelimiter(line: string): boolean {
  return line.includes("|") && /^[-\s|:]+$/.test(line)
}

// 次の非空行の添字。フェンスに入ったら打ち切る(フェンスの開始行は表の一部になり得ない)。
function nextNonEmptyLine(scan: FenceScan, from: number): number {
  for (let i = from; i < scan.lines.length; i++) {
    if (scan.insideFence[i]) return -1
    if (scan.lines[i].text.trim() !== "") return i
  }
  return -1
}

// 表の本体行を読み飛ばし、最後に読み飛ばした行の添字を返す。
// 空行・パイプを含まない行・フェンスの開始で表は終わる。
function tableEndLine(scan: FenceScan, from: number): number {
  let i = from
  while (i < scan.lines.length && !scan.insideFence[i]) {
    const text = scan.lines[i].text.trim()
    if (text === "" || !text.includes("|")) break
    i++
  }
  return i - 1
}

// 段階 4 の要約に採るのは「そのセクションのフェンス外の最初の散文行」。
// 表・コードフェンス・Mermaid の中身・小見出しは採らない。
// フェンスの判定は lib の scanFences をそのまま使う(§8-6 の同一パーサ規律)。
function summarizeSection(section: ArchitectureSection): string | null {
  const scan = scanFences(section.body)
  for (let i = 0; i < scan.lines.length; i++) {
    if (scan.insideFence[i]) continue
    const line = scan.lines[i].text.trim()
    if (line === "") continue
    if (/^#{1,6}\s/.test(line)) continue // 小見出し
    // 表の判定規則: パイプを含む行の次の非空行が区切り行ならヘッダー行とみなし、表を丸ごと飛ばす
    //(GFM は行頭・行末のパイプを省略できるため、先頭パイプの有無で判定してはならない)。
    if (line.includes("|")) {
      const delim = nextNonEmptyLine(scan, i + 1)
      if (delim >= 0 && isTableDelimiter(scan.lines[delim].text.trim())) {
        i = tableEndLine(scan, delim + 1)
        continue
      }
    }
    if (line.startsWith("|")) continue // 表の断片(ヘッダーと区切りを伴わない行)
    if (/^[-=*_\s|:]+$/.test(line)) continue // 表の区切り・水平線・箇条書きの空項目
    if (line.startsWith("<!--")) continue // コメント
    const prose = trimEnd(
      line.replace(/^([-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, "")
    ).trim()
    if (prose === "") continue
    return firstSentence(prose)
  }
  return null
}

// ---------------------------------------------------------------------------
// 縮退計画(設計書 §8-5)
// ---------------------------------------------------------------------------

type ArchMode = "full" | "outline" | "headings" | "none"

interface Plan {
  /** 全文で載せる GOTCHAS の件数。 */
  recentCount: number
  /** 目次を出すか。 */
  tocEnabled: boolean
  /** 目次の上限。null は全件。 */
  tocLimit: number | null
  /** ADR 一覧(タイトル + 状態)を載せるか。 */
  includeAdr: boolean
  archMode: ArchMode
}

// 優先順(§8-3)の逆から削る。CLI 案内には決して手を付けない。
function* plans(recentCount: number): Generator<Plan> {
  const base: Plan = {
    recentCount,
    tocEnabled: true,
    tocLimit: null,
    includeAdr: true,
    archMode: "full"
  }
  // 段階 1: 直近 N 件を N-1, N-2 … と減らす(最小 0 件)。
  for (let r = recentCount; r >= 1; r--) yield { ...base, recentCount: r }
  const stage1 = { ...base, recentCount: 0 }
  yield stage1
  // 段階 2: 目次を直近 50 件に制限。
  const stage2: Plan = { ...stage1, tocLimit: STAGE2_TOC_LIMIT }
  yield stage2
  // 段階 3: ADR 一覧を全廃(ARCHITECTURE 本体より先に削る)。
  const stage3: Plan = { ...stage2, includeAdr: false }
  yield stage3
  // 段階 4: ARCHITECTURE を目次 + 各節の要約 1 行へ縮退。
  const stage4: Plan = { ...stage3, archMode: "outline" }
  yield stage4
  // 段階 5: 目次を全廃。
  const stage5: Plan = { ...stage4, tocEnabled: false }
  yield stage5
  // 段階 6: ARCHITECTURE を目次のみへ。
  const stage6: Plan = { ...stage5, archMode: "headings" }
  yield stage6
  // 段階 6 でも収まらない場合の最終手段。全文パスの案内だけを残す。
  yield { ...stage6, archMode: "none" }
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

function renderAdrSummary(
  section: ArchitectureSection,
  entries: AdrEntry[]
): string {
  // 設計書 §8-4・§8-6: ADR は予算に余裕があっても全文で載せない。
  const lines =
    entries.length > 0
      ? entries.map((e) => `- ${e.id}: ${e.title}(${e.status ?? "状態不明"})`)
      : ["(まだ ADR は無い)"]
  return [
    toLf(section.headingLine),
    "",
    ...lines,
    "",
    "ADR の全文は `node M get adr` で取得すること(注入には載せない)。"
  ].join("\n")
}

function renderArchitecture(
  config: ResolvedConfig,
  arch: ArchSource,
  plan: Plan
): string {
  const head = `## 技術的前提(${config.architectureRelative})`
  const readAll = `全文は ${config.architecturePath} を Read すること`

  if (plan.archMode === "none") {
    return `${head}\n\n${readAll}。`
  }

  const listed = arch.doc.sections.filter((s) => s.heading !== ADR_HEADING)

  if (plan.archMode === "headings") {
    return [
      head,
      "",
      `${readAll}(以下は節の一覧)。`,
      "",
      ...listed.map((s) => `- ${s.heading}`)
    ].join("\n")
  }

  if (plan.archMode === "outline") {
    return [
      head,
      "",
      `${readAll}(以下は目次と各節の要約 1 行)。`,
      "",
      ...listed.map((s) => {
        const summary = summarizeSection(s)
        return summary === null
          ? `- ${s.heading}`
          : `- ${s.heading}: ${summary}`
      })
    ].join("\n")
  }

  const parts: string[] = []
  let adrDropped = false
  for (const section of arch.doc.sections) {
    if (section.heading === ADR_HEADING) {
      if (!plan.includeAdr) {
        adrDropped = true
        continue
      }
      parts.push(renderAdrSummary(section, arch.adrEntries))
      continue
    }
    const raw = trimEnd(toLf(section.raw))
    if (raw !== "") parts.push(raw)
  }
  if (adrDropped) {
    parts.push("ADR 一覧は割愛した。`node M get adr` で取得すること。")
  }
  return [head, ...parts].join("\n\n")
}

function tocLine(entry: GotchaEntry): string {
  const title =
    entry.tag === null ? entry.title : `~~${entry.title}~~([${entry.tag}])`
  return `- [${entry.date}] ${entry.id}: ${title}`
}

// 設計書 §8-4: タグ付きは全文対象から除外し、除外分だけ後続の無タグエントリで埋める。
function pickRecent(entries: GotchaEntry[], count: number): GotchaEntry[] {
  if (count <= 0) return []
  const picked: GotchaEntry[] = []
  for (const entry of entries) {
    if (entry.tag !== null) continue
    picked.push(entry)
    if (picked.length >= count) break
  }
  return picked
}

function renderGotchas(
  config: ResolvedConfig,
  gotchas: GotchasSource,
  plan: Plan
): string {
  const total = gotchas.entries.length
  const parts: string[] = [
    `## 既知の落とし穴(${config.gotchasRelative}: 全 ${total} 件)`
  ]

  if (plan.tocEnabled) {
    const limit =
      plan.tocLimit === null ? total : Math.min(plan.tocLimit, total)
    const shown = gotchas.entries.slice(0, limit)
    const toc = ["### 目次(新しい順)"]
    if (shown.length === 0) toc.push("(まだ記録は無い)")
    else toc.push(...shown.map(tocLine))
    const rest = total - shown.length
    if (rest > 0) {
      toc.push(`- ほか ${rest} 件は \`node M get gotchas\` で取得すること。`)
    }
    parts.push(toc.join("\n"))
  } else if (total > 0) {
    parts.push("一覧は `node M get gotchas` で取得すること。")
  }

  const recent = pickRecent(gotchas.entries, plan.recentCount)
  if (recent.length > 0) {
    parts.push(
      [
        `### 直近 ${recent.length} 件(全文)`,
        "",
        recent.map((e) => trimEnd(toLf(e.raw))).join("\n\n")
      ].join("\n")
    )
  }

  return parts.join("\n\n")
}

interface RenderInput {
  config: ResolvedConfig
  guide: string
  warnings: string[]
  arch: ArchSource | null
  gotchas: GotchasSource | null
}

// 警告の書式は 1 か所に持つ。文書ありの経路と文書なしの経路で形が割れると、
// 読み手は同じ理由を 2 通りの見た目で受け取ることになる。
function renderWarnings(warnings: string[]): string {
  return warnings.map((w) => `※注意: ${w}`).join("\n")
}

function render(input: RenderInput, plan: Plan): string {
  // CLI 案内は必ず先頭。退避に倒れてもプレビューへ残す(§8-3)。
  const blocks: string[] = [input.guide]
  if (input.warnings.length > 0) {
    blocks.push(renderWarnings(input.warnings))
  }
  if (input.arch !== null) {
    blocks.push(renderArchitecture(input.config, input.arch, plan))
  }
  if (input.gotchas !== null) {
    blocks.push(renderGotchas(input.config, input.gotchas, plan))
  }
  return `${blocks.join("\n\n")}\n`
}

function build(config: ResolvedConfig, env: NodeJS.ProcessEnv): string {
  const arch = readArchitecture(config)
  const gotchas = readGotchas(config)
  const cli = metatronCliPath(env)

  // どちらも無くても CLI 案内だけは出す(設計書 §8-7・契約 §12・§13-1 の I3)。
  // §8-7 の「何も出力しない」は「**文書の内容を**出力しない」の意味に限定する。
  // `/metatron:init` はまさにこの状態で使うコマンドであり、案内まで落とすと
  // AI は CLI の絶対パスを知る手段を持たず、init を開始できない(§3-3・§8-3)。
  if (arch === null && gotchas === null) {
    // 文書が無い分岐でも、設定由来の理由(壊れた設定・未知 version・パス不正)は
    // 呼び出し元へ返す(契約 §2、設計書 §13-1 の I4)。理由を伏せたまま
    // 「文書が無い」とだけ案内すると、独自パスへ文書を置いた利用者は
    // 見失った原因が分からず、既定パスへ重複して文書を作りかねない。
    // 設定ファイルが無いのは正常な状態なので、警告が無いときは何も足さない。
    const configWarnings = config.warnings.slice(0, MAX_WARNING_LINES)
    const blocks = [buildInitGuide(cli)]
    if (configWarnings.length > 0) blocks.push(renderWarnings(configWarnings))
    return `${blocks.join("\n\n")}\n`
  }

  const guide = buildGuide(cli)
  const warnings = [
    ...config.warnings,
    ...(arch?.warnings ?? []),
    ...(gotchas?.warnings ?? [])
  ].slice(0, MAX_WARNING_LINES)

  const input: RenderInput = { config, guide, warnings, arch, gotchas }
  const budget = Math.max(1, config.injection.maxChars)
  // 設定値が実エントリ数より大きいときに同じ出力を何度も組み立てないよう頭を揃える。
  const startCount = Math.min(
    config.injection.gotchasRecentCount,
    gotchas?.entries.length ?? 0
  )

  for (const plan of plans(startCount)) {
    const content = render(input, plan)
    if (content.length <= budget) return content
  }

  // 段階を尽くしても収まらないのは maxChars が CLI 案内より小さい場合だけである。
  // そのときも CLI 案内は削らない(§8-5 の「CLI 案内には決して手を付けない」を上位に置く)。
  return `${guide}\n`
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

interface SessionStartInput {
  cwd?: string
  [k: string]: unknown
}

// SessionStart の入力から cwd を取る。stdin が閉じない環境で固まらないよう時間で打ち切る。
function readHookInput(): Promise<SessionStartInput> {
  return new Promise((resolve) => {
    let data = ""
    let settled = false
    const finish = (value: SessionStartInput): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      process.stdin.destroy()
      finish({})
    }, STDIN_TIMEOUT_MS)
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => {
      data += chunk
    })
    process.stdin.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(data)
        finish(
          typeof parsed === "object" && parsed !== null
            ? (parsed as SessionStartInput)
            : {}
        )
      } catch {
        finish({})
      }
    })
    process.stdin.on("error", () => finish({}))
  })
}

try {
  const hookInput = await readHookInput()
  const startDir =
    typeof hookInput.cwd === "string" && hookInput.cwd !== ""
      ? hookInput.cwd
      : process.cwd()
  const config = loadConfig(startDir)
  // 利用者が明示的に切っているときは案内も含めて何も出さない。
  if (config.injection.enabled) {
    injectContext(build(config, process.env))
  }
} catch {
  // フェイルオープン(契約 §12)。何も出力せず正常終了する。
  // **CLI 案内もここでは出さない。** 設定の解決が例外で壊れている状態で案内を出すと、
  // 誤った CLI パスを広告しかねないためである(設計書 §8-7 の限定)。
}
