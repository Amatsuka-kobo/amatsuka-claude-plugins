import { describe, expect, it } from "vitest"
import { z } from "zod"
import { SEED_PRECEDENTS } from "../index"

// core/types.ts の Precedent と対応する検証用スキーマ(このテスト専用)
const precedentSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["seed", "project"]),
  kind: z.enum(["decision", "plan", "design", "code"]),
  outcome: z.enum(["approved", "rejected", "incident"]),
  summary: z.string().min(1),
  objective: z.string().min(1).optional(),
  firedRules: z.array(z.string()),
  changedPaths: z.array(z.string()),
  lesson: z.string().min(1),
  recordedAt: z.string().optional(),
  configHash: z.string().optional()
})

describe("SEED_PRECEDENTS", () => {
  it("8〜10 件のシード判例を同梱している", () => {
    expect(SEED_PRECEDENTS.length).toBeGreaterThanOrEqual(8)
    expect(SEED_PRECEDENTS.length).toBeLessThanOrEqual(10)
  })

  it("すべての判例が必須フィールドを満たす(zod 妥当性)", () => {
    for (const precedent of SEED_PRECEDENTS) {
      expect(() => precedentSchema.parse(precedent)).not.toThrow()
    }
  })

  it("すべて source: seed で outcome が incident か rejected", () => {
    for (const precedent of SEED_PRECEDENTS) {
      expect(precedent.source).toBe("seed")
      expect(["incident", "rejected"]).toContain(precedent.outcome)
    }
  })

  it("id が重複しない", () => {
    const ids = SEED_PRECEDENTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("id は seed-NNN 形式", () => {
    for (const precedent of SEED_PRECEDENTS) {
      expect(precedent.id).toMatch(/^seed-\d{3}$/)
    }
  })
})
