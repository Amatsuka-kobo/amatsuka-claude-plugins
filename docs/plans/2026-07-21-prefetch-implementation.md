# prefetch プラグイン実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ユーザー入力待ちの直前に、承認後・回答後に高確率で必要となる読み取り主体の探索を最大 3 件までバックグラウンド実行し、次のユーザー入力時に成果を安全に回収できる独立プラグイン `prefetch` を新規作成する。

**Architecture:** `skills/prefetch/SKILL.md` が予測・dispatch・manifest 状態管理・回収のプロトコルを定義し、メインエージェントだけが `.prefetch/manifest.md` を更新する。先行サブエージェントはリポジトリを書き換えず `.prefetch/<task-id>/result.md` のみへ成果を書き出す。`UserPromptSubmit` フックは Node.js スクリプトで manifest の表を機械判定し、`running` または `done` がある場合だけ stdout に回収リマインダーを出す。プラグインは他プラグインに依存せず、Marketplace entry から単体導入できる。

**Tech Stack:** Markdown、JSON、Node.js ESM (`.mjs`、Node 組み込み `fs` / `path` のみ)、Claude Code Skill / UserPromptSubmit Hook / background Agent。`src/` とビルド工程、自動テスト、外部 npm 依存は持たない。

## Global Constraints

- Anthropic API を使用しない。API クライアント、`ANTHROPIC_API_KEY`、ユーザーによる CLI 直接操作を前提にせず、Claude Code の Agent tool に閉じる。
- 先行実行は読み取り主体のみとし、コード・設定・通常成果物を変更しない。
- 先行サブエージェントの書き込み先は `.prefetch/<task-id>/result.md` のみに限定する。
- `.prefetch/` はセッションローカル領域として git 管理外にし、README で `.gitignore` への追加を案内する。プラグインが利用プロジェクトの `.gitignore` を自動変更してはならない。
- `agent-policy` その他のプラグインへ依存せず、`prefetch` 単体で導入・動作できる構成にする。
- 他のコスト規律と併用できるよう、先行サブエージェントはスキルをロードせず、既定モデルを `haiku` とする。
- コード理解の深さが必要で、複数モジュール間の契約・影響範囲を追う探索だけ `sonnet` へ昇格する。
- 予測は no-regret な読み取り作業を優先し、有用な予測がなければ 0 件のままユーザー待ちへ進む。
- 1 待ち区間あたりの新規 dispatch は最大 3 件とし、前区間の `running` を含む合計も 3 件を超えない。
- manifest の状態更新はメインエージェントだけが行い、先行サブエージェントは manifest に触れない。
- 状態遷移は `running → done → harvested/discarded` または `running → failed` に限定する。
- 予測ミス・失敗・未完了があっても本作業を止めず、通常フローへフォールバックするベストエフォート機能とする。
- UserPromptSubmit フックは LLM を使わず Node.js で軽量判定し、未回収エントリがない場合は stdout 空・exit 0 とする。
- 自動テストは追加せず、設計書 §6 の 3 シナリオとフックスクリプト直接実行による手動検証を行う。
- Markdown + JSON + `.mjs` のみで `src/` がないためビルドは行わず、生成物も作らない。
- 初期バージョンは `0.1.0-dev` とする。
- `docs/chat/` は参照・変更しない。
- 各コミットは意味単位で分け、コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける。

## タスク一覧と依存関係

| # | タスク | 成果物 | 依存 |
|---|---|---|---|
| 1 | プラグイン manifest 作成 | `plugins/prefetch/.claude-plugin/plugin.json` | なし |
| 2 | prefetch Skill 作成 | `plugins/prefetch/skills/prefetch/SKILL.md` | Task 1 |
| 3 | 回収リマインダーフック作成 | `plugins/prefetch/hooks/hooks.json`、`plugins/prefetch/scripts/check-prefetch-manifest.mjs` | Task 2 の manifest 契約 |
| 4 | プラグイン README 作成 | `plugins/prefetch/README.md` | Task 1〜3 |
| 5 | Marketplace 登録と全体手動検証 | `.claude-plugin/marketplace.json` | Task 1〜4 |

---

## Task 1: プラグイン manifest を作成する

**Files:**
- Create: `plugins/prefetch/.claude-plugin/plugin.json`

**Interfaces:** Task 2〜4 がプラグイン名 `prefetch` と初期バージョン `0.1.0-dev` を前提にする。Task 5 の Marketplace entry は `name` と `description` をこの manifest に一致させる。

