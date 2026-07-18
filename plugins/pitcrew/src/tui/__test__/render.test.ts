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
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

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
    const listLines = lines.filter(
      (l) => !l.startsWith("id:") && /00[4-9]/.test(l)
    )
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
      expect(line.replace(ANSI_SGR, "").length).toBeLessThanOrEqual(40)
    }
  })
})
