/**
 * MCP レイヤの統合スモーク: InMemoryTransport でサーバーとクライアントを接続し、
 * list_rules / evaluate_code をエンドツーエンドで検証する。
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CaseStore } from "../casefile/store.js"
import type { PipelineDeps } from "../core/pipeline.js"
import type { RaguelConfig } from "../core/types.js"
import { FakeJudgeProvider } from "../panel/testing/fakeProvider.js"
import { registerEvaluateCode } from "./evaluateCode.js"
import { registerListRules } from "./listRules.js"

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

describe("MCP ツール統合スモーク", () => {
  let tmp: string
  let client: Client

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-tools-"))
    const config = makeConfig(tmp)
    const deps: PipelineDeps = {
      config,
      configHash: "tools-hash",
      caseStore: new CaseStore(config),
      provider: new FakeJudgeProvider()
    }
    const server = new McpServer({ name: "raguel-mcp", version: "test" })
    registerEvaluateCode(server, deps)
    registerListRules(server, deps)

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: "test-client", version: "0.0.0" })
    await client.connect(clientTransport)
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("list_rules がルール一覧と configHash を返す", async () => {
    const res = await client.callTool({ name: "list_rules", arguments: {} })
    const body = JSON.parse(
      (res.content as Array<{ type: string; text: string }>)[0].text
    )
    expect(body.rules.length).toBeGreaterThan(10)
    expect(
      body.rules.find((r: { id: string }) => r.id === "common/secrets")?.sealed
    ).toBe(true)
    expect(body.policy.configHash).toBe("tools-hash")
  })

  it("evaluate_code: 無害 diff → PROCEED", async () => {
    const res = await client.callTool({
      name: "evaluate_code",
      arguments: {
        runId: "smoke-1",
        objective: "typo 修正",
        diff: [
          "diff --git a/src/a.ts b/src/a.ts",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1,1 +1,2 @@",
          " const x = 1",
          "+const y = 2"
        ].join("\n")
      }
    })
    const body = JSON.parse(
      (res.content as Array<{ type: string; text: string }>)[0].text
    )
    expect(body.verdict).toBe("PROCEED")
    expect(body.casePath).toContain("smoke-1")
  })

  it("evaluate_code: 保護パス diff → STOP", async () => {
    const res = await client.callTool({
      name: "evaluate_code",
      arguments: {
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
      }
    })
    const body = JSON.parse(
      (res.content as Array<{ type: string; text: string }>)[0].text
    )
    expect(body.verdict).toBe("STOP")
  })

  it("evaluate_code: diff も files もない入力はフェイルクローズドで ASK", async () => {
    const res = await client.callTool({
      name: "evaluate_code",
      arguments: { runId: "smoke-3", objective: "何か" }
    })
    const body = JSON.parse(
      (res.content as Array<{ type: string; text: string }>)[0].text
    )
    expect(body.verdict).toBe("ASK")
    expect(body.findings[0].ruleId).toBe("kernel/internal-error")
  })

  it("evaluate_code: 不正な runId は zod で拒否される", async () => {
    const res = await client.callTool({
      name: "evaluate_code",
      arguments: { runId: "../evil", objective: "攻撃", diff: "x" }
    })
    expect(res.isError).toBe(true)
  })
})
