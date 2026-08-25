import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../setup-agents.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const FAKE_CLAUDE = fileURLToPath(
  new URL("../testing/fake-claude.mjs", import.meta.url)
)

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
  fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true })
})

afterEach(() => {
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
  policy: string
  roles: {
    id: string
    label: string
    defaultName: string
    models: string[]
    coveredBy: string[]
  }[]
  uncovered: string[]
}

interface PolicyListResult {
  ok: boolean
  injected: string | null
  policies: { id: string; label: string; injection: string }[]
}

interface ModelListResult {
  ok: boolean
  error?: string
  models: {
    id: string
    label: string
    defaultName: string
    model: string
    vendor: string
    color: string
    roles: string[]
  }[]
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
  "AMATSUKA_AGENT_GROK_ALIAS"
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
    "--policy",
    "with-codex-policy",
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

describe("--list-policies", () => {
  it("4 方針を返す", () => {
    const result = run<PolicyListResult>(["--list-policies"])
    expect(result.policies.map((policy) => policy.id)).toEqual([
      "claude-model-policy",
      "with-codex-policy",
      "with-grok-policy",
      "codex-grok-policy"
    ])
  })

  it("AMATSUKA_AGENT_AUTO_INJECTION の値を添える", () => {
    const result = run<PolicyListResult>(["--list-policies"])
    expect(result.policies[0]?.injection).toBe("claude")
    expect(result.policies[3]?.injection).toBe("with-codex-grok")
  })

  it("AMATSUKA_AGENT_AUTO_INJECTION が未設定なら injected は null", () => {
    const result = run<PolicyListResult>(["--list-policies"])
    expect(result.injected).toBeNull()
  })

  it("AMATSUKA_AGENT_AUTO_INJECTION が解決するポリシー ID を injected に返す", () => {
    const result = run<PolicyListResult>(["--list-policies"], {
      AMATSUKA_AGENT_AUTO_INJECTION: "with-codex-grok"
    })
    expect(result.injected).toBe("codex-grok-policy")
  })

  // 未知値と none はどちらもフックが方針を注入しないケースであり、
  // CLAUDE.md への追記案内が要る側に倒す必要がある。
  it("AMATSUKA_AGENT_AUTO_INJECTION が未知の値なら injected は null", () => {
    const result = run<PolicyListResult>(["--list-policies"], {
      AMATSUKA_AGENT_AUTO_INJECTION: "bogus"
    })
    expect(result.injected).toBeNull()
  })

  it("AMATSUKA_AGENT_AUTO_INJECTION が none なら injected は null", () => {
    const result = run<PolicyListResult>(["--list-policies"], {
      AMATSUKA_AGENT_AUTO_INJECTION: "none"
    })
    expect(result.injected).toBeNull()
  })
})

describe("--list-models", () => {
  it("claude-model-policy は Claude 4 種を返す", () => {
    const result = run<ModelListResult>([
      "--list-models",
      "--policy",
      "claude-model-policy"
    ])
    expect(result.models.map((model) => model.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable"
    ])
  })

  it("各モデルに既定名と担える役割と色を添える", () => {
    const result = run<ModelListResult>([
      "--list-models",
      "--policy",
      "claude-model-policy"
    ])
    const sonnet = result.models.find((model) => model.id === "sonnet")
    expect(sonnet?.defaultName).toBe("claude-sonnet")
    expect(sonnet?.model).toBe("sonnet")
    expect(sonnet?.color).toBe("purple")
    expect(sonnet?.roles).toContain("code-review")
  })

  it("呼び出し側が明示したモデルエイリアスは反映する", () => {
    const result = run<ModelListResult>(
      ["--list-models", "--policy", "with-codex-policy"],
      { AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" }
    )
    expect(result.models.find((model) => model.id === "gpt-sol")?.model).toBe(
      "my-sol"
    )
  })

  it("未知のポリシーを拒否する", () => {
    const result = run<ModelListResult>(["--list-models", "--policy", "nope"])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/policy/)
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
      "--policy",
      "codex-grok-policy",
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
      "--policy",
      "codex-grok-policy",
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
      "--policy",
      "codex-grok-policy",
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

  it("不正な policy を拒否する", () => {
    const result = run<CoverageResult>([
      "--list-coverage",
      "--policy",
      "unknown-policy",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toContain("policy: must be one of")
  })
})

describe("--list-roles", () => {
  it("name / roles 無しで担当表の組み込み役割を返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "with-codex-policy",
      "--model-id",
      "gpt-sol",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.roles.map((role) => role.id)).toEqual(["complex-impl"])
    expect(result.roles.every((role) => role.source === "plugin")).toBe(true)
  })

  it("プロジェクト固有 ID を組み込み役割の末尾へ並べる", () => {
    writeProjectRole({ id: "triage" })

    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "with-codex-policy",
      "--model-id",
      "gpt-sol",
      "--dir",
      project
    ])

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

    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "with-codex-policy",
      "--model-id",
      "gpt-terra",
      "--dir",
      project
    ])
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

  it("担当表で担える役割だけを返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "codex-grok-policy",
      "--model-id",
      "gpt-terra",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.roles.map((role) => role.id)).toEqual([
      "normal-impl",
      "general"
    ])
  })

  it("id と label の両方を返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "haiku",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    const light = result.roles.find((role) => role.id === "light-impl")
    expect(light?.label).toBe("軽量な実装")
    expect(light?.kind).toBe("impl")
  })

  it("プロジェクト独自役割は担当表に無くても含める", () => {
    const dir = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の一次切り分け",
        "description: 障害の一次切り分け",
        "tools: Read, Grep, Glob",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- 障害の一次切り分け"
      ].join("\n")
    )
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "haiku",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.roles.map((role) => role.id)).toContain("triage")
  })

  it("ポリシーに登場しないモデルを拒否する", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "with-grok-policy",
      "--model-id",
      "gpt-sol",
      "--dir",
      project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not used")
  })

  it("プロジェクト独自役割の言語不一致を示す", () => {
    writeProjectRole({ id: "triage" })

    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "haiku",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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

  it("方針と言語が不正なら方針のエラーを先に返す", () => {
    const result = run([
      "--policy",
      "bogus-policy",
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
    expect(String(result.error)).toMatch(/^policy: must be one of /)
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
    "--policy",
    "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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

  it("旧同梱候補だけを keptNeedsReview に分ける", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7, CustomTool",
      extraSection: [
        "## ツール運用",
        "",
        "- Context7 を使う。",
        "",
        "## 独自運用",
        "",
        "- 独自の運用。",
        ""
      ].join("\n")
    })

    const result = singleResult<CheckResult>([
      "--policy",
      "with-codex-policy",
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

    expect(result.kept).toEqual([
      "tools:LSP",
      "tools:CustomTool",
      "section:## ツール運用",
      "section:## 独自運用"
    ])
    expect(result.keptNeedsReview).toEqual(["section:## ツール運用"])
  })

  it("存在しない --keep section でエラーになり既存ファイルを変えない", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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
      "--policy",
      "with-codex-policy",
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

describe("担当表の検証", () => {
  it("担当表にある役割は通る", () => {
    const result = run<WriteResults>([
      "--check",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "sonnet",
      "--lang",
      "ja",
      "--name",
      "claude-sonnet",
      "--roles",
      "normal-impl,code-review",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
  })

  it("担当表に無い組み込み役割を拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--policy",
      "claude-model-policy",
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
    expect(result.ok).toBe(false)
    expect(result.error).toContain("light-impl")
  })

  it("そのポリシーに登場しないモデルを拒否する", () => {
    const result = run<WriteResults>([
      "--check",
      "--policy",
      "claude-model-policy",
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
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/model-id/)
  })

  it("プロジェクト独自役割は担当表の検証を免除する", () => {
    const dir = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の一次切り分け",
        "description: 障害の一次切り分け",
        "tools: Read, Grep, Glob",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- 一次切り分け"
      ].join("\n")
    )
    const result = run<WriteResults>([
      "--check",
      "--policy",
      "claude-model-policy",
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
      "--policy",
      "claude-model-policy",
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

describe("--models による一括", () => {
  it("複数モデルの差分を配列で返す", () => {
    const result = run<WriteResults>([
      "--check",
      "--policy",
      "claude-model-policy",
      "--lang",
      "ja",
      "--models",
      "sonnet,haiku",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.results.length).toBe(2)
    expect(result.results[0]?.modelId).toBe("sonnet")
    expect(result.results[0]?.roles.ids).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review",
      "code-review"
    ])
  })

  it("単一指定でも要素 1 の配列を返す", () => {
    const result = run<WriteResults>([
      "--check",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "haiku",
      "--lang",
      "ja",
      "--name",
      "claude-haiku",
      "--roles",
      "light-impl",
      "--dir",
      project
    ])
    expect(result.results.length).toBe(1)
  })

  it("--models と --merge を併用できる", () => {
    const result = run<WriteResults>([
      "--write",
      "--merge",
      "--policy",
      "claude-model-policy",
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
      "--policy",
      "claude-model-policy",
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
        "--policy",
        "claude-model-policy",
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
        "--policy",
        "claude-model-policy",
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
      "--policy",
      "claude-model-policy",
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
      "--policy",
      "claude-model-policy",
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
      "--policy",
      "claude-model-policy",
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

describe("モデル単位 color の配線", () => {
  it("Claude Sonnet の purple を生成定義へ渡す", () => {
    const result = run<WriteResults>([
      "--write",
      "--policy",
      "claude-model-policy",
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
    expect(written).toMatch(/^color: purple$/m)
  })
})
