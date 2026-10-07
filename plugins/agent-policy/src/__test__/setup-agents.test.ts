import { execFile } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { textHash } from "../agents/hash"
import {
  ASSIGNMENTS,
  candidateScopeFor,
  MODELS,
  RECOMMENDED
} from "../agents/policies"
import { ROLES } from "../agents/roles"
import {
  type FakeModelsResponse,
  type FakeModelsServer,
  startFakeModelsServer
} from "../testing/fake-models-server"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../setup-agents.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const FAKE_CLAUDE = fileURLToPath(
  new URL("../testing/fake-claude.mjs", import.meta.url)
)
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const execFileAsync = promisify(execFile)

let project: string
let modelsServer: FakeModelsServer | undefined

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
  fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true })
})

afterEach(async () => {
  await modelsServer?.close()
  modelsServer = undefined
  fs.rmSync(project, { recursive: true, force: true })
})

// CLI が stdout へ書く JSON。実行時にはエラー系で一部フィールドが欠けるが、
// 各テストは自分が検証するフィールドしか触らないため非 optional で受ける。
interface RolesSummary {
  ids: string[]
  implRoles: string[]
  readonlyRoles: string[]
  mixedKinds: boolean
}

interface Discarded {
  frontmatterKeys: string[]
  preamble: boolean
  sections: string[]
}

type TextState = "same" | "templateChanged" | "userEdited" | "unknown"

interface CheckResult {
  ok: boolean
  error: string
  target: string
  exists: boolean
  identical: boolean
  preambleChanged: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
  roles: RolesSummary
  description: TextState | null
  preamble: TextState | null
  preambleTexts: { existing: string; template: string } | null
  toolsBefore: string[]
  toolsAfter: string[]
  action: string
  kept: string[]
  keptNeedsReview: string[]
  discarded: Discarded
}

interface WriteResults {
  ok: boolean
  error?: string
  warnings: string[]
  results: {
    modelId: string
    roleId?: string
    target: string
    action?: string
    kept?: string[]
    roles: RolesSummary
    mcpCurrent: { servers: string[]; denyTools: string[] }
    mcpDropped: string[]
  }[]
}

interface ListedRole {
  id: string
  label: string
  kind: "impl" | "readonly"
  tools: string[]
  source: "plugin" | "project"
  languageMismatch?: boolean
}

interface ListRolesResult {
  ok: boolean
  error?: string
  roles: ListedRole[]
}

interface CoverageResult {
  ok: boolean
  error?: string
  roles: {
    id: string
    label: string
    kind: "impl" | "readonly"
    defaultName: string
    models: string[]
    candidates: { modelId: string; model: string; recommended: boolean }[]
    coveredBy: string[]
  }[]
  uncovered: string[]
  definitions: CoverageDefinition[]
  liveOk: boolean
}

interface CoverageDefinition {
  name: string
  file: string
  model: string | null
  modelId: string | null
  vendor: string | null
  roles: string[]
  retiredRoles: { id: string; replacement: string | null }[]
  unknownRoles: string[]
  disallowedTools: string[]
  toolsFormat: "csv" | "other" | "none"
}

interface EditResult {
  ok: boolean
  error?: string
  target: string
  changed: boolean
  warnings: string[]
}

interface LiveModelsResult {
  ok: boolean
  reason?: string
  models: {
    id: string
    vendor: "gpt" | "grok" | "claude" | "unknown"
    recommendedFor: string[]
  }[]
  claudeEnums: string[]
}

interface FragmentStatusResult {
  ok: boolean
  missing: string[]
  stale: { id: string }[]
  targetDir: string | null
  written?: string[]
}

// このプラグイン自身が利用者へ案内する設定。開発者の環境に入っていると
// 既定値を前提としたアサーションが落ちるため、子プロセスへは渡さない。
// 値を要るテストは run() の第 2 引数で明示する。
const AMBIENT_ENV_VARS = [
  "AMATSUKA_AGENT_AUTO_INJECTION",
  "AMATSUKA_AGENT_GPT_SOL_ALIAS",
  "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
  "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
  "AMATSUKA_AGENT_GROK_ALIAS",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY"
]

function inheritedTestEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const variable of AMBIENT_ENV_VARS) delete env[variable]
  return env
}

function run<T = CheckResult>(args: string[], env: NodeJS.ProcessEnv = {}): T {
  let output: string
  try {
    output = runTs(CLI, args, {
      env: { ...inheritedTestEnv(), ...env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
    })
  } catch (error) {
    // CLI はエラー時も JSON を stdout へ書いてから終了コード 1 で終わる。
    // runTs(execFileSync)は非ゼロ終了で例外を投げるため、stdout を取り出す。
    const stdout = (error as { stdout?: string }).stdout
    if (stdout === undefined || stdout === "") throw error
    output = stdout
  }
  return JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as T
}

async function runAsync<T = CheckResult>(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<T> {
  let output: string
  try {
    const result = await execFileAsync(
      process.execPath,
      [TSX_CLI, CLI, ...args],
      {
        encoding: "utf8",
        env: { ...inheritedTestEnv(), ...env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
      }
    )
    output = result.stdout
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout
    if (stdout === undefined || stdout === "") throw error
    output = stdout
  }
  return JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as T
}

async function startModelsServer(
  response: FakeModelsResponse = {}
): Promise<FakeModelsServer> {
  modelsServer = await startFakeModelsServer(response)
  return modelsServer
}

function runWithMcp<T>(args: string[], listOutput: string): T {
  return run<T>(args, {
    AGENT_POLICY_CLAUDE_BIN: FAKE_CLAUDE,
    AGENT_POLICY_FAKE_MCP: listOutput
  })
}

function singleResult<T>(args: string[]): T {
  const response = run<{ ok: boolean; error?: string; results: T[] }>(args)
  const result = response.results[0]
  if (result === undefined) {
    throw new Error(response.error ?? "setup returned no result")
  }
  return result
}

function check(scope: "claude" | "custom", extra: string[] = []): CheckResult {
  return singleResult([
    "--scope",
    scope,
    "--model-id",
    "gpt-sol",
    "--name",
    "gpt-sol",
    "--roles",
    "complex-impl",
    "--lang",
    "ja",
    "--dir",
    project,
    "--check",
    ...extra
  ])
}

function target(): string {
  return path.join(project, ".claude", "agents", "gpt-sol.md")
}

function writeProjectRole(options: {
  id: string
  label?: string
  kind?: "impl" | "readonly"
  tools?: string
}): void {
  const roles = path.join(project, ".claude", "agent-policy", "roles")
  fs.mkdirSync(roles, { recursive: true })
  fs.writeFileSync(
    path.join(roles, `${options.id}.md`),
    [
      "---",
      `id: ${options.id}`,
      `label: ${options.label ?? options.id}`,
      `description: ${options.id} の作業`,
      `tools: ${options.tools ?? "Read, Grep, Glob"}`,
      `kind: ${options.kind ?? "readonly"}`,
      "---",
      "",
      "## When to invoke",
      "",
      `- **${options.id}。** ${options.id} の作業をするとき。`,
      ""
    ].join("\n")
  )
}

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

function writeAgent(file: string, lines: string[]): string {
  const target = path.join(project, ".claude", "agents", file)
  fs.writeFileSync(target, lines.join("\n"))
  return target
}

function coverage(extra: string[] = []): CoverageResult {
  return run<CoverageResult>([
    "--list-coverage",
    "--lang",
    "ja",
    "--dir",
    project,
    ...extra
  ])
}

function definitionOf(
  result: CoverageResult,
  name: string
): CoverageDefinition | undefined {
  return result.definitions.find((definition) => definition.name === name)
}

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

const EDIT_SOURCE = [
  "---",
  "name: target",
  "# 手で足したコメント",
  "description: 点検の対象",
  "",
  "model: opus",
  "tools: Read, Agent, Grep, WebFetch",
  "agent-policy-role: code-review, final-review",
  "---",
  "",
  "本文",
  "",
  "## 見出し",
  "",
  "- 項目",
  ""
].join("\n")

function readAgent(file: string): string {
  return fs.readFileSync(path.join(project, ".claude", "agents", file), "utf8")
}

describe("--prune-tools", () => {
  it("指定したツールだけを外し、他の行はバイト単位で変えない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent,Missing",
      "--dir",
      project
    ])

    expect(result).toMatchObject({
      ok: true,
      target: ".claude/agents/target.md",
      changed: true
    })
    expect(result.warnings.some((warning) => warning.includes("Missing"))).toBe(
      true
    )
    expect(readAgent("target.md")).toBe(
      EDIT_SOURCE.replace(
        "tools: Read, Agent, Grep, WebFetch",
        "tools: Read, Grep, WebFetch"
      )
    )
  })

  it("応答に tools 行の変更前と変更後を返す", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<
      EditResult & { toolsBefore: string[]; toolsAfter: string[] }
    >([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.toolsBefore).toEqual(["Read", "Agent", "Grep", "WebFetch"])
    expect(result.toolsAfter).toEqual(["Read", "Grep", "WebFetch"])
  })

  it("行に無いツールだけを指定したときは書き換えない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Missing",
      "--dir",
      project
    ])

    expect(result).toMatchObject({ ok: true, changed: false })
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })

  it.each([
    ["block 配列", ["tools:", "  - Read", "  - Agent"]],
    ["flow 配列", ["tools: [Read, Agent]"]],
    ["引用符付き", ['tools: "Read", "Agent"']]
  ])("%s の tools は未対応の書式として書き込まない", (_label, toolLines) => {
    const source = [
      "---",
      "name: target",
      ...toolLines,
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toContain("未対応の書式")
    expect(readAgent("target.md")).toBe(source)
  })

  it('--tools "*" は tools 欄の無い定義に許可集合の 1 行を name 行の直後へ足す', () => {
    const source = [
      "---",
      "name: target",
      "description: 探索",
      "agent-policy-role: explore",
      "---",
      "",
      "本文",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "*",
      "--dir",
      project
    ])

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(readAgent("target.md")).toBe(
      source.replace(
        "name: target\n",
        "name: target\ntools: Read, Grep, Glob, Bash\n"
      )
    )
  })

  it('roles が空の定義への --tools "*" は書き込まない', () => {
    const source = [
      "---",
      "name: target",
      "agent-policy-role: final-review",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "*",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("tools 行の無い定義から個別のツールは外せない", () => {
    const source = [
      "---",
      "name: target",
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("--scope と --lang は受け付けない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    for (const extra of [
      ["--scope", "claude"],
      ["--lang", "ja"]
    ]) {
      const result = run<EditResult>([
        "--prune-tools",
        "--name",
        "target",
        "--tools",
        "Agent",
        "--dir",
        project,
        ...extra
      ])
      expect(result.ok).toBe(false)
      expect(result.error).toContain(extra[0])
    }
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })
})

describe("--rewrite-roles", () => {
  it("agent-policy-role 行だけを指定の並びに置き換える", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "code-review",
      "--dir",
      project
    ])

    expect(result).toMatchObject({
      ok: true,
      target: ".claude/agents/target.md",
      changed: true
    })
    expect(readAgent("target.md")).toBe(
      EDIT_SOURCE.replace(
        "agent-policy-role: code-review, final-review",
        "agent-policy-role: code-review"
      )
    )
  })

  it("空の --roles で agent-policy-role 行を消す", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "",
      "--dir",
      project
    ])

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(readAgent("target.md")).toBe(
      EDIT_SOURCE.replace("agent-policy-role: code-review, final-review\n", "")
    )
  })

  it("プロジェクト独自の役割断片で解決できる ID を受け付ける", () => {
    writeProjectRole({ id: "triage" })
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "triage,code-review",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(readAgent("target.md")).toContain(
      "agent-policy-role: triage, code-review\n"
    )
  })

  it.each([
    ["廃止済み ID", "code-review,final-review"],
    ["未知の ID", "no-such-role"]
  ])("%s を含むときは書き込まない", (_label, roles) => {
    writeProjectRole({ id: "final-review", label: "最終レビュー" })
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      roles,
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })

  it("agent-policy-role 行の無い定義には書き込まない", () => {
    const source = ["---", "name: target", "tools: Read", "---", ""].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "explore",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })
})

