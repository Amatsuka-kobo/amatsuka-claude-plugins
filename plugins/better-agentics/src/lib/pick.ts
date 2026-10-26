import { choice, noul, type Questions } from "@typesafe-ai/sdk"
import type { Definition } from "./agents"
import type { JevAsk } from "./jev"
import { type Reason, type RoleId, roleById } from "./roles"

export type PickInput =
  | { reason: "review"; task: { summary: string; artifacts: string[] } }
  | { reason: "split"; tasks: { id: string; summary: string }[] }
  | { reason: "stuck"; task: { summary: string } }

/** p は Jev を呼んだときだけ付く */
export interface Pick {
  agent: string
  role: RoleId
  p?: number
}

export type PickError =
  | "invalid-input"
  | "no-candidates"
  | "duplicate-role"
  | "no-api-key"
  | "jev-failed"

export type PickOutput =
  | { ok: true; reason: "review"; agents: Pick[]; fallback?: true }
  | { ok: true; reason: "split"; assignments: (Pick & { id: string })[] }
  | { ok: true; reason: "stuck"; agents: Pick[] }
  | { ok: false; error: PickError; message: string }

export interface PickDeps {
  definitions: Definition[]
  /** trim 済みで空なら undefined */
  apiKey: string | undefined
  createAsk: (apiKey: string) => JevAsk
}

export class PickFailure extends Error {
  constructor(
    readonly error: PickError,
    message: string
  ) {
    super(message)
  }
}

const SETUP_HINT = "Run better-agentics:setup to fix the agent definitions."

function invalid(message: string): never {
  throw new PickFailure("invalid-input", message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function summaryOf(value: unknown, field: string): string {
  if (!isRecord(value)) invalid(`${field} must be an object`)
  const summary = value.summary
  if (typeof summary !== "string" || summary.trim() === "") {
    invalid(`${field}.summary must be a non-empty string`)
  }
  return summary
}

export function parseInput(raw: string): PickInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    invalid("input is not valid JSON")
  }
  if (!isRecord(parsed)) invalid("input must be a JSON object")

  switch (parsed.reason) {
    case "review": {
      const summary = summaryOf(parsed.task, "task")
      const artifacts = (parsed.task as Record<string, unknown>).artifacts
      if (
        !Array.isArray(artifacts) ||
        !artifacts.every((item) => typeof item === "string")
      ) {
        invalid("task.artifacts must be an array of strings")
      }
      return { reason: "review", task: { summary, artifacts } }
    }
    case "split": {
      const tasks = parsed.tasks
      if (!Array.isArray(tasks) || tasks.length === 0) {
        invalid("tasks must be a non-empty array")
      }
      const result = tasks.map((task, index) => {
        const summary = summaryOf(task, `tasks[${index}]`)
        const id = (task as Record<string, unknown>).id
        if (typeof id !== "string" || id === "") {
          invalid(`tasks[${index}].id must be a non-empty string`)
        }
        return { id, summary }
      })
      const ids = result.map((task) => task.id)
      const duplicated = ids.find((id, index) => ids.indexOf(id) !== index)
      if (duplicated !== undefined)
        invalid(`tasks id "${duplicated}" is duplicated`)
      return { reason: "split", tasks: result }
    }
    case "stuck":
      return {
        reason: "stuck",
        task: { summary: summaryOf(parsed.task, "task") }
      }
    default:
      invalid('reason must be "review", "split" or "stuck"')
  }
}

function candidatesFor(
  reason: Reason,
  definitions: Definition[]
): Definition[] {
  const candidates = definitions.filter(
    (entry) => roleById(entry.role)?.reason === reason
  )
  if (candidates.length === 0) {
    throw new PickFailure(
      "no-candidates",
      `No agent definition has a role for "${reason}". ${SETUP_HINT}`
    )
  }

  const problems: string[] = []
  const roles = [...new Set(candidates.map((entry) => entry.role))]
  for (const role of roles) {
    const names = candidates
      .filter((entry) => entry.role === role)
      .map((entry) => entry.name)
    if (names.length >= 2) problems.push(`role ${role}: ${names.join(", ")}`)
  }
  // choice の選択肢と subagent_type は name を鍵にするため、役割が違っても name の重なりは許さない。
  const names = candidates.map((entry) => entry.name)
  for (const name of new Set(names)) {
    const owners = candidates.filter((entry) => entry.name === name)
    const distinctRoles = new Set(owners.map((entry) => entry.role))
    if (owners.length >= 2 && distinctRoles.size >= 2) {
      problems.push(
        `name ${name} is shared by roles ${[...distinctRoles].join(", ")}`
      )
    }
  }
  if (problems.length > 0) {
    throw new PickFailure(
      "duplicate-role",
      `Several agent definitions conflict (${problems.join("; ")}). ${SETUP_HINT}`
    )
  }
  return candidates
}

function pickOf(candidate: Definition, p?: number): Pick {
  const role = roleById(candidate.role)?.id as RoleId
  return p === undefined
    ? { agent: candidate.name, role }
    : { agent: candidate.name, role, p }
}

