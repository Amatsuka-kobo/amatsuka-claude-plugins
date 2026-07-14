import type { ElkExtendedEdge, ElkLabel, ElkNode } from "elkjs"
import ELK from "elkjs/lib/elk.bundled.js"
import type {
  ArchitectureSpec,
  Box,
  ErSpec,
  Layout,
  LayoutEdge,
  LayoutNode,
  ScreenFlowSpec
} from "../types.js"

const elk = new ELK()
const BASE = {
  "elk.algorithm": "layered",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "56",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "18",
  "elk.layered.spacing.nodeNodeBetweenLayers": "72",
  "elk.padding": "[top=28,left=28,bottom=28,right=28]"
}

function edgeLabel(text: string): ElkLabel[] | undefined {
  return text
    ? [{ text, width: Math.max(48, text.length * 7 + 16), height: 18 }]
    : undefined
}

function points(edge: ElkExtendedEdge) {
  const sections = edge.sections ?? []
  if (!sections.length)
    throw new Error(`ELK edge ${edge.id} has no routed section`)
  return sections
    .flatMap((section, index) =>
      [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint
      ].slice(index ? 1 : 0)
    )
    .map(({ x, y }) => ({
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000
    }))
}

function labelBox(edge: ElkExtendedEdge): Box | undefined {
  const label = edge.labels?.[0]
  if (
    !label ||
    label.x === undefined ||
    label.y === undefined ||
    label.width === undefined ||
    label.height === undefined
  )
    return undefined
  return { x: label.x, y: label.y, width: label.width, height: label.height }
}

function elkEdges(
  edges: Array<{ from: string; to: string; label?: string }>,
  prefix: string
): ElkExtendedEdge[] {
  return edges.map((edge, index) => ({
    id: `${prefix}${index + 1}`,
    sources: [edge.from],
    targets: [edge.to],
    labels: edgeLabel(edge.label ?? "")
  }))
}

function layoutEdges(
  input: Array<{ from: string; to: string; label?: string }>,
  output: ElkExtendedEdge[],
  prefix: string,
  offsetFor: (edge: { from: string; to: string }) => {
    x: number
    y: number
  } = () => ({ x: 0, y: 0 })
): LayoutEdge[] {
  return input.map((edge, index) => {
    const routed = output.find((item) => item.id === `${prefix}${index + 1}`)
    if (!routed) throw new Error(`ELK edge ${prefix}${index + 1} is missing`)
    const offset = offsetFor(edge)
    const box = labelBox(routed)
    return {
      id: routed.id,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? "",
      style: "arrow",
      points: points(routed).map((point) => ({
        x: point.x + offset.x,
        y: point.y + offset.y
      })),
      labelBox: box
        ? { ...box, x: box.x + offset.x, y: box.y + offset.y }
        : undefined
    }
  })
}

export async function layoutScreenFlow(spec: ScreenFlowSpec): Promise<Layout> {
  const transitions = spec.transitions ?? []
  const root: ElkNode = {
    id: "root",
    layoutOptions: { ...BASE, "elk.direction": "RIGHT" },
    children: spec.screens.map((screen) => ({
      id: screen.id,
      width: 180,
      height: 60
    })),
    edges: elkEdges(
      transitions.map((item) => ({
        from: item.from,
        to: item.to,
        label: item.trigger
      })),
      "t"
    )
  }
  const result = await elk.layout(root)
  const resultById = new Map(
    (result.children ?? []).map((node) => [node.id, node])
  )
  const nodes: LayoutNode[] = spec.screens.map((screen) => {
    const placed = resultById.get(screen.id)
    if (!placed || placed.x === undefined || placed.y === undefined)
      throw new Error(`ELK node ${screen.id} is missing coordinates`)
    return {
      id: screen.id,
      label: screen.label ?? screen.id,
      shape:
        screen.kind === "start" || screen.kind === "end" ? "terminal" : "box",
      kindKey: "generic",
      x: placed.x,
      y: placed.y,
      width: placed.width ?? 180,
      height: placed.height ?? 60,
      meta: { group: screen.group ?? "", kind: screen.kind ?? "screen" }
    }
  })
  return {
    type: "screen-flow",
    title: spec.title,
    nodes,
    edges: layoutEdges(
      transitions.map((item) => ({
        from: item.from,
        to: item.to,
        label: item.trigger
      })),
      result.edges ?? [],
      "t"
    )
  }
}

function formatColumn(
  column: ErSpec["entities"][number]["columns"][number]
): string {
  const marks = [
    column.pk && "PK",
    column.fk && "FK",
    column.unique && "UQ"
  ].filter(Boolean)
  const prefix = marks.length ? `[${marks.join(",")}] ` : ""
  return column.type
    ? `${prefix}${column.name} : ${column.type}`
    : `${prefix}${column.name}`
}

