import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { log } from "../core/log.js"
import type { PipelineDeps } from "../core/pipeline.js"
import type { Precedent } from "../core/types.js"
import { PrecedentStore } from "../precedent/store.js"
import { type ToolResponse, toResponse } from "./shared.js"

export const recordOutcomeInput = {
  evaluationId: z.string().min(1),
  outcome: z.enum(["approved", "rejected", "incident"]),
  notes: z.string().optional().describe("結末の補足(教訓の材料になる)")
}

type RecordOutcomeArgs = {
  evaluationId: string
  outcome: "approved" | "rejected" | "incident"
  notes?: string
}

/**
 * 判定の結末を記録して判例化する(§9)。
 * 判例の書込は kernel の専権 — このツール経由でのみ判例が生まれる。
 */
export function handleRecordOutcome(
  args: RecordOutcomeArgs,
  deps: PipelineDeps
): ToolResponse {
  const { caseStore, config, configHash } = deps
  const entry = caseStore.lookupEvaluation(args.evaluationId)
  if (!entry) {
    return toResponse({
      recorded: false,
      reason: `evaluationId ${args.evaluationId} が見つかりません`
    })
  }
  // 判例化の前に証拠の改竄がないことを検証する(不変条件 6)
  const check = caseStore.verifyAttempt(entry.casePath)
  if (!check.ok) {
    log.warn("record_outcome: ケースファイル改竄検知", {
      evaluationId: args.evaluationId,
      mismatches: check.mismatches
    })
    return toResponse({
      recorded: false,
      reason: `ケースファイルの検証に失敗したため判例化を拒否します: ${check.mismatches.join("; ")}`
    })
  }
  const verdict = caseStore.readVerdict(entry.casePath)
  if (!verdict) {
    return toResponse({
      recorded: false,
      reason: "verdict.json を読み取れませんでした"
    })
  }
  const firedRules = [...new Set(verdict.findings.map((f) => f.ruleId))]
  const precedentId = `prec-${args.evaluationId.slice(0, 8)}-${args.outcome}`
  const precedent: Precedent = {
    id: precedentId,
    source: "project",
    kind: verdict.kind,
    outcome: args.outcome,
    summary:
      `判定 ${verdict.verdict}(${verdict.weightTier})の結末は ${args.outcome}。` +
      ` objective: ${verdict.objective ?? "(不明)"}`,
    objective: verdict.objective,
    firedRules,
    changedPaths: verdict.changedPaths ?? [],
    lesson:
      args.notes ??
      verdict.meta?.rationale ??
      `findings: ${firedRules.join(", ") || "なし"}`,
    recordedAt: new Date().toISOString(),
    configHash
  }
  new PrecedentStore(config).record(precedent)
  log.info("判例を記録しました", { precedentId, outcome: args.outcome })
  return toResponse({ recorded: true, precedentId })
}

export function registerRecordOutcome(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "record_outcome",
    {
      description:
        "判定の結末(approved / rejected / incident)を記録して判例化する。" +
        "incident は「PROCEED したのに実害が出た」見逃し記録で最も価値が高い。",
      inputSchema: recordOutcomeInput
    },
    (args) => {
      try {
        return handleRecordOutcome(args, deps)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error("record_outcome 内部エラー", { message })
        return toResponse({ recorded: false, reason: message })
      }
    }
  )
}
