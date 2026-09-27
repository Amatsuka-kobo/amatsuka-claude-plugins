import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
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
  for (const ph of ["design", "test-spec", "dev-plan"]) {
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

test("stop-guard: ブロック文言が mark-ask --kind confirm での確認を案内する(決定 52)", () => {
  const root = setupRunAtIntent()
  const result = callHook(STOP_GUARD, root)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.reason).toMatch(/mark-ask intent --slug demo --kind confirm/)
  expect(parsed.reason).toMatch(/awaiting_human/)
  expect(parsed.reason).toMatch(/start-phase/)
})
