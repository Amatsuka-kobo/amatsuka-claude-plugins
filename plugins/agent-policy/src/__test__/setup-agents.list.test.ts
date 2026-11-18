import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ASSIGNMENTS, candidateScopeFor } from "../agents/policies"
import { ROLES } from "../agents/roles"
import type { FakeModelsServer } from "../testing/fake-models-server"
import {
  type CoverageResult,
  coverage,
  definitionOf,
  type FragmentStatusResult,
  type ListRolesResult,
  type LiveModelsResult,
  project,
  run,
  runAsync,
  startModelsServer,
  type WriteResults,
  writeAgent,
  writeProjectRole
} from "./helpers/setup-agents-fixtures"

describe("廃止フラグ", () => {
  it.each([
    [["--policy", "custom-policy"], "--policy"],
    [["--list-policies"], "--list-policies"],
    [["--list-models"], "--list-models"],
    [["--models", "sonnet"], "--models"]
  ])("%s を廃止済みとして拒否する", (args, flag) => {
    const result = run<{ ok: boolean; error: string }>(args)

    expect(result.ok).toBe(false)
    expect(result.error).toContain(flag)
    expect(result.error).toMatch(/removed|廃止/i)
  })
})

describe("--scope", () => {
  it.each(["claude", "custom"] as const)("--scope %s を受理する", (scope) => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--scope",
      scope,
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
  })

  it("claude と custom 以外を拒否する", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--scope",
      "external",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe("scope: must be claude or custom")
  })

  it.each([
    ["未設定", [undefined], "claude-only"],
    ["none", ["none"], "claude-only"],
    ["claude", ["claude"], "claude-only"],
    ["custom", ["custom"], "with-external"],
    [
      "旧 3 値",
      ["with-codex", "with-grok", "with-codex-grok"],
      "with-external"
    ],
    ["CuStOm", ["CuStOm"], "with-external"]
  ] as const)("環境変数が %s のとき candidateScopeFor と同じ既定を使う", (_label, values, expected) => {
    for (const value of values) {
      const env =
        value === undefined ? {} : { AMATSUKA_AGENT_AUTO_INJECTION: value }
      const result = run<WriteResults>(
        [
          "--check",
          "--model-id",
          "gpt-sol",
          "--name",
          "gpt-sol-default-scope",
          "--roles",
          "complex-impl",
          "--dir",
          project
        ],
        env
      )

      expect(candidateScopeFor(value) ?? "claude-only").toBe(expected)
      expect(result.ok).toBe(expected === "with-external")
      if (expected === "claude-only") {
        expect(result.error).toBe(
          "model-id: gpt-sol is not available with --scope claude"
        )
      }
    }
  })

  it("--recommended --scope claude は Claude モデルだけを役割ごとに使う", () => {
    const result = run<WriteResults>([
      "--check",
      "--recommended",
      "--scope",
      "claude",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(13)
    expect(result.results.map((entry) => entry.modelId)).toEqual(
      ROLES.map((role) => ASSIGNMENTS["claude-model-policy"][role.id][0])
    )
  })

  it("--scope claude では外部 model-id を拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--scope",
      "claude",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe(
      "model-id: gpt-sol is not available with --scope claude"
    )
  })

  it("--scope claude では Claude enum でない個別 --model を拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--scope",
      "claude",
      "--model-id",
      "sonnet",
      "--model",
      "claude-gpt-6-1-sol",
      "--name",
      "external-model",
      "--roles",
      "normal-impl",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe(
      "model: claude-gpt-6-1-sol is not available with --scope claude"
    )
  })

  it("--scope claude の通常 write 経路では live models を照会しない", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "unexpected-live-model", owned_by: "other" }]
      })
    })

    const result = await runAsync<WriteResults>(
      [
        "--write",
        "--scope",
        "claude",
        "--model-id",
        "sonnet",
        "--name",
        "claude-sonnet-no-query",
        "--roles",
        "normal-impl",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(true)
    expect(proxy.requests).toHaveLength(0)
  })
})

