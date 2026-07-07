/**
 * 判定パイプライン(DESIGN.md §3)。
 * [1] 入力検証(tools 層で実施済み)→ [2] ルールパス → [3] 重さ判定 →
 * [4] パネル → [5] meta → [6] 合成 → [7] ケースファイル永続化。
 */

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import path from "node:path"
import type { CaseStore } from "../casefile/store.js"
import type { JudgeProvider } from "../panel/provider.js"
import { runMeta, runPanel, type SteelmanVerdicts } from "../panel/runner.js"
import { searchPrecedents } from "../precedent/retrieval.js"
import { loadCorpus } from "../precedent/store.js"
import { computeSubmissionDigest } from "../rules/common/resubmissionLoop.js"
import { runRules } from "../rules/registry.js"
import { log } from "./log.js"
import type {
  Artifact,
  ArtifactKind,
  EvaluationResult,
  Finding,
  MetaReport,
  PanelReport,
  RaguelConfig,
  WeightTier
} from "./types.js"
import { synthesize } from "./verdict.js"
import { computeWeight } from "./weight.js"

export interface PipelineDeps {
  config: RaguelConfig
  configHash: string
  caseStore: CaseStore
  provider: JudgeProvider
}

const POLICY_VERSION = 1

/** フェーズの想定順序。crosscheck が参照する「前フェーズ」の解決に使う */
const PHASE_ORDER: ArtifactKind[] = ["decision", "plan", "design", "code"]

/** meta へ渡す証拠 1 ファイルあたりの最大文字数 */
const EVIDENCE_BUNDLE_LIMIT = 6000

/** crosscheck へ渡す前フェーズ証拠の最大文字数 */
const PRIOR_EVIDENCE_LIMIT = 4000

const PANEL_EVIDENCE_FILES: Record<string, string> = {
  adversarial: "03-adversarial.md",
  steelman: "04-steelman.md",
  crosscheck: "05-crosscheck.md",
  assumption: "06-assumption.md",
  precedent: "07-precedent.md"
}

function cap(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n…(${text.length - limit} 文字省略)`
}

/** パネル所見レポートを「構造化 JSON + 人間可読」の md にする */
function reportToMarkdown(report: PanelReport): string {
  const lines = [
    `# ${report.panelist}(model: ${report.model})`,
    "",
    "```json",
    JSON.stringify(
      { findings: report.findings, scores: report.scores },
      null,
      2
    ),
    "```"
  ]
  return lines.join("\n")
}

/**
 * 成果物中のパス様文字列を抽出し、実在確認の事実表を作る(決定論)。
 * crosscheck パネリストはツールを持たないため、kernel 側で事実を供給する。
 */
export function buildFactTable(artifact: Artifact): string {
  const pattern = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+/g
  const candidates = new Set<string>()
  for (const match of artifact.content.matchAll(pattern)) {
    if (candidates.size >= 30) break
    const token = match[0].replace(/[.,;:)]+$/, "")
    if (token.includes("//")) continue // URL は除外
    candidates.add(token)
  }
  for (const p of artifact.changedPaths) candidates.add(p)
  if (candidates.size === 0) return "(参照パスなし)"
  const rows = [...candidates]
    .sort()
    .map((p) => `${p}: ${existsSync(path.resolve(p)) ? "実在" : "不在"}`)
  return rows.join("\n")
}

/**
 * 前フェーズ(承認済み)の証拠を集める。読込前にハッシュチェーンを検証し、
 * 改竄検知時は即 STOP のための finding を返す(不変条件 6)。
 */
function collectPriorEvidence(
  artifact: Artifact,
  caseStore: CaseStore
): { priorEvidence?: string; tampered: Finding[] } {
  const currentIndex = PHASE_ORDER.indexOf(artifact.kind)
  const chunks: string[] = []
  const tampered: Finding[] = []
  for (const kind of PHASE_ORDER.slice(0, currentIndex)) {
    const dir = caseStore.latestAttemptDir(artifact.runId, kind)
    if (!dir) continue
    const verdict = caseStore.readVerdict(dir)
    if (!verdict) continue
    const check = caseStore.verifyAttempt(dir)
    if (!check.ok) {
      tampered.push({
        ruleId: "casefile/tampered",
        severity: "stop",
        message: `前フェーズ(${kind})のケースファイルが改竄されています: ${check.mismatches.join("; ")}`,
        evidence: { location: dir }
      })
      continue
    }
    if (verdict.verdict !== "PROCEED") continue
    const meta = caseStore
      .readEvidenceTexts(dir)
      .find((e) => e.name === "08-meta.md")
    chunks.push(
      [
        `## 前フェーズ ${kind}(attempt ${verdict.attempt}, verdict ${verdict.verdict})`,
        `findings: ${JSON.stringify(verdict.findings.map((f) => f.ruleId))}`,
        meta ? cap(meta.content, PRIOR_EVIDENCE_LIMIT) : "(meta 証拠なし)"
      ].join("\n")
    )
  }
  return {
    priorEvidence: chunks.length > 0 ? chunks.join("\n\n") : undefined,
    tampered
  }
}

function panelistsForTier(
  tier: WeightTier,
  config: RaguelConfig
): RaguelConfig["panel"]["standard"] {
  return config.panel[tier]
}

