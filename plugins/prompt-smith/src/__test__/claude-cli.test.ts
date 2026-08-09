import { describe, expect, it } from "vitest"
import { buildEnv, describeEnvironment } from "../lib/claude-cli.js"

describe("buildEnv", () => {
  it("CLAUDECODE を落とす", () => {
    expect(buildEnv({ CLAUDECODE: "1", PATH: "/bin" })).toEqual({ PATH: "/bin" })
  })
})

describe("describeEnvironment", () => {
  it("base_url と認証変数の名前を記録する", () => {
    const env = describeEnvironment("claude-opus-5", {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
      ANTHROPIC_AUTH_TOKEN: "secret-value",
    })
    expect(env).toEqual({
      base_url: "http://127.0.0.1:8317",
      auth_source: "ANTHROPIC_AUTH_TOKEN",
      model: "claude-opus-5",
    })
  })

  it("値そのものは記録しない", () => {
    const env = describeEnvironment(undefined, { ANTHROPIC_API_KEY: "sk-do-not-log" })
    expect(JSON.stringify(env)).not.toContain("sk-do-not-log")
    expect(env.auth_source).toBe("ANTHROPIC_API_KEY")
  })

  it("未設定なら既定の表記にする", () => {
    expect(describeEnvironment(undefined, {})).toEqual({
      base_url: "(default)",
      auth_source: "(claude.ai login)",
      model: null,
    })
  })
})
