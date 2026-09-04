import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"

export interface FakeModelsResponse {
  status?: number
  body?: string
  delayMs?: number
  headers?: Record<string, string>
}

export interface FakeModelsRequest {
  method?: string
  url?: string
  headers: IncomingHttpHeaders
}

export interface FakeModelsServer {
  baseUrl: string
  requests: FakeModelsRequest[]
  close(): Promise<void>
}

export async function startFakeModelsServer(
  response: FakeModelsResponse = {}
): Promise<FakeModelsServer> {
  const requests: FakeModelsRequest[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((request, result) => {
    requests.push({
      method: request.method,
      url: request.url,
      headers: { ...request.headers }
    })

    const send = () => {
      if (result.destroyed || result.writableEnded) {
        return
      }

      result.writeHead(response.status ?? 200, {
        "content-type": "application/json",
        ...response.headers
      })
      result.end(response.body ?? JSON.stringify({ data: [] }))
    }
    const delayMs = response.delayMs ?? 0

    if (delayMs > 0) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        send()
      }, delayMs)
      timers.add(timer)
      return
    }

    send()
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close(): Promise<void> {
      for (const timer of timers) {
        clearTimeout(timer)
      }
      timers.clear()

      if (!server.listening) {
        return
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}
