/**
 * 判例ストア(§6.11)。1 判例 1 JSON ファイルで永続化し、各ファイルの sha256 と
 * 退役の記録を index.json に持つ。書き込みは kernel(record_outcome 経由)だけが行い、
 * 読み込み時に索引と sha256 が合わない判例は除外して warn を出す
 * (判定対象の AI による判例の捏造への防壁)。
 * 退役は判例のファイルに触れず、索引の retiredAt と retireReason だけを書く。
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { sha256Hex } from "../casefile/hashchain"
import { log } from "../core/log"
import type {
  GatedPhase,
  OutcomeLabel,
  Precedent,
  RaguelConfig,
  Ruling
} from "../core/types"
import { resolveCasesDir, resolveProjectId } from "../project/root"
import { SEED_PRECEDENTS } from "./seed"

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const INDEX_FILE = "index.json"

/**
 * firedRules に入れない障害由来のルール ID(§6.11、所見 G2)。
 * `panel/*-error` は撤去した LLM パネルの過去の判例を除くために残す
 */
const NON_PRECEDENT_RULE =
  /^(panel\/[^/]+-error|kernel\/.+|rule-error|contextJudge\/unavailable)$/

/** 障害由来の所見(kernel/*・rule-error・contextJudge/unavailable と過去の panel/*-error)を firedRules から除く */
export function filterFiredRules(ruleIds: readonly string[]): string[] {
  return ruleIds.filter((id) => !NON_PRECEDENT_RULE.test(id))
}

function isValidId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.includes("..")
}

function sanitizeId(id: string): string {
  if (!isValidId(id)) throw new Error(`不正な判例 id です: ${id}`)
  return id
}

/** 同じディレクトリの一時ファイルへ書いて rename する(途中で切れた内容を残さない) */
function writeAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, content, "utf-8")
    fs.renameSync(tmp, filePath)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

interface IndexEntry {
  sha256: string
  retiredAt: string | null
  retireReason: string | null
}

/** 検索の入力になる判例。退役していれば retiredAt を持つ(退役していないものはキー自体を持たない) */
export type StoredPrecedent = Precedent & {
  retiredAt?: string
  retireReason?: string
}

export interface LoadAllResult {
  /** sha256 が合った判例。退役したものも含み、退役の印を retiredAt に持つ */
  precedents: StoredPrecedent[]
  /** sha256 不一致・parse 失敗・索引未登録・索引が読めないなどで除外された id */
  tampered: string[]
}

export interface ListPrecedentsFilter {
  outcome?: OutcomeLabel
  phase?: GatedPhase
  includeRetired?: boolean
}

export interface PrecedentListing {
  id: string
  source: Precedent["source"]
  phase: GatedPhase | null
  outcome: OutcomeLabel
  ruling: Ruling | null
  firedRules: string[]
  recordedAt: string | null
  retiredAt: string | null
}

export type RetireResult =
  | { retired: true }
  | { retired: false; reason: string }

function toIndexEntry(value: unknown): IndexEntry | null {
  // 旧形式(id → sha256 の文字列)も読む
  if (typeof value === "string") {
    return { sha256: value, retiredAt: null, retireReason: null }
  }
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.sha256 !== "string") return null
  const retiredAt = v.retiredAt ?? null
  const retireReason = v.retireReason ?? null
  if (retiredAt !== null && typeof retiredAt !== "string") return null
  if (retireReason !== null && typeof retireReason !== "string") return null
  return { sha256: v.sha256, retiredAt, retireReason }
}

export class PrecedentStore {
  private readonly dir: string

