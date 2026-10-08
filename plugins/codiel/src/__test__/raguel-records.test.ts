// 2 者比較テスト(Raguel 設計書 §6.14 の 2 本目)。raguel-mcp が書いた記録を codiel が読めること、
// 置き場の解決・projectId・testsDir・E2E のレポートの判定が両者で等しいことを確かめる。
// テスト時だけ raguel-mcp の src を相対パスで読む。
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CaseStore } from "../../raguel-mcp/src/casefile/store"
import type { GatedPhase } from "../../raguel-mcp/src/codiel/phases"
import { defaultConfig } from "../../raguel-mcp/src/config/defaults"
import { loadConfig } from "../../raguel-mcp/src/config/loader"
import {
  classifyPath,
  isE2eReport as raguelIsE2eReport,
  resolveTestsDir
} from "../../raguel-mcp/src/config/paths"
import type { JevCall } from "../../raguel-mcp/src/context/jev"
import type { Subject, Verdict } from "../../raguel-mcp/src/core/types"
import {
  resolveProjectId as raguelProjectId,
  resolveProjectRoot
} from "../../raguel-mcp/src/project/root"
import {
  type Harness,
  makeHarness
} from "../../raguel-mcp/src/tools/__test__/helpers/harness"
import { readCodielConfig } from "../codiel-state.js"
import { isE2eReport } from "../hooks/guard-write.js"
import { findMainRoot } from "../hooks/lib.js"
import {
  checkEvaluationRow,
  checkGate,
  findEvaluation,
  gitMergeBase,
  readEvaluationIndex,
  resolveRaguelStore,
  unresolvedStops
} from "../raguel-records.js"

// guard-write.ts は読み込むとフックとして標準入力を読み、終わりに process.exit を呼ぶ。
// isE2eReport だけを使うため、入力を空にし、終了の関数を例外と何もしない関数に替える。
vi.mock("../hooks/lib.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/lib.js")>()),
  readStdin: async () => ({}),
  pass: () => {
    throw new Error("pass")
  },
  emit: () => undefined
}))

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const CLI = fileURLToPath(new URL("../codiel-state-cli.ts", import.meta.url))

const savedEnv = {
  RAGUEL_CONFIG: process.env.RAGUEL_CONFIG,
  HOME: process.env.HOME
}
let home = ""

beforeEach(() => {
  delete process.env.RAGUEL_CONFIG
  // 既定の置き場 ~/.raguel を一時ディレクトリへ向け、本物のホームを読み書きしない
  home = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-records-home-"))
  process.env.HOME = home
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv))
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
})

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  ).trim()
}

// .codiel を持つメインの作業ツリー(コミット 1 つ)を作る
function mainRepo(config?: unknown): string {
  const root = tmp("raguel-records-main-")
  git(root, "init", "-q")
  git(root, "commit", "-q", "--allow-empty", "-m", "init")
  fs.mkdirSync(path.join(root, ".codiel"))
  if (config !== undefined)
    fs.writeFileSync(
      path.join(root, ".codiel", "config.json"),
      JSON.stringify(config)
    )
  return root
}

function writeConfig(root: string, config: unknown): void {
  fs.writeFileSync(
    path.join(root, ".codiel", "config.json"),
    JSON.stringify(config)
  )
}

// codiel と Raguel のそれぞれの規則で、起点から置き場を解決する
function bothStores(start: string) {
  const codielRoot = findMainRoot(start)
  const codiel = resolveRaguelStore(codielRoot)
  const loaded = loadConfig(start)
  const raguel = new CaseStore(loaded.config, loaded.projectRoot)
  return { codielRoot, raguelRoot: loaded.projectRoot, codiel, raguel }
}

