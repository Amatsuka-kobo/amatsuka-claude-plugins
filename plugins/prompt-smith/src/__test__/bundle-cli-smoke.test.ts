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
