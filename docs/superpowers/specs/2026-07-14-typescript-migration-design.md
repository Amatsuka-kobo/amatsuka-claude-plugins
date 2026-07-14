# リポジトリ全体の JavaScript → TypeScript 移行 設計書

日付: 2026-07-14
ステータス: ユーザー承認済み(実装計画作成前)

## 目的

リポジトリ内のすべての手書き JavaScript(`.mjs`)を TypeScript に移行し、分散しているツールチェーン設定(tsconfig / pnpm / biome / vitest)を root に集約する。プラグインごとにバラバラだったビルド・テスト・型チェックのパターンを統一し、root からの一発実行を可能にする。

## 決定事項(ユーザー確認済み)

| 論点 | 決定 |
| --- | --- |
| raguel-mcp の扱い | 現状維持。`dist/server.mjs` 出力と `.mcp.json` 参照は変えない |
| `__test__` の粒度 | 各ディレクトリ隣接。例: `src/rules/code/__test__/maxDiffLines.test.ts` |
| .mjs スクリプトのソース配置 | 各プラグインの `src/` に集約(basic-design と同じ src → scripts パターン) |
| hooks 用バンドルの出力先 | `scripts/` に統一。hooks.json のパスを書き換え、`hooks/scripts/` は廃止 |
| テスト基盤 | 全部 vitest に統一。`node:test` / `node:assert` は書き換える |
| tsconfig / vitest 構成 | 案A: root 単一 tsconfig(型チェック専用)+ root 集中 vitest |
| 最低 Node バージョン | Node 26 に統一。esbuild target を node26 に上げ、`@types/node@26` / volta / root の `engines` を揃える |

## 1. workspace 構成

```
amatsuka-claude-plugins/
├── package.json          ← root(共通 devDependencies + 統一コマンド)
├── pnpm-workspace.yaml   ← 下記5パッケージを登録
├── pnpm-lock.yaml        ← root に1本化(各プラグイン配下の lock / pnpm-workspace.yaml は削除)
├── tsconfig.json         ← 単一。noEmit 前提(型チェック専用)、outDir/rootDir なし
├── biome.json            ← raguel-mcp の biome.json を root へ移動し全体に適用
└── vitest.config.ts      ← 単一。include: plugins/**/__test__/**/*.test.ts、environment: node
```

workspace パッケージ(5つ):

- `plugins/basic-design`
- `plugins/codiel`
- `plugins/codiel/raguel-mcp`
- `plugins/task-utility`
- `plugins/revelation`

依存の配置:

- 共通 devDeps は root に集約: `typescript` / `vitest` / `esbuild` / `tsx` / `@biomejs/biome` / `@types/node`
- ランタイム依存は各パッケージに残す: basic-design の `elkjs`、raguel-mcp の `@modelcontextprotocol/sdk` / `picomatch` / `yaml` / `zod`(+ `@types/picomatch`)

root の scripts:

- `pnpm build` → `pnpm -r build`(各パッケージの esbuild 実行)
- `pnpm test` → `vitest run`(root config で全パッケージ)
- `pnpm typecheck` → `tsc --noEmit`(root tsconfig で全パッケージ)
- `pnpm lint` → `biome check .`

tsconfig の方針: 既存2つの tsconfig(basic-design / raguel-mcp)はほぼ同一内容(target esnext / module esnext / moduleResolution bundler / strict / isolatedModules)。これを root に1つ化し、`outDir` / `rootDir` を外して `noEmit: true` にする(出力は esbuild 担当)。include は glob で明示する(`plugins/*/src/**/*.ts`、`plugins/*/build.ts`、`plugins/codiel/raguel-mcp/src/**/*.ts`、`plugins/codiel/raguel-mcp/build.ts`)。exclude に `**/node_modules`、`plugins/*/scripts`、`plugins/codiel/raguel-mcp/dist` を明示。`moduleDetection: "force"` を指定し、単一 program 内でのグローバル宣言衝突を防ぐ。

単一 tsconfig はパッケージ境界を検査しないため、**プラグイン間のソース直接 import は禁止**(レビューで担保)。

Node バージョン: **Node 26 に統一**する。esbuild target を `node26` に上げ、`@types/node@26` を維持、volta / root package.json の `engines` も Node 26 に揃える。

