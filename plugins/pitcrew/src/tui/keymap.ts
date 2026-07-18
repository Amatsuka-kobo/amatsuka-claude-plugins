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
