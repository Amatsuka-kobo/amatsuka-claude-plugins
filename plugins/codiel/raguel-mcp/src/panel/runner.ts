/**
 * パネルの起動(設計書 §6.6.1・§6.8)。構成は tier と kind で決まり、設定では変えられない。
 * - standard(code): adversarial → steelman
 * - standard(文書): 前フェーズの証拠があれば adversarial と crosscheck を並列、無ければ adversarial だけ → steelman
 * - critical: adversarial と crosscheck を並列 → steelman → meta
 * 失敗したパネリストと meta は panel/<名前>-error(ask)と degradedReasons に変える。
 * signal が abort したら signal.reason を投げる(呼び出し側が attempt を捨てる)。
 *
 * 旧構成の assumption と precedent のパネリストは撤去した。前提の点検は adversarial の職務に入れ、
 * 判例は adversarial と meta への参考入力にした(§6.6.1・§6.11)。
 */

import { priorPhasesOf } from "../codiel/phases.js"
import { resolvePanelist } from "../config/defaults.js"
import type {
  Artifact,
  DegradedReason,
  Finding,
  JudgeProviderName,
  PanelReport,
  PanelRole,
  Precedent,
  RaguelConfig
} from "../core/types.js"
import type {
  PanelResult,
  SteelmanVerdict,
  TargetPanelist
} from "../core/verdict.js"
import { runAdversarial } from "./panelists/adversarial.js"
import { type FactRow, runCrosscheck } from "./panelists/crosscheck.js"
import { runMetaPanelist } from "./panelists/meta.js"
import { runSteelman, type SteelmanTarget } from "./panelists/steelman.js"
import { formatPriorEvidence, formatRuleFindings } from "./prompts.js"
import {
  type CallControl,
  DEADLINE_MARGIN_MS,
  JudgeError,
  type JudgeProvider
} from "./provider.js"

export interface PanelInput {
  artifact: Artifact
  /** パネルを起動する重さ。trivial ではパネルを起動しない */
  tier: "standard" | "critical"
  ruleFindings: Finding[]
  /** 判例の検索結果。adversarial と meta の参考入力にする */
  precedents: Precedent[]
  /** 前フェーズの証拠(§6.3)。文書の standard では、これがあるときだけ crosscheck を起動する */
  priorEvidence?: string
  /** crosscheck の事実表 */
  facts?: readonly FactRow[]
}

export interface PanelDeps {
  config: RaguelConfig
  /** プロバイダーの名前ごとの実装。無い名前のパネリストは unavailable になる */
  providers: Partial<Record<JudgeProviderName, JudgeProvider>>
  /** ゲート全体の締切の時刻(Date.now() と同じ単位) */
  deadline: number
  signal: AbortSignal
}

export interface PanelOutcome extends PanelResult {
  /** 起動を試みたパネリストと meta(試みた順。unavailable と deadline で起動しなかったものを含む) */
  launched: PanelRole[]
}

export interface PanelPlan {
  /** 最初の波で並列に起動するパネリスト */
  first: TargetPanelist[]
  meta: boolean
}

/** tier・kind・前フェーズの証拠の有無から構成を決める(§6.6.1、R15) */
export function planPanel(
  artifact: Pick<Artifact, "kind" | "phase">,
  tier: "standard" | "critical",
  hasPriorEvidence: boolean
): PanelPlan {
  if (tier === "critical") {
    return { first: ["adversarial", "crosscheck"], meta: true }
  }
  // intent は最初のゲート付きフェーズで前フェーズを持たないので、証拠が渡っても crosscheck を起動しない
  const crosscheck =
    artifact.kind !== "code" &&
    hasPriorEvidence &&
    priorPhasesOf(artifact.phase).length > 0
  return {
    first: crosscheck ? ["adversarial", "crosscheck"] : ["adversarial"],
    meta: false
  }
}

/** meta に渡す証拠の束の上限 */
const PRIOR_EVIDENCE_LIMIT = 4000

