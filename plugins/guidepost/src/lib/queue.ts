import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js"
import { processedDir, questionsDir } from "./paths.js"
import type { Question } from "./types.js"

function asString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function questionTimestamp(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0")
  return [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3)
  ].join("")
}

// 質問を時刻順に並ぶ名前で保存する。同一ミリ秒内の書き込みは連番で区別する。
export function writeQuestion(
  projectDir: string,
  question: { tourId: string; stopId: string; body: string }
): string | null {
  const body = question.body.trim()
  if (body === "") return null

  const dir = questionsDir(projectDir)
  const timestamp = questionTimestamp(new Date())
  let suffix = 0
  let name = `${timestamp}.md`
  while (fs.existsSync(path.join(dir, name))) {
    suffix += 1
    name = `${timestamp}-${suffix}.md`
  }

  const createdAt = new Date().toISOString()
  const frontmatter = serializeFrontmatter({
    tourId: question.tourId,
    stopId: question.stopId,
    createdAt
  })
  writeFileAtomic(path.join(dir, name), `${frontmatter}\n${body}\n`)
  return name
}

// 未処理キュー直下の Markdown 質問を名前順に返す。手書き・破損した
// frontmatter も本文を失わないよう、メタデータなしの質問として扱う。
export function listQuestions(projectDir: string): Question[] {
  const dir = questionsDir(projectDir)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }

  const questions: Question[] = []
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
    questions.push({
      name,
      tourId: asString(data.tourId),
      stopId: asString(data.stopId),
      createdAt: asString(data.createdAt),
      body: body.trim()
    })
  }
  return questions
}

// questions/ から processed/ への rename 成功を、質問の所有権獲得とする。
// rename は原子的なため、同じ質問を複数の hook が処理することはない。
export function claimQuestion(projectDir: string, name: string): boolean {
  try {
    fs.mkdirSync(processedDir(projectDir), { recursive: true })
    fs.renameSync(
      path.join(questionsDir(projectDir), name),
      path.join(processedDir(projectDir), name)
    )
    return true
  } catch {
    return false
  }
}
