# Pitcrew Stage 1(ファイルバス+捕捉層)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サブエージェントの diff・成果物ファイル・テスト/ビルド結果を `.pitcrew/review/` に逐次書き出し、人間がエディタで直接読む(C 方式)並走レビューが成立する最小構成の `pitcrew` プラグインを作る。

**Architecture:** hooks(SubagentStop / PostToolUse)から起動される Node スクリプトが、git スナップショット(一時 index + `git write-tree`。未追跡ファイルも含む)を用いて前回捕捉時点からの diff を機械的に生成し、frontmatter 付き Markdown として `.pitcrew/review/` に落とす。すべての状態は `.pitcrew/` 配下のファイルが正(file-first)。Stage 2 以降(注入層・config・ビューア)が再利用する共有ライブラリ(原子的書き込み・frontmatter 解析・run.json 管理・hook 入出力)を `src/lib/` に切り出す。

**Tech Stack:** TypeScript(strict / ESM)→ esbuild バンドル(`.mjs`)、vitest、Node >= 26 標準ライブラリのみ(外部ランタイム依存ゼロ)、git CLI(`execFileSync` 呼び出し)。

**Design doc:** `docs/superpowers/specs/2026-07-16-pitcrew-design.md`(§3 スキーマ・§4 捕捉層・§9 エラーハンドリング・§10 テスト方針が Stage 1 の対象)

## Global Constraints

- **Anthropic API 不使用・LLM 呼び出し禁止**: 全処理は機械的スクリプトのみ(リポジトリ共通制約)
- **フェイルオープン**: hooks は全経路で、失敗時に何も出力せず exit 0。例外は `.pitcrew/log/errors.log` に追記して黙って続行。セッション進行を絶対に阻害しない
- **原子的書き込み**: ファイル書き込みは「同一ディレクトリ内の一時ファイル → rename」。ロック機構は導入しない
- **ディレクトリ自動作成**: `.pitcrew/` とサブディレクトリは hooks が必要時に `mkdir -p` 相当で作成(初回から自動で使える)
- **バンドル出力を git 管理**: `src/` を変更したら `pnpm build` を実行し `scripts/*.mjs` の差分もコミット(利用者はビルド不要)
- **外部ランタイム依存ゼロ**: 依存は `node:*` モジュールと git CLI のみ。devDependencies はルート共有(esbuild / tsx / vitest / typescript / biome)を使い、プラグイン package.json に依存を追加しない
- **esbuild 設定**: `platform: "node"`, `format: "esm"`, `target: "node26"`, `outExtension: { ".js": ".mjs" }`(既存プラグインと同一)
- **テスト**: vitest。テストはルートの `pnpm test` が拾う `plugins/**/__test__/**/*.test.ts` に置く。TDD(失敗するテスト → 実装 → パス → コミット)
- **lint/format**: biome(double quote / semicolons asNeeded / trailingCommas none / lineWidth 80 / インデント 2)。`scripts/` は biome 対象外(除外済み)
- **バージョン**: 新規プラグインは `0.1.0-dev`(plugin.json / package.json とも)
- **Stage 1 の既定値はハードコード**(config は Stage 3): 捕捉 3 種すべて有効 / 成果物対象は `docs/**/*.md`(ただし `docs/chat/` は除外。リポジトリの chat 記録閲覧制限に配慮したノイズ除去)/ テストコマンドは既定ホワイトリスト
- **ルート設定の変更は最小**: `tsconfig.json`(`plugins/*/src` は include 済み)・`vitest.config.ts`・`biome.json` は変更不要(確認済み)。変更するのは `pnpm-workspace.yaml` と `.claude-plugin/marketplace.json` のみ

---

## File Structure

```
plugins/pitcrew/
├── .claude-plugin/plugin.json        # manifest(name/description/version)
├── README.md                          # 概要と C 方式(エディタ直接)の使い方
├── package.json                       # ワークスペースパッケージ(build スクリプトは Task 6 で追加)
├── build.ts                           # esbuild バンドル定義(Task 6 で追加)
├── hooks/hooks.json                   # SubagentStop / PostToolUse の登録(Task 6-8 で段階追加)
├── scripts/                           # バンドル出力(git 管理)
└── src/
    ├── lib/
    │   ├── atomic.ts                  # 原子的書き込み(temp → rename)+親ディレクトリ作成
    │   ├── frontmatter.ts             # frontmatter の serialize / parse(Stage 2 のコメント解析も使う)
    │   ├── run.ts                     # run.json スキーマ・load/init/save
    │   ├── git.ts                     # worktree スナップショット(write-tree)・tree 間 diff
    │   ├── review.ts                  # レビュー項目 Markdown 生成・切り詰め・書き出し・成果物コアレス
    │   ├── hook-io.ts                 # hook stdin 読取・projectDir 解決・エラーログ(フェイルオープン部品)
    │   └── capture-rules.ts           # 成果物パス判定・テストコマンド照合・結果ステータス推定
    ├── hooks/
    │   ├── capture-subagent-stop.ts   # SubagentStop: 前回捕捉時点からの diff を review/ へ
    │   └── capture-post-tool-use.ts   # PostToolUse: Write/Edit(成果物)と Bash(テスト結果)で分岐
    ├── testing/run-ts.ts              # tsx 子プロセス実行ヘルパ(task-utility からコピー)
    └── (テストは各対象の隣の __test__/ に配置)
```

責務境界: `src/hooks/*` は「stdin 読取 → lib 呼び出し → フェイルオープン」の薄い結線のみ。判定・生成ロジックはすべて `src/lib/*` の純粋関数+少量の fs/git 呼び出しに置き、vitest で直接テストする。hook スクリプト自体は fixture stdin による統合テスト(`runTs`)で契約(stdout / exit code / 生成ファイル)を検証する。

## Tasks(一覧)

- **Task 1:** プラグイン雛形と workspace/marketplace 登録 + 原子的書き込み lib(`atomic.ts`)
- **Task 2:** frontmatter lib(`frontmatter.ts`: serialize / parse)
- **Task 3:** run.json 管理 lib(`run.ts`: RunState / load / init / save)
- **Task 4:** git スナップショット lib(`git.ts`: 一時 index + write-tree・tree 間 diff・`.pitcrew` 除外)
- **Task 5:** レビュー項目 lib(`review.ts`: Markdown 生成・切り詰め・コメントテンプレート・ID 採番・書き出し)
- **Task 6:** hook 入出力 lib + SubagentStop diff 捕捉 hook(`hooks.json` / `build.ts` 導入)
- **Task 7:** PostToolUse 成果物ファイル捕捉(`capture-rules.ts` のパス判定+同一パス項目のコアレス)
- **Task 8:** PostToolUse テスト・ビルド結果捕捉(コマンドホワイトリスト+ステータス推定)
- **Task 9:** README・バンドル生成・全体検証

---

### Task 1: プラグイン雛形と workspace/marketplace 登録 + 原子的書き込み lib

**Files:**
- Create: `plugins/pitcrew/.claude-plugin/plugin.json`
- Create: `plugins/pitcrew/package.json`
- Create: `plugins/pitcrew/src/testing/run-ts.ts`
- Create: `plugins/pitcrew/src/lib/atomic.ts`
- Test: `plugins/pitcrew/src/lib/__test__/atomic.test.ts`
- Modify: `pnpm-workspace.yaml`(packages に 1 行追加)
- Modify: `.claude-plugin/marketplace.json`(plugins 配列に 1 エントリ追加)

**Interfaces:**
- Consumes: なし(最初のタスク)
- Produces: `writeFileAtomic(filePath: string, content: string): void` — 親ディレクトリを自動作成し、同一ディレクトリ内の一時ファイル → `fs.renameSync` で原子的に書き込む。以後の全タスクのファイル書き込みはこれを使う。`src/testing/run-ts.ts` の `runTs(script, args?, opts?): string` は Task 6-8 の hook 統合テストが使う

- [ ] **Step 1: プラグイン雛形を作成**

`plugins/pitcrew/.claude-plugin/plugin.json`:

```json
{
  "name": "pitcrew",
  "description": "オーケストレーション実行中の成果物(diff・設計書・テスト結果)を .pitcrew/ のレビューキューへ逐次書き出し、人間の並走レビューを可能にするプラグイン",
  "version": "0.1.0-dev"
}
```

`plugins/pitcrew/package.json`(build スクリプトは Task 6 で build.ts と同時に追加する。先に書くと `pnpm -r build` が壊れるため):

```json
{
  "name": "pitcrew-scripts",
  "version": "0.1.0-dev",
  "private": true,
  "type": "module"
}
```

`plugins/pitcrew/src/testing/run-ts.ts`(`plugins/task-utility/src/testing/run-ts.ts` と同一内容。ワークスペース間 import はしない方針のためコピーする):

```typescript
import { type ExecFileSyncOptions, execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

// TypeScript ソースを tsx 経由で子プロセス実行する(ビルド前でもテストできるようにするため)。
// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
export function runTs(
  script: string,
  args: string[] = [],
  opts: ExecFileSyncOptions = {}
): string {
  return execFileSync(process.execPath, [TSX_CLI, script, ...args], {
    encoding: "utf8",
    ...opts
  }) as string
}
```

- [ ] **Step 2: workspace と marketplace に登録**

`pnpm-workspace.yaml` の packages 末尾に追加:

```yaml
packages:
  - plugins/basic-design
  - plugins/codiel
  - plugins/codiel/raguel-mcp
  - plugins/task-utility
  - plugins/revelation
  - plugins/pitcrew
allowBuilds:
  esbuild: true
```

