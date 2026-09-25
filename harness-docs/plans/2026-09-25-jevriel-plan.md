# jevriel 実装計画書

- 作成日: 2026-09-25
- 対象プラグイン: `plugins/jevriel`(新規、`0.1.0-dev`)
- 設計書(正本): `harness-docs/design/2026-09-25-jevriel-design.md`
- 設計書のユーザー承認: **取得済み(2026-09-25)**(コミット `adce52e`)
- 計画立案時の HEAD: `adce52e`
- 実装は別セッションで行う。

この計画書はタスクの分割・順序・検証方法・タスク間の契約だけを定め、設計判断を上書きしない。各タスクの要点に設計書の節番号を添える。実装者は設計書の該当節を正本として読む。設計書と実装の食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。オーケストレーターは §7 に記録し、設計書の修正要否を判断する。

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`。更新は T13 でオーケストレーターが metatron のスキルと CLI で行う。ほかのタスクの担当は、更新が要ると気付いても修正せず報告する。
- `.claude/rules/metatron/` の 3 ファイル。
- `plugins/jevriel/dist/` の手編集。`src/` を変え、`pnpm --filter jevriel-scripts build` で再生成する。
- 他プラグインのファイル(`plugins/codiel/raguel-mcp/` を含む)。raguel-mcp は形の参考として読むだけにする。
- `tsconfig.json`・`vitest.config.ts`・`biome.json`(設計書 §4-3。既存の glob が jevriel を含む)。
- `.serena/memories/` を Edit / Write で触ること。T13 でオーケストレーターが Serena のツールで行う。
- `.raphael/`。
- 本件と無関係な未コミット変更(計画立案時点で `.raphael/antibodies/`、`cliproxyapi.config.example.yaml`、`docs/chat/` の変更と未追跡ファイル)。触らず、revert もしない。

## 1. 進め方の共通規律

### 全体の制約

設計書から原文の値で写す。

- Node.js は 22 以上(設計書 §11 の要件。esbuild の target は node22)。
- Jev に関わる部分の依存は `@typesafe-ai/sdk` の `0.6.0`(完全一致)だけにする。ほかの実行時依存は `@modelcontextprotocol/sdk` `^1.29.0` と `zod` `^4.4.3` だけ(設計書 §4-2)。
- Playwright は同梱しない。`playwright` / `playwright-core` は `import type` でだけ参照し、値の import を書かない。`build.ts` に `external` を書かない。実行時は `createRequire(<projectDir または cacheDir>/package.json)` だけで読む(設計書 §4-2、§7-1)。
- `playwright-core` `~1.63.0` は型のための devDependency に限る(設計書 §4-2)。
- ツールの description とスキル `judging` の本文・description に、他プラグインの名前と他プラグイン固有の概念を書かない。他プラグイン名を書いてよいのは README の「Codiel との併用」節だけ(設計書 §10-2、§11、§16)。
- パッケージ名は `jevriel-scripts`。単体ビルドは `pnpm --filter jevriel-scripts build`(設計書 §4-2、§16)。
- テストは対象ソースと同じディレクトリの `__test__/` に `<対象ファイル名>.test.ts` で置く。複数のテストから使うヘルパーは `__test__/helpers/` に置き、固定データは `src/fixtures/` に置く(testing-policy、設計書 §4-4)。
- ブランチを切らない(プロジェクト規約)。main で作業する。
- タスクごとにコミットする。

### 作業の規律

- 各タスクでは、テストを先に書いてから実装する。タスクの完了時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ることを完了条件にする。
- `plugins/jevriel/src/` を変えるタスクは、最後に `pnpm --filter jevriel-scripts build` を実行する。`build.ts` のエントリは `src/server.ts` だけなので、`server.ts` から到達しないモジュールを足しても `dist/server.mjs` は変わらない。
  - `server.ts` の到達グラフを変えるタスク(T1、T3、T4、T6〜T10)は、`plugins/jevriel/dist/server.mjs` の差分を同じコミットに含める。
  - 到達グラフを変えないタスク(T2、T5)は、build が通ることと `git status --short plugins/jevriel/dist` に差分が無いことを検証にする。
- ネットワークとブラウザをテストで使わない。Jev は `createJevCall({ apiKey: "test", fetch: fakeFetch })`(T2 で定義。内部で `TypeSafeClientConfig.fetch` を差し替える)でモックする(設計書 §15)。
- 各タスクの「インターフェース」行の名前とシグネチャは、タスク間の契約である。担当は変えない。変える必要が出たら止めて報告する。
- 各タスクの「検証」にあるテストケースは最低限の一覧である。担当が足すのはよい。削るのは報告を要する。
- ツールの description は英語で書く。1〜2 文で、何を判断するかと主な引数だけを書く(設計書 §5-1 の instructions の言語と同じ扱い)。
- `src/**/*.ts`・テスト・README のタスクにはスキルをロードさせない。スキルを使うのは T11(`prompt-smith:skill-creator` と `prompt-smith:prompt-smith`)と T13(`metatron:updating-architecture`)だけ。
- 設計判断・要件の追加・スコープの拡大は担当が決めず、オーケストレーターへ差し戻す。

### レビューの焦点

設計書が要求しているのに、設計書 §15 のどのテストも直接は叩かない入力や状況を 5 件挙げる。選んだ軸は次の 2 つである。(a) 利用者が最初の数回の利用で出会う。(b) 壊れても isError にならず、結果か証跡が静かに誤る、または秘密が外へ出る。各件の固定テストを下の列のタスクへ足し、そのタスクの「検証」欄に書いた。T15 のコードレビューでは、この 5 件を必ず見る。

| # | 入力・状況 | 壊れたときに利用者に起きること | 固定するタスク |
| --- | --- | --- | --- |
| F1 | 日本語だけの `name`(例として画面名をそのまま渡す) | 正規化で空になり URL 由来の名前へ落ちる。別の画面のテストの証跡が同じディレクトリに混ざるが、エラーにならない | T5 |
| F2 | ポート付きの起点(`http://localhost:3000/`)と、`allowedHosts` の指定の有無 | 既定の許可リストにポートが入らないと、開発サーバーで最初の遷移が stuck(`host_not_allowed`)になる。逆に `allowedHosts: ["localhost"]` が `localhost:3000` に一致しないことも、利用者が誤解しやすい | T6 |
| F3 | 同じ role と name の要素が、disabled の要素を挟んで並ぶページ | 抽出側の `nth` と `getByRole(..., { disabled: false }).nth(i)` の数え方がずれ、別の要素を押す。操作は成功するので気付けない | T9、T10 |
| F4 | `inputs` の値(パスワードなど)と、URL のクエリに載ったトークン | Jev(外部サービス)へ送る state に値が入る。テストは形を見るが、値が無いことは見ない | T7、T10 |
| F5 | 分割した判断系の並列送信中に、Retry-After 付きの 429 が返る | 再試行の後に成功すべきものが `api_error` になる、または再試行が走らず件数分の失敗が返る | T2、T3 |

## 2. タスク

### T0: baseline(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 作業 | `git status --short` で本件と無関係な未コミット変更を記録する。`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` を実行し、結果とテスト件数を記録する。`node --version` が 22 以上であることを記録する。`npm view @typesafe-ai/sdk@0.6.0 version` と `npm view playwright-core@~1.63.0 version` で両パッケージが取得できることを確かめる |
| 検証 | 4 コマンドがすべて通る。通らないとき、または 2 つのパッケージが取得できないときは本件に入らず報告する |
| コミット | なし |

