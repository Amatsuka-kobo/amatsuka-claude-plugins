// Raguel の記録(評価の索引・裁定の記録・verdict.json)を読み、pass-gate の検査を行う
// (Raguel 設計書 §6.9・§6.13.3)。形式は raguel-mcp の casefile/store.ts が書く契約で、
// raguel-mcp の src は import しない(R11)。同じ規則を独立に持ち、2 者比較テスト
// (__test__/raguel-records.test.ts)で一致を確かめる。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// 設定に storage.casesDir が無いときの置き場
const DEFAULT_CASES_DIR = "~/.raguel"
const EVALUATIONS_FILE = "evaluations.jsonl"
const OUTCOMES_FILE = "outcomes.jsonl"
const VERDICT_FILE = "verdict.json"

// 検査 8 の対象(code 系フェーズ)と検査 9 の対象(文書のフェーズ)
export const CODE_PHASES = new Set([
  "carry-over",
  "test-code",
  "implement",
  "test-loop",
  "fix-loop"
])
export const DOC_PHASES = new Set([
  "design",
  "test-spec",
  "dev-plan",
  "intent-sync"
])

export interface RaguelStore {
  // <casesDir>/cases/<projectId>
  projectDir: string
  casesDir: string
  projectId: string
}

// evaluations.jsonl の 1 行
export interface EvaluationIndexEntry {
  schemaVersion: number
  evaluationId: string
  runId: string
  phase: string
  kind: string
  attempt: number
  casePath: string
  verdict: string
  judgeStatus: string
  head: string | null
  at: string
}

// outcomes.jsonl の 1 行
export interface OutcomeRecord {
  schemaVersion: number
  evaluationId: string
  runId: string
  phase: string
  outcome: string
  ruling: string | null
  notes?: string
  precedentId: string | null
  at: string
}

export interface SubjectRecord {
  repoPath: string
  head: string | null
  base?: string
  paths?: string[]
  files: { path: string; sha256: string | null; isNew: boolean }[]
  contentSha256?: string
}

// verdict.json のうち、pass-gate が読むフィールド
export interface VerdictRecord {
  schemaVersion: number
  evaluationId: string
  runId: string
  phase: string
  verdict: string
  judgeStatus: string
  subject: SubjectRecord
  [key: string]: unknown
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function readJsonObject(file: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    throw new Error(`Raguel の設定 ${file} を JSON として読めません`)
  }
  if (!isObject(parsed))
    throw new Error(
      `Raguel の設定 ${file} は JSON のオブジェクトにしてください`
    )
  return parsed
}

// Raguel の設定の storage を読む(設計書 §6.12.1 の読む順)。RAGUEL_CONFIG があればそのファイル
// (中身は raguel の値の形)、無ければ mainRoot の .codiel/config.json の raguel。
// config.json か raguel キーが無ければ空を返す。
function readStorage(mainRoot: string): {
  casesDir?: string
  projectId?: string
} {
  let raguel: unknown
  const env = process.env.RAGUEL_CONFIG
  if (env) raguel = readJsonObject(env)
  else {
    const file = path.join(mainRoot, ".codiel", "config.json")
    if (!fs.existsSync(file)) return {}
    raguel = readJsonObject(file).raguel
    if (raguel === undefined) return {}
    if (!isObject(raguel))
      throw new Error(`${file} の raguel は JSON のオブジェクトにしてください`)
  }
  const storage = (raguel as Record<string, unknown>).storage
  if (storage === undefined) return {}
  if (!isObject(storage))
    throw new Error("raguel.storage は JSON のオブジェクトにしてください")
  const text = (key: string): string | undefined => {
    const v = storage[key]
    if (v === undefined) return undefined
    if (typeof v !== "string")
      throw new Error(`raguel.storage.${key} は文字列にしてください`)
    return v
  }
  return { casesDir: text("casesDir"), projectId: text("projectId") }
}

