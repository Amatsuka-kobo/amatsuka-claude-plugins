// プロジェクトの CLAUDE.md へ ARCHITECTURE・GOTCHAS の @メンションを追記する。
//
// 両文書は CLAUDE.md の @メンションで毎セッション読み込まれる(SessionStart の hook は本文を注入しない)。
// 既に書かれている @メンションは足さない。CLAUDE.md の他の行は書き換えない。

import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic-write.js"

/** @メンションを探す CLAUDE.md の置き場(docRoot からの相対パス)。inject-context.ts と揃える。 */
export const CLAUDE_MD_CANDIDATES = ["CLAUDE.md", ".claude/CLAUDE.md"] as const

export interface LinkResult {
  /** 書き込んだ(または書き込むはずだった)CLAUDE.md の絶対パス。 */
  path: string
  /** 新しく追記した @メンション。 */
  added: string[]
  /** 既にどちらかの CLAUDE.md に書かれていた @メンション。 */
  present: string[]
  /** CLAUDE.md を新しく作ったか。 */
  created: boolean
}

function readOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

// 行頭の `@<パス>` だけを @メンションとして数える。本文中の言及は数えない。
function mentions(text: string): Set<string> {
  const found = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^@(\S+)\s*$/.exec(line.trim())
    if (match) found.add(match[1])
  }
  return found
}

/** docRoot からの相対パスで表した、どちらかの CLAUDE.md に既に書かれている @メンション。 */
export function existingMentions(docRoot: string): Set<string> {
  const existing = new Set<string>()
  for (const rel of CLAUDE_MD_CANDIDATES) {
    const text = readOrNull(path.join(docRoot, rel))
    if (text === null) continue
    for (const m of mentions(text)) {
      // .claude/CLAUDE.md の `../docs/A.md` は docRoot の `docs/A.md` を指す。
      existing.add(
        rel === "CLAUDE.md" ? m : path.posix.normalize(`.claude/${m}`)
      )
    }
  }
  return existing
}

/**
 * `relatives`(docRoot からの相対パス)の @メンションを CLAUDE.md に追記する。
 *
 * 書き込み先は docRoot の `CLAUDE.md`。それが無く `.claude/CLAUDE.md` だけがあるときは
 * `.claude/CLAUDE.md` に書く。どちらも無ければ docRoot に `CLAUDE.md` を作る。
 * `.claude/CLAUDE.md` の @メンションは CLAUDE.md からの相対で解決されるため、`../` を付ける。
 */
export function linkClaudeMd(
  docRoot: string,
  relatives: readonly string[]
): LinkResult {
  // 空白・制御文字を含むパスは 1 行の @メンションにならず、改行で任意の行を書き込めてしまう。
  const unsafe = relatives.find(
    (rel) =>
      /\s/.test(rel) ||
      [...rel].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
  )
  if (unsafe !== undefined) {
    throw new Error(
      `空白か制御文字を含むパスは @メンションにできません: ${JSON.stringify(unsafe)}`
    )
  }
  const rootText = readOrNull(path.join(docRoot, "CLAUDE.md"))
  const dotText = readOrNull(path.join(docRoot, ".claude/CLAUDE.md"))
  const useDot = rootText === null && dotText !== null
  const target = path.join(docRoot, useDot ? ".claude/CLAUDE.md" : "CLAUDE.md")
  const created = (useDot ? dotText : rootText) === null
  const current = (useDot ? dotText : rootText) ?? ""

  const existing = existingMentions(docRoot)
  const present = relatives.filter((rel) => existing.has(rel))
  const added = relatives.filter((rel) => !existing.has(rel))
  if (added.length === 0) {
    return { path: target, added, present, created: false }
  }

  const lines = added.map((rel) => `@${useDot ? `../${rel}` : rel}`)
  // 既存の本文とは空行 1 行で区切る。
  const body = current.replace(/\s*$/, "")
  const separator = body === "" ? "" : "\n\n"
  writeFileAtomic(target, `${body}${separator}${lines.join("\n")}\n`)
  return { path: target, added, present, created }
}
