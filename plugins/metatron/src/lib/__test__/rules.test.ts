// `.claude/rules/metatron/` の 3 ファイルのパス導出・読み取り・書式検証の検証。
// ケース ID は実装計画書 Task 3 の表(RL1〜RL10)に対応する。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { loadConfig } from "../config.js"
import {
  isRulesName,
  prepareRulesUpdate,
  RULES_ADMIN_NOTICE,
  RULES_FILES,
  readRulesFile,
  rulesFilePath
} from "../rules.js"

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 後始末の失敗はテスト結果に影響させない
    }
  }
})

// 設定ファイルを必ず置く。findDocRoot の段 1 で docRoot をこのディレクトリに固定し、
// 祖先や git の状態にテストが依存しないようにするため。
function mkProject(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-rules-"))
  )
  fs.writeFileSync(path.join(dir, "metatron.config.json"), '{"version":1}')
  tmpDirs.push(dir)
  return dir
}

const OK_BODY = `# 規約\n\n${RULES_ADMIN_NOTICE}\n\n- ブランチを切らない。\n`

test("RL1: RULES_FILES は 3 つの固定名を持つ", () => {
  expect([...RULES_FILES]).toStrictEqual([
    "conventions",
    "protected-paths",
    "testing-policy"
  ])
})

test("RL2: rulesFilePath は rulesDirPath 配下の <name>.md を返す", () => {
  const config = loadConfig(mkProject())
  expect(rulesFilePath(config, "conventions")).toBe(
    path.join(config.rulesDirPath, "conventions.md")
  )
})

test("RL3: 未作成のファイルは exists: false・text: null で返る(例外を投げない)", () => {
  const state = readRulesFile(loadConfig(mkProject()), "testing-policy")
  expect(state.exists).toBe(false)
  expect(state.text).toBeNull()
  expect(state.relative).toBe(".claude/rules/metatron/testing-policy.md")
})

test("RL4: 正当な body は ok: true。未作成なら mode: created", () => {
  const result = prepareRulesUpdate(null, {
    name: "conventions",
    body: OK_BODY
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.mode).toBe("created")
  expect(result.text.endsWith("\n")).toBe(true)
  expect(result.warnings).toStrictEqual([])
})

test("RL5: 未知の name は unknown_rules_name で拒否し、3 つの名前を案内する", () => {
  const result = prepareRulesUpdate(null, { name: "workflow", body: OK_BODY })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("unknown_rules_name")
  for (const name of RULES_FILES) expect(result.message).toContain(name)
})

test("RL6: frontmatter で始まる body は frontmatter_not_allowed で拒否する", () => {
  const body = `---\npaths:\n  - "src/**"\n---\n\n# 規約\n`
  const result = prepareRulesUpdate(null, { name: "conventions", body })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("frontmatter_not_allowed")
})

test("RL7: 1 行目が # 見出しでない body は invalid_input で拒否する", () => {
  const result = prepareRulesUpdate(null, {
    name: "conventions",
    body: "本文だけ\n"
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("invalid_input")
})

test("RL8: 管理者表示行が無い body は missing_admin_notice で拒否する", () => {
  const result = prepareRulesUpdate(null, {
    name: "conventions",
    body: "# 規約\n\n本文\n"
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("missing_admin_notice")
})

test("RL9: 200 行を超える body は拒否せず warnings を返す", () => {
  const body = `# 規約\n\n${RULES_ADMIN_NOTICE}\n${"- 項目\n".repeat(250)}`
  const result = prepareRulesUpdate(null, { name: "conventions", body })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.warnings.length).toBeGreaterThan(0)
})

test("RL10: isRulesName は値域外を弾く", () => {
  expect(isRulesName("conventions")).toBe(true)
  expect(isRulesName("Conventions")).toBe(false)
  expect(isRulesName(null)).toBe(false)
})

test("RL11: 既存ファイルがあるときは mode: replaced", () => {
  const result = prepareRulesUpdate("# 規約\n\n古い本文\n", {
    name: "conventions",
    body: OK_BODY
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.mode).toBe("replaced")
})
