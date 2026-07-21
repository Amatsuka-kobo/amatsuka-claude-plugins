# Forerunner（投機先行実行プラグイン）のブレインストーミングと設計

- 日付: 2026-07-21
- 参加者: phyllis998, AI (Claude)
- 成果物: `docs/design/2026-07-21-prefetch-design.md`、`docs/plans/2026-07-21-prefetch-implementation.md`、`plugins/prefetch/`、コミット `e9e2ce6`（名前変更）、`f6a048c`（実装計画）、`e2a75c7`〜`e4beee7`（実装5コミット）、`93e0af4`（レビュー修正）、`16bd88b`（README更新）
- 前提: CLAUDE.md、agent-policy:with-codex スキル、superpowers:brainstorming スキル、writing-plans スキル

---

## セッション1: 新プラグイン提案から設計確定まで

# phyllis998

> amatsuka-claude-pluginsマーケットプレイスに、新しいプラグインを追加したいと思います。
> まだ世に出ていない革新的なプラグインを考えてください。

# AI

agent-policy:with-codex と superpowers:brainstorming スキルを読み込み、既存プラグイン一覧（marketplace.json）を調査。superpowers:brainstorming スキルに従い、設計承認フロー（目的・制約・成功基準の確認 → 複数案提示 → ユーザーの方向性確認）を開始した。

### 複数プラグイン案の進化

最初、既存プラグインの守備範囲に基づいて以下の3案方向を提示：

1. **grimoire/blackbox/ledger** — ブラックボックス化されたエージェント実行・監査ログ・学習記録系
2. **covenant/multiverse/premortem** — マルチバース実行・事前実行検証系
3. **oracle/inflight/sidequest** — リアルタイム情報提供・読み取り作業系

ユーザーとの複数ラウンドの質問を通じて、各案の課題を掘り下げた：
- grimoire系: ブラックボックス化は CLAUDE.md の「API不使用」方針と相反するリスク
- covenant系: マルチバース実行は軽量さとのトレードオフが大きい
- oracle系: 方向性は良いが「待ちを埋める」と「待ちを縮める」の軸混在

### 軸転換 — 「待ち時間の短縮」へ

ユーザーの回答により「待ち時間を埋めるのではなく縮める方向」と明確化し、ボトルネック別に3案を再構成：

1. **先行読み取り型** — ユーザー入力待ち前に background agent で読み取り主体の作業を先行実行し、回答後に成果を回収（待ち時間そのものを無効化）
2. **キャッシュ化型** — 過去の同類タスク結果をメモ化し、次回以降の立ち上がりを短縮
3. **パイプライン型** — 複数タスクを逐次実行するのではなく、段階ごとに並列実行可能にする

ユーザーが「先行読み取り型」を選択。理由は「外れても破棄できる no-regret 作業に限定できる」という安全性の高さ。

### Forerunner の設計確定

採用案に基づき以下の設計を確定：

**コンセプト**: CPU の投機実行のワークフロー版。設計承認や質問回答などでユーザー入力待ちに入る直前に、「承認後にほぼ確実に必要になる読み取り主体の作業」（影響範囲調査・context 把握・テストケース洗い出しなど）を background sub-agent で先行実行し、回答が届いた瞬間に成果を回収して立ち上がりを短縮。

**構成**:
- **スキル** — 予測基準（no-regret 作業を最優先）・ブリーフ雛形・回収手順を定義
- **UserPromptSubmit フック** — `.forerunner/manifest.md` に未回収の先行成果がある場合のみ「回収せよ」リマインダーを注入（shell の grep 判定、LLM 不使用）
- **manifest 規約** — 各先行タスクの有効条件と状態（`running` → `done` → `harvested`/`discarded`）を記録。書き込みはメインエージェントのみで競合なし