export async function layoutEr(spec: ErSpec): Promise<Layout> {
  const relations = spec.relations ?? []
  const root: ElkNode = {
    id: "root",
    layoutOptions: { ...BASE, "elk.direction": "DOWN" },
    children: spec.entities.map((entity) => ({
      id: entity.name,
      width: 240,
      height: 36 + entity.columns.length * 28
    })),
    edges: relations.map((relation, index) => {
      const text = `${relation.cardinality} ${relation.label ?? ""}`.trim()
      return {
        id: `rel${index + 1}`,
        sources: [relation.from],
        targets: [relation.to],
        labels: [
          { text, width: Math.max(56, text.length * 7 + 16), height: 18 }
        ]
      }
    })
  }
  const result = await elk.layout(root)
  const placedById = new Map(
    (result.children ?? []).map((node) => [node.id, node])
  )
  const nodes: LayoutNode[] = spec.entities.map((entity) => {
    const placed = placedById.get(entity.name)
    if (!placed || placed.x === undefined || placed.y === undefined)
      throw new Error(`ELK entity ${entity.name} is missing coordinates`)
    return {
      id: entity.name,
      label: entity.label ?? entity.name,
      shape: "entity",
      kindKey: "generic",
      x: placed.x,
      y: placed.y,
      width: placed.width ?? 240,
      height: placed.height ?? 36 + entity.columns.length * 28,
      headerHeight: 36,
      rowHeight: 28,
      rows: entity.columns.map((column) => ({
        text: formatColumn(column),
        meta: {
          name: column.name,
          type: column.type ?? "",
          pk: column.pk === true,
          fk: column.fk === true,
          unique: column.unique === true
        }
      })),
      meta: {}
    }
  })
  const edges: LayoutEdge[] = relations.map((relation, index) => {
    const routed = (result.edges ?? []).find(
      (edge) => edge.id === `rel${index + 1}`
    )
    if (!routed) throw new Error(`ELK edge rel${index + 1} is missing`)
    return {
      id: `rel${index + 1}`,
      from: relation.from,
      to: relation.to,
      label: relation.label ?? "",
      cardinality: relation.cardinality,
      points: points(routed),
      labelBox: labelBox(routed)
    }
  })
  return { type: "er", title: spec.title, nodes, edges }
}

export async function layoutArchitecture(
  spec: ArchitectureSpec
): Promise<Layout> {
  const zones = spec.zones ?? []
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]))
  const zoned = new Set(zones.flatMap((zone) => zone.children))
  const edges = spec.edges ?? []
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      ...BASE,
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN"
    },
    children: [
      ...zones.map((zone) => ({
        id: `zone:${zone.id}`,
        layoutOptions: {
          ...BASE,
          "elk.direction": "DOWN",
          "elk.padding": "[top=52,left=28,bottom=28,right=28]"
        },
        children: zone.children.map((id) => ({ id, width: 160, height: 68 }))
      })),
      ...spec.nodes
        .filter((node) => !zoned.has(node.id))
        .map((node) => ({ id: node.id, width: 160, height: 68 }))
    ],
    edges: elkEdges(edges, "e")
  }
  const result = await elk.layout(root)
  const nodes: LayoutNode[] = []
  const layoutZones: Array<Box & { id: string; label: string }> = []
  const placedZones = new Map(zones.map((zone) => [`zone:${zone.id}`, zone]))
  for (const child of result.children ?? []) {
    const x = child.x ?? 0
    const y = child.y ?? 0
    const zone = placedZones.get(child.id)
    if (zone) {
      layoutZones.push({
        id: zone.id,
        label: zone.label ?? zone.id,
        x,
        y,
        width: child.width ?? 0,
        height: child.height ?? 0
      })
      for (const nested of child.children ?? []) {
        const source = nodeById.get(nested.id)
        if (!source)
          throw new Error(`architecture node ${nested.id} is missing`)
        nodes.push({
          id: source.id,
          label: source.label ?? source.id,
          shape: "box",
          kindKey: "generic",
          x: x + (nested.x ?? 0),
          y: y + (nested.y ?? 0),
          width: nested.width ?? 160,
          height: nested.height ?? 68,
          meta: { icon: source.icon ?? "", zone: zone.id }
        })
      }
    } else {
      const source = nodeById.get(child.id)
      if (!source) throw new Error(`architecture node ${child.id} is missing`)
      nodes.push({
        id: source.id,
        label: source.label ?? source.id,
        shape: "box",
        kindKey: "generic",
        x,
        y,
        width: child.width ?? 160,
        height: child.height ?? 68,
        meta: { icon: source.icon ?? "", zone: "" }
      })
    }
  }
  return {
    type: "architecture",
    title: spec.title,
    zones: layoutZones,
    nodes,
    edges: layoutEdges(edges, result.edges ?? [], "e", (edge) => {
      const fromZone = zones.find((zone) => zone.children.includes(edge.from))
      const toZone = zones.find((zone) => zone.children.includes(edge.to))
      if (!fromZone || fromZone.id !== toZone?.id) return { x: 0, y: 0 }
      const placed = layoutZones.find((zone) => zone.id === fromZone.id)
      return placed ? { x: placed.x, y: placed.y } : { x: 0, y: 0 }
    })
  }
}