biome の設定: `files.includes` の対象を TS 中心にし、生成物(`plugins/*/scripts/**/*.mjs`、`plugins/codiel/raguel-mcp/dist`)と `node_modules` を除外する。

pnpm-workspace.yaml: glob ではなく5パスを明示列挙する。全パッケージの `name` を一意にし、`private: true` を付ける(npm publish しない)。root 自身も pnpm 上は project になるため、表示上は root + 5 packages の6 project になる。

## 2. 各プラグインの構造

### codiel(バンドルエントリ5つ)

```
plugins/codiel/
├── package.json    ← workspace パッケージ。build スクリプトのみ
├── build.ts        ← esbuild。5エントリ → scripts/ へ .mjs バンドル出力
├── src/
│   ├── hooks/
│   │   ├── guard-bash.ts / guard-write.ts / stop-guard.ts / subagent-stop.ts / lib.ts
│   │   └── __test__/(guard-bash / guard-write / stop-guard / lib の .test.ts)
│   ├── codiel-state.ts        ← ライブラリ本体(hooks から import。バンドル時は各 hook に inline)
│   ├── codiel-state-cli.ts    ← CLI エントリ(main() を呼ぶだけ。出力名は scripts/codiel-state.mjs)
│   └── __test__/
│       ├── codiel-state.test.ts
│       └── install-harness.test.ts  ← bash スクリプトのテスト。SCRIPT 参照を ../../scripts/install-harness.sh に修正
├── scripts/        ← バンドル出力(git 管理)+ install-harness.sh(手書き shell、現状のまま)
│   ├── guard-bash.mjs / guard-write.mjs / stop-guard.mjs / subagent-stop.mjs
│   ├── codiel-state.mjs
│   └── install-harness.sh
├── hooks/hooks.json ← 参照を ${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs に書き換え
└── raguel-mcp/      ← §3 参照
```

バンドルエントリ: `guard-bash` / `guard-write` / `stop-guard` / `subagent-stop` / `codiel-state`。
`codiel-state` は hooks から import されるライブラリであると同時に、SKILL.md から `node scripts/codiel-state.mjs <cmd>` として直接実行される CLI でもあるため、単独エントリとして残す。エントリごとのバンドルで hooks 側に codiel-state のコードが inline 重複するが、hooks は各々別 Node プロセスで起動し状態は JSON ファイル経由で共有されるため動作に影響しない(code splitting や external 化はせず自己完結バンドルを維持する)。

**重要 — ライブラリと CLI エントリの分離**: 現在の `codiel-state.mjs` は末尾に `if (import.meta.url === file://${process.argv[1]}) main(...)` という CLI 自動起動判定を持つ。esbuild で hook に inline されるとこの `import.meta.url` は hook バンドルの URL になり、**hook 起動時に codiel-state の `main()` が誤発火する**(esbuild 0.28.1 で再現確認済み)。対策として:

- `src/codiel-state.ts` — ライブラリ本体。トップレベルの CLI 起動判定を置かない
- `src/codiel-state-cli.ts` — `main()` を呼ぶだけの薄い CLI エントリ。バンドル出力名は従来どおり `scripts/codiel-state.mjs`
- hooks はライブラリ側(`codiel-state.ts`)だけを import する

### task-utility(バンドルエントリ6つ)

```
plugins/task-utility/
├── package.json / build.ts
├── src/
│   ├── hooks/
│   │   ├── check-chat-recorded.ts
│   │   └── __test__/check-chat-recorded.test.ts
│   ├── check-issue-env.ts / extract-conversation.ts / find-chat-records.ts
│   ├── link-sub-issue.ts / list-issues.ts
│   └── __test__/(上記5つの .test.ts)
├── scripts/   ← 6 バンドル出力
└── hooks/hooks.json ← scripts/check-chat-recorded.mjs 参照に書き換え
```

### revelation(バンドルエントリ2つ)

```
plugins/revelation/
├── package.json / build.ts
├── src/
│   ├── inject-trigger-map.ts / remind-skill.ts / lib.ts
│   └── __test__/(inject-trigger-map / remind-skill / lib の .test.ts)
├── scripts/   ← inject-trigger-map.mjs / remind-skill.mjs
└── hooks/hooks.json ← scripts/*.mjs 参照に書き換え
```

