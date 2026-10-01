import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  expandBraces,
  findActiveRun,
  GATED,
  globsOverlap,
  planWaves,
  readCodielConfig,
  SKIPPABLE,
  STAGES,
  type StepState
} from "../codiel-state.js"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const CLI = fileURLToPath(new URL("../codiel-state-cli.ts", import.meta.url))

const UNTIL_PR = [
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
const UNTIL_REVIEW = [...UNTIL_PR, "pr", "review"]
const UNTIL_FINALIZE = [...UNTIL_REVIEW, "fix-loop", "triage"]

const INIT_DEFAULTS: Record<string, string> = {
  intent: "docs/intents/2026-09-27-demo.md",
  integration: "github",
  scale: "standard",
  "adr-target": "metatron",
  "image-upload": "gh-attach,chrome"
}

// git のリポジトリ(空のコミット 1 つ)にする。code 系フェーズの start-phase が HEAD を読むため
function git(root: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
    { cwd: root, encoding: "utf8" }
  )
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
  return r.stdout.trim()
}

function tmpProject(): string {
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

function raguelConfigPath(root: string): string {
  return path.join(root, ".raguel", "config.json")
}

// 終了コードにかかわらず stdout と stderr を返す(get --active は成功時にも stderr に書く)
function run(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RAGUEL_CONFIG: raguelConfigPath(cwd) }
  })
  return {
    code: r.status,
    out: r.status === 0 ? JSON.parse(r.stdout) : undefined,
    err: r.stderr
  }
}

// init の必須フラグを既定値で埋める。over で値を替え、null を渡すとそのフラグを省く
function init(
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

function statePath(root: string, slug: string, tryN = 1): string {
  return path.join(root, ".codiel/runs", slug, `try-${tryN}`, "state.json")
}

// codiel 0.x が書いた state version 1 の run を置く
function writeV1(root: string, n: number, status: string): void {
  const dir = path.join(root, ".codiel/runs", `issue-${n}`, "try-1")
  fs.mkdirSync(dir, { recursive: true })
  const pending = {
    status: "pending",
    attempts: 0,
    evaluationId: null,
    verdict: null,
    note: null
  }
  const now = new Date().toISOString()
  const state = {
    version: 1,
    runId: `issue-${n}`,
    try: 1,
    issue: n,
    branch: `codiel/issue-${n}-try-1`,
    raguelRunId: `issue-${n}-try-1`,
    status,
    phase: "design",
    phases: {
      init: { ...pending, status: "passed" },
      design: { ...pending, status: "in_progress" }
    },
    pr: { url: null },
    limits: { maxFixAttempts: 5 },
    stopReason: null,
    incidents: [],
    createdAt: now,
    updatedAt: now
  }
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state))
}

// 設計書 §6.2.4 の文言テンプレート
function v1Message(n: number, status: string): string {
  return `codiel: .codiel/runs/issue-${n} は codiel 0.x の run(state version 1、status: ${status})であり、この版では再開できない。codiel 0.x で完了させるか、\`codiel-state stop --slug issue-${n} --reason migrate\` で止めてから、\`/codiel:run ${n}\` で新しい run を始める。`
}

// --- state v2 の形 ---

test("init は slug から識別子を作り、version 2 の state を書く", () => {
  const root = tmpProject()
  const r = init(root, "demo", {}, ["--base-branch", "main"])
  expect(r.code).toBe(0)
  const st = r.out.state
  expect(st.version).toBe(2)
  expect(st.runId).toBe("demo")
  expect(st.try).toBe(1)
  expect(st.branch).toBe("codiel/demo-try-1")
  expect(st.raguelRunId).toBe("demo-try-1")
  expect(st.intent).toBe("docs/intents/2026-09-27-demo.md")
  expect(st.issue).toBeNull()
  expect(st.integration).toBe("github")
  expect(st.scale).toBe("standard")
  expect(st.adrTarget).toBe("metatron")
  expect(st.imageUpload).toStrictEqual({ ghAttach: true, chrome: true })
  expect(st.baseBranch).toBe("main")
  expect(st.status).toBe("active")
  expect(st.phase).toBeNull()
  expect(st.pr).toStrictEqual({ url: null })
  expect(Object.keys(st.phases)).toStrictEqual([...UNTIL_FINALIZE, "finalize"])
  expect(st.phases.intent.status).toBe("pending")
  expect(r.out.statePath).toBe(statePath(root, "demo"))
  expect(fs.existsSync(statePath(root, "demo"))).toBe(true)
  expect(
    fs.existsSync(path.join(root, ".codiel/runs/demo/try-1/reports"))
  ).toBe(true)
})

test("init --issue は番号を記録し、正の整数でない値を拒否する", () => {
  const root = tmpProject()
  const r = init(root, "demo", { issue: "42" })
  expect(r.code).toBe(0)
  expect(r.out.state.issue).toBe(42)
  for (const bad of ["abc", "0", "-1", "1.5"]) {
    const rb = init(root, `bad-${bad.length}`, { issue: bad })
    expect(rb.code).toBe(1)
    expect(rb.err).toMatch(/不正な --issue/)
  }
})

test("init は --slug と --intent を必須とする", () => {
  const root = tmpProject()
  const noSlug = run(root, [
    "init",
    "--intent",
    "docs/intents/x.md",
    "--integration",
    "github",
    "--scale",
    "standard",
    "--adr-target",
    "metatron",
    "--image-upload",
    "none"
  ])
  expect(noSlug.code).toBe(1)
  expect(noSlug.err).toMatch(/--slug が必要です/)
  const noIntent = init(root, "demo", { intent: null })
  expect(noIntent.code).toBe(1)
  expect(noIntent.err).toMatch(/--intent が必要です/)
  expect(fs.existsSync(path.join(root, ".codiel/runs"))).toBe(false)
})

test("init は --intent に絶対パスを受け付けない", () => {
  const root = tmpProject()
  const r = init(root, "demo", { intent: "/tmp/docs/intents/x.md" })
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/repoRoot 相対/)
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
})

test("init は --intent を正規化して記録し、docs/intents/ 直下の .md 以外を拒否する", () => {
  const root = tmpProject()
  const dotted = init(root, "dotted", {
    intent: "./docs/intents/2026-09-27-dotted.md"
  })
  expect(dotted.code).toBe(0)
  expect(dotted.out.state.intent).toBe("docs/intents/2026-09-27-dotted.md")
  for (const bad of [
    "../docs/intents/x.md",
    "docs/intents/domains/frontend.md",
    "docs/intents/x.txt",
    "docs/x.md",
    "docs/tests/units/src/a.ts/spec.md",
    "src/index.ts"
  ]) {
    const r = init(root, "demo", { intent: bad })
    expect(r.code, bad).toBe(1)
    expect(r.err, bad).toMatch(/docs\/intents\/ 直下の \.md/)
  }
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
})

test("init は slug の書式と 40 文字の上限を守る", () => {
  const root = tmpProject()
  const max = "a".repeat(40)
  expect(init(root, max).code).toBe(0)
  expect(init(root, "a1-b2-c3").code).toBe(0)
  for (const bad of [
    "a".repeat(41),
    "Demo",
    "demo_x",
    "-demo",
    "demo-",
    "de--mo",
    "デモ",
    "../demo"
  ]) {
    const r = init(root, bad)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/不正な --slug/)
  }
  expect(fs.readdirSync(path.join(root, ".codiel/runs")).sort()).toStrictEqual(
    ["a1-b2-c3", max].sort()
  )
})

test("init は issue-<N> の形の slug を拒否し、issue-tracker は受け付ける", () => {
  const root = tmpProject()
  const r = init(root, "issue-12")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/issue-<N> の形は使えません/)
  expect(fs.existsSync(statePath(root, "issue-12"))).toBe(false)
  const ok = init(root, "issue-tracker")
  expect(ok.code).toBe(0)
  expect(ok.out.state.runId).toBe("issue-tracker")
})

test("init は --integration と --scale を必須とし、値域の外を拒否する", () => {
  const root = tmpProject()
  const cases: [Record<string, string | null>, RegExp][] = [
    [{ integration: null }, /--integration が必要です/],
    [{ integration: "gitlab" }, /不正な --integration: gitlab/],
    [{ scale: null }, /--scale が必要です/],
    [{ scale: "heavy" }, /不正な --scale: heavy/]
  ]
  for (const [over, msg] of cases) {
    const r = init(root, "demo", over)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(msg)
  }
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
  const local = init(root, "demo", { integration: "local", scale: "light" })
  expect(local.out.state.integration).toBe("local")
  expect(local.out.state.scale).toBe("light")
})

// --- adrTarget ---

test("init は --adr-target を必須とし、metatron と intents だけを記録する", () => {
  const root = tmpProject()
  const missing = init(root, "demo", { "adr-target": null })
  expect(missing.code).toBe(1)
  expect(missing.err).toMatch(/--adr-target が必要です/)
  const bad = init(root, "demo", { "adr-target": "adr" })
  expect(bad.code).toBe(1)
  expect(bad.err).toMatch(/不正な --adr-target: adr/)
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
  expect(
    init(root, "one", { "adr-target": "metatron" }).out.state.adrTarget
  ).toBe("metatron")
  expect(
    init(root, "two", { "adr-target": "intents" }).out.state.adrTarget
  ).toBe("intents")
  const saved = JSON.parse(fs.readFileSync(statePath(root, "two"), "utf8"))
  expect(saved.adrTarget).toBe("intents")
})

// --- imageUpload ---

test("init は --image-upload の 4 つの値を imageUpload に記録する", () => {
  const root = tmpProject()
  const cases: [string, { ghAttach: boolean; chrome: boolean }][] = [
    ["gh-attach", { ghAttach: true, chrome: false }],
    ["chrome", { ghAttach: false, chrome: true }],
    ["gh-attach,chrome", { ghAttach: true, chrome: true }],
    ["none", { ghAttach: false, chrome: false }]
  ]
  cases.forEach(([value, expected], i) => {
    const r = init(root, `img-${i}`, { "image-upload": value })
    expect(r.code).toBe(0)
    expect(r.out.state.imageUpload).toStrictEqual(expected)
  })
})

test("init は --image-upload の省略と値域の外を拒否する", () => {
  const root = tmpProject()
  const missing = init(root, "demo", { "image-upload": null })
  expect(missing.code).toBe(1)
  expect(missing.err).toMatch(/--image-upload が必要です/)
  for (const bad of ["chrome,gh-attach", "all", "gh-attach,", ""]) {
    const r = init(root, "demo", { "image-upload": bad })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/不正な --image-upload/)
  }
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
})

test("integration が local の run は --image-upload にかかわらず imageUpload を両方 false にする", () => {
  const root = tmpProject()
  for (const [i, value] of [
    "gh-attach",
    "chrome",
    "gh-attach,chrome"
  ].entries()) {
    const r = init(root, `local-${i}`, {
      integration: "local",
      "image-upload": value
    })
    expect(r.code).toBe(0)
    expect(r.out.state.imageUpload).toStrictEqual({
      ghAttach: false,
      chrome: false
    })
  }
  // local でも値域の外は拒否する
  const bad = init(root, "local-bad", {
    integration: "local",
    "image-upload": "all"
  })
  expect(bad.code).toBe(1)
})

test("set-integration は integration と imageUpload を書き換え、local では imageUpload を両方 false にする", () => {
  const root = tmpProject()
  init(root)
  const toLocal = run(root, [
    "set-integration",
    "--slug",
    "demo",
    "--integration",
    "local",
    "--image-upload",
    "gh-attach,chrome"
  ])
  expect(toLocal.code).toBe(0)
  expect(toLocal.out.state.integration).toBe("local")
  expect(toLocal.out.state.imageUpload).toStrictEqual({
    ghAttach: false,
    chrome: false
  })
  const toGithub = run(root, [
    "set-integration",
    "--slug",
    "demo",
    "--integration",
    "github",
    "--image-upload",
    "gh-attach"
  ])
  expect(toGithub.code).toBe(0)
  const saved = run(root, ["get", "--slug", "demo"]).out.state
  expect(saved.integration).toBe("github")
  expect(saved.imageUpload).toStrictEqual({ ghAttach: true, chrome: false })
})

test("set-integration は引数の省略・値域の外・終端の run を拒否する", () => {
  const root = tmpProject()
  init(root)
  const base = ["set-integration", "--slug", "demo"]
  const cases: [string[], RegExp][] = [
    [["--image-upload", "none"], /--integration が必要です/],
    [["--integration", "local"], /--image-upload が必要です/],
    [
      ["--integration", "gitlab", "--image-upload", "none"],
      /不正な --integration/
    ],
    [
      ["--integration", "github", "--image-upload", "both"],
      /不正な --image-upload/
    ]
  ]
  for (const [args, msg] of cases) {
    const r = run(root, [...base, ...args])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(msg)
  }
  expect(run(root, ["get", "--slug", "demo"]).out.state.integration).toBe(
    "github"
  )
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  const stopped = run(root, [
    ...base,
    "--integration",
    "local",
    "--image-upload",
    "none"
  ])
  expect(stopped.code).toBe(1)
  expect(stopped.err).toMatch(/すでに終端状態です/)
})

// --- init の try と domainMode ---

test("init --domain-mode はモードを記録し、未指定ならキーを持たせない", () => {
  const root = tmpProject()
  const mapped = init(root, "one", {}, ["--domain-mode", "mapped"])
  const unscoped = init(root, "two", {}, ["--domain-mode", "unscoped"])
  const unspecified = init(root, "three")
  expect(mapped.out.state.domainMode).toBe("mapped")
  expect(unscoped.out.state.domainMode).toBe("unscoped")
  const saved = ["one", "two", "three"].map((s) =>
    JSON.parse(fs.readFileSync(statePath(root, s), "utf8"))
  )
  expect(saved[0].domainMode).toBe("mapped")
  expect(saved[1].domainMode).toBe("unscoped")
  expect("domainMode" in saved[2]).toBe(false)
  expect(unspecified.out.state.version).toBe(2)
})

test("init --domain-mode は不正値を拒否して state.json を作らない", () => {
  const root = tmpProject()
  const r = init(root, "demo", {}, ["--domain-mode", "invalid"])
  expect(r.code).toBe(1)
  expect(r.err).toContain("invalid")
  expect(r.err).toContain("mapped")
  expect(r.err).toContain("unscoped")
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
})

test("未完了 try がある間は init が失敗する", () => {
  const root = tmpProject()
  init(root)
  const r = init(root)
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/未完了/)
})

test("終端状態(stopped)なら init が try-2 を作成する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  const r = init(root)
  expect(r.code).toBe(0)
  expect(r.out.state.try).toBe(2)
  expect(r.out.state.branch).toBe("codiel/demo-try-2")
  expect(r.out.state.raguelRunId).toBe("demo-try-2")
  expect(fs.existsSync(statePath(root, "demo", 2))).toBe(true)
})

// --- get / stop と --slug ---

test("get は最新 try の state を返す", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["get", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.runId).toBe("demo")
})

test("get --active はアクティブな v2 の run の一覧を返す", () => {
  const root = tmpProject()
  init(root, "one")
  init(root, "two")
  run(root, ["stop", "--slug", "two", "--reason", "test"])
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(
    r.out.runs.map((x: { state: { runId: string } }) => x.state.runId)
  ).toStrictEqual(["one"])
  expect(r.err).toBe("")
})

test("stop は終端状態のときに失敗する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  const r = run(root, ["stop", "--slug", "demo", "--reason", "test again"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/すでに終端状態です/)
})

test("stop --reason intent-updated は stopReason に記録される", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["stop", "--slug", "demo", "--reason", "intent-updated"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("stopped")
  expect(r.out.state.stopReason).toBe("intent-updated")
})

