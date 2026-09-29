// 段落(ブロック)を文に分け、形態素の並びから 4 つの文の規則を判定する。
// 解析器は引数で受け取り、ファイルは読まない。
// lindera の details の添字と、活用型・活用形の名前の付け替えはこのファイルの中だけで行う。

import type { Block } from "./extract.js"
import type { Analyzer, Violation } from "./lint.js"

// --- 閾値と語の一覧。基準値(設計書のセクション 6-3)を見て調整する ---

// muse-shugo: 命題を目的語にとる述語の原形
const MUSE_PREDICATES = new Set([
  "示す",
  "意味する",
  "物語る",
  "裏付ける",
  "示唆する"
])
// muse-shugo: 主語がこれらなら当てない代名詞の表層
const PRONOUNS = new Set(["私", "僕", "我々", "彼", "彼女", "あなた"])
// bunmatsu-renzoku: 同じ文末表現がこの文数だけ続いたら、その文で 1 件を出す
const RUN_LENGTH = 4
// bunmatsu-renzoku: これより短い文末表現は連続を切る
const MIN_ENDING_LENGTH = 2
// bun-nagasa: 文の字数(空白と文末の句点を除く)と、読点の付いた節の切れ目の数
const LONG_SENTENCE = 100
const MIN_CLAUSE_CUTS = 2
// rentai-kasanari: 区間の字数と、区間の中の修飾の節の数
const MIN_SEGMENT_LENGTH = 30
const MIN_MODIFIER_CLAUSES = 2
// rentai-kasanari: 修飾される名詞がこれらなら、節を名詞にする働きか時や条件の副詞なので数えない
const NOT_MODIFIED = new Set(
  "こと もの の とき 時 際 ため よう ところ 場合 後 前 間 うち まま".split(" ")
)
// 違反の match に入れる、文の先頭の字数
const MATCH_LENGTH = 20

const TERMINATORS = new Set(["。", "！", "？"])

const RULES = {
  "muse-shugo": {
    category: "翻訳調",
    advice:
      "「〜から、〜と分かる」のように、読み手が読み取る形に言い換える。元の文の確信度は変えない"
  },
  "bunmatsu-renzoku": {
    category: "文",
    advice: "4 文目の文末の形を変えるか、隣の文とつなぐ"
  },
  "bun-nagasa": {
    category: "文",
    advice: "節の切れ目で文を分ける。分けた後も主語と必要な事実を残す"
  },
  "rentai-kasanari": {
    category: "文",
    advice: "修飾の節を 1 つ残し、残りは前の文に出す。時系列か因果の順に並べる"
  }
} as const
type RuleId = keyof typeof RULES

export interface Token {
  surface: string
  pos: string
  pos1: string
  pos2: string
  conjType: string
  conjForm: string
  base: string
}

// lindera は details[4] を conjugation_form、details[5] を conjugation_type と呼ぶが、
// 中身は逆で、details[4] が活用型、details[5] が活用形である(GOTCHA-003)。名前ではなく添字で読む
export function toToken(raw: { surface: string; details: string[] }): Token {
  const d = raw.details
  return {
    surface: raw.surface,
    pos: d[0] ?? "",
    pos1: d[1] ?? "",
    pos2: d[2] ?? "",
    conjType: d[4] ?? "",
    conjForm: d[5] ?? "",
    base: d[6] ?? ""
  }
}

// 「。」「！」「？」の直後で区切り、区切りが無ければ終わりまでを 1 文とする。
// 返す範囲は先頭の空白を除き、end は含まない。空白だけの残りは文にしない
export function splitSentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let start = 0
  const push = (end: number) => {
    const s = text.slice(start, end)
    const lead = s.length - s.trimStart().length
    if (s.trim() !== "") out.push({ start: start + lead, end })
    start = end
  }
  for (let i = 0; i < text.length; i++)
    if (TERMINATORS.has(text[i] as string)) push(i + 1)
  push(text.length)
  return out
}

interface Sentence {
  start: number
  end: number
  tokens: Token[]
}

