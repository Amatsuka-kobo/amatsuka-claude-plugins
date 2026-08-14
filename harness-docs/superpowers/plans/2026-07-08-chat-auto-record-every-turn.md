# chat 自動記録の毎ターン化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** task-utility の Stop フックを「3ターン以上で一度だけ記録」から「1ターン目から毎ターン未記録分を追記」に変更する。

**Architecture:** メイントランスクリプトを1回走査し、「最後の実質ユーザー発言の行位置」と「最後の記録イベントの行位置」を比較する位置比較方式。記録イベントは docs/chat/ への Write/Edit に加え、chat-recorder サブエージェントへの Agent ディスパッチも認める(サブエージェントのトランスクリプトは別ファイルに保存され、その Write はメイントランスクリプトから見えないため — これが現行実装の潜在バグの修正でもある)。

**Tech Stack:** Node.js(依存なし・単一スクリプト)、`node --test` + `node:assert/strict`

**スペック:** `docs/superpowers/specs/2026-07-08-chat-auto-record-every-turn-design.md`

## Global Constraints

- Anthropic API・`claude` CLI 直接操作を導入しない(リポジトリ CLAUDE.md の制約。今回は既存機構の変更のみなので新規依存なし)
- テスト実行コマンド: `node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`
- スクリプト系全体の回帰確認: `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs plugins/task-utility/hooks/scripts/*.test.mjs`
- コミットメッセージは既存の Conventional Commits 形式(`feat(task-utility): ...` / `docs(task-utility): ...`)に従う

---

### Task 1: フック判定ロジックの毎ターン化(位置比較方式)

**Files:**
- Modify: `plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`(全面書き換え)
- Modify: `plugins/task-utility/hooks/scripts/check-chat-recorded.mjs`(全面書き換え)

**Interfaces:**
- Consumes: Stop フックの stdin JSON(`transcript_path`, `cwd`, `stop_hook_active`)、環境変数 `CLAUDE_PROJECT_DIR` / `CLAUDE_PLUGIN_ROOT`
- Produces: 未記録ターンがあるとき stdout に `{"decision":"block","reason":"..."}`。reason には `task-utility:chat-recorder` / `extract-conversation.mjs` / 追記指示を含む(Task 2 の文言と整合)

- [ ] **Step 1: テストを新仕様に書き換える(失敗するテストを先に書く)**

`plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs` を以下の内容で丸ごと置き換える:

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`
Expected: FAIL。少なくとも「ユーザー発言1回・未記録でも block を出す」(旧実装は3ターン未満で沈黙)、「記録イベントの後に新しい発言があれば再度 block する」(旧実装は一度記録すると永久に沈黙)、「chat-recorder へのディスパッチも記録イベントとして通す」の reason 文言不一致等が落ちる。

- [ ] **Step 3: フックスクリプトを位置比較方式に書き換える**

`plugins/task-utility/hooks/scripts/check-chat-recorded.mjs` を以下の内容で丸ごと置き換える:

```js
#!/usr/bin/env node
// Stop フック: 最後の記録イベントより後にユーザー発言が残ったままターンが終わるとき、
// 軽量モデルの chat-recorder サブエージェントへの記録・追記委譲を差し戻しで促す。
// docs/chat/ ディレクトリが存在するプロジェクトでのみ働く(プロジェクト単位のオプトイン)。
import fs from 'node:fs';
import path from 'node:path';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

// 差し戻しは 1 ストップにつき 1 回まで(記録できない事情があるときの無限ループ防止)
if (input.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
if (!fs.existsSync(path.join(projectDir, 'docs', 'chat'))) process.exit(0);

const transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

// 「最後の実質ユーザー発言」と「最後の記録イベント」の行位置を比較する。
// 記録イベントは docs/chat/ への Write/Edit、または chat-recorder へのディスパッチ。
// サブエージェントのトランスクリプトは別ファイルに保存されるため、chat-recorder が
// 行った Write はここからは見えない — ディスパッチ自体を記録の証跡として扱う。
let lastUserTurn = -1;
let lastRecord = -1;
let lineNo = 0;
for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
  lineNo++;
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  const msg = e.message;
  if (!msg || e.isSidechain) continue;

  if (e.type === 'user' && typeof msg.content === 'string') {
    const text = msg.content.trim();
    if (text && !text.startsWith('<') && !e.isMeta) lastUserTurn = lineNo;
  } else if (e.type === 'assistant' && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type !== 'tool_use') continue;
      if (
        (c.name === 'Write' || c.name === 'Edit') &&
        typeof c.input?.file_path === 'string' &&
        c.input.file_path.replaceAll('\\', '/').includes('docs/chat/')
      ) {
        lastRecord = lineNo;
      } else if (c.name === 'Agent' && String(c.input?.subagent_type ?? '').includes('chat-recorder')) {
        lastRecord = lineNo;
      }
    }
  }
}

