// 抜き出した行に正規表現の規則を当て、違反の一覧を返す。
// 形態素解析の層は解析器を引数で受け取り、無ければ正規表現の層だけを動かす。
// 編集範囲の特定と、違反を編集範囲で絞る判定もここに置く。ファイルは読まない。

import {
  extractBlocks,
  extractLines,
  hasIgnoreMarker,
  isHtml,
  type Source
} from "./extract.js"
import { checkBlocks } from "./morph.js"
import type { Rule } from "./rules.js"

export interface Violation {
  line: number
  endLine: number
  text: string
  ruleId: string
  category: string
  match: string
  advice: string
}

export interface Analyzer {
  tokenize(text: string): { surface: string; details: string[] }[]
}

// 規則の pattern は g を持たないので、全件を拾うために g を足して作り直す
function matchesOf(rule: Rule, text: string): RegExpMatchArray[] {
  const flags = `${rule.pattern.flags.replace("g", "")}g`
  return [...text.matchAll(new RegExp(rule.pattern.source, flags))]
}

const OPEN_OF: Record<string, string> = { "」": "「", "』": "『" }

// 各字が「」か『』の中にあるかを返す。括弧の字そのものは中に含めない。
// 入れ子を扱い、閉じていない括弧は text の終わりまでを中とみなす
function quotedMask(text: string): boolean[] {
  const open: string[] = []
  return [...text].flatMap((ch) => {
    const close = OPEN_OF[ch]
    const now = open.length > 0 && ch !== "「" && ch !== "『" && !close
    if (ch === "「" || ch === "『") open.push(ch)
    else if (close) {
      const i = open.lastIndexOf(close)
      if (i >= 0) open.length = i
    }
    // 添字を UTF-16 の単位に揃えるため、サロゲートペアの字は 2 つ並べる
    return ch.length === 2 ? [now, now] : [now]
  })
}

// 型の名前や語を「」『』で引いた箇所は違反にしない。一致の全体が括弧の中にあるときだけ除く
function quoted(mask: boolean[], m: RegExpMatchArray): boolean {
  const start = m.index ?? 0
  const end = start + Math.max(m[0].length, 1)
  for (let i = start; i < end; i++) if (!mask[i]) return false
  return true
}

// 「〜」と一致の間に置けない字。空白・句読点・表の区切り・スラッシュ・括弧
const NOT_IN_TYPE_NAME = /[\s、。，．,.!?！？|/()（）[\]「」『』【】]/u

// 「〜することができる」のように、型の名前を「〜」に続けて示した一致か。
// 一致の開始の直前 3 字以内に「〜」があり、その間に区切りの字が無いときに限る
function typeName(text: string, m: RegExpMatchArray): boolean {
  const start = m.index ?? 0
  const before = text.slice(Math.max(0, start - 3), start)
  const at = before.lastIndexOf("〜")
  return at >= 0 && !NOT_IN_TYPE_NAME.test(before.slice(at + 1))
}

function violation(
  rule: Rule,
  m: RegExpMatchArray,
  text: string,
  line: number,
  endLine: number
): Violation {
  return {
    line,
    endLine,
    text,
    ruleId: rule.id,
    category: rule.category,
    match: m[0],
    advice: rule.advice
  }
}

// wholeFile は書き込み後のファイル全体。HTML の正規表現の層と形態素解析の層はこちらに当てる。
// HTML 以外の正規表現の層は、渡された本文(Edit の new_string など)にだけ当てる
export function lint(
  src: Source,
  opts: { rules: Rule[]; analyzer?: Analyzer | null; wholeFile?: Source }
): Violation[] {
  const whole = opts.wholeFile ?? src
  if (hasIgnoreMarker(src) || hasIgnoreMarker(whole)) return []
  const out: Violation[] = []
  if (isHtml(src.path)) {
    // タグや改行をまたぐ文を拾うため、行ではなくブロックに当て、1 字ごとの元の行番号へ戻す
    for (const b of extractBlocks(whole)) {
      const mask = quotedMask(b.text)
      for (const rule of opts.rules) {
        for (const m of matchesOf(rule, b.text)) {
          if (quoted(mask, m) || typeName(b.text, m)) continue
          const start = m.index ?? 0
          const end = start + Math.max(m[0].length, 1) - 1
          out.push(
            violation(
              rule,
              m,
              b.text,
              b.lineOf[start] as number,
              b.lineOf[end] as number
            )
          )
        }
      }
    }
  } else {
    for (const { line, text } of extractLines(src)) {
      const mask = quotedMask(text)
      for (const rule of opts.rules) {
        for (const m of matchesOf(rule, text))
          if (!quoted(mask, m) && !typeName(text, m))
            out.push(violation(rule, m, text, line, line))
      }
    }
  }
  // 断片だけでは文の区切りも文末の連続も決まらないので、HTML 以外でも書き込み後のファイル全体から段落を組む。
  // 編集範囲での絞り込みは呼び出し側が findEditRanges と overlaps で行う
  if (opts.analyzer)
    out.push(...checkBlocks(extractBlocks(whole), opts.analyzer))
  return out
}

// 各本文を書き込み後のファイルの中から探し、見つかった位置の最初の行から最後の行までを返す。
// 末尾の改行は、その改行を含む行に数える
// ponytail: 同じ本文がファイルに複数あるときは最初の位置だけを使うので、
// 2 か所目以降を編集した場合は範囲がずれる。問題になったら編集前のファイルとの差分で範囲を決める
export function findEditRanges(
  fileText: string,
  bodies: string[]
): ({ start: number; end: number } | null)[] {
  const newlines = (s: string) => s.split("\n").length - 1
  return bodies.map((body) => {
    const at = body === "" ? -1 : fileText.indexOf(body)
    if (at < 0) return null
    const start = newlines(fileText.slice(0, at)) + 1
    return { start, end: start + newlines(body.replace(/\n$/, "")) }
  })
}

export function overlaps(
  v: Violation,
  ranges: { start: number; end: number }[]
): boolean {
  return ranges.some((r) => v.line <= r.end && r.start <= v.endLine)
}
