# agent-policy 委譲先の実行モデル確定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent-policy の 2 方針スキルにある節「役割 Agents を持つプラグインとの併用」を、`model` 未指定 / `model: inherit` の Agents 定義全般を対象とする節「委譲先の実行モデルの確定」へ置き換える。

**Architecture:** 完全静的な Markdown プラグイン。両 SKILL.md で旧節(末尾)を削除し、新節を「モデル別役割」の直後へ挿入する。README を対象範囲の拡張に合わせて改訂し、`plugin.json` のバージョンを上げる。コードもビルドも発生しない。

**Tech Stack:** Markdown のみ。ビルド不要(`pnpm build` の対象外 — agent-policy は `src/` を持たない静的プラグイン)。

**設計書:** `docs/design/2026-07-29-agent-policy-inherit-model-resolution-design.md`

## Global Constraints

- SKILL.md は AI 向け文書である。規律の実行に不要な根拠・引用・具体例・補足を本文に置かない。
- SKILL.md の frontmatter(`name` / `description`)は変更しない。
- 本文の表記は既存に揃える: 全角括弧を使わず半角 `(` `)`、箇条書きは `-`、文末は「〜すること。」または「〜する。」。
- `docs/design/` および `docs/plans/` 配下の過去文書は書き換えない。旧節名がそれらに残っているのは当時の記録として正しい。
- `docs/chat/**/*.md` は読まない(リポジトリ規約)。
- テストランナーは存在しない。各タスクの検証は `grep` / `diff` / 目視で行う。

## File Structure

| パス | 変更 | 責務 |
| --- | --- | --- |
| `plugins/agent-policy/skills/with-codex/SKILL.md` | 修正 | Claude+GPT 併用構成の運用方針。GPT 帯の分岐を持つ |
| `plugins/agent-policy/skills/claude-only/SKILL.md` | 修正 | Claude のみ構成の運用方針。GPT 帯の分岐を持たない |
| `plugins/agent-policy/README.md` | 修正 | 人間向け説明。根拠・具体例の受け皿 |
| `plugins/agent-policy/.claude-plugin/plugin.json` | 修正 | manifest。`version` のみ変更 |

タスクは「変更するファイル単位」ではなく「レビュアーが独立に可否を判断できる単位」で切る。Task 1 と Task 2 は同じ構造の変更を別スキルへ適用するもので、片方だけ差し戻される可能性があるため分ける。Task 3 は人間向け文書で判断基準が異なるため分ける。Task 4 はリリース単位の確定であり、Task 1〜3 がすべて通ってから行う。

---

### Task 1: with-codex/SKILL.md の節を置き換える

**Files:**
- Modify: `plugins/agent-policy/skills/with-codex/SKILL.md`(削除 64-77 行 / 挿入 35-37 行の間)

**Interfaces:**
- Consumes: なし(最初のタスク)
- Produces: 新節タイトル「委譲先の実行モデルの確定」。Task 3 の README がこの節名を参照する。

- [ ] **Step 1: 変更前の状態を記録する**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
grep -n "^#\{2,3\} " plugins/agent-policy/skills/with-codex/SKILL.md
wc -l plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected:
```
10:## モデル別役割
37:## コードベース探索
44:## コスト規律
50:## 設計・実装計画の規律
56:## GPT が使えない場合のフォールバック
64:## 役割 Agents を持つプラグインとの併用
70:### フェーズの担当が GPT モデルに相当する場合
75:### フェーズの担当が Claude モデルに相当する場合
77 plugins/agent-policy/skills/with-codex/SKILL.md
```

行番号がこれと異なる場合は先に進まず、差異を報告すること。

- [ ] **Step 2: 旧節を削除する**

64 行目 `## 役割 Agents を持つプラグインとの併用` から 77 行目(ファイル末尾)までを削除する。あわせて 63 行目の空行も削除し、ファイルが `## GPT が使えない場合のフォールバック` 節の最終行(62 行目、`3. どちらも不可なら、〜` で始まる行)で終わるようにする。

削除対象の全文(これが残っていないことを確認するための参照):

