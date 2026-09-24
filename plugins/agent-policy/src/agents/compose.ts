import {
  type Fragment,
  type FragmentDir,
  loadCommon,
  loadFragments,
  type Vendor
} from "./fragments"
import { allowsAgentTool, type Lang } from "./policies"
import { hasMixedKinds, type RoleId, sortRoleIds } from "./roles"
import { type Vocabulary, vocabularyFor } from "./vocabulary"

export interface ComposeInput {
  name: string
  model: string
  vendor: Vendor
  roleIds: RoleId[]
  fragmentDirs: FragmentDir[]
  lang: Lang
  color?: string
  mcpServers?: string[]
  denyTools?: string[]
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
  claude: "blue",
  none: "blue"
}

export function compose(input: ComposeInput): string {
  const vocabulary = vocabularyFor(input.lang)
  const common = loadCommon(input.fragmentDirs)
  const { ids: ordered, selected } = selectFragments(input)
  const withAgent = allowsAgentTool(input.roleIds)
  const tools = resolveToolsFor(selected, withAgent, input.mcpServers ?? [])
  const denyTools = input.denyTools ?? []

  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${describe(selected, vocabulary)}`,
    `model: ${input.model}`,
    `color: ${input.color ?? COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    ...(denyTools.length > 0
      ? [`disallowedTools: ${denyTools.join(", ")}`]
      : []),
    `agent-policy-role: ${ordered.join(", ")}`,
    ...(input.vendor === "none"
      ? []
      : [`agent-policy-vendor: ${input.vendor}`]),
    "---",
    ""
  ]

  const body: string[] = []
  body.push(...preamble(common, input.name, selected, vocabulary), "")

  for (const heading of vocabulary.bodyOrder) {
    const items = selected.flatMap(
      (fragment) => fragment.sections.get(heading) ?? []
    )
    if (items.length === 0) continue
    body.push(heading, "", ...items, "")
  }

  if (withAgent) {
    const advisor = common.get(vocabulary.advisorHeading)
    if (advisor !== undefined)
      body.push(vocabulary.advisorHeading, "", ...advisor, "")
  }

  const writing = common.get(vocabulary.writingHeading)
  if (writing !== undefined)
    body.push(vocabulary.writingHeading, "", ...writing, "")

  const constraints = [
    ...(withAgent ? (common.get(vocabulary.agentConstraintHeading) ?? []) : []),
    ...(common.get(vocabulary.constraintHeading) ?? []),
    ...selected.flatMap(
      (fragment) => fragment.sections.get(vocabulary.constraintHeading) ?? []
    )
  ]
  if (constraints.length > 0)
    body.push(vocabulary.constraintHeading, "", ...constraints, "")

  body.push(vocabulary.outputFormatHeading, "")
  if (selected.length === 1) {
    body.push(
      ...(selected[0]?.sections.get(vocabulary.outputFormatHeading) ?? []),
      ""
    )
  } else {
    for (const fragment of selected) {
      const items = fragment.sections.get(vocabulary.outputFormatHeading)
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
  const vendor = input.vendor === "none" ? undefined : input.vendor
  const fragments = loadFragments(input.fragmentDirs, vendor)
  const ids = sortRoleIds(input.roleIds)
  const selected = ids.map((id) => {
    const fragment = fragments.get(id)
    if (fragment === undefined) throw new Error(`Unknown role id: ${id}`)
    return fragment
  })
  return { ids, selected }
}

// MCP サーバーはサーバー単位で末尾へ足す。Agent はその手前へ置く。
// mcpServers には mcp__ プレフィックス付きの完成した名前を渡す。
function resolveToolsFor(
  selected: Fragment[],
  withAgent: boolean,
  mcpServers: string[]
): string[] {
  const tools: string[] = []
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (tool !== "Agent" && !tools.includes(tool)) tools.push(tool)
    }
  }
  if (withAgent) tools.push("Agent")
  for (const server of mcpServers) {
    if (!tools.includes(server)) tools.push(server)
  }
  return tools
}

function describe(selected: Fragment[], vocabulary: Vocabulary): string {
  const list = selected
    .map((fragment) => fragment.description)
    .join(vocabulary.listSeparator)
  return vocabulary.describe(list)
}

function preamble(
  common: Map<string, string[]>,
  name: string,
  selected: Fragment[],
  vocabulary: Vocabulary
): string[] {
  const labels = selected
    .map((fragment) => vocabulary.quote(fragment.label))
    .join(vocabulary.listSeparator)
  return (common.get("## Preamble") ?? []).map((line) =>
    line.replace("{{NAME}}", name).replace("{{ROLE_LABELS}}", labels)
  )
}
