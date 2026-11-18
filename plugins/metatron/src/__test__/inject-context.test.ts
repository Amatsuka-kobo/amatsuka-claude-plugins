// SessionStart の案内 hook の検証。
// 本文は注入せず、CLAUDE.md に固定で書けない案内だけを出すことを確かめる。
// 実行は tsx 経由の子プロセス(stdin に hook の JSON を流し stdout を読む)。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterAll, expect, test } from "vitest"
import { ADR_ENV, type Features, GOTCHAS_ENV } from "../lib/features.js"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-context.ts", import.meta.url))
const PLUGIN_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url))
)
const CLI = path.join(PLUGIN_ROOT, "scripts", "metatron.mjs")
/** 設定の読み取りを必ず例外にする故障注入モジュール。 */
const FAULT_CONFIG = fileURLToPath(
  new URL("../testing/fault-config.mjs", import.meta.url)
)

const BOTH_ON: Features = { adr: true, gotchas: true }
const BOTH_OFF: Features = { adr: false, gotchas: false }

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function mkTmp(): string {
  // /tmp が symlink である環境で docRoot の実体パスと食い違わないよう realpath で解決する。
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-inject-"))
  )
  tmpDirs.push(dir)
  return dir
}

function write(root: string, rel: string, body: string): void {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, "utf8")
}

const ARCH = "# ARCHITECTURE\n\n## システム概要\n\n本文の目印 ARCH-BODY。\n"
const GOTCHAS =
  "# GOTCHAS\n\n## 失敗パターン一覧\n\n### [2026-11-01] GOTCHA-001: 本文の目印 GOTCHA-BODY\n"

function project(files: Record<string, string>): string {
  const root = mkTmp()
  // docRoot をこの一時ディレクトリに固定する。
  write(root, "metatron.config.json", '{ "version": 1 }')
  for (const [rel, body] of Object.entries(files)) write(root, rel, body)
  return root
}

function inject(
  cwd: string,
  features: Features = BOTH_ON,
  extraEnv: NodeJS.ProcessEnv = {},
  event = "SessionStart"
): string | null {
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_ROOT
  delete env[ADR_ENV]
  delete env[GOTCHAS_ENV]
  if (features.adr) env[ADR_ENV] = "1"
  if (features.gotchas) env[GOTCHAS_ENV] = "1"
  const out = runTs(HOOK, [], {
    cwd,
    env: { ...env, ...extraEnv },
    input: JSON.stringify({ cwd, hook_event_name: event })
  })
  if (out.trim() === "") return null
  const parsed = JSON.parse(out) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string }
  }
  expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart")
  return parsed.hookSpecificOutput.additionalContext
}

function mustInject(...args: Parameters<typeof inject>): string {
  const content = inject(...args)
  if (content === null) throw new Error("何も出力されなかった")
  return content
}

const LINKED_CLAUDE_MD = "@docs/ARCHITECTURE.md\n@docs/GOTCHAS.md\n"

test("I1: 文書の本文は注入せず、CLI の絶対パスと更新・記録・委譲の案内を出す", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "docs/GOTCHAS.md": GOTCHAS,
    "CLAUDE.md": LINKED_CLAUDE_MD
  })
  const content = mustInject(root)

  expect(content).not.toContain("ARCH-BODY")
  expect(content).not.toContain("GOTCHA-BODY")
  expect(content).toContain(`M = ${CLI}`)
  expect(content).toContain("docs/ARCHITECTURE.md と docs/GOTCHAS.md")
  expect(content).toContain(
    "ARCHITECTURE・ADR の更新は、Skill ツールで metatron:updating-architecture を起動して行う。"
  )
  expect(content).toContain("ADR・GOTCHAS へ残すものが無いか確かめる。")
  expect(content).toContain(
    "サブエージェントも CLAUDE.md 経由で同じ文書を読む。"
  )
  expect(content).not.toContain("rules")
  expect(content).not.toContain("SubagentStart")
  expect(content).not.toContain("CLAUDE.md に @")
})

test("I2: ARCHITECTURE が無ければ init へ誘導し、CLI の案内も出す", () => {
  const root = project({})
  const content = mustInject(root)

  expect(content).toContain("`/metatron:init` で作成する")
  expect(content).toContain(`M = ${CLI}`)
  expect(content).not.toContain("updating-architecture")
})

