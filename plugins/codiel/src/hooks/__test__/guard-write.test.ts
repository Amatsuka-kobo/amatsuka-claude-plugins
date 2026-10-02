import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  GATED,
  type RunState,
  readState,
  STAGES,
  type StepState,
  writeState
} from "../../codiel-state.js"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../guard-write.ts", import.meta.url))
const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url))

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny/ask など出力がある場合は hookSpecificOutput を返す。
interface HookOutput {
  permissionDecision: string
  permissionDecisionReason: string
}

// env を渡すと、フックの環境変数に足す(RAGUEL_CONFIG を指すときに使う)
function hook(
  cwd: string,
  toolName: string,
  filePath: string,
  env: Record<string, string> = {}
): HookOutput | null {
  const input = JSON.stringify({
    cwd,
    tool_name: toolName,
    tool_input: { file_path: filePath }
  })
  const out = runTs(HOOK, [], { input, env: { ...process.env, ...env } })
  if (out === "") return null
  return (JSON.parse(out) as { hookSpecificOutput: HookOutput })
    .hookSpecificOutput
}

const SLUG = "demo"
// init の必須フラグの既定値。intent は state.intent とも一致させ、
// 「state.intent のファイル」の判定を実際に検証できるようにする。
const INIT_DEFAULTS: Record<string, string> = {
  intent: "docs/intents/2026-09-27-demo.md",
  integration: "github",
  scale: "standard",
  "knowledge-target": "metatron",
  "image-upload": "gh-attach,chrome"
}

function intentPath(root: string): string {
  return path.join(root, INIT_DEFAULTS.intent)
}

// init だけを行い、start-phase を呼ばない(state.phase が null の run)。
function initOnly(slug = SLUG): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-write-"))
  const args = ["init", "--slug", slug]
  for (const [k, v] of Object.entries(INIT_DEFAULTS)) args.push(`--${k}`, v)
  runTs(CLI, args, { cwd: root })
  return root
}

// init の後、intent フェーズを in_progress にする。
function setupRun(slug = SLUG): string {
  const root = initOnly(slug)
  runTs(CLI, ["start-phase", "intent", "--slug", slug], { cwd: root })
  return root
}

const PHASE_SEQUENCE = STAGES.flat()

function statePathFor(root: string, slug: string): string {
  return path.join(root, ".codiel/runs", slug, "try-1/state.json")
}

// root の run を、targetPhase が in_progress になるまで進める。CLI を 1 フェーズ
// ずつ子プロセスで起動すると run 数が増えるほど遅くなるため、state.json を直接
// 組み立てる(guard-write が読むのは state.json の内容だけであり、CLI 側の
// バリデーションはここでの検証対象ではない)。手前までの GATED なフェーズは
// pass-gate 相当、それ以外は complete-phase 相当で終える
// (pr だけ integration が github の run に必須の pr.url を添える)。
function advanceRunTo(root: string, targetPhase: string, slug = SLUG): void {
  const p = statePathFor(root, slug)
  const state = readState(p)
  const idx = PHASE_SEQUENCE.indexOf(targetPhase)
  for (let i = 0; i < idx; i++) {
    const ph = PHASE_SEQUENCE[i]
    const phaseState = state.phases[ph]
    if (GATED.has(ph)) {
      phaseState.evaluationId = "e"
      phaseState.verdict = "PROCEED"
    } else if (ph === "pr") {
      state.pr.url = "https://example.com/pr/1"
    }
    phaseState.status = "passed"
  }
  state.phases[targetPhase].status = "in_progress"
  state.phase = targetPhase
  writeState(p, state)
}

// setupRun の run を implement フェーズまで進める。
function advanceToImplement(root: string): void {
  advanceRunTo(root, "implement")
}

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

test("domain 未設定(キーなし)の state では従来どおり素通し(後方互換)", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  const state = JSON.parse(
    fs.readFileSync(
      path.join(root, ".codiel/runs/demo/try-1/state.json"),
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
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  runTs(CLI, ["clear-domain", "--slug", SLUG], { cwd: root })
  expect(hook(root, "Edit", path.join(root, "src/app/page.tsx"))).toBe(null)
})

test("domain が backend: 担当範囲内のパスは素通し", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
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
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
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
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backends"], {
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
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  expect(hook(root, "Edit", path.join(root, "src/app/page.tsx"))).toBe(null)
  expect(hook(root, "Edit", path.join(root, "anywhere/x.ts"))).toBe(null)
})

