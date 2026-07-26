import path from "node:path"

export function guidepostDir(projectDir: string): string {
  return path.join(projectDir, ".guidepost")
}

export function toursDir(projectDir: string): string {
  return path.join(guidepostDir(projectDir), "tours")
}

export function tourDir(projectDir: string, tourId: string): string {
  return path.join(toursDir(projectDir), tourId)
}

export function answersDir(projectDir: string, tourId: string): string {
  return path.join(tourDir(projectDir, tourId), "answers")
}

export function questionsDir(projectDir: string): string {
  return path.join(guidepostDir(projectDir), "queue", "questions")
}

export function processedDir(projectDir: string): string {
  return path.join(questionsDir(projectDir), "processed")
}