test("--slug の省略・不正な形・存在しない run はどのコマンドでも失敗する", () => {
  const root = tmpProject()
  const noRun = run(root, ["set-domain", "--slug", "nope", "--domain", "web"])
  expect(noRun.code).toBe(1)
  expect(noRun.err).toMatch(/run が存在しません: nope/)
  const noRunClear = run(root, ["clear-domain", "--slug", "nope"])
  expect(noRunClear.code).toBe(1)
  expect(noRunClear.err).toMatch(/run が存在しません: nope/)
  const noSlug = run(root, ["set-domain", "--domain", "web"])
  expect(noSlug.code).toBe(1)
  expect(noSlug.err).toMatch(/--slug が必要です/)
  const noSlugClear = run(root, ["clear-domain"])
  expect(noSlugClear.code).toBe(1)
  expect(noSlugClear.err).toMatch(/--slug が必要です/)
  const traversal = run(root, ["get", "--slug", "../demo"])
  expect(traversal.code).toBe(1)
  expect(traversal.err).toMatch(/不正な --slug/)
})

// --- フェーズ列とゲート ---

test("STAGES は 13 ステージで、intent-sync が test-loop と pr の間のゲート対象フェーズである", () => {
  expect(STAGES).toStrictEqual([
    ["intent"],
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
  ])
  expect([...GATED].sort()).toStrictEqual([
    "design",
    "dev-plan",
    "fix-loop",
    "implement",
    "intent",
    "intent-sync",
    "test-code",
    "test-loop",
    "test-spec"
  ])
  expect([...SKIPPABLE].sort()).toStrictEqual(["design", "discuss", "fix-loop"])
})

// --- テスト駆動のフェーズ(設計書 §6.1.1・§6.13.2、A6-1) ---

test("STAGES の 5 番目が test-code で、GATED に含まれ SKIPPABLE に含まれない", () => {
  expect(STAGES[4]).toStrictEqual(["test-code"])
  expect(GATED.has("test-code")).toBe(true)
  expect(SKIPPABLE.has("test-code")).toBe(false)
})

test("test-code が passed でないと start-phase implement が失敗し、pass-gate test-code の後に開始できる", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  const pending = run(root, ["start-phase", "implement", "--slug", "demo"])
  expect(pending.code).toBe(1)
  expect(pending.err).toMatch(/前フェーズが未完了です: test-code\(pending\)/)
  expect(run(root, ["start-phase", "test-code", "--slug", "demo"]).code).toBe(0)
  const inProgress = run(root, ["start-phase", "implement", "--slug", "demo"])
  expect(inProgress.code).toBe(1)
  expect(inProgress.err).toMatch(/test-code\(in_progress\)/)
  const complete = run(root, ["complete-phase", "test-code", "--slug", "demo"])
  expect(complete.code).toBe(1)
  expect(complete.err).toMatch(/ゲート対象フェーズです/)
  expect(passGate(root, "test-code", "PROCEED").code).toBe(0)
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(0)
})

test("skip-phase test-code は軽量の run でも失敗し、test-code を pending のまま残す", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  passThrough(root, "demo", ["intent"])
  for (const ph of ["discuss", "design"])
    run(root, ["skip-phase", ph, "--slug", "demo", "--reason", "軽量"])
  passThrough(root, "demo", ["test-spec", "dev-plan"])
  const r = run(root, [
    "skip-phase",
    "test-code",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/test-code はスキップできません/)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.phases["test-code"].status).toBe("pending")
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(1)
})

test("intent-sync は pass-gate で通し、通るまで pr を開始できない", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, -1))
  const early = run(root, ["start-phase", "pr", "--slug", "demo"])
  expect(early.code).toBe(1)
  expect(early.err).toMatch(/intent-sync/)
  expect(run(root, ["start-phase", "intent-sync", "--slug", "demo"]).code).toBe(
    0
  )
  const complete = run(root, [
    "complete-phase",
    "intent-sync",
    "--slug",
    "demo"
  ])
  expect(complete.code).toBe(1)
  expect(complete.err).toMatch(/ゲート対象フェーズです/)
  recordEvaluation(root, "demo", "intent-sync", "PROCEED", "e1")
  const gate = run(root, [
    "pass-gate",
    "intent-sync",
    "--slug",
    "demo",
    "--evaluation-id",
    "e1",
    "--verdict",
    "PROCEED"
  ])
  expect(gate.code).toBe(0)
  expect(run(root, ["start-phase", "pr", "--slug", "demo"]).code).toBe(0)
})

test("start-phase は前ステージ未passedなら失敗する", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["start-phase", "design", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/intent/)
})

test("GATEDフェーズは pass-gate(PROCEED)でのみ passed になる", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  let r = passGate(root, "intent", "ASK")
  expect(r.code).toBe(1)
  r = run(root, ["complete-phase", "intent", "--slug", "demo"])
  expect(r.code).toBe(1) // GATED に complete-phase は使えない
  r = passGate(root, "intent", "PROCEED")
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.status).toBe("passed")
  expect(r.out.state.phases.intent.evaluationId).toBe("ev1")
})

test("pass-gate は --human-approved 指定時に ASK を受理し humanApproved を記録する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const r = passGate(root, "intent", "ASK", ["--human-approved"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.status).toBe("passed")
  expect(r.out.state.phases.intent.verdict).toBe("ASK")
  expect(r.out.state.phases.intent.humanApproved).toBe(true)
})

test("--human-approved で passed になったフェーズの次フェーズを start-phase できる", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  passGate(root, "intent", "ASK", ["--human-approved"])
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
})

test("並列ステージ(test-spec/dev-plan)は design passed 後に両方 start できる", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent", "discuss", "design"])
  expect(run(root, ["start-phase", "test-spec", "--slug", "demo"]).code).toBe(0)
  expect(run(root, ["start-phase", "dev-plan", "--slug", "demo"]).code).toBe(0)
  // 片方だけ passed では implement に進めない
  passGate(root, "test-spec", "PROCEED")
  expect(run(root, ["start-phase", "implement", "--slug", "demo"]).code).toBe(1)
})

test("discuss は intent passed 後に start でき、complete-phase で passed になる(pass-gate は拒否)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
  const rGate = passGate(root, "discuss", "PROCEED")
  expect(rGate.code).toBe(1)
  expect(rGate.err).toMatch(/ゲート対象フェーズではありません/)
  const r = run(root, ["complete-phase", "discuss", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.discuss.status).toBe("passed")
})

test("design は discuss が passed になるまで start できない", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  const r = run(root, ["start-phase", "design", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/discuss/)
})

test("不正なフェーズ名は complete-phase・mark-ask・record-attempt・skip-phase・start-phase で拒否される", () => {
  const root = tmpProject()
  init(root)
  for (const args of [
    ["complete-phase", "bogus"],
    ["mark-ask", "bogus", "--evaluation-id", "e"],
    ["record-attempt", "bogus"],
    ["skip-phase", "bogus", "--reason", "理由"],
    ["start-phase", "init"]
  ]) {
    const r = run(root, [...args, "--slug", "demo"])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/不正なフェーズ/)
  }
})

// --- 軽量の経路 ---

test("軽量の run は discuss と design を skip でき、続けて test-spec と dev-plan を開始できる", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  passThrough(root, "demo", ["intent"])
  for (const ph of ["discuss", "design"]) {
    const r = run(root, [
      "skip-phase",
      ph,
      "--slug",
      "demo",
      "--reason",
      "軽量"
    ])
    expect(r.code).toBe(0)
    expect(r.out.state.phases[ph].status).toBe("passed")
    expect(r.out.state.phases[ph].verdict).toBe("SKIPPED")
    expect(r.out.state.phases[ph].note).toBe("軽量")
  }
  expect(run(root, ["start-phase", "test-spec", "--slug", "demo"]).code).toBe(0)
  expect(run(root, ["start-phase", "dev-plan", "--slug", "demo"]).code).toBe(0)
})

test("標準の run では discuss と design の skip が失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  const discuss = run(root, [
    "skip-phase",
    "discuss",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(discuss.code).toBe(1)
  expect(discuss.err).toMatch(/scale が light の run だけ/)
  passThrough(root, "demo", ["discuss"])
  const design = run(root, [
    "skip-phase",
    "design",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(design.code).toBe(1)
  expect(design.err).toMatch(/scale が light の run だけ/)
  expect(
    run(root, ["get", "--slug", "demo"]).out.state.phases.design.status
  ).toBe("pending")
})

test("skip-phase fix-loop は review まで passed なら passed/verdict SKIPPED にでき、続けて triage を start できる", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_REVIEW)
  const r = run(root, [
    "skip-phase",
    "fix-loop",
    "--slug",
    "demo",
    "--reason",
    "critical/high ゼロ"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases["fix-loop"].status).toBe("passed")
  expect(r.out.state.phases["fix-loop"].verdict).toBe("SKIPPED")
  expect(r.out.state.phases["fix-loop"].note).toBe("critical/high ゼロ")
  expect(run(root, ["start-phase", "triage", "--slug", "demo"]).code).toBe(0)
})

test("skip-phase は SKIPPABLE 以外のフェーズと --reason の省略で失敗する", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  const notSkippable = run(root, [
    "skip-phase",
    "implement",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(notSkippable.code).toBe(1)
  expect(notSkippable.err).toMatch(/スキップできません/)
  passThrough(root, "demo", ["intent"])
  const noReason = run(root, ["skip-phase", "discuss", "--slug", "demo"])
  expect(noReason.code).toBe(1)
  expect(noReason.err).toMatch(/--reason が必要です/)
})

test("skip-phase fix-loop は review が passed でない状態では失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", [...UNTIL_PR, "pr"])
  run(root, ["start-phase", "review", "--slug", "demo"]) // review は in_progress のまま
  const r = run(root, [
    "skip-phase",
    "fix-loop",
    "--slug",
    "demo",
    "--reason",
    "理由"
  ])
  expect(r.code).toBe(1)
})

// --- 文書だけで終える run ---

test("init --intent-only の run は branch が null で、intent の pass-gate の後に close で completed になる", () => {
  const root = tmpProject()
  const created = init(root, "demo", {}, ["--intent-only"])
  expect(created.code).toBe(0)
  expect(created.out.state.branch).toBeNull()
  expect(created.out.state.raguelRunId).toBe("demo-try-1")
  passThrough(root, "demo", ["intent"])
  const r = run(root, ["close", "--slug", "demo", "--reason", "intent-only"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("completed")
  expect(r.out.state.stopReason).toBe("intent-only")
  expect(r.out.state.phase).toBe("intent")
  const again = run(root, [
    "close",
    "--slug",
    "demo",
    "--reason",
    "intent-only"
  ])
  expect(again.code).toBe(1)
  expect(again.err).toMatch(/すでに終端状態です/)
})

test("branch が null の run では intent 以外の start-phase が失敗する", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--intent-only"])
  const before = run(root, ["start-phase", "discuss", "--slug", "demo"])
  expect(before.code).toBe(1)
  expect(before.err).toMatch(/branch が null/)
  passThrough(root, "demo", ["intent"])
  const after = run(root, ["start-phase", "discuss", "--slug", "demo"])
  expect(after.code).toBe(1)
  expect(after.err).toMatch(/branch が null/)
  expect(
    run(root, ["get", "--slug", "demo"]).out.state.phases.discuss.status
  ).toBe("pending")
})

test("branch が null の run では skip-phase が失敗し、close できる状態を保つ", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" }, ["--intent-only"])
  passThrough(root, "demo", ["intent"])
  for (const ph of ["discuss", "design"]) {
    const r = run(root, [
      "skip-phase",
      ph,
      "--slug",
      "demo",
      "--reason",
      "軽量"
    ])
    expect(r.code, ph).toBe(1)
    expect(r.err, ph).toMatch(/branch が null/)
  }
  expect(
    run(root, ["get", "--slug", "demo"]).out.state.phases.discuss.status
  ).toBe("pending")
  expect(run(root, ["close", "--slug", "demo"]).code).toBe(0)
})

test("close は intent が passed でないと失敗する", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--intent-only"])
  const pending = run(root, ["close", "--slug", "demo"])
  expect(pending.code).toBe(1)
  expect(pending.err).toMatch(/intent が passed ではありません/)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const inProgress = run(root, ["close", "--slug", "demo"])
  expect(inProgress.code).toBe(1)
  expect(inProgress.err).toMatch(/intent が passed ではありません/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
})

test("close は branch が null でない run では失敗する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent"])
  const r = run(root, ["close", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/branch が null の run/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
})

test("close は intent 以外のフェーズが pending でないと失敗する", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" }, ["--intent-only"])
  passThrough(root, "demo", ["intent"])
  // branch が null の run は CLI では discuss を動かせない(start-phase も skip-phase も拒否する)
  // ので、state.json を直接書き換えて close の検査だけを確かめる
  const raw = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
  raw.phases.discuss.status = "passed"
  fs.writeFileSync(statePath(root, "demo"), `${JSON.stringify(raw, null, 2)}\n`)
  const r = run(root, ["close", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/フェーズ discuss が pending ではありません/)
})

// --- pr と finalize ---

test("github の run では pr フェーズの complete-phase に --pr-url が必要である", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR)
  run(root, ["start-phase", "pr", "--slug", "demo"])
  const noUrl = run(root, ["complete-phase", "pr", "--slug", "demo"])
  expect(noUrl.code).toBe(1)
  expect(noUrl.err).toMatch(/--pr-url が必要です/)
  const r = run(root, [
    "complete-phase",
    "pr",
    "--slug",
    "demo",
    "--pr-url",
    "https://example.test/pr/1"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.pr.url).toBe("https://example.test/pr/1")
})

test("local の run では --pr-url なしで complete-phase pr が成功し、pr.url は null のまま", () => {
  const root = tmpProject()
  init(root, "demo", { integration: "local", "image-upload": "none" })
  passThrough(root, "demo", UNTIL_PR)
  run(root, ["start-phase", "pr", "--slug", "demo"])
  const r = run(root, ["complete-phase", "pr", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.pr.status).toBe("passed")
  expect(r.out.state.pr.url).toBeNull()
})

test("finalize は全フェーズ passed 後のみ成功し awaiting_outcome にする", () => {
  const root = tmpProject()
  init(root)
  expect(run(root, ["finalize", "--slug", "demo"]).code).toBe(1)
  passThrough(root, "demo", UNTIL_FINALIZE)
  const r = run(root, ["finalize", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_outcome")
  expect(r.out.state.phases.finalize.status).toBe("passed")
})

test("record-outcome approved は completed にする", () => {
  const root = tmpProject()
  init(root)
  expect(
    run(root, ["record-outcome", "--slug", "demo", "--outcome", "approved"])
      .code
  ).toBe(1)
  fullRun(root, "demo")
  const r = run(root, [
    "record-outcome",
    "--slug",
    "demo",
    "--outcome",
    "approved"
  ])
  expect(r.out.state.status).toBe("completed")
})

test("record-attempt は上限超過で exit 3 + awaiting_human", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  for (let i = 0; i < 5; i++)
    expect(run(root, ["record-attempt", "intent", "--slug", "demo"]).code).toBe(
      0
    )
  const r = run(root, ["record-attempt", "intent", "--slug", "demo"])
  expect(r.code).toBe(3)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe(
    "awaiting_human"
  )
})

// --- mark-ask --kind ---

test("mark-ask は --kind を省くと askKind を raguel にし、resume の後も残す", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "ASK", "e1")
  let r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--evaluation-id",
    "e1"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.askKind).toBe("raguel")
  r = run(root, ["resume", "--slug", "demo"])
  expect(r.out.state.status).toBe("active")
  expect(r.out.state.phases.intent.status).toBe("in_progress")
  expect(r.out.state.phases.intent.askKind).toBe("raguel")
})

