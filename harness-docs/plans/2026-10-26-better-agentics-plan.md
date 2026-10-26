# better-agentics 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent-policy の claude プロファイルを抜き出し、オーケストレーターが自分で働き、委譲先だけを Jev が選ぶプラグイン `better-agentics` を新規に作る。

**Architecture:** 役割表(`src/lib/roles.ts`)を 1 か所に持ち、setup の CLI・`pick-delegate`・hook 2 本がそれを参照する。委譲先の選択基準は定義本文の `## When to invoke` に置き、`pick-delegate` だけが読んで Jev(`@typesafe-ai/sdk`)に渡す。サブエージェントの規律は SubagentStart が `references/subagent-policy.md` を注入して届ける。

**Tech Stack:** TypeScript(strict)、esbuild(ESM・node22・`.mjs`)、vitest、`@typesafe-ai/sdk` 0.6.0

**Spec:** `harness-docs/design/2026-10-26-better-agentics-design.md`(承認済み。コミット `a0ca8839`)

- 作成日: 2026-10-26
- 対象プラグイン: `plugins/better-agentics/`(新規、`0.0.1-dev`)
- 計画立案時の HEAD: `a0ca8839`

この計画書はタスクの分割・順序・検証方法・タスク間の契約を定める。設計判断は設計書を正本とし、各タスクに設計書のセクション番号を添える。設計書と実装の食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。

## Global Constraints

設計書と規約から値をそのまま写す。

- バージョンは `plugin.json` と `package.json` の両方で `0.0.1-dev` とし、この計画の中では上げない(設計書 §11、§15)。
- パッケージ名は `better-agentics-scripts`。単体ビルドは `pnpm --filter better-agentics-scripts build`(設計書 §11)。
- 実行時依存は `@typesafe-ai/sdk` の `0.6.0`(完全一致)だけにする(設計書 §11)。
- 他プラグインの `src/` を import しない。agent-policy・jevriel のコードは読んで書き直す(設計書 §2-3)。
- スキル・`references/`・`assets/` の本文に、他プラグインの名前を書かない(設計書 §2-3)。例外は設計書 §5-3 の「agent-policy の『文書の執筆を委譲するとき』と同じ規律」で、これは規律の本文を書き写し、出典名は書かない。
- 環境変数名は `AMATSUKA_AGENT_ENABLE_ORCHESTRATION`(設計書 §8-1)。マーカーのキーは `better-agentics-role`、ハッシュの記録のキーは `better-agentics-hash`(設計書 §9-3、§10)。
- 定義の作成先は `<project>/.claude/agents/<name>.md`。翻訳断片の置き場は `<project>/.claude/better-agentics/roles/<lang>/`(設計書 §4-2)。
- 定義名は `^[a-z0-9]+(?:-[a-z0-9]+)*$` に合うものだけを受け付ける。
- テストは対象ソースと同じディレクトリの `__test__/<対象ファイル名>.test.ts` に置く。固定データは `src/fixtures/`、子プロセスのエントリと偽のバイナリは `src/testing/` に置く(testing-policy)。
- `plugins/better-agentics/scripts/` は手で編集しない。`src/` を変えたタスクは `pnpm --filter better-agentics-scripts build` を実行し、`scripts/` の差分を同じコミットに入れる。
- ブランチを切らず、main で作業する。タスクごとにコミットする。コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける。

## Review Focus

設計書が直接は書いていないが、利用者が踏みやすい入力と、そのときに期待される振る舞い。各行のテストは担当タスクに入れてある。

1. `TYPESAFE_API_KEY` が空白だけ — キーが無いものとして扱う。SessionStart は `no-api-key` の警告を出し、`pick-delegate` は Jev が要る場面で `no-api-key` を返す(T6・T7)。
2. `## When to invoke` 見出しが無い定義と、2 回ある定義 — 無いなら基準を空文字にして候補に残し、2 回あるなら最初の見出しの配下だけを使う(T5)。
3. ファイル名と `name` が違う定義 — SubagentStart は入力の `agent_type` を `name` と突き合わせ、ファイル名とは突き合わせない。`pick-delegate` が返す `agent` も `name` の値にする(T5・T6・T7)。
4. `split` の `tasks` が空配列、または `id` が重複する — `invalid-input` を返し、Jev を呼ばない(T7)。
5. `tools` を block 配列(`tools:` の次行から `- Read`)で書いた定義 — 走査は配列として読む。`--prune-tools` は書き換えず、点検の結果で `toolsFormat: "other"` として報告する(T5・T8)。

---

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`、`.claude/rules/metatron/` の 3 ファイル。新しいプラグインの追加は ARCHITECTURE の記述(ディレクトリ構成は `plugins/<plugin>/` の一般形で書かれている)を変えない見込みである。変更が要ると気付いたら、修正せず報告する。
- 他プラグインのファイル。agent-policy と jevriel は読むだけにする。
- `tsconfig.json`・`vitest.config.ts`・`biome.json`。既存の glob(`plugins/*/src/**/*.ts`、`plugins/**/__test__/**/*.test.ts`)が better-agentics を含む。
- `.serena/memories/`、`.raphael/`。
- 本件と無関係な未コミット変更(計画立案時点で `.claude/settings.json`)。触らず、revert もしない。

## 1. 共通の進め方

- 各タスクは TDD で進める。失敗するテストを書く → 失敗を確かめる → 実装する → パスを確かめる → コミットする。
- 1 タスクの完了条件は、そのタスクのテストと `pnpm run typecheck`・`pnpm run lint` が通ること。計画書のコード例は 80 文字の行幅に収めていないので、lint の前に `pnpm run lint:fix` で整形する。最後のタスク(T11)で `pnpm run test` 全体と `pnpm run build` を通す。
- AI が読む Markdown(`skills/**/SKILL.md`・`references/*.md`・`assets/**/*.md`・`harness-docs/**/*.md`)を書く前に、`prompt-smith:prompt-smith` を起動して規律に従う。SKILL.md の frontmatter と description は `prompt-smith:skill-creator` で書く。
- テストの定義ファイルは一時ディレクトリ(`fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))`)に作り、`afterEach` で消す。
- hook と CLI のテストは `src/testing/run-ts.ts` の `runTs` で子プロセスとして起動する。環境変数は `process.env` から `AMATSUKA_AGENT_` で始まるキーと `TYPESAFE_API_KEY`・`CLAUDE_PROJECT_DIR` を消した上で、テストごとに足す。

## 2. ファイル構成

```
plugins/better-agentics/
├── .claude-plugin/plugin.json        T1
├── package.json                      T1
├── build.ts                          T1(entryPoints は T6・T7・T8 で足す)
├── hooks/hooks.json                  T6
├── skills/orchestration/SKILL.md     T10
├── skills/setup/SKILL.md             T10
├── references/subagent-policy.md     T6
├── assets/roles/{ja,en}/             T3(_common.md + 13 役割)
├── src/
│   ├── lib/roles.ts                  T1 役割表
│   ├── lib/document.ts               T2 frontmatter と本文の分解・組み立て
│   ├── lib/hash.ts                   T2 ハッシュと better-agentics-hash の符号化
│   ├── lib/fragments.ts              T3 断片の読み込み・翻訳断片の点検と雛形
│   ├── lib/compose.ts                T4 1 役割の定義の合成
│   ├── lib/agents.ts                 T5 定義の走査・When to invoke の抽出・点検
│   ├── lib/state.ts                  T6 環境変数の状態判定(hook 2 本で共用)
│   ├── lib/jev.ts                    T7 Jev 呼び出し
│   ├── lib/pick.ts                   T7 委譲先の決定(Jev を差し替え可能)
│   ├── lib/mcp.ts                    T8 claude mcp list の解析
│   ├── lib/regenerate.ts             T9 4 分類と再生成の合成
│   ├── hooks/session-start.ts        T6
│   ├── hooks/subagent-start.ts       T6
│   ├── pick-delegate.ts              T7
│   ├── setup.ts                      T8・T9
│   ├── fixtures/project/.claude/agents/   T5
│   └── testing/run-ts.ts, fake-claude.mjs   T1・T8
├── scripts/                          ビルド出力
├── docs/rationale.md                 T11
└── README.md                         T11
```

## 3. タスク間の契約

後のタスクが使う名前と型を、ここで固定する。実装者は自分のタスクのセクションと §3 だけを読めば、隣のタスクの名前が分かる。

### 3-1. `src/lib/roles.ts`(T1)

```ts
export type RoleId =
  | "complex-impl" | "normal-impl" | "light-impl" | "general" | "explore"
  | "realtime-research" | "e2e-verify" | "escalation" | "design-review"
  | "knowledge-elicitation" | "code-review" | "complex-review" | "adversarial-review"
export type RoleKind = "impl" | "readonly"
export type Reason = "review" | "split" | "stuck"
export type ClaudeModel = "sonnet" | "opus" | "haiku" | "fable"
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

export interface Role {
  id: RoleId
  label: string          // 日本語の役割名(設計書 §4-1 の「役割名」列)
  kind: RoleKind
  model: ClaudeModel     // 推奨モデル
  effort: Effort         // 推奨モデルのときの effort
  reason: Reason
}

export const ROLES: readonly Role[]          // 並びは設計書 §4-1 の表の順
export const CLAUDE_MODELS: readonly ClaudeModel[]  // ["sonnet", "opus", "haiku", "fable"]
export const EFFORTS: readonly Effort[]      // ["low", "medium", "high", "xhigh", "max"]
export function roleById(id: string): Role | undefined
export function rolesFor(reason: Reason): Role[]
export function isClaudeModel(value: string): value is ClaudeModel
export function isEffort(value: string): value is Effort
```

### 3-2. `src/lib/document.ts` と `src/lib/hash.ts`(T2)

```ts
// document.ts
export interface Document {
  order: string[]                 // frontmatter のキーの出現順
  meta: Map<string, string>       // block 値は "\n" から始まる値として丸ごと保つ
  preamble: string                // frontmatter の後から最初の "## " 見出しの前まで(trim 済み)
  sections: Map<string, string>   // キーは見出し行("## When to invoke")、値は本文(trim 済み)
}
export function parseDocument(content: string): Document
export function render(document: Document): string
export function sectionBody(body: string, heading: string): string | undefined  // 最初に現れた見出しの配下
export function duplicateHeadings(content: string): string[]  // 本文に 2 回以上現れる "## " 見出し行

// hash.ts
export function textHash(text: string): string    // sha256(text.trim()) の先頭 16 桁の hex
export function bodyHash(content: string): string // frontmatter を除いた本文の textHash
export interface HashRecord {
  description?: string
  preamble?: string
  sections: Record<string, string>  // キーは見出し行
}
export function encodeRecord(record: HashRecord): string
export function decodeRecord(value: string | undefined): HashRecord | undefined  // 壊れていれば undefined
```

`better-agentics-hash` の値は、`HashRecord` の JSON を base64url で符号化した 1 行とする(設計書 §16 の未解決事項 1 の確定)。base64url の文字(`A-Z a-z 0-9 - _`)は `:` を含まないので、最初の `: ` で分ける `parseDocument` でも、最初の `:` で分ける走査(T5)でも値が壊れない。見出しに日本語や空白を含んでも影響しない。

```ts
export function encodeRecord(record: HashRecord): string {
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64url")
}

