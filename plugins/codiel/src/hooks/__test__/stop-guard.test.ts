import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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
  "--knowledge-target",
  "metatron",
  "--adr-candidates",
  "on",
  "--gotcha-candidates",
  "on",
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
  "--knowledge-target",
  "metatron",
  "--adr-candidates",
  "on",
  "--gotcha-candidates",
  "on",
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
  return runTs(CLI, args, {
    cwd: root,
    env: {
      ...process.env,
      RAGUEL_CONFIG: path.join(root, ".raguel", "config.json")
    }
  })
}

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
    { cwd: root, encoding: "utf8" }
  ).trim()
}

// git のリポジトリ(空のコミット 1 つ)にし、Raguel の記録の置き場を root の中へ向ける。
// code 系フェーズの start-phase が HEAD を読み、pass-gate と mark-ask が Raguel の記録を読むため
function newRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"))
  git(root, "init", "-q")
  git(root, "commit", "-q", "--allow-empty", "-m", "init")
  fs.mkdirSync(path.join(root, ".raguel"))
  fs.writeFileSync(
    path.join(root, ".raguel", "config.json"),
    JSON.stringify({
      storage: { casesDir: path.join(root, ".raguel"), projectId: "demo" }
    })
  )
  return root
}

// pass-gate の検査 9 が文書のフェーズに期待するファイル(既定の runsDir と testsDir)
const DOC_FILE: Record<string, string> = {
  design: `docs/codiel/runs/${SLUG}/design.md`,
  "dev-plan": `docs/codiel/runs/${SLUG}/dev-plan.md`,
  "test-spec": "docs/codiel/tests/units/demo/spec.md"
}

// 文書のフェーズでは、期待するファイルを評価したことにする。ファイルが無ければ sha256 は null
function docFiles(root: string, phase: string) {
  const rel = DOC_FILE[phase]
  if (!rel) return []
  const abs = path.join(root, rel)
  const sha256 = fs.existsSync(abs)
    ? createHash("sha256").update(fs.readFileSync(abs)).digest("hex")
    : null
  return [{ path: rel, sha256, isNew: true }]
}

// Raguel が書く形で、評価 "e" の索引の行と verdict.json を置く
function recordEvaluation(root: string, phase: string, verdict: string): void {
  const stateFile = path.join(
    root,
    ".codiel",
    "runs",
    SLUG,
    "try-1",
    "state.json"
  )
  const st = readState(stateFile)
  const head = git(root, "rev-parse", "HEAD")
  const isCode = phase === "test-code"
  const dir = path.join(root, ".raguel", "cases", "demo")
  const casePath = path.join(dir, st.raguelRunId, phase, "attempt-01")
  fs.mkdirSync(casePath, { recursive: true })
  const row = {
    schemaVersion: 2,
    evaluationId: "e",
    runId: st.raguelRunId,
    phase,
    kind: isCode ? "code" : "design",
    attempt: 1,
    casePath,
    verdict,
    judgeStatus: "ok",
    head,
    at: new Date().toISOString()
  }
  const subject = {
    repoPath: root,
    head,
    ...(isCode ? { base: st.phases[phase]?.startHead ?? null } : {}),
    files: docFiles(root, phase)
  }
  fs.writeFileSync(
    path.join(casePath, "verdict.json"),
    JSON.stringify({ ...row, subject })
  )
  fs.appendFileSync(
    path.join(dir, "evaluations.jsonl"),
    `${JSON.stringify(row)}\n`
  )
}

// 評価 "e" を記録してから PROCEED で pass-gate を通す
function passGate(root: string, phase: string): string {
  recordEvaluation(root, phase, "PROCEED")
  return cli(root, [
    "pass-gate",
    phase,
    "--slug",
    SLUG,
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
}

// intent フェーズを in_progress にしたところで止める(phase=intent)
function setupRunAtIntent(): string {
  const root = newRoot()
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  return root
}

// implement フェーズを in_progress にしたところで止める
function setupRunAtImplement(): string {
  const root = newRoot()
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  passGate(root, "intent")
  cli(root, ["start-phase", "discuss", "--slug", SLUG])
  cli(root, ["complete-phase", "discuss", "--slug", SLUG])
  for (const ph of ["design", "test-spec", "dev-plan", "test-code"]) {
    cli(root, ["start-phase", ph, "--slug", SLUG])
    passGate(root, ph)
  }
  cli(root, ["start-phase", "implement", "--slug", SLUG])
  return root
}

// awaiting_human 状態にする
function setupRunAwaitingHuman(): string {
  const root = setupRunAtIntent()
  recordEvaluation(root, "intent", "ASK")
  cli(root, ["mark-ask", "intent", "--slug", SLUG, "--evaluation-id", "e"])
  return root
}

// intent-only の run(branch が null)で intent を passed にしたところで止める
function setupIntentOnlyPassed(): string {
  const root = newRoot()
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS, "--intent-only"])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  passGate(root, "intent")
  return root
}

