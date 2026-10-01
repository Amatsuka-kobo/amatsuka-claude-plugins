/**
 * MCP のツール層の結合テスト。InMemoryTransport でサーバーとクライアントをつなぎ、
 * 入力のスキーマ(旧入力の廃止)・入力の誤り・壊れた設定での起動・list_rules・record_outcome・
 * 判例の保守ツール・進捗の通知・キャンセルを確かめる(設計書 §6.2・§6.8・§6.12.4)。
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NO_EVALUATION_RECORD } from "../../casefile/store.js"
import type { PipelineDeps } from "../../core/pipeline.js"
import type { JudgeCall, JudgeProvider } from "../../panel/provider.js"
import { makeTmpDir } from "../../subject/__test__/helpers/gitRepo.js"
import { registerEvaluateCode } from "../evaluateCode.js"
import { registerEvaluateDecision } from "../evaluateDecision.js"
import { registerEvaluateDesign } from "../evaluateDesign.js"
import { registerEvaluatePlan } from "../evaluatePlan.js"
import { registerListPrecedents } from "../listPrecedents.js"
import { registerListRules } from "../listRules.js"
import { registerRecordOutcome } from "../recordOutcome.js"
import { registerRetirePrecedent } from "../retirePrecedent.js"
import {
  BUILD_VERSION,
  benignPanel,
  type Harness,
  type HarnessOptions,
  makeHarness
} from "./helpers/harness.js"

const GHP_TOKEN = `ghp_${"A1b2C3d4E5f6".repeat(3)}`

const harnesses: Harness[] = []
const clients: Client[] = []
function harness(opts: HarnessOptions = {}): Harness {
  const h = makeHarness(opts)
  harnesses.push(h)
  return h
}

const savedEnv = { ...process.env }
beforeEach(() => {
  delete process.env.RAGUEL_CONFIG
})
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close()
  for (const h of harnesses.splice(0)) h.cleanup()
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key]
  }
  Object.assign(process.env, savedEnv)
})

async function connect(deps: PipelineDeps): Promise<Client> {
  const server = new McpServer({ name: "raguel-mcp", version: BUILD_VERSION })
  for (const register of [
    registerEvaluateDecision,
    registerEvaluatePlan,
    registerEvaluateDesign,
    registerEvaluateCode,
    registerListRules,
    registerRecordOutcome,
    registerListPrecedents,
    registerRetirePrecedent
  ]) {
    register(server, deps)
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "test-client", version: "0.0.0" })
  await client.connect(clientTransport)
  clients.push(client)
  return client
}

interface CallResult {
  isError?: boolean
  // biome-ignore lint/suspicious/noExplicitAny: 応答の JSON をテストで読む
  body: any
  text: string
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  options?: Parameters<Client["callTool"]>[2]
): Promise<CallResult> {
  const res = await client.callTool(
    { name, arguments: args },
    undefined,
    options
  )
  const text = (res.content as Array<{ type: string; text: string }>)[0].text
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return { isError: res.isError as boolean | undefined, body, text }
}

const decisionArgs = (decision: string, runId = "run-1") => ({
  runId,
  phase: "intent",
  objective: "方針を決める",
  decision
})

describe("evaluate_* の入力(設計書 §6.2、所見 F1)", () => {
  it("呼び出し側が本文を渡す旧入力は入力の誤りになり、記録しない", async () => {
    const h = harness({ files: { "plan.md": "# 計画\n" } })
    const client = await connect(h.deps)
    const common = { runId: "run-1", objective: "x" }

    const cases: [string, Record<string, unknown>][] = [
      [
        "evaluate_code",
        { ...common, phase: "implement", diff: "diff --git a/x b/x" }
      ],
      [
        "evaluate_code",
        { ...common, phase: "implement", baseRef: h.base, diff: "要約" }
      ],
      [
        "evaluate_code",
        {
          ...common,
          phase: "implement",
          files: [{ path: "a.ts", content: "x" }]
        }
      ],
      [
        "evaluate_plan",
        { ...common, phase: "dev-plan", plan: "要約", steps: ["a"] }
      ],
      [
        "evaluate_plan",
        { ...common, phase: "dev-plan", paths: ["plan.md"], constraints: ["c"] }
      ],
      [
        "evaluate_design",
        { ...common, phase: "design", design: "要約", requirements: ["r"] }
      ]
    ]
    for (const [name, args] of cases) {
      const res = await call(client, name, args)
      expect(res.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    expect(h.index()).toEqual([])
  })

  it("phase と ツールの kind が合わなければ入力の誤りにする", async () => {
    const h = harness({ files: { "plan.md": "# 計画\n" } })
    const client = await connect(h.deps)
    const res = await call(client, "evaluate_plan", {
      runId: "run-1",
      phase: "implement",
      objective: "x",
      paths: ["plan.md"]
    })
    expect(res.isError).toBe(true)
    expect(res.text).toContain("evaluate_code")
    expect(h.index()).toEqual([])
  })

  it("評価対象の入力の誤り(repoPath の外のパス)は isError で返し、記録しない", async () => {
    const h = harness()
    const client = await connect(h.deps)
    const res = await call(client, "evaluate_design", {
      runId: "run-1",
      phase: "design",
      objective: "x",
      paths: ["../outside.md"]
    })
    expect(res.isError).toBe(true)
    expect(h.index()).toEqual([])
  })

  it("evaluate_plan は paths のファイルを読んで評価する", async () => {
    const h = harness({ files: { "dev-plan.md": "# 計画\n## Step 1\n作る\n" } })
    benignPanel(h.provider, "plan")
    const client = await connect(h.deps)
    const res = await call(client, "evaluate_plan", {
      runId: "run-1",
      phase: "dev-plan",
      objective: "計画する",
      paths: ["dev-plan.md"]
    })
    expect(res.isError).toBeUndefined()
    expect(res.body).toMatchObject({
      phase: "dev-plan",
      kind: "plan",
      verdict: "PROCEED",
      policy: { buildVersion: BUILD_VERSION, version: 2 }
    })
    expect(res.body.subject.files[0].path).toBe("dev-plan.md")
  })
})

describe("壊れた設定での起動(§6.12.4、所見 E1)", () => {
  it("起動時に設定が壊れていても応答し、評価は ASK・degraded、list_rules は理由を返す。直れば読み直す", async () => {
    const home = makeTmpDir("raguel-home-")
    process.env.HOME = home
    const h = harness()
    benignPanel(h.provider, "decision")
    h.writeConfig({ raguel: { judge: { canStop: true } } })
    const client = await connect(h.deps)
    const configPath = path.join(h.repo, ".codiel", "config.json")

    const rules = await call(client, "list_rules", {})
    expect(rules.body.error).toContain("judge.canStop")
    expect(rules.body.path).toBe(configPath)

    const evaluated = await call(
      client,
      "evaluate_decision",
      decisionArgs("方針")
    )
    expect(evaluated.body).toMatchObject({
      verdict: "ASK",
      judgeStatus: "degraded",
      degradedReasons: [{ source: "config", reason: "config-error" }]
    })
    expect(evaluated.body.findings[0].evidence.location).toBe(configPath)

    h.writeConfig({ raguel: { storage: { casesDir: h.casesDir } } })
    const fixed = await call(client, "list_rules", {})
    expect(fixed.body.error).toBeUndefined()
    expect(fixed.body.configSource).toBe(`cwd:${configPath}`)
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe("list_rules(設計書 §6.2.8)", () => {
  it("パラメータ・設定の出所・ビルドのバージョン・プロバイダー・保護パスの除外・testsDir を返す", async () => {
    const h = harness({
      testsDir: "e2e",
      raguel: {
        rules: {
          "code/protected-paths": {
            excludeDefaults: ["infra/**"],
            generated: ["dist/**"]
          }
        },
        panel: { perPanelist: { meta: { provider: "codex" } } },
        subject: { ignoreUncommitted: ["docs/chat/**"] }
      }
    })
    const client = await connect(h.deps)
    const { body } = await call(client, "list_rules", {})

    expect(body.buildVersion).toBe(BUILD_VERSION)
    expect(body.configSource).toBe(
      `cwd:${path.join(h.repo, ".codiel", "config.json")}`
    )
    expect(body.policy).toMatchObject({
      version: 2,
      buildVersion: BUILD_VERSION,
      protectedPaths: {
        excludedDefaults: ["infra/**"],
        generated: ["dist/**"]
      },
      ignoreUncommitted: ["docs/chat/**"]
    })
    expect(body.e2eReports.testsDir).toBe("e2e")
    expect(body.panelists).toEqual({
      adversarial: { provider: "claude", model: "sonnet" },
      steelman: { provider: "claude", model: "haiku" },
      crosscheck: { provider: "claude", model: "haiku" },
      meta: { provider: "codex" }
    })

    // biome-ignore lint/suspicious/noExplicitAny: 応答の JSON をテストで読む
    const byId = (id: string) => body.rules.find((r: any) => r.id === id)
    const globs = byId("code/protected-paths").params.find(
      // biome-ignore lint/suspicious/noExplicitAny: 応答の JSON をテストで読む
      (p: any) => p.name === "globs"
    )
    expect(globs).toMatchObject({ type: "glob[]", merge: "union" })
    expect(globs.current).not.toContain("infra/**")
    expect(globs.default).toContain("infra/**")
    expect(byId("common/secrets")).toMatchObject({
      sealed: true,
      severity: "stop"
    })
    expect(byId("common/secrets").params[0].constraint).toBeDefined()
    expect(byId("precedent/failure-match")).toMatchObject({ severity: "info" })
    expect(byId("code/dangerous-patterns")).toBeUndefined()

    const planOnly = await call(client, "list_rules", { kind: "plan" })
    // biome-ignore lint/suspicious/noExplicitAny: 応答の JSON をテストで読む
    const planIds = planOnly.body.rules.map((r: any) => r.id)
    expect(planIds).toContain("plan/max-steps")
    expect(planIds).not.toContain("code/destructive-ops")
  })

  it("judge.provider が none なら、どのパネリストも none と示す", async () => {
    const h = harness({ raguel: { judge: { provider: "none" } } })
    const client = await connect(h.deps)
    const { body } = await call(client, "list_rules", {})
    expect(body.panelists.adversarial).toEqual({ provider: "none" })
    // 宣言が無ければ空の配列を返す
    expect(body.policy.ignoreUncommitted).toEqual([])
  })
})

describe("evaluate_code の未コミットの検査(設計書 §6.2.2 の手順 3)", () => {
  it("宣言したパスの変更は数えず、宣言の外のパスの変更は isError で残ったパスを返す", async () => {
    const h = harness({
      raguel: { subject: { ignoreUncommitted: ["docs/chat/**"] } },
      files: { "docs/chat/log.md": "1\n" }
    })
    const client = await connect(h.deps)
    const args = {
      runId: "run-1",
      phase: "test-loop",
      objective: "x",
      baseRef: h.base
    }

    fs.writeFileSync(path.join(h.repo, "docs/chat/log.md"), "1\n2\n")
    const ignored = await call(client, "evaluate_code", args)
    expect(ignored.isError).toBeUndefined()
    expect(ignored.body.policy.ignoreUncommitted).toEqual(["docs/chat/**"])

    fs.writeFileSync(path.join(h.repo, "README.md"), "書きかけ\n")
    const rejected = await call(client, "evaluate_code", {
      ...args,
      runId: "run-2"
    })
    expect(rejected.isError).toBe(true)
    expect(rejected.text).toContain("README.md")
    expect(rejected.text).not.toContain("docs/chat")
    expect(h.index()).toHaveLength(1)
  })
})

describe("record_outcome と判例(設計書 §6.2.7・§6.2.9・§6.11、所見 G2・G7)", () => {
  it("索引に無い evaluationId は「評価の記録が無い」と返す", async () => {
    const h = harness()
    const client = await connect(h.deps)
    const { body } = await call(client, "record_outcome", {
      evaluationId: "00000000-0000-4000-8000-000000000000",
      outcome: "approved"
    })
    expect(body.recorded).toBe(false)
    expect(body.reason).toContain(NO_EVALUATION_RECORD)
  })

  it("STOP の誤検知の裁定を記録して判例にし、一覧・退役できる", async () => {
    const h = harness()
    const client = await connect(h.deps)
    const stop = await call(
      client,
      "evaluate_decision",
      decisionArgs(`見本の鍵 ${GHP_TOKEN} を README に載せる`)
    )
    expect(stop.body.verdict).toBe("STOP")
    const evaluationId = stop.body.evaluationId

    const noNotes = await call(client, "record_outcome", {
      evaluationId,
      outcome: "approved",
      ruling: "false-positive"
    })
    expect(noNotes.body).toMatchObject({ recorded: false })
    expect(noNotes.body.reason).toContain("notes")

    const asIs = await call(client, "record_outcome", {
      evaluationId,
      outcome: "approved",
      ruling: "as-is"
    })
    expect(asIs.body.recorded).toBe(false)

    const recorded = await call(client, "record_outcome", {
      evaluationId,
      outcome: "approved",
      ruling: "false-positive",
      notes: "文書に載せる見本の鍵で、実際の鍵ではない"
    })
    expect(recorded.body.recorded).toBe(true)
    const precedentId = recorded.body.precedentId
    expect(precedentId).toBe(
      `prec-${evaluationId.slice(0, 8)}-false-positive-approved`
    )
    expect(h.outcomes().at(-1)).toMatchObject({
      schemaVersion: 2,
      evaluationId,
      phase: "intent",
      outcome: "approved",
      ruling: "false-positive",
      precedentId
    })

    const listed = await call(client, "list_precedents", { phase: "intent" })
    expect(listed.body.precedents).toEqual([
      expect.objectContaining({
        id: precedentId,
        source: "project",
        phase: "intent",
        ruling: "false-positive",
        firedRules: expect.arrayContaining(["common/secrets"]),
        retiredAt: null
      })
    ])
    const all = await call(client, "list_precedents", {})
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: 応答の JSON をテストで読む
      all.body.precedents.some((p: any) => p.source === "seed")
    ).toBe(true)

    const retired = await call(client, "retire_precedent", {
      id: precedentId,
      reason: "見本の鍵の書き方を変えた"
    })
    expect(retired.body).toEqual({ retired: true })
    expect(
      (await call(client, "list_precedents", { phase: "intent" })).body
        .precedents
    ).toEqual([])
    const withRetired = await call(client, "list_precedents", {
      phase: "intent",
      includeRetired: true
    })
    expect(withRetired.body.precedents[0].retiredAt).toEqual(expect.any(String))
    const again = await call(client, "retire_precedent", {
      id: precedentId,
      reason: "もう一度"
    })
    expect(again.body.retired).toBe(false)

    // 同じ裁定の再記録は受け付けず、退役した判例も復活しない(所見 W4R1-07)
    const outcomesBefore = h.outcomes().length
    const duplicate = await call(client, "record_outcome", {
      evaluationId,
      outcome: "approved",
      ruling: "false-positive",
      notes: "もう一度記録する"
    })
    expect(duplicate.body.recorded).toBe(false)
    expect(duplicate.body.precedentId).toBeNull()
    expect(duplicate.body.reason).toContain("既に記録されている")
    expect(h.outcomes()).toHaveLength(outcomesBefore)
    expect(
      (await call(client, "list_precedents", { phase: "intent" })).body
        .precedents
    ).toEqual([])
  })

  it("notes の検出値は outcomes.jsonl と判例の lesson に伏せて保存する", async () => {
    const h = harness()
    const client = await connect(h.deps)
    const stop = await call(
      client,
      "evaluate_decision",
      decisionArgs(`見本の鍵 ${GHP_TOKEN} を README に載せる`)
    )
    const key = "AKIAIOSFODNN7EXAMPLE"
    const recorded = await call(client, "record_outcome", {
      evaluationId: stop.body.evaluationId,
      outcome: "approved",
      ruling: "false-positive",
      notes: `検出値 ${key} は見本である`
    })
    expect(recorded.body.recorded).toBe(true)
    const masked = h.outcomes().at(-1)?.notes
    expect(masked).toContain("AKIA")
    expect(masked).toContain("*")
    expect(masked).not.toContain(key)
    // list_precedents は lesson を返さないので、判例のファイルを直接読む
    const precedentsDir = path.join(h.casesDir, "precedents")
    const [projectId] = fs.readdirSync(precedentsDir)
    const file = path.join(
      precedentsDir,
      projectId,
      `${recorded.body.precedentId}.json`
    )
    const { lesson } = JSON.parse(fs.readFileSync(file, "utf-8"))
    expect(lesson).toContain("AKIA*")
    expect(lesson).not.toContain(key)
  })

  it("degraded の評価の裁定は記録するが、判例は作らない", async () => {
    const h = harness()
    const client = await connect(h.deps)
    // パネリストの応答が無いので degraded の ASK になる
    const degraded = await call(
      client,
      "evaluate_decision",
      decisionArgs("方針")
    )
    expect(degraded.body.judgeStatus).toBe("degraded")
    const res = await call(client, "record_outcome", {
      evaluationId: degraded.body.evaluationId,
      outcome: "approved",
      ruling: "as-is"
    })
    expect(res.body).toEqual({ recorded: true, precedentId: null })
    expect(h.outcomes()).toHaveLength(1)
    expect(h.outcomes()[0]).toMatchObject({
      ruling: "as-is",
      precedentId: null
    })
  })

  it("ruling と outcome の組み合わせが表に無ければ記録しない", async () => {
    const h = harness()
    benignPanel(h.provider, "decision")
    const client = await connect(h.deps)
    const ok = await call(client, "evaluate_decision", decisionArgs("方針"))
    expect(ok.body.verdict).toBe("PROCEED")
    for (const args of [
      { outcome: "approved", ruling: "revise" },
      { outcome: "rejected", ruling: "revise" },
      { outcome: "rejected", ruling: "as-is" }
    ]) {
      const res = await call(client, "record_outcome", {
        evaluationId: ok.body.evaluationId,
        ...args
      })
      expect(res.body.recorded, JSON.stringify(args)).toBe(false)
    }
    expect(h.outcomes()).toEqual([])
  })

  it("casefile/tampered の STOP は false-positive で覆せない", async () => {
    const h = harness({ files: { "design.md": "# 設計\n" } })
    benignPanel(h.provider, "decision")
    const client = await connect(h.deps)
    const intent = await call(client, "evaluate_decision", decisionArgs("方針"))
    fs.appendFileSync(
      path.join(intent.body.casePath, "submission.txt"),
      "書き換え"
    )
    const stop = await call(client, "evaluate_design", {
      runId: "run-1",
      phase: "design",
      objective: "設計する",
      paths: ["design.md"]
    })
    expect(stop.body.verdict).toBe("STOP")
    const res = await call(client, "record_outcome", {
      evaluationId: stop.body.evaluationId,
      outcome: "approved",
      ruling: "false-positive",
      notes: "覆したい"
    })
    expect(res.body.recorded).toBe(false)
    expect(res.body.reason).toContain("覆せない")
  })
})

describe("進捗とキャンセル(§6.8、所見 I2)", () => {
  it("progressToken があれば、ステップとパネリストの起動と終了を通知する", async () => {
    const h = harness()
    benignPanel(h.provider, "decision")
    const client = await connect(h.deps)
    const messages: string[] = []
    const res = await call(client, "evaluate_decision", decisionArgs("方針"), {
      onprogress: (p) => {
        if (p.message) messages.push(p.message)
      }
    })
    expect(res.body.verdict).toBe("PROCEED")
    expect(messages).toEqual(
      expect.arrayContaining([
        "評価対象の取得",
        "ルール層",
        "パネル",
        "adversarial を起動した",
        "adversarial が終わった",
        "steelman を起動した",
        "合成"
      ])
    )
  })

  it("クライアントが中止したら、パネリストに中止を伝え、attempt と索引を残さない", async () => {
    let started = false
    let aborted = false
    const hanging: JudgeProvider = {
      name: "claude",
      invoke<T>(_call: JudgeCall<T>, ctl: { signal: AbortSignal }): Promise<T> {
        started = true
        return new Promise<T>((_, reject) => {
          ctl.signal.addEventListener("abort", () => {
            aborted = true
            reject(ctl.signal.reason)
          })
        })
      }
    }
    const h = harness({ providers: () => ({ claude: hanging }) })
    const client = await connect(h.deps)
    const ac = new AbortController()
    const pending = call(client, "evaluate_decision", decisionArgs("方針"), {
      signal: ac.signal
    })
    await vi.waitFor(() => expect(started).toBe(true))
    ac.abort("中止")
    await expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(aborted).toBe(true))
    await new Promise((r) => setTimeout(r, 100))
    expect(h.index()).toEqual([])
    expect(
      fs.existsSync(path.join(h.store().projectDir, "run-1", "intent"))
    ).toBe(false)
  })
})
