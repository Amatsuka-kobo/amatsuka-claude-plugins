import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
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

// ---- ビューアからの設定保存(設計書 Stage 4.2 §3.3)----
// 検証・シリアライズの規則をこのモジュールに集約し、http.ts には
// HTTP の関心事だけを残す。

// 配列要素の検証: string・非空・カンマ改行なし(フラット YAML の
// インライン配列を壊す値は保存前に拒否する)
function validStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== "string" || v === "" || /[,\n\r]/.test(v)) return null
    out.push(v)
  }
  return out
}

// 全 7 項目必須(部分更新なし)。複数違反時はフィールド定義順で
// 最初の 1 件だけを error に入れて返す。
export function validateConfig(
  input: unknown
): { config: PitcrewConfig } | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { error: "config" }
  const obj = input as Record<string, unknown>

  const viewer = obj.viewer
  if (viewer !== "browser" && viewer !== "tui" && viewer !== "files")
    return { error: "viewer" }

  const ct = obj.captureTargets
  if (typeof ct !== "object" || ct === null || Array.isArray(ct))
    return { error: "captureTargets" }
  const targets = ct as Record<string, unknown>
  if (
    typeof targets.diff !== "boolean" ||
    typeof targets.artifact !== "boolean" ||
    typeof targets.test !== "boolean"
  )
    return { error: "captureTargets" }

  const globs = validStringArray(obj.artifactGlobs)
  if (globs === null || globs.length === 0) return { error: "artifactGlobs" }

  const commands = validStringArray(obj.testCommands)
  if (commands === null) return { error: "testCommands" }

  const timing = obj.injectionTiming
  if (
    timing !== "hybrid" &&
    timing !== "turn-boundary" &&
    timing !== "immediate"
  )
    return { error: "injectionTiming" }

  const theme = obj.theme
  if (theme !== "device" && theme !== "light" && theme !== "dark")
    return { error: "theme" }

  const port = obj.port
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return { error: "port" }

  return {
    config: {
      viewer,
      captureTargets: {
        diff: targets.diff,
        artifact: targets.artifact,
        test: targets.test
      },
      artifactGlobs: globs,
      testCommands: commands,
      injectionTiming: timing,
      theme,
      port
    }
  }
}

// commands/config.md §3 のテンプレートと同内容(本文は説明書きであり
// 設定値ではないため、保存のたびにこの固定文で上書きする)
const CONFIG_BODY = `
# pitcrew 設定

\`/pitcrew:config\` で生成。手で編集しても有効(次の hook 起動から反映される)。

- viewer: browser | tui | files
- capture_targets: diff / artifact / test の組み合わせ(外した種別は捕捉しない)
- artifact_globs: 成果物として捕捉する glob(設定時は既定 docs/**/*.md を置き換え。空配列は既定のまま。docs/chat/ は常に除外)
- test_commands: テスト・ビルド判定の追加コマンド接頭辞(既定リストに追加)
- injection_timing: hybrid | turn-boundary | immediate
- theme: ブラウザビューアの初期テーマ(device | light | dark)
- port: ブラウザビューアの待受ポート
`

// .claude/pitcrew.local.md を config.md と同一の書式で書く。
// frontmatter.ts の serializeFrontmatter は使わない(引用規則が
// レビュー項目向けで、glob を引用しないため書式が config.md とずれる)。
export function saveConfig(projectDir: string, config: PitcrewConfig): void {
  const targets: string[] = []
  if (config.captureTargets.diff) targets.push("diff")
  if (config.captureTargets.artifact) targets.push("artifact")
  if (config.captureTargets.test) targets.push("test")
  const lines = [
    "---",
    `viewer: ${config.viewer}`,
    `capture_targets: [${targets.join(", ")}]`,
    `artifact_globs: [${config.artifactGlobs.map((g) => JSON.stringify(g)).join(", ")}]`,
    `test_commands: [${config.testCommands.map((c) => JSON.stringify(c)).join(", ")}]`,
    `injection_timing: ${config.injectionTiming}`,
    `theme: ${config.theme}`,
    `port: "${config.port}"`,
    "---"
  ]
  const file = configPath(projectDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, `${lines.join("\n")}\n${CONFIG_BODY}`)
}