describe("プロジェクトルートと projectId", () => {
  test("4 つの起点で、プロジェクトルートと projectId と置き場が両者で等しい。git の 3 つの起点の projectId はメインと等しい(G5)", () => {
    const cases = tmp("raguel-records-cases-")
    const main = mainRepo({ raguel: { storage: { casesDir: cases } } })
    const codielWt = path.join(main, ".codiel", "worktrees", "demo", "step-1")
    git(main, "worktree", "add", "-q", "-b", "wt-codiel", codielWt)
    const withCodiel = path.join(tmp("raguel-records-user-"), "wt-a")
    git(main, "worktree", "add", "-q", "-b", "wt-a", withCodiel)
    fs.mkdirSync(path.join(withCodiel, ".codiel"))
    const withoutCodiel = path.join(tmp("raguel-records-user-"), "wt-b")
    git(main, "worktree", "add", "-q", "-b", "wt-b", withoutCodiel)
    const nonGit = tmp("raguel-records-plain-")

    const mainId = resolveRaguelStore(main).projectId
    const expected: [string, string][] = [
      [codielWt, main],
      [path.join(codielWt, "src"), main],
      [withCodiel, withCodiel],
      [withoutCodiel, withoutCodiel],
      [nonGit, nonGit]
    ]
    for (const [start, root] of expected) {
      const s = bothStores(start)
      expect(s.codielRoot, start).toBe(root)
      expect(s.raguelRoot, start).toBe(root)
      expect(s.codiel.projectId, start).toBe(
        raguelProjectId(resolveProjectRoot(start))
      )
      expect(s.codiel.projectDir, start).toBe(s.raguel.projectDir)
      if (start !== nonGit) expect(s.codiel.projectId, start).toBe(mainId)
    }
    // git の管理外は、プロジェクトルートの実体パスから作る
    expect(resolveRaguelStore(nonGit).projectId).toMatch(
      new RegExp(`^${path.basename(nonGit)}-[0-9a-f]{12}$`)
    )
    // codiel の worktree の中からでも、メインの config.json の casesDir を読む
    expect(bothStores(codielWt).codiel.casesDir).toBe(cases)
  })
})

describe("置き場の解決", () => {
  test("サブディレクトリを起点にしても、プロジェクトルートの config.json の casesDir を両者が読む", () => {
    const cases = tmp("raguel-records-cases-")
    const main = mainRepo({ raguel: { storage: { casesDir: cases } } })
    const sub = path.join(main, "src", "deep")
    fs.mkdirSync(sub, { recursive: true })
    const s = bothStores(sub)
    expect(s.codiel.projectDir).toBe(s.raguel.projectDir)
    expect(s.codiel.projectDir.startsWith(`${cases}${path.sep}cases`)).toBe(
      true
    )
  })

  test("相対パスの casesDir は、サブディレクトリを cwd にしても両者がプロジェクトルートを基準に解決する", () => {
    const main = mainRepo({ raguel: { storage: { casesDir: "rel-cases" } } })
    const sub = path.join(main, "src", "deep")
    fs.mkdirSync(sub, { recursive: true })
    const cwd = process.cwd()
    process.chdir(sub)
    try {
      const s = bothStores(sub)
      expect(s.codiel.casesDir).toBe(path.join(main, "rel-cases"))
      expect(s.codiel.projectDir).toBe(s.raguel.projectDir)
    } finally {
      process.chdir(cwd)
    }
  })

  test("config.json に raguel キーが無いときは、両者とも ~/.raguel を使う", () => {
    const main = mainRepo({ testsDir: "qa" })
    const s = bothStores(main)
    expect(s.codiel.projectDir).toBe(s.raguel.projectDir)
    expect(s.codiel.casesDir).toBe(path.join(home, ".raguel"))
  })

  test("raguel.storage に casesDir と projectId を書くと、両者ともその値を使う", () => {
    const cases = tmp("raguel-records-cases-")
    const main = mainRepo({
      raguel: { storage: { casesDir: cases, projectId: "fixed-id" } }
    })
    const s = bothStores(main)
    expect(s.codiel.projectDir).toBe(s.raguel.projectDir)
    expect(s.codiel.projectDir).toBe(path.join(cases, "cases", "fixed-id"))
  })

  test("RAGUEL_CONFIG を設定すると、config.json の raguel より先にそのファイルを両者が読む", () => {
    const cases = tmp("raguel-records-cases-")
    const other = tmp("raguel-records-cases-")
    const main = mainRepo({ raguel: { storage: { casesDir: other } } })
    const file = path.join(tmp("raguel-records-env-"), "raguel.json")
    fs.writeFileSync(
      file,
      JSON.stringify({ storage: { casesDir: cases, projectId: "env-id" } })
    )
    process.env.RAGUEL_CONFIG = file
    const s = bothStores(main)
    expect(s.codiel.projectDir).toBe(s.raguel.projectDir)
    expect(s.codiel.projectDir).toBe(path.join(cases, "cases", "env-id"))
  })

  test("raguel がオブジェクトでない・JSON として読めない設定は、両者とも読み込みの失敗にする", () => {
    for (const body of [JSON.stringify({ raguel: "x" }), "{ broken"]) {
      const main = mainRepo()
      fs.writeFileSync(path.join(main, ".codiel", "config.json"), body)
      expect(() => resolveRaguelStore(main), body).toThrow()
      expect(() => loadConfig(main), body).toThrow()
    }
  })
})

