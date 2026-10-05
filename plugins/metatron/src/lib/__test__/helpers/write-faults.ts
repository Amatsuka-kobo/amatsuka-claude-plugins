import fs from "node:fs"
import path from "node:path"
import { vi } from "vitest"

type WriteFileArgs = Parameters<typeof fs.writeFileSync>

const realWriteFileSync = fs.writeFileSync

export interface WriteFaultOptions {
  /**
   * 指定すると、先頭のこのバイト数だけ実際に書いてから ENOSPC を投げる。
   * 書き込みの途中でディスクが尽きた状態を再現する。省略時は 1 バイトも書かずに EACCES を投げる。
   */
  partialBytes?: number
}

function toBytes(data: WriteFileArgs[1]): Buffer {
  if (typeof data === "string") return Buffer.from(data)
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  throw new Error("故障注入はこの書き込みデータの型を扱えません")
}

/**
 * 故障注入: `dir` 配下へのファイル書き込みだけを失敗させ、通った書き込み先を記録する。
 *
 * ディレクトリのパーミッション剥奪では root 実行で止まらないため、
 * `src/testing/fault-config.mjs` と同じ「差し替えて壊す」方式を取る。
 * ここは同一プロセス内なので `fs` の当該関数だけを差し替える。
 */
export function installWriteFaults(
  dir: string,
  options: WriteFaultOptions = {}
): {
  restore: () => void
  written: string[]
} {
  const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`
  const written: string[] = []
  const spy = vi.spyOn(fs, "writeFileSync")
  spy.mockImplementation(
    (
      target: WriteFileArgs[0],
      data: WriteFileArgs[1],
      writeOptions?: WriteFileArgs[2]
    ): void => {
      if (typeof target === "string" && target.startsWith(prefix)) {
        if (options.partialBytes !== undefined) {
          realWriteFileSync(
            target,
            toBytes(data).subarray(0, options.partialBytes),
            writeOptions
          )
          const err: NodeJS.ErrnoException = new Error(
            `ENOSPC: no space left on device, write '${target}'`
          )
          err.code = "ENOSPC"
          throw err
        }
        const err: NodeJS.ErrnoException = new Error(
          `EACCES: permission denied, open '${target}'`
        )
        err.code = "EACCES"
        throw err
      }
      realWriteFileSync(target, data, writeOptions)
      if (typeof target === "string") written.push(target)
    }
  )
  return {
    restore: () => {
      spy.mockRestore()
    },
    written
  }
}
