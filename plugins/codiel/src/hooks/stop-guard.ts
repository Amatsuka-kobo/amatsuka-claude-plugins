#!/usr/bin/env node
import { findActiveRun, STAGES } from "../codiel-state.js"
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
      if (phase === "finalize") {
        // finalize は自分自身の状態を検査しないので、通常の手順では起きないが
        // (phases.finalize が passed のまま status が active に残る状態)、
        // 再実行すれば awaiting_outcome に戻せる(M2-FX5-B c)。
        reason =
          `${header}` +
          stopHint +
          `finalize は完了済みだが run が active のまま残っている。codiel-state finalize --slug ${runId} を実行し直して awaiting_outcome にしてから停止すること。`
      } else {
        // 次のフェーズは並列ステージやスキップの有無で変わり、機械的には決められない
        // (M2-FX3-AR medium)。フェーズ名を決め打ちせず、手順の一般則(決定 61・§6.1.1)を示す。
        const stage = STAGES.find((s) => s.includes(phase)) ?? []
        const inProgressSibling = stage.find(
          (p) => p !== phase && run.state.phases[p].status === "in_progress"
        )
        reason =
          `${header}` +
          stopHint +
          `次に進めるフェーズを codiel-state start-phase <フェーズ> --slug ${runId} で開始してから` +
          `(スキップするフェーズなら先に codiel-state skip-phase <フェーズ> --slug ${runId} --reason "<理由>" で飛ばしてから)、` +
          `codiel-state mark-ask <フェーズ> --slug ${runId} --kind confirm で awaiting_human にしてから停止すること。` +
          `finalize へ進むときは start-phase を使わず、codiel-state mark-ask finalize --slug ${runId} --kind confirm で直接 awaiting_human にすること。` +
          (inProgressSibling
            ? `同じステージの ${inProgressSibling} が in_progress のまま残っているなら、次のフェーズへ進む前に codiel-state mark-ask ${inProgressSibling} --slug ${runId} --kind confirm で確認すること(M2-FX5-B b)。`
            : "")
      }
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
