/**
 * 判定パイプライン(設計書 §6.3)。
 * 1 設定の読み直し → 2 入力の検証と評価対象の取得 → 3 前フェーズの証拠と改竄の検証 →
 * 4 過去の attempt のダイジェスト → 5 ルール層 → 6 Jev の文脈判定(有効なときだけ) → 7 重さ判定 →
 * 8 判例の検索とパネル → 9 合成 → 10 ケースファイルと索引 → 11 保持の上限の掃除。
 *
 * - 入力の誤りは SubjectInputError で投げ、記録しない(§6.2.6)。
 * - 設定の読み込みの失敗と内部エラーは、一意の evaluationId で ASK・degraded を記録する(§6.2.6、所見 D3)。
 * - 空の差分と E2E のレポートだけの差分は、変更なしとして PROCEED にする(§6.2.2 の手順 6・7)。
 * - signal が abort したら、attempt を作らず(作っていれば消し)、索引に書かずに signal.reason を投げる(§6.8)。
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { computeDigest } from "../casefile/digest.js"
import { CaseStore, NO_EVALUATION_RECORD } from "../casefile/store.js"
import { findPhase, priorPhasesOf } from "../codiel/phases.js"
import { defaultConfig } from "../config/defaults.js"
import { classifyPath, type PathClass } from "../config/paths.js"
import type { JevCall } from "../context/jev.js"
import {
  type ContextJudgeResult,
  type JudgeCandidate,
  runContextJudge
} from "../context/judge.js"
import {
  type FactRow,
  factRowsFromDiff
} from "../panel/panelists/crosscheck.js"
import type {
  CallControl,
  JudgeCall,
  JudgeProvider
} from "../panel/provider.js"
import { type PanelOutcome, runPanel } from "../panel/runner.js"
import {
  type PrecedentMatch,
  searchPrecedents
} from "../precedent/retrieval.js"
import { filterFiredRules, loadCorpus } from "../precedent/store.js"
import {
  type DetailedDiffFile,
  type DetailedParsedDiff,
  parseDiff
} from "../rules/code/diffParse.js"
import { injectionMarkerRule } from "../rules/common/injectionMarker.js"
import {
  findAddressedButSimilar,
  resubmissionFindings
} from "../rules/common/resubmissionLoop.js"
import { maskSecrets, secretsRule } from "../rules/common/secrets.js"
import { ruleParam } from "../rules/params.js"
import { comparisonContent, NO_CHANGE_ID, runRules } from "../rules/registry.js"
import { collectDecisionSubject } from "../subject/body.js"
import { collectCodeSubject } from "../subject/code.js"
import { collectFilesSubject } from "../subject/files.js"
import { SubjectInputError } from "../subject/types.js"
import { log } from "./log.js"
import type {
  Artifact,
  ContextJudgeSummary,
  DegradedReason,
  EvaluationResult,
  Finding,
  GatedPhase,
  JudgeProviderName,
  LoadedConfig,
  MetaReport,
  PanelReport,
  Policy,
  RaguelConfig,
  RuleContext,
  Severity,
  Subject,
  VerdictRecord,
  WeightResult,
  WeightTier
} from "./types.js"
import { synthesize } from "./verdict.js"
import { computeWeight } from "./weight.js"

// ---- 入力と依存 ----

interface CommonRequest {
  runId: string
  phase: GatedPhase
  objective: string
  repoPath?: string
}

/** evaluate_* の入力(§6.2)。本文は Raguel が自分で読むので、呼び出し側は本文を渡さない */
export type EvaluationRequest =
  | (CommonRequest & {
      tool: "evaluate_code"
      baseRef: string
      paths?: string[]
      testResults?: string
    })
  | (CommonRequest & {
      tool: "evaluate_plan" | "evaluate_design"
      paths: string[]
    })
  | (CommonRequest & {
      tool: "evaluate_decision"
      decision: string
      optionsConsidered?: string[]
      rollbackPlan?: string
    })

export type Providers = Partial<Record<JudgeProviderName, JudgeProvider>>

/** 読み込んだ設定と、その設定で作ったプロバイダー */
export interface Runtime {
  loaded: LoadedConfig
  providers: Providers
}

/** 設定の読み込みの結果(§6.12.4)。壊れた設定でも評価は ASK・degraded で返す */
export type RuntimeResult =
  | { ok: true; runtime: Runtime }
  | { ok: false; error: string; path: string; source: string }

export interface PipelineDeps {
  /** 評価ごとに呼ぶ。設定を読み直し、変わっていればプロバイダーを作り直す(§6.3 の 1) */
  runtime: () => RuntimeResult
  /** 評価対象の取得と記録の置き場に使うプロジェクトルート(§6.9.1) */
  projectRoot: string
  /** raguel-mcp の package.json の version(§8、所見 J2) */
  buildVersion: string
  /** テストで Jev の呼び出しを差し替える。省略時は SDK で呼ぶ */
  jevCall?: JevCall
  /** 省略時は環境変数 TYPESAFE_API_KEY */
  jevApiKey?: string
}

