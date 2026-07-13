# basic-design

基本設計フェーズの成果物を、ユーザーとのブレインストーミングで練り上げて生成する Claude Code プラグイン。

- 図(ER図・画面遷移図・システム構成図・シーケンス図)は spec JSON を経由して .drawio / 単一 HTML の 2 形式で生成する
- 設計ドキュメント: `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md`

## 現在の実装状況

- Stage 1: 変換パイプライン基盤 + ER図スキル
- Stage 2: 画面遷移図・システム構成図・シーケンス図(スキル+レイアウト+両レンダラ対応)
- Stage 3: API/IF 一覧・非機能要件チェックリスト・入口オーケストレーションスキル(basic-design)

## 開発

テスト: `node --test plugins/basic-design/scripts/*.test.mjs`(リポジトリルートから)