```markdown
## 役割 Agents を持つプラグインとの併用

役割プロンプトを持つ Agents(`model: inherit`、例 Codiel の `codiel-implementer-*`)でフェーズを駆動するプラグインとの合成ルール。
各フェーズの作業種別を本方針の担当表に照らす(例: 実装 → GPT 帯)。
役割定義ファイルは常にインストール済みプラグインの生ファイルから読む(複製・改変版を作らない)。

### フェーズの担当が GPT モデルに相当する場合

- GPT が利用可能なら: 該当する役割 Agent 定義ファイルの本文(frontmatter を除く)を、担当 GPT エージェントへの依頼文に役割定義として同梱して dispatch する。dispatch 時の `model` 上書きは使わない。依頼文に「この tools のみ使用」と明記すること。
- GPT が利用不可(未生成・プロキシ停止・codex プラグイン使用不可)なら(フォールバック): プラグインの役割 Agents をそのまま起動すること。

### フェーズの担当が Claude モデルに相当する場合

- `model: inherit` の役割 Agents は、本方針の担当表に合わせて dispatch 時の `model` 上書きを併用すること。
```

- [ ] **Step 3: 削除を検証する**

```bash
grep -c "役割 Agents を持つプラグイン" plugins/agent-policy/skills/with-codex/SKILL.md
tail -c 200 plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected: `grep -c` が `0`。`tail` の出力が `3. どちらも不可なら、ユーザーへ` で始まる行で終わり、その後に空行以外が無いこと。

- [ ] **Step 4: 新節を挿入する**

35 行目 `- サブエージェントは、指定がない限りスキルをロードしてはならない。` と 37 行目 `## コードベース探索` の間(36 行目の空行の位置)へ、以下を挿入する。挿入後、新節の前後がそれぞれ空行 1 行で区切られること。

挿入する本文(この通りに、一字一句):

```markdown
## 委譲先の実行モデルの確定

すべての dispatch の前に、委譲先の実行モデルを確定させること。

- セッションで初めて委譲する Agents は、定義ファイルの frontmatter `model` を確認する。原本を読み、複製・改変版を作らない。
- ビルトイン Agents(`Explore` / `Plan` / `general-purpose` 等)は `inherit` として扱う。
- `model` が具体的なモデルに指定されている Agents は、そのまま起動する。担当表で上書きしない。
- `model` 未指定・`inherit` の Agents は、作業種別を担当表に照らして実行帯を決め、以下に従う。

### 実行帯が Claude モデルの場合

dispatch 時の `model` 上書きで実行帯を明示する。委譲元と同じ帯でも明示する。

### 実行帯が GPT モデルの場合

- 定義ファイルを持つ Agents: 定義本文(frontmatter を除く)を担当 GPT エージェントへの依頼文に役割定義として同梱して dispatch する。`model` 上書きは使わない。依頼文に「この tools のみ使用」と明記する。
- ビルトイン Agents: 使わず、担当 GPT エージェントへ直接委譲する。
- GPT が利用不可なら、対象 Agents をそのまま起動する。
```

- [ ] **Step 5: 節構成を検証する**

```bash
grep -n "^#\{2,3\} " plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected(新節が「モデル別役割」の直後、「コードベース探索」の前にあること):
```
10:## モデル別役割
37:## 委譲先の実行モデルの確定
46:### 実行帯が Claude モデルの場合
50:### 実行帯が GPT モデルの場合
56:## コードベース探索
63:## コスト規律
69:## 設計・実装計画の規律
75:## GPT が使えない場合のフォールバック
```

行番号の根拠(検算済み): 挿入する本文は空行込み 18 行。37 行目から始まり 54 行目で終わる。55 行目が空行、56 行目が `## コードベース探索`。既存の後続節はすべて +19 行される。

`wc -l` は 95 行になる(元 77 行 − 削除 15 行 + 挿入 19 行 = 81 ... ではなく、削除は 63-77 の 15 行、挿入は本文 18 行 + 区切り空行 1 行 = 19 行。77 − 15 + 19 = 81)。

```bash
wc -l plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected: `81`

- [ ] **Step 6: 内容を検証する**

```bash
sed -n '37,54p' plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected: Step 4 で挿入した本文と完全一致。特に以下 4 点を目視で確認する。

1. 「委譲元と同じ帯でも明示する。」が含まれている(この短句を落とすと抜け道が残る)
2. 「原本を読み、複製・改変版を作らない。」が含まれている
3. Codiel / `codiel-implementer-*` への言及が**無い**
4. 「オーケストレーターは上位帯にいるため」等の真因説明が**無い**

- [ ] **Step 7: 全体を通読して整合を確認する**

```bash
cat plugins/agent-policy/skills/with-codex/SKILL.md
```

確認事項:
- frontmatter(`name: with-codex` / `description`)が変わっていないこと
- 「GPT が使えない場合のフォールバック」節が残っており、新節の「GPT が利用不可なら」と矛盾しないこと
- 見出しレベル(`##` / `###`)が既存節と揃っていること

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/skills/with-codex/SKILL.md
git commit -m "feat(agent-policy): with-codex の併用節を委譲先の実行モデル確定へ拡張

