import fs from "node:fs"
import path from "node:path"
import { findMainRoot } from "./hooks/lib.js"
import {
  CODE_PHASES,
  changedPathsSince,
  checkEvaluationRow,
  checkGate,
  evaluatedFiles,
  findEvaluation,
  gitBranchExists,
  gitHead,
  gitMergeBase,
  isAncestor,
  openPhaseStops,
  type RaguelStore,
  readEvaluationIndex,
  readVerdictRecord,
  resolveRaguelStore,
  resubmitNote,
  unresolvedStops
} from "./raguel-records.js"

export type PhaseStatus =
  | "pending"
  | "in_progress"
  | "passed"
  | "awaiting_human"
export type RunStatus =
  | "active"
  | "awaiting_human"
  | "awaiting_outcome"
  | "completed"
  | "rejected"
  | "stopped"
export type AskKind = "raguel" | "confirm"

export interface PhaseState {
  status: PhaseStatus
  attempts: number
  evaluationId: string | null
  verdict: string | null
  note: string | null
  humanApproved?: boolean
  // mark-ask の確認の種類。raguel は Raguel の ASK、confirm は人への確認。
  // resume の後も消さず、ゲートの記録と区別できるように残す。
  askKind?: AskKind
  // code 系フェーズ(carry-over・test-code・implement・test-loop・fix-loop)を始めたときの HEAD
  // (Raguel 設計書 §6.13.3)。carry-over だけはベースブランチとの分岐点を持つ。
  // pass-gate の検査 8 が評価の起点と照らす
  startHead?: string
  // ゲート付きフェーズの pass-gate を通したときの HEAD(Raguel 設計書 §6.13.3)。git の管理外では持たない。
  // 次の code 系フェーズの start-phase が、評価の後にコミットが足されていないかを照らす
  passedHead?: string
}

// バックグラウンドで動く委譲 1 件の待ちの記録。返答は try の waits/<id>.md に書く
export interface Wait {
  id: string
  purpose: string
  phase: string
  startedAt: string
  // Agent ツールが返す委譲の ID。run を止めるときに委譲を止めるのに使う
  taskId?: string
}

export interface RunState {
  version: number
  runId: string
  try: number
  issue: number | null
  // intent 文書の repoRoot 相対パス
  intent: string
  // init --intent-only の run は run ブランチを作らないので null
  branch: string | null
  raguelRunId: string
  integration: "github" | "local"
  scale: "standard" | "light"
  // 画像を GitHub に載せる手段が使えるか。integration が local なら両方 false
  imageUpload: { ghAttach: boolean; chrome: boolean }
  // ADR の 3 条件を満たす判断の書き先
  knowledgeTarget: "metatron" | "intents"
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
  // 境界の課し方(設計書 2026-09-15 §5.1)。"mapped" は有効なドメインマップに基づく境界、
  // "unscoped" は境界を設けないことを run 開始時に明示選択した状態。
  // init で --domain-mode を省くとキーを持たない。
  // 未記録は「モード未決」として扱い、§0 の判定をやり直す。
  domainMode?: "mapped" | "unscoped"
  // 実装・レビューを委譲中のドメイン名(ARCHITECTURE のドメインマップのキー)。
  // 委譲していない間は null / 未定義。
  // 値がドメインマップに存在するかは検証しない — 判断は読む側(guard-write)の責務。
  domain?: string | null
  // 並列実装のステップと、test-code・test-loop の仕様のディレクトリ(設計書 §6.6.5・§6.7・
  // §6.13.2、計画書 §6.2)。units のキーは仕様のディレクトリの ID(§6.13.3)。
  // M4 で足した任意フィールドで、version は 2 のまま据え置く。
  implement?: { steps: Record<string, StepState> }
  testCode?: { units: Record<string, StepState> }
  testLoop?: { units: Record<string, StepState> }
  // fix-loop でテストの保護を外す間だけ真(設計書 §6.13.6)。clear-test-edit でキーごと消す
  testEdit?: boolean
  // 動いている委譲の待ち。stop-guard は 1 件以上あると止めずに通す。version は 2 のまま据え置く
  waits?: Wait[]
  // Raguel の記録の形式(Raguel 設計書 §6.13.3)。init が 2 を記録する。
  // 持たない run(この作り直しより前に作ったもの)は pass-gate を通せない
  raguelContract?: 2
}

export type StepStatus =
  | "pending"
  | "running"
  | "reviewing"
  | "merged"
  | "failed"
export type GroupMode = "parallel" | "serial" | "final"

export interface StepState {
  status: StepStatus
  // 触るファイル(repoRoot 相対の glob)
  files: string[]
  // 前提ステップ。test-code と test-loop では常に空配列
  deps: string[]
  // 方式 b の最終ステップ(waves の final にだけ出る)。test-code と test-loop では常に false
  final: boolean
  // waves が記録する位置。index は groups(final なら final)の配列の添字。
  // test-code と test-loop では常に null
  group: { index: number; mode: GroupMode } | null
  // repoRoot 相対の worktree のパス
  worktree: string | null
  branch: string | null
  commits: { base: string | null; head: string | null }
  // 修正ラウンド数。phases[phase].attempts(record-attempt)とは別に数える
  attempts: number
  domain: string | null
}

export interface WaveGroup {
  steps: string[]
  mode: "parallel" | "serial"
}

export interface LatestTry {
  tryN: number
  statePath: string
  state: RunState
}
export interface ActiveRun {
  dir: string
  statePath: string
  state: RunState
}

export const STAGES: string[][] = [
  ["intent"],
  ["carry-over"],
  ["discuss"],
  ["design"],
  ["test-spec", "dev-plan"],
  ["test-code"],
  ["implement"],
  ["test-loop"],
  ["intent-sync"],
  ["pr"],
  ["review"],
  ["fix-loop"],
  ["triage"],
  ["finalize"]
]
export const PHASES: string[] = STAGES.flat()
export const GATED = new Set([
  "intent",
  "carry-over",
  "design",
  "test-spec",
  "dev-plan",
  "test-code",
  "implement",
  "test-loop",
  "intent-sync",
  "fix-loop"
])
export const SKIPPABLE = new Set(["discuss", "design", "fix-loop"])
// SKIPPABLE のうち、軽量(scale: light)の run でだけ skip できるフェーズ
const LIGHT_ONLY_SKIPPABLE = new Set(["discuss", "design"])
const TERMINAL = new Set([
  "stopped",
  "awaiting_outcome",
  "completed",
  "rejected"
])

// slug は英小文字ケバブケースで 40 文字以内。issue-<N> の形は codiel 0.x
// (state version 1)の run ディレクトリ名と重なるので init で拒否する。
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SLUG_MAX = 40
const V1_RUN_RE = /^issue-\d+$/
// intent 文書の置き場。domains/ 配下は持続層なので含めない
const INTENT_PATH_RE = /^docs\/intents\/[^/]+\.md$/
const INTEGRATIONS = ["github", "local"] as const
// Raguel の判定。mark-ask --verdict と pass-gate --human-approved が受け付ける値(設計書 §6.2.2)
const VERDICTS = ["PROCEED", "ASK", "STOP"] as const
const BOOL_FLAGS = [
  "active",
  "human-approved",
  "intent-only",
  "final",
  "abandon-waits"
]

