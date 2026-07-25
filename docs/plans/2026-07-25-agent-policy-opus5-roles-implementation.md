# agent-policy Opus 5 世代の役割取り込み 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent-policy の 2 方針スキルの担当表を Opus 5 世代前提に引き直し、探索統括を GPT Sol から Opus へ移し、その波及を references・テンプレート・README・plugin.json に反映する。

**Architecture:** コード変更はゼロで、Markdown の文言改訂のみ。変更は 3 系統に分かれる — ①担当表と規律文(2 SKILL)②探索統括の移動に伴う波及(references・assets・GPT テンプレート 3 体)③記述スタイルの遡及適用(既存の根拠句削除)。検証はテストではなく grep と読み合わせで行う。

**Tech Stack:** Markdown のみ。`agent-policy` は `src/` を持たないため `pnpm build` は不要。

**設計書:** `docs/design/2026-07-25-agent-policy-opus5-roles-design.md`(根拠・トレードオフ・採用しなかった案はこちら)

## Global Constraints

- **スキル本文には規律だけを書く。** 根拠・背景・実測値・トレードオフをスキル本文へ持ち込まない。見本は `agents-with-codex.md` / `agents-claude-only.md`(リポジトリルート)。判断基準は「読んだ後にエージェントの振る舞いが変わる文は残す、納得を与えるだけの文は削る」(設計書 §3-7)
- **担当表の見出しは `Opus` のまま。** `Opus 5` と書かない(dispatch の model enum にバージョン粒度がないため。設計書 §2-1)
- **`context-map-guide.md` の規範文は役割名で書く。** モデル名を混入させない(`## 作成者` の記入例は規範文ではないので例外)
- Anthropic API クライアントや `ANTHROPIC_API_KEY` 前提の実装を提案・採用しない
- コマンドはすべてリポジトリルート(`/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`)で実行する
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- 本計画に記載のない文言変更を行わない(特に「削らないもの」と明記された箇所)
- **タスクは Task 1 → 5 の順に実行する。** Task 2 Step 4 は Task 1 の完成版を前提に両スキルの文言一致を検証する
- **「部分置換」と書かれたステップの置換前ブロックは、行全体ではなく行の一部(部分文字列)である。** ブロックに含まれない残りの部分はそのまま保持すること。「全面置換」「行ごと置換」「行ごと削除」と書かれたステップのみ行単位で扱う

---

### Task 1: `with-codex` の担当表・探索章・計画確定を改訂する

**Files:**
- Modify: `plugins/agent-policy/skills/with-codex/SKILL.md:12-20`(担当表)
- Modify: `plugins/agent-policy/skills/with-codex/SKILL.md:29`(計画確定)
- Modify: `plugins/agent-policy/skills/with-codex/SKILL.md:33`(探索章)

**Interfaces:**
- Consumes: なし(先行タスクなし)
- Produces: 「探索統括は Opus」「計画確定は Fable の承認」という担当の宣言。Task 4 のテンプレート改訂と Task 5 の横断検証がこの宣言と一致することを前提にする。

- [ ] **Step 1: 担当表(L12-20)を全面置換する**

L12-20 の 9 行を、以下の 9 行で置き換える。L10 の見出し `## モデル別役割` と L11 の空行はそのまま残す。

```markdown
- **Fable**: 不可逆な決定の承認ゲート(計画確定 Approve)とアドバイザー相談のみ。実務・レビューを行わない。
- **Opus**: 戦術オーケストレーション・要件確定・重い最終レビュー・重要な設計判断・詳細設計レビュー・コードベース探索の統括・並列サブエージェント結果の統合・Haiku フィードバック後の補足修正。
- **GPT Sol**: 詳細設計・実装計画(WBS)・複雑な実装(アーキテクチャ判断や設計トレードオフを伴うもの)。
- **GPT Terra**: 通常の実装・ドキュメント作成・設定編集・ビルド/テスト実行と結果整理・定型メンテナンス・探索実働。
- **GPT Luna**: 一括適用・一括チェック・反復変換・軽微なコーディング・探索実働。
- **Sonnet**: 通常のコードレビュー。
- **Haiku**: 設計書・計画書のレビュー(理解したこと+暗黙知抽出)。必須手順。Opus・GPT に置き換えない。
- Opus は、複数の context-map・設計書・実装差分・並列サブエージェントの全レポートを分割せず一度に読んで突き合わせる。要約の要約で判断しない。
- 独立したタスクが複数ある場合は可能な限り並列でサブエージェントを起動する。
```

