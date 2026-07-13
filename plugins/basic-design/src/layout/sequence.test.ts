import { expect, test } from "vitest"
import { assertLayoutHasNoOverlaps } from "./geometry.js"
import { layoutSequence } from "./sequence.js"
import type { SequenceSpec } from "../types.js"
import complexSpec from "../fixtures/complex-sequence.spec.json" with { type: "json" }

const spec: SequenceSpec = {
  type: "sequence",
  title: "ログイン処理",
  actors: [
    { id: "user", label: "ユーザー", kind: "actor" },
    { id: "web", label: "Web" },
    { id: "db", label: "DB" },
  ],
  messages: [
    { from: "user", to: "web", label: "ログイン要求" },
    { from: "web", to: "db", label: "照会", style: "async" },
    { from: "db", to: "web", label: "結果", style: "return" },
    { from: "web", to: "user", label: "トークン", style: "return" },
  ],
}

test("sequence uses points and labelBox", async () => {
  const result = await layoutSequence(spec)
  expect(result.edges[0]).toMatchObject({ style: "sync", points: [{ x: 70, y: 114 }, { x: 290, y: 114 }] })
  expect(result.edges[0].labelBox).toMatchObject({ height: 18 })
  expect("fromPt" in result.edges[0]).toBe(false)
})

test("6 actor / 12 message の複雑なシーケンスが重ならない", async () => {
  const layout = await layoutSequence(complexSpec as SequenceSpec)
  expect(layout.nodes).toHaveLength(6)
  expect(layout.edges).toHaveLength(12)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})