// 触るとそのステップだけの serial グループになる lockfile(計画書 §6.3)。
// ファイル名(最後のセグメント)の完全一致で判定し、置き場のディレクトリは問わない。
const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum"
])
// parallel グループのステップ数の上限(設計書 §6.6.2 の規則 5)
const PARALLEL_MAX = 4
const STEP_STATUSES = [
  "pending",
  "running",
  "reviewing",
  "merged",
  "failed"
] as const
// 許す遷移と、その遷移で受け付ける記録のフラグ(計画書 §6.2 の表)
const STEP_TRANSITIONS: Record<string, string[]> = {
  "pending>running": ["worktree", "branch", "base"],
  "running>reviewing": [],
  "reviewing>running": [],
  "reviewing>merged": ["head"],
  "running>failed": [],
  "reviewing>failed": [],
  "failed>pending": []
}
const STEP_RECORD_FLAGS = ["worktree", "branch", "base", "head"]
// step は implement.steps、test-code は testCode.units、test-loop は testLoop.units に当たる
const STEP_KINDS = ["step", "test-code", "test-loop"] as const
type StepKind = (typeof STEP_KINDS)[number]
// 仕様のディレクトリの ID(設計書 §6.13.3)。units/ と e2e/backend/ の後は 1 つ以上、
// e2e/frontend/ と e2e/cli/ の後はちょうど 1 つのセグメントを持つ。
// 空のセグメント・`.`・`..`・`:`・`\` は isSpecDirId で別に拒否する。
const SPEC_ID_RE = /^(units\/.+|e2e\/backend\/.+|e2e\/(frontend|cli)\/[^/]+)$/
// .codiel/config.json が無いとき、またはキーが無いときの値(設計書 §6.13.4)
const DEFAULT_TESTS_DIR = "docs/codiel/tests"
const DEFAULT_RUNS_DIR = "docs/codiel/runs"

const fail = (msg: string, code = 1): never => {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}
const ok = (obj: unknown): undefined => {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
  return undefined
}

// carry-over の導入前に作った version 2 の state は、carry-over を SKIPPED で通した扱いに補う。
// 全コマンドと hooks はここを通って state を読む。isLegacy の判定には関わらない
export function readState(p: string): RunState {
  const st = JSON.parse(fs.readFileSync(p, "utf8")) as RunState
  if (st.version === 2 && st.phases && !("carry-over" in st.phases)) {
    const { intent, ...rest } = st.phases
    st.phases = {
      intent,
      "carry-over": {
        status: "passed",
        attempts: 0,
        evaluationId: null,
        verdict: "SKIPPED",
        note: "carry-over の導入前の run"
      },
      ...rest
    }
  }
  return st
}
export function writeState(p: string, state: RunState): void {
  state.updatedAt = new Date().toISOString()
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(tmp, p)
}

function runDir(root: string, slug: string): string {
  return path.join(root, ".codiel", "runs", slug)
}

function tries(dir: string): number[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((d) => /^try-\d+$/.test(d))
    .map((d) => Number(d.slice(4)))
    .sort((a, b) => a - b)
}

// state.json の無い try(init の mkdir と writeState の間で中断したもの、run でない
// ディレクトリ)は run として扱わず、その手前の try を最新とする。
export function latestTry(root: string, slug: string): LatestTry | null {
  const dir = runDir(root, slug)
  for (const n of tries(dir).reverse()) {
    const p = path.join(dir, `try-${n}`, "state.json")
    if (fs.existsSync(p)) return { tryN: n, statePath: p, state: readState(p) }
  }
  return null
}

// runs/ 直下のディレクトリをすべて走査し、各 run の最新 try を返す。
// ディレクトリ名では絞らない。v1 と v2 は呼び出し元が state の version で分ける。
// 読めない state と phases の無い state の run は、run が無いものとして飛ばし、slug を標準エラー出力に出す。
// 1 つの壊れた run で、ほかの run の検索と hooks を止めないため
function latestTries(root: string): LatestTry[] {
  const runsRoot = path.join(root, ".codiel", "runs")
  if (!fs.existsSync(runsRoot)) return []
  const found: LatestTry[] = []
  for (const d of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    let t: LatestTry | null = null
    let broken = false
    try {
      t = latestTry(root, d.name)
      broken =
        t !== null && (typeof t.state.phases !== "object" || !t.state.phases)
    } catch {
      broken = true
    }
    if (broken) {
      process.stderr.write(
        `codiel: 壊れた state の run を飛ばしました: ${d.name}\n`
      )
      continue
    }
    if (t) found.push(t)
  }
  return found
}

// hooks が使う active run の検索。この版で続けられる state だけを run として扱い、
// v1 の run と M4 より前の state の run は run が無いときと同じにする(設計書 §6.2.4・§6.6)。
// `get --active` より狭く、active と awaiting_human だけを返す。
// awaiting_outcome は outcome の自動同期のために `get --active` にだけ含める。
export function findActiveRun(root: string): ActiveRun | null {
  let best: ActiveRun | null = null
  for (const latest of latestTries(root)) {
    const st = latest.state
    if (isLegacy(st)) continue
    if (st.status !== "active" && st.status !== "awaiting_human") continue
    if (!best || st.updatedAt > best.state.updatedAt)
      best = {
        dir: path.dirname(latest.statePath),
        statePath: latest.statePath,
        state: st
      }
  }
  return best
}

// この版で続けられない state か。codiel 0.x(state version 1)の state と、phases に test-code を
// 持たない v2 の state(M4 より前に作ったもの)が当たる(設計書 §6.2.4・§6.6)。
// 判定は state の形だけで行い、phases の進み具合を見ない。読み込み時に test-code を補わない。
function isLegacy(st: RunState): boolean {
  return st.version !== 2 || !("test-code" in st.phases)
}

// isLegacy の run を指したときに出す文言。v1 は設計書 §6.2.4、M4 より前の state は §6.6 の
// テンプレートを使う。
function legacyMessage(st: RunState): string {
  if (st.version !== 2) {
    const n = st.issue
    return (
      `codiel: .codiel/runs/issue-${n} は codiel 0.x の run(state version 1、status: ${st.status})であり、この版では再開できない。` +
      `codiel 0.x で完了させるか、\`codiel-state stop --slug issue-${n} --reason migrate\` で止めてから、\`/codiel:run ${n}\` で新しい run を始める。`
    )
  }
  return (
    `codiel: .codiel/runs/${st.runId} は test-code フェーズを持たない state の run(status: ${st.status})であり、この版では再開できない。` +
    `\`codiel-state stop --slug ${st.runId} --reason migrate\` で止めてから、\`/codiel:run ${st.intent}\` で同じ intent の新しい try を始める。`
  )
}

// .codiel を持つディレクトリの .codiel/config.json から testsDir と runsDir を読む(設計書 §6.13.4)。
// ファイルかキーが無ければ既定の値を返す。JSON として読めない・オブジェクトでない・
// testsDir か runsDir が文字列でない・空文字列・絶対パス・`..` のセグメントを含む、のいずれかは例外を投げる。
// 値は `./` と末尾の `/` を落とした repoRoot 相対のパスにして返す。
// raguel の中身は Raguel が検査するので見ない(§6.15.1)。未知のキーは無視する。
export function readCodielConfig(codielRoot: string): {
  testsDir: string
  runsDir: string
} {
  const file = path.join(codielRoot, ".codiel", "config.json")
  if (!fs.existsSync(file))
    return { testsDir: DEFAULT_TESTS_DIR, runsDir: DEFAULT_RUNS_DIR }
  let cfg: unknown
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    throw new Error(`${file} を JSON として読めません`)
  }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg))
    throw new Error(`${file} は JSON のオブジェクトにしてください`)
  const obj = cfg as Record<string, unknown>
  return {
    testsDir: configDir(obj, "testsDir", DEFAULT_TESTS_DIR),
    runsDir: configDir(obj, "runsDir", DEFAULT_RUNS_DIR)
  }
}

// config.json の 1 つのキーを repoRoot 相対のディレクトリとして検査し、正規化して返す
function configDir(
  cfg: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  if (!(key in cfg)) return fallback
  const v = cfg[key]
  if (typeof v !== "string") throw new Error(`${key} は文字列にしてください`)
  if (v === "") throw new Error(`${key} に空文字列は指定できません`)
  if (path.posix.isAbsolute(v) || path.win32.isAbsolute(v))
    throw new Error(`${key} には repoRoot 相対のパスを書いてください: ${v}`)
  if (v.split(/[/\\]/).includes(".."))
    throw new Error(`${key} に .. のセグメントは使えません: ${v}`)
  return normalizeRel(v)
}

