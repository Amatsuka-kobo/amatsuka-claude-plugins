# Codiel 初期化コマンド(/codiel:init)分離 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ハーネス資産の配置・設定を `/codiel:run` の前提チェックから分離し、対話インタビューで ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml を生成する新コマンド `/codiel:init` を追加する。

**Architecture:** 既存の「コマンド(薄いエントリ)→スキル(実体)」パターンに従い、`commands/init.md` → `skills/initializing-harness/SKILL.md` を新設する。`install-harness.sh` は機械的配置(`.codiel/` mkdir + GOTCHAS 雛形コピー)のみに縮小し、コンテンツ生成はスキルが対話インタビューで行う。`orchestrating-runs` §0 は「未初期化なら `/codiel:init` を案内して終了」に変更する。

**Tech Stack:** Markdown(Claude Code プラグインのスキル/コマンド)、bash(install-harness.sh)、node:test(*.test.mjs)。

**設計書:** `docs/plans/2026-07-08-codiel-init-command-design.md`(承認済み。判断に迷ったらこちらが正)

## Global Constraints

- Anthropic API を呼ぶ実装は一切持たない。ユーザーとの接点は Claude Code のスラッシュコマンドのみ(DESIGN.md §0)
- 同梱スクリプトは node / bash のみで書く(Python 等の追加ランタイム禁止)
- ドメインマップのフェンスブロック開始行は ` ```json codiel:domains `(この文字列そのまま)。ブロック内は有効な JSON のみ(hooks/scripts/lib.mjs の readDomains がこの形式で解析する)
- 既存ファイルの既存記述は削除・改変しない(不足分の追記のみ)。書き込み前にドラフト/差分を提示して承認を得る
- スキル・コマンド・ドキュメントの文体は既存ファイル(orchestrating-runs 等)の日本語・である調に合わせる
- コミットメッセージは既存の慣習(`feat:` / `docs:` / `test:` プレフィックス+日本語要約)に従う
- 作業ディレクトリはリポジトリルート `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`(以下、パスはすべてここからの相対)

---

### Task 1: install-harness.sh の縮小(TDD)

`install-harness.sh` から ARCHITECTURE.md / CLAUDE.md のコピーを取り除き、機械的配置(`.codiel/` ディレクトリ + GOTCHAS.md 雛形)のみに縮小する。

**Files:**
- Create: `plugins/codiel/scripts/install-harness.test.mjs`
- Modify: `plugins/codiel/scripts/install-harness.sh`

**Interfaces:**
- Consumes: `plugins/codiel/docs/GOTCHAS.example.md`(コピー元。変更しない)
- Produces: `bash <plugin-root>/scripts/install-harness.sh [対象ルート]` — `.codiel/{specs,runs,reports}` を mkdir し、`docs/GOTCHAS.md` を copy-if-absent する。ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml は**作らない**(Task 2 のスキルが `bash <plugin-root>/scripts/install-harness.sh` として呼ぶ)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/codiel/scripts/install-harness.test.mjs` を新規作成する(`codiel-state.test.mjs` と同じ node:test + 一時ディレクトリのパターン):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = new URL("./install-harness.sh", import.meta.url).pathname;

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "install-harness-"));
}
function run(target) {
  return execFileSync("bash", [SCRIPT, target], { encoding: "utf8" });
}

