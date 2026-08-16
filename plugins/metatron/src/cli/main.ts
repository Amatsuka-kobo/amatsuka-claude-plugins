// metatron CLI のディスパッチ本体(契約 §11)。
//
// 経路は 2 層に分かれる(契約 §4-3、設計書 §12-1)。
//
// - 読み取り・注入経路(第 2 層・フェイルオープン): get / scan / diff-architecture。
//   **常に exit 0**。読めなかったことも事実として JSON で返す。
// - 書き込み経路(第 1 層・フェイルクローズド): stage-architecture / stage-adr /
//   commit-architecture / append-gotcha / tag-gotcha。拒否・失敗は非 0 終了。
//
// この分岐を 1 箇所に集めているのは、サブコマンドを足したときに層の判断が
// 各ファイルへ散らばらないようにするためである。

import { runDiffArchitecture, runScan } from "./analysis.js"
import { parseArgs } from "./args.js"
import { runCommitArchitecture } from "./commit.js"
import { runGet } from "./get.js"
import { runAppendGotcha, runTagGotcha } from "./gotcha.js"
import {
  EXIT_USAGE,
  emitReadFailure,
  emitResult,
  emitWriteFailure,
  messageOf,
  note
} from "./output.js"
import { USAGE_LINES } from "./paths.js"
import { runStageAdr, runStageArchitecture } from "./stage.js"

/** 常に exit 0 で返すサブコマンド(契約 §11 の「読」)。 */
const READ_SUBCOMMANDS = new Set(["get", "scan", "diff-architecture"])

const WRITE_SUBCOMMANDS = new Set([
  "stage-architecture",
  "stage-adr",
  "commit-architecture",
  "append-gotcha",
  "tag-gotcha"
])

function emitUsage(command: string, message: string, exitCode: number): void {
  emitResult(command, {
    ok: false,
    error: "unknown_subcommand",
    message,
    subcommands: [...READ_SUBCOMMANDS, ...WRITE_SUBCOMMANDS]
  })
  for (const line of USAGE_LINES) note(line)
  process.exitCode = exitCode
}

export function main(
  argv: readonly string[],
  cwd: string = process.cwd()
): void {
  const { positionals, flags, errors } = parseArgs(argv)
  const subcommand = positionals[0]
  const isRead = subcommand !== undefined && READ_SUBCOMMANDS.has(subcommand)
  const isWrite = subcommand !== undefined && WRITE_SUBCOMMANDS.has(subcommand)

  if (subcommand === undefined || (!isRead && !isWrite)) {
    emitUsage(
      "metatron",
      subcommand === undefined
        ? "サブコマンドを指定してください。"
        : `不明なサブコマンド: ${subcommand}`,
      EXIT_USAGE
    )
    return
  }

  if (errors.length > 0) {
    const message = errors.join(" / ")
    if (isRead) {
      emitReadFailure(subcommand, "invalid_option", message)
    } else {
      emitWriteFailure(subcommand, "invalid_option", message, {}, EXIT_USAGE)
    }
    return
  }

  const ctx = { flags, cwd }

  try {
    switch (subcommand) {
      case "get":
        runGet(positionals[1], ctx)
        return
      case "scan":
        runScan(ctx)
        return
      case "diff-architecture":
        runDiffArchitecture(ctx)
        return
      case "stage-architecture":
        runStageArchitecture(ctx)
        return
      case "stage-adr":
        runStageAdr(ctx)
        return
      case "commit-architecture":
        runCommitArchitecture(ctx)
        return
      case "append-gotcha":
        runAppendGotcha(ctx)
        return
      case "tag-gotcha":
        runTagGotcha(ctx)
        return
      default:
        emitUsage("metatron", `不明なサブコマンド: ${subcommand}`, EXIT_USAGE)
        return
    }
  } catch (error) {
    // ここへ来るのは各ハンドラの catch を抜けた想定外の失敗だけ。
    // 層ごとの方針は変えない(読み取りは通し、書き込みは止める)。
    if (isRead) {
      emitReadFailure(subcommand, "internal_error", messageOf(error))
      return
    }
    emitWriteFailure(subcommand, "internal_error", messageOf(error), {
      written: false
    })
  }
}
