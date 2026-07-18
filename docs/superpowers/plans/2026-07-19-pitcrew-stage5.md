# pitcrew Stage 5(TUI ビューア `pitcrew watch`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.pitcrew/review/` のキュー一覧・詳細プレビュー・コメント作成・承認をターミナル上で行う TUI ビューア(`scripts/watch.mjs`)を追加する。

**Architecture:** `src/server/` にあるファイルバス操作 3 ファイル(`state.ts`/`watch.ts`/`viewer-ops.ts`)を `src/lib/` へ移動して共有層にし、その上に `src/tui/`(純粋関数 `render.ts`/`keymap.ts`、エディタ起動 `editor.ts`、イベントループ `loop.ts`、エントリ `main.ts`)を新設する。描画は alt screen buffer + 全画面再描画。設計書: `docs/superpowers/specs/2026-07-19-pitcrew-stage5-tui-design.md`

**Tech Stack:** TypeScript(Node 標準ライブラリのみ・依存追加禁止)、vitest、esbuild バンドル

## Global Constraints

- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装は禁止(CLAUDE.md)
- 依存パッケージの追加は禁止(pitcrew は Node 標準ライブラリのみ。TUI フレームワーク・キー入力ライブラリも不可)
- バンドル出力は git 管理。ソース変更後は必ずリポジトリルートで `pnpm build` を実行し、生成物(`plugins/pitcrew/scripts/*.mjs`)の差分もコミットする
- テストはリポジトリルートで `pnpm test`(vitest)。lint は `pnpm lint`(biome)、型は `pnpm typecheck`。**各タスクのコミット前に必ず `pnpm lint` と `pnpm typecheck` を通す**
- コミットメッセージは既存の慣習(`feat:` / `fix:` / `refactor:` / `chore:` + 日本語)に従う
- `plugins/pitcrew/.claude-plugin/plugin.json` のバージョンは **Task 6 でのみ** 0.9.4 → 0.10.0 に変更する。他のタスクで plugin.json を触らない
- ベースラインのテスト数は 733(Stage 4.2 完了時点)。着手前の `pnpm test` で失敗があれば報告して停止する
- ANSI コードは直書き(緑 `\x1b[32m`・赤 `\x1b[31m`・リセット `\x1b[0m`・カーソル表示 `\x1b[?25h`/非表示 `\x1b[?25l`・alt screen `\x1b[?1049h`/`\x1b[?1049l`)。色検知・True Color 対応はしない

**作業ディレクトリ:** すべてのパスはリポジトリルート `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/` からの相対パス。

**ビルドのタイミング:** `pnpm build` は Task 1(移動の反映)と Task 5 以降(TUI エントリ追加後)で実行する。Task 2〜4 は `src/tui/` の新規ファイルのみでバンドルエントリに含まれないため、ビルドは不要(`pnpm lint && pnpm typecheck` のみでよい)。

**ステータス行の message:** 最後に設定された 1 件のみを表示する仕様(設計書 §4)。複数のエラーを積む・タイマーで消す機構は作らない。

---

### Task 1: state.ts / watch.ts / viewer-ops.ts を src/lib/ へ移動

**Files:**
- Move: `plugins/pitcrew/src/server/state.ts` → `plugins/pitcrew/src/lib/state.ts`
- Move: `plugins/pitcrew/src/server/watch.ts` → `plugins/pitcrew/src/lib/watch.ts`
- Move: `plugins/pitcrew/src/server/viewer-ops.ts` → `plugins/pitcrew/src/lib/viewer-ops.ts`
- Move: `plugins/pitcrew/src/server/__test__/state.test.ts` → `plugins/pitcrew/src/lib/__test__/state.test.ts`
- Move: `plugins/pitcrew/src/server/__test__/watch.test.ts` → `plugins/pitcrew/src/lib/__test__/watch.test.ts`
- Move: `plugins/pitcrew/src/server/__test__/viewer-ops.test.ts` → `plugins/pitcrew/src/lib/__test__/viewer-ops.test.ts`
- Modify: `plugins/pitcrew/src/server/http.ts`(import パスのみ)

**Interfaces:**
- Consumes: なし(機械的な移動)
- Produces: 後続タスクが import する共有層。移動後のモジュールパスと公開シグネチャ:
  - `src/lib/state.ts`: `listState(projectDir: string): PitcrewState`・`readItemBody(projectDir: string, status: "review" | "reviewed", name: string): string | null`・`isSafeName(name: string): boolean`・型 `QueueItem`(`name`/`status`/`id`/`type`/`agent`/`created`/`paths`/`base`/`head`/`title`)・型 `PitcrewState`(`hasRun`/`startedAt`/`lastCaptureAt`/`phase`/`review`/`reviewed`/`openComments`/`processedComments`)
  - `src/lib/watch.ts`: `watchPitcrew(projectDir: string, onChange: () => void): () => void`(戻り値は stop 関数)
  - `src/lib/viewer-ops.ts`: `approveItem(projectDir: string, name: string): boolean`・`writeComment(projectDir: string, comment: NewComment): string | null`・型 `NewComment`(`body: string`・`urgency: "urgent" | "normal"`・`paths: string[]`・`reviewId: string | null`・`base: string | null`)

