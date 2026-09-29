import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../inject.ts", import.meta.url))
const DISCIPLINE = fileURLToPath(
  new URL("../../references/discipline.md", import.meta.url)
)
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const SESSION_START = JSON.stringify({ hook_event_name: "SessionStart" })
const MORPH_RUNTIME = fileURLToPath(
  new URL("../morph-runtime.ts", import.meta.url)
)
const ARCHIVE = fileURLToPath(new URL("../lib/archive.ts", import.meta.url))
const STUB = fileURLToPath(
  new URL("../testing/fetch-morph-stub.mjs", import.meta.url)
)

// 実物の取得を起動しないよう、CLAUDE_PLUGIN_DATA を外した環境で動かす。
const { CLAUDE_PLUGIN_DATA: _, ...BASE_ENV } = process.env

function inject(input: string, script = SCRIPT): string {
  return runTs(script, [], { input, env: BASE_ENV })
}

// src/inject.ts と、それが読み込む morph-runtime.ts と lib/archive.ts を複製した
// プラグインルートを一時ディレクトリに作り、inject.ts のパスを返す。
// 取得の起動先 scripts/fetch-morph.mjs は、目印のファイルを書くだけの差し替えにする。
// discipline が null なら references/ を置かない。
function makePluginRoot(discipline: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-"))
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n')
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true })
  const script = path.join(root, "src", "inject.ts")
  fs.copyFileSync(SCRIPT, script)
  fs.copyFileSync(MORPH_RUNTIME, path.join(root, "src", "morph-runtime.ts"))
  fs.copyFileSync(ARCHIVE, path.join(root, "src", "lib", "archive.ts"))
  fs.mkdirSync(path.join(root, "scripts"))
  fs.copyFileSync(STUB, path.join(root, "scripts", "fetch-morph.mjs"))
  if (discipline !== null) {
    fs.mkdirSync(path.join(root, "references"))
    fs.writeFileSync(path.join(root, "references", "discipline.md"), discipline)
  }
  return script
}

function removePluginRoot(script: string): void {
  fs.rmSync(path.dirname(path.dirname(script)), {
    recursive: true,
    force: true
  })
}

function withPluginRoot(
  discipline: string | null,
  run: (script: string) => void
): void {
  const script = makePluginRoot(discipline)
  try {
    run(script)
  } finally {
    removePluginRoot(script)
  }
}

test.each([
  "SessionStart",
  "SubagentStart"
])("%s で discipline.md を目印の行を除いて 1 行の JSON で注入する", (event) => {
  const out = inject(JSON.stringify({ hook_event_name: event }))
  expect(out.endsWith("\n")).toBe(true)
  expect(out.slice(0, -1)).not.toContain("\n")
  expect(JSON.parse(out)).toEqual({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: fs
        .readFileSync(DISCIPLINE, "utf8")
        .replace("<!-- native-japanese: ignore-file -->\n\n", "")
    }
  })
})

test("注入文に ignore-file の行が含まれない", () => {
  expect(
    JSON.parse(inject(SESSION_START)).hookSpecificOutput.additionalContext
  ).not.toContain("ignore-file")
})

test.each([
  ["イベント名が無い", "{}"],
  ["未知のイベント名", JSON.stringify({ hook_event_name: "Stop" })],
  ["JSON として読めない", "not json"],
  ["標準入力が空", ""],
  ["JSON の null", "null"],
  ["イベント名が文字列でない", JSON.stringify({ hook_event_name: 1 })]
])("%s なら何も出力しない", (_, input) => {
  expect(inject(input)).toBe("")
})

test("差し替えた本文を注入する(一時ディレクトリでの起動の対照)", () => {
  withPluginRoot("# 見出し\n\n- 本文\n", (script) => {
    expect(
      JSON.parse(inject(SESSION_START, script)).hookSpecificOutput
        .additionalContext
    ).toBe("# 見出し\n\n- 本文\n")
  })
})

test("目印の無い本文はそのまま注入し、行の途中の目印は残す", () => {
  const body = "# 見出し\n\n- 本文 <!-- native-japanese: ignore-file --> の例\n"
  withPluginRoot(body, (script) => {
    expect(
      JSON.parse(inject(SESSION_START, script)).hookSpecificOutput
        .additionalContext
    ).toBe(body)
  })
})

