// プロジェクトの CLAUDE.md へ ARCHITECTURE・GOTCHAS の @メンションを追記する。
//
// 両文書は CLAUDE.md の @メンションで毎セッション読み込まれる(SessionStart の hook は本文を注入しない)。
// 既に書かれている @メンションは足さない。CLAUDE.md の他の行は書き換えない。
// 判定の対象は docRoot の CLAUDE.md と .claude/CLAUDE.md だけである。
// 他のファイル経由の import・CLAUDE.local.md・親ディレクトリの CLAUDE.md は見ない。

import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic-write.js"

/** @メンションを探す CLAUDE.md の置き場(docRoot からの相対パス)。 */
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

/**
 * @メンションにできるパスか。空白・制御文字を含むパスは 1 語の @メンションにならず、
 * 改行で任意の行を書き込めてしまう。
 */
export function isMentionablePath(rel: string): boolean {
  return (
    rel !== "" &&
    ![...rel].some((c) => {
      const code = c.charCodeAt(0)
      return /\s/.test(c) || code < 0x20 || code === 0x7f
    })
  )
}

// Claude Code が import として読む `@<パス>` を集める。
// コードフェンスの中とインラインコードの中は import にならないので数えない。
// 行の途中・箇条書きの中の `@<パス>` も import になるので数える。
function mentions(text: string): Set<string> {
  const found = new Set<string>()
  let fence: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "")
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (fence === null) fence = marker[1][0]
      else if (marker[1][0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const outsideCode = line.replace(/`[^`]*`/g, " ")
    for (const match of outsideCode.matchAll(/(?:^|\s)@(\S+)/g)) {
      const token = match[1].replace(/[.,;:)\]、。」]+$/, "")
      if (token !== "") found.add(path.posix.normalize(token))
    }
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
 * 改行コードは既存のファイルに合わせる。
 */
export function linkClaudeMd(
  docRoot: string,
  relatives: readonly string[]
): LinkResult {
  const unsafe = relatives.find((rel) => !isMentionablePath(rel))
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

  const eol = current.includes("\r\n") ? "\r\n" : "\n"
  const lines = added.map((rel) => `@${useDot ? `../${rel}` : rel}`)
  // 既存の本文とは空行 1 行で区切る。
  const body = current.replace(/\s*$/, "")
  const separator = body === "" ? "" : `${eol}${eol}`
  writeFileAtomic(target, `${body}${separator}${lines.join(eol)}${eol}`)
  return { path: target, added, present, created }
}
