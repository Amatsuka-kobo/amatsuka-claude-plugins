import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  fullRun,
  git,
  init,
  latestState,
  passGate,
  passThrough,
  recordEvaluation,
  recordRuling,
  run,
  statePath,
  tmpProject,
  UNTIL_PR
} from "./helpers/codiel-state-fixtures.js"

test("mark-ask は終端の run を拒否し、run を生き返らせない", () => {
  const root = tmpProject()
  // completed(文書だけで終えた run)
  init(root, "closed", {}, ["--intent-only"])
  passThrough(root, "closed", ["intent"])
  run(root, ["close", "--slug", "closed", "--reason", "intent-only"])
  // stopped
  init(root, "stopped")
  run(root, ["start-phase", "intent", "--slug", "stopped"])
  run(root, ["stop", "--slug", "stopped", "--reason", "test"])
  // awaiting_outcome(finalize は passed)
  init(root, "demo")
  fullRun(root, "demo")
  for (const [slug, phase, status] of [
    ["closed", "intent", "completed"],
    ["stopped", "intent", "stopped"],
    ["demo", "finalize", "awaiting_outcome"]
  ]) {
    const r = run(root, [
      "mark-ask",
      phase,
      "--slug",
      slug,
      "--kind",
      "confirm"
    ])
    expect(r.code, slug).toBe(1)
    expect(r.err, slug).toMatch(/すでに終端状態です/)
    expect(run(root, ["get", "--slug", slug]).out.state.status, slug).toBe(
      status
    )
  }
})

// --- Raguel の STOP の裁定と次の try(決定 83、A6-27) ---

test("mark-ask --verdict はフェーズの verdict に記録し、省略時は ASK にし、PROCEED・ASK・STOP 以外を拒否する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  for (const bad of ["stop", "SKIPPED", "FOO"]) {
    const r = run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "demo",
      "--verdict",
      bad
    ])
    expect(r.code, bad).toBe(1)
    expect(r.err, bad).toMatch(/不正な --verdict/)
  }
  let st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.intent.verdict).toBeNull()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  let r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--evaluation-id",
    "ev-ask"
  ])
  expect(r.out.state.phases.intent.verdict).toBe("ASK")
  run(root, ["resume", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-proceed")
  r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--verdict",
    "PROCEED",
    "--evaluation-id",
    "ev-proceed"
  ])
  expect(r.out.state.phases.intent.verdict).toBe("PROCEED")
  run(root, ["resume", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.verdict).toBe("STOP")
  expect(r.out.state.phases.intent.askKind).toBe("raguel")
  expect(r.out.state.phases.intent.evaluationId).toBe("ev-stop")
  // resume の後も STOP が残る
  st = run(root, ["resume", "--slug", "demo"]).out.state
  expect(st.phases.intent.verdict).toBe("STOP")
})

test("pass-gate --verdict STOP は --human-approved のときだけ受け付け、STOP を記録したフェーズは --human-approved なしで上書きできない", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  let r = passGate(root, "intent", "STOP")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/verdict が PROCEED ではありません: STOP/)
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  run(root, ["resume", "--slug", "demo"])
  for (const verdict of ["PROCEED", "ASK"]) {
    r = passGate(root, "intent", verdict)
    expect(r.code, verdict).toBe(1)
    expect(r.err, verdict).toMatch(
      /フェーズ intent には Raguel の STOP が記録されています/
    )
  }
  let st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.phases.intent.status).toBe("in_progress")
  expect(st.phases.intent.verdict).toBe("STOP")
  expect(st.phases.intent.humanApproved).toBeUndefined()
  r = passGate(root, "intent", "FOO", ["--human-approved"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正な --verdict: FOO/)
  r = passGate(root, "intent", "STOP", ["--human-approved"])
  expect(r.code).toBe(0)
  st = r.out.state
  expect(st.phases.intent.status).toBe("passed")
  expect(st.phases.intent.verdict).toBe("STOP")
  expect(st.phases.intent.humanApproved).toBe(true)
  expect(st.phases.intent.evaluationId).toBe("ev1")
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
})

