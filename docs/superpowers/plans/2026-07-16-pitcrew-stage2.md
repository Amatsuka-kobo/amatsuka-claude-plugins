# Pitcrew Stage 2(注入層+並行競合対策)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 人間が `.pitcrew/comments/` に書いたレビューコメントを、urgent は PreToolUse(パス一致・即時)、normal はターン境界(Stop)で実行中セッションへ注入し、あわせて Stage 1 の既知制限だった捕捉 hook の並行競合を解決する。

**Architecture:** コメント回収は「`comments/` → `comments/processed/` への rename」自体を所有権の獲得(クレーム)とし、rename に成功した hook だけが注入する(ロック不要・重複注入なし・at-most-once)。`run.json` の read-modify-write は `.pitcrew/run.lock` のアドバイザリロック(`O_CREAT|O_EXCL` + stale 回収 + フェイルオープン)で直列化する。注入は PreToolUse の `hookSpecificOutput.additionalContext`(権限フローに介入しない)と Stop の `decision: "block"` + `reason` を使う。

**Tech Stack:** TypeScript(strict / ESM)→ esbuild バンドル(`.mjs`)、vitest、Node >= 26 標準ライブラリのみ(外部ランタイム依存ゼロ)、git CLI。Stage 1 の共有ライブラリ(`src/lib/`)を再利用・拡張する。

**Design doc:** `docs/superpowers/specs/2026-07-16-pitcrew-design.md`(§3 スキーマ・§6 注入層/並行動作と競合の解決・§9 エラーハンドリング・§10 テスト方針・§10.5 既知の制限が Stage 2 の対象)

## Global Constraints

- **Anthropic API 不使用・LLM 呼び出し禁止**: 全処理は機械的スクリプトのみ(リポジトリ共通制約)
- **フェイルオープン**: hooks は全経路で、失敗時に何も出力せず exit 0。例外は `.pitcrew/log/errors.log` に追記して黙って続行。セッション進行を絶対に阻害しない。**ロック取得のタイムアウト時もロックなしで処理を続行する**(設計書 §6)
- **注入は権限フローに介入しない**: PreToolUse hook は `permissionDecision` を返さず `additionalContext` のみを返す(ツール実行を妨げない)
- **原子的書き込み**: ファイル書き込みは「同一ディレクトリ内の一時ファイル → rename」。ロックは `run.json` の read-modify-write 区間のみ(設計書 §6/§9)
- **ディレクトリ自動作成**: `.pitcrew/` とサブディレクトリは hooks が必要時に `mkdir -p` 相当で作成
- **バンドル出力を git 管理**: `src/` を変更したら `pnpm build` を実行し `scripts/*.mjs` の差分もコミット(利用者はビルド不要)
- **外部ランタイム依存ゼロ**: 依存は `node:*` モジュールと git CLI のみ。devDependencies はルート共有を使い、プラグイン package.json に依存を追加しない
- **esbuild 設定**: `platform: "node"`, `format: "esm"`, `target: "node26"`, `outExtension: { ".js": ".mjs" }`(Stage 1 の `build.ts` にエントリ追加のみ)
- **テスト**: vitest。`plugins/**/__test__/**/*.test.ts` に配置。TDD(失敗するテスト → 実装 → パス → コミット)。root の testTimeout は 20s
- **lint/format**: biome(double quote / semicolons asNeeded / trailingCommas none / lineWidth 80 / インデント 2)。`scripts/` は biome 対象外
- **コードスタイル**: Stage 1 の既存ソースに合わせる(セミコロンなし・日本語コメントは設計書参照付き)
- **Stage 2 の既定値はハードコード**(config は Stage 3): 注入タイミングはハイブリッド固定(urgent = PreToolUse / normal + 取り残し urgent = Stop)
- **additionalContext の上限**: 10,000 文字(Claude Code 仕様)。注入テキストは 9,000 文字で切り詰め、全文参照(processed/ のファイル名)を付記する(1,000 文字はマルチバイト・ハーネス側の付帯テキストへの安全マージン)
- **クレーム敗北はエラーではない**: `claimComment` の失敗(他プロセスが先に rename 済み)は設計どおりの正常動作なのでログに記録しない。`.pitcrew/log/errors.log` に書くのは想定外の例外だけ
- **バージョン**: 完了時に `plugins/pitcrew/.claude-plugin/plugin.json` を `0.6.0-dev` → `0.7.0-dev` に上げる(マイナー更新・自動判断の範囲)

## Stage 1 からの引き継ぎ事項(このプランで解消するもの)

- 並行競合(設計書 §10.5)→ Task 1-2 で解決
- `atomic.ts` の writeFileSync 失敗時に `.tmp-*` が残留 → Task 1 で解消
- `frontmatter.ts` の parse が unquoted 値の末尾空白を trim しない(手書きコメントで顕在化)→ Task 3 で解消
- `capture-post-tool-use.ts` 冒頭コメントの「Task 8 で追加」という計画参照 → Task 2 で削除

---

## File Structure

```
plugins/pitcrew/
├── build.ts                              # 修正: inject 2 エントリ追加
├── hooks/hooks.json                      # 修正: PreToolUse / Stop 登録
├── scripts/                              # バンドル出力(inject-*.mjs が増える)
├── skills/pitcrew/SKILL.md               # 新規: コメント対応の作法(注入を受けた側)
├── README.md                             # 修正: 注入層の使い方を追記
├── .claude-plugin/plugin.json            # 修正: 0.7.0-dev
└── src/
    ├── lib/
    │   ├── atomic.ts                     # 修正: tmp 残留の解消(try/catch cleanup)
    │   ├── frontmatter.ts                # 修正: unquoted 値の末尾空白 trim
    │   ├── lock.ts                       # 新規: run.lock アドバイザリロック
    │   ├── comments.ts                   # 新規: コメント列挙・パス照合・クレーム・注入文生成
    │   └── __test__/{lock,comments}.test.ts
    │   └── __test__/helpers/lock-contender.ts  # 並行テスト用の子プロセススクリプト
    ├── hooks/
    │   ├── capture-subagent-stop.ts      # 修正: run.json 区間を withRunLock で直列化
    │   ├── capture-post-tool-use.ts      # 修正: 同上+stale コメント削除
    │   ├── inject-pre-tool-use.ts        # 新規: urgent のパス一致注入
    │   ├── inject-stop.ts                # 新規: ターン境界の一括差し戻し
    │   └── __test__/{inject-pre-tool-use,inject-stop}.test.ts
    └── testing/run-ts.ts                 # 修正: 非同期版 runTsAsync を追加(並行テスト用)
```

