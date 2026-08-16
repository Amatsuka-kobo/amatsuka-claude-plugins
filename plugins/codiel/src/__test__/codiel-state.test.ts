import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../codiel-state-cli.ts", import.meta.url))

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codiel-state-"))
}
function run(cwd: string, args: string[]) {
  try {
    const out = runTs(CLI, args, { cwd })
    return { code: 0, out: JSON.parse(out) }
  } catch (e) {
    const err = e as { status: number; stderr?: unknown; stdout?: unknown }
    return { code: err.status, err: String(err.stderr || err.stdout || "") }
  }
}

test("init は try-1 の state.json を作成する", () => {
  const root = tmpProject()
  const r = run(root, ["init", "--issue", "123", "--base-branch", "main"])
  expect(r.code).toBe(0)
  expect(r.out.state.runId).toBe("issue-123")
  expect(r.out.state.try).toBe(1)
  expect(r.out.state.branch).toBe("codiel/issue-123-try-1")
  expect(r.out.state.raguelRunId).toBe("issue-123-try-1")
  expect(r.out.state.status).toBe("active")
  expect(r.out.state.phases.init.status).toBe("pending")
  expect(
    fs.existsSync(path.join(root, ".codiel/runs/issue-123/try-1/state.json"))
  ).toBeTruthy()
  expect(
    fs.existsSync(path.join(root, ".codiel/runs/issue-123/try-1/reports"))
  ).toBeTruthy()
})

test("未完了 try がある間は init が失敗する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "123"])
  const r = run(root, ["init", "--issue", "123"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/未完了/)
})

test("終端状態(stopped)なら init が try-2 を作成する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "123"])
  run(root, ["stop", "--issue", "123", "--reason", "test"])
  const r = run(root, ["init", "--issue", "123"])
  expect(r.code).toBe(0)
  expect(r.out.state.try).toBe(2)
  expect(r.out.state.branch).toBe("codiel/issue-123-try-2")
})

test("get は最新 try の state を返す", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "7"])
  const r = run(root, ["get", "--issue", "7"])
  expect(r.code).toBe(0)
  expect(r.out.state.runId).toBe("issue-7")
})

test("get --active はアクティブ run の一覧を返す", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(r.out.runs.length).toBe(1)
  expect(r.out.runs[0].state.issue).toBe(1)
})

test("stop は終端状態のときに失敗する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["stop", "--issue", "1", "--reason", "test"])
  const r = run(root, ["stop", "--issue", "1", "--reason", "test again"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/すでに終端状態です/)
})

test("start-phase は前ステージ未passedなら失敗する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, ["start-phase", "design", "--issue", "1"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/init/)
})

test("GATEDフェーズは pass-gate(PROCEED)でのみ passed になる", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  let r = run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "ev1",
    "--verdict",
    "ASK"
  ])
  expect(r.code).toBe(1)
  r = run(root, ["complete-phase", "init", "--issue", "1"])
  expect(r.code).toBe(1) // GATED に complete-phase は使えない
  r = run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "ev1",
    "--verdict",
    "PROCEED"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.init.status).toBe("passed")
  expect(r.out.state.phases.init.evaluationId).toBe("ev1")
})

test("pass-gate は --human-approved 指定時に ASK を受理し humanApproved を記録する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  const r = run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e1",
    "--verdict",
    "ASK",
    "--human-approved"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.init.status).toBe("passed")
  expect(r.out.state.phases.init.verdict).toBe("ASK")
  expect(r.out.state.phases.init.humanApproved).toBe(true)
})

test("pass-gate は --human-approved なしでは ASK を従来どおり拒否する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  const r = run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e1",
    "--verdict",
    "ASK"
  ])
  expect(r.code).toBe(1)
})

test("--human-approved で passed になったフェーズの次フェーズを start-phase できる", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e1",
    "--verdict",
    "ASK",
    "--human-approved"
  ])
  const r = run(root, ["start-phase", "discuss", "--issue", "1"])
  expect(r.code).toBe(0)
})

test("並列ステージ(test-spec/dev-plan)は design passed 後に両方 start できる", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e1",
    "--verdict",
    "PROCEED"
  ])
  run(root, ["start-phase", "discuss", "--issue", "1"])
  run(root, ["complete-phase", "discuss", "--issue", "1"])
  run(root, ["start-phase", "design", "--issue", "1"])
  run(root, [
    "pass-gate",
    "design",
    "--issue",
    "1",
    "--evaluation-id",
    "e2",
    "--verdict",
    "PROCEED"
  ])
  expect(run(root, ["start-phase", "test-spec", "--issue", "1"]).code).toBe(0)
  expect(run(root, ["start-phase", "dev-plan", "--issue", "1"]).code).toBe(0)
  // 片方だけ passed では implement に進めない
  run(root, [
    "pass-gate",
    "test-spec",
    "--issue",
    "1",
    "--evaluation-id",
    "e3",
    "--verdict",
    "PROCEED"
  ])
  expect(run(root, ["start-phase", "implement", "--issue", "1"]).code).toBe(1)
})

