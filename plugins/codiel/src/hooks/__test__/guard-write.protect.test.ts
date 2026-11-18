import path from "node:path"
import { expect, test } from "vitest"
import {
  advanceRunTo,
  CASES,
  decision,
  hook,
  patchState,
  RECORDED,
  SPEC_DIR,
  setupRun,
  writeConfig,
  writeSpec
} from "./helpers/guard-write-fixtures.js"

// ---------------------------------------------------------------------------
// テストの保護(設計書 §6.13.6、§8.2 の P 系)。testsDir は既定の docs/codiel/tests とし、
// docs/codiel/tests/units/src/a.ts/spec.md の tests に src/__test__/a.test.ts を記録しておく。
// ---------------------------------------------------------------------------

// phase を in_progress にし、tests を記録した spec.md を置いた run を作る。
function setupProtectedRun(phase: string): string {
  const root = setupRun()
  advanceRunTo(root, phase)
  writeSpec(root, SPEC_DIR, `parallel: true\ntests:\n  - ${RECORDED}`)
  return root
}

test("P-1: implement で testsDir の cases.md は ask になり、理由はテストの保護", () => {
  const root = setupProtectedRun("implement")
  const r = hook(root, "Edit", path.join(root, CASES))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `テスト(${CASES})の変更は test-spec と test-code フェーズの担当です(implement 中の変更は改竄の疑い)`
  )
})

test("P-2: test-loop で spec.md の tests に載ったファイルは ask", () => {
  const root = setupProtectedRun("test-loop")
  expect(decision(root, RECORDED)).toBe("ask")
  // 1 行の列で書いた tests と、別の仕様のディレクトリの記録も読む
  writeSpec(
    root,
    "docs/codiel/tests/e2e/cli/tool",
    `tests: ["test/e2e/tool.test.ts"]\nparallel: false`
  )
  expect(decision(root, "test/e2e/tool.test.ts")).toBe("ask")
})

test("P-3: implement で どの tests にも載っていないテストファイルは通す", () => {
  const root = setupProtectedRun("implement")
  expect(decision(root, "src/__test__/b.test.ts")).toBe(null)
})

test("P-4: test-code では cases.md も記録されたテストも通す", () => {
  const root = setupProtectedRun("test-code")
  expect(decision(root, CASES)).toBe(null)
  expect(decision(root, RECORDED)).toBe(null)
})

test("P-4b: carry-over ではコードへの書き込みを通し、cases.md と記録されたテストはテストの保護に当てない", () => {
  const root = setupProtectedRun("carry-over")
  expect(decision(root, "src/a.ts")).toBe(null)
  expect(decision(root, CASES)).toBe(null)
  expect(decision(root, RECORDED)).toBe(null)
})

test("P-5: fix-loop で testEdit が無ければ cases.md は ask", () => {
  const root = setupProtectedRun("fix-loop")
  expect(decision(root, CASES)).toBe("ask")
})

test("P-6: fix-loop で testEdit が真の間は cases.md も記録されたテストも通す", () => {
  const root = setupProtectedRun("fix-loop")
  patchState(root, (s) => {
    s.testEdit = true
  })
  expect(decision(root, CASES)).toBe(null)
  expect(decision(root, RECORDED)).toBe(null)
})

test("P-7: implement では testEdit が真でも cases.md は ask(fix-loop 以外では testEdit を見ない)", () => {
  const root = setupProtectedRun("implement")
  patchState(root, (s) => {
    s.testEdit = true
  })
  expect(decision(root, CASES)).toBe("ask")
})

test("P-8: implement で testsDir が qa/specs なら qa/specs の spec.md は ask、docs/codiel/tests の spec.md は通す", () => {
  const root = setupProtectedRun("implement")
  writeConfig(root, JSON.stringify({ testsDir: "qa/specs" }))
  expect(decision(root, "qa/specs/units/x.ts/spec.md")).toBe("ask")
  expect(decision(root, "docs/codiel/tests/units/x.ts/spec.md")).toBe(null)
})

test("P-9: test-spec で testsDir が qa/specs なら、docs/ の外でも qa/specs の spec.md を通す", () => {
  const root = setupRun()
  advanceRunTo(root, "test-spec")
  writeConfig(root, JSON.stringify({ testsDir: "qa/specs" }))
  expect(decision(root, "qa/specs/units/x.ts/spec.md")).toBe(null)
  // testsDir の外のコード領域は従来どおり ask
  expect(decision(root, "qa/tools/x.ts")).toBe("ask")
})

test("P-10: implement で .codiel/config.json が JSON として読めなければ src への書き込みも ask", () => {
  const root = setupProtectedRun("implement")
  writeConfig(root, "{ testsDir: ")
  const r = hook(root, "Write", path.join(root, "src/index.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/config\.json が不正/)
})

test("設定が不正でも、文書フェーズでは testsDir を通す規則だけを外し、docs/ は通す", () => {
  const root = setupRun()
  advanceRunTo(root, "test-spec")
  writeConfig(root, JSON.stringify({ testsDir: "/abs/specs" }))
  expect(decision(root, "docs/codiel/tests/units/x.ts/spec.md")).toBe(null)
  expect(decision(root, "src/index.ts")).toBe("ask")
})
