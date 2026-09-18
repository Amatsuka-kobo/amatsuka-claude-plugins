export const DEFAULT_MODEL = "sonnet"

// 言語名ではなく、1文字あたりのUTF-8バイト数で説明文の予算を分類する。
// 実測の遷移帯(多バイト文字は717〜741、1バイト文字は530〜565バイト)より下に
// 2組の数値を置き、発火が崩れ始める前に短い説明へ誘導する。コードパスや識別子が
// 多い説明では比が下がって厳しい側の予算になるが、安全側へ倒すための分類である。
export const MULTIBYTE_RATIO_THRESHOLD = 1.5

export interface LengthLimits {
  target: number
  floor: number
}

export const MULTIBYTE_LENGTH_LIMITS: LengthLimits = {
  target: 600,
  floor: 680
}

export const SINGLEBYTE_LENGTH_LIMITS: LengthLimits = {
  target: 450,
  floor: 500
}

export function bytesPerChar(value: string): number {
  const charCount = [...value].length
  return charCount === 0 ? 1 : Buffer.byteLength(value, "utf8") / charCount
}

export function lengthLimitsFor(value: string): LengthLimits {
  return bytesPerChar(value) >= MULTIBYTE_RATIO_THRESHOLD
    ? MULTIBYTE_LENGTH_LIMITS
    : SINGLEBYTE_LENGTH_LIMITS
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

export const DEFAULTS = {
  runsPerQuery: 3,
  numWorkers: 10,
  timeout: 30,
  triggerThreshold: 0.5,
  holdout: 0.4,
  maxIterations: 5,
  improveTimeout: 300
} as const
