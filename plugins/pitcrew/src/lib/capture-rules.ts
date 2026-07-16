import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"
import { pitcrewDir } from "./run.js"

// 捕捉対象の判定ルール(設計書 §4)。Stage 1 は既定値ハードコード
// (config による glob / コマンド追加は Stage 3)。

// 成果物ファイルの既定対象: docs/**/*.md。ただし docs/chat/ は
// このリポジトリの chat 記録(閲覧制限あり・レビュー対象外)なので除外する。
export function isArtifactPath(relPath: string): boolean {
  const p = relPath.replaceAll("\\", "/")
  return (
    p.startsWith("docs/") && p.endsWith(".md") && !p.startsWith("docs/chat/")
  )
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
