import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import {
  type FrontmatterData,
  serializeFrontmatter
} from "../lib/frontmatter.js"
import { pitcrewDir } from "../lib/run.js"
import { isSafeName } from "./state.js"

// ブラウザビューアの書き込み側(設計書 §5)。書けるのは
// 「review/ → reviewed/ への移動」と「comments/ への新規コメント」のみ。
// run.json 等には一切書かない。

export interface NewComment {
  body: string
  urgency: "urgent" | "normal"
  paths: string[]
  reviewId: string | null
  base: string | null
}

export function approveItem(projectDir: string, name: string): boolean {
  if (!isSafeName(name)) return false
  const base = pitcrewDir(projectDir)
  try {
    fs.mkdirSync(path.join(base, "reviewed"), { recursive: true })
    fs.renameSync(
      path.join(base, "review", name),
      path.join(base, "reviewed", name)
    )
    return true
  } catch {
    return false
  }
}

// 採番は comments/ と processed/ の両方を見る(注入で processed/ に移った
// 番号を再利用すると人間の再投稿と衝突するため)。ビューアは単一プロセス前提
// なので読み取り→書き込みの競合対策はしない(手書き併用時は稀に衝突し得るが、
// writeFileAtomic の rename で後勝ちになるだけで壊れはしない)
function nextCommentNumber(projectDir: string): number {
  const dirs = [
    path.join(pitcrewDir(projectDir), "comments"),
    path.join(pitcrewDir(projectDir), "comments", "processed")
  ]
  let max = 0
  for (const dir of dirs) {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const m = name.match(/^c-(\d+)\.md$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return max + 1
}

export function writeComment(
  projectDir: string,
  comment: NewComment
): string | null {
  const body = comment.body.trim()
  if (body === "") return null
  const fm: FrontmatterData = {
    urgency: comment.urgency,
    ...(comment.paths.length > 0 ? { paths: comment.paths } : {}),
    ...(comment.reviewId ? { reviewId: comment.reviewId } : {}),
    ...(comment.base ? { base: comment.base } : {})
  }
  const name = `c-${String(nextCommentNumber(projectDir)).padStart(3, "0")}.md`
  writeFileAtomic(
    path.join(pitcrewDir(projectDir), "comments", name),
    `${serializeFrontmatter(fm)}\n${body}\n`
  )
  return name
}
