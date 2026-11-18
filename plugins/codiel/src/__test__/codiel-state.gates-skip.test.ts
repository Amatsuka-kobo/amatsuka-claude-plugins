import { expect, test } from "vitest"
import {
  init,
  passGate,
  passThrough,
  recordEvaluation,
  run,
  tmpProject,
  UNTIL_PR,
  UNTIL_REVIEW
} from "./helpers/codiel-state-fixtures.js"

test("test-code が passed でないと start-phase implement が失敗し、pass-gate test-code の後に開始できる", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  const pending = run(root, ["start-phase", "implement", "--slug", "demo"])
  expect(pending.code).toBe(1)
  expect(pending.err).toMatch(/前フェーズが未完了です: test-code\(pending\)/)
  expect(run(root, ["start-phase", "test-code", "--slug", "demo"]).code).toBe(0)
  const inProgress = run(root, ["start-phase", "implement", "--slug", "demo"])
  expect(inProgress.code).toBe(1)
  expect(inProgress.err).toMatch(/test-code\(in_progress\)/)
  const complete = run(root, ["complete-phase", "test-code", "--slug", "demo"])
  expect(complete.code).toBe(1)
  expect(complete.err).toMatch(/ゲート対象フェーズです/)
  expect(passGate(root, "test-code", "PROCEED").code).toBe(0)
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(0)
})

test("skip-phase test-code は軽量の run でも失敗し、test-code を pending のまま残す", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  passThrough(root, "demo", ["intent"])
  for (const ph of ["discuss", "design"])
    run(root, ["skip-phase", ph, "--slug", "demo", "--reason", "軽量"])
  passThrough(root, "demo", ["test-spec", "dev-plan"])
  const r = run(root, [
    "skip-phase",
    "test-code",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/test-code はスキップできません/)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.phases["test-code"].status).toBe("pending")
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(1)
})

test("intent-sync は pass-gate で通し、通るまで pr を開始できない", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, -1))
  const early = run(root, ["start-phase", "pr", "--slug", "demo"])
  expect(early.code).toBe(1)
  expect(early.err).toMatch(/intent-sync/)
  expect(run(root, ["start-phase", "intent-sync", "--slug", "demo"]).code).toBe(
    0
  )
  const complete = run(root, [
    "complete-phase",
    "intent-sync",
    "--slug",
    "demo"
  ])
  expect(complete.code).toBe(1)
  expect(complete.err).toMatch(/ゲート対象フェーズです/)
  recordEvaluation(root, "demo", "intent-sync", "PROCEED", "e1")
  const gate = run(root, [
    "pass-gate",
    "intent-sync",
    "--slug",
    "demo",
    "--evaluation-id",
    "e1",
    "--verdict",
    "PROCEED"
  ])
  expect(gate.code).toBe(0)
  expect(run(root, ["start-phase", "pr", "--slug", "demo"]).code).toBe(0)
})

test("start-phase は前ステージ未passedなら失敗する", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["start-phase", "design", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/intent/)
})

test("GATEDフェーズは pass-gate(PROCEED)でのみ passed になる", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  let r = passGate(root, "intent", "ASK")
  expect(r.code).toBe(1)
  r = run(root, ["complete-phase", "intent", "--slug", "demo"])
  expect(r.code).toBe(1) // GATED に complete-phase は使えない
  r = passGate(root, "intent", "PROCEED")
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.status).toBe("passed")
  expect(r.out.state.phases.intent.evaluationId).toBe("ev1")
})

test("pass-gate は --human-approved 指定時に ASK を受理し humanApproved を記録する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const r = passGate(root, "intent", "ASK", ["--human-approved"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.status).toBe("passed")
  expect(r.out.state.phases.intent.verdict).toBe("ASK")
  expect(r.out.state.phases.intent.humanApproved).toBe(true)
})

test("--human-approved で passed になったフェーズの次フェーズを start-phase できる", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  passGate(root, "intent", "ASK", ["--human-approved"])
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
})

