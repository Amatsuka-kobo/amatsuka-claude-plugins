#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { listAntibodies, setAntibodyStatus } from "./lib/antibody-store.js"
import { writeFileAtomic } from "./lib/atomic.js"
import { loadConfig } from "./lib/config.js"
import { logError, readStdinSync, resolveProjectDir } from "./lib/hook-io.js"
import {
  computeDistillNagDigest,
  parseInfectionLine
} from "./lib/infection-store.js"
import { loadState, saveState } from "./lib/state-store.js"
import type { HookInput } from "./lib/types.js"

const DISTILLED_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000

export interface CleanupResult {
  undistilledIds: string[]
}

export function cleanupProject(
  projectDir: string,
  now = new Date()
): CleanupResult {
  const undistilledIds = cleanupInfections(projectDir, now)
  expireAntibodies(projectDir, now)
  return { undistilledIds }
}

export function localDateString(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0")
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function cleanupInfections(projectDir: string, now: Date): string[] {
  const directory = path.join(projectDir, ".raphael", "infections")
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return []
    throw error
  }

  const cutoff = now.getTime() - DISTILLED_RETENTION_MS
  const undistilledIds: string[] = []
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort(codePointCompare)

  for (const file of files) {
    const filePath = path.join(directory, file)
    const raw = fs.readFileSync(filePath, "utf8")
    const lines = raw.split(/\r?\n/)
    if (lines.at(-1) === "") lines.pop()

    const retained: string[] = []
    for (const line of lines) {
      if (line.trim() === "") continue
      const record = parseInfectionLine(line)
      if (!record) {
        retained.push(line)
        continue
      }
      if (!record.distilled) {
        undistilledIds.push(record.id)
        retained.push(line)
        continue
      }
      const distilledAt =
        record.distilled_at === null
          ? Number.NaN
          : Date.parse(record.distilled_at)
      if (!Number.isFinite(distilledAt) || distilledAt >= cutoff) {
        retained.push(line)
      }
    }

    if (retained.length === 0) {
      fs.rmSync(filePath)
    } else if (
      retained.length !== lines.length ||
      retained.some((line, index) => line !== lines[index])
    ) {
      writeFileAtomic(filePath, `${retained.join("\n")}\n`)
    }
  }

  return undistilledIds
}

function expireAntibodies(projectDir: string, now: Date): void {
  const today = localDateString(now)
  const { antibodies } = listAntibodies(projectDir)
  for (const antibody of antibodies) {
    if (antibody.status === "active" && antibody.expires < today) {
      setAntibodyStatus(projectDir, antibody.id, "expired")
    }
  }
}

function buildReason(
  projectDir: string,
  pluginRoot: string,
  undistilledCount: number
): string {
  const listScript = path.join(pluginRoot, "scripts", "list-antibodies.mjs")
  const updateScript = path.join(pluginRoot, "scripts", "update-antibody.mjs")
  return [
    "Raphael に未蒸留の infection record が蓄積しています。感染内容や secret をこのメッセージへ展開せず、蒸留を専用サブエージェントへ委譲してください。",
    'Agent ツールで subagent_type "raphael:antibody-synthesizer" を起動してください。',
    `対象 project: ${projectDir}`,
    `未蒸留 infection 件数: ${undistilledCount}`,
    "抗体の確認と更新には次の絶対 plugin path を使用するよう指示してください。",
    `- node "${listScript}" --json --include-body`,
    `- node "${updateScript}"`,
    "注入後の成功フィードバックは synthesizer が state.injected と現在の session infections を読んで判断し、この hook では判断しません。"
  ].join("\n")
}

function run(): void {
  const input = readStdinSync()
  if (!input || input.stop_hook_active) return

  const session = validSession(input)
  if (session === null) return
  const projectDir = path.resolve(resolveProjectDir(input))

  try {
    const config = loadConfig(projectDir)
    const { undistilledIds } = cleanupProject(projectDir)
    if (undistilledIds.length < config.distillThreshold) return

    const digest = computeDistillNagDigest(undistilledIds)
    const state = loadState(projectDir, session)
    if (state.last_distill_nag_digest === digest) return

    const pluginRoot = path.resolve(
      process.env.CLAUDE_PLUGIN_ROOT || "<raphael plugin root>"
    )
    const reason = buildReason(projectDir, pluginRoot, undistilledIds.length)
    const nextState = { ...state, last_distill_nag_digest: digest }
    saveState(projectDir, nextState)
    process.stdout.write(JSON.stringify({ decision: "block", reason }))
  } catch (error) {
    logError(projectDir, "check-distill-needed", error)
  }
}

function validSession(input: HookInput): string | null {
  return typeof input.session_id === "string" && input.session_id !== ""
    ? input.session_id
    : null
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  )
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

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  run()
