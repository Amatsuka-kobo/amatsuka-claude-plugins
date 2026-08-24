import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { compose } from "../compose"
import { DEFAULT_ALIASES, PRESETS } from "../presets"
import { PRESET_ASSIGNMENTS } from "../roles"

const PLUGIN_ROLES = fileURLToPath(
  new URL("../../../assets/roles/", import.meta.url)
)

describe("PRESETS", () => {
  it("4 種を定義する", () => {
    expect(PRESETS.map((preset) => preset.name)).toEqual([
      "gpt-sol",
      "gpt-terra",
      "gpt-luna",
      "grok"
    ])
  })

  it("既定エイリアスが仕様どおりである", () => {
    expect(DEFAULT_ALIASES["gpt-sol"]).toBe("claude-gpt-5-6-sol")
    expect(DEFAULT_ALIASES["gpt-terra"]).toBe("claude-gpt-5-6-terra")
    expect(DEFAULT_ALIASES["gpt-luna"]).toBe("claude-gpt-5-6-luna")
    expect(DEFAULT_ALIASES.grok).toBe("claude-grok-4-6")
  })

  it("PRESETS と DEFAULT_ALIASES が同じ値を指す", () => {
    for (const preset of PRESETS) {
      expect(preset.defaultAlias).toBe(DEFAULT_ALIASES[preset.name])
    }
  })

  it("プリセットごとの color を定義する", () => {
    expect(
      Object.fromEntries(PRESETS.map((preset) => [preset.name, preset.color]))
    ).toEqual({
      "gpt-sol": "yellow",
      "gpt-terra": "green",
      "gpt-luna": "cyan",
      grok: "red"
    })
  })
})

describe("担当表との一致", () => {
  it("各方針が割り当てた役割を、担当プリセットが漏れなく持つ", () => {
    const byName = new Map(PRESETS.map((preset) => [preset.name, preset]))
    const missing: string[] = []

    for (const [policy, assignments] of Object.entries(PRESET_ASSIGNMENTS)) {
      for (const [roleId, presetName] of Object.entries(assignments)) {
        const preset = byName.get(presetName)
        if (preset === undefined) {
          missing.push(`${policy}: unknown preset ${presetName}`)
          continue
        }
        if (!preset.roleIds.includes(roleId as never)) {
          missing.push(`${policy}: ${presetName} lacks ${roleId}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})

describe("合成結果", () => {
  it("すべてのプリセットが合成でき、MCP ツールを含まない", () => {
    for (const preset of PRESETS) {
      const document = compose({
        name: preset.name,
        model: preset.defaultAlias,
        vendor: preset.vendor,
        roleIds: preset.roleIds,
        fragmentDirs: [PLUGIN_ROLES],
        color: preset.color
      })
      expect(document).toContain(`name: ${preset.name}`)
      expect(document).toContain(`model: ${preset.defaultAlias}`)
      expect(document).toContain(`color: ${preset.color}`)
      expect(document).not.toContain("mcp__")
      expect(document).not.toContain("## ツール運用")
    }
  })

  it("grok が Agent を持つ(with-grok-policy の例外を満たす)", () => {
    const grok = PRESETS.find((preset) => preset.name === "grok")
    const document = compose({
      name: "grok",
      model: "m",
      vendor: "grok",
      roleIds: grok?.roleIds ?? [],
      fragmentDirs: [PLUGIN_ROLES]
    })
    expect(document).toMatch(/^tools:.*\bAgent\b/m)
  })

  it("gpt-luna が Agent を持たない", () => {
    const luna = PRESETS.find((preset) => preset.name === "gpt-luna")
    const document = compose({
      name: "gpt-luna",
      model: "m",
      vendor: "gpt",
      roleIds: luna?.roleIds ?? [],
      fragmentDirs: [PLUGIN_ROLES]
    })
    expect(document).not.toMatch(/^tools:.*\bAgent\b/m)
  })
})
