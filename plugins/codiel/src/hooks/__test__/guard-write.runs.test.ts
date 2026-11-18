import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  addWorktree,
  advanceRunTo,
  advanceToImplement,
  decision,
  element,
  hook,
  patchState,
  RECORDED,
  setupGitRun,
  setupRun,
  worktreeRel,
  writeArchitecture,
  writeConfig
} from "./helpers/guard-write-fixtures.js"

// ---------------------------------------------------------------------------
// E2E のレポートと runsDir(設計書 §6.17.6、§8.2 の R 系)。slug は demo、testsDir と runsDir は
// ケースに書いたものを除いて既定の docs/codiel/tests と docs/codiel/runs とする。
// mapped のケースでは、ドメイン x の範囲を src/x/** とする。
// ---------------------------------------------------------------------------

const REPORT_DIR =
  "docs/codiel/tests/e2e/frontend/login/reports/20261001-121500-demo-try1"
const RUN_DOC = (name: string) => `docs/codiel/runs/demo/${name}`

// phase を in_progress にし、mapped でドメイン x を当てた run を作る。
function setupMappedRun(phase: string): string {
  const root = setupRun()
  advanceRunTo(root, phase)
  writeArchitecture(root, { x: ["src/x/**"] })
  patchState(root, (s) => {
    s.domainMode = "mapped"
    s.domain = "x"
  })
  return root
}

