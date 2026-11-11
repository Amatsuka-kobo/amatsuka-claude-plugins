// 生成した定義の frontmatter に omitClaudeMd と experimental.cacheTtl を書き込む。
// 本文と better-agentics-hash は変えず、frontmatter の行だけを組み立て直す。

import { parseDocument } from "./document"
import type { RoleId } from "./roles"

export const CACHE_TTL_ROLES: readonly RoleId[] = [
  "code-review",
  "design-review",
  "complex-review",
  "adversarial-review",
  "knowledge-elicitation"
]

export interface ExtraKeyOptions {
  roleId: RoleId
  /** undefined は既存の値を保つ */
  omitClaudeMd: boolean | undefined
}

export interface ExtraKeyChanges {
  omitClaudeMd: "written" | "removed" | "unchanged"
  cacheTtl: "written" | "rewritten" | "unchanged"
}

const CACHE_TTL = "1h"

// ブロックの直下の子の字下げ。子が無ければ 2 空白とする。
function childIndent(block: string): string {
  const first = block.split("\n").find((line) => line.trim() !== "")
  return first === undefined ? "  " : (/^\s*/.exec(first)?.[0] ?? "  ")
}

// 直下の cacheTtl の行の位置。入れ子の同名のキーは見ない。
function cacheTtlIndex(lines: string[], indent: string): number {
  return lines.findIndex(
    (line) =>
      line.startsWith(indent) &&
      !/^\s/.test(line.slice(indent.length)) &&
      line.slice(indent.length).startsWith("cacheTtl:")
  )
}

function cacheTtlOf(block: string | undefined): string | null {
  if (block === undefined) return null
  const lines = block.split("\n")
  const line = lines[cacheTtlIndex(lines, childIndent(block))]
  if (line === undefined) return null
  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
}

export function readExtraKeys(content: string): {
  omitClaudeMd: boolean
  cacheTtl: string | null
} {
  const { meta } = parseDocument(content)
  return {
    omitClaudeMd: meta.get("omitClaudeMd")?.trim() === "true",
    cacheTtl: cacheTtlOf(meta.get("experimental"))
  }
}

export function applyExtraKeys(
  content: string,
  options: ExtraKeyOptions
): { content: string; changes: ExtraKeyChanges } {
  const lines = content.split("\n")
  const close = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1
  if (close === -1) throw new Error("definition has no frontmatter")
  const { order, meta } = parseDocument(content)
  const changes: ExtraKeyChanges = {
    omitClaudeMd: "unchanged",
    cacheTtl: "unchanged"
  }

  if (options.omitClaudeMd === true && meta.get("omitClaudeMd") !== "true") {
    if (!meta.has("omitClaudeMd")) order.push("omitClaudeMd")
    meta.set("omitClaudeMd", "true")
    changes.omitClaudeMd = "written"
  }
  if (options.omitClaudeMd === false && meta.has("omitClaudeMd")) {
    order.splice(order.indexOf("omitClaudeMd"), 1)
    meta.delete("omitClaudeMd")
    changes.omitClaudeMd = "removed"
  }

  if (CACHE_TTL_ROLES.includes(options.roleId)) {
    const block = meta.get("experimental")
    if (block === undefined) {
      order.push("experimental")
      meta.set("experimental", `\n  cacheTtl: ${CACHE_TTL}`)
      changes.cacheTtl = "written"
    } else if (block !== "" && !block.startsWith("\n")) {
      throw new Error(
        "experimental: write it as a block of indented keys to add cacheTtl"
      )
    } else {
      const indent = childIndent(block)
      const current = cacheTtlOf(block)
      if (current === null) {
        meta.set("experimental", `${block}\n${indent}cacheTtl: ${CACHE_TTL}`)
        changes.cacheTtl = "written"
      } else if (current !== CACHE_TTL) {
        const lines = block.split("\n")
        lines[cacheTtlIndex(lines, indent)] = `${indent}cacheTtl: ${CACHE_TTL}`
        meta.set("experimental", lines.join("\n"))
        changes.cacheTtl = "rewritten"
      }
    }
  }

  if (
    changes.omitClaudeMd === "unchanged" &&
    changes.cacheTtl === "unchanged"
  ) {
    return { content, changes }
  }
  const head = order.map((key) => {
    const value = meta.get(key) ?? ""
    return value.startsWith("\n") ? `${key}:${value}` : `${key}: ${value}`
  })
  return {
    content: ["---", ...head, ...lines.slice(close)].join("\n"),
    changes
  }
}
