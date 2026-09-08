import { expect, test } from "vitest"
import { recurrenceKeyOf, sha256Hex } from "../infection-store.js"
import { recurrenceKey } from "../recurrence.js"
import type {
  InfectionDetails,
  InfectionKind,
  InfectionRecordV1
} from "../types.js"

function record(
  details: InfectionDetails,
  overrides: Partial<InfectionRecordV1> = {}
): InfectionRecordV1 {
  return {
    schema_version: 1,
    id: "infection-20260908-010203004-a1b2c3d4",
    ts: "2026-09-08T01:02:03.004Z",
    kind: details.type,
    session: "session-1",
    hook_event: "PostToolUseFailure",
    tool: "Bash",
    tool_use_id: null,
    input_digest: "input",
    evidence: "evidence",
    fingerprint: sha256Hex("fingerprint"),
    details,
    distilled: false,
    distilled_at: null,
    ...overrides
  }
}

const targets: Array<[InfectionKind, InfectionDetails, InfectionKind, string]> =
  [
    [
      "command-failure",
      {
        type: "command-failure",
        command: "pnpm   test",
        normalized_command: "pnpm test",
        exit_code: 1,
        output_tail: "failed"
      },
      "command-failure",
      "pnpm test"
    ],
    [
      "retry-loop",
      {
        type: "retry-loop",
        command: "pnpm   test",
        normalized_command: "pnpm test",
        consecutive_failures: 3,
        exit_codes: [1, 2, 1]
      },
      "command-failure",
      "pnpm test"
    ],
    [
      "user-rejection",
      {
        type: "user-rejection",
        prompt_excerpt: "その変更ではありません",
        matched_pattern: "ja-rejection",
        previous_tool: { tool: "Edit", input_digest: "digest" }
      },
      "user-rejection",
      "ja-rejection"
    ],
    [
      "edit-churn",
      {
        type: "edit-churn",
        file_path: "src/file.ts",
        line_start: 10,
        line_end: 20,
        edits_in_window: 4
      },
      "edit-churn",
      "src/file.ts"
    ]
  ]

test.each(
  targets
)("%s は安定した target から再発キーを計算する", (_kind, details, keyKind, target) => {
  expect(recurrenceKeyOf(record(details))).toBe(recurrenceKey(keyKind, target))
})

test.each<readonly [InfectionKind, string]>([
  ["command-failure", "pnpm test"],
  ["retry-loop", "pnpm test exits 1,2,1"],
  ["user-rejection", "ja-rejection"],
  ["edit-churn", "src/file.ts"]
])("recurrenceKey(%s) は kind + NUL + target の SHA-256 である", (kind, target) => {
  expect(recurrenceKey(kind, target)).toBe(sha256Hex(`${kind}\0${target}`))
})

test("同一コマンドの複数失敗は可変フィールドが違っても同じ鍵になる", () => {
  const first = record({
    type: "command-failure",
    command: "pnpm test",
    normalized_command: "pnpm test",
    exit_code: 1,
    output_tail: "first failure"
  })
  const second = record(
    {
      type: "command-failure",
      command: "pnpm  test",
      normalized_command: "pnpm test",
      exit_code: 2,
      output_tail: "second failure"
    },
    {
      id: "infection-20260908-010204004-e5f6a7b8",
      ts: "2026-09-08T01:02:04.004Z",
      fingerprint: sha256Hex("different fingerprint")
    }
  )

  expect(recurrenceKeyOf(first)).toBe(recurrenceKeyOf(second))
})

test("command-failure と retry-loop は同一コマンドなら同じ鍵になる", () => {
  const commandFailure = record({
    type: "command-failure",
    command: "pnpm test",
    normalized_command: "pnpm test",
    exit_code: 1,
    output_tail: "failed"
  })
  const retryLoop = record({
    type: "retry-loop",
    command: "pnpm test",
    normalized_command: "pnpm test",
    consecutive_failures: 3,
    exit_codes: [1, 2, 1]
  })

  expect(recurrenceKeyOf(retryLoop)).toBe(recurrenceKeyOf(commandFailure))
  expect(recurrenceKeyOf(retryLoop)).toBe(
    recurrenceKey("command-failure", "pnpm test")
  )
})