export async function evaluateArtifact(
  artifact: Artifact,
  deps: PipelineDeps
): Promise<EvaluationResult> {
  const { config, configHash, caseStore, provider } = deps
  const evaluationId = randomUUID()

  // [2] 決定論的ルールパス(再提出ループ検知の履歴供給を含む)
  const priorSubmissions = caseStore.readPriorSubmissions(
    artifact.runId,
    artifact.kind
  )
  // 前フェーズ証拠の改竄検知(不変条件 6: 不一致は即 STOP)
  const { priorEvidence, tampered } = collectPriorEvidence(artifact, caseStore)
  const ruleFindings = [
    ...tampered,
    ...runRules(artifact, { config, priorSubmissions })
  ]
  const ruleStop = ruleFindings.some((f) => f.severity === "stop")

  // [3] 重さ判定(昇格のみ)
  const weight = computeWeight(artifact, ruleFindings, config)

  // ケースファイルを開いて決定論層の証拠を書く
  const { dir, attempt } = caseStore.openAttempt(artifact.runId, artifact.kind)
  caseStore.writeEvidence(
    dir,
    "01-rules.json",
    JSON.stringify({ findings: ruleFindings }, null, 2)
  )
  caseStore.writeEvidence(
    dir,
    "02-weight.json",
    JSON.stringify(weight, null, 2)
  )

  // [4][5] パネル + meta(STOP 即決・trivial・provider none ではスキップ)
  const panelists = panelistsForTier(weight.tier, config)
  const needPanel = !ruleStop && panelists.length > 0
  const panelUnavailable = needPanel && config.judge.provider === "none"

  let reports: PanelReport[] = []
  let steelmanVerdicts: SteelmanVerdicts | undefined
  let panelErrorFindings: Finding[] = []
  let meta: MetaReport | undefined
  let metaFailed = false
  let panelRan = false

  if (needPanel && !panelUnavailable) {
    panelRan = true
    // 判例の決定論検索(§9)
    const corpus = loadCorpus(config)
    const precedents = searchPrecedents(
      {
        kind: artifact.kind,
        objective: artifact.objective,
        summaryText: artifact.content,
        firedRules: ruleFindings.map((f) => f.ruleId),
        changedPaths: artifact.changedPaths
      },
      corpus,
      config.precedent.topN
    ).map((m) => m.precedent)

    const outcome = await runPanel(
      {
        artifact,
        ruleFindings,
        panelists,
        precedents,
        priorEvidence,
        factTable: buildFactTable(artifact)
      },
      provider,
      config
    )
    reports = outcome.reports
    steelmanVerdicts = outcome.steelmanVerdicts
    panelErrorFindings = outcome.errorFindings

    for (const report of outcome.reports) {
      const name = PANEL_EVIDENCE_FILES[report.panelist]
      if (name) caseStore.writeEvidence(dir, name, reportToMarkdown(report))
    }

    // meta(裁判官): 入力はケースファイルの証拠のみ(不変条件 4)
    const bundle = caseStore
      .readEvidenceTexts(dir)
      .map((e) => `### ${e.name}\n${cap(e.content, EVIDENCE_BUNDLE_LIMIT)}`)
      .join("\n\n")
    try {
      meta = await runMeta(bundle, artifact.kind, provider, config)
      caseStore.writeEvidence(
        dir,
        "08-meta.md",
        `# meta(model: ${meta.model})\n\n${meta.rationale}\n\n\`\`\`json\n${JSON.stringify(meta.scores, null, 2)}\n\`\`\``
      )
    } catch (err) {
      metaFailed = true
      log.warn("meta 評価に失敗しました(フェイルクローズド)", {
        error: err instanceof Error ? err.message : String(err)
      })
      panelErrorFindings = [
        ...panelErrorFindings,
        {
          ruleId: "panel/meta-error",
          severity: "ask",
          message: "meta 評価に失敗したためフェイルクローズドで扱います"
        }
      ]
    }
  }

  // [6] 合成(§2)
  const synthesis = synthesize({
    weightTier: weight.tier,
    ruleFindings,
    panelRan,
    panelReports: reports,
    steelmanVerdicts,
    panelErrorFindings,
    meta,
    panelUnavailable,
    config
  })
  let verdict = synthesis.verdict

  // onError: STOP 設定時は、フェイルクローズド経路の ASK を STOP へ引き上げる
  const hadError =
    panelUnavailable || metaFailed || panelErrorFindings.length > 0
  if (config.onError === "STOP" && hadError && verdict === "ASK") {
    verdict = "STOP"
    synthesis.reasons.push("on-error-stop: onError=STOP によりエラー時 STOP")
  }

  // [7] 永続化: 再提出ダイジェスト → verdict.json(ハッシュチェーン)→ インデックス
  caseStore.writeSubmissionDigest(
    dir,
    computeSubmissionDigest(artifact.content, attempt, verdict)
  )
  caseStore.writeEvidence(
    dir,
    "00-synthesis.json",
    JSON.stringify({ reasons: synthesis.reasons }, null, 2)
  )
  const at = new Date().toISOString()
  caseStore.finalizeVerdict(dir, {
    evaluationId,
    runId: artifact.runId,
    kind: artifact.kind,
    attempt,
    verdict,
    weightTier: weight.tier,
    findings: synthesis.findings,
    meta,
    policy: { configHash, version: POLICY_VERSION },
    at,
    objective: artifact.objective,
    changedPaths: artifact.changedPaths
  })
  caseStore.appendEvaluationIndex({
    evaluationId,
    runId: artifact.runId,
    kind: artifact.kind,
    attempt,
    casePath: dir,
    verdict,
    at
  })
  try {
    caseStore.sweepRetention()
  } catch (err) {
    log.warn("retention 掃除に失敗しました", {
      error: err instanceof Error ? err.message : String(err)
    })
  }

  return {
    evaluationId,
    runId: artifact.runId,
    verdict,
    weightTier: weight.tier,
    findings: synthesis.findings,
    meta,
    casePath: dir,
    policy: { configHash, version: POLICY_VERSION }
  }
}