export interface EvaluationControl {
  /** MCP のハンドラの extra.signal */
  signal: AbortSignal
  /** ステップごとの進捗(§6.8)。progressToken があるときだけ渡す */
  progress?: (message: string) => void
}

// ---- 定数 ----

const POLICY_VERSION = 2
/** 応答に載せる所見の上限(§6.4.3) */
export const MAX_RESPONSE_FINDINGS = 50
/** 前フェーズの証拠に載せる提出本文の長さ(§6.3) */
const PRIOR_SUBMISSION_LIMIT = 4000
/** 文書の事実表に載せる参照パスの上限 */
const MAX_FACT_PATHS = 30
/** precedent/failure-match を出す合成スコアの下限(§6.11) */
const FAILURE_MATCH_SCORE = 0.5

const RESUBMISSION_ID = "common/resubmission-loop"
const FAILURE_MATCH_ID = "precedent/failure-match"
const TAMPERED_ID = "casefile/tampered"

const PANEL_EVIDENCE = {
  adversarial: "03-adversarial.md",
  steelman: "04-steelman.md",
  crosscheck: "05-crosscheck.md"
} as const

const SEVERITY_RANK: Record<Severity, number> = { stop: 0, ask: 1, info: 2 }

// ---- 評価 ----

interface Target {
  artifact: Artifact
  /** code だけ持つ */
  parsed?: DetailedParsedDiff
  /** 差分が空(code だけ) */
  empty: boolean
}

interface Attempt {
  dir: string
  attempt: number
}

/**
 * 1 回の評価を行い、記録して結果を返す。
 * 入力の誤りは SubjectInputError、中止は signal.reason を投げる。記録の書き込みに失敗したときも投げる
 */