describe("testsDir と E2E のレポートの判定(R24)", () => {
  test("readCodielConfig と resolveTestsDir の testsDir が等しく、不正な値では両方が失敗する", () => {
    const root = mainRepo()
    // config.json が無いとき
    expect(readCodielConfig(root).testsDir).toBe(resolveTestsDir(root))
    expect(resolveTestsDir(root)).toBe("docs/codiel/tests")
    const valid: [unknown, string][] = [
      [undefined, "docs/codiel/tests"],
      ["./qa/specs/", "qa/specs"],
      [".", "."],
      ["./", "."]
    ]
    for (const [value, want] of valid) {
      writeConfig(root, value === undefined ? {} : { testsDir: value })
      expect(readCodielConfig(root).testsDir, String(value)).toBe(want)
      expect(resolveTestsDir(root), String(value)).toBe(want)
    }
    for (const value of [1, "", "/abs/tests", "C:\\tests", "a/../b"]) {
      writeConfig(root, { testsDir: value })
      expect(() => readCodielConfig(root), String(value)).toThrow()
      expect(() => resolveTestsDir(root), String(value)).toThrow()
    }
  })

  test("guard-write の isE2eReport と Raguel の判定が同じパスの列で同じ答えを返す", () => {
    const paths = [
      "docs/codiel/tests/e2e/frontend/a/reports/20260928-demo-try1/x.png",
      "docs/codiel/tests/e2e/backend/api/reports/results.json",
      "docs/codiel/tests/units/reports/a.md",
      "docs/codiel/tests/reports/x.md",
      "docs/codiel/tests/e2e/frontend/a/spec.md",
      "docs/codiel/testsx/e2e/reports/x.md",
      "reports/x.md",
      "src/reports/x.ts",
      "qa/e2e/cli/x/reports/r.json",
      "qa/reports.md"
    ]
    for (const testsDir of ["docs/codiel/tests", "qa", "."])
      for (const p of paths) {
        const codiel = isE2eReport(p, testsDir)
        expect(raguelIsE2eReport(p, testsDir), `${testsDir} ${p}`).toBe(codiel)
        expect(
          classifyPath(p, defaultConfig, testsDir) === "report",
          `${testsDir} ${p}`
        ).toBe(codiel)
      }
    // 列が両方の答えを含む
    expect(paths.some((p) => isE2eReport(p, "docs/codiel/tests"))).toBe(true)
    expect(paths.some((p) => !isE2eReport(p, "docs/codiel/tests"))).toBe(true)
  })
})

