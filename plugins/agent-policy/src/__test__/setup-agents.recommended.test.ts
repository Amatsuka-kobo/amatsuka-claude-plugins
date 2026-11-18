import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ASSIGNMENTS, MODELS, RECOMMENDED } from "../agents/policies"
import { ROLES } from "../agents/roles"
import {
  type CheckResult,
  project,
  readAgent,
  run,
  runAsync,
  runWithMcp,
  singleResult,
  startModelsServer,
  type WriteResults,
  writeAgent
} from "./helpers/setup-agents-fixtures"

describe("--recommended", () => {
  it("Claude scope は 13 役割を各 1 定義にし、roleId と既定名を返す", () => {
    const result = run<WriteResults>([
      "--check",
      "--recommended",
      "--scope",
      "claude",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(13)
    expect(result.results.map((entry) => entry.roleId)).toEqual(
      ROLES.map((role) => role.id)
    )
    for (const entry of result.results) {
      expect(entry.modelId).toBe(
        ASSIGNMENTS["claude-model-policy"][
          entry.roleId as keyof (typeof ASSIGNMENTS)["claude-model-policy"]
        ][0]
      )
      expect(entry.roles.ids).toEqual([entry.roleId])
      expect(entry.target).toMatch(
        new RegExp(`^\\.claude/agents/${entry.modelId}-.+\\.md$`)
      )
    }
    expect(
      result.results.find((entry) => entry.roleId === "design-review")?.target
    ).toBe(".claude/agents/opus-docs-reviewer.md")
    expect(
      result.results.find((entry) => entry.roleId === "knowledge-elicitation")
        ?.target
    ).toBe(".claude/agents/haiku-knowledge-elicitor.md")
    expect(result).not.toHaveProperty("modelsDropped")
  })

  it("Claude の推奨定義は ModelId に対応する effort を出す", () => {
    const args = [
      "--recommended",
      "--scope",
      "claude",
      "--lang",
      "ja",
      "--dir",
      project
    ]
    const written = run<WriteResults>(["--write", ...args])
    expect(written.ok).toBe(true)
    const checked = run<WriteResults>(["--check", ...args])
    expect(checked.ok).toBe(true)

    const expected: Record<string, string | undefined> = {
      "complex-impl": "medium",
      "normal-impl": "medium",
      "light-impl": "medium",
      escalation: "high",
      general: "high",
      explore: "high",
      "realtime-research": "high",
      "e2e-verify": "high",
      "design-review": "high",
      "knowledge-elicitation": "low",
      "code-review": "high",
      "complex-review": "high",
      "adversarial-review": "high"
    }
    for (const entry of checked.results) {
      const content = fs.readFileSync(path.join(project, entry.target), "utf8")
      const modelAt = content
        .split("\n")
        .findIndex((line) => line.startsWith("model: "))
      const nextLine = content.split("\n")[modelAt + 1]
      const effort = expected[entry.roleId ?? ""]
      if (effort === undefined) expect(nextLine).not.toMatch(/^effort: /)
      else expect(nextLine).toBe(`effort: ${effort}`)
    }
  })

  it("custom scope の複数役割は指定分のみ ROLES 順に返す", () => {
    const result = run<WriteResults>([
      "--check",
      "--recommended",
      "--scope",
      "custom",
      "--roles",
      "design-review,complex-impl,adversarial-review",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(
      result.results.map((entry) => [entry.roleId, entry.modelId])
    ).toEqual([
      ["complex-impl", "gpt-sol"],
      ["design-review", "gpt-sol"],
      ["adversarial-review", "opus"]
    ])
  })

  it("live に候補がすべて存在すると各役割の推奨先頭を選ぶ", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: MODELS.filter((spec) => spec.vendor !== "claude").map((spec) => ({
          id: spec.model,
          owned_by: "unknown"
        }))
      })
    })
    const result = await runAsync<WriteResults>(
      ["--check", "--recommended", "--scope", "custom", "--dir", project],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )
    expect(result.ok).toBe(true)
    expect(result.results.map((entry) => entry.modelId)).toEqual(
      ROLES.map((role) => RECOMMENDED[role.id][0])
    )
  })

  it("先頭が live に無ければ次の Claude enum を採り、その後の候補は採らない", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "claude-grok-4-7", owned_by: "xai" }]
      })
    })
    const result = await runAsync<WriteResults>(
      [
        "--check",
        "--recommended",
        "--scope",
        "custom",
        "--roles",
        "design-review",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )
    expect(result.results.map((entry) => entry.modelId)).toEqual(["opus"])
  })

  it("live の照会失敗時は推奨先頭を採り警告を返す", () => {
    const result = run<WriteResults>([
      "--check",
      "--recommended",
      "--scope",
      "custom",
      "--roles",
      "design-review,complex-impl",
      "--dir",
      project
    ])
    expect(result.results.map((entry) => entry.modelId)).toEqual([
      "gpt-sol",
      "gpt-sol"
    ])
    expect(result.warnings).toContain(
      "live models unavailable (no-base-url); model existence was not validated"
    )
  })

  it("vendor と color は ModelSpec 由来で frontmatter に入る", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "claude-grok-4-7", owned_by: "unknown" }]
      })
    })
    const result = await runAsync<WriteResults>(
      [
        "--write",
        "--recommended",
        "--scope",
        "custom",
        "--roles",
        "design-review",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )
    expect(result.ok).toBe(true)
    const content = fs.readFileSync(
      path.join(project, result.results[0]?.target ?? ""),
      "utf8"
    )
    expect(result.results[0]?.modelId).toBe("opus")
    expect(content).toMatch(/^agent-policy-vendor: claude$/m)
    expect(content).toMatch(/^color: blue$/m)
  })

  it("役割ごとに分けた write は初回の定義だけ MCP を付ける", () => {
    const first = runWithMcp<WriteResults>(
      [
        "--write",
        "--recommended",
        "--scope",
        "claude",
        "--roles",
        "normal-impl",
        "--dir",
        project,
        "--mcp-servers",
        "serena"
      ],
      "serena: uvx serena - ✔ Connected"
    )
    const second = run<WriteResults>([
      "--write",
      "--recommended",
      "--scope",
      "claude",
      "--roles",
      "code-review",
      "--dir",
      project
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const impl = fs.readFileSync(
      path.join(project, first.results[0]?.target ?? ""),
      "utf8"
    )
    const readonly = fs.readFileSync(
      path.join(project, second.results[0]?.target ?? ""),
      "utf8"
    )
    expect(impl).toContain("mcp__serena")
    expect(readonly).not.toContain("mcp__serena")
  })

  it("--merge は --recommended と併用できる", () => {
    const result = run<WriteResults>([
      "--write",
      "--merge",
      "--recommended",
      "--scope",
      "claude",
      "--roles",
      "knowledge-elicitation",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.results[0]?.action).toBe("written")
  })

  it.each([
    ["--model-id", "sonnet"],
    ["--name", "x"],
    ["--model", "sonnet"],
    ["--vendor", "claude"],
    ["--keep", "preamble"]
  ])("--recommended と %s は併用できない", (flag, value) => {
    const result = run<WriteResults>([
      "--check",
      "--recommended",
      "--scope",
      "claude",
      flag,
      value,
      "--dir",
      project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain(flag)
    expect(result.error).toContain("--recommended")
  })

  it("未知の役割は拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--recommended",
      "--scope",
      "claude",
      "--roles",
      "unknown-role",
      "--dir",
      project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain("unknown-role")
  })
})

describe("MCP の付与", () => {
  const CONNECTED = "serena: uvx serena - ✔ Connected"

  it("--mcp-servers で渡したサーバーを tools へ足す", () => {
    const result = runWithMcp<WriteResults>(
      [
        "--write",
        "--model-id",
        "sonnet",
        "--lang",
        "ja",
        "--name",
        "claude-explorer",
        "--roles",
        "explore",
        "--dir",
        project,
        "--mcp-servers",
        "serena",
        "--mcp-deny",
        "mcp__serena__write_memory"
      ],
      CONNECTED
    )
    expect(result.ok).toBe(true)
    const written = fs.readFileSync(
      path.join(project, ".claude", "agents", "claude-explorer.md"),
      "utf8"
    )
    expect(written).toMatch(/^tools:.*mcp__serena$/m)
    expect(written).toMatch(/^disallowedTools: mcp__serena__write_memory$/m)
  })

  it("usable でないサーバーは落として報告する", () => {
    const result = runWithMcp<WriteResults>(
      [
        "--write",
        "--model-id",
        "sonnet",
        "--lang",
        "ja",
        "--name",
        "claude-explorer",
        "--roles",
        "explore",
        "--dir",
        project,
        "--mcp-servers",
        "gone"
      ],
      CONNECTED
    )
    expect(result.results[0]?.mcpDropped).toEqual(["gone"])
    const written = fs.readFileSync(
      path.join(project, ".claude", "agents", "claude-explorer.md"),
      "utf8"
    )
    expect(written).not.toContain("mcp__")
  })

  it("既存定義から mcpCurrent を逆算して返す", () => {
    const file = path.join(project, ".claude", "agents", "claude-explorer.md")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      [
        "---",
        "name: claude-explorer",
        "description: old",
        "model: sonnet",
        "color: purple",
        "tools: Read, Grep, Glob, Bash, mcp__serena",
        "disallowedTools: mcp__serena__write_memory",
        "agent-policy-role: explore",
        "---",
        "",
        "## Output Format",
        "",
        "- old"
      ].join("\n")
    )
    const result = run<WriteResults>([
      "--check",
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-explorer",
      "--roles",
      "explore",
      "--dir",
      project
    ])
    expect(result.results[0]?.mcpCurrent.servers).toEqual(["serena"])
    expect(result.results[0]?.mcpCurrent.denyTools).toEqual([
      "mcp__serena__write_memory"
    ])
  })

  it("mcpCurrent を次の書き込みへ渡しても MCP 選択を保持する", () => {
    const connected =
      "plugin:context7:context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected"
    const base = [
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-explorer",
      "--roles",
      "explore",
      "--dir",
      project
    ]

    runWithMcp<WriteResults>(
      ["--write", ...base, "--mcp-servers", "plugin:context7:context7"],
      connected
    )
    const checked = run<WriteResults>(["--check", ...base])
    const current = checked.results[0]?.mcpCurrent.servers ?? []
    expect(current).toEqual(["plugin_context7_context7"])

    const rewritten = runWithMcp<WriteResults>(
      ["--write", ...base, "--mcp-servers", current.join(",")],
      connected
    )
    expect(rewritten.results[0]?.mcpDropped).toEqual([])
    const written = fs.readFileSync(
      path.join(project, ".claude", "agents", "claude-explorer.md"),
      "utf8"
    )
    expect(written).toMatch(/^tools:.*mcp__plugin_context7_context7$/m)
  })
})

describe("--recommended --merge での MCP の引き継ぎ", () => {
  const CONNECTED = "serena: uvx serena - ✔ Connected"

  function seedExplorer(tools: string, deny?: string): void {
    writeAgent("explorer.md", [
      "---",
      "name: explorer",
      "model: sonnet",
      `tools: ${tools}`,
      ...(deny === undefined ? [] : [`disallowedTools: ${deny}`]),
      "agent-policy-role: explore",
      "---",
      "",
      "本文",
      ""
    ])
  }

  function recommendExplore(extra: string[] = []): WriteResults {
    return runWithMcp<WriteResults>(
      [
        "--write",
        "--merge",
        "--recommended",
        "--roles",
        "explore,code-review",
        "--scope",
        "claude",
        "--lang",
        "ja",
        "--dir",
        project,
        ...extra
      ],
      CONNECTED
    )
  }

  function resultFor(result: WriteResults, file: string) {
    return result.results.find(
      (entry) => entry.target === `.claude/agents/${file}`
    )
  }

  it("既存定義の mcp__ と disallowedTools を残し、新規生成には付けない", () => {
    seedExplorer(
      "Read, Grep, Glob, Bash, mcp__serena",
      "mcp__serena__write_memory"
    )

    const result = recommendExplore()

    expect(result.ok).toBe(true)
    const written = readAgent("explorer.md")
    expect(written).toMatch(/^tools:.*mcp__serena$/m)
    expect(written).toMatch(/^disallowedTools: mcp__serena__write_memory$/m)
    expect(resultFor(result, "explorer.md")?.mcpDropped).toEqual([])
    const created = result.results.find(
      (entry) => entry.roleId === "code-review"
    )
    expect(created).toBeDefined()
    expect(readAgent(path.basename(created?.target ?? ""))).not.toContain(
      "mcp__"
    )
  })

  it("切断済みのサーバーは mcpDropped に載せて外す", () => {
    seedExplorer("Read, Grep, Glob, Bash, mcp__serena, mcp__gone")

    const result = recommendExplore()

    expect(resultFor(result, "explorer.md")?.mcpDropped).toEqual(["gone"])
    const written = readAgent("explorer.md")
    expect(written).toMatch(/^tools:.*mcp__serena$/m)
    expect(written).not.toContain("mcp__gone")
  })

  it("--mcp-servers を明示したときは既存の MCP を引き継がない", () => {
    seedExplorer("Read, Grep, Glob, Bash, mcp__gone", "mcp__gone__delete")

    recommendExplore(["--mcp-servers", "serena"])

    const written = readAgent("explorer.md")
    expect(written).toMatch(/^tools:.*mcp__serena$/m)
    expect(written).not.toContain("mcp__gone")
  })
})

describe("automaticKeep", () => {
  it("既存の mcp__ ツールと disallowedTools を保持しない", () => {
    const file = path.join(project, ".claude", "agents", "claude-explorer.md")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      [
        "---",
        "name: claude-explorer",
        "description: old",
        "model: sonnet",
        "color: purple",
        "tools: Read, Grep, Glob, Bash, mcp__legacy",
        "disallowedTools: mcp__legacy__write",
        "agent-policy-role: explore",
        "---",
        "",
        "## Output Format",
        "",
        "- old"
      ].join("\n")
    )
    const result = run<WriteResults>([
      "--write",
      "--merge",
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-explorer",
      "--roles",
      "explore",
      "--dir",
      project
    ])
    expect(result.results[0]?.kept).not.toContain("tools:mcp__legacy")
    expect(result.results[0]?.kept).not.toContain("key:disallowedTools")
    const written = fs.readFileSync(file, "utf8")
    expect(written).not.toContain("mcp__legacy")
    expect(written).not.toContain("disallowedTools")
  })
})

