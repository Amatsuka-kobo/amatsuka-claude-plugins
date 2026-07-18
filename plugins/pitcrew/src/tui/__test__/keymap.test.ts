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