**完成形の全文:**

````json
{
  "name": "prefetch",
  "description": "ユーザー入力待ちの直前に、次に必要となる読み取り主体の作業をバックグラウンドで先行実行し、回答後の待ち時間を短縮する",
  "version": "0.1.0-dev"
}
````

**Steps:**

- [ ] `mkdir -p plugins/prefetch/.claude-plugin` を実行し、プラグイン manifest 用ディレクトリを作成する。
- [ ] 上記全文を `plugins/prefetch/.claude-plugin/plugin.json` に書き出す。
- [ ] `node -e 'const p=require("./plugins/prefetch/.claude-plugin/plugin.json"); if(p.name!=="prefetch"||p.version!=="0.1.0-dev"||Object.keys(p).sort().join(",")!=="description,name,version") process.exit(1); console.log("OK")'` をリポジトリルートで実行し、期待出力 `OK` を確認する。
- [ ] `git diff --check -- plugins/prefetch/.claude-plugin/plugin.json` を実行し、出力なし・exit 0 を確認する。
- [ ] `git add plugins/prefetch/.claude-plugin/plugin.json && git commit -m "feat(prefetch): プラグイン manifest を追加" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"` を実行する。

---

## Task 2: 予測・先行実行・回収を定義する Skill を作成する

**Files:**
- Create: `plugins/prefetch/skills/prefetch/SKILL.md`

**Interfaces:** Task 1 のプラグイン内 Skill。Task 3 のフックスクリプトは、本 Skill が定義する `.prefetch/manifest.md` の 5 列テーブルと状態名を解析する。先行サブエージェントは `.prefetch/<task-id>/result.md` だけを書き、manifest はメインエージェントだけが更新する。

**完成形の全文:**

````markdown
---
name: prefetch
description: ユーザーへの質問、設計承認依頼、計画・スペックのレビュー依頼など、AskUserQuestion・ExitPlanMode・メッセージ送信によってユーザー入力待ちに入る直前に使う。回答後に高確率で必要になる読み取り主体の探索を同一ターン内で予測し、バックグラウンドで先行実行して次ターン冒頭に回収する。予測できる作業がなければ何も起動しない。
---

# prefetch

ユーザー入力待ちを、回答後に必要となる読み取り主体の作業を先行させる時間として利用する。prefetch はベストエフォートの加速機能であり、予測ミス・失敗・未完了によって本作業の通常フローを変えてはならない。

## 実行タイミング

次のいずれかでユーザー入力待ちに入る場合、質問・依頼を送る**同一ターン内の直前**に予測と dispatch を行う。

- `AskUserQuestion` を呼ぶ直前
- `ExitPlanMode` を呼ぶ直前
- 設計承認、計画レビュー、スペックレビュー、方針選択などをメッセージで依頼する直前

前のターンで先に質問を送ってから dispatch してはならない。予測・manifest 記録・background dispatch を済ませ、その後にユーザーへの質問またはレビュー依頼を行う。

## 1. 予測する

待ちの種別を「設計承認待ち」「質問回答待ち」「計画・スペックレビュー待ち」から判定し、回答後に必要になる読み取り主体の作業を 0〜3 件予測する。各予測には、どの回答または分岐なら成果が有効かを自然言語 1 文の有効条件として付ける。

優先順位は次のとおり。

1. **no-regret**: どの回答でも必要になる影響範囲調査、対象ファイルの現状把握、既存パターン調査、関連テストケースの洗い出し
2. 推奨案が承認された場合に高確率で必要になる、読み取りだけの深掘り
3. 回答分岐に依存する作業は、確度が高い 1 分岐だけ

次は予測しない。

- 実装、修正、設定変更、コミット、Issue/PR 作成などの書き込み作業
- 回答によって不要になる確率が高い大規模調査
- 目的、対象範囲、成果の利用条件を具体化できない作業
- 既に現在のコンテキストで十分に判明している作業

有用な予測がなければ 0 件を正常結果とし、manifest を作らず、そのままユーザー入力待ちへ進む。

## 2. 件数上限を確認する

1 待ち区間で新規 dispatch できるのは最大 3 件である。待ち区間が変われば新規件数のカウントはリセットするが、manifest に前区間の `running` が残っている場合、新規分との合計を 3 件以下にする。

例:

- `running` 0 件: 新規 0〜3 件
- `running` 1 件: 新規 0〜2 件
- `running` 2 件: 新規 0〜1 件
- `running` 3 件: 新規 dispatch なし

