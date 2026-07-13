import type { Box, DiagramSpec, Layout, LayoutEdge, LayoutNode } from "../types.js"
import { THEME } from "../theme.js"
import { escapeXml } from "../xml-util.js"
import { iconSvg } from "./icons.js"

const PAD = 40
const ICON_SIZE = 24

function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

function labelChipWidth(text: string): number {
  return Math.max(48, text.length * 7 + 16)
}

function sizedIcon(node: LayoutNode, x: number, y: number): string {
  const svg = iconSvg(node.kindKey).replace("<svg ", `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" `)
  return `<g class="node-icon" transform="translate(${x},${y})">${svg}</g>`
}

function extent(layout: Layout): { width: number; height: number } {
  const zones = layout.zones ?? []
  const lines = layout.lines ?? []
  const boxes: Box[] = [...layout.nodes, ...zones]
  const edgeXs = layout.edges.flatMap((e) => [...e.points.map((p) => p.x), ...(e.labelBox ? [e.labelBox.x + e.labelBox.width] : [])])
  const edgeYs = layout.edges.flatMap((e) => [...e.points.map((p) => p.y), ...(e.labelBox ? [e.labelBox.y + e.labelBox.height] : [])])
  const width = Math.max(0, ...boxes.map((b) => b.x + b.width), ...lines.map((l) => l.x), ...edgeXs) + PAD * 2
  const height = Math.max(0, ...boxes.map((b) => b.y + b.height), ...lines.map((l) => l.y2), ...edgeYs) + PAD * 2
  return { width, height }
}

function zoneSvg(zone: NonNullable<Layout["zones"]>[number]): string {
  const chipWidth = labelChipWidth(zone.label)
  return (
    `<g class="zone">` +
    `<rect class="zone-bg" x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" rx="${THEME.radius}"/>` +
    `<g class="zone-chip" transform="translate(${zone.x + 12},${zone.y + 12})">` +
    `<rect class="zone-chip-bg" width="${chipWidth}" height="22" rx="11"/>` +
    `<text class="zone-chip-text" x="${chipWidth / 2}" y="15" text-anchor="middle">${escapeXml(zone.label)}</text>` +
    `</g></g>`
  )
}

function lineSvg(line: NonNullable<Layout["lines"]>[number]): string {
  return `<line class="lifeline" x1="${line.x}" y1="${line.y1}" x2="${line.x}" y2="${line.y2}"/>`
}

function badges(meta: Record<string, unknown>): string {
  return (["pk", "fk", "unique"] as const)
    .filter((key) => meta[key] === true)
    .map((key) => `<tspan class="badge badge-${key}">${key === "unique" ? "UQ" : key.toUpperCase()}</tspan>`)
    .join("")
}

function nodeSvg(node: LayoutNode): string {
  const cls = `node-card kind-${node.kindKey}`
  let body: string
  if (node.rows) {
    const headerHeight = node.headerHeight ?? 0
    const rowHeight = node.rowHeight ?? 0
    const rows = node.rows
      .map((row, i) => {
        const rowY = headerHeight + i * rowHeight
        return (
          `<g class="row" transform="translate(0,${rowY})">` +
          `<rect class="row-bg" width="${node.width}" height="${rowHeight}"/>` +
          `<text class="row-text" x="10" y="${rowHeight / 2}" dominant-baseline="middle">${badges(row.meta)}${escapeXml(row.text)}</text>` +
          `</g>`
        )
      })
      .join("")
    body =
      `<rect class="${cls}" width="${node.width}" height="${node.height}" rx="${THEME.radius}"/>` +
      `<rect class="node-header" width="${node.width}" height="${headerHeight}" rx="${THEME.radius}"/>` +
      sizedIcon(node, 10, headerHeight / 2 - ICON_SIZE / 2) +
      `<text class="node-title" x="${10 + ICON_SIZE + 8}" y="${headerHeight / 2}" dominant-baseline="middle">${escapeXml(node.label)}</text>` +
      rows
  } else if (node.shape === "terminal") {
    body =
      `<ellipse class="${cls}" cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}"/>` +
      `<text class="node-title" x="${node.width / 2}" y="${node.height / 2}" text-anchor="middle" dominant-baseline="middle">${escapeXml(node.label)}</text>`
  } else {
    const rx = node.shape === "actor" ? 4 : THEME.radius
    body =
      `<rect class="${cls}" width="${node.width}" height="${node.height}" rx="${rx}"/>` +
      sizedIcon(node, 10, node.height / 2 - ICON_SIZE / 2) +
      `<text class="node-title" x="${10 + ICON_SIZE + 8}" y="${node.height / 2}" dominant-baseline="middle">${escapeXml(node.label)}</text>`
  }
  return `<g class="node" data-id="${escapeXml(node.id)}" transform="translate(${node.x},${node.y})">${body}</g>`
}