test("mark-ask --kind confirm は askKind を confirm にし、それ以外の値を拒否する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  for (const bad of ["human", "RAGUEL"]) {
    const r = run(root, ["mark-ask", "intent", "--slug", "demo", "--kind", bad])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/不正な --kind/)
  }
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
  const r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "confirm"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.askKind).toBe("confirm")
  expect(r.out.state.phases.intent.evaluationId).toBeNull()
  const resumed = run(root, ["resume", "--slug", "demo"])
  expect(resumed.out.state.phases.intent.askKind).toBe("confirm")
})

test("finalize で mark-ask → resume した後に codiel-state finalize が成功する", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_FINALIZE)
  const asked = run(root, [
    "mark-ask",
    "finalize",
    "--slug",
    "demo",
    "--kind",
    "confirm"
  ])
  expect(asked.code).toBe(0)
  const resumed = run(root, ["resume", "--slug", "demo"])
  expect(resumed.out.state.phases.finalize.status).toBe("in_progress")
  const r = run(root, ["finalize", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_outcome")
  expect(r.out.state.phases.finalize.status).toBe("passed")
  expect(r.out.state.phases.finalize.askKind).toBe("confirm")
})

test("mark-ask は passed と skip 済みのフェーズを拒否し、ゲートの記録を残す", () => {
  const root = tmpProject()
  init(root, "demo", { scale: "light" })
  passThrough(root, "demo", ["intent"])
  run(root, ["skip-phase", "discuss", "--slug", "demo", "--reason", "軽量"])
  for (const ph of ["intent", "discuss"]) {
    const r = run(root, ["mark-ask", ph, "--slug", "demo", "--kind", "confirm"])
    expect(r.code, ph).toBe(1)
    expect(r.err, ph).toMatch(/passed のため mark-ask できません/)
  }
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.intent.status).toBe("passed")
  expect(st.phases.intent.evaluationId).toBe("e-intent")
  expect(st.phases.intent.verdict).toBe("PROCEED")
  expect(st.phases.discuss.status).toBe("passed")
  expect(st.phases.discuss.verdict).toBe("SKIPPED")
})

test("mark-ask は finalize 以外の pending のフェーズを拒否し、start-phase の迂回を許さない", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--intent-only"])
  const beforeStart = run(root, ["mark-ask", "intent", "--slug", "demo"])
  expect(beforeStart.code).toBe(1)
  expect(beforeStart.err).toMatch(/pending のため mark-ask できません/)
  passThrough(root, "demo", ["intent"])
  // branch が null の run の implement は start-phase が拒否する。mark-ask → resume でも進めない
  const r = run(root, ["mark-ask", "implement", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/pending のため mark-ask できません/)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.implement.status).toBe("pending")
})

test("mark-ask は終端の run を拒否し、run を生き返らせない", () => {
  const root = tmpProject()
  // completed(文書だけで終えた run)
  init(root, "closed", {}, ["--intent-only"])
  passThrough(root, "closed", ["intent"])
  run(root, ["close", "--slug", "closed", "--reason", "intent-only"])
  // stopped
  init(root, "stopped")
  run(root, ["start-phase", "intent", "--slug", "stopped"])
  run(root, ["stop", "--slug", "stopped", "--reason", "test"])
  // awaiting_outcome(finalize は passed)
  init(root, "demo")
  fullRun(root, "demo")
  for (const [slug, phase, status] of [
    ["closed", "intent", "completed"],
    ["stopped", "intent", "stopped"],
    ["demo", "finalize", "awaiting_outcome"]
  ]) {
    const r = run(root, [
      "mark-ask",
      phase,
      "--slug",
      slug,
      "--kind",
      "confirm"
    ])
    expect(r.code, slug).toBe(1)
    expect(r.err, slug).toMatch(/すでに終端状態です/)
    expect(run(root, ["get", "--slug", slug]).out.state.status, slug).toBe(
      status
    )
  }
})

// --- Raguel の STOP の裁定と次の try(決定 83、A6-27) ---

test("mark-ask --verdict はフェーズの verdict に記録し、省略時は ASK にし、PROCEED・ASK・STOP 以外を拒否する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  for (const bad of ["stop", "SKIPPED", "FOO"]) {
    const r = run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "demo",
      "--verdict",
      bad
    ])
    expect(r.code, bad).toBe(1)
    expect(r.err, bad).toMatch(/不正な --verdict/)
  }
  let st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.status).toBe("active")
  expect(st.phases.intent.verdict).toBeNull()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  let r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--evaluation-id",
    "ev-ask"
  ])
  expect(r.out.state.phases.intent.verdict).toBe("ASK")
  run(root, ["resume", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-proceed")
  r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--verdict",
    "PROCEED",
    "--evaluation-id",
    "ev-proceed"
  ])
  expect(r.out.state.phases.intent.verdict).toBe("PROCEED")
  run(root, ["resume", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  r = run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  expect(r.code).toBe(0)
  expect(r.out.state.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.status).toBe("awaiting_human")
  expect(r.out.state.phases.intent.verdict).toBe("STOP")
  expect(r.out.state.phases.intent.askKind).toBe("raguel")
  expect(r.out.state.phases.intent.evaluationId).toBe("ev-stop")
  // resume の後も STOP が残る
  st = run(root, ["resume", "--slug", "demo"]).out.state
  expect(st.phases.intent.verdict).toBe("STOP")
})

test("pass-gate --verdict STOP は --human-approved のときだけ受け付け、STOP を記録したフェーズは --human-approved なしで上書きできない", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  let r = passGate(root, "intent", "STOP")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/verdict が PROCEED ではありません: STOP/)
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  run(root, ["resume", "--slug", "demo"])
  for (const verdict of ["PROCEED", "ASK"]) {
    r = passGate(root, "intent", verdict)
    expect(r.code, verdict).toBe(1)
    expect(r.err, verdict).toMatch(
      /フェーズ intent には Raguel の STOP が記録されています/
    )
  }
  let st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.phases.intent.status).toBe("in_progress")
  expect(st.phases.intent.verdict).toBe("STOP")
  expect(st.phases.intent.humanApproved).toBeUndefined()
  r = passGate(root, "intent", "FOO", ["--human-approved"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正な --verdict: FOO/)
  r = passGate(root, "intent", "STOP", ["--human-approved"])
  expect(r.code).toBe(0)
  st = r.out.state
  expect(st.phases.intent.status).toBe("passed")
  expect(st.phases.intent.verdict).toBe("STOP")
  expect(st.phases.intent.humanApproved).toBe(true)
  expect(st.phases.intent.evaluationId).toBe("ev1")
  expect(run(root, ["start-phase", "discuss", "--slug", "demo"]).code).toBe(0)
})

test("STOP を記録したフェーズは、resume の後の mark-ask --kind confirm でも STOP のまま残り、--human-approved の無い pass-gate は失敗する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  // --verdict の有無と値にかかわらず、記録済みの STOP を上書きしない
  for (const extra of [[], ["--verdict", "PROCEED"]]) {
    run(root, ["resume", "--slug", "demo"])
    const r = run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "demo",
      "--kind",
      "confirm",
      ...extra
    ])
    const label = extra.join(" ") || "--verdict なし"
    expect(r.code, label).toBe(0)
    expect(r.out.state.phases.intent.verdict, label).toBe("STOP")
    expect(r.out.state.phases.intent.askKind, label).toBe("confirm")
  }
  run(root, ["resume", "--slug", "demo"])
  const r = passGate(root, "intent", "PROCEED")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /フェーズ intent には Raguel の STOP が記録されています/
  )
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.phases.intent.status).toBe("in_progress")
  expect(st.phases.intent.verdict).toBe("STOP")
  expect(st.phases.intent.humanApproved).toBeUndefined()
})

test("STOP を記録したフェーズは、resume の後の --evaluation-id の無い mark-ask --kind confirm でも STOP の evaluationId を残す(新しい --evaluation-id を渡しても上書きしない)", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  run(root, [
    "mark-ask",
    "intent",
    "--slug",
    "demo",
    "--kind",
    "raguel",
    "--verdict",
    "STOP",
    "--evaluation-id",
    "ev-stop"
  ])
  for (const extra of [[], ["--evaluation-id", "ev-new"]]) {
    run(root, ["resume", "--slug", "demo"])
    const r = run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "demo",
      "--kind",
      "confirm",
      ...extra
    ])
    const label = extra.join(" ") || "--evaluation-id なし"
    expect(r.code, label).toBe(0)
    expect(r.out.state.phases.intent.verdict, label).toBe("STOP")
    expect(r.out.state.phases.intent.evaluationId, label).toBe("ev-stop")
  }
})

test("init は、最新の try が raguel-stop で止まったか humanApproved の無い STOP のフェーズを持つとき --human-approved を求め、どちらでもなければ従来どおり作る", () => {
  const root = tmpProject()
  const markStop = (slug: string) => {
    run(root, ["start-phase", "intent", "--slug", slug])
    recordEvaluation(root, slug, "intent", "STOP", `ev-stop-${slug}`)
    run(root, [
      "mark-ask",
      "intent",
      "--slug",
      slug,
      "--kind",
      "raguel",
      "--verdict",
      "STOP",
      "--evaluation-id",
      `ev-stop-${slug}`
    ])
  }
  // raguel-stop で止めた try
  init(root, "judged")
  markStop("judged")
  run(root, ["stop", "--slug", "judged", "--reason", "raguel-stop"])
  // STOP を記録した後に別の理由で止めた try
  init(root, "other")
  markStop("other")
  run(root, ["stop", "--slug", "other", "--reason", "intent-updated"])
  for (const slug of ["judged", "other"]) {
    const r = init(root, slug)
    expect(r.code, slug).toBe(1)
    expect(r.err, slug).toMatch(/Raguel の STOP で止まっています/)
    expect(r.err, slug).toMatch(/--human-approved を付けて init し直して/)
    expect(fs.existsSync(statePath(root, slug, 2)), slug).toBe(false)
  }
  expect(init(root, "other").err).toMatch(
    /stopReason: intent-updated、STOP のフェーズ: intent\(evaluationId: ev-stop-other\)/
  )
  for (const slug of ["judged", "other"]) {
    const r = init(root, slug, {}, ["--human-approved"])
    expect(r.code, slug).toBe(0)
    expect(r.out.state.try, slug).toBe(2)
  }

  // 人が誤検知と裁定した STOP(humanApproved あり)と、ASK のまま止めた try には当たらない
  init(root, "approved")
  markStop("approved")
  run(root, ["resume", "--slug", "approved"])
  recordRuling(root, "approved", "intent", "ev-stop-approved", "false-positive")
  const approved = run(root, [
    "pass-gate",
    "intent",
    "--slug",
    "approved",
    "--evaluation-id",
    "ev-stop-approved",
    "--verdict",
    "STOP",
    "--human-approved"
  ])
  expect(approved.code).toBe(0)
  run(root, ["stop", "--slug", "approved", "--reason", "test"])
  init(root, "asked")
  run(root, ["start-phase", "intent", "--slug", "asked"])
  recordEvaluation(root, "asked", "intent", "ASK", "ev-ask-asked")
  expect(
    run(root, [
      "mark-ask",
      "intent",
      "--slug",
      "asked",
      "--evaluation-id",
      "ev-ask-asked"
    ]).code
  ).toBe(0)
  run(root, ["stop", "--slug", "asked", "--reason", "test"])
  for (const slug of ["approved", "asked"]) {
    const r = init(root, slug)
    expect(r.code, slug).toBe(0)
    expect(r.out.state.try, slug).toBe(2)
  }
})

// --- Raguel の記録との照合(Raguel 設計書 §6.13.3、所見 D1・D4、R11・R16) ---

test("init は、STOP を state に記録しないまま止めた try でも、Raguel の索引の STOP を見て --human-approved を求める(D1)", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  // mark-ask を経ずに stop した(state には STOP が無い)
  recordEvaluation(root, "demo", "intent", "STOP", "ev-hidden")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(latestState(root, "demo").phases.intent.verdict).toBeNull()
  const r = init(root)
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/誤検知の裁定の無い Raguel の STOP があります/)
  expect(r.err).toMatch(/ev-hidden/)
  expect(fs.existsSync(statePath(root, "demo", 2))).toBe(false)
  // 誤検知の裁定があれば当たらない
  recordRuling(root, "demo", "intent", "ev-hidden", "false-positive")
  expect(init(root).code).toBe(0)
  // --human-approved があれば、裁定が無くても作る
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-hidden-2")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(init(root).code).toBe(1)
  const approved = init(root, "demo", {}, ["--human-approved"])
  expect(approved.code).toBe(0)
  expect(approved.out.state.try).toBe(3)
})

test("init は、degraded の STOP・別の run の STOP・revise の裁定のある ASK では --human-approved を求めない", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  recordEvaluation(root, "demo", "intent", "STOP", "ev-degraded", {
    judgeStatus: "degraded"
  })
  recordEvaluation(root, "demo", "intent", "STOP", "ev-other-run", {
    runId: "other-try-1"
  })
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  recordRuling(root, "demo", "intent", "ev-ask", "revise", "rejected")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(init(root).code).toBe(0)
})

test("init は新しい state に raguelContract: 2 を記録する", () => {
  const root = tmpProject()
  const r = init(root)
  expect(r.code).toBe(0)
  expect(r.out.state.raguelContract).toBe(2)
  expect(latestState(root, "demo").raguelContract).toBe(2)
})

test("start-phase は code 系の 4 フェーズでだけ開始の HEAD を startHead に記録し、開始し直しても書き換えない", () => {
  const root = tmpProject()
  init(root)
  const head0 = git(root, "rev-parse", "HEAD")
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  expect(run(root, ["start-phase", "test-code", "--slug", "demo"]).code).toBe(0)
  git(root, "commit", "-q", "--allow-empty", "-m", "c1")
  // in_progress のフェーズを開始し直しても、起点は動かない
  expect(run(root, ["start-phase", "test-code", "--slug", "demo"]).code).toBe(0)
  let st = latestState(root, "demo")
  expect(st.phases["test-code"].startHead).toBe(head0)
  expect(st.phases["test-code"].startHead).toMatch(/^[0-9a-f]{40}$/)
  for (const ph of ["intent", "design", "test-spec", "dev-plan"])
    expect(st.phases[ph].startHead, ph).toBeUndefined()
  expect(passGate(root, "test-code", "PROCEED").code).toBe(0)
  const head1 = git(root, "rev-parse", "HEAD")
  passThrough(root, "demo", ["implement", "test-loop", "intent-sync"])
  passThrough(root, "demo", ["pr", "review", "fix-loop"])
  st = latestState(root, "demo")
  for (const ph of ["implement", "test-loop", "fix-loop"])
    expect(st.phases[ph].startHead, ph).toBe(head1)
  expect(st.phases["intent-sync"].startHead).toBeUndefined()
})

test("start-phase は code 系フェーズで HEAD を読めなければ失敗し、フェーズを開始しない", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true })
  const r = run(root, ["start-phase", "test-code", "--slug", "demo"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/開始の HEAD を読めません/)
  expect(latestState(root, "demo").phases["test-code"].status).toBe("pending")
})

// pass-gate の検査の入口。intent を in_progress にした run を作る
function gateRun(): string {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  return root
}

