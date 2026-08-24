import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildPresets } from "../build-presets"

const PLUGIN_ROLES = fileURLToPath(
  new URL("../../../assets/roles/", import.meta.url)
)

let pluginRoot: string

beforeEach(() => {
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-presets-"))
  fs.mkdirSync(path.join(pluginRoot, "assets"), { recursive: true })
  fs.cpSync(PLUGIN_ROLES, path.join(pluginRoot, "assets", "roles"), {
    recursive: true
  })
})

afterEach(() => {
  fs.rmSync(pluginRoot, { recursive: true, force: true })
})

describe("buildPresets", () => {
  it("生成対象外の .md だけを削除する", () => {
    const agents = path.join(pluginRoot, "agents")
    fs.mkdirSync(agents, { recursive: true })
    fs.writeFileSync(path.join(agents, "stale.md"), "stale\n")
    fs.writeFileSync(path.join(agents, "keep.txt"), "keep\n")

    buildPresets(pluginRoot)

    expect(fs.existsSync(path.join(agents, "stale.md"))).toBe(false)
    expect(fs.readFileSync(path.join(agents, "keep.txt"), "utf8")).toBe(
      "keep\n"
    )
  })

  it("生成対象外の .md ディレクトリは削除しない", () => {
    const agents = path.join(pluginRoot, "agents")
    const staleDir = path.join(agents, "stale-dir.md")
    fs.mkdirSync(staleDir, { recursive: true })

    expect(() => buildPresets(pluginRoot)).not.toThrow()
    expect(fs.statSync(staleDir).isDirectory()).toBe(true)
  })

  it("プリセット固有の color で生成する", () => {
    buildPresets(pluginRoot)

    expect(colorOf("gpt-terra")).toBe("green")
    expect(colorOf("gpt-luna")).toBe("cyan")
    expect(colorOf("grok")).toBe("red")
  })
})

function colorOf(name: string): string | undefined {
  const content = fs.readFileSync(
    path.join(pluginRoot, "agents", `${name}.md`),
    "utf8"
  )
  return content.match(/^color: (.+)$/m)?.[1]
}
