import path from "node:path"
import { expect, test } from "vitest"
import {
  answersDir,
  guidepostDir,
  processedDir,
  questionsDir,
  tourDir,
  toursDir
} from "../paths.js"

const projectDir = path.join(path.sep, "tmp", "project")
const tourId = "20260726-120000-abcdef0"

test("guidepostDir はプロジェクト内の .guidepost を返す", () => {
  expect(guidepostDir(projectDir)).toBe(path.join(projectDir, ".guidepost"))
})

test("toursDir と tourDir はツアー格納先を返す", () => {
  expect(toursDir(projectDir)).toBe(
    path.join(projectDir, ".guidepost", "tours")
  )
  expect(tourDir(projectDir, tourId)).toBe(
    path.join(projectDir, ".guidepost", "tours", tourId)
  )
})

test("answersDir はツアーの回答格納先を返す", () => {
  expect(answersDir(projectDir, tourId)).toBe(
    path.join(projectDir, ".guidepost", "tours", tourId, "answers")
  )
})

test("questionsDir と processedDir は質問キューの格納先を返す", () => {
  expect(questionsDir(projectDir)).toBe(
    path.join(projectDir, ".guidepost", "queue", "questions")
  )
  expect(processedDir(projectDir)).toBe(
    path.join(projectDir, ".guidepost", "queue", "questions", "processed")
  )
})
