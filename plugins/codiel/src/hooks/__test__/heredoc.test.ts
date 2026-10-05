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

// 区切り語の形ごとの判別。ANY_HEREDOC_RE の捕捉グループ(2: 単一引用符、3: 二重引用符、
// 4: バックスラッシュ、5: 語)の番号を壊すと、どれかが落ちる
test.each([
  ["バックスラッシュ", "git commit -F - <<\\EOF", RM, "EOF"],
  ["二重引用符", 'git commit -F - <<"EOF"', RM, "EOF"],
  ["タブ付きの終端(<<-'EOF')", "git commit -F - <<-'EOF'", `\t${RM}`, "\tEOF"]
])("引用された区切り語(%s)では本文の行を空にする", (_, head, body, end) => {
  const out = withoutInertBodies([head, body, end].join("\n")).split("\n")
  expect(out).not.toContain(body)
  expect(out[1]).toBe("")
})

test("引用の無い区切り語(<<EOF)では本文の行を残す", () => {
  const command = ["git commit -F - <<EOF", RM, "EOF"].join("\n")
  expect(withoutInertBodies(command).split("\n")).toContain(RM)
})
