// 契約 §11 の入出力規約。
//
// - 出力は常に JSON を stdout へ。人間向けの補足は stderr へ。
// - 読み取り系は常に exit 0(「読めなかった」も事実として JSON で返す)。
// - 書き込み系は成功で exit 0、拒否・失敗で非 0。理由は JSON の `error` に入れる。
//
// 終了は `process.exitCode` で表す。`process.exit()` は stdout がパイプのとき
// 書き込みを取りこぼしうるため使わない。

import { FEATURE_ENV, type Feature } from "../lib/features.js"

export const EXIT_OK = 0
/** 内容の拒否(検証失敗・ロック失敗・対象が無い)。 */
export const EXIT_REJECTED = 1
/** 呼び出し方の誤り(サブコマンド不明・必須オプション欠落・入力を読めない)。 */
export const EXIT_USAGE = 2
/**
 * `shrink-adr-candidate` の拒否・失敗。持続層に何も書かず、`shrinkPending` を返す
 * (codiel intent 駆動化の設計書 §6.11.4)。呼び出し元はこの値で縮約のやり直しを判断する。
 * `remove-gotcha-candidate` も同じ値を使い、`removePending` を返す。
 */
export const EXIT_SHRINK_PENDING = 3

export function emitResult(
  command: string,
  payload: Record<string, unknown>
): void {
  process.stdout.write(`${JSON.stringify({ command, ...payload }, null, 2)}\n`)
}

export function note(line: string): void {
  process.stderr.write(`${line}\n`)
}

export function noteWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) note(`warning: ${warning}`)
}

/** 読み取り系の「読めなかった」。事実として JSON で返し、exit は 0 のまま。 */
export function emitReadFailure(
  command: string,
  error: string,
  message: string,
  extra: Record<string, unknown> = {}
): void {
  emitResult(command, { ok: false, error, message, ...extra })
  note(message)
}

/** 書き込み系の拒否・失敗。非 0 終了する。 */
export function emitWriteFailure(
  command: string,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  exitCode: number = EXIT_REJECTED
): void {
  emitResult(command, { ok: false, error, message, ...extra })
  note(message)
  process.exitCode = exitCode
}

const FEATURE_LABEL: Readonly<Record<Feature, string>> = {
  adr: "ADR",
  gotchas: "GOTCHAS"
}

/**
 * 記録が無効な機能への書き込みの拒否。終了コードは 1 に固定する(main.ts の冒頭コメント)。
 * 有効にする方法を文面に載せ、呼び出し元が変数名と値をそのまま読めるよう JSON にも入れる。
 */
export function emitFeatureDisabled(command: string, feature: Feature): void {
  const env = FEATURE_ENV[feature]
  emitWriteFailure(
    command,
    "feature_disabled",
    `${FEATURE_LABEL[feature]} の記録は無効です。有効にするには環境変数 ${env} を 1(true / on も可)にしてください。CLI は実行時の値を読みます(注入はセッション開始時の値を使うので、注入に反映するには新しいセッションが必要です)。`,
    { written: false, feature, env },
    EXIT_REJECTED
  )
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
