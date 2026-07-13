#!/usr/bin/env node

// src/check-drive-config.ts
import { readFileSync } from "node:fs";
import path from "node:path";
var OFF = { configured: false, driveFolderId: null };
function readDriveConfig(root) {
  let content;
  try {
    content = readFileSync(path.join(root, ".claude", "basic-design.local.md"), "utf8");
  } catch {
    return OFF;
  }
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") return OFF;
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    const match = line.match(/^drive_folder_id:\s*(.*)$/);
    if (!match) continue;
    const quoted = match[1].trim().match(/^(["'])(.*?)\1/);
    const value = quoted ? quoted[2] : match[1].replace(/\s*#.*$/, "").trim();
    return value ? { configured: true, driveFolderId: value } : OFF;
  }
  return OFF;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(readDriveConfig(process.argv[2] ?? process.cwd()))}
`);
}
export {
  readDriveConfig
};