function gateArgs(phase: string, id: string, verdict: string): string[] {
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

test("pass-gate 検査 1: 索引に --evaluation-id の行が無ければ失敗する(掃除済みか存在しない)", () => {
  const root = gateRun()
  const r = run(root, gateArgs("intent", "ev-missing", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/evaluationId ev-missing の行がありません/)
  expect(r.err).toMatch(/掃除済みか、存在しない/)
  expect(latestState(root, "demo").phases.intent.status).toBe("in_progress")
})

test("pass-gate 検査 2: 行の runId が raguelRunId と、phase がコマンドのフェーズと違えば失敗する", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-run", {
    runId: "other-try-1"
  })
  let r = run(root, gateArgs("intent", "ev-run", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/別の run かフェーズの評価です/)
  recordEvaluation(root, "demo", "design", "PROCEED", "ev-phase")
  r = run(root, gateArgs("intent", "ev-phase", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/phase design/)
})

test("pass-gate 検査 3: 後の評価で ASK が出た後に、前の PROCEED では通せない", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-old")
  recordEvaluation(root, "demo", "intent", "ASK", "ev-new")
  const r = run(root, gateArgs("intent", "ev-old", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /最新の評価ではありません\(最新: ev-new、verdict: ASK\)/
  )
})

test("pass-gate 検査 4: ASK の評価に --verdict PROCEED を付けても通せない(D4)", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  const r = run(root, gateArgs("intent", "ev-ask", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /--verdict PROCEED が Raguel の評価の verdict ASK と合いません/
  )
  expect(latestState(root, "demo").phases.intent.status).toBe("in_progress")
})

test("pass-gate 検査 5: verdict.json が読めないか、索引の行と食い違えば失敗する", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-none", {
    noVerdictJson: true
  })
  let r = run(root, gateArgs("intent", "ev-none", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/verdict.json を読めません/)
  for (const [key, value] of [
    ["verdict", "STOP"],
    ["evaluationId", "ev-x"],
    ["runId", "x-try-1"],
    ["phase", "design"]
  ]) {
    recordEvaluation(root, "demo", "intent", "PROCEED", `ev-${key}`, {
      verdictJson: { [key]: value }
    })
    r = run(root, gateArgs("intent", `ev-${key}`, "PROCEED"))
    expect(r.code, key).toBe(1)
    expect(r.err, key).toMatch(new RegExp(`verdict.json の ${key}`))
  }
})

test("pass-gate 検査 6: --human-approved が無ければ PROCEED の評価だけを通す", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  const r = run(root, gateArgs("intent", "ev-ask", "ASK"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/verdict が PROCEED ではありません: ASK/)
})

test("pass-gate 検査 7: --human-approved には裁定の記録が要り、ASK は as-is、STOP は false-positive だけを受ける", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "ASK", "ev-ask")
  const approve = (id: string, verdict: string) =>
    run(root, [...gateArgs("intent", id, verdict), "--human-approved"])
  let r = approve("ev-ask", "ASK")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/裁定の記録が要ります/)
  recordRuling(root, "demo", "intent", "ev-ask", "revise", "rejected")
  r = approve("ev-ask", "ASK")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/ruling が as-is であることが要ります\(記録: revise\)/)
  recordEvaluation(root, "demo", "intent", "STOP", "ev-stop")
  recordRuling(root, "demo", "intent", "ev-stop", "as-is")
  r = approve("ev-stop", "STOP")
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/ruling が false-positive であることが要ります/)
  // 同じ evaluationId の行は後の行を正とする
  recordRuling(root, "demo", "intent", "ev-stop", "false-positive")
  r = approve("ev-stop", "STOP")
  expect(r.code).toBe(0)
  expect(r.out.state.phases.intent.humanApproved).toBe(true)
})

// test-code を in_progress にした run(開始の HEAD を記録済み)
function codeRun(): string {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, 5))
  run(root, ["start-phase", "test-code", "--slug", "demo"])
  return root
}

test("pass-gate 検査 8: code 系フェーズで subject.head が今の HEAD と違えば失敗する(評価の後のコミット)", () => {
  const root = codeRun()
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-tc")
  git(root, "commit", "-q", "--allow-empty", "-m", "after")
  const r = run(root, gateArgs("test-code", "ev-tc", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/現在の HEAD/)
})

test("pass-gate 検査 8: code 系フェーズで subject.base がフェーズの開始の HEAD と違えば失敗する(R16)", () => {
  const root = codeRun()
  const start = latestState(root, "demo").phases["test-code"].startHead
  git(root, "commit", "-q", "--allow-empty", "-m", "part-1")
  const mid = git(root, "rev-parse", "HEAD")
  git(root, "commit", "-q", "--allow-empty", "-m", "part-2")
  const head = git(root, "rev-parse", "HEAD")
  // baseRef を後ろへずらし、フェーズの差分の一部だけを評価させた
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-part", {
    subject: { repoPath: root, head, base: mid, files: [] }
  })
  let r = run(root, gateArgs("test-code", "ev-part", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/フェーズの開始の HEAD/)
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-full", {
    subject: { repoPath: root, head, base: start, files: [] }
  })
  r = run(root, gateArgs("test-code", "ev-full", "PROCEED"))
  expect(r.code).toBe(0)
})

test("pass-gate 検査 9: 文書のフェーズで subject.files の sha256 が今の中身と違えば失敗する(R16)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent", "discuss"])
  run(root, ["start-phase", "design", "--slug", "demo"])
  const rel = "docs/codiel/runs/demo/design.md"
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "# 設計\n")
  const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  const subject = {
    repoPath: root,
    head: git(root, "rev-parse", "HEAD"),
    paths: [rel],
    files: [{ path: rel, sha256: sha, isNew: true }]
  }
  recordEvaluation(root, "demo", "design", "PROCEED", "ev-design", { subject })
  // ゲートの後に書き換えた
  fs.appendFileSync(file, "追記\n")
  let r = run(root, gateArgs("design", "ev-design", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(new RegExp(`${rel} が評価の後に変わっています`))
  // 消した
  fs.rmSync(file)
  r = run(root, gateArgs("design", "ev-design", "PROCEED"))
  expect(r.code).toBe(1)
  fs.writeFileSync(file, "# 設計\n")
  r = run(root, gateArgs("design", "ev-design", "PROCEED"))
  expect(r.code).toBe(0)
})

test("pass-gate 検査 8: code 系フェーズで paths を絞った評価は、head と base が合っても失敗する(W4R2-01・W4R1-03)", () => {
  const root = codeRun()
  const start = latestState(root, "demo").phases["test-code"].startHead
  const head = git(root, "rev-parse", "HEAD")
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-paths", {
    subject: { repoPath: root, head, base: start, paths: ["a.ts"], files: [] }
  })
  const r = run(root, gateArgs("test-code", "ev-paths", "PROCEED"))
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/paths\(\["a.ts"\]\)で絞られています/)
  expect(latestState(root, "demo").phases["test-code"].status).toBe(
    "in_progress"
  )
})

// 文書のフェーズを in_progress にし、files に rels を載せた評価(今の中身の sha256)で pass-gate する
function docGate(root: string, phase: string, rels: string[]) {
  const files = rels.map((rel) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `# ${rel}\n`)
    const sha256 = createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex")
    return { path: rel, sha256, isNew: true }
  })
  const id = `ev-${phase}-${rels.length}-${Math.random()}`
  recordEvaluation(root, "demo", phase, "PROCEED", id, {
    subject: {
      repoPath: root,
      head: git(root, "rev-parse", "HEAD"),
      paths: rels,
      files
    }
  })
  return run(root, gateArgs(phase, id, "PROCEED"))
}

test("pass-gate 検査 9: design と dev-plan は run の文書の置き場の design.md・dev-plan.md を評価していなければ失敗する(W4R2-03・W4R1-04)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", ["intent", "discuss"])
  run(root, ["start-phase", "design", "--slug", "demo"])
  // 別のファイルだけを評価した
  let r = docGate(root, "design", ["docs/other.md"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /design の評価に docs\/codiel\/runs\/demo\/design.md が含まれていません/
  )
  // 別の run の置き場の design.md でも通さない
  r = docGate(root, "design", ["docs/codiel/runs/other/design.md"])
  expect(r.code).toBe(1)
  r = docGate(root, "design", ["./docs/codiel/runs/demo/design.md"])
  expect(r.code, r.err).toBe(0)
  run(root, ["start-phase", "dev-plan", "--slug", "demo"])
  r = docGate(root, "dev-plan", ["docs/codiel/runs/demo/design.md"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(
    /docs\/codiel\/runs\/demo\/dev-plan.md が含まれていません/
  )
  r = docGate(root, "dev-plan", ["docs/codiel/runs/demo/dev-plan.md"])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate 検査 9: run の文書の置き場は .codiel/config.json の runsDir と slug から組む", () => {
  const root = tmpProject()
  init(root)
  fs.writeFileSync(
    path.join(root, ".codiel", "config.json"),
    JSON.stringify({ runsDir: "notes/runs" })
  )
  passThrough(root, "demo", ["intent", "discuss"])
  run(root, ["start-phase", "design", "--slug", "demo"])
  let r = docGate(root, "design", ["docs/codiel/runs/demo/design.md"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/notes\/runs\/demo\/design.md が含まれていません/)
  r = docGate(root, "design", ["notes/runs/demo/design.md"])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate 検査 9: test-spec は testsDir 配下の spec.md か cases.md を 1 件以上評価していなければ失敗する", () => {
  const root = tmpProject()
  init(root)
  fs.writeFileSync(
    path.join(root, ".codiel", "config.json"),
    JSON.stringify({ testsDir: "qa/specs" })
  )
  passThrough(root, "demo", ["intent", "discuss", "design"])
  run(root, ["start-phase", "test-spec", "--slug", "demo"])
  for (const rels of [
    ["qa/specs/units/a/notes.md"],
    ["docs/codiel/tests/units/a/spec.md"],
    ["other/qa/specs/units/a/cases.md"]
  ]) {
    const r = docGate(root, "test-spec", rels)
    expect(r.code, rels[0]).toBe(1)
    expect(r.err).toMatch(
      /qa\/specs\/ 配下の spec.md か cases.md が含まれていません/
    )
  }
  const r = docGate(root, "test-spec", [
    "qa/specs/units/a/notes.md",
    "qa/specs/units/a/cases.md"
  ])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate 検査 9: intent-sync は期待するファイルを照合しない(sha256 の照合は行う)", () => {
  const root = tmpProject()
  init(root)
  passThrough(root, "demo", UNTIL_PR.slice(0, -1))
  run(root, ["start-phase", "intent-sync", "--slug", "demo"])
  const r = docGate(root, "intent-sync", ["docs/intents/any.md"])
  expect(r.code, r.err).toBe(0)
})

test("pass-gate は通したときの HEAD を passedHead に記録する(文書と code 系のゲート付きフェーズ)", () => {
  const root = codeRun()
  const st = latestState(root, "demo")
  const head = git(root, "rev-parse", "HEAD")
  for (const ph of ["intent", "design", "test-spec", "dev-plan"])
    expect(st.phases[ph].passedHead, ph).toBe(head)
  // ゲートを持たないフェーズは記録しない
  expect(st.phases.discuss.passedHead).toBeUndefined()
  git(root, "commit", "-q", "--allow-empty", "-m", "tests")
  const after = git(root, "rev-parse", "HEAD")
  recordEvaluation(root, "demo", "test-code", "PROCEED", "ev-tc")
  expect(run(root, gateArgs("test-code", "ev-tc", "PROCEED")).code).toBe(0)
  expect(latestState(root, "demo").phases["test-code"].passedHead).toBe(after)
})

test("pass-gate は git の管理外では passedHead を記録しない", () => {
  const root = gateRun()
  recordEvaluation(root, "demo", "intent", "PROCEED", "ev-intent")
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true })
  const r = run(root, gateArgs("intent", "ev-intent", "PROCEED"))
  expect(r.code, r.err).toBe(0)
  expect(r.out.state.phases.intent.status).toBe("passed")
  expect(r.out.state.phases.intent.passedHead).toBeUndefined()
})

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

