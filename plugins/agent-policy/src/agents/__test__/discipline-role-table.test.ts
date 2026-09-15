import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ASSIGNMENTS, allowsAgentTool, type ModelId } from "../policies"
import { ROLES, type RoleId } from "../roles"

const DISCIPLINE_PATH = fileURLToPath(
  new URL("../../../references/orchestration-discipline.md", import.meta.url)
)
const CLAUDE_MODEL_POLICY_PATH = fileURLToPath(
  new URL("../../../skills/claude-model-policy/SKILL.md", import.meta.url)
)
const CUSTOM_POLICY_PATH = fileURLToPath(
  new URL("../../../skills/custom-policy/SKILL.md", import.meta.url)
)

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

const TABLE_HEADER = ["役割名", "RoleId", "種別", "Agent Tool", "Claude モデル"]

interface ParsedRoleRow {
  label: string
  resolvedRoleId: RoleId
  roleId: RoleId
  kind: string
  agentTool: "可" | "否"
  models: ModelId[]
}

function extractRoleBandSection(content: string): string {
  const heading = /^## 担当表$/m.exec(content)
  if (heading === null) {
    throw new Error("規律の「担当表」節が見つからない")
  }

  const afterHeading = content.slice(heading.index + heading[0].length)
  const nextHeading = /^## /m.exec(afterHeading)
  return afterHeading.slice(0, nextHeading?.index)
}

function splitTableCells(line: string): string[] {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())
  if (cells.length !== 5) {
    throw new Error(`担当表は 5 セルでなければならない: ${line}`)
  }
  return cells
}

function extractSingleBacktickToken(cell: string, column: string): string {
  const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1])
  if (tokens.length !== 1) {
    throw new Error(`${column} セルはバッククォート語を 1 つ持つ必要がある`)
  }
  return tokens[0]
}