describe("Raguel が書いた記録を codiel が読む", () => {
  const RUN = "demo-try-1"
  let root: string
  let store: CaseStore

  beforeEach(() => {
    const cases = tmp("raguel-records-cases-")
    root = mainRepo({ raguel: { storage: { casesDir: cases } } })
    const loaded = loadConfig(root)
    store = new CaseStore(loaded.config, loaded.projectRoot)
  })

  // Raguel の CaseStore で評価を 1 件書き、索引に行を足す
  function evaluate(
    phase: GatedPhase,
    verdict: Verdict,
    subject: Subject,
    judgeStatus: "ok" | "degraded" = "ok"
  ): string {
    const { dir, attempt } = store.openAttempt(RUN, phase)
    const evaluationId = `${phase}-${attempt}-${verdict}`
    store.writeEvidence(dir, "submission.txt", "本文")
    store.finalizeVerdict(dir, {
      evaluationId,
      runId: RUN,
      phase,
      kind: "code",
      attempt,
      verdict,
      judgeStatus,
      degradedReasons: [],
      findings: [],
      reasons: [],
      subject,
      policy: {
        configHash: "h",
        configSource: "defaults",
        version: 2,
        buildVersion: "0.0.0"
      }
    })
    store.appendEvaluationIndex({
      schemaVersion: 2,
      evaluationId,
      runId: RUN,
      phase,
      kind: "code",
      attempt,
      casePath: dir,
      verdict,
      judgeStatus,
      head: subject.head,
      at: new Date().toISOString()
    })
    return evaluationId
  }

  function ruling(
    evaluationId: string,
    phase: GatedPhase,
    rulingValue: "as-is" | "false-positive" | "revise",
    outcome: "approved" | "rejected" = "approved"
  ): void {
    store.appendOutcome({
      schemaVersion: 2,
      evaluationId,
      runId: RUN,
      phase,
      outcome,
      ruling: rulingValue,
      precedentId: null,
      at: new Date().toISOString()
    })
  }

  const gate = (
    phase: string,
    evaluationId: string,
    verdict: string,
    extra: { humanApproved?: boolean; startHead?: string } = {}
  ) =>
    checkGate({
      store: resolveRaguelStore(findMainRoot(root)),
      root,
      runId: RUN,
      phase,
      evaluationId,
      verdict,
      humanApproved: extra.humanApproved ?? false,
      startHead: extra.startHead,
      runDocsDir: "docs/codiel/runs/demo",
      testsDir: "docs/codiel/tests"
    })

  test("codiel の置き場は Raguel の CaseStore の置き場と等しい", () => {
    expect(resolveRaguelStore(root).projectDir).toBe(store.projectDir)
  })

  test("intent の PROCEED・ASK の as-is・STOP の false-positive で pass-gate の検査が通る", () => {
    const head = git(root, "rev-parse", "HEAD")
    const subject: Subject = {
      repoPath: root,
      head,
      files: [],
      contentSha256: "0".repeat(64)
    }
    const proceed = evaluate("intent", "PROCEED", subject)
    expect(gate("intent", proceed, "PROCEED")).toBeNull()
    const ask = evaluate("intent", "ASK", subject)
    ruling(ask, "intent", "as-is")
    expect(gate("intent", ask, "ASK", { humanApproved: true })).toBeNull()
    const stop = evaluate("intent", "STOP", subject)
    expect(gate("intent", stop, "STOP", { humanApproved: true })).toMatch(
      /裁定の記録が要ります/
    )
    ruling(stop, "intent", "false-positive")
    expect(gate("intent", stop, "STOP", { humanApproved: true })).toBeNull()
  })

  test("code 系フェーズは、subject の head と base が現在の HEAD とフェーズの開始の HEAD に合えば通る", () => {
    const start = git(root, "rev-parse", "HEAD")
    fs.writeFileSync(path.join(root, "a.ts"), "export const a = 1\n")
    git(root, "add", "a.ts")
    git(root, "commit", "-q", "-m", "a")
    const head = git(root, "rev-parse", "HEAD")
    const sha = createHash("sha256")
      .update(fs.readFileSync(path.join(root, "a.ts")))
      .digest("hex")
    const id = evaluate("implement", "PROCEED", {
      repoPath: root,
      head,
      base: start,
      files: [{ path: "a.ts", sha256: sha, isNew: true }]
    })
    expect(gate("implement", id, "PROCEED", { startHead: start })).toBeNull()
    expect(gate("implement", id, "PROCEED", { startHead: head })).toMatch(
      /フェーズの開始の HEAD/
    )
  })

  test("文書のフェーズは、subject.files の sha256 が今の中身と合えば通り、書き換えると外れる", () => {
    const rel = "docs/codiel/runs/demo/design.md"
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "# 設計\n")
    const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    const id = evaluate("design", "PROCEED", {
      repoPath: root,
      head: git(root, "rev-parse", "HEAD"),
      paths: [rel],
      files: [{ path: rel, sha256: sha, isNew: true }]
    })
    expect(gate("design", id, "PROCEED")).toBeNull()
    fs.appendFileSync(file, "追記\n")
    expect(gate("design", id, "PROCEED")).toMatch(/評価の後に変わっています/)
  })

  test("mark-ask の照合と init の STOP の検出が Raguel の記録で動く", () => {
    const subject: Subject = { repoPath: root, head: null, files: [] }
    const ask = evaluate("design", "ASK", subject)
    const codielStore = resolveRaguelStore(root)
    const row = findEvaluation(readEvaluationIndex(codielStore), ask)
    expect(
      checkEvaluationRow(row, {
        evaluationId: ask,
        runId: RUN,
        phase: "design",
        verdict: "ASK"
      })
    ).toBeNull()
    expect(unresolvedStops(codielStore, RUN)).toEqual([])
    const stop = evaluate("design", "STOP", subject)
    evaluate("design", "STOP", subject, "degraded")
    expect(unresolvedStops(codielStore, RUN)).toEqual([stop])
    ruling(stop, "design", "false-positive")
    expect(unresolvedStops(codielStore, RUN)).toEqual([])
  })

  test("codiel-state pass-gate が Raguel の書いた記録で通る", () => {
    const run = (args: string[]) =>
      spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env }
      })
    expect(
      run([
        "init",
        "--slug",
        "demo",
        "--intent",
        "docs/intents/2026-09-29-demo.md",
        "--integration",
        "local",
        "--scale",
        "standard",
        "--knowledge-target",
        "intents",
        "--adr-candidates",
        "on",
        "--gotcha-candidates",
        "on",
        "--image-upload",
        "none"
      ]).status
    ).toBe(0)
    expect(run(["start-phase", "intent", "--slug", "demo"]).status).toBe(0)
    const id = evaluate("intent", "PROCEED", {
      repoPath: root,
      head: git(root, "rev-parse", "HEAD"),
      files: [],
      contentSha256: "0".repeat(64)
    })
    const r = run([
      "pass-gate",
      "intent",
      "--slug",
      "demo",
      "--evaluation-id",
      id,
      "--verdict",
      "PROCEED"
    ])
    expect(r.stderr).toBe("")
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).state.phases.intent.status).toBe("passed")
  })
})

