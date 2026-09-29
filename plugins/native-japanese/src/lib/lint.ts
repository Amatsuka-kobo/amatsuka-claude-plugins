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
      for (const rule of opts.rules) {
        for (const m of matchesOf(rule, b.text)) {
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
      for (const rule of opts.rules) {
        for (const m of matchesOf(rule, text))
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
