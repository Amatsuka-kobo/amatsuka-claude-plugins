/**
 * ケースファイル・評価の索引・裁定の記録の読み書き(設計書 §6.9・§6.10)。
 * この形式は codiel の pass-gate が読む契約である(R11)。
 *
 *   <casesDir>/cases/<projectId>/
 *     evaluations.jsonl   評価の索引
 *     outcomes.jsonl      裁定の記録
 *     <runId>/<phase>/attempt-NN/   EVIDENCE_FILES と verdict.json
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { findPhase } from "../codiel/phases.js"
import { log } from "../core/log.js"
import type {
  EvaluationIndexEntry,
  Finding,
  GatedPhase,
  OutcomeRecord,
  PriorAttempt,
  RaguelConfig,
  VerdictRecord
} from "../core/types.js"
import {
  resolveCasesDir,
  resolveProjectId,
  resolveProjectRoot
} from "../project/root.js"
import type { Digest } from "./digest.js"
import { buildChain, type ChainHeader, sha256Hex } from "./hashchain.js"

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const ATTEMPT_DIR_PATTERN = /^attempt-(\d+)$/
const VERDICT_FILE = "verdict.json"
const SUBJECT_FILE = "subject.json"
const RULES_FILE = "01-rules.json"
const SUBMISSION_DIGEST_FILE = "submission-digest.json"
const EVALUATIONS_FILE = "evaluations.jsonl"
const OUTCOMES_FILE = "outcomes.jsonl"

/** 既知の証拠ファイル(verdict.json を除く)。チェーンと照合はこの名前に限る(所見 G6) */
export const EVIDENCE_FILES = [
  "subject.json",
  "submission.txt",
  "00-synthesis.json",
  "01-rules.json",
  "02-weight.json",
  "03-adversarial.md",
  "04-steelman.md",
  "05-crosscheck.md",
  "06-precedents.json",
  "07-context.json",
  "08-meta.md",
  "submission-digest.json"
] as const

export type EvidenceName = (typeof EVIDENCE_FILES)[number]

const KNOWN = new Set<string>(EVIDENCE_FILES)

/**
 * record_outcome と前フェーズ証拠の読み込みで、索引に evaluationId が無いときの文言。
 * 改竄の文言とは分ける(所見 G3)
 */
export const NO_EVALUATION_RECORD = "評価の記録が無い(掃除済みか、存在しない)"

/** finalizeVerdict に渡す判定。チェーンに関わるフィールドはストアが埋める */
export type VerdictRecordInput = Omit<
  VerdictRecord,
  "schemaVersion" | "at" | "prevChainHead" | "evidence" | "chainHead"
> & { at?: string }

export interface VerifyAttemptResult {
  ok: boolean
  mismatches: string[]
}

function sanitizeRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new Error(`不正な runId です: ${runId}`)
  }
  return runId
}

function sanitizePhase(phase: GatedPhase): GatedPhase {
  if (!findPhase(phase)) throw new Error(`不正な phase です: ${phase}`)
  return phase
}

/** 同じディレクトリの一時ファイルに書いて rename する(所見 G4) */
function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  fs.writeFileSync(tmp, content, "utf-8")
  fs.renameSync(tmp, file)
}

/** JSON Lines を読む。読めない行があれば例外にし、呼び出し側に上書きさせない */
function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  const out: T[] = []
  fs.readFileSync(file, "utf-8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return
      try {
        out.push(JSON.parse(line) as T)
      } catch {
        throw new Error(`索引の行が読めません: ${file}:${i + 1}`)
      }
    })
  return out
}

function readJsonOrWarn(file: string): unknown {
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"))
  } catch {
    log.warn("証拠のファイルが読めません", { path: file })
    return undefined
  }
}

function isDigest(v: unknown): v is Digest {
  const d = v as Digest
  return (
    typeof d === "object" &&
    d !== null &&
    typeof d.schemaVersion === "number" &&
    typeof d.sha256 === "string" &&
    Array.isArray(d.signature)
  )
}

function attemptDirName(attempt: number): string {
  return `attempt-${String(attempt).padStart(2, "0")}`
}

/** 構造の比較(キーの順序を問わない) */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined
  )
  const kb = Object.keys(b).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined
  )
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    sameJson(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k]
    )
  )
}

export class CaseStore {
  /** <casesDir>/cases/<projectId> */
  readonly projectDir: string
  private readonly retention: { maxRuns: number; maxDays: number }

