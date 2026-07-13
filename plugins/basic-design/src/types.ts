export type DiagramType = "architecture" | "screen-flow" | "er" | "sequence"

export type KindKey = "generic" | "user" | "api" | "data" | "messaging" | "external" | "screen" | "entity"

export type Point = { x: number; y: number }

export type Box = Point & { width: number; height: number }

export interface LayoutNode extends Box {
  id: string
  label: string
  shape: "box" | "terminal" | "actor" | "entity"
  kindKey: KindKey
  meta: Record<string, unknown>
  headerHeight?: number
  rowHeight?: number
  rows?: Array<{ text: string; meta: Record<string, unknown> }>
}

export interface LayoutEdge {
  id: string
  from: string
  to: string
  label: string
  style?: "arrow" | "sync" | "async" | "return"
  cardinality?: "1:1" | "1:N" | "N:1" | "N:M"
  points: Point[]
  labelBox?: Box
}

export interface Layout {
  type: DiagramType
  title: string
  nodes: LayoutNode[]
  zones?: Array<Box & { id: string; label: string }>
  lines?: Array<{ x: number; y1: number; y2: number; owner: string }>
  edges: LayoutEdge[]
}

export interface ArchitectureSpec {
  type: "architecture"
  title: string
  zones?: Array<{ id: string; label?: string; children: string[] }>
  nodes: Array<{ id: string; label?: string; icon?: string; kind?: string }>
  edges?: Array<{ from: string; to: string; label?: string }>
}

export interface ScreenFlowSpec {
  type: "screen-flow"
  title: string
  screens: Array<{ id: string; label?: string; group?: string; kind?: string }>
  transitions?: Array<{ from: string; to: string; trigger?: string }>
}

export interface ErSpec {
  type: "er"
  title: string
  entities: Array<{
    name: string
    label?: string
    kind?: string
    columns: Array<{ name: string; type?: string; pk?: boolean; fk?: boolean; unique?: boolean }>
  }>
  relations?: Array<{ from: string; to: string; label?: string; cardinality: "1:1" | "1:N" | "N:1" | "N:M" }>
}

export interface SequenceSpec {
  type: "sequence"
  title: string
  actors: Array<{ id: string; label?: string; kind?: string }>
  messages?: Array<{ from: string; to: string; label?: string; style?: "async" | "return" }>
}

export type DiagramSpec = ArchitectureSpec | ScreenFlowSpec | ErSpec | SequenceSpec
