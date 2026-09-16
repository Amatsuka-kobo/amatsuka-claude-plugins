import type { ExecFileSyncOptions } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  type FakeModelsServer,
  startFakeModelsServer
} from "../../testing/fake-models-server.js"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const RUN_TS = fileURLToPath(
  new URL("../../testing/run-ts.ts", import.meta.url)
)
const TSX_IMPORT = createRequire(import.meta.url).resolve("tsx")
const LEGACY_INJECTIONS = ["with-codex", "with-grok", "with-codex-grok"]
const TABLE_INTRO =
  "次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは依頼内容に近いものを選ぶ。"
const CLAUDE_SCOPE = "それ以外の定義は委譲先にしない"
const WITH_EXTERNAL_SCOPE =
  "外部ベンダーのモデルを指定した定義も含めて選んでよい"
const ALIAS_VARIABLES = [
  "AMATSUKA_AGENT_GPT_SOL_ALIAS",
  "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
  "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
  "AMATSUKA_AGENT_GROK_ALIAS"
]

let project: string
let servers: FakeModelsServer[]

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
  servers = []
})

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()))
  fs.rmSync(project, { recursive: true, force: true })
})

function agentsDir(): string {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function place(name: string, frontmatter: string[]): void {
  fs.writeFileSync(
    path.join(agentsDir(), `${name}.md`),
    ["---", `name: ${name}`, ...frontmatter, "---", "", "本文", ""].join("\n")
  )
}

function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.ANTHROPIC_BASE_URL
  delete base.ANTHROPIC_AUTH_TOKEN
  delete base.ANTHROPIC_API_KEY
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides }
}

function injectionEnvironment(
  value: string | undefined
): Record<string, string> {
  return value === undefined ? {} : { AMATSUKA_AGENT_AUTO_INJECTION: value }
}

function parseContext(output: string): string {
  const trimmed = output.trim()
  if (trimmed === "") return ""
  const parsed = JSON.parse(trimmed.split("\n").at(-1) ?? "{}")
  return parsed.hookSpecificOutput?.additionalContext ?? ""
}

function context(env: Record<string, string> = {}): string {
  return parseContext(
    runTs(HOOK, [], {
      env: environment({ CLAUDE_PROJECT_DIR: project, ...env })
    })
  )
}

interface WorkerResult {
  output?: string
  error?: string
}

function runTsAsync(
  script: string,
  args: string[],
  opts: ExecFileSyncOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(
      `
        const { parentPort, workerData } = require("node:worker_threads")
        void import(workerData.runTsUrl)
          .then(({ runTs }) => {
            try {
              parentPort.postMessage({
                output: runTs(workerData.script, workerData.args, workerData.opts)
              })
            } catch (error) {
              parentPort.postMessage({
                error: error instanceof Error
                  ? error.stack ?? error.message
                  : String(error)
              })
            }
          })
          .catch((error) => {
            parentPort.postMessage({
              error: error instanceof Error
                ? error.stack ?? error.message
                : String(error)
            })
          })
      `,
      {
        eval: true,
        execArgv: ["--import", TSX_IMPORT],
        workerData: {
          runTsUrl: pathToFileURL(RUN_TS).href,
          script,
          args,
          opts
        }
      }
    )

    worker.once("message", (result: WorkerResult) => {
      settled = true
      if (result.error !== undefined) {
        reject(new Error(result.error))
        return
      }
      resolve(result.output ?? "")
    })
    worker.once("error", (error) => {
      if (!settled) reject(error)
    })
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`runTs worker exited with code ${code}`))
      }
    })
  })
}

async function contextAsync(env: Record<string, string>): Promise<string> {
  return parseContext(
    await runTsAsync(HOOK, [], {
      env: environment({ CLAUDE_PROJECT_DIR: project, ...env })
    })
  )
}

async function startServer(
  ids: string[],
  options: { delayMs?: number } = {}
): Promise<FakeModelsServer> {
  const server = await startFakeModelsServer({
    body: JSON.stringify({ data: ids.map((id) => ({ id })) }),
    delayMs: options.delayMs
  })
  servers.push(server)
  return server
}

function projectSnapshot(root = project): string[] {
  if (!fs.existsSync(root)) return []
  const entries: string[] = []

  const visit = (dir: string): void => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, item.name)
      const relative = path.relative(root, absolute)
      if (item.isDirectory()) {
        entries.push(`directory:${relative}`)
        visit(absolute)
      } else if (item.isSymbolicLink()) {
        entries.push(`symlink:${relative}:${fs.readlinkSync(absolute)}`)
      } else {
        entries.push(`file:${relative}:${fs.readFileSync(absolute, "base64")}`)
      }
    }
  }

  visit(root)
  return entries.sort()
}