`done` は running 上限には数えないが、次のユーザー入力を受けたターン冒頭で先に回収する。

## 3. manifest と出力先を準備する

プロジェクトルート直下の `.prefetch/manifest.md` を使う。初回 dispatch 前にメインエージェントが `.prefetch/` とタスクディレクトリを作り、manifest を次の形式で作成する。

```markdown
# prefetch manifest

| task-id | 予測内容 | 有効条件 | 状態 | 成果パス |
|---|---|---|---|---|
| fr-001 | 対象モジュールの既存実装パターンを調査する | 提示した設計案を採用する、または実装方針にかかわらず既存パターンの把握が必要な場合 | running | .prefetch/fr-001/result.md |
```

規約:

- task-id は `fr-<連番>`。既存エントリの最大番号に 1 を加え、同じ ID を再利用しない
- 予測内容は 1 行で、先行作業の目的と対象が分かるように書く
- 有効条件は自然言語 1 文で書き、回収時にメインエージェントがユーザー回答との合致を判断する
- 成果パスは必ず `.prefetch/<task-id>/result.md`
- dispatch の直前に `running` の行を追加する
- manifest の作成・追記・状態更新はメインエージェントだけが行う
- 先行サブエージェントは manifest を読んでも書き換えず、指定された `result.md` だけを書く

状態遷移:

- dispatch 時: `running`
- 完了通知を受領: `running → done`
- 合致した成果を利用: `done → harvested`
- 有効条件に不合致: `done → discarded`
- 実行失敗: `running → failed`

`running` のままユーザー回答が届き、有効条件に不合致と判定できた場合は、成果を読まず `discarded` としてよい。有効条件に合致する場合は、完了を待つか本作業を先に進めて後で合流させるかを、待ち時間と成果価値から判断する。

## 4. バックグラウンド dispatch を行う

利用可能な読み取り専用の探索サブエージェントを優先し、`run_in_background: true` で起動する。既定モデルは `haiku` とする。次のすべてを満たす場合だけ `sonnet` へ昇格する。

- 複数モジュールまたは複数レイヤー間の契約を追う必要がある
- 単純なファイル列挙やキーワード検索では結論が出ない
- 誤読した場合に承認後の実装方針へ大きな手戻りが出る

ファイル所在確認、既存例の収集、テスト候補列挙、単一モジュールの現状把握は `haiku` のままにする。

各 Agent への依頼は、次のブリーフを具体値で埋めて渡す。

```text
あなたは prefetch の先行探索担当です。以下の作業だけを実行してください。

目的: <回答後に利用する判断・作業>
調査対象: <具体的なディレクトリ、ファイル、シンボル、問い>
有効条件: <この成果が有効になる回答・分岐を自然言語 1 文で記載>
成果に必ず含めるもの:
- 結論
- 根拠となるファイルパスと行番号
- 関連する既存パターン、契約、影響範囲
- 未解決事項

制約:
- 読み取り主体で実行し、リポジトリのコード・設定・ドキュメントを変更しないこと
- 書き込みは <project-root>/.prefetch/<task-id>/result.md のみに限定すること
- .prefetch/manifest.md を変更しないこと
- スキルをロードしないこと
- Anthropic API、API クライアント、ANTHROPIC_API_KEY を使用しないこと
- コミット、Issue/PR 作成、外部への投稿を行わないこと

完了時は成果を <project-root>/.prefetch/<task-id>/result.md に書き、最終応答では完了した旨と成果パスだけを返してください。
```

`<project-root>`、`<task-id>`、`<...>` は dispatch 前に実値へ置き換え、プレースホルダを残さない。dispatch 後、同一ターン内で予定していた質問・承認依頼・レビュー依頼をユーザーへ送る。

## 5. ターン冒頭で回収する

ユーザー回答を受けたターンの冒頭で、他の探索・実装・追加質問より先に次を行う。

1. `.prefetch/manifest.md` を確認する。存在しなければ通常フローへ進む
2. 完了通知を受けたエントリを `running` から `done` へ更新する。失敗通知なら `failed` へ更新する
3. 各 `done` の有効条件を今回のユーザー回答と照合する
4. 合致したエントリだけ `result.md` を読み、現在の作業へ利用して `harvested` に更新する
5. 合致しないエントリは `result.md` を読まず `discarded` に更新する
6. `running` で有効条件に合致するものは、完了を待つか通常作業を進めて後から合流させる
7. `running` で有効条件に合致しないものは成果を利用せず `discarded` にする

