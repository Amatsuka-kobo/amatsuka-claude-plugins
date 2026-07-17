# Marketplace プラグイン紹介

- 日付: 2026-07-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: なし（情報提供のみ）
- 前提: `.claude-plugin/marketplace.json`, `plugins/*/.claude-plugin/plugin.json`, WebSearch 結果（anthropics/claude-plugins-official, code.claude.com/docs, composio.dev, claudemarketplaces.com ほか）

---

## セッション 1: このリポジトリにおすすめのプラグイン

# phyllis998

> このリポジトリにおすすめのプラグインはありますか？

# AI

このリポジトリ自体が Claude Code プラグイン Marketplace（`.claude-plugin/marketplace.json` がプラグイン一覧を宣言）で、`plugins/*` に本体が入る構成。4 つのプラグインを調査し、用途別に紹介した。

**調査内容**:
- Marketplace 定義ファイル（`.claude-plugin/marketplace.json`）の読み込み
- 各プラグインのマニフェスト（`plugins/*/.claude-plugin/plugin.json`）と機能宣言の確認

**紹介したプラグイン**:

1. **codiel** (v0.2.0-dev)
   - GitHub Issue の取得・分析から設計・実装・PR 起票・レビューまで一気通貫でオーケストレーション
   - 提供物: `/init` `/run` `/test` コマンド、13 サブエージェント、18 スキル
   - おすすめの用途: 開発を丸ごと任せたい場合

2. **task-utility** (v0.4.0-dev)
   - 日々のタスク進行支援（会話記録・Issue 運用・セッション再開）
   - スキル: `chat` `chat-recall` `issue-craft` `issue-split` `issue-triage` `resume`
   - おすすめの用途: 普段づかいのユーティリティ、特に会話記録や Issue 管理

3. **basic-design** (v0.6.0-dev)
   - 基本設計フェーズの成果物をブレストで作成（ER 図・画面遷移・システム構成など）
   - スキル: `er-diagram` `screen-flow` `sequence-diagram` `system-architecture` `api-list` `nfr-checklist` ほか
   - おすすめの用途: 設計フェーズの支援のみを行いたい場合（単体でも成熟度が比較的高い）

4. **revelation** (v0.2.0-dev)
   - 上位モデル（Fable 5）の仕事の進め方を、より小さいモデルでも再現できるスキル化
   - スキル: `fable-method` `fable-restraint` `fable-subagents`
   - おすすめの用途: 小さめモデルの仕事の質を底上げしたい場合

**共通の特徴**:
- 全て `-dev`（プレリリース段階）
- CLAUDE.md の必須要件どおり、Anthropic API 不使用・Claude Code 完結で動作
- 提供機構は「スキル / サブエージェント / スラッシュコマンド / フック」の組み合わせ

**導入時の推奨順序**:
単機能で完結する **basic-design** か、日常運用に効く **task-utility** が導入しやすい。実際にこのセッションでも task-utility の chat スキル が有効に機能した。

---

## セッション 2: 公式・サードパーティプラグインの推奨

# phyllis998

> このリポジトリ自体で使うプラグインはtask-utilityだけです。他に、Anthropic公式や、サードパーティーのプラグインなど、まだMarketplaceをこのリポジトリに追加していないものも含めてありませんか？

# AI

プラグイン開発リポジトリにおすすめの公式・サードパーティプラグインを WebSearch で調査。既存環境とのギャップ・制約・参考資料を含めて提案した。

**前提確認**:
CLAUDE.md の「API 不使用」制約は**このリポジトリが出荷するプラグイン**に対する要件で、開発時に使うツール（context7 MCP など既に使用中）には適用されない。開発支援プラグイン追加は問題なし。

**既存環境に入っていると見られるもの**:
スキル一覧から判断する限り、superpowers・plugin-dev・mcp-server-dev・claude-md-management・codex・dataviz など、開発支援系の主要ツールはほぼ揃っている状態。プラグイン開発の土台は揃っている。

**公式マーケットプレイス（`claude-plugins-official`）から追加を推奨するもの**:
- **code-review** — 変更セットに並列エージェントを走らせてバグ・エッジケース・スタイルを検出。CLAUDE.md の「レビューは Sonnet／重いレビューはオーケストレーター」方針と噛み合う
- **pr-review-toolkit** — PR のサマリ〜行レベルレビュー。codiel の PR 起票・レビュー工程を補強
- **security-guidance** — インジェクション/XSS/SSRF/秘密情報露出などを diff からチェック
- **skill-creator** — 公式のスキル作成支援。plugin-dev と役割が近いため既存で足りていれば不要

**まだ追加していない Marketplace で価値のあるもの（手動追加が必要）**:
- **`anthropics/claude-plugins-community`** — Anthropic の自動安全審査を通過した第三者プラグイン群。SHA 固定で公式に次いで信頼度が高い。プラグイン開発の参考・実装ネタ探しに最適
- **`wshobson/agents`**（約 37k stars）— 専門特化サブエージェント一大ソース。多数のレビュアー/実装エージェント構成を設計する際の参考実装として価値大。ただし**無審査**なので「読んで学ぶ」用途を推奨
- **`anthropics/claude-code`（demo marketplace）** — プラグイン機構でできることの公式サンプル集。marketplace.json やフック/スキルの書き方の参照に

**調査・発見用ディレクトリ（install ではなく参考用）**:
- **claudemarketplaces.com** / **aitmpl.com** — 日次更新のコミュニティディレクトリ。既存プラグインの構成を横断的に調べ、リポジトリ内 4 プラグインの差別化を考えるのに使える

**セキュリティ注意**:
プラグインはユーザーの権限で任意コードを実行する。公式・community は審査ありだが、`wshobson/agents` 等の無審査ソースはメンテナを直接信頼することになる。シェル実行や外部接続を伴うものは、依存ライブラリと同様に**中身をレビューしてから**有効化すること。

**まとめ**:
すぐ足すなら公式の `code-review` / `pr-review-toolkit`、設計の参考に `anthropics/claude-plugins-community` と `wshobson/agents` を Marketplace 追加、が費用対効果が高い組み合わせ。

---

注意事項: なし
