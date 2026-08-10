/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0.
 *
 * Ported from split_eval_set in scripts/run_loop.py of the skill-creator
 * Claude Code plugin.
 *
 * Change: the shuffle uses a seeded PRNG implemented here instead of Python's
 * random module. The split is deterministic across runs but does not
 * reproduce Python's sequence.
 */

import type { EvalItem } from "./types.js"

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function splitEvalSet(
  evalSet: EvalItem[],
  holdout: number,
  seed = 42
): { train: EvalItem[]; test: EvalItem[] } {
  const rand = mulberry32(seed)
  const positives = shuffled(
    evalSet.filter((e) => e.should_trigger),
    rand
  )
  const negatives = shuffled(
    evalSet.filter((e) => !e.should_trigger),
    rand
  )

  const nPositiveTest = Math.max(1, Math.floor(positives.length * holdout))
  const nNegativeTest = Math.max(1, Math.floor(negatives.length * holdout))

  return {
    test: [
      ...positives.slice(0, nPositiveTest),
      ...negatives.slice(0, nNegativeTest)
    ],
    train: [
      ...positives.slice(nPositiveTest),
      ...negatives.slice(nNegativeTest)
    ]
  }
}
