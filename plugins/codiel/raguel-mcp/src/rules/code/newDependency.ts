/**
 * code/new-dependency — 依存パッケージ追加の検出(既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"
import { parseDiff } from "./diffParse.js"

const RULE_ID = "code/new-dependency"

type ManifestKind =
  | "npm-package"
  | "npm-lock"
  | "requirements"
  | "cargo"
  | "gomod"

function manifestKind(path: string): ManifestKind | null {
  const base = path.split("/").pop() ?? path
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
  return null
}

// package.json のトップレベルで依存を意味しないキー
const NPM_NON_DEPENDENCY_KEYS = new Set([
  "name",
  "version",
  "description",
  "main",
  "module",
  "types",
  "scripts",
  "license",
  "author",
  "repository",
  "engines",
  "private",
  "type",
  "keywords",
  "homepage",
  "bugs",
  "files",
  "exports",
  "bin",
  "volta",
  "packageManager",
  "devEngines"
])

// Cargo.toml [package] セクションで依存を意味しないキー
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

function isNpmPackageDependencyLine(line: string): boolean {
  const match = line.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/)
  if (!match) return false
  const [, key] = match
  return !NPM_NON_DEPENDENCY_KEYS.has(key)
}

function isNpmLockDependencyLine(line: string): boolean {
  // pnpm-lock: "  package-name@1.0.0:" / yarn.lock: "package-name@^1.0.0:"
  return (
    /^\s*['"]?[\w./@-]+['"]?@[\w^~.>=<, |]+:\s*$/.test(line) ||
    /^\s{2,4}[\w./@-]+:\s*$/.test(line)
  )
}

function isRequirementsDependencyLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith("#")) return false
  return /^[A-Za-z0-9_.-]+/.test(trimmed)
}

function isCargoDependencyLine(line: string): boolean {
  const match = line.match(/^\s*([\w-]+)\s*=/)
  if (!match) return false
  return !CARGO_NON_DEPENDENCY_KEYS.has(match[1])
}

function isGoModDependencyLine(line: string): boolean {
  return /^\s*[\w.\-/]+\s+v\d+\.\d+\.\d+/.test(line)
}

function matchesDependencyPattern(kind: ManifestKind, line: string): boolean {
  switch (kind) {
    case "npm-package":
      return isNpmPackageDependencyLine(line)
    case "npm-lock":
      return isNpmLockDependencyLine(line)
    case "requirements":
      return isRequirementsDependencyLine(line)
    case "cargo":
      return isCargoDependencyLine(line)
    case "gomod":
      return isGoModDependencyLine(line)
    default:
      return false
  }
}

export const newDependencyRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")

    const parsed = parseDiff(artifact.content)
    if (parsed.files.length === 0) return [] // 依存マニフェストの diff がなければ判定不能

    const findings: Finding[] = []
    for (const file of parsed.files) {
      const kind = manifestKind(file.path)
      if (!kind) continue

      for (const line of file.additions) {
        if (matchesDependencyPattern(kind, line)) {
          findings.push({
            ruleId: RULE_ID,
            severity,
            message: `依存パッケージの追加を検出しました: ${file.path}`,
            evidence: { location: file.path, excerpt: truncateExcerpt(line) }
          })
        }
      }
    }

    return findings
  }
}
