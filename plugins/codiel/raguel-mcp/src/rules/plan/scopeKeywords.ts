/**
 * plan/scope-keywords — スコープ逸脱ヒューリスティック(既定 ask)。
 * 成果物本文に登場する「領域ワード」のうち objective に一切現れないものが
 * 2 つ以上あれば発火する。過検知しやすいため message は控えめにする。
 */

import type { Finding, Rule } from "../../core/types.js"
import { escapeRegExp, getSeverity, isAsciiWord } from "../util.js"

const RULE_ID = "plan/scope-keywords"

const BUILTIN_DOMAINS: Record<string, RegExp> = {
  deploy: /\b(deploy|deployment|release)\b/i,
  auth: /\b(auth|authentication|authorization|login|oauth)\b/i,
  database: /\b(database|schema migration|sql schema)\b/i,
  ci: /\b(ci\/cd|ci pipeline|github actions|workflow)\b/i,
  infra: /\b(infra|infrastructure|terraform|kubernetes|k8s)\b/i,
  billing: /\b(billing|payment|stripe|invoice)\b/i,
  security: /\b(security|vulnerability|cve|exploit)\b/i,
  network: /\b(network|dns|firewall|vpc)\b/i
}

function domainMatcher(name: string): RegExp {
  if (isAsciiWord(name)) {
    return new RegExp(`\\b${escapeRegExp(name)}\\b`, "i")
  }
  // 日本語などの領域名は単語境界を持たないため単純一致
  return new RegExp(escapeRegExp(name), "i")
}

export const scopeKeywordsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["plan", "design"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")
    const extraDomains = Array.isArray(settings?.domains)
      ? (settings.domains as string[])
      : []

    const domains: Record<string, RegExp> = { ...BUILTIN_DOMAINS }
    for (const name of extraDomains) {
      domains[name] = domainMatcher(name)
    }

    const uncovered: string[] = []
    for (const [name, matcher] of Object.entries(domains)) {
      if (!matcher.test(artifact.content)) continue
      if (!matcher.test(artifact.objective)) uncovered.push(name)
    }

    if (uncovered.length < 2) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `objective に現れない領域への言及が複数見られます(${uncovered.join(", ")})。念のためスコープを確認してください`
      }
    ]
  }
}
