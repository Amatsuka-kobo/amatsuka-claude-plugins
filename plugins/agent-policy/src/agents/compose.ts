import {
  type Fragment,
  loadCommon,
  loadFragments,
  type Vendor
} from "./fragments"
import {
  allowsAgentTool,
  hasMixedKinds,
  type RoleId,
  sortRoleIds
} from "./roles"

export interface ComposeInput {
  name: string
  model: string
  vendor: Vendor
  roleIds: RoleId[]
  fragmentDirs: string[]
  color?: string
}

export interface RolesSummary {
  ids: string[]
  implRoles: string[]
  readonlyRoles: string[]
  mixedKinds: boolean
  agentTool: boolean
}

const COLORS: Record<Vendor, string> = {
  gpt: "yellow",
  grok: "red",
  claude: "blue"
}

const BODY_ORDER = [
  "## When to invoke",
  "## Core Responsibilities",
  "## 作業手順"
] as const

export function compose(input: ComposeInput): string {
  const common = loadCommon(input.fragmentDirs)
  const { ids: ordered, selected } = selectFragments(input)
  const withAgent = allowsAgentTool(input.roleIds)
  const tools = resolveToolsFor(selected, withAgent)

  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${describe(selected)}`,
    `model: ${input.model}`,
    `color: ${input.color ?? COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    `agent-policy-role: ${ordered.join(", ")}`,
    "---",
    ""
  ]

  const body: string[] = []
  body.push(...preamble(common, input.name, selected), "")

  for (const heading of BODY_ORDER) {
    const items = selected.flatMap(
      (fragment) => fragment.sections.get(heading) ?? []
    )
    if (items.length === 0) continue
    body.push(heading, "", ...items, "")
  }

  if (withAgent) {
    const advisor = common.get("## アドバイザーへの相談")
    if (advisor !== undefined)
      body.push("## アドバイザーへの相談", "", ...advisor, "")
  }

  const constraints = [
    ...(withAgent ? (common.get("## Agent tool の制約") ?? []) : []),
    ...(common.get("## 制約") ?? []),
    ...selected.flatMap((fragment) => fragment.sections.get("## 制約") ?? [])
  ]
  if (constraints.length > 0) body.push("## 制約", "", ...constraints, "")

  body.push("## Output Format", "")
  if (selected.length === 1) {
    body.push(...(selected[0]?.sections.get("## Output Format") ?? []), "")
  } else {
    for (const fragment of selected) {
      const items = fragment.sections.get("## Output Format")
      if (items === undefined || items.length === 0) continue
      body.push(`### ${fragment.label}`, "", ...items, "")
    }
  }

  return `${[...head, ...body]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`
}

export function describeRoles(input: ComposeInput): RolesSummary {
  const { ids, selected } = selectFragments(input)
  const implRoles = selected
    .filter((fragment) => fragment.kind === "impl")
    .map((fragment) => fragment.id)
  const readonlyRoles = selected
    .filter((fragment) => fragment.kind === "readonly")
    .map((fragment) => fragment.id)

  return {
    ids,
    implRoles,
    readonlyRoles,
    mixedKinds: hasMixedKinds(selected.map((fragment) => fragment.kind)),
    agentTool: allowsAgentTool(input.roleIds)
  }
}

function selectFragments(input: ComposeInput): {
  ids: RoleId[]
  selected: Fragment[]
} {
  const fragments = loadFragments(input.fragmentDirs, input.vendor)
  const ids = sortRoleIds(input.roleIds)
  const selected = ids.map((id) => {
    const fragment = fragments.get(id)
    if (fragment === undefined) throw new Error(`Unknown role id: ${id}`)
    return fragment
  })
  return { ids, selected }
}

// プロジェクト側の置き換えを tools にも反映するため、解決後の断片から組み立てる。
// Agent は断片の申告を採らず、許可対象の役割を含むときだけ末尾へ置く。
function resolveToolsFor(selected: Fragment[], withAgent: boolean): string[] {
  const tools: string[] = []
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (tool !== "Agent" && !tools.includes(tool)) tools.push(tool)
    }
  }
  if (withAgent) tools.push("Agent")
  return tools
}

function describe(selected: Fragment[]): string {
  const list = selected.map((fragment) => fragment.description).join("、")
  return `Use this agent when ${list}を委譲するとき。詳細は本文の「When to invoke」を参照。`
}

function preamble(
  common: Map<string, string[]>,
  name: string,
  selected: Fragment[]
): string[] {
  const labels = selected.map((fragment) => `「${fragment.label}」`).join("、")
  return (common.get("## Preamble") ?? []).map((line) =>
    line.replace("{{NAME}}", name).replace("{{ROLE_LABELS}}", labels)
  )
}
