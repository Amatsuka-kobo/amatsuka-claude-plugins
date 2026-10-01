/**
 * submission-digest.json の中身: 本文の正規化 sha256 と 5-gram の MinHash 署名(設計書 §6.9.3)。
 * 正規化・ハッシュ・定数のどれかを変えたら DIGEST_SCHEMA_VERSION を上げ、古い版とは比べない。
 */

import { createHash } from "node:crypto"

export const DIGEST_SCHEMA_VERSION = 1

const NUM_HASHES = 128
const GRAM = 5
const MASK32 = 0xffffffff
const TWO32 = 4294967296
/** 2^32 より大きい素数 */
const P = 4294967311
/** 定数 a_i・b_i を作る固定の種 */
const SEED = 0x52414755

export interface Digest {
  schemaVersion: number
  /** 正規化した本文の sha256(hex) */
  sha256: string
  /** 128 個の 32 bit の整数 */
  signature: number[]
}

/** 決定論の疑似乱数(mulberry32)。定数を種から作るためだけに使う。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

// a_i は 1 以上 P 未満、b_i は 0 以上 P 未満。
const A: number[] = []
const B: number[] = []
{
  const rand = mulberry32(SEED)
  for (let i = 0; i < NUM_HASHES; i++) {
    A.push((rand() % (P - 1)) + 1)
    B.push(rand() % P)
  }
}

/** Unicode の NFC、空白の連続を半角空白 1 つへ、前後の空白の除去、小文字化の順 */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase()
}

/** FNV-1a 32 bit(UTF-8 のバイト列) */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (const byte of Buffer.from(s, "utf-8"))
    h = Math.imul(h ^ byte, 0x01000193) >>> 0
  return h
}

/** (a × x + b) mod P。a・x・b は 2^32 未満で、Number の安全整数(2^53)に収まるよう x を 16 bit ずつに割る。 */
function hashAt(i: number, x: number): number {
  const a = A[i]
  const hi = Math.floor(x / 65536)
  const lo = x % 65536
  const ax = (((a * hi) % P) * 65536 + a * lo) % P
  return ((ax + B[i]) % P) % TWO32
}

/** コードポイント単位の 5-gram。5 コードポイント未満なら全体を 1 つとみなす。空なら空の列。 */
function grams(normalized: string): string[] {
  const cps = Array.from(normalized)
  if (cps.length === 0) return []
  if (cps.length < GRAM) return [normalized]
  const out: string[] = []
  for (let i = 0; i + GRAM <= cps.length; i++)
    out.push(cps.slice(i, i + GRAM).join(""))
  return out
}

export function computeDigest(text: string): Digest {
  const normalized = normalizeText(text)
  const signature: number[] = new Array(NUM_HASHES).fill(MASK32)
  for (const g of grams(normalized)) {
    const x = fnv1a32(g)
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = hashAt(i, x)
      if (h < signature[i]) signature[i] = h
    }
  }
  return {
    schemaVersion: DIGEST_SCHEMA_VERSION,
    sha256: createHash("sha256").update(normalized, "utf-8").digest("hex"),
    signature
  }
}

/**
 * 署名の値が一致した位置の数 ÷ 128。
 * schemaVersion が違うダイジェスト同士は比べず null を返す。
 */
export function digestSimilarity(a: Digest, b: Digest): number | null {
  if (a.schemaVersion !== b.schemaVersion) return null
  if (a.signature.length !== NUM_HASHES || b.signature.length !== NUM_HASHES)
    return null
  let same = 0
  for (let i = 0; i < NUM_HASHES; i++)
    if (a.signature[i] === b.signature[i]) same++
  return same / NUM_HASHES
}
