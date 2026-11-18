import fs from "node:fs"
import { expect, test } from "vitest"
import { findActiveRun, GATED, SKIPPABLE, STAGES } from "../codiel-state.js"
import {
  commitFiles,
  git,
  init,
  latestState,
  passGate,
  passThrough,
  recordEvaluation,
  run,
  statePath,
  tmpProject,
  UNTIL_PR
} from "./helpers/codiel-state-fixtures.js"

test("STAGES は 14 ステージで、carry-over が intent の直後、intent-sync が test-loop と pr の間のゲート対象フェーズである", () => {
  expect(STAGES).toStrictEqual([
    ["intent"],
    ["carry-over"],
    ["discuss"],
    ["design"],
    ["test-spec", "dev-plan"],
    ["test-code"],
    ["implement"],
    ["test-loop"],
    ["intent-sync"],
    ["pr"],
    ["review"],
    ["fix-loop"],
    ["triage"],
    ["finalize"]
  ])
  expect([...GATED].sort()).toStrictEqual([
    "carry-over",
    "design",
    "dev-plan",
    "fix-loop",
    "implement",
    "intent",
    "intent-sync",
    "test-code",
    "test-loop",
    "test-spec"
  ])
  expect([...SKIPPABLE].sort()).toStrictEqual(["design", "discuss", "fix-loop"])
})

// --- テスト駆動のフェーズ(設計書 §6.1.1・§6.13.2、A6-1) ---

test("STAGES の 6 番目が test-code で、GATED に含まれ SKIPPABLE に含まれない", () => {
  expect(STAGES[5]).toStrictEqual(["test-code"])
  expect(GATED.has("test-code")).toBe(true)
  expect(SKIPPABLE.has("test-code")).toBe(false)
})

// --- carry-over(前の try から引き継いだコードの評価) ---

test("try-1 の init は carry-over を SKIPPED で通し、skip-phase carry-over は拒否する", () => {
  const root = tmpProject()
  const r = init(root)
  expect(r.out.state.phases["carry-over"]).toMatchObject({
    status: "passed",
    verdict: "SKIPPED",
    note: "try-1"
  })
  expect(SKIPPABLE.has("carry-over")).toBe(false)
  passThrough(root, "demo", ["intent"])
  const skip = run(root, [
    "skip-phase",
    "carry-over",
    "--slug",
    "demo",
    "--reason",
    "x"
  ])
  expect(skip.code).toBe(1)
  expect(skip.err).toMatch(/carry-over はスキップできません/)
})

test("try-1 の init は codiel/<slug> が既にあれば失敗し、state を書かない", () => {
  const root = tmpProject()
  git(root, "branch", "codiel/demo")
  const r = init(root)
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/codiel\/demo が既にあります/)
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
})

test("try-2 以降の init は codiel/<slug> があっても通る", () => {
  const root = tmpProject()
  init(root)
  git(root, "branch", "codiel/demo")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  const r = init(root)
  expect(r.code).toBe(0)
  expect(r.out.state.try).toBe(2)
})

test("try-2 の init は前の try の baseBranch を引き継ぎ、違う --base-branch で失敗する", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--base-branch", "main"])
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  const other = init(root, "demo", {}, ["--base-branch", "develop"])
  expect(other.code).toBe(1)
  expect(other.err).toMatch(/前の try のベースブランチ\(main\)と違います/)
  const r = init(root)
  expect(r.code).toBe(0)
  expect(r.out.state.try).toBe(2)
  expect(r.out.state.baseBranch).toBe("main")
  expect(r.out.state.phases["carry-over"].status).toBe("pending")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(init(root, "demo", {}, ["--base-branch", "main"]).code).toBe(0)
})

test("try-2 の start-phase carry-over は分岐点を startHead に記録し、intent の後のコミットがあっても開始でき、pass-gate が通る", () => {
  const root = tmpProject()
  const base = git(root, "rev-parse", "--abbrev-ref", "HEAD")
  const fork = git(root, "rev-parse", "HEAD")
  init(root, "demo", {}, ["--base-branch", base])
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  init(root)
  git(root, "switch", "-q", "-c", "codiel/demo")
  commitFiles(root, ["src/a.ts"], "前の try のコード")
  passThrough(root, "demo", ["intent"])
  commitFiles(root, ["docs/intents/2026-09-27-demo.md"], "intent")
  const r = run(root, ["start-phase", "carry-over", "--slug", "demo"])
  expect(r.err).toBe("")
  expect(r.out.state.phases["carry-over"].startHead).toBe(fork)
  expect(passGate(root, "carry-over", "PROCEED").code).toBe(0)
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
})

