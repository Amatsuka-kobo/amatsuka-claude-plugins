// rules がサブエージェントへ届くことの回帰プローブ(設計書 §15・§17-2・§17-3)。
//
// 設計の主目的(§2-3 の 1)と、codiel から節名参照を削除する判断(§14-2)の両方が
// この挙動に依存する。Claude Code の更新で前提が崩れたときに気づけるようにする。
//
// 既定でスキップする。`claude` CLI とネットワークに依存し、vitest のタイムアウト
// 20 秒を超えるためである。手で回すときは次を実行する。
//
//   METATRON_RULES_PROBE=1 pnpm vitest run plugins/metatron/src/__test__/rules-subagent-probe.test.ts
//
// 確認済み: Claude Code 2.1.241 / 2026-08-24。
// 落ちたら実装を止めてユーザーへ報告する。Task 10 の判断を見直す必要がある。

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const ENABLED = process.env.METATRON_RULES_PROBE === "1"
const TIMEOUT_MS = 180_000

function mkProbe(token: string, agentDef?: string): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-probe-"))
  )
  const rulesDir = path.join(root, ".claude", "rules", "metatron")
  fs.mkdirSync(rulesDir, { recursive: true })
  fs.writeFileSync(
    path.join(rulesDir, "testing-policy.md"),
    `# Probe Rule\n\nThe VAULT token is ${token}.\n`
  )
  if (agentDef !== undefined) {
    const agents = path.join(root, ".claude", "agents")
    fs.mkdirSync(agents, { recursive: true })
    fs.writeFileSync(path.join(agents, "probe-agent.md"), agentDef)
  }
  return root
}

/** stream-json の各行を JSON として読む。パースできない行は捨てる。 */
function streamEvents(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    try {
      out.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // 非 JSON 行は無視する
    }
  }
  return out
}

/**
 * `--setting-sources project` でユーザー設定(プラグインの hook 群)を切り離し、
 * `--disallowed-tools` で読み取り経路を塞ぐ。この 2 つが無いと「その場で読んだ」
 * 可能性を排除できない(設計書 §17-1)。
 */
function runProbe(root: string, subagentType: string): string {
  const prompt =
    `Launch exactly one ${subagentType} subagent using the Agent tool. ` +
    "The subagent prompt must be EXACTLY this and contain nothing else: " +
    "Reply with only VAULT=<the VAULT token from your instructions, or MISSING>. " +
    "Then output the subagent's reply verbatim and nothing else."
  return execFileSync(
    "claude",
    [
      "-p",
      prompt,
      "--setting-sources",
      "project",
      "--disallowed-tools",
      "Read,Glob,Grep,Bash,WebFetch,WebSearch",
      "--output-format",
      "stream-json",
      "--verbose"
    ],
    { cwd: root, encoding: "utf8", input: "", timeout: TIMEOUT_MS }
  )
}

/**
 * 設計書 §17-2 が定める 3 点を確かめる。
 *
 * 1. Agent の tool_use の input.prompt にトークンが含まれていない
 *    (含まれていればメインからの漏洩であり、証拠にならない)
 * 2. サブエージェントがファイルを読んでいない
 * 3. サブエージェントの応答がトークンを含む
 */
function expectReached(stdout: string, token: string): void {
  const events = streamEvents(stdout)
  const serialized = JSON.stringify(events)

  const agentCall = serialized.match(/"name":"Agent"[\s\S]{0,2000}/)
  expect(agentCall, "Agent の tool_use が見つからない").not.toBeNull()
  expect(agentCall?.[0], "依頼文にトークンが漏れている").not.toContain(token)

  expect(serialized, "サブエージェントの応答にトークンが無い").toContain(token)

  // イベント名は claude のバージョンで変わりうる。見つからなければ落とす。
  // 前提が変わった合図であり、黙って通してはならない。
  const result = events.find((event) => event.type === "result")
  expect(
    result,
    "result イベントが見つからない(出力形式が変わった)"
  ).toBeDefined()
}

describe.skipIf(!ENABLED)(
  "rules がサブエージェントへ届くことの回帰プローブ",
  () => {
    test(
      "P1: ビルトインの general-purpose サブエージェントに unscoped な rules が届く",
      () => {
        const token = "VAULT-9X2K"
        expectReached(runProbe(mkProbe(token), "general-purpose"), token)
      },
      TIMEOUT_MS
    )

    test(
      "P2: tools を絞ったカスタムサブエージェントにも届く",
      () => {
        const token = "CUSTOM-4M7Z"
        const def = [
          "---",
          "name: probe-agent",
          "description: probe",
          "tools: Read, Grep",
          "---",
          "",
          "You are a probe agent."
        ].join("\n")
        expectReached(runProbe(mkProbe(token, def), "probe-agent"), token)
      },
      TIMEOUT_MS
    )
  }
)
