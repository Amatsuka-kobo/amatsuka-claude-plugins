# basic-design プラグイン Stage 4(Google Drive 連携)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 §9 の Google Drive 連携(オプトイン)を実装する — `.claude/basic-design.local.md` の設定読み取りスクリプトと、全成果物スキルの保存手順への Drive アップロードステップの組み込み。

**Architecture:** 設定読み取りは小さな Node スクリプト(`check-drive-config.mjs`)が担い、JSON を返す(check-issue-env.mjs と同じ流儀)。アップロード自体はプラグインは実装しない — スキルが「利用可能な Drive 系 MCP Tool」を探して使い、なければ導入案内をして STOP する(設計書 §9・CLAUDE.md の API 不使用制約)。共通の保存手順は各スキルに重複記載せず、共有参照ファイル(`skills/shared/drive-upload.md`)に一本化して各スキルから参照する。

**Tech Stack:** Node.js 標準ライブラリのみ(設定読み取りのみ)。スキルは Markdown。テストは `node --test`。

**設計書:** `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md` §9(保存フロー)。本計画は §13 の段階 (4) に対応し、basic-design プラグインの最終ステージ。

## Global Constraints

- **Anthropic API・外部 API キー・Google Drive API の直接実装を持ち込まない**(設計書 §3・§14)。Drive 認証は MCP Tool に閉じる
- 設定がなければ **Drive の話は一切出さない**。設定の登録はユーザーが明示的に依頼したときだけ案内する(設計書 §9)
- **ローカル保存は常に先に完了**させる。アップロードはその後(ローカルが正、クラウドが写し)
- Drive アップロードの対象は**生成物(.drawio / .html / .md)のみ**。spec JSON はアップロードしない
- 同名ファイルが既にある場合の扱い(上書きか別名か)は、アップロード前にユーザーに確認する
- 変換スクリプトは Node 標準ライブラリのみ。既存 92 テストを壊さない
- コミットメッセージ末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Drive 設定読み取りスクリプト(check-drive-config.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/check-drive-config.mjs`
- Test: `plugins/basic-design/scripts/check-drive-config.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces: CLI 契約。スキル(Task 2)はこれだけを呼ぶ:
  - `node check-drive-config.mjs [プロジェクトルート]`(引数省略時はカレントディレクトリ)
  - stdout に JSON、常に exit 0(設定が無いのはエラーではない):
    - 設定あり: `{"configured":true,"driveFolderId":"1AbC..."}`
    - 設定なし/ファイルなし/ID なし: `{"configured":false,"driveFolderId":null}`
  - 読み取り対象: `<ルート>/.claude/basic-design.local.md` の YAML frontmatter の `drive_folder_id`

frontmatter のパースは依存ゼロで最小限に: 先頭が `---` 行で始まり、次の `---` 行までの間から `drive_folder_id:` 行を探す。値の引用符(`"` `'`)は剥がす。YAML の完全パースはしない(このキー 1 つで十分 — YAGNI)。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/check-drive-config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const CLI = new URL('./check-drive-config.mjs', import.meta.url).pathname;

async function makeProject(localMd) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-config-'));
  if (localMd !== null) {
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    await writeFile(path.join(dir, '.claude', 'basic-design.local.md'), localMd);
  }
  return dir;
}

async function runCli(dir) {
  const { stdout } = await run('node', [CLI, dir]);
  return JSON.parse(stdout);
}

test('設定ファイルに drive_folder_id があれば configured:true と ID を返す', async () => {
  const dir = await makeProject('---\ndrive_folder_id: "1AbCdEfGh"\n---\n\nメモ\n');
  assert.deepEqual(await runCli(dir), { configured: true, driveFolderId: '1AbCdEfGh' });
});

test('シングルクォート・引用符なしも受け付ける', async () => {
  const single = await makeProject("---\ndrive_folder_id: '1XyZ'\n---\n");
  assert.deepEqual(await runCli(single), { configured: true, driveFolderId: '1XyZ' });
  const bare = await makeProject('---\ndrive_folder_id: 1Bare123\n---\n');
  assert.deepEqual(await runCli(bare), { configured: true, driveFolderId: '1Bare123' });
});

test('ファイルが無ければ configured:false(exit 0)', async () => {
  const dir = await makeProject(null);
  assert.deepEqual(await runCli(dir), { configured: false, driveFolderId: null });
});

test('frontmatter が無い・キーが無い・値が空なら configured:false', async () => {
  const noFm = await makeProject('ただのメモ\n');
  assert.deepEqual(await runCli(noFm), { configured: false, driveFolderId: null });
  const noKey = await makeProject('---\nother_key: x\n---\n');
  assert.deepEqual(await runCli(noKey), { configured: false, driveFolderId: null });
  const empty = await makeProject('---\ndrive_folder_id: ""\n---\n');
  assert.deepEqual(await runCli(empty), { configured: false, driveFolderId: null });
});

