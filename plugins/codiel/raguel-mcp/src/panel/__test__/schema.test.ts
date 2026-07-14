import { describe, expect, it } from "vitest"
import {
  rawFindingSchema,
  standardPanelResponseSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

describe("rawFindingSchema", () => {
  it("severity: stop は拒否する(不変条件 9: STOP はルール層専権)", () => {
    const result = rawFindingSchema.safeParse({
      severity: "stop",
      confidence: 90,
      message: "危険"
    })
    expect(result.success).toBe(false)
  })

  it("info / ask は許可する", () => {
    for (const severity of ["info", "ask"]) {
      const result = rawFindingSchema.safeParse({
        severity,
        confidence: 50,
        message: "所見"
      })
      expect(result.success).toBe(true)
    }
  })
})

describe("standardPanelResponseSchema", () => {
  it("軸キー通りの scores を要求する", () => {
    const schema = standardPanelResponseSchema(["objective_alignment", "risk"])
    const ok = schema.safeParse({
      findings: [],
      scores: { objective_alignment: 80, risk: 60 }
    })
    expect(ok.success).toBe(true)

    const missing = schema.safeParse({
      findings: [],
      scores: { objective_alignment: 80 }
    })
    expect(missing.success).toBe(false)
  })
})

describe("toFindings", () => {
  it("ruleId を panel/<name> に強制上書きする", () => {
    const findings = toFindings(
      [
        {
          severity: "ask",
          confidence: 70,
          message: "テスト所見",
          evidence: { location: "foo.ts:1" }
        }
      ],
      "adversarial"
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe("panel/adversarial")
    expect(findings[0].message).toBe("テスト所見")
    expect(findings[0].evidence?.location).toBe("foo.ts:1")
  })
})

describe("toJsonSchema", () => {
  it("zod スキーマから JSON Schema オブジェクトを生成する", () => {
    const schema = standardPanelResponseSchema(["objective_alignment"])
    const jsonSchema = toJsonSchema(schema) as Record<string, unknown>
    expect(jsonSchema.type).toBe("object")
    expect(jsonSchema.properties).toBeDefined()
  })
})