### T1: 雛形とワークスペースへの登録

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/jevriel/.claude-plugin/plugin.json`、`.mcp.json`、`package.json`、`build.ts`、`src/server.ts`、`src/log.ts`、`dist/server.mjs`(生成物)、`pnpm-workspace.yaml`、`.claude-plugin/marketplace.json`、`pnpm-lock.yaml` |
| 要点 | 設計書 §4-2 の JSON 3 つを全文どおりに置く。`build.ts` は `plugins/codiel/raguel-mcp/build.ts` を写し、banner の識別子の接頭辞を `__jevriel` に変える。`external` は書かない(§4-2)。`src/log.ts` は raguel-mcp の `src/core/log.ts` と同じ形で、接頭辞を `[jevriel:<level>]`、環境変数を `JEVRIEL_LOG_LEVEL` にする。`src/server.ts` はツールを 0 個登録して stdio で接続する。`pnpm-workspace.yaml` と `marketplace.json` へ登録し(§4-3)、`pnpm install` を実行する。marketplace の description は `plugin.json` の description と同じ文にする |
| インターフェース | consumes: なし。produces: `src/log.ts` の `log: { debug, info, warn, error }`(各 `(message: string, data?: unknown) => void`)。`src/server.ts` の `main(): Promise<void>`(`new McpServer({ name: "jevriel", version: "0.1.0-dev" })` を作り、後続タスクが足す `register*Tools(server, deps)` を呼んでから `server.connect(new StdioServerTransport())` する) |
| 担当 | 軽量な実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / `pnpm --filter jevriel-scripts build`。`plugins/jevriel/dist/server.mjs` が生成される。MCP の `initialize` 要求(JSON-RPC 1 行)を標準入力に渡して `node plugins/jevriel/dist/server.mjs` を起動すると、`serverInfo.name` が `jevriel` の応答を stdout に返し、stdout にほかの行を出さない |
| コミット | `feat(jevriel): プラグインの雛形を追加しワークスペースへ登録する` |

### T2: 共通部(Jev クライアント・予算・閾値・応答)

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/jev/client.ts`、`src/jev/budget.ts`、`src/jev/verdict.ts`、`src/tools/shared.ts`、各 `__test__/`、`src/fixtures/jev/`(429・5xx・正常応答の固定 JSON) |
| 要点 | client: キー確認(§5-1)、SDK の生成と `fetch` の注入(§15)、SDK 例外の変換(§5-1 の `api_error`、再試行は SDK 既定に任せる)、送信前の見積り(`estimateValue(state)` と各 `estimateQuestion` の合計)と応答の `usage.input_tokens` の比を T1 の `log.debug`(stderr)に出すこと(§8-1。SDK の `logger` / `logLevel` は使わない)。budget: §8-1〜§8-4 の見積り・上限・貪欲分割・単独上限・切詰め・同時実行数 4 の制御。verdict: §5-1 の閾値と `Judged`、§5-4 と §5-6 の score の段階化(`Math.round`)。shared: §5-1 の `ErrorBody` と 8 種の `kind`、`toResponse`、共通 zod スキーマ(`thresholdsSchema`・`evidenceSchema`・`nameSchema`)、§7-1 の `projectDir` の決め方 |
| インターフェース | consumes: T1 の `log`。produces(client.ts): `type StateValue = string \| Record<string, unknown> \| unknown[] \| null`、`type QuestionSpec = { type: "noul"; instructions?: string; criteria?: { true?: unknown; false?: unknown } \| null } \| { type: "choice"; instructions: string; options: Record<string, string \| null> } \| { type: "score"; instructions: string; levels: string[] }`、`type JevRequest = { state: StateValue; questions: Record<string, QuestionSpec>; model?: string }`、`type JevCall = (req: JevRequest, options?: { timeout?: number }) => Promise<SystemOneResult<Questions>>`(`SystemOneResult` と `Questions` は `@typesafe-ai/sdk` からの `import type`。`SystemOneResult` は型引数が必須)、`hasApiKey(env: NodeJS.ProcessEnv): boolean`、`createJevCall(config?: { apiKey?: string; fetch?: typeof fetch }): JevCall`(SDK の `noul` / `choice` / `score` ビルダーで質問を組み、`client.systemOne` を呼ぶ。クライアントは初回呼び出しで生成する)、`describeJevError(err: unknown): { message: string; errorClass: string; status?: number; requestId?: string }`。produces(budget.ts): `TOTAL_BUDGET = 51_200`、`LONGEST_BUDGET = 25_600`、`QUESTION_OVERHEAD = 16`、`MAX_QUESTIONS_PER_BATCH = 100`、`JEV_CONCURRENCY = 4`、`estimateTokens(text: string): number`、`estimateValue(value: unknown): number`(文字列以外は `JSON.stringify` して数える)、`estimateQuestion(q: QuestionSpec): number`、`planBatches<T>(items: readonly T[], opts: { base: number; itemState: (item: T) => number; itemQuestion: (item: T) => number }): { batches: T[][]; tooLarge: T[] }`、`exceedsSoloLimit(valueTokens: number, fixedQuestionTokens: number): boolean`、`bodyAllowance(stateWithoutBody: StateValue, questions: Record<string, QuestionSpec>): number`(本文に使える残りのトークン数。本文を空にしても上限を超えるときは負の値を返し、呼び出し側は送信せず `budget_exceeded` を返す)、`truncateBody(body: unknown, allowedTokens: number): { body: unknown; truncated: boolean }`、`mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`(結果は入力順)。produces(verdict.ts): `type Verdict = "satisfied" \| "unsatisfied" \| "uncertain"`、`type Judged = { probability: number; verdict: Verdict }`、`type Thresholds = { satisfied: number; unsatisfied: number }`、`validateThresholds(t: Thresholds): string \| null`(不正なら理由、正しければ null)、`judge(probability: number, t: Thresholds): Judged`、`scoreLevel(score: number, levels: readonly string[]): { level: number; label: string }`。produces(shared.ts): `type ErrorKind`(§5-1 の 8 種)、`type ErrorBody`、`type ToolResponse = { [key: string]: unknown; content: Array<{ type: "text"; text: string }>; isError?: boolean }`、`toResponse(result: unknown): ToolResponse`、`errorResponse(kind: ErrorKind, message: string, extra?: { errorClass?: string; status?: number; requestId?: string }): ToolResponse`、`jevErrorResponse(err: unknown): ToolResponse`(`describeJevError` を `api_error` で包む)、`notConfiguredResponse(): ToolResponse`、`thresholdsSchema`、`evidenceSchema`、`nameSchema`、`resolveProjectDir(env: NodeJS.ProcessEnv, cwd: () => string): string`、`type ToolDeps = { jev: JevCall; env: NodeJS.ProcessEnv; projectDir: string; now: () => Date; httpFetch: typeof fetch }`(`httpFetch` は対象 API への送信をテストで差し替えるため。T6 の `api_check` と T7 の `api_run_goal` の送信で使う)、`createToolDeps(env: NodeJS.ProcessEnv): ToolDeps` |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。build が通り、`git status --short plugins/jevriel/dist` に差分が無い(このタスクは `server.ts` の到達グラフを変えない)。テストケース: **jev/client.test.ts** — `hasApiKey` が未設定と空文字で false / `JEVRIEL_LOG_LEVEL=debug` のとき、応答の `usage.input_tokens` と見積りの比が stderr に 1 行出る(stdout には出ない)/ `createJevCall` が fakeFetch へ送る body に state と 3 型の質問が SDK の形で入る / 401・400・422・5xx・タイムアウト・接続失敗の各例外で `describeJevError` の `errorClass` と `status` と `requestId` が SDK の値になる / **F5**: fakeFetch が 1 回目に `Retry-After: 1` 付きの 429、2 回目に正常応答を返すと、呼び出しは成功し fakeFetch は 2 回呼ばれる / 429 が 3 回続くと `errorClass` が `RateLimitError`、`status` が 429 になる。**jev/budget.test.ts** — `estimateTokens("abcde")` が 2、`estimateTokens("日本")` が 3(6 バイト / 2.5 の切上げ)/ `estimateQuestion` が 16 を上乗せする / `planBatches` が TOTAL 側の上限で切れる / LONGEST 側の上限で切れる / 101 件目で新しいバッチになる / 空のバッチに入らない item が `tooLarge` に入り残りは続く / `exceedsSoloLimit` の境界(ちょうど `LONGEST_BUDGET - 固定分` は false、1 超えると true)/ `truncateBody` が収まる本文を変えず truncated false / 収まらない文字列を切って末尾に `...[truncated <N> bytes]` を付ける / JSON 値を切ると文字列で返す / `bodyAllowance` が本文以外だけで上限を超える state に負の値を返す / `mapWithConcurrency` の同時実行数が 4 を超えず結果が入力順。**jev/verdict.test.ts** — 0.8 ちょうどで satisfied、0.2 ちょうどで unsatisfied、0.5 で uncertain / `unsatisfied >= satisfied` で `validateThresholds` が理由を返す / `scoreLevel(2.4, 5 段)` が 2、`scoreLevel(2.5, 5 段)` が 3。**tools/shared.test.ts** — `toResponse` の本文が `JSON.stringify(x, null, 2)` / `errorResponse` が `isError: true` と `error.kind` を持つ / `resolveProjectDir` が `CLAUDE_PROJECT_DIR` を優先し、無ければ cwd |
| コミット | `feat(jevriel): Jev クライアントとトークン予算・閾値・応答の共通部を追加する` |

### T3: `jev_ask`・`classify_items`・`rank_items`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/tools/judging.ts`、`src/tools/__test__/judging.test.ts`、`src/server.ts`(登録の追加)、`src/fixtures/jev/` |
| 要点 | 設計書 §5-2(zod スキーマ、choice の選択肢数 2〜255、分割も切詰めもしない)、§5-3(id の自動採番 `i1..`、重複 id は `invalid_input`、categories 2〜255 件)、§5-4(降順整列、同点と `too_large` は入力順で末尾)。分割は §8-3、context の単独上限は §8-3。キー確認は §5-1。state と questions の形は §5-3 と §5-4 のコードブロックどおり |
| インターフェース | consumes: T2 の `JevCall`・`QuestionSpec`・`planBatches`・`estimateValue`・`estimateQuestion`・`exceedsSoloLimit`・`mapWithConcurrency`・`JEV_CONCURRENCY`・`scoreLevel`・`toResponse`・`errorResponse`・`jevErrorResponse`・`notConfiguredResponse`・`hasApiKey`・`ToolDeps`。produces: `jevAskInput`・`classifyItemsInput`・`rankItemsInput`(zod の raw shape)、`handleJevAsk(args, deps: ToolDeps): Promise<ToolResponse>`、`handleClassifyItems(args, deps: ToolDeps): Promise<ToolResponse>`、`handleRankItems(args, deps: ToolDeps): Promise<ToolResponse>`、`normalizeItems(items: Array<string \| { id: string; text: string }>): { ok: true; items: Array<{ id: string; text: string }> } \| { ok: false; message: string }`、`registerJudgingTools(server: McpServer, deps: ToolDeps): void`(T4 が同じ関数へ 2 ツールを足す) |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。テストケース(**tools/judging.test.ts**、Jev は `createJevCall({ apiKey: "test", fetch: fakeFetch })`)— 3 ツールともキー無しで `not_configured` を返し fakeFetch を呼ばない / `jev_ask` が state と質問を加工せず 1 回送り、応答の `answers` をそのまま返す / `jev_ask` の choice が選択肢 1 個と 256 個で zod に拒否される / `jev_ask` の noul の `criteria` が `{ true, false }` の object で送られる / `classify_items` の state に `items` が id キーで入り、instructions に item の本文が含まれない / 文字列の item に `i1..` が振られる / 重複 id で `invalid_input` / categories 1 件で `invalid_input` / 結果が入力順 / 1 件だけ大きい item が `{ id, status: "too_large" }` になり残りは結果を持つ / context が単独上限を超えると `budget_exceeded` / 5 バッチ以上に分かれたとき fakeFetch の同時実行が 4 を超えない(応答を遅らせて同時に保留中の呼び出し数の最大を数える) / `rank_items` が score の降順で、同点は入力順、`too_large` は末尾 / `level` が `levels[Math.round(score)]` / **F5**: 分割した 2 バッチの一方に 429(Retry-After 付き)の後で正常応答を返すと、全 item が結果を持ち isError にならない |
| コミット | `feat(jevriel): jev_ask・classify_items・rank_items を追加する` |