置換で消える内容の確認(意図的な削除):
- 旧 L14 の GPT Sol から「コードベース探索の統括」が外れる
- 旧 L19「重い最終レビュー・重要な設計判断は **Opus**(または Fable が直接)が担う。」が行ごと消える(Opus 行へ吸収)

- [ ] **Step 2: 計画確定(L29)を書き換える**

置換前:

```markdown
- **計画確定** — 実装への移行は、最上位オーケストレーターの承認(Approve: 計画が全体要件を満たすことの確認)を経る。
```

置換後:

```markdown
- **計画確定** — 実装への移行は、**Fable** の承認(Approve: 計画が全体要件を満たすことの確認)を経る。
```

- [ ] **Step 3: 探索章(L33)を書き換える**

置換前:

```markdown
- ファイル探索・コードベース理解は **GPT Sol** にオーケストレーションを任せる。GPT Sol が GPT Luna / GPT Terra の探索専用サブエージェントを使って context-map を作成する。
```

置換後:

```markdown
- コードベース探索は **Opus** が統括する。grep/read の反復など短命な探索実働は GPT Luna / GPT Terra にバッチ委譲し、context-map の執筆・§未解決事項の判断・要件確定への接続は Opus が行う。
```

次行(旧 L34)の「作成した context-map の所在(パス)の通知は必須。次の dispatch または上流報告で通知する。」は変更しない。

- [ ] **Step 4: 意図した変更だけが入ったことを確認する**

Run:

```bash
git -C /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins diff --stat plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected: `1 file changed, 9 insertions(+), 9 deletions(-)`。他ファイルが出ないこと。

(置換するのは担当表 9 行 + 計画確定 1 行 + 探索 1 行 = 11 行だが、担当表のうち `- **Sonnet**: 通常のコードレビュー。` と `- 独立したタスクが複数ある場合は…` の 2 行は文言が変わらないため差分に現れない。9 = 11 - 2。)

- [ ] **Step 5: 「GPT Sol が探索を統括する」記述が消えたことを確認する**

Run:

```bash
grep -n "GPT Sol" plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected: **ヒットは 1 行のみ** — 担当表の `- **GPT Sol**: 詳細設計・実装計画(WBS)・複雑な実装(アーキテクチャ判断や設計トレードオフを伴うもの)。`

(改訂前は L14 と L33 の 2 行がヒットする。L33 が Step 3 で書き換わり、L14 から「コードベース探索の統括」が外れるため 1 行になる。フォールバック章の `gpt-sol.md` は小文字なのでこの grep にはヒットしない。)

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/skills/with-codex/SKILL.md
git commit -m "$(cat <<'EOF'
feat(agent-policy): with-codex の担当表を Opus 5 世代前提に引き直す

- Fable を承認ゲートとアドバイザー相談のみに絞る
- Opus に要件確定・重い最終レビュー・探索統括・並列結果の統合を集約
- コードベース探索を「統括=Opus / 実働=GPT」のハイブリッドに変更
- 計画確定の承認者を Fable と明示

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `claude-only` の担当表・計画確定を改訂する

**Files:**
- Modify: `plugins/agent-policy/skills/claude-only/SKILL.md:12-17`(担当表)
- Modify: `plugins/agent-policy/skills/claude-only/SKILL.md:26`(計画確定)

