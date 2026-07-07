/**
 * ケースファイルの証拠ハッシュチェーン(§8)。
 * 証拠ファイル一覧から chainHead を決定論的に計算し、改竄検知に使う。
 */

import { createHash } from "node:crypto"

/** チェーンの初期値(固定文字列) */
const GENESIS = "raguel-genesis"

export interface EvidenceHash {
  name: string
  sha256: string
}

/** データ(バイト列 or 文字列)の sha256 を hex で返す */
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex")
}

/**
 * 証拠エントリの列から chainHead を計算する。
 * H(prev + name + ":" + hash) の畳み込み、初期値は GENESIS。
 * エントリは呼び出し側の順序に関わらず名前順に正規化してから畳み込む。
 */
export function buildChain(entries: EvidenceHash[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  let prev = GENESIS
  for (const entry of sorted) {
    prev = sha256Hex(`${prev + entry.name}:${entry.sha256}`)
  }
  return prev
}

/** entries から計算した chainHead が expectedHead と一致するか */
export function verifyChain(
  entries: EvidenceHash[],
  expectedHead: string
): boolean {
  return buildChain(entries) === expectedHead
}