export async function evaluate(
  req: EvaluationRequest,
  deps: PipelineDeps,
  ctl: EvaluationControl
): Promise<EvaluationResult> {
  const entry = findPhase(req.phase)
  if (!entry || entry.tool !== req.tool) {
    throw new SubjectInputError(
      `phase ${req.phase} は ${req.tool} で評価しない(このフェーズのツールは ${entry?.tool ?? "無い"})`
    )
  }
  const started = Date.now()
  const evaluationId = randomUUID()
  const rt = deps.runtime()
  const opened: { current?: Attempt } = {}
  let target: Target | undefined

  try {
    ctl.progress?.("評価対象の取得")
    target = collectTarget(req, deps.projectRoot)
    if (!rt.ok) {
      return recordDegraded({
        evaluationId,
        req,
        deps,
        runtime: null,
        target,
        reason: { source: "config", reason: "config-error" },
        finding: {
          ruleId: "kernel/config-error",
          severity: "ask",
          message: `設定(${rt.path})を読み込めないので、判定せずに ASK にする: ${rt.error}`,
          evidence: { location: rt.path }
        },
        configSource: rt.source,
        opened
      })
    }
    return await judge({
      evaluationId,
      req,
      deps,
      runtime: rt.runtime,
      target,
      deadline: started + rt.runtime.loaded.config.judge.deadlineMs,
      ctl,
      opened
    })
  } catch (err) {
    if (err instanceof SubjectInputError) throw err
    if (ctl.signal.aborted) {
      if (opened.current) {
        fs.rmSync(opened.current.dir, { recursive: true, force: true })
      }
      throw ctl.signal.reason ?? err
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error("評価の内部エラー(ASK・degraded で記録する)", { message })
    return recordDegraded({
      evaluationId,
      req,
      deps,
      runtime: rt.ok ? rt.runtime : null,
      target,
      reason: { source: "kernel", reason: "internal-error" },
      finding: {
        ruleId: "kernel/internal-error",
        severity: "ask",
        message: `判定パイプラインの内部エラーのため、判定せずに ASK にする: ${message}`
      },
      configSource: rt.ok ? rt.runtime.loaded.source : rt.source,
      opened
    })
  }
}

/** 手順 2: 入力を検証し、評価対象を読む(§6.2.2〜§6.2.4) */
function collectTarget(req: EvaluationRequest, projectRoot: string): Target {
  const base = { phase: req.phase, runId: req.runId, objective: req.objective }
  switch (req.tool) {
    case "evaluate_code": {
      const { subject, diff, empty } = collectCodeSubject({
        projectRoot,
        repoPath: req.repoPath,
        baseRef: req.baseRef,
        paths: req.paths
      })
      const parsed = parseDiff(diff)
      return {
        artifact: {
          ...base,
          kind: "code",
          content: diff,
          headingLines: parsed.headingLines,
          subject,
          changedPaths: parsed.files.map((f) => f.path),
          context:
            req.testResults === undefined
              ? {}
              : { testResults: req.testResults }
        },
        parsed,
        empty
      }
    }
    case "evaluate_plan":
    case "evaluate_design": {
      const { subject, body } = collectFilesSubject({
        projectRoot,
        repoPath: req.repoPath,
        paths: req.paths
      })
      return {
        artifact: {
          ...base,
          kind: req.tool === "evaluate_plan" ? "plan" : "design",
          content: body.text,
          headingLines: body.headingLines,
          subject,
          changedPaths: [],
          context: {}
        },
        empty: false
      }
    }
    case "evaluate_decision": {
      const { subject, body } = collectDecisionSubject({
        projectRoot,
        repoPath: req.repoPath,
        decision: req.decision,
        optionsConsidered: req.optionsConsidered,
        rollbackPlan: req.rollbackPlan
      })
      return {
        artifact: {
          ...base,
          kind: "decision",
          content: body.text,
          headingLines: body.headingLines,
          subject,
          changedPaths: [],
          context: {
            ...(req.optionsConsidered
              ? { optionsConsidered: req.optionsConsidered }
              : {}),
            ...(req.rollbackPlan !== undefined
              ? { rollbackPlan: req.rollbackPlan }
              : {})
          }
        },
        empty: false
      }
    }
  }
}

interface JudgeInput {
  evaluationId: string
  req: EvaluationRequest
  deps: PipelineDeps
  runtime: Runtime
  target: Target
  deadline: number
  ctl: EvaluationControl
  opened: { current?: Attempt }
}

async function judge(input: JudgeInput): Promise<EvaluationResult> {
  const { deps, runtime, target, ctl } = input
  const { config, testsDir } = runtime.loaded
  const { artifact, parsed } = target
  const store = new CaseStore(config, deps.projectRoot)
  const classOf = (p: string): PathClass => classifyPath(p, config, testsDir)
  const jevSummary = (status: "off" | "skipped"): ContextJudgeSummary => ({
    enabled: config.contextJudge.enabled,
    status: config.contextJudge.enabled ? status : "off",
    adjustments: []
  })

  // 手順 6・7 の変更なし(R22・R24)
  if (parsed) {
    const classes = parsed.files.map((f) => classOf(f.path))
    const reports = classes.filter((c) => c === "report").length
    if (target.empty || (reports > 0 && classes.every((c) => c !== "normal"))) {
      return finishNoChange(input, store, reports, jevSummary("skipped"))
    }
  }

  // 手順 3〜5
  ctl.progress?.("ルール層")
  const priorAttempts = store.readPriorAttempts(artifact.runId, artifact.phase)
  const prior = collectPriorEvidence(store, artifact.runId, artifact.phase)
  const ruleCtx: RuleContext = { config, testsDir, priorAttempts }
  const layered = [
    ...prior.tampered,
    ...runRules(artifact, ruleCtx),
    ...testResultsFindings(artifact, ruleCtx)
  ]
  // D5: 今回のほかの所見を渡して、修正ありの相手を比較から外す。
  // 比べる本文は submission-digest.json と同じく生成物とレポートを外したもの(§6.4.2)
  const others = layered.filter((f) => f.ruleId !== RESUBMISSION_ID)
  const compared = comparisonContent(artifact, ruleCtx)
  let ruleFindings = [
    ...others,
    ...resubmissionFindings({ ...artifact, content: compared }, ruleCtx, others)
  ]

  // 手順 6: Jev の文脈判定
  const extraReasons: string[] = []
  let context: ContextJudgeResult | undefined
  let contextSummary = jevSummary("off")
  if (config.contextJudge.enabled) {
    ctl.progress?.("Jev の文脈判定")
    context = await runContextJudge(
      contextInput(artifact, parsed, ruleFindings, others, {
        store,
        config,
        classOf,
        priorAttempts,
        compared
      }),
      {
        settings: config.contextJudge,
        apiKey: deps.jevApiKey,
        jevCall: deps.jevCall,
        remainingMs: input.deadline - Date.now(),
        signal: ctl.signal
      }
    )
    ctl.signal.throwIfAborted()
    // 設定で無効にしたルールの所見は、Jev が作ったものも残さない
    const enabled = (id: string) => config.rules[id]?.enabled !== false
    ruleFindings = context.adjustedFindings.filter((f) => enabled(f.ruleId))
    contextSummary = {
      enabled: true,
      status: context.status,
      adjustments: context.adjustments.filter((a) => enabled(a.ruleId))
    }
    const unavailable = context.record?.unavailableReasons ?? []
    if (unavailable.length > 0) {
      extraReasons.push(
        `context-judge: Jev の文脈判定が効かなかった対象は決定論の結果で判定した(${unavailable.join("; ")})`
      )
    }
  }

  // 手順 7
  const weight = computeWeight(artifact, ruleFindings, config, {
    testsDir,
    contextFloor: context?.tierFloor
  })

  // 手順 8
  let panel: PanelOutcome | undefined
  let precedents: PrecedentMatch[] | undefined
  const ruleStop = ruleFindings.some((f) => f.severity === "stop")
  if (!ruleStop && weight.tier !== "trivial") {
    precedents = searchPrecedents(
      {
        kind: artifact.kind,
        objective: artifact.objective,
        summaryText: artifact.content,
        firedRules: filterFiredRules([
          ...new Set(ruleFindings.map((f) => f.ruleId))
        ]),
        changedPaths: artifact.changedPaths.filter(
          (p) => classOf(p) === "normal"
        )
      },
      loadCorpus(config, deps.projectRoot),
      config.precedent.topN
    )
    const failures = precedents.filter(
      (m) =>
        (m.precedent.outcome === "rejected" ||
          m.precedent.outcome === "incident") &&
        m.score >= FAILURE_MATCH_SCORE
    )
    if (
      failures.length > 0 &&
      config.rules[FAILURE_MATCH_ID]?.enabled !== false
    ) {
      ruleFindings.push({
        ruleId: FAILURE_MATCH_ID,
        severity: "info",
        message: `失敗に終わった過去の判例に似ている: ${failures.map((m) => m.precedent.id).join(", ")}`
      })
    }
    ctl.progress?.("パネル")
    panel = await runPanel(
      {
        artifact: panelArtifact(artifact, parsed, classOf),
        tier: weight.tier,
        ruleFindings,
        precedents: precedents.map((m) => m.precedent),
        priorEvidence: prior.text,
        facts: factRows(artifact, parsed, classOf)
      },
      {
        config,
        providers: withProgress(runtime.providers, ctl.progress),
        deadline: input.deadline,
        signal: ctl.signal
      }
    )
  }

  // 手順 9
  ctl.progress?.("合成")
  const synthesis = synthesize({
    weightTier: weight.tier,
    ruleFindings,
    panel,
    config
  })
  ctl.signal.throwIfAborted()

  // 手順 10・11
  return record(input, store, {
    verdict: synthesis.verdict,
    judgeStatus: synthesis.judgeStatus,
    degradedReasons: synthesis.degradedReasons,
    weight,
    ruleFindings,
    findings: synthesis.findings,
    reasons: [...synthesis.reasons, ...extraReasons],
    decisionPoint: synthesis.decisionPoint,
    variance: synthesis.variance,
    panel,
    precedents,
    contextRecord: context?.record ?? null,
    contextSummary
  })
}

/** 変更なしの評価(§6.2.2 の手順 6・7)。ルール層・Jev・重さ判定・パネルを通さない */
function finishNoChange(
  input: JudgeInput,
  store: CaseStore,
  reports: number,
  contextSummary: ContextJudgeSummary
): EvaluationResult {
  const { artifact } = input.target
  const { config, testsDir } = input.runtime.loaded
  const noChange: Finding = {
    ruleId: NO_CHANGE_ID,
    severity: "info",
    message:
      reports > 0
        ? `差分は E2E のレポート(${reports} ファイル)と生成物だけで、baseRef と HEAD の間にこのフェーズの変更が無い`
        : "baseRef と HEAD の間にこのフェーズの変更が無い"
  }
  // レポートと生成物には common/secrets だけを当てる(§6.4.2)。空の差分には当てるものが無い
  const secrets = input.target.empty
    ? []
    : secretsRule.check(artifact, { config, testsDir, priorAttempts: [] })
  const ruleFindings = [...secrets, noChange]
  const synthesis = synthesize({
    weightTier: "trivial",
    ruleFindings,
    config
  })
  return record(input, store, {
    verdict: synthesis.verdict,
    judgeStatus: synthesis.judgeStatus,
    degradedReasons: synthesis.degradedReasons,
    weight: { tier: "trivial", score: 0, factors: {}, floors: [] },
    ruleFindings,
    findings: synthesis.findings,
    reasons: [
      `no-change: ${noChange.message}。ルール層(レポートと生成物の common/secrets を除く)・Jev・重さ判定・パネルを通さない`,
      ...synthesis.reasons
    ],
    decisionPoint: synthesis.decisionPoint,
    variance: null,
    contextRecord: null,
    contextSummary
  })
}

// ---- 前フェーズの証拠(§6.3) ----

function collectPriorEvidence(
  store: CaseStore,
  runId: string,
  phase: GatedPhase
): { text?: string; tampered: Finding[] } {
  const chunks: string[] = []
  const tampered: Finding[] = []
  for (const prior of priorPhasesOf(phase)) {
    const dir = store.latestAttemptDir(runId, prior)
    if (!dir) continue
    const check = store.verifyAttempt(dir)
    if (!check.ok) {
      tampered.push({
        ruleId: TAMPERED_ID,
        severity: "stop",
        message: `前フェーズ ${prior} のケースファイルが改竄されている: ${check.mismatches.join("; ")}`,
        evidence: { location: dir }
      })
      continue
    }
    const v = store.readVerdict(dir) as VerdictRecord
    if (!store.lookupEvaluation(v.evaluationId)) {
      chunks.push(`## 前フェーズ ${prior}\n${NO_EVALUATION_RECORD}`)
      continue
    }
    const ruling = store.lookupOutcome(v.evaluationId)
    const submission = store.readEvidence(dir, "submission.txt") ?? ""
    chunks.push(
      [
        `## 前フェーズ ${prior}(attempt ${v.attempt}、verdict ${v.verdict}、judgeStatus ${v.judgeStatus})`,
        `ルール層の ask 以上の所見: ${askRuleIds(store.readEvidence(dir, "01-rules.json")).join(", ") || "なし"}`,
        `meta の rationale: ${v.meta?.rationale ?? "なし"}`,
        `人の裁定: ${ruling ? `${ruling.ruling ?? "なし"}(outcome ${ruling.outcome})${ruling.notes ? `: ${ruling.notes}` : ""}` : "なし"}`,
        `提出本文(先頭 ${PRIOR_SUBMISSION_LIMIT} 文字):`,
        submission.slice(0, PRIOR_SUBMISSION_LIMIT)
      ].join("\n")
    )
  }
  return {
    ...(chunks.length > 0 ? { text: chunks.join("\n\n") } : {}),
    tampered
  }
}

function askRuleIds(rulesJson: string | undefined): string[] {
  if (rulesJson === undefined) return []
  try {
    const { findings } = JSON.parse(rulesJson) as { findings?: Finding[] }
    return [
      ...new Set(
        (findings ?? [])
          .filter((f) => f.severity !== "info")
          .map((f) => f.ruleId)
      )
    ]
  } catch {
    return []
  }
}

// ---- ルール層の補い ----

/**
 * testResults に common/secrets と common/injection-marker を当てる(§6.2.2)。testResults は信頼しない入力である。
 * 行番号は diff のものでないので evidence.line を外し、位置を testResults と書く
 */
function testResultsFindings(artifact: Artifact, ctx: RuleContext): Finding[] {
  const text = artifact.context.testResults
  if (!text) return []
  const view: Artifact = { ...artifact, content: text, headingLines: [] }
  return [
    ...secretsRule.check(view, ctx),
    ...injectionMarkerRule.check(view, ctx)
  ].map(({ evidence, ...f }) => {
    const { line, location, ...rest } = evidence ?? {}
    return {
      ...f,
      evidence: {
        ...rest,
        location: `testResults${line === undefined ? "" : ` ${line} 行目`}`
      }
    }
  })
}

// ---- Jev の文脈判定の入力(§6.4.4) ----

function contextInput(
  artifact: Artifact,
  parsed: DetailedParsedDiff | undefined,
  findings: Finding[],
  others: Finding[],
  env: {
    store: CaseStore
    config: RaguelConfig
    classOf: (p: string) => PathClass
    priorAttempts: RuleContext["priorAttempts"]
    /** 再提出の比較に使う本文(comparisonContent) */
    compared: string
  }
) {
  // 生成物とレポートは Jev に送らない
  const view = parsed
    ? viewWithout(
        artifact.content,
        parsed.files.filter((f) => env.classOf(f.path) !== "normal"),
        () => null
      )
    : null
  const candidates: JudgeCandidate[] = []
  findings.forEach((f, findingIndex) => {
    if (
      f.ruleId !== "code/destructive-ops" &&
      f.ruleId !== "code/unsafe-exec"
    ) {
      return
    }
    const original = f.evidence?.line
    if (original === undefined) return
    const line = view ? view.lineMap.get(original) : original
    if (line === undefined) return
    candidates.push({
      ruleId: f.ruleId,
      findingIndex,
      path: f.evidence?.path ?? "",
      line
    })
  })
  const resubmissionTargets = findAddressedButSimilar(
    env.compared,
    env.priorAttempts,
    others,
    ruleParam<number>(env.config, RESUBMISSION_ID, "similarityThreshold")
  )
  return {
    kind: artifact.kind,
    objective: artifact.objective,
    maskedArtifact: maskSecrets(view ? view.text : artifact.content),
    findings,
    candidates,
    priorFindings: priorFindingsOf(
      env.store,
      artifact,
      resubmissionTargets.map((t) => t.attempt)
    ),
    decisionFields: {
      ...(artifact.context.rollbackPlan !== undefined
        ? { rollbackPlan: artifact.context.rollbackPlan }
        : {}),
      ...(artifact.context.optionsConsidered
        ? { optionsConsidered: artifact.context.optionsConsidered }
        : {})
    },
    resubmissionTargets
  }
}

/** 対象の attempt の verdict.json から ask 以上の所見(パネルの採用所見を含む)を伏せ字にして取る */
function priorFindingsOf(
  store: CaseStore,
  artifact: Artifact,
  attempts: number[]
) {
  if (attempts.length === 0) return []
  const latest = store.latestAttemptDir(artifact.runId, artifact.phase)
  if (!latest) return []
  const phaseDir = path.dirname(latest)
  return attempts.flatMap((attempt) => {
    const dir = path.join(
      phaseDir,
      `attempt-${String(attempt).padStart(2, "0")}`
    )
    const v = store.readVerdict(dir)
    return (v?.findings ?? [])
      .filter((f) => f.severity !== "info")
      .map((f) => ({
        attempt,
        ruleId: f.ruleId,
        message: maskSecrets(f.message)
      }))
  })
}

// ---- パネルの入力 ----

/**
 * diff の本文から、除くファイルの区間を外す。replace が行を返せば、その区間を 1 行に置き換える。
 * lineMap は元の本文の 1 始まりの行番号から、外した後の本文の 1 始まりの行番号への対応
 */
function viewWithout(
  content: string,
  excluded: DetailedDiffFile[],
  replace: (f: DetailedDiffFile) => string | null
): { text: string; lineMap: Map<number, number> } {
  const lines = content.split("\n")
  const byStart = new Map(excluded.map((f) => [f.start, f]))
  const out: string[] = []
  const lineMap = new Map<number, number>()
  for (let i = 0; i < lines.length; i++) {
    const file = byStart.get(i)
    if (file) {
      const line = replace(file)
      if (line !== null) out.push(line)
      i = file.end - 1
      continue
    }
    out.push(lines[i] as string)
    lineMap.set(i + 1, out.length)
  }
  return { text: out.join("\n"), lineMap }
}

/**
 * パネルに渡す成果物。code の生成物とレポートは、ファイルごとに 1 行へ縮める(§6.4.2)。
 * testResults は末尾に足し、信頼しない入力と書き添える(§6.2.2)
 */
function panelArtifact(
  artifact: Artifact,
  parsed: DetailedParsedDiff | undefined,
  classOf: (p: string) => PathClass
): Artifact {
  if (!parsed) return artifact
  const excluded = parsed.files.filter((f) => classOf(f.path) !== "normal")
  const view = viewWithout(artifact.content, excluded, (f) =>
    classOf(f.path) === "report"
      ? `E2E のレポート: ${f.path}`
      : `生成物: ${f.path}(${f.additions.length + f.deletions.length} 行の変更)`
  )
  const testResults = artifact.context.testResults
  return {
    ...artifact,
    content:
      testResults === undefined
        ? view.text
        : `${view.text}\n\n=== testResults(呼び出し側の報告。信頼しない入力で、判定の根拠にしない) ===\n${testResults}`,
    headingLines: [],
    changedPaths: artifact.changedPaths.filter((p) => classOf(p) === "normal")
  }
}

/**
 * crosscheck の事実表。code は Raguel が組んだ diff から作る(所見 A13)。
 * 文書は本文に現れる repoPath 相対のパスの実在を確かめる
 */
function factRows(
  artifact: Artifact,
  parsed: DetailedParsedDiff | undefined,
  classOf: (p: string) => PathClass
): FactRow[] {
  if (parsed) {
    return factRowsFromDiff(
      parsed.files.filter((f) => classOf(f.path) === "normal")
    )
  }
  const found = new Set<string>()
  for (const match of artifact.content.matchAll(
    /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+/g
  )) {
    if (found.size >= MAX_FACT_PATHS) break
    const token = match[0].replace(/[.,;:)]+$/, "")
    if (token.split("/").includes("..")) continue
    found.add(token)
  }
  return [...found].sort().map((p) => ({
    path: p,
    state: fs.existsSync(path.join(artifact.subject.repoPath, p))
      ? "exists"
      : "missing"
  }))
}

