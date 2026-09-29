// パスと本文から、正規表現の層にかける行と、形態素解析の層にかける段落(ブロック)を抜き出す。
// ファイルは読まない。

import path from "node:path"

export type BlockKind = "prose" | "list" | "comment" | "heading" | "table"

// lineOf[i] は text の i 字目(UTF-16 の単位)の元の行番号で、1 始まり
export interface Block {
  kind: BlockKind
  text: string
  lineOf: number[]
}

export interface Source {
  path: string
  text: string
  cellType?: "markdown" | "code"
}

type Lang = "markdown" | "html" | "slash" | "hash" | "python" | "dash" | "cell"

const LANG_OF_EXT: Record<string, Lang> = {}
for (const [lang, exts] of [
  ["markdown", ".md .mdx .markdown .txt"],
  ["html", ".html .htm"],
  [
    "slash",
    ".ts .tsx .js .mjs .cjs .jsx .java .kt .go .rs .c .h .cpp .cs .swift .dart .scala"
  ],
  ["hash", ".sh .bash .zsh .rb .yaml .yml .toml .r .pl"],
  ["python", ".py"],
  ["dash", ".sql .lua .hs"]
] as const) {
  for (const ext of exts.split(" ")) LANG_OF_EXT[ext] = lang
}

const KANA = /[ぁ-ゟ゠-ヿ]/
// インラインコードと URL の置き換え先。全角にして、行をつなぐときに ASCII として扱われないようにする。
// 名詞として解析されるかは、形態素解析の層のテストで確かめる
const PLACEHOLDER = "Ｘ"
const INLINE_CODE = /(`+)[^`]+\1/g
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+/g
const MARKER = "native-japanese: ignore-file"
const MD_MARKER = `<!-- ${MARKER} -->`
const CODE_MARKER: Record<string, RegExp> = {
  slash: new RegExp(`^(?://\\s*${MARKER}|/\\*\\s*${MARKER}\\s*\\*/)$`),
  hash: new RegExp(`^#\\s*${MARKER}$`),
  python: new RegExp(`^#\\s*${MARKER}$`),
  dash: new RegExp(`^--\\s*${MARKER}$`),
  cell: new RegExp(`^(?://|#)\\s*${MARKER}$`)
}

export function isHtml(p: string): boolean {
  return langOf({ path: p, text: "" }) === "html"
}

function langOf(src: Source): Lang | null {
  if (src.cellType) return src.cellType === "markdown" ? "markdown" : "cell"
  return LANG_OF_EXT[path.extname(src.path).toLowerCase()] ?? null
}

function splitLines(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/\r$/, ""))
}

