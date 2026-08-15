#!/usr/bin/env node

// src/extract-conversation.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var quote = (text) => text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
function extractConversation(content, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY, workerName = "unknown") {
  const sections = [];
  const push = (role, part) => {
    const last = sections.at(-1);
    if (last?.role === role) last.parts.push(part);
    else sections.push({ role, parts: [part] });
  };
  let lineNo = 0;
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
      push("USER", quote(text));
    } else if (entry.type === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content)
        if (part.type === "text" && part.text?.trim())
          push("ASSISTANT", part.text.trim());
    }
  }
  return sections.map(
    (section) => `# ${section.role === "USER" ? workerName : "AI"}

${section.parts.join("\n\n")}`
  ).join("\n\n");
}
function extractConversationFile(file, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY, workerName = "unknown") {
  return extractConversation(
    fs.readFileSync(file, "utf8"),
    sinceLine,
    targetLine,
    workerName
  );
}
function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || file.startsWith("--") || !fs.existsSync(file)) {
    console.error(
      "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]"
    );
    process.exitCode = 1;
    return;
  }
  const sinceIndex = args.indexOf("--since-line");
  const sinceLine = sinceIndex === -1 ? 0 : Math.max(0, Number(args[sinceIndex + 1]) || 0);
  const workerIndex = args.indexOf("--worker");
  const workerName = workerIndex === -1 ? "unknown" : args[workerIndex + 1] ?? "unknown";
  console.log(
    extractConversationFile(
      file,
      sinceLine,
      Number.POSITIVE_INFINITY,
      workerName
    )
  );
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
