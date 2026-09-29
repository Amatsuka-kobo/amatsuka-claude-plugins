/**
 * ルールのレジストリ。全ルールを静的に集め、kind による絞り込みと実行(フェイルクローズド)を行う。
 * 設計書 §6.4.2・§6.4.3(R20・R24)。
 *
 * - ルールに渡す本文から、見出し行と、生成物と E2E のレポートのファイルを外す。
 *   ただし common/secrets には元の本文を渡す(秘密情報はどのパスでも探すため)。
 * - common/resubmission-loop には comparisonContent の本文を渡す。パイプラインは同じ本文から
 *   submission-digest.json を書くので、比べる 2 つのダイジェストは同じ規則の本文から作られる。
 * - 所見はルールとファイルの組ごとに 1 件へ集約し、件数に上限を置く。
 */

import { classifyPath } from "../config/paths.js"
import { log } from "../core/log.js"
import type {
  Artifact,
  ArtifactKind,
  Finding,
  RaguelConfig,
  Rule,
  RuleContext,
  Severity
} from "../core/types.js"
import { destructiveOpsRule } from "./code/destructiveOps.js"
import { type DetailedParsedDiff, parseDiff } from "./code/diffParse.js"
import { maxDiffLinesRule } from "./code/maxDiffLines.js"
import { newDependencyRule } from "./code/newDependency.js"
import { protectedPathsRule } from "./code/protectedPaths.js"
import { testDeletionRule } from "./code/testDeletion.js"
import { unsafeExecRule } from "./code/unsafeExec.js"
import { injectionMarkerRule } from "./common/injectionMarker.js"
import { maxSizeRule } from "./common/maxSize.js"
import { resubmissionLoopRule } from "./common/resubmissionLoop.js"
import { secretsRule } from "./common/secrets.js"
import { noAlternativesRule } from "./decision/noAlternatives.js"
import { noRollbackRule } from "./decision/noRollback.js"
import { irreversibleOpsRule } from "./plan/irreversibleOps.js"
import { maxStepsRule } from "./plan/maxSteps.js"
import { scopeKeywordsRule } from "./plan/scopeKeywords.js"
import { truncateExcerpt } from "./util.js"

/** 全ルールの静的レジストリ */
export const allRules: Rule[] = [
  // common
  secretsRule,
  injectionMarkerRule,
  resubmissionLoopRule,
  maxSizeRule,
  // code
  protectedPathsRule,
  destructiveOpsRule,
  unsafeExecRule,
  maxDiffLinesRule,
  testDeletionRule,
  newDependencyRule,
  // plan / design
  irreversibleOpsRule,
  maxStepsRule,
  scopeKeywordsRule,
  // decision
  noAlternativesRule,
  noRollbackRule
]

/** baseRef と HEAD の間に変更が無い(設計書 §6.2.2 の手順 6・7)。出すのはパイプライン */
export const NO_CHANGE_ID = "code/no-change"
/** 差分が生成物だけ(設計書 §6.4.2、R20) */
export const GENERATED_ONLY_ID = "code/generated-only"
/** ルールの例外と、解釈できない diff のファイル見出し */
export const RULE_ERROR_ID = "rule-error"

/** ルールの ID のほかに、ルール層が出す所見の ID。設定の対象にならない */
export const FIXED_FINDING_IDS: readonly string[] = [
  NO_CHANGE_ID,
  GENERATED_ONLY_ID,
  RULE_ERROR_ID
]

/** ルール層の所見の ID の一覧 */
export const RULE_LAYER_FINDING_IDS: readonly string[] = [
  ...allRules.map((r) => r.id),
  ...FIXED_FINDING_IDS
]

/** 01-rules.json に書く所見の上限(設計書 §6.4.3) */
export const MAX_RULE_FINDINGS = 500
/** 集約した所見に残す抜粋の数 */
const MAX_AGGREGATED_EXCERPTS = 3

