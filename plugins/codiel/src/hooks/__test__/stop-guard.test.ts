import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { readState, writeState } from "../../codiel-state.js"
import { runTs } from "../../testing/run-ts.js"

const STOP_GUARD = fileURLToPath(new URL("../stop-guard.ts", import.meta.url))
const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url))

const SLUG = "demo"
const INIT_FLAGS = [
  "--intent",
  "docs/intents/2026-09-27-demo.md",
  "--integration",
  "github",
  "--scale",
  "standard",
  "--adr-target",
  "metatron",
  "--image-upload",
  "gh-attach,chrome"
]
// discuss・design を skip-phase できるのは scale が light の run だけ(M2-FX5-B a)
const INIT_FLAGS_LIGHT = [
  "--intent",
  "docs/intents/2026-09-27-demo.md",
  "--integration",
  "github",
  "--scale",
  "light",
  "--adr-target",
  "metatron",
  "--image-upload",
  "gh-attach,chrome"
]

interface HookResult {
  stdout: string
  stderr?: string
  exitCode: number | null
}

function callHook(
  hookFile: string,
  cwd: string,
  stopHookActive = false
): HookResult {
  const input = JSON.stringify({ cwd, stop_hook_active: stopHookActive })
  try {
    const out = runTs(hookFile, [], { input })
    return { stdout: out, exitCode: 0 }
  } catch (e) {
    const error = e as {
      stdout?: string
      stderr?: string
      status?: number | null
    }
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr,
      exitCode: error.status ?? null
    }
  }
}

function cli(root: string, args: string[]): string {
  return runTs(CLI, args, { cwd: root })
}

// intent フェーズを in_progress にしたところで止める(phase=intent)
function setupRunAtIntent(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  return root
}

// implement フェーズを in_progress にしたところで止める
function setupRunAtImplement(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  const passGate = (phase: string) =>
    cli(root, [
      "pass-gate",
      phase,
      "--slug",
      SLUG,
      "--evaluation-id",
      "e",
      "--verdict",
      "PROCEED"
    ])
  passGate("intent")
  cli(root, ["start-phase", "discuss", "--slug", SLUG])
  cli(root, ["complete-phase", "discuss", "--slug", SLUG])
  for (const ph of ["design", "test-spec", "dev-plan", "test-code"]) {
    cli(root, ["start-phase", ph, "--slug", SLUG])
    passGate(ph)
  }
  cli(root, ["start-phase", "implement", "--slug", SLUG])
  return root
}

// awaiting_human 状態にする
function setupRunAwaitingHuman(): string {
  const root = setupRunAtIntent()
  cli(root, ["mark-ask", "intent", "--slug", SLUG, "--evaluation-id", "e"])
  return root
}

// intent-only の run(branch が null)で intent を passed にしたところで止める
function setupIntentOnlyPassed(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS, "--intent-only"])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  cli(root, [
    "pass-gate",
    "intent",
    "--slug",
    SLUG,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  return root
}

// --- stop-guard.mjs テスト ---

test("stop-guard: run なし → 出力なし(空 stdout)で exit 0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  const result = callHook(STOP_GUARD, root)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim()).toBe("")
})

test("stop-guard: run active(phase=intent)→ {decision:block, reason に slug と phase を含む}", () => {
  const root = setupRunAtIntent()
  const result = callHook(STOP_GUARD, root)
  expect(result.exitCode).toBe(0)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.decision).toBe("block")
  expect(parsed.reason).toMatch(/demo|try-1/)
  expect(parsed.reason).toMatch(/intent/)
})

test("stop-guard: run active(phase=implement)→ {decision:block, reason に slug と phase を含む}", () => {
  const root = setupRunAtImplement()
  const result = callHook(STOP_GUARD, root)
  expect(result.exitCode).toBe(0)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.decision).toBe("block")
  expect(parsed.reason).toMatch(/demo|try-1/)
  expect(parsed.reason).toMatch(/implement/)
})

test("stop-guard: run awaiting_human → 出力なし", () => {
  const root = setupRunAwaitingHuman()
  const result = callHook(STOP_GUARD, root)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim()).toBe("")
})

test("stop-guard: 入力に stop_hook_active: true → run active でも出力なし(無限ループ防止)", () => {
  const root = setupRunAtIntent()
  const result = callHook(STOP_GUARD, root, true)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim()).toBe("")
})

test("stop-guard: phase が in_progress のとき mark-ask --kind confirm での確認を案内する(決定 52)", () => {
  const root = setupRunAtIntent()
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(/mark-ask intent --slug demo --kind confirm/)
  expect(parsed.reason).toMatch(/awaiting_human/)
})

