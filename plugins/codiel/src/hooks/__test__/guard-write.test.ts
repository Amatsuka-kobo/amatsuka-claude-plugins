import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../guard-write.ts", import.meta.url))
const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url))

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny/ask など出力がある場合は hookSpecificOutput を返す。
interface HookOutput {
  permissionDecision: string
  permissionDecisionReason: string
}

function hook(
  cwd: string,
  toolName: string,
  filePath: string
): HookOutput | null {
  const input = JSON.stringify({
    cwd,
    tool_name: toolName,
    tool_input: { file_path: filePath }
  })
  const out = runTs(HOOK, [], { input })
  if (out === "") return null
  return (JSON.parse(out) as { hookSpecificOutput: HookOutput })
    .hookSpecificOutput
}
function setupRun(phasesToPass: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-write-"))
  runTs(CLI, ["init", "--issue", "1"], { cwd: root })
  runTs(CLI, ["start-phase", "init", "--issue", "1"], { cwd: root })
  for (const ph of phasesToPass) {
    runTs(
      CLI,
      [
        "pass-gate",
        ph,
        "--issue",
        "1",
        "--evaluation-id",
        "e",
        "--verdict",
        "PROCEED"
      ],
      { cwd: root }
    )
    // 次フェーズの start は呼び出し側で
  }
  return root
}

test("state.json への直接書き込みは run の有無に関わらず deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const r = hook(
    root,
    "Write",
    path.join(root, ".codiel/runs/issue-1/try-1/state.json")
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("アクティブ run がなければ通常の書き込みは素通し(無出力)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const r = hook(root, "Edit", path.join(root, "src/index.ts"))
  expect(r).toBe(null)
})

test("文書フェーズ(init)中の src への書き込みは ask、.codiel 配下は素通し(無出力)", () => {
  const root = setupRun()
  expect(
    hook(root, "Write", path.join(root, "src/app.ts"))?.permissionDecision
  ).toBe("ask")
  expect(
    hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/issue.md"))
  ).toBe(null)
})

test("implement フェーズ中: src は素通し、specs の cases.md は ask", () => {
  const root = setupRun()
  const cli = (args: string[]) => runTs(CLI, args, { cwd: root })
  cli([
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  cli(["start-phase", "discuss", "--issue", "1"])
  cli(["complete-phase", "discuss", "--issue", "1"])
  for (const ph of ["design", "test-spec", "dev-plan"]) {
    cli(["start-phase", ph, "--issue", "1"])
    cli([
      "pass-gate",
      ph,
      "--issue",
      "1",
      "--evaluation-id",
      "e",
      "--verdict",
      "PROCEED"
    ])
  }
  cli(["start-phase", "implement", "--issue", "1"])
  expect(hook(root, "Edit", path.join(root, "src/app.ts"))).toBe(null)
  expect(
    hook(root, "Edit", path.join(root, ".codiel/specs/screen-login/cases.md"))
      ?.permissionDecision
  ).toBe("ask")
  expect(
    hook(root, "Edit", path.join(root, ".codiel/specs/screen-login/spec.md"))
      ?.permissionDecision
  ).toBe("ask")
  expect(
    hook(
      root,
      "Write",
      path.join(root, ".codiel/specs/screen-login/scripts/login.spec.ts")
    )
  ).toBe(null)
})

test("cwd がサブディレクトリでも state.json への絶対パス書き込みは deny(バイパス再現)", () => {
  const root = setupRun()
  const srcDir = path.join(root, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  const abs = path.join(root, ".codiel/runs/issue-1/try-1/state.json")
  const r = hook(srcDir, "Write", abs)
  expect(r?.permissionDecision).toBe("deny")
})

test("state.json 保護は大文字パスでもバイパスされない(ケース非依存)", () => {
  const root = setupRun()
  const abs = path.join(root, ".CODIEL/RUNS/issue-1/try-1/state.json")
  const r = hook(root, "Write", abs)
  expect(r?.permissionDecision).toBe("deny")
})

test("discuss フェーズ中: .codiel 配下(agenda.md/discussion.md)は素通し、src への書き込みは ask", () => {
  const root = setupRun()
  const cli = (args: string[]) => runTs(CLI, args, { cwd: root })
  cli([
    "pass-gate",
    "init",
    "--issue",
    "1",
    "--evaluation-id",
    "e",
    "--verdict",
    "PROCEED"
  ])
  cli(["start-phase", "discuss", "--issue", "1"])
  expect(
    hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/agenda.md"))
  ).toBe(null)
  expect(
    hook(
      root,
      "Write",
      path.join(root, ".codiel/runs/issue-1/try-1/discussion.md")
    )
  ).toBe(null)
  const r = hook(root, "Write", path.join(root, "src/app.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/文書フェーズ\(discuss\)/)
  expect(hook(root, "Write", path.join(root, "docs/notes.md"))).toBe(null)
})

test("cwd がサブディレクトリでも文書フェーズ制御が機能する(root/src への書き込みは ask)", () => {
  const root = setupRun()
  const srcDir = path.join(root, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  const r = hook(srcDir, "Write", path.join(root, "src/app.ts"))
  expect(r?.permissionDecision).toBe("ask")
})