// 段落をまとめて解析し、各形態素を始まりの位置で文に振り分ける
function sentencesOf(text: string, analyzer: Analyzer): Sentence[] {
  const sentences = splitSentences(text).map((r) => ({
    ...r,
    tokens: [] as Token[]
  }))
  let at = 0
  let k = 0
  for (const raw of analyzer.tokenize(text)) {
    const i = text.indexOf(raw.surface, at)
    const pos = i < 0 ? at : i
    at = pos + raw.surface.length
    while (k < sentences.length - 1 && pos >= (sentences[k] as Sentence).end)
      k++
    sentences[k]?.tokens.push(toToken(raw))
  }
  return sentences
}

const isVerbLike = (t: Token) =>
  t.pos === "動詞" || t.pos === "形容詞" || t.pos === "助動詞"

// 文末表現を作る形態素。助動詞・助詞・非自立の動詞・接尾の動詞・非自立の名詞
function isEndingPart(t: Token): boolean {
  if (t.pos === "助動詞" || t.pos === "助詞") return true
  if (t.pos === "動詞") return t.pos1 === "非自立" || t.pos1 === "接尾"
  return t.pos === "名詞" && t.pos1 === "非自立"
}

// 文末の記号を除いた後、文末表現の形態素を除いた範囲の終わり(この位置より前が文末表現の外)
function endingStart(ts: Token[]): { stop: number; last: number } {
  let last = ts.length
  while (last > 0 && (ts[last - 1] as Token).pos === "記号") last--
  let stop = last
  while (stop > 0 && isEndingPart(ts[stop - 1] as Token)) stop--
  return { stop, last }
}

function endingOf(ts: Token[]): string {
  const { stop, last } = endingStart(ts)
  return ts
    .slice(stop, last)
    .map((t) => t.surface)
    .join("")
}

const len = (s: string) => [...s.replace(/\s/g, "")].length

// 係助詞か格助詞の「は」「が」で受けた名詞がある、「こと」「の」を「を」で受けた「示す」系の述語で終わる文。
// 述語に最も近い「は」の直前が代名詞か人名なら当てない
function museShugo(ts: Token[]): boolean {
  const core = endingStart(ts).stop - 1
  const verb = ts[core]
  if (verb?.pos !== "動詞" || verb.pos1 !== "自立") return false
  // サ変接続の名詞の直後の「する」は、2 つを合わせて 1 語の述語とみなす
  const noun = ts[core - 1]
  const sahen = verb.base === "する" && noun?.pos1 === "サ変接続"
  const base = sahen ? `${noun.surface}する` : verb.base
  const head = sahen ? core - 1 : core
  if (!MUSE_PREDICATES.has(base)) return false
  const wo = ts[head - 1]
  const koto = ts[head - 2]
  if (wo?.surface !== "を" || wo.pos1 !== "格助詞") return false
  if (
    !koto ||
    (koto.surface !== "こと" && koto.surface !== "の") ||
    koto.pos !== "名詞" ||
    koto.pos1 !== "非自立"
  )
    return false
  const topicAt = (j: number) => {
    const t = ts[j] as Token
    return (
      (t.surface === "は" || t.surface === "が") &&
      t.pos === "助詞" &&
      (t.pos1 === "係助詞" || t.pos1 === "格助詞") &&
      ts[j - 1]?.pos === "名詞"
    )
  }
  let hasSubject = false
  let nearestWa = -1
  for (let j = 1; j < head - 2; j++) {
    if (!topicAt(j)) continue
    hasSubject = true
    if ((ts[j] as Token).surface === "は") nearestWa = j
  }
  if (!hasSubject) return false
  if (nearestWa < 0) return true
  const subj = ts[nearestWa - 1] as Token
  const person =
    subj.pos1 === "代名詞" ||
    PRONOUNS.has(subj.surface) ||
    (subj.pos1 === "固有名詞" && subj.pos2 === "人名")
  return !person
}

// 読点の直前が接続助詞か、動詞・形容詞・助動詞の連用形である箇所を数える
function clauseCuts(ts: Token[]): number {
  let n = 0
  for (let k = 1; k < ts.length; k++) {
    const t = ts[k] as Token
    if (t.pos !== "記号" || t.pos1 !== "読点") continue
    const p = ts[k - 1] as Token
    if (
      (p.pos === "助詞" && p.pos1 === "接続助詞") ||
      (isVerbLike(p) &&
        (p.conjForm === "連用形" || p.conjForm === "連用テ接続"))
    )
      n++
  }
  return n
}

