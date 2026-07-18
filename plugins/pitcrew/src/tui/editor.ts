// $EDITOR / $VISUAL でスクラッチファイルを開く(設計書 §3.3)。
// spawnSync でエディタ終了までブロックする(呼び出し側が raw mode を
// 解除してから呼ぶ)。環境変数は空白分割のみで shell は介さない。

import { spawnSync } from "node:child_process"

export interface EditorCommand {
  cmd: string
  args: string[]
}

export function resolveEditor(
  env: Record<string, string | undefined>
): EditorCommand | null {
  const raw = (env.VISUAL?.trim() || env.EDITOR?.trim()) ?? ""
  if (raw === "") return null
  const parts = raw.split(/\s+/)
  return { cmd: parts[0], args: parts.slice(1) }
}

type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { stdio: "inherit" }
) => { status: number | null }

export function openInEditor(
  env: Record<string, string | undefined>,
  filePath: string,
  spawn: SpawnLike = spawnSync
): { ok: boolean } | null {
  const editor = resolveEditor(env)
  if (editor === null) return null
  const result = spawn(editor.cmd, [...editor.args, filePath], {
    stdio: "inherit"
  })
  return { ok: result.status === 0 }
}
