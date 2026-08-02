import { afterEach, expect, test, vi } from "vitest"
import { captureEnvironment } from "../lib/environment.js"

afterEach(() => {
  vi.unstubAllEnvs()
})

function clearAuthEnvironment(): void {
  vi.stubEnv("ANTHROPIC_API_KEY", undefined)
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined)
  vi.stubEnv("ANTHROPIC_BASE_URL", undefined)
}

test("ANTHROPIC_API_KEY があれば変数名を auth_source に返す", () => {
  clearAuthEnvironment()
  vi.stubEnv("ANTHROPIC_API_KEY", "secret-api-key")
  expect(captureEnvironment("model").auth_source).toBe("ANTHROPIC_API_KEY")
})

test("ANTHROPIC_AUTH_TOKEN のみならその変数名を返す", () => {
  clearAuthEnvironment()
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "secret-auth-token")
  expect(captureEnvironment("model").auth_source).toBe("ANTHROPIC_AUTH_TOKEN")
})

test("認証環境変数がなければ claude.ai login を返す", () => {
  clearAuthEnvironment()
  expect(captureEnvironment("model").auth_source).toBe("(claude.ai login)")
})

test("両方あれば ANTHROPIC_API_KEY を優先する", () => {
  clearAuthEnvironment()
  vi.stubEnv("ANTHROPIC_API_KEY", "secret-api-key")
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "secret-auth-token")
  expect(captureEnvironment("model").auth_source).toBe("ANTHROPIC_API_KEY")
})

test("ANTHROPIC_BASE_URL がなければ default を返す", () => {
  clearAuthEnvironment()
  expect(captureEnvironment("model").base_url).toBe("(default)")
})

test("環境情報にはモデルと base URL を含め、キーやトークンの値を含めない", () => {
  clearAuthEnvironment()
  vi.stubEnv("ANTHROPIC_API_KEY", "never-return-this-key")
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "never-return-this-token")
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://example.test")

  const environment = captureEnvironment("claude-opus-5")
  expect(environment).toEqual({
    base_url: "https://example.test",
    auth_source: "ANTHROPIC_API_KEY",
    model: "claude-opus-5"
  })
  const serialized = JSON.stringify(environment)
  expect(serialized).not.toContain("never-return-this-key")
  expect(serialized).not.toContain("never-return-this-token")
})