function errorFinding(role: PanelRole, err: unknown): Finding {
  const detail =
    err instanceof JudgeError
      ? `${err.reason}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err)
  return {
    ruleId: `panel/${role}-error`,
    severity: "ask",
    message: `${role} の実行に失敗した(判定の基盤の障害): ${detail}`
  }
}

function degradedReason(role: PanelRole, err: unknown): DegradedReason {
  return {
    source: role,
    reason: err instanceof JudgeError ? err.reason : "internal-error"
  }
}

export async function runPanel(
  input: PanelInput,
  deps: PanelDeps
): Promise<PanelOutcome> {
  const { config, signal } = deps
  const outcome: PanelOutcome = {
    launched: [],
    reports: [],
    steelmanVerdicts: [],
    errorFindings: [],
    degradedReasons: []
  }

  const call = <T>(
    role: PanelRole,
    fn: (provider: JudgeProvider, model: string, ctl: CallControl) => Promise<T>
  ): Promise<T> => {
    outcome.launched.push(role)
    // judge.provider が none なら LLM を一切起動しない(§6.7.1)
    const resolved = resolvePanelist(config, role)
    const name: JudgeProviderName =
      config.judge.provider === "none" ? "none" : resolved.provider
    const provider = deps.providers[name]
    if (!provider) {
      return Promise.reject(
        new JudgeError("unavailable", `プロバイダー ${name} を起動できない`)
      )
    }
    if (deps.deadline - Date.now() <= DEADLINE_MARGIN_MS) {
      return Promise.reject(
        new JudgeError("deadline", `締切を過ぎたので ${role} を起動しない`)
      )
    }
    return fn(provider, resolved.model ?? "", {
      timeoutMs: config.judge.timeoutMs,
      deadline: deps.deadline,
      signal
    })
  }

  const fail = (role: PanelRole, err: unknown) => {
    outcome.errorFindings.push(errorFinding(role, err))
    outcome.degradedReasons.push(degradedReason(role, err))
  }

  const settle = async <T>(
    promises: Promise<T>[]
  ): Promise<PromiseSettledResult<T>[]> => {
    const settled = await Promise.allSettled(promises)
    if (signal.aborted) throw signal.reason
    return settled
  }

  // 1 つ目の波: adversarial(と crosscheck)
  const plan = planPanel(input.artifact, input.tier, !!input.priorEvidence)
  const first = await settle(
    plan.first.map((role) =>
      role === "adversarial"
        ? call(role, (p, model, ctl) =>
            runAdversarial(
              {
                artifact: input.artifact,
                ruleFindings: input.ruleFindings,
                precedents: input.precedents
              },
              p,
              model,
              ctl
            )
          )
        : call(role, (p, model, ctl) =>
            runCrosscheck(
              {
                artifact: input.artifact,
                priorEvidence: input.priorEvidence,
                facts: input.facts
              },
              p,
              model,
              ctl
            )
          )
    )
  )
  const targets: SteelmanTarget[] = []
  first.forEach((res, i) => {
    const role = plan.first[i]
    if (res.status === "rejected") {
      fail(role, res.reason)
      return
    }
    outcome.reports.push(res.value)
    res.value.findings.forEach((finding, findingIndex) => {
      targets.push({ panelist: role, findingIndex, finding })
    })
  })

  // 2 つ目の波: steelman。攻める側が 1 つも成功しなければ起動しない
  if (outcome.reports.length > 0) {
    const [res] = await settle([
      call("steelman", (p, model, ctl) =>
        runSteelman({ artifact: input.artifact, targets }, p, model, ctl)
      )
    ])
    if (res.status === "fulfilled") {
      outcome.reports.push(res.value.report)
      outcome.steelmanVerdicts = res.value.verdicts
    } else {
      fail("steelman", res.reason)
    }
  }

  // 3 つ目の波: meta(critical だけ)
  if (plan.meta) {
    const evidenceBundle = buildMetaEvidence(input, outcome)
    const [res] = await settle([
      call("meta", (p, model, ctl) =>
        runMetaPanelist(
          {
            evidenceBundle,
            kind: input.artifact.kind,
            precedents: input.precedents
          },
          p,
          model,
          ctl
        )
      )
    ])
    if (res.status === "fulfilled") outcome.meta = res.value
    else fail("meta", res.reason)
  }

  return outcome
}

function formatReport(report: PanelReport): string {
  const findings =
    report.findings.length === 0
      ? "(所見なし)"
      : report.findings
          .map(
            (f, i) =>
              `[${i}] [${f.severity}] (confidence: ${f.confidence ?? "?"}) ${f.message}`
          )
          .join("\n")
  return [
    `### ${report.panelist}`,
    findings,
    `scores: ${JSON.stringify(report.scores)}`
  ].join("\n")
}

function formatVerdicts(verdicts: readonly SteelmanVerdict[]): string {
  if (verdicts.length === 0) return "(反駁なし)"
  return verdicts
    .map(
      (v) => `- ${v.panelist} [${v.findingIndex}]: ${v.outcome} — ${v.rebuttal}`
    )
    .join("\n")
}

/** meta の証拠の束。成果物の原文は入れない(meta は証拠だけを読む) */
function buildMetaEvidence(input: PanelInput, outcome: PanelOutcome): string {
  const prior = input.priorEvidence
    ? input.priorEvidence.slice(0, PRIOR_EVIDENCE_LIMIT)
    : undefined
  return [
    `kind: ${input.artifact.kind}、phase: ${input.artifact.phase}、tier: ${input.tier}`,
    "",
    "## ルール層の所見",
    formatRuleFindings(input.ruleFindings),
    "",
    "## パネリストの所見とスコア",
    outcome.reports.length === 0
      ? "(成功したパネリストなし)"
      : outcome.reports.map(formatReport).join("\n\n"),
    "",
    "## steelman の反駁",
    formatVerdicts(outcome.steelmanVerdicts),
    "",
    "## 失敗したパネリスト",
    outcome.errorFindings.length === 0
      ? "(なし)"
      : outcome.errorFindings.map((f) => `- ${f.message}`).join("\n"),
    "",
    "## 前フェーズの証拠",
    formatPriorEvidence(prior)
  ].join("\n")
}
