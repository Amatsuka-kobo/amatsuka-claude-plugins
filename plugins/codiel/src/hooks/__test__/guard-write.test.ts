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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backends"], {
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
      path.join(codielRoot, ".codiel/specs/unit-1/scripts/a.spec.ts")
    )
  ).toBe(null)
  // spec.md / cases.md の ask は codielRoot 基準のまま維持される
  expect(
    hook(docRoot, "Edit", path.join(codielRoot, ".codiel/specs/unit-1/spec.md"))
      ?.permissionDecision
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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backends"], {
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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
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
  runTs(CLI, ["set-domain", "--issue", "1", "--domain", "backend"], {
    cwd: real
  })
  // 実体化は「親ディレクトリまでは実在する」場合に効く(metatron の realpathOrParent と
  // 同じ手法)。実運用の新規ファイル作成に合わせ、書き込み先の親を作っておく。
  fs.mkdirSync(path.join(real, "src/server"), { recursive: true })
  fs.mkdirSync(path.join(real, "src/app"), { recursive: true })
  // **`.codiel/` 側の親も作る。** ここを省くと realpathOrParent が入力をそのまま返す
  // 無害な恒等関数に落ち、codielRel を論理パス基準にしても実体パス基準にしても同じ値になる。
  // つまり「codielRel は論理パス基準のまま」という不変条件を張ったつもりのテストが、
  // 実体パス基準へ揃える改変を通してしまう(変異が生き残る)。実運用でも 2 本目以降の
  // レポートやスペックは既存ディレクトリへ書かれるので、親が在る側が既定の状況である。
  fs.mkdirSync(path.join(real, ".codiel/reports"), { recursive: true })
  fs.mkdirSync(path.join(real, ".codiel/specs/unit-1/scripts"), {
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
      path.join(link, ".codiel/specs/unit-1/scripts/a.spec.ts")
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
