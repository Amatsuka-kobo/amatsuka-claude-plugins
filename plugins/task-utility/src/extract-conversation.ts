#!/usr/bin/env node
// Claude Code のトランスクリプト JSONL から発言のみを抽出し、Markdown を stdout に出力する。
// chat-recorder エージェントがユーザー発言の原文を機械的に得るための前処理。
// 使い方: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>]
import fs from "node:fs"

const args = process.argv.slice(2)
const file = args[0]
if (!file || file.startsWith("--") || !fs.existsSync(file)) {
  console.error(
    "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>]"
  )
  process.exit(1)
}

// 行番号 N 以前を読み飛ばす。数え方は check-chat-recorded.ts と同一
// (split("\n") 直後・スキップ判定より前に加算。空行・パース不能行も 1 行)。
const sinceIdx = args.indexOf("--since-line")
const sinceLine =
  sinceIdx === -1 ? 0 : Math.max(0, Number(args[sinceIdx + 1]) || 0)

const MAX_TOOL_HINT = 120

interface Section {
  role: "USER" | "ASSISTANT"
  parts: string[]
}

interface TranscriptEntry {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: {
    content?: string | TranscriptContent[]
  }
}

interface TranscriptContent {
  type?: string
  text?: string
  name?: string
  input?: {
    description?: unknown
    file_path?: unknown
  }
}

const sections: Section[] = [] // { role: 'USER'|'ASSISTANT', parts: string[] }
const push = (role: Section["role"], part: string): void => {
  const last = sections[sections.length - 1]
  if (last && last.role === role) last.parts.push(part)
  else sections.push({ role, parts: [part] })
}

// USER 発言を引用ブロックへ機械的に整形する。引用記号の付加はフォーマットであり
// 本文の改変ではない(「一字も変えない」契約の対象は本文)。
const quote = (text: string): string =>
  text
    .split("\n")
    .map((l) => (l === "" ? ">" : `> ${l}`))
    .join("\n")

let lineNo = 0
// 差分抽出時は、最初の USER 実発言が現れるまで ASSISTANT 断片を捨てる
// (前回記録済みターンの末尾断片を差分に混ぜない)
let seenUser = sinceLine <= 0
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  lineNo++
  if (lineNo <= sinceLine) continue
  if (!line.trim()) continue
  let e: TranscriptEntry
  try {
    e = JSON.parse(line) as TranscriptEntry
  } catch {
    continue
  }
  const msg = e.message
  if (!msg || e.isSidechain) continue // サブエージェントの往復は含めない

  if (e.type === "user" && typeof msg.content === "string") {
    const text = msg.content.trim()
    // スラッシュコマンド記録やハーネス注入(<command-name> 等)は発言ではない
    if (!text || text.startsWith("<") || e.isMeta) continue
    seenUser = true
    push("USER", quote(text))
  } else if (e.type === "assistant" && Array.isArray(msg.content)) {
    if (!seenUser) continue
    for (const c of msg.content) {
      if (c.type === "text" && c.text?.trim()) {
        push("ASSISTANT", c.text.trim())
      } else if (c.type === "tool_use") {
        const hint = c.input?.description ?? c.input?.file_path ?? ""
        push(
          "ASSISTANT",
          `(tool: ${c.name}${hint ? ` — ${String(hint).slice(0, MAX_TOOL_HINT)}` : ""})`
        )
      }
    }
  }
}

console.log(
  sections
    .map((s) => `## ${s.role}\n\n${s.parts.join("\n\n")}`)
    .join("\n\n---\n\n")
)