test("I3: 2 変数が無効なら ADR・GOTCHAS の CLI と記録の案内を出さず、GOTCHAS は管理対象に数えない", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "docs/GOTCHAS.md": GOTCHAS,
    "CLAUDE.md": "@docs/ARCHITECTURE.md\n"
  })
  const content = mustInject(root, BOTH_OFF)

  expect(content).not.toContain("get adr")
  expect(content).not.toContain("append-gotcha")
  expect(content).not.toContain("完了報告の前")
  expect(content).not.toContain("docs/GOTCHAS.md")
  expect(content).toContain(
    "ARCHITECTURE の更新は、Skill ツールで metatron:updating-architecture を起動して行う。"
  )
  expect(content).not.toContain("CLAUDE.md に @")
})

test("I4: CLAUDE.md に @メンションが無ければ、足りないものを挙げて追記を促す", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "docs/GOTCHAS.md": GOTCHAS,
    ".claude/CLAUDE.md": "@../docs/ARCHITECTURE.md\n"
  })
  const content = mustInject(root)

  expect(content).toContain(
    "CLAUDE.md に @docs/GOTCHAS.md が無く、文書が読み込まれない。"
  )
  expect(systemMessageOf(root)).toContain("@docs/GOTCHAS.md が無く")
  expect(content).not.toContain("@docs/ARCHITECTURE.md と")
})

test("I5: 旧 rules のディレクトリが残っていれば移行を促す", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "CLAUDE.md": LINKED_CLAUDE_MD,
    ".claude/rules/metatron/conventions.md": "# 規約\n"
  })
  const content = mustInject(root)

  expect(content).toContain(
    "廃止した rules(.claude/rules/metatron/)が残っている。"
  )
})

test("I6: 壊れた設定の理由を添える", () => {
  const root = project({ "docs/ARCHITECTURE.md": ARCH })
  write(root, "metatron.config.json", '{ "version": 1, "paths": ')
  const content = mustInject(root)

  expect(content).toContain("※注意: 設定を読めなかったため既定値を使用します。")
})

test("I7: 設定の解決が例外で失敗したら何も出さない(フェイルオープン)", () => {
  const root = project({ "docs/ARCHITECTURE.md": ARCH })
  expect(
    inject(root, BOTH_ON, {
      NODE_OPTIONS: `--import ${pathToFileURL(FAULT_CONFIG).href}`
    })
  ).toBe(null)
})

test("I8: SubagentStart の入力でも本文は注入しない", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "CLAUDE.md": LINKED_CLAUDE_MD
  })
  const content = mustInject(root, BOTH_ON, {}, "SubagentStart")
  expect(content).not.toContain("ARCH-BODY")
})

test("I9: 旧 config の paths.rulesDir に残る rules も移行を促し、画面にも出す", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "CLAUDE.md": LINKED_CLAUDE_MD,
    "ai/rules/conventions.md": "# 規約\n"
  })
  write(
    root,
    "metatron.config.json",
    '{"version":1,"paths":{"rulesDir":"ai/rules"}}'
  )
  expect(mustInject(root)).toContain("廃止した rules(ai/rules/)が残っている。")
  expect(systemMessageOf(root)).toContain("ai/rules/")
})

test("I10: 移行が要らなければ画面への表示は出さない", () => {
  const root = project({
    "docs/ARCHITECTURE.md": ARCH,
    "docs/GOTCHAS.md": GOTCHAS,
    "CLAUDE.md": LINKED_CLAUDE_MD
  })
  expect(systemMessageOf(root)).toBe(undefined)
})

test("I11: 空白を含むパスは追記を促さず、paths を変えるよう案内する", () => {
  const root = project({ "my docs/ARCH.md": ARCH, "CLAUDE.md": "# P\n" })
  write(
    root,
    "metatron.config.json",
    '{"version":1,"paths":{"architecture":"my docs/ARCH.md"}}'
  )
  const content = mustInject(root, BOTH_OFF)
  expect(content).toContain("my docs/ARCH.md は空白か制御文字を含むため")
  expect(content).not.toContain("/metatron:update で追記する")
})

function systemMessageOf(cwd: string): string | undefined {
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_ROOT
  env[ADR_ENV] = "1"
  env[GOTCHAS_ENV] = "1"
  const out = runTs(HOOK, [], {
    cwd,
    env,
    input: JSON.stringify({ cwd, hook_event_name: "SessionStart" })
  })
  return (JSON.parse(out) as { systemMessage?: string }).systemMessage
}