有効条件の合致は機械判定せず、メインエージェントがユーザー回答と会話文脈から判断する。回収した情報は既存コードを再確認した場合と同じ証拠として扱い、成果内の推測を未検証の事実として扱わない。

## 6. エラー時の扱い

- 予測ミス: 成果を読まず `discarded`。通常フローへ戻る
- サブエージェント失敗: `failed`。必要なら通常フローでその場調査する
- `result.md` 不在または途中: 利用せず、完了を待たないなら `failed` として通常フローへ戻る
- 全予測ミス: 全件を `discarded` にして通常フローへ戻る
- 回収済み: `harvested` / `discarded` / `failed` は再回収しない

prefetch のために本作業を不必要に停止しない。成果が間に合わない場合は、prefetch なしの場合と同じ進め方に戻る。
````

**Steps:**

- [ ] `mkdir -p plugins/prefetch/skills/prefetch` を実行し、Skill ディレクトリを作成する。
- [ ] 上記全文を `plugins/prefetch/skills/prefetch/SKILL.md` に書き出す。
- [ ] `node -e 'const fs=require("fs"); const s=fs.readFileSync("plugins/prefetch/skills/prefetch/SKILL.md","utf8"); const fm=s.match(/^---\n([\s\S]*?)\n---/); if(!fm) process.exit(1); const keys=fm[1].split("\n").filter(Boolean).map(x=>x.split(":",1)[0]); if(keys.join(",")!=="name,description"||!fm[1].includes("name: prefetch")) process.exit(1); console.log("OK")'` を実行し、期待出力 `OK` を確認する。
- [ ] `for term in 'AskUserQuestion' 'ExitPlanMode' 'no-regret' 'run_in_background: true' 'haiku' 'sonnet' 'running → done' 'harvested' 'discarded' 'failed' '最大 3 件' 'スキルをロードしないこと'; do grep -Fq "$term" plugins/prefetch/skills/prefetch/SKILL.md || { echo "missing: $term"; exit 1; }; done; echo OK` を実行し、期待出力 `OK` を確認する。
- [ ] `grep -n '<project-root>\|<task-id>\|<回答後に利用する判断・作業>\|<具体的なディレクトリ' plugins/prefetch/skills/prefetch/SKILL.md` を実行し、dispatch ブリーフの雛形内に意図して残した置換対象だけが表示されることを確認する。実行時には直後の指示どおりすべて実値へ置き換える契約になっていることを目視する。
- [ ] `git diff --check -- plugins/prefetch/skills/prefetch/SKILL.md` を実行し、出力なし・exit 0 を確認する。
- [ ] `git add plugins/prefetch/skills/prefetch/SKILL.md && git commit -m "feat(prefetch): 先行探索と回収の Skill を追加" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"` を実行する。

---

## Task 3: UserPromptSubmit 回収リマインダーフックを作成する

**Files:**
- Create: `plugins/prefetch/hooks/hooks.json`
- Create: `plugins/prefetch/scripts/check-prefetch-manifest.mjs`

**Interfaces:** Task 2 の manifest 5 列テーブルを入力契約とする。Claude Code の UserPromptSubmit hook から stdin JSON の `cwd`、または `CLAUDE_PROJECT_DIR` を受け取り、プロジェクトルートの `.prefetch/manifest.md` を読む。未回収状態 `running` / `done` の実タスク行が 1 件以上ある場合だけ `hookSpecificOutput.additionalContext` 形式の JSON を stdout に出力し、不可視のコンテキストとして注入させる(既存プラグイン revelation/pitcrew と同形式)。すべての分岐で exit 0 とし、フック障害でユーザープロンプトを妨げない。

### `hooks/hooks.json` 完成形の全文

````json
{
  "description": "prefetch の未回収成果がある場合だけ、次のユーザー入力時に回収プロトコルの実行を促す",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/check-prefetch-manifest.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
````

### `scripts/check-prefetch-manifest.mjs` 完成形の全文

````javascript
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

let input = {};
try {
  const rawInput = fs.readFileSync(0, "utf8");
  input = rawInput.trim() ? JSON.parse(rawInput) : {};
} catch {
  process.exit(0);
}

const projectDir =
  process.env.CLAUDE_PROJECT_DIR ||
  (typeof input.cwd === "string" ? input.cwd : process.cwd());
const manifestPath = path.join(projectDir, ".prefetch", "manifest.md");

let manifest;
try {
  manifest = fs.readFileSync(manifestPath, "utf8");
} catch {
  process.exit(0);
}

const hasUnharvestedEntry = manifest.split(/\r?\n/).some((line) => {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length < 7) return false;

  // 予測内容・有効条件の自由記述列に | が混入しても位置がずれないよう、
  // 固定フォーマットの task-id(先頭列)と状態(末尾から3番目 = 成果パス列の直前)で判定する
  const taskId = cells[1];
  const state = cells[cells.length - 3];
  return /^fr-\d+$/.test(taskId) && (state === "running" || state === "done");
});

