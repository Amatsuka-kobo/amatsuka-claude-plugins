import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect } from "vitest"
import { GATED } from "../../codiel-state.js"
import { raguelConfigPath, runCli } from "./run-cli.js"

export const UNTIL_PR = [
  "intent",
  "discuss",
  "design",
  "test-spec",
  "dev-plan",
  "test-code",
  "implement",
  "test-loop",
  "intent-sync"
]

export const UNTIL_REVIEW = [...UNTIL_PR, "pr", "review"]

export const UNTIL_FINALIZE = [...UNTIL_REVIEW, "fix-loop", "triage"]

export const INIT_DEFAULTS: Record<string, string> = {
  intent: "docs/intents/2026-09-27-demo.md",
  integration: "github",
  scale: "standard",
  "knowledge-target": "metatron",
  "adr-candidates": "on",
  "gotcha-candidates": "on",
  "image-upload": "gh-attach,chrome"
}

// git のリポジトリ(空のコミット 1 つ)にする。code 系フェーズの start-phase が HEAD を読むため
export function git(root: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
    { cwd: root, encoding: "utf8" }
  )
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
  return r.stdout.trim()
}

export function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codiel-state-"))
  git(root, "init", "-q")
  git(root, "commit", "-q", "--allow-empty", "-m", "init")
  // Raguel の記録の置き場。run() が RAGUEL_CONFIG でこの設定を指す
  fs.mkdirSync(path.join(root, ".raguel"))
  fs.writeFileSync(
    raguelConfigPath(root),
    JSON.stringify({
      storage: { casesDir: path.join(root, ".raguel"), projectId: "demo" }
    })
  )
  return root
}

export function run(cwd: string, args: string[]) {
  return runCli(cwd, args)
}

// init の必須フラグを既定値で埋める。over で値を替え、null を渡すとそのフラグを省く
export function init(
  root: string,
  slug = "demo",
  over: Record<string, string | null> = {},
  extra: string[] = []
) {
  const args = ["init", "--slug", slug]
  for (const [k, v] of Object.entries({ ...INIT_DEFAULTS, ...over }))
    if (v !== null) args.push(`--${k}`, v)
  return run(root, [...args, ...extra])
}

export function statePath(root: string, slug: string, tryN = 1): string {
  return path.join(root, ".codiel/runs", slug, `try-${tryN}`, "state.json")
}

// pass-gate の検査の入口。intent を in_progress にした run を作る
export function gateRun(): string {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  return root
}

export function gateArgs(phase: string, id: string, verdict: string): string[] {
  return [
    "pass-gate",
    phase,
    "--slug",
    "demo",
    "--evaluation-id",
    id,
    "--verdict",
    verdict
  ]
}

// test-code を in_progress にした run(開始の HEAD を記録済み)
export function codeRun(): string {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  run(root, ["start-phase", "test-code", "--slug", "demo"])
  return root
}

