import { expect, test } from "vitest"
import { isArtifactPath } from "../capture-rules.js"

test("docs/ 配下の .md は成果物", () => {
  expect(isArtifactPath("docs/design.md")).toBe(true)
  expect(isArtifactPath("docs/superpowers/specs/x.md")).toBe(true)
})

test("docs/chat/ 配下は除外", () => {
  expect(isArtifactPath("docs/chat/2026/0716/x.md")).toBe(false)
})

test("docs/ 外や .md 以外は成果物でない", () => {
  expect(isArtifactPath("src/a.ts")).toBe(false)
  expect(isArtifactPath("README.md")).toBe(false)
  expect(isArtifactPath("docs/image.png")).toBe(false)
})

test("Windows 区切りでも判定できる", () => {
  expect(isArtifactPath("docs\\design.md")).toBe(true)
})