**注意 — `import.meta.url` 基準のリソースパス**: revelation の現行スクリプトは `import.meta.url` 起点の相対パスでリソースを参照している(`inject-trigger-map` の `../trigger-map.md`、`remind-skill` の `../..` 等)。出力先が `hooks/scripts/` から `scripts/` に変わるため、これらの相対パスは**プラグインルート起点で解決し直す**。幸い新配置では `src/` と `scripts/` が同じ深さ(プラグイン直下)なので、`new URL("../hooks/trigger-map.md", import.meta.url)` のような相対パスが `tsx src/*.ts` 実行時と `node scripts/*.mjs` 実行時の両方で同一リソースを指す。移行時に `import.meta.url` を使う全箇所を洗い出し、両実行パスで検証すること。

### basic-design(既に src → scripts パターン)

- `tsconfig.json` / `vitest.config.ts` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` を削除(root に統合)
- テストを各ディレクトリ隣接の `__test__/` へ移動(例: `src/layout/__test__/graph.test.ts`)
- `build.ts` は現状のままパッケージ直下
- package.json から共通 devDeps を除去(`elkjs` は残す)

## 3. raguel-mcp(現状維持+最小限の整合)

- `dist/server.mjs` 出力と `.mcp.json` 参照は不変
- `tsconfig.json` / `biome.json` / `vitest.config.ts` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` を削除し root に統合
- ビルドスクリプトを `scripts/build.ts` → パッケージ直下の `build.ts` へ移動(他プラグインとパターン統一)。banner の createRequire 対応は現状のまま維持
- テストを各ディレクトリ隣接の `__test__/` へ移動(例: `src/rules/code/__test__/maxDiffLines.test.ts`)。import パスの階層を1つ調整(例: 同ディレクトリ参照 `./maxDiffLines.js` → `../maxDiffLines.js`、上位参照 `../testHelpers.js` → `../../testHelpers.js`)
- `src/panel/testing/fake-claude.mjs` は例外として .mjs のまま残す。テスト(claudeCli.test.ts 等)が node プロセスとして直接 spawn する実行フィクスチャであり、TS 化するとテスト実行前にビルドが必要になるため
- package.json から共通 devDeps を除去(ランタイム依存と `@types/picomatch` は残す)
- package.json の `main` を `dist/server.js` → `dist/server.mjs` に修正(実出力と一致させる)

## 4. テスト移行

- codiel / task-utility / revelation の `node:test` + `node:assert` 製テスト(計14ファイル)を vitest の `describe` / `it` / `expect` に書き換える
  - `assert.strictEqual(a, b)` → `expect(a).toBe(b)`、`assert.match(s, re)` → `expect(s).toMatch(re)` 等の機械的変換が主
  - `assert.deepStrictEqual` は `toStrictEqual` に変換する(`toEqual` はプロトタイプ・undefined プロパティの判定が緩く非等価)。`assert.doesNotMatch` は `not.toMatch`
  - 子プロセス spawn でスクリプトを実行するテストは、spawn 対象をバンドル後の `scripts/*.mjs` ではなく **ソースを tsx 経由で実行するか、`src/` の関数を直接 import する形**に書き換える(ビルド前でもテストが通るようにするため)。判断基準: exit code や stdout/stderr の検証が本質のテスト(hooks の入出力契約など)は tsx 経由 spawn(`cwd` / 環境変数 / stdin / 期待 exit code を明示)、関数の戻り値検証で足りるテストは直接 import
  - 直接 import するモジュールは、トップレベル副作用(`process.exit()` を呼ぶ CLI 起動等)を持たないこと(§2 の codiel-state 分離と同じ原則)
  - パス変換は `new URL(...).pathname` ではなく `fileURLToPath` を使う(空白を含むパスでの誤動作回避)
- root の vitest.config.ts で `pool: "forks"` を明示する。raguel-mcp のテストが `process.chdir()` を使っており、将来 vitest のデフォルト pool が worker threads に変わると壊れるため
- 既存 vitest テスト(basic-design / raguel-mcp)は `__test__/` への移動と import パス調整のみ
- `install-harness.test.ts` は bash スクリプト(`scripts/install-harness.sh`)の検証テスト。`import.meta.url` 起点の SCRIPT パスを移動後の位置関係(`src/__test__/` → `scripts/`)に合わせて修正
- 移行後、root の `pnpm test` 一発で全テストが実行される

