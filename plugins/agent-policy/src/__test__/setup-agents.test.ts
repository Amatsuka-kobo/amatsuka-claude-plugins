import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ROLES } from "../agents/roles"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../setup-agents.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url))

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
  fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true })
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

// CLI が stdout へ書く JSON。実行時にはエラー系で一部フィールドが欠けるが、
// 各テストは自分が検証するフィールドしか触らないため非 optional で受ける。
interface RolesSummary {
  ids: string[]
  implRoles: string[]
  readonlyRoles: string[]
  mixedKinds: boolean
  agentTool: boolean
}

interface Discarded {
  frontmatterKeys: string[]
  preamble: boolean
  sections: string[]
}

interface CheckResult {
  ok: boolean
  error: string
  target: string
  exists: boolean
  identical: boolean
  preambleChanged: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
  roles: RolesSummary
  action: string
  kept: string[]
  keptNeedsReview: string[]
  discarded: Discarded
}

interface ListedRole {
  id: string
  label: string
  kind: "impl" | "readonly"
  tools: string[]
  source: "plugin" | "project"
}

interface ListRolesResult {
  ok: boolean
  roles: ListedRole[]
}

function run<T = CheckResult>(args: string[]): T {
  let output: string
  try {
    output = runTs(CLI, args, {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
    })
  } catch (error) {
    // CLI はエラー時も JSON を stdout へ書いてから終了コード 1 で終わる。
    // runTs(execFileSync)は非ゼロ終了で例外を投げるため、stdout を取り出す。
    const stdout = (error as { stdout?: string }).stdout
    if (stdout === undefined || stdout === "") throw error
    output = stdout
  }
  return JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as T
}

function check(extra: string[] = []): CheckResult {
  return run([
    "--vendor",
    "gpt",
    "--name",
    "gpt-sol",
    "--model",
    "claude-gpt-5-6-sol",
    "--roles",
    "complex-impl",
    "--dir",
    project,
    "--check",
    ...extra
  ])
}

function target(): string {
  return path.join(project, ".claude", "agents", "gpt-sol.md")
}

function writeProjectRole(options: {
  id: string
  label?: string
  kind?: "impl" | "readonly"
  tools?: string
}): void {
  const roles = path.join(project, ".claude", "agent-policy", "roles")
  fs.mkdirSync(roles, { recursive: true })
  fs.writeFileSync(
    path.join(roles, `${options.id}.md`),
    [
      "---",
      `id: ${options.id}`,
      `label: ${options.label ?? options.id}`,
      `description: ${options.id} の作業`,
      `tools: ${options.tools ?? "Read, Grep, Glob"}`,
      `kind: ${options.kind ?? "readonly"}`,
      "---",
      "",
      "## When to invoke",
      "",
      `- **${options.id}。** ${options.id} の作業をするとき。`,
      ""
    ].join("\n")
  )
}

describe("--list-roles", () => {
  it("name / model / roles 無しで組み込み 10 種を ROLES 順に返す", () => {
    const result = run<ListRolesResult>(["--list-roles", "--dir", project])

    expect(result.ok).toBe(true)
    expect(result.roles.map((role) => role.id)).toEqual(
      ROLES.map((role) => role.id)
    )
    expect(result.roles).toHaveLength(10)
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
      source: "project"
    })
  })
})

