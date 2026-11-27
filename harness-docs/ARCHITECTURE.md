# ARCHITECTURE

## システム概要

あまつか工房が開発する Claude Code プラグインを、Claude Code のユーザーへマーケットプレイスで配布するモノレポである。各プラグインは Claude Code が読む宣言(skills / agents / commands / hooks)と TypeScript ソースを持ち、ソースは esbuild でバンドルして git 管理下に置く。Anthropic API を使えないユーザーも全プラグインを使えることを必須要件とし、Anthropic API が要る処理は Claude Code の機構か `claude` CLI のヘッドレス実行に閉じる。Anthropic 以外の外部 API は、利用者が環境変数に設定する API キーを前提に必須依存としてよい。ネイティブコードと辞書は、初回に取得して `${CLAUDE_PLUGIN_DATA}` に置いてよい。

## 技術スタック

| 区分 | 採用技術 |
| --- | --- |
| 言語 | TypeScript 6.0(ESM) |
| ランタイム | Node.js 26.12 |

- Node.js と pnpm のバージョンは `mise.toml` で固定する。
- バンドルの出力は ESM、拡張子は `.mjs`、esbuild の target は node22 に揃える。
- 共通の開発依存はルートの `package.json` に、プラグイン固有のランタイム依存はそのプラグインの `package.json` に置く。

## ディレクトリ構成

```
.
├── harness-docs/              設計書・実装計画書と ARCHITECTURE
├── scripts/                   ターミナルで手動実行する ShellScript
├── tools/                     AI がセッション内で使う Python のツール(一時スクリプトを除く)
├── docs/                      人間向けの文書と会話記録
│   └── prompts/               別セッションの起動プロンプト
└── plugins/<plugin>/
    ├── .claude-plugin/        [配布宣言] プラグイン名とバージョン
    ├── skills/ commands/ agents/  [指示] AI が読む手順
    ├── references/            [参照] 複数の指示から共有する規律
    ├── assets/                [参照] 指示層が実行時に読む素材と、Agent 定義へ合成する断片。言語別は assets/<種別>/<言語>/
    ├── hooks/                 [フック] イベントと実行スクリプトの対応
    ├── scripts/ dist/         [配布物] 単発実行は scripts/、常駐プロセスは dist/
    ├── src/                   [実装] TypeScript ソース
    ├── docs/                  設計・経緯・不採用案と、開発時のチェックリスト
    ├── evals/                 スキルとエージェント定義の評価セット
    └── README.md              利用者が読まないと使えない情報
```

- `plugins/codiel/raguel-mcp/` は codiel 内の独立した pnpm workspace で、MCP サーバーとして `dist/` へ出力する。

許される依存方向:

- 指示層は参照層を読む。
- 指示層とフック層は配布物層を実行する。
- 配布物層は、参照層と、同じプラグインの指示層の本文を実行時に読む。
- 実装層はビルドを通じて配布物層を生成する。
- 配布宣言層は他のどの層にも依存しない。

## ドメインマップ

```json metatron:domains
{
  "impl": ["plugins/*/src/**", "plugins/*/build.ts", "plugins/codiel/raguel-mcp/src/**", "plugins/codiel/raguel-mcp/build.ts"],
  "prompt": ["plugins/*/skills/**", "plugins/*/agents/**", "plugins/*/commands/**", "plugins/*/references/**", "plugins/*/assets/**", ".claude/**"],
  "bundle": ["plugins/*/scripts/**", "plugins/*/dist/**", "plugins/codiel/raguel-mcp/dist/**"],
  "manifest": [".claude-plugin/**", "plugins/*/.claude-plugin/**", "plugins/*/hooks/**", "package.json", "plugins/*/package.json", "pnpm-workspace.yaml", "tsconfig.json", "biome.json", "vitest.config.ts", "scripts/**", "tools/**", ".vscode/**", ".github/**"],
  "docs": ["harness-docs/**", "docs/**", "plugins/*/docs/**", "plugins/*/README.md", "README.md", "CLAUDE.md", ".serena/**"]
}
```

## コマンド定義

| 用途 | コマンド | 前提 |
| --- | --- | --- |
| 1 つのプラグインだけをビルドする | `pnpm --filter "./plugins/<plugin>" build` | `pnpm install` 済み |

## テスト方針

