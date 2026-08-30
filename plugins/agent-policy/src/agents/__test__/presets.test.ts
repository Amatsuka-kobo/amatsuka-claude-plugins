import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { compose } from "../compose"
import type { FragmentDir } from "../fragments"
import { MODELS, rolesAcrossPolicies } from "../policies"
import { DEFAULT_ALIASES, PRESETS } from "../presets"

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const PLUGIN_ROLES: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "ja"),
  source: "plugin"
}

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

describe("担当表からの導出", () => {
  it("各プリセットの役割が全方針の和集合と一致する", () => {
    for (const preset of PRESETS) {
      expect(preset.roleIds, preset.name).toEqual(
        rolesAcrossPolicies(preset.name as never)
      )
    }
  })

  it("PRESETS が MODELS の非 Claude 帯から導かれている", () => {
    const derived = MODELS.filter((model) => model.vendor !== "claude").map(
      (model) => ({
        modelId: model.id,
        name: model.defaultName,
        vendor: model.vendor,
        defaultAlias: model.model,
        color: model.color
      })
    )
    expect(
      PRESETS.map(({ modelId, name, vendor, defaultAlias, color }) => ({
        modelId,
        name,
        vendor,
        defaultAlias,
        color
      }))
    ).toEqual(derived)
  })

  it("Claude 帯は同梱プリセットに含まれない", () => {
    for (const preset of PRESETS) {
      expect(preset.vendor, preset.name).not.toBe("claude")
    }
  })
})

describe("合成結果", () => {
  it("すべてのプリセットが合成でき、MCP ツールを含まない", () => {
    for (const preset of PRESETS) {
      const document = compose({
        name: preset.name,
        model: preset.defaultAlias,
        vendor: preset.vendor,
        modelId: preset.modelId,
        roleIds: preset.roleIds,
        fragmentDirs: [PLUGIN_ROLES],
        lang: "ja",
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
      modelId: grok?.modelId ?? "grok",
      roleIds: grok?.roleIds ?? [],
      fragmentDirs: [PLUGIN_ROLES],
      lang: "ja"
    })
    expect(document).toMatch(/^tools:.*\bAgent\b/m)
  })

  it("gpt-luna が Agent を持たない", () => {
    const luna = PRESETS.find((preset) => preset.name === "gpt-luna")
    const document = compose({
      name: "gpt-luna",
      model: "m",
      vendor: "gpt",
      modelId: luna?.modelId ?? "gpt-luna",
      roleIds: luna?.roleIds ?? [],
      fragmentDirs: [PLUGIN_ROLES],
      lang: "ja"
    })
    expect(document).not.toMatch(/^tools:.*\bAgent\b/m)
  })

  it("同梱プリセット 4 つの Agent 有無が不変である", () => {
    const expected = {
      "gpt-sol": true,
      "gpt-terra": true,
      "gpt-luna": false,
      grok: true
    } as const

    for (const preset of PRESETS) {
      const document = compose({
        name: preset.name,
        model: preset.defaultAlias,
        vendor: preset.vendor,
        modelId: preset.modelId,
        roleIds: preset.roleIds,
        fragmentDirs: [PLUGIN_ROLES],
        lang: "ja",
        color: preset.color
      })
      const tools = document.match(/^tools: (.*)$/m)?.[1]?.split(", ") ?? []
      expect(tools.includes("Agent"), preset.name).toBe(
        expected[preset.name as keyof typeof expected]
      )
    }
  })
})
