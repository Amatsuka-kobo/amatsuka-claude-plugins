// `--input <path>` の読み取り(契約 §11)。
//
// 長い入力は一時ファイルに書いて `--input` で渡すのが正式な経路である。
// stdin も補助として受け付けるが、案内・拒否メッセージ・スキルは常に `--input` の
// 形だけを示す(示す形が 2 つあると経路が分岐するため)。
// CLI は読み取り後に一時ファイルを削除しない。

import fs from "node:fs"
import { hashContent } from "../lib/staging.js"
import { stringFlag } from "./args.js"
import { messageOf } from "./output.js"

export type InputLoad =
  | { ok: true; source: string; value: unknown }
  | {
      ok: false
      error: "missing_input" | "unreadable_input" | "invalid_json"
      message: string
    }

function readStdinSync(): string | null {
  if (process.stdin.isTTY === true) return null
  try {
    return fs.readFileSync(0, "utf8")
  } catch {
    return null
  }
}

export function loadInputJson(flags: Record<string, string | true>): InputLoad {
  const inputPath = stringFlag(flags, "input")

  let raw: string
  let source: string

  if (inputPath !== undefined) {
    source = inputPath
    try {
      raw = fs.readFileSync(inputPath, "utf8")
    } catch (error) {
      return {
        ok: false,
        error: "unreadable_input",
        message: `--input ${inputPath} を読めませんでした: ${messageOf(error)}`
      }
    }
  } else {
    const piped = readStdinSync()
    if (piped === null || piped.trim() === "") {
      return {
        ok: false,
        error: "missing_input",
        message:
          "--input <path> が必要です。入力の JSON を一時ファイルに書いてからパスを渡してください。"
      }
    }
    source = "<stdin>"
    raw = piped
  }

  try {
    return { ok: true, source, value: JSON.parse(raw) }
  } catch (error) {
    return {
      ok: false,
      error: "invalid_json",
      message: `${source} が有効な JSON ではありません: ${messageOf(error)}`
    }
  }
}

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface DocumentRead {
  path: string
  exists: boolean
  text: string
  /** 読み取ったバイト列のハッシュ。存在しなければ null。 */
  hash: string | null
  /** 存在しない以外の理由で読めなかった場合の 1 行説明。 */
  warnings: string[]
}

/**
 * 文書ファイルの読み取り。存在しない場合も読めない場合も例外を投げない。
 *
 * ハッシュは**読み取ったバイト列**から計算する。commit 時の照合は
 * `hashFileOrNull`(バイト列)と行うため、文字列へ復号してから計算すると
 * 不正な UTF-8 を含むファイルで食い違う。
 */
export function readDocument(filePath: string): DocumentRead {
  try {
    const buf = fs.readFileSync(filePath)
    return {
      path: filePath,
      exists: true,
      text: buf.toString("utf8"),
      hash: hashContent(buf),
      warnings: []
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const warnings =
      code === "ENOENT"
        ? []
        : [
            `${filePath} を読めませんでした(${code ?? "unknown"})。未作成として扱います。`
          ]
    return { path: filePath, exists: false, text: "", hash: null, warnings }
  }
}