// .gitignore に要る行(設計書 §6.15.5)。E2E の 4 行は、実行ごとのディレクトリの中を無視し、
// 直下の results.json・summary.md・failure.md だけを戻す。runsDir は共有するので行を置かない。
function gitignoreLines(testsDir: string): string[] {
  // testsDir がリポジトリ全体(`.`)のときは、`./` を付けると git が行に当たらないので接頭辞を付けない
  const base = normalizeRel(testsDir)
  const prefix = base === "." ? "" : `${base}/`
  const reports = `${prefix}e2e/**/reports/[0-9]*-try[0-9]*`
  return [
    ".codiel/runs/",
    ".codiel/reports/",
    `${reports}/**`,
    `!${reports}/results.json`,
    `!${reports}/summary.md`,
    `!${reports}/failure.md`
  ]
}

// .codiel を持つディレクトリの .gitignore に無い必須の行を返す。行は前後の空白を除いた
// 完全一致で比べ、`#` で始まる行と空行を数えない。ファイルが無ければ全行を返す。
function missingGitignoreLines(
  codielRoot: string,
  required: string[]
): string[] {
  const file = path.join(codielRoot, ".gitignore")
  const present = new Set(
    fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l !== "" && !l.startsWith("#"))
      : []
  )
  return required.filter((l) => !present.has(l))
}

function parseArgs(argv: string[]): {
  pos: string[]
  flags: Record<string, string>
  bools: Set<string>
} {
  const pos: string[] = []
  const flags: Record<string, string> = {}
  const bools = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].slice(2)
    if (!argv[i].startsWith("--")) pos.push(argv[i])
    else if (BOOL_FLAGS.includes(name)) bools.add(name)
    else {
      flags[name] = argv[i + 1]
      i++
    }
  }
  return { pos, flags, bools }
}

// 候補 ID の照合に使う。領域名に正規表現の特殊文字が来ても安全に扱う
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// glob の中括弧を展開する(設計書 §6.6.2 の重なりの判定 1)。入れ子も展開し、
// 閉じていない中括弧は展開せずに残す。
export function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{")
  if (open === -1) return [glob]
  const cuts: number[] = []
  let depth = 0
  for (let i = open; i < glob.length; i++) {
    const c = glob[i]
    if (c === "{") depth++
    else if (c === "," && depth === 1) cuts.push(i)
    else if (c === "}" && --depth === 0) {
      const head = glob.slice(0, open)
      const tail = glob.slice(i + 1)
      const alts: string[] = []
      let from = open + 1
      for (const cut of [...cuts, i]) {
        alts.push(glob.slice(from, cut))
        from = cut + 1
      }
      return alts.flatMap((alt) => expandBraces(head + alt + tail))
    }
  }
  return [glob]
}

// ワイルドカードを含む最初のセグメントより前を固定部とする(判定 2)。
// 展開後に残る `{` は閉じていない中括弧なので、保守的にワイルドカードと同じに扱う。
function fixedSegments(glob: string): string[] {
  const segs = glob.split("/").filter((s) => s !== "" && s !== ".")
  const i = segs.findIndex((s) => /[*?[{]/.test(s))
  return i === -1 ? segs : segs.slice(0, i)
}

// 2 つの glob が重なりうるか(判定 3・4)。固定部をセグメント単位で先頭から比べ、
// 短いほうが長いほうの先頭に一致すれば重なりうるとみなす。固定部が空なら常に重なる。
export function globsOverlap(a: string, b: string): boolean {
  for (const x of expandBraces(a).map(fixedSegments))
    for (const y of expandBraces(b).map(fixedSegments)) {
      const n = Math.min(x.length, y.length)
      if (x.slice(0, n).every((s, i) => s === y[i])) return true
    }
  return false
}

function touchesLockfile(files: string[]): boolean {
  return files
    .flatMap(expandBraces)
    .some((f) => LOCKFILES.has(f.split("/").pop() ?? ""))
}

// implement.steps から実行の順序を決める(設計書 §6.6.2)。dev-plan の順(state のキーの順)に
// 貪欲に詰め、前提がすべて前のグループに入ったステップだけを次のグループの候補にする。
// 候補の先頭が lockfile を触るなら、そのステップだけの serial グループにする。
// それ以外は、lockfile を触らず、触るファイルが重ならない候補を 4 件まで parallel グループに入れる。
// 循環依存・未登録の前提・最終ステップを前提にする通常のステップは例外を投げる。
export function planWaves(steps: Record<string, StepState>): {
  groups: WaveGroup[]
  final: string[]
} {
  const ids = Object.keys(steps)
  for (const id of ids)
    for (const d of steps[id].deps) {
      if (!(d in steps))
        throw new Error(
          `ステップ ${id} の前提ステップ ${d} は登録されていません`
        )
      if (steps[d].final && !steps[id].final)
        throw new Error(
          `ステップ ${id} は最終ステップ ${d} を前提にできません(最終ステップは全グループの後に実行する)`
        )
    }
  const placed = new Set<string>()
  const readyOf = (rest: string[]): string[] => {
    const ready = rest.filter((id) =>
      steps[id].deps.every((d) => placed.has(d))
    )
    if (ready.length === 0)
      throw new Error(`循環依存があります: ${rest.join(", ")}`)
    return ready
  }
  const groups: WaveGroup[] = []
  let rest = ids.filter((id) => !steps[id].final)
  while (rest.length > 0) {
    const ready = readyOf(rest)
    const group: WaveGroup = touchesLockfile(steps[ready[0]].files)
      ? { steps: [ready[0]], mode: "serial" }
      : { steps: [], mode: "parallel" }
    if (group.mode === "parallel")
      for (const id of ready) {
        if (group.steps.length === PARALLEL_MAX) break
        const { files } = steps[id]
        if (touchesLockfile(files)) continue
        const clash = group.steps.some((m) =>
          steps[m].files.some((a) => files.some((b) => globsOverlap(a, b)))
        )
        if (!clash) group.steps.push(id)
      }
    for (const id of group.steps) placed.add(id)
    rest = rest.filter((id) => !placed.has(id))
    groups.push(group)
  }
  const final: string[] = []
  let finals = ids.filter((id) => steps[id].final)
  while (finals.length > 0) {
    const id = readyOf(finals)[0]
    final.push(id)
    placed.add(id)
    finals = finals.filter((f) => f !== id)
  }
  return { groups, final }
}

// 値域の決まったフラグを読む。省略も値域の外も失敗にする。
function oneOf<T extends string>(
  flags: Record<string, string>,
  name: string,
  values: readonly T[]
): T {
  const v = flags[name]
  if (v === undefined) fail(`--${name} が必要です`)
  if (!(values as readonly string[]).includes(v))
    fail(`不正な --${name}: ${v}。許される値は ${values.join(", ")} です`)
  return v as T
}

// --image-upload を state.imageUpload にする。local では値にかかわらず両方 false。
function imageUpload(
  flags: Record<string, string>,
  integration: RunState["integration"]
): RunState["imageUpload"] {
  const v = oneOf(flags, "image-upload", [
    "gh-attach",
    "chrome",
    "gh-attach,chrome",
    "none"
  ] as const)
  const github = integration === "github"
  return {
    ghAttach: github && v.includes("gh-attach"),
    chrome: github && v.includes("chrome")
  }
}

// JSON の配列で渡すフラグを読む。glob に `{a,b}` のカンマが入るので区切り文字では受けない。
function jsonList(
  flags: Record<string, string>,
  name: string,
  required: boolean
): string[] {
  const raw = flags[name]
  if (raw === undefined) {
    if (required) fail(`--${name} が必要です`)
    return []
  }
  let v: unknown = null
  try {
    v = JSON.parse(raw)
  } catch {
    fail(`--${name} は JSON の配列で渡してください: ${raw}`)
  }
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && s !== ""))
    fail(`--${name} は空でない文字列の JSON 配列で渡してください: ${raw}`)
  return v as string[]
}

function stepKind(flags: Record<string, string>): StepKind {
  return "kind" in flags ? oneOf(flags, "kind", STEP_KINDS) : "step"
}

// kind の表を返す。無ければ空で作る
function stepTable(st: RunState, kind: StepKind): Record<string, StepState> {
  if (kind === "test-code") {
    st.testCode ??= { units: {} }
    return st.testCode.units
  }
  if (kind === "test-loop") {
    st.testLoop ??= { units: {} }
    return st.testLoop.units
  }
  st.implement ??= { steps: {} }
  return st.implement.steps
}

