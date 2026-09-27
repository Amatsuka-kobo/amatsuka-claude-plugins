#!/usr/bin/env node
import { findActiveRun, PHASES } from "../codiel-state.js"
import { findProjectRoot, readStdin } from "./lib.js"

const input = await readStdin()
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()))
  if (run && run.state.status === "active") {
    const { runId, try: tryN, phase } = run.state
    const header = `Codiel run ${runId} try-${tryN} が未完了です(phase: ${phase})。`
    let reason: string
    if (phase === null) {
      reason =
        `${header}` +
        `capturing-intent の手順 5 の (6) を最後まで進めること。` +
        `git switch -c か git commit が失敗したときは、codiel-state stop --slug ${runId} --reason commit-failed で run を終端にしてから確かめること。`
    } else if (run.state.phases[phase].status === "passed") {
      const next = PHASES[PHASES.indexOf(phase) + 1]
      reason =
        `${header}` +
        `次のフェーズ ${next} を codiel-state start-phase ${next} --slug ${runId} で開始し、` +
        `人に確認して止まるときは codiel-state mark-ask ${next} --slug ${runId} --kind confirm で awaiting_human にしてから停止すること。`
    } else {
      reason =
        `${header}` +
        `人に確認して止まるときは codiel-state mark-ask ${phase} --slug ${runId} --kind confirm で awaiting_human にしてから停止すること。`
    }
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`)
  }
}
process.exit(0)
