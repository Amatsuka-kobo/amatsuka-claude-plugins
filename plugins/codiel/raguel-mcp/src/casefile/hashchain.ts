/**
 * ケースファイルのハッシュチェーン(設計書 §6.10)。
 * 判定の識別と前の attempt の chainHead を seed に入れ、既知の証拠ファイルを名前順に畳み込む。
 * verdict や judgeStatus だけを書き換えても chainHead が合わなくなる(所見 G8)。
 */

import { createHash } from "node:crypto"
import type { GatedPhase, JudgeStatus, Verdict } from "../core/types.js"

export interface EvidenceHash {
  name: string
  sha256: string
}

/** seed に入れる verdict.json のフィールド */
export interface ChainHeader {
  evaluationId: string
  runId: string
  phase: GatedPhase
  attempt: number
  verdict: Verdict
  judgeStatus: JudgeStatus
  prevChainHead: string | null
}

/** データ(バイト列か文字列)の sha256 を hex で返す */
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex")
}

export function chainSeed(h: ChainHeader): string {
  return sha256Hex(
    [
      "raguel-v2",
      h.evaluationId,
      h.runId,
      h.phase,
      String(h.attempt),
      h.verdict,
      h.judgeStatus,
      h.prevChainHead ?? "none"
    ].join("|")
  )
}

/**
 * seed を初期値に、証拠を名前順に H(prev + name + ":" + sha256) で畳み込む。
 * 渡す順序に関わらず名前順に並べ直す。
 */
export function buildChain(
  header: ChainHeader,
  entries: EvidenceHash[]
): string {
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  let prev = chainSeed(header)
  for (const entry of sorted) {
    prev = sha256Hex(`${prev}${entry.name}:${entry.sha256}`)
  }
  return prev
}
