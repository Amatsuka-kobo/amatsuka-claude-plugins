import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path"

export interface FixtureSpec {
  path: string
  content?: string
  from?: string
}

export interface SandboxSpec {
  skillRoot: string
  skillName: string
  includeSkill: boolean
  fixtures: FixtureSpec[]
  fixtureBaseDir: string
}

const excludedDirectories = new Set(["evals", ".git", "node_modules"])

function sandboxPath(root: string, fixturePath: string): string {
  if (isAbsolute(fixturePath))
    throw new Error(`fixture path must be relative: ${fixturePath}`)

  const target = resolve(root, fixturePath)
  const fromRoot = relative(root, target)
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error(`fixture path escapes sandbox: ${fixturePath}`)

  return target
}

async function copySkill(spec: SandboxSpec, sandbox: string): Promise<void> {
  if (!spec.includeSkill) return

  const target = join(sandbox, ".claude", "skills", spec.skillName)
  await mkdir(dirname(target), { recursive: true })
  await cp(spec.skillRoot, target, {
    recursive: true,
    filter: (source) => {
      if (resolve(source) === resolve(spec.skillRoot)) return true
      return !excludedDirectories.has(basename(source))
    }
  })
}

async function writeFixtures(
  spec: SandboxSpec,
  sandbox: string
): Promise<void> {
  for (const fixture of spec.fixtures) {
    const target = sandboxPath(sandbox, fixture.path)
    await mkdir(dirname(target), { recursive: true })

    if (fixture.content !== undefined) {
      await writeFile(target, fixture.content)
      continue
    }
    if (fixture.from !== undefined) {
      const source = resolve(spec.fixtureBaseDir, fixture.from)
      await writeFile(target, await readFile(source))
      continue
    }
    throw new Error(`fixture must define content or from: ${fixture.path}`)
  }
}

export async function buildSandbox(spec: SandboxSpec): Promise<string> {
  const sandbox = await mkdtemp(join(tmpdir(), "output-eval-"))
  try {
    await copySkill(spec, sandbox)
    await writeFixtures(spec, sandbox)
    return sandbox
  } catch (error) {
    await rm(sandbox, { recursive: true, force: true })
    throw error
  }
}
