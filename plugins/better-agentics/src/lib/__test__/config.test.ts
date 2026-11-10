import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CONFIG_FILE,
  disabledRolesOf,
  readConfig,
  writeConfig
} from "../config"

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function put(content: string): void {
  const file = path.join(project, CONFIG_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

describe("readConfig", () => {
  it("ファイルが無ければ absent で、外す役割は無い", () => {
    const state = readConfig(project)
    expect(state).toEqual({ kind: "absent" })
    expect(disabledRolesOf(state)).toEqual([])
  })

  it("disabledRoles を並びのまま読む", () => {
    put('{"disabledRoles":["escalation","complex-review"]}')
    const state = readConfig(project)
    expect(state).toEqual({
      kind: "ok",
      config: { disabledRoles: ["escalation", "complex-review"] }
    })
    expect(disabledRolesOf(state)).toEqual(["escalation", "complex-review"])
  })

  it("空の配列は ok で、外す役割は無い", () => {
    put('{"disabledRoles":[]}')
    expect(readConfig(project)).toEqual({
      kind: "ok",
      config: { disabledRoles: [] }
    })
  })

  it.each([
    ["空ファイル", ""],
    ["配列", "[]"],
    ["文字列の disabledRoles", '{"disabledRoles":"escalation"}'],
    ["役割表に無い ID", '{"disabledRoles":["no-such-role"]}'],
    ["disabledRoles が無い", "{}"]
  ])("%s は invalid で、中身と理由を持つ", (_label, content) => {
    put(content)
    const state = readConfig(project)
    expect(state.kind).toBe("invalid")
    if (state.kind !== "invalid") return
    expect(state.raw).toBe(content)
    expect(state.message).not.toBe("")
    expect(disabledRolesOf(state)).toEqual([])
  })

  it("読めないときは invalid で、raw は null", () => {
    fs.mkdirSync(path.join(project, CONFIG_FILE), { recursive: true })
    const state = readConfig(project)
    expect(state.kind).toBe("invalid")
    if (state.kind !== "invalid") return
    expect(state.raw).toBeNull()
  })
})

describe("writeConfig", () => {
  it("ディレクトリを作り、2 空白の字下げと末尾の改行で書く", () => {
    const target = writeConfig(project, {
      disabledRoles: ["escalation", "complex-review"]
    })
    expect(target).toBe(".claude/better-agentics/config.json")
    expect(fs.readFileSync(path.join(project, target), "utf8")).toBe(
      `${JSON.stringify({ disabledRoles: ["escalation", "complex-review"] }, null, 2)}\n`
    )
    expect(readConfig(project).kind).toBe("ok")
  })

  it("役割表に無い ID は例外を投げ、ファイルを書かない", () => {
    expect(() =>
      writeConfig(project, {
        // biome-ignore lint/suspicious/noExplicitAny: 型の外の値を渡す
        disabledRoles: ["no-such-role" as any]
      })
    ).toThrow(/no-such-role/)
    expect(fs.existsSync(path.join(project, CONFIG_FILE))).toBe(false)
  })
})
