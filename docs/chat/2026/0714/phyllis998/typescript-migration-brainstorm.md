# TypeScript 移行 設計ブレインストーミング

- 日付: 2026-07-14
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `docs/superpowers/specs/2026-07-14-typescript-migration-design.md`（コミット 909727c、aeef20f）、`docs/superpowers/plans/2026-07-14-typescript-migration.md`（コミット 29dc900、e7f315b）
- 前提: CLAUDE.md、agents-with-codex.md、plugins/ 配下の各プラグイン構成

---

## セッション 1: 要件確認と現状調査

### phyllis998

> このリポジトリ内のすべてのJavaScriptをTypeScriptに変えたいです。tsconfig.json/pnpm-lock.yaml/pnpm-workspace.yaml/package.json/biome.json/vitest.config.tsはrootに置き、すべてのtestファイルを適切な場所の__test__フォルダ下に納めたいです。TypeScriptを含むプラグイン本体をpnpm-workspaceにpackageとして登録します。esbuildのビルドスクリプトは各プラグイン直下に置きたいです。esbuildでバンドルされたjsファイルは、各プラグインフォルダのscriptsフォルダに置きたいです。

要件を整理すると：
- 全 JavaScript → TypeScript 変更
- ツールチェーン設定（tsconfig.json、pnpm-lock.yaml、pnpm-workspace.yaml、package.json、biome.json、vitest.config.ts）は root に一元化
- テストファイルは各場所の `__test__/` フォルダに集約
- プラグイン本体を pnpm-workspace に package として登録
- esbuild ビルドスクリプトは各プラグイン直下
- esbuild でバンドルされた js ファイルは各プラグインの `scripts/` フォルダ配置

### AI

ブレインストーミングスキルに従い、リポジトリの現状（JS/TS ファイルの分布、既存ツールチェーン構成）を調査。

確認した既存設定：
- `plugins/basic-design`：既存 TypeScript パッケージ（package.json、tsconfig.json、build.ts、vitest.config.ts あり）
- `plugins/codiel/raguel-mcp`：MCP サーバー、TypeScript、`dist/server.mjs` 出力、`.mcp.json` が参照
- `plugins/codiel`、`plugins/task-utility`、`plugins/revelation`：スクリプトとスキル定義は `.mjs`
- hooks.json の `.mjs` 参照パターン、skills/commands/agents の cross-import、gitignore の bundled outputs、プラグインバージョン、script size

複数の質問を通じ、ユーザーの判断基準（スコープ、優先順位、トレードオフ許容度）を確認。

## セッション 2: アプローチ提案

### AI

ブレインストーミングの結論と設計案の提示。

**workspace パッケージ（確定）**: `plugins/basic-design`、`plugins/codiel`、`plugins/codiel/raguel-mcp`、`plugins/task-utility`、`plugins/revelation` の5つ

**方針（確定）**:
- raguel-mcp は現状維持（`dist/server.mjs` 出力、`.mcp.json` 参照のまま）
- 各プラグインは `src/` にソース集約
- テストは各ディレクトリ隣接の `__test__/`
- バンドル済み出力は `scripts/` へ配置
- hooks.json は `scripts/` 参照に書き換え
- テストは vitest に統一

**tsconfig/ビルド構成の3案**：

**案A: root 単一 tsconfig + root 集中 vitest（推奨）**
- root の `tsconfig.json` 1つで全パッケージの `src/**` を型チェック（`tsc --noEmit`）
- root の `vitest.config.ts` に projects(旧 workspace)設定で全パッケージのテストを列挙
- 各プラグイン直下には `build.ts`（esbuild）と最小限の `package.json`（name / dependencies）のみ
- 利点：設定ファイルが root に集約（ユーザー要望に文字どおり一致）、`pnpm typecheck` / `pnpm test` / `pnpm -r build` が root から一発実行可能、設定の重複ゼロ
- 欠点：パッケージごとに型設定を変えたくなったときの柔軟性が低い（ただし現状2つの tsconfig はほぼ同一内容なので実害なし）

**案B: root ベース tsconfig + 各パッケージで extends**
- root に `tsconfig.base.json`、各パッケージに `tsconfig.json`（extends + include）
- vitest は root 1つ
- 利点：パッケージ単位の独立性が高く、エディタの型解決も確実
- 欠点：「tsconfig.json は root に置く」という要望から半歩ずれる、ファイル数が増える

