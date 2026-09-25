import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  captureFlags,
  createRunDir,
  defaultName,
  finalizeEvidence,
  type LogEntry,
  normalizeName,
  type RunRecord,
  recordingJev,
  shouldKeep
} from "../evidence.js"
import type { JevCall } from "../jev/client.js"
import { log } from "../log.js"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "jevriel-evidence-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function record(status: RunRecord["status"] = "pass"): RunRecord {
  return {
    tool: "browser_check",
    kind: "browser",
    name: "login",
    status,
    reason: null,
    goal: null,
    startedAt: "2026-09-25T12:00:00.000Z",
    finishedAt: "2026-09-25T12:00:01.000Z",
    durationMs: 1000,
    reached: null,
    assertions: [],
    steps: [],
    usage: { requests: 0, inputTokens: 0 },
    evidence: null
  }
}

describe("normalizeName", () => {
  it("replaces unsupported characters and trims edge hyphens", () => {
    expect(
      normalizeName("Login Page/v2", "http://localhost/login", "browser")
    ).toBe("Login-Page-v2")
    expect(
      normalizeName("--login--", "http://localhost/login", "browser")
    ).toBe("login")
  })

  it("limits names to 64 characters and removes a trailing hyphen after truncation", () => {
    expect(
      normalizeName(`${"a".repeat(63)}-tail`, "http://localhost", "browser")
    ).toBe("a".repeat(63))
  })

  it("uses the URL-derived default when a name contains only symbols", () => {
    expect(normalizeName("!!!", "http://localhost:3000/login", "browser")).toBe(
      "localhost-3000-login"
    )
  })

  it("derives a browser default from host and path without query or fragment", () => {
    expect(defaultName("http://localhost:3000/login?x=1#h", "browser")).toBe(
      "localhost-3000-login"
    )
  })

  it("derives an API default from its host including the port", () => {
    expect(defaultName("https://api.example.com:8443/v1/users", "api")).toBe(
      "api.example.com-8443"
    )
  })

  it("uses unnamed when the URL-derived default is empty", () => {
    expect(defaultName(":", "browser")).toBe("unnamed")
  })

  it("falls back from Japanese-only names and keeps the ASCII suffix", () => {
    expect(
      normalizeName("ログイン画面", "http://localhost:3000/login", "browser")
    ).toBe("localhost-3000-login")
    expect(
      normalizeName("ログイン-v2", "http://localhost:3000/login", "browser")
    ).toBe("v2")
  })
})

describe("captureFlags", () => {
  it("disables every capture for none and enables them otherwise", () => {
    expect(captureFlags("none")).toEqual({
      dir: false,
      trace: false,
      screenshots: false
    })
    expect(captureFlags("always")).toEqual({
      dir: true,
      trace: true,
      screenshots: true
    })
    expect(captureFlags("on_failure")).toEqual({
      dir: true,
      trace: true,
      screenshots: true
    })
  })
})

describe("shouldKeep", () => {
  it("implements the mode and status retention table", () => {
    const statuses: RunRecord["status"][] = ["pass", "fail", "stuck", "error"]
    expect(statuses.map((status) => shouldKeep("always", status))).toEqual([
      true,
      true,
      true,
      true
    ])
    expect(statuses.map((status) => shouldKeep("on_failure", status))).toEqual([
      false,
      true,
      true,
      true
    ])
    expect(statuses.map((status) => shouldKeep("none", status))).toEqual([
      false,
      false,
      false,
      false
    ])
  })
})

describe("createRunDir", () => {
  it("creates the kind/name/timestamp hierarchy with a filesystem-safe timestamp", async () => {
    const dir = await createRunDir(
      tempDir,
      "browser",
      "login",
      new Date("2026-09-25T12:34:56.789Z")
    )
    expect(isAbsolute(dir)).toBe(true)
    expect(dir).toBe(
      join(
        tempDir,
        ".jevriel",
        "runs",
        "browser",
        "login",
        "2026-09-25T12-34-56-789Z"
      )
    )
    expect(await readdir(dir)).toEqual([])
  })

  it("adds increasing suffixes when the same timestamp collides", async () => {
    const now = new Date("2026-09-25T12:34:56.789Z")
    const first = await createRunDir(tempDir, "api", "endpoint", now)
    const second = await createRunDir(tempDir, "api", "endpoint", now)
    const third = await createRunDir(tempDir, "api", "endpoint", now)
    expect(second).toBe(`${first}-2`)
    expect(third).toBe(`${first}-3`)
  })
})