`.claude-plugin/marketplace.json` の `plugins` 配列末尾(`basic-design` の後)に追加:

```json
    {
      "name": "pitcrew",
      "source": "./plugins/pitcrew",
      "description": "オーケストレーション実行中の成果物(diff・設計書・テスト結果)を .pitcrew/ のレビューキューへ逐次書き出し、人間の並走レビューを可能にするプラグイン"
    }
```

Run: `pnpm install`
Expected: lockfile が更新され、`pitcrew-scripts` がワークスペースに追加される(エラーなし)

- [ ] **Step 3: atomic.ts の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/atomic.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { writeFileAtomic } from "../atomic.js"

function withTmpDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-atomic-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("親ディレクトリごと作成して書き込む", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "a", "b", "c.md")
    writeFileAtomic(file, "hello")
    expect(fs.readFileSync(file, "utf8")).toBe("hello")
  })
})

test("既存ファイルを上書きし、一時ファイルを残さない", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "x.md")
    writeFileAtomic(file, "v1")
    writeFileAtomic(file, "v2")
    expect(fs.readFileSync(file, "utf8")).toBe("v2")
    expect(fs.readdirSync(dir)).toEqual(["x.md"])
  })
})
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/atomic.test.ts`
Expected: FAIL(`Cannot find module '../atomic.js'` 相当のエラー)

- [ ] **Step 5: atomic.ts を実装**

`plugins/pitcrew/src/lib/atomic.ts`:

```typescript
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// 同一ディレクトリ内 rename の原子性を利用した書き込み(設計書 §9)。
// ビューアが書きかけのファイルを読まないようにする。親ディレクトリも自動作成する。
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  )
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, filePath)
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/atomic.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 7: lint と型チェック**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし(biome 違反があれば `pnpm biome check --write plugins/pitcrew` で修正)

- [ ] **Step 8: コミット**

```bash
git add plugins/pitcrew pnpm-workspace.yaml .claude-plugin/marketplace.json pnpm-lock.yaml
git commit -m "feat: pitcrew プラグインの雛形と原子的書き込みライブラリ"
```

### Task 2: frontmatter lib(serialize / parse)

**Files:**
- Create: `plugins/pitcrew/src/lib/frontmatter.ts`
- Test: `plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数のみ)
- Produces:
  - `type FrontmatterData = Record<string, string | number | string[]>`
  - `serializeFrontmatter(data: FrontmatterData): string` — `---` 区切りの YAML 風ブロック文字列を返す(末尾改行なし)。配列はインライン `[a, b]` 形式
  - `parseFrontmatter(text: string): { data: Record<string, string | string[]>; body: string }` — frontmatter がなければ `data: {}` で全文を body として返す。数値も文字列として返す(呼び出し側で変換)
  - Stage 1 ではレビュー項目の生成(Task 5)と成果物コアレスの照合(Task 7)が使う。Stage 2 の注入層はコメント(`urgency`/`paths`/`reviewId`/`base`)の解析に同じ `parseFrontmatter` を使う
  - 制約(意図的): フラットな key-value のみ対応。ネスト・複数行値・配列要素内のカンマは非対応(設計書がコメント `paths` のワイルドカードを禁止しており、リポジトリ相対パスにカンマは現れない)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`:

```typescript
import { expect, test } from "vitest"
import { parseFrontmatter, serializeFrontmatter } from "../frontmatter.js"

test("スカラーと配列をシリアライズできる", () => {
  const out = serializeFrontmatter({
    id: "002",
    type: "diff",
    paths: ["src/auth.ts", "src/auth.test.ts"]
  })
  expect(out.split("\n")[0]).toBe("---")
  expect(out.split("\n").at(-1)).toBe("---")
  expect(out).toContain("type: diff")
  expect(out).toContain("paths: [src/auth.ts, src/auth.test.ts]")
})

test("シリアライズ→パースで往復できる(コロン含む値も壊れない)", () => {
  const src = serializeFrontmatter({
    id: "002",
    created: "2026-07-16T14:23:05.000Z",
    agent: "implementer#2",
    paths: ["docs/a.md"]
  })
  const { data, body } = parseFrontmatter(`${src}\n本文です\n`)
  expect(data.id).toBe("002")
  expect(data.created).toBe("2026-07-16T14:23:05.000Z")
  expect(data.agent).toBe("implementer#2")
  expect(data.paths).toEqual(["docs/a.md"])
  expect(body).toBe("本文です\n")
})

test("frontmatter がないテキストは data 空・全文 body", () => {
  const { data, body } = parseFrontmatter("# 見出し\n本文\n")
  expect(data).toEqual({})
  expect(body).toBe("# 見出し\n本文\n")
})

test("空配列をパースできる", () => {
  const { data } = parseFrontmatter("---\npaths: []\n---\n")
  expect(data.paths).toEqual([])
})

test("Stage 2 のコメント frontmatter を解析できる", () => {
  const text = [
    "---",
    "urgency: urgent",
    "paths: [src/auth.ts]",
    'reviewId: "002"',
    "base: a3f2c01",
    "---",
    "この方針はやめてください"
  ].join("\n")
  const { data, body } = parseFrontmatter(text)
  expect(data.urgency).toBe("urgent")
  expect(data.paths).toEqual(["src/auth.ts"])
  expect(data.reviewId).toBe("002")
  expect(data.base).toBe("a3f2c01")
  expect(body).toBe("この方針はやめてください")
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`
Expected: FAIL(`Cannot find module '../frontmatter.js'` 相当)

- [ ] **Step 3: frontmatter.ts を実装**

`plugins/pitcrew/src/lib/frontmatter.ts`:

```typescript
// レビュー項目・コメントの YAML frontmatter サブセット(フラット key-value +
// インライン配列のみ)。外部 YAML ライブラリへの依存を避けるための最小実装。
export type FrontmatterData = Record<string, string | number | string[]>

// 値に YAML 的に危険な文字が含まれる場合、および数字始まり(YAML で数値に
// 化ける "002"・"7be90d4" 等)の場合は JSON 文字列として引用する
function quote(v: string): string {
  return /[:#"[\],]|^[\s\d]|\s$|^$/.test(v) ? JSON.stringify(v) : v
}

function unquote(v: string): string {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string
    } catch {
      return v.slice(1, -1)
    }
  }
  return v
}

export function serializeFrontmatter(data: FrontmatterData): string {
  const lines = ["---"]
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(quote).join(", ")}]`)
    } else {
      lines.push(`${key}: ${quote(String(value))}`)
    }
  }
  lines.push("---")
  return lines.join("\n")
}

export function parseFrontmatter(text: string): {
  data: Record<string, string | string[]>
  body: string
} {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim()
      data[key] =
        inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()))
    } else {
      data[key] = unquote(raw)
    }
  }
  return { data, body: text.slice(m[0].length) }
}
```

注意: `quote` は `#` を含む値(`implementer#2`)や数字始まりの値(`002`・`2026-...`)を JSON 文字列として引用する。引用されても `unquote` が対で外すため往復は保たれる — テストは「シリアライズ後の生文字列」ではなく「パース後の値の等価性」で検証している(`type: diff` / `paths: [src/auth.ts, ...]` のような安全な値だけ生文字列を検証)。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: lint・型チェックとコミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/lib/frontmatter.ts plugins/pitcrew/src/lib/__test__/frontmatter.test.ts
git commit -m "feat: pitcrew frontmatter の serialize/parse ライブラリ"
```

### Task 3: run.json 管理 lib

**Files:**
- Create: `plugins/pitcrew/src/lib/run.ts`
- Test: `plugins/pitcrew/src/lib/__test__/run.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic(filePath, content)`(Task 1)
- Produces:
  - `interface RunState { startedAt: string; lastCaptureCommit: string | null; lastCaptureAt: string | null; nextReviewId: number; phase?: string }`
  - `pitcrewDir(projectDir: string): string` — `path.join(projectDir, ".pitcrew")` を返すだけの定数関数(パス組み立ての一元化)
  - `loadRun(projectDir: string): RunState` — `.pitcrew/run.json` を読む。無い・壊れている場合は初期値(`startedAt`: 現在時刻 ISO、`lastCaptureCommit: null`、`lastCaptureAt: null`、`nextReviewId: 1`)を**返すだけで保存はしない**(保存は捕捉成功時に `saveRun` で行う。フェイルオープン経路で書き込みを増やさない)
  - `saveRun(projectDir: string, run: RunState): void` — `writeFileAtomic` で `.pitcrew/run.json` に保存
  - Stage 2 以降も run.json の読み書きはこの 2 関数を使う

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/run.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { loadRun, pitcrewDir, saveRun } from "../run.js"

function withTmpDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-run-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("run.json が無ければ初期値を返し、ファイルは作らない", () => {
  withTmpDir((dir) => {
    const run = loadRun(dir)
    expect(run.nextReviewId).toBe(1)
    expect(run.lastCaptureCommit).toBeNull()
    expect(run.lastCaptureAt).toBeNull()
    expect(Date.parse(run.startedAt)).not.toBeNaN()
    expect(fs.existsSync(path.join(dir, ".pitcrew", "run.json"))).toBe(false)
  })
})

test("save → load で往復できる", () => {
  withTmpDir((dir) => {
    saveRun(dir, {
      startedAt: "2026-07-16T00:00:00.000Z",
      lastCaptureCommit: "a3f2c01",
      lastCaptureAt: "2026-07-16T01:00:00.000Z",
      nextReviewId: 3
    })
    const run = loadRun(dir)
    expect(run.lastCaptureCommit).toBe("a3f2c01")
    expect(run.nextReviewId).toBe(3)
  })
})

test("壊れた run.json は初期値にフォールバックする", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(pitcrewDir(dir), { recursive: true })
    fs.writeFileSync(path.join(pitcrewDir(dir), "run.json"), "{broken")
    expect(loadRun(dir).nextReviewId).toBe(1)
  })
})

test("nextReviewId が数値でない run.json も初期値にフォールバックする", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(pitcrewDir(dir), { recursive: true })
    fs.writeFileSync(
      path.join(pitcrewDir(dir), "run.json"),
      JSON.stringify({ nextReviewId: "abc" })
    )
    expect(loadRun(dir).nextReviewId).toBe(1)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/run.test.ts`
