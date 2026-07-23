import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import {
  AntibodyValidationError,
  parseAntibodyMarkdown,
  serializeAntibodyMarkdown,
  validateAntibody
} from "./frontmatter.js"
import type { Antibody, AntibodyStatus, AntibodyTrigger } from "./types.js"

const ID_PATTERN = /^ab-(\d{4})-(\d{4})-(\d{3})$/
const MAX_COLLISION_REALLOCATIONS = 3

export interface AntibodyDraft {
  source: string
  trigger: AntibodyTrigger
  expires: string
  body: string
}

export interface AntibodyPatch {
  source?: string
  trigger?: AntibodyTrigger
  body?: string
}

export interface AntibodyListError {
  file: string
  message: string
}

export interface AntibodyListResult {
  antibodies: Antibody[]
  errors: AntibodyListError[]
}

export class AntibodyIoError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "AntibodyIoError"
    this.cause = cause
  }
}

export class AntibodyNotFoundError extends AntibodyValidationError {
  constructor(id: string) {
    super(`id: antibody not found: ${id}`, "id")
    this.name = "AntibodyNotFoundError"
  }
}

export function antibodiesDirectory(projectDir: string): string {
  return path.join(projectDir, ".raphael", "antibodies")
}

export function antibodyFilePath(projectDir: string, id: string): string {
  assertAntibodyId(id)
  return path.join(antibodiesDirectory(projectDir), `${id}.md`)
}

export function listAntibodies(projectDir: string): AntibodyListResult {
  const directory = antibodiesDirectory(projectDir)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return { antibodies: [], errors: [] }
    throw new AntibodyIoError("Failed to list antibodies", error)
  }

  const antibodies: Antibody[] = []
  const errors: AntibodyListError[] = []
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort(codePointCompare)

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(directory, file), "utf8")
      const antibody = parseAntibodyMarkdown(raw)
      if (file !== `${antibody.id}.md`) {
        throw new AntibodyValidationError(
          `id: filename must be ${antibody.id}.md`,
          "id"
        )
      }
      antibodies.push(antibody)
    } catch (error) {
      if (error instanceof AntibodyValidationError) {
        errors.push({ file, message: error.message })
        continue
      }
      throw new AntibodyIoError(`Failed to read antibody: ${file}`, error)
    }
  }

  return { antibodies, errors }
}

export function readAntibody(projectDir: string, id: string): Antibody {
  const filePath = antibodyFilePath(projectDir, id)
  let raw: string
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) throw new AntibodyNotFoundError(id)
    throw new AntibodyIoError(`Failed to read antibody: ${id}`, error)
  }

  try {
    const antibody = parseAntibodyMarkdown(raw)
    if (antibody.id !== id) {
      throw new AntibodyValidationError(
        `id: expected ${id}, found ${antibody.id}`,
        "id"
      )
    }
    return antibody
  } catch (error) {
    if (error instanceof AntibodyValidationError) throw error
    throw new AntibodyIoError(`Failed to parse antibody: ${id}`, error)
  }
}

export function createAntibody(
  projectDir: string,
  draft: AntibodyDraft,
  now = new Date()
): Antibody {
  const created = localDate(now)
  const datePart = `${created.slice(0, 4)}-${created.slice(5, 7)}${created.slice(8, 10)}`
  let collisionFloor = 0

  for (
    let reallocation = 0;
    reallocation <= MAX_COLLISION_REALLOCATIONS;
    reallocation += 1
  ) {
    const sequence = nextDailySequence(projectDir, datePart, collisionFloor)
    if (sequence > 999) {
      throw new AntibodyValidationError(
        `id: daily antibody limit exceeded for ${created}`,
        "id"
      )
    }
    const id = `ab-${datePart}-${String(sequence).padStart(3, "0")}`
    const antibody = validateAntibody({
      id,
      created,
      source: draft.source,
      trigger: draft.trigger,
      status: "active",
      stats: { fired: 0, last_fired: null },
      expires: draft.expires,
      body: draft.body
    })

    try {
      writeAntibodyCreate(projectDir, antibody)
      return antibody
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        collisionFloor = sequence
        continue
      }
      throw error
    }
  }

  throw new AntibodyIoError(
    `Failed to allocate antibody ID after ${MAX_COLLISION_REALLOCATIONS} reallocations`
  )
}

