import { execFile } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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
  agentTool: boolean
}

interface Discarded {
  frontmatterKeys: string[]
  preamble: boolean
  sections: string[]
}

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
  action: string
  kept: string[]
  keptNeedsReview: string[]
  discarded: Discarded
}

interface WriteResults {
  ok: boolean
  error?: string
  warnings: string[]
  modelsDropped: string[]
  results: {
    modelId: string
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
    defaultName: string
    models: string[]
    coveredBy: string[]
  }[]
  uncovered: string[]
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

function check(extra: string[] = []): CheckResult {
  return singleResult([
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
    [["--list-models"], "--list-models"]
  ])("%s を廃止済みとして拒否する", (args, flag) => {
    const result = run<{ ok: boolean; error: string }>(args)

    expect(result.ok).toBe(false)
    expect(result.error).toContain(flag)
    expect(result.error).toMatch(/removed|廃止/i)
  })
})

describe("--list-live-models", () => {
  it("live models と Claude enum を推奨役割付きで返す", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [
          { id: "claude-gpt-5-6-sol", owned_by: "openai" },
          { id: "custom-unknown", owned_by: "other" }
        ]
      })
    })

    const result = await runAsync<LiveModelsResult>(["--list-live-models"], {
      ANTHROPIC_BASE_URL: proxy.baseUrl
    })

    expect(result).toEqual({
      ok: true,
      models: [
        {
          id: "claude-gpt-5-6-sol",
          vendor: "gpt",
          recommendedFor: ["complex-impl"]
        },
        { id: "custom-unknown", vendor: "unknown", recommendedFor: [] }
      ],
      claudeEnums: ["sonnet", "opus", "haiku", "fable"]
    })
  })

  it("照会失敗時も reason と Claude enum を返す", async () => {
    const proxy = await startModelsServer({ status: 503 })

    const result = await runAsync<LiveModelsResult>(["--list-live-models"], {
      ANTHROPIC_BASE_URL: proxy.baseUrl
    })

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
    expect(result.roles).toHaveLength(10)
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
      "--lang",
      "en",
      "--dir",
      project
    ])

    expect(result.roles.find((role) => role.id === "advisor")?.models).toEqual([
      "fable",
      "opus"
    ])
    expect(
      result.roles.every(
        (role) =>
          typeof role.defaultName === "string" && role.defaultName !== ""
      )
    ).toBe(true)
  })

  it("RECOMMENDED の帯集合とモデル割当を返す", () => {
    const result = run<CoverageResult>(["--list-coverage", "--dir", project])

    expect(result.roles).toHaveLength(10)
    expect(
      result.roles.find((role) => role.id === "complex-impl")?.models
    ).toEqual(["gpt-sol"])
    expect(result.roles.find((role) => role.id === "advisor")?.models).toEqual([
      "fable",
      "opus"
    ])
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
      result.roles.find((role) => role.id === "advisor")?.defaultName
    ).toBe("adviser")
    expect(
      result.roles.every(
        (role) =>
          typeof role.defaultName === "string" && role.defaultName !== ""
      )
    ).toBe(true)
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
      "general",
      "explore",
      "realtime-research",
      "independent-review",
      "doc-review",
      "code-review",
      "advisor"
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
    const result = check()
    expect(result.ok).toBe(true)
    expect(result.exists).toBe(false)
  })

  it("既存がテンプレートと同一のとき identical: true を返す", () => {
    run([
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
    const result = check()
    expect(result.exists).toBe(true)
    expect(result.identical).toBe(true)
  })

  it("既存にしかない tools を toolsOnlyInExisting に出す", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    const result = check()
    expect(result.frontmatter.toolsOnlyInExisting).toContain("mcp__context7")
  })

  it("既存にしかない frontmatter キーを keysOnlyInExisting に出す", () => {
    seed({ extraKeys: { permissionMode: "plan" } })
    const result = check()
    expect(result.frontmatter.keysOnlyInExisting).toContain("permissionMode")
  })

  it("値の違う共通キーを changed に出す", () => {
    seed({ model: "my-own-alias" })
    const entry = check().frontmatter.changed.find(
      (item) => item.key === "model"
    )
    expect(entry?.existing).toBe("my-own-alias")
    expect(entry?.template).toBe("claude-gpt-5-6-sol")
  })

  it("既存にしかない節を sectionsOnlyInExisting に出す", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const result = check()
    expect(result.body.sectionsOnlyInExisting).toContain("## ツール運用")
  })

  it("冒頭宣言の変更を preambleChanged に出す", () => {
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    const result = check()
    expect(result.preambleChanged).toBe(true)
  })

  it("節の中身の変更を sectionsChanged に出す", () => {
    seed({ replaceConstraints: "- 私が書き換えた制約。\n" })
    const result = check()
    expect(result.body.sectionsChanged).toContain("## 制約")
  })

  it("実装役割だけなら roles.mixedKinds が false になる", () => {
    expect(check().roles).toEqual({
      ids: ["complex-impl"],
      implRoles: ["complex-impl"],
      readonlyRoles: [],
      mixedKinds: false,
      agentTool: true
    })
  })

  it("実装役割と読み取り役割を分類して混在を示す", () => {
    const result = singleResult<CheckResult>([
      "--model-id",
      "gpt-terra",
      "--name",
      "gpt-terra",
      "--roles",
      "explore,normal-impl,independent-review",
      "--lang",
      "ja",
      "--dir",
      project,
      "--check"
    ])

    expect(result.roles).toEqual({
      ids: ["normal-impl", "explore", "independent-review"],
      implRoles: ["normal-impl"],
      readonlyRoles: ["explore", "independent-review"],
      mixedKinds: true,
      agentTool: true
    })
  })

  it("Agent tool の可否を役割から返す", () => {
    const light = singleResult<CheckResult>([
      "--model-id",
      "gpt-luna",
      "--name",
      "gpt-luna",
      "--roles",
      "light-impl",
      "--lang",
      "ja",
      "--dir",
      project,
      "--check"
    ])
    expect(light.roles.agentTool).toBe(false)
    expect(check(["--roles", "complex-impl"]).roles.agentTool).toBe(true)
  })

  it("Agent tool の可否へ model-id を反映する", () => {
    const agentToolFor = (modelId: string, roles: string): boolean =>
      singleResult<CheckResult>([
        "--model-id",
        modelId,
        "--name",
        `${modelId}-agent-tool-check`,
        "--roles",
        roles,
        "--lang",
        "ja",
        "--dir",
        project,
        "--check"
      ]).roles.agentTool

    expect(agentToolFor("sonnet", "code-review")).toBe(true)
    expect(
      agentToolFor("grok", "explore,realtime-research,independent-review")
    ).toBe(true)
    expect(agentToolFor("grok", "light-impl")).toBe(false)
  })

  it("自由モデル値ではモデル制約を外して役割制約だけを使う", () => {
    const result = singleResult<CheckResult>([
      "--model-id",
      "gpt-luna",
      "--model",
      "custom-live-model",
      "--vendor",
      "gpt",
      "--name",
      "custom-model",
      "--roles",
      "complex-impl",
      "--lang",
      "ja",
      "--dir",
      project,
      "--check"
    ])

    expect(result.roles.agentTool).toBe(true)
  })

  it("frontmatter が無い既存ファイルを全体が本文の文書として扱う", () => {
    fs.writeFileSync(target(), "独自の冒頭。\n\n## 独自節\n\n- 独自の内容。\n")

    const result = check()

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.preambleChanged).toBe(true)
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("閉じていない frontmatter も全体を本文として扱う", () => {
    fs.writeFileSync(target(), "---\nname: broken\n\n## 独自節\n\n- 内容。\n")

    const result = check()

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("不正な役割 ID でエラーを返す", () => {
    const result = run([
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
    const result = check(["--roles", "complex-impl,complex-impl"])
    expect(result.roles.ids).toEqual(["complex-impl"])
  })
})

// テンプレートを生成してから指定箇所を書き換え、既存ファイルとして置く。
function seed(options: {
  tools?: string
  model?: string
  extraKeys?: Record<string, string>
  extraSection?: string
  preamble?: string
  replaceConstraints?: string
}): void {
  run([
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
  it("既存が無いときテンプレートどおりに書く", () => {
    const result = run([
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
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
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
    seed({
      model: "my-own-alias",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = singleResult<CheckResult>([
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
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
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
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    run([
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
    seed({ extraKeys: { permissionMode: "plan" } })
    run([
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
    seed({ model: "my-own-alias" })
    run([
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
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    run([
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
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, CustomTool",
      model: "my-own-alias",
      extraKeys: { permissionMode: "plan" },
      extraSection: "## 独自運用\n\n- 独自の運用。\n",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = singleResult<CheckResult>([
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
      "tools:CustomTool",
      "key:permissionMode",
      "section:## 独自運用"
    ])
    expect(result.discarded).toEqual({
      frontmatterKeys: ["model"],
      preamble: true,
      sections: ["## 制約"]
    })
    expect(content).toMatch(/^tools:.*CustomTool/m)
    expect(content).toContain("permissionMode: plan")
    expect(content).toContain("## 独自運用")
    expect(content).toContain("model: claude-gpt-5-6-sol")
    expect(content).not.toContain("あなたは私が書き換えた冒頭である。")
    expect(content).not.toContain("私が書き換えた制約")
  })

  it("--merge と明示 --keep を併用して変更済み項目も保持する", () => {
    seed({
      model: "my-own-alias",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = singleResult<CheckResult>([
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
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })

    const result = singleResult<CheckResult>([
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
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
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
    seed({})
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
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
    seed({})
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
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

  it("custom では全 ModelId を明示指定できる", () => {
    const result = run<WriteResults>([
      "--check",
      "--model-id",
      "grok",
      "--lang",
      "ja",
      "--name",
      "grok",
      "--roles",
      "explore",
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
  const writeArgs = (name: string): string[] => [
    "--write",
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
      [...writeArgs("live-sol-agent"), "--model", "live-sol"],
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
        ...writeArgs("missing-model"),
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
      ...writeArgs("offline-model"),
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
    const result = run<WriteResults>([...writeArgs(name), "--vendor", vendor])

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

  it("推定 vendor が unknown で省略されたとき拒否する", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "unknown-vendor-model", owned_by: "other" }]
      })
    })

    const result = await runAsync<WriteResults>(
      [...writeArgs("unknown-vendor"), "--model", "unknown-vendor-model"],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain("--vendor")
  })
})

describe("--models による推奨一括", () => {
  it("RECOMMENDED から既定役割を決める", () => {
    const result = run<WriteResults>([
      "--check",
      "--lang",
      "ja",
      "--models",
      "gpt-sol,gpt-terra",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.results.map((entry) => entry.modelId)).toEqual([
      "gpt-sol",
      "gpt-terra"
    ])
    expect(result.results[0]?.roles.ids).toEqual(["complex-impl"])
    expect(result.results[1]?.roles.ids).toEqual(["normal-impl", "general"])
  })

  it("照会成功時は不在モデルを間引いて報告する", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [{ id: "claude-gpt-5-6-sol", owned_by: "openai" }]
      })
    })

    const result = await runAsync<WriteResults>(
      [
        "--check",
        "--lang",
        "ja",
        "--models",
        "gpt-sol,gpt-terra,sonnet",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(true)
    expect(result.results.map((entry) => entry.modelId)).toEqual([
      "gpt-sol",
      "sonnet"
    ])
    expect(result.modelsDropped).toEqual(["gpt-terra"])
  })

  it("一部の vendor 推定に失敗したとき --models 全体を拒否する", async () => {
    const proxy = await startModelsServer({
      body: JSON.stringify({
        data: [
          { id: "claude-gpt-5-6-sol", owned_by: "openai" },
          { id: "claude-gpt-5-6-terra", owned_by: "unknown" }
        ]
      })
    })

    const result = await runAsync<WriteResults>(
      [
        "--check",
        "--lang",
        "ja",
        "--models",
        "gpt-sol,gpt-terra",
        "--dir",
        project
      ],
      { ANTHROPIC_BASE_URL: proxy.baseUrl }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBe(
      'vendor: could not infer vendor for model "claude-gpt-5-6-terra"; pass --vendor gpt|grok|claude|none'
    )
  })

  it("照会失敗時は全モデルを警告付きで生成対象に残す", () => {
    const result = run<WriteResults>([
      "--check",
      "--lang",
      "ja",
      "--models",
      "gpt-sol,gpt-terra",
      "--dir",
      project
    ])

    expect(result.results.map((entry) => entry.modelId)).toEqual([
      "gpt-sol",
      "gpt-terra"
    ])
    expect(result.modelsDropped).toEqual([])
    expect(result.warnings).toContain(
      "live models unavailable (no-base-url); model existence was not validated"
    )
  })

  it("単一役割モデルを役割ベースの既定ファイル名へ書く", () => {
    const result = run<WriteResults>([
      "--write",
      "--lang",
      "ja",
      "--models",
      "sonnet",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.results[0]?.target).toBe(
      ".claude/agents/sonnet-code-reviewer.md"
    )
    expect(
      fs.existsSync(
        path.join(project, ".claude", "agents", "sonnet-code-reviewer.md")
      )
    ).toBe(true)
  })

  it("--models と --merge を併用できる", () => {
    const result = run<WriteResults>([
      "--write",
      "--merge",
      "--lang",
      "ja",
      "--models",
      "haiku",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.results[0]?.action).toBe("written")
  })

  it("--models と --keep は併用できない", () => {
    const result = run<WriteResults>([
      "--write",
      "--lang",
      "ja",
      "--models",
      "haiku",
      "--keep",
      "preamble",
      "--dir",
      project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/keep/)
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