if (!hasUnharvestedEntry) process.exit(0);

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        "未回収の prefetch 成果があります。ターン冒頭で .prefetch/manifest.md を確認し、今回のユーザー入力と有効条件を照合してください。合致する done の result.md だけを読み harvested に更新し、不合致は成果を読まず discarded、失敗は failed に更新してください。合致する running は、完了を待つか通常作業を進めて後から合流させてください。",
    },
  })}\n`,
);
````

**Steps:**

- [ ] `mkdir -p plugins/prefetch/hooks plugins/prefetch/scripts` を実行し、フック設定とスクリプトのディレクトリを作成する。
- [ ] 上記全文を `plugins/prefetch/hooks/hooks.json` と `plugins/prefetch/scripts/check-prefetch-manifest.mjs` にそれぞれ書き出す。
- [ ] `node -e 'const h=require("./plugins/prefetch/hooks/hooks.json"); const c=h.hooks.UserPromptSubmit?.[0]?.hooks?.[0]; if(c?.type!=="command"||!c.command.includes("${CLAUDE_PLUGIN_ROOT}/scripts/check-prefetch-manifest.mjs")||c.timeout!==15) process.exit(1); console.log("OK")'` を実行し、期待出力 `OK` を確認する。
- [ ] `node --check plugins/prefetch/scripts/check-prefetch-manifest.mjs` を実行し、出力なし・exit 0 を確認する。
- [ ] manifest あり・未回収ありのケースを直接実行する。次のコマンドの stdout が `hookSpecificOutput` / `additionalContext` を含む 1 行の JSON で、`additionalContext` の値が `未回収の prefetch 成果があります。` から始まることを確認する。

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/.prefetch"
cat > "$tmp/.prefetch/manifest.md" <<'EOF'
# prefetch manifest

| task-id | 予測内容 | 有効条件 | 状態 | 成果パス |
|---|---|---|---|---|
| fr-001 | 現状調査 | 承認された場合 | running | .prefetch/fr-001/result.md |
| fr-002 | テスト候補調査 | どの回答でも有効 | done | .prefetch/fr-002/result.md |
EOF
printf '{"cwd":"%s"}\n' "$tmp" | node plugins/prefetch/scripts/check-prefetch-manifest.mjs
rm -rf "$tmp"
```

期待出力(1 行の JSON):

```text
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"未回収の prefetch 成果があります。ターン冒頭で .prefetch/manifest.md を確認し、今回のユーザー入力と有効条件を照合してください。合致する done の result.md だけを読み harvested に更新し、不合致は成果を読まず discarded、失敗は failed に更新してください。合致する running は、完了を待つか通常作業を進めて後から合流させてください。"}}
```

- [ ] manifest 不在のケースを直接実行する。次のコマンドの stdout バイト数が `0` であることを確認する。

```bash
tmp="$(mktemp -d)"
bytes="$(printf '{"cwd":"%s"}\n' "$tmp" | node plugins/prefetch/scripts/check-prefetch-manifest.mjs | wc -c)"
rm -rf "$tmp"
test "$bytes" -eq 0 && echo OK
```

期待出力:

```text
OK
```

- [ ] 全件回収済みのケースを直接実行する。次のコマンドの stdout バイト数が `0` であることを確認する。

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/.prefetch"
cat > "$tmp/.prefetch/manifest.md" <<'EOF'
# prefetch manifest

