import fs from "node:fs"
import path from "node:path"
import { DEFAULT_ARTIFACT_GLOBS } from "./config.js"
import { parseFrontmatter } from "./frontmatter.js"
import { pitcrewDir } from "./run.js"

// 捕捉対象の判定ルール(設計書 §4)。glob / コマンド追加は config
// (.claude/pitcrew.local.md)から hooks が渡す。未指定なら既定値。

// 成果物ファイルの既定対象: docs/**/*.md(config で置き換え可能)。
// docs/chat/ は chat 記録(閲覧制限あり・レビュー対象外)なので設定によらず除外する。
export function isArtifactPath(
  relPath: string,
  globs: string[] = DEFAULT_ARTIFACT_GLOBS
): boolean {
  const p = relPath.replaceAll("\\", "/")
  if (p.startsWith("docs/chat/")) return false
  return globs.some((g) => path.matchesGlob(p, g))
}

// 同一 type・同一パスの未レビュー項目を探す(連続 Write/Edit のコアレス用)。
// reviewed/ へ移動済みの項目は対象外 — 承認後の変更は新項目として扱う。
export function findReviewItemForPath(
  projectDir: string,
  type: string,
  relPath: string
): { file: string; id: string } | null {
  const reviewDir = path.join(pitcrewDir(projectDir), "review")
  let names: string[]
  try {
    names = fs.readdirSync(reviewDir)
  } catch {
    return null
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    const file = path.join(reviewDir, name)
    let data: Record<string, string | string[]>
    try {
      data = parseFrontmatter(fs.readFileSync(file, "utf8")).data
    } catch {
      continue
    }
    const paths = data.paths
    if (
      data.type === type &&
      typeof data.id === "string" &&
      Array.isArray(paths) &&
      paths.length === 1 &&
      paths[0] === relPath
    )
      return { file, id: data.id }
  }
  return null
}

// テスト・ビルド系コマンドの既定ホワイトリスト(設計書 §4 の前方一致方式)。
// config の `test_commands` が追加分として渡される。
const TEST_COMMAND_PREFIXES = [
  "pnpm test",
  "pnpm build",
  "pnpm typecheck",
  "pnpm lint",
  "pnpm vitest",
  "npm test",
  "npm run test",
  "npm run build",
  "yarn test",
  "yarn build",
  "npx vitest",
  "vitest",
  "pytest",
  "go test",
  "cargo test",
  "make test",
  "make build"
]

export function matchTestCommand(
  command: string,
  extraPrefixes: string[] = []
): string | null {
  const trimmed = command.trimStart()
  for (const prefix of [...TEST_COMMAND_PREFIXES, ...extraPrefixes]) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) return prefix
  }
  return null
}

// PostToolUse の tool_response から出力と成否の機械的推定を取り出す。
// Bash の終了コードは tool_response に含まれないため、失敗マーカーで補完する。
export function extractBashResult(toolResponse: unknown): {
  output: string
  failed: boolean
} {
  let output = ""
  if (typeof toolResponse === "string") {
    output = toolResponse
  } else if (toolResponse && typeof toolResponse === "object") {
    const r = toolResponse as Record<string, unknown>
    const parts: string[] = []
    if (typeof r.stdout === "string" && r.stdout !== "") parts.push(r.stdout)
    if (typeof r.stderr === "string" && r.stderr !== "") parts.push(r.stderr)
    output = parts.join("\n")
  }
  const failed = /\b(fail(?:ed)?|errors?)\b/i.test(output.slice(-2000))
  return { output, failed }
}

export function summarizeOutput(output: string, maxLines = 120): string {
  const lines = output.split("\n")
  if (lines.length <= maxLines) return output
  return [
    `> (先頭 ${lines.length - maxLines} 行を省略)`,
    ...lines.slice(-maxLines)
  ].join("\n")
}
