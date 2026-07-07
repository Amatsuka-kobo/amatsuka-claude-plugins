/**
 * LLM 判定パネルのオーケストレーション(docs/DESIGN.md §3 [4][5]、§7)。
 * wave 1 = adversarial / crosscheck / assumption / precedent を並列実行、
 * wave 2 = steelman(adversarial が成功した場合のみ、adversarial の findings を入力に)。
 * 失敗したパネリストはフェイルクローズドで panel/<名前>-error の finding に変換する。
 */

import type {
  Artifact,
  ArtifactKind,
  Finding,
  MetaReport,
  PanelistName,
  PanelReport,
  Precedent,
  RaguelConfig
} from "../core/types.js"
import { runAdversarial } from "./panelists/adversarial.js"
import { runAssumption } from "./panelists/assumption.js"
import { runCrosscheck } from "./panelists/crosscheck.js"
import { runMetaPanelist } from "./panelists/meta.js"
import { runPrecedent } from "./panelists/precedent.js"
import type { SteelmanVerdicts } from "./panelists/steelman.js"
import { runSteelman } from "./panelists/steelman.js"
import { JudgeError, type JudgeProvider } from "./provider.js"

export type { SteelmanVerdicts } from "./panelists/steelman.js"

/** wave 1 で並列実行できるパネリスト(steelman は wave 2 専用) */
type Wave1Panelist = Exclude<PanelistName, "steelman">

export interface PanelInput {
  artifact: Artifact
  ruleFindings: Finding[]
  /** ティアで決まったパネル構成 */
  panelists: PanelistName[]
  /** 検索済み判例(空可)。空の場合 precedent パネリストは実施しない */
  precedents: Precedent[]
  /** 前フェーズ承認済み証拠(crosscheck 用) */
  priorEvidence?: string
  /** crosscheck 用の決定論的事実表 */
  factTable?: string
}

export interface PanelOutcome {
  reports: PanelReport[]
  steelmanVerdicts?: SteelmanVerdicts
  /** 失敗パネリストのフェイルクローズド所見 */
  errorFindings: Finding[]
}

function resolveModel(
  name: PanelistName | "meta",
  config: RaguelConfig
): string {
  return config.panel.perPanelist[name]?.model ?? config.judge.model
}

function toErrorFinding(name: PanelistName, err: unknown): Finding {
  const detail =
    err instanceof JudgeError
      ? `${err.reason}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err)
  return {
    ruleId: `panel/${name}-error`,
    severity: "ask",
    message: `パネリスト ${name} の実行に失敗しました(フェイルクローズド): ${detail}`
  }
}

async function runWave1Panelist(
  name: Wave1Panelist,
  input: PanelInput,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<PanelReport> {
  switch (name) {
    case "adversarial":
      return runAdversarial(
        { artifact: input.artifact, ruleFindings: input.ruleFindings },
        provider,
        model,
        timeoutMs
      )
    case "crosscheck":
      return runCrosscheck(
        {
          artifact: input.artifact,
          priorEvidence: input.priorEvidence,
          factTable: input.factTable
        },
        provider,
        model,
        timeoutMs
      )
    case "assumption":
      return runAssumption(
        { artifact: input.artifact },
        provider,
        model,
        timeoutMs
      )
    case "precedent":
      return runPrecedent(
        { artifact: input.artifact, precedents: input.precedents },
        provider,
        model,
        timeoutMs
      )
  }
}

export async function runPanel(
  input: PanelInput,
  provider: JudgeProvider,
  config: RaguelConfig
): Promise<PanelOutcome> {
  const timeoutMs = config.judge.timeoutMs

  // precedents が空なら precedent はエラーではなく単に不実施(§7)
  const wave1Names = input.panelists.filter(
    (name): name is Wave1Panelist =>
      name !== "steelman" &&
      (name !== "precedent" || input.precedents.length > 0)
  )

  const wave1Entries = wave1Names.map((name) => ({
    name,
    promise: runWave1Panelist(
      name,
      input,
      provider,
      resolveModel(name, config),
      timeoutMs
    )
  }))

  const wave1Settled = await Promise.allSettled(
    wave1Entries.map((entry) => entry.promise)
  )

  const reports: PanelReport[] = []
  const errorFindings: Finding[] = []
  let adversarialFindings: Finding[] | undefined

  wave1Settled.forEach((result, i) => {
    const name = wave1Entries[i].name
    if (result.status === "fulfilled") {
      reports.push(result.value)
      if (name === "adversarial") adversarialFindings = result.value.findings
    } else {
      errorFindings.push(toErrorFinding(name, result.reason))
    }
  })

  // wave 2: steelman は adversarial が構成に含まれ、かつ成功した場合のみ(不変条件1)
  let steelmanVerdicts: SteelmanVerdicts | undefined
  if (
    input.panelists.includes("steelman") &&
    adversarialFindings !== undefined
  ) {
    try {
      const outcome = await runSteelman(
        { artifact: input.artifact, adversarialFindings },
        provider,
        resolveModel("steelman", config),
        timeoutMs
      )
      reports.push(outcome.report)
      steelmanVerdicts = outcome.verdicts
    } catch (err) {
      errorFindings.push(toErrorFinding("steelman", err))
    }
  }

  return { reports, steelmanVerdicts, errorFindings }
}

/**
 * meta 評価(裁判官)。独立した fresh な呼び出しとして実行する。
 * 失敗は throw する(呼び出し側が onError 処理を行う、§7)。
 */
export async function runMeta(
  evidenceBundle: string,
  kind: ArtifactKind,
  provider: JudgeProvider,
  config: RaguelConfig
): Promise<MetaReport> {
  return runMetaPanelist(
    evidenceBundle,
    kind,
    provider,
    resolveModel("meta", config),
    config.judge.timeoutMs
  )
}