- [ ] **Step 1: ベースライン確認**

Run: `pnpm test`
Expected: 733 tests PASS(失敗があれば着手前に報告して停止)

続けて、移動対象の現在の import を確認する(Step 3 の書き換え対象が例示と一致するか):

Run: `grep -n "^import\|from \"" plugins/pitcrew/src/server/state.ts plugins/pitcrew/src/server/watch.ts plugins/pitcrew/src/server/viewer-ops.ts`
Expected: `../lib/frontmatter.js`・`../lib/run.js`・`../lib/atomic.js`・`./state.js` のみ(異なる import があれば Step 3 で同じ規則 — `../lib/` → `./`、同階層 `./` はそのまま — で読み替える)

- [ ] **Step 2: git mv で 6 ファイルを移動**

```bash
cd plugins/pitcrew
git mv src/server/state.ts src/lib/state.ts
git mv src/server/watch.ts src/lib/watch.ts
git mv src/server/viewer-ops.ts src/lib/viewer-ops.ts
git mv src/server/__test__/state.test.ts src/lib/__test__/state.test.ts
git mv src/server/__test__/watch.test.ts src/lib/__test__/watch.test.ts
git mv src/server/__test__/viewer-ops.test.ts src/lib/__test__/viewer-ops.test.ts
```

- [ ] **Step 3: 移動したファイル内の import パスを修正**

移動した 3 ソースは `../lib/xxx.js` を同階層参照に変える:

- `src/lib/state.ts`: `from "../lib/frontmatter.js"` → `from "./frontmatter.js"`、`from "../lib/run.js"` → `from "./run.js"`
- `src/lib/watch.ts`: `from "../lib/run.js"` → `from "./run.js"`
- `src/lib/viewer-ops.ts`: `from "../lib/atomic.js"` → `from "./atomic.js"`、`from "../lib/frontmatter.js"` → `from "./frontmatter.js"`、`from "../lib/run.js"` → `from "./run.js"`(`from "./state.js"` はそのまま)

テスト 3 ファイルの相対 import(`../state.js` 等)は移動後も同じ相対位置なので変更不要だが、テストが `../../lib/...` や `../../testing/...` を参照している場合はパス段数を確認して修正する(`src/server/__test__/` と `src/lib/__test__/` はどちらも `src/` から 2 階層なので原則そのまま)。

- [ ] **Step 4: http.ts の import を修正**

`plugins/pitcrew/src/server/http.ts` の以下 3 行を変更:

```ts
import { listState, readItemBody } from "../lib/state.js"
import {
  // (既存の import 名はそのまま)
} from "../lib/viewer-ops.js"
import { watchPitcrew } from "../lib/watch.js"
```

(元は `"./state.js"`・`"./viewer-ops.js"`・`"./watch.js"`)

- [ ] **Step 5: 参照漏れの確認**

Run: `grep -rn "server/state\|server/watch\|server/viewer-ops\|\./state.js\|\./watch.js\|\./viewer-ops.js" plugins/pitcrew/src/server/ plugins/pitcrew/src/hooks/`
Expected: http.ts の修正済み `../lib/` 参照以外にヒットなし(それ以外のヒットが出た場合は import の修正漏れ。該当行を `../lib/xxx.js` に修正してから次へ進む)

- [ ] **Step 6: テスト・lint・typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 733 tests PASS(件数変化なし)・lint/typecheck エラーなし

- [ ] **Step 7: バンドル再生成とコミット**

```bash
pnpm build
git add -A plugins/pitcrew
git commit -m "refactor: pitcrew のファイルバス操作層(state/watch/viewer-ops)を src/lib/ へ移動"
```

---

### Task 2: keymap.ts(キー入力 → アクション)

このモジュールは Task 5 の `loop.ts` から使われる(このタスク内では import 元がまだ無いのが正しい)。

**Files:**
- Create: `plugins/pitcrew/src/tui/keymap.ts`
- Test: `plugins/pitcrew/src/tui/__test__/keymap.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数のみ)
- Produces(Task 5 が使う):
  - `type Action = "up" | "down" | "comment" | "approve" | "quit" | "none"`
  - `keyToAction(key: KeyInput): Action`(`KeyInput = { name?: string; ctrl?: boolean }`)
  - `moveSelection(current: number, delta: number, length: number): number`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/tui/__test__/keymap.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { keyToAction, moveSelection } from "../keymap.js"

describe("keyToAction", () => {
  it("j / 下矢印は down", () => {
    expect(keyToAction({ name: "j" })).toBe("down")
    expect(keyToAction({ name: "down" })).toBe("down")
  })

  it("k / 上矢印は up", () => {
    expect(keyToAction({ name: "k" })).toBe("up")
    expect(keyToAction({ name: "up" })).toBe("up")
  })

  it("c はコメント・a は承認・q は終了", () => {
    expect(keyToAction({ name: "c" })).toBe("comment")
    expect(keyToAction({ name: "a" })).toBe("approve")
    expect(keyToAction({ name: "q" })).toBe("quit")
  })

  it("Ctrl+C は quit(raw mode では SIGINT にならないため)", () => {
    expect(keyToAction({ name: "c", ctrl: true })).toBe("quit")
  })

  it("未定義キーと name なしは none", () => {
    expect(keyToAction({ name: "x" })).toBe("none")
    expect(keyToAction({})).toBe("none")
  })
})

describe("moveSelection", () => {
  it("範囲内の移動", () => {
    expect(moveSelection(1, 1, 3)).toBe(2)
    expect(moveSelection(1, -1, 3)).toBe(0)
  })

  it("先頭・末尾でクランプ(ラップしない)", () => {
    expect(moveSelection(0, -1, 3)).toBe(0)
    expect(moveSelection(2, 1, 3)).toBe(2)
  })

  it("空一覧は常に -1", () => {
    expect(moveSelection(-1, 1, 0)).toBe(-1)
    expect(moveSelection(0, -1, 0)).toBe(-1)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- keymap`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装**

