import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  type CheckResult,
  check,
  project,
  run,
  runAsync,
  seed,
  singleResult,
  startModelsServer,
  target,
  type WriteResults,
  writeProjectRole
} from "./helpers/setup-agents-fixtures"

describe("parseArgs", () => {
  it.each([
    "../../pwned",
    "GPT_Sol",
    "-a"
  ])("不正な name %s を拒否する", (name) => {
    const result = run([
      "--name",
      name,
      "--roles",
      "explore",
      "--dir",
      project,
      "--check"
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe(
      "name: must be lowercase letters, digits and hyphens"
    )
  })

  it("roles の重複を除去する", () => {
    const result = check("custom", ["--roles", "complex-impl,complex-impl"])
    expect(result.roles.ids).toEqual(["complex-impl"])
  })
})

describe("--write", () => {
  it("個別経路は model-id から effort を選ぶ", () => {
    const result = run<WriteResults>([
      "--write",
      "--scope",
      "custom",
      "--model-id",
      "sonnet",
      "--model",
      "test-alias",
      "--name",
      "effort-individual",
      "--roles",
      "general,code-review",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    const content = fs.readFileSync(
      path.join(project, ".claude", "agents", "effort-individual.md"),
      "utf8"
    )
    expect(content).toMatch(/^model: test-alias\neffort: high$/m)
  })

  it("--merge は既存の effort をテンプレート値で上書きする", () => {
    const args = [
      "--scope",
      "custom",
      "--model-id",
      "sonnet",
      "--name",
      "effort-merge",
      "--roles",
      "general",
      "--dir",
      project
    ]
    run(["--write", ...args])
    const file = path.join(project, ".claude", "agents", "effort-merge.md")
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace(/^effort: .+$/m, "effort: low")
    )

    const result = run<WriteResults>(["--write", "--merge", ...args])
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(file, "utf8")).toMatch(/^model: .+\neffort: high$/m)
  })

  it("--merge はテンプレートに無い既存 effort を保持する", () => {
    const args = [
      "--scope",
      "claude",
      "--model-id",
      "haiku",
      "--name",
      "effort-haiku",
      "--roles",
      "knowledge-elicitation",
      "--dir",
      project
    ]
    run(["--write", ...args])
    const file = path.join(project, ".claude", "agents", "effort-haiku.md")
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace(/^(model: .+)$/m, "$1\neffort: low")
    )

    const result = run<WriteResults>(["--write", "--merge", ...args])
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(file, "utf8")).toMatch(/^effort: low$/m)
  })

  it("--merge はテンプレートに無い既存 hooks をブロックごと保持する", () => {
    const args = [
      "--scope",
      "claude",
      "--model-id",
      "haiku",
      "--name",
      "hooks-keep",
      "--roles",
      "knowledge-elicitation",
      "--dir",
      project
    ]
    run(["--write", ...args])
    const file = path.join(project, ".claude", "agents", "hooks-keep.md")
    const hooks = [
      "hooks:",
      "  PreToolUse:",
      '    - matcher: "Bash"',
      "      hooks:",
      "        - type: command",
      '          command: "./check.sh"'
    ].join("\n")
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace(/^(model: .+)$/m, `$1\n${hooks}`)
    )

    const result = run<WriteResults>(["--write", "--merge", ...args])
    expect(result.ok).toBe(true)
    const content = fs.readFileSync(file, "utf8")
    expect(content).toContain(`\n${hooks}\n`)
  })

  it("既存が無いときテンプレートどおりに書く", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    expect(result.ok).toBe(true)
    expect(fs.existsSync(target())).toBe(true)
    expect(fs.readFileSync(target(), "utf8")).toContain("name: gpt-sol")
    expect(fs.readFileSync(target(), "utf8")).toContain("color: yellow")
  })

  it("--merge で新規作成すると空の保持・破棄情報を返す", () => {
    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge"
    ])

    expect(result.action).toBe("written")
    expect(result.kept).toEqual([])
    expect(result.keptNeedsReview).toEqual([])
    expect(result.discarded).toEqual({
      frontmatterKeys: [],
      preamble: false,
      sections: []
    })
  })

  it("--keep なしでは完全上書きになる", () => {
    seed("custom", { extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    expect(fs.readFileSync(target(), "utf8")).not.toContain("## ツール運用")
  })

  it("--merge なしでは overwritten と破棄した変更を返す", () => {
    seed("custom", {
      model: "my-own-alias",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])

    expect(result.action).toBe("overwritten")
    expect(result.discarded).toEqual({
      frontmatterKeys: ["model"],
      preamble: true,
      sections: ["## 制約"]
    })
  })

  it("--keep section で既存にしかない節を残す", () => {
    seed("custom", { extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "section:## ツール運用"
    ])
    const content = fs.readFileSync(target(), "utf8")
    expect(content).toContain("## ツール運用")
    expect(content).toContain("Context7 を使う")
  })

  it("--keep tools で既存にしかない tools を残す", () => {
    seed("custom", {
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "tools:mcp__context7"
    ])
    expect(fs.readFileSync(target(), "utf8")).toMatch(/^tools:.*mcp__context7/m)
  })

  it("--keep key で既存にしかないキーを残す", () => {
    seed("custom", { extraKeys: { permissionMode: "plan" } })
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "key:permissionMode"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain("permissionMode: plan")
  })

  it("--keep key で値の違う共通キーを残す", () => {
    seed("custom", { model: "my-own-alias" })
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "key:model"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain("model: my-own-alias")
  })

  it("--keep preamble で冒頭宣言を残す", () => {
    seed("custom", { preamble: "あなたは私が書き換えた冒頭である。" })
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "preamble"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain(
      "あなたは私が書き換えた冒頭である。"
    )
  })

  it("--merge で既存にしかない tools・キー・節を自動保持する", () => {
    seed("custom", {
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, CustomTool",
      model: "my-own-alias",
      extraKeys: { permissionMode: "plan" },
      extraSection: "## 独自運用\n\n- 独自の運用。\n",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge"
    ])
    const content = fs.readFileSync(target(), "utf8")

    expect(result.action).toBe("merged")
    expect(result.kept).toEqual([
      "tools:LSP",
      "tools:Agent",
      "tools:CustomTool",
      "key:permissionMode",
      "section:## 独自運用"
    ])
    // 利用者が書き換えた前置きは userEdited として既定で保持するため、捨てた側に数えない。
    expect(result.discarded).toEqual({
      frontmatterKeys: ["model"],
      preamble: false,
      sections: ["## 制約"]
    })
    expect(result.preamble).toBe("userEdited")
    expect(content).toMatch(/^tools:.*CustomTool/m)
    expect(content).toContain("permissionMode: plan")
    expect(content).toContain("## 独自運用")
    expect(content).toContain("model: claude-gpt-6-1-sol")
    expect(content).toContain("あなたは私が書き換えた冒頭である。")
    expect(content).not.toContain("私が書き換えた制約")
  })

  it("--merge と明示 --keep を併用して変更済み項目も保持する", () => {
    seed("custom", {
      model: "my-own-alias",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge",
      "--keep",
      "key:model",
      "--keep",
      "preamble",
      "--keep",
      "section:## 制約"
    ])
    const content = fs.readFileSync(target(), "utf8")

    expect(result.kept).toEqual(["key:model", "preamble", "section:## 制約"])
    expect(result.discarded).toEqual({
      frontmatterKeys: [],
      preamble: false,
      sections: []
    })
    expect(content).toContain("model: my-own-alias")
    expect(content).toContain("あなたは私が書き換えた冒頭である。")
    expect(content).toContain("私が書き換えた制約")
  })

  it("明示保持した mcp__ tool を keptNeedsReview に分ける", () => {
    seed("custom", {
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })

    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "tools:mcp__context7"
    ])

    expect(result.kept).toEqual(["tools:mcp__context7"])
    expect(result.keptNeedsReview).toEqual(["tools:mcp__context7"])
  })

  it("存在しない --keep section でエラーになり既存ファイルを変えない", () => {
    seed("custom", { extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "section:ツール運用"
    ])

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
    expect(String(result.error)).toContain("not found")
    expect(fs.readFileSync(target(), "utf8")).toBe(before)
  })

  it("存在しない --keep tools でエラーになり既存ファイルを変えない", () => {
    seed("custom", {})
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "tools:NoSuchTool"
    ])

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
    expect(String(result.error)).toContain("not found")
    expect(fs.readFileSync(target(), "utf8")).toBe(before)
  })

  it("存在しない --keep key でエラーになり既存ファイルを変えない", () => {
    seed("custom", {})
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "key:noSuchKey"
    ])

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
    expect(String(result.error)).toContain("not found")
    expect(fs.readFileSync(target(), "utf8")).toBe(before)
  })

  it("不正な --keep セレクタでエラーを返す", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "bogus:value"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
  })
})

