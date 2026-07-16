import {
  type ExecFileOptions,
  execFile,
  type ExecFileSyncOptions,
  execFileSync
} from "node:child_process"
import { createRequire } from "node:module"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

// TypeScript ソースを tsx 経由で子プロセス実行する(ビルド前でもテストできるようにするため)。
// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
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

// 並行実行テスト用の非同期版。複数の hook プロセスを同時に走らせて
// ロックの直列化を検証する(設計書 §6)。
export function runTsAsync(
  script: string,
  args: string[] = [],
  opts: ExecFileOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [TSX_CLI, script, ...args],
      { encoding: "utf8", ...opts },
      (err, stdout) => (err ? reject(err) : resolve(stdout as string))
    )
  })
}
