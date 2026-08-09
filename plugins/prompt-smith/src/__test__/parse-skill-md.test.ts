import { describe, expect, it } from "vitest"
import { parseSkillMd } from "../lib/parse-skill-md.js"

describe("parseSkillMd", () => {
  it("単一行の name と description を取り出す", () => {
    const md = ["---", "name: my-skill", "description: does a thing", "---", "", "body"].join("\n")
    const parsed = parseSkillMd(md)
    expect(parsed.name).toBe("my-skill")
    expect(parsed.description).toBe("does a thing")
    expect(parsed.content).toBe(md)
  })

  it("引用符を剥がす", () => {
    const md = ["---", 'name: "my-skill"', "description: 'does a thing'", "---", ""].join("\n")
    const parsed = parseSkillMd(md)
    expect(parsed.name).toBe("my-skill")
    expect(parsed.description).toBe("does a thing")
  })

  it.each([">", "|", ">-", "|-"])("ブロックスカラー %s の継続行を連結する", (indicator) => {
    const md = [
      "---",
      "name: my-skill",
      `description: ${indicator}`,
      "  first line",
      "  second line",
      "---",
      "",
    ].join("\n")
    expect(parseSkillMd(md).description).toBe("first line second line")
  })

  it("タブ字下げの継続行も連結する", () => {
    const md = ["---", "name: s", "description: |", "\tfirst", "\tsecond", "---", ""].join("\n")
    expect(parseSkillMd(md).description).toBe("first second")
  })

  it("開始の --- が無いとき例外を投げる", () => {
    expect(() => parseSkillMd("name: x\n")).toThrow(/no opening/)
  })

  it("終了の --- が無いとき例外を投げる", () => {
    expect(() => parseSkillMd("---\nname: x\n")).toThrow(/no closing/)
  })
})
