import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import {
  ensureStateDirs,
  getStatePaths,
  isInside,
  migrateLegacyStateDir,
  resolveStateRoot
} from "../chat-recording-state.js"

const PROJECT = "/home/example/project"
const SESSION_KEY = "session-key"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

// chat-recorder の Write は Claude Code の sensitive file 保護に阻まれるため、
// 一時ファイルだけは Claude 設定ディレクトリの外に置かなければならない。
test("既定の状態ディレクトリでも一時ファイルは Claude 設定ディレクトリの外に置く", () => {
  const configDir = path.join(tempRoot("chat-state-default-"), ".claude")
  const paths = getStatePaths(PROJECT, SESSION_KEY, {
    CLAUDE_CONFIG_DIR: configDir
  })
  expect(isInside(configDir, paths.stateDir)).toBe(true)
  expect(isInside(configDir, paths.tempDir)).toBe(false)
})

test("状態ディレクトリを明示指定した場合は一時ファイルもその配下に置く", () => {
  const stateRoot = tempRoot("chat-state-explicit-")
  const paths = getStatePaths(PROJECT, SESSION_KEY, {
    TASK_UTILITY_CHAT_STATE_DIR: stateRoot
  })
  expect(isInside(stateRoot, paths.tempDir)).toBe(true)
})

test("明示指定が Claude 設定ディレクトリ配下でも一時ファイルは退避する", () => {
  const configDir = path.join(tempRoot("chat-state-nested-"), ".claude")
  const paths = getStatePaths(PROJECT, SESSION_KEY, {
    CLAUDE_CONFIG_DIR: configDir,
    TASK_UTILITY_CHAT_STATE_DIR: path.join(configDir, "custom")
  })
  expect(isInside(configDir, paths.tempDir)).toBe(false)
})

test("プロジェクトごとに一時ディレクトリが分かれる", () => {
  const configDir = path.join(tempRoot("chat-state-scope-"), ".claude")
  const env = { CLAUDE_CONFIG_DIR: configDir }
  expect(getStatePaths(PROJECT, SESSION_KEY, env).tempDir).not.toBe(
    getStatePaths("/home/example/other", SESSION_KEY, env).tempDir
  )
})

test("一時ディレクトリが自分の所有でなければ ensureStateDirs は失敗する", () => {
  const stateRoot = tempRoot("chat-state-symlink-")
  const paths = getStatePaths(PROJECT, SESSION_KEY, {
    TASK_UTILITY_CHAT_STATE_DIR: stateRoot
  })
  const decoy = path.join(stateRoot, "decoy")
  fs.mkdirSync(decoy, { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.dirname(paths.tempDir), { recursive: true, mode: 0o700 })
  fs.symlinkSync(decoy, paths.tempDir)
  expect(() => ensureStateDirs(paths)).toThrow(/temp/)
})

test("ensureStateDirs は一時ディレクトリを 0700 で作る", () => {
  const stateRoot = tempRoot("chat-state-mode-")
  const paths = getStatePaths(PROJECT, SESSION_KEY, {
    TASK_UTILITY_CHAT_STATE_DIR: stateRoot
  })
  ensureStateDirs(paths)
  expect(fs.statSync(paths.tempDir).mode & 0o777).toBe(0o700)
})

// --- 旧プラグイン名(task-utility)の状態ディレクトリからの移行 ---

const legacyDir = (configDir: string): string =>
  path.join(configDir, "task-utility", "chat-recorder")
const currentDir = (configDir: string): string =>
  path.join(configDir, "chat-history", "chat-recorder")

function seedLegacy(configDir: string, body = "{}"): string {
  const marker = path.join(
    legacyDir(configDir),
    "projectkey",
    "state",
    "s.json"
  )
  fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 })
  fs.writeFileSync(marker, body)
  return marker
}

test("旧 root だけがあるときは移行前でも旧 root を読む", () => {
  const configDir = path.join(tempRoot("chat-state-legacy-read-"), ".claude")
  seedLegacy(configDir)
  const resolved = resolveStateRoot({ CLAUDE_CONFIG_DIR: configDir })
  expect(resolved.root).toBe(legacyDir(configDir))
  expect(resolved.legacyRoot).toBe(legacyDir(configDir))
  expect(
    getStatePaths(PROJECT, SESSION_KEY, { CLAUDE_CONFIG_DIR: configDir })
      .statePath
  ).toContain(legacyDir(configDir))
})

test("migrateLegacyStateDir は旧 root を新 root へ中身ごと移す", () => {
  const configDir = path.join(tempRoot("chat-state-migrate-"), ".claude")
  seedLegacy(configDir, '{"recordedLine":42}')
  expect(migrateLegacyStateDir({ CLAUDE_CONFIG_DIR: configDir })).toEqual({
    migrated: true
  })
  expect(fs.existsSync(legacyDir(configDir))).toBe(false)
  expect(
    fs.readFileSync(
      path.join(currentDir(configDir), "projectkey", "state", "s.json"),
      "utf8"
    )
  ).toBe('{"recordedLine":42}')
  // 移行後は新 root を指し、legacyRoot は落ちる
  const resolved = resolveStateRoot({ CLAUDE_CONFIG_DIR: configDir })
  expect(resolved.root).toBe(currentDir(configDir))
  expect(resolved.legacyRoot).toBeUndefined()
})

test("新 root が既にあれば移行せず旧 root にも触れない", () => {
  const configDir = path.join(tempRoot("chat-state-both-"), ".claude")
  const marker = seedLegacy(configDir)
  fs.mkdirSync(currentDir(configDir), { recursive: true, mode: 0o700 })
  expect(migrateLegacyStateDir({ CLAUDE_CONFIG_DIR: configDir })).toEqual({
    migrated: false
  })
  expect(fs.existsSync(marker)).toBe(true)
  expect(resolveStateRoot({ CLAUDE_CONFIG_DIR: configDir }).root).toBe(
    currentDir(configDir)
  )
})

test("移行対象が無ければ何もしない", () => {
  const configDir = path.join(tempRoot("chat-state-none-"), ".claude")
  expect(migrateLegacyStateDir({ CLAUDE_CONFIG_DIR: configDir })).toEqual({
    migrated: false
  })
  expect(resolveStateRoot({ CLAUDE_CONFIG_DIR: configDir })).toEqual({
    root: currentDir(configDir)
  })
})

test("状態ディレクトリの明示指定があるときは移行の対象外", () => {
  const configDir = path.join(tempRoot("chat-state-explicit-mig-"), ".claude")
  const marker = seedLegacy(configDir)
  const stateRoot = tempRoot("chat-state-explicit-root-")
  const env = {
    CLAUDE_CONFIG_DIR: configDir,
    TASK_UTILITY_CHAT_STATE_DIR: stateRoot
  }
  expect(migrateLegacyStateDir(env)).toEqual({ migrated: false })
  expect(fs.existsSync(marker)).toBe(true)
  expect(resolveStateRoot(env)).toEqual({ root: stateRoot })
})
