# raphael — 失敗免疫系プラグイン 設計書

- 日付: 2026-07-22
- ステータス: ユーザー承認済み設計(ブレインストーミング完了、Haiku レビュー反映済み)
- 対象: `plugins/raphael/`(新規プラグイン、version 0.1.0-dev から開始)

## 1. コンセプト

**raphael**(治癒の大天使に由来)は、セッション中の失敗を「抗体」として蓄積し、同じ失敗の前兆をフックで機械検知して予防指示を注入する失敗免疫系プラグインである。

生物の免疫系のアナロジーで 3 フェーズが循環する:

```
① 感知(infection record)
   PostToolUse / UserPromptSubmit フックが失敗兆候を機械検知(LLM 不使用)
   → .raphael/infections/ に JSONL 記録
        ↓
② 抗体生成(antibody synthesis)
   Stop フック契機でサブエージェントが感染記録を蒸留し、
   「トリガーパターン + 予防指示」の抗体を .raphael/antibodies/ に生成
   (セッション終了時のみ・条件付き。この蒸留判断は LLM が行う)
        ↓
③ 予防接種(inoculation)
   PreToolUse フックが抗体のトリガーを正規表現マッチ(LLM 不使用)
   → 発火時のみ additionalContext で予防指示を注入
```

LLM の使用箇所は②の蒸留サブエージェントのみであり、Claude Code のサブエージェント機構(ユーザーの既存サブスク認証)に閉じる。①③のフックは Node.js の決定的処理のみで LLM を一切使わない。

### 核心的な設計判断

学習の成果(抗体)を LLM の記憶や必読ファイルではなく、**フックの決定的マッチング**に変換する。

- ランタイムコストは正規表現評価のみ(実質ゼロ)
- 抗体が何百件溜まってもセッション毎のコンテキスト消費は「発火した抗体の分」だけ
- CLAUDE.md / GOTCHAS.md 型の「必読ファイル」方式が持つ常駐コスト線形増の問題と構造的に無縁

トレードオフ: 必読方式の確実性(必ず読まれる)を捨て、偽陰性(パターン不一致で注入されない)リスクを受け入れる。なお `confirmed` 昇格(§2)は偽陰性の補正ではなく、偽陽性対策(有効期限による自然減衰)から重要な抗体を保護するための仕組みである。

### Codiel との住み分け(方向 A: 独立プラグイン + 相互運用)

| 観点 | Codiel(GOTCHAS.md / Raguel 判例) | raphael |
|---|---|---|
| スコープ | Codiel run 内のみ。issue 駆動オーケストレーションが前提 | 日常の全セッションで常時働く |
| 検知の主体 | オーケストレーターが特定契機で判断して記録 | フックが失敗兆候を機械的に検知 |
| 注入コスト | 全フェーズのサブエージェントが必読 = 常駐コスト型 | 発火時のみ注入 = ゼロ常駐型 |

Codiel は現状のまま変更しない。将来の連携ポイントとして、抗体 frontmatter の `source` フィールドを自由文字列とし、由来種別(raphael の感染記録 / 手動作成 / 将来の外部ツール由来)を区別できるようにしておく。v0.1 で確保するのはこの受け入れ余地のみで、GOTCHAS との変換や互換は実装しない。

## 2. 抗体のデータ設計

### 抗体ファイル形式

1 件 = 1 ファイルで `.raphael/antibodies/` に配置。Markdown + YAML frontmatter。ファイル名は `<id>.md`。

```markdown
---
id: ab-2026-0721-001
created: 2026-07-21
source: infection-2026-0721-003        # 由来(自由文字列: 感染記録 ID / manual / 外部ツール名)
trigger:
  event: PreToolUse                    # 発火するフックイベント
  tool: Bash                           # 対象ツール(Bash / Edit / Write / *)
  pattern: "prisma\\s+migrate"         # tool_input への正規表現
  scope: "src/db/**"                   # 任意: ファイルパス条件(Edit/Write のみ有効。Bash では無視)
status: active                         # active / expired / confirmed
stats:
  fired: 3                             # 発火回数
  last_fired: 2026-07-21
expires: 2026-08-21                    # 有効期限(既定 30 日)
---

このプロジェクトの `prisma migrate` は直接実行せず、先に
`pnpm db:generate` を実行して schema 差分を確認すること。
前回、生成物の不整合でマイグレーションが 3 回連続で失敗した。
```

