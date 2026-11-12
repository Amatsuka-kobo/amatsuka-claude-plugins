import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url))

export function raguelConfigPath(root: string): string {
  return path.join(root, ".raguel", "config.json")
}

// codiel-state の CLI を cwd で起動する。終了コードにかかわらず stdout と stderr を返す
// (get --active は成功時にも stderr に書く)。RAGUEL_CONFIG は configRoot の設定を指す
export function runCli(cwd: string, args: string[], configRoot = cwd) {
  const r = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RAGUEL_CONFIG: raguelConfigPath(configRoot) }
  })
  return {
    code: r.status,
    out: r.status === 0 ? JSON.parse(r.stdout) : undefined,
    err: r.stderr
  }
}