describe("方針の注入", () => {
  it.each([
    ["未設定", undefined],
    ["空文字", ""],
    ["none", "none"]
  ])("%s なら方針・対応表・未知役割通知を出さない", (_label, value) => {
    place("hidden", ["agent-policy-role: complex-impl"])
    const output = context(injectionEnvironment(value))

    expect(output).toBe("")
    expect(output).not.toContain("hidden")
    expect(output).not.toContain("未知の役割 ID")
  })

  it("claude では対応表を出さないが、候補内の未知 RoleId は通知する", () => {
    place("hidden", ["agent-policy-role: no-such-role"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).not.toContain(TABLE_INTRO)
    expect(output).toContain("未知の役割 ID")
    expect(output).toContain("hidden")
  })

  it("claude で Claude 定義の対応表を注入する", () => {
    place("claude-agent", ["model: sonnet", "agent-policy-role: complex-impl"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain(TABLE_INTRO)
    expect(output).toContain("claude-agent")
    expect(output).toContain("複雑または重要な実装")
  })

  it("claude で外部ベンダー定義を対応表に載せない", () => {
    place("claude-kept", ["model: sonnet", "agent-policy-role: general"])
    place("external-hidden", [
      "model: claude-gpt-5-6-luna",
      "agent-policy-vendor: gpt",
      "agent-policy-role: complex-impl"
    ])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })

    expect(output).toContain(TABLE_INTRO)
    expect(output).toContain("claude-kept")
    expect(output).not.toContain("external-hidden")
  })

  it("claude の対応表 2 行目で claude-only の候補範囲を示す", () => {
    place("claude-agent", ["model: sonnet", "agent-policy-role: general"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })
    const lines = output.split("\n")
    const introLine = lines.indexOf(TABLE_INTRO)

    expect(introLine).toBeGreaterThanOrEqual(0)
    expect(lines[introLine + 1]).toContain(CLAUDE_SCOPE)
  })

  it("custom 成功時の対応表 2 行目で with-external の候補範囲を示す", () => {
    place("custom-agent", ["model: sonnet", "agent-policy-role: general"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    const lines = output.split("\n")
    const introLine = lines.indexOf(TABLE_INTRO)

    expect(introLine).toBeGreaterThanOrEqual(0)
    expect(lines[introLine + 1]).toContain(WITH_EXTERNAL_SCOPE)
  })

  it("claude で候補外の外部定義の未知 RoleId は通知しない", () => {
    place("gpt-def", [
      "model: claude-gpt-5-6-luna",
      "agent-policy-vendor: gpt",
      "agent-policy-role: no-such-role"
    ])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).not.toContain("gpt-def")
    expect(output).not.toContain("未知の役割 ID")
  })

  it("claude で vendor 未宣言の sonnet 定義だけを対応表に載せる", () => {
    place("implicit-vendor", [
      "model: sonnet",
      "agent-policy-role: normal-impl"
    ])
    place("gpt-vendor", [
      "model: sonnet",
      "agent-policy-vendor: gpt",
      "agent-policy-role: complex-impl"
    ])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })

    expect(output).toContain(TABLE_INTRO)
    expect(output).toContain("implicit-vendor")
    expect(output).not.toContain("gpt-vendor")
  })

  it("custom なら検証成立後に custom 方針と対応表を出す", () => {
    place("custom-agent", ["model: sonnet", "agent-policy-role: complex-impl"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).toContain("agent-policy:custom-policy")
    expect(output).toContain("custom-agent")
    expect(output).toContain("複雑または重要な実装")
  })

  it.each(
    LEGACY_INJECTIONS
  )("%s は custom 扱いで移行通知を出す", (injection) => {
    place("legacy-agent", ["model: sonnet", "agent-policy-role: normal-impl"])
    const output = context({
      AMATSUKA_AGENT_AUTO_INJECTION: injection
    })

    expect(output).toContain("agent-policy:custom-policy")
    expect(output).toContain("legacy-agent")
    expect(output).toContain(
      "AMATSUKA_AGENT_AUTO_INJECTION` を `custom` へ変更する"
    )
    const lines = output.split("\n")
    const policyLine = lines.findIndex((line) =>
      line.includes("agent-policy:custom-policy")
    )
    expect(lines[policyLine + 1]).toContain(
      "AMATSUKA_AGENT_AUTO_INJECTION` を `custom` へ変更する"
    )
    expect(output).not.toContain("未知のため")
  })

  it("custom では移行通知を出さない", () => {
    place("custom-agent", ["agent-policy-role: general"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).not.toContain(
      "AMATSUKA_AGENT_AUTO_INJECTION` を `custom` へ変更する"
    )
  })

  it("未知の値では方針を指さず、未知である旨だけを出す", () => {
    place("hidden", ["agent-policy-role: complex-impl"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "bogus" })

    expect(output).toContain("bogus")
    expect(output).toContain("未知")
    expect(output).not.toContain("スキルを使用し")
    expect(output).not.toContain("hidden")
  })

  it("大文字と前後空白を正規化して判定する", () => {
    place("normalized", ["model: sonnet", "agent-policy-role: explore"])

    expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "  ClAuDe  " })).toContain(
      "agent-policy:claude-model-policy"
    )
    expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "  CuStOm  " })).toContain(
      "agent-policy:custom-policy"
    )
    expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "  NoNe  " })).toBe("")
  })
})

