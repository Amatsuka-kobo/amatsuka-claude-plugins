import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  expandBraces,
  globsOverlap,
  planWaves,
  type StepState
} from "../codiel-state.js"
import {
  init,
  run,
  specAdd,
  statePath,
  stepAdd,
  tmpProject
} from "./helpers/codiel-state-fixtures.js"

// planWaves に渡すステップを組み立てる。files 以外は省略時に既定値を入れる
function stepsOf(
  spec: Record<string, { files: string[]; deps?: string[]; final?: boolean }>
): Record<string, StepState> {
  const out: Record<string, StepState> = {}
  for (const [id, s] of Object.entries(spec))
    out[id] = {
      status: "pending",
      files: s.files,
      deps: s.deps ?? [],
      final: s.final ?? false,
      group: null,
      worktree: null,
      branch: null,
      commits: { base: null, head: null },
      attempts: 0,
      domain: null
    }
  return out
}

test("waves は groups と final の JSON を出し、各ステップの group を記録し、test-code と test-loop の要素を出さない", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  stepAdd(root, "2", ["src/b/**"])
  stepAdd(root, "3", ["pnpm-lock.yaml", "package.json"], ["1"])
  stepAdd(root, "4", ["src/c/**"], ["3"])
  const all = ["1", "2", "3", "4"]
  stepAdd(root, "5", ["plugins/*/scripts/**"], all, ["--final"])
  specAdd(root, "test-code", "units/src/z.ts")
  specAdd(root, "test-loop", "e2e/cli/codiel-state", [
    "--files",
    '["src/z/**"]'
  ])
  const r = run(root, ["waves", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out).toStrictEqual({
    groups: [
      { steps: ["1", "2"], mode: "parallel" },
      { steps: ["3"], mode: "serial" },
      { steps: ["4"], mode: "parallel" }
    ],
    final: ["5"]
  })
  const st = run(root, ["get", "--slug", "demo"]).out.state
  const groupOf = (id: string) => st.implement.steps[id].group
  expect(groupOf("1")).toStrictEqual({ index: 0, mode: "parallel" })
  expect(groupOf("2")).toStrictEqual({ index: 0, mode: "parallel" })
  expect(groupOf("3")).toStrictEqual({ index: 1, mode: "serial" })
  expect(groupOf("4")).toStrictEqual({ index: 2, mode: "parallel" })
  expect(groupOf("5")).toStrictEqual({ index: 0, mode: "final" })
  expect(st.testCode.units["units/src/z.ts"].group).toBeNull()
  expect(st.testLoop.units["e2e/cli/codiel-state"].group).toBeNull()
  expect(st.version).toBe(2)
})

test("waves は循環依存で非ゼロ終了し、group を記録しない", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"], ["2"])
  stepAdd(root, "2", ["src/b/**"], ["1"])
  stepAdd(root, "3", ["src/c/**"])
  const r = run(root, ["waves", "--slug", "demo"])
  expect(r.code).not.toBe(0)
  expect(r.err).toContain("循環依存")
  const st = run(root, ["get", "--slug", "demo"]).out.state
  for (const id of ["1", "2", "3"])
    expect(st.implement.steps[id].group).toBeNull()
})

