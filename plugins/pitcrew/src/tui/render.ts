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
    lines.push(truncate("[j/k]移動 [c]コメント [a]承認して既読 [q]終了", cols))
  }
  return lines
}
