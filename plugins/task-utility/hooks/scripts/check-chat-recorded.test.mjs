import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-chat-recorded.mjs');

const user = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const toolUse = (name, filePath) =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, input: { file_path: filePath } }] },
  });

function run({ lines, withChatDir = true, stopHookActive = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-hook-'));
  if (withChatDir) fs.mkdirSync(path.join(dir, 'docs', 'chat'), { recursive: true });
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, lines.join('\n') + '\n');
  const res = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ transcript_path: transcript, cwd: dir, stop_hook_active: stopHookActive }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/plugin/root' },
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const THREE_TURNS = [user('質問1です'), user('質問2です'), user('質問3です')];

test('docs/chat がないプロジェクトでは何もしない', () => {
  const res = run({ lines: THREE_TURNS, withChatDir: false });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('実質3ターン以上・未記録なら block を出す', () => {
  const res = run({ lines: THREE_TURNS });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /task-utility:chat-recorder/);
  assert.match(out.reason, /extract-conversation\.mjs/);
});

test('docs/chat/ への Write があれば記録済みとして通す', () => {
  const res = run({ lines: [...THREE_TURNS, toolUse('Write', '/p/docs/chat/2026/0708/x.md')] });
  assert.equal(res.stdout.trim(), '');
});

test('docs/chat/ への Edit(追記)も記録済みとして通す', () => {
  const res = run({ lines: [...THREE_TURNS, toolUse('Edit', '/p/docs/chat/2026/0708/x.md')] });
  assert.equal(res.stdout.trim(), '');
});

test('ユーザー発言が3未満なら口出ししない', () => {
  const res = run({ lines: [user('質問1です'), user('質問2です')] });
  assert.equal(res.stdout.trim(), '');
});

test('ハーネス注入(< 始まり)やツール結果はターンに数えない', () => {
  const lines = [
    user('<command-name>/clear</command-name>'),
    user('<local-command-stdout>x</local-command-stdout>'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } }),
    user('質問1です'),
    user('質問2です'),
  ];
  const res = run({ lines });
  assert.equal(res.stdout.trim(), '');
});

test('stop_hook_active のときは再差し戻ししない', () => {
  const res = run({ lines: THREE_TURNS, stopHookActive: true });
  assert.equal(res.stdout.trim(), '');
});

test('壊れた stdin でも落ちず素通しする', () => {
  const res = spawnSync('node', [SCRIPT], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});