// ファイルを書いて(内容が無ければ既存のまま)コミットする
function commitFiles(root: string, rels: string[], message: string): void {
  for (const rel of rels) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${rel}\n`)
  }
  git(root, "add", "--", ...rels)
  git(root, "commit", "-q", "-m", message)
}

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

test("v1 の run には get と stop だけが通り、ほかのコマンドは §6.2.4 の文言で失敗する", () => {
  const root = tmpProject()
  writeV1(root, 5, "active")
  const get = run(root, ["get", "--slug", "issue-5"])
  expect(get.code).toBe(0)
  expect(get.out.state.version).toBe(1)
  for (const args of [
    ["start-phase", "design"],
    ["skip-phase", "fix-loop", "--reason", "r"],
    ["pass-gate", "design", "--evaluation-id", "e", "--verdict", "PROCEED"],
    ["complete-phase", "review"],
    ["mark-ask", "design"],
    ["resume"],
    ["set-domain", "--domain", "web"],
    ["clear-domain"],
    ["wait-add", "--id", "w-1", "--purpose", "p"],
    ["wait-done", "--id", "w-1"],
    ["wait-clear"],
    ["set-integration", "--integration", "local", "--image-upload", "none"],
    ["record-attempt", "design"],
    ["close"],
    ["finalize"],
    ["record-outcome", "--outcome", "approved"]
  ]) {
    const r = run(root, [...args, "--slug", "issue-5"])
    expect(r.code, args[0]).toBe(1)
    expect(r.err, args[0]).toBe(`${v1Message(5, "active")}\n`)
  }
  const saved = JSON.parse(fs.readFileSync(statePath(root, "issue-5"), "utf8"))
  expect(saved.status).toBe("active")
  expect(saved.version).toBe(1)
  const stop = run(root, ["stop", "--slug", "issue-5", "--reason", "migrate"])
  expect(stop.code).toBe(0)
  expect(stop.out.state.status).toBe("stopped")
  expect(stop.out.state.stopReason).toBe("migrate")
})

test("get --active は v1 の active と awaiting_human の run を runs に含めず、run ごとに文言を stderr に出す", () => {
  const root = tmpProject()
  writeV1(root, 1, "active")
  writeV1(root, 4, "awaiting_human")
  init(root)
  fs.writeFileSync(path.join(root, ".codiel/runs/.gitkeep"), "")
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(
    r.out.runs.map((x: { state: { runId: string } }) => x.state.runId)
  ).toStrictEqual(["demo"])
  const lines = r.err.split("\n").filter((l) => l !== "")
  expect(lines.sort()).toStrictEqual(
    [v1Message(1, "active"), v1Message(4, "awaiting_human")].sort()
  )
})

test("get --active は v1 の awaiting_outcome の run を version 1 のまま runs に含め、文言を出さない", () => {
  const root = tmpProject()
  writeV1(root, 2, "awaiting_outcome")
  // 終端の v1 の run は報告しない
  for (const [n, status] of [
    [3, "stopped"],
    [6, "completed"],
    [7, "rejected"]
  ] as const)
    writeV1(root, n, status)
  init(root)
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(r.err).toBe("")
  const byId = Object.fromEntries(
    r.out.runs.map((x: { state: { runId: string } }) => [x.state.runId, x])
  )
  expect(Object.keys(byId).sort()).toStrictEqual(["demo", "issue-2"])
  expect(byId["issue-2"].statePath).toBe(statePath(root, "issue-2"))
  expect(byId["issue-2"].state.version).toBe(1)
  expect(byId["issue-2"].state.status).toBe("awaiting_outcome")
  expect("integration" in byId["issue-2"].state).toBe(false)
  expect(byId.demo.state.version).toBe(2)
})

test("record-outcome は v1 の awaiting_outcome の run を v2 と同じ遷移で終端にし、version 1 のまま書き戻す", () => {
  const root = tmpProject()
  writeV1(root, 2, "awaiting_outcome")
  writeV1(root, 3, "awaiting_outcome")
  const incident = run(root, [
    "record-outcome",
    "--slug",
    "issue-2",
    "--outcome",
    "incident",
    "--note",
    "n"
  ])
  expect(incident.code).toBe(0)
  expect(incident.out.state.status).toBe("awaiting_outcome")
  expect(incident.out.state.incidents).toHaveLength(1)
  expect(incident.out.state.incidents[0].note).toBe("n")
  const approved = run(root, [
    "record-outcome",
    "--slug",
    "issue-2",
    "--outcome",
    "approved"
  ])
  expect(approved.code).toBe(0)
  expect(approved.out.state.status).toBe("completed")
  const rejected = run(root, [
    "record-outcome",
    "--slug",
    "issue-3",
    "--outcome",
    "rejected"
  ])
  expect(rejected.code).toBe(0)
  expect(rejected.out.state.status).toBe("rejected")
  for (const [n, status] of [
    [2, "completed"],
    [3, "rejected"]
  ] as const) {
    const saved = JSON.parse(
      fs.readFileSync(statePath(root, `issue-${n}`), "utf8")
    )
    expect(saved.version).toBe(1)
    expect(saved.status).toBe(status)
    expect(saved.runId).toBe(`issue-${n}`)
    expect("integration" in saved).toBe(false)
    expect("intent" in saved).toBe(false)
  }
  // 終端にした v1 の run は get --active に出ない
  const active = run(root, ["get", "--active"])
  expect(active.out.runs).toStrictEqual([])
  expect(active.err).toBe("")
})

test("record-outcome は awaiting_outcome 以外の v1 の run への approved を §6.2.4 の文言で拒否する", () => {
  const root = tmpProject()
  for (const [n, status] of [
    [1, "active"],
    [2, "awaiting_human"],
    [3, "stopped"],
    [4, "completed"],
    [5, "rejected"]
  ] as const) {
    writeV1(root, n, status)
    const r = run(root, [
      "record-outcome",
      "--slug",
      `issue-${n}`,
      "--outcome",
      "approved"
    ])
    expect(r.code, status).toBe(1)
    expect(r.err, status).toBe(`${v1Message(n, status)}\n`)
    const saved = JSON.parse(
      fs.readFileSync(statePath(root, `issue-${n}`), "utf8")
    )
    expect(saved.status, status).toBe(status)
  }
})

test("record-outcome は completed / rejected 以外の非 awaiting_outcome の v1 の run への incident を §6.2.4 の文言で拒否する", () => {
  const root = tmpProject()
  for (const [n, status] of [
    [1, "active"],
    [2, "awaiting_human"],
    [3, "stopped"]
  ] as const) {
    writeV1(root, n, status)
    const r = run(root, [
      "record-outcome",
      "--slug",
      `issue-${n}`,
      "--outcome",
      "incident"
    ])
    expect(r.code, status).toBe(1)
    expect(r.err, status).toBe(`${v1Message(n, status)}\n`)
    const saved = JSON.parse(
      fs.readFileSync(statePath(root, `issue-${n}`), "utf8")
    )
    expect(saved.status, status).toBe(status)
    expect(saved.incidents, status).toStrictEqual([])
  }
})

test("record-outcome は completed / rejected の v1 の run への incident を受け付け、version 1 のまま status を変えない(決定 63)", () => {
  const root = tmpProject()
  for (const [n, status] of [
    [4, "completed"],
    [5, "rejected"]
  ] as const) {
    writeV1(root, n, status)
    const r = run(root, [
      "record-outcome",
      "--slug",
      `issue-${n}`,
      "--outcome",
      "incident",
      "--note",
      "n"
    ])
    expect(r.code, status).toBe(0)
    expect(r.out.state.status, status).toBe(status)
    expect(r.out.state.version, status).toBe(1)
    expect(r.out.state.incidents, status).toHaveLength(1)
    const saved = JSON.parse(
      fs.readFileSync(statePath(root, `issue-${n}`), "utf8")
    )
    expect(saved.status, status).toBe(status)
    expect(saved.version, status).toBe(1)
    expect(saved.incidents, status).toHaveLength(1)
  }
})

test("findActiveRun は version 2 の run だけを返し、runs 直下のファイルと v1 の run を無視する", () => {
  const root = tmpProject()
  writeV1(root, 5, "active")
  writeV1(root, 6, "awaiting_human")
  writeV1(root, 7, "awaiting_outcome")
  fs.writeFileSync(path.join(root, ".codiel/runs/.gitkeep"), "")
  expect(findActiveRun(root)).toBeNull()
  init(root)
  const found = findActiveRun(root)
  expect(found?.state.runId).toBe("demo")
  expect(found?.dir).toBe(path.join(root, ".codiel/runs/demo/try-1"))
})

// --- M4 より前の state(設計書 §6.6 の冒頭、A6-18) ---

// M4 より前に作った v2 の state(phases に test-code を持たない)を置く
function writePreM4(root: string, slug: string, status: string): string {
  expect(init(root, slug).code).toBe(0)
  const p = statePath(root, slug)
  const raw = JSON.parse(fs.readFileSync(p, "utf8"))
  delete raw.phases["test-code"]
  raw.status = status
  fs.writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`)
  return p
}

// 設計書 §6.6 の文言テンプレート
function preM4Message(slug: string, status: string): string {
  return `codiel: .codiel/runs/${slug} は test-code フェーズを持たない state の run(status: ${status})であり、この版では再開できない。\`codiel-state stop --slug ${slug} --reason migrate\` で止めてから、\`/codiel:run ${INIT_DEFAULTS.intent}\` で同じ intent の新しい try を始める。`
}

test("M4 より前の state の run には get と stop だけが通り、ほかのコマンドは §6.6 の文言で失敗して state のファイルを変えない", () => {
  const root = tmpProject()
  const p = writePreM4(root, "demo", "active")
  const before = fs.readFileSync(p, "utf8")
  const get = run(root, ["get", "--slug", "demo"])
  expect(get.code).toBe(0)
  expect("test-code" in get.out.state.phases).toBe(false)
  for (const args of [
    ["start-phase", "intent"],
    ["skip-phase", "discuss", "--reason", "r"],
    ["pass-gate", "intent", "--evaluation-id", "e", "--verdict", "PROCEED"],
    ["complete-phase", "discuss"],
    ["mark-ask", "intent"],
    ["resume"],
    ["set-domain", "--domain", "web"],
    ["clear-domain"],
    ["wait-add", "--id", "w-1", "--purpose", "p"],
    ["wait-done", "--id", "w-1"],
    ["wait-clear"],
    ["set-integration", "--integration", "local", "--image-upload", "none"],
    ["record-attempt", "intent"],
    ["close"],
    ["finalize"],
    ["record-outcome", "--outcome", "approved"],
    ["step-add", "--id", "1", "--files", '["a/**"]', "--deps", "[]"],
    ["step-update", "--id", "1", "--status", "running"],
    ["waves"],
    ["set-test-edit"],
    ["clear-test-edit"]
  ]) {
    const r = run(root, [...args, "--slug", "demo"])
    expect(r.code, args[0]).toBe(1)
    expect(r.err, args[0]).toBe(`${preM4Message("demo", "active")}\n`)
  }
  // 同じ slug の新しい try も、止めるまでは作らない
  const again = init(root)
  expect(again.code).toBe(1)
  expect(again.err).toBe(`${preM4Message("demo", "active")}\n`)
  expect(fs.readFileSync(p, "utf8")).toBe(before)
  expect(fs.existsSync(statePath(root, "demo", 2))).toBe(false)
  // awaiting_human の run も同じ(文言の status だけが変わる)
  writePreM4(root, "asked", "awaiting_human")
  const resume = run(root, ["resume", "--slug", "asked"])
  expect(resume.code).toBe(1)
  expect(resume.err).toBe(`${preM4Message("asked", "awaiting_human")}\n`)
})

test("M4 より前の state の run を stop --reason migrate で止めても test-code を足さず、同じ slug の新しい try は test-code を持つ", () => {
  const root = tmpProject()
  const p = writePreM4(root, "demo", "active")
  const phasesBefore = Object.keys(
    JSON.parse(fs.readFileSync(p, "utf8")).phases
  )
  const stop = run(root, ["stop", "--slug", "demo", "--reason", "migrate"])
  expect(stop.code).toBe(0)
  expect(stop.out.state.status).toBe("stopped")
  expect(stop.out.state.stopReason).toBe("migrate")
  const saved = JSON.parse(fs.readFileSync(p, "utf8"))
  expect(saved.status).toBe("stopped")
  expect(Object.keys(saved.phases)).toStrictEqual(phasesBefore)
  expect("test-code" in saved.phases).toBe(false)
  // 終端にした後は、同じ intent の新しい try を始められる
  const next = init(root)
  expect(next.code).toBe(0)
  expect(next.out.state.try).toBe(2)
  expect("test-code" in next.out.state.phases).toBe(true)
  expect(run(root, ["start-phase", "intent", "--slug", "demo"]).code).toBe(0)
})

test("M4 より前の state の record-outcome は awaiting_outcome の run と completed / rejected の run への incident だけを受け付ける", () => {
  const root = tmpProject()
  // awaiting_outcome は approved・rejected・incident を受け付け、test-code を足さずに書き戻す
  for (const [slug, outcome, status] of [
    ["out-approved", "approved", "completed"],
    ["out-rejected", "rejected", "rejected"],
    ["out-incident", "incident", "awaiting_outcome"]
  ]) {
    const p = writePreM4(root, slug, "awaiting_outcome")
    const r = run(root, [
      "record-outcome",
      "--slug",
      slug,
      "--outcome",
      outcome
    ])
    expect(r.code, slug).toBe(0)
    expect(r.out.state.status, slug).toBe(status)
    const saved = JSON.parse(fs.readFileSync(p, "utf8"))
    expect(saved.status, slug).toBe(status)
    expect("test-code" in saved.phases, slug).toBe(false)
  }
  // completed / rejected は incident だけを受け付け、status を変えない
  for (const status of ["completed", "rejected"]) {
    const slug = `done-${status}`
    const p = writePreM4(root, slug, status)
    const approved = run(root, [
      "record-outcome",
      "--slug",
      slug,
      "--outcome",
      "approved"
    ])
    expect(approved.code, status).toBe(1)
    expect(approved.err, status).toBe(`${preM4Message(slug, status)}\n`)
    const incident = run(root, [
      "record-outcome",
      "--slug",
      slug,
      "--outcome",
      "incident"
    ])
    expect(incident.code, status).toBe(0)
    expect(incident.out.state.status, status).toBe(status)
    expect(JSON.parse(fs.readFileSync(p, "utf8")).incidents).toHaveLength(1)
  }
  // ほかの状態はどの outcome も文言で拒否し、state のファイルを変えない
  for (const status of ["active", "awaiting_human", "stopped"]) {
    const slug = `live-${status.replace("_", "-")}`
    const p = writePreM4(root, slug, status)
    const before = fs.readFileSync(p, "utf8")
    for (const outcome of ["approved", "incident"]) {
      const r = run(root, [
        "record-outcome",
        "--slug",
        slug,
        "--outcome",
        outcome
      ])
      expect(r.code, `${status} ${outcome}`).toBe(1)
      expect(r.err, `${status} ${outcome}`).toBe(
        `${preM4Message(slug, status)}\n`
      )
    }
    expect(fs.readFileSync(p, "utf8"), status).toBe(before)
  }
})

test("get --active は M4 より前の state の active と awaiting_human の run を runs に含めずに文言を出し、awaiting_outcome の run は含める", () => {
  const root = tmpProject()
  writePreM4(root, "one", "active")
  writePreM4(root, "two", "awaiting_human")
  writePreM4(root, "three", "awaiting_outcome")
  writePreM4(root, "four", "stopped")
  init(root)
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(
    r.out.runs.map((x: { state: { runId: string } }) => x.state.runId).sort()
  ).toStrictEqual(["demo", "three"])
  const three = r.out.runs.find(
    (x: { state: { runId: string } }) => x.state.runId === "three"
  )
  expect("test-code" in three.state.phases).toBe(false)
  const lines = r.err.split("\n").filter((l) => l !== "")
  expect(lines.sort()).toStrictEqual(
    [
      preM4Message("one", "active"),
      preM4Message("two", "awaiting_human")
    ].sort()
  )
})

test("findActiveRun は M4 より前の state の run を返さない", () => {
  const root = tmpProject()
  init(root)
  // demo より後に更新された M4 より前の run があっても、demo を返す
  writePreM4(root, "old", "active")
  writePreM4(root, "asked", "awaiting_human")
  expect(findActiveRun(root)?.state.runId).toBe("demo")
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  expect(findActiveRun(root)).toBeNull()
})

// --- config(設計書 §6.13.4、A6-2・A7-1) ---

const DEFAULTS = { testsDir: "docs/codiel/tests", runsDir: "docs/codiel/runs" }

function writeConfig(root: string, body: string): void {
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true })
  fs.writeFileSync(path.join(root, ".codiel/config.json"), body)
}

test("config は .codiel/config.json が無いときとキーが無いときに既定の testsDir と runsDir を返し、値があればその値を返す", () => {
  const root = tmpProject()
  // run を要しない
  const none = run(root, ["config"])
  expect(none.code).toBe(0)
  expect(none.out).toStrictEqual(DEFAULTS)
  expect(readCodielConfig(root)).toStrictEqual(DEFAULTS)
  for (const [body, expected] of [
    ["{}", DEFAULTS],
    ['{ "other": 1 }', DEFAULTS],
    [
      '{ "testsDir": "qa/specs", "other": true }',
      { ...DEFAULTS, testsDir: "qa/specs" }
    ],
    ['{ "testsDir": "./qa/specs/" }', { ...DEFAULTS, testsDir: "qa/specs" }],
    ['{ "runsDir": "./notes/runs/" }', { ...DEFAULTS, runsDir: "notes/runs" }],
    [
      '{ "testsDir": "qa", "runsDir": "qa-runs" }',
      { testsDir: "qa", runsDir: "qa-runs" }
    ]
  ] as const) {
    writeConfig(root, body)
    const r = run(root, ["config"])
    expect(r.code, body).toBe(0)
    expect(r.out, body).toStrictEqual(expected)
    expect(readCodielConfig(root), body).toStrictEqual(expected)
  }
  expect(fs.existsSync(path.join(root, ".codiel/runs"))).toBe(false)
})

test("config の出力は raguel キーの有無と中身で変わらない", () => {
  const root = tmpProject()
  for (const raguel of [
    "{}",
    '{ "version": 1, "rules": { "code/protected-paths": { "globs": ["src/**"] } } }',
    // codiel-state は raguel の中身を検査しない
    '"not-an-object"',
    "null",
    "[1, 2]"
  ]) {
    writeConfig(root, `{ "raguel": ${raguel} }`)
    const r = run(root, ["config"])
    expect(r.code, raguel).toBe(0)
    expect(r.out, raguel).toStrictEqual(DEFAULTS)
    writeConfig(root, `{ "testsDir": "qa", "raguel": ${raguel} }`)
    expect(run(root, ["config"]).out, raguel).toStrictEqual({
      ...DEFAULTS,
      testsDir: "qa"
    })
  }
})

test("config は不正な値で非ゼロ終了し、readCodielConfig は例外を投げる", () => {
  const root = tmpProject()
  const bodies = [
    // JSON として読めない
    '{ "testsDir": ',
    '["docs/tests"]'
  ]
  for (const key of ["testsDir", "runsDir"])
    bodies.push(
      // 文字列でない
      `{ "${key}": 1 }`,
      `{ "${key}": null }`,
      // 空文字列
      `{ "${key}": "" }`,
      // 絶対パス
      `{ "${key}": "/srv/x" }`,
      // .. のセグメントを含む
      `{ "${key}": "../x" }`,
      `{ "${key}": "qa/../../x" }`
    )
  for (const body of bodies) {
    writeConfig(root, body)
    const r = run(root, ["config"])
    expect(r.code, body).toBe(1)
    expect(r.err, body).not.toBe("")
    expect(() => readCodielConfig(root), body).toThrow()
  }
})

// --- gitignore(設計書 §6.15.5、A7-3) ---

function requiredLines(testsDir: string): string[] {
  const reports = `${testsDir}/e2e/**/reports/[0-9]*-try[0-9]*`
  return [
    ".codiel/runs/",
    ".codiel/reports/",
    `${reports}/**`,
    `!${reports}/results.json`,
    `!${reports}/summary.md`,
    `!${reports}/failure.md`
  ]
}

