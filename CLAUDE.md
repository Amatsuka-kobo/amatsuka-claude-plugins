# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace(`.claude-plugin/marketplace.json`)。
各プラグイン本体は `plugins/*` 配下にあります。詳細はそれぞれの `README/DESIGN` 等を参照してください。

## Codiel/Raguel の制約(重要)

Codiel と raguel-mcp は **Anthropic API を使用できないユーザーも使える**ことが必須要件。API クライアントの追加・`ANTHROPIC_API_KEY` 前提の実装・ユーザーへの CLI 直接操作の要求は、どれだけ便利に見えても採用しない。LLM が必要な処理は Claude Code の機構(メインセッション/サブエージェント)か `claude` CLI のヘッドレス実行(ユーザーの既存サブスク認証)に閉じる。詳細は `plugins/codiel/docs/DESIGN.md` §0。

## 開発コマンド

ルートに統一 package.json は無く、ツールチェーンはディレクトリごとに分散している。

| 対象                         | コマンド                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| raguel-mcp(ビルド/テスト/型) | `cd plugins/codiel/raguel-mcp && pnpm build` / `pnpm test`(vitest) / `pnpm typecheck`                                               |
| スクリプト系テスト           | `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs plugins/revelation/hooks/scripts/*.test.mjs` |

## プラグインのアップデート

プラグインの改修を行った場合、その内容の大きさに応じて `.claude-plugins/plugin.json` のバージョンを上げるようにしてください。
ただし自動で行うのはマイナーバージョン(n1.n2.n3 / alpha.n4 の n2以降)のアップデートのみで、変更の多さからメジャーバージョン(n1)を上げる判断をした場合は、人間に必ず確認するようにしてください。

## エージェント運用方針

### オーケストレーション

セッション全体のオーケストレーションを `Fable` で行い、軽い分析・調査は `Opus` に委譲してください。
レビュー・調査・分析など、複雑な作業を伴う場合は `GPT Sol` に委譲してください。

### コーディング

通常のコーディングは `Sonnet` にやらせ、複雑なコーディングは `Opus` にやらせてください。

### その他の作業

基本的に `GPT Terra` にやらせ、軽量かつ大量の作業は `GPT Luna` に、軽量かつ単発 `Haiku` にやらせてください。

### GPTが使えない場合

GPT系のエージェントが利用できない場合は以下の方針で代替してください。
`GPT Sol` -> `Opus`
`GPT Terra` -> `Sonnet`
`GPT Luna` -> `Haiku`

## MCPサーバー運用方針

ライブラリやプログラミング言語などの技術スタックの調査は `Context7` を、
リポジトリ内のファイル調査などは `Serena` を頼ってください。
