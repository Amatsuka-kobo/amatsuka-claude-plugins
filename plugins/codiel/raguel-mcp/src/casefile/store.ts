/**
 * ケースファイル(§8)の読み書き。run 単位の証拠ディレクトリ・
 * 最終判定(verdict.json)・再提出ループ検知用ダイジェスト・
 * 評価インデックス(evaluations.jsonl)・保持ポリシーを扱う。
 *
 * ディレクトリレイアウト:
 *   <casesDir>/cases/<projectId>/<runId>/<kind>/attempt-NN/
 *     01-rules.json ... 08-meta.md   (実行された分のみ)
 *     submission-digest.json
 *     verdict.json
 *   <casesDir>/cases/<projectId>/evaluations.jsonl
 */

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type {
  ArtifactKind,
  Finding,
  MetaReport,
  RaguelConfig,
  SubmissionDigest,
  Verdict,
  WeightTier
} from "../core/types"
import { buildChain, sha256Hex } from "./hashchain"

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const ATTEMPT_DIR_PATTERN = /^attempt-(\d+)$/
const ARTIFACT_KINDS: ArtifactKind[] = ["decision", "plan", "design", "code"]
const VERDICT_FILE = "verdict.json"
const SUBMISSION_DIGEST_FILE = "submission-digest.json"
const EVALUATIONS_FILE = "evaluations.jsonl"

/** verdict.json 生成前に呼び出し側が渡す判定レコード */
export interface VerdictRecordInput {
  evaluationId: string
  runId: string
  kind: ArtifactKind
  attempt: number
  verdict: Verdict
  weightTier: WeightTier
  findings: Finding[]
  meta?: MetaReport
  policy: { configHash: string; version: number }
  /** ISO 文字列。省略時は呼び出し時刻 */
  at?: string
  /** 判例化(record_outcome)のための元入力の要約 */
  objective?: string
  changedPaths?: string[]
}

/** verdict.json に永続化される内容 */
export interface PersistedVerdict extends Omit<VerdictRecordInput, "at"> {
  at: string
  evidence: Array<{ name: string; sha256: string }>
  chainHead: string
}

export interface EvaluationIndexEntry {
  evaluationId: string
  runId: string
  kind: ArtifactKind
  attempt: number
  casePath: string
  verdict: Verdict
  at: string
}

export interface VerifyAttemptResult {
  ok: boolean
  mismatches: string[]
}

/** runId が path traversal に使えない安全な形式か検証する */
function sanitizeRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new Error(`不正な runId です: ${runId}`)
  }
  return runId
}

/** kind が既知の ArtifactKind か検証する */
function sanitizeKind(kind: ArtifactKind): ArtifactKind {
  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new Error(`不正な kind です: ${kind}`)
  }
  return kind
}

/** "~" 始まりのパスを os.homedir() で展開する(念のための防御) */
function expandHome(dir: string): string {
  if (dir === "~") return os.homedir()
  if (dir.startsWith("~/") || dir.startsWith("~\\")) {
    return path.join(os.homedir(), dir.slice(2))
  }
  return dir
}

/**
 * projectId を解決する。config.storage.projectId があればそれを使い、
 * なければ git toplevel(失敗時は cwd)の絶対パスから
 * basename + "-" + sha256(絶対パス).slice(0, 12) を組み立てる。
 */
export function resolveProjectId(config: RaguelConfig): string {
  if (config.storage.projectId) return config.storage.projectId
  const absPath = resolveProjectRoot()
  return `${path.basename(absPath)}-${sha256Hex(absPath).slice(0, 12)}`
}

function resolveProjectRoot(): string {
  try {
    const out = execFileSync(
      "git",
      ["-C", process.cwd(), "rev-parse", "--show-toplevel"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()
    return path.resolve(out)
  } catch {
    return process.cwd()
  }
}

/** ディレクトリ内のファイル名(verdict.json を除く)を名前順で列挙する */
function listEvidenceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== VERDICT_FILE)
    .map((entry) => entry.name)
    .sort()
}

export class CaseStore {
  private readonly casesDir: string
  private readonly projectId: string
  private readonly retention: { maxRuns: number; maxDays: number }

