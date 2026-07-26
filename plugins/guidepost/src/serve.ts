import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { handleRequest } from "./lib/http-handler.js"

const DEFAULT_PORT = 4870
const MAX_PORT_RETRIES = 10
const MAX_BODY_BYTES = 1_000_000

interface ServeOptions {
  port: number
  projectDir: string
  open: boolean
}

function parseArgs(argv: string[]): ServeOptions {
  let port = DEFAULT_PORT
  let projectDir = process.cwd()
  let open = false

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1] !== undefined) {
      const value = Number(argv[i + 1])
      if (Number.isInteger(value) && value >= 0 && value <= 65535) {
        port = value
      }
      i++
    } else if (argv[i] === "--dir" && argv[i + 1] !== undefined) {
      projectDir = path.resolve(argv[i + 1])
      i++
    } else if (argv[i] === "--open") {
      open = true
    }
  }

  return { port, projectDir, open }
}

function readHtml(): { html: string; error: boolean } {
  try {
    return {
      html: fs.readFileSync(new URL("./ui.html", import.meta.url), "utf8"),
      error: false
    }
  } catch {
    // T08 で ui.html が追加されるまで、API は利用可能に保つ。
    return { html: "", error: true }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    let size = 0
    let tooLarge = false

    req.on("data", (chunk: Buffer | string) => {
      if (tooLarge) return
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      size += Buffer.byteLength(value)
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        req.destroy()
        reject(new Error("body too large"))
        return
      }
      body += value
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] }

  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore"
    })
    child.on("error", () => {})
    child.unref()
  } catch {
    // ブラウザを開けなくてもサーバーは継続する。
  }
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off("error", onError)
      const address = server.address()
      resolve(
        typeof address === "object" && address !== null ? address.port : port
      )
    }

    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, "127.0.0.1")
  })
}

async function listenWithRetry(
  server: http.Server,
  port: number
): Promise<number> {
  let candidate = port

  for (let retry = 0; retry <= MAX_PORT_RETRIES; retry++) {
    try {
      return await listen(server, candidate)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (
        code !== "EADDRINUSE" ||
        candidate === 65535 ||
        retry === MAX_PORT_RETRIES
      ) {
        throw error
      }
      candidate++
    }
  }

  throw new Error("port retry limit reached")
}

const options = parseArgs(process.argv.slice(2))
const ui = readHtml()
const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (ui.error && req.method === "GET" && url.pathname === "/") {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      res.end("ui.html not found")
      return
    }

    const result = handleRequest(
      { projectDir: options.projectDir, html: ui.html },
      req.method ?? "GET",
      url.pathname,
      await readBody(req)
    )
    res.writeHead(result.status, {
      "content-type": `${result.contentType}; charset=utf-8`
    })
    res.end(result.body)
  })().catch(() => {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ error: "internal error" }))
    } else {
      res.end()
    }
  })
})

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true

  if (!server.listening) process.exit(0)
  server.close(() => process.exit(0))
  // 残存接続があっても 1 秒以内に終了する。
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

void listenWithRetry(server, options.port)
  .then((actualPort) => {
    const url = `http://127.0.0.1:${actualPort}/`
    console.log(`guidepost viewer: ${url}`)
    if (options.open) openBrowser(url)
  })
  .catch((error: unknown) => {
    console.error(`guidepost viewer の起動に失敗しました: ${String(error)}`)
    process.exit(1)
  })
