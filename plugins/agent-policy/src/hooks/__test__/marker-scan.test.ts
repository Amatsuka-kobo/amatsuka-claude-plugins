import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { runTs } from "../../testing/run-ts.js"
import {
  candidateAgents,
  frontmatter,
  markerTable,
  parseToolsField,
  projectAgentsDir,
  roleLabel,
  roleLabels,
  scanAgents
} from "../marker-scan"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const TABLE_HEADING =
  "次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは依頼内容に近いものを選ぶ。"

const projects: string[] = []

afterEach(() => {
  for (const project of projects) {
    fs.rmSync(project, { recursive: true, force: true })
  }
  projects.length = 0
})

function temporaryProject(): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-marker-"))
  projects.push(project)
  return project
}

function agentsDir(project: string): string {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeDefinition(
  project: string,
  file: string,
  metadata: string[]
): string {
  const target = path.join(agentsDir(project), file)
  fs.writeFileSync(
    target,
    ["---", ...metadata, "---", "", "本文", ""].join("\n")
  )
  return target
}

function writeRoleFragment(
  project: string,
  id: string,
  label: string,
  language?: string
): string {
  const dir = path.join(
    project,
    ".claude",
    "agent-policy",
    "roles",
    ...(language === undefined ? [] : [language])
  )
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `${id}.md`)
  fs.writeFileSync(
    target,
    ["---", `id: ${id}`, `label: ${label}`, "kind: readonly", "---", ""].join(
      "\n"
    )
  )
  return target
}

function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides }
}

function hookContext(project: string, injection: string): string {
  const output = runTs(HOOK, [], {
    env: environment({
      CLAUDE_PROJECT_DIR: project,
      AMATSUKA_AGENT_AUTO_INJECTION: injection
    })
  }).trim()
  const parsed = JSON.parse(output.split("\n").at(-1) ?? "{}")
  return parsed.hookSpecificOutput?.additionalContext ?? ""
}

function tableBlock(context: string): string | undefined {
  return context.split("\n\n").find((block) => block.startsWith(TABLE_HEADING))
}

describe("parseToolsField", () => {
  it("カンマ区切りを trim と引用符除去して解釈する", () => {
    expect(parseToolsField(" Read, \"Agent\", 'Grep', , ")).toEqual([
      "Read",
      "Agent",
      "Grep"
    ])
  })

  it("引用符なしの flow 配列を解釈する", () => {
    expect(parseToolsField("[Read, Agent]")).toEqual(["Read", "Agent"])
  })

  it("引用符ありの flow 配列を解釈する", () => {
    expect(parseToolsField("[\"Read\", 'Agent']")).toEqual(["Read", "Agent"])
  })

  it("block 配列の要素列を解釈する", () => {
    expect(parseToolsField([" Read ", '"Agent"', "'Grep'"])).toEqual([
      "Read",
      "Agent",
      "Grep"
    ])
  })

  it("明示的な空 flow 配列は空配列を返す", () => {
    expect(parseToolsField("[]")).toEqual([])
  })

  it("値空で block 要素が無いとき undefined を返す", () => {
    expect(parseToolsField("")).toBeUndefined()
  })

  it("解釈不能な object と block scalar は undefined を返す", () => {
    expect(parseToolsField("{ Read: true }")).toBeUndefined()
    expect(parseToolsField("| multiline")).toBeUndefined()
    expect(parseToolsField("> folded")).toBeUndefined()
  })

  it("閉じていない flow 配列は undefined を返す", () => {
    expect(parseToolsField("[Read, Agent")).toBeUndefined()
  })

  it("欄なしは undefined を返す", () => {
    expect(parseToolsField(undefined)).toBeUndefined()
  })
})