| task-id | 予測内容 | 有効条件 | 状態 | 成果パス |
|---|---|---|---|---|
| fr-001 | 現状調査 | 承認された場合 | harvested | .prefetch/fr-001/result.md |
| fr-002 | 別案調査 | 別案が選ばれた場合 | discarded | .prefetch/fr-002/result.md |
| fr-003 | 失敗した調査 | 承認された場合 | failed | .prefetch/fr-003/result.md |
EOF
bytes="$(printf '{"cwd":"%s"}\n' "$tmp" | node plugins/prefetch/scripts/check-prefetch-manifest.mjs | wc -c)"
rm -rf "$tmp"
test "$bytes" -eq 0 && echo OK
```

期待出力:

```text
OK
```

- [ ] 表以外の本文に `running` / `done` が書かれていても誤発火しないことを確認する。次のコマンドの期待出力は `OK`。

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/.prefetch"
printf '# note\nrunning と done は説明文です。\n' > "$tmp/.prefetch/manifest.md"
bytes="$(printf '{"cwd":"%s"}\n' "$tmp" | node plugins/prefetch/scripts/check-prefetch-manifest.mjs | wc -c)"
rm -rf "$tmp"
test "$bytes" -eq 0 && echo OK
```

- [ ] `git diff --check -- plugins/prefetch/hooks/hooks.json plugins/prefetch/scripts/check-prefetch-manifest.mjs` を実行し、出力なし・exit 0 を確認する。
- [ ] `git add plugins/prefetch/hooks/hooks.json plugins/prefetch/scripts/check-prefetch-manifest.mjs && git commit -m "feat(prefetch): 未回収成果のリマインダーフックを追加" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"` を実行する。

---

## Task 4: 導入手順と動作モデルを説明する README を作成する

**Files:**
- Create: `plugins/prefetch/README.md`

**Interfaces:** Task 1 の名称・バージョン、Task 2 の予測・manifest・回収プロトコル、Task 3 のノイズゼロ UserPromptSubmit フックを利用者向けに説明する。Marketplace 登録前でもローカル開発時に内容を確認できる。

**完成形の全文:**

````markdown
# prefetch

ユーザー入力待ちの直前に、回答後に高確率で必要となる読み取り主体の探索をバックグラウンドで先行実行し、回答後の立ち上がり時間を短縮する Claude Code プラグインです。

CPU の投機実行と同様に、「次に必要になりそうで、外れても副作用がない作業」だけを先に進めます。予測が外れた場合や先行探索が失敗した場合は成果を破棄し、通常フローへ戻ります。

## 導入

Claude Code で Marketplace を追加します。

```text
/plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
```

Marketplace から `prefetch` をインストールします。

```text
/plugin prefetch
```

プロジェクト単位またはユーザー単位で導入する場合はスコープを指定します。

```text
/plugin prefetch --scope project
/plugin prefetch --scope user
```

インストールまたはフック設定の更新後は、Claude Code のセッションを再起動してフックを反映してください。

## `.gitignore` の設定

prefetch の成果はプロジェクトルートの `.prefetch/` に保存されます。これはセッションローカルな投機成果であり、リポジトリへコミットしません。利用プロジェクトの `.gitignore` に次の 1 行を追加してください。

```gitignore
.prefetch/
```

プラグインは `.gitignore` を自動変更しません。

## 動作モデル

### 1. 予測

Claude が次のようなユーザー入力待ちに入る直前、回答後に必要となる読み取り主体の作業を予測します。

- AskUserQuestion による質問
- ExitPlanMode による計画承認依頼
- 設計、計画、スペックのレビュー依頼

どの回答でも必要になる影響範囲調査、既存実装パターンの確認、関連テストケースの洗い出しなどの no-regret な作業を優先します。有用な予測がなければ何も起動しません。

### 2. 先行実行

予測した作業をバックグラウンドサブエージェントへ渡し、ユーザーが回答を考えている間に実行します。

- 先行作業は読み取り主体のみ
- コード、設定、通常ドキュメントは変更しない
- 成果は `.prefetch/<task-id>/result.md` のみに保存
- 先行サブエージェントはスキルをロードしない
- 既定モデルは `haiku`、複数モジュール間の契約を追う深い探索だけ `sonnet`
- 1 回の入力待ちにつき最大 3 件。前回の `running` を含む合計も最大 3 件

### 3. 回収

次のユーザー入力を受けたターンの冒頭で `.prefetch/manifest.md` を確認します。

- 回答の有効条件に合致する成果だけを読み、`harvested` にする
- 合致しない成果は読まずに `discarded` にする
- 失敗した探索は `failed` にして通常フローへ戻る
- 実行中の成果は、待つ価値があれば完了を待ち、そうでなければ通常作業を先に進める

UserPromptSubmit フックは manifest に `running` または `done` がある場合だけ回収リマインダーをコンテキストへ注入します。manifest がない場合や全件回収済みの場合は何も出力しません。

## manifest

`.prefetch/manifest.md` は次の形式です。

