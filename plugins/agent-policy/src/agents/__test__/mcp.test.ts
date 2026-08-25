import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { listMcpServers, mcpCurrentOf, parseMcpList, toolPrefix } from "../mcp"

const SAMPLE = [
  "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set",
  "Checking MCP server health…",
  "",
  "plugin:context7:context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected",
  "serena: uvx --from git+https://github.com/oraios/serena serena start - ✔ Connected",
  "broken: node /tmp/broken.mjs - ✘ Failed to connect",
  "needsauth: https://example.com/mcp (HTTP) - ! Needs authentication",
  "pending: node /tmp/pending.mjs - ⏸ Pending approval",
  "lazy: node /tmp/lazy.mjs - cached, connects on first use"
].join("\n")

const FAKE_CLAUDE = fileURLToPath(
  new URL("../../testing/fake-claude.mjs", import.meta.url)
)
const MISSING_CLAUDE = fileURLToPath(
  new URL("../../testing/missing-claude.mjs", import.meta.url)
)

describe("parseMcpList", () => {
  it("警告行とヘルスチェック行を無視する", () => {
    expect(parseMcpList(SAMPLE).map((s) => s.name)).toEqual([
      "plugin:context7:context7",
      "serena",
      "broken",
      "needsauth",
      "pending",
      "lazy"
    ])
  })

  it("コロンを含む名前を最初のコロンで切らない", () => {
    expect(parseMcpList(SAMPLE)[0]?.name).toBe("plugin:context7:context7")
  })

  it("Connected と cached だけを usable とする", () => {
    expect(
      parseMcpList(SAMPLE)
        .filter((s) => s.usable)
        .map((s) => s.name)
    ).toEqual(["plugin:context7:context7", "serena", "lazy"])
  })

  it("空の出力では空配列を返す", () => {
    expect(parseMcpList("")).toEqual([])
  })
})

describe("toolPrefix", () => {
  it("英数字とアンダースコアとハイフン以外を _ に置き換える", () => {
    expect(toolPrefix("plugin:context7:context7")).toBe(
      "mcp__plugin_context7_context7"
    )
  })

  it("素の名前はそのまま使う", () => {
    expect(toolPrefix("serena")).toBe("mcp__serena")
  })

  it("ハイフンを保つ", () => {
    expect(toolPrefix("my-server")).toBe("mcp__my-server")
  })
})

describe("listMcpServers", () => {
  it("偽 CLI が返した出力をパースする", () => {
    const env = {
      AGENT_POLICY_CLAUDE_BIN: FAKE_CLAUDE,
      AGENT_POLICY_FAKE_MCP: SAMPLE
    }

    expect(listMcpServers(env)).toEqual(parseMcpList(SAMPLE))
  })

  it("実行に失敗しても例外を投げず空配列を返す", () => {
    const env = { AGENT_POLICY_CLAUDE_BIN: MISSING_CLAUDE }

    expect(() => listMcpServers(env)).not.toThrow()
    expect(listMcpServers(env)).toEqual([])
  })
})

describe("mcpCurrentOf", () => {
  const definition = [
    "---",
    "name: claude-explorer",
    "description: x",
    "model: sonnet",
    "color: purple",
    "tools: Read, Grep, Glob, Bash, mcp__serena",
    "disallowedTools: mcp__serena__write_memory, mcp__serena__rename_symbol",
    "agent-policy-role: explore",
    "---",
    "",
    "本文"
  ].join("\n")

  it("tools から MCP のプレフィックスを外して返す", () => {
    expect(mcpCurrentOf(definition).servers).toEqual(["serena"])
  })

  it("disallowedTools をそのまま返す", () => {
    expect(mcpCurrentOf(definition).denyTools).toEqual([
      "mcp__serena__write_memory",
      "mcp__serena__rename_symbol"
    ])
  })

  it("MCP を持たない定義では空になる", () => {
    const plain = [
      "---",
      "name: x",
      "tools: Read, Grep",
      "---",
      "",
      "本文"
    ].join("\n")
    expect(mcpCurrentOf(plain)).toEqual({ servers: [], denyTools: [] })
  })

  it("frontmatter が無い内容では空になる", () => {
    expect(mcpCurrentOf("本文だけ")).toEqual({ servers: [], denyTools: [] })
  })
})
