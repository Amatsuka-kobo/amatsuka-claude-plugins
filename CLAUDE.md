# エージェント運用

より賢いモデル(OpusやFable)には調査系・分析系などの考える作業をさせて、それ以外のタスクはSonnet、より軽いタスクはHaikuにやらせてください。

# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace(`.claude-plugin/marketplace.json` + `plugins/*`)。各プラグインの詳細はそれぞれの README/DESIGN を参照。

| プラグイン | 役割 |
| --- | --- |
| `plugins/codiel` | GitHub issue から設計・実装・PR・レビューまでを一気通貫で行うオーケストレーター(+ `raguel-mcp`: 成果物を検査する MCP サーバー) |
| `plugins/revelation` | 上位モデル(Fable5)の振る舞いを下位モデルに再現させるスキル群 |
| `plugins/task-utility` | タスク進行を支援するユーティリティスキル群 |

# Codiel/Raguel の制約(重要)

Codiel と raguel-mcp は **Anthropic API を使用できないユーザーも使える**ことが必須要件。API クライアントの追加・`ANTHROPIC_API_KEY` 前提の実装・ユーザーへの CLI 直接操作の要求は、どれだけ便利に見えても採用しない。LLM が必要な処理は Claude Code の機構(メインセッション/サブエージェント)か `claude` CLI のヘッドレス実行(ユーザーの既存サブスク認証)に閉じる。詳細は `plugins/codiel/docs/DESIGN.md` §0。

# 開発コマンド

ルートに統一 package.json は無く、ツールチェーンはディレクトリごとに分散している。

| 対象 | コマンド |
| --- | --- |
| raguel-mcp(ビルド/テスト/型) | `cd plugins/codiel/raguel-mcp && pnpm build` / `pnpm test`(vitest) / `pnpm typecheck` |
| スクリプト系テスト | `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs` |
