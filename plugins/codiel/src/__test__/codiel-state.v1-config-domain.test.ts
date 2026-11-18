import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { findActiveRun, readCodielConfig } from "../codiel-state.js"
import {
  fullRun,
  INIT_DEFAULTS,
  init,
  run,
  statePath,
  tmpProject
} from "./helpers/codiel-state-fixtures.js"

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

test("findActiveRun と get --active は、別 slug の壊れた state を飛ばして正常な run を返す", () => {
  const root = tmpProject()
  expect(init(root, "good").code).toBe(0)
  const broken = path.join(root, ".codiel/runs/broken/try-1")
  fs.mkdirSync(broken, { recursive: true })
  fs.writeFileSync(path.join(broken, "state.json"), "{ not json")
  const noPhases = path.join(root, ".codiel/runs/no-phases/try-1")
  fs.mkdirSync(noPhases, { recursive: true })
  fs.writeFileSync(
    path.join(noPhases, "state.json"),
    JSON.stringify({ version: 2, runId: "no-phases", status: "active" })
  )
  expect(findActiveRun(root)?.state.runId).toBe("good")
  const r = run(root, ["get", "--active"])
  expect(r.code).toBe(0)
  expect(
    r.out.runs.map((x: { state: { runId: string } }) => x.state.runId)
  ).toEqual(["good"])
  expect(r.err).toMatch(/broken/)
  expect(r.err).toMatch(/no-phases/)
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
  // M4 より前の run は init の検査(C3-09)に数えないので、先に置いてから demo を作る
  const olds = [
    writePreM4(root, "old", "active"),
    writePreM4(root, "asked", "awaiting_human")
  ]
  init(root)
  // demo より後に更新された M4 より前の run があっても、demo を返す
  for (const p of olds) {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"))
    raw.updatedAt = "9999-01-01T00:00:00.000Z"
    fs.writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`)
  }
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
    "knowledgeTarget",
    "candidates",
    "status",
    "phase",
    "phases",
    "pr",
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
