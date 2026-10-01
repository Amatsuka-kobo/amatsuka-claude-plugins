import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { GATED_PHASES, type PhaseKind } from "../codiel/phases.js"
import { log } from "../core/log.js"
import { type PipelineDeps, policyOf } from "../core/pipeline.js"
import type { Rule } from "../core/types.js"
import { RULE_SPECS } from "../rules/params.js"
import { allRules } from "../rules/registry.js"
import { toResponse } from "./shared.js"

const KINDS = [...new Set(GATED_PHASES.map((e) => e.kind))] as [
  PhaseKind,
  ...PhaseKind[]
]

export const listRulesInput = z.strictObject({
  kind: z.enum(KINDS).optional().describe("この kind に当たるルールだけを返す")
})

/**
 * ルールごとのパラメータ(名前・型・既定値・現在値・sealed での制約)、設定の出所、ビルドのバージョン、
 * Jev の文脈判定の設定、保護パスの除外と生成物、未コミットの検査から外すパスの宣言、
 * レポートとして外す testsDir を返す(設計書 §6.2.8、§6.2.2 の手順 3)。
 * 設定の読み込みに失敗しているときは、一覧の代わりに理由と設定のパスを返す(§6.12.4)
 */
export function buildRulesListing(deps: PipelineDeps, kind?: PhaseKind) {
  const rt = deps.runtime()
  if (!rt.ok) {
    return {
      error: `設定を読み込めない: ${rt.error}`,
      path: rt.path,
      configSource: rt.source,
      buildVersion: deps.buildVersion
    }
  }
  const { config, configHash, source, testsDir } = rt.runtime.loaded
  const byId = new Map<string, Rule>(allRules.map((r) => [r.id, r]))
  const rules = RULE_SPECS.map((spec) => {
    const appliesTo = byId.get(spec.id)?.appliesTo ?? "all"
    const settings = config.rules[spec.id] ?? {}
    return {
      id: spec.id,
      appliesTo,
      sealed: spec.sealed,
      defaultSeverity: spec.defaultSeverity,
      severity: settings.severity ?? spec.defaultSeverity,
      enabled: settings.enabled !== false,
      params: spec.params.map((p) => ({
        name: p.name,
        type: p.type,
        default: p.default,
        current: settings[p.name] ?? p.default,
        merge: p.merge,
        description: p.description,
        ...(p.constraint ? { constraint: p.constraint } : {})
      }))
    }
  }).filter((r) => !kind || r.appliesTo === "all" || r.appliesTo.includes(kind))
  return {
    configSource: source,
    configHash,
    buildVersion: deps.buildVersion,
    policy: policyOf(config, configHash, source, deps.buildVersion),
    e2eReports: {
      testsDir,
      rule: `${testsDir === "." ? "" : `${testsDir}/`}**/reports/** を E2E のレポートとして common/secrets 以外のルール・Jev から外す`
    },
    contextJudge: config.contextJudge,
    precedent: config.precedent,
    onError: config.onError,
    rules
  }
}

export function registerListRules(server: McpServer, deps: PipelineDeps): void {
  server.registerTool(
    "list_rules",
    {
      description:
        "現在の設定で有効なルールとパラメータ・Jev の閾値・設定の出所・ビルドのバージョンを返す。",
      inputSchema: listRulesInput
    },
    (args) => {
      try {
        return toResponse(buildRulesListing(deps, args.kind))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error("list_rules の内部エラー", { message })
        return toResponse({ error: message })
      }
    }
  )
}
