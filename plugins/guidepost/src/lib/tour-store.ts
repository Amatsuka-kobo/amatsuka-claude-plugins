import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import { answersDir, tourDir, toursDir } from "./paths.js"
import type { Answer, Tour } from "./types.js"

const TOUR_ID_PATTERN = /^[A-Za-z0-9-]+$/
const STOP_ID_PATTERN = /^stop-\d{2}$/
const ANSWER_FILE_PATTERN = /^(stop-\d{2})-([A-Za-z0-9-]+)\.md$/
const TOUR_ID_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/

export interface TourListEntry {
  tourId: string
  title: string
  createdAt: string
  stopCount: number
  error?: string
}

type TourResult = { tour: Tour } | { error: string }

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function makeTourId(date: Date, headSha: string): string {
  const datePart = [
    String(date.getFullYear()).padStart(4, "0"),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("")
  const timePart = [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds())
  ].join("")
  return `${datePart}-${timePart}-${headSha.slice(0, 7)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  context: string
): string | undefined {
  const candidate = value[field]
  if (typeof candidate !== "string" || candidate.length === 0) {
    return `${context}.${field} は空でない文字列である必要があります`
  }
  return undefined
}

function validateHunk(value: unknown, context: string): string | undefined {
  if (!isRecord(value)) {
    return `${context} はオブジェクトである必要があります`
  }
  for (const field of ["oldStart", "oldLines", "newStart", "newLines"]) {
    const candidate = value[field]
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      return `${context}.${field} は数値である必要があります`
    }
  }
  return undefined
}

function validateStop(value: unknown, index: number): string | undefined {
  const context = `stops[${index}]`
  if (!isRecord(value)) {
    return `${context} はオブジェクトである必要があります`
  }

  for (const field of ["id", "file", "title", "what", "why", "ifBroken"]) {
    const error = requireString(value, field, context)
    if (error) {
      return error
    }
  }
  if (!STOP_ID_PATTERN.test(value.id as string)) {
    return `${context}.id は stop-NN 形式である必要があります`
  }
  if (value.diffText !== undefined && typeof value.diffText !== "string") {
    return `${context}.diffText は文字列である必要があります`
  }
  if (value.hunk !== undefined) {
    return validateHunk(value.hunk, `${context}.hunk`)
  }
  return undefined
}

export function validateTour(value: unknown): TourResult {
  if (!isRecord(value)) {
    return { error: "tour.json のルートはオブジェクトである必要があります" }
  }
  if (value.version !== 1) {
    return { error: "version は 1 である必要があります" }
  }
  for (const field of ["tourId", "title", "baseSha", "headSha"]) {
    const error = requireString(value, field, "tour")
    if (error) {
      return { error }
    }
  }

  if (!isRecord(value.source)) {
    return { error: "tour.source はオブジェクトである必要があります" }
  }
  if (value.source.type !== "range" && value.source.type !== "pr") {
    return { error: "tour.source.type は range または pr である必要があります" }
  }
  const sourceValueError = requireString(value.source, "value", "tour.source")
  if (sourceValueError) {
    return { error: sourceValueError }
  }

  if (!Array.isArray(value.stops)) {
    return { error: "tour.stops は配列である必要があります" }
  }
  if (value.stops.length < 1 || value.stops.length > 20) {
    return { error: "tour.stops は 1 件以上 20 件以下である必要があります" }
  }

  const ids = new Set<string>()
  for (const [index, stop] of value.stops.entries()) {
    const error = validateStop(stop, index)
    if (error) {
      return { error }
    }
    const id = (stop as Record<string, unknown>).id as string
    if (ids.has(id)) {
      return { error: `stop id ${id} が重複しています` }
    }
    ids.add(id)
  }

  return { tour: value as unknown as Tour }
}

function isSafeTourId(tourId: string): boolean {
  return TOUR_ID_PATTERN.test(tourId)
}

function readTourFile(filePath: string): TourResult {
  let value: unknown
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    return {
      error: `tour.json を読み込めません: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
  return validateTour(value)
}

export function readTour(projectDir: string, tourId: string): TourResult {
  if (!isSafeTourId(tourId)) {
    return { error: "tourId に使用できない文字が含まれています" }
  }
  return readTourFile(path.join(tourDir(projectDir, tourId), "tour.json"))
}

function createdAtFromTourId(tourId: string): string {
  const match = TOUR_ID_DATE_PATTERN.exec(tourId)
  if (!match) {
    return ""
  }
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

export function listTours(projectDir: string): TourListEntry[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(toursDir(projectDir), { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry): TourListEntry => {
      const tourId = entry.name
      const createdAt = createdAtFromTourId(tourId)
      const result = readTour(projectDir, tourId)
      if ("error" in result) {
        return {
          tourId,
          title: tourId,
          createdAt,
          stopCount: 0,
          error: result.error
        }
      }
      return {
        tourId,
        title: result.tour.title,
        createdAt,
        stopCount: result.tour.stops.length
      }
    })
    .sort((left, right) => right.tourId.localeCompare(left.tourId))
}

export function writeTour(projectDir: string, tour: Tour): void {
  const result = validateTour(tour)
  if ("error" in result) {
    throw new Error(result.error)
  }
  if (!isSafeTourId(tour.tourId)) {
    throw new Error("tourId に使用できない文字が含まれています")
  }
  const filePath = path.join(tourDir(projectDir, tour.tourId), "tour.json")
  writeFileAtomic(filePath, `${JSON.stringify(tour, null, 2)}\n`)
}

export function listAnswers(projectDir: string, tourId: string): Answer[] {
  if (!isSafeTourId(tourId)) {
    return []
  }

  let entries: fs.Dirent[]
  const dir = answersDir(projectDir, tourId)
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const answers: Answer[] = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const match = ANSWER_FILE_PATTERN.exec(entry.name)
    if (!match) {
      continue
    }
    const [, stopId, ts] = match
    try {
      answers.push({
        stopId,
        ts,
        body: fs.readFileSync(path.join(dir, entry.name), "utf8")
      })
    } catch {
      // 走査中に消えたファイルは、次回の読み取りへ委ねる。
    }
  }
  return answers.sort((left, right) => left.ts.localeCompare(right.ts))
}

export function answerPath(
  projectDir: string,
  tourId: string,
  stopId: string,
  ts: string
): string {
  if (
    !isSafeTourId(tourId) ||
    !STOP_ID_PATTERN.test(stopId) ||
    !/^[A-Za-z0-9-]+$/.test(ts)
  ) {
    throw new Error("回答パスに使用できない識別子が含まれています")
  }
  return path.join(answersDir(projectDir, tourId), `${stopId}-${ts}.md`)
}
