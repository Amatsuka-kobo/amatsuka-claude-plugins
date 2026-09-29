/**
 * Raguel の共有語彙。全モジュール(config / rules / casefile / precedent / panel / core)が
 * このファイルの型を介して会話する。形は設計書(harness-docs/design/2026-09-28-raguel-redesign-design.md)の
 * §6.2.5・§6.9.2・§6.9.4・§6.12 に従う。
 * Subject の型の正本は subject/types.ts で、ここでは re-export だけを行う。
 */

import type { Digest } from "../casefile/digest.js"
import type { GatedPhase } from "../codiel/phases.js"
import type {
  Adjustment,
  ContextJudgeSettings,
  ContextJudgeStatus
} from "../context/judge.js"
import type { Subject } from "../subject/types.js"

export type { GatedPhase } from "../codiel/phases.js"
export type { Subject, SubjectFile } from "../subject/types.js"

export type Verdict = "PROCEED" | "ASK" | "STOP"

/** ルールとパネルの所見が判定へ与える効果 */
export type Severity = "info" | "ask" | "stop"

/** タスクの重さ(§6.5)。パネルの構成の選択に使う */
export type WeightTier = "trivial" | "standard" | "critical"

export type ArtifactKind = "decision" | "plan" | "design" | "code"

/** 基盤の障害があれば degraded(§6.8) */
export type JudgeStatus = "ok" | "degraded"

/** パネリスト(§6.6.1)。meta はパネリストに数えない */
export type PanelistName = "adversarial" | "steelman" | "crosscheck"

/** 設定の `panel.perPanelist` のキー(§6.7.1) */
export type PanelRole = PanelistName | "meta"

/** 設定の `judge.provider` に置ける値。`none` は `judge.provider` だけに置ける */
export type JudgeProviderName = "claude" | "codex" | "none"

export interface Finding {
  /** 例: "code/protected-paths", "panel/adversarial" */
  ruleId: string
  severity: Severity
  /** パネルの所見だけ 0–100 */
  confidence?: number
  /** 人が読める発火の理由 */
  message: string
  evidence?: {
    /** ファイルパス・行番号・セクション名など、表示用の位置 */
    location?: string
    /** 該当箇所の抜粋。injection の踏み台にならないよう MAX_EXCERPT_LENGTH で切る */
    excerpt?: string
    /** ルールとファイルの組ごとの集約(§6.4.3)と Jev の候補に使うファイルのパス */
    path?: string
    /** Artifact.content の 1 始まりの行番号 */
    line?: number
  }
}

/** 証拠として引用できる抜粋の最大長 */
export const MAX_EXCERPT_LENGTH = 300

export interface PanelReport {
  panelist: PanelistName
  model: string
  findings: Finding[]
  /** ルーブリックの軸ごとの 0–100。100 は問題が無いこと */
  scores: Record<string, number>
}

export interface MetaReport {
  model: string
  scores: Record<string, number>
  /** 根拠の文。人と次フェーズの AI のためのもので、合成の入力にしない */
  rationale: string
}

/** degraded の原因 1 件。source はパネリスト名か meta、それ以外は kernel・config など */
export interface DegradedReason {
  source: string
  /** 例: "timeout"・"nonzero-exit"・"unavailable"・"deadline"・"internal-error"・"config-error" */
  reason: string
}

/** verdict.json に載せる policy(§6.9.2) */
export interface PolicyRecord {
  configHash: string
  /** `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults`(§6.2.5) */
  configSource: string
  version: 2
  /** raguel-mcp の package.json の version */
  buildVersion: string
}

/** 応答に載せる policy(§6.2.5)。verdict.json の policy に保護パスの除外と生成物を足したもの */
export interface Policy extends PolicyRecord {
  protectedPaths: { excludedDefaults: string[]; generated: string[] }
}

export interface ContextJudgeSummary {
  enabled: boolean
  status: ContextJudgeStatus
  adjustments: Adjustment[]
}

/** evaluate_* の応答(§6.2.5) */
export interface EvaluationResult {
  /** 内部エラーも含め、常に UUID */
  evaluationId: string
  /** codiel の raguelRunId */
  runId: string
  phase: GatedPhase
  kind: ArtifactKind
  /** run とフェーズの組ごとの番号 */
  attempt: number
  verdict: Verdict
  judgeStatus: JudgeStatus
  /** judgeStatus が degraded のときだけ中身がある */
  degradedReasons: DegradedReason[]
  weightTier: WeightTier
  /** 上限付き(§6.4.3) */
  findings: Finding[]
  reasons: string[]
  /** ASK と STOP のとき、人が判断することを 1 文で */
  decisionPoint?: string
  subject: Subject
  /** meta を起動したときだけ */
  meta?: MetaReport
  /** ケースファイルの attempt のディレクトリ */
  casePath: string
  policy: Policy
  contextJudge: ContextJudgeSummary
}

