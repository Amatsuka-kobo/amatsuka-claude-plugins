import fs from "node:fs"
import path from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { CaseStore, NO_EVALUATION_RECORD } from "../casefile/store.js"
import { log } from "../core/log.js"
import type { PipelineDeps } from "../core/pipeline.js"
import type {
  OutcomeLabel,
  OutcomeRecord,
  Precedent,
  Ruling,
  VerdictRecord
} from "../core/types.js"
import { filterFiredRules, PrecedentStore } from "../precedent/store.js"
import { toResponse } from "./shared.js"

export const recordOutcomeInput = z.strictObject({
  evaluationId: z.string().min(1),
  outcome: z.enum(["approved", "rejected", "incident"]),
  ruling: z
    .enum(["as-is", "false-positive", "revise"])
    .optional()
    .describe(
      "フェーズのゲートでの人の裁定。無いときは run 全体の結末(PR のマージ・却下・incident)を表す"
    ),
  notes: z
    .string()
    .optional()
    .describe("結末の補足。ruling が false-positive のときは必須")
})

export interface RecordOutcomeArgs {
  evaluationId: string
  outcome: OutcomeLabel
  ruling?: Ruling
  notes?: string
}

export type RecordOutcomeResult =
  | { recorded: true; precedentId: string | null }
  | { recorded: false; precedentId: null; reason: string }

function refuse(reason: string): RecordOutcomeResult {
  return { recorded: false, precedentId: null, reason }
}

/** ruling と outcome と評価の組み合わせを検査する(設計書 §6.2.7)。通らなければ理由を返す */
function combinationError(
  args: RecordOutcomeArgs,
  v: VerdictRecord
): string | null {
  switch (args.ruling) {
    case "as-is":
      if (args.outcome !== "approved")
        return "ruling as-is は outcome approved と組む"
      if (v.verdict !== "ASK")
        return "ruling as-is は verdict が ASK の評価に限る"
      return null
    case "false-positive":
      if (args.outcome !== "approved")
        return "ruling false-positive は outcome approved と組む"
      if (v.verdict !== "STOP")
        return "ruling false-positive は verdict が STOP の評価に限る"
      if (v.findings.some((f) => f.ruleId === "casefile/tampered"))
        return "casefile/tampered の STOP は覆せない(改竄は成果物の懸念でなく記録の信頼の問題である)"
      if (!args.notes?.trim())
        return "ruling false-positive のときは notes に誤検知と判断した理由を書く"
      return null
    case "revise":
      if (args.outcome !== "rejected")
        return "ruling revise は outcome rejected と組む"
      if (v.verdict !== "ASK" && v.verdict !== "STOP")
        return "ruling revise は verdict が ASK か STOP の評価に限る"
      return null
    case undefined:
      return null
  }
}

/**
 * 同じ evaluationId・ruling・outcome の裁定の記録が既にあるか。
 * CaseStore.lookupOutcome は最後の行しか返さないので、outcomes.jsonl の全行を見る。読めない行は例外にする
 */
function hasSameOutcome(store: CaseStore, args: RecordOutcomeArgs): boolean {
  const file = path.join(store.projectDir, "outcomes.jsonl")
  if (!fs.existsSync(file)) return false
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .some((line) => {
      if (!line.trim()) return false
      const r = JSON.parse(line) as OutcomeRecord
      return (
        r.evaluationId === args.evaluationId &&
        r.outcome === args.outcome &&
        (r.ruling ?? null) === (args.ruling ?? null)
      )
    })
}

function readObjective(store: CaseStore, dir: string): string | undefined {
  const text = store.readEvidence(dir, "00-synthesis.json")
  if (text === undefined) return undefined
  try {
    const { objective } = JSON.parse(text) as { objective?: unknown }
    return typeof objective === "string" ? objective : undefined
  } catch {
    return undefined
  }
}

/**
 * 裁定を outcomes.jsonl に記録し、組み合わせの表に従って判例を作る(設計書 §6.2.7・§6.11)。
 * 判例は record_outcome だけが作る。degraded の評価からは作らない(false-positive を除く)
 */