describe("既存定義の行単位操作に共通する規則", () => {
  it.each([
    ["--prune-tools", ["--tools", "Agent"]],
    ["--rewrite-roles", ["--roles", "explore"]]
  ])("%s は対象ファイルが無いとき失敗する", (flag, extra) => {
    const result = run<EditResult>([
      flag,
      "--name",
      "missing",
      ...extra,
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(
      fs.existsSync(path.join(project, ".claude", "agents", "missing.md"))
    ).toBe(false)
  })

  it.each([
    ["--prune-tools", ["--tools", "Agent"]],
    ["--rewrite-roles", ["--roles", "explore"]]
  ])("%s は frontmatter の無いファイルに書き込まない", (flag, extra) => {
    writeAgent("target.md", ["本文だけ", ""])

    const result = run<EditResult>([
      flag,
      "--name",
      "target",
      ...extra,
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe("本文だけ\n")
  })

  it("2 つの操作は併用できない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--prune-tools",
      "--rewrite-roles",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--roles",
      "explore",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })
})

describe("点検と行単位操作の境界", () => {
  function prune(name: string, tools: string): EditResult {
    return run<EditResult>([
      "--prune-tools",
      "--name",
      name,
      "--tools",
      tools,
      "--dir",
      project
    ])
  }

  it("末尾に改行の無いファイルでも、他の行をバイト単位で保つ", () => {
    const source = EDIT_SOURCE.trimEnd()
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(true)
    expect(readAgent("target.md")).toBe(
      source.replace("Read, Agent, Grep", "Read, Grep")
    )
  })

  it("改行が CRLF の定義は、CRLF の可能性を示して書き込まない", () => {
    const source = EDIT_SOURCE.replace(/\n/g, "\r\n")
    writeAgent("target.md", [source])

    const result = prune("target", "Agent")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("CRLF")
    expect(readAgent("target.md")).toBe(source)
  })

  it("frontmatter に同じキーが 2 行あるときは、両操作とも書き込まず点検では other にする", () => {
    const source = [
      "---",
      "name: target",
      "tools: Read, Agent",
      "tools: Read, Grep",
      "agent-policy-role: explore",
      "agent-policy-role: code-review",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(false)
    expect(
      run<EditResult>([
        "--rewrite-roles",
        "--name",
        "target",
        "--roles",
        "explore",
        "--dir",
        project
      ]).ok
    ).toBe(false)
    expect(readAgent("target.md")).toBe(source)
    expect(definitionOf(coverage(), "target")?.toolsFormat).toBe("other")
  })

  it("字下げ付きの tools キーは点検で other にし、書き換えない", () => {
    const source = [
      "---",
      "name: target",
      "  tools: Read, Agent",
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(definitionOf(coverage(), "target")?.toolsFormat).toBe("other")
    expect(prune("target", "Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("本文中の tools: 行は書き換えない", () => {
    const source = [
      "---",
      "name: target",
      "tools: Read, Agent",
      "agent-policy-role: explore",
      "---",
      "",
      "tools: Read, Agent",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(true)
    expect(readAgent("target.md")).toBe(
      source.replace("tools: Read, Agent\nagent", "tools: Read\nagent")
    )
  })

  it("tools が Agent だけの定義からは Agent を外さない", () => {
    const source = [
      "---",
      "name: target",
      "tools: Agent",
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it('tools 欄がある定義への --tools "*" と、"*" と他ツールの併用を拒む', () => {
    writeAgent("target.md", [EDIT_SOURCE])

    expect(prune("target", "*").ok).toBe(false)
    expect(prune("target", "*,Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })

  it.each([
    ["括弧を含むトークン", "tools: Read, Bash(git status, git diff), Agent"],
    ["# を含む値", "tools: Read, Agent # 後で消す"],
    ["値が空で block も続かない", "tools:"]
  ])("%s の tools は other とし、書き換えない", (_label, toolsLine) => {
    const source = [
      "---",
      "name: target",
      toolsLine,
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(definitionOf(coverage(), "target")?.toolsFormat).toBe("other")
    expect(prune("target", "Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("廃止済みでも解決可能でもない ID を unknownRoles に載せる", () => {
    writeAgent("target.md", [
      "---",
      "name: target",
      "tools: Read",
      "agent-policy-role: explore, final-review, no-such-role",
      "---",
      ""
    ])

    expect(definitionOf(coverage(), "target")).toMatchObject({
      roles: ["explore"],
      retiredRoles: [{ id: "final-review", replacement: "complex-review" }],
      unknownRoles: ["no-such-role"]
    })
  })

  it("kind の無い旧形式の final-review.md が残っていても --list-coverage が成功する", () => {
    const roles = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(roles, { recursive: true })
    fs.writeFileSync(
      path.join(roles, "final-review.md"),
      ["---", "id: final-review", "label: 最終レビュー", "---", ""].join("\n")
    )

    expect(coverage().ok).toBe(true)
  })

  it("--list-roles に廃止済み ID の断片を載せない", () => {
    writeProjectRole({ id: "final-review", label: "最終レビュー" })

    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.roles.map((role) => role.id)).not.toContain("final-review")
  })

  it("--rewrite-roles と --tools は併用できない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "code-review",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toContain("--tools")
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })
})

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

describe("description と前置きの保持", () => {
  const KEEPER = path.join(".claude", "agents", "keeper.md")

  function keeper(
    extra: string[] = [],
    mode: "--write" | "--check" = "--write"
  ) {
    return singleResult<CheckResult>([
      mode,
      "--model-id",
      "opus",
      "--name",
      "keeper",
      "--roles",
      "code-review",
      "--scope",
      "claude",
      "--lang",
      "ja",
      "--dir",
      project,
      ...extra
    ])
  }

  function content(): string {
    return fs.readFileSync(path.join(project, KEEPER), "utf8")
  }

  function edit(transform: (text: string) => string): void {
    fs.writeFileSync(path.join(project, KEEPER), transform(content()))
  }

  function metaValue(key: string): string | undefined {
    return content().match(new RegExp(`^${key}: (.*)$`, "m"))?.[1]
  }

  const addPreamble = (text: string) =>
    text.replace(/\n---\n\n/, "\n---\n\n利用者が足した前置き。\n\n")

  it("新規生成で 2 つのハッシュを書き、直後の --check は same を返す", () => {
    keeper()

    expect(metaValue("agent-policy-description-hash")).toMatch(/^[0-9a-f]{16}$/)
    expect(metaValue("agent-policy-preamble-hash")).toMatch(/^[0-9a-f]{16}$/)
    expect(keeper([], "--check")).toMatchObject({
      description: "same",
      preamble: "same"
    })
  })

  it("利用者が編集した description は userEdited になり、--merge で保持して記録も残す", () => {
    keeper()
    const record = metaValue("agent-policy-description-hash")
    edit((text) =>
      text.replace(/^description: .*$/m, "description: 利用者の説明")
    )

    expect(keeper([], "--check").description).toBe("userEdited")
    const result = keeper(["--merge"])

    expect(metaValue("description")).toBe("利用者の説明")
    expect(metaValue("agent-policy-description-hash")).toBe(record)
    expect(result.discarded.frontmatterKeys).not.toContain("description")
  })

  it("記録と一致する旧い description は templateChanged になり、--merge の既定では保持する", () => {
    keeper()
    const oldRecord = textHash("旧い説明")
    edit((text) =>
      text
        .replace(/^description: .*$/m, "description: 旧い説明")
        .replace(
          /^agent-policy-description-hash: .*$/m,
          `agent-policy-description-hash: ${oldRecord}`
        )
    )

    expect(keeper([], "--check").description).toBe("templateChanged")
    keeper(["--merge"])

    expect(metaValue("description")).toBe("旧い説明")
    expect(metaValue("agent-policy-description-hash")).toBe(oldRecord)
  })

  it("--replace で指定したものだけテンプレートに置き換え、新しい記録を書く", () => {
    keeper()
    const template = metaValue("description")
    const templateRecord = metaValue("agent-policy-description-hash")
    edit((text) =>
      addPreamble(text)
        .replace(/^description: .*$/m, "description: 旧い説明")
        .replace(
          /^agent-policy-description-hash: .*$/m,
          `agent-policy-description-hash: ${textHash("旧い説明")}`
        )
    )

    keeper(["--merge", "--replace", "description"])

    expect(metaValue("description")).toBe(template)
    expect(metaValue("agent-policy-description-hash")).toBe(templateRecord)
    expect(content()).toContain("利用者が足した前置き。")
  })

  it("記録の無い既存の前置きは unknown になり、保持しても記録を書かない", () => {
    keeper()
    edit((text) =>
      addPreamble(text).replace(/^agent-policy-preamble-hash: .*\n/m, "")
    )

    const checked = keeper([], "--check")
    expect(checked.preamble).toBe("unknown")
    expect(checked.preambleTexts?.existing).toContain("利用者が足した前置き。")
    expect(checked.preambleTexts?.template).not.toContain(
      "利用者が足した前置き。"
    )
    const result = keeper(["--merge"])

    expect(content()).toContain("利用者が足した前置き。")
    expect(metaValue("agent-policy-preamble-hash")).toBeUndefined()
    expect(result.discarded.preamble).toBe(false)
  })

  it("--replace preamble で前置きを置き換え、記録を書く", () => {
    keeper()
    const record = metaValue("agent-policy-preamble-hash")
    edit((text) =>
      addPreamble(text).replace(/^agent-policy-preamble-hash: .*\n/m, "")
    )

    keeper(["--merge", "--replace", "preamble"])

    expect(content()).not.toContain("利用者が足した前置き。")
    expect(metaValue("agent-policy-preamble-hash")).toBe(record)
  })

  it("--write は tools 行の変更前と変更後を返し、前置きが same なら preambleTexts は null", () => {
    keeper()
    edit((text) =>
      text.replace(/^tools: (.*)$/m, "tools: $1, Agent, mcp__gone")
    )

    const result = keeper(["--merge"])

    expect(result.toolsBefore).toEqual(
      expect.arrayContaining(["Agent", "mcp__gone"])
    )
    expect(result.toolsAfter).toContain("Agent")
    expect(result.toolsAfter).not.toContain("mcp__gone")
    expect(result.preambleTexts).toBeNull()
  })

  it("--replace は --merge なし・--recommended・未知の値で拒否する", () => {
    for (const args of [
      ["--write", "--replace", "description"],
      ["--write", "--merge", "--replace", "summary"]
    ]) {
      const result = run<{ ok: boolean }>([
        ...args,
        "--model-id",
        "opus",
        "--name",
        "keeper",
        "--roles",
        "code-review",
        "--scope",
        "claude",
        "--dir",
        project
      ])
      expect(result.ok).toBe(false)
    }
    expect(
      run<{ ok: boolean }>([
        "--write",
        "--merge",
        "--recommended",
        "--replace",
        "description",
        "--scope",
        "claude",
        "--dir",
        project
      ]).ok
    ).toBe(false)
  })
})

describe("--list-roles", () => {
  it("組み込み役割を担当表で絞らずすべて返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.roles.map((role) => role.id)).toEqual([
      "complex-impl",
      "normal-impl",
      "light-impl",
      "escalation",
      "general",
      "explore",
      "realtime-research",
      "e2e-verify",
      "design-review",
      "knowledge-elicitation",
      "code-review",
      "complex-review",
      "adversarial-review"
    ])
    expect(result.roles.every((role) => role.source === "plugin")).toBe(true)
  })

  it("プロジェクト固有 ID を組み込み役割の末尾へ並べる", () => {
    writeProjectRole({ id: "triage" })

    const result = run<ListRolesResult>(["--list-roles", "--dir", project])

    expect(result.roles.at(-1)).toMatchObject({
      id: "triage",
      kind: "readonly",
      source: "project"
    })
  })

  it("同じ ID のプロジェクト断片で source と内容を置き換える", () => {
    writeProjectRole({
      id: "explore",
      label: "独自探索",
      kind: "impl",
      tools: "Read, Write"
    })

    const result = run<ListRolesResult>(["--list-roles", "--dir", project])
    const explore = result.roles.find((role) => role.id === "explore")

    expect(explore).toEqual({
      id: "explore",
      label: "独自探索",
      kind: "impl",
      tools: ["Read", "Write"],
      source: "project",
      languageMismatch: false
    })
  })

  it("id と label の両方を返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    const light = result.roles.find((role) => role.id === "light-impl")

    expect(light?.label).toBe("軽量な実装")
    expect(light?.kind).toBe("impl")
  })

  it("プロジェクト独自役割の言語不一致を示す", () => {
    writeProjectRole({ id: "triage" })

    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "de",
      "--dir",
      project
    ])
    const triage = result.roles.find((role) => role.id === "triage")

    expect(triage?.languageMismatch).toBe(true)
  })
})

describe("--check-fragments", () => {
  it("ja では missing が空で targetDir が null", () => {
    const result = run<FragmentStatusResult>([
      "--check-fragments",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.targetDir).toBeNull()
  })

  it("未翻訳の言語では missing が返る", () => {
    const result = run<FragmentStatusResult>([
      "--check-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    expect(result.missing).toContain("explore")
  })
})

describe("--scaffold-fragments", () => {
  it("翻訳先へひな形を書き、書いたパスを返す", () => {
    const result = run<FragmentStatusResult>([
      "--scaffold-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.written?.length).toBeGreaterThan(0)
    expect(result.written?.[0]).toMatch(/^\.claude\/agent-policy\/roles\/de\//)
  })
})

describe("--check", () => {
  it("既存が無いとき exists: false を返す", () => {
    const result = check("custom")
    expect(result.ok).toBe(true)
    expect(result.exists).toBe(false)
  })

  it("既存がテンプレートと同一のとき identical: true を返す", () => {
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
    const result = check("custom")
    expect(result.exists).toBe(true)
    expect(result.identical).toBe(true)
  })

  it("既存にしかない tools を toolsOnlyInExisting に出す", () => {
    seed("custom", {
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    const result = check("custom")
    expect(result.frontmatter.toolsOnlyInExisting).toContain("mcp__context7")
  })

  it("既存にしかない frontmatter キーを keysOnlyInExisting に出す", () => {
    seed("custom", { extraKeys: { permissionMode: "plan" } })
    const result = check("custom")
    expect(result.frontmatter.keysOnlyInExisting).toContain("permissionMode")
  })

  it("値の違う共通キーを changed に出す", () => {
    seed("custom", { model: "my-own-alias" })
    const entry = check("custom").frontmatter.changed.find(
      (item) => item.key === "model"
    )
    expect(entry?.existing).toBe("my-own-alias")
    expect(entry?.template).toBe("claude-gpt-6-1-sol")
  })

  it("既存にしかない節を sectionsOnlyInExisting に出す", () => {
    seed("custom", { extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const result = check("custom")
    expect(result.body.sectionsOnlyInExisting).toContain("## ツール運用")
  })

  it("冒頭宣言の変更を preambleChanged に出す", () => {
    seed("custom", { preamble: "あなたは私が書き換えた冒頭である。" })
    const result = check("custom")
    expect(result.preambleChanged).toBe(true)
  })

  it("節の中身の変更を sectionsChanged に出す", () => {
    seed("custom", { replaceConstraints: "- 私が書き換えた制約。\n" })
    const result = check("custom")
    expect(result.body.sectionsChanged).toContain("## 制約")
  })

  it("実装役割だけなら roles.mixedKinds が false になる", () => {
    expect(check("custom").roles).toEqual({
      ids: ["complex-impl"],
      implRoles: ["complex-impl"],
      readonlyRoles: [],
      mixedKinds: false
    })
  })

  it("実装役割と読み取り役割を分類して混在を示す", () => {
    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-terra",
      "--name",
      "gpt-terra",
      "--roles",
      "explore,normal-impl,design-review",
      "--lang",
      "ja",
      "--dir",
      project,
      "--check"
    ])

    expect(result.roles).toEqual({
      ids: ["normal-impl", "explore", "design-review"],
      implRoles: ["normal-impl"],
      readonlyRoles: ["explore", "design-review"],
      mixedKinds: true
    })
  })

  it("生成した定義の tools に Agent を含めない", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol-code-review",
      "--roles",
      "code-review",
      "--lang",
      "ja",
      "--dir",
      project,
      "--write"
    ])
    expect(result.ok).toBe(true)

    const content = fs.readFileSync(
      path.join(project, ".claude", "agents", "gpt-sol-code-review.md"),
      "utf8"
    )
    const tools = content.match(/^tools: (.*)$/m)?.[1]?.split(", ") ?? []
    expect(tools).not.toContain("Agent")
  })

  it("frontmatter が無い既存ファイルを全体が本文の文書として扱う", () => {
    fs.writeFileSync(target(), "独自の冒頭。\n\n## 独自節\n\n- 独自の内容。\n")

    const result = check("custom")

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.preambleChanged).toBe(true)
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("閉じていない frontmatter も全体を本文として扱う", () => {
    fs.writeFileSync(target(), "---\nname: broken\n\n## 独自節\n\n- 内容。\n")

    const result = check("custom")

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("不正な役割 ID でエラーを返す", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "x",
      "--roles",
      "no-such-role",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("no-such-role")
  })

  it("model-id の欠落でエラーを返す", () => {
    const result = run([
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("model")
  })

  it("翻訳断片が不完全な言語を拒否する", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--lang",
      "de",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toMatch(/^fragments:/)
  })
})

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

// テンプレートを生成してから指定箇所を書き換え、既存ファイルとして置く。
function seed(
  scope: "claude" | "custom",
  options: {
    tools?: string
    model?: string
    extraKeys?: Record<string, string>
    extraSection?: string
    preamble?: string
    replaceConstraints?: string
  }
): void {
  run([
    "--scope",
    scope,
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
  let content = fs.readFileSync(target(), "utf8")

  if (options.tools !== undefined) {
    content = content.replace(/^tools: .*$/m, `tools: ${options.tools}`)
  }
  if (options.model !== undefined) {
    content = content.replace(/^model: .*$/m, `model: ${options.model}`)
  }
  for (const [key, value] of Object.entries(options.extraKeys ?? {})) {
    content = content
      .replace(/^---$/m, "---")
      .replace(/^(name: .*)$/m, `$1\n${key}: ${value}`)
  }
  if (options.extraSection !== undefined) {
    content = `${content}\n${options.extraSection}`
  }
  if (options.preamble !== undefined) {
    content = content.replace(/あなたは gpt-sol。[^\n]*/, options.preamble)
  }
  if (options.replaceConstraints !== undefined) {
    content = content.replace(
      /## 制約\n\n[\s\S]*?(?=\n## )/,
      `## 制約\n\n${options.replaceConstraints}`
    )
  }

  fs.writeFileSync(target(), content)
}

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
    expect(fs.readFileSync(file, "utf8")).toMatch(
      /^model: .+\neffort: medium$/m
    )
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
      general: "medium",
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