test("STOP を記録したフェーズは、resume の後の mark-ask --kind confirm でも STOP のまま残り、--human-approved の無い pass-gate は失敗する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  // --verdict の有無と値にかかわらず、記録済みの STOP を上書きしない
  for (const extra of [[], ["--verdict", "PROCEED"]]) {
    run(root, ["resume", "--slug", "demo"])
    const r = run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "demo",
      "--kind",
      "confirm",
      ...extra
    ])
    const label = extra.join(" ") || "--verdict なし"
    expect(r.code, label).toBe(0)
    expect(r.out.state.phases.intent.verdict, label).toBe("STOP")
    expect(r.out.state.phases.intent.askKind, label).toBe("confirm")
  }
  run(root, ["resume", "--slug", "demo"])
  const r = passGate(root, "intent", "PROCEED")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /フェーズ intent には Raguel の STOP が記録されています/
  )
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.phases.intent.status).toBe("in_progress")
  expect(st.phases.intent.verdict).toBe("STOP")
  expect(st.phases.intent.humanApproved).toBeUndefined()
})

test("STOP を記録したフェーズは、resume の後の --evaluation-id の無い mark-ask --kind confirm でも STOP の evaluationId を残す(新しい --evaluation-id を渡しても上書きしない)", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  for (const extra of [[], ["--evaluation-id", "ev-new"]]) {
    run(root, ["resume", "--slug", "demo"])
    const r = run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "demo",
      "--kind",
      "confirm",
      ...extra
    ])
    const label = extra.join(" ") || "--evaluation-id なし"
    expect(r.code, label).toBe(0)
    expect(r.out.state.phases.intent.verdict, label).toBe("STOP")
    expect(r.out.state.phases.intent.evaluationId, label).toBe("ev-stop")
  }
})

test("init は、最新の try が raguel-stop で止まったか humanApproved の無い STOP のフェーズを持つとき --human-approved を求め、どちらでもなければ従来どおり作る", () => {
  const root = tmpProject()
  const markStop = (slug: string) => {
    run(root, ["start-phase", "intent", "--slug", slug])
    recordEvaluation(root, slug, "intent", "STOP", `ev-stop-${slug}`)
    run(root, [
      "mark-ask",
      "intent",
      "--slug",
      slug,
      "--kind",
      "raguel",
      "--verdict",
      "STOP",
      "--evaluation-id",
      `ev-stop-${slug}`
    ])
  }
  // raguel-stop で止めた try
  init(root, "judged")
  markStop("judged")
  run(root, ["stop", "--slug", "judged", "--reason", "raguel-stop"])
  // STOP を記録した後に別の理由で止めた try
  init(root, "other")
  markStop("other")
  run(root, ["stop", "--slug", "other", "--reason", "intent-updated"])
  for (const slug of ["judged", "other"]) {
    const r = init(root, slug)
    expect(r.code, slug).toBe(1)
    expect(r.err, slug).toMatch(/Raguel の STOP で止まっています/)
    expect(r.err, slug).toMatch(/--human-approved を付けて init し直して/)
    expect(fs.existsSync(statePath(root, slug, 2)), slug).toBe(false)
  }
  expect(init(root, "other").err).toMatch(
    /stopReason: intent-updated、STOP のフェーズ: intent\(evaluationId: ev-stop-other\)/
  )
  for (const slug of ["judged", "other"]) {
    const r = init(root, slug, {}, ["--human-approved"])
    expect(r.code, slug).toBe(0)
    expect(r.out.state.try, slug).toBe(2)
    run(root, ["stop", "--slug", slug, "--reason", "test"])
  }

  // 人が誤検知と裁定した STOP(humanApproved あり)と、ASK のまま止めた try には当たらない
  init(root, "approved")
  markStop("approved")
  run(root, ["resume", "--slug", "approved"])
  recordRuling(root, "approved", "intent", "ev-stop-approved", "false-positive")
  const approved = run(root, [
    "pass-gate",
    "intent",
    "--slug",
    "approved",
    "--evaluation-id",
    "ev-stop-approved",
    "--verdict",
    "STOP",
    "--human-approved"
  ])
  expect(approved.code).toBe(0)
  run(root, ["stop", "--slug", "approved", "--reason", "test"])
  init(root, "asked")
  run(root, ["start-phase", "intent", "--slug", "asked"])
  recordEvaluation(root, "asked", "intent", "ASK", "ev-ask-asked")
  expect(
    run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "asked",
      "--evaluation-id",
      "ev-ask-asked"
    ]).code
  ).toBe(0)
  run(root, ["stop", "--slug", "asked", "--reason", "test"])
  for (const slug of ["approved", "asked"]) {
    const r = init(root, slug)
    expect(r.code, slug).toBe(0)
    expect(r.out.state.try, slug).toBe(2)
    run(root, ["stop", "--slug", slug, "--reason", "test"])
  }
})

