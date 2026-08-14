# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## ディレクトリ構造

```
.
├── .claude-plugin/marketplace.json  マーケットプレイス定義
├── .claude/                         このリポジトリ用の Claude Code 設定
├── .raphael/antibodies/             Raphael 抗体
├── .serena/                         Serena のプロジェクト設定・メモリ
├── _types/                          Agent・Command・Skill 等の文書型定義
├── docs/                            人間向け文書
├── harness-docs/                    AI 向け文書
├── plugins/<plugin>/                各プラグイン本体
├── scripts/                         リポジトリ共通スクリプト
├── CLAUDE.md                        プロジェクト指示書
├── CLAUDE.local.example.md          CLAUDE.local.md のひな形
├── README.md / ONBOARDING.md / TERMS.md
└── package.json / pnpm-workspace.yaml / biome.json / tsconfig.json / vitest.config.ts
```

- リポジトリルートの `.claude/agents/` は gitignore している。
- GPT / Grok のエージェント定義は各自が `agent-policy:setup-gpt` / `agent-policy:setup-grok` で生成する。
- 共通スクリプトの言語は何でもよい。

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
  
## MCP サーバー運用方針

- ライブラリ・フレームワーク・CLI ツール・APIのドキュメント、コード生成の仕方、セットアップや設定の手順が必要な時は必ず Context7 を使う。
- オーケストレータ―は、Context7 と、Serena のファイル編集を行わない Tools をサブエージェントに付与する。
- オーケストレータ―は、実装担当のサブエージェントにのみ Serena のファイル編集を行う Tools を付与する。

### コードベース探索

コードベース探索を行うときは、必ず Serena を使う。

| 用途 | ツール |
| --- | --- |
| ファイル内のシンボル一覧 | `get_symbols_overview` |
| 名前からシンボルを引く | `find_symbol` |
| 使用箇所から定義へ飛ぶ | `find_declaration` |
| 参照元を探す | `find_referencing_symbols` |
| interface の実装を探す | `find_implementations` |

- Serena が0件を返しても結論にせず、Grep で裏を取る。
- Serena の索引対象外は Grep と Read で読む。

### コーディング

以下の形式のファイルを作成・編集するときは、必ず Serena を使う。

- TypeScript / JavaScript
- Markdown

## プラグイン開発の制約

- このリポジトリのプラグインは **Anthropic API を使用できないユーザーも使える**ことが必須要件。
- API クライアントの追加・`ANTHROPIC_API_KEY` 前提の実装・ユーザーへの CLI 直接操作の要求は採用しない。
- LLM が必要な処理は Claude Code の機構か `claude` CLI のヘッドレス実行に閉じる。
- プラグインが実行するスクリプトは TypeScript で書く。
- ソースは `plugins/*/src/` に置く。
- バンドル出力は `plugins/*/scripts/` に置く。
- server 起動など常駐プロセスを伴うものは `plugins/*/dist/` に置く。
- バンドル出力は git 管理下に置く。
- `plugins/*/src/` を変更したら `pnpm build` を実行し、生成物の差分も同じコミットに含める。
- コミット前に `pnpm lint`・`pnpm typecheck`・`pnpm test` を通す。
- Agents 定義を作成するときは、必ず `prompt-smith:agent-creator` を使う。
- Skills を作成するときは、必ず `prompt-smith:skill-creator` を使う。
- その他 AI 向けの指示書・プロンプトを作成するときは、必ず `prompt-smith:prompt-smith` を使う。

## プラグインの追加

- `.claude-plugin/marketplace.json` に登録する。
- `plugins/<plugin>/.claude-plugin/plugin.json` を作る。
- スクリプトを持つプラグインは `pnpm-workspace.yaml` の `packages` に追記する。

## プラグインのアップデート

- プラグインを追加、または改修したときは、その内容をルートの `README.md` に反映する。
- プラグインを改修したときは、**改修した該当プラグインの** manifest(`plugins/<plugin>/.claude-plugin/plugin.json`)のバージョンを上げる。
- `package.json` を持つプラグインは、`plugins/<plugin>/package.json` の `version` も同じ値に揃える。
- バージョンは `n1.n2.n3`、プレリリース時は `-dev` を付けた形式である。
- 通常はパッチバージョン(n3)を上げる。
- 変更が多い場合はマイナーバージョン(n2)を上げる。
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

## git の運用

- 原則ブランチは切らない。
- ブランチを切る必要があると判断したときは、git worktree を使用する。