describe("--check", () => {
  it("既存が無いとき exists: false を返す", () => {
    const result = check()
    expect(result.ok).toBe(true)
    expect(result.exists).toBe(false)
  })

  it("既存がテンプレートと同一のとき identical: true を返す", () => {
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    const result = check()
    expect(result.exists).toBe(true)
    expect(result.identical).toBe(true)
  })

  it("既存にしかない tools を toolsOnlyInExisting に出す", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    const result = check()
    expect(result.frontmatter.toolsOnlyInExisting).toContain("mcp__context7")
  })

  it("既存にしかない frontmatter キーを keysOnlyInExisting に出す", () => {
    seed({ extraKeys: { permissionMode: "plan" } })
    const result = check()
    expect(result.frontmatter.keysOnlyInExisting).toContain("permissionMode")
  })

  it("値の違う共通キーを changed に出す", () => {
    seed({ model: "my-own-alias" })
    const entry = check().frontmatter.changed.find(
      (item) => item.key === "model"
    )
    expect(entry?.existing).toBe("my-own-alias")
    expect(entry?.template).toBe("claude-gpt-5-6-sol")
  })

  it("既存にしかない節を sectionsOnlyInExisting に出す", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const result = check()
    expect(result.body.sectionsOnlyInExisting).toContain("## ツール運用")
  })

  it("冒頭宣言の変更を preambleChanged に出す", () => {
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    const result = check()
    expect(result.preambleChanged).toBe(true)
  })

  it("節の中身の変更を sectionsChanged に出す", () => {
    seed({ replaceConstraints: "- 私が書き換えた制約。\n" })
    const result = check()
    expect(result.body.sectionsChanged).toContain("## 制約")
  })

  it("実装役割だけなら roles.mixedKinds が false になる", () => {
    expect(check().roles).toEqual({
      ids: ["complex-impl"],
      implRoles: ["complex-impl"],
      readonlyRoles: [],
      mixedKinds: false,
      agentTool: true
    })
  })

  it("実装役割と読み取り役割を分類して混在を示す", () => {
    const result = check(["--roles", "explore,normal-impl,independent-review"])

    expect(result.roles).toEqual({
      ids: ["normal-impl", "explore", "independent-review"],
      implRoles: ["normal-impl"],
      readonlyRoles: ["explore", "independent-review"],
      mixedKinds: true,
      agentTool: true
    })
  })

  it("Agent tool の可否を役割から返す", () => {
    expect(check(["--roles", "light-impl"]).roles.agentTool).toBe(false)
    expect(check(["--roles", "complex-impl"]).roles.agentTool).toBe(true)
  })

  it("frontmatter が無い既存ファイルを全体が本文の文書として扱う", () => {
    fs.writeFileSync(target(), "独自の冒頭。\n\n## 独自節\n\n- 独自の内容。\n")

    const result = check()

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.preambleChanged).toBe(true)
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("閉じていない frontmatter も全体を本文として扱う", () => {
    fs.writeFileSync(target(), "---\nname: broken\n\n## 独自節\n\n- 内容。\n")

    const result = check()

    expect(result.frontmatter.keysOnlyInExisting).toEqual([])
    expect(result.body.sectionsOnlyInExisting).toEqual(["## 独自節"])
  })

  it("不正な役割 ID でエラーを返す", () => {
    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "x",
      "--model",
      "m",
      "--roles",
      "no-such-role",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("no-such-role")
  })

  it("model の欠落でエラーを返す", () => {
    const result = run([
      "--vendor",
      "gpt",
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
})

describe("parseArgs", () => {
  it.each([
    "../../pwned",
    "GPT_Sol",
    "-a"
  ])("不正な name %s を拒否する", (name) => {
    const result = run([
      "--name",
      name,
      "--model",
      "m",
      "--roles",
      "explore",
      "--dir",
      project,
      "--check"
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe(
      "name: must be lowercase letters, digits and hyphens"
    )
  })

  it("roles の重複を除去する", () => {
    const result = check(["--roles", "explore,explore"])
    expect(result.roles.ids).toEqual(["explore"])
  })
})

// テンプレートを生成してから指定箇所を書き換え、既存ファイルとして置く。
function seed(options: {
  tools?: string
  model?: string
  extraKeys?: Record<string, string>
  extraSection?: string
  preamble?: string
  replaceConstraints?: string
}): void {
  run([
    "--vendor",
    "gpt",
    "--name",
    "gpt-sol",
    "--model",
    "claude-gpt-5-6-sol",
    "--roles",
    "complex-impl",
    "--dir",
    project,
    "--write"
  ])
  let content = fs.readFileSync(target(), "utf8")

  if (options.tools !== undefined) {
    content = content.replace(/^tools: .*$/m, `tools: ${options.tools}`)
  }
  if (options.model !== undefined) {
    content = content.replace(/^model: .*$/m, `model: ${options.model}`)
  }
  for (const [key, value] of Object.entries(options.extraKeys ?? {})) {
    content = content
      .replace(/^---$/m, "---")
      .replace(/^(name: .*)$/m, `$1\n${key}: ${value}`)
  }
  if (options.extraSection !== undefined) {
    content = `${content}\n${options.extraSection}`
  }
  if (options.preamble !== undefined) {
    content = content.replace(/あなたは gpt-sol。[^\n]*/, options.preamble)
  }
  if (options.replaceConstraints !== undefined) {
    content = content.replace(
      /## 制約\n\n[\s\S]*?(?=\n## )/,
      `## 制約\n\n${options.replaceConstraints}`
    )
  }

  fs.writeFileSync(target(), content)
}

describe("--write", () => {
  it("既存が無いときテンプレートどおりに書く", () => {
    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    expect(result.ok).toBe(true)
    expect(fs.existsSync(target())).toBe(true)
    expect(fs.readFileSync(target(), "utf8")).toContain("name: gpt-sol")
    expect(fs.readFileSync(target(), "utf8")).toContain("color: yellow")
  })

  it("--merge で新規作成すると空の保持・破棄情報を返す", () => {
    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge"
    ])

    expect(result.action).toBe("written")
    expect(result.kept).toEqual([])
    expect(result.keptNeedsReview).toEqual([])
    expect(result.discarded).toEqual({
      frontmatterKeys: [],
      preamble: false,
      sections: []
    })
  })

  it("--keep なしでは完全上書きになる", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    expect(fs.readFileSync(target(), "utf8")).not.toContain("## ツール運用")
  })

  it("--merge なしでは overwritten と破棄した変更を返す", () => {
    seed({
      model: "my-own-alias",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])

    expect(result.action).toBe("overwritten")
    expect(result.discarded).toEqual({
      frontmatterKeys: ["model"],
      preamble: true,
      sections: ["## 制約"]
    })
  })

  it("--keep section で既存にしかない節を残す", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "section:## ツール運用"
    ])
    const content = fs.readFileSync(target(), "utf8")
    expect(content).toContain("## ツール運用")
    expect(content).toContain("Context7 を使う")
  })

  it("--keep tools で既存にしかない tools を残す", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "tools:mcp__context7"
    ])
    expect(fs.readFileSync(target(), "utf8")).toMatch(/^tools:.*mcp__context7/m)
  })

  it("--keep key で既存にしかないキーを残す", () => {
    seed({ extraKeys: { permissionMode: "plan" } })
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "key:permissionMode"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain("permissionMode: plan")
  })

  it("--keep key で値の違う共通キーを残す", () => {
    seed({ model: "my-own-alias" })
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "key:model"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain("model: my-own-alias")
  })

  it("--keep preamble で冒頭宣言を残す", () => {
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "preamble"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain(
      "あなたは私が書き換えた冒頭である。"
    )
  })

  it("--merge で既存にしかない tools・キー・節を自動保持する", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, CustomTool",
      model: "my-own-alias",
      extraKeys: { permissionMode: "plan" },
      extraSection: "## 独自運用\n\n- 独自の運用。\n",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge"
    ])
    const content = fs.readFileSync(target(), "utf8")

    expect(result.action).toBe("merged")
    expect(result.kept).toEqual([
      "tools:LSP",
      "tools:CustomTool",
      "key:permissionMode",
      "section:## 独自運用"
    ])
    expect(result.discarded).toEqual({
      frontmatterKeys: ["model"],
      preamble: true,
      sections: ["## 制約"]
    })
    expect(content).toMatch(/^tools:.*CustomTool/m)
    expect(content).toContain("permissionMode: plan")
    expect(content).toContain("## 独自運用")
    expect(content).toContain("model: claude-gpt-5-6-sol")
    expect(content).not.toContain("あなたは私が書き換えた冒頭である。")
    expect(content).not.toContain("私が書き換えた制約")
  })

  it("--merge と明示 --keep を併用して変更済み項目も保持する", () => {
    seed({
      model: "my-own-alias",
      preamble: "あなたは私が書き換えた冒頭である。",
      replaceConstraints: "- 私が書き換えた制約。\n"
    })

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge",
      "--keep",
      "key:model",
      "--keep",
      "preamble",
      "--keep",
      "section:## 制約"
    ])
    const content = fs.readFileSync(target(), "utf8")

    expect(result.kept).toEqual(["key:model", "preamble", "section:## 制約"])
    expect(result.discarded).toEqual({
      frontmatterKeys: [],
      preamble: false,
      sections: []
    })
    expect(content).toContain("model: my-own-alias")
    expect(content).toContain("あなたは私が書き換えた冒頭である。")
    expect(content).toContain("私が書き換えた制約")
  })

  it("旧同梱候補だけを keptNeedsReview に分ける", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7, CustomTool",
      extraSection: [
        "## ツール運用",
        "",
        "- Context7 を使う。",
        "",
        "## 独自運用",
        "",
        "- 独自の運用。",
        ""
      ].join("\n")
    })

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--merge"
    ])

    expect(result.kept).toEqual([
      "tools:LSP",
      "tools:mcp__context7",
      "tools:CustomTool",
      "section:## ツール運用",
      "section:## 独自運用"
    ])
    expect(result.keptNeedsReview).toEqual([
      "tools:mcp__context7",
      "section:## ツール運用"
    ])
  })

  it("存在しない --keep section でエラーになり既存ファイルを変えない", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "section:ツール運用"
    ])

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
    expect(String(result.error)).toContain("not found")
    expect(fs.readFileSync(target(), "utf8")).toBe(before)
  })

  it("存在しない --keep tools でエラーになり既存ファイルを変えない", () => {
    seed({})
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "tools:NoSuchTool"
    ])

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
    expect(String(result.error)).toContain("not found")
    expect(fs.readFileSync(target(), "utf8")).toBe(before)
  })

  it("存在しない --keep key でエラーになり既存ファイルを変えない", () => {
    seed({})
    const before = fs.readFileSync(target(), "utf8")

    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "key:noSuchKey"
    ])

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
    expect(String(result.error)).toContain("not found")
    expect(fs.readFileSync(target(), "utf8")).toBe(before)
  })

  it("不正な --keep セレクタでエラーを返す", () => {
    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write",
      "--keep",
      "bogus:value"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
  })
})
