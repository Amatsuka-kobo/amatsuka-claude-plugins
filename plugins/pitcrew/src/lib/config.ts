import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"

// /pitcrew:config が書く .claude/pitcrew.local.md の読み取り(設計書 §7)。
// hooks は短命プロセスなので毎回読み直す(保存が次の hook 起動から反映される)。
// ファイルが無い・値が壊れている場合はすべて既定値に落とす(フェイルオープン。設計書 §9)。

export interface PitcrewConfig {
  viewer: "browser" | "tui" | "files"
  captureTargets: { diff: boolean; artifact: boolean; test: boolean }
  artifactGlobs: string[]
  testCommands: string[]
  injectionTiming: "hybrid" | "turn-boundary" | "immediate"
  theme: "device" | "light" | "dark"
  port: number
}

export const DEFAULT_ARTIFACT_GLOBS = ["docs/**/*.md"]
export const DEFAULT_PORT = 7373

function defaults(): PitcrewConfig {
  return {
    viewer: "files",
    captureTargets: { diff: true, artifact: true, test: true },
    artifactGlobs: [...DEFAULT_ARTIFACT_GLOBS],
    testCommands: [],
    injectionTiming: "hybrid",
    theme: "device",
    port: DEFAULT_PORT
  }
}

export function configPath(projectDir: string): string {
  return path.join(projectDir, ".claude", "pitcrew.local.md")
}

function oneOf<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[]
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function asArray(value: string | string[] | undefined): string[] | null {
  return Array.isArray(value) ? value.filter((v) => v !== "") : null
}

export function loadConfig(projectDir: string): PitcrewConfig {
  const cfg = defaults()
  let raw: string
  try {
    raw = fs.readFileSync(configPath(projectDir), "utf8")
  } catch {
    return cfg
  }
  const { data } = parseFrontmatter(raw)

  const viewer = oneOf(data.viewer, ["browser", "tui", "files"] as const)
  if (viewer) cfg.viewer = viewer

  const targets = asArray(data.capture_targets)
  if (targets)
    cfg.captureTargets = {
      diff: targets.includes("diff"),
      artifact: targets.includes("artifact"),
      test: targets.includes("test")
    }

  // 空配列は「glob 指定なし」とみなして既定を保つ(捕捉を止めたい場合は
  // capture_targets から artifact を外す)
  const globs = asArray(data.artifact_globs)
  if (globs && globs.length > 0) cfg.artifactGlobs = globs

  const commands = asArray(data.test_commands)
  if (commands) cfg.testCommands = commands

  const timing = oneOf(data.injection_timing, [
    "hybrid",
    "turn-boundary",
    "immediate"
  ] as const)
  if (timing) cfg.injectionTiming = timing

  const theme = oneOf(data.theme, ["device", "light", "dark"] as const)
  if (theme) cfg.theme = theme

  if (typeof data.port === "string" && /^\d+$/.test(data.port)) {
    const port = Number(data.port)
    if (port >= 1 && port <= 65535) cfg.port = port
  }
  return cfg
}
