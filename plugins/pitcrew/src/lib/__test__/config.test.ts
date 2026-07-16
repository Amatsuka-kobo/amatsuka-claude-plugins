import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  configPath,
  DEFAULT_ARTIFACT_GLOBS,
  DEFAULT_PORT,
  loadConfig
} from "../config.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-config-"))
}

function writeConfig(dir: string, frontmatter: string): void {
  const claudeDir = path.join(dir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    `---\n${frontmatter}\n---\n\n# pitcrew 設定\n`
  )
}

test("設定ファイルが無ければ全項目が既定値", () => {
  const dir = makeProject()
  try {
    const cfg = loadConfig(dir)
    expect(cfg).toEqual({
      viewer: "files",
      captureTargets: { diff: true, artifact: true, test: true },
      artifactGlobs: DEFAULT_ARTIFACT_GLOBS,
      testCommands: [],
      injectionTiming: "hybrid",
      theme: "device",
      port: DEFAULT_PORT
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("configPath は .claude/pitcrew.local.md を指す", () => {
  expect(configPath("/proj")).toBe(
    path.join("/proj", ".claude", "pitcrew.local.md")
  )
})

test("全キーを読み取れる", () => {
  const dir = makeProject()
  try {
    writeConfig(
      dir,
      [
        "viewer: browser",
        "capture_targets: [diff, test]",
        'artifact_globs: ["docs/specs/*.md", "notes/**/*.md"]',
        'test_commands: ["deno test", "bun test"]',
        "injection_timing: immediate",
        "theme: dark",
        'port: "8080"'
      ].join("\n")
    )
    const cfg = loadConfig(dir)
    expect(cfg.viewer).toBe("browser")
    expect(cfg.captureTargets).toEqual({
      diff: true,
      artifact: false,
      test: true
    })
    expect(cfg.artifactGlobs).toEqual(["docs/specs/*.md", "notes/**/*.md"])
    expect(cfg.testCommands).toEqual(["deno test", "bun test"])
    expect(cfg.injectionTiming).toBe("immediate")
    expect(cfg.theme).toBe("dark")
    expect(cfg.port).toBe(8080)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正値・未知キーは既定値へフォールバックする", () => {
  const dir = makeProject()
  try {
    writeConfig(
      dir,
      [
        "viewer: vscode",
        "injection_timing: sometimes",
        "theme: sepia",
        "port: abc",
        "unknown_key: x"
      ].join("\n")
    )
    const cfg = loadConfig(dir)
    expect(cfg.viewer).toBe("files")
    expect(cfg.injectionTiming).toBe("hybrid")
    expect(cfg.theme).toBe("device")
    expect(cfg.port).toBe(DEFAULT_PORT)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("port は 1〜65535 の範囲外なら既定値", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, 'port: "70000"')
    expect(loadConfig(dir).port).toBe(DEFAULT_PORT)
    writeConfig(dir, 'port: "0"')
    expect(loadConfig(dir).port).toBe(DEFAULT_PORT)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("capture_targets の空配列は 3 種すべて無効を意味する", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "capture_targets: []")
    expect(loadConfig(dir).captureTargets).toEqual({
      diff: false,
      artifact: false,
      test: false
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("artifact_globs の空配列は無視して既定を保つ", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "artifact_globs: []")
    expect(loadConfig(dir).artifactGlobs).toEqual(DEFAULT_ARTIFACT_GLOBS)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter が壊れていても既定値で返す(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const claudeDir = path.join(dir, ".claude")
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(
      path.join(claudeDir, "pitcrew.local.md"),
      "frontmatter なしの本文だけ\n"
    )
    expect(loadConfig(dir).injectionTiming).toBe("hybrid")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
