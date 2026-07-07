import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { SEALED_RULES } from "../core/invariants.js"
import type { PipelineDeps } from "../core/pipeline.js"
import type { ArtifactKind } from "../core/types.js"
import { allRules } from "../rules/registry.js"
import { toResponse } from "./shared.js"

export const listRulesInput = {
  kind: z.enum(["decision", "plan", "design", "code"]).optional()
}

export function buildRulesListing(deps: PipelineDeps, kind?: ArtifactKind) {
  const { config, configHash } = deps
  const rules = allRules
    .filter(
      (rule) =>
        !kind || rule.appliesTo === "all" || rule.appliesTo.includes(kind)
    )
    .map((rule) => {
      const settings = config.rules[rule.id] ?? {}
      const { enabled, severity, ...params } = settings
      return {
        id: rule.id,
        appliesTo: rule.appliesTo,
        sealed: SEALED_RULES.includes(rule.id),
        severity: severity ?? rule.defaultSeverity,
        enabled: enabled !== false,
        params
      }
    })
  return {
    rules,
    panel: config.panel,
    judge: {
      provider: config.judge.provider,
      model: config.judge.model,
      canStop: config.judge.canStop,
      thresholds: config.judge.thresholds
    },
    weight: config.weight,
    precedent: config.precedent,
    onError: config.onError,
    policy: { configHash, version: 1 }
  }
}

export function registerListRules(server: McpServer, deps: PipelineDeps): void {
  server.registerTool(
    "list_rules",
    {
      description:
        "現在有効なルール・パネル構成・閾値・configHash の一覧を返す。",
      inputSchema: listRulesInput
    },
    (args) => toResponse(buildRulesListing(deps, args.kind))
  )
}
