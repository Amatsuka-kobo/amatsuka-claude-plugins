import { describe, expect, it } from "vitest"
import {
  buildChain,
  type ChainHeader,
  chainSeed,
  sha256Hex
} from "../hashchain"

const header: ChainHeader = {
  evaluationId: "eval-1",
  runId: "run-1",
  phase: "implement",
  attempt: 2,
  verdict: "ASK",
  judgeStatus: "ok",
  prevChainHead: null
}

const entries = [
  { name: "01-rules.json", sha256: sha256Hex("rules") },
  { name: "06-precedents.json", sha256: sha256Hex("precedents") }
]

describe("hashchain", () => {
  it("sha256Hex は文字列とバイト列で同じ値を返す", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex(Buffer.from("hello")))
    expect(sha256Hex("hello")).toHaveLength(64)
  })

  it("seed は設計書 §6.10 の文字列の sha256 で、prevChainHead が null なら none を入れる", () => {
    expect(chainSeed(header)).toBe(
      sha256Hex("raguel-v2|eval-1|run-1|implement|2|ASK|ok|none")
    )
    expect(chainSeed({ ...header, prevChainHead: "abc" })).toBe(
      sha256Hex("raguel-v2|eval-1|run-1|implement|2|ASK|ok|abc")
    )
  })

  it("seed を初期値に H(prev + name + ':' + sha256) で畳み込む", () => {
    let prev = chainSeed(header)
    for (const e of entries) prev = sha256Hex(`${prev}${e.name}:${e.sha256}`)
    expect(buildChain(header, entries)).toBe(prev)
  })

  it("証拠が空なら seed そのものになる", () => {
    expect(buildChain(header, [])).toBe(chainSeed(header))
  })

  it("渡す順序に関わらず名前順に畳み込む", () => {
    expect(buildChain(header, [...entries].reverse())).toBe(
      buildChain(header, entries)
    )
  })

  it("verdict・judgeStatus・prevChainHead・attempt のどれを変えても chainHead が変わる(G8)", () => {
    const base = buildChain(header, entries)
    expect(buildChain({ ...header, verdict: "PROCEED" }, entries)).not.toBe(
      base
    )
    expect(
      buildChain({ ...header, judgeStatus: "degraded" }, entries)
    ).not.toBe(base)
    expect(buildChain({ ...header, prevChainHead: "x" }, entries)).not.toBe(
      base
    )
    expect(buildChain({ ...header, attempt: 3 }, entries)).not.toBe(base)
    expect(buildChain({ ...header, phase: "fix-loop" }, entries)).not.toBe(base)
  })

  it("証拠の sha256 を 1 つ変えると chainHead が変わる", () => {
    const tampered = [
      { ...entries[0], sha256: sha256Hex("rulesX") },
      entries[1]
    ]
    expect(buildChain(header, tampered)).not.toBe(buildChain(header, entries))
  })
})
