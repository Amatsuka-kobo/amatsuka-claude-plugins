import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  codeRun,
  gateArgs,
  gateRun,
  git,
  init,
  latestState,
  passThrough,
  recordEvaluation,
  recordRuling,
  run,
  tmpProject,
  UNTIL_PR
} from "./helpers/codiel-state-fixtures.js"

test("pass-gate 検査 1: 索引に --evaluation-id の行が無ければ失敗する(掃除済みか存在しない)", () => {
  const root = gateRun()
  const r = run(root, gateArgs("intent", "ev-missing", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/evaluationId ev-missing の行がありません/)
  expect(r.err).toMatch(/掃除済みか、存在しない/)
  expect(latestState(root, "demo").phases.intent.status).toBe("in_progress")
})

test("pass-gate 検査 2: 行の runId が raguelRunId と、phase がコマンドのフェーズと違えば失敗する", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-run", {
    runId: "other-try-1"
  })
  let r = run(root, gateArgs("intent", "ev-run", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/別の run かフェーズの評価です/)
  recordEvaluation(root, "demo", "design", "PROCEED", "ev-phase")
  r = run(root, gateArgs("intent", "ev-phase", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/phase design/)
})

test("pass-gate 検査 3: 後の評価で ASK が出た後に、前の PROCEED では通せない", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-old")
  recordEvaluation(root, "demo", "intent", "ASK", "ev-new")
  const r = run(root, gateArgs("intent", "ev-old", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /最新の評価ではありません\(最新: ev-new、verdict: ASK\)/
  )
})

test("pass-gate 検査 4: ASK の評価に --verdict PROCEED を付けても通せない(D4)", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  const r = run(root, gateArgs("intent", "ev-ask", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /--verdict PROCEED が Raguel の評価の verdict ASK と合いません/
  )
  expect(latestState(root, "demo").phases.intent.status).toBe("in_progress")
})

test("pass-gate 検査 5: verdict.json が読めないか、索引の行と食い違えば失敗する", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-none", {
    noVerdictJson: true
  })
  let r = run(root, gateArgs("intent", "ev-none", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/verdict.json を読めません/)
  for (const [key, value] of [
    ["verdict", "STOP"],
    ["evaluationId", "ev-x"],
    ["runId", "x-try-1"],
    ["phase", "design"]
  ]) {
    recordEvaluation(root, "demo", "intent", "PROCEED", `ev-${key}`, {
      verdictJson: { [key]: value }
    })
    r = run(root, gateArgs("intent", `ev-${key}`, "PROCEED"))
    expect(r.code, key).toBe(1)
    expect(r.err, key).toMatch(new RegExp(`verdict.json の ${key}`))
  }
})

test("pass-gate 検査 6: --human-approved が無ければ PROCEED の評価だけを通す", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  const r = run(root, gateArgs("intent", "ev-ask", "ASK"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/verdict が PROCEED ではありません: ASK/)
})

test("pass-gate 検査 7: --human-approved には裁定の記録が要り、ASK は as-is、STOP は false-positive だけを受ける", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  const approve = (id: string, verdict: string) =>
    run(root, [...gateArgs("intent", id, verdict), "--human-approved"])
  let r = approve("ev-ask", "ASK")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/裁定の記録が要ります/)
  recordRuling(root, "demo", "intent", "ev-ask", "revise", "rejected")
  r = approve("ev-ask", "ASK")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/ruling が as-is であることが要ります\(記録: revise\)/)
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  recordRuling(root, "demo", "intent", "ev-stop", "as-is")
  r = approve("ev-stop", "STOP")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/ruling が false-positive であることが要ります/)
  // 同じ evaluationId の行は後の行を正とする
  recordRuling(root, "demo", "intent", "ev-stop", "false-positive")
  r = approve("ev-stop", "STOP")
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.humanApproved).toBe(true)
})