```markdown
# prefetch manifest

| task-id | 予測内容 | 有効条件 | 状態 | 成果パス |
|---|---|---|---|---|
| fr-001 | 対象モジュールの既存実装パターンを調査する | 提示した設計案が承認された場合 | running | .prefetch/fr-001/result.md |
```

状態は次の順に遷移します。

```text
running → done → harvested
               → discarded
running → failed
```

manifest を更新するのはメインエージェントだけです。先行サブエージェントは manifest に触れず、自分の `result.md` だけを書きます。

## ガードレール

- Anthropic API、API キー、外部 API クライアントを使用しません
- 他のプラグインに依存しません
- 予測ミスは成果を破棄するだけで、コードへの副作用を残しません
- prefetch が失敗・未完了でも本作業を止めません
- `.prefetch/` 以外へ先行書き込みを行いません

## 構成

```text
plugins/prefetch/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── scripts/
│   └── check-prefetch-manifest.mjs
├── skills/
│   └── prefetch/
│       └── SKILL.md
└── README.md
```

このプラグインは Markdown、JSON、Node.js の `.mjs` だけで構成され、ビルドは不要です。
````

**Steps:**

- [ ] 上記全文を `plugins/prefetch/README.md` に書き出す。
- [ ] `for term in '/plugin marketplace add' '/plugin prefetch' '.prefetch/' 'AskUserQuestion' 'ExitPlanMode' 'no-regret' '最大 3 件' 'running → done' 'UserPromptSubmit' 'ビルドは不要'; do grep -Fq "$term" plugins/prefetch/README.md || { echo "missing: $term"; exit 1; }; done; echo OK` を実行し、期待出力 `OK` を確認する。
- [ ] `grep -nE 'ANTHROPIC_API_KEY|npm install|pnpm build' plugins/prefetch/README.md` を実行し、出力なし・exit 1 を確認する。
- [ ] `git diff --check -- plugins/prefetch/README.md` を実行し、出力なし・exit 0 を確認する。
- [ ] `git add plugins/prefetch/README.md && git commit -m "docs(prefetch): 導入手順と動作モデルを追加" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"` を実行する。

---

## Task 5: Marketplace に登録し、全体を手動検証する

**Files:**
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:** Task 1 の `plugin.json` と同じ `name` / `description` を Marketplace entry に使い、`source` を `./plugins/prefetch` にする。Task 2〜4 の全配布物が揃った状態で Marketplace から発見可能にする。設計書 §6 の正常系・予測ミス系・フック系を最終受け入れ条件とする。

**追加する Marketplace entry:**

````json
{
  "name": "prefetch",
  "source": "./plugins/prefetch",
  "description": "ユーザー入力待ちの直前に、次に必要となる読み取り主体の作業をバックグラウンドで先行実行し、回答後の待ち時間を短縮する"
}
````

既存 `plugins` 配列の末尾に、直前エントリとの区切りカンマを含めて追加する。既存エントリの順序・文言は変更しない。

**Steps:**

- [ ] `.claude-plugin/marketplace.json` の `plugins` 配列末尾へ上記 entry を追加する。
- [ ] `node -e 'const fs=require("fs"); const market=JSON.parse(fs.readFileSync(".claude-plugin/marketplace.json","utf8")); const plugin=JSON.parse(fs.readFileSync("plugins/prefetch/.claude-plugin/plugin.json","utf8")); const entries=market.plugins.filter(x=>x.name==="prefetch"); if(entries.length!==1||entries[0].source!=="./plugins/prefetch"||entries[0].description!==plugin.description) process.exit(1); console.log("OK")'` を実行し、期待出力 `OK` を確認する。
- [ ] `find plugins/prefetch -type f -printf '%P\n' | sort` を実行し、次の 5 ファイルだけが表示されることを確認する。

```text
.claude-plugin/plugin.json
README.md
hooks/hooks.json
scripts/check-prefetch-manifest.mjs
skills/prefetch/SKILL.md
```

- [ ] `test ! -d plugins/prefetch/src && test ! -f plugins/prefetch/package.json && echo OK` を実行し、期待出力 `OK` を確認する。`pnpm build` は実行しない。
- [ ] `node --check plugins/prefetch/scripts/check-prefetch-manifest.mjs && node -e 'JSON.parse(require("fs").readFileSync("plugins/prefetch/.claude-plugin/plugin.json")); JSON.parse(require("fs").readFileSync("plugins/prefetch/hooks/hooks.json")); JSON.parse(require("fs").readFileSync(".claude-plugin/marketplace.json")); console.log("OK")'` を実行し、期待出力 `OK` を確認する。