describe("frontmatter", () => {
  it("tools の直後に連続する block 配列だけを収集する", () => {
    const project = temporaryProject()
    const file = writeDefinition(project, "block-tools.md", [
      "name: block-tools",
      "tools:",
      "  - Read",
      '  - "Agent"',
      "description: ここで連続が切れる",
      "  - Bash",
      "agent-policy-role: explore"
    ])

    const meta = frontmatter(file)

    expect(meta.get("tools")).toEqual(["Read", '"Agent"'])
    expect(parseToolsField(meta.get("tools"))).toEqual(["Read", "Agent"])
  })

  it("agent-policy-role の block 記法は空値のままにする", () => {
    const project = temporaryProject()
    const file = writeDefinition(project, "block-role.md", [
      "agent-policy-role:",
      "  - complex-impl",
      "model: sonnet"
    ])

    expect(frontmatter(file).get("agent-policy-role")).toBe("")
    expect(scanAgents(agentsDir(project))).toEqual([
      {
        name: "block-role",
        model: "sonnet",
        roles: [],
        tools: undefined,
        vendor: undefined
      }
    ])
  })
})

describe("scanAgents", () => {
  it("marker と model を抽出し roles の CSV を正規化する", () => {
    const project = temporaryProject()
    writeDefinition(project, "custom-file.md", [
      "name: custom-name",
      "model: claude-custom",
      "agent-policy-role: complex-impl, , explore,"
    ])
    writeDefinition(project, "fallback-name.md", [
      "agent-policy-role: normal-impl"
    ])

    expect(scanAgents(agentsDir(project))).toEqual([
      {
        name: "custom-name",
        model: "claude-custom",
        roles: ["complex-impl", "explore"],
        tools: undefined,
        vendor: undefined
      },
      {
        name: "fallback-name",
        model: undefined,
        roles: ["normal-impl"],
        tools: undefined,
        vendor: undefined
      }
    ])
  })

  it("agent-policy-vendor を文字列として抽出する", () => {
    const project = temporaryProject()
    writeDefinition(project, "vendor-agent.md", [
      "name: vendor-agent",
      "agent-policy-role: normal-impl",
      "agent-policy-vendor: gpt"
    ])

    expect(scanAgents(agentsDir(project))).toEqual([
      {
        name: "vendor-agent",
        model: undefined,
        roles: ["normal-impl"],
        tools: undefined,
        vendor: "gpt"
      }
    ])
  })

  it("agent-policy-vendor が無い定義では vendor が undefined になる", () => {
    const project = temporaryProject()
    writeDefinition(project, "without-vendor.md", [
      "name: without-vendor",
      "agent-policy-role: normal-impl"
    ])

    expect(scanAgents(agentsDir(project))[0]?.vendor).toBeUndefined()
  })

  it("存在しないディレクトリでは throw せず空配列を返す", () => {
    const project = temporaryProject()
    expect(scanAgents(path.join(project, "missing"))).toEqual([])
  })

  it("壊れた symlink を skip して他の定義を積む", () => {
    const project = temporaryProject()
    const dir = agentsDir(project)
    fs.symlinkSync("/nonexistent/marker-agent.md", path.join(dir, "broken.md"))
    writeDefinition(project, "healthy.md", [
      "name: healthy",
      "agent-policy-role: explore"
    ])

    expect(scanAgents(dir)).toEqual([
      {
        name: "healthy",
        model: undefined,
        roles: ["explore"],
        tools: undefined,
        vendor: undefined
      }
    ])
  })

  it("tools を MarkedAgent に載せる", () => {
    const project = temporaryProject()
    writeDefinition(project, "with-tools.md", [
      "name: with-tools",
      "tools:",
      "  - Read",
      "  - Agent",
      "agent-policy-role: complex-impl"
    ])

    expect(scanAgents(agentsDir(project))[0]?.tools).toEqual(["Read", "Agent"])
  })
})

describe("projectAgentsDir", () => {
  it("プロジェクトパスだけを組み、未設定と空値は undefined にする", () => {
    expect(projectAgentsDir({})).toBeUndefined()
    expect(projectAgentsDir({ CLAUDE_PROJECT_DIR: "" })).toBeUndefined()
    expect(projectAgentsDir({ CLAUDE_PROJECT_DIR: "/project" })).toBe(
      path.join("/project", ".claude", "agents")
    )
  })
})