describe("vendor color の配線", () => {
  it("Claude vendor の blue を生成定義へ渡す", () => {
    const result = run<WriteResults>([
      "--write",
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-sonnet",
      "--roles",
      "normal-impl",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    const written = fs.readFileSync(
      path.join(project, ".claude", "agents", "claude-sonnet.md"),
      "utf8"
    )
    expect(written).toMatch(/^color: blue$/m)
  })
})

describe("2 キー(omitClaudeMd と experimental.cacheTtl)", () => {
  interface TwoKeys {
    omitClaudeMd: { before: boolean | null; after: boolean | null }
    cacheTtl: { before: string | null; after: string | null }
  }
  type WithTwoKeys = CheckResult & { twoKeys: TwoKeys }

  const agentFile = (name: string) =>
    path.join(project, ".claude", "agents", `${name}.md`)
  const read = (name: string) => fs.readFileSync(agentFile(name), "utf8")
  const frontmatterOf = (name: string) => read(name).split("\n---\n")[0] ?? ""
  const edit = (name: string, change: (text: string) => string) =>
    fs.writeFileSync(agentFile(name), change(read(name)))

  function individual(
    name: string,
    roles: string,
    extra: string[] = [],
    model: {
      scope: string
      modelId: string
      model?: string
      vendor?: string
    } = {
      scope: "claude",
      modelId: "sonnet"
    }
  ): string[] {
    return [
      "--scope",
      model.scope,
      "--model-id",
      model.modelId,
      ...(model.model === undefined ? [] : ["--model", model.model]),
      ...(model.vendor === undefined ? [] : ["--vendor", model.vendor]),
      "--name",
      name,
      "--roles",
      roles,
      "--dir",
      project,
      ...extra
    ]
  }
  const write = (args: string[]) =>
    singleResult(["--write", ...args]) as unknown as WithTwoKeys
  const checkOf = (args: string[]) =>
    singleResult(args) as unknown as WithTwoKeys

  it("レビューの役割を持ち Claude のモデルで動く定義に cacheTtl: 1h を書く", () => {
    const result = write(individual("reviewer", "code-review"))
    expect(frontmatterOf("reviewer")).toMatch(
      /^experimental:\n {2}cacheTtl: 1h$/m
    )
    expect(result.twoKeys.cacheTtl).toEqual({ before: null, after: "1h" })
  })

  it("既存の cacheTtl: 5m を 1h に書き換え、experimental の他の下位キーを残す", () => {
    write(individual("reviewer", "code-review"))
    edit("reviewer", (text) =>
      text.replace("  cacheTtl: 1h", "  other: keep\n  cacheTtl: 5m")
    )
    const result = write(individual("reviewer", "code-review", ["--merge"]))
    expect(frontmatterOf("reviewer")).toMatch(
      /^experimental:\n {2}other: keep\n {2}cacheTtl: 1h$/m
    )
    expect(result.twoKeys.cacheTtl).toEqual({ before: "5m", after: "1h" })
  })

  it("model が Claude の別名でも vendor が外部ベンダーなら cacheTtl を書かない", () => {
    write(
      individual("gpt-alias", "code-review", [], {
        scope: "custom",
        modelId: "sonnet",
        model: "sonnet",
        vendor: "gpt"
      })
    )
    expect(frontmatterOf("gpt-alias")).not.toContain("experimental")
  })

  it("外部ベンダーのモデルに変えた定義から cacheTtl だけを消す", () => {
    write(individual("switched", "code-review"))
    edit("switched", (text) =>
      text.replace("  cacheTtl: 1h", "  other: keep\n  cacheTtl: 1h")
    )
    const external = {
      scope: "custom",
      modelId: "sonnet",
      model: "test-alias",
      vendor: "gpt"
    }
    const result = write(
      individual("switched", "code-review", ["--merge"], external)
    )
    expect(frontmatterOf("switched")).toMatch(
      /^experimental:\n {2}other: keep$/m
    )
    expect(frontmatterOf("switched")).not.toContain("cacheTtl")
    expect(result.twoKeys.cacheTtl).toEqual({ before: "1h", after: null })

    write(individual("only-ttl", "code-review"))
    write(individual("only-ttl", "code-review", ["--merge"], external))
    expect(frontmatterOf("only-ttl")).not.toContain("experimental")
  })

  it("レビューの役割を持たない定義とフロー形式の experimental は変えない", () => {
    write(individual("impl", "normal-impl"))
    expect(frontmatterOf("impl")).not.toContain("experimental")
    edit("impl", (text) =>
      text.replace("\neffort:", "\nexperimental:\n  other: keep\neffort:")
    )
    write(individual("impl", "normal-impl", ["--merge"]))
    expect(frontmatterOf("impl")).toMatch(/^experimental:\n {2}other: keep$/m)

    write(individual("flow", "code-review"))
    edit("flow", (text) =>
      text.replace(
        "experimental:\n  cacheTtl: 1h",
        "experimental: { cacheTtl: 5m }"
      )
    )
    const result = write(individual("flow", "code-review", ["--merge"]))
    expect(frontmatterOf("flow")).toContain("experimental: { cacheTtl: 5m }")
    expect(result.twoKeys.cacheTtl.after).toBe(result.twoKeys.cacheTtl.before)
  })

  it("新しく作る knowledge-elicitation だけの定義に推奨どおり omitClaudeMd: true を付ける", () => {
    const result = write(individual("elicitor", "knowledge-elicitation"))
    expect(frontmatterOf("elicitor")).toMatch(/^omitClaudeMd: true$/m)
    expect(result.twoKeys.omitClaudeMd).toEqual({ before: null, after: true })
    write(individual("mixed", "knowledge-elicitation,code-review"))
    expect(frontmatterOf("mixed")).not.toContain("omitClaudeMd")
  })

  it("質問しない経路では既にある定義の omitClaudeMd を保つ", () => {
    write(individual("keeper", "code-review"))
    edit("keeper", (text) =>
      text.replace("\neffort:", "\nomitClaudeMd: true\neffort:")
    )
    write(individual("keeper", "code-review", ["--merge"]))
    expect(frontmatterOf("keeper")).toMatch(/^omitClaudeMd: true$/m)
    write(individual("keeper", "code-review"))
    expect(frontmatterOf("keeper")).toMatch(/^omitClaudeMd: true$/m)

    write(individual("dropper", "knowledge-elicitation"))
    edit("dropper", (text) => text.replace("omitClaudeMd: true\n", ""))
    write(individual("dropper", "knowledge-elicitation", ["--merge"]))
    expect(frontmatterOf("dropper")).not.toContain("omitClaudeMd")
  })

  it("--omit-claude-md false の回答で行を消し、true で書く", () => {
    write(individual("answered", "knowledge-elicitation"))
    const removed = write(
      individual("answered", "knowledge-elicitation", [
        "--merge",
        "--omit-claude-md",
        "false"
      ])
    )
    expect(frontmatterOf("answered")).not.toContain("omitClaudeMd")
    expect(removed.twoKeys.omitClaudeMd).toEqual({ before: true, after: null })
    write(
      individual("answered", "knowledge-elicitation", [
        "--omit-claude-md",
        "true"
      ])
    )
    expect(frontmatterOf("answered")).toMatch(/^omitClaudeMd: true$/m)
  })

  it("完全上書きでも答えていない omitClaudeMd と experimental の他の下位キーを書き戻す", () => {
    write(individual("full", "code-review"))
    edit("full", (text) =>
      text
        .replace("  cacheTtl: 1h", "  other: keep\n  cacheTtl: 1h")
        .replace("\neffort:", "\nomitClaudeMd: true\neffort:")
    )
    write(individual("full", "code-review"))
    expect(frontmatterOf("full")).toMatch(/^omitClaudeMd: true$/m)
    expect(frontmatterOf("full")).toMatch(
      /^experimental:\n {2}other: keep\n {2}cacheTtl: 1h$/m
    )
  })

  it("2 キーを持つ定義を変えずに --check すると identical になり、2 キーを差分に出さない", () => {
    write(
      individual("stable", "knowledge-elicitation,code-review", [
        "--omit-claude-md",
        "true"
      ])
    )
    const result = checkOf(
      individual("stable", "knowledge-elicitation,code-review")
    )
    expect(result.identical).toBe(true)
    expect(result.frontmatter.keysOnlyInExisting).not.toContain("omitClaudeMd")
    expect(result.frontmatter.keysOnlyInExisting).not.toContain("experimental")
    expect(result.twoKeys).toEqual({
      omitClaudeMd: { before: true, after: true },
      cacheTtl: { before: "1h", after: "1h" }
    })
  })

  it("入れ子の同名キーを書き換えず、experimental の直下の cacheTtl だけを扱う", () => {
    write(individual("nested", "code-review"))
    edit("nested", (text) =>
      text.replace(
        "experimental:\n  cacheTtl: 1h",
        'experimental:\n    other:\n      cacheTtl: x\n    cacheTtl: "5m"'
      )
    )
    const result = write(individual("nested", "code-review", ["--merge"]))
    expect(frontmatterOf("nested")).toContain(
      "experimental:\n    other:\n      cacheTtl: x\n    cacheTtl: 1h"
    )
    expect(result.twoKeys.cacheTtl).toEqual({ before: "5m", after: "1h" })
  })

  it("omitClaudeMd: false と行末のコメントを保ち、値を読む", () => {
    write(individual("commented", "code-review"))
    edit("commented", (text) =>
      text
        .replace("\neffort:", "\nomitClaudeMd: false # why\neffort:")
        .replace("experimental:\n", "experimental: # note\n")
    )
    const result = write(individual("commented", "code-review", ["--merge"]))
    expect(frontmatterOf("commented")).toMatch(/^omitClaudeMd: false # why$/m)
    expect(frontmatterOf("commented")).toMatch(
      /^experimental: # note\n {2}cacheTtl: 1h$/m
    )
    expect(result.twoKeys.omitClaudeMd).toEqual({ before: false, after: false })
  })

  it("--omit-claude-md は --recommended と併用できない", () => {
    const result = run([
      "--write",
      "--recommended",
      "--scope",
      "claude",
      "--omit-claude-md",
      "true",
      "--dir",
      project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain("--omit-claude-md")
  })

  it("--check は --omit-claude-md を受け付け、書き込む値を after に返す", () => {
    write(individual("asked", "knowledge-elicitation"))
    const result = checkOf(
      individual("asked", "knowledge-elicitation", [
        "--omit-claude-md",
        "false"
      ])
    )
    expect(result.ok).toBe(true)
    expect(result.twoKeys.omitClaudeMd).toEqual({ before: true, after: null })
    expect(frontmatterOf("asked")).toMatch(/^omitClaudeMd: true$/m)
  })
})
