import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"
import {
  advanceToImplement,
  CLI,
  DOMAINS,
  hook,
  SLUG,
  setupRun,
  writeArchitecture
} from "./helpers/guard-write-fixtures.js"

// ---------------------------------------------------------------------------
// ドメイン境界(設計書 16-5 の配線)
// ---------------------------------------------------------------------------

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
