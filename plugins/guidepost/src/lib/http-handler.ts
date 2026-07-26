import fs from "node:fs"
import { logError } from "./hook-io.js"
import { tourDir } from "./paths.js"
import { writeQuestion } from "./queue.js"
import { listAnswers, listTours, readTour } from "./tour-store.js"

export interface HandlerResult {
  status: number
  contentType: string
  body: string
}

interface HandlerOptions {
  projectDir: string
  html: string
}

const TOUR_ID_PATTERN = /^[A-Za-z0-9-]+$/
const LINE_BREAK_PATTERN = /[\r\n]/

function jsonResult(status: number, value: unknown): HandlerResult {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function handleTourDetail(projectDir: string, pathname: string): HandlerResult {
  const encodedTourId = pathname.slice("/api/tours/".length)
  let tourId: string
  try {
    tourId = decodeURIComponent(encodedTourId)
  } catch {
    return jsonResult(400, { error: "bad tour id" })
  }

  if (!TOUR_ID_PATTERN.test(tourId)) {
    return jsonResult(400, { error: "bad tour id" })
  }
  if (!fs.existsSync(tourDir(projectDir, tourId))) {
    return jsonResult(404, { error: "not found" })
  }

  const result = readTour(projectDir, tourId)
  if ("error" in result) {
    return jsonResult(400, { error: result.error })
  }
  return jsonResult(200, {
    tour: result.tour,
    answers: listAnswers(projectDir, tourId)
  })
}

function handleQuestion(projectDir: string, body: string): HandlerResult {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return jsonResult(400, { error: "bad json" })
  }

  if (
    !isRecord(value) ||
    typeof value.tourId !== "string" ||
    typeof value.stopId !== "string" ||
    typeof value.question !== "string" ||
    value.question === "" ||
    LINE_BREAK_PATTERN.test(value.tourId) ||
    LINE_BREAK_PATTERN.test(value.stopId)
  ) {
    return jsonResult(400, { error: "bad field" })
  }

  const name = writeQuestion(projectDir, {
    tourId: value.tourId,
    stopId: value.stopId,
    body: value.question
  })
  if (name === null) {
    return jsonResult(400, { error: "empty question" })
  }
  return jsonResult(200, { ok: true, name })
}

export function handleRequest(
  opts: HandlerOptions,
  method: string,
  pathname: string,
  body: string
): HandlerResult {
  let projectDir = ""
  try {
    projectDir = opts.projectDir
    if (method === "GET" && pathname === "/") {
      return { status: 200, contentType: "text/html", body: opts.html }
    }
    if (method === "GET" && pathname === "/api/tours") {
      return jsonResult(200, listTours(projectDir))
    }
    if (method === "GET" && pathname.startsWith("/api/tours/")) {
      return handleTourDetail(projectDir, pathname)
    }
    if (method === "POST" && pathname === "/api/questions") {
      return handleQuestion(projectDir, body)
    }
    return jsonResult(404, { error: "not found" })
  } catch (error) {
    logError(projectDir || process.cwd(), "handleRequest", error)
    return jsonResult(500, { error: "internal error" })
  }
}