export function handleRecordOutcome(
  args: RecordOutcomeArgs,
  deps: PipelineDeps
): RecordOutcomeResult {
  const rt = deps.runtime()
  if (!rt.ok) {
    return refuse(`設定(${rt.path})を読み込めないので記録しない: ${rt.error}`)
  }
  const { config, configHash } = rt.runtime.loaded
  const store = new CaseStore(config, deps.projectRoot)
  const entry = store.lookupEvaluation(args.evaluationId)
  if (!entry) return refuse(`${NO_EVALUATION_RECORD}: ${args.evaluationId}`)

  const check = store.verifyAttempt(entry.casePath)
  if (!check.ok) {
    log.warn("record_outcome: ケースファイルの改竄を検出した", {
      evaluationId: args.evaluationId,
      mismatches: check.mismatches
    })
    return refuse(
      `ケースファイルが改竄されているので記録しない: ${check.mismatches.join("; ")}`
    )
  }
  const v = store.readVerdict(entry.casePath) as VerdictRecord
  const invalid = combinationError(args, v)
  if (invalid) return refuse(invalid)
  if (hasSameOutcome(store, args)) {
    return refuse(
      `同じ裁定(outcome ${args.outcome}、ruling ${args.ruling ?? "なし"})が既に記録されている: ${args.evaluationId}`
    )
  }

  const makesPrecedent =
    args.ruling === "false-positive" || v.judgeStatus === "ok"
  let precedentId: string | null = null
  if (makesPrecedent) {
    const firedRules = filterFiredRules([
      ...new Set(v.findings.map((f) => f.ruleId))
    ])
    const objective = readObjective(store, entry.casePath)
    const id = `prec-${args.evaluationId.slice(0, 8)}-${args.ruling ?? "run"}-${args.outcome}`
    const precedent: Precedent = {
      id,
      source: "project",
      kind: v.kind,
      phase: v.phase,
      outcome: args.outcome,
      ruling: args.ruling ?? null,
      summary:
        `${v.phase} の判定 ${v.verdict}(${v.weightTier})の結末は ${args.outcome}` +
        `${args.ruling ? `、裁定は ${args.ruling}` : ""}。` +
        (objective ? ` objective: ${objective}` : ""),
      ...(objective ? { objective } : {}),
      firedRules,
      changedPaths: v.subject.files.map((f) => f.path),
      lesson:
        args.notes ??
        v.meta?.rationale ??
        `findings: ${firedRules.join(", ") || "なし"}`,
      recordedAt: new Date().toISOString(),
      configHash
    }
    // 退役した同じ id の判例は復活させない。そのときは判例を作らずに裁定だけを記録する
    if (new PrecedentStore(config, deps.projectRoot).record(precedent)) {
      precedentId = id
    }
  }

  store.appendOutcome({
    schemaVersion: 2,
    evaluationId: v.evaluationId,
    runId: v.runId,
    phase: v.phase,
    outcome: args.outcome,
    ruling: args.ruling ?? null,
    ...(args.notes !== undefined ? { notes: args.notes } : {}),
    precedentId,
    at: new Date().toISOString()
  })
  log.info("裁定を記録した", {
    evaluationId: args.evaluationId,
    ruling: args.ruling ?? null,
    precedentId
  })
  return { recorded: true, precedentId }
}

export function registerRecordOutcome(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "record_outcome",
    {
      description:
        "評価への人の裁定(ruling)か run 全体の結末(outcome)を記録し、条件を満たせば判例にする。" +
        "false-positive は STOP の誤検知の裁定で、notes が必須。casefile/tampered の STOP は覆せない。",
      inputSchema: recordOutcomeInput
    },
    (args) => {
      try {
        return toResponse(handleRecordOutcome(args, deps))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error("record_outcome の内部エラー", { message })
        return toResponse(refuse(message))
      }
    }
  )
}