**Interfaces:**
- Consumes: Task 1 が確立した Fable / Opus の担当境界。両スキルで同一の文言(Fable 行・1M 前提の行・計画確定)を用いる。
- Produces: なし(このタスクで完結)

- [ ] **Step 1: 担当表(L12-17)を全面置換する**

L12-17 の 6 行を、以下の 6 行で置き換える。

```markdown
- **Fable**: 不可逆な決定の承認ゲート(計画確定 Approve)とアドバイザー相談のみ。実務・レビューを行わない。
- **Opus**: 戦術オーケストレーション・要件確定・詳細設計・実装計画・重い最終レビュー・重要な設計判断・コードベース探索の統括・並列サブエージェント結果の統合・複雑/重要な実装・Haiku レビュー後の補足修正の主力。
- **Sonnet**: 実装(通常〜やや複雑)・通常のコードレビュー・並列タスク実行・軽〜中程度の探索の中心。
- **Haiku**: 設計書・計画書のレビュー(理解したこと+暗黙知抽出)。必須手順。Opus に置き換えない。軽量タスク・軽量探索・補助。
- Opus は、複数の context-map・設計書・実装差分・並列サブエージェントの全レポートを分割せず一度に読んで突き合わせる。要約の要約で判断しない。
- 独立したタスクが複数ある場合は可能な限り並列でサブエージェント(主に Sonnet)を起動する。
```

置換で消える内容の確認(意図的な削除): 旧 L16「重い最終レビュー・重要な設計判断は **Opus**(または Fable が直接)が担う。」が行ごと消える。

`claude-only` の Opus は「複雑/重要な実装」を持ち続ける(設計書 §3-5)。この語を落とさないこと。

- [ ] **Step 2: 計画確定(L26)を書き換える**

置換前:

```markdown
- **計画確定** — 実装への移行は、最上位オーケストレーターの承認(Approve: 計画が全体要件を満たすことの確認)を経る。
```

置換後:

```markdown
- **計画確定** — 実装への移行は、**Fable** の承認(Approve: 計画が全体要件を満たすことの確認)を経る。
```

- [ ] **Step 3: `## コードベース探索` を変更していないことを確認する**

`claude-only` の探索章(L28-31)は現行のままで正しい(設計書 §3-2)。

Run:

```bash
git -C /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins diff plugins/agent-policy/skills/claude-only/SKILL.md | grep -c "^[+-].*コードベース理解"
```

Expected: `0`

- [ ] **Step 4: 両スキルで共通文言が一致することを確認する**

Run:

```bash
grep -h "^- \*\*Fable\*\*:\|^- Opus は、複数の context-map\|^- \*\*計画確定\*\*" plugins/agent-policy/skills/with-codex/SKILL.md plugins/agent-policy/skills/claude-only/SKILL.md | sort | uniq -c
```

Expected: 3 行が出力され、**すべて先頭のカウントが `2`** であること(= 両ファイルで文言が完全一致)。カウント `1` の行があれば文言がずれている。

- [ ] **Step 5: コミット**