対象を役割 Agents を持つプラグイン限定から、model 未指定/inherit の
Agents 定義全般(ビルトイン含む)へ広げる。model が pin された Agents は
対象外とする。全 dispatch の前提チェックとなるため位置をモデル別役割の
直後へ移動。"
```

---

### Task 2: claude-only/SKILL.md の節を置き換える

**Files:**
- Modify: `plugins/agent-policy/skills/claude-only/SKILL.md`(削除 56-59 行 / 挿入 35-37 行の間)

**Interfaces:**
- Consumes: Task 1 で確定した新節タイトル「委譲先の実行モデルの確定」および箇条書き 4 項目の文面。claude-only は GPT 帯を持たないため `###` サブ節を作らず、4 項目目に dispatch 上書きの指示を畳み込む。
- Produces: 2 スキル間で節タイトル・冒頭 3 項目が一致した状態。Task 3 の README がこれを前提にする。

- [ ] **Step 1: 変更前の状態を記録する**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
grep -n "^#\{2,3\} " plugins/agent-policy/skills/claude-only/SKILL.md
wc -l plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected:
```
10:## モデル別役割
37:## コードベース探索
44:## コスト規律
50:## 設計・実装計画の規律
56:## 役割 Agents を持つプラグインとの併用
59 plugins/agent-policy/skills/claude-only/SKILL.md
```

行番号がこれと異なる場合は先に進まず、差異を報告すること。

- [ ] **Step 2: 旧節を削除する**

56 行目 `## 役割 Agents を持つプラグインとの併用` から 59 行目(ファイル末尾)までを削除する。あわせて 55 行目の空行も削除し、ファイルが `## 設計・実装計画の規律` 節の最終行(54 行目、`- 計画から実装への移行は、` で始まる行)で終わるようにする。

削除対象の全文:

```markdown
## 役割 Agents を持つプラグインとの併用

- 役割 Agents を持つワークフロープラグイン(例: Codiel の `codiel-implementer-*`)は、そのまま起動すること。
- `model: inherit` の役割 Agents は、本方針の担当表に合わせて dispatch 時の `model` 上書きを併用すること。
```

- [ ] **Step 3: 削除を検証する**

```bash
grep -c "役割 Agents を持つプラグイン" plugins/agent-policy/skills/claude-only/SKILL.md
tail -c 200 plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected: `grep -c` が `0`。`tail` の出力が `- 計画から実装への移行は、` で始まる行で終わること。

- [ ] **Step 4: 新節を挿入する**

35 行目 `- サブエージェントは、指定がない限りスキルをロードしてはならない。` と 37 行目 `## コードベース探索` の間へ、以下を挿入する。

挿入する本文(この通りに、一字一句):

```markdown
## 委譲先の実行モデルの確定

すべての dispatch の前に、委譲先の実行モデルを確定させること。

- セッションで初めて委譲する Agents は、定義ファイルの frontmatter `model` を確認する。原本を読み、複製・改変版を作らない。
- ビルトイン Agents(`Explore` / `Plan` / `general-purpose` 等)は `inherit` として扱う。
- `model` が具体的なモデルに指定されている Agents は、そのまま起動する。担当表で上書きしない。
- `model` 未指定・`inherit` の Agents は、作業種別を担当表に照らし、dispatch 時の `model` 上書きで実行帯を明示する。委譲元と同じ帯でも明示する。
```

`###` サブ節は作らないこと。claude-only には GPT 帯が存在せず、分岐が不要なため。

- [ ] **Step 5: 節構成を検証する**

```bash
grep -n "^#\{2,3\} " plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected:
```
10:## モデル別役割
37:## 委譲先の実行モデルの確定
46:## コードベース探索
53:## コスト規律
59:## 設計・実装計画の規律
```

`###` 見出しが 1 つも出力されないこと。

行番号の根拠(検算済み): 挿入する本文は空行込み 8 行。37 行目から始まり 44 行目で終わる。45 行目が空行、46 行目が `## コードベース探索`。既存の後続節はすべて +9 行される。

```bash
wc -l plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected: `63`(元 59 行 − 削除 5 行 + 挿入 9 行)

- [ ] **Step 6: 2 スキル間の一致を検証する**

両スキルの新節の冒頭部(タイトル + 空行 + 導入 1 行 + 空行 + 箇条書き 3 項目 = 37〜43 行目の 7 行)は同一でなければならない。

```bash
diff <(sed -n '37,43p' plugins/agent-policy/skills/claude-only/SKILL.md) \
     <(sed -n '37,43p' plugins/agent-policy/skills/with-codex/SKILL.md)
