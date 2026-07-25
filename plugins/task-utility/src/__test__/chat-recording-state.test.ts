import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import {
  ensureStateDirs,
  getStatePaths,
  isInside
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

// ヘッドレス recorder の Write は Claude Code の sensitive file 保護に阻まれるため、
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
