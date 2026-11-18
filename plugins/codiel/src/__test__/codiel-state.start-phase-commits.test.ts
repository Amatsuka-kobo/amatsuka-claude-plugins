import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  codeRun,
  commitFiles,
  gateArgs,
  gateRun,
  git,
  init,
  latestState,
  passThrough,
  recordEvaluation,
  run,
  statePath,
  tmpProject
} from "./helpers/codiel-state-fixtures.js"
import { raguelConfigPath } from "./helpers/run-cli.js"

test("start-phase は、直前のゲート付きフェーズの pass-gate の後にコミットがあれば code 系フェーズを開始しない(W4R2-04)", () => {
  const root = codeRun()
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-tc")
  expect(run(root, gateArgs("test-code", "ev-tc", "PROCEED")).code).toBe(0)
  const passed = git(root, "rev-parse", "HEAD")
  git(root, "commit", "-q", "--allow-empty", "-m", "unevaluated")
  const head = git(root, "rev-parse", "HEAD")
  const r = run(root, ["start-phase", "implement", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toContain(
    `評価の後にコミットがある(${passed}..${head})。test-code を評価し直してください`
  )
  const st = latestState(root, "demo")
  expect(st.phases.implement.status).toBe("pending")
  expect(st.phases.implement.startHead).toBeUndefined()
  // コミットを戻せば開始できる
  git(root, "reset", "-q", "--hard", passed)
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(0)
})

const SPEC_DOC = "docs/codiel/tests/units/demo/spec.md"

const PLAN_DOC = "docs/codiel/runs/demo/dev-plan.md"

// 文書を書いてから、その文書を評価したことにして test-spec と dev-plan を順に通す。
// commitAfter が真なら、各フェーズのゲート通過の直後に評価した文書をコミットする
function passDocStage(
  root: string,
  order: string[],
  commitAfter: boolean
): void {
  passThrough(root, "demo", ["intent", "discuss", "design"])
  for (const ph of order) {
    const doc = ph === "test-spec" ? SPEC_DOC : PLAN_DOC
    fs.mkdirSync(path.dirname(path.join(root, doc)), { recursive: true })
    fs.writeFileSync(path.join(root, doc), `# ${ph}\n`)
    passThrough(root, "demo", [ph])
    if (commitAfter) commitFiles(root, [doc], ph)
  }
}

test("start-phase は、文書のフェーズの後に評価した文書だけをコミットしていれば code 系フェーズを開始する", () => {
  const root = tmpProject()
  init(root)
  // test-spec を先に通して文書をコミットせず、dev-plan の後に dev-plan.md だけをコミットした
  passDocStage(root, ["test-spec", "dev-plan"], false)
  commitFiles(root, [PLAN_DOC], "dev-plan")
  const r = run(root, ["start-phase", "test-code", "--slug", "demo"])
  expect(r.code, r.err).toBe(0)
  expect(r.out.state.phases["test-code"].startHead).toBe(
    git(root, "rev-parse", "HEAD")
  )
})

test("start-phase test-code は、test-spec と dev-plan の両方の文書のコミットを許し、先に通したほうの passedHead を起点にする", () => {
  for (const order of [
    ["test-spec", "dev-plan"],
    ["dev-plan", "test-spec"]
  ]) {
    const root = tmpProject()
    init(root)
    passDocStage(root, order, true)
    const st = latestState(root, "demo")
    // 後に通したほうの passedHead は、先に通したほうの文書のコミットを含む
    expect(st.phases[order[0]].passedHead).not.toBe(
      st.phases[order[1]].passedHead
    )
    const r = run(root, ["start-phase", "test-code", "--slug", "demo"])
    expect(r.code, `${order.join("→")}: ${r.err}`).toBe(0)
  }
})

test("start-phase は、文書のフェーズの後に評価した文書のほかのファイルもコミットしていれば開始せず、そのパスを出す", () => {
  const root = tmpProject()
  init(root)
  commitFiles(root, ["old.txt"], "old")
  passDocStage(root, ["test-spec", "dev-plan"], true)
  const clean = git(root, "rev-parse", "HEAD")
  const base = latestState(root, "demo").phases["test-spec"].passedHead
  commitFiles(root, ["src/extra.ts"], "unevaluated")
  let r = run(root, ["start-phase", "test-code", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toContain(
    `評価の後に、評価した文書のほかのファイルのコミットがある(${base}..${git(root, "rev-parse", "HEAD")}: src/extra.ts)。test-spec・dev-plan を評価し直してください`
  )
  expect(latestState(root, "demo").phases["test-code"].status).toBe("pending")
  // 名前の変更は移動元も見る(移動先が評価した文書でも、移動元は許されない)
  git(root, "reset", "-q", "--hard", clean)
  fs.renameSync(path.join(root, "old.txt"), path.join(root, PLAN_DOC))
  git(root, "add", "-A", "--", "old.txt", PLAN_DOC)
  git(root, "commit", "-q", "-m", "rename")
  r = run(root, ["start-phase", "test-code", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/: old\.txt\)/)
})

test("pass-gate 検査 10: raguelContract の無い run は検査の代わりに移行の文言で失敗する", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-ok")
  const raw = latestState(root, "demo")
  delete raw.raguelContract
  fs.writeFileSync(statePath(root, "demo"), JSON.stringify(raw, null, 2))
  const r = run(root, gateArgs("intent", "ev-ok", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err.trim()).toBe(
    "codiel: この run は Raguel の記録の形式が古い(raguelContract なし)ため、この版ではゲートを通せない。`codiel-state stop --slug demo --reason migrate` で止めてから、`/codiel:run docs/intents/2026-09-27-demo.md` で同じ intent の新しい try を始める。"
  )
})

test("pass-gate は Raguel の設定が読めなければ失敗する(既定の置き場に落ちない)", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-ok")
  fs.writeFileSync(raguelConfigPath(root), "{ broken")
  const r = run(root, gateArgs("intent", "ev-ok", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/Raguel の記録を読めません/)
})

test("mark-ask --kind raguel は --evaluation-id を必須にし、索引に無い評価と verdict の食い違いで失敗する", () => {
  const root = gateRun()
  const ask = (...extra: string[]) =>
    run(root, ["mark-ask", "intent", "--slug", "demo", ...extra])
  let r = ask()
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/--kind raguel には --evaluation-id が必要です/)
  r = ask("--evaluation-id", "ev-missing")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/evaluationId ev-missing の行がありません/)
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-proceed")
  r = ask("--evaluation-id", "ev-proceed")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /--verdict ASK が Raguel の評価の verdict PROCEED と合いません/
  )
  recordEvaluation(root, "demo", "design", "ASK", "ev-design")
  r = ask("--evaluation-id", "ev-design")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/別の run かフェーズの評価です/)
  expect(latestState(root, "demo").status).toBe("active")
  // --kind confirm は索引を見ない
  expect(ask("--kind", "confirm").code).toBe(0)
})

// --- v1 の扱い ---