Expected: FAIL(`Cannot find module '../run.js'` 相当)

- [ ] **Step 3: run.ts を実装**

`plugins/pitcrew/src/lib/run.ts`:

```typescript
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"

// .pitcrew/run.json のスキーマ(設計書 §3)。phase は将来の codiel 連携用の予約フィールド。
export interface RunState {
  startedAt: string
  lastCaptureCommit: string | null
  lastCaptureAt: string | null
  nextReviewId: number
  phase?: string
}

export function pitcrewDir(projectDir: string): string {
  return path.join(projectDir, ".pitcrew")
}

function initialRun(): RunState {
  return {
    startedAt: new Date().toISOString(),
    lastCaptureCommit: null,
    lastCaptureAt: null,
    nextReviewId: 1
  }
}

// run.json が無い・壊れている場合は初期値を返す(保存はしない。
// 保存は捕捉が成功したときに saveRun で行う)。
export function loadRun(projectDir: string): RunState {
  const file = path.join(pitcrewDir(projectDir), "run.json")
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    return initialRun()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RunState>
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.nextReviewId !== "number" ||
      !Number.isInteger(parsed.nextReviewId) ||
      parsed.nextReviewId < 1
    )
      return initialRun()
    return {
      startedAt:
        typeof parsed.startedAt === "string"
          ? parsed.startedAt
          : new Date().toISOString(),
      lastCaptureCommit:
        typeof parsed.lastCaptureCommit === "string"
          ? parsed.lastCaptureCommit
          : null,
      lastCaptureAt:
        typeof parsed.lastCaptureAt === "string" ? parsed.lastCaptureAt : null,
      nextReviewId: parsed.nextReviewId,
      ...(typeof parsed.phase === "string" ? { phase: parsed.phase } : {})
    }
  } catch {
    return initialRun()
  }
}

export function saveRun(projectDir: string, run: RunState): void {
  writeFileAtomic(
    path.join(pitcrewDir(projectDir), "run.json"),
    `${JSON.stringify(run, null, 2)}\n`
  )
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/run.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: lint・型チェックとコミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/lib/run.ts plugins/pitcrew/src/lib/__test__/run.test.ts
git commit -m "feat: pitcrew run.json 管理ライブラリ"
```

### Task 4: git スナップショット lib

**Files:**
- Create: `plugins/pitcrew/src/lib/git.ts`
- Test: `plugins/pitcrew/src/lib/__test__/git.test.ts`

**Interfaces:**
- Consumes: なし(git CLI を `execFileSync` で叩く)
- Produces:
  - `snapshotWorktree(projectDir: string): string | null` — 作業ツリー(未追跡ファイル含む、`.pitcrew/` は除外)の tree オブジェクト hash を返す。git リポジトリでない・git が無い場合は null
  - `diffBetween(projectDir: string, baseTree: string, headTree: string): { diff: string; paths: string[] }` — 2 つの tree 間の unified diff と変更ファイルのリポジトリ相対パス一覧
  - `headCommit(projectDir: string): string | null` — `git rev-parse --short HEAD` の結果(レビュー項目の frontmatter 表示用)。unborn HEAD(コミットゼロ)なら null
  - 設計上の決定: 設計書 §4 の「`git stash create` 相当で得る一時 commit、または HEAD」は、**一時 index ファイル(`GIT_INDEX_FILE`)+ `git add -A` + `git write-tree`** で実装する。`git stash create` は untracked ファイルを含まず、かつコミットゼロのリポジトリで失敗するため。tree オブジェクトはリポジトリの object store に残る(参照なしのため将来 gc 対象。作業ツリー・index・HEAD は一切変更しない)。`run.json.lastCaptureCommit` にはこの tree hash を格納する(フィールド名は設計書のまま維持)
- **注意:** hook から呼ばれる際の `projectDir` は git worktree 直下とは限らないが、Stage 1 では `CLAUDE_PROJECT_DIR` がリポジトリルートである前提とし、git コマンドは `cwd: projectDir` で実行する

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/git.test.ts`:

```typescript
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { diffBetween, headCommit, snapshotWorktree } from "../git.js"

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" })
}

function withRepo(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-git-"))
  try {
    git(dir, "init", "-q")
    git(dir, "config", "user.email", "t@example.com")
    git(dir, "config", "user.name", "t")
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("スナップショット間の diff に変更内容と対象パスが出る", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 1\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "init")
    const base = snapshotWorktree(dir)
    expect(base).toBeTruthy()
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 2\n")
    fs.writeFileSync(path.join(dir, "b.ts"), "const b = 1\n") // 未追跡
    const head = snapshotWorktree(dir)
    if (!base || !head) throw new Error("unreachable")
    const { diff, paths } = diffBetween(dir, base, head)
    expect(paths.sort()).toEqual(["a.ts", "b.ts"])
    expect(diff).toContain("-const a = 1")
    expect(diff).toContain("+const a = 2")
    expect(diff).toContain("+const b = 1")
  })
})

test("変更がなければ diff は空・paths も空", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.ts"), "x\n")
    const s1 = snapshotWorktree(dir)
    const s2 = snapshotWorktree(dir)
    if (!s1 || !s2) throw new Error("unreachable")
    const { diff, paths } = diffBetween(dir, s1, s2)
    expect(diff.trim()).toBe("")
    expect(paths).toEqual([])
  })
})

test(".pitcrew/ 配下はスナップショットに含めない", () => {
  withRepo((dir) => {
    const base = snapshotWorktree(dir)
    fs.mkdirSync(path.join(dir, ".pitcrew", "review"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".pitcrew", "review", "001.md"), "x")
    const head = snapshotWorktree(dir)
    if (!base || !head) throw new Error("unreachable")
    expect(diffBetween(dir, base, head).paths).toEqual([])
  })
})

test("コミットゼロのリポジトリでもスナップショットが取れ、headCommit は null", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.ts"), "x\n")
    expect(snapshotWorktree(dir)).toBeTruthy()
    expect(headCommit(dir)).toBeNull()
  })
})

test("git リポジトリでないディレクトリでは null を返す", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-nogit-"))
  try {
    expect(snapshotWorktree(dir)).toBeNull()
    expect(headCommit(dir)).toBeNull()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/git.test.ts`
Expected: FAIL(`Cannot find module '../git.js'` 相当)

- [ ] **Step 3: git.ts を実装**

`plugins/pitcrew/src/lib/git.ts`:

```typescript
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// diff の base 管理(設計書 §4)。作業ツリーの状態を一時 index + write-tree で
// tree オブジェクト化する。git stash create は未追跡ファイルを含まず、
// コミットゼロのリポジトリで失敗するため使わない。
// 作業ツリー・本物の index・HEAD には一切影響しない。

function git(
  projectDir: string,
  args: string[],
  env?: Record<string, string>
): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...env }
  })
}

export function snapshotWorktree(projectDir: string): string | null {
  const tmpIndex = path.join(
    os.tmpdir(),
    `pitcrew-index-${process.pid}-${Date.now()}`
  )
  try {
    const env = { GIT_INDEX_FILE: tmpIndex }
    // 本物の index を一時 index にコピーしてから作業ツリーの全変更を乗せる
    // (追跡済みの削除・未追跡の追加も -A で反映される)
    try {
      git(projectDir, ["read-tree", "HEAD"], env)
    } catch {
      // unborn HEAD(コミットゼロ): 空 index から始める
      git(projectDir, ["read-tree", "--empty"], env)
    }
    git(projectDir, ["add", "-A", "--", ".", ":!.pitcrew"], env)
    return git(projectDir, ["write-tree"], env).trim()
  } catch {
    return null
  } finally {
    fs.rmSync(tmpIndex, { force: true })
  }
}

export function diffBetween(
  projectDir: string,
  baseTree: string,
  headTree: string
): { diff: string; paths: string[] } {
  const diff = git(projectDir, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    baseTree,
    headTree
  ])
  const nameOnly = git(projectDir, [
    "diff",
    "--name-only",
    baseTree,
    headTree
  ])
  return {
    diff,
    paths: nameOnly.split("\n").filter((p) => p.trim() !== "")
  }
}