> **手動シナリオ 1・2 の実施主体について:** 以下の 2 シナリオは実際の Claude Code 対話セッションを必要とするため、実装サブエージェントは実行できない。実装者はシナリオ 3(フックスクリプト直接実行)までを完了してコミットし、シナリオ 1・2 は**実装完了後にユーザーが実セッションで行う受け入れ検証**として残す(チェックボックスは未チェックのまま引き渡してよい)。テストプロジェクトの準備は「git init した空ディレクトリで、この Marketplace をローカルパス(`/plugin marketplace add <このリポジトリの絶対パス>`)で追加し `/plugin prefetch` でインストール、セッション再起動」で行う。

### 手動シナリオ 1: 正常系(予測 → 先行 → 承認 → 回収)

- [ ] git 管理された一時テストプロジェクトを開き、prefetch プラグインを有効にした新しい Claude Code セッションを開始する。
- [ ] 「既存構造を調査して小さな機能の実装計画を提示し、実装前に承認を求めてください」と依頼する。
- [ ] 承認依頼と同一ターン内で、`.prefetch/manifest.md` に 1〜3 件の `running` 行が作られ、各 Agent が `run_in_background: true`、原則 `haiku` で起動されることをツール履歴で確認する。
- [ ] 各依頼文に「読み取り主体」「`.prefetch/<task-id>/result.md` のみ書き込み」「manifest を変更しない」「スキルをロードしない」が含まれることを確認する。
- [ ] 提示案を承認するユーザー回答を送り、UserPromptSubmit の additionalContext に回収リマインダーが注入されることを確認する。
- [ ] ターン冒頭で manifest が確認され、完了済みの合致成果だけが読まれ、状態が `done → harvested` になり、その根拠が直後の本作業で利用されることを確認する。
- [ ] `git status --short -- ':!.prefetch'` を実行し、先行サブエージェント由来の変更がないこと(出力が空)を確認する。

### 手動シナリオ 2: 予測ミス系(不合致成果の破棄)

- [ ] 推奨案 A と代替案 B を提示させ、「案 A が承認された場合」を有効条件とする先行探索を 1 件 dispatch させる。
- [ ] ユーザー回答で案 B を選択する。
- [ ] 次ターン冒頭で manifest が確認され、有効条件に不合致の `result.md` が読み込まれず、該当状態が `discarded` に更新されることを確認する。
- [ ] 案 B の作業が通常フローで継続し、prefetch の完了待ち・失敗によってブロックされないことを確認する。
- [ ] `git status --short -- ':!.prefetch'` で投機作業の副作用がないこと(出力が空)を確認する。

### 手動シナリオ 3: フック系(未回収時のみ注入)

- [ ] Task 3 記載の直接実行コマンドを再実行し、`running` / `done` 行がある manifest ではリマインダーが 1 回出力されることを確認する。
- [ ] manifest 不在では stdout が 0 byte であることを確認する。
- [ ] `harvested` / `discarded` / `failed` だけの manifest では stdout が 0 byte であることを確認する。
- [ ] manifest 本文に単なる説明として `running` / `done` があるだけでは stdout が 0 byte であり、実タスク行だけを判定することを確認する。

### 最終整合性とコミット

- [ ] `grep -RInE 'Anthropic APIを使用|ANTHROPIC_API_KEY|apiKey|@anthropic-ai' plugins/prefetch` を実行し、API 利用実装がないことを目視確認する。README の「Anthropic API を使用しません」という禁止説明だけがヒットする場合は正常とする。
- [ ] `grep -RIn '<project-root>\|<task-id>\|<回答後に利用する判断・作業>\|<具体的なディレクトリ' plugins/prefetch` を実行し、Skill の dispatch ブリーフ雛形と置換指示以外に未置換の山括弧フィールドがないことを確認する。
- [ ] `git diff --check -- .claude-plugin/marketplace.json plugins/prefetch` を実行し、出力なし・exit 0 を確認する。
- [ ] `git status --short` を確認し、この計画の対象外ファイルに変更がないことを確認する。
- [ ] `.claude-plugin/marketplace.json` の差分だけを `git add` し、`git commit -m "feat(prefetch): Marketplace に登録" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"` を実行する。
- [ ] `git log -5 --format='%h %s%n%b'` を確認し、5 コミットが意味単位で分かれ、各コミット本文末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` があることを確認する。
