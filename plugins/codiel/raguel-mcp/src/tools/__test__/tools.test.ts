/**
 * MCP レイヤの統合スモーク: InMemoryTransport でサーバーとクライアントを接続し、
 * list_rules / evaluate_code / evaluate_plan をエンドツーエンドで検証する。
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CaseStore } from "../../casefile/store.js"
import { createConfigReloader } from "../../config/loader.js"
import type { PipelineDeps } from "../../core/pipeline.js"
import type { RaguelConfig } from "../../core/types.js"
import { FakeJudgeProvider } from "../../panel/testing/fakeProvider.js"
import { registerEvaluateCode } from "../evaluateCode.js"
import { registerEvaluatePlan } from "../evaluatePlan.js"
import { registerListRules } from "../listRules.js"
import type { DepsSource } from "../shared.js"

function makeConfig(casesDir: string): RaguelConfig {
  return {
    version: 1,
    onError: "ASK",
    storage: {
      casesDir,
      projectId: "tools-test",
      retention: { maxRuns: 200, maxDays: 90 }
    },
    judge: {
      provider: "claude-cli",
      model: "haiku",
      timeoutMs: 60000,
      canStop: false,
      maxConcurrency: 4,
      thresholds: { proceed: 80, confidence: 60, maxVariance: 30 }
    },
    weight: { tiers: { standard: 30, critical: 70 } },
    panel: {
      trivial: [],
      standard: ["adversarial"],
      critical: ["adversarial", "steelman"],
      perPanelist: {}
    },
    precedent: { seedCatalog: true, topN: 5 },
    rules: {}
  }
}

async function connect(deps: DepsSource): Promise<Client> {
  const server = new McpServer({ name: "raguel-mcp", version: "test" })
  registerEvaluateCode(server, deps)
  registerEvaluatePlan(server, deps)
  registerListRules(server, deps)

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "test-client", version: "0.0.0" })
  await client.connect(clientTransport)
  return client
}

interface CallResult {
  isError?: boolean
  /** 応答の JSON(入力の誤りの応答は JSON でないので undefined) */
  body: ReturnType<typeof JSON.parse>
  text: string
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<CallResult> {
  const res = await client.callTool({ name, arguments: args })
  const text = (res.content as Array<{ type: string; text: string }>)[0].text
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return { isError: res.isError as boolean | undefined, body, text }
}

const HARMLESS_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,1 +1,2 @@",
  " const x = 1",
  "+const y = 2"
].join("\n")

