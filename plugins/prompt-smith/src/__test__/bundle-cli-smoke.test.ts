import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts"
)

function runWithoutArguments(name: string): string {
  try {
    execFileSync(process.execPath, [join(scriptsDir, `${name}.mjs`)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
    return ""
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? "")
  }
}

function runWithArguments(
  name: string,
  args: string[]
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(scriptsDir, `${name}.mjs`), ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
    return { stdout, stderr: "", status: 0 }
  } catch (error) {
    const result = error as {
      stdout?: string
      stderr?: string
      status?: number
      code?: number
    }
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      status:
        result.status ?? (typeof result.code === "number" ? result.code : 1)
    }
  }
}

describe("bundled CLI entry dispatch", () => {
  it("run-loop だけを起動する", () => {
    const stderr = runWithoutArguments("run-loop")
    expect(stderr.trim()).toBe("--eval-set is required")
    expect(stderr).not.toContain("--eval-results")
    expect(stderr).not.toContain("Unknown option")
  })

  it("run-trigger-eval だけを起動する", () => {
    const stderr = runWithoutArguments("run-trigger-eval")
    expect(stderr.trim()).toBe("--skill-path is required")
    expect(stderr).not.toContain("--eval-results")
    expect(stderr).not.toContain("Unknown option")
  })

  it("improve-description だけを起動する", () => {
    const stderr = runWithoutArguments("improve-description")
    expect(stderr.trim()).toBe("--eval-results is required")
    expect(stderr).not.toContain("--eval-set")
    expect(stderr).not.toContain("Unknown option")
  })
})

it("run-loop の --help は usage を stdout に出す", () => {
  const result = runWithArguments("run-loop", ["--help"])
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Usage:")
  expect(result.stdout).toContain("run-loop.mjs")
  expect(result.stdout).not.toContain("--eval-results")
})

it("run-trigger-eval の --help は usage を stdout に出す", () => {
  const result = runWithArguments("run-trigger-eval", ["--help"])
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Usage:")
  expect(result.stdout).toContain("run-trigger-eval.mjs")
  expect(result.stdout).not.toContain("--eval-results")
})

it("improve-description の --help は usage を stdout に出す", () => {
  const result = runWithArguments("improve-description", ["--help"])
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Usage:")
  expect(result.stdout).toContain("improve-description.mjs")
  expect(result.stdout).not.toContain("--eval-set")
})