責務境界は Stage 1 と同じ: `src/hooks/*` は「stdin 読取 → lib 呼び出し → フェイルオープン」の薄い結線のみ。判定・生成ロジックは `src/lib/*` に置き vitest で直接テスト。hook スクリプトは fixture stdin の統合テスト(`runTs`)で契約(stdout / exit code / ファイル移動)を検証する。

## Tasks(一覧)

- **Task 1:** `lock.ts`(run.lock アドバイザリロック)+ `atomic.ts` の tmp 残留解消
- **Task 2:** 捕捉 hooks へのロック適用+並行直列化の統合テスト
- **Task 3:** `frontmatter.ts` trim 修正+`comments.ts`(列挙・照合・クレーム・注入文生成)
- **Task 4:** `inject-pre-tool-use.ts`(urgent 即時注入 hook)
- **Task 5:** `inject-stop.ts`(ターン境界の一括差し戻し hook)
- **Task 6:** hooks.json / build.ts 登録とバンドル生成
- **Task 7:** SKILL.md・README・バージョン更新・最終検証

---

### Task 1: run.lock アドバイザリロック(`lock.ts`)+ atomic.ts の tmp 残留解消

**Files:**
- Create: `plugins/pitcrew/src/lib/lock.ts`
- Create: `plugins/pitcrew/src/lib/__test__/lock.test.ts`
- Modify: `plugins/pitcrew/src/lib/atomic.ts`
- Modify: `plugins/pitcrew/src/lib/__test__/atomic.test.ts`(テスト追加)

**Interfaces:**
- Consumes(Stage 1 実装済み・変更しない):
  - `pitcrewDir(projectDir: string): string`(`src/lib/run.ts`)— `<projectDir>/.pitcrew` を返す
  - `loadRun(projectDir: string): RunState` / `saveRun(projectDir: string, run: RunState): void`(`src/lib/run.ts`)— `RunState = { startedAt: string; lastCaptureCommit: string | null; lastCaptureAt: string | null; nextReviewId: number; phase?: string }`。loadRun は run.json 不在・破損時に初期値を返す(throw しない)
  - `logError(projectDir: string, context: string, err: unknown): void`(`src/lib/hook-io.ts`)— `.pitcrew/log/errors.log` へ追記(自身の失敗は握り潰す)
- Produces: `withRunLock<T>(projectDir: string, fn: () => T, opts?: LockOptions): T` — Task 2 が捕捉 hooks で使う。`LockOptions = { waitBudgetMs?: number; staleMs?: number; retryIntervalMs?: number }`(既定 3000 / 10000 / 50。テストで短縮するための注入口)。stale 閾値 10 秒の根拠: ロックで包むのは run.json の read-modify-write だけで正常保持はミリ秒オーダー(設計書 §6)

- [ ] **Step 1: lock.ts の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/lock.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { withRunLock } from "../lock.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-lock-"))
}

function lockPath(dir: string): string {
  return path.join(dir, ".pitcrew", "run.lock")
}

test("withRunLock は実行中だけ run.lock を作り、終了後に削除する", () => {
  const dir = makeProject()
  try {
    let seen = false
    const result = withRunLock(dir, () => {
      seen = fs.existsSync(lockPath(dir))
      return 42
    })
    expect(result).toBe(42)
    expect(seen).toBe(true)
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("fn が throw してもロックは解放される", () => {
  const dir = makeProject()
  try {
    expect(() =>
      withRunLock(dir, () => {
        throw new Error("boom")
      })
    ).toThrow("boom")
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stale なロック(mtime が staleMs より古い)は回収して取得する", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(lockPath(dir), '{"pid":0}')
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(lockPath(dir), past, past)
    const result = withRunLock(dir, () => "ok", { staleMs: 10_000 })
    expect(result).toBe("ok")
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("取得できないまま待機予算を使い切ったらロックなしで実行する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(lockPath(dir), '{"pid":0}') // mtime は今 = stale ではない
    const result = withRunLock(dir, () => "ran", {
      waitBudgetMs: 100,
      retryIntervalMs: 20,
      staleMs: 60_000
    })
    expect(result).toBe("ran")
    // 他者のロックは消さない
    expect(fs.existsSync(lockPath(dir))).toBe(true)
    // フェイルオープンの痕跡がログに残る
    const log = fs.readFileSync(
      path.join(dir, ".pitcrew", "log", "errors.log"),
      "utf8"
    )
    expect(log).toContain("run.lock")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/lock.test.ts`
Expected: FAIL(`../lock.js` が存在しない)

- [ ] **Step 3: lock.ts を実装する**

`plugins/pitcrew/src/lib/lock.ts`:

```typescript
import fs from "node:fs"
import path from "node:path"
import { logError } from "./hook-io.js"
import { pitcrewDir } from "./run.js"

// run.json の read-modify-write 区間を直列化するアドバイザリロック(設計書 §6)。
// O_CREAT|O_EXCL("wx")の排他作成で取得し、finally で必ず削除する。
// 取得できない場合はフェイルオープン: ログに記録してロックなしで続行する
// (Stage 1 の既知制限と同じ挙動への劣化。セッションは絶対に止めない)。

export interface LockOptions {
  waitBudgetMs?: number
  staleMs?: number
  retryIntervalMs?: number
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function tryAcquire(lockFile: string): boolean {
  try {
    const fd = fs.openSync(lockFile, "wx")
    fs.writeSync(
      fd,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
    )
    fs.closeSync(fd)
    return true
  } catch {
    return false
  }
}

function acquire(lockFile: string, opts: Required<LockOptions>): boolean {
  const deadline = Date.now() + opts.waitBudgetMs
  for (;;) {
    if (tryAcquire(lockFile)) return true
    // 保持プロセスが hook timeout 等で異常終了した stale ロックは回収する
    try {
      const st = fs.statSync(lockFile)
      if (Date.now() - st.mtimeMs > opts.staleMs) {
        fs.rmSync(lockFile, { force: true })
        continue
      }
    } catch {
      continue // 直前に解放された: 即再試行
    }
    if (Date.now() >= deadline) return false
    sleepSync(opts.retryIntervalMs)
  }
}

export function withRunLock<T>(
  projectDir: string,
  fn: () => T,
  opts: LockOptions = {}
): T {
  const resolved: Required<LockOptions> = {
    waitBudgetMs: opts.waitBudgetMs ?? 3000,
    staleMs: opts.staleMs ?? 10_000,
    retryIntervalMs: opts.retryIntervalMs ?? 50
  }
  const lockFile = path.join(pitcrewDir(projectDir), "run.lock")
  let acquired = false
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true })
    acquired = acquire(lockFile, resolved)
  } catch {
    acquired = false
  }
  if (!acquired)
    logError(
      projectDir,
      "with-run-lock",
      new Error("run.lock を取得できないためロックなしで続行")
    )
  try {
    return fn()
  } finally {
    if (acquired) fs.rmSync(lockFile, { force: true })
  }
}
```

- [ ] **Step 4: lock のテストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/lock.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: atomic.ts の tmp 残留の失敗するテストを追加する**

`plugins/pitcrew/src/lib/__test__/atomic.test.ts` に追加:

```typescript
test("rename が失敗しても一時ファイルを残さない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-atomic-"))
  try {
    // 書き込み先がディレクトリだと renameSync が失敗する
    const target = path.join(dir, "sub")
    fs.mkdirSync(target)
    expect(() => writeFileAtomic(target, "x")).toThrow()
    const leftovers = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(".tmp-"))
    expect(leftovers).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

(既存テストの import に合わせる。`fs`/`os`/`path`/`writeFileAtomic` は既に import 済みのはず — 無ければ追加する)

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/atomic.test.ts`
Expected: FAIL(`.tmp-*` が残留している)

- [ ] **Step 7: atomic.ts を修正する**

`plugins/pitcrew/src/lib/atomic.ts` の `writeFileAtomic` を以下に置き換える:

```typescript
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  )
  try {
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, filePath)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}
```

- [ ] **Step 8: プラグイン全テストを実行してパスを確認する**

Run: `pnpm vitest run plugins/pitcrew`
Expected: PASS(Stage 1 の既存テスト+今回追加分すべて)

- [ ] **Step 9: コミット**

```bash
git add plugins/pitcrew/src/lib/lock.ts plugins/pitcrew/src/lib/__test__/lock.test.ts plugins/pitcrew/src/lib/atomic.ts plugins/pitcrew/src/lib/__test__/atomic.test.ts
git commit -m "feat: pitcrew run.lock アドバイザリロックと tmp 残留解消"
```

---

### Task 2: 捕捉 hooks へのロック適用+並行直列化の統合テスト

**Files:**
- Modify: `plugins/pitcrew/src/hooks/capture-subagent-stop.ts`
- Modify: `plugins/pitcrew/src/hooks/capture-post-tool-use.ts`
- Modify: `plugins/pitcrew/src/testing/run-ts.ts`(`runTsAsync` 追加)
- Create: `plugins/pitcrew/src/lib/__test__/helpers/lock-contender.ts`
- Modify: `plugins/pitcrew/src/lib/__test__/lock.test.ts`(並行テスト追加)

**Interfaces:**
- Consumes: `withRunLock(projectDir, fn)`(Task 1)、`loadRun`/`saveRun`(`src/lib/run.ts`)
- Produces: `runTsAsync(script: string, args?: string[], opts?: ExecFileOptions): Promise<string>`(`src/testing/run-ts.ts`。Task 4-5 のテストでも利用可)

- [ ] **Step 1: runTsAsync を追加する**

`plugins/pitcrew/src/testing/run-ts.ts` に追加:

```typescript
import {
  type ExecFileOptions,
  execFile,
  type ExecFileSyncOptions,
  execFileSync
} from "node:child_process"

// (既存の runTs はそのまま)

// 並行実行テスト用の非同期版。複数の hook プロセスを同時に走らせて
// ロックの直列化を検証する(設計書 §6)。
export function runTsAsync(
  script: string,
  args: string[] = [],
  opts: ExecFileOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [TSX_CLI, script, ...args],
      { encoding: "utf8", ...opts },
      (err, stdout) => (err ? reject(err) : resolve(stdout as string))
    )
  })
}
```

- [ ] **Step 2: 並行コンテンダー(子プロセススクリプト)を作る**

`plugins/pitcrew/src/lib/__test__/helpers/lock-contender.ts`:

```typescript
// 並行テスト用: withRunLock 下で run.json の nextReviewId を count 回インクリメントする。
// vitest からは runTsAsync で複数プロセス同時に起動される。
import { withRunLock } from "../../lock.js"
import { loadRun, saveRun } from "../../run.js"

