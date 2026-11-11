# better-agentics 起動モード改修 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 定義の無い役割も Standard Agent モードで委譲できるようにし、fork・再開・設定による役割の除外・外側の手順との整合を better-agentics に入れる。

**Architecture:** `pick-delegate` が、外していない全役割を候補にして Jev に選ばせ、委譲先を `{role, mode, agentType, model, effort, preamble, p}` で返す。前置きは同梱の断片と `references/subagent-policy.md` から `src/lib/preamble.ts` が組み立てる。外した役割は `.claude/better-agentics/config.json` に setup だけが書き、`pick-delegate` と SessionStart は読むだけにする。

**Tech Stack:** TypeScript(strict)、esbuild(ESM・node22・`.mjs`)、vitest、`@typesafe-ai/sdk` 0.6.0

**Spec:** `harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md`(承認済み。コミット `5040b9ad`〜`ad3db392`)

- 作成日: 2026-11-11
- 対象プラグイン: `plugins/better-agentics/`(`0.0.2-dev`)
- 計画立案時の HEAD: `ad3db392`

この計画書はタスクの分割・順序・検証方法・タスク間の契約を定める。設計判断は設計書を正本とし、各タスクに設計書のセクション番号を添える。設計書と実装の食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。

## Global Constraints

設計書と規約から値をそのまま写す。

- バージョンは `plugin.json` と `package.json` の両方で `0.0.2-dev` のまま上げない。規約の Done の条件は「バージョンが揃って上がっている」を求めるが、`-dev` のプラグインは上げないというユーザーの方針に従う。設計書の冒頭も同じ扱いである。
- 規律の文面には、codiel の名前も codiel 固有の語も書かない(設計書 5.1)。対象は `skills/orchestration/SKILL.md`・`skills/setup/SKILL.md`・`references/subagent-policy.md`・`assets/roles/**`・`pick-delegate` が組み立てる前置きである。代わりに「このスキルの外のスキルやコマンドの手順」と書く。検査は §1 の禁止語の grep で行う。
- 設定ファイルは `<project>/.claude/better-agentics/config.json`、キーは `disabledRoles`(役割 ID の配列)。書くのは setup の CLI だけとする(設計書 7.3)。
- 委譲先 1 件の項目名は `role`・`mode`・`agentType`・`model`・`effort`・`preamble`・`p` とする。現行の `agent` は `agentType` に名前を変える(設計書 4.4)。
- Jev の選択肢の鍵は役割 ID とする(設計書 4.3、J1)。
- fork を返す役割は `complex-impl`・`normal-impl`・`general` の 3 つだけとする(D6)。
- 1 時間のキャッシュを付ける役割は `code-review`・`design-review`・`complex-review`・`adversarial-review`・`knowledge-elicitation` の 5 つとする(D11)。
- `omitClaudeMd` の推奨は `knowledge-elicitation` だけ「付ける」とする(D8)。
- knowledge-elicitation の model と effort は `haiku` / `low` のまま変えない(D9)。
- Claude Code は 2.1.302 以上を前提とする(fork の既定。設計書 9.2)。README に書く。
- テストは対象ソースと同じディレクトリの `__test__/<対象ファイル名>.test.ts` に置く。複数のテストで使うヘルパーは `__test__/helpers/` に置く(testing-policy)。
- `plugins/better-agentics/scripts/` は手で編集しない。`src/` か `assets/` を変えたタスクは `pnpm --filter better-agentics-scripts build` を実行し、`scripts/` の差分を同じコミットに入れる。
- ブランチを切らず、main で作業する。タスクごとにコミットする。各コミットで、`pick-delegate` の入出力と `SKILL.md` の `pick-delegate` の呼び出しのセクションを合わせる。それ以外の規律の文面は T12〜T14 で追いつかせ、それまでの文面の古さは食い違いとみなさない。Co-Authored-By の行は、実装するセッションの指示に従ってコミットメッセージの末尾に付ける。

## Review Focus

設計書が直接は書いていないが、利用者が踏みやすい入力と、そのときに期待される振る舞い。各行のテストは担当タスクに入れてある。

1. `config.json` が空ファイル・JSON の配列・`disabledRoles` に役割表に無い ID を含む — どれも「形が違う」として扱う。`pick-delegate` は `invalid-config` を返し、SessionStart は警告し、setup の `--list-coverage` は `config: "invalid"` と中身を返す(T2・T6・T10・T9)。
2. `excludeRoles` が空配列・役割表に無い ID・理由に関係の無い役割を含む — 空配列は付けないのと同じ。無い ID は `invalid-input`。関係の無い役割は何も起こさない(T5・T6)。
3. Custom Agent モードの定義の `model` が `inherit`・未設定・完全なモデル ID で、作業に `needsContext: true` が付く — fork にならず `mode: "self"` を返す(T7)。
4. `lang` に翻訳断片の無い言語、一部の役割だけ翻訳の無い言語、stale な翻訳の言語を渡す — 前置きの全体を en で組み立て、エラーにしない(T4)。
5. `parentModel` に 4 つの別名以外の値を渡す — `invalid-input` を返す。`parentModel` が無いときは、`needsContext` の作業だけを `self` にし、他の作業は通常どおり返す(T5・T7)。

