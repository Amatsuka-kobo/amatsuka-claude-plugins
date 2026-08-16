import {
  type ExecFileOptions,
  type ExecFileSyncOptions,
  execFile,
  execFileSync
} from "node:child_process"
import { createRequire } from "node:module"
import { promisify } from "node:util"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

const execFileAsync = promisify(execFile)

// TypeScript ソースを tsx 経由で子プロセス実行する(ビルド前でもテストできるようにするため)。
// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
// plugins/gh-utility/src/testing/run-ts.ts と同型(プラグイン間でソースを共有しないため複製)。
export function runTs(
  script: string,
  args: string[] = [],
  opts: ExecFileSyncOptions = {}
): string {
  return execFileSync(process.execPath, [TSX_CLI, script, ...args], {
    encoding: "utf8",
    ...opts
  }) as string
}

// 同じものの Promise 版。Promise.all で複数プロセスを同時に走らせ、
// ロックの相互排除(設計書 §13-1 の G14)を検証するために使う。
export async function runTsAsync(
  script: string,
  args: string[] = [],
  opts: ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [TSX_CLI, script, ...args],
    { encoding: "utf8", ...opts }
  )
  return { stdout: String(stdout), stderr: String(stderr) }
}
