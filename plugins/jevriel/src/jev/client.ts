import {
  APIError,
  choice,
  type EntryType,
  type Fetch,
  type NoulQuestion,
  noul,
  type Questions,
  type ScoreCriteria,
  type SystemOneResult,
  score,
  TypeSafeClient
} from "@typesafe-ai/sdk"
import { log } from "../log.js"
import { estimateQuestion, estimateValue } from "./budget.js"

export type StateValue = string | Record<string, unknown> | unknown[] | null

export type QuestionSpec =
  | {
      type: "noul"
      instructions?: string
      criteria?: { true?: unknown; false?: unknown } | null
    }
  | {
      type: "choice"
      instructions: string
      options: Record<string, string | null>
    }
  | { type: "score"; instructions: string; levels: string[] }

export type JevRequest = {
  state: StateValue
  questions: Record<string, QuestionSpec>
  model?: string
}

export type JevCall = (
  req: JevRequest,
  options?: { timeout?: number }
) => Promise<SystemOneResult<Questions>>

function toQuestions(specs: Record<string, QuestionSpec>): Questions {
  const questions: Questions = {}

  for (const [name, spec] of Object.entries(specs)) {
    switch (spec.type) {
      case "noul":
        questions[name] = noul(
          spec.instructions,
          spec.criteria as NoulQuestion["criteria"]
        )
        break
      case "choice":
        questions[name] = choice(spec.instructions, spec.options)
        break
      case "score":
        questions[name] = score(
          spec.instructions,
          spec.levels as unknown as ScoreCriteria
        )
        break
    }
  }

  return questions
}

export function hasApiKey(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TYPESAFE_API_KEY?.trim())
}

export function createJevCall(config?: {
  apiKey?: string
  fetch?: typeof fetch
}): JevCall {
  let client: TypeSafeClient | undefined

  return async (req, options) => {
    client ??= new TypeSafeClient({
      ...(config?.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      ...(config?.fetch === undefined ? {} : { fetch: config.fetch as Fetch }),
      logLevel: "off"
    })

    const questions = toQuestions(req.questions)
    const estimate =
      estimateValue(req.state) +
      Object.values(req.questions).reduce(
        (sum, question) => sum + estimateQuestion(question),
        0
      )
    const result = await client.systemOne(
      {
        state: req.state as EntryType,
        questions,
        ...(req.model === undefined ? {} : { model: req.model })
      },
      options
    )
    const inputTokens = result.usage.input_tokens
    log.debug("Jev input token estimate", {
      estimatedInputTokens: estimate,
      inputTokens,
      ratio: inputTokens / estimate
    })
    return result as SystemOneResult<Questions>
  }
}

export function describeJevError(err: unknown): {
  message: string
  errorClass: string
  status?: number
  requestId?: string
} {
  const error = err instanceof Error ? err : new Error(String(err))
  return {
    message: error.message,
    errorClass: error.constructor.name,
    ...(err instanceof APIError
      ? { status: err.status, requestId: err.requestId }
      : {})
  }
}