export function writeAntibodyCreate(
  projectDir: string,
  value: unknown
): Antibody {
  const antibody = validateAntibody(value)
  const directory = antibodiesDirectory(projectDir)
  const filePath = antibodyFilePath(projectDir, antibody.id)
  fs.mkdirSync(directory, { recursive: true })
  try {
    fs.writeFileSync(filePath, serializeAntibodyMarkdown(antibody), {
      encoding: "utf8",
      flag: "wx"
    })
    return antibody
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      const collision = new AntibodyValidationError(
        `id: antibody already exists: ${antibody.id}`,
        "id"
      ) as AntibodyValidationError & NodeJS.ErrnoException
      collision.code = "EEXIST"
      throw collision
    }
    throw new AntibodyIoError(
      `Failed to create antibody: ${antibody.id}`,
      error
    )
  }
}

export function patchAntibody(
  projectDir: string,
  id: string,
  patch: AntibodyPatch
): Antibody {
  assertPatch(patch)
  const current = readAntibody(projectDir, id)
  const updated = validateAntibody({
    ...current,
    ...(patch.source === undefined ? {} : { source: patch.source }),
    ...(patch.trigger === undefined ? {} : { trigger: patch.trigger }),
    ...(patch.body === undefined ? {} : { body: patch.body })
  })
  writeAntibodyReplace(projectDir, updated)
  return updated
}

export function setAntibodyStatus(
  projectDir: string,
  id: string,
  status: AntibodyStatus
): Antibody {
  const current = readAntibody(projectDir, id)
  const updated = validateAntibody({ ...current, status })
  writeAntibodyReplace(projectDir, updated)
  return updated
}

export function extendAntibodyExpires(
  projectDir: string,
  id: string,
  expires: string
): Antibody {
  const current = readAntibody(projectDir, id)
  const updated = validateAntibody({ ...current, expires })
  writeAntibodyReplace(projectDir, updated)
  return updated
}

export function recordAntibodyFire(
  projectDir: string,
  id: string,
  now = new Date()
): Antibody {
  const current = readAntibody(projectDir, id)
  const updated = validateAntibody({
    ...current,
    stats: {
      fired: current.stats.fired + 1,
      last_fired: localDate(now)
    }
  })
  writeAntibodyReplace(projectDir, updated)
  return updated
}

function writeAntibodyReplace(projectDir: string, antibody: Antibody): void {
  const filePath = antibodyFilePath(projectDir, antibody.id)
  try {
    writeFileAtomic(filePath, serializeAntibodyMarkdown(antibody))
  } catch (error) {
    throw new AntibodyIoError(
      `Failed to update antibody: ${antibody.id}`,
      error
    )
  }
}

function nextDailySequence(
  projectDir: string,
  datePart: string,
  floor: number
): number {
  const { antibodies } = listAntibodies(projectDir)
  let maximum = floor
  for (const antibody of antibodies) {
    const match = ID_PATTERN.exec(antibody.id)
    if (match?.[1] === datePart.slice(0, 4) && match[2] === datePart.slice(5)) {
      maximum = Math.max(maximum, Number(match[3]))
    }
  }
  return maximum + 1
}

function assertPatch(patch: AntibodyPatch): void {
  if (!isRecord(patch)) {
    throw new AntibodyValidationError("patch: must be an object", "patch")
  }
  for (const key of Object.keys(patch)) {
    if (key !== "source" && key !== "trigger" && key !== "body") {
      throw new AntibodyValidationError(
        `patch.${key}: is not supported`,
        `patch.${key}`
      )
    }
  }
}

function assertAntibodyId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new AntibodyValidationError("id: must match ab-YYYY-MMDD-NNN", "id")
  }
}

function localDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0")
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index]
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}
