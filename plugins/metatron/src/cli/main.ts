// metatron CLI のディスパッチ本体(契約 §11)。
//
// 経路は 2 層に分かれる(契約 §4-3、設計書 §12-1)。
//
// - 読み取り・注入経路(第 2 層・フェイルオープン): get / scan / diff-architecture /
//   scan-adr-candidates / scan-gotcha-candidates。
//   **常に exit 0**。読めなかったことも事実として JSON で返す。
// - 書き込み経路(第 1 層・フェイルクローズド): stage-architecture / stage-adr /
//   stage-rules / commit-architecture / commit-rules / init-gotchas / append-gotcha /
//   tag-gotcha / shrink-adr-candidate / remove-gotcha-candidate。
//   拒否・失敗は非 0 終了。shrink-adr-candidate と remove-gotcha-candidate の拒否・失敗は
//   終了コード 3 に揃える(ハンドラが自分で例外を捕まえる)。
//
// ADR と GOTCHAS の書き込みは、対応する環境変数が有効なときだけ受け付ける
// (`harness-docs/design/2026-10-08-metatron-adr-gotchas-opt-in-design.md` の 3-2)。
// サブコマンドと変数の対応は FEATURE_GATES の 1 か所に置き、入力を読む前に拒否する。
// commit-architecture だけは staging の種別が分かるまで判定できないので commit.ts で拒否する。
// この拒否の終了コードは shrink-adr-candidate と remove-gotcha-candidate を含めてすべて 1 とする。
// 終了コード 3 は「やり直せば通りうる拒否」の契約であり、変数を変えない限り通らないこの拒否には使わない。
//
// この分岐を 1 箇所に集めているのは、サブコマンドを足したときに層の判断が
// 各ファイルへ散らばらないようにするためである。

import { type Feature, readFeatures } from "../lib/features.js"
import { runScanAdrCandidates, runShrinkAdrCandidate } from "./adr-candidate.js"
import { runDiffArchitecture, runScan } from "./analysis.js"
import { parseArgs } from "./args.js"
import { runCommitArchitecture, runCommitRules } from "./commit.js"
import { runGet } from "./get.js"
import { runAppendGotcha, runInitGotchas, runTagGotcha } from "./gotcha.js"
import {
  runRemoveGotchaCandidate,
  runScanGotchaCandidates
} from "./gotcha-candidate.js"
import {
  EXIT_USAGE,
  emitFeatureDisabled,
  emitReadFailure,
  emitResult,
  emitWriteFailure,
  messageOf,
  note
} from "./output.js"
import { USAGE_LINES } from "./paths.js"
import { runStageAdr, runStageArchitecture, runStageRules } from "./stage.js"

/** 常に exit 0 で返すサブコマンド(契約 §11 の「読」)。 */
export const READ_SUBCOMMANDS = new Set([
  "get",
  "scan",
  "diff-architecture",
  "scan-adr-candidates",
  "scan-gotcha-candidates"
])

export const WRITE_SUBCOMMANDS = new Set([
  "stage-architecture",
  "stage-adr",
  "stage-rules",
  "commit-architecture",
  "commit-rules",
  "init-gotchas",
  "append-gotcha",
  "tag-gotcha",
  "shrink-adr-candidate",
  "remove-gotcha-candidate"
])

/** 環境変数が無効なら拒否する書き込み系サブコマンドと、対応する機能。 */
export const FEATURE_GATES: ReadonlyMap<string, Feature> = new Map([
  ["stage-adr", "adr"],
  ["shrink-adr-candidate", "adr"],
  ["init-gotchas", "gotchas"],
  ["append-gotcha", "gotchas"],
  ["tag-gotcha", "gotchas"],
  ["remove-gotcha-candidate", "gotchas"]
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
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
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

  const features = readFeatures(env)
  const gate = FEATURE_GATES.get(subcommand)
  if (gate !== undefined && !features[gate]) {
    emitFeatureDisabled(subcommand, gate)
    return
  }

  const ctx = { flags, cwd, features }

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
      case "scan-adr-candidates":
        runScanAdrCandidates(ctx)
        return
      case "scan-gotcha-candidates":
        runScanGotchaCandidates(ctx)
        return
      case "stage-architecture":
        runStageArchitecture(ctx)
        return
      case "stage-adr":
        runStageAdr(ctx)
        return
      case "stage-rules":
        runStageRules(ctx)
        return
      case "commit-architecture":
        runCommitArchitecture(ctx)
        return
      case "commit-rules":
        runCommitRules(ctx)
        return
      case "init-gotchas":
        runInitGotchas(ctx)
        return
      case "append-gotcha":
        runAppendGotcha(ctx)
        return
      case "tag-gotcha":
        runTagGotcha(ctx)
        return
      case "shrink-adr-candidate":
        runShrinkAdrCandidate(ctx)
        return
      case "remove-gotcha-candidate":
        runRemoveGotchaCandidate(ctx)
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
