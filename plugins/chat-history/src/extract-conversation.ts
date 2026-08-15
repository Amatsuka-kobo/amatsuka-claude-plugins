#!/usr/bin/env node
// Claude Code のトランスクリプト JSONL から発言のみを抽出し、Markdown を stdout に出力する。
// 使い方: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

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
}

const quote = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n")

export function extractConversation(
  content: string,
  sinceLine = 0,
  targetLine = Number.POSITIVE_INFINITY,
  workerName = "unknown"
): string {
  const sections: Section[] = []
  const push = (role: Section["role"], part: string): void => {
    const last = sections.at(-1)
    if (last?.role === role) last.parts.push(part)
    else sections.push({ role, parts: [part] })
  }

  let lineNo = 0
  for (const line of content.split("\n")) {
    lineNo++
    if (lineNo <= sinceLine) continue
    if (lineNo > targetLine) break
    if (!line.trim()) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    const message = entry.message
    if (!message || entry.isSidechain) continue

    if (entry.type === "user" && typeof message.content === "string") {
      const text = message.content.trim()
      if (!text || text.startsWith("<") || entry.isMeta) continue
      push("USER", quote(text))
      // 抽出区間 (sinceLine, targetLine] の両端はどちらも「ユーザー発言の行」であり、
      // AI の作業本体は必ず区間の前方(最初の USER 発言より手前)に来る。
      // かつて「前回ターンの断片が混ざる」ことを恐れて最初の USER までの ASSISTANT を
      // 捨てていたが、sinceLine は記録済みユーザー発言の行そのものなので、それより後は
      // すべて未記録である。捨てると記録が USER 発言だけの抜け殻になる。
    } else if (entry.type === "assistant" && Array.isArray(message.content)) {
      // tool_use は記録しない。記録は AI の発言(text)だけを原文で残す。
      for (const part of message.content)
        if (part.type === "text" && part.text?.trim())
          push("ASSISTANT", part.text.trim())
    }
  }

  return sections
    .map(
      (section) =>
        `# ${section.role === "USER" ? workerName : "AI"}\n\n${section.parts.join("\n\n")}`
    )
    .join("\n\n")
}

export function extractConversationFile(
  file: string,
  sinceLine = 0,
  targetLine = Number.POSITIVE_INFINITY,
  workerName = "unknown"
): string {
  return extractConversation(
    fs.readFileSync(file, "utf8"),
    sinceLine,
    targetLine,
    workerName
  )
}

function main(): void {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file || file.startsWith("--") || !fs.existsSync(file)) {
    console.error(
      "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]"
    )
    process.exitCode = 1
    return
  }
  const sinceIndex = args.indexOf("--since-line")
  const sinceLine =
    sinceIndex === -1 ? 0 : Math.max(0, Number(args[sinceIndex + 1]) || 0)
  const workerIndex = args.indexOf("--worker")
  const workerName =
    workerIndex === -1 ? "unknown" : (args[workerIndex + 1] ?? "unknown")
  console.log(
    extractConversationFile(
      file,
      sinceLine,
      Number.POSITIVE_INFINITY,
      workerName
    )
  )
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === pathResolve(process.argv[1]) &&
  path.basename(process.argv[1]).startsWith("extract-conversation.")
)
  main()

function pathResolve(value: string): string {
  return fs.realpathSync(value)
}
