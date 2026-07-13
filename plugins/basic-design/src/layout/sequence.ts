import type { Layout, LayoutEdge, LayoutNode, SequenceSpec } from "../types.js"

const ACTOR_WIDTH = 140
const ACTOR_HEIGHT = 50
const ACTOR_GAP = 80
const MESSAGE_GAP = 64
const TAIL = 30

export async function layoutSequence(spec: SequenceSpec): Promise<Layout> {
  const messages = spec.messages ?? []
  const bottomY = ACTOR_HEIGHT + (messages.length + 1) * MESSAGE_GAP + TAIL
  const center = new Map<string, number>()

  const nodes: LayoutNode[] = spec.actors.map((actor, i) => {
    const x = i * (ACTOR_WIDTH + ACTOR_GAP)
    center.set(actor.id, x + ACTOR_WIDTH / 2)
    return {
      id: actor.id,
      label: actor.label ?? actor.id,
      shape: "actor",
      x,
      y: 0,
      width: ACTOR_WIDTH,
      height: ACTOR_HEIGHT,
      kindKey: "generic",
      meta: { kind: actor.kind ?? "system" },
    }
  })

  const lines = spec.actors.map((actor) => ({
    x: center.get(actor.id)!,
    y1: ACTOR_HEIGHT,
    y2: bottomY,
    owner: actor.id,
  }))

  const edges: LayoutEdge[] = messages.map((msg, i) => {
    const y = ACTOR_HEIGHT + (i + 1) * MESSAGE_GAP
    const points = [
      { x: center.get(msg.from)!, y },
      { x: center.get(msg.to)!, y },
    ]
    const width = Math.max(48, (msg.label ?? "").length * 7 + 16)
    return {
      id: `msg${i + 1}`,
      from: msg.from,
      to: msg.to,
      label: msg.label ?? "",
      style: msg.style === "return" ? "return" : msg.style === "async" ? "async" : "sync",
      points,
      labelBox: msg.label
        ? { x: (points[0].x + points[1].x - width) / 2, y: y - 22, width, height: 18 }
        : undefined,
    }
  })

  return { type: "sequence", title: spec.title, nodes, lines, edges }
}
