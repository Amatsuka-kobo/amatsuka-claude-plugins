import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { findActiveRun, GATED, SKIPPABLE, STAGES } from "../codiel-state.js"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const CLI = fileURLToPath(new URL("../codiel-state-cli.ts", import.meta.url))

const UNTIL_PR = [
  "intent",
  "discuss",
  "design",
  "test-spec",
  "dev-plan",
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

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codiel-state-"))
}

// 終了コードにかかわらず stdout と stderr を返す(get --active は成功時にも stderr に書く)
function run(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd,
    encoding: "utf8"
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

test("STAGES は 12 ステージで、intent-sync が test-loop と pr の間のゲート対象フェーズである", () => {
  expect(STAGES).toStrictEqual([
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
  ])
  expect([...GATED].sort()).toStrictEqual([
    "design",
    "dev-plan",
    "fix-loop",
    "implement",
    "intent",
    "intent-sync",
    "test-loop",
    "test-spec"
  ])
  expect([...SKIPPABLE].sort()).toStrictEqual(["design", "discuss", "fix-loop"])
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
  run(root, ["skip-phase", "discuss", "--slug", "demo", "--reason", "軽量"])
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

test("get --active は v1 の run を runs に含めず、未終端の v1 の run ごとに文言を stderr に出す", () => {
  const root = tmpProject()
  writeV1(root, 1, "active")
  writeV1(root, 2, "awaiting_outcome")
  writeV1(root, 3, "stopped")
  init(root)
  fs.writeFileSync(path.join(root, ".codiel/runs/.gitkeep"), "")
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(
    r.out.runs.map((x: { state: { runId: string } }) => x.state.runId)
  ).toStrictEqual(["demo"])
  const lines = r.err.split("\n").filter((l) => l !== "")
  expect(lines.sort()).toStrictEqual(
    [v1Message(1, "active"), v1Message(2, "awaiting_outcome")].sort()
  )
})

test("findActiveRun は version 2 の run だけを返し、runs 直下のファイルと v1 の run を無視する", () => {
  const root = tmpProject()
  writeV1(root, 5, "active")
  fs.writeFileSync(path.join(root, ".codiel/runs/.gitkeep"), "")
  expect(findActiveRun(root)).toBeNull()
  init(root)
  const found = findActiveRun(root)
  expect(found?.state.runId).toBe("demo")
  expect(found?.dir).toBe(path.join(root, ".codiel/runs/demo/try-1"))
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

// テストヘルパー
function passGate(
  root: string,
  phase: string,
  verdict: string,
  extra: string[] = []
) {
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
