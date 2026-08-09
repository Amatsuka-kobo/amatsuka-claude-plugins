import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildSandboxSkillMd,
  createSandbox,
  makeCleanName,
  replaceDescription
} from "../lib/sandbox.js"

describe("buildSandboxSkillMd", () => {
  it("name を差し替える", () => {
    const md = [
      "---",
      "name: my-skill",
      "description: d",
      "---",
      "",
      "body"
    ].join("\n")
    const out = buildSandboxSkillMd(md, "my-skill-skill-abcd1234")
    expect(out).toContain("name: my-skill-skill-abcd1234")
    expect(out).not.toContain("name: my-skill\n")
  })

  it("disable-model-invocation が無ければ足す", () => {
    const md = ["---", "name: s", "description: d", "---", "", "body"].join(
      "\n"
    )
    const out = buildSandboxSkillMd(md, "s-skill-1")
    expect(out).toContain("disable-model-invocation: false")
    expect(out.match(/disable-model-invocation/g)).toHaveLength(1)
  })

  it("disable-model-invocation: true があれば置換し、二重に書かない", () => {
    const md = [
      "---",
      "name: s",
      "description: d",
      "disable-model-invocation: true",
      "---",
      "",
      "body"
    ].join("\n")
    const out = buildSandboxSkillMd(md, "s-skill-1")
    expect(out).toContain("disable-model-invocation: false")
    expect(out).not.toContain("disable-model-invocation: true")
    expect(out.match(/disable-model-invocation/g)).toHaveLength(1)
  })

  it("本文と他の frontmatter を触らない", () => {
    const md = [
      "---",
      "name: s",
      "description: d",
      "allowed-tools: Read",
      "---",
      "",
      "# body",
      "text"
    ].join("\n")
    const out = buildSandboxSkillMd(md, "s-skill-1")
    expect(out).toContain("allowed-tools: Read")
    expect(out).toContain("# body")
    expect(out).toContain("text")
  })
})

describe("replaceDescription", () => {
  // 値は JSON の文字列書式で書く。YAML のダブルクォート文字列は JSON と互換なので、
  // コロン・引用符・改行を含む description をそのまま安全に置ける。
  it("単一行の description を差し替える", () => {
    const md = [
      "---",
      "name: s",
      "description: old text",
      "---",
      "",
      "body"
    ].join("\n")
    const out = replaceDescription(md, "new text")
    expect(out).toContain('description: "new text"')
    expect(out).not.toContain("old text")
    expect(out).toContain("name: s")
    expect(out).toContain("body")
  })

  it("ブロックスカラーの description を単一行へ畳んで差し替える", () => {
    const md = [
      "---",
      "name: s",
      "description: |",
      "  line one",
      "  line two",
      "---",
      "",
      "body"
    ].join("\n")
    const out = replaceDescription(md, "new text")
    expect(out).toContain('description: "new text"')
    expect(out).not.toContain("line one")
    expect(out).not.toContain("line two")
    expect(out).toContain("body")
  })

  it("ブロックスカラー内の空行を越えて継続行を読み飛ばす", () => {
    const md = [
      "---",
      "name: s",
      "description: |",
      "  para one",
      "",
      "  para two",
      "other: kept",
      "---",
      "",
      "body"
    ].join("\n")
    const out = replaceDescription(md, "new text")
    expect(out).toContain('description: "new text"')
    expect(out).not.toContain("para one")
    expect(out).not.toContain("para two")
    expect(out).toContain("other: kept")
    expect(out).toContain("body")
  })

  it("コロンや引用符を含む description を壊さずに書く", () => {
    const md = ["---", "name: s", "description: old", "---", "", "body"].join(
      "\n"
    )
    const original = 'Use this: "always", even when unclear'
    const out = replaceDescription(md, original)
    const line = out.split("\n").find((l) => l.startsWith("description:"))
    expect(line).toBe(`description: ${JSON.stringify(original)}`)
    // 内側の引用符が escape され、YAML の 1 行として閉じている。
    expect(line).toBe(
      'description: "Use this: \\"always\\", even when unclear"'
    )
  })

  it("本文の description という語には触らない", () => {
    const md = [
      "---",
      "name: s",
      "description: old",
      "---",
      "",
      "description: not frontmatter"
    ].join("\n")
    const out = replaceDescription(md, "new")
    expect(out).toContain("description: not frontmatter")
  })
})

describe("makeCleanName", () => {
  it("<name>-skill-<8桁hex> を作る", () => {
    expect(makeCleanName("my-skill")).toMatch(/^my-skill-skill-[0-9a-f]{8}$/)
  })

  it("呼ぶたびに違う hash になる", () => {
    expect(makeCleanName("s")).not.toBe(makeCleanName("s"))
  })
})

describe("createSandbox", () => {
  it("SKILL.md を .claude/skills/<cleanName>/ に置く", async () => {
    const sandbox = await createSandbox(
      "---\nname: x\n---\n",
      "x-skill-0000ffff"
    )
    const path = join(
      sandbox.dir,
      ".claude",
      "skills",
      "x-skill-0000ffff",
      "SKILL.md"
    )
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf8")).toContain("name: x")
    await sandbox.cleanup()
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it("祖先に .claude を持たない場所に作る", async () => {
    const sandbox = await createSandbox(
      "---\nname: x\n---\n",
      "x-skill-0000ffff"
    )
    let current = join(sandbox.dir, "..")
    const seen: string[] = []
    for (let i = 0; i < 20; i++) {
      seen.push(join(current, ".claude"))
      const parent = join(current, "..")
      if (parent === current) break
      current = parent
    }
    expect(seen.filter((p) => existsSync(p))).toEqual([])
    await sandbox.cleanup()
  })
})