describe("--list-live-models", () => {
  it("live models と Claude enum を推奨役割付きで返す", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [
          { id: "claude-gpt-6-1-sol", owned_by: "openai" },
          { id: "claude-gpt-6-astra", owned_by: "openai" },
          { id: "custom-unknown", owned_by: "other" }
        ]
      })
    })

    const result = await runAsync<LiveModelsResult>(
      ["--list-live-models", "--scope", "custom"],
      {
        ANTHROPIC_BASE_URL: proxy.baseUrl
      }
    )

    expect(result).toEqual({
      ok: true,
      models: [
        {
          id: "claude-gpt-6-1-sol",
          vendor: "gpt",
          recommendedFor: [
            "complex-impl",
            "normal-impl",
            "general",
            "explore",
            "e2e-verify",
            "design-review",
            "code-review",
            "adversarial-review"
          ]
        },
        {
          id: "claude-gpt-6-astra",
          vendor: "gpt",
          recommendedFor: ["escalation", "complex-review"]
        },
        { id: "custom-unknown", vendor: "unknown", recommendedFor: [] }
      ],
      claudeEnums: ["sonnet", "opus", "haiku", "fable"]
    })
  })

  it("--scope claude ではプロキシを照会せず Claude enum だけを返す", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "unexpected-live-model", owned_by: "other" }]
      })
    })

    const result = await runAsync<LiveModelsResult>(
      ["--list-live-models", "--scope", "claude"],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result).toEqual({
      ok: true,
      models: [],
      claudeEnums: ["sonnet", "opus", "haiku", "fable"]
    })
    expect(proxy.requests).toHaveLength(0)
  })

  it("照会失敗時も reason と Claude enum を返す", async () => {
    const proxy = await startModelsServer({ status: 503 })

    const result = await runAsync<LiveModelsResult>(
      ["--list-live-models", "--scope", "custom"],
      {
        ANTHROPIC_BASE_URL: proxy.baseUrl
      }
    )

    expect(result).toEqual({
      ok: false,
      reason: "http-503",
      models: [],
      claudeEnums: ["sonnet", "opus", "haiku", "fable"]
    })
  })
})