- ユニットテストは vitest で書く。E2E テストは持たない。
- テストは対象ソースと同じディレクトリの `__test__/` に `<対象ファイル名>.test.ts` として置く(`src/lib/architecture.ts` のテストは `src/lib/__test__/architecture.test.ts`)。
- 複数のモジュールにまたがる統合テストは、入口のあるディレクトリの `__test__/` に置く。
- 複数のテストから使うヘルパーは `__test__/helpers/` に置き、`.test.ts` を付けない。
- 子プロセスとして起動するエントリポイントと故障注入は `src/testing/` に置く。lint と型検査の対象外にするものは拡張子を `.mjs` にする。
- テストが読み込む固定データは `src/fixtures/` に置く。

## 禁止事項

- 実装層は他プラグインの `src/` を import しない。同じ規則が複数のプラグインに要るときは各プラグインで独立に実装し、規則を変えたら同じ規則を持つ全プラグインの実装を追随させる。
- 指示層と参照層に、リポジトリルート固有のパスや他プラグインの名前を書かない。参照が要る内容は、プラグイン内に閉じた表現へ書き換える。例外は `codiel` `metatron` `gh-utility` の 3 プラグイン同士の言及だけである。
- 配布物層(`plugins/*/scripts/`・`plugins/*/dist/`・`plugins/codiel/raguel-mcp/dist/`)を手で編集しない。`src/` を変更して `pnpm run build` で再生成する。例外は ShellScript で書かれた `plugins/codiel/scripts/install-harness.sh` で、直接編集してよい。
- `.serena/memories/` を直接編集しない。Serena の `write_memory` / `edit_memory` で変更する。
- ネイティブコードと辞書を、バンドル・git・`package.json` に入れない。初回に取得して `${CLAUDE_PLUGIN_DATA}` に置き、取得元の URL と sha256 をコードに固定する。
- ルートの `docs/` は読まない。ただし `docs/chat/**/*.md` は chat-recorder と chat-reader のエージェントだけが読み、過去の記録が要るときは `chat-history:recall`、前回セッションの再開には `chat-history:resume` を使う。`docs/prompts/**/*.md` は依頼文で名指しされたときだけ読む。

## 変更時の追随

- `plugins/*/src/`・`plugins/codiel/raguel-mcp/src/`: `pnpm run build` を実行し、`scripts/` と `dist/` の差分を同じコミットに入れる。
- `plugins/*/.claude-plugin/plugin.json`: 改修したらバージョンを上げる。`package.json` を持つプラグインは `version` を同じ値に揃える。
  - 形式は `x1.x2.x3`(メジャー・マイナー・パッチ)で、開発中は末尾に `-dev` を付け、付けないものはリリース済みである。
  - 改修ではパッチだけを上げる。メジャーとマイナーはユーザーの指示があったときだけ上げる。
  - dev から main にまだ出ていない同じプラグインのバージョンアップがあれば、据え置く。
- `.claude-plugin/marketplace.json`(配布するプラグインの一覧): プラグインを追加・削除するときだけ変える。変えたら対応する `plugins/<plugin>/.claude-plugin/plugin.json` があることを確かめる。
- `plugins/*/hooks/hooks.json`: 全セッションの挙動が変わる。変えたら新しいセッションで発火することを確かめる。
- `pnpm-workspace.yaml`: スクリプトを持つプラグインを追加・削除するときだけ変える。変えたら `pnpm install` を実行し、`pnpm run build` を通す。
- `tsconfig.json`・`biome.json`・`vitest.config.ts`: 全プラグインに影響する。変えたら全プラグインで検査が通ることを確かめる。
- `CLAUDE.md`: 全セッションで読まれる。ARCHITECTURE と内容が重ならないことを確かめる。
- `plugins/metatron/references/architecture-format.md`・`document-boundary.md`・`config-schema.md`・`writing-discipline.md`・`instruction-placement.md`(書式と規則の契約): `plugins/metatron/docs/format-change-checklist.md` の該当セクションの項目をすべて追随させる。`config-schema.md` を変えたら metatron と codiel の独立実装を追随させ、2 者比較テストを通す。
- `plugins/codiel/references/intent-format.md`(intent 文書の書式契約): `plugins/codiel/docs/format-change-checklist.md` の項目をすべて追随させる。
