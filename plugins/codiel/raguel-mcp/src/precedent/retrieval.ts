/**
 * 判例の決定論的類似検索(§9)。埋め込み・API は使わず、自前 BM25 +
 * 発火ルール/変更パスの Jaccard + kind 一致 + project ブーストで
 * 合成スコアを算出する。同じ入力からは必ず同じ順序が得られる。
 */

import * as path from "node:path"
import type { ArtifactKind, Precedent } from "../core/types"

const BM25_K1 = 1.2
const BM25_B = 0.75

const WEIGHT_BM25 = 0.4
const WEIGHT_FIRED_RULES = 0.3
const WEIGHT_CHANGED_PATHS = 0.2
const WEIGHT_KIND = 0.1
const PROJECT_SOURCE_BOOST = 0.1

const ASCII_ALNUM = /[a-z0-9]/
// ひらがな(U+3040-309F)・カタカナ(U+30A0-30FF)・
// CJK 統合漢字拡張 A(U+3400-4DBF)・CJK 統合漢字(U+4E00-9FFF)・
// CJK 互換漢字(U+F900-FAFF)
const CJK_CHAR =
  /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

export interface PrecedentQuery {
  kind: ArtifactKind
  objective: string
  summaryText: string
  firedRules: string[]
  changedPaths: string[]
}

export interface PrecedentMatch {
  precedent: Precedent
  score: number
}

/**
 * 英数字連続を 1 語(小文字化)、CJK 文字連続部分は文字 bigram に
 * 分割するトークナイザ。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  const n = lower.length
  let i = 0
  while (i < n) {
    const ch = lower[i]
    if (ASCII_ALNUM.test(ch)) {
      let j = i + 1
      while (j < n && ASCII_ALNUM.test(lower[j])) j++
      tokens.push(lower.slice(i, j))
      i = j
      continue
    }
    if (CJK_CHAR.test(ch)) {
      let j = i + 1
      while (j < n && CJK_CHAR.test(lower[j])) j++
      const run = lower.slice(i, j)
      if (run.length === 1) {
        tokens.push(run)
      } else {
        for (let k = 0; k < run.length - 1; k++) {
          tokens.push(run.slice(k, k + 2))
        }
      }
      i = j
      continue
    }
    i++
  }
  return tokens
}

/** 判例の検索文書(summary + objective + firedRules + changedPaths + lesson) */
function precedentDocumentText(precedent: Precedent): string {
  return [
    precedent.summary,
    precedent.objective ?? "",
    precedent.firedRules.join(" "),
    precedent.changedPaths.join(" "),
    precedent.lesson
  ].join(" ")
}

/** ディレクトリ単位に分解したパス集合(祖先ディレクトリをすべて含む) */
function pathDirSet(paths: string[]): Set<string> {
  const set = new Set<string>()
  for (const raw of paths) {
    const normalized = raw.replace(/\\/g, "/")
    const dir = path.posix.dirname(normalized)
    if (dir === "." || dir === "") continue
    const parts = dir.split("/").filter(Boolean)
    let acc = ""
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      set.add(acc)
    }
  }
  return set
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

interface BM25Doc {
  precedent: Precedent
  termCounts: Map<string, number>
  length: number
}

/** BM25(k1=1.2, b=0.75)の生スコアを計算する */
function bm25Score(
  queryTerms: string[],
  doc: BM25Doc,
  docFreq: Map<string, number>,
  totalDocs: number,
  avgDocLength: number
): number {
  let score = 0
  const uniqueTerms = new Set(queryTerms)
  for (const term of uniqueTerms) {
    const df = docFreq.get(term) ?? 0
    if (df === 0) continue
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1)
    const tf = doc.termCounts.get(term) ?? 0
    if (tf === 0) continue
    const denom =
      tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / avgDocLength)
    score += idf * ((tf * (BM25_K1 + 1)) / denom)
  }
  return score
}

/**
 * 判例コーパスから類似判例上位 N 件を検索する(決定論)。
 * 合成スコア = 0.4*BM25正規化 + 0.3*firedRulesのJaccard
 *            + 0.2*changedPathsのJaccard + 0.1*kind一致
 *            + (source==="project" ? 0.1 : 0)
 * スコア 0 のものは返さない。同点は id の辞書順でタイブレークする。
 */
export function searchPrecedents(
  query: PrecedentQuery,
  corpus: Precedent[],
  topN: number
): PrecedentMatch[] {
  if (corpus.length === 0 || topN <= 0) return []

  const docs: BM25Doc[] = corpus.map((precedent) => {
    const terms = tokenize(precedentDocumentText(precedent))
    const termCounts = new Map<string, number>()
    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1)
    }
    return { precedent, termCounts, length: terms.length }
  })

  const docFreq = new Map<string, number>()
  for (const doc of docs) {
    for (const term of doc.termCounts.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
    }
  }

  const avgDocLength =
    docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1

  const queryTerms = tokenize(
    [query.objective, query.summaryText].filter(Boolean).join(" ")
  )

  const rawScores = docs.map((doc) =>
    bm25Score(queryTerms, doc, docFreq, docs.length, avgDocLength)
  )
  const maxRaw = Math.max(0, ...rawScores)

  const queryFiredRules = new Set(query.firedRules)
  const queryPathDirs = pathDirSet(query.changedPaths)

  const matches: PrecedentMatch[] = docs.map((doc, index) => {
    const bm25Normalized = maxRaw > 0 ? rawScores[index] / maxRaw : 0
    const firedRulesJaccard = jaccard(
      queryFiredRules,
      new Set(doc.precedent.firedRules)
    )
    const changedPathsJaccard = jaccard(
      queryPathDirs,
      pathDirSet(doc.precedent.changedPaths)
    )
    const kindMatch = query.kind === doc.precedent.kind ? 1 : 0
    const projectBoost = doc.precedent.source === "project" ? 1 : 0

    const score =
      WEIGHT_BM25 * bm25Normalized +
      WEIGHT_FIRED_RULES * firedRulesJaccard +
      WEIGHT_CHANGED_PATHS * changedPathsJaccard +
      WEIGHT_KIND * kindMatch +
      PROJECT_SOURCE_BOOST * projectBoost

    return { precedent: doc.precedent, score }
  })

  return matches
    .filter((match) => match.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.precedent.id < b.precedent.id ? -1 : 1
    })
    .slice(0, topN)
}
