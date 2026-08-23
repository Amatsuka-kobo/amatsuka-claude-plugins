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
├── harness-docs/                    設計書・実装計画書と ARCHITECTURE・GOTCHAS を置く
├── scripts/                         開発環境のセットアップとローカルプロキシの起動スクリプトを置く(言語不問)
├── docs/                            人間向けの文書と会話記録を置く
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
- `docs/` は読まない。
- `docs/chat/**/*.md` は chat-recorder エージェントと chat-reader エージェントだけが読む。
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

## テスト方針

- ユニットテストは vitest で書く。E2E テストは持たない。
- テストは対象ソースと同じディレクトリの `__test__/` に置く。`src/lib/adr.ts` のテストは `src/lib/__test__/adr.test.ts` とする。
- テストファイル名は `<対象ファイル名>.test.ts` とする。複数のモジュールにまたがる統合テストは、入口のあるディレクトリの `__test__/` に置く。
- 複数のテストから使うヘルパーは `__test__/helpers/` に置き、`.test.ts` を付けない。
- 子プロセスとして起動するエントリポイントと故障注入は `src/testing/` に置く。lint と型検査の対象外にするものは拡張子を `.mjs` にする。
- テストが読み込む固定データは `src/fixtures/` に置く。
- vitest が拾うのは `plugins/**/__test__/**/*.test.ts` だけである。この外に置いたテストは実行されない。
- 実行環境は node、プロセス分離は forks、タイムアウトは 20 秒とする。

## 保護パス

### 触らないパス

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` — Edit / Write / NotebookEdit は metatron の hook が拒否する。ARCHITECTURE の更新は `stage-architecture` → `commit-architecture`、ADR は `stage-adr` → `commit-architecture`、GOTCHAS の追記は `append-gotcha`、タグ付けは `tag-gotcha` を使う。
- `plugins/*/scripts/` と `plugins/*/dist/` — バンドル出力。対応する `src/` を変更し、`pnpm run build` で再生成する。
- `.raphael/antibodies/` — 抗体の更新は `plugins/raphael/scripts/update-antibody.mjs` で行う。一覧と詳細の取得は `plugins/raphael/scripts/list-antibodies.mjs` を使う。適用の前に `patch --dry-run` で変更後を確認する。
- `.serena/memories/` — Serena の `write_memory` / `edit_memory` で変更する。

### 変更に慎重を要するパス

- `.claude-plugin/marketplace.json` — プラグインを追加または削除するときだけ変更する。変更後、対応する `plugins/<plugin>/.claude-plugin/plugin.json` があることを確認する。
- `plugins/*/.claude-plugin/plugin.json` — プラグインを改修したらバージョンを上げる。`package.json` を持つプラグインは `version` を同じ値に揃える。バージョンは `n1.n2.n3` の形式とし、プレリリースは `-dev` を付ける。通常はパッチ(n3)を上げ、変更が多いときはマイナー(n2)を上げる。自動で上げるのはマイナーまでとし、メジャー(n1)を上げるときは人間に確認する。
- `plugins/*/hooks/hooks.json` — 全セッションの挙動が変わる。変更後、新しいセッションで発火することを確認する。
- `pnpm-workspace.yaml` — スクリプトを持つプラグインを追加したときに追記する。
- `tsconfig.json` と `biome.json` と `vitest.config.ts` — 全プラグインに影響する。変更後 `pnpm run typecheck` と `pnpm run lint` と `pnpm run test` をすべて通す。
- `CLAUDE.md` — 全セッションに注入される。ARCHITECTURE と内容が重ならないことを確認する。
- `plugins/metatron/references/architecture-format.md` と `gotchas-format.md` と `config-schema.md` — 書式と規則の契約。変更したら `plugins/metatron/docs/format-change-checklist.md` の該当節の項目をすべて追随させる。`config-schema.md` を変更したときは 3 プラグインの独立実装を追随させ、3 者比較テストを通す。
- `plugins/sandalphon/references/intent-format.md` — intent 文書の書式契約。変更したら `plugins/sandalphon/docs/format-change-checklist.md` の項目をすべて追随させる。

## 規約

### 探索と編集

- コードベースの探索は Serena のシンボルツールで行う。0 件でも結論にせず Grep で裏を取る。
- TypeScript / JavaScript / Markdown の作成と編集は Serena の編集ツールで行う。
- ライブラリ・フレームワーク・CLI・API の仕様、セットアップ手順、コード生成の方法が要るときは Context7 で取る。Web 検索より優先する。

### プラグイン開発

- Anthropic API のクライアントを追加しない。`ANTHROPIC_API_KEY` を前提にした実装をしない。ユーザーに CLI の直接操作を要求しない。LLM が必要な処理は Claude Code の機構か `claude` CLI のヘッドレス実行で行う。
- プラグインが実行するスクリプトは TypeScript で書く。
- Agents 定義は `prompt-smith:agent-creator` で作る。
- Skills は `prompt-smith:skill-creator` で作る。
- その他の AI 向け指示書は `prompt-smith:prompt-smith` で作る。
- プラグインを追加するときは `.claude-plugin/marketplace.json` に登録し、`plugins/<plugin>/.claude-plugin/plugin.json` を作る。スクリプトを持つプラグインは `pnpm-workspace.yaml` の `packages` に追記する。

### 文書配置

- 利用者が読まないと使えない情報は `plugins/<plugin>/README.md` に置く。
- 設計・背景・根拠・経緯・不採用案が必要な時は `plugins/<plugin>/docs/` に置く。
- 複数のスキルとエージェントで共有する規律と参照断片は `plugins/<plugin>/references/` に置く。
- 設計書と実装計画書は `harness-docs/` に置く。

### git

- ブランチを切らない。切る必要があると判断したときは git worktree を使う。
- `git push` に `--force` / `-f` / `--force-with-lease` / `--force-if-includes` を付けない。hook が拒否する。履歴を書き換えずに済む方法を取る。

### Done の条件

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通る。
- `plugins/*/src/` を変更したなら `pnpm run build` を実行し、`plugins/*/scripts/` の差分が同じコミットにある。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが揃って上がっている。
- プラグインを追加または改修したなら、ルートの `README.md` に反映されている。
- ARCHITECTURE に影響する変更をしたなら、`/metatron:update` で追随させている。
- 改修した内容が `.serena/memories/` の記述と食い違うなら、該当メモリを更新している。