const [dir, countArg] = process.argv.slice(2)
const count = Number(countArg)
for (let i = 0; i < count; i++) {
  withRunLock(dir, () => {
    const run = loadRun(dir)
    saveRun(dir, { ...run, nextReviewId: run.nextReviewId + 1 })
  })
}
```

- [ ] **Step 3: 並行直列化の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/lock.test.ts` に追加:

```typescript
import { fileURLToPath } from "node:url"
import { runTsAsync } from "../../testing/run-ts.js"

const CONTENDER = fileURLToPath(
  new URL("./helpers/lock-contender.ts", import.meta.url)
)

test("並行プロセスの run.json 更新が直列化され lost update が起きない", async () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".pitcrew", "run.json"),
      JSON.stringify({
        startedAt: "2026-07-16T00:00:00.000Z",
        lastCaptureCommit: null,
        lastCaptureAt: null,
        nextReviewId: 1
      })
    )
    const procs = 4
    const per = 5
    await Promise.all(
      Array.from({ length: procs }, () =>
        runTsAsync(CONTENDER, [dir, String(per)])
      )
    )
    const run = JSON.parse(
      fs.readFileSync(path.join(dir, ".pitcrew", "run.json"), "utf8")
    ) as { nextReviewId: number }
    expect(run.nextReviewId).toBe(1 + procs * per)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 20_000)
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/lock.test.ts`
Expected: PASS(withRunLock が正しければこのテストは最初からパスする。**もし FAIL するならロック実装のバグなので Task 1 に戻る**。このテストの狙いは回帰防止。「ロック無しなら本当に lost update が起きる」逆方向の検証は OS スケジューリング依存で flaky になるため意図的に書かない)

- [ ] **Step 5: capture-subagent-stop.ts にロックを適用する**

`plugins/pitcrew/src/hooks/capture-subagent-stop.ts` の try ブロック内、`loadRun` から `saveRun` までを `withRunLock` で包む(snapshot は共有状態を持たないためロック外に置き、保持時間を最小化する):

```typescript
#!/usr/bin/env node
// SubagentStop フック(設計書 §4): サブエージェント完了時に、直前の捕捉時点からの
// git diff を機械的に生成して .pitcrew/review/ に書き出す。全経路フェイルオープン。
// run.json の read-modify-write は run.lock で直列化する(設計書 §6)。
import path from "node:path"
import { baselineTree, diffBetween, snapshotWorktree } from "../lib/git.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"
import { withRunLock } from "../lib/lock.js"
import { type ReviewItem, writeReviewItem } from "../lib/review.js"
import { loadRun, saveRun } from "../lib/run.js"

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const head = snapshotWorktree(projectDir)
  if (!head) process.exit(0) // git リポジトリでない等 — 何もしない

  withRunLock(projectDir, () => {
    const run = loadRun(projectDir)
    const base = run.lastCaptureCommit ?? baselineTree(projectDir)
    const now = new Date().toISOString()

    if (!base || base === head) {
      // 初回ベースライン確立 or 変更なし: 捕捉時点だけ進める
      saveRun(projectDir, {
        ...run,
        lastCaptureCommit: head,
        lastCaptureAt: now
      })
      return
    }

    const { diff, paths } = diffBetween(projectDir, base, head)
    if (paths.length === 0) {
      saveRun(projectDir, {
        ...run,
        lastCaptureCommit: head,
        lastCaptureAt: now
      })
      return
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
  })
} catch (err) {
  logError(projectDir, "capture-subagent-stop", err)
}
process.exit(0)
```