`plugins/pitcrew/src/tui/keymap.ts`:

```ts
// TUI のキー入力 → アクション変換(設計書 §3.2)。純粋関数のみ。
// raw mode では Ctrl+C が SIGINT にならず keypress として届くため、
// ここで quit に写像する。

export type Action = "up" | "down" | "comment" | "approve" | "quit" | "none"

export interface KeyInput {
  name?: string
  ctrl?: boolean
}

export function keyToAction(key: KeyInput): Action {
  if (key.ctrl && key.name === "c") return "quit"
  switch (key.name) {
    case "j":
    case "down":
      return "down"
    case "k":
    case "up":
      return "up"
    case "c":
      return "comment"
    case "a":
      return "approve"
    case "q":
      return "quit"
    default:
      return "none"
  }
}

// 選択位置の移動。先頭・末尾で止まる(ラップしない)。空一覧は -1
export function moveSelection(
  current: number,
  delta: number,
  length: number
): number {
  if (length <= 0) return -1
  const next = (current < 0 ? 0 : current) + delta
  if (next < 0) return 0
  if (next >= length) return length - 1
  return next
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- keymap`
Expected: PASS

- [ ] **Step 5: lint・typecheck・コミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/tui
git commit -m "feat: pitcrew TUI のキーマップ(j/k/c/a/q)を追加"
```

---

### Task 3: render.ts(状態 → 画面文字列)

**Files:**
- Create: `plugins/pitcrew/src/tui/render.ts`
- Test: `plugins/pitcrew/src/tui/__test__/render.test.ts`

**Interfaces:**
- Consumes: `QueueItem`・`PitcrewState`(`../lib/state.js`、Task 1 で移動済み)
- Produces(Task 5 が使う):
  - `interface RenderInput { state: PitcrewState; selected: number; body: string | null; message: string | null; rows: number; cols: number; now: Date }`
  - `renderScreen(input: RenderInput): string[]` — 端末に出す行の配列(長さ ≤ rows)。ANSI 色コード込み

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/tui/__test__/render.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { PitcrewState, QueueItem } from "../../lib/state.js"
import { renderScreen } from "../render.js"

function makeItem(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    name: `${id}-diff.md`,
    status: "review",
    id,
    type: "diff",
    agent: "implementer",
    created: "2026-07-19T12:00:00.000Z",
    paths: [],
    base: null,
    head: null,
    title: `item ${id}`,
    ...overrides
  }
}

function makeState(review: QueueItem[]): PitcrewState {
  return {
    hasRun: true,
    startedAt: null,
    lastCaptureAt: null,
    phase: null,
    review,
    reviewed: [],
    openComments: 1,
    processedComments: 0
  }
}

const now = new Date("2026-07-19T12:02:00.000Z")

describe("renderScreen", () => {
  it("先頭行はステータスバー、末尾行はキーヘルプ", () => {
    const lines = renderScreen({
      state: makeState([makeItem("003")]),
      selected: 0,
      body: null,
      message: null,
      rows: 10,
      cols: 80,
      now
    })
    expect(lines.length).toBeLessThanOrEqual(10)
    expect(lines[0]).toContain("未レビュー: 1")
    expect(lines[0]).toContain("未回収コメント: 1")
    expect(lines[lines.length - 1]).toContain("[q]終了")
  })

  it("message があればステータスバーに優先表示する", () => {
    const lines = renderScreen({
      state: makeState([]),
      selected: -1,
      body: null,
      message: "$EDITOR または $VISUAL を設定してください",
      rows: 10,
      cols: 80,
      now
    })
    expect(lines[0]).toContain("$EDITOR")
  })

  it("選択行に → マークが付き、経過時間を表示する", () => {
    const lines = renderScreen({
      state: makeState([makeItem("003"), makeItem("002")]),
      selected: 1,
      body: null,
      message: null,
      rows: 12,
      cols: 80,
      now
    })
    const listLines = lines.filter((l) => l.includes("00"))
    expect(listLines.find((l) => l.includes("002"))).toContain("→")
    expect(listLines.find((l) => l.includes("003"))).not.toContain("→")
    expect(lines.join("\n")).toContain("2分前")
  })

  it("diff の +/- 行にのみ ANSI 色コードが付く", () => {
    const lines = renderScreen({
      state: makeState([makeItem("003")]),
      selected: 0,
      body: "+ added\n- removed\n  context",
      message: null,
      rows: 12,
      cols: 80,
      now
    })
    const joined = lines.join("\n")
    expect(joined).toContain("\x1b[32m+ added\x1b[0m")
    expect(joined).toContain("\x1b[31m- removed\x1b[0m")
    expect(joined).toContain("  context")
    expect(joined).not.toContain("\x1b[32m  context")
  })

  it("空一覧では一覧・プレビューが空で、クラッシュしない", () => {
    const lines = renderScreen({
      state: makeState([]),
      selected: -1,
      body: null,
      message: null,
      rows: 8,
      cols: 80,
      now
    })
    expect(lines[0]).toContain("未レビュー: 0")
    expect(lines.length).toBeLessThanOrEqual(8)
  })

  it("行数配分: 一覧は残り行の半分(切り上げ)が上限、超過分はプレビューへ", () => {
    // rows=10 → 固定2行を除き残り8。一覧上限 ceil(8/2)=4
    const items = ["009", "008", "007", "006", "005", "004"].map((id) =>
      makeItem(id)
    )
    const lines = renderScreen({
      state: makeState(items),
      selected: 0,
      body: "line1\nline2\nline3\nline4\nline5\nline6",
      message: null,
      rows: 10,
      cols: 80,
      now
    })
    const listLines = lines.filter((l) => /00[4-9]/.test(l))
    expect(listLines.length).toBe(4)
  })

  it("一覧のスクロール: 選択項目が常に表示範囲に入る", () => {
    const items = ["009", "008", "007", "006", "005", "004"].map((id) =>
      makeItem(id)
    )
    const lines = renderScreen({
      state: makeState(items),
      selected: 5,
      body: null,
      message: null,
      rows: 10,
      cols: 80,
      now
    })
    expect(lines.join("\n")).toContain("004")
    expect(lines.find((l) => l.includes("004"))).toContain("→")
  })

  it("極小サイズ(rows=2)でも該当領域を描画しないだけでクラッシュしない", () => {
    const lines = renderScreen({
      state: makeState([makeItem("003")]),
      selected: 0,
      body: "+ x",
      message: null,
      rows: 2,
      cols: 80,
      now
    })
    expect(lines.length).toBeLessThanOrEqual(2)
  })

  it("cols を超える行は切り詰められる", () => {
    const lines = renderScreen({
      state: makeState([makeItem("003", { agent: "a".repeat(100) })]),
      selected: 0,
      body: null,
      message: null,
      rows: 10,
      cols: 40,
      now
    })
    for (const line of lines) {
      // 色コードを除いた表示幅で確認(このケースの一覧行は無色)
      expect(line.replace(/\x1b\[[0-9;]*m/g, "").length).toBeLessThanOrEqual(40)
    }
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- render`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装**

