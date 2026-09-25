export type ApiRequest = {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export type ApiResponse = {
  status: number
  headers: Record<string, string>
  body: unknown
  contentType: string | null
  bodyBytes: number
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key"
])

export function redact(
  headers: Record<string, string>,
  forceMask: ReadonlySet<string> = new Set()
): Record<string, string> {
  const forced = new Set([...forceMask].map((name) => name.toLowerCase()))
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      const normalized = name.toLowerCase()
      const sensitive =
        SENSITIVE_HEADERS.has(normalized) ||
        /token|secret|password/.test(normalized) ||
        forced.has(normalized)
      return [name, sensitive ? "[redacted]" : value]
    })
  )
}

export function sanitizeUrl(value: string): string {
  const url = new URL(value)
  url.username = ""
  url.password = ""
  const emptyValues = [...url.searchParams.keys()].map(
    (key): [string, string] => [key, ""]
  )
  url.search = new URLSearchParams(emptyValues).toString()
  return url.toString()
}

export function isHostAllowed(
  host: string,
  allowed: readonly string[]
): boolean {
  const normalizedHost = host.toLowerCase()
  return allowed.some((entry) => {
    const normalizedEntry = entry.toLowerCase()
    if (!normalizedEntry.startsWith("*."))
      return normalizedHost === normalizedEntry
    return normalizedHost.endsWith(normalizedEntry.slice(1))
  })
}

export function defaultAllowedHosts(originUrl: string): string[] {
  return [new URL(originUrl).host]
}

export function parseBody(contentType: string | null, text: string): unknown {
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase() ?? ""
  if (mediaType !== "application/json" && !mediaType.endsWith("+json"))
    return text

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export async function sendRequest(
  req: ApiRequest,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<ApiResponse> {
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs)
  }
  if (req.body !== undefined) init.body = req.body

  const response = await fetchImpl(req.url, init)
  const text = await response.text()
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    headers[name] = value
  })
  const contentType = response.headers.get("content-type")

  return {
    status: response.status,
    headers,
    body: parseBody(contentType, text),
    contentType,
    bodyBytes: Buffer.byteLength(text, "utf8")
  }
}
