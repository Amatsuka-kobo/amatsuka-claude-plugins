import { readCommandLog } from "./command-log.js"
import type { AntibodyTrigger } from "./types.js"

const MAX_CORPUS_SIZE = 2_000
const DEFAULT_MAX_RATIO = 10
const DEFAULT_MIN_CORPUS = 50

export type BreadthReport =
  | {
      checked: false
      reason: "tool_not_applicable"
    }
  | {
      checked: false
      reason: "corpus_too_small"
      corpus_size: number
    }
  | {
      checked: true
      corpus_size: number
      matched: number
      ratio: number
    }

export interface BreadthEvaluation {
  tooBroad: boolean
  breadth: BreadthReport
  samples: string[]
}

export function buildBreadthCorpus(projectDir: string): string[] {
  return [
    ...new Set(
      readCommandLog(projectDir).map((entry) => entry.normalized_command)
    )
  ]
    .sort(compareCodePoints)
    .slice(0, MAX_CORPUS_SIZE)
}

export function evaluateBreadthCorpus(
  corpus: readonly string[],
  trigger: AntibodyTrigger,
  maxRatio = DEFAULT_MAX_RATIO,
  minCorpus = DEFAULT_MIN_CORPUS
): BreadthEvaluation {
  if (trigger.tool !== "Bash" && trigger.tool !== "*") {
    return {
      tooBroad: false,
      breadth: { checked: false, reason: "tool_not_applicable" },
      samples: []
    }
  }

  if (corpus.length < minCorpus) {
    return {
      tooBroad: false,
      breadth: {
        checked: false,
        reason: "corpus_too_small",
        corpus_size: corpus.length
      },
      samples: []
    }
  }

  const pattern = new RegExp(trigger.pattern)
  const matches = corpus.filter((command) => pattern.test(command))
  const ratio = matches.length / corpus.length
  return {
    tooBroad: ratio > maxRatio / 100,
    breadth: {
      checked: true,
      corpus_size: corpus.length,
      matched: matches.length,
      ratio
    },
    samples: matches.slice(0, 5)
  }
}

export function evaluateBreadth(
  projectDir: string,
  trigger: AntibodyTrigger,
  maxRatio = DEFAULT_MAX_RATIO,
  minCorpus = DEFAULT_MIN_CORPUS,
  suppliedCorpus?: readonly string[]
): BreadthEvaluation {
  return evaluateBreadthCorpus(
    suppliedCorpus ?? buildBreadthCorpus(projectDir),
    trigger,
    maxRatio,
    minCorpus
  )
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left]
  const rightPoints = [...right]
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftPoints[index]?.codePointAt(0) ?? 0) -
      (rightPoints[index]?.codePointAt(0) ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}
