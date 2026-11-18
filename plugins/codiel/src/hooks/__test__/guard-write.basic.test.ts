import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  advanceRunTo,
  advanceToImplement,
  hook,
  setupRun
} from "./helpers/guard-write-fixtures.js"

test("state.json への直接書き込みは run の有無に関わらず deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const r = hook(
    root,
    "Write",
    path.join(root, ".codiel/runs/demo/try-1/state.json")
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("アクティブ run がなければ通常の書き込みは素通し(無出力)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const r = hook(root, "Edit", path.join(root, "src/index.ts"))
  expect(r).toBe(null)
})

test("文書フェーズ(intent)中の src への書き込みは ask、.codiel 配下は素通し(無出力)", () => {
  const root = setupRun()
  expect(
    hook(root, "Write", path.join(root, "src/app.ts"))?.permissionDecision
  ).toBe("ask")
  expect(
    hook(root, "Write", path.join(root, ".codiel/runs/demo/try-1/issue.md"))
  ).toBe(null)
})

test("implement フェーズ中: src は素通し、testsDir の cases.md と spec.md は ask", () => {
  const root = setupRun()
  advanceToImplement(root)
  expect(hook(root, "Edit", path.join(root, "src/app.ts"))).toBe(null)
  expect(
    hook(
      root,
      "Edit",
      path.join(root, "docs/codiel/tests/e2e/frontend/login/cases.md")
    )?.permissionDecision
  ).toBe("ask")
  expect(
    hook(
      root,
      "Edit",
      path.join(root, "docs/codiel/tests/e2e/frontend/login/spec.md")
    )?.permissionDecision
  ).toBe("ask")
  expect(
    hook(
      root,
      "Write",
      path.join(root, ".codiel/runs/demo/try-1/steps/step-1/report.md")
    )
  ).toBe(null)
})

test("cwd がサブディレクトリでも state.json への絶対パス書き込みは deny(バイパス再現)", () => {
  const root = setupRun()
  const srcDir = path.join(root, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  const abs = path.join(root, ".codiel/runs/demo/try-1/state.json")
  const r = hook(srcDir, "Write", abs)
  expect(r?.permissionDecision).toBe("deny")
})

test("symlink を通した state.json への Write は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const tryDir = path.join(root, ".codiel/runs/demo/try-1")
  fs.mkdirSync(tryDir, { recursive: true })
  fs.symlinkSync(tryDir, path.join(root, "link"), "dir")
  const r = hook(root, "Write", path.join(root, "link", "state.json"))
  expect(r?.permissionDecision).toBe("deny")
})

test("symlink を通した alias/../state.json への Write は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const reports = path.join(root, ".codiel/runs/demo/try-1/reports")
  fs.mkdirSync(reports, { recursive: true })
  fs.symlinkSync(reports, path.join(root, "alias"), "dir")
  // path.join は .. を畳むので、生の文字列で渡す
  const r = hook(root, "Write", `${root}/alias/../state.json`)
  expect(r?.permissionDecision).toBe("deny")
})

test(".codiel/runs 自体が外のディレクトリへの symlink のとき、別名を通した state.json への Write は deny(H3)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gw-runs-"))
  fs.mkdirSync(path.join(outside, "x/try-1"), { recursive: true })
  fs.mkdirSync(path.join(root, ".codiel"))
  fs.symlinkSync(outside, path.join(root, ".codiel/runs"), "dir")
  fs.symlinkSync(
    path.join(outside, "x/try-1"),
    path.join(root, ".codiel/alias"),
    "dir"
  )
  const r = hook(root, "Write", path.join(root, ".codiel/alias/state.json"))
  expect(r?.permissionDecision).toBe("deny")
})

test("存在しない中間ディレクトリを挟んだ nodir/../alias/state.json への Write は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const tryDir = path.join(root, ".codiel/runs/demo/try-1")
  fs.mkdirSync(tryDir, { recursive: true })
  fs.symlinkSync(tryDir, path.join(root, "alias"), "dir")
  const r = hook(root, "Write", `${root}/nodir/../alias/state.json`)
  expect(r?.permissionDecision).toBe("deny")
})

test("state.json 保護は大文字パスでもバイパスされない(ケース非依存)", () => {
  const root = setupRun()
  const abs = path.join(root, ".CODIEL/RUNS/demo/try-1/state.json")
  const r = hook(root, "Write", abs)
  expect(r?.permissionDecision).toBe("deny")
})

test("discuss フェーズ中: .codiel 配下(agenda.md/discussion.md)は素通し、src への書き込みは ask", () => {
  const root = setupRun()
  advanceRunTo(root, "discuss")
  expect(
    hook(root, "Write", path.join(root, ".codiel/runs/demo/try-1/agenda.md"))
  ).toBe(null)
  expect(
    hook(
      root,
      "Write",
      path.join(root, ".codiel/runs/demo/try-1/discussion.md")
    )
  ).toBe(null)
  const r = hook(root, "Write", path.join(root, "src/app.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/文書フェーズ\(discuss\)/)
  expect(hook(root, "Write", path.join(root, "docs/notes.md"))).toBe(null)
})

test("discuss フェーズ中: <runsDir>/<slug>/ の agenda.md・discussion.md は素通し", () => {
  const root = setupRun()
  advanceRunTo(root, "discuss")
  for (const f of ["agenda.md", "discussion.md"])
    expect(
      hook(root, "Write", path.join(root, `docs/codiel/runs/demo/${f}`)),
      f
    ).toBe(null)
})

test("cwd がサブディレクトリでも文書フェーズ制御が機能する(root/src への書き込みは ask)", () => {
  const root = setupRun()
  const srcDir = path.join(root, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  const r = hook(srcDir, "Write", path.join(root, "src/app.ts"))
  expect(r?.permissionDecision).toBe("ask")
})
