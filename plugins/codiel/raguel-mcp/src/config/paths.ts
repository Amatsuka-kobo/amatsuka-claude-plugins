/**
 * testsDir の読み方と、生成物・E2E のレポートの判定(設計書 §6.4.2・§6.12.1、R24)。
 * testsDir は codiel の readCodielConfig(plugins/codiel/src/codiel-state.ts)と、
 * レポートの判定は codiel の isE2eReport(plugins/codiel/src/hooks/guard-write.ts)と同じ規則を独立に持つ。
 * codiel の src は import しない。
 */

import fs from "node:fs"
import path from "node:path"
import picomatch from "picomatch"
import type { RaguelConfig } from "../core/types"

/** .codiel/config.json かキーが無いときの testsDir */
export const DEFAULT_TESTS_DIR = "docs/codiel/tests"

const GENERATED_RULE_ID = "code/protected-paths"

/**
 * プロジェクトルートの .codiel/config.json から testsDir を読み、repoRoot 相対のパスにして返す。
 * ファイルかキーが無ければ既定の値を返す。JSON として読めない・オブジェクトでない・
 * 値が文字列でない・空・絶対パス・`..` のセグメントを含む、のどれかは例外を投げる。
 * 値は `./` と末尾の `/` を落として返す。
 */
export function resolveTestsDir(projectRoot: string): string {
  const file = path.join(projectRoot, ".codiel", "config.json")
  if (!fs.existsSync(file)) return DEFAULT_TESTS_DIR
  let cfg: unknown
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    throw new Error(`${file} を JSON として読めません`)
  }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg))
    throw new Error(`${file} は JSON のオブジェクトにしてください`)
  const obj = cfg as Record<string, unknown>
  if (!("testsDir" in obj)) return DEFAULT_TESTS_DIR
  const v = obj.testsDir
  if (typeof v !== "string") throw new Error("testsDir は文字列にしてください")
  if (v === "") throw new Error("testsDir に空文字列は指定できません")
  if (path.posix.isAbsolute(v) || path.win32.isAbsolute(v))
    throw new Error(`testsDir には repoRoot 相対のパスを書いてください: ${v}`)
  if (v.split(/[/\\]/).includes(".."))
    throw new Error(`testsDir に .. のセグメントは使えません: ${v}`)
  return path.posix.normalize(v.replaceAll("\\", "/")).replace(/\/+$/, "")
}

/** repoRel が dir の配下か。dir が `.` ならリポジトリ全体を指す */
function underDir(repoRel: string, dir: string): boolean {
  return dir === "." || repoRel.startsWith(`${dir}/`)
}

/** E2E のレポート `<testsDir>/**\/reports/**` か。testsDir からの相対パスに reports/ のセグメントを含むもの */
export function isE2eReport(repoRel: string, testsDir: string): boolean {
  if (!underDir(repoRel, testsDir)) return false
  const rest = testsDir === "." ? repoRel : repoRel.slice(testsDir.length + 1)
  return /(^|\/)reports\//.test(rest)
}

export type PathClass = "generated" | "report" | "normal"

/**
 * diff のパス(repoPath 相対、`/` 区切り)を分類する。
 * report は E2E のレポート、generated は code/protected-paths の generated に当たるパス。
 * どちらも common/secrets だけを当て、保護パス・重さ・パネル・Jev から外す
 */
export function classifyPath(
  repoRel: string,
  config: RaguelConfig,
  testsDir: string
): PathClass {
  if (isE2eReport(repoRel, testsDir)) return "report"
  const generated = config.rules[GENERATED_RULE_ID]?.generated
  if (
    Array.isArray(generated) &&
    generated.length > 0 &&
    picomatch(generated as string[], { dot: true })(repoRel)
  ) {
    return "generated"
  }
  return "normal"
}

/**
 * glob の固定部(ワイルドカードを含む最初のセグメントより前)を返す。例: `plugins/*\/scripts/**` は `plugins`、
 * `**\/*` と `*.js` は空文字列。generated の検査と重さ判定の保護パス近接が使う
 */
export function globFixedPart(glob: string): string {
  return picomatch.scan(glob).base
}
