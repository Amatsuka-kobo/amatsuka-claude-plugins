import type { QuestionSpec, StateValue } from "./client.js"

export const TOTAL_BUDGET = 51_200
export const LONGEST_BUDGET = 25_600
export const QUESTION_OVERHEAD = 16
export const MAX_QUESTIONS_PER_BATCH = 100
export const JEV_CONCURRENCY = 4

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2.5)
}

export function estimateValue(value: unknown): number {
  if (typeof value === "string") return estimateTokens(value)
  return estimateTokens(JSON.stringify(value) ?? "")
}

export function estimateQuestion(question: QuestionSpec): number {
  let total = estimateTokens(question.instructions ?? "") + QUESTION_OVERHEAD

  switch (question.type) {
    case "noul":
      if (question.criteria !== undefined)
        total += estimateTokens(JSON.stringify(question.criteria) ?? "")
      break
    case "choice":
      for (const [label, description] of Object.entries(question.options)) {
        total += estimateTokens(label) + estimateValue(description)
      }
      break
    case "score":
      for (const level of question.levels) total += estimateTokens(level)
      break
  }

  return total
}

export function planBatches<T>(
  items: readonly T[],
  opts: {
    base: number
    itemState: (item: T) => number
    itemQuestion: (item: T) => number
  }
): { batches: T[][]; tooLarge: T[] } {
  const batches: T[][] = []
  const tooLarge: T[] = []
  let batch: T[] = []
  let stateTokens = 0
  let questionTokens = 0
  let longestQuestionTokens = 0

  const fits = (
    state: number,
    questions: number,
    longestQuestion: number,
    count: number
  ): boolean =>
    count <= MAX_QUESTIONS_PER_BATCH &&
    opts.base + state + questions <= TOTAL_BUDGET &&
    opts.base + state + longestQuestion <= LONGEST_BUDGET

  for (const item of items) {
    const itemState = opts.itemState(item)
    const itemQuestion = opts.itemQuestion(item)
    const nextState = stateTokens + itemState
    const nextQuestions = questionTokens + itemQuestion
    const nextLongest = Math.max(longestQuestionTokens, itemQuestion)

    if (
      batch.length > 0 &&
      fits(nextState, nextQuestions, nextLongest, batch.length + 1)
    ) {
      batch.push(item)
      stateTokens = nextState
      questionTokens = nextQuestions
      longestQuestionTokens = nextLongest
      continue
    }

    if (batch.length > 0) batches.push(batch)
    batch = []
    stateTokens = 0
    questionTokens = 0
    longestQuestionTokens = 0

    if (fits(itemState, itemQuestion, itemQuestion, 1)) {
      batch.push(item)
      stateTokens = itemState
      questionTokens = itemQuestion
      longestQuestionTokens = itemQuestion
    } else {
      tooLarge.push(item)
    }
  }

  if (batch.length > 0) batches.push(batch)
  return { batches, tooLarge }
}

export function exceedsSoloLimit(
  valueTokens: number,
  fixedQuestionTokens: number
): boolean {
  return valueTokens > LONGEST_BUDGET - fixedQuestionTokens
}

export function bodyAllowance(
  stateWithoutBody: StateValue,
  questions: Record<string, QuestionSpec>
): number {
  const stateTokens = estimateValue(stateWithoutBody)
  const questionTokens = Object.values(questions).map(estimateQuestion)
  const totalQuestions = questionTokens.reduce((sum, tokens) => sum + tokens, 0)
  const longestQuestion = Math.max(0, ...questionTokens)

  return Math.min(
    TOTAL_BUDGET - stateTokens - totalQuestions,
    LONGEST_BUDGET - stateTokens - longestQuestion
  )
}

export function truncateBody(
  body: unknown,
  allowedTokens: number
): { body: unknown; truncated: boolean } {
  const text = typeof body === "string" ? body : (JSON.stringify(body) ?? "")
  if (estimateTokens(text) <= allowedTokens) return { body, truncated: false }

  const chars = Array.from(text)
  const totalBytes = Buffer.byteLength(text, "utf8")
  let low = 0
  let high = chars.length
  let truncated = ""

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const prefix = chars.slice(0, middle).join("")
    const omittedBytes = totalBytes - Buffer.byteLength(prefix, "utf8")
    const candidate = `${prefix}\n...[truncated ${omittedBytes} bytes]`

    if (omittedBytes > 0 && estimateTokens(candidate) <= allowedTokens) {
      truncated = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return { body: truncated, truncated: true }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit)))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await fn(items[index], index)
      }
    })
  )

  return results
}
