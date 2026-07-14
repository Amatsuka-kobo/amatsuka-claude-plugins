import { expect, test } from "vitest"
import type { Layout } from "../../types.js"
import { renderDrawio } from "../drawio.js"

function layout(): Layout {
  return {
    type: "architecture",
    title: "構成",
    nodes: [
      { id: "svc", label: "API", shape: "box", kindKey: "api", x: 0, y: 0, width: 160, height: 68, meta: {} },
      { id: "db", label: "DB", shape: "box", kindKey: "data", x: 300, y: 0, width: 160, height: 68, meta: {} },
    ],
    edges: [
      {
        id: "e1",
        from: "svc",
        to: "db",
        label: "call",
        style: "arrow",
        points: [
          { x: 160, y: 34 },
          { x: 220, y: 34 },
          { x: 220, y: 100 },
          { x: 300, y: 34 },
        ],
      },
    ],
  }
}

function erLayout(): Layout {
  return {
    type: "er",
    title: "テスト <ER図>",
    nodes: [
      {
        id: "users",
        label: "ユーザー(users)",
        shape: "entity",
        kindKey: "api",
        x: 0,
        y: 0,
        width: 220,
        height: 82,
        headerHeight: 30,
        rowHeight: 26,
        meta: {},
        rows: [
          { text: "[PK] id : BIGINT", meta: {} },
          { text: "email & name", meta: {} },
        ],
      },
      {
        id: "orders",
        label: "orders",
        shape: "entity",
        kindKey: "data",
        x: 300,
        y: 0,
        width: 220,
        height: 56,
        headerHeight: 30,
        rowHeight: 26,
        meta: {},
        rows: [{ text: "[PK] id", meta: {} }],
      },
    ],
    edges: [
      {
        id: "rel1",
        from: "users",
        to: "orders",
        label: "発注する",
        cardinality: "1:N",
        points: [
          { x: 220, y: 41 },
          { x: 300, y: 28 },
        ],
      },
    ],
  }
}

function architectureLayoutWithZoneAndLine(): Layout {
  return {
    type: "architecture",
    title: "構成2",
    zones: [{ id: "aws", label: "AWS", x: 0, y: 0, width: 400, height: 200 }],
    nodes: [{ id: "app", label: "App", shape: "box", kindKey: "generic", x: 20, y: 50, width: 140, height: 60, meta: {} }],
    lines: [{ x: 70, y1: 50, y2: 300, owner: "app" }],
    edges: [],
  }
}

function sequenceLayout(): Layout {
  return {
    type: "sequence",
    title: "seq",
    nodes: [
      { id: "u", label: "U", shape: "actor", kindKey: "user", x: 0, y: 0, width: 140, height: 50, meta: {} },
      { id: "w", label: "W", shape: "actor", kindKey: "generic", x: 220, y: 0, width: 140, height: 50, meta: {} },
    ],
    edges: [
      { id: "msg1", from: "u", to: "w", label: "要求", style: "sync", points: [{ x: 70, y: 100 }, { x: 290, y: 100 }] },
      { id: "msg2", from: "w", to: "u", label: "応答", style: "return", points: [{ x: 290, y: 150 }, { x: 70, y: 150 }] },
    ],
  }
}

function terminalLayout(): Layout {
  return {
    type: "screen-flow",
    title: "flow",
    nodes: [{ id: "login", label: "ログイン", shape: "terminal", kindKey: "screen", x: 0, y: 0, width: 180, height: 60, meta: {} }],
    edges: [],
  }
}

test("drawio uses palette emoji shadow waypoint", () => {
  const x = renderDrawio(layout())
  expect(x).toContain("rounded=1")
  expect(x).toContain("shadow=1")
  expect(x).toContain("fillColor=#ECFEFF")
  expect(x).toContain("⚙ API")
  expect(x).toContain('<Array as="points">')
})

test("title and node labels are XML-escaped", () => {
  const xml = renderDrawio(erLayout())
  expect(xml).toContain('<diagram name="テスト &lt;ER図&gt;">')
  expect(xml).toContain('<mxCell id="users-row2" value="email &amp; name"')
})

test("renderDrawio is deterministic for the same input", () => {
  expect(renderDrawio(layout())).toBe(renderDrawio(layout()))
})

test("zone renders as a z- prefixed cell before nodes", () => {
  const xml = renderDrawio(architectureLayoutWithZoneAndLine())
  expect(xml).toMatch(/id="z-aws"[^>]*vertex="1"/)
  expect(xml.indexOf('id="z-aws"')).toBeLessThan(xml.indexOf('id="n-app"'))
})