export function decodeRecord(value: string | undefined): HashRecord | undefined {
  if (value === undefined || value.trim() === "") return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8"))
    if (typeof parsed !== "object" || parsed === null) return undefined
    if (typeof parsed.sections !== "object" || parsed.sections === null) return undefined
    return parsed as HashRecord
  } catch {
    return undefined
  }
}
```

### 3-3. `src/lib/fragments.ts`(T3)

```ts
export interface Fragment {
  id: RoleId
  label: string
  description: string
  defaultName: string
  tools: string[]
  kind: RoleKind
  sections: Map<string, string[]>   // キーは見出し行、値は trim 済みの行
}
export interface Vocabulary {
  bodyOrder: string[]          // ja: ["## When to invoke", "## Core Responsibilities", "## 作業手順", "## 制約", "## Output Format"]
                               // en: ["## When to invoke", "## Core Responsibilities", "## Procedure", "## Constraints", "## Output Format"]
}
export function vocabularyFor(lang: string): Vocabulary   // ja 以外は en
export function loadFragments(pluginRoot: string, projectDir: string, lang: string): Map<RoleId, Fragment>
export function loadPreamble(pluginRoot: string, projectDir: string, lang: string): string[]  // _common.md の "## Preamble"
export interface FragmentStatus { lang: string; targetDir: string | null; missing: string[]; stale: string[]; ready: string[] }
export function checkFragments(pluginRoot: string, projectDir: string, lang: string): FragmentStatus
export function scaffoldFragments(pluginRoot: string, projectDir: string, lang: string): string[]  // 書いたファイルの絶対パス
export function pluginRoot(): string  // CLAUDE_PLUGIN_ROOT があればそれ。無ければ、このファイルのディレクトリから親へたどり、.claude-plugin/plugin.json を持つ最初のディレクトリ
```

- `lang` が `ja` / `en` のときは、同梱の `assets/roles/<lang>/` だけを読む。
- それ以外の `lang` は、同梱の `en` を読んだ上で、`<project>/.claude/better-agentics/roles/<lang>/` の同名ファイルで置き換える。ただし `## When to invoke` は置き換えず、同梱の `en` の値を使う(設計書 §4-2・§9-2 ステップ 4。翻訳で基準が変わらないことを CLI で保証する)。
- プロジェクト独自の断片の層(agent-policy の `.claude/agent-policy/roles/<RoleId>.md`)は持たない(設計書 §13)。

### 3-4. `src/lib/compose.ts`(T4)

```ts
export interface ComposeInput {
  name: string
  roleId: RoleId
  model: ClaudeModel
  effort: Effort | undefined     // undefined なら effort 行を書かない
  lang: string
  pluginRoot: string
  projectDir: string
  mcpTools: string[]             // "mcp__<server>" の完成した名前。tools の末尾に足す
  denyTools: string[]            // 空でなければ disallowedTools 行を書く
}
export function compose(input: ComposeInput): string
export const ROLE_KEY = "better-agentics-role"
export const HASH_KEY = "better-agentics-hash"
```

### 3-5. `src/lib/agents.ts`(T5)

```ts
export type ToolsFormat = "csv" | "other" | "none"
export interface Definition {
  file: string            // ファイル名から .md を除いた値
  name: string            // frontmatter の name。無ければ file
  role: string            // better-agentics-role の値(trim 済み)
  model: string | undefined
  effort: string | undefined
  tools: string[] | undefined   // undefined は tools 欄が無いか解釈できない
  toolsFormat: ToolsFormat
  whenToInvoke: string    // "## When to invoke" の配下。無ければ ""
}
export function projectDirOf(env: NodeJS.ProcessEnv, fallback: string): string  // CLAUDE_PROJECT_DIR が空でなければそれ、無ければ fallback
export function scanDefinitions(projectDir: string): Definition[]  // better-agentics-role を持つ定義だけ。file の昇順。読めない定義は飛ばす
export interface Inspection {
  known: Definition[]                                   // role が役割表にある定義
  unknownRoles: { file: string; name: string; role: string }[]
  duplicates: { role: RoleId; names: string[] }[]       // 2 件以上の定義が持つ役割。並びは ROLES の順
}
export function inspect(definitions: Definition[]): Inspection
```

### 3-6. `src/lib/state.ts`(T6)

```ts
export type OrchestrationState =
  | { kind: "off" }
  | { kind: "unknown-value"; value: string }
  | { kind: "conflict-injection" }
  | { kind: "conflict-gate" }
  | { kind: "no-api-key" }
  | { kind: "inject" }
export function orchestrationState(env: NodeJS.ProcessEnv): OrchestrationState
export function hasApiKey(env: NodeJS.ProcessEnv): boolean   // TYPESAFE_API_KEY を trim して空でない
// SubagentStart が注入するのは inject と no-api-key のとき(設計書 §8-2「キーの有無は問わない」)
export function subagentPolicyApplies(state: OrchestrationState): boolean
```

判定の順は設計書 §8-1 の表のとおりで、最初に当たった行で決める。

```ts
const ON = new Set(["1", "true", "on"])
const OFF = new Set(["", "0", "false", "off"])

export function orchestrationState(env: NodeJS.ProcessEnv): OrchestrationState {
  const value = env.AMATSUKA_AGENT_ENABLE_ORCHESTRATION?.trim().toLowerCase() ?? ""
  if (OFF.has(value)) return { kind: "off" }
  if (!ON.has(value)) return { kind: "unknown-value", value }
  const injection = env.AMATSUKA_AGENT_AUTO_INJECTION?.trim().toLowerCase() ?? ""
  if (injection !== "" && injection !== "none") return { kind: "conflict-injection" }
  const gate = env.AMATSUKA_AGENT_DELEGATION_GATE?.trim().toLowerCase() ?? ""
  if (ON.has(gate)) return { kind: "conflict-gate" }
  if (!hasApiKey(env)) return { kind: "no-api-key" }
  return { kind: "inject" }
}
```

### 3-7. `src/lib/jev.ts` と `src/lib/pick.ts`(T7)

```ts
// jev.ts
import type { EntryType, Questions, SystemOneResult } from "@typesafe-ai/sdk"
export interface JevRequest { state: EntryType; questions: Questions }
export type JevAsk = (request: JevRequest) => Promise<SystemOneResult<Questions>>
export function createJevAsk(apiKey: string): JevAsk

// pick.ts
export type PickInput =
  | { reason: "review"; task: { summary: string; artifacts: string[] } }
  | { reason: "split"; tasks: { id: string; summary: string }[] }
  | { reason: "stuck"; task: { summary: string } }
export interface Pick { agent: string; role: RoleId; p?: number }   // p は Jev を呼んだときだけ付く
export type PickError = "invalid-input" | "no-candidates" | "duplicate-role" | "no-api-key" | "jev-failed"
export type PickOutput =
  | { ok: true; reason: "review"; agents: Pick[]; fallback?: true }
  | { ok: true; reason: "split"; assignments: (Pick & { id: string })[] }
  | { ok: true; reason: "stuck"; agents: Pick[] }
  | { ok: false; error: PickError; message: string }
export interface PickDeps {
  definitions: Definition[]
  apiKey: string | undefined          // trim 済みで空なら undefined
  createAsk: (apiKey: string) => JevAsk
}
export function parseInput(raw: string): PickInput   // 失敗時は PickFailure("invalid-input", ...) を投げる
export class PickFailure extends Error { constructor(readonly error: PickError, message: string) }
export async function pickDelegate(raw: string, deps: PickDeps): Promise<PickOutput>  // 例外を投げず、失敗は ok: false で返す
```

### 3-8. setup の CLI の応答(T8・T9)

```ts
// --list-coverage
interface CoverageResult {
  ok: true
  roles: { id: RoleId; label: string; kind: RoleKind; reason: Reason; model: ClaudeModel; effort: Effort; defaultName: string; coveredBy: string[] }[]  // coveredBy は定義の file
  uncovered: RoleId[]
  definitions: { file: string; name: string; role: string; model: string | null; effort: string | null; known: boolean; disallowedTools: string[]; toolsFormat: ToolsFormat }[]
  duplicates: { role: RoleId; files: string[] }[]
  unknownRoles: { file: string; role: string }[]
}

// --check / --write
type SectionState = "same" | "unknown" | "templateChanged" | "userEdited" | "new" | "extra"
interface SectionReport {
  key: string                // "description" / "preamble" / 見出し行("## When to invoke")
  state: SectionState
  existing?: string          // unknown・templateChanged・userEdited のときだけ
  template?: string          // 同上
}
interface CheckResult {
  ok: true
  target: string             // プロジェクトルートからの相対パス(".claude/agents/<name>.md")
  exists: boolean
  adopt: boolean             // 既存のファイルに better-agentics-role が無い(設計書 §9-2 ステップ 6 の取り込み)
  sections: SectionReport[]
  keysKept: string[]         // CLI が生成しないキーのうち保持するもの
  mcpCurrent: { servers: string[]; denyTools: string[] }
  effort: Effort | null      // 書き込む effort。書かないなら null
}
interface WriteResult {
  ok: true
  target: string
  action: "written" | "regenerated" | "adopted"
  kept: string[]             // 保持したセクションのキー("extra" を含む)
  replaced: string[]         // テンプレートに置き換えたセクションのキー
  keysKept: string[]
  toolsAfter: string[]
  mcpDropped: string[]       // --mcp-servers のうち使えなかったサーバー
}
// --list-mcp
interface McpListResult { ok: true; servers: { name: string; status: string; usable: boolean }[] }
// --check-fragments
interface FragmentCheckResult { ok: true; lang: string; targetDir: string | null; missing: string[]; stale: string[]; ready: string[] }
// --scaffold-fragments
interface ScaffoldResult { ok: true; lang: string; written: string[] }   // プロジェクトルートからの相対パス
// --prune-tools
interface PruneResult { ok: true; target: string; changed: boolean; warnings: string[]; toolsBefore: string[]; toolsAfter: string[] }
// --rewrite-roles
interface RewriteResult { ok: true; target: string; changed: boolean; before: string | null; after: string | null }  // マーカーの値。行を消したら after は null

// 失敗はすべて { ok: false, error: string }。終了コードは 1
```

---

## 4. タスク

### T1: パッケージの骨組みと役割表

設計書 §3-1・§4-1・§11。

**Files:**
- Create: `plugins/better-agentics/package.json`
- Create: `plugins/better-agentics/.claude-plugin/plugin.json`
- Create: `plugins/better-agentics/build.ts`
- Create: `plugins/better-agentics/src/lib/roles.ts`
- Create: `plugins/better-agentics/src/testing/run-ts.ts`
- Modify: `pnpm-workspace.yaml`(`plugins/native-japanese` の次に `plugins/better-agentics` を足す)
- Test: `plugins/better-agentics/src/lib/__test__/roles.test.ts`

**Interfaces:**
- Produces: §3-1 のすべて。`runTs(script: string, args?: string[], opts?: ExecFileSyncOptions): string`

- [ ] **Step 1: 骨組みを作る**

`package.json`:

```json
{
  "name": "better-agentics-scripts",
  "version": "0.0.1-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" },
  "dependencies": { "@typesafe-ai/sdk": "0.6.0" }
}
```

`.claude-plugin/plugin.json`:

```json
{
  "name": "better-agentics",
  "description": "オーケストレーターが調査・設計・実装を自分で行い、レビュー・分担・行き詰まりのときだけサブエージェントへ委譲するエージェント運用方針。委譲先は TypeSafe AI の判断モデル Jev が、各 Agent 定義の選択基準をもとに選ぶ。",
  "version": "0.0.1-dev"
}
```

`build.ts`(entryPoints は後のタスクで足す):

```ts
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {},
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22",
  // SDK は例外の名前を new.target.name で決めるため、クラス名の改名を防ぐ
  keepNames: true
})
```

`src/testing/run-ts.ts` は `plugins/agent-policy/src/testing/run-ts.ts` と同じ内容で書く(17 行。import はしない)。

- [ ] **Step 2: `pnpm install` を実行し、`pnpm-lock.yaml` に `@typesafe-ai/sdk` が `plugins/better-agentics` の依存として載ったことを確かめる**

- [ ] **Step 3: 失敗するテストを書く**

```ts
import { describe, expect, it } from "vitest"
import { CLAUDE_MODELS, ROLES, roleById, rolesFor } from "../roles"

describe("ROLES", () => {
  it("設計書 §4-1 の 13 役割を表の順に持つ", () => {
    expect(ROLES.map((role) => role.id)).toEqual([
      "complex-impl", "normal-impl", "light-impl", "general", "explore",
      "realtime-research", "e2e-verify", "escalation", "design-review",
      "knowledge-elicitation", "code-review", "complex-review", "adversarial-review"
    ])
  })

  it("model・effort・reason・kind が表の値と一致する", () => {
    expect(roleById("knowledge-elicitation")).toMatchObject({ kind: "readonly", model: "haiku", effort: "low", reason: "review" })
    expect(roleById("escalation")).toMatchObject({ kind: "impl", model: "fable", effort: "high", reason: "stuck" })
    expect(roleById("e2e-verify")).toMatchObject({ kind: "impl", model: "sonnet", effort: "high", reason: "split" })
  })

  it("理由ごとの役割を返す", () => {
    expect(rolesFor("review").map((role) => role.id)).toEqual([
      "design-review", "knowledge-elicitation", "code-review", "complex-review", "adversarial-review"
    ])
    expect(rolesFor("stuck").map((role) => role.id)).toEqual(["escalation"])
    expect(rolesFor("split")).toHaveLength(7)
  })

  it("未知の ID は undefined", () => {
    expect(roleById("final-review")).toBeUndefined()
    expect(CLAUDE_MODELS).toEqual(["sonnet", "opus", "haiku", "fable"])
  })
})
```

- [ ] **Step 4: `pnpm vitest run plugins/better-agentics/src/lib/__test__/roles.test.ts` で失敗を確かめる**(モジュールが無い)

- [ ] **Step 5: `roles.ts` を §3-1 の型で実装する。13 行の値は設計書 §4-1 の表から写す**

- [ ] **Step 6: テスト・`pnpm run typecheck`・`pnpm run lint` を通す。`pnpm-workspace.yaml` を変えたので、protected-paths の手順どおり `pnpm run build`(全体)が通ることも確かめる**(esbuild 0.28 は空の `entryPoints` で正常に終わることを計画立案時に確かめてある)

- [ ] **Step 7: コミットする**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml plugins/better-agentics
git commit -m "feat(better-agentics): パッケージの骨組みと役割表を追加する"
```

### T2: 文書の分解とハッシュの記録

設計書 §9-3、§16(ハッシュの書式)。

**Files:**
- Create: `plugins/better-agentics/src/lib/document.ts`
- Create: `plugins/better-agentics/src/lib/hash.ts`
- Test: `plugins/better-agentics/src/lib/__test__/document.test.ts`、`hash.test.ts`

**Interfaces:**
- Produces: §3-2 のすべて

- [ ] **Step 1: 失敗するテストを書く。次のケースを入れる**

`document.test.ts`:
- frontmatter のキーの順と値を読む。`description: a: b` の値は `a: b` になる(最初の `: ` で分ける)。
- `hooks:` のような block 値は、字下げされた後続行を含めて 1 つの値として保ち、`render` で元の行に戻る。
- 前置き(最初の `## ` 見出しの前)と各セクションの本文を trim して読む。
- `render(parseDocument(x))` は、frontmatter・前置き・セクションの順と本文を保つ(空行の数は正規化してよい)。
- `sectionBody` は同じ見出しが 2 回あるとき最初の配下だけを返し、見出しが無ければ `undefined` を返す(Review Focus 2)。
- `duplicateHeadings` は、`## When to invoke` が 2 回ある本文で `["## When to invoke"]` を返し、重複が無ければ `[]` を返す。

`hash.test.ts`:
- `textHash(" a \n")` と `textHash("a")` が等しく、16 桁の hex である。
- `bodyHash` は frontmatter の違いを無視する。
- `encodeRecord` → `decodeRecord` の往復で、`sections` のキー `"## 作業手順"` と `"## When to invoke"` を含む記録が元に戻る。
- 符号化した値は `/^[A-Za-z0-9_-]+$/` に合い、`:` を含まない。
- その値を `better-agentics-hash: <値>` として埋めた frontmatter を `parseDocument` で読み戻すと、同じ値が得られる。
- `decodeRecord("not-base64")`、`decodeRecord("")`、`decodeRecord(undefined)`、`sections` が無い JSON の符号化は、どれも `undefined` を返す。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

`document.ts` の `parseDocument` と `render` は、agent-policy の `src/setup-agents.ts:147-197`(`parseDocument`)と `:645-661`(`render`)を出発点にし、`sectionBody` を足す。`hash.ts` は §3-2 のコードと、agent-policy の `src/agents/hash.ts` の `textHash`・`bodyHash` を書き直したものにする。

- [ ] **Step 4: テスト・typecheck・lint を通す**

- [ ] **Step 5: コミットする**(`feat(better-agentics): 文書の分解とハッシュの記録を追加する`)

### T3: 役割断片と読み込み

設計書 §4-2、§9-2 ステップ 4、§16(断片の変更点)。

**Files:**
- Create: `plugins/better-agentics/assets/roles/ja/_common.md` と 13 役割の `<RoleId>.md`
- Create: `plugins/better-agentics/assets/roles/en/_common.md` と 13 役割の `<RoleId>.md`
- Create: `plugins/better-agentics/src/lib/fragments.ts`
- Test: `plugins/better-agentics/src/lib/__test__/fragments.test.ts`

**Interfaces:**
- Consumes: `RoleId`・`RoleKind`(T1)、`bodyHash`(T2)
- Produces: §3-3 のすべて

- [ ] **Step 1: `prompt-smith:prompt-smith` を起動する**

- [ ] **Step 2: 断片を書く**

agent-policy の `assets/roles/{ja,en}/<RoleId>.md` を写し、次の変更を当てる。`realtime-research.grok.md` は写さない。frontmatter は、(5) の `description` の書き換えを除き、`id`・`label`・`description`・`default-name`・`tools`・`kind` を変えない。

(1) `_common.md`(ja・en)。`## 制約` / `## Constraints` を消し(T6 の subagent-policy へ移る)、`## Preamble` を次にする。

- ja: `あなたは {{NAME}}。担う役割は{{ROLE_LABEL}}である。`
- en: `You are {{NAME}}. Your role is {{ROLE_LABEL}}.`

(2) `## When to invoke` を、ja・en のどちらの断片でも次の英語にする。agent-policy の英語から、ベンダーの区別と、他の実装役割からの差し戻しへの言及を外したものである。

| RoleId | When to invoke(本文に載せる) |
| --- | --- |
| complex-impl | `- Use when the work requires non-obvious design decisions.` / `- Use when the specification is complex or ambiguous.` / `- Use when verifying the result is difficult.` |
| normal-impl | `- Use for most implementation whose specification and design are settled.` / `- Use when writing tests.` |
| light-impl | `- Use for routine changes.` / `- Use for bulk mechanical changes across many files.` / `- Use for clear minor changes.` / `- Use when the result can be verified mechanically.` |
| general | `- Use for work that is not implementation, review, exploration, or research and needs no specialized expertise.` / `- Use to write documents within the requested scope.` / `- Use for routine repository maintenance.` |
| explore | `- Use when the task is to find facts in a specified part of the codebase and report them without changing files.` |
| realtime-research | `- Use when the primary purpose is to access current external information about developments, releases, or external ecosystems.` |
| e2e-verify | `- Use when the task requires starting the application and verifying behavior through browser or GUI operation.` |
| escalation | `- Use when the same failure reproduces after two different fixes.` / `- Use when the cause cannot be narrowed down to one candidate.` / `- Use when a design premise has collapsed and redesign is needed.` |
| design-review | `- Use to test the premises, implicit assumptions, and optimistic estimates in a design document or implementation plan and present counterevidence.` / `- Do not use for code diffs.` |
| knowledge-elicitation | `- Use when a document, instruction, or specification will be read and followed by someone else, to restate it and surface implicit knowledge, contradictions, and gaps.` / `- Does not judge whether the content is correct.` |
| code-review | `- Use when reading a change diff and identifying defects, convention violations, or design concerns.` / `- Do not use for documents that contain no code changes.` |
| complex-review | `- Use only for critical implementations or high-risk design documents.` / `- Use after a critical implementation is complete to make a final check of the diff against the design intent.` / `- Use to decide whether implementation may begin for a high-risk design document.` |
| adversarial-review | `- Use only when a failure of the deliverable would be costly and it needs a deliberate search for failure paths and reproducible counterexamples.` / `- Unlike design review, which tests the premises of design documents, it targets any deliverable and focuses on how it can fail.` / `- Unlike complex review, it reports counterexamples without deciding whether the deliverable is ready.` |

表の ` / ` は箇条書きの区切りで、1 項目を 1 行に書く。

(3) レビュー役割の `## Output Format` に重大度を足す(設計書 §4-2)。

| RoleId | ja | en |
| --- | --- | --- |
| design-review | 「指摘ごとに次を書く。」の箇条の先頭に `- 重大度(critical / high / medium / low のどれか)` | 同じ位置に `- Severity: one of critical, high, medium, or low.` |
| code-review | 1 行目を `- 指摘ごとに、重大度(critical / high / medium / low のどれか)・ファイルパス・行番号・問題・修正案` | 1 行目を `- For each finding, provide the severity (one of critical, high, medium, or low), the file path, line number, problem, and proposed fix.` |
| complex-review | 1 行目を `- 指摘ごとの重大度(critical / high / medium / low のどれか)・根拠(ファイルパス・行番号)・問題・修正案` | 1 行目を `- For each finding, provide the severity (one of critical, high, medium, or low), the evidence (file path and line number), the problem, and the proposed fix.` |
| adversarial-review | 箇条の先頭に `- 反例ごとの重大度(critical / high / medium / low のどれか)` | 先頭に `- Severity of each counterexample: one of critical, high, medium, or low.` |
| knowledge-elicitation | `- 矛盾・不整合(項目ごとに重大度 critical / high / medium / low を付ける)`、`- 記述の過不足(項目ごとに重大度 critical / high / medium / low を付ける)` | `- List contradictions and inconsistencies, each with a severity of critical, high, medium, or low.`、`- Identify omissions and excess detail, each with a severity of critical, high, medium, or low.` |