test(".codiel 配下のディレクトリと GOTCHAS.md 雛形を作成する", () => {
  const root = tmpProject();
  run(root);
  for (const d of [".codiel/specs", ".codiel/runs", ".codiel/reports"]) {
    assert.ok(fs.existsSync(path.join(root, d)), `${d} がない`);
  }
  const gotchas = fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8");
  assert.match(gotchas, /^# GOTCHAS/);
});

test("ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml は作成しない(initializing-harness スキルが生成する)", () => {
  const root = tmpProject();
  run(root);
  assert.ok(!fs.existsSync(path.join(root, "docs/ARCHITECTURE.md")), "ARCHITECTURE.md を作ってはいけない");
  assert.ok(!fs.existsSync(path.join(root, "CLAUDE.md")), "CLAUDE.md を作ってはいけない");
  assert.ok(!fs.existsSync(path.join(root, "raguel.config.yaml")), "raguel.config.yaml を作ってはいけない");
});

test("既存の GOTCHAS.md は上書きしない(copy-if-absent)", () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/GOTCHAS.md"), "既存の内容");
  const out = run(root);
  assert.equal(fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8"), "既存の内容");
  assert.match(out, /skip\(既存\)/);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test plugins/codiel/scripts/install-harness.test.mjs`

Expected: FAIL — 2 番目のテスト「ARCHITECTURE.md / CLAUDE.md ... は作成しない」が落ちる(現行スクリプトは両方をコピーするため)。1・3 番目は PASS でよい。

- [ ] **Step 3: install-harness.sh を縮小する**

`plugins/codiel/scripts/install-harness.sh` の全文を次に置き換える:

```bash
#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリと GOTCHAS.md 雛形)を配置する。
# ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(/codiel:init)が
# 対話インタビューで生成するため、このスクリプトでは扱わない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"

copy_if_absent() { # $1=src $2=dest
  if [ -e "$2" ]; then echo "skip(既存): $2"; else mkdir -p "$(dirname "$2")"; cp "$1" "$2"; echo "created: $2"; fi
}

copy_if_absent "$PLUGIN_ROOT/docs/GOTCHAS.example.md" "$TARGET/docs/GOTCHAS.md"
mkdir -p "$TARGET/.codiel/specs" "$TARGET/.codiel/runs" "$TARGET/.codiel/reports"
echo "done."
```

- [ ] **Step 4: テストを実行して全件 PASS を確認する**

Run: `node --test plugins/codiel/scripts/install-harness.test.mjs`

Expected: PASS ×3

- [ ] **Step 5: 既存テストのリグレッションがないことを確認する**

Run: `node --test plugins/codiel/scripts/codiel-state.test.mjs plugins/codiel/hooks/scripts/*.test.mjs`

Expected: 全件 PASS(install-harness.sh に依存する既存テストはないはずだが確認する)

- [ ] **Step 6: コミット**

```bash
git add plugins/codiel/scripts/install-harness.sh plugins/codiel/scripts/install-harness.test.mjs
git commit -m "feat(codiel): install-harness.sh を機械的配置(.codiel/ と GOTCHAS 雛形)のみに縮小"
```

---

### Task 2: initializing-harness スキルと /codiel:init コマンドの新設

初期化フロー全体を規定するスキル本体、raguel.config.yaml の形式リファレンス、コマンドエントリの 3 ファイルを作る。

**Files:**
- Create: `plugins/codiel/skills/initializing-harness/SKILL.md`
- Create: `plugins/codiel/skills/initializing-harness/raguel.config.example.yaml`
- Create: `plugins/codiel/commands/init.md`

**Interfaces:**
- Consumes: `bash <plugin-root>/scripts/install-harness.sh`(Task 1)、`<plugin-root>/docs/ARCHITECTURE.example.md`・`<plugin-root>/CLAUDE.example.md`(形式リファレンスとして読む。変更しない)、`<plugin-root>/hooks/scripts/lib.mjs` の `readDomains(root)`(検証に使う)
- Produces: `/codiel:init` コマンド(引数なし)。Task 3 の orchestrating-runs §0 が「`/codiel:init` を実行してください」と案内する先

- [ ] **Step 1: raguel.config.example.yaml を作成する**

`plugins/codiel/skills/initializing-harness/raguel.config.example.yaml` を新規作成する:

```yaml
# raguel.config.yaml — Raguel 設定(内蔵デフォルトへの差分オーバーレイ)
# 解決順: 環境変数 RAGUEL_CONFIG のパス → <プロジェクトルート>/raguel.config.yaml → 内蔵デフォルト。
# ここに書いた値だけが内蔵デフォルトに深マージされる。デフォルト全量をコピーしないこと。
# 保護パスの globs は docs/ARCHITECTURE.md の「保護パス」節と必ず一致させる(片方だけ更新して乖離させない)。
version: 1
rules:
  code/protected-paths:
    globs:
      - "prisma/migrations/**"
      - ".github/workflows/**"
      - "src/server/auth/**"
```

(globs の 3 行は `ARCHITECTURE.example.md` の「保護パス」節と同じ架空プロジェクト Tsukuyomi の例。整合の見本を兼ねる)

- [ ] **Step 2: SKILL.md を作成する**

`plugins/codiel/skills/initializing-harness/SKILL.md` を新規作成する。内容は以下の全文(方針の変更・要約・省略をしない):

`````markdown
---
name: initializing-harness
description: /codiel:init で対象プロジェクトに Codiel ハーネス(docs/ARCHITECTURE.md・docs/GOTCHAS.md・CLAUDE.md・raguel.config.yaml・.codiel/)を対話インタビューで初期化・補完するとき使用。/codiel:run が未初期化を検出した場合の案内先でもある
---

# Codiel ハーネス初期化

## 概要

`/codiel:init` は対象プロジェクト(カレントディレクトリ)に Codiel ハーネス資産を配置し、
対話インタビューの回答からプロジェクトに合った `docs/ARCHITECTURE.md` / `CLAUDE.md` /
`raguel.config.yaml` を生成する。**コードベースの自動解析は行わない**(内容の出所は常に
ユーザーの回答である。推測で埋めない)。

不足しているものだけを対象にするため、初期化済みプロジェクトでの再実行は不足分の補完に
なり(補完モード)、途中で中断しても再実行すれば不足分から自然に再開される(冪等)。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/initializing-harness` である。**`<plugin-root>` はそのベース
ディレクトリの 2 階層上**。

## チェックリスト

- [ ] 1. **現状調査**(下記)。全部揃っていれば「初期化済み」と報告して終了する
- [ ] 2. **機械的配置**: `bash <plugin-root>/scripts/install-harness.sh` を実行する
- [ ] 3. **対話インタビュー**(不足セクションに対応するテーマのみ)
- [ ] 4. **生成と自動マージ**(書き込み前にドラフト/差分を提示して承認を得る)
- [ ] 5. **検証**(domains ブロックのパース確認・保護パスの整合確認)
- [ ] 6. **完了報告**(`/codiel:run <issue番号>` を案内する)

## 1. 現状調査(モード判定)

対象プロジェクトで次の 5 点を確認し、**不足しているものだけ**を以降の手順の対象にする。

| # | 確認対象 | 「揃っている」の判定 |
|---|---|---|
| A | `docs/ARCHITECTURE.md` | ファイルが存在し、` ```json codiel:domains ` フェンスブロックが有効な JSON としてパースできる(手順 5 と同じ node コマンドで確認してよい) |
| B | `CLAUDE.md` | ファイルが存在し、`## Codiel ハーネス運用ルール` 見出しを含む |
| C | `docs/GOTCHAS.md` | ファイルが存在する |
| D | `raguel.config.yaml` | ファイルが存在する |
| E | `.codiel/specs` / `.codiel/runs` / `.codiel/reports` | 3 ディレクトリが存在する |

- 5 点すべて揃っていれば「初期化済み。作業なし」と報告して**終了する**(何も書き込まない)。
- 一部が欠けていれば**補完モード**: 欠けている項目に対応する手順・質問だけを実施する。
  たとえば A の ARCHITECTURE.md は存在するが「コマンド定義」節が空の場合は、そのテーマの
  質問だけを行い、該当セクションだけを追記する。
- git 管理外のプロジェクトでも実行してよい(警告を一言添えるのみ。init 自体は git を
  必要としない)。

## 2. 機械的配置

```
bash <plugin-root>/scripts/install-harness.sh
```

を対象プロジェクトのルートで実行する(ユーザーに実行させず Claude 自身が Bash ツールで行う)。
このスクリプトの責務は `.codiel/{specs,runs,reports}` の作成と `docs/GOTCHAS.md` 雛形の
copy-if-absent のみ。GOTCHAS は「空のジャーナル」であり、インタビューでの設定は不要。
ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml はこのスクリプトでは配置**されない**
(以降の手順で生成する)。

## 3. 対話インタビュー

AskUserQuestion ツールで **1 テーマずつ**質問する(一度に複数テーマを聞かない)。
選択肢は一般的な候補を挙げ、ユーザーは常に Other で自由回答できる。回答が曖昧・不足して
いる場合は同じテーマ内で追加の質問をしてよいが、**コードベースを読んで推測で補うことは
しない**(不明ならユーザーに聞く)。

補完モードでは、不足しているセクションに対応するテーマだけを質問する。

| # | テーマ | 質問する内容 | 反映先 |
|---|---|---|---|
| 1 | プロジェクト概要 | 何のためのプロダクトか・利用者・主要な技術的制約(1 段落分) | ARCHITECTURE 冒頭 |
| 2 | 技術スタック | 言語 / フレームワーク / 主要ライブラリ / パッケージマネージャ / バージョン方針 | 「技術スタック」表 |
| 3 | ディレクトリ構成 | 主要ディレクトリと各領域の責務(ドメインマップと矛盾しないこと) | 「ディレクトリ構成と責務」節 |
| 4 | ドメイン分割 | frontend / backend / data それぞれの書き込み許可パス glob。分割が馴染まなければ `{ "generic": ["**"] }` に縮退 | ` ```json codiel:domains ` ブロック |
| 5 | コマンド定義 | test / lint / typecheck / build / e2e の実行コマンド(プロジェクトルートで実行できる形) | 「コマンド定義」表 |
| 6 | テスト方針 | E2E フレームワークと実行方法、ユニットテストの要否・フレームワーク・配置規約 | 「テスト方針」節 |
| 7 | 保護パス | 触ってはいけない/特に慎重を要するパスの glob | ARCHITECTURE「保護パス」節 + `raguel.config.yaml` の `rules.code/protected-paths.globs`(**同一の回答から両方を生成する**) |
| 8 | 規約 | コーディング規約 / ベースブランチ / ブランチ・PR 命名 / Definition of Done | 「規約」節 |

## 4. 生成と自動マージ

回答からドラフトを作り、**書き込み前に必ず内容(新規ファイルは全文、既存ファイルへの追記は
追記箇所の差分)を提示してユーザーの承認を得る**。否認されたら該当テーマのインタビューに
戻って回答を修正し、再生成する。

- **`docs/ARCHITECTURE.md`**
  - 形式は `<plugin-root>/docs/ARCHITECTURE.example.md` に厳密に準拠する(作成前に必ず
    Read する)。セクション構成(概要 / 技術スタック / ディレクトリ構成と責務 /
    ドメインマップ / コマンド定義 / テスト方針 / 保護パス / 規約)と機械可読ブロックの
    形式(開始行 ` ```json codiel:domains ` そのまま・ブロック内は有効な JSON のみ・
    コメント不可)を変えない。example の HTML コメント(記入ガイド)はコピーしない。
  - 新規: 全セクションを回答から生成する。
  - 既存: 既存の記述は削除・改変せず、**不足セクションのみ**を追記する。
- **`CLAUDE.md`**
  - `<plugin-root>/CLAUDE.example.md` の `## Codiel ハーネス運用ルール` セクション
    (7 ルール)を**固定文言のまま**使う(作成前に必ず Read する。冒頭の HTML コメントは
    コピーしない)。
  - 新規: `# CLAUDE.md` 見出し + 同セクションで生成する。
  - 既存: `## Codiel ハーネス運用ルール` 見出しがなければ**末尾に追記**する。あれば触らない。
    既存の他セクションは一切変更しない。
- **`raguel.config.yaml`**
  - 形式は同梱の `raguel.config.example.yaml` に準拠する(作成前に必ず Read する)。
  - Raguel の設定は内蔵デフォルトへの**差分オーバーレイ**(deep merge)なので、
    プロジェクト固有の上書き(テーマ 7 の保護パス globs)だけを書いた最小ファイルを
    生成する。デフォルト全量をコピーしない。
  - 既存: 触らない(存在すれば現状調査 D で「揃っている」扱いになる)。

## 5. 検証(フェイルクローズドの前倒し)

run 開始時に初めて発覚していた不備を、init 完了時点で検出する。

1. **domains ブロックのパース確認**: 対象プロジェクトのルートで次を実行し、hooks・
   オーケストレーターと**同一の解析系**(`lib.mjs` の `readDomains`)で読めることを確認する:

   ```
   node -e 'import("<plugin-root>/hooks/scripts/lib.mjs").then(({ readDomains }) => {
     const d = readDomains(process.cwd());
     const ok = d && !Array.isArray(d) && Object.keys(d).length > 0 &&
       Object.values(d).every(v => Array.isArray(v) && v.length > 0 && v.every(g => typeof g === "string"));
     if (!ok) { console.error("NG: codiel:domains ブロックが読めない/形式不正"); process.exit(1); }
     console.log("OK:", JSON.stringify(d));
   })'
   ```

   (`<plugin-root>` は絶対パスに展開して実行する)
2. **保護パスの整合確認**: `docs/ARCHITECTURE.md` の「保護パス」節と `raguel.config.yaml` の
   `rules.code/protected-paths.globs` を両方 Read し、glob の集合が一致していることを確認する。
3. 検証に失敗したら該当ファイルを修正して再検証する。**失敗のまま完了報告しない**。

## 6. 完了報告

次を報告して終了する。

- 配置・生成・追記したファイルの一覧(skip したものは skip と明記)
- 次のアクション: `/codiel:run <issue番号>` で run を開始できること

<HARD-GATE>
- **承認なしに書き込まない**。手順 4 のドラフト/差分提示と承認の取得は、ファイルが新規でも
  既存でも省略できない。
- **既存記述を削除・改変しない**。ARCHITECTURE.md / CLAUDE.md への変更は不足分の追記のみ。
- **検証(手順 5)を省略して完了報告しない**。domains ブロックが readDomains で読めることを
  確認するまで初期化は完了していない。
- **コードベース解析で回答を代替しない**。ドメインマップ・コマンド定義等の内容はユーザーの
  回答からのみ生成する(ファイルを読んで「たぶんこうだろう」と埋めない)。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「package.json を見ればコマンド定義は分かるので聞かなくていい」 | scripts の存在と「プロジェクトの正式なテスト方針」は別物。宣言の出所はユーザーの回答であることがこのスキルの前提。 |
| 「小さいプロジェクトだからドラフト提示を飛ばして直接書いていい」 | CLAUDE.md / ARCHITECTURE.md はプロジェクトの恒久資産。承認なしの書き込みは HARD-GATE 違反。 |
| 「domains の JSON は自分で書いたのだから検証不要」 | 検証は「自分が正しく書けたか」ではなく「hooks と同じ解析系で読めるか」の確認。フェンス開始行の 1 文字の違いで run が開始できなくなる。 |
| 「既存 CLAUDE.md の古い記述もついでに直してあげよう」 | スコープ外。追記のみが許可された変更。気づいた問題は報告に留める。 |
`````

- [ ] **Step 3: commands/init.md を作成する**

`plugins/codiel/commands/init.md` を新規作成する(run.md と同形式の薄いエントリ):

```markdown
---
description: 対象プロジェクトに Codiel ハーネス(ARCHITECTURE.md / GOTCHAS.md / CLAUDE.md / raguel.config.yaml / .codiel/)を対話インタビューで初期化・補完する
---

codiel プラグインの initializing-harness スキルを Skill ツールで起動し、その手順に厳密に従って
対象プロジェクト(カレントディレクトリ)の Codiel ハーネスを初期化してください。
スキルを読まずにファイルを配置・生成することは禁止です。
```

- [ ] **Step 4: 形式の静的検証**

次を実行して確認する:

```bash
# SKILL.md の frontmatter と domains フェンス文字列の表記が正しいこと
head -5 plugins/codiel/skills/initializing-harness/SKILL.md
grep -c 'json codiel:domains' plugins/codiel/skills/initializing-harness/SKILL.md
# raguel.config.example.yaml が YAML としてパースできること(raguel-mcp の yaml 依存を使う)
cd plugins/codiel/raguel-mcp && node -e 'const { parse } = require("yaml"); const fs = require("node:fs"); console.log(JSON.stringify(parse(fs.readFileSync("../skills/initializing-harness/raguel.config.example.yaml", "utf8"))))'
```

Expected: frontmatter に `name: initializing-harness` があること。`json codiel:domains` の出現回数が 3(現状調査 A・インタビューテーマ 4・生成手順 4 の言及箇所)であること。YAML パースが `{"version":1,"rules":{"code/protected-paths":{"globs":["prisma/migrations/**",".github/workflows/**","src/server/auth/**"]}}}` を出力すること。`Cannot find module 'yaml'` になる場合は先に `pnpm install` を raguel-mcp で実行する。

- [ ] **Step 5: コミット**

```bash
git add plugins/codiel/skills/initializing-harness/ plugins/codiel/commands/init.md
git commit -m "feat(codiel): /codiel:init コマンドと initializing-harness スキルを新設"
```

---

### Task 3: orchestrating-runs §0 を「init 案内して終了」に変更

**Files:**
- Modify: `plugins/codiel/skills/orchestrating-runs/SKILL.md:46-57`(§0 前提チェック)

**Interfaces:**
- Consumes: `/codiel:init`(Task 2。案内先のコマンド名として言及する)
- Produces: なし(run 側の挙動変更のみ)

- [ ] **Step 1: §0 の手順 3 を差し替える**

`plugins/codiel/skills/orchestrating-runs/SKILL.md` の §0 にある次の記述:

```markdown
3. **存在しない場合**: Claude 自身が Bash ツールで
   `bash <plugin-root>/scripts/install-harness.sh` を実行する(ユーザーに実行させない)。
   `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` / `CLAUDE.md` のひな形が生成されたことを確認し、
   ユーザーに「ドメインマップ・コマンド定義・テスト方針を記入してください」と依頼して、
   **この run はここで終了する**(未記入のまま先へ進まない)。
```

を次に置き換える:

```markdown
3. **存在しない・読めない場合**: ハーネスが未初期化である。`install-harness.sh` を実行したり
   雛形を自分で作ったりせず、ユーザーに「`/codiel:init` を実行して初期化してください」と
   案内して、**この run はここで終了する**(未初期化のまま先へ進まない)。
```

- [ ] **Step 2: install-harness への残存参照がないことを確認する**

Run: `grep -n "install-harness" plugins/codiel/skills/orchestrating-runs/SKILL.md`

Expected: 手順 3 の「`install-harness.sh` を実行したり…せず」という否定形の 1 箇所のみ(実行を指示する記述はゼロ)。

- [ ] **Step 3: コミット**

```bash
git add plugins/codiel/skills/orchestrating-runs/SKILL.md
git commit -m "feat(codiel): run の前提チェックを /codiel:init 案内に変更(資産配置を run から分離)"
```

---

### Task 4: ドキュメント更新(README / DESIGN / CLAUDE.example)

**Files:**
- Modify: `plugins/codiel/README.md:40-47`(セットアップ)および 5 行目以降(コマンド一覧に /codiel:init を追加)
- Modify: `plugins/codiel/docs/DESIGN.md:21`(スラッシュコマンド列挙)、`docs/DESIGN.md:358-360`(§9 冒頭)、`docs/DESIGN.md:427-443`(§10 ディレクトリ構成)
- Modify: `plugins/codiel/CLAUDE.example.md:3-11`(記入ガイドコメント)

**Interfaces:**
- Consumes: Task 1〜3 で確定した挙動(記述はそれに合わせる)
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: README.md を更新する**

(a) 「## コマンド」節の先頭(`### /codiel:run` の前)に追加:

```markdown
### `/codiel:init`

対象プロジェクトに Codiel ハーネスを初期化します。対話インタビュー(技術スタック・ドメイン分割・
コマンド定義・保護パス等の 8 テーマ)の回答から、プロジェクトに合った `docs/ARCHITECTURE.md` /
`CLAUDE.md` / `raguel.config.yaml` を生成し、`docs/GOTCHAS.md` の雛形と `.codiel/` 配下の
ディレクトリを配置します。既存ファイルは壊さず不足分だけを追記するため、再実行は常に安全です
(不足セクションの補完になります)。内部では `initializing-harness` スキルの手順に従います。
```

(b) 「## セットアップ」節の手順 2〜3 を次に置き換える:

```markdown
2. 対象プロジェクトのルートで `/codiel:init` を実行します。対話インタビューに答えると、
   `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` / `CLAUDE.md` / `raguel.config.yaml` と
   `.codiel/` 配下のディレクトリが、プロジェクトに合った内容で作成されます。
3. `/codiel:run <issue番号>` で run を開始します。未初期化のまま `/codiel:run` を実行した場合は
   `/codiel:init` の実行を案内して終了します(フェイルクローズド)。
```

- [ ] **Step 2: DESIGN.md を更新する**

(a) §0 の「ユーザーとの接点は Claude Code のスラッシュコマンド(`/codiel:run`, `/codiel:test`)のみ」を
`(`/codiel:init`, `/codiel:run`, `/codiel:test`)のみ` に変更する。

(b) §9 冒頭の:

```markdown
対象プロジェクトに配置する 3 点セット。`scripts/install-harness.sh` が example をコピーして初期化する。
```

を次に置き換える:

```markdown
対象プロジェクトに配置するハーネス資産。`/codiel:init`(`initializing-harness` スキル)が
対話インタビューで初期化する: GOTCHAS.md と `.codiel/` 配下は同スキルが呼ぶ
`scripts/install-harness.sh` が機械的に配置し、ARCHITECTURE.md / CLAUDE.md /
raguel.config.yaml はインタビューの回答から生成する(既存ファイルは不足分のみ追記)。
`/codiel:run` は資産配置を行わず、未初期化を検出したら `/codiel:init` を案内して終了する。
```

(c) §10 のディレクトリ構成ツリーを更新する:
- `commands/` の下に `init.md                    # /codiel:init(薄い入口。initializing-harness を起動)` の行を `run.md` の上に追加
- `skills/` の一覧の先頭に `initializing-harness/SKILL.md(+ raguel.config.example.yaml)` を追加
- `install-harness.sh` の行のコメントを `# GOTCHAS 雛形と .codiel/ を機械的に配置(initializing-harness から呼ばれる)` に変更

(§11 実装マイルストーンは履歴として変更しない)

- [ ] **Step 3: CLAUDE.example.md の記入ガイドコメントを更新する**

冒頭の HTML コメント(`<!-- 記入ガイド ... -->`)のうち、次の 3 行:

```
`scripts/install-harness.sh` がこのファイルをプロジェクト直下の CLAUDE.md としてコピーします
(既に CLAUDE.md が存在する場合は上書きせず skip するので、既存プロジェクトでは下記の
「## Codiel ハーネス運用ルール」セクションを既存の CLAUDE.md に手動でマージしてください)。
```

を次に置き換える:

```
`/codiel:init`(initializing-harness スキル)がこのファイルの「## Codiel ハーネス運用ルール」
セクションを対象プロジェクトの CLAUDE.md に反映します(CLAUDE.md がなければ新規作成し、
既にある場合は同セクションがなければ末尾に追記、あれば変更しません)。
```

- [ ] **Step 4: 残存参照の横断確認**

Run: `grep -rn "install-harness" plugins/codiel --include='*.md' --include='*.sh' --include='*.mjs' | grep -v test.mjs`

Expected: 残る言及は (1) `install-harness.sh` 自身、(2) DESIGN.md §9(新文言)・§10 ツリー・§11(履歴)・§0 制約(同梱スクリプト列挙。変更不要)、(3) orchestrating-runs の否定形言及、(4) initializing-harness SKILL.md の手順 2 — のみであること。「run が自動実行する」「example をコピーして CLAUDE.md を作る」という旧仕様の記述がゼロであること。

- [ ] **Step 5: コミット**

```bash
git add plugins/codiel/README.md plugins/codiel/docs/DESIGN.md plugins/codiel/CLAUDE.example.md
git commit -m "docs(codiel): 初期化フローを /codiel:init ベースの記述に更新"
```

---

### Task 5: 全体検証

**Files:**
- なし(検証のみ)

- [ ] **Step 1: 全テストスイートの実行**

Run: `node --test plugins/codiel/scripts/*.test.mjs plugins/codiel/hooks/scripts/*.test.mjs`

Expected: 全件 PASS

Run: `cd plugins/codiel/raguel-mcp && pnpm vitest run`

Expected: 全件 PASS(raguel-mcp は今回未変更なので現状維持の確認)

- [ ] **Step 2: 手動シナリオ(擬似)検証**

一時ディレクトリでスキルの前提が成立することを機械的に確認する:

```bash
T=$(mktemp -d)
# (a) 縮小版 install-harness が期待どおり配置する
bash plugins/codiel/scripts/install-harness.sh "$T"
ls "$T/.codiel" && head -1 "$T/docs/GOTCHAS.md"
# (b) SKILL.md 手順 5 の検証コマンドが「未初期化」を正しく NG 判定する
node -e 'import("/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/codiel/hooks/scripts/lib.mjs").then(({ readDomains }) => { const d = readDomains("'"$T"'"); console.log(d === null ? "OK: 未初期化を null 判定" : "NG"); })'
# (c) domains ブロックを持つ ARCHITECTURE.md を置くと OK 判定になる
mkdir -p "$T/docs" && printf '# ARCHITECTURE\n\n```json codiel:domains\n{ "generic": ["**"] }\n```\n' > "$T/docs/ARCHITECTURE.md"
node -e 'import("/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/codiel/hooks/scripts/lib.mjs").then(({ readDomains }) => { const d = readDomains("'"$T"'"); console.log(d && d.generic ? "OK: " + JSON.stringify(d) : "NG"); })'
rm -rf "$T"
```

Expected: (a) `.codiel` の 3 ディレクトリと `# GOTCHAS` が出る / (b) `OK: 未初期化を null 判定` / (c) `OK: {"generic":["**"]}`

- [ ] **Step 3: 対話シナリオの実機確認(人間と一緒に)**

サンプルプロジェクト(空の一時ディレクトリで可)に対して実際に `/codiel:init` を実行し、次の 3 シナリオを確認する。これは対話(AskUserQuestion)を含むためユーザーと一緒に行う:

1. 新規初期化: 8 テーマのインタビュー → ドラフト承認 → 5 ファイル生成 → 検証 OK → 完了報告
2. 既存 CLAUDE.md ありの補完: 運用ルール節が末尾に追記され、既存記述が保持される
3. 初期化済みで再実行: 「初期化済み。作業なし」で終了する

- [ ] **Step 4: 完了報告**

実装した内容・テスト結果・実機確認の結果をまとめてユーザーに報告する。
