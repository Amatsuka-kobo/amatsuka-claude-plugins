import { choice, noul, type Questions } from "@typesafe-ai/sdk"
import type { Definition } from "./agents"
import { CONFIG_FILE, type ConfigState, disabledRolesOf } from "./config"
import { assertLang } from "./fragments"
import type { JevAsk } from "./jev"
import {
  type ClaudeModel,
  type Effort,
  isClaudeModel,
  type Role,
  type RoleId,
  roleById,
  rolesFor
} from "./roles"

export interface PickCommon {
  parentModel: ClaudeModel | undefined
  lang: string
  excludeRoles: RoleId[]
}

export type PickInput =
  | ({
      reason: "review"
      task: { summary: string; artifacts: string[] }
    } & PickCommon)
  | ({
      reason: "split"
      tasks: { id: string; summary: string; needsContext: boolean }[]
    } & PickCommon)
  | ({ reason: "stuck"; task: { summary: string } } & PickCommon)

export type Mode = "custom" | "standard" | "fork" | "self"

/** p は Jev を呼んだときだけ付く */
export type Delegate =
  | { role: RoleId; mode: "custom"; agentType: string; p?: number }
  | {
      role: RoleId
      mode: "standard"
      agentType: "general-purpose"
      model: ClaudeModel
      effort: Effort
      preamble: string
      p?: number
    }
  | {
      role: RoleId
      mode: "fork"
      agentType: "fork"
      preamble: string
      p?: number
    }

export interface SelfAssignment {
  id: string
  mode: "self"
}

export type PickError =
  | "invalid-input"
  | "no-candidates"
  | "duplicate-role"
  | "invalid-config"
  | "no-api-key"
  | "jev-failed"

export type PickOutput =
  | { ok: true; reason: "review"; agents: Delegate[]; fallback?: true }
  | {
      ok: true
      reason: "split"
      assignments: ((Delegate & { id: string }) | SelfAssignment)[]
    }
  | { ok: true; reason: "stuck"; agents: Delegate[] }
  | { ok: false; error: PickError; message: string }

export interface Candidate {
  role: Role
  definition: Definition | undefined
  criteria: string
}

export interface PickDeps {
  definitions: Definition[]
  config: ConfigState
  /** trim 済みで空なら undefined */
  apiKey: string | undefined
  createAsk: (apiKey: string) => JevAsk
  /** CLAUDE_CODE_FORK_SUBAGENT が "0" でない */
  forkEnabled: boolean
  /** 同梱 en の断片の ## When to invoke */
  standardCriteria: (roleId: RoleId) => string
  preambles: {
    standard: (roleId: RoleId, lang: string) => string
    fork: (roleId: RoleId, lang: string) => string
  }
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

function commonOf(parsed: Record<string, unknown>): PickCommon {
  const { parentModel, lang, excludeRoles } = parsed
  if (
    parentModel !== undefined &&
    (typeof parentModel !== "string" || !isClaudeModel(parentModel))
  ) {
    invalid("parentModel must be one of fable, opus, sonnet, haiku")
  }
  if (lang !== undefined) {
    if (typeof lang !== "string") invalid("lang must be a string")
    try {
      assertLang(lang)
    } catch (error) {
      invalid(error instanceof Error ? error.message : String(error))
    }
  }
  if (
    excludeRoles !== undefined &&
    (!Array.isArray(excludeRoles) ||
      !excludeRoles.every((role) => typeof role === "string"))
  ) {
    invalid("excludeRoles must be an array of role IDs")
  }
  const unknown = ((excludeRoles as string[] | undefined) ?? []).filter(
    (role) => roleById(role) === undefined
  )
  if (unknown.length > 0) {
    invalid(`excludeRoles contains unknown role IDs: ${unknown.join(", ")}`)
  }
  return {
    parentModel: parentModel as ClaudeModel | undefined,
    lang: (lang as string | undefined) ?? "en",
    excludeRoles: (excludeRoles as RoleId[] | undefined) ?? []
  }
}

export function parseInput(raw: string): PickInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    invalid("input is not valid JSON")
  }
  if (!isRecord(parsed)) invalid("input must be a JSON object")
  return { ...parseTask(parsed), ...commonOf(parsed) } as PickInput
}

