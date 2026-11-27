#!/usr/bin/env node
// SessionStart の案内 hook。
//
// ARCHITECTURE の本文は注入しない。本文はプロジェクトの CLAUDE.md の @メンションで
// 読み込まれる(メインセッションもサブエージェントも同じ経路で読む)。この hook が出すのは、
// CLAUDE.md に固定で書けない案内だけである。CLI の絶対パスはプラグインのバージョンごとに変わる。
//
// 出力の形式は契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §13。
//
// 第 2 層(機構自身の動作)なので**フェイルオープン**する。設定の解決が例外で失敗したときは
// 何も出さずに exit 0 で終える。誤った CLI パスを広告しないためである。
// 文書が 1 つも無くても CLI の案内は出す。`/metatron:init` がその状態で CLI を使うからである。

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { existingMentions, isMentionablePath } from "./lib/claude-md.js"
import { loadConfig, type ResolvedConfig } from "./lib/config.js"
import { injectContext } from "./lib/emit.js"

/** 警告行の上限。 */
const MAX_WARNING_LINES = 3
/** stdin を待つ上限。stdin が閉じない環境でも hook を固まらせない。 */
const STDIN_TIMEOUT_MS = 2000
/** 廃止した rules 3 ファイルの既定の置き場。残っていたら移行を案内する。 */
const LEGACY_RULES_DIR = ".claude/rules/metatron"
/** 廃止した rules のファイル名。置き場に他のファイルがあっても、これだけを旧 rules とみなす。 */
const LEGACY_RULES_FILES = [
  "conventions.md",
  "protected-paths.md",
  "testing-policy.md"
]

// 旧版の config は `paths.rulesDir` で rules の置き場を変えられた。現行の config の解決は
// このキーを無視するので、移行の案内のためだけに設定ファイルを直接読む。
function legacyRulesDir(config: ResolvedConfig): string {
  try {
    const raw = JSON.parse(fs.readFileSync(config.configPath, "utf8")) as {
      paths?: { rulesDir?: unknown }
    }
    const dir = raw?.paths?.rulesDir
    // 旧版の解決(契約 §3 規則 2・3)が受け付けた値だけを使う。旧版が拒否した値
    // (空文字列・絶対パス・"." のように docRoot そのものを指す値・ルート外)のときは、
    // 旧版と同じく既定の置き場を見る。
    if (typeof dir === "string" && dir.trim() !== "") {
      const value = dir.replace(/\\/g, "/")
      const looksAbsolute =
        path.isAbsolute(value) ||
        /^[A-Za-z]:\//.test(value) ||
        value.startsWith("//")
      const relative = path.relative(
        config.docRoot,
        path.resolve(config.docRoot, value)
      )
      const escapes =
        relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      if (!looksAbsolute && !escapes) return relative.split(path.sep).join("/")
    }
  } catch {
    // 設定が無い・読めないときは既定の置き場を見る。
  }
  return LEGACY_RULES_DIR
}

// hook 自身の位置からプラグインルートを求める。ソース(src/)からもバンドル(scripts/)からも
// 1 階層上がプラグインルートになる(契約 §12)。
function metatronCliPath(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT
  const root =
    typeof fromEnv === "string" && fromEnv !== ""
      ? path.resolve(fromEnv)
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  return path.join(root, "scripts", "metatron.mjs")
}

// 存在しない・読めない・空白だけは、いずれも「無い」として扱う。
function hasContent(filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8").trim() !== ""
  } catch {
    return false
  }
}

// 呼び出し規約は契約 §12。
function cliLines(cli: string): string[] {
  return [
    `全文取得は次の CLI を使う(絶対パス。M = ${cli}):`,
    "  読む:     node M get architecture",
    "※長い入力は一時ファイルへ書き、--input <path> で渡す(CLI の呼び出し規約)。"
  ]
}

// 更新は stage → commit の CLI 手順を見せず、スキルへ誘導する。手順が見えると、
// スキルを起動せずに CLI へ直行し、乖離の検出・草案の検査・承認の手順を飛ばす。
function updateLines(): string[] {
  return [
    "ARCHITECTURE の更新は、Skill ツールで metatron:updating-architecture を起動して行う。",
    "計画書に stage-* の手順が書かれていても、先にスキルを起動する。"
  ]
}

