import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runStateInProcess } from "../../../__test__/helpers/state-in-process.js"
import {
  GATED,
  type RunState,
  readState,
  STAGES,
  type StepState,
  writeState
} from "../../../codiel-state.js"
import { runTs } from "../../../testing/run-ts.js"

export const HOOK = fileURLToPath(
  new URL("../../guard-write.ts", import.meta.url)
)

export const CLI = fileURLToPath(
  new URL("../../../codiel-state-cli.ts", import.meta.url)
)

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny/ask など出力がある場合は hookSpecificOutput を返す。
export interface HookOutput {
  permissionDecision: string
  permissionDecisionReason: string
}

// env を渡すと、フックの環境変数に足す(RAGUEL_CONFIG を指すときに使う)
export function hook(
  cwd: string,
  toolName: string,
  filePath: string,
  env: Record<string, string> = {}
): HookOutput | null {
  const input = JSON.stringify({
    cwd,
    tool_name: toolName,
    tool_input: { file_path: filePath }
  })
  const out = runTs(HOOK, [], { input, env: { ...process.env, ...env } })
  if (out === "") return null
  return (JSON.parse(out) as { hookSpecificOutput: HookOutput })
    .hookSpecificOutput
}

export const SLUG = "demo"

// init の必須フラグの既定値。intent は state.intent とも一致させ、
// 「state.intent のファイル」の判定を実際に検証できるようにする。
export const INIT_DEFAULTS: Record<string, string> = {
  intent: "docs/intents/2026-09-27-demo.md",
  integration: "github",
  scale: "standard",
  "knowledge-target": "metatron",
  "adr-candidates": "on",
  "gotcha-candidates": "on",
  "image-upload": "gh-attach,chrome"
}

export function intentPath(root: string): string {
  return path.join(root, INIT_DEFAULTS.intent)
}

// init だけを行い、start-phase を呼ばない(state.phase が null の run)。
export function initOnly(slug = SLUG): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-write-"))
  const args = ["init", "--slug", slug]
  for (const [k, v] of Object.entries(INIT_DEFAULTS)) args.push(`--${k}`, v)
  runStateInProcess(root, args)
  return root
}

// init の後、intent フェーズを in_progress にする。
export function setupRun(slug = SLUG): string {
  const root = initOnly(slug)
  runStateInProcess(root, ["start-phase", "intent", "--slug", slug])
  return root
}

export const PHASE_SEQUENCE = STAGES.flat()

export function statePathFor(root: string, slug: string): string {
  return path.join(root, ".codiel/runs", slug, "try-1/state.json")
}

// root の run を、targetPhase が in_progress になるまで進める。CLI を 1 フェーズ
// ずつ子プロセスで起動すると run 数が増えるほど遅くなるため、state.json を直接
// 組み立てる(guard-write が読むのは state.json の内容だけであり、CLI 側の
// バリデーションはここでの検証対象ではない)。手前までの GATED なフェーズは
// pass-gate 相当、それ以外は complete-phase 相当で終える
// (pr だけ integration が github の run に必須の pr.url を添える)。
export function advanceRunTo(
  root: string,
  targetPhase: string,
  slug = SLUG
): void {
  const p = statePathFor(root, slug)
  const state = readState(p)
  const idx = PHASE_SEQUENCE.indexOf(targetPhase)
  for (let i = 0; i < idx; i++) {
    const ph = PHASE_SEQUENCE[i]
    const phaseState = state.phases[ph]
    if (GATED.has(ph)) {
      phaseState.evaluationId = "e"
      phaseState.verdict = "PROCEED"
    } else if (ph === "pr") {
      state.pr.url = "https://example.com/pr/1"
    }
    phaseState.status = "passed"
  }
  state.phases[targetPhase].status = "in_progress"
  state.phase = targetPhase
  writeState(p, state)
}

// setupRun の run を implement フェーズまで進める。
export function advanceToImplement(root: string): void {
  advanceRunTo(root, "implement")
}

export const DOMAINS = {
  frontend: ["src/app/**", "src/components/**"],
  backend: ["src/server/**", "src/api/**"]
}

export function writeArchitecture(
  root: string,
  domains: Record<string, string[]>
) {
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

export const SPEC_DIR = "docs/codiel/tests/units/src/a.ts"

export const CASES = `${SPEC_DIR}/cases.md`

export const RECORDED = "src/__test__/a.test.ts"

export function writeSpec(
  root: string,
  dir: string,
  frontmatter: string
): void {
  fs.mkdirSync(path.join(root, dir), { recursive: true })
  fs.writeFileSync(
    path.join(root, dir, "spec.md"),
    `---\n${frontmatter}\n---\n\n# 仕様\n`
  )
}

export function writeConfig(root: string, content: string): void {
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true })
  fs.writeFileSync(path.join(root, ".codiel/config.json"), content)
}

export function patchState(root: string, fn: (s: RunState) => void): void {
  const p = statePathFor(root, SLUG)
  const s = readState(p)
  fn(s)
  writeState(p, s)
}

export function decision(root: string, rel: string): string | null {
  return hook(root, "Write", path.join(root, rel))?.permissionDecision ?? null
}

export function git(cwd: string, args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=codiel-test",
      "-c",
      "user.email=codiel-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args
    ],
    { cwd, stdio: "ignore" }
  )
}

// git リポジトリのメインの作業ツリーに run を作り、phase を in_progress にする。
// commitCodiel が真なら .codiel/config.json をコミットし、worktree の checkout にも .codiel/ が現れる。
export function setupGitRun(phase: string, commitCodiel = false): string {
  const main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gw-wt-")))
  git(main, ["init", "-q"])
  fs.mkdirSync(path.join(main, "src"))
  fs.writeFileSync(path.join(main, "src/index.ts"), "")
  if (commitCodiel)
    writeConfig(main, `${JSON.stringify({ testsDir: "docs/codiel/tests" })}\n`)
  git(main, ["add", "-A"])
  git(main, ["commit", "-q", "-m", "init"])
  const args = ["init", "--slug", SLUG]
  for (const [k, v] of Object.entries(INIT_DEFAULTS)) args.push(`--${k}`, v)
  runStateInProcess(main, args)
  advanceRunTo(main, phase)
  patchState(main, (s) => {
    s.domainMode = "mapped"
    s.domain = null
  })
  writeArchitecture(main, DOMAINS)
  return main
}

export function worktreeRel(name: string): string {
  return `.codiel/worktrees/${SLUG}/${name}`
}

export function addWorktree(main: string, name: string): string {
  git(main, [
    "worktree",
    "add",
    "-q",
    "-b",
    `codiel/${SLUG}-try-1-${name}`,
    worktreeRel(name)
  ])
  return path.join(main, worktreeRel(name))
}

export function element(
  worktree: string | null,
  domain: string | null
): StepState {
  return {
    status: "running",
    files: [],
    deps: [],
    final: false,
    group: null,
    worktree,
    branch: null,
    commits: { base: null, head: null },
    attempts: 0,
    domain
  }
}
