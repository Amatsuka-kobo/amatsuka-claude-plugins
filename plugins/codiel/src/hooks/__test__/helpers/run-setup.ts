// guard-bash と guard-github-mcp のテストが使う、run を作ってフェーズを進めるヘルパー
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runTs } from "../../../testing/run-ts.js"

const CLI = fileURLToPath(
  new URL("../../../codiel-state-cli.ts", import.meta.url)
)

export const SLUG = "demo"
export const INIT_FLAGS = [
  "--intent",
  "docs/intents/2026-09-27-demo.md",
  "--integration",
  "github",
  "--scale",
  "standard",
  "--knowledge-target",
  "metatron",
  "--adr-candidates",
  "on",
  "--gotcha-candidates",
  "on",
  "--image-upload",
  "gh-attach,chrome"
]

// Raguel の設定。cli が RAGUEL_CONFIG でこのファイルを指す
export function raguelConfigPath(root: string): string {
  return path.join(root, ".raguel", "config.json")
}

export function casesProjectDir(root: string): string {
  return path.join(root, ".raguel", "cases", "demo")
}

export function cli(root: string, args: string[]): string {
  return runTs(CLI, args, {
    cwd: root,
    env: { ...process.env, RAGUEL_CONFIG: raguelConfigPath(root) }
  })
}

export function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
    { cwd: root, encoding: "utf8" }
  ).trim()
}

// git のリポジトリ(空のコミット 1 つ)に Raguel の記録の置き場を置く。
// code 系フェーズの start-phase が HEAD を読み、pass-gate と mark-ask が Raguel の記録を照らすため
export function newProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-bash-"))
  git(root, "init", "-q")
  git(root, "commit", "-q", "--allow-empty", "-m", "init")
  fs.mkdirSync(path.join(root, ".raguel"))
  fs.writeFileSync(
    raguelConfigPath(root),
    JSON.stringify({
      storage: { casesDir: path.join(root, ".raguel"), projectId: "demo" }
    })
  )
  return root
}

// pass-gate の検査 9 が文書のフェーズに期待するファイル(既定の runsDir と testsDir)を
// 評価したことにする。ファイルが無ければ sha256 は null
export function docFiles(root: string, slug: string, phase: string) {
  const rel = (
    {
      design: `docs/codiel/runs/${slug}/design.md`,
      "dev-plan": `docs/codiel/runs/${slug}/dev-plan.md`,
      "test-spec": "docs/codiel/tests/units/demo/spec.md"
    } as Record<string, string | undefined>
  )[phase]
  if (!rel) return []
  const abs = path.join(root, rel)
  const sha256 = fs.existsSync(abs)
    ? createHash("sha256").update(fs.readFileSync(abs)).digest("hex")
    : null
  return [{ path: rel, sha256, isNew: true }]
}

// Raguel が書く形で、評価の索引の行と verdict.json を置き、evaluationId を返す
export function recordEvaluation(
  root: string,
  slug: string,
  phase: string,
  verdict: string
): string {
  const st = JSON.parse(
    fs.readFileSync(
      path.join(root, ".codiel/runs", slug, "try-1/state.json"),
      "utf8"
    )
  )
  const evaluationId = `e-${slug}-${phase}`
  const head = git(root, "rev-parse", "HEAD")
  const casePath = path.join(
    casesProjectDir(root),
    st.raguelRunId,
    phase,
    "attempt-01"
  )
  fs.mkdirSync(casePath, { recursive: true })
  const startHead = st.phases[phase]?.startHead
  const row = {
    schemaVersion: 2,
    evaluationId,
    runId: st.raguelRunId,
    phase,
    kind: startHead ? "code" : "design",
    attempt: 1,
    casePath,
    verdict,
    judgeStatus: "ok",
    head,
    at: new Date().toISOString()
  }
  const subject = {
    repoPath: root,
    head,
    ...(startHead ? { base: startHead } : {}),
    files: docFiles(root, slug, phase)
  }
  fs.writeFileSync(
    path.join(casePath, "verdict.json"),
    JSON.stringify({ ...row, subject })
  )
  fs.appendFileSync(
    path.join(casesProjectDir(root), "evaluations.jsonl"),
    `${JSON.stringify(row)}\n`
  )
  return evaluationId
}

export function passGateOf(root: string, phase: string, slug = SLUG): void {
  cli(root, [
    "pass-gate",
    phase,
    "--slug",
    slug,
    "--evaluation-id",
    recordEvaluation(root, slug, phase, "PROCEED"),
    "--verdict",
    "PROCEED"
  ])
}

// run を作成し、intent フェーズを in_progress にしたところで止める(phase=intent)。
export function setupRun(slug = SLUG): string {
  const root = newProject()
  cli(root, ["init", "--slug", slug, ...INIT_FLAGS])
  cli(root, ["start-phase", "intent", "--slug", slug])
  return root
}

// intent を pass させ、implement フェーズを in_progress にしたところで止める
// (phase=implement, test-loop は未着手 = passed ではない)。
export function setupRunAtImplement(root: string, slug = SLUG): void {
  passGateOf(root, "intent", slug)
  cli(root, ["start-phase", "discuss", "--slug", slug])
  cli(root, ["complete-phase", "discuss", "--slug", slug])
  for (const ph of ["design", "test-spec", "dev-plan", "test-code"]) {
    cli(root, ["start-phase", ph, "--slug", slug])
    passGateOf(root, ph, slug)
  }
  cli(root, ["start-phase", "implement", "--slug", slug])
}

// implement・test-loop・intent-sync まで pass-gate で通し、pr フェーズを
// in_progress にする(phase=pr, test-loop passed)。
export function setupRunAtPr(slug = SLUG): string {
  const root = setupRun(slug)
  setupRunAtImplement(root, slug)
  passGateOf(root, "implement", slug)
  cli(root, ["start-phase", "test-loop", "--slug", slug])
  passGateOf(root, "test-loop", slug)
  cli(root, ["start-phase", "intent-sync", "--slug", slug])
  passGateOf(root, "intent-sync", slug)
  cli(root, ["start-phase", "pr", "--slug", slug])
  return root
}

// pr・review を終え、fix-loop を skip して triage フェーズを in_progress に
// する(phase=triage)。gh issue create のマーカー検査を試すのに使う。
export function setupRunAtTriage(slug = SLUG): string {
  const root = setupRunAtPr(slug)
  cli(root, [
    "complete-phase",
    "pr",
    "--slug",
    slug,
    "--pr-url",
    "https://example.test/pull/1"
  ])
  cli(root, ["start-phase", "review", "--slug", slug])
  cli(root, ["complete-phase", "review", "--slug", slug])
  cli(root, ["skip-phase", "fix-loop", "--slug", slug, "--reason", "不要"])
  cli(root, ["start-phase", "triage", "--slug", slug])
  return root
}