// 仕様のディレクトリの ID の形を検査する(設計書 §6.13.3)
function isSpecDirId(id: string): boolean {
  return (
    SPEC_ID_RE.test(id) &&
    !/[:\\]/.test(id) &&
    id.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  )
}

// repoRoot 相対のパスを比べられるように、`./` と末尾の `/` を落とす
function normalizeRel(p: string): string {
  return path.posix.normalize(p.replaceAll("\\", "/")).replace(/\/+$/, "")
}

function newState(
  slug: string,
  tryN: number,
  fields: Pick<
    RunState,
    | "issue"
    | "intent"
    | "branch"
    | "integration"
    | "scale"
    | "imageUpload"
    | "knowledgeTarget"
  >
): RunState {
  const phases: Record<string, PhaseState> = {}
  for (const ph of PHASES)
    phases[ph] = {
      status: "pending",
      attempts: 0,
      evaluationId: null,
      verdict: null,
      note: null
    }
  const now = new Date().toISOString()
  return {
    version: 2,
    runId: slug,
    try: tryN,
    ...fields,
    raguelRunId: `${slug}-try-${tryN}`,
    status: "active",
    phase: null,
    phases,
    pr: { url: null },
    limits: { maxFixAttempts: 5 },
    stopReason: null,
    incidents: [],
    createdAt: now,
    updatedAt: now,
    raguelContract: 2
  }
}

// Raguel の記録の置き場。設定が読めなければ失敗する(黙って既定の置き場を読まない)
function raguelStore(root: string): RaguelStore {
  try {
    return resolveRaguelStore(findMainRoot(root))
  } catch (e) {
    return fail(`Raguel の記録を読めません: ${(e as Error).message}`)
  }
}

// pass-gate の検査 10 の文言(Raguel 設計書 §6.13.3)
function oldContractMessage(st: RunState): string {
  return `codiel: この run は Raguel の記録の形式が古い(raguelContract なし)ため、この版ではゲートを通せない。\`codiel-state stop --slug ${st.runId} --reason migrate\` で止めてから、\`/codiel:run ${st.intent}\` で同じ intent の新しい try を始める。`
}

// フェーズの間の連続性(Raguel 設計書 §6.13.3 の start-phase)。phase より前でゲート付きフェーズを
// 持つ最も近いステージの、passedHead を持つフェーズと照らす。持つフェーズが無ければ照らさない
// (skip-phase で通したフェーズは passedHead を持たない)。外れたら理由の文を返す。
// 直前が code 系フェーズなら、今の HEAD が passedHead と等しいことを要る。文書のフェーズなら、
// passedHead..HEAD の変更がそのフェーズの subject.files だけであることを要る(ゲート通過の直後の
// 文書のコミットを許す)。同じステージの test-spec と dev-plan は、両方の subject.files を合わせる。
// state は通した順を持たない。そこで、passedHead がもう一方の祖先であるほう(先に通したほう)を起点にする
function continuityProblem(
  root: string,
  st: RunState,
  phase: string,
  head: string
): string | null {
  const stageIdx = STAGES.findIndex((s) => s.includes(phase))
  for (let i = stageIdx - 1; i >= 0; i--) {
    const gated = STAGES[i].filter((p) => GATED.has(p))
    if (gated.length === 0) continue
    const found = gated.flatMap((p) => {
      const h = st.phases[p].passedHead
      return h ? [{ phase: p, passedHead: h }] : []
    })
    if (found.length === 0) return null
    const names = found.map((c) => c.phase).join("・")
    if (found.some((c) => CODE_PHASES.has(c.phase))) {
      const { passedHead } = found[0]
      return passedHead === head
        ? null
        : `評価の後にコミットがある(${passedHead}..${head})。${names} を評価し直してください`
    }
    const base =
      found.find((c) =>
        found.every((o) => isAncestor(root, c.passedHead, o.passedHead))
      ) ?? found[0]
    const allowed = new Set<string>()
    for (const c of found) {
      const files = evaluatedFiles(
        raguelStore(root),
        st.phases[c.phase].evaluationId ?? ""
      )
      if (!files)
        return `${c.phase} の評価の記録(evaluationId: ${st.phases[c.phase].evaluationId})から評価した文書を読めません`
      for (const f of files) allowed.add(f)
    }
    const changed = changedPathsSince(root, base.passedHead)
    if (!changed)
      return `評価の後の変更を読めません(git diff ${base.passedHead} HEAD が失敗した)`
    const extra = changed.filter((p) => !allowed.has(p))
    return extra.length === 0
      ? null
      : `評価の後に、評価した文書のほかのファイルのコミットがある(${base.passedHead}..${head}: ${extra.join(", ")})。${names} を評価し直してください`
  }
  return null
}

// --slug の run の最新 try を読む。isLegacy の run(v1 と M4 より前の state)は allowLegacy
// (get と stop、awaiting_outcome への record-outcome、completed / rejected の run への
// record-outcome --outcome incident)のときだけ返し、ほかのコマンドでは §6.2.4・§6.6 の
// 文言を出して失敗する(決定 63)。
function loadRun(
  root: string,
  flags: Record<string, string>,
  allowLegacy = false
): LatestTry {
  const slug = flags.slug
  if (!slug) fail("--slug が必要です")
  if (!SLUG_RE.test(slug)) fail(`不正な --slug: ${slug}`)
  const latest = latestTry(root, slug) as LatestTry
  if (!latest) fail(`run が存在しません: ${slug}`)
  if (isLegacy(latest.state) && !allowLegacy) fail(legacyMessage(latest.state))
  return latest
}

// 待ちの報告のファイル。try のディレクトリの waits/<id>.md
function waitReport(latest: LatestTry, id: string): string {
  return path.join(path.dirname(latest.statePath), "waits", `${id}.md`)
}

