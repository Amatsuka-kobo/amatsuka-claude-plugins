import { describe, expect, it } from "vitest"
import { parseDocument } from "../document"
import { applyExtraKeys, CACHE_TTL_ROLES, readExtraKeys } from "../extra-keys"

function doc(meta: string[]): string {
  return [
    "---",
    "name: x",
    "better-agentics-role: r",
    "better-agentics-hash: abc",
    ...meta,
    "---",
    "",
    "あなたは x。",
    "",
    "## Output Format",
    "",
    "- 本文",
    ""
  ].join("\n")
}

function bodyOf(content: string): string {
  return content.slice(content.indexOf("---", 3))
}

describe("applyExtraKeys", () => {
  it("CACHE_TTL_ROLES はレビューの 5 役割", () => {
    expect([...CACHE_TTL_ROLES].sort()).toEqual([
      "adversarial-review",
      "code-review",
      "complex-review",
      "design-review",
      "knowledge-elicitation"
    ])
  })

  it("omitClaudeMd: true を書き、written を返す", () => {
    const { content, changes } = applyExtraKeys(doc([]), {
      roleId: "knowledge-elicitation",
      omitClaudeMd: true
    })
    expect(content).toContain("\nomitClaudeMd: true\n")
    expect(changes.omitClaudeMd).toBe("written")
  })

  it("既存の omitClaudeMd: true に false を当てると消し、undefined なら変えない", () => {
    const removed = applyExtraKeys(doc(["omitClaudeMd: true"]), {
      roleId: "normal-impl",
      omitClaudeMd: false
    })
    expect(removed.content).not.toContain("omitClaudeMd")
    expect(removed.changes.omitClaudeMd).toBe("removed")
    const kept = applyExtraKeys(doc(["omitClaudeMd: true"]), {
      roleId: "normal-impl",
      omitClaudeMd: undefined
    })
    expect(kept.content).toContain("omitClaudeMd: true")
    expect(kept.changes.omitClaudeMd).toBe("unchanged")
  })

  it("レビューの役割で experimental が無ければ cacheTtl: 1h を足す", () => {
    const { content, changes } = applyExtraKeys(doc([]), {
      roleId: "code-review",
      omitClaudeMd: undefined
    })
    expect(content).toContain("\nexperimental:\n  cacheTtl: 1h\n---")
    expect(changes.cacheTtl).toBe("written")
  })

  it("既存の experimental の他のキーを残して cacheTtl を足す", () => {
    const { content, changes } = applyExtraKeys(
      doc(["experimental:", "  other: x"]),
      { roleId: "design-review", omitClaudeMd: undefined }
    )
    expect(content).toContain("experimental:\n  other: x\n  cacheTtl: 1h\n")
    expect(changes.cacheTtl).toBe("written")
  })

  it("cacheTtl: 5m は 1h に替えて rewritten、既に 1h なら unchanged", () => {
    const rewritten = applyExtraKeys(
      doc(["experimental:", "  cacheTtl: 5m", "  other: x"]),
      { roleId: "complex-review", omitClaudeMd: undefined }
    )
    expect(rewritten.content).toContain(
      "experimental:\n  cacheTtl: 1h\n  other: x\n"
    )
    expect(rewritten.changes.cacheTtl).toBe("rewritten")
    const same = applyExtraKeys(doc(["experimental:", "  cacheTtl: 1h"]), {
      roleId: "complex-review",
      omitClaudeMd: undefined
    })
    expect(same.changes.cacheTtl).toBe("unchanged")
    expect(same.content).toBe(doc(["experimental:", "  cacheTtl: 1h"]))
  })

  it("レビュー以外の役割では experimental に触れない", () => {
    const original = doc(["experimental:", "  cacheTtl: 5m"])
    const { content, changes } = applyExtraKeys(original, {
      roleId: "normal-impl",
      omitClaudeMd: undefined
    })
    expect(content).toBe(original)
    expect(changes).toEqual({
      omitClaudeMd: "unchanged",
      cacheTtl: "unchanged"
    })
  })

  it("better-agentics-hash と本文を変えない", () => {
    const original = doc([])
    const { content } = applyExtraKeys(original, {
      roleId: "knowledge-elicitation",
      omitClaudeMd: true
    })
    expect(parseDocument(content).meta.get("better-agentics-hash")).toBe("abc")
    expect(bodyOf(content)).toBe(bodyOf(original))
  })
})

describe("readExtraKeys", () => {
  it("omitClaudeMd と cacheTtl を読む。無ければ false と null", () => {
    expect(
      readExtraKeys(
        doc(["omitClaudeMd: true", "experimental:", "  cacheTtl: 1h"])
      )
    ).toEqual({ omitClaudeMd: true, cacheTtl: "1h" })
    expect(readExtraKeys(doc([]))).toEqual({
      omitClaudeMd: false,
      cacheTtl: null
    })
  })
})
