import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { compose, describeRoles } from "../compose"
import { type FragmentDir, loadFragments } from "../fragments"
import { ROLES } from "../roles"

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const PLUGIN_ROLES: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "ja"),
  source: "plugin"
}
const EN: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "en"),
  source: "plugin"
}

let temporary: string

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
})

afterEach(() => {
  fs.rmSync(temporary, { recursive: true, force: true })
})

function build(roleIds: string[], overrides: Record<string, unknown> = {}) {
  return compose({
    name: "test-agent",
    model: "test-alias",
    vendor: "gpt",
    roleIds: roleIds as never,
    fragmentDirs: [PLUGIN_ROLES],
    lang: "ja",
    ...overrides
  })
}

function frontmatter(document: string): Record<string, string> {
  const lines = document.split("\n")
  const close = lines.indexOf("---", 1)
  const entries: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ")
    if (at > 0) entries[line.slice(0, at)] = line.slice(at + 2)
  }
  return entries
}

describe("frontmatter", () => {
  it("name と model を反映する", () => {
    const meta = frontmatter(build(["complex-impl"]))
    expect(meta.name).toBe("test-agent")
    expect(meta.model).toBe("test-alias")
  })

  it("description を役割の description から組み立てる", () => {
    const meta = frontmatter(build(["complex-impl"]))
    expect(meta.description).toContain("Use this agent when")
    expect(meta.description).toContain("複雑なコーディング")
    expect(meta.description).toContain("を委譲するとき")
  })

  it("複数役割の description を連結する", () => {
    const meta = frontmatter(build(["normal-impl", "explore"]))
    expect(meta.description).toContain("通常のコーディング")
    expect(meta.description).toContain("コードベース探索")
  })

  it("color をベンダーごとの固定値にする", () => {
    expect(frontmatter(build(["complex-impl"])).color).toBe("yellow")
    expect(frontmatter(build(["normal-impl"], { vendor: "grok" })).color).toBe(
      "red"
    )
    expect(
      frontmatter(build(["normal-impl"], { vendor: "claude" })).color
    ).toBe("blue")
  })

  it("none の既定色を blue にし、vendor marker を出力しない", () => {
    const document = build(["complex-impl"], { vendor: "none" })
    const meta = frontmatter(document)
    const lines = document.split("\n")
    const roleAt = lines.indexOf("agent-policy-role: complex-impl")

    expect(meta.color).toBe("blue")
    expect(meta["agent-policy-vendor"]).toBeUndefined()
    expect(lines[roleAt + 1]).toBe("---")
  })

  it("vendor marker を role marker の直後へ出力する", () => {
    for (const vendor of ["gpt", "grok", "claude"] as const) {
      const lines = build(["complex-impl"], { vendor }).split("\n")
      const roleAt = lines.indexOf("agent-policy-role: complex-impl")

      expect(lines[roleAt + 1]).toBe(`agent-policy-vendor: ${vendor}`)
    }
  })

  it("指定された color をベンダー既定より優先する", () => {
    expect(frontmatter(build(["normal-impl"], { color: "green" })).color).toBe(
      "green"
    )
  })

  it("役割マーカーを ROLES の定義順で並べる", () => {
    const meta = frontmatter(build(["explore", "complex-impl"]))
    expect(meta["agent-policy-role"]).toBe("complex-impl, explore")
  })

  it("役割マーカーを新規 ID を含めても ROLES の定義順で並べる", () => {
    const meta = frontmatter(
      build(["explore", "normal-impl", "general", "design-plan"])
    )
    expect(meta["agent-policy-role"]).toBe(
      "normal-impl, general, design-plan, explore"
    )
  })

  it("tools に MCP ツールを含まない", () => {
    const meta = frontmatter(build(["complex-impl", "explore"]))
    expect(meta.tools).not.toContain("mcp__")
  })

  it("Agent の付与が役割だけで決まる", () => {
    expect(frontmatter(build(["complex-impl"])).tools).toContain("Agent")
    expect(frontmatter(build(["light-impl"])).tools).toContain("Agent")
    expect(frontmatter(build(["escalation"])).tools).toContain("Agent")
    expect(frontmatter(build(["e2e-verify"])).tools).toContain("Agent")
    expect(frontmatter(build(["code-review"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["final-review"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["gate-review"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["explore"])).tools).toContain("Agent")
    expect(frontmatter(build(["light-impl", "complex-impl"])).tools).toContain(
      "Agent"
    )
    expect(frontmatter(build(["explore"])).tools).toContain("Agent")
  })

  it("役割だけで Agent の有無を決める", () => {
    expect(frontmatter(build(["light-impl"])).tools).toContain("Agent")
    expect(frontmatter(build(["advisor"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["complex-impl"])).tools).toContain("Agent")
  })
})

describe("describeRoles", () => {
  it("断片の kind でプロジェクト固有役割も分類する", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の切り分け",
        "description: 障害の切り分け",
        "tools: Read, Grep, Glob, Bash",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **切り分け。** 障害の原因を切り分けるとき。",
        ""
      ].join("\n")
    )

    const summary = describeRoles({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["triage", "normal-impl"] as never,
      fragmentDirs: [PLUGIN_ROLES, { path: projectRoles, source: "project" }],
      lang: "ja"
    })

    expect(summary).toEqual({
      ids: ["normal-impl", "triage"],
      implRoles: ["normal-impl"],
      readonlyRoles: ["triage"],
      mixedKinds: true,
      agentTool: true
    })
  })
})

describe("本文", () => {
  it("節の順序が仕様どおりになる", () => {
    const body = build(["complex-impl"])
    const order = [
      "## When to invoke",
      "## Core Responsibilities",
      "## 作業手順",
      "## アドバイザーへの相談",
      "## 文書の執筆",
      "## 制約",
      "## Output Format"
    ]
    let cursor = -1
    for (const heading of order) {
      const at = body.indexOf(heading)
      expect(at).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it("執筆の節を Agent の有無にかかわらず一度だけ出す", () => {
    for (const role of ["complex-impl", "code-review"] as const) {
      const body = build([role])
      expect(body.match(/^## 文書の執筆$/gm)).toHaveLength(1)
      expect(body.indexOf("## 文書の執筆")).toBeLessThan(
        body.indexOf("## 制約")
      )
      if (role === "complex-impl")
        expect(body.indexOf("## 文書の執筆")).toBeGreaterThan(
          body.indexOf("## アドバイザーへの相談")
        )
    }
  })

  it("英語の定義でも執筆の節を出す", () => {
    expect(
      build(["code-review"], { lang: "en", fragmentDirs: [EN] })
    ).toContain("## Writing")
  })

  it("日英の合成定義に廃止した役割や探索文書への参照を含めない", () => {
    for (const [lang, fragmentDirs] of [
      ["ja", [PLUGIN_ROLES]],
      ["en", [EN]]
    ] as const) {
      const body = build(
        ROLES.map((role) => role.id),
        { lang, fragmentDirs }
      )
      expect(body).not.toContain("doc-writing")
      expect(body).not.toContain("context-map")
    }
  })

  it("Agent が付かないとき「アドバイザーへの相談」節を出さない", () => {
    expect(build(["code-review"])).not.toContain("## アドバイザーへの相談")
  })

  it("general だけでも Agent と Agent tool の制約を出す", () => {
    const body = build(["general"])
    expect(frontmatter(body).tools.split(", ")).toContain("Agent")
    expect(body).toContain("`Agent` tool はアドバイザーへの相談だけに使う")
  })

  it("読み取り役割だけでも Agent と Agent tool の制約を出す", () => {
    const body = build(["explore"])
    expect(frontmatter(body).tools.split(", ")).toContain("Agent")
    expect(body).toContain("`Agent` tool はアドバイザーへの相談だけに使う")
  })

  it("複数の Agent 対応役割を合成しても Agent tool の制約は重複しない", () => {
    const body = build(["complex-impl", "general"])
    expect(
      body.match(/`Agent` tool はアドバイザーへの相談だけに使う/g) ?? []
    ).toHaveLength(1)
  })

  it("ツール運用節を作らない", () => {
    expect(build(["complex-impl", "explore"])).not.toContain("## ツール運用")
  })

  it("単一役割では Output Format に小見出しを立てない", () => {
    const body = build(["complex-impl"])
    const section = body.slice(body.indexOf("## Output Format"))
    expect(section).not.toContain("### ")
  })

  it("複数役割では Output Format に役割ごとの h3 を立てる", () => {
    const body = build(["complex-impl", "explore"])
    const section = body.slice(body.indexOf("## Output Format"))
    expect(section).toContain("### 複雑または重要な実装")
    expect(section).toContain("### コードベース探索")
  })

  it("読み取り役割の制約が役割スコープ付きで出る", () => {
    expect(build(["independent-review"])).toContain(
      "**独立レビューとして依頼されたときは**"
    )
  })

  it("冒頭宣言に定義名と役割名が入る", () => {
    const body = build(["complex-impl", "explore"])
    expect(body).toContain("あなたは test-agent")
    expect(body).toContain("複雑または重要な実装")
    expect(body).toContain("コードベース探索")
  })

  it("他定義の固有名を含まない", () => {
    const body = build(["complex-impl", "normal-impl", "light-impl"])
    for (const name of [
      "GPT Sol",
      "GPT Terra",
      "GPT Luna",
      "Grok Researcher"
    ]) {
      expect(body).not.toContain(name)
    }
  })
})

describe("同梱役割断片と ROLES の整合性", () => {
  function bundledRoleFiles(dir: string = PLUGIN_ROLES.path): string[] {
    return fs
      .readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith(".md") &&
          !name.startsWith("_") &&
          name.split(".").length === 2
      )
      .map((name) => name.replace(/\.md$/, ""))
      .sort()
      .map((id) => `${id}.md`)
  }

  it("ファイル名・frontmatter の id・ROLES の id が一致する", () => {
    const files = bundledRoleFiles()
    const fileIds = files.map((file) => file.replace(/\.md$/, ""))
    const fragmentIds = files.map(
      (file) =>
        frontmatter(fs.readFileSync(path.join(PLUGIN_ROLES.path, file), "utf8"))
          .id
    )
    const roleIds = ROLES.map((role) => role.id).sort()

    expect(fragmentIds).toEqual(fileIds)
    expect(fileIds).toEqual(roleIds)
  })

  it("各断片の label・tools・kind が ROLES と一致する", () => {
    for (const role of ROLES) {
      const meta = frontmatter(
        fs.readFileSync(path.join(PLUGIN_ROLES.path, `${role.id}.md`), "utf8")
      )
      expect(meta.label).toBe(role.label)
      expect(meta.tools?.split(", ")).toEqual(role.tools)
      expect(meta.kind).toBe(role.kind)
    }
  })

  it("en 断片のファイル名・frontmatter の id・ROLES の id が一致する", () => {
    const files = bundledRoleFiles(EN.path)
    const fileIds = files.map((file) => file.replace(/\.md$/, ""))
    const fragmentIds = files.map(
      (file) =>
        frontmatter(fs.readFileSync(path.join(EN.path, file), "utf8")).id
    )
    const roleIds = ROLES.map((role) => role.id).sort()

    expect(fragmentIds).toEqual(fileIds)
    expect(fileIds).toEqual(roleIds)
  })

  it("en 断片の default-name・tools・kind が ja 断片と一致する", () => {
    for (const role of ROLES) {
      const jaMeta = frontmatter(
        fs.readFileSync(path.join(PLUGIN_ROLES.path, `${role.id}.md`), "utf8")
      )
      const enMeta = frontmatter(
        fs.readFileSync(path.join(EN.path, `${role.id}.md`), "utf8")
      )
      expect(enMeta["default-name"], role.id).toBe(jaMeta["default-name"])
      expect(enMeta.tools, role.id).toBe(jaMeta.tools)
      expect(enMeta.kind, role.id).toBe(jaMeta.kind)
    }
  })

  it("全断片の本文に他定義の固有名を含まない", () => {
    const names = [
      "GPT Sol",
      "GPT Terra",
      "GPT Luna",
      "Grok Implementer",
      "Grok Researcher",
      "Claude Researcher"
    ]
    const files = fs
      .readdirSync(PLUGIN_ROLES.path)
      .filter((name) => name.endsWith(".md"))

    for (const file of files) {
      const content = fs.readFileSync(
        path.join(PLUGIN_ROLES.path, file),
        "utf8"
      )
      const lines = content.split("\n")
      const body = lines.slice(lines.indexOf("---", 1) + 1).join("\n")
      for (const name of names) expect(body).not.toContain(name)
    }
  })
})

describe("断片の解決", () => {
  it("ベンダー別断片が共通断片の同名節へ追記される", () => {
    const withGrok = compose({
      name: "g",
      model: "m",
      vendor: "grok",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES],
      lang: "ja"
    })
    const withGpt = compose({
      name: "g",
      model: "m",
      vendor: "gpt",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES],
      lang: "ja"
    })
    expect(withGrok).toContain("ソーシャル由来")
    expect(withGpt).not.toContain("ソーシャル由来")
    // 追記であって置き換えではないため、共通側の記述も残る
    expect(withGrok).toContain("一次情報源")
  })

  it("none はベンダー別断片の overlay を適用しない", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "realtime-research.none.md"),
      [
        "---",
        "id: realtime-research",
        "vendor: none",
        "---",
        "",
        "## 作業手順",
        "",
        "- none vendor overlay",
        ""
      ].join("\n")
    )

    const document = compose({
      name: "none",
      model: "m",
      vendor: "none",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES, { path: projectRoles, source: "project" }],
      lang: "ja"
    })

    expect(document).not.toContain("ソーシャル由来")
    expect(document).not.toContain("none vendor overlay")
    expect(document).toContain("一次情報源")
  })

  it("プロジェクト側の断片が共通断片を置き換える", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "explore.md"),
      [
        "---",
        "id: explore",
        "label: コードベース探索",
        "description: プロジェクト独自の探索規律",
        "tools: Read, Grep, Glob",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **独自探索。** プロジェクト固有の探索規律に従うとき。",
        ""
      ].join("\n")
    )

    const body = compose({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["explore"] as never,
      fragmentDirs: [PLUGIN_ROLES, { path: projectRoles, source: "project" }],
      lang: "ja"
    })
    expect(body).toContain("独自探索")
    expect(body).not.toContain("依頼された探索範囲だけを走査する")
    expect(frontmatter(body).tools).toBe("Read, Grep, Glob, Agent")
  })

  it("プロジェクト側断片の Agent はモデルと役割の判定に従って付ける", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "explore.md"),
      [
        "---",
        "id: explore",
        "label: コードベース探索",
        "description: プロジェクト独自の探索規律",
        "tools: Read, Grep, Glob, Agent",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **独自探索。** プロジェクト固有の探索規律に従うとき。",
        ""
      ].join("\n")
    )

    const body = compose({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["explore"] as never,
      fragmentDirs: [PLUGIN_ROLES, { path: projectRoles, source: "project" }],
      lang: "ja"
    })
    expect(frontmatter(body).tools.split(", ")).toContain("Agent")
  })

  it("プロジェクト側にしかない役割 ID を解決できる", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の切り分け",
        "description: 障害の切り分け",
        "tools: Read, Grep, Glob, Bash",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **切り分け。** 障害の原因を切り分けるとき。",
        ""
      ].join("\n")
    )

    const body = compose({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["triage"] as never,
      fragmentDirs: [PLUGIN_ROLES, { path: projectRoles, source: "project" }],
      lang: "ja"
    })
    expect(body).toContain("切り分け")
  })

  it("プロジェクト側の _common.md は節単位で上書きする", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "_common.md"),
      [
        "---",
        "id: _common",
        "---",
        "",
        "## 制約",
        "",
        "- プロジェクト固有の共通制約。",
        ""
      ].join("\n")
    )

    const body = compose({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["complex-impl"] as never,
      fragmentDirs: [PLUGIN_ROLES, { path: projectRoles, source: "project" }],
      lang: "ja"
    })
    // 差し替えた節は反映される
    expect(body).toContain("プロジェクト固有の共通制約")
    // 差し替えなかった節は残る
    expect(body).toContain("あなたは x")
    expect(body).toContain("## アドバイザーへの相談")
  })

  it("未知の役割 ID ではエラーを投げる", () => {
    expect(() => build(["no-such-role"])).toThrow(/no-such-role/)
  })
})

