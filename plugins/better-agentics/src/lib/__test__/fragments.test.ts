import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkFragments,
  loadFragments,
  loadPreamble,
  pluginRoot,
  scaffoldFragments
} from "../fragments"
import { ROLES, roleById } from "../roles"

const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const REVIEW_ROLES = ROLES.filter((role) => role.reason === "review").map(
  (role) => role.id
)
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function translationDir(lang: string): string {
  return path.join(project, ".claude", "better-agentics", "roles", lang)
}

describe("pluginRoot", () => {
  it("ソースから呼んでもプラグインのルートを返す", () => {
    const saved = process.env.CLAUDE_PLUGIN_ROOT
    delete process.env.CLAUDE_PLUGIN_ROOT
    try {
      expect(path.resolve(pluginRoot())).toBe(path.resolve(ROOT))
    } finally {
      if (saved !== undefined) process.env.CLAUDE_PLUGIN_ROOT = saved
    }
  })
})

describe("loadFragments", () => {
  for (const lang of ["ja", "en"]) {
    it(`${lang} の 13 役割を読み、種別が役割表と一致する`, () => {
      const fragments = loadFragments(ROOT, project, lang)
      expect([...fragments.keys()].sort()).toEqual(
        ROLES.map((role) => role.id).sort()
      )
      for (const [id, fragment] of fragments) {
        expect(fragment.kind).toBe(roleById(id)?.kind)
        expect(fragment.tools.length).toBeGreaterThan(0)
        expect(fragment.defaultName).not.toBe("")
      }
    })

    it(`${lang} の When to invoke は ASCII だけで書かれている`, () => {
      for (const fragment of loadFragments(ROOT, project, lang).values()) {
        const when = fragment.sections.get("## When to invoke") ?? []
        expect(when.length).toBeGreaterThan(0)
        expect(when.join("\n")).toMatch(/^[\t\n -~]*$/)
      }
    })

    it(`${lang} はレビュー役割の Output Format だけに重大度を持つ`, () => {
      for (const [id, fragment] of loadFragments(ROOT, project, lang)) {
        const output = (fragment.sections.get("## Output Format") ?? []).join(
          "\n"
        )
        expect(output.includes("critical")).toBe(REVIEW_ROLES.includes(id))
      }
    })
  }

  it("基準を含んでいた description を短い句に書き換えてある", () => {
    const ja = loadFragments(ROOT, project, "ja")
    expect(ja.get("normal-impl")?.description).toBe("通常の実装")
    expect(ja.get("escalation")?.description).toBe(
      "行き詰まりの原因の特定と打開"
    )
    expect(ja.get("code-review")?.description).toBe("変更差分のレビュー")
    const en = loadFragments(ROOT, project, "en")
    expect(en.get("light-impl")?.description).toBe("lightweight implementation")
    for (const fragment of ja.values()) {
      expect(fragment.description).not.toContain("いずれか")
    }
  })

  it("翻訳断片で置き換えても When to invoke は同梱 en の値を使う", () => {
    scaffoldFragments(ROOT, project, "fr")
    const file = path.join(translationDir("fr"), "code-review.md")
    const text = fs
      .readFileSync(file, "utf8")
      .replace(
        /## When to invoke\n\n[\s\S]*?\n\n## Core Responsibilities\n\n[^\n]*/,
        "## When to invoke\n\n- Utiliser pour X.\n\n## Core Responsibilities\n\n- Identifier les défauts."
      )
    fs.writeFileSync(file, text)

    const fr = loadFragments(ROOT, project, "fr").get("code-review")
    const en = loadFragments(ROOT, project, "en").get("code-review")
    expect(fr?.sections.get("## When to invoke")).toEqual(
      en?.sections.get("## When to invoke")
    )
    expect(fr?.sections.get("## Core Responsibilities")).toEqual([
      "- Identifier les défauts."
    ])
  })
})

describe("loadPreamble", () => {
  it("_common.md の Preamble だけを返す", () => {
    expect(loadPreamble(ROOT, project, "ja")).toEqual([
      "あなたは {{NAME}}。担う役割は{{ROLE_LABEL}}である。"
    ])
    for (const lang of ["ja", "en"]) {
      const common = fs.readFileSync(
        path.join(ROOT, "assets", "roles", lang, "_common.md"),
        "utf8"
      )
      expect(common).not.toMatch(/## (制約|Constraints)/)
    }
  })
})

describe("言語コードの検査", () => {
  it("パスを含む言語コードは読み書きの前に拒む", () => {
    for (const lang of ["../x", "fr/../../etc", ""]) {
      expect(() => checkFragments(ROOT, project, lang)).toThrow(/lang/)
      expect(() => scaffoldFragments(ROOT, project, lang)).toThrow(/lang/)
      expect(() => loadFragments(ROOT, project, lang)).toThrow(/lang/)
    }
    expect(fs.existsSync(path.join(project, ".claude"))).toBe(false)
  })

  it("地域付きの言語コードは受け付ける", () => {
    expect(checkFragments(ROOT, project, "pt-BR").missing).toHaveLength(14)
  })
})

describe("checkFragments / scaffoldFragments", () => {
  it("ja は翻訳断片を要しない", () => {
    expect(checkFragments(ROOT, project, "ja")).toMatchObject({
      targetDir: null,
      missing: [],
      stale: []
    })
  })

  it("翻訳断片が無ければ 14 ファイルを missing に返す", () => {
    expect(checkFragments(ROOT, project, "fr").missing).toHaveLength(14)
  })

  it("scaffold の後は ready に入り、source-lang と source-hash が付く", () => {
    const written = scaffoldFragments(ROOT, project, "fr")
    expect(written).toHaveLength(14)
    const status = checkFragments(ROOT, project, "fr")
    expect(status.ready).toHaveLength(14)
    expect(status.missing).toEqual([])
    const text = fs.readFileSync(
      path.join(translationDir("fr"), "code-review.md"),
      "utf8"
    )
    expect(text).toMatch(/\nsource-lang: en\nsource-hash: [0-9a-f]{16}\n---/)
  })

  it("source-hash が一致しないファイルを stale に入れ、scaffold で上書きする", () => {
    scaffoldFragments(ROOT, project, "fr")
    const file = path.join(translationDir("fr"), "explore.md")
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(/source-hash: .*/, "source-hash: 0000000000000000")
    )
    expect(checkFragments(ROOT, project, "fr").stale).toEqual(["explore"])
    expect(scaffoldFragments(ROOT, project, "fr")).toEqual([file])
  })

  it("source-hash が一致するファイルは上書きしない", () => {
    scaffoldFragments(ROOT, project, "fr")
    const file = path.join(translationDir("fr"), "general.md")
    const translated = fs
      .readFileSync(file, "utf8")
      .replace("label: General", "label: Général")
    fs.writeFileSync(file, translated)
    expect(scaffoldFragments(ROOT, project, "fr")).toEqual([])
    expect(fs.readFileSync(file, "utf8")).toBe(translated)
  })
})