- [ ] **Step 6: capture-post-tool-use.ts にロックを適用する**

`plugins/pitcrew/src/hooks/capture-post-tool-use.ts` を修正する。変更点は 3 つ:

1. 冒頭コメントから「Bash(テスト・ビルド結果)は Task 8 で追加。」という計画参照を削除し、次に置き換える:

```typescript
#!/usr/bin/env node
// PostToolUse / PostToolUseFailure フック(設計書 §4): Write/Edit による成果物
// ファイル(docs/**/*.md)と Bash のテスト・ビルド結果を review/ に捕捉する。
// 全経路フェイルオープン。run.json の read-modify-write は run.lock で直列化する(設計書 §6)。
```

2. `captureArtifact` の新規項目パス(コアレスに乗らなかった場合)をロックで包む:

```typescript
  // 同一ファイルの未レビュー項目があれば同じ ID のまま上書き(コアレス)
  const existing = findReviewItemForPath(projectDir, "artifact", rel)
  if (existing) {
    writeFileAtomic(
      existing.file,
      renderReviewItem(existing.id, item, new Date())
    )
    return
  }
  withRunLock(projectDir, () => {
    const run = loadRun(projectDir)
    const res = writeReviewItem(projectDir, run, item)
    saveRun(projectDir, res.run)
  })
```

3. `captureTestResult` の末尾も同様に包む:

```typescript
  withRunLock(projectDir, () => {
    const run = loadRun(projectDir)
    const res = writeReviewItem(projectDir, run, item)
    saveRun(projectDir, res.run)
  })
```

import に `import { withRunLock } from "../lib/lock.js"` を追加する。

- [ ] **Step 7: 既存の hook 統合テストがすべてパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew`
Expected: PASS(ロックは透過的なので既存テストは変更不要でパスする)

- [ ] **Step 8: コミット**

```bash
git add plugins/pitcrew/src/hooks/capture-subagent-stop.ts plugins/pitcrew/src/hooks/capture-post-tool-use.ts plugins/pitcrew/src/testing/run-ts.ts plugins/pitcrew/src/lib/__test__/helpers/lock-contender.ts plugins/pitcrew/src/lib/__test__/lock.test.ts
git commit -m "feat: pitcrew 捕捉 hooks の run.json 更新を run.lock で直列化"
```

---

### Task 3: frontmatter trim 修正+`comments.ts`(列挙・照合・クレーム・注入文生成)

**Files:**
- Modify: `plugins/pitcrew/src/lib/frontmatter.ts`
- Modify: `plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`(テスト追加)
- Create: `plugins/pitcrew/src/lib/comments.ts`
- Create: `plugins/pitcrew/src/lib/__test__/comments.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter(text)`(`src/lib/frontmatter.ts`)、`pitcrewDir(projectDir)`(`src/lib/run.ts`)
- Produces(Task 4-5 が使う):
  - `interface PitcrewComment { name: string; file: string; urgency: "urgent" | "normal"; paths: string[]; reviewId: string | null; base: string | null; body: string }` — `name` はファイル名(`c-001.md`)で `claimComment` や注入テキストの見出しに使う。`file` は絶対パスで診断用(クレーム後は無効になる点に注意)
  - `listComments(projectDir: string): PitcrewComment[]` — `comments/` 直下の `*.md` を名前順に返す(`processed/` は含まない。パース不能・読み取り不能はスキップ)
  - `pathMatchesComment(commentPath: string, targetRel: string): boolean` — **第 1 引数がコメント frontmatter 側のパス、第 2 引数がツール入力のリポジトリ相対パス**。完全一致、またはコメント側がツール側の祖先ディレクトリのときに true(設計書 §6)
  - `claimComment(projectDir: string, name: string): boolean` — `comments/<name>` → `comments/processed/<name>` への rename。成功で true、ENOENT 等(他プロセスが先に獲得)で false
  - `renderInjection(comments: PitcrewComment[], maxChars: number): string` — 注入テキスト生成。`maxChars` は**戻り値全体の文字数上限**(切り詰め注記込みでこの長さを超えない)。超過時は本文を切り詰め、`processed/` 配下のファイル名一覧(`.pitcrew/comments/processed/` からの相対名)を注記に付ける

- [ ] **Step 1: frontmatter の末尾空白 trim の失敗するテストを追加する**

`plugins/pitcrew/src/lib/__test__/frontmatter.test.ts` に追加:

```typescript
test("unquoted 値の末尾空白を trim する(手書きコメント対策)", () => {
  const { data } = parseFrontmatter("---\nurgency: urgent  \n---\n本文\n")
  expect(data.urgency).toBe("urgent")
})

test("末尾に空白のあるインライン配列も解釈できる", () => {
  const { data } = parseFrontmatter("---\npaths: [src/a.ts, src/b.ts] \n---\nx\n")
  expect(data.paths).toEqual(["src/a.ts", "src/b.ts"])
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`
Expected: FAIL(`"urgent  "` のように末尾空白が残る)

- [ ] **Step 3: parseFrontmatter を修正する**

`plugins/pitcrew/src/lib/frontmatter.ts` の parse ループ内、値の扱いを `raw` から `value = raw.trimEnd()` に変える:

```typescript
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    // 手書きコメント(設計書 §5 の C 方式)の末尾空白に耐える
    const value = raw.trimEnd()
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim()
      data[key] =
        inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()))
    } else {
      data[key] = unquote(value)
    }
  }
```

- [ ] **Step 4: frontmatter テストのパスを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/frontmatter.test.ts`
Expected: PASS

- [ ] **Step 5: comments.ts の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/comments.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  claimComment,
  listComments,
  pathMatchesComment,
  type PitcrewComment,
  renderInjection
} from "../comments.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-comments-"))
}

function writeComment(dir: string, name: string, content: string): void {
  const commentsDir = path.join(dir, ".pitcrew", "comments")
  fs.mkdirSync(commentsDir, { recursive: true })
  fs.writeFileSync(path.join(commentsDir, name), content)
}

const URGENT = `---
urgency: urgent
paths: [src/auth.ts]
reviewId: "002"
base: a3f2c01
---
この方針はやめて、既存の validate() を使ってください。
`

