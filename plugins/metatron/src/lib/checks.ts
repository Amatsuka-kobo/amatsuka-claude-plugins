// ARCHITECTURE の `json metatron:checks` に書いた検査の定義を読み、LLM を使わずに実行する。
// 定義の書式は references/check-format.md が正本である。
//
// 検査の種類は metatron が用意したものだけを受け付ける。文書に書かれた任意のコマンドは
// 実行しない(文書の編集だけでコマンドを実行できると、ARCHITECTURE が攻撃の入口になる)。

import fs from "node:fs"
import path from "node:path"

export const CHECKS_MARKER = "metatron:checks"

/** 走査するファイル数の上限。超えたら打ち切り、検査は失敗として返す。 */
export const MAX_CHECK_FILES = 20000

const ECMASCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
])

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"])

export interface NoImportCheck {
  id: string
  kind: "no-import"
  from: string[]
  exceptFrom: string[]
  to: string[]
  exceptTo: string[]
  message: string
}

export type CheckDefinition = NoImportCheck

export type ChecksParse =
  | { ok: true; checks: CheckDefinition[] }
  | { ok: false; reason: "block_not_found" | "invalid_checks"; message: string }

// ---------------------------------------------------------------------------
// glob
// ---------------------------------------------------------------------------

const CAPTURE_RE = /^<([A-Za-z][A-Za-z0-9_-]*)>$/

interface CompiledGlob {
  re: RegExp
  names: string[]
}

/** glob が規則に合わないときの理由。合えば null。 */
export function globError(glob: string, allowCaptures: boolean): string | null {
  if (glob === "") return "空の glob は書けません。"
  if (glob.startsWith("/")) return `glob「${glob}」は / で始められません。`
  const segments = glob.split("/")
  if (segments.includes(".."))
    return `glob「${glob}」に .. の区間は書けません。`
  if (segments.some((segment) => segment === "" || segment === ".")) {
    return `glob「${glob}」に空の区間か . の区間があります。`
  }
  const seen = new Set<string>()
  for (const segment of segments) {
    if (!segment.includes("<") && !segment.includes(">")) continue
    const match = CAPTURE_RE.exec(segment)
    if (match === null) {
      return `glob「${glob}」の <名前> は区間の全体を占める必要があります。`
    }
    if (!allowCaptures) return `glob「${glob}」には <名前> を置けません。`
    if (seen.has(match[1])) {
      return `glob「${glob}」に <${match[1]}> が 2 回あります。`
    }
    seen.add(match[1])
  }
  return null
}

function escapeRe(text: string): string {
  return text.replace(/[.+^${}()|[\]\\*?]/g, "\\$&")
}

/**
 * glob を正規表現にする。`*` は区間の一部、`**` は 0 個以上の区間に一致する。
 * 末尾の `/**` は手前のパスそのものにも一致する。`<名前>` は 1 区間を取り出す。
 */
export function compileGlob(glob: string): CompiledGlob {
  const names: string[] = []
  const segments = glob
    .split("/")
    .filter((segment, i, all) => !(segment === "**" && all[i - 1] === "**"))
  let re = ""
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const last = i === segments.length - 1
    if (segment === "**") {
      if (last) {
        re += i === 0 ? ".*" : "(?:/.*)?"
      } else {
        re += i === 0 ? "(?:.*/)?" : "(?:/.*)?/"
      }
      continue
    }
    if (i > 0 && segments[i - 1] !== "**") re += "/"
    const capture = CAPTURE_RE.exec(segment)
    if (capture !== null) {
      names.push(capture[1])
      re += "([^/]+)"
      continue
    }
    re += segment
      .split("")
      .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : escapeRe(c)))
      .join("")
  }
  return { re: new RegExp(`^${re}$`), names }
}

/** `<名前>` を覚えた値に置き換える。値はワイルドカードとして解釈しない。 */
function bindGlob(glob: string, values: Record<string, string>): RegExp {
  const segments = glob.split("/").map((segment) => {
    const capture = CAPTURE_RE.exec(segment)
    return capture === null ? segment : `\u0000${capture[1]}\u0000`
  })
  const compiled = compileGlob(segments.join("/"))
  let source = compiled.re.source
  for (const [name, value] of Object.entries(values)) {
    source = source.split(escapeRe(`\u0000${name}\u0000`)).join(escapeRe(value))
  }
  return new RegExp(source)
}

