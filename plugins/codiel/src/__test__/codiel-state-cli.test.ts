import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { raguelConfigPath, runCli } from "./helpers/run-cli.js"

// メインの作業ツリー(git のリポジトリと Raguel の設定)を作り、run を 1 本 init する
function mainWithRun(slug = "demo"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codiel-state-cli-"))
  for (const args of [
    ["init", "-q"],
    ["commit", "-q", "--allow-empty", "-m", "init"]
  ]) {
    const r = spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
      { cwd: root, encoding: "utf8" }
    )
    if (r.status !== 0) throw new Error(r.stderr)
  }
  fs.mkdirSync(path.join(root, ".raguel"))
  fs.writeFileSync(
    raguelConfigPath(root),
    JSON.stringify({
      storage: { casesDir: path.join(root, ".raguel"), projectId: "demo" }
    })
  )
  const r = runCli(root, [
    "init",
    "--slug",
    slug,
    "--intent",
    "docs/intents/2026-11-12-demo.md",
    "--integration",
    "local",
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
  ])
  if (r.code !== 0) throw new Error(r.err)
  return root
}

test("worktree の中の cwd でも、メインのルートの run を読む", () => {
  const root = mainWithRun()
  const wt = path.join(root, ".codiel/worktrees/demo/step-1/src")
  fs.mkdirSync(wt, { recursive: true })
  const fromMain = runCli(root, ["get", "--slug", "demo"])
  const fromWt = runCli(wt, ["get", "--slug", "demo"], root)
  expect(fromWt.code).toBe(0)
  expect(fromWt.out.state).toEqual(fromMain.out.state)
  expect(fs.realpathSync(fromWt.out.statePath)).toBe(
    fs.realpathSync(fromMain.out.statePath)
  )
})

test("メインのサブディレクトリの cwd でも、同じ run を読む", () => {
  const root = mainWithRun()
  const sub = path.join(root, "src")
  fs.mkdirSync(sub)
  const r = runCli(sub, ["get", "--slug", "demo"], root)
  expect(r.code).toBe(0)
  expect(r.out.state).toEqual(runCli(root, ["get", "--slug", "demo"]).out.state)
})

test(".codiel の無いディレクトリでは、従来どおり cwd を基準にする", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codiel-state-cli-bare-"))
  const r = runCli(dir, ["config"], dir)
  expect(r.code).toBe(0)
  expect(fs.existsSync(path.join(dir, ".codiel"))).toBe(false)
})

test("worktree の中の cwd の wait-add は、メインの run に書く", () => {
  const root = mainWithRun()
  const wt = path.join(root, ".codiel/worktrees/demo/step-1/src")
  fs.mkdirSync(wt, { recursive: true })
  const r = runCli(
    wt,
    ["wait-add", "--slug", "demo", "--id", "implement-1-1", "--purpose", "p"],
    root
  )
  expect(r.code).toBe(0)
  expect(fs.existsSync(path.join(wt, ".codiel"))).toBe(false)
  const main = runCli(root, ["get", "--slug", "demo"])
  expect(main.out.state.waits).toHaveLength(1)
  expect(fs.existsSync(path.join(root, ".codiel/runs/demo"))).toBe(true)
})
