import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { log } from "../core/log.js"
import type { PipelineDeps } from "../core/pipeline.js"
import { PrecedentStore, type RetireResult } from "../precedent/store.js"
import { toResponse } from "./shared.js"

export const retirePrecedentInput = z.strictObject({
  id: z.string().min(1).describe("退役させるプロジェクトの判例の id"),
  reason: z.string().min(1).describe("退役させる理由")
})

/**
 * 判例を退役させる(設計書 §6.2.9)。ファイルは消さず、索引に retiredAt と retireReason を書く。
 * 退役できるのはプロジェクトの判例だけで、シード判例は precedent.seedCatalog: false でまとめて外す
 */
export function handleRetirePrecedent(
  args: { id: string; reason: string },
  deps: PipelineDeps
): RetireResult {
  const rt = deps.runtime()
  if (!rt.ok) {
    return {
      retired: false,
      reason: `設定(${rt.path})を読み込めない: ${rt.error}`
    }
  }
  return new PrecedentStore(rt.runtime.loaded.config, deps.projectRoot).retire(
    args.id,
    args.reason
  )
}

export function registerRetirePrecedent(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "retire_precedent",
    {
      description:
        "プロジェクトの判例を退役させる(保守用。codiel の run からは呼ばない)。退役した判例は検索に出ない。",
      inputSchema: retirePrecedentInput
    },
    (args) => {
      try {
        return toResponse(handleRetirePrecedent(args, deps))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error("retire_precedent の内部エラー", { message })
        return toResponse({ retired: false, reason: message })
      }
    }
  )
}
