import type { Vendor } from "./fragments"

// プロキシ応答から推定したベンダー。"none" は生成側の指定でありプロキシ応答には現れないため除く。
export type LiveVendor = Exclude<Vendor, "none"> | "unknown"

export interface LiveModels {
  ok: boolean
  baseUrl?: string
  ids: string[]
  vendors: Record<string, LiveVendor>
  reason?: string
}

const TIMEOUT_MS = 3_000

function failure(baseUrl: string, reason: string): LiveModels {
  return { ok: false, baseUrl, ids: [], vendors: {}, reason }
}

function vendorFor(ownedBy: unknown): LiveVendor {
  if (typeof ownedBy !== "string") {
    return "unknown"
  }

  switch (ownedBy.toLowerCase()) {
    case "openai":
      return "gpt"
    case "xai":
      return "grok"
    case "anthropic":
      return "claude"
    default:
      return "unknown"
  }
}

export async function fetchLiveModels(
  env: NodeJS.ProcessEnv
): Promise<LiveModels> {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim()

  if (!baseUrl) {
    return { ok: false, ids: [], vendors: {}, reason: "no-base-url" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers: Record<string, string> = {}
  const authToken = env.ANTHROPIC_AUTH_TOKEN

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  } else {
    const apiKey = env.ANTHROPIC_API_KEY

    if (apiKey) {
      headers["x-api-key"] = apiKey
    }
  }

  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers,
      signal: controller.signal
    })

    if (!response.ok) {
      return failure(baseUrl, `http-${response.status}`)
    }

    let body: unknown

    try {
      body = await response.json()
    } catch {
      return failure(
        baseUrl,
        controller.signal.aborted ? "timeout" : "parse-error"
      )
    }

    const data =
      typeof body === "object" && body !== null
        ? (body as { data?: unknown }).data
        : undefined

    if (!Array.isArray(data)) {
      return failure(baseUrl, "parse-error")
    }

    const ids: string[] = []
    const vendors: LiveModels["vendors"] = {}

    for (const item of data) {
      if (typeof item !== "object" || item === null) {
        continue
      }

      const entry = item as Record<string, unknown>
      const id = entry.id

      if (typeof id !== "string") {
        continue
      }

      ids.push(id)
      vendors[id] = vendorFor(entry.owned_by)
    }

    return { ok: true, baseUrl, ids, vendors }
  } catch {
    return failure(
      baseUrl,
      controller.signal.aborted ? "timeout" : "fetch-failed"
    )
  } finally {
    clearTimeout(timeout)
  }
}