// --- stop-guard.mjs テスト ---

test("stop-guard: run なし → 出力なし(空 stdout)で exit 0", () => {
  const root = newRoot()
  const result = callHook(STOP_GUARD, root)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim()).toBe("")
})

test("stop-guard: 壊れた state があっても停止を block せず exit 0", () => {
  const root = newRoot()
  const broken = path.join(root, ".codiel", "runs", "broken", "try-1")
  fs.mkdirSync(broken, { recursive: true })
  fs.writeFileSync(path.join(broken, "state.json"), "{ not json")
  const result = callHook(STOP_GUARD, root)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim()).toBe("")
})

test("stop-guard: 判定の途中で例外が出ても停止を block せず exit 0", () => {
  const root = setupRunAtIntent()
  const p = path.join(root, ".codiel", "runs", SLUG, "try-1", "state.json")
  const st = readState(p)
  // phases に無いフェーズを指す state。phases[phase].status の読み取りで例外になる
  st.phase = "no-such-phase" as typeof st.phase
  writeState(p, st)
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

test("stop-guard: phase が in_progress のとき、委譲の完了を待つなら wait-add で待ちを記録する案内を添え、ほかの分岐には添えない", () => {
  for (const root of [setupRunAtIntent(), setupRunAtImplement()]) {
    const reason = JSON.parse(callHook(STOP_GUARD, root).stdout).reason
    expect(reason).toMatch(
      /委譲の完了を待つなら、codiel-state wait-add で待ちを記録してから停止すること/
    )
    expect(reason).not.toMatch(/前景/)
  }
  // phase が null の分岐と passed の分岐
  const nullPhaseRoot = newRoot()
  cli(nullPhaseRoot, ["init", "--slug", SLUG, ...INIT_FLAGS])
  const passedRoot = setupRunAtIntent()
  passGate(passedRoot, "intent")
  for (const root of [nullPhaseRoot, passedRoot])
    expect(JSON.parse(callHook(STOP_GUARD, root).stdout).reason).not.toMatch(
      /wait-add/
    )
})

test("stop-guard: waits が 1 件以上あるときは何も出さず、空に戻すと止める", () => {
  const root = setupRunAtIntent()
  cli(root, ["wait-add", "--slug", SLUG, "--id", "w-1", "--purpose", "p"])
  const held = callHook(STOP_GUARD, root)
  expect(held.exitCode).toBe(0)
  expect(held.stdout.trim()).toBe("")
  cli(root, ["wait-clear", "--slug", SLUG])
  expect(JSON.parse(callHook(STOP_GUARD, root).stdout).decision).toBe("block")
})

test("stop-guard: phase が null のとき capturing-intent の手順 5 の (6) と commit-failed での終端を案内する(M2-FX2-AR medium)", () => {
  const root = newRoot()
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
  passGate(root, "intent")
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
  const nullPhaseRoot = newRoot()
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
  passGate(passedRoot, "intent")
  const passedResult = callHook(STOP_GUARD, passedRoot)
  expect(JSON.parse(passedResult.stdout).reason).toMatch(
    /codiel-state stop --slug demo --reason <理由> で明示的に止めること/
  )
})

test("stop-guard: passed の案内どおりに --reason を付けて skip-phase を実行すると成功する(M2-FX5-B a)", () => {
  const root = newRoot()
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS_LIGHT])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  passGate(root, "intent")
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
  const root = newRoot()
  cli(root, ["init", "--slug", SLUG, ...INIT_FLAGS])
  cli(root, ["start-phase", "intent", "--slug", SLUG])
  passGate(root, "intent")
  cli(root, ["start-phase", "discuss", "--slug", SLUG])
  cli(root, ["complete-phase", "discuss", "--slug", SLUG])
  cli(root, ["start-phase", "design", "--slug", SLUG])
  passGate(root, "design")
  // 並列ステージ(test-spec・dev-plan)のうち dev-plan だけを passed にし、
  // test-spec を in_progress のまま残す
  cli(root, ["start-phase", "test-spec", "--slug", SLUG])
  cli(root, ["start-phase", "dev-plan", "--slug", SLUG])
  passGate(root, "dev-plan")
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
