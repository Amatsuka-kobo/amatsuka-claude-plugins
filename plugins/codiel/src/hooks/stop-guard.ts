#!/usr/bin/env node
import { findActiveRun } from "../codiel-state.js"
import { findProjectRoot, readStdin } from "./lib.js"

const input = await readStdin()
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()))
  if (run && run.state.status === "active") {
    const { runId, try: tryN, phase } = run.state
    const header = `Codiel run ${runId} try-${tryN} が未完了です(phase: ${phase})。`
    let reason: string
    const stopHint = `中止するなら codiel-state stop --slug ${runId} --reason <理由> で明示的に止めること。`
    if (phase === null) {
      reason =
        `${header}` +
        stopHint +
        `capturing-intent の手順 5 の (6) を最後まで進めること。` +
        `git switch -c か git commit が失敗したときは、codiel-state stop --slug ${runId} --reason commit-failed で run を終端にしてから確かめること。`
    } else if (run.state.phases[phase].status === "passed") {
      // 次のフェーズは並列ステージやスキップの有無で変わり、機械的には決められない
      // (M2-FX3-AR medium)。フェーズ名を決め打ちせず、手順の一般則(決定 61・§6.1.1)を示す。
      reason =
        `${header}` +
        stopHint +
        `次に進めるフェーズを codiel-state start-phase <フェーズ> --slug ${runId} で開始してから` +
        `(スキップするフェーズなら先に codiel-state skip-phase <フェーズ> --slug ${runId} で飛ばしてから)、` +
        `codiel-state mark-ask <フェーズ> --slug ${runId} --kind confirm で awaiting_human にしてから停止すること。` +
        `finalize へ進むときは start-phase を使わず、codiel-state mark-ask finalize --slug ${runId} --kind confirm で直接 awaiting_human にすること。`
    } else {
      reason =
        `${header}` +
        stopHint +
        `人に確認して止まるときは codiel-state mark-ask ${phase} --slug ${runId} --kind confirm で awaiting_human にしてから停止すること。`
    }
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`)
  }
}
process.exit(0)
