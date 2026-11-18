import fs from "node:fs"
import { expect, test } from "vitest"
import {
  init,
  passGate,
  passThrough,
  run,
  specAdd,
  statePath,
  stepAdd,
  tmpProject,
  UNTIL_REVIEW
} from "./helpers/codiel-state-fixtures.js"

function stepUpdate(
  root: string,
  id: string,
  status: string,
  extra: string[] = []
) {
  return run(root, [
    "step-update",
    "--slug",
    "demo",
    "--id",
    id,
    "--status",
    status,
    ...extra
  ])
}

test("step-add は implement.steps に必須フィールドを持つステップを登録し、version を 2 のまま保つ", () => {
  const root = tmpProject()
  init(root)
  const r = stepAdd(
    root,
    "1",
    ["src/{a,b}/**"],
    [],
    ["--final", "--domain", "backend"]
  )
  expect(r.code).toBe(0)
  expect(r.out.state.version).toBe(2)
  expect(r.out.state.implement.steps["1"]).toStrictEqual({
    status: "pending",
    files: ["src/{a,b}/**"],
    deps: [],
    final: true,
    group: null,
    worktree: null,
    branch: null,
    commits: { base: null, head: null },
    attempts: 0,
    domain: "backend"
  })
  expect("testLoop" in r.out.state).toBe(false)
  // 前提ステップは JSON 配列で受ける
  const second = stepAdd(root, "2", ["src/c/**"], ["1"])
  expect(second.out.state.implement.steps["2"].deps).toStrictEqual(["1"])
  expect(second.out.state.implement.steps["2"].final).toBe(false)
})

test("step-add --kind test-loop は testLoop.units に登録し、--files を受け付け、前提ステップと --final を拒否する", () => {
  const root = tmpProject()
  init(root)
  const r = specAdd(root, "test-loop", "e2e/frontend/login", [
    "--files",
    '["src/pages/login/**"]',
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  const unit = r.out.state.testLoop.units["e2e/frontend/login"]
  expect(unit.files).toStrictEqual(["src/pages/login/**"])
  expect(unit.deps).toStrictEqual([])
  expect(unit.group).toBeNull()
  expect(unit.final).toBe(false)
  expect(unit.domain).toBe("frontend")
  expect("implement" in r.out.state).toBe(false)
  expect("testCode" in r.out.state).toBe(false)
  const withDeps = specAdd(root, "test-loop", "units/src/a.ts", [
    "--deps",
    '["e2e/frontend/login"]'
  ])
  expect(withDeps.code).not.toBe(0)
  const withFinal = specAdd(root, "test-loop", "units/src/b.ts", ["--final"])
  expect(withFinal.code).not.toBe(0)
})

test("step-add は JSON 配列でない --files・--deps、空の --files、repoRoot の外を指す glob を拒否する", () => {
  const root = tmpProject()
  init(root)
  const base = ["step-add", "--slug", "demo", "--id", "1"]
  const add = (files: string, deps = "[]") =>
    run(root, [...base, "--files", files, "--deps", deps])
  expect(add("src/a/**").code).not.toBe(0)
  expect(add('"src/a/**"').code).not.toBe(0)
  expect(add("[]").code).not.toBe(0)
  expect(add('["/abs/**"]').code).not.toBe(0)
  expect(add('["../x/**"]').code).not.toBe(0)
  expect(add('["src/a/**"]', "1").code).not.toBe(0)
  // --kind step では --deps を省けない
  expect(run(root, [...base, "--files", '["a/**"]']).code).not.toBe(0)
  expect(add('["src/a/**"]').code).toBe(0)
})

test("step-update は計画書 §6.2 の表の遷移だけを許し、記録のフラグを受け付ける", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  // 表に無い遷移
  expect(stepUpdate(root, "1", "merged").code).not.toBe(0)
  expect(stepUpdate(root, "1", "reviewing").code).not.toBe(0)
  expect(stepUpdate(root, "1", "failed").code).not.toBe(0)
  // 遷移が受け付けない記録のフラグ
  expect(stepUpdate(root, "1", "running", ["--head", "h"]).code).not.toBe(0)
  const running = stepUpdate(root, "1", "running", [
    "--worktree",
    ".codiel/worktrees/demo/step-1",
    "--branch",
    "codiel/demo-try-1-step-1",
    "--base",
    "b1"
  ])
  expect(running.code).toBe(0)
  const s1 = running.out.state.implement.steps["1"]
  expect(s1.status).toBe("running")
  expect(s1.worktree).toBe(".codiel/worktrees/demo/step-1")
  expect(s1.branch).toBe("codiel/demo-try-1-step-1")
  expect(s1.commits).toStrictEqual({ base: "b1", head: null })
  expect(stepUpdate(root, "1", "pending").code).not.toBe(0)
  expect(stepUpdate(root, "1", "merged").code).not.toBe(0)
  expect(stepUpdate(root, "1", "reviewing").code).toBe(0)
  // reviewing → running で attempts を 1 増やす
  const again = stepUpdate(root, "1", "running")
  expect(again.out.state.implement.steps["1"].attempts).toBe(1)
  expect(stepUpdate(root, "1", "reviewing").code).toBe(0)
  const merged = stepUpdate(root, "1", "merged", ["--head", "h1"])
  expect(merged.code).toBe(0)
  expect(merged.out.state.implement.steps["1"].status).toBe("merged")
  expect(merged.out.state.implement.steps["1"].commits).toStrictEqual({
    base: "b1",
    head: "h1"
  })
  // merged は終端
  for (const to of ["pending", "running", "reviewing", "failed"])
    expect(stepUpdate(root, "1", to).code, to).not.toBe(0)
  // 未登録のステップ、値域の外の状態
  expect(stepUpdate(root, "9", "running").code).not.toBe(0)
  stepAdd(root, "2", ["src/b/**"])
  expect(stepUpdate(root, "2", "done").code).not.toBe(0)
})

test("step-update は failed から pending で worktree・branch・commits を null に戻し、attempts は残す", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  const record = ["--worktree", "w", "--branch", "br", "--base", "b"]
  stepUpdate(root, "1", "running", record)
  stepUpdate(root, "1", "reviewing")
  stepUpdate(root, "1", "running")
  expect(stepUpdate(root, "1", "failed").code).toBe(0)
  expect(stepUpdate(root, "1", "running").code).not.toBe(0)
  const reset = stepUpdate(root, "1", "pending")
  expect(reset.code).toBe(0)
  const s = reset.out.state.implement.steps["1"]
  expect(s.status).toBe("pending")
  expect(s.worktree).toBeNull()
  expect(s.branch).toBeNull()
  expect(s.commits).toStrictEqual({ base: null, head: null })
  expect(s.attempts).toBe(1)
  // reviewing からも failed にできる
  stepUpdate(root, "1", "running")
  stepUpdate(root, "1", "reviewing")
  expect(stepUpdate(root, "1", "failed").code).toBe(0)
})