test("baseBranch の無い run と分岐点を読めない run では start-phase carry-over が失敗する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  init(root)
  passThrough(root, "demo", ["intent"])
  const noBase = run(root, ["start-phase", "carry-over", "--slug", "demo"])
  expect(noBase.code).toBe(1)
  expect(noBase.err).toMatch(/baseBranch がありません/)

  const root2 = tmpProject()
  init(root2, "demo", {}, ["--base-branch", "no-such-branch"])
  run(root2, ["stop", "--slug", "demo", "--reason", "test"])
  init(root2)
  passThrough(root2, "demo", ["intent"])
  const noFork = run(root2, ["start-phase", "carry-over", "--slug", "demo"])
  expect(noFork.code).toBe(1)
  expect(noFork.err).toMatch(/git merge-base no-such-branch HEAD が失敗した/)
})

// phase を開始し、評価 stopId の STOP を mark-ask で記録してから resume する
function stopAndResume(root: string, phase: string, stopId: string): void {
  recordEvaluation(root, "demo", phase, "STOP", stopId)
  const marked = run(root, [
    "mark-ask",
    phase,
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    stopId
  ])
  expect(marked.code).toBe(0)
  expect(run(root, ["resume", "--slug", "demo"]).code).toBe(0)
}

// try-2 の carry-over を in_progress にした run を作る
function carryOverRun(): string {
  const root = tmpProject()
  const base = git(root, "rev-parse", "--abbrev-ref", "HEAD")
  init(root, "demo", {}, ["--base-branch", base])
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  init(root)
  git(root, "switch", "-q", "-c", "codiel/demo")
  commitFiles(root, ["src/a.ts"], "前の try のコード")
  passThrough(root, "demo", ["intent"])
  expect(run(root, ["start-phase", "carry-over", "--slug", "demo"]).code).toBe(
    0
  )
  return root
}

const gateWith = (root: string, phase: string, id: string) =>
  run(root, [
    "pass-gate",
    phase,
    "--slug",
    "demo",
    "--evaluation-id",
    id,
    "--verdict",
    "PROCEED"
  ])

test("carry-over は STOP の後に直して評価し直した PROCEED で pass-gate を通し、STOP の evaluationId を note に残す", () => {
  const root = carryOverRun()
  stopAndResume(root, "carry-over", "ev-stop")
  commitFiles(root, ["src/fix.ts"], "所見を直す")
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-fixed")
  const r = gateWith(root, "carry-over", "ev-fixed")
  expect(r.err).toBe("")
  const ph = r.out.state.phases["carry-over"]
  expect(ph).toMatchObject({
    status: "passed",
    verdict: "PROCEED",
    evaluationId: "ev-fixed",
    note: "STOP(evaluationId: ev-stop)の後の再提出で通した"
  })
  expect(ph.humanApproved).toBeUndefined()
})

test("carry-over の STOP の後でも、同じ evaluationId・STOP より前の評価・最新でない評価では pass-gate が失敗する", () => {
  const root = carryOverRun()
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-before")
  stopAndResume(root, "carry-over", "ev-stop")
  const same = gateWith(root, "carry-over", "ev-stop")
  expect(same.code).toBe(1)
  expect(same.err).toMatch(/Raguel の STOP が記録されています/)
  const before = gateWith(root, "carry-over", "ev-before")
  expect(before.code).toBe(1)
  expect(before.err).toMatch(
    /ev-before は carry-over の最新の評価ではありません/
  )
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-fixed")
  recordEvaluation(root, "demo", "carry-over", "ASK", "ev-later")
  const stale = gateWith(root, "carry-over", "ev-fixed")
  expect(stale.code).toBe(1)
  expect(stale.err).toMatch(/ev-fixed は carry-over の最新の評価ではありません/)
  const st = latestState(root, "demo").phases["carry-over"]
  expect(st.status).toBe("in_progress")
  expect(st.verdict).toBe("STOP")
})

test("carry-over の STOP の後に HEAD が進んでいなければ、評価し直した PROCEED でも pass-gate が失敗する", () => {
  const root = carryOverRun()
  stopAndResume(root, "carry-over", "ev-stop")
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-same-head")
  const r = gateWith(root, "carry-over", "ev-same-head")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/後に HEAD が進んでいません/)
  const st = latestState(root, "demo").phases["carry-over"]
  expect(st.status).toBe("in_progress")
  expect(st.verdict).toBe("STOP")
})

// 内容を変えない amend、reset、別ブランチへの switch では「直した」と見なさない(C3-08)
for (const [label, move] of [
  [
    "内容を変えない amend",
    (root: string) => git(root, "commit", "-q", "--amend", "--no-edit")
  ],
  ["reset", (root: string) => git(root, "reset", "-q", "--hard", "HEAD~")],
  [
    "別ブランチへの switch",
    (root: string) => {
      git(root, "switch", "-q", "-c", "other", "HEAD~")
      commitFiles(root, ["src/other.ts"], "別ブランチのコミット")
    }
  ]
] as const)
  test(`carry-over の STOP の後に ${label} で HEAD を動かしても、評価し直した PROCEED で pass-gate が失敗する`, () => {
    const root = carryOverRun()
    stopAndResume(root, "carry-over", "ev-stop")
    move(root)
    recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-moved")
    const r = gateWith(root, "carry-over", "ev-moved")
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/後に HEAD が進んでいません/)
  })