test("gitignore は testsDir に応じた必須の行を返し、.gitignore が無ければ全行を missing にする", () => {
  const root = tmpProject()
  // run を要しない
  const r = run(root, ["gitignore"])
  expect(r.code).toBe(0)
  expect(r.out).toStrictEqual({
    path: ".gitignore",
    required: requiredLines("docs/codiel/tests"),
    missing: requiredLines("docs/codiel/tests")
  })
  // runsDir は git で共有するので行に含めない
  writeConfig(root, '{ "testsDir": "./qa/specs/", "runsDir": "notes/runs" }')
  const custom = run(root, ["gitignore"])
  expect(custom.code).toBe(0)
  expect(custom.out.required).toStrictEqual(requiredLines("qa/specs"))
  expect(custom.out.required.join("\n")).not.toContain("notes/runs")
  // .gitignore を書かない
  expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false)
  expect(fs.existsSync(path.join(root, ".codiel/runs"))).toBe(false)
})

test("gitignore は前後の空白を除いた完全一致で比べ、# で始まる行と空行を数えない", () => {
  const root = tmpProject()
  const req = requiredLines("docs/codiel/tests")
  const body = [
    "node_modules/",
    "",
    "# .codiel/runs/",
    `  ${req[1]}\t`,
    // 完全一致でないものは数えない
    ".codiel/reports",
    `${req[2]}/extra`,
    req[3],
    "",
    req[5]
  ].join("\r\n")
  fs.writeFileSync(path.join(root, ".gitignore"), body)
  const r = run(root, ["gitignore"])
  expect(r.code).toBe(0)
  expect(r.out.missing).toStrictEqual([req[0], req[2], req[4]])
  // .gitignore を変えない
  expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toBe(body)
  fs.writeFileSync(path.join(root, ".gitignore"), `${req.join("\n")}\n`)
  expect(run(root, ["gitignore"]).out.missing).toStrictEqual([])
})

test("gitignore は config.json が不正なら非ゼロで終了する", () => {
  const root = tmpProject()
  for (const body of [
    '{ "testsDir": ',
    '{ "testsDir": "/x" }',
    '{ "runsDir": "" }'
  ]) {
    writeConfig(root, body)
    const r = run(root, ["gitignore"])
    expect(r.code, body).toBe(1)
    expect(r.err, body).not.toBe("")
  }
})

test("gitignore の必須の行は git check-ignore で意図どおりに無視する", () => {
  // "." はリポジトリ全体を指す値。"./" のように正規化すると "." になる書き方も同じ結果になる
  for (const [testsDir, configured] of [
    ["docs/codiel/tests", "docs/codiel/tests"],
    ["qa/specs", "qa/specs"],
    [".", "."],
    [".", "./"]
  ]) {
    const root = tmpProject()
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: root, encoding: "utf8" })
    expect(git("init", "-q").status).toBe(0)
    if (testsDir !== "docs/codiel/tests")
      writeConfig(root, JSON.stringify({ testsDir: configured }))
    const r = run(root, ["gitignore"])
    const base = testsDir === "." ? "" : `${testsDir}/`
    if (testsDir === ".")
      expect(r.out.required[2], configured).toBe(
        "e2e/**/reports/[0-9]*-try[0-9]*/**"
      )
    fs.writeFileSync(
      path.join(root, ".gitignore"),
      `# codiel\n${r.out.required.join("\n")}\n`
    )
    const execDir = `${base}e2e/frontend/a/reports/20260928-101500-demo-try1`
    const ignored = [
      ".codiel/runs/s/try-1/state.json",
      ".codiel/reports/test-run-x.md",
      `${execDir}/x.png`,
      `${execDir}/sub/error-context.md`
    ]
    const kept = [
      `${execDir}/results.json`,
      `${execDir}/summary.md`,
      `${execDir}/failure.md`,
      `${base}e2e/backend/api/reports/spec.md`,
      ".codiel/config.json"
    ]
    // check-ignore はファイルが無くても判定するが、ディレクトリの規則を確かめるため実物を置く
    for (const p of [...ignored, ...kept]) {
      fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
      fs.writeFileSync(path.join(root, p), "x")
    }
    for (const p of ignored)
      expect(git("check-ignore", "-q", p).status, p).toBe(0)
    for (const p of kept) expect(git("check-ignore", "-q", p).status, p).toBe(1)
  }
})

test("state.json の無い try は run として扱わず、手前の try を最新とする", () => {
  const root = tmpProject()
  // run でないディレクトリ
  fs.mkdirSync(path.join(root, ".codiel/runs/junk/try-1"), { recursive: true })
  expect(findActiveRun(root)).toBeNull()
  const empty = run(root, ["get", "--active"])
  expect(empty.code).toBe(0)
  expect(empty.out.runs).toStrictEqual([])
  // init の mkdir の後、writeState の前で中断した try-2
  init(root)
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  fs.mkdirSync(path.join(root, ".codiel/runs/demo/try-2/reports"), {
    recursive: true
  })
  const got = run(root, ["get", "--slug", "demo"])
  expect(got.code).toBe(0)
  expect(got.out.state.try).toBe(1)
  expect(got.out.state.status).toBe("stopped")
  // 次の init は中断した try-2 を使い直す
  const again = init(root)
  expect(again.code).toBe(0)
  expect(again.out.state.try).toBe(2)
  expect(fs.existsSync(statePath(root, "demo", 2))).toBe(true)
})

// --- ドメイン ---

test("set-domain は domain を書き、clear-domain で null に戻る", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["set-domain", "--slug", "demo", "--domain", "frontend"])
  expect(r.code).toBe(0)
  expect(r.out.state.domain).toBe("frontend")
  expect(run(root, ["get", "--slug", "demo"]).out.state.domain).toBe("frontend")
  const r2 = run(root, ["clear-domain", "--slug", "demo"])
  expect(r2.code).toBe(0)
  expect(r2.out.state.domain).toBe(null)
  expect(run(root, ["get", "--slug", "demo"]).out.state.domain).toBe(null)
})

test("set-domain は既存の domain を上書きし、ドメインマップに無い名前でも受理する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["set-domain", "--slug", "demo", "--domain", "frontend"])
  const r = run(root, ["set-domain", "--slug", "demo", "--domain", "backend"])
  expect(r.out.state.domain).toBe("backend")
  const unknown = run(root, [
    "set-domain",
    "--slug",
    "demo",
    "--domain",
    "存在しない"
  ])
  expect(unknown.code).toBe(0)
  expect(unknown.out.state.domain).toBe("存在しない")
})

test("set-domain は空文字列・空白のみ・--domain 省略を拒否する", () => {
  const root = tmpProject()
  init(root)
  const empty = run(root, ["set-domain", "--slug", "demo", "--domain", ""])
  expect(empty.code).toBe(1)
  expect(empty.err).toMatch(/空文字列/)
  const blank = run(root, ["set-domain", "--slug", "demo", "--domain", "   "])
  expect(blank.code).toBe(1)
  expect(blank.err).toMatch(/空文字列/)
  const missing = run(root, ["set-domain", "--slug", "demo"])
  expect(missing.code).toBe(1)
  expect(missing.err).toMatch(/--domain が必要です/)
  // 拒否されたときは state に domain が書かれない
  expect(run(root, ["get", "--slug", "demo"]).out.state.domain).toBeUndefined()
})