```bash
git add plugins/agent-policy/skills/claude-only/SKILL.md
git commit -m "$(cat <<'EOF'
feat(agent-policy): claude-only の担当表を Opus 5 世代前提に引き直す

- Fable を承認ゲートとアドバイザー相談のみに絞る
- Opus に要件確定・重い最終レビュー・並列結果の統合を追加(複雑/重要な実装は現行維持)
- 計画確定の承認者を Fable と明示

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 既存の根拠句を削除する(記述スタイルの遡及適用)

設計書 §4-5。担当表の改訂とは独立した変更なので、コミットを分ける。

**Files:**
- Modify: `plugins/agent-policy/skills/with-codex/SKILL.md:28, 61, 64`
- Modify: `plugins/agent-policy/skills/claude-only/SKILL.md:40`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: `with-codex:28` の Haiku レビュー行から理由句を削る**

置換前:

```markdown
- **ユーザーレビュー** — 設計書・実装計画書は、ユーザーレビューの前に Haiku レビュー(理解+暗黙知・矛盾抽出)→ 補足修正(戦術オーケストレーター)を通す。Haiku レビューはレビュー手法の固有名であり、GPT Luna に置き換えない。
```

置換後:

```markdown
- **ユーザーレビュー** — 設計書・実装計画書は、ユーザーレビューの前に Haiku レビュー(理解+暗黙知・矛盾抽出)→ 補足修正(戦術オーケストレーター)を通す。GPT Luna に置き換えない。
```

- [ ] **Step 2: `with-codex:61` の tools 制限行から理由句を削る**

置換前(行末のみ変更。行頭の `2. 担当が GPT 帯で…` から始まる長い 1 行の末尾):

```markdown
役割 Agent の tools 制限は構造的に引き継がれないため、依頼文に「この tools のみ使用」と明記する。
```

置換後:

```markdown
依頼文に「この tools のみ使用」と明記する。
```

- [ ] **Step 3: `with-codex:64` から drift 防止の注記を削る**

置換前:

```markdown
役割定義ファイルは常にインストール済みプラグインの生ファイルから読む(複製・改変版を作らない = drift 防止)。
```

置換後:

```markdown
役割定義ファイルは常にインストール済みプラグインの生ファイルから読む(複製・改変版を作らない)。
```

- [ ] **Step 4: `claude-only:40` からキャッシュの理由句を削る**

置換前:

```markdown
- Claude 系経路はプロンプトキャッシュが効くため損益分岐は with-codex より緩い。ただし直接 Write・バッチ委譲・スキルロード規律は同様に適用する。
```

置換後:

```markdown
- Claude 系経路の損益分岐は with-codex より緩い。ただし直接 Write・バッチ委譲・スキルロード規律は同様に適用する。
```

- [ ] **Step 5: 「削らないもの」を削っていないことを確認する**

`with-codex:24` / `claude-only:21` の「以下は成果物ごとの独立した事前条件であり、列挙順に実行順の意味はない。」は**残す**(設計書 §4-5)。

Run:

```bash
grep -c "列挙順に実行順の意味はない" plugins/agent-policy/skills/with-codex/SKILL.md plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected: 両ファイルとも `1`

- [ ] **Step 6: 削除対象の語が消えたことを確認する**

Run:

```bash
grep -n "レビュー手法の固有名\|構造的に引き継がれないため\|drift 防止\|プロンプトキャッシュが効くため" plugins/agent-policy/skills/with-codex/SKILL.md plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected: ヒット 0 件(終了コード 1)

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/skills/with-codex/SKILL.md plugins/agent-policy/skills/claude-only/SKILL.md
git commit -m "$(cat <<'EOF'
refactor(agent-policy): スキル本文から根拠句を削除しコンテキスト消費を削減

毎セッション読まれる本文は規律のみとし、理由の説明は設計書へ寄せる

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 探索統括の移動を references・assets・GPT テンプレートへ波及させる

**Files:**
- Modify: `plugins/agent-policy/references/context-map-guide.md:17`(2層定義)
- Modify: `plugins/agent-policy/references/context-map-guide.md:105-114`(`## 作成者`)
- Modify: `plugins/agent-policy/assets/context-map-template.md:4`
- Modify: `plugins/agent-policy/skills/setup/assets/gpt-sol.template.md:3, 9, 13, 21, 28`
- Modify: `plugins/agent-policy/skills/setup/assets/gpt-terra.template.md:17`
- Modify: `plugins/agent-policy/skills/setup/assets/gpt-luna.template.md:17`

**Interfaces:**
- Consumes: Task 1 が確立した「探索統括は Opus / 実働は GPT」の担当。
- Produces: `setup` が生成する GPT Agent 定義の職掌。Task 5 の README 再実行案内がこの改訂を前提にする。

- [ ] **Step 1: `context-map-guide.md:17` の 2 層定義を書き換える**

L17 の中の以下の部分文字列のみを置換する(行全体を書き換えない)。

