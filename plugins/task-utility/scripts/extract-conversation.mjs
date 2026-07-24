#!/usr/bin/env node

// src/extract-conversation.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var MAX_TOOL_HINT = 120;
var quote = (text) => text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
function extractConversation(content, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY) {
  const sections = [];
  const push = (role, part) => {
    const last = sections.at(-1);
    if (last?.role === role) last.parts.push(part);
    else sections.push({ role, parts: [part] });
  };
  let lineNo = 0;
  let seenUser = sinceLine <= 0;
  for (const line of content.split("\n")) {
    lineNo++;
    if (lineNo <= sinceLine) continue;
    if (lineNo > targetLine) break;
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message || entry.isSidechain) continue;
    if (entry.type === "user" && typeof message.content === "string") {
      const text = message.content.trim();
      if (!text || text.startsWith("<") || entry.isMeta) continue;
      seenUser = true;
      push("USER", quote(text));
    } else if (entry.type === "assistant" && Array.isArray(message.content) && seenUser) {
      for (const part of message.content) {
        if (part.type === "text" && part.text?.trim()) {
          push("ASSISTANT", part.text.trim());
        } else if (part.type === "tool_use") {
          const hint = part.input?.description ?? part.input?.file_path ?? "";
          push(
            "ASSISTANT",
            `(tool: ${part.name}${hint ? ` \u2014 ${String(hint).slice(0, MAX_TOOL_HINT)}` : ""})`
          );
        }
      }
    }
  }
  return sections.map((section) => `## ${section.role}

${section.parts.join("\n\n")}`).join("\n\n---\n\n");
}
function extractConversationFile(file, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY) {
  return extractConversation(
    fs.readFileSync(file, "utf8"),
    sinceLine,
    targetLine
  );
}
function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || file.startsWith("--") || !fs.existsSync(file)) {
    console.error(
      "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>]"
    );
    process.exitCode = 1;
    return;
  }
  const sinceIndex = args.indexOf("--since-line");
  const sinceLine = sinceIndex === -1 ? 0 : Math.max(0, Number(args[sinceIndex + 1]) || 0);
  console.log(extractConversationFile(file, sinceLine));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1]) && path.basename(process.argv[1]).startsWith("extract-conversation."))
  main();
function pathResolve(value) {
  return fs.realpathSync(value);
}
export {
  extractConversation,
  extractConversationFile
};
