# 詳細設計書: `agent-policy` プラグイン

- 作成日: 2026-07-19
- 作成者: Opus(戦術設計担当・サブエージェント)
- 委譲元: Fable(メインオーケストレーター)
- 入力資料:
  - `private/context-map/2026-07-19-agent-policy-inputs.md`(ユーザー承認済み決定事項・運用方針原文・テンプレート原文)
  - `private/context-map/2026-07-19-agent-policy-plugin.md`(事前探索の context-map)
- 位置づけ: 実装者(GPT Terra / GPT Sol 等)がそのまま着手できる粒度の実装指示書

---

## 1. 背景・目的

このリポジトリには現在、エージェント運用方針が 2 つの断片ファイル(`agents-with-codex.md` / `agents-claude-only.md`)としてリポジトリ直下に散在している。これらは「誰に何を任せるか(モデル別役割分担)」を規定するが、プラグインとして配布されておらず、他プロジェクトから再利用できない。

本プラグイン `agent-policy` は、この運用方針を **汎用配布可能な Skill 群**として切り出す。利用者は自分の CLAUDE.md に「エージェント運用は `agent-policy:with-codex`(または `claude-only`)に従う」と書くだけで、あまつか工房のエージェント運用規律(モデル別役割・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成)を任意のプロジェクトに持ち込める。

### 提供する 2 プロファイル

- **with-codex**: Claude(Fable/Opus/Sonnet/Haiku)+ GPT モデル群(Sol/Terra/Luna、ローカルプロキシ経由)を併用する構成。GPT が詳細設計・実装の主力を担う。
- **claude-only**: Claude モデルのみで完結する構成。プロキシ不要。Opus が主力、Sonnet が実行の中心。

加えて、with-codex で必要になる GPT Agent 定義(`.claude/agents/gpt-*.md`)をプロジェクトに生成する **setup Skill(ウィザード)** を同梱する。

### 設計の中心的制約(このセッションで判明した実例)

**旧エージェント定義と新運用方針の非互換問題。** 既存の `codex/gpt-sol.md` は本文で「オーケストレーション・レビュー・調査・分析・設計は GPT Sol の役割ではない」と定義している(旧方針)。ところがユーザー承認済みの新運用方針(原文1)では **GPT Sol =「詳細設計・実装計画(WBS)・コードベース探索(context-map 作成)・複雑な実装」の中心**である。両者は真っ向から矛盾する。

実際に本セッションでは、この設計書の作成を旧定義ベースの `gpt-sol` エージェントへ委譲したところ、GPT Sol が「設計は役割外」として **2 度差し戻した**。この事故を再発させないため、本プラグインの setup Skill が生成する `gpt-sol` テンプレートは、新方針の役割(詳細設計・実装計画・コードベース探索統括・複雑な実装)を **明示的にスコープ内**として本文に書き直す。`gpt-terra` / `gpt-luna` も同様に新方針の役割定義へ整合させ、旧定義の丸写しにしない(§4.5 参照)。

---

## 2. 決定事項サマリ

入力資料 `2026-07-19-agent-policy-inputs.md` のユーザー承認済み決定事項を、本設計の前提として再掲する。**以下から逸脱してはならない。**

| 論点 | 決定 |
|---|---|
| プラグイン名 | `agent-policy` |
| 構成案 | 案A: 完全静的(hooks なし・ビルドなし・package.json なし) |
| Skill 構成 | 2 方針 Skill(with-codex / claude-only)+ setup Skill。共通部はプラグインルート直下 `references/` ・ `assets/` に配置。`skills/` 直下には Skill フォルダ以外を置かない |
| GPT Agents | プラグインに同梱しない。setup Skill がヒアリングのうえ、プロジェクトの `.claude/agents/` に生成 |
| モデルエイリアス | setup 時にヒアリング。デフォルト値 `claude-gpt-5-6-sol` / `-terra` / `-luna` を提示して確認 |
| プロキシ要件案内 | README に要件のみ記載(構築手順は複製しない)。エイリアスは「任意の ProxyAPI サーバーが配信するクライアント側別名」と明記 |
| context-map 置き場所 | `.claude/context-maps/YYYY-MM-DD-<タスク名スラッグ>.md` |
| context-map 作成契機 | コードベース探索を伴う設計・実装タスク着手時のみ。雑談・単発質問・軽微修正では作らない。同一セッション内の追加タスクは同じファイルを更新 |
| 強制力 | 段階導入 — 初版は Skill のみ(CLAUDE.md からの名指し参照を前提)。非発動が問題化したら hook 層を後付け |
| 利用方法 | ユーザーが CLAUDE.md に「エージェント運用は `agent-policy:with-codex`(または `claude-only`)に従う」と記載する運用 |
| 初期バージョン | `0.1.0-dev` |
| リポジトリ側変更 | marketplace.json への entry 追記 + ルート README の配布一覧追記のみ。既存の `agents-*.md` / `codex/` / CLAUDE.md は今回触らない |

### 契約(リポジトリ規約・厳守)

- Anthropic API 前提の実装禁止(API クライアント追加・`ANTHROPIC_API_KEY` 依存・CLI 直接操作要求は不可)。claude-only Skill はプロキシなしで完結すること。
- 完全静的プラグインのため `package.json` / `build.ts` / `pnpm-workspace.yaml` entry / `hooks/` は **作らない**。
- `plugin.json` は `name` / `description` / `version` の 3 項目のみ。
- SKILL.md frontmatter は `name` / `description` の 2 項目のみ。
- **Skill ディレクトリ名 = frontmatter `name`** を一致させる(kebab-case)。例: `skills/with-codex/` の SKILL.md は `name: with-codex`。Agent テンプレートも同様にファイル名(生成後 `gpt-sol.md`)と frontmatter `name: gpt-sol` を一致させる(既存リポジトリ規約)。
- `docs/chat/` 配下は読まない。

### ルート README 変更範囲の確定(不整合解消)

入力資料の決定事項は「配布一覧追記のみ」と表現しているが、既存リポジトリの慣行では全プラグインが「配布一覧の 1 行」+「個別説明節」の両方を持つ。本設計は慣行に合わせ、ルート README 変更を **「配布一覧の 1 行追記」+「個別説明節の追記」の 2 箇所**で確定する(§5.2)。決定事項の文言(配布一覧追記のみ)からの逸脱ではなく、既存慣行に沿った具体化である。

---

## 3. 成果物一覧

