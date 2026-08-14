# Pitcrew Stage 4(ブラウザビューア)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカル HTTP + SSE サーバー(`/pitcrew:serve` で起動)と 2 ペイン UI を追加し、`.pitcrew/` のレビューキューをブラウザで閲覧・承認・コメントできるようにする(ライト/ダーク切替つき)。

**Architecture:** サーバーは `node:http` のみで実装し、`.pitcrew/` を watch して SSE で変更をプッシュする。UI は単一 HTML(インライン CSS/JS・フレームワークなし)を `scripts/` に同梱コピーし、サーバーが実行時に読んで配信する。ビューアの書き込みは「comments/ への新規コメント」「review/ → reviewed/ への移動」「自身の serve.json」のみ(設計書 §5)。状態読み取り・承認・コメント書き込みは `src/server/` の純粋なライブラリ関数に分離し、HTTP 層と独立に vitest でテストする。UI は手動確認(設計書 §10)。

**Tech Stack:** TypeScript(strict / ESM)→ esbuild バンドル(`.mjs`)、vitest、Node >= 26 標準ライブラリのみ(`node:http` / `fs.watch` / `crypto`)、git CLI 不使用(サーバーは git に触らない)。Stage 1-3 の共有ライブラリ(`src/lib/`)を再利用する。

**Design doc:** `docs/superpowers/specs/2026-07-16-pitcrew-design.md`(§3 serve.json・§5 ビューア層 A・§9 エラーハンドリングが Stage 4 の対象)

## Global Constraints

- **Anthropic API 不使用・LLM 呼び出し禁止**: サーバー・UI は機械的処理のみ(リポジトリ共通制約)
- **ユーザーへの CLI 直接操作を要求しない**: 起動は `/pitcrew:serve` コマンド(Claude Code 内)経由。README にも「コマンドで起動」と書く(`node scripts/serve.mjs` の直接実行は開発者向け補足に留める)
- **外部ランタイム依存ゼロ**: 依存は `node:*` モジュールのみ。UI もフレームワーク・CDN 読み込みなし(完全オフラインで動く単一 HTML)。プラグイン package.json に依存を追加しない
- **localhost バインドのみ**: `127.0.0.1` に listen。トークン付き URL でアクセスし、トークン不一致は 401(設計書 §5)。リモート公開はスコープ外
- **ビューアの書き込み範囲**: `comments/` への新規コメント、`review/` → `reviewed/` への rename、`serve.json` の 3 つだけ。それ以外(`run.json` 等)には書かない(設計書 §5)
- **書き込みは原子的に**: すべて `writeFileAtomic`(tmp → rename)または rename。読みかけ・書きかけ競合を作らない(設計書 §9)
- **フェイルオープンの精神**: サーバーのクラッシュ・不在はセッションに影響しない(ファイルバスのみ依存)。サーバー内のファイル読み取り失敗は 500 ではなく「空状態」として返す(壊れた 1 ファイルで全体を落とさない)
- **バンドル出力を git 管理**: `src/` を変更したら `pnpm build` を実行し `scripts/*.mjs` の差分もコミット(利用者はビルド不要)
- **esbuild 設定**: `build.ts` にエントリ `serve: ./src/server/serve.ts` を追加し、`src/server/ui.html` を `scripts/ui.html` へコピーする(Task 5。`scripts/ui.html` も git 管理)
- **テスト**: vitest。`plugins/pitcrew/src/**/__test__/**/*.test.ts` に配置。TDD。root の testTimeout は 20s。サーバーのポートは必ず `--port 0`(エフェメラル)で起動し、実ポートは `serve.json` から読む(固定ポートのテストは並行実行で衝突するため禁止)
- **lint/format**: biome(double quote / semicolons asNeeded / trailingCommas none / lineWidth 80 / インデント 2)。`scripts/` は biome 対象外。`src/server/ui.html` も biome 対象外(`.html` は biome が見ない)
- **コードスタイル**: Stage 1-3 の既存ソースに合わせる(セミコロンなし・日本語コメントは設計書参照付き)
- **設定の消費**: `loadConfig()` の `port`(既定 7373)と `theme`(既定 device)を Stage 4 で初めて消費する。`viewer` 値による分岐はしない(serve は明示起動であり、viewer 設定は案内表示にだけ使う)
- **serve.json スキーマ**(このプラン全体で共通): `{ port: number, token: string, pid: number, startedAt: string, url: string }`。起動成功時に書き、正常終了(SIGINT/SIGTERM)時に削除する。設計書 §3 は serve.json の中身を「port・アクセストークン」としか定めていないため、詳細スキーマはこのプランが確定する(設計書 §3 の `{ startedAt, lastCaptureCommit, ... }` は run.json のスキーマであり serve.json とは無関係。混同しないこと)
- **コメント ID 採番**: ビューアが書くコメントは `c-NNN.md`(3 桁ゼロ埋め)。`comments/` と `comments/processed/` 両方を走査した最大番号 + 1(注入済みと衝突させない)
- **パストラバーサル防止**: API が受け取るファイル名は `^[A-Za-z0-9._-]+\.md$` に一致し、かつ `..` を含まないこと。不一致は 400
- **バージョン**: 完了時に `plugins/pitcrew/.claude-plugin/plugin.json` を `0.8.0` → `0.9.0-dev` に上げる(マイナー更新・自動判断の範囲)
- **コミットメッセージ**: 既存の流儀(`feat: pitcrew ...` / `docs: pitcrew ...` の日本語 conventional commits)に合わせる

## File Structure

```
plugins/pitcrew/
├── commands/
│   └── serve.md                      # 新規: /pitcrew:serve(サーバー起動手順)
├── src/
│   ├── server/
│   │   ├── state.ts                  # 新規: .pitcrew/ の読み取り(一覧+項目本文)
│   │   ├── viewer-ops.ts             # 新規: 承認(rename)+コメント書き込み(採番)
│   │   ├── watch.ts                  # 新規: .pitcrew/ の watch(fs.watch+ポーリング fallback)
│   │   ├── http.ts                   # 新規: ルーティング+トークン認証+SSE
│   │   ├── serve.ts                  # 新規: エントリ(config 読み→listen→serve.json→URL 表示)
│   │   ├── ui.html                   # 新規: 単一ファイル UI(2 ペイン+テーマ切替)
│   │   └── __test__/
│   │       ├── state.test.ts         # 新規
│   │       ├── viewer-ops.test.ts    # 新規
│   │       ├── watch.test.ts         # 新規
│   │       ├── http.test.ts          # 新規
│   │       └── serve.test.ts         # 新規(プロセス起動の統合テスト)
│   └── lib/                          # 変更なし(atomic.ts / frontmatter.ts / run.ts / config.ts を再利用)
├── build.ts                          # 修正: serve エントリ+ui.html の同梱コピー
├── scripts/serve.mjs                 # 生成(pnpm build)
├── scripts/ui.html                   # 生成(build.ts がコピー。git 管理)
├── README.md                         # 修正: Stage 4 の使い方
└── .claude-plugin/plugin.json        # 修正: 0.9.0-dev
```

`hooks/hooks.json` は変更しない(サーバーは hook ではなく独立プロセス)。

---

### Task 1: 状態読み取りライブラリ `state.ts`

**Files:**
- Create: `plugins/pitcrew/src/server/state.ts`
- Test: `plugins/pitcrew/src/server/__test__/state.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter(text)`(`src/lib/frontmatter.ts` — `{ data: Record<string, string | string[]>, body }` を返す。**この関数は例外を投げない**: frontmatter が無い入力は `{ data: {}, body: 入力全文 }`、パース不能な行は黙って読み飛ばす。実装済みの挙動であり、呼び出し側の try-catch は不要)、`pitcrewDir(projectDir)`(`src/lib/run.ts`)。`loadRun` は使わない(無い場合に初期値を作ってしまうため、run.json は存在確認してから直接読む — Step 3 のコード参照)
- Produces: 後続タスク(http.ts / UI)が使う次のエクスポート
  - `interface QueueItem { name: string; status: "review" | "reviewed"; id: string | null; type: string | null; agent: string | null; created: string | null; paths: string[]; base: string | null; head: string | null; title: string }`
  - `interface PitcrewState { hasRun: boolean; startedAt: string | null; lastCaptureAt: string | null; phase: string | null; review: QueueItem[]; reviewed: QueueItem[]; openComments: number; processedComments: number }`
  - `listState(projectDir: string): PitcrewState`
  - `readItemBody(projectDir: string, status: "review" | "reviewed", name: string): string | null`(ファイル全文を返す。無ければ null)
  - `isSafeName(name: string): boolean`(`^[A-Za-z0-9._-]+\.md$` かつ `..` を含まない)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/state.test.ts` を新規作成:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { isSafeName, listState, readItemBody } from "../state.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-state-"))
}

function writeItem(
  dir: string,
  sub: "review" | "reviewed",
  name: string,
  content: string
): void {
  const d = path.join(dir, ".pitcrew", sub)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, name), content)
}

const ITEM = `---
id: "002"
type: diff
agent: implementer
created: 2026-07-17T10:00:00.000Z
base: aaa1111
head: bbb2222
paths: [src/auth.ts]
---
# auth.ts の diff