`plugins/pitcrew/src/tui/render.ts`:

```ts
// TUI の描画(設計書 §3.2)。純粋関数: 状態と端末サイズから行配列を作るだけで、
// 端末への書き込みは loop.ts が行う。行数配分は
// 「固定 2 行(ステータス・キーヘルプ)を除いた残りのうち、
//   一覧 = min(件数, ceil(残り/2))、プレビュー = その残り全行」。
// 0 以下になった領域は描画しない(クラッシュ・警告なし。設計書 §3.2)。

import type { PitcrewState, QueueItem } from "../lib/state.js"

export interface RenderInput {
  state: PitcrewState
  selected: number
  body: string | null
  message: string | null
  rows: number
  cols: number
  now: Date
}

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"

// 文字列長ベースの切り詰め。ANSI 色コードは truncate 後に colorDiffLine で
// 付けるため、色コード込みの行を渡してはならない(表示幅が cols を超える)
function truncate(line: string, cols: number): string {
  return line.length > cols ? line.slice(0, cols) : line
}

function formatAge(created: string | null, now: Date): string {
  if (created === null) return ""
  const t = Date.parse(created)
  if (Number.isNaN(t)) return ""
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1000))
  if (sec < 60) return "たった今"
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`
  return `${Math.floor(sec / 86400)}日前`
}

function itemLine(item: QueueItem, isSelected: boolean, now: Date): string {
  const mark = isSelected ? "→" : " "
  const id = item.id ?? item.name
  const type = item.type ?? "?"
  const agent = item.agent ?? "?"
  return `${mark} ${id.padEnd(5)} ${type.padEnd(9)} ${agent.padEnd(14)} ${formatAge(item.created, now)}`
}

function colorDiffLine(line: string): string {
  if (line.startsWith("+")) return `${GREEN}${line}${RESET}`
  if (line.startsWith("-")) return `${RED}${line}${RESET}`
  return line
}

