# basic-design

基本設計フェーズの成果物を、ユーザーとのブレインストーミングで練り上げて生成する Claude Code プラグイン。

- 図(ER図・画面遷移図・システム構成図・シーケンス図)は spec JSON を経由して .drawio / 単一 HTML の 2 形式で生成する
- 設計ドキュメント: `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md`

## 使い方

- **一式まとめて**: 「基本設計を始めたい」→ `basic-design` スキルが概要ブレスト → 成果物選択 → 各スキルを順に実行
- **個別に**: 「ER図を作って」「画面遷移図を作って」「システム構成図を作って」「シーケンス図を作って」「API 一覧を作って」「非機能要件を整理して」→ 各専用スキルが直接発動
- 成果物は `docs/design/<種別>/` に保存される。図は spec JSON(ソース)と .drawio / .html(生成物)のセット
- Google Drive 連携(任意): `.claude/basic-design.local.md` に `drive_folder_id` を設定すると、保存後にアップロードを提案する

## 現在の実装状況

- Stage 1: 変換パイプライン基盤 + ER図スキル
- Stage 2: 画面遷移図・システム構成図・シーケンス図(スキル+レイアウト+両レンダラ対応)
- Stage 3: API/IF 一覧・非機能要件チェックリスト・入口オーケストレーションスキル(basic-design)
- Stage 4: Google Drive アップロード(オプトイン、Drive 系 MCP Tool 経由)

## 開発

テスト: `node --test plugins/basic-design/scripts/*.test.mjs`(リポジトリルートから)