本文
`

test(".pitcrew/ が無ければ空状態を返す", () => {
  const dir = makeProject()
  try {
    const s = listState(dir)
    expect(s.hasRun).toBe(false)
    expect(s.review).toEqual([])
    expect(s.reviewed).toEqual([])
    expect(s.openComments).toBe(0)
    expect(s.processedComments).toBe(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("review/ の項目を frontmatter 付きで一覧できる", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "002-diff-auth-ts.md", ITEM)
    const s = listState(dir)
    expect(s.review).toHaveLength(1)
    const item = s.review[0]
    expect(item.name).toBe("002-diff-auth-ts.md")
    expect(item.status).toBe("review")
    expect(item.id).toBe("002")
    expect(item.type).toBe("diff")
    expect(item.agent).toBe("implementer")
    expect(item.base).toBe("aaa1111")
    expect(item.head).toBe("bbb2222")
    expect(item.paths).toEqual(["src/auth.ts"])
    expect(item.title).toBe("auth.ts の diff")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("reviewed/ とコメント数もまとめて返す", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "003-test-vitest.md", ITEM)
    writeItem(dir, "reviewed", "001-artifact-design-md.md", ITEM)
    const comments = path.join(dir, ".pitcrew", "comments")
    fs.mkdirSync(path.join(comments, "processed"), { recursive: true })
    fs.writeFileSync(path.join(comments, "c-001.md"), "---\n---\nx\n")
    fs.writeFileSync(path.join(comments, "processed", "c-000.md"), "y")
    const s = listState(dir)
    expect(s.review.map((i) => i.name)).toEqual(["003-test-vitest.md"])
    expect(s.reviewed.map((i) => i.name)).toEqual([
      "001-artifact-design-md.md"
    ])
    expect(s.openComments).toBe(1)
    expect(s.processedComments).toBe(1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("run.json があれば hasRun と実行情報を返す", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".pitcrew", "run.json"),
      JSON.stringify({
        startedAt: "2026-07-17T09:00:00.000Z",
        lastCaptureCommit: null,
        lastCaptureAt: "2026-07-17T09:30:00.000Z",
        nextReviewId: 4
      })
    )
    const s = listState(dir)
    expect(s.hasRun).toBe(true)
    expect(s.startedAt).toBe("2026-07-17T09:00:00.000Z")
    expect(s.lastCaptureAt).toBe("2026-07-17T09:30:00.000Z")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter が壊れた項目も一覧から落とさない", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "004-broken.md", "frontmatter なし本文だけ")
    const s = listState(dir)
    expect(s.review).toHaveLength(1)
    expect(s.review[0].type).toBeNull()
    expect(s.review[0].title).toBe("004-broken.md")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("readItemBody は全文を返し、無い・不正な名前は null", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "002-diff-auth-ts.md", ITEM)
    expect(readItemBody(dir, "review", "002-diff-auth-ts.md")).toBe(ITEM)
    expect(readItemBody(dir, "review", "nope.md")).toBeNull()
    expect(readItemBody(dir, "review", "../run.json")).toBeNull()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("isSafeName はパストラバーサルを拒否する", () => {
  expect(isSafeName("002-diff-auth-ts.md")).toBe(true)
  expect(isSafeName("c-001.md")).toBe(true)
  expect(isSafeName("../run.json")).toBe(false)
  expect(isSafeName("a/b.md")).toBe(false)
  expect(isSafeName("..%2Fx.md")).toBe(false)
  expect(isSafeName("x.txt")).toBe(false)
  expect(isSafeName("..md")).toBe(false)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/state.test.ts`
Expected: FAIL(`../state.js` が存在しないため全件エラー)

- [ ] **Step 3: 実装を書く**

`plugins/pitcrew/src/server/state.ts` を新規作成:

```typescript
import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "../lib/frontmatter.js"
import { pitcrewDir } from "../lib/run.js"

// ブラウザビューアの読み取り側(設計書 §5)。.pitcrew/ のファイルを読むだけで、
// 書き込みは viewer-ops.ts に分離する。壊れたファイルは既定値で埋めて一覧に残す
// (1 ファイルの破損で全体を落とさない。設計書 §9 のフェイルオープンの精神)。

export interface QueueItem {
  name: string
  status: "review" | "reviewed"
  id: string | null
  type: string | null
  agent: string | null
  created: string | null
  paths: string[]
  base: string | null
  head: string | null
  title: string
}

export interface PitcrewState {
  hasRun: boolean
  startedAt: string | null
  lastCaptureAt: string | null
  phase: string | null
  review: QueueItem[]
  reviewed: QueueItem[]
  openComments: number
  processedComments: number
}

// API が受け取るファイル名の安全確認(Global Constraints)。
// 単一セグメントの .md のみ許可し、".." を含む名前は拒否する
export function isSafeName(name: string): boolean {
  return (
    /^[A-Za-z0-9._-]+\.md$/.test(name) &&
    !name.includes("..") &&
    !name.includes("/")
  )
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function asPaths(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value !== "") return [value]
  return []
}

function readItems(
  projectDir: string,
  status: "review" | "reviewed"
): QueueItem[] {
  const dir = path.join(pitcrewDir(projectDir), status)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const items: QueueItem[] = []
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    let raw: string
    try {
      if (!fs.statSync(path.join(dir, name)).isFile()) continue
      raw = fs.readFileSync(path.join(dir, name), "utf8")
    } catch {
      continue
    }
    const { data, body } = parseFrontmatter(raw)
    const heading = body.match(/^#\s+(.+)$/m)
    items.push({
      name,
      status,
      id: asString(data.id),
      type: asString(data.type),
      agent: asString(data.agent),
      created: asString(data.created),
      paths: asPaths(data.paths),
      base: asString(data.base),
      head: asString(data.head),
      title: heading ? heading[1].trim() : name
    })
  }
  return items
}

function countMd(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".md")).length
  } catch {
    return 0
  }
}

export function listState(projectDir: string): PitcrewState {
  const base = pitcrewDir(projectDir)
  // run.json は「存在するときだけ」実行情報を出す(loadRun は無い場合に
  // 初期値を作ってしまうため、ここでは存在確認してから読む)
  let hasRun = false
  let startedAt: string | null = null
  let lastCaptureAt: string | null = null
  let phase: string | null = null
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(base, "run.json"), "utf8")
    ) as Record<string, unknown>
    hasRun = true
    if (typeof parsed.startedAt === "string") startedAt = parsed.startedAt
    if (typeof parsed.lastCaptureAt === "string")
      lastCaptureAt = parsed.lastCaptureAt
    if (typeof parsed.phase === "string") phase = parsed.phase
  } catch {
    // run.json 無し・破損 → 実行情報なしとして返す
  }
  return {
    hasRun,
    startedAt,
    lastCaptureAt,
    phase,
    review: readItems(projectDir, "review"),
    reviewed: readItems(projectDir, "reviewed"),
    openComments: countMd(path.join(base, "comments")),
    processedComments: countMd(path.join(base, "comments", "processed"))
  }
}

export function readItemBody(
  projectDir: string,
  status: "review" | "reviewed",
  name: string
): string | null {
  if (!isSafeName(name)) return null
  try {
    return fs.readFileSync(
      path.join(pitcrewDir(projectDir), status, name),
      "utf8"
    )
  } catch {
    return null
  }
}
```

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/state.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: lint・typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server
git commit -m "feat: pitcrew ビューアの状態読み取りライブラリ(state.ts)"
```

---

### Task 2: 書き込み操作ライブラリ `viewer-ops.ts`

**Files:**
- Create: `plugins/pitcrew/src/server/viewer-ops.ts`
- Test: `plugins/pitcrew/src/server/__test__/viewer-ops.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic(filePath, content)`(`src/lib/atomic.ts`)、`serializeFrontmatter(data)`(`src/lib/frontmatter.ts`)、`pitcrewDir(projectDir)`(`src/lib/run.ts`)、Task 1 の `isSafeName(name)`
- Produces: http.ts が使う次のエクスポート
  - `approveItem(projectDir: string, name: string): boolean`(`review/<name>` → `reviewed/<name>` の rename。成功で true)
  - `interface NewComment { body: string; urgency: "urgent" | "normal"; paths: string[]; reviewId: string | null; base: string | null }`
  - `writeComment(projectDir: string, comment: NewComment): string | null`(`comments/c-NNN.md` を書き、ファイル名を返す。body が空なら null)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/viewer-ops.test.ts` を新規作成:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { approveItem, writeComment } from "../viewer-ops.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-ops-"))
}