const NORMAL = `---
urgency: normal
paths: [docs/design.md]
---
設計書の §3 に理由を追記してください。
`

test("listComments は comments/ 直下の md を名前順に返す", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-002.md", NORMAL)
    writeComment(dir, "c-001.md", URGENT)
    // processed/ 内は対象外
    const processed = path.join(dir, ".pitcrew", "comments", "processed")
    fs.mkdirSync(processed, { recursive: true })
    fs.writeFileSync(path.join(processed, "c-000.md"), URGENT)

    const comments = listComments(dir)
    expect(comments.map((c) => c.name)).toEqual(["c-001.md", "c-002.md"])
    expect(comments[0].urgency).toBe("urgent")
    expect(comments[0].paths).toEqual(["src/auth.ts"])
    expect(comments[0].reviewId).toBe("002")
    expect(comments[0].base).toBe("a3f2c01")
    expect(comments[0].body).toContain("validate()")
    expect(comments[1].urgency).toBe("normal")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter の無いコメントは normal・paths 空として扱う", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", "テンプレを使わない手書きコメント\n")
    const comments = listComments(dir)
    expect(comments).toHaveLength(1)
    expect(comments[0].urgency).toBe("normal")
    expect(comments[0].paths).toEqual([])
    expect(comments[0].body).toContain("手書きコメント")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("paths が文字列単体でも配列に正規化する", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", "---\nurgency: urgent\npaths: src/auth.ts\n---\nx\n")
    expect(listComments(dir)[0].paths).toEqual(["src/auth.ts"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("pathMatchesComment は完全一致と祖先ディレクトリでマッチする", () => {
  // 第1引数 = コメント側、第2引数 = ツール入力側
  expect(pathMatchesComment("src/auth.ts", "src/auth.ts")).toBe(true)
  expect(pathMatchesComment("src", "src/auth.ts")).toBe(true)
  expect(pathMatchesComment("src/", "src/auth.ts")).toBe(true)
  expect(pathMatchesComment("src/auth.ts", "src/auth.test.ts")).toBe(false)
  expect(pathMatchesComment("src/auth", "src/auth.ts")).toBe(false)
  expect(pathMatchesComment("", "src/auth.ts")).toBe(false)
  // 逆方向(ツール側が祖先)はマッチしない
  expect(pathMatchesComment("src/auth.ts", "src")).toBe(false)
  // バックスラッシュ区切り(手書きコメントの Windows パス)も正規化して照合する
  expect(pathMatchesComment("src\\auth.ts", "src/auth.ts")).toBe(true)
})

test("claimComment は processed/ へ rename し、二重クレームは失敗する", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT)
    expect(claimComment(dir, "c-001.md")).toBe(true)
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(dir, ".pitcrew", "comments", "processed", "c-001.md")
      )
    ).toBe(true)
    // 既に移動済み → 敗者は false を受けてスキップする(設計書 §6)
    expect(claimComment(dir, "c-001.md")).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("renderInjection はコメントを作成順に連結し、上限超過は切り詰める", () => {
  const short: PitcrewComment = {
    name: "c-001.md",
    file: "/tmp/x/c-001.md",
    urgency: "urgent",
    paths: ["src/auth.ts"],
    reviewId: null,
    base: "a3f2c01",
    body: "コメント本文A"
  }
  const long: PitcrewComment = {
    ...short,
    name: "c-002.md",
    body: "あ".repeat(20_000)
  }
  const text = renderInjection([short], 9000)
  expect(text).toContain("[pitcrew]")
  expect(text).toContain("c-001.md")
  expect(text).toContain("src/auth.ts")
  expect(text).toContain("a3f2c01")
  expect(text).toContain("コメント本文A")

  const truncated = renderInjection([short, long], 9000)
  expect(truncated.length).toBeLessThanOrEqual(9000)
  expect(truncated).toContain("processed/")
  expect(truncated).toContain("c-002.md")
})
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/comments.test.ts`
Expected: FAIL(`../comments.js` が存在しない)

- [ ] **Step 7: comments.ts を実装する**

`plugins/pitcrew/src/lib/comments.ts`:

```typescript
import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"
import { pitcrewDir } from "./run.js"

// コメントの列挙・パス照合・クレーム(設計書 §6)。
// クレームは comments/ → comments/processed/ への rename そのものを所有権の
// 獲得とする。rename は原子的なので、並行する複数 hook が同じコメントを
// 狙っても成功するのは 1 プロセスだけ(重複注入は構造的に起きない)。

export interface PitcrewComment {
  name: string
  file: string
  urgency: "urgent" | "normal"
  paths: string[]
  reviewId: string | null
  base: string | null
  body: string
}

export function commentsDir(projectDir: string): string {
  return path.join(pitcrewDir(projectDir), "comments")
}

export function processedDir(projectDir: string): string {
  return path.join(commentsDir(projectDir), "processed")
}

function asPaths(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value !== "") return [value]
  return []
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

export function listComments(projectDir: string): PitcrewComment[] {
  const dir = commentsDir(projectDir)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const comments: PitcrewComment[] = []
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    const file = path.join(dir, name)
    let raw: string
    try {
      if (!fs.statSync(file).isFile()) continue
      raw = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    const { data, body } = parseFrontmatter(raw)
    comments.push({
      name,
      file,
      urgency: data.urgency === "urgent" ? "urgent" : "normal",
      paths: asPaths(data.paths),
      reviewId: asString(data.reviewId),
      base: asString(data.base),
      body: body.trim()
    })
  }
  return comments
}

// パス照合(設計書 §6): コメントの paths とツール入力パスの単純比較
// (完全一致 or コメント側が祖先ディレクトリ)。決定的で LLM を使わない。
export function pathMatchesComment(
  commentPath: string,
  targetRel: string
): boolean {
  const cp = commentPath.replaceAll("\\", "/").replace(/\/+$/, "")
  if (cp === "") return false
  const target = targetRel.replaceAll("\\", "/")
  return target === cp || target.startsWith(`${cp}/`)
}

export function claimComment(projectDir: string, name: string): boolean {
  try {
    fs.mkdirSync(processedDir(projectDir), { recursive: true })
    fs.renameSync(
      path.join(commentsDir(projectDir), name),
      path.join(processedDir(projectDir), name)
    )
    return true
  } catch {
    return false
  }
}

// 注入テキストの生成。additionalContext / reason の上限に収める
// (超過時は切り詰めて processed/ への参照を付記する。設計書 §6)。
export function renderInjection(
  comments: PitcrewComment[],
  maxChars: number
): string {
  const head =
    `[pitcrew] 人間レビュアーからのコメント(${comments.length} 件)。` +
    "内容を確認し、作業に反映してください。" +
    "base はコメント時点の commit を指すため、対象箇所が既に変わっている場合は" +
    "現状と照合して自分で判断してください。"
  const sections = comments.map((c) => {
    const meta = [
      `urgency: ${c.urgency}`,
      c.paths.length > 0 ? `paths: ${c.paths.join(", ")}` : null,
      c.base ? `base: ${c.base}` : null,
      c.reviewId ? `reviewId: ${c.reviewId}` : null
    ]
      .filter((part) => part !== null)
      .join(" / ")
    return `## ${c.name}(${meta})\n\n${c.body}`
  })
  const text = [head, ...sections].join("\n\n")
  if (text.length <= maxChars) return text
  const note =
    "\n\n> (上限により切り詰め。全文: .pitcrew/comments/processed/ 配下の " +
    `${comments.map((c) => c.name).join(", ")})`
  return text.slice(0, Math.max(0, maxChars - note.length)) + note
}
```

- [ ] **Step 8: テストを実行してパスを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/comments.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 9: コミット**

```bash
git add plugins/pitcrew/src/lib/frontmatter.ts plugins/pitcrew/src/lib/__test__/frontmatter.test.ts plugins/pitcrew/src/lib/comments.ts plugins/pitcrew/src/lib/__test__/comments.test.ts
git commit -m "feat: pitcrew コメントの列挙・パス照合・クレーム・注入文生成"
```

---

### Task 4: `inject-pre-tool-use.ts`(urgent 即時注入 hook)

**Files:**
- Create: `plugins/pitcrew/src/hooks/inject-pre-tool-use.ts`
- Create: `plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`

**Interfaces:**
- Consumes: `listComments` / `pathMatchesComment` / `claimComment` / `renderInjection`(Task 3)、`readStdinSync` / `resolveProjectDir` / `logError`(`src/lib/hook-io.ts`)
- Produces: hook スクリプト契約 — stdin に PreToolUse JSON、マッチする urgent があれば stdout に `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}` を 1 行出力して exit 0。無ければ無出力 exit 0

- [ ] **Step 1: 失敗する統合テストを書く**

`plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(
  new URL("../inject-pre-tool-use.ts", import.meta.url)
)

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-inject-pre-"))
}

