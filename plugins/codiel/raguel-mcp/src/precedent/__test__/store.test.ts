import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Precedent, RaguelConfig } from "../../core/types"
import { loadCorpus, PrecedentStore } from "../store"

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
    panel: { trivial: [], standard: [], critical: [], perPanelist: {} },
    precedent: { seedCatalog: true, topN: 5 },
    rules: {}
  }
}

function makePrecedent(id: string): Precedent {
  return {
    id,
    source: "project",
    kind: "code",
    outcome: "rejected",
    summary: "テスト用の判例",
    firedRules: ["common/secrets"],
    changedPaths: ["src/foo.ts"],
    lesson: "テスト用の教訓"
  }
}

describe("PrecedentStore", () => {
  let tmpDir: string
  let config: RaguelConfig
  let store: PrecedentStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-test-"))
    config = makeConfig(tmpDir, "demo-project")
    store = new PrecedentStore(config)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("record → loadAll で判例が復元できる", () => {
    store.record(makePrecedent("proj-001"))
    store.record(makePrecedent("proj-002"))

    const { precedents, tampered } = store.loadAll()
    expect(tampered).toEqual([])
    expect(precedents.map((p) => p.id).sort()).toEqual(["proj-001", "proj-002"])
  })

  it("index.json の改竄で対象判例が tampered に入る", () => {
    store.record(makePrecedent("proj-003"))

    const indexPath = path.join(
      tmpDir,
      "precedents",
      "demo-project",
      "index.json"
    )
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    index["proj-003"] = "0".repeat(64) // 正しくないハッシュに改竄
    fs.writeFileSync(indexPath, JSON.stringify(index), "utf-8")

    const { precedents, tampered } = store.loadAll()
    expect(precedents).toEqual([])
    expect(tampered).toEqual(["proj-003"])
  })

  it("index.json に登録のないファイルも tampered として除外する", () => {
    const dir = path.join(tmpDir, "precedents", "demo-project")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "rogue.json"),
      JSON.stringify(makePrecedent("rogue")),
      "utf-8"
    )
    fs.writeFileSync(path.join(dir, "index.json"), "{}", "utf-8")

    const { precedents, tampered } = store.loadAll()
    expect(precedents).toEqual([])
    expect(tampered).toEqual(["rogue"])
  })

  it("存在しないディレクトリでは空を返す", () => {
    const { precedents, tampered } = store.loadAll()
    expect(precedents).toEqual([])
    expect(tampered).toEqual([])
  })

  it("loadCorpus はプロジェクト判例とシード判例を連結する", () => {
    store.record(makePrecedent("proj-004"))
    const corpus = loadCorpus(config)
    expect(corpus.some((p) => p.id === "proj-004")).toBe(true)
    expect(corpus.some((p) => p.source === "seed")).toBe(true)
  })

  it("seedCatalog: false ならシード判例を含めない", () => {
    config.precedent.seedCatalog = false
    store.record(makePrecedent("proj-005"))
    const corpus = loadCorpus(config)
    expect(corpus.every((p) => p.source !== "seed")).toBe(true)
  })
})
