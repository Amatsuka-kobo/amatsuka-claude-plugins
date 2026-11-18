import { type ExecFileSyncOptions, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import esbuild from "esbuild"

// TypeScript ソースを子プロセスで実行する(ビルド前でもテストできるようにするため)。
// tsx 経由の起動は 1 回 0.14 秒かかるので、ソースをテストのプロセスごとに 1 度だけ
// esbuild でバンドルし、node で起動する(0.04 秒)。バンドルは毎回ソースから作るので、
// scripts/ のビルド出力が古くても影響しない。
// codiel のソースは import.meta.url を使わないので、バンドルの置き場を一時ディレクトリにできる。
let outDir: string | null = null
const bundles = new Map<string, string>()

export function bundledScript(script: string): string {
  const cached = bundles.get(script)
  if (cached) return cached
  if (!outDir) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codiel-test-bundle-"))
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }))
    outDir = dir
  }
  const outfile = path.join(
    outDir,
    `${bundles.size}-${path.basename(script, ".ts")}.mjs`
  )
  esbuild.buildSync({
    entryPoints: [script],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "error"
  })
  bundles.set(script, outfile)
  return outfile
}

// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
export function runTs(
  script: string,
  args: string[] = [],
  opts: ExecFileSyncOptions = {}
): string {
  return execFileSync(process.execPath, [bundledScript(script), ...args], {
    encoding: "utf8",
    ...opts
  }) as string
}
