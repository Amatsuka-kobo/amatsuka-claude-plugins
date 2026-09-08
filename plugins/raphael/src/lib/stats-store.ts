import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"

const ANTIBODY_ID_PATTERN = /^ab-\d{4}-\d{4}-\d{3}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/

export interface AntibodyStats {
  fired: number
  last_fired: string | null
  misses: number
  last_miss: string | null
}

export interface RaphaelStatsV1 {
  schema_version: 1
  antibodies: Record<string, AntibodyStats>
  distill: { last_nag_digest: string | null }
}

export function statsFilePath(projectDir: string): string {
  return path.join(projectDir, ".raphael", "stats.json")
}

export function loadStats(projectDir: string): RaphaelStatsV1 {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(statsFilePath(projectDir), "utf8")
    )
    if (!isRecord(parsed) || !isRecord(parsed.antibodies)) {
      return initialStats()
    }

    const antibodies: Record<string, AntibodyStats> = {}
    for (const [id, value] of Object.entries(parsed.antibodies)) {
      if (!ANTIBODY_ID_PATTERN.test(id)) continue
      antibodies[id] = validStats(value) ? value : initialAntibodyStats()
    }

    return {
      schema_version: 1,
      antibodies,
      distill: normalizeDistill(parsed.distill)
    }
  } catch {
    return initialStats()
  }
}

export function saveStats(projectDir: string, stats: RaphaelStatsV1): void {
  writeFileAtomic(
    statsFilePath(projectDir),
    `${JSON.stringify(stats, null, 2)}\n`
  )
}

export function statsFor(stats: RaphaelStatsV1, id: string): AntibodyStats {
  const value = stats.antibodies[id]
  return value === undefined ? initialAntibodyStats() : { ...value }
}

export function recordFire(
  projectDir: string,
  id: string,
  now = new Date()
): AntibodyStats {
  const stats = loadStats(projectDir)
  const updated = incrementFire(statsFor(stats, id), localDate(now))
  stats.antibodies[id] = updated
  saveStats(projectDir, stats)
  return { ...updated }
}

export function recordFires(
  projectDir: string,
  ids: readonly string[],
  now = new Date()
): void {
  if (ids.length === 0) return
  const stats = loadStats(projectDir)
  const date = localDate(now)
  for (const id of ids) {
    stats.antibodies[id] = incrementFire(statsFor(stats, id), date)
  }
  saveStats(projectDir, stats)
}

export function recordMiss(
  projectDir: string,
  id: string,
  now = new Date()
): AntibodyStats {
  const stats = loadStats(projectDir)
  const current = statsFor(stats, id)
  const updated: AntibodyStats = {
    ...current,
    misses: current.misses + 1,
    last_miss: maxDate(current.last_miss, localDate(now))
  }
  stats.antibodies[id] = updated
  saveStats(projectDir, stats)
  return { ...updated }
}

export function pruneOrphanStats(
  projectDir: string,
  knownIds: readonly string[]
): number {
  const stats = loadStats(projectDir)
  const known = new Set(knownIds)
  let removed = 0
  for (const id of Object.keys(stats.antibodies)) {
    if (known.has(id)) continue
    delete stats.antibodies[id]
    removed += 1
  }
  if (removed > 0) saveStats(projectDir, stats)
  return removed
}

export function setNagDigest(projectDir: string, digest: string | null): void {
  const stats = loadStats(projectDir)
  stats.distill.last_nag_digest = digest
  saveStats(projectDir, stats)
}

function initialStats(): RaphaelStatsV1 {
  return {
    schema_version: 1,
    antibodies: {},
    distill: { last_nag_digest: null }
  }
}

function initialAntibodyStats(): AntibodyStats {
  return { fired: 0, last_fired: null, misses: 0, last_miss: null }
}

function validStats(value: unknown): value is AntibodyStats {
  if (!isRecord(value)) return false
  return (
    isNonNegativeInteger(value.fired) &&
    isNullableDate(value.last_fired) &&
    isNonNegativeInteger(value.misses) &&
    isNullableDate(value.last_miss)
  )
}

function normalizeDistill(value: unknown): RaphaelStatsV1["distill"] {
  if (
    !isRecord(value) ||
    !(
      value.last_nag_digest === null ||
      (typeof value.last_nag_digest === "string" &&
        DIGEST_PATTERN.test(value.last_nag_digest))
    )
  ) {
    return { last_nag_digest: null }
  }
  return { last_nag_digest: value.last_nag_digest }
}

function incrementFire(current: AntibodyStats, date: string): AntibodyStats {
  return {
    ...current,
    fired: current.fired + 1,
    last_fired: maxDate(current.last_fired, date)
  }
}

function maxDate(left: string | null, right: string | null): string | null {
  if (left === null) return right
  if (right === null) return left
  return left >= right ? left : right
}

function localDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0")
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isNullableDate(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && DATE_PATTERN.test(value))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