knowledge-elicitation の「理解した内容」と「暗黙知」には重大度を付けない。

(4) 上記以外のセクション(Core Responsibilities・作業手順・制約・Output Format の残り)は agent-policy の内容のまま写す。

(5) 選択基準を含む `description` を、基準を含まない短い句に書き換える(設計書 §10)。description は Agent 一覧に載り、オーケストレーターの文脈に入るためである。次の 6 役割だけを変え、残りの 7 役割は agent-policy の値のまま使う。

| RoleId | ja | en |
| --- | --- | --- |
| complex-impl | 複雑または重要な実装 | complex or critical implementation |
| normal-impl | 通常の実装 | standard implementation |
| light-impl | 軽量な実装 | lightweight implementation |
| general | 実装・レビュー以外の一般作業 | general work other than implementation and review |
| escalation | 行き詰まりの原因の特定と打開 | identifying and resolving the cause of a blockage |
| realtime-research | 外部の最新情報の調査 | research on current external information |

- [ ] **Step 3: 失敗するテストを書く。次のケースを入れる**

- `loadFragments(root, project, "ja")` と `"en"` が 13 役割を返し、各 `tools` と `kind` が agent-policy の値(T1 の表と同じ種別)と一致する。
- ja・en の全断片で `## When to invoke` の配下が ASCII だけで書かれている(`/^[\x00-\x7F]*$/`)。
- レビュー 5 役割の `## Output Format` の配下に `critical` が含まれ、それ以外の 8 役割の `## Output Format` の配下には含まれない(ファイル全体ではなく、このセクションだけを見る)。
- 全断片の frontmatter の `description` が、(5) の表の値か agent-policy の値のどちらかと一致する。
- `_common.md` に `## 制約` / `## Constraints` が無い。
- 翻訳断片: 一時プロジェクトに `.claude/better-agentics/roles/fr/code-review.md` を置き、`## When to invoke` を別の文に書き換えても、`loadFragments(root, project, "fr")` の `code-review` の When to invoke は同梱 `en` の値になる。`## Core Responsibilities` は翻訳断片の値になる。
- `checkFragments(root, project, "ja")` は `targetDir: null` で `missing` が空。
- `checkFragments(root, project, "fr")` は翻訳断片が無いとき 14 ファイル(`_common` と 13 役割)を `missing` に返す。`scaffoldFragments` の後は `ready` に入る。英語断片の本文を変えた想定で `source-hash` を書き換えると `stale` に入る。
- `scaffoldFragments` は `source-hash` が一致するファイルを上書きしない。

- [ ] **Step 4: 失敗を確かめる**

- [ ] **Step 5: `fragments.ts` を実装する**

agent-policy の `src/agents/fragments.ts` を出発点にし、次の点を変える。

- ベンダー別断片の重ね合わせ(`vendor` 引数・`.grok.md` の読み込み)を外す。
- 廃止 ID の扱い(`isRetiredRole`)を外す。廃止済みの ID はまだ無い(設計書 §2-2)。
- 探索の層は同梱と翻訳の 2 つにする(§3-3)。翻訳の層で置き換えるとき、`## When to invoke` だけは同梱 `en` の値を残す。
- `pluginRoot()` は §3-3 のとおり、`.claude-plugin/plugin.json` を持つディレクトリまで親をたどる。ソースの `src/lib/`・`src/hooks/` から呼んでも、バンドル後の `scripts/` から呼んでも、プラグインのルートを返すためである。
- `scaffoldFragments` は、同梱 `en` の断片を写し、frontmatter の閉じる `---` の直前に `source-lang: en` と `source-hash: <同梱 en の bodyHash>` の 2 行を足す。`source-hash` が一致するファイルは上書きせず、一致しない(stale の)ファイルは英語で上書きする。上書きで既存の訳が失われることは、T10 の setup スキルで利用者に退避を促して扱う(agent-policy と同じ)。

- [ ] **Step 6: テスト・typecheck・lint を通す**

- [ ] **Step 7: コミットする**(`feat(better-agentics): 役割断片と読み込みを追加する`)

### T4: 定義の合成

設計書 §4-1・§4-2・§9-3・§10。

**Files:**
- Create: `plugins/better-agentics/src/lib/compose.ts`
- Test: `plugins/better-agentics/src/lib/__test__/compose.test.ts`

**Interfaces:**
- Consumes: T1〜T3
- Produces: §3-4 のすべて

合成の規則:

- frontmatter は次の順で書く。`name` → `description`(断片の `description` をそのまま。agent-policy の「Use this agent when …」の包みは付けない)→ `model` → `effort`(`undefined` なら書かない)→ `tools`(断片の `tools` に `mcpTools` を足す)→ `disallowedTools`(`denyTools` が空なら書かない)→ `better-agentics-role` → `better-agentics-hash`。`color` は書かない。
- 前置きは `_common.md` の Preamble の `{{NAME}}` を `name` に、`{{ROLE_LABEL}}` を断片の `label` に置き換えたもの。label は括弧で囲まない(設計書 §10 の例 `あなたは code-reviewer。担う役割はコードレビューである。`)。
- 本文のセクションは `vocabularyFor(lang).bodyOrder` の順に、断片にあるものだけを書く。
- `better-agentics-hash` には、`description`・前置き・各セクションの本文の `textHash` を `HashRecord` として書く。キーは `"description"`・`"preamble"`・見出し行である。

- [ ] **Step 1: 失敗するテストを書く。次のケースを入れる**

- `compose({ name: "code-reviewer", roleId: "code-review", model: "sonnet", effort: "high", lang: "ja", ... })` の frontmatter が、§10 の例と同じ順で、`description: 変更差分のレビュー`、`model: sonnet`、`effort: high`、`tools: Read, Grep, Glob, Bash`、`better-agentics-role: code-review` を持つ。
- `effort: undefined` のとき `effort` 行が無い。
- `mcpTools: ["mcp__serena"]`、`denyTools: ["mcp__serena__replace_content"]` のとき、`tools` の末尾に `mcp__serena` があり、`disallowedTools` 行がある。
- 本文の見出しが ja では `## When to invoke` → `## Core Responsibilities` → `## 作業手順` → `## 制約` → `## Output Format` の順に並ぶ。
- `better-agentics-hash` を `decodeRecord` で読むと、`description`・`preamble`・本文の全見出しの `textHash` が、合成した文書を `parseDocument` で読んだ値の `textHash` と一致する。
- 合成した文書に `color` 行が無い。

- [ ] **Step 2〜4: 失敗を確かめ、実装し、テスト・typecheck・lint を通す**

- [ ] **Step 5: コミットする**(`feat(better-agentics): 定義の合成を追加する`)

### T5: 定義の走査と点検

設計書 §7-2・§8-1(添える内容)・§9-2 ステップ 2。

**Files:**
- Create: `plugins/better-agentics/src/lib/agents.ts`
- Create: `plugins/better-agentics/src/fixtures/project/.claude/agents/` 配下の定義ファイル(次のステップで列挙)
- Test: `plugins/better-agentics/src/lib/__test__/agents.test.ts`

**Interfaces:**
- Consumes: `roleById`・`ROLES`(T1)、`sectionBody`(T2)
- Produces: §3-5 のすべて

- [ ] **Step 1: fixtures を作る**

`src/fixtures/project/.claude/agents/` に次の 8 ファイルを置く。テストは `scanDefinitions` に `src/fixtures/project` を渡す。

| ファイル | 内容 |
| --- | --- |
| `code-reviewer.md` | `better-agentics-role: code-review`、`tools: Read, Grep, Glob, Bash`、When to invoke あり |
| `docs-check.md` | `name: docs-reviewer`(ファイル名と違う)、`better-agentics-role: design-review`、When to invoke あり |
| `no-criteria.md` | `better-agentics-role: knowledge-elicitation`、When to invoke 見出しなし |
| `twice.md` | `better-agentics-role: adversarial-review`、When to invoke 見出しが 2 回(1 回目は `- first`、2 回目は `- second`) |
| `block-tools.md` | `better-agentics-role: explore`、`tools:` の次行から `  - Read` `  - Grep` の block 配列 |
| `unknown-role.md` | `better-agentics-role: final-review` |
| `no-tools.md` | `better-agentics-role: general`、tools 行なし |
| `agent-policy-only.md` | `agent-policy-role: code-review` だけ(better-agentics のマーカーなし) |

- [ ] **Step 2: 失敗するテストを書く。次のケースを入れる**

- `scanDefinitions` は fixtures のうち `agent-policy-only` を除く 7 件を、`file` の昇順で返す。
- `docs-check` の `name` は `docs-reviewer`、`file` は `docs-check`(Review Focus 3)。
- `no-criteria` の `whenToInvoke` は `""`、`twice` は `- first`(Review Focus 2)。
- `block-tools` の `tools` は `["Read", "Grep"]`、`toolsFormat` は `"other"`。`code-reviewer` は `"csv"`(Review Focus 5)。`no-tools` は `"none"` で `tools` が `undefined`。
- `inspect` は `unknown-role` を `unknownRoles` に入れ、`known` に入れない。
- 一時ディレクトリに `code-review` の定義を 2 件置くと、`duplicates` に `{ role: "code-review", names: [...] }` が入る。
- `.claude/agents` が無いプロジェクトでは `[]` を返し、例外を投げない。
- 読めないファイル(frontmatter が閉じていない)は飛ばし、他の定義は返す。
- `projectDirOf({ CLAUDE_PROJECT_DIR: "/a" }, "/b")` は `/a`、`CLAUDE_PROJECT_DIR` が空なら `/b`。

- [ ] **Step 3〜5: 失敗を確かめ、実装し、テスト・typecheck・lint を通す**

frontmatter の読み取りは agent-policy の `src/hooks/marker-scan.ts` の `frontmatter` と `parseToolsField` を出発点にする。`toolsFormat` の判定は agent-policy の `setup-agents.ts:1198-1227`(`toolsFormatOf` と、同じキーが複数行あるときの扱い)を写す。

- [ ] **Step 6: コミットする**(`feat(better-agentics): 定義の走査と点検を追加する`)

### T6: hook 2 本とサブエージェントの規律

設計書 §6・§8。

**Files:**
- Create: `plugins/better-agentics/src/lib/state.ts`
- Create: `plugins/better-agentics/src/hooks/session-start.ts`
- Create: `plugins/better-agentics/src/hooks/subagent-start.ts`
- Create: `plugins/better-agentics/references/subagent-policy.md`
- Create: `plugins/better-agentics/hooks/hooks.json`
- Modify: `plugins/better-agentics/build.ts`(entryPoints に `"session-start": "./src/hooks/session-start.ts"` と `"subagent-start": "./src/hooks/subagent-start.ts"` を足す)
- Test: `plugins/better-agentics/src/lib/__test__/state.test.ts`、`src/hooks/__test__/session-start.test.ts`、`src/hooks/__test__/subagent-start.test.ts`

