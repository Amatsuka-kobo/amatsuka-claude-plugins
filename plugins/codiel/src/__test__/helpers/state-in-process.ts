// codiel-state の CLI を子プロセスを起動せずに、テストのプロセス内で実行する。
// tsx の子プロセスは 1 回 0.14 秒かかり、run を組み立てるテストでは数十回呼ぶため。
// CLI の入口(codiel-state-cli.ts)と同じく main(argv, findMainRoot(cwd)) を呼ぶ。
import { main } from "../../codiel-state.js"
import { findMainRoot } from "../../hooks/lib.js"

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`)
  }
}

export interface InProcessResult {
  code: number
  stdout: string
  stderr: string
}

// 終了コード・stdout・stderr を子プロセスと同じ形で返す。env は呼び出しの間だけ process.env に重ねる。
// 最初の process.exit で実行が終わった扱いにし、その後の書き込みと終了コードは捨てる
// (catch の中で fail が再び呼ばれても、実プロセスなら最初の exit で止まるため)。
export function runStateInProcess(
  cwd: string,
  args: string[],
  env: Record<string, string> = {}
): InProcessResult {
  const out: string[] = []
  const err: string[] = []
  let exitCode: number | null = null
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k])
    process.env[k] = v
  }
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  const origExit = process.exit
  const capture =
    (buf: string[]) =>
    (chunk: string | Uint8Array): boolean => {
      if (exitCode === null) buf.push(String(chunk))
      return true
    }
  process.stdout.write = capture(out) as typeof process.stdout.write
  process.stderr.write = capture(err) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    if (exitCode === null) exitCode = code ?? 0
    throw new ExitSignal(exitCode)
  }) as typeof process.exit
  try {
    main(args, findMainRoot(cwd))
  } catch (e) {
    if (!(e instanceof ExitSignal)) {
      // 実プロセスなら捕まらない例外で exit 1 になり、stderr にスタックが出る
      if (exitCode === null) {
        exitCode = 1
        err.push(`${(e as Error).stack ?? String(e)}\n`)
      }
    }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
    process.exit = origExit
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  return { code: exitCode ?? 0, stdout: out.join(""), stderr: err.join("") }
}
