import { describe, expect, it } from "vitest"
import {
  hasMixedKinds,
  ROLES,
  roleById,
  roleOrder,
  sortRoleIds
} from "../roles"

describe("ROLES", () => {
  it("役割 ID が 17 件あり、定義順で重複しない", () => {
    expect(ROLES.map((role) => role.id)).toEqual([
      "complex-impl",
      "normal-impl",
      "light-impl",
      "escalation",
      "general",
      "design-plan",
      "doc-writing",
      "explore-lead",
      "explore",
      "realtime-research",
      "e2e-verify",
      "independent-review",
      "doc-review",
      "code-review",
      "final-review",
      "gate-review",
      "advisor"
    ])
    expect(new Set(ROLES.map((role) => role.id)).size).toBe(17)
  })

  it("文書作成役割の label・kind・tools が固定値と一致する", () => {
    expect(ROLES.find((role) => role.id === "doc-writing")).toEqual({
      id: "doc-writing",
      label: "文書作成",
      kind: "impl",
      tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
    })
  })

  it("追加した 2 役割の label・kind・tools が固定値と一致する", () => {
    expect(
      ROLES.filter((role) => ["design-plan", "explore-lead"].includes(role.id))
    ).toEqual([
      {
        id: "design-plan",
        label: "設計書・実装計画書(WBS)の作成",
        kind: "impl",
        tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
      },
      {
        id: "explore-lead",
        label: "コードベース探索統括",
        kind: "impl",
        tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
      }
    ])
  })

  it("追加した 4 役割の label・kind・tools が固定値と一致する", () => {
    expect(
      ROLES.filter((role) =>
        ["escalation", "final-review", "e2e-verify", "gate-review"].includes(
          role.id
        )
      )
    ).toEqual([
      {
        id: "escalation",
        label: "行き詰まり時のエスカレーション",
        kind: "impl",
        tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
      },
      {
        id: "e2e-verify",
        label: "E2E 動作検証・ブラウザ/GUI 操作",
        kind: "readonly",
        tools: ["Read", "Grep", "Glob", "Bash"]
      },
      {
        id: "final-review",
        label: "重要な実装の最終レビュー",
        kind: "readonly",
        tools: ["Read", "Grep", "Glob", "Bash"]
      },
      {
        id: "gate-review",
        label: "設計書の最終ゲートレビュー",
        kind: "readonly",
        tools: ["Read", "Grep", "Glob"]
      }
    ])
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

  it("どの役割も LSP を持たない(背景サブエージェントで除去されるため)", () => {
    for (const role of ROLES) {
      expect(role.tools, role.id).not.toContain("LSP")
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

describe("roleOrder", () => {
  it("組み込み役割には ROLES の添字を返す", () => {
    expect(roleOrder("complex-impl")).toBe(0)
    expect(roleOrder("advisor")).toBe(ROLES.length - 1)
  })

  it("未知の ID には ROLES.length を返す", () => {
    expect(roleOrder("project-role")).toBe(ROLES.length)
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

  it("未知の ID を末尾へ ID 順で並べる", () => {
    expect(
      sortRoleIds(["z-project", "explore", "a-project", "complex-impl"])
    ).toEqual(["complex-impl", "explore", "a-project", "z-project"])
  })
})

describe("hasMixedKinds", () => {
  it("実装種別と読み取り種別の混在を検出する", () => {
    expect(hasMixedKinds(["impl", "readonly"])).toBe(true)
  })

  it("同じ種別だけなら false", () => {
    expect(hasMixedKinds(["impl", "impl"])).toBe(false)
    expect(hasMixedKinds(["readonly", "readonly"])).toBe(false)
  })
})
