import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  EvaluationIndexEntry,
  GatedPhase,
  OutcomeRecord,
  Subject,
  VerdictRecord
} from "../../core/types"
import { resolveProjectId } from "../../project/root"
import { makeConfig } from "../../rules/testHelpers"
import { computeDigest } from "../digest"
import {
  CaseStore,
  NO_EVALUATION_RECORD,
  sanitizeRunId,
  type VerdictRecordInput
} from "../store"

const DAY = 24 * 60 * 60 * 1000

function configFor(
  casesDir: string,
  projectId: string | undefined,
  retention = { maxRuns: 200, maxDays: 90 }
) {
  return makeConfig({
    storage: { casesDir, ...(projectId ? { projectId } : {}), retention }
  })
}

const subject: Subject = {
  repoPath: "/repo",
  head: "a".repeat(40),
  base: "b".repeat(40),
  files: [{ path: "src/a.ts", sha256: "c".repeat(64), isNew: false }]
}

function record(
  over: Partial<VerdictRecordInput> & {
    runId: string
    phase: GatedPhase
    attempt: number
  }
): VerdictRecordInput {
  return {
    evaluationId: `eval-${over.runId}-${over.phase}-${over.attempt}`,
    kind: "code",
    verdict: "ASK",
    judgeStatus: "ok",
    degradedReasons: [],
    findings: [],
    reasons: [],
    subject,
    policy: {
      configHash: "hash",
      configSource: "defaults",
      version: 2,
      buildVersion: "0.0.0"
    },
    ...over
  }
}

function indexEntry(
  over: Partial<EvaluationIndexEntry> & { evaluationId: string; runId: string }
): EvaluationIndexEntry {
  return {
    schemaVersion: 2,
    phase: "implement",
    kind: "code",
    attempt: 1,
    casePath: "/tmp/x",
    verdict: "ASK",
    judgeStatus: "ok",
    head: null,
    at: new Date().toISOString(),
    ...over
  }
}

function outcome(
  over: Partial<OutcomeRecord> & { evaluationId: string; runId: string }
): OutcomeRecord {
  return {
    schemaVersion: 2,
    phase: "implement",
    outcome: "approved",
    ruling: null,
    precedentId: null,
    at: new Date().toISOString(),
    ...over
  }
}

function editVerdict(dir: string, edit: (v: VerdictRecord) => void): void {
  const file = path.join(dir, "verdict.json")
  const v = JSON.parse(fs.readFileSync(file, "utf-8")) as VerdictRecord
  edit(v)
  fs.writeFileSync(file, JSON.stringify(v, null, 2))
}

