import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  configPath,
  DEFAULT_ARTIFACT_GLOBS,
  DEFAULT_PORT,
  loadConfig,
  saveConfig,
  validateConfig
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

// ---- validateConfig / saveConfig(Stage 4.2)----

function validInput(): Record<string, unknown> {
  return {
    viewer: "browser",
    captureTargets: { diff: true, artifact: false, test: true },
    artifactGlobs: ["docs/**/*.md", "notes/*.md"],
    testCommands: ["deno test"],
    injectionTiming: "immediate",
    theme: "dark",
    port: 8080
  }
}

test("validateConfig: 正常な入力で config を返す", () => {
  const result = validateConfig(validInput())
  expect(result).toEqual({
    config: {
      viewer: "browser",
      captureTargets: { diff: true, artifact: false, test: true },
      artifactGlobs: ["docs/**/*.md", "notes/*.md"],
      testCommands: ["deno test"],
      injectionTiming: "immediate",
      theme: "dark",
      port: 8080
    }
  })
})

test("validateConfig: オブジェクトでない入力は config エラー", () => {
  expect(validateConfig(null)).toEqual({ error: "config" })
  expect(validateConfig("x")).toEqual({ error: "config" })
  expect(validateConfig([])).toEqual({ error: "config" })
})

test("validateConfig: viewer の列挙値違反", () => {
  const input = { ...validInput(), viewer: "web" }
  expect(validateConfig(input)).toEqual({ error: "viewer" })
})

test("validateConfig: captureTargets の型違反", () => {
  expect(validateConfig({ ...validInput(), captureTargets: null })).toEqual({
    error: "captureTargets"
  })
  expect(
    validateConfig({
      ...validInput(),
      captureTargets: { diff: true, artifact: "yes", test: true }
    })
  ).toEqual({ error: "captureTargets" })
})

test("validateConfig: glob 要素のカンマ混入", () => {
  const input = { ...validInput(), artifactGlobs: ["a.md", "b,c.md"] }
  expect(validateConfig(input)).toEqual({ error: "artifactGlobs" })
})

test("validateConfig: glob 要素の改行混入", () => {
  const input = { ...validInput(), artifactGlobs: ["a\n.md"] }
  expect(validateConfig(input)).toEqual({ error: "artifactGlobs" })
})

test("validateConfig: artifactGlobs 空配列は不可", () => {
  const input = { ...validInput(), artifactGlobs: [] }
  expect(validateConfig(input)).toEqual({ error: "artifactGlobs" })
})

test("validateConfig: testCommands は空配列可・空文字列要素は不可", () => {
  expect(
    "config" in validateConfig({ ...validInput(), testCommands: [] })
  ).toBe(true)
  expect(validateConfig({ ...validInput(), testCommands: [""] })).toEqual({
    error: "testCommands"
  })
})

test("validateConfig: injectionTiming / theme の列挙値違反", () => {
  expect(validateConfig({ ...validInput(), injectionTiming: "later" })).toEqual(
    {
      error: "injectionTiming"
    }
  )
  expect(validateConfig({ ...validInput(), theme: "auto" })).toEqual({
    error: "theme"
  })
})

test("validateConfig: port 範囲外・非整数", () => {
  expect(validateConfig({ ...validInput(), port: 0 })).toEqual({
    error: "port"
  })
  expect(validateConfig({ ...validInput(), port: 65536 })).toEqual({
    error: "port"
  })
  expect(validateConfig({ ...validInput(), port: 7373.5 })).toEqual({
    error: "port"
  })
  expect(validateConfig({ ...validInput(), port: "7373" })).toEqual({
    error: "port"
  })
})

test("validateConfig: フィールド欠落はそのフィールド名を返す", () => {
  const input = validInput()
  delete input.theme
  expect(validateConfig(input)).toEqual({ error: "theme" })
})

test("validateConfig: 複数違反時は定義順で最初の 1 件", () => {
  // viewer と port が同時に違反 → 定義順で先の viewer が返る
  const input = { ...validInput(), viewer: "web", port: 0 }
  expect(validateConfig(input)).toEqual({ error: "viewer" })
})

test("saveConfig → loadConfig ラウンドトリップ", () => {
  const dir = makeProject()
  try {
    const config = {
      viewer: "browser" as const,
      captureTargets: { diff: true, artifact: false, test: true },
      artifactGlobs: ["docs/specs/*.md", "notes/**/*.md"],
      testCommands: ["deno test", "bun test"],
      injectionTiming: "immediate" as const,
      theme: "dark" as const,
      port: 8080
    }
    saveConfig(dir, config)
    expect(loadConfig(dir)).toEqual(config)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("saveConfig: .claude/ が無くても作成して書く", () => {
  const dir = makeProject()
  try {
    saveConfig(dir, loadConfig(dir)) // 既定値をそのまま保存
    expect(fs.existsSync(configPath(dir))).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("saveConfig: 書式は config.md 準拠(glob 引用・port 引用・フラット YAML)", () => {
  const dir = makeProject()
  try {
    saveConfig(dir, {
      viewer: "files",
      captureTargets: { diff: true, artifact: true, test: true },
      artifactGlobs: ["docs/**/*.md"],
      testCommands: [],
      injectionTiming: "hybrid",
      theme: "device",
      port: 7373
    })
    const raw = fs.readFileSync(configPath(dir), "utf8")
    expect(raw).toContain('artifact_globs: ["docs/**/*.md"]')
    expect(raw).toContain('port: "7373"')
    expect(raw).toContain("viewer: files")
    expect(raw).toContain("capture_targets: [diff, artifact, test]")
    expect(raw).toContain("test_commands: []")
    expect(raw).toContain("# pitcrew 設定")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
