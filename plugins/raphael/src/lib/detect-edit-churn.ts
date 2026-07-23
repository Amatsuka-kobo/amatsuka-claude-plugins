import type { InfectionDetails, RaphaelStateV1 } from "./types.js"

type RecentEdit = RaphaelStateV1["recent_edits"][number]
export type EditFootprint = Omit<RecentEdit, "ts">
type ChurnDetails = Extract<InfectionDetails, { type: "edit-churn" }>

export function findUniqueEditFootprint(
  filePath: string,
  postEditContent: string,
  newString: string
): EditFootprint | null {
  if (newString === "") return null
  const firstIndex = postEditContent.indexOf(newString)
  if (
    firstIndex < 0 ||
    postEditContent.indexOf(newString, firstIndex + 1) >= 0
  ) {
    return null
  }
  const lineStart = 1 + countNewlines(postEditContent.slice(0, firstIndex))
  return {
    file_path: filePath,
    line_start: lineStart,
    line_end: lineStart + countNewlines(newString)
  }
}

export function footprintsOverlap(
  left: EditFootprint,
  right: EditFootprint
): boolean {
  return (
    left.file_path === right.file_path &&
    left.line_start <= right.line_end &&
    right.line_start <= left.line_end
  )
}

export function detectEditChurn(
  recentEdits: readonly RecentEdit[],
  threshold = 3
): ChurnDetails | null {
  if (!Number.isInteger(threshold) || threshold < 2 || recentEdits.length === 0)
    return null

  const latest = recentEdits.at(-1)
  if (!latest) return null
  const sameFile = recentEdits.filter(
    (edit) => edit.file_path === latest.file_path
  )
  const window = sameFile.slice(-threshold)
  if (window.length !== threshold) return null

  const lineStart = Math.max(...window.map((edit) => edit.line_start))
  const lineEnd = Math.min(...window.map((edit) => edit.line_end))
  if (lineStart > lineEnd) return null

  return {
    type: "edit-churn",
    file_path: latest.file_path,
    line_start: lineStart,
    line_end: lineEnd,
    edits_in_window: threshold
  }
}

function countNewlines(value: string): number {
  return (value.match(/\n/g) ?? []).length
}
