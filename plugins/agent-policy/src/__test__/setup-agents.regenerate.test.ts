import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  coverage,
  definitionOf,
  project,
  readAgent,
  run,
  type WriteResults,
  writeAgent
} from "./helpers/setup-agents-fixtures"

describe("再生成の作成先は被覆する定義で決める", () => {
  function recommend(scope: "claude" | "custom", roles: string): WriteResults {
    return run<WriteResults>([
      "--write",
      "--merge",
      "--recommended",
      "--roles",
      roles,
      "--scope",
      scope,
      "--lang",
      "ja",
      "--dir",
      project
    ])
  }

  function agentFiles(): string[] {
    return fs.readdirSync(path.join(project, ".claude", "agents")).sort()
  }

  function marked(file: string, model: string, roles: string, vendor?: string) {
    writeAgent(file, [
      "---",
      `name: ${file.replace(/\.md$/, "")}`,
      `model: ${model}`,
      "tools: Read, Grep, Glob, Bash",
      `agent-policy-role: ${roles}`,
      ...(vendor === undefined ? [] : [`agent-policy-vendor: ${vendor}`]),
      "---",
      "",
      "本文",
      ""
    ])
  }

  it("definitions の modelId を Claude enum・MODELS の model・該当なしの 3 通りで返す", () => {
    marked("enum.md", "opus", "explore")
    marked("alias.md", "claude-gpt-6-1-sol", "explore", "gpt")
    marked("unknown.md", "my-model", "explore")

    const result = coverage()

    expect(definitionOf(result, "enum")?.modelId).toBe("opus")
    expect(definitionOf(result, "alias")?.modelId).toBe("gpt-sol")
    expect(definitionOf(result, "unknown")?.modelId).toBeNull()
  })

  it("既定名でない被覆定義を作成先にし、既定名のファイルを作らない", () => {
    marked("x.md", "sonnet", "code-review")

    const result = recommend("claude", "code-review")

    expect(result.ok).toBe(true)
    expect(result.results.map((entry) => entry.target)).toEqual([
      ".claude/agents/x.md"
    ])
    expect(agentFiles()).toEqual(["x.md"])
    const content = readAgent("x.md")
    expect(content).toContain("name: x\n")
    expect(content).toContain("model: sonnet\n")
    expect(content).toContain("agent-policy-role: code-review\n")
  })

  it("複数の役割を持つ被覆定義は 1 回だけ生成し、roles を保つ", () => {
    marked("shared.md", "sonnet", "explore, code-review")

    const result = recommend("claude", "explore,code-review")

    expect(result.results.map((entry) => entry.target)).toEqual([
      ".claude/agents/shared.md"
    ])
    expect(result.results[0]?.roles.ids).toEqual(["explore", "code-review"])
    expect(agentFiles()).toEqual(["shared.md"])
    expect(readAgent("shared.md")).toContain(
      "agent-policy-role: explore, code-review\n"
    )
  })

  it("被覆が 2 件の役割と modelId が null の定義は生成せず warnings に載せる", () => {
    marked("first.md", "sonnet", "code-review")
    marked("second.md", "opus", "code-review")
    marked("custom-model.md", "my-model", "explore")
    const before = agentFiles().map((file) => readAgent(file))

    const result = recommend("custom", "explore,code-review")

    expect(result.ok).toBe(true)
    expect(result.results).toEqual([])
    expect(
      result.warnings.some(
        (warning) =>
          warning.includes("code-review") &&
          warning.includes("first") &&
          warning.includes("second")
      )
    ).toBe(true)
    expect(
      result.warnings.some((warning) => warning.includes("custom-model"))
    ).toBe(true)
    expect(agentFiles().map((file) => readAgent(file))).toEqual(before)
  })

  it("modelId が null の定義は、選んだモデル ID と既定の model 値を個別コマンドに渡すと、その model で再生成される", () => {
    marked("legacy.md", "inherit", "explore")

    const result = run<WriteResults>([
      "--write",
      "--merge",
      "--model-id",
      "sonnet",
      "--name",
      "legacy",
      "--model",
      "sonnet",
      "--roles",
      "explore",
      "--scope",
      "claude",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.results[0]?.target).toBe(".claude/agents/legacy.md")
    expect(agentFiles()).toEqual(["legacy.md"])
    const content = readAgent("legacy.md")
    expect(content).toContain("model: sonnet\n")
    expect(content).not.toContain("model: inherit")
  })

  it.each([
    ["廃止済み ID", "code-review, final-review"],
    ["未知の ID", "code-review, no-such-role"]
  ])("%s を持つ被覆定義は変更せず warnings に載せ、既定名のファイルも作らない", (_label, roles) => {
    marked("x.md", "sonnet", roles)
    const before = readAgent("x.md")

    const result = recommend("claude", "code-review")

    expect(result.ok).toBe(true)
    expect(result.results).toEqual([])
    expect(result.warnings.some((warning) => warning.includes("x"))).toBe(true)
    expect(readAgent("x.md")).toBe(before)
    expect(agentFiles()).toEqual(["x.md"])
  })

  it("claude-only で外部ベンダーの定義しか被覆しない役割は既定名で新規生成する", () => {
    marked("external.md", "claude-gpt-6-1-sol", "code-review", "gpt")
    const external = readAgent("external.md")

    const result = recommend("claude", "code-review")

    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.target).not.toBe(".claude/agents/external.md")
    expect(readAgent("external.md")).toBe(external)
  })
})
