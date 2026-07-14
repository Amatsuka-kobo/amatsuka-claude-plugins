import { expect, test } from "vitest"
import architecture from "../../../samples/web-architecture.spec.json" with { type: "json" }
import flow from "../../../samples/ec-screen-flow.spec.json" with { type: "json" }
import er from "../../../samples/order-system.spec.json" with { type: "json" }
import complexArchitecture from "../../fixtures/complex-architecture.spec.json" with { type: "json" }
import complexFlow from "../../fixtures/complex-screen-flow.spec.json" with { type: "json" }
import complexEr from "../../fixtures/complex-er.spec.json" with { type: "json" }
import type { ArchitectureSpec, Box, ErSpec, Layout, LayoutNode, ScreenFlowSpec } from "../../types.js"
import { assertLayoutHasNoOverlaps } from "../geometry.js"
import { layoutArchitecture, layoutEr, layoutScreenFlow } from "../graph.js"

function node(layout: Layout, id: string): LayoutNode {
  const result = layout.nodes.find((item) => item.id === id)
  if (!result) throw new Error(`node not found: ${id}`)
  return result
}

function zone(layout: Layout, id: string): Box & { id: string; label: string } {
  const result = layout.zones?.find((item) => item.id === id)
  if (!result) throw new Error(`zone not found: ${id}`)
  return result
}

function contains(parent: Box, child: Box): boolean {
  return child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height
}

test("screen flow is RIGHT and routed", async () => {
  const layout = await layoutScreenFlow(flow as ScreenFlowSpec)
  expect(node(layout, "login").x).toBeLessThan(node(layout, "home").x)
  expect(layout.edges.every((edge) => edge.points.length >= 2)).toBe(true)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})

test("ER preserves rows/cardinality/points", async () => {
  const layout = await layoutEr(er as ErSpec)
  expect(layout.nodes[0]).toMatchObject({ shape: "entity", headerHeight: 36, rowHeight: 28 })
  expect(layout.edges[0]).toMatchObject({ cardinality: "1:N" })
  expect(layout.edges[0].points.length).toBeGreaterThanOrEqual(2)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})

test("complex ER has no overlaps", async () => {
  const layout = await layoutEr(complexEr as ErSpec)
  expect(layout.nodes).toHaveLength(10)
  expect(layout.edges).toHaveLength(14)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})

test("architecture compound zones contain nodes", async () => {
  const layout = await layoutArchitecture(architecture as ArchitectureSpec)
  expect(contains(zone(layout, "aws"), node(layout, "db"))).toBe(true)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})

test.each([
  ["sample screen flow", flow, layoutScreenFlow],
  ["complex screen flow", complexFlow, layoutScreenFlow],
] as const)("%s has no overlaps", async (_name, spec, layouter) => {
  const layout = await layouter(spec as ScreenFlowSpec)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})

test.each([
  ["sample architecture", architecture, layoutArchitecture],
  ["complex architecture", complexArchitecture, layoutArchitecture],
] as const)("%s has no overlaps", async (_name, spec, layouter) => {
  const layout = await layouter(spec as ArchitectureSpec)
  expect(assertLayoutHasNoOverlaps(layout)).toEqual([])
})