export function renderScreen(input: RenderInput): string[] {
  const { state, selected, body, message, rows, cols, now } = input
  const items = state.review
  const lines: string[] = []

  const remaining = Math.max(0, rows - 2)
  const listRows = Math.min(items.length, Math.ceil(remaining / 2))
  const previewRows = Math.max(0, remaining - listRows)

  if (rows >= 1) {
    const status =
      message ??
      `未レビュー: ${items.length}   未回収コメント: ${state.openComments}`
    lines.push(truncate(status, cols))
  }

  // 一覧: 選択項目が表示範囲に入るようにウィンドウをずらす
  let start = 0
  if (selected >= listRows) start = selected - listRows + 1
  for (let i = start; i < start + listRows && i < items.length; i++) {
    lines.push(truncate(itemLine(items[i], i === selected, now), cols))
  }

  // プレビュー: メタ 1 行 + 本文(色付けは切り詰め後に行う)
  if (previewRows > 0 && selected >= 0 && selected < items.length) {
    const item = items[selected]
    const preview: string[] = [
      `id:${item.id ?? "?"} type:${item.type ?? "?"} agent:${item.agent ?? "?"}`
    ]
    if (body !== null) preview.push(...body.split("\n"))
    for (const raw of preview.slice(0, previewRows)) {
      lines.push(colorDiffLine(truncate(raw, cols)))
    }
  }

  if (rows >= 2) {
    lines.push(
      truncate("[j/k]移動 [c]コメント [a]承認して既読 [q]終了", cols)
    )
  }
  return lines
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- render`
Expected: PASS

- [ ] **Step 5: lint・typecheck・コミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/tui
git commit -m "feat: pitcrew TUI の画面描画(render)を追加"
```

---

### Task 4: editor.ts($EDITOR 起動)

**Files:**
- Create: `plugins/pitcrew/src/tui/editor.ts`
- Test: `plugins/pitcrew/src/tui/__test__/editor.test.ts`

**Interfaces:**
- Consumes: `node:child_process` の `spawnSync`(注入可能にする)
- Produces(Task 5 が使う):
  - `resolveEditor(env: Record<string, string | undefined>): { cmd: string; args: string[] } | null` — `$VISUAL` 優先、空白分割。未設定は null
  - `openInEditor(env, filePath: string, spawn?): { ok: boolean } | null` — null は未設定、`ok` は exit code 0 か

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/tui/__test__/editor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { openInEditor, resolveEditor } from "../editor.js"

describe("resolveEditor", () => {
  it("VISUAL を EDITOR より優先する", () => {
    expect(
      resolveEditor({ VISUAL: "code --wait", EDITOR: "vim" })
    ).toEqual({ cmd: "code", args: ["--wait"] })
  })

  it("VISUAL が無ければ EDITOR を使う", () => {
    expect(resolveEditor({ EDITOR: "vim" })).toEqual({ cmd: "vim", args: [] })
  })

  it("引数付きの値は空白で分割する(shell は介さない)", () => {
    expect(resolveEditor({ EDITOR: "vim -u NONE" })).toEqual({
      cmd: "vim",
      args: ["-u", "NONE"]
    })
  })

  it("どちらも未設定・空文字列なら null", () => {
    expect(resolveEditor({})).toBeNull()
    expect(resolveEditor({ EDITOR: "  " })).toBeNull()
  })
})

describe("openInEditor", () => {
  it("スクラッチパスを末尾引数に付けて stdio: inherit で spawn する", () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 })
    const result = openInEditor({ EDITOR: "vim -u NONE" }, "/tmp/s.md", spawn)
    expect(spawn).toHaveBeenCalledWith("vim", ["-u", "NONE", "/tmp/s.md"], {
      stdio: "inherit"
    })
    expect(result).toEqual({ ok: true })
  })

  it("exit code が 0 以外なら ok: false", () => {
    const spawn = vi.fn().mockReturnValue({ status: 1 })
    expect(openInEditor({ EDITOR: "vim" }, "/tmp/s.md", spawn)).toEqual({
      ok: false
    })
  })

  it("エディタ未設定なら spawn せず null", () => {
    const spawn = vi.fn()
    expect(openInEditor({}, "/tmp/s.md", spawn)).toBeNull()
    expect(spawn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- editor`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装**

`plugins/pitcrew/src/tui/editor.ts`:

```ts
// $EDITOR / $VISUAL でスクラッチファイルを開く(設計書 §3.3)。
// spawnSync でエディタ終了までブロックする(呼び出し側が raw mode を
// 解除してから呼ぶ)。環境変数は空白分割のみで shell は介さない。

import { spawnSync } from "node:child_process"

export interface EditorCommand {
  cmd: string
  args: string[]
}

export function resolveEditor(
  env: Record<string, string | undefined>
): EditorCommand | null {
  const raw = (env.VISUAL?.trim() || env.EDITOR?.trim()) ?? ""
  if (raw === "") return null
  const parts = raw.split(/\s+/)
  return { cmd: parts[0], args: parts.slice(1) }
}

type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { stdio: "inherit" }
) => { status: number | null }

export function openInEditor(
  env: Record<string, string | undefined>,
  filePath: string,
  spawn: SpawnLike = spawnSync
): { ok: boolean } | null {
  const editor = resolveEditor(env)
  if (editor === null) return null
  const result = spawn(editor.cmd, [...editor.args, filePath], {
    stdio: "inherit"
  })
  return { ok: result.status === 0 }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- editor`
Expected: PASS

- [ ] **Step 5: lint・typecheck・コミット**

```bash
pnpm lint && pnpm typecheck
git add plugins/pitcrew/src/tui
git commit -m "feat: pitcrew TUI のエディタ起動(editor)を追加"
```

---

### Task 5: loop.ts / main.ts とバンドルエントリ

**Files:**
- Create: `plugins/pitcrew/src/tui/loop.ts`
- Create: `plugins/pitcrew/src/tui/main.ts`
- Modify: `plugins/pitcrew/build.ts`(entryPoints に `watch` を追加)

**Interfaces:**
- Consumes:
  - `listState`/`readItemBody`/`PitcrewState`(`../lib/state.js`)
  - `watchPitcrew`(`../lib/watch.js`)
  - `approveItem`/`writeComment`(`../lib/viewer-ops.js`)
  - `parseFrontmatter`/`serializeFrontmatter`(`../lib/frontmatter.js`)
  - `keyToAction`/`moveSelection`(Task 2)・`renderScreen`(Task 3)・`openInEditor`(Task 4)
- Produces: `runTui(projectDir: string): void`(main.ts が呼ぶ)。自動テストなし(設計書 §5.5: 実機確認で検証)

- [ ] **Step 1: loop.ts を実装**

前提の確認: `parseFrontmatter`(`src/lib/frontmatter.ts`)の戻り値は `{ data: Record<string, string | string[]>; body: string }`。値は文字列またはインライン配列のみで、パース失敗時は `{ data: {}, body: text }` が返る(このため下のコードは `data.paths` の文字列/配列両対応をしている)。

`plugins/pitcrew/src/tui/loop.ts`:

```ts
// TUI のイベントループ(設計書 §3.2〜§3.5)。raw mode・alt screen の管理、
// キー入力と watchPitcrew の 2 イベントソースの合流、後始末の一本化を担う。
// Node のシングルスレッドイベントループ上で各ハンドラは順番に完走するため
// 排他制御は不要(設計書 §3.4)。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.js"
import {
  listState,
  type PitcrewState,
  readItemBody
} from "../lib/state.js"
import { approveItem, writeComment } from "../lib/viewer-ops.js"
import { watchPitcrew } from "../lib/watch.js"
import { openInEditor } from "./editor.js"
import { keyToAction, moveSelection } from "./keymap.js"
import { renderScreen } from "./render.js"

const PLACEHOLDER = "(ここにコメント本文)"
const EMPTY_STATE: PitcrewState = {
  hasRun: false,
  startedAt: null,
  lastCaptureAt: null,
  phase: null,
  review: [],
  reviewed: [],
  openComments: 0,
  processedComments: 0
}

// fail-open(設計書 §3.5): 読めなければ空一覧で継続
function safeListState(projectDir: string): PitcrewState {
  try {
    return listState(projectDir)
  } catch {
    return EMPTY_STATE
  }
}

function itemKey(state: PitcrewState, index: number): string | null {
  const item = state.review[index]
  if (item === undefined) return null
  return item.id ?? item.name
}

export function runTui(projectDir: string): void {
  let state = safeListState(projectDir)
  let selected = state.review.length > 0 ? 0 : -1
  let message: string | null = null
  let cleanedUp = false

  const draw = (): void => {
    const item = state.review[selected]
    const body =
      item !== undefined
        ? readItemBody(projectDir, "review", item.name)
        : null
    const lines = renderScreen({
      state,
      selected,
      body,
      message,
      rows: process.stdout.rows ?? 24,
      cols: process.stdout.columns ?? 80,
      now: new Date()
    })
    process.stdout.write(`\x1b[2J\x1b[H${lines.join("\r\n")}`)
  }

  const cleanup = (): void => {
    if (cleanedUp) return
    cleanedUp = true
    try {
      process.stdin.setRawMode(false)
    } catch {
      // 端末が既に閉じている場合は無視
    }
    process.stdout.write("\x1b[?25h\x1b[?1049l")
  }

  const quit = (code: number): void => {
    cleanup()
    stopWatch()
    process.exit(code)
  }

  process.on("SIGINT", () => quit(0))
  process.on("SIGTERM", () => quit(0))
  process.on("uncaughtException", (err) => {
    cleanup()
    console.error(err.stack ?? String(err))
    process.exit(1)
  })

  // 選択位置の再解決(設計書 §3.4 の規則 1・3。規則 2 は approve() が
  // 同期的に選択を確定させるためここには現れない)
  const reload = (): void => {
    const oldKey = itemKey(state, selected)
    const oldIndex = selected
    state = safeListState(projectDir)
    if (state.review.length === 0) {
      selected = -1
    } else if (oldKey !== null) {
      const found = state.review.findIndex(
        (it) => (it.id ?? it.name) === oldKey
      )
      selected =
        found >= 0
          ? found
          : Math.min(Math.max(oldIndex, 0), state.review.length - 1)
    } else {
      selected = 0
    }
    draw()
  }

  const stopWatch = watchPitcrew(projectDir, reload)

  const approve = (): void => {
    const item = state.review[selected]
    if (item === undefined) return
    if (approveItem(projectDir, item.name)) {
      state = safeListState(projectDir)
      // 同じインデックス = 次の項目。末尾を超えたら直前の項目(設計書 §3.2)
      selected =
        state.review.length === 0
          ? -1
          : Math.min(selected, state.review.length - 1)
      message = null
    } else {
      message = `承認できませんでした: ${item.name}`
    }
    draw()
  }

  const comment = (): void => {
    const item = state.review[selected]
    if (item === undefined) return
    const scratch = path.join(
      os.tmpdir(),
      `pitcrew-comment-${process.pid}-${Date.now()}.md`
    )
    const fm: Record<string, string | string[]> = { urgency: "normal" }
    if (item.paths.length > 0) fm.paths = item.paths
    if (item.id !== null) fm.reviewId = item.id
    if (item.base !== null) fm.base = item.base
    fs.writeFileSync(scratch, `${serializeFrontmatter(fm)}\n${PLACEHOLDER}\n`)

    process.stdin.setRawMode(false)
    const result = openInEditor(process.env, scratch)
    process.stdin.setRawMode(true)

    if (result === null) {
      message = "$EDITOR または $VISUAL を設定してください"
    } else if (!result.ok) {
      message = "エディタが正常終了しなかったため送信しませんでした"
    } else {
      const { data, body } = parseFrontmatter(fs.readFileSync(scratch, "utf8"))
      const text = body.trim()
      if (text === "" || text === PLACEHOLDER) {
        message = "本文が空のため送信しませんでした"
      } else {
        const paths = Array.isArray(data.paths)
          ? data.paths
          : typeof data.paths === "string" && data.paths !== ""
            ? [data.paths]
            : []
        const name = writeComment(projectDir, {
          body: text,
          urgency: data.urgency === "urgent" ? "urgent" : "normal",
          paths,
          reviewId: typeof data.reviewId === "string" ? data.reviewId : null,
          base: typeof data.base === "string" ? data.base : null
        })
        message =
          name !== null ? `コメントを保存しました: ${name}` : null
      }
    }
    try {
      fs.rmSync(scratch, { force: true })
    } catch {
      // OS 一時ディレクトリ内なので残っても実害なし(設計書 §3.3)
    }
    draw()
  }

  process.stdout.write("\x1b[?1049h\x1b[?25l")
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on("keypress", (_str, key) => {
    switch (keyToAction(key ?? {})) {
      case "down":
        selected = moveSelection(selected, 1, state.review.length)
        message = null
        draw()
        break
      case "up":
        selected = moveSelection(selected, -1, state.review.length)
        message = null
        draw()
        break
      case "approve":
        approve()
        break
      case "comment":
        comment()
        break
      case "quit":
        quit(0)
        break
      default:
        break
    }
  })
  process.stdout.on("resize", draw)
  draw()
}
```

- [ ] **Step 2: main.ts を実装**

`plugins/pitcrew/src/tui/main.ts`:

```ts
// pitcrew watch のエントリポイント(設計書 §3.5)。TTY でなければ
// alt screen に入る前に終了する。引数は serve.ts の parseArgs と同型の
// --dir のみ(--port は不要)。

import path from "node:path"
import { runTui } from "./loop.js"

function parseArgs(argv: string[]): { dir: string } {
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1] !== undefined) {
      dir = path.resolve(argv[i + 1])
      i++
    }
  }
  return { dir }
}