describe("custom の役割検証", () => {
  it("推奨から外れる組み込み役割も警告付きで通す", () => {
    const result = run<WriteResults>([
      "--check",
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-sonnet",
      "--roles",
      "normal-impl,light-impl",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.warnings).toContain(
      "roles: light-impl is not recommended for sonnet"
    )
  })

  it("custom では gpt-astra ModelId を明示指定できる", () => {
    const result = run<WriteResults>([
      "--check",
      "--scope",
      "custom",
      "--model-id",
      "gpt-astra",
      "--lang",
      "ja",
      "--name",
      "gpt-astra",
      "--roles",
      "escalation",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
  })

  it("未知の model-id を拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--model-id",
      "unknown-model",
      "--lang",
      "ja",
      "--name",
      "unknown",
      "--roles",
      "explore",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/model-id/)
  })

  it("プロジェクト独自役割を通す", () => {
    writeProjectRole({ id: "triage" })
    const result = run<WriteResults>([
      "--check",
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-sonnet",
      "--roles",
      "explore,triage",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
  })

  it("翻訳断片が欠けている言語を拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--model-id",
      "sonnet",
      "--lang",
      "de",
      "--name",
      "claude-sonnet",
      "--roles",
      "explore",
      "--dir",
      project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/fragment/i)
  })
})

describe("live model 検証と vendor", () => {
  const writeArgs = (name: string, scope: "claude" | "custom"): string[] => [
    "--write",
    "--scope",
    scope,
    "--model-id",
    "gpt-sol",
    "--name",
    name,
    "--roles",
    "complex-impl",
    "--lang",
    "ja",
    "--dir",
    project
  ]

  it("live に存在する --model を通し、省略 vendor を推定する", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "live-sol", owned_by: "openai" }]
      })
    })

    const result = await runAsync<WriteResults>(
      [...writeArgs("live-sol-agent", "custom"), "--model", "live-sol"],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(true)
    const content = fs.readFileSync(
      path.join(project, ".claude", "agents", "live-sol-agent.md"),
      "utf8"
    )
    expect(content).toMatch(/^agent-policy-vendor: gpt$/m)
    expect(content).toMatch(/^color: yellow$/m)
  })

  it("live に存在しない --model を拒否する", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({ data: [] })
    })

    const result = await runAsync<WriteResults>(
      [
        ...writeArgs("missing-model", "custom"),
        "--model",
        "missing-model",
        "--vendor",
        "gpt"
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain("missing-model")
  })

  it("照会失敗時は --model を検証せず警告付きで通す", () => {
    const result = run<WriteResults>([
      ...writeArgs("offline-model", "custom"),
      "--model",
      "offline-alias"
    ])

    expect(result.ok).toBe(true)
    expect(result.warnings).toContain(
      "live models unavailable (no-base-url); model existence was not validated"
    )
  })

  it.each([
    ["gpt", "yellow", "gpt"],
    ["grok", "red", "grok"],
    ["claude", "blue", "claude"],
    ["none", "blue", undefined]
  ] as const)("--vendor %s が overlay 用 marker と色を選ぶ", (vendor, color, marker) => {
    const name = `vendor-${vendor}`
    const result = run<WriteResults>([
      ...writeArgs(name, "custom"),
      "--vendor",
      vendor
    ])

    expect(result.ok).toBe(true)
    const content = fs.readFileSync(
      path.join(project, ".claude", "agents", `${name}.md`),
      "utf8"
    )
    expect(content).toMatch(new RegExp(`^color: ${color}$`, "m"))
    if (marker === undefined) {
      expect(content).not.toContain("agent-policy-vendor:")
    } else {
      expect(content).toMatch(
        new RegExp(`^agent-policy-vendor: ${marker}$`, "m")
      )
    }
  })

  it("--vendor gemini は拒否される", () => {
    const result = run<WriteResults>([
      ...writeArgs("vendor-invalid", "custom"),
      "--vendor",
      "gemini"
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe("vendor: must be gpt, grok, claude or none")
  })

  it("推定 vendor が unknown で省略されたとき拒否する", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "unknown-vendor-model", owned_by: "other" }]
      })
    })

    const result = await runAsync<WriteResults>(
      [
        ...writeArgs("unknown-vendor", "custom"),
        "--model",
        "unknown-vendor-model"
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain("--vendor")
  })
})