// storage.casesDir を解決する。`~` はホームディレクトリへ展開し、相対パスは
// Raguel と同じくプロジェクトルート(mainRoot)を基準に絶対パスにする。
function resolveCasesDir(mainRoot: string, configured?: string): string {
  const dir = configured || DEFAULT_CASES_DIR
  if (dir === "~") return path.resolve(os.homedir())
  if (dir.startsWith("~/") || dir.startsWith("~\\"))
    return path.resolve(os.homedir(), dir.slice(2))
  return path.resolve(mainRoot, dir)
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

// git の共通ディレクトリの実体パス。git の管理外(または git が無い)なら null
function gitCommonDir(dir: string): string | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()
    return out ? realpathOrResolve(out) : null
  } catch {
    return null
  }
}

// projectId を返す(設計書 §6.9.1)。storage.projectId があればそれを使う。無ければ git の
// 共通ディレクトリの実体パスから `<名前>-<sha256 の先頭 12 文字>` を作る。共通ディレクトリの
// basename が `.git` ならその親の basename、そうでなければ末尾の `.git` を除いた basename が名前。
// git の管理外では、プロジェクトルートの実体パスで同じ形を作る。
export function resolveProjectId(
  projectRoot: string,
  storageProjectId?: string
): string {
  if (storageProjectId) return storageProjectId
  const common = gitCommonDir(projectRoot)
  const base = common ?? realpathOrResolve(projectRoot)
  let name: string
  if (common === null) name = path.basename(base)
  else if (path.basename(base) === ".git")
    name = path.basename(path.dirname(base))
  else name = path.basename(base).replace(/\.git$/, "")
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 12)
  return `${name}-${hash}`
}

// Raguel の記録の置き場を解決する。mainRoot は findMainRoot で決めたプロジェクトルート。
// 設定が読めなければ例外を投げる(黙って既定の置き場を読まない)。
export function resolveRaguelStore(mainRoot: string): RaguelStore {
  const storage = readStorage(mainRoot)
  const casesDir = resolveCasesDir(mainRoot, storage.casesDir)
  const projectId = resolveProjectId(mainRoot, storage.projectId)
  return {
    casesDir,
    projectId,
    projectDir: path.join(casesDir, "cases", projectId)
  }
}

// JSON Lines を読む。ファイルが無ければ空。読めない行は例外にする
function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  const rows: T[] = []
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return
      try {
        rows.push(JSON.parse(line) as T)
      } catch {
        throw new Error(`Raguel の記録の行が読めません: ${file}:${i + 1}`)
      }
    })
  return rows
}

// 評価の索引を書かれた順に返す
export function readEvaluationIndex(
  store: RaguelStore
): EvaluationIndexEntry[] {
  return readJsonl(path.join(store.projectDir, EVALUATIONS_FILE))
}

// 裁定の記録を evaluationId ごとに返す。同じ evaluationId の行が複数あれば後の行を正とする
export function readOutcomes(store: RaguelStore): Map<string, OutcomeRecord> {
  const map = new Map<string, OutcomeRecord>()
  for (const r of readJsonl<OutcomeRecord>(
    path.join(store.projectDir, OUTCOMES_FILE)
  ))
    map.set(r.evaluationId, r)
  return map
}

// casePath(attempt のディレクトリ)の verdict.json を読む。無いか読めなければ undefined
export function readVerdictRecord(casePath: string): VerdictRecord | undefined {
  try {
    const v = JSON.parse(
      fs.readFileSync(path.join(casePath, VERDICT_FILE), "utf8")
    )
    return isObject(v) ? (v as VerdictRecord) : undefined
  } catch {
    return undefined
  }
}

// 索引から evaluationId の行を引く。複数あれば後の行
export function findEvaluation(
  index: EvaluationIndexEntry[],
  evaluationId: string
): EvaluationIndexEntry | undefined {
  return index.findLast((e) => e.evaluationId === evaluationId)
}

// dir の HEAD のコミット。読めなければ null
export function gitHead(dir: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
  } catch {
    return null
  }
}

// a と b の分岐点のコミット。読めなければ null
export function gitMergeBase(dir: string, a: string, b: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "merge-base", a, b], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
  } catch {
    return null
  }
}

