import fs from "node:fs"
import { expect, test } from "vitest"
import {
  init,
  passThrough,
  run,
  statePath,
  tmpProject,
  UNTIL_PR
} from "./helpers/codiel-state-fixtures.js"

test("init --intent-only の run は branch が null で、intent の pass-gate の後に close で completed になる", () => {
  const root = tmpProject()
  const created = init(root, "demo", {}, ["--intent-only"])
  expect(created.code).toBe(0)
  expect(created.out.state.branch).toBeNull()
  expect(created.out.state.raguelRunId).toBe("demo-try-1")
  passThrough(root, "demo", ["intent"])
  const r = run(root, ["close", "--slug", "demo", "--reason", "intent-only"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("completed")
  expect(r.out.state.stopReason).toBe("intent-only")
  expect(r.out.state.phase).toBe("intent")
  const again = run(root, [
    "close",
    "--slug",
    "demo",
    "--reason",
    "intent-only"
  ])
  expect(again.code).toBe(1)
  expect(again.err).toMatch(/すでに終端状態です/)
})

test("branch が null の run では intent 以外の start-phase が失敗する", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--intent-only"])
  const before = run(root, ["start-phase", "discuss", "--slug", "demo"])
  expect(before.code).toBe(1)
  expect(before.err).toMatch(/branch が null/)
  passThrough(root, "demo", ["intent"])
  const after = run(root, ["start-phase", "discuss", "--slug", "demo"])
  expect(after.code).toBe(1)
  expect(after.err).toMatch(/branch が null/)
  expect(
    run(root, ["get", "--slug", "demo"]).out.state.phases.discuss.status
  ).toBe("pending")
})

test("branch が null の run では skip-phase が失敗し、close できる状態を保つ", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" }, ["--intent-only"])
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
    expect(r.code, ph).toBe(1)
    expect(r.err, ph).toMatch(/branch が null/)
  }
  expect(
    run(root, ["get", "--slug", "demo"]).out.state.phases.discuss.status
  ).toBe("pending")
  expect(run(root, ["close", "--slug", "demo"]).code).toBe(0)
})

test("close は intent が passed でないと失敗する", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--intent-only"])
  const pending = run(root, ["close", "--slug", "demo"])
  expect(pending.code).toBe(1)
  expect(pending.err).toMatch(/intent が passed ではありません/)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const inProgress = run(root, ["close", "--slug", "demo"])
  expect(inProgress.code).toBe(1)
  expect(inProgress.err).toMatch(/intent が passed ではありません/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
})

test("close は branch が null でない run では失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  const r = run(root, ["close", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/branch が null の run/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
})

test("close は intent 以外のフェーズが pending でないと失敗する", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" }, ["--intent-only"])
  passThrough(root, "demo", ["intent"])
  // branch が null の run は CLI では discuss を動かせない(start-phase も skip-phase も拒否する)
  // ので、state.json を直接書き換えて close の検査だけを確かめる
  const raw = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
  raw.phases.discuss.status = "passed"
  fs.writeFileSync(statePath(root, "demo"), `${JSON.stringify(raw, null, 2)}\n`)
  const r = run(root, ["close", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/フェーズ discuss が pending ではありません/)
})

// --- pr と finalize ---

test("github の run では pr フェーズの complete-phase に --pr-url が必要である", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR)
  run(root, ["start-phase", "pr", "--slug", "demo"])
  const noUrl = run(root, ["complete-phase", "pr", "--slug", "demo"])
  expect(noUrl.code).toBe(1)
  expect(noUrl.err).toMatch(/--pr-url が必要です/)
  const r = run(root, [
    "complete-phase",
    "pr",
    "--slug",
    "demo",
    "--pr-url",
    "https://example.test/pr/1"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.pr.url).toBe("https://example.test/pr/1")
})

test("local の run では --pr-url なしで complete-phase pr が成功し、pr.url は null のまま", () => {
  const root = tmpProject()
  init(root, "demo", { integration: "local", "image-upload": "none" })
  passThrough(root, "demo", UNTIL_PR)
  run(root, ["start-phase", "pr", "--slug", "demo"])
  const r = run(root, ["complete-phase", "pr", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.pr.status).toBe("passed")
  expect(r.out.state.pr.url).toBeNull()
})
