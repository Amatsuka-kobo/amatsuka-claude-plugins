import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"
import { pitcrewDir } from "./run.js"

// コメントの列挙・パス照合・クレーム(設計書 §6)。
// クレームは comments/ → comments/processed/ への rename そのものを所有権の
// 獲得とする。rename は原子的なので、並行する複数 hook が同じコメントを
// 狙っても成功するのは 1 プロセスだけ(重複注入は構造的に起きない)。

export interface PitcrewComment {
  name: string
  file: string
  urgency: "urgent" | "normal"
  paths: string[]
  reviewId: string | null
  base: string | null
  body: string
}

export function commentsDir(projectDir: string): string {
  return path.join(pitcrewDir(projectDir), "comments")
}

export function processedDir(projectDir: string): string {
  return path.join(commentsDir(projectDir), "processed")
}

function asPaths(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value !== "") return [value]
  return []
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

export function listComments(projectDir: string): PitcrewComment[] {
  const dir = commentsDir(projectDir)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const comments: PitcrewComment[] = []
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    const file = path.join(dir, name)
    let raw: string
    try {
      if (!fs.statSync(file).isFile()) continue
      raw = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    const { data, body } = parseFrontmatter(raw)
    comments.push({
      name,
      file,
      urgency: data.urgency === "urgent" ? "urgent" : "normal",
      paths: asPaths(data.paths),
      reviewId: asString(data.reviewId),
      base: asString(data.base),
      body: body.trim()
    })
  }
  return comments
}

// パス照合(設計書 §6): コメントの paths とツール入力パスの単純比較
// (完全一致 or コメント側が祖先ディレクトリ)。決定的で LLM を使わない。
export function pathMatchesComment(
  commentPath: string,
  targetRel: string
): boolean {
  const cp = commentPath.replaceAll("\\", "/").replace(/\/+$/, "")
  if (cp === "") return false
  const target = targetRel.replaceAll("\\", "/")
  return target === cp || target.startsWith(`${cp}/`)
}

export function claimComment(projectDir: string, name: string): boolean {
  try {
    fs.mkdirSync(processedDir(projectDir), { recursive: true })
    fs.renameSync(
      path.join(commentsDir(projectDir), name),
      path.join(processedDir(projectDir), name)
    )
    return true
  } catch {
    return false
  }
}

// 注入テキストの生成。additionalContext / reason の上限に収める
// (超過時は切り詰めて processed/ への参照を付記する。設計書 §6)。
export function renderInjection(
  comments: PitcrewComment[],
  maxChars: number
): string {
  const head =
    `[pitcrew] 人間レビュアーからのコメント(${comments.length} 件)。` +
    "内容を確認し、作業に反映してください。" +
    "base はコメント時点の commit を指すため、対象箇所が既に変わっている場合は" +
    "現状と照合して自分で判断してください。"
  const sections = comments.map((c) => {
    const meta = [
      `urgency: ${c.urgency}`,
      c.paths.length > 0 ? `paths: ${c.paths.join(", ")}` : null,
      c.base ? `base: ${c.base}` : null,
      c.reviewId ? `reviewId: ${c.reviewId}` : null
    ]
      .filter((part) => part !== null)
      .join(" / ")
    return `## ${c.name}(${meta})\n\n${c.body}`
  })
  const text = [head, ...sections].join("\n\n")
  if (text.length <= maxChars) return text
  const note =
    "\n\n> (上限により切り詰め。全文: .pitcrew/comments/processed/ 配下の " +
    `${comments.map((c) => c.name).join(", ")})`
  return (text.slice(0, Math.max(0, maxChars - note.length)) + note).slice(
    0,
    maxChars
  )
}