/** パネリストの起動の前後で進捗を送る(パネルの各波の開始と終了。§6.8) */
function withProgress(
  providers: Providers,
  progress: EvaluationControl["progress"]
): Providers {
  if (!progress) return providers
  const out: Providers = {}
  for (const [name, provider] of Object.entries(providers) as [
    JudgeProviderName,
    JudgeProvider
  ][]) {
    out[name] = {
      name: provider.name,
      async invoke<T>(call: JudgeCall<T>, ctl: CallControl): Promise<T> {
        progress(`${call.role} を起動した`)
        try {
          return await provider.invoke(call, ctl)
        } finally {
          progress(`${call.role} が終わった`)
        }
      }
    }
  }
  return out
}

// ---- 記録(§6.9) ----

interface Outcome {
  verdict: EvaluationResult["verdict"]
  judgeStatus: EvaluationResult["judgeStatus"]
  degradedReasons: DegradedReason[]
  weight: WeightResult
  ruleFindings: Finding[]
  findings: Finding[]
  reasons: string[]
  decisionPoint?: string
  variance: number | null
  panel?: PanelOutcome
  precedents?: PrecedentMatch[]
  contextRecord: ContextJudgeResult["record"]
  contextSummary: ContextJudgeSummary
}

function reportToMarkdown(report: PanelReport): string {
  return [
    `# ${report.panelist}(model: ${report.model})`,
    "",
    "```json",
    JSON.stringify(
      { findings: report.findings, scores: report.scores },
      null,
      2
    ),
    "```"
  ].join("\n")
}