test('frontmatter の外にあるキーは無視する', async () => {
  const dir = await makeProject('---\ntitle: x\n---\n\ndrive_folder_id: "1Outside"\n');
  assert.deepEqual(await runCli(dir), { configured: false, driveFolderId: null });
});

test('引数省略時はカレントディレクトリを使う', async () => {
  const dir = await makeProject('---\ndrive_folder_id: "1Cwd"\n---\n');
  const { stdout } = await run('node', [CLI], { cwd: dir });
  assert.deepEqual(JSON.parse(stdout), { configured: true, driveFolderId: '1Cwd' });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/check-drive-config.test.mjs`
Expected: FAIL(CLI が存在しない)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/check-drive-config.mjs`:

```js
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
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return { configured: false, driveFolderId: null };
  }
  for (const line of lines.slice(1)) {
    if (line === '---') break;
    const m = line.match(/^drive_folder_id:\s*(.*)$/);
    if (m) {
      const value = m[1].trim().replace(/^["']|["']$/g, '').replace(/\s*#.*$/, '').trim();
      if (value !== '') {
        return { configured: true, driveFolderId: value };
      }
    }
  }
  return { configured: false, driveFolderId: null };
}

const root = process.argv[2] ?? process.cwd();
process.stdout.write(JSON.stringify(readDriveConfig(root)) + '\n');
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/check-drive-config.test.mjs`
Expected: PASS(6 tests)

注意: 実装の `.replace(/\s*#.*$/, '')` はコメント除去(設定例の `# 省略時は...` に対応)。引用符剥がしの後に行う順序に意味がある(引用符内の `#` を守る完全性より単純さを優先 — フォルダ ID に `#` は含まれない)。

- [ ] **Step 5: 全体通しとコミット**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(98 tests, fail 0)

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): Drive 設定読み取りスクリプトを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 共有保存手順(drive-upload.md)と全スキルへの組み込み

**Files:**
- Create: `plugins/basic-design/skills/shared/drive-upload.md`
- Modify: `plugins/basic-design/skills/er-diagram/SKILL.md`(手順 5 に 1 行追記)
- Modify: `plugins/basic-design/skills/screen-flow/SKILL.md`(同上)
- Modify: `plugins/basic-design/skills/system-architecture/SKILL.md`(同上)
- Modify: `plugins/basic-design/skills/sequence-diagram/SKILL.md`(同上)
- Modify: `plugins/basic-design/skills/api-list/SKILL.md`(手順 4 に 1 行追記)
- Modify: `plugins/basic-design/skills/nfr-checklist/SKILL.md`(手順 4 に 1 行追記)
- Modify: `plugins/basic-design/skills/basic-design/SKILL.md`(手順 6 に 1 行追記)

**Interfaces:**
- Consumes: Task 1 の CLI 契約
- Produces: 全スキル共通の Drive アップロード手順(オプトイン)

- [ ] **Step 1: shared/drive-upload.md を書く**

`plugins/basic-design/skills/shared/drive-upload.md`:

```markdown
# Google Drive アップロード手順(オプトイン)

成果物のローカル保存が完了した**後**に、この手順を実行する。

## 1. 設定の確認

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-drive-config.mjs"
```

- `configured: false` → **何もしない。ユーザーに Drive の話を一切しない**。手順はここで終了
- `configured: true` → `driveFolderId` を使って手順 2 へ

## 2. アップロードの提案と実行

ユーザーに「Drive 設定があるので、生成物を Google Drive にアップロードしますか?」と確認する(明示承認制)。承認されたら:

1. 自分の利用可能ツール一覧から、**Google Drive へのファイルアップロードができる MCP Tool** を探す
2. **見つかった場合**: 対象ファイル(生成物 .drawio / .html / .md のみ。**spec JSON は対象外**)を `driveFolderId` のフォルダへアップロードする
   - アップロード前に、同名ファイルが既に Drive 上にあるかを確認できるツールがあれば確認し、**ある場合は「上書き更新か、別名で追加か」をユーザーに確認**する。確認できない場合はその旨を伝えてから実行する
   - 成功したら、アップロード先(ファイル名と可能なら URL)を報告する
   - 失敗したら生のエラーをそのまま報告して STOP(ローカル保存は完了している。勝手なリトライをしない)
3. **見つからない場合**: 次を伝えて STOP:
   - ローカル保存は完了していること(パス一覧)
   - Drive 系 MCP サーバーの導入が必要なこと(例: `claude mcp add` で Google Drive 対応の MCP サーバーを追加)
   - 手動アップロードの方法: [drive.google.com](https://drive.google.com) で対象フォルダを開き、生成物をドラッグ&ドロップ

## 3. Web 版 Draw.io での開き方(.drawio をアップロードした場合)

app.diagrams.net → 「Open Existing Diagram」→ Google Drive を選択 → アップロードしたファイルを選ぶ、と案内する。

## 設定の登録(ユーザーが明示的に依頼したときのみ)

「Drive 連携を設定したい」と依頼されたら、`.claude/basic-design.local.md` を次の形式で作成するよう案内する(このファイルは通常 gitignore 対象。リポジトリの .gitignore に `.claude/*.local.md` が無ければ追加を提案する):

​```markdown
---
drive_folder_id: "1AbCdEfGh..."   # Drive のフォルダ URL 末尾の ID
---
​```
```

(注: ネストしたコードフェンスは実ファイルでは通常のトリプルバッククォート。外側と衝突する場合は外側を 4 連にする)

- [ ] **Step 2: 図系 4 スキルの手順 5(完了報告)に追記**

er-diagram / screen-flow / system-architecture / sequence-diagram の各 SKILL.md の手順 5 の末尾(「git コミットはユーザーの指示があったときのみ行う。」の直後の行)に、次の 1 行を追加する:

```markdown
ローカル保存の完了後、`${CLAUDE_PLUGIN_ROOT}/skills/shared/drive-upload.md` の手順で Google Drive へのアップロードを確認する(設定が無ければ何も起きない)。
```

- [ ] **Step 3: Markdown 系 2 スキルの手順 4(保存)に同じ 1 行を追記**

api-list / nfr-checklist の各 SKILL.md の手順 4 の末尾に同じ 1 行を追加する。

- [ ] **Step 4: 入口スキルの手順 6(最終報告)に注記を追記**

basic-design/SKILL.md の手順 6 の箇条書きに次を追加:

```markdown
- Drive 連携が設定されている場合、各成果物のアップロード結果(または未アップロードの理由)
```

- [ ] **Step 5: セルフチェックとコミット**

- 7 ファイルすべての追記位置・文面を確認(diff で追記が各 1〜2 行に収まっていること)
- drive-upload.md の「configured: false なら何もしない」が設計書 §9 の「設定がなければ Drive の話は一切出さない」と一致
- spec JSON がアップロード対象外であることの明記

```bash
git add plugins/basic-design/skills/
git commit -m "feat(basic-design): 全スキルに Google Drive アップロード手順(オプトイン)を組み込み

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: バージョン更新と仕上げ(プラグイン完成)

**Files:**
- Modify: `plugins/basic-design/.claude-plugin/plugin.json`(version → `0.4.0-dev`)
- Modify: `plugins/basic-design/README.md`(実装状況 Stage 4 追記+使い方セクション)

**Interfaces:**
- Consumes: Task 1〜2
- Produces: 設計書の全 Stage を実装し終えたプラグイン

- [ ] **Step 1: plugin.json のバージョンを上げる**

`"version": "0.3.0-dev"` → `"version": "0.4.0-dev"`

- [ ] **Step 2: README.md を仕上げる**

「## 現在の実装状況」に追記:

```markdown
- Stage 4: Google Drive アップロード(オプトイン、Drive 系 MCP Tool 経由)
```

さらに「## 使い方」セクションを「現在の実装状況」の前に追加:

```markdown
## 使い方

- **一式まとめて**: 「基本設計を始めたい」→ `basic-design` スキルが概要ブレスト → 成果物選択 → 各スキルを順に実行
- **個別に**: 「ER図を作って」「画面遷移図を作って」「システム構成図を作って」「シーケンス図を作って」「API 一覧を作って」「非機能要件を整理して」→ 各専用スキルが直接発動
- 成果物は `docs/design/<種別>/` に保存される。図は spec JSON(ソース)と .drawio / .html(生成物)のセット
- Google Drive 連携(任意): `.claude/basic-design.local.md` に `drive_folder_id` を設定すると、保存後にアップロードを提案する
```

- [ ] **Step 3: 全テスト確認と最終コミット**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(98 tests, fail 0)

```bash
git add plugins/basic-design/
git commit -m "feat(basic-design): Stage 4 リリース(v0.4.0-dev)— 設計書の全 Stage 完了

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完了条件(Stage 4)

- check-drive-config.mjs のテスト 6 件を含む全 98 テストがパス
- 設定なしのとき、どのスキルも Drive に言及しない(drive-upload.md の手順 1 で完結)
- 設定ありのとき、承認 → MCP Tool 探索 → アップロード or 導入案内 STOP の分岐が文書化されている
- 設計書 §13 の 4 段階すべてが実装済み

## プラグイン全体の残フォロー(Stage 4 完了後)

- ユーザーによるサンプルのブラウザ実機確認(Stage 2 分: ec-screen-flow / web-architecture / login-sequence の .drawio と .html)
- ドッグフーディング(実プロジェクトでの basic-design 一式実行)
- 将来候補(設計書 §14 のスコープ外リスト+レビュー持ち越し): 既存資料からの spec 叩き台生成 / screen-flow 自己遷移の扱い / HTML のライフライン強調
