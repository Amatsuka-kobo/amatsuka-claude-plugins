#!/usr/bin/env node
// PreToolUse フック: 対象ツールの初回使用前に、対応する revelation スキルが
// まだ読まれていなければ 1 回だけ差し戻して読ませる。
// 判定は「行為者本人」単位 — サブエージェント発の呼び出し(agent_id あり)では、
// 本人の transcript を引いて本人のモデル・既読状態で判定する(transcript_path は
// サブエージェント発でも常にメインセッションを指すため)。
// 判定不能な状況ではすべて素通し(フェイルオープン)— 規律の補助でユーザーの作業を止めない。
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  emit,
  hasSkillFileRead,
  hasSkillInvocation,
  lastAssistantModel,
  pass,
  readStdin,
  subagentTranscriptPath
} from "./lib.js"

const TOOL_TO_SKILL = new Map([
  ["Edit", "revelation:fable-restraint"],
  ["Write", "revelation:fable-restraint"],
  ["Task", "revelation:fable-subagents"],
  ["Agent", "revelation:fable-subagents"]
])

// プロンプトが完全にスクリプト化された自前エージェント。行動の自由度が無く
// 規律を注入しても差し戻しの往復コストに見合わないため、素通しにする。
const SKIP_AGENT_TYPES = new Set(["task-utility:chat-recorder"])

const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)
const skillMdPath = (skill: string): string =>
  path.join(PLUGIN_ROOT, "skills", skill.split(":")[1], "SKILL.md")

try {
  const input = await readStdin()
  const skill = TOOL_TO_SKILL.get(input.tool_name ?? "")
  if (!skill) pass()

  const agentId =
    typeof input.agent_id === "string" && input.agent_id !== ""
      ? input.agent_id
      : null
  if (agentId && SKIP_AGENT_TYPES.has(input.agent_type ?? "")) pass()

  // 判定対象は行為者本人の transcript
  let transcript = input.transcript_path
  if (!transcript) pass()
  if (agentId) {
    if (!input.session_id) pass()
    transcript = subagentTranscriptPath(transcript, input.session_id, agentId)
    if (!fs.existsSync(transcript)) pass() // 内部レイアウトが変わった → フェイルオープン
  }

  try {
    // revelation は Fable 未満のモデル(Opus 含む)が対象。本人が Fable なら差し戻さない。
    const model = lastAssistantModel(transcript)
    if (model?.includes("fable")) pass()

    if (hasSkillInvocation(transcript, skill)) pass()
    if (hasSkillFileRead(transcript, skill)) pass()
  } catch {
    pass() // transcript が読めない → フェイルオープン
  }

  const dir =
    process.env.REVELATION_STATE_DIR ||
    path.join(os.tmpdir(), "revelation-remind")
  const marker = path.join(
    dir,
    `${input.session_id}-${agentId ?? "main"}-${skill.replace(/[^a-zA-Z0-9-]/g, "_")}`
  )
  if (fs.existsSync(marker)) pass()

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(marker, "")
  // サブエージェントは Skill ツールを持たないことがあるため Read で読ませる。
  // 「従わずに再試行してよい」とは案内しない(マーカーによる2回目素通しは、指示に
  // 従えなかった場合でも詰まないための安全網であって、逃げ道として宣伝しない)。
  const reason = agentId
    ? `[revelation] このセッションではまだ ${skill} を読んでいません。先に Read ツールで ${skillMdPath(skill)} を読んで規律を確認してから、この操作を再試行してください(この差し戻しは 1 回だけです)。`
    : `[revelation] このセッションではまだ ${skill} を読んでいません。先に Skill ツールで ${skill} を invoke して規律を確認してから、この操作を再試行してください(この差し戻しは 1 回だけです)。Skill ツールの呼び出しに失敗した場合は、代わりに Read ツールで ${skillMdPath(skill)} を読んでから再試行してください。`
  emit("deny", reason)
} catch {
  pass()
}