  constructor(
    config: RaguelConfig,
    projectRoot: string = resolveProjectRoot(process.cwd())
  ) {
    this.projectDir = path.join(
      resolveCasesDir(config.storage.casesDir),
      "cases",
      resolveProjectId(projectRoot, config.storage.projectId)
    )
    this.retention = config.storage.retention
  }

  /** <projectDir>/<runId>/<phase> */
  private phaseDir(runId: string, phase: GatedPhase): string {
    return path.join(
      this.projectDir,
      sanitizeRunId(runId),
      sanitizePhase(phase)
    )
  }

  /** run とフェーズの組の attempt を番号の昇順で返す */
  private listAttempts(
    runId: string,
    phase: GatedPhase
  ): Array<{ attempt: number; dir: string }> {
    const dir = this.phaseDir(runId, phase)
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ m: ATTEMPT_DIR_PATTERN.exec(e.name), name: e.name }))
      .filter((e) => e.m !== null)
      .map((e) => ({ attempt: Number(e.m?.[1]), dir: path.join(dir, e.name) }))
      .sort((a, b) => a.attempt - b.attempt)
  }

  /** 次の attempt のディレクトリを作る。番号は run とフェーズの組ごとに振る(所見 F4) */
  openAttempt(
    runId: string,
    phase: GatedPhase
  ): { dir: string; attempt: number } {
    const attempts = this.listAttempts(runId, phase)
    const attempt = (attempts[attempts.length - 1]?.attempt ?? 0) + 1
    const dir = path.join(this.phaseDir(runId, phase), attemptDirName(attempt))
    fs.mkdirSync(dir, { recursive: true })
    return { dir, attempt }
  }

  /** 最新の attempt のディレクトリ。無ければ undefined */
  latestAttemptDir(runId: string, phase: GatedPhase): string | undefined {
    const attempts = this.listAttempts(runId, phase)
    return attempts[attempts.length - 1]?.dir
  }

  /** 既知の証拠ファイルを書く。一覧に無い名前は例外にする */
  writeEvidence(dir: string, name: EvidenceName, content: string): void {
    if (!KNOWN.has(name)) throw new Error(`未知の証拠ファイルです: ${name}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), content, "utf-8")
  }

  writeSubmissionDigest(dir: string, digest: Digest): void {
    this.writeEvidence(
      dir,
      SUBMISSION_DIGEST_FILE,
      JSON.stringify(digest, null, 2)
    )
  }

  /** 既知の証拠ファイルを読む。無ければ undefined */
  readEvidence(dir: string, name: EvidenceName): string | undefined {
    const file = path.join(dir, name)
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined
  }

  /** 既知の証拠ファイルを名前順にテキストで読む */
  readEvidenceTexts(dir: string): Array<{ name: string; content: string }> {
    return this.presentEvidence(dir).map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), "utf-8")
    }))
  }

  private presentEvidence(dir: string): string[] {
    return EVIDENCE_FILES.filter((n) => fs.existsSync(path.join(dir, n))).sort()
  }

  /**
   * 同じ run・同じフェーズで、この attempt より前にある最も新しい verdict.json の chainHead。
   * 無ければ null
   */
  private prevChainHead(dir: string): string | null {
    const phaseDir = path.dirname(dir)
    const own = Number(ATTEMPT_DIR_PATTERN.exec(path.basename(dir))?.[1])
    const earlier = fs.existsSync(phaseDir)
      ? fs
          .readdirSync(phaseDir)
          .map((n) => Number(ATTEMPT_DIR_PATTERN.exec(n)?.[1]))
          .filter((n) => Number.isInteger(n) && n < own)
          .sort((a, b) => b - a)
      : []
    for (const n of earlier) {
      const file = path.join(phaseDir, attemptDirName(n), VERDICT_FILE)
      if (!fs.existsSync(file)) continue
      const v = readJsonOrWarn(file) as VerdictRecord | undefined
      return typeof v?.chainHead === "string" ? v.chainHead : null
    }
    return null
  }

  /**
   * subject.json を record.subject から書き、既知の証拠の sha256 と chainHead を計算して
   * verdict.json を一時ファイルと rename で確定する
   */
  finalizeVerdict(dir: string, record: VerdictRecordInput): VerdictRecord {
    this.writeEvidence(
      dir,
      SUBJECT_FILE,
      JSON.stringify(record.subject, null, 2)
    )
    const evidence = this.presentEvidence(dir).map((name) => ({
      name,
      sha256: sha256Hex(fs.readFileSync(path.join(dir, name)))
    }))
    const prevChainHead = this.prevChainHead(dir)
    const { at, ...rest } = record
    const persisted: VerdictRecord = {
      schemaVersion: 2,
      ...rest,
      at: at ?? new Date().toISOString(),
      prevChainHead,
      evidence,
      chainHead: buildChain({ ...record, prevChainHead }, evidence)
    }
    writeFileAtomic(
      path.join(dir, VERDICT_FILE),
      JSON.stringify(persisted, null, 2)
    )
    return persisted
  }

  /** verdict.json を読む。無いか読めなければ undefined */
  readVerdict(dir: string): VerdictRecord | undefined {
    return readJsonOrWarn(path.join(dir, VERDICT_FILE)) as
      | VerdictRecord
      | undefined
  }

  /**
   * 改竄の検証。既知の証拠ファイルの sha256、chainHead(seed を含む)、
   * subject.json と verdict.json の subject、前の attempt の chainHead を照らす。
   * 既知でないファイルは無視する(所見 G6)
   */
  verifyAttempt(dir: string): VerifyAttemptResult {
    const file = path.join(dir, VERDICT_FILE)
    if (!fs.existsSync(file)) {
      return { ok: false, mismatches: ["verdict.json がありません"] }
    }
    let v: VerdictRecord
    try {
      v = JSON.parse(fs.readFileSync(file, "utf-8"))
    } catch {
      return { ok: false, mismatches: ["verdict.json が読めません"] }
    }
    if (!Array.isArray(v.evidence)) {
      return {
        ok: false,
        mismatches: ["verdict.json に evidence がありません"]
      }
    }
    const mismatches: string[] = []
    const recorded = new Map(v.evidence.map((e) => [e.name, e.sha256]))
    for (const name of recorded.keys()) {
      if (!KNOWN.has(name)) {
        mismatches.push(`evidence に未知のファイル名があります: ${name}`)
      }
    }
    const present = this.presentEvidence(dir)
    for (const name of present) {
      const expected = recorded.get(name)
      if (expected === undefined) {
        mismatches.push(`evidence に記録の無い証拠ファイルがあります: ${name}`)
      } else if (
        sha256Hex(fs.readFileSync(path.join(dir, name))) !== expected
      ) {
        mismatches.push(`証拠ファイルの sha256 が合いません: ${name}`)
      }
    }
    for (const name of recorded.keys()) {
      if (KNOWN.has(name) && !present.includes(name)) {
        mismatches.push(`記録された証拠ファイルがありません: ${name}`)
      }
    }
    const header: ChainHeader = v
    if (buildChain(header, v.evidence) !== v.chainHead) {
      mismatches.push("chainHead が verdict.json の内容と合いません")
    }
    const subjectText = this.readEvidence(dir, SUBJECT_FILE)
    let subjectOk = false
    try {
      subjectOk =
        subjectText !== undefined &&
        sameJson(JSON.parse(subjectText), v.subject)
    } catch {
      // 読めない subject.json は不一致として扱う
    }
    if (!subjectOk) {
      mismatches.push("verdict.json の subject が subject.json と合いません")
    }
    const prev = this.prevChainHead(dir)
    if (prev !== v.prevChainHead) {
      mismatches.push(
        "prevChainHead が前の attempt の chainHead と合いません(前の attempt の差し替えか削除)"
      )
    }
    return { ok: mismatches.length === 0, mismatches }
  }

  /**
   * 同じ run・同じフェーズの過去の attempt(verdict.json のあるもの)を番号の昇順で返す。
   * 読めない証拠とダイジェストは warn を出して空とみなす
   */
  readPriorAttempts(runId: string, phase: GatedPhase): PriorAttempt[] {
    const attempts = this.listAttempts(runId, phase)
    if (attempts.length === 0) return []
    const outcomes = this.latestOutcomes()
    const out: PriorAttempt[] = []
    for (const { attempt, dir } of attempts) {
      const v = this.readVerdict(dir)
      if (!v) continue
      const rules = readJsonOrWarn(path.join(dir, RULES_FILE)) as
        | { findings?: Finding[] }
        | undefined
      const askRuleIds = [
        ...new Set(
          (Array.isArray(rules?.findings) ? rules.findings : [])
            .filter((f) => f.severity === "ask" || f.severity === "stop")
            .map((f) => f.ruleId)
        )
      ]
      const rawDigest = readJsonOrWarn(path.join(dir, SUBMISSION_DIGEST_FILE))
      if (rawDigest !== undefined && !isDigest(rawDigest)) {
        log.warn("ダイジェストの形が違います", {
          path: path.join(dir, SUBMISSION_DIGEST_FILE)
        })
      }
      out.push({
        attempt,
        verdict: v.verdict,
        judgeStatus: v.judgeStatus,
        hasRuling: (outcomes.get(v.evaluationId)?.ruling ?? null) !== null,
        askRuleIds,
        digest: isDigest(rawDigest) ? rawDigest : null
      })
    }
    return out
  }

  /** evaluations.jsonl に 1 行を追記する */
  appendEvaluationIndex(entry: EvaluationIndexEntry): void {
    this.appendLine(EVALUATIONS_FILE, entry)
  }

  /** outcomes.jsonl に 1 行を追記する */
  appendOutcome(record: OutcomeRecord): void {
    this.appendLine(OUTCOMES_FILE, record)
  }

  private appendLine(name: string, value: unknown): void {
    fs.mkdirSync(this.projectDir, { recursive: true })
    fs.appendFileSync(
      path.join(this.projectDir, name),
      `${JSON.stringify(value)}\n`,
      "utf-8"
    )
  }

  /** 索引から evaluationId の行を引く。複数あれば後の行。無ければ undefined(NO_EVALUATION_RECORD を返す場面) */
  lookupEvaluation(evaluationId: string): EvaluationIndexEntry | undefined {
    return readJsonl<EvaluationIndexEntry>(
      path.join(this.projectDir, EVALUATIONS_FILE)
    ).findLast((e) => e.evaluationId === evaluationId)
  }

  /** 裁定の記録から evaluationId の最後の行を引く */
  lookupOutcome(evaluationId: string): OutcomeRecord | undefined {
    return this.latestOutcomes().get(evaluationId)
  }

  private latestOutcomes(): Map<string, OutcomeRecord> {
    const map = new Map<string, OutcomeRecord>()
    for (const r of readJsonl<OutcomeRecord>(
      path.join(this.projectDir, OUTCOMES_FILE)
    )) {
      map.set(r.evaluationId, r)
    }
    return map
  }

  /**
   * 保持の上限を超えた run を消す。run の新しさは索引の最後の評価の at で決める。
   * 索引に行の無い run のディレクトリは mtime で代える。
   * 消した run の行は evaluations.jsonl と outcomes.jsonl からも消す(所見 G3)。
   * 索引に読めない行があれば、何も消さずに例外にする
   */
  sweepRetention(now: number = Date.now()): string[] {
    if (!fs.existsSync(this.projectDir)) return []
    const evalFile = path.join(this.projectDir, EVALUATIONS_FILE)
    const outFile = path.join(this.projectDir, OUTCOMES_FILE)
    const evaluations = readJsonl<EvaluationIndexEntry>(evalFile)
    const outcomes = readJsonl<OutcomeRecord>(outFile)

    const lastAt = new Map<string, number>()
    for (const e of evaluations) {
      const t = Date.parse(e.at)
      if (!Number.isNaN(t) && t > (lastAt.get(e.runId) ?? -Infinity)) {
        lastAt.set(e.runId, t)
      }
    }
    for (const entry of fs.readdirSync(this.projectDir, {
      withFileTypes: true
    })) {
      if (entry.isDirectory() && !lastAt.has(entry.name)) {
        lastAt.set(
          entry.name,
          fs.statSync(path.join(this.projectDir, entry.name)).mtimeMs
        )
      }
    }

    const maxAgeMs = this.retention.maxDays * 24 * 60 * 60 * 1000
    const removed = [...lastAt.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, t], i) => i >= this.retention.maxRuns || now - t > maxAgeMs)
      .map(([runId]) => runId)
    if (removed.length === 0) return []

    const gone = new Set(removed)
    const keep = <T extends { runId: string }>(rows: T[]) =>
      rows
        .filter((r) => !gone.has(r.runId))
        .map((r) => `${JSON.stringify(r)}\n`)
        .join("")
    if (fs.existsSync(evalFile)) writeFileAtomic(evalFile, keep(evaluations))
    if (fs.existsSync(outFile)) writeFileAtomic(outFile, keep(outcomes))
    for (const runId of removed) {
      if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) continue
      fs.rmSync(path.join(this.projectDir, runId), {
        recursive: true,
        force: true
      })
    }
    return removed
  }
}