function writeComment(dir: string, name: string, content: string): void {
  const commentsDir = path.join(dir, ".pitcrew", "comments")
  fs.mkdirSync(commentsDir, { recursive: true })
  fs.writeFileSync(path.join(commentsDir, name), content)
}

function runHook(dir: string, input: Record<string, unknown>): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function editInput(dir: string, rel: string): Record<string, unknown> {
  return {
    tool_name: "Edit",
    tool_input: { file_path: path.join(dir, rel) }
  }
}

const URGENT_AUTH = `---
urgency: urgent
paths: [src/auth.ts]
---
validate() を使ってください。
`

test("パス一致した urgent は additionalContext で注入され processed/ へ移動する", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse")
    expect(parsed.hookSpecificOutput.additionalContext).toContain("validate()")
    expect(parsed.hookSpecificOutput.additionalContext).toContain("[pitcrew]")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(dir, ".pitcrew", "comments", "processed", "c-001.md")
      )
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("祖先ディレクトリ指定の urgent もマッチする", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: [src]\n---\nsrc 配下の方針変更。\n"
    )
    const out = runHook(dir, editInput(dir, "src/deep/auth.ts"))
    expect(out).toContain("方針変更")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("normal コメントは注入せず comments/ に残す", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: normal\npaths: [src/auth.ts]\n---\n後で見て。\n"
    )
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("パスが一致しない urgent は注入せず残す", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const out = runHook(dir, editInput(dir, "src/other.ts"))
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("複数の urgent が一致した場合は作成順に連結する", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-002.md",
      "---\nurgency: urgent\npaths: [src/auth.ts]\n---\n二つ目。\n"
    )
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: [src/auth.ts]\n---\n一つ目。\n"
    )
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    const context = (
      JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string }
      }
    ).hookSpecificOutput.additionalContext
    expect(context.indexOf("一つ目")).toBeLessThan(context.indexOf("二つ目"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("プロジェクト外のパスや対象外ツールは何もしない", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const outside = runHook(dir, {
      tool_name: "Edit",
      tool_input: { file_path: "/etc/hosts" }
    })
    expect(outside.trim()).toBe("")
    const bash = runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "echo hi" }
    })
    expect(bash.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正な stdin では無出力で正常終了する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const out = runTs(HOOK, [], {
      input: "not json",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
    })
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`
Expected: FAIL(hook ファイルが存在しない)

- [ ] **Step 3: inject-pre-tool-use.ts を実装する**

`plugins/pitcrew/src/hooks/inject-pre-tool-use.ts`:

```typescript
#!/usr/bin/env node
// PreToolUse フック(設計書 §6): ツール入力のパスに一致する urgent コメントを、
// processed/ への rename(クレーム)に成功したものだけ additionalContext で注入する。
// permissionDecision は返さない(権限フローに介入しない)。全経路フェイルオープン。
import path from "node:path"
import {
  claimComment,
  listComments,
  pathMatchesComment,
  renderInjection
} from "../lib/comments.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"

// additionalContext の上限 10,000 文字に対する余裕を持った切り詰め幅
const MAX_INJECT_CHARS = 9000

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const filePath =
    input.tool_name === "Write" || input.tool_name === "Edit"
      ? input.tool_input?.file_path
      : undefined
  if (typeof filePath === "string") {
    const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
    // isAbsolute は Windows の別ドライブ(relative が絶対パスを返すケース)対策。
    // Stage 1 の capture-post-tool-use.ts と同一のガード
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      const matched = listComments(projectDir).filter(
        (c) =>
          c.urgency === "urgent" &&
          c.paths.some((p) => pathMatchesComment(p, rel))
      )
      // rename に成功したコメントだけを注入する(早い者勝ち。設計書 §6)
      const claimed = matched.filter((c) => claimComment(projectDir, c.name))
      if (claimed.length > 0) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: renderInjection(claimed, MAX_INJECT_CHARS)
            }
          })
        )
      }
    }
  }
} catch (err) {
  logError(projectDir, "inject-pre-tool-use", err)
}
process.exit(0)
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/pitcrew/src/hooks/inject-pre-tool-use.ts plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts
git commit -m "feat: pitcrew urgent コメントの PreToolUse 即時注入"
```

---

### Task 5: `inject-stop.ts`(ターン境界の一括差し戻し hook)

**Files:**
- Create: `plugins/pitcrew/src/hooks/inject-stop.ts`
- Create: `plugins/pitcrew/src/hooks/__test__/inject-stop.test.ts`

**Interfaces:**
- Consumes: `listComments` / `claimComment` / `renderInjection`(Task 3)、`readStdinSync` / `resolveProjectDir` / `logError`(`src/lib/hook-io.ts`)
- Produces: hook スクリプト契約 — stdin に Stop JSON、未回収コメント(urgency 問わず)があれば stdout に `{"decision":"block","reason":"..."}` を 1 行出力して exit 0。無ければ・`stop_hook_active: true` なら無出力 exit 0

- [ ] **Step 1: 失敗する統合テストを書く**

`plugins/pitcrew/src/hooks/__test__/inject-stop.test.ts`:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-stop.ts", import.meta.url))

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-inject-stop-"))
}

function writeComment(dir: string, name: string, content: string): void {
  const commentsDir = path.join(dir, ".pitcrew", "comments")
  fs.mkdirSync(commentsDir, { recursive: true })
  fs.writeFileSync(path.join(commentsDir, name), content)
}

function runHook(dir: string, input: Record<string, unknown> = {}): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

test("normal と取り残し urgent をまとめて差し戻し、processed/ へ移動する", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: [src/never-touched.ts]\n---\n緊急のやつ。\n"
    )
    writeComment(
      dir,
      "c-002.md",
      "---\nurgency: normal\npaths: [docs/design.md]\n---\n通常のやつ。\n"
    )
    const out = runHook(dir)
    const parsed = JSON.parse(out) as { decision: string; reason: string }
    expect(parsed.decision).toBe("block")
    expect(parsed.reason).toContain("緊急のやつ")
    expect(parsed.reason).toContain("通常のやつ")
    const commentsDir = path.join(dir, ".pitcrew", "comments")
    expect(fs.existsSync(path.join(commentsDir, "c-001.md"))).toBe(false)
    expect(fs.existsSync(path.join(commentsDir, "c-002.md"))).toBe(false)
    expect(
      fs.existsSync(path.join(commentsDir, "processed", "c-001.md"))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(commentsDir, "processed", "c-002.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stop_hook_active: true では差し戻さずコメントも残す(無限ループ防止)", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: normal\n---\n残るべきコメント。\n"
    )
    const out = runHook(dir, { stop_hook_active: true })
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("未回収コメントが無ければ無出力で終了する", () => {
  const dir = makeProject()
  try {
    const out = runHook(dir)
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("コメント無し+stop_hook_active: true でも無出力で終了する", () => {
  const dir = makeProject()
  try {
    const out = runHook(dir, { stop_hook_active: true })
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter の無い手書きコメントもターン境界で回収される", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", "テンプレ無しの手書き。\n")
    const out = runHook(dir)
    const parsed = JSON.parse(out) as { decision: string; reason: string }
    expect(parsed.decision).toBe("block")
    expect(parsed.reason).toContain("手書き")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正な stdin では無出力で正常終了する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const out = runTs(HOOK, [], {
      input: "not json",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
    })
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/inject-stop.test.ts`
Expected: FAIL(hook ファイルが存在しない)