describe("finalizeEvidence", () => {
  it("writes log and result last, and records every file including result.json", async () => {
    const dir = join(tempDir, "run")
    await mkdir(dir)
    await writeFile(join(dir, "step-1.png"), "screenshot")
    const finalized = await finalizeEvidence({
      dir,
      mode: "always",
      record: record(),
      log: [],
      files: ["step-1.png"]
    })
    const result = JSON.parse(await readFile(join(dir, "result.json"), "utf8"))
    const savedFiles = (await readdir(dir)).sort()

    expect(finalized.evidence).toEqual({
      dir,
      files: ["step-1.png", "log.json", "result.json"]
    })
    expect(savedFiles).toEqual(finalized.evidence?.files.slice().sort())
    expect(result).toEqual(finalized)
    expect(JSON.parse(await readFile(join(dir, "log.json"), "utf8"))).toEqual(
      []
    )
  })

  it("removes a passing on_failure directory and returns null evidence", async () => {
    const dir = join(tempDir, "run")
    await mkdir(dir)
    const finalized = await finalizeEvidence({
      dir,
      mode: "on_failure",
      record: record("pass"),
      log: [],
      files: []
    })
    expect(finalized.evidence).toBeNull()
    await expect(readdir(dir)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps evidence for a failing on_failure run", async () => {
    const dir = join(tempDir, "run")
    await mkdir(dir)
    const finalized = await finalizeEvidence({
      dir,
      mode: "on_failure",
      record: record("fail"),
      log: [],
      files: []
    })
    expect(finalized.evidence?.dir).toBe(dir)
    expect(await readdir(dir)).toEqual(["log.json", "result.json"])
  })

  it("does not write when the directory is null", async () => {
    const finalized = await finalizeEvidence({
      dir: null,
      mode: "always",
      record: record(),
      log: [],
      files: []
    })
    expect(finalized.evidence).toBeNull()
  })

  it("returns null evidence and logs to stderr when saving fails without changing status", async () => {
    const dir = join(tempDir, "not-a-directory")
    await writeFile(dir, "file")
    const errorLog = vi.spyOn(log, "error")
    const original = record("fail")
    const finalized = await finalizeEvidence({
      dir,
      mode: "always",
      record: original,
      log: [],
      files: []
    })
    expect(finalized.evidence).toBeNull()
    expect(finalized.status).toBe("fail")
    expect(errorLog).toHaveBeenCalled()
  })
})

describe("recordingJev", () => {
  const request = {
    state: { subject: "test" },
    questions: {
      decision: { type: "noul" as const, instructions: "Is it true?" }
    }
  }

  it("records the request and full answers after a successful call", async () => {
    const response = {
      model: "test",
      answers: { decision: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 0 }
    } as unknown as Awaited<ReturnType<JevCall>>
    const jev = vi.fn(async () => response) as unknown as JevCall
    const entries: LogEntry[] = []
    const wrapped = recordingJev(
      jev,
      entries,
      () => new Date("2026-09-25T12:00:00.000Z")
    )

    await expect(wrapped(request)).resolves.toBe(response)
    expect(entries).toEqual([
      {
        at: "2026-09-25T12:00:00.000Z",
        kind: "jev",
        state: request.state,
        questions: request.questions,
        answers: response.answers
      }
    ])
  })

  it("records an exception before rethrowing it", async () => {
    const error = new TypeError("request failed")
    const jev = vi.fn(async () => {
      throw error
    }) as unknown as JevCall
    const entries: LogEntry[] = []
    const wrapped = recordingJev(
      jev,
      entries,
      () => new Date("2026-09-25T12:00:00.000Z")
    )

    await expect(wrapped(request)).rejects.toBe(error)
    expect(entries).toEqual([
      {
        at: "2026-09-25T12:00:00.000Z",
        kind: "exception",
        errorClass: "TypeError",
        message: "request failed",
        stack: error.stack
      }
    ])
  })
})