```

Expected: 差分なし(出力が空)。

差分が出た場合、どちらかの転記に誤りがある。Task 1 の Step 4 の本文を正とする。

- [ ] **Step 7: 4 項目目の差異を確認する**

```bash
sed -n '44p' plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected: `- \`model\` 未指定・\`inherit\` の Agents は、作業種別を担当表に照らし、dispatch 時の \`model\` 上書きで実行帯を明示する。委譲元と同じ帯でも明示する。`

with-codex 側(「以下に従う。」で終わる)と意図的に異なる。これは設計どおり。

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/skills/claude-only/SKILL.md
git commit -m "feat(agent-policy): claude-only の併用節を委譲先の実行モデル確定へ拡張

with-codex と同じ規律を適用する。GPT 帯が無いため分岐を持たず 4 箇条で
閉じる。"
```

---

### Task 3: README を改訂する

**Files:**
- Modify: `plugins/agent-policy/README.md`(46 行目の箇条書き 1 項目を置換 / 52 行目の節名参照を更新)

**Interfaces:**
- Consumes: Task 1・Task 2 で確定した節名「委譲先の実行モデルの確定」
- Produces: なし(最終的な人間向け説明)

- [ ] **Step 1: 変更前の状態を確認する**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
sed -n '42,53p' plugins/agent-policy/README.md
```

Expected: `## 他プラグインとの棲み分け` 節に箇条書き 3 項目、続いて `## 設計上の確定事実(dispatch 時の model 上書き制限)` 節。

- [ ] **Step 2: 棲み分け節の 3 項目目を置換する**

46 行目の箇条書き 1 項目(`- 役割 Agents を持つワークフロープラグイン(例: Codiel)との併用: 〜` で始まり `詳細な判断フローは各 Skill 本文に記載。` で終わる 1 行)を、以下の 1 行で置き換える。**前後 2 項目(`agent-policy` の位置づけ / `revelation` との棲み分け)は変更しない。**

置換後の内容:

```markdown
- 他プラグイン・自作 Agents との併用: Claude Code の Agents は `model` を省略すると `inherit`(委譲元と同じモデル)になる。agent-policy はこれを検出して担当表どおりの実行帯へ寄せる規律を持つ。対象は `model` 未指定 / `inherit` の Agents 定義全般で、プラグイン由来(例: Codiel の `codiel-implementer-*`)・プロジェクトやユーザーの自作・ビルトイン(`Explore` / `Plan` / `general-purpose`)を問わない。逆に `model` が具体的なモデルに指定された Agents は定義者の意図表明として尊重し、対象外とする。`with-codex` では、実行帯が GPT に相当するフェーズで役割定義本文を GPT エージェントへの依頼文に注入する合成方式(役割プロンプト × GPT 実行)をとる。詳細な判断フローは各 Skill 本文の §委譲先の実行モデルの確定 に記載。
```

- [ ] **Step 3: 確定事実節の節名参照を更新する**

`## 設計上の確定事実(dispatch 時の model 上書き制限)` 節の末尾行を置換する。

置換前:
```markdown
これが `with-codex` の役割 Agents 併用ルールで「dispatch 時の `model` 上書きは使わず、役割定義本文を依頼文に同梱する」方式を採る理由である。
```

置換後:
```markdown
これが `with-codex` の §委譲先の実行モデルの確定 で「実行帯が GPT の場合は dispatch 時の `model` 上書きを使わず、役割定義本文を依頼文に同梱する」方式を採る理由である。
```

- [ ] **Step 4: 置換を検証する**

```bash
grep -c "役割 Agents を持つワークフロープラグイン" plugins/agent-policy/README.md
grep -c "役割 Agents 併用ルール" plugins/agent-policy/README.md
grep -c "委譲先の実行モデルの確定" plugins/agent-policy/README.md
```

Expected: 順に `0`、`0`、`2`。

- [ ] **Step 5: 前後の項目が無傷であることを検証する**

```bash
sed -n '42,47p' plugins/agent-policy/README.md
```

Expected: 以下 3 項目がこの順に存在すること。

1. `- 本プラグイン(\`agent-policy\`)=「誰に任せるか」〜`(変更なし)
2. `- \`revelation\`=「どう進めるか」〜`(変更なし)
3. `- 他プラグイン・自作 Agents との併用: 〜`(置換後)

- [ ] **Step 6: 要点の充足を検証する**

置換後の項目に以下 3 点が含まれることを目視で確認する。

