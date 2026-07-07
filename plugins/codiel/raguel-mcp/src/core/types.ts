/**
 * Raguel の共有語彙。全モジュール(config / rules / casefile / precedent / panel / core)が
 * このファイルの型だけを介して会話する。docs/DESIGN.md §2 が原典。
 */

export type Verdict = "PROCEED" | "ASK" | "STOP"

/** ルール/パネル所見が判定へ与える効果 */
export type Severity = "info" | "ask" | "stop"

/** タスクの重さ(§6)。パネル構成の選択に使う */
export type WeightTier = "trivial" | "standard" | "critical"

export type ArtifactKind = "decision" | "plan" | "design" | "code"

export type PanelistName =
  | "adversarial"
  | "steelman"
  | "crosscheck"
  | "assumption"
  | "precedent"

export interface Finding {
  /** 例: "code/protected-paths", "panel/adversarial" */
  ruleId: string
  severity: Severity
  /** パネル所見のみ 0–100 */
  confidence?: number
  /** 人間可読な発火理由 */
  message: string
  evidence?: {
    /** ファイルパス・行番号・セクション名など */
    location?: string
    /** 該当箇所の抜粋。injection の踏み台防止のため MAX_EXCERPT_LENGTH で切る */
    excerpt?: string
  }
}

/** 証拠として引用できる抜粋の最大長(§7 インジェクション対策) */
export const MAX_EXCERPT_LENGTH = 300

export interface PanelReport {
  panelist: PanelistName
  model: string
  findings: Finding[]
  /** ルーブリック軸ごとの 0–100 */
  scores: Record<string, number>
}

export interface MetaReport {
  model: string
  scores: Record<string, number>
  /** 最終根拠文。人間と次フェーズ AI のためのもので、合成関数の入力にはしない(不変条件 7) */
  rationale: string
}

export interface EvaluationResult {
  evaluationId: string
  /** Codiel のタスク実行 ID。ケースファイルのキー(§8) */
  runId: string
  verdict: Verdict
  weightTier: WeightTier
  /** ルール + パネル所見(合成後に生き残ったもの) */
  findings: Finding[]
  /** meta 評価を実施した場合のみ */
  meta?: MetaReport
  /** 証拠ディレクトリへのパス(証拠全文はツール応答に含めない) */
  casePath: string
  policy: {
    configHash: string
    version: number
  }
}

/** 4 つの evaluate ツール入力を正規化した検査対象 */
export interface Artifact {
  kind: ArtifactKind
  runId: string
  /** この成果物が何のためのものか(全ツール必須) */
  objective: string
  /** 検査対象の本文。code は unified diff 全文、それ以外は成果物テキスト */
  content: string
  /** code: 変更対象ファイルパス(diff / files[] から抽出)。他 kind は空配列 */
  changedPaths: string[]
  /** plan: steps 配列で渡された場合のステップ。他は空配列 */
  steps: string[]
  /** kind 固有の補助入力 */
  context: {
    constraints?: string[]
    requirements?: string[]
    optionsConsidered?: string[]
    rollbackPlan?: string
    testResults?: string
  }
}

/** 再提出ループ検知(common/resubmission-loop)用の過去提出ダイジェスト */
export interface SubmissionDigest {
  attempt: number
  verdict: Verdict
  /** 正規化(空白圧縮・小文字化)後の sha256 */
  sha256: string
  /** 正規化後テキストの文字 5-gram ハッシュ集合(Jaccard 類似度用) */
  shingleHashes: number[]
}

export interface RuleContext {
  config: RaguelConfig
  /** 同一 runId + kind の過去提出。pipeline が casefile store から供給する */
  priorSubmissions: SubmissionDigest[]
}

export interface Rule {
  id: string
  appliesTo: ArtifactKind[] | "all"
  /** sealed ルールは設定で無効化できない(§10 不変条件 3) */
  sealed: boolean
  defaultSeverity: Severity
  check(artifact: Artifact, ctx: RuleContext): Finding[]
}

export interface WeightResult {
  tier: WeightTier
  score: number
  /** スコアの内訳(説明可能性のため証拠ファイルに残す) */
  factors: Record<string, number>
  /** 昇格のみ原則で適用された床(例: "rule-ask-floor:standard") */
  floors: string[]
}

// ---- 判例ストア(§9) ----

export type OutcomeLabel = "approved" | "rejected" | "incident"

export interface Precedent {
  id: string
  source: "seed" | "project"
  kind: ArtifactKind
  outcome: OutcomeLabel
  /** 何が起きたかの要約(BM25 検索コーパスの一部) */
  summary: string
  objective?: string
  /** 発火ルール ID の指紋 */
  firedRules: string[]
  changedPaths: string[]
  /** precedent パネリストが「本件に当てはまるか」を評価するための教訓 */
  lesson: string
  /** 賞味期限判断用(シードは省略可) */
  recordedAt?: string
  configHash?: string
}

// ---- 設定(§11)。zod スキーマ(config/schema.ts)はこの型と一致させる ----

export interface RuleSettings {
  enabled?: boolean
  severity?: Severity
  [param: string]: unknown
}

export interface PanelistSettings {
  model?: string
}

export interface RaguelConfig {
  version: number
  /** 判定不能時の verdict。PROCEED は型レベルで排除(不変条件 8) */
  onError: "ASK" | "STOP"
  storage: {
    /** ケースファイル・判例ストアの置き場(作業ツリー外)。~ 展開済みの絶対パスにして保持 */
    casesDir: string
    /** 省略時は git toplevel / cwd から導出 */
    projectId?: string
    retention: { maxRuns: number; maxDays: number }
  }
  judge: {
    provider: "claude-cli" | "none"
    /** claude CLI の --model に渡す値 */
    model: string
    timeoutMs: number
    canStop: boolean
    /** パネリスト同時起動数の上限 */
    maxConcurrency: number
    thresholds: {
      /** meta 全軸これ以上で PROCEED、未満は ASK */
      proceed: number
      /** パネル所見が合成に採用される最低 confidence */
      confidence: number
      /** パネル間スコア乖離がこれ超過で ASK */
      maxVariance: number
    }
  }
  weight: {
    tiers: { standard: number; critical: number }
  }
  panel: {
    trivial: PanelistName[]
    standard: PanelistName[]
    critical: PanelistName[]
    perPanelist: Partial<Record<PanelistName | "meta", PanelistSettings>>
  }
  precedent: {
    seedCatalog: boolean
    topN: number
  }
  rules: Record<string, RuleSettings>
}

/** 検証済み設定 + 再現性メタデータ。loader が返す */
export interface LoadedConfig {
  config: RaguelConfig
  configHash: string
  /** 設定の由来(explicit path / cwd / defaults)。ログ用 */
  source: string
}
