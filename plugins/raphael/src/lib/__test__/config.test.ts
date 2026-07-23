import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { configPath, DEFAULT_CONFIG, loadConfig } from "../config.js"

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-config-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeConfig(projectDir: string, frontmatter: string): void {
  const file = configPath(projectDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `---\n${frontmatter}\n---\n\n# Raphael settings\n`)
}

test("設定ファイルがなければ全フィールドの既定値を返す", () => {
  withProject((dir) => expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG))
})

test("全ての許可済み設定 key を読み取る", () => {
  withProject((dir) => {
    writeConfig(
      dir,
      [
        "detect_command_failure: false",
        "detect_retry_loop: false",
        "detect_user_rejection: false",
        "detect_edit_churn: false",
        "retry_threshold: 5",
        "edit_churn_threshold: 6",
        "distill_threshold: 7",
        "default_expiry_days: 45",
        "max_injections: 4",
        'rejection_patterns: ["foo,bar", "\\\\d+\\\\s+items"]',
        'benign_exit1_commands: ["custom command", "git status --short"]',
        "antibodies_git_policy: ignore"
      ].join("\n")
    )

    expect(loadConfig(dir)).toEqual({
      detectCommandFailure: false,
      detectRetryLoop: false,
      detectUserRejection: false,
      detectEditChurn: false,
      retryThreshold: 5,
      editChurnThreshold: 6,
      distillThreshold: 7,
      defaultExpiryDays: 45,
      maxInjections: 4,
      rejectionPatterns: ["foo,bar", "\\d+\\s+items"],
      benignExit1Commands: ["custom command", "git status --short"],
      antibodiesGitPolicy: "ignore"
    })
  })
})

test("不正な frontmatter と field 値は field 単位で既定値へ戻す", () => {
  withProject((dir) => {
    writeConfig(
      dir,
      [
        "detect_command_failure: no",
        "retry_threshold: 11",
        "edit_churn_threshold: 2.5",
        "distill_threshold: 0",
        "default_expiry_days: 366",
        "max_injections: 0",
        "rejection_patterns: [not valid JSON]",
        "benign_exit1_commands: [1]",
        "antibodies_git_policy: archive"
      ].join("\n")
    )
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG)
  })
})

test("未知 key は無視し、正しい key は維持する", () => {
  withProject((dir) => {
    writeConfig(dir, "unknown: value\nmax_injections: 10")
    expect(loadConfig(dir)).toEqual({ ...DEFAULT_CONFIG, maxInjections: 10 })
  })
})

test("frontmatter が存在しない場合は既定値を返す", () => {
  withProject((dir) => {
    const file = configPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "not frontmatter\n")
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG)
  })
})
