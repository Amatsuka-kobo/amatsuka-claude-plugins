import { expect, test } from "vitest"
import type { ArchitectureSpec, ErSpec, Layout, ScreenFlowSpec, SequenceSpec } from "../types.js"
import { renderHtml } from "./html.js"

function layout(): Layout {
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
          { text: "[PK] id : BIGINT", meta: { name: "id", pk: true } },
          { text: "email </script>", meta: { name: "email" } },
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
        rows: [{ text: "[PK] id", meta: { name: "id" } }],
      },
    ],
    edges: [
      {
        id: "rel1",
        from: "users",
        to: "orders",
        label: "発注",
        cardinality: "1:N",
        points: [
          { x: 220, y: 41 },
          { x: 300, y: 28 },
        ],
        labelBox: { x: 240, y: 20, width: 48, height: 18 },
      },
    ],
  }
}

function spec(): ErSpec {
  return { type: "er", title: "テスト <ER図>", entities: [{ name: "users", columns: [] }] }
}

function architectureLayout(): Layout {
  return {
    type: "architecture",
    title: "構成",
    zones: [{ id: "aws", label: "AWS", x: 0, y: 0, width: 400, height: 200 }],
    nodes: [{ id: "app", label: "App", shape: "box", kindKey: "generic", x: 20, y: 50, width: 140, height: 60, meta: {} }],
    edges: [],
  }
}

function architectureSpec(): ArchitectureSpec {
  return { type: "architecture", title: "構成", nodes: [] }
}

function screenFlowLayout(): Layout {
  return {
    type: "screen-flow",
    title: "画面遷移",
    nodes: [
      { id: "login", label: "ログイン", shape: "terminal", kindKey: "screen", x: 0, y: 0, width: 180, height: 60, meta: {} },
      { id: "home", label: "ホーム", shape: "box", kindKey: "screen", x: 280, y: 0, width: 180, height: 60, meta: {} },
    ],
    edges: [
      {
        id: "t1",
        from: "login",
        to: "home",
        label: "",
        style: "arrow",
        points: [
          { x: 180, y: 30 },
          { x: 280, y: 30 },
        ],
      },
    ],
  }
}

function screenFlowSpec(): ScreenFlowSpec {
  return { type: "screen-flow", title: "画面遷移", screens: [] }
}

function sequenceLayout(): Layout {
  return {
    type: "sequence",
    title: "シーケンス",
    nodes: [
      { id: "u", label: "U", shape: "actor", kindKey: "user", x: 0, y: 0, width: 140, height: 50, meta: {} },
      { id: "w", label: "W", shape: "actor", kindKey: "generic", x: 220, y: 0, width: 140, height: 50, meta: {} },
    ],
    lines: [
      { x: 70, y1: 50, y2: 250, owner: "u" },
      { x: 290, y1: 50, y2: 250, owner: "w" },
    ],
    edges: [
      { id: "msg1", from: "u", to: "w", label: "要求", style: "sync", points: [{ x: 70, y: 100 }, { x: 290, y: 100 }] },
      { id: "msg2", from: "w", to: "u", label: "応答", style: "return", points: [{ x: 290, y: 150 }, { x: 70, y: 150 }] },
    ],
  }
}

function sequenceSpec(): SequenceSpec {
  return { type: "sequence", title: "シーケンス", actors: [] }
}

test("HTML is themed/self-contained/interactive", () => {
  const h = renderHtml(layout(), spec())
  expect(h).toContain('class="node-card kind-api"')
  expect(h).toContain('class="edge-label-bg"')
  expect(h).toContain('id="design-layout"')
  expect(h).toContain('addEventListener("wheel"')
  expect(h).not.toMatch(/<script[^>]+src=|<link[^>]+href=/)
})

test("ER row badges render PK/FK/UQ colors", () => {
  const value = layout()
  value.nodes[0].rows = [
    { text: "id", meta: { pk: true } },
    { text: "owner_id", meta: { fk: true } },
    { text: "email", meta: { unique: true } },
  ]
  const html = renderHtml(value, spec())
  expect(html).toContain('class="badge badge-pk">PK</tspan>')
  expect(html).toContain('class="badge badge-fk">FK</tspan>')
  expect(html).toContain('class="badge badge-unique">UQ</tspan>')
  expect(html).toContain(".badge-pk{fill:#F59E0B}")
  expect(html).toContain(".badge-fk{fill:#8B5CF6}")
  expect(html).toContain(".badge-unique{fill:#0EA5E9}")
})

test("row text is escaped inside SVG", () => {
  const html = renderHtml(layout(), spec())
  expect(html).toContain("email &lt;/script&gt;")
})

test("embedded JSON escapes < to avoid premature script termination", () => {
  const html = renderHtml(layout(), spec())
  const jsonPart = html.split('id="design-layout">')[1]?.split("</script>")[0] ?? ""
  expect(jsonPart).not.toContain("</script")
  expect(jsonPart).toContain("\\u003c")
})

test("renderHtml is deterministic for the same input", () => {
  expect(renderHtml(layout(), spec())).toBe(renderHtml(layout(), spec()))
})

test("zones render as .zone group before nodes", () => {
  const html = renderHtml(architectureLayout(), architectureSpec())
  expect(html).toContain('<g class="zone">')
  expect(html.indexOf('class="zone"')).toBeLessThan(html.indexOf('data-id="app"'))
})

test("sequence lifelines render one per line", () => {
  const html = renderHtml(sequenceLayout(), sequenceSpec())
  expect((html.match(/class="lifeline"/g) ?? []).length).toBe(2)
  expect(html).toContain('<g class="edge sync" data-id="msg1"')
  expect(html).toContain('<g class="edge return" data-id="msg2"')
})

test("terminal shape renders as ellipse, box as rounded rect", () => {
  const html = renderHtml(screenFlowLayout(), screenFlowSpec())
  expect(html).toContain("<ellipse")
  expect(html).toMatch(/<g class="node" data-id="home"[^>]*>[\s\S]*?<rect[^>]*rx="12"/)
})

test("edges render as polylines carrying selection data", () => {
  const html = renderHtml(screenFlowLayout(), screenFlowSpec())
  expect(html).toContain('<g class="node" data-id="login"')
  expect(html).toContain('data-from="login" data-to="home"')
  expect(html).toContain('<polyline points="180,30 280,30" fill="none" marker-end="url(#arrow)"/>')
})

test("edge without label renders no edge-label group", () => {
  const html = renderHtml(screenFlowLayout(), screenFlowSpec())
  expect(html).not.toContain('class="edge-label"')
})

test("nodes and edges carry data attributes for selection", () => {
  const html = renderHtml(layout(), spec())
  expect(html).toContain('<g class="node" data-id="users"')
  expect(html).toContain('<g class="node" data-id="orders"')
  expect(html).toContain('data-from="users"')
  expect(html).toContain('data-to="orders"')
})

test("detail panel hooks are present", () => {
  const html = renderHtml(layout(), spec())
  expect(html).toContain('id="panel"')
  expect(html).toContain('id="panel-title"')
  expect(html).toContain('id="panel-body"')
})

test("document has no external resource references", () => {
  const html = renderHtml(layout(), spec())
  expect(html).not.toMatch(/\bsrc\s*=\s*"https?:/)
  expect(html).not.toMatch(/<link[^>]*href\s*=\s*"https?:/)
})

test("output is a full standalone HTML document", () => {
  const html = renderHtml(layout(), spec())
  expect(html.startsWith("<!doctype html>")).toBe(true)
  expect(html).toContain("</html>")
})