置換前:

```markdown
**最上位オーケストレーター**(要件確定・承認ゲート担当)と**戦術オーケストレーター**(中間統括・重い最終レビュー担当)
```

置換後:

```markdown
**最上位オーケストレーター**(承認ゲート担当)と**戦術オーケストレーター**(要件確定・中間統括・重い最終レビュー担当)
```

同じ行の「典型は 最上位=Fable、戦術=Opus」は**変更しない**(設計書 §3-6)。

続けて、同ファイル内で要件確定を最上位の担当として書いている 2 箇所も戦術へ移す(設計書 §5-1)。

L11 — 置換前:

```markdown
最上位オーケストレーターが要件を確定する前には、
```

置換後:

```markdown
戦術オーケストレーターが要件を確定する前には、
```

L67(チェックポイント①)— 置換前:

```markdown
| **① 要件精緻化**(map 作成直後) | 要件定義 | **最上位オーケストレーター** | 探索 → 要件確定の入力(要件確定規則) | **§未解決事項(最重要)**・§既存契約・§影響範囲 | 作成者が §未解決事項を**要約で必ず上げる**。最上位オーケストレーターは要約で受け、判断に必要なときだけ該当セクションを参照 |
```

置換後:

```markdown
| **① 要件精緻化**(map 作成直後) | 要件定義 | **戦術オーケストレーター** | 探索 → 要件確定の入力(要件確定規則) | **§未解決事項(最重要)**・§既存契約・§影響範囲 | 探索実働が §未解決事項を**要約で必ず上げ**、作成者が map に統合する。戦術オーケストレーターは要約で判断し、必要なときだけ該当セクションを参照 |
```

L42 / L68 / L69(計画確定・計画承認・最終レビュー)は**変更しない**。承認ゲートは最上位に残るため現行のまま正しい。

- [ ] **Step 2: `context-map-guide.md` の `## 作成者` 節(L107-114)を書き換える**

置換前:

```markdown
テンプレートの「作成者」欄は、profile に依存しない併記形式を用いる:

- `**作成者**: GPT Sol(with-codex 方針・探索担当) / Opus(claude-only 方針・探索担当)`

実際に作成したエージェント / profile に印を付けて用いる。

- with-codex 方針 → **GPT Sol**(探索統括。GPT Luna / Terra の探索サブエージェントを活用)。
- claude-only 方針 → **Opus**(Sonnet / Haiku の探索サブエージェントを活用)。
```

置換後:

```markdown
テンプレートの「作成者」欄は、両 profile 共通で探索統括を担う Opus を記す:

- `**作成者**: Opus(探索統括)`

探索実働に用いるサブエージェントのみ profile によって異なる。

- with-codex 方針 → GPT Luna / GPT Terra の探索サブエージェントを活用。
- claude-only 方針 → Sonnet / Haiku の探索サブエージェントを活用。
```

- [ ] **Step 3: `assets/context-map-template.md:4` を書き換える**

置換前:

```markdown
**作成者**: GPT Sol(with-codex 方針・探索担当) / Opus(claude-only 方針・探索担当)
```

置換後:

```markdown
**作成者**: Opus(探索統括)
```

- [ ] **Step 4: `gpt-sol.template.md` の 5 箇所を書き換える**

L3 `description`(**部分置換**)。以下は L3 の**行頭からの部分文字列**であり、行はこの先も続く(`(アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う実装)を委譲するとき。…` 以降)。**続きは一切変更せずそのまま残すこと。**

置換前(この部分文字列だけを対象にする):

```markdown
Use this agent when 詳細設計・実装計画(WBS)の作成、コードベース探索(context-map の作成)、または複雑なコーディング
```

置換後:

```markdown
Use this agent when 詳細設計・実装計画(WBS)の作成、または複雑なコーディング
```

結果として L3 は `Use this agent when 詳細設計・実装計画(WBS)の作成、または複雑なコーディング(アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う実装)を委譲するとき。…` となる。