**Interfaces:**
- Consumes: `scanDefinitions`・`inspect`・`projectDirOf`(T5)、`roleById`(T1)、`pluginRoot`(T3)
- Produces: §3-6 のすべて

- [ ] **Step 1: `prompt-smith:prompt-smith` を起動し、`references/subagent-policy.md` を書く**

内容は次のとおりにする(本文に載せる)。見出しと箇条の並びは prompt-smith の規律で整えてよいが、項目を足し引きしない。

```markdown
# サブエージェントの規律

あなたはメインオーケストレーターから起動されたサブエージェントである。依頼文の冒頭に書かれた役割で作業する。

## 確かめ方

- 依頼文に書かれた事項は、依頼文から確認する。
- Read・Grep で確かめられる事実は、自分で確かめる。
- オーケストレーターから探索結果を渡されたときは、それを出発点にし、実際のコードと食い違いがあれば報告する。

## 差し戻す場面

次のどれかに当たったら、作業を止めてオーケストレーターへ差し戻す。

- 依頼文に無い判断が必要で、選択肢が複数あり、選択により成果物の構造(インターフェース・ファイル配置・依存関係)が変わる。
- 依頼文と実コードが食い違い、どちらに合わせるかを依頼文から決められない。
- テスト・型検査の失敗を再現しても、複数の原因候補を 1 つに絞れない。
- 自分の役割に含まれない作業、または作業範囲の拡大が要る作業である。
- 依頼文に書かれた書き込み範囲の外のファイルを変更する必要がある。

## 作業の範囲

- 依頼文に書かれた書き込み範囲の外のファイルを変更しない。
- 依頼文で指示された変更範囲の検査だけを実行する。
- ビルド出力・lockfile を書き換えるコマンド、lint の自動修正、git commit は、依頼文で指示されたときだけ実行する。
- 変更範囲の外が原因の失敗は直さず、出力をそのまま報告する。
- 外部システムへの不可逆な副作用(公開・投稿・送信・書き込み)は行わず、必要ならオーケストレーターへ報告する。
- 命名・表記・並び順は、既存パターンに合わせる。

## スキル

- Skill ツールでは、依頼文で名指しされたスキルだけをロードする。スキルの description が作業に当てはまっても、名指しが無ければロードせず、依頼文の記述だけで作業する。
- 名指しされていないスキルが必要だと判断したときは、その旨を報告して差し戻す。

## 依頼文の例の扱い

- 依頼文にある語や文の例のうち「本文に載せる」と添えられていないものは、依頼の意図の説明として読む。成果物の本文には写さず、自分で選んだ言葉で書く。
- 「本文に載せる」と添えられた例を成果物へ書くときは、閉じた列挙にせず、判断の軸とともに書く。
```

- [ ] **Step 2: `hooks/hooks.json` を書く**

```json
{
  "description": "better-agentics: SessionStart でオーケストレーターの規律の使用指示を注入し、SubagentStart で better-agentics の定義にサブエージェントの規律を注入する。どちらも AMATSUKA_AGENT_ENABLE_ORCHESTRATION が有効なときだけ働く",
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs\"", "timeout": 10 }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/subagent-start.mjs\"", "timeout": 10 }] }
    ]
  }
}
```

- [ ] **Step 3: 失敗するテストを書く**

`state.test.ts`(§3-6 の判定順):
- 未設定・`""`・`"0"`・`" FALSE "`・`"off"` → `off`。
- `"yes"` → `unknown-value`(`value: "yes"`)。
- `"1"` + `AMATSUKA_AGENT_AUTO_INJECTION=claude` → `conflict-injection`。`AMATSUKA_AGENT_AUTO_INJECTION=none` と `""` は衝突にしない。
- `"on"` + `AMATSUKA_AGENT_DELEGATION_GATE=true` → `conflict-gate`。
- `"true"` + `TYPESAFE_API_KEY="   "` → `no-api-key`(Review Focus 1)。
- `"true"` + `TYPESAFE_API_KEY=k` → `inject`。
- `"yes"` と `AMATSUKA_AGENT_AUTO_INJECTION=claude` の組は `unknown-value`(上の行が先に当たる)。
- `subagentPolicyApplies` は `inject` と `no-api-key` だけ真。

`session-start.test.ts`(`runTs` で `src/hooks/session-start.ts` を起動。stdin に `{"cwd": "<project>"}` を渡す):
- `off` では標準出力が空。
- `unknown-value`・`conflict-injection`・`conflict-gate`・`no-api-key` では、`additionalContext` が警告の 1 文だけで、`better-agentics:orchestration` を含まない。
- `inject` では `additionalContext` が `最初に better-agentics:orchestration スキルを使用する。スキルの規律に従う。` で始まる。
- `inject` で定義が 0 件なら setup の案内(`better-agentics:setup`)を添える。
- `inject` で同じ役割の定義が 2 件あれば、役割名と定義名を並べて setup を案内する。
- `inject` で役割表に無い role-id の定義があれば、定義名と role-id を並べる。
- `CLAUDE_PROJECT_DIR` があれば、stdin の `cwd` より優先して走査する。
- 出力は `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":...}}` の 1 行で、終了コードは 0。

`subagent-start.test.ts`(`CLAUDE_PLUGIN_ROOT` にプラグインのルートを渡す):
- `inject` の状態で、`agent_type` が `docs-reviewer`、定義のファイル名が `docs-check.md` で `name: docs-reviewer`・`better-agentics-role` ありなら、`subagent-policy.md` の全文を `additionalContext` で注入する(Review Focus 3)。
- `no-api-key` の状態でも同じく注入する。
- `off`・`conflict-injection`・`conflict-gate`・`unknown-value` では何も出力しない。
- `better-agentics-role` の無い定義、`.claude/agents` が無いプロジェクト、`agent_type` がどの `name` にも一致しないときは何も出力しない。
- stdin が JSON でないときは、標準エラーに 1 行を書き、終了コード 0 で終わる。
- `subagent-policy.md` の文字数(`[...text].length`)が 10,000 未満である(設計書 §6)。

- [ ] **Step 4: 失敗を確かめる**

- [ ] **Step 5: 実装する**

SessionStart の警告文は次のとおりにする(本文に載せる)。

| 状態 | additionalContext |
| --- | --- |
| `unknown-value` | `AMATSUKA_AGENT_ENABLE_ORCHESTRATION の値 "<value>" は未知のため、better-agentics の規律を注入しなかった。1 / true / on で有効、0 / false / off で無効になる。` |
| `conflict-injection` | `AMATSUKA_AGENT_ENABLE_ORCHESTRATION と AMATSUKA_AGENT_AUTO_INJECTION が同時に有効なため、better-agentics の規律を注入しなかった。どちらか一方だけを有効にする。` |
| `conflict-gate` | `AMATSUKA_AGENT_DELEGATION_GATE が有効で、オーケストレーターの直接編集が差し止められるため、better-agentics の規律を注入しなかった。better-agentics ではオーケストレーターが自分で編集するので、gate を無効にする。` |
| `no-api-key` | `TYPESAFE_API_KEY が設定されていないため、better-agentics の規律を注入しなかった。委譲先の決定に TypeSafe AI の Jev を使うため、キーが必要になる。` |
| `inject` | `最初に better-agentics:orchestration スキルを使用する。スキルの規律に従う。` に、該当するときだけ次の段落を空行で区切って添える |

`inject` に添える段落:

- 定義が 0 件: `better-agentics-role を持つ Agent 定義が無い。委譲を使うには better-agentics:setup で定義を作る。`
- 重複: `次の役割を 2 件以上の定義が持つ。委譲先を決められないため、better-agentics:setup で 1 件に絞る。` の後に `- <label> [<role>]: <name>, <name>` を役割ごとに並べる。
- 未知の role-id: `次の定義は役割表に無い role-id を持つため、委譲先の候補にならない。` の後に `- <name>: <role>` を並べる。

hook 2 本とも、処理全体を `try` で囲み、例外は `better-agentics <hook 名>: <message>` を標準エラーに 1 行書いて終了コード 0 で終える。SessionStart は定義の走査が例外を投げても、規律の使用指示を出す(設計書 §8-1)。SubagentStart の `subagent-policy.md` のパスは `path.join(pluginRoot(), "references", "subagent-policy.md")` とする。SubagentStart の出力は `{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":<全文>}}` の 1 行とする。

- [ ] **Step 6: テスト・typecheck・lint を通し、`pnpm --filter better-agentics-scripts build` で `scripts/session-start.mjs` と `scripts/subagent-start.mjs` を出力する**

- [ ] **Step 7: コミットする**(`feat(better-agentics): SessionStart と SubagentStart の hook を追加する`。`scripts/` を含める)

### T7: pick-delegate

設計書 §7。

**Files:**
- Create: `plugins/better-agentics/src/lib/jev.ts`
- Create: `plugins/better-agentics/src/lib/pick.ts`
- Create: `plugins/better-agentics/src/pick-delegate.ts`
- Modify: `plugins/better-agentics/build.ts`(entryPoints に `"pick-delegate": "./src/pick-delegate.ts"` を足す)
- Test: `plugins/better-agentics/src/lib/__test__/pick.test.ts`、`src/__test__/pick-delegate.test.ts`

**Interfaces:**
- Consumes: `Definition`・`scanDefinitions`・`projectDirOf`(T5)、`roleById`・`rolesFor`(T1)、`hasApiKey`(T6)
- Produces: §3-7 のすべて

- [ ] **Step 1: 失敗するテストを書く**

`pick.test.ts` では `createAsk` に偽の関数を渡し、受け取った `JevRequest` を記録して、決めた `answers` を返す。定義は `Definition` を直接組み立てる。

- `review`、候補 3 件、`noul` が 0.91 / 0.73 / 0.2 → `agents` は上位 2 件を候補の走査順で返し、`p` を付け、`fallback` を付けない。Jev への呼び出しは 1 回で、`questions` は 3 問の `noul`。
- `review`、全員 0.5 未満(0.3 / 0.45) → `p` が最も高い 1 件を返し、`fallback: true` を付ける。
- `review` の `noul` の `instructions` に、その候補の `name` と `whenToInvoke` が含まれ、`state` には `summary` と `artifacts` だけが入り、基準の文字列が入らない。
- `split`、作業 2 件・候補 2 件 → Jev への呼び出しは 1 回で、`questions` は 2 問の `choice`。選択肢のラベルは候補の `name`、説明は `whenToInvoke`(空なら `null`)。`instructions` に作業の `id` と `summary` が含まれる。`assignments[].p` は `probabilities[choice]`。
- `split` で同じ定義が 2 つの作業に選ばれても、両方の `assignments` に同じ `agent` を返す。
- `review` と `split` で候補が 1 件なら、Jev を呼ばずにその定義を返し、`p` を付けない。キーが無くても `ok: true`。
- `stuck` は Jev を呼ばず、`agents: [{ agent, role: "escalation" }]` を返す。
- エラー 5 種:
  - `invalid-input`: JSON でない、`reason` が未知、`summary` が空文字、`artifacts` が配列でない、`tasks` が空配列、`id` が重複する(Review Focus 4)。
  - `no-candidates`: 理由に対応する役割の定義が 0 件。`message` に `better-agentics:setup` を含む。
  - `duplicate-role`: 理由に対応する役割を 2 件の定義が持つ。`message` に両方の `name` と `better-agentics:setup` を含む。理由に対応しない役割の重複(`review` のときの `normal-impl` の重複)では止まらない。
  - `no-api-key`: 候補 2 件の `review` で `apiKey` が `undefined`。
  - `jev-failed`: 偽の関数が例外を投げる。`noul` が範囲外(1.2)。`choice` が候補に無いラベルを返す。`message` に原因を含む。
