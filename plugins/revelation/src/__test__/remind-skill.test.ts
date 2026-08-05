import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../remind-skill.ts", import.meta.url))
let seq = 0

interface TestContext {
  stateDir: string
  transcript: string
  session: string
}

interface HookOutput {
  permissionDecision: string
  permissionDecisionReason: string
}

interface HookExtra {
  agent_id?: string
  agent_type?: string
}

function setup(): TestContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rev-remind-"))
  return {
    stateDir: path.join(dir, "state"),
    transcript: path.join(dir, "t.jsonl"),
    session: `s-${process.pid}-${seq++}`
  }
}

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny など出力がある場合は hookSpecificOutput を返す。
function hook(
  ctx: TestContext,
  toolName: string,
  transcriptPath?: string | null,
  extra: HookExtra = {}
): HookOutput | null {
  const input = JSON.stringify({
    session_id: ctx.session,
    tool_name: toolName,
    transcript_path: transcriptPath ?? ctx.transcript,
    cwd: os.tmpdir(),
    ...extra
  })
  const out = runTs(HOOK, [], {
    input,
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir }
  })
  if (out === "") return null
  return JSON.parse(out).hookSpecificOutput as HookOutput
}

const skillUseLine = (skill: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Skill", input: { skill } }]
    }
  })

const assistantModelLine = (model: string): string =>
  JSON.stringify({
    type: "assistant",
    message: { model, content: [{ type: "text", text: "hi" }] }
  })

test("未読の Edit は deny(fable-restraint への誘導)、同一セッション2回目は素通し(無出力)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  const first = hook(ctx, "Edit")
  expect(first?.permissionDecision).toBe("deny")
  expect(first?.permissionDecisionReason).toMatch(/revelation:fable-restraint/)
  expect(hook(ctx, "Edit")).toBeNull()
})

test("fable-restraint invoke 済みなら Write は素通し(無出力、マーカー消費なし)", () => {
  const ctx = setup()
  fs.writeFileSync(
    ctx.transcript,
    `${skillUseLine("revelation:fable-restraint")}\n`
  )
  expect(hook(ctx, "Write")).toBeNull()
  // 既読による素通しはマーカーを消費しない(deny 履歴が残らない)
  expect(fs.existsSync(ctx.stateDir)).toBe(false)
})

test("Task/Agent は fable-subagents を要求する(restraint 既読でも別枠)", () => {
  const ctx = setup()
  fs.writeFileSync(
    ctx.transcript,
    `${skillUseLine("revelation:fable-restraint")}\n`
  )
  const r = hook(ctx, "Task")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toMatch(/revelation:fable-subagents/)
})

test("スキルごとにマーカーは独立(restraint の差し戻し後も subagents は差し戻される)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  expect(hook(ctx, "Edit")?.permissionDecision).toBe("deny")
  expect(hook(ctx, "Agent")?.permissionDecision).toBe("deny")
  expect(hook(ctx, "Agent")).toBeNull()
})

test("対象外ツールは素通し(無出力)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  expect(hook(ctx, "Read")).toBeNull()
})

test("transcript が読めなければ素通し(無出力、フェイルオープン)", () => {
  const ctx = setup()
  expect(hook(ctx, "Edit", "/nonexistent/t.jsonl")).toBeNull()
})

test("入力が JSON として壊れていても無出力で終了する(フェイルオープン)", () => {
  const ctx = setup()
  const out = runTs(HOOK, [], {
    input: "not-json",
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir }
  })
  expect(out).toBe("")
})

test("マーカーディレクトリの作成に失敗すると素通し(無出力、外側 catch)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  // REVELATION_STATE_DIR を既存の「ファイル」に向けると mkdirSync が throw する
  fs.mkdirSync(path.dirname(ctx.stateDir), { recursive: true })
  fs.writeFileSync(ctx.stateDir, "")
  expect(hook(ctx, "Edit")).toBeNull()
})

test("Fable セッション(model に fable を含む)では未読でも Edit は素通し(マーカーも作られない)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, `${assistantModelLine("claude-fable-5")}\n`)
  expect(hook(ctx, "Edit")).toBeNull()
  expect(fs.existsSync(ctx.stateDir)).toBe(false)
})

test("Opus セッションは対象のまま(従来どおり deny)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, `${assistantModelLine("claude-opus-4-8")}\n`)
  const r = hook(ctx, "Edit")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toMatch(/revelation:fable-restraint/)
})

test("親向け deny 文面: 「そのまま再試行してよい」の救済文を含まず、Skill 失敗時の Read フォールバックを含む", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  const r = hook(ctx, "Edit")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).not.toMatch(/そのまま同じ操作を再試行/)
  expect(r?.permissionDecisionReason).toMatch(/Read ツール/)
  expect(r?.permissionDecisionReason).toMatch(
    /plugins\/revelation\/skills\/fable-restraint\/SKILL\.md/
  )
})

