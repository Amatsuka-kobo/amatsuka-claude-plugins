import { expect, test } from "vitest"
import {
  extractBashResult,
  isArtifactPath,
  matchTestCommand,
  summarizeOutput
} from "../capture-rules.js"

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

test("既定ホワイトリストのコマンドに前方一致でマッチする", () => {
  expect(matchTestCommand("pnpm test")).toBe("pnpm test")
  expect(
    matchTestCommand(
      "pnpm vitest run plugins/pitcrew/src/lib/__test__/a.test.ts"
    )
  ).toBe("pnpm vitest")
  expect(matchTestCommand("npm run build --workspace x")).toBe("npm run build")
  expect(matchTestCommand("git status")).toBeNull()
  expect(matchTestCommand("echo pnpm test")).toBeNull()
})

test("extractBashResult は stdout/stderr を連結し失敗を推定する", () => {
  expect(extractBashResult({ stdout: "1 passed", stderr: "" })).toEqual({
    output: "1 passed",
    failed: false
  })
  expect(
    extractBashResult({ stdout: "Tests: 1 failed", stderr: "" }).failed
  ).toBe(true)
  expect(
    extractBashResult({ stdout: "Found 1 error.", stderr: "" }).failed
  ).toBe(true)
  expect(extractBashResult("plain output").output).toBe("plain output")
  expect(extractBashResult(null)).toEqual({ output: "", failed: false })
})

test("summarizeOutput は末尾 N 行に切り詰めて注記する", () => {
  const long = Array.from({ length: 300 }, (_, i) => `line${i}`).join("\n")
  const out = summarizeOutput(long, 100)
  expect(out.split("\n").length).toBeLessThanOrEqual(102)
  expect(out).toContain("line299")
  expect(out).not.toContain("line0\n")
  expect(out).toContain("省略")
  expect(summarizeOutput("short", 100)).toBe("short")
})

test("isArtifactPath は glob 指定で対象を置き換えられる", () => {
  expect(isArtifactPath("notes/memo.md", ["notes/**/*.md"])).toBe(true)
  expect(isArtifactPath("docs/design.md", ["notes/**/*.md"])).toBe(false)
  expect(isArtifactPath("docs/specs/x.md", ["docs/specs/*.md"])).toBe(true)
  expect(isArtifactPath("docs/other/x.md", ["docs/specs/*.md"])).toBe(false)
})

test("glob 指定でも docs/chat/ の除外は常に効く", () => {
  expect(isArtifactPath("docs/chat/2026/x.md", ["docs/**/*.md"])).toBe(false)
  expect(isArtifactPath("docs/chat/2026/x.md", ["**/*.md"])).toBe(false)
})

test("matchTestCommand は追加接頭辞にもマッチする", () => {
  expect(matchTestCommand("deno test", ["deno test"])).toBe("deno test")
  expect(matchTestCommand("deno test --allow-read x.ts", ["deno test"])).toBe(
    "deno test"
  )
  expect(matchTestCommand("deno test", [])).toBeNull()
  // 既定ホワイトリストは追加指定があっても生きている
  expect(matchTestCommand("pnpm test", ["deno test"])).toBe("pnpm test")
})
