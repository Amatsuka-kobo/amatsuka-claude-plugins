/**
 * 見出し行でつないだ検査の本文を組む。evaluate_decision の本文(設計書 §6.2.4)もここで組む。
 */
import { readHead, resolveRepoPath, sha256Hex } from "./code"
import type { Subject, SubjectBody } from "./types"

export interface Section {
  heading: string
  content: string
}

/** 各セクションの前に見出し行 `=== <heading> ===` を置いてつなぎ、見出し行の位置を持つ */
export function joinSections(sections: Section[]): SubjectBody {
  const lines: string[] = []
  const headingLines: number[] = []
  for (const { heading, content } of sections) {
    headingLines.push(lines.length)
    lines.push(`=== ${heading} ===`)
    lines.push(...content.replace(/\n$/, "").split("\n"))
  }
  return { text: lines.join("\n"), headingLines }
}

export interface DecisionSubjectInput {
  projectRoot: string
  repoPath?: string
  decision: string
  optionsConsidered?: string[]
  rollbackPlan?: string
}

/** decision・optionsConsidered(番号付きの行)・rollbackPlan をこの順につなぐ */
export function collectDecisionSubject(input: DecisionSubjectInput): {
  subject: Subject
  body: SubjectBody
} {
  const repoPath = resolveRepoPath(input.repoPath, input.projectRoot)
  const sections: Section[] = [{ heading: "decision", content: input.decision }]
  if (input.optionsConsidered && input.optionsConsidered.length > 0) {
    sections.push({
      heading: "optionsConsidered",
      content: input.optionsConsidered
        .map((o, i) => `${i + 1}. ${o}`)
        .join("\n")
    })
  }
  if (input.rollbackPlan !== undefined && input.rollbackPlan !== "") {
    sections.push({ heading: "rollbackPlan", content: input.rollbackPlan })
  }
  const body = joinSections(sections)
  return {
    subject: {
      repoPath,
      head: readHead(repoPath),
      files: [],
      contentSha256: sha256Hex(body.text)
    },
    body
  }
}
