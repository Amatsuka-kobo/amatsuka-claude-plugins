import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  buildBreadthCorpus,
  evaluateBreadth,
  evaluateBreadthCorpus
} from "../breadth.js"
import { commandLogPath } from "../command-log.js"
import { DEFAULT_CONFIG } from "../config.js"
import type { AntibodyTrigger } from "../types.js"

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-breadth-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeCommands(projectDir: string, commands: string[]): void {
  const file = commandLogPath(projectDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    `${commands
      .map((normalized_command, index) =>
        JSON.stringify({
          ts: `2026-09-08T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
          session: "session-1",
          normalized_command,
          exit_code: 0,
          failed: false
        })
      )
      .join("\n")}\n`
  )
}

const bashTrigger = (pattern: string): AntibodyTrigger => ({
  event: "PreToolUse",
  tool: "Bash",
  pattern
})

test("母集団は commands.jsonl だけから作り infection と recent_commands を含めない", () => {
  withProject((dir) => {
    writeCommands(dir, ["z-command", "a-command", "z-command"])
    const infectionDir = path.join(dir, ".raphael", "infections")
    fs.mkdirSync(infectionDir, { recursive: true })
    fs.writeFileSync(
      path.join(infectionDir, "session-1.jsonl"),
      `${JSON.stringify({ normalized_command: "infection-only" })}\n`
    )
    fs.writeFileSync(
      path.join(dir, ".raphael", "state.json"),
      JSON.stringify({ recent_commands: ["recent-only"] })
    )

    expect(buildBreadthCorpus(dir)).toEqual(["a-command", "z-command"])
  })
})

test("母集団はコードポイント昇順で重複排除し 2,000 件を上限にする", () => {
  withProject((dir) => {
    const commands = ["𐀀-command", "-command"]
    for (let index = 1_998; index >= 0; index -= 1) {
      commands.push(`command-${String(index).padStart(4, "0")}`)
    }
    commands.push("command-0000")
    writeCommands(dir, commands)

    const corpus = buildBreadthCorpus(dir)
    expect(corpus).toHaveLength(2_000)
    expect(corpus.slice(0, 3)).toEqual([
      "command-0000",
      "command-0001",
      "command-0002"
    ])
    expect(corpus).toContain("-command")
    expect(corpus).not.toContain("𐀀-command")
  })
})

test("既定閾値 10% ではちょうど 10% を通し 10% 超を拒否する", () => {
  withProject((dir) => {
    expect(DEFAULT_CONFIG.breadthMaxRatio).toBe(10)
    writeCommands(
      dir,
      Array.from(
        { length: 100 },
        (_, index) =>
          `${index < 10 ? "match" : "other"}-${String(index).padStart(3, "0")}`
      )
    )

    const boundary = evaluateBreadth(dir, bashTrigger("^match-"))
    expect(boundary).toEqual({
      tooBroad: false,
      breadth: {
        checked: true,
        corpus_size: 100,
        matched: 10,
        ratio: 0.1
      },
      samples: ["match-000", "match-001", "match-002", "match-003", "match-004"]
    })

    writeCommands(
      dir,
      Array.from(
        { length: 100 },
        (_, index) =>
          `${index < 11 ? "match" : "other"}-${String(index).padStart(3, "0")}`
      )
    )
    expect(evaluateBreadth(dir, bashTrigger("^match-"))).toMatchObject({
      tooBroad: true,
      breadth: { checked: true, corpus_size: 100, matched: 11, ratio: 0.11 }
    })
  })
})

test("一致率を計算し samples は一致集合のコードポイント昇順先頭 5 件に固定する", () => {
  withProject((dir) => {
    writeCommands(dir, [
      "match-z",
      "other",
      "match-𐀀",
      "match-b",
      "match-",
      "match-a",
      "match-c"
    ])

    const result = evaluateBreadth(dir, bashTrigger("^match-"), 50, 1)
    expect(result.breadth).toEqual({
      checked: true,
      corpus_size: 7,
      matched: 6,
      ratio: 6 / 7
    })
    expect(result.tooBroad).toBe(true)
    expect(result.samples).toEqual([
      "match-a",
      "match-b",
      "match-c",
      "match-z",
      "match-"
    ])
  })
})

test("指定した母集団で evaluateBreadth は I-O せず同じ判定を返す", () => {
  const corpus = ["match-a", "other-a", "match-b"]
  expect(
    evaluateBreadth(
      path.join(os.tmpdir(), "raphael-breadth-missing-project"),
      bashTrigger("^match-"),
      50,
      1,
      corpus
    )
  ).toEqual({
    tooBroad: true,
    breadth: { checked: true, corpus_size: 3, matched: 2, ratio: 2 / 3 },
    samples: ["match-a", "match-b"]
  })
  expect(evaluateBreadthCorpus(corpus, bashTrigger("^match-"), 50, 1)).toEqual(
    evaluateBreadth(
      path.join(os.tmpdir(), "raphael-breadth-missing-project"),
      bashTrigger("^match-"),
      50,
      1,
      corpus
    )
  )
})