test("pass-gate 検査 8: code 系フェーズで subject.head が今の HEAD と違えば失敗する(評価の後のコミット)", () => {
  const root = codeRun()
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-tc")
  git(root, "commit", "-q", "--allow-empty", "-m", "after")
  const r = run(root, gateArgs("test-code", "ev-tc", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/現在の HEAD/)
})

test("pass-gate 検査 8: code 系フェーズで subject.base がフェーズの開始の HEAD と違えば失敗する(R16)", () => {
  const root = codeRun()
  const start = latestState(root, "demo").phases["test-code"].startHead
  git(root, "commit", "-q", "--allow-empty", "-m", "part-1")
  const mid = git(root, "rev-parse", "HEAD")
  git(root, "commit", "-q", "--allow-empty", "-m", "part-2")
  const head = git(root, "rev-parse", "HEAD")
  // baseRef を後ろへずらし、フェーズの差分の一部だけを評価させた
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-part", {
    subject: { repoPath: root, head, base: mid, files: [] }
  })
  let r = run(root, gateArgs("test-code", "ev-part", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/フェーズの開始の HEAD/)
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-full", {
    subject: { repoPath: root, head, base: start, files: [] }
  })
  r = run(root, gateArgs("test-code", "ev-full", "PROCEED"))
  expect(r.code).toBe(0)
})

test("pass-gate 検査 9: 文書のフェーズで subject.files の sha256 が今の中身と違えば失敗する(R16)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent", "discuss"])
  run(root, ["start-phase", "design", "--slug", "demo"])
  const rel = "docs/codiel/runs/demo/design.md"
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "# 設計\n")
  const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  const subject = {
    repoPath: root,
    head: git(root, "rev-parse", "HEAD"),
    paths: [rel],
    files: [{ path: rel, sha256: sha, isNew: true }]
  }
  recordEvaluation(root, "demo", "design", "PROCEED", "ev-design", { subject })
  // ゲートの後に書き換えた
  fs.appendFileSync(file, "追記\n")
  let r = run(root, gateArgs("design", "ev-design", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(new RegExp(`${rel} が評価の後に変わっています`))
  // 消した
  fs.rmSync(file)
  r = run(root, gateArgs("design", "ev-design", "PROCEED"))
  expect(r.code).toBe(1)
  fs.writeFileSync(file, "# 設計\n")
  r = run(root, gateArgs("design", "ev-design", "PROCEED"))
  expect(r.code).toBe(0)
})

test("pass-gate 検査 8: code 系フェーズで paths を絞った評価は、head と base が合っても失敗する(W4R2-01・W4R1-03)", () => {
  const root = codeRun()
  const start = latestState(root, "demo").phases["test-code"].startHead
  const head = git(root, "rev-parse", "HEAD")
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-paths", {
    subject: { repoPath: root, head, base: start, paths: ["a.ts"], files: [] }
  })
  const r = run(root, gateArgs("test-code", "ev-paths", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/paths\(\["a.ts"\]\)で絞られています/)
  expect(latestState(root, "demo").phases["test-code"].status).toBe(
    "in_progress"
  )
})

// 文書のフェーズを in_progress にし、files に rels を載せた評価(今の中身の sha256)で pass-gate する
function docGate(root: string, phase: string, rels: string[]) {
  const files = rels.map((rel) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `# ${rel}\n`)
    const sha256 = createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex")
    return { path: rel, sha256, isNew: true }
  })
  const id = `ev-${phase}-${rels.length}-${Math.random()}`
  recordEvaluation(root, "demo", phase, "PROCEED", id, {
    subject: {
      repoPath: root,
      head: git(root, "rev-parse", "HEAD"),
      paths: rels,
      files
    }
  })
  return run(root, gateArgs(phase, id, "PROCEED"))
}

