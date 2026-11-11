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
const CACHE_LINE = /^\s+cacheTtl:\s*(.*)$/

function cacheTtlOf(block: string | undefined): string | null {
  if (block === undefined) return null
  for (const line of block.split("\n")) {
    const match = CACHE_LINE.exec(line)
    if (match?.[1] !== undefined) return match[1].trim()
  }
  return null
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
      const current = cacheTtlOf(block)
      if (current === null) {
        meta.set("experimental", `${block}\n  cacheTtl: ${CACHE_TTL}`)
        changes.cacheTtl = "written"
      } else if (current !== CACHE_TTL) {
        meta.set(
          "experimental",
          block
            .split("\n")
            .map((line) =>
              CACHE_LINE.test(line)
                ? line.replace(/cacheTtl:.*$/, `cacheTtl: ${CACHE_TTL}`)
                : line
            )
            .join("\n")
        )
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