test("前後に空白のある目印の行も取り除く", () => {
  withPluginRoot(
    "  <!-- native-japanese: ignore-file -->\t\n\n# 見出し\n",
    (script) => {
      expect(
        JSON.parse(inject(SESSION_START, script)).hookSpecificOutput
          .additionalContext
      ).toBe("# 見出し\n")
    }
  )
})

test("discipline.md が無ければ何も出力しない", () => {
  withPluginRoot(null, (script) => {
    expect(inject(SESSION_START, script)).toBe("")
  })
})

test("discipline.md が空白だけなら何も出力しない", () => {
  withPluginRoot(" \n\t\n  \n", (script) => {
    expect(inject(SESSION_START, script)).toBe("")
  })
})

test("失敗しても stderr に書かない", () => {
  withPluginRoot(null, (script) => {
    for (const input of ["not json", SESSION_START]) {
      const result = spawnSync(process.execPath, [TSX_CLI, script], {
        input,
        encoding: "utf8",
        env: { ...BASE_ENV, NODE_NO_WARNINGS: "1" }
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toBe("")
    }
  })
})

test("discipline.md は 9,000 文字以内", () => {
  expect(fs.readFileSync(DISCIPLINE, "utf8").length).toBeLessThanOrEqual(9000)
})

// --- SessionStart からの取得の起動

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 差し替えた起動先で inject を動かし、終わった時点の結果と目印のパスを run に渡す。
// 子プロセスが差し替えを読み終える前に消さないよう、後始末は run の後に行う。
async function injectWithStub(
  input: string,
  env: NodeJS.ProcessEnv,
  run: (
    result: { status: number | null; stdout: string },
    marker: string
  ) => Promise<void>
): Promise<void> {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-data-"))
  const script = makePluginRoot("# 見出し\n")
  try {
    const result = spawnSync(process.execPath, [TSX_CLI, script], {
      input,
      encoding: "utf8",
      env: { ...BASE_ENV, CLAUDE_PLUGIN_DATA: data, ...env }
    })
    await run(result, path.join(data, "stub-started"))
  } finally {
    removePluginRoot(script)
    fs.rmSync(data, { recursive: true, force: true })
  }
}

async function waitFor(file: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (fs.existsSync(file)) return true
    await sleep(100)
  }
  return fs.existsSync(file)
}

test("SessionStart で取得を起動しても子プロセスを待たずに終わる", async () => {
  await injectWithStub(
    SESSION_START,
    { NJ_STUB_DELAY_MS: "1500" },
    async (result, marker) => {
      expect(result.status).toBe(0)
      expect(result.stdout.endsWith("\n")).toBe(true)
      expect(result.stdout.slice(0, -1)).not.toContain("\n")
      expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe(
        "SessionStart"
      )
      expect(fs.existsSync(marker)).toBe(false)
      expect(await waitFor(marker, 10_000)).toBe(true)
    }
  )
})

test.each([
  [
    "AMATSUKA_NATIVE_JAPANESE_MORPH=off",
    SESSION_START,
    { AMATSUKA_NATIVE_JAPANESE_MORPH: "off" }
  ],
  [
    "AMATSUKA_NATIVE_JAPANESE_CHECK=off",
    SESSION_START,
    { AMATSUKA_NATIVE_JAPANESE_CHECK: "off" }
  ],
  ["SubagentStart", JSON.stringify({ hook_event_name: "SubagentStart" }), {}]
])("%s では取得を起動しない", async (_, input, env) => {
  await injectWithStub(
    input,
    { NJ_STUB_DELAY_MS: "0", ...env },
    async (result, marker) => {
      expect(result.status).toBe(0)
      expect(
        JSON.parse(result.stdout).hookSpecificOutput.additionalContext
      ).toBe("# 見出し\n")
      expect(await waitFor(marker, 1500)).toBe(false)
    }
  )
})

test("取得の起動が例外を投げても、注入の JSON を書いて exit 0 で終える", () => {
  withPluginRoot("# 見出し\n", (script) => {
    fs.writeFileSync(
      path.join(path.dirname(script), "morph-runtime.ts"),
      'export function maybeStartFetch(): void {\n  throw new Error("boom")\n}\n'
    )
    const result = spawnSync(process.execPath, [TSX_CLI, script], {
      input: SESSION_START,
      encoding: "utf8",
      env: {
        ...BASE_ENV,
        CLAUDE_PLUGIN_DATA: os.tmpdir(),
        NODE_NO_WARNINGS: "1"
      }
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "# 見出し\n"
      }
    })
  })
})
