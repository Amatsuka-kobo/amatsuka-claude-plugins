import type { Layout, LayoutEdge, LayoutNode } from "../types.js"
import { THEME } from "../theme.js"
import { escapeXml } from "../xml-util.js"
import { iconEmoji } from "./icons.js"

const CARDINALITY_ARROWS: Record<NonNullable<LayoutEdge["cardinality"]>, [string, string]> = {
  "1:1": ["ERone", "ERone"],
  "1:N": ["ERone", "ERmany"],
  "N:1": ["ERmany", "ERone"],
  "N:M": ["ERmany", "ERmany"],
}

const EDGE_STYLES: Record<NonNullable<LayoutEdge["style"]>, string> = {
  arrow: "rounded=0;endArrow=block;endFill=1;",
  sync: "rounded=0;endArrow=block;endFill=1;",
  async: "rounded=0;endArrow=open;endFill=0;",
  return: "rounded=0;dashed=1;endArrow=open;endFill=0;",
}

const ROW_STYLE = "text;html=1;strokeColor=#E2E8F0;fillColor=#FFFFFF;align=left;verticalAlign=middle;spacingLeft=10;fontSize=12;"
const LIFELINE_STYLE = `endArrow=none;dashed=1;strokeColor=#94A3B8;`
const ZONE_STYLE = `rounded=1;arcSize=8;fillColor=${THEME.zone.fill};strokeColor=${THEME.zone.stroke};verticalAlign=top;fontStyle=1;align=left;spacingLeft=8;`

function nodeStyle(node: LayoutNode): string {
  const t = THEME.palette[node.kindKey]
  const shapePart = node.shape === "terminal" ? "ellipse;" : "rounded=1;arcSize=16;"
  const fontPart = node.shape === "actor" ? "fontStyle=1;" : ""
  return `${shapePart}whiteSpace=wrap;html=1;shadow=1;fillColor=${t.fill};strokeColor=${t.stroke};fontColor=${t.text};${fontPart}`
}

function entityStyle(node: LayoutNode): string {
  const t = THEME.palette[node.kindKey]
  return (
    `swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${node.headerHeight ?? 30};` +
    `horizontalStack=0;resizeParent=0;collapsible=0;rounded=1;arcSize=8;shadow=1;` +
    `fillColor=${t.fill};strokeColor=${t.stroke};fontColor=${t.text};`
  )
}

function nodeValue(node: LayoutNode): string {
  return `${iconEmoji(node.kindKey)} ${escapeXml(node.label)}`
}

function nodeCell(node: LayoutNode): string {
  const nodeId = `n-${node.id}`
  if (node.rows) {
    const headerHeight = node.headerHeight ?? 0
    const rowHeight = node.rowHeight ?? 0
    const rows = node.rows.map((row, i) => {
      const rowY = headerHeight + i * rowHeight
      return (
        `<mxCell id="${escapeXml(node.id)}-row${i + 1}" value="${escapeXml(row.text)}" style="${ROW_STYLE}" vertex="1" parent="${escapeXml(nodeId)}">` +
        `<mxGeometry y="${rowY}" width="${node.width}" height="${rowHeight}" as="geometry"/>` +
        `</mxCell>`
      )
    })
    return (
      `<mxCell id="${escapeXml(nodeId)}" value="${escapeXml(node.label)}" style="${entityStyle(node)}" vertex="1" parent="1">` +
      `<mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry"/>` +
      `</mxCell>` +
      rows.join("")
    )
  }
  return (
    `<mxCell id="${escapeXml(nodeId)}" value="${nodeValue(node)}" style="${nodeStyle(node)}" vertex="1" parent="1">` +
    `<mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry"/>` +
    `</mxCell>`
  )
}

function zoneCell(zone: NonNullable<Layout["zones"]>[number]): string {
  return (
    `<mxCell id="${escapeXml(`z-${zone.id}`)}" value="${escapeXml(zone.label)}" style="${ZONE_STYLE}" vertex="1" parent="1">` +
    `<mxGeometry x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" as="geometry"/>` +
    `</mxCell>`
  )
}

function lineCell(line: NonNullable<Layout["lines"]>[number], index: number): string {
  return (
    `<mxCell id="l-${index + 1}" style="${LIFELINE_STYLE}" edge="1" parent="1">` +
    `<mxGeometry relative="1" as="geometry">` +
    `<mxPoint x="${line.x}" y="${line.y1}" as="sourcePoint"/>` +
    `<mxPoint x="${line.x}" y="${line.y2}" as="targetPoint"/>` +
    `</mxGeometry></mxCell>`
  )
}

function waypointXml(edge: LayoutEdge): string {
  const interior = edge.points.slice(1, -1)
  return interior.length ? `<Array as="points">${interior.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join("")}</Array>` : ""
}

function edgeStyleFor(edge: LayoutEdge): string {
  if (edge.cardinality) {
    const [startArrow, endArrow] = CARDINALITY_ARROWS[edge.cardinality]
    return `edgeStyle=entityRelationEdgeStyle;rounded=0;startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;`
  }
  return `edgeStyle=orthogonalEdgeStyle;${EDGE_STYLES[edge.style ?? "arrow"]}`
}

function edgeCell(edge: LayoutEdge): string {
  const style = edgeStyleFor(edge)
  return (
    `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(`n-${edge.from}`)}" target="${escapeXml(`n-${edge.to}`)}">` +
    `<mxGeometry relative="1" as="geometry">${waypointXml(edge)}</mxGeometry>` +
    `</mxCell>`
  )
}

export function renderDrawio(layout: Layout): string {
  const cells: string[] = []
  for (const zone of layout.zones ?? []) cells.push(zoneCell(zone))
  for (const node of layout.nodes) cells.push(nodeCell(node))
  ;(layout.lines ?? []).forEach((line, i) => cells.push(lineCell(line, i)))
  for (const edge of layout.edges) cells.push(edgeCell(edge))
  return (
    `<mxfile host="basic-design">` +
    `<diagram name="${escapeXml(layout.title)}">` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  )
}
