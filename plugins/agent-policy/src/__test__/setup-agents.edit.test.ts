import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { textHash } from "../agents/hash"
import {
  type CheckResult,
  check,
  coverage,
  definitionOf,
  EDIT_SOURCE,
  type EditResult,
  type FragmentStatusResult,
  type ListRolesResult,
  project,
  readAgent,
  run,
  seed,
  singleResult,
  target,
  writeAgent,
  writeProjectRole
} from "./helpers/setup-agents-fixtures"

describe("--prune-tools", () => {
  it("指定したツールだけを外し、他の行はバイト単位で変えない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent,Missing",
      "--dir",
      project
    ])

    expect(result).toMatchObject({
      ok: true,
      target: ".claude/agents/target.md",
      changed: true
    })
    expect(result.warnings.some((warning) => warning.includes("Missing"))).toBe(
      true
    )
    expect(readAgent("target.md")).toBe(
      EDIT_SOURCE.replace(
        "tools: Read, Agent, Grep, WebFetch",
        "tools: Read, Grep, WebFetch"
      )
    )
  })

  it("応答に tools 行の変更前と変更後を返す", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<
      EditResult & { toolsBefore: string[]; toolsAfter: string[] }
    >([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.toolsBefore).toEqual(["Read", "Agent", "Grep", "WebFetch"])
    expect(result.toolsAfter).toEqual(["Read", "Grep", "WebFetch"])
  })

  it("行に無いツールだけを指定したときは書き換えない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Missing",
      "--dir",
      project
    ])

    expect(result).toMatchObject({ ok: true, changed: false })
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })

  it.each([
    ["block 配列", ["tools:", "  - Read", "  - Agent"]],
    ["flow 配列", ["tools: [Read, Agent]"]],
    ["引用符付き", ['tools: "Read", "Agent"']]
  ])("%s の tools は未対応の書式として書き込まない", (_label, toolLines) => {
    const source = [
      "---",
      "name: target",
      ...toolLines,
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toContain("未対応の書式")
    expect(readAgent("target.md")).toBe(source)
  })

  it('--tools "*" は tools 欄の無い定義に許可集合の 1 行を name 行の直後へ足す', () => {
    const source = [
      "---",
      "name: target",
      "description: 探索",
      "agent-policy-role: explore",
      "---",
      "",
      "本文",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "*",
      "--dir",
      project
    ])

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(readAgent("target.md")).toBe(
      source.replace(
        "name: target\n",
        "name: target\ntools: Read, Grep, Glob, Bash\n"
      )
    )
  })

  it('roles が空の定義への --tools "*" は書き込まない', () => {
    const source = [
      "---",
      "name: target",
      "agent-policy-role: final-review",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "*",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("tools 行の無い定義から個別のツールは外せない", () => {
    const source = [
      "---",
      "name: target",
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--prune-tools",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("--scope と --lang は受け付けない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    for (const extra of [
      ["--scope", "claude"],
      ["--lang", "ja"]
    ]) {
      const result = run<EditResult>([
        "--prune-tools",
        "--name",
        "target",
        "--tools",
        "Agent",
        "--dir",
        project,
        ...extra
      ])
      expect(result.ok).toBe(false)
      expect(result.error).toContain(extra[0])
    }
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })
})

describe("--rewrite-roles", () => {
  it("agent-policy-role 行だけを指定の並びに置き換える", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "code-review",
      "--dir",
      project
    ])

    expect(result).toMatchObject({
      ok: true,
      target: ".claude/agents/target.md",
      changed: true
    })
    expect(readAgent("target.md")).toBe(
      EDIT_SOURCE.replace(
        "agent-policy-role: code-review, final-review",
        "agent-policy-role: code-review"
      )
    )
  })

  it("空の --roles で agent-policy-role 行を消す", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "",
      "--dir",
      project
    ])

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(readAgent("target.md")).toBe(
      EDIT_SOURCE.replace("agent-policy-role: code-review, final-review\n", "")
    )
  })

  it("プロジェクト独自の役割断片で解決できる ID を受け付ける", () => {
    writeProjectRole({ id: "triage" })
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "triage,code-review",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(readAgent("target.md")).toContain(
      "agent-policy-role: triage, code-review\n"
    )
  })

  it.each([
    ["廃止済み ID", "code-review,final-review"],
    ["未知の ID", "no-such-role"]
  ])("%s を含むときは書き込まない", (_label, roles) => {
    writeProjectRole({ id: "final-review", label: "最終レビュー" })
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      roles,
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })

  it("agent-policy-role 行の無い定義には書き込まない", () => {
    const source = ["---", "name: target", "tools: Read", "---", ""].join("\n")
    writeAgent("target.md", [source])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "explore",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })
})