test("step-update --kind test-code と test-loop はそれぞれの表の要素を同じ遷移で進める", () => {
  const root = tmpProject()
  init(root)
  const id = "units/src/lib/foo.ts"
  specAdd(root, "test-code", id)
  specAdd(root, "test-loop", id)
  // step の表には無いので、--kind を省くと失敗する
  expect(stepUpdate(root, id, "running").code).not.toBe(0)
  for (const kind of ["test-code", "test-loop"]) {
    const wt = `.codiel/worktrees/demo/${kind}-1`
    const r = stepUpdate(root, id, "running", [
      "--kind",
      kind,
      "--worktree",
      wt
    ])
    expect(r.code, kind).toBe(0)
    const table = kind === "test-code" ? "testCode" : "testLoop"
    expect(r.out.state[table].units[id].status, kind).toBe("running")
    expect(r.out.state[table].units[id].worktree, kind).toBe(wt)
    // 表に無い遷移は test-code と test-loop でも拒否する
    expect(
      stepUpdate(root, id, "merged", ["--kind", kind, "--head", "h"]).code,
      kind
    ).not.toBe(0)
  }
  const unitKind = stepUpdate(root, id, "reviewing", ["--kind", "unit"])
  expect(unitKind.code).toBe(1)
  expect(unitKind.err).toMatch(/不正な --kind: unit/)
})

// --- 仕様のディレクトリの登録(設計書 §6.13.3・§6.6.3、A6-5) ---

const SPEC_IDS = [
  "units/src/lib/foo.ts",
  "e2e/frontend/login",
  "e2e/backend/api/users/{id}",
  "e2e/backend/_root",
  "e2e/cli/codiel-state"
]

test("step-add --kind test-code と test-loop は仕様のディレクトリの ID を --files なしで受け付け、それぞれの表に登録する", () => {
  const root = tmpProject()
  init(root)
  for (const kind of ["test-code", "test-loop"])
    for (const id of SPEC_IDS)
      expect(specAdd(root, kind, id).code, `${kind} ${id}`).toBe(0)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(Object.keys(st.testCode.units)).toStrictEqual(SPEC_IDS)
  expect(Object.keys(st.testLoop.units)).toStrictEqual(SPEC_IDS)
  const fresh = {
    status: "pending",
    files: [],
    deps: [],
    final: false,
    group: null,
    worktree: null,
    branch: null,
    commits: { base: null, head: null },
    attempts: 0,
    domain: null
  }
  for (const id of SPEC_IDS) {
    expect(st.testCode.units[id], id).toStrictEqual(fresh)
    expect(st.testLoop.units[id], id).toStrictEqual(fresh)
  }
  expect("implement" in st).toBe(false)
  expect(st.version).toBe(2)
})