test("lifeline renders as a dashed edge cell with source/target points", () => {
  const xml = renderDrawio(architectureLayoutWithZoneAndLine())
  expect(xml).toMatch(/id="l-1"[^>]*edge="1"/)
  expect(xml).toContain('<mxPoint x="70" y="50" as="sourcePoint"/>')
  expect(xml).toContain('<mxPoint x="70" y="300" as="targetPoint"/>')
  expect(xml).toMatch(/id="l-1"[^>]*dashed=1/)
})

test("terminal shape uses ellipse style", () => {
  const xml = renderDrawio(terminalLayout())
  expect(xml).toMatch(/id="n-login"[^>]*style="ellipse;/)
})

test("generic screen-flow edge uses block arrow without cell references", () => {
  const xml = renderDrawio(layout())
  expect(xml).toMatch(/id="e-e1"[^>]*endArrow=block;endFill=1;/)
  expect(xml).not.toMatch(/id="e-e1"[^>]*(?:source|target)=/)
})

test("sequence message styles map to distinct edge styles", () => {
  const xml = renderDrawio(sequenceLayout())
  expect(xml).toMatch(/id="e-msg1"[^>]*value="要求"/)
  expect(xml).toMatch(/id="e-msg2"[^>]*style="[^"]*dashed=1;[^"]*endArrow=open;/)
})

test("ER cardinality renders ER arrow pairs without cell references", () => {
  const xml = renderDrawio(erLayout())
  expect(xml).toMatch(/id="e-rel1"[^>]*startArrow=ERone;[^"]*endArrow=ERmany;/)
  expect(xml).not.toMatch(/id="e-rel1"[^>]*(?:source|target)=/)
  expect(xml).toContain('value="発注する"')
})

test("N:M cardinality renders both ends as ERmany", () => {
  const l = erLayout()
  const edge = l.edges[0]
  if (!edge) throw new Error("fixture edge missing")
  edge.cardinality = "N:M"
  const xml = renderDrawio(l)
  expect(xml).toMatch(/startArrow=ERmany;[^"]*endArrow=ERmany;/)
})

test("multi-point edges render every Layout point as absolute coordinates", () => {
  const xml = renderDrawio(layout())
  const cell = xml.match(/<mxCell id="e-e1"[\s\S]*?<\/mxCell>/)?.[0] ?? ""
  expect(cell).not.toMatch(/ source=| target=/)
  expect(cell).not.toContain("edgeStyle=")
  expect(cell).toContain('<mxPoint x="160" y="34" as="sourcePoint"/>')
  expect(cell).toContain('<Array as="points">')
  expect(cell).toContain('<mxPoint x="220" y="34"/>')
  expect(cell).toContain('<mxPoint x="220" y="100"/>')
  expect(cell).toContain('<mxPoint x="300" y="34" as="targetPoint"/>')
})

test("two-point sequence messages use absolute source and target points", () => {
  const xml = renderDrawio(sequenceLayout())
  const cell = xml.match(/<mxCell id="e-msg1"[\s\S]*?<\/mxCell>/)?.[0] ?? ""
  expect(cell).not.toMatch(/ source=| target=/)
  expect(cell).toContain('<mxPoint x="70" y="100" as="sourcePoint"/>')
  expect(cell).toContain('<mxPoint x="290" y="100" as="targetPoint"/>')
  expect(cell).not.toContain("<Array")
})

test("edge labels render as absolute boxes from Layout labelBox", () => {
  const l = erLayout()
  l.edges[0].labelBox = { x: 230, y: 12, width: 58, height: 18 }
  const xml = renderDrawio(l)
  expect(xml).toMatch(/id="e-rel1"[^>]*value=""/)
  expect(xml).toMatch(/id="label-rel1"[^>]*value="発注する"[^>]*vertex="1"/)
  expect(xml).toMatch(/id="label-rel1"[\s\S]*?<mxGeometry x="230" y="12" width="58" height="18" as="geometry"\/>/)
})

test("entity rows render as child cells with header offsets", () => {
  const xml = renderDrawio(erLayout())
  expect(xml).toContain('<mxCell id="n-users" value="ユーザー(users)"')
  expect(xml).toMatch(/id="n-users"[^>]*style="swimlane;/)
  expect(xml).toMatch(/id="users-row1"[^>]*parent="n-users"/)
  expect(xml).toContain("strokeColor=#E2E8F0;fillColor=#FFFFFF")
  expect(xml).toMatch(/id="users-row2"[^>]*>\s*<mxGeometry y="56" width="220" height="26"/)
})

test("output has a valid mxfile root structure", () => {
  const xml = renderDrawio(layout())
  expect(xml.startsWith("<mxfile")).toBe(true)
  expect(xml).toContain('<mxCell id="0"/>')
  expect(xml).toContain('<mxCell id="1" parent="0"/>')
})
