import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { handleRequest } from "../http-handler.js"
import { questionsDir, tourDir } from "../paths.js"
import { answerPath, writeTour } from "../tour-store.js"
import type { Tour } from "../types.js"

function withTmpDir(fn: (projectDir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidepost-http-handler-"))
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
        title: "セッション型の再定義",
        what: "セッション型を変更する",
        why: "責務を明確にするため",
        ifBroken: "認証できなくなる"
      }
    ],
    ...overrides
  }
}

function parseBody(result: { body: string }): unknown {
  return JSON.parse(result.body)
}

test("GET / は HTML を返す", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "<!doctype html><title>guidepost</title>" },
      "GET",
      "/",
      ""
    )

    expect(result).toEqual({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>guidepost</title>"
    })
  })
})

test("GET /api/tours はツアー一覧を返す", () => {
  withTmpDir((projectDir) => {
    const tour = validTour()
    writeTour(projectDir, tour)

    const result = handleRequest(
      { projectDir, html: "" },
      "GET",
      "/api/tours",
      ""
    )

    expect(result.status).toBe(200)
    expect(result.contentType).toBe("application/json")
    expect(parseBody(result)).toEqual([
      {
        tourId: tour.tourId,
        title: tour.title,
        createdAt: "2026-07-26T15:30:00",
        stopCount: 1
      }
    ])
  })
})

test("GET /api/tours/<id> はツアーと回答を返す", () => {
  withTmpDir((projectDir) => {
    const tour = validTour()
    writeTour(projectDir, tour)
    const file = answerPath(
      projectDir,
      tour.tourId,
      "stop-01",
      "20260726T153001000"
    )
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "型の責務を分離するためです。")

    const result = handleRequest(
      { projectDir, html: "" },
      "GET",
      `/api/tours/${tour.tourId}`,
      ""
    )

    expect(result.status).toBe(200)
    expect(parseBody(result)).toEqual({
      tour,
      answers: [
        {
          stopId: "stop-01",
          ts: "20260726T153001000",
          body: "型の責務を分離するためです。"
        }
      ]
    })
  })
})

test("存在しない tourId は 404 を返す", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "GET",
      "/api/tours/missing-tour",
      ""
    )

    expect(result.status).toBe(404)
    expect(parseBody(result)).toEqual({ error: "not found" })
  })
})

test("未知のパスは 404 を返す", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "GET",
      "/unknown",
      ""
    )

    expect(result.status).toBe(404)
    expect(parseBody(result)).toEqual({ error: "not found" })
  })
})

test("不正な JSON は 400 を返す", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "POST",
      "/api/questions",
      "{ broken"
    )

    expect(result.status).toBe(400)
    expect(parseBody(result)).toEqual({ error: "bad json" })
  })
})

test("空文字の question は bad field を返す", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "POST",
      "/api/questions",
      JSON.stringify({ tourId: "tour-001", stopId: "stop-01", question: "" })
    )

    expect(result.status).toBe(400)
    expect(parseBody(result)).toEqual({ error: "bad field" })
    expect(fs.existsSync(questionsDir(projectDir))).toBe(false)
  })
})

test("空白のみの question は writeQuestion の null を 400 にする", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "POST",
      "/api/questions",
      JSON.stringify({
        tourId: "tour-001",
        stopId: "stop-01",
        question: " \t "
      })
    )

    expect(result.status).toBe(400)
    expect(parseBody(result)).toEqual({ error: "empty question" })
    expect(fs.existsSync(questionsDir(projectDir))).toBe(false)
  })
})

test("型不正と改行を含む ID は bad field を返す", () => {
  withTmpDir((projectDir) => {
    const opts = { projectDir, html: "" }
    const wrongType = handleRequest(
      opts,
      "POST",
      "/api/questions",
      JSON.stringify({ tourId: "tour-001", stopId: "stop-01", question: 1 })
    )
    const lineBreak = handleRequest(
      opts,
      "POST",
      "/api/questions",
      JSON.stringify({
        tourId: "tour-001\nnext",
        stopId: "stop-01",
        question: "質問"
      })
    )

    expect(wrongType.status).toBe(400)
    expect(parseBody(wrongType)).toEqual({ error: "bad field" })
    expect(lineBreak.status).toBe(400)
    expect(parseBody(lineBreak)).toEqual({ error: "bad field" })
  })
})

test("パストラバーサルを含む tourId は 400 を返す", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "GET",
      `/api/tours/${encodeURIComponent("../etc")}`,
      ""
    )

    expect(result.status).toBe(400)
    expect(parseBody(result)).toEqual({ error: "bad tour id" })
  })
})

test("POST /api/questions は質問ファイルを生成する", () => {
  withTmpDir((projectDir) => {
    const result = handleRequest(
      { projectDir, html: "" },
      "POST",
      "/api/questions",
      JSON.stringify({
        tourId: "tour-001",
        stopId: "stop-01",
        question: "この変更の理由は何ですか？"
      })
    )

    expect(result.status).toBe(200)
    const response = parseBody(result) as { ok: boolean; name: string }
    expect(response).toMatchObject({ ok: true, name: expect.any(String) })
    const raw = fs.readFileSync(
      path.join(questionsDir(projectDir), response.name),
      "utf8"
    )
    expect(raw).toContain("tourId: tour-001")
    expect(raw).toContain("stopId: stop-01")
    expect(raw).toContain("この変更の理由は何ですか？")
  })
})

test("壊れた tour.json は例外を投げず 400 を返す", () => {
  withTmpDir((projectDir) => {
    const tourId = validTour().tourId
    const dir = tourDir(projectDir, tourId)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "tour.json"), "{ broken")

    expect(() =>
      handleRequest({ projectDir, html: "" }, "GET", `/api/tours/${tourId}`, "")
    ).not.toThrow()
    const result = handleRequest(
      { projectDir, html: "" },
      "GET",
      `/api/tours/${tourId}`,
      ""
    )
    expect(result.status).toBe(400)
    expect(parseBody(result)).toMatchObject({ error: expect.any(String) })
  })
})

test("内部例外は握って 500 を返す", () => {
  withTmpDir((projectDir) => {
    let result: ReturnType<typeof handleRequest> | undefined
    expect(() => {
      result = handleRequest(
        { projectDir, html: "" },
        "GET",
        null as unknown as string,
        ""
      )
    }).not.toThrow()

    expect(result?.status).toBe(500)
    expect(parseBody(result as ReturnType<typeof handleRequest>)).toEqual({
      error: "internal error"
    })
  })
})
