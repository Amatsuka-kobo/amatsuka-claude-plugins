import type { DiagramSpec, KindKey, Layout, LayoutNode } from "./types.js"

const KNOWN = new Set<KindKey>([
  "generic",
  "user",
  "api",
  "data",
  "messaging",
  "external",
  "screen",
  "entity"
])

const ALIASES: Array<[RegExp, KindKey]> = [
  [/(user|actor|利用者|ユーザー)/i, "user"],
  [/(api|gateway|service|サーバー)/i, "api"],
  [/(db|database|postgres|mysql|データベース|storage)/i, "data"],
  [/(queue|topic|kafka|message|イベント)/i, "messaging"],
  [/(external|partner|vendor|外部|決済)/i, "external"],
  [/(screen|page|画面|start|end)/i, "screen"],
  [/(entity|table|master|テーブル)/i, "entity"]
]

function normalize(value: unknown): KindKey | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const direct = value.trim().toLowerCase() as KindKey
  if (KNOWN.has(direct)) return direct
  return ALIASES.find(([pattern]) => pattern.test(value))?.[1]
}

function findSource(
  spec: DiagramSpec,
  id: string
): { kind?: string; icon?: string } | undefined {
  switch (spec.type) {
    case "architecture":
      return spec.nodes.find((x) => x.id === id)
    case "screen-flow":
      return spec.screens.find((x) => x.id === id)
    case "er":
      return spec.entities.find((x) => x.name === id)
    case "sequence":
      return spec.actors.find((x) => x.id === id)
  }
}

function resolveKind(spec: DiagramSpec, node: LayoutNode): KindKey {
  const source = findSource(spec, node.id)
  if (source?.kind !== undefined) return normalize(source.kind) ?? "generic"
  if (spec.type === "screen-flow") return "screen"
  if (spec.type === "er") return "entity"
  if (spec.type === "sequence") return normalize(source?.kind) ?? "generic"
  for (const value of [source?.icon, node.label, node.meta.zone]) {
    const kind = normalize(value)
    if (kind) return kind
  }
  return "generic"
}

export function decorateLayout(spec: DiagramSpec, layout: Layout): Layout {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => ({
      ...node,
      kindKey: resolveKind(spec, node)
    }))
  }
}