describe("custom 構成の検証", () => {
  it("役割マーカー付き定義が 0 件なら claude へフォールバックする", () => {
    place("plain", ["model: missing-external-model"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("役割マーカー付き定義が見つからない")
    expect(output).toContain("未作成、または読み取れない")
    expect(output).toContain("agent-policy:setup-agents")
    expect(output).not.toContain("missing-external-model")
  })

  it("custom フォールバック(役割付き定義 0 件)では対応表を出さない", () => {
    place("plain", ["model: missing-external-model"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("役割マーカー付き定義が見つからない")
    expect(output).not.toContain(TABLE_INTRO)
  })

  it("custom フォールバック(モデル不在)で Claude 定義の対応表を末尾に付ける", async () => {
    const server = await startServer([])
    place("missing-external", [
      "model: missing-model",
      "agent-policy-role: complex-impl"
    ])
    place("claude-fallback", [
      "model: sonnet",
      "agent-policy-role: normal-impl"
    ])

    const output = await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("定義 `missing-external` の model `missing-model`")
    expect(output).toContain(TABLE_INTRO)
    expect(output).toContain("claude-fallback")
    expect(output.lastIndexOf(TABLE_INTRO)).toBeGreaterThan(
      output.indexOf("agent-policy:setup-agents")
    )
  })

  it("custom フォールバック(照会失敗)で Claude 定義の対応表を末尾に付ける", () => {
    place("external", [
      "model: external-model",
      "agent-policy-role: complex-impl"
    ])
    place("claude-fallback", [
      "model: sonnet",
      "agent-policy-role: normal-impl"
    ])

    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("ANTHROPIC_BASE_URL")
    expect(output).toContain(TABLE_INTRO)
    expect(output).toContain("claude-fallback")
    expect(output.lastIndexOf(TABLE_INTRO)).toBeGreaterThan(
      output.indexOf("agent-policy:setup-agents")
    )
  })

  it("全 Claude enum 構成なら /v1/models を照会せず成立する", async () => {
    const server = await startServer([])
    for (const model of ["sonnet", "opus", "haiku", "fable"]) {
      place(model, [`model: ${model}`, "agent-policy-role: general"])
    }

    const output = context({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("agent-policy:custom-policy")
    expect(server.requests).toEqual([])
  })

  it("live models に全モデル値があれば custom が成立する", async () => {
    const server = await startServer(["live-sol", "live-grok"])
    place("sol", ["model: live-sol", "agent-policy-role: complex-impl"])
    place("grok", ["model: live-grok", "agent-policy-role: explore"])

    const output = await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("agent-policy:custom-policy")
    expect(output).toContain("sol")
    expect(output).toContain("grok")
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.url).toBe("/v1/models")
  })

  it("マーカーの無い定義と inherit と model 欠落を検証対象から除外する", async () => {
    const server = await startServer([])
    place("inherited", ["model: inherit", "agent-policy-role: normal-impl"])
    place("implicit", ["agent-policy-role: general"])
    place("unmarked", ["model: missing-external-model"])

    const output = context({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("agent-policy:custom-policy")
    expect(output).toContain("inherited")
    expect(output).toContain("implicit")
    expect(output).not.toContain("unmarked")
    expect(server.requests).toEqual([])
  })

  it("1 件でもモデルが不在ならセッション全体を claude へフォールバックする", async () => {
    const server = await startServer(["present-model"])
    place("present", ["model: present-model", "agent-policy-role: normal-impl"])
    place("missing", [
      "model: missing-model",
      "agent-policy-role: complex-impl"
    ])

    const output = await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("定義 `missing` の model `missing-model`")
    expect(output).toContain("/v1/models に存在しない")
    expect(output).toContain(
      "セッション全体を claude プロファイルへフォールバック"
    )
    expect(output).toContain("agent-policy:setup-agents")
    expect(output).toContain("model` を修正")
    expect(output).toContain("プロキシを起動")
    expect(output).not.toContain("次の Agent は役割マーカーを宣言している")
  })

  it("不在定義を最大 10 件まで列挙して残りをまとめる", async () => {
    const server = await startServer([])
    for (let index = 1; index <= 12; index += 1) {
      const suffix = String(index).padStart(2, "0")
      place(`missing-${suffix}`, [
        `model: absent-${suffix}`,
        "agent-policy-role: general"
      ])
    }

    const output = await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("定義 `missing-10` の model `absent-10`")
    expect(output).not.toContain("定義 `missing-11` の model `absent-11`")
    expect(output).toContain("他 2 件")
  })

  it("BASE_URL 未設定なら reason を示して claude へフォールバックする", () => {
    place("external", [
      "model: external-model",
      "agent-policy-role: complex-impl"
    ])

    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("ANTHROPIC_BASE_URL")
    expect(output).toContain("no-base-url")
    expect(output).not.toContain("次の Agent は役割マーカーを宣言している")
  })

  it("照会タイムアウトなら reason を示して claude へフォールバックする", async () => {
    const server = await startServer(["external-model"], { delayMs: 3_500 })
    place("external", [
      "model: external-model",
      "agent-policy-role: complex-impl"
    ])

    const output = await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("プロキシへ接続できない")
    expect(output).toContain("timeout")
    expect(output).not.toContain("次の Agent は役割マーカーを宣言している")
  })
})

describe("非推奨エイリアス変数の通知", () => {
  it.each(ALIAS_VARIABLES)("%s が設定されていると 1 回だけ通知する", (name) => {
    const output = context({ [name]: "configured" })

    expect(output).toContain("エイリアス変数は参照されなくなった")
    expect(output).toContain("setup-agents が /v1/models から選ぶ")
    expect(output).toContain("定義の `model` 値")
    expect(output.match(/エイリアス変数は参照されなくなった/g)).toHaveLength(1)
  })

  it("複数の非推奨変数が設定されても通知は 1 回だけ出す", () => {
    const output = context(
      Object.fromEntries(ALIAS_VARIABLES.map((name) => [name, "configured"]))
    )

    expect(output.match(/エイリアス変数は参照されなくなった/g)).toHaveLength(1)
  })

  it.each([
    undefined,
    "none",
    "claude",
    "custom",
    "with-codex",
    "bogus"
  ])("injection が %s の分岐でも通知する", (injection) => {
    const output = context({
      ...injectionEnvironment(injection),
      AMATSUKA_AGENT_GPT_SOL_ALIAS: "configured"
    })

    expect(output).toContain("エイリアス変数は参照されなくなった")
  })
})

describe("ファイルを書かない", () => {
  it.each([
    ["未設定", undefined],
    ["空", ""],
    ["none", "none"],
    ["claude", "claude"],
    ["custom", "custom"],
    ["with-codex", "with-codex"],
    ["with-grok", "with-grok"],
    ["with-codex-grok", "with-codex-grok"],
    ["未知値", "bogus"]
  ])("%s 分岐でプロジェクトの内容を変えない", (_label, injection) => {
    place("safe-agent", ["model: sonnet", "agent-policy-role: general"])
    const before = projectSnapshot()
    context(injectionEnvironment(injection))

    expect(projectSnapshot()).toEqual(before)
  })

  it("live models 成立分岐でもプロジェクトの内容を変えない", async () => {
    const server = await startServer(["external-model"])
    place("external", [
      "model: external-model",
      "agent-policy-role: complex-impl"
    ])
    const before = projectSnapshot()

    await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(projectSnapshot()).toEqual(before)
  })

  it("フォールバック分岐でもプロジェクトの内容を変えない", async () => {
    const server = await startServer([])
    place("external", [
      "model: external-model",
      "agent-policy-role: complex-impl"
    ])
    const before = projectSnapshot()

    await contextAsync({
      AMATSUKA_AGENT_AUTO_INJECTION: "custom",
      ANTHROPIC_BASE_URL: server.baseUrl
    })

    expect(projectSnapshot()).toEqual(before)
  })
})

describe("役割マーカーの走査", () => {
  it("役割 → 名前の対応を注入する", () => {
    place("my-heavy", ["agent-policy-role: complex-impl, explore"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("my-heavy")
    expect(output).toContain("複雑または重要な実装")
    expect(output).toContain("コードベース探索実働")
  })

  it("同じ役割を複数定義が宣言したとき全て列挙する", () => {
    place("first", ["agent-policy-role: normal-impl"])
    place("second", ["agent-policy-role: normal-impl"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("first")
    expect(output).toContain("second")
  })

  it("マーカーの行を ROLES 順に並べる", () => {
    place("out-of-order", [
      "agent-policy-role: realtime-research, general, complex-impl"
    ])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    const complex = output.indexOf("[complex-impl]")
    const general = output.indexOf("[general]")
    const research = output.indexOf("[realtime-research]")
    expect(complex).toBeLessThan(general)
    expect(general).toBeLessThan(research)
  })

  it("未知の役割 ID を無視し、その旨を出す", () => {
    place("odd", ["agent-policy-role: no-such-role"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("no-such-role")
    expect(output).toContain("odd")
  })

  it("プロジェクト側断片の役割 ID を label で解決する", () => {
    const roles = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(roles, { recursive: true })
    fs.writeFileSync(
      path.join(roles, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の切り分け",
        "description: 障害の切り分け",
        "tools: Read, Grep, Glob, Bash",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **切り分け。** 障害の原因を切り分けるとき。",
        ""
      ].join("\n")
    )
    place("triager", ["agent-policy-role: triage"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("障害の切り分け")
    expect(output).toContain("triager")
    expect(output).not.toContain("未知の役割 ID")
  })

  it("読めないプロジェクト側役割断片があっても方針を注入する", () => {
    const roles = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(path.join(roles, "custom.md"), { recursive: true })
    place("custom-role-agent", ["agent-policy-role: custom"])

    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })

    expect(output).toContain("agent-policy:custom-policy")
  })

  it("マーカーの無い定義は対応表に出さない", () => {
    place("marked", ["agent-policy-role: general"])
    place("plain", ["model: sonnet"])
    expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })).not.toContain(
      "plain"
    )
  })

  it("同梱プリセットを走査しない", () => {
    place("dummy", ["agent-policy-role: explore"])
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("コードベース探索実働")
    expect(output).not.toContain("複雑または重要な実装")
  })
})

describe("labelOf の言語別ディレクトリ", () => {
  it("roles/<lang>/ に置いた独自役割の label を読む", () => {
    const dir = path.join(project, ".claude", "agent-policy", "roles", "de")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "triage.md"),
      "---\nid: triage\nlabel: Ersteinschatzung\nkind: readonly\n---\n"
    )
    place("de-triage", ["model: sonnet", "agent-policy-role: triage"])
    const injected = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(injected).toContain("Ersteinschatzung")
    expect(injected).not.toContain("未知の役割 ID")
  })
})

describe("旧定義の残骸通知", () => {
  it("廃止した 4 種を検出する", () => {
    for (const name of [
      "claude-researcher",
      "gpt-researcher",
      "grok-researcher",
      "grok-implementer"
    ]) {
      place(name, ["model: sonnet"])
    }
    const output = context()
    expect(output).toContain("claude-researcher")
    expect(output).toContain("grok-implementer")
    expect(output).toContain("廃止")
  })

  it("現行のプリセット名は残骸として扱わない", () => {
    place("gpt-sol", ["model: claude-gpt-5-6-sol"])
    expect(context()).not.toContain("廃止")
  })
})

describe("フェイルオープン", () => {
  it("CLAUDE_PROJECT_DIR が無いとき走査せず方針だけ出す", () => {
    const output = runTs(HOOK, [], {
      env: environment({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })
    }).trim()
    expect(output).toContain("claude-model-policy")
  })

  it("壊れた symlink があっても方針を注入する", () => {
    fs.symlinkSync(
      "/nonexistent/agent-policy-target.md",
      path.join(agentsDir(), "broken.md")
    )

    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).toContain("役割マーカー付き定義が見つからない")
  })

  it("壊れた symlink があっても正常な定義の役割マーカーを拾う", () => {
    fs.symlinkSync(
      "/nonexistent/agent-policy-target.md",
      path.join(agentsDir(), "broken.md")
    )
    place("healthy", ["agent-policy-role: explore"])

    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    expect(output).toContain("healthy")
    expect(output).toContain("コードベース探索実働")
  })
})