describe("既存定義の行単位操作に共通する規則", () => {
  it.each([
    ["--prune-tools", ["--tools", "Agent"]],
    ["--rewrite-roles", ["--roles", "explore"]]
  ])("%s は対象ファイルが無いとき失敗する", (flag, extra) => {
    const result = run<EditResult>([
      flag,
      "--name",
      "missing",
      ...extra,
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(
      fs.existsSync(path.join(project, ".claude", "agents", "missing.md"))
    ).toBe(false)
  })

  it.each([
    ["--prune-tools", ["--tools", "Agent"]],
    ["--rewrite-roles", ["--roles", "explore"]]
  ])("%s は frontmatter の無いファイルに書き込まない", (flag, extra) => {
    writeAgent("target.md", ["本文だけ", ""])

    const result = run<EditResult>([
      flag,
      "--name",
      "target",
      ...extra,
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe("本文だけ\n")
  })

  it("2 つの操作は併用できない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--prune-tools",
      "--rewrite-roles",
      "--name",
      "target",
      "--tools",
      "Agent",
      "--roles",
      "explore",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })
})

describe("点検と行単位操作の境界", () => {
  function prune(name: string, tools: string): EditResult {
    return run<EditResult>([
      "--prune-tools",
      "--name",
      name,
      "--tools",
      tools,
      "--dir",
      project
    ])
  }

  it("末尾に改行の無いファイルでも、他の行をバイト単位で保つ", () => {
    const source = EDIT_SOURCE.trimEnd()
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(true)
    expect(readAgent("target.md")).toBe(
      source.replace("Read, Agent, Grep", "Read, Grep")
    )
  })

  it("改行が CRLF の定義は、CRLF の可能性を示して書き込まない", () => {
    const source = EDIT_SOURCE.replace(/\n/g, "\r\n")
    writeAgent("target.md", [source])

    const result = prune("target", "Agent")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("CRLF")
    expect(readAgent("target.md")).toBe(source)
  })

  it("frontmatter に同じキーが 2 行あるときは、両操作とも書き込まず点検では other にする", () => {
    const source = [
      "---",
      "name: target",
      "tools: Read, Agent",
      "tools: Read, Grep",
      "agent-policy-role: explore",
      "agent-policy-role: code-review",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(false)
    expect(
      run<EditResult>([
        "--rewrite-roles",
        "--name",
        "target",
        "--roles",
        "explore",
        "--dir",
        project
      ]).ok
    ).toBe(false)
    expect(readAgent("target.md")).toBe(source)
    expect(definitionOf(coverage(), "target")?.toolsFormat).toBe("other")
  })

  it("字下げ付きの tools キーは点検で other にし、書き換えない", () => {
    const source = [
      "---",
      "name: target",
      "  tools: Read, Agent",
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(definitionOf(coverage(), "target")?.toolsFormat).toBe("other")
    expect(prune("target", "Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("本文中の tools: 行は書き換えない", () => {
    const source = [
      "---",
      "name: target",
      "tools: Read, Agent",
      "agent-policy-role: explore",
      "---",
      "",
      "tools: Read, Agent",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(true)
    expect(readAgent("target.md")).toBe(
      source.replace("tools: Read, Agent\nagent", "tools: Read\nagent")
    )
  })

  it("tools が Agent だけの定義からは Agent を外さない", () => {
    const source = [
      "---",
      "name: target",
      "tools: Agent",
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(prune("target", "Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it('tools 欄がある定義への --tools "*" と、"*" と他ツールの併用を拒む', () => {
    writeAgent("target.md", [EDIT_SOURCE])

    expect(prune("target", "*").ok).toBe(false)
    expect(prune("target", "*,Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })

  it.each([
    ["括弧を含むトークン", "tools: Read, Bash(git status, git diff), Agent"],
    ["# を含む値", "tools: Read, Agent # 後で消す"],
    ["値が空で block も続かない", "tools:"]
  ])("%s の tools は other とし、書き換えない", (_label, toolsLine) => {
    const source = [
      "---",
      "name: target",
      toolsLine,
      "agent-policy-role: explore",
      "---",
      ""
    ].join("\n")
    writeAgent("target.md", [source])

    expect(definitionOf(coverage(), "target")?.toolsFormat).toBe("other")
    expect(prune("target", "Agent").ok).toBe(false)
    expect(readAgent("target.md")).toBe(source)
  })

  it("廃止済みでも解決可能でもない ID を unknownRoles に載せる", () => {
    writeAgent("target.md", [
      "---",
      "name: target",
      "tools: Read",
      "agent-policy-role: explore, final-review, no-such-role",
      "---",
      ""
    ])

    expect(definitionOf(coverage(), "target")).toMatchObject({
      roles: ["explore"],
      retiredRoles: [{ id: "final-review", replacement: "complex-review" }],
      unknownRoles: ["no-such-role"]
    })
  })

  it("kind の無い旧形式の final-review.md が残っていても --list-coverage が成功する", () => {
    const roles = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(roles, { recursive: true })
    fs.writeFileSync(
      path.join(roles, "final-review.md"),
      ["---", "id: final-review", "label: 最終レビュー", "---", ""].join("\n")
    )

    expect(coverage().ok).toBe(true)
  })

  it("--list-roles に廃止済み ID の断片を載せない", () => {
    writeProjectRole({ id: "final-review", label: "最終レビュー" })

    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.roles.map((role) => role.id)).not.toContain("final-review")
  })

  it("--rewrite-roles と --tools は併用できない", () => {
    writeAgent("target.md", [EDIT_SOURCE])

    const result = run<EditResult>([
      "--rewrite-roles",
      "--name",
      "target",
      "--roles",
      "code-review",
      "--tools",
      "Agent",
      "--dir",
      project
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toContain("--tools")
    expect(readAgent("target.md")).toBe(EDIT_SOURCE)
  })
})

describe("description と前置きの保持", () => {
  const KEEPER = path.join(".claude", "agents", "keeper.md")

  function keeper(
    extra: string[] = [],
    mode: "--write" | "--check" = "--write"
  ) {
    return singleResult<CheckResult>([
      mode,
      "--model-id",
      "opus",
      "--name",
      "keeper",
      "--roles",
      "code-review",
      "--scope",
      "claude",
      "--lang",
      "ja",
      "--dir",
      project,
      ...extra
    ])
  }

  function content(): string {
    return fs.readFileSync(path.join(project, KEEPER), "utf8")
  }

  function edit(transform: (text: string) => string): void {
    fs.writeFileSync(path.join(project, KEEPER), transform(content()))
  }

  function metaValue(key: string): string | undefined {
    return content().match(new RegExp(`^${key}: (.*)$`, "m"))?.[1]
  }

  const addPreamble = (text: string) =>
    text.replace(/\n---\n\n/, "\n---\n\n利用者が足した前置き。\n\n")

  it("新規生成で 2 つのハッシュを書き、直後の --check は same を返す", () => {
    keeper()

    expect(metaValue("agent-policy-description-hash")).toMatch(/^[0-9a-f]{16}$/)
    expect(metaValue("agent-policy-preamble-hash")).toMatch(/^[0-9a-f]{16}$/)
    expect(keeper([], "--check")).toMatchObject({
      description: "same",
      preamble: "same"
    })
  })

  it("利用者が編集した description は userEdited になり、--merge で保持して記録も残す", () => {
    keeper()
    const record = metaValue("agent-policy-description-hash")
    edit((text) =>
      text.replace(/^description: .*$/m, "description: 利用者の説明")
    )

    expect(keeper([], "--check").description).toBe("userEdited")
    const result = keeper(["--merge"])

    expect(metaValue("description")).toBe("利用者の説明")
    expect(metaValue("agent-policy-description-hash")).toBe(record)
    expect(result.discarded.frontmatterKeys).not.toContain("description")
  })

  it("記録と一致する旧い description は templateChanged になり、--merge の既定では保持する", () => {
    keeper()
    const oldRecord = textHash("旧い説明")
    edit((text) =>
      text
        .replace(/^description: .*$/m, "description: 旧い説明")
        .replace(
          /^agent-policy-description-hash: .*$/m,
          `agent-policy-description-hash: ${oldRecord}`
        )
    )

    expect(keeper([], "--check").description).toBe("templateChanged")
    keeper(["--merge"])

    expect(metaValue("description")).toBe("旧い説明")
    expect(metaValue("agent-policy-description-hash")).toBe(oldRecord)
  })

  it("--replace で指定したものだけテンプレートに置き換え、新しい記録を書く", () => {
    keeper()
    const template = metaValue("description")
    const templateRecord = metaValue("agent-policy-description-hash")
    edit((text) =>
      addPreamble(text)
        .replace(/^description: .*$/m, "description: 旧い説明")
        .replace(
          /^agent-policy-description-hash: .*$/m,
          `agent-policy-description-hash: ${textHash("旧い説明")}`
        )
    )

    keeper(["--merge", "--replace", "description"])

    expect(metaValue("description")).toBe(template)
    expect(metaValue("agent-policy-description-hash")).toBe(templateRecord)
    expect(content()).toContain("利用者が足した前置き。")
  })

  it("記録の無い既存の前置きは unknown になり、保持しても記録を書かない", () => {
    keeper()
    edit((text) =>
      addPreamble(text).replace(/^agent-policy-preamble-hash: .*\n/m, "")
    )

    const checked = keeper([], "--check")
    expect(checked.preamble).toBe("unknown")
    expect(checked.preambleTexts?.existing).toContain("利用者が足した前置き。")
    expect(checked.preambleTexts?.template).not.toContain(
      "利用者が足した前置き。"
    )
    const result = keeper(["--merge"])

    expect(content()).toContain("利用者が足した前置き。")
    expect(metaValue("agent-policy-preamble-hash")).toBeUndefined()
    expect(result.discarded.preamble).toBe(false)
  })

  it("--replace preamble で前置きを置き換え、記録を書く", () => {
    keeper()
    const record = metaValue("agent-policy-preamble-hash")
    edit((text) =>
      addPreamble(text).replace(/^agent-policy-preamble-hash: .*\n/m, "")
    )

    keeper(["--merge", "--replace", "preamble"])

    expect(content()).not.toContain("利用者が足した前置き。")
    expect(metaValue("agent-policy-preamble-hash")).toBe(record)
  })

  it("--write は tools 行の変更前と変更後を返し、前置きが same なら preambleTexts は null", () => {
    keeper()
    edit((text) =>
      text.replace(/^tools: (.*)$/m, "tools: $1, Agent, mcp__gone")
    )

    const result = keeper(["--merge"])

    expect(result.toolsBefore).toEqual(
      expect.arrayContaining(["Agent", "mcp__gone"])
    )
    expect(result.toolsAfter).toContain("Agent")
    expect(result.toolsAfter).not.toContain("mcp__gone")
    expect(result.preambleTexts).toBeNull()
  })

  it("--replace は --merge なし・--recommended・未知の値で拒否する", () => {
    for (const args of [
      ["--write", "--replace", "description"],
      ["--write", "--merge", "--replace", "summary"]
    ]) {
      const result = run<{ ok: boolean }>([
        ...args,
        "--model-id",
        "opus",
        "--name",
        "keeper",
        "--roles",
        "code-review",
        "--scope",
        "claude",
        "--dir",
        project
      ])
      expect(result.ok).toBe(false)
    }
    expect(
      run<{ ok: boolean }>([
        "--write",
        "--merge",
        "--recommended",
        "--replace",
        "description",
        "--scope",
        "claude",
        "--dir",
        project
      ]).ok
    ).toBe(false)
  })
})

describe("--list-roles", () => {
  it("組み込み役割を担当表で絞らずすべて返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "ja",
      "--dir",
      project
    ])

    expect(result.ok).toBe(true)
    expect(result.roles.map((role) => role.id)).toEqual([
      "complex-impl",
      "normal-impl",
      "light-impl",
      "escalation",
      "general",
      "explore",
      "realtime-research",
      "e2e-verify",
      "design-review",
      "knowledge-elicitation",
      "code-review",
      "complex-review",
      "adversarial-review"
    ])
    expect(result.roles.every((role) => role.source === "plugin")).toBe(true)
  })

  it("プロジェクト固有 ID を組み込み役割の末尾へ並べる", () => {
    writeProjectRole({ id: "triage" })

    const result = run<ListRolesResult>(["--list-roles", "--dir", project])

    expect(result.roles.at(-1)).toMatchObject({
      id: "triage",
      kind: "readonly",
      source: "project"
    })
  })

  it("同じ ID のプロジェクト断片で source と内容を置き換える", () => {
    writeProjectRole({
      id: "explore",
      label: "独自探索",
      kind: "impl",
      tools: "Read, Write"
    })

    const result = run<ListRolesResult>(["--list-roles", "--dir", project])
    const explore = result.roles.find((role) => role.id === "explore")

    expect(explore).toEqual({
      id: "explore",
      label: "独自探索",
      kind: "impl",
      tools: ["Read", "Write"],
      source: "project",
      languageMismatch: false
    })
  })

  it("id と label の両方を返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    const light = result.roles.find((role) => role.id === "light-impl")

    expect(light?.label).toBe("軽量な実装")
    expect(light?.kind).toBe("impl")
  })

  it("プロジェクト独自役割の言語不一致を示す", () => {
    writeProjectRole({ id: "triage" })

    const result = run<ListRolesResult>([
      "--list-roles",
      "--lang",
      "de",
      "--dir",
      project
    ])
    const triage = result.roles.find((role) => role.id === "triage")

    expect(triage?.languageMismatch).toBe(true)
  })
})

describe("--check-fragments", () => {
  it("ja では missing が空で targetDir が null", () => {
    const result = run<FragmentStatusResult>([
      "--check-fragments",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.targetDir).toBeNull()
  })

  it("未翻訳の言語では missing が返る", () => {
    const result = run<FragmentStatusResult>([
      "--check-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    expect(result.missing).toContain("explore")
  })
})

describe("--scaffold-fragments", () => {
  it("翻訳先へひな形を書き、書いたパスを返す", () => {
    const result = run<FragmentStatusResult>([
      "--scaffold-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.written?.length).toBeGreaterThan(0)
    expect(result.written?.[0]).toMatch(/^\.claude\/agent-policy\/roles\/de\//)
  })
})

describe("--check", () => {
  it("既存が無いとき exists: false を返す", () => {
    const result = check("custom")
    expect(result.ok).toBe(true)
    expect(result.exists).toBe(false)
  })

  it("既存がテンプレートと同一のとき identical: true を返す", () => {
    run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    const result = check("custom")
    expect(result.exists).toBe(true)
    expect(result.identical).toBe(true)
  })

  it("既存にしかない tools を toolsOnlyInExisting に出す", () => {
    seed("custom", {
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    const result = check("custom")
    expect(result.frontmatter.toolsOnlyInExisting).toContain("mcp__context7")
  })

  it("既存にしかない frontmatter キーを keysOnlyInExisting に出す", () => {
    seed("custom", { extraKeys: { permissionMode: "plan" } })
    const result = check("custom")
    expect(result.frontmatter.keysOnlyInExisting).toContain("permissionMode")
  })

  it("値の違う共通キーを changed に出す", () => {
    seed("custom", { model: "my-own-alias" })
    const entry = check("custom").frontmatter.changed.find(
      (item) => item.key === "model"
    )
    expect(entry?.existing).toBe("my-own-alias")
    expect(entry?.template).toBe("claude-gpt-6-1-sol")
  })

  it("既存にしかない節を sectionsOnlyInExisting に出す", () => {
    seed("custom", { extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const result = check("custom")
    expect(result.body.sectionsOnlyInExisting).toContain("## ツール運用")
  })

  it("冒頭宣言の変更を preambleChanged に出す", () => {
    seed("custom", { preamble: "あなたは私が書き換えた冒頭である。" })
    const result = check("custom")
    expect(result.preambleChanged).toBe(true)
  })

  it("節の中身の変更を sectionsChanged に出す", () => {
    seed("custom", { replaceConstraints: "- 私が書き換えた制約。\n" })
    const result = check("custom")
    expect(result.body.sectionsChanged).toContain("## 制約")
  })

  it("実装役割だけなら roles.mixedKinds が false になる", () => {
    expect(check("custom").roles).toEqual({
      ids: ["complex-impl"],
      implRoles: ["complex-impl"],
      readonlyRoles: [],
      mixedKinds: false
    })
  })

  it("実装役割と読み取り役割を分類して混在を示す", () => {
    const result = singleResult<CheckResult>([
      "--scope",
      "custom",
      "--model-id",
      "gpt-terra",
      "--name",
      "gpt-terra",
      "--roles",
      "explore,normal-impl,design-review",
      "--lang",
      "ja",
      "--dir",
      project,
      "--check"
    ])

    expect(result.roles).toEqual({
      ids: ["normal-impl", "explore", "design-review"],
      implRoles: ["normal-impl"],
      readonlyRoles: ["explore", "design-review"],
      mixedKinds: true
    })
  })

  it("生成した定義の tools に Agent を含めない", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol-code-review",
      "--roles",
      "code-review",
      "--lang",
      "ja",
      "--dir",
      project,
      "--write"
    ])
    expect(result.ok).toBe(true)

    const content = fs.readFileSync(
      path.join(project, ".claude", "agents", "gpt-sol-code-review.md"),
      "utf8"
    )
    const tools = content.match(/^tools: (.*)$/m)?.[1]?.split(", ") ?? []
    expect(tools).not.toContain("Agent")
  })

  it("frontmatter が無い既存ファイルを全体が本文の文書として扱う", () => {
    fs.writeFileSync(target(), "独自の冒頭。\n\n## 独自節\n\n- 独自の内容。\n")

    const result = check("custom")

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.preambleChanged).toBe(true)
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("閉じていない frontmatter も全体を本文として扱う", () => {
    fs.writeFileSync(target(), "---\nname: broken\n\n## 独自節\n\n- 内容。\n")

    const result = check("custom")

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("不正な役割 ID でエラーを返す", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "x",
      "--roles",
      "no-such-role",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("no-such-role")
  })

  it("model-id の欠落でエラーを返す", () => {
    const result = run([
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("model")
  })

  it("翻訳断片が不完全な言語を拒否する", () => {
    const result = run([
      "--scope",
      "custom",
      "--model-id",
      "gpt-sol",
      "--name",
      "gpt-sol",
      "--roles",
      "complex-impl",
      "--lang",
      "de",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toMatch(/^fragments:/)
  })
})
