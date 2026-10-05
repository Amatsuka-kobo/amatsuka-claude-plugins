import { expect, test } from "vitest"
import { withoutInertBodies } from "../heredoc.js"

const RM = "rm .codiel/runs/x/try-1/state.json"

test('引用の中にバックスラッシュを含む区切り語(<<"E\\$OF")の本文は外さず、走査に残す', () => {
  // bash は引用を外して区切り語を E$OF とするので、物理行の `E\$OF` は終端にならない
  const command = [
    'git commit -F - <<"E\\$OF"',
    "メッセージ",
    "E$OF",
    RM,
    "E\\$OF"
  ].join("\n")
  expect(withoutInertBodies(command).split("\n")).toContain(RM)
})

test("引用された英数字の区切り語のコミットメッセージは、本文の行を空にする", () => {
  const command = ["git commit -F - <<'EOF'", RM, "EOF"].join("\n")
  expect(withoutInertBodies(command).split("\n")).not.toContain(RM)
})