test("pass-gate 検査 9: design と dev-plan は run の文書の置き場の design.md・dev-plan.md を評価していなければ失敗する(W4R2-03・W4R1-04)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent", "discuss"])
  run(root, ["start-phase", "design", "--slug", "demo"])
  // 別のファイルだけを評価した
  let r = docGate(root, "design", ["docs/other.md"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /design の評価に docs\/codiel\/runs\/demo\/design.md が含まれていません/
  )
  // 別の run の置き場の design.md でも通さない
  r = docGate(root, "design", ["docs/codiel/runs/other/design.md"])
  expect(r.code).toBe(1)
  r = docGate(root, "design", ["./docs/codiel/runs/demo/design.md"])
  expect(r.code, r.err).toBe(0)
  run(root, ["start-phase", "dev-plan", "--slug", "demo"])
  r = docGate(root, "dev-plan", ["docs/codiel/runs/demo/design.md"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /docs\/codiel\/runs\/demo\/dev-plan.md が含まれていません/
  )
  r = docGate(root, "dev-plan", ["docs/codiel/runs/demo/dev-plan.md"])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate 検査 9: run の文書の置き場は .codiel/config.json の runsDir と slug から組む", () => {
  const root = tmpProject()
  init(root)
  fs.writeFileSync(
    path.join(root, ".codiel", "config.json"),
    JSON.stringify({ runsDir: "notes/runs" })
  )
  passThrough(root, "demo", ["intent", "discuss"])
  run(root, ["start-phase", "design", "--slug", "demo"])
  let r = docGate(root, "design", ["docs/codiel/runs/demo/design.md"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/notes\/runs\/demo\/design.md が含まれていません/)
  r = docGate(root, "design", ["notes/runs/demo/design.md"])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate 検査 9: test-spec は testsDir 配下の spec.md か cases.md を 1 件以上評価していなければ失敗する", () => {
  const root = tmpProject()
  init(root)
  fs.writeFileSync(
    path.join(root, ".codiel", "config.json"),
    JSON.stringify({ testsDir: "qa/specs" })
  )
  passThrough(root, "demo", ["intent", "discuss", "design"])
  run(root, ["start-phase", "test-spec", "--slug", "demo"])
  for (const rels of [
    ["qa/specs/units/a/notes.md"],
    ["docs/codiel/tests/units/a/spec.md"],
    ["other/qa/specs/units/a/cases.md"]
  ]) {
    const r = docGate(root, "test-spec", rels)
    expect(r.code, rels[0]).toBe(1)
    expect(r.err).toMatch(
      /qa\/specs\/ 配下の spec.md か cases.md が含まれていません/
    )
  }
  const r = docGate(root, "test-spec", [
    "qa/specs/units/a/notes.md",
    "qa/specs/units/a/cases.md"
  ])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate 検査 9: intent-sync は期待するファイルを照合しない(sha256 の照合は行う)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, -1))
  run(root, ["start-phase", "intent-sync", "--slug", "demo"])
  const r = docGate(root, "intent-sync", ["docs/intents/any.md"])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate は通したときの HEAD を passedHead に記録する(文書と code 系のゲート付きフェーズ)", () => {
  const root = codeRun()
  const st = latestState(root, "demo")
  const head = git(root, "rev-parse", "HEAD")
  for (const ph of ["intent", "design", "test-spec", "dev-plan"])
    expect(st.phases[ph].passedHead, ph).toBe(head)
  // ゲートを持たないフェーズは記録しない
  expect(st.phases.discuss.passedHead).toBeUndefined()
  git(root, "commit", "-q", "--allow-empty", "-m", "tests")
  const after = git(root, "rev-parse", "HEAD")
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-tc")
  expect(run(root, gateArgs("test-code", "ev-tc", "PROCEED")).code).toBe(0)
  expect(latestState(root, "demo").phases["test-code"].passedHead).toBe(after)
})

test("pass-gate は git の管理外では passedHead を記録しない", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-intent")
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true })
  const r = run(root, gateArgs("intent", "ev-intent", "PROCEED"))
  expect(r.code, r.err).toBe(0)
  expect(r.out.state.phases.intent.status).toBe("passed")
  expect(r.out.state.phases.intent.passedHead).toBeUndefined()
})
