import {
  type ExecFileOptions,
  type ExecFileSyncOptions,
  execFile,
  execFileSync
} from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import esbuild from "esbuild"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

const execFileAsync = promisify(execFile)

// tsx 経由の起動は 1 回 0.14 秒かかるので、.ts はテストのプロセスごとに 1 度だけ
// esbuild でバンドルし、node で起動する(0.04 秒)。設定は build.ts と同じ。
// metatron のソースは import.meta.url からプラグインルートを求めるため、バンドルは
// 本番の scripts/*.mjs と同じ深さ(プラグインルート直下のディレクトリ)に置く。
// CLI だけは paths.ts が basename で本番のバンドルを判定するので、本番と同じ名前にする。
const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
)
const OUT_NAMES: Record<string, string> = { "metatron-cli": "metatron" }
let outDir: string | null = null
const bundles = new Map<string, string>()

function bundledScript(script: string): string {
  const cached = bundles.get(script)
  if (cached) return cached
  if (!outDir) {
    const dir = fs.mkdtempSync(path.join(PLUGIN_ROOT, ".test-bundle-"))
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }))
    // vitest の fork ワーカーは SIGTERM で終了させられ、そのままでは exit が発火しない。
    process.on("SIGTERM", () => process.exit(143))
    outDir = dir
  }
  const base = path.basename(script, ".ts")
  const outfile = path.join(outDir, `${OUT_NAMES[base] ?? base}.mjs`)
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

// --import などの node オプション(NODE_OPTIONS)を伴う呼び出しは、故障注入が
// モジュール解決(src の URL)に依存するためバンドルせず tsx で起動する。
function command(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined
): string[] {
  if (script.endsWith(".ts") && !env?.NODE_OPTIONS) {
    return [bundledScript(script), ...args]
  }
  return [TSX_CLI, script, ...args]
}

// TypeScript ソースを tsx 経由で子プロセス実行する(ビルド前でもテストできるようにするため)。
// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
// plugins/gh-utility/src/testing/run-ts.ts と同型(プラグイン間でソースを共有しないため複製)。
export function runTs(
  script: string,
  args: string[] = [],
  opts: ExecFileSyncOptions = {}
): string {
  return execFileSync(process.execPath, command(script, args, opts.env), {
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
    command(script, args, opts.env),
    { encoding: "utf8", ...opts }
  )
  return { stdout: String(stdout), stderr: String(stderr) }
}
