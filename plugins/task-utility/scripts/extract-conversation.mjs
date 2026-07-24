#!/usr/bin/env node

// src/extract-conversation.ts
import fs from "node:fs";
var args = process.argv.slice(2);
var file = args[0];
if (!file || file.startsWith("--") || !fs.existsSync(file)) {
  console.error(
    "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>]"
  );
  process.exit(1);
}
var sinceIdx = args.indexOf("--since-line");
var sinceLine = sinceIdx === -1 ? 0 : Math.max(0, Number(args[sinceIdx + 1]) || 0);
var MAX_TOOL_HINT = 120;
var sections = [];
var push = (role, part) => {
  const last = sections[sections.length - 1];
  if (last && last.role === role) last.parts.push(part);
  else sections.push({ role, parts: [part] });
};
var quote = (text) => text.split("\n").map((l) => l === "" ? ">" : `> ${l}`).join("\n");
var lineNo = 0;
var seenUser = sinceLine <= 0;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  lineNo++;
  if (lineNo <= sinceLine) continue;
  if (!line.trim()) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const msg = e.message;
  if (!msg || e.isSidechain) continue;
  if (e.type === "user" && typeof msg.content === "string") {
    const text = msg.content.trim();
    if (!text || text.startsWith("<") || e.isMeta) continue;
    seenUser = true;
    push("USER", quote(text));
  } else if (e.type === "assistant" && Array.isArray(msg.content)) {
    if (!seenUser) continue;
    for (const c of msg.content) {
      if (c.type === "text" && c.text?.trim()) {
        push("ASSISTANT", c.text.trim());
      } else if (c.type === "tool_use") {
        const hint = c.input?.description ?? c.input?.file_path ?? "";
        push(
          "ASSISTANT",
          `(tool: ${c.name}${hint ? ` \u2014 ${String(hint).slice(0, MAX_TOOL_HINT)}` : ""})`
        );
      }
    }
  }
}
console.log(
  sections.map((s) => `## ${s.role}

${s.parts.join("\n\n")}`).join("\n\n---\n\n")
);
