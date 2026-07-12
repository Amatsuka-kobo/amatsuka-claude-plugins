# issue-split スキル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** task-utility プラグインに、既存の GitHub Issue をディスカッションでタスク分解し、子 Issue を起票して Sub-issues としてリンクするスキル `issue-split` を追加する。

**Architecture:** issue-craft スキルと同じ「事実はスクリプト・判断はスキル」構造。環境チェックは既存 `check-issue-env.mjs` を再利用し、型ミスが起きやすい Sub-issues リンク(REST API 2 ステップ)だけを新規スクリプト `link-sub-issue.mjs` に閉じ込める。対話フロー・STOP 規律は SKILL.md に記述する。

**Tech Stack:** Node.js(ESM, 依存ゼロ)、node:test、gh CLI(スクリプトが spawn)、Claude Code プラグインの SKILL.md 形式。

**Spec:** `docs/superpowers/specs/2026-07-12-issue-split-design.md`

## Global Constraints

- Anthropic API を直接使う実装は採用しない(LLM 処理は Claude Code の機構に閉じる)— CLAUDE.md の必須要件
- スクリプトは**常に exit 0** で JSON を stdout に返し、STOP 等の判断はスキル側が行う(`check-issue-env.mjs` と同じ方針)
- スクリプトは npm 依存を追加しない(node 標準モジュールのみ)
- コメント・ドキュメント・SKILL.md は日本語(リポジトリの既存スタイル)
- `plugins/task-utility/.claude-plugins/plugin.json` のバージョンは `1.1.0-dev` → `1.2.0-dev`(マイナー更新。メジャーは上げない)
- テストランナーは `node --test`(vitest ではない)

---

### Task 1: link-sub-issue.mjs(Sub-issues リンクスクリプト)

**Files:**
- Create: `plugins/task-utility/scripts/link-sub-issue.mjs`
- Test: `plugins/task-utility/scripts/link-sub-issue.test.mjs`

**Interfaces:**
- Consumes: gh CLI(`gh api`)。PATH 上に必要
- Produces: CLI `node link-sub-issue.mjs <owner/repo> <親番号> <子番号>`。stdout に JSON を返す(常に exit 0):
  - 成功: `{ ok: true, parent: <number>, child: <number>, subIssueId: <number> }`
  - 失敗: `{ ok: false, step: 'args' | 'get-child' | 'link', error: <string> }`
  - Task 2 の SKILL.md はこの JSON 契約(特に `ok` / `error`)に依存する

- [ ] **Step 1: 失敗するテストを書く**

`plugins/task-utility/scripts/link-sub-issue.test.mjs` を以下の内容で作成する:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'link-sub-issue.mjs');