describe("英語断片での合成", () => {
  it("すべての役割が英語断片で合成できる", () => {
    for (const role of ROLES) {
      const document = compose({
        name: "test-agent",
        model: "sonnet",
        vendor: "claude",
        roleIds: [role.id],
        fragmentDirs: [EN],
        lang: "en"
      })
      expect(document, role.id).toContain("name: test-agent")
      expect(document, role.id).toContain("## Output Format")
    }
  })

  it("英語断片の id と kind と tools は日本語断片と一致する", () => {
    const ja = loadFragments([PLUGIN_ROLES], "claude")
    const en = loadFragments([EN], "claude")
    expect([...en.keys()].sort()).toEqual([...ja.keys()].sort())
    for (const [id, fragment] of en) {
      expect(fragment.kind, id).toBe(ja.get(id)?.kind)
      expect(fragment.tools, id).toEqual(ja.get(id)?.tools)
      expect(fragment.defaultName, id).toBe(ja.get(id)?.defaultName)
    }
  })

  it("英語で合成した定義に日本語と日本語約物が混入しない", () => {
    const document = compose({
      name: "test-agent",
      model: "sonnet",
      vendor: "claude",
      roleIds: ["complex-impl", "explore"],
      fragmentDirs: [EN],
      lang: "en"
    })
    expect(document).not.toMatch(/[぀-ゟ゠-ヿ一-龯、。「」]/)
  })

  it("日本語見出しのプロジェクト断片は英語合成で該当節を出さない", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "explore.md"),
      [
        "---",
        "id: explore",
        "label: Project explorer",
        "description: project-specific exploration",
        "tools: Read, Grep, Glob",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- Keep this matching section.",
        "",
        "## 作業手順",
        "",
        "- This procedure must be omitted.",
        "",
        "## 制約",
        "",
        "- This constraint must be omitted.",
        "",
        "## Output Format",
        "",
        "- Keep this output format."
      ].join("\n")
    )

    const document = compose({
      name: "test-agent",
      model: "sonnet",
      vendor: "claude",
      roleIds: ["explore"],
      fragmentDirs: [EN, { path: projectRoles, source: "project" }],
      lang: "en"
    })
    expect(document).toContain("Keep this matching section.")
    expect(document).toContain("Keep this output format.")
    expect(document).not.toContain("This procedure must be omitted.")
    expect(document).not.toContain("This constraint must be omitted.")
    expect(document).not.toContain("## 作業手順")
    expect(document).not.toContain("## 制約")
  })

  it("英語で合成した定義の見出しが英語になっている", () => {
    const document = compose({
      name: "test-agent",
      model: "sonnet",
      vendor: "claude",
      roleIds: ["complex-impl"],
      fragmentDirs: [EN],
      lang: "en"
    })
    expect(document).toContain("## Procedure")
    expect(document).toContain("## Constraints")
    expect(document).not.toContain("## 作業手順")
  })
})