/** 抜粋と message の秘密情報を伏せる(所見 H1) */
function maskFinding(f: Finding): Finding {
  return {
    ...f,
    message: maskSecrets(f.message),
    ...(f.evidence?.excerpt !== undefined
      ? {
          evidence: { ...f.evidence, excerpt: maskSecrets(f.evidence.excerpt) }
        }
      : {})
  }
}

/** 応答と list_rules の policy(§6.2.5)。protectedPaths は verdict.json には載せない */
export function policyOf(
  config: RaguelConfig,
  configHash: string,
  configSource: string,
  buildVersion: string
): Policy {
  return {
    configHash,
    configSource,
    version: POLICY_VERSION,
    buildVersion,
    protectedPaths: {
      excludedDefaults: ruleParam<string[]>(
        config,
        "code/protected-paths",
        "excludeDefaults"
      ),
      generated: ruleParam<string[]>(
        config,
        "code/protected-paths",
        "generated"
      )
    }
  }
}

/** 応答の所見を severity の重い順に並べ、上限で切る(§6.4.3) */
function capForResponse(findings: Finding[]): {
  findings: Finding[]
  omitted: number
} {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  )
  return {
    findings: sorted.slice(0, MAX_RESPONSE_FINDINGS),
    omitted: Math.max(0, sorted.length - MAX_RESPONSE_FINDINGS)
  }
}