test("approveItem は review/ から reviewed/ へ移動する", () => {
  const dir = makeProject()
  try {
    const review = path.join(dir, ".pitcrew", "review")
    fs.mkdirSync(review, { recursive: true })
    fs.writeFileSync(path.join(review, "001-diff-x.md"), "内容")
    expect(approveItem(dir, "001-diff-x.md")).toBe(true)
    expect(fs.existsSync(path.join(review, "001-diff-x.md"))).toBe(false)
    expect(
      fs.readFileSync(
        path.join(dir, ".pitcrew", "reviewed", "001-diff-x.md"),
        "utf8"
      )
    ).toBe("内容")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItem は無いファイル・不正な名前で false", () => {
  const dir = makeProject()
  try {
    expect(approveItem(dir, "nope.md")).toBe(false)
    expect(approveItem(dir, "../run.json")).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("writeComment は frontmatter 付き c-NNN.md を書く", () => {
  const dir = makeProject()
  try {
    const name = writeComment(dir, {
      body: "validate() を使ってください。",
      urgency: "urgent",
      paths: ["src/auth.ts"],
      reviewId: "002",
      base: "aaa1111"
    })
    expect(name).toBe("c-001.md")
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "comments", "c-001.md"),
      "utf8"
    )
    expect(raw).toContain("urgency: urgent")
    expect(raw).toContain("paths: [src/auth.ts]")
    expect(raw).toContain('reviewId: "002"')
    expect(raw).toContain("base: aaa1111")
    expect(raw).toContain("validate() を使ってください。")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("採番は comments/ と processed/ の最大番号 + 1", () => {
  const dir = makeProject()
  try {
    const comments = path.join(dir, ".pitcrew", "comments")
    fs.mkdirSync(path.join(comments, "processed"), { recursive: true })
    fs.writeFileSync(path.join(comments, "c-002.md"), "x")
    fs.writeFileSync(path.join(comments, "processed", "c-005.md"), "y")
    const name = writeComment(dir, {
      body: "次のコメント",
      urgency: "normal",
      paths: [],
      reviewId: null,
      base: null
    })
    expect(name).toBe("c-006.md")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("body が空白のみなら書かず null", () => {
  const dir = makeProject()
  try {
    expect(
      writeComment(dir, {
        body: "  \n",
        urgency: "normal",
        paths: [],
        reviewId: null,
        base: null
      })
    ).toBeNull()
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("paths が空なら frontmatter に paths を出さない", () => {
  const dir = makeProject()
  try {
    writeComment(dir, {
      body: "全体コメント",
      urgency: "normal",
      paths: [],
      reviewId: null,
      base: null
    })
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "comments", "c-001.md"),
      "utf8"
    )
    expect(raw).not.toContain("paths:")
    expect(raw).toContain("urgency: normal")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/viewer-ops.test.ts`
Expected: FAIL(`../viewer-ops.js` が存在しないため全件エラー)

- [ ] **Step 3: 実装を書く**

`plugins/pitcrew/src/server/viewer-ops.ts` を新規作成:

```typescript
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import {
  type FrontmatterData,
  serializeFrontmatter
} from "../lib/frontmatter.js"
import { pitcrewDir } from "../lib/run.js"
import { isSafeName } from "./state.js"

// ブラウザビューアの書き込み側(設計書 §5)。書けるのは
// 「review/ → reviewed/ への移動」と「comments/ への新規コメント」のみ。
// run.json 等には一切書かない。

export interface NewComment {
  body: string
  urgency: "urgent" | "normal"
  paths: string[]
  reviewId: string | null
  base: string | null
}

export function approveItem(projectDir: string, name: string): boolean {
  if (!isSafeName(name)) return false
  const base = pitcrewDir(projectDir)
  try {
    fs.mkdirSync(path.join(base, "reviewed"), { recursive: true })
    fs.renameSync(
      path.join(base, "review", name),
      path.join(base, "reviewed", name)
    )
    return true
  } catch {
    return false
  }
}

// 採番は comments/ と processed/ の両方を見る(注入で processed/ に移った
// 番号を再利用すると人間の再投稿と衝突するため)。ビューアは単一プロセス前提
// なので読み取り→書き込みの競合対策はしない(手書き併用時は稀に衝突し得るが、
// writeFileAtomic の rename で後勝ちになるだけで壊れはしない)
function nextCommentNumber(projectDir: string): number {
  const dirs = [
    path.join(pitcrewDir(projectDir), "comments"),
    path.join(pitcrewDir(projectDir), "comments", "processed")
  ]
  let max = 0
  for (const dir of dirs) {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const m = name.match(/^c-(\d+)\.md$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return max + 1
}

export function writeComment(
  projectDir: string,
  comment: NewComment
): string | null {
  const body = comment.body.trim()
  if (body === "") return null
  const fm: FrontmatterData = {
    urgency: comment.urgency,
    ...(comment.paths.length > 0 ? { paths: comment.paths } : {}),
    ...(comment.reviewId ? { reviewId: comment.reviewId } : {}),
    ...(comment.base ? { base: comment.base } : {})
  }
  const name = `c-${String(nextCommentNumber(projectDir)).padStart(3, "0")}.md`
  writeFileAtomic(
    path.join(pitcrewDir(projectDir), "comments", name),
    `${serializeFrontmatter(fm)}\n${body}\n`
  )
  return name
}
```

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/viewer-ops.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 5: lint・typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server
git commit -m "feat: pitcrew ビューアの承認・コメント書き込み(viewer-ops.ts)"
```

---

### Task 3: watch ライブラリ `watch.ts`

**Files:**
- Create: `plugins/pitcrew/src/server/watch.ts`
- Test: `plugins/pitcrew/src/server/__test__/watch.test.ts`

**Interfaces:**
- Consumes: `pitcrewDir(projectDir)`(`src/lib/run.ts`)
- Produces: http.ts が使う次のエクスポート
  - `watchPitcrew(projectDir: string, onChange: () => void): () => void`(監視を開始し、停止関数を返す。`.pitcrew/` と主要サブディレクトリの変更で `onChange` を呼ぶ。デバウンス 200ms。`fs.watch` が使えない環境では 2 秒間隔のポーリングに落ちる)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/watch.test.ts` を新規作成:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { watchPitcrew } from "../watch.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-watch-"))
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error("timeout"))
      }
    }, 50)
  })
}

test("review/ への書き込みで onChange が呼ばれる", async () => {
  const dir = makeProject()
  const review = path.join(dir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  let calls = 0
  const stop = watchPitcrew(dir, () => {
    calls++
  })
  try {
    // watch 開始の非同期セットアップ猶予
    await new Promise((r) => setTimeout(r, 300))
    fs.writeFileSync(path.join(review, "001-diff-x.md"), "x")
    await waitFor(() => calls >= 1, 5000)
    expect(calls).toBeGreaterThanOrEqual(1)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test(".pitcrew/ が無くても開始でき、後から作られた変更を拾う", async () => {
  const dir = makeProject()
  let calls = 0
  const stop = watchPitcrew(dir, () => {
    calls++
  })
  try {
    await new Promise((r) => setTimeout(r, 300))
    const comments = path.join(dir, ".pitcrew", "comments")
    fs.mkdirSync(comments, { recursive: true })
    fs.writeFileSync(path.join(comments, "c-001.md"), "x")
    await waitFor(() => calls >= 1, 10000)
    expect(calls).toBeGreaterThanOrEqual(1)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stop 後は変更を拾わない", async () => {
  const dir = makeProject()
  const review = path.join(dir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  let calls = 0
  const stop = watchPitcrew(dir, () => {
    calls++
  })
  await new Promise((r) => setTimeout(r, 300))
  stop()
  try {
    fs.writeFileSync(path.join(review, "001-diff-x.md"), "x")
    await new Promise((r) => setTimeout(r, 800))
    expect(calls).toBe(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/watch.test.ts`
Expected: FAIL(`../watch.js` が存在しないため全件エラー)

- [ ] **Step 3: 実装を書く**

`plugins/pitcrew/src/server/watch.ts` を新規作成:

```typescript
import fs from "node:fs"
import path from "node:path"
import { pitcrewDir } from "../lib/run.js"

// .pitcrew/ の監視(設計書 §5: fs.watch / ポーリングのフォールバック)。
// fs.watch は recursive が使えないプラットフォームがあるため、監視対象の
// サブディレクトリを列挙して個別に watch し、まだ無いディレクトリは
// ポーリングで出現を待つ。通知はデバウンス(200ms)してまとめる。

// 注意: これらの定数を変えるときは watch.test.ts の待機時間
// (セットアップ猶予 300ms・出現待ち 10s 等)との整合を保つこと
const SUBDIRS = ["", "review", "reviewed", "comments", "comments/processed"]
const DEBOUNCE_MS = 200
const POLL_MS = 2000

export function watchPitcrew(
  projectDir: string,
  onChange: () => void
): () => void {
  const base = pitcrewDir(projectDir)
  const watchers = new Map<string, fs.FSWatcher>()
  let stopped = false
  let debounce: ReturnType<typeof setTimeout> | null = null

  const fire = (): void => {
    if (stopped) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      if (!stopped) onChange()
    }, DEBOUNCE_MS)
  }

  const ensureWatchers = (): void => {
    if (stopped) return
    for (const sub of SUBDIRS) {
      const dir = sub === "" ? base : path.join(base, sub)
      if (watchers.has(dir)) continue
      try {
        const w = fs.watch(dir, fire)
        // ディレクトリ削除等で watch が死んだら登録を外し、ポーリングで再取得
        w.on("error", () => {
          watchers.delete(dir)
          w.close()
        })
        watchers.set(dir, w)
      } catch {
        // まだ無い・watch 不可 → 次のポーリングで再試行
      }
    }
  }

  ensureWatchers()
  // 「未作成ディレクトリの出現」をカバーする低頻度ポーリング。
  // 新しく watch を張れたディレクトリが出たときだけ fire する
  // (作成された = 変化があったということ。既に張れているディレクトリの
  // 変化は fs.watch 側が拾う)
  const poll = setInterval(() => {
    const before = watchers.size
    ensureWatchers()
    if (watchers.size > before) fire()
  }, POLL_MS)

  return () => {
    stopped = true
    clearInterval(poll)
    if (debounce) clearTimeout(debounce)
    for (const w of watchers.values()) w.close()
    watchers.clear()
  }
}
```

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/watch.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: lint・typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server
git commit -m "feat: pitcrew ビューアの .pitcrew/ 監視(watch.ts)"
```

---

### Task 4: HTTP 層 `http.ts`(ルーティング+トークン認証+SSE)

**Files:**
- Create: `plugins/pitcrew/src/server/http.ts`
- Test: `plugins/pitcrew/src/server/__test__/http.test.ts`

**Interfaces:**
- Consumes: Task 1 の `listState` / `readItemBody`、Task 2 の `approveItem` / `writeComment` / `NewComment`、Task 3 の `watchPitcrew`
- Produces: serve.ts が使う次のエクスポート
  - `createPitcrewServer(opts: { projectDir: string; token: string; html: string }): http.Server`(listen はしない。呼び出し側が `.listen()` する)
- HTTP API(このタスクで確定。UI(Task 6)はこの API だけを呼ぶ):

| メソッド+パス | 認証 | 動作 |
| --- | --- | --- |
| `GET /?token=<t>` | query | `html` を `text/html; charset=utf-8` で返す |
| `GET /api/state` | header | `listState()` を JSON で返す |
| `GET /api/item?status=<review\|reviewed>&name=<f>` | header | `{ body }` を JSON で返す。無ければ 404 |
| `POST /api/approve`(JSON `{ name }`) | header | `approveItem()`。成功 `{ ok: true }`・失敗 404 |
| `POST /api/comment`(JSON `{ body, urgency, paths?, reviewId?, base? }`) | header | `writeComment()`。成功 `{ ok: true, name }`・body 空は 400 |
| `GET /api/events?token=<t>` | query | SSE。接続直後と `.pitcrew/` 変更のたびに `data: changed\n\n` を送る(EventSource はヘッダを付けられないため query 認証) |

- 認証: `header` は `Authorization: Bearer <token>`、`query` は `?token=<token>`。どちらの経路でも両方式を受け付けてよいが、不一致・欠落は 401
- トークン比較は `crypto.timingSafeEqual`(長さ不一致は即 401)
- 未知パスは 404、JSON パース失敗・バリデーション失敗は 400。レスポンスはすべて JSON(`{ error: string }`)か HTML(`/` のみ)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/http.test.ts` を新規作成:

```typescript
import fs from "node:fs"
import type http from "node:http"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import { createPitcrewServer } from "../http.js"

const TOKEN = "test-token-1234"
let server: http.Server | null = null
let projectDir = ""

function start(): Promise<string> {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-http-"))
  server = createPitcrewServer({
    projectDir,
    token: TOKEN,
    html: "<!doctype html><title>pitcrew</title>"
  })
  return new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const addr = server?.address()
      resolve(
        typeof addr === "object" && addr
          ? `http://127.0.0.1:${addr.port}`
          : ""
      )
    })
  })
}

afterEach(async () => {
  // SSE・keep-alive の接続が残っていると close が完了しないため強制切断する
  server?.closeAllConnections()
  await new Promise((r) => server?.close(r))
  server = null
  fs.rmSync(projectDir, { recursive: true, force: true })
})

function auth(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` }
}

test("GET / はトークン一致で HTML を返し、不一致は 401", async () => {
  const base = await start()
  const ok = await fetch(`${base}/?token=${TOKEN}`)
  expect(ok.status).toBe(200)
  expect(ok.headers.get("content-type")).toContain("text/html")
  expect(await ok.text()).toContain("pitcrew")
  expect((await fetch(`${base}/?token=wrong`)).status).toBe(401)
  expect((await fetch(`${base}/`)).status).toBe(401)
})

test("GET /api/state は状態 JSON を返す", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(
    path.join(review, "001-diff-x.md"),
    "---\nid: \"001\"\ntype: diff\n---\n# x の diff\n"
  )
  const res = await fetch(`${base}/api/state`, { headers: auth() })
  expect(res.status).toBe(200)
  const state = (await res.json()) as { review: { name: string }[] }
  expect(state.review.map((i) => i.name)).toEqual(["001-diff-x.md"])
})

test("GET /api/item は本文を返し、無ければ 404、不正 status は 400", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-x.md"), "本文")
  const ok = await fetch(
    `${base}/api/item?status=review&name=001-diff-x.md`,
    { headers: auth() }
  )
  expect(ok.status).toBe(200)
  expect(((await ok.json()) as { body: string }).body).toBe("本文")
  expect(
    (
      await fetch(`${base}/api/item?status=review&name=nope.md`, {
        headers: auth()
      })
    ).status
  ).toBe(404)
  expect(
    (
      await fetch(`${base}/api/item?status=bad&name=001-diff-x.md`, {
        headers: auth()
      })
    ).status
  ).toBe(400)
})

test("POST /api/approve は reviewed/ へ移動する", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-x.md"), "本文")
  const res = await fetch(`${base}/api/approve`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ name: "001-diff-x.md" })
  })
  expect(res.status).toBe(200)
  expect(
    fs.existsSync(
      path.join(projectDir, ".pitcrew", "reviewed", "001-diff-x.md")
    )
  ).toBe(true)
  const missing = await fetch(`${base}/api/approve`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ name: "nope.md" })
  })
  expect(missing.status).toBe(404)
})

test("POST /api/comment はコメントを書き、空 body は 400", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/comment`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      body: "コメント本文",
      urgency: "urgent",
      paths: ["src/auth.ts"]
    })
  })
  expect(res.status).toBe(200)
  expect((await res.json()) as object).toEqual({ ok: true, name: "c-001.md" })
  const raw = fs.readFileSync(
    path.join(projectDir, ".pitcrew", "comments", "c-001.md"),
    "utf8"
  )
  expect(raw).toContain("urgency: urgent")
  const empty = await fetch(`${base}/api/comment`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ body: "  ", urgency: "normal" })
  })
  expect(empty.status).toBe(400)
})