- [ ] **Step 3: inject-stop.ts を実装する**

`plugins/pitcrew/src/hooks/inject-stop.ts`:

```typescript
#!/usr/bin/env node
// Stop フック(設計書 §6): ターン境界で未回収コメント(normal と、パスにマッチ
// しないまま残った urgent)をまとめて差し戻す。urgent の「即時」はベストエフォート
// であり、ターン境界が最終防衛線。stop_hook_active と processed/ 移動の二重ガードで
// 無限ループを防ぐ。全経路フェイルオープン。
import {
  claimComment,
  listComments,
  renderInjection
} from "../lib/comments.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"

const MAX_INJECT_CHARS = 9000

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  // 直前の Stop 差し戻しから継続中のターンでは差し戻さない(設計書 §6 暴走防止)
  if (input.stop_hook_active !== true) {
    const claimed = listComments(projectDir).filter((c) =>
      claimComment(projectDir, c.name)
    )
    if (claimed.length > 0) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: renderInjection(claimed, MAX_INJECT_CHARS)
        })
      )
    }
  }
} catch (err) {
  logError(projectDir, "inject-stop", err)
}
process.exit(0)
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/inject-stop.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/pitcrew/src/hooks/inject-stop.ts plugins/pitcrew/src/hooks/__test__/inject-stop.test.ts
git commit -m "feat: pitcrew コメントのターン境界差し戻し(Stop hook)"
```

---

### Task 6: hooks.json / build.ts 登録とバンドル生成

**Files:**
- Modify: `plugins/pitcrew/build.ts`
- Modify: `plugins/pitcrew/hooks/hooks.json`
- Create(生成物): `plugins/pitcrew/scripts/inject-pre-tool-use.mjs`, `plugins/pitcrew/scripts/inject-stop.mjs`
- Modify(生成物): `plugins/pitcrew/scripts/capture-*.mjs`(Task 1-2 のソース変更が反映される)

**Interfaces:**
- Consumes: Task 4-5 の hook スクリプト
- Produces: プラグインとして有効化すると PreToolUse(Write|Edit)/ Stop で注入層が動く状態

- [ ] **Step 1: build.ts にエントリを追加する**

`plugins/pitcrew/build.ts` の `entryPoints` を以下に変更:

```typescript
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts",
    "capture-post-tool-use": "./src/hooks/capture-post-tool-use.ts",
    "inject-pre-tool-use": "./src/hooks/inject-pre-tool-use.ts",
    "inject-stop": "./src/hooks/inject-stop.ts"
  },
```

- [ ] **Step 2: hooks.json に注入層を登録する**

`plugins/pitcrew/hooks/hooks.json` を以下に変更(既存の 3 イベントはそのまま、description 更新+2 イベント追加):

```json
{
  "description": "pitcrew 捕捉層+注入層: 成果物を .pitcrew/review/ へ書き出し、.pitcrew/comments/ の人間コメントをセッションへ注入する",
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
    ],
    "PostToolUseFailure": [
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
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/inject-pre-tool-use.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/inject-stop.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: ビルドしてバンドルを生成する**

Run: `pnpm --filter pitcrew-scripts build`(またはリポジトリの慣行に従い `cd plugins/pitcrew && pnpm build`)
Expected: `scripts/` に `inject-pre-tool-use.mjs` と `inject-stop.mjs` が生成され、`capture-*.mjs` が更新される

- [ ] **Step 4: バンドルのスモークテスト**

Run:
```bash
echo '{}' | node plugins/pitcrew/scripts/inject-pre-tool-use.mjs; echo "exit=$?"
echo 'not json' | node plugins/pitcrew/scripts/inject-stop.mjs; echo "exit=$?"
```
Expected: いずれも無出力(`exit=0` の行のみ)。バンドルが自己完結で main() が正しく動くことの確認

- [ ] **Step 5: 全テスト+lint+typecheck を実行する**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: すべてパス

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/build.ts plugins/pitcrew/hooks/hooks.json plugins/pitcrew/scripts/
git commit -m "feat: pitcrew 注入層の hooks 登録とバンドル生成"
```