---

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/` の 3 ファイル。設計書 9.2 のとおり、ARCHITECTURE はプラグインの中の契約を書いていないので変えない。変更が要ると気付いたら、修正せず報告する。
- リポジトリの `plugins/better-agentics/hooks/hooks.json`。試作の記録用の hook は、スクラッチの複製に足す(§1)。
- 他プラグインのファイル。agent-policy・codiel は読むだけにする。
- `tsconfig.json`・`vitest.config.ts`・`biome.json`・`.raphael/`。
- 本件と無関係な未コミット変更。触らず、revert もしない。

## 1. 共通の進め方

- 各タスクは TDD で進める。失敗するテストを書く → 失敗を確かめる → 実装する → パスを確かめる → コミットする。
- 1 タスクの完了条件は、そのタスクのテストと `pnpm run typecheck`・`pnpm run lint` が通ること。lint の前に `pnpm run lint:fix` で整形する。最後のタスク(T16)で `pnpm run test`・`pnpm run typecheck`・`pnpm run lint`・`pnpm run build` を全体で通す。
- AI が読む Markdown(`skills/**/SKILL.md`・`references/*.md`・`assets/**/*.md`・`harness-docs/**/*.md`)を書く前に、`prompt-smith:prompt-smith` を起動して規律に従う。
- 規律の文面を変えたタスクは、禁止語を `grep -nE 'codiel|declined|wait-add|test-spec|test-code|test-loop|fix-loop|intent-sync|dev-plan|triage|finalize|Raguel|Epic' <変えたファイル>` で検査し、0 件を確かめる。あわせて `grep -nwi 'run' <変えたファイル>` の当たりを 1 件ずつ読み、codiel の run を指す語が無いことを確かめる。
- テストの一時ディレクトリは `fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))` で作り、`afterEach` で消す。hook と CLI のテストは既存の `src/testing/run-ts.ts` の `runTs` と、`src/hooks/__test__/helpers/hook.ts` の `runHook`・`environment` を使う。
- 試作と実機の確認は、スクラッチのプロジェクト(`mktemp -d` で作る git リポジトリ)で行う。
  - リポジトリの better-agentics は、`claude --plugin-dir <リポジトリ>/plugins/better-agentics` で読み込む。インストール済みの better-agentics はこのリポジトリだけに入っている(scope が project)ので、スクラッチのプロジェクトでは二重に動かない。
  - 記録用の hook が要るときは、プラグインの複製をスクラッチに作り、複製の `hooks/hooks.json` に足す。
  - better-agentics の hook と `pick-delegate` を働かせるため、このリポジトリの `.claude/settings.local.json` の `env` にある `AMATSUKA_AGENT_ENABLE_ORCHESTRATION` と `TYPESAFE_API_KEY` を、スクラッチの `.claude/settings.local.json` の `env` に写す。値はファイルから写し、計画書・記録・コミットに書かない。キーを写したスクラッチのプロジェクトは、そのタスクの終わりに `rm -rf` で消し、消したことを §5 に書く。
  - 結果は §5 の実施記録に書く。結果が設計書 13 章の「想定と違うときの扱い」に当たれば、「試作の結果による分岐」(T1)に従って後のタスクを変える。

## 2. ファイル構成

```
plugins/better-agentics/
├── assets/roles/{ja,en}/_common.md        T3 Preamble に {{ROLE_ID}}
├── assets/roles/{ja,en}/*.md(13 役割)    T3 Output Format の結果なし、light-impl の制約
├── references/subagent-policy.md          T12
├── skills/orchestration/SKILL.md          T6(pick-delegate の入出力)・T13(残り)
├── skills/setup/SKILL.md                  T14
├── src/lib/config.ts                      T2 新規。設定ファイルの読み書き
├── src/lib/compose.ts                     T3 {{ROLE_ID}} の置換
├── src/lib/preamble.ts                    T4 新規。Standard Agent モードと fork の前置き
├── src/lib/pick.ts                        T5・T6・T7(T7a・T7b・T7c)
├── src/pick-delegate.ts                   T5
├── src/lib/extra-keys.ts                  T9 新規。omitClaudeMd と experimental.cacheTtl
├── src/setup.ts                           T9
├── src/lib/notices.ts                     T10 新規。SessionStart の知らせと警告
├── src/hooks/session-start.ts             T10
├── src/hooks/subagent-start.ts            T11
├── src/hooks/__test__/helpers/hook.ts     T5 テストの環境から消す変数を足す
├── README.md・docs/rationale.md           T16
└── .claude-plugin/plugin.json             T16(description だけ)
```

- 設計書 16 章は前置きの組み立てを `src/lib/fragments.ts` に置くと書く。`fragments.ts` は 312 行あり、断片の読み込みと翻訳の点検を受け持つので、前置きは新しい `src/lib/preamble.ts` に分ける(計画の判断)。
- 設計書 16 章が挙げる `agents.ts`(候補の集め方)・`regenerate.ts`・`document.ts` は、この計画では変えない。候補の集め方は `pick.ts` に、2 キーの書き換えは `extra-keys.ts` に置き、`document.ts` の既存の `parseDocument`・`render` を使う。

## 3. タスク間の契約

後のタスクが使う名前と型を、ここで固定する。実装者は自分のタスクのセクションと §3 だけを読めば、隣のタスクの名前が分かる。既存の型(`RoleId`・`Role`・`Reason`・`ClaudeModel`・`Effort`・`Definition`・`Fragment`・`JevAsk`)は変えない。

### 3-1. `src/lib/config.ts`(T2)

```ts
export const CONFIG_FILE = ".claude/better-agentics/config.json"   // projectDir からの相対パス
export interface BetterAgenticsConfig { disabledRoles: RoleId[] }
export type ConfigState =
  | { kind: "absent" }                                   // ファイルが無い
  | { kind: "ok"; config: BetterAgenticsConfig }
  | { kind: "invalid"; message: string; raw: string | null }   // raw は読めた中身。読めなければ null
export function readConfig(projectDir: string): ConfigState
export function writeConfig(projectDir: string, config: BetterAgenticsConfig): string   // 書いたファイルの projectDir からの相対パス
export function disabledRolesOf(state: ConfigState): RoleId[]   // absent・invalid は []
```

「形が違う」は次のどれかとする。JSON として読めない。最上位がオブジェクトでない。`disabledRoles` が無いか、文字列の配列でない。役割表に無い ID を含む。

### 3-2. `src/lib/preamble.ts`(T4)

```ts
export interface PreambleContext { pluginRoot: string; projectDir: string; lang: string }
export function standardPreamble(roleId: RoleId, context: PreambleContext): string
export function forkPreamble(roleId: RoleId, context: PreambleContext): string
```

言語は前置きの全体で 1 つに揃える。`ja`・`en` は同梱の断片を使う。それ以外の言語は、対象の役割の翻訳断片と翻訳した `_common.md` の両方が ready のときだけ訳を使い、どちらかが missing か stale なら全体を en にする。設計書 4.6 と J19 は断片ごとに stale を見るが、1 つの前置きの中で言語が混ざるのを避けるため、全体で揃える(計画の判断)。`subagent-policy.md` はどの言語でも ja を使う。

### 3-3. `src/lib/pick.ts`(T5・T6・T7)

```ts
export interface PickCommon {
  parentModel: ClaudeModel | undefined
  lang: string            // 既定は "en"
  excludeRoles: RoleId[]  // 既定は []
}
export type PickInput =
  | ({ reason: "review"; task: { summary: string; artifacts: string[] } } & PickCommon)
  | ({ reason: "split"; tasks: { id: string; summary: string; needsContext: boolean }[] } & PickCommon)
  | ({ reason: "stuck"; task: { summary: string } } & PickCommon)
export type Mode = "custom" | "standard" | "fork" | "self"
export type Delegate =
  | { role: RoleId; mode: "custom"; agentType: string; p?: number }
  | { role: RoleId; mode: "standard"; agentType: "general-purpose"; model: ClaudeModel; effort: Effort; preamble: string; p?: number }
  | { role: RoleId; mode: "fork"; agentType: "fork"; preamble: string; p?: number }
export interface SelfAssignment { id: string; mode: "self" }
export type PickError = "invalid-input" | "no-candidates" | "duplicate-role" | "invalid-config" | "no-api-key" | "jev-failed"
export type PickOutput =
  | { ok: true; reason: "review"; agents: Delegate[]; fallback?: true }
  | { ok: true; reason: "split"; assignments: ((Delegate & { id: string }) | SelfAssignment)[] }
  | { ok: true; reason: "stuck"; agents: Delegate[] }
  | { ok: false; error: PickError; message: string }
export interface Candidate { role: Role; definition: Definition | undefined; criteria: string }
export interface PickDeps {
  definitions: Definition[]
  config: ConfigState
  apiKey: string | undefined
  createAsk: (apiKey: string) => JevAsk
  forkEnabled: boolean                          // CLAUDE_CODE_FORK_SUBAGENT が "0" でない
  standardCriteria: (roleId: RoleId) => string  // 同梱 en の断片の ## When to invoke
  preambles: { standard: (roleId: RoleId, lang: string) => string; fork: (roleId: RoleId, lang: string) => string }
}
export const FORK_ROLES: readonly RoleId[]   // ["complex-impl", "normal-impl", "general"]
export function parseInput(raw: string): PickInput
export function candidatesFor(input: PickInput, deps: PickDeps): Candidate[]
export async function pickDelegate(raw: string, deps: PickDeps): Promise<PickOutput>
```

条件付きのタスク T7a を行うときは、`PickCommon` に `forScript: boolean`(既定は `false`)を足す。T7c を行うときは、§4 の T7c の Interfaces の関数を `preamble.ts` に足す。

Jev への問いは次の形にする。

- review: 候補ごとに `noul` を 1 問(`candidate_<i>`)。問いの文は `Reviewer: <役割 ID>`・`When to invoke:`・候補の `criteria` の順につなぐ。`state` は `{ summary, artifacts }`。
- split: Jev に問う作業ごとに `choice` を 1 問(`task_<i>`)。`<i>` は Jev に問う作業だけを数え直した番号とする。選択肢の鍵は役割 ID、値は `criteria`(空なら `null`)。`state` は `{ tasks: [{ id, summary }] }` とし、`needsContext` と、問いから外した作業(T7)を入れない。TypeSafe AI へ送る内容の種類を変えないためである(設計書 9.2)。

### 3-4. `src/lib/extra-keys.ts`(T9)

```ts
export const CACHE_TTL_ROLES: readonly RoleId[]   // レビューの 5 役割
export interface ExtraKeyOptions { roleId: RoleId; omitClaudeMd: boolean | undefined }   // undefined は既存の値を保つ
export interface ExtraKeyChanges {
  omitClaudeMd: "written" | "removed" | "unchanged"
  cacheTtl: "written" | "rewritten" | "unchanged"   // written は新しく足した、rewritten は別の値を 1h に替えた
}
export function readExtraKeys(content: string): { omitClaudeMd: boolean; cacheTtl: string | null }
export function applyExtraKeys(content: string, options: ExtraKeyOptions): { content: string; changes: ExtraKeyChanges }
```

`better-agentics-hash` は description・前置き・本文のセクションのハッシュだけを記録し、frontmatter のキーを覆わない(`src/lib/compose.ts:56-64`)。そのため、`applyExtraKeys` はハッシュを作り直さない。

### 3-5. setup の CLI の応答(T9)

既存のサブコマンドの応答は、`src/setup.ts` の現行の戻り値のまま変えない。次を足す。

```ts
// --list-coverage に足す項目
interface CoverageAdditions {
  disabled: RoleId[]                       // 設定で外した役割。uncovered からは除く
  config: "absent" | "ok" | "invalid"
  configError?: string                     // invalid のときだけ
  configRaw?: string | null                // invalid のときだけ
}
// 新しいサブコマンド --write-config --roles <ID のカンマ区切り。空文字は外す役割なし>
interface WriteConfigResult { ok: true; target: string; disabledRoles: RoleId[]; before: RoleId[] | null }   // before は absent・invalid で null
// --check に足す項目
interface CheckAdditions { omitClaudeMd: boolean; cacheTtl: string | null }   // 既存の定義の値。新規は false と null
// --write に足すオプション: --omit-claude-md true|false(省略で既存の値を保つ)
// --write に足す項目
interface WriteAdditions { extraKeys: ExtraKeyChanges }
```

### 3-6. `src/lib/notices.ts`(T10)

```ts
export function envWarnings(env: NodeJS.ProcessEnv, hasReviewDefinition: boolean): string[]
export function setupNotices(input: { definitions: Definition[]; config: ConfigState }): string[]
```

---

## 4. タスク

T1 の試作の結果で、条件付きのタスク(T7a・T7b・T7c・T8b・T8c)を行うかが決まる。条件に当たらなければ飛ばす。T1 の Step 6 の回答を待つ間に進めてよいのは、T2 と T3 だけである。T4 は S3 の結果で前置きが変わり、T5 以降は T4 を使うので、T1 の結果がそろってから進める。

### T1: 試作

設計書 13 章。S7 は実装の後(T8)に行う。S1 と S4 の effort の確認だけはユーザーの操作が要る。

**Files:**
- Create: なし(試作の資材はスクラッチに置き、コミットしない)
- Modify: この計画書の §5

- [ ] **Step 1: 確かめ方そのものを確かめる(自動)**

後の Step は `claude -p --permission-mode default --output-format stream-json --verbose` の記録で判定する。先に次の 2 つを確かめる。
- 許可の確認が要る操作(スクラッチの `.claude/` への Write)が、`-p` では拒否として記録に残るか【要確認】。残らなければ、許可の確認の判定は Step 6 でユーザーに頼む。
- S10: `claude -p` で委譲先をバックグラウンドで起動させてターンを終えたとき、完了の通知で次のターンが始まるか。始まらなければ、Step 2〜5 の委譲は、完了を待つ起動(`run_in_background: false`)で行うよう依頼文に書く。`-p` でも完了を待つ起動ができなければ【要確認】、Step 2〜5 を Step 6 でユーザーに頼む。あわせて、`availableModels` で塞いだモデルを指定したとき、警告が出るかを見る。

- [ ] **Step 2: S2 を確かめる(自動)**

前置きを手でつないで作る。材料は `assets/roles/ja/_common.md` の Preamble、`assets/roles/ja/code-review.md` の When to invoke 以外のセクション、`references/subagent-policy.md` の 3 つ。前置きのバイト数を測って記録する。前置きの末尾に「報告の先頭に PREAMBLE-READ と書く」を足し、規律に従うかの目印にする。スクラッチのプロジェクトで、次の 4 つを確かめる。
- 切り替えの条件 1: 委譲先が、プラグインの中のファイルを許可の確認なしに読めるか。
- 切り替えの条件 2: 委譲先が、1 行の指示(「最初に <絶対パス> を Read で読み、その役割と規律に従う」)に従って最初に読むか。
- 切り替えの条件 3: 委譲先が、読んだ規律に従うか。報告の先頭の PREAMBLE-READ を目印にする。
- D26 の確認: Skill ツールを外した定義の委譲先が、プラグインのキャッシュの中の SKILL.md をパスから読めるか。

あわせて、前置きの全文をオーケストレーターに依頼文へ写させ、省略が起きるかを見る。

- [ ] **Step 3: S6 と Workflow の S2 を確かめる(自動)**

スクラッチのプロジェクトの `.claude/workflows/` に一時の Workflow を置き、`agent()` で 2 つを起動する。
- Custom Agent モードの定義(better-agentics の定義を 1 つ写したもの)
- `agentType: "general-purpose"`

Workflow は、`claude -p` に「Workflow ツールで <名前> を実行する」と頼んで起動する。`-p` で起動できなければ、Step 6 でユーザーに頼む【要確認】。記録用の hook で、SubagentStart が発火するかと、その `agent_type` を取る。同じ Workflow で、エージェントがプラグインの中のファイルを許可の確認なしに読めるかも確かめる。終わったらスクラッチのプロジェクトごと消す。

- [ ] **Step 4: S3・S4 を確かめる(自動)**

- S3: 親を opus か sonnet にした `-p` のセッションで、fork に委譲させる。次の 3 つを見る。
  - fork が前置きの指示に従い、さらに委譲したり `pick-delegate` を呼んだりしないか。
  - SubagentStart の入力の `agent_type` は何か。
  - オーケストレーターに自分のモデル名から `parentModel` を書かせ、SessionStart の入力の `model` と一致するか。
- S4: 完了した委譲先に SendMessage させ、再開できるかを確かめる。対象は Custom Agent モードの定義・`general-purpose`・fork の 3 つ。`stream-json` の記録で、再開後のモデルを見る。effort は Step 6 でユーザーに頼む。

- [ ] **Step 5: S5・S8・S9 を確かめる(自動)**

- S5: `experimental:` の下に `cacheTtl: 1h` を書いた定義で委譲させて、セッションを終える。6 分後に `claude -p --resume <セッション ID>` で同じ委譲先を再開させ、`stream-json` の usage の `cache_read_input_tokens` で読み出しを見る。usage に委譲先の値が出なければ、Step 6 でユーザーに頼む。
- S8: `node <プラグイン>/scripts/setup.mjs --scaffold-fragments --lang fr --dir <スクラッチ>` を `-p` から実行させる。`.claude/better-agentics/` への書き込みで許可の確認が出るかを見る。
- S9: スクラッチの `.claude/settings.local.json` の `env` に `CLAUDE_CODE_EFFORT_LEVEL=high` を置く。SessionStart の記録用の hook から、この変数が見えるかを見る。

- [ ] **Step 6: ユーザーに依頼する**

`AskUserQuestion` で手順を示し、結果を答えてもらう。依頼するのは S1 と S4 の effort と、Step 1〜5 で取れなかった項目である。S1 と S4 の effort の手順は次のとおり。
- 対話のセッションで、`general-purpose` に `model: "haiku"`・`effort: "low"` を付けて委譲させ、`/tasks` の行でモデルと effort を見る。
- 同じ委譲を、次の 3 つの環境でも行う。
  - `CLAUDE_CODE_EFFORT_LEVEL=auto`
  - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`
  - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=true`
- 完了した委譲先に SendMessage して再開させ、`/tasks` で effort が保たれるかを見る(S4)。

- [ ] **Step 7: 結果を §5 に書き、下の分岐に当たる項目を後のタスクへ写す**

- [ ] **Step 8: コミットする**(`docs(better-agentics): 起動モード改修の試作の結果を記録する`。この計画書だけ)

#### 試作の結果による分岐

| 試作 | 想定と違うとき | 変えるタスク |
| --- | --- | --- |
| S1 | effort が届かない | T16 で README の限界に書く。設計書 2.1 の目標の改訂が要るので、オーケストレーターに報告する |
| S1 | `auto` で effort が捨てられない | T10 の警告から `auto`・`unset` を外す |
| S1 | FORCE の下で `model` を渡すとエラーになる | T7 で、`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` が有効な間は `model` を返さない |
| S2 | 切り替えの条件 1〜3 がすべて通る | T7c を行う |
| S2 | 切り替えの条件 1〜3 のどれかが通らない | T7c を行わず、前置きは全文の形のままにする |
| S2 | 写しで省略が起きる | T7c を優先して検討するよう、オーケストレーターに報告する |
| S2(Workflow) | Workflow のエージェントで許可の確認が出て、かつ T7c を行う | T7a を行い、T7c で `forScript: true` の前置きを全文のままにする |
| S2(D26) | SKILL.md をパスから読むと許可の確認が出る | T13 のスキルの渡し方に、確認が出ることを書く |
| S3 | fork がさらに委譲する | T4 の fork の前置きの指示を強める |
| S3 | 規律が二重に入る | T4 の fork の前置きから `subagent-policy.md` を外す |
| S3 | `parentModel` の申告が誤る | T13 の申告の手順を見直す |
| S4 | 再開できないモードがある | T13 の再レビューと修正の再開の文を、そのモードでは新しく起動する形にする |
| S5 | 1 時間のキャッシュが効かない | T9 で `CACHE_TTL_ROLES` を空にし、`experimental` を生成しない |
| S6 | Workflow で SubagentStart が発火しない | T7a と T7b を行う |
| S8 | 確認が出る | T14 で setup の手順に、確認が出ることを書く |
| S9 | `env` の変数が見えない | T16 で README に、警告は環境変数で設定したときにしか出ないと書く |
| S10 | 次のターンが始まらない | T13 で、`-p` では完了を待つ起動にすると書く |
| S10 | `-p` で警告が出る | T16 で README の限界の記述を改める |

### T2: 設定ファイル

設計書 7.3、4.2 の `invalid-config`、J23。

**Files:**
- Create: `plugins/better-agentics/src/lib/config.ts`
- Test: `plugins/better-agentics/src/lib/__test__/config.test.ts`

**Interfaces:**
- Consumes: `roleById`(`src/lib/roles.ts`)
- Produces: §3-1 のすべて

- [ ] **Step 1: 失敗するテストを書く**

- ファイルが無い → `{ kind: "absent" }`。`disabledRolesOf` は `[]`。
- `{"disabledRoles":["escalation","complex-review"]}` → `kind: "ok"` で、`disabledRoles` が同じ並び。
- `{"disabledRoles":[]}` → `kind: "ok"`、空配列。
- 次の中身はどれも `kind: "invalid"` になる(Review Focus 1)。`raw` に中身の文字列、`message` に理由が入り、`disabledRolesOf` は `[]` を返す。
  - 空ファイル
  - `[]`
  - `{"disabledRoles":"escalation"}`
  - `{"disabledRoles":["no-such-role"]}`
  - `{}`
- 読めないとき(同名のディレクトリを置く)→ `kind: "invalid"`、`raw: null`。
- `writeConfig` は次のように振る舞う。
  - `.claude/better-agentics/` が無くても作る。
  - `{"disabledRoles":[...]}` を 2 空白の字下げと末尾の改行で書き、`".claude/better-agentics/config.json"` を返す。
  - 書いた後の `readConfig` は `kind: "ok"` を返す。
  - 役割表に無い ID を受けると例外を投げ、ファイルを書かない。

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run plugins/better-agentics/src/lib/__test__/config.test.ts`
Expected: FAIL(`config.ts` が無い)

- [ ] **Step 3: §3-1 の関数を `src/lib/config.ts` に実装する**

- [ ] **Step 4: テスト・typecheck・lint を通す**

- [ ] **Step 5: コミットする**(`feat(better-agentics): 外した役割を記録する設定ファイルを読み書きする`)

### T3: 役割断片と `{{ROLE_ID}}`

設計書 9.1(D12・D21・J29)。

**Files:**
- Modify: `plugins/better-agentics/assets/roles/{ja,en}/_common.md`(Preamble に `{{ROLE_ID}}`)
- Modify: `plugins/better-agentics/assets/roles/{ja,en}/*.md` の 13 役割(Output Format)
- Modify: `plugins/better-agentics/assets/roles/{ja,en}/light-impl.md`(制約)
- Modify: `plugins/better-agentics/src/lib/compose.ts:36-43`(置換)
- Test: `src/lib/__test__/compose.test.ts`、`src/lib/__test__/fragments.test.ts`

**Interfaces:**
- Produces: Preamble の置換子は `{{NAME}}`・`{{ROLE_LABEL}}`・`{{ROLE_ID}}` の 3 つ。T4 と setup の翻訳(T14)がこの 3 つを使う。

- [ ] **Step 1: 失敗するテストを書く**

- `compose.test.ts`
  - 生成した定義の前置きに「役割 ID: code-review」(ja)と「Role ID: code-review」(en)が入る。
  - 1 行に同じ置換子が 2 回あっても、両方が置換される。
- `fragments.test.ts`
  - ja と en の 13 役割すべてで、Output Format に結果が無いときの書き方の 1 項目がある。判定は、Output Format の本文に、ja なら「無いとき」、en なら「If there is nothing」を含むこととする。
  - light-impl(ja・en)の制約に「全セッションに作用する設定」(en は `settings that affect every session`)を含まない。データ移行と規約のパスの項目は残る。
- 既存のテストのうち、前置きを完全一致で比べるものを、役割 ID の入った文に直す。対象は `compose.test.ts:84-90` と `fragments.test.ts:134-137` の 2 つ。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 断片と `_common.md` を書き換える(`prompt-smith:prompt-smith` を起動してから)**

- `_common.md` の Preamble は、ja を「あなたは {{NAME}}。担う役割は{{ROLE_LABEL}}である。役割 ID: {{ROLE_ID}}」、en を「You are {{NAME}}. Your role is {{ROLE_LABEL}}. Role ID: {{ROLE_ID}}」とする。
- Output Format の結果なしの文言は役割ごとに決める(設計書 15 章)。例は code-review の「指摘が無いときは『指摘なし』と書き、確かめた範囲を添える」。ja は「〜が無いときは」、en は「If there is nothing to report」で書き出す。
- light-impl の「全セッションに作用する設定(hooks など)の変更」の項目だけを消す。

- [ ] **Step 4: `compose.ts` の置換に `{{ROLE_ID}}` を足し、3 つとも `replaceAll` にする**

- [ ] **Step 5: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する。禁止語の grep を `assets/roles/` に当てる**

- [ ] **Step 6: コミットする**(`feat(better-agentics): 役割断片に役割 ID と結果が無いときの書き方を足す`。`scripts/` を含める)

### T4: 前置き

設計書 4.6(J2・J3・J5・J19)。

**Files:**
- Create: `plugins/better-agentics/src/lib/preamble.ts`
- Test: `plugins/better-agentics/src/lib/__test__/preamble.test.ts`

**Interfaces:**
- Consumes: `loadFragments`・`loadPreamble`・`checkFragments`・`vocabularyFor`(`fragments.ts`)、T3 の置換子
- Produces: §3-2 のすべて

- [ ] **Step 1: 失敗するテストを書く**

`context` は `{ pluginRoot: pluginRoot(), projectDir: <一時ディレクトリ>, lang }` とする。

- `standardPreamble("code-review", context("ja"))` は、次をこの順で含む。
  - 「あなたは code-reviewer。担う役割はコードレビューである。役割 ID: code-review」
  - `## Core Responsibilities`・`## 作業手順`・`## 制約`・`## Output Format` の各セクション
  - `subagent-policy.md` の全文
- 前置きは `## When to invoke` を含まない(ja・en とも)。
- `lang: "en"` は en の断片と ja の `subagent-policy.md` を使う。
- `lang: "fr"` で翻訳断片が無いとき、前置きの全体が en になる(Review Focus 4)。
- `lang: "fr"` で、code-review の翻訳は ready だが `_common.md` の翻訳が無いとき、前置きの全体が en になる(Review Focus 4)。
- `lang: "fr"` で、code-review と `_common.md` の翻訳がどちらも ready なら、その訳を使う。どちらかが stale なら全体が en になる。
- `forkPreamble("normal-impl", context("ja"))` は、次を含む。
  - 依頼文の作業だけを行うという指示
  - 「役割 ID: normal-impl」
  - normal-impl の `## Output Format` のセクション
  - `subagent-policy.md` の全文
- fork の前置きは、normal-impl の `## Core Responsibilities` と `## When to invoke` を含まない。
- 前置きに、§1 の禁止語を含まない。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: §3-2 を実装する**

- `{{NAME}}` に断片の `defaultName`、`{{ROLE_LABEL}}` に `label`、`{{ROLE_ID}}` に役割 ID を入れる(J3)。
- セクションの並びは `vocabularyFor(lang).bodyOrder` から `## When to invoke` を除いたものとし、区切りは空行 1 つにする。
- fork の指示の文言は、ja では「split の分担を担う担い手として、依頼文の作業だけを行う。会話の履歴にあるオーケストレーターの規律のうち、委譲と pick-delegate に関するものは当てない。依頼文が指示したときを除き、Agent ツールでさらに委譲しない。」とする。en はこれを訳す。T1 の S3 で分岐に当たれば、その扱いに従う。
- `subagent-policy.md` は `<pluginRoot>/references/subagent-policy.md` から読む。

- [ ] **Step 4: テスト・typecheck・lint を通す**

- [ ] **Step 5: コミットする**(`feat(better-agentics): Standard Agent モードと fork の前置きを組み立てる`)

### T5: 入力と依存の組み立て

設計書 4.1。

**Files:**
- Modify: `plugins/better-agentics/src/lib/pick.ts`(`PickInput`・`parseInput`・`PickDeps`)
- Modify: `plugins/better-agentics/src/pick-delegate.ts:21-30`(`PickDeps` の組み立て)
- Modify: `plugins/better-agentics/src/hooks/__test__/helpers/hook.ts:10-19`(`environment`)
- Test: `src/lib/__test__/pick.test.ts`、`src/__test__/pick-delegate.test.ts`

**Interfaces:**
- Consumes: `readConfig`(T2)、`standardPreamble`・`forkPreamble`(T4)、`loadFragments`・`pluginRoot`(`fragments.ts`)
- Produces: §3-3 の `PickCommon`・`PickInput`・`parseInput`・`PickDeps`

- [ ] **Step 1: 失敗するテストを書く**(`describe("入力")`)

- `parentModel`・`lang`・`excludeRoles` を省くと、`undefined`・`"en"`・`[]` になる。
- `split` の `tasks[]` の `needsContext` を省くと `false` になる。
- 次はどれも `invalid-input` になる。
  - `parentModel: "gpt"`(Review Focus 5)
  - `lang: "../x"`(`assertLang` の規則)
  - `excludeRoles: ["no-such-role"]`
  - `excludeRoles: "escalation"`
  - `needsContext: "yes"`
- `excludeRoles: []` は省いたのと同じになる(Review Focus 2)。
- `pick.test.ts` の `deps()`(`:50-56`)に、`config: { kind: "absent" }`・`forkEnabled: true`・`standardCriteria`・`preambles` の偽の値を足す。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

- `parseInput` を §3-3 の型に合わせて広げる。既存の検査(`pick.ts:66-111`)は変えない。
- `PickDeps` に §3-3 の項目を足す。
- `pick-delegate.ts` は次のように組み立てる。
  - `config`: `readConfig(projectDir)` の結果。
  - `forkEnabled`: `process.env.CLAUDE_CODE_FORK_SUBAGENT !== "0"`。
  - `standardCriteria`: 同梱 en の断片の `## When to invoke`。
  - `preambles`: `standardPreamble` と `forkPreamble` に `pluginRoot()` と `projectDir` を束ねたもの。
- このタスクでは、新しい項目を出力にまだ使わない。出力の形は T6 で変える。
- `hook.ts` の `environment` が消す変数に、次の 5 つを足す。親の環境の値でテストの結果が変わらないようにするためである。
  - `CLAUDE_CODE_EFFORT_LEVEL`
  - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  - `FORCE_PROMPT_CACHING_5M`
  - `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`
  - `CLAUDE_CODE_FORK_SUBAGENT`

  `pick-delegate.test.ts` の子プロセスにも、同じ 5 つを消した環境を渡す。

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): pick-delegate に親のモデル・言語・文脈の要否・除外の入力を足す`。`scripts/` を含める)

### T6: 候補・Jev の問い・出力の形

設計書 4.2〜4.4(D3・D16・D18・J1・J23・J26)。このタスクで出力のキーが変わるので、同じコミットで `SKILL.md` の `pick-delegate` のセクションを合わせる。

**Files:**
- Modify: `plugins/better-agentics/src/lib/pick.ts`(`candidatesFor`・`reviewQuestions`・`splitQuestions`・`review`・`split`・`stuck`・`pickOf` を `delegateOf` に替える)
- Modify: `plugins/better-agentics/skills/orchestration/SKILL.md:25-51`(`pick-delegate` の呼び出しのセクション)
- Test: `src/lib/__test__/pick.test.ts`、`src/__test__/pick-delegate.test.ts`

**Interfaces:**
- Consumes: `ConfigState`・`disabledRolesOf`(T2)、`rolesFor`(`roles.ts`)、T5 の `PickDeps`
- Produces: §3-3 の `Candidate`・`candidatesFor`・`Delegate`(`custom` と `standard`)・`PickOutput`

- [ ] **Step 1: 失敗するテストを書く**(`describe("候補")`・`describe("出力")`)

候補:
- 定義が 0 件の `review` では、5 役割すべてが候補になる。Jev の `questions` は 5 問で、問いの文に `Reviewer: <役割 ID>` と `standardCriteria(役割 ID)` の値が入る。
- `code-review` の定義があれば、その役割の基準は定義の `whenToInvoke` になる。他の 4 役割は `standardCriteria` の値になる。
- `split` の `choice` の選択肢の鍵は役割 ID になる。
- `config` の `disabledRoles` に入れた役割と、`excludeRoles` に入れた役割は、候補にならない。
- 外した結果、`review` の候補が 1 つになれば、Jev を呼ばずにその役割を返す。キーが無くても `ok: true` を返す。
- 外した結果 0 になれば、`no-candidates` を返す。`message` は、`excludeRoles` で尽きたか設定で尽きたかを区別して書く。
- `stuck` は Jev を呼ばない。escalation を外していれば `no-candidates` を返す。
- `config` が `invalid` なら、理由を問わず `invalid-config` を返す。`message` に `config.json` を含む(Review Focus 1)。
- 同じ役割を 2 件の定義が持てば `duplicate-role` を返す。外した役割の重複では止まらない。外した役割は候補でなく、現行も候補の中でだけ重複を見るためである(計画の判断)。
- 役割が違い `name` が同じ Custom Agent モードの候補があれば、`duplicate-role` を返す。`agentType` が `name` を使うためで、現行の検査(`pick.ts:138-148`)を残す。
- `excludeRoles` に理由と関係の無い役割(`review` で `normal-impl`)を入れても、結果は変わらない(Review Focus 2)。

出力:
- 定義のある役割は `{role, mode: "custom", agentType: <name>, p?}` で、`model`・`effort`・`preamble` を持たない。
- 定義の無い役割は `{role, mode: "standard", agentType: "general-purpose", model, effort, preamble, p?}` になる。`model`・`effort` は `roles.ts` の値、`preamble` は `deps.preambles.standard(role, lang)` の値をとる。

既存のテストの手直し。意図を保ち、次のように書き換える。
- `pick.test.ts:72-90`・`:92-106`(fallback)・`:108-127` と `:297-320` の後半は、答えの数を候補の数(5)に合わせる。
- `pick.test.ts:143-180`・`:181-195` は、選択肢の鍵を役割 ID に替える。
- `pick.test.ts:236-250`(stuck)は、出力の完全一致の比べ方を `{role, mode, agentType}` の形に替える。
- `pick.test.ts:211-234`「候補が 1 つなら Jev を呼ばない」は、`config` で他の役割を外して候補を 1 つにする。
- `pick.test.ts:289-295`「no-candidates」は、`config` で理由の役割をすべて外して再現する。
- `pick.test.ts:372-375`「役割表に無い role-id の定義は候補にしない」は、その定義の `name` が出力に現れないことを確かめる形にする。
- `pick-delegate.test.ts:31-55` は、`agent` を `agentType` に替える。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

- `candidatesFor` は `rolesFor(input.reason)` の順に、外していない役割を候補にする。定義のある役割は `definition` と `whenToInvoke` を持ち、無い役割は `definition: undefined` と `standardCriteria(id)` を持つ。
- 問いは §3-3 の形にする。Jev の答えの `choice` は役割 ID と照合する。
- このタスクでは `needsContext` を見ない。fork と self は T7 で足す。

- [ ] **Step 4: `SKILL.md:25-51` を合わせる(`prompt-smith:prompt-smith` を起動してから)**

設計書 6.2 のうち、入出力に関わる部分だけを写す。
- 入力の表に、任意の `parentModel`・`lang`・`excludeRoles` を足す。
- 出力の委譲先は、4.4 の表のとおりに Agent ツールの引数へ写す。`agentType` は `subagent_type` に渡す。`preamble` は依頼文の冒頭に置く。`mode: custom` には `model` と `effort` を渡さない。
- エラーの表に `invalid-config` を足し、`no-candidates` の説明を改める。

`needsContext` と fork は T7 で、その他の規律は T13 で写す。禁止語の grep を当てる。

- [ ] **Step 5: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する。`node plugins/better-agentics/scripts/pick-delegate.mjs --dir "$(mktemp -d)" <<<'{"reason":"stuck","task":{"summary":"x"}}'` が `{mode: "standard", agentType: "general-purpose", model: "fable", effort: "high"}` を返すことを確かめる**

- [ ] **Step 6: コミットする**(`feat(better-agentics): 定義の無い役割も候補にし、委譲先を起動の形で返す`。`scripts/` と `SKILL.md` を含める)

### T7: fork と self

設計書 4.5(D6・J4〜J7・J27)。

**Files:**
- Modify: `plugins/better-agentics/src/lib/pick.ts`(`split` の fork の判定)
- Modify: `plugins/better-agentics/skills/orchestration/SKILL.md`(T6 で写したセクションに `needsContext` と `fork` / `self` を足す)
- Test: `src/lib/__test__/pick.test.ts`、`src/__test__/pick-delegate.test.ts`

**Interfaces:**
- Consumes: T6 のすべて
- Produces: §3-3 の `Delegate`(`fork`)・`SelfAssignment`・`FORK_ROLES`

- [ ] **Step 1: 失敗するテストを書く**(`describe("fork")`)

- `split` で、`needsContext: true`・`parentModel: "sonnet"` とし、Jev が定義の無い `normal-impl` を選ぶ → `{mode: "fork", agentType: "fork", preamble}`。
- 同じ条件で、Jev が `light-impl`(fork の対象外)か `complex-impl`(opus)を選ぶ → `{id, mode: "self"}`。
- Custom Agent モードの定義の `model` が次の値のとき、`needsContext: true` の作業は `self` になる(Review Focus 3)。
  - `inherit`
  - 未設定
  - `claude-sonnet-5-5`
- 定義の `model` が `sonnet` なら fork になる。
- `parentModel` が無いか `forkEnabled: false` のとき、`needsContext: true` の作業は Jev の問いから外れ、`self` になる。他の作業は通常どおり返る(Review Focus 5)。問いの `state` に外した作業が入らず、`task_<i>` の番号は詰めてある。
- 全作業が `self` になったときは Jev を呼ばない。
- `pick-delegate.test.ts`: `CLAUDE_CODE_FORK_SUBAGENT=0` で、`needsContext: true` の作業が `self` になる。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

設計書 4.5 の条件を次の順で見る。
1. `reason` が `split` である。
2. 作業に `needsContext: true` が付いている。
3. `deps.forkEnabled` が真で、`parentModel` がある。満たさない作業は Jev の問いから外し、`self` にする。
4. Jev が選んだ役割が `FORK_ROLES` に入っている。
5. その役割のモデルが `parentModel` と同じである。
   - Custom Agent モードでは、定義の `model` が 4 つの別名のどれかで、`parentModel` と同じときだけ一致とみなす。
   - Standard Agent モードでは、`roles.ts` の値を比べる。

4 か 5 を満たさない作業は `self` にする。`needsContext` の無い作業は、T6 のとおり `custom` か `standard` で返す。T1 の S1 で FORCE の分岐に当たったときは、その扱いもここで入れる。

- [ ] **Step 4: `SKILL.md` に足す(`prompt-smith:prompt-smith` を起動してから)**

設計書 6.2 の `needsContext` の付け方と、6.4 の `fork` / `self` の扱い(J6)を写す。禁止語の grep を当てる。

- [ ] **Step 5: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 6: コミットする**(`feat(better-agentics): 文脈の要る分担を fork か自分で行う形で返す`。`scripts/` と `SKILL.md` を含める)

### T7a(条件付き): スクリプトへ渡す指定を見分ける入力

T1 の S6 で Workflow の SubagentStart が発火しなかったとき、または「S2 の条件 1〜3 が通り、かつ Workflow のエージェントで許可の確認が出た」ときだけ行う。設計書 4.1 の最後の箇条、13 章 S2・S6。

**Files:**
- Modify: `plugins/better-agentics/src/lib/pick.ts`(`PickCommon`・`parseInput`)
- Modify: `plugins/better-agentics/skills/orchestration/SKILL.md`(`pick-delegate` の呼び出しのセクションに `forScript` を足す)
- Test: `src/lib/__test__/pick.test.ts`

**Interfaces:**
- Produces: `PickCommon.forScript: boolean`(既定は `false`)。このタスクでは入力を受けるだけで、出力を変えない。T7b と T7c がこの値を使う。

- [ ] **Step 1: 失敗するテストを書く。`forScript` を省くと `false`、`"yes"` なら `invalid-input`**

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する。`SKILL.md` には「このスキルの外の手順のスクリプトへ委譲の指定を渡すときは、`forScript: true` を付ける」と書く。禁止語の grep を当てる**

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): 外側の手順のスクリプトへ渡す指定を見分ける入力を足す`。`scripts/` と `SKILL.md` を含める)

### T7b(条件付き): スクリプトへ渡す Custom Agent モードの委譲先に規律を前置きで渡す

T1 の S6 で Workflow の SubagentStart が発火しなかったときだけ行う。S2 の条件だけで T7a を行ったときは行わない。SubagentStart が規律を注入する環境で前置きにも入れると、規律が二重に入るためである。設計書 13 章 S6。

**Files:**
- Modify: `plugins/better-agentics/src/lib/pick.ts`(`delegateOf`)
- Modify: `plugins/better-agentics/src/lib/preamble.ts`(Custom Agent モードの前置き)
- Test: `src/lib/__test__/pick.test.ts`、`src/lib/__test__/preamble.test.ts`

**Interfaces:**
- Consumes: T7a の `forScript`
- Produces: `export function customPreamble(roleId: RoleId, context: PreambleContext): string`。中身は「役割 ID: <役割 ID>」の行と `subagent-policy.md` の全文とする。役割の指示は定義の本文にあるので入れない。`forScript: true` のときだけ、`mode: "custom"` の委譲先に `preamble` として付ける。

- [ ] **Step 1: 失敗するテストを書く。`forScript: true` の `custom` に前置きが付き、`false` では付かない**

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): スクリプトへ渡す Custom Agent モードの委譲先にも規律を前置きで渡す`。`scripts/` を含める)

### T7c(条件付き): 前置きをファイルで指す形

T1 の S2 で、切り替えの条件 1〜3 がすべて通ったときだけ行う。設計書 4.6 の後半。前置きのファイルは `scripts/preambles/` に置く。ARCHITECTURE は `scripts/` を「単発実行のバンドル出力」と書くので、このタスクを行ったときは、T16 で `/metatron:update` を起動して記述を追随させる。

**Files:**
- Modify: `plugins/better-agentics/src/lib/preamble.ts`
- Modify: `plugins/better-agentics/build.ts`(esbuild の後に前置きのファイルを書く)
- Modify: `plugins/better-agentics/src/lib/pick.ts`(`preamble` に 1 行の指示を入れる)
- Test: `src/lib/__test__/preamble.test.ts`、`src/lib/__test__/pick.test.ts`

**Interfaces:**
- Consumes: T4 の `standardPreamble`・`forkPreamble`。T7a を行ったときは `forScript`。
- Produces:

```ts
export function preambleFile(kind: "standard" | "fork", roleId: RoleId, lang: "ja" | "en", pluginRoot: string): string   // <pluginRoot>/scripts/preambles/<lang>/<kind>-<roleId>.md の絶対パス
export function preambleReference(path: string, lang: "ja" | "en"): string   // 「最初に <path> を Read で読み、その役割と規律に従う。」の 1 行
export function writePreambleFiles(outDir: string, pluginRoot: string): string[]   // 書いたファイルのパス
```

- [ ] **Step 1: 失敗するテストを書く**

- `preambleReference` は ja・en の 1 行を返す。
- `writePreambleFiles(<一時ディレクトリ>, pluginRoot())` は、ja・en の 13 役割の `standard-<role>.md` と、fork の 3 役割の `fork-<role>.md` を書く。中身は `standardPreamble` と `forkPreamble` の結果と一致する。テストはビルドの出力を読まず、一時ディレクトリに書いて比べる。
- `pick` は、`lang` が ja・en のときだけ `preamble` を 1 行の指示にする。それ以外の言語は全文のままにする。
- T7a を行ったときは、`forScript: true` の `preamble` を全文のままにする(S2 の Workflow の分岐)。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する。`build.ts` は `writePreambleFiles("./scripts/preambles", ".")` を呼ぶ**

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する。`scripts/preambles/` に 32 ファイルがあることを確かめる**

- [ ] **Step 5: コミットする**(`feat(better-agentics): ja と en の前置きをファイルで指す形にする`。`scripts/` を含める)

### T8: 全役割を候補にしたときの Jev の選び方(S7)

設計書 13 章 S7。T7 までの実装を使う。

- [ ] **Step 1: 定義の無いスクラッチのプロジェクトで、次の作業を実際の Jev に 2 回ずつ通す**

このリポジトリの 13 件の定義は、`## When to invoke` が同梱 en の断片と同じである(2026-11-11 のレビューで 13 件とも確かめた)。そのため、定義のあるプロジェクトと比べても Jev の揺れしか出ない。偏りは、下の判定で見る。

split の作業は次の 16 件とする。各行の `s01` などが `id`、続く英文が `summary` である。
- s01 Rename the config key timeoutMs to timeout_ms in 40 YAML files
- s02 Add input validation to one CLI flag and a unit test for it
- s03 Redesign the caching layer to support multi-process locking
- s04 Find every place where the environment variable AMATSUKA_X is read
- s05 Look up the latest Claude Code changelog entries about subagent effort
- s06 Run the end-to-end browser check of the settings page and capture screenshots
- s07 Write the README section describing the new setup flow
- s08 Fix a flaky test caused by a race condition in the file watcher
- s09 Convert 25 test files from callbacks to async/await
- s10 Implement a new subcommand that parses a manifest and writes a report
- s11 Investigate why the build output differs between two machines
- s12 Summarize the differences between two design documents
- s13 Update the plugin hook configuration to add a new SessionStart hook
- s14 Migrate stored JSON state files to a new schema version
- s15 Check which npm packages in the workspace are outdated and their latest versions
- s16 Translate 13 role fragment files from Japanese to English keeping their structure

外側の手順の形の単位として、次の 2 件を足す。
- u01 Take one sub-story from design through a pull request: write the design, implement it with tests, and open the pull request
- u02 Write the design document for one sub-story within the given scope and return any decision outside that scope instead of deciding it

review の作業は次の 8 件とする。各行の英文が `summary` で、`artifacts` は空配列とする。
- r01 Review the diff of a small bug fix in a date parser
- r02 Review a design document for a new plugin feature before showing it to the user
- r03 Final review of a large refactor against its design intent before merging
- r04 Find ways the new permission guard hook can be bypassed
- r05 Review an implementation plan for gaps and implicit assumptions
- r06 Review changes to hooks.json that affect every session
- r07 Review a README update that contains no code changes
- r08 Review a data migration script and its rollback procedure

- [ ] **Step 2: 判定する**

次のどれかに当たれば「偏る」とし、T8b を行う(計画の判断)。Jev の 1 回ごとの揺れで判定しないよう、2 回の実行がどちらも当たったときだけ数える。
- 2026-11-10 の比較でユーザーが判定した 9 件で、Jev の選択が判定と違う。判定は次のとおりで、出典はこの日の会話の記録 `docs/chat/2026/1110/phyllis998/0810-better-agentics-background-delegation.md` である。split は役割が一致すること、review は判定の役割をすべて含むこと(他の役割が加わってもよい)を「判定どおり」とする。
  - split: s08 は `normal-impl`、s11 は `explore`、s13 は `light-impl`、s14 は `normal-impl`、s16 は `general`
  - review: r02 と r05 は `knowledge-elicitation` を含む。r06 は `adversarial-review` と `code-review` を含む。r08 は `adversarial-review` と `knowledge-elicitation` を含む
- split の 16 件のうち 8 件以上が、同じ 1 役割に割り当てられる。
- review の 8 件のうち 6 件以上で、5 役割すべてが選ばれる。

s13 は、2026-11-10 にも Jev の 2 回の実行で選択が割れた(`light-impl` と `normal-impl`)。1 回だけ違うときは偏りに数えず、§5 に揺れとして記録する。

u01・u02 に読み取りだけの役割(`kind: readonly`)が選ばれたときは、T8c を行う。

- [ ] **Step 3: 結果を §5 に書いてコミットする**(`docs(better-agentics): 全役割を候補にしたときの Jev の選び方を記録する`)

### T8b(条件付き): When to invoke の見直し

T8 で「偏る」と判定したときだけ行う。設計書 13 章 S7。

- [ ] **Step 1: 当たった作業と、選ばれた役割と選ぶべき役割の When to invoke を並べて、オーケストレーターに報告する**

When to invoke は委譲先の選択の基準で、利用者の定義にも写っている。書き換えの案は、ユーザーの判断を仰いでから断片に入れる。

- [ ] **Step 2: 決まった案を `assets/roles/{ja,en}/*.md` の `## When to invoke` に入れ、T8 の Step 1〜2 を通し直す。ビルドで `scripts/` を再生成してコミットする**

### T8c(条件付き): 外側の手順の単位の問い方の見直し

T8 で u01・u02 に読み取りだけの役割が選ばれたときだけ行う。設計書 13 章 S7 の後半。断片ではなく、外側の手順の単位を `pick-delegate` に渡すときの `summary` の書き方を見直す。`summary` を書くのは better-agentics の規律に従うオーケストレーターなので(J25)、書き方は better-agentics の側で決めてよい(計画の判断)。

- [ ] **Step 1: u01・u02 の `summary` を、書き込む作業であることが分かる形(例: 「書き込む範囲」と「成果物」を先頭に書く)に書き直して通し直し、選ばれる役割が変わるかを確かめる**

- [ ] **Step 2: 効いた書き方を、T13 で `SKILL.md` の外側の手順のセクション(J25 の箇条)に写す項目として §5 に書く。コミットする**

### T9: setup の CLI

設計書 7.1・7.2・7.3(D8・D11・J12・J24)。

**Files:**
- Create: `plugins/better-agentics/src/lib/extra-keys.ts`
- Modify: `plugins/better-agentics/src/setup.ts`(`COMMANDS` に `write-config`、`--list-coverage`・`--check`・`--write`、オプション `--omit-claude-md`)
- Test: `src/lib/__test__/extra-keys.test.ts`、`src/__test__/setup.test.ts`

**Interfaces:**
- Consumes: `readConfig`・`writeConfig`(T2)、`parseDocument`・`render`(`document.ts`)
- Produces: §3-4・§3-5 のすべて

- [ ] **Step 1: 失敗するテストを書く**

`extra-keys.test.ts`:
- `knowledge-elicitation` に `omitClaudeMd: true` を当てると、frontmatter に `omitClaudeMd: true` の行が入り、`changes.omitClaudeMd` は `"written"` になる。
- 既存の `omitClaudeMd: true` の定義に `false` を当てると行が消え、`"removed"` になる。`undefined` なら変えず、`"unchanged"` になる。
- レビューの 5 役割では、次のように `cacheTtl` を書く。
  - `experimental` が無ければ `experimental:` と `  cacheTtl: 1h` を足し、`"written"` にする。
  - 既存の `experimental:` に `  other: x` があれば、残したまま `  cacheTtl: 1h` を足し、`"written"` にする。
  - 既存の `cacheTtl: 5m` は `1h` に替え、`"rewritten"` にする。既に `1h` なら `"unchanged"` にする。
- レビュー以外の役割では、`experimental` に触れない。
- `applyExtraKeys` の後でも、`better-agentics-hash` と本文は変わらない。

`setup.test.ts`:
- `--write-config --roles escalation,complex-review` は設定ファイルを書き、`{ok, target, disabledRoles, before: null}` を返す。2 回目の `--roles ""` は `disabledRoles: []`、`before: ["escalation","complex-review"]` を返す。
- `--write-config --roles no-such-role` は `ok: false` で、`error` に `no-such-role` を含む。
- `--list-coverage` は、外した役割を `disabled` に入れ、`uncovered` に入れない。
- `--list-coverage` は、壊れた設定ファイルなら `config: "invalid"`・`configError`・`configRaw` を返す(Review Focus 1)。
- 新規の `--write --role knowledge-elicitation --omit-claude-md true` は、`omitClaudeMd: true` と `experimental.cacheTtl: 1h` を書き、`extraKeys` を返す。
- 再生成の `--write` で `--omit-claude-md` を省くと、既存の値を保つ。
- `--check` は、既存の定義の `omitClaudeMd` と `cacheTtl` を返す。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

- `applyExtraKeys` は `parseDocument` で読み、`meta` の `omitClaudeMd` と `experimental` だけを書き換え、`render` で組み立てる。`GENERATED_KEYS`(`regenerate.ts:34-43`)には入れない(J12)。新しいキーは frontmatter の末尾に足し、既存のキーはその位置で書き換える。
- `--write` は `compose` か `merge` の結果に `applyExtraKeys` を当ててから書く。`--omit-claude-md` は `true` / `false` だけを受け、他の値はエラーにする。
- T1 の S5 で 1 時間のキャッシュが効かなかったときは、`CACHE_TTL_ROLES` を空にする。

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): setup に外す役割の記録と omitClaudeMd・キャッシュの寿命の書き込みを足す`。`scripts/` を含める)

### T10: SessionStart

設計書 8.1(D10・J9・J11・J23・J39)。

**Files:**
- Create: `plugins/better-agentics/src/lib/notices.ts`
- Modify: `plugins/better-agentics/src/hooks/session-start.ts:28-70`(`definitionNotes`・`build`)
- Test: `src/lib/__test__/notices.test.ts`、`src/hooks/__test__/session-start.test.ts`

**Interfaces:**
- Consumes: `readConfig`・`disabledRolesOf`(T2)、`rolesFor`
- Produces: §3-6 のすべて

- [ ] **Step 1: 失敗するテストを書く**

`notices.test.ts`(`envWarnings`)では、次の 6 つの環境で 1 文ずつ出る。
- `CLAUDE_CODE_EFFORT_LEVEL=high`
- `CLAUDE_CODE_EFFORT_LEVEL=auto`
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=yes`
- `FORCE_PROMPT_CACHING_5M=1`(レビューの定義がある)
- `FORCE_PROMPT_CACHING_5M=true`(レビューの定義がある。空でない値はすべて「設定されている」とみなす)
- `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=5m`(レビューの定義がある)

次の環境では出ない。
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` が `0` か `false`
- `FORCE_PROMPT_CACHING_5M=1`(レビューの定義が無い)
- `CLAUDE_CODE_SUBAGENT_MODEL=haiku` だけ

`notices.test.ts`(`setupNotices`)は、次の場合を確かめる。
- 定義が 0 件のとき、出すのは「定義の無い役割は Standard Agent モードで委譲する。調整したい役割の定義と、外す役割は better-agentics:setup で決める。」だけ。設定ファイルの状態は問わない(ただし invalid は下の知らせも出す)。
- better-agentics の定義が 1 件以上あり、設定ファイルが無く、定義の無い役割があるとき、移行の知らせを出す。知らせには、定義の無い役割の ID を並べる(J11)。
- 定義の無い役割が 0 件なら、設定ファイルが無くても移行の知らせを出さない。動きが変わらないためである(計画の判断)。
- 外した役割に定義があれば、その役割と定義名を並べる。
- review か split の役割をすべて外していれば、止まる委譲の種類を書く。escalation だけを外しても出さない(J39)。
- 設定ファイルが `invalid` なら、`config.json` を作り直すよう書く(Review Focus 1)。

`session-start.test.ts`:
- 既存の「定義が無ければ setup を案内する」の期待値を、新しい文に直す。
- 既存の `:68-71` と `:73-83` は、定義 1 件・設定ファイル無しで使用指示だけを期待している。T10 では移行の知らせが出るので、`{"disabledRoles":[]}` の設定ファイルを置き、意図(使用指示だけが出る)を保つ。`:73-83` では、`CLAUDE_PROJECT_DIR` に渡すほうのディレクトリに置く。
- `inject` で、警告と知らせが使用指示の後に並ぶ。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装する**

- `definitionNotes` の定義 0 件の文を `setupNotices` に移す。重複と未知の role-id の知らせは現行のまま残す。
- `build` は `inject` のとき、次の順に `\n\n` でつなぐ。
  1. 使用指示
  2. `setupNotices`
  3. 重複と未知の知らせ
  4. `envWarnings`
- T1 の S1 で `auto` で捨てられないと分かれば、`auto`・`unset` を警告から外す。

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): SessionStart で移行・外した役割・上書きする環境変数を知らせる`。`scripts/` を含める)

### T11: SubagentStart

設計書 8.2(J29)。

**Files:**
- Modify: `plugins/better-agentics/src/hooks/subagent-start.ts:21-28`(照合で一致した定義を取り、注入に役割 ID を添える)
- Test: `src/hooks/__test__/subagent-start.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

- `name` が一致した定義の役割が役割表にあれば、注入の 1 行目は `役割 ID: <role>` になり、空行の後に `subagent-policy.md` の全文が続く。
- 役割表に無い role-id の定義では、1 行目を足さず全文だけを注入する。
- 足した後も、既存のテスト(`:92`)と同じく、全体が 10,000 文字未満である。

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: `:21-23` の `.some()` を `.find()` に替え、一致した定義の `role` を使う**

- [ ] **Step 4: テスト・typecheck・lint を通し、ビルドで `scripts/` を再生成する**

- [ ] **Step 5: コミットする**(`feat(better-agentics): SubagentStart の注入に役割 ID を添える`。`scripts/` を含める)

### T12: サブエージェントの規律

設計書 5.2(G3・J13・J15・J16・J28・J29・D26)。

**Files:**
- Modify: `plugins/better-agentics/references/subagent-policy.md`

- [ ] **Step 1: `prompt-smith:prompt-smith` を起動し、設計書 5.2 の 8 項目を写す**

1. 依頼文が作業として明示した外部への操作(push・PR の作成・Issue の起票など)は、`:27` の例外とする。
2. 依頼文が作業と書いてよい範囲を列挙していれば、`:18` の前半(役割に含まれない作業の差し戻し)より列挙を優先する。後半(範囲の拡大)には当てない(J16)。
3. 作業を断る・差し戻すときは、報告の先頭に「役割 ID: <役割 ID>」と書く(J29)。
4. `:32-33` を「依頼文が名前とパスで示したスキルだけを読む。Skill ツールが無ければパスから読む」に改める(D26)。
5. 依頼文が出力の形を定めていれば、役割の Output Format より依頼文に従う(J28)。
6. 役割断片の「引き受けない」「差し戻す」の条項は、2 の優先の対象に入れない(J16)。設計書の例と根拠の説明は写さない。
7. `:3` を「依頼文の冒頭に役割の指定があればそれに従う。無ければ、定義本文か前置きに書かれた役割で作業する」に改める(J15)。
8. 依頼文が委譲を指示したときを除き、Agent ツールでさらに委譲しない。必要なら差し戻す(J13)。

- [ ] **Step 2: `pnpm vitest run plugins/better-agentics/src/hooks/__test__/subagent-start.test.ts` で、全文が 10,000 文字未満のままであることを確かめる。禁止語の grep を当てる**

- [ ] **Step 3: ビルドで `scripts/` を再生成する(前置きが `subagent-policy.md` を読むため。T7c を行ったときはファイルが変わる)。コミットする**(`docs(better-agentics): サブエージェントの規律に外側の手順との整合と役割 ID の報告を足す`)

### T13: オーケストレーターの規律

設計書 5.1・6.1〜6.5(D2・D5・D13〜D15・D19・D20・D22〜D29・J7・J8・J20〜J22・J25・J26・J30〜J40)。

**Files:**
- Modify: `plugins/better-agentics/skills/orchestration/SKILL.md`

- [ ] **Step 1: `prompt-smith:prompt-smith` を起動する**

- [ ] **Step 2: 設計書の次のセクションを、規律の文面に写す**

セクションごとの変更は、設計書が行番号つきで決めている。ここでは写す範囲と、写したかを確かめる決定の番号を挙げる。設計書の中の codiel への言及と、「規律の文面には写さない」と書かれた説明は写さない。

| 設計書 | 規律の場所(現行) | 写す決定 |
| --- | --- | --- |
| 5.1 | 新しいセクション「外側の手順」 | D22・名前で起動の定義・J32・J25・J40 の 2 箇条・J26・J35・D23・J33・J39・J8・J30・D20 とその例外の文面 |
| 6.1 | `:9-23` | D13・D2・D19・D27 |
| 6.2 | `:25-51`(T6・T7 の残り) | J21・J20 |
| 6.3 | `:53-81` | D25・`:22` の改め・D24・J31・J34・D29・J36〜J40・D28・D5 |
| 6.4 | `:83-129` | D27・J6(T7 で写した分を除く) |
| 6.5 | `:141-159` | 前置きの置き方・Output Format の文・D26 |

6.5 の、読み込んでいないスキルの絶対パスの求め方は、次のように書く(設計書 15 章の決め残しを、計画で決めた)。
- ユーザーのスキル: `~/.claude/skills/<skill>/SKILL.md`
- プロジェクトのスキル: `<project>/.claude/skills/<skill>/SKILL.md`
- プラグインのスキル: `~/.claude/plugins/installed_plugins.json` を、Grep で `"<plugin>@` を含む項目の前後だけ読む。ファイルは 20KB を超えるので、丸ごと読まない。項目の選び方は次の順とする。
  1. `scope` が `project` か `local` で、`projectPath` が今のプロジェクトのもの。git worktree の中では、`git rev-parse --path-format=absolute --git-common-dir` の親(元のリポジトリ)とも照らす。
  2. 1 が無ければ、`scope: "user"` のもの。
  3. 選んだ項目の `installPath` の下の `skills/<skill>/SKILL.md` を使う。
- どれでも見つからないとき(`--plugin-dir` で読み込んだプラグインなど)は、パスを渡さず名前だけを示す。Skill ツールの無い委譲先には、そのスキルを要る作業を渡さない。

- [ ] **Step 3: T1 の分岐に当たった項目(S2 の D26・S3・S4・S10)と、T8c で §5 に書いた項目を写す。T6・T7・T7a で `SKILL.md` に入れた文は残し、外側の手順のセクションへ移すときも二重にしない**

- [ ] **Step 4: 写し漏れを確かめる**

Step 2 の表の決定を 1 つずつ見て、規律の文面に対応する文があることを確かめる。結果は §5 に表で残す。禁止語の grep を当てる。

- [ ] **Step 5: コミットする**(`docs(better-agentics): オーケストレーターの規律を起動モードと外側の手順の原則に合わせる`)

### T14: setup の規律

設計書 7.1・7.2・9.1(J23・J24・J12・D8・D11)。

**Files:**
- Modify: `plugins/better-agentics/skills/setup/SKILL.md`

- [ ] **Step 1: `prompt-smith:prompt-smith` を起動する**

- [ ] **Step 2: 次を写す**

- 前提の文: setup は委譲を使うための必須の手順ではなく、定義を作る手順と役割を外す手順である(7.1)。
- ステップ 2 と 3 の間に、「外す役割の見直し」のステップを足す(J24)。
  - 13 役割の状態の一覧を質問の中に入れる。
  - 自由入力の扱い、役割表に無い ID の聞き直し、review か split をすべて外したときの確認を書く。
  - 壊れた設定ファイルの扱い(`--list-coverage` の `configRaw` を示して作り直すかを聞く。J23)を書く。
  - 答えが決まった時点で、必ず `--write-config` を呼ぶ。「変えない」でも今の値で書き、ファイルが無ければ空の `disabledRoles` で作る(7.1)。
- ステップ 6・7 のモデルの質問の「この役割は作らない」を、「定義を作らず、Standard Agent モードに任せる」に改める。
- ステップ 6・7 に `omitClaudeMd` の質問を足す(7.2)。
  - 役割ごとに 1 問ずつ、モデルと effort の質問に続けて聞く。現行の「AskUserQuestion は 1 回ずつ」の規律(`:27`)に従う。
  - 選択肢は「付けない」「付ける」とし、推奨と既存の値の並べ方は 7.2 のとおりとする。
  - `--write` に `--omit-claude-md` を渡す。
- ステップ 4 の「訳さずに残す置換子」に `{{ROLE_ID}}` を足す(`:126`)。
- ステップ 8 の報告に、次を足す。
  - 外した役割
  - `omitClaudeMd` と `cacheTtl` を書き込んだ・書き換えた・消した定義
  - 「定義はあるが外している」役割
- T1 の S8 で確認が出たときは、その旨を書く。

- [ ] **Step 3: 禁止語の grep を当てる**

- [ ] **Step 4: コミットする**(`docs(better-agentics): setup に外す役割の見直しと omitClaudeMd の質問を足す`)

### T15: 実機の確認

T14 までの実装で、規律とスクリプトがそろった状態を確かめる。

- [ ] **Step 1: スクラッチのプロジェクトで、`claude --plugin-dir <リポジトリ>/plugins/better-agentics` の新しいセッションを始める**

次を確かめる。
- SessionStart の使用指示と、定義 0 件の知らせ。
- `review` の委譲で、Standard Agent モードのレビュアーが前置きつきで起動する。
- 再レビューで、そのレビュアーが SendMessage で再開する。
- setup で 1 役割の定義を作り、その役割が Custom Agent モードで起動する。
- その委譲先に SubagentStart の役割 ID が届く。

- [ ] **Step 2: 結果を §5 に書く。想定と違えばオーケストレーターに報告する。コミットする**(`docs(better-agentics): 起動モード改修の実機の確認を記録する`)

### T16: 文書と全体の確認

設計書 9.2。

**Files:**
- Modify: `plugins/better-agentics/README.md`
- Modify: `plugins/better-agentics/docs/rationale.md`
- Modify: `plugins/better-agentics/.claude-plugin/plugin.json`(description だけ)
- Modify: `harness-docs/design/2026-10-26-better-agentics-design.md`(1-3、2-2、4-2、6、7、8、9、10 に注記)
- Modify: `README.md`(ルート)
- Modify: `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`
- Modify: `.serena/memories/core.md`(120-127 行。Serena の `edit_memory` で行う)

- [ ] **Step 1: README を設計書 9.2 の箇条どおりに改める**

T1 の分岐(S1・S9・S10)、T8、T15 の結果を反映する。最低の Claude Code のバージョン(2.1.302)を書く。

- [ ] **Step 2: `docs/rationale.md` に設計書 12 章の表を移す**

- [ ] **Step 3: `plugin.json` の description を改める**

「各 Agent 定義の選択基準をもとに選ぶ」を、定義の無い役割を含む形にする。バージョンは変えない。

- [ ] **Step 4: 現行の設計書の 8 セクションの冒頭に、次の注記を置く**

「2026-11-11 の改修で変わった。`harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md` の <セクション> を見る」

- [ ] **Step 5: ルートの README の better-agentics の説明を改める**

- [ ] **Step 6: 食い違いの文書を改める**

G3・G4・G5・G9・G10・G12 の better-agentics 側を解消済みにする。前置きの項目名 `preamble` は、codiel 1.2 の設計書に入った(コミット `eb0d8c85`)。`git show eb0d8c85 -- harness-docs/design/2026-11-08-codiel-1-2-workflow-modes-design.md` で `preamble` の行が足されたことを確かめてから、伝える記述を「伝達済み」と書く。

- [ ] **Step 7: Serena のメモリ `core` の better-agentics の項を改める**

候補の集め方(外していない全役割、Custom・Standard・fork・self)に合わせる。

- [ ] **Step 8: T7c を行ったときは、`/metatron:update` を起動して ARCHITECTURE の `scripts/` の記述を追随させる**

- [ ] **Step 9: 全体を確かめる**

`pnpm run test`・`pnpm run typecheck`・`pnpm run lint`・`pnpm run build` を通す。`git status` で `scripts/` に差分が残っていないことを確かめる。

- [ ] **Step 10: コミットする**(`docs(better-agentics): 起動モード改修に合わせて README と関連文書を改める`)

---

## 5. 実施記録

試作の結果と、計画から外れた判断を、タスクごとにここへ書く。

### T1: 試作(2026-11-11、Claude Code 2.1.322)

確かめ方:

- 自動の項目は、スクラッチの git リポジトリで `claude -p --permission-mode default --plugin-dir <プラグインの複製> --output-format stream-json --verbose` を実行し、記録で判定した。
- 記録用の hook は複製の `hooks/hooks.json` にだけ足し、`agent_type`・`model`・`CLAUDE_CODE_EFFORT_LEVEL` などの値だけを書き出した。
- 委譲先のモデルは、`parent_tool_use_id` を持つ assistant の記録の `message.model` で見た。
- S1 の effort・auto と S4 の effort は、ユーザーが対話のセッションの `/tasks` で確かめた。

計画から外れた判断:

- `TYPESAFE_API_KEY` と `AMATSUKA_AGENT_ENABLE_ORCHESTRATION` は、スクラッチの `settings.local.json` へ写さなかった。リポジトリの `settings.local.json` の読み取りは deny ルールで拒否される。両方とも実行中のシェルの環境変数にあり、子の `claude -p` はそれを継承した。キーをファイルに書かずに済むので、この形を採った。
- S3 の `parentModel` の照合先は、SessionStart の入力ではなく stream-json の init の `model` にした。2.1.322 の SessionStart の入力には `model` が無かった(記録用の hook で 5 セッションとも空)。
- S2 の切り替えの条件 2・3(1 行の指示に従って読み、規律に従うか)は確かめていない。条件 1 が通らず、T7c を行わないことがこの時点で決まったためである。
- スクラッチのプロジェクト・プラグインの複製・記録は、キーの値が含まれないことを `grep -F` で確かめてから消した。

| 試作 | 結果 | 判定の根拠 | 後のタスクへの影響 |
| --- | --- | --- | --- |
| Step 1 | `-p` では、許可の確認が要る操作は `result` の `permission_denials` に残る | `.claude/probe.txt` への Write が `permission_denials` に載った | 許可の確認の判定は `-p` の記録で行えた |
| S1 | `general-purpose` に渡した `model: haiku`・`effort: low` は、`/tasks` に haiku・low で出る | ユーザーの確認 | 分岐なし |
| S1(auto) | `CLAUDE_CODE_EFFORT_LEVEL=auto` では、渡した effort が捨てられる | ユーザーの確認(`/tasks` に effort が出ない) | 分岐なし。T10 の警告に `auto`・`unset` を残す |
| S1(FORCE) | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` が `1`・`true` のとき、渡した `model: haiku` は黙って `CLAUDE_CODE_SUBAGENT_MODEL` の sonnet に置き換わる。エラーは出ない | 委譲先の `message.model` が `claude-sonnet-5-5`。Agent ツールの結果にエラーなし | 分岐なし。T7 で `model` を返さない扱いは入れない |
| S2(条件 1) | 委譲先が、プラグインのキャッシュの中のファイルを Read すると、許可の確認で拒否される | `general-purpose` が `~/.claude/plugins/cache/.../references/subagent-policy.md` を Read して `permission_denials` に載った | T7c を行わない。前置きは全文の形のままにする |
| S2(写し) | opus のオーケストレーターは、3,266B の前置きを省略せずに依頼文の冒頭へ写した。委譲先は規律に従い、報告の先頭に目印を書いた | Agent の `prompt` が前置きの全文を含む。委譲先の報告の 1 行目が PREAMBLE-READ | 分岐なし |
| S2(D26) | Skill ツールの無い定義の委譲先が、プラグインのキャッシュの中の SKILL.md をパスから Read すると、許可の確認で拒否される | `tools: Read` の定義が superpowers の SKILL.md を Read して `permission_denials` に載った | T13 のスキルの渡し方に、確認が出ることを書く |
| S2(Workflow) | Workflow の `agent()` のエージェントも、プラグインのキャッシュの中のファイルを Read すると拒否される | Custom Agent モードの定義と `general-purpose` の両方が DENIED を返した | T7c を行わないので、T7a は行わない |
| S3 | fork は前置きに従い、さらに委譲せず、`pick-delegate` も Skill も呼ばなかった。SubagentStart の `agent_type` は `fork`。オーケストレーターの申告した `parentModel: opus` は init の `claude-opus-5-5` と一致した | fork のツール呼び出しは Bash(`git ls-files` など)だけ。記録用の hook の `agent_type` | 分岐なし。SubagentStart は `fork` の名前の定義と一致しないので規律を注入せず、二重にならない |
| S4 | Custom Agent モードの定義・`general-purpose`・fork の 3 つとも、完了の後に SendMessage で再開できた。再開後のモデルは保たれ(haiku は haiku のまま)、effort も low のまま保たれた | 再開後の `message.model`。effort はユーザーの確認 | 分岐なし |
| S5 | `experimental.cacheTtl: 1h` を書いた定義は 1 時間のキャッシュで書き込み、約 8 分後の再開で 14,849 トークンをキャッシュから読んだ。対照の `general-purpose` は 5 分のキャッシュで書き込み、再開時の読み出しは 0 だった | usage の `cache_creation.ephemeral_1h_input_tokens` と `cache_read_input_tokens` | 分岐なし。T9 で `CACHE_TTL_ROLES` を 5 役割のままにする |
| S6 | Workflow の `agent()` でも SubagentStart は発火し、`agent_type` は定義の `name`(`code-reviewer`)と `general-purpose` になった。`agent()` は `agentType: "general-purpose"` と `model`・`effort` を受けた | 記録用の hook | T7a・T7b を行わない |
| S8 | `setup.mjs --scaffold-fragments --lang fr` を Bash から実行しても、`.claude/better-agentics/` への書き込みで確認は出なかった | `permission_denials` が空で、ファイルが作られた | 分岐なし。T14 に確認の記述を足さない |
| S9 | `settings.local.json` の `env` に置いた `CLAUDE_CODE_EFFORT_LEVEL=high` は、SessionStart の hook のプロセスに見える | 記録用の hook の値が `high` | 分岐なし |
| S10 | `-p` で委譲先をバックグラウンドに残してターンを終えると、完了の通知で次のターンが始まる | `result` が 2 回記録され、2 回目に委譲先の返答がある | 分岐なし。T13 に完了を待つ起動の記述を足さない |
| S10(availableModels) | `availableModels: ["sonnet","haiku"]` の下で `model: opus` を渡すと、`-p` では警告なしに置き換わった | Agent ツールの結果と記録に警告が無い。委譲先は自分を Sonnet と答えた | T16 で README の限界の記述を「`-p` では警告が出ない」と確かめた形に改める |

試作の途中で分かった、分岐の表に無い事項:

- `-p` の `default` の許可モードでは、SessionStart が指示した `better-agentics:orchestration` の Skill の呼び出しも `permission_denials` に載る。`-p` で better-agentics の規律を使う利用者は、Skill を許可しておく必要がある。T16 で README の限界に書く。

### T8: 全役割を候補にしたときの Jev の選び方(2026-11-11)

定義の無いスクラッチのプロジェクトで、T7 までの `scripts/pick-delegate.mjs` を実際の Jev に 2 回ずつ通した。split は 18 件を 1 回の呼び出しで、review は 8 件を 1 件ずつ問うた。

split の結果は、2 回とも同じ役割を選んだ。p は 1 回目の値である。

| 作業 | 選ばれた役割(p) | 2026-11-10 の判定 |
| --- | --- | --- |
| s01 | light-impl(1.00) | |
| s02 | normal-impl(0.90) | |
| s03 | complex-impl(1.00) | |
| s04 | explore(1.00) | |
| s05 | realtime-research(1.00) | |
| s06 | e2e-verify(1.00) | |
| s07 | general(1.00) | |
| s08 | normal-impl(0.74) | normal-impl(一致) |
| s09 | light-impl(0.98) | |
| s10 | normal-impl(0.59) | |
| s11 | explore(0.87) | explore(一致) |
| s12 | general(0.97) | |
| s13 | light-impl(0.72) | light-impl(一致) |
| s14 | normal-impl(0.40) | normal-impl(一致) |
| s15 | realtime-research(0.78) | |
| s16 | light-impl(0.51、2 回目 0.54) | general(**2 回とも不一致**) |
| u01 | complex-impl(0.88) | |
| u02 | general(0.96) | |

review の結果は次のとおりである。

| 作業 | 1 回目 | 2 回目 | 2026-11-10 の判定 |
| --- | --- | --- | --- |
| r01 | code-review | code-review | |
| r02 | design-review・knowledge-elicitation | 同じ | knowledge-elicitation を含む(一致) |
| r03 | complex-review | complex-review | |
| r04 | adversarial-review | adversarial-review | |
| r05 | design-review・knowledge-elicitation | 同じ | knowledge-elicitation を含む(一致) |
| r06 | code-review(0.49、`fallback: true`) | code-review・adversarial-review(0.51・0.51) | adversarial-review と code-review を含む(1 回目だけ不一致) |
| r07 | knowledge-elicitation | knowledge-elicitation | |
| r08 | knowledge-elicitation・adversarial-review | 同じ | adversarial-review と knowledge-elicitation を含む(一致) |

判定:

- 2 回とも判定と違ったのは s16(Japanese から English への 13 ファイルの翻訳)だけである。Jev は general ではなく light-impl を選んだ。計画の判定の 1 つ目に当たるので「偏る」とし、T8b を行う。
- r06 は 1 回目だけ判定と違い、2 回目は判定どおりだった。偏りに数えず、揺れとして記録する。adversarial-review の p は 2 回とも 0.5 の前後だった。
- split で同じ 1 役割に割り当てられた作業は、最多で light-impl と normal-impl の 4 件ずつだった。8 件に届かない。
- review で 5 役割すべてが選ばれた作業は無かった。
- u01 は complex-impl、u02 は general で、どちらも読み取りだけの役割ではない。T8c は行わない。

### T8b: When to invoke の見直し(2026-11-11)

ユーザーに案を示し、次の 2 件を決めてもらった。どちらも、案を一時のコピーに入れて実際の Jev に通した結果を添えて示した。

1. s16 の偏りへの対処として、ja・en の断片に 1 行ずつ足した。
   - general: 「- Use to translate documents or other prose, including many files at once.」
   - light-impl: 「- Do not use for translating or writing prose.」
   - general だけに足す案は、試験で s14 が 1 回 light-impl に揺れたので採らなかった。
2. 1 を入れて通し直すと、r06 が 2 回とも code-review だけになり、計画の判定に当たった。review の断片は変えていない。r06 の adversarial-review の p は 0.5 の前後で、それまでの 4 回では 1 回だけ選ばれていた。そこで adversarial-review の ja・en の断片に 1 行足した。
   - adversarial-review: 「- A failure is costly when it affects every session or stored data, such as changes to hooks, permissions, or data migrations.」

2 件を入れた後、T8 の Step 1〜2 を通し直した結果は次のとおりである。

- split で 2 回とも判定と違う作業は無かった。s16 は 2 回とも general になった。s14 は 2 回目だけ light-impl になり、1 回だけなので揺れとして記録する。
- review で 2 回とも判定と違う作業は無かった。r06 は 2 回とも adversarial-review を選んだ(p 0.94)。code-review は 1 回目だけ選ばれ(p 0.53)、2 回目は 0.5 を下回った。判定の役割をすべて含んだのは 1 回目だけなので、揺れとして記録する。
- r08 の adversarial-review の p は 0.72 から 0.92 に上がった。r01・r07 など他の 6 件の選び方は変わらなかった。
- 2 回とも判定と違う作業は無く、偏りの判定には当たらない。

### T13: オーケストレーターの規律の写し漏れの確認(2026-11-11)

計画の Step 2 の表の決定を 1 つずつ、`skills/orchestration/SKILL.md` の対応する箇所と照らした。禁止語の grep は 0 件だった。`-wi run` の当たりは無かった(`run_in_background` は語の境界に当たらない)。

| 設計書 | 決定 | SKILL.md の箇所 |
| --- | --- | --- |
| 5.1 | D22 | 「外側の手順」の 1〜2 番目の箇条(両方に従う原則と、優先する 2 つの場合) |
| 5.1 | 名前で起動の定義 | 「外側の手順」の 3 番目の箇条と、その下の 3 項目 |
| 5.1 | J32 | 「外側の手順」の 4 番目の箇条(自分から読み込んだスキルとの間ではこのスキルを優先) |
| 5.1 | J25 | 「外側の手順」の作業の種類で `reason` を選ぶ箇条 |
| 5.1 | J40(2 箇条) | 「外側の手順」の文書の修正の箇条(スクリプトへ渡す単位と、自分が担い手を決める単位) |
| 5.1 | J26 | 「委譲先が断ったとき」の `excludeRoles` で呼び直す箇条 |
| 5.1 | J35 | 「委譲先が断ったとき」の役割を知る 3 つの手順と、2 回で尽きる箇条 |
| 5.1 | D23 | 「委譲先が断ったとき」の候補が尽きたときの箇条 |
| 5.1 | J33 | 「委譲先が断ったとき」の `review` の候補が尽きたときの箇条 |
| 5.1 | J39 | 「委譲先が断ったとき」の最後の箇条と、「修正の担い手」の `stuck` の `no-candidates` の箇条 |
| 5.1 | J8 | 「外側の手順」の 1 件だけ受け取るときの箇条 |
| 5.1 | J30 | 「外側の手順」の `needsContext` の箇条と、`split` の入力の表 |
| 5.1 | D20 とその例外 | 「外側の手順」の最後の 3 箇条 |
| 6.1 | D13 | 理由の表の `split` の行 |
| 6.1 | D2・D19 | 「自分で行う作業と委譲する場面」の待つだけの委譲の 2 箇条 |
| 6.1 | D27 | 自分で行う作業の列挙から「テスト」を外した |
| 6.2 | J21 | 「pick-delegate の呼び出し」の `run_in_background: true` と、完了の通知を待つ箇条 |
| 6.2 | J20 | 「pick-delegate の呼び出し」の起動がエラーになったときの箇条 |
| 6.3 | D25・D14 | 必須の時点の 2・3 と、`git diff <base>..<head>` を渡す箇条 |
| 6.3 | `:22` の改め | 「自分で行う作業と委譲する場面」の、必須のレビューの前の `ok: false` の箇条と、「review」のレビューを終えるまで進まない文 |
| 6.3 | D24・J31 | 「指摘への対応と再レビュー」の対応の定義、上限なく回す箇条、critical・high が無い巡で判断を仰ぐ箇条 |
| 6.3 | J34 | 「指摘への対応と再レビュー」の答えが「直す」ときの箇条 |
| 6.3 | D29・J38・J36・J37 | 「修正の担い手」のラウンドの規則、`pick-delegate` を呼ばずに起動し直す箇条、`stuck` の 3 条件を当てない箇条 |
| 6.3 | J40 | 「修正の担い手」の文書の修正の箇条 |
| 6.3 | J22 | 「依頼の仕方」の文書を編集しない箇条 |
| 6.3 | D28 | 採否の軸を言葉にできないときに `AskUserQuestion` で聞く文を消した |
| 6.3 | D5 | 「指摘への対応と再レビュー」の SendMessage で続きを頼む箇条と、再開できないときの箇条 |
| 6.4 | J6 | `mode` の表の `fork` の行(起動が拒否されたら自分で行う) |
| 6.4 | `needsContext` | 「分担の前提」の箇条(T7 で入れた入力の表の文と合わせる) |
| 6.5 | 前置きの置き方 | 「依頼文」の最初の 2 箇条 |
| 6.5 | Output Format | 「依頼文」の Output Format の箇条 |
| 6.5 | D26 | 「依頼文」のスキルの箇条と、読み込んでいないスキルのパスの求め方 |
| T1 の分岐 | S2(D26) | 「依頼文」のスキルの最後の箇条(パスから読むと許可の確認が出る) |

計画から外れた判断:

- 委譲先が断ったときの扱い(J26・J35・D23・J33・J39)は、設計書 5.1 では外側の手順の中の話として書かれている。断りは外側の手順の外でも起き、「修正の担い手」からも参照するため、独立のセクション「委譲先が断ったとき」に置いた。

### T15: 実機の確認(2026-11-11、Claude Code 2.1.322)

スクラッチの git リポジトリで、`claude -p --plugin-dir <リポジトリ>/plugins/better-agentics --model sonnet` を 2 セッション走らせた。どちらも、`math.ts` に関数を足したコミットのレビューを頼んだ。review の候補を 1 つに絞るため、`--write-config` で code-review 以外のレビューの 4 役割を外した。

| 確かめた事項 | 結果 | 根拠 |
| --- | --- | --- |
| SessionStart の使用指示と、定義 0 件の知らせ | 使用指示の後に「定義の無い役割は Standard Agent モードで委譲する。…」が出た | stream-json の SessionStart の `hook_response` |
| `review` の委譲で、Standard Agent モードのレビュアーが前置きつきで起動する | `pick-delegate` は `{role: code-review, mode: standard, agentType: general-purpose, model: sonnet, effort: high}` を返した。オーケストレーターは前置きを依頼文の冒頭に置き、`run_in_background: true` で起動した。差分は `git diff <base>..<head>` で渡した | Agent の呼び出しの引数と `prompt` の先頭行 |
| 再レビューで、そのレビュアーが SendMessage で再開する | 2 巡目は同じ `agentId` へ SendMessage で頼み、`pick-delegate` を呼ばなかった。レビュアーは前の巡を踏まえて返した | SendMessage の呼び出しと、委譲先の `parent_tool_use_id` が 1 つだけであること |
| setup で 1 役割の定義を作り、その役割が Custom Agent モードで起動する | `setup.mjs --write --role code-review` は `experimental.cacheTtl: 1h` を書いた(`extraKeys.cacheTtl: written`)。次のセッションで `pick-delegate` は `{mode: custom, agentType: code-reviewer}` を返し、Agent は `model`・`effort` 無しで起動した | setup の応答と Agent の呼び出しの引数 |
| その委譲先に SubagentStart の役割 ID が届く | 委譲先の記録に「役割 ID: code-review」と空行に続く規律の全文があった | `~/.claude/projects/<スクラッチ>/<セッション>/subagents/agent-*.jsonl` |

計画から外れた判断と、分かった制約:

- `--permission-mode default` の `-p` では、SKILL.md の例どおり heredoc で JSON を渡す `pick-delegate` の呼び出しが、Bash の安全検査(「Contains brace with quote character (expansion obfuscation)」)で 3 回とも拒否された。呼び出しの形は改修前から同じで、この改修の範囲の外の制約である。確認を続けるため、`--permission-mode acceptEdits` と `--allowedTools "Skill" "Bash(node:*)" "Bash(git:*)" "SendMessage"` を付け、入力の JSON をプロジェクトの中のファイルに書いてリダイレクトで渡すよう依頼文で指示した。`bypassPermissions` は使わなかった。T16 で README の限界に書く。
- スクラッチは、キーの値が含まれないことを `grep -F` で確かめてから消した。

### 実装中の判断と最終レビュー(2026-11-11)

各タスクで、計画や設計書の文面から外れて決めた事項は次のとおりである。

| タスク | 判断 | 理由 |
| --- | --- | --- |
| T4 | fork の前置きは、`lang` が ja 以外なら全体を en にする。計画 §3-2 と設計書 4.6 は、訳がそろえば訳を使うと書く | fork の指示の文は役割断片に無く、利用者の翻訳で訳せない。訳した Output Format と en の指示が混ざるのを避けた |
| T9 | `applyExtraKeys` は `render` を使わず、frontmatter の行だけを組み立て直す | 本文と `better-agentics-hash` をバイト単位で保つため |
| T10 | 定義が 0 件でも、review か split の役割をすべて外していれば知らせを出す。計画は「定義 0 件のときは案内の 1 文だけ」と書く | 設計書 8.1 は、この知らせに定義の件数の例外を置いていない。計画の「だけ」は移行の知らせを出さない意味と読んだ |
| T13 | 断られたときの扱い(J26・J35・D23・J33・J39)を、独立のセクション「委譲先が断ったとき」に置いた | 外側の手順の外でも起き、「修正の担い手」からも参照するため |
| 最終レビュー | `excludeRoles` には、その作業でこれまでに断った役割をすべて入れる。設計書 5.1 は「断った役割を入れる」と書く | 2 つの役割が交互に断ると、「前と違う委譲先が返ったら数え直す」で選び直しが終わらない(最終レビュアーの指摘) |
| 最終レビュー | `ok: false` の一般則に、「委譲先が断ったとき」が委譲しないと定める `no-candidates` の例外を書いた | 一般則の「理由を問わず止まる」が、J39・D23 の「自分で行う」と字面でぶつかっていた(最終レビュアーの指摘) |
| 最終レビュー | SessionStart で定義の走査に失敗しても、定義 0 件として知らせと警告を続ける | 新しく足した環境変数の警告まで落ちないようにする(コードレビュアーの指摘)。`scanDefinitions` は読み取りの失敗を自分で受けるので、実際にはこの経路に入らない |

最終レビューは、`pick-delegate` が返した code-reviewer と complex-reviewer の 2 人で、`403180b1..073f6459` を対象に行った。

- 1 巡目は、critical・high が 0 件だった。medium は 4 件(コードレビュアー 1 件、最終レビュアー 3 件)で、すべて `1dcaf769` で直した。
- 2 巡目は、同じ 2 人を SendMessage で再開して `073f6459..1dcaf769` を見てもらい、critical・high・medium は 0 件だった。
- 2 巡目の low 2 件(例外の言い回し、コメント行の字下げ)は `7d2465d3` で直した。low だけの修正なので再レビューはしていない。

採らなかった指摘と、見送った low は次のとおりである。

- `--write-config` の `--roles` の重複を除かない、という指摘は採らなかった。`splitList` が重複を除いている。
- 見送った low は 4 件ある。
  - setup の description に「役割を外す」用途が無い。description は skill-creator の担当なので、ここでは変えなかった。
  - 前置きの組み立ての失敗が `jev-failed` に分類される。
  - 置換子の置換が `compose.ts` と `preamble.ts` の 2 箇所にある。
  - 定義の `model` が引用符付きだと fork にならず `self` になる。安全側に倒れる。

`073f6459` の時点の全体の検査では、codiel の `guard-bash.test.ts` の R12 が 1 回失敗した。全体を走らせたときに約 22 秒かかって失敗し、単独で走らせると通った。codiel のファイルと `vitest.config.ts` は変えていない。最終コミット `7d2465d3` で走らせ直した全体の検査では、`pnpm run test`(4,338 件パス・5 件スキップ)・`typecheck`・`lint`・`build` がすべて終了コード 0 で通り、`scripts/` に差分は残らなかった。

### `scripts/` の差分が無いコミットの確認(2026-11-11)

T2 の `e1a47de2`・T4 の `e3ee6d3f`・T8b の `5fd6b657` は、`src/` か `assets/` を変えたが `scripts/` の差分を含まない。どれも、ビルドしても `scripts/` に入れるべき差分が出ないためである。

- T2 は `config.ts`、T4 は `preamble.ts` を足しただけで、その時点ではバンドルの入口 4 本のどれもこれらを読み込んでいない(`git grep` で確認)。計画書の T2・T4 にもビルドの手順は無い。読み込みが始まった T5 の `fe7177c6` から、`scripts/` の差分を同じコミットに入れた。
- T8b は `assets/roles/` の断片だけを変えた。断片は実行時に読まれ、バンドルには入らない。
- 3 つのコミットのソースを `git archive` でスクラッチに展開し、`build.ts` でビルドし直した。出力はコミット済みの `scripts/` と同じで、違ったのは `pick-delegate.mjs` の出典コメントのパス 1 行だけだった(スクラッチの置き場所による)。`e1a47de2` の `scripts/` は、作業前の `403180b1` の `scripts/` と一致した。
- T2 と T4 は、コミットの時点ではビルドを実行していない。この確認はコミットの後に行った。
