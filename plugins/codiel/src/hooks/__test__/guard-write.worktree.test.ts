import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import type { RunState, StepState } from "../../codiel-state.js"
import {
  addWorktree,
  CASES,
  DOMAINS,
  element,
  git,
  hook,
  patchState,
  RECORDED,
  SPEC_DIR,
  setupGitRun,
  worktreeRel,
  writeArchitecture,
  writeSpec
} from "./helpers/guard-write-fixtures.js"

// ---------------------------------------------------------------------------
// worktree の中の書き込み(設計書 §6.8 の (a)〜(c)、§8.2 の W 系)。
// どのケースも mapped の run で、メインの state.domain は null にしておく。
// worktree は `git worktree add` で実際に作る。ARCHITECTURE と spec.md はメインの作業ツリーに
// だけ置き(コミットしない)、メインの作業ツリーで読んでいることも併せて確かめる。
// ---------------------------------------------------------------------------

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
