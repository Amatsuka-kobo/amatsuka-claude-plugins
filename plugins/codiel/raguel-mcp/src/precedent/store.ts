/**
 * 判例ストア(§9)。1 判例 1 JSON ファイルで永続化し、各ファイルの sha256 を
 * index.json に記録する。書込は kernel(record_outcome 経由)の専権であり、
 * 読込時に index との sha256 不一致が見つかった判例は除外して warn ログを出す
 * (判定対象 AI による判例捏造への防壁)。
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { sha256Hex } from "../casefile/hashchain"
import { resolveProjectId } from "../casefile/store"
import { log } from "../core/log"
import type { Precedent, RaguelConfig } from "../core/types"
import { SEED_PRECEDENTS } from "./seed"

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const INDEX_FILE = "index.json"

/** "~" 始まりのパスを os.homedir() で展開する(念のための防御) */
function expandHome(dir: string): string {
  if (dir === "~") return os.homedir()
  if (dir.startsWith("~/") || dir.startsWith("~\\")) {
    return path.join(os.homedir(), dir.slice(2))
  }
  return dir
}

function sanitizeId(id: string): string {
  if (!ID_PATTERN.test(id) || id.includes("..")) {
    throw new Error(`不正な判例 id です: ${id}`)
  }
  return id
}

export interface LoadAllResult {
  precedents: Precedent[]
  /** sha256 不一致・parse 失敗・index 未登録などで除外された判例 id */
  tampered: string[]
}

export class PrecedentStore {
  private readonly dir: string

  constructor(config: RaguelConfig) {
    const casesDir = expandHome(config.storage.casesDir)
    const projectId = resolveProjectId(config)
    this.dir = path.join(casesDir, "precedents", projectId)
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_FILE)
  }

  private precedentPath(id: string): string {
    return path.join(this.dir, `${sanitizeId(id)}.json`)
  }

  private readIndex(): Record<string, string> {
    const indexPath = this.indexPath()
    if (!fs.existsSync(indexPath)) return {}
    try {
      return JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    } catch {
      return {}
    }
  }

  private writeIndex(index: Record<string, string>): void {
    fs.writeFileSync(this.indexPath(), JSON.stringify(index, null, 2), "utf-8")
  }

  /** 判例を書き込み、index.json に sha256 を記録する(kernel 専権) */
  record(precedent: Precedent): void {
    const id = sanitizeId(precedent.id)
    fs.mkdirSync(this.dir, { recursive: true })
    const content = JSON.stringify(precedent, null, 2)
    fs.writeFileSync(this.precedentPath(id), content, "utf-8")
    const hash = sha256Hex(content)
    const index = this.readIndex()
    index[id] = hash
    this.writeIndex(index)
  }

  /**
   * すべての判例を読み込む。index.json の sha256 と実ファイルが一致しない
   * (改竄・破損)ものは除外し tampered に積む。index に登録のない
   * `<id>.json` も信頼できないため同様に除外する。
   */
  loadAll(): LoadAllResult {
    if (!fs.existsSync(this.dir)) return { precedents: [], tampered: [] }

    const index = this.readIndex()
    const precedents: Precedent[] = []
    const tampered: string[] = []

    for (const [id, expectedHash] of Object.entries(index)) {
      const filePath = path.join(this.dir, `${id}.json`)
      if (!fs.existsSync(filePath)) {
        tampered.push(id)
        log.warn("判例ファイルが見つかりません(index に記録あり)", { id })
        continue
      }
      const bytes = fs.readFileSync(filePath)
      const actualHash = sha256Hex(bytes)
      if (actualHash !== expectedHash) {
        tampered.push(id)
        log.warn("判例ファイルの sha256 が index と不一致です", { id })
        continue
      }
      try {
        precedents.push(JSON.parse(bytes.toString("utf-8")))
      } catch {
        tampered.push(id)
        log.warn("判例ファイルの parse に失敗しました", { id })
      }
    }

    // index に登録のないファイルは kernel が書いたものと確認できないため除外
    const knownIds = new Set(Object.keys(index))
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === INDEX_FILE) continue
      if (!entry.name.endsWith(".json")) continue
      const id = entry.name.slice(0, -".json".length)
      if (knownIds.has(id)) continue
      tampered.push(id)
      log.warn("index.json に記録のない判例ファイルを検出しました", { id })
    }

    return { precedents, tampered }
  }
}

/**
 * プロジェクト判例 + (seedCatalog 設定時)内蔵シード判例集を連結して返す。
 * 改竄が検出された判例は除外したうえで warn ログを出す。
 */
export function loadCorpus(config: RaguelConfig): Precedent[] {
  const store = new PrecedentStore(config)
  const { precedents, tampered } = store.loadAll()
  if (tampered.length > 0) {
    log.warn("改竄された判例を除外しました", { tampered })
  }
  const seeds = config.precedent.seedCatalog ? SEED_PRECEDENTS : []
  return [...precedents, ...seeds]
}