test("step-add --kind test-code と test-loop は仕様のディレクトリの形でない ID・--deps・--final・--kind unit を拒否する", () => {
  const root = tmpProject()
  init(root)
  for (const kind of ["test-code", "test-loop"]) {
    for (const bad of [
      "units",
      "units/",
      "/units/a.ts",
      "units/../a.ts",
      "e2e/backend/api/users/:id",
      "e2e/frontend/a/b",
      "e2e/other/x",
      "screen-login",
      "e2e/cli/a/b",
      "e2e/backend",
      "e2e/frontend/",
      "units//a.ts",
      "units/./a.ts",
      "units/src/a.ts/",
      "units\\src\\a.ts"
    ]) {
      const r = specAdd(root, kind, bad)
      expect(r.code, `${kind} ${bad}`).toBe(1)
      expect(r.err, `${kind} ${bad}`).toMatch(/不正な --id/)
    }
    const deps = specAdd(root, kind, "units/src/a.ts", ["--deps", "[]"])
    expect(deps.code, kind).toBe(1)
    expect(deps.err, kind).toMatch(/--deps と --final を指定できません/)
    const final = specAdd(root, kind, "units/src/a.ts", ["--final"])
    expect(final.code, kind).toBe(1)
    expect(final.err, kind).toMatch(/--deps と --final を指定できません/)
  }
  const unit = specAdd(root, "unit", "units/src/a.ts")
  expect(unit.code).toBe(1)
  expect(unit.err).toMatch(/不正な --kind: unit/)
  // step の ID は現行の形のまま(仕様のディレクトリの ID は受け付けない)
  const step = stepAdd(root, "units/src/a.ts", ["src/a.ts"])
  expect(step.code).toBe(1)
  expect(step.err).toMatch(/不正な --id/)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  for (const key of ["implement", "testCode", "testLoop"])
    expect(key in st, key).toBe(false)
})

// 要素を pending から merged まで進める
function mergeElement(root: string, kind: string, id: string, wt: string) {
  const k = ["--kind", kind]
  expect(stepUpdate(root, id, "running", [...k, "--worktree", wt]).code).toBe(0)
  expect(stepUpdate(root, id, "reviewing", k).code).toBe(0)
  expect(stepUpdate(root, id, "merged", [...k, "--head", "h"]).code).toBe(0)
}

test("testLoop.units の merged の要素は登録し直せ、testCode.units と implement.steps の merged の要素は登録し直せない", () => {
  const root = tmpProject()
  init(root)
  const [a, b] = SPEC_IDS
  specAdd(root, "test-loop", a)
  specAdd(root, "test-loop", b)
  mergeElement(root, "test-loop", a, ".codiel/worktrees/demo/test-loop-1")
  const again = specAdd(root, "test-loop", a)
  expect(again.code).toBe(0)
  const units = again.out.state.testLoop.units
  expect(units[a].status).toBe("pending")
  expect(units[a].worktree).toBeNull()
  expect(units[a].commits).toStrictEqual({ base: null, head: null })
  // 登録し直してもキーの位置(worktree の名前の k)は変わらない
  expect(Object.keys(units)).toStrictEqual([a, b])
  // merged でも pending でもない要素は test-loop でも登録し直せない
  stepUpdate(root, b, "running", ["--kind", "test-loop"])
  const running = specAdd(root, "test-loop", b)
  expect(running.code).toBe(1)
  expect(running.err).toMatch(/running のため登録し直せません/)
  specAdd(root, "test-code", a)
  mergeElement(root, "test-code", a, ".codiel/worktrees/demo/test-code-1")
  const code = specAdd(root, "test-code", a)
  expect(code.code).toBe(1)
  expect(code.err).toMatch(/merged のため登録し直せません/)
  stepAdd(root, "1", ["src/a/**"])
  mergeElement(root, "step", "1", ".codiel/worktrees/demo/step-1")
  const step = stepAdd(root, "1", ["src/a/**"])
  expect(step.code).toBe(1)
  expect(step.err).toMatch(/merged のため登録し直せません/)
})

