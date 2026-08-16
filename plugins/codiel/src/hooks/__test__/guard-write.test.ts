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

// ---------------------------------------------------------------------------
// ドメイン境界(設計書 16-5 の配線)
// ---------------------------------------------------------------------------

const DOMAINS = {
  frontend: ["src/app/**", "src/components/**"],
  backend: ["src/server/**", "src/api/**"]
}

function writeArchitecture(root: string, domains: Record<string, string[]>) {
  fs.mkdirSync(path.join(root, "docs"), { recursive: true })
  fs.writeFileSync(
    path.join(root, "docs/ARCHITECTURE.md"),
    [
      "# ARCHITECTURE",
      "",
      "```json metatron:domains",
      JSON.stringify(domains, null, 2),
      "```",
      ""
    ].join("\n")
  )
}

// setupRun の run を implement フェーズまで進める。
function advanceToImplement(root: string) {
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
}

test("domain 未設定(キーなし)の state では従来どおり素通し(後方互換)", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  const state = JSON.parse(
    fs.readFileSync(
      path.join(root, ".codiel/runs/issue-1/try-1/state.json"),
      "utf8"
    )
  )
  expect("domain" in state).toBe(false)
  // frontend にしか一致しないパスでも、domain が無ければ境界を課さない
  expect(hook(root, "Edit", path.join(root, "src/app/page.tsx"))).toBe(null)
  expect(hook(root, "Edit", path.join(root, "README.md"))).toBe(null)
})

test("domain が null(clear-domain 後)なら境界を課さない", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  runTs(CLI, ["clear-domain", "--issue", "1"], { cwd: root })
  expect(hook(root, "Edit", path.join(root, "src/app/page.tsx"))).toBe(null)
})

test("domain が backend: 担当範囲内のパスは素通し", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  expect(hook(root, "Edit", path.join(root, "src/server/db.ts"))).toBe(null)
  expect(hook(root, "Write", path.join(root, "src/api/users/route.ts"))).toBe(
    null
  )
})

test("domain が backend: 担当範囲外(frontend の glob)への書き込みは ask", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  const r = hook(root, "Edit", path.join(root, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  // 理由に「書き込み先の相対パス・ドメイン名・そのドメインの glob」が含まれる
  expect(r?.permissionDecisionReason).toContain("src/app/page.tsx")
  expect(r?.permissionDecisionReason).toContain("backend")
  expect(r?.permissionDecisionReason).toContain("src/server/**")
  expect(r?.permissionDecisionReason).toContain("src/api/**")
})

test("ドメインマップに無い domain 名は ask(タイポ・記述漏れ)", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backends"], {
    cwd: root
  })
  const r = hook(root, "Edit", path.join(root, "src/server/db.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("backends")
  expect(r?.permissionDecisionReason).toMatch(/ドメインマップ/)
})

test("ドメインマップが読めない(ARCHITECTURE が無い)なら domain 設定があっても素通し", () => {
  const root = setupRun()
  advanceToImplement(root)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  expect(hook(root, "Edit", path.join(root, "src/app/page.tsx"))).toBe(null)
  expect(hook(root, "Edit", path.join(root, "anywhere/x.ts"))).toBe(null)
})

test("generic 縮退(**)では domain generic はどのパスでも素通し", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, { generic: ["**"] })
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "generic"], {
    cwd: root
  })
  expect(hook(root, "Edit", path.join(root, "src/app/page.tsx"))).toBe(null)
  expect(hook(root, "Edit", path.join(root, "src/server/db.ts"))).toBe(null)
  expect(hook(root, "Write", path.join(root, "README.md"))).toBe(null)
})

test("domain 設定下でも .codiel/ 配下(ハーネス運用資産)はドメイン境界の対象外", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  // テストスクリプトの安定化(codiel-tester)は domain 非紐付けだが、
  // TDD 修正後に clear-domain を呼び忘れたまま tester のターンへ入りうる
  expect(
    hook(
      root,
      "Write",
      path.join(root, ".codiel/specs/unit-1/scripts/a.spec.ts")
    )
  ).toBe(null)
  expect(
    hook(root, "Write", path.join(root, ".codiel/reports/test-run-1.md"))
  ).toBe(null)
  // 免除が効きすぎていないこと: .codiel/ 配下でない越境パスは従来どおり ask
  const r = hook(root, "Edit", path.join(root, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("担当範囲外")
})

test("domain 設定下でも spec.md / cases.md の ask は維持される(免除で潰れない)", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  for (const f of ["spec.md", "cases.md"]) {
    const r = hook(root, "Edit", path.join(root, `.codiel/specs/unit-1/${f}`))
    expect(r?.permissionDecision).toBe("ask")
    expect(r?.permissionDecisionReason).toMatch(/test-designer/)
  }
})

test("文書フェーズでは domain の判定が働かない(既存の文書フェーズ判定が優先)", () => {
  const root = setupRun()
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: root
  })
  // 範囲内(src/server/**)でも文書フェーズなので ask。理由はドメインではなく文書フェーズ
  const r = hook(root, "Write", path.join(root, "src/server/db.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/文書フェーズ\(init\)/)
  expect(r?.permissionDecisionReason).not.toMatch(/担当範囲/)
  // 範囲外の docs / .codiel は文書フェーズの規則どおり素通し
  expect(hook(root, "Write", path.join(root, "docs/notes.md"))).toBe(null)
  expect(
    hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/issue.md"))
  ).toBe(null)
})
