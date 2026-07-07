#!/usr/bin/env node
import { readStdin, findProjectRoot } from "./lib.mjs";
import { findActiveRun } from "../../scripts/codiel-state.mjs";

const input = await readStdin();
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd));
  if (run && run.state.status === "active") {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `Codiel run ${run.state.runId} try-${run.state.try} が未完了です(phase: ${run.state.phase})。` +
        `フェーズを続行してください。中止する場合は codiel-state stop --reason で明示的に停止します。`,
    }) + "\n");
  }
}
process.exit(0);
