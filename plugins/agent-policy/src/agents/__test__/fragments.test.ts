import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkFragments,
  type FragmentDir,
  fragmentDirsFor,
  loadCommon,
  loadFragments,
  scaffoldFragments
} from "../fragments"
import { bodyHash } from "../hash"

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const JA: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "ja"),
  source: "plugin"
}

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function writeFragment(dir: string, id: string, label: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `label: ${label}`,
      `description: ${id} description`,
      "tools: Read, Grep, Glob",
      "kind: readonly",
      "---",
      "",
      "## When to invoke",
      "",
      `- ${id} body`,
      ""
    ].join("\n")
  )
}

describe("loadFragments の 3 段探索", () => {
  it("同梱断片を読み込む", () => {
    const fragments = loadFragments([JA], "claude")
    expect(fragments.size).toBe(10)
    expect(fragments.get("explore")?.source).toBe("plugin")
  })

  it("同梱断片から defaultName を読み込む", () => {
    const fragments = loadFragments([JA], "claude")
    expect(fragments.get("explore")?.defaultName).toBe("explorer")
  })

  it("default-name が無い断片の defaultName は undefined になる", () => {
    const own = path.join(project, "roles")
    writeFragment(own, "triage", "triage label")
    const fragments = loadFragments(
      [JA, { path: own, source: "project" }],
      "claude"
    )
    expect(fragments.get("triage")?.defaultName).toBeUndefined()
  })

  it("プロジェクト翻訳が同梱を置き換える", () => {
    const translated = path.join(project, "roles", "de")
    writeFragment(translated, "explore", "translated label")
    const fragments = loadFragments(
      [JA, { path: translated, source: "project" }],
      "claude"
    )
    expect(fragments.get("explore")?.label).toBe("translated label")
    expect(fragments.get("explore")?.source).toBe("project")
  })

  it("プロジェクト独自が翻訳より優先される", () => {
    const translated = path.join(project, "roles", "de")
    const own = path.join(project, "roles")
    writeFragment(translated, "explore", "translated label")
    writeFragment(own, "explore", "own label")
    const fragments = loadFragments(
      [
        JA,
        { path: translated, source: "project" },
        { path: own, source: "project" }
      ],
      "claude"
    )
    expect(fragments.get("explore")?.label).toBe("own label")
  })

  it("ベンダー別断片は後勝ちで置き換わり、二重に追記されない", () => {
    const translated = path.join(project, "roles", "de")
    fs.mkdirSync(translated, { recursive: true })
    fs.writeFileSync(
      path.join(translated, "realtime-research.grok.md"),
      [
        "---",
        "id: realtime-research",
        "vendor: grok",
        "---",
        "",
        "## 作業手順",
        "",
        "- translated grok step",
        ""
      ].join("\n")
    )
    const fragments = loadFragments(
      [JA, { path: translated, source: "project" }],
      "grok"
    )
    const steps = fragments
      .get("realtime-research")
      ?.sections.get("## 作業手順")
    expect(steps?.filter((line) => line.includes("grok step")).length).toBe(1)
    expect(steps?.join("\n")).toContain("translated grok step")
    expect(steps?.join("\n")).not.toContain("X 由来")
  })

  it("vendor が一致しないベンダー別断片は読まない", () => {
    const fragments = loadFragments([JA], "claude")
    const steps = fragments
      .get("realtime-research")
      ?.sections.get("## 作業手順")
    expect(steps?.join("\n")).not.toContain("X 由来")
  })
})

