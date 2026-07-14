import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { decorateLayout } from "../../decorate.js"
import type { DiagramSpec, Layout } from "../../types.js"
import { assertLayoutHasNoOverlaps } from "../geometry.js"
import { layoutArchitecture, layoutEr, layoutScreenFlow } from "../graph.js"
import { layoutSequence } from "../sequence.js"

const load = (relative: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
  ) as DiagramSpec

const CASES = [
  ["../../../samples/web-architecture.spec.json", layoutArchitecture],
  ["../../../samples/ec-screen-flow.spec.json", layoutScreenFlow],
  ["../../../samples/order-system.spec.json", layoutEr],
  ["../../../samples/login-sequence.spec.json", layoutSequence],
  ["../../fixtures/complex-architecture.spec.json", layoutArchitecture],
  ["../../fixtures/complex-screen-flow.spec.json", layoutScreenFlow],
  ["../../fixtures/complex-er.spec.json", layoutEr],
  ["../../fixtures/complex-sequence.spec.json", layoutSequence]
] as const

test.each(CASES)("%s has no overlaps", async (specPath, layoutSpec) => {
  const spec = load(specPath)
  const layout = decorateLayout(
    spec,
    await (layoutSpec as (value: never) => Promise<Layout>)(spec as never)
  )
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})