const { dir } = parseArgs(process.argv.slice(2))

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("pitcrew watch は対話端末(TTY)が必要です")
  process.exit(1)
}

runTui(dir)
```

- [ ] **Step 3: build.ts にエントリを追加**

`plugins/pitcrew/build.ts` の `entryPoints` に 1 行追加:

```ts
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts",
    "capture-post-tool-use": "./src/hooks/capture-post-tool-use.ts",
    "inject-pre-tool-use": "./src/hooks/inject-pre-tool-use.ts",
    "inject-stop": "./src/hooks/inject-stop.ts",
    serve: "./src/server/serve.ts",
    watch: "./src/tui/main.ts"
  },
```

- [ ] **Step 4: ビルド・回帰・lint・typecheck**

Run: `pnpm build && pnpm test && pnpm lint && pnpm typecheck`
Expected: `plugins/pitcrew/scripts/watch.mjs` が生成される。既存+新規テスト全 PASS・エラーなし

- [ ] **Step 5: 非 TTY 起動の確認(バンドルが実行可能であることの検証)**

Run: `node plugins/pitcrew/scripts/watch.mjs --dir /tmp < /dev/null; echo "exit=$?"`
Expected: stderr に「pitcrew watch は対話端末(TTY)が必要です」、`exit=1`(パイプ経由の stdin は TTY でないため、この確認は Claude の Bash ツールで安全に実行できる。alt screen には入らない)

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/tui plugins/pitcrew/build.ts plugins/pitcrew/scripts
git commit -m "feat: pitcrew TUI ビューア(pitcrew watch)のイベントループとエントリを追加"
```