export function headCommit(projectDir: string): string | null {
  try {
    return git(projectDir, ["rev-parse", "--short", "HEAD"]).trim()
  } catch {
    return null
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/git.test.ts`
Expected: PASS(5 tests)

注意: `.pitcrew/ 配下はスナップショットに含めない` が失敗する場合、pathspec `":!.pitcrew"` の書き方を確認すること(`git add -A -- . ':!.pitcrew'` は exclude pathspec。古い git では `:(exclude).pitcrew` 表記)。

- [ ] **Step 5: lint・型チェックとコミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/lib/git.ts plugins/pitcrew/src/lib/__test__/git.test.ts
git commit -m "feat: pitcrew git スナップショット/diff ライブラリ"
```

### Task 5: レビュー項目 lib(生成・切り詰め・書き出し)

**Files:**
- Create: `plugins/pitcrew/src/lib/review.ts`
- Test: `plugins/pitcrew/src/lib/__test__/review.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic`(Task 1)、`serializeFrontmatter` / `parseFrontmatter`(Task 2)、`RunState` / `pitcrewDir`(Task 3)
- Produces:
  - `interface ReviewItem { type: "diff" | "artifact" | "test"; title: string; agent: string; paths: string[]; base: string | null; head: string | null; body: string }`
  - `renderReviewItem(id: string, item: ReviewItem, now: Date): string` — frontmatter 付き Markdown 全文を返す(設計書 §4 のフォーマット+末尾にコメントテンプレート)。本文が `MAX_BODY_LINES`(600 行)を超える場合は先頭 600 行+省略注記に切り詰める
  - `writeReviewItem(projectDir: string, run: RunState, item: ReviewItem): { file: string; id: string; run: RunState }` — `run.nextReviewId` から `001` 形式の ID とスラッグ付きファイル名(例 `002-diff-auth-ts.md`)を作り、`.pitcrew/review/` に原子的に書き込み、`nextReviewId` をインクリメントした**新しい RunState を返す**(保存は呼び出し側 = hook が `saveRun` で行う)
  - `slugify(text: string): string` — ファイル名用スラッグ(英数字以外を `-` に。空なら `"item"`)
  - コメントテンプレート: 各レビュー項目の末尾に、人間が `comments/c-<id>.md` へコピーして使う雛形(frontmatter に `urgency: normal` / `paths` / `reviewId` / `base` 入り)をコードフェンスで付記する(設計書 §5 C 方式「テンプレートを review 項目の末尾に付記」)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/review.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../frontmatter.js"
import type { RunState } from "../run.js"
import { renderReviewItem, slugify, writeReviewItem } from "../review.js"

const NOW = new Date("2026-07-16T14:23:05.000Z")

function baseRun(): RunState {
  return {
    startedAt: "2026-07-16T00:00:00.000Z",
    lastCaptureCommit: null,
    lastCaptureAt: null,
    nextReviewId: 2
  }
}

const item = {
  type: "diff" as const,
  title: "auth.ts ほか 1 ファイルの diff",
  agent: "implementer#2",
  paths: ["src/auth.ts", "src/auth.test.ts"],
  base: "a3f2c01",
  head: "7be90d4",
  body: "```diff\n-const a = 1\n+const a = 2\n```\n"
}

test("frontmatter に設計書 §4 のメタデータが入る", () => {
  const text = renderReviewItem("002", item, NOW)
  const { data, body } = parseFrontmatter(text)
  expect(data.id).toBe("002")
  expect(data.type).toBe("diff")
  expect(data.agent).toBe("implementer#2")
  expect(data.created).toBe("2026-07-16T14:23:05.000Z")
  expect(data.base).toBe("a3f2c01")
  expect(data.head).toBe("7be90d4")
  expect(data.paths).toEqual(["src/auth.ts", "src/auth.test.ts"])
  expect(body).toContain("# auth.ts ほか 1 ファイルの diff")
  expect(body).toContain("+const a = 2")
})

test("末尾にコメントテンプレート(urgency/paths/reviewId/base 入り)が付く", () => {
  const text = renderReviewItem("002", item, NOW)
  expect(text).toContain("urgency: normal")
  expect(text).toContain('reviewId: "002"')
  expect(text).toContain(".pitcrew/comments/")
})

test("本文が 600 行を超えると切り詰めて注記する", () => {
  const long = { ...item, body: Array(1000).fill("line").join("\n") }
  const text = renderReviewItem("002", long, NOW)
  expect(text.split("\n").length).toBeLessThan(700)
  expect(text).toContain("省略")
})

test("base/head が null の場合は frontmatter から省く", () => {
  const text = renderReviewItem("003", { ...item, base: null, head: null }, NOW)
  const { data } = parseFrontmatter(text)
  expect(data.base).toBeUndefined()
  expect(data.head).toBeUndefined()
})

test("writeReviewItem が採番・書き込みし、新しい RunState を返す", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-review-"))
  try {
    const res = writeReviewItem(dir, baseRun(), item)
    expect(res.id).toBe("002")
    expect(path.basename(res.file)).toBe("002-diff-auth-ts.md")
    expect(res.run.nextReviewId).toBe(3)
    const written = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", "002-diff-auth-ts.md"),
      "utf8"
    )
    expect(parseFrontmatter(written).data.id).toBe("002")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("slugify は英数字以外を - に潰す", () => {
  expect(slugify("src/auth.ts")).toBe("src-auth-ts")
  expect(slugify("テスト結果")).toBe("item")
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/review.test.ts`
Expected: FAIL(`Cannot find module '../review.js'` 相当)

- [ ] **Step 3: review.ts を実装**

`plugins/pitcrew/src/lib/review.ts`:

```typescript
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import { type FrontmatterData, serializeFrontmatter } from "./frontmatter.js"
import { type RunState, pitcrewDir } from "./run.js"

// レビュー項目(設計書 §4)の生成と .pitcrew/review/ への書き出し。

export interface ReviewItem {
  type: "diff" | "artifact" | "test"
  title: string
  agent: string
  paths: string[]
  base: string | null
  head: string | null
  body: string
}

// 巨大 diff 対策(設計書 §3): 本文はこの行数で切り詰める
const MAX_BODY_LINES = 600

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return s || "item"
}

function truncateBody(body: string): string {
  const lines = body.split("\n")
  if (lines.length <= MAX_BODY_LINES) return body
  return [
    ...lines.slice(0, MAX_BODY_LINES),
    "",
    `> (以降 ${lines.length - MAX_BODY_LINES} 行を省略。全文は作業ツリーの対象ファイルを参照)`
  ].join("\n")
}

// C 方式(エディタ直接)用: comments/ に手書きするコメントの雛形(設計書 §5)
function commentTemplate(id: string, item: ReviewItem): string {
  const fm = serializeFrontmatter({
    urgency: "normal",
    paths: item.paths,
    reviewId: id,
    ...(item.base ? { base: item.base } : {})
  })
  return [
    "---",
    "",
    "## コメントする場合",
    "",
    "以下を `.pitcrew/comments/c-<連番>.md` として保存してください" +
      "(urgency は urgent | normal)。",
    "",
    "```markdown",
    fm,
    "(ここにコメント本文)",
    "```"
  ].join("\n")
}

export function renderReviewItem(
  id: string,
  item: ReviewItem,
  now: Date
): string {
  const fm: FrontmatterData = {
    id,
    type: item.type,
    agent: item.agent,
    created: now.toISOString(),
    ...(item.base ? { base: item.base } : {}),
    ...(item.head ? { head: item.head } : {}),
    paths: item.paths
  }
  return [
    serializeFrontmatter(fm),
    `# ${item.title}`,
    "",
    truncateBody(item.body).trimEnd(),
    "",
    commentTemplate(id, item),
    ""
  ].join("\n")
}

export function writeReviewItem(
  projectDir: string,
  run: RunState,
  item: ReviewItem
): { file: string; id: string; run: RunState } {
  const id = String(run.nextReviewId).padStart(3, "0")
  // スラッグはファイル名の可読性のためのもの: 先頭パスの basename
  // (例 src/auth.ts → auth-ts)、パスが無い項目(test)はタイトルから作る
  const slugSource = item.paths[0] ? path.basename(item.paths[0]) : item.title
  const file = path.join(
    pitcrewDir(projectDir),
    "review",
    `${id}-${item.type}-${slugify(slugSource)}.md`
  )
  writeFileAtomic(file, renderReviewItem(id, item, new Date()))
  return { file, id, run: { ...run, nextReviewId: run.nextReviewId + 1 } }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/review.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 5: lint・型チェックとコミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/lib/review.ts plugins/pitcrew/src/lib/__test__/review.test.ts
git commit -m "feat: pitcrew レビュー項目の生成・書き出しライブラリ"
```

### Task 6: hook 入出力 lib + SubagentStop diff 捕捉 hook

**Files:**
- Create: `plugins/pitcrew/src/lib/hook-io.ts`
- Create: `plugins/pitcrew/src/hooks/capture-subagent-stop.ts`
- Create: `plugins/pitcrew/hooks/hooks.json`
- Create: `plugins/pitcrew/build.ts`
- Modify: `plugins/pitcrew/package.json`(`scripts.build` を追加)
- Modify: `plugins/pitcrew/src/lib/git.ts`(`baselineTree` を追加)
- Test: `plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`
- Test: `plugins/pitcrew/src/lib/__test__/git.test.ts`(`baselineTree` のテストを追記)

**Interfaces:**
- Consumes: `loadRun` / `saveRun`(Task 3)、`snapshotWorktree` / `diffBetween` / `headCommit`(Task 4)、`writeReviewItem` / `ReviewItem`(Task 5)
- Produces(`hook-io.ts` — Task 7・8 と Stage 2 の全 hook が使う):
  - `interface HookInput { session_id?: string; transcript_path?: string; cwd?: string; hook_event_name?: string; tool_name?: string; tool_input?: { command?: string; file_path?: string; [k: string]: unknown }; tool_response?: unknown; agent_id?: string; agent_type?: string; stop_hook_active?: boolean; [k: string]: unknown }`(revelation の `HookInput` と同型。stdin JSON のスキーマは既存 hook 実装で確認済み)
  - `readStdinSync(): HookInput | null` — `fs.readFileSync(0)` + JSON.parse。失敗時 null(呼び出し側が exit 0)
  - `resolveProjectDir(input: HookInput): string` — `CLAUDE_PROJECT_DIR` env → `input.cwd` → `process.cwd()` の順
  - `logError(projectDir: string, context: string, err: unknown): void` — `.pitcrew/log/errors.log` に 1 行追記(`appendFileSync`。ログ自体の失敗も握り潰す)
- Produces(`git.ts` 追加分): `baselineTree(projectDir: string): string | null` — `HEAD^{tree}`、unborn HEAD なら空 tree(`git hash-object -t tree /dev/null`)。初回捕捉(`lastCaptureCommit` が null)の diff base に使う
- hook 本体は import されない(バンドルエントリポイント)。契約は「stdin JSON → `.pitcrew/` への副作用 + 常に exit 0・stdout 出力なし」

- [ ] **Step 1: baselineTree の失敗するテストを追記**

`plugins/pitcrew/src/lib/__test__/git.test.ts` の末尾に追加(import に `baselineTree` を追加):

```typescript
test("baselineTree は HEAD の tree を返し、コミットゼロなら空 tree を返す", () => {
  withRepo((dir) => {
    const empty = baselineTree(dir)
    expect(empty).toBeTruthy() // 空 tree hash
    fs.writeFileSync(path.join(dir, "a.ts"), "x\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "init")
    const headTree = baselineTree(dir)
    expect(headTree).toBeTruthy()
    expect(headTree).not.toBe(empty)
  })
})
```

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/git.test.ts`
Expected: FAIL(`baselineTree` が存在しない)

- [ ] **Step 2: baselineTree を実装してテストを通す**

`plugins/pitcrew/src/lib/git.ts` の末尾に追加:

```typescript
// 初回捕捉時の diff base(設計書 §4 の「または HEAD」)。HEAD の tree を返し、
// unborn HEAD(コミットゼロ)のときは空 tree にフォールバックする。
export function baselineTree(projectDir: string): string | null {
  try {
    return git(projectDir, ["rev-parse", "HEAD^{tree}"]).trim()
  } catch {
    try {
      return git(projectDir, [
        "hash-object",
        "-t",
        "tree",
        "/dev/null"
      ]).trim()
    } catch {
      return null
    }
  }
}
```

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/git.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 3: hook-io.ts を実装(先に実装 — 後続の hook 統合テストが契約テストを兼ねる)**

`plugins/pitcrew/src/lib/hook-io.ts`:

```typescript
import fs from "node:fs"
import path from "node:path"
import { pitcrewDir } from "./run.js"

// Claude Code hooks の stdin JSON(既存プラグインの hook 実装で確認済みのスキーマ)。
// SubagentStop: session_id / transcript_path / cwd / stop_hook_active / agent_id / agent_type
// PostToolUse: 上記 + tool_name / tool_input / tool_response
export interface HookInput {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: { command?: string; file_path?: string; [k: string]: unknown }
  tool_response?: unknown
  agent_id?: string
  agent_type?: string
  stop_hook_active?: boolean
  [k: string]: unknown
}

export function readStdinSync(): HookInput | null {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")) as HookInput
  } catch {
    return null
  }
}

export function resolveProjectDir(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
}

// フェイルオープン(設計書 §9): 例外は .pitcrew/log/ に記録して黙って続行。
// ログ書き込み自体の失敗も握り潰す(セッションを絶対に阻害しない)。
export function logError(
  projectDir: string,
  context: string,
  err: unknown
): void {
  try {
    const logDir = path.join(pitcrewDir(projectDir), "log")
    fs.mkdirSync(logDir, { recursive: true })
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    fs.appendFileSync(
      path.join(logDir, "errors.log"),
      `${new Date().toISOString()} [${context}] ${message}\n`
    )
  } catch {
    // 何もしない
  }
}
```

- [ ] **Step 4: SubagentStop hook の失敗する統合テストを書く**

`plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`:

```typescript
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../../lib/frontmatter.js"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../capture-subagent-stop.ts", import.meta.url))

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" })
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-sstop-"))
  git(dir, "init", "-q")
  git(dir, "config", "user.email", "t@example.com")
  git(dir, "config", "user.name", "t")
  fs.writeFileSync(path.join(dir, "base.ts"), "const base = 1\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", "init")
  return dir
}

function runHook(dir: string, input: Record<string, unknown> = {}): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, agent_type: "implementer", ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function reviewFiles(dir: string): string[] {
  const reviewDir = path.join(dir, ".pitcrew", "review")
  return fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir).sort() : []
}

test("変更があると review/001 が作られ run.json が更新される", () => {
  const dir = makeRepo()
  try {
    fs.writeFileSync(path.join(dir, "feat.ts"), "export const f = 1\n")
    expect(runHook(dir).trim()).toBe("") // stdout 出力なし
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^001-diff-/)
    const { data, body } = parseFrontmatter(
      fs.readFileSync(path.join(dir, ".pitcrew", "review", files[0]), "utf8")
    )
    expect(data.type).toBe("diff")
    expect(data.agent).toBe("implementer")
    expect(data.paths).toEqual(["feat.ts"])
    expect(body).toContain("+export const f = 1")
    const run = JSON.parse(
      fs.readFileSync(path.join(dir, ".pitcrew", "run.json"), "utf8")
    )
    expect(run.nextReviewId).toBe(2)
    expect(run.lastCaptureCommit).toBeTruthy()
    expect(run.lastCaptureAt).toBeTruthy()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("連続捕捉で diff が重複しない(2 回目の base は 1 回目の捕捉時点)", () => {
  const dir = makeRepo()
  try {
    fs.writeFileSync(path.join(dir, "a.ts"), "A\n")
    runHook(dir)
    fs.writeFileSync(path.join(dir, "b.ts"), "B\n")
    runHook(dir, { agent_type: "reviewer" })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(2)
    const second = parseFrontmatter(
      fs.readFileSync(path.join(dir, ".pitcrew", "review", files[1]), "utf8")
    )
    expect(second.data.paths).toEqual(["b.ts"]) // a.ts を含まない
    expect(second.data.agent).toBe("reviewer")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("変更がなければ review 項目を作らない", () => {
  const dir = makeRepo()
  try {
    runHook(dir)
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("git リポジトリでなくても exit 0 で何も書かない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-nogit-"))
  try {
    expect(runHook(dir).trim()).toBe("")
    expect(fs.existsSync(path.join(dir, ".pitcrew", "review"))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("壊れた stdin でも exit 0 で素通しする", () => {
  expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
})
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`
Expected: FAIL(hook ファイルが存在しない)

- [ ] **Step 6: capture-subagent-stop.ts を実装**

`plugins/pitcrew/src/hooks/capture-subagent-stop.ts`:

```typescript
#!/usr/bin/env node
// SubagentStop フック(設計書 §4): サブエージェント完了時に、直前の捕捉時点からの
// git diff を機械的に生成して .pitcrew/review/ に書き出す。全経路フェイルオープン。
import path from "node:path"
import { baselineTree, diffBetween, snapshotWorktree } from "../lib/git.js"
import { readStdinSync, resolveProjectDir, logError } from "../lib/hook-io.js"
import { type ReviewItem, writeReviewItem } from "../lib/review.js"
import { loadRun, saveRun } from "../lib/run.js"

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const head = snapshotWorktree(projectDir)
  if (!head) process.exit(0) // git リポジトリでない等 — 何もしない

  const run = loadRun(projectDir)
  const base = run.lastCaptureCommit ?? baselineTree(projectDir)
  const now = new Date().toISOString()

  if (!base || base === head) {
    // 初回ベースライン確立 or 変更なし: 捕捉時点だけ進める
    saveRun(projectDir, { ...run, lastCaptureCommit: head, lastCaptureAt: now })
    process.exit(0)
  }

  const { diff, paths } = diffBetween(projectDir, base, head)
  if (paths.length === 0) {
    saveRun(projectDir, { ...run, lastCaptureCommit: head, lastCaptureAt: now })
    process.exit(0)
  }

  const first = path.basename(paths[0])
  const title =
    paths.length === 1
      ? `${first} の diff`
      : `${first} ほか ${paths.length - 1} ファイルの diff`
  const item: ReviewItem = {
    type: "diff",
    title,
    agent: input.agent_type ?? input.agent_id ?? "subagent",
    paths,
    base: base.slice(0, 7),
    head: head.slice(0, 7),
    body: `\`\`\`diff\n${diff.trimEnd()}\n\`\`\`\n`
  }
  const res = writeReviewItem(projectDir, run, item)
  saveRun(projectDir, {
    ...res.run,
    lastCaptureCommit: head,
    lastCaptureAt: now
  })
} catch (err) {
  logError(projectDir, "capture-subagent-stop", err)
}
process.exit(0)
```

- [ ] **Step 7: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 8: hooks.json・build.ts・package.json を作成**

`plugins/pitcrew/hooks/hooks.json`(PostToolUse は Task 7・8 で追記):

```json
{
  "description": "pitcrew 捕捉層: サブエージェント完了時に diff を .pitcrew/review/ へ書き出す",
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-subagent-stop.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`plugins/pitcrew/build.ts`:

```typescript
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26"
})
```

`plugins/pitcrew/package.json` に build スクリプトを追加(全文):

```json
{
  "name": "pitcrew-scripts",
  "version": "0.1.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

- [ ] **Step 9: バンドルを生成して確認**

Run: `pnpm build`
Expected: `plugins/pitcrew/scripts/capture-subagent-stop.mjs` が生成される(他プラグインのビルドもエラーなし)

- [ ] **Step 10: lint・型チェックとコミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew
git commit -m "feat: pitcrew SubagentStop diff 捕捉フック"
```

### Task 7: PostToolUse 成果物ファイル捕捉

**Files:**
- Create: `plugins/pitcrew/src/lib/capture-rules.ts`(このタスクでは成果物パス判定のみ。テストコマンド照合は Task 8 で追加)
- Create: `plugins/pitcrew/src/hooks/capture-post-tool-use.ts`
- Modify: `plugins/pitcrew/hooks/hooks.json`(PostToolUse エントリ追加)
- Modify: `plugins/pitcrew/build.ts`(エントリポイント追加)
- Test: `plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
- Test: `plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic`(Task 1)、`parseFrontmatter`(Task 2)、`loadRun` / `saveRun` / `pitcrewDir`(Task 3)、`headCommit`(Task 4)、`writeReviewItem` / `renderReviewItem` / `ReviewItem`(Task 5)、`readStdinSync` / `resolveProjectDir` / `logError` / `HookInput`(Task 6)
- Produces:
  - `isArtifactPath(relPath: string): boolean` — Stage 1 の既定 glob `docs/**/*.md`(`docs/chat/` 配下は除外)に一致するか。パスは `/` 区切りのリポジトリ相対
  - `findReviewItemForPath(projectDir: string, type: string, relPath: string): { file: string; id: string } | null` — `.pitcrew/review/` の既存項目から同一 type・同一パス(paths が単一要素で一致)のものを探す。**同一ファイルの連続 Write/Edit で review/ が項目だらけにならないよう、既存項目があれば同じ ID のまま上書き更新する(コアレス)**。`reviewed/` へ移動済みの項目は探さない(人間が承認済みなら新しい変更は新項目)
  - hook 契約(Task 8 と共通): PostToolUse の stdin JSON(`tool_name` / `tool_input` / `tool_response`)を受け、Write/Edit なら成果物捕捉、Bash なら Task 8 のテスト結果捕捉(このタスクでは Bash は黙って exit 0)。常に exit 0・stdout 出力なし
  - 成果物項目の内容: ファイル全文を 4 連バッククォートのフェンス(` ````markdown `)で埋め込む(成果物自体が Markdown でコードフェンスを含み得るため)。Edit の場合は `tool_input.old_string` / `new_string` を「変更概要」として併記(設計書 §4「更新の場合は変更前後の diff も併記」の Stage 1 実装。PostToolUse 時点で変更前ファイルは失われているため、機械的に得られる old/new 文字列を使う)

- [ ] **Step 1: capture-rules(パス判定)の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`:

```typescript
import { expect, test } from "vitest"
import { isArtifactPath } from "../capture-rules.js"

test("docs/ 配下の .md は成果物", () => {
  expect(isArtifactPath("docs/design.md")).toBe(true)
  expect(isArtifactPath("docs/superpowers/specs/x.md")).toBe(true)
})

test("docs/chat/ 配下は除外", () => {
  expect(isArtifactPath("docs/chat/2026/0716/x.md")).toBe(false)
})

test("docs/ 外や .md 以外は成果物でない", () => {
  expect(isArtifactPath("src/a.ts")).toBe(false)
  expect(isArtifactPath("README.md")).toBe(false)
  expect(isArtifactPath("docs/image.png")).toBe(false)
})

test("Windows 区切りでも判定できる", () => {
  expect(isArtifactPath("docs\\design.md")).toBe(true)
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
Expected: FAIL(`Cannot find module '../capture-rules.js'` 相当)

- [ ] **Step 3: capture-rules.ts(パス判定+コアレス)を実装**

`plugins/pitcrew/src/lib/capture-rules.ts`:

```typescript
import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"
import { pitcrewDir } from "./run.js"

// 捕捉対象の判定ルール(設計書 §4)。Stage 1 は既定値ハードコード
// (config による glob / コマンド追加は Stage 3)。

// 成果物ファイルの既定対象: docs/**/*.md。ただし docs/chat/ は
// このリポジトリの chat 記録(閲覧制限あり・レビュー対象外)なので除外する。
export function isArtifactPath(relPath: string): boolean {
  const p = relPath.replaceAll("\\", "/")
  return (
    p.startsWith("docs/") && p.endsWith(".md") && !p.startsWith("docs/chat/")
  )
}

// 同一 type・同一パスの未レビュー項目を探す(連続 Write/Edit のコアレス用)。
// reviewed/ へ移動済みの項目は対象外 — 承認後の変更は新項目として扱う。
export function findReviewItemForPath(
  projectDir: string,
  type: string,
  relPath: string
): { file: string; id: string } | null {
  const reviewDir = path.join(pitcrewDir(projectDir), "review")
  let names: string[]
  try {
    names = fs.readdirSync(reviewDir)
  } catch {
    return null
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    const file = path.join(reviewDir, name)
    let data: Record<string, string | string[]>
    try {
      data = parseFrontmatter(fs.readFileSync(file, "utf8")).data
    } catch {
      continue
    }
    const paths = data.paths
    if (
      data.type === type &&
      typeof data.id === "string" &&
      Array.isArray(paths) &&
      paths.length === 1 &&
      paths[0] === relPath
    )
      return { file, id: data.id }
  }
  return null
}
```

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 4: PostToolUse hook の失敗する統合テストを書く**

`plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../../lib/frontmatter.js"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../capture-post-tool-use.ts", import.meta.url))

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-ptu-"))
}

function runHook(dir: string, input: Record<string, unknown>): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function reviewFiles(dir: string): string[] {
  const reviewDir = path.join(dir, ".pitcrew", "review")
  return fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir).sort() : []
}

function writeArtifact(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

test("docs/ 配下への Write で artifact 項目が作られる", () => {
  const dir = makeProject()
  try {
    const abs = writeArtifact(dir, "docs/design.md", "# 設計\n本文\n")
    const out = runHook(dir, {
      tool_name: "Write",
      tool_input: { file_path: abs, content: "# 設計\n本文\n" }
    })
    expect(out.trim()).toBe("")
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^001-artifact-/)
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    const { data, body } = parseFrontmatter(raw)
    expect(data.type).toBe("artifact")
    expect(data.paths).toEqual(["docs/design.md"])
    expect(body).toContain("# 設計")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("Edit は old/new の変更概要を併記する", () => {
  const dir = makeProject()
  try {
    const abs = writeArtifact(dir, "docs/design.md", "# 設計\n新しい方針\n")
    runHook(dir, {
      tool_name: "Edit",
      tool_input: {
        file_path: abs,
        old_string: "古い方針",
        new_string: "新しい方針"
      }
    })
    const files = reviewFiles(dir)
    const body = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    expect(body).toContain("古い方針")
    expect(body).toContain("新しい方針")
    expect(body).toContain("変更概要")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("同一ファイルへの連続 Write は同じ項目を上書きする(コアレス)", () => {
  const dir = makeProject()
  try {
    const abs = writeArtifact(dir, "docs/design.md", "v1\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    fs.writeFileSync(abs, "v2\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    expect(parseFrontmatter(raw).data.id).toBe("001")
    expect(raw).toContain("v2")
    expect(raw).not.toContain("v1")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("対象外パス(src/ や docs/chat/)は何もしない", () => {
  const dir = makeProject()
  try {
    const abs1 = writeArtifact(dir, "src/a.ts", "code")
    const abs2 = writeArtifact(dir, "docs/chat/x.md", "chat")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs1 } })
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs2 } })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("プロジェクト外の file_path は無視する", () => {
  const dir = makeProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-out-"))
  try {
    const abs = path.join(outside, "docs", "x.md")
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, "x")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test("壊れた stdin でも exit 0 で素通しする", () => {
  expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
})
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`
Expected: FAIL(hook ファイルが存在しない)

- [ ] **Step 6: capture-post-tool-use.ts を実装(Write/Edit のみ。Bash 分岐は Task 8)**

`plugins/pitcrew/src/hooks/capture-post-tool-use.ts`:

```typescript
#!/usr/bin/env node
// PostToolUse フック(設計書 §4): Write/Edit による成果物ファイル
// (docs/**/*.md)の作成・更新を review/ に捕捉する。Bash(テスト・ビルド結果)は
// Task 8 で追加。全経路フェイルオープン。
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import { findReviewItemForPath, isArtifactPath } from "../lib/capture-rules.js"
import { headCommit } from "../lib/git.js"
import {
  type HookInput,
  logError,
  readStdinSync,
  resolveProjectDir
} from "../lib/hook-io.js"
import {
  type ReviewItem,
  renderReviewItem,
  writeReviewItem
} from "../lib/review.js"
import { loadRun, saveRun } from "../lib/run.js"

function captureArtifact(projectDir: string, input: HookInput): void {
  const filePath = input.tool_input?.file_path
  if (typeof filePath !== "string") return
  const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
  if (rel.startsWith("..") || path.isAbsolute(rel)) return // プロジェクト外
  if (!isArtifactPath(rel)) return

  let content: string
  try {
    content = fs.readFileSync(filePath, "utf8")
  } catch {
    return // 消えている等 — 何もしない
  }

  const sections = [`\`\`\`\`markdown\n${content.trimEnd()}\n\`\`\`\``]
  const oldStr = input.tool_input?.old_string
  const newStr = input.tool_input?.new_string
  if (typeof oldStr === "string" && typeof newStr === "string") {
    sections.push(
      [
        "## 変更概要",
        "",
        "変更前:",
        `\`\`\`\`\n${oldStr}\n\`\`\`\``,
        "変更後:",
        `\`\`\`\`\n${newStr}\n\`\`\`\``
      ].join("\n")
    )
  }

  const item: ReviewItem = {
    type: "artifact",
    title: `${rel} の${input.tool_name === "Write" ? "作成・更新" : "更新"}`,
    agent: input.agent_type ?? "session",
    paths: [rel],
    base: null,
    head: headCommit(projectDir),
    body: sections.join("\n\n")
  }

  // 同一ファイルの未レビュー項目があれば同じ ID のまま上書き(コアレス)
  const existing = findReviewItemForPath(projectDir, "artifact", rel)
  if (existing) {
    writeFileAtomic(
      existing.file,
      renderReviewItem(existing.id, item, new Date())
    )
    return
  }
  const run = loadRun(projectDir)
  const res = writeReviewItem(projectDir, run, item)
  saveRun(projectDir, res.run)
}

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    captureArtifact(projectDir, input)
  }
  // Bash(テスト・ビルド結果)の捕捉は Task 8 で追加
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err)
}
process.exit(0)
```

- [ ] **Step 7: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 8: hooks.json と build.ts にエントリを追加**

`plugins/pitcrew/hooks/hooks.json` 全文を差し替え:

```json
{
  "description": "pitcrew 捕捉層: サブエージェント完了時の diff と、成果物ファイル(docs/**/*.md)の作成・更新を .pitcrew/review/ へ書き出す",
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-subagent-stop.mjs\"",
            "timeout": 15
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-post-tool-use.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`plugins/pitcrew/build.ts` の entryPoints を差し替え:

```typescript
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts",
    "capture-post-tool-use": "./src/hooks/capture-post-tool-use.ts"
  },
```

- [ ] **Step 9: ビルド・lint・型チェックとコミット**

```bash
pnpm build && pnpm lint && pnpm typecheck
git add plugins/pitcrew
git commit -m "feat: pitcrew PostToolUse 成果物ファイル捕捉"
```

### Task 8: PostToolUse テスト・ビルド結果捕捉

**Files:**
- Modify: `plugins/pitcrew/src/lib/capture-rules.ts`(コマンド照合+結果抽出を追加)
- Modify: `plugins/pitcrew/src/hooks/capture-post-tool-use.ts`(Bash 分岐を追加)
- Modify: `plugins/pitcrew/hooks/hooks.json`(matcher に Bash を追加)
- Test: `plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`(追記)
- Test: `plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`(追記)

**Interfaces:**
- Consumes: Task 7 と同じ(`writeReviewItem` / `loadRun` / `saveRun` / `headCommit` / hook-io)
- Produces(`capture-rules.ts` 追加分):
  - `matchTestCommand(command: string): string | null` — Bash の command 文字列を既定ホワイトリストと**前方一致**で照合(設計書 §4)。一致したらそのパターン文字列、しなければ null。既定リスト: `pnpm test` / `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm vitest` / `npm test` / `npm run test` / `npm run build` / `yarn test` / `yarn build` / `npx vitest` / `vitest` / `pytest` / `go test` / `cargo test` / `make test` / `make build`(config による追加は Stage 3)
  - `extractBashResult(toolResponse: unknown): { output: string; failed: boolean }` — PostToolUse の `tool_response` から出力テキストを取り出す。オブジェクトなら `stdout` / `stderr` フィールド(文字列のもの)を連結、文字列ならそのまま、それ以外は `""`。`failed` は「`tool_response` に数値の `exit_code` / `exitCode` / `code` があり非 0」または「出力末尾付近に `FAIL` / `failed` / `Error` を含む」の機械的推定(PostToolUse は成功時しか発火しないバージョンもあるため、終了コードが得られない場合のフォールバック)
  - `summarizeOutput(output: string, maxLines?: number): string` — 出力の**末尾** `maxLines`(既定 120)行を返す(テスト結果は末尾にサマリが出るため)。切り詰めた場合は先頭に省略注記
- hook の Bash 分岐: `matchTestCommand` に一致した場合のみ `type: "test"` のレビュー項目を作る(ホワイトリスト方式 — 全 Bash 出力を無差別に取り込まない。設計書 §4)。テスト実行は毎回新しい項目(成果物のようなコアレスはしない — 各実行結果が独立したレビュー対象)

- [ ] **Step 1: capture-rules 追加分の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/capture-rules.test.ts` の末尾に追加(import に `extractBashResult, matchTestCommand, summarizeOutput` を追加):

```typescript
test("既定ホワイトリストのコマンドに前方一致でマッチする", () => {
  expect(matchTestCommand("pnpm test")).toBe("pnpm test")
  expect(
    matchTestCommand("pnpm vitest run plugins/pitcrew/src/lib/__test__/a.test.ts")
  ).toBe("pnpm vitest")
  expect(matchTestCommand("npm run build --workspace x")).toBe("npm run build")
  expect(matchTestCommand("git status")).toBeNull()
  expect(matchTestCommand("echo pnpm test")).toBeNull()
})

test("extractBashResult は stdout/stderr を連結し失敗を推定する", () => {
  expect(
    extractBashResult({ stdout: "1 passed", stderr: "" })
  ).toEqual({ output: "1 passed", failed: false })
  expect(
    extractBashResult({ stdout: "Tests: 1 failed", stderr: "" }).failed
  ).toBe(true)
  expect(extractBashResult({ stdout: "ok", exit_code: 1 }).failed).toBe(true)
  expect(extractBashResult("plain output").output).toBe("plain output")
  expect(extractBashResult(null)).toEqual({ output: "", failed: false })
})

test("summarizeOutput は末尾 N 行に切り詰めて注記する", () => {
  const long = Array.from({ length: 300 }, (_, i) => `line${i}`).join("\n")
  const out = summarizeOutput(long, 100)
  expect(out.split("\n").length).toBeLessThanOrEqual(102)
  expect(out).toContain("line299")
  expect(out).not.toContain("line0\n")
  expect(out).toContain("省略")
  expect(summarizeOutput("short", 100)).toBe("short")
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
Expected: FAIL(`matchTestCommand` 等が存在しない)

- [ ] **Step 3: capture-rules.ts に照合・抽出関数を実装**

`plugins/pitcrew/src/lib/capture-rules.ts` の末尾に追加:

```typescript
// テスト・ビルド系コマンドの既定ホワイトリスト(設計書 §4 の前方一致方式)。
// config による追加は Stage 3。
const TEST_COMMAND_PREFIXES = [
  "pnpm test",
  "pnpm build",
  "pnpm typecheck",
  "pnpm lint",
  "pnpm vitest",
  "npm test",
  "npm run test",
  "npm run build",
  "yarn test",
  "yarn build",
  "npx vitest",
  "vitest",
  "pytest",
  "go test",
  "cargo test",
  "make test",
  "make build"
]

export function matchTestCommand(command: string): string | null {
  const trimmed = command.trimStart()
  for (const prefix of TEST_COMMAND_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) return prefix
  }
  return null
}

// PostToolUse の tool_response から出力と成否の機械的推定を取り出す。
// 終了コードが渡されないバージョンもあるため、出力の失敗マーカーで補完する。
export function extractBashResult(toolResponse: unknown): {
  output: string
  failed: boolean
} {
  let output = ""
  let exitCode: number | null = null
  if (typeof toolResponse === "string") {
    output = toolResponse
  } else if (toolResponse && typeof toolResponse === "object") {
    const r = toolResponse as Record<string, unknown>
    const parts: string[] = []
    if (typeof r.stdout === "string" && r.stdout !== "") parts.push(r.stdout)
    if (typeof r.stderr === "string" && r.stderr !== "") parts.push(r.stderr)
    output = parts.join("\n")
    for (const key of ["exit_code", "exitCode", "code"]) {
      if (typeof r[key] === "number") {
        exitCode = r[key] as number
        break
      }
    }
  }
  const failed =
    (exitCode !== null && exitCode !== 0) ||
    /\b(FAIL|failed|Error)\b/.test(output.slice(-2000))
  return { output, failed }
}

export function summarizeOutput(output: string, maxLines = 120): string {
  const lines = output.split("\n")
  if (lines.length <= maxLines) return output
  return [
    `> (先頭 ${lines.length - maxLines} 行を省略)`,
    ...lines.slice(-maxLines)
  ].join("\n")
}
```

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 4: hook 統合テスト(Bash 分岐)の失敗するテストを追記**

`plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts` の末尾に追加:

```typescript
test("ホワイトリストの Bash コマンドで test 項目が作られる", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "Tests  12 passed (12)", stderr: "" }
    })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^001-test-/)
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    const { data, body } = parseFrontmatter(raw)
    expect(data.type).toBe("test")
    expect(body).toContain("pnpm test")
    expect(body).toContain("12 passed")
    expect(body).toContain("成功")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("失敗出力は「失敗の疑い」として記録される", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "Tests  1 failed | 11 passed", stderr: "" }
    })
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", reviewFiles(dir)[0]),
      "utf8"
    )
    expect(raw).toContain("失敗の疑い")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("ホワイトリスト外の Bash コマンドは何もしない", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "git status" },
      tool_response: { stdout: "clean", stderr: "" }
    })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`
Expected: FAIL(Bash 分岐が未実装のため 3 件失敗)

- [ ] **Step 5: hook に Bash 分岐を実装**

`plugins/pitcrew/src/hooks/capture-post-tool-use.ts` を修正。import に追加:

```typescript
import {
  extractBashResult,
  findReviewItemForPath,
  isArtifactPath,
  matchTestCommand,
  summarizeOutput
} from "../lib/capture-rules.js"
```

`captureArtifact` の後に関数を追加:

```typescript
function captureTestResult(projectDir: string, input: HookInput): void {
  const command = input.tool_input?.command
  if (typeof command !== "string") return
  const matched = matchTestCommand(command)
  if (!matched) return

  const { output, failed } = extractBashResult(input.tool_response)
  const status = failed ? "失敗の疑い" : "成功"
  const body = [
    `- コマンド: \`${command}\``,
    `- 結果: ${status}(出力からの機械的推定)`,
    "",
    "## 出力(末尾)",
    "",
    `\`\`\`\n${summarizeOutput(output).trimEnd()}\n\`\`\``
  ].join("\n")

  const item: ReviewItem = {
    type: "test",
    title: `${matched} の実行結果: ${status}`,
    agent: input.agent_type ?? "session",
    paths: [],
    base: null,
    head: headCommit(projectDir),
    body
  }
  const run = loadRun(projectDir)
  const res = writeReviewItem(projectDir, run, item)
  saveRun(projectDir, res.run)
}
```

末尾の分岐を差し替え:

```typescript
try {
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    captureArtifact(projectDir, input)
  } else if (input.tool_name === "Bash") {
    captureTestResult(projectDir, input)
  }
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err)
}
process.exit(0)
```

注意: `writeReviewItem` は `paths` が空のときスラッグに `title` を使う(Task 5 実装参照)。`slugify("pnpm test の実行結果: 成功")` は日本語部分が落ちて `pnpm-test` になり、ファイル名は `001-test-pnpm-test.md` となる。テストの期待 `/^001-test-/` は type 部分までしか見ていないため、スラッグの揺れでは壊れない。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`
Expected: PASS(9 tests)

- [ ] **Step 7: hooks.json の matcher に Bash を追加**

`plugins/pitcrew/hooks/hooks.json` の PostToolUse を差し替え(matcher の追加のみ。エントリを分けるのは対象ツールの意図を明示するため):

```json
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-post-tool-use.mjs\"",
            "timeout": 15
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-post-tool-use.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
```

あわせて `description` を更新: `"pitcrew 捕捉層: サブエージェント完了時の diff・成果物ファイル(docs/**/*.md)・テスト/ビルド結果を .pitcrew/review/ へ書き出す"`

- [ ] **Step 8: ビルド・lint・型チェックとコミット**

```bash
pnpm build && pnpm lint && pnpm typecheck
git add plugins/pitcrew
git commit -m "feat: pitcrew PostToolUse テスト・ビルド結果捕捉"
```

### Task 9: README・バンドル生成・全体検証

**Files:**
- Create: `plugins/pitcrew/README.md`
- Verify: `plugins/pitcrew/scripts/*.mjs`(バンドルが最新か)、全テスト・lint・typecheck

**Interfaces:**
- Consumes: Task 1-8 のすべて(ドキュメント化と検証のみ。新しいコードなし)
- Produces: 利用者向けドキュメント(C 方式の使い方・`.pitcrew/` の構造・リセット方法・`.gitignore` 推奨)

- [ ] **Step 1: README.md を書く**

`plugins/pitcrew/README.md`:

````markdown
# pitcrew

オーケストレーション実行中の「待ち時間」を人間の並走レビュー時間に変えるプラグイン。

サブエージェントが完了するたびの diff、設計書等の成果物ファイル(`docs/**/*.md`)、
テスト・ビルド結果を `.pitcrew/review/` に逐次書き出します。人間はエディタでそれを
開いてその場でレビューできます(Stage 1 時点。コメントのセッションへの注入・
専用ビューア・設定コマンドは後続ステージで追加予定)。

設計書: `docs/superpowers/specs/2026-07-16-pitcrew-design.md`

## 使い方(Stage 1: エディタ直接方式)

1. プラグインを有効にしてオーケストレーションを実行する
2. サブエージェントの完了やテスト実行のたびに `.pitcrew/review/NNN-*.md` が増える
3. エディタで開いてレビューする
   - frontmatter に種別(diff / artifact / test)・発生元エージェント・対象パス・base/head が入っている
   - レビューし終えた項目は `.pitcrew/reviewed/` に手で移動する(任意)
4. コメントは各項目末尾のテンプレートに従い `.pitcrew/comments/c-<連番>.md` に保存する
   (Stage 1 ではまだセッションに注入されない。Stage 2 で注入層が入る)

## `.pitcrew/` の構造

```
.pitcrew/
├── run.json     # 実行状態(diff の base・レビュー ID 採番)
├── review/      # レビューキュー(捕捉層が書く)
├── reviewed/    # レビュー済み(人間が移動)
├── comments/    # コメント(人間が書く。注入は Stage 2)
└── log/         # 捕捉スクリプトのエラーログ
```

- `.pitcrew/` は `.gitignore` への追加を推奨
- リセットしたいときは `.pitcrew/` を丸ごと削除(全状態がこの配下に閉じている)

## 開発

- ソース: `src/`(TypeScript)。`pnpm build` で `scripts/*.mjs` にバンドル(git 管理)
- テスト: リポジトリルートで `pnpm test`(vitest)
- 依存: Node 標準ライブラリと git CLI のみ
````

- [ ] **Step 2: 全体検証を実行**

Run: `pnpm build && git status --porcelain plugins/pitcrew/scripts`
Expected: ビルド成功、`scripts/` に未コミット差分がない(あれば直前タスクのコミット漏れ — このコミットに含める)

Run: `pnpm test`
Expected: 全テスト PASS(pitcrew 分: atomic 2 + frontmatter 5 + run 4 + git 6 + review 6 + capture-rules 7 + subagent-stop 5 + post-tool-use 9 = 44 tests。既存プラグインのテストもすべて PASS)

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 3: 手動スモークテスト(実プロジェクトでの動作確認手順)**

このリポジトリ自身で確認する(hook スクリプトを直接叩く):

```bash
cd /tmp && rm -rf pitcrew-smoke && mkdir pitcrew-smoke && cd pitcrew-smoke
git init -q && git commit -qm init --allow-empty
echo "test" > x.ts
echo '{"cwd":"/tmp/pitcrew-smoke","agent_type":"smoke"}' | node <リポジトリ>/plugins/pitcrew/scripts/capture-subagent-stop.mjs
cat .pitcrew/review/001-diff-*.md
```

Expected: `001-diff-x-ts.md` に `+test` を含む diff とコメントテンプレートが出力されている

- [ ] **Step 4: コミット**

```bash
git add plugins/pitcrew/README.md plugins/pitcrew/scripts
git commit -m "docs: pitcrew README(Stage 1 のエディタ直接方式)"
```

---

## Stage 1 で意図的に落としたもの(後続ステージ)

設計書のうち以下は本計画に**含めない**(捕捉層の設計はこれらが載る前提で共有ライブラリを切ってある):

- **注入層**(§6): PreToolUse / Stop hooks、`comments/processed/` への移動、パス一致ルーティング、暴走防止 — Stage 2。`parseFrontmatter`(コメント解析)・`hook-io.ts`・`atomic.ts` を再利用する
- **`/pitcrew:config`**(§7): 捕捉対象の選択・glob / コマンド追加・`.claude/pitcrew.local.md` — Stage 3。Stage 1 は既定値ハードコード(Global Constraints 参照)
- **ブラウザビューア**(§5 A)・**serve.json**: Stage 4。`serve.json` は serve 起動時に生成されるものなので Stage 1 のスキーマ実装対象外
- **TUI ビューア**(§5 B): Stage 5
- **`reviewed/` への移動操作の自動化**: C 方式ではエディタ / シェルで人間が手動移動(README に記載)。ボタン / キー操作は Stage 4・5 のビューアが提供
- **skills/pitcrew/SKILL.md**(§8): 「注入を受けた側の振る舞い」の作法は注入層(Stage 2)が入るまで意味を持たないため Stage 2 に送る
- **run.json の `phase`**(§3): フィールドとして型定義に予約済み(Task 3)だが、書き込む処理はない(将来の codiel 連携)

## 設計書からの解釈(落としたのではなく実装方法を確定したもの)

- **成果物ファイルの捕捉タイミング**(§4 の表は「SubagentStop + PostToolUse(Write/Edit)」): 専用の artifact 項目は PostToolUse で書き込み直後に作る(サブエージェント完了を待つより速い)。SubagentStop 側では docs/ の変更も diff 項目の中に自然に含まれるため、SubagentStop に artifact 専用の捕捉処理は重複実装しない
- **diff の base**(§4 の「`git stash create` 相当で得る一時 commit、または HEAD」): 一時 index + `git write-tree` による tree オブジェクトで実装(Task 4 参照。stash create は未追跡ファイル非対応・コミットゼロで失敗するため)。`run.json.lastCaptureCommit` のフィールド名は設計書のまま、値は tree hash
- **巨大項目の切り詰め**(§3 の「先頭 N 行+全文へのパス参照」): N=600。全文への参照は「作業ツリーの対象ファイルを参照」という注記で満たす(捕捉時点の全文を別ファイルに複製保存することはしない — YAGNI)

