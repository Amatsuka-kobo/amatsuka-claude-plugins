import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Precedent, RaguelConfig } from "../../core/types"
import { makeConfig as baseConfig } from "../../rules/testHelpers"
import { searchPrecedents } from "../retrieval"
import { filterFiredRules, loadCorpus, PrecedentStore } from "../store"

function makeConfig(casesDir: string, projectId: string): RaguelConfig {
  const config = baseConfig()
  config.storage = { ...config.storage, casesDir, projectId }
  return config
}

function makePrecedent(
  id: string,
  overrides: Partial<Precedent> = {}
): Precedent {
  return {
    id,
    source: "project",
    kind: "code",
    outcome: "rejected",
    summary: "テスト用の判例",
    firedRules: ["common/secrets"],
    changedPaths: ["src/foo.ts"],
    lesson: "テスト用の教訓",
    ...overrides
  }
}

describe("PrecedentStore", () => {
  let tmpDir: string
  let config: RaguelConfig
  let store: PrecedentStore
  let storeDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-test-"))
    config = makeConfig(tmpDir, "demo-project")
    store = new PrecedentStore(config, tmpDir)
    storeDir = path.join(tmpDir, "precedents", "demo-project")
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

  it("phase と ruling を保存して読み戻せる", () => {
    store.record(
      makePrecedent("proj-phase", { phase: "design", ruling: "false-positive" })
    )
    const [p] = store.loadAll().precedents
    expect(p.phase).toBe("design")
    expect(p.ruling).toBe("false-positive")
  })

  it("索引は sha256・retiredAt・retireReason の形で書き、一時ファイルを残さない", () => {
    store.record(makePrecedent("proj-idx"))
    const index = JSON.parse(
      fs.readFileSync(path.join(storeDir, "index.json"), "utf-8")
    )
    expect(index["proj-idx"]).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      retiredAt: null,
      retireReason: null
    })
    expect(fs.readdirSync(storeDir).filter((f) => f.endsWith(".tmp"))).toEqual(
      []
    )
  })

  it("旧形式の索引(id → sha256 の文字列)も読める", () => {
    store.record(makePrecedent("proj-old"))
    const indexPath = path.join(storeDir, "index.json")
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    fs.writeFileSync(
      indexPath,
      JSON.stringify({ "proj-old": index["proj-old"].sha256 }),
      "utf-8"
    )
    expect(store.loadAll().precedents.map((p) => p.id)).toEqual(["proj-old"])
  })

  it("index.json の改竄で対象判例が tampered に入る", () => {
    store.record(makePrecedent("proj-003"))

    const indexPath = path.join(storeDir, "index.json")
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    index["proj-003"].sha256 = "0".repeat(64) // 正しくないハッシュに改竄
    fs.writeFileSync(indexPath, JSON.stringify(index), "utf-8")

    const { precedents, tampered } = store.loadAll()
    expect(precedents).toEqual([])
    expect(tampered).toEqual(["proj-003"])
  })

  it("判例ファイルの中身を書き換えると tampered に入る", () => {
    store.record(makePrecedent("proj-edit"))
    fs.writeFileSync(
      path.join(storeDir, "proj-edit.json"),
      JSON.stringify(makePrecedent("proj-edit", { lesson: "捏造" })),
      "utf-8"
    )
    expect(store.loadAll().tampered).toEqual(["proj-edit"])
  })

  it("index.json に登録のないファイルも tampered として除外する", () => {
    fs.mkdirSync(storeDir, { recursive: true })
    fs.writeFileSync(
      path.join(storeDir, "rogue.json"),
      JSON.stringify(makePrecedent("rogue")),
      "utf-8"
    )
    fs.writeFileSync(path.join(storeDir, "index.json"), "{}", "utf-8")

    const { precedents, tampered } = store.loadAll()
    expect(precedents).toEqual([])
    expect(tampered).toEqual(["rogue"])
  })

  it("存在しないディレクトリでは空を返す", () => {
    const { precedents, tampered } = store.loadAll()
    expect(precedents).toEqual([])
    expect(tampered).toEqual([])
  })

  describe("読めない索引", () => {
    it("record は例外にし、索引も既存の判例も上書きしない", () => {
      store.record(makePrecedent("proj-keep"))
      const indexPath = path.join(storeDir, "index.json")
      fs.writeFileSync(indexPath, "{ broken", "utf-8")

      expect(() => store.record(makePrecedent("proj-new"))).toThrow(
        /索引が読めません/
      )
      expect(fs.readFileSync(indexPath, "utf-8")).toBe("{ broken")
      expect(fs.existsSync(path.join(storeDir, "proj-new.json"))).toBe(false)
      expect(fs.existsSync(path.join(storeDir, "proj-keep.json"))).toBe(true)
    })

    it("索引の行の形が不正でも record は例外にする", () => {
      store.record(makePrecedent("proj-keep"))
      const indexPath = path.join(storeDir, "index.json")
      fs.writeFileSync(indexPath, JSON.stringify({ "proj-keep": 42 }), "utf-8")
      expect(() => store.record(makePrecedent("proj-new"))).toThrow(
        /索引の行が読めません/
      )
    })

    it("retire も例外にする", () => {
      store.record(makePrecedent("proj-keep"))
      fs.writeFileSync(path.join(storeDir, "index.json"), "{ broken", "utf-8")
      expect(() => store.retire("proj-keep", "理由")).toThrow(
        /索引が読めません/
      )
    })

    it("loadAll は例外にせず、プロジェクトの判例を使わない", () => {
      store.record(makePrecedent("proj-keep"))
      fs.writeFileSync(path.join(storeDir, "index.json"), "{ broken", "utf-8")
      expect(store.loadAll()).toEqual({
        precedents: [],
        tampered: ["index.json"]
      })
    })
  })

  describe("退役", () => {
    it("retire は索引に retiredAt と retireReason を書き、判例のファイルを変えない", () => {
      store.record(makePrecedent("proj-r1"))
      const filePath = path.join(storeDir, "proj-r1.json")
      const before = fs.readFileSync(filePath, "utf-8")

      const result = store.retire(
        "proj-r1",
        "誤検知だった",
        new Date("2026-09-29T01:02:03.000Z")
      )
      expect(result).toEqual({ retired: true })

      expect(fs.readFileSync(filePath, "utf-8")).toBe(before)
      const index = JSON.parse(
        fs.readFileSync(path.join(storeDir, "index.json"), "utf-8")
      )
      expect(index["proj-r1"].retiredAt).toBe("2026-09-29T01:02:03.000Z")
      expect(index["proj-r1"].retireReason).toBe("誤検知だった")
      // 改竄とは扱われない
      const { precedents, tampered } = store.loadAll()
      expect(tampered).toEqual([])
      expect(precedents[0].retiredAt).toBe("2026-09-29T01:02:03.000Z")
    })

    it("存在しない id・すでに退役した id・不正な id は retired: false と理由を返す", () => {
      store.record(makePrecedent("proj-r2"))
      expect(store.retire("nothing", "x")).toMatchObject({ retired: false })
      expect(store.retire("../evil", "x")).toMatchObject({ retired: false })
      expect(store.retire("proj-r2", "x")).toEqual({ retired: true })
      expect(store.retire("proj-r2", "y")).toMatchObject({
        retired: false,
        reason: expect.stringContaining("すでに退役")
      })
    })

    it("退役した判例は同じ id で record し直しても復活しない(所見 W4R1-07)", () => {
      expect(store.record(makePrecedent("proj-r4"))).toBe(true)
      store.retire("proj-r4", "古い", new Date("2026-09-29T01:02:03.000Z"))
      const filePath = path.join(storeDir, "proj-r4.json")
      const before = fs.readFileSync(filePath, "utf-8")

      expect(
        store.record(makePrecedent("proj-r4", { lesson: "書き換えた教訓" }))
      ).toBe(false)
      expect(fs.readFileSync(filePath, "utf-8")).toBe(before)
      const index = JSON.parse(
        fs.readFileSync(path.join(storeDir, "index.json"), "utf-8")
      )
      expect(index["proj-r4"]).toMatchObject({
        retiredAt: "2026-09-29T01:02:03.000Z",
        retireReason: "古い"
      })
      expect(store.list()).toEqual([])
      expect(store.loadAll().tampered).toEqual([])
    })

    it("シード判例は退役できない", () => {
      expect(store.retire("seed-001", "x")).toMatchObject({ retired: false })
    })

    it("退役した判例は loadCorpus を通しても検索に出ない", () => {
      store.record(
        makePrecedent("proj-r3", { summary: "ハードコードされたAPIキーの混入" })
      )
      store.retire("proj-r3", "古い")
      config.precedent.seedCatalog = false
      const query = {
        kind: "code" as const,
        objective: "APIキー",
        summaryText: "ハードコードされたAPIキーの混入",
        firedRules: ["common/secrets"],
        changedPaths: [] as string[]
      }
      expect(searchPrecedents(query, loadCorpus(config, tmpDir), 5)).toEqual([])
    })
  })

  describe("list", () => {
    beforeEach(() => {
      store.record(
        makePrecedent("proj-a", {
          phase: "design",
          outcome: "approved",
          ruling: "as-is",
          recordedAt: "2026-09-01T00:00:00.000Z"
        })
      )
      store.record(
        makePrecedent("proj-b", {
          phase: "implement",
          outcome: "rejected",
          recordedAt: "2026-09-02T00:00:00.000Z"
        })
      )
      store.record(
        makePrecedent("proj-c", {
          phase: "implement",
          outcome: "incident",
          recordedAt: "2026-09-03T00:00:00.000Z"
        })
      )
      store.retire("proj-c", "古い")
    })

    it("既定では退役した判例を含めず、必要な列だけを返す", () => {
      const rows = store.list()
      expect(rows.map((r) => r.id)).toEqual(["proj-a", "proj-b"])
      expect(rows[0]).toEqual({
        id: "proj-a",
        source: "project",
        phase: "design",
        outcome: "approved",
        ruling: "as-is",
        firedRules: ["common/secrets"],
        recordedAt: "2026-09-01T00:00:00.000Z",
        retiredAt: null
      })
    })

    it("includeRetired で退役した判例も返し、retiredAt を持つ", () => {
      const rows = store.list({ includeRetired: true })
      expect(rows.map((r) => r.id)).toEqual(["proj-a", "proj-b", "proj-c"])
      expect(rows[2].retiredAt).not.toBeNull()
    })

    it("outcome と phase で絞る", () => {
      expect(store.list({ outcome: "rejected" }).map((r) => r.id)).toEqual([
        "proj-b"
      ])
      expect(
        store
          .list({ phase: "implement", includeRetired: true })
          .map((r) => r.id)
      ).toEqual(["proj-b", "proj-c"])
    })
  })

  it("loadCorpus はプロジェクト判例とシード判例を連結する", () => {
    store.record(makePrecedent("proj-004"))
    const corpus = loadCorpus(config, tmpDir)
    expect(corpus.some((p) => p.id === "proj-004")).toBe(true)
    expect(corpus.some((p) => p.source === "seed")).toBe(true)
  })

  it("seedCatalog: false ならシード判例を含めない", () => {
    config.precedent.seedCatalog = false
    store.record(makePrecedent("proj-005"))
    const corpus = loadCorpus(config, tmpDir)
    expect(corpus.every((p) => p.source !== "seed")).toBe(true)
  })
})

describe("filterFiredRules", () => {
  it("panel/*-error・kernel/*・rule-error を除き、通常のルール ID は残す(所見 G2)", () => {
    expect(
      filterFiredRules([
        "common/secrets",
        "panel/adversarial-error",
        "panel/meta-error",
        "kernel/config-error",
        "kernel/internal-error",
        "rule-error",
        "casefile/tampered",
        "code/protected-paths"
      ])
    ).toEqual(["common/secrets", "casefile/tampered", "code/protected-paths"])
  })
})
