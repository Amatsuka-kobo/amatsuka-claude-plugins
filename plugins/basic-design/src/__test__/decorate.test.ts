import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { decorateLayout } from "../decorate.js"
import type { DiagramSpec, Layout, LayoutNode } from "../types.js"

function loadSample(fileName: string): DiagramSpec {
  const path = fileURLToPath(new URL(`../../samples/${fileName}`, import.meta.url))
  return JSON.parse(readFileSync(path, "utf8")) as DiagramSpec
}

function stubLayout(spec: DiagramSpec): Layout {
  const nodes: LayoutNode[] = []
  const box = { x: 0, y: 0, width: 0, height: 0 }
  if (spec.type === "architecture") {
    const zoneOf = new Map<string, string>()
    for (const zone of spec.zones ?? []) {
      for (const child of zone.children) zoneOf.set(child, zone.id)
    }
    for (const n of spec.nodes) {
      nodes.push({ ...box, id: n.id, label: n.label ?? n.id, shape: "box", kindKey: "generic", meta: { zone: zoneOf.get(n.id) } })
    }
  } else if (spec.type === "screen-flow") {
    for (const s of spec.screens) {
      nodes.push({ ...box, id: s.id, label: s.label ?? s.id, shape: "box", kindKey: "generic", meta: {} })
    }
  } else if (spec.type === "er") {
    for (const e of spec.entities) {
      nodes.push({ ...box, id: e.name, label: e.label ?? e.name, shape: "entity", kindKey: "generic", meta: {} })
    }
  } else {
    for (const a of spec.actors) {
      nodes.push({ ...box, id: a.id, label: a.label ?? a.id, shape: "actor", kindKey: "generic", meta: {} })
    }
  }
  return { type: spec.type, title: spec.title, nodes, edges: [] }
}

test("explicit kind wins and unknown explicit kind is generic", () => {
  const spec1: DiagramSpec = { type: "architecture", title: "A", nodes: [{ id: "n", icon: "api", kind: "external" }] }
  expect(decorateLayout(spec1, stubLayout(spec1)).nodes[0].kindKey).toBe("external")

  const spec2: DiagramSpec = { type: "architecture", title: "A", nodes: [{ id: "n", kind: "warehouse" }] }
  expect(decorateLayout(spec2, stubLayout(spec2)).nodes[0].kindKey).toBe("generic")
})

test("web-architecture.spec.json: 全ノードの kindKey スナップショット", () => {
  const spec = loadSample("web-architecture.spec.json")
  const result = decorateLayout(spec, stubLayout(spec))
  expect(result.nodes.map((n) => ({ id: n.id, kindKey: n.kindKey }))).toMatchInlineSnapshot(`
    [
      {
        "id": "browser",
        "kindKey": "generic",
      },
      {
        "id": "cdn",
        "kindKey": "generic",
      },
      {
        "id": "alb",
        "kindKey": "generic",
      },
      {
        "id": "web",
        "kindKey": "generic",
      },
      {
        "id": "app",
        "kindKey": "generic",
      },
      {
        "id": "db",
        "kindKey": "data",
      },
    ]
  `)
})

test("ec-screen-flow.spec.json: 全ノードの kindKey スナップショット", () => {
  const spec = loadSample("ec-screen-flow.spec.json")
  const result = decorateLayout(spec, stubLayout(spec))
  expect(result.nodes.map((n) => ({ id: n.id, kindKey: n.kindKey }))).toMatchInlineSnapshot(`
    [
      {
        "id": "login",
        "kindKey": "screen",
      },
      {
        "id": "home",
        "kindKey": "screen",
      },
      {
        "id": "product-list",
        "kindKey": "screen",
      },
      {
        "id": "product-detail",
        "kindKey": "screen",
      },
      {
        "id": "cart",
        "kindKey": "screen",
      },
      {
        "id": "checkout",
        "kindKey": "screen",
      },
      {
        "id": "order-complete",
        "kindKey": "screen",
      },
    ]
  `)
})

test("order-system.spec.json: 全ノードの kindKey スナップショット", () => {
  const spec = loadSample("order-system.spec.json")
  const result = decorateLayout(spec, stubLayout(spec))
  expect(result.nodes.map((n) => ({ id: n.id, kindKey: n.kindKey }))).toMatchInlineSnapshot(`
    [
      {
        "id": "users",
        "kindKey": "entity",
      },
      {
        "id": "orders",
        "kindKey": "entity",
      },
      {
        "id": "order_items",
        "kindKey": "entity",
      },
      {
        "id": "products",
        "kindKey": "entity",
      },
    ]
  `)
})

test("login-sequence.spec.json: 全ノードの kindKey スナップショット", () => {
  const spec = loadSample("login-sequence.spec.json")
  const result = decorateLayout(spec, stubLayout(spec))
  expect(result.nodes.map((n) => ({ id: n.id, kindKey: n.kindKey }))).toMatchInlineSnapshot(`
    [
      {
        "id": "user",
        "kindKey": "user",
      },
      {
        "id": "web",
        "kindKey": "generic",
      },
      {
        "id": "auth",
        "kindKey": "generic",
      },
      {
        "id": "db",
        "kindKey": "generic",
      },
    ]
  `)
})
