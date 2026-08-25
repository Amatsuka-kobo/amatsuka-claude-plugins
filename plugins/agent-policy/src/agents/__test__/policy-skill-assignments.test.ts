import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"
import { ASSIGNMENTS, type ModelId, type PolicyName } from "../policies"
import { ROLES, type RoleId } from "../roles"

const POLICY_SKILLS: Record<PolicyName, string> = {
  "claude-model-policy": fileURLToPath(
    new URL("../../../skills/claude-model-policy/SKILL.md", import.meta.url)
  ),
  "with-codex-policy": fileURLToPath(
    new URL("../../../skills/with-codex-policy/SKILL.md", import.meta.url)
  ),
  "with-grok-policy": fileURLToPath(
    new URL("../../../skills/with-grok-policy/SKILL.md", import.meta.url)
  ),
  "codex-grok-policy": fileURLToPath(
    new URL("../../../skills/codex-grok-policy/SKILL.md", import.meta.url)
  )
}

const MODEL_IDS = {
  Opus: "opus",
  Sonnet: "sonnet",
  Haiku: "haiku",
  Fable: "fable",
  "GPT Sol": "gpt-sol",
  "GPT Terra": "gpt-terra",
  "GPT Luna": "gpt-luna",
  Grok: "grok"
} as const satisfies Record<string, ModelId>

function parseSkillAssignments(policy: PolicyName): Map<RoleId, ModelId[]> {
  const content = fs.readFileSync(POLICY_SKILLS[policy], "utf8")
  const section = content.split("## モデル別役割\n")[1]?.split(/\n## /, 1)[0]
  if (section === undefined) {
    throw new Error(`${policy}: SKILL の「モデル別役割」節が見つからない`)
  }

  const assignments = new Map<RoleId, ModelId[]>()
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue
    const [roleCell, modelCell] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (roleCell === undefined || modelCell === undefined) continue

    const matchingRoles = ROLES.filter((role) =>
      roleCell.startsWith(role.label)
    )
    if (matchingRoles.length === 0) continue
    if (matchingRoles.length > 1) {
      throw new Error(
        `${policy}: SKILL の役割「${roleCell}」が複数の label に前方一致した: ${matchingRoles.map((role) => role.id).join(", ")}`
      )
    }

    const modelIds = [...modelCell.matchAll(/`([^`]+)`/g)].map((match) => {
      const token = match[1]
      const modelId = MODEL_IDS[token as keyof typeof MODEL_IDS]
      if (modelId === undefined) {
        throw new Error(
          `${policy}/${matchingRoles[0].id}: SKILL に未知のモデル「${token}」がある`
        )
      }
      return modelId
    })
    assignments.set(matchingRoles[0].id, modelIds)
  }
  return assignments
}

function assertSameAssignment(
  policy: PolicyName,
  role: RoleId,
  skillModels: ModelId[] | undefined,
  assignmentModels: ModelId[]
): void {
  const skill = [...(skillModels ?? [])].sort()
  const assignments = [...assignmentModels].sort()
  if (JSON.stringify(skill) !== JSON.stringify(assignments)) {
    throw new Error(
      `${policy}/${role}: SKILL=${JSON.stringify(skill)} ASSIGNMENTS=${JSON.stringify(assignments)}`
    )
  }
}

describe("方針 SKILL の担当表", () => {
  for (const policy of Object.keys(POLICY_SKILLS) as PolicyName[]) {
    it(`${policy} が ASSIGNMENTS の全 10 役割と一致する`, () => {
      const skillAssignments = parseSkillAssignments(policy)
      for (const role of ROLES) {
        assertSameAssignment(
          policy,
          role.id,
          skillAssignments.get(role.id),
          ASSIGNMENTS[policy][role.id]
        )
      }
    })
  }
})
