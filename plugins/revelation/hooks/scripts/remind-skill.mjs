#!/usr/bin/env node
// PreToolUse フック: 対象ツールの初回使用前に、対応する revelation スキルが
// このセッションでまだ invoke されていなければ 1 回だけ差し戻して invoke を促す。
// 判定不能な状況ではすべて素通し(フェイルオープン)— 規律の補助でユーザーの作業を止めない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStdin, emit, pass, hasSkillInvocation } from "./lib.mjs";

const TOOL_TO_SKILL = new Map([
  ["Edit", "revelation:fable-restraint"],
  ["Write", "revelation:fable-restraint"],
  ["Task", "revelation:fable-subagents"],
  ["Agent", "revelation:fable-subagents"],
]);

try {
  const input = await readStdin();
  const skill = TOOL_TO_SKILL.get(input.tool_name);
  if (!skill) pass();

  let invoked = false;
  try {
    invoked = hasSkillInvocation(input.transcript_path, skill);
  } catch {
    pass(); // transcript が読めない → フェイルオープン
  }
  if (invoked) pass();

  const dir = process.env.REVELATION_STATE_DIR || path.join(os.tmpdir(), "revelation-remind");
  const marker = path.join(dir, `${input.session_id}-${skill.replace(/[^a-zA-Z0-9-]/g, "_")}`);
  if (fs.existsSync(marker)) pass();

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marker, "");
  emit("deny", `[revelation] このセッションではまだ ${skill} を読んでいません。先に Skill ツールで ${skill} を invoke して規律を確認してから、この操作を再試行してください(この差し戻しは 1 回だけです)。Skill ツールが使えない環境の場合は、そのまま同じ操作を再試行してください(2回目は素通しされます)。`);
} catch {
  pass();
}