L9(部分置換):

置換前:

```markdown
詳細設計・実装計画・コードベース探索・複雑な実装の中心を担う。
```

置換後:

```markdown
詳細設計・実装計画・複雑な実装の中心を担う。
```

L13(行ごと削除):

```markdown
- **コードベース探索と context-map 作成。** ファイル探索・コードベース理解が必要なとき。GPT Luna / GPT Terra の探索専用サブエージェントを活用してよい。
```

`## When to invoke` 箇条書きの末尾(現 L15「複雑な実装。」の直後)に以下を追加:

```markdown
- **探索実働への協力。** Opus が統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。
```

L21(部分置換):

置換前:

```markdown
1. コードベース探索 → context-map → 詳細設計 → WBS → 複雑な実装を、根拠(ファイルパス・行番号)付きで自ら遂行する。
```

置換後:

```markdown
1. 詳細設計 → WBS → 複雑な実装を、根拠(ファイルパス・行番号)付きで自ら遂行する。
```

L28(行ごと置換):

置換前:

```markdown
- context-map を作成する場合は、現在の構造・関連モジュール・既存パターン・影響範囲・既存契約・未解決事項・テスト方法を整理し、オーケストレーターへ共有する。
```

置換後:

```markdown
- オーケストレーターから共有された context-map を出発点として用い、記載と実際のコードに食い違いがあれば報告する。
```

L17「最上位の戦略判断・最終承認ゲートはオーケストレーター(Fable/Opus)が担うため、あなたは求めない。」は**変更しない**(設計書 §5-4)。

- [ ] **Step 5: `gpt-terra.template.md:17` と `gpt-luna.template.md:17` を書き換える**

terra L17 — 置換前:

```markdown
- **探索補助。** GPT Sol が統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。
```

luna L17 — 置換前:

```markdown
- **探索補助。** GPT Sol / Opus が統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。
```

両ファイルとも置換後は同一:

```markdown
- **探索補助。** Opus が統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。
```

- [ ] **Step 6: guide の規範文にモデル名が混入していないことを確認する**

Run:

```bash
grep -n "Fable\|Opus\|GPT " plugins/agent-policy/references/context-map-guide.md
```

Expected: ヒットは次の 3 種のみ。

1. L17 — 役割→モデル割り当ての典型例(ここはモデル名が出てよい)
2. L41 — Haiku レビューの必須手順とその理由(**既存行。変更しない**)。references は根拠の置き場なので、スキル本文から削った理由句がここに残るのは設計どおり(設計書 §3-7)
3. `## 作成者` 節(L107 / L109 / L113)

上記以外の節にモデル名が現れないこと。特に**探索の統括者として `GPT Sol` が出ないこと**。

- [ ] **Step 7: テンプレート群から旧職掌が消えたことを確認する**

Run:

```bash
grep -rn "GPT Sol が統括\|GPT Sol / Opus が統括\|コードベース探索と context-map 作成" plugins/agent-policy/
```

Expected: ヒット 0 件(終了コード 1)

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/references/context-map-guide.md plugins/agent-policy/assets/context-map-template.md plugins/agent-policy/skills/setup/assets/
git commit -m "$(cat <<'EOF'
feat(agent-policy): 探索統括の Opus 移管を references とテンプレートへ反映

- context-map の作成者を両 profile 共通で Opus に統一(profile 分岐を廃止)
- 2層定義の「要件確定」を最上位から戦術へ移動
- GPT Sol の職掌から探索統括を削除し、三体とも探索実働の担当に

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: README・plugin.json を更新し、横断検証を行う

**Files:**
- Modify: `plugins/agent-policy/README.md:54-56`(アップデート時の注意)
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json`(version)

**Interfaces:**
- Consumes: Task 4 のテンプレート改訂(再実行案内の対象)
- Produces: なし(最終タスク)

- [ ] **Step 1: README の `## アップデート時の注意` に 0.4.0 の記述を追加する**