test("認証なしの API は 401、未知パスは 404", async () => {
  const base = await start()
  expect((await fetch(`${base}/api/state`)).status).toBe(401)
  expect((await fetch(`${base}/api/nope`, { headers: auth() })).status).toBe(
    404
  )
})

test("SSE は接続直後に changed を送り、変更でも送る", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/events?token=${TOKEN}`)
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  const reader = res.body?.getReader()
  if (!reader) throw new Error("no body")
  const decoder = new TextDecoder()
  let received = ""
  const readUntilChanged = async (): Promise<void> => {
    // サーバーが通知を送らないバグで無限待機しないよう 10 秒で打ち切る
    // (打ち切り時は後続の expect が失敗する)
    const deadline = Date.now() + 10000
    while (!received.includes("data: changed")) {
      if (Date.now() > deadline) return
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true }), 10000)
        )
      ])
      if (done) return
      if (value) received += decoder.decode(value)
    }
  }
  await readUntilChanged() // 接続直後の初回通知
  received = ""
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-x.md"), "x")
  await readUntilChanged() // 変更通知
  expect(received).toContain("data: changed")
  await reader.cancel()
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/http.test.ts`
Expected: FAIL(`../http.js` が存在しないため全件エラー)

- [ ] **Step 3: 実装を書く**

`plugins/pitcrew/src/server/http.ts` を新規作成:

```typescript
import crypto from "node:crypto"
import http from "node:http"
import { listState, readItemBody } from "./state.js"
import { type NewComment, approveItem, writeComment } from "./viewer-ops.js"
import { watchPitcrew } from "./watch.js"

// ブラウザビューアの HTTP 層(設計書 §5)。listen は serve.ts が行う。
// 全ルートはトークン必須(localhost バインドでも同一マシンの他プロセス・
// 他サイトからの CSRF を防ぐ)。SSE は EventSource がヘッダを付けられない
// ため query トークンを受け付ける。

interface ServerOptions {
  projectDir: string
  token: string
  html: string
}

function tokenEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  const url = new URL(req.url ?? "/", "http://localhost")
  const query = url.searchParams.get("token")
  if (query !== null) return tokenEquals(query, token)
  const header = req.headers.authorization
  if (typeof header === "string" && header.startsWith("Bearer "))
    return tokenEquals(header.slice("Bearer ".length), token)
  return false
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8")
      if (data.length > 1_000_000) reject(new Error("body too large"))
    })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

export function createPitcrewServer(opts: ServerOptions): http.Server {
  const { projectDir, token, html } = opts
  const sseClients = new Set<http.ServerResponse>()
  const stopWatch = watchPitcrew(projectDir, () => {
    for (const client of sseClients) client.write("data: changed\n\n")
  })

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" })
      else res.end()
    })
  })

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (!authorized(req, token)) {
      sendJson(res, 401, { error: "unauthorized" })
      return
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
      return
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, listState(projectDir))
      return
    }

    if (req.method === "GET" && url.pathname === "/api/item") {
      const status = url.searchParams.get("status")
      const name = url.searchParams.get("name") ?? ""
      if (status !== "review" && status !== "reviewed") {
        sendJson(res, 400, { error: "bad status" })
        return
      }
      const body = readItemBody(projectDir, status, name)
      if (body === null) sendJson(res, 404, { error: "not found" })
      else sendJson(res, 200, { body })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/approve") {
      let name = ""
      try {
        const parsed = JSON.parse(await readBody(req)) as { name?: unknown }
        if (typeof parsed.name === "string") name = parsed.name
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      if (approveItem(projectDir, name)) sendJson(res, 200, { ok: true })
      else sendJson(res, 404, { error: "not found" })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/comment") {
      let comment: NewComment
      try {
        const p = JSON.parse(await readBody(req)) as Record<string, unknown>
        comment = {
          body: typeof p.body === "string" ? p.body : "",
          urgency: p.urgency === "urgent" ? "urgent" : "normal",
          paths: Array.isArray(p.paths)
            ? p.paths.filter((x): x is string => typeof x === "string")
            : [],
          reviewId: typeof p.reviewId === "string" ? p.reviewId : null,
          base: typeof p.base === "string" ? p.base : null
        }
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      const name = writeComment(projectDir, comment)
      if (name === null) sendJson(res, 400, { error: "empty body" })
      else sendJson(res, 200, { ok: true, name })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      })
      res.write("data: changed\n\n") // 接続直後に初期同期を促す
      sseClients.add(res)
      req.on("close", () => {
        sseClients.delete(res)
      })
      return
    }

    sendJson(res, 404, { error: "not found" })
  }

  server.on("close", () => {
    stopWatch()
    for (const client of sseClients) client.end()
    sseClients.clear()
  })
  return server
}
```

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/http.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: lint・typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server
git commit -m "feat: pitcrew ビューアの HTTP 層(トークン認証+API+SSE)"
```

---

### Task 5: エントリ `serve.ts` + esbuild 設定 + serve.json

**Files:**
- Create: `plugins/pitcrew/src/server/serve.ts`
- Create: `plugins/pitcrew/src/server/ui.html`(このタスクでは仮の最小 HTML。本実装は Task 6)
- Modify: `plugins/pitcrew/build.ts`(serve エントリ+`.html` text ローダー)
- Test: `plugins/pitcrew/src/server/__test__/serve.test.ts`

**Interfaces:**
- Consumes: Task 4 の `createPitcrewServer`、`loadConfig(projectDir)`(`src/lib/config.ts` — `port` / `theme` を消費)、`writeFileAtomic`(`src/lib/atomic.ts`)、`pitcrewDir`(`src/lib/run.ts`)
- Produces:
  - CLI 引数: `serve.ts [--port <n>] [--dir <projectDir>]`(`--port` は config より優先。テスト用に `--port 0` でエフェメラルポート)
  - `serve.json`(Global Constraints のスキーマ): `{ port, token, pid, startedAt, url }`。listen 成功時に書き、SIGINT/SIGTERM で削除して終了
  - stdout 1 行目に `pitcrew viewer: http://127.0.0.1:<port>/?token=<token>` を表示(コマンド・テストはこれと serve.json を読む)
  - UI の HTML は「自分のファイルの隣の `ui.html`」を実行時に読み、`theme` は `%PITCREW_THEME%` の置換で渡す(HTML の `data-config-theme` 属性になる)。`loadConfig().theme` は `"device" | "light" | "dark"` に検証済みの値しか返さない(不正値は `device` に落ちる — `src/lib/config.ts` 実装済み)ため、置換値のエスケープや再検証は不要

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/serve.test.ts` を新規作成:

```typescript
import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { afterEach, expect, test } from "vitest"

const SERVE = fileURLToPath(new URL("../serve.ts", import.meta.url))
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

let child: ChildProcess | null = null
let projectDir = ""

interface ServeInfo {
  port: number
  token: string
  pid: number
  startedAt: string
  url: string
}

function waitFor<T>(
  read: () => T | null,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      const value = read()
      if (value !== null) {
        clearInterval(timer)
        resolve(value)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error("timeout"))
      }
    }, 100)
  })
}

