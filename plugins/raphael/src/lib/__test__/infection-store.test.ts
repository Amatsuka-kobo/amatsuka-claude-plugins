import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  appendInfection,
  computeDistillNagDigest,
  generateInfectionId,
  infectionFilePath,
  markInfectionsDistilled,
  readInfections,
  sessionFileName,
  sha256Hex
} from "../infection-store.js"
import type {
  InfectionDetails,
  InfectionKind,
  InfectionRecordV1
} from "../types.js"

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-infections-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function record(
  kind: InfectionKind,
  details: InfectionDetails,
  overrides: Partial<InfectionRecordV1> = {}
): InfectionRecordV1 {
  return {
    schema_version: 1,
    id: generateInfectionId(new Date("2026-07-24T01:02:03.004Z")),
    ts: "2026-07-24T01:02:03.004Z",
    kind,
    session: "session-1",
    hook_event: "PostToolUseFailure",
    tool: "Bash",
    tool_use_id: null,
    input_digest: "input",
    evidence: "evidence",
    fingerprint: sha256Hex(`${kind}-fingerprint`),
    details,
    distilled: false,
    distilled_at: null,
    ...overrides
  }
}

const detailsByKind: Array<[InfectionKind, InfectionDetails]> = [
  [
    "command-failure",
    {
      type: "command-failure",
      command: "false",
      normalized_command: "false",
      exit_code: 1,
      output_tail: "failed"
    }
  ],
  [
    "retry-loop",
    {
      type: "retry-loop",
      command: "false",
      normalized_command: "false",
      consecutive_failures: 3,
      exit_codes: [1, 1, 1]
    }
  ],
  [
    "user-rejection",
    {
      type: "user-rejection",
      prompt_excerpt: "違います。戻して",
      matched_pattern: "ja-wrong",
      previous_tool: { tool: "Edit", input_digest: "digest" }
    }
  ],
  [
    "edit-churn",
    {
      type: "edit-churn",
      file_path: "src/file.ts",
      line_start: 1,
      line_end: 2,
      edits_in_window: 3
    }
  ]
]

test("infection ID、session filename、SHA-256 digest helper を生成する", () => {
  expect(generateInfectionId(new Date("2026-07-24T01:02:03.004Z"))).toMatch(
    /^infection-20260724-010203004-[0-9a-f]{8}$/
  )
  expect(sessionFileName("session-1")).toBe(
    `session-${sha256Hex("session-1").slice(0, 16)}.jsonl`
  )
  expect(computeDistillNagDigest(["b", "a", "a"])).toBe(sha256Hex("a\0b"))
})

test("schema v1 の4 kind を serialize/parse する", () => {
  withProject((dir) => {
    for (const [kind, details] of detailsByKind) {
      expect(appendInfection(dir, record(kind, details))).toBe(true)
    }
    expect(readInfections(dir, "session-1").map(({ kind }) => kind)).toEqual(
      detailsByKind.map(([kind]) => kind)
    )
  })
})

test("壊れた行と invalid schema を個別 skip し、append 時も raw 行を保持する", () => {
  withProject((dir) => {
    const first = record("command-failure", detailsByKind[0][1])
    const second = record("edit-churn", detailsByKind[3][1])
    const wrongDetails = { ...first, details: detailsByKind[3][1] }
    const missingRequired = { ...first } as Record<string, unknown>
    delete missingRequired.evidence
    const file = infectionFilePath(dir, "session-1")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      [
        JSON.stringify(first),
        "{broken",
        JSON.stringify({ schema_version: 2 }),
        JSON.stringify(wrongDetails),
        JSON.stringify(missingRequired),
        ""
      ].join("\n")
    )

    expect(appendInfection(dir, second)).toBe(true)
    expect(readInfections(dir, "session-1").map(({ kind }) => kind)).toEqual([
      "command-failure",
      "edit-churn"
    ])
    const raw = fs.readFileSync(file, "utf8")
    expect(raw).toContain("{broken\n")
    expect(raw).toContain('{"schema_version":2}\n')
    expect(raw).toContain(`${JSON.stringify(wrongDetails)}\n`)
    expect(raw).toContain(`${JSON.stringify(missingRequired)}\n`)
    expect(raw.endsWith("\n")).toBe(true)
  })
})

test("保存前に secret を redaction し field 上限を適用する", () => {
  withProject((dir) => {
    const lines = Array.from({ length: 25 }, (_, index) => `line-${index}`)
    const source = record(
      "command-failure",
      {
        type: "command-failure",
        command: `API_TOKEN=secret ${"x".repeat(1_100)}`,
        normalized_command: "API_TOKEN=secret",
        exit_code: 1,
        output_tail: `${lines.join("\n")} Authorization: Bearer output-secret`
      },
      {
        input_digest: "PASSWORD=hunter2",
        evidence: `Authorization: Bearer evidence-secret ${"e".repeat(2_100)}`
      }
    )

    appendInfection(dir, source)
    const saved = readInfections(dir, "session-1")[0]
    expect(JSON.stringify(saved)).not.toContain("secret")
    expect(saved.input_digest).toBe("PASSWORD=<redacted>")
    expect(saved.input_digest.length).toBeLessThanOrEqual(500)
    expect(saved.evidence.length).toBeLessThanOrEqual(2_000)
    expect(saved.details.type).toBe("command-failure")
    if (saved.details.type === "command-failure") {
      expect(saved.details.command.length).toBeLessThanOrEqual(1_000)
      expect(saved.details.output_tail.split("\n")).toHaveLength(20)
      expect(saved.details.output_tail.length).toBeLessThanOrEqual(2_000)
    }
  })
})

test("同じ tool_use_id と kind の再送だけを dedupe する", () => {
  withProject((dir) => {
    const base = record("command-failure", detailsByKind[0][1], {
      tool_use_id: "tool-1"
    })
    expect(appendInfection(dir, base)).toBe(true)
    expect(appendInfection(dir, { ...base, id: generateInfectionId() })).toBe(
      false
    )
    expect(
      appendInfection(
        dir,
        record("retry-loop", detailsByKind[1][1], { tool_use_id: "tool-1" })
      )
    ).toBe(true)
    const withoutToolUseId = {
      ...base,
      id: generateInfectionId(),
      tool_use_id: null
    }
    expect(appendInfection(dir, withoutToolUseId)).toBe(true)
    expect(
      appendInfection(dir, { ...withoutToolUseId, id: generateInfectionId() })
    ).toBe(true)
    expect(readInfections(dir, "session-1")).toHaveLength(4)
  })
})

test("mark-distilled は対象 ID の有効行だけを read-modify-write する", () => {
  withProject((dir) => {
    const first = record("command-failure", detailsByKind[0][1])
    const second = record("edit-churn", detailsByKind[3][1])
    appendInfection(dir, first)
    const file = infectionFilePath(dir, "session-1")
    fs.appendFileSync(file, "{broken\n")
    appendInfection(dir, second)

    markInfectionsDistilled(
      dir,
      "session-1",
      [first.id],
      new Date("2026-07-24T02:00:00.000Z")
    )

    const [savedFirst, savedSecond] = readInfections(dir, "session-1")
    expect(savedFirst).toMatchObject({
      id: first.id,
      distilled: true,
      distilled_at: "2026-07-24T02:00:00.000Z"
    })
    expect(savedSecond).toMatchObject({
      id: second.id,
      distilled: false,
      distilled_at: null
    })
    expect(fs.readFileSync(file, "utf8")).toContain("{broken\n")
  })
})
