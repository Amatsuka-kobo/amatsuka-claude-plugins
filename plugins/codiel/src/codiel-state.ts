import fs from "node:fs"
import path from "node:path"

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
  adrTarget: "metatron" | "intents"
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
  ["discuss"],
  ["design"],
  ["test-spec", "dev-plan"],
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
  "design",
  "test-spec",
  "dev-plan",
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
const BOOL_FLAGS = ["active", "human-approved", "intent-only"]

const fail = (msg: string, code = 1): never => {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}
const ok = (obj: unknown): undefined => {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
  return undefined
}

export function readState(p: string): RunState {
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunState
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
function latestTries(root: string): LatestTry[] {
  const runsRoot = path.join(root, ".codiel", "runs")
  if (!fs.existsSync(runsRoot)) return []
  return fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => latestTry(root, d.name))
    .filter((t) => t !== null)
}

// hooks が使う active run の検索。version 2 の state だけを run として扱い、
// v1 の run は run が無いときと同じにする(設計書 §6.2.4)。
// `get --active` より狭く、active と awaiting_human だけを返す。
// awaiting_outcome は outcome の自動同期のために `get --active` にだけ含める。
export function findActiveRun(root: string): ActiveRun | null {
  let best: ActiveRun | null = null
  for (const latest of latestTries(root)) {
    const st = latest.state
    if (st.version !== 2) continue
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

// codiel 0.x(state version 1)の run を指したときに出す文言(設計書 §6.2.4)
function v1Message(st: RunState): string {
  const n = st.issue
  return (
    `codiel: .codiel/runs/issue-${n} は codiel 0.x の run(state version 1、status: ${st.status})であり、この版では再開できない。` +
    `codiel 0.x で完了させるか、\`codiel-state stop --slug issue-${n} --reason migrate\` で止めてから、\`/codiel:run ${n}\` で新しい run を始める。`
  )
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
    | "adrTarget"
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
    updatedAt: now
  }
}

// --slug の run の最新 try を読む。v1 の run は allowV1(get と stop、awaiting_outcome への
// record-outcome、completed / rejected の v1 の run への record-outcome --outcome incident)
// のときだけ返し、ほかのコマンドでは §6.2.4 の文言を出して失敗する(決定 63)。
function loadRun(
  root: string,
  flags: Record<string, string>,
  allowV1 = false
): LatestTry {
  const slug = flags.slug
  if (!slug) fail("--slug が必要です")
  if (!SLUG_RE.test(slug)) fail(`不正な --slug: ${slug}`)
  const latest = latestTry(root, slug) as LatestTry
  if (!latest) fail(`run が存在しません: ${slug}`)
  if (latest.state.version !== 2 && !allowV1) fail(v1Message(latest.state))
  return latest
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
    const adrTarget = oneOf(flags, "adr-target", [
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
        `未完了の try があります: ${latest.statePath}(status: ${latest.state.status})。resume するか stop してください`
      )
    const tryN = latest ? latest.tryN + 1 : 1
    const dir = path.join(runDir(root, slug), `try-${tryN}`)
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true })
    const state = newState(slug, tryN, {
      issue: "issue" in flags ? Number(flags.issue) : null,
      intent,
      branch: bools.has("intent-only") ? null : `codiel/${slug}-try-${tryN}`,
      integration,
      scale,
      imageUpload: upload,
      adrTarget
    })
    if (flags["base-branch"]) state.baseBranch = flags["base-branch"]
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
        // v1 の awaiting_outcome は outcome の自動同期で終端にできるので、文言を出さずに
        // version 1 の state のまま返す(設計書 決定 63)。
        if (state.version === 2 || state.status === "awaiting_outcome")
          runs.push({ statePath, state })
        else process.stderr.write(`${v1Message(state)}\n`)
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
    const ph = latest.state.phases[phase]
    if (ph.status !== "in_progress")
      fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`)
    if (!flags["evaluation-id"]) fail("--evaluation-id が必要です")
    const humanApproved = bools.has("human-approved")
    const acceptedVerdicts = humanApproved ? ["PROCEED", "ASK"] : ["PROCEED"]
    if (!acceptedVerdicts.includes(flags.verdict))
      fail(
        `verdict が PROCEED ではありません: ${flags.verdict}。ASK は mark-ask、STOP は stop を使用`
      )
    ph.status = "passed"
    ph.evaluationId = flags["evaluation-id"]
    ph.verdict = flags.verdict
    if (humanApproved) ph.humanApproved = true
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
    ph.status = "awaiting_human"
    ph.evaluationId = flags["evaluation-id"] ?? null
    ph.verdict = "ASK"
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
    for (const [name, ph] of Object.entries(st.phases))
      if (name !== "intent" && ph.status !== "pending")
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
    // v1 の run は awaiting_outcome の run と、completed / rejected の run への
    // incident だけを受け付け、version 1 のまま書き戻す(設計書 決定 63・§6.2.4)
    if (latest.state.version !== 2) {
      const st = latest.state.status
      const terminalIncident =
        outcome === "incident" && (st === "completed" || st === "rejected")
      if (st !== "awaiting_outcome" && !terminalIncident)
        fail(v1Message(latest.state))
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

  fail(`不明なコマンド: ${cmd}`)
}
