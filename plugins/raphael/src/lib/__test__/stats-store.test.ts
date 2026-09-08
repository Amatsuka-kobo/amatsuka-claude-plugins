import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import {
  isIneffective,
  loadStats,
  pruneOrphanStats,
  type RaphaelStatsV1,
  recordFire,
  recordFires,
  recordMiss,
  saveStats,
  setNagDigest,
  statsFilePath,
  statsFor
} from "../stats-store.js"

const projects: string[] = []

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-stats-"))
  projects.push(dir)
  return dir
}

function stats(
  antibodies: RaphaelStatsV1["antibodies"] = {},
  digest: string | null = null
): RaphaelStatsV1 {
  return {
    schema_version: 1,
    antibodies,
    distill: { last_nag_digest: digest }
  }
}

function writeRaw(dir: string, value: string): void {
  const file = statsFilePath(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value)
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of projects.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("欠損時は初期値を返し、save/load を往復する", () => {
  const dir = project()
  expect(loadStats(dir)).toEqual(stats())

  const value = stats(
    {
      "ab-2026-0724-001": {
        fired: 2,
        last_fired: "2026-07-24",
        misses: 1,
        last_miss: "2026-07-23"
      }
    },
    "a".repeat(64)
  )
  saveStats(dir, value)

  expect(loadStats(dir)).toEqual(value)
  expect(fs.readFileSync(statsFilePath(dir), "utf8")).toBe(
    `${JSON.stringify(value, null, 2)}\n`
  )
})

test.each([
  ["JSON parse 失敗", "{broken"],
  ["top-level が object でない", "[]"],
  ["antibodies が object でない", JSON.stringify({ antibodies: [] })]
])("破損の 3 条件: %s は全体を初期値にする", (_name, raw) => {
  const dir = project()
  writeRaw(dir, raw)
  expect(loadStats(dir)).toEqual(stats())
})

test("個別 entry の型不正はその entry だけ初期値にし、他 entry と distill を保持する", () => {
  const dir = project()
  const digest = "b".repeat(64)
  writeRaw(
    dir,
    JSON.stringify({
      schema_version: 99,
      antibodies: {
        "ab-2026-0724-001": {
          fired: "bad",
          last_fired: "2026-07-24",
          misses: 1,
          last_miss: null
        },
        "ab-2026-0724-002": {
          fired: 3,
          last_fired: "2026-07-25",
          misses: 2,
          last_miss: "2026-07-24"
        },
        invalid: {
          fired: 9,
          last_fired: null,
          misses: 9,
          last_miss: null
        }
      },
      distill: { last_nag_digest: digest }
    })
  )

  expect(loadStats(dir)).toEqual(
    stats(
      {
        "ab-2026-0724-001": {
          fired: 0,
          last_fired: null,
          misses: 0,
          last_miss: null
        },
        "ab-2026-0724-002": {
          fired: 3,
          last_fired: "2026-07-25",
          misses: 2,
          last_miss: "2026-07-24"
        }
      },
      digest
    )
  )
})

test.each([
  null,
  [],
  { last_nag_digest: "A".repeat(64) },
  { last_nag_digest: "short" }
])("不正な distill %j は distill だけ初期値にする", (distill) => {
  const dir = project()
  writeRaw(
    dir,
    JSON.stringify({
      schema_version: 1,
      antibodies: {
        "ab-2026-0724-001": {
          fired: 1,
          last_fired: null,
          misses: 0,
          last_miss: null
        }
      },
      distill
    })
  )

  expect(loadStats(dir)).toEqual(
    stats({
      "ab-2026-0724-001": {
        fired: 1,
        last_fired: null,
        misses: 0,
        last_miss: null
      }
    })
  )
})

test("statsFor は欠損を 0/null とし、保存値を返す", () => {
  const value = stats({
    "ab-2026-0724-001": {
      fired: 4,
      last_fired: "2026-07-24",
      misses: 2,
      last_miss: "2026-07-23"
    }
  })
  expect(statsFor(value, "ab-2026-0724-001")).toEqual(
    value.antibodies["ab-2026-0724-001"]
  )
  expect(statsFor(value, "ab-2026-0724-999")).toEqual({
    fired: 0,
    last_fired: null,
    misses: 0,
    last_miss: null
  })
})

test("recordFire と recordFires は 1 回ずつ加算し last_fired を max merge する", () => {
  const dir = project()
  saveStats(
    dir,
    stats({
      "ab-2026-0724-001": {
        fired: 2,
        last_fired: "2026-07-26",
        misses: 1,
        last_miss: null
      }
    })
  )

  expect(recordFire(dir, "ab-2026-0724-001", new Date(2026, 6, 25))).toEqual({
    fired: 3,
    last_fired: "2026-07-26",
    misses: 1,
    last_miss: null
  })
  recordFires(
    dir,
    ["ab-2026-0724-001", "ab-2026-0724-002"],
    new Date(2026, 6, 27)
  )
  expect(loadStats(dir).antibodies).toEqual({
    "ab-2026-0724-001": {
      fired: 4,
      last_fired: "2026-07-27",
      misses: 1,
      last_miss: null
    },
    "ab-2026-0724-002": {
      fired: 1,
      last_fired: "2026-07-27",
      misses: 0,
      last_miss: null
    }
  })
})

test("recordFires は selected 全件を 1 回の atomic save で更新する", () => {
  const dir = project()
  const rename = vi.spyOn(fs, "renameSync")

  recordFires(
    dir,
    ["ab-2026-0724-001", "ab-2026-0724-002", "ab-2026-0724-003"],
    new Date(2026, 6, 25)
  )

  expect(rename).toHaveBeenCalledTimes(1)
})

test("recordMiss は加算し last_miss を max merge する", () => {
  const dir = project()
  saveStats(
    dir,
    stats({
      "ab-2026-0724-001": {
        fired: 5,
        last_fired: null,
        misses: 2,
        last_miss: "2026-07-26"
      }
    })
  )

  expect(recordMiss(dir, "ab-2026-0724-001", new Date(2026, 6, 25))).toEqual({
    fired: 5,
    last_fired: null,
    misses: 3,
    last_miss: "2026-07-26"
  })
  expect(recordMiss(dir, "ab-2026-0724-001", new Date(2026, 6, 27))).toEqual({
    fired: 5,
    last_fired: null,
    misses: 4,
    last_miss: "2026-07-27"
  })
})

test.each([
  [{ fired: 9, misses: 9 }, false],
  [{ fired: 10, misses: 5 }, true],
  [{ fired: 10, misses: 4 }, false]
])("isIneffective の境界を整数演算で判定する", (value, expected) => {
  expect(
    isIneffective(
      {
        ...value,
        last_fired: null,
        last_miss: null
      },
      {
        ineffectiveMinFired: 10,
        ineffectiveMissRatio: 50
      }
    )
  ).toBe(expected)
})

test("isIneffective は config の閾値を使う", () => {
  expect(
    isIneffective(
      { fired: 4, last_fired: null, misses: 1, last_miss: null },
      { ineffectiveMinFired: 4, ineffectiveMissRatio: 25 }
    )
  ).toBe(true)
})

test("pruneOrphanStats は既知 ID 以外だけ削除する", () => {
  const dir = project()
  saveStats(
    dir,
    stats({
      "ab-2026-0724-001": {
        fired: 1,
        last_fired: null,
        misses: 0,
        last_miss: null
      },
      "ab-2026-0724-002": {
        fired: 2,
        last_fired: null,
        misses: 0,
        last_miss: null
      }
    })
  )

  expect(pruneOrphanStats(dir, ["ab-2026-0724-002"])).toBe(1)
  expect(Object.keys(loadStats(dir).antibodies)).toEqual(["ab-2026-0724-002"])
  expect(pruneOrphanStats(dir, ["ab-2026-0724-002"])).toBe(0)
})

test("saveStats と setNagDigest は temp+rename の atomic 置換を使う", () => {
  const dir = project()
  const rename = vi.spyOn(fs, "renameSync")

  saveStats(dir, stats())
  setNagDigest(dir, "c".repeat(64))

  expect(rename).toHaveBeenCalledTimes(2)
  expect(loadStats(dir).distill.last_nag_digest).toBe("c".repeat(64))
  expect(
    fs
      .readdirSync(path.dirname(statsFilePath(dir)))
      .filter((name) => name.startsWith(".tmp-"))
  ).toEqual([])
})
