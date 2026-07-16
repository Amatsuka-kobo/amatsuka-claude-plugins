import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import { type FrontmatterData, serializeFrontmatter } from "./frontmatter.js"
import { pitcrewDir, type RunState } from "./run.js"

// レビュー項目(設計書 §4)の生成と .pitcrew/review/ への書き出し。

export interface ReviewItem {
  type: "diff" | "artifact" | "test"
  title: string
  agent: string
  paths: string[]
  base: string | null
  head: string | null
  body: string
}

// 巨大 diff 対策(設計書 §3): 本文はこの行数で切り詰める
const MAX_BODY_LINES = 600

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return s || "item"
}

function truncateBody(body: string): string {
  const lines = body.split("\n")
  if (lines.length <= MAX_BODY_LINES) return body
  return [
    ...lines.slice(0, MAX_BODY_LINES),
    "",
    `> (以降 ${lines.length - MAX_BODY_LINES} 行を省略。全文は作業ツリーの対象ファイルを参照)`
  ].join("\n")
}

// C 方式(エディタ直接)用: comments/ に手書きするコメントの雛形(設計書 §5)
function commentTemplate(id: string, item: ReviewItem): string {
  const fm = serializeFrontmatter({
    urgency: "normal",
    paths: item.paths,
    reviewId: id,
    ...(item.base ? { base: item.base } : {})
  })
  return [
    "---",
    "",
    "## コメントする場合",
    "",
    "以下を `.pitcrew/comments/c-<連番>.md` として保存してください" +
      "(urgency は urgent | normal)。",
    "",
    "```markdown",
    fm,
    "(ここにコメント本文)",
    "```"
  ].join("\n")
}

export function renderReviewItem(
  id: string,
  item: ReviewItem,
  now: Date
): string {
  const fm: FrontmatterData = {
    id,
    type: item.type,
    agent: item.agent,
    created: now.toISOString(),
    ...(item.base ? { base: item.base } : {}),
    ...(item.head ? { head: item.head } : {}),
    paths: item.paths
  }
  return [
    serializeFrontmatter(fm),
    `# ${item.title}`,
    "",
    truncateBody(item.body).trimEnd(),
    "",
    commentTemplate(id, item),
    ""
  ].join("\n")
}

export function writeReviewItem(
  projectDir: string,
  run: RunState,
  item: ReviewItem
): { file: string; id: string; run: RunState } {
  const id = String(run.nextReviewId).padStart(3, "0")
  // スラッグはファイル名の可読性のためのもの: 先頭パスの basename
  // (例 src/auth.ts → auth-ts)、パスが無い項目(test)はタイトルから作る
  const slugSource = item.paths[0] ? path.basename(item.paths[0]) : item.title
  const file = path.join(
    pitcrewDir(projectDir),
    "review",
    `${id}-${item.type}-${slugify(slugSource)}.md`
  )
  writeFileAtomic(file, renderReviewItem(id, item, new Date()))
  return { file, id, run: { ...run, nextReviewId: run.nextReviewId + 1 } }
}