test("set-domain は終端状態の run を拒否し、clear-domain は終端状態でも解除できる", () => {
  const root = tmpProject()
  init(root)
  run(root, ["set-domain", "--slug", "demo", "--domain", "frontend"])
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  const r = run(root, ["set-domain", "--slug", "demo", "--domain", "backend"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/すでに終端状態です/)
  // 委譲中に run が落ちても解除できる(古い domain を残さない)
  const r2 = run(root, ["clear-domain", "--slug", "demo"])
  expect(r2.code).toBe(0)
  expect(r2.out.state.domain).toBe(null)
})

test("domain と domainMode を持たない state でもサブコマンドが動く", () => {
  const root = tmpProject()
  init(root, "demo", {}, ["--domain-mode", "mapped"])
  const raw = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
  expect("domain" in raw).toBe(false)
  delete raw.domainMode
  fs.writeFileSync(statePath(root, "demo"), `${JSON.stringify(raw, null, 2)}\n`)
  const got = run(root, ["get", "--slug", "demo"])
  expect(got.code).toBe(0)
  expect("domainMode" in got.out.state).toBe(false)
  expect(run(root, ["start-phase", "intent", "--slug", "demo"]).code).toBe(0)
  const r = run(root, ["clear-domain", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.state.version).toBe(2)
  expect(r.out.state.phases.intent.status).toBe("in_progress")
})

test("set-domain 後も既存サブコマンドが正常に動き、他フィールドを壊さない", () => {
  const root = tmpProject()
  init(root, "demo", { issue: "7" }, ["--base-branch", "develop"])
  const before = run(root, ["get", "--slug", "demo"]).out.state
  run(root, ["set-domain", "--slug", "demo", "--domain", "backend"])
  const after = run(root, ["get", "--slug", "demo"]).out.state
  for (const key of [
    "version",
    "runId",
    "try",
    "issue",
    "intent",
    "branch",
    "raguelRunId",
    "integration",
    "scale",
    "imageUpload",
    "adrTarget",
    "status",
    "phase",
    "phases",
    "pr",
    "limits",
    "stopReason",
    "incidents",
    "createdAt",
    "baseBranch"
  ])
    expect(after[key]).toStrictEqual(before[key])
  // set-domain を挟んでも通常のフェーズ遷移が最後まで通る
  fullRun(root, "demo")
  const done = run(root, ["get", "--slug", "demo"])
  expect(done.out.state.status).toBe("awaiting_outcome")
  expect(done.out.state.domain).toBe("backend")
  expect(done.out.state.baseBranch).toBe("develop")
  expect(done.out.state.pr.url).toBe("u")
  expect(
    run(root, ["record-outcome", "--slug", "demo", "--outcome", "approved"]).out
      .state.status
  ).toBe("completed")
})

function writeDomainDoc(root: string, body: string): string {
  const rel = "docs/intents/domains/frontend.md"
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  return rel
}

test("next-adr-candidate-id は持続層ファイルが無ければ <領域名>-1 を返す", () => {
  const root = tmpProject()
  const r = run(root, [
    "next-adr-candidate-id",
    "--file",
    "docs/intents/domains/frontend.md",
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  expect(r.out.candidateId).toBe("frontend-1")
})

test("next-adr-candidate-id は frontend-1 と frontend-10 が同じファイルにあるとき次を frontend-11 にする", () => {
  const root = tmpProject()
  const rel = writeDomainDoc(
    root,
    [
      "# frontend",
      "",
      "## 意図的な制約",
      "### 判断 A [ADR 候補: frontend-1]",
      "- 制約: a",
      "### 判断 B [ADR 候補: frontend-10]",
      "- 制約: b",
      ""
    ].join("\n")
  )
  const r = run(root, [
    "next-adr-candidate-id",
    "--file",
    rel,
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  expect(r.out.candidateId).toBe("frontend-11")
})

test("next-adr-candidate-id は印付きエントリと参照形の両方を数える", () => {
  const root = tmpProject()
  const rel = writeDomainDoc(
    root,
    [
      "# frontend",
      "",
      "## 意図的な制約",
      "### 判断 A [ADR 候補: frontend-2]",
      "- 制約: a",
      "### 判断 B",
      "- 制約: b",
      "- 関連 ADR: ADR-005(候補 ID: frontend-5)",
      ""
    ].join("\n")
  )
  const r = run(root, [
    "next-adr-candidate-id",
    "--file",
    rel,
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  expect(r.out.candidateId).toBe("frontend-6")
})

test("next-adr-candidate-id は別の領域名の候補 ID を数えない", () => {
  const root = tmpProject()
  const rel = writeDomainDoc(
    root,
    [
      "# frontend",
      "",
      "## 意図的な制約",
      "### 判断 A [ADR 候補: backend-9]",
      "- 制約: a",
      ""
    ].join("\n")
  )
  const r = run(root, [
    "next-adr-candidate-id",
    "--file",
    rel,
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  expect(r.out.candidateId).toBe("frontend-1")
})

test("next-adr-candidate-id は --file に絶対パスを渡しても動く", () => {
  const root = tmpProject()
  writeDomainDoc(root, "### 判断 A [ADR 候補: frontend-3]\n")
  const abs = path.join(root, "docs/intents/domains/frontend.md")
  const r = run(root, [
    "next-adr-candidate-id",
    "--file",
    abs,
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  expect(r.out.candidateId).toBe("frontend-4")
})

// --- implement.steps・testLoop.units・waves(設計書 §6.6.2・§6.6.5、計画書 §6.2) ---

// planWaves に渡すステップを組み立てる。files 以外は省略時に既定値を入れる
function stepsOf(
  spec: Record<string, { files: string[]; deps?: string[]; final?: boolean }>
): Record<string, StepState> {
  const out: Record<string, StepState> = {}
  for (const [id, s] of Object.entries(spec))
    out[id] = {
      status: "pending",
      files: s.files,
      deps: s.deps ?? [],
      final: s.final ?? false,
      group: null,
      worktree: null,
      branch: null,
      commits: { base: null, head: null },
      attempts: 0,
      domain: null
    }
  return out
}

function stepAdd(
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
function specAdd(root: string, kind: string, id: string, extra: string[] = []) {
  const args = ["step-add", "--slug", "demo", "--kind", kind, "--id", id]
  return run(root, [...args, ...extra])
}

function stepUpdate(
  root: string,
  id: string,
  status: string,
  extra: string[] = []
) {
  return run(root, [
    "step-update",
    "--slug",
    "demo",
    "--id",
    id,
    "--status",
    status,
    ...extra
  ])
}

test("step-add は implement.steps に必須フィールドを持つステップを登録し、version を 2 のまま保つ", () => {
  const root = tmpProject()
  init(root)
  const r = stepAdd(
    root,
    "1",
    ["src/{a,b}/**"],
    [],
    ["--final", "--domain", "backend"]
  )
  expect(r.code).toBe(0)
  expect(r.out.state.version).toBe(2)
  expect(r.out.state.implement.steps["1"]).toStrictEqual({
    status: "pending",
    files: ["src/{a,b}/**"],
    deps: [],
    final: true,
    group: null,
    worktree: null,
    branch: null,
    commits: { base: null, head: null },
    attempts: 0,
    domain: "backend"
  })
  expect("testLoop" in r.out.state).toBe(false)
  // 前提ステップは JSON 配列で受ける
  const second = stepAdd(root, "2", ["src/c/**"], ["1"])
  expect(second.out.state.implement.steps["2"].deps).toStrictEqual(["1"])
  expect(second.out.state.implement.steps["2"].final).toBe(false)
})

test("step-add --kind test-loop は testLoop.units に登録し、--files を受け付け、前提ステップと --final を拒否する", () => {
  const root = tmpProject()
  init(root)
  const r = specAdd(root, "test-loop", "e2e/frontend/login", [
    "--files",
    '["src/pages/login/**"]',
    "--domain",
    "frontend"
  ])
  expect(r.code).toBe(0)
  const unit = r.out.state.testLoop.units["e2e/frontend/login"]
  expect(unit.files).toStrictEqual(["src/pages/login/**"])
  expect(unit.deps).toStrictEqual([])
  expect(unit.group).toBeNull()
  expect(unit.final).toBe(false)
  expect(unit.domain).toBe("frontend")
  expect("implement" in r.out.state).toBe(false)
  expect("testCode" in r.out.state).toBe(false)
  const withDeps = specAdd(root, "test-loop", "units/src/a.ts", [
    "--deps",
    '["e2e/frontend/login"]'
  ])
  expect(withDeps.code).not.toBe(0)
  const withFinal = specAdd(root, "test-loop", "units/src/b.ts", ["--final"])
  expect(withFinal.code).not.toBe(0)
})

test("step-add は JSON 配列でない --files・--deps、空の --files、repoRoot の外を指す glob を拒否する", () => {
  const root = tmpProject()
  init(root)
  const base = ["step-add", "--slug", "demo", "--id", "1"]
  const add = (files: string, deps = "[]") =>
    run(root, [...base, "--files", files, "--deps", deps])
  expect(add("src/a/**").code).not.toBe(0)
  expect(add('"src/a/**"').code).not.toBe(0)
  expect(add("[]").code).not.toBe(0)
  expect(add('["/abs/**"]').code).not.toBe(0)
  expect(add('["../x/**"]').code).not.toBe(0)
  expect(add('["src/a/**"]', "1").code).not.toBe(0)
  // --kind step では --deps を省けない
  expect(run(root, [...base, "--files", '["a/**"]']).code).not.toBe(0)
  expect(add('["src/a/**"]').code).toBe(0)
})

test("step-update は計画書 §6.2 の表の遷移だけを許し、記録のフラグを受け付ける", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  // 表に無い遷移
  expect(stepUpdate(root, "1", "merged").code).not.toBe(0)
  expect(stepUpdate(root, "1", "reviewing").code).not.toBe(0)
  expect(stepUpdate(root, "1", "failed").code).not.toBe(0)
  // 遷移が受け付けない記録のフラグ
  expect(stepUpdate(root, "1", "running", ["--head", "h"]).code).not.toBe(0)
  const running = stepUpdate(root, "1", "running", [
    "--worktree",
    ".codiel/worktrees/demo/step-1",
    "--branch",
    "codiel/demo-try-1-step-1",
    "--base",
    "b1"
  ])
  expect(running.code).toBe(0)
  const s1 = running.out.state.implement.steps["1"]
  expect(s1.status).toBe("running")
  expect(s1.worktree).toBe(".codiel/worktrees/demo/step-1")
  expect(s1.branch).toBe("codiel/demo-try-1-step-1")
  expect(s1.commits).toStrictEqual({ base: "b1", head: null })
  expect(stepUpdate(root, "1", "pending").code).not.toBe(0)
  expect(stepUpdate(root, "1", "merged").code).not.toBe(0)
  expect(stepUpdate(root, "1", "reviewing").code).toBe(0)
  // reviewing → running で attempts を 1 増やす
  const again = stepUpdate(root, "1", "running")
  expect(again.out.state.implement.steps["1"].attempts).toBe(1)
  expect(stepUpdate(root, "1", "reviewing").code).toBe(0)
  const merged = stepUpdate(root, "1", "merged", ["--head", "h1"])
  expect(merged.code).toBe(0)
  expect(merged.out.state.implement.steps["1"].status).toBe("merged")
  expect(merged.out.state.implement.steps["1"].commits).toStrictEqual({
    base: "b1",
    head: "h1"
  })
  // merged は終端
  for (const to of ["pending", "running", "reviewing", "failed"])
    expect(stepUpdate(root, "1", to).code, to).not.toBe(0)
  // 未登録のステップ、値域の外の状態
  expect(stepUpdate(root, "9", "running").code).not.toBe(0)
  stepAdd(root, "2", ["src/b/**"])
  expect(stepUpdate(root, "2", "done").code).not.toBe(0)
})

test("step-update は failed から pending で worktree・branch・commits を null に戻し、attempts は残す", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  const record = ["--worktree", "w", "--branch", "br", "--base", "b"]
  stepUpdate(root, "1", "running", record)
  stepUpdate(root, "1", "reviewing")
  stepUpdate(root, "1", "running")
  expect(stepUpdate(root, "1", "failed").code).toBe(0)
  expect(stepUpdate(root, "1", "running").code).not.toBe(0)
  const reset = stepUpdate(root, "1", "pending")
  expect(reset.code).toBe(0)
  const s = reset.out.state.implement.steps["1"]
  expect(s.status).toBe("pending")
  expect(s.worktree).toBeNull()
  expect(s.branch).toBeNull()
  expect(s.commits).toStrictEqual({ base: null, head: null })
  expect(s.attempts).toBe(1)
  // reviewing からも failed にできる
  stepUpdate(root, "1", "running")
  stepUpdate(root, "1", "reviewing")
  expect(stepUpdate(root, "1", "failed").code).toBe(0)
})

test("step-update --kind test-code と test-loop はそれぞれの表の要素を同じ遷移で進める", () => {
  const root = tmpProject()
  init(root)
  const id = "units/src/lib/foo.ts"
  specAdd(root, "test-code", id)
  specAdd(root, "test-loop", id)
  // step の表には無いので、--kind を省くと失敗する
  expect(stepUpdate(root, id, "running").code).not.toBe(0)
  for (const kind of ["test-code", "test-loop"]) {
    const wt = `.codiel/worktrees/demo/${kind}-1`
    const r = stepUpdate(root, id, "running", [
      "--kind",
      kind,
      "--worktree",
      wt
    ])
    expect(r.code, kind).toBe(0)
    const table = kind === "test-code" ? "testCode" : "testLoop"
    expect(r.out.state[table].units[id].status, kind).toBe("running")
    expect(r.out.state[table].units[id].worktree, kind).toBe(wt)
    // 表に無い遷移は test-code と test-loop でも拒否する
    expect(
      stepUpdate(root, id, "merged", ["--kind", kind, "--head", "h"]).code,
      kind
    ).not.toBe(0)
  }
  const unitKind = stepUpdate(root, id, "reviewing", ["--kind", "unit"])
  expect(unitKind.code).toBe(1)
  expect(unitKind.err).toMatch(/不正な --kind: unit/)
})

// --- 仕様のディレクトリの登録(設計書 §6.13.3・§6.6.3、A6-5) ---

const SPEC_IDS = [
  "units/src/lib/foo.ts",
  "e2e/frontend/login",
  "e2e/backend/api/users/{id}",
  "e2e/backend/_root",
  "e2e/cli/codiel-state"
]

test("step-add --kind test-code と test-loop は仕様のディレクトリの ID を --files なしで受け付け、それぞれの表に登録する", () => {
  const root = tmpProject()
  init(root)
  for (const kind of ["test-code", "test-loop"])
    for (const id of SPEC_IDS)
      expect(specAdd(root, kind, id).code, `${kind} ${id}`).toBe(0)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(Object.keys(st.testCode.units)).toStrictEqual(SPEC_IDS)
  expect(Object.keys(st.testLoop.units)).toStrictEqual(SPEC_IDS)
  const fresh = {
    status: "pending",
    files: [],
    deps: [],
    final: false,
    group: null,
    worktree: null,
    branch: null,
    commits: { base: null, head: null },
    attempts: 0,
    domain: null
  }
  for (const id of SPEC_IDS) {
    expect(st.testCode.units[id], id).toStrictEqual(fresh)
    expect(st.testLoop.units[id], id).toStrictEqual(fresh)
  }
  expect("implement" in st).toBe(false)
  expect(st.version).toBe(2)
})

test("step-add --kind test-code と test-loop は仕様のディレクトリの形でない ID・--deps・--final・--kind unit を拒否する", () => {
  const root = tmpProject()
  init(root)
  for (const kind of ["test-code", "test-loop"]) {
    for (const bad of [
      "units",
      "units/",
      "/units/a.ts",
      "units/../a.ts",
      "e2e/backend/api/users/:id",
      "e2e/frontend/a/b",
      "e2e/other/x",
      "screen-login",
      "e2e/cli/a/b",
      "e2e/backend",
      "e2e/frontend/",
      "units//a.ts",
      "units/./a.ts",
      "units/src/a.ts/",
      "units\\src\\a.ts"
    ]) {
      const r = specAdd(root, kind, bad)
      expect(r.code, `${kind} ${bad}`).toBe(1)
      expect(r.err, `${kind} ${bad}`).toMatch(/不正な --id/)
    }
    const deps = specAdd(root, kind, "units/src/a.ts", ["--deps", "[]"])
    expect(deps.code, kind).toBe(1)
    expect(deps.err, kind).toMatch(/--deps と --final を指定できません/)
    const final = specAdd(root, kind, "units/src/a.ts", ["--final"])
    expect(final.code, kind).toBe(1)
    expect(final.err, kind).toMatch(/--deps と --final を指定できません/)
  }
  const unit = specAdd(root, "unit", "units/src/a.ts")
  expect(unit.code).toBe(1)
  expect(unit.err).toMatch(/不正な --kind: unit/)
  // step の ID は現行の形のまま(仕様のディレクトリの ID は受け付けない)
  const step = stepAdd(root, "units/src/a.ts", ["src/a.ts"])
  expect(step.code).toBe(1)
  expect(step.err).toMatch(/不正な --id/)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  for (const key of ["implement", "testCode", "testLoop"])
    expect(key in st, key).toBe(false)
})

// 要素を pending から merged まで進める
function mergeElement(root: string, kind: string, id: string, wt: string) {
  const k = ["--kind", kind]
  expect(stepUpdate(root, id, "running", [...k, "--worktree", wt]).code).toBe(0)
  expect(stepUpdate(root, id, "reviewing", k).code).toBe(0)
  expect(stepUpdate(root, id, "merged", [...k, "--head", "h"]).code).toBe(0)
}

test("testLoop.units の merged の要素は登録し直せ、testCode.units と implement.steps の merged の要素は登録し直せない", () => {
  const root = tmpProject()
  init(root)
  const [a, b] = SPEC_IDS
  specAdd(root, "test-loop", a)
  specAdd(root, "test-loop", b)
  mergeElement(root, "test-loop", a, ".codiel/worktrees/demo/test-loop-1")
  const again = specAdd(root, "test-loop", a)
  expect(again.code).toBe(0)
  const units = again.out.state.testLoop.units
  expect(units[a].status).toBe("pending")
  expect(units[a].worktree).toBeNull()
  expect(units[a].commits).toStrictEqual({ base: null, head: null })
  // 登録し直してもキーの位置(worktree の名前の k)は変わらない
  expect(Object.keys(units)).toStrictEqual([a, b])
  // merged でも pending でもない要素は test-loop でも登録し直せない
  stepUpdate(root, b, "running", ["--kind", "test-loop"])
  const running = specAdd(root, "test-loop", b)
  expect(running.code).toBe(1)
  expect(running.err).toMatch(/running のため登録し直せません/)
  specAdd(root, "test-code", a)
  mergeElement(root, "test-code", a, ".codiel/worktrees/demo/test-code-1")
  const code = specAdd(root, "test-code", a)
  expect(code.code).toBe(1)
  expect(code.err).toMatch(/merged のため登録し直せません/)
  stepAdd(root, "1", ["src/a/**"])
  mergeElement(root, "step", "1", ".codiel/worktrees/demo/step-1")
  const step = stepAdd(root, "1", ["src/a/**"])
  expect(step.code).toBe(1)
  expect(step.err).toMatch(/merged のため登録し直せません/)
})

test("step-update --worktree は 3 つの表のほかの要素がすでに記録したパスを拒否する", () => {
  const root = tmpProject()
  init(root)
  const id = "units/src/a.ts"
  const stepWt = ".codiel/worktrees/demo/step-1"
  const codeWt = ".codiel/worktrees/demo/test-code-1"
  stepAdd(root, "1", ["src/a/**"])
  stepAdd(root, "2", ["src/b/**"])
  specAdd(root, "test-code", id)
  specAdd(root, "test-loop", id)
  expect(stepUpdate(root, "1", "running", ["--worktree", stepWt]).code).toBe(0)
  const taken = [
    ["2", "step", stepWt],
    [id, "test-code", stepWt],
    [id, "test-loop", `./${stepWt}/`]
  ]
  for (const [target, kind, wt] of taken) {
    const r = stepUpdate(root, target, "running", [
      "--kind",
      kind,
      "--worktree",
      wt
    ])
    expect(r.code, `${kind} ${wt}`).toBe(1)
    expect(r.err, `${kind} ${wt}`).toMatch(/step 1 がすでに記録しています/)
  }
  expect(
    stepUpdate(root, id, "running", [
      "--kind",
      "test-code",
      "--worktree",
      codeWt
    ]).code
  ).toBe(0)
  const loop = stepUpdate(root, id, "running", [
    "--kind",
    "test-loop",
    "--worktree",
    codeWt
  ])
  expect(loop.code).toBe(1)
  expect(loop.err).toContain(`test-code ${id} がすでに記録しています`)
  const st = run(root, ["get", "--slug", "demo"]).out.state
  expect(st.implement.steps["2"].status).toBe("pending")
  expect(st.testLoop.units[id].status).toBe("pending")
  expect(st.testLoop.units[id].worktree).toBeNull()
  // failed から pending に戻した要素の記録は消えるので、そのパスは使える
  stepUpdate(root, "1", "failed")
  stepUpdate(root, "1", "pending")
  expect(stepUpdate(root, "2", "running", ["--worktree", stepWt]).code).toBe(0)
})

// --- testEdit(設計書 §6.13.6、A6-6) ---

test("set-test-edit は fix-loop が in_progress のときだけ testEdit を真にし、ほかのフェーズでは失敗する", () => {
  const root = tmpProject()
  init(root)
  const set = () => run(root, ["set-test-edit", "--slug", "demo"])
  const refuse = (label: string) => {
    const r = set()
    expect(r.code, label).toBe(1)
    expect(r.err, label).toMatch(/fix-loop が in_progress のときだけ/)
    const st = run(root, ["get", "--slug", "demo"]).out.state
    expect("testEdit" in st, label).toBe(false)
  }
  refuse("phase null")
  run(root, ["start-phase", "intent", "--slug", "demo"])
  refuse("intent in_progress")
  passGate(root, "intent", "PROCEED")
  passThrough(root, "demo", UNTIL_REVIEW.slice(1))
  refuse("fix-loop pending")
  run(root, ["start-phase", "fix-loop", "--slug", "demo"])
  run(root, ["mark-ask", "fix-loop", "--slug", "demo", "--kind", "confirm"])
  refuse("fix-loop awaiting_human")
  run(root, ["resume", "--slug", "demo"])
  const r = set()
  expect(r.code).toBe(0)
  expect(r.out.state.testEdit).toBe(true)
  expect(run(root, ["get", "--slug", "demo"]).out.state.testEdit).toBe(true)
})

test("clear-test-edit は testEdit を消し、値が無いときも終端の run でも成功する", () => {
  const root = tmpProject()
  init(root)
  const clear = () => run(root, ["clear-test-edit", "--slug", "demo"])
  const empty = clear()
  expect(empty.code).toBe(0)
  expect("testEdit" in empty.out.state).toBe(false)
  // fix-loop まで進める代わりに state.json に直接立てる(set-test-edit の条件は上のテストで見る)
  const setDirectly = () => {
    const raw = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
    raw.testEdit = true
    fs.writeFileSync(statePath(root, "demo"), JSON.stringify(raw))
  }
  setDirectly()
  const cleared = clear()
  expect(cleared.code).toBe(0)
  expect("testEdit" in cleared.out.state).toBe(false)
  run(root, ["stop", "--slug", "demo", "--reason", "test"])
  setDirectly()
  const stopped = clear()
  expect(stopped.code).toBe(0)
  const saved = JSON.parse(fs.readFileSync(statePath(root, "demo"), "utf8"))
  expect("testEdit" in saved).toBe(false)
  expect(saved.status).toBe("stopped")
})

test("ステップの attempts はフェーズの record-attempt と独立に数える", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  const recordAttempt = ["record-attempt", "implement", "--slug", "demo"]
  expect(run(root, recordAttempt).code).toBe(0)
  expect(run(root, recordAttempt).code).toBe(0)
  stepUpdate(root, "1", "running")
  stepUpdate(root, "1", "reviewing")
  const r = stepUpdate(root, "1", "running")
  expect(r.out.state.implement.steps["1"].attempts).toBe(1)
  expect(r.out.state.phases.implement.attempts).toBe(2)
})

test("waves は groups と final の JSON を出し、各ステップの group を記録し、test-code と test-loop の要素を出さない", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"])
  stepAdd(root, "2", ["src/b/**"])
  stepAdd(root, "3", ["pnpm-lock.yaml", "package.json"], ["1"])
  stepAdd(root, "4", ["src/c/**"], ["3"])
  const all = ["1", "2", "3", "4"]
  stepAdd(root, "5", ["plugins/*/scripts/**"], all, ["--final"])
  specAdd(root, "test-code", "units/src/z.ts")
  specAdd(root, "test-loop", "e2e/cli/codiel-state", [
    "--files",
    '["src/z/**"]'
  ])
  const r = run(root, ["waves", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out).toStrictEqual({
    groups: [
      { steps: ["1", "2"], mode: "parallel" },
      { steps: ["3"], mode: "serial" },
      { steps: ["4"], mode: "parallel" }
    ],
    final: ["5"]
  })
  const st = run(root, ["get", "--slug", "demo"]).out.state
  const groupOf = (id: string) => st.implement.steps[id].group
  expect(groupOf("1")).toStrictEqual({ index: 0, mode: "parallel" })
  expect(groupOf("2")).toStrictEqual({ index: 0, mode: "parallel" })
  expect(groupOf("3")).toStrictEqual({ index: 1, mode: "serial" })
  expect(groupOf("4")).toStrictEqual({ index: 2, mode: "parallel" })
  expect(groupOf("5")).toStrictEqual({ index: 0, mode: "final" })
  expect(st.testCode.units["units/src/z.ts"].group).toBeNull()
  expect(st.testLoop.units["e2e/cli/codiel-state"].group).toBeNull()
  expect(st.version).toBe(2)
})

test("waves は循環依存で非ゼロ終了し、group を記録しない", () => {
  const root = tmpProject()
  init(root)
  stepAdd(root, "1", ["src/a/**"], ["2"])
  stepAdd(root, "2", ["src/b/**"], ["1"])
  stepAdd(root, "3", ["src/c/**"])
  const r = run(root, ["waves", "--slug", "demo"])
  expect(r.code).not.toBe(0)
  expect(r.err).toContain("循環依存")
  const st = run(root, ["get", "--slug", "demo"]).out.state
  for (const id of ["1", "2", "3"])
    expect(st.implement.steps[id].group).toBeNull()
})

test("planWaves は groups をトポロジカル順に並べ、前提を含むグループより後に置く", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/a/**"] },
      "2": { files: ["src/b/**"], deps: ["1"] },
      "3": { files: ["src/c/**"], deps: ["2"] },
      "4": { files: ["src/d/**"] }
    })
  )
  expect(plan).toStrictEqual({
    groups: [
      { steps: ["1", "4"], mode: "parallel" },
      { steps: ["2"], mode: "parallel" },
      { steps: ["3"], mode: "parallel" }
    ],
    final: []
  })
})

test("planWaves は循環依存・自己依存・未登録の前提で例外を投げる", () => {
  expect(() =>
    planWaves(
      stepsOf({
        "1": { files: ["a/**"], deps: ["3"] },
        "2": { files: ["b/**"], deps: ["1"] },
        "3": { files: ["c/**"], deps: ["2"] }
      })
    )
  ).toThrow("循環依存")
  expect(() =>
    planWaves(stepsOf({ "1": { files: ["a/**"], deps: ["1"] } }))
  ).toThrow("循環依存")
  expect(() =>
    planWaves(stepsOf({ "1": { files: ["a/**"], deps: ["9"] } }))
  ).toThrow("登録されていません")
})

test("planWaves は触るファイルが重なりうるステップを同じグループに入れない", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/app/**"] },
      "2": { files: ["src/app/x.ts"] },
      "3": { files: ["src/lib/**"] },
      "4": { files: ["src/lib/util.ts", "docs/a.md"] }
    })
  )
  expect(plan.groups).toStrictEqual([
    { steps: ["1", "3"], mode: "parallel" },
    { steps: ["2", "4"], mode: "parallel" }
  ])
})

test("planWaves は lockfile を触るステップを単独の serial グループにして依存順の位置に置き、その後続を後のグループに出す", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/a/**"] },
      "2": { files: ["Cargo.lock"] },
      "3": { files: ["src/b/**"] },
      "4": { files: ["packages/web/yarn.lock"], deps: ["1"] },
      "5": { files: ["src/c/**"], deps: ["4"] },
      "6": { files: ["src/d/**"] }
    })
  )
  expect(plan.groups).toStrictEqual([
    { steps: ["1", "3", "6"], mode: "parallel" },
    { steps: ["2"], mode: "serial" },
    { steps: ["4"], mode: "serial" },
    { steps: ["5"], mode: "parallel" }
  ])
})

test("planWaves は計画書 §6.3 の 12 種の lockfile をファイル名の完全一致で判定する", () => {
  const names = [
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
  ]
  for (const name of names) {
    const plan = planWaves(
      stepsOf({ "1": { files: [`sub/${name}`] }, "2": { files: ["src/**"] } })
    )
    expect(plan.groups[0], name).toStrictEqual({ steps: ["1"], mode: "serial" })
  }
  // 完全一致でないファイル名は lockfile ではない
  const plan = planWaves(
    stepsOf({
      "1": { files: ["x/pnpm-lock.yaml.bak"] },
      "2": { files: ["y/my-go.sum"] }
    })
  )
  expect(plan.groups).toStrictEqual([{ steps: ["1", "2"], mode: "parallel" }])
})

test("planWaves は --final のステップを final にだけ出す", () => {
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/a/**"] },
      "2": { files: ["src/b/**"] },
      "3": { files: ["plugins/*/scripts/**"], deps: ["1", "2"], final: true }
    })
  )
  expect(plan).toStrictEqual({
    groups: [{ steps: ["1", "2"], mode: "parallel" }],
    final: ["3"]
  })
  // 通常のステップは最終ステップを前提にできない
  expect(() =>
    planWaves(
      stepsOf({
        "1": { files: ["a/**"], final: true },
        "2": { files: ["b/**"], deps: ["1"] }
      })
    )
  ).toThrow("最終ステップ")
})

test("planWaves は parallel グループを 4 件までにし、超える分を次のグループへ送る", () => {
  const spec: Record<string, { files: string[] }> = {}
  for (let i = 1; i <= 9; i++) spec[String(i)] = { files: [`src/s${i}/**`] }
  expect(planWaves(stepsOf(spec)).groups).toStrictEqual([
    { steps: ["1", "2", "3", "4"], mode: "parallel" },
    { steps: ["5", "6", "7", "8"], mode: "parallel" },
    { steps: ["9"], mode: "parallel" }
  ])
})

test("重なりの判定: src/app/** と src/apple/** は重ならない", () => {
  expect(globsOverlap("src/app/**", "src/apple/**")).toBe(false)
  expect(globsOverlap("src/app/**", "src/app/x.ts")).toBe(true)
  expect(globsOverlap("src/a.ts", "src/b.ts")).toBe(false)
  expect(globsOverlap("./src/a/**", "src/a/x.ts")).toBe(true)
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/app/**"] },
      "2": { files: ["src/apple/**"] }
    })
  )
  expect(plan.groups).toStrictEqual([{ steps: ["1", "2"], mode: "parallel" }])
})

test("重なりの判定: src/{a,b}/** は展開されて src/a/x.ts と重なる", () => {
  expect(expandBraces("src/{a,b}/**")).toStrictEqual(["src/a/**", "src/b/**"])
  expect(expandBraces("{src,lib/{x,y}}/*.ts")).toStrictEqual([
    "src/*.ts",
    "lib/x/*.ts",
    "lib/y/*.ts"
  ])
  expect(globsOverlap("src/{a,b}/**", "src/a/x.ts")).toBe(true)
  expect(globsOverlap("src/{a,b}/**", "src/c/x.ts")).toBe(false)
  const plan = planWaves(
    stepsOf({
      "1": { files: ["src/{a,b}/**"] },
      "2": { files: ["src/a/x.ts"] }
    })
  )
  expect(plan.groups).toStrictEqual([
    { steps: ["1"], mode: "parallel" },
    { steps: ["2"], mode: "parallel" }
  ])
})

test("重なりの判定: 固定部が空の *.ts と **/* は全ステップと重なる", () => {
  for (const g of ["*.ts", "**/*"]) {
    expect(globsOverlap(g, "docs/a.md"), g).toBe(true)
    expect(globsOverlap("src/x/y.ts", g), g).toBe(true)
    const plan = planWaves(
      stepsOf({
        "1": { files: ["src/a/**"] },
        "2": { files: [g] },
        "3": { files: ["docs/**"] }
      })
    )
    expect(plan.groups, g).toStrictEqual([
      { steps: ["1", "3"], mode: "parallel" },
      { steps: ["2"], mode: "parallel" }
    ])
  }
})

// テストヘルパー

// tmpProject の Raguel の記録の置き場(<casesDir>/cases/<projectId>)
function casesProjectDir(root: string): string {
  return path.join(root, ".raguel", "cases", "demo")
}

// slug の最新の try の state を読む
function latestState(root: string, slug: string) {
  const dir = path.join(root, ".codiel/runs", slug)
  const n = Math.max(
    ...fs
      .readdirSync(dir)
      .filter((d) => /^try-\d+$/.test(d))
      .map((d) => Number(d.slice(4)))
  )
  return JSON.parse(fs.readFileSync(statePath(root, slug, n), "utf8"))
}

const CODE_PHASES = ["test-code", "implement", "test-loop", "fix-loop"]

interface EvaluationOver {
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
function expectedDoc(slug: string, phase: string): string | undefined {
  if (phase === "design" || phase === "dev-plan")
    return `docs/codiel/runs/${slug}/${phase}.md`
  if (phase === "test-spec") return "docs/codiel/tests/units/demo/spec.md"
  return undefined
}

// 文書のフェーズでは、期待するファイルを評価したことにする。ファイルが無ければ sha256 は null
function docFiles(root: string, slug: string, phase: string) {
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
function recordEvaluation(
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
function recordRuling(
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
function passGate(
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
function passThrough(root: string, slug: string, phases: string[]): void {
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

function fullRun(root: string, slug: string): void {
  passThrough(root, slug, UNTIL_FINALIZE)
  expect(run(root, ["finalize", "--slug", slug]).code).toBe(0)
}

// --- 待ち ---

const waitReportPath = (root: string, id: string, tryN = 1): string =>
  path.join(path.dirname(statePath(root, "demo", tryN)), "waits", `${id}.md`)

function writeWaitReport(root: string, id: string): void {
  const p = waitReportPath(root, id)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, "返答\n")
}

function waitAdd(root: string, id: string, extra: string[] = []) {
  return run(root, [
    "wait-add",
    "--slug",
    "demo",
    "--id",
    id,
    "--purpose",
    "spec を書く",
    ...extra
  ])
}

test("wait-add は waits に 1 件足し、phase と startedAt と taskId を記録する", () => {
  const root = tmpProject()
  init(root)
  run(root, ["start-phase", "intent", "--slug", "demo"])
  const r = waitAdd(root, "test-spec-units-a-1", ["--task-id", "t-9"])
  expect(r.code).toBe(0)
  const [w] = r.out.state.waits
  expect(w).toMatchObject({
    id: "test-spec-units-a-1",
    purpose: "spec を書く",
    phase: "intent",
    taskId: "t-9"
  })
  expect(Number.isNaN(Date.parse(w.startedAt))).toBe(false)
  expect(r.out.state.version).toBe(2)
  const second = waitAdd(root, "gate-intent-1")
  expect(second.out.state.waits.map((x: { id: string }) => x.id)).toEqual([
    "test-spec-units-a-1",
    "gate-intent-1"
  ])
  expect("taskId" in second.out.state.waits[1]).toBe(false)
})

test("wait-add は残っている同じ id・報告のある id・不正な id・終端の run を拒否する", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  const dup = waitAdd(root, "a-1")
  expect(dup.code).toBe(1)
  expect(dup.err).toMatch(/すでに残っています/)
  writeWaitReport(root, "b-1")
  const used = waitAdd(root, "b-1")
  expect(used.code).toBe(1)
  expect(used.err).toMatch(/使い回さない/)
  for (const bad of ["../x", "a/b", "A", "a_b", ""]) {
    const r = waitAdd(root, bad)
    expect(r.code, bad).toBe(1)
  }
  const long = waitAdd(root, "a".repeat(101))
  expect(long.code).toBe(1)
  expect(long.err).toMatch(/不正な --id/)
  expect(waitAdd(root, "a".repeat(100)).code).toBe(0)
  expect(run(root, ["wait-add", "--slug", "demo", "--id", "c-1"]).err).toMatch(
    /--purpose が必要です/
  )
  run(root, ["stop", "--slug", "demo", "--abandon-waits"])
  const term = waitAdd(root, "d-1")
  expect(term.code).toBe(1)
  expect(term.err).toMatch(/すでに終端状態です/)
})

test("wait-done は報告のファイルがあるときだけ待ちを消し、無い id と報告の無い待ちは失敗する", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  const noReport = run(root, ["wait-done", "--slug", "demo", "--id", "a-1"])
  expect(noReport.code).toBe(1)
  expect(noReport.err).toMatch(/waits\/a-1\.md がありません/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.waits).toHaveLength(1)
  writeWaitReport(root, "a-1")
  const done = run(root, ["wait-done", "--slug", "demo", "--id", "a-1"])
  expect(done.code).toBe(0)
  expect(done.out.state.waits).toEqual([])
  const none = run(root, ["wait-done", "--slug", "demo", "--id", "a-1"])
  expect(none.code).toBe(1)
  expect(none.err).toMatch(/待ち a-1 はありません/)
})

test("wait-done は不正な id を、待ちの有無の判定より先に拒否する", () => {
  const root = tmpProject()
  init(root)
  const r = run(root, ["wait-done", "--slug", "demo", "--id", "../x"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/不正な --id/)
})

test("wait-clear は残りを出力して空にし、終端の run でも通る", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  waitAdd(root, "a-2")
  const r = run(root, ["wait-clear", "--slug", "demo"])
  expect(r.code).toBe(0)
  expect(r.out.cleared.map((w: { id: string }) => w.id)).toEqual(["a-1", "a-2"])
  expect(r.out.state.waits).toEqual([])
  waitAdd(root, "a-3")
  run(root, ["stop", "--slug", "demo", "--abandon-waits"])
  expect(run(root, ["wait-clear", "--slug", "demo"]).code).toBe(0)
})

test("stop は待ちが残っていると失敗し、--abandon-waits を付けたときだけ空にして止める", () => {
  const root = tmpProject()
  init(root)
  waitAdd(root, "a-1")
  const r = run(root, ["stop", "--slug", "demo", "--reason", "x"])
  expect(r.code).toBe(1)
  expect(r.err).toMatch(/待ちが残っています: a-1/)
  expect(run(root, ["get", "--slug", "demo"]).out.state.status).toBe("active")
  const ok = run(root, [
    "stop",
    "--slug",
    "demo",
    "--reason",
    "x",
    "--abandon-waits"
  ])
  expect(ok.code).toBe(0)
  expect(ok.out.state.status).toBe("stopped")
  expect("waits" in ok.out.state).toBe(false)
})

test("waits を持たない state でも get と stop が動く", () => {
  const root = tmpProject()
  init(root)
  expect("waits" in run(root, ["get", "--slug", "demo"]).out.state).toBe(false)
  expect(run(root, ["stop", "--slug", "demo"]).code).toBe(0)
})
