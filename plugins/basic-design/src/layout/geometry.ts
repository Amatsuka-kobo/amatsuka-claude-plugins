import type { Box, Layout, Point } from "../types.js"

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  if (a.y === b.y) return a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
  throw new Error(`non-orthogonal segment: ${JSON.stringify([a, b])}`)
}

export function assertLayoutHasNoOverlaps(layout: Layout): string[] {
  const errors: string[] = []
  for (let i = 0; i < layout.nodes.length; i++)
    for (let j = i + 1; j < layout.nodes.length; j++)
      if (boxesOverlap(layout.nodes[i], layout.nodes[j])) errors.push(`node-node:${layout.nodes[i].id}:${layout.nodes[j].id}`)
  const labels = layout.edges.flatMap((edge) => (edge.labelBox ? [{ id: edge.id, box: edge.labelBox }] : []))
  for (const label of labels)
    for (const node of layout.nodes) if (boxesOverlap(label.box, node)) errors.push(`label-node:${label.id}:${node.id}`)
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      if (boxesOverlap(labels[i].box, labels[j].box)) errors.push(`label-label:${labels[i].id}:${labels[j].id}`)
  for (const edge of layout.edges)
    for (let i = 0; i < edge.points.length - 1; i++)
      for (const node of layout.nodes) {
        const a = { ...edge.points[i] }
        const b = { ...edge.points[i + 1] }
        if (node.id === edge.from && i === 0) {
          a.x += Math.sign(b.x - a.x)
          a.y += Math.sign(b.y - a.y)
        }
        if (node.id === edge.to && i === edge.points.length - 2) {
          b.x -= Math.sign(b.x - a.x)
          b.y -= Math.sign(b.y - a.y)
        }
        if (segmentHitsBox(a, b, node)) errors.push(`node-edge:${node.id}:${edge.id}:${i}`)
      }
  return errors
}