function parseTask(parsed: Record<string, unknown>):
  | { reason: "review"; task: { summary: string; artifacts: string[] } }
  | {
      reason: "split"
      tasks: { id: string; summary: string; needsContext: boolean }[]
    }
  | { reason: "stuck"; task: { summary: string } } {
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
        const needsContext = (task as Record<string, unknown>).needsContext
        if (needsContext !== undefined && typeof needsContext !== "boolean") {
          invalid(`tasks[${index}].needsContext must be a boolean`)
        }
        return { id, summary, needsContext: needsContext ?? false }
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

// 理由に当たる役割のうち、設定と excludeRoles で外していない役割を ROLES の順に候補にする。
export function candidatesFor(input: PickInput, deps: PickDeps): Candidate[] {
  if (deps.config.kind === "invalid") {
    throw new PickFailure(
      "invalid-config",
      `${deps.config.message}. Run better-agentics:setup to rewrite ${CONFIG_FILE}.`
    )
  }
  const disabled = disabledRolesOf(deps.config)
  const enabled = rolesFor(input.reason).filter(
    (role) => !disabled.includes(role.id)
  )
  if (enabled.length === 0) {
    throw new PickFailure(
      "no-candidates",
      `Every role for "${input.reason}" is disabled in ${CONFIG_FILE}. Run better-agentics:setup to change the disabled roles.`
    )
  }
  const roles = enabled.filter((role) => !input.excludeRoles.includes(role.id))
  if (roles.length === 0) {
    throw new PickFailure(
      "no-candidates",
      `Every remaining role for "${input.reason}" was removed by excludeRoles.`
    )
  }

  const problems: string[] = []
  const candidates = roles.map((role): Candidate => {
    const owners = deps.definitions.filter((entry) => entry.role === role.id)
    if (owners.length >= 2) {
      problems.push(
        `role ${role.id}: ${owners.map((entry) => entry.name).join(", ")}`
      )
    }
    const [definition] = owners
    return {
      role,
      definition,
      criteria:
        definition === undefined
          ? deps.standardCriteria(role.id)
          : definition.whenToInvoke
    }
  })
  // subagent_type は name を使うため、役割が違っても name の重なりは許さない。
  const custom = candidates.flatMap((candidate) =>
    candidate.definition === undefined ? [] : [candidate.definition]
  )
  for (const name of new Set(custom.map((entry) => entry.name))) {
    const owners = custom.filter((entry) => entry.name === name)
    if (owners.length >= 2) {
      problems.push(
        `name ${name} is shared by roles ${owners.map((entry) => entry.role).join(", ")}`
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

function withP<T extends object>(delegate: T, p: number | undefined): T {
  return p === undefined ? delegate : { ...delegate, p }
}

function delegateOf(
  candidate: Candidate,
  lang: string,
  deps: PickDeps,
  p?: number
): Delegate {
  const { role, definition } = candidate
  if (definition !== undefined) {
    return withP(
      { role: role.id, mode: "custom", agentType: definition.name },
      p
    )
  }
  return withP(
    {
      role: role.id,
      mode: "standard",
      agentType: "general-purpose",
      model: role.model,
      effort: role.effort,
      preamble: deps.preambles.standard(role.id, lang)
    },
    p
  )
}

function reviewQuestions(candidates: Candidate[]): Questions {
  return Object.fromEntries(
    candidates.map((candidate, index) => [
      `candidate_${index}`,
      noul(
        [
          "Decide whether the reviewer below should review the work described in the state.",
          "Answer yes only when the reviewer's criteria clearly match the work. Other reviewers are judged separately.",
          `Reviewer: ${candidate.role.id}`,
          "When to invoke:",
          candidate.criteria === "" ? "(no criteria)" : candidate.criteria
        ].join("\n")
      )
    ])
  )
}

function splitQuestions(
  tasks: { id: string; summary: string }[],
  candidates: Candidate[]
): Questions {
  const options = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.role.id,
      candidate.criteria === "" ? null : candidate.criteria
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
  const candidates = candidatesFor(input, deps)
  const [only] = candidates
  if (candidates.length === 1 && only !== undefined) {
    return {
      ok: true,
      reason: "review",
      agents: [delegateOf(only, input.lang, deps)]
    }
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
      agents: yes.map((entry) =>
        delegateOf(entry.candidate, input.lang, deps, entry.p)
      )
    }
  }
  const best = scored.reduce((top, entry) => (entry.p > top.p ? entry : top))
  return {
    ok: true,
    reason: "review",
    agents: [delegateOf(best.candidate, input.lang, deps, best.p)],
    fallback: true
  }
}

async function split(
  input: Extract<PickInput, { reason: "split" }>,
  deps: PickDeps
): Promise<PickOutput> {
  const candidates = candidatesFor(input, deps)
  const [only] = candidates
  if (candidates.length === 1 && only !== undefined) {
    return {
      ok: true,
      reason: "split",
      assignments: input.tasks.map((task) => ({
        id: task.id,
        ...delegateOf(only, input.lang, deps)
      }))
    }
  }
  const tasks = input.tasks.map(({ id, summary }) => ({ id, summary }))
  const answers = await ask(deps, { tasks }, splitQuestions(tasks, candidates))
  return {
    ok: true,
    reason: "split",
    assignments: tasks.map((task, index) => {
      const key = `task_${index}`
      const answer = answerOf(answers, key)
      const chosen = candidates.find(
        (candidate) => candidate.role.id === answer.choice
      )
      if (chosen === undefined) {
        throw new PickFailure(
          "jev-failed",
          `Jev chose an unknown role for ${key}: ${String(answer.choice)}`
        )
      }
      const probabilities = answer.probabilities
      const p = probability(
        isRecord(probabilities) ? probabilities[chosen.role.id] : undefined,
        `${key}.probabilities`
      )
      return { id: task.id, ...delegateOf(chosen, input.lang, deps, p) }
    })
  }
}

function stuck(
  input: Extract<PickInput, { reason: "stuck" }>,
  deps: PickDeps
): PickOutput {
  return {
    ok: true,
    reason: "stuck",
    agents: candidatesFor(input, deps).map((candidate) =>
      delegateOf(candidate, input.lang, deps)
    )
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
        return stuck(input, deps)
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