- 役割表に無い role-id の定義は候補にならない。
- `split` の候補に、役割が違い `name` が同じ定義が 2 件あれば `duplicate-role` を返し、`message` にその `name` を含む。

`pick-delegate.test.ts`(`runTs` で起動):
- stdin に `{"reason":"stuck","task":{"summary":"x"}}` を渡し、`--dir <project>` の `.claude/agents` に escalation の定義があれば、標準出力の 1 行が `{"ok":true,"reason":"stuck","agents":[...]}` で、終了コードが 0。
- `CLAUDE_PROJECT_DIR` が別のプロジェクトを指すときは、`--dir` ではなくそちらを走査する。
- 不正な JSON でも終了コードは 0 で、`ok: false`・`error: "invalid-input"` を返す。
- `TYPESAFE_API_KEY` が空白だけで、候補 2 件の `review` を渡すと `no-api-key` を返す(Review Focus 1)。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

`jev.ts`:

```ts
import { TypeSafeClient } from "@typesafe-ai/sdk"

export function createJevAsk(apiKey: string): JevAsk {
  const client = new TypeSafeClient({ apiKey, logLevel: "off" })
  return (request) =>
    client.systemOne(request, {
      signal: AbortSignal.timeout(30_000),
      retry: { maxRetries: 1, maxRetryAfterMs: 5_000 }
    })
}
```

SDK 0.6.0 の型(`dist/index.d.cts`)で、次を計画立案時に確かめてある。`RequestOptions` は `signal?: AbortSignal`・`timeout?: number`・`retry?: Partial<RetryPolicy>` を持ち、`RetryPolicy` は `maxRetries`・`maxRetryAfterMs` を持つ。`TypeSafeClientConfig` は `apiKey`・`logLevel` を持つ。応答の `answers[<質問名>]` は、`noul` の質問では `{ type: "noul", noul: number }`、`choice` の質問では `{ type: "choice", choice: string, confidence: number, probabilities: Record<string, number> }` である。`choice(instructions, criteria)` の `criteria` は `Record<ラベル, 説明の文字列 | null>` を受け付ける。

`pick.ts` は、`review` の `p` を `answers["candidate_<i>"].noul` から、`split` の `agent` と `p` を `answers["task_<i>"].choice` と `answers["task_<i>"].probabilities[choice]` から読む。答えが欠けているか形が違えば `jev-failed` にする。形の検査には、`noul` と `probabilities[choice]` が 0 以上 1 以下の有限の数であること、`choice` が候補の `name` のどれかであることを含める。

`pick.ts` の問いの組み立て(設計書 §7-3):

```ts
import { choice, noul } from "@typesafe-ai/sdk"

function reviewQuestions(candidates: Definition[]): Questions {
  return Object.fromEntries(
    candidates.map((candidate, index) => [
      `candidate_${index}`,
      noul(
        [
          "Decide whether the reviewer below should review the work described in the state.",
          "Answer yes only when the reviewer's criteria clearly match the work. Other reviewers are judged separately.",
          `Reviewer: ${candidate.name}`,
          "When to invoke:",
          candidate.whenToInvoke === "" ? "(no criteria)" : candidate.whenToInvoke
        ].join("\n")
      )
    ])
  )
}

function splitQuestions(tasks: { id: string; summary: string }[], candidates: Definition[]): Questions {
  const options = Object.fromEntries(
    candidates.map((candidate) => [candidate.name, candidate.whenToInvoke === "" ? null : candidate.whenToInvoke])
  )
  return Object.fromEntries(
    tasks.map((task, index) => [
      `task_${index}`,
      choice(`Choose the agent that should take task "${task.id}": ${task.summary}`, options)
    ])
  )
}
```

- 候補は `deps.definitions` のうち、`roleById(role)?.reason === input.reason` の定義とする。並びは `deps.definitions` の順(`file` の昇順)を保つ。
- 重複の判定は候補の中だけで行う。同じ役割を 2 件以上が持つときに加え、別の役割の候補同士で `name` が重なるときも `duplicate-role` を返し、`message` に重なった `name` を書く(`choice` の選択肢と `subagent_type` が `name` を鍵にするため)。
- `review` の `state` は `{ summary, artifacts }`、`split` の `state` は `{ tasks }` とする。
- `pickDelegate` は全体を `try` で囲み、`PickFailure` は `{ ok: false, error, message }` に、それ以外の例外は `jev-failed` に変える。

`pick-delegate.ts` は、stdin を最後まで読み、`--dir` の値(無ければ `process.cwd()`)を `projectDirOf(process.env, dir)` に渡して走査し、`pickDelegate` の結果を JSON の 1 行で書く。`apiKey` には `TYPESAFE_API_KEY` を trim した値(空なら `undefined`)を、`createAsk` には `createJevAsk` を渡す。終了コードは常に 0。

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/pick-delegate.mjs` を出力する。`node plugins/better-agentics/scripts/pick-delegate.mjs --dir /tmp <<<'{}'` が `invalid-input` を返すことを確かめる(バンドルに SDK が入ったことの確認)**

- [ ] **Step 5: コミットする**(`feat(better-agentics): 委譲先を決める pick-delegate を追加する`。`scripts/` を含める)

### T8: setup の CLI(点検・断片・MCP・行の書き換え)

設計書 §9-2 ステップ 2〜5・§9-4。

**Files:**
- Create: `plugins/better-agentics/src/lib/mcp.ts`
- Create: `plugins/better-agentics/src/setup.ts`
- Create: `plugins/better-agentics/src/testing/fake-claude.mjs`(`process.stdout.write(process.env.BETTER_AGENTICS_FAKE_MCP ?? "")` の 1 行)
- Modify: `plugins/better-agentics/build.ts`(entryPoints に `setup: "./src/setup.ts"` を足す)
- Test: `plugins/better-agentics/src/lib/__test__/mcp.test.ts`、`src/__test__/setup.test.ts`

**Interfaces:**
- Consumes: T1〜T5
- Produces: §3-8 の `CoverageResult`。`listMcpServers(env)`・`toolPrefix(name)`・`mcpCurrentOf(content)`(agent-policy の `src/agents/mcp.ts` と同じシグネチャ)。偽のバイナリを指す環境変数は `BETTER_AGENTICS_CLAUDE_BIN`

- [ ] **Step 1: 失敗するテストを書く**

`mcp.test.ts`: agent-policy の `src/agents/__test__/mcp.test.ts` のケース(`✔ Connected` と `cached` だけが usable、名前の空白とコロン、`toolPrefix` の置換、`mcpCurrentOf` の逆算、`claude` が無いとき `[]`)を、better-agentics の関数と `BETTER_AGENTICS_CLAUDE_BIN` で書き直す。

`setup.test.ts`(`runTs` で `src/setup.ts` を起動し、`CLAUDE_PLUGIN_ROOT` にプラグインのルートを渡す):
- `--list-coverage --lang ja --dir <空のプロジェクト>` → `roles` が 13 件で、全件の `coveredBy` が空、`uncovered` が 13 件。`roles[].defaultName` は断片の `default-name`、`label` は ja の断片の値。
- 定義を置いたプロジェクトでは `coveredBy` に定義の `file` が入る。同じ役割の定義 2 件は `duplicates` に、未知の role-id は `unknownRoles` に入る。
- 役割に許可されていないツール(`code-review` の定義に `Write`)は `definitions[].disallowedTools` に入る。`mcp__` で始まるツールは入らない。block 配列の定義は `toolsFormat: "other"`(Review Focus 5)。
- `--prune-tools --name <file> --tools Write` は tools 行から `Write` を外し、他の行を変えない。block 配列の定義では `ok: false`。すべてのツールが外れる指定は `ok: false`。
- `--rewrite-roles --name <file> --roles ""` は `better-agentics-role` 行を消す。`--roles normal-impl` は値を書き換える。未知の役割 ID は `ok: false`。
- `--check-fragments --lang fr` と `--scaffold-fragments --lang fr` は T3 の関数の結果を `{ ok: true, ... }` で返す。`written` はプロジェクトルートからの相対パス。
- `--list-mcp` は `BETTER_AGENTICS_FAKE_MCP` の内容を解析した `servers` を返す。
- 未知のオプションは `ok: false` で、終了コードは 1。
- tools 行の無い定義は `definitions[].disallowedTools` が `["*"]`、`toolsFormat` が `"none"`。
- `--prune-tools --name ../x --tools Write` は `ok: false` で、プロジェクトの外のファイルを読み書きしない。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

- `setup.ts` の引数の解析と各コマンドは、agent-policy の `src/setup-agents.ts` の `parseArgs`・`listCoverage`・`inspectDefinitions`・`pruneTools`・`rewriteRoles`・`readDefinition`・`keyLineIndex` を出発点にする。`--scope`・`--vendor`・`--list-live-models`・`--recommended`・`--merge`・`--replace`・`--model-id`・`--list-roles` と、tools 欄の無い定義へ tools 行を足す `--tools "*"` は持たない(設計書 §9-4)。
- `toolsFormat` が `"none"` の定義(tools 行が無く、全ツールを継承する)は、`disallowedTools` に `["*"]` を返す。CLI では直さず、T10 の setup スキルが手で tools 行を足すよう報告する。
- `--name` は Global Constraints の正規表現で検査し、合わなければ `ok: false` で止める。作成先のパスに使うため、`../` を含む値で `.claude/agents/` の外へ書き込ませない。
- 書き換え対象のマーカー行は `better-agentics-role` とする。
- `--check` / `--write` の引数は解析だけをここで受け付け、処理は T9 で書く。T8 の時点では `ok: false`・`error: "not implemented"` を返してよい。

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/setup.mjs` を出力する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): setup の CLI に点検と断片と MCP のコマンドを追加する`。`scripts/` を含める)

### T9: setup の CLI(生成・再生成・取り込み)

設計書 §4-1(effort)・§9-2 ステップ 6・7・§9-3・§9-4。

**Files:**
- Create: `plugins/better-agentics/src/lib/regenerate.ts`
- Modify: `plugins/better-agentics/src/setup.ts`
- Test: `plugins/better-agentics/src/lib/__test__/regenerate.test.ts`、`src/__test__/setup.test.ts`(ケースを足す)

**Interfaces:**
- Consumes: `compose`(T4)、`parseDocument`・`render`(T2)、`decodeRecord`・`encodeRecord`・`textHash`(T2)、`listMcpServers`・`toolPrefix`・`mcpCurrentOf`(T8)
- Produces: §3-8 の `CheckResult`・`WriteResult`

```ts
// regenerate.ts
// classify の戻り値。compare が返す SectionReport.state(§3-8 の SectionState)は、これに "new" と "extra" を足した 6 値
export type TextState = "same" | "unknown" | "templateChanged" | "userEdited"
// record は既存の better-agentics-hash を decodeRecord した HashRecord のうち、そのキーの値
// ("description" なら record.description、見出し行なら record.sections[見出し行])。記録が無ければ undefined
export function classify(existing: string, template: string, record: string | undefined): TextState {
  if (textHash(existing) === textHash(template)) return "same"
  if (record === undefined) return "unknown"
  if (textHash(existing) === record) return "templateChanged"
  return "userEdited"
}
export interface MergeInput { existingRaw: string; templateRaw: string; keep: Set<string> }  // keep のキーは "description" / "preamble" / 見出し行
export interface MergeOutput { content: string; kept: string[]; replaced: string[]; keysKept: string[] }
export function compare(existingRaw: string, templateRaw: string): SectionReport[]
export function merge(input: MergeInput): MergeOutput
```

規則:

- `--effort` を省いたときは役割表の `effort` を書く。`--effort none` なら書かない。それ以外は `EFFORTS` の値だけを受け付ける。
- `--model` は `CLAUDE_MODELS` の値だけを受け付ける。
- 既存のファイルに同じ `## ` 見出しが 2 回以上あれば、`--check` も `--write` も `ok: false` で止め、`error` に見出しを書く。`parseDocument` は同じ見出しを 1 つにまとめるため、再生成すると `pick-delegate` が読んでいた本文(最初の見出しの配下)が失われうる。利用者が手で 1 つにまとめてから再実行する。
- `lang` が `ja` / `en` 以外で翻訳断片に `missing` か `stale` があれば、`ok: false` で止める(agent-policy の `validateFragments` と同じ)。
- `--keep` の値はカンマ区切りで、`description`・`preamble`・見出しから `## ` を除いた名前(`When to invoke`、`作業手順`)を受け付ける。既存のファイルに無いものを指定したら `ok: false`。`setup.ts` は見出しの名前に `## ` を付けた見出し行に直してから `merge` の `keep` に渡す。
- `compare` は、テンプレートの各セクションに `classify` を当てる。既存だけにあるセクションは `extra`、テンプレートだけにあるセクションは `new` とする。`description` と `preamble` も同じ規則で分類する。`record` は既存の `better-agentics-hash` を `decodeRecord` した値から引く。
- `merge` は、テンプレートを土台にし、`keep` にあるセクションと `extra` のセクションを既存の本文で置き換える(`extra` はテンプレートのセクションの後に、既存での順で置く)。
- `merge` の frontmatter:
  - `model`・`effort`・`tools`・`better-agentics-role`・`better-agentics-hash` はテンプレートの値を使う。`effort` を書かない指定では、既存に `effort` があっても消す。
  - `name` は既存の値を使う(設計書 §9-3 は `name` を書き直すキーに含めない)。`--name` は作成先のファイル名だけを決める。既存のファイルが無いときは `--name` の値を `name` に書く。
  - `description` は `keep` にあれば既存の値を使う。
  - 上記と `disallowedTools` 以外の既存のキー(`color`・`agent-policy-role`・`hooks` など)は、既存での順でテンプレートのキーの後に残し、`keysKept` に載せる。
  - キーの並びは、テンプレートのキー(T4 の順。`disallowedTools` を書くときは `tools` の直後)を先に置き、残したキーを後に続ける。
