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
 * This file is a TypeScript port of scripts/utils.py from the skill-creator
 * Claude Code plugin. No behavioural changes.
 */

export interface ParsedSkill {
  name: string
  description: string
  content: string
}

/** Python の str.strip(ch) と同じく、先頭と末尾の ch をすべて剥がす。 */
function stripChar(value: string, ch: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === ch) start++
  while (end > start && value[end - 1] === ch) end--
  return value.slice(start, end)
}

function unquote(value: string): string {
  return stripChar(stripChar(value, '"'), "'")
}

const BLOCK_SCALARS = new Set([">", "|", ">-", "|-"])

export function parseSkillMd(content: string): ParsedSkill {
  const lines = content.split("\n")
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
  let name = ""
  let description = ""
  let i = 0

  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (line.startsWith("name:")) {
      name = unquote(line.slice("name:".length).trim())
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim()
      if (BLOCK_SCALARS.has(value)) {
        const continuation: string[] = []
        i++
        while (
          i < frontmatter.length &&
          (frontmatter[i].startsWith("  ") || frontmatter[i].startsWith("\t"))
        ) {
          continuation.push(frontmatter[i].trim())
          i++
        }
        description = continuation.join(" ")
        continue
      }
      description = unquote(value)
    }
    i++
  }

  return { name, description, content }
}
