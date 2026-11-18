import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { readState, writeState } from "../../codiel-state.js"
import { runTs } from "../../testing/run-ts.js"
import {
  advanceRunTo,
  CLI,
  hook,
  INIT_DEFAULTS,
  initOnly,
  intentPath,
  SLUG,
  setupRun,
  statePathFor
} from "./helpers/guard-write-fixtures.js"

// ---------------------------------------------------------------------------
// docs/intents/** の規則(設計書 §6.8)。判定の順序は
// (1) state.intent のファイルか → 当たれば全フェーズで通す
// (2) docs/intents/** の規則(直下の *.md、domains/** で通すフェーズが違う)
// (3) 従来の DOC_PHASES / CODE_PHASES / catch-all
// ---------------------------------------------------------------------------

test("state.intent のファイルは intent・discuss・design・implement フェーズで書き込める", () => {
  const rootIntent = setupRun()
  expect(hook(rootIntent, "Write", intentPath(rootIntent))).toBe(null)

  for (const phase of ["discuss", "design", "implement"]) {
    const root = setupRun()
    advanceRunTo(root, phase)
    expect(hook(root, "Write", intentPath(root))).toBe(null)
  }
})

test("state.intent のファイルは review・fix-loop・finalize フェーズでも書き込める", () => {
  for (const phase of ["review", "fix-loop", "finalize"]) {
    const root = setupRun()
    advanceRunTo(root, phase)
    expect(hook(root, "Write", intentPath(root))).toBe(null)
  }
})

test("docs/intents/ の同じディレクトリにある別のファイル(1 文字違い)は design フェーズで ask になる", () => {
  const root = setupRun()
  advanceRunTo(root, "design")
  // state.intent は docs/intents/2026-09-27-demo.md。末尾を 1 文字だけ変えた
  // 別ファイルが、規則外のフェーズで ask になることを確かめる。
  const sibling = path.join(root, "docs/intents/2026-09-27-demp.md")
  const r = hook(root, "Write", sibling)
  expect(r?.permissionDecision).toBe("ask")
})

test("docs/intents/*.md(直下)は phase null・intent・intent-sync・triage で通る", () => {
  const other = "docs/intents/2026-09-27-other.md"

  const rootNull = initOnly()
  expect(hook(rootNull, "Write", path.join(rootNull, other))).toBe(null)

  const rootIntent = setupRun()
  expect(hook(rootIntent, "Write", path.join(rootIntent, other))).toBe(null)

  const rootIntentSync = setupRun()
  advanceRunTo(rootIntentSync, "intent-sync")
  expect(hook(rootIntentSync, "Write", path.join(rootIntentSync, other))).toBe(
    null
  )

  const rootTriage = setupRun()
  advanceRunTo(rootTriage, "triage")
  expect(hook(rootTriage, "Write", path.join(rootTriage, other))).toBe(null)
})

test("docs/intents/*.md(直下)は discuss・implement・pr など規則外のフェーズで ask になる", () => {
  const other = "docs/intents/2026-09-27-other.md"
  for (const phase of ["discuss", "test-spec", "implement", "pr", "review"]) {
    const root = setupRun()
    advanceRunTo(root, phase)
    const r = hook(root, "Write", path.join(root, other))
    expect(r?.permissionDecision).toBe("ask")
  }
})

test("docs/intents/domains/** は intent-sync だけで通る", () => {
  const domainFile = "docs/intents/domains/frontend.md"
  const root = setupRun()
  advanceRunTo(root, "intent-sync")
  expect(hook(root, "Write", path.join(root, domainFile))).toBe(null)
})

test("docs/intents/domains/** は intent・phase null・triage で ask になる(intent は DOC_PHASES に入るが ask)", () => {
  const domainFile = "docs/intents/domains/frontend.md"

  const rootNull = initOnly()
  expect(
    hook(rootNull, "Write", path.join(rootNull, domainFile))?.permissionDecision
  ).toBe("ask")

  const rootIntent = setupRun()
  expect(
    hook(rootIntent, "Write", path.join(rootIntent, domainFile))
      ?.permissionDecision
  ).toBe("ask")

  const rootTriage = setupRun()
  advanceRunTo(rootTriage, "triage")
  expect(
    hook(rootTriage, "Write", path.join(rootTriage, domainFile))
      ?.permissionDecision
  ).toBe("ask")
})

test("docs/intents/domains/** は triage が passed の後(finalize の作業中)に通る", () => {
  const domainFile = "docs/intents/domains/frontend.md"
  const root = setupRun()
  advanceRunTo(root, "triage")
  // finalize は start-phase を呼ばないので、phase は triage のまま triage だけが passed になる
  const p = statePathFor(root, SLUG)
  const state = readState(p)
  state.phases.triage.status = "passed"
  writeState(p, state)
  expect(hook(root, "Write", path.join(root, domainFile))).toBe(null)
})

test("phase null で docs/intents/*.md 以外(.codiel 外のソース)への書き込みは従来どおり ask になる", () => {
  const root = initOnly()
  const r = hook(root, "Write", path.join(root, "src/app.ts"))
  expect(r?.permissionDecision).toBe("ask")
})

test("active run が無ければ docs/intents/** への書き込みも素通し", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  expect(
    hook(root, "Write", path.join(root, "docs/intents/2026-09-27-x.md"))
  ).toBe(null)
  expect(
    hook(root, "Write", path.join(root, "docs/intents/domains/frontend.md"))
  ).toBe(null)
})

