import crypto from "node:crypto"
import http from "node:http"
import { listState, readItemBody } from "./state.js"
import {
  approveItem,
  approveItems,
  type NewComment,
  writeComment
} from "./viewer-ops.js"
import { watchPitcrew } from "./watch.js"

// ブラウザビューアの HTTP 層(設計書 §5)。listen は serve.ts が行う。
// 全ルートはトークン必須(localhost バインドでも同一マシンの他プロセス・
// 他サイトからの CSRF を防ぐ)。SSE は EventSource がヘッダを付けられない
// ため query トークンを受け付ける。

interface ServerOptions {
  projectDir: string
  token: string
  html: string
}

function tokenEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  const url = new URL(req.url ?? "/", "http://localhost")
  const query = url.searchParams.get("token")
  if (query !== null) return tokenEquals(query, token)
  const header = req.headers.authorization
  if (typeof header === "string" && header.startsWith("Bearer "))
    return tokenEquals(header.slice("Bearer ".length), token)
  return false
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    let tooLarge = false
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return
      data += chunk.toString("utf8")
      if (data.length > 1_000_000) {
        tooLarge = true
        req.destroy()
        reject(new Error("body too large"))
      }
    })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

function hasLineBreak(value: string): boolean {
  return value.includes("\n") || value.includes("\r")
}

export function createPitcrewServer(opts: ServerOptions): http.Server {
  const { projectDir, token, html } = opts
  const sseClients = new Set<http.ServerResponse>()
  const stopWatch = watchPitcrew(projectDir, () => {
    for (const client of sseClients) {
      try {
        client.write("data: changed\n\n")
      } catch {
        sseClients.delete(client)
      }
    }
  })

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" })
      else res.end()
    })
  })

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (!authorized(req, token)) {
      sendJson(res, 401, { error: "unauthorized" })
      return
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
      return
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, listState(projectDir))
      return
    }

    if (req.method === "GET" && url.pathname === "/api/item") {
      const status = url.searchParams.get("status")
      const name = url.searchParams.get("name") ?? ""
      if (status !== "review" && status !== "reviewed") {
        sendJson(res, 400, { error: "bad status" })
        return
      }
      const body = readItemBody(projectDir, status, name)
      if (body === null) sendJson(res, 404, { error: "not found" })
      else sendJson(res, 200, { body })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/approve") {
      let name = ""
      try {
        const parsed = JSON.parse(await readBody(req)) as { name?: unknown }
        if (typeof parsed.name === "string") name = parsed.name
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      if (approveItem(projectDir, name)) sendJson(res, 200, { ok: true })
      else sendJson(res, 404, { error: "not found" })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/approve-batch") {
      let names: string[]
      try {
        const parsed = JSON.parse(await readBody(req)) as { names?: unknown }
        if (!Array.isArray(parsed.names)) {
          sendJson(res, 400, { error: "bad names" })
          return
        }
        names = parsed.names.filter((x): x is string => typeof x === "string")
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      if (names.length === 0) {
        sendJson(res, 400, { error: "empty names" })
        return
      }
      // 上限は暴走リクエストの抑止(通常運用で達しない)
      if (names.length > 1000) {
        sendJson(res, 400, { error: "too many names" })
        return
      }
      const result = approveItems(projectDir, names)
      sendJson(res, 200, { ok: true, moved: result.moved, failed: result.failed })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/comment") {
      let comment: NewComment
      try {
        const p = JSON.parse(await readBody(req)) as Record<string, unknown>
        comment = {
          body: typeof p.body === "string" ? p.body : "",
          urgency: p.urgency === "urgent" ? "urgent" : "normal",
          paths: Array.isArray(p.paths)
            ? p.paths.filter((x): x is string => typeof x === "string")
            : [],
          reviewId: typeof p.reviewId === "string" ? p.reviewId : null,
          base: typeof p.base === "string" ? p.base : null
        }
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      if (
        (comment.reviewId !== null && hasLineBreak(comment.reviewId)) ||
        (comment.base !== null && hasLineBreak(comment.base)) ||
        comment.paths.some(hasLineBreak)
      ) {
        sendJson(res, 400, { error: "bad field" })
        return
      }
      const name = writeComment(projectDir, comment)
      if (name === null) sendJson(res, 400, { error: "empty body" })
      else sendJson(res, 200, { ok: true, name })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      })
      res.write("data: changed\n\n") // 接続直後に初期同期を促す
      sseClients.add(res)
      req.on("close", () => {
        sseClients.delete(res)
      })
      return
    }

    sendJson(res, 404, { error: "not found" })
  }

  server.on("close", () => {
    stopWatch()
    for (const client of sseClients) {
      try {
        client.end()
      } catch {
        sseClients.delete(client)
      }
    }
    sseClients.clear()
  })
  return server
}
