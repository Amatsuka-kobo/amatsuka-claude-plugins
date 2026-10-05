import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { collectDecisionSubject, joinSections } from "../body"
import { git, makeRepo } from "./helpers/gitRepo"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("joinSections", () => {
  it("見出し行を置いてつなぎ、見出し行の位置を返す", () => {
    expect(
      joinSections([
        { heading: "a", content: "1\n2\n" },
        { heading: "b", content: "3" }
      ])
    ).toEqual({ text: "=== a ===\n1\n2\n=== b ===\n3", headingLines: [0, 3] })
  })
})

describe("collectDecisionSubject", () => {
  it("decision・番号付きの optionsConsidered・rollbackPlan の順に本文へ入れ、sha256 と HEAD を持つ", () => {
    const repo = makeRepo({ "a.md": "a\n" })
    dirs.push(repo)
    const r = collectDecisionSubject({
      projectRoot: repo,
      decision: "A 案を採る",
      optionsConsidered: ["A 案", "B 案"],
      rollbackPlan: "revert する"
    })
    const text = [
      "=== decision ===",
      "A 案を採る",
      "=== optionsConsidered ===",
      "1. A 案",
      "2. B 案",
      "=== rollbackPlan ===",
      "revert する"
    ].join("\n")
    expect(r.body).toEqual({ text, headingLines: [0, 2, 5] })
    expect(r.subject).toEqual({
      repoPath: repo,
      head: git(repo, "rev-parse", "HEAD"),
      files: [],
      contentSha256: createHash("sha256").update(text).digest("hex")
    })
  })

  it("省略した欄の見出しを置かない", () => {
    const repo = makeRepo()
    dirs.push(repo)
    const r = collectDecisionSubject({ projectRoot: repo, decision: "決める" })
    expect(r.body).toEqual({
      text: "=== decision ===\n決める",
      headingLines: [0]
    })
  })
})
