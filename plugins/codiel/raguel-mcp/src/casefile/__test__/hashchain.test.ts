import { describe, expect, it } from "vitest"
import { buildChain, sha256Hex, verifyChain } from "../hashchain"

describe("hashchain", () => {
  it("sha256Hex は文字列とバイト列で同じ結果を返す", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex(Buffer.from("hello")))
    expect(sha256Hex("hello")).toHaveLength(64)
  })

  it("buildChain → verifyChain が成功する", () => {
    const entries = [
      { name: "01-rules.json", sha256: sha256Hex("rules") },
      { name: "02-weight.json", sha256: sha256Hex("weight") }
    ]
    const head = buildChain(entries)
    expect(verifyChain(entries, head)).toBe(true)
  })

  it("1 バイトでも改竄されると検証に失敗する", () => {
    const entries = [
      { name: "01-rules.json", sha256: sha256Hex("rules") },
      { name: "02-weight.json", sha256: sha256Hex("weight") }
    ]
    const head = buildChain(entries)
    const tampered = [
      { name: "01-rules.json", sha256: sha256Hex("rulesX") },
      { name: "02-weight.json", sha256: sha256Hex("weight") }
    ]
    expect(verifyChain(tampered, head)).toBe(false)
  })

  it("エントリの入力順序に関わらず名前順で正規化される", () => {
    const a = { name: "01-a.json", sha256: sha256Hex("a") }
    const b = { name: "02-b.json", sha256: sha256Hex("b") }
    const c = { name: "03-c.json", sha256: sha256Hex("c") }
    expect(buildChain([a, b, c])).toBe(buildChain([c, a, b]))
    expect(buildChain([a, b, c])).toBe(buildChain([b, c, a]))
  })

  it("空エントリでは常に GENESIS 由来の固定値を返す", () => {
    expect(buildChain([])).toBe(buildChain([]))
  })
})