- `merge` の記録: 置き換えたキーにはテンプレートの `textHash` を、保持したキーには既存の記録の値を書く。既存の記録が無い保持したキーは、記録から外す(次の再生成でも `unknown` として聞く)。
- MCP: `--mcp-servers` を渡したときは、`listMcpServers` で usable なサーバーだけを `toolPrefix` で `mcp__<name>` にして `tools` の末尾に足し、使えなかった名前を `mcpDropped` に載せる。渡さないときは、既存の `tools` の `mcp__` で始まる項目をそのまま引き継ぐ。`--mcp-servers ""` は MCP を付けない指定とする。
- `disallowedTools`: `--mcp-deny` を渡したときはその値を書き(`""` なら書かない)、渡さないときは既存の値を引き継ぐ。
- `--write` の `action`: 既存のファイルが無ければ `written`、既存に `better-agentics-role` があれば `regenerated`、無ければ `adopted`。

- [ ] **Step 1: 失敗するテストを書く**

`regenerate.test.ts`:
- `classify` の 4 分類。既存とテンプレートが同じなら、記録の有無を問わず `same`。記録が無く違えば `unknown`。既存 = 記録 ≠ テンプレートなら `templateChanged`。既存 ≠ 記録なら、テンプレートとの関係を問わず `userEdited`。
- `compare` が `extra` と `new` を返す。
- `merge` が `keep` のセクションを既存の本文で保ち、記録に既存の値を書く。記録の無い保持したセクションは、記録から外す。
- `merge` が `color: blue`・`agent-policy-role: code-review`・`disallowedTools: mcp__x__write` を既存から引き継ぐ。`disallowedTools` を除く 2 つを `keysKept` に載せる。
- `merge` の後の文書を `compare` にかけると、置き換えたセクションは `same` になる。

`setup.test.ts` に足すケース:
- 新規生成: `--write --role code-review --model sonnet --name code-reviewer --lang ja` → `action: "written"`。`effort: high` が書かれる。
- 推奨と違うモデル: `--model opus --effort xhigh` → `effort: xhigh`。`--model opus --effort none` → `effort` 行が無い。`--effort extreme` → `ok: false`。
- `--check` で既存のファイルが無ければ `exists: false`・`sections` が空。
- 再生成: 生成した定義の `## 作業手順` を書き換えた後の `--check` で、そのセクションが `userEdited`、他が `same`。`--write --keep 作業手順` の後もその本文が残る。
- テンプレートの変更: 古いテンプレートで生成された定義を再現する。生成した定義の `## 作業手順` の本文を書き換え、記録のその見出しの値も書き換えた本文の `textHash` にする。この定義の `--check` で、そのセクションが `templateChanged` になる。
- 取り込み: `better-agentics-role` の無い同名のファイル(`agent-policy-role: code-review`、`color: blue`、`disallowedTools: mcp__serena__replace_content`、`tools` に `mcp__serena`)に `--check` → `adopt: true`、本文のセクションはすべて `unknown` か `same` か `extra`。`--write`(`--keep` なし)→ `action: "adopted"`、本文はテンプレート、`agent-policy-role`・`color` が残り `keysKept` に載り、`disallowedTools` と `mcp__serena` が残る。
- `--mcp-servers serena`(偽の `claude mcp list` で `serena` が `✔ Connected`)→ `tools` の末尾に `mcp__serena`。`--mcp-servers ghost`(一覧に無い)→ `mcpDropped: ["ghost"]`。
- 翻訳断片の無い `--lang fr` の `--write` は `ok: false`。
- ファイル名と `name` が違う既存の定義(`docs-check.md` に `name: docs-reviewer`)を `--name docs-check` で再生成すると、作成先は `docs-check.md` のままで、`name: docs-reviewer` が残る。
- `## 作業手順` が 2 回ある既存の定義への `--check` は `ok: false`。

- [ ] **Step 2〜4: 失敗を確かめ、実装し、テスト・typecheck・lint を通す。ビルドで `scripts/setup.mjs` を更新する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): setup の CLI に生成と再生成と取り込みを追加する`。`scripts/` を含める)

### T10: スキル 2 本

設計書 §5・§9。

**Files:**
- Create: `plugins/better-agentics/skills/orchestration/SKILL.md`
- Create: `plugins/better-agentics/skills/setup/SKILL.md`

**Interfaces:**
- Consumes: `scripts/pick-delegate.mjs` の入出力(§3-7)、`scripts/setup.mjs` のコマンドと応答(§3-8)

- [ ] **Step 1: `prompt-smith:skill-creator` を起動し、2 本の frontmatter と description を書く**

| スキル | frontmatter に入れる値 |
| --- | --- |
| orchestration | `name: orchestration`。`allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/pick-delegate.mjs" *)`。description には、`AMATSUKA_AGENT_ENABLE_ORCHESTRATION` が有効で `TYPESAFE_API_KEY` が設定されているとき、セッションの最初の実務タスクの前に読むことを書く(設計書 §7-4 の後段) |
| setup | `name: setup`。`allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" *), Edit(**/.claude/better-agentics/roles/**), AskUserQuestion`。`disallowed-tools: Write`。description には、ユーザーが明示的に依頼したときだけ使い、自律的には発動しないことを書く |

- [ ] **Step 2: `prompt-smith:prompt-smith` を起動し、orchestration の本文を書く**

本文に入れる規律は、設計書 §5-1〜§5-5 の箇条すべてである。設計書の箇条を言い換えずに写し、根拠の文(「〜のためである」)は写さない(根拠は T11 の `docs/rationale.md` へ置く)。加えて次を入れる。

- `pick-delegate` の呼び出し方。設計書 §7-1 のコマンド例と、理由ごとの入力の形(§7-1 の表)。値は例示であり、実際の内容に置き換えると明記する。
- 出力の読み方。`agents` / `assignments` の `agent` を Agent ツールの `subagent_type` に渡す。`fallback: true` の扱いは §5-2 のとおり。
- 失敗時の扱い(§5-1 の 4 つ目の箇条)と、`error` の 5 種の意味(§7-4 の表)。
- 文書の執筆を委譲するときの規律。agent-policy の `references/orchestration-discipline.md:93-101` の 7 箇条を、出典の名前を書かずに写す(設計書 §5-3 の最後の箇条)。

- [ ] **Step 3: `prompt-smith:prompt-smith` を起動し、setup の本文を書く**

本文に入れる内容:

- 書き込みと対話の規律。agent-policy の `skills/setup-agents/SKILL.md:14-58` を写し、次を変える。
  - コマンドは `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" ... --dir "$PWD"` にする。
  - 翻訳断片の置き場を `.claude/better-agentics/roles/<lang>/` にする。
  - `ok: false` でも続ける例外は、ステップ 2 の `--prune-tools` / `--rewrite-roles` と、ステップ 6・7 の 1 定義ごとの `--write` にする。
  - `--scope` と非対話モードへの言及を外す。
  - 候補数の表(0 件・1 件・2〜4 件・5 件以上)、ページ分けは複数選択だけに当てること、空の選択肢の規則、表は `AskUserQuestion` の中に入れることは、そのまま写す。
