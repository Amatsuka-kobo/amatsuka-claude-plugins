import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extract-conversation.mjs');

function run(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ext-')), 't.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const res = spawnSync('node', [SCRIPT, file], { encoding: 'utf8' });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  return res.stdout;
}

const user = (text, extra = {}) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text }, ...extra });
const assistant = (content, extra = {}) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content }, ...extra });

test('ユーザー発言は原文のまま、ハーネス注入は除外される', () => {
  const out = run([
    user('<command-name>/model</command-name>'),
    user('これは 原文の  発言です。改変されないこと。'),
    user('メタ発言', { isMeta: true }),
  ]);
  assert.match(out, /## USER\n\nこれは 原文の  発言です。改変されないこと。/);
  assert.doesNotMatch(out, /command-name|メタ発言/);
});

test('AI の text と tool_use ヒントが出力され、thinking は出ない', () => {
  const out = run([
    assistant([
      { type: 'thinking', thinking: '内心' },
      { type: 'text', text: '結論を報告します。' },
      { type: 'tool_use', name: 'Bash', input: { description: 'テストを実行' } },
      { type: 'tool_use', name: 'Write', input: { file_path: '/x/y.md' } },
    ]),
  ]);
  assert.match(out, /## ASSISTANT\n\n結論を報告します。/);
  assert.match(out, /\(tool: Bash — テストを実行\)/);
  assert.match(out, /\(tool: Write — \/x\/y\.md\)/);
  assert.doesNotMatch(out, /内心/);
});

test('連続する ASSISTANT エントリは1セクションに結合される', () => {
  const out = run([
    user('質問'),
    assistant([{ type: 'text', text: '前半。' }]),
    assistant([{ type: 'text', text: '後半。' }]),
  ]);
  assert.equal(out.match(/## ASSISTANT/g).length, 1);
  assert.match(out, /前半。\n\n後半。/);
});

test('サブエージェントの往復(isSidechain)は含めない', () => {
  const out = run([
    user('本編の発言'),
    user('サブエージェントへの指示', { isSidechain: true }),
    assistant([{ type: 'text', text: 'サブの応答' }], { isSidechain: true }),
  ]);
  assert.match(out, /本編の発言/);
  assert.doesNotMatch(out, /サブ/);
});
