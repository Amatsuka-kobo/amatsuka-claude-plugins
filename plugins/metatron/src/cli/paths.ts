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
    input: "{ sections: [{ heading, body }], reason? }",
    headings: [...ARCHITECTURE_HEADINGS],
    note: "`ADR 一覧` は指定できません。ADR の追加・状態変更は stage-adr を使ってください。"
  },
  "stage-adr": {
    add: '{ mode: "add", title, status?, decidedOn?, decidedBy, background, options: [...], conclusion, rationale, impact }',
    status:
      '{ mode: "status", id: "ADR-003", status: "採用" | "提案" | "廃止", reason, changedOn? }',
    note: "採番は CLI が行う。書き込みは commit-architecture --staging-id <id>。"
  },
  "append-gotcha": {
    input:
      '{ title, date?, task, mistake, cause, countermeasure, promotionCandidate: "Yes" | "No" }',
    note: "採番は CLI が行う。`## 失敗パターン一覧` の直下(先頭)に挿入する。"
  },
  "tag-gotcha": {
    usage: "tag-gotcha --id GOTCHA-003 --tag 解決済み|対象外 --reason <理由>",
    note: "見出しへのタグ挿入と末尾の理由行の追記だけを行う。本文は書き換えない。"
  }
} as const

export const USAGE_LINES: readonly string[] = [
  "usage: node <plugin-root>/scripts/metatron.mjs <subcommand> [options]",
  "",
  "読み取り(常に exit 0):",
  "  get config",
  "  get architecture [--section <見出し>]",
  "  get domains",
  "  get gotchas [--recent N | --id <ID> | --query <語>] [--exclude-tagged] [--promotion-candidates]",
  "  get adr [--id <ID> | --status <状態>]",
  "  scan",
  "  diff-architecture",
  "",
  "段階(拒否は非 0):",
  "  stage-architecture --input <path>",
  "  stage-adr --input <path>",
  "",
  "書き込み(拒否・失敗は非 0):",
  "  commit-architecture --staging-id <id>",
  "  append-gotcha --input <path>",
  "  tag-gotcha --id <ID> --tag <解決済み|対象外> --reason <理由>"
]