### T4: `check_claims`・`assess_action`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/tools/judging.ts`、`src/tools/__test__/judging.test.ts`、`src/fixtures/jev/` |
| 要点 | 設計書 §5-5(claims を `state.claims` に置き instructions はキー名で指す。evidence は切り詰めない。出力は `Judged \| { status: "too_large" }`)、§5-6(action と context は切り詰めない。5 段の段階名は §5-6 の英文どおり。`impact.level = Math.round(score)`)、§8-3 の単独上限、§5-1 の閾値と `invalid_input` |
| インターフェース | consumes: T2 の `judge`・`validateThresholds`・`Thresholds`・`scoreLevel`・`thresholdsSchema`、T3 の `registerJudgingTools` と同じ分割の組み方。produces: `checkClaimsInput`・`assessActionInput`、`handleCheckClaims(args, deps: ToolDeps): Promise<ToolResponse>`、`handleAssessAction(args, deps: ToolDeps): Promise<ToolResponse>`。T3 の `registerJudgingTools` を修正し、`handleCheckClaims` と `handleAssessAction` を登録する(登録後は 5 ツール) |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。テストケース(**tools/judging.test.ts** に追加)— `check_claims` の state が `{ evidence, claims: { c1.. } }` で、noul の `criteria` が送られない / 閾値の既定で 0.8 が satisfied / `thresholds: { satisfied: 0.3, unsatisfied: 0.5 }` で `invalid_input` / evidence が単独上限を超えると `budget_exceeded` で fakeFetch を呼ばない / 大きな claim が `{ claim, status: "too_large" }` / `assess_action` が 1 回の送信に `destructive`(noul)と `impact`(score、5 段)を含む / `impact.label` が段階名と一致する / action が単独上限を超えると `budget_exceeded` / 両ツールともキー無しで `not_configured` |
| コミット | `feat(jevriel): check_claims と assess_action を追加する` |

### T5: 証跡(`src/evidence.ts`)

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/evidence.ts`、`src/__test__/evidence.test.ts` |
| 要点 | 設計書 §5-1 の `RunRecord` / `BrowserStep` / `ApiStep` の型、証跡の方針の 3 値、テスト対象名の正規化と既定値、証跡ディレクトリの階層と構成、`result.json` を最後に書き `files` に自身を含めること。§6-1 の証跡(timestamp の形と `-2`/`-3` の衝突回避、保存失敗時は `evidence` を null にして stderr へ)。§6-2 の証跡(API 系は途中のファイルが無い)。ツールとループへの組み込みは T6 以降で行う |
| インターフェース | consumes: T2 の `Judged`・`JevCall`・`JevRequest`、T1 の `log`。produces: `type EvidenceMode = "always" \| "on_failure" \| "none"`、`type RunKind = "browser" \| "api"`、`type RunStatus = "pass" \| "fail" \| "stuck" \| "error"`、`type RunRecord`・`type BrowserStep`・`type ApiStep`(設計書 §5-1 のとおり。`steps` は `BrowserStep[] \| ApiStep[]`)、`type LogEntry = { at: string; kind: "jev"; state: unknown; questions: unknown; answers: unknown } \| { at: string; kind: "exception"; errorClass: string; message: string; stack?: string } \| { at: string; kind: "http"; request: unknown; response: unknown }`、`normalizeName(raw: string \| undefined, originUrl: string, kind: RunKind): string`、`defaultName(originUrl: string, kind: RunKind): string`、`captureFlags(mode: EvidenceMode): { dir: boolean; trace: boolean; screenshots: boolean }`、`shouldKeep(mode: EvidenceMode, status: RunStatus): boolean`、`createRunDir(projectDir: string, kind: RunKind, name: string, now: Date): Promise<string>`(絶対パスを返す)、`recordingJev(jev: JevCall, log: LogEntry[], now: () => Date): JevCall`(呼び出しごとに `kind: "jev"` を積む。例外は `kind: "exception"` を積んでから投げ直す)、`finalizeEvidence<R extends RunRecord>(args: { dir: string \| null; mode: EvidenceMode; record: R; log: LogEntry[]; files: string[] }): Promise<R>`(`files` はそれまでに dir へ書いたファイル名。`log.json` と `result.json` を書き、`record.evidence` を確定して返す。`on_failure` で pass ならディレクトリを消して `evidence: null`) |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。build が通り、`git status --short plugins/jevriel/dist` に差分が無い(このタスクは `server.ts` の到達グラフを変えない)。テストケース(**src/__test__/evidence.test.ts**、一時ディレクトリを使う)— `normalizeName("Login Page/v2")` が `Login-Page-v2` / 先頭と末尾のハイフンを落とす / 65 文字以上を 64 文字で切り、切った末尾のハイフンを再び落とす / 記号だけの入力で既定値になる / 省略時、ブラウザ系の `http://localhost:3000/login?x=1#h` から `localhost-3000-login`(クエリとフラグメントを含まない)/ API 系の `https://api.example.com:8443/v1/users` から `api.example.com-8443` / 既定値まで空なら `unnamed` / **F1**: `normalizeName("ログイン画面", "http://localhost:3000/login", "browser")` が `localhost-3000-login` になり、`normalizeName("ログイン-v2", ...)` が `v2` になる(日本語だけの名前が既定値へ落ちることを固定する)/ `captureFlags("none")` が 3 つとも false、`always` と `on_failure` が 3 つとも true / `shouldKeep` の 3 値 × 4 status の表 / `createRunDir` の階層が `.jevriel/runs/<kind>/<name>/<timestamp>/` で、timestamp の `:` と `.` が `-` / 同じ時刻で 2 回呼ぶと `-2` が付く / `finalizeEvidence` の `always` が pass でも `result.json` と `log.json` を書き、`files` に両方と渡したファイルが入る / `files` と実在するファイルが一致する / 書いた `result.json` を読み戻すと返した record と一致する / `on_failure` で pass ならディレクトリが残らず `evidence` が null / `on_failure` で fail なら残る / `dir: null` で何も書かず `evidence` が null / 書き込みに失敗すると `evidence` が null で status は変わらない / `recordingJev` が成功時に `jev` の記録、例外時に `exception` の記録を積む |
| コミット | `feat(jevriel): 証跡ディレクトリとテスト対象名の正規化を追加する` |

### T6: HTTP の共通部と `api_check`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/http.ts`、`src/api/__test__/http.test.ts`、`src/tools/api.ts`、`src/tools/__test__/api.test.ts`、`src/server.ts`(登録の追加) |
| 要点 | 設計書 §5-10(入力スキーマ、`redirect: "manual"`、JSON とテキストの判別、state の形、`RunRecord & { response }`)、§9-3 の `redact` と `sanitizeUrl`、§9-2 と §5-9 の `allowedHosts` の一致規則(完全一致、`*.` だけワイルドカード)、§8-4 の切詰め、§5-1 の記録を返すツールの規則(開始前の失敗は isError で証跡なし、送信失敗は `request_failed`)、§6-2 の証跡(`result.json` と `log.json`、`kind: "api"`) |
| インターフェース | consumes: T2 の `truncateBody`・`bodyAllowance`・`judge`・`evidenceSchema`・`nameSchema`・`thresholdsSchema`・`ToolDeps`、T5 の `normalizeName`・`captureFlags`・`createRunDir`・`recordingJev`・`finalizeEvidence`・`RunRecord`・`LogEntry`。produces(http.ts): `type ApiRequest = { method: string; url: string; headers: Record<string, string>; body?: string }`、`type ApiResponse = { status: number; headers: Record<string, string>; body: unknown; contentType: string \| null; bodyBytes: number }`、`redact(headers: Record<string, string>, forceMask?: ReadonlySet<string>): Record<string, string>`(`forceMask` は小文字のヘッダ名)、`sanitizeUrl(url: string): string`、`isHostAllowed(host: string, allowed: readonly string[]): boolean`、`defaultAllowedHosts(originUrl: string): string[]`(`[new URL(originUrl).host]`)、`parseBody(contentType: string \| null, text: string): unknown`、`sendRequest(req: ApiRequest, timeoutMs: number, fetchImpl: typeof fetch): Promise<ApiResponse>`。produces(tools/api.ts): `apiCheckInput`、`handleApiCheck(args, deps: ToolDeps): Promise<ToolResponse>`、`registerApiTools(server: McpServer, deps: ToolDeps): void`(T7 が `api_run_goal` を足す) |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。テストケース: **api/http.test.ts** — `application/json` で解析できる本文は JSON 値、解析できなければテキスト、`text/html` はテキスト / `redact` が `Authorization`・`Cookie`・`Set-Cookie`・`X-Api-Key`・`Proxy-Authorization` と名前に token / secret / password を含むヘッダを大小文字を問わず伏字にする / `forceMask` に入れた名前(`{{inputs.*}}` を埋め込んだヘッダの想定)を名前に依らず伏字にする / `sanitizeUrl` が `https://u:p@h/x?token=abc&page=2` を `https://h/x?token=&page=` にする / `sendRequest` が `redirect: "manual"` で fetch を呼び、302 をそのまま返す / **F2**: `defaultAllowedHosts("http://localhost:3000/")` が `["localhost:3000"]`、`isHostAllowed("localhost:3000", ["localhost:3000"])` が true、`isHostAllowed("localhost:3000", ["localhost"])` が false、`isHostAllowed("a.example.com", ["*.example.com"])` が true、`isHostAllowed("example.com", ["*.example.com"])` が false。**tools/api.test.ts**(Jev は fakeFetch、対象 API は `deps.httpFetch` のフェイク)— キー無しで `not_configured` / 送信失敗で `request_failed` かつ証跡ディレクトリを作らない / state の `request.headers` が伏字で、`request.url` がクエリ値を落としている / リクエスト body が state に入らない / 全 assertion が satisfied で `status: "pass"`、1 つでも違えば `fail` / Jev が例外を投げると isError にならず `status: "error"` で証跡が残る / 出力の `tool` が `api_check`、`kind` が `api`、`goal` と `reached` が null、`steps` が空 / `evidence: "always"` の `result.json` を読み戻すとツール出力の本文と一致する / `evidence: "none"` でディレクトリを作らず `evidence` が null / 長い応答本文で `response.truncated` と state の `truncated` が true / 応答本文以外(assertions)だけで予算を超えるとき、`bodyAllowance` が負になり、Jev を呼ばず `budget_exceeded` を返す |
| コミット | `feat(jevriel): HTTP の共通部と api_check を追加する` |