describe("MCP ツール統合スモーク", () => {
  let tmp: string
  let client: Client

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-tools-"))
    const config = makeConfig(tmp)
    const deps: PipelineDeps = {
      config,
      configHash: "tools-hash",
      configSource: "defaults",
      caseStore: new CaseStore(config),
      provider: new FakeJudgeProvider()
    }
    client = await connect(deps)
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("list_rules がルール一覧と configHash と設定の出所を返す", async () => {
    const { body } = await call(client, "list_rules", {})
    expect(body.rules.length).toBeGreaterThan(10)
    expect(
      body.rules.find((r: { id: string }) => r.id === "common/secrets")?.sealed
    ).toBe(true)
    expect(body.policy.configHash).toBe("tools-hash")
    expect(body.policy.configSource).toBe("defaults")
  })

  it("evaluate_code: 無害 diff → PROCEED", async () => {
    const { body } = await call(client, "evaluate_code", {
      runId: "smoke-1",
      objective: "typo 修正",
      diff: HARMLESS_DIFF
    })
    expect(body.verdict).toBe("PROCEED")
    expect(body.casePath).toContain("smoke-1")
    expect(body.policy.configSource).toBe("defaults")
  })

  it("evaluate_code: 保護パス diff → STOP", async () => {
    const { body } = await call(client, "evaluate_code", {
      runId: "smoke-2",
      objective: "CI 変更",
      diff: [
        "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
        "--- a/.github/workflows/ci.yml",
        "+++ b/.github/workflows/ci.yml",
        "@@ -1,1 +1,2 @@",
        " name: ci",
        "+run: echo hi"
      ].join("\n")
    })
    expect(body.verdict).toBe("STOP")
  })

  it.each([
    ["diff も files も無い", {}],
    [
      "diff と files の両方",
      {
        diff: HARMLESS_DIFF,
        files: [{ path: "src/a.ts", content: "const y = 2" }]
      }
    ],
    [
      "ハンクも印の行も無い見出しだけの diff",
      {
        diff: [
          "diff --git a/src/a.ts b/src/a.ts",
          "index 1234567..89abcde 100644",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "--- (新規ファイル、120 行。テストを足した)"
        ].join("\n")
      }
    ]
  ])("evaluate_code: %s は判定を返さず入力の誤り(isError)を返し、ケースファイルを作らない", async (_label, input) => {
    const res = await call(client, "evaluate_code", {
      runId: "smoke-3",
      objective: "何か",
      ...input
    })
    expect(res.isError).toBe(true)
    expect(res.body).toBeUndefined()
    expect(res.text.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(tmp, "cases"))).toBe(false)
  })

  it.each([
    [
      "名前の変更だけ",
      [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 100%",
        "rename from src/old.ts",
        "rename to src/new.ts"
      ]
    ],
    [
      "バイナリ",
      [
        "diff --git a/assets/logo.png b/assets/logo.png",
        "index 1234567..89abcde 100644",
        "Binary files a/assets/logo.png and b/assets/logo.png differ"
      ]
    ],
    [
      "モードの変更だけ",
      [
        "diff --git a/bin/run.sh b/bin/run.sh",
        "old mode 100644",
        "new mode 100755"
      ]
    ],
    [
      "空のファイルの追加",
      [
        "diff --git a/src/empty.ts b/src/empty.ts",
        "new file mode 100644",
        "index 0000000..e69de29"
      ]
    ],
    [
      "空のファイルの削除",
      [
        "diff --git a/src/empty.ts b/src/empty.ts",
        "deleted file mode 100644",
        "index e69de29..0000000"
      ]
    ]
  ])("evaluate_code: ハンクの無い正当な diff(%s)では判定を返す", async (label, lines) => {
    const res = await call(client, "evaluate_code", {
      runId: "smoke-hunkless",
      objective: label,
      diff: lines.join("\n")
    })
    expect(res.isError).toBeFalsy()
    expect(res.body.verdict).toBe("PROCEED")
    expect(fs.existsSync(res.body.casePath)).toBe(true)
  })

  it("evaluate_code: 不正な runId は zod で拒否される", async () => {
    const res = await client.callTool({
      name: "evaluate_code",
      arguments: { runId: "../evil", objective: "攻撃", diff: "x" }
    })
    expect(res.isError).toBe(true)
  })

  it("evaluate_plan: steps にだけ置いた既知の秘密情報の形で所見が出る", async () => {
    const { body } = await call(client, "evaluate_plan", {
      runId: "plan-1",
      objective: "README に一文を足す",
      plan: "README に一文を足す。",
      steps: [
        "README を開く",
        `export OPENAI_KEY=sk-ant-api03-${"x".repeat(24)}`
      ]
    })
    expect(body.verdict).toBe("STOP")
    expect(
      body.findings.some(
        (f: { ruleId: string }) => f.ruleId === "common/secrets"
      )
    ).toBe(true)
  })

  it("evaluate_plan: constraints もつないで検査する", async () => {
    const { body } = await call(client, "evaluate_plan", {
      runId: "plan-2",
      objective: "README に一文を足す",
      plan: "README に一文を足す。",
      constraints: [`トークンは ghp_${"A1b2".repeat(9)} を使う`]
    })
    expect(body.verdict).toBe("STOP")
  })

  it("evaluate_plan: plan も steps も無い入力は入力の誤り(isError)", async () => {
    const res = await call(client, "evaluate_plan", {
      runId: "plan-3",
      objective: "何か",
      constraints: ["何か"]
    })
    expect(res.isError).toBe(true)
    expect(fs.existsSync(path.join(tmp, "cases"))).toBe(false)
  })
})

