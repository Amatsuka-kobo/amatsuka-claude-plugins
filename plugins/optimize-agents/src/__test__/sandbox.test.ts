import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { buildSandbox } from "../lib/sandbox.js"

const directories: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

async function createSkill(files: Record<string, string>): Promise<string> {
  const root = await temporaryDirectory("sandbox-skill-")
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(join(target, ".."), { recursive: true })
    await writeFile(target, content)
  }
  return root
}

async function build(
  skillRoot: string,
  includeSkill: boolean,
  fixtures: Parameters<typeof buildSandbox>[0]["fixtures"] = [],
  fixtureBaseDir = skillRoot
): Promise<string> {
  const sandbox = await buildSandbox({
    skillRoot,
    skillName: "sample",
    includeSkill,
    fixtures,
    fixtureBaseDir
  })
  directories.push(sandbox)
  return sandbox
}

async function content(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test("プラグイン形態では SKILL.md と同梱物を配置する", async () => {
  const skill = await createSkill({
    "SKILL.md": "skill",
    "scripts/x.mjs": "script"
  })
  const sandbox = await build(skill, true)
  expect(await content(join(sandbox, ".claude/skills/sample/SKILL.md"))).toBe(
    "skill"
  )
  expect(
    await content(join(sandbox, ".claude/skills/sample/scripts/x.mjs"))
  ).toBe("script")
})

test("単独スキル形態では SKILL.md を配置する", async () => {
  const skill = await createSkill({ "SKILL.md": "single" })
  const sandbox = await build(skill, true)
  expect(await content(join(sandbox, ".claude/skills/sample/SKILL.md"))).toBe(
    "single"
  )
})

test("evals ディレクトリを除外する", async () => {
  const skill = await createSkill({
    "SKILL.md": "skill",
    "evals/output-evals.json": "{}"
  })
  const sandbox = await build(skill, true)
  expect(
    await content(
      join(sandbox, ".claude/skills/sample/evals/output-evals.json")
    )
  ).toBeNull()
})

test(".git ディレクトリを除外する", async () => {
  const skill = await createSkill({
    "SKILL.md": "skill",
    ".git/config": "config"
  })
  const sandbox = await build(skill, true)
  expect(
    await content(join(sandbox, ".claude/skills/sample/.git/config"))
  ).toBeNull()
})

test("includeSkill false では .claude/skills を作らない", async () => {
  const skill = await createSkill({ "SKILL.md": "skill" })
  const sandbox = await build(skill, false)
  expect(
    await content(join(sandbox, ".claude/skills/sample/SKILL.md"))
  ).toBeNull()
})

test("content fixture を指定パスへ書く", async () => {
  const skill = await createSkill({ "SKILL.md": "skill" })
  const sandbox = await build(skill, true, [
    { path: "input/data.txt", content: "fixture" }
  ])
  expect(await content(join(sandbox, "input/data.txt"))).toBe("fixture")
})

test("from fixture を基準ディレクトリからコピーする", async () => {
  const skill = await createSkill({ "SKILL.md": "skill" })
  const fixtureBase = await temporaryDirectory("sandbox-fixture-")
  await writeFile(join(fixtureBase, "source.txt"), "copied")
  const sandbox = await build(
    skill,
    true,
    [{ path: "input/copied.txt", from: "./source.txt" }],
    fixtureBase
  )
  expect(await content(join(sandbox, "input/copied.txt"))).toBe("copied")
})

test("includeSkill false でも fixture を配置する", async () => {
  const skill = await createSkill({ "SKILL.md": "skill" })
  const sandbox = await build(skill, false, [
    { path: "input/data.txt", content: "fixture" }
  ])
  expect(await content(join(sandbox, "input/data.txt"))).toBe("fixture")
})

test("ネストした fixture の親ディレクトリを作る", async () => {
  const skill = await createSkill({ "SKILL.md": "skill" })
  const sandbox = await build(skill, true, [
    { path: "docs/chat/2026/0801/x.md", content: "record" }
  ])
  expect(await content(join(sandbox, "docs/chat/2026/0801/x.md"))).toBe(
    "record"
  )
})
