import { describe, expect, it } from "vitest"
import {
  allowsAgentTool,
  hasMixedKinds,
  ROLES,
  resolveTools,
  roleById,
  sortRoleIds
} from "../roles"

describe("ROLES", () => {
  it("役割 ID が 10 件あり、重複しない", () => {
    expect(ROLES).toHaveLength(10)
    expect(new Set(ROLES.map((role) => role.id)).size).toBe(10)
  })

  it("すべての役割が label と kind と tools を持つ", () => {
    for (const role of ROLES) {
      expect(role.label.length).toBeGreaterThan(0)
      expect(["impl", "readonly"]).toContain(role.kind)
      expect(role.tools.length).toBeGreaterThan(0)
    }
  })

  it("tools に MCP ツールを含まない", () => {
    for (const role of ROLES) {
      for (const tool of role.tools) {
        expect(tool.startsWith("mcp__")).toBe(false)
      }
    }
  })

  it("読み取り役割に Write / Edit を含まない", () => {
    for (const role of ROLES.filter((entry) => entry.kind === "readonly")) {
      expect(role.tools).not.toContain("Write")
      expect(role.tools).not.toContain("Edit")
    }
  })
})

describe("roleById", () => {
  it("既知の ID を引ける", () => {
    expect(roleById("complex-impl")?.label).toBe("複雑または重要な実装")
  })

  it("未知の ID では undefined を返す", () => {
    expect(roleById("no-such-role")).toBeUndefined()
  })
})

describe("sortRoleIds", () => {
  it("ROLES の定義順に並べ替える", () => {
    expect(sortRoleIds(["explore", "complex-impl", "light-impl"])).toEqual([
      "complex-impl",
      "light-impl",
      "explore"
    ])
  })
})

describe("resolveTools", () => {
  it("単一の読み取り役割では Write / Edit / Agent が付かない", () => {
    const tools = resolveTools(["independent-review"])
    expect(tools).toContain("Read")
    expect(tools).not.toContain("Write")
    expect(tools).not.toContain("Edit")
    expect(tools).not.toContain("Agent")
  })

  it("realtime-research だけが WebSearch / WebFetch を持ち込む", () => {
    expect(resolveTools(["realtime-research"])).toContain("WebSearch")
    expect(resolveTools(["explore"])).not.toContain("WebSearch")
  })

  it("複数役割で和集合になる", () => {
    const tools = resolveTools(["normal-impl", "realtime-research"])
    expect(tools).toContain("Write")
    expect(tools).toContain("WebSearch")
  })

  it("MCP ツールを 1 つも含まない", () => {
    const tools = resolveTools(["complex-impl", "explore", "realtime-research"])
    expect(tools.some((tool) => tool.startsWith("mcp__"))).toBe(false)
  })

  it("同じ役割集合なら順序が安定する", () => {
    expect(resolveTools(["explore", "normal-impl"])).toEqual(
      resolveTools(["normal-impl", "explore"])
    )
  })
})

describe("allowsAgentTool", () => {
  it("complex-impl / normal-impl / general のいずれかを含むと許可する", () => {
    expect(allowsAgentTool(["complex-impl"])).toBe(true)
    expect(allowsAgentTool(["normal-impl"])).toBe(true)
    expect(allowsAgentTool(["general"])).toBe(true)
  })

  it("light-impl のみでは許可しない", () => {
    expect(allowsAgentTool(["light-impl"])).toBe(false)
  })

  it("読み取り役割のみでは許可しない", () => {
    expect(allowsAgentTool(["explore", "independent-review"])).toBe(false)
  })

  it("light-impl と complex-impl の併用では許可する", () => {
    expect(allowsAgentTool(["light-impl", "complex-impl"])).toBe(true)
  })
})

describe("hasMixedKinds", () => {
  it("実装役割と読み取り役割の混在を検出する", () => {
    expect(hasMixedKinds(["normal-impl", "independent-review"])).toBe(true)
  })

  it("同じ種別だけなら false", () => {
    expect(hasMixedKinds(["normal-impl", "light-impl"])).toBe(false)
    expect(hasMixedKinds(["explore", "doc-review"])).toBe(false)
  })
})