- **frontmatter** = フック(機械側)が読む発火条件。フックは本文を解釈しない
- **本文** = 発火時に additionalContext として注入される LLM 向け指示
- `scope` によるパス条件が過剰発火の第一の絞り込み(v0.1 では Edit/Write の対象パスにのみ適用)
- **複数抗体が同時マッチした場合**: `last_fired` の新しい順に最大 3 件まで本文を連結して注入する(注入上限は設定可能)

### 感染記録(infection)の検知条件

PostToolUse / UserPromptSubmit フックが以下を機械検知して `.raphael/infections/` に JSONL 記録する(LLM 不使用):

| 兆候 | 検知方法(v0.1 の判定基準) |
|---|---|
| コマンド失敗 | Bash の exit code ≠ 0。ただし既定の除外リスト(`grep`/`rg`/`diff`/`test`/`[` の exit 1 など「不一致・偽」を意味する非ゼロ)に該当するものは除く。除外リストは組み込み既定 + 設定で拡張可 |
| リトライループ | 正規化後(前後空白除去・連続空白の圧縮)に一致するコマンドが N 回(既定 3)連続失敗。v0.1 は正規化完全一致のみで「類似」判定はしない |
| ユーザー差し戻し | UserPromptSubmit の否定的パターン。組み込み既定(日: 「違う」「そうじゃない」「戻して」「やり直して」等 / 英: "no,", "that's wrong", "revert", "undo" 等)+ 設定で拡張可。具体的な語彙リストは実装計画で確定する |
| 編集のやり直し | 同一セッション内で、同一ファイルの重なる行範囲への Edit が 3 回以上発生 |

感染記録の JSONL スキーマ(1 行 = 1 レコード)は最低限以下を含む:

```json
{"id": "infection-2026-0721-003", "ts": "2026-07-21T12:34:56+09:00",
 "kind": "command-failure | retry-loop | user-rejection | edit-churn",
 "tool": "Bash", "input_digest": "実行コマンド or 対象パスの要点",
 "evidence": "exit code / エラー末尾 N 行 / 差し戻し発言などの抜粋",
 "session": "<session-id>", "distilled": false}
```

感染記録は生ログの要点だけを持つ軽量データであり、蒸留の材料。全部が抗体になるわけではない。

### 感染記録・状態のライフサイクル

- **蒸留済みマーク**: antibody-synthesizer が処理したレコードは `distilled: true` に更新する(`update-antibody.mjs` と同系のスクリプト経由)
- **廃棄**: `distilled: true` のレコードは、次回の Stop フック実行時に 14 日より古いものから削除する(監査は git 履歴ではなく抗体側の `source` 参照で足りる)
- **`.raphael/state.json`**: リトライループ検出用の直近コマンド履歴(既定: 直近 20 件)と注入済み抗体の記録を持つセッションスクラッチ。git ignore 対象
- **書き込み耐性**: フックからの書き込みはすべて「一時ファイル + rename」のアトミック書き込みとし、同時実行による破損を防ぐ。v0.1 は単一セッション運用を前提とし、セッション間ロックは実装しない

### 誤検知(過剰注入)対策 — 3 層

1. **有効期限(自然減衰)**: 既定 30 日で `expired`。抗体が発火したセッションが失敗兆候なく完了した場合(Stop フック時に `state.json` の注入記録と新規感染記録を突き合わせて判定)、蒸留サブエージェントが期限を `last_fired` から既定期間ぶん再設定する。延長の上限は通算 90 日とし、それ以上残したい抗体は `confirmed` 昇格で扱う
2. **命中率フィードバック**: 発火したのに同じ失敗が再発(パターン不良)、または注入後にユーザーが無関係と示した場合、Stop 時の蒸留でパターン修正 or 失効。発火統計(`stats`)はフックが機械的に更新
3. **確認済み昇格(`confirmed`)**: ユーザーが `/raphael:review` で明示承認したものだけ期限なしに昇格

## 3. コンポーネント構成

### ディレクトリ構成

