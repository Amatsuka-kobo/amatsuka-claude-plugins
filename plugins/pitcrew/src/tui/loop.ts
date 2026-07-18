// TUI のイベントループ(設計書 §3.2〜§3.5)。raw mode・alt screen の管理、
// キー入力と watchPitcrew の 2 イベントソースの合流、後始末の一本化を担う。
// Node のシングルスレッドイベントループ上で各ハンドラは順番に完走するため
// 排他制御は不要(設計書 §3.4)。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.js"
import { listState, type PitcrewState, readItemBody } from "../lib/state.js"
import { approveItem, writeComment } from "../lib/viewer-ops.js"
import { watchPitcrew } from "../lib/watch.js"
import { openInEditor, resolveEditor } from "./editor.js"
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
  let stopWatch = (): void => {}

  const draw = (): void => {
    const item = state.review[selected]
    const body =
      item !== undefined ? readItemBody(projectDir, "review", item.name) : null
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

  stopWatch = watchPitcrew(projectDir, reload)

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
    if (resolveEditor(process.env) === null) {
      message = "$EDITOR または $VISUAL を設定してください"
      draw()
      return
    }

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
        message = name !== null ? `コメントを保存しました: ${name}` : null
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
