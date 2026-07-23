import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  allocateEventSeq,
  applyEditToState,
  createInitialState,
  loadState,
  saveState,
  stateFilePath
} from "../state-store.js"

type State = ReturnType<typeof createInitialState>

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-state-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function timestamp(index: number): string {
  return new Date(Date.UTC(2026, 6, 24, 0, 0, index)).toISOString()
}

test("state が無い、壊れている、session が違う場合は初期値へ戻す", () => {
  withProject((dir) => {
    expect(loadState(dir, "session-1")).toEqual(createInitialState("session-1"))

    const file = stateFilePath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "{")
    expect(loadState(dir, "session-1")).toEqual(createInitialState("session-1"))

    saveState(dir, { ...createInitialState("old-session"), next_event_seq: 9 })
    expect(loadState(dir, "session-1")).toEqual(createInitialState("session-1"))
  })
})

test("next_event_seq を1から採番し、都度 atomic 保存する", () => {
  withProject((dir) => {
    expect(allocateEventSeq(dir, "session-1")).toBe(1)
    expect(allocateEventSeq(dir, "session-1")).toBe(2)
    expect(loadState(dir, "session-1").next_event_seq).toBe(3)

    expect(allocateEventSeq(dir, "session-2")).toBe(1)
    expect(loadState(dir, "session-2").next_event_seq).toBe(2)
  })
})

test("save 時に recent 上限と injected の antibody ID coalesce を適用する", () => {
  withProject((dir) => {
    const state: State = {
      ...createInitialState("session-1"),
      recent_commands: Array.from({ length: 25 }, (_, index) => ({
        ts: timestamp(index),
        normalized_command: `command-${index}`,
        failed: false,
        exit_code: 0,
        infection_id: null
      })),
      recent_edits: Array.from({ length: 55 }, (_, index) => ({
        ts: timestamp(index),
        file_path: `src/${index}.ts`,
        line_start: 1,
        line_end: 1
      })),
      last_tool: {
        ts: timestamp(0),
        tool: "Bash",
        input_digest: "API_KEY=secret"
      },
      injected: [
        {
          ts: timestamp(1),
          antibody_id: "a",
          trigger_fingerprint: "old"
        },
        {
          ts: timestamp(2),
          antibody_id: "b",
          trigger_fingerprint: "b"
        },
        {
          ts: timestamp(3),
          antibody_id: "a",
          trigger_fingerprint: "new"
        }
      ]
    }

    saveState(dir, state)
    const saved = loadState(dir, "session-1")
    expect(saved.recent_commands).toHaveLength(20)
    expect(saved.recent_commands[0].normalized_command).toBe("command-5")
    expect(saved.recent_edits).toHaveLength(50)
    expect(saved.recent_edits[0].file_path).toBe("src/5.ts")
    expect(saved.injected).toHaveLength(2)
    expect(
      saved.injected.find(({ antibody_id }) => antibody_id === "a")
    ).toMatchObject({ ts: timestamp(3), trigger_fingerprint: "new" })
    expect(saved.last_tool?.input_digest).toBe("API_KEY=<redacted>")
  })
})

test("Edit footprint を現在の file の一意な new_string から復元する", () => {
  withProject((dir) => {
    const file = path.join(dir, "src", "file.ts")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "first\nchanged\nline\nlast\n")

    const result = applyEditToState(dir, createInitialState("session-1"), {
      ts: timestamp(0),
      filePath: file,
      newString: "changed\nline",
      inputDigest: "Edit input"
    })

    expect(result.footprint).toEqual({
      file_path: "src/file.ts",
      line_start: 2,
      line_end: 3
    })
    expect(result.state.recent_edits).toEqual([
      { ts: timestamp(0), ...result.footprint }
    ])
    expect(result.state.last_tool).toEqual({
      ts: timestamp(0),
      tool: "Edit",
      input_digest: "Edit input"
    })
  })
})

test.each([
  ["empty new_string", "", "one\n"],
  ["multiple match", "same", "same\nsame\n"],
  ["missing file", "value", null]
])("footprint 復元不能(%s)なら recent_edits を増やさない", (_name, newString, content) => {
  withProject((dir) => {
    const file = path.join(dir, "file.ts")
    if (content !== null) fs.writeFileSync(file, content)
    const initial = createInitialState("session-1")
    initial.recent_edits.push({
      ts: timestamp(1),
      file_path: "kept.ts",
      line_start: 1,
      line_end: 1
    })

    const result = applyEditToState(dir, initial, {
      ts: timestamp(2),
      filePath: file,
      newString,
      inputDigest: "SECRET=value"
    })

    expect(result.footprint).toBeNull()
    expect(result.state.recent_edits).toEqual(initial.recent_edits)
    expect(result.state.last_tool).toEqual({
      ts: timestamp(2),
      tool: "Edit",
      input_digest: "SECRET=<redacted>"
    })
  })
})

test("project 外 path は footprint から除外する", () => {
  withProject((dir) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-outside-"))
    try {
      const file = path.join(outside, "file.ts")
      fs.writeFileSync(file, "unique")
      const result = applyEditToState(dir, createInitialState("session-1"), {
        ts: timestamp(0),
        filePath: file,
        newString: "unique",
        inputDigest: "input"
      })
      expect(result.footprint).toBeNull()
      expect(result.state.recent_edits).toEqual([])
      expect(result.state.last_tool?.tool).toBe("Edit")
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})