// --- サブエージェント発の呼び出し(agent_id / agent_type あり) ---

// メイン transcript の隣に <session>/subagents/agent-<id>.jsonl を作る
function writeSubTranscript(
  ctx: TestContext,
  agentId: string,
  lines: string[]
): string {
  const p = path.join(
    path.dirname(ctx.transcript),
    ctx.session,
    "subagents",
    `agent-${agentId}.jsonl`
  )
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, `${lines.join("\n")}\n`)
  return p
}

test("サブエージェント発: 本人のモデルで判定し deny、文面は SKILL.md への Read を指示する", () => {
  const ctx = setup()
  // 親は Fable でも、サブエージェント本人が Sonnet なら差し戻す
  fs.writeFileSync(ctx.transcript, `${assistantModelLine("claude-fable-5")}\n`)
  writeSubTranscript(ctx, "sub1", [assistantModelLine("claude-sonnet-5")])
  const r = hook(ctx, "Write", null, {
    agent_id: "sub1",
    agent_type: "general-purpose"
  })
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toMatch(/Read ツール/)
  expect(r?.permissionDecisionReason).toMatch(
    /plugins\/revelation\/skills\/fable-restraint\/SKILL\.md/
  )
})

test("サブエージェント発: 本人が Fable なら親が Sonnet でも素通し", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, `${assistantModelLine("claude-sonnet-5")}\n`)
  writeSubTranscript(ctx, "sub1", [assistantModelLine("claude-fable-5")])
  expect(
    hook(ctx, "Write", null, {
      agent_id: "sub1",
      agent_type: "general-purpose"
    })
  ).toBeNull()
})

test("サブエージェント発: 本人が対応スキルを invoke 済みなら素通し", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  writeSubTranscript(ctx, "sub1", [
    assistantModelLine("claude-sonnet-5"),
    skillUseLine("revelation:fable-restraint")
  ])
  expect(
    hook(ctx, "Edit", null, { agent_id: "sub1", agent_type: "general-purpose" })
  ).toBeNull()
})

test("サブエージェント発: 本人が SKILL.md を Read 済みなら素通し", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  const readLine = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/any/where/skills/fable-restraint/SKILL.md" }
        }
      ]
    }
  })
  writeSubTranscript(ctx, "sub1", [
    assistantModelLine("claude-sonnet-5"),
    readLine
  ])
  expect(
    hook(ctx, "Edit", null, { agent_id: "sub1", agent_type: "general-purpose" })
  ).toBeNull()
})

test("サブエージェント発: 本人の transcript が見つからなければ素通し(内部レイアウト変更へのフェイルオープン)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  expect(
    hook(ctx, "Edit", null, {
      agent_id: "ghost",
      agent_type: "general-purpose"
    })
  ).toBeNull()
})

test("マーカーはエージェント単位: サブエージェントの deny が親の差し戻し枠を消費しない", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  writeSubTranscript(ctx, "sub1", [assistantModelLine("claude-sonnet-5")])
  // サブエージェントが先に deny を受けても…
  expect(
    hook(ctx, "Edit", null, { agent_id: "sub1", agent_type: "general-purpose" })
      ?.permissionDecision
  ).toBe("deny")
  // 親の初回 Edit は依然として deny される(相互汚染なし)
  expect(hook(ctx, "Edit")?.permissionDecision).toBe("deny")
  // それぞれ2回目は素通し
  expect(
    hook(ctx, "Edit", null, { agent_id: "sub1", agent_type: "general-purpose" })
  ).toBeNull()
  expect(hook(ctx, "Edit")).toBeNull()
})

test("スクリプト化された自前エージェント(chat-history:chat-recorder)は素通し(マーカーも作られない)", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  writeSubTranscript(ctx, "rec1", [
    assistantModelLine("claude-haiku-4-5-20251001")
  ])
  expect(
    hook(ctx, "Write", null, {
      agent_id: "rec1",
      agent_type: "chat-history:chat-recorder"
    })
  ).toBeNull()
  expect(fs.existsSync(ctx.stateDir)).toBe(false)
})

test("旧 id(task-utility:chat-recorder)も素通しを維持する", () => {
  const ctx = setup()
  fs.writeFileSync(ctx.transcript, "\n")
  writeSubTranscript(ctx, "rec1", [
    assistantModelLine("claude-haiku-4-5-20251001")
  ])
  expect(
    hook(ctx, "Write", null, {
      agent_id: "rec1",
      agent_type: "task-utility:chat-recorder"
    })
  ).toBeNull()
  expect(fs.existsSync(ctx.stateDir)).toBe(false)
})
