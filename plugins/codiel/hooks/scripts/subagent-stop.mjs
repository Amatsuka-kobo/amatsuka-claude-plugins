#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readStdin, findProjectRoot } from "./lib.mjs";
import { findActiveRun } from "../../scripts/codiel-state.mjs";

const ARTIFACTS = { init: "issue.md", design: "design.md", "dev-plan": "dev-plan.md" };
const input = await readStdin();
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd));
  const phase = run?.state?.phase;
  if (run && run.state.status === "active" && ARTIFACTS[phase]
      && run.state.phases[phase]?.status === "in_progress") {
    const artifact = path.join(run.dir, ARTIFACTS[phase]);
    if (!fs.existsSync(artifact) || fs.statSync(artifact).size === 0) {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: `フェーズ ${phase} の成果物 ${ARTIFACTS[phase]} が ${run.dir} にありません。成果物を書き出してから完了してください。`,
      }) + "\n");
    }
  }
}
process.exit(0);