test("planWaves は groups をトポロジカル順に並べ、前提を含むグループより後に置く", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/a/**"] },
      "2": { files: ["src/b/**"], deps: ["1"] },
      "3": { files: ["src/c/**"], deps: ["2"] },
      "4": { files: ["src/d/**"] }
    })
  )
  expect(plan).toStrictEqual({
    groups: [
      { steps: ["1", "4"], mode: "parallel" },
      { steps: ["2"], mode: "parallel" },
      { steps: ["3"], mode: "parallel" }
    ],
    final: []
  })
})

test("planWaves は循環依存・自己依存・未登録の前提で例外を投げる", () => {
  expect(() =>
    planWaves(
      stepsOf({
        "1": { files: ["a/**"], deps: ["3"] },
        "2": { files: ["b/**"], deps: ["1"] },
        "3": { files: ["c/**"], deps: ["2"] }
      })
    )
  ).toThrow("循環依存")
  expect(() =>
    planWaves(stepsOf({ "1": { files: ["a/**"], deps: ["1"] } }))
  ).toThrow("循環依存")
  expect(() =>
    planWaves(stepsOf({ "1": { files: ["a/**"], deps: ["9"] } }))
  ).toThrow("登録されていません")
})

test("planWaves は触るファイルが重なりうるステップを同じグループに入れない", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/app/**"] },
      "2": { files: ["src/app/x.ts"] },
      "3": { files: ["src/lib/**"] },
      "4": { files: ["src/lib/util.ts", "docs/a.md"] }
    })
  )
  expect(plan.groups).toStrictEqual([
    { steps: ["1", "3"], mode: "parallel" },
    { steps: ["2", "4"], mode: "parallel" }
  ])
})

test("planWaves は lockfile を触るステップを単独の serial グループにして依存順の位置に置き、その後続を後のグループに出す", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/a/**"] },
      "2": { files: ["Cargo.lock"] },
      "3": { files: ["src/b/**"] },
      "4": { files: ["packages/web/yarn.lock"], deps: ["1"] },
      "5": { files: ["src/c/**"], deps: ["4"] },
      "6": { files: ["src/d/**"] }
    })
  )
  expect(plan.groups).toStrictEqual([
    { steps: ["1", "3", "6"], mode: "parallel" },
    { steps: ["2"], mode: "serial" },
    { steps: ["4"], mode: "serial" },
    { steps: ["5"], mode: "parallel" }
  ])
})

test("planWaves は計画書 §6.3 の 12 種の lockfile をファイル名の完全一致で判定する", () => {
  const names = [
    "pnpm-lock.yaml",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
    "Cargo.lock",
    "poetry.lock",
    "uv.lock",
    "Gemfile.lock",
    "composer.lock",
    "go.sum"
  ]
  for (const name of names) {
    const plan = planWaves(
      stepsOf({ "1": { files: [`sub/${name}`] }, "2": { files: ["src/**"] } })
    )
    expect(plan.groups[0], name).toStrictEqual({ steps: ["1"], mode: "serial" })
  }
  // 完全一致でないファイル名は lockfile ではない
  const plan = planWaves(
    stepsOf({
      "1": { files: ["x/pnpm-lock.yaml.bak"] },
      "2": { files: ["y/my-go.sum"] }
    })
  )
  expect(plan.groups).toStrictEqual([{ steps: ["1", "2"], mode: "parallel" }])
})

test("planWaves は --final のステップを final にだけ出す", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/a/**"] },
      "2": { files: ["src/b/**"] },
      "3": { files: ["plugins/*/scripts/**"], deps: ["1", "2"], final: true }
    })
  )
  expect(plan).toStrictEqual({
    groups: [{ steps: ["1", "2"], mode: "parallel" }],
    final: ["3"]
  })
  // 通常のステップは最終ステップを前提にできない
  expect(() =>
    planWaves(
      stepsOf({
        "1": { files: ["a/**"], final: true },
        "2": { files: ["b/**"], deps: ["1"] }
      })
    )
  ).toThrow("最終ステップ")
})

test("planWaves は parallel グループを 4 件までにし、超える分を次のグループへ送る", () => {
  const spec: Record<string, { files: string[] }> = {}
  for (let i = 1; i <= 9; i++) spec[String(i)] = { files: [`src/s${i}/**`] }
  expect(planWaves(stepsOf(spec)).groups).toStrictEqual([
    { steps: ["1", "2", "3", "4"], mode: "parallel" },
    { steps: ["5", "6", "7", "8"], mode: "parallel" },
    { steps: ["9"], mode: "parallel" }
  ])
})

test("重なりの判定: src/app/** と src/apple/** は重ならない", () => {
  expect(globsOverlap("src/app/**", "src/apple/**")).toBe(false)
  expect(globsOverlap("src/app/**", "src/app/x.ts")).toBe(true)
  expect(globsOverlap("src/a.ts", "src/b.ts")).toBe(false)
  expect(globsOverlap("./src/a/**", "src/a/x.ts")).toBe(true)
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/app/**"] },
      "2": { files: ["src/apple/**"] }
    })
  )
  expect(plan.groups).toStrictEqual([{ steps: ["1", "2"], mode: "parallel" }])
})

test("重なりの判定: src/{a,b}/** は展開されて src/a/x.ts と重なる", () => {
  expect(expandBraces("src/{a,b}/**")).toStrictEqual(["src/a/**", "src/b/**"])
  expect(expandBraces("{src,lib/{x,y}}/*.ts")).toStrictEqual([
    "src/*.ts",
    "lib/x/*.ts",
    "lib/y/*.ts"
  ])
  expect(globsOverlap("src/{a,b}/**", "src/a/x.ts")).toBe(true)
  expect(globsOverlap("src/{a,b}/**", "src/c/x.ts")).toBe(false)
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/{a,b}/**"] },
      "2": { files: ["src/a/x.ts"] }
    })
  )
  expect(plan.groups).toStrictEqual([
    { steps: ["1"], mode: "parallel" },
    { steps: ["2"], mode: "parallel" }
  ])
})

test("重なりの判定: 固定部が空の *.ts と **/* は全ステップと重なる", () => {
  for (const g of ["*.ts", "**/*"]) {
    expect(globsOverlap(g, "docs/a.md"), g).toBe(true)
    expect(globsOverlap("src/x/y.ts", g), g).toBe(true)
    const plan = planWaves(
      stepsOf({
        "1": { files: ["src/a/**"] },
        "2": { files: [g] },
        "3": { files: ["docs/**"] }
      })
    )
    expect(plan.groups, g).toStrictEqual([
      { steps: ["1", "3"], mode: "parallel" },
      { steps: ["2"], mode: "parallel" }
    ])
  }
})