### 3.1 新規作成(`plugins/agent-policy/` 配下)

| パス | 種別 | 役割 |
|---|---|---|
| `plugins/agent-policy/.claude-plugin/plugin.json` | JSON | プラグイン manifest(name / description / version) |
| `plugins/agent-policy/README.md` | Markdown | プラグイン説明(6 セクション構成) |
| `plugins/agent-policy/references/advisor-rules.md` | Markdown | アドバイザー運用・孫起動禁止・並列実行原則(両方針共通の参照文書) |
| `plugins/agent-policy/references/context-map-guide.md` | Markdown | context-map の作成契機・出力先・作成者・更新ルール・gitignore 案内・シークレット非記録 |
| `plugins/agent-policy/assets/context-map-template.md` | Markdown | 出力先へコピーする context-map テンプレート本体 |
| `plugins/agent-policy/skills/with-codex/SKILL.md` | Skill | Claude + Codex 運用方針 |
| `plugins/agent-policy/skills/claude-only/SKILL.md` | Skill | Claude オンリー運用方針 |
| `plugins/agent-policy/skills/setup/SKILL.md` | Skill | GPT Agents 生成ウィザード |
| `plugins/agent-policy/skills/setup/assets/gpt-sol.template.md` | テンプレート | GPT Sol Agent 雛形(`{{MODEL_ALIAS}}` プレースホルダ) |
| `plugins/agent-policy/skills/setup/assets/gpt-terra.template.md` | テンプレート | GPT Terra Agent 雛形 |
| `plugins/agent-policy/skills/setup/assets/gpt-luna.template.md` | テンプレート | GPT Luna Agent 雛形 |

### 3.2 リポジトリ側変更(既存ファイルへの追記)

| パス | 変更 |
|---|---|
| `.claude-plugin/marketplace.json` | `plugins` 配列に `agent-policy` entry を 1 件追記(§5.1) |
| `README.md`(ルート) | 配布プラグイン表に 1 行追記 + 個別説明節を追記(§5.2) |

**触らないもの:** `agents-with-codex.md` / `agents-claude-only.md` / `codex/*.md` / `CLAUDE.md` / `CLAUDE.example.md` / `pnpm-workspace.yaml` / `package.json`(移行と強制力 hook は別タスク)。

### 3.3 ディレクトリツリー(完成形)

```text
plugins/agent-policy/
├── .claude-plugin/
│   └── plugin.json
├── README.md
├── references/
│   ├── advisor-rules.md
│   └── context-map-guide.md
├── assets/
│   └── context-map-template.md
└── skills/
    ├── with-codex/
    │   └── SKILL.md
    ├── claude-only/
    │   └── SKILL.md
    └── setup/
        ├── SKILL.md
        └── assets/
            ├── gpt-sol.template.md
            ├── gpt-terra.template.md
            └── gpt-luna.template.md
```

---

## 4. 各ファイルの詳細設計

> **モデル名正規化ルール(全生成物に適用):** 入力資料の原文1/2/3 やテンプレート土台に含まれるバージョン付きモデル名は、生成物では **`Fable5`→`Fable`、`Sonnet5`→`Sonnet`** に正規化して記述する(将来のモデルバージョン更新に表記が耐えられないため)。`Opus` / `Haiku` / `GPT Sol` / `GPT Terra` / `GPT Luna` は現状のまま。**入力資料の原文自体は改変せず**、設計書・SKILL・README・テンプレートなどの生成物における表記のみを規定する。以下で「原文…を移植」「そのまま移植」と指示する箇所はすべて、この正規化を適用したうえで移植すること。

### 4.1 `.claude-plugin/plugin.json`

完全な JSON(このまま書き出す):

```json
{
  "name": "agent-policy",
  "description": "あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map)を、Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群",
  "version": "0.1.0-dev"
}
```

- `name` は marketplace entry・ディレクトリ名と一致(`agent-policy`)。
- `description` は日本語・簡潔。marketplace entry の description と意味を揃える。
- `version` は `0.1.0-dev`(決定事項)。

---

### 4.2 `skills/with-codex/SKILL.md`

#### frontmatter(完全文面)

```yaml
---
name: with-codex
description: Claude(Fable/Opus/Sonnet/Haiku)と Codex 系 GPT モデル(Sol/Terra/Luna、ローカルプロキシ経由)を併用する構成でのエージェント運用方針。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に読む。GPT/Codex プロキシが使えない環境では代わりに agent-policy:claude-only を用いる。雑談・単発質問・軽微な修正だけのときは読まなくてよい。
---
```

#### 本文セクション構成

1. **この方針の適用条件**(冒頭 2-3 行)
   - 「あなたはオーケストレーターまたはそのサブエージェントである。以下はモデル別の役割分担と進め方の規律である」
   - GPT プロキシ前提であること、使えない場合は `agent-policy:claude-only` へ切り替える旨。

2. **基本原則**(原文1「基本原則」を移植)
   - Fable = 最上位の戦略オーケストレーション・クリティカルな設計判断・最終ゲートのみ。
   - Opus = 戦術オーケストレーション・中規模設計・レビュー・補足修正・アドバイス。
   - GPT Sol = 詳細設計・実装計画・コードベース探索の中心。
   - レビューは基本 Sonnet、重い最終レビューはオーケストレーター(Fable/Opus)。
   - 実装は複雑度に応じ GPT Sol(複雑)/ GPT Terra(通常)/ GPT Luna(軽量)。
   - 独立タスクが複数あれば可能な限り並列起動(詳細は references へ委譲)。

3. **モデル別役割**(原文1 の表を移植。移植時にモデル名を正規化する: Fable5→Fable、Sonnet5→Sonnet)
   - Fable / Opus / GPT Sol / GPT Terra / GPT Luna / Sonnet / Haiku の 7 行の表。

4. **GPT Sol/Terra/Luna の担当表**(with-codex 固有)
   - GPT Sol = 詳細設計・実装計画(WBS)・コードベース探索統括・複雑な実装。
   - GPT Terra = 通常の実装・ドキュメント・設定・ビルド/テスト実行・定型メンテ。
   - GPT Luna = 一括適用・一括チェック・反復変換・軽微なコーディング。

