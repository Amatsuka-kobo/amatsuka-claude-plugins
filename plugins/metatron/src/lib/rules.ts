// `.claude/rules/metatron/` の 3 ファイルの読み取りと書式検証。
//
// 書式の正本は `references/rules-format.md`。このファイルはその契約の実装である。
//
// ARCHITECTURE と GOTCHAS は「1 文書 = 1 パス」だが、rules は 1 つの管理単位が
// 3 つのファイルに分かれる。ファイル名は固定であり config では変えられない
// (置き場だけが `paths.rulesDir` で変わる)。
//
// この層は読み取りではフェイルオープンし(例外を投げず未作成として扱う)、
// 書き込みの検証ではフェイルクローズドする(疑わしい入力は拒否する)。

import fs from "node:fs"
import path from "node:path"
import type { ResolvedConfig } from "./config.js"

/** metatron が管理する rules のファイル名(拡張子を除く)。固定 3 つ。 */
export const RULES_FILES = [
  "conventions",
  "protected-paths",
  "testing-policy"
] as const

export type RulesName = (typeof RULES_FILES)[number]

/**
 * 各ファイルの本文冒頭に置く管理者表示。
 *
 * CLI の絶対パスはインストール先で変わるため書かない。読んだ AI が更新経路を
 * 知るための 1 行であり、絶対パスは注入文または拒否メッセージから取る。
 */
export const RULES_ADMIN_NOTICE =
  "> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。"

/**
 * 分量の目安。
 *
 * 公式が rules に定めた上限は存在しない。CLAUDE.md の `target under 200 lines`
 * を運用上の目安として借りた metatron 側の判断であり、公式仕様ではない。
 * 超えても拒否せず、警告だけを返す。
 */
export const RULES_LINE_GUIDELINE = 200

/** 管理者表示行を探す範囲(本文の先頭何行か)。 */
const ADMIN_NOTICE_SCAN_LINES = 5

export function isRulesName(value: unknown): value is RulesName {
  return (
    typeof value === "string" &&
    (RULES_FILES as readonly string[]).includes(value)
  )
}

export function rulesFilePath(config: ResolvedConfig, name: RulesName): string {
  return path.join(config.rulesDirPath, `${name}.md`)
}

export function rulesFileRelative(
  config: ResolvedConfig,
  name: RulesName
): string {
  return `${config.rulesDirRelative}/${name}.md`
}

export function rulesFilePaths(
  config: ResolvedConfig
): Record<RulesName, string> {
  const out = {} as Record<RulesName, string>
  for (const name of RULES_FILES) out[name] = rulesFilePath(config, name)
  return out
}

export interface RulesFileState {
  name: RulesName
  path: string
  relative: string
  exists: boolean
  text: string | null
}

/**
 * rules ファイルの読み取り。存在しない場合も読めない場合も例外を投げない。
 * 読めなかったことは `exists: false` として返す(既存の読み取り系と同じ方針)。
 */
export function readRulesFile(
  config: ResolvedConfig,
  name: RulesName
): RulesFileState {
  const filePath = rulesFilePath(config, name)
  const base = {
    name,
    path: filePath,
    relative: rulesFileRelative(config, name)
  }
  try {
    return { ...base, exists: true, text: fs.readFileSync(filePath, "utf8") }
  } catch {
    return { ...base, exists: false, text: null }
  }
}

export function readRulesFiles(config: ResolvedConfig): RulesFileState[] {
  return RULES_FILES.map((name) => readRulesFile(config, name))
}

export type RulesUpdateError =
  | "unknown_rules_name"
  | "invalid_input"
  | "frontmatter_not_allowed"
  | "missing_admin_notice"

export type RulesUpdate =
  | {
      ok: true
      name: RulesName
      text: string
      mode: "created" | "replaced"
      warnings: string[]
    }
  | { ok: false; error: RulesUpdateError; message: string }

function normalizeTrailingNewline(text: string): string {
  return `${text.replace(/\n+$/, "")}\n`
}

/**
 * `stage-rules` の入力を検証し、書き込む全文を組み立てる。
 *
 * `current` は現在のファイル内容(未作成なら null)。`body` は `# 見出し` を含む
 * 完全なファイル内容であり、ARCHITECTURE のセクション本文と違って見出し行を含む。
 */
export function prepareRulesUpdate(
  current: string | null | undefined,
  input: { name?: unknown; body?: unknown }
): RulesUpdate {
  const { name, body } = input

  if (!isRulesName(name)) {
    return {
      ok: false,
      error: "unknown_rules_name",
      message: `name は ${RULES_FILES.join(" / ")} のいずれかです(受領: ${JSON.stringify(name ?? null)})。`
    }
  }

  if (typeof body !== "string" || body.trim() === "") {
    return {
      ok: false,
      error: "invalid_input",
      message: `body は空でない文字列である必要があります(${name})。`
    }
  }

  const lines = body.split("\n")
  if (lines[0]?.trim() === "---") {
    return {
      ok: false,
      error: "frontmatter_not_allowed",
      message:
        "rules に frontmatter は書きません。frontmatter を持たないファイルだけが起動時に読み込まれ、サブエージェントにも渡ります(設計書 §4-3)。"
    }
  }

  if (!body.startsWith("# ")) {
    return {
      ok: false,
      error: "invalid_input",
      message:
        "body は `# 見出し` から始まる完全なファイル内容とします。セクション本文だけを渡さないでください。"
    }
  }

  if (
    !lines
      .slice(0, ADMIN_NOTICE_SCAN_LINES)
      .some((line) => line.includes(RULES_ADMIN_NOTICE))
  ) {
    return {
      ok: false,
      error: "missing_admin_notice",
      message: `body の先頭 ${ADMIN_NOTICE_SCAN_LINES} 行に管理者表示行がありません。見出しの直後へ次の 1 行を置いてください: ${RULES_ADMIN_NOTICE}`
    }
  }

  const text = normalizeTrailingNewline(body)
  const warnings: string[] = []
  const lineCount = text.split("\n").length - 1
  if (lineCount > RULES_LINE_GUIDELINE) {
    warnings.push(
      `${name}.md が ${lineCount} 行です。目安の ${RULES_LINE_GUIDELINE} 行を超えています。rules は起動時に読み込まれ、サブエージェントへ委譲するたびに再度読み込まれます。`
    )
  }

  return {
    ok: true,
    name,
    text,
    mode:
      current === null || current === undefined || current === ""
        ? "created"
        : "replaced",
    warnings
  }
}