/** 元の本文で検査するルール */
const WHOLE_CONTENT_RULE_IDS = new Set([secretsRule.id])

function appliesToKind(rule: Rule, kind: ArtifactKind): boolean {
  return rule.appliesTo === "all" || rule.appliesTo.includes(kind)
}

/**
 * kind に該当し、かつ設定で無効化されていないルールを返す。
 * sealed ルールの enabled:false は config 層で拒否済みの前提で、ここでは素直に従う
 */
export function rulesFor(kind: ArtifactKind, config: RaguelConfig): Rule[] {
  return allRules.filter((rule) => {
    if (!appliesToKind(rule, kind)) return false
    if (config.rules[rule.id]?.enabled === false) return false
    return true
  })
}

interface RuleView {
  artifact: Artifact
  /** view の行(0 始まり)→ 元の本文の行(0 始まり)。行が動かなければ null */
  lineMap: number[] | null
}

/** plan・design・decision は見出し行を空行にする。行番号は動かない */
function blankHeadings(artifact: Artifact): RuleView {
  if (artifact.headingLines.length === 0) return { artifact, lineMap: null }
  const lines = artifact.content.split("\n")
  for (const h of artifact.headingLines) if (h < lines.length) lines[h] = ""
  return { artifact: { ...artifact, content: lines.join("\n") }, lineMap: null }
}

/** code は生成物と E2E のレポートのファイルの区間を diff から外す */
function withoutExcluded(
  artifact: Artifact,
  parsed: DetailedParsedDiff,
  ctx: RuleContext
): RuleView {
  const isNormal = (p: string) =>
    classifyPath(p, ctx.config, ctx.testsDir) === "normal"
  const excluded = parsed.files.filter((f) => !isNormal(f.path))
  if (excluded.length === 0) return { artifact, lineMap: null }

  const drop = new Set<number>()
  for (const f of excluded) for (let i = f.start; i < f.end; i++) drop.add(i)
  const lines = artifact.content.split("\n")
  const kept: string[] = []
  const lineMap: number[] = []
  const newIndex = new Map<number, number>()
  lines.forEach((line, i) => {
    if (drop.has(i)) return
    newIndex.set(i, kept.length)
    kept.push(line)
    lineMap.push(i)
  })
  return {
    artifact: {
      ...artifact,
      content: kept.join("\n"),
      headingLines: artifact.headingLines
        .map((h) => newIndex.get(h))
        .filter((h): h is number => h !== undefined),
      changedPaths: artifact.changedPaths.filter(isNormal)
    },
    lineMap
  }
}

/**
 * 再提出の比較と submission-digest.json のダイジェストに使う本文(設計書 §6.4.2・§6.9.3)。
 * code は生成物と E2E のレポートの区間を外す。ほかの kind は元の本文のまま(見出し行も含める)
 */
export function comparisonContent(
  artifact: Artifact,
  ctx: RuleContext
): string {
  if (artifact.kind !== "code") return artifact.content
  return withoutExcluded(artifact, parseDiff(artifact.content), ctx).artifact
    .content
}

/** 生成物と、ルール層の手前で見つかる diff の問題の所見 */
function diffFindings(parsed: DetailedParsedDiff, ctx: RuleContext): Finding[] {
  const findings: Finding[] = []
  if (parsed.malformedHeaders.length > 0) {
    findings.push({
      ruleId: RULE_ERROR_ID,
      severity: "ask",
      message: `diff のファイル見出しを解釈できませんでした(${parsed.malformedHeaders.length} 行)。その範囲のファイルを見失っている可能性があります`,
      evidence: {
        location: "diff",
        excerpt: truncateExcerpt(
          parsed.malformedHeaders.slice(0, MAX_AGGREGATED_EXCERPTS).join("\n")
        )
      }
    })
  }
  const classes = parsed.files.map((f) => ({
    path: f.path,
    kind: classifyPath(f.path, ctx.config, ctx.testsDir)
  }))
  const generated = classes
    .filter((c) => c.kind === "generated")
    .map((c) => c.path)
  // レポートを含む差分は、パイプラインが code/no-change として扱う
  if (generated.length > 0 && classes.every((c) => c.kind === "generated")) {
    findings.push({
      ruleId: GENERATED_ONLY_ID,
      severity: "info",
      message: `差分は生成物だけです(${generated.length} ファイル)。生成物に見せかけた手書きの変更でないか確かめてください: ${generated.join(", ")}`,
      evidence: { excerpt: truncateExcerpt(generated.join("\n")) }
    })
  }
  return findings
}