// スクリプトを起動し stdout の JSON を返す。binDir 指定時は PATH をそのディレクトリだけに差し替える(gh モック用)
function runScript(args, binDir) {
  const env = binDir ? { ...process.env, PATH: binDir } : process.env;
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
  assert.equal(res.status, 0, `exit 0 であること: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'link-sub-'));
}

// 渡した行を gh として置いた bin ディレクトリを作る。行中の __DIR__ は実ディレクトリに展開する
// (PATH をこのディレクトリだけに差し替えるため、dirname 等の外部コマンドはモック内で使えない)
function fakeGh(scriptLines) {
  const dir = tmpdir();
  const file = path.join(dir, 'gh');
  fs.writeFileSync(file, scriptLines.join('\n').replaceAll('__DIR__', dir) + '\n');
  fs.chmodSync(file, 0o755);
  return dir;
}

test('引数なしでは ok: false / step: args(exit 0)', () => {
  const out = runScript([]);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'args');
});

test('スラッグ形式でないリポジトリ指定は args エラー', () => {
  const out = runScript(['not-a-slug', '1', '2']);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'args');
});

test('Issue 番号が正の整数でなければ args エラー', () => {
  assert.equal(runScript(['o/r', 'abc', '2']).step, 'args');
  assert.equal(runScript(['o/r', '1', '-5']).step, 'args');
  assert.equal(runScript(['o/r', '1.5', '2']).step, 'args');
});

test('gh が PATH に無ければ step: get-child の失敗として返る', () => {
  const out = runScript(['o/r', '1', '2'], tmpdir()); // 空ディレクトリ = gh なし
  assert.equal(out.ok, false);
  assert.equal(out.step, 'get-child');
});

test('正常系: 子の内部 ID を取得し、-F sub_issue_id=<ID> で親に POST する', () => {
  const dir = fakeGh([
    '#!/bin/sh',
    'echo "$@" >> "__DIR__/calls.log"',
    'case "$*" in',
    '  "api repos/o/r/issues/12") echo \'{"id": 999888, "number": 12}\' ;;',
    '  *sub_issues*) echo \'{}\' ;;',
    '  *) exit 1 ;;',
    'esac',
  ]);
  const out = runScript(['o/r', '5', '12'], dir);
  assert.deepEqual(out, { ok: true, parent: 5, child: 12, subIssueId: 999888 });
  const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n');
  assert.equal(calls[0], 'api repos/o/r/issues/12');
  assert.equal(calls[1], 'api -X POST repos/o/r/issues/5/sub_issues -F sub_issue_id=999888');
});

test('子 Issue の取得が失敗したら step: get-child で stderr を返す', () => {
  const dir = fakeGh(['#!/bin/sh', 'echo "Not Found (HTTP 404)" >&2', 'exit 1']);
  const out = runScript(['o/r', '5', '999'], dir);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'get-child');
  assert.match(out.error, /Not Found/);
});

test('リンク POST が失敗したら step: link で stderr を返す', () => {
  const dir = fakeGh([
    '#!/bin/sh',
    'case "$*" in',
    '  "api repos/o/r/issues/12") echo \'{"id": 999888}\' ;;',
    '  *) echo "sub-issues not supported (HTTP 404)" >&2; exit 1 ;;',
    'esac',
  ]);
  const out = runScript(['o/r', '5', '12'], dir);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'link');
  assert.match(out.error, /not supported/);
});

test('子 Issue の JSON が壊れていたら step: get-child のパース失敗として返る', () => {
  const dir = fakeGh(['#!/bin/sh', 'echo "not json"']);
  const out = runScript(['o/r', '5', '12'], dir);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'get-child');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/task-utility/scripts/link-sub-issue.test.mjs`
Expected: 全テスト FAIL(`link-sub-issue.mjs` が存在しないため spawnSync が module not found で exit ≠ 0)

- [ ] **Step 3: 最小実装を書く**

`plugins/task-utility/scripts/link-sub-issue.mjs` を以下の内容で作成する:

```js
#!/usr/bin/env node
// GitHub Sub-issues のリンク(親 Issue への子 Issue 登録)を gh api で行い、結果を JSON で stdout に出力する。
// REST API の 2 ステップ(子 Issue の内部 ID 取得 → 親への POST)と、sub_issue_id を数値型で送るための
// -F(型付きフィールド)をここに閉じ込める。sub_issue_id は Issue「番号」ではなく内部「ID」である点に注意。
// 成否の判断(STOP するか等)はスキル側が行い、このスクリプトは常に exit 0。
// 使い方: node link-sub-issue.mjs <owner/repo> <親番号> <子番号>
import { spawnSync } from 'node:child_process';

function fail(step, error) {
  console.log(JSON.stringify({ ok: false, step, error }, null, 2));
  process.exit(0);
}

function parseIssueNumber(raw, label) {
  const n = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isInteger(n) || n <= 0) {
    fail('args', `${label} は正の整数で指定してください: ${raw ?? '(missing)'}`);
  }
  return n;
}

const [slug, parentArg, childArg] = process.argv.slice(2);
if (!/^[^/\s]+\/[^/\s]+$/.test(slug ?? '')) {
  fail('args', `リポジトリは owner/repo 形式で指定してください: ${slug ?? '(missing)'}`);
}
const parent = parseIssueNumber(parentArg, '親 Issue 番号');
const child = parseIssueNumber(childArg, '子 Issue 番号');

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
function gh(...args) {
  const res = spawnSync('gh', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, error: (res.stderr || res.stdout || String(res.error ?? 'gh の実行に失敗')).trim() };
  }
  return { ok: true, stdout: res.stdout };
}

// 1. 子 Issue の内部 ID を取得(Sub-issues API は Issue 番号ではなく内部 ID を要求する)
const childRes = gh('api', `repos/${slug}/issues/${child}`);
if (!childRes.ok) fail('get-child', childRes.error);
let childId;
try {
  childId = JSON.parse(childRes.stdout).id;
} catch (e) {
  fail('get-child', `子 Issue 応答の JSON パースに失敗: ${e.message}`);
}
if (!Number.isInteger(childId)) fail('get-child', `子 Issue の内部 ID が取得できません: ${childId}`);

// 2. 親 Issue に Sub-issue としてリンク(-F で数値型のまま送る。-f だと文字列になり API に拒否される)
const linkRes = gh('api', '-X', 'POST', `repos/${slug}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${childId}`);
if (!linkRes.ok) fail('link', linkRes.error);

console.log(JSON.stringify({ ok: true, parent, child, subIssueId: childId }, null, 2));
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test plugins/task-utility/scripts/link-sub-issue.test.mjs`
Expected: 全 8 テスト PASS

- [ ] **Step 5: 既存テストも含めて全部通ることを確認する**

Run: `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs plugins/revelation/hooks/scripts/*.test.mjs`
Expected: 全テスト PASS(新規 8 件を含む)

- [ ] **Step 6: コミット**

```bash
git add plugins/task-utility/scripts/link-sub-issue.mjs plugins/task-utility/scripts/link-sub-issue.test.mjs
git commit -m "feat: Sub-issues リンク用スクリプト link-sub-issue.mjs を追加"
```

---

### Task 2: issue-split スキル本体(SKILL.md)

**Files:**
- Create: `plugins/task-utility/skills/issue-split/SKILL.md`

**Interfaces:**
- Consumes: `${CLAUDE_PLUGIN_ROOT}/scripts/check-issue-env.mjs`(既存。JSON: `isGitRepo` / `repoSlug` / `ghInstalled` / `ghAuthenticated` / `templates` / `blankIssuesEnabled`)、`${CLAUDE_PLUGIN_ROOT}/scripts/link-sub-issue.mjs`(Task 1。JSON: `ok` / `step` / `error` / `subIssueId`)
- Produces: スキル定義ファイルのみ(コードからの被参照なし)

- [ ] **Step 1: SKILL.md を書く**

`plugins/task-utility/skills/issue-split/SKILL.md` を以下の内容で作成する:

```markdown
---
name: issue-split
description: ユーザーが既存の GitHub Issue のタスク分解・子 Issue 作成・Sub-issue 化を依頼したときに必ず使用するスキル。分解対象の親 Issue(番号または URL)を起点に、ユーザーとのディスカッションで分解設計を練り上げ、子 Issue を起票して GitHub の Sub-issues として親にリンクする。ゼロから Issue を起票する場合は issue-craft を使う。明示的な依頼があったときのみ使い、自律的には発動しない。
---

# Issue Split — GitHub Issue のタスク分解

## 目的

既存の親 Issue を出発点に、ディスカッションでタスク分解を練り上げ、子 Issue 群を起票して GitHub 公式の Sub-issues として親にリンクする。

## 大原則

- **ディスカッションはユーザーが使用する言語を厳守する**。有意義な対話のための絶対条件であり、Issue 本文の言語(手順 4 で確認)とは独立した規律
- **ユーザーの明示的な承認を得るまで起票しない**。起票は取り消しの効きにくい外部公開行為である
- **親 Issue の本文は変更しない**。親子関係の表現は Sub-issues リンクのみで行う
- STOP するときは必ず「理由+次にユーザーがすべきこと」を伝えて終了する

## 手順

### 1. 環境チェック

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-issue-env.mjs"
```

出力 JSON の事実に基づいて判断する:

- `isGitRepo: false` → git リポジトリ化(`git init` とリモート設定)を推奨して **STOP**
- `repoSlug: null`(リモート未設定、または GitHub 以外のリモート)→ 状況を説明し、GitHub リポジトリの作成・リモート設定(`gh repo create` 等)を案内して **STOP**

### 2. 操作手段の決定

自分の利用可能ツール一覧を確認し、次の優先順で決める:

1. GitHub 操作系の MCP Tool で **Issue の作成と Sub-issue リンクの両方**ができるなら、それを使う
2. Issue 作成だけできる MCP Tool の場合、作成は MCP Tool・リンクは `link-sub-issue.mjs`(gh を使用)を併用する。ただし JSON が `ghInstalled: false` または `ghAuthenticated: false` なら、Sub-issues リンクを張れない旨を説明し、gh の導入・認証を案内して **STOP**
3. MCP Tool がなければ `gh` コマンド。`ghInstalled: false` なら導入手順を、`ghAuthenticated: false` なら `gh auth login` の実行を案内して **STOP**

### 3. 親 Issue の取得

ユーザーが指定した番号 / URL から親 Issue を読み取る(`gh issue view <番号>`、または MCP Tool)。あわせて既存の Sub-issues も確認する(`gh api repos/<owner/repo>/issues/<番号>/sub_issues`、または MCP Tool)。

- 親 Issue が存在しない・アクセスできない → 生のエラーを伝えて **STOP**
- 既に Sub-issues がある → 一覧を提示し、追加分解でよいかユーザーに確認してから続行

### 4. 最初の確認(1 回の質問にまとめる)

ディスカッションに入る前に、AskUserQuestion で次を確認する:

- **子 Issue 本文の言語**: 親 Issue・README からリポジトリの言語を推定し、推奨案として提示して確認する。ディスカッションの言語はこれと無関係にユーザーの言語のまま
- **Issue Template**: 子 Issue はタスク型の軽量本文(後述)なので「テンプレートを使わない」を推奨とする。ただし JSON の `blankIssuesEnabled: false` のときは「使わない」を選択肢に出さず、`templates` 一覧(`name`・`about` を添える)から選択してもらう

### 5. 分解たたき台の提示 → ディスカッション

親 Issue を読んだら、**まず自分の分解案を提示する**。各子 Issue につきタイトル+スコープ 1 行+子同士の依存関係。それを叩き台にディスカッションして練り上げる。

分解の適切さのチェックリスト(すべて満たすまで練る):

- 各子 Issue が独立してクローズできる
- 粒度が揃っている(1 つだけ巨大な子 Issue がない)
- 子の完了条件の合計が親の完了条件をカバーする(漏れがない)
- 親のスコープ外のタスクが混ざっていない

分解の議論中に親 Issue 自体の不備(完了条件が曖昧など)が見つかった場合は指摘してよいが、親本文の修正はこのスキルの範囲外(ユーザーに委ねる)。

### 6. 全ドラフト一覧提示 → 一括承認

各子 Issue のタイトル・本文・ラベル案を**全文**一覧で提示し、一括で承認を得る(「2 番だけ直して」のような個別修正に対応する)。

子 Issue の本文はタスク型の軽量本文とする:

- 目的(親のどの部分を担うか)
- 完了条件
- 末尾に `Parent: #親番号`(Sub-issues リンクとは別に、本文からも辿れるようにする)

テンプレートを使う場合はテンプレートの項目構成に従いつつ、上記 3 点を必ず含める。

- ラベルはリポジトリの既存ラベル(`gh label list` または MCP Tool)から提案する。存在しないラベルを勝手に作らない
- アサイン・マイルストーンはユーザーから明示的に指示されたときだけ設定する

### 7. 起票 + リンク

承認された子 Issue を 1 件ずつ「作成 → 親にリンク」の順で処理する:

1. **作成**: MCP Tool、または `gh issue create --title <title> --body-file <一時ファイル> --label <label>`。gh の場合、本文は必ず一時ファイル経由(`--body-file`)で渡す(シェルのクォート事故防止)
2. **リンク**: MCP Tool、または:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/link-sub-issue.mjs" <owner/repo> <親番号> <子番号>
   ```

   出力 JSON が `ok: false` なら失敗。`error` を**そのまま**ユーザーに報告して停止する。勝手なリトライや代替手段(本文参照方式など)への切り替えをしない

全件完了したら、親 Issue の URL と子 Issue の URL 一覧を報告する。親 Issue の本文は更新しない(Sub-issues リンクにより GitHub UI 上で子一覧・進捗が表示される)。

### 8. 途中で失敗した場合

どこまで処理済みか(作成済み子 Issue の URL と、それぞれリンク済みかどうか)と、失敗した箇所・エラー内容を報告して停止する。作成済み Issue の削除(ロールバック)はしない。
```

- [ ] **Step 2: SKILL.md の構文確認**

Run: `head -5 plugins/task-utility/skills/issue-split/SKILL.md`
Expected: frontmatter(`---` / `name: issue-split` / `description: ...`)が正しく出力される

- [ ] **Step 3: コミット**

```bash
git add plugins/task-utility/skills/issue-split/SKILL.md
git commit -m "feat: 既存 Issue をタスク分解する issue-split スキルを追加"
```

---

### Task 3: README・バージョン更新

**Files:**
- Modify: `plugins/task-utility/README.md`(issue-craft 節の後に issue-split 節を追加、「動作確認」のテストコマンドに link-sub-issue.test.mjs を追加)
- Modify: `plugins/task-utility/.claude-plugins/plugin.json`(version: `1.1.0-dev` → `1.2.0-dev`)

**Interfaces:**
- Consumes: Task 1・Task 2 の成果物(説明対象として)
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: README に issue-split 節を追加する**

`plugins/task-utility/README.md` の `## issue-craft スキル` 節の直後に以下を挿入する:

```markdown
## issue-split スキル

既存の親 Issue(番号/URL 指定)をユーザーとのディスカッションでタスク分解し、子 Issue を起票して GitHub 公式の Sub-issues として親にリンクする(明示発動型)。親 Issue の本文は変更しない。環境チェックは issue-craft と共通の `scripts/check-issue-env.mjs`、Sub-issues リンクの REST API 2 ステップ(子の内部 ID 取得 → 親へ POST)は `scripts/link-sub-issue.mjs` に閉じている。詳細は `skills/issue-split/SKILL.md` を参照。
```

- [ ] **Step 2: README の「動作確認」コマンドを更新する**

既存の:

```bash
node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs \
            plugins/task-utility/scripts/extract-conversation.test.mjs \
            plugins/task-utility/scripts/check-issue-env.test.mjs
```

を以下に置き換える:

```bash
node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs \
            plugins/task-utility/scripts/extract-conversation.test.mjs \
            plugins/task-utility/scripts/check-issue-env.test.mjs \
            plugins/task-utility/scripts/link-sub-issue.test.mjs
```

- [ ] **Step 3: plugin.json のバージョンを上げる**

`plugins/task-utility/.claude-plugins/plugin.json` の `"version": "1.1.0-dev"` を `"version": "1.2.0-dev"` に変更する。

- [ ] **Step 4: README のコマンドが実際に通ることを確認する**

Run: README に書いた `node --test ...` コマンドをそのまま実行
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/task-utility/README.md plugins/task-utility/.claude-plugins/plugin.json
git commit -m "docs: issue-split の README 追記とバージョン 1.2.0-dev への更新"
```