function readServeJson(): ServeInfo | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectDir, ".pitcrew", "serve.json"), "utf8")
    ) as ServeInfo
  } catch {
    return null
  }
}

async function startServe(args: string[] = []): Promise<ServeInfo> {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-serve-"))
  child = spawn(
    process.execPath,
    [TSX_CLI, SERVE, "--port", "0", "--dir", projectDir, ...args],
    { stdio: ["ignore", "pipe", "pipe"] }
  )
  return waitFor(readServeJson, 15000)
}

afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM")
    await new Promise((r) => child?.once("exit", r))
  }
  child = null
  fs.rmSync(projectDir, { recursive: true, force: true })
})

test("起動で serve.json が書かれ、URL でトップページが開ける", async () => {
  const info = await startServe()
  expect(info.port).toBeGreaterThan(0)
  expect(info.token.length).toBeGreaterThanOrEqual(32)
  expect(info.url).toBe(`http://127.0.0.1:${info.port}/?token=${info.token}`)
  const res = await fetch(info.url)
  expect(res.status).toBe(200)
  expect(await res.text()).toContain("pitcrew")
})

test("SIGTERM で serve.json が削除されて終了する", async () => {
  await startServe()
  child?.kill("SIGTERM")
  await new Promise((r) => child?.once("exit", r))
  expect(readServeJson()).toBeNull()
})

test("theme 設定が HTML に埋め込まれる", async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-serve-"))
  const claudeDir = path.join(projectDir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    "---\ntheme: dark\n---\n"
  )
  child = spawn(
    process.execPath,
    [TSX_CLI, SERVE, "--port", "0", "--dir", projectDir],
    { stdio: ["ignore", "pipe", "pipe"] }
  )
  const info = await waitFor(readServeJson, 15000)
  const html = await (await fetch(info.url)).text()
  expect(html).toContain('data-config-theme="dark"')
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/serve.test.ts`
Expected: FAIL(`../serve.ts` が存在しないため全件エラー)

- [ ] **Step 3: 仮の ui.html を作る**

`plugins/pitcrew/src/server/ui.html` を新規作成(Task 6 で全面置換する仮実装。
`data-config-theme` の置換ポイントだけ本実装と共通):

```html
<!doctype html>
<html lang="ja" data-config-theme="%PITCREW_THEME%">
  <head>
    <meta charset="utf-8" />
    <title>pitcrew</title>
  </head>
  <body>
    <p>pitcrew viewer(UI は Task 6 で実装)</p>
  </body>
</html>
```

- [ ] **Step 4: build.ts を修正する(ui.html は同梱コピー方式)**

UI の配布は「esbuild text ローダーでバンドルへ埋め込む」のではなく、
**`ui.html` を `scripts/` に別ファイルとしてコピーし、`serve.ts` が
「自分のファイルの隣にある `ui.html`」を実行時に読む**方式にする。
理由: テストは tsx で `src/server/serve.ts` を直接実行するが、tsx は
`.html` の import を解決できない。実行時読み込みなら tsx 実行
(`src/server/ui.html`)とバンドル実行(`scripts/ui.html`)が同じコードで動く。

`plugins/pitcrew/build.ts` を次の内容に置き換える:

```typescript
import fs from "node:fs"
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts",
    "capture-post-tool-use": "./src/hooks/capture-post-tool-use.ts",
    "inject-pre-tool-use": "./src/hooks/inject-pre-tool-use.ts",
    "inject-stop": "./src/hooks/inject-stop.ts",
    serve: "./src/server/serve.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26"
})

// ブラウザビューアの UI はバンドルせず、serve.mjs の隣に置いて実行時に読む
// (tsx 直実行のテストとバンドル実行で同じ読み込みコードを使うため)
fs.copyFileSync("./src/server/ui.html", "./scripts/ui.html")
```

- [ ] **Step 5: serve.ts を実装する**

`plugins/pitcrew/src/server/serve.ts` を新規作成:

```typescript
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import { loadConfig } from "../lib/config.js"
import { pitcrewDir } from "../lib/run.js"
import { createPitcrewServer } from "./http.js"

// ブラウザビューアのエントリ(設計書 §5)。/pitcrew:serve コマンドが起動する。
// 127.0.0.1 のみに listen し、トークン付き URL を表示・serve.json に書く。
// 正常終了(SIGINT/SIGTERM)で serve.json を削除する。

