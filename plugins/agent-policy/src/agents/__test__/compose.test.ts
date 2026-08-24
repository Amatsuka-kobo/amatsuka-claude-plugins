import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { compose } from "../compose"

const PLUGIN_ROLES = fileURLToPath(
  new URL("../../../assets/roles/", import.meta.url)
)

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
    ...overrides
  } as never)
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

  it("役割マーカーを ROLES の定義順で並べる", () => {
    const meta = frontmatter(build(["explore", "complex-impl"]))
    expect(meta["agent-policy-role"]).toBe("complex-impl, explore")
  })

  it("tools に MCP ツールを含まない", () => {
    const meta = frontmatter(build(["complex-impl", "explore"]))
    expect(meta.tools).not.toContain("mcp__")
  })

  it("Agent の付与が役割で決まる", () => {
    expect(frontmatter(build(["complex-impl"])).tools).toContain("Agent")
    expect(frontmatter(build(["light-impl"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["explore"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["light-impl", "complex-impl"])).tools).toContain(
      "Agent"
    )
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

  it("Agent が付かないとき「アドバイザーへの相談」節を出さない", () => {
    expect(build(["explore"])).not.toContain("## アドバイザーへの相談")
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
    expect(section).toContain("### コードベース探索実働")
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
    expect(body).toContain("コードベース探索実働")
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

describe("断片の解決", () => {
  it("ベンダー別断片が共通断片の同名節へ追記される", () => {
    const withGrok = compose({
      name: "g",
      model: "m",
      vendor: "grok",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES]
    })
    const withGpt = compose({
      name: "g",
      model: "m",
      vendor: "gpt",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES]
    })
    expect(withGrok).toContain("ソーシャル由来")
    expect(withGpt).not.toContain("ソーシャル由来")
    // 追記であって置き換えではないため、共通側の記述も残る
    expect(withGrok).toContain("一次情報源")
  })

  it("プロジェクト側の断片が共通断片を置き換える", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "explore.md"),
      [
        "---",
        "id: explore",
        "label: コードベース探索実働",
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
      fragmentDirs: [PLUGIN_ROLES, projectRoles]
    })
    expect(body).toContain("独自探索")
    expect(body).not.toContain("依頼された探索範囲だけを走査する")
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
      fragmentDirs: [PLUGIN_ROLES, projectRoles]
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
      fragmentDirs: [PLUGIN_ROLES, projectRoles]
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
