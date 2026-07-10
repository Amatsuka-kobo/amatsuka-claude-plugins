import fs from "node:fs";

export async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}

export function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }) + "\n");
  process.exit(0);
}

// transcript(JSONL)に、指定スキルの Skill ツール呼び出しが記録されているか。
// 注入されたトリガー表など「テキスト中のスキル名」に誤反応しないよう、
// tool_use エントリ(name === "Skill")の input.skill だけを見る。
// ファイルが読めない場合は throw する(フェイルオープンの判断は呼び出し側)。
export function hasSkillInvocation(transcriptPath, skillName) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.includes('"Skill"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === "tool_use" && item.name === "Skill" && item.input?.skill === skillName)
        return true;
    }
  }
  return false;
}