### 配布物の検証(2層テスト)

ソーステスト(tsx / 直接 import)だけでは「git 管理されたバンドルが古いまま」でも `pnpm test` が通ってしまう。以下の2層に分ける:

1. **通常の `pnpm test`** — ソース対象。ビルド前でも実行可能
2. **配布物検証** — `pnpm build` 実行後、(a) バンドル済み hook / CLI / MCP サーバーの起動 smoke test(basic-design の cli.test.ts 相当は既にこの性質を持つ)、(b) 生成物に未コミット差分がないことの検査(`git diff --exit-code plugins/*/scripts plugins/codiel/raguel-mcp/dist`)。これを移行完了の受け入れ手順および今後の開発フローに組み込む

## 5. パス参照の更新と後処理

- hooks.json 3ファイル(codiel / task-utility / revelation)の参照を `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs` に書き換え
- SKILL.md / agents / commands の `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs` 参照は既に scripts/ 指しのため変更不要(バンドル出力が同名で置かれる)
- 旧ソースは TS 化+バンドル出力+テスト通過を確認後に削除する。削除対象一覧:
  - `plugins/codiel/hooks/scripts/*.mjs`(テスト含む全ファイル。ディレクトリごと廃止)
  - `plugins/codiel/scripts/codiel-state.mjs` / `codiel-state.test.mjs` / `install-harness.test.mjs`(codiel-state.mjs はバンドル出力で同名上書きされるため、実際に消すのはテスト2つ)
  - `plugins/task-utility/hooks/scripts/*.mjs`、`plugins/task-utility/scripts/*.test.mjs`(非テスト .mjs はバンドル出力で同名上書き)
  - `plugins/revelation/hooks/scripts/*.mjs`(ディレクトリごと廃止)
  - 各プラグイン配下の `tsconfig.json` / `vitest.config.ts` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `biome.json`(root に統合)
  - `plugins/codiel/raguel-mcp/scripts/build.ts`(パッケージ直下へ移動)
- 各プラグインの `.gitignore` 相当の調整は不要(バンドル出力は従来どおり git 管理)
- CLAUDE.md の「開発コマンド」表を root 統一コマンド(`pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint`)に更新
- plugin.json のマイナーバージョンを上げる:
  - basic-design: 0.5.0-dev → 0.6.0-dev
  - codiel: 0.3.0-dev → 0.4.0-dev
  - task-utility / revelation: 0.1.0-dev → 0.2.0-dev

## 制約・注意事項

- **Codiel/Raguel の必須要件**(CLAUDE.md / DESIGN.md §0): Anthropic API 前提の実装は不可。本移行はツールチェーンの変更のみで、この制約に抵触しない
- hooks / スクリプトの実行環境は「ユーザーの素の node」。バンドル済み `.mjs` は依存を含めて自己完結していること(esbuild bundle: true)
- codiel の `scripts/` には手書きの `install-harness.sh` が同居するため、esbuild の `emptyOutdir` 等で出力先を全消しする設計にしない
- バンドル出力(`scripts/*.mjs`、`raguel-mcp/dist/server.mjs`)は git 管理を継続する。プラグイン利用者はビルドせずに使えることが前提
- テスト・型チェック・ビルドがすべて通ることを移行完了の条件とする

## 成功基準

1. 手書きのソース `.mjs` が 0 になる。「手書き」= `src/` 外にあり esbuild の出力ではないもの。許容される `.mjs` は (a) esbuild バンドル出力(`plugins/*/scripts/*.mjs`、`raguel-mcp/dist/server.mjs`)と (b) 実行フィクスチャ `raguel-mcp/src/panel/testing/fake-claude.mjs` のみ
2. root で `pnpm install` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint` がすべて成功する
3. `pnpm build` 直後に生成物の git 差分がない(`git diff --exit-code plugins/*/scripts plugins/codiel/raguel-mcp/dist`)
4. 各プラグインの hooks / skills / MCP サーバーが従来どおり動作する(hooks.json / .mcp.json / SKILL.md の参照パスが有効。バンドル済み hook / CLI / MCP サーバーの起動 smoke test で確認)
5. §5 の削除対象一覧のファイルがすべて削除されている
