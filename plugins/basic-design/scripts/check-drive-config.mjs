#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readDriveConfig(root) {
  const filePath = path.join(root, '.claude', 'basic-design.local.md');
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return { configured: false, driveFolderId: null };
  }
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== '---') {
    return { configured: false, driveFolderId: null };
  }
  for (const line of lines.slice(1)) {
    if (line === '---') break;
    const m = line.match(/^drive_folder_id:\s*(.*)$/);
    if (m) {
      let value = m[1].trim();
      // 引用符付きなら引用符内をそのまま採用(行末コメントは引用符の外なので落ちる)
      const quoted = value.match(/^(["'])(.*?)\1/);
      if (quoted) {
        value = quoted[2];
      } else {
        value = value.replace(/\s*#.*$/, '').trim();
      }
      if (value !== '') {
        return { configured: true, driveFolderId: value };
      }
    }
  }
  return { configured: false, driveFolderId: null };
}

const root = process.argv[2] ?? process.cwd();
process.stdout.write(JSON.stringify(readDriveConfig(root)) + '\n');
