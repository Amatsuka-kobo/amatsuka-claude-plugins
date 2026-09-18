export const DEFAULT_MODEL = "sonnet"

export const LENGTH_TARGET = 600
export const LENGTH_FLOOR = 680

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
