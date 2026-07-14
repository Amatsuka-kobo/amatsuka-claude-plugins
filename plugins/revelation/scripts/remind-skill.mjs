#!/usr/bin/env node

// src/remind-skill.ts
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/lib.ts
import fs from "node:fs";
import path from "node:path";
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}
function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    }) + "\n"
  );
  process.exit(0);
}
function pass() {
  process.exit(0);
}
function hasSkillInvocation(transcriptPath, skillName) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.includes('"Skill"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === "tool_use" && item.name === "Skill" && item.input?.skill === skillName)
        return true;
    }
  }
  return false;
}
function hasSkillFileRead(transcriptPath, skillName) {
  const suffix = `skills/${skillName.split(":")[1]}/SKILL.md`;
  const raw = fs.readFileSync(transcriptPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.includes('"Read"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === "tool_use" && item.name === "Read" && typeof item.input?.file_path === "string" && item.input.file_path.endsWith(suffix))
        return true;
    }
  }
  return false;
}
function subagentTranscriptPath(mainTranscriptPath, sessionId, agentId) {
  return path.join(
    path.dirname(mainTranscriptPath),
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`
  );
}
function lastAssistantModel(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  let model = null;
  for (const line of raw.split("\n")) {
    if (!line.includes('"model"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.type === "assistant" && typeof e?.message?.model === "string")
      model = e.message.model;
  }
  return model;
}

// src/remind-skill.ts
var TOOL_TO_SKILL = /* @__PURE__ */ new Map([
  ["Edit", "revelation:fable-restraint"],
  ["Write", "revelation:fable-restraint"],
  ["Task", "revelation:fable-subagents"],
  ["Agent", "revelation:fable-subagents"]
]);
var SKIP_AGENT_TYPES = /* @__PURE__ */ new Set(["task-utility:chat-recorder"]);
var PLUGIN_ROOT = path2.resolve(
  path2.dirname(fileURLToPath(import.meta.url)),
  ".."
);
var skillMdPath = (skill) => path2.join(PLUGIN_ROOT, "skills", skill.split(":")[1], "SKILL.md");
try {
  const input = await readStdin();
  const skill = TOOL_TO_SKILL.get(input.tool_name ?? "");
  if (!skill) pass();
  const agentId = typeof input.agent_id === "string" && input.agent_id !== "" ? input.agent_id : null;
  if (agentId && SKIP_AGENT_TYPES.has(input.agent_type ?? "")) pass();
  let transcript = input.transcript_path;
  if (!transcript) pass();
  if (agentId) {
    if (!input.session_id) pass();
    transcript = subagentTranscriptPath(transcript, input.session_id, agentId);
    if (!fs2.existsSync(transcript)) pass();
  }
  try {
    const model = lastAssistantModel(transcript);
    if (model && model.includes("fable")) pass();
    if (hasSkillInvocation(transcript, skill)) pass();
    if (hasSkillFileRead(transcript, skill)) pass();
  } catch {
    pass();
  }
  const dir = process.env.REVELATION_STATE_DIR || path2.join(os.tmpdir(), "revelation-remind");
  const marker = path2.join(
    dir,
    `${input.session_id}-${agentId ?? "main"}-${skill.replace(/[^a-zA-Z0-9-]/g, "_")}`
  );
  if (fs2.existsSync(marker)) pass();
  fs2.mkdirSync(dir, { recursive: true });
  fs2.writeFileSync(marker, "");
  const reason = agentId ? `[revelation] \u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u306F\u307E\u3060 ${skill} \u3092\u8AAD\u3093\u3067\u3044\u307E\u305B\u3093\u3002\u5148\u306B Read \u30C4\u30FC\u30EB\u3067 ${skillMdPath(skill)} \u3092\u8AAD\u3093\u3067\u898F\u5F8B\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u3001\u3053\u306E\u64CD\u4F5C\u3092\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044(\u3053\u306E\u5DEE\u3057\u623B\u3057\u306F 1 \u56DE\u3060\u3051\u3067\u3059)\u3002` : `[revelation] \u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u306F\u307E\u3060 ${skill} \u3092\u8AAD\u3093\u3067\u3044\u307E\u305B\u3093\u3002\u5148\u306B Skill \u30C4\u30FC\u30EB\u3067 ${skill} \u3092 invoke \u3057\u3066\u898F\u5F8B\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u3001\u3053\u306E\u64CD\u4F5C\u3092\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044(\u3053\u306E\u5DEE\u3057\u623B\u3057\u306F 1 \u56DE\u3060\u3051\u3067\u3059)\u3002Skill \u30C4\u30FC\u30EB\u306E\u547C\u3073\u51FA\u3057\u306B\u5931\u6557\u3057\u305F\u5834\u5408\u306F\u3001\u4EE3\u308F\u308A\u306B Read \u30C4\u30FC\u30EB\u3067 ${skillMdPath(skill)} \u3092\u8AAD\u3093\u3067\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
  emit("deny", reason);
} catch {
  pass();
}