function remapLine(finding: Finding, lineMap: number[] | null): Finding {
  const line = finding.evidence?.line
  if (!lineMap || line === undefined) return finding
  const original = lineMap[line - 1]
  if (original === undefined) return finding
  return { ...finding, evidence: { ...finding.evidence, line: original + 1 } }
}

/** ルールとファイル(と severity)の組ごとに 1 件へ集約する。抜粋は最初の 3 か所だけを残す */
export function aggregateFindings(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>()
  for (const f of findings) {
    const where = f.evidence?.path ?? f.evidence?.location ?? ""
    const key = JSON.stringify([f.ruleId, f.severity, where])
    const group = groups.get(key)
    if (group) group.push(f)
    else groups.set(key, [f])
  }
  return [...groups.values()].map((group) => {
    const [first] = group
    if (group.length === 1) return first
    const excerpts = group
      .map((f) => f.evidence?.excerpt)
      .filter((e): e is string => e !== undefined)
      .slice(0, MAX_AGGREGATED_EXCERPTS)
    return {
      ...first,
      message: `${first.message}(同じルールとファイルで ${group.length} 件。抜粋は最初の ${excerpts.length} か所)`,
      evidence: {
        ...first.evidence,
        ...(excerpts.length > 0 ? { excerpt: excerpts.join("\n…\n") } : {})
      }
    }
  })
}

const SEVERITY_ORDER: Record<Severity, number> = { stop: 0, ask: 1, info: 2 }

/** 上限を超えたら severity の重い順に並べて切る */
function capFindings(findings: Finding[]): Finding[] {
  if (findings.length <= MAX_RULE_FINDINGS) return findings
  return [...findings]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_RULE_FINDINGS)
}

/**
 * 該当ルールを順に実行し findings を集約する。
 * 1 ルールの例外で全体を落とさない(フェイルクローズド): 例外は severity "ask" の
 * rule-error finding に変換して続行する
 */
export function runRules(artifact: Artifact, ctx: RuleContext): Finding[] {
  const findings: Finding[] = []
  let view: RuleView
  if (artifact.kind === "code") {
    const parsed = parseDiff(artifact.content)
    findings.push(...diffFindings(parsed, ctx))
    view = withoutExcluded(artifact, parsed, ctx)
  } else {
    view = blankHeadings(artifact)
  }

  for (const rule of rulesFor(artifact.kind, ctx.config)) {
    try {
      if (WHOLE_CONTENT_RULE_IDS.has(rule.id)) {
        findings.push(...rule.check(artifact, ctx))
      } else if (rule.id === resubmissionLoopRule.id) {
        const content = comparisonContent(artifact, ctx)
        findings.push(...rule.check({ ...artifact, content }, ctx))
      } else {
        findings.push(
          ...rule
            .check(view.artifact, ctx)
            .map((f) => remapLine(f, view.lineMap))
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`ルール実行中にエラーが発生しました: ${rule.id}`, { message })
      findings.push({
        ruleId: RULE_ERROR_ID,
        severity: "ask",
        message: `ルール "${rule.id}" の実行中にエラーが発生しました: ${message}`,
        evidence: { location: rule.id }
      })
    }
  }

  return capFindings(aggregateFindings(findings))
}
