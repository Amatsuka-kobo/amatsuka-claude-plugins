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

test(".codiel 配下のディレクトリと GOTCHAS.md 雛形を作成する", () => {
  const root = tmpProject()
  run(root)
  for (const d of [".codiel/specs", ".codiel/runs", ".codiel/reports"]) {
    expect(fs.existsSync(path.join(root, d)), `${d} がない`).toBeTruthy()
  }
  const gotchas = fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8")
  expect(gotchas).toMatch(/^# GOTCHAS/)
})

test("ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml は作成しない(initializing-harness スキルが生成する)", () => {
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
})

test("既存の GOTCHAS.md は上書きしない(copy-if-absent)", () => {
  const root = tmpProject()
  fs.mkdirSync(path.join(root, "docs"), { recursive: true })
  fs.writeFileSync(path.join(root, "docs/GOTCHAS.md"), "既存の内容")
  const out = run(root)
  expect(fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8")).toBe(
    "既存の内容"
  )
  expect(out).toMatch(/skip\(既存\)/)
})