/** 4 つの evaluate ツールの入力と評価対象を正規化した検査対象 */
export interface Artifact {
  kind: ArtifactKind
  phase: GatedPhase
  runId: string
  /** この成果物が何のためのものか */
  objective: string
  /**
   * 検査の本文。code は Raguel が組んだ unified diff、plan と design はファイルごとの見出し行でつないだ本文、
   * decision は decision・optionsConsidered・rollbackPlan を見出し行でつないだ本文
   */
  content: string
  /**
   * ルール層の検査から外す行。content を "\n" で分けたときの 0 始まりの行番号。
   * code は diff のファイル見出し、ほかは見出し行
   */
  headingLines: number[]
  subject: Subject
  /** code: diff に現れたパス(repoPath 相対)。ほかの kind は空の配列 */
  changedPaths: string[]
  /** kind に固有の補助入力 */
  context: {
    optionsConsidered?: string[]
    rollbackPlan?: string
    /** evaluate_code の testResults。信頼しない入力で、判定の根拠にしない */
    testResults?: string
  }
}

/** 同じ run・同じフェーズの過去の attempt(common/resubmission-loop の比較の相手の候補) */
export interface PriorAttempt {
  attempt: number
  verdict: Verdict
  judgeStatus: JudgeStatus
  /** 裁定の記録(outcomes.jsonl)を持つか */
  hasRuling: boolean
  /** その attempt のルール層の ask 以上の所見の ruleId */
  askRuleIds: string[]
  /** submission-digest.json。読めなければ null */
  digest: Digest | null
}

export interface RuleContext {
  config: RaguelConfig
  /** プロジェクトルートの .codiel/config.json の testsDir(正規化済み。config/paths.ts) */
  testsDir: string
  /** 同じ run・同じフェーズの過去の attempt。パイプラインがケースファイルから渡す */
  priorAttempts: PriorAttempt[]
}

export interface Rule {
  id: string
  appliesTo: ArtifactKind[] | "all"
  /** sealed ルールは設定で無効にできず、severity を既定より軽くできない */
  sealed: boolean
  defaultSeverity: Severity
  check(artifact: Artifact, ctx: RuleContext): Finding[]
}

export interface WeightResult {
  tier: WeightTier
  score: number
  /** 点数の内訳(証拠ファイルに残す) */
  factors: Record<string, number>
  /** 当てた下限(例: "rule-ask-floor:standard") */
  floors: string[]
}

// ---- diff の解析(実装は rules/code/diffParse.ts) ----

export interface DiffFile {
  /** a/・b/ を除いた repoPath 相対のパス(引用符と 8 進エスケープは復号済み) */
  path: string
  oldPath?: string
  /** 追加行(先頭の "+" を除いた内容) */
  additions: string[]
  /** 削除行(先頭の "-" を除いた内容) */
  deletions: string[]
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  isBinary: boolean
}

export interface ParsedDiff {
  files: DiffFile[]
  totalChangedLines: number
  /** 解釈できなかったファイル見出しの行。空でなければ rule-error(ask)にする */
  malformedHeaders: string[]
}

// ---- 評価の索引・裁定の記録・verdict.json(§6.9.2・§6.9.4) ----

export type OutcomeLabel = "approved" | "rejected" | "incident"

/** フェーズのゲートでの人の裁定(§6.2.7) */
export type Ruling = "as-is" | "false-positive" | "revise"

/** evaluations.jsonl の 1 行 */
export interface EvaluationIndexEntry {
  schemaVersion: 2
  evaluationId: string
  runId: string
  phase: GatedPhase
  kind: ArtifactKind
  attempt: number
  casePath: string
  verdict: Verdict
  judgeStatus: JudgeStatus
  head: string | null
  at: string
}

/** outcomes.jsonl の 1 行。同じ evaluationId の行が複数あれば後の行を正とする */
export interface OutcomeRecord {
  schemaVersion: 2
  evaluationId: string
  runId: string
  phase: GatedPhase
  outcome: OutcomeLabel
  ruling: Ruling | null
  notes?: string
  precedentId: string | null
  at: string
}

