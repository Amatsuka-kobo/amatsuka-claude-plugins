import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(
  new URL("../check-chat-recorded.ts", import.meta.url)
)

const user = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text } })
const nag = (extra = "") =>
  JSON.stringify({
    type: "user",
    isMeta: true,
    message: { role: "user", content: `<!--chat-recorder-nag-->\n${extra}` }
  })
const toolUse = (name: string, filePath: string) =>
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name, input: { file_path: filePath } }]
    }
  })
const agentDispatch = (subagentType: string) =>
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "Agent",
          input: { subagent_type: subagentType, prompt: "会話を記録して" }
        }
      ]
    }
  })

function run({
  lines,
  withChatDir = true,
  stopHookActive = false
}: {
  lines: string[]
  withChatDir?: boolean
  stopHookActive?: boolean
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-hook-"))
  if (withChatDir)
    fs.mkdirSync(path.join(dir, "docs", "chat"), { recursive: true })
  const transcript = path.join(dir, "t.jsonl")
  fs.writeFileSync(transcript, `${lines.join("\n")}\n`)
  try {
    return runTs(HOOK, [], {
      input: JSON.stringify({
        transcript_path: transcript,
        cwd: dir,
        stop_hook_active: stopHookActive
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: dir,
        CLAUDE_PLUGIN_ROOT: "/plugin/root"
      }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("docs/chat がないプロジェクトでは何もしない", () => {
  expect(run({ lines: [user("質問です")], withChatDir: false }).trim()).toBe("")
})

test("ユーザー発言1回・未記録でも block を出す", () => {
  const out = JSON.parse(run({ lines: [user("質問です")] }))
  expect(out.decision).toBe("block")
  expect(out.reason).toMatch(/task-utility:chat-recorder/)
  expect(out.reason).toMatch(/extract-conversation\.mjs/)
  expect(out.reason).toMatch(/追記/)
})

test("docs/chat/ への Write の後に新しい発言がなければ通す", () => {
  expect(
    run({
      lines: [
        user("質問1です"),
        toolUse("Write", "/p/docs/chat/2026/0708/x.md")
      ]
    }).trim()
  ).toBe("")
})

test("docs/chat/ への Edit(追記)も記録イベントとして通す", () => {
  expect(
    run({
      lines: [user("質問1です"), toolUse("Edit", "/p/docs/chat/2026/0708/x.md")]
    }).trim()
  ).toBe("")
})

test("記録イベントの後に新しい発言があれば再度 block する", () => {
  const out = JSON.parse(
    run({
      lines: [
        user("質問1です"),
        toolUse("Write", "/p/docs/chat/2026/0708/x.md"),
        user("質問2です")
      ]
    })
  )
  expect(out.decision).toBe("block")
})

test("chat-recorder へのディスパッチも記録イベントとして通す", () => {
  expect(
    run({
      lines: [user("質問1です"), agentDispatch("task-utility:chat-recorder")]
    }).trim()
  ).toBe("")
})

test("chat-recorder 以外のサブエージェント起動は記録と見なさない", () => {
  expect(
    JSON.parse(
      run({ lines: [user("質問1です"), agentDispatch("general-purpose")] })
    ).decision
  ).toBe("block")
})

test("ハーネス注入(< 始まり)やツール結果だけならターンがないものとして通す", () => {
  const lines = [
    user("<command-name>/clear</command-name>"),
    user("<local-command-stdout>x</local-command-stdout>"),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result" }] }
    })
  ]
  expect(run({ lines }).trim()).toBe("")
})

test("同一未記録状態では 2 回目は差し戻さない(nag-once)", () => {
  expect(run({ lines: [user("質問です"), nag()] }).trim()).toBe("")
})

test("nag の後に新しい実発言が来たら再度 block する", () => {
  expect(
    JSON.parse(run({ lines: [user("質問1"), nag(), user("質問2")] })).decision
  ).toBe("block")
})

test("block reason にマーカーが含まれる", () => {
  expect(JSON.parse(run({ lines: [user("質問です")] })).reason).toMatch(
    /<!--chat-recorder-nag-->/
  )
})

test("stop_hook_active のときは再差し戻ししない", () => {
  expect(run({ lines: [user("質問です")], stopHookActive: true }).trim()).toBe(
    ""
  )
})

test("壊れた stdin でも落ちず素通しする", () => {
  expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
})

test("記録イベント後の再 block では --since-line に記録行番号が入る", () => {
  const out = JSON.parse(
    run({
      lines: [
        user("質問1です"),
        toolUse("Write", "/p/docs/chat/2026/0708/x.md"),
        user("質問2です")
      ]
    })
  )
  expect(out.reason).toMatch(
    /extract-conversation\.mjs" "[^"]+" --since-line 2/
  )
})

test("記録イベントがないときは --since-line を付けない", () => {
  const out = JSON.parse(run({ lines: [user("質問です")] }))
  expect(out.reason).not.toMatch(/--since-line/)
})

test("reason に tail 確認と末尾追記の指示が含まれる", () => {
  const out = JSON.parse(run({ lines: [user("質問です")] }))
  expect(out.reason).toMatch(/tail/)
  expect(out.reason).toMatch(/末尾追記/)
})

test("フックの行番号を --since-line に渡すと未記録分だけが抽出される", () => {
  // 空行・壊れた JSON を挟んでも両スクリプトの行カウントが一致することの統合検証
  const EXTRACT = fileURLToPath(
    new URL("../../extract-conversation.ts", import.meta.url)
  )
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-int-"))
  fs.mkdirSync(path.join(dir, "docs", "chat"), { recursive: true })
  const transcript = path.join(dir, "t.jsonl")
  fs.writeFileSync(
    transcript,
    `${[
      user("質問1です"),
      "",
      "not json {",
      toolUse("Write", "/p/docs/chat/2026/0708/x.md"),
      user("質問2です")
    ].join("\n")}\n`
  )
  try {
    const hookOut = JSON.parse(
      runTs(HOOK, [], {
        input: JSON.stringify({ transcript_path: transcript, cwd: dir }),
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: dir,
          CLAUDE_PLUGIN_ROOT: "/plugin/root"
        }
      })
    )
    const m = hookOut.reason.match(/--since-line (\d+)/)
    expect(m).not.toBeNull()
    const extracted = runTs(EXTRACT, [
      transcript,
      "--since-line",
      (m as RegExpMatchArray)[1]
    ])
    expect(extracted).toMatch(/質問2です/)
    expect(extracted).not.toMatch(/質問1です/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
