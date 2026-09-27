#!/usr/bin/env node
import { findActiveRun } from "../codiel-state.js"
import { findProjectRoot, readStdin } from "./lib.js"

const input = await readStdin()
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()))
  if (run && run.state.status === "active") {
    process.stdout.write(
      `${JSON.stringify({
        decision: "block",
        reason:
          `Codiel run ${run.state.runId} try-${run.state.try} が未完了です(phase: ${run.state.phase})。` +
          `フェーズを続行してください。中止する場合は codiel-state stop --reason で明示的に停止します。` +
          `人に確認して止まるときは、先に codiel-state mark-ask ${run.state.phase} --slug ${run.state.runId} --kind confirm で awaiting_human にしてから停止すること。` +
          `mark-ask が受け付けるのは in_progress のフェーズと pending の finalize だけなので、` +
          `フェーズの合間(直前のフェーズが passed で次のフェーズがまだ pending)では、次のフェーズを start-phase してから mark-ask すること。`
      })}\n`
    )
  }
}
process.exit(0)