export function main(argv: string[], root: string = process.cwd()): undefined {
  const { pos, flags, bools } = parseArgs(argv)
  const cmd = pos[0]

  if (cmd === "init") {
    const slug = flags.slug
    if (!slug) fail("--slug が必要です")
    if (!SLUG_RE.test(slug) || slug.length > SLUG_MAX)
      fail(
        `不正な --slug: ${slug}。英小文字と数字をハイフンでつないだ ${SLUG_MAX} 文字以内にしてください`
      )
    if (V1_RUN_RE.test(slug))
      fail(
        `--slug に issue-<N> の形は使えません(codiel 0.x の run ディレクトリと重なるため): ${slug}`
      )
    const rawIntent = flags.intent
    if (!rawIntent) fail("--intent が必要です")
    if (path.isAbsolute(rawIntent))
      fail(`--intent には repoRoot 相対のパスを渡してください: ${rawIntent}`)
    // guard-write は正規化した repoRoot 相対のパスと完全一致で比べるので、`./` などを
    // 落としてから記録する。置き場は docs/intents/ 直下の *.md に限る(設計書 §6.3.1)。
    // それ以外を受け付けると、そのファイルへの書き込みが全フェーズで通ってしまう。
    const intent = path.posix.normalize(rawIntent.replaceAll("\\", "/"))
    if (!INTENT_PATH_RE.test(intent))
      fail(
        `--intent には docs/intents/ 直下の .md を repoRoot 相対で渡してください: ${rawIntent}`
      )
    if ("issue" in flags && !/^[1-9]\d*$/.test(flags.issue ?? ""))
      fail(`不正な --issue: ${flags.issue}`)
    const integration = oneOf(flags, "integration", INTEGRATIONS)
    const scale = oneOf(flags, "scale", ["standard", "light"] as const)
    const knowledgeTarget = oneOf(flags, "knowledge-target", [
      "metatron",
      "intents"
    ] as const)
    const upload = imageUpload(flags, integration)
    const domainMode =
      "domain-mode" in flags
        ? oneOf(flags, "domain-mode", ["mapped", "unscoped"] as const)
        : undefined
    const latest = latestTry(root, slug)
    if (latest && !TERMINAL.has(latest.state.status))
      fail(
        isLegacy(latest.state)
          ? legacyMessage(latest.state)
          : `未完了の try があります: ${latest.statePath}(status: ${latest.state.status})。resume するか stop してください`
      )
    // Raguel の STOP を記録したまま止めた try の次の try は、人の承認の後にだけ作る(設計書 §6.2.2、決定 83)。
    // raguel-stop 以外の理由で止めた try も、humanApproved の無い STOP のフェーズを持てば当たる。
    if (latest?.state.status === "stopped" && !bools.has("human-approved")) {
      const st = latest.state
      const stopPhases = Object.entries(st.phases)
        .filter(([, ph]) => ph.verdict === "STOP" && !ph.humanApproved)
        .map(([name, ph]) => `${name}(evaluationId: ${ph.evaluationId})`)
      if (st.stopReason === "raguel-stop" || stopPhases.length > 0)
        fail(
          `前の try(${latest.statePath})は Raguel の STOP で止まっています` +
            `(stopReason: ${st.stopReason}` +
            (stopPhases.length > 0
              ? `、STOP のフェーズ: ${stopPhases.join(", ")}`
              : "") +
            ")。新しい try を作ってよいか人に確かめ、承認されたら --human-approved を付けて init し直してください"
        )
    }
    // STOP を state に記録しないまま止めた try も、Raguel の評価の索引で見つける(Raguel 設計書 §6.13.3)
    if (latest && !bools.has("human-approved")) {
      let stops: string[] = []
      try {
        // 再提出で通した STOP は、carry-over が passed になった評価の ID と索引の順序で外す。
        // note の文型は人が読む記録で、判定には使わない
        const carryOver = latest.state.phases["carry-over"]
        stops = unresolvedStops(
          raguelStore(root),
          latest.state.raguelRunId,
          carryOver?.status === "passed" ? carryOver.evaluationId : null
        )
      } catch (e) {
        fail(`Raguel の記録を読めません: ${(e as Error).message}`)
      }
      if (stops.length > 0)
        fail(
          `前の try(${latest.statePath})には、誤検知の裁定の無い Raguel の STOP があります` +
            `(evaluationId: ${stops.join(", ")})。新しい try を作ってよいか人に確かめ、承認されたら --human-approved を付けて init し直してください`
        )
    }
    // run ブランチは slug ごとに 1 本なので、try-2 以降のベースブランチは前の try と同じにする
    const prevBase = latest?.state.baseBranch
    const baseBranch = flags["base-branch"] || prevBase
    if (prevBase && baseBranch !== prevBase)
      fail(
        `--base-branch(${baseBranch})が前の try のベースブランチ(${prevBase})と違います。同じ run ブランチの try はベースブランチを変えられません`
      )
    const tryN = latest ? latest.tryN + 1 : 1
    // run の無い slug の run ブランチは、利用者が作ったか、別の slug の worktree ブランチと名前が
    // 重なったものなので、この run のものとして使わない
    if (tryN === 1 && gitBranchExists(root, `codiel/${slug}`))
      fail(
        `ブランチ codiel/${slug} が既にありますが、slug ${slug} の run はありません。ブランチを消すか、別の slug を選んでください`
      )
    const dir = path.join(runDir(root, slug), `try-${tryN}`)
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true })
    const state = newState(slug, tryN, {
      issue: "issue" in flags ? Number(flags.issue) : null,
      intent,
      branch: bools.has("intent-only") ? null : `codiel/${slug}`,
      integration,
      scale,
      imageUpload: upload,
      knowledgeTarget
    })
    if (baseBranch) state.baseBranch = baseBranch
    // try-1 には引き継ぐコードが無いので、carry-over を通した扱いにする
    if (tryN === 1)
      Object.assign(state.phases["carry-over"], {
        status: "passed",
        verdict: "SKIPPED",
        note: "try-1"
      })
    if (domainMode) state.domainMode = domainMode
    const p = path.join(dir, "state.json")
    writeState(p, state)
    return ok({ statePath: p, state })
  }

  if (cmd === "get") {
    if (bools.has("active")) {
      const runs: { statePath: string; state: RunState }[] = []
      for (const { statePath, state } of latestTries(root)) {
        if (["completed", "rejected", "stopped"].includes(state.status))
          continue
        // v1 と M4 より前の state の awaiting_outcome は outcome の自動同期で終端にできるので、
        // 文言を出さずに読んだ state のまま返す(設計書 決定 63・§6.6)。
        if (!isLegacy(state) || state.status === "awaiting_outcome")
          runs.push({ statePath, state })
        else process.stderr.write(`${legacyMessage(state)}\n`)
      }
      return ok({ runs })
    }
    const latest = loadRun(root, flags, true)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "stop") {
    const latest = loadRun(root, flags, true)
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    const waits = latest.state.waits ?? []
    if (waits.length > 0 && !bools.has("abandon-waits"))
      fail(
        `待ちが残っています: ${waits.map((w) => w.id).join(", ")}。委譲を止めるか完了を待って片付けてください。止められず待てないときだけ、人に確かめてから --abandon-waits を付けます`
      )
    if (bools.has("abandon-waits")) delete latest.state.waits
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
    if (st.status !== "active")
      fail(`run が active ではありません(${st.status})。resume してください`)
    // run ブランチを持たないまま実装系のフェーズへ進ませない
    if (st.branch === null && phase !== "intent")
      fail(
        `branch が null の run(init --intent-only)では intent 以外のフェーズを開始できません: ${phase}`
      )
    const stageIdx = STAGES.findIndex((s) => s.includes(phase))
    for (let i = 0; i < stageIdx; i++)
      for (const prev of STAGES[i])
        if (st.phases[prev].status !== "passed")
          fail(`前フェーズが未完了です: ${prev}(${st.phases[prev].status})`)
    if (!["pending", "in_progress"].includes(st.phases[phase].status))
      fail(
        `フェーズ ${phase} は ${st.phases[phase].status} のため開始できません`
      )
    // code 系フェーズは開始の HEAD を記録する(Raguel 設計書 §6.13.3)。in_progress のフェーズを
    // 開始し直しても書き換えない。起点を後ろへずらして差分の一部だけを評価させないため
    // carry-over は前の try から引き継いだ差分の全体を評価するので、起点をベースブランチとの
    // 分岐点にする。intent の評価の後のコミットも差分に入るので、連続性は照らさない
    if (phase === "carry-over" && !st.phases[phase].startHead) {
      if (!st.baseBranch)
        fail(
          "carry-over を開始できません。state に baseBranch がありません(init で --base-branch を渡してください)"
        )
      const base = gitMergeBase(root, st.baseBranch as string, "HEAD")
      if (!base)
        fail(
          `carry-over の起点を読めません(git merge-base ${st.baseBranch} HEAD が失敗した): ${root}`
        )
      st.phases[phase].startHead = base as string
    } else if (CODE_PHASES.has(phase) && !st.phases[phase].startHead) {
      const head = gitHead(root)
      if (!head)
        fail(
          `フェーズ ${phase} の開始の HEAD を読めません(git rev-parse HEAD が失敗した): ${root}`
        )
      const problem = continuityProblem(root, st, phase, head as string)
      if (problem) fail(problem)
      st.phases[phase].startHead = head as string
    }
    st.phases[phase].status = "in_progress"
    st.phase = phase
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  if (cmd === "skip-phase") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    if (!SKIPPABLE.has(phase))
      fail(
        `${phase} はスキップできません(skip-phase は discuss・design・fix-loop のみ対応)`
      )
    if (!flags.reason) fail("--reason が必要です")
    const latest = loadRun(root, flags)
    const st = latest.state
    if (st.status !== "active")
      fail(`run が active ではありません(${st.status})。resume してください`)
    // start-phase と同じく、run ブランチを持たない run を intent より先へ進ませない
    if (st.branch === null)
      fail(
        `branch が null の run(init --intent-only)では ${phase} をスキップできません`
      )
    if (LIGHT_ONLY_SKIPPABLE.has(phase) && st.scale !== "light")
      fail(
        `${phase} をスキップできるのは scale が light の run だけです(scale: ${st.scale})`
      )
    const ph = st.phases[phase]
    if (ph.status !== "pending")
      fail(
        `フェーズ ${phase} は ${ph.status} のためスキップできません(開始済みのループは pass-gate で通過する)`
      )
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
    if (!GATED.has(phase))
      fail(`${phase} はゲート対象フェーズではありません(complete-phase を使用)`)
    const latest = loadRun(root, flags)
    if (latest.state.raguelContract !== 2)
      fail(oldContractMessage(latest.state))
    const ph = latest.state.phases[phase]
    if (ph.status !== "in_progress")
      fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`)
    if (!flags["evaluation-id"]) fail("--evaluation-id が必要です")
    const humanApproved = bools.has("human-approved")
    // STOP を記録したフェーズの verdict は、人の裁定なしに上書きさせない(設計書 §6.2.2、決定 83)。
    // STOP の有無は state の verdict ではなく Raguel の索引で決める。STOP が返ってから mark-ask
    // までの間に中断した run も、ここで止めるためである。
    // 例外は carry-over で、妥当の STOP の後に直して評価し直した PROCEED を通す。
    // その評価がフェーズの最新の評価で PROCEED であることは、下の checkGate の検査 3・4 が照らす
    let stops: ReturnType<typeof openPhaseStops> = []
    try {
      stops = openPhaseStops(raguelStore(root), latest.state.raguelRunId, phase)
    } catch (e) {
      fail(`Raguel の記録を読めません: ${(e as Error).message}`)
    }
    // 再提出で記録する、このフェーズの STOP の evaluationId(通す評価より前のもの)
    const stopIds = stops.map((e) => e.evaluationId)
    const resubmitAfterStop =
      phase === "carry-over" &&
      stops.length > 0 &&
      !ph.humanApproved &&
      !humanApproved &&
      flags.verdict === "PROCEED" &&
      !stopIds.includes(flags["evaluation-id"])
    // state の verdict が STOP のものに加え、索引にだけある STOP(mark-ask の前に中断したもの)も止める。
    // state の STOP は --verdict の検査より先に、索引にだけある STOP はその後に知らせる
    const blockedByStop =
      (stops.length > 0 || ph.verdict === "STOP") &&
      !humanApproved &&
      !resubmitAfterStop
    const stopMessage = `フェーズ ${phase} には Raguel の STOP が記録されています。人が誤検知と裁定したときだけ --verdict STOP --human-approved で通してください`
    if (blockedByStop && ph.verdict === "STOP") fail(stopMessage)
    if (humanApproved) {
      if (!(VERDICTS as readonly string[]).includes(flags.verdict))
        fail(
          `不正な --verdict: ${flags.verdict}。許される値は ${VERDICTS.join(", ")} です`
        )
    } else if (flags.verdict !== "PROCEED")
      fail(
        `verdict が PROCEED ではありません: ${flags.verdict}。ASK と STOP は mark-ask(STOP は --verdict STOP を付ける)で人の裁定にかけてください`
      )
    if (blockedByStop) fail(stopMessage)
    // 自己申告の --verdict を Raguel の記録で照らす(Raguel 設計書 §6.13.3 の検査 1〜5・7〜9)
    // 検査 9 の期待するファイルの置き場
    let dirs = { testsDir: "", runsDir: "" }
    try {
      dirs = readCodielConfig(root)
    } catch (e) {
      fail((e as Error).message)
    }
    let problem: string | null = null
    try {
      problem = checkGate({
        store: raguelStore(root),
        root,
        runId: latest.state.raguelRunId,
        phase,
        evaluationId: flags["evaluation-id"],
        verdict: flags.verdict,
        humanApproved,
        startHead: ph.startHead,
        runDocsDir: path.posix.join(dirs.runsDir, latest.state.runId),
        testsDir: dirs.testsDir
      })
    } catch (e) {
      problem = `Raguel の記録を読めません: ${(e as Error).message}`
    }
    // 再提出は、STOP を受けた評価の後に HEAD が進んでいること(直したこと)を条件にする。
    // 進んだとは、STOP の HEAD の子孫で、STOP の HEAD からの差分があることを指す。
    // 内容を変えない amend、reset、別ブランチへの switch はここで落ちる
    if (!problem && resubmitAfterStop) {
      try {
        // ph.evaluationId は最初の STOP を指すので、HEAD は索引の最後の STOP と比べる
        const stopRow = stops.at(-1)
        const stopHead = stopRow
          ? readVerdictRecord(stopRow.casePath)?.subject?.head
          : undefined
        const head = gitHead(root)
        const advanced =
          !!stopHead &&
          !!head &&
          stopHead !== head &&
          isAncestor(root, stopHead, head) &&
          (changedPathsSince(root, stopHead) ?? []).length > 0
        if (!advanced)
          problem = `STOP の評価(${stopRow?.evaluationId})の後に HEAD が進んでいません(評価した HEAD: ${stopHead ?? "記録なし"})。所見を直してコミットしてから評価し直してください`
      } catch (e) {
        problem = `Raguel の記録を読めません: ${(e as Error).message}`
      }
    }
    if (problem) fail(problem)
    ph.status = "passed"
    ph.evaluationId = flags["evaluation-id"]
    ph.verdict = flags.verdict
    if (humanApproved) ph.humanApproved = true
    // 監査で追えるよう、STOP を受けた評価を note に残す
    if (resubmitAfterStop && stopIds.length > 0) ph.note = resubmitNote(stopIds)
    const passedHead = gitHead(root)
    if (passedHead) ph.passedHead = passedHead
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "complete-phase") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    if (GATED.has(phase))
      fail(`${phase} はゲート対象フェーズです(pass-gate を使用)`)
    const latest = loadRun(root, flags)
    const ph = latest.state.phases[phase]
    if (ph.status !== "in_progress")
      fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`)
    // local の run は PR を作らないので、pr.url は null のまま残す
    if (phase === "pr" && latest.state.integration === "github") {
      if (!flags["pr-url"])
        fail(
          "integration が github の run の pr フェーズには --pr-url が必要です"
        )
      latest.state.pr.url = flags["pr-url"]
    }
    ph.status = "passed"
    ph.note = flags.note ?? null
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "mark-ask") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    const askKind =
      "kind" in flags
        ? oneOf(flags, "kind", ["raguel", "confirm"] as const)
        : "raguel"
    const verdict =
      "verdict" in flags ? oneOf(flags, "verdict", VERDICTS) : "ASK"
    const latest = loadRun(root, flags)
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    const ph = latest.state.phases[phase]
    // passed(skip 済みを含む)を巻き戻すと、ゲートの記録が消え、後続のフェーズを開始できなくなる。
    // pending を in_progress にできるのは start-phase だけで、mark-ask → resume で迂回させない。
    // 例外は start-phase を持たない finalize で、pending のまま確認してよい(設計書 §6.1.1)。
    if (ph.status === "passed")
      fail(`フェーズ ${phase} は passed のため mark-ask できません`)
    if (ph.status === "pending" && phase !== "finalize")
      fail(
        `フェーズ ${phase} は pending のため mark-ask できません。start-phase してから確認してください`
      )
    // Raguel の ASK・STOP は、評価の索引にその評価があるときだけ人の裁定にかける(Raguel 設計書 §6.13.3)
    if (askKind === "raguel") {
      const evaluationId = flags["evaluation-id"]
      if (!evaluationId) fail("--kind raguel には --evaluation-id が必要です")
      let problem: string | null = null
      try {
        problem = checkEvaluationRow(
          findEvaluation(readEvaluationIndex(raguelStore(root)), evaluationId),
          {
            evaluationId,
            runId: latest.state.raguelRunId,
            phase,
            verdict
          }
        )
      } catch (e) {
        problem = `Raguel の記録を読めません: ${(e as Error).message}`
      }
      if (problem) fail(problem)
    }
    ph.status = "awaiting_human"
    // 記録済みの STOP は verdict と evaluationId をどちらも、新しい --verdict と
    // --evaluation-id の有無と値にかかわらず残す。resume と mark-ask を挟んで
    // --human-approved の無い pass-gate を通させないためと、STOP の evaluationId を
    // init の文言と capturing-intent の手順 1 に示し続けるため(設計書 §6.2.2、§6.14.2 の (6)(7)、決定 83)
    if (ph.verdict !== "STOP") {
      ph.evaluationId = flags["evaluation-id"] ?? null
      ph.verdict = verdict
    }
    ph.askKind = askKind
    latest.state.status = "awaiting_human"
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "resume") {
    const latest = loadRun(root, flags)
    if (latest.state.status !== "awaiting_human")
      fail(`awaiting_human ではありません(${latest.state.status})`)
    latest.state.status = "active"
    for (const ph of Object.values(latest.state.phases))
      if (ph.status === "awaiting_human") ph.status = "in_progress"
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "set-domain") {
    const raw: string | undefined = flags.domain
    if (raw === undefined) fail("--domain が必要です")
    const domain = (raw ?? "").trim()
    if (domain === "")
      fail("--domain に空文字列は指定できません(解除は clear-domain を使用)")
    const latest = loadRun(root, flags)
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    latest.state.domain = domain
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  // clear-domain は状態を問わず通す。委譲中に run が awaiting_human へ落ちても
  // 解除できないと、古い domain が残ったまま書き込み境界が効き続けるため。
  if (cmd === "clear-domain") {
    const latest = loadRun(root, flags)
    latest.state.domain = null
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  // 待ちの id は報告のファイル名に使うので、パスに使えない文字を拒む
  if (cmd === "wait-add") {
    const id = flags.id
    if (!id) fail("--id が必要です")
    if (!SLUG_RE.test(id) || id.length > 100)
      fail(
        `不正な --id: ${id}。英小文字と数字をハイフンでつなぎ、100 文字以内にしてください`
      )
    const purpose = (flags.purpose ?? "").trim()
    if (purpose === "") fail("--purpose が必要です")
    const latest = loadRun(root, flags)
    const st = latest.state
    if (TERMINAL.has(st.status)) fail(`すでに終端状態です: ${st.status}`)
    if ((st.waits ?? []).some((w) => w.id === id))
      fail(`待ち ${id} はすでに残っています`)
    if (fs.existsSync(waitReport(latest, id)))
      fail(
        `${waitReport(latest, id)} がすでにあります(id は try の中で使い回さない)`
      )
    const wait: Wait = {
      id,
      purpose,
      phase: st.phase ?? "",
      startedAt: new Date().toISOString()
    }
    if (flags["task-id"]) wait.taskId = flags["task-id"]
    st.waits = [...(st.waits ?? []), wait]
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  // 報告を書いてから消す順序を、waits/<id>.md の有無で守らせる
  if (cmd === "wait-done") {
    const id = flags.id
    if (!id) fail("--id が必要です")
    if (!SLUG_RE.test(id)) fail(`不正な --id: ${id}`)
    const latest = loadRun(root, flags)
    const st = latest.state
    const waits = st.waits ?? []
    if (!waits.some((w) => w.id === id)) fail(`待ち ${id} はありません`)
    if (!fs.existsSync(waitReport(latest, id)))
      fail(
        `${waitReport(latest, id)} がありません。返答の本文を書いてから wait-done してください`
      )
    st.waits = waits.filter((w) => w.id !== id)
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  // wait-clear は状態を問わず通す(clear-domain と同じ)。消した待ちを出力する
  if (cmd === "wait-clear") {
    const latest = loadRun(root, flags)
    const cleared = latest.state.waits ?? []
    latest.state.waits = []
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state, cleared })
  }

  // resume 時の再判定で連携モードを変えるときに使う(計画書 §2)。
  // imageUpload も連携モードと同じ扱いなので、1 回で両方を書き換える。
  if (cmd === "set-integration") {
    const integration = oneOf(flags, "integration", INTEGRATIONS)
    const upload = imageUpload(flags, integration)
    const latest = loadRun(root, flags)
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    latest.state.integration = integration
    latest.state.imageUpload = upload
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "record-attempt") {
    const phase = pos[1]
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`)
    const latest = loadRun(root, flags)
    // 終端の run を上限超過で awaiting_human へ戻さない。上限超過の後の awaiting_human → resume は残す
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    const ph = latest.state.phases[phase]
    ph.attempts = (ph.attempts ?? 0) + 1
    if (ph.attempts > latest.state.limits.maxFixAttempts) {
      latest.state.status = "awaiting_human"
      writeState(latest.statePath, latest.state)
      ok({
        statePath: latest.statePath,
        state: latest.state,
        capExceeded: true
      })
      process.exit(3)
    }
    writeState(latest.statePath, latest.state)
    return ok({
      statePath: latest.statePath,
      state: latest.state,
      capExceeded: false
    })
  }

  // init --intent-only の run を、intent の pass-gate の後に終える(設計書 §6.1.3)。
  // outcome の自動同期は PR も run ブランチも無い run を扱わないので、
  // awaiting_outcome を経ずに completed にする。
  if (cmd === "close") {
    const latest = loadRun(root, flags)
    const st = latest.state
    if (TERMINAL.has(st.status)) fail(`すでに終端状態です: ${st.status}`)
    if (st.branch !== null)
      fail(
        `close は branch が null の run(init --intent-only)でだけ使えます(branch: ${st.branch})`
      )
    if (st.phases.intent.status !== "passed")
      fail(`intent が passed ではありません(${st.phases.intent.status})`)
    // init が SKIPPED で通した carry-over(try-1 と導入前の run)は、進めたフェーズに数えない
    for (const [name, ph] of Object.entries(st.phases))
      if (
        name !== "intent" &&
        ph.status !== "pending" &&
        !(name === "carry-over" && ph.verdict === "SKIPPED")
      )
        fail(`フェーズ ${name} が pending ではありません(${ph.status})`)
    st.status = "completed"
    st.stopReason = flags.reason ?? null
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  if (cmd === "finalize") {
    const latest = loadRun(root, flags)
    for (const [name, ph] of Object.entries(latest.state.phases)) {
      if (name === "finalize") continue
      if (ph.status !== "passed")
        fail(`フェーズ ${name} が未完了です(${ph.status})`)
    }
    latest.state.phases.finalize.status = "passed"
    latest.state.status = "awaiting_outcome"
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  if (cmd === "record-outcome") {
    const latest = loadRun(root, flags, true)
    const outcome = flags.outcome
    if (!["approved", "rejected", "incident"].includes(outcome))
      fail(`不正な outcome: ${outcome}`)
    // v1 と M4 より前の state の run は、awaiting_outcome の run と、completed / rejected の
    // run への incident だけを受け付け、読んだ形のまま書き戻す(設計書 決定 63・§6.2.4・§6.6)
    if (isLegacy(latest.state)) {
      const st = latest.state.status
      const terminalIncident =
        outcome === "incident" && (st === "completed" || st === "rejected")
      if (st !== "awaiting_outcome" && !terminalIncident)
        fail(legacyMessage(latest.state))
    }
    if (
      !["awaiting_outcome", "completed", "rejected"].includes(
        latest.state.status
      )
    )
      fail(`outcome を記録できる状態ではありません(${latest.state.status})`)
    if (outcome === "approved") latest.state.status = "completed"
    if (outcome === "rejected") latest.state.status = "rejected"
    if (outcome === "incident")
      latest.state.incidents.push({
        at: new Date().toISOString(),
        note: flags.note ?? null
      })
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  // 持続層ファイルの ADR 候補 ID を採番する。run 状態を持たないので loadRun は使わない
  // (計画書 §2、設計書 §6.4.2)。
  if (cmd === "next-adr-candidate-id") {
    const file = flags.file
    if (!file) fail("--file が必要です")
    const domain = flags.domain
    if (!domain) fail("--domain が必要です")
    const filePath = path.isAbsolute(file) ? file : path.join(root, file)
    let max = 0
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8")
      // 完全一致のトークンとして読む。frontend-1 が frontend-10 の一部として
      // 拾われないよう、抽出した ID 全体を領域名の正規表現に照合する。
      const domainRe = new RegExp(`^${escapeRegExp(domain)}-([0-9]+)$`)
      const idRe = /\[ADR 候補: ([^\]]+)\]|\(候補 ID: ([^)]+)\)/g
      for (const m of content.matchAll(idRe)) {
        const id = m[1] ?? m[2]
        const digits = id.match(domainRe)?.[1]
        if (digits) max = Math.max(max, Number(digits))
      }
    }
    return ok({ candidateId: `${domain}-${max + 1}` })
  }

  // 並列実装のステップ(--kind step)と、test-code・test-loop の仕様のディレクトリ
  // (--kind test-code・test-loop)を登録する(計画書 §6.2)。pending のものは、dev-plan の
  // 差し戻し後の登録し直しで上書きする。testLoop.units は、前の巡で merged になった要素も
  // 次の巡の修正のために登録し直せる(設計書 §6.7)。キーの位置は変わらないので k も変わらない。
  if (cmd === "step-add") {
    const kind = stepKind(flags)
    const isStep = kind === "step"
    const id = flags.id
    if (!id) fail("--id が必要です")
    if (isStep && !SLUG_RE.test(id)) fail(`不正な --id: ${id}`)
    if (!isStep && !isSpecDirId(id))
      fail(
        `不正な --id: ${id}。${kind} には units/・e2e/frontend/・e2e/backend/・e2e/cli/ で始まる仕様のディレクトリの ID を渡してください`
      )
    if (!isStep && ("deps" in flags || bools.has("final")))
      fail(`${kind} には --deps と --final を指定できません`)
    const files = jsonList(flags, "files", isStep)
    if (isStep && files.length === 0)
      fail("--files には触るファイルを 1 つ以上渡してください")
    for (const f of files)
      if (f.startsWith("/") || f.split("/").includes(".."))
        fail(`--files には repoRoot 相対の glob を渡してください: ${f}`)
    const deps = jsonList(flags, "deps", isStep)
    const final = bools.has("final")
    let domain: string | null = null
    if ("domain" in flags) {
      domain = (flags.domain ?? "").trim()
      if (domain === "") fail("--domain に空文字列は指定できません")
    }
    const latest = loadRun(root, flags)
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    const table = stepTable(latest.state, kind)
    const prev = table[id]
    const reAddable =
      prev?.status === "pending" ||
      (kind === "test-loop" && prev?.status === "merged")
    if (prev && !reAddable)
      fail(`${kind} ${id} は ${prev.status} のため登録し直せません`)
    table[id] = {
      status: "pending",
      files,
      deps,
      final,
      group: null,
      worktree: null,
      branch: null,
      commits: { base: null, head: null },
      attempts: 0,
      domain
    }
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  // ステップと仕様のディレクトリの状態を、計画書 §6.2 の表の遷移だけで進める
  if (cmd === "step-update") {
    const kind = stepKind(flags)
    const id = flags.id
    if (!id) fail("--id が必要です")
    const to = oneOf(flags, "status", STEP_STATUSES)
    const latest = loadRun(root, flags)
    const st = latest.state
    if (TERMINAL.has(st.status)) fail(`すでに終端状態です: ${st.status}`)
    const step = stepTable(st, kind)[id]
    if (!step) fail(`${kind} ${id} は登録されていません`)
    const accepts = STEP_TRANSITIONS[`${step.status}>${to}`]
    if (!accepts)
      fail(`${kind} ${id} は ${step.status} から ${to} へ遷移できません`)
    const record: Record<string, string> = {}
    for (const name of STEP_RECORD_FLAGS) {
      if (!(name in flags)) continue
      if (!accepts.includes(name))
        fail(
          `--${name} は ${step.status} から ${to} への遷移では指定できません`
        )
      if (!flags[name]) fail(`--${name} に値が必要です`)
      record[name] = flags[name]
    }
    if (record.worktree && path.isAbsolute(record.worktree))
      fail(
        `--worktree には repoRoot 相対のパスを渡してください: ${record.worktree}`
      )
    // worktree のパスは run の中で一意にする(設計書 §6.6.3)。hook は worktree の記録との
    // 一致で要素を引くので、3 つの表のほかの要素がすでに記録したパスを拒否する。
    if (record.worktree) {
      const wt = normalizeRel(record.worktree)
      const tables = {
        step: st.implement?.steps,
        "test-code": st.testCode?.units,
        "test-loop": st.testLoop?.units
      }
      for (const [k, table] of Object.entries(tables))
        for (const [otherId, other] of Object.entries(table ?? {}))
          if (
            other !== step &&
            other.worktree !== null &&
            normalizeRel(other.worktree) === wt
          )
            fail(
              `--worktree ${record.worktree} は ${k} ${otherId} がすでに記録しています`
            )
    }
    // 修正ラウンドは phases[phase].attempts(record-attempt)と別に数える
    if (step.status === "reviewing" && to === "running") step.attempts++
    // やり直しの前に worktree とブランチを消したので、記録も消す
    if (step.status === "failed" && to === "pending") {
      step.worktree = null
      step.branch = null
      step.commits = { base: null, head: null }
    }
    if (record.worktree) step.worktree = record.worktree
    if (record.branch) step.branch = record.branch
    if (record.base) step.commits.base = record.base
    if (record.head) step.commits.head = record.head
    step.status = to
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  // implement.steps だけを対象に実行の順序を出し、各ステップの group を記録する
  // (設計書 §6.6.2)。testCode.units と testLoop.units は対象外(仕様のディレクトリの
  // 同時実行は spec.md の parallel で決まる)。
  if (cmd === "waves") {
    const latest = loadRun(root, flags)
    if (TERMINAL.has(latest.state.status))
      fail(`すでに終端状態です: ${latest.state.status}`)
    const steps = latest.state.implement?.steps ?? {}
    let plan: ReturnType<typeof planWaves> = { groups: [], final: [] }
    try {
      plan = planWaves(steps)
    } catch (e) {
      fail((e as Error).message)
    }
    plan.groups.forEach((g, index) => {
      for (const id of g.steps) steps[id].group = { index, mode: g.mode }
    })
    plan.final.forEach((id, index) => {
      steps[id].group = { index, mode: "final" }
    })
    if (latest.state.implement) writeState(latest.statePath, latest.state)
    return ok(plan)
  }

  // .codiel/config.json の testsDir と runsDir を返す(設計書 §6.13.4)。run を要しない
  if (cmd === "config") {
    try {
      return ok(readCodielConfig(root))
    } catch (e) {
      fail((e as Error).message)
    }
  }

  // .gitignore に要る行と、足りない行を返す(設計書 §6.15.5)。run を要しない。
  // .gitignore は書かない(書くのは /codiel:init)
  if (cmd === "gitignore") {
    let testsDir = ""
    try {
      testsDir = readCodielConfig(root).testsDir
    } catch (e) {
      fail((e as Error).message)
    }
    const required = gitignoreLines(testsDir)
    return ok({
      path: ".gitignore",
      required,
      missing: missingGitignoreLines(root, required)
    })
  }

  // fix-loop でテストの保護を外す(設計書 §6.13.6)。所見がテストに向くと確かめたときだけ使う
  if (cmd === "set-test-edit") {
    const latest = loadRun(root, flags)
    const st = latest.state
    if (TERMINAL.has(st.status)) fail(`すでに終端状態です: ${st.status}`)
    const fixLoop = st.phases["fix-loop"].status
    if (st.phase !== "fix-loop" || fixLoop !== "in_progress")
      fail(
        `set-test-edit は fix-loop が in_progress のときだけ使えます(phase: ${st.phase}、fix-loop: ${fixLoop})`
      )
    st.testEdit = true
    writeState(latest.statePath, st)
    return ok({ statePath: latest.statePath, state: st })
  }

  // clear-test-edit は状態を問わず通す。保護を外したまま残さないため(clear-domain と同じ)
  if (cmd === "clear-test-edit") {
    const latest = loadRun(root, flags)
    delete latest.state.testEdit
    writeState(latest.statePath, latest.state)
    return ok({ statePath: latest.statePath, state: latest.state })
  }

  fail(`不明なコマンド: ${cmd}`)
}