test("docs/intents/** の規則は大文字小文字の違う綴りでもすり抜けない", () => {
  const root = setupRun()
  advanceRunTo(root, "design")
  for (const f of [
    "docs/intents/Domains/frontend.md",
    "docs/Intents/domains/frontend.md",
    "docs/intents/2026-09-27-other.MD"
  ])
    expect(hook(root, "Write", path.join(root, f))?.permissionDecision, f).toBe(
      "ask"
    )
})

const DESIGN_DOC = "docs/intents/design/api.md"

test("docs/intents/design/** は intent-sync で通る", () => {
  const root = setupRun()
  advanceRunTo(root, "intent-sync")
  expect(hook(root, "Write", path.join(root, DESIGN_DOC))).toBe(null)
})

test("docs/intents/design/** は文書フェーズとコード系フェーズで ask になる", () => {
  for (const phase of [
    "intent",
    "discuss",
    "design",
    "test-spec",
    "dev-plan",
    "carry-over",
    "test-code",
    "implement",
    "test-loop",
    "fix-loop"
  ]) {
    const root = setupRun()
    advanceRunTo(root, phase)
    const r = hook(root, "Write", path.join(root, DESIGN_DOC))
    expect(r?.permissionDecision, phase).toBe("ask")
    expect(r?.permissionDecisionReason, phase).toBe(
      `設計資料(${DESIGN_DOC})への書き込みは intent-sync フェーズの担当です(現在のフェーズ: ${phase})`
    )
  }
})

test("docs/intents/design/** は triage が passed の後(finalize の作業中)も ask になる", () => {
  const root = setupRun()
  advanceRunTo(root, "triage")
  const p = statePathFor(root, SLUG)
  const state = readState(p)
  state.phases.triage.status = "passed"
  writeState(p, state)
  expect(
    hook(root, "Write", path.join(root, DESIGN_DOC))?.permissionDecision
  ).toBe("ask")
})

test("docs/intents/design/** は大文字小文字の違う綴りでも、symlink 経由でもすり抜けない", () => {
  const real = fs.realpathSync(setupRun())
  advanceRunTo(real, "design")
  expect(
    hook(real, "Write", path.join(real, "docs/Intents/Design/api.md"))
      ?.permissionDecision
  ).toBe("ask")
  const link = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gw-link-"))),
    "repo-link"
  )
  fs.symlinkSync(real, link, "dir")
  expect(
    hook(link, "Write", path.join(link, DESIGN_DOC))?.permissionDecision
  ).toBe("ask")
})

// ---------------------------------------------------------------------------
// intent 文書の基準は repoRoot(git ルート)である(設計書 §6.2.1・§6.3.1・§6.8)。
// `.codiel` を git ルートの下のディレクトリに作った構成では codielRoot と一致しない。
// ---------------------------------------------------------------------------

// git ルート repo の下の repo/app に .codiel を置き、cwd=repo/app で init する。
function setupNestedRun(): { repo: string; app: string } {
  const repo = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gw-nested-"))
  )
  execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" })
  const app = path.join(repo, "app")
  fs.mkdirSync(app)
  const args = ["init", "--slug", SLUG]
  for (const [k, v] of Object.entries(INIT_DEFAULTS)) args.push(`--${k}`, v)
  runTs(CLI, args, { cwd: app })
  return { repo, app }
}

test(".codiel が git ルートの下にあっても、state.intent のファイルは phase null と design で通る", () => {
  const { repo, app } = setupNestedRun()
  const intent = path.join(repo, INIT_DEFAULTS.intent)
  expect(hook(app, "Write", intent)).toBe(null)
  advanceRunTo(app, "design")
  expect(hook(app, "Write", intent)).toBe(null)
  // 1 文字違いの別の intent は規則外のフェーズで ask のまま
  const sibling = path.join(repo, "docs/intents/2026-09-27-demp.md")
  expect(hook(app, "Write", sibling)?.permissionDecision).toBe("ask")
})

test(".codiel が git ルートの下にあっても、docs/intents/** の規則は repoRoot 基準で当たる", () => {
  const other = "docs/intents/2026-09-27-other.md"
  const domainFile = "docs/intents/domains/frontend.md"

  const nullRun = setupNestedRun()
  expect(hook(nullRun.app, "Write", path.join(nullRun.repo, other))).toBeNull()

  const syncRun = setupNestedRun()
  advanceRunTo(syncRun.app, "intent-sync")
  expect(
    hook(syncRun.app, "Write", path.join(syncRun.repo, domainFile))
  ).toBeNull()

  const designRun = setupNestedRun()
  advanceRunTo(designRun.app, "design")
  const r = hook(designRun.app, "Write", path.join(designRun.repo, domainFile))
  expect(r?.permissionDecision).toBe("ask")
  // 理由のパスも repoRoot 相対(codielRoot 基準の ../docs/… ではない)
  expect(r?.permissionDecisionReason).toContain(`持続層(${domainFile})`)
})

test("symlink 経由の cwd で docs/intents/domains/ がまだ無くても、持続層の規則が当たる", () => {
  const real = fs.realpathSync(setupRun())
  advanceRunTo(real, "design")
  const link = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gw-link-"))),
    "repo-link"
  )
  fs.symlinkSync(real, link, "dir")
  // 親ディレクトリ(docs/intents/domains/)が無いので、1 段の実体化では論理パスのまま残り、
  // 実体パスの repoRoot との相対が ../ に落ちて docs/ の素通しに紛れる
  expect(
    hook(link, "Write", path.join(link, "docs/intents/domains/frontend.md"))
      ?.permissionDecision
  ).toBe("ask")
})
