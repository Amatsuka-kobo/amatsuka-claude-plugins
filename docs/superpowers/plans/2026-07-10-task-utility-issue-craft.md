# task-utility: issue-craft スキル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ユーザーとのブレインストーミングで GitHub Issue を練り上げて起票する `issue-craft` スキル(単一/複数起票対応)と、その環境チェックスクリプトを task-utility プラグインに追加する。

**Architecture:** 事実収集(git リポジトリ判定・リモート・gh・Issue テンプレート)は依存ゼロの Node スクリプト `check-issue-env.mjs` が JSON で返し、判断(STOP・手段選択・対話)は SKILL.md の指示でモデルが行う。スクリプトはプラグイン直下 `scripts/` に置き、将来の Issue 分解スキルと共用する。

**Tech Stack:** Node.js 標準モジュールのみ(`node:child_process`, `node:fs`, `node:path`)、`node --test` + `node:assert/strict`、Claude Code スキル(SKILL.md)。

**Spec:** `docs/superpowers/specs/2026-07-10-task-utility-issue-craft-design.md`

## Global Constraints

- 依存パッケージを追加しない(Node 標準モジュールのみ)。YAML パーサも入れない(トップレベルキーの簡易抽出で足りる)
- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装を持ち込まない(リポジトリ CLAUDE.md の制約)
- スクリプトは**常に exit 0** で JSON を stdout に返す。STOP の判断はスキル側
- コード内コメント・テスト名は既存スクリプト(`extract-conversation.mjs`)にならい日本語
- コミットメッセージは既存の慣習(`feat(task-utility): ...` / `chore: ...`)に従い、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける
- テストは `node --test plugins/task-utility/scripts/check-issue-env.test.mjs` で実行(既存グロブ `plugins/task-utility/scripts/*.test.mjs` に乗る)

---

### Task 1: check-issue-env.mjs — git リポジトリ / リモート / repoSlug の判定

**Files:**
- Create: `plugins/task-utility/scripts/check-issue-env.mjs`
- Test: `plugins/task-utility/scripts/check-issue-env.test.mjs`

**Interfaces:**
- Produces: `node check-issue-env.mjs [projectDir]` → stdout に JSON 1 個。このタスクで入るキー: `isGitRepo: boolean`, `remoteUrl: string|null`, `repoSlug: string|null`(`"owner/repo"` 形式。GitHub 以外・リモート未設定は `null`)。exit code は常に 0
- Produces(テストヘルパ、Task 2/3 が再利用): `runScript(cwd, pathDirs?)` — スクリプトを `process.execPath` で起動し stdout の JSON をパースして返す。`pathDirs` 省略時は現在の PATH をそのまま使う

- [ ] **Step 1: 失敗するテストを書く**

`plugins/task-utility/scripts/check-issue-env.test.mjs` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-issue-env.mjs');

