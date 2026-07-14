import fs from "node:fs"
import path from "node:path"

export type PhaseStatus = "pending" | "in_progress" | "passed" | "awaiting_human"
export type RunStatus = "active" | "awaiting_human" | "awaiting_outcome" | "completed" | "rejected" | "stopped"

export interface PhaseState {
  status: PhaseStatus
  attempts: number
  evaluationId: string | null
  verdict: string | null
  note: string | null
  humanApproved?: boolean
}

export interface RunState {
  version: number
  runId: string
  try: number
  issue: number
  branch: string
  raguelRunId: string
  status: RunStatus
  phase: string | null
  phases: Record<string, PhaseState>
  pr: { url: string | null }
  limits: { maxFixAttempts: number }
  stopReason: string | null
  incidents: { at: string; note: string | null }[]
  createdAt: string
  updatedAt: string
  baseBranch?: string
}

export interface LatestTry { tryN: number; statePath: string; state: RunState }
export interface ActiveRun { dir: string; statePath: string; state: RunState }

export const STAGES: string[][] = [["init"],["discuss"],["design"],["test-spec","dev-plan"],["implement"],
  ["test-loop"],["pr"],["review"],["fix-loop"],["triage"],["finalize"]]
export const PHASES: string[] = STAGES.flat()
export const GATED = new Set(["init","design","test-spec","dev-plan","implement","test-loop","fix-loop"])
export const SKIPPABLE = new Set(["fix-loop"])
const TERMINAL = new Set(["stopped","awaiting_outcome","completed","rejected"])

const fail = (msg: string, code = 1): never => { process.stderr.write(msg + "\n"); process.exit(code) }
const ok = (obj: unknown): void => { process.stdout.write(JSON.stringify(obj, null, 2) + "\n") }

export function readState(p: string): RunState { return JSON.parse(fs.readFileSync(p, "utf8")) as RunState }
export function writeState(p: string, state: RunState): void {
  state.updatedAt = new Date().toISOString()
  const tmp = p + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  fs.renameSync(tmp, p)
}

function runDir(root: string, issue: number | string): string { return path.join(root, ".codiel", "runs", `issue-${issue}`) }

function tries(dir: string): number[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((d) => /^try-\d+$/.test(d))
    .map((d) => Number(d.slice(4))).sort((a, b) => a - b)
}

export function latestTry(root: string, issue: number | string): LatestTry | null {
  const dir = runDir(root, issue)
  const ts = tries(dir)
  if (ts.length === 0) return null
  const n = ts[ts.length - 1]
  const p = path.join(dir, `try-${n}`, "state.json")
  return { tryN: n, statePath: p, state: readState(p) }
}

// Finds active runs for hooks. Intentionally narrower than `get --active`:
// findActiveRun includes only "active" and "awaiting_human", while `get --active` also includes "awaiting_outcome" for auto-sync of outcomes.
export function findActiveRun(root: string): ActiveRun | null {
  const runsRoot = path.join(root, ".codiel", "runs")
  if (!fs.existsSync(runsRoot)) return null
  let best: ActiveRun | null = null
  for (const r of fs.readdirSync(runsRoot).filter((d) => /^issue-\d+$/.test(d))) {
    const latest = latestTry(root, Number(r.slice(6)))
    if (!latest) continue
    if (latest.state.status === "active" || latest.state.status === "awaiting_human") {
      if (!best || latest.state.updatedAt > best.state.updatedAt) {
        best = { dir: path.dirname(latest.statePath), statePath: latest.statePath, state: latest.state }
      }
    }
  }
  return best
}

function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string> } {
  const pos: string[] = []; const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { flags[argv[i].slice(2)] = argv[i + 1]; i++ }
    else pos.push(argv[i])
  }
  return { pos, flags }
}

