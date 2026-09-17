/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Replaces the command-file staging in scripts/run_eval.py from the
 * skill-creator Claude Code plugin. Upstream wrote a slash-command file into
 * the real project's .claude/commands/; this writes a project skill into a
 * per-run temporary directory instead.
 */

import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export interface Sandbox {
  dir: string
  cleanup(): Promise<void>
}

export function makeCleanName(skillName: string): string {
  return `${skillName}-skill-${randomBytes(4).toString("hex")}`
}

interface FrontmatterSplit {
  frontmatter: string[]
  body: string[]
}

/** frontmatter の境界を 1 箇所で解く。書き換え関数はどちらもこれを使う。 */
function splitFrontmatter(original: string): FrontmatterSplit {
  const lines = original.split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)")
  }

  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)")
  }

  return { frontmatter: lines.slice(1, endIdx), body: lines.slice(endIdx + 1) }
}

function joinFrontmatter(frontmatter: string[], body: string[]): string {
  return ["---", ...frontmatter, "---", ...body].join("\n")
}

export function buildSandboxSkillMd(
  original: string,
  cleanName: string
): string {
  const { frontmatter, body } = splitFrontmatter(original)
  let sawInvocationKey = false

  const rewritten = frontmatter.map((line) => {
    if (line.startsWith("name:")) return `name: ${cleanName}`
    if (line.startsWith("disable-model-invocation:")) {
      sawInvocationKey = true
      return "disable-model-invocation: false"
    }
    return line
  })

  if (!sawInvocationKey) rewritten.push("disable-model-invocation: false")

  return joinFrontmatter(rewritten, body)
}

/**
 * frontmatter の description を差し替える。ブロックスカラーは単一行へ畳む。
 * 改善ループが反復ごとに新しい description で測るために要る。
 */
const BLOCK_SCALARS = new Set([">", "|", ">-", "|-"])

export function replaceDescription(
  original: string,
  description: string
): string {
  const { frontmatter, body } = splitFrontmatter(original)
  const rewritten: string[] = []
  let i = 0
  let replaced = false

  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (!line.startsWith("description:")) {
      rewritten.push(line)
      i++
      continue
    }

    const value = line.slice("description:".length).trim()
    i++
    if (BLOCK_SCALARS.has(value)) {
      // 継続行は字下げされた行である。段落を分ける空行も同じブロックの一部なので飛ばす。
      // 終わりは、字下げのない非空行(次のキー)か frontmatter の末尾とする。
      while (i < frontmatter.length) {
        const next = frontmatter[i]
        if (next.trim() === "") {
          i++
          continue
        }
        if (next.startsWith("  ") || next.startsWith("\t")) {
          i++
          continue
        }
        break
      }
    }
    rewritten.push(`description: ${JSON.stringify(description)}`)
    replaced = true
  }

  if (!replaced) rewritten.push(`description: ${JSON.stringify(description)}`)

  return joinFrontmatter(rewritten, body)
}

const ancestorClaudeChecks = new Map<string, Promise<void>>()

async function findAncestorClaude(dir: string): Promise<string | undefined> {
  let current = await realpath(dirname(dir))

  while (true) {
    const candidate = join(current, ".claude")
    try {
      await realpath(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    const parent = await realpath(dirname(current))
    if (parent === current) return undefined
    current = parent
  }
}

async function assertIsolatedWorkspace(dir: string): Promise<void> {
  const tmpdirKey = await realpath(tmpdir())
  let check = ancestorClaudeChecks.get(tmpdirKey)
  if (!check) {
    check = (async () => {
      const claudeDir = await findAncestorClaude(dir)
      if (claudeDir) {
        throw new Error(
          `一時ディレクトリの祖先に ${claudeDir} が見つかりました。` +
            "TMPDIR を .claude を持たない場所へ変える必要があります。"
        )
      }
    })()
    ancestorClaudeChecks.set(tmpdirKey, check)
  }
  await check
}

export async function createIsolatedWorkspace(): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "prompt-smith-cwd-"))
  try {
    await assertIsolatedWorkspace(dir)
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }

  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

export async function createSandbox(
  skillMd: string,
  cleanName: string
): Promise<Sandbox> {
  const sandbox = await createIsolatedWorkspace()
  const skillDir = join(sandbox.dir, ".claude", "skills", cleanName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8")
  return sandbox
}
