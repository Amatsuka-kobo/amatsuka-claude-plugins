import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  init,
  run,
  statePath,
  tmpProject,
  UNTIL_FINALIZE
} from "./helpers/codiel-state-fixtures.js"

test("init は slug から識別子を作り、version 2 の state を書く", () => {
  const root = tmpProject()
  const r = init(root, "demo", {}, ["--base-branch", "main"])
  expect(r.code).toBe(0)
  const st = r.out.state
  expect(st.version).toBe(2)
  expect(st.runId).toBe("demo")
  expect(st.try).toBe(1)
  expect(st.branch).toBe("codiel/demo")
  expect(st.raguelRunId).toBe("demo-try-1")
  expect(st.intent).toBe("docs/intents/2026-09-27-demo.md")
  expect(st.issue).toBeNull()
  expect(st.integration).toBe("github")
  expect(st.scale).toBe("standard")
  expect(st.knowledgeTarget).toBe("metatron")
  expect(st.imageUpload).toStrictEqual({ ghAttach: true, chrome: true })
  expect(st.baseBranch).toBe("main")
  expect(st.status).toBe("active")
  expect(st.phase).toBeNull()
  expect(st.pr).toStrictEqual({ url: null })
  expect(Object.keys(st.phases)).toStrictEqual([
    "intent",
    "carry-over",
    ...UNTIL_FINALIZE.slice(1),
    "finalize"
  ])
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
    "--knowledge-target",
    "metatron",
    "--adr-candidates",
    "on",
    "--gotcha-candidates",
    "on",
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
  // 同時に進められる run は 1 つだけなので、次の init の前に止める(C3-09)
  expect(init(root, max).code).toBe(0)
  run(root, ["stop", "--slug", max, "--reason", "test"])
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

// --- knowledgeTarget ---

test("init は --knowledge-target を必須とし、metatron と intents だけを記録する", () => {
  const root = tmpProject()
  const missing = init(root, "demo", { "knowledge-target": null })
  expect(missing.code).toBe(1)
  expect(missing.err).toMatch(/--knowledge-target が必要です/)
  const bad = init(root, "demo", { "knowledge-target": "adr" })
  expect(bad.code).toBe(1)
  expect(bad.err).toMatch(/不正な --knowledge-target: adr/)
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
  expect(
    init(root, "one", { "knowledge-target": "metatron" }).out.state
      .knowledgeTarget
  ).toBe("metatron")
  run(root, ["stop", "--slug", "one", "--reason", "test"])
  expect(
    init(root, "two", { "knowledge-target": "intents" }).out.state
      .knowledgeTarget
  ).toBe("intents")
  const saved = JSON.parse(fs.readFileSync(statePath(root, "two"), "utf8"))
  expect(saved.knowledgeTarget).toBe("intents")
})

// --- candidates ---

test("init は --adr-candidates と --gotcha-candidates を必須とし、on と off だけを記録する", () => {
  const root = tmpProject()
  for (const [flag, key] of [
    ["adr-candidates", "--adr-candidates"],
    ["gotcha-candidates", "--gotcha-candidates"]
  ]) {
    const missing = init(root, "demo", { [flag]: null })
    expect(missing.code).toBe(1)
    expect(missing.err).toMatch(new RegExp(`${key} が必要です`))
    const bad = init(root, "demo", { [flag]: "true" })
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(new RegExp(`不正な ${key}: true`))
  }
  expect(fs.existsSync(statePath(root, "demo"))).toBe(false)
  const mixed = init(root, "one", {
    "adr-candidates": "on",
    "gotcha-candidates": "off"
  })
  expect(mixed.out.state.candidates).toStrictEqual({
    adr: true,
    gotchas: false
  })
  run(root, ["stop", "--slug", "one", "--reason", "test"])
  init(root, "two", { "adr-candidates": "off", "gotcha-candidates": "on" })
  const saved = JSON.parse(fs.readFileSync(statePath(root, "two"), "utf8"))
  expect(saved.candidates).toStrictEqual({ adr: false, gotchas: true })
})

test("candidates を持たない state は、両方 false として読む", () => {
  const root = tmpProject()
  init(root, "demo")
  const p = statePath(root, "demo")
  const saved = JSON.parse(fs.readFileSync(p, "utf8"))
  delete saved.candidates
  fs.writeFileSync(p, JSON.stringify(saved))
  const got = run(root, ["get", "--slug", "demo"])
  expect(got.code).toBe(0)
  expect(got.out.state.candidates).toStrictEqual({
    adr: false,
    gotchas: false
  })
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
    run(root, ["stop", "--slug", `img-${i}`, "--reason", "test"])
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
    run(root, ["stop", "--slug", `local-${i}`, "--reason", "test"])
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
  run(root, ["stop", "--slug", "one", "--reason", "test"])
  const unscoped = init(root, "two", {}, ["--domain-mode", "unscoped"])
  run(root, ["stop", "--slug", "two", "--reason", "test"])
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
  expect(r.out.state.branch).toBe("codiel/demo")
  expect(r.out.state.raguelRunId).toBe("demo-try-2")
  expect(fs.existsSync(statePath(root, "demo", 2))).toBe(true)
})

test("別の slug に未完了の run があると init が失敗し、その run を終端にした後は通る(C3-09)", () => {
  const root = tmpProject()
  expect(init(root, "first").code).toBe(0)
  const blocked = init(root, "second")
  expect(blocked.code).toBe(1)
  expect(blocked.err).toMatch(/first/)
  expect(fs.existsSync(statePath(root, "second"))).toBe(false)
  expect(run(root, ["stop", "--slug", "first", "--reason", "test"]).code).toBe(
    0
  )
  expect(init(root, "second").code).toBe(0)
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