describe("Raguel のパイプラインが書いた空の差分の記録(R22)", () => {
  let h: Harness
  afterEach(() => h.cleanup())

  // Raguel の evaluate で test-loop を評価し、codiel の pass-gate の検査にかける
  async function emptyDiffGate(extra: Record<string, unknown> = {}) {
    h = makeHarness()
    const r = await h.evaluate({
      tool: "evaluate_code",
      runId: "run-1",
      phase: "test-loop",
      objective: "回帰を通す",
      baseRef: h.base,
      ...extra
    })
    const problem = checkGate({
      store: resolveRaguelStore(findMainRoot(h.repo)),
      root: h.repo,
      runId: "run-1",
      phase: "test-loop",
      evaluationId: r.evaluationId,
      verdict: r.verdict,
      humanApproved: false,
      startHead: h.base,
      runDocsDir: "docs/codiel/runs/demo",
      testsDir: "docs/codiel/tests"
    })
    return { r, problem }
  }

  test("変更の無い test-loop の PROCEED で、code 系の pass-gate(検査 8)が通る(W4R2-07)", async () => {
    const { r, problem } = await emptyDiffGate()
    expect(r.verdict).toBe("PROCEED")
    expect(r.subject).toMatchObject({ base: h.base, head: h.base, files: [] })
    expect(problem).toBeNull()
  })

  test("paths で範囲を絞った空の差分の記録では、検査 8 が通さない(W4R2-01・W4R1-03)", async () => {
    const { r, problem } = await emptyDiffGate({ paths: ["README.md"] })
    expect(r.verdict).toBe("PROCEED")
    expect(problem).toMatch(/paths\(\["README.md"\]\)で絞られています/)
  })
})

