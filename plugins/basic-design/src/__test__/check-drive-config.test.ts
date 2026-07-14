import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { expect, test } from "vitest"
import { readDriveConfig } from "../check-drive-config.js"

const execFileAsync = promisify(execFile)
const BUNDLED_CLI = fileURLToPath(new URL("../../scripts/check-drive-config.mjs", import.meta.url))

async function project(content: string | null) {
  const root = await mkdtemp(path.join(tmpdir(), "drive-"))
  if (content !== null) {
    await mkdir(path.join(root, ".claude"), { recursive: true })
    await writeFile(path.join(root, ".claude", "basic-design.local.md"), content)
  }
  return root
}

test("BOM/CRLF/quoted id/comment を現行どおり読む", async () => {
  const root = await project('\uFEFF---\r\ndrive_folder_id: "1AbC" # note\r\n---\r\n')
  expect(readDriveConfig(root)).toEqual({ configured: true, driveFolderId: "1AbC" })
})

test.each([null, "plain\n", "---\nother: x\n---\n", "---\ndrive_folder_id: ''\n---\n"])(
  "設定なしは disabled: %s", async (content) => {
    expect(readDriveConfig(await project(content))).toEqual({ configured: false, driveFolderId: null })
  }
)

test("single quote と unquoted id を読む", async () => {
  expect(readDriveConfig(await project("---\ndrive_folder_id: '1Single'\n---\n"))).toEqual({ configured: true, driveFolderId: "1Single" })
  expect(readDriveConfig(await project("---\ndrive_folder_id: 1Bare\n---\n"))).toEqual({ configured: true, driveFolderId: "1Bare" })
})
test("frontmatter 外の key は無視する", async () => {
  expect(readDriveConfig(await project("---\ntitle: x\n---\ndrive_folder_id: 1Outside\n"))).toEqual({ configured: false, driveFolderId: null })
})
test("CLI 引数省略時は cwd を使い JSON 1行で exit 0", async () => {
  const root = await project("---\ndrive_folder_id: 1Cwd\n---\n")
  const { stdout, stderr } = await execFileAsync("node", [BUNDLED_CLI], { cwd: root })
  expect(stderr).toBe("")
  expect(stdout.trim().split("\n")).toHaveLength(1)
  expect(JSON.parse(stdout)).toEqual({ configured: true, driveFolderId: "1Cwd" })
})
