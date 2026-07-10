import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const HOOK = new URL("./inject-trigger-map.mjs", import.meta.url).pathname;

test("トリガー表が SessionStart の additionalContext として出力される", () => {
  const out = execFileSync("node", [HOOK], { input: "{}", encoding: "utf8" });
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.hookEventName, "SessionStart");
  for (const s of ["revelation:fable-method", "revelation:fable-restraint", "revelation:fable-subagents"])
    assert.ok(o.additionalContext.includes(s), `${s} がトリガー表に含まれること`);
});
