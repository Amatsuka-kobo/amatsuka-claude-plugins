#!/usr/bin/env node

// src/hooks/check-chat-recorded.ts
import fs from "node:fs";
import path from "node:path";
var NAG_MARKER = "<!--chat-recorder-nag-->";
var input = {};
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
if (input.stop_hook_active) process.exit(0);
var projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
if (!fs.existsSync(path.join(projectDir, "docs", "chat"))) process.exit(0);
var transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);
var lastUserTurn = -1;
var lastRecord = -1;
var lastNag = -1;
var lineNo = 0;
for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
  lineNo++;
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
    if (text.includes(NAG_MARKER)) {
      lastNag = lineNo;
    } else if (text && !text.startsWith("<") && !e.isMeta) {
      lastUserTurn = lineNo;
    }
  } else if (e.type === "assistant" && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type !== "tool_use") continue;
      if ((c.name === "Write" || c.name === "Edit") && typeof c.input?.file_path === "string" && c.input.file_path.replaceAll("\\", "/").includes("docs/chat/")) {
        lastRecord = lineNo;
      } else if (c.name === "Agent" && String(c.input?.subagent_type ?? "").includes("chat-recorder")) {
        lastRecord = lineNo;
      }
    }
  }
}
if (lastUserTurn === -1 || lastUserTurn <= lastRecord) process.exit(0);
if (lastNag > lastUserTurn) process.exit(0);
var pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || "<task-utility plugin root>";
var sinceArg = lastRecord > -1 ? ` --since-line ${lastRecord}` : "";
var reason = [
  NAG_MARKER,
  "\u3053\u306E\u4F1A\u8A71\u306B\u306F docs/chat/ \u306B\u307E\u3060\u8A18\u9332\u3055\u308C\u3066\u3044\u306A\u3044\u30BF\u30FC\u30F3\u304C\u3042\u308A\u307E\u3059(task-utility chat \u30B9\u30AD\u30EB\u306E\u5BFE\u8C61\u3067\u3059)\u3002",
  "\u8A18\u9332\u306F\u30E1\u30A4\u30F3\u30B3\u30F3\u30C6\u30AD\u30B9\u30C8\u3067\u884C\u308F\u305A\u3001\u8A18\u9332\u5C02\u7528\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u306B\u59D4\u8B72\u3057\u3066\u304F\u3060\u3055\u3044:",
  'Agent \u30C4\u30FC\u30EB\u3067 subagent_type "task-utility:chat-recorder" \u3092\u8D77\u52D5\u3057\u3001\u30D7\u30ED\u30F3\u30D7\u30C8\u306B\u6B21\u306E\u60C5\u5831\u3092\u542B\u3081\u308B\u3053\u3068\u3002',
  `- \u30C8\u30E9\u30F3\u30B9\u30AF\u30EA\u30D7\u30C8: ${transcriptPath}`,
  `- \u62BD\u51FA\u30B3\u30DE\u30F3\u30C9: node "${pluginRoot}/scripts/extract-conversation.mjs" "${transcriptPath}"${sinceArg}`,
  `- \u30B9\u30AD\u30EB\u5B9A\u7FA9: ${pluginRoot}/skills/chat/SKILL.md`,
  "- \u30E6\u30FC\u30B6\u30FC\u306E GitHub \u30E6\u30FC\u30B6\u30FC\u540D\u3068 git \u306E\u30E6\u30FC\u30B6\u30FC\u540D(`git config user.name`\u3002\u8A18\u9332\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u540D\u306B\u4F7F\u3046)\u3001\u65E5\u4ED8\u3001\u3053\u306E\u4F1A\u8A71\u306E\u6210\u679C\u7269(\u30D5\u30A1\u30A4\u30EB\u30D1\u30B9\u30FB\u30B3\u30DF\u30C3\u30C8)\u3001\u524D\u63D0\u3068\u306A\u308B\u8CC7\u6599",
  "- \u65E2\u5B58\u306E\u8A18\u9332\u30D5\u30A1\u30A4\u30EB\u304C\u3042\u308C\u3070\u65B0\u898F\u4F5C\u6210\u305B\u305A\u3001\u672A\u8A18\u9332\u306E\u30BF\u30FC\u30F3\u3060\u3051\u3092\u305D\u306E\u30D5\u30A1\u30A4\u30EB\u306B\u8FFD\u8A18\u3059\u308B\u3088\u3046\u6307\u793A\u3059\u308B\u3053\u3068\u3002",
  "- \u65E2\u5B58\u30D5\u30A1\u30A4\u30EB\u306E\u78BA\u8A8D\u306F\u5168\u6587 Read \u3067\u306A\u304F\u672B\u5C3E\u78BA\u8A8D(tail)\u3067\u884C\u3046\u3088\u3046\u6307\u793A\u3059\u308B\u3053\u3068\u3002",
  "- \u8FFD\u8A18\u306F\u5168\u6587\u4E0A\u66F8\u304D\u3067\u306A\u304F\u672B\u5C3E\u8FFD\u8A18\u3067\u884C\u3046\u3088\u3046\u6307\u793A\u3059\u308B\u3053\u3068\u3002",
  "\u30C8\u30E9\u30F3\u30B9\u30AF\u30EA\u30D7\u30C8\u304C\u8AAD\u3081\u306A\u3044\u7B49\u3001\u6280\u8853\u7684\u306B\u8A18\u9332\u3067\u304D\u306A\u3044\u5834\u5408\u306E\u307F\u3001\u305D\u306E\u7406\u7531\u3092\u30E6\u30FC\u30B6\u30FC\u306B\u4E00\u8A00\u4F1D\u3048\u3066\u304B\u3089\u7D42\u4E86\u3057\u3066\u69CB\u3044\u307E\u305B\u3093\u3002"
].join("\n");
console.log(JSON.stringify({ decision: "block", reason }));