function newState(issue: number | string, tryN: number): RunState {
  const phases: Record<string, PhaseState> = {}
  for (const ph of PHASES) phases[ph] = { status: "pending", attempts: 0, evaluationId: null, verdict: null, note: null }
  const now = new Date().toISOString()
  return {
    version: 1, runId: `issue-${issue}`, try: tryN, issue: Number(issue),
    branch: `codiel/issue-${issue}-try-${tryN}`, raguelRunId: `issue-${issue}-try-${tryN}`,
    status: "active", phase: null, phases,
    pr: { url: null }, limits: { maxFixAttempts: 5 },
    stopReason: null, incidents: [], createdAt: now, updatedAt: now,
  }
}

function loadRun(root: string, flags: Record<string, string>): LatestTry {
  if (!flags.issue) fail("--issue が必要です")
  const latest = latestTry(root, flags.issue)
  if (!latest) fail(`run が存在しません: issue-${flags.issue}`)
  return latest as LatestTry
}

export function main(argv: string[], root: string = process.cwd()): void {
  // Handle --active / --human-approved specially: boolean flags with no value,
  // remove them from argv first to avoid parseArgs eating the next arg.
  const hasActive = argv.includes("--active")
  if (hasActive) {
    argv = argv.filter(arg => arg !== "--active")
  }
  const hasHumanApproved = argv.includes("--human-approved")
  if (hasHumanApproved) {
    argv = argv.filter(arg => arg !== "--human-approved")
  }

  const { pos, flags } = parseArgs(argv)
  const cmd = pos[0]

  if (cmd === "init") {
    if (!flags.issue) fail("--issue が必要です")
    const latest = latestTry(root, flags.issue)
    if (latest && !TERMINAL.has(latest.state.status))
      fail(`未完了の try があります: ${latest.statePath}(status: ${latest.state.status})。resume するか stop してください`)
    const tryN = latest ? latest.tryN + 1 : 1
    const dir = path.join(runDir(root, flags.issue), `try-${tryN}`)
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true })
    const state = newState(flags.issue, tryN)
    if (flags["base-branch"]) state.baseBranch = flags["base-branch"]
    const p = path.join(dir, "state.json")
    writeState(p, state)
    return ok({ statePath: p, state })
  }

  if (cmd === "get") {
    if (hasActive) {
      const runsRoot = path.join(root, ".codiel", "runs")
      const runs: { statePath: string; state: RunState }[] = []
      if (fs.existsSync(runsRoot)) {
        for (const r of fs.readdirSync(runsRoot).filter((d) => /^issue-\d+$/.test(d))) {
          const latest = latestTry(root, Number(r.slice(6)))
          if (latest && !["completed", "rejected", "stopped"].includes(latest.state.status))
            runs.push({ statePath: latest.statePath, state: latest.state })
        }
      }
      return ok({ runs })
    }
    const latest = loadRun(root, flags)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "stop") {
    const latest = loadRun(root, flags)
    if (TERMINAL.has(latest.state.status)) fail(`すでに終端状態です: ${latest.state.status}`)
    latest.state.status = "stopped"
    latest.state.stopReason = flags.reason ?? null
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "start-phase") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    const latest = loadRun(root, flags)
    const st = latest.state
    if (st.status !== "active") fail(`run が active ではありません(${st.status})。resume してください`)
    const stageIdx = STAGES.findIndex((s) => s.includes(phase))
    for (let i = 0; i < stageIdx; i++)
      for (const prev of STAGES[i])
        if (st.phases[prev].status !== "passed")
          fail(`前フェーズが未完了です: ${prev}(${st.phases[prev].status})`)
    if (!["pending", "in_progress"].includes(st.phases[phase].status))
      fail(`フェーズ ${phase} は ${st.phases[phase].status} のため開始できません`)
    st.phases[phase].status = "in_progress"
    st.phase = phase
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  if (cmd === "skip-phase") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    if (!SKIPPABLE.has(phase))
      fail(`${phase} はスキップできません(skip-phase は fix-loop のみ対応)`)
    if (!flags.reason) fail("--reason が必要です")
    const latest = loadRun(root, flags)
    const st = latest.state
    if (st.status !== "active") fail(`run が active ではありません(${st.status})。resume してください`)
    const ph = st.phases[phase]
    if (ph.status !== "pending")
      fail(`フェーズ ${phase} は ${ph.status} のためスキップできません(開始済みのループは pass-gate で通過する)`)
    const stageIdx = STAGES.findIndex((s) => s.includes(phase))
    for (let i = 0; i < stageIdx; i++)
      for (const prev of STAGES[i])
        if (st.phases[prev].status !== "passed")
          fail(`前フェーズが未完了です: ${prev}(${st.phases[prev].status})`)
    ph.status = "passed"
    ph.verdict = "SKIPPED"
    ph.note = flags.reason
    st.phase = phase
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  if (cmd === "pass-gate") {
    const phase = pos[1]
    if (!GATED.has(phase)) fail(`${phase} はゲート対象フェーズではありません(complete-phase を使用)`)
    const latest = loadRun(root, flags)
    const ph = latest.state.phases[phase]
    if (ph.status !== "in_progress") fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`)
    if (!flags["evaluation-id"]) fail("--evaluation-id が必要です")
    const acceptedVerdicts = hasHumanApproved ? ["PROCEED", "ASK"] : ["PROCEED"]
    if (!acceptedVerdicts.includes(flags.verdict))
      fail(`verdict が PROCEED ではありません: ${flags.verdict}。ASK は mark-ask、STOP は stop を使用`)
    ph.status = "passed"; ph.evaluationId = flags["evaluation-id"]; ph.verdict = flags.verdict
    if (hasHumanApproved) ph.humanApproved = true
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "complete-phase") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    if (GATED.has(phase)) fail(`${phase} はゲート対象フェーズです(pass-gate を使用)`)
    const latest = loadRun(root, flags)
    const ph = latest.state.phases[phase]
    if (ph.status !== "in_progress") fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`)
    if (phase === "pr") {
      if (!flags["pr-url"]) fail("pr フェーズには --pr-url が必要です")
      latest.state.pr.url = flags["pr-url"]
    }
    ph.status = "passed"; ph.note = flags.note ?? null
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "mark-ask") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    const latest = loadRun(root, flags)
    latest.state.phases[phase].status = "awaiting_human"
    latest.state.phases[phase].evaluationId = flags["evaluation-id"] ?? null
    latest.state.phases[phase].verdict = "ASK"
    latest.state.status = "awaiting_human"
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "resume") {
    const latest = loadRun(root, flags)
    if (latest.state.status !== "awaiting_human") fail(`awaiting_human ではありません(${latest.state.status})`)
    latest.state.status = "active"
    for (const ph of Object.values(latest.state.phases))
      if (ph.status === "awaiting_human") ph.status = "in_progress"
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "record-attempt") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    const latest = loadRun(root, flags)
    const ph = latest.state.phases[phase]
    ph.attempts = (ph.attempts ?? 0) + 1
    if (ph.attempts > latest.state.limits.maxFixAttempts) {
      latest.state.status = "awaiting_human"
      writeState(latest.statePath, latest.state)
      ok({ statePath: latest.statePath, state: latest.state, capExceeded: true })
      process.exit(3)
    }
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state, capExceeded: false })
  }

  if (cmd === "finalize") {
    const latest = loadRun(root, flags)
    for (const [name, ph] of Object.entries(latest.state.phases)) {
      if (name === "finalize") continue
      if (ph.status !== "passed") fail(`フェーズ ${name} が未完了です(${ph.status})`)
    }
    latest.state.phases["finalize"].status = "passed"
    latest.state.status = "awaiting_outcome"
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "record-outcome") {
    const latest = loadRun(root, flags)
    const outcome = flags.outcome
    if (!["approved", "rejected", "incident"].includes(outcome)) fail(`不正な outcome: ${outcome}`)
    if (!["awaiting_outcome", "completed", "rejected"].includes(latest.state.status))
      fail(`outcome を記録できる状態ではありません(${latest.state.status})`)
    if (outcome === "approved") latest.state.status = "completed"
    if (outcome === "rejected") latest.state.status = "rejected"
    if (outcome === "incident") latest.state.incidents.push({ at: new Date().toISOString(), note: flags.note ?? null })
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  fail(`不明なコマンド: ${cmd}`)
}
