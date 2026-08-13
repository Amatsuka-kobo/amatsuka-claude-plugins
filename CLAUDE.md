# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace(`.claude-plugin/marketplace.json`)。
各プラグイン本体は `plugins/*` 配下にある。

## 環境とコマンド

Node は `>=26`、パッケージマネージャは pnpm `11.8.0` を使う。


| コマンド             | 用途                                                            |
| ---------------- | ------------------------------------------------------------- |
| `pnpm build`     | 全プラグインのバンドル(`pnpm -r build`。各プラグインの `build.ts` を `tsx` で実行する) |
| `pnpm lint`      | biome によるチェック                                                 |
| `pnpm typecheck` | `tsc --noEmit`                                                |
| `pnpm test`      | vitest                                                        |


## プラグインの構成

```
plugins/<plugin>/
  .claude-plugin/plugin.json  manifest(name・version)
  package.json                private パッケージ。name は `<plugin>-scripts`
  build.ts                    バンドル定義(esbuild)
  src/                        TypeScript ソース
  scripts/                    バンドル出力(git 管理)
  skills/ commands/ agents/ hooks/
  README.md docs/ references/
```

- リポジトリルートの `.claude/agents/` は gitignore している。GPT / Grok のエージェント定義は各自が `agent-policy:setup-gpt` / `agent-policy:setup-grok` で生成する。
- `.claude/agents/` が空でも構成ミスではない。

## プラグイン開発の制約(重要)

- このリポジトリのプラグインは **Anthropic API を使用できないユーザーも使える**ことが必須要件。
- API クライアントの追加・`ANTHROPIC_API_KEY` 前提の実装・ユーザーへの CLI 直接操作の要求は採用しない。
- LLM が必要な処理は Claude Code の機構か `claude` CLI のヘッドレス実行に閉じる。
- プラグインが実行するスクリプトは TypeScript で書く。
- ソースは `plugins/*/src/` に置く。
- バンドル出力は `plugins/*/scripts/` に置く。
- server 起動など常駐プロセスを伴うものは `plugins/*/dist/` に置く。
- リポジトリ運用のためのスクリプト(ルートの `scripts/`)は言語を問わない。
- バンドル出力は git 管理下に置く。
- `plugins/*/src/` を変更したら `pnpm build` を実行し、生成物の差分も同じコミットに含める。
- コミット前に `pnpm lint`・`pnpm typecheck`・`pnpm test` を通す。
- SKILL.md の本文・その他の AI 向け指示書は `prompt-smith:prompt-smith` の基準で書く。

## プラグインの追加

- `.claude-plugin/marketplace.json` に登録する。
- `plugins/<plugin>/.claude-plugin/plugin.json` を作る。
- スクリプトを持つプラグインは `pnpm-workspace.yaml` の `packages` に追記する。手動列挙のため、追記しなければ `pnpm build` の対象にならない。

## プラグインのアップデート

- プラグインを追加、または改修したときは、その内容をルートの `README.md` に反映する。
- プラグインを改修したときは、**改修した該当プラグインの** manifest(`plugins/<plugin>/.claude-plugin/plugin.json`)のバージョンを上げる。
- `package.json` を持つプラグインは、`plugins/<plugin>/package.json` の `version` も同じ値に揃える。
- バージョンは `n1.n2.n3`、プレリリース時は `-dev` を付けた形式である。
- 軽量の変更はパッチバージョン(n3)を上げる。
- それ以外の変更はマイナーバージョン(n2)を上げる。
- 自動で上げるのはマイナーバージョンまでとする。
- メジャーバージョン(n1)を上げる判断をしたときは、人間に確認する。

## 文書配置の運用方針

- プラグインの利用者が読まなければそのプラグインを使えない情報は `plugins/<plugin>/README.md` に置く。
- それ以外の人間向け文書(設計・背景・根拠・経緯・不採用案)は `plugins/<plugin>/docs/` に置く。
- AI が必要なときにだけ読む文書(複数のスキル・エージェントで共有する規律、参照断片)は `plugins/<plugin>/references/` に置く。

## chat ファイルの運用方針

- `docs/chat/**/*.md` は chat-recorder エージェント / chat-reader エージェントだけが読む。
- 過去の記録が必要なときは `chat-history:recall` を使う。
- 前回セッションの再開には `chat-history:resume` を使う。

## MCP サーバー運用方針

- ライブラリ・フレームワーク・CLI ツール・APIのドキュメント、コード生成の仕方、セットアップや設定の手順が必要な時は必ず Context7 を使う。

