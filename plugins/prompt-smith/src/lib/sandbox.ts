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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface Sandbox {
  dir: string
  cleanup(): Promise<void>
}

export function makeCleanName(skillName: string): string {
  return `${skillName}-skill-${randomBytes(4).toString("hex")}`
}

export function buildSandboxSkillMd(original: string, cleanName: string): string {
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

  const frontmatter = lines.slice(1, endIdx)
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

  return ["---", ...rewritten, "---", ...lines.slice(endIdx + 1)].join("\n")
}

/**
 * frontmatter の description を差し替える。ブロックスカラーは単一行へ畳む。
 * 改善ループが反復ごとに新しい description で測るために要る。
 */
export function replaceDescription(original: string, description: string): string {
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

  const frontmatter = lines.slice(1, endIdx)
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
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      while (i < frontmatter.length && (frontmatter[i].startsWith("  ") || frontmatter[i].startsWith("\t"))) {
        i++
      }
    }
    rewritten.push(`description: ${JSON.stringify(description)}`)
    replaced = true
  }

  if (!replaced) rewritten.push(`description: ${JSON.stringify(description)}`)

  return ["---", ...rewritten, "---", ...lines.slice(endIdx + 1)].join("\n")
}

export async function createSandbox(skillMd: string, cleanName: string): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "prompt-smith-eval-"))
  const skillDir = join(dir, ".claude", "skills", cleanName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8")
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}