describe("roleLabel", () => {
  it("既知の ROLES の label を返す", () => {
    expect(roleLabel({}, "complex-impl")).toBe("複雑または重要な実装")
    expect(roleLabel({}, "escalation")).toBe("行き詰まり時のエスカレーション")
    expect(roleLabel({}, "e2e-verify")).toBe("E2E 動作検証・ブラウザ/GUI 操作")
    expect(roleLabel({}, "final-review")).toBe("重要な実装の最終レビュー")
    expect(roleLabel({}, "gate-review")).toBe("設計書の最終ゲートレビュー")
    expect(roleLabel({}, "design-plan")).toBe("設計書・実装計画書(WBS)の作成")
    expect(roleLabel({}, "explore-lead")).toBe("コードベース探索統括")
  })

  it("プロジェクト直下と言語別の役割断片から label を解決する", () => {
    const project = temporaryProject()
    writeRoleFragment(project, "triage", "障害の切り分け")
    writeRoleFragment(project, "translate", "Uebersetzung", "de")
    const env = { CLAUDE_PROJECT_DIR: project }

    expect(roleLabel(env, "triage")).toBe("障害の切り分け")
    expect(roleLabel(env, "translate")).toBe("Uebersetzung")
  })

  it("未知の役割は undefined を返す", () => {
    expect(roleLabel({}, "no-such-role")).toBeUndefined()
  })

  it("同一 ID を別 env で解決しても結果を共有しない", () => {
    const first = temporaryProject()
    const second = temporaryProject()
    writeRoleFragment(first, "triage", "最初のラベル")
    writeRoleFragment(second, "triage", "二番目のラベル")

    expect(roleLabel({ CLAUDE_PROJECT_DIR: first }, "triage")).toBe(
      "最初のラベル"
    )
    expect(roleLabel({ CLAUDE_PROJECT_DIR: second }, "triage")).toBe(
      "二番目のラベル"
    )
  })
})

describe("roleLabels", () => {
  it("1 回の解決内だけ結果をメモする", () => {
    const project = temporaryProject()
    const fragment = writeRoleFragment(project, "triage", "変更前")
    const env = { CLAUDE_PROJECT_DIR: project }
    const labels = roleLabels(env)

    expect(labels("triage")).toBe("変更前")
    fs.writeFileSync(
      fragment,
      "---\nid: triage\nlabel: 変更後\nkind: readonly\n---\n"
    )
    expect(labels("triage")).toBe("変更前")
    expect(roleLabels(env)("triage")).toBe("変更後")
  })
})

describe("candidateAgents", () => {
  const marked = [
    {
      name: "sonnet-claude",
      model: "sonnet",
      roles: ["normal-impl"],
      tools: undefined,
      vendor: "claude"
    },
    {
      name: "sonnet-gpt-vendor",
      model: "sonnet",
      roles: ["normal-impl"],
      tools: undefined,
      vendor: "gpt"
    },
    {
      name: "implicit",
      model: undefined,
      roles: ["normal-impl"],
      tools: undefined,
      vendor: undefined
    },
    {
      name: "inherit",
      model: "inherit",
      roles: ["normal-impl"],
      tools: undefined,
      vendor: undefined
    },
    {
      name: "vendor-none",
      model: "opus",
      roles: ["normal-impl"],
      tools: undefined,
      vendor: "none"
    },
    {
      name: "external-model",
      model: "gpt-5.3-codex",
      roles: ["normal-impl"],
      tools: undefined,
      vendor: "claude"
    }
  ]

  it("with-external は全定義を候補に含める", () => {
    expect(candidateAgents(marked, "with-external")).toEqual(marked)
  })

  it("claude-only は Claude 上で動く定義だけを候補に含める", () => {
    expect(
      candidateAgents(marked, "claude-only").map((entry) => entry.name)
    ).toEqual(["sonnet-claude", "implicit", "inherit", "vendor-none"])
  })
})