/** glob の先頭の固定部分(ワイルドカードと `<名前>` の手前まで)。 */
function literalPrefix(glob: string): string {
  const out: string[] = []
  for (const segment of glob.split("/")) {
    if (/[*?<>]/.test(segment)) break
    out.push(segment)
  }
  return out.join("/")
}

// ---------------------------------------------------------------------------
// 定義の読み取り
// ---------------------------------------------------------------------------

function isStringArray(value: unknown, allowEmpty: boolean): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((v) => typeof v === "string")
  )
}

function validateCheck(
  value: unknown,
  index: number,
  ids: Set<string>
): { ok: true; check: CheckDefinition } | { ok: false; message: string } {
  const at = `${String(index + 1)} 件目の検査`
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: `${at}がオブジェクトではありません。` }
  }
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || v.id === "") {
    return { ok: false, message: `${at}の id が空か文字列ではありません。` }
  }
  if (ids.has(v.id)) {
    return { ok: false, message: `id「${v.id}」が重複しています。` }
  }
  ids.add(v.id)
  if (v.kind !== "no-import") {
    return {
      ok: false,
      message: `検査「${v.id}」の kind「${String(v.kind)}」は未知です。使えるのは no-import だけです。`
    }
  }
  if (typeof v.message !== "string" || v.message === "") {
    return { ok: false, message: `検査「${v.id}」の message がありません。` }
  }
  if (!isStringArray(v.from, false) || !isStringArray(v.to, false)) {
    return {
      ok: false,
      message: `検査「${v.id}」の from と to は 1 要素以上の文字列の配列にしてください。`
    }
  }
  for (const key of ["exceptFrom", "exceptTo"] as const) {
    if (v[key] !== undefined && !isStringArray(v[key], true)) {
      return {
        ok: false,
        message: `検査「${v.id}」の ${key} は文字列の配列にしてください。`
      }
    }
  }
  const exceptFrom = (v.exceptFrom as string[] | undefined) ?? []
  const exceptTo = (v.exceptTo as string[] | undefined) ?? []

  let bound: string[] | null = null
  for (const glob of v.from) {
    const error = globError(glob, true)
    if (error !== null)
      return { ok: false, message: `検査「${v.id}」: ${error}` }
    const names = [...compileGlob(glob).names].sort()
    if (bound !== null && bound.join("/") !== names.join("/")) {
      return {
        ok: false,
        message: `検査「${v.id}」の from の各要素は同じ組の <名前> を持つ必要があります。`
      }
    }
    bound = names
  }
  for (const glob of v.to) {
    const error = globError(glob, false)
    if (error !== null)
      return { ok: false, message: `検査「${v.id}」: ${error}` }
  }
  for (const glob of [...exceptFrom, ...exceptTo]) {
    const error = globError(glob, true)
    if (error !== null)
      return { ok: false, message: `検査「${v.id}」: ${error}` }
    for (const name of compileGlob(glob).names) {
      if (!(bound ?? []).includes(name)) {
        return {
          ok: false,
          message: `検査「${v.id}」の <${name}> は from で覚えていません。`
        }
      }
    }
  }
  return {
    ok: true,
    check: {
      id: v.id,
      kind: "no-import",
      from: v.from,
      exceptFrom,
      to: v.to,
      exceptTo,
      message: v.message
    }
  }
}

/** ブロックの中身(JSON 文字列)を検証する。 */
export function parseChecksContent(content: string): ChecksParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return {
      ok: false,
      reason: "invalid_checks",
      message: `\`${CHECKS_MARKER}\` ブロックが有効な JSON ではありません。`
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      ok: false,
      reason: "invalid_checks",
      message: `\`${CHECKS_MARKER}\` のトップレベルは 1 件以上の要素を持つ配列にしてください。`
    }
  }
  const ids = new Set<string>()
  const checks: CheckDefinition[] = []
  for (let i = 0; i < parsed.length; i++) {
    const result = validateCheck(parsed[i], i, ids)
    if (!result.ok) {
      return { ok: false, reason: "invalid_checks", message: result.message }
    }
    checks.push(result.check)
  }
  return { ok: true, checks }
}