// ancestor が descendant の祖先(同じコミットを含む)か。git が失敗したら false
export function isAncestor(
  dir: string,
  ancestor: string,
  descendant: string
): boolean {
  try {
    execFileSync(
      "git",
      ["-C", dir, "merge-base", "--is-ancestor", ancestor, descendant],
      { stdio: "ignore" }
    )
    return true
  } catch {
    return false
  }
}

// base..HEAD で変わったファイルの repoRoot 相対のパス。名前の変更は --no-renames で削除と追加に
// 分け、移動元と移動先の両方を返す。git が失敗したら null
export function changedPathsSince(dir: string, base: string): string[] | null {
  try {
    return execFileSync(
      "git",
      ["-C", dir, "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
      .split("\0")
      .filter(Boolean)
  } catch {
    return null
  }
}

// 評価の subject.files のパス(path.posix.normalize 済み)。索引の行か verdict.json が
// 読めなければ null
export function evaluatedFiles(
  store: RaguelStore,
  evaluationId: string
): string[] | null {
  const row = findEvaluation(readEvaluationIndex(store), evaluationId)
  const v = row && readVerdictRecord(row.casePath)
  if (!v || !isObject(v.subject) || !Array.isArray(v.subject.files)) return null
  return v.subject.files.map((f) => path.posix.normalize(f.path))
}

function sha256OfFile(file: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  } catch {
    return null
  }
}

export interface GateInput {
  store: RaguelStore
  // git の HEAD と文書の現在の中身を読む基準のディレクトリ(codiel-state の root)
  root: string
  // state の raguelRunId
  runId: string
  phase: string
  evaluationId: string
  verdict: string
  humanApproved: boolean
  // state の phases.<phase>.startHead
  startHead?: string
  // 検査 9 で期待するファイルの置き場(repoRoot 相対)。runDocsDir は `<runsDir>/<slug>`、
  // testsDir は .codiel/config.json の testsDir
  runDocsDir: string
  testsDir: string
}

// 検査 9 の後半。期待するファイルはフェーズごとに決まり、評価したファイルに無ければ理由の文を返す。
// intent-sync は書き換えるファイルが run ごとに違うので照合しない(設計書 §13)
function missingExpectedDoc(
  input: GateInput,
  files: { path: string }[]
): string | null {
  const paths = files.map((f) => path.posix.normalize(f.path))
  const listed = paths.length > 0 ? paths.join(", ") : "なし"
  const need = (expected: string, found: boolean): string | null =>
    found
      ? null
      : `${input.phase} の評価に ${expected} が含まれていません(評価したファイル: ${listed})。${expected} を paths に入れて評価し直してください`
  if (input.phase === "design" || input.phase === "dev-plan") {
    const expected = path.posix.join(input.runDocsDir, `${input.phase}.md`)
    return need(expected, paths.includes(expected))
  }
  if (input.phase === "test-spec") {
    const underTests = (p: string) =>
      input.testsDir === "." || p.startsWith(`${input.testsDir}/`)
    return need(
      `${input.testsDir}/ 配下の spec.md か cases.md`,
      paths.some(
        (p) =>
          underTests(p) &&
          ["spec.md", "cases.md"].includes(path.posix.basename(p))
      )
    )
  }
  return null
}

// 索引の行が run とフェーズと verdict に合うかを見る(検査 1・2・4)。
// mark-ask --kind raguel と pass-gate が使う。合わなければ理由の文を返す
export function checkEvaluationRow(
  row: EvaluationIndexEntry | undefined,
  input: Pick<GateInput, "evaluationId" | "runId" | "phase" | "verdict">
): string | null {
  if (!row)
    return `Raguel の評価の索引に evaluationId ${input.evaluationId} の行がありません(評価の記録が無い。掃除済みか、存在しない)`
  if (row.runId !== input.runId || row.phase !== input.phase)
    return `evaluationId ${input.evaluationId} は別の run かフェーズの評価です(索引: runId ${row.runId}・phase ${row.phase}、この run: runId ${input.runId}・phase ${input.phase})`
  if (row.verdict !== input.verdict)
    return `--verdict ${input.verdict} が Raguel の評価の verdict ${row.verdict} と合いません(evaluationId: ${input.evaluationId})`
  return null
}

// pass-gate の検査 1〜5・7〜9(設計書 §6.13.3)。すべて通れば null、外れたら理由の文を返す。
// 検査 6(--human-approved が無ければ PROCEED)と検査 10(raguelContract)は呼び出し側が先に行う。
export function checkGate(input: GateInput): string | null {
  const index = readEvaluationIndex(input.store)
  const row = findEvaluation(index, input.evaluationId)
  const rowProblem = checkEvaluationRow(row, input)
  if (rowProblem || !row) return rowProblem
  // 検査 3: 後の評価で ASK が出た後に、前の PROCEED で通さない
  const last = index.findLast(
    (e) => e.runId === input.runId && e.phase === input.phase
  )
  if (last && last.evaluationId !== input.evaluationId)
    return `evaluationId ${input.evaluationId} は ${input.phase} の最新の評価ではありません(最新: ${last.evaluationId}、verdict: ${last.verdict})`
  // 検査 5
  const v = readVerdictRecord(row.casePath)
  if (!v) return `verdict.json を読めません: ${row.casePath}`
  for (const key of ["evaluationId", "runId", "phase", "verdict"] as const)
    if (v[key] !== row[key])
      return `verdict.json の ${key}(${String(v[key])})が評価の索引(${row[key]})と合いません: ${row.casePath}`
  // 検査 7
  if (input.humanApproved) {
    const outcome = readOutcomes(input.store).get(input.evaluationId)
    if (!outcome)
      return `--human-approved には Raguel の裁定の記録が要ります(evaluationId ${input.evaluationId} の行がありません)。record_outcome で人の裁定を記録してください`
    const want =
      row.verdict === "ASK"
        ? "as-is"
        : row.verdict === "STOP"
          ? "false-positive"
          : null
    if (want && outcome.ruling !== want)
      return `${row.verdict} を --human-approved で通すには裁定の ruling が ${want} であることが要ります(記録: ${outcome.ruling})`
  }
  const subject = isObject(v.subject) ? v.subject : undefined
  if (!subject) return `verdict.json に subject がありません: ${row.casePath}`
  // 検査 8: フェーズの差分の一部だけを評価させる抜け道と、評価の後のコミットを塞ぐ
  if (CODE_PHASES.has(input.phase)) {
    const head = gitHead(input.root)
    if (!head || subject.head !== head)
      return `評価した HEAD(${subject.head})が現在の HEAD(${head})と合いません。今の HEAD で評価し直してください`
    if (!input.startHead || subject.base !== input.startHead)
      return `評価の起点(${subject.base})がフェーズの開始の HEAD(${input.startHead ?? "記録なし"})と合いません。baseRef にフェーズの開始の HEAD を渡して評価し直してください`
    if (subject.paths !== undefined)
      return `評価の範囲が paths(${JSON.stringify(subject.paths)})で絞られています。code 系フェーズは paths を渡さずに、フェーズの差分の全体を評価し直してください`
  }
  // 検査 9: ゲートの後に文書を書き換える抜け道と、別のファイルを評価させる抜け道を塞ぐ
  if (DOC_PHASES.has(input.phase)) {
    const files = Array.isArray(subject.files) ? subject.files : []
    for (const f of files) {
      const now = sha256OfFile(path.join(input.root, f.path))
      if (now !== f.sha256)
        return `${f.path} が評価の後に変わっています(記録: ${f.sha256}、現在: ${now})。今の中身で評価し直してください`
    }
    return missingExpectedDoc(input, files)
  }
  return null
}

// run の STOP のうち、判定が確かで(judgeStatus: ok)、誤検知の裁定(ruling: false-positive)を
// 持たないものの evaluationId を返す。init が次の try の前に人の承認を求めるのに使う
export function unresolvedStops(store: RaguelStore, runId: string): string[] {
  const outcomes = readOutcomes(store)
  return readEvaluationIndex(store)
    .filter(
      (e) =>
        e.runId === runId &&
        e.verdict === "STOP" &&
        e.judgeStatus === "ok" &&
        outcomes.get(e.evaluationId)?.ruling !== "false-positive"
    )
    .map((e) => e.evaluationId)
}
