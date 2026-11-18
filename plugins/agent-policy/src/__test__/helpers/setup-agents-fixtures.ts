import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach } from "vitest"
import {
  type FakeModelsResponse,
  type FakeModelsServer,
  startFakeModelsServer
} from "../../testing/fake-models-server"
import { bundledScript, runTs } from "../../testing/run-ts.js"

export const CLI = fileURLToPath(
  new URL("../../setup-agents.ts", import.meta.url)
)
export const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
export const FAKE_CLAUDE = fileURLToPath(
  new URL("../../testing/fake-claude.mjs", import.meta.url)
)
export const execFileAsync = promisify(execFile)

export let project: string
export let modelsServer: FakeModelsServer | undefined

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
export interface RolesSummary {
  ids: string[]
  implRoles: string[]
  readonlyRoles: string[]
  mixedKinds: boolean
}

export interface Discarded {
  frontmatterKeys: string[]
  preamble: boolean
  sections: string[]
}

export type TextState = "same" | "templateChanged" | "userEdited" | "unknown"

export interface CheckResult {
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

export interface WriteResults {
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

export interface ListedRole {
  id: string
  label: string
  kind: "impl" | "readonly"
  tools: string[]
  source: "plugin" | "project"
  languageMismatch?: boolean
}

export interface ListRolesResult {
  ok: boolean
  error?: string
  roles: ListedRole[]
}

export interface CoverageResult {
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

export interface CoverageDefinition {
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

export interface EditResult {
  ok: boolean
  error?: string
  target: string
  changed: boolean
  warnings: string[]
}

export interface LiveModelsResult {
  ok: boolean
  reason?: string
  models: {
    id: string
    vendor: "gpt" | "grok" | "claude" | "unknown"
    recommendedFor: string[]
  }[]
  claudeEnums: string[]
}

export interface FragmentStatusResult {
  ok: boolean
  missing: string[]
  stale: { id: string }[]
  targetDir: string | null
  written?: string[]
}

// このプラグイン自身が利用者へ案内する設定。開発者の環境に入っていると
// 既定値を前提としたアサーションが落ちるため、子プロセスへは渡さない。
// 値を要るテストは run() の第 2 引数で明示する。
export const AMBIENT_ENV_VARS = [
  "AMATSUKA_AGENT_AUTO_INJECTION",
  "AMATSUKA_AGENT_GPT_SOL_ALIAS",
  "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
  "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
  "AMATSUKA_AGENT_GROK_ALIAS",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY"
]

export function inheritedTestEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const variable of AMBIENT_ENV_VARS) delete env[variable]
  return env
}

export function run<T = CheckResult>(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): T {
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

export async function runAsync<T = CheckResult>(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<T> {
  let output: string
  try {
    const result = await execFileAsync(
      process.execPath,
      [bundledScript(CLI), ...args],
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

export async function startModelsServer(
  response: FakeModelsResponse = {}
): Promise<FakeModelsServer> {
  modelsServer = await startFakeModelsServer(response)
  return modelsServer
}

export function runWithMcp<T>(args: string[], listOutput: string): T {
  return run<T>(args, {
    AGENT_POLICY_CLAUDE_BIN: FAKE_CLAUDE,
    AGENT_POLICY_FAKE_MCP: listOutput
  })
}

export function singleResult<T>(args: string[]): T {
  const response = run<{ ok: boolean; error?: string; results: T[] }>(args)
  const result = response.results[0]
  if (result === undefined) {
    throw new Error(response.error ?? "setup returned no result")
  }
  return result
}

export function check(
  scope: "claude" | "custom",
  extra: string[] = []
): CheckResult {
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

export function target(): string {
  return path.join(project, ".claude", "agents", "gpt-sol.md")
}

export function writeProjectRole(options: {
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

export function writeAgent(file: string, lines: string[]): string {
  const target = path.join(project, ".claude", "agents", file)
  fs.writeFileSync(target, lines.join("\n"))
  return target
}

export function coverage(extra: string[] = []): CoverageResult {
  return run<CoverageResult>([
    "--list-coverage",
    "--lang",
    "ja",
    "--dir",
    project,
    ...extra
  ])
}

export function definitionOf(
  result: CoverageResult,
  name: string
): CoverageDefinition | undefined {
  return result.definitions.find((definition) => definition.name === name)
}

export const EDIT_SOURCE = [
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

export function readAgent(file: string): string {
  return fs.readFileSync(path.join(project, ".claude", "agents", file), "utf8")
}

// テンプレートを生成してから指定箇所を書き換え、既存ファイルとして置く。
export function seed(
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