// ---------------------------------------------------------------------------
// import の抽出
// ---------------------------------------------------------------------------

export interface ImportSpecifier {
  specifier: string
  line: number
}

// 文の始まり(行頭かセミコロンの後)の import / export から、引用符を挟まずに続く from "x"。
const FROM_RE =
  /(?:^|;)[ \t]*(?:import|export)\b[^"'`;]*?\bfrom\s*(["'])([^"'\n]*)\1/gm
// 文の始まりの import "x"(副作用だけの import)。
const BARE_RE = /(?:^|;)[ \t]*import\s*(["'])([^"'\n]*)\1/gm
// import("x") と require("x")。プロパティ(a.import)は除く。
const CALL_RE = /(?<![.\w$])(?:import|require)\s*\(\s*(["'])([^"'\n]*)\1\s*\)/g

/**
 * 照合用の写しを作る。長さと改行の位置は元のまま保つ。
 * コメントとテンプレートリテラルは空白に、文字列の中身は `x` に置き換える。
 * 指定子は、写しで見つけた位置の元の文字列から取る。
 */
export function maskSource(text: string): string {
  const out = text.split("")
  const blank = (from: number, to: number, fill: string) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = fill
  }
  if (out[0] === "﻿") out[0] = " "
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i)
      const stop = end === -1 ? text.length : end
      blank(i, stop, " ")
      i = stop
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2)
      const stop = end === -1 ? text.length : end + 2
      blank(i, stop, " ")
      i = stop
    } else if (c === "`") {
      let j = i + 1
      while (j < text.length && text[j] !== "`") j += text[j] === "\\" ? 2 : 1
      const stop = Math.min(j + 1, text.length)
      blank(i, stop, " ")
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c && text[j] !== "\n") {
        j += text[j] === "\\" ? 2 : 1
      }
      blank(i + 1, Math.min(j, text.length), "x")
      i = j + 1
    } else {
      i++
    }
  }
  return out.join("")
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** ファイルの全文から import の指定子を取る。 */
export function extractImports(text: string): ImportSpecifier[] {
  const masked = maskSource(text)
  const found = new Map<number, ImportSpecifier>()
  for (const re of [FROM_RE, BARE_RE, CALL_RE]) {
    re.lastIndex = 0
    for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
      // 閉じる引用符の位置から、伏せる前の文字列の中の指定子の位置を求める。
      const close = m.index + m[0].lastIndexOf(m[1])
      const open = close - m[2].length - 1
      const specifier = text.slice(open + 1, close)
      if (!found.has(open)) {
        found.set(open, { specifier, line: lineAt(text, open + 1) })
      }
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

export interface CheckViolation {
  check: string
  file: string
  line: number
  specifier: string
  target: string
  message: string
}

export type ChecksRun =
  | {
      ok: true
      violations: CheckViolation[]
      checked: number
      skipped: number
    }
  | {
      ok: false
      reason: "no_match" | "too_many_files" | "unreadable" | "outside_root"
      message: string
    }

function toPosix(p: string): string {
  return p.split(path.sep).join("/")
}

type WalkResult = "ok" | "too_many" | "unreadable"

/** 開始ディレクトリの下のファイルを、リンクをたどらずに集める。 */
function walk(root: string, start: string, out: string[]): WalkResult {
  const absolute = path.join(root, start)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true })
  } catch {
    return "unreadable"
  }
  for (const entry of entries) {
    const rel = start === "" ? entry.name : `${start}/${entry.name}`
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      const result = walk(root, rel, out)
      if (result !== "ok") return result
    } else if (entry.isFile()) {
      out.push(rel)
      if (out.length > MAX_CHECK_FILES) return "too_many"
    }
  }
  return "ok"
}