  /** projectRoot は resolveProjectId の入力である。判例は `<casesDir>/precedents/<projectId>/` に置く */
  constructor(config: RaguelConfig, projectRoot: string) {
    const casesDir = resolveCasesDir(config.storage.casesDir)
    const projectId = resolveProjectId(projectRoot, config.storage.projectId)
    this.dir = path.join(casesDir, "precedents", projectId)
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_FILE)
  }

  private precedentPath(id: string): string {
    return path.join(this.dir, `${sanitizeId(id)}.json`)
  }

  /** 索引が無ければ空。読めない(JSON でない・行の形が不正)なら例外にし、上書きさせない */
  private readIndex(): Record<string, IndexEntry> {
    const indexPath = this.indexPath()
    if (!fs.existsSync(indexPath)) return {}
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    } catch (error) {
      throw new Error(
        `判例の索引が読めません(${indexPath}): ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`判例の索引がオブジェクトではありません(${indexPath})`)
    }
    const index: Record<string, IndexEntry> = {}
    for (const [id, value] of Object.entries(raw)) {
      const entry = toIndexEntry(value)
      if (!entry) {
        throw new Error(`判例の索引の行が読めません(${indexPath}): ${id}`)
      }
      index[id] = entry
    }
    return index
  }

  private writeIndex(index: Record<string, IndexEntry>): void {
    writeAtomic(this.indexPath(), JSON.stringify(index, null, 2))
  }

  /**
   * 判例を書き込み、索引に sha256 を記録する(kernel 専権)。
   * 同じ id の判例が退役済みなら、ファイルも索引も書かずに false を返す(再記録で復活させない)
   */
  record(precedent: Precedent): boolean {
    const id = sanitizeId(precedent.id)
    const index = this.readIndex() // 読めなければここで例外にし、何も書かない
    if ((index[id]?.retiredAt ?? null) !== null) return false
    fs.mkdirSync(this.dir, { recursive: true })
    const content = JSON.stringify(precedent, null, 2)
    writeAtomic(this.precedentPath(id), content)
    index[id] = {
      sha256: sha256Hex(content),
      retiredAt: null,
      retireReason: null
    }
    this.writeIndex(index)
    return true
  }

  /**
   * すべての判例を読む。索引の sha256 と実ファイルが合わない(改竄・破損)ものは
   * 除外して tampered に積む。索引に無い `<id>.json` も同様に除く。
   * 索引が読めないときは、読み込みを止めず、tampered に索引を積んで空を返す。
   */
  loadAll(): LoadAllResult {
    if (!fs.existsSync(this.dir)) return { precedents: [], tampered: [] }

    let index: Record<string, IndexEntry>
    try {
      index = this.readIndex()
    } catch (error) {
      log.warn("判例の索引が読めないため、プロジェクトの判例を使いません", {
        error: error instanceof Error ? error.message : String(error)
      })
      return { precedents: [], tampered: [INDEX_FILE] }
    }

    const precedents: StoredPrecedent[] = []
    const tampered: string[] = []

    for (const [id, entry] of Object.entries(index)) {
      if (!isValidId(id)) {
        tampered.push(id)
        log.warn("索引に不正な id があります", { id })
        continue
      }
      const filePath = this.precedentPath(id)
      if (!fs.existsSync(filePath)) {
        tampered.push(id)
        log.warn("判例ファイルが見つかりません(索引に記録あり)", { id })
        continue
      }
      const bytes = fs.readFileSync(filePath)
      if (sha256Hex(bytes) !== entry.sha256) {
        tampered.push(id)
        log.warn("判例ファイルの sha256 が索引と不一致です", { id })
        continue
      }
      try {
        const precedent: StoredPrecedent = JSON.parse(bytes.toString("utf-8"))
        if (entry.retiredAt !== null) {
          precedent.retiredAt = entry.retiredAt
          if (entry.retireReason !== null) {
            precedent.retireReason = entry.retireReason
          }
        }
        precedents.push(precedent)
      } catch {
        tampered.push(id)
        log.warn("判例ファイルの parse に失敗しました", { id })
      }
    }

    // 索引に無いファイルは kernel が書いたと確認できないので除く
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === INDEX_FILE) continue
      if (!entry.name.endsWith(".json")) continue
      const id = entry.name.slice(0, -".json".length)
      if (id in index) continue
      tampered.push(id)
      log.warn("索引に記録のない判例ファイルを検出しました", { id })
    }

    return { precedents, tampered }
  }

  /** プロジェクトの判例を一覧にする(list_precedents 用)。既定では退役したものを含めない */
  list(filter: ListPrecedentsFilter = {}): PrecedentListing[] {
    const rows: PrecedentListing[] = []
    for (const p of this.loadAll().precedents) {
      if (p.retiredAt !== undefined && !filter.includeRetired) continue
      if (filter.outcome && p.outcome !== filter.outcome) continue
      if (filter.phase && p.phase !== filter.phase) continue
      rows.push({
        id: p.id,
        source: p.source,
        phase: p.phase ?? null,
        outcome: p.outcome,
        ruling: p.ruling ?? null,
        firedRules: p.firedRules,
        recordedAt: p.recordedAt ?? null,
        retiredAt: p.retiredAt ?? null
      })
    }
    return rows.sort(
      (a, b) =>
        (a.recordedAt ?? "").localeCompare(b.recordedAt ?? "") ||
        a.id.localeCompare(b.id)
    )
  }

  /**
   * 判例を退役させる。判例のファイルは消さず、索引に retiredAt と retireReason を書く。
   * 内蔵のシード判例はこのストアに無いので退役できない。
   * 索引が読めないときは例外にする。
   */
  retire(id: string, reason: string, now: Date = new Date()): RetireResult {
    if (!isValidId(id)) {
      return { retired: false, reason: `不正な判例 id です: ${id}` }
    }
    const index = this.readIndex()
    const entry = index[id]
    if (!entry) {
      return {
        retired: false,
        reason: `プロジェクトの判例に ${id} がありません(シード判例は退役できません)`
      }
    }
    if (entry.retiredAt !== null) {
      return { retired: false, reason: `${id} はすでに退役しています` }
    }
    index[id] = {
      ...entry,
      retiredAt: now.toISOString(),
      retireReason: reason
    }
    this.writeIndex(index)
    return { retired: true }
  }
}

/**
 * プロジェクト判例と、seedCatalog が true なら内蔵のシード判例を連結して返す。
 * 改竄が見つかった判例は除いて warn を出す。退役した判例は retiredAt を持ったまま返し、
 * 検索(retrieval.ts)が除く。
 */
export function loadCorpus(
  config: RaguelConfig,
  projectRoot: string
): StoredPrecedent[] {
  const { precedents, tampered } = new PrecedentStore(
    config,
    projectRoot
  ).loadAll()
  if (tampered.length > 0) {
    log.warn("改竄された判例を除外しました", { tampered })
  }
  const seeds = config.precedent.seedCatalog ? SEED_PRECEDENTS : []
  return [...precedents, ...seeds]
}
