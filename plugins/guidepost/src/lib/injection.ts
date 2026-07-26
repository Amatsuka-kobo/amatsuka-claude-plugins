import path from "node:path"
import { answerPath } from "./tour-store.js"
import type { Question } from "./types.js"

export const MAX_INJECT_CHARS = 9000

const UNKNOWN_QUESTION_INSTRUCTION =
  "どのツアー・どのストップへの質問か特定できないため、" +
  "セッション内で回答のみ行い answers/ への書き込みは不要です。"

function questionTimestamp(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name
}

function renderQuestion(question: Question, projectDir: string): string {
  const metadata = [
    `tourId: ${question.tourId ?? "不明"}`,
    `stopId: ${question.stopId ?? "不明"}`
  ].join(" / ")

  if (question.tourId === null || question.stopId === null) {
    return `## ${question.name} (${metadata})\n\n${question.body}\n\n${UNKNOWN_QUESTION_INSTRUCTION}`
  }

  const ts = questionTimestamp(question.name)
  let destination: string
  try {
    destination = answerPath(projectDir, question.tourId, question.stopId, ts)
  } catch {
    return `## ${question.name} (${metadata})\n\n${question.body}\n\n${UNKNOWN_QUESTION_INSTRUCTION}`
  }

  const tourFile = path.join(
    projectDir,
    ".guidepost",
    "tours",
    question.tourId,
    "tour.json"
  )
  return [
    `## ${question.name} (${metadata})`,
    question.body,
    `該当ストップの文脈は \`.guidepost/tours/${question.tourId}/tour.json\` の該当エントリを読んでください。`,
    `参照する tour.json の絶対パス: ${tourFile}`,
    `回答の書き込み先: ${destination}`,
    `回答は \`answers/${question.stopId}-${ts}.md\` に新規ファイルとして書いてください。既存ファイルへの追記はしないでください。`
  ].join("\n\n")
}

// Stop reason と PreToolUse additionalContext の上限内に収める。
export function renderInjection(
  questions: Question[],
  projectDir: string,
  maxChars: number
): string {
  const head =
    `[guidepost] ツアー閲覧者からの質問(${questions.length} 件)。` +
    "質問ごとに指定されたツアーとストップの文脈を確認し、回答してください。"
  const text = [
    head,
    ...questions.map((question) => renderQuestion(question, projectDir))
  ].join("\n\n")
  if (text.length <= maxChars) return text

  const note =
    "\n\n> (上限により切り詰め。全文: " +
    ".guidepost/queue/questions/processed/ 配下の " +
    `${questions.map((question) => question.name).join(", ")})`
  return (text.slice(0, Math.max(0, maxChars - note.length)) + note).slice(
    0,
    maxChars
  )
}