describe("CaseStore", () => {
  let tmpDir: string
  let store: CaseStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-case-"))
    store = new CaseStore(configFor(tmpDir, "demo"), tmpDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** attempt を開き、証拠を書いて確定する */
  function evaluate(
    runId: string,
    phase: GatedPhase,
    over: Partial<VerdictRecordInput> = {}
  ): { dir: string; attempt: number; verdict: VerdictRecord } {
    const { dir, attempt } = store.openAttempt(runId, phase)
    store.writeEvidence(dir, "submission.txt", `本文 ${attempt}`)
    store.writeEvidence(dir, "01-rules.json", JSON.stringify({ findings: [] }))
    store.writeEvidence(dir, "06-precedents.json", "[]")
    const verdict = store.finalizeVerdict(
      dir,
      record({ runId, phase, attempt, ...over })
    )
    return { dir, attempt, verdict }
  }

  describe("置き場と attempt の番号(F4)", () => {
    it("<runId>/<phase>/attempt-NN に置き、番号は run とフェーズの組ごとに振る", () => {
      const a1 = store.openAttempt("run-1", "implement")
      const a2 = store.openAttempt("run-1", "implement")
      const d1 = store.openAttempt("run-1", "design")
      expect(a1.attempt).toBe(1)
      expect(a2.attempt).toBe(2)
      expect(d1.attempt).toBe(1)
      expect(a2.dir).toBe(
        path.join(tmpDir, "cases", "demo", "run-1", "implement", "attempt-02")
      )
      expect(d1.dir).toBe(
        path.join(tmpDir, "cases", "demo", "run-1", "design", "attempt-01")
      )
    })

    it("同じ kind でもフェーズが違えば番号を共有しない(implement と fix-loop)", () => {
      store.openAttempt("run-1", "implement")
      store.openAttempt("run-1", "implement")
      expect(store.openAttempt("run-1", "fix-loop").attempt).toBe(1)
    })

    it("不正な runId と表に無い phase を拒む", () => {
      expect(() => store.openAttempt("../evil", "implement")).toThrow()
      expect(() => store.openAttempt("..", "implement")).toThrow()
      expect(() => store.openAttempt("foo/bar", "implement")).toThrow()
      expect(() =>
        store.openAttempt("run-1", "code" as unknown as GatedPhase)
      ).toThrow(/phase/)
    })

    it("latestAttemptDir は番号の数値で最新を選ぶ(attempt-100 > attempt-99)", () => {
      expect(store.latestAttemptDir("run-1", "implement")).toBeUndefined()
      const phaseDir = path.join(tmpDir, "cases", "demo", "run-1", "implement")
      fs.mkdirSync(path.join(phaseDir, "attempt-99"), { recursive: true })
      fs.mkdirSync(path.join(phaseDir, "attempt-100"))
      fs.mkdirSync(path.join(phaseDir, "notes"))
      expect(store.latestAttemptDir("run-1", "implement")).toBe(
        path.join(phaseDir, "attempt-100")
      )
      expect(store.openAttempt("run-1", "implement").attempt).toBe(101)
    })

    it("既知でない証拠ファイル名は書かない(旧 06-assumption.md など)", () => {
      const { dir } = store.openAttempt("run-1", "implement")
      expect(() =>
        store.writeEvidence(dir, "06-assumption.md" as never, "x")
      ).toThrow(/未知/)
    })
  })

  describe("projectId(G5・I1)", () => {
    it("storage.projectId が無ければ git の共通ディレクトリから作り、worktree からも同じ置き場になる", () => {
      const repo = path.join(tmpDir, "myrepo")
      fs.mkdirSync(repo)
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" })
      git("init", "-q")
      git(
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init"
      )
      const wt = path.join(tmpDir, "wt")
      git("worktree", "add", "-q", wt)

      const config = configFor(tmpDir, undefined)
      const main = new CaseStore(config, repo)
      const other = new CaseStore(config, wt)
      expect(other.projectDir).toBe(main.projectDir)
      expect(path.basename(main.projectDir)).toBe(resolveProjectId(repo))
      expect(path.basename(main.projectDir)).toMatch(/^myrepo-[0-9a-f]{12}$/)
    })

    it("storage.projectId があればそれを使い、casesDir の ~ を展開する", () => {
      const s = new CaseStore(
        makeConfig({
          storage: {
            casesDir: "~/raguel-x",
            projectId: "pid",
            retention: { maxRuns: 1, maxDays: 1 }
          }
        }),
        tmpDir
      )
      expect(s.projectDir).toBe(
        path.join(os.homedir(), "raguel-x", "cases", "pid")
      )
    })
  })

  describe("verdict.json とチェーン(G6・G8)", () => {
    it("finalizeVerdict は subject.json を書き、既知の証拠だけを evidence に載せ、検証が通る", () => {
      const { dir } = store.openAttempt("run-1", "implement")
      store.writeEvidence(dir, "submission.txt", "本文")
      store.writeEvidence(dir, "01-rules.json", "{}")
      fs.writeFileSync(path.join(dir, ".01-rules.json.swp"), "editor")
      const v = store.finalizeVerdict(
        dir,
        record({ runId: "run-1", phase: "implement", attempt: 1 })
      )
      expect(v.schemaVersion).toBe(2)
      expect(v.prevChainHead).toBeNull()
      expect(v.evidence.map((e) => e.name)).toEqual([
        "01-rules.json",
        "subject.json",
        "submission.txt"
      ])
      expect(
        JSON.parse(fs.readFileSync(path.join(dir, "subject.json"), "utf-8"))
      ).toEqual(subject)
      expect(store.readVerdict(dir)).toEqual(v)
      expect(store.verifyAttempt(dir)).toEqual({ ok: true, mismatches: [] })
    })

    it("既知でないファイルを後から置いても検証は通る(G6)", () => {
      const { dir } = evaluate("run-1", "implement")
      fs.writeFileSync(path.join(dir, "verdict.json~"), "backup")
      fs.writeFileSync(path.join(dir, "4913"), "vim")
      expect(store.verifyAttempt(dir).ok).toBe(true)
    })

    it("verdict.json の verdict や judgeStatus だけを書き換えると検出する(G8)", () => {
      const { dir } = evaluate("run-1", "implement", { verdict: "STOP" })
      editVerdict(dir, (v) => {
        v.verdict = "PROCEED"
      })
      const r = store.verifyAttempt(dir)
      expect(r.ok).toBe(false)
      expect(r.mismatches.join("\n")).toMatch(/chainHead/)

      const second = evaluate("run-2", "implement", {
        judgeStatus: "degraded"
      })
      editVerdict(second.dir, (v) => {
        v.judgeStatus = "ok"
      })
      expect(store.verifyAttempt(second.dir).ok).toBe(false)
    })

    it("verdict.json の subject を書き換えると検出する", () => {
      const { dir } = evaluate("run-1", "implement")
      editVerdict(dir, (v) => {
        v.subject = { ...v.subject, head: "d".repeat(40) }
      })
      expect(store.verifyAttempt(dir).mismatches.join("\n")).toMatch(/subject/)
    })

    it("既知の証拠の書き換え・削除・後からの追加を検出する", () => {
      const a = evaluate("run-1", "implement")
      fs.writeFileSync(path.join(a.dir, "submission.txt"), "差し替え")
      expect(store.verifyAttempt(a.dir).mismatches.join("\n")).toMatch(
        /sha256.*submission\.txt/
      )

      const b = evaluate("run-2", "implement")
      fs.rmSync(path.join(b.dir, "06-precedents.json"))
      expect(store.verifyAttempt(b.dir).mismatches.join("\n")).toMatch(
        /ありません: 06-precedents\.json/
      )

      const c = evaluate("run-3", "implement")
      fs.writeFileSync(path.join(c.dir, "07-context.json"), "後から")
      expect(store.verifyAttempt(c.dir).mismatches.join("\n")).toMatch(
        /記録の無い.*07-context\.json/
      )
    })

    it("verdict.json が無い・読めないときは改竄として扱う", () => {
      const { dir } = store.openAttempt("run-1", "implement")
      expect(store.verifyAttempt(dir).ok).toBe(false)
      fs.writeFileSync(path.join(dir, "verdict.json"), "{broken")
      expect(store.verifyAttempt(dir).ok).toBe(false)
      expect(store.readVerdict(dir)).toBeUndefined()
    })

    it("2 回目の attempt は前の attempt の chainHead を prevChainHead に持つ", () => {
      const first = evaluate("run-1", "implement")
      const second = evaluate("run-1", "implement")
      const otherPhase = evaluate("run-1", "fix-loop")
      expect(second.verdict.prevChainHead).toBe(first.verdict.chainHead)
      expect(otherPhase.verdict.prevChainHead).toBeNull()
      expect(store.verifyAttempt(second.dir).ok).toBe(true)
    })

    it("前の attempt を丸ごと作り直す差し替えを、後の attempt の検証で検出する", () => {
      const first = evaluate("run-1", "implement", { verdict: "STOP" })
      const second = evaluate("run-1", "implement")
      // 計算手順どおりに作り直す(1 つの attempt の中では整合する)
      store.finalizeVerdict(
        first.dir,
        record({
          runId: "run-1",
          phase: "implement",
          attempt: 1,
          verdict: "PROCEED"
        })
      )
      expect(store.verifyAttempt(first.dir).ok).toBe(true)
      expect(store.verifyAttempt(second.dir).mismatches.join("\n")).toMatch(
        /prevChainHead/
      )
    })

    it("前の attempt の削除を検出する", () => {
      const first = evaluate("run-1", "implement")
      const second = evaluate("run-1", "implement")
      fs.rmSync(first.dir, { recursive: true })
      expect(store.verifyAttempt(second.dir).mismatches.join("\n")).toMatch(
        /prevChainHead/
      )
    })

    it("verdict.json は一時ファイルと rename で書く(書き直しで inode が替わり、一時ファイルが残らない)", () => {
      const { dir } = evaluate("run-1", "implement")
      const file = path.join(dir, "verdict.json")
      const before = fs.statSync(file).ino
      store.finalizeVerdict(
        dir,
        record({ runId: "run-1", phase: "implement", attempt: 1 })
      )
      expect(fs.statSync(file).ino).not.toBe(before)
      expect(fs.readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([])
    })
  })

  describe("評価の索引と裁定の記録(G3・G4)", () => {
    it("evaluationId で索引を引き、複数行があれば後の行を正とする", () => {
      store.appendEvaluationIndex(
        indexEntry({ evaluationId: "e1", runId: "run-1", verdict: "ASK" })
      )
      store.appendEvaluationIndex(
        indexEntry({ evaluationId: "e1", runId: "run-1", verdict: "STOP" })
      )
      expect(store.lookupEvaluation("e1")?.verdict).toBe("STOP")
      expect(store.lookupEvaluation("missing")).toBeUndefined()
      const lines = fs
        .readFileSync(path.join(store.projectDir, "evaluations.jsonl"), "utf-8")
        .trim()
        .split("\n")
      expect(lines).toHaveLength(2)
    })

    it("裁定の記録は同じ evaluationId の後の行を正とする", () => {
      store.appendOutcome(
        outcome({ evaluationId: "e1", runId: "run-1", ruling: "revise" })
      )
      store.appendOutcome(
        outcome({
          evaluationId: "e1",
          runId: "run-1",
          ruling: "as-is",
          notes: "人の判断"
        })
      )
      expect(store.lookupOutcome("e1")).toMatchObject({
        ruling: "as-is",
        notes: "人の判断"
      })
      expect(store.lookupOutcome("e2")).toBeUndefined()
    })

    it("読めない索引の行は例外にし、掃除で上書きしない(G4)", () => {
      store.appendEvaluationIndex(
        indexEntry({
          evaluationId: "old",
          runId: "run-old",
          at: new Date(Date.now() - 400 * DAY).toISOString()
        })
      )
      const file = path.join(store.projectDir, "evaluations.jsonl")
      fs.appendFileSync(file, "{broken\n")
      const before = fs.readFileSync(file, "utf-8")
      fs.mkdirSync(path.join(store.projectDir, "run-old"))

      expect(() => store.lookupEvaluation("old")).toThrow(
        /evaluations\.jsonl:2/
      )
      expect(() => store.sweepRetention()).toThrow(/読めません/)
      expect(fs.readFileSync(file, "utf-8")).toBe(before)
      expect(fs.existsSync(path.join(store.projectDir, "run-old"))).toBe(true)
    })

    it("索引に無い evaluationId は「評価の記録が無い」で、改竄の文言と別になる(G3)", () => {
      const { dir } = evaluate("run-1", "implement")
      fs.writeFileSync(path.join(dir, "submission.txt"), "差し替え")
      const tamper = store.verifyAttempt(dir).mismatches
      expect(store.lookupEvaluation("eval-swept")).toBeUndefined()
      expect(NO_EVALUATION_RECORD).toContain("評価の記録が無い")
      expect(NO_EVALUATION_RECORD).toContain("掃除済み")
      for (const m of tamper) expect(m).not.toContain("評価の記録が無い")
    })
  })

  describe("掃除(G3・I1)", () => {
    /** 評価を 1 件書き、索引の at を指定する */
    function evaluateAt(runId: string, at: number, mtime: number): void {
      const { dir, attempt, verdict } = evaluate(runId, "implement")
      store.appendEvaluationIndex(
        indexEntry({
          evaluationId: verdict.evaluationId,
          runId,
          attempt,
          casePath: dir,
          at: new Date(at).toISOString()
        })
      )
      store.appendOutcome(
        outcome({ evaluationId: verdict.evaluationId, runId })
      )
      const runDir = path.join(store.projectDir, runId)
      fs.utimesSync(runDir, new Date(mtime), new Date(mtime))
    }

    it("maxRuns は最後の評価の at で数え、ディレクトリの mtime を見ない", () => {
      store = new CaseStore(
        configFor(tmpDir, "demo", { maxRuns: 2, maxDays: 9999 }),
        tmpDir
      )
      const now = Date.now()
      // mtime は at と逆順にする
      evaluateAt("run-old", now - 3000, now - 1000)
      evaluateAt("run-mid", now - 2000, now - 2000)
      evaluateAt("run-new", now - 1000, now - 3000)

      expect(store.sweepRetention(now)).toEqual(["run-old"])
      expect(fs.existsSync(path.join(store.projectDir, "run-old"))).toBe(false)
      expect(fs.existsSync(path.join(store.projectDir, "run-mid"))).toBe(true)
      expect(fs.existsSync(path.join(store.projectDir, "run-new"))).toBe(true)
    })

    it("maxDays を過ぎた run を消し、その行を evaluations.jsonl と outcomes.jsonl からも消す", () => {
      const now = Date.now()
      evaluateAt("run-stale", now - 91 * DAY, now)
      evaluateAt("run-fresh", now - 89 * DAY, now - 100 * DAY)
      const evalFile = path.join(store.projectDir, "evaluations.jsonl")
      const inode = fs.statSync(evalFile).ino

      expect(store.sweepRetention(now)).toEqual(["run-stale"])
      expect(fs.existsSync(path.join(store.projectDir, "run-stale"))).toBe(
        false
      )
      expect(fs.existsSync(path.join(store.projectDir, "run-fresh"))).toBe(true)

      const runIds = (name: string) =>
        fs
          .readFileSync(path.join(store.projectDir, name), "utf-8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l).runId)
      expect(runIds("evaluations.jsonl")).toEqual(["run-fresh"])
      expect(runIds("outcomes.jsonl")).toEqual(["run-fresh"])
      // 書き直しは一時ファイルと rename(G4)
      expect(fs.statSync(evalFile).ino).not.toBe(inode)
      // 掃除した評価は「記録が無い」になり、改竄とは区別できる(G3)
      expect(
        store.lookupEvaluation("eval-run-stale-implement-1")
      ).toBeUndefined()
      expect(store.lookupEvaluation("eval-run-fresh-implement-1")).toBeDefined()
    })

    it('runId "." の索引の行があっても、掃除で projectDir を消さない(R2-06)', () => {
      const now = Date.now()
      evaluateAt("run-1", now, now)
      store.appendEvaluationIndex(
        indexEntry({
          evaluationId: "eval-dot",
          runId: ".",
          at: new Date(now - 91 * DAY).toISOString()
        })
      )
      store.sweepRetention(now)
      expect(fs.existsSync(store.projectDir)).toBe(true)
      expect(fs.existsSync(path.join(store.projectDir, "run-1"))).toBe(true)
    })

    it('sanitizeRunId は "." を拒否する(R2-06)', () => {
      expect(() => sanitizeRunId(".", store.projectDir)).toThrow("不正な runId")
      expect(() => store.openAttempt(".", "implement")).toThrow("不正な runId")
      expect(sanitizeRunId("run-1.v2", store.projectDir)).toBe("run-1.v2")
    })

    it("上限の内側なら何も消さず、索引も書き直さない", () => {
      const now = Date.now()
      evaluateAt("run-1", now, now)
      const evalFile = path.join(store.projectDir, "evaluations.jsonl")
      const inode = fs.statSync(evalFile).ino
      expect(store.sweepRetention(now)).toEqual([])
      expect(fs.statSync(evalFile).ino).toBe(inode)
    })
  })

  describe("過去の attempt(再提出の比較の相手)", () => {
    it("verdict・judgeStatus・裁定の有無・ask 以上の ruleId・ダイジェストを attempt の順に返す", () => {
      const digest = computeDigest("本文")
      const a1 = store.openAttempt("run-1", "design")
      store.writeEvidence(
        a1.dir,
        "01-rules.json",
        JSON.stringify({
          findings: [
            { ruleId: "plan/vague-terms", severity: "info", message: "" },
            { ruleId: "design/missing-sections", severity: "ask", message: "" },
            { ruleId: "design/missing-sections", severity: "ask", message: "" },
            { ruleId: "common/secrets", severity: "stop", message: "" }
          ]
        })
      )
      store.writeSubmissionDigest(a1.dir, digest)
      const v1 = store.finalizeVerdict(
        a1.dir,
        record({ runId: "run-1", phase: "design", attempt: 1, kind: "design" })
      )
      store.appendOutcome(
        outcome({
          evaluationId: v1.evaluationId,
          runId: "run-1",
          phase: "design",
          outcome: "rejected",
          ruling: "as-is"
        })
      )

      const a2 = store.openAttempt("run-1", "design")
      store.finalizeVerdict(
        a2.dir,
        record({
          runId: "run-1",
          phase: "design",
          attempt: 2,
          kind: "design",
          verdict: "PROCEED",
          judgeStatus: "degraded"
        })
      )
      // verdict.json の無い attempt は数えない
      store.openAttempt("run-1", "design")

      expect(store.readPriorAttempts("run-1", "design")).toEqual([
        {
          attempt: 1,
          verdict: "ASK",
          judgeStatus: "ok",
          hasRuling: true,
          askRuleIds: ["design/missing-sections", "common/secrets"],
          digest
        },
        {
          attempt: 2,
          verdict: "PROCEED",
          judgeStatus: "degraded",
          hasRuling: false,
          askRuleIds: [],
          digest: null
        }
      ])
      expect(store.readPriorAttempts("run-1", "implement")).toEqual([])
    })

    it.each([
      ["as-is", true],
      ["false-positive", true],
      ["revise", false]
    ] as const)("裁定が %s の attempt は hasRuling が %s", (ruling, expected) => {
      const { verdict } = evaluate("run-1", "implement")
      store.appendOutcome(
        outcome({
          evaluationId: verdict.evaluationId,
          runId: "run-1",
          outcome: "rejected",
          ruling
        })
      )
      expect(store.readPriorAttempts("run-1", "implement")[0].hasRuling).toBe(
        expected
      )
    })

    it("askRuleIdsBeforeJudge があればそれを、無ければ findings を読む", () => {
      const findings = [
        { ruleId: "code/unsafe-exec", severity: "ask", message: "" },
        { ruleId: "plan/vague-terms", severity: "info", message: "" }
      ]
      const withKey = store.openAttempt("run-1", "design")
      store.writeEvidence(
        withKey.dir,
        "01-rules.json",
        JSON.stringify({ findings, askRuleIdsBeforeJudge: ["common/secrets"] })
      )
      store.finalizeVerdict(
        withKey.dir,
        record({ runId: "run-1", phase: "design", attempt: 1, kind: "design" })
      )
      const without = store.openAttempt("run-1", "design")
      store.writeEvidence(
        without.dir,
        "01-rules.json",
        JSON.stringify({ findings })
      )
      store.finalizeVerdict(
        without.dir,
        record({ runId: "run-1", phase: "design", attempt: 2, kind: "design" })
      )
      expect(
        store.readPriorAttempts("run-1", "design").map((p) => p.askRuleIds)
      ).toEqual([["common/secrets"], ["code/unsafe-exec"]])
    })

    it("run 全体の結末(ruling が null)は裁定に数えない", () => {
      const { verdict } = evaluate("run-1", "implement")
      store.appendOutcome(
        outcome({ evaluationId: verdict.evaluationId, runId: "run-1" })
      )
      expect(store.readPriorAttempts("run-1", "implement")[0].hasRuling).toBe(
        false
      )
    })

    it("読めないダイジェストはパスを添えて warn を出し、null にする", () => {
      const write = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true)
      const { dir } = evaluate("run-1", "implement")
      fs.writeFileSync(path.join(dir, "submission-digest.json"), "{broken")
      expect(store.readPriorAttempts("run-1", "implement")[0].digest).toBeNull()
      const logged = write.mock.calls.map((c) => String(c[0])).join("")
      expect(logged).toContain("[raguel:warn]")
      expect(logged).toContain("submission-digest.json")
    })
  })
})