test("mark-ask / resume で awaiting_human を往復できる", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  let r = run(root, [
    "mark-ask",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e1"
  ])
  expect(r.out.state.status).toBe("awaiting_human")
  expect(r.out.state.phases.init.status).toBe("awaiting_human")
  r = run(root, ["resume", "--issue", "1"])
  expect(r.out.state.status).toBe("active")
  expect(r.out.state.phases.init.status).toBe("in_progress")
})

test("record-attempt は上限超過で exit 3 + awaiting_human", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  for (let i = 0; i < 5; i++)
    expect(run(root, ["record-attempt", "init", "--issue", "1"]).code).toBe(0)
  const r = run(root, ["record-attempt", "init", "--issue", "1"])
  expect(r.code).toBe(3)
  expect(run(root, ["get", "--issue", "1"]).out.state.status).toBe(
    "awaiting_human"
  )
})

test("pr フェーズの complete-phase は --pr-url 必須", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  passThrough(root, [
    "init",
    "discuss",
    "design",
    "test-spec",
    "dev-plan",
    "implement",
    "test-loop"
  ])
  run(root, ["start-phase", "pr", "--issue", "1"])
  expect(run(root, ["complete-phase", "pr", "--issue", "1"]).code).toBe(1)
  const r = run(root, [
    "complete-phase",
    "pr",
    "--issue",
    "1",
    "--pr-url",
    "https://example.test/pr/1"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.pr.url).toBe("https://example.test/pr/1")
})

test("finalize は全フェーズ passed 後のみ成功し awaiting_outcome にする", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  expect(run(root, ["finalize", "--issue", "1"]).code).toBe(1)
  passThrough(root, [
    "init",
    "discuss",
    "design",
    "test-spec",
    "dev-plan",
    "implement",
    "test-loop"
  ])
  run(root, ["start-phase", "pr", "--issue", "1"])
  run(root, ["complete-phase", "pr", "--issue", "1", "--pr-url", "u"])
  for (const ph of ["review", "fix-loop", "triage"]) {
    run(root, ["start-phase", ph, "--issue", "1"])
    if (ph === "fix-loop")
      run(root, [
        "pass-gate",
        ph,
        "--issue",
        "1",
        "--evaluation-id",
        "e",
        "--verdict",
        "PROCEED"
      ])
    else run(root, ["complete-phase", ph, "--issue", "1"])
  }
  const r = run(root, ["finalize", "--issue", "1"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_outcome")
})

test("record-outcome approved は completed にする", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  expect(
    run(root, ["record-outcome", "--issue", "1", "--outcome", "approved"]).code
  ).toBe(1)
  // (finalize まで進めるヘルパーを流してから)
  fullRun(root, "1")
  const r = run(root, [
    "record-outcome",
    "--issue",
    "1",
    "--outcome",
    "approved"
  ])
  expect(r.out.state.status).toBe("completed")
})

test("skip-phase fix-loop は review まで passed なら passed/verdict SKIPPED にでき、続けて triage を start できる", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  throughReview(root, "1")
  const r = run(root, [
    "skip-phase",
    "fix-loop",
    "--issue",
    "1",
    "--reason",
    "critical/high ゼロ"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases["fix-loop"].status).toBe("passed")
  expect(r.out.state.phases["fix-loop"].verdict).toBe("SKIPPED")
  expect(r.out.state.phases["fix-loop"].note).toBe("critical/high ゼロ")
  const r2 = run(root, ["start-phase", "triage", "--issue", "1"])
  expect(r2.code).toBe(0)
})

test("skip-phase は fix-loop 以外のフェーズでは失敗する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, [
    "skip-phase",
    "implement",
    "--issue",
    "1",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
})

test("skip-phase は --reason なしでは失敗する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  throughReview(root, "1")
  const r = run(root, ["skip-phase", "fix-loop", "--issue", "1"])
  expect(r.code).toBe(1)
})