  constructor(config: RaguelConfig) {
    this.casesDir = expandHome(config.storage.casesDir)
    this.projectId = resolveProjectId(config)
    this.retention = config.storage.retention
  }

  /** <casesDir>/cases/<projectId> */
  private projectRoot(): string {
    return path.join(this.casesDir, "cases", this.projectId)
  }

  /** <casesDir>/cases/<projectId>/<runId>/<kind> */
  private runKindDir(runId: string, kind: ArtifactKind): string {
    return path.join(
      this.projectRoot(),
      sanitizeRunId(runId),
      sanitizeKind(kind)
    )
  }

  /**
   * 既存 attempt-NN を走査して次番号のディレクトリを作成する。
   * 実行された分のみ証拠ファイルが作られるため、番号は欠番があり得る前提で
   * 最大番号 + 1 を採用する。
   */
  openAttempt(
    runId: string,
    kind: ArtifactKind
  ): { dir: string; attempt: number } {
    const kindDir = this.runKindDir(runId, kind)
    fs.mkdirSync(kindDir, { recursive: true })
    const existing = fs.existsSync(kindDir)
      ? fs.readdirSync(kindDir, { withFileTypes: true })
      : []
    let maxAttempt = 0
    for (const entry of existing) {
      if (!entry.isDirectory()) continue
      const match = ATTEMPT_DIR_PATTERN.exec(entry.name)
      if (!match) continue
      maxAttempt = Math.max(maxAttempt, Number(match[1]))
    }
    const attempt = maxAttempt + 1
    const dir = path.join(
      kindDir,
      `attempt-${String(attempt).padStart(2, "0")}`
    )
    fs.mkdirSync(dir, { recursive: true })
    return { dir, attempt }
  }