function openAttempt(
  store: CaseStore,
  artifactLike: { runId: string; phase: GatedPhase },
  opened: { current?: Attempt }
): Attempt {
  opened.current ??= store.openAttempt(artifactLike.runId, artifactLike.phase)
  return opened.current
}

function record(
  input: JudgeInput,
  store: CaseStore,
  o: Outcome
): EvaluationResult {
  const { artifact } = input.target
  const { loaded } = input.runtime
  const { dir, attempt } = openAttempt(store, artifact, input.opened)

  store.writeEvidence(dir, "submission.txt", maskSecrets(artifact.content))
  store.writeEvidence(
    dir,
    "00-synthesis.json",
    JSON.stringify(
      {
        objective: artifact.objective,
        reasons: o.reasons,
        decisionPoint: o.decisionPoint ?? null,
        variance: o.variance
      },
      null,
      2
    )
  )
  store.writeEvidence(
    dir,
    "01-rules.json",
    JSON.stringify({ findings: o.ruleFindings.map(maskFinding) }, null, 2)
  )
  store.writeEvidence(dir, "02-weight.json", JSON.stringify(o.weight, null, 2))
  for (const report of o.panel?.reports ?? []) {
    store.writeEvidence(
      dir,
      PANEL_EVIDENCE[report.panelist],
      reportToMarkdown(report)
    )
  }
  if (o.precedents) {
    store.writeEvidence(
      dir,
      "06-precedents.json",
      JSON.stringify(
        o.precedents.map((m) => ({
          id: m.precedent.id,
          source: m.precedent.source,
          outcome: m.precedent.outcome,
          ruling: m.precedent.ruling ?? null,
          recordedAt: m.precedent.recordedAt ?? null,
          score: m.score
        })),
        null,
        2
      )
    )
  }
  if (o.contextRecord) {
    store.writeEvidence(
      dir,
      "07-context.json",
      JSON.stringify(o.contextRecord, null, 2)
    )
  }
  const meta = o.panel?.meta
  if (meta) {
    store.writeEvidence(
      dir,
      "08-meta.md",
      `# meta(model: ${meta.model})\n\n${meta.rationale}\n\n\`\`\`json\n${JSON.stringify(meta.scores, null, 2)}\n\`\`\``
    )
  }
  // 再提出の比較と同じ本文から作る(§6.4.2)。submission.txt は元の本文のまま
  const compared = comparisonContent(artifact, {
    config: loaded.config,
    testsDir: loaded.testsDir,
    priorAttempts: []
  })
  store.writeSubmissionDigest(dir, computeDigest(compared))

  const policy = policyOf(
    loaded.config,
    loaded.configHash,
    loaded.source,
    input.deps.buildVersion
  )
  const findings = o.findings.map(maskFinding)
  const cap = capForResponse(findings)
  const reasons =
    cap.omitted > 0
      ? [
          ...o.reasons,
          `findings-cap: 応答の所見を ${MAX_RESPONSE_FINDINGS} 件に切った(${cap.omitted} 件を省いた。全件は verdict.json にある)`
        ]
      : o.reasons

  return commit(store, dir, {
    evaluationId: input.evaluationId,
    runId: artifact.runId,
    phase: artifact.phase,
    kind: artifact.kind,
    attempt,
    verdict: o.verdict,
    judgeStatus: o.judgeStatus,
    degradedReasons: o.degradedReasons,
    weightTier: o.weight.tier,
    allFindings: findings,
    responseFindings: cap.findings,
    reasons,
    decisionPoint: o.decisionPoint,
    meta: meta ?? null,
    subject: artifact.subject,
    policy,
    contextJudge: o.contextSummary
  })
}