/** verdict.json */
export interface VerdictRecord {
  schemaVersion: 2
  evaluationId: string
  runId: string
  phase: GatedPhase
  kind: ArtifactKind
  attempt: number
  verdict: Verdict
  judgeStatus: JudgeStatus
  degradedReasons: DegradedReason[]
  weightTier: WeightTier
  findings: Finding[]
  reasons: string[]
  meta: MetaReport | null
  subject: Subject
  policy: PolicyRecord
  /** ISO 8601 */
  at: string
  /** 同じ run・同じフェーズの 1 つ前の attempt の chainHead */
  prevChainHead: string | null
  /** 既知の証拠ファイル(verdict.json を除く) */
  evidence: { name: string; sha256: string }[]
  chainHead: string
}

// ---- 判例(§6.11) ----

export interface Precedent {
  id: string
  source: "seed" | "project"
  kind: ArtifactKind
  /** プロジェクトの判例だけ持つ */
  phase?: GatedPhase
  outcome: OutcomeLabel
  /** run 全体の結末なら null */
  ruling?: Ruling | null
  /** 何が起きたかの要約(BM25 の検索の本文の一部) */
  summary: string
  objective?: string
  /** 発火したルール ID。panel/*-error・kernel/*・rule-error は含めない */
  firedRules: string[]
  changedPaths: string[]
  /** 参考入力として adversarial と meta に渡す教訓 */
  lesson: string
  recordedAt?: string
  configHash?: string
}

// ---- 設定(§6.12)。zod のスキーマ(config/schema.ts)はこの型と一致させる ----

export interface RuleSettings {
  enabled?: boolean
  severity?: Severity
  /** ルールごとのパラメータ。名前と型は rules/params.ts の表が決める */
  [param: string]: unknown
}

export interface PanelistSettings {
  provider?: "claude" | "codex"
  model?: string
}

export interface RaguelConfig {
  version: 1
  /** 判定不能のときの verdict。受け付けるのは ASK だけ(§6.4.1) */
  onError: "ASK"
  storage: {
    /** ケースファイルと判例の置き場(作業ツリーの外)。loader が ~ を展開した絶対パスにする */
    casesDir: string
    /** 省略時は git の共通ディレクトリから作る(project/root.ts) */
    projectId?: string
    retention: { maxRuns: number; maxDays: number }
  }
  judge: {
    provider: JudgeProviderName
    /** 省略時はプロバイダーごとの既定(config/defaults.ts の resolvePanelist) */
    model?: string
    /** 1 回の呼び出しの時間の上限 */
    timeoutMs: number
    /** ゲート全体の締切 */
    deadlineMs: number
    /** パネリストを同時に起動する数の上限 */
    maxConcurrency: number
    thresholds: {
      /** critical で meta の全軸がこれ以上なら PROCEED */
      proceed: number
      /** パネルの所見を採用する最低の confidence */
      confidence: number
      /** critical で同じ立場のパネリストのスコアの差がこれを超えたら ASK */
      maxVariance: number
    }
  }
  weight: {
    tiers: { standard: number; critical: number }
  }
  panel: {
    perPanelist: Partial<Record<PanelRole, PanelistSettings>>
  }
  /** Jev の文脈判定(§6.4.4)。形は context/judge.ts の ContextJudgeSettings */
  contextJudge: ContextJudgeSettings
  precedent: {
    seedCatalog: boolean
    topN: number
  }
  rules: Record<string, RuleSettings>
}

/** 検証済みの設定と、再現のためのメタデータ。loader が返す */
export interface LoadedConfig {
  config: RaguelConfig
  /** config をキーの順に正規化した JSON の sha256 */
  configHash: string
  /** 設定の出所(`env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults`) */
  source: string
  /** 設定を探したプロジェクトルート(project/root.ts の resolveProjectRoot) */
  projectRoot: string
  /** プロジェクトルートの .codiel/config.json の testsDir(正規化済み) */
  testsDir: string
}

/**
 * 設定の読み込みの結果(§6.12.4)。壊れた設定でもサーバーを起動し、
 * 評価は ASK・degraded、list_rules は理由を返すために使う
 */
export type ConfigLoadResult =
  | { ok: true; loaded: LoadedConfig }
  | {
      ok: false
      /** 読み込みの失敗の理由 */
      error: string
      /** 読もうとしたファイル(RAGUEL_CONFIG のパスかプロジェクトルートの config.json) */
      path: string
      /** configCandidate の source */
      source: string
    }
