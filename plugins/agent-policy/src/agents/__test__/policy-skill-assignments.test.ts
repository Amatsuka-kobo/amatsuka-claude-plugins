import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  ASSIGNMENTS,
  type ModelId,
  type PolicyName,
  RECOMMENDED
} from "../policies"
import { ROLES, type RoleId } from "../roles"

const POLICY_SKILLS = {
  "claude-model-policy": {
    skillPath: fileURLToPath(
      new URL("../../../skills/claude-model-policy/SKILL.md", import.meta.url)
    ),
    sectionHeading: "モデル別役割",
    expectedAssignments: ASSIGNMENTS["claude-model-policy"],
    expectedAssignmentsName: "ASSIGNMENTS"
  },
  "custom-policy": {
    skillPath: fileURLToPath(
      new URL("../../../skills/custom-policy/SKILL.md", import.meta.url)
    ),
    sectionHeading: "役割の帯と推奨モデル",
    expectedAssignments: RECOMMENDED,
    expectedAssignmentsName: "RECOMMENDED"
  }
} satisfies Record<
  PolicyName,
  {
    skillPath: string
    sectionHeading: string
    expectedAssignments: Record<RoleId, ModelId[]>
    expectedAssignmentsName: string
  }
>

const MODEL_IDS = {
  Opus: "opus",
  Sonnet: "sonnet",
  Haiku: "haiku",
  Fable: "fable",
  "GPT Sol": "gpt-sol",
  "GPT Terra": "gpt-terra",
  "GPT Luna": "gpt-luna",
  "GPT Astra": "gpt-astra",
  Grok: "grok"
} as const satisfies Record<string, ModelId>

// 表の解析だけを切り出す。未知のモデル語で落ちることを合成入力で検証するため、
// ファイル読み込みと分けている。方針スキルの散文を編集したときに壊れうるのは
// この経路であり、実データの 2 本では発火しない。
function parseTable(
  policy: PolicyName,
  section: string
): Map<RoleId, ModelId[]> {
  const assignments = new Map<RoleId, ModelId[]>()
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue
    const [roleCell, modelCell] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (roleCell === undefined || modelCell === undefined) continue

    const normalizedRoleCell = roleCell.replace(/\s/g, "")
    const matchingRoles = ROLES.filter((role) =>
      normalizedRoleCell.startsWith(role.label.replace(/\s/g, ""))
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

function parseSkillAssignments(
  policy: PolicyName,
  skillPath: string,
  sectionHeading: string
): Map<RoleId, ModelId[]> {
  const content = fs.readFileSync(skillPath, "utf8")
  const section = content
    .split(`## ${sectionHeading}\n`)[1]
    ?.split(/\n## /, 1)[0]
  if (section === undefined) {
    throw new Error(`${policy}: SKILL の「${sectionHeading}」節が見つからない`)
  }
  return parseTable(policy, section)
}

function assertSameAssignment(
  policy: PolicyName,
  role: RoleId,
  skillModels: ModelId[] | undefined,
  assignmentModels: ModelId[],
  assignmentName: string
): void {
  const skill = [...(skillModels ?? [])].sort()
  const assignments = [...assignmentModels].sort()
  if (JSON.stringify(skill) !== JSON.stringify(assignments)) {
    throw new Error(
      `${policy}/${role}: SKILL=${JSON.stringify(skill)} ${assignmentName}=${JSON.stringify(assignments)}`
    )
  }
}

describe("担当表の解析", () => {
  // 対応表に無いモデル語を黙って捨てると、SKILL 側の行が丸ごと欠けたまま
  // ASSIGNMENTS と一致してしまい、二重管理の検出が効かなくなる。
  it("対応表に無いモデル語で落ちる", () => {
    const section = "| コードレビュー | `Claude 5` |"
    expect(() => parseTable("claude-model-policy", section)).toThrow(
      /未知のモデル「Claude 5」/
    )
  })

  it("対応表にあるモデル語は通る", () => {
    const section = "| コードレビュー | `Sonnet` |"
    expect(
      parseTable("claude-model-policy", section).get("code-review")
    ).toEqual(["sonnet"])
  })
})

describe("方針 SKILL の担当表", () => {
  for (const policy of Object.keys(POLICY_SKILLS) as PolicyName[]) {
    const {
      skillPath,
      sectionHeading,
      expectedAssignments,
      expectedAssignmentsName
    } = POLICY_SKILLS[policy]

    it(`${policy} が ${expectedAssignmentsName} の全 16 役割と一致する`, () => {
      const skillAssignments = parseSkillAssignments(
        policy,
        skillPath,
        sectionHeading
      )
      for (const role of ROLES) {
        assertSameAssignment(
          policy,
          role.id,
          skillAssignments.get(role.id),
          expectedAssignments[role.id],
          expectedAssignmentsName
        )
      }
    })
  }
})