interface CommitInput {
  evaluationId: string
  runId: string
  phase: GatedPhase
  kind: EvaluationResult["kind"]
  attempt: number
  verdict: EvaluationResult["verdict"]
  judgeStatus: EvaluationResult["judgeStatus"]
  degradedReasons: DegradedReason[]
  weightTier: WeightTier
  allFindings: Finding[]
  responseFindings: Finding[]
  reasons: string[]
  decisionPoint?: string
  meta: MetaReport | null
  subject: Subject
  policy: Policy
  contextJudge: ContextJudgeSummary
}

/** verdict.json を確定し、索引に追記し、保持の上限を超えた run を掃除する */
function commit(
  store: CaseStore,
  dir: string,
  c: CommitInput
): EvaluationResult {
  const { protectedPaths: _, ...policyRecord } = c.policy
  const persisted = store.finalizeVerdict(dir, {
    evaluationId: c.evaluationId,
    runId: c.runId,
    phase: c.phase,
    kind: c.kind,
    attempt: c.attempt,
    verdict: c.verdict,
    judgeStatus: c.judgeStatus,
    degradedReasons: c.degradedReasons,
    weightTier: c.weightTier,
    findings: c.allFindings,
    reasons: c.reasons,
    meta: c.meta,
    subject: c.subject,
    policy: policyRecord
  })
  store.appendEvaluationIndex({
    schemaVersion: 2,
    evaluationId: c.evaluationId,
    runId: c.runId,
    phase: c.phase,
    kind: c.kind,
    attempt: c.attempt,
    casePath: dir,
    verdict: c.verdict,
    judgeStatus: c.judgeStatus,
    head: c.subject.head,
    at: persisted.at
  })
  try {
    store.sweepRetention()
  } catch (err) {
    log.warn("保持の上限の掃除に失敗した", {
      error: err instanceof Error ? err.message : String(err)
    })
  }
  return {
    evaluationId: c.evaluationId,
    runId: c.runId,
    phase: c.phase,
    kind: c.kind,
    attempt: c.attempt,
    verdict: c.verdict,
    judgeStatus: c.judgeStatus,
    degradedReasons: c.degradedReasons,
    weightTier: c.weightTier,
    findings: c.responseFindings,
    reasons: c.reasons,
    ...(c.decisionPoint ? { decisionPoint: c.decisionPoint } : {}),
    subject: c.subject,
    ...(c.meta ? { meta: c.meta } : {}),
    casePath: dir,
    policy: c.policy,
    contextJudge: c.contextJudge
  }
}

