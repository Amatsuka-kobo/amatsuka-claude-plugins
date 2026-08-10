export interface EvalItem {
  query: string
  should_trigger: boolean
}

export interface EvalResultItem extends EvalItem {
  trigger_rate: number
  triggers: number
  runs: number
  pass: boolean
}

export interface EvalSummary {
  total: number
  passed: number
  failed: number
}

import type { Environment } from "./claude-cli.js"

export type { Environment }

export interface EvalResult {
  skill_name: string
  description: string
  environment: Environment
  results: EvalResultItem[]
  summary: EvalSummary
}

export interface RunEvalOptions {
  evalSet: EvalItem[]
  skillName: string
  skillContent: string
  description: string
  runsPerQuery: number
  numWorkers: number
  timeout: number
  triggerThreshold: number
  model?: string
  verbose?: boolean
}

export interface IterationRecord {
  iteration: number
  description: string
  train_passed: number
  train_failed: number
  train_total: number
  train_results: EvalResultItem[]
  test_passed: number | null
  test_failed: number | null
  test_total: number | null
  test_results: EvalResultItem[] | null
  passed: number
  failed: number
  total: number
  results: EvalResultItem[]
}

export interface LoopResult {
  exit_reason: string
  original_description: string
  best_description: string
  best_score: string
  best_train_score: string
  best_test_score: string | null
  final_description: string
  iterations_run: number
  holdout: number
  train_size: number
  test_size: number
  history: IterationRecord[]
}