describe("--list-coverage", () => {
  it(".claude/agents が無いとき全役割を uncovered にする", () => {
    fs.rmSync(path.join(project, ".claude", "agents"), {
      recursive: true,
      force: true
    })

    const result = run<CoverageResult>([
      "--list-coverage",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.roles).toHaveLength(13)
    expect(result.uncovered).toEqual(result.roles.map((role) => role.id))
    expect(result.roles.every((role) => role.coveredBy.length === 0)).toBe(true)
  })

  it("複数の役割マーカーを定義名で coveredBy に反映する", () => {
    fs.writeFileSync(
      path.join(project, ".claude", "agents", "custom-agent.md"),
      [
        "---",
        "name: shared-researcher",
        "agent-policy-role: explore, realtime-research",
        "---",
        ""
      ].join("\n")
    )

    const result = run<CoverageResult>([
      "--list-coverage",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(
      result.roles.find((role) => role.id === "explore")?.coveredBy
    ).toEqual(["shared-researcher"])
    expect(
      result.roles.find((role) => role.id === "realtime-research")?.coveredBy
    ).toEqual(["shared-researcher"])
    expect(result.uncovered).not.toContain("explore")
    expect(result.uncovered).not.toContain("realtime-research")
  })

  it("複数モデルの役割と各役割の defaultName を返す", () => {
    const result = run<CoverageResult>([
      "--list-coverage",
      "--scope",
      "custom",
      "--lang",
      "en",
      "--dir",
      project
    ])

    expect(
      result.roles.find((role) => role.id === "complex-review")?.models
    ).toEqual(["gpt-astra", "fable"])
    expect(
      result.roles.every(
        (role) =>
          typeof role.defaultName === "string" && role.defaultName !== ""
      )
    ).toBe(true)
  })

  it("RECOMMENDED の役割集合とモデル割当を返す", () => {
    const result = run<CoverageResult>([
      "--list-coverage",
      "--scope",
      "custom",
      "--dir",
      project
    ])

    expect(result.roles).toHaveLength(13)
    expect(
      result.roles.find((role) => role.id === "complex-impl")?.models
    ).toEqual(["gpt-sol", "opus"])
    expect(
      result.roles.find((role) => role.id === "escalation")?.models
    ).toEqual(["gpt-astra", "fable"])
    expect(
      result.roles.find((role) => role.id === "complex-review")?.models
    ).toEqual(["gpt-astra", "fable"])
  })

  it("--scope claude では外部ベンダーの既存定義を被覆に数えない", () => {
    fs.writeFileSync(
      path.join(project, ".claude", "agents", "external-complex.md"),
      [
        "---",
        "name: external-complex",
        "model: claude-gpt-6-1-sol",
        "agent-policy-vendor: gpt",
        "agent-policy-role: complex-impl",
        "---",
        ""
      ].join("\n")
    )

    const custom = run<CoverageResult>([
      "--list-coverage",
      "--scope",
      "custom",
      "--dir",
      project
    ])
    const claude = run<CoverageResult>([
      "--list-coverage",
      "--scope",
      "claude",
      "--dir",
      project
    ])

    expect(
      custom.roles.find((role) => role.id === "complex-impl")?.coveredBy
    ).toEqual(["external-complex"])
    expect(
      claude.roles.find((role) => role.id === "complex-impl")?.coveredBy
    ).toEqual([])
    expect(claude.uncovered).toContain("complex-impl")
  })

  it("--scope claude では ASSIGNMENTS 由来の推奨を返す", () => {
    const result = run<CoverageResult>([
      "--list-coverage",
      "--scope",
      "claude",
      "--dir",
      project
    ])

    expect(
      result.roles.find((role) => role.id === "complex-impl")?.models
    ).toEqual(["opus"])
    expect(
      result.roles.find((role) => role.id === "escalation")?.models
    ).toEqual(["fable"])
    expect(
      result.roles.find((role) => role.id === "complex-review")?.models
    ).toEqual(["fable"])
    expect(result.roles.every((role) => role.models.length === 1)).toBe(true)
  })

  // default-name を持たない世代の翻訳断片は bodyHash が frontmatter を
  // 除外するため stale にならず、再 scaffold も促されない。同梱英語断片から
  // 補わないと、既定名が <model-id>-undefined になってしまう。
  it("翻訳断片に default-name が無くても同梱英語断片から補う", () => {
    run<FragmentStatusResult>([
      "--scaffold-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    const roles = path.join(project, ".claude", "agent-policy", "roles", "de")
    for (const file of fs.readdirSync(roles)) {
      const target = path.join(roles, file)
      fs.writeFileSync(
        target,
        fs
          .readFileSync(target, "utf8")
          .split("\n")
          .filter((line) => !line.startsWith("default-name:"))
          .join("\n")
      )
    }

    const result = run<CoverageResult>([
      "--list-coverage",
      "--lang",
      "de",
      "--dir",
      project
    ])

    expect(
      result.roles.find((role) => role.id === "complex-review")?.defaultName
    ).toBe("complex-reviewer")
    expect(
      result.roles.every(
        (role) =>
          typeof role.defaultName === "string" && role.defaultName !== ""
      )
    ).toBe(true)
  })
})

describe("--list-coverage の candidates", () => {
  type CandidatesResult = CoverageResult

  function candidatesOf(result: CandidatesResult, role: string) {
    return result.roles
      .find((entry) => entry.id === role)
      ?.candidates.map((candidate) =>
        candidate.recommended ? `${candidate.modelId}*` : candidate.modelId
      )
  }

  it("--scope claude は Claude の 4 値で、推奨を先頭に並べ、live を照会しない", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({ data: [{ id: "claude-grok-4-7" }] })
    })

    const result = await runAsync<CandidatesResult>(
      ["--list-coverage", "--scope", "claude", "--dir", project],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.liveOk).toBe(true)
    expect(proxy.requests).toHaveLength(0)
    expect(candidatesOf(result, "complex-impl")).toEqual([
      "opus*",
      "sonnet",
      "haiku",
      "fable"
    ])
    expect(
      result.roles
        .find((entry) => entry.id === "complex-impl")
        ?.candidates.find((candidate) => candidate.modelId === "opus")?.model
    ).toBe("opus")
  })

  it("custom で live が取れたら、live にある推奨と Claude の 4 値を返し、推奨に無いモデルは入れない", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [
          { id: "claude-gpt-6-1-sol", owned_by: "openai" },
          { id: "claude-grok-4-7", owned_by: "xai" }
        ]
      })
    })

    const result = await runAsync<CandidatesResult>(
      ["--list-coverage", "--scope", "custom", "--dir", project],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.liveOk).toBe(true)
    expect(candidatesOf(result, "e2e-verify")).toEqual([
      "gpt-sol*",
      "sonnet*",
      "opus",
      "haiku",
      "fable"
    ])
    expect(candidatesOf(result, "complex-impl")).toEqual([
      "gpt-sol*",
      "opus*",
      "sonnet",
      "haiku",
      "fable"
    ])
  })

  it("custom で live に無い推奨の外部モデルは候補から外す", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "claude-gpt-6-1-sol", owned_by: "openai" }]
      })
    })

    const result = await runAsync<CandidatesResult>(
      ["--list-coverage", "--scope", "custom", "--dir", project],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(candidatesOf(result, "complex-impl")).toEqual([
      "gpt-sol*",
      "opus*",
      "sonnet",
      "haiku",
      "fable"
    ])
  })

  it("custom で live が取れなければ liveOk: false とし、推奨すべてと Claude の 4 値を返す", () => {
    const result = run<CandidatesResult>([
      "--list-coverage",
      "--scope",
      "custom",
      "--dir",
      project
    ])

    expect(result.liveOk).toBe(false)
    expect(candidatesOf(result, "e2e-verify")).toEqual([
      "gpt-sol*",
      "sonnet*",
      "opus",
      "haiku",
      "fable"
    ])
    expect(candidatesOf(result, "complex-impl")).toEqual([
      "gpt-sol*",
      "opus*",
      "sonnet",
      "haiku",
      "fable"
    ])
  })
})