// ファイルを書いて(内容が無ければ既存のまま)コミットする
export function commitFiles(
  root: string,
  rels: string[],
  message: string
): void {
  for (const rel of rels) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${rel}\n`)
  }
  git(root, "add", "--", ...rels)
  git(root, "commit", "-q", "-m", message)
}

export function stepAdd(
  root: string,
  id: string,
  files: string[],
  deps: string[] = [],
  extra: string[] = []
) {
  return run(root, [
    "step-add",
    "--slug",
    "demo",
    "--id",
    id,
    "--files",
    JSON.stringify(files),
    "--deps",
    JSON.stringify(deps),
    ...extra
  ])
}

// test-code と test-loop の仕様のディレクトリを登録する。--files は渡さない
export function specAdd(
  root: string,
  kind: string,
  id: string,
  extra: string[] = []
) {
  const args = ["step-add", "--slug", "demo", "--kind", kind, "--id", id]
  return run(root, [...args, ...extra])
}

// tmpProject の Raguel の記録の置き場(<casesDir>/cases/<projectId>)
export function casesProjectDir(root: string): string {
  return path.join(root, ".raguel", "cases", "demo")
}

// slug の最新の try の state を読む
export function latestState(root: string, slug: string) {
  const dir = path.join(root, ".codiel/runs", slug)
  const n = Math.max(
    ...fs
      .readdirSync(dir)
      .filter((d) => /^try-\d+$/.test(d))
      .map((d) => Number(d.slice(4)))
  )
  return JSON.parse(fs.readFileSync(statePath(root, slug, n), "utf8"))
}

export const CODE_PHASES = [
  "carry-over",
  "test-code",
  "implement",
  "test-loop",
  "fix-loop"
]

export interface EvaluationOver {
  judgeStatus?: string
  runId?: string
  // 索引の行と verdict.json の subject を替える
  subject?: Record<string, unknown>
  // verdict.json だけを替える(検査 5 の食い違いを作る)
  verdictJson?: Record<string, unknown>
  // verdict.json を書かない
  noVerdictJson?: boolean
}

// pass-gate の検査 9 が文書のフェーズに期待するファイル(既定の runsDir と testsDir)
export function expectedDoc(slug: string, phase: string): string | undefined {
  if (phase === "design" || phase === "dev-plan")
    return `docs/codiel/runs/${slug}/${phase}.md`
  if (phase === "test-spec") return "docs/codiel/tests/units/demo/spec.md"
  return undefined
}

// 文書のフェーズでは、期待するファイルを評価したことにする。ファイルが無ければ sha256 は null
export function docFiles(root: string, slug: string, phase: string) {
  const rel = expectedDoc(slug, phase)
  if (!rel) return []
  const abs = path.join(root, rel)
  const sha256 = fs.existsSync(abs)
    ? createHash("sha256").update(fs.readFileSync(abs)).digest("hex")
    : null
  return [{ path: rel, sha256, isNew: true }]
}

// Raguel が書く形で、評価の索引の行と verdict.json を置く(Raguel 設計書 §6.9)。
// code 系フェーズの subject は今の HEAD とフェーズの開始の HEAD を持つ。
// 文書のフェーズの files は docFiles で作る
export function recordEvaluation(
  root: string,
  slug: string,
  phase: string,
  verdict: string,
  evaluationId: string,
  over: EvaluationOver = {}
): string {
  const st = latestState(root, slug)
  const runId = over.runId ?? st.raguelRunId
  const head = git(root, "rev-parse", "HEAD")
  const subject = over.subject ?? {
    repoPath: root,
    head,
    ...(CODE_PHASES.includes(phase)
      ? { base: st.phases[phase]?.startHead ?? null }
      : {}),
    files: docFiles(root, slug, phase)
  }
  const phaseDir = path.join(casesProjectDir(root), runId, phase)
  fs.mkdirSync(phaseDir, { recursive: true })
  const attempt = fs.readdirSync(phaseDir).length + 1
  const casePath = path.join(
    phaseDir,
    `attempt-${String(attempt).padStart(2, "0")}`
  )
  fs.mkdirSync(casePath)
  const row = {
    schemaVersion: 2,
    evaluationId,
    runId,
    phase,
    kind: CODE_PHASES.includes(phase) ? "code" : "design",
    attempt,
    casePath,
    verdict,
    judgeStatus: over.judgeStatus ?? "ok",
    head,
    at: new Date().toISOString()
  }
  if (!over.noVerdictJson)
    fs.writeFileSync(
      path.join(casePath, "verdict.json"),
      JSON.stringify({ ...row, subject, ...over.verdictJson })
    )
  fs.appendFileSync(
    path.join(casesProjectDir(root), "evaluations.jsonl"),
    `${JSON.stringify(row)}\n`
  )
  return casePath
}

// Raguel の record_outcome が書く形で、裁定の記録を 1 行足す
export function recordRuling(
  root: string,
  slug: string,
  phase: string,
  evaluationId: string,
  ruling: string | null,
  outcome = "approved"
): void {
  fs.mkdirSync(casesProjectDir(root), { recursive: true })
  fs.appendFileSync(
    path.join(casesProjectDir(root), "outcomes.jsonl"),
    `${JSON.stringify({
      schemaVersion: 2,
      evaluationId,
      runId: latestState(root, slug).raguelRunId,
      phase,
      outcome,
      ruling,
      precedentId: null,
      at: new Date().toISOString()
    })}\n`
  )
}

// 評価 ev1 を verdict で記録してから pass-gate する。--human-approved のときは、人の裁定
// (ASK は as-is、STOP は false-positive)も記録する
export function passGate(
  root: string,
  phase: string,
  verdict: string,
  extra: string[] = []
) {
  recordEvaluation(root, "demo", phase, verdict, "ev1")
  if (extra.includes("--human-approved") && verdict !== "PROCEED")
    recordRuling(
      root,
      "demo",
      phase,
      "ev1",
      verdict === "STOP" ? "false-positive" : "as-is"
    )
  return run(root, [
    "pass-gate",
    phase,
    "--slug",
    "demo",
    "--evaluation-id",
    "ev1",
    "--verdict",
    verdict,
    ...extra
  ])
}

// 各フェーズを start して、GATED は pass-gate、それ以外は complete-phase で通す
export function passThrough(
  root: string,
  slug: string,
  phases: string[]
): void {
  for (const ph of phases) {
    expect(run(root, ["start-phase", ph, "--slug", slug]).code, ph).toBe(0)
    if (GATED.has(ph)) recordEvaluation(root, slug, ph, "PROCEED", `e-${ph}`)
    const done = GATED.has(ph)
      ? [
          "pass-gate",
          ph,
          "--slug",
          slug,
          "--evaluation-id",
          `e-${ph}`,
          "--verdict",
          "PROCEED"
        ]
      : ["complete-phase", ph, "--slug", slug]
    if (ph === "pr") done.push("--pr-url", "u")
    expect(run(root, done).code, ph).toBe(0)
  }
}

export function fullRun(root: string, slug: string): void {
  passThrough(root, slug, UNTIL_FINALIZE)
  expect(run(root, ["finalize", "--slug", slug]).code).toBe(0)
}

// --- 待ち ---