---

### Task 7: SKILL.md・README・バージョン更新・最終検証

**Files:**
- Create: `plugins/pitcrew/skills/pitcrew/SKILL.md`
- Modify: `plugins/pitcrew/README.md`
- Modify: `plugins/pitcrew/.claude-plugin/plugin.json`(version 0.7.0-dev)

**Interfaces:**
- Consumes: Task 4-5 の注入メッセージ形式(`[pitcrew]` プレフィックス、`## c-NNN.md(urgency: ... / paths: ... / base: ...)` セクション)
- Produces: 注入を受けた側(メイン/サブエージェント)の対応作法を定めるスキル

- [ ] **Step 1: SKILL.md を作成する**

`plugins/pitcrew/skills/pitcrew/SKILL.md`:

```markdown
---
name: pitcrew
description: pitcrew の並走レビューコメント([pitcrew] で始まる注入テキスト)を受け取ったときに必ず使用するスキル。コメントの読み方(urgency/paths/base)と、反映・報告の作法を定める。
---

# Pitcrew — 注入されたレビューコメントへの対応

## pitcrew とは

pitcrew は、オーケストレーション実行中に人間が成果物(diff・設計書・テスト結果)を
並走レビューし、コメントを実行中のセッションへ逆流させるプラグイン。
`[pitcrew]` で始まるテキストがツール結果の脇やターン境界に現れたら、
それは **人間レビュアーからの生のコメント** である。

## コメントの読み方

各コメントは `## c-NNN.md(urgency: ... / paths: ... / base: ...)` のセクションで届く。

- `urgency: urgent` — 今まさに触ろうとしているファイルに関わる指摘。作業を続ける前に反映を検討する
- `urgency: normal` — ターン境界でまとめて届く。次の作業に移る前に消化する
- `paths` — コメントが対象とするファイル・ディレクトリ
- `base` — コメント時点の commit。対象箇所が既に変わっている場合は、現状のコードと
  照合して「まだ有効な指摘か」を自分で判断する(機械は判定しない。判断根拠を簡潔に述べる)

## 対応の作法

1. **人間の指示として扱う**: コメントは実行中のタスク指示より新しい人間の意思。矛盾する場合はコメントを優先する
2. **反映するか、理由を述べて見送る**: 取り込む場合は該当作業に反映する。既に解決済み・的外れになっている場合は、その根拠を出力に残して見送ってよい
3. **メインセッション(オーケストレーター)が normal コメントを受けた場合**: 内容を判断し、必要なら対象のサブエージェントへの指示(再実行・修正依頼)に反映する
4. **`.pitcrew/` 配下を直接編集しない**: コメントへの返信・状態管理はすべて機構側(hooks)が行う。エージェントが comments/ や review/ に書き込んではならない

## してはいけないこと

- コメントを黙って無視する(反映しない場合も判断を出力に残す)
- `.pitcrew/comments/processed/` からコメントを読み直して二重に反映する
- コメントの内容を、より広い設計変更に勝手に拡大解釈する
```

- [ ] **Step 2: README.md に注入層の使い方を追記する**

`plugins/pitcrew/README.md` に以下の節を追加する(既存の Stage 1 の記述・構成は変えない。「コメントの書き方」節が既にあればそこへ統合する):

```markdown
## コメントの注入(Stage 2)

`.pitcrew/comments/c-<連番>.md` に置いたコメントは、次のタイミングでセッションに注入される:

| urgency | タイミング | 届き先 |
| --- | --- | --- |
| `urgent` | 対象パスに一致する Write/Edit の直前(PreToolUse) | そのファイルを触るエージェント(早い者勝ちで 1 エージェント) |
| `normal` | メインのターン境界(Stop) | メインセッション(まとめて差し戻し) |

- パスに一致しないまま残った `urgent` も、ターン境界で `normal` と一緒に回収される
- 注入済みコメントは `.pitcrew/comments/processed/` へ移動する(再注入されない)。
  取り消したいコメントは注入前に `comments/` から削除すればよい
- 注入は at-most-once: 注入直前にセッションが落ちた場合など、まれに未注入のまま
  `processed/` に移ることがある。届いていない様子なら `processed/` から `comments/` に
  戻せば再注入される

## 並行動作について(Stage 2)

- 複数サブエージェントの同時終了に備え、`run.json` の更新は `.pitcrew/run.lock` で
  直列化される(取得できない場合はロックなしで続行し、まれに重複 diff が出ることを許容)
- `run.lock` が残留してもロック待ちで止まることはない(10 秒より古いロックは自動回収される)
```

- [ ] **Step 3: バージョンを上げる**

`plugins/pitcrew/.claude-plugin/plugin.json` の `version` を `"0.6.0-dev"` → `"0.7.0-dev"` に変更する。

- [ ] **Step 4: 最終検証**

Run:
```bash
pnpm build && git status --short   # バンドル再生成後に未コミット差分が無いこと
pnpm test && pnpm lint && pnpm typecheck
```
Expected: build 後の差分ゼロ(Task 6 でコミット済みのバンドルが最新)、全テスト・lint・typecheck パス

- [ ] **Step 5: コミット**

```bash
git add plugins/pitcrew/skills/pitcrew/SKILL.md plugins/pitcrew/README.md plugins/pitcrew/.claude-plugin/plugin.json
git commit -m "docs: pitcrew Stage 2 の SKILL/README とバージョン 0.7.0-dev"
```

---

## スコープ外(Stage 3 以降へ)

- `/pitcrew:config`(注入タイミングのモード切替「ターン境界のみ/即時のみ」を含む)— Stage 3
- ブラウザビューア・TUI — Stage 4-5
- NotebookEdit 等 Write/Edit 以外のツールへのパス照合(YAGNI。必要になったら matcher と file_path 抽出を足す)
- コメント paths のワイルドカード対応(設計書 §3 で不可と明記)
- `processed/`・`reviewed/` のアーカイブ・自動削除(設計書 §11)

## 実運用の動作確認(マージ後・人間と一緒に)

自動テストでは検証できない実機確認。マージしてプラグインを再読み込みした後に行う。
`/pitcrew:config` は Stage 3 のため、`.gitignore` への `.pitcrew/` 追記が必要なら手動で行う:

1. サブエージェントを使う作業中に `.pitcrew/comments/c-001.md`(urgency: urgent、実際に触るパス)を手で置き、対象ファイルの Edit 直前にコメントがコンテキスト注入されることを確認
2. urgency: normal のコメントを置き、メインのターン終了時に差し戻されることを確認
3. 注入後に `comments/processed/` へ移動しており、次のターンで再注入されないことを確認