**案C: TypeScript Project References**
- root tsconfig から references で各パッケージを繋ぎ、`tsc --build` でインクリメンタルビルド
- 利点：大規模モノレポの正攻法
- 欠点：リポジトリ規模（実装ソース計約3,500行の .mjs + 既存 TS）に過剰、esbuild でバンドルするので tsc の出力は不要（references の恩恵が薄い）

**推奨理由（案A）**：パッケージ数5・設定がほぼ同質・tsc は型チェック専用（出力は esbuild 担当）という条件では、単一 tsconfig で困る要素がなく、ユーザー要望の「root に集約」に最も忠実。

**キーインサイト**：tsc を「型チェック専用」、esbuild を「出力専用」と役割分担すると、tsconfig の `outDir`/`rootDir` が不要になり、単一 tsconfig で複数パッケージをカバーしやすくなる。vitest v3 以降の `projects` 設定（旧 `workspace`）は、1つの config で複数パッケージのテストを束ねられ、パッケージごとの config ファイルが不要になる。

## セッション 3: A案採択と詳細設計

### phyllis998

> A案で進めてください

### AI

A案（root 単一 tsconfig + root 集中 vitest）の採択を確認。

設計実装前の追加調査で、バンドルエントリポイント確定のため2点を確認した：
- codiel-state CLI usage と install-harness テスト
- raguel-mcp テスト用フィクスチャ

この調査結果を踏まえ、詳細設計を以下の5セクションに分けて提示：

#### 1. workspace 構成