function parseRoleBandTable(section: string): ParsedRoleRow[] {
  const tableLines = section.split("\n").filter((line) => line.startsWith("|"))
  if (tableLines.length < 2) {
    throw new Error("担当表が見つからない")
  }

  const headerCells = splitTableCells(tableLines[0])
  if (!headerCells.every((cell, index) => cell === TABLE_HEADER[index])) {
    throw new Error("担当表ヘッダが不正")
  }

  const separatorCells = splitTableCells(tableLines[1])
  if (!separatorCells.every((cell) => /^-+$/.test(cell))) {
    throw new Error("担当表の区切り行が不正")
  }

  return tableLines.slice(2).map((line) => {
    const cells = splitTableCells(line)
    const label = cells[0]
    const role = ROLES.find((candidate) => candidate.label === label)
    if (role === undefined) {
      throw new Error(`役割名「${label}」を解決できない`)
    }

    const roleId = extractSingleBacktickToken(cells[1], "RoleId") as RoleId
    const kind = extractSingleBacktickToken(cells[2], "種別")
    const agentTool = cells[3]
    if (agentTool !== "可" && agentTool !== "否") {
      throw new Error(`Agent Tool セルの値が不正: ${agentTool}`)
    }

    const models = [...cells[4].matchAll(/`([^`]+)`/g)].map((match) => {
      const token = match[1]
      const modelId = MODEL_IDS[token as keyof typeof MODEL_IDS]
      if (modelId === undefined) {
        throw new Error(`未知のモデル「${token}」`)
      }
      return modelId
    })

    return {
      label,
      resolvedRoleId: role.id,
      roleId,
      kind,
      agentTool,
      models
    }
  })
}

function collectTableBlocks(section: string): string[][] {
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of section.split("\n")) {
    if (line.startsWith("|")) {
      current.push(line)
      continue
    }
    if (current.length > 0) {
      blocks.push(current)
      current = []
    }
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

function readDisciplineRows(): ParsedRoleRow[] {
  const content = fs.readFileSync(DISCIPLINE_PATH, "utf8")
  return parseRoleBandTable(extractRoleBandSection(content))
}

const SYNTHETIC_HEADER = `| ${TABLE_HEADER.join(" | ")} |\n| --- | --- | --- | --- | --- |`

// 規律の役割表が、実装側の役割定義と方針割り当てを漏れなく反映することを守る。
describe("規律の役割", () => {
  it("役割節が表を 1 つ持つ", () => {
    const content = fs.readFileSync(DISCIPLINE_PATH, "utf8")
    const section = extractRoleBandSection(content)
    expect(collectTableBlocks(section)).toHaveLength(1)
  })

  it("データ行数が ROLES と一致する", () => {
    expect(readDisciplineRows()).toHaveLength(ROLES.length)
  })

  it("行の並びが ROLES の定義順と一致する", () => {
    expect(readDisciplineRows().map((row) => row.resolvedRoleId)).toEqual(
      ROLES.map((role) => role.id)
    )
  })

  it("役割名が role.label と一致する", () => {
    expect(readDisciplineRows().map((row) => row.label)).toEqual(
      ROLES.map((role) => role.label)
    )
  })

  it("RoleId が role.id と一致する", () => {
    expect(readDisciplineRows().map((row) => row.roleId)).toEqual(
      ROLES.map((role) => role.id)
    )
  })

  it("種別が role.kind と一致する", () => {
    expect(readDisciplineRows().map((row) => row.kind)).toEqual(
      ROLES.map((role) => role.kind)
    )
  })

  it("Agent Tool が allowsAgentTool と一致する", () => {
    expect(readDisciplineRows().map((row) => row.agentTool)).toEqual(
      ROLES.map((role) => (allowsAgentTool([role.id]) ? "可" : "否"))
    )
  })

  it("Claude モデルが ASSIGNMENTS と一致する", () => {
    for (const row of readDisciplineRows()) {
      expect(row.models).toEqual(
        ASSIGNMENTS["claude-model-policy"][row.resolvedRoleId]
      )
    }
  })
})

// 表の解析が未知の語を見逃さず、正しい 5 列の行だけを受理することを守る。
describe("役割の表解析", () => {
  it("未知のモデル語で例外を投げる", () => {
    const section = `${SYNTHETIC_HEADER}\n| コードレビュー | \`code-review\` | \`readonly\` | 否 | \`Claude 5\` |`
    expect(() => parseRoleBandTable(section)).toThrow(
      /未知のモデル「Claude 5」/
    )
  })

  it("未知の役割名で例外を投げる", () => {
    const section = `${SYNTHETIC_HEADER}\n| 未知の役割 | \`code-review\` | \`readonly\` | 否 | \`Sonnet\` |`
    expect(() => parseRoleBandTable(section)).toThrow(
      /役割名「未知の役割」を解決できない/
    )
  })

  it("既知の役割名とモデル語を解析する", () => {
    const section = `${SYNTHETIC_HEADER}\n| コードレビュー | \`code-review\` | \`readonly\` | 否 | \`Sonnet\` |`
    expect(parseRoleBandTable(section)).toEqual([
      {
        label: "コードレビュー",
        resolvedRoleId: "code-review",
        roleId: "code-review",
        kind: "readonly",
        agentTool: "否",
        models: ["sonnet"]
      }
    ])
  })
})

const FORBIDDEN_ROLE_TABLE_HEADINGS =
  /^## (?:担当表|役割|役割の帯|モデル別役割|役割の帯と推奨モデル)$/m

// 方針 SKILL が役割表を再定義せず、規律を唯一の参照先に保つことを守る。
describe("方針 SKILL の役割表", () => {
  it("claude-model-policy に表と役割表見出しが無い", () => {
    const content = fs.readFileSync(CLAUDE_MODEL_POLICY_PATH, "utf8")
    expect(content).not.toMatch(/^\|/m)
    expect(content).not.toMatch(FORBIDDEN_ROLE_TABLE_HEADINGS)
  })

  it("custom-policy に表と役割表見出しが無い", () => {
    const content = fs.readFileSync(CUSTOM_POLICY_PATH, "utf8")
    expect(content).not.toMatch(/^\|/m)
    expect(content).not.toMatch(FORBIDDEN_ROLE_TABLE_HEADINGS)
  })
})