### T7: テンプレートと `api_run_goal`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/template.ts`、`src/api/loop.ts`、`src/api/__test__/template.test.ts`、`src/api/__test__/loop.test.ts`、`src/tools/api.ts`、`src/tools/__test__/api.test.ts` |
| 要点 | 設計書 §8-4 の切詰めと 5.(本文を空にしても超えるとき Jev を呼ばない。最初の送信の前は `isError` の `budget_exceeded`、2 回目以降は `status: "error"`、`error.kind: "budget_exceeded"` の `RunRecord` を返し証跡を保存する)、§5-11(入力スキーマ、予約語 `done` / `stuck`、プレースホルダの規則)、§6-2(ステップの順 decide → 終了判定 → 解決 → ホスト検査 → 送信 → 記録、`reached` の定義、終了条件と「同じ操作」、最終判定、`timeout: 30000`、証跡と `log.json` の http 記録)、§6-1 の終了条件の表(API 側で使う行)、§9-3 の `forceMask` |
| インターフェース | consumes: T6 の `ApiRequest`・`ApiResponse`・`redact`・`sanitizeUrl`・`isHostAllowed`・`defaultAllowedHosts`・`sendRequest`・`registerApiTools`、T5 の全 produces、T2 の `judge`・`truncateBody`・`bodyAllowance`。produces(template.ts): `type RequestTemplate = { method: string; path: string; headers: Record<string, string>; body?: unknown; description?: string }`、`resolveTemplate(tpl: RequestTemplate, ctx: { baseUrl: string; inputs: Record<string, string>; steps: Record<string, ApiResponse> }): { ok: true; request: ApiRequest; inputHeaderNames: Set<string> } \| { ok: false; unresolved: string }`(`inputHeaderNames` はヘッダ名を小文字化して入れる。T6 の `redact` の `forceMask` は小文字の Set を前提とするため、小文字化の責任は `resolveTemplate` が持つ)。produces(loop.ts): `type ApiGoalInput = { baseUrl: string; goal: string; requests: Record<string, RequestTemplate>; assertions: string[]; inputs: Record<string, string>; maxSteps: number; allowedHosts: string[]; timeoutMs: number; thresholds: Thresholds; name: string }`、`runApiGoal(input: ApiGoalInput, deps: { jev: JevCall; send: (req: ApiRequest) => Promise<ApiResponse>; now: () => Date; log: LogEntry[] }): Promise<Omit<RunRecord, "evidence">>`。produces(tools/api.ts): `apiRunGoalInput`、`handleApiRunGoal(args, deps: ToolDeps): Promise<ToolResponse>`。T6 の `registerApiTools` を修正し、`handleApiRunGoal` を登録する |
| 担当 | 複雑または重要な実装(状態遷移・終了条件・証跡・秘密の扱いが絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。テストケース: **api/template.test.ts** — `{{inputs.k}}` の置換 / `{{steps.login.body.token}}` の置換 / `{{steps.list.body.items.0.id}}` の配列添字 / `{{steps.x.status}}` と `{{steps.x.headers.location}}` / body の文字列全体が 1 個のプレースホルダなら数値・真偽値・オブジェクトの型を保つ / 文字列の一部なら文字列で埋め込む / 未定義の `steps` やキーで `{ ok: false, unresolved }` / ヘッダへ `{{inputs.*}}` を埋め込んだ名前が `inputHeaderNames` に入る / 絶対 URL の path は baseUrl と結合しない。**api/loop.test.ts**(フェイクの `send` と `jev`)— 前の応答の値が次の path に入る連鎖 / 未解決のテンプレートを送らず history に `unresolved:` を残して続ける / 解決後のホストが許可外なら送らず `stuck`(`host_not_allowed`)/ 302 を追わずそのまま次のステップの `last` になる / `next` が `done`・`stuck`、または `reached` が satisfied のステップで `send` が呼ばれない / 同じ名前・同じ URL・同じ body を 3 回連続で選ぶと `stuck`(`repeated_action`)/ `maxSteps` で `stuck`(`max_steps`)/ Jev の例外で `status: "error"` と `error` / 最終判定で reached と全 assertion が satisfied なら pass、1 つでも違えば fail / Jev 呼び出しに `timeout: 30000` が渡る / `log` に http の記録が積まれ、request の headers が伏字で url がクエリ値を落とし、response の body が切詰め後 / **F4**: `inputs` の値(例 `s3cret-value`)と、解決後 URL のクエリ値が、すべての Jev 呼び出しの state を `JSON.stringify` した文字列に現れない / 名前が秘密のパターンに一致しないヘッダ(例 `X-Tenant`)へ `{{inputs.*}}` を埋めたとき、その値が Jev の state と `log` の http 記録の両方で伏字になる。**tools/api.test.ts** に追加 — `requests` の名前に `done` または `stuck` を使うと `invalid_input` / 1 回目の送信の応答が大きく、2 ステップ目の state が本文を空にしても予算を超えるとき、Jev を呼ばず `status: "error"`、`error.kind: "budget_exceeded"` で、`evidence: "always"` の証跡が残る / 上のヘッダの伏字が書き出した `log.json` でも保たれる / `api_run_goal` の `result.json` を読み戻すとツール出力と一致する / `evidence` の 3 値で保存の有無が §5-1 の表どおり / `tool` が `api_run_goal`、`kind` が `api`、`name` の省略時が baseUrl のホスト由来 |
| コミット | `feat(jevriel): API テンプレートと api_run_goal を追加する` |

### T8: Playwright の解決と `browser_setup`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/browser/playwright.ts`、`src/browser/__test__/playwright.test.ts`、`src/tools/browser.ts`、`src/tools/__test__/browser.test.ts`、`src/server.ts`(登録の追加) |
| 要点 | 設計書 §7-1(解決順、1.63.0 以上で上限なし、`createRequire` の基点、`projectDir` と `cacheDir`、版が古いときの `playwright_missing` の message、起動失敗時の (2) への 1 回のやり直し)、§7-2(手順 1〜4、スキップ判定、`spawn` と Windows の `.cmd`、出力の末尾 2KB、冪等、progress 通知、同一プロセス内の単一実行、`npm` 不在で `setup_failed`)、§5-7(出力の形、キー確認をしない)。§17-5 の確認をここで行う(検証欄) |
| インターフェース | consumes: T1 の `log`、T2 の `errorResponse`・`toResponse`・`ToolDeps`。produces(playwright.ts): `PLAYWRIGHT_RANGE = "~1.63.0"`、`MIN_PLAYWRIGHT_VERSION = "1.63.0"`、`defaultCacheDir(home: string): string`、`type PlaywrightModule = typeof import("playwright-core")`(型だけ)、`type PlaywrightCandidate = { source: "project" \| "cache"; version: string; load: () => PlaywrightModule }`、`resolvePlaywright(opts: { projectDir: string; cacheDir: string }): { ok: true; candidates: PlaywrightCandidate[] } \| { ok: false; reason: "missing" \| "project_too_old"; projectVersion?: string }`、`class PlaywrightMissingError extends Error { reason: "missing" \| "project_too_old" }`、`class BrowserLaunchError extends Error`、`launchChromium(opts: { projectDir: string; cacheDir: string }): Promise<{ browser: import("playwright-core").Browser; source: "project" \| "cache" }>`(候補を順に試し、実行ファイル不在の失敗だけ次へ進む)、`type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<{ code: number \| null; outputTail: string }>`、`type BrowserSetupResult`(設計書 §5-7 の出力)、`runBrowserSetup(deps: { cacheDir: string; spawn: SpawnFn; platform: NodeJS.Platform; load: (cacheDir: string) => PlaywrightModule \| null; onProgress?: (step: number, phase: "start" \| "end") => void }): Promise<BrowserSetupResult>`(同一プロセスでの同時呼び出しは同じ Promise を返す)。produces(tools/browser.ts): `type BrowserToolDeps = ToolDeps & { cacheDir: string; spawn: SpawnFn; platform: NodeJS.Platform }`、`createBrowserToolDeps(base: ToolDeps): BrowserToolDeps`、`handleBrowserSetup(extra: { sendProgress?: (progress: number, total: number) => Promise<void> }, deps: BrowserToolDeps): Promise<ToolResponse>`、`registerBrowserTools(server: McpServer, deps: BrowserToolDeps): void`(T9・T10 が足す) |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。テストケース: **browser/playwright.test.ts**(一時ディレクトリに偽の `node_modules/playwright/package.json` と `index.js` を置く)— プロジェクトに 1.63.0 があれば `candidates[0].source` が `project` / 1.70.0 でも `project`(上限なし)/ 1.62.9 ならキャッシュへ進む / 1.62.9 でキャッシュも無ければ `reason: "project_too_old"` と `projectVersion` / どちらも無ければ `reason: "missing"` / プロジェクト候補の起動が実行ファイル不在で失敗するとキャッシュ候補で 1 回だけやり直す / 実行ファイル不在以外の起動失敗ではやり直さず `BrowserLaunchError` / `runBrowserSetup` が 1.63 系と実行ファイルがあるとき spawn を呼ばず `already_installed` / 版が無いとき `npm install playwright@~1.63.0 --no-audit --no-fund` を `cwd: cacheDir`・5 分で呼ぶ / 実行ファイルが無いとき `npx playwright install chromium` を 10 分で呼ぶ / どちらかを実行したら `installed` / `platform: "win32"` で `npm.cmd` と `npx.cmd` / spawn の失敗で `setup_failed`、Linux では `install-deps` の案内を含む / `outputTail` が 2KB 以下 / 同時に 2 回呼んでも spawn は 1 回 / `onProgress` が手順 1〜4 の start と end で呼ばれる。**tools/browser.test.ts** — `browser_setup` が `TYPESAFE_API_KEY` 無しで動く(`not_configured` を返さない)/ progressToken がある呼び出しで `sendProgress` が呼ばれる。**設計書 §17-5 の確認**: `browser_setup` で入れたキャッシュの Playwright で、`createRequire(...).resolve("playwright/package.json")` が成功するか(`exports` が `./package.json` を公開しているか)を確かめる。成功すればその経路で版を読む。失敗すれば `resolve("playwright")` の結果からパッケージのディレクトリを辿って `package.json` を読む実装にし、偽の `node_modules` のテストもその経路で書く。結果を §10 実施記録へ書き、設計書の修正が要るなら §7 へ追記する |
| コミット | `feat(jevriel): Playwright の解決と browser_setup を追加する` |

### T9: スナップショットの抽出と `browser_check`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/browser/snapshot.ts`、`src/browser/__test__/snapshot.test.ts`、`src/fixtures/aria/`、`src/tools/browser.ts`、`src/tools/__test__/browser.test.ts`、`plugins/jevriel/docs/rationale.md`(固定データの採取手順の節だけを新設) |
| 要点 | 設計書 §6-1 の observe(対象ロール、名前無し・`disabled`・`ariaHidden` の除外、文書順、`a1..`、上限 200 と `actionablesOmitted`、disabled を除いた 0 始まりの `nth`、`ariaSnapshotJSON` の戻りは配列)、§5-8(入力スキーマ、処理の流れ、`final.png` と `result.json` と `log.json`、trace は取らない、4xx / 5xx を失敗にしない、`goto` の例外は `browser_failed`、`RunRecord & { page }`)、§9-2 のスキーム制限(`z.string().url()` はスキームを絞らないので、`http:` / `https:` 以外を refine で `invalid_input` にする)、§8-4 の切詰め(本文を空にしても超えるときは Jev を呼ばず `budget_exceeded`)。Playwright 1.63 の公開型は `ariaSnapshotJSON(): Promise<Serializable>`(実質 any)で `AriaNode` は公開されていないため、`AriaNode` は `snapshot.ts` にローカルの構造型として定義し、`ariaSnapshotJSON()` の戻りをこの型の配列として受ける。除外フラグの名前は `hidden` ではなく `ariaHidden`(Playwright の `packages/injected/src/ariaSnapshot.ts` が立てる名前)。§15 の固定データの採取(Playwright 1.63 で `page.setContent` した静的 HTML から一度だけ採取し、手順を `docs/rationale.md` に残す) |
| インターフェース | consumes: T8 の `launchChromium`・`PlaywrightMissingError`・`BrowserLaunchError`・`BrowserToolDeps`・`registerBrowserTools`、T6 の `sanitizeUrl`、T5 の全 produces、T2 の `judge`・`truncateBody`・`bodyAllowance`。produces(snapshot.ts): `type AriaNode = { role: string; name?: string; children?: Array<AriaNode \| string>; disabled?: boolean; ariaHidden?: boolean; [key: string]: unknown }`(ローカルの構造型。`playwright-core` から import しない)、`ACTIONABLE_ROLES: readonly string[]`(§6-1 の 16 ロール)、`MAX_ACTIONABLES = 200`、`type Actionable = { id: string; role: string; name: string; nth: number }`、`extractActionables(nodes: AriaNode[]): { actionables: Actionable[]; omitted: number }`。produces(tools/browser.ts): `browserCheckInput`、`handleBrowserCheck(args, deps: BrowserToolDeps): Promise<ToolResponse>`、`type BrowserToolDeps` に `launch: typeof launchChromium` を足す(テストはフェイクの Browser を返す関数を渡す)。T8 の `registerBrowserTools` を修正し、`handleBrowserCheck` を登録する |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。固定データは `src/fixtures/aria/` に 3 組置く: `basic.json`(各対象ロールを 1 つ以上)、`excluded.json`(名前無し・`disabled`・`ariaHidden` を含む)、`duplicates.json`(同じ role と name が disabled を挟んで 3 つ並ぶ)。各 JSON は、同じディレクトリに置く同名の `.html`(`basic.html` など)を Playwright 1.63 の `page.setContent` で読み込み、`page.ariaSnapshotJSON()` の戻りをそのまま `JSON.stringify(value, null, 2)` したものとする。手で編集しない。テストケース: **browser/snapshot.test.ts** — 対象ロールだけを文書順で抽出する / 名前無し・`disabled`・`ariaHidden` を除く / id が `a1` から連番 / 201 件の入力で 200 件と `omitted: 1` / **F3**: 重複の固定データで、disabled を除いた順の `nth` が 0・1 になり、disabled の要素に番号を振らない。**tools/browser.test.ts** に追加(フェイクの `launch` が返す Browser / Page は `goto`・`title`・`url`・`ariaSnapshot`・`screenshot` を持つ)— キー無しで `not_configured` / Playwright が見つからないとき `playwright_missing` で証跡なし / `goto` の例外で `browser_failed` で証跡なし / 404 の応答でも判定を続け `page.status` が 404 / state に `assertions` がキーで入り、instructions に assertion の本文が無い / state の `url` がクエリ値を落としている / 全 satisfied で pass、1 つ違えば fail / `evidence: "always"` で `final.png`・`log.json`・`result.json` が `files` に入り、`result.json` を読み戻すとツール出力と一致する / `evidence: "none"` で `screenshot` を呼ばない / `evidence: "always"` でも `tracing.start` を呼ばない(`browser_check` は trace を取らない)/ `url` が `file:///etc/passwd` や `ftp://` のとき `invalid_input` で `launch` を呼ばない / assertions だけで予算を超えるとき Jev を呼ばず `budget_exceeded` / `tool` が `browser_check`、`kind` が `browser` / ブラウザを成否に関わらず close する |
| コミット | `feat(jevriel): スナップショットの抽出と browser_check を追加する` |

### T10: ドライバ・ループと `browser_run_goal`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/browser/driver.ts`、`src/browser/loop.ts`、`src/browser/__test__/driver.test.ts`、`src/browser/__test__/loop.test.ts`、`src/browser/__test__/helpers/fakeDriver.ts`、`src/tools/browser.ts`、`src/tools/__test__/browser.test.ts` |
| 要点 | 設計書 §6-1 の全体(準備 1〜5、ステップ 1〜7、値の選択の表、操作の表、終了条件の表、「同じ操作」の定義、最終判定、証跡の書く順番、`GoalDriver`)、§9-2(route の事前検査と `request.frame()` の例外、事後検査、`serviceWorkers: "block"`、ダイアログ、ポップアップ、`filechooser`、ダウンロード)、§5-9(入力スキーマ、`allowedHosts` の既定、`RunRecord & { finalUrl }`、reason の値)、§9-2 のスキーム制限(`http:` / `https:` 以外を refine で `invalid_input`)、§8-4 の切詰めと 5.(本文を空にしても超えるとき Jev を呼ばない。最初の observe では `isError` の `budget_exceeded`。2 回目以降の observe では `status: "error"`、`error.kind: "budget_exceeded"` の `RunRecord` を返し、証跡を保存する)、§5-1 の `timeout: 30000`。§17-6 の確認をここで行う(検証欄) |
| インターフェース | consumes: T9 の `extractActionables`・`Actionable`・`AriaNode`・`handleBrowserCheck` と同じ起動経路、T8 の `launchChromium`、T6 の `sanitizeUrl`・`isHostAllowed`・`defaultAllowedHosts`、T5 の全 produces、T2 の `judge`・`truncateBody`・`bodyAllowance`・`Thresholds`。produces(driver.ts): `type PlannedAction = { kind: "click" \| "fill" \| "select"; target: Actionable; value?: string }`、`interface GoalDriver`(設計書 §6-1 のとおり)、`navigationDecision(req: { isNavigationRequest(): boolean; frame(): unknown; url(): string }, mainFrame: unknown, allowed: readonly string[]): "abort" \| "continue"`、`locatorArgs(target: Actionable): { role: string; options: { name: string; exact: true; disabled: false }; nth: number }`、`createPlaywrightDriver(opts: { browser: import("playwright-core").Browser; url: string; allowedHosts: string[]; stepTimeoutMs: number; captureTrace: boolean }): Promise<{ driver: GoalDriver; initialStatus: number \| null }>`。produces(loop.ts): `type BrowserGoalInput = { url: string; goal: string; assertions: string[]; inputs: Record<string, string>; maxSteps: number; thresholds: Thresholds; name: string; screenshots: boolean; evidenceDir: string \| null }`、`runBrowserGoal(input: BrowserGoalInput, deps: { driver: GoalDriver; jev: JevCall; now: () => Date; log: LogEntry[] }): Promise<{ record: Omit<RunRecord, "evidence">; files: string[] }>`。produces(tools/browser.ts): `browserRunGoalInput`、`handleBrowserRunGoal(args, deps: BrowserToolDeps): Promise<ToolResponse>`。T8 の `registerBrowserTools` を修正し、`handleBrowserRunGoal` を登録する(登録後は `browser_setup`・`browser_check`・`browser_run_goal` の 3 ツール) |
| 担当 | 複雑または重要な実装(状態遷移・安全装置・証跡・例外経路が絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。テストケース: **browser/driver.test.ts**(Playwright の Page / Request / Route を最小のフェイクで渡す)— `navigationDecision` がメインフレームの許可外ナビゲーションで abort、サブリソースと iframe と許可内で continue / `frame()` が例外を投げると abort / `locatorArgs` が `{ name, exact: true, disabled: false }` と `nth` を返す / **F3**: 重複の固定データ(T9)から抽出した 2 番目の要素で、フェイク Page の `getByRole` が `disabled: false` 付きで呼ばれ `nth(1)` が選ばれる / `captureTrace: false` で `tracing.start` を呼ばない / `newContext` に `acceptDownloads: false` と `serviceWorkers: "block"` が渡る / dialog を dismiss し、新しいページを close する / `finish(null)` はファイルを書かず close だけ、`finish(dir)` は `final.png` と `trace.zip` を返す。**browser/loop.test.ts**(フェイクの GoalDriver と Jev)— `reached` が satisfied のステップで act しない / `next` が `done` で act せず最終判定へ / `next` が `stuck` で act せず `stuck`(`chose_stuck`)/ 同じ role・name・nth・値を 3 回連続で `repeated_action` / `maxSteps` で `max_steps` / `blockedNavigation()` が URL を返すと `host_not_allowed`(事前と事後の 2 経路)/ textbox で 2 回目の Jev 呼び出しの選択肢が inputs のキーと `none`、`none` で空文字を fill / `<select>` の combobox で option の choice と `select` / checkbox と radio で `click` / act の例外で history に `action_failed:` を残して続ける / Jev の例外で `status: "error"` と `error`、files に `final.png` と `trace.zip` が入る / `observe()` が Playwright の例外を投げると `status: "error"` で `error.errorClass` に例外のクラス名 / 最終判定が全 satisfied で pass、1 つ違えば fail / 最終判定の例外で `status: "error"`、`reached` が null、assertions が空(stuck で終わる途中だったときも `stuck` の記録にならない)/ stuck で終わっても最終判定を行う / `screenshots: true` で各ステップの act 前に `step-<n>.png` を撮り `BrowserStep.screenshot` に名前が入る / `screenshots: false` で `screenshot` を呼ばない / history が直近 10 件 / Jev 呼び出しに `timeout: 30000` / **F4**: `inputs` の値と、起点 URL のクエリに載せたトークンが、すべての Jev 呼び出しの state を `JSON.stringify` した文字列に現れない。**tools/browser.test.ts** に追加 — `browser_run_goal` のキー無しで `not_configured` / `allowedHosts` 省略時に起点のホスト(ポート込み)だけが許可される / `evidence: "none"` とループ中の例外の組で、ディレクトリを作らず `tracing.start` も `screenshot` も呼ばれず `status: "error"` と `evidence: null` / `evidence: "on_failure"` の pass でディレクトリが残らない / `evidence: "always"` の `result.json` を読み戻すとツール出力と一致する / `tool` が `browser_run_goal`、`kind` が `browser`、`finalUrl` がある / `url` が `http` / `https` 以外のとき `invalid_input` で `launch` を呼ばない / 最初の observe の state が本文を空にしても予算を超えるとき Jev を呼ばず、`isError` の `budget_exceeded` で証跡を残さない / 2 回目の observe で超えるとき(フェイクの driver が 2 回目に大きな history を生む入力を与える)、Jev を呼ばず `status: "error"`、`error.kind: "budget_exceeded"` で、`evidence: "always"` の証跡が残る / ブラウザを成否に関わらず close する。**設計書 §17-6 の確認**: `<input type="file">` を持つ HTML を実際の Playwright 1.63(キャッシュ)で開き、`filechooser` を無視したまま該当のボタンを `click` させて、次の `observe()` が `stepTimeoutMs` 以内に戻るかを確かめる。戻れば現行の設計どおりとする。戻らなければ実装を止め、`filechooser` の扱いを設計書で決め直す必要があるとして報告する。結果を §10 実施記録へ書き、設計書の修正が要るなら §7 へ追記する |
| コミット | `feat(jevriel): ブラウザのドライバ・ループと browser_run_goal を追加する` |

### T11: スキル `judging`

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/jevriel/skills/judging/SKILL.md`、`plugins/jevriel/evals/` |
| 要点 | 設計書 §10(責務、作成手順、frontmatter、節構成の表)。SKILL.md の `allowed-tools` に、10 ツールを `mcp__jevriel__<tool>` の形で列挙する(§10-2)。ツール名は §3 のとおり開始時に build した `dist/server.mjs` の `tools/list` で確かめてから書く。節構成の「ブラウザと API の確認」に `name` の渡し方を含める(§10-3)。他プラグインの名前と `prompt-smith` の名前を本文と description に書かない |
| インターフェース | consumes: T3〜T10 が登録した 10 ツールの名前と入力(`registerJudgingTools`・`registerApiTools`・`registerBrowserTools`)。produces: スキル `jevriel:judging`(T12 の README が名前を参照する) |
| 担当 | 通常の実装 |
| スキル | `prompt-smith:skill-creator`(作成と description の発火評価ループ)、`prompt-smith:prompt-smith`(本文の規律) |
| 検証 | skill-creator の発火評価を通し、評価セットが `plugins/jevriel/evals/` に残る。評価セットは、発火すべき依頼(分類・採点・優先度付け・合否確認・命題の検証・操作の安全性・ブラウザや API の動作確認)と、発火すべきでない依頼(文章の生成・要約・翻訳・画像の判定)の両方を含む。最終の発火率と誤発火率を報告する。`grep -ni -e codiel -e metatron -e sandalphon -e raphael -e prompt-smith -e agent-policy plugins/jevriel/skills/judging/SKILL.md` が 0 件 |
| コミット | `feat(jevriel): スキル judging と発火評価セットを追加する` |

### T12: README と設計根拠

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/jevriel/README.md`、`plugins/jevriel/docs/rationale.md`(T9 の節を残して追記)、ルート `README.md` |
| 要点 | 設計書 §11 の 9 章をこの順で書く。料金・レート・提供状況は §11 の値を書き、公式を確認するよう添える。「Codiel との併用」は §11 の 4 軸で書く。`docs/rationale.md` には §1-2(なぜ MCP か)、§13 の不採用案の要約、§14 のうち利用者に関わらないリスクを書く。ルート README の「配布プラグイン」に jevriel の節を足す(§4-3)。ルート README の書き方は既存のプラグイン節に合わせる |
| インターフェース | consumes: T11 のスキル名 `jevriel:judging`、T3〜T10 のツール名と入力、T5 の証跡の階層、T8 の `browser_setup` の出力。produces: なし |
| 担当 | 軽量な実装 |
| スキル | 不要 |
| 検証 | lint(README は対象外だが全体を通す)。`grep -n "Codiel" plugins/jevriel/README.md` の該当が「Codiel との併用」節の中だけ。README の目次が §11 の 9 章と一致する。README に `TYPESAFE_API_KEY`・`browser_setup`・`.jevriel/`・`evidence`・`name` が現れる |
| コミット | `docs(jevriel): README と設計根拠を追加しルート README に追記する` |

### T13: ADR・ARCHITECTURE・Serena メモリ(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 対象 | `harness-docs/ARCHITECTURE.md`(metatron の CLI 経由)、`.serena/memories/core.md`、`.serena/memories/jevriel/core.md`(新規) |
| 要点 | 設計書 §12 の ADR 案を、`metatron:updating-architecture` スキルを起動してから `stage-adr` → `commit-architecture` で起票する(スキルの手順の diff-architecture・get rules・草案の第三者検査を省かない)。ARCHITECTURE の追随: システム概要の「LLM を要する処理は…に閉じる」への例外、ディレクトリ構成の図への `plugins/<plugin>/.mcp.json`(§12 の影響範囲)。Serena メモリは `write_memory` / `edit_memory` で、`core.md` のプラグイン一覧に jevriel を足し、`jevriel/core.md` に構成・10 ツール・証跡の階層・Playwright の解決を書く |
| インターフェース | consumes: T1〜T12 の成果物。produces: なし |
| 担当 | オーケストレーター |
| スキル | `metatron:updating-architecture` |
| 検証 | ARCHITECTURE の ADR 一覧に `[jevriel]` の ADR がある。`grep -n "mcp.json" harness-docs/ARCHITECTURE.md` が構成図の行を返す。`.serena/memories/core.md` に jevriel がある |
| コミット | ARCHITECTURE は `commit-architecture` がコミットする場合はそれに従う。Serena メモリは `docs: Serena メモリに jevriel を追加する` |

### T14: 統合検証(オーケストレーター)

次を順に実行し、出力を記録する。

1. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test`。テスト件数の増分が T2〜T10 で足したテストの数と一致する。
2. `pnpm --filter jevriel-scripts build` の後、`git status --short plugins/jevriel/dist` に差分が無い。
3. esbuild は取り込んだモジュールごとに `// node_modules/.pnpm/<パッケージ>@<版>/...` の注記を出力に残す。`grep -c -e "playwright-core@" -e "/playwright@" plugins/jevriel/dist/server.mjs` が 0(Playwright のコードが含まれない)。`grep -c "@typesafe-ai+sdk@" plugins/jevriel/dist/server.mjs` と `grep -c "zod@" plugins/jevriel/dist/server.mjs` がそれぞれ 1 以上(SDK と zod が含まれる)。注記の形が違って判定できないときは、その事実と代わりに使った判定を記録する。
4. `TYPESAFE_API_KEY` を外した環境で `dist/server.mjs` を起動し、`tools/list` が 10 ツールを返す。`jev_ask` が `not_configured` を返す(設計書 §16)。
5. 実キーがあれば、判断系 5 ツールを 1 回ずつ呼び、応答を記録する。無ければ省略と記録する。
6. `browser_setup` を 2 回続けて呼び、1 回目が `installed`、2 回目が `already_installed` を返す。続けて `browser_check` を公開ページで 1 回呼ぶ(実キーが無ければ `not_configured` を確かめて記録する)。
7. プラグインとして導入した Claude Code から `browser_check` を `evidence: "always"` で呼び、証跡が対象プロジェクトの `.jevriel/runs/browser/<name>/` に作られることを確かめる。MCP サーバーの cwd と `CLAUDE_PROJECT_DIR` の有無を stderr のログで記録する(設計書 §17-1)。
8. `grep -rni -e codiel -e metatron -e sandalphon -e raphael -e agent-policy -e prompt-smith plugins/jevriel/src plugins/jevriel/skills` が 0 件。

### T15: コードレビュー(並列、読み取りのみ)

| ID | 内容 | 担当 |
| --- | --- | --- |
| T15a | T2〜T7 の差分(共通部・判断系・証跡・API 系)。必ず見る点: (1) ユーザーのデータが state のキーにあり instructions と `criteria` に無い (2) 単独上限と分割の規則が §8-3 の 2 つだけ (3) 開始前の失敗と開始後の例外の扱いが §5-1 どおり (4) `redact` と `sanitizeUrl` を通さずに state・`log.json` へ入る URL とヘッダが無い (5) §1 のレビューの焦点 F1・F2・F4・F5 のテストがある | コードレビュー |
| T15b | T8〜T10 の差分(ブラウザ系)。必ず見る点: (1) Playwright の値 import が無い (2) 終了判定が act の前にある (3) route が許可外のメインフレームのナビゲーション以外を必ず continue する (4) `evidence: "none"` で trace とスクリーンショットが一切作られない (5) `browser.close()` が全経路で呼ばれる (6) §1 のレビューの焦点 F3・F4 のテストがある | コードレビュー |
| T15c | T11・T12 の差分。必ず見る点: (1) 他プラグイン名が README の「Codiel との併用」節の外に無い (2) SKILL.md の `allowed-tools` が実際の 10 ツール名と一致する (3) README のツール一覧と引数が実装と一致する | コードレビュー |

依頼文に「ファイルを変更しない」「報告のみを返す」「使用してよい tools を読み取り系に限定する」を明記する。

### T16: 最終突き合わせ(オーケストレーター)

全差分を分割せず一度に読み、設計書と突き合わせる。特に次を確かめる。

1. 10 ツールの名前と入力スキーマが設計書 §5-2〜§5-11 と一致する。
2. `RunRecord` のフィールドが設計書 §5-1 と一致し、4 ツールの出力と `result.json` が同じ構造である。
3. 設計書 §15 の表の全行が、下の対応表のどれかのテストで確かめられている。

   | 設計書 §15 の行 | 確かめるタスクとテストファイル |
   | --- | --- |
   | `jev/budget.test.ts` | T2 `jev/__test__/budget.test.ts` |
   | `jev/verdict.test.ts` | T2 `jev/__test__/verdict.test.ts` |
   | `jev/client.test.ts` | T2 `jev/__test__/client.test.ts` |
   | `tools/judging.test.ts` | T3・T4 `tools/__test__/judging.test.ts` |
   | `browser/snapshot.test.ts` | T9 `browser/__test__/snapshot.test.ts` |
   | `browser/loop.test.ts` | T10 `browser/__test__/loop.test.ts` |
   | `evidence.test.ts` | T5 `src/__test__/evidence.test.ts`(正規化・階層・保存の有無・`files`・`result.json`)。trace とスクリーンショットの呼び出しの有無は T10 `browser/__test__/driver.test.ts` と `loop.test.ts`、4 ツールの `result.json` とツール出力の一致は T6・T7 `tools/__test__/api.test.ts` と T9・T10 `tools/__test__/browser.test.ts`(§7 の #1) |
   | `browser/playwright.test.ts` | T8 `browser/__test__/playwright.test.ts` |
   | `api/template.test.ts` | T7 `api/__test__/template.test.ts` |
   | `api/http.test.ts` | T6 `api/__test__/http.test.ts`。「`api_check` が 3xx を追わないこと」は `sendRequest` のテストで確かめる |
   | `api/loop.test.ts` | T7 `api/__test__/loop.test.ts`。`evidence` の 3 値は T7 `tools/__test__/api.test.ts` |
   | `browser/driver.test.ts` | T10 `browser/__test__/driver.test.ts` |
   | `tools/shared.test.ts` | T2 `tools/__test__/shared.test.ts` |
   | `tools/api.test.ts` | T6・T7 `tools/__test__/api.test.ts` |
   | `tools/browser.test.ts` | T8・T9・T10 `tools/__test__/browser.test.ts` |
   | 固定データの採取手順 | T9 `docs/rationale.md` |

4. 設計書 §16 の Done 条件の各項目に、T14 の記録か該当コミットがある。

食い違いは §7 に記録し、該当タスクをやり直す。

## 3. 依存関係

```
T0 ─ T1 ─ T2 ─ T3 ─ T4 ─ T5 ─ T6 ─ T7 ─ T8 ─ T9 ─ T10 ─ T11 ─ T12 ─ T13 ─ T14 ─┬─ T15a ─┬─ T16
                                                                               ├─ T15b ─┤
                                                                               └─ T15c ─┘
```

- T1〜T10 はすべて直列にする。T3・T4 と T5 は触るソースが重ならないが、並列に出すとそれぞれが build した `dist/server.mjs` を互いに書き潰すため、T5 は T4 のコミットの後に始める。
- API 系(T6・T7)をブラウザ系(T8〜T10)より前に置く。設計書は `redact` を `api/http.ts` に置き(§9-3)、`sanitizeUrl` と `allowedHosts` の一致規則をブラウザ系も使う。先に `api/http.ts` を作れば、ブラウザ系は定義済みの関数を使うだけになる。
- T8 は T7 の後に置く(並列にもできるが、`src/server.ts` と `ToolDeps` の追記が続くため直列にして衝突を避ける)。
- T11 は T10 のコミットの後に始める。開始時に `pnpm --filter jevriel-scripts build` を実行してから、`dist/server.mjs` の `tools/list` でツール名を確かめる。`allowed-tools` に書くツール名は、10 個がそろった状態でしか確かめられない。
- T12 は T11 の後に置く。README がスキル名とツールの最終形を参照する。
- T13 は T12 の後に置く。ADR と Serena メモリは最終の構成で書く。

## 4. タスク間で共有する契約

依頼文へ転記し、担当が推測で決めないようにする。

**ファイルの持ち主**

| ファイル | 作るタスク | 追記するタスク |
| --- | --- | --- |
| `src/server.ts` | T1 | T3(`registerJudgingTools`)、T6(`registerApiTools`)、T8(`registerBrowserTools`) |
| `src/tools/shared.ts` | T2 | なし |
| `src/tools/judging.ts` | T3 | T4 |
| `src/tools/api.ts` | T6 | T7 |
| `src/tools/browser.ts` | T8 | T9、T10 |
| `src/evidence.ts` | T5 | なし |
| `src/api/http.ts` | T6 | なし |
| `src/browser/snapshot.ts` | T9 | なし |
| `docs/rationale.md` | T9(固定データの採取手順の節) | T12 |

**ツールハンドラの形**

- 各ツールは `<toolName>Input`(zod の raw shape)と `handle<ToolName>(args, deps)` を export し、`register*Tools` が `server.registerTool(name, { description, inputSchema }, (args, extra) => handle...(args, deps))` で登録する(raguel-mcp の `src/tools/listRules.ts` と同じ形)。テストは `handle*` を直接呼ぶ。
- `browser_setup` だけは `handleBrowserSetup(extra, deps)` で、MCP の `extra` から progressToken を取り `sendProgress` に変換して渡す。
- 同じ群のツールを後のタスクで足すときは、既存の `register*Tools` の本体に `registerTool` の呼び出しを 1 つ足す。新しい register 関数を作らず、`src/server.ts` も変えない。形は次のとおり(T4 の例)。

  ```ts
  server.registerTool("check_claims", { description: "...", inputSchema: checkClaimsInput }, (args) => handleCheckClaims(args, deps))
  server.registerTool("assess_action", { description: "...", inputSchema: assessActionInput }, (args) => handleAssessAction(args, deps))
  ```

**記録を返す 4 ツールの処理の順番**

1. キー確認(`hasApiKey`)→ 入力の意味的検証(`validateThresholds` など)→ 開始前の失敗は `errorResponse` で返す。
2. `name = normalizeName(args.name, 起点 URL, kind)`、`flags = captureFlags(args.evidence)`、`flags.dir` なら `createRunDir`。
3. `log: LogEntry[] = []`、`jev = recordingJev(deps.jev, log, deps.now)` で本体を実行する。
4. `finalizeEvidence({ dir, mode, record, log, files })` の戻り値を `toResponse` で返す。

**Jev 呼び出しのタイムアウト**

ループ(T7 の `runApiGoal`、T10 の `runBrowserGoal`)の中の Jev 呼び出しだけ、`jev(req, { timeout: 30_000 })` とする。判断系と `*_check` は options を渡さない(設計書 §5-1)。

## 5. コミット

| # | タスク | メッセージ |
| --- | --- | --- |
| 1 | T1 | `feat(jevriel): プラグインの雛形を追加しワークスペースへ登録する` |
| 2 | T2 | `feat(jevriel): Jev クライアントとトークン予算・閾値・応答の共通部を追加する` |
| 3 | T3 | `feat(jevriel): jev_ask・classify_items・rank_items を追加する` |
| 4 | T4 | `feat(jevriel): check_claims と assess_action を追加する` |
| 5 | T5 | `feat(jevriel): 証跡ディレクトリとテスト対象名の正規化を追加する` |
| 6 | T6 | `feat(jevriel): HTTP の共通部と api_check を追加する` |
| 7 | T7 | `feat(jevriel): API テンプレートと api_run_goal を追加する` |
| 8 | T8 | `feat(jevriel): Playwright の解決と browser_setup を追加する` |
| 9 | T9 | `feat(jevriel): スナップショットの抽出と browser_check を追加する` |
| 10 | T10 | `feat(jevriel): ブラウザのドライバ・ループと browser_run_goal を追加する` |
| 11 | T11 | `feat(jevriel): スキル judging と発火評価セットを追加する` |
| 12 | T12 | `docs(jevriel): README と設計根拠を追加しルート README に追記する` |
| 13 | T13 | ADR は metatron の CLI の規定に従う。Serena メモリは `docs: Serena メモリに jevriel を追加する` |

- すべてのメッセージの末尾に、セッションの指示にある Co-Authored-By の行を付ける。
- 本計画書は、ユーザー承認の後にコミット 1 の前で別にコミットする(`docs(jevriel): 実装計画書を追加する`)。
- 各コミットの時点で lint / typecheck / test が通る。`dist/server.mjs` の差分の有無は §1 の作業の規律に従う(1、3、4、6〜10 は含み、2 と 5 は無い)。コミットの前に `git status --short` を見て、本件と無関係なファイルを含めない。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| `@typesafe-ai/sdk` 0.6.0 の実際の型・例外クラス名・`systemOne` の options が設計書の記述と違う | T2 の担当が型定義を読んでから書く。違いがあれば止めて報告し、§7 に記録する。noul の `criteria` の値の型(`EntryType`)もここで確かめる |
| 担当が Playwright を値 import し、バンドルに入る | §1 の全体の制約に明記する。T14 の 3 と T15b の (1) で検出する |
| 担当が到達しないモジュールだけを足したタスク(T2、T5)で dist の差分が無いのを異常と誤解し、`server.ts` に仮の import を足す | §1 の作業の規律と T2・T5 の検証欄に、dist が変わらないのが期待値だと書いた |
| T9 の固定データを採取する環境に Playwright 1.63 が無い | T8 の `browser_setup` で入れたキャッシュの Playwright を使って採取する。採取できなければ止めて報告する(手書きの JSON で代えない) |
| T10 の担当が終了判定を act の後に置く | 要点に §6-1 のステップの順を明記した。`loop.test.ts` の「done / stuck / reached のときに act しない」が検出する |
| T11 の発火評価が収束せず、description が長くなる | skill-creator の手順どおり評価と改善を回し、収束しなければ評価結果を添えて報告する。発火率の目標は担当が決めず、オーケストレーターが評価結果を見て判断する |
| T13 で ADR を `stage-adr` だけで起票し、スキルの手順を飛ばす | T13 の要点に `metatron:updating-architecture` の起動を必須と書いた |
| MCP サーバーの cwd がプロジェクトでなく、証跡と Playwright の解決先がずれる | T14 の 7 で実測する。ずれていたら §7 に記録し、設計書 §7-1 の `projectDir` の決め方を見直すかをユーザーに確認する |
| 実キーが無く、Jev との疎通を確かめられない | T14 の 5・6 を省略と記録する。Done 条件の実機確認はキーが用意できた時点で行う(§8) |

## 7. 設計書との食い違い

計画立案時に検出した事項。実装中に見つけた食い違いも、この表へ追記する。

| # | 検出タスク | 設計書の記述 | 計画での扱い | 判断 |
| --- | --- | --- | --- | --- |
| 1 | 計画 | §15 の `evidence.test.ts` の行に、trace の開始とスクリーンショットの呼び出しの有無、4 ツールの `result.json` とツール出力の一致を含める | `src/evidence.ts` 単体では Playwright とツール出力を持たないため、`captureFlags` と `finalizeEvidence` の検査を T5 に、呼び出しの有無を T10 の driver / loop のテストに、4 ツールの一致を T6・T7・T9・T10 のツールのテストに分けた | 採用・設計書へ反映済み |
| 2 | 計画 | §15 の表に `tools/api.test.ts`・`tools/browser.test.ts`・`tools/shared.test.ts`・`browser/driver.test.ts` の行が無い | キー確認・開始前の失敗・証跡の組み込み・route の判定を確かめるため、この 4 ファイルを足した。§15 の既存の行は削らない | 採用・設計書へ反映済み |
| 3 | 計画 | §4-1 の構成図に `sanitizeUrl` と `allowedHosts` の一致規則の置き場所が無い | `redact` と同じ `src/api/http.ts` に置き(§9-3 の `redact` の置き場所に合わせた)、ブラウザ系から使う。これに合わせて API 系を先に実装する | 採用・設計書へ反映済み |
| 4 | 計画(レビュー反映時) | §8-4 は「本文を空にしても収まらないときは `budget_exceeded` を返す」。§5-1 は「開始後の例外は `isError` にせず `status: "error"` の `RunRecord` を返す」 | ループ型の 2 ツールで、2 ステップ目以降(history が増えた後)に予算を超えたとき、どちらに従うかが決まっていない | 開始前は `isError` の `budget_exceeded`、開始後は `status: "error"`・`error.kind: "budget_exceeded"` の `RunRecord` と証跡(設計書 §8-4 の 5. と §5-1 の `RunRecord.error.kind`)。T7・T10 の要点と検証に反映 | 採用・反映済み |

## 8. 未解決事項と着手の関係

設計書 §17 の未解決事項は、着手を止めない。各項目を確かめるタスクは次のとおり。

| 設計書 §17 | 確かめるタスク |
| --- | --- |
| 1 MCP サーバーの cwd と `CLAUDE_PROJECT_DIR` | T14 の 7 |
| 2 見積り係数と上限の 8 割 | 本計画では確かめない。T2 の `createJevCall` が見積りと `usage.input_tokens` の比を `log.debug`(stderr)に出す(設計書 §8-1)。運用後にその記録で見直す |
| 3 閾値の既定値 | 本計画では確かめない。運用で見直す |
| 4 証跡から秘密だけを除く手段 | 本計画では扱わない(初版の範囲外) |
| 5 `playwright/package.json` の解決 | T8 |
| 6 `filechooser` を無視したときの挙動 | T10 |
| 7 パッケージ名 | 決定済み(`jevriel-scripts`。ARCHITECTURE のコマンド定義に合わせる)。確かめることは無く、T1 でこの名前を使う |

実キーの有無は着手を止めない。キーが無い間は、T14 の 5・6 と設計書 §16 の実機確認を保留として記録する。

## 9. Done 条件

設計書 §16 に、本計画書で足した次の項目を加える。

- T0 の baseline と T14 の結果が記録されている。
- 各コミットの時点で lint / typecheck / test が通っている。
- `server.ts` の到達グラフを変えたコミット(1、3、4、6〜10)に `dist/server.mjs` の差分が含まれ、変えないコミット(2、5)に `dist/` の差分が無い。
- §1 のレビューの焦点 F1〜F5 のテストが、指定したタスクのテストファイルにある。
- T15 の報告と T16 の突き合わせで見つかった食い違いが §7 に記録され、解消されている。

## 10. 実施記録

実装のセッションで追記する。