describe("エイリアスの部分一致", () => {
  const RENAMED = [
    { id: "claude-gpt-6.1-sol-pro", owned_by: "other" },
    { id: "claude-gpt6-sol", owned_by: "other" },
    { id: "claude-grok5", owned_by: "other" }
  ]

  async function renamedProxy(): Promise<FakeModelsServer> {
    return startModelsServer({ body: JSON.stringify({ data: RENAMED }) })
  }

  it("--list-live-models は既定と違うエイリアスにも vendor と推奨役割を付ける", async () => {
    const proxy = await renamedProxy()

    const result = await runAsync<LiveModelsResult>(
      ["--list-live-models", "--scope", "custom"],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(
      result.models.map((model) => [
        model.id,
        model.vendor,
        model.recommendedFor.includes("complex-impl")
      ])
    ).toEqual([
      ["claude-gpt-6.1-sol-pro", "gpt", true],
      ["claude-gpt6-sol", "gpt", true],
      ["claude-grok5", "grok", false]
    ])
  })

  it("candidates は当たったエイリアスを別々の要素で返し、推奨の印を 1 つだけ付ける", async () => {
    const proxy = await renamedProxy()

    const result = await runAsync<CoverageResult>(
      ["--list-coverage", "--scope", "custom", "--dir", project],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(
      result.roles.find((role) => role.id === "complex-impl")?.candidates
    ).toEqual([
      { modelId: "gpt-sol", model: "claude-gpt6-sol", recommended: true },
      { modelId: "opus", model: "opus", recommended: true },
      {
        modelId: "gpt-sol",
        model: "claude-gpt-6.1-sol-pro",
        recommended: false
      },
      { modelId: "sonnet", model: "sonnet", recommended: false },
      { modelId: "haiku", model: "haiku", recommended: false },
      { modelId: "fable", model: "fable", recommended: false }
    ])
  })

  it("definitions の modelId を既定と違うエイリアスからも逆引きする", () => {
    writeAgent("renamed.md", [
      "---",
      "name: renamed",
      "model: claude-gpt-6.1-sol",
      "agent-policy-vendor: gpt",
      "agent-policy-role: explore",
      "---",
      ""
    ])

    expect(definitionOf(coverage(), "renamed")?.modelId).toBe("gpt-sol")
  })

  it("--recommended は live にある推奨のエイリアスを model にし、選ばなかったエイリアスを warnings に載せる", async () => {
    const proxy = await renamedProxy()

    const result = await runAsync<WriteResults>(
      [
        "--write",
        "--recommended",
        "--scope",
        "custom",
        "--roles",
        "complex-impl",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(true)
    expect(result.results[0]?.modelId).toBe("gpt-sol")
    const content = fs.readFileSync(
      path.join(project, result.results[0]?.target ?? ""),
      "utf8"
    )
    expect(content).toMatch(/^model: claude-gpt6-sol$/m)
    expect(content).toMatch(/^agent-policy-vendor: gpt$/m)
    expect(
      result.warnings.some(
        (warning) =>
          warning.includes("claude-gpt6-sol") &&
          warning.includes("claude-gpt-6.1-sol-pro")
      )
    ).toBe(true)
  })

  it("--model-id だけを渡すと live にあるエイリアスを model の既定値にし、vendor を判定で補う", async () => {
    const proxy = await renamedProxy()

    const result = await runAsync<WriteResults>(
      [
        "--write",
        "--model-id",
        "grok",
        "--name",
        "grok-explorer",
        "--roles",
        "realtime-research",
        "--scope",
        "custom",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(true)
    const content = fs.readFileSync(
      path.join(project, ".claude", "agents", "grok-explorer.md"),
      "utf8"
    )
    expect(content).toMatch(/^model: claude-grok5$/m)
    expect(content).toMatch(/^agent-policy-vendor: grok$/m)
  })

  it("--recommended は live にある既定外エイリアスの被覆定義を再生成し、live に無いものは同じモデルのエイリアスを添えて warnings に載せる", async () => {
    const proxy = await renamedProxy()
    writeAgent("present.md", [
      "---",
      "name: present",
      "model: claude-gpt-6.1-sol-pro",
      "agent-policy-vendor: gpt",
      "agent-policy-role: complex-impl",
      "---",
      ""
    ])
    writeAgent("absent.md", [
      "---",
      "name: absent",
      "model: claude-gpt-6-1-sol",
      "agent-policy-vendor: gpt",
      "agent-policy-role: code-review",
      "---",
      ""
    ])

    const result = await runAsync<WriteResults>(
      [
        "--check",
        "--recommended",
        "--scope",
        "custom",
        "--roles",
        "complex-impl,code-review",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(true)
    expect(result.results.map((entry) => entry.target)).toEqual([
      ".claude/agents/present.md"
    ])
    expect(
      result.warnings.some(
        (warning) =>
          warning.includes("absent") && warning.includes("claude-gpt6-sol")
      )
    ).toBe(true)
  })
})

describe("--list-coverage の点検結果", () => {
  it("modelBreakdown はマーカー付き定義を Claude で動くものと外部ベンダーに分けて数える", () => {
    const marker = "agent-policy-role: explore"
    writeAgent("enum.md", [
      "---",
      "name: enum",
      "model: opus",
      marker,
      "---",
      ""
    ])
    writeAgent("inherit.md", [
      "---",
      "name: inherit",
      "model: inherit",
      marker,
      "---",
      ""
    ])
    writeAgent("undeclared.md", ["---", "name: undeclared", marker, "---", ""])
    writeAgent("external.md", [
      "---",
      "name: external",
      "model: claude-gpt-6-1-sol",
      "agent-policy-vendor: gpt",
      marker,
      "---",
      ""
    ])
    writeAgent("plain.md", [
      "---",
      "name: plain",
      "model: claude-gpt-6-1-sol",
      "---",
      ""
    ])

    for (const scope of ["claude", "custom"]) {
      expect(
        run<CoverageResult & { modelBreakdown: unknown }>([
          "--list-coverage",
          "--scope",
          scope,
          "--dir",
          project
        ]).modelBreakdown
      ).toEqual({ claude: 3, external: 1 })
    }
  })

  it("roles の各要素に kind を返し、e2e-verify は impl になる", () => {
    const result = coverage()

    expect(result.roles.find((role) => role.id === "e2e-verify")?.kind).toBe(
      "impl"
    )
    expect(result.roles.find((role) => role.id === "explore")?.kind).toBe(
      "readonly"
    )
  })

  it("Agent を disallowedTools に、final-review を retiredRoles に載せる", () => {
    writeAgent("mixed.md", [
      "---",
      "name: mixed",
      "model: opus",
      "tools: Read, Grep, Glob, Bash, Agent, mcp__serena",
      "agent-policy-role: code-review, final-review",
      "---",
      ""
    ])

    expect(definitionOf(coverage(), "mixed")).toEqual({
      name: "mixed",
      file: ".claude/agents/mixed.md",
      model: "opus",
      modelId: "opus",
      vendor: null,
      roles: ["code-review"],
      retiredRoles: [{ id: "final-review", replacement: "complex-review" }],
      unknownRoles: [],
      disallowedTools: ["Agent"],
      toolsFormat: "csv"
    })
  })

  it("廃止済み ID だけの定義でも Agent を載せ、tools 欄が無くても * は載せない", () => {
    writeAgent("old-reviewer.md", [
      "---",
      "name: old-reviewer",
      "tools: Read, Agent, WebFetch",
      "agent-policy-role: final-review",
      "---",
      ""
    ])
    writeAgent("old-planner.md", [
      "---",
      "name: old-planner",
      "agent-policy-role: design-plan",
      "---",
      ""
    ])

    const result = coverage()

    expect(definitionOf(result, "old-reviewer")).toMatchObject({
      roles: [],
      retiredRoles: [{ id: "final-review", replacement: "complex-review" }],
      disallowedTools: ["Agent"]
    })
    expect(definitionOf(result, "old-planner")).toMatchObject({
      roles: [],
      retiredRoles: [{ id: "design-plan", replacement: null }],
      disallowedTools: [],
      toolsFormat: "none"
    })
  })

  it("tools 欄が無く roles がある定義は * になり、mcp__ のツールは載せない", () => {
    writeAgent("inherit.md", [
      "---",
      "name: inherit",
      "agent-policy-role: explore",
      "---",
      ""
    ])
    writeAgent("with-mcp.md", [
      "---",
      "name: with-mcp",
      "tools: Read, Grep, mcp__github__create_issue",
      "agent-policy-role: explore",
      "---",
      ""
    ])

    const result = coverage()

    expect(definitionOf(result, "inherit")).toMatchObject({
      disallowedTools: ["*"],
      toolsFormat: "none"
    })
    expect(definitionOf(result, "with-mcp")).toMatchObject({
      disallowedTools: [],
      toolsFormat: "csv"
    })
  })

  it("block 配列・flow 配列・引用符付きの tools を解釈し、書式を other とする", () => {
    writeAgent("block.md", [
      "---",
      "name: block",
      "tools:",
      "  - Read",
      '  - "Agent"',
      "agent-policy-role: explore",
      "---",
      ""
    ])
    writeAgent("flow.md", [
      "---",
      "name: flow",
      'tools: ["Read", "Agent"]',
      "agent-policy-role: explore",
      "---",
      ""
    ])
    writeAgent("quoted.md", [
      "---",
      "name: quoted",
      "tools: 'Read', 'Agent'",
      "agent-policy-role: explore",
      "---",
      ""
    ])

    const result = coverage()

    for (const name of ["block", "flow", "quoted"]) {
      expect(definitionOf(result, name)).toMatchObject({
        disallowedTools: ["Agent"],
        toolsFormat: "other"
      })
    }
  })

  it("プロジェクトに final-review.md の断片が残っていても roles に入れない", () => {
    writeProjectRole({ id: "final-review", label: "最終レビュー" })
    writeAgent("old-reviewer.md", [
      "---",
      "name: old-reviewer",
      "tools: Read, Grep",
      "agent-policy-role: final-review",
      "---",
      ""
    ])

    const result = coverage()

    expect(definitionOf(result, "old-reviewer")).toMatchObject({
      roles: [],
      retiredRoles: [{ id: "final-review", replacement: "complex-review" }]
    })
  })

  it("--scope claude でも外部ベンダーの定義を含め、マーカーの無い定義は含めない", () => {
    writeAgent("external.md", [
      "---",
      "name: external",
      "model: claude-gpt-6-1-sol",
      "agent-policy-vendor: gpt",
      "tools: Read, Agent",
      "agent-policy-role: complex-impl",
      "---",
      ""
    ])
    writeAgent("plain.md", ["---", "name: plain", "tools: Agent", "---", ""])

    const result = coverage(["--scope", "claude"])

    expect(definitionOf(result, "external")).toMatchObject({
      model: "claude-gpt-6-1-sol",
      vendor: "gpt",
      roles: ["complex-impl"],
      disallowedTools: ["Agent"]
    })
    expect(definitionOf(result, "plain")).toBeUndefined()
  })
})

describe("廃止済み ID の断片", () => {
  it("プロジェクトに断片が残っていても生成の役割として解決しない", () => {
    writeProjectRole({ id: "final-review", label: "最終レビュー" })

    const result = run<{ ok: boolean; error: string }>([
      "--scope",
      "claude",
      "--model-id",
      "opus",
      "--name",
      "old-reviewer",
      "--roles",
      "final-review",
      "--dir",
      project,
      "--check"
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toContain("final-review")
  })
})