// テストヘルパー

const waitReportPath = (root: string, id: string, tryN = 1): string =>
  path.join(path.dirname(statePath(root, "demo", tryN)), "waits", `${id}.md`)

function writeWaitReport(root: string, id: string): void {
  const p = waitReportPath(root, id)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, "返答\n")
}

function waitAdd(root: string, id: string, extra: string[] = []) {
  return run(root, [
    "wait-add",
    "--slug",
    "demo",
    "--id",
    id,
    "--purpose",
    "spec を書く",
    ...extra
  ])
}

test("wait-add は waits に 1 件足し、phase と startedAt と taskId を記録する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const r = waitAdd(root, "test-spec-units-a-1", ["--task-id", "t-9"])
  expect(r.code).toBe(0)
  const [w] = r.out.state.waits
  expect(w).toMatchObject({
    id: "test-spec-units-a-1",
    purpose: "spec を書く",
    phase: "intent",
    taskId: "t-9"
  })
  expect(Number.isNaN(Date.parse(w.startedAt))).toBe(false)
  expect(r.out.state.version).toBe(2)
  const second = waitAdd(root, "gate-intent-1")
  expect(second.out.state.waits.map((x: { id: string }) => x.id)).toEqual([
    "test-spec-units-a-1",
    "gate-intent-1"
  ])
  expect("taskId" in second.out.state.waits[1]).toBe(false)
})

test("wait-add は残っている同じ id・報告のある id・不正な id・終端の run を拒否する", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  const dup = waitAdd(root, "a-1")
  expect(dup.code).toBe(1)
  expect(dup.err).toMatch(/すでに残っています/)
  writeWaitReport(root, "b-1")
  const used = waitAdd(root, "b-1")
  expect(used.code).toBe(1)
  expect(used.err).toMatch(/使い回さない/)
  for (const bad of ["../x", "a/b", "A", "a_b", ""]) {
    const r = waitAdd(root, bad)
    expect(r.code, bad).toBe(1)
  }
  const long = waitAdd(root, "a".repeat(101))
  expect(long.code).toBe(1)
  expect(long.err).toMatch(/不正な --id/)
  expect(waitAdd(root, "a".repeat(100)).code).toBe(0)
  expect(run(root, ["wait-add", "--slug", "demo", "--id", "c-1"]).err).toMatch(
    /--purpose が必要です/
  )
  run(root, ["stop", "--slug", "demo", "--abandon-waits"])
  const term = waitAdd(root, "d-1")
  expect(term.code).toBe(1)
  expect(term.err).toMatch(/すでに終端状態です/)
})

test("wait-done は報告のファイルがあるときだけ待ちを消し、無い id と報告の無い待ちは失敗する", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  const noReport = run(root, ["wait-done", "--slug", "demo", "--id", "a-1"])
  expect(noReport.code).toBe(1)
  expect(noReport.err).toMatch(/waits\/a-1\.md がありません/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.waits).toHaveLength(1)
  writeWaitReport(root, "a-1")
  const done = run(root, ["wait-done", "--slug", "demo", "--id", "a-1"])
  expect(done.code).toBe(0)
  expect(done.out.state.waits).toEqual([])
  const none = run(root, ["wait-done", "--slug", "demo", "--id", "a-1"])
  expect(none.code).toBe(1)
  expect(none.err).toMatch(/待ち a-1 はありません/)
})

test("wait-done は不正な id を、待ちの有無の判定より先に拒否する", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["wait-done", "--slug", "demo", "--id", "../x"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正な --id/)
})

test("wait-clear は残りを出力して空にし、終端の run でも通る", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  waitAdd(root, "a-2")
  const r = run(root, ["wait-clear", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.cleared.map((w: { id: string }) => w.id)).toEqual(["a-1", "a-2"])
  expect(r.out.state.waits).toEqual([])
  waitAdd(root, "a-3")
  run(root, ["stop", "--slug", "demo", "--abandon-waits"])
  expect(run(root, ["wait-clear", "--slug", "demo"]).code).toBe(0)
})

test("stop は待ちが残っていると失敗し、--abandon-waits を付けたときだけ空にして止める", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  const r = run(root, ["stop", "--slug", "demo", "--reason", "x"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/待ちが残っています: a-1/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
  const ok = run(root, [
    "stop",
    "--slug",
    "demo",
    "--reason",
    "x",
    "--abandon-waits"
  ])
  expect(ok.code).toBe(0)
  expect(ok.out.state.status).toBe("stopped")
  expect("waits" in ok.out.state).toBe(false)
})

test("waits を持たない state でも get と stop が動く", () => {
  const root = tmpProject()
  init(root)
  expect("waits" in run(root, ["get", "--slug", "demo"]).out.state).toBe(false)
  expect(run(root, ["stop", "--slug", "demo"]).code).toBe(0)
})
