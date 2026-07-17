import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"

// .pitcrew/run.json のスキーマ(設計書 §3)。phase は将来の codiel 連携用の予約フィールド。
export interface RunState {
  startedAt: string
  lastCaptureCommit: string | null
  lastCaptureAt: string | null
  nextReviewId: number
  phase?: string
}

export function pitcrewDir(projectDir: string): string {
  return path.join(projectDir, ".pitcrew")
}

function initialRun(): RunState {
  return {
    startedAt: new Date().toISOString(),
    lastCaptureCommit: null,
    lastCaptureAt: null,
    nextReviewId: 1
  }
}

// run.json が無い・壊れている場合は初期値を返す(保存はしない。
// 保存は捕捉が成功したときに saveRun で行う)。
export function loadRun(projectDir: string): RunState {
  const file = path.join(pitcrewDir(projectDir), "run.json")
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    return initialRun()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RunState>
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.nextReviewId !== "number" ||
      !Number.isInteger(parsed.nextReviewId) ||
      parsed.nextReviewId < 1
    )
      return initialRun()
    return {
      startedAt:
        typeof parsed.startedAt === "string"
          ? parsed.startedAt
          : new Date().toISOString(),
      lastCaptureCommit:
        typeof parsed.lastCaptureCommit === "string"
          ? parsed.lastCaptureCommit
          : null,
      lastCaptureAt:
        typeof parsed.lastCaptureAt === "string" ? parsed.lastCaptureAt : null,
      nextReviewId: parsed.nextReviewId,
      ...(typeof parsed.phase === "string" ? { phase: parsed.phase } : {})
    }
  } catch {
    return initialRun()
  }
}

export function saveRun(projectDir: string, run: RunState): void {
  writeFileAtomic(
    path.join(pitcrewDir(projectDir), "run.json"),
    `${JSON.stringify(run, null, 2)}\n`
  )
}