describe("markerTable", () => {
  it("ベンダーの有無を保ったまま役割マーカー対応表を出力する", () => {
    const result = markerTable(
      environment({}),
      [
        {
          name: "gpt-terra-general-implementer",
          model: undefined,
          roles: ["normal-impl"],
          tools: undefined,
          vendor: "gpt"
        },
        {
          name: "grok-worker",
          model: undefined,
          roles: ["normal-impl"],
          tools: undefined,
          vendor: "grok"
        },
        {
          name: "local-implementer",
          model: undefined,
          roles: ["normal-impl"],
          tools: undefined,
          vendor: undefined
        },
        {
          name: "sonnet-code-reviewer",
          model: undefined,
          roles: ["code-review"],
          tools: undefined,
          vendor: undefined
        }
      ],
      "with-external"
    )

    expect(result).toBe(
      [
        TABLE_HEADING,
        "表に無い役割の委譲先は、外部ベンダーのモデルを指定した定義も含めて選んでよい。",
        "- 通常の実装 [normal-impl]: gpt-terra-general-implementer (gpt) / grok-worker (grok) / local-implementer",
        "- コードレビュー [code-review]: sonnet-code-reviewer"
      ].join("\n")
    )
  })

  it("役割行に RoleId を角括弧で併記する", () => {
    const project = temporaryProject()
    writeRoleFragment(project, "my_role", "プロジェクト独自役割")
    const result = markerTable(
      environment({ CLAUDE_PROJECT_DIR: project }),
      [
        {
          name: "implementer",
          model: "sonnet",
          roles: ["normal-impl"],
          tools: undefined,
          vendor: undefined
        },
        {
          name: "project-worker",
          model: "sonnet",
          roles: ["my_role"],
          tools: undefined,
          vendor: undefined
        }
      ],
      "with-external"
    )
    if (result === undefined) throw new Error("marker table fixture is empty")

    const roleLines = result.split("\n").slice(2)
    expect(roleLines).toHaveLength(2)
    for (const line of roleLines) {
      expect(/^- .+ \[[^\]]+\]: /.test(line)).toBe(true)
    }
  })

  it.each([
    ["claude-only", "それ以外の定義は委譲先にしない"],
    ["with-external", "外部ベンダーのモデルを指定した定義も含めて選んでよい"]
  ] as const)("%s の候補範囲を冒頭行の直後へ出力する", (scope, scopeText) => {
    const renderMarkerTable = markerTable
    const result = renderMarkerTable(
      environment({}),
      [
        {
          name: "implementer",
          model: "sonnet",
          roles: ["normal-impl"],
          tools: undefined,
          vendor: undefined
        }
      ],
      scope
    )
    if (result === undefined) throw new Error("marker table fixture is empty")

    const lines = result.split("\n")
    expect(lines[0]).toBe(TABLE_HEADING)
    expect(lines[1]).toContain(scopeText)
    expect(lines[1]?.startsWith("- ")).toBe(false)
  })

  it.each([
    "custom",
    "with-codex-grok"
  ])("%s の SessionStart 注入と同一の対応表を返す", (injection) => {
    const project = temporaryProject()
    writeDefinition(project, "multi-role.md", [
      "name: multi-role",
      "model: sonnet",
      "agent-policy-role: complex-impl, explore"
    ])
    writeDefinition(project, "second.md", [
      "name: second",
      "agent-policy-role: explore, normal-impl"
    ])
    const env = environment({
      CLAUDE_PROJECT_DIR: project,
      AMATSUKA_AGENT_AUTO_INJECTION: injection
    })
    const expected = markerTable(
      env,
      scanAgents(projectAgentsDir(env)),
      "with-external"
    )

    expect(expected).toBeDefined()
    expect(tableBlock(hookContext(project, injection))).toBe(expected)
  })
})