// --- Raguel の記録との照合(Raguel 設計書 §6.13.3、所見 D1・D4、R11・R16) ---

test("init は、STOP を state に記録しないまま止めた try でも、Raguel の索引の STOP を見て --human-approved を求める(D1)", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  // mark-ask を経ずに stop した(state には STOP が無い)
  recordEvaluation(root, "demo", "intent", "STOP", "ev-hidden")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(latestState(root, "demo").phases.intent.verdict).toBeNull()
  const r = init(root)
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/誤検知の裁定の無い Raguel の STOP があります/)
  expect(r.err).toMatch(/ev-hidden/)
  expect(fs.existsSync(statePath(root, "demo", 2))).toBe(false)
  // 誤検知の裁定があれば当たらない
  recordRuling(root, "demo", "intent", "ev-hidden", "false-positive")
  expect(init(root).code).toBe(0)
  // --human-approved があれば、裁定が無くても作る
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-hidden-2")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(init(root).code).toBe(1)
  const approved = init(root, "demo", {}, ["--human-approved"])
  expect(approved.code).toBe(0)
  expect(approved.out.state.try).toBe(3)
})

test("init は、degraded の STOP・別の run の STOP・revise の裁定のある ASK では --human-approved を求めない", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-degraded", {
    judgeStatus: "degraded"
  })
  recordEvaluation(root, "demo", "intent", "STOP", "ev-other-run", {
    runId: "other-try-1"
  })
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  recordRuling(root, "demo", "intent", "ev-ask", "revise", "rejected")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(init(root).code).toBe(0)
})

test("init は新しい state に raguelContract: 2 を記録する", () => {
  const root = tmpProject()
  const r = init(root)
  expect(r.code).toBe(0)
  expect(r.out.state.raguelContract).toBe(2)
  expect(latestState(root, "demo").raguelContract).toBe(2)
})

test("start-phase は code 系の 4 フェーズでだけ開始の HEAD を startHead に記録し、開始し直しても書き換えない", () => {
  const root = tmpProject()
  init(root)
  const head0 = git(root, "rev-parse", "HEAD")
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  expect(run(root, ["start-phase", "test-code", "--slug", "demo"]).code).toBe(0)
  git(root, "commit", "-q", "--allow-empty", "-m", "c1")
  // in_progress のフェーズを開始し直しても、起点は動かない
  expect(run(root, ["start-phase", "test-code", "--slug", "demo"]).code).toBe(0)
  let st = latestState(root, "demo")
  expect(st.phases["test-code"].startHead).toBe(head0)
  expect(st.phases["test-code"].startHead).toMatch(/^[0-9a-f]{40}$/)
  for (const ph of ["intent", "design", "test-spec", "dev-plan"])
    expect(st.phases[ph].startHead, ph).toBeUndefined()
  expect(passGate(root, "test-code", "PROCEED").code).toBe(0)
  const head1 = git(root, "rev-parse", "HEAD")
  passThrough(root, "demo", ["implement", "test-loop", "intent-sync"])
  passThrough(root, "demo", ["pr", "review", "fix-loop"])
  st = latestState(root, "demo")
  for (const ph of ["implement", "test-loop", "fix-loop"])
    expect(st.phases[ph].startHead, ph).toBe(head1)
  expect(st.phases["intent-sync"].startHead).toBeUndefined()
})

test("start-phase は code 系フェーズで HEAD を読めなければ失敗し、フェーズを開始しない", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true })
  const r = run(root, ["start-phase", "test-code", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/開始の HEAD を読めません/)
  expect(latestState(root, "demo").phases["test-code"].status).toBe("pending")
})
