// CLI 自身の絶対パスと、入力書式の写し。
//
// 拒否メッセージ・注入の案内・stage の `next` は「AI が metatron のインストール先を
// 知らなくても呼べる」形でなければならない(設計書 §7-5)。そのため案内に載せる
// コマンドは常に絶対パスで組み立てる。

import path from "node:path"
import { fileURLToPath } from "node:url"
import { ARCHITECTURE_HEADINGS } from "../lib/architecture.js"

/**
 * バンドル済み CLI(`<plugin-root>/scripts/metatron.mjs`)の絶対パス。
 *
 * バンドル後はこのモジュールが `scripts/metatron.mjs` 自身に inline されるため
 * `import.meta.url` がそのまま答えになる。tsx でソースから実行しているときは
 * `src/cli/paths.ts` の位置からプラグインルートを遡って組み立てる。
 */
export function metatronCliPath(): string {
  const here = fileURLToPath(import.meta.url)
  if (path.basename(here) === "metatron.mjs") return here
  const pluginRoot = path.resolve(path.dirname(here), "..", "..")
  return path.join(pluginRoot, "scripts", "metatron.mjs")
}

/** 案内に載せるコマンド行。`node <絶対パス> <引数>` の形で統一する。 */
export function commandLine(args: string): string {
  return `node ${metatronCliPath()} ${args}`
}

/**
 * `--input <path>` に渡す JSON の書式。
 * deny hook の拒否メッセージが「入力の書式: get config」と案内するため、
 * `get config` の出力に載せる(設計書 §7-5)。
 */
export const INPUT_SCHEMAS = {
  "stage-architecture": {
    input:
      "{ sections: [{ heading, body } | { heading, remove: true }], reason? }",
    headings: [...ARCHITECTURE_HEADINGS],
    note: "remove: true の削除は見出し許可リストの制限を受けません(body との同時指定は拒否)。書き込みは commit-architecture --staging-id <id>。"
  }
} as const

export const USAGE_LINES: readonly string[] = [
  "usage: node <plugin-root>/scripts/metatron.mjs <subcommand> [options]",
  "",
  "読み取り(常に exit 0):",
  "  get config",
  "  get architecture [--section <見出し>]",
  "  get domains",
  "  scan",
  "  diff-architecture",
  "",
  "段階(拒否は非 0):",
  "  stage-architecture --input <path>",
  "",
  "書き込み(拒否・失敗は非 0):",
  "  commit-architecture --staging-id <id>",
  "  link-claude-md"
]