test("complete-phase の note に再提出の文型を書いても、次の init は --human-approved を求める(C3-03)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-x")
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
  const done = run(root, [
    "complete-phase",
    "discuss",
    "--slug",
    "demo",
    "--note",
    "STOP(evaluationId: ev-x)の後の再提出で通した"
  ])
  expect(done.code).toBe(0)
  expect(run(root, ["stop", "--slug", "demo", "--reason", "test"]).code).toBe(0)
  const r = init(root)
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/Raguel の STOP/)
})

test("mark-ask を経ずに STOP を記録した後の PROCEED では、implement の pass-gate が失敗する(C3-04)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 6))
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(0)
  recordEvaluation(root, "demo", "implement", "STOP", "ev-stop")
  recordEvaluation(root, "demo", "implement", "PROCEED", "ev-fixed")
  const r = gateWith(root, "implement", "ev-fixed")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/Raguel の STOP が記録されています/)
})

test("再提出で通した carry-over の STOP は、その try を stop した後の init で --human-approved を求めない", () => {
  const root = carryOverRun()
  stopAndResume(root, "carry-over", "ev-stop")
  commitFiles(root, ["src/fix.ts"], "所見を直す")
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-fixed")
  expect(gateWith(root, "carry-over", "ev-fixed").err).toBe("")
  expect(run(root, ["stop", "--slug", "demo", "--reason", "test"]).code).toBe(0)
  const r = init(root)
  expect(r.err).not.toMatch(/Raguel の STOP/)
  expect(r.code).toBe(0)
})

test("carry-over の STOP が複数あるときは、最後の STOP の後に HEAD が進んだ PROCEED だけを通し、すべての STOP を note に残す", () => {
  const root = carryOverRun()
  stopAndResume(root, "carry-over", "ev1")
  commitFiles(root, ["src/fix1.ts"], "1 回目の所見を直す")
  stopAndResume(root, "carry-over", "ev2")
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-same-head")
  const same = gateWith(root, "carry-over", "ev-same-head")
  expect(same.code).toBe(1)
  expect(same.err).toMatch(/後に HEAD が進んでいません/)
  commitFiles(root, ["src/fix2.ts"], "2 回目の所見を直す")
  recordEvaluation(root, "demo", "carry-over", "PROCEED", "ev-fixed")
  const r = gateWith(root, "carry-over", "ev-fixed")
  expect(r.err).toBe("")
  expect(r.out.state.phases["carry-over"].note).toBe(
    "STOP(evaluationId: ev1, ev2)の後の再提出で通した"
  )
  expect(run(root, ["stop", "--slug", "demo", "--reason", "test"]).code).toBe(0)
  const next = init(root)
  expect(next.err).not.toMatch(/Raguel の STOP/)
  expect(next.code).toBe(0)
})

test("再提出で通していない STOP は、次の try の init が --human-approved を求める", () => {
  const root = carryOverRun()
  stopAndResume(root, "carry-over", "ev-stop")
  expect(run(root, ["stop", "--slug", "demo", "--reason", "test"]).code).toBe(0)
  const r = init(root)
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/Raguel の STOP/)
})

test("carry-over 以外のフェーズ(implement)では、STOP の後の新しい PROCEED でも pass-gate が失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 6))
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(0)
  stopAndResume(root, "implement", "ev-stop")
  recordEvaluation(root, "demo", "implement", "PROCEED", "ev-fixed")
  const r = gateWith(root, "implement", "ev-fixed")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/Raguel の STOP が記録されています/)
})

test("carry-over を持たない version 2 の state は、読み込み時に SKIPPED で補われる", () => {
  const root = tmpProject()
  init(root)
  const p = statePath(root, "demo")
  const saved = JSON.parse(fs.readFileSync(p, "utf8"))
  delete saved.phases["carry-over"]
  fs.writeFileSync(p, JSON.stringify(saved))
  const got = run(root, ["get", "--slug", "demo"])
  expect(Object.keys(got.out.state.phases).slice(0, 3)).toStrictEqual([
    "intent",
    "carry-over",
    "discuss"
  ])
  expect(got.out.state.phases["carry-over"]).toStrictEqual({
    status: "passed",
    attempts: 0,
    evaluationId: null,
    verdict: "SKIPPED",
    note: "carry-over の導入前の run"
  })
  expect(findActiveRun(root)?.state.phases["carry-over"]?.verdict).toBe(
    "SKIPPED"
  )
  passThrough(root, "demo", ["intent", "discuss"])
})
