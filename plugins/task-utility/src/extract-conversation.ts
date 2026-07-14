#!/usr/bin/env node
// Claude Code のトランスクリプト JSONL から発言のみを抽出し、Markdown を stdout に出力する。
// chat-recorder エージェントがユーザー発言の原文を機械的に得るための前処理。
// 使い方: node extract-conversation.mjs <transcript.jsonl>
import fs from "node:fs"

const file = process.argv[2]
if (!file || !fs.existsSync(file)) {
  console.error("usage: node extract-conversation.mjs <transcript.jsonl>")
  process.exit(1)
}

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

for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue
  let e: TranscriptEntry
  try { e = JSON.parse(line) as TranscriptEntry } catch { continue }
  const msg = e.message
  if (!msg || e.isSidechain) continue // サブエージェントの往復は含めない

  if (e.type === "user" && typeof msg.content === "string") {
    const text = msg.content.trim()
    // スラッシュコマンド記録やハーネス注入(<command-name> 等)は発言ではない
    if (!text || text.startsWith("<") || e.isMeta) continue
    push("USER", text)
  } else if (e.type === "assistant" && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type === "text" && c.text?.trim()) {
        push("ASSISTANT", c.text.trim())
      } else if (c.type === "tool_use") {
        const hint = c.input?.description ?? c.input?.file_path ?? ""
        push("ASSISTANT", `(tool: ${c.name}${hint ? ` — ${String(hint).slice(0, MAX_TOOL_HINT)}` : ""})`)
      }
    }
  }
}

console.log(sections.map((s) => `## ${s.role}\n\n${s.parts.join("\n\n")}`).join("\n\n---\n\n"))
