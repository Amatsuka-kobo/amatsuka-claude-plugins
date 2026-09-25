import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { log } from "./log.js"
import { registerApiTools } from "./tools/api.js"
import { registerJudgingTools } from "./tools/judging.js"
import { createToolDeps } from "./tools/shared.js"

export async function main(): Promise<void> {
  const server = new McpServer({ name: "jevriel", version: "0.1.0-dev" })

  const deps = createToolDeps(process.env)
  registerJudgingTools(server, deps)
  registerApiTools(server, deps)

  await server.connect(new StdioServerTransport())
}

main().catch((err: unknown) => {
  log.error("Jevriel server startup failed", {
    message: err instanceof Error ? err.message : String(err)
  })
  process.exit(1)
})