test("skip-phase fix-loop は review が passed でない状態では失敗する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  passThrough(root, [
    "init",
    "discuss",
    "design",
    "test-spec",
    "dev-plan",
    "implement",
    "test-loop"
  ])
  run(root, ["start-phase", "pr", "--issue", "1"])
  run(root, ["complete-phase", "pr", "--issue", "1", "--pr-url", "u"])
  run(root, ["start-phase", "review", "--issue", "1"]) // review は in_progress のまま(未 passed)
  const r = run(root, [
    "skip-phase",
    "fix-loop",
    "--issue",
    "1",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
})

test("complete-phase は不正なフェーズ名を拒否する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, ["complete-phase", "bogus", "--issue", "1"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正なフェーズ/)
})

test("mark-ask は不正なフェーズ名を拒否する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, [
    "mark-ask",
    "bogus",
    "--issue",
    "1",
    "--evaluation-id",
    "e"
  ])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正なフェーズ/)
})

test("record-attempt は不正なフェーズ名を拒否する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, ["record-attempt", "bogus", "--issue", "1"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正なフェーズ/)
})

test("skip-phase は不正なフェーズ名を拒否する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, [
    "skip-phase",
    "bogus",
    "--issue",
    "1",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正なフェーズ/)
})

test("discuss は init passed 後に start でき、complete-phase で passed になる(pass-gate は拒否)", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  expect(run(root, ["start-phase", "discuss", "--issue", "1"]).code).toBe(0)
  const rGate = run(root, [
    "pass-gate",
    "discuss",
    "--issue",
    "1",
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  expect(rGate.code).toBe(1)
  expect(rGate.err).toMatch(/ゲート対象フェーズではありません/)
  const r = run(root, ["complete-phase", "discuss", "--issue", "1"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.discuss.status).toBe("passed")
})

test("design は discuss が passed になるまで start できない", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["start-phase", "init", "--issue", "1"])
  run(root, [
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  const r = run(root, ["start-phase", "design", "--issue", "1"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/discuss/)
})

test("set-domain は domain を書き、clear-domain で null に戻る", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, ["set-domain", "--issue", "1", "--domain", "frontend"])
  expect(r.code).toBe(0)
  expect(r.out.state.domain).toBe("frontend")
  expect(run(root, ["get", "--issue", "1"]).out.state.domain).toBe("frontend")
  const r2 = run(root, ["clear-domain", "--issue", "1"])
  expect(r2.code).toBe(0)
  expect(r2.out.state.domain).toBe(null)
  expect(run(root, ["get", "--issue", "1"]).out.state.domain).toBe(null)
})

test("set-domain は既存の domain を上書きする", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["set-domain", "--issue", "1", "--domain", "frontend"])
  const r = run(root, ["set-domain", "--issue", "1", "--domain", "backend"])
  expect(r.code).toBe(0)
  expect(r.out.state.domain).toBe("backend")
})

test("set-domain はドメインマップに無い名前でも受理する(検証は読む側の責務)", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const r = run(root, ["set-domain", "--issue", "1", "--domain", "存在しない"])
  expect(r.code).toBe(0)
  expect(r.out.state.domain).toBe("存在しない")
})

test("set-domain は空文字列・空白のみ・--domain 省略を拒否する", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const empty = run(root, ["set-domain", "--issue", "1", "--domain", ""])
  expect(empty.code).toBe(1)
  expect(empty.err).toMatch(/空文字列/)
  const blank = run(root, ["set-domain", "--issue", "1", "--domain", "   "])
  expect(blank.code).toBe(1)
  expect(blank.err).toMatch(/空文字列/)
  const missing = run(root, ["set-domain", "--issue", "1"])
  expect(missing.code).toBe(1)
  expect(missing.err).toMatch(/--domain が必要です/)
  // 拒否されたときは state に domain が書かれない
  expect(run(root, ["get", "--issue", "1"]).out.state.domain).toBeUndefined()
})

test("set-domain / clear-domain は run が無ければ失敗する", () => {
  const root = tmpProject()
  const noRun = run(root, ["set-domain", "--issue", "99", "--domain", "web"])
  expect(noRun.code).toBe(1)
  expect(noRun.err).toMatch(/run が存在しません: issue-99/)
  const noRunClear = run(root, ["clear-domain", "--issue", "99"])
  expect(noRunClear.code).toBe(1)
  expect(noRunClear.err).toMatch(/run が存在しません: issue-99/)
  const noIssue = run(root, ["set-domain", "--domain", "web"])
  expect(noIssue.code).toBe(1)
  expect(noIssue.err).toMatch(/--issue が必要です/)
  const noIssueClear = run(root, ["clear-domain"])
  expect(noIssueClear.code).toBe(1)
  expect(noIssueClear.err).toMatch(/--issue が必要です/)
})

