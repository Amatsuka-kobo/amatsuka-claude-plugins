import { execFileSync } from "node:child_process"

export interface McpServer {
  name: string
  status: string
  usable: boolean
}

export interface McpCurrent {
  servers: string[]
  denyTools: string[]
}

// claude mcp list が付けるステータス。usable は「いま tools に書いてよいか」。
// Connected と cached だけを採る。Failed / Needs authentication / Pending /
// Rejected を書くと、存在しないツール名を tools に載せることになる。
const USABLE = ["✔ Connected", "cached"]
const STATUSES = [
  "✔ Connected",
  "✘ Failed to connect",
  "! Needs authentication",
  "⏸ Pending approval",
  "✘ Rejected",
  "cached"
]

// 名前自体がコロンを含みうる(plugin:<plugin>:<server>)ため、最初のコロンで
// 切ってはならない。行末のステータスを切り落としてから、先頭の空白までを
// 名前として採り、末尾のコロンを除く。
export function parseMcpList(output: string): McpServer[] {
  const servers: McpServer[] = []

  for (const raw of output.split("\n")) {
    const line = raw.trim()
    if (line === "") continue
    if (line.startsWith("⚠") || line.startsWith("Checking")) continue

    const at = line.lastIndexOf(" - ")
    if (at === -1) continue
    const status = line.slice(at + 3).trim()
    if (!STATUSES.some((known) => status.startsWith(known))) continue

    const head = line.slice(0, at)
    const space = head.indexOf(" ")
    const name = (space === -1 ? head : head.slice(0, space)).replace(/:$/, "")
    if (name === "") continue

    servers.push({
      name,
      status,
      usable: USABLE.some((known) => status.startsWith(known))
    })
  }

  return servers
}

export function toolPrefix(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

// claude mcp list を実行する。テストでは AGENT_POLICY_CLAUDE_BIN で
// src/testing/fake-claude.mjs を指す。ヘルスチェックは全サーバーへの
// 接続試行を伴うため timeout と maxBuffer を明示し、失敗しても例外を
// 投げずに空を返す(claude が無い環境でウィザードを止めないため)。
export function listMcpServers(env: NodeJS.ProcessEnv): McpServer[] {
  const bin = env.AGENT_POLICY_CLAUDE_BIN
  const options = {
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env
  }
  try {
    const output =
      bin === undefined || bin === ""
        ? execFileSync("claude", ["mcp", "list"], options)
        : execFileSync(process.execPath, [bin], options)
    return parseMcpList(output)
  } catch {
    return []
  }
}

// 既存定義から MCP の付与状況を逆算する。専用の設定ファイルを持たず、
// 生成物そのものを前回の選択の記録として使う。
export function mcpCurrentOf(content: string): McpCurrent {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") return { servers: [], denyTools: [] }
  const close = lines.indexOf("---", 1)
  if (close === -1) return { servers: [], denyTools: [] }

  const meta = new Map<string, string>()
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ")
    if (at <= 0) continue
    meta.set(line.slice(0, at).trim(), line.slice(at + 2).trim())
  }

  const split = (value: string | undefined): string[] =>
    value === undefined
      ? []
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "")

  return {
    servers: split(meta.get("tools")).filter((tool) =>
      tool.startsWith("mcp__")
    ),
    denyTools: split(meta.get("disallowedTools"))
  }
}
