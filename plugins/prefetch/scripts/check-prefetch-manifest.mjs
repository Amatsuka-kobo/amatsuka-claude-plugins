#!/usr/bin/env node

// src/check-prefetch-manifest.ts
import fs from "node:fs";
import path from "node:path";
var input = {};
try {
  const rawInput = fs.readFileSync(0, "utf8");
  input = rawInput.trim() ? JSON.parse(rawInput) : {};
} catch {
  process.exit(0);
}
var projectDir = process.env.CLAUDE_PROJECT_DIR || (typeof input.cwd === "string" ? input.cwd : process.cwd());
var manifestPath = path.join(projectDir, ".prefetch", "manifest.md");
var manifest;
try {
  manifest = fs.readFileSync(manifestPath, "utf8");
} catch {
  process.exit(0);
}
var hasUnharvestedEntry = manifest.split(/\r?\n/).some((line) => {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length < 7) return false;
  const taskId = cells[1];
  const state = cells[cells.length - 3];
  return /^fr-\d+$/.test(taskId) && (state === "running" || state === "done");
});
if (!hasUnharvestedEntry) process.exit(0);
process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "\u672A\u56DE\u53CE\u306E prefetch \u6210\u679C\u304C\u3042\u308A\u307E\u3059\u3002\u30BF\u30FC\u30F3\u5192\u982D\u3067 .prefetch/manifest.md \u3092\u78BA\u8A8D\u3057\u3001\u4ECA\u56DE\u306E\u30E6\u30FC\u30B6\u30FC\u5165\u529B\u3068\u6709\u52B9\u6761\u4EF6\u3092\u7167\u5408\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5408\u81F4\u3059\u308B done \u306E result.md \u3060\u3051\u3092\u8AAD\u307F harvested \u306B\u66F4\u65B0\u3057\u3001\u4E0D\u5408\u81F4\u306F\u6210\u679C\u3092\u8AAD\u307E\u305A discarded\u3001\u5931\u6557\u306F failed \u306B\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5408\u81F4\u3059\u308B running \u306F\u3001\u5B8C\u4E86\u3092\u5F85\u3064\u304B\u901A\u5E38\u4F5C\u696D\u3092\u9032\u3081\u3066\u5F8C\u304B\u3089\u5408\u6D41\u3055\u305B\u3066\u304F\u3060\u3055\u3044\u3002"
    }
  })}
`
);
