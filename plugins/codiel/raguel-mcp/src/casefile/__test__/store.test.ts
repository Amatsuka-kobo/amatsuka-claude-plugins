import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { RaguelConfig } from "../../core/types"
import { CaseStore } from "../store"

function makeConfig(casesDir: string, projectId: string): RaguelConfig {
  return {
    version: 1,
    onError: "ASK",
    storage: {
      casesDir,
      projectId,
      retention: { maxRuns: 200, maxDays: 90 }
    },
    judge: {
      provider: "none",
      model: "haiku",
      timeoutMs: 60000,
      canStop: false,
      maxConcurrency: 4,
      thresholds: { proceed: 80, confidence: 60, maxVariance: 30 }
    },
    weight: { tiers: { standard: 30, critical: 70 } },
    panel: {
      trivial: [],
      standard: [],
      critical: [],
      perPanelist: {}
    },
    precedent: { seedCatalog: true, topN: 5 },
    rules: {}
  }
}

describe("CaseStore", () => {
  let tmpDir: string
  let store: CaseStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-test-"))
    store = new CaseStore(makeConfig(tmpDir, "demo-project"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("attempt を 01 から採番し、同一 kind で 02 に進む", () => {
    const first = store.openAttempt("run-1", "code")
    expect(first.attempt).toBe(1)
    expect(path.basename(first.dir)).toBe("attempt-01")

    const second = store.openAttempt("run-1", "code")
    expect(second.attempt).toBe(2)
    expect(path.basename(second.dir)).toBe("attempt-02")
  })

  it("finalizeVerdict → verifyAttempt が OK になる", () => {
    const { dir, attempt } = store.openAttempt("run-2", "plan")
    store.writeEvidence(dir, "01-rules.json", JSON.stringify({ ok: true }))
    store.writeEvidence(
      dir,
      "02-weight.json",
      JSON.stringify({ tier: "trivial" })
    )

    store.finalizeVerdict(dir, {
      evaluationId: "eval-1",
      runId: "run-2",
      kind: "plan",
      attempt,
      verdict: "PROCEED",
      weightTier: "trivial",
      findings: [],
      policy: { configHash: "abc123", version: 1 }
    })

    const result = store.verifyAttempt(dir)
    expect(result.ok).toBe(true)
    expect(result.mismatches).toEqual([])
  })

  it("証拠ファイルの改竄を verifyAttempt が検知する", () => {
    const { dir, attempt } = store.openAttempt("run-3", "code")
    store.writeEvidence(dir, "01-rules.json", JSON.stringify({ ok: true }))

    store.finalizeVerdict(dir, {
      evaluationId: "eval-2",
      runId: "run-3",
      kind: "code",
      attempt,
      verdict: "PROCEED",
      weightTier: "trivial",
      findings: [],
      policy: { configHash: "abc123", version: 1 }
    })

    // 証拠ファイルを 1 バイトでも書き換える
    fs.writeFileSync(
      path.join(dir, "01-rules.json"),
      JSON.stringify({ ok: false })
    )

    const result = store.verifyAttempt(dir)
    expect(result.ok).toBe(false)
    expect(result.mismatches.length).toBeGreaterThan(0)
  })

  it("不正な runId(path traversal)は拒否する", () => {
    expect(() => store.openAttempt("../evil", "code")).toThrow()
    expect(() => store.openAttempt("..", "code")).toThrow()
    expect(() => store.openAttempt("foo/bar", "code")).toThrow()
  })

  it("evaluations.jsonl への追記と evaluationId での逆引きができる", () => {
    store.appendEvaluationIndex({
      evaluationId: "eval-a",
      runId: "run-4",
      kind: "code",
      attempt: 1,
      casePath: "/tmp/somewhere",
      verdict: "ASK",
      at: new Date().toISOString()
    })
    store.appendEvaluationIndex({
      evaluationId: "eval-b",
      runId: "run-4",
      kind: "code",
      attempt: 2,
      casePath: "/tmp/somewhere-else",
      verdict: "STOP",
      at: new Date().toISOString()
    })

    expect(store.lookupEvaluation("eval-a")?.verdict).toBe("ASK")
    expect(store.lookupEvaluation("eval-b")?.verdict).toBe("STOP")
    expect(store.lookupEvaluation("missing")).toBeUndefined()
  })

  it("readPriorSubmissions は壊れた attempt をスキップする", () => {
    const first = store.openAttempt("run-5", "decision")
    store.writeSubmissionDigest(first.dir, {
      attempt: 1,
      verdict: "ASK",
      sha256: "abc",
      shingleHashes: [1, 2, 3]
    })
    const second = store.openAttempt("run-5", "decision")
    // submission-digest.json を書かない = 存在しない attempt はスキップされる想定
    void second

    const digests = store.readPriorSubmissions("run-5", "decision")
    expect(digests).toHaveLength(1)
    expect(digests[0].attempt).toBe(1)
  })

  it("sweepRetention は maxRuns 超過分の古い run を削除する", () => {
    const config = makeConfig(tmpDir, "retention-project")
    config.storage.retention = { maxRuns: 2, maxDays: 9999 }
    const retentionStore = new CaseStore(config)

    const runIds = ["run-old", "run-mid", "run-new"]
    const dirs: string[] = []
    for (const runId of runIds) {
      const { dir } = retentionStore.openAttempt(runId, "code")
      retentionStore.writeEvidence(dir, "01-rules.json", "{}")
      dirs.push(path.join(tmpDir, "cases", "retention-project", runId))
    }

    // mtime を明示的にずらす(新しい順: run-new > run-mid > run-old)
    const now = Date.now()
    fs.utimesSync(dirs[0], new Date(now - 3000), new Date(now - 3000))
    fs.utimesSync(dirs[1], new Date(now - 2000), new Date(now - 2000))
    fs.utimesSync(dirs[2], new Date(now - 1000), new Date(now - 1000))

    retentionStore.sweepRetention()

    expect(fs.existsSync(dirs[0])).toBe(false) // 最古 → 削除
    expect(fs.existsSync(dirs[1])).toBe(true)
    expect(fs.existsSync(dirs[2])).toBe(true)
  })
})