/**
 * 設定の読み込みの失敗と内部エラーの記録(§6.2.6・§6.3、所見 D3)。
 * 一意の evaluationId で ASK・degraded を書く。設定が読めないときは内蔵の既定の置き場に書く
 */
function recordDegraded(args: {
  evaluationId: string
  req: EvaluationRequest
  deps: PipelineDeps
  runtime: Runtime | null
  target: Target | undefined
  reason: DegradedReason
  finding: Finding
  configSource: string
  opened: { current?: Attempt }
}): EvaluationResult {
  const { req, runtime, target } = args
  const config = runtime?.loaded.config ?? defaultConfig
  const store = new CaseStore(config, args.deps.projectRoot)
  const kind = (findPhase(req.phase) as { kind: Artifact["kind"] }).kind
  const { dir, attempt } = openAttempt(store, req, args.opened)
  const finding = maskFinding(args.finding)
  const reasons = [`degraded: ${finding.message}`]
  const decisionPoint = `判定の基盤に障害があり(${args.reason.source})審査が欠けているので、人が成果物を確かめて進めるか、原因を直して再評価するかを判断する。`
  if (target) {
    store.writeEvidence(
      dir,
      "submission.txt",
      maskSecrets(target.artifact.content)
    )
  }
  store.writeEvidence(
    dir,
    "00-synthesis.json",
    JSON.stringify(
      { objective: req.objective, reasons, decisionPoint, variance: null },
      null,
      2
    )
  )
  return commit(store, dir, {
    evaluationId: args.evaluationId,
    runId: req.runId,
    phase: req.phase,
    kind,
    attempt,
    verdict: "ASK",
    judgeStatus: "degraded",
    degradedReasons: [args.reason],
    weightTier: "standard",
    allFindings: [finding],
    responseFindings: [finding],
    reasons,
    decisionPoint,
    meta: null,
    subject: target?.artifact.subject ?? {
      repoPath: req.repoPath ?? args.deps.projectRoot,
      head: null,
      files: []
    },
    policy: runtime
      ? policyOf(
          config,
          runtime.loaded.configHash,
          runtime.loaded.source,
          args.deps.buildVersion
        )
      : {
          configHash: "",
          configSource: args.configSource,
          version: POLICY_VERSION,
          buildVersion: args.deps.buildVersion,
          protectedPaths: { excludedDefaults: [], generated: [] }
        },
    contextJudge: {
      enabled: config.contextJudge.enabled,
      status: config.contextJudge.enabled ? "skipped" : "off",
      adjustments: []
    }
  })
}