root に `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`biome.json`、`vitest.config.ts` を一元化。

workspace パッケージ：`plugins/basic-design`、`plugins/codiel`、`plugins/codiel/raguel-mcp`、`plugins/task-utility`、`plugins/revelation` の5つ。

共通 devDependencies（typescript / vitest / esbuild / tsx / @biomejs/biome / @types/node）は root に集約。ランタイム依存は各パッケージに残す（basic-design の `elkjs`、raguel-mcp の MCP SDK 等）。

root コマンド： `pnpm build`(-r で各パッケージの build)/ `pnpm test`(vitest run)/ `pnpm typecheck`(tsc --noEmit)/ `pnpm lint`(biome)

#### 2. 各プラグインの構造（codiel を例に）

```
plugins/codiel/
├── package.json    ← workspace パッケージ(name: codiel-scripts 等、build スクリプトのみ)
├── build.ts        ← esbuild。5エントリ → scripts/ へ .mjs バンドル出力
├── src/
│   ├── hooks/
│   │   ├── guard-bash.ts / guard-write.ts / stop-guard.ts / subagent-stop.ts / lib.ts
│   │   └── __test__/*.test.ts
│   ├── codiel-state.ts        ← CLI 兼ライブラリ(hooks から import される。バンドル時は各 hook に inline)
│   └── __test__/
│       ├── codiel-state.test.ts
│       └── install-harness.test.ts  ← bash スクリプトのテスト。参照先を ../../scripts/install-harness.sh に修正
├── scripts/        ← バンドル出力(git 管理)+ install-harness.sh(手書き shell、現状のまま)
└── hooks/hooks.json ← 参照パスを ${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs に書き換え。hooks/scripts/ は廃止
```

task-utility(6エントリ)・revelation(2エントリ)も同型。basic-design は既にこの形なので、tsconfig / vitest.config / pnpm-lock / pnpm-workspace.yaml を root へ引き上げ、テストを `src/**/__test__/` へ移すだけ。

#### 3. raguel-mcp（現状維持+最小限の整合）

- `dist/server.mjs` 出力と `.mcp.json` 参照は不変
- tsconfig / biome / vitest.config / pnpm-lock / pnpm-workspace.yaml を削除し root に統合
- ビルドスクリプトは `raguel-mcp/scripts/build.ts` → `raguel-mcp/build.ts`(パッケージ直下)へ移動し、他プラグインとパターンを揃える
- テストは各ディレクトリ隣接の `__test__/` へ移動（例: `src/rules/code/__test__/maxDiffLines.test.ts`）
- `src/panel/testing/fake-claude.mjs` は「テストが node プロセスとして直接 spawn する実行フィクスチャ」なので **.mjs のまま残す**（TS化するとテスト実行前にビルドが必要になるため）

#### 4. テスト移行

- codiel / task-utility / revelation の `node:test` + `node:assert` 製テスト(計14ファイル)を vitest の `describe/it/expect` に書き換え
- 既存 vitest テスト(basic-design / raguel-mcp)は `__test__/` への移動のみ(import パスを1階層調整)
- 移行後、root の `pnpm test` 一発で全テスト実行

#### 5. パス参照の更新と後処理

- hooks.json 3ファイル(codiel / task-utility / revelation)のパスを `scripts/` に書き換え
- SKILL.md 等の `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs` 参照は既に scripts/ 指しなので変更不要
- 旧ソース `.mjs`(hooks/scripts/ 配下と scripts/ 配下の手書き分)は TS 化完了後に削除
- CLAUDE.md の「開発コマンド」表を root 統一コマンドに更新
- 改修した各プラグインの plugin.json マイナーバージョンを上げる(basic-design 0.5→0.6-dev、codiel 0.3→0.4-dev、task-utility / revelation 0.1→0.2-dev)

**キーインサイト**：
- `codiel-state.mjs` は「hooks から import されるライブラリ」かつ「CLI として直接実行」の二役。esbuild でエントリごとにバンドルすると各 hook に inline コピーされるが、状態は JSON ファイル経由なのでコード重複は動作に影響しない
- `install-harness.test.mjs` のような「シェルスクリプトを検証するテスト」は、テストファイル移動時に `import.meta.url` 起点の相対パスが壊れる典型例なので、設計段階で明示した

この設計で問題なければ、スペックを `docs/superpowers/specs/2026-07-14-typescript-migration-design.md` に書いてコミットし、Haiku レビュー(エージェント運用方針)を通した上でレビューをお願いする予定。気になるセクションがあれば番号で指摘可能。

---

## セッション 4: スペック作成・設計レビュー・承認待機

### phyllis998

> この設計で進めてください

### AI

A案での設計承認を受け、スペックドキュメント作成と段階的レビュー実施。

スペック作成と初版コミット（909727c）を完了。`docs/superpowers/specs/2026-07-14-typescript-migration-design.md` に詳細設計5セクション（workspace構成・各プラグイン構造・raguel-mcp現状維持・テスト移行・パス参照更新）と決定事項テーブルを記載。

Node バージョン確認。ユーザーの「Node 26 に統一したい」という意向を反映し、esbuild target・@types/node・volta・root engines をすべて Node 26 に統一する設計を記載。

**Haiku レビュー実施** — agents-with-codex.md のエージェント運用方針に従い、設計書をコード検証専門の Haiku に先行レビューさせた。指摘内容：
1. **codiel-state.mjs の CLI 誤発火バグ** — 末尾の「直接実行判定」が esbuild で hook に inline されると `import.meta.url` が hook バンドルの URL になり、hook 起動時に main() が誤発火する（esbuild 0.28.1 で再現確認）。対策：ライブラリ本体(`codiel-state.ts`) と薄い CLI エントリ(`codiel-state-cli.ts`) に分離
2. **import.meta.url 相対パス再解決** — revelation スクリプトが `../trigger-map.md` 等を参照していて、出力先が `hooks/scripts/` → `scripts/` に変わると壊れる。プラグインルート起点で再解決すること
3. **2層テスト構成** — ソーステスト(`pnpm test`)と配布物検証(build 後の smoke test + git 差分ゼロ検査)を分離。git 管理バンドルが古いまま放置される事故を防ぐ
4. **vitest `pool: "forks"` 指定** — raguel-mcp テストが `process.chdir()` を使うため必須
5. その他：assert ライブラリの node:assert → vitest toStrictEqual 対応表、削除対象ファイル明示、raguel-mcp package.json の `main` フィールド修正(`dist/server.js` は実出力が `dist/server.mjs` なので修正)、esbuild `emptyOutdir` 禁止(`install-harness.sh` 同居のため)

**GPT Sol アドバイザーレビュー実施** — 設計アドバイザーとしての GPT Sol に技術的トレードオフと実装戦略の妥当性を検査させた。確認事項：
- workspace 単一 tsconfig の実現可能性と限界：パッケージ間のソース直接 import を禁止(レビューで担保)する前提で実現可能
- esbuild エントリの inline コピーと状態管理の影響：codiel-state の JSON ファイル経由の状態管理なら問題なし
- Node 26 統一の互換性：raguel-mcp の既存 MCP SDK などで Node 26 未満の要件がないか確認済み

**設計編集による反映** — Haiku・GPT Sol の指摘をスペックに組み込み、複数回の編集で以下を追加：
- §2 codiel の詳細に「ライブラリと CLI エントリの分離」セクション追加、`codiel-state-cli.ts` の役割明記、`import.meta.url` 誤発火バグと対策の詳細記載
- §5 パス参照の更新に「2層テスト」手順追加、smoke test と git 差分チェック明記
- 各セクションに Haiku 指摘の assert 対応表（`assert.deepStrictEqual` → `toStrictEqual`）、削除対象ファイル明示、raguel-mcp package.json main 修正内容追加

レビュー反映版をコミット（aeef20f）。設計書冒頭の「ステータス: ユーザー承認済み(実装計画作成前)」と「決定事項」テーブルを追加。

スペック `docs/superpowers/specs/2026-07-14-typescript-migration-design.md` をユーザーへお示しし、内容確認・承認をお願い中。問題なければ実装計画（writing-plans スキル）に進む予定。

---

## セッション 5: 実装計画の作成と Haiku レビュー

### phyllis998

> 実装計画に進んでください

### AI

スペックドキュメント承認を受け、writing-plans スキルで実装計画を作成。

**全ソース精読** — codiel / task-utility / revelation の .mjs ファイル群（計14本）と既存テスト（node:test 製14ファイル、vitest テスト）を精読。参照先：
- codiel：hooks/scripts/ 5本（guard-bash / guard-write / stop-guard / subagent-stop）+ codiel-state（CLI 兼ライブラリ）+ install-harness（shell スクリプト） → hooks.json 1本
- task-utility：hooks/scripts/ 1本（check-chat-recorded）+ scripts/ 5本（CLI）→ hooks.json 1本
- revelation：hooks/scripts/ 2本（inject-trigger-map / remind-skill） + lib.mjs（パス参照）

**実装計画の構成** — 10タスク体系で記載。各タスクは複数ステップで構成：

1. **Task 1**：root 基盤設定（package.json / pnpm-workspace.yaml / tsconfig.json / biome.json / vitest.config.ts、旧設定削除、pnpm install）
2. **Task 2**：root vitest + basic-design テスト移動・Node 26 化
3. **Task 3**：raguel-mcp テスト移動・build.ts 移動・test fixture 確認
4. **Task 4**：codiel-state TS 化・ライブラリ/CLI 分離・tsx spawn ヘルパー追加（CLI 誤発火バグ対策）
5. **Task 5**：codiel hooks 4本 TS 化
6. **Task 6**：codiel ビルド・smoke test・hooks.json 切り替え・旧ファイル削除・v0.4.0-dev
7. **Task 7**：task-utility CLI 5本 TS 化
8. **Task 8**：task-utility hook TS 化・切り替え・v0.2.0-dev
9. **Task 9**：revelation TS 化・`import.meta.url` パス再解決・切り替え・v0.2.0-dev
10. **Task 10**：biome 全体適用・CLAUDE.md 更新・成功基準の機械検証（バンドル smoke 11種、Node 26 統一確認、トップレベル副作用ゼロ確認、参照パス実在確認）

初版計画をコミット（29dc900）。

**Haiku レビュー実施** — 実装計画書をコード検証専門の Haiku に先行レビューさせた。主な指摘：
- Task 4：build.ts が未作成の hook エントリを参照する件を明確化（エントリは build.ts で定義し、未作成は skip で対応する旨を明記）
- パス修正の grep による機械的洗い出しを Task 10 に追加
- task-utility CLI 5本の smoke test を Task 7 に追加
- codiel-state TS 化での `any` 回避のため、状態型定義の明示を Task 4 に追加
- Task 6・8 の旧ファイル削除ステップで削除対象を明示（`hooks/scripts/` 配下の .mjs）

**計画編集による反映** — Haiku の指摘をすべて計画に組み込み、複数回の編集で以下を追加：
- Task 4：codiel-state-cli.ts の型定義セクション明記、build.ts 関数の event emitter 対応
- Task 6・7・8：smoke test 仕様の詳細記載
- Task 10：grep コマンド例の明記、Node 26 確認スクリプト追加

レビュー反映版をコミット（e7f315b）。

計画は完成し、コミット済み。ユーザーに実装の進め方を確認中（Subagent-Driven vs Inline）。

---

注意事項：実装計画完成（Haiku レビュー反映済み、コミット e7f315b）。ユーザーの実行方式（Subagent-Driven か Inline か）選択待機中。
