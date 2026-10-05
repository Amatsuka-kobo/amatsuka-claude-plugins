import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { log } from "../core/log.js"
import type { PipelineDeps } from "../core/pipeline.js"
import { SEED_PRECEDENTS } from "../precedent/seed/index.js"
import {
  type ListPrecedentsFilter,
  type PrecedentListing,
  PrecedentStore
} from "../precedent/store.js"
import { phaseSchema, toResponse } from "./shared.js"

export const listPrecedentsInput = z.strictObject({
  outcome: z.enum(["approved", "rejected", "incident"]).optional(),
  phase: phaseSchema.optional(),
  includeRetired: z
    .boolean()
    .optional()
    .describe("退役した判例も含めるか。既定は false")
})

/**
 * 判例の一覧(設計書 §6.2.9)。プロジェクトの判例と、precedent.seedCatalog が true なら内蔵のシード判例を返す。
 * シード判例は phase を持たないので、phase で絞ると出ない
 */
export function handleListPrecedents(
  filter: ListPrecedentsFilter,
  deps: PipelineDeps
): { precedents: PrecedentListing[] } | { error: string; path: string } {
  const rt = deps.runtime()
  if (!rt.ok) {
    return { error: `設定を読み込めない: ${rt.error}`, path: rt.path }
  }
  const { config } = rt.runtime.loaded
  const project = new PrecedentStore(config, deps.projectRoot).list(filter)
  const seeds: PrecedentListing[] = config.precedent.seedCatalog
    ? SEED_PRECEDENTS.filter(
        (p) =>
          filter.phase === undefined &&
          (filter.outcome === undefined || p.outcome === filter.outcome)
      ).map((p) => ({
        id: p.id,
        source: p.source,
        phase: null,
        outcome: p.outcome,
        ruling: null,
        firedRules: p.firedRules,
        recordedAt: p.recordedAt ?? null,
        retiredAt: null
      }))
    : []
  return { precedents: [...project, ...seeds] }
}

export function registerListPrecedents(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "list_precedents",
    {
      description:
        "判例の一覧を返す(保守用。codiel の run からは呼ばない)。既定では退役した判例を含めない。",
      inputSchema: listPrecedentsInput
    },
    (args) => {
      try {
        return toResponse(handleListPrecedents(args, deps))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error("list_precedents の内部エラー", { message })
        return toResponse({ error: message })
      }
    }
  )
}
