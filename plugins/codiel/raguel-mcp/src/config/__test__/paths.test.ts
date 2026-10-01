import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { RaguelConfig } from "../../core/types"
import { defaultConfig } from "../defaults"
import {
  classifyPath,
  DEFAULT_TESTS_DIR,
  globFixedPart,
  isE2eReport,
  resolveTestsDir
} from "../paths"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "raguel-paths-test-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeProjectConfig(content: string | Record<string, unknown>): void {
  mkdirSync(join(root, ".codiel"), { recursive: true })
  writeFileSync(
    join(root, ".codiel", "config.json"),
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8"
  )
}

function configWithGenerated(generated: string[]): RaguelConfig {
  const config = structuredClone(defaultConfig)
  config.rules["code/protected-paths"] = {
    ...config.rules["code/protected-paths"],
    generated
  }
  return config
}

describe("resolveTestsDir(R24。codiel の readCodielConfig と同じ規則)", () => {
  it("config.json が無ければ既定の docs/codiel/tests", () => {
    expect(resolveTestsDir(root)).toBe(DEFAULT_TESTS_DIR)
    expect(DEFAULT_TESTS_DIR).toBe("docs/codiel/tests")
  })

  it("testsDir のキーが無ければ既定の値", () => {
    writeProjectConfig({ runsDir: "x", raguel: {} })
    expect(resolveTestsDir(root)).toBe(DEFAULT_TESTS_DIR)
  })

  it.each([
    ["./e2e/", "e2e"],
    ["tests//", "tests"],
    [".", "."],
    ["a/./b", "a/b"]
  ])("%s は %s に正規化する", (value, expected) => {
    writeProjectConfig({ testsDir: value })
    expect(resolveTestsDir(root)).toBe(expected)
  })

  it.each([
    ["文字列でない", 1],
    ["null", null],
    ["空", ""],
    ["絶対パス", "/abs"],
    ["Windows の絶対パス", "C:\\tests"],
    ["..", "a/../b"]
  ])("testsDir が%sなら例外を投げる", (_name, value) => {
    writeProjectConfig({ testsDir: value })
    expect(() => resolveTestsDir(root)).toThrow(/testsDir/)
  })

  it("config.json が JSON でないかオブジェクトでなければ例外を投げる", () => {
    writeProjectConfig("{")
    expect(() => resolveTestsDir(root)).toThrow(/JSON/)
    writeProjectConfig("[]")
    expect(() => resolveTestsDir(root)).toThrow(/オブジェクト/)
  })
})

describe("isE2eReport(codiel の isE2eReport と同じ判定)", () => {
  it.each([
    [
      "docs/codiel/tests/e2e/cli/x/reports/20260929-1200-a-try1/results.json",
      true
    ],
    ["docs/codiel/tests/reports/summary.md", true],
    ["docs/codiel/tests/e2e/cli/x/spec.md", false],
    ["docs/codiel/tests/e2e/cli/x/myreports/a.md", false],
    ["docs/reports/a.md", false],
    ["reports/a.md", false],
    ["docs/codiel/testsx/reports/a.md", false]
  ])("testsDir が docs/codiel/tests のとき %s は %s", (repoRel, expected) => {
    expect(isE2eReport(repoRel, "docs/codiel/tests")).toBe(expected)
  })

  it("testsDir が . ならリポジトリ全体を配下とみなす", () => {
    expect(isE2eReport("reports/a.md", ".")).toBe(true)
    expect(isE2eReport("src/e2e/reports/a.json", ".")).toBe(true)
    expect(isE2eReport("src/a.ts", ".")).toBe(false)
  })
})

describe("classifyPath(R20・R24)", () => {
  const testsDir = "docs/codiel/tests"

  it("testsDir の配下の reports/ は report", () => {
    const config = configWithGenerated([])
    expect(
      classifyPath(
        "docs/codiel/tests/e2e/backend/api/reports/r1/summary.md",
        config,
        testsDir
      )
    ).toBe("report")
  })

  it("testsDir の外の reports/ は外れない(normal)", () => {
    const config = configWithGenerated([])
    expect(classifyPath("src/reports/index.ts", config, testsDir)).toBe(
      "normal"
    )
    expect(classifyPath("reports/a.md", config, testsDir)).toBe("normal")
  })

  it("testsDir が . なら reports/ のセグメントを含むパスは report", () => {
    const config = configWithGenerated([])
    expect(classifyPath("src/reports/index.ts", config, ".")).toBe("report")
  })

  it("generated に当たるパスは generated、当たらないパスは normal", () => {
    const config = configWithGenerated([
      "plugins/*/scripts/**",
      "plugins/*/dist/**"
    ])
    expect(
      classifyPath("plugins/codiel/scripts/codiel-state.mjs", config, testsDir)
    ).toBe("generated")
    expect(
      classifyPath(
        "plugins/codiel/raguel-mcp/dist/server.mjs",
        config,
        testsDir
      )
    ).toBe("normal")
    expect(classifyPath("plugins/codiel/src/a.ts", config, testsDir)).toBe(
      "normal"
    )
  })

  it("generated が空なら生成物は無い", () => {
    const config = structuredClone(defaultConfig)
    expect(classifyPath("dist/a.js", config, testsDir)).toBe("normal")
  })
})

describe("globFixedPart", () => {
  it.each([
    ["plugins/*/scripts/**", "plugins"],
    ["dist/**", "dist"],
    ["src/server/auth/**", "src/server/auth"],
    ["**/*", ""],
    ["*.js", ""],
    ["**/*.env*", ""]
  ])("%s の固定部は %j", (glob, expected) => {
    expect(globFixedPart(glob)).toBe(expected)
  })
})