test("stop-guard: phase が in_progress のとき、サブエージェントの完了を待つなら委譲を前景で出し直す案内を添え、ほかの分岐には添えない(A6-28)", () => {
  for (const root of [setupRunAtIntent(), setupRunAtImplement()]) {
    const reason = JSON.parse(callHook(STOP_GUARD, root).stdout).reason
    expect(reason).toMatch(
      /サブエージェントの完了を待つなら、委譲を前景で出し直して報告を受け取ること/
    )
  }
  // phase が null の分岐と passed の分岐
  const nullPhaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(nullPhaseRoot, ["init", "--slug", SLUG, ...INIT_FLAGS])
  const passedRoot = setupRunAtIntent()
  cli(passedRoot, [
    "pass-gate",
    "intent",
    "--slug",
    SLUG,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  for (const root of [nullPhaseRoot, passedRoot])
    expect(JSON.parse(callHook(STOP_GUARD, root).stdout).reason).not.toMatch(
      /前景で/
    )
})

test("stop-guard: phase が null のとき capturing-intent の手順 5 の (6) と commit-failed での終端を案内する(M2-FX2-AR medium)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(/phase: null/)
  expect(parsed.reason).toMatch(/手順 5 の \(6\)/)
  expect(parsed.reason).toMatch(
    /codiel-state stop --slug demo --reason commit-failed/
  )
})

test("stop-guard: phase が passed のとき次に進めるフェーズの start-phase・skip-phase と mark-ask を一般的に案内する(M2-FX3-AR medium)", () => {
  const root = setupRunAtIntent()
  cli(root, [
    "pass-gate",
    "intent",
    "--slug",
    SLUG,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(/phase: intent/)
  expect(parsed.reason).toMatch(
    /codiel-state start-phase <フェーズ> --slug demo/
  )
  expect(parsed.reason).toMatch(
    /codiel-state skip-phase <フェーズ> --slug demo --reason "<理由>"/
  )
  expect(parsed.reason).toMatch(
    /mark-ask <フェーズ> --slug demo --kind confirm/
  )
  expect(parsed.reason).toMatch(/mark-ask finalize --slug demo --kind confirm/)
  expect(parsed.reason).not.toMatch(/undefined/)
})

test("stop-guard: どの分岐も codiel-state stop --reason で明示的に中止する案内を含む(M2-FX3-AR low)", () => {
  const nullPhaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(nullPhaseRoot, ["init", "--slug", SLUG, ...INIT_FLAGS])
  const nullPhaseResult = callHook(STOP_GUARD, nullPhaseRoot)
  expect(JSON.parse(nullPhaseResult.stdout).reason).toMatch(
    /codiel-state stop --slug demo --reason <理由> で明示的に止めること/
  )

  const inProgressRoot = setupRunAtIntent()
  const inProgressResult = callHook(STOP_GUARD, inProgressRoot)
  expect(JSON.parse(inProgressResult.stdout).reason).toMatch(
    /codiel-state stop --slug demo --reason <理由> で明示的に止めること/
  )

  const passedRoot = setupRunAtIntent()
  cli(passedRoot, [
    "pass-gate",
    "intent",
    "--slug",
    SLUG,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  const passedResult = callHook(STOP_GUARD, passedRoot)
  expect(JSON.parse(passedResult.stdout).reason).toMatch(
    /codiel-state stop --slug demo --reason <理由> で明示的に止めること/
  )
})

test("stop-guard: passed の案内どおりに --reason を付けて skip-phase を実行すると成功する(M2-FX5-B a)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS_LIGHT])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  cli(root, [
    "pass-gate",
    "intent",
    "--slug",
    SLUG,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  // 案内のプレースホルダに実際のフェーズ名と理由を当てはめると、書いたとおりに成功する
  expect(() =>
    cli(root, [
      "skip-phase",
      "discuss",
      "--slug",
      SLUG,
      "--reason",
      "time-constraint"
    ])
  ).not.toThrow()
})

test("stop-guard: 並列ステージで別フェーズが in_progress のとき、そのフェーズへの mark-ask を案内する(M2-FX5-B b)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  const passGate = (phase: string) =>
    cli(root, [
      "pass-gate",
      phase,
      "--slug",
      SLUG,
      "--evaluation-id",
      "e",
      "--verdict",
      "PROCEED"
    ])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  passGate("intent")
  cli(root, ["start-phase", "discuss", "--slug", SLUG])
  cli(root, ["complete-phase", "discuss", "--slug", SLUG])
  cli(root, ["start-phase", "design", "--slug", SLUG])
  passGate("design")
  // 並列ステージ(test-spec・dev-plan)のうち dev-plan だけを passed にし、
  // test-spec を in_progress のまま残す
  cli(root, ["start-phase", "test-spec", "--slug", SLUG])
  cli(root, ["start-phase", "dev-plan", "--slug", SLUG])
  passGate("dev-plan")
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(/phase: dev-plan/)
  expect(parsed.reason).toMatch(
    /codiel-state mark-ask test-spec --slug demo --kind confirm/
  )
})

test("stop-guard: finalize が passed で status が active のときは finalize の再実行を案内する(M2-FX5-B c)", () => {
  const root = setupRunAtIntent()
  const statePath = path.join(
    root,
    ".codiel",
    "runs",
    SLUG,
    "try-1",
    "state.json"
  )
  const state = readState(statePath)
  state.phase = "finalize"
  state.phases.finalize.status = "passed"
  writeState(statePath, state)
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(/codiel-state finalize --slug demo/)
})

test("stop-guard: intent-only の run(branch null)で intent が passed のときは close --reason intent-only を案内する(M2-FX5-AR medium)", () => {
  const root = setupIntentOnlyPassed()
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(
    /codiel-state close --slug demo --reason intent-only/
  )
  expect(parsed.reason).not.toMatch(/mark-ask finalize/)
  expect(parsed.reason).not.toMatch(/start-phase/)
})