function criteriaText(candidate: Definition): string {
  return candidate.whenToInvoke === ""
    ? "(no criteria)"
    : candidate.whenToInvoke
}

function reviewQuestions(candidates: Definition[]): Questions {
  return Object.fromEntries(
    candidates.map((candidate, index) => [
      `candidate_${index}`,
      noul(
        [
          "Decide whether the reviewer below should review the work described in the state.",
          "Answer yes only when the reviewer's criteria clearly match the work. Other reviewers are judged separately.",
          `Reviewer: ${candidate.name}`,
          "When to invoke:",
          criteriaText(candidate)
        ].join("\n")
      )
    ])
  )
}

function splitQuestions(
  tasks: { id: string; summary: string }[],
  candidates: Definition[]
): Questions {
  const options = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.name,
      candidate.whenToInvoke === "" ? null : candidate.whenToInvoke
    ])
  )
  return Object.fromEntries(
    tasks.map((task, index) => [
      `task_${index}`,
      choice(
        `Choose the agent that should take task "${task.id}": ${task.summary}`,
        options
      )
    ])
  )
}

function probability(value: unknown, where: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new PickFailure("jev-failed", `Unexpected probability at ${where}`)
  }
  return value
}

function answerOf(answers: unknown, key: string): Record<string, unknown> {
  const answer = isRecord(answers) ? answers[key] : undefined
  if (!isRecord(answer)) {
    throw new PickFailure("jev-failed", `Jev returned no answer for ${key}`)
  }
  return answer
}

async function ask(
  deps: PickDeps,
  state: Parameters<JevAsk>[0]["state"],
  questions: Questions
): Promise<unknown> {
  if (deps.apiKey === undefined) {
    throw new PickFailure(
      "no-api-key",
      "TYPESAFE_API_KEY is not set, so Jev cannot choose among several candidates."
    )
  }
  try {
    const result = await deps.createAsk(deps.apiKey)({ state, questions })
    return result.answers
  } catch (error) {
    throw new PickFailure(
      "jev-failed",
      `Jev call failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function review(
  input: Extract<PickInput, { reason: "review" }>,
  deps: PickDeps
): Promise<PickOutput> {
  const candidates = candidatesFor("review", deps.definitions)
  const [only] = candidates
  if (candidates.length === 1 && only !== undefined) {
    return { ok: true, reason: "review", agents: [pickOf(only)] }
  }
  const answers = await ask(
    deps,
    { summary: input.task.summary, artifacts: input.task.artifacts },
    reviewQuestions(candidates)
  )
  const scored = candidates.map((candidate, index) => {
    const key = `candidate_${index}`
    return {
      candidate,
      p: probability(answerOf(answers, key).noul, `${key}.noul`)
    }
  })
  const yes = scored.filter((entry) => entry.p >= 0.5)
  if (yes.length > 0) {
    return {
      ok: true,
      reason: "review",
      agents: yes.map((entry) => pickOf(entry.candidate, entry.p))
    }
  }
  const best = scored.reduce((top, entry) => (entry.p > top.p ? entry : top))
  return {
    ok: true,
    reason: "review",
    agents: [pickOf(best.candidate, best.p)],
    fallback: true
  }
}

async function split(
  input: Extract<PickInput, { reason: "split" }>,
  deps: PickDeps
): Promise<PickOutput> {
  const candidates = candidatesFor("split", deps.definitions)
  const [only] = candidates
  if (candidates.length === 1 && only !== undefined) {
    return {
      ok: true,
      reason: "split",
      assignments: input.tasks.map((task) => ({ id: task.id, ...pickOf(only) }))
    }
  }
  const answers = await ask(
    deps,
    { tasks: input.tasks },
    splitQuestions(input.tasks, candidates)
  )
  return {
    ok: true,
    reason: "split",
    assignments: input.tasks.map((task, index) => {
      const key = `task_${index}`
      const answer = answerOf(answers, key)
      const chosen = candidates.find((entry) => entry.name === answer.choice)
      if (chosen === undefined) {
        throw new PickFailure(
          "jev-failed",
          `Jev chose an unknown agent for ${key}: ${String(answer.choice)}`
        )
      }
      const probabilities = answer.probabilities
      const p = probability(
        isRecord(probabilities) ? probabilities[chosen.name] : undefined,
        `${key}.probabilities`
      )
      return { id: task.id, ...pickOf(chosen, p) }
    })
  }
}

function stuck(deps: PickDeps): PickOutput {
  const candidates = candidatesFor("stuck", deps.definitions)
  return {
    ok: true,
    reason: "stuck",
    agents: candidates.map((entry) => pickOf(entry))
  }
}

export async function pickDelegate(
  raw: string,
  deps: PickDeps
): Promise<PickOutput> {
  try {
    const input = parseInput(raw)
    switch (input.reason) {
      case "review":
        return await review(input, deps)
      case "split":
        return await split(input, deps)
      case "stuck":
        return stuck(deps)
    }
  } catch (error) {
    if (error instanceof PickFailure) {
      return { ok: false, error: error.error, message: error.message }
    }
    return {
      ok: false,
      error: "jev-failed",
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
