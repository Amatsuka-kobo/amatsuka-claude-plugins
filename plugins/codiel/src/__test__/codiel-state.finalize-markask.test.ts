import fs from "node:fs"
import { expect, test } from "vitest"
import {
  fullRun,
  init,
  passThrough,
  recordEvaluation,
  run,
  statePath,
  tmpProject,
  UNTIL_FINALIZE
} from "./helpers/codiel-state-fixtures.js"

test("finalize は全フェーズ passed 後のみ成功し awaiting_outcome にする", () => {
  const root = tmpProject()
  init(root)
  expect(run(root, ["finalize", "--slug", "demo"]).code).toBe(1)
  passThrough(root, "demo", UNTIL_FINALIZE)
  const r = run(root, ["finalize", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_outcome")
  expect(r.out.state.phases.finalize.status).toBe("passed")
})

test("record-outcome approved は completed にする", () => {
  const root = tmpProject()
  init(root)
  expect(
    run(root, ["record-outcome", "--slug", "demo", "--outcome", "approved"])
      .code
  ).toBe(1)
  fullRun(root, "demo")
  const r = run(root, [
    "record-outcome",
    "--slug",
    "demo",
    "--outcome",
    "approved"
  ])
  expect(r.out.state.status).toBe("completed")
})

test("record-attempt は上限を持たず、6 回目以降も回数だけを増やす", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  for (let i = 0; i < 7; i++) {
    const r = run(root, ["record-attempt", "intent", "--slug", "demo"])
    expect(r.code).toBe(0)
    expect(Object.keys(r.out).sort()).toEqual(["state", "statePath"])
  }
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.intent.attempts).toBe(7)
})

test("init が書く state に limits は無い", () => {
  const root = tmpProject()
  init(root)
  const st = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
  expect("limits" in st).toBe(false)
})

test("1.0.x の state に limits が残っていても、record-attempt は上限で止めない", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const p = statePath(root, "demo")
  const st = JSON.parse(fs.readFileSync(p, "utf8"))
  st.limits = { maxFixAttempts: 5 }
  fs.writeFileSync(p, JSON.stringify(st, null, 2))
  for (let i = 0; i < 6; i++)
    expect(run(root, ["record-attempt", "intent", "--slug", "demo"]).code).toBe(
      0
    )
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
})

test("record-attempt は stop の後の終端の run を拒否し、run は stopped のまま残る(C3-10)", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  expect(run(root, ["stop", "--slug", "demo", "--reason", "test"]).code).toBe(0)
  for (let i = 0; i < 7; i++) {
    const r = run(root, ["record-attempt", "intent", "--slug", "demo"])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/終端状態/)
  }
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("stopped")
  expect(st.phases.intent.attempts).toBe(0)
})

// --- mark-ask --kind ---

test("mark-ask は --kind を省くと askKind を raguel にし、resume の後も残す", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "ASK", "e1")
  let r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--evaluation-id",
    "e1"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.askKind).toBe("raguel")
  r = run(root, ["resume", "--slug", "demo"])
  expect(r.out.state.status).toBe("active")
  expect(r.out.state.phases.intent.status).toBe("in_progress")
  expect(r.out.state.phases.intent.askKind).toBe("raguel")
})

test("mark-ask --kind confirm は askKind を confirm にし、それ以外の値を拒否する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  for (const bad of ["human", "RAGUEL"]) {
    const r = run(root, ["mark-ask", "intent", "--slug", "demo", "--kind", bad])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/不正な --kind/)
  }
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
  const r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "confirm"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.askKind).toBe("confirm")
  expect(r.out.state.phases.intent.evaluationId).toBeNull()
  const resumed = run(root, ["resume", "--slug", "demo"])
  expect(resumed.out.state.phases.intent.askKind).toBe("confirm")
})

test("finalize で mark-ask → resume した後に codiel-state finalize が成功する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_FINALIZE)
  const asked = run(root, [
    "mark-ask",
    "finalize",
    "--slug",
    "demo",
    "--kind",
    "confirm"
  ])
  expect(asked.code).toBe(0)
  const resumed = run(root, ["resume", "--slug", "demo"])
  expect(resumed.out.state.phases.finalize.status).toBe("in_progress")
  const r = run(root, ["finalize", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_outcome")
  expect(r.out.state.phases.finalize.status).toBe("passed")
  expect(r.out.state.phases.finalize.askKind).toBe("confirm")
})

test("mark-ask は passed と skip 済みのフェーズを拒否し、ゲートの記録を残す", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  passThrough(root, "demo", ["intent"])
  run(root, ["skip-phase", "discuss", "--slug", "demo", "--reason", "軽量"])
  for (const ph of ["intent", "discuss"]) {
    const r = run(root, ["mark-ask", ph, "--slug", "demo", "--kind", "confirm"])
    expect(r.code, ph).toBe(1)
    expect(r.err, ph).toMatch(/passed のため mark-ask できません/)
  }
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.intent.status).toBe("passed")
  expect(st.phases.intent.evaluationId).toBe("e-intent")
  expect(st.phases.intent.verdict).toBe("PROCEED")
  expect(st.phases.discuss.status).toBe("passed")
  expect(st.phases.discuss.verdict).toBe("SKIPPED")
})

test("mark-ask は finalize 以外の pending のフェーズを拒否し、start-phase の迂回を許さない", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--intent-only"])
  const beforeStart = run(root, ["mark-ask", "intent", "--slug", "demo"])
  expect(beforeStart.code).toBe(1)
  expect(beforeStart.err).toMatch(/pending のため mark-ask できません/)
  passThrough(root, "demo", ["intent"])
  // branch が null の run の implement は start-phase が拒否する。mark-ask → resume でも進めない
  const r = run(root, ["mark-ask", "implement", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/pending のため mark-ask できません/)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.implement.status).toBe("pending")
})