function parseArgs(argv: string[]): { port: number | null; dir: string } {
  let port: number | null = null
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1] !== undefined) {
      const n = Number(argv[i + 1])
      // --port 0 はテスト用のエフェメラルポート指定として有効
      if (Number.isInteger(n) && n >= 0 && n <= 65535) port = n
      i++
    } else if (argv[i] === "--dir" && argv[i + 1] !== undefined) {
      dir = path.resolve(argv[i + 1])
      i++
    }
  }
  return { port, dir }
}

const { port: portArg, dir: projectDir } = parseArgs(process.argv.slice(2))
const config = loadConfig(projectDir)
const port = portArg ?? config.port
const token = crypto.randomBytes(24).toString("hex")

// UI は自分のファイルの隣の ui.html を読む(src/ でも scripts/ でも同じ相対位置)
const html = fs
  .readFileSync(new URL("./ui.html", import.meta.url), "utf8")
  .replaceAll("%PITCREW_THEME%", config.theme)

const server = createPitcrewServer({ projectDir, token, html })
const serveJsonPath = path.join(pitcrewDir(projectDir), "serve.json")

server.listen(port, "127.0.0.1", () => {
  const addr = server.address()
  const actualPort =
    typeof addr === "object" && addr !== null ? addr.port : port
  const url = `http://127.0.0.1:${actualPort}/?token=${token}`
  writeFileAtomic(
    serveJsonPath,
    `${JSON.stringify(
      {
        port: actualPort,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        url
      },
      null,
      2
    )}\n`
  )
  console.log(`pitcrew viewer: ${url}`)
})

server.on("error", (err) => {
  console.error(`pitcrew viewer の起動に失敗しました: ${String(err)}`)
  process.exit(1)
})

