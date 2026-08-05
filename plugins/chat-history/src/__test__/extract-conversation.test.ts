import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../src/testing/run-ts.js"
import { extractConversation } from "../extract-conversation.js"

const SCRIPT = fileURLToPath(
  new URL("../extract-conversation.ts", import.meta.url)
)

function run(lines: string[], extraArgs: string[] = []): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-ext-")),
    "t.jsonl"
  )
  fs.writeFileSync(file, `${lines.join("\n")}\n`)
  const stdout = runTs(SCRIPT, [file, ...extraArgs])
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  return stdout
}

const user = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    ...extra
  })
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content },
    ...extra
  })

test("ユーザー発言は原文のまま、ハーネス注入は除外される", () => {
  const out = run([
    user("<command-name>/model</command-name>"),
    user("これは 原文の  発言です。改変されないこと。"),
    user("メタ発言", { isMeta: true })
  ])
  expect(out).toMatch(
    /## USER\n\n> これは 原文の {2}発言です。改変されないこと。/
  )
  expect(out).not.toMatch(/command-name|メタ発言/)
})

test("AI の text と tool_use ヒントが出力され、thinking は出ない", () => {
  const out = run([
    assistant([
      { type: "thinking", thinking: "内心" },
      { type: "text", text: "結論を報告します。" },
      {
        type: "tool_use",
        name: "Bash",
        input: { description: "テストを実行" }
      },
      { type: "tool_use", name: "Write", input: { file_path: "/x/y.md" } }
    ])
  ])
  expect(out).toMatch(/## ASSISTANT\n\n結論を報告します。/)
  expect(out).toMatch(/\(tool: Bash — テストを実行\)/)
  expect(out).toMatch(/\(tool: Write — \/x\/y\.md\)/)
  expect(out).not.toMatch(/内心/)
})

test("連続する ASSISTANT エントリは1セクションに結合される", () => {
  const out = run([
    user("質問"),
    assistant([{ type: "text", text: "前半。" }]),
    assistant([{ type: "text", text: "後半。" }])
  ])
  expect(out.match(/## ASSISTANT/g)?.length).toBe(1)
  expect(out).toMatch(/前半。\n\n後半。/)
})

test("サブエージェントの往復(isSidechain)は含めない", () => {
  const out = run([
    user("本編の発言"),
    user("サブエージェントへの指示", { isSidechain: true }),
    assistant([{ type: "text", text: "サブの応答" }], { isSidechain: true })
  ])
  expect(out).toMatch(/本編の発言/)
  expect(out).not.toMatch(/サブ/)
})

test("--since-line で指定行以前が除外される", () => {
  const out = run(
    [user("古い質問です"), user("新しい質問です")],
    ["--since-line", "1"]
  )
  expect(out).toMatch(/新しい質問です/)
  expect(out).not.toMatch(/古い質問です/)
})

// 記録の window は (recordedLine, targetLine] で、両端とも「ユーザー発言の行」。
// recordedLine の直後に並ぶ ASSISTANT こそがそのターンで AI が行った作業の本体であり、
// まだ一度も記録されていない。ここを捨てると記録は USER 発言だけの抜け殻になる。
test("--since-line 直後の ASSISTANT はそのターンの作業本体として保持される", () => {
  const out = run(
    [
      user("古い質問です"),
      assistant([{ type: "text", text: "前ターンの締めの報告。" }]),
      user("新しい質問です"),
      assistant([{ type: "text", text: "新しい応答。" }])
    ],
    ["--since-line", "1"]
  )
  expect(out).toMatch(/前ターンの締めの報告/)
  expect(out).toMatch(/新しい質問です/)
  expect(out).toMatch(/新しい応答。/)
})

// 実際の window 形状の回帰テスト: 先頭が ASSISTANT・末尾が USER。
// targetLine は常に「今回のユーザー発言」なので、AI の作業は必ず window の前方に来る。
test("先頭が ASSISTANT・末尾が USER の window で AI の作業が失われない", () => {
  const out = extractConversation(
    [
      user("前回の指示"),
      assistant([{ type: "text", text: "実装しました。" }]),
      assistant([
        { type: "tool_use", name: "Bash", input: { description: "テスト実行" } }
      ]),
      user("次の指示")
    ].join("\n"),
    1,
    4
  )
  expect(out).toMatch(/実装しました。/)
  expect(out).toMatch(/\(tool: Bash — テスト実行\)/)
  expect(out).toMatch(/次の指示/)
  expect(out).not.toMatch(/前回の指示/)
})

test("行カウントは空行・パース不能行も 1 行と数える(check-chat-recorded と同じ)", () => {
  // 1:user 2:(空行) 3:(壊れた JSON) 4:user — 4 行目だけが対象になるよう --since-line 3 を指定
  const out = run(
    [user("質問1です"), "", "not json {", user("質問2です")],
    ["--since-line", "3"]
  )
  expect(out).toMatch(/質問2です/)
  expect(out).not.toMatch(/質問1です/)
})

test("--since-line 0 は全量抽出と同等", () => {
  const out = run([user("質問1です"), user("質問2です")], ["--since-line", "0"])
  expect(out).toMatch(/質問1です/)
  expect(out).toMatch(/質問2です/)
})

test("--since-line が最終行以降なら出力は空", () => {
  const out = run([user("質問です")], ["--since-line", "99"])
  expect(out.trim()).toBe("")
})

test("USER 発言は各行 > 前置の引用ブロックで出力される(空行は > のみ)", () => {
  const out = run([user("1行目\n\n2行目")])
  expect(out).toMatch(/## USER\n\n> 1行目\n>\n> 2行目/)
})

test("純粋関数と CLI の出力が一致する", () => {
  const lines = [user("質問"), assistant([{ type: "text", text: "回答" }])]
  expect(run(lines).trim()).toBe(extractConversation(`${lines.join("\n")}\n`))
})

test("抽出区間は (recordedLine, targetLine] で targetLine より後を含めない", () => {
  const lines = [user("古い"), user("対象"), user("対象外")]
  const out = extractConversation(lines.join("\n"), 1, 2)
  expect(out).toContain("対象")
  expect(out).not.toContain("古い")
  expect(out).not.toContain("対象外")
})
