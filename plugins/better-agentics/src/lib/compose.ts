import { parseDocument } from "./document"
import { loadFragments, loadPreamble, vocabularyFor } from "./fragments"
import { encodeRecord, type HashRecord, textHash } from "./hash"
import type { ClaudeModel, Effort, RoleId } from "./roles"

export const ROLE_KEY = "better-agentics-role"
export const HASH_KEY = "better-agentics-hash"

export interface ComposeInput {
  name: string
  roleId: RoleId
  model: ClaudeModel
  /** undefined なら effort 行を書かない */
  effort: Effort | undefined
  lang: string
  pluginRoot: string
  projectDir: string
  /** "mcp__<server>" の完成した名前。tools の末尾に足す */
  mcpTools: string[]
  /** 空でなければ disallowedTools 行を書く */
  denyTools: string[]
}

export function compose(input: ComposeInput): string {
  const fragment = loadFragments(
    input.pluginRoot,
    input.projectDir,
    input.lang
  ).get(input.roleId)
  if (fragment === undefined)
    throw new Error(`Unknown role id: ${input.roleId}`)

  const tools = [...fragment.tools]
  for (const tool of input.mcpTools) if (!tools.includes(tool)) tools.push(tool)

  const preamble = loadPreamble(input.pluginRoot, input.projectDir, input.lang)
    .map((line) =>
      line
        .replace("{{NAME}}", input.name)
        .replace("{{ROLE_LABEL}}", fragment.label)
    )
    .join("\n")
    .trim()

  const body: string[] = [preamble, ""]
  for (const heading of vocabularyFor(input.lang).bodyOrder) {
    const lines = fragment.sections.get(heading)
    if (lines === undefined || lines.length === 0) continue
    body.push(heading, "", ...lines, "")
  }
  const bodyText = body
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()

  // 再生成で利用者の編集を見分けるため、書き込んだ値のハッシュを記録する。
  const parsed = parseDocument(`---\n---\n${bodyText}\n`)
  const record: HashRecord = {
    description: textHash(fragment.description),
    preamble: textHash(parsed.preamble),
    sections: Object.fromEntries(
      [...parsed.sections].map(([heading, text]) => [heading, textHash(text)])
    )
  }

  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${fragment.description}`,
    `model: ${input.model}`,
    ...(input.effort === undefined ? [] : [`effort: ${input.effort}`]),
    `tools: ${tools.join(", ")}`,
    ...(input.denyTools.length > 0
      ? [`disallowedTools: ${input.denyTools.join(", ")}`]
      : []),
    `${ROLE_KEY}: ${input.roleId}`,
    `${HASH_KEY}: ${encodeRecord(record)}`,
    "---",
    ""
  ]
  return `${[...head, bodyText].join("\n")}\n`
}