describe("carry-over の評価の記録(分岐点から run ブランチの HEAD までの差分)", () => {
  let h: Harness
  let fork: string
  let tip: string
  afterEach(() => h.cleanup())

  // run ブランチに前の try のテストと製品コードを積み、ベースブランチも進めて、
  // 分岐点・ベースブランチの先端・run ブランチの HEAD がすべて違う状態にする
  beforeEach(() => {
    // 所見の出ない確率をすべての問いに返す Jev
    const jevCall: JevCall = async (req) => ({
      answers: Object.fromEntries(
        Object.keys(req.questions).map((id) => [
          id,
          { type: "noul" as const, noul: /^c\d+$/.test(id) ? 0.9 : 0.6 }
        ])
      )
    })
    h = makeHarness({ jevCall, jevApiKey: "k" })
    const baseBranch = git(h.repo, "rev-parse", "--abbrev-ref", "HEAD")
    git(h.repo, "switch", "-q", "-c", "codiel/demo")
    h.commit({
      "src/add.ts": "export const add = (a: number, b: number) => a + b\n",
      "src/__test__/add.test.ts":
        'import { add } from "../add"\nif (add(1, 2) !== 3) throw new Error("add")\n'
    })
    git(h.repo, "switch", "-q", baseBranch)
    tip = h.commit({ "CHANGELOG.md": "# 変更履歴\n" })
    git(h.repo, "switch", "-q", "codiel/demo")
    fork = gitMergeBase(h.repo, baseBranch, "HEAD") as string
  })

  async function carryOverGate(baseRef: string, extra = {}) {
    const r = await h.evaluate({
      tool: "evaluate_code",
      runId: "run-1",
      phase: "carry-over",
      objective: "前の try から引き継いだ加算の関数とテストを評価する",
      baseRef,
      ...extra
    })
    const problem = checkGate({
      store: resolveRaguelStore(findMainRoot(h.repo)),
      root: h.repo,
      runId: "run-1",
      phase: "carry-over",
      evaluationId: r.evaluationId,
      verdict: r.verdict,
      humanApproved: false,
      startHead: fork,
      runDocsDir: "docs/codiel/runs/demo",
      testsDir: "docs/codiel/tests"
    })
    return { r, problem }
  }

  test("分岐点を baseRef にした評価で、carry-over の pass-gate(検査 8)が通る", async () => {
    expect(fork).toBe(h.base)
    expect(fork).not.toBe(git(h.repo, "rev-parse", "HEAD"))
    expect(fork).not.toBe(tip)
    const { r, problem } = await carryOverGate(fork)
    expect(r.verdict).toBe("PROCEED")
    expect(r.subject).toMatchObject({ base: fork })
    expect((r.subject.files ?? []).map((f) => f.path).sort()).toStrictEqual([
      "src/__test__/add.test.ts",
      "src/add.ts"
    ])
    expect(problem).toBeNull()
  })

  test("分岐点でない baseRef の評価と paths で絞った評価は、検査 8 が通さない", async () => {
    const wrong = await carryOverGate(tip)
    expect(wrong.problem).toMatch(/評価の起点\(.+\)がフェーズの開始の HEAD/)
    const narrowed = await carryOverGate(fork, { paths: ["src/add.ts"] })
    expect(narrowed.problem).toMatch(
      /paths\(\["src\/add.ts"\]\)で絞られています/
    )
  })
})
