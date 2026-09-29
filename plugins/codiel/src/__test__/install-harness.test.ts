import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const SCRIPT = fileURLToPath(
  new URL("../../scripts/install-harness.sh", import.meta.url)
)

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "install-harness-"))
}
function run(target: string): string {
  return execFileSync("bash", [SCRIPT, target], { encoding: "utf8" })
}

test(".codiel/runs と .codiel/reports を作成する", () => {
  const root = tmpProject()
  run(root)
  for (const d of [".codiel/runs", ".codiel/reports"]) {
    expect(fs.existsSync(path.join(root, d)), `${d} がない`).toBeTruthy()
  }
})

test(".codiel 配下は runs・reports・config.json だけを作る", () => {
  const root = tmpProject()
  run(root)
  expect(fs.readdirSync(path.join(root, ".codiel")).sort()).toEqual([
    "config.json",
    "reports",
    "runs"
  ])
})

test(".codiel/config.json が無ければ既定値で作る", () => {
  const root = tmpProject()
  run(root)
  const config = path.join(root, ".codiel/config.json")
  expect(fs.existsSync(config), ".codiel/config.json がない").toBeTruthy()
  expect(JSON.parse(fs.readFileSync(config, "utf8"))).toEqual({
    testsDir: "docs/codiel/tests",
    runsDir: "docs/codiel/runs"
  })
})

test("既存の .codiel/config.json を変更しない", () => {
  const root = tmpProject()
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true })
  fs.writeFileSync(
    path.join(root, ".codiel/config.json"),
    '{"testsDir":"e2e/tests"}'
  )
  run(root)
  expect(fs.readFileSync(path.join(root, ".codiel/config.json"), "utf8")).toBe(
    '{"testsDir":"e2e/tests"}'
  )
})

test("config.json の raguel と .gitignore は書かない。ARCHITECTURE / CLAUDE.md / raguel.config.yaml も作成しない", () => {
  const root = tmpProject()
  run(root)
  expect(
    fs.existsSync(path.join(root, "docs/ARCHITECTURE.md")),
    "ARCHITECTURE.md を作ってはいけない"
  ).toBeFalsy()
  expect(
    fs.existsSync(path.join(root, "CLAUDE.md")),
    "CLAUDE.md を作ってはいけない"
  ).toBeFalsy()
  expect(
    fs.existsSync(path.join(root, "raguel.config.yaml")),
    "raguel.config.yaml を作ってはいけない"
  ).toBeFalsy()
  expect(
    fs.existsSync(path.join(root, ".gitignore")),
    ".gitignore を作ってはいけない"
  ).toBeFalsy()
  const config = JSON.parse(
    fs.readFileSync(path.join(root, ".codiel/config.json"), "utf8")
  )
  expect(Object.hasOwn(config, "raguel"), "raguel を書いてはいけない").toBe(
    false
  )
})

test("GOTCHAS.md は作成しない(台帳の生成は metatron が行う)", () => {
  const root = tmpProject()
  run(root)
  expect(
    fs.existsSync(path.join(root, "docs/GOTCHAS.md")),
    "GOTCHAS.md を作ってはいけない"
  ).toBeFalsy()
})

test("既存の GOTCHAS.md を変更しない", () => {
  const root = tmpProject()
  fs.mkdirSync(path.join(root, "docs"), { recursive: true })
  fs.writeFileSync(path.join(root, "docs/GOTCHAS.md"), "既存の内容")
  run(root)
  expect(fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8")).toBe(
    "既存の内容"
  )
})