---

### Task 6: commands/watch.md・README・バージョン

**Files:**
- Create: `plugins/pitcrew/commands/watch.md`
- Modify: `plugins/pitcrew/README.md`
- Modify: `plugins/pitcrew/.claude-plugin/plugin.json`(version 0.9.4 → 0.10.0)

**Interfaces:**
- Consumes: Task 5 の `scripts/watch.mjs`
- Produces: ユーザー向けドキュメント(後続タスクなし)

- [ ] **Step 1: commands/watch.md を作成**

`plugins/pitcrew/commands/watch.md`:

```markdown
---
description: pitcrew のターミナル TUI ビューアの起動方法を案内する
---

pitcrew のターミナル TUI ビューア(`pitcrew watch`)の起動方法を案内してください。
**Claude 自身は起動・停止のいずれも行わないこと**(TUI はキー入力を伴う
対話型ツールのため、Claude の Bash ツールでは操作できない)。

## 手順

1. `${CLAUDE_PLUGIN_ROOT}` の絶対パスを解決する。コマンド本文中の
   `${CLAUDE_PLUGIN_ROOT}` はプラグインのルートに展開されるため、
   `echo "${CLAUDE_PLUGIN_ROOT}"` を Bash ツールで実行すれば得られる。
   プロジェクトルートは `pwd` で得る

2. 解決した絶対パスを埋め込んだ次のコマンドを提示する
   (`${...}` のままではなく、必ず展開済みの絶対パスで示すこと。
   ユーザーのターミナルではこの環境変数が定義されていないため):

   ```bash
   node "<CLAUDE_PLUGIN_ROOT の絶対パス>/scripts/watch.mjs" --dir "<プロジェクトルートの絶対パス>"
   ```

3. 併せて次を伝える:
   - 「このコマンドはあなたのターミナルで直接実行してください。TUI は
     キー入力を伴う対話型ツールのため、Claude はこの中では操作できません」
   - キー操作: `j`/`k` 移動・`c` コメント(`$EDITOR` で編集)・
     `a` 承認して既読・`q` 終了
   - コメント作成には環境変数 `$EDITOR` または `$VISUAL` の設定が必要

Claude はコマンドを Bash ツールで実行しないこと(`run_in_background` でも不可)。
```