test("generic 縮退(**)では domain generic はどのパスでも素通し", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, { generic: ["**"] })
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "generic"], {
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
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  // ドメインに紐付かない委譲(テストの実行)は、コードの修正の後に clear-domain を
  // 呼び忘れたまま報告を書きうる
  expect(
    hook(
      root,
      "Write",
      path.join(root, ".codiel/runs/demo/try-1/steps/step-1/report.md")
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

test("domain 設定下でも spec.md / cases.md はドメイン境界より先にテストの保護で ask になる", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  for (const f of ["spec.md", "cases.md"]) {
    const r = hook(
      root,
      "Edit",
      path.join(root, `docs/codiel/tests/units/x.ts/${f}`)
    )
    expect(r?.permissionDecision).toBe("ask")
    expect(r?.permissionDecisionReason).toMatch(/test-spec と test-code/)
  }
})

test("文書フェーズでは domain の判定が働かない(既存の文書フェーズ判定が優先)", () => {
  const root = setupRun()
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  // 範囲内(src/server/**)でも文書フェーズなので ask。理由はドメインではなく文書フェーズ
  const r = hook(root, "Write", path.join(root, "src/server/db.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/文書フェーズ\(intent\)/)
  expect(r?.permissionDecisionReason).not.toMatch(/担当範囲/)
  // 範囲外の docs / .codiel は文書フェーズの規則どおり素通し
  expect(hook(root, "Write", path.join(root, "docs/notes.md"))).toBe(null)
  expect(
    hook(root, "Write", path.join(root, ".codiel/runs/demo/try-1/issue.md"))
  ).toBe(null)
})

// ---------------------------------------------------------------------------
// 座標系(契約 §3): ドメイン境界の glob 照合は docRoot 基準、.codiel/ の判定は
// codielRoot 基準。契約は両者が異なる構成を正常と定めるため、同じ相対パスで
// 両方を判定してはならない。
// ---------------------------------------------------------------------------

// repo/.codiel/ と repo/sub/metatron.config.json が併存する構成を作る。
// codielRoot = repo、docRoot = repo/sub になる。ARCHITECTURE は repo/sub/docs/ だけに置く。
function setupSplitRoots(): { codielRoot: string; docRoot: string } {
  const codielRoot = setupRun()
  advanceToImplement(codielRoot)
  const docRoot = path.join(codielRoot, "sub")
  fs.mkdirSync(docRoot, { recursive: true })
  fs.writeFileSync(
    path.join(docRoot, "metatron.config.json"),
    `${JSON.stringify({ version: 1 }, null, 2)}\n`
  )
  writeArchitecture(docRoot, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: codielRoot
  })
  return { codielRoot, docRoot }
}

test("docRoot ≠ codielRoot: 担当範囲内の書き込みは docRoot 基準で素通し", () => {
  const { docRoot } = setupSplitRoots()
  // docRoot 基準では src/server/db.ts。codielRoot 基準の sub/src/server/db.ts で
  // 照合すると、正当な書き込みが範囲外の ask になる。
  expect(hook(docRoot, "Edit", path.join(docRoot, "src/server/db.ts"))).toBe(
    null
  )
  expect(
    hook(docRoot, "Write", path.join(docRoot, "src/api/users/route.ts"))
  ).toBe(null)
})

test("docRoot ≠ codielRoot: 担当範囲外は ask、理由の相対パスも docRoot 基準", () => {
  const { docRoot } = setupSplitRoots()
  const r = hook(docRoot, "Edit", path.join(docRoot, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("担当範囲外")
  expect(r?.permissionDecisionReason).toContain("src/app/page.tsx")
  // codielRoot 基準の sub/src/app/page.tsx が出ていたら座標系が混ざっている
  expect(r?.permissionDecisionReason).not.toContain("sub/src/app/page.tsx")
})

test("docRoot ≠ codielRoot: 未知の domain 名の ask も docRoot 基準のパスを示す", () => {
  const { codielRoot, docRoot } = setupSplitRoots()
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backends"], {
    cwd: codielRoot
  })
  const r = hook(docRoot, "Edit", path.join(docRoot, "src/server/db.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/ドメインマップ/)
  expect(r?.permissionDecisionReason).toContain("src/server/db.ts")
  expect(r?.permissionDecisionReason).not.toContain("sub/src/server/db.ts")
})

test("docRoot ≠ codielRoot でも .codiel/ 配下は codielRoot 基準で素通し", () => {
  const { codielRoot, docRoot } = setupSplitRoots()
  // docRel は ../.codiel/... になるため、この判定まで docRoot 基準にすると
  // ハーネス運用資産への正当な書き込みが ask に落ちる(過剰修正のガード)。
  expect(
    hook(
      docRoot,
      "Write",
      path.join(codielRoot, ".codiel/reports/test-run-1.md")
    )
  ).toBe(null)
  expect(
    hook(
      docRoot,
      "Write",
      path.join(codielRoot, ".codiel/runs/demo/try-1/steps/step-1/report.md")
    )
  ).toBe(null)
  // テストの保護(spec.md / cases.md)は docRoot ではなく repoRoot 基準で当たる
  expect(
    hook(
      docRoot,
      "Edit",
      path.join(codielRoot, "docs/codiel/tests/units/x.ts/spec.md")
    )?.permissionDecision
  ).toBe("ask")
})

test("docRoot = codielRoot の通常構成では既存の挙動が変わらない(回帰ガード)", () => {
  const root = setupRun()
  advanceToImplement(root)
  fs.writeFileSync(
    path.join(root, "metatron.config.json"),
    `${JSON.stringify({ version: 1 }, null, 2)}\n`
  )
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  expect(hook(root, "Edit", path.join(root, "src/server/db.ts"))).toBe(null)
  const r = hook(root, "Edit", path.join(root, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("src/app/page.tsx")
  expect(
    hook(root, "Write", path.join(root, ".codiel/reports/test-run-1.md"))
  ).toBe(null)
})

// ---------------------------------------------------------------------------
// 警告の到達(契約 §1「警告は経路を問わず返す」の、PreToolUse hook における限界)
//
// PreToolUse hook が出せるのは deny / ask / 無出力の 3 つだけで、「素通しするが警告は
// ある」を表現する口が無い。そのため素通し時の警告は届かない(契約 §1 に明記した限界)。
// 届く経路は CLI・検証コマンド・**ask の理由**である。境界判定が誤っているかもしれない
// 文脈でこそ警告が要るので、ask の理由に添える。
// ---------------------------------------------------------------------------

// ドメインマップブロックを 2 つ持つ ARCHITECTURE。採られるのは最初のものだけ
// (契約 §1)。2 つ目は「もし後勝ちなら素通しになる」形にして、取り違えを検出する。
function writeDuplicateArchitecture(root: string) {
  fs.mkdirSync(path.join(root, "docs"), { recursive: true })
  fs.writeFileSync(
    path.join(root, "docs/ARCHITECTURE.md"),
    [
      "# ARCHITECTURE",
      "",
      "```json metatron:domains",
      JSON.stringify(DOMAINS, null, 2),
      "```",
      "",
      "```json metatron:domains",
      JSON.stringify({ backend: ["**"] }, null, 2),
      "```",
      ""
    ].join("\n")
  )
}

test("重複ブロックがある状態で担当範囲外へ書き込むと ask の理由に警告が添う", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeDuplicateArchitecture(root)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  const r = hook(root, "Edit", path.join(root, "src/app/page.tsx"))
  // 2 つ目のブロック({ backend: ["**"] })が採られていたら素通しになる
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("担当範囲外")
  expect(r?.permissionDecisionReason).toContain("metatron:domains")
  expect(r?.permissionDecisionReason).toContain("2 個")
})

test("重複ブロックがある状態では未知の domain 名の ask にも警告が添う", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeDuplicateArchitecture(root)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backends"], {
    cwd: root
  })
  const r = hook(root, "Edit", path.join(root, "src/server/db.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/ドメインマップ/)
  expect(r?.permissionDecisionReason).toContain("metatron:domains")
})

test("警告が無ければ ask の理由に警告欄は出ない(定型文を足さない)", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeArchitecture(root, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: root
  })
  const r = hook(root, "Edit", path.join(root, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).not.toContain("警告")
})

// ---------------------------------------------------------------------------
// symlink 経由の cwd(契約 §3 規則 1 の細目)
//
// findDocRoot は開始ディレクトリを実体パス化する。docRel を論理パスのまま取ると
// 座標系が割れ、/tmp/link -> /repo のとき docRel が `../tmp/link/src/...` になって
// **担当範囲内の書き込みが範囲外として ask される**。
// 一方 codielRel は findProjectRoot が論理パスを辿るため論理パス基準のままにする。
// ---------------------------------------------------------------------------

function setupSymlinkedRepo(): { real: string; link: string } {
  const real = fs.realpathSync(setupRun())
  advanceToImplement(real)
  writeArchitecture(real, DOMAINS)
  runTs(CLI, ["set-domain", "--slug", SLUG, "--domain", "backend"], {
    cwd: real
  })
  // 実運用の新規ファイル作成に合わせ、書き込み先の親を作っておく。
  fs.mkdirSync(path.join(real, "src/server"), { recursive: true })
  fs.mkdirSync(path.join(real, "src/app"), { recursive: true })
  // **`.codiel/` 側の親も作る。** 親が無いと、親 1 つだけを実体化する手法(metatron の
  // realpathOrParent)は入力をそのまま返す。その手法で codielRel を実体パス基準に揃えても
  // 論理パス基準のままでも同じ値になる。
  // つまり「codielRel は論理パス基準のまま」という不変条件を張ったつもりのテストが、
  // 実体パス基準へ揃える改変を通してしまう(変異が生き残る)。実運用でも 2 本目以降の
  // レポートやスペックは既存ディレクトリへ書かれるので、親が在る側が既定の状況である。
  fs.mkdirSync(path.join(real, ".codiel/reports"), { recursive: true })
  fs.mkdirSync(path.join(real, ".codiel/runs/demo/try-1/steps/step-1"), {
    recursive: true
  })
  const linkParent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gw-link-"))
  )
  const link = path.join(linkParent, "repo-link")
  // symlink を作れない環境でも黙って飛ばさない。作成に失敗すればテストが落ちる。
  fs.symlinkSync(real, link, "dir")
  return { real, link }
}

test("symlink 経由の cwd: 担当範囲内の書き込みは素通し", () => {
  const { link } = setupSymlinkedRepo()
  expect(hook(link, "Edit", path.join(link, "src/server/db.ts"))).toBe(null)
  expect(hook(link, "Write", path.join(link, "src/server/new-file.ts"))).toBe(
    null
  )
})

test("symlink 経由の cwd: 担当範囲外は ask、理由も docRoot 基準の相対パス", () => {
  const { link } = setupSymlinkedRepo()
  const r = hook(link, "Edit", path.join(link, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("担当範囲外")
  expect(r?.permissionDecisionReason).toContain("src/app/page.tsx")
  // `../` 付きの相対パスが出ていたら座標系が割れている
  expect(r?.permissionDecisionReason).not.toContain("../")
})

test("symlink 経由の cwd でも .codiel/ 配下は codielRoot 基準で素通し", () => {
  const { link } = setupSymlinkedRepo()
  // codielRel まで実体パス基準に「揃える」と、codielRoot(論理パス)との相対が
  // `../` に落ちて .codiel/ 免除が外れ、運用資産への正当な書き込みが ask になる。
  expect(
    hook(link, "Write", path.join(link, ".codiel/reports/test-run-1.md"))
  ).toBe(null)
  expect(
    hook(
      link,
      "Write",
      path.join(link, ".codiel/runs/demo/try-1/steps/step-1/report.md")
    )
  ).toBe(null)
})

test("symlink を使わない通常構成では既存の挙動が変わらない(回帰ガード)", () => {
  const { real } = setupSymlinkedRepo()
  expect(hook(real, "Edit", path.join(real, "src/server/db.ts"))).toBe(null)
  const r = hook(real, "Edit", path.join(real, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("src/app/page.tsx")
  expect(
    hook(real, "Write", path.join(real, ".codiel/reports/test-run-1.md"))
  ).toBe(null)
})

// ---------------------------------------------------------------------------
// テストの保護(設計書 §6.13.6、§8.2 の P 系)。testsDir は既定の docs/codiel/tests とし、
// docs/codiel/tests/units/src/a.ts/spec.md の tests に src/__test__/a.test.ts を記録しておく。
// ---------------------------------------------------------------------------

const SPEC_DIR = "docs/codiel/tests/units/src/a.ts"
const CASES = `${SPEC_DIR}/cases.md`
const RECORDED = "src/__test__/a.test.ts"

function writeSpec(root: string, dir: string, frontmatter: string): void {
  fs.mkdirSync(path.join(root, dir), { recursive: true })
  fs.writeFileSync(
    path.join(root, dir, "spec.md"),
    `---\n${frontmatter}\n---\n\n# 仕様\n`
  )
}

function writeConfig(root: string, content: string): void {
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true })
  fs.writeFileSync(path.join(root, ".codiel/config.json"), content)
}

function patchState(root: string, fn: (s: RunState) => void): void {
  const p = statePathFor(root, SLUG)
  const s = readState(p)
  fn(s)
  writeState(p, s)
}

// phase を in_progress にし、tests を記録した spec.md を置いた run を作る。
function setupProtectedRun(phase: string): string {
  const root = setupRun()
  advanceRunTo(root, phase)
  writeSpec(root, SPEC_DIR, `parallel: true\ntests:\n  - ${RECORDED}`)
  return root
}

function decision(root: string, rel: string): string | null {
  return hook(root, "Write", path.join(root, rel))?.permissionDecision ?? null
}

test("P-1: implement で testsDir の cases.md は ask になり、理由はテストの保護", () => {
  const root = setupProtectedRun("implement")
  const r = hook(root, "Edit", path.join(root, CASES))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `テスト(${CASES})の変更は test-spec と test-code フェーズの担当です(implement 中の変更は改竄の疑い)`
  )
})

test("P-2: test-loop で spec.md の tests に載ったファイルは ask", () => {
  const root = setupProtectedRun("test-loop")
  expect(decision(root, RECORDED)).toBe("ask")
  // 1 行の列で書いた tests と、別の仕様のディレクトリの記録も読む
  writeSpec(
    root,
    "docs/codiel/tests/e2e/cli/tool",
    `tests: ["test/e2e/tool.test.ts"]\nparallel: false`
  )
  expect(decision(root, "test/e2e/tool.test.ts")).toBe("ask")
})

test("P-3: implement で どの tests にも載っていないテストファイルは通す", () => {
  const root = setupProtectedRun("implement")
  expect(decision(root, "src/__test__/b.test.ts")).toBe(null)
})

test("P-4: test-code では cases.md も記録されたテストも通す", () => {
  const root = setupProtectedRun("test-code")
  expect(decision(root, CASES)).toBe(null)
  expect(decision(root, RECORDED)).toBe(null)
})

test("P-5: fix-loop で testEdit が無ければ cases.md は ask", () => {
  const root = setupProtectedRun("fix-loop")
  expect(decision(root, CASES)).toBe("ask")
})

test("P-6: fix-loop で testEdit が真の間は cases.md も記録されたテストも通す", () => {
  const root = setupProtectedRun("fix-loop")
  patchState(root, (s) => {
    s.testEdit = true
  })
  expect(decision(root, CASES)).toBe(null)
  expect(decision(root, RECORDED)).toBe(null)
})

test("P-7: implement では testEdit が真でも cases.md は ask(fix-loop 以外では testEdit を見ない)", () => {
  const root = setupProtectedRun("implement")
  patchState(root, (s) => {
    s.testEdit = true
  })
  expect(decision(root, CASES)).toBe("ask")
})

test("P-8: implement で testsDir が qa/specs なら qa/specs の spec.md は ask、docs/codiel/tests の spec.md は通す", () => {
  const root = setupProtectedRun("implement")
  writeConfig(root, JSON.stringify({ testsDir: "qa/specs" }))
  expect(decision(root, "qa/specs/units/x.ts/spec.md")).toBe("ask")
  expect(decision(root, "docs/codiel/tests/units/x.ts/spec.md")).toBe(null)
})

test("P-9: test-spec で testsDir が qa/specs なら、docs/ の外でも qa/specs の spec.md を通す", () => {
  const root = setupRun()
  advanceRunTo(root, "test-spec")
  writeConfig(root, JSON.stringify({ testsDir: "qa/specs" }))
  expect(decision(root, "qa/specs/units/x.ts/spec.md")).toBe(null)
  // testsDir の外のコード領域は従来どおり ask
  expect(decision(root, "qa/tools/x.ts")).toBe("ask")
})

test("P-10: implement で .codiel/config.json が JSON として読めなければ src への書き込みも ask", () => {
  const root = setupProtectedRun("implement")
  writeConfig(root, "{ testsDir: ")
  const r = hook(root, "Write", path.join(root, "src/index.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(/config\.json が不正/)
})

test("設定が不正でも、文書フェーズでは testsDir を通す規則だけを外し、docs/ は通す", () => {
  const root = setupRun()
  advanceRunTo(root, "test-spec")
  writeConfig(root, JSON.stringify({ testsDir: "/abs/specs" }))
  expect(decision(root, "docs/codiel/tests/units/x.ts/spec.md")).toBe(null)
  expect(decision(root, "src/index.ts")).toBe("ask")
})

// ---------------------------------------------------------------------------
// worktree の中の書き込み(設計書 §6.8 の (a)〜(c)、§8.2 の W 系)。
// どのケースも mapped の run で、メインの state.domain は null にしておく。
// worktree は `git worktree add` で実際に作る。ARCHITECTURE と spec.md はメインの作業ツリーに
// だけ置き(コミットしない)、メインの作業ツリーで読んでいることも併せて確かめる。
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=codiel-test",
      "-c",
      "user.email=codiel-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args
    ],
    { cwd, stdio: "ignore" }
  )
}

// git リポジトリのメインの作業ツリーに run を作り、phase を in_progress にする。
// commitCodiel が真なら .codiel/config.json をコミットし、worktree の checkout にも .codiel/ が現れる。
function setupGitRun(phase: string, commitCodiel = false): string {
  const main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gw-wt-")))
  git(main, ["init", "-q"])
  fs.mkdirSync(path.join(main, "src"))
  fs.writeFileSync(path.join(main, "src/index.ts"), "")
  if (commitCodiel)
    writeConfig(main, `${JSON.stringify({ testsDir: "docs/codiel/tests" })}\n`)
  git(main, ["add", "-A"])
  git(main, ["commit", "-q", "-m", "init"])
  const args = ["init", "--slug", SLUG]
  for (const [k, v] of Object.entries(INIT_DEFAULTS)) args.push(`--${k}`, v)
  runTs(CLI, args, { cwd: main })
  advanceRunTo(main, phase)
  patchState(main, (s) => {
    s.domainMode = "mapped"
    s.domain = null
  })
  writeArchitecture(main, DOMAINS)
  return main
}

function worktreeRel(name: string): string {
  return `.codiel/worktrees/${SLUG}/${name}`
}

function addWorktree(main: string, name: string): string {
  git(main, [
    "worktree",
    "add",
    "-q",
    "-b",
    `codiel/${SLUG}-try-1-${name}`,
    worktreeRel(name)
  ])
  return path.join(main, worktreeRel(name))
}

function element(worktree: string | null, domain: string | null): StepState {
  return {
    status: "running",
    files: [],
    deps: [],
    final: false,
    group: null,
    worktree,
    branch: null,
    commits: { base: null, head: null },
    attempts: 0,
    domain
  }
}

// 名前の接頭辞ごとに、その worktree を記録する表とフェーズ
const WORKTREE_KINDS: [string, string, (s: RunState, e: StepState) => void][] =
  [
    [
      "step-1",
      "implement",
      (s, e) => {
        s.implement = { steps: { "1": e } }
      }
    ],
    [
      "test-code-1",
      "test-code",
      (s, e) => {
        s.testCode = { units: { "units/src/server/db.ts": e } }
      }
    ],
    [
      "test-loop-1",
      "test-loop",
      (s, e) => {
        s.testLoop = { units: { "units/src/server/db.ts": e } }
      }
    ]
  ]

for (const [name, phase, record] of WORKTREE_KINDS)
  test(`W-2・W-2b・W-3(A4-3): ${name} の worktree への書き込みは、cwd が worktree の中でもメインのルートでも worktree ルート基準で判定する`, () => {
    const main = setupGitRun(phase)
    const wt = addWorktree(main, name)
    patchState(main, (s) => record(s, element(worktreeRel(name), "backend")))
    for (const cwd of [wt, main]) {
      expect(hook(cwd, "Write", path.join(wt, "src/server/db.ts")), cwd).toBe(
        null
      )
      const r = hook(cwd, "Write", path.join(wt, "src/app/page.tsx"))
      expect(r?.permissionDecision, cwd).toBe("ask")
      expect(r?.permissionDecisionReason).toContain(
        "src/app/page.tsx はドメイン backend の担当範囲外"
      )
      // メインのルート基準の相対パス(.codiel/ の免除に入る)で判定していない
      expect(r?.permissionDecisionReason).not.toContain(".codiel/worktrees")
    }
  })

test("W-1・W-1b: cwd が step の worktree の中なら、テストの保護と要素の domain の境界が worktree ルート基準で効く", () => {
  const main = setupGitRun("implement")
  const wt = addWorktree(main, "step-1")
  patchState(main, (s) => {
    s.implement = { steps: { "1": element(worktreeRel("step-1"), "backend") } }
  })
  const cwd = path.join(wt, "src")
  const r1 = hook(cwd, "Write", path.join(wt, CASES))
  expect(r1?.permissionDecision).toBe("ask")
  expect(r1?.permissionDecisionReason).toContain(`テスト(${CASES})`)
  const r1b = hook(cwd, "Write", path.join(wt, "src/app/page.tsx"))
  expect(r1b?.permissionDecision).toBe("ask")
  expect(r1b?.permissionDecisionReason).toContain("担当範囲外")
})

test("W-4: docRoot がメインの sub/ なら、worktree の中の sub/ 配下を worktreeRoot/sub に写して照合する", () => {
  const main = setupGitRun("implement")
  const wt = addWorktree(main, "step-1")
  patchState(main, (s) => {
    s.implement = { steps: { "1": element(worktreeRel("step-1"), "backend") } }
  })
  // 設定と ARCHITECTURE はメインの sub/ にだけ置く。worktree の中から祖先を辿っても届かない
  const sub = path.join(main, "sub")
  fs.mkdirSync(sub)
  fs.writeFileSync(
    path.join(sub, "metatron.config.json"),
    `${JSON.stringify({ version: 1 })}\n`
  )
  writeArchitecture(sub, DOMAINS)
  const wtSub = path.join(wt, "sub")
  fs.mkdirSync(wtSub)
  expect(hook(wtSub, "Write", path.join(wtSub, "src/server/db.ts"))).toBe(null)
  const r = hook(wtSub, "Write", path.join(wtSub, "src/app/page.tsx"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain(
    "src/app/page.tsx はドメイン backend の担当範囲外"
  )
  expect(r?.permissionDecisionReason).not.toContain("sub/src")
})

for (const commitCodiel of [true, false])
  test(`W-5: worktree の checkout に .codiel/ が${commitCodiel ? "ある" : "無い"}ときも、run はメインのルートで見つかる`, () => {
    const main = setupGitRun("implement", commitCodiel)
    const wt = addWorktree(main, "step-1")
    expect(fs.existsSync(path.join(wt, ".codiel"))).toBe(commitCodiel)
    // run が見つからなければ素通し(null)になる
    expect(
      hook(path.join(wt, "src"), "Write", path.join(wt, CASES))
        ?.permissionDecision
    ).toBe("ask")
  })

test("W-5: メインの外の <other>/.codiel/worktrees/ の中では、git に問い合わせず other をルートとみなす", () => {
  const main = setupGitRun("implement")
  // メインの作業ツリーの外に、別のディレクトリの .codiel/worktrees/ の形で worktree を置く
  const other = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gw-other-"))
  )
  const wt = path.join(other, worktreeRel("step-1"))
  git(main, ["worktree", "add", "-q", "-b", "codiel/other", wt])
  // other に run は無いので素通しになる。git に問い合わせればメインの run が見つかり ask になる
  expect(hook(wt, "Write", path.join(main, CASES))).toBe(null)
})

test("W-6: test-code の worktree で要素に domain が無ければ、範囲外のテストファイルも通す(state.domain も使わない)", () => {
  const main = setupGitRun("test-code")
  const wt = addWorktree(main, "test-code-1")
  patchState(main, (s) => {
    s.testCode = {
      units: {
        "units/src/server/db.ts": element(worktreeRel("test-code-1"), null)
      }
    }
  })
  const target = path.join(wt, "src/app/__test__/page.test.tsx")
  expect(hook(wt, "Write", target)).toBe(null)
  // メインの state.domain があっても、worktree の中への書き込みには使わない
  patchState(main, (s) => {
    s.domain = "backend"
  })
  expect(hook(wt, "Write", target)).toBe(null)
  // メインの作業ツリーへの書き込みには従来どおり state.domain を使う
  expect(
    hook(main, "Write", path.join(main, "src/app/page.tsx"))?.permissionDecision
  ).toBe("ask")
})

test("W-7: test-loop の worktree を 2 つの要素が記録していれば、範囲内のソースでも ask", () => {
  const main = setupGitRun("test-loop")
  const wt = addWorktree(main, "test-loop-1")
  const rel = worktreeRel("test-loop-1")
  patchState(main, (s) => {
    s.testLoop = {
      units: {
        "units/src/server/db.ts": element(rel, "backend"),
        // `./` と末尾の `/` を付けた記録も同じパスとして数える
        "units/src/api/x.ts": element(`./${rel}/`, "backend")
      }
    }
  })
  const r = hook(wt, "Write", path.join(wt, "src/server/db.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `worktree ${rel} を記録した要素が 2 個あり(testLoop.units[units/src/server/db.ts], testLoop.units[units/src/api/x.ts])、境界に使うドメインを 1 つに決められません(worktree のパスは run の中で一意のはずです)`
  )
})

test("P-11: implement で step の worktree の中の記録されたテストは、worktreeRoot 相対で保護が効く", () => {
  const main = setupGitRun("implement")
  const wt = addWorktree(main, "step-1")
  // spec.md はメインの作業ツリーにだけ置く(worktree の中の spec.md は読まない)
  writeSpec(main, SPEC_DIR, `tests:\n  - ${RECORDED}`)
  const r = hook(wt, "Write", path.join(wt, RECORDED))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain(`テスト(${RECORDED})`)
})

// ---------------------------------------------------------------------------
// E2E のレポートと runsDir(設計書 §6.17.6、§8.2 の R 系)。slug は demo、testsDir と runsDir は
// ケースに書いたものを除いて既定の docs/codiel/tests と docs/codiel/runs とする。
// mapped のケースでは、ドメイン x の範囲を src/x/** とする。
// ---------------------------------------------------------------------------

const REPORT_DIR =
  "docs/codiel/tests/e2e/frontend/login/reports/20261001-121500-demo-try1"
const RUN_DOC = (name: string) => `docs/codiel/runs/demo/${name}`

// phase を in_progress にし、mapped でドメイン x を当てた run を作る。
function setupMappedRun(phase: string): string {
  const root = setupRun()
  advanceRunTo(root, phase)
  writeArchitecture(root, { x: ["src/x/**"] })
  patchState(root, (s) => {
    s.domainMode = "mapped"
    s.domain = "x"
  })
  return root
}

test("R-1: implement・mapped・domain x で、E2E のレポートはドメイン境界の外でも通す", () => {
  const root = setupMappedRun("implement")
  expect(decision(root, `${REPORT_DIR}/summary.md`)).toBe(null)
  expect(decision(root, `${REPORT_DIR}/results.json`)).toBe(null)
  // 免除が効きすぎていないこと: reports/ の外の範囲外のパスは従来どおり ask
  const r = hook(root, "Write", path.join(root, "src/y/a.ts"))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("担当範囲外")
})

test("R-2: implement・mapped・domain x で、仕様のディレクトリの cases.md はテストの保護が免除より先に効く", () => {
  const root = setupMappedRun("implement")
  const cases = "docs/codiel/tests/e2e/frontend/login/cases.md"
  const r = hook(root, "Write", path.join(root, cases))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain(`テスト(${cases})`)
})

test("R-3: test-loop・domain なしで、E2E のレポートの failure.md はテストの保護の対象外で通す", () => {
  const root = setupRun()
  advanceRunTo(root, "test-loop")
  expect(decision(root, `${REPORT_DIR}/failure.md`)).toBe(null)
})

test("R-4: design で runsDir が notes/runs なら、docs/ の外の <runsDir>/ を通す", () => {
  const root = setupRun()
  advanceRunTo(root, "design")
  writeConfig(root, JSON.stringify({ runsDir: "notes/runs" }))
  expect(decision(root, "notes/runs/demo/design.md")).toBe(null)
  // runsDir の外のコード領域は従来どおり ask
  expect(decision(root, "notes/other.md")).toBe("ask")
})

test("R-5: implement・mapped・domain x で、<runsDir>/ への書き込みは ask になり、理由は run の文書", () => {
  const root = setupMappedRun("implement")
  const r = hook(root, "Write", path.join(root, RUN_DOC("dev-plan.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `run の文書(${RUN_DOC("dev-plan.md")})は文書フェーズで書きます(implement 中の変更は想定外)`
  )
})

test("R-6: review で <runsDir>/ への書き込みは、現行の pr・review・triage・finalize の分岐で ask", () => {
  const root = setupRun()
  advanceRunTo(root, "review")
  const r = hook(root, "Write", path.join(root, RUN_DOC("design.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `フェーズ review 中の ${RUN_DOC("design.md")} への書き込みは想定外です`
  )
})

test("R-7: design で config.json の runsDir が /abs なら、<runsDir>/ の規則だけを外す", () => {
  const root = setupRun()
  advanceRunTo(root, "design")
  writeConfig(root, JSON.stringify({ runsDir: "/abs" }))
  expect(decision(root, "notes/runs/demo/design.md")).toBe("ask")
  // docs/ と .codiel/ を通す規則は残る
  expect(decision(root, RUN_DOC("design.md"))).toBe(null)
})

test("R-8: implement・unscoped(domain なし)でも、<runsDir>/ への書き込みは ask", () => {
  const root = setupRun()
  advanceToImplement(root)
  const r = hook(root, "Write", path.join(root, RUN_DOC("dev-plan.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toContain("文書フェーズで書きます")
})

test("R-9: test-code の worktree の中の <runsDir>/ への書き込みは、worktreeRoot 相対で ask", () => {
  const main = setupGitRun("test-code")
  const wt = addWorktree(main, "test-code-1")
  patchState(main, (s) => {
    s.testCode = {
      units: {
        "units/src/server/db.ts": element(worktreeRel("test-code-1"), null)
      }
    }
  })
  const r = hook(wt, "Write", path.join(wt, RUN_DOC("design.md")))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toBe(
    `run の文書(${RUN_DOC("design.md")})は文書フェーズで書きます(test-code 中の変更は想定外)`
  )
  // 同じ worktree のテストファイルは W-6 のとおり通す
  expect(hook(wt, "Write", path.join(wt, "src/__test__/b.test.ts"))).toBe(null)
})

test("R-10: fix-loop・domain なしで runsDir が notes/runs なら、docs/ の外の <runsDir>/ も ask", () => {
  const root = setupRun()
  advanceRunTo(root, "fix-loop")
  writeConfig(root, JSON.stringify({ runsDir: "notes/runs" }))
  expect(decision(root, "notes/runs/demo/dev-plan.md")).toBe("ask")
})

test("R-11: implement で runsDir が testsDir の親でも、E2E のレポートは <runsDir>/ の規則の対象外で通す", () => {
  const root = setupRun()
  advanceToImplement(root)
  writeConfig(root, JSON.stringify({ runsDir: "docs/codiel" }))
  expect(decision(root, `${REPORT_DIR}/summary.md`)).toBe(null)
  // reports/ の外の runsDir の配下は ask
  expect(decision(root, "docs/codiel/demo/dev-plan.md")).toBe("ask")
})

test("R-12: test-code で config.json が JSON として読めなければ、テストファイルへの書き込みも ask", () => {
  const root = setupRun()
  advanceRunTo(root, "test-code")
  writeConfig(root, "{ runsDir: ")
  const r = hook(root, "Write", path.join(root, RECORDED))
  expect(r?.permissionDecision).toBe("ask")
  expect(r?.permissionDecisionReason).toMatch(
    /^\.codiel\/config\.json が不正なため、test-code 中の書き込みが run の文書\(runsDir\)に当たるか判定できません/
  )
})

test("R-13: unrecorded-gotchas.md への書き込みは免除されず、ほかの run の文書と同じ判定になる", () => {
  const root = setupMappedRun("fix-loop")
  expect(decision(root, RUN_DOC("unrecorded-gotchas.md"))).toBe("ask")
  expect(decision(root, RUN_DOC("unrecorded-gotchas.md"))).toBe(
    decision(root, RUN_DOC("dev-plan.md"))
  )
  for (const phase of ["review", "triage", "finalize", "implement"]) {
    const r = setupRun()
    advanceRunTo(r, phase)
    expect(decision(r, RUN_DOC("unrecorded-gotchas.md")), phase).toBe("ask")
  }
  const r = setupRun()
  advanceRunTo(r, "finalize")
  writeConfig(r, JSON.stringify({ runsDir: "notes/runs" }))
  expect(decision(r, "notes/runs/demo/unrecorded-gotchas.md")).toBe("ask")
})

// --- Raguel の設定と記録の保護(Raguel 設計書 §6.13.4。所見 G8・R12) ---

// RAGUEL_CONFIG で Raguel の設定を <root>/raguel.json に置き、casesDir を <root>/cases-store にする。
// 守る 3 種のパス(root 相対)と、フックに渡す環境変数を返す。
function raguelEnv(root: string): {
  env: Record<string, string>
  targets: string[]
} {
  const file = path.join(root, "raguel.json")
  fs.writeFileSync(
    file,
    JSON.stringify({
      storage: { casesDir: path.join(root, "cases-store"), projectId: "demo" }
    })
  )
  return {
    env: { RAGUEL_CONFIG: file },
    targets: [
      ".codiel/config.json",
      "raguel.json",
      "cases-store/cases/demo/evaluations.jsonl"
    ]
  }
}

test("R12: active と awaiting_human の run で、3 種のパスへの Write と Edit は deny になる", () => {
  for (const status of ["active", "awaiting_human"] as const) {
    const root = setupRun()
    advanceRunTo(root, "implement")
    patchState(root, (s) => {
      s.status = status
    })
    const { env, targets } = raguelEnv(root)
    for (const rel of targets)
      for (const tool of ["Write", "Edit"]) {
        const r = hook(root, tool, path.join(root, rel), env)
        expect(r?.permissionDecision, `${status} ${tool} ${rel}`).toBe("deny")
        expect(r?.permissionDecisionReason).toMatch(/Raguel の設定と記録/)
      }
  }
})

test("R12: run が無ければ、3 種のパスへの Write と Edit は通す", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
  const { env, targets } = raguelEnv(root)
  for (const rel of targets)
    for (const tool of ["Write", "Edit"])
      expect(hook(root, tool, path.join(root, rel), env), rel).toBe(null)
})

test("G8: 文書フェーズで .codiel/ 配下を通す規則より先に、config.json を deny する(設定を緩める案を止める)", () => {
  const root = setupRun()
  const r = hook(root, "Write", path.join(root, ".codiel/config.json"))
  expect(r?.permissionDecision).toBe("deny")
  // 同じ .codiel/ 配下のほかのファイルは従来どおり通す
  expect(decision(root, ".codiel/runs/demo/try-1/issue.md")).toBe(null)
})

test("RAGUEL_CONFIG が無ければ、.codiel/config.json の raguel.storage.casesDir の配下を守る", () => {
  const root = setupRun()
  const store = path.join(root, "store")
  writeConfig(
    root,
    JSON.stringify({ raguel: { storage: { casesDir: store, projectId: "p" } } })
  )
  const noEnv = { RAGUEL_CONFIG: "" }
  const r = hook(
    root,
    "Edit",
    path.join(store, "cases/p/outcomes.jsonl"),
    noEnv
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(
    hook(root, "Write", path.join(root, "store-other/a.txt"), noEnv)
      ?.permissionDecision
  ).toBe("ask")
})

test("codiel の worktree の中の .codiel/config.json の写しも deny し、config.json が不正でも deny は変わらない", () => {
  const root = setupRun()
  writeConfig(root, "{ runsDir: ")
  expect(decision(root, ".codiel/config.json")).toBe("deny")
  expect(decision(root, ".codiel/worktrees/demo/s1/.codiel/config.json")).toBe(
    "deny"
  )
})

test("casesDir と同じ接頭辞を持つ別のディレクトリは守る対象にしない", () => {
  const root = setupRun()
  const { env } = raguelEnv(root)
  const r = hook(
    root,
    "Write",
    path.join(root, ".codiel/runs/demo/try-1/cases-store.md"),
    env
  )
  expect(r).toBe(null)
  const other = hook(root, "Write", path.join(root, "cases-store2/x"), env)
  expect(other?.permissionDecision).toBe("ask")
})