// スクリプトを起動し stdout の JSON を返す。pathDirs 指定時は PATH を差し替える(gh 検出テスト用)
function runScript(cwd, pathDirs) {
  const env = pathDirs
    ? { ...process.env, PATH: pathDirs.join(path.delimiter) }
    : process.env;
  const res = spawnSync(process.execPath, [SCRIPT, cwd], { encoding: 'utf8', env });
  assert.equal(res.status, 0, `exit 0 であること: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue-env-'));
}

function gitRepo(remoteUrl) {
  const dir = tmpdir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remoteUrl) execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir });
  return dir;
}

test('git リポジトリでないディレクトリでは isGitRepo: false', () => {
  const out = runScript(tmpdir());
  assert.equal(out.isGitRepo, false);
  assert.equal(out.remoteUrl, null);
  assert.equal(out.repoSlug, null);
});

test('リモート未設定の git リポジトリでは remoteUrl/repoSlug が null', () => {
  const out = runScript(gitRepo(null));
  assert.equal(out.isGitRepo, true);
  assert.equal(out.remoteUrl, null);
  assert.equal(out.repoSlug, null);
});

test('GitHub SSH リモートから repoSlug を抽出する', () => {
  const out = runScript(gitRepo('git@github.com:owner/my-repo.git'));
  assert.equal(out.remoteUrl, 'git@github.com:owner/my-repo.git');
  assert.equal(out.repoSlug, 'owner/my-repo');
});

test('GitHub HTTPS リモート(.git なし)から repoSlug を抽出する', () => {
  const out = runScript(gitRepo('https://github.com/owner/my-repo'));
  assert.equal(out.repoSlug, 'owner/my-repo');
});

test('GitHub 以外のリモートでは repoSlug が null', () => {
  const out = runScript(gitRepo('git@gitlab.com:owner/repo.git'));
  assert.equal(out.remoteUrl, 'git@gitlab.com:owner/repo.git');
  assert.equal(out.repoSlug, null);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 全テスト FAIL(スクリプトが存在せず `res.status` が 0 でない、または stdout が空で JSON.parse が落ちる)

- [ ] **Step 3: 最小実装を書く**

`plugins/task-utility/scripts/check-issue-env.mjs` を新規作成:

```js
#!/usr/bin/env node
// GitHub Issue 起票に必要な環境の事実(git リポジトリ・リモート・gh・Issue テンプレート)を
// JSON で stdout に出力する。判断(STOP するか等)はスキル側が行い、このスクリプトは常に exit 0。
// issue-craft スキル専用ではなく、Issue 系スキル共通の前提チェックとして使う。
// 使い方: node check-issue-env.mjs [projectDir]
import { spawnSync } from 'node:child_process';

const cwd = process.argv[2] ?? process.cwd();

function git(...args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

const isGitRepo = git('rev-parse', '--is-inside-work-tree') === 'true';
const remoteUrl = isGitRepo ? git('remote', 'get-url', 'origin') : null;

// SSH (git@github.com:owner/repo.git) と HTTPS (https://github.com/owner/repo) の両形式に対応
const repoSlug = remoteUrl?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;

console.log(JSON.stringify({ isGitRepo, remoteUrl, repoSlug }, null, 2));
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 5 tests PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/task-utility/scripts/check-issue-env.mjs plugins/task-utility/scripts/check-issue-env.test.mjs
git commit -m "feat(task-utility): Issue 起票用の環境チェックスクリプト(git/リモート判定)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: check-issue-env.mjs — gh の検出(インストール・認証)

**Files:**
- Modify: `plugins/task-utility/scripts/check-issue-env.mjs`
- Test: `plugins/task-utility/scripts/check-issue-env.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 1 の `runScript(cwd, pathDirs)` ヘルパ(`pathDirs` で PATH を差し替えられる)
- Produces: JSON に `ghInstalled: boolean`, `ghAuthenticated: boolean` が加わる(gh 未インストール時は両方 `false`)

- [ ] **Step 1: 失敗するテストを書く**

`check-issue-env.test.mjs` の末尾に追記。PATH を制御した偽の `gh` 実行ファイルで、実機の gh の有無・認証状態に依存しない決定的なテストにする:

```js
// PATH 制御用: 実物の git だけを持つ bin ディレクトリを作る(スクリプトが spawn するのは git と gh のみ)
function fakeBin({ gh } = {}) {
  const dir = tmpdir();
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(realGit, path.join(dir, 'git'));
  if (gh) {
    const file = path.join(dir, 'gh');
    fs.writeFileSync(file, gh);
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

test('gh が PATH に無ければ ghInstalled/ghAuthenticated とも false', () => {
  const out = runScript(tmpdir(), [fakeBin()]);
  assert.equal(out.ghInstalled, false);
  assert.equal(out.ghAuthenticated, false);
});

test('gh はあるが未認証なら ghInstalled: true, ghAuthenticated: false', () => {
  const bin = fakeBin({ gh: '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nexit 1\n' });
  const out = runScript(tmpdir(), [bin]);
  assert.equal(out.ghInstalled, true);
  assert.equal(out.ghAuthenticated, false);
});

test('gh があり認証済みなら両方 true', () => {
  const bin = fakeBin({ gh: '#!/bin/sh\nexit 0\n' });
  const out = runScript(tmpdir(), [bin]);
  assert.equal(out.ghInstalled, true);
  assert.equal(out.ghAuthenticated, true);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 追加した 3 tests が FAIL(`out.ghInstalled` が `undefined`)。Task 1 の 5 tests は PASS のまま

- [ ] **Step 3: 最小実装を書く**

`check-issue-env.mjs` の `repoSlug` の行の後に追加し、`console.log` の JSON にキーを加える:

```js
// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
const ghInstalled = spawnSync('gh', ['--version'], { encoding: 'utf8' }).status === 0;
const ghAuthenticated =
  ghInstalled && spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0;

console.log(JSON.stringify({ isGitRepo, remoteUrl, repoSlug, ghInstalled, ghAuthenticated }, null, 2));
```

(元の `console.log(JSON.stringify({ isGitRepo, remoteUrl, repoSlug }, null, 2));` は削除して置き換える)

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 8 tests PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/task-utility/scripts/check-issue-env.mjs plugins/task-utility/scripts/check-issue-env.test.mjs
git commit -m "feat(task-utility): 環境チェックに gh の検出(インストール・認証)を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: check-issue-env.mjs — Issue テンプレートの検出と config.yml

**Files:**
- Modify: `plugins/task-utility/scripts/check-issue-env.mjs`
- Test: `plugins/task-utility/scripts/check-issue-env.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 1 の `runScript` / `gitRepo` ヘルパ
- Produces: JSON に `templates: Array<{file, name, about, title, labels: string[]}>`(ファイル名昇順)と `blankIssuesEnabled: boolean` が加わる。テンプレートは git リポジトリのルート直下 `.github/ISSUE_TEMPLATE/*.{md,yml,yaml}`(`config.yml` を除く)から検出。yml の `description` キーは `about` に正規化。`config.yml` またはその `blank_issues_enabled` キーが無ければ `blankIssuesEnabled: true`

- [ ] **Step 1: 失敗するテストを書く**

`check-issue-env.test.mjs` の末尾に追記:

```js
function withTemplates(files) {
  const dir = gitRepo('git@github.com:owner/repo.git');
  const tplDir = path.join(dir, '.github', 'ISSUE_TEMPLATE');
  fs.mkdirSync(tplDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tplDir, name), content);
  }
  return dir;
}

test('テンプレートが無ければ templates は空、blankIssuesEnabled は true', () => {
  const out = runScript(gitRepo('git@github.com:owner/repo.git'));
  assert.deepEqual(out.templates, []);
  assert.equal(out.blankIssuesEnabled, true);
});

test('md テンプレートの frontmatter からトップレベルキーを抽出する', () => {
  const dir = withTemplates({
    'bug_report.md': [
      '---',
      'name: バグ報告',
      'about: 動作不良の報告',
      'title: "[Bug] "',
      'labels: bug, help wanted',
      '---',
      '',
      '## 再現手順',
    ].join('\n'),
  });
  const out = runScript(dir);
  assert.deepEqual(out.templates, [
    {
      file: 'bug_report.md',
      name: 'バグ報告',
      about: '動作不良の報告',
      title: '[Bug] ',
      labels: ['bug', 'help wanted'],
    },
  ]);
});

test('yml フォームは description を about に正規化し、複数行 labels も拾う', () => {
  const dir = withTemplates({
    'feature.yml': [
      'name: 機能要望',
      'description: 新機能の提案',
      'labels:',
      '  - enhancement',
      '  - "needs triage"',
      'body:',
      '  - type: markdown',
      '    attributes:',
      '      value: 説明',
    ].join('\n'),
  });
  const out = runScript(dir);
  assert.equal(out.templates.length, 1);
  assert.equal(out.templates[0].name, '機能要望');
  assert.equal(out.templates[0].about, '新機能の提案');
  assert.deepEqual(out.templates[0].labels, ['enhancement', 'needs triage']);
});

test('inline 配列の labels もパースでき、config.yml は templates に含めない', () => {
  const dir = withTemplates({
    'task.yml': 'name: タスク\nlabels: ["chore", "docs"]\n',
    'config.yml': 'blank_issues_enabled: false\n',
  });
  const out = runScript(dir);
  assert.deepEqual(out.templates.map((t) => t.file), ['task.yml']);
  assert.deepEqual(out.templates[0].labels, ['chore', 'docs']);
  assert.equal(out.blankIssuesEnabled, false);
});

test('サブディレクトリから実行してもリポジトリルートのテンプレートを検出する', () => {
  const dir = withTemplates({ 'bug.md': '---\nname: Bug\n---\n' });
  const sub = path.join(dir, 'src');
  fs.mkdirSync(sub);
  const out = runScript(sub);
  assert.equal(out.templates.length, 1);
  assert.equal(out.templates[0].name, 'Bug');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 追加した 5 tests が FAIL(`out.templates` が `undefined`)。既存 8 tests は PASS のまま

- [ ] **Step 3: 最小実装を書く**

`check-issue-env.mjs` の `ghAuthenticated` の行の後に追加し、`console.log` を置き換える:

```js
import fs from 'node:fs';
import path from 'node:path';
```

(ファイル先頭の import 群に追加)

```js
// テンプレートはリポジトリルート直下の .github/ISSUE_TEMPLATE/ から検出する
const repoRoot = isGitRepo ? git('rev-parse', '--show-toplevel') : null;
const tplDir = repoRoot ? path.join(repoRoot, '.github', 'ISSUE_TEMPLATE') : null;

const unquote = (v) => v.replace(/^(["'])(.*)\1$/, '$2');

// YAML パーサは使わず、トップレベル(行頭・インデント無し)のキーのみ簡易抽出する。
// labels は inline 配列・カンマ区切り・直後の「- item」複数行リストの3形式に対応
function parseTopLevel(src) {
  const top = {};
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (!value) {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+-\s+/, '').trim());
      }
      value = items.join(',');
    }
    top[m[1]] = value;
  }
  return top;
}

function parseTemplate(file, content) {
  let src = content;
  if (file.endsWith('.md')) {
    src = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  }
  const top = parseTopLevel(src);
  const labelsRaw = top.labels?.match(/^\[(.*)\]$/)?.[1] ?? top.labels ?? '';
  return {
    file,
    name: unquote(top.name ?? ''),
    about: unquote(top.description ?? top.about ?? ''),
    title: unquote(top.title ?? ''),
    labels: labelsRaw.split(',').map((s) => unquote(s.trim())).filter(Boolean),
  };
}

let templates = [];
let blankIssuesEnabled = true;
if (tplDir && fs.existsSync(tplDir)) {
  const files = fs.readdirSync(tplDir).sort();
  templates = files
    .filter((f) => /\.(md|ya?ml)$/.test(f) && f !== 'config.yml')
    .map((f) => parseTemplate(f, fs.readFileSync(path.join(tplDir, f), 'utf8')));
  if (files.includes('config.yml')) {
    const config = parseTopLevel(fs.readFileSync(path.join(tplDir, 'config.yml'), 'utf8'));
    if (config.blank_issues_enabled !== undefined) {
      blankIssuesEnabled = config.blank_issues_enabled !== 'false';
    }
  }
}

console.log(
  JSON.stringify(
    { isGitRepo, remoteUrl, repoSlug, ghInstalled, ghAuthenticated, templates, blankIssuesEnabled },
    null,
    2,
  ),
);
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 13 tests PASS

- [ ] **Step 5: 実リポジトリでスモーク確認**

Run: `node plugins/task-utility/scripts/check-issue-env.mjs`
Expected: このリポジトリの実情を反映した JSON(`isGitRepo: true`、`repoSlug` はリモート設定に応じた値、exit 0)

- [ ] **Step 6: コミット**

```bash
git add plugins/task-utility/scripts/check-issue-env.mjs plugins/task-utility/scripts/check-issue-env.test.mjs
git commit -m "feat(task-utility): 環境チェックに Issue テンプレート検出を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: issue-craft スキル本体(SKILL.md)

**Files:**
- Create: `plugins/task-utility/skills/issue-craft/SKILL.md`

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-issue-env.mjs"` の JSON(Task 1〜3 の全キー)
- Produces: スキル `task-utility:issue-craft`(明示発動型)

- [ ] **Step 1: SKILL.md を作成する**

`plugins/task-utility/skills/issue-craft/SKILL.md` を以下の内容で新規作成する(自動テスト対象外。振る舞いは仕様書 `docs/superpowers/specs/2026-07-10-task-utility-issue-craft-design.md` に従う):

````markdown
---
name: issue-craft
description: ユーザーが GitHub Issue の起票・作成・下書きを依頼したときに必ず使用するスキル。ユーザーとのブレインストーミングで Issue の内容を練り上げ、プロジェクトのリモートリポジトリ(GitHub)に起票する。複数 Issue の一括起票にも対応。明示的な依頼があったときのみ使い、自律的には発動しない。
---

# Issue Craft — GitHub Issue の起票

## 目的

ユーザーから与えられた情報を出発点に、ブレインストーミングで内容を練り上げ、良い GitHub Issue としてリモートリポジトリに起票する。

## 大原則

- **ディスカッションはユーザーが使用する言語を厳守する**。有意義な対話のための絶対条件であり、Issue 本文の言語(手順 3 で確認)とは独立した規律
- **ユーザーの明示的な承認を得るまで起票しない**。起票は取り消しの効きにくい外部公開行為である
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

1. GitHub 操作系の MCP Tool(Issue の作成・更新ができるもの)があればそれを使う
2. なければ `gh` コマンド。ただし JSON が `ghInstalled: false` なら導入手順を、`ghAuthenticated: false` なら `gh auth login` の実行を案内して **STOP**

### 3. 最初の確認(1 回の質問にまとめる)

ブレインストーミングに入る前に、AskUserQuestion で次を確認する:

- **Issue Template**: JSON の `templates` 一覧(`name`・`about` を添える)から選択、または「テンプレートを使わない」。`blankIssuesEnabled: false` のときは「使わない」を選択肢に出さない。**テンプレートが 1 つ以上あるのにこの確認を飛ばして進めてはならない**
- **Issue 本文の言語**: README・既存 Issue からリポジトリの言語を推定し、推奨案として提示して確認する(例: 英語圏 OSS なら英語を推奨)。ディスカッションの言語はこれと無関係にユーザーの言語のまま

### 4. ブレインストーミング

自由対話で進めつつ、Issue 種別ごとの「埋まるべき観点」がすべて埋まるまで、**不足している観点だけを 1 問ずつ**質問する。選択式で聞ける場面では AskUserQuestion を使う。

| 種別 | 埋まるべき観点 |
| --- | --- |
| バグ報告 | 再現手順 / 期待動作 / 実際の動作 / 環境 / 影響範囲 |
| 機能要望 | 背景・課題 / 提案内容 / 代替案 / スコープ外 |
| タスク | 目的 / 完了条件 |

テンプレートを選択した場合は、テンプレートの項目をチェックリストとして扱う。

ブレスト中に次のいずれかに該当したら、1 つの Issue にまとめるのは重い可能性がある。**分割案(各 Issue のタイトル+スコープ 1 行)を提示し、ユーザーの承認が得られたら複数起票モード(後述)へ切り替える**。拒否されたら単一 Issue のまま続行する:

- 独立してクローズできる関心事が複数ある
- 担当や時期が分かれうる
- テンプレート種別(バグ / 機能要望など)が混在する

### 5. ドラフト提示 → 明示承認

タイトル・本文・ラベル案を**全文**提示し、ユーザーの承認を得る。

- ラベルはリポジトリの既存ラベル(`gh label list` または MCP Tool)から提案する。存在しないラベルを勝手に作らない
- アサイン・マイルストーンはユーザーから明示的に指示されたときだけ設定する

### 6. 起票

- MCP Tool、または `gh issue create --title <title> --body-file <一時ファイル> --label <label>`
- gh の場合、本文は必ず一時ファイル経由(`--body-file`)で渡す(シェルのクォート事故防止)
- 成功したら Issue の URL を報告する
- 失敗したら生のエラーをそのまま報告して停止する。勝手なリトライや代替手段への切り替えをしない

## 複数起票モード

入り方は 2 経路: (a) ユーザーの依頼が最初から複数件の起票を含む、(b) 手順 4 からの承認付き切り替え。

1. 環境チェック・操作手段・言語確認は全体で 1 回だけ(単一モードと共通)
2. **分割設計を先に確定する**: Issue の一覧(タイトル・スコープ・相互の依存関係)をユーザーと合意してから各論に入る
3. テンプレートは Issue ごとに確認する(種別が混在しうるため)。全件同じならまとめて指定してよい
4. 各 Issue のドラフトを順に練る(不足観点だけ質問する、という単一モードと同じ規律)
5. **全ドラフトを一覧で最終提示し、一括で承認を得る**(「2 番だけ直して」のような個別修正に対応する)
6. 承認後に一括起票し、URL の一覧を報告する

### Issue 間の相互参照

親トラッキング Issue は作らず、各 Issue の本文末尾に `Related: #番号` を入れる。番号は起票するまで確定しないため、次の順序で解決する:

1. Issue を順に起票する(先行 Issue の番号は判明済みなので、後続 Issue の本文には起票前に反映できる)
2. 全件起票後、先行 Issue の本文に後続 Issue の番号を追記する(`gh issue edit <番号> --body-file <一時ファイル>` または MCP Tool の Issue 更新)

### 途中で失敗した場合

どこまで起票済みか(URL 一覧)と、失敗した Issue・エラー内容を報告して停止する。起票済み Issue の削除(ロールバック)はしない。
````

- [ ] **Step 2: frontmatter の妥当性を確認する**

Run: `head -5 plugins/task-utility/skills/issue-craft/SKILL.md`
Expected: `---` で始まり、`name: issue-craft` と `description:`(1 行)が含まれる

- [ ] **Step 3: コミット**

```bash
git add plugins/task-utility/skills/issue-craft/SKILL.md
git commit -m "feat(task-utility): issue-craft スキルを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: README 追記・バージョンアップ・全体テスト

**Files:**
- Modify: `plugins/task-utility/README.md`
- Modify: `plugins/task-utility/.claude-plugins/plugin.json`

**Interfaces:**
- Consumes: Task 1〜4 の成果物(記載内容の根拠)

- [ ] **Step 1: README に issue-craft の節を追加する**

`plugins/task-utility/README.md` の「## chat スキル」節の直前に以下を挿入する:

```markdown
## issue-craft スキル

ユーザーとのブレインストーミングで GitHub Issue を練り上げ、リモートリポジトリに起票する(明示発動型)。単一/複数の一括起票に対応。環境の事実(git リポジトリ・リモート・gh・Issue テンプレート)は `scripts/check-issue-env.mjs` が JSON で返し、STOP 判断や対話はスキル側が行う。詳細は `skills/issue-craft/SKILL.md` を参照。
```

また「## 動作確認」のコマンドに `check-issue-env.test.mjs` を加える:

```markdown
## 動作確認

```bash
node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs \
            plugins/task-utility/scripts/extract-conversation.test.mjs \
            plugins/task-utility/scripts/check-issue-env.test.mjs
```
```

- [ ] **Step 2: plugin.json のバージョンを上げる**

`plugins/task-utility/.claude-plugins/plugin.json` の `"version": "1.0.1-dev"` を `"version": "1.1.0-dev"` に変更する(新機能追加のマイナーアップ。メジャーではないので人間への確認は不要)。

- [ ] **Step 3: プラグイン全テストを実行する**

Run: `node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs plugins/task-utility/scripts/extract-conversation.test.mjs plugins/task-utility/scripts/check-issue-env.test.mjs`
Expected: 全 tests PASS(fail 0)

- [ ] **Step 4: コミット**

```bash
git add plugins/task-utility/README.md plugins/task-utility/.claude-plugins/plugin.json
git commit -m "chore(task-utility): README に issue-craft を追記し 1.1.0-dev へ

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
