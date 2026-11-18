// guard-bash の分割したテストが共有する、フックの起動と run の組み立て
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runTs } from "../../../testing/run-ts.js"
import {
  cli,
  passGateOf,
  SLUG,
  setupRun,
  setupRunAtImplement
} from "./run-setup.js"

export const HOOK = fileURLToPath(
  new URL("../../guard-bash.ts", import.meta.url)
)

export const MARKER = "<!-- codiel:generated -->"

export const NO_MARKER_COMMENT = 'gh pr comment 1 --body "no marker"'

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny/ask など出力がある場合は hookSpecificOutput を返す。
export interface HookOutput {
  permissionDecision: string
  permissionDecisionReason: string
}

// env を渡すと、フックの環境変数に足す(RAGUEL_CONFIG を指すときに使う)
export function hook(
  cwd: string,
  command: string,
  env: Record<string, string> = {}
): HookOutput | null {
  const input = JSON.stringify({
    cwd,
    tool_name: "Bash",
    tool_input: { command }
  })
  const out = runTs(HOOK, [], { input, env: { ...process.env, ...env } })
  if (out === "") return null
  return (JSON.parse(out) as { hookSpecificOutput: HookOutput })
    .hookSpecificOutput
}

// implement・test-loop を pass-gate で通し、intent-sync を in_progress にした
// ところで止める(phase=intent-sync)。push を許すフェーズに intent-sync を
// 含めないことの確認に使う。
export function setupRunAtIntentSync(slug = SLUG): string {
  const root = setupRun(slug)
  setupRunAtImplement(root, slug)
  passGateOf(root, "implement", slug)
  cli(root, ["start-phase", "test-loop", "--slug", slug])
  passGateOf(root, "test-loop", slug)
  cli(root, ["start-phase", "intent-sync", "--slug", slug])
  return root
}

// codiel 0.x(state version 1)が書いた active run を置く。guard-bash は
// version 2 でない run を run が無いときと同じに扱う(設計書 §6.2.4)。
export function writeV1Run(root: string): void {
  const dir = path.join(root, ".codiel/runs/issue-1/try-1")
  fs.mkdirSync(dir, { recursive: true })
  const pending = {
    status: "pending",
    attempts: 0,
    evaluationId: null,
    verdict: null,
    note: null
  }
  const now = new Date().toISOString()
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      version: 1,
      runId: "issue-1",
      try: 1,
      issue: 1,
      branch: "codiel/issue-1-try-1",
      raguelRunId: "issue-1-try-1",
      status: "active",
      phase: "design",
      phases: {
        init: { ...pending, status: "passed" },
        design: { ...pending, status: "in_progress" }
      },
      pr: { url: null },
      limits: { maxFixAttempts: 5 },
      stopReason: null,
      incidents: [],
      createdAt: now,
      updatedAt: now
    })
  )
}