test("step-update --worktree は 3 つの表のほかの要素がすでに記録したパスを拒否する", () => {
  const root = tmpProject()
  init(root)
  const id = "units/src/a.ts"
  const stepWt = ".codiel/worktrees/demo/step-1"
  const codeWt = ".codiel/worktrees/demo/test-code-1"
  stepAdd(root, "1", ["src/a/**"])
  stepAdd(root, "2", ["src/b/**"])
  specAdd(root, "test-code", id)
  specAdd(root, "test-loop", id)
  expect(stepUpdate(root, "1", "running", ["--worktree", stepWt]).code).toBe(0)
  const taken = [
    ["2", "step", stepWt],
    [id, "test-code", stepWt],
    [id, "test-loop", `./${stepWt}/`]
  ]
  for (const [target, kind, wt] of taken) {
    const r = stepUpdate(root, target, "running", [
      "--kind",
      kind,
      "--worktree",
      wt
    ])
    expect(r.code, `${kind} ${wt}`).toBe(1)
    expect(r.err, `${kind} ${wt}`).toMatch(/step 1 がすでに記録しています/)
  }
  expect(
    stepUpdate(root, id, "running", [
      "--kind",
      "test-code",
      "--worktree",
      codeWt
    ]).code
  ).toBe(0)
  const loop = stepUpdate(root, id, "running", [
    "--kind",
    "test-loop",
    "--worktree",
    codeWt
  ])
  expect(loop.code).toBe(1)
  expect(loop.err).toContain(`test-code ${id} がすでに記録しています`)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.implement.steps["2"].status).toBe("pending")
  expect(st.testLoop.units[id].status).toBe("pending")
  expect(st.testLoop.units[id].worktree).toBeNull()
  // failed から pending に戻した要素の記録は消えるので、そのパスは使える
  stepUpdate(root, "1", "failed")
  stepUpdate(root, "1", "pending")
  expect(stepUpdate(root, "2", "running", ["--worktree", stepWt]).code).toBe(0)
})

// --- testEdit(設計書 §6.13.6、A6-6) ---

test("set-test-edit は fix-loop が in_progress のときだけ testEdit を真にし、ほかのフェーズでは失敗する", () => {
  const root = tmpProject()
  init(root)
  const set = () => run(root, ["set-test-edit", "--slug", "demo"])
  const refuse = (label: string) => {
    const r = set()
    expect(r.code, label).toBe(1)
    expect(r.err, label).toMatch(/fix-loop が in_progress のときだけ/)
    const st = run(root, ["get", "--slug", "demo"]).out.state
    expect("testEdit" in st, label).toBe(false)
  }
  refuse("phase null")
  run(root, ["start-phase", "intent", "--slug", "demo"])
  refuse("intent in_progress")
  passGate(root, "intent", "PROCEED")
  passThrough(root, "demo", UNTIL_REVIEW.slice(1))
  refuse("fix-loop pending")
  run(root, ["start-phase", "fix-loop", "--slug", "demo"])
  run(root, ["mark-ask", "fix-loop", "--slug", "demo", "--kind", "confirm"])
  refuse("fix-loop awaiting_human")
  run(root, ["resume", "--slug", "demo"])
  const r = set()
  expect(r.code).toBe(0)
  expect(r.out.state.testEdit).toBe(true)
  expect(run(root, ["get", "--slug", "demo"]).out.state.testEdit).toBe(true)
})

test("clear-test-edit は testEdit を消し、値が無いときも終端の run でも成功する", () => {
  const root = tmpProject()
  init(root)
  const clear = () => run(root, ["clear-test-edit", "--slug", "demo"])
  const empty = clear()
  expect(empty.code).toBe(0)
  expect("testEdit" in empty.out.state).toBe(false)
  // fix-loop まで進める代わりに state.json に直接立てる(set-test-edit の条件は上のテストで見る)
  const setDirectly = () => {
    const raw = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
    raw.testEdit = true
    fs.writeFileSync(statePath(root, "demo"), JSON.stringify(raw))
  }
  setDirectly()
  const cleared = clear()
  expect(cleared.code).toBe(0)
  expect("testEdit" in cleared.out.state).toBe(false)
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  setDirectly()
  const stopped = clear()
  expect(stopped.code).toBe(0)
  const saved = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
  expect("testEdit" in saved).toBe(false)
  expect(saved.status).toBe("stopped")
})

test("ステップの attempts はフェーズの record-attempt と独立に数える", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  const recordAttempt = ["record-attempt", "implement", "--slug", "demo"]
  expect(run(root, recordAttempt).code).toBe(0)
  expect(run(root, recordAttempt).code).toBe(0)
  stepUpdate(root, "1", "running")
  stepUpdate(root, "1", "reviewing")
  const r = stepUpdate(root, "1", "running")
  expect(r.out.state.implement.steps["1"].attempts).toBe(1)
  expect(r.out.state.phases.implement.attempts).toBe(2)
})