- ステップ 1〜8。設計書 §9-2 の各ステップを、どの CLI を呼び、応答のどのフィールドを読み、何をどの選択肢で聞くかまで書く。分岐の条件だけで終えず、質問の形を書く。
  - ステップ 2(点検): `--list-coverage` の `definitions[].disallowedTools`(ツールごとに「削除する(推奨)」「残す」)、`duplicates`(残す定義を単一選択で聞き、残さない定義に `--rewrite-roles --roles ""`)、`unknownRoles`(報告だけ)。`toolsFormat` が `csv` でない定義にはツールの質問を出さず、ステップ 8 で手で外すツールとして報告する。操作を実行したら `--list-coverage` を取り直す。
  - ステップ 3(被覆の確認): `uncovered` が空でなければ 3 択、空なら「すべての役割を確認し直す」「中止する」の 2 択(agent-policy の被覆確認と同じ)。すべての `coveredBy` が空なら聞かずに進む。
  - ステップ 4(翻訳断片): agent-policy のステップ 2 を写し、`## When to invoke` は翻訳しない(英語のまま残す)ことを足す。
  - ステップ 5(MCP): agent-policy のステップ 4b を写す。
  - ステップ 6(新規生成): 役割を 1 つずつ、次の順で別々の `AskUserQuestion` で聞く。
    1. モデル。選択肢は推奨のモデル(先頭、推奨の印)、残りの Claude の 3 モデル、「この役割は作らない」の 5 件になる。単一選択で 4 件を超えるので、1 問目を「推奨のモデル」「その他のモデル」「この役割は作らない」の 3 択にし、「その他のモデル」のときだけ 2 問目で残りの 3 モデルから選ばせる。
    2. effort。推奨と違うモデルを選んだときだけ聞く。設計書 §4-1 の 2 問の形(1 問目「推奨の値」「その他の値」「書かない」、2 問目は残りの 4 値)にする。選んだ値を `--effort` に、「書かない」は `--effort none` にする。
    3. 定義名。「既定名を使う」「別の名前を指定する」の 2 択で必ず聞く。既定名は `roles[].defaultName` で、モデル名を前に付けない。
    4. MCP。agent-policy のステップ 5n の 3 を写す(readonly の役割の denylist の確定と、そのまま入れる 1 文を含む)。「`_common.md` の制約と矛盾しないことを確認する」箇条は写さない(better-agentics の `_common.md` は制約を持たない)。
    5. `--check` を実行し、`adopt: true` なら、ファイルごとに 1 回「本文をまとめてテンプレートに置き換える(推奨)」「セクションごとに選ぶ」を聞く。後者のときだけ、`unknown` のセクションごとに既存とテンプレートを preview に示して「保持する」「テンプレートに置き換える」を聞く(推奨は付けない)。保持すると決めたものを `--keep` に渡す。
    6. `--write` を実行する。
  - ステップ 7(再生成): ステップ 3 で「すべての役割を確認し直す」を選んだとき、`coveredBy` のある役割の定義ごとに行う。
    - モデルは既存の `model` を使う。`model` が `CLAUDE_MODELS` に無い(`inherit` や外部のモデル)ときは、ステップ 6 の 1 で聞き、質問文に元の値から変わることを書く。
    - effort は、モデルが推奨と同じなら `--effort` を渡さない。違うなら既存の `effort` を渡し、既存に無ければ `--effort none` を渡す。
    - MCP は「既存のまま(推奨)」「変更する」「付与しない」の 3 択で聞く(agent-policy のステップ 5c を写す)。「既存のまま」では `--mcp-servers` と `--mcp-deny` を渡さない。
    - `--check` の `sections` を状態で扱う。`same`・`new`・`extra` は聞かない。`templateChanged` は「テンプレートに置き換える(推奨)」「保持する」、`userEdited` は「保持する(推奨)」「テンプレートに置き換える」、`unknown` は推奨なしの 2 択で、どれも既存とテンプレートを preview に示す。保持するものを `--keep` に渡して `--write` する。
  - ステップ 8(報告): 設計書 §9-2 ステップ 8 の項目に加え、点検で手で外すツール、`keysKept`、`mcpDropped`、`ok: false` になった操作を並べる。取り込んだ定義の `keysKept` に、他のマーカーのキー(末尾が `-role`)が残ることがある。その定義は、そのマーカーを読む仕組みからも委譲先として使われうる。このことを伝え、マーカーを残すかを利用者に委ねる。スキル本文には他プラグインの名前とキー名を書かない(ARCHITECTURE の依存の禁止)。`AMATSUKA_AGENT_ENABLE_ORCHESTRATION=1` と `TYPESAFE_API_KEY` の設定方法を示す。`.claude/agents/` を新規に作った初回は Claude Code の再起動が要ることを伝える。

- [ ] **Step 4: 2 本の本文を `wc -c` で測り、orchestration が 30KB 以下であることを確かめる**(設計書 §5-5 の基準を自分にも当てる)

- [ ] **Step 5: コミットする**(`feat(better-agentics): orchestration と setup のスキルを追加する`)

### T11: 登録と文書

設計書 §11・§15。

**Files:**
- Create: `plugins/better-agentics/README.md`
- Create: `plugins/better-agentics/docs/rationale.md`
- Modify: `.claude-plugin/marketplace.json`(`plugins` の末尾に `{"name": "better-agentics", "source": "./plugins/better-agentics", "description": <plugin.json の description>}` を足す)
- Modify: `README.md`(プラグインの表に 1 行を足し、`### native-japanese` のセクションの後に `### better-agentics` のセクションを足す)

- [ ] **Step 1: `README.md`(プラグイン)を書く。次を入れる**
  - 何をするか(設計書 §1)。
  - 使い方: `/better-agentics:setup` で定義を作り、`AMATSUKA_AGENT_ENABLE_ORCHESTRATION=1` と `TYPESAFE_API_KEY` を設定する。
  - 環境変数の値と挙動(設計書 §8-1 の表)。agent-policy の `AMATSUKA_AGENT_AUTO_INJECTION`・`AMATSUKA_AGENT_DELEGATION_GATE` と同時に有効にすると規律を注入しないこと。
  - 委譲のたびに、作業の要約と成果物のパスが TypeSafe AI へ送られること。成果物の中身は送らないこと(設計書 §11)。
  - When to invoke を編集して委譲先の選ばれ方を調整できること。再生成でも編集を保持できること(設計書 §9-3)。

- [ ] **Step 2: `docs/rationale.md` を書く。設計書 §1(背景)・§13(不採用案)・§14(リスク)の要点と、スキル本文から外した根拠を置く**

- [ ] **Step 3: marketplace とルートの README を変える。`plugins/better-agentics/.claude-plugin/plugin.json` があることを確かめる**

ルート README の表の行(本文に載せる): `| better-agentics | オーケストレーターが調査・設計・実装を自分で行い、レビュー・分担・行き詰まりのときだけ、TypeSafe AI の Jev が選んだサブエージェントへ委譲するプラグイン | 開発中   |`。

- [ ] **Step 4: 全体の検査を通す**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
git status --short plugins/*/scripts plugins/*/dist
```

Expected: 4 つのコマンドがパスし、`pnpm run build` の後に `plugins/better-agentics/scripts/` 以外のビルド出力に差分が無い。

- [ ] **Step 5: 規約の Done の条件のうち、文書の追随を確かめる**。`node plugins/metatron/scripts/metatron.mjs get architecture` の本文に、better-agentics の追加で古くなる記述が無いかを読む。`.serena/memories/` に agent-policy の構成を前提にした記述があり、better-agentics と食い違うかを確かめる。どちらも、変更が要るときは編集せずオーケストレーターへ報告する。

- [ ] **Step 6: コミットする**(`docs(better-agentics): README と登録を追加する`)

### T12: 実機の確認(手動)

設計書 §12 の最後の箇条、§15。オーケストレーターがユーザーと行う。

- [ ] **Step 1: このリポジトリで `/better-agentics:setup` を実行し、`code-review`・`design-review`・`knowledge-elicitation`・`normal-impl`・`explore`・`escalation` の 6 役割を作る**。このリポジトリの `.claude/agents/` には agent-policy の定義が git 管理下にあり、既定名(`code-reviewer` など)が重なる。既存の定義を書き換えないため、定義名は「別の名前を指定する」で `ba-` を前に付けた名前にする。取り込みの経路は T9 のテストで確かめてあるので、ここでは通らない。確認を終えたら、作った 6 定義を消すかをユーザーに聞く(消すときはユーザーが手で消す)。

- [ ] **Step 2: 新しいセッションを起動する**。このリポジトリの `.claude/settings.local.json` の `env` には `AMATSUKA_AGENT_AUTO_INJECTION` が入っており、シェルで外しても残る。ユーザーに、`env` から `AMATSUKA_AGENT_AUTO_INJECTION` を外し、`AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "1"` を足すよう依頼する(設定ファイルは自分で編集しない)。`TYPESAFE_API_KEY` が `env` にあることも確かめてもらう。新しいセッションの SessionStart の注入文に `better-agentics:orchestration` が出ることを確かめる。確認を終えたら、元の設定に戻すよう依頼する。

- [ ] **Step 3: subagent-policy が届いたことを確かめる**。同じセッションで `ba-` の定義を 1 つ起動する。サブエージェントには、追加の文脈に `# サブエージェントの規律` の見出しを含む文があるかを答えさせる。このリポジトリでは他のプラグインも SubagentStart で文脈を足すため、先頭の行では判定しない。

- [ ] **Step 4: `pick-delegate` を実際の Jev で呼ぶ**。日本語の会話中に、英語の `summary` で `review`(設計書と実装計画書のパスを `artifacts` に入れる)と `split`(作業 2 件)を 1 回ずつ実行し、返った委譲先と `p` をユーザーに示して妥当かを聞く。

- [ ] **Step 5: 結果をこの計画書の §5 に書き、コミットする**(`docs(better-agentics): 実機の確認の結果を記録する`)

## 5. 実施記録

実装中の判断は `.superpowers/sdd/2026-10-26-better-agentics-plan/progress.md` に記録し、要点を最終報告でユーザーへ示した。

### T12 Step 1: setup の実行(2026-10-27)

- `ba-` の名前で別に作る予定だったが、ユーザーの選択で 13 役割すべてを既存の agent-policy の定義へ取り込んだ(コミット `b2a230a0`)。
- 本文はすべて「まとめて置き換える」を選び、MCP と `disallowedTools` は既存の値を引き継いだ。`agent-policy-role` などのキーも残っている。

### T12 Step 4: 実際の Jev での pick-delegate(2026-10-27)

| 入力 | 返った委譲先(p) |
| --- | --- |
| review: 設計書のレビュー(英語の summary、artifacts に設計書のパス) | docs-reviewer(0.96)、knowledge-elicitor(0.91) |
| review: コード差分のレビュー | code-reviewer(0.88) |
| split: 呼び出し元の探索 / 設計済みの関数のテスト作成 / Web での最新情報の調査 | general-explorer(1)/ general-implementer(1)/ realtime-researcher(1) |
| stuck | technical-leader(Jev は呼ばない) |

- review では、complex-review と adversarial-review の候補が yes にならなかった。計画レビューの指摘(全員 yes になる懸念)は、基準の書き分けで避けられている。
### T12 Step 2・3: 新しいセッションでの hook の発火(2026-10-27)

- Step 2: SessionStart が `最初に better-agentics:orchestration スキルを使用する。スキルの規律に従う。` を注入し、セッションは最初の作業の前にスキルを読み込んだ。`allowed-tools` の `pick-delegate.mjs` も許可に登録された。
- Step 3: general-explorer の起動時に、SubagentStart が `references/subagent-policy.md` の全文を注入した。他のプラグインの SubagentStart の注入と並んで届いた。effort は定義どおり `high` だった。
- 観察: プラグイン 14 件の README を読む探索を、オーケストレーターは委譲せず自分で始めかけ、ユーザーの指示で general-explorer へ委譲した。「grep/read の反復が 3 ターン以上見込まれる探索は split で委譲する」の見積もりが働かなかった例として残す。
