import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import type { CommandLogEntry } from "../command-log.js"
import {
  appendCommandLog,
  commandLogPath,
  readCommandLog,
  truncateCommandLog
} from "../command-log.js"

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-command-log-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function entry(index: number): CommandLogEntry {
  return {
    ts: `2026-09-08T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
    session: "session-1",
    normalized_command: `echo ${index}`,
    exit_code: 0,
    failed: false
  }
}

test("コマンド履歴を追記して読み取れる", () => {
  withProject((dir) => {
    appendCommandLog(dir, entry(1))
    appendCommandLog(dir, { ...entry(2), exit_code: 1, failed: true })

    expect(readCommandLog(dir)).toEqual([
      entry(1),
      { ...entry(2), exit_code: 1, failed: true }
    ])
  })
})

test("parse できない行を読み飛ばす", () => {
  withProject((dir) => {
    fs.mkdirSync(path.dirname(commandLogPath(dir)), { recursive: true })
    fs.writeFileSync(
      commandLogPath(dir),
      [
        JSON.stringify(entry(1)),
        "{broken-json",
        JSON.stringify(entry(2)),
        ""
      ].join("\n")
    )

    expect(readCommandLog(dir)).toEqual([entry(1), entry(2)])
  })
})

test("ファイルが無いときは空配列を返す", () => {
  withProject((dir) => {
    expect(readCommandLog(dir)).toEqual([])
  })
})

test("2,000 行を超えた履歴を先頭から切り詰める", () => {
  withProject((dir) => {
    for (let index = 0; index < 2_005; index += 1) {
      appendCommandLog(dir, entry(index))
    }

    expect(truncateCommandLog(dir, 2_000)).toBe(5)
    const retained = readCommandLog(dir)
    expect(retained).toHaveLength(2_000)
    expect(retained[0]).toEqual(entry(5))
    expect(retained.at(-1)).toEqual(entry(2_004))
  })
})

test("書き込み不能な path でも例外を投げない", () => {
  withProject((dir) => {
    fs.writeFileSync(path.join(dir, ".raphael"), "not-a-directory")

    expect(() => appendCommandLog(dir, entry(1))).not.toThrow()
    expect(() => readCommandLog(dir)).not.toThrow()
    expect(() => truncateCommandLog(dir, 2_000)).not.toThrow()
  })
})
