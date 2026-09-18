import { describe, expect, it } from "vitest"
import { type HelpSpec, renderHelp } from "../lib/cli-help.js"

describe("renderHelp", () => {
  const spec: HelpSpec = {
    command: "example.mjs",
    summary: "Run an example command.",
    options: [
      {
        flag: "--skill-path",
        value: "<path>",
        required: true,
        summary: "Path to the skill directory."
      },
      {
        flag: "--runs-per-query",
        value: "<count>",
        defaultValue: "3",
        summary: "Number of runs for each query."
      },
      {
        flag: "--verbose",
        summary: "Print additional details."
      }
    ]
  }

  it("renders usage, summary, option values, required markers, and defaults", () => {
    expect(renderHelp(spec)).toBe(
      "Usage: example.mjs [options]\n\n" +
        "Run an example command.\n\n" +
        "Options:\n" +
        "  --skill-path <path> (required)\n" +
        "    Path to the skill directory.\n" +
        "  --runs-per-query <count> (default: 3)\n" +
        "    Number of runs for each query.\n" +
        "  --verbose\n" +
        "    Print additional details.\n"
    )
  })

  it("does not add a value placeholder or default when they are absent", () => {
    const output = renderHelp({
      command: "empty.mjs",
      summary: "Summary.",
      options: [{ flag: "--help", summary: "Show help." }]
    })

    expect(output).toContain("  --help\n")
    expect(output).not.toContain("undefined")
    expect(output).not.toContain("(default:")
  })
})
