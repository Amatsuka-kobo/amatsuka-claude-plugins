import type { DiagramType } from "./types.js"

export const SUPPORTED_TYPES = [
  "er",
  "screen-flow",
  "architecture",
  "sequence"
] as const

const CARDINALITIES = ["1:1", "1:N", "N:1", "N:M"] as const

export function validateSpec(spec: unknown): string[] {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return ["spec: JSON オブジェクトではありません"]
  }
  const value = spec as Record<string, unknown>
  if (!SUPPORTED_TYPES.includes(value.type as DiagramType)) {
    return [
      `type: 未対応の図種 "${value.type}" です(対応: ${SUPPORTED_TYPES.join(", ")})`
    ]
  }
  const errors: string[] = []
  if (typeof value.title !== "string" || value.title.trim() === "") {
    errors.push("title: 必須です(空でない文字列)")
  }
  errors.push(...RULES[value.type as DiagramType](value))
  return errors
}

const RULES: Record<DiagramType, (spec: Record<string, unknown>) => string[]> =
  {
    er: validateEr,
    "screen-flow": validateScreenFlow,
    architecture: validateArchitecture,
    sequence: validateSequence
  }

function validateEr(spec: Record<string, unknown>): string[] {
  const errors: string[] = []
  const entities = spec.entities
  if (!Array.isArray(entities) || entities.length === 0) {
    errors.push("entities: 1 件以上のエンティティが必須です")
    return errors
  }
  const names = new Set<string>()
  entities.forEach((entity: unknown, i: number) => {
    const where = `entities[${i}]`
    if (entity === null || typeof entity !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const e = entity as Record<string, unknown>
    if (typeof e.name !== "string" || e.name.trim() === "") {
      errors.push(`${where}.name: 必須です(空でない文字列)`)
      return
    }
    if (names.has(e.name)) {
      errors.push(`${where}.name: "${e.name}" が重複しています`)
    }
    names.add(e.name)
    if (!Array.isArray(e.columns) || e.columns.length === 0) {
      errors.push(`${where}(${e.name}).columns: 1 件以上のカラムが必須です`)
      return
    }
    e.columns.forEach((column: unknown, j: number) => {
      if (column === null || typeof column !== "object") {
        errors.push(
          `entities(${e.name}).columns[${j}]: オブジェクトではありません`
        )
        return
      }
      const c = column as Record<string, unknown>
      if (typeof c.name !== "string" || c.name.trim() === "") {
        errors.push(
          `entities(${e.name}).columns[${j}].name: 必須です(空でない文字列)`
        )
      }
    })
  })
  const relations = spec.relations ?? []
  if (!Array.isArray(relations)) {
    errors.push("relations: 配列ではありません")
    return errors
  }
  relations.forEach((rel: unknown, i: number) => {
    const where = `relations[${i}]`
    if (rel === null || typeof rel !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const r = rel as Record<string, unknown>
    for (const end of ["from", "to"] as const) {
      if (!names.has(r[end] as string)) {
        errors.push(
          `${where}.${end}: エンティティ "${r[end]}" は entities に定義されていません`
        )
      }
    }
    if (
      !CARDINALITIES.includes(r.cardinality as (typeof CARDINALITIES)[number])
    ) {
      errors.push(
        `${where}.cardinality: "${r.cardinality}" は不正です(対応: ${CARDINALITIES.join(", ")})`
      )
    }
  })
  return errors
}

function validateScreenFlow(spec: Record<string, unknown>): string[] {
  const errors: string[] = []
  const screens = spec.screens
  if (!Array.isArray(screens) || screens.length === 0) {
    errors.push("screens: 1 件以上の画面が必須です")
    return errors
  }
  const ids = new Set<string>()
  screens.forEach((screen: unknown, i: number) => {
    const where = `screens[${i}]`
    if (screen === null || typeof screen !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const s = screen as Record<string, unknown>
    if (typeof s.id !== "string" || s.id.trim() === "") {
      errors.push(`${where}.id: 必須です(空でない文字列)`)
      return
    }
    if (ids.has(s.id)) {
      errors.push(`${where}.id: "${s.id}" が重複しています`)
    }
    ids.add(s.id)
  })
  const transitions = spec.transitions ?? []
  if (!Array.isArray(transitions)) {
    errors.push("transitions: 配列ではありません")
    return errors
  }
  transitions.forEach((t: unknown, i: number) => {
    const where = `transitions[${i}]`
    if (t === null || typeof t !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const tr = t as Record<string, unknown>
    for (const end of ["from", "to"] as const) {
      if (!ids.has(tr[end] as string)) {
        errors.push(
          `${where}.${end}: 画面 "${tr[end]}" は screens に定義されていません`
        )
      }
    }
  })
  return errors
}

function validateArchitecture(spec: Record<string, unknown>): string[] {
  const errors: string[] = []
  const nodes = spec.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push("nodes: 1 件以上のノードが必須です")
    return errors
  }
  const nodeIds = new Set<string>()
  nodes.forEach((node: unknown, i: number) => {
    const where = `nodes[${i}]`
    if (node === null || typeof node !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const n = node as Record<string, unknown>
    if (typeof n.id !== "string" || n.id.trim() === "") {
      errors.push(`${where}.id: 必須です(空でない文字列)`)
      return
    }
    if (nodeIds.has(n.id)) {
      errors.push(`${where}.id: "${n.id}" が重複しています`)
    }
    nodeIds.add(n.id)
  })
  const zones = spec.zones ?? []
  if (!Array.isArray(zones)) {
    errors.push("zones: 配列ではありません")
    return errors
  }
  const zoneIds = new Set<string>()
  const assigned = new Set<string>()
  zones.forEach((zone: unknown, i: number) => {
    const where = `zones[${i}]`
    if (zone === null || typeof zone !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const z = zone as Record<string, unknown>
    if (typeof z.id !== "string" || z.id.trim() === "") {
      errors.push(`${where}.id: 必須です(空でない文字列)`)
      return
    }
    if (zoneIds.has(z.id) || nodeIds.has(z.id)) {
      errors.push(
        `${where}.id: "${z.id}" が重複しています(ゾーン・ノード間で一意であること)`
      )
    }
    zoneIds.add(z.id)
    if (!Array.isArray(z.children) || z.children.length === 0) {
      errors.push(
        `${where}(${z.id}).children: 1 件以上のノード id の配列が必須です`
      )
      return
    }
    z.children.forEach((childId: unknown, j: number) => {
      if (!nodeIds.has(childId as string)) {
        errors.push(
          `zones(${z.id}).children[${j}]: ノード "${childId}" は nodes に定義されていません`
        )
        return
      }
      if (assigned.has(childId as string)) {
        errors.push(
          `zones(${z.id}).children[${j}]: ノード "${childId}" は複数のゾーンに属しています`
        )
      }
      assigned.add(childId as string)
    })
  })
  const edges = spec.edges ?? []
  if (!Array.isArray(edges)) {
    errors.push("edges: 配列ではありません")
    return errors
  }
  edges.forEach((edge: unknown, i: number) => {
    const where = `edges[${i}]`
    if (edge === null || typeof edge !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const e = edge as Record<string, unknown>
    for (const end of ["from", "to"] as const) {
      if (!nodeIds.has(e[end] as string)) {
        errors.push(
          `${where}.${end}: ノード "${e[end]}" は nodes に定義されていません`
        )
      }
    }
  })
  return errors
}

function validateSequence(spec: Record<string, unknown>): string[] {
  const errors: string[] = []
  const actors = spec.actors
  if (!Array.isArray(actors) || actors.length === 0) {
    errors.push("actors: 1 件以上のアクターが必須です")
    return errors
  }
  const ids = new Set<string>()
  actors.forEach((actor: unknown, i: number) => {
    const where = `actors[${i}]`
    if (actor === null || typeof actor !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const a = actor as Record<string, unknown>
    if (typeof a.id !== "string" || a.id.trim() === "") {
      errors.push(`${where}.id: 必須です(空でない文字列)`)
      return
    }
    if (ids.has(a.id)) {
      errors.push(`${where}.id: "${a.id}" が重複しています`)
    }
    ids.add(a.id)
  })
  const messages = spec.messages ?? []
  if (!Array.isArray(messages)) {
    errors.push("messages: 配列ではありません")
    return errors
  }
  messages.forEach((msg: unknown, i: number) => {
    const where = `messages[${i}]`
    if (msg === null || typeof msg !== "object") {
      errors.push(`${where}: オブジェクトではありません`)
      return
    }
    const m = msg as Record<string, unknown>
    for (const end of ["from", "to"] as const) {
      if (!ids.has(m[end] as string)) {
        errors.push(
          `${where}.${end}: アクター "${m[end]}" は actors に定義されていません`
        )
      }
    }
    if (m.from === m.to && ids.has(m.from as string)) {
      errors.push(`${where}: from と to が同一(自己メッセージ)は未対応です`)
    }
    if (
      m.style !== undefined &&
      !["async", "return"].includes(m.style as string)
    ) {
      errors.push(
        `${where}.style: "${m.style}" は不正です(対応: async, return、または省略=同期)`
      )
    }
  })
  return errors
}
