import { afterEach, describe, expect, it } from "vitest"
import {
  type FakeModelsResponse,
  type FakeModelsServer,
  startFakeModelsServer
} from "../../testing/fake-models-server"
import { fetchLiveModels } from "../live-models"

const EMPTY_MODELS = JSON.stringify({ data: [] })

let server: FakeModelsServer | undefined

async function startServer(
  response: FakeModelsResponse = {}
): Promise<FakeModelsServer> {
  server = await startFakeModelsServer(response)
  return server
}

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe("fetchLiveModels", () => {
  it("base URL が未設定または空なら照会せず no-base-url を返す", async () => {
    const proxy = await startServer()

    await expect(fetchLiveModels({})).resolves.toEqual({
      ok: false,
      ids: [],
      vendors: {},
      reason: "no-base-url"
    })
    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: "   " })
    ).resolves.toEqual({
      ok: false,
      ids: [],
      vendors: {},
      reason: "no-base-url"
    })

    expect(proxy.requests).toHaveLength(0)
  })

  it("正常応答から ids と vendors を順に組み立てる", async () => {
    const proxy = await startServer({
      body: JSON.stringify({
        data: [
          { id: "gpt-5", owned_by: "openai" },
          { id: "grok-4", owned_by: "xai" },
          { id: "claude-sonnet", owned_by: "anthropic" }
        ]
      })
    })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toEqual({
      ok: true,
      baseUrl: proxy.baseUrl,
      ids: ["gpt-5", "grok-4", "claude-sonnet"],
      vendors: {
        "gpt-5": "gpt",
        "grok-4": "grok",
        "claude-sonnet": "claude"
      }
    })

    expect(proxy.requests).toHaveLength(1)
    expect(proxy.requests[0]).toMatchObject({
      method: "GET",
      url: "/v1/models"
    })
  })

  it("owned_by の大文字混じりを小文字化してベンダーを推定する", async () => {
    const proxy = await startServer({
      body: JSON.stringify({ data: [{ id: "gpt-5", owned_by: "OpenAI" }] })
    })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toMatchObject({ vendors: { "gpt-5": "gpt" } })
  })

  it("owned_by の欠落・未知値・非文字列を unknown とする", async () => {
    const proxy = await startServer({
      body: JSON.stringify({
        data: [
          { id: "missing" },
          { id: "unknown", owned_by: "other" },
          { id: "non-string", owned_by: 42 }
        ]
      })
    })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toMatchObject({
      vendors: {
        missing: "unknown",
        unknown: "unknown",
        "non-string": "unknown"
      }
    })
  })

  it("id が文字列でない要素を飛ばす", async () => {
    const proxy = await startServer({
      body: JSON.stringify({
        data: [
          { id: 1, owned_by: "openai" },
          { id: null, owned_by: "xai" },
          { owned_by: "anthropic" },
          { id: "usable", owned_by: "openai" }
        ]
      })
    })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toMatchObject({
      ids: ["usable"],
      vendors: { usable: "gpt" }
    })
  })

  it.each([
    [401, "http-401"],
    [500, "http-500"]
  ])("HTTP %i を %s として返す", async (status, reason) => {
    const proxy = await startServer({ status, body: EMPTY_MODELS })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toEqual({
      ok: false,
      baseUrl: proxy.baseUrl,
      ids: [],
      vendors: {},
      reason
    })
  })

  it("不正な JSON の本文を parse-error として返す", async () => {
    const proxy = await startServer({ body: "{ invalid json" })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toEqual({
      ok: false,
      baseUrl: proxy.baseUrl,
      ids: [],
      vendors: {},
      reason: "parse-error"
    })
  })

  it("data が配列でない本文を parse-error として返す", async () => {
    const proxy = await startServer({ body: JSON.stringify({ data: {} }) })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toEqual({
      ok: false,
      baseUrl: proxy.baseUrl,
      ids: [],
      vendors: {},
      reason: "parse-error"
    })
  })

  it("3 秒を超えて応答すると timeout を返す", async () => {
    const proxy = await startServer({
      body: EMPTY_MODELS,
      delayMs: 3_100
    })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toEqual({
      ok: false,
      baseUrl: proxy.baseUrl,
      ids: [],
      vendors: {},
      reason: "timeout"
    })
  })

  it("接続できないアドレスを fetch-failed として返す", async () => {
    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: "http://127.0.0.1:1" })
    ).resolves.toEqual({
      ok: false,
      baseUrl: "http://127.0.0.1:1",
      ids: [],
      vendors: {},
      reason: "fetch-failed"
    })
  })

  it("Bearer 認証を x-api-key より優先する", async () => {
    const proxy = await startServer({ body: EMPTY_MODELS })

    await expect(
      fetchLiveModels({
        ANTHROPIC_BASE_URL: proxy.baseUrl,
        ANTHROPIC_AUTH_TOKEN: "token-value",
        ANTHROPIC_API_KEY: "api-key-value"
      })
    ).resolves.toMatchObject({ ok: true })

    expect(proxy.requests[0]?.headers.authorization).toBe("Bearer token-value")
    expect(proxy.requests[0]?.headers["x-api-key"]).toBeUndefined()
  })

  it("Bearer トークンが無いとき x-api-key 認証を使う", async () => {
    const proxy = await startServer({ body: EMPTY_MODELS })

    await expect(
      fetchLiveModels({
        ANTHROPIC_BASE_URL: proxy.baseUrl,
        ANTHROPIC_API_KEY: "api-key-value"
      })
    ).resolves.toMatchObject({ ok: true })

    expect(proxy.requests[0]?.headers.authorization).toBeUndefined()
    expect(proxy.requests[0]?.headers["x-api-key"]).toBe("api-key-value")
  })

  it("認証情報が無いとき認証ヘッダを送らない", async () => {
    const proxy = await startServer({ body: EMPTY_MODELS })

    await expect(
      fetchLiveModels({ ANTHROPIC_BASE_URL: proxy.baseUrl })
    ).resolves.toMatchObject({ ok: true })

    expect(proxy.requests[0]?.headers.authorization).toBeUndefined()
    expect(proxy.requests[0]?.headers["x-api-key"]).toBeUndefined()
  })
})