function startDirectories(globs: string[]): string[] {
  const prefixes = [...new Set(globs.map(literalPrefix))].sort()
  // 他の開始点の下にある開始点は重ねて走査しない。
  return prefixes.filter(
    (p) => !prefixes.some((q) => q !== p && (q === "" || p.startsWith(`${q}/`)))
  )
}

/** 定義を docRoot の下で実行する。 */
export function runChecks(root: string, checks: CheckDefinition[]): ChecksRun {
  const violations: CheckViolation[] = []
  const checkedFiles = new Set<string>()
  let skipped = 0
  const realRoot = fs.realpathSync(root)
  for (const check of checks) {
    const files: string[] = []
    for (const start of startDirectories(check.from)) {
      const startPath = path.join(root, start)
      let stat: fs.Stats
      try {
        stat = fs.lstatSync(startPath)
      } catch {
        continue
      }
      // 途中の区間のリンクで docRoot の外へ出ていないかを、実体のパスで確かめる。
      let real: string
      try {
        real = fs.realpathSync(startPath)
      } catch {
        // 壊れたリンクなど。開始点として扱わず、一致するファイルが無ければ no_match になる。
        continue
      }
      if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
        return {
          ok: false,
          reason: "outside_root",
          message: `検査「${check.id}」の走査の開始点 ${start} が docRoot の外を指しています。`
        }
      }
      if (stat.isFile()) {
        files.push(start)
        continue
      }
      if (!stat.isDirectory()) continue
      const walked = walk(root, start, files)
      if (walked === "too_many") {
        return {
          ok: false,
          reason: "too_many_files",
          message: `検査「${check.id}」の走査が ${String(MAX_CHECK_FILES)} 件を超えたため打ち切りました。from の glob を固定の接頭辞で絞ってください。`
        }
      }
      if (walked === "unreadable") {
        return {
          ok: false,
          reason: "unreadable",
          message: `検査「${check.id}」の走査で読めないディレクトリがありました。権限を確かめてください。`
        }
      }
    }
    const fromGlobs = check.from.map(compileGlob)
    let readable = 0
    for (const file of files) {
      let values: Record<string, string> | null = null
      for (const glob of fromGlobs) {
        const m = glob.re.exec(file)
        if (m === null) continue
        values = {}
        glob.names.forEach((name, i) => {
          if (values !== null) values[name] = m[i + 1]
        })
        break
      }
      if (values === null) continue
      const bound = values
      if (check.exceptFrom.some((g) => bindGlob(g, bound).test(file))) continue
      if (!ECMASCRIPT_EXTENSIONS.has(path.extname(file))) {
        skipped++
        continue
      }
      let text: string
      try {
        text = fs.readFileSync(path.join(root, file), "utf8")
      } catch {
        return {
          ok: false,
          reason: "unreadable",
          message: `検査「${check.id}」の対象 ${file} を読めませんでした。`
        }
      }
      readable++
      checkedFiles.add(file)
      const toRes = check.to.map((g) => compileGlob(g).re)
      const exceptToRes = check.exceptTo.map((g) => bindGlob(g, bound))
      for (const imp of extractImports(text)) {
        const spec = imp.specifier
        const relative =
          spec === "." ||
          spec === ".." ||
          spec.startsWith("./") ||
          spec.startsWith("../")
        if (!relative) continue
        const target = toPosix(
          path.normalize(path.join(path.dirname(file), imp.specifier))
        )
        if (target === ".." || target.startsWith("../")) continue
        if (!toRes.some((re) => re.test(target))) continue
        if (exceptToRes.some((re) => re.test(target))) continue
        violations.push({
          check: check.id,
          file,
          line: imp.line,
          specifier: imp.specifier,
          target,
          message: check.message
        })
      }
    }
    if (readable === 0) {
      return {
        ok: false,
        reason: "no_match",
        message: `検査「${check.id}」の from に一致する ECMAScript のファイルがありません。glob が古くなっていないか確かめてください。`
      }
    }
  }
  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1
  )
  return { ok: true, violations, checked: checkedFiles.size, skipped }
}