既存の 0.3.0 の段落は履歴として残し、その**前**に以下を挿入する。

```markdown
0.4.0 でエージェントテンプレートを改訂しました(コードベース探索の統括が GPT Sol から Opus に移り、GPT 三体は探索実働の担当になりました)。既存プロジェクトの `.claude/agents/gpt-*.md` は `agent-policy:setup` の再実行で更新してください。
```

- [ ] **Step 2: `plugin.json` の version を上げる**

置換前:

```json
  "version": "0.3.5-dev"
```

置換後:

```json
  "version": "0.4.0-dev"
```

- [ ] **Step 3: plugin.json が壊れていないことを確認する**

Run:

```bash
node -e "console.log(require('./plugins/agent-policy/.claude-plugin/plugin.json').version)"
```

Expected: `0.4.0-dev`

- [ ] **Step 4: 横断 grep で取りこぼしを検出する(設計書 §7-3)**

Run:

```bash
grep -rn "最上位オーケストレーター\|要件確定\|探索統括\|探索を統括" plugins/agent-policy/
```

Expected: 出力の各行が次の 3 条件をすべて満たすこと。1 つでも破れていれば取りこぼしがある。

1. `最上位オーケストレーター` と `要件確定` が**同じ行に併記されていない**(併記は改訂前の定義。`context-map-guide.md:17` が該当していないか特に確認)
2. `要件確定` は Opus または戦術オーケストレーターの担当として現れる(Fable の担当として現れる行がない)
3. 探索の統括者が `GPT Sol` である行が 1 件もない(`探索統括` / `探索を統括` と `GPT Sol` が同じ行に共存しない)

- [ ] **Step 5: 設計書 §5 の 7 項目がすべて反映されたことを確認する(設計書 §7-2)**

Run:

```bash
grep -n "承認ゲート担当" plugins/agent-policy/references/context-map-guide.md
grep -n "Opus(探索統括)" plugins/agent-policy/references/context-map-guide.md plugins/agent-policy/assets/context-map-template.md
grep -c "Opus が統括するコードベース探索" plugins/agent-policy/skills/setup/assets/gpt-sol.template.md plugins/agent-policy/skills/setup/assets/gpt-terra.template.md plugins/agent-policy/skills/setup/assets/gpt-luna.template.md
grep -n "0.4.0 でエージェントテンプレートを改訂" plugins/agent-policy/README.md
```

Expected: 順に —
1. `context-map-guide.md` に `承認ゲート担当` が 1 件
2. `Opus(探索統括)` が guide と template に各 1 件
3. 3 テンプレートすべて `1`
4. README に 1 件

- [ ] **Step 6: `setup` の生成経路にテンプレート改訂が乗ることを確認する(設計書 §7-5)**

`setup/SKILL.md:39` が `assets/gpt-*.template.md` を読み込み `{{MODEL_ALIAS}}` のみ置換する実装であることは確認済み(テンプレート本文を SKILL 側で再掲していない)。改訂が生成物へ自動的に伝播するため、`setup/SKILL.md` 自体の変更は不要。

Run:

```bash
grep -n "MODEL_ALIAS" plugins/agent-policy/skills/setup/SKILL.md
```

Expected: L39 の 1 行がヒットし、`assets/gpt-sol.template.md` / `gpt-terra.template.md` / `gpt-luna.template.md` を読む記述であること。これ以外にテンプレート本文の再掲がないこと。

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/README.md plugins/agent-policy/.claude-plugin/plugin.json
git commit -m "$(cat <<'EOF'
chore(agent-policy): 0.4.0-dev へバージョンを上げ setup 再実行を案内

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- 設計書 §4(2 SKILL の改訂)と §5(7 項目の追随)がすべて反映されている
- Task 5 Step 4 の横断 grep で、改訂後の担当と矛盾する行が 1 件もない
- コミットが 5 本に分かれている(feat×2 / refactor×1 / feat×1 / chore×1)