test("並列ステージ(test-spec/dev-plan)は design passed 後に両方 start できる", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent", "discuss", "design"])
  expect(run(root, ["start-phase", "test-spec", "--slug", "demo"]).code).toBe(0)
  expect(run(root, ["start-phase", "dev-plan", "--slug", "demo"]).code).toBe(0)
  // 片方だけ passed では implement に進めない
  passGate(root, "test-spec", "PROCEED")
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(1)
})

test("discuss は intent passed 後に start でき、complete-phase で passed になる(pass-gate は拒否)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
  const rGate = passGate(root, "discuss", "PROCEED")
  expect(rGate.code).toBe(1)
  expect(rGate.err).toMatch(/ゲート対象フェーズではありません/)
  const r = run(root, ["complete-phase", "discuss", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.discuss.status).toBe("passed")
})

test("design は discuss が passed になるまで start できない", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  const r = run(root, ["start-phase", "design", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/discuss/)
})

test("不正なフェーズ名は complete-phase・mark-ask・record-attempt・skip-phase・start-phase で拒否される", () => {
  const root = tmpProject()
  init(root)
  for (const args of [
    ["complete-phase", "bogus"],
    ["mark-ask", "bogus", "--evaluation-id", "e"],
    ["record-attempt", "bogus"],
    ["skip-phase", "bogus", "--reason", "理由"],
    ["start-phase", "init"]
  ]) {
    const r = run(root, [...args, "--slug", "demo"])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/不正なフェーズ/)
  }
})

// --- 軽量の経路 ---

test("軽量の run は discuss と design を skip でき、続けて test-spec と dev-plan を開始できる", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  passThrough(root, "demo", ["intent"])
  for (const ph of ["discuss", "design"]) {
    const r = run(root, [
      "skip-phase",
      ph,
      "--slug",
      "demo",
      "--reason",
      "軽量"
    ])
    expect(r.code).toBe(0)
    expect(r.out.state.phases[ph].status).toBe("passed")
    expect(r.out.state.phases[ph].verdict).toBe("SKIPPED")
    expect(r.out.state.phases[ph].note).toBe("軽量")
  }
  expect(run(root, ["start-phase", "test-spec", "--slug", "demo"]).code).toBe(0)
  expect(run(root, ["start-phase", "dev-plan", "--slug", "demo"]).code).toBe(0)
})

test("標準の run では discuss と design の skip が失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  const discuss = run(root, [
    "skip-phase",
    "discuss",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(discuss.code).toBe(1)
  expect(discuss.err).toMatch(/scale が light の run だけ/)
  passThrough(root, "demo", ["discuss"])
  const design = run(root, [
    "skip-phase",
    "design",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(design.code).toBe(1)
  expect(design.err).toMatch(/scale が light の run だけ/)
  expect(
    run(root, ["get", "--slug", "demo"]).out.state.phases.design.status
  ).toBe("pending")
})

test("skip-phase fix-loop は review まで passed なら passed/verdict SKIPPED にでき、続けて triage を start できる", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_REVIEW)
  const r = run(root, [
    "skip-phase",
    "fix-loop",
    "--slug",
    "demo",
    "--reason",
    "critical/high ゼロ"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases["fix-loop"].status).toBe("passed")
  expect(r.out.state.phases["fix-loop"].verdict).toBe("SKIPPED")
  expect(r.out.state.phases["fix-loop"].note).toBe("critical/high ゼロ")
  expect(run(root, ["start-phase", "triage", "--slug", "demo"]).code).toBe(0)
})

test("skip-phase は SKIPPABLE 以外のフェーズと --reason の省略で失敗する", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  const notSkippable = run(root, [
    "skip-phase",
    "implement",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(notSkippable.code).toBe(1)
  expect(notSkippable.err).toMatch(/スキップできません/)
  passThrough(root, "demo", ["intent"])
  const noReason = run(root, ["skip-phase", "discuss", "--slug", "demo"])
  expect(noReason.code).toBe(1)
  expect(noReason.err).toMatch(/--reason が必要です/)
})

test("skip-phase fix-loop は review が passed でない状態では失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", [...UNTIL_PR, "pr"])
  run(root, ["start-phase", "review", "--slug", "demo"]) // review は in_progress のまま
  const r = run(root, [
    "skip-phase",
    "fix-loop",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
})

// --- 文書だけで終える run ---
