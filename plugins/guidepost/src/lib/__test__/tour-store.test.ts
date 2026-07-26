import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { tourDir, toursDir } from "../paths.js"
import {
  answerPath,
  listAnswers,
  listTours,
  makeTourId,
  readTour,
  validateTour,
  writeTour
} from "../tour-store.js"
import type { Tour } from "../types.js"

function withTmpDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidepost-tour-store-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function validTour(overrides: Partial<Tour> = {}): Tour {
  return {
    version: 1,
    tourId: "20260726-153000-def5678",
    title: "認証フローのリファクタリング",
    baseSha: "abc123456789",
    headSha: "def567890123",
    source: { type: "range", value: "HEAD~3..HEAD" },
    stops: [
      {
        id: "stop-01",
        file: "src/auth/session.ts",
        hunk: { oldStart: 10, oldLines: 5, newStart: 10, newLines: 22 },
        diffText: "@@ -10,5 +10,22 @@\n-old\n+new",
        title: "セッション型の再定義",
        what: "セッション型を変更する",
        why: "責務を明確にするため",
        ifBroken: "認証できなくなる"
      }
    ],
    ...overrides
  }
}

test("makeTourId は日時と短縮 SHA から ID を作る", () => {
  const date = new Date(2026, 6, 26, 15, 30, 0)
  expect(makeTourId(date, "def567890123")).toBe("20260726-153000-def5678")
})

test("正常な tour.json を書き込み、読み戻せる", () => {
  withTmpDir((projectDir) => {
    const tour = validTour()
    writeTour(projectDir, tour)

    expect(readTour(projectDir, tour.tourId)).toEqual({ tour })
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(tourDir(projectDir, tour.tourId), "tour.json"),
          "utf8"
        )
      )
    ).toEqual(tour)
  })
})

test("validateTour は version 2 を拒否する", () => {
  expect(validateTour({ ...validTour(), version: 2 })).toHaveProperty("error")
})

test("validateTour は空の stops を拒否する", () => {
  expect(validateTour({ ...validTour(), stops: [] })).toHaveProperty("error")
})

test("validateTour は 21 件の stops を拒否する", () => {
  const stop = validTour().stops[0]
  const stops = Array.from({ length: 21 }, (_, index) => ({
    ...stop,
    id: `stop-${String(index + 1).padStart(2, "0")}`
  }))
  expect(validateTour({ ...validTour(), stops })).toHaveProperty("error")
})

test("validateTour は stop id の重複を拒否する", () => {
  const stop = validTour().stops[0]
  expect(
    validateTour({ ...validTour(), stops: [stop, { ...stop }] })
  ).toHaveProperty("error")
})

test("validateTour は必須フィールド欠落を拒否する", () => {
  const value = { ...validTour() } as Record<string, unknown>
  delete value.title
  expect(validateTour(value)).toHaveProperty("error")
})

test("validateTour は不正な source.type を拒否する", () => {
  expect(
    validateTour({
      ...validTour(),
      source: { type: "branch", value: "main" }
    })
  ).toHaveProperty("error")
})

test("validateTour は不完全な hunk を拒否する", () => {
  const stop = validTour().stops[0]
  expect(
    validateTour({
      ...validTour(),
      stops: [{ ...stop, hunk: { oldStart: 1, oldLines: 2 } }]
    })
  ).toHaveProperty("error")
})

test("listTours は新しい順に正常・壊れたツアーを列挙する", () => {
  withTmpDir((projectDir) => {
    const older = validTour({
      tourId: "20260725-120000-abc1234",
      title: "古いツアー"
    })
    const newer = validTour()
    writeTour(projectDir, older)
    writeTour(projectDir, newer)

    const brokenId = "20260727-090000-fffffff"
    const brokenDir = tourDir(projectDir, brokenId)
    fs.mkdirSync(brokenDir, { recursive: true })
    fs.writeFileSync(path.join(brokenDir, "tour.json"), "{ broken")

    const entries = listTours(projectDir)
    expect(entries.map((entry) => entry.tourId)).toEqual([
      brokenId,
      newer.tourId,
      older.tourId
    ])
    expect(entries[0]).toMatchObject({
      tourId: brokenId,
      title: brokenId,
      stopCount: 0
    })
    expect(entries[0].error).toEqual(expect.any(String))
    expect(entries[1]).toEqual({
      tourId: newer.tourId,
      title: newer.title,
      createdAt: "2026-07-26T15:30:00",
      stopCount: 1
    })
  })
})

test("readTour はパストラバーサルとセパレータを拒否する", () => {
  withTmpDir((projectDir) => {
    expect(readTour(projectDir, "../../etc")).toHaveProperty("error")
    expect(readTour(projectDir, "foo/bar")).toHaveProperty("error")
    expect(readTour(projectDir, "foo\\bar")).toHaveProperty("error")
  })
})

test("listAnswers は命名規則外を無視し ts 昇順で返す", () => {
  withTmpDir((projectDir) => {
    const tourId = validTour().tourId
    const dir = path.dirname(
      answerPath(projectDir, tourId, "stop-01", "20260726T153002000")
    )
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "stop-02-20260726T153003000.md"), "3 番目")
    fs.writeFileSync(path.join(dir, "stop-01-20260726T153001000.md"), "1 番目")
    fs.writeFileSync(path.join(dir, "stop-01-20260726T153002000.md"), "2 番目")
    fs.writeFileSync(path.join(dir, "stop-03-2026-07-26T153004.md"), "4 番目")
    fs.writeFileSync(path.join(dir, "invalid.md"), "無視")
    fs.mkdirSync(path.join(dir, "stop-01-20260726T153000000.md"))

    expect(listAnswers(projectDir, tourId)).toEqual([
      {
        stopId: "stop-03",
        ts: "2026-07-26T153004",
        body: "4 番目"
      },
      {
        stopId: "stop-01",
        ts: "20260726T153001000",
        body: "1 番目"
      },
      {
        stopId: "stop-01",
        ts: "20260726T153002000",
        body: "2 番目"
      },
      {
        stopId: "stop-02",
        ts: "20260726T153003000",
        body: "3 番目"
      }
    ])
  })
})

test(".guidepost がなくても読み取り関数は例外を投げない", () => {
  withTmpDir((projectDir) => {
    expect(listTours(projectDir)).toEqual([])
    expect(listAnswers(projectDir, validTour().tourId)).toEqual([])
    expect(readTour(projectDir, validTour().tourId)).toHaveProperty("error")
    expect(fs.existsSync(toursDir(projectDir))).toBe(false)
  })
})
