import { describe, expect, it } from "vitest"
import { parseDocument } from "../document"
import { bodyHash, decodeRecord, encodeRecord, textHash } from "../hash"

describe("textHash", () => {
  it("前後の空白を無視した 16 桁の hex を返す", () => {
    expect(textHash(" a \n")).toBe(textHash("a"))
    expect(textHash("a")).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe("bodyHash", () => {
  it("frontmatter の違いを無視する", () => {
    expect(bodyHash("---\nlabel: A\n---\n\n本文\n")).toBe(
      bodyHash("---\nlabel: B\n---\n\n本文\n")
    )
  })
})

describe("encodeRecord / decodeRecord", () => {
  const record = {
    description: textHash("d"),
    preamble: textHash("p"),
    sections: {
      "## When to invoke": textHash("w"),
      "## 作業手順": textHash("s")
    }
  }

  it("往復で元の記録に戻る", () => {
    expect(decodeRecord(encodeRecord(record))).toEqual(record)
  })

  it("値は base64url の文字だけで、`:` を含まない", () => {
    expect(encodeRecord(record)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("frontmatter に埋めても parseDocument で同じ値を読み戻せる", () => {
    const value = encodeRecord(record)
    const document = parseDocument(
      `---\nname: x\nbetter-agentics-hash: ${value}\n---\n\n本文\n`
    )
    expect(document.meta.get("better-agentics-hash")).toBe(value)
  })

  it("壊れた値は undefined を返す", () => {
    expect(decodeRecord("not-base64")).toBeUndefined()
    expect(decodeRecord("")).toBeUndefined()
    expect(decodeRecord(undefined)).toBeUndefined()
    expect(
      decodeRecord(
        Buffer.from(JSON.stringify({ description: "x" })).toString("base64url")
      )
    ).toBeUndefined()
  })
})