// 動詞・形容詞・助動詞の基本形か体言接続の直後に名詞(接頭詞を含む)が来る箇所を数える
function modifierClauses(seg: Token[]): number {
  let n = 0
  for (let m = 0; m < seg.length; m++) {
    const t = seg[m] as Token
    if (!isVerbLike(t)) continue
    if (t.conjForm !== "基本形" && t.conjForm !== "体言接続") continue
    // 形容動詞の語幹に「な」が続く形は 1 語の形容なので、節に数えない
    const prev = seg[m - 1]
    if (
      t.pos === "助動詞" &&
      prev &&
      (prev.pos1 === "形容動詞語幹" || prev.pos2 === "形容動詞語幹")
    )
      continue
    let next = seg[m + 1]
    if (next?.pos === "接頭詞") next = seg[m + 2]
    if (next?.pos !== "名詞") continue
    if (NOT_MODIFIED.has(next.surface)) continue
    if (["接尾", "代名詞", "数"].includes(next.pos1)) continue
    n++
  }
  return n
}

// 読点・句点・係助詞「は」で区切った区間のどれかが、長さと節の数の閾値をともに超えるか
function rentaiKasanari(ts: Token[]): boolean {
  const segs: Token[][] = [[]]
  for (const t of ts) {
    const cut =
      (t.pos === "記号" && (t.pos1 === "読点" || t.pos1 === "句点")) ||
      (t.surface === "は" && t.pos === "助詞" && t.pos1 === "係助詞")
    if (cut) segs.push([])
    else segs.at(-1)?.push(t)
  }
  return segs.some(
    (seg) =>
      modifierClauses(seg) >= MIN_MODIFIER_CLAUSES &&
      len(seg.map((t) => t.surface).join("")) >= MIN_SEGMENT_LENGTH
  )
}

// 2 字以上の同じ文末表現が RUN_LENGTH 文続いたとき、その文の添字を返す。同じ連続からは 1 つだけ
function runEnds(sentences: Sentence[]): Set<number> {
  const hits = new Set<number>()
  let prev: string | null = null
  let count = 0
  sentences.forEach((s, i) => {
    const e = endingOf(s.tokens)
    if ([...e].length < MIN_ENDING_LENGTH) {
      prev = null
      count = 0
      return
    }
    count = e === prev ? count + 1 : 1
    prev = e
    if (count === RUN_LENGTH) hits.add(i)
  })
  return hits
}

// 見出しと表の行は形態素解析の規則にかけない
const checked = (b: Block) => b.kind !== "heading" && b.kind !== "table"

// 形態素解析の規則にかける文の、始まる行と終わる行。測定 CLI が文の数を数えるのに使う
export function sentenceLines(
  blocks: Block[]
): { line: number; endLine: number }[] {
  return blocks.filter(checked).flatMap((b) =>
    splitSentences(b.text).map((s) => ({
      line: b.lineOf[s.start] as number,
      endLine: b.lineOf[s.end - 1] as number
    }))
  )
}

export function checkBlocks(blocks: Block[], analyzer: Analyzer): Violation[] {
  const out: Violation[] = []
  for (const b of blocks) {
    if (!checked(b)) continue
    const sentences = sentencesOf(b.text, analyzer)
    // リストは並列に書くのが正しい形なので、文末の連続を当てない
    const runs = b.kind === "list" ? new Set<number>() : runEnds(sentences)
    sentences.forEach((s, i) => {
      const text = b.text.slice(s.start, s.end)
      const hit = (id: RuleId) =>
        out.push({
          line: b.lineOf[s.start] as number,
          endLine: b.lineOf[s.end - 1] as number,
          text,
          ruleId: id,
          ...RULES[id],
          match: [...text].slice(0, MATCH_LENGTH).join("")
        })
      if (museShugo(s.tokens)) hit("muse-shugo")
      if (runs.has(i)) hit("bunmatsu-renzoku")
      const body = TERMINATORS.has(text.at(-1) as string)
        ? text.slice(0, -1)
        : text
      if (len(body) >= LONG_SENTENCE && clauseCuts(s.tokens) >= MIN_CLAUSE_CUTS)
        hit("bun-nagasa")
      if (rentaiKasanari(s.tokens)) hit("rentai-kasanari")
    })
  }
  return out
}
