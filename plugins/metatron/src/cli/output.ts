// 契約 §11 の入出力規約。
//
// - 出力は常に JSON を stdout へ。人間向けの補足は stderr へ。
// - 読み取り系は常に exit 0(「読めなかった」も事実として JSON で返す)。
// - 書き込み系は成功で exit 0、拒否・失敗で非 0。理由は JSON の `error` に入れる。
//
// 終了は `process.exitCode` で表す。`process.exit()` は stdout がパイプのとき
// 書き込みを取りこぼしうるため使わない。

export const EXIT_OK = 0
/** 内容の拒否(検証失敗・ロック失敗・対象が無い)。 */
export const EXIT_REJECTED = 1
/** 呼び出し方の誤り(サブコマンド不明・必須オプション欠落・入力を読めない)。 */
export const EXIT_USAGE = 2

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

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
