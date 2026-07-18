import { describe, expect, it, vi } from "vitest"
import { openInEditor, resolveEditor } from "../editor.js"

describe("resolveEditor", () => {
  it("VISUAL を EDITOR より優先する", () => {
    expect(resolveEditor({ VISUAL: "code --wait", EDITOR: "vim" })).toEqual({
      cmd: "code",
      args: ["--wait"]
    })
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