- [ ] **Step 2: README に TUI ビューア節を追加し、古い記述を是正**

`plugins/pitcrew/README.md` で以下を行う。該当箇所は次で特定する:

Run: `grep -n "後続ステージ\|TUI" plugins/pitcrew/README.md`


1. 「TUI は後続ステージで追加予定」を含む冒頭の説明文から当該記述を削除し、ブラウザビューアと TUI ビューアの両方が使える旨に更新する
2. 設定表の `viewer` 行の「`browser` / `tui` は後続ステージで実装予定」を「いずれも実装済み(`viewer` の値は捕捉・注入の既定挙動の選択であり、どのビューアも常に起動できる)」に更新する
3. ブラウザビューア節の後に TUI ビューア節を追加する:

```markdown
## TUI ビューア(pitcrew watch)

ブラウザの代わりにターミナル上でレビューするビューアです。
**ユーザー自身のターミナルで直接実行します**(Claude には起動させない):

```bash
node "<プラグインの絶対パス>/scripts/watch.mjs" --dir "<プロジェクトルート>"
```

`/pitcrew:watch` で、自分の環境に合わせた起動コマンドを Claude に案内させられます。

| キー | 動作 |
|---|---|
| `j` / `k` | 選択の移動(下 / 上) |
| `c` | 選択項目へのコメント作成(`$EDITOR` / `$VISUAL` で編集) |
| `a` | 承認して既読(`reviewed/` へ移動) |
| `q` | 終了 |

- 一覧は `.pitcrew/review/`(未レビュー)のみを新しい順に表示します
- `.pitcrew/` の変更は自動で反映されます(ライブリロード)
- コメントの緊急度を上げたい場合は、エディタで開いたテンプレートの
  `urgency: normal` を `urgency: urgent` に書き換えてください
```

- [ ] **Step 3: plugin.json のバージョンを上げる**

`plugins/pitcrew/.claude-plugin/plugin.json` の `"version": "0.9.4"` を `"version": "0.10.0"` に変更する。

- [ ] **Step 4: 最終回帰**

Run: `pnpm build && pnpm test && pnpm lint && pnpm typecheck`
Expected: 全 PASS・生成物差分なし(あれば add する)

- [ ] **Step 5: コミット**

```bash
git add plugins/pitcrew
git commit -m "chore: pitcrew 0.10.0(TUI ビューア pitcrew watch・/pitcrew:watch 案内・README 更新)"
```

---

## 実機確認(実装完了後・自動テスト対象外)

設計書 §5.5 の項目。ユーザーのターミナルでの確認が必要:

- `pitcrew watch` の起動(alt screen への切り替え・終了後の画面復帰)
- `j`/`k` 移動・`a` 承認・`c` コメント作成(エディタ起動・保存・キャンセル)・`q` 終了
- 別プロセス(Claude Code セッション)による `.pitcrew/` 更新時のライブリロード(選択位置の維持を含む)
- 端末リサイズ時の再描画