5. **設計・実装計画のフロー**(原文1 の 6 ステップを移植)
   - Fable(Blueprint)→ GPT Sol(context-map)→ GPT Sol(詳細設計+WBS)→ Haiku(理解+暗黙知抽出)→ Opus(補足修正)→ Fable(軽く最終確認)。
   - 「Haiku レビューは with-codex でも Claude Haiku が担い、GPT Luna に置き換えない」ことを明記(暗黙知#13)。

6. **コードベース探索**(原文1「コードベース探索」を移植 + guide 参照)
   - ファイル探索は GPT Sol にオーケストレーションを任せ、GPT Luna/Terra の探索サブエージェントを活用して context-map を作成。
   - context-map の作成契機・出力先・記入手順は `references/context-map-guide.md` を読む(委譲)。
   - この方針では context-map の作成者は **GPT Sol**。

7. **レビュー運用**
   - 通常コードレビュー → Sonnet / 設計書・計画書レビュー(暗黙知抽出)→ Haiku / 重い最終レビュー → Opus(または Fable)。

8. **アドバイザー運用・並列実行**
   - 詳細は `references/advisor-rules.md` を読む(委譲、重複排除)。要点(サブエージェントはアドバイザー相談のみ Agent tool 可・孫起動禁止・独立タスクは並列)を 2-3 行で要約し、詳細は references へ。

9. **`.claude/agents/gpt-*.md` 不在時のフォールバック**(with-codex 固有・実装形態を明示)
   - 具体的な手順として本文に次を記述する:
     1. 実務タスク着手前に `.claude/agents/gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` の存在を確認する(Glob / Read で確認)。
     2. いずれかが無い場合は、ユーザーへ `agent-policy:setup` の実行を案内する。
     3. 生成が完了する(またはユーザーが setup をスキップする)までは、**そのセッションは claude-only 方針の担当表(Opus=詳細設計・実装計画/Sonnet=実装/Haiku=軽量)で代行**する。GPT Sol/Terra/Luna へは委譲しない。
   - 「GPT が使えない一時的状態でも実務を止めない」ためのフォールバックであり、恒久的に claude-only へ切り替えるものではない旨を添える。

10. **役割 Agents を持つプラグインとの併用**(with-codex 固有)
    - 背景: Codiel 等のワークフロープラグインは、役割プロンプトを持つ Agents(`model: inherit`、例 `codiel-implementer-*`)で実装フェーズを駆動する。本方針の「実装は GPT へ」というレイヤーと衝突するため、合成ルールを一意に定める。
    - **確定事実(2026-07-20 実測検証済み):** Agent tool の dispatch 時 `model` 上書きパラメータは enum(`sonnet` / `opus` / `haiku` / `fable`)に制限され、カスタムエイリアス(`claude-gpt-5-6-*`)は実行前にバリデーションエラーで拒否される。カスタムエイリアスが有効なのは **Agents 定義 frontmatter の `model` フィールドのみ**(gpt-sol/terra/luna の起動実績で確認)。したがって「役割 Agent を GPT モデルで dispatch 上書き起動する」方式は現状不可。(将来 enum が緩和されたら dispatch 上書き方式を再検討する。)
    - **唯一の判断フロー**(相反する複数ルールを併記しない):
      1. 役割 Agents を持つプラグイン(例: Codiel)が駆動するフェーズでは、その作業種別を本方針の担当表に照らす(実装 → GPT 帯)。
      2. 担当が GPT 帯で `.claude/agents/gpt-*.md` が利用可能なら(**基本動作**): 該当する役割 Agent 定義ファイルの本文を読み取り、担当 GPT エージェントへの依頼文に **役割定義として同梱**して dispatch する。同梱時は **frontmatter を除き役割本文のみ**を渡す。役割 Agent の tools 制限は構造的に引き継がれないため、依頼文に「この tools のみ使用」と明記する。
      3. GPT が利用不可(未生成・プロキシ停止)なら(**フォールバック**): プラグインの役割 Agents をそのまま起動する。
    - 役割定義ファイルは常に **インストール済みプラグインの生ファイル**から読む(複製・改変版を作らない = drift 防止)。

**委譲の設計意図:** アドバイザー運用・並列原則・context-map 手順を SKILL.md 本文に重複記述せず references へ集約することで、両方針 Skill の更新漏れ(drift、リスク#5)を防ぐ。

---

### 4.3 `skills/claude-only/SKILL.md`

#### frontmatter(完全文面)

```yaml
---
name: claude-only
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。ローカルプロキシや GPT/Codex を必要としない。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に読む。GPT/Codex を併用する構成では代わりに agent-policy:with-codex を用いる。雑談・単発質問・軽微な修正だけのときは読まなくてよい。
---
```

#### 本文セクション構成

1. **この方針の適用条件**(冒頭 2-3 行)
   - Claude のみで完結する構成であること。GPT を併用するなら `agent-policy:with-codex` へ切り替える旨。GPT への言及はここ以外では行わない。

2. **基本原則**(原文2「基本原則」を移植)
   - Fable = 最上位の戦略判断・クリティカルな設計決定・最終承認ゲートのみ。
   - Opus = 戦術オーケストレーション・詳細設計・実装計画・レビュー・補足修正の主力。
   - Sonnet = 実装・通常タスク・並列実行の中心。
   - Haiku = 軽量レビュー・探索・補助。
   - 独立タスクは可能な限り並列。

3. **モデル別役割(Claude 限定)**(原文2 の 4 行表を移植。移植時にモデル名を正規化する: Fable5→Fable、Sonnet5→Sonnet)
   - Fable / Opus / Sonnet / Haiku。

4. **設計・実装計画のフロー**(原文2 の 6 ステップ)
   - Fable(Blueprint)→ Opus(context-map)→ Opus(詳細設計+実装計画)→ Haiku(理解+暗黙知抽出)→ Opus(補足修正)→ Fable(軽く最終確認)。

5. **実装フェーズ**(原文2)
   - 複雑・重要 → Opus(必要に応じ Sonnet を並列サブエージェント)/ 通常 → Sonnet / 軽量・単純 → Sonnet または Haiku。

6. **コードベース探索**(原文2 + guide 参照)
   - Opus にオーケストレーションを任せ、Sonnet/Haiku の探索サブエージェントを活用して context-map を作成。
   - 作成契機・出力先・記入手順は `references/context-map-guide.md` へ委譲。
   - この方針では context-map の作成者は **Opus**。

7. **レビュー運用**(原文2)
   - 通常コードレビュー → Sonnet / 設計書・計画書レビュー → Haiku / 重い最終レビュー → Opus(または Fable)。

8. **アドバイザー運用・並列実行**
   - `references/advisor-rules.md` へ委譲。要点のみ 2-3 行(サブエージェントは Fable をアドバイザーとして相談可・孫起動禁止・Sonnet サブエージェントの並列起動)。

9. **役割 Agents を持つプラグインとの併用**(claude-only)
   - 役割 Agents を持つワークフロープラグイン(例: Codiel の `codiel-implementer-*`)は、**そのまま起動**する。
   - `model: inherit` の役割 Agents については、本方針の担当表に合わせて dispatch 時の `model` 上書き(標準値 `sonnet` / `haiku` 等。これは enum で許容される)を併用してよい。
   - claude-only では GPT 帯への注入は行わない(GPT を使わない構成のため)。

---

### 4.4 `skills/setup/SKILL.md`

#### frontmatter(完全文面)

```yaml
---
name: setup
description: with-codex 運用方針で使う GPT エージェント定義(gpt-sol / gpt-terra / gpt-luna)を、対話ヒアリングのうえプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「GPT エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したときに必ず使用する。Codex 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
---
```

#### 本文: ヒアリングフロー 4 ステップ(完全な手順記述)

冒頭:「この Skill は、with-codex 方針で使う 3 つの GPT Agent 定義を生成する。プロキシや秘密値はこの Skill が管理しない。生成するのは Markdown の Agent 定義ファイルのみである。」

**ステップ 1: 前提確認**
- ユーザーに次を確認する(検証コマンドの実行は強制しない。確認方法の提示に留める):
  - Claude Code を Codex 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
  - そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。
- 確認方法の案内例(具体的な文面例。強制せず提示のみ):
  - 「Claude Code の `/model` コマンドでモデル一覧を開き、使用予定のエイリアス(例 `claude-gpt-5-6-sol`)が候補に出るか確認してください。」
  - 「プロキシの `/v1/models` エンドポイントの応答にエイリアスが含まれるか(例 `curl -s http://127.0.0.1:8317/v1/models` の結果に該当 id があるか)を確認してください。ポート・ホストはお使いのプロキシ設定に合わせてください。」
  - 「確認方法が分からなければ README の前提条件と、お使いのプロキシのドキュメントを参照してください。」
- 前提が満たせない場合は「GPT Agent は起動できないため、`agent-policy:claude-only` 方針の利用を検討してください」と案内して終了できる。

**ステップ 2: エイリアス確認**
- 3 モデルのクライアント側エイリアスをヒアリングする。デフォルト値を提示して確認する:
  - gpt-sol → `claude-gpt-5-6-sol`
  - gpt-terra → `claude-gpt-5-6-terra`
  - gpt-luna → `claude-gpt-5-6-luna`
- 「これらはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。
- ユーザーが別名を使っている場合はその値を採用する。

**ステップ 3: 生成**
- テンプレート `skills/setup/assets/gpt-{sol,terra,luna}.template.md` を読み込み、本文中の `{{MODEL_ALIAS}}` を各エージェントの確定エイリアスへ置換する。
- 出力先はプロジェクトの `.claude/agents/gpt-{sol,terra,luna}.md`。
- **既存ファイルがある場合は上書き前に必ず確認する。** `AskUserQuestion` 等でユーザーに上書き可否を確認し、**承認なしに上書きしない**。ファイルごとに(または一括で)上書き / スキップを選べるようにする。
- 特に「旧運用方針ベースの `gpt-*.md` が既に存在する場合(本文で『設計・分析・計画は役割外』と定義しているもの)は、新方針と矛盾するため上書きを推奨する」と、確認時に添えて案内する。
- `.claude/agents/` が無ければ作成する。

**ステップ 4: 後処理案内(自動書き込みはしない)**
- `.claude/agents/` を git 追跡対象にするか、gitignore するかはプロジェクト判断であることを案内(このリポジトリでは `.claude/agents` を ignore する運用がある旨を例示)。
- CLAUDE.md への追記文例を **提示のみ** する(自動で書き込まない):
  > エージェント運用は `agent-policy:with-codex` に従う。GPT エージェント定義は `.claude/agents/gpt-{sol,terra,luna}.md` に配置済み。
- 生成した 3 ファイルのパスと、次にすべきこと(Claude Code の再読み込みで Agent が認識される旨)を報告する。

補足(本文に明記):
- この Skill は Anthropic API を一切使わない。ファイル生成のみ。
- プロキシの構築手順は複製せず、要件は README・プロキシ側ドキュメントに委ねる。

---

### 4.5 `skills/setup/assets/gpt-{sol,terra,luna}.template.md`

**設計方針:** 既存 `codex/gpt-*.md` を土台にするが、(a) リポジトリ固有記述を除いた汎用版とし、(b) `model` を `{{MODEL_ALIAS}}` プレースホルダにし、(c) **本文の役割定義を新運用方針へ書き直す**(旧定義の丸写し厳禁)。

**(a) 除去する「リポジトリ固有記述」の具体列挙**(汎用配布物にそぐわないため削除・置換する):
- `plugin.json` のマイナー/メジャー version bump 規約(「プラグインを改修した場合は該当 plugin.json のバージョンを上げる」等)。
- amatsuka-claude-plugins リポジトリの API 制約の再掲(「(CLAUDE.md 参照)」という固有参照ごと)。API 不使用は汎用文として残すが、リポジトリ名・CLAUDE.md への参照は除く。
- その他 amatsuka リポジトリ固有のパス・文書・運用への直接参照。
- 残すもの: 役割定義・When to invoke・進め方・アドバイザー相談節・Output Format・「Anthropic API クライアントや `ANTHROPIC_API_KEY` 前提の実装をしない」という汎用制約。

各テンプレートの frontmatter は次の形(`{{MODEL_ALIAS}}` は setup が置換):

```yaml
---
name: gpt-sol            # terra / luna も同様
description: <下記>
model: {{MODEL_ALIAS}}
color: yellow            # sol=yellow / terra=green / luna=cyan
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent
---
```

#### 4.5.1 `gpt-sol.template.md`(新方針へ書き直し — 最重要)

**description(完全文面案):**
> Use this agent when 詳細設計・実装計画(WBS)の作成、コードベース探索(context-map の作成)、または複雑なコーディング(アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う実装)を委譲するとき。agent-policy の with-codex 運用方針における `GPT Sol`(Feature Architect)に対応する。通常の実装は `GPT Terra`、軽量なタスクは `GPT Luna` を使う。最上位の戦略判断・最終ゲートはオーケストレーター(Fable/Opus)が担う。詳細は本文の「When to invoke」を参照。

**本文構成(新方針の役割を明記):**
- 冒頭: 「あなたは GPT Sol、Feature Architect。メインオーケストレーターから起動されたサブエージェントである。**詳細設計・実装計画・コードベース探索・複雑な実装**の中心を担う。」
  - ※旧テンプレートの「調査・分析・設計はスコープ外」という文言は **削除**する。これが本セッションの差し戻し事故の原因。
- **When to invoke:**
  - コードベース探索と context-map 作成(GPT Luna/Terra の探索サブエージェントを活用してよい)。
  - Fable の Blueprint を基にした詳細設計(クラス/API/データ)+ 実装計画(ステップバイステップ WBS)の作成。
  - 複雑な実装(アーキテクチャ判断・設計トレードオフを伴う)。
- **Core Responsibilities:** 探索→context-map→詳細設計→WBS→複雑実装を根拠(パス・行番号)付きで遂行/自らの成果を検証/最上位の承認ゲートは求めない(オーケストレーターに委ねる)。
- **進め方:** 着手前に対象コードと呼び出し元を読む/推測で書かない/context-map は guide の様式に従う(guide は同梱されないため、様式は本文に要約)/実装後はテスト・型チェックで検証。
- **アドバイザーへの相談:**(共通節、下記 4.5.4)
- **制約:** Anthropic API クライアントや `ANTHROPIC_API_KEY` 前提の実装を提案・採用しない(汎用文。「CLAUDE.md 参照」「plugin.json の version bump」等のリポジトリ固有記述は除く)。
- **Output Format:** 結論を冒頭一文/根拠パス・行番号/成果物(設計書・context-map・実装)と検証方法・結果/未解決の懸念。

#### 4.5.2 `gpt-terra.template.md`

**description(案):**
> Use this agent when 通常のコーディング(複雑でない実装)、ドキュメント作成、設定編集、ビルド/テスト実行など、レビュー・重い設計を除く一般作業を委譲するとき。agent-policy の with-codex 方針における `GPT Terra` に対応する。複雑な実装・詳細設計は `GPT Sol`、軽量なタスクは `GPT Luna` を使う。詳細は本文の「When to invoke」を参照。

**本文:** 既存 `codex/gpt-terra.md` の構成をおおむね踏襲(通常実装・ドキュメント・設定整備・ビルド/テスト実行・定型メンテ)。ただしリポジトリ固有の version bump / CLAUDE.md 参照は汎用文へ置換。新方針では GPT Terra が「探索サブエージェント」として GPT Sol に活用される点を When to invoke に 1 項追加。

#### 4.5.3 `gpt-luna.template.md`

**description(案):**
> Use this agent when 軽量なタスク(一括適用・一括チェック・反復変換・軽微なコーディング)や探索補助を委譲するとき。agent-policy の with-codex 方針における `GPT Luna` に対応する。複雑な実装・詳細設計は `GPT Sol`、判断を要する通常の実装は `GPT Terra` を使う。詳細は本文の「When to invoke」を参照。

**本文:** 既存 `codex/gpt-luna.md` の構成を踏襲(一括適用・一括チェック・反復変換・軽微コーディング)。新方針で GPT Sol/Opus の「探索専用サブエージェント」として使われる点を明記。リポジトリ固有記述は汎用化。

#### 4.5.4 3 テンプレート共通の「アドバイザーへの相談」節(そのまま移植)

既存 `codex/gpt-*.md` の該当節はリポジトリ非依存なので、文言をほぼそのまま採用する:

```markdown
## アドバイザーへの相談

- あなたはサブエージェントである。作業の途中で判断に迷ったときだけ、Agent ツールで `Fable` サブエージェントをアドバイザーとして呼び出し、助言を求める。
- アドバイザーへの依頼文には「あなたはアドバイザーであり、助言のみを返すこと」「Agent ツールを使用しないこと(サブエージェントの起動を許可しない)」を必ず明記する。
- 迷っていないときはアドバイザーを呼ばない。助言以外の目的(作業の委譲など)で Agent ツールを使用しない。
```

`tools:` に `Agent` を含める理由は「アドバイザー相談専用」であり、孫への Agent 許可は禁止である旨を、各テンプレートの **「制約」節**に 1 項として明記する(暗黙知#14)。文例:「`Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。」上記「アドバイザーへの相談」節と併せ、相談手順は相談節・禁止事項は制約節、と配置を統一する。

---

### 4.6 `references/advisor-rules.md`

両方針 Skill 共通の参照文書。両 SKILL.md から「詳細はこれを読む」と委譲される。

#### 本文構成

1. **位置づけ**: 「この文書は `agent-policy` の全方針が共有する、アドバイザー運用・サブエージェント委譲・並列実行の共通規律である。」
2. **アドバイザー運用**(原文1/2 共通)
   - オーケストレーター(Fable/Opus)は、サブエージェントがアドバイザーに相談できるよう Agent Tool を許可し、「あなたはサブエージェントである」ことを明示する。
   - **サブエージェントがアドバイザーとして相談する相手は `Fable` のみ**とする(相談先に Opus 等を含めない)。オーケストレーターが Fable/Opus のいずれであるかとは独立に、アドバイザーの宛先は Fable に統一する。
   - サブエージェントは、自身が起動したサブエージェントに対して Agent Tool を **許可してはならない**。
3. **孫起動の禁止**
   - サブエージェントが Agent Tool を持つのはアドバイザー相談のためだけ。作業委譲(再オーケストレーション)目的での使用は禁止。
   - アドバイザーへの依頼文に必ず「助言のみ・Agent Tool 使用禁止」を明記する。
4. **並列実行の原則**(原文1/2 共通)
   - 独立したタスクが複数あれば可能な限り並列でサブエージェントを起動する。
   - 依存関係がある場合は明示的に管理する。
   - (claude-only 補足)Fable は並列起動の判断と結果統合のみを行い、自身は並列実行しない。

---

### 4.7 `references/context-map-guide.md`

context-map の運用手順を定義する共通参照。両 SKILL.md の「コードベース探索」節から委譲される。

#### 本文構成

1. **context-map とは**: セッションの探索成果物。現在の構造・関連モジュール・影響範囲・既存契約・未解決事項・テスト方法を整理し、オーケストレーター(Fable/Opus)へ共有する材料。
2. **作成契機**(決定事項):
   - コードベース探索を伴う **設計・実装タスクの着手時のみ** 作成する。
   - 雑談・単発質問・軽微修正では作らない。
   - 同一セッション内で追加タスクが発生した場合は、新規作成せず **同じファイルを更新** する。
   - **判定の具体例(暗黙知の明文化):**
     - 作成する: 新機能の設計、複数ファイルにまたがる改修、影響範囲が不明な変更、既存構造の理解が前提となるリファクタリング。
     - 作成しない: 単発の質問への回答、typo・文言修正などの軽微修正、1 ファイルで完結する定型変更(定数追加・軽微なスタイル修正等)、雑談。
     - 迷う場合の目安: 「着手前にコードベースを探索して構造・依存・影響範囲を把握する必要があるか」を基準にする。必要なら作成、不要なら作成しない。
3. **作成者**(表現の正: テンプレートの `作成者` 欄は §4.8 の **併記形式**を正とし、実際に作成したエージェント/profile に印を付けて用いる):
   - with-codex 方針 → **GPT Sol**(探索統括。GPT Luna/Terra の探索サブエージェントを活用)。
   - claude-only 方針 → **Opus**(Sonnet/Haiku の探索サブエージェントを活用)。
   - guide 本文・テンプレート欄・SKILL 本文で作成者を記す際は、この「profile → 作成者」の対応と併記形式に統一する(段落・表・併記の混在を避ける)。
4. **出力先**(決定事項): `.claude/context-maps/YYYY-MM-DD-<タスク名スラッグ>.md`。
   - `<タスク名スラッグ>` は kebab-case。日付は作成日。
5. **テンプレート**: `assets/context-map-template.md`(プラグインルート)をこのパスへコピーし、各セクションを埋める。全セクション(1〜11)を可能な範囲で記入する。
6. **更新ルール**: 同一セッションの追加タスクは同じファイルへ追記・更新。別セッション・別タスクは新規ファイル。
   - **「同一セッション」の定義(明文化)**: Claude Code の 1 会話セッション(1 つの継続した対話)を指す。会話をまたぐ(別セッションで作業を再開する)場合は新規ファイルを作成し、必要なら前回の map を参照する。日付が変わっても同一会話が継続していれば同一セッション扱いとし、ファイル名の日付は最初の作成日を維持する。
7. **gitignore 案内**: `.claude/context-maps/` を git 追跡するかは **プロジェクト判断**。追跡したくない場合は `.gitignore` に追記する例を示す。判断はユーザーに委ね、自動で `.gitignore` を書き換えない。
8. **シークレット非記録(重要)**: context-map に API キー・トークン・パスワード・プロキシの秘密値などの機密情報を **記録しない**。保存先が追跡対象の場合に漏えいするため。リポジトリ固有ポリシー(例: `docs/chat/` を読まない等)を context-map が上書きしないこと。

---

### 4.8 `assets/context-map-template.md`

**調整前の完全形は、入力資料 `private/context-map/2026-07-19-agent-policy-inputs.md` の「ユーザー提示原文3: context-map テンプレート(context-map.example.md)」(同ファイル内、見出し 1〜11 + 「次のステップ提案」を含む全文)を正とする。** 実装者はそれを転記し(§4 冒頭のモデル名正規化ルールを適用: 原文3 中の `Fable5`→`Fable` 等)、以下の承認済み 2 点だけを調整する。

- **調整1(作成者欄の profile 非依存化):** ヘッダの `**作成者**` 行を、profile に依存しない併記形式にする:
  > `**作成者**: GPT Sol(with-codex 方針・探索担当) / Opus(claude-only 方針・探索担当)`
- **調整2(シークレット非記録の注意書き):** テンプレート末尾(既存の「*このファイルは Fable / Opus に共有し...*」の直後)に注意書きを追加:
  > `> ⚠ 注意: この context-map に API キー・トークン・パスワード・プロキシの秘密値などの機密情報を記録しないこと。保存先が git 追跡対象の場合に漏えいするおそれがある。`

上記 2 点以外は原文3 の見出し(1. 目的・スコープ 〜 11. 補足・暗黙知)・表・「次のステップ提案」をそのまま維持する。テンプレートなので `[タスク名 / 機能名]` 等のプレースホルダ表記も保持する。

---

### 4.9 `README.md`(プラグイン)

決定事項の 6 セクション構成。

**セクション1 目的(1-3 行):**
> `agent-policy` は、あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成)を配布可能な Skill として提供する。CLAUDE.md にこの Skill へ従う旨を書くだけで、任意のプロジェクトに同じ運用規律を持ち込める。

**セクション2 提供 Skill 一覧:**
- `agent-policy:with-codex` — Claude + Codex(GPT)併用構成の運用方針。
- `agent-policy:claude-only` — Claude のみで完結する運用方針(プロキシ不要)。
- `agent-policy:setup` — with-codex で使う GPT Agent 定義を `.claude/agents/` に生成するウィザード。

**セクション3 使い方 — CLAUDE.md への記載例(両 profile の完全文例):**

冒頭に profile 選択の 1 行デシジョンフローを置く:
> **どちらを選ぶか:** Codex 系 GPT モデルを配信するプロキシ環境がある → `with-codex` / それ以外(Claude のみ)→ `claude-only`。

with-codex を使う場合(CLAUDE.md にこう書く):
```markdown
## エージェント運用方針
- エージェント運用は `agent-policy:with-codex` に従う。
- GPT エージェント(gpt-sol / gpt-terra / gpt-luna)が未生成の場合は `agent-policy:setup` を実行して `.claude/agents/` に生成する。
```

claude-only を使う場合:
```markdown
## エージェント運用方針
- エージェント運用は `agent-policy:claude-only` に従う。
```

**セクション4 前提条件:**
- `claude-only`: 追加の前提なし。プロキシ・GPT・外部 API は不要。
- `with-codex` + `setup`: Codex 系モデルを配信するローカルプロキシ(任意の ProxyAPI サーバー)経由で Claude Code を起動していること、`/v1/models` に使用するエイリアスが含まれること。**構築手順は本 README では扱わず、要件のみ記載**。プロキシ・OAuth・秘密値はこのプラグインが管理しない。
- 「既存の `gpt-*.md`(旧運用方針版。本文で『設計・分析は役割外』と定義しているもの)が `.claude/agents/` に残っている場合は、新方針と矛盾するため `setup` での上書きを推奨」の注意書きを含める。

**セクション5 モデルエイリアスの説明:**
- `claude-gpt-5-6-sol` 等は **モデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名**。名前に `claude-` が付くが上流は Codex GPT。
- エイリアスはプロキシ設定に依存する拡張であり、標準 model 値(`inherit`/`sonnet`/`opus`/`haiku`)と同じ可搬性は仮定しない。`setup` でプロジェクトごとに差し替え可能。

**セクション6 revelation 等との棲み分け:**
- 本プラグイン(`agent-policy`)=「**誰に任せるか**」(モデル別役割分担・委譲先の決定)。
- `revelation`=「**どう進めるか**」(タスク分解・自己検証・次の一手の選び方)。
- 両者は併用可能。同じ局面で両方が発動しても矛盾しない(役割分担 vs 進め方で関心が異なる)ことを明記。
- **役割 Agents を持つワークフロープラグイン(例: Codiel)との併用:** Codiel 等は関心ごとの役割 Agents(`model: inherit`)で各フェーズを駆動する。agent-policy はその「役割」を尊重しつつ「誰が実行するか」を重ねる。`with-codex` では、実装フェーズの役割 Agent 定義本文を GPT エージェントへの依頼文に注入して実行する合成方式(役割プロンプト × GPT 実行)をとる。`claude-only` では役割 Agents をそのまま起動する(必要なら dispatch 時に標準 model 値へ上書き)。詳細な判断フローは各 Skill 本文に記載。

---

## 5. リポジトリ側変更

### 5.1 `marketplace.json` への追記

`plugins` 配列の末尾(pitcrew entry の後)に以下を追記する:

```json
    {
      "name": "agent-policy",
      "source": "./plugins/agent-policy",
      "description": "あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map)を、Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群"
    }
```

(pitcrew entry の閉じ `}` の後にカンマを追加し、上記 object を挿入。`description` は plugin.json と一致させる。)

### 5.2 ルート `README.md` への追記

**(a) 配布プラグイン表(41-46 行付近)に 1 行追加:**

```markdown
| agent-policy | あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・context-map)を Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群 | 開発中     |
```

**(b) 個別説明節(task-utility 節などと同様の粒度)を追記:**

```markdown
### agent-policy

「誰に何を任せるか」= エージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成)をスキルとして配布します。<br>
CLAUDE.md に `agent-policy:with-codex`(または `claude-only`)へ従う旨を書くだけで、任意のプロジェクトに同じ運用規律を持ち込めます。<br>
「どう進めるか」を扱う revelation と併用できます。
```

---

## 6. Skill 相互排他の設計(2 方針の同時発動防止)

**課題(リスク#2):** with-codex と claude-only が同じ一般的タスク語を trigger にすると、両方が発動して矛盾した役割割当になる。

**設計:** description を「環境の排他条件」で書き分ける。両者とも「セッション最初の実務タスク着手前に読む」という発動タイミングは共通だが、**どちらを読むかは実行環境(GPT プロキシの有無)で一意に決まる**ように書く。

- `with-codex`: description に「Claude と Codex 系 GPT モデルを **併用する構成**での方針。**GPT/Codex プロキシが使えない環境では代わりに `agent-policy:claude-only` を用いる**」と明記。
- `claude-only`: description に「Claude モデル **のみで完結**する構成での方針。**ローカルプロキシや GPT/Codex を必要としない**。GPT を併用する構成では代わりに `agent-policy:with-codex` を用いる」と明記。

さらに **CLAUDE.md での名指し参照を一次のセレクタ**とする(決定事項の「利用方法」)。ユーザーは自分のプロジェクトの CLAUDE.md でどちらか一方だけを名指しするため、実運用では CLAUDE.md の記述が profile を確定させ、description の排他条件はフォールバック(明示指定がない場合の環境判定)として働く。

**検証観点:** skill-reviewer と smoke test で、(a) claude-only 明示時に claude-only だけが選ばれる、(b) with-codex 明示時に with-codex だけが選ばれる、(c) profile 未指定の一般タスクで両方が同時発動しない、ことを確認する(§7)。

---

## 7. 検証計画

### 7.1 プラグイン構造検証(plugin-validator)

- `plugin-dev:plugin-validator` を `plugins/agent-policy/` に対して実行。
- 確認: `plugin.json` の 3 項目、Skill ディレクトリ名と frontmatter `name` の一致(with-codex / claude-only / setup)、SKILL.md frontmatter が `name`/`description` の 2 項目、`references/`・`assets/` が `skills/` 直下に無いこと(ルート直下にあること)、`skills/setup/assets/` にテンプレート 3 件があること。
- `marketplace.json` / `plugin.json` の JSON parse 成功、entry name と plugin.json name の一致、`source` パスの実在。

### 7.2 Skill 品質レビュー(skill-reviewer)

- `plugin-dev:skill-reviewer` で 3 Skill(with-codex / claude-only / setup)を個別レビュー。
- 相互排他(§6)の 3 観点を description ベースで確認。
- 本文が原文1/2 の役割割当・設計フロー・Haiku レビュー・アドバイザー運用・孫起動禁止・並列原則を欠落なく含む(または references へ正しく委譲している)ことを比較。

### 7.3 スモークテスト

- `--plugin-dir plugins/agent-policy` で読み込み、`/plugin` で 3 Skill が namespace 付きで見えることを確認。
- **setup 実行:** ヒアリング 4 ステップを通し、`.claude/agents/gpt-{sol,terra,luna}.md` が生成され、`{{MODEL_ALIAS}}` が確定エイリアスへ置換されていることを確認。既存ファイルがある場合の上書き確認プロンプトを確認。
- **相互排他:** claude-only を指す CLAUDE.md 記述下で claude-only のみ発動、with-codex を指す記述下で with-codex のみ発動、profile 未指定タスクで両方が同時発動しないことを確認。
- 生成された gpt-sol.md の本文が **新方針(設計・実装計画・探索がスコープ内)** になっており、旧定義の「設計は役割外」を含まないことを確認(本設計の最重要チェック)。目視に加え、機械的検証として次を実施:
  ```bash
  # 旧方針の文言が残っていないこと(ヒット 0 件を期待)
  grep -nE '役割ではない|スコープ外.*設計|設計.*スコープ外|調査・分析・設計' .claude/agents/gpt-sol.md
  # 新方針の役割が含まれること(ヒットすることを期待)
  grep -nE '詳細設計|実装計画|コードベース探索|context-map' .claude/agents/gpt-sol.md
  ```
  同様の grep を setup 用テンプレート `skills/setup/assets/gpt-sol.template.md` にも適用し、テンプレート段階で旧文言が混入していないことを確認する。
- **役割 Agents 併用スモークテスト(with-codex):** 役割 Agent(例 Codiel の `codiel-implementer-*`)の本文を GPT エージェントへの依頼文に同梱して起動し、(a) 役割どおりの振る舞いになること、(b) 依頼文で指定した tools 制限を遵守すること、を観測する。あわせて、dispatch 時 `model` 上書きにカスタムエイリアスを渡すとバリデーションエラーで拒否される(§4.2-10 の確定事実)ことを確認する。

### 7.4 リポジトリ検証

- 静的プラグインのみのため `pnpm lint` + plugin-validator + JSON/frontmatter チェックで足りる(`pnpm build`/`test`/`typecheck` は runtime code が無いため不要)。

---

## 8. 実装ステップ(WBS)

| # | 作業 | 担当推奨 | 依存 |
|---|---|---|---|
| 1 | `plugins/agent-policy/.claude-plugin/plugin.json` 作成 | GPT Terra | なし |
| 2 | `references/advisor-rules.md` 作成(原文1/2 共通節を集約) | GPT Terra | なし |
| 3 | `references/context-map-guide.md` 作成(決定事項の運用手順) | GPT Terra | なし |
| 4 | `assets/context-map-template.md` 作成(原文3 + 2 点調整) | GPT Terra | なし |
| 5 | `skills/with-codex/SKILL.md` 作成(§4.2、references 委譲込み) | GPT Terra | 2, 3 |
| 6 | `skills/claude-only/SKILL.md` 作成(§4.3) | GPT Terra | 2, 3 |
| 7 | `skills/setup/assets/gpt-sol.template.md` 作成(**新方針へ書き直し**) | GPT Sol または Opus | なし |
| 8 | `skills/setup/assets/gpt-terra.template.md` 作成 | GPT Terra | 7(役割整合の参照) |
| 9 | `skills/setup/assets/gpt-luna.template.md` 作成 | GPT Terra | 7 |
| 10 | `skills/setup/SKILL.md` 作成(ヒアリング 4 ステップ) | GPT Terra | 7, 8, 9 |
| 11 | `plugins/agent-policy/README.md` 作成(6 セクション) | GPT Terra | 1-10 |
| 12 | `marketplace.json` へ entry 追記 | GPT Luna | 1 |
| 13 | ルート `README.md` へ配布一覧 + 個別節追記 | GPT Luna | 1 |
| 14 | plugin-validator 実行・修正 | オーケストレーター | 1-13 |
| 15 | skill-reviewer で 3 Skill レビュー・修正 | Sonnet → 統合はオーケストレーター | 5, 6, 10 |
| 16 | スモークテスト(setup 実行・相互排他・新方針確認) | オーケストレーター | 14, 15 |

**並列可能な塊:** {1, 2, 3, 4, 7} は相互に独立で並列着手可。{5, 6} は 2/3 完了後に並列。{8, 9} は 7 の後に並列。{12, 13} は 1 の後に並列。

**ステップ 7 の担当格上げ理由:** gpt-sol テンプレートの本文書き直しは、旧方針との非互換を正しく解消する必要があり、単純な写経ではない。役割定義の設計判断を含むため GPT Sol(新方針でスコープ内)または Opus に担当させ、旧定義の丸写しを防ぐ。

---

## 9. 非スコープ・将来課題

以下は本タスクに **含めない**(別タスク・段階導入)。

1. **強制力の hook 層(段階導入):** 初版は Skill のみ。CLAUDE.md からの名指し参照を前提とする。Revelation の知見(「規律を要するモデルほど Skill を自発 invoke しない」)により非発動が問題化した場合に、SessionStart 注入 / PreToolUse ガードの hook 層を後付けで設計する。
2. **既存 root 文書の移行:** `agents-with-codex.md` / `agents-claude-only.md` / `codex/*.md` の deprecated 化・削除・plugin への一本化は別タスク。初版では残し、drift 注意を README に留める。
3. **basic-design の `skills/shared/` 修正:** 「`skills/` 直下に Skill フォルダ以外を置かない」原則に反する既存の設計ミスは、本タスクでは触らない(別タスク)。
4. **CLAUDE.md / CLAUDE.example.md の改変:** 人間確認が必要なため本タスク範囲外。利用者が自分のプロジェクト CLAUDE.md に記載する運用に留める。
5. **`.claude/<plugin>.local.md` による profile 自動選択:** 初版は CLAUDE.md 名指し + description 排他で足りるため導入しない。将来、自動選択 UX が必要になれば設定ファイル + 読み取り機構を別途設計。

---

## 10. Open Questions(改善提案・未決事項 — 本文設計には未反映)

以下は設計に反映していない提案・確認事項。人間/オーケストレーターの判断を仰ぐ。

1. **setup テンプレートと root `codex/*.md` の二重管理:** 本プラグインの `gpt-*.template.md`(新方針)と、root `codex/*.md`(旧方針)が併存する。root 側は §9-2 で別タスク移行予定だが、それまで「新方針テンプレート vs 旧方針 root 定義」の役割記述 drift が残る。root 側 3 ファイルも新方針へ更新する軽微タスクを先行させる選択肢がある(ただし決定事項では「今回触らない」)。
2. **color の汎用性:** テンプレートの `color`(yellow/green/cyan)は既存 root 定義由来。汎用配布物として color を固定してよいか、setup でヒアリングするかは未決。初版は固定で問題ないと判断したが確認したい。
3. **`gpt-terra.template.md` / `gpt-luna.template.md` の description に「探索サブエージェント」役割を追加する件:** 新方針で GPT Sol が Luna/Terra を探索に使うため本文に追記予定だが、description(trigger)にまで書くと通常実装タスクの trigger と競合しないか、skill/agent-reviewer で確認したい。
4. **context-map 出力先の既存衝突:** `.claude/context-maps/` を利用者プロジェクトが別用途で使っている可能性。guide でパスを案内するが、衝突時の振る舞い(上書き確認等)を明記すべきか。
5. **revelation との同時発動の実挙動:** §4.9-6 で「併用可能・矛盾しない」と記載するが、両プラグイン導入時に実際に両 Skill が同時発動した場合のトークン消費・優先順位を smoke test で観測してから README を確定する方が安全。