test("set-domain は終端状態の run を拒否し、clear-domain は終端状態でも解除できる", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  run(root, ["set-domain", "--issue", "1", "--domain", "frontend"])
  run(root, ["stop", "--issue", "1", "--reason", "test"])
  const r = run(root, ["set-domain", "--issue", "1", "--domain", "backend"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/すでに終端状態です/)
  // 委譲中に run が落ちても解除できる(古い domain を残さない)
  const r2 = run(root, ["clear-domain", "--issue", "1"])
  expect(r2.code).toBe(0)
  expect(r2.out.state.domain).toBe(null)
})

test("domain を持たない既存 state を読んでも壊れない(後方互換)", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1"])
  const statePath = path.join(root, ".codiel/runs/issue-1/try-1/state.json")
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8"))
  expect("domain" in raw).toBe(false)
  expect(raw.version).toBe(1)
  // domain キーが無い state でも既存サブコマンドは通常どおり動く
  expect(run(root, ["get", "--issue", "1"]).code).toBe(0)
  expect(run(root, ["start-phase", "init", "--issue", "1"]).code).toBe(0)
  // 後付けの clear-domain も通り、version は据え置かれる
  const r = run(root, ["clear-domain", "--issue", "1"])
  expect(r.code).toBe(0)
  expect(r.out.state.version).toBe(1)
  expect(r.out.state.phases.init.status).toBe("in_progress")
})

test("set-domain 後も既存サブコマンドが正常に動き、他フィールドを壊さない", () => {
  const root = tmpProject()
  run(root, ["init", "--issue", "1", "--base-branch", "develop"])
  const before = run(root, ["get", "--issue", "1"]).out.state
  run(root, ["set-domain", "--issue", "1", "--domain", "backend"])
  const after = run(root, ["get", "--issue", "1"]).out.state
  for (const key of [
    "version",
    "runId",
    "try",
    "issue",
    "branch",
    "raguelRunId",
    "status",
    "phase",
    "phases",
    "pr",
    "limits",
    "stopReason",
    "incidents",
    "createdAt",
    "baseBranch"
  ])
    expect(after[key]).toStrictEqual(before[key])
  // set-domain を挟んでも通常のフェーズ遷移が最後まで通る
  fullRun(root, "1")
  const done = run(root, ["get", "--issue", "1"])
  expect(done.out.state.status).toBe("awaiting_outcome")
  expect(done.out.state.domain).toBe("backend")
  expect(done.out.state.baseBranch).toBe("develop")
  expect(done.out.state.pr.url).toBe("u")
  expect(
    run(root, ["record-outcome", "--issue", "1", "--outcome", "approved"]).out
      .state.status
  ).toBe("completed")
})

// テストヘルパー
function passThrough(root: string, phases: string[]): void {
  for (const ph of phases) {
    run(root, ["start-phase", ph, "--issue", "1"])
    if (ph === "discuss") run(root, ["complete-phase", ph, "--issue", "1"])
    else
      run(root, [
        "pass-gate",
        ph,
        "--issue",
        "1",
        "--evaluation-id",
        `e-${ph}`,
        "--verdict",
        "PROCEED"
      ])
  }
}

function throughReview(root: string, issue: string): void {
  passThrough(root, [
    "init",
    "discuss",
    "design",
    "test-spec",
    "dev-plan",
    "implement",
    "test-loop"
  ])
  run(root, ["start-phase", "pr", "--issue", issue])
  run(root, ["complete-phase", "pr", "--issue", issue, "--pr-url", "u"])
  run(root, ["start-phase", "review", "--issue", issue])
  run(root, ["complete-phase", "review", "--issue", issue])
}

function fullRun(root: string, issue: string): void {
  passThrough(root, [
    "init",
    "discuss",
    "design",
    "test-spec",
    "dev-plan",
    "implement",
    "test-loop"
  ])
  run(root, ["start-phase", "pr", "--issue", issue])
  run(root, ["complete-phase", "pr", "--issue", issue, "--pr-url", "u"])
  run(root, ["start-phase", "review", "--issue", issue])
  run(root, ["complete-phase", "review", "--issue", issue])
  run(root, ["start-phase", "fix-loop", "--issue", issue])
  run(root, [
    "pass-gate",
    "fix-loop",
    "--issue",
    issue,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  run(root, ["start-phase", "triage", "--issue", issue])
  run(root, ["complete-phase", "triage", "--issue", issue])
  run(root, ["finalize", "--issue", issue])
}