function edgeSvg(e: LayoutEdge): string {
  const p = e.points.map((v) => `${v.x},${v.y}`).join(" ")
  const marker = e.cardinality ? "" : e.style === "async" || e.style === "return" ? ` marker-end="url(#arrow-open)"` : ` marker-end="url(#arrow)"`
  const styleClass = e.style ? ` ${e.style}` : ""
  const label = e.labelBox
    ? `<g class="edge-label"><rect class="edge-label-bg" x="${e.labelBox.x}" y="${e.labelBox.y}" width="${e.labelBox.width}" height="${e.labelBox.height}" rx="5"/><text x="${e.labelBox.x + e.labelBox.width / 2}" y="${e.labelBox.y + 13}" text-anchor="middle">${escapeXml(e.label)}</text></g>`
    : ""
  return `<g class="edge${styleClass}" data-id="${escapeXml(e.id)}" data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}"><polyline points="${p}" fill="none"${marker}/>${label}</g>`
}

function paletteCss(): string {
  return Object.entries(THEME.palette)
    .map(([kind, colors]) => `.kind-${kind}{--fill:${colors.fill};--stroke:${colors.stroke};--icon:${colors.icon};--text:${colors.text};}`)
    .join("")
}

const INTERACTION_SCRIPT = `(() => {
  const svg = document.getElementById("canvas")
  const layout = JSON.parse(document.getElementById("design-layout").textContent)
  const panel = document.getElementById("panel")
  const panelTitle = document.getElementById("panel-title")
  const panelBody = document.getElementById("panel-body")
  const vb = svg.viewBox.baseVal

  function onWheel(e) {
    e.preventDefault()
    const scale = e.deltaY < 0 ? 0.9 : 1.1
    const rect = svg.getBoundingClientRect()
    const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.width
    const py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.height
    vb.x = px - (px - vb.x) * scale
    vb.y = py - (py - vb.y) * scale
    vb.width *= scale
    vb.height *= scale
  }

  let drag = null
  function onPointerDown(e) {
    drag = { cx: e.clientX, cy: e.clientY, vx: vb.x, vy: vb.y, moved: false }
    svg.classList.add("panning")
  }
  function onPointerMove(e) {
    if (!drag) return
    const rect = svg.getBoundingClientRect()
    const dx = ((e.clientX - drag.cx) / rect.width) * vb.width
    const dy = ((e.clientY - drag.cy) / rect.height) * vb.height
    if (Math.abs(e.clientX - drag.cx) + Math.abs(e.clientY - drag.cy) > 3) drag.moved = true
    vb.x = drag.vx - dx
    vb.y = drag.vy - dy
  }
  function onPointerUp() {
    svg.classList.remove("panning")
    setTimeout(() => { drag = null }, 0)
  }

  svg.addEventListener("wheel", onWheel, { passive: false })
  svg.addEventListener("pointerdown", onPointerDown)
  svg.addEventListener("pointermove", onPointerMove)
  svg.addEventListener("pointerup", onPointerUp)
  svg.addEventListener("pointerleave", onPointerUp)

  function connected(id) {
    return layout.edges.filter(edge => edge.from === id || edge.to === id)
  }

  function neighborIds(id) {
    const edges = connected(id)
    return [id, ...edges.flatMap(edge => [edge.id, edge.from === id ? edge.to : edge.from])]
  }

  function markAll(ids, cls) {
    for (const id of ids) {
      const el = svg.querySelector('[data-id="' + CSS.escape(id) + '"]')
      if (el) el.classList.add(cls)
    }
  }

  function relatedIds(id) {
    const node = layout.nodes.find(n => n.id === id)
    if (node) return neighborIds(id)
    const edge = layout.edges.find(ed => ed.id === id)
    return edge ? [edge.id, edge.from, edge.to] : []
  }

  function clearSelection() {
    svg.classList.remove("has-selection")
    svg.querySelectorAll(".hl").forEach(el => el.classList.remove("hl"))
    panel.hidden = true
  }

  function showPanel(id) {
    const node = layout.nodes.find(n => n.id === id)
    const edge = node ? undefined : layout.edges.find(ed => ed.id === id)
    if (!node && !edge) return
    panel.hidden = false
    panelBody.textContent = ""
    const table = document.createElement("table")
    if (node) {
      panelTitle.textContent = node.label
      if (node.rows) {
        for (const row of node.rows) {
          const tr = document.createElement("tr")
          const td = document.createElement("td")
          td.textContent = row.text
          tr.appendChild(td)
          table.appendChild(tr)
        }
      } else {
        for (const [k, v] of Object.entries(node.meta ?? {})) {
          if (v === "" || v === undefined) continue
          const tr = document.createElement("tr")
          const td1 = document.createElement("td")
          const td2 = document.createElement("td")
          td1.textContent = k
          td2.textContent = String(v)
          tr.append(td1, td2)
          table.appendChild(tr)
        }
      }
    } else if (edge) {
      panelTitle.textContent = edge.label || edge.id
      const fields = [["from", edge.from], ["to", edge.to]]
      if (edge.cardinality) fields.push(["cardinality", edge.cardinality])
      if (edge.style) fields.push(["style", edge.style])
      for (const [k, v] of fields) {
        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        const td2 = document.createElement("td")
        td1.textContent = k
        td2.textContent = v || ""
        tr.append(td1, td2)
        table.appendChild(tr)
      }
    }
    panelBody.appendChild(table)
  }

  function select(id) {
    clearSelection()
    svg.classList.add("has-selection")
    markAll(relatedIds(id), "hl")
    showPanel(id)
  }

  function preview(id) {
    svg.classList.add("has-hover")
    markAll(relatedIds(id), "pv")
  }

  function clearPreview() {
    svg.classList.remove("has-hover")
    svg.querySelectorAll(".pv").forEach(el => el.classList.remove("pv"))
  }

  for (const item of document.querySelectorAll("[data-id]")) {
    item.addEventListener("click", () => select(item.dataset.id))
    item.addEventListener("pointerenter", () => preview(item.dataset.id))
    item.addEventListener("pointerleave", clearPreview)
  }
})()`

