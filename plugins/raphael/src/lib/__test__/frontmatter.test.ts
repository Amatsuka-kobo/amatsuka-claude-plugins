import { expect, test } from "vitest"
import {
  AntibodyValidationError,
  parseAntibodyMarkdown,
  parseAntibodyMarkdownWithLegacy,
  serializeAntibodyMarkdown,
  validateAntibody
} from "../frontmatter.js"
import type { Antibody } from "../types.js"

const LEGACY_EXAMPLE = `---
id: ab-2026-0721-001
created: 2026-07-21
source: infection-2026-0721-003        # 由来
trigger:
  event: PreToolUse                    # 発火イベント
  tool: Bash                           # 対象ツール
  pattern: "prisma\\\\s+migrate"         # 正規表現
  scope: "src/db/**"                   # 任意
status: active                         # 状態
stats:
  fired: 3                             # 発火回数
  last_fired: 2026-07-21
expires: 2026-08-21                    # 有効期限
---

このプロジェクトの \`prisma migrate\` は直接実行せず、先に
\`pnpm db:generate\` を実行して schema 差分を確認すること。
前回、生成物の不整合でマイグレーションが 3 回連続で失敗した。
`

function antibody(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual: reason #1 \\ origin",
    trigger: {
      event: "PreToolUse",
      tool: "Edit",
      pattern: String.raw`foo:\s+"bar"\\baz#qux`,
      scope: ""
    },
    status: "active",
    expires: "2026-08-23",
    body: "Do not repeat the failed edit.",
    ...overrides
  }
}

test("旧形式を読み、legacyStats を返し、通常 parser は stats を捨てる", () => {
  const parsed = parseAntibodyMarkdownWithLegacy(LEGACY_EXAMPLE)
  expect(parsed.legacyStats).toEqual({
    fired: 3,
    last_fired: "2026-07-21"
  })
  expect(parsed.antibody).not.toHaveProperty("stats")
  expect(parseAntibodyMarkdown(LEGACY_EXAMPLE)).toEqual(parsed.antibody)
})

test("legacy stats group は trailing comment を許可する", () => {
  const parsed = parseAntibodyMarkdownWithLegacy(
    LEGACY_EXAMPLE.replace("stats:", "stats: # legacy")
  )
  expect(parsed.legacyStats).toEqual({
    fired: 3,
    last_fired: "2026-07-21"
  })
})

test("legacy stats.last_fired は実在する暦日だけ許可する", () => {
  expect(() =>
    parseAntibodyMarkdownWithLegacy(
      LEGACY_EXAMPLE.replace("last_fired: 2026-07-21", "last_fired: 2026-02-30")
    )
  ).toThrow("stats.last_fired: must be a valid calendar date")
})

test("旧形式を serialize すると stats が消え、新形式で round-trip する", () => {
  const parsed = parseAntibodyMarkdownWithLegacy(LEGACY_EXAMPLE)
  const serialized = serializeAntibodyMarkdown(parsed.antibody)

  expect(serialized).not.toContain("\nstats:\n")
  expect(parseAntibodyMarkdownWithLegacy(serialized)).toEqual({
    antibody: parsed.antibody,
    legacyStats: null
  })
})

test("JSON quote した source/pattern/scope を stats なしで往復する", () => {
  const value = antibody()
  const serialized = serializeAntibodyMarkdown(value)

  expect(serialized).toContain(`source: ${JSON.stringify(value.source)}`)
  expect(serialized).toContain(
    `  pattern: ${JSON.stringify(value.trigger.pattern)}`
  )
  expect(serialized).toContain('  scope: ""')
  expect(serialized).not.toContain("stats:")
  expect(parseAntibodyMarkdown(serialized)).toEqual(value)
})

test("serializer の key 順を固定する", () => {
  const serialized = serializeAntibodyMarkdown(antibody())
  expect(serialized).toMatch(
    /^---\nid: .*\ncreated: .*\nsource: .*\ntrigger:\n {2}event: .*\n {2}tool: .*\n {2}pattern: .*\n {2}scope: .*\nstatus: .*\nexpires: .*\n---\n\n/
  )
})

test("validateAntibody は stats key を明示的に拒否する", () => {
  expect(() =>
    validateAntibody({
      ...antibody(),
      stats: { fired: 1, last_fired: "2026-07-24" }
    })
  ).toThrow("antibody.stats: is not supported")
})

test.each([
  ["status", { status: "disabled" }],
  ["tool", { trigger: { ...antibody().trigger, tool: "Read" } }],
  ["regex", { trigger: { ...antibody().trigger, pattern: "[" } }],
  ["body", { body: "   \n" }]
])("invalid %s を拒否する", (_name, overrides) => {
  expect(() => validateAntibody({ ...antibody(), ...overrides })).toThrow(
    AntibodyValidationError
  )
})

test("長さ上限と必須 fixed schema を検証する", () => {
  expect(() => validateAntibody(antibody({ source: "s".repeat(501) }))).toThrow(
    /source/
  )
  expect(() =>
    validateAntibody(
      antibody({
        trigger: { ...antibody().trigger, pattern: "p".repeat(1_001) }
      })
    )
  ).toThrow(/pattern/)
  expect(() => validateAntibody(antibody({ body: "b".repeat(9_001) }))).toThrow(
    /body/
  )
  expect(() =>
    parseAntibodyMarkdown(LEGACY_EXAMPLE.replace("expires:", "unknown:"))
  ).toThrow(AntibodyValidationError)
})

test("confirmed でも expires の値をそのまま serialize する", () => {
  const original = antibody({ status: "confirmed", expires: "2026-08-23" })
  const serialized = serializeAntibodyMarkdown(original)
  expect(serialized).toContain("expires: 2026-08-23")
  expect(parseAntibodyMarkdown(serialized).expires).toBe("2026-08-23")
})
