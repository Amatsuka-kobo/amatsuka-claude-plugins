# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace(`.claude-plugin/marketplace.json`)。
各プラグイン本体は `plugins/*` 配下にあります。詳細はそれぞれの `README/DESIGN` 等を参照してください。

## プラグイン構成

| プラグイン     | 役割                                                                                                                                                            | 主要ディレクトリ                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codiel`       | GitHub issue を取得・分析し、設計→開発→PR 起票→レビューまでを一気通貫で行うオーケストレーター                                                                   | `skills/`(工程別スキル群)、`raguel-mcp/`(ゲーティング用 MCP サーバー / TypeScript)、`agents/`・`commands/`・`hooks/`・`scripts/`、`docs/DESIGN.md` |
| `revelation`   | 上位モデル(Fable 5)の仕事の進め方を、より小さいモデルが再現できるスキルとして提供                                                                               | `skills/`(fable-method / fable-restraint / fable-subagents)、`hooks/`(該当スキルの invoke を促す)                                                  |
| `task-utility` | タスクの進め方を支援するユーティリティ群                                                                                                                        | `skills/`(chat / issue-craft / issue-split)、`agents/`・`hooks/`・`scripts/`                                                                       |
| `basic-design` | 基本設計フェーズの成果物(図4種・API一覧・非機能要件)をブレインストーミングで作成するオーケストレーター付きツール群。図は spec JSON 経由で .drawio / HTML を生成 | `skills/`(入口 basic-design +図種別+Markdown系)、`scripts/`(esbuild バンドル済み CLI)                                                                       |

## Codiel/Raguel の制約(重要)

Codiel と raguel-mcp は **Anthropic API を使用できないユーザーも使える**ことが必須要件。API クライアントの追加・`ANTHROPIC_API_KEY` 前提の実装・ユーザーへの CLI 直接操作の要求は、どれだけ便利に見えても採用しない。LLM が必要な処理は Claude Code の機構(メインセッション/サブエージェント)か `claude` CLI のヘッドレス実行(ユーザーの既存サブスク認証)に閉じる。詳細は `plugins/codiel/docs/DESIGN.md` §0。

## 開発コマンド

ツールチェーンは root の pnpm workspace に集約されている(packages: basic-design / codiel / codiel/raguel-mcp / task-utility / revelation)。すべて root で実行する。

| コマンド | 内容 |
| --- | --- |
| `pnpm build` | 全パッケージの esbuild バンドル生成(`plugins/*/scripts/*.mjs`、`raguel-mcp/dist/server.mjs`) |
| `pnpm test` | vitest で全テスト実行(`plugins/**/__test__/**/*.test.ts`) |
| `pnpm typecheck` | tsc --noEmit(root tsconfig で全パッケージ) |
| `pnpm lint` | biome check |

バンドル出力は git 管理(プラグイン利用者はビルド不要)。ソース(`plugins/*/src/`)を変更したら `pnpm build` を実行し、生成物の差分もコミットすること。

## プラグインのアップデート

プラグインの改修を行った場合、その内容の大きさに応じて、**改修した該当プラグインの** manifest(`plugins/<plugin>/.claude-plugin/plugin.json`)のバージョンを上げるようにしてください。バージョンは各プラグインごとに独立しています。
バージョンは `n1.n2.n3`、プレリリース時は `-alpha.n4` または `-dev` を付けた形式です。ただし自動で行うのはマイナーバージョン(n2 以降 / プレリリース番号)のアップデートのみで、変更の多さからメジャーバージョン(n1)を上げる判断をした場合は、人間に必ず確認するようにしてください。

## chatファイルの運用方針

chat-recorderエージェント / chat-readerエージェント以外は、明示されない限り `docs/chat/**/*.md` を読むことを禁止します。

## エージェント運用方針

<!-- 記入ガイド
エージェント運用方針が記述された2つのファイルを、利用状況によって <agents.md> の部分を変更してください。
Claude Code only -> agents-claude-only.md
Codex 併用時 -> agents-with-codex.md
-->

必ず `agents-with-codex.md` を読み、これに従ってください。
この設定は恒久的なものなので、Claude の設定を更新してください。

## MCPサーバー運用方針

ライブラリやプログラミング言語などの技術スタックの調査は `Context7` を、
リポジトリ内のファイル調査などは `Serena` を頼ってください。