1. 対象が「`model` 未指定 / `inherit` の Agents 定義全般」であること
2. pin 済み Agents が対象外であること
3. ビルトイン Agents も対象であること

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/README.md
git commit -m "docs(agent-policy): README の併用記述を新しい対象範囲へ更新

対象が Agents 定義全般(ビルトイン含む)へ広がったこと、pin 済みが
対象外であることを明記。節名変更に伴う参照も更新。"
```

---

### Task 4: バージョンを上げ、全体を検証する

**Files:**
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: Task 1〜3 の全変更
- Produces: リリース可能な状態

- [ ] **Step 1: 現在のバージョンを確認する**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
cat plugins/agent-policy/.claude-plugin/plugin.json
```

Expected: `"version": "0.4.6-dev"`

- [ ] **Step 2: バージョンを上げる**

`version` の値を `0.4.6-dev` から `0.5.0-dev` へ変更する。`name` / `description` は変更しない。

変更後の全文:

```json
{
  "name": "agent-policy",
  "description": "あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map)を、Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群",
  "version": "0.5.0-dev"
}
```

- [ ] **Step 3: JSON の妥当性を検証する**

```bash
node -e "const p=require('./plugins/agent-policy/.claude-plugin/plugin.json'); console.log(p.name, p.version)"
```

Expected: `agent-policy 0.5.0-dev`

- [ ] **Step 4: 設計書 §6 の検証を全項目実施する**

```bash
echo "=== 1. 節構成(両スキル) ==="
grep -n "^#\{2,3\} " plugins/agent-policy/skills/with-codex/SKILL.md
echo "---"
grep -n "^#\{2,3\} " plugins/agent-policy/skills/claude-only/SKILL.md

echo "=== 2. 旧節名が plugins/ に残っていないこと ==="
grep -rn "役割 Agents を持つプラグイン" plugins/ || echo "OK: 0 件"

echo "=== 3. 新節名の出現箇所 ==="
grep -rn "委譲先の実行モデルの確定" plugins/

echo "=== 4. バージョン ==="
grep version plugins/agent-policy/.claude-plugin/plugin.json
```

Expected:
- 1: 両スキルで `委譲先の実行モデルの確定` が `モデル別役割` の直後、`コードベース探索` の前にある
- 2: `OK: 0 件`
- 3: 4 件(with-codex 本文 / claude-only 本文 / README 2 箇所)
- 4: `"version": "0.5.0-dev"`

**注意:** grep の対象を `plugins/` に限定すること。`docs/design/` や `docs/plans/` の過去文書に旧節名が残っているのは当時の記録として正しく、書き換えてはならない。

- [ ] **Step 5: 差分全体をレビューする**

```bash
git diff HEAD~3 --stat
git diff HEAD~3
```

確認事項:
- 変更が 4 ファイルのみ(2 SKILL.md / README.md / plugin.json)
- `skills/setup/` 配下が変更されていないこと(GPT テンプレートは pin 済みで対象外)
- `references/` / `assets/` / `docs/` 配下が変更されていないこと
- 担当表(モデル別役割の表)が変更されていないこと

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/.claude-plugin/plugin.json
git commit -m "chore(agent-policy): 0.5.0-dev へバージョンアップ

委譲先の実行モデル確定規律の適用範囲拡張に伴うマイナーアップ。"
```

---

## Self-Review

**1. Spec coverage:**

| 設計書の節 | 対応タスク |
| --- | --- |
| §4-1 構成変更(節タイトル・位置) | Task 1 Step 2/4/5、Task 2 Step 2/4/5 |
| §4-2 記述方針(除外内容) | Task 1 Step 6(3・4 の確認項目) |
| §4-3 with-codex 新節本文 | Task 1 Step 4 |
| §4-4 claude-only 新節本文 | Task 2 Step 4 |
| §4-5 README 改訂 | Task 3 Step 2/3 |
| §4-6 バージョン | Task 4 Step 2 |
| §5-2 変更しないもの | Task 4 Step 5 |
| §6 検証 1〜5 | Task 4 Step 4 |

ギャップなし。

**2. Placeholder scan:** 「TBD」「後で」「適宜」「Task N と同様」の類は無い。Task 1 と Task 2 は構造が似ているが、本文を各タスクに全文再掲しており、タスクを単独で読んでも実行できる。

**3. Type consistency:** 節名は全タスクで「委譲先の実行モデルの確定」に統一。サブ節名は with-codex のみ「実行帯が Claude モデルの場合」「実行帯が GPT モデルの場合」で、Task 1 Step 4 の本文と Step 5 の Expected が一致している。README で参照する節名(Task 3 Step 2/3)も同一。
