import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { environment } from "../hooks/__test__/helpers/hook"
import { textHash } from "../lib/hash"

const SCRIPT = fileURLToPath(new URL("../setup.ts", import.meta.url))
const TSX = createRequire(import.meta.url).resolve("tsx/cli")
const FAKE_CLAUDE = fileURLToPath(
  new URL("../testing/fake-claude.mjs", import.meta.url)
)
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

interface Result {
  status: number
  // biome-ignore lint/suspicious/noExplicitAny: CLI の応答は JSON の任意の形
  body: any
}

function setup(args: string[], env: NodeJS.ProcessEnv = {}): Result {
  try {
    const output = execFileSync(
      process.execPath,
      [TSX, SCRIPT, ...args, "--dir", project],
      {
        env: environment(env),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"]
      }
    )
    return { status: 0, body: JSON.parse(output) }
  } catch (error) {
    const failure = error as { status: number; stdout: string }
    return { status: failure.status, body: JSON.parse(failure.stdout) }
  }
}

function agentsDir(): string {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function place(file: string, lines: string[]): string {
  const target = path.join(agentsDir(), `${file}.md`)
  fs.writeFileSync(target, [...lines, ""].join("\n"))
  return target
}

describe("--list-coverage", () => {
  it("空のプロジェクトでは 13 役割がすべて未カバーになる", () => {
    const { body } = setup(["--list-coverage", "--lang", "ja"])
    expect(body.ok).toBe(true)
    expect(body.roles).toHaveLength(13)
    expect(body.uncovered).toHaveLength(13)
    expect(body.roles[0]).toMatchObject({
      id: "complex-impl",
      label: "複雑または重要な実装",
      kind: "impl",
      reason: "split",
      model: "opus",
      effort: "medium",
      defaultName: "lead-implementer",
      coveredBy: []
    })
  })

  it("定義の被覆・重複・未知の role-id・許可外のツールを返す", () => {
    place("a", [
      "---",
      "name: a",
      "tools: Read, Grep, Glob, Bash, Write, mcp__serena",
      "better-agentics-role: code-review",
      "---"
    ])
    place("b", [
      "---",
      "name: b",
      "tools: Read",
      "better-agentics-role: code-review",
      "---"
    ])
    place("c", [
      "---",
      "name: c",
      "tools: Read",
      "better-agentics-role: final-review",
      "---"
    ])
    place("d", [
      "---",
      "name: d",
      "tools:",
      "  - Read",
      "better-agentics-role: explore",
      "---"
    ])
    place("e", ["---", "name: e", "better-agentics-role: general", "---"])
    const { body } = setup(["--list-coverage", "--lang", "ja"])
    const role = (id: string) =>
      body.roles.find((entry: { id: string }) => entry.id === id)
    expect(role("code-review").coveredBy).toEqual(["a", "b"])
    expect(body.uncovered).not.toContain("explore")
    expect(body.duplicates).toEqual([
      { role: "code-review", files: ["a", "b"] }
    ])
    expect(body.unknownRoles).toEqual([{ file: "c", role: "final-review" }])
    const definition = (file: string) =>
      body.definitions.find((entry: { file: string }) => entry.file === file)
    expect(definition("a")).toMatchObject({
      known: true,
      disallowedTools: ["Write"],
      toolsFormat: "csv"
    })
    expect(definition("c")).toMatchObject({ known: false, disallowedTools: [] })
    expect(definition("d")).toMatchObject({ toolsFormat: "other" })
    expect(definition("e")).toMatchObject({
      toolsFormat: "none",
      disallowedTools: ["*"]
    })
  })
})

describe("--prune-tools", () => {
  it("tools 行から指定のツールを外し、他の行を変えない", () => {
    const file = place("a", [
      "---",
      "name: a",
      "tools: Read, Grep, Write",
      "better-agentics-role: code-review",
      "---",
      "",
      "本文"
    ])
    const { body } = setup(["--prune-tools", "--name", "a", "--tools", "Write"])
    expect(body).toMatchObject({
      ok: true,
      changed: true,
      toolsBefore: ["Read", "Grep", "Write"],
      toolsAfter: ["Read", "Grep"]
    })
    expect(fs.readFileSync(file, "utf8")).toBe(
      [
        "---",
        "name: a",
        "tools: Read, Grep",
        "better-agentics-role: code-review",
        "---",
        "",
        "本文",
        ""
      ].join("\n")
    )
  })

  it("block 配列・すべて外れる指定・範囲外の名前は拒む", () => {
    place("d", [
      "---",
      "name: d",
      "tools:",
      "  - Read",
      "better-agentics-role: explore",
      "---"
    ])
    expect(
      setup(["--prune-tools", "--name", "d", "--tools", "Read"]).body.ok
    ).toBe(false)
    place("a", [
      "---",
      "name: a",
      "tools: Write",
      "better-agentics-role: code-review",
      "---"
    ])
    expect(
      setup(["--prune-tools", "--name", "a", "--tools", "Write"]).body.ok
    ).toBe(false)
    const escaped = setup([
      "--prune-tools",
      "--name",
      "../x",
      "--tools",
      "Write"
    ])
    expect(escaped).toMatchObject({ status: 1, body: { ok: false } })
  })
})

describe("--rewrite-roles", () => {
  it("空の指定でマーカー行を消し、役割 ID で値を書き換える", () => {
    const file = place("a", [
      "---",
      "name: a",
      "better-agentics-role: code-review",
      "---"
    ])
    expect(
      setup(["--rewrite-roles", "--name", "a", "--roles", "normal-impl"]).body
    ).toMatchObject({
      ok: true,
      changed: true,
      before: "code-review",
      after: "normal-impl"
    })
    expect(
      setup(["--rewrite-roles", "--name", "a", "--roles", ""]).body
    ).toMatchObject({
      ok: true,
      after: null
    })
    expect(fs.readFileSync(file, "utf8")).not.toContain("better-agentics-role")
  })

  it("未知の役割 ID は拒む", () => {
    place("a", ["---", "name: a", "better-agentics-role: code-review", "---"])
    expect(
      setup(["--rewrite-roles", "--name", "a", "--roles", "final-review"]).body
        .ok
    ).toBe(false)
  })
})

describe("翻訳断片と MCP", () => {
  it("--check-fragments と --scaffold-fragments を返す", () => {
    expect(setup(["--check-fragments", "--lang", "fr"]).body).toMatchObject({
      ok: true,
      lang: "fr"
    })
    const { body } = setup(["--scaffold-fragments", "--lang", "fr"])
    expect(body.ok).toBe(true)
    expect(body.written).toContain(
      ".claude/better-agentics/roles/fr/code-review.md"
    )
    expect(
      setup(["--check-fragments", "--lang", "fr"]).body.ready
    ).toHaveLength(14)
  })

  it("--list-mcp は claude mcp list の出力を解析する", () => {
    const { body } = setup(["--list-mcp"], {
      BETTER_AGENTICS_CLAUDE_BIN: FAKE_CLAUDE,
      BETTER_AGENTICS_FAKE_MCP:
        "serena: uvx serena - ✔ Connected\nbroken: x - ✘ Failed to connect"
    })
    expect(body).toEqual({
      ok: true,
      servers: [
        { name: "serena", status: "✔ Connected", usable: true },
        { name: "broken", status: "✘ Failed to connect", usable: false }
      ]
    })
  })
})

function write(extra: string[] = [], env: NodeJS.ProcessEnv = {}): Result {
  return setup(
    [
      "--write",
      "--role",
      "code-review",
      "--model",
      "sonnet",
      "--name",
      "code-reviewer",
      "--lang",
      "ja",
      ...extra
    ],
    env
  )
}

function check(extra: string[] = [], name = "code-reviewer"): Result {
  return setup([
    "--check",
    "--role",
    "code-review",
    "--model",
    "sonnet",
    "--name",
    name,
    "--lang",
    "ja",
    ...extra
  ])
}

function read(file: string): string {
  return fs.readFileSync(path.join(agentsDir(), `${file}.md`), "utf8")
}

function section(
  report: { sections: { key: string; state: string }[] },
  key: string
): string | undefined {
  return report.sections.find((entry) => entry.key === key)?.state
}

describe("--check / --write", () => {
  it("新規生成では推奨の effort を書く", () => {
    expect(write().body).toMatchObject({
      ok: true,
      action: "written",
      target: ".claude/agents/code-reviewer.md"
    })
    expect(read("code-reviewer")).toContain("effort: high")
  })

  it("--effort で値を変え、none で effort 行を書かず、未知の値を拒む", () => {
    setup([
      "--write",
      "--role",
      "code-review",
      "--model",
      "opus",
      "--effort",
      "xhigh",
      "--name",
      "a",
      "--lang",
      "ja"
    ])
    expect(read("a")).toContain("effort: xhigh")
    setup([
      "--write",
      "--role",
      "code-review",
      "--model",
      "opus",
      "--effort",
      "none",
      "--name",
      "b",
      "--lang",
      "ja"
    ])
    expect(read("b")).not.toContain("effort:")
    expect(write(["--effort", "extreme"]).body.ok).toBe(false)
    expect(
      setup([
        "--write",
        "--role",
        "code-review",
        "--model",
        "inherit",
        "--name",
        "c",
        "--lang",
        "ja"
      ]).body.ok
    ).toBe(false)
  })

  it("既存のファイルが無ければ exists: false で sections が空", () => {
    expect(check().body).toMatchObject({
      ok: true,
      exists: false,
      adopt: false,
      sections: [],
      effort: "high"
    })
  })

  it("利用者が編集したセクションは userEdited になり、--keep で残る", () => {
    write()
    const file = path.join(agentsDir(), "code-reviewer.md")
    fs.writeFileSync(
      file,
      read("code-reviewer").replace(
        "- 差分だけでなく",
        "- 自分で書いた手順。差分だけでなく"
      )
    )
    const report = check().body
    expect(section(report, "## 作業手順")).toBe("userEdited")
    expect(section(report, "## Output Format")).toBe("same")
    expect(write(["--keep", "作業手順"]).body).toMatchObject({
      ok: true,
      action: "regenerated",
      kept: ["## 作業手順"]
    })
    expect(read("code-reviewer")).toContain("自分で書いた手順")
  })

  it("古いテンプレートで生成された定義は templateChanged になる", () => {
    write()
    const file = path.join(agentsDir(), "code-reviewer.md")
    const content = read("code-reviewer")
    const old = "- 古い手順。"
    const hashLine = content.match(/^better-agentics-hash: (.*)$/m)?.[1] ?? ""
    const record = JSON.parse(
      Buffer.from(hashLine, "base64url").toString("utf8")
    )
    record.sections["## 作業手順"] = textHash(old)
    fs.writeFileSync(
      file,
      content
        .replace(/(## 作業手順\n\n)[\s\S]*?(\n\n## )/, `$1${old}$2`)
        .replace(
          hashLine,
          Buffer.from(JSON.stringify(record)).toString("base64url")
        )
    )
    expect(section(check().body, "## 作業手順")).toBe("templateChanged")
  })

  it("マーカーの無い同名のファイルは取り込み、frontmatter を引き継ぐ", () => {
    place("code-reviewer", [
      "---",
      "name: code-reviewer",
      "description: Use this agent when 変更差分のレビューを委譲するとき。",
      "model: sonnet",
      "color: blue",
      "tools: Read, Grep, Glob, Bash, mcp__serena",
      "disallowedTools: mcp__serena__replace_content",
      "agent-policy-role: code-review",
      "---",
      "",
      "あなたは code-reviewer。",
      "",
      "## When to invoke",
      "",
      "- 古い基準",
      "",
      "## 制約",
      "",
      "- 古い制約"
    ])
    const report = check().body
    expect(report).toMatchObject({
      ok: true,
      exists: true,
      adopt: true,
      mcpCurrent: {
        servers: ["serena"],
        denyTools: ["mcp__serena__replace_content"]
      }
    })
    for (const entry of report.sections) {
      expect(["unknown", "same", "new", "extra"]).toContain(entry.state)
    }
    const result = write().body
    expect(result).toMatchObject({
      ok: true,
      action: "adopted",
      keysKept: ["color", "agent-policy-role"]
    })
    const content = read("code-reviewer")
    expect(content).toContain("- Use when reading a change diff")
    expect(content).toContain("agent-policy-role: code-review")
    expect(content).toContain("disallowedTools: mcp__serena__replace_content")
    expect(content).toMatch(/^tools: .*mcp__serena$/m)
    expect(content).toContain("better-agentics-role: code-review")
  })

  it("--mcp-servers は使えるサーバーだけを足し、使えない名前を mcpDropped に返す", () => {
    const env = {
      BETTER_AGENTICS_CLAUDE_BIN: FAKE_CLAUDE,
      BETTER_AGENTICS_FAKE_MCP: "serena: uvx serena - ✔ Connected"
    }
    expect(write(["--mcp-servers", "serena,ghost"], env).body).toMatchObject({
      ok: true,
      mcpDropped: ["ghost"]
    })
    expect(read("code-reviewer")).toMatch(
      /^tools: Read, Grep, Glob, Bash, mcp__serena$/m
    )
    write(["--mcp-servers", ""], env)
    expect(read("code-reviewer")).not.toContain("mcp__serena")
  })

  it("翻訳断片の無い言語の生成は拒む", () => {
    expect(
      setup([
        "--write",
        "--role",
        "code-review",
        "--model",
        "sonnet",
        "--name",
        "x",
        "--lang",
        "fr"
      ]).body.ok
    ).toBe(false)
  })

  it("ファイル名と name が違う定義を再生成しても name を残す", () => {
    place("docs-check", [
      "---",
      "name: docs-reviewer",
      "better-agentics-role: code-review",
      "---",
      "",
      "## When to invoke",
      "",
      "- x"
    ])
    expect(check([], "docs-check").body.ok).toBe(true)
    setup([
      "--write",
      "--role",
      "code-review",
      "--model",
      "sonnet",
      "--name",
      "docs-check",
      "--lang",
      "ja"
    ])
    expect(read("docs-check")).toMatch(/^name: docs-reviewer$/m)
    expect(fs.existsSync(path.join(agentsDir(), "docs-reviewer.md"))).toBe(
      false
    )
  })

  it("同じ見出しが 2 回ある既存の定義は拒む", () => {
    place("code-reviewer", [
      "---",
      "name: code-reviewer",
      "better-agentics-role: code-review",
      "---",
      "",
      "## 作業手順",
      "",
      "a",
      "",
      "## 作業手順",
      "",
      "b"
    ])
    expect(check().body.ok).toBe(false)
  })

  it("既存のファイルに無いセクションの --keep は拒む", () => {
    write()
    expect(write(["--keep", "存在しない"]).body.ok).toBe(false)
  })
})

describe("引数", () => {
  it("未知のオプションは終了コード 1 で ok: false を返す", () => {
    expect(setup(["--scope", "claude"])).toMatchObject({
      status: 1,
      body: { ok: false }
    })
  })
})