if (lastUserTurn === -1 || lastUserTurn <= lastRecord) process.exit(0);

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || '<task-utility plugin root>';
const reason = [
  'この会話には docs/chat/ にまだ記録されていないターンがあります(task-utility chat スキルの対象です)。',
  '記録はメインコンテキストで行わず、記録専用サブエージェントに委譲してください:',
  'Agent ツールで subagent_type "task-utility:chat-recorder" を起動し、プロンプトに次の情報を含めること。',
  `- トランスクリプト: ${transcriptPath}`,
  `- 抽出コマンド: node "${pluginRoot}/scripts/extract-conversation.mjs" "${transcriptPath}"`,
  `- スキル定義: ${pluginRoot}/skills/chat/SKILL.md`,
  '- ユーザーの GitHub ユーザー名、日付、この会話の成果物(ファイルパス・コミット)、前提となる資料',
  '- 既存の記録ファイルがあれば新規作成せず、未記録のターンだけをそのファイルに追記するよう指示すること。',
  'トランスクリプトが読めない等、技術的に記録できない場合のみ、その理由をユーザーに一言伝えてから終了して構いません。',
].join('\n');

console.log(JSON.stringify({ decision: 'block', reason }));
```

- [ ] **Step 4: テストを実行して全件パスを確認する**

Run: `node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`
Expected: PASS(10 tests)

- [ ] **Step 5: スクリプト系テスト全体の回帰を確認する**

Run: `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs plugins/task-utility/hooks/scripts/*.test.mjs`
Expected: PASS(既存テストに影響なし)

- [ ] **Step 6: コミット**

```bash
git add plugins/task-utility/hooks/scripts/check-chat-recorded.mjs plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs
git commit -m "feat(task-utility): chat 自動記録を1ターン目から毎ターン追記に変更

3ターン閾値と recorded フラグを廃し、最後のユーザー発言と最後の記録
イベントの位置比較に変更。chat-recorder へのディスパッチを記録イベント
として認識することで、サブエージェントの Write がメイントランスクリプト
に残らず毎ターン重複差し戻しになる潜在バグも修正。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: SKILL.md と hooks.json の方針文言を全会話記録に更新

**Files:**
- Modify: `plugins/task-utility/skills/chat/SKILL.md:3`(frontmatter の description のみ)
- Modify: `plugins/task-utility/hooks/hooks.json:2`(description のみ)

**Interfaces:**
- Consumes: なし(文言のみの変更。Task 1 と独立してレビュー可能)
- Produces: スキル/フックの説明文が「1ターン目から毎ターン追記」の方針と一致する

- [ ] **Step 1: SKILL.md の description を書き換える**

`plugins/task-utility/skills/chat/SKILL.md` の 3 行目:

変更前:

```yaml
description: AIとの会話をMarkdown形式でdocs/chat/に永続記録するスキル。設計・実装・調査・ディスカッションなど複数ターンにわたる会話を行ったとき、またはユーザーが会話の記録・追記を求めたときに必ず使用する。単純な一問一答や1行の修正には不要。
```

変更後:

```yaml
description: AIとの会話をMarkdown形式でdocs/chat/に永続記録するスキル。docs/chat/ を持つプロジェクトでは1ターン目から全ての会話が対象で、毎ターン未記録分を追記して常に最新の状態を保つ。ユーザーが会話の記録・追記を求めたときにも必ず使用する。
```

本文(記録形式・粒度契約・テンプレート)は変更しない。

- [ ] **Step 2: hooks.json の description を書き換える**

`plugins/task-utility/hooks/hooks.json` の 2 行目:

変更前:

```json
  "description": "chat スキルの自動適用: docs/chat/ を持つプロジェクトで、実質的な会話が未記録のままターンが終わるとき chat-recorder への記録委譲を促す",
```

変更後:

```json
  "description": "chat スキルの自動適用: docs/chat/ を持つプロジェクトで、未記録のユーザー発言が残ったままターンが終わるとき chat-recorder への記録・追記委譲を促す",
```

- [ ] **Step 3: JSON の構文と関連テストを確認する**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/task-utility/hooks/hooks.json','utf8')); console.log('hooks.json OK')" && node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`
Expected: `hooks.json OK` に続きテスト全件 PASS

- [ ] **Step 4: コミット**

```bash
git add plugins/task-utility/skills/chat/SKILL.md plugins/task-utility/hooks/hooks.json
git commit -m "docs(task-utility): chat スキルの説明を全会話・毎ターン追記の方針に更新

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 動作確認(実装後・手動)

フック設定はセッション開始時に読み込まれるため、実装後に **新しい Claude Code セッション** を開始して確認する:

1. このリポジトリで新セッションを開き、記録依頼をせず 1 ターンだけ実質的な質問をする
2. ターン終了時に Stop フックが差し戻し、`task-utility:chat-recorder` が起動して `docs/chat/YYYY/MMDD/*.md` が作成されることを確認
3. 続けて 2 ターン目を行い、ターン終了時に同じファイルへ追記されること(新規ファイルが増えないこと)を確認