  /** 証拠ファイルを attempt ディレクトリへ書き込む */
  writeEvidence(dir: string, name: string, content: string): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), content, "utf-8")
  }

  /**
   * dir 内の証拠ファイル(verdict.json 以外)を名前順に読み、
   * sha256 一覧 + chainHead を計算して verdict.json として書き込む。
   */
  finalizeVerdict(dir: string, record: VerdictRecordInput): PersistedVerdict {
    const names = listEvidenceFiles(dir)
    const evidence = names.map((name) => ({
      name,
      sha256: sha256Hex(fs.readFileSync(path.join(dir, name)))
    }))
    const chainHead = buildChain(evidence)
    const persisted: PersistedVerdict = {
      ...record,
      at: record.at ?? new Date().toISOString(),
      evidence,
      chainHead
    }
    fs.writeFileSync(
      path.join(dir, VERDICT_FILE),
      JSON.stringify(persisted, null, 2),
      "utf-8"
    )
    return persisted
  }

  /**
   * verdict.json の evidence と実ファイルを突合する(改竄検知)。
   * 不一致があれば呼び出し側が STOP に使う。
   */
  verifyAttempt(dir: string): VerifyAttemptResult {
    const verdictPath = path.join(dir, VERDICT_FILE)
    if (!fs.existsSync(verdictPath)) {
      return { ok: false, mismatches: ["verdict.json が存在しません"] }
    }
    let persisted: PersistedVerdict
    try {
      persisted = JSON.parse(fs.readFileSync(verdictPath, "utf-8"))
    } catch {
      return { ok: false, mismatches: ["verdict.json の parse に失敗しました"] }
    }
    const mismatches: string[] = []
    const actualNames = listEvidenceFiles(dir)
    const recorded = new Map(persisted.evidence.map((e) => [e.name, e.sha256]))
    for (const name of actualNames) {
      const expected = recorded.get(name)
      if (expected === undefined) {
        mismatches.push(`証拠に記録のないファイルが存在します: ${name}`)
        continue
      }
      const actual = sha256Hex(fs.readFileSync(path.join(dir, name)))
      if (actual !== expected) {
        mismatches.push(`ハッシュ不一致: ${name}`)
      }
    }
    for (const name of recorded.keys()) {
      if (!actualNames.includes(name)) {
        mismatches.push(`記録された証拠ファイルが失われています: ${name}`)
      }
    }
    const recomputedHead = buildChain(persisted.evidence)
    if (recomputedHead !== persisted.chainHead) {
      mismatches.push("chainHead が evidence 一覧と一致しません")
    }
    return { ok: mismatches.length === 0, mismatches }
  }

  /** 最新の attempt ディレクトリ(存在しなければ undefined) */
  latestAttemptDir(runId: string, kind: ArtifactKind): string | undefined {
    const kindDir = this.runKindDir(runId, kind)
    if (!fs.existsSync(kindDir)) return undefined
    const names = fs
      .readdirSync(kindDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => ATTEMPT_DIR_PATTERN.test(name))
      .sort()
    const latest = names[names.length - 1]
    return latest === undefined ? undefined : path.join(kindDir, latest)
  }

  /** attempt ディレクトリの verdict.json を読む(なければ undefined) */
  readVerdict(dir: string): PersistedVerdict | undefined {
    const file = path.join(dir, VERDICT_FILE)
    if (!fs.existsSync(file)) return undefined
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"))
    } catch {
      return undefined
    }
  }

  /** attempt ディレクトリの証拠ファイル群をテキストで読む(名前順) */
  readEvidenceTexts(dir: string): Array<{ name: string; content: string }> {
    return listEvidenceFiles(dir).map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), "utf-8")
    }))
  }

  /** 各 attempt の submission-digest.json を attempt 番号順に読む */
  readPriorSubmissions(runId: string, kind: ArtifactKind): SubmissionDigest[] {
    const kindDir = this.runKindDir(runId, kind)
    if (!fs.existsSync(kindDir)) return []
    const attemptDirs = fs
      .readdirSync(kindDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => ATTEMPT_DIR_PATTERN.test(name))
      .sort()
    const digests: SubmissionDigest[] = []
    for (const attemptName of attemptDirs) {
      const digestPath = path.join(kindDir, attemptName, SUBMISSION_DIGEST_FILE)
      if (!fs.existsSync(digestPath)) continue
      try {
        digests.push(JSON.parse(fs.readFileSync(digestPath, "utf-8")))
      } catch {
        // 壊れている attempt はスキップ
      }
    }
    return digests
  }

  /** 再提出ループ検知用のダイジェストを書き込む */
  writeSubmissionDigest(dir: string, digest: SubmissionDigest): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, SUBMISSION_DIGEST_FILE),
      JSON.stringify(digest, null, 2),
      "utf-8"
    )
  }

  /** evaluations.jsonl に評価インデックスを追記する */
  appendEvaluationIndex(entry: EvaluationIndexEntry): void {
    const root = this.projectRoot()
    fs.mkdirSync(root, { recursive: true })
    fs.appendFileSync(
      path.join(root, EVALUATIONS_FILE),
      `${JSON.stringify(entry)}\n`,
      "utf-8"
    )
  }

  /** evaluations.jsonl を走査して evaluationId から逆引きする */
  lookupEvaluation(evaluationId: string): EvaluationIndexEntry | undefined {
    const file = path.join(this.projectRoot(), EVALUATIONS_FILE)
    if (!fs.existsSync(file)) return undefined
    const lines = fs.readFileSync(file, "utf-8").split("\n")
    let found: EvaluationIndexEntry | undefined
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry: EvaluationIndexEntry = JSON.parse(line)
        if (entry.evaluationId === evaluationId) found = entry
      } catch {
        // 壊れた行はスキップ
      }
    }
    return found
  }

  /** projectId 配下の run を mtime でソートし、保持ポリシー超過分を削除する */
  sweepRetention(): void {
    const root = this.projectRoot()
    if (!fs.existsSync(root)) return
    const runDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(root, entry.name)
        return { full, mtime: fs.statSync(full).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime) // 新しい順

    const maxAgeMs = this.retention.maxDays * 24 * 60 * 60 * 1000
    const now = Date.now()
    runDirs.forEach((run, index) => {
      const overCount = index >= this.retention.maxRuns
      const overAge = now - run.mtime > maxAgeMs
      if (overCount || overAge) {
        fs.rmSync(run.full, { recursive: true, force: true })
      }
    })
  }
}
