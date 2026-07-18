import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "../lib/frontmatter.js"
import { pitcrewDir } from "../lib/run.js"

// ブラウザビューアの読み取り側(設計書 §5)。.pitcrew/ のファイルを読むだけで、
// 書き込みは viewer-ops.ts に分離する。壊れたファイルは既定値で埋めて一覧に残す
// (1 ファイルの破損で全体を落とさない。設計書 §9 のフェイルオープンの精神)。

export interface QueueItem {
  name: string
  status: "review" | "reviewed"
  id: string | null
  type: string | null
  agent: string | null
  created: string | null
  paths: string[]
  base: string | null
  head: string | null
  title: string
}

export interface PitcrewState {
  hasRun: boolean
  startedAt: string | null
  lastCaptureAt: string | null
  phase: string | null
  review: QueueItem[]
  reviewed: QueueItem[]
  openComments: number
  processedComments: number
}

// API が受け取るファイル名の安全確認(Global Constraints)。
// 単一セグメントの .md のみ許可し、".." を含む名前は拒否する
export function isSafeName(name: string): boolean {
  return (
    /^[A-Za-z0-9._-]+\.md$/.test(name) &&
    !name.includes("..") &&
    !name.includes("/")
  )
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function asPaths(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value !== "") return [value]
  return []
}

function readItems(
  projectDir: string,
  status: "review" | "reviewed"
): QueueItem[] {
  const dir = path.join(pitcrewDir(projectDir), status)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const items: QueueItem[] = []
  for (const name of names.sort().reverse()) {
    if (!name.endsWith(".md")) continue
    let raw: string
    try {
      if (!fs.statSync(path.join(dir, name)).isFile()) continue
      raw = fs.readFileSync(path.join(dir, name), "utf8")
    } catch {
      continue
    }
    const { data, body } = parseFrontmatter(raw)
    const heading = body.match(/^#\s+(.+)$/m)
    items.push({
      name,
      status,
      id: asString(data.id),
      type: asString(data.type),
      agent: asString(data.agent),
      created: asString(data.created),
      paths: asPaths(data.paths),
      base: asString(data.base),
      head: asString(data.head),
      title: heading ? heading[1].trim() : name
    })
  }
  return items
}

function countMd(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".md")).length
  } catch {
    return 0
  }
}

export function listState(projectDir: string): PitcrewState {
  const base = pitcrewDir(projectDir)
  // run.json は「存在するときだけ」実行情報を出す(loadRun は無い場合に
  // 初期値を作ってしまうため、ここでは存在確認してから読む)
  let hasRun = false
  let startedAt: string | null = null
  let lastCaptureAt: string | null = null
  let phase: string | null = null
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(base, "run.json"), "utf8")
    ) as Record<string, unknown>
    hasRun = true
    if (typeof parsed.startedAt === "string") startedAt = parsed.startedAt
    if (typeof parsed.lastCaptureAt === "string")
      lastCaptureAt = parsed.lastCaptureAt
    if (typeof parsed.phase === "string") phase = parsed.phase
  } catch {
    // run.json 無し・破損 → 実行情報なしとして返す
  }
  return {
    hasRun,
    startedAt,
    lastCaptureAt,
    phase,
    review: readItems(projectDir, "review"),
    reviewed: readItems(projectDir, "reviewed"),
    openComments: countMd(path.join(base, "comments")),
    processedComments: countMd(path.join(base, "comments", "processed"))
  }
}

export function readItemBody(
  projectDir: string,
  status: "review" | "reviewed",
  name: string
): string | null {
  if (!isSafeName(name)) return null
  try {
    return fs.readFileSync(
      path.join(pitcrewDir(projectDir), status, name),
      "utf8"
    )
  } catch {
    return null
  }
}
