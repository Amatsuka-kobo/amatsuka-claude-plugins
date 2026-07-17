import fs from "node:fs"
import type http from "node:http"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import { createPitcrewServer } from "../http.js"

const TOKEN = "test-token-1234"
let server: http.Server | null = null
let projectDir = ""

function start(): Promise<string> {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-http-"))
  server = createPitcrewServer({
    projectDir,
    token: TOKEN,
    html: "<!doctype html><title>pitcrew</title>"
  })
  return new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const addr = server?.address()
      resolve(
        typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : ""
      )
    })
  })
}

afterEach(async () => {
  // SSE・keep-alive の接続が残っていると close が完了しないため強制切断する
  server?.closeAllConnections()
  await new Promise((r) => server?.close(r))
  server = null
  fs.rmSync(projectDir, { recursive: true, force: true })
})

function auth(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` }
}

test("GET / はトークン一致で HTML を返し、不一致は 401", async () => {
  const base = await start()
  const ok = await fetch(`${base}/?token=${TOKEN}`)
  expect(ok.status).toBe(200)
  expect(ok.headers.get("content-type")).toContain("text/html")
  expect(await ok.text()).toContain("pitcrew")
  expect((await fetch(`${base}/?token=wrong`)).status).toBe(401)
  expect((await fetch(`${base}/`)).status).toBe(401)
})

test("GET /api/state は状態 JSON を返す", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(
    path.join(review, "001-diff-x.md"),
    '---\nid: "001"\ntype: diff\n---\n# x の diff\n'
  )
  const res = await fetch(`${base}/api/state`, { headers: auth() })
  expect(res.status).toBe(200)
  const state = (await res.json()) as { review: { name: string }[] }
  expect(state.review.map((i) => i.name)).toEqual(["001-diff-x.md"])
})

test("GET /api/item は本文を返し、無ければ 404、不正 status は 400", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-x.md"), "本文")
  const ok = await fetch(`${base}/api/item?status=review&name=001-diff-x.md`, {
    headers: auth()
  })
  expect(ok.status).toBe(200)
  expect(((await ok.json()) as { body: string }).body).toBe("本文")
  expect(
    (
      await fetch(`${base}/api/item?status=review&name=nope.md`, {
        headers: auth()
      })
    ).status
  ).toBe(404)
  expect(
    (
      await fetch(`${base}/api/item?status=bad&name=001-diff-x.md`, {
        headers: auth()
      })
    ).status
  ).toBe(400)
})

test("POST /api/approve は reviewed/ へ移動する", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-x.md"), "本文")
  const res = await fetch(`${base}/api/approve`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ name: "001-diff-x.md" })
  })
  expect(res.status).toBe(200)
  expect(
    fs.existsSync(
      path.join(projectDir, ".pitcrew", "reviewed", "001-diff-x.md")
    )
  ).toBe(true)
  const missing = await fetch(`${base}/api/approve`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ name: "nope.md" })
  })
  expect(missing.status).toBe(404)
})

test("POST /api/comment はコメントを書き、空 body は 400", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/comment`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({
      body: "コメント本文",
      urgency: "urgent",
      paths: ["src/auth.ts"]
    })
  })
  expect(res.status).toBe(200)
  expect((await res.json()) as object).toEqual({ ok: true, name: "c-001.md" })
  const raw = fs.readFileSync(
    path.join(projectDir, ".pitcrew", "comments", "c-001.md"),
    "utf8"
  )
  expect(raw).toContain("urgency: urgent")
  const empty = await fetch(`${base}/api/comment`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ body: "  ", urgency: "normal" })
  })
  expect(empty.status).toBe(400)
})

test("認証なしの API は 401、未知パスは 404", async () => {
  const base = await start()
  expect((await fetch(`${base}/api/state`)).status).toBe(401)
  expect((await fetch(`${base}/api/nope`, { headers: auth() })).status).toBe(
    404
  )
})

test("SSE は接続直後に changed を送り、変更でも送る", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/events?token=${TOKEN}`)
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  const reader = res.body?.getReader()
  if (!reader) throw new Error("no body")
  const decoder = new TextDecoder()
  let received = ""
  const readUntilChanged = async (): Promise<void> => {
    // サーバーが通知を送らないバグで無限待機しないよう 10 秒で打ち切る
    // (打ち切り時は後続の expect が失敗する)
    const deadline = Date.now() + 10000
    while (!received.includes("data: changed")) {
      if (Date.now() > deadline) return
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true }), 10000)
        )
      ])
      if (done) return
      if (value) received += decoder.decode(value)
    }
  }
  await readUntilChanged() // 接続直後の初回通知
  received = ""
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-x.md"), "x")
  await readUntilChanged() // 変更通知
  expect(received).toContain("data: changed")
  await reader.cancel()
})
