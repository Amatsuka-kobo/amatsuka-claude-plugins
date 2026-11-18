import { type ExecFileSyncOptions, execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)

// .ts のソースをテストのプロセスごとに 1 度だけ esbuild でバンドルし、node で起動する
// (tsx 経由は 1 回 0.14 秒、バンドルした .mjs は 0.04 秒)。バンドルは毎回ソースから作るので、
// scripts/ のビルド出力が古くても影響しない。
// setup-agents.ts は import.meta.url からプラグインルートを求めるため、バンドルの置き場は
// 本番の scripts/ と同じ深さ(プラグインルート直下のディレクトリ)にする。
let outDir: string | null = null
const bundles = new Map<string, string>()

export function bundledScript(script: string): string {
  const cached = bundles.get(script)
  if (cached) return cached
  if (!outDir) {
    const dir = fs.mkdtempSync(path.join(PLUGIN_ROOT, ".test-bundle-"))
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
    process.on("exit", cleanup)
    // vitest は forks のワーカーを SIGTERM で止めることがあり、その場合 exit は発火しない。
    process.on("SIGTERM", () => {
      cleanup()
      process.exit(143)
    })
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
// .ts 以外(.mjs など)はバンドルせず tsx 経由で起動する。
export function runTs(
  script: string,
  args: string[] = [],
  opts: ExecFileSyncOptions = {}
): string {
  const argv = script.endsWith(".ts")
    ? [bundledScript(script), ...args]
    : [TSX_CLI, script, ...args]
  return execFileSync(process.execPath, argv, {
    encoding: "utf8",
    ...opts
  }) as string
}