export function renderHtml(layout: Layout, spec: DiagramSpec): string {
  const { width, height } = extent(layout)
  const zonesSvg = (layout.zones ?? []).map(zoneSvg).join("\n")
  const linesSvg = (layout.lines ?? []).map(lineSvg).join("\n")
  const edgesSvg = layout.edges.map(edgeSvg).join("\n")
  const nodesSvg = layout.nodes.map(nodeSvg).join("\n")

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeXml(layout.title)}</title>
<style>
:root{color-scheme:light;}
*{box-sizing:border-box;}
body{margin:0;font-family:${THEME.fontFamily};display:flex;height:100vh;}
main{flex:1;overflow:hidden;background:#F1F5F9;}
svg{width:100%;height:100%;cursor:grab;}
svg.panning{cursor:grabbing;}
${paletteCss()}
.node-card{fill:var(--fill,${THEME.palette.generic.fill});stroke:var(--stroke,${THEME.palette.generic.stroke});stroke-width:1.5;filter:url(#soft-shadow);}
.node-header{fill:var(--stroke,${THEME.palette.generic.stroke});opacity:.12;}
.node-title{font-weight:600;font-size:13px;fill:var(--text,${THEME.palette.generic.text});}
.node-icon svg{width:${ICON_SIZE}px;height:${ICON_SIZE}px;color:var(--icon,${THEME.palette.generic.icon});}
.row-bg{fill:transparent;}
.row-text{font-size:12px;fill:#1F2937;}.badge{font-weight:700}.badge-pk{fill:#F59E0B}.badge-fk{fill:#8B5CF6}.badge-unique{fill:#0EA5E9}
.edge polyline{stroke:${THEME.edge};stroke-width:1.5;fill:none;}
.edge.return polyline{stroke-dasharray:6 4;}
.edge-label-bg{fill:${THEME.labelBackground};stroke:#E2E8F0;}
.edge-label text{font-size:11px;fill:#334155;}
.node,.edge{transition:opacity .15s;}
svg.has-selection .node:not(.hl),svg.has-selection .edge:not(.hl){opacity:.25;}
svg.has-hover .node:not(.pv):not(.hl),svg.has-hover .edge:not(.pv):not(.hl){opacity:.5;}
.hl .node-card,.pv .node-card{stroke-width:2.5;}
.hl polyline,.pv polyline{stroke:#1a63c9;stroke-width:2.5;}
.zone-bg{fill:${THEME.zone.fill};stroke:${THEME.zone.stroke};}
.zone-chip-bg{fill:${THEME.zone.chip};}
.zone-chip-text{font-size:12px;font-weight:600;fill:#334155;}
.lifeline{stroke:#94A3B8;stroke-dasharray:6 4;}
aside{width:280px;border-left:1px solid #E2E8F0;padding:16px;overflow-y:auto;background:#fff;}
aside h2{font-size:14px;margin:0 0 12px;}
aside table{width:100%;border-collapse:collapse;font-size:12px;}
aside td{border-bottom:1px solid #F1F5F9;padding:6px 4px;}
</style>
</head>
<body>
<main>
<svg id="canvas" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<defs>
<filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#0F172A" flood-opacity=".12"/></filter>
<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${THEME.edge}"/></marker>
<marker id="arrow-open" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="${THEME.edge}"/></marker>
</defs>
<g class="viewport" transform="translate(${PAD},${PAD})">
<g id="zones">
${zonesSvg}
</g>
<g id="lines">
${linesSvg}
</g>
<g id="edges">
${edgesSvg}
</g>
<g id="nodes">
${nodesSvg}
</g>
</g>
</svg>
</main>
<aside id="panel" hidden>
<h2 id="panel-title"></h2>
<div id="panel-body"></div>
</aside>
<script type="application/json" id="design-spec">${embed(spec)}</script>
<script type="application/json" id="design-layout">${embed(layout)}</script>
<script>
${INTERACTION_SCRIPT}
</script>
</body>
</html>
`
}