function shutdown(): void {
  try {
    fs.rmSync(serveJsonPath, { force: true })
  } catch {
    // serve.json の削除失敗は無視(次回起動で上書きされる)
  }
  server.close(() => process.exit(0))
  // SSE 接続が残っていても 1 秒で強制終了する
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
```

- [ ] **Step 6: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/serve.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 7: 全テスト・lint・typecheck・ビルド**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: すべて成功。`plugins/pitcrew/scripts/serve.mjs` と `plugins/pitcrew/scripts/ui.html` が生成される

- [ ] **Step 8: コミット**

```bash
git add plugins/pitcrew/src/server plugins/pitcrew/build.ts plugins/pitcrew/scripts
git commit -m "feat: pitcrew ビューアのエントリ(serve.ts)と serve.json 管理"
```

---

### Task 6: UI 本実装 `ui.html`(2 ペイン+テーマ切替)

**Files:**
- Modify: `plugins/pitcrew/src/server/ui.html`(Task 5 の仮実装を全面置換)
- Modify: `plugins/pitcrew/src/server/__test__/serve.test.ts`(UI 配信のスモークテスト 1 件追加)

**Interfaces:**
- Consumes: Task 4 の HTTP API 全部(`/api/state` / `/api/item` / `/api/approve` / `/api/comment` / `/api/events`)。トークンは `location.search` の `token` を読んで全リクエストに付ける
- Produces: なし(最終成果物)。UI 動作は手動確認(設計書 §10)

UI 仕様(設計書 §5 のモック承認済みレイアウト。ただし「diff のファイルタブ」だけは簡略化する — diff は単一の unified diff として行単位色分けで表示し、ファイルごとのタブ分割はしない。捕捉層が書く diff 本文はファイル横断の 1 テキストであり、タブ化は本文のパースを要するため Stage 4 では YAGNI と判断。不満が出たら後続で追加する):

- **上部ステータスバー**: 実行状態(`hasRun` と `startedAt`)・phase(あれば)・未レビュー数・未回収コメント数・最終更新(`lastCaptureAt`)・テーマ切替ボタン
- **左ペイン(レビューキュー)**: `review` の項目を上、`reviewed` をグレーアウトで下に表示。各行は種別バッジ(diff=青系 / artifact=緑系 / test=橙系)+タイトル+発生元エージェント+経過時間(created から)
- **右ペイン(詳細)**: 選択項目の本文をそのまま `<pre>` で表示(diff 項目は行頭 `+`/`-`/`@@` で行単位色分け)。上部に「承認して既読」ボタン(review の項目のみ。押すと `/api/approve` → 一覧更新)
- **行コメントの入口**(設計書 §5): diff 項目の色分け行をクリックすると、その行を `> ` 引用としてコメント欄の末尾に挿入する(行コメント専用の保存形式は作らない — コメント本文に引用が入るだけで、注入層・frontmatter は従来のまま)。引用は行を**そのまま**入れる(行頭の `+`/`-`/`@@` も含める — 受け取る LLM が追加行か削除行かを判別できるため削らない)
- **コメント欄(右ペイン下部)**: テキストエリア+「📮 通常 / 🚨 緊急」の選択+送信ボタン。送信は `/api/comment` に `{ body, urgency, paths: <選択項目の paths>, reviewId: <選択項目の id>, base: <選択項目の base> }`。成功でテキストエリアをクリアしトースト表示
- **テーマ**: `<html data-config-theme="...">`(サーバーが config 値を埋め込む)を初期値とし、localStorage `pitcrew-theme` があればそれを優先(設計書 §5 の優先順位: localStorage > config > `prefers-color-scheme`)。`device` は `prefers-color-scheme` に追従。切替ボタンは light → dark → device の循環で、選択を localStorage に保存
- **更新**: `/api/events` の SSE を購読し、`changed` を受けるたびに `/api/state`(+選択中項目の `/api/item`)を再取得。SSE 切断時は 5 秒ごとに再接続
- **XSS 対策**: サーバー由来の文字列(タイトル・エージェント名・本文)は必ず `textContent` で挿入する。`innerHTML` にユーザーデータを渡さない

- [ ] **Step 1: スモークテストを追加する**

`plugins/pitcrew/src/server/__test__/serve.test.ts` の末尾にテスト 1 件を追加:

```typescript
test("UI には 2 ペインとコメント欄の要素 ID が含まれる", async () => {
  const info = await startServe()
  const html = await (await fetch(info.url)).text()
  for (const id of [
    "status-bar",
    "queue-pane",
    "detail-pane",
    "comment-body",
    "comment-send",
    "theme-toggle"
  ]) {
    expect(html).toContain(`id="${id}"`)
  }
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/serve.test.ts`
Expected: FAIL(追加した 1 件のみ。仮 ui.html に要素 ID が無いため)

- [ ] **Step 3: ui.html を本実装に置き換える**

`plugins/pitcrew/src/server/ui.html` を次の内容で全面置換:

```html
<!doctype html>
<html lang="ja" data-config-theme="%PITCREW_THEME%">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pitcrew</title>
<style>
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e5e7eb;
  --pane: #f9fafb; --accent: #2563eb; --accent-fg: #ffffff;
  --badge-diff: #dbeafe; --badge-diff-fg: #1d4ed8;
  --badge-artifact: #dcfce7; --badge-artifact-fg: #15803d;
  --badge-test: #ffedd5; --badge-test-fg: #c2410c;
  --add: #16a34a; --add-bg: #f0fdf4; --del: #dc2626; --del-bg: #fef2f2;
  --hunk: #7c3aed; --hunk-bg: #f5f3ff;
}
html[data-theme="dark"] {
  --bg: #111827; --fg: #f3f4f6; --muted: #9ca3af; --border: #374151;
  --pane: #1f2937; --accent: #3b82f6; --accent-fg: #ffffff;
  --badge-diff: #1e3a5f; --badge-diff-fg: #93c5fd;
  --badge-artifact: #14432a; --badge-artifact-fg: #86efac;
  --badge-test: #4a2c17; --badge-test-fg: #fdba74;
  --add: #4ade80; --add-bg: #132a1a; --del: #f87171; --del-bg: #2f1516;
  --hunk: #a78bfa; --hunk-bg: #241b3a;
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, sans-serif; background: var(--bg);
  color: var(--fg); height: 100vh; display: flex; flex-direction: column;
}
#status-bar {
  display: flex; align-items: center; gap: 16px; padding: 8px 16px;
  border-bottom: 1px solid var(--border); font-size: 13px; flex-wrap: wrap;
}
#status-bar .stat b { font-variant-numeric: tabular-nums; }
#status-bar .spacer { flex: 1; }
#theme-toggle {
  border: 1px solid var(--border); background: var(--pane); color: var(--fg);
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 13px;
}
main { display: flex; flex: 1; min-height: 0; }
#queue-pane {
  width: 340px; min-width: 240px; border-right: 1px solid var(--border);
  overflow-y: auto; background: var(--pane);
}
#queue-pane .section {
  padding: 6px 12px; font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.queue-item {
  padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
}
.queue-item:hover { background: var(--bg); }
.queue-item.selected { background: var(--bg); box-shadow: inset 3px 0 var(--accent); }
.queue-item.reviewed { opacity: 0.5; }
.queue-item .row { display: flex; align-items: center; gap: 8px; }
.queue-item .title {
  font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.queue-item .meta { font-size: 11px; color: var(--muted); }
.badge {
  font-size: 10px; padding: 1px 7px; border-radius: 9999px; flex-shrink: 0;
}
.badge.diff { background: var(--badge-diff); color: var(--badge-diff-fg); }
.badge.artifact { background: var(--badge-artifact); color: var(--badge-artifact-fg); }
.badge.test { background: var(--badge-test); color: var(--badge-test-fg); }
#detail-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#detail-header {
  display: flex; align-items: center; gap: 12px; padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
#detail-title { font-size: 14px; font-weight: 600; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#approve-btn {
  border: none; background: var(--accent); color: var(--accent-fg);
  border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px;
}
#approve-btn:disabled { opacity: 0.4; cursor: default; }
#detail-body {
  flex: 1; overflow: auto; margin: 0; padding: 16px; font-size: 12.5px;
  font-family: ui-monospace, monospace; white-space: pre-wrap;
  word-break: break-word;
}
#detail-body .add { color: var(--add); background: var(--add-bg); display: block; }
#detail-body .del { color: var(--del); background: var(--del-bg); display: block; }
#detail-body .hunk { color: var(--hunk); background: var(--hunk-bg); display: block; }
#comment-box {
  border-top: 1px solid var(--border); padding: 10px 16px; display: flex;
  flex-direction: column; gap: 8px; background: var(--pane);
}
#comment-body {
  width: 100%; min-height: 60px; resize: vertical; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  padding: 8px; font-family: inherit; font-size: 13px;
}
#comment-box .row { display: flex; align-items: center; gap: 12px; }
#comment-send {
  border: none; background: var(--accent); color: var(--accent-fg);
  border-radius: 6px; padding: 6px 16px; cursor: pointer; font-size: 13px;
}
#toast {
  position: fixed; bottom: 16px; right: 16px; background: var(--fg);
  color: var(--bg); border-radius: 8px; padding: 10px 16px; font-size: 13px;
  opacity: 0; transition: opacity 0.3s; pointer-events: none;
}
#toast.show { opacity: 1; }
.empty { padding: 24px; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<div id="status-bar">
  <span class="stat">実行: <b id="stat-run">-</b></span>
  <span class="stat" id="stat-phase-wrap" hidden>フェーズ: <b id="stat-phase">-</b></span>
  <span class="stat">未レビュー: <b id="stat-review">0</b></span>
  <span class="stat">未回収コメント: <b id="stat-comments">0</b></span>
  <span class="stat">最終捕捉: <b id="stat-capture">-</b></span>
  <span class="spacer"></span>
  <button id="theme-toggle" type="button">テーマ: device</button>
</div>
<main>
  <div id="queue-pane"></div>
  <div id="detail-pane">
    <div id="detail-header">
      <span id="detail-title">項目を選択してください</span>
      <button id="approve-btn" type="button" disabled>承認して既読</button>
    </div>
    <pre id="detail-body"></pre>
    <div id="comment-box">
      <textarea id="comment-body" placeholder="コメント(選択中の項目の paths / reviewId / base が自動で付きます)"></textarea>
      <div class="row">
        <label><input type="radio" name="urgency" value="normal" checked /> 📮 通常</label>
        <label><input type="radio" name="urgency" value="urgent" /> 🚨 緊急</label>
        <span class="spacer" style="flex:1"></span>
        <button id="comment-send" type="button">送信</button>
      </div>
    </div>
  </div>
</main>
<div id="toast"></div>
<script>
"use strict";
(() => {
  const token = new URLSearchParams(location.search).get("token") || "";
  const headers = { authorization: "Bearer " + token };
  const $ = (id) => document.getElementById(id);

  // ---- テーマ(設計書 §5: localStorage > config > prefers-color-scheme) ----
  const THEMES = ["light", "dark", "device"];
  const media = matchMedia("(prefers-color-scheme: dark)");
  function themeChoice() {
    const saved = localStorage.getItem("pitcrew-theme");
    if (THEMES.includes(saved)) return saved;
    const config = document.documentElement.dataset.configTheme;
    return THEMES.includes(config) ? config : "device";
  }
  function applyTheme() {
    const choice = themeChoice();
    const effective = choice === "device" ? (media.matches ? "dark" : "light") : choice;
    document.documentElement.dataset.theme = effective;
    $("theme-toggle").textContent = "テーマ: " + choice;
  }
  $("theme-toggle").addEventListener("click", () => {
    const next = THEMES[(THEMES.indexOf(themeChoice()) + 1) % THEMES.length];
    localStorage.setItem("pitcrew-theme", next);
    applyTheme();
  });
  media.addEventListener("change", applyTheme);
  applyTheme();

  // ---- 状態 ----
  let state = null;
  let selected = null; // { status, name, id, paths, base, type }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2500);
  }

  function ago(iso) {
    if (!iso) return "";
    const sec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (sec < 60) return sec + "秒前";
    if (sec < 3600) return Math.floor(sec / 60) + "分前";
    return Math.floor(sec / 3600) + "時間前";
  }

  // ---- 一覧描画(textContent のみ使用。innerHTML 禁止) ----
  function renderItem(item) {
    const div = document.createElement("div");
    div.className = "queue-item " + item.status +
      (selected && selected.name === item.name && selected.status === item.status
        ? " selected" : "");
    const row = document.createElement("div");
    row.className = "row";
    const badge = document.createElement("span");
    const type = ["diff", "artifact", "test"].includes(item.type) ? item.type : "diff";
    badge.className = "badge " + type;
    badge.textContent = item.type || "?";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = item.title;
    row.append(badge, title);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [item.agent, ago(item.created)].filter(Boolean).join(" · ");
    div.append(row, meta);
    div.addEventListener("click", () => select(item));
    return div;
  }

  function renderQueue() {
    const pane = $("queue-pane");
    pane.textContent = "";
    if (!state || (state.review.length === 0 && state.reviewed.length === 0)) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "レビュー項目はまだありません。";
      pane.append(empty);
      return;
    }
    if (state.review.length > 0) {
      const label = document.createElement("div");
      label.className = "section";
      label.textContent = "レビュー待ち";
      pane.append(label);
      for (const item of state.review) pane.append(renderItem(item));
    }
    if (state.reviewed.length > 0) {
      const label = document.createElement("div");
      label.className = "section";
      label.textContent = "レビュー済み";
      pane.append(label);
      for (const item of state.reviewed) pane.append(renderItem(item));
    }
  }

  function renderStatus() {
    if (!state) return;
    $("stat-run").textContent = state.hasRun
      ? "実行中(" + (state.startedAt || "") + " 開始)" : "記録なし";
    $("stat-phase-wrap").hidden = !state.phase;
    $("stat-phase").textContent = state.phase || "-";
    $("stat-review").textContent = String(state.review.length);
    $("stat-comments").textContent = String(state.openComments);
    $("stat-capture").textContent = state.lastCaptureAt
      ? ago(state.lastCaptureAt) : "-";
  }

  // ---- 詳細(diff は行頭記号で色分け。行は textContent で追加) ----
  function renderBody(text, isDiff) {
    const pre = $("detail-body");
    pre.textContent = "";
    if (!isDiff) {
      pre.textContent = text;
      return;
    }
    for (const line of text.split("\n")) {
      const span = document.createElement("span");
      if (line.startsWith("+") && !line.startsWith("+++")) span.className = "add";
      else if (line.startsWith("-") && !line.startsWith("---")) span.className = "del";
      else if (line.startsWith("@@")) span.className = "hunk";
      span.textContent = line + "\n";
      if (span.className) {
        // 行コメントの入口(設計書 §5): クリックで該当行を引用として挿入
        span.style.cursor = "pointer";
        span.title = "クリックでこの行を引用コメント";
        span.addEventListener("click", () => {
          const area = $("comment-body");
          area.value = (area.value === "" ? "" : area.value + "\n") +
            "> " + line + "\n";
          area.focus();
        });
      }
      pre.append(span);
    }
  }

  async function select(item) {
    selected = item;
    $("detail-title").textContent = item.title;
    $("approve-btn").disabled = item.status !== "review";
    renderQueue();
    try {
      const res = await fetch(
        "/api/item?status=" + encodeURIComponent(item.status) +
          "&name=" + encodeURIComponent(item.name),
        { headers }
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      renderBody(data.body, item.type === "diff");
    } catch {
      renderBody("(読み込みに失敗しました)", false);
    }
  }

  // ---- 操作 ----
  $("approve-btn").addEventListener("click", async () => {
    if (!selected || selected.status !== "review") return;
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: selected.name })
    });
    if (res.ok) {
      toast("承認しました: " + selected.name);
      selected = { ...selected, status: "reviewed" };
      $("approve-btn").disabled = true;
      await refresh();
    } else toast("承認に失敗しました");
  });

  $("comment-send").addEventListener("click", async () => {
    const body = $("comment-body").value;
    if (body.trim() === "") {
      toast("コメント本文が空です");
      return;
    }
    const urgency = document.querySelector('input[name="urgency"]:checked').value;
    const payload = { body, urgency };
    if (selected) {
      payload.paths = selected.paths || [];
      if (selected.id) payload.reviewId = selected.id;
      if (selected.base) payload.base = selected.base;
    }
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      $("comment-body").value = "";
      toast((urgency === "urgent" ? "🚨" : "📮") + " 送信しました: " + data.name);
      await refresh();
    } else toast("送信に失敗しました");
  });

  // ---- 同期(SSE + 再取得) ----
  async function refresh() {
    try {
      const res = await fetch("/api/state", { headers });
      if (!res.ok) return;
      state = await res.json();
      renderStatus();
      renderQueue();
    } catch {
      // サーバー停止中は次の SSE 再接続まで待つ
    }
  }

  function subscribe() {
    const es = new EventSource("/api/events?token=" + encodeURIComponent(token));
    es.onmessage = () => refresh();
    es.onerror = () => {
      es.close();
      setTimeout(subscribe, 5000);
    };
  }

  refresh();
  subscribe();
  setInterval(() => {
    renderStatus();
  }, 30000); // 経過時間表示の定期更新
})();
</script>
</body>
</html>
```

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/serve.test.ts`
Expected: PASS(既存 3 + 追加 1)