test("R-1: implement・mapped・domain x で、E2E のレポートはドメイン境界の外でも通す", () => {
  const root = setupMappedRun("implement")
  expect(decision(root, `${REPORT_DIR}/summary.md`)).toBe(null)
  expect(decision(root, `${REPORT_DIR}/results.json`)).toBe(null)
  // 免除が効きすぎていないこと: reports/ の外の範囲外のパスは従来どおり ask
  const r = hook(root, "Write", path.join(root, "src/y/a.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("担当範囲外")
})

test("R-2: implement・mapped・domain x で、仕様のディレクトリの cases.md はテストの保護が免除より先に効く", () => {
  const root = setupMappedRun("implement")
  const cases = "docs/codiel/tests/e2e/frontend/login/cases.md"
  const r = hook(root, "Write", path.join(root, cases))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain(`テスト(${cases})`)
})

test("R-3: test-loop・domain なしで、E2E のレポートの failure.md はテストの保護の対象外で通す", () => {
  const root = setupRun()
  advanceRunTo(root, "test-loop")
  expect(decision(root, `${REPORT_DIR}/failure.md`)).toBe(null)
})

test("R-4: design で runsDir が notes/runs なら、docs/ の外の <runsDir>/ を通す", () => {
  const root = setupRun()
  advanceRunTo(root, "design")
  writeConfig(root, JSON.stringify({ runsDir: "notes/runs" }))
  expect(decision(root, "notes/runs/demo/design.md")).toBe(null)
  // runsDir の外のコード領域は従来どおり ask
  expect(decision(root, "notes/other.md")).toBe("ask")
})

test("R-5: implement・mapped・domain x で、<runsDir>/ への書き込みは ask になり、理由は run の文書", () => {
  const root = setupMappedRun("implement")
  const r = hook(root, "Write", path.join(root, RUN_DOC("dev-plan.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `run の文書(${RUN_DOC("dev-plan.md")})は文書フェーズで書きます(implement 中の変更は想定外)`
  )
})

test("R-6: review で <runsDir>/ への書き込みは、現行の pr・review・triage・finalize の分岐で ask", () => {
  const root = setupRun()
  advanceRunTo(root, "review")
  const r = hook(root, "Write", path.join(root, RUN_DOC("design.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `フェーズ review 中の ${RUN_DOC("design.md")} への書き込みは想定外です`
  )
})

test("R-7: design で config.json の runsDir が /abs なら、<runsDir>/ の規則だけを外す", () => {
  const root = setupRun()
  advanceRunTo(root, "design")
  writeConfig(root, JSON.stringify({ runsDir: "/abs" }))
  expect(decision(root, "notes/runs/demo/design.md")).toBe("ask")
  // docs/ と .codiel/ を通す規則は残る
  expect(decision(root, RUN_DOC("design.md"))).toBe(null)
})

test("R-8: implement・unscoped(domain なし)でも、<runsDir>/ への書き込みは ask", () => {
  const root = setupRun()
  advanceToImplement(root)
  const r = hook(root, "Write", path.join(root, RUN_DOC("dev-plan.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("文書フェーズで書きます")
})

test("R-9: test-code の worktree の中の <runsDir>/ への書き込みは、worktreeRoot 相対で ask", () => {
  const main = setupGitRun("test-code")
  const wt = addWorktree(main, "test-code-1")
  patchState(main, (s) => {
    s.testCode = {
      units: {
        "units/src/server/db.ts": element(worktreeRel("test-code-1"), null)
      }
    }
  })
  const r = hook(wt, "Write", path.join(wt, RUN_DOC("design.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `run の文書(${RUN_DOC("design.md")})は文書フェーズで書きます(test-code 中の変更は想定外)`
  )
  // 同じ worktree のテストファイルは W-6 のとおり通す
  expect(hook(wt, "Write", path.join(wt, "src/__test__/b.test.ts"))).toBe(null)
})

test("R-10: fix-loop・domain なしで runsDir が notes/runs なら、docs/ の外の <runsDir>/ も ask", () => {
  const root = setupRun()
  advanceRunTo(root, "fix-loop")
  writeConfig(root, JSON.stringify({ runsDir: "notes/runs" }))
  expect(decision(root, "notes/runs/demo/dev-plan.md")).toBe("ask")
})

test("R-11: implement で runsDir が testsDir の親でも、E2E のレポートは <runsDir>/ の規則の対象外で通す", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeConfig(root, JSON.stringify({ runsDir: "docs/codiel" }))
  expect(decision(root, `${REPORT_DIR}/summary.md`)).toBe(null)
  // reports/ の外の runsDir の配下は ask
  expect(decision(root, "docs/codiel/demo/dev-plan.md")).toBe("ask")
})

test("R-12: test-code で config.json が JSON として読めなければ、テストファイルへの書き込みも ask", () => {
  const root = setupRun()
  advanceRunTo(root, "test-code")
  writeConfig(root, "{ runsDir: ")
  const r = hook(root, "Write", path.join(root, RECORDED))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(
    /^\.codiel\/config\.json が不正なため、test-code 中の書き込みが run の文書\(runsDir\)に当たるか判定できません/
  )
})

test("R-13: unrecorded-gotchas.md への書き込みは免除されず、ほかの run の文書と同じ判定になる", () => {
  const root = setupMappedRun("fix-loop")
  expect(decision(root, RUN_DOC("unrecorded-gotchas.md"))).toBe("ask")
  expect(decision(root, RUN_DOC("unrecorded-gotchas.md"))).toBe(
    decision(root, RUN_DOC("dev-plan.md"))
  )
  for (const phase of ["review", "triage", "finalize", "implement"]) {
    const r = setupRun()
    advanceRunTo(r, phase)
    expect(decision(r, RUN_DOC("unrecorded-gotchas.md")), phase).toBe("ask")
  }
  const r = setupRun()
  advanceRunTo(r, "finalize")
  writeConfig(r, JSON.stringify({ runsDir: "notes/runs" }))
  expect(decision(r, "notes/runs/demo/unrecorded-gotchas.md")).toBe("ask")
})

// --- Raguel の設定と記録の保護(Raguel 設計書 §6.13.4。所見 G8・R12) ---

// RAGUEL_CONFIG で Raguel の設定を <root>/raguel.json に置き、casesDir を <root>/cases-store にする。
// 守る 3 種のパス(root 相対)と、フックに渡す環境変数を返す。
function raguelEnv(root: string): {
  env: Record<string, string>
  targets: string[]
} {
  const file = path.join(root, "raguel.json")
  fs.writeFileSync(
    file,
    JSON.stringify({
      storage: { casesDir: path.join(root, "cases-store"), projectId: "demo" }
    })
  )
  return {
    env: { RAGUEL_CONFIG: file },
    targets: [
      ".codiel/config.json",
      "raguel.json",
      "cases-store/cases/demo/evaluations.jsonl"
    ]
  }
}

test("R12: active と awaiting_human の run で、3 種のパスへの Write と Edit は deny になる", () => {
  for (const status of ["active", "awaiting_human"] as const) {
    const root = setupRun()
    advanceRunTo(root, "implement")
    patchState(root, (s) => {
      s.status = status
    })
    const { env, targets } = raguelEnv(root)
    for (const rel of targets)
      for (const tool of ["Write", "Edit"]) {
        const r = hook(root, tool, path.join(root, rel), env)
        expect(r?.permissionDecision, `${status} ${tool} ${rel}`).toBe("deny")
        expect(r?.permissionDecisionReason).toMatch(/Raguel の設定と記録/)
      }
  }
})

test("R12: run が無ければ、3 種のパスへの Write と Edit は通す", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const { env, targets } = raguelEnv(root)
  for (const rel of targets)
    for (const tool of ["Write", "Edit"])
      expect(hook(root, tool, path.join(root, rel), env), rel).toBe(null)
})

test("G8: 文書フェーズで .codiel/ 配下を通す規則より先に、config.json を deny する(設定を緩める案を止める)", () => {
  const root = setupRun()
  const r = hook(root, "Write", path.join(root, ".codiel/config.json"))
  expect(r?.permissionDecision).toBe("deny")
  // 同じ .codiel/ 配下のほかのファイルは従来どおり通す
  expect(decision(root, ".codiel/runs/demo/try-1/issue.md")).toBe(null)
})

test("RAGUEL_CONFIG が無ければ、.codiel/config.json の raguel.storage.casesDir の配下を守る", () => {
  const root = setupRun()
  const store = path.join(root, "store")
  writeConfig(
    root,
    JSON.stringify({ raguel: { storage: { casesDir: store, projectId: "p" } } })
  )
  const noEnv = { RAGUEL_CONFIG: "" }
  const r = hook(
    root,
    "Edit",
    path.join(store, "cases/p/outcomes.jsonl"),
    noEnv
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(
    hook(root, "Write", path.join(root, "store-other/a.txt"), noEnv)
      ?.permissionDecision
  ).toBe("ask")
})

test("codiel の worktree の中の .codiel/config.json の写しも deny し、config.json が不正でも deny は変わらない", () => {
  const root = setupRun()
  writeConfig(root, "{ runsDir: ")
  expect(decision(root, ".codiel/config.json")).toBe("deny")
  expect(decision(root, ".codiel/worktrees/demo/s1/.codiel/config.json")).toBe(
    "deny"
  )
})

test("casesDir と同じ接頭辞を持つ別のディレクトリは守る対象にしない", () => {
  const root = setupRun()
  const { env } = raguelEnv(root)
  const r = hook(
    root,
    "Write",
    path.join(root, ".codiel/runs/demo/try-1/cases-store.md"),
    env
  )
  expect(r).toBe(null)
  const other = hook(root, "Write", path.join(root, "cases-store2/x"), env)
  expect(other?.permissionDecision).toBe("ask")
})