リポジトリ方針「JavaScript はすべて TypeScript で書く」に従い、src/(TS ソース)→ scripts/(ビルド出力 .mjs・git 管理)の構成とする。dist/ は使わない(dist/ は Raguel MCP の server.mjs のような特殊ケース専用)。

```
plugins/raphael/
├── .claude-plugin/plugin.json     # manifest(0.1.0-dev から開始)
├── README.md / DESIGN.md
├── hooks/hooks.json               # フック配線定義
├── package.json / build.ts        # ビルド設定(codiel と同様)
├── src/                           # TypeScript ソース(唯一の編集対象)
│   ├── detect-infection.ts        #   感知(PostToolUse / UserPromptSubmit フック)
│   ├── inoculate.ts               #   予防接種(PreToolUse フック)
│   ├── check-distill-needed.ts    #   Stop フック: 蒸留要否判定・差し戻し・古い記録の掃除
│   ├── list-antibodies.ts         #   抗体・感染記録一覧の整形出力
│   ├── update-antibody.ts         #   失効/昇格/期限延長/蒸留済みマーク操作
│   └── lib/                       #   抗体パーサ・感染記録 I/O 共通部
├── scripts/                       # ビルド出力の .mjs(git 管理・利用者ビルド不要)
├── agents/
│   └── antibody-synthesizer.md    # 蒸留サブエージェント
├── commands/
│   └── review.md                  # /raphael:review
└── skills/
    └── raphael/SKILL.md           # 動作モデルの説明(メインエージェント向け)
```

- src/ 変更時は `pnpm build` を実行し scripts/ の生成差分もコミット(CLAUDE.md 規約)
- hooks.json / agents / commands からの参照はすべて `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs`
- 抗体 frontmatter の更新(失効・昇格・期限延長・蒸留済みマーク)は LLM の手書き編集ではなく `update-antibody.mjs` 経由にし、YAML 破損を防ぐ(Codiel の `codiel-state` と同じ防御パターン)
- `list-antibodies.mjs` の呼び出し元は `/raphael:review`(一覧表示)と antibody-synthesizer(既存抗体の把握)の両方

### フック配線(hooks.json)

| イベント | スクリプト | 役割 | LLM |
|---|---|---|---|
| `PostToolUse` (Bash/Edit/Write) | `detect-infection.mjs` | 失敗兆候を検知して感染記録へ追記。リトライループ検出のため直近履歴を `.raphael/state.json` に保持 | 不使用 |
| `UserPromptSubmit` | `detect-infection.mjs` | 差し戻し語パターン検知。直前ターンのツール履歴と紐づけて記録 | 不使用 |
| `PreToolUse` (Bash/Edit/Write) | `inoculate.mjs` | active/confirmed な抗体の trigger を評価し、マッチ時のみ `additionalContext` で本文注入 + `stats.fired` 更新 | 不使用 |
| `Stop` | `check-distill-needed.mjs` | 未蒸留の感染記録が閾値(既定 3 件)以上あれば、メインエージェントに antibody-synthesizer の起動を差し戻しで促す(task-utility chat-recorder と同じ方式)。あわせて古い蒸留済み記録を掃除 | 判定は不使用 |

失敗のないセッションでは LLM コストが完全にゼロになる。

### 蒸留サブエージェント(antibody-synthesizer)

蒸留は LLM(サブエージェント)が担う唯一の処理である。

- 入力: `.raphael/infections/` の未蒸留レコード + 既存抗体一覧(frontmatter のみ、`list-antibodies.mjs` 経由)
- 判断: Codiel の GOTCHAS と同じ 1 問「次回この状況に遭遇したエージェントがこれを知らないと同じ失敗をするか?」で選別
- 出力: 新規抗体の作成 / 既存抗体のパターン修正・失効・期限延長 / 処理済み感染記録のマーク(いずれもスクリプト経由)
- 既存抗体との重複時の使い分け: **トリガーが実質同一**(同じコマンド・同じ失敗)なら既存の期限延長、**同型だが対象が異なる**(別コマンドで同じ根本原因)ならパターン汎化。新規作成は既存で表現できない場合のみ(台帳肥大化の防止)

### API 不使用の担保

