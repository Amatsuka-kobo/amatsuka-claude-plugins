#!/usr/bin/env node

// src/extract-conversation.ts
import fs from "node:fs";
var file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("usage: node extract-conversation.mjs <transcript.jsonl>");
  process.exit(1);
}
var MAX_TOOL_HINT = 120;
var sections = [];
var push = (role, part) => {
  const last = sections[sections.length - 1];
  if (last && last.role === role) last.parts.push(part);
  else sections.push({ role, parts: [part] });
};
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
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
    push("USER", text);
  } else if (e.type === "assistant" && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type === "text" && c.text?.trim()) {
        push("ASSISTANT", c.text.trim());
      } else if (c.type === "tool_use") {
        const hint = c.input?.description ?? c.input?.file_path ?? "";
        push("ASSISTANT", `(tool: ${c.name}${hint ? ` \u2014 ${String(hint).slice(0, MAX_TOOL_HINT)}` : ""})`);
      }
    }
  }
}
console.log(sections.map((s) => `## ${s.role}

${s.parts.join("\n\n")}`).join("\n\n---\n\n"));