describe("fragmentDirsFor", () => {
  it("ja は同梱 ja からプロジェクト独自の順で返す", () => {
    expect(fragmentDirsFor(PLUGIN_ROOT, project, "ja")).toEqual([
      {
        path: path.join(PLUGIN_ROOT, "assets", "roles", "ja"),
        source: "plugin"
      },
      {
        path: path.join(project, ".claude", "agent-policy", "roles"),
        source: "project"
      }
    ])
  })

  it("en は同梱 en からプロジェクト独自の順で返す", () => {
    expect(fragmentDirsFor(PLUGIN_ROOT, project, "en")).toEqual([
      {
        path: path.join(PLUGIN_ROOT, "assets", "roles", "en"),
        source: "plugin"
      },
      {
        path: path.join(project, ".claude", "agent-policy", "roles"),
        source: "project"
      }
    ])
  })

  it("ja と en 以外は同梱 en、プロジェクト翻訳、プロジェクト独自の順で返す", () => {
    expect(fragmentDirsFor(PLUGIN_ROOT, project, "de")).toEqual([
      {
        path: path.join(PLUGIN_ROOT, "assets", "roles", "en"),
        source: "plugin"
      },
      {
        path: path.join(project, ".claude", "agent-policy", "roles", "de"),
        source: "project"
      },
      {
        path: path.join(project, ".claude", "agent-policy", "roles"),
        source: "project"
      }
    ])
  })
})

describe("loadCommon", () => {
  it("同梱の _common.md を読む", () => {
    expect(loadCommon([JA]).has("## Preamble")).toBe(true)
  })
})

describe("bodyHash", () => {
  it("frontmatter を変えてもハッシュが変わらない", () => {
    const a = "---\nid: x\nlabel: A\n---\n\n## H\n\n- body\n"
    const b = "---\nid: x\nlabel: B\n---\n\n## H\n\n- body\n"
    expect(bodyHash(a)).toBe(bodyHash(b))
  })

  it("本文を変えるとハッシュが変わる", () => {
    const a = "---\nid: x\n---\n\n## H\n\n- body\n"
    const b = "---\nid: x\n---\n\n## H\n\n- other\n"
    expect(bodyHash(a)).not.toBe(bodyHash(b))
  })
})

describe("checkFragments", () => {
  it("ja では missing も stale も空で targetDir が null", () => {
    const status = checkFragments(PLUGIN_ROOT, project, "ja")
    expect(status.missing).toEqual([])
    expect(status.stale).toEqual([])
    expect(status.targetDir).toBeNull()
  })

  it("翻訳先が空なら全断片が missing になる", () => {
    const status = checkFragments(PLUGIN_ROOT, project, "de")
    expect(status.missing).toContain("_common")
    expect(status.missing).toContain("explore")
    expect(status.ready).toEqual([])
  })

  it("scaffold 後は missing が空になる", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const status = checkFragments(PLUGIN_ROOT, project, "de")
    expect(status.missing).toEqual([])
    expect(status.stale).toEqual([])
    expect(status.ready.length).toBeGreaterThan(0)
  })

  it("source-hash がずれると stale になる", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const file = path.join(
      project,
      ".claude",
      "agent-policy",
      "roles",
      "de",
      "explore.md"
    )
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(/^source-hash: .*$/m, "source-hash: stale")
    )
    const status = checkFragments(PLUGIN_ROOT, project, "de")
    expect(status.stale.map((entry) => entry.id)).toContain("explore")
  })

  it("scaffold は source-lang と source-hash を書き込む", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const content = fs.readFileSync(
      path.join(
        project,
        ".claude",
        "agent-policy",
        "roles",
        "de",
        "explore.md"
      ),
      "utf8"
    )
    expect(content).toContain("source-lang: en")
    expect(content).toMatch(/^source-hash: [0-9a-f]{16}$/m)
  })

  it("scaffold は最新の翻訳を上書きしない", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const file = path.join(
      project,
      ".claude",
      "agent-policy",
      "roles",
      "de",
      "explore.md"
    )
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("## When to invoke", "## Wann")
    )
    const written = scaffoldFragments(PLUGIN_ROOT, project, "de")
    expect(written).toEqual([])
    expect(fs.readFileSync(file, "utf8")).toContain("## Wann")
  })
})