**安全性設計**:
- 読み取り主体 + 書き込み先を `.forerunner/` に限定することで、予測が外れてもロールバック可能（副作用ゼロ）
- フック判定を LLM でなく grep に統一してノイズゼロを確保（UserPromptSubmit は毎ターン走るため重要）

### 設計書作成と Haiku レビュー

既存設計書（agent-policy-cost-discipline）の形式を参照のうえ、forerunner 設計書を作成。Haiku レビューで以下 12 件の指摘を受け、すべて設計書に反映：

- 待ちに入る直前の定義の精度化
- manifest の並行更新メカニズム
- 状態遷移の不整合ケース
- フック注入の具体形とエッジケース
- 他のスキル・プラグインとの相互作用
- 実装時の可観測性確保
- その他

指摘はすべて反映され、最終版を `6315116` でコミット。

---

## セッション2: プラグイン名変更、実装計画・実装・レビュー完了

# phyllis998

> 進んでください

# AI

設計書承認を受けて、writing-plans スキルで実装計画作成へ進行。

### プラグイン名変更（forerunner → prefetch）

ユーザー指示後、設計書とすべての関連ファイルでプラグイン名を `forerunner` から `prefetch` に変更。`docs/design/2026-07-21-forerunner-design.md` を `docs/design/2026-07-21-prefetch-design.md` にリネームし、本文中のプラグイン参照 16 箇所（プラグインパス、`.forerunner/` 作業ディレクトリ → `.prefetch/` 等）をすべて置換。コミット `e9e2ce6`。

### 実装計画書の作成と Haiku レビュー

GPT Sol が実装計画書 `docs/plans/2026-07-21-prefetch-implementation.md` を作成。全ファイルの完成形全文を含む 5 タスク構成。Haiku レビューで以下 2 点の指摘を反映：

- テストプロジェクト準備手順の欠落
- `git status` の除外構文

修正完了後コミット `f6a048c`。

### 実装フェーズ（GPT Terra）

計画に沿って `plugins/prefetch/` 配下に 5 ファイルを実装し、5 コミットに分割：

1. `skills/prefetch/SKILL.md` — 予測基準（no-regret 優先）、dispatch ブリーフ雛形、manifest 状態遷移、回収手順
2. `hooks/hooks.json` + `scripts/check-prefetch-manifest.mjs` — UserPromptSubmit フック実装（未回収成果があるときだけリマインダーを注入）
3. `README.md` — プラグイン説明書
4. `plugin.json`（v0.1.0-dev）— プラグイン設定
5. marketplace.json へのエントリ追加

コミット: `e2a75c7`〜`e4beee7`。

### Sonnet レビューと修正

Sonnet が最終レビューを実施。blocker/major ゼロで、minor 2 件を指摘し、両方修正：

1. **additionalContext 形式への変更** — リマインダー出力を生テキストから `hookSpecificOutput.additionalContext` JSON 形式に変更。これにより revelation/pitcrew と同形式になり、ユーザーに毎回見える出力ではなく不可視のコンテキスト注入となる。
2. **セル内パイプ耐性** — manifest の状態列判定を末尾基準に変更。自由記述列（予測内容・有効条件）に `|` が混入しても誤判定しない。

修正後、フックの 4 テストケース（未回収あり / manifest 不在 / 全回収済み / 本文に状態語のみ）を再実行してすべて期待どおり動作確認。コミット `93e0af4`。

### ルート README の配布プラグイン一覧更新

計画書に含まれていなかったが、他プラグインが掲載されていることを確認し、ルート README の配布プラグイン一覧に prefetch を追記。コミット `16bd88b`。

---

## 注意事項

- 計画書 Task 5 の**手動シナリオ 1（正常系）・2（予測ミス系）は実 Claude Code セッションが必要**なため未実施。別プロジェクトで `/plugin marketplace add` → `/plugin prefetch` で導入し、設計承認フローを 1 回回して受け入れ検証を実施予定。検証で問題なければ `-dev` 除去を判断する。