Anthropic API・`ANTHROPIC_API_KEY` は一切使わない(CLAUDE.md 必須制約)。LLM が必要な処理(蒸留)は Claude Code のサブエージェント機構に閉じ、フック側は Node.js の決定的処理のみ。

## 4. スコープ境界

### v0.1 でやること

1. 感知: 4 パターン検知(コマンド失敗・リトライループ・差し戻し・編集やり直し)
2. 蒸留: Stop フック差し戻し(閾値 3 件以上)→ antibody-synthesizer
3. 予防接種: PreToolUse 正規表現マッチ → additionalContext 注入 + 統計更新
4. 管理: `/raphael:review` による承認(confirmed 昇格)・却下・編集
5. 失効: 有効期限(既定 30 日・延長上限 90 日)による自動失効

### v0.1 でやらないこと(非目標)

| 非目標 | 理由 |
|---|---|
| 抗体のプロジェクト間共有・グローバル抗体 | まず単一プロジェクトで命中率の実績を見る。共有は誤検知を増幅する |
| Codiel 連携(GOTCHAS → 抗体の自動変換) | 将来の連携ポイント。`source` フィールドの自由文字列化で余地だけ確保 |
| 差し戻し検知の網羅的な多言語対応 | 組み込みは日英の基本パターンのみ。設定でユーザーが語彙を追加できるが、それを超える言語対応は行わない |
| 抗体の類似マージ・ベクトル検索 | 正規表現で十分か観察してから。LLM/埋め込み常用はコスト原則に反する |
| セッション横断のリアルタイム学習 | 蒸留はセッション終了時のみ。ミッドセッション抗体生成は複雑化に見合わない |
| リトライループの「類似」コマンド判定 | v0.1 は正規化完全一致のみ。編集距離等による類似判定は誤検知リスクが読めないため見送り |
| セッション間の同時実行ロック | 単一セッション運用を前提。アトミック書き込みのみで対処 |

### 設定(`.claude/raphael.local.md`)

plugin-settings の `.local.md` パターンに従う。設定ファイルが存在しない場合は組み込み既定値で動作し、初期化処理は不要(テンプレートは README に記載)。設定項目:

- 感知の有効/無効(検知種別ごと)
- 蒸留閾値(既定 3 件)
- 抗体の既定有効期限(既定 30 日)・同時注入上限(既定 3 件)
- 差し戻し語パターンの追加・コマンド失敗除外リストの追加
- `.raphael/` の git 管理方針(既定: infections/ と state.json は ignore、antibodies/ はコミット推奨)

## 5. テスト方針

- **ユニットテスト(vitest)**: `src/lib/` の抗体パーサ・frontmatter 直列化・トリガーマッチング・リトライループ検出。除外リスト(無害な非ゼロ exit)と正規表現の誤爆は境界ケースを厚く
- **フック I/O テスト**: stdin にフックイベント JSON を流し込み、stdout の additionalContext / 継続判定を検証する統合テスト(pitcrew と同様の方式)
- **inoculate の「沈黙の正しさ」**: マッチしない場合に何も出力しないことを必ず検証(全ツール呼び出しに影響するため最重要)
- **手動検証シナリオ**: (1) ビルド失敗 3 回 → セッション終了 → 抗体生成確認 (2) 次セッションで同型コマンド → 注入確認 (3) `/raphael:review` で昇格・却下確認

## 6. 実装の進め方

agent-policy:with-codex 方針に従う:

1. 本スペックの Haiku レビュー(理解+暗黙知・矛盾抽出)→ 補足修正(完了・反映済み)
2. ユーザーによるスペックレビュー・承認
3. GPT Sol へ詳細設計・実装計画(WBS)を委譲(context-map 作成を含む)。差し戻し語彙リストの確定、感染記録スキーマの最終化、`/raphael:review` の UI フローなど、本書で「実装計画で確定」とした項目はここで詰める
4. 実装は複雑度に応じて GPT Sol / Terra / Luna に分担、レビューは Sonnet
5. 最終ゲートはオーケストレーター

## 付記: 関連バックログ

- prefetch の TypeScript 化(src/ → scripts/ 構成への移行)は raphael とは独立した改修として、raphael 完成後に別タスクで扱う