describe("設定の読み直し(createConfigReloader を渡したサーバー)", () => {
  let tmp: string
  let workDir: string
  let originalCwd: string
  let originalEnv: string | undefined
  let client: Client

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-tools-cases-"))
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-tools-cwd-"))
    originalCwd = process.cwd()
    originalEnv = process.env.RAGUEL_CONFIG
    delete process.env.RAGUEL_CONFIG
    process.chdir(workDir)
    // casesDir と provider だけはテスト用に差し替え、ほかは読んだ設定のまま使う
    const deps = createConfigReloader((loaded): PipelineDeps => {
      const config = {
        ...loaded.config,
        storage: {
          ...loaded.config.storage,
          casesDir: tmp,
          projectId: "reload"
        }
      }
      return {
        config,
        configHash: loaded.configHash,
        configSource: loaded.source,
        caseStore: new CaseStore(config),
        provider: new FakeJudgeProvider()
      }
    })
    client = await connect(deps)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalEnv === undefined) {
      delete process.env.RAGUEL_CONFIG
    } else {
      process.env.RAGUEL_CONFIG = originalEnv
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  function touchLater(file: string, seconds: number): void {
    const later = new Date(Date.now() + seconds * 1000)
    fs.utimesSync(file, later, later)
  }

  /** workDir の .codiel/config.json に raguel を書く(raguel 以外のキーも併せて書ける) */
  function writeCwdConfig(
    raguel: unknown,
    extra: Record<string, unknown> = {}
  ): string {
    const dir = path.join(workDir, ".codiel")
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "config.json")
    fs.writeFileSync(file, JSON.stringify({ ...extra, raguel }), "utf8")
    return file
  }

  it("起動の後に config.json へ書いた raguel を、次の評価と list_rules が使い、configHash が変わる", async () => {
    const before = (await call(client, "list_rules", {})).body
    expect(before.policy.configSource).toBe("defaults")

    const file = writeCwdConfig(
      { onError: "STOP", rules: { "code/protected-paths": { globs: [] } } },
      { testsDir: "docs/codiel/tests", runsDir: "docs/codiel/runs" }
    )
    const created = (await call(client, "list_rules", {})).body
    expect(created.onError).toBe("STOP")
    expect(created.policy.configSource).toBe(`cwd:${file}`)
    expect(created.policy.configHash).not.toBe(before.policy.configHash)
    const globs = created.rules.find(
      (r: { id: string }) => r.id === "code/protected-paths"
    ).params.globs
    expect(globs).toEqual([".github/**", "infra/**", "**/*.env*"])

    const evaluated = (
      await call(client, "evaluate_code", {
        runId: "reload-1",
        objective: "typo 修正",
        diff: HARMLESS_DIFF
      })
    ).body
    expect(evaluated.policy.configSource).toBe(`cwd:${file}`)
    expect(evaluated.policy.configHash).toBe(created.policy.configHash)

    writeCwdConfig({
      rules: { "code/protected-paths": { globs: ["src/auth/**"] } }
    })
    touchLater(file, 10)
    const changed = (await call(client, "list_rules", {})).body
    expect(changed.policy.configHash).not.toBe(created.policy.configHash)
    const stop = (
      await call(client, "evaluate_code", {
        runId: "reload-2",
        objective: "認証の変更",
        diff: HARMLESS_DIFF.replaceAll("src/a.ts", "src/auth/login.ts")
      })
    ).body
    expect(stop.verdict).toBe("STOP")
    expect(stop.policy.configHash).toBe(changed.policy.configHash)
  })

  it("cwd に raguel.config.yaml だけがあっても読まず、出所は defaults のままになる", async () => {
    fs.writeFileSync(
      path.join(workDir, "raguel.config.yaml"),
      "onError: STOP\n",
      "utf8"
    )
    const { body } = await call(client, "list_rules", {})
    expect(body.policy.configSource).toBe("defaults")
    expect(body.onError).toBe("ASK")
  })

  it("RAGUEL_CONFIG が指す JSON のファイルの出所は env:<パス> になる", async () => {
    const file = path.join(workDir, "custom.json")
    fs.writeFileSync(file, '{"onError":"STOP"}', "utf8")
    process.env.RAGUEL_CONFIG = file
    const { body } = await call(client, "list_rules", {})
    expect(body.policy.configSource).toBe(`env:${file}`)
    expect(body.onError).toBe("STOP")
  })

  it("RAGUEL_CONFIG が指すファイルが JSON として読めなければ、評価は既定の onError(ASK)で返す", async () => {
    const file = path.join(workDir, "custom.json")
    fs.writeFileSync(file, "onError: STOP\n", "utf8")
    process.env.RAGUEL_CONFIG = file
    const res = await call(client, "evaluate_code", {
      runId: "reload-env-broken",
      objective: "typo 修正",
      diff: HARMLESS_DIFF
    })
    expect(res.body.verdict).toBe("ASK")
    expect(res.body.findings[0].ruleId).toBe("kernel/config-error")
    expect(res.body.policy.configSource).toBe(`env:${file}`)
  })

  it("読めない設定では前の設定に戻さず、評価は既定の onError(ASK)で返し、所見に設定のパスと理由を載せる", async () => {
    const file = writeCwdConfig({ onError: "STOP" })
    expect((await call(client, "list_rules", {})).body.onError).toBe("STOP")

    writeCwdConfig({ rules: { "common/secrets": { enabled: false } } })
    touchLater(file, 10)
    for (let i = 0; i < 2; i++) {
      const res = await call(client, "evaluate_code", {
        runId: "reload-broken",
        objective: "typo 修正",
        diff: HARMLESS_DIFF
      })
      expect(res.isError).toBeFalsy()
      expect(res.body.verdict).toBe("ASK")
      expect(res.body.findings[0].ruleId).toBe("kernel/config-error")
      expect(res.body.findings[0].message).toContain(file)
      expect(res.body.findings[0].message).toContain("common/secrets")
      expect(res.body.policy.configSource).toBe(`cwd:${file}`)
    }
    const listing = (await call(client, "list_rules", {})).body
    expect(listing.error).toContain("common/secrets")
    expect(listing.rules).toBeUndefined()

    writeCwdConfig({ onError: "ASK" })
    touchLater(file, 20)
    const fixed = (await call(client, "list_rules", {})).body
    expect(fixed.onError).toBe("ASK")
    expect(fixed.error).toBeUndefined()
  })
})