// 移行が要る状態の案内。旧 rules が残っている、または CLAUDE.md に @メンションが無い。
function migrationLines(
  config: ResolvedConfig,
  docs: string[],
  hasArchitecture: boolean
): { lines: string[]; screen: string[] } {
  const lines: string[] = []
  const rulesDir = legacyRulesDir(config)
  if (
    LEGACY_RULES_FILES.some((name) =>
      fs.existsSync(path.join(config.docRoot, rulesDir, name))
    )
  ) {
    lines.push(
      `廃止した rules(${rulesDir}/)が残っている。/metatron:update で ARCHITECTURE と CLAUDE.md へ移行する。`
    )
  }
  if (!hasArchitecture) return { lines, screen: lines }
  // 設定ファイルが無いことは文書の読み込みに影響しないので、画面には出さずモデルにだけ伝える。
  const screen = [...lines]
  const both = (line: string): void => {
    lines.push(line)
    screen.push(line)
  }
  if (!fs.existsSync(config.configPath)) {
    lines.push(
      "metatron.config.json が無く、codiel が metatron の利用を判定できない。/metatron:update で作る。"
    )
  }
  const existing = existingMentions(config.docRoot)
  const missing = docs.filter((rel) => !existing.has(rel))
  const unlinkable = missing.filter((rel) => !isMentionablePath(rel))
  const linkable = missing.filter((rel) => isMentionablePath(rel))
  if (linkable.length > 0) {
    both(
      `CLAUDE.md に ${linkable.map((rel) => `@${rel}`).join(" と ")} が無く、文書が読み込まれない。/metatron:update で追記する。`
    )
  }
  if (unlinkable.length > 0) {
    both(
      `${unlinkable.join(" と ")} は空白か制御文字を含むため、@メンションで読み込めない。metatron.config.json の paths を空白の無いパスに変える。`
    )
  }
  return { lines, screen }
}

function build(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv
): { content: string; systemMessage?: string } {
  const cli = metatronCliPath(env)
  const hasArchitecture = hasContent(config.architecturePath)
  const docs = [config.architectureRelative]

  const lines = ["# metatron: 案内", ""]
  if (!hasArchitecture) {
    lines.push(
      "このプロジェクトにはまだ ARCHITECTURE が無い。**`/metatron:init` で作成する。**",
      ...cliLines(cli)
    )
  } else {
    lines.push(
      `${docs.join(" と ")} は metatron の管理下にあり、CLAUDE.md の @メンションで読み込まれる。**直接編集は PreToolUse hook が拒否する。**`,
      ...cliLines(cli),
      ...updateLines(),
      "サブエージェントも CLAUDE.md 経由で同じ文書を読む。委譲の依頼文には、文書の原文も要約も書き写さない。"
    )
  }
  const migration = migrationLines(config, docs, hasArchitecture)
  lines.push(...migration.lines)
  // 設定由来の理由(壊れた設定・未知 version・パス不正)は伏せない(契約 §2)。
  for (const warning of config.warnings.slice(0, MAX_WARNING_LINES)) {
    lines.push(`※注意: ${warning}`)
  }
  // 文書が読み込まれない状態(旧 rules・@メンションの欠落)は、モデル経由でなく画面にも出す。
  return {
    content: `${lines.join("\n")}\n`,
    ...(migration.screen.length === 0
      ? {}
      : { systemMessage: `metatron: ${migration.screen.join(" ")}` })
  }
}

// 入力から cwd を取る。stdin が閉じない環境で固まらないよう時間で打ち切る。
function readHookInput(): Promise<{ cwd?: unknown }> {
  return new Promise((resolve) => {
    let data = ""
    let settled = false
    const finish = (value: { cwd?: unknown }): void => {
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
        finish(typeof parsed === "object" && parsed !== null ? parsed : {})
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
  const { content, systemMessage } = build(loadConfig(startDir), process.env)
  injectContext(content, systemMessage)
} catch {
  // フェイルオープン(契約 §12)。何も出力せず正常終了する。
}
