#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { findActiveRun } from "../codiel-state.js"
import { findProjectRoot, readStdin } from "./lib.js"

const ARTIFACTS: Record<string, string> = {
  init: "issue.md",
  discuss: "agenda.md",
  design: "design.md",
  "dev-plan": "dev-plan.md"
}
const input = await readStdin()
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()))
  if (run && run.state.status === "active") {
    const inProgressPhases = Object.entries(run.state.phases)
      .filter(([, ph]) => ph.status === "in_progress")
      .map(([name]) => name)
    // test-spec/dev-plan のような並列ステージで複数フェーズが同時に in_progress の場合、
    // Stop したのがどのサブエージェントか(=どのフェーズの担当か)を一意に識別できない。
    // 誤って無関係なフェーズの成果物欠如で block してしまうことを避けるため、
    // in_progress が2つ以上あるときは検査そのものをスキップする。1つだけなら
    // 従来どおりその in_progress フェーズの成果物を検査する。
    if (inProgressPhases.length === 1) {
      const phase = inProgressPhases[0]
      if (ARTIFACTS[phase]) {
        const artifact = path.join(run.dir, ARTIFACTS[phase])
        if (!fs.existsSync(artifact) || fs.statSync(artifact).size === 0) {
          process.stdout.write(
            `${JSON.stringify({
              decision: "block",
              reason: `フェーズ ${phase} の成果物 ${ARTIFACTS[phase]} が ${run.dir} にありません。成果物を書き出してから完了してください。`
            })}\n`
          )
        }
      }
    }
  }
}
process.exit(0)
