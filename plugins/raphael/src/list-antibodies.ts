import { AntibodyIoError, listAntibodies } from "./lib/antibody-store.js"
import { AntibodyValidationError } from "./lib/frontmatter.js"
import type { Antibody, AntibodyStatus } from "./lib/types.js"

interface Failure {
  code: string
  message: string
  field?: string
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = listAntibodies(options.dir)
    const antibodies = result.antibodies
      .filter(
        (antibody) =>
          options.status === undefined || antibody.status === options.status
      )
      .filter(
        (antibody) => options.id === undefined || antibody.id === options.id
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((antibody) => serializeForJson(antibody, options.includeBody))

    if (options.json) {
      respond({ ok: true, antibodies, errors: result.errors })
    } else {
      process.stdout.write(table(antibodies))
    }
  } catch (error) {
    fail(error)
  }
}

function parseArgs(args: string[]): {
  dir: string
  json: boolean
  includeBody: boolean
  status?: AntibodyStatus
  id?: string
} {
  let dir: string | undefined
  let json = false
  let includeBody = false
  let status: AntibodyStatus | undefined
  let id: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case "--dir":
        dir = requireValue(args, ++index, "dir")
        break
      case "--json":
        json = true
        break
      case "--include-body":
        includeBody = true
        break
      case "--status": {
        const value = requireValue(args, ++index, "status")
        if (
          value !== "active" &&
          value !== "expired" &&
          value !== "confirmed"
        ) {
          throw new AntibodyValidationError(
            "status: must be active, expired, or confirmed",
            "status"
          )
        }
        status = value
        break
      }
      case "--id":
        id = requireValue(args, ++index, "id")
        break
      default:
        throw new AntibodyValidationError(
          `argument: unsupported option: ${arg}`,
          "argument"
        )
    }
  }

  return {
    dir: dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    json,
    includeBody,
    ...(status === undefined ? {} : { status }),
    ...(id === undefined ? {} : { id })
  }
}

function requireValue(args: string[], index: number, field: string): string {
  const value = args[index]
  if (value === undefined || value.startsWith("--")) {
    throw new AntibodyValidationError(`${field}: is required`, field)
  }
  return value
}

function serializeForJson(
  antibody: Antibody,
  includeBody: boolean
): Omit<Antibody, "body"> | Antibody {
  if (includeBody) return antibody
  const { body: _body, ...withoutBody } = antibody
  return withoutBody
}

function table(antibodies: Array<Omit<Antibody, "body"> | Antibody>): string {
  const columns = ["ID", "STATUS", "FIRED", "LAST_FIRED", "EXPIRES", "SOURCE"]
  const rows = antibodies.map((antibody) => [
    antibody.id,
    antibody.status,
    String(antibody.stats.fired),
    antibody.stats.last_fired ?? "-",
    antibody.expires,
    antibody.source
  ])
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0))
  )
  const format = (row: string[]): string =>
    row
      .map((value, index) => value.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd()
  return `${format(columns)}\n${rows.map(format).join("\n")}${rows.length === 0 ? "" : "\n"}`
}

function fail(error: unknown): never {
  const failure = toFailure(error)
  respond({ ok: false, error: failure })
  process.exitCode = failure.code === "IO_ERROR" ? 1 : 2
  throw new ExitHandledError()
}

function toFailure(error: unknown): Failure {
  if (error instanceof AntibodyIoError) {
    return { code: "IO_ERROR", message: error.message }
  }
  if (error instanceof AntibodyValidationError) {
    return {
      code: "VALIDATION_ERROR",
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field })
    }
  }
  return {
    code: "RUNTIME_ERROR",
    message: error instanceof Error ? error.message : "Unexpected error"
  }
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

class ExitHandledError extends Error {}

try {
  main()
} catch (error) {
  if (!(error instanceof ExitHandledError)) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: toFailure(error) })}\n`
    )
    process.exitCode = error instanceof AntibodyIoError ? 1 : 2
  }
}
