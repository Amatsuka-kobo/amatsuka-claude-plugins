/**
 * code/new-dependency — 依存パッケージの追加の検出(既定 ask)。設計書 §6.4.2(A10)。
 * package.json は dependencies・devDependencies・peerDependencies・optionalDependencies の
 * ブロックの内側だけを見る。どのマニフェストも削除行と名前を突き合わせ、新しい名前だけを数える。
 * .gitmodules の追加と、submodule(mode 160000)の参照先の変更も依存として数える。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"
import { type DetailedDiffFile, parseDiff } from "./diffParse.js"

const RULE_ID = "code/new-dependency"

type ManifestKind =
  | "npm-package"
  | "npm-lock"
  | "requirements"
  | "cargo"
  | "gomod"
  | "gitmodules"

function manifestKind(path: string): ManifestKind | null {
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (base === "package.json") return "npm-package"
  if (
    base === "pnpm-lock.yaml" ||
    base === "package-lock.json" ||
    base === "yarn.lock"
  ) {
    return "npm-lock"
  }
  if (base === "requirements.txt") return "requirements"
  if (base === "Cargo.toml") return "cargo"
  if (base === "go.mod") return "gomod"
  if (base === ".gitmodules") return "gitmodules"
  return null
}

// Cargo.toml の [package] で依存を意味しないキー
const CARGO_NON_DEPENDENCY_KEYS = new Set([
  "name",
  "version",
  "edition",
  "description",
  "authors",
  "license",
  "repository",
  "readme",
  "keywords",
  "categories",
  "publish",
  "rust-version",
  "documentation",
  "homepage"
])

/** package.json 以外のマニフェストの行から依存の名前を取る。依存の行でなければ null */
function dependencyName(kind: ManifestKind, line: string): string | null {
  switch (kind) {
    case "npm-lock": {
      // pnpm-lock: "  lodash@4.17.21:"、yarn.lock: "lodash@^1.0.0:"
      const m = line.match(
        /^\s*['"]?\/?((?:@[\w.-]+\/)?[\w.-]+)@[\w^~.>=<, |:-]+['"]?:\s*$/
      )
      return m ? m[1] : null
    }
    case "requirements": {
      const t = line.trim()
      if (t === "" || t.startsWith("#")) return null
      return t.match(/^[A-Za-z0-9_.-]+/)?.[0].toLowerCase() ?? null
    }
    case "cargo": {
      const m = line.match(/^\s*([\w-]+)\s*=/)
      return m && !CARGO_NON_DEPENDENCY_KEYS.has(m[1]) ? m[1] : null
    }
    case "gomod":
      return (
        line.match(/^\s*(?:require\s+)?([\w.\-/]+)\s+v\d+\.\d+\.\d+/)?.[1] ??
        null
      )
    case "gitmodules":
      return line.match(/^\s*\[submodule\s+"([^"]+)"\]/)?.[1] ?? null
    default:
      return null
  }
}

const NPM_DEPENDENCY_BLOCKS = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
])

// ブロックの見出しが hunk の外にあるとき、トップレベルのキーを依存と取り違えないための除外
const NPM_TOP_LEVEL_KEYS = new Set([
  "name",
  "version",
  "description",
  "main",
  "module",
  "types",
  "license",
  "author",
  "homepage",
  "packageManager",
  "type"
])

const ENTRY_RE = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/
const OPEN_RE = /^\s*"([^"]+)"\s*:\s*\{\s*$/
const VERSION_LIKE_RE =
  /^([\^~<>=*]|\d|workspace:|npm:|file:|link:|git\+|github:|https?:|latest$|next$)/

interface Added {
  name: string
  index: number
}

/**
 * package.json の hunk を読み、依存のブロックの中で追加された名前を返す。
 * hunk の中に見出し(`"dependencies": {`)があればそれで決め、無ければ値が版の指定に見えるかで決める。
 * ponytail: hunk の外の見出しは読まない。誤りが目立つならファイルを HEAD から読んでブロックを決める
 */
function npmAdded(file: DetailedDiffFile): Added[] {
  const added: Added[] = []
  let addIndex = 0
  for (const hunk of file.hunks) {
    // null は hunk の外で開いたブロック(何のブロックか分からない)
    const stack: (string | null)[] = [null]
    for (const raw of hunk) {
      const mark = raw[0]
      if (mark === "-" || mark === "\\") continue
      const text = raw.slice(1)
      const isAdd = mark === "+"
      const open = text.match(OPEN_RE)
      if (open) stack.push(open[1])
      else if (/^\s*\{\s*$/.test(text)) stack.push("")
      else if (/^\s*\}/.test(text)) {
        if (stack.length > 1) stack.pop()
      } else if (isAdd) {
        const entry = text.match(ENTRY_RE)
        const block = stack[stack.length - 1]
        const isDependency =
          entry !== null &&
          (block === null
            ? !NPM_TOP_LEVEL_KEYS.has(entry[1]) &&
              VERSION_LIKE_RE.test(entry[2])
            : NPM_DEPENDENCY_BLOCKS.has(block))
        if (entry && isDependency)
          added.push({ name: entry[1], index: addIndex })
      }
      if (isAdd) addIndex++
    }
  }
  return added
}

function addedNames(kind: ManifestKind, file: DetailedDiffFile): Added[] {
  if (kind === "npm-package") return npmAdded(file)
  const added: Added[] = []
  file.additions.forEach((line, index) => {
    const name = dependencyName(kind, line)
    if (name) added.push({ name, index })
  })
  return added
}

function deletedNames(kind: ManifestKind, file: DetailedDiffFile): Set<string> {
  return new Set(
    file.deletions
      .map((line) =>
        kind === "npm-package"
          ? (line.match(ENTRY_RE)?.[1] ?? null)
          : dependencyName(kind, line)
      )
      .filter((n): n is string => n !== null)
  )
}

const SUBPROJECT_RE = /^Subproject commit [0-9a-f]+$/

/** mode 160000 のパスの参照先の変更(Subproject commit 行の置き換え)か。追加だけの行は .gitmodules 側で数える */
function isSubmoduleUpdate(file: DetailedDiffFile): boolean {
  return (
    file.additions.some((l) => SUBPROJECT_RE.test(l)) &&
    file.deletions.some((l) => SUBPROJECT_RE.test(l))
  )
}

export const newDependencyRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")
    const findings: Finding[] = []

    for (const file of parseDiff(artifact.content).files) {
      if (isSubmoduleUpdate(file)) {
        const index = file.additions.findIndex((l) => SUBPROJECT_RE.test(l))
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `依存パッケージの追加を検出しました: ${file.path}(${file.path})`,
          evidence: {
            location: file.path,
            path: file.path,
            line: file.additionLines[index],
            excerpt: truncateExcerpt(file.additions[index])
          }
        })
        continue
      }
      const kind = manifestKind(file.path)
      if (!kind) continue
      const deleted = deletedNames(kind, file)
      for (const { name, index } of addedNames(kind, file)) {
        if (deleted.has(name)) continue
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `依存パッケージの追加を検出しました: ${file.path}(${name})`,
          evidence: {
            location: file.path,
            path: file.path,
            line: file.additionLines[index],
            excerpt: truncateExcerpt(file.additions[index])
          }
        })
      }
    }

    return findings
  }
}