// 各行がコードフェンス(開閉の行を含む)の中にあるかを返す
function fenceMask(lines: string[]): boolean[] {
  let fence: string | null = null
  return lines.map((l) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(l)
    if (fence === null) {
      if (m) fence = m[1] as string
      return m !== null
    }
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`)
    if (close.test(l)) fence = null
    return true
  })
}

// 各行のコメントの中身を返す。コメントの無い行は null。
// 文字列リテラルの中の // や # もコメントとみなす(設計書のセクション 4-3 が認める簡易判定)
function commentsOf(lines: string[], lang: Lang): (string | null)[] {
  let inBlock = false // /* */ の中
  let triple: string | null = null // Python の三重引用符の中
  return lines.map((line) => {
    if (lang === "slash") {
      // Edit の断片が JSDoc の途中から始まることがあるので、* で始まる行はその行だけコメントとみなす
      if (!inBlock && /^\s*\*/.test(line)) {
        const e = line.indexOf("*/")
        return e < 0 ? line : line.slice(0, e)
      }
      const parts: string[] = []
      let rest = line
      let found = false
      for (;;) {
        if (inBlock) {
          found = true
          const e = rest.indexOf("*/")
          if (e < 0) {
            parts.push(rest)
            break
          }
          parts.push(rest.slice(0, e))
          rest = rest.slice(e + 2)
          inBlock = false
          continue
        }
        const s = rest.indexOf("/*")
        const d = rest.indexOf("//")
        if (d >= 0 && (s < 0 || d < s)) {
          parts.push(rest.slice(d + 2))
          return parts.join(" ")
        }
        if (s < 0) break
        inBlock = true
        rest = rest.slice(s + 2)
      }
      return found ? parts.join(" ") : null
    }
    if (lang === "python") {
      if (triple !== null) {
        const e = line.indexOf(triple)
        if (e < 0) return line
        triple = null
        return line.slice(0, e)
      }
      const m = /#|"""|'''/.exec(line)
      if (!m) return null
      const rest = line.slice(m.index + m[0].length)
      if (m[0] === "#") return rest
      const e = rest.indexOf(m[0])
      if (e >= 0) return rest.slice(0, e)
      triple = m[0]
      return rest
    }
    const m = { hash: /#/, dash: /--/, cell: /\/\/|#/ }[
      lang as "hash" | "dash" | "cell"
    ].exec(line)
    return m ? line.slice(m.index + m[0].length) : null
  })
}

function cleanComment(c: string): string {
  return c.replace(/^[\s*/!#-]+/, "").trimEnd()
}

function toNoun(s: string): string {
  return s.replace(INLINE_CODE, PLACEHOLDER).replace(URL_RE, PLACEHOLDER)
}

export function extractLines(src: Source): { line: number; text: string }[] {
  const lang = langOf(src)
  if (lang === null || lang === "html") return []
  const lines = splitLines(src.text)
  const out: { line: number; text: string }[] = []
  if (lang === "markdown") {
    const fenced = fenceMask(lines)
    lines.forEach((l, i) => {
      if (fenced[i]) return
      const text = l.replace(INLINE_CODE, (m) => " ".repeat(m.length))
      if (KANA.test(text)) out.push({ line: i + 1, text })
    })
    return out
  }
  commentsOf(lines, lang).forEach((c, i) => {
    if (c === null) return
    // 設計書はインラインコードの空白化を Markdown にだけ書くが、コメントで語を引用しても違反にしないよう揃える
    const text = cleanComment(c).replace(INLINE_CODE, (m) =>
      " ".repeat(m.length)
    )
    if (KANA.test(text)) out.push({ line: i + 1, text })
  })
  return out
}

export function extractBlocks(src: Source): Block[] {
  const lang = langOf(src)
  if (lang === null) return []
  const lines = splitLines(src.text)
  const blocks =
    lang === "html"
      ? htmlBlocks(src.text)
      : lang === "markdown"
        ? markdownBlocks(lines)
        : commentBlocks(lines, lang)
  return blocks.filter((b) => KANA.test(b.text))
}

// 1 字ずつ行番号を付けながら本文をためる。push した字はすべて line の行に置く
class Buf {
  text = ""
  lineOf: number[] = []
  constructor(public kind: BlockKind) {}
  push(s: string, line: number): void {
    this.text += s
    for (let i = 0; i < s.length; i++) this.lineOf.push(line)
  }
}

// 改行とその前後の空白を、前後がどちらも ASCII 以外の文字なら取り除き、それ以外なら空白 1 つにする。
// 日本語の文を途中で折り返した行を 1 つの文としてつなぐ。前後の空白も落とす
function finish(buf: Buf): Block {
  const { text, lineOf } = buf
  let out = ""
  const lo: number[] = []
  const run = /[ \t\r]*\n[ \t\r\n]*/g
  let at = 0
  const copy = (end: number) => {
    out += text.slice(at, end)
    lo.push(...lineOf.slice(at, end))
  }
  for (const m of text.matchAll(run)) {
    copy(m.index)
    at = m.index + m[0].length
    const prev = out.at(-1)
    const next = text[at]
    if (prev === undefined || next === undefined) continue
    if (prev.charCodeAt(0) > 0x7f && next.charCodeAt(0) > 0x7f) continue
    out += " "
    lo.push(lo.at(-1) as number)
  }
  copy(text.length)
  const start = out.length - out.trimStart().length
  const end = out.trimEnd().length
  return {
    kind: buf.kind,
    text: out.slice(start, end),
    lineOf: lo.slice(start, end)
  }
}

const MD_HEADING = /^\s{0,3}#{1,6}(?:\s+|$)/
const MD_TABLE = /^\s*\|/
const MD_LIST = /^\s*(?:[-*+]|\d+[.)])\s+/
const MD_QUOTE = /^\s*(?:>\s?)+/

// 地の文は空行・見出し・リスト・表・コードフェンスで区切り、リストは項目ごと(継続行を含む)にまとめる。
// 見出しと表は 1 行ずつ 1 ブロックにする
function markdownBlocks(lines: string[]): Block[] {
  const fenced = fenceMask(lines)
  const blocks: Block[] = []
  let cur: Buf | null = null
  for (const [i, l] of lines.entries()) {
    const line = i + 1
    const heading = MD_HEADING.exec(l)
    const list = MD_LIST.exec(l)
    const body = toNoun(l.replace(MD_QUOTE, ""))
    if (
      cur &&
      (fenced[i] || l.trim() === "" || heading || list || MD_TABLE.test(l))
    ) {
      blocks.push(finish(cur))
      cur = null
    }
    if (fenced[i] || l.trim() === "") continue
    if (heading || MD_TABLE.test(l)) {
      const b = new Buf(heading ? "heading" : "table")
      b.push(toNoun(heading ? l.slice(heading[0].length) : l), line)
      blocks.push(finish(b))
    } else if (list) {
      cur = new Buf("list")
      cur.push(toNoun(l.slice(list[0].length)), line)
    } else if (cur) {
      cur.push("\n", line)
      cur.push(body, line)
    } else {
      cur = new Buf("prose")
      cur.push(body, line)
    }
  }
  if (cur) blocks.push(finish(cur))
  return blocks
}

// 連続するコメント行を 1 段落にする。コードの行と中身の空いたコメント行で区切る
function commentBlocks(lines: string[], lang: Lang): Block[] {
  const blocks: Block[] = []
  let cur: Buf | null = null
  commentsOf(lines, lang).forEach((c, i) => {
    const text = c === null ? "" : cleanComment(c)
    if (text === "") {
      if (cur) blocks.push(finish(cur))
      cur = null
      return
    }
    if (cur) cur.push("\n", i + 1)
    else cur = new Buf("comment")
    cur.push(toNoun(text), i + 1)
  })
  if (cur) blocks.push(finish(cur))
  return blocks
}

const HTML_BLOCK_KIND: Record<string, BlockKind> = {
  li: "list",
  dt: "list",
  dd: "list",
  td: "table",
  th: "table"
}
for (const t of "p div section article header footer blockquote figcaption".split(
  " "
))
  HTML_BLOCK_KIND[t] = "prose"
for (let n = 1; n <= 6; n++) HTML_BLOCK_KIND[`h${n}`] = "heading"

const HTML_ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " "
}

// 1: 中身ごと消す要素の名前 2: タグの名前 3: 16 進の文字参照 4: 10 進の文字参照 5: 戻す名前付きの実体参照
const HTML_TOKEN =
  /<!--[\s\S]*?-->|<(script|style|pre|code|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?([a-zA-Z][\w-]*)[^>]*>|<![^>]*>|&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|nbsp));/gi

// ponytail: 正規表現で抜き出すので、閉じタグの抜けた壊れた HTML ではブロックの区切りと種類がずれる。
// 属性値の中の > やタグの入れ子の誤りも拾い違える。
// パーサーを使わないのは、npm の依存を増やさない制約(設計書のセクション 3-3)があり、
// 手で書く文書の HTML なら正規表現の簡易な区切りで足りるためである。
// 誤検知や取りこぼしが問題になったら、HTML パーサーに置き換える。
function htmlBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // 開いているブロック要素。閉じタグで同じ名前まで戻る
  const stack: { name: string; kind: BlockKind }[] = []
  const kindNow = () => stack.at(-1)?.kind ?? "prose"
  let buf = new Buf("prose")
  let line = 1
  let at = 0
  const flush = () => {
    if (buf.text !== "") blocks.push(finish(buf))
    buf = new Buf(kindNow())
  }
  const emit = (s: string) => {
    for (const ch of s) {
      buf.push(ch, line)
      if (ch === "\n") line++
    }
  }
  const skip = (s: string) => {
    for (const ch of s) if (ch === "\n") line++
  }
  for (const m of text.matchAll(HTML_TOKEN)) {
    emit(text.slice(at, m.index))
    at = m.index + m[0].length
    const [whole, dropped, tag, hex, dec, named] = m
    if (dropped !== undefined) {
      // ブロックの途中の <code> は、前後の語がつながらないよう 1 字に置き換える
      if (dropped.toLowerCase() === "code") buf.push(PLACEHOLDER, line)
      skip(whole)
    } else if (tag !== undefined) {
      const name = tag.toLowerCase()
      const kind = HTML_BLOCK_KIND[name]
      if (name === "br") flush()
      else if (kind !== undefined) {
        flush()
        if (!whole.startsWith("</")) {
          if (!whole.endsWith("/>")) stack.push({ name, kind })
        } else {
          const i = stack.findLastIndex((e) => e.name === name)
          if (i >= 0) stack.length = i
        }
        buf.kind = kindNow()
      }
      skip(whole)
    } else if (hex !== undefined || dec !== undefined) {
      const cp = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec)
      emit(cp <= 0x10ffff ? String.fromCodePoint(cp) : whole)
    } else if (named !== undefined) {
      emit(HTML_ENTITY[named.toLowerCase()] as string)
    } else skip(whole)
  }
  emit(text.slice(at))
  flush()
  return blocks
}

export function hasIgnoreMarker(src: Source): boolean {
  const lang = langOf(src)
  if (lang === null) return false
  const lines = splitLines(src.text)
  if (lang === "markdown" || lang === "html") {
    const fenced = lang === "markdown" ? fenceMask(lines) : []
    return lines.some((l, i) => !fenced[i] && l.trim() === MD_MARKER)
  }
  const re = CODE_MARKER[lang] as RegExp
  return lines.some((l) => re.test(l.trim()))
}