- [ ] **Step 5: 全テスト・lint・typecheck・ビルド**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: すべて成功。`plugins/pitcrew/scripts/ui.html` に差分が出る

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server plugins/pitcrew/scripts
git commit -m "feat: pitcrew ブラウザビューアの UI(2 ペイン+テーマ切替)"
```

---

### Task 7: `/pitcrew:serve` コマンド

**Files:**
- Create: `plugins/pitcrew/commands/serve.md`

**Interfaces:**
- Consumes: Task 5 の `scripts/serve.mjs`(stdout 1 行目の URL と `.pitcrew/serve.json`)
- Produces: なし(ユーザー向けコマンド)

コマンドは Markdown(LLM への手順書)なので自動テストはない。実機確認で検証する。

- [ ] **Step 1: commands/serve.md を作成する**

`plugins/pitcrew/commands/serve.md` を次の内容で新規作成:

````markdown
---
description: pitcrew のブラウザビューアを起動し、レビュー用 URL を表示する
---

pitcrew のブラウザビューア(ローカル HTTP サーバー)を起動してください。
以下の手順に厳密に従うこと。

## 手順

### 1. 既存サーバーの確認

`.pitcrew/serve.json` があれば読み、`pid` のプロセスが生きているか確認する
(`kill -0 <pid>` の成功で判定。Claude Code の Bash ツールは Windows でも
Git Bash / WSL 経由で `kill` が使えるため、これで統一する)。

- 生きていれば新たに起動せず、`serve.json` の `url` を「すでに起動しています」と
  ユーザーに提示して終了する
- 死んでいれば残留ファイルなので気にせず次へ進む(起動時に上書きされる)

### 2. 起動

Bash ツールで次を実行する(`run_in_background: true` を必ず使う。
フォアグラウンド実行するとセッションが止まる):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" --dir "$(pwd)"
```

- ポートは `.claude/pitcrew.local.md` の `port`(既定 7373)が使われる。
  ユーザーが引数でポートを指定した場合のみ `--port <n>` を付ける

### 3. URL の提示

起動後、`.pitcrew/serve.json` が生成されるまで待つ(1 秒間隔で最大 10 秒、
Bash の `until` ループで確認)。生成されたら `url` を読み取り、ユーザーに提示する:

- 「ブラウザで次の URL を開いてください: <url>」
- 「トークン付き URL なのでこのまま開けます。サーバーは localhost のみで待ち受けています」
- 「停止するときは `/pitcrew:serve stop` と依頼してください」

10 秒待っても `serve.json` が無い場合は、バックグラウンドタスクの出力を確認して
エラー内容(ポート使用中など)をユーザーに伝える。ポート使用中の場合は
`/pitcrew:config` でのポート変更を案内する。

### 4. 停止(ユーザーが "stop" を指定した場合)

引数に `stop` が含まれる場合は起動ではなく停止を行う:

1. `.pitcrew/serve.json` の `pid` を読み、`kill <pid>` で SIGTERM を送る
   (サーバー側が serve.json を削除して終了する)
2. `serve.json` が無い・プロセスが既に無い場合は「起動していません」と伝える
````

- [ ] **Step 2: セルフチェック**

次を目視確認する:

- 起動コマンドのパスが `${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs`(Task 5 のバンドル出力)と一致している
- `serve.json` のキー参照(`url` / `pid`)が Global Constraints のスキーマと一致している
- バックグラウンド起動(`run_in_background`)の指示がある
- ユーザーに CLI の直接操作を要求していない(すべて Claude が実行する)

- [ ] **Step 3: コミット**

```bash
git add plugins/pitcrew/commands/serve.md
git commit -m "feat: pitcrew /pitcrew:serve コマンド(ビューア起動)"
```

---

### Task 8: README・config コマンド更新・バージョン・最終確認

**Files:**
- Modify: `plugins/pitcrew/README.md`
- Modify: `plugins/pitcrew/commands/config.md`(viewer の選択肢から「(後続ステージで実装予定)」を browser だけ外す)
- Modify: `plugins/pitcrew/.claude-plugin/plugin.json`(`0.8.0` → `0.9.0-dev`)

**Interfaces:**
- Consumes: Task 1-7 の成果(ドキュメント化のみ)
- Produces: なし

- [ ] **Step 1: README を更新する**

`plugins/pitcrew/README.md` に次の変更を加える:

1. 冒頭段落の「(専用ビューアは後続ステージで追加予定)」を「(ブラウザビューアあり。TUI は後続ステージで追加予定)」に変更(行番号ではなく文字列で探すこと)
2. 「## 設定(Stage 3: /pitcrew:config)」セクションの直前に次のセクションを追加:

```markdown
## ブラウザビューア(Stage 4: /pitcrew:serve)

`/pitcrew:serve` でローカル HTTP サーバーが起動し、トークン付き URL が表示される。
ブラウザで開くと 2 ペインのレビュー画面(左: キュー、右: 詳細+コメント欄)が使える。

- レビューキューは `.pitcrew/` の変更を SSE で自動反映(リロード不要)
- diff は行単位で色分け表示。「承認して既読」で `reviewed/` へ移動
- コメントは 📮 通常 / 🚨 緊急 を選んで送信すると `.pitcrew/comments/` に保存され、
  Stage 2 の注入層がセッションへ届ける(選択中項目の paths / reviewId / base が自動で付く)
- テーマはライト / ダーク / デバイス追従。優先順位は
  「画面での手動切替(localStorage)> config の `theme` > デバイス設定」
- サーバーは `127.0.0.1` のみで待ち受け、URL のトークンが無いと 401 を返す。
  起動情報は `.pitcrew/serve.json`(停止時に削除)
- 停止は `/pitcrew:serve stop`
```

3. 「## `.pitcrew/` の構造」のコード
ブロックに `├── serve.json  # ブラウザビューア起動情報(serve 起動中のみ)` の行を `run.json` の下に追加

- [ ] **Step 2: commands/config.md の viewer 選択肢を更新する**

`plugins/pitcrew/commands/config.md` の次の 2 箇所を変更:

1. 現在値テーブルの `viewer` 行「browser・tui は後続ステージで実装予定」を「tui は後続ステージで実装予定」に変更
2. 対話 1 問目の選択肢「ブラウザ(後続ステージで実装予定)」を「ブラウザ(/pitcrew:serve で起動)」に変更

- [ ] **Step 3: バージョンを上げる**

`plugins/pitcrew/.claude-plugin/plugin.json` の `version` を `0.9.0-dev` に変更する。

- [ ] **Step 4: 全体検証**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && git status --short`
Expected: テスト全件パス・lint/typecheck エラーなし・ビルド後に未コミット差分が README / commands/config.md / plugin.json 以外に無いこと(あれば `scripts/` の取り込み漏れなのでコミットに含める)

- [ ] **Step 5: コミット**

```bash
git add plugins/pitcrew/README.md plugins/pitcrew/commands/config.md plugins/pitcrew/.claude-plugin/plugin.json
git commit -m "docs: pitcrew Stage 4 の README 更新とバージョン 0.9.0-dev"
```

---

## 実機確認手順(実装完了後・ユーザー向け)

1. `/pitcrew:serve` を実行 → URL が表示され、ブラウザで 2 ペイン画面が開くことを確認する
2. 別ターミナルの Claude Code セッションでサブエージェントを走らせる(または `.pitcrew/review/` に手でファイルを置く)→ リロードなしで左ペインに項目が現れることを確認する
3. diff 項目を選択 → 右ペインで行単位色分けされることを確認する
4. 「承認して既読」→ 項目がグレーアウトして「レビュー済み」へ移ることを確認する
5. コメントを 🚨 緊急で送信 → `.pitcrew/comments/c-NNN.md` が生成され、対象パスを触る Edit の直前にセッションへ注入されることを確認する(Stage 2 の注入層)
6. テーマ切替ボタンで light / dark / device が循環し、リロード後も保持されることを確認する
7. `/pitcrew:config` で `theme: dark` にして localStorage を消す(シークレットウィンドウで開き直す)→ 初期表示がダークになることを確認する
8. `/pitcrew:serve stop` → サーバーが終了し `.pitcrew/serve.json` が消えることを確認する







