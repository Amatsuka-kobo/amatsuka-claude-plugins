# ARCHITECTURE

## システム概要

あまつか工房が開発する Claude Code プラグインを配布する pnpm workspace のモノレポである。利用者は Claude Code のユーザーであり、提供するマーケットプレイスを通じてプラグインを導入する。各プラグインは Claude Code が読む宣言(skills / agents / commands / hooks)と TypeScript ソースを持ち、ソースは esbuild でバンドルして `scripts/` へ出力し git 管理下に置く。Anthropic API を使えないユーザーも全プラグインを使えることを必須要件とし、LLM を要する処理は Claude Code の機構か `claude` CLI のヘッドレス実行に閉じる。開発環境の用意とローカルプロキシの起動はルートの `scripts/` が担い、コードベース探索は Serena MCP が `.serena/` の設定とメモリを通じて担う。

## 技術スタック

| 区分 | 採用技術 |
| --- | --- |
| ランタイム | Node.js >=26 |
| パッケージマネージャ | pnpm 11.8.0 |
| 言語 | TypeScript ^6.0.3 |
| モジュール形式 | ESM |
| バンドラ | esbuild ^0.28.1 |
| スクリプト実行 | tsx ^4.22.4 |
| Lint / Format | @biomejs/biome ^2.5.0 |
| テスト | vitest ^4.1.10 |
| 型定義 | @types/node ^26.0.0 |

- Node.js と pnpm のバージョンは volta で固定する。Node は 26.3.1、pnpm は 11.8.0 とする。
- TypeScript は `strict` と `noEmit` を有効にする。
- esbuild の `target` は node22 に揃える。出力は ESM とし、拡張子は `.mjs` とする。
- 共通の開発依存はルートの `package.json` に置く。
- プラグイン固有のランタイム依存は、そのプラグインの `package.json` に置く。

## レイヤー構造

| 層 | 責務 |
| --- | --- |
| 配布宣言 | プラグインの配布単位・名前・バージョンを宣言する(`.claude-plugin/`) |
| 指示 | AI が読んで従う手順を置く(`skills/` `commands/` `agents/`) |
| 参照 | 複数の指示から共有する規律と断片を置く(`references/`) |
| フック | Claude Code のイベントと実行スクリプトを結びつける(`hooks/`) |
| 配布物 | 実行されるバンドル。単発実行は `scripts/`、常駐プロセスは `dist/` に置く |
| 実装 | 配布物の元になる TypeScript ソース(`src/`) |

依存の許される方向:

- 指示層は参照層を読む。
- 指示層とフック層は配布物層を実行する。
- 実装層はビルドを通じて配布物層を生成する。
- 配布宣言層は他のどの層にも依存しない。

禁止される依存方向:

- 実装層は他プラグインの `src/` を import しない。同じ規則が複数のプラグインに要るときは、各プラグインで独立に実装し、規則を変えたときは同じ規則を持つ全プラグインの実装を追随させる。
- 配布物層を手で編集しない。実装層を変更し、`pnpm run build` で再生成する。
- 指示層と参照層に、リポジトリルート固有のパスや他プラグインの名前を書かない。参照が要る内容は、プラグイン内に閉じた表現へ書き換える。

## ディレクトリ構成と責務

```
.
├── .claude-plugin/marketplace.json  配布するプラグインの一覧を宣言する
├── .claude/rules/metatron/          metatron が管理する規律を置く
├── harness-docs/                    設計書・実装計画書と ARCHITECTURE・GOTCHAS を置く
├── scripts/                         開発環境のセットアップとローカルプロキシの起動スクリプトを置く(言語不問)
├── docs/                            人間向けの文書と会話記録を置く
│   └── prompts/                     別セッションの起動プロンプトを置く
├── .raphael/                        raphael の抗体を置く
├── .serena/                         Serena のプロジェクト設定とメモリを置く
└── plugins/<plugin>/
    ├── .claude-plugin/plugin.json   プラグイン名とバージョンを宣言する
    ├── build.ts                     esbuild のバンドル定義を置く
    ├── src/                         TypeScript ソースを置く
    │   └── __test__/                vitest のテストを置く
    ├── scripts/                     単発実行のバンドル出力を置く
    ├── dist/                        常駐プロセスのバンドル出力を置く
    ├── skills/                      AI が読む手順を置く
    ├── commands/                    スラッシュコマンドの定義を置く
    ├── agents/                      サブエージェントの定義を置く
    ├── hooks/hooks.json             Claude Code のイベントと実行スクリプトの対応を置く
    ├── references/                  複数の指示から共有する規律を置く
    ├── docs/                        設計・背景・経緯・不採用案と、開発時のチェックリストを置く
    ├── evals/                       スキルとエージェント定義の評価セットを置く
    └── README.md                    利用者が読まないと使えない情報を置く
```

- `plugins/codiel/raguel-mcp/` は codiel 内の独立した pnpm workspace であり、MCP サーバーとして `dist/` へ出力する。
- `docs/` は読まない。`docs/chat/` と `docs/prompts/` だけが例外である。
- `docs/chat/**/*.md` は chat-recorder エージェントと chat-reader エージェントだけが読む。
- `docs/prompts/**/*.md` は、依頼文で名指しされたときだけ読む。
- 過去の記録が必要なときは `chat-history:recall` を使う。
- 前回セッションの再開には `chat-history:resume` を使う。

## ドメインマップ

```json metatron:domains
{
  "impl": ["plugins/*/src/**", "plugins/*/build.ts", "plugins/codiel/raguel-mcp/src/**", "plugins/codiel/raguel-mcp/build.ts"],
  "prompt": ["plugins/*/skills/**", "plugins/*/agents/**", "plugins/*/commands/**", "plugins/*/references/**"],
  "bundle": ["plugins/*/scripts/**", "plugins/*/dist/**", "plugins/codiel/raguel-mcp/dist/**"],
  "manifest": [".claude-plugin/**", "plugins/*/.claude-plugin/**", "plugins/*/hooks/**", "package.json", "plugins/*/package.json", "pnpm-workspace.yaml", "tsconfig.json", "biome.json", "vitest.config.ts", "scripts/**"],
  "docs": ["harness-docs/**", "docs/**", "plugins/*/docs/**", "plugins/*/README.md", "README.md", "CLAUDE.md", ".raphael/**", ".serena/**"]
}
```

- `impl` は TypeScript の実装を指す。
- `prompt` は AI が読む指示書を指す。
- `bundle` は手で編集しない。
- `manifest` は配布宣言・ワークスペース設定・環境構築スクリプトを指す。
- `docs` は実行されない資産を指す。人間向けの文書、AI 向けの知識、Serena のメモリ、raphael の抗体を含む。

## コマンド定義

| 種別 | コマンド |
| --- | --- |
| build | `pnpm run build` |
| lint | `pnpm run lint` |
| lint(自動修正) | `pnpm run lint:fix` |
| typecheck | `pnpm run typecheck` |
| test | `pnpm run test` |

- いずれも `pnpm install` が済んでいることを前提とする。
- 初回のセットアップは `bash scripts/setup-workspace.sh` で行う。`pnpm install` と `pnpm run build` をまとめて実行する。
- 単一のプラグインだけをビルドするときは `pnpm --filter <plugin>-scripts build` を使う。

