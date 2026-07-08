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
const agentDispatch = (subagentType) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: subagentType, prompt: '会話を記録して' } }],
    },
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

test('docs/chat がないプロジェクトでは何もしない', () => {
  const res = run({ lines: [user('質問です')], withChatDir: false });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('ユーザー発言1回・未記録でも block を出す', () => {
  const res = run({ lines: [user('質問です')] });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /task-utility:chat-recorder/);
  assert.match(out.reason, /extract-conversation\.mjs/);
  assert.match(out.reason, /追記/);
});

test('docs/chat/ への Write の後に新しい発言がなければ通す', () => {
  const res = run({ lines: [user('質問1です'), toolUse('Write', '/p/docs/chat/2026/0708/x.md')] });
  assert.equal(res.stdout.trim(), '');
});

test('docs/chat/ への Edit(追記)も記録イベントとして通す', () => {
  const res = run({ lines: [user('質問1です'), toolUse('Edit', '/p/docs/chat/2026/0708/x.md')] });
  assert.equal(res.stdout.trim(), '');
});

test('記録イベントの後に新しい発言があれば再度 block する', () => {
  const res = run({
    lines: [user('質問1です'), toolUse('Write', '/p/docs/chat/2026/0708/x.md'), user('質問2です')],
  });
  const out = JSON.parse(res.stdout);
  assert.equal(out.decision, 'block');
});

test('chat-recorder へのディスパッチも記録イベントとして通す', () => {
  const res = run({ lines: [user('質問1です'), agentDispatch('task-utility:chat-recorder')] });
  assert.equal(res.stdout.trim(), '');
});

test('chat-recorder 以外のサブエージェント起動は記録と見なさない', () => {
  const res = run({ lines: [user('質問1です'), agentDispatch('general-purpose')] });
  assert.equal(JSON.parse(res.stdout).decision, 'block');
});

test('ハーネス注入(< 始まり)やツール結果だけならターンがないものとして通す', () => {
  const lines = [
    user('<command-name>/clear</command-name>'),
    user('<local-command-stdout>x</local-command-stdout>'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } }),
  ];
  const res = run({ lines });
  assert.equal(res.stdout.trim(), '');
});

test('stop_hook_active のときは再差し戻ししない', () => {
  const res = run({ lines: [user('質問です')], stopHookActive: true });
  assert.equal(res.stdout.trim(), '');
});

test('壊れた stdin でも落ちず素通しする', () => {
  const res = spawnSync('node', [SCRIPT], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});
