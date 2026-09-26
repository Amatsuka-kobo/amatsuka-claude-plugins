# jevriel OpenAPI 連携 実装計画書

- 作成日: 2026-09-25
- 対象プラグイン: `plugins/jevriel`(`0.1.0-dev` → `0.2.0-dev`)
- 設計書(正本): `harness-docs/design/2026-09-25-jevriel-openapi-design.md`(以下「設計書」)。初版の設計書 `harness-docs/design/2026-09-25-jevriel-design.md` を「初版設計書」と呼ぶ
- 設計書のユーザー承認: **取得済み(2026-09-25)**(コミット `cfe9adb`)
- 計画立案時の HEAD: `cfe9adb`
- 前提: 初版計画 `harness-docs/plans/2026-09-25-jevriel-plan.md` の T0〜T16 が完了し、`plugins/jevriel` が `0.1.0-dev` で動作していること。計画立案時点では `plugins/jevriel` はまだ無い
- 実装は別セッションで行う。

この計画書はタスクの分割・順序・検証方法・タスク間の契約だけを定め、設計判断を上書きしない。各タスクの要点に設計書の節番号を添える。実装者は設計書の該当節を正本として読み、初版の実装済みコードを実際に読んでから手を入れる。設計書・初版の実装・この計画書の間に食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。オーケストレーターは §7 に記録し、設計書の修正要否を判断する。

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`。変更が要るかは T9 でオーケストレーターが確かめ、要るときだけ metatron のスキルと CLI で行う。ほかのタスクの担当は、更新が要ると気付いても修正せず報告する。
- `.claude/rules/metatron/` の 3 ファイル。
- 初版の設計書と初版の計画書。初版の計画書の §10 実施記録にも追記しない。
- `plugins/jevriel/dist/` の手編集。`src/` を変え、`pnpm --filter jevriel-scripts build` で再生成する。
- 他プラグインのファイル(`plugins/codiel/raguel-mcp/` を含む)。raguel-mcp は `yaml` の使い方の参考として読むだけにする。
- `tsconfig.json`・`vitest.config.ts`・`biome.json`・`pnpm-workspace.yaml`・`.claude-plugin/marketplace.json`(設計書 §4。既存の登録で足りる)。
- `.serena/memories/` を Edit / Write で触ること。T9 でオーケストレーターが Serena のツールで行う。
- `.raphael/`。
- 本件と無関係な未コミット変更。T0 で記録し、触らず、revert もしない。

## 1. 進め方の共通規律

### 全体の制約

設計書と初版計画から原文の値で写す。

- 初版計画 §1 の「全体の制約」はすべて引き継ぐ。例外は次の 3 つだけで、いずれも本計画が明示する例外である。
  - **実行時依存の追加。** 初版計画 §1 は実行時依存を `@typesafe-ai/sdk`・`@modelcontextprotocol/sdk`・`zod` の 3 つに限る。本拡張は `yaml` `^2.9.0` を足す(設計書 §4)。版と import の形は raguel-mcp に揃える(`import { parse as parseYaml } from "yaml"`)。ほかの依存は足さない。
  - **契約の凍結の例外。** 初版計画 §1 は「インターフェース行の名前とシグネチャは担当が変えない」とする。T1 だけは初版 T7 の `ApiGoalInput.requests` を `source: RequestSource` に置き換える(設計書 §4・§5-5)。T1 の担当はこの変更を報告に明記し、オーケストレーターは §10 に記録する。
  - **path の伏字による証跡の変更。** `inputs` の値を置いた path の要素を、証跡と state に入れる URL で `[redacted]` にする(設計書 §4・§9-3)。初版のテンプレートで `{{inputs.*}}` を path に書いたときの `RunRecord` と証跡の URL も変わる。T1 の担当はこの変更を報告に明記する。
- バージョンは `plugin.json`・`package.json`・`src/server.ts` の `McpServer` の `version` の 3 箇所を `0.2.0-dev` に揃える(T8)。
- ツールは 11 個になる。追加は `api_list_operations` だけである(設計書 §6)。
- ツールの description とスキル `judging` の本文・description に、他プラグインの名前と他プラグイン固有の概念を書かない。他プラグイン名を書いてよいのは README の「Codiel との併用」節だけ(初版設計書 §10-2、§11、設計書 §12)。
- `inputs` の値を Jev へ送らない。証跡の `ApiStep.values` にも実値を入れない(設計書 §5-6、§9-3)。
- ブランチを切らない(プロジェクト規約)。main で作業する。タスクごとにコミットする。

### 作業の規律

- 各タスクでは、テストを先に書いてから実装する。タスクの完了時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ることを完了条件にする。
- `plugins/jevriel/src/` を変えるタスクは、最後に `pnpm --filter jevriel-scripts build` を実行する。
  - `server.ts` の到達グラフを変えるタスク(T1、T5、T6、T8)は、`plugins/jevriel/dist/server.mjs` の差分を同じコミットに含める。
  - 到達グラフを変えないタスク(T2〜T4。`openapi.ts` と `fill.ts` は T5 まで `server.ts` から到達しない)は、build が通ることと `git status --short plugins/jevriel/dist` に差分が無いことを検証にする。
- ネットワークとブラウザをテストで使わない。Jev は `createJevCall({ apiKey: "test", fetch: fakeFetch })`、対象 API と spec の URL 取得は `ToolDeps.httpFetch` のフェイクで差し替える(設計書 §15)。
- 各タスクの「インターフェース」行の名前とシグネチャは、タスク間の契約である。担当は変えない(T1 の例外を除く)。変える必要が出たら止めて報告する。
- 各タスクの「検証」にあるテストケースは最低限の一覧である。担当が足すのはよい。削るのは報告を要する。
- ツールの description は英語で書く。1〜2 文で、何をするかと主な引数だけを書く。
- `src/**/*.ts`・テスト・README のタスクにはスキルをロードさせない。スキルを使うのは T7(`prompt-smith:prompt-smith`)だけ。
- 設計判断・要件の追加・スコープの拡大は担当が決めず、オーケストレーターへ差し戻す。

### レビューの焦点

設計書が要求しているのに、設計書 §15 のどのテストも直接は叩かない入力や状況を 5 件挙げる。選んだ軸は次の 2 つである。(a) 利用者が最初の数回の利用で出会う。(b) 壊れても isError にならず、送り先・値・証跡が静かに誤る、または秘密が外へ出る。各件の固定テストを下の列のタスクへ足し、そのタスクの「検証」欄に書いた。T11 のコードレビューでは、この 5 件を必ず見る。

| # | 入力・状況 | 壊れたときに利用者に起きること | 固定するタスク |
| --- | --- | --- | --- |
| G1 | `spec` にプロジェクト相対のパス(`openapi.yaml`)を渡し、MCP サーバーの cwd がプロジェクトと違う | cwd を基準に読んで「見つからない」になる、または別のディレクトリの同名ファイルを読む。`projectDir` 配下の検査も誤った基準で通る | T2 |
| G2 | パスを持つ `baseUrl`(`http://localhost:3000/api/v1`、末尾の `/` の有無の両方) | `new URL(path, baseUrl)` 相当の結合で `/api/v1` が消える、または `//users` になる。404 が応答として記録されるだけで、Jev は別の操作を探し続ける | T4 |
| G3 | 3.0 の文書で path パラメータに `required` が書かれていない | 任意扱いになり `omit` が候補に入る。`omit` を選ぶと `{id}` が残って毎回 `skip` になり、`max_steps` まで空回りする | T2、T3 |
| G4 | `headers` 引数に小文字の `authorization` を書き、同時に bearer の scheme 名が `inputs` にある | 大小文字を区別して重ねると `Authorization` と `authorization` が両方入り、`fetch` が値をカンマで連結して送る。401 が応答として記録されるだけ | T4 |
| G5 | `spec` の URL のクエリにトークンがある(`https://host/openapi.json?token=abc`) | `RunRecord.spec.source` と `result.json`、エラーの message にトークンが残る | T2、T5 |

## 2. タスク

### T0: baseline(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 作業 | `git status --short` で本件と無関係な未コミット変更を記録する。`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` を実行し、結果とテスト件数を記録する。`plugins/jevriel/.claude-plugin/plugin.json` と `package.json` の version が `0.1.0-dev` であることを確かめる。`TYPESAFE_API_KEY` を外した環境で `node plugins/jevriel/dist/server.mjs` に `initialize` と `tools/list` を送り、初版の 10 ツールが返ることを記録する。`npm view yaml@^2.9.0 version` で取得できる版を記録する。初版の `src/api/loop.ts`・`template.ts`・`tools/api.ts`・`src/evidence.ts` の export 名を一覧にし、初版計画 T5〜T7 の produces と一致するかを記録する。初版の `api_run_goal` が予算超過(初版設計書 §8-4 の 5.)で返す `reason` が `"budget_exceeded"` であることと、`error.errorClass` の実値を、実装とテストから読んで記録する(T1 が同じ値を使う) |
| 検証 | 4 コマンドがすべて通り、`tools/list` が 10 ツールを返す。通らないとき、10 ツールでないとき、export 名が初版計画と違うときは本件に入らず報告する(export 名の違いは §7 に記録し、本計画の consumes を実名へ直してから進める) |
| コミット | なし |

### T1: `RequestSource` へのリファクタ

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/loop.ts`、`src/api/template.ts`、`src/evidence.ts`(型の追加だけ)、`src/tools/api.ts`(`templateSource` を組んで渡す箇所だけ)、`src/api/__test__/loop.test.ts`、`src/api/__test__/template.test.ts`、`src/tools/__test__/api.test.ts`(state を比較する期待値の更新だけ)、`dist/server.mjs` |
| 要点 | 設計書 §4(完了条件と契約の凍結の例外)。**許可する差分**は次の 4 つだけである: (1) Jev へ送る state の `requests` の各要素で `description` を `summary` に置き換えること (2) 同じ要素に `requiredParams` と `body` を足すこと (3) テストの入力の `requests` を `source: templateSource(...)` に、`dropSummary: false` を足すこと (4) `log.json` の中の state に現れる (1)(2) の差分。`RunRecord` と `result.json` は、path の伏字(下)の例外を除いて変えない。§5-3(選択肢の説明は `summary ?? "<METHOD> <path>"`。テンプレート版は初版の `description` を `summary` として持つ)、§5-4(`missing_input` と `budget_exceeded` の行)、§5-5(`RequestSource`・`BuildResult`・`RecentResponse` の型と、ループ側の扱いの全項目)、§5-6(`ApiStepValue`・`ApiStep` と `RunRecord` への追加、`error.kind` は初版設計書 §5-1 の定義のまま)。ループ側は spec 版が返しうる `BuildResult` の全ての形をこのタスクで扱う(テンプレート版は `ok: true` と `skip` しか返さないが、ほかの形はフェイクの `RequestSource` で確かめる)。**予算超過。** `BuildResult` の `budget_exceeded` を受けたときの `RunRecord` は、共有ループの既存の予算超過の分岐(初版設計書 §8-4 の 5.)と同じ値にする: `reason: "budget_exceeded"`、`error.kind: "budget_exceeded"`、`error.errorClass` は T0 で記録した初版の値。既存の分岐は変えない。`dropSummary` はループの入力で受け、全ステップの `build` に同じ値を渡し、decide の state の `summary` もこの値で落とす。テンプレート経路では常に `false` を渡す(初版に無かった `summary` の削り落としで挙動を変えないため)。**path の伏字**(§7 の #1 の決定): ループは `ApiStep.url`、`log.json` の `request.url`、state に入れる URL のすべてを `redactPathSegments(url, inputPathSegments)` → `sanitizeUrl` の順に通す。送信する URL は生のまま。テンプレート経路では `templateSource.build` が spec 版と同じ `BuildResult` を返し、その `inputPathSegments` は、`path` を "/" で分けた各要素を `resolvePlaceholders` で調べて `usedInputs: true` だった要素の位置を、最終の URL の pathname での添字に直したものとする。これで初版のテンプレートで `{{inputs.*}}` を path に書いたときの同じ穴も塞ぐ。これは `RunRecord` と証跡を変えるが、`inputs` を path に書いた場合に限られ、秘密を証跡へ残さないための意図した変更として報告に明記する(§4 の完了条件の例外) |
| インターフェース | consumes: 初版 T7 の `RequestTemplate`・`resolveTemplate`・`runApiGoal`・`ApiGoalInput`、初版 T6 の `ApiRequest`・`ApiResponse`、初版 T5 の `RunRecord`・`ApiStep`・`LogEntry`・`recordingJev`、初版 T2 の `JevCall`・`JevRequest`・`estimateValue`・`estimateQuestion`・`TOTAL_BUDGET`・`LONGEST_BUDGET`。produces(evidence.ts): `type ApiStepValue`(設計書 §5-6 のとおり)、`ApiStep` に `values?: ApiStepValue[]` と `undocumented?: true`、`RunRecord` に `spec?: { source: string; openapi: string; operations: number }`。produces(loop.ts): `type RecentResponse`・`type RequestSource`・`type BuildResult`(§4 の共有契約のとおり)、`RECENT_MAX = 5`、`redactPathSegments(url: string, segments: readonly number[]): string`(pathname を "/" で分けた要素のうち `segments` の添字の要素を `[redacted]` に置き換える。クエリとフラグメントはそのまま残し、後段の `sanitizeUrl` に任せる)、`pushRecent(recent: readonly RecentResponse[], entry: RecentResponse): RecentResponse[]`(同じ名前を除いてから先頭へ入れ、5 件で切る)、`type ApiGoalInput = { baseUrl: string; goal: string; source: RequestSource; assertions: string[]; inputs: Record<string, string>; maxSteps: number; allowedHosts: string[]; timeoutMs: number; thresholds: Thresholds; name: string; dropSummary: boolean }`、`runApiGoal(input: ApiGoalInput, deps: { jev: JevCall; send: (req: ApiRequest) => Promise<ApiResponse>; now: () => Date; log: LogEntry[] }): Promise<Omit<RunRecord, "evidence">>`(シグネチャは初版のまま、入力の型だけ変わる)、`chooseDropSummary(input: Omit<ApiGoalInput, "dropSummary">): { ok: true; dropSummary: boolean } \| { ok: false; message: string }`(decide の state を `last.body` を空にして見積もり、上限内なら false、`summary` を落とせば収まるなら true、それでも超えるなら `ok: false`。設計書 §10-3。T5 が spec 経路でだけ呼ぶ)。produces(template.ts): `templateSource(requests: Record<string, RequestTemplate>): RequestSource`(`stateKey: "requests"`。`build(name, ctx, jev): Promise<BuildResult>` は `jev` を呼ばず、`ok: true`(`inputPathSegments` 付き)か `skip` だけを返す)、`resolvePlaceholders(text: string, ctx: { inputs: Record<string, string>; steps: Record<string, ApiResponse> }): { ok: true; value: string; usedInputs: boolean } \| { ok: false; unresolved: string }`(ヘッダ値 1 件のプレースホルダ解決。初版の `resolveTemplate` の内部で同等の処理があればそれを export し、無ければ `resolveTemplate` と同じ規則で切り出す。`resolveTemplate` はこの関数を使うよう書き換えてよいが、シグネチャと結果は変えない) |
| 担当 | 複雑または重要な実装(公開インターフェースの変更と、ループの状態遷移・証跡が絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。**振る舞いの不変**: 初版の `api/loop.test.ts` と `tools/api.test.ts` の既存ケースが通る。既存ケースへの変更は要点の「許可する差分」(1)〜(4) だけで、`RunRecord` と `result.json` の期待値は変えない(path に `{{inputs.*}}` を書いた既存ケースがあれば、その URL の伏字だけを例外とする)。変更した箇所を (1)〜(4) と伏字のどれに当たるかを添えて報告に列挙する。予算超過の既存ケースが `reason: "budget_exceeded"` と T0 で記録した `error.errorClass` のまま。テストケース(**api/template.test.ts** に追加)— `templateSource` の `list` が `requiredParams: []`、`body` をテンプレートの `body` の有無で `"json"` / `"none"`、`summary` を `description` で持つ / 未解決のテンプレートで `build` が `{ ok: false, skip: "unresolved: {{...}}" }` / `resolvePlaceholders` が `{{inputs.k}}` で `usedInputs: true`、`{{steps.x.body.id}}` だけなら `usedInputs: false`、未定義で `unresolved`。(**api/loop.test.ts** に追加、フェイクの `RequestSource` と Jev)— decide の選択肢の説明が `summary` のあるものは `summary`、無いものは `"<METHOD> <path>"` / `dropSummary: true` で state の `requests`(または `operations`)から `summary` が消え、全ステップの `build` に `dropSummary: true` が渡る / `skip` で送らず history に note を残して次へ / `stuck: "missing_input"` で送らず最終判定を行い `status: "stuck"`、`reason: "missing_input"`、history に note / `kind: "budget_exceeded"` で最終判定をせず `status: "error"`、`reason: "budget_exceeded"`、`error.kind: "budget_exceeded"`、`evidence: "always"` の証跡が残る / `isDocumented` が false を返すと次の decide の `state.last.undocumented` が true で、同じステップの `ApiStep.undocumented` が true / `values` と `note` が `ApiStep` に入る / `build` の中の Jev 呼び出しが `usage.requests` と `usage.inputTokens` に数えられ、1 ステップの Jev 呼び出しが 2 回以下 / `recent` が新しい順で、同じ名前は最新だけ、6 件目を送ると 5 件 / `chooseDropSummary` の 3 通り(収まる、`summary` を落とせば収まる、落としても超える) / `redactPathSegments("https://h/api/v1/users/s3cret?x=1", [4])` が `https://h/api/v1/users/[redacted]?x=1` / フェイクの `RequestSource` が `inputPathSegments: [2]` を返すと、送信関数が受け取る URL は生の値を含み、`ApiStep.url` と `log.json` の `request.url` は `[redacted]` になる。(**api/template.test.ts** に追加)— `baseUrl` が `http://h/api`、path が `/users/{{inputs.uid}}/posts` の `build` が `inputPathSegments: [3]` を返す / 絶対 URL の path でも添字が最終の URL の pathname に合う / `{{inputs.*}}` を含まない path で `[]`。(**tools/api.test.ts**)— テンプレートの path に `{{inputs.uid}}` を書いた `api_run_goal` で、`inputs.uid` の値が `result.json` と `log.json` に現れない |
| コミット | `refactor(jevriel): api_run_goal のリクエスト源を RequestSource へ切り出す` |

### T2: `openapi.ts` と固定データ

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/openapi.ts`、`src/api/__test__/openapi.test.ts`、`src/fixtures/openapi/sample-3.1.json`・`sample-3.1.yaml`・`minimal-3.0.json`、`plugins/jevriel/package.json`(`dependencies` に `"yaml": "^2.9.0"` を足すだけ。version は T8)、`pnpm-lock.yaml` |
| 要点 | 設計書 §7 の全体。§7-1(型)、§7-2(URL は `redirect: "manual"`・3xx は `request_failed` で `Location` を含めない・2xx 以外は `invalid_input`・`allowedHosts` の検査をしない、ローカルパスは `projectDir` 基準で解決して正規化し配下に無ければ `invalid_input`、5MiB は累計が 5,242,880 バイトを超えた読み取りのあとで打ち切って以降は読まず、ちょうど 5,242,880 バイトは成功、ファイルは読む前に同じ境界で確かめる、`JSON.parse` の後に `parseYaml`・失敗の message は種別と行番号だけ、`openapi` の正規表現 `^3\.[01](\.\d+)?$`・`paths` の必須・Swagger 2.0 の案内)、§7-3(外部参照の走査、遅延解決の箇所、JSON Pointer のデコード順、解決中のスタックでの循環検出と 16 段、兄弟キーの 3 規則)、§7-4(列挙の順、既定メソッド、path-level の継承、cookie と無視するヘッダ名の大小文字を区別しない比較、例の読み方と `enum` / `default` は schema から、`content` パラメータ、style と `supported`、本文と 3.0 の GET / HEAD / DELETE、servers の優先順と variables、名前の規則、重複と予約語、件数)、§9-1(securitySchemes の分類: apiKey の header / query と http の bearer / basic は対応、oauth2・openIdConnect・`in: cookie` の apiKey・ほかの http scheme は `unsupported`。`LoadedSpec.schemes` に入れる。操作に `security` が無ければトップレベルの `security` を `Operation.security` に写し、どちらも無ければ null、操作の `security: []` は `[]`)、§15-1(固定データの中身)。`listOperations` は `limit` が `RUN_LIMIT`(253)のとき `supported: false` の操作を除いてから件数を数え、`LIST_LIMIT`(255)のときは除かずに数える(設計書 §7-4 の「`api_run_goal` の選択肢から除く」と「一覧では除かずに載せる」を 1 つの関数で満たす)。`path` の `in` のパラメータは文書の記述に依らず `required: true` にする(§7-1)。`loadSpec` の message と `LoadedSpec.source.location` の URL は `sanitizeUrl` を通す。`pnpm install` を実行する |
| インターフェース | consumes: 初版 T6 の `sanitizeUrl`、初版 T2 の `ToolDeps`(`projectDir` と `httpFetch` の型)。produces: `type HttpMethod = "GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE" \| "HEAD" \| "OPTIONS"`、`type Include = { tags?: string[]; pathPrefix?: string; methods?: HttpMethod[] }`、`type OperationParam`・`type OperationBody`・`type Operation`・`type SecurityScheme`・`type LoadedSpec`(§4 の共有契約のとおり)、`SPEC_MAX_BYTES = 5 * 1024 * 1024`、`REF_MAX_DEPTH = 16`、`LIST_LIMIT = 255`、`RUN_LIMIT = 253`、`DEFAULT_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH"]`、`loadSpec(spec: string, deps: { projectDir: string; fetch: typeof fetch; timeoutMs: number }): Promise<{ ok: true; spec: LoadedSpec } \| { ok: false; kind: "invalid_input" \| "request_failed"; message: string }>`(`timeoutMs` は 1 つの引数で、既定値を持たない。呼び出し側がそれぞれの値を渡す: T5 は `api_run_goal` の `timeoutMs`、T6 は 30,000)、`listOperations(spec: LoadedSpec, include: Include \| undefined, limit: 253 \| 255): { ok: true; operations: Operation[] } \| { ok: false; message: string }`、`operationName(method: HttpMethod, path: string, operationId: string \| null): string`、`resolveRef(doc: Record<string, unknown>, node: unknown, openapi: string): { ok: true; value: unknown } \| { ok: false; message: string }` |
| 担当 | 複雑または重要な実装(未信頼の入力の読み込み・パスの封じ込め・参照解決が絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build(`dist/` に差分が無い)。テストケース(**api/openapi.test.ts**)— 設計書 §15-2 の `api/openapi.test.ts` の行の全項目を 1 項目 1 ケース以上で書く。加えて次を assert する: `sample-3.1.json` と `sample-3.1.yaml` の `listOperations` の結果が `toEqual` で一致 / `openapi: "3.0.3"`・`"3.1"`・`"3.1.0"` を受け、`"2.0"`・`"3.2.0"`・`"3.1.0-rc1"`・欠落・`paths` の無い文書が `invalid_input` / フェイクの `fetch` が 1MiB のチャンクを 7 回まで返せるストリームで、6 チャンク目を読んだ後に打ち切られ `invalid_input`(読んだチャンク数が 6 で、7 回目の読み取りが呼ばれない)/ ちょうど 5,242,880 バイト(1MiB を 5 チャンク)で終わる JSON の文書が成功する / 5,242,881 バイトのファイルが `invalid_input` / `sample-3.1.json` の `LoadedSpec.schemes` が apiKey(header)・apiKey(query)・http bearer・http basic を対応の型で、oauth2 を `unsupported` で持つ / `security` を持たない操作の `Operation.security` にトップレベルの `security` が写り、操作の `security: []` は `[]`、どちらも無い文書では null / 302 と `Location: https://evil.example/x` で `kind: "request_failed"` かつ message に `evil.example` を含まない / 壊れた YAML で message に `YAML` と行番号があり、元の文書の行の文字列を含まない / `projectDir` の外を指す `../outside.json` と外の絶対パスが `invalid_input` / `$ref` の兄弟: 3.1 の parameter の Reference Object で `description` が上書きされ `required` は上書きされない、Schema Object の `$ref` の兄弟 `type` が無視される、3.0 では `description` も無視される / `#/components/schemas/a~1b` と `%7E` を含む参照がデコード順どおりに解決する / A→B→A の循環と 17 段の連鎖が `invalid_input`、16 段の連鎖が成功、2 操作が同じ component を指す文書と再帰スキーマが通る / 外部参照 `other.yaml#/x` が `invalid_input` で message に参照先がある / 名前: `get_users_id_posts`、`get_root`、`users.list` → `users_list`、65 文字の operationId の切り詰め / 重複で `invalid_input` と 2 つの `<METHOD> <path>`、名前が `done` と `stuck` の操作のそれぞれで `invalid_input` / path-level の継承と operation-level の上書き / cookie と `AUTHORIZATION`(大文字)のヘッダパラメータが消える / 例: Parameter 直下に `examples` と `example` の両方があると `examples` だけを読み、`schema.example` を続けて読む、`enum` と `default` を schema から読む / `content` パラメータの schema と例を `application/json` から読み、`text/plain` だけの `content` は `supported: false` / `deepObject` のパラメータが `supported: false`、それが必須の操作は `limit: 253` の結果に無く `limit: 255` の結果に `supported: false` で残る / 3.0 の GET の requestBody が `body: null`、3.1 の GET は読む / `include` の 3 条件と AND、`include` 省略時に DELETE・HEAD・OPTIONS が無く、`methods: ["DELETE"]` で DELETE だけ / 253 件で `limit: 253` が通り、254 件で `invalid_input`。`supported: false` を 1 件含む 254 件は `limit: 253` で成功し 253 件を返す / 255 件で `limit: 255` が通り 256 件で `invalid_input`、message に件数と `include` の案内 / servers が operation → path item → ルートの順で採られ `{var}` が `default` で置き換わる / 取得の失敗(fetch が例外)で `request_failed`、404 で `invalid_input`。**G1**: `projectDir` を一時ディレクトリにし、`process.cwd()` と違う場所に置いた `openapi.yaml` を `spec: "openapi.yaml"` で読める。**G3**: 3.0 の文書で `required` の無い path パラメータが `required: true` になる。**G5**: `spec: "https://host/openapi.json?token=abc"` の `LoadedSpec.source.location` と、404 のときの message に `abc` が無い |
| コミット | `feat(jevriel): OpenAPI 文書の読み込みと操作の列挙を追加する` |

### T3: 値埋めの候補と質問

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/fill.ts`、`src/api/__test__/fill.test.ts` |
| 要点 | 設計書 §8-1(対象、任意の `supported: false` のパラメータを外して `style_unsupported`、`json: false` の本文で `body_unsupported`)、§8-2(候補の順、spec の値の重複除去、オブジェクトと配列の値を採る条件、葉値の走査の上限・パス表記・型の一致・並べ方、本文の候補)、§8-3(255 の上限と落とす順、必須の候補 0 個で `missing_input` と note のカンマ区切り、候補 1 個は問わない、問う対象が無ければ Jev を呼ばない)、§8-4(state と questions の形、キー `p1..` と `body`、選択肢のキー `c1..` と `omit`、instructions の `<key>` の置換、選択肢の説明の形と 40 文字の要約、`inputs` の値を説明に入れない)、§8-5(予算超過で葉値を落とし、尽きたら `budget_exceeded` を返す。例外を投げない)。回答の読み取りは、初版 T7 の `runApiGoal` が `next` の choice を読むのと同じ方法で行う。§8-4 の値埋めの質問の形(state・questions・instructions・選択肢の説明)はこのタスクが所有し、T4・T5 は変えない。T3 と T4 の受け渡しは、T3 が作る候補付きの `Target[]` と `readPicks` の結果(`Pick` の Map)だけとする。`buildTargets` の `notes` は配列のまま返し、結合は T5 が行う。§17-1 の確認をここで行う(検証欄) |
| インターフェース | consumes: T2 の `Operation`・`OperationParam`・`OperationBody`、T1 の `RecentResponse`・`ApiStepValue`、初版 T2 の `JevRequest`・`QuestionSpec`・`StateValue`・`estimateValue`・`estimateQuestion`・`TOTAL_BUDGET`・`LONGEST_BUDGET`、SDK の `SystemOneResult<Questions>`(初版 T2 の `JevCall` の戻り型)。produces: `CANDIDATE_LIMIT = 255`、`LEAF_MAX_DEPTH = 6`、`LEAF_MAX_PER_RESPONSE = 200`、`LEAF_MAX_ARRAY_ITEMS = 20`、`SUMMARY_CHARS = 40`、`INPUT_KEYS_LIMIT = 253`、`type Candidate = { source: "input" \| "spec" \| "response" \| "omit"; ref: string \| null; value: unknown; description: string }`(`source: "input"` の `value` は `undefined` とし、値は組み立ての時に `inputs[ref]` から取る)、`type Target = { key: string; name: string; in: "path" \| "query" \| "header" \| "body"; required: boolean; param: OperationParam \| null; candidates: Candidate[] }`、`type Leaf = { path: string; last: string; value: string \| number \| boolean; age: number }`、`collectLeaves(recent: readonly RecentResponse[]): Leaf[]`、`buildTargets(op: Operation, inputs: Record<string, string>, recent: readonly RecentResponse[]): { ok: true; targets: Target[]; notes: string[] } \| { ok: false; missing: string[] }`(`notes` は `style_unsupported` / `body_unsupported`)、`planFill(op: Operation, targets: Target[], ctx: { goal: string; step: number; history: unknown[]; inputKeys: string[]; dropSummary: boolean }): { ok: true; targets: Target[]; request: JevRequest \| null } \| { ok: false; kind: "budget_exceeded"; message: string }`(候補 2 個以上の対象だけを質問にし、無ければ `request: null`。葉値を落とした後の `targets` を返す)、`type Pick = { target: Target; candidate: Candidate; confidence: number \| null }`、`readPicks(targets: Target[], result: SystemOneResult<Questions> \| null): { picks: Map<string, Pick>; values: ApiStepValue[] }`(`SystemOneResult<Questions>` は初版 T2 の `JevCall` の戻り型と同じ型引数で使う。`picks` のキーは `Target.key`。候補 1 個の対象は `confidence: null`、`values` は `targets` の順で全対象を持つ) |
| 担当 | 複雑または重要な実装(外部送信する値の選別と予算が絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build(`dist/` に差分が無い)。テストケース(**api/fill.test.ts**)— 設計書 §15-2 の `api/fill.test.ts` の行のうち、候補・葉値・`omit`・`missing_input`・候補 1 個・本文の候補・選択肢の説明・予算の項目を 1 項目 1 ケース以上で書く。加えて次を assert する: 候補の順が inputs → spec の `examples` → `default` → `enum` → 名前一致の葉 → 不一致の葉 → `omit` / 名前一致・不一致のそれぞれで新しい応答の葉が先 / `types: ["integer"]` に `1.5` を採らず `2` を採る、`types: null` で文字列・数値・真偽値を採る、`types: ["array"]` で葉を採らない、`enum: ["a","b"]` で葉 `"c"` を採らない / 深さ 5 の葉 `steps.x.body.a.b.c.d.e` と深さ 6 の葉を採り、深さ 7 は採らない / 配列の葉のパスが `steps.list.body.items.0.id`、20 番目の要素(`items.19`)を採り、21 番目(`items.20`)を採らない / 1 応答の 200 個目の葉を採り、201 個目を採らない / spec の値と同じ葉を除く / 候補が 256 個になる入力で、落ちたのが最も古い応答の名前不一致の葉 / 任意のパラメータにだけ `omit` があり末尾 / 必須の path パラメータと必須の本文の候補が 0 個で `{ ok: false, missing: ["id", "body"] }`(配列で返し、結合しない)/ 候補 1 個の対象が質問に入らず、`readPicks` の `values` に `confidence: null` で入る / 全対象が候補 1 個以下なら `request: null` / 本文の候補が `inputs` の `{"a":1}` と `[1,2]` を採り、`"x"` と壊れた JSON を採らない / オブジェクトの spec 値が `form` + `explode: true` の query では候補に入り、path では入らない / 質問のキーが `p1`、`p2`、`body` で、instructions が `state.operation.targets["p2"]` を含む / 選択肢のキーが `c1..` と `omit` / 選択肢の説明が `input "token"` の形で、`inputs.token` の値の文字列が質問全体を `JSON.stringify` した文字列に無い / spec の値の説明が `spec example[0]: ` で始まり 40 文字で切られ `…` で終わる / 予算を超える入力で葉値が候補の多い対象から落ち、葉値が尽きても超えると `{ ok: false, kind: "budget_exceeded" }` で例外を投げない / `buildTargets` の `notes` が `["style_unsupported", "body_unsupported"]` の配列 / `readPicks` の `picks` のキーが `Target.key` で、値の `Pick` が `target`・`candidate`・`confidence` を持つ。**G3**: 3.0 由来の `required` の無い path パラメータ(T2 で `required: true`)に `omit` が候補として現れない。**設計書 §17-1 の確認**: SDK 0.6.0 の choice が選択肢 1 個を受け付けるかを型定義と実装で確かめ、結果を §10 実施記録へ書く。受け付けても本計画の扱い(候補 1 個は問わない)は変えない |
| コミット | `feat(jevriel): 値埋めの候補生成と質問の組み立てを追加する` |

### T4: 実値の組み立てと認証

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/fill.ts`、`src/api/__test__/fill.test.ts` |
| 要点 | 設計書 §8-6(URL の結合と `new URL` を使わないこと、`{…}` が残れば `skip`、直列化の表、`content` パラメータは JSON 文字列、オブジェクトを style 系のパラメータへ `JSON.stringify` しないこと、本文の `content-type`、認証の後に `headers` 引数を大小文字を無視して重ねること、`inputHeaderNames` に入れる名前)、§5-1(`headers` 引数の名前はすべて伏字の対象、値のプレースホルダ解決と未解決の `skip`)、§9-2(OR と AND、満たせる最初の要素だけ、`{}` の要素、null は付けない、付け方の表、apiKey の query が同名のパラメータを置き換える)、`isDocumented`(§8-6 の最後)。scheme の分類とトップレベルの `security` の継承は T2 で済んでおり、このタスクは T2 が解決した `Operation.security` と `LoadedSpec.schemes` だけを見る。T3 の `readPicks` の結果(`Pick` の Map)を受けて実値を組み立てる |
| インターフェース | consumes: T3 の `Candidate`・`Target`・`Pick`、T2 の `Operation`・`OperationParam`・`SecurityScheme`・`LoadedSpec`、T1 の `resolvePlaceholders`、初版 T6 の `ApiRequest`・`ApiResponse`。produces: `serializeParam(param: OperationParam, value: unknown): { ok: true; pairs: Array<[string, string]> } \| { ok: true; text: string } \| { ok: false }`(query は `pairs`、path と header は `text`。対応外の組は `ok: false`)、`selectSecurity(security: string[][] \| null, schemes: Record<string, SecurityScheme>, inputs: Record<string, string>): string[] \| null`(選んだ要素の scheme 名。`{}` が選ばれたら `[]`、満たせなければ null)、`applyAuth(schemeNames: string[], schemes: Record<string, SecurityScheme>, inputs: Record<string, string>): { headers: Record<string, string>; query: Record<string, string> }`、`assembleRequest(args: { op: Operation; baseUrl: string; targets: Target[]; picks: Map<string, Pick>; inputs: Record<string, string>; steps: Record<string, ApiResponse>; schemes: Record<string, SecurityScheme>; headers: Record<string, string> }): { ok: true; request: ApiRequest; inputHeaderNames: Set<string>; inputPathSegments: number[] } \| { ok: false; skip: string }`(`inputPathSegments` は `source: "input"` の候補を置いた path パラメータの要素の、最終の URL の pathname での添字。§4 の共有契約)、`isDocumented(responses: readonly string[], status: number): boolean` |
| 担当 | 複雑または重要な実装(送信先の URL・認証・伏字が絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build(`dist/` に差分が無い)。テストケース(**api/fill.test.ts** に追加)— 設計書 §15-2 の `api/fill.test.ts` の行のうち、直列化・style・本文・`headers`・`skip`・認証・`inputHeaderNames`・`isDocumented` の項目を 1 項目 1 ケース以上で書く。加えて次を assert する: path の値 `a/b c` が `a%2Fb%20c` / path の配列 `["a/b","c"]` が `a%2Fb,c` / query の配列が `tag=a&tag=b`、`explode: false` で `tag=a,b` / `form` + `explode: true` のオブジェクト `{ "x": 1, "y": "z" }` が `x=1&y=z` / header の配列が `a,b` / `content` パラメータのオブジェクトが JSON 文字列 / style 系のパラメータに `{"a":1}` の文字列が現れない / 本文に `content-type: application/json` / `inputs` の本文候補が `JSON.parse` した値で送られる / `{id}` が残ると `{ ok: false, skip: "unresolved: {id}" }` / `headers` の値の `{{steps.x.body.t}}` が未解決なら `skip`、解決すれば値が入る / bearer・basic(`user:pass` → `dXNlcjpwYXNz`)・apiKey header・apiKey query(同名の query パラメータの値を置き換える)/ 解決済みの `[["a"], ["b", "c"]]` で `inputs` に `b` と `c` があれば `b` と `c` を付けて `a` を付けない / `b` だけあれば 2 番目を満たせず、`a` も無ければ何も付けない / `[[], ["a"]]` で `a` があっても何も付けない(先頭の空の要素が選ばれ、`selectSecurity` が `[]` を返す)/ `selectSecurity` に `[]` を渡すと `null`、`null` を渡すと `null` で、どちらも何も付けない / `unsupported`(oauth2)の scheme だけの要素は満たせない(`selectSecurity` のテストは解決済みの配列と `schemes` を直接渡して書き、継承は試さない)/ 付けたヘッダ名、`inputs` から値を置いたヘッダパラメータの名前、`headers` 引数の全ての名前(値が固定文字列でも)が小文字で `inputHeaderNames` にある / `baseUrl` が `http://h/api/v1`、path が `/users/{id}/posts/{pid}` で `id` に `inputs` の候補、`pid` に spec の値を置くと `inputPathSegments` が `[4]` で、`pid` の添字を含まない / `inputs` を path に置かないと `[]` / `isDocumented` が `200` の完全一致、`2XX` と `2xx`、`default` で true、`404` だけの responses に 500 で false。**G2**: `baseUrl` が `http://localhost:3000/api/v1` と `http://localhost:3000/api/v1/` のどちらでも、path `/users/{id}` から `http://localhost:3000/api/v1/users/7` になる。**G4**: `headers: { authorization: "Bearer manual" }` と `inputs` の bearer の scheme 名がある組で、`request.headers` の Authorization が大小文字を問わず 1 つだけで値が `Bearer manual` |
| コミット | `feat(jevriel): 値埋めの実値の組み立てと認証の付与を追加する` |

### T5: `specSource` と `api_run_goal` の spec 経路

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/api/fill.ts`(`specSource` の追加)、`src/tools/api.ts`、`src/api/__test__/fill.test.ts`、`src/tools/__test__/api.test.ts`、`src/fixtures/jev/`(値埋めの応答)、`dist/server.mjs` |
| 要点 | 設計書 §5-1(zod の差分: `requests` を省略可、`spec`・`include`・`headers` を追加、`baseUrl` は必須のまま)、§5-2(排他条件と検証の表、`inputs` のキー数は `baseUrl` の検証と同時に開始前に数える、spec の取得失敗と 3xx は `request_failed`、いずれも証跡なし)、§5-3(`state.operations` は `RequestSource.list` をそのまま入れる)、§5-5 の spec 版、§5-6(`values` は常に入れる、`RunRecord.spec` と `sanitizeUrl`)、§10-1・§10-2(送信先と `allowedHosts` と `name` の既定は `baseUrl` 由来で、spec の `servers` を使わない)、§10-3(開始前の予算: `chooseDropSummary` で `summary` を落とすかを決め、`ok: false` なら開始前の `budget_exceeded`)。`specSource` の `build` の流れ: 操作を名前で引く → `buildTargets`(`missing` なら `stuck: "missing_input"`、note は名前のカンマ区切り)→ `planFill`(`budget_exceeded` はそのまま返す)→ `request` があれば `jev(request, { timeout: 30_000 })` → `readPicks` → `assembleRequest`(`skip` はそのまま返す)→ `ok: true` に `values`・`notes` を `", "` で結合した `note`(`notes` が空なら `note` を付けない)・`isDocumented` を束ねて返す。`missing_input` の `note` も `missing` を `", "` で結合する。`list` は各操作を `{ method, path, summary, requiredParams, body }` にする(`body` は `json: true` なら `"json"`、`json: false` なら `"unsupported"`、本文なしなら `"none"`)。ハンドラの順番: キー確認 → 排他条件 → `validateThresholds` と `baseUrl` の検証と `inputs` のキー数(`INPUT_KEYS_LIMIT`)の検査を同じ段で行う(`loadSpec` ではなくハンドラが行う)→ `loadSpec` → `listOperations(..., RUN_LIMIT)` → `chooseDropSummary` → 初版計画 §4 の「記録を返す 4 ツールの処理の順番」の 2.〜4.。`RunRecord.spec` はハンドラが `runApiGoal` の戻りに足す。開始前の失敗のうち操作の件数(0 件・253 件超過)と予算(`budget_exceeded`)による `invalid_input` / `budget_exceeded` の message には、操作数と `include` の絞り方の案内を含める(設計書 §5-2・§7-4・§10-3) |
| インターフェース | consumes: T1 の `RequestSource`・`BuildResult`・`ApiGoalInput`・`runApiGoal`・`chooseDropSummary`・`templateSource`、T2 の `loadSpec`・`listOperations`・`RUN_LIMIT`・`Include`・`LoadedSpec`・`Operation`、T3 の `buildTargets`・`planFill`・`readPicks`・`INPUT_KEYS_LIMIT`、T4 の `assembleRequest`・`isDocumented`、初版 T2 の `hasApiKey`・`validateThresholds`・`errorResponse`・`toResponse`・`ToolDeps`、初版 T5 の `normalizeName`・`captureFlags`・`createRunDir`・`recordingJev`・`finalizeEvidence`、初版 T6 の `sanitizeUrl`・`defaultAllowedHosts`・`sendRequest`。produces(fill.ts): `specSource(args: { spec: LoadedSpec; operations: Operation[]; headers: Record<string, string> }): RequestSource`。produces(tools/api.ts): `includeSchema`(zod。設計書 §5-1 のとおり。T6 が使う)、`apiRunGoalInput`(設計書 §5-1 の差分を入れたもの)、`handleApiRunGoal(args, deps: ToolDeps): Promise<ToolResponse>`(シグネチャは初版のまま) |
| 担当 | 複雑または重要な実装(ツールの入力契約・秘密の扱い・証跡が絡む) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build(`dist/server.mjs` に差分があり、`yaml` が含まれる)。テストケース(**api/fill.test.ts** に追加、フェイクの Jev)— `specSource` の `list` の `body` が `"json"` / `"unsupported"` / `"none"`、`requiredParams` が必須パラメータの名前 / 候補 2 個以上の対象があるとき Jev を 1 回だけ `timeout: 30000` で呼ぶ / 無いとき呼ばない / 必須の候補 0 個で `stuck` と note `"id, body"` / 予算超過で `kind: "budget_exceeded"` / `values` がパラメータの無い操作で `[]` / `note` が `"style_unsupported, body_unsupported"`、`notes` が空なら `note` が無い。(**tools/api.test.ts** に追加)— 設計書 §15-2 の `tools/api.test.ts` の行のうち `api_list_operations` 以外の全項目を 1 項目 1 ケース以上で書く。加えて次を assert する: `spec` と `requests` の両方、両方なし、`requests` と `include`、`requests` と `headers` のそれぞれで `invalid_input` かつ証跡ディレクトリが無く Jev もフェイク API も呼ばれない / `spec` で `baseUrl` を省くと zod で拒否される / `inputs` 254 キーで `invalid_input` になり、spec の取得(`deps.httpFetch` と spec ファイルの読み込み)が行われない。253 キーで通る / 絞り込みで 0 件、254 件、操作一覧の予算超過のそれぞれで、エラーの message に操作数と `include` の案内が含まれる / spec の URL の 302 と接続失敗で `request_failed` かつ証跡なし / 操作選択の state に `operations` があり、各要素が `method`・`path`・`summary`・`requiredParams`・`body` / 予算を超える操作一覧で state から `summary` が消え、さらに超えると isError の `budget_exceeded` で証跡なし / spec の `servers` が `https://evil.example` でも送信先が `baseUrl` のホストで、`allowedHosts` の既定と `name` の既定が `baseUrl` のホスト / `result.json` の `steps[].values` の各要素が `target`・`in`・`source`・`ref`・`confidence` を持ち、読み戻すとツール出力と一致 / `RunRecord.spec` が `source`・`openapi`・`operations` を持つ / **初版 F4 の拡張**: `inputs` の値(`s3cret-value`)、bearer の値、`headers` 引数の値が、全 Jev 呼び出しの state と questions を `JSON.stringify` した文字列と、`result.json` と `log.json` の全文に現れない(`inputs` の値を query・header・本文・認証・path のそれぞれに置く入力で確かめる。path は §7 の #1 の伏字による)/ path に置いた `inputs` の値が、フェイク API が受け取った URL には生のまま入る / spec の `example` の値(`"example-marker-42"`)が値埋めの Jev への質問に含まれる / 応答のステータスが responses に無いとき `steps[n].undocumented` が true。**G5**: `spec` の URL のクエリの値 `abc` が `RunRecord.spec.source`・`result.json`・404 のときのエラー応答に無い |
| コミット | `feat(jevriel): api_run_goal に OpenAPI 文書からの値埋めを追加する` |

### T6: `api_list_operations`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/tools/api.ts`、`src/tools/__test__/api.test.ts`、`dist/server.mjs` |
| 要点 | 設計書 §6(入力、出力の形、`type` の文字列化、`security` は `string[][] \| null`(null は宣言なし、`[]` は認証なし)、`servers` は情報、`supported` と `unsupportedReason`、`suggestedInputs` の 2 規則と初出順(本文キーは操作名を 59 文字で切ってから `_body` を付ける。64 文字を超えるパラメータ名は入れず、出力の `note` に理由と名前を `", "` 区切りで残す)、エラーは `invalid_input` と `request_failed` だけ、0 件は空の一覧、キー確認をしない、証跡を残さない)、§7-4(`listOperations(..., LIST_LIMIT)`)、§10-1。`loadSpec` の `timeoutMs` は 30,000ms。ツールの description は英語で、`api_run_goal` の前に操作と必要な `inputs` を確かめる用途を書く |
| インターフェース | consumes: T2 の `loadSpec`・`listOperations`・`LIST_LIMIT`・`Operation`、T5 の `includeSchema`、初版 T6 の `registerApiTools`、初版 T2 の `toResponse`・`errorResponse`・`ToolDeps`。produces: `apiListOperationsInput`、`handleApiListOperations(args, deps: ToolDeps): Promise<ToolResponse>`、`suggestInputs(operations: Operation[]): { keys: string[]; note: string \| null }`。`registerApiTools` が `api_check`・`api_run_goal`・`api_list_operations` の 3 ツールを登録する状態になる |
| 担当 | 通常の実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build(`dist/server.mjs` に差分がある)。テストケース(**tools/api.test.ts** に追加)— `TYPESAFE_API_KEY` が無くても成功し、fakeFetch(Jev)が呼ばれず、`.jevriel/` が作られない / `sample-3.1.json` で `count` と `operations` の件数が一致し、各操作が `name`・`method`・`path`・`summary`・`tags`・`parameters`(`style` を含む)・`body`・`security`・`servers`・`supported` を持つ / `deepObject` の必須パラメータを持つ操作が `supported: false` と `unsupportedReason: "style_unsupported"` で載る / `suggestedInputs` が例も `default` も `enum` も無い必須パラメータの名前と `<操作名>_body` を初出順・重複なしで返し、例を持つ必須パラメータを含まない / 64 文字の操作名を持つ操作の本文キーが操作名の先頭 59 文字 + `_body` の 64 文字 / 65 文字のパラメータ名 2 つが `suggestedInputs` に無く、`note` に 2 つの名前が `", "` 区切りで並ぶ / 該当が無ければ出力に `note` が無い / 返した `suggestedInputs` のキーがすべて `apiRunGoalInput` の `inputs` のキーの制約(1〜64 文字)を zod で通る / `security` が、宣言の無い文書で null、操作の `security: []` で `[]` / 絞り込みで 0 件なら `count: 0` の成功 / 256 件で `invalid_input` / spec の URL の 302 で `request_failed` / 出力に `baseUrl` のキーが無い |
| コミット | `feat(jevriel): api_list_operations を追加する` |

### T7: スキル `judging` の追記

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/jevriel/skills/judging/SKILL.md` |
| 要点 | 設計書 §11(3 節の差分と「外部送信」節への追記、`allowed-tools` に `mcp__jevriel__api_list_operations` を足して 11 ツール、description は変えない)。本文に書く流れ: `api_list_operations` で件数・`suggestedInputs`・`supported` を見る → `name` と `inputs`(scheme 名と同じキーで認証、本文は JSON 文字列)を用意する → `include` で絞る → `baseUrl` を渡して `api_run_goal`。DELETE は既定で列挙されず `include.methods` で明示すること、POST / PUT / PATCH も状態を変えうること、`missing_input` なら入力を足して呼び直すこと、spec の例の値は Jev へ送られるので秘密を含む spec を渡さないこと。ツール名は開始時に build した `dist/server.mjs` の `tools/list` で確かめてから書く |
| インターフェース | consumes: T5・T6 が登録した 11 ツールの名前と入力。produces: なし |
| 担当 | 通常の実装 |
| スキル | `prompt-smith:prompt-smith`(本文の規律) |
| 検証 | `allowed-tools` の 11 個が `tools/list` の名前と一致する。本文に `api_list_operations`・`suggestedInputs`・`include.methods`・`missing_input` が現れる。description の差分が無い(`git diff` で frontmatter の `description` 行が変わっていない)。`grep -ni -e codiel -e metatron -e sandalphon -e raphael -e prompt-smith -e agent-policy plugins/jevriel/skills/judging/SKILL.md` が 0 件 |
| コミット | `docs(jevriel): スキル judging に OpenAPI 連携の使い方を追記する` |

### T8: README・ルート README・バージョン

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/jevriel/README.md`、`plugins/jevriel/docs/rationale.md`、ルート `README.md`、`plugins/jevriel/.claude-plugin/plugin.json`、`plugins/jevriel/package.json`、`src/server.ts`(`McpServer` の `version` だけ)、`dist/server.mjs` |
| 要点 | 設計書 §12(4 章の差分、新節「OpenAPI からの動作確認」と認証の小節、7・8・9 章の差分)、§13 の不採用案を `docs/rationale.md` に要約、§4(ルート README の jevriel の節にツール数 11 と OpenAPI 連携)、バージョンを 3 箇所とも `0.2.0-dev`(§1 の全体の制約) |
| インターフェース | consumes: T5・T6 のツール名と入力、T7 のスキルの記述。produces: なし |
| 担当 | 軽量な実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build(`dist/server.mjs` の差分は version の文字列だけ)。`grep -n "Codiel" plugins/jevriel/README.md` の該当が「Codiel との併用」節の中だけ。README に `api_list_operations`・`spec`・`include.methods`・`baseUrl`・`headers`・`suggestedInputs`・`missing_input` が現れる。README の「7. 制約」に、YAML のマージキー(`<<:`)は非対応で展開しない(`yaml` の `merge` を既定の false のまま使う)ことが書かれている。`grep -n "0.2.0-dev" plugins/jevriel/.claude-plugin/plugin.json plugins/jevriel/package.json plugins/jevriel/src/server.ts` が 3 件を返す |
| コミット | `docs(jevriel): OpenAPI 連携を README に追記し 0.2.0-dev に上げる` |

### T9: ARCHITECTURE の確認と Serena メモリ(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 対象 | `harness-docs/ARCHITECTURE.md`(変更が要るときだけ、metatron の CLI 経由)、`.serena/memories/jevriel/core.md` |
| 要点 | ADR は起票しない(初版の ADR の範囲内)。ARCHITECTURE のシステム概要・技術スタック・ディレクトリ構成・依存方向に、本拡張で食い違う記述があるかを確かめる(`yaml` はプラグイン固有の実行時依存で、技術スタックの共通の開発依存には入らない想定)。食い違いがあれば `metatron:updating-architecture` を起動してから反映する。Serena メモリは `edit_memory` で、ツール数を 11 にし、`api_list_operations` と `spec` 経路の要点(`baseUrl` は必須で `servers` を使わない、既定メソッド、`RequestSource`)を足す |
| インターフェース | consumes: T1〜T8 の成果物。produces: なし |
| 担当 | オーケストレーター |
| スキル | 変更が要るときだけ `metatron:updating-architecture` |
| 検証 | ARCHITECTURE を変えなかったときは、その判断と理由を §10 に記録する。`.serena/memories/jevriel/core.md` に `api_list_operations` がある |
| コミット | Serena メモリは `docs: Serena メモリを jevriel 0.2.0-dev に追随させる`。ARCHITECTURE を変えたときは `commit-architecture` の規定に従う |

### T10: 統合検証(オーケストレーター)

次を順に実行し、出力を記録する。

1. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test`。テスト件数の増分が T1〜T6 で足したテストの数と一致する。
2. `pnpm --filter jevriel-scripts build` の後、`git status --short plugins/jevriel/dist` に差分が無い。
3. `grep -c "yaml@" plugins/jevriel/dist/server.mjs` が 1 以上(`yaml` が含まれる)。`grep -c -e "playwright-core@" -e "/playwright@" plugins/jevriel/dist/server.mjs` が 0(Playwright が含まれない)。注記の形が違って判定できないときは、その事実と代わりに使った判定を記録する(初版計画 T14 の 3 と同じ扱い)。
4. `TYPESAFE_API_KEY` を外した環境で `dist/server.mjs` を起動し、`tools/list` が 11 ツールを返す。`api_list_operations` に `src/fixtures/openapi/sample-3.1.json` の絶対パスを渡し(`CLAUDE_PROJECT_DIR` を `plugins/jevriel` にして起動する)、一覧が返る。`api_run_goal` が `not_configured` を返す(設計書 §16)。
5. 実キーがあれば、手元で起動したモックサーバー(`sample-3.1.json` の操作を返す最小の HTTP サーバー。検証用に一時ディレクトリへ置き、コミットしない)に対して、`spec` を渡した `api_run_goal` を `evidence: "always"` で 1 回完走させ、`result.json` の `steps[].values` に値そのものが無いことを確かめる。無ければ省略と記録する。
6. `grep -rni -e codiel -e metatron -e sandalphon -e raphael -e agent-policy -e prompt-smith plugins/jevriel/src plugins/jevriel/skills` が 0 件。

### T11: コードレビュー(並列、読み取りのみ)

| ID | 内容 | 担当 |
| --- | --- | --- |
| T11a | T1 の差分。必ず見る点: (1) 既存テストへの変更が T1 の要点の「許可する差分」(1)〜(4)(`description` → `summary`、`requiredParams` と `body` の追加、テスト入力の `source` と `dropSummary: false`、`log.json` 内の state のその差分)だけで、`RunRecord` と `result.json` の期待値は path の伏字の例外を除いて変わっていない (2) テンプレート経路で `dropSummary` が常に false (3) `BuildResult` の `budget_exceeded` の `RunRecord` が、共有ループの既存の予算超過の分岐と同じ値(`reason: "budget_exceeded"`・`error.kind: "budget_exceeded"`・T0 で記録した `error.errorClass`) (4) `RecentResponse` の更新規則 (5) 契約の凍結の例外と path の伏字による証跡の変更が報告されている | コードレビュー |
| T11b | T2〜T6 の差分。必ず見る点: (1) `inputs` の値が Jev への state と質問、`values`、`log.json` に入らない (2) spec の `servers` が送信先と `allowedHosts` に使われていない (3) spec の読み込みで `redirect: "manual"`、5MB の打ち切り、`projectDir` 配下の検査、解析失敗の message にソース断片が無い (4) オブジェクトを style 系のパラメータへ `JSON.stringify` していない (5) `headers` 引数の全ての名前が伏字の対象 (6) §1 のレビューの焦点 G1〜G5 のテストがある | コードレビュー |
| T11c | T7・T8 の差分。必ず見る点: (1) 他プラグイン名が README の「Codiel との併用」節の外に無い (2) SKILL.md の `allowed-tools` が実際の 11 ツール名と一致する (3) README のツール一覧と引数が実装と一致する (4) spec の例の値が Jev へ送られる注意が README とスキルの両方にある | コードレビュー |

依頼文に「ファイルを変更しない」「報告のみを返す」「使用してよい tools を読み取り系に限定する」を明記する。

### T12: 最終突き合わせ(オーケストレーター)

全差分を分割せず一度に読み、設計書と突き合わせる。特に次を確かめる。

1. 11 ツールの名前と、`api_run_goal`・`api_list_operations` の入力スキーマが設計書 §5-1・§6 と一致する。
2. `RunRecord`・`ApiStep`・`ApiStepValue` が設計書 §5-6 と一致し、`result.json` が同じ構造である。
3. 設計書 §15 の表の全行が、下の対応表のどれかのテストで確かめられている。

   | 設計書 §15 の項目 | 確かめるタスクとテストファイル |
   | --- | --- |
   | §15-1 固定データ(`sample-3.1.json`・`sample-3.1.yaml`・`minimal-3.0.json`) | T2 `src/fixtures/openapi/` |
   | §15-1 異常系はテストの中で書き換えて作る | T2 `api/__test__/openapi.test.ts` |
   | `api/openapi.test.ts` の行 | T2 `api/__test__/openapi.test.ts` |
   | `api/fill.test.ts` の行のうち候補・葉値・`omit`・`missing_input`・候補 1 個・本文の候補・選択肢の説明・予算 | T3 `api/__test__/fill.test.ts` |
   | `api/fill.test.ts` の行のうち直列化・style・本文・`headers`・`skip`・認証・`inputHeaderNames`・`isDocumented` | T4 `api/__test__/fill.test.ts` |
   | `api/loop.test.ts`(追加)の行 | T1 `api/__test__/loop.test.ts`(フェイクの `RequestSource`)。spec 版を通した確認は T5 `api/__test__/fill.test.ts` と `tools/__test__/api.test.ts` |
   | `api/template.test.ts`(追加)の行 | T1 `api/__test__/template.test.ts` |
   | `tools/api.test.ts`(追加)の行のうち `api_run_goal` の項目 | T5 `tools/__test__/api.test.ts` |
   | `tools/api.test.ts`(追加)の行のうち `api_list_operations` の項目 | T6 `tools/__test__/api.test.ts` |

4. 設計書 §16 の Done 条件の各項目に、T10 の記録か該当コミットがある。
5. §1 のレビューの焦点 G1〜G5 のテストが、指定したタスクのテストファイルにある。

食い違いは §7 に記録し、該当タスクをやり直す。

## 3. 依存関係

```
T0 ─ T1 ─ T2 ─ T3 ─ T4 ─ T5 ─ T6 ─ T7 ─ T8 ─ T9 ─ T10 ─┬─ T11a ─┬─ T12
                                                       ├─ T11b ─┤
                                                       └─ T11c ─┘
```

- T1 を最初に置く。ループの注入点が固まってから spec 版を書けば、T5 は接続だけで済み、ループの状態遷移を 2 度触らずに済む。T1 を独立のコミットにすると、振る舞いの不変を差分だけで確かめられる。
- T2 は T1 と独立だが、直列にする。`pnpm-lock.yaml` と `package.json` の変更を、リファクタのコミットと混ぜないためである。
- T3 と T4 は同じ `fill.ts` を触るので直列にする。T3 は外部へ送る値の選別、T4 は送信先と秘密の組み立てで、レビューの観点が違うため 2 つに分ける。
- T5 は T1〜T4 の全てを使う。`server.ts` の到達グラフが変わるのはここからである。
- T6 は T5 の `includeSchema` を使う。
- T7 は T6 のコミットの後に始め、11 ツールがそろった `dist/server.mjs` の `tools/list` でツール名を確かめる。
- T8 は T7 の後に置く。README がスキルの記述とツールの最終形を参照する。
- T9 は T8 の後に置く。メモリと ARCHITECTURE の確認は最終の構成で行う。

## 4. タスク間で共有する契約

依頼文へ転記し、担当が推測で決めないようにする。型は設計書 §5-5・§5-6・§7-1 から写したものである。

```ts
// src/api/loop.ts(T1)
type RecentResponse = { name: string; response: ApiResponse }
// 新しい順の配列。追加時に同じ名前の要素を除いてから先頭へ入れ、6 件目以降を捨てる(最大 5 件)

type RequestSource = {
  stateKey: "requests" | "operations"
  list: Record<string, {
    method: string; path: string; summary?: string
    requiredParams: string[]
    body: "none" | "json" | "unsupported"
  }>
  build(
    name: string,
    ctx: { goal: string; step: number; baseUrl: string; inputs: Record<string, string>
           steps: Record<string, ApiResponse>; recent: RecentResponse[]; history: unknown[]
           dropSummary: boolean },
    jev: JevCall
  ): Promise<BuildResult>
}

type BuildResult =
  | { ok: true; request: ApiRequest; inputHeaderNames: Set<string>
      inputPathSegments: number[]   // request.url の pathname を "/" で分けた配列のうち、inputs の値を含む要素の添字
      values?: ApiStepValue[]; note?: string; isDocumented?: (status: number) => boolean }
  | { ok: false; skip: string }
  | { ok: false; stuck: "missing_input"; note: string }
  | { ok: false; kind: "budget_exceeded"; message: string }

// 証跡と state に入れる URL は redactPathSegments(url, inputPathSegments) を通してから sanitizeUrl を通す。送信する URL は生のまま

// src/evidence.ts(T1)
type ApiStepValue = {
  target: string
  in: "path" | "query" | "header" | "body"
  source: "input" | "spec" | "response" | "omit"
  ref: string | null
  confidence: number | null
}

// src/api/openapi.ts(T2)
type OperationParam = {
  name: string; in: "path" | "query" | "header"
  required: boolean
  style: string
  explode: boolean
  content: boolean
  supported: boolean
  types: string[] | null
  enum: unknown[] | null; default?: unknown
  examples: unknown[]
  description: string | null
}
type OperationBody = {
  required: boolean; contentTypes: string[]
  json: boolean
  examples: unknown[]
  description: string | null
}
type Operation = {
  name: string; operationId: string | null
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
  path: string; summary: string | null; description: string | null; tags: string[]
  parameters: OperationParam[]; body: OperationBody | null
  responses: string[]
  security: string[][] | null
  servers: string[]
  supported: boolean
}
type SecurityScheme =
  | { name: string; type: "apiKey"; in: "header" | "query"; paramName: string }
  | { name: string; type: "http"; scheme: "bearer" | "basic" }
  | { name: string; type: "unsupported" }
type LoadedSpec = {
  doc: Record<string, unknown>
  source: { kind: "file" | "url"; location: string }
  openapi: string
  schemes: Record<string, SecurityScheme>
}
```

**ファイルの持ち主**

| ファイル | 変えるタスク |
| --- | --- |
| `src/api/loop.ts` | T1 |
| `src/api/template.ts` | T1 |
| `src/evidence.ts` | T1(型の追加だけ) |
| `src/api/openapi.ts` | T2 |
| `src/api/fill.ts` | T3、T4、T5(`specSource` の追加だけ) |
| `src/tools/api.ts` | T1(`templateSource` を渡す箇所だけ)、T5、T6 |
| `src/server.ts` | T8(version の文字列だけ) |
| `plugins/jevriel/package.json` | T2(`yaml` の追加)、T8(version) |
| `skills/judging/SKILL.md` | T7 |
| `README.md`・`docs/rationale.md`・ルート `README.md`・`plugin.json` | T8 |

**Jev 呼び出しのタイムアウト**

値埋めの Jev 呼び出しは、ループの中の呼び出しとして `jev(req, { timeout: 30_000 })` とする(初版計画 §4 と同じ)。`api_list_operations` は Jev を呼ばない。

**ツールハンドラの形**

初版計画 §4 のとおり。`api_list_operations` は `apiListOperationsInput` と `handleApiListOperations(args, deps)` を export し、`registerApiTools` が登録する。記録を返さないので、初版計画 §4 の「記録を返す 4 ツールの処理の順番」は使わない。

## 5. コミット

| # | タスク | メッセージ |
| --- | --- | --- |
| 1 | T1 | `refactor(jevriel): api_run_goal のリクエスト源を RequestSource へ切り出す` |
| 2 | T2 | `feat(jevriel): OpenAPI 文書の読み込みと操作の列挙を追加する` |
| 3 | T3 | `feat(jevriel): 値埋めの候補生成と質問の組み立てを追加する` |
| 4 | T4 | `feat(jevriel): 値埋めの実値の組み立てと認証の付与を追加する` |
| 5 | T5 | `feat(jevriel): api_run_goal に OpenAPI 文書からの値埋めを追加する` |
| 6 | T6 | `feat(jevriel): api_list_operations を追加する` |
| 7 | T7 | `docs(jevriel): スキル judging に OpenAPI 連携の使い方を追記する` |
| 8 | T8 | `docs(jevriel): OpenAPI 連携を README に追記し 0.2.0-dev に上げる` |
| 9 | T9 | `docs: Serena メモリを jevriel 0.2.0-dev に追随させる`(ARCHITECTURE を変えたときは `commit-architecture` の規定に従う) |

- すべてのメッセージの末尾に、セッションの指示にある Co-Authored-By の行を付ける。
- 本計画書は、ユーザー承認の後にコミット 1 の前で別にコミットする(`docs(jevriel): OpenAPI 連携の実装計画書を追加する`)。
- 各コミットの時点で lint / typecheck / test が通り、`server.ts` の到達グラフを変えたコミット(1、5、6、8)に `dist/server.mjs` の差分が含まれる。コミットの前に `git status --short` を見て、本件と無関係なファイルを含めない。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| 初版の実装の export 名や `ApiGoalInput` の実際の形が初版計画と違う | T0 で export 名を一覧にして突き合わせる。違いは §7 に記録し、本計画の consumes を実名へ直してから T1 に入る |
| T1 の担当が「振る舞い不変」を満たすために state 以外の期待値まで書き換える | T1 の検証に「更新した箇所を報告に列挙する」を入れた。T11a の (1) で差分を確かめる |
| `yaml` の `parse` が警告を `console.warn` で出し、MCP の stdout を汚す | `console.warn` は stderr へ出るので stdout は汚れない。T10 の 4 で `tools/list` の応答の前後に余計な行が無いことを確かめる |
| URL の spec 取得のストリーム読みが、テストのフェイクの `fetch` と実際の `fetch` で振る舞いが違う | T2 のテストは `Response` に `ReadableStream` の本文を持たせたフェイクで書く。T10 の 5 でモックサーバーから実際に取得する |
| 値埋めの instructions の英文が、試走で選択の精度が出ない | 初期値のまま実装し、調整は設計書 §8-4 のとおり契約を変えずに行う。実キーが無い間は T10 の 5 を保留とする |
| path の伏字で添字がずれ、別の要素を伏せて秘密の要素を残す | 添字は最終の URL の pathname で数える、と §4 に固定した。T1・T4 の検証で `baseUrl` がパスを持つ場合を確かめ、T5 で証跡の全文に値が無いことを確かめる |

## 7. 設計書との食い違い

計画立案時に検出した事項。実装中に見つけた食い違いも、この表へ追記する。

| # | 検出タスク | 設計書の記述 | 計画での扱い | 判断 |
| --- | --- | --- | --- | --- |
| 1 | 計画 | §15-2 の `tools/api.test.ts` は「`inputs`・認証・`headers` 引数の値が … `result.json` に現れない」とする。一方、§8-2 の候補には `inputs` の全キーが並び、path パラメータに `inputs` の値が置かれうる。`sanitizeUrl`(初版設計書 §9-3)は userinfo とクエリ値だけを落とすので、path に置かれた値は `ApiStep.url`(`result.json`)と `log.json` の `request.url` に残る(Jev への state には URL が入らないので、Jev へは送られない) | 伏字にする。`assembleRequest`(spec 経路)と `templateSource.build`(テンプレート経路。`resolvePlaceholders` で要素ごとに調べる)が `inputs` 由来の path の要素の位置を `inputPathSegments` で返し、ループは証跡と state に入れる URL でその要素を `[redacted]` に置き換える。送信する URL は生のまま(T1・T4・T5、§4 の共有契約)。初版のテンプレートで `{{inputs.*}}` を path に書いたときの同じ穴も、この拡張で塞ぐ。設計書 §5-5 の `BuildResult` と §9-3 に反映した | 採用・反映済み |
| 2 | 計画 | §7-2 は YAML を `parseYaml` で読むとだけ書き、マージキー(`<<:`)の扱いを書いていない。`yaml` の既定(YAML 1.2 の core スキーマ)はマージキーを展開しないため、`<<:` を使う文書では該当箇所が `"<<"` というキーとして読まれ、パラメータなどが静かに欠ける | 既定のまま実装する(オプションを足さない)。README の OpenAPI の節に「マージキーは非対応」と書く(設計書 §12、T8) | 採用・非対応と明記 |
| 3 | 計画 | §7-4 の `listOperations` のシグネチャは `limit` だけを受け、「`api_run_goal` では `supported: false` の操作を除く」「一覧では除かずに載せる」を別に書いている | `limit` が `RUN_LIMIT`(253)のときだけ除いてから数える、とした(T2 の要点)。シグネチャは設計書のまま | 計画で決定 |
| 4 | 計画 | §5-4 は `budget_exceeded` を初版設計書 §8-4 の 5. の適用とするが、`error.errorClass` の値は初版設計書にも本設計書にも書かれていない | 根本で揃えた。初版設計書 §8-4 の 5. に `reason: "budget_exceeded"` を足し(初版設計書 §5-1 の「error のときの `reason` は例外のクラス名」に対する唯一の例外)、初版計画 T7・T10 の検証に同じ assert を足した。本拡張は初版と同じ値を使い、`error.errorClass` は T0 で記録した初版の値とする(T0・T1) | 採用・解決済み |
| 5 | 計画 | §10-3 の開始前の予算の確認(`summary` を落とす)は spec の経路だけの話か、テンプレートの経路にも当てるかを書いていない | spec の経路だけに当てる。テンプレートの経路は常に `dropSummary: false` とし、初版の挙動を変えない(T1 の要点) | 計画で決定 |
| 6 | 計画 | 設計書のヘッダの「ステータス」が「レビュー待ち」のままである(承認はコミット `cfe9adb` で取得済み) | 設計書のヘッダを「ユーザー承認済み(2026-09-25)」に直した | 反映済み |
| 7 | 計画(レビュー反映時) | 設計書 §4 はツールの登録を変えないと書くが、`src/server.ts` の `McpServer` の version の扱いを書いていなかった | 設計書 §4 に「登録は変えない。version の文字列だけ `0.2.0-dev` にする」を、§16 の Done にも同じ項目を足した。T8 が行う | 採用・設計書へ反映済み |
| 8 | T1 | T1 の検証欄は `baseUrl` が `http://h/api`、path が `/users/{{inputs.uid}}/posts` の `inputPathSegments` を `[3]` とする。初版の `resolveTemplate` は `new URL(path, baseUrl)` で組むため `/api` が消え、最終の pathname での添字は `[2]` になる | 規則(最終の URL の pathname での添字、`resolveTemplate` の結果は変えない)を優先し、テストの期待値を `[2]` にした。`[3]` のままでは別の要素を伏せ、秘密が証跡に残る | 実装で決定 |
| 9 | T5 | 初版計画 §4 の「記録を返す 4 ツールの処理の順番」は証跡ディレクトリの作成を本体の実行前に置く。初版の `handleApiRunGoal` は実行後に作る | 初版の順番を保った。開始前の失敗で証跡を残さない規則(初版設計書 §5-1、設計書 §5-2)と既存テストに合う。実行中の予算超過は実行後に証跡を確定するので残る | 実装で決定 |
| 10 | T11a | 設計書 §9-3 の path の伏字は添字で要素を指す。`inputs` の値が `.` / `..`(`%2e` を含む)を含むと URL の正規化で経路が畳み込まれ、添字がずれて秘密が証跡に残る。テンプレート経路と spec 経路の両方に当たる | 伏字の位置を確定できない値は送らない。`inputs` 由来の path 要素の値を "/" で分けた片が `.` / `..` になるときは `skip: "unsafe_path: <名前>"` を返す(`hasUnsafeDotSegment`)。設計書 §9-3 に追記した | 採用・設計書へ反映済み |

## 8. 未解決事項と着手の関係

設計書 §17 の未解決事項は、着手を止めない。各項目を確かめるタスクは次のとおり。

| 設計書 §17 | 確かめるタスク |
| --- | --- |
| 1 choice の選択肢数の下限 | T3(SDK 0.6.0 の型定義と実装で確かめる。結果に依らず候補 1 個は問わない) |
| 2 `servers` を既定にする案 | 決定済み(不採用)。確かめることは無く、T5 のテストで `servers` が送信先に使われないことを固定する |

本計画の §7 の #1 と #2 は決定済みで、T1・T4・T5・T8 に反映した。

実キーの有無は着手を止めない。キーが無い間は、T10 の 5 と設計書 §16 の実機確認を保留として記録する。

## 9. Done 条件

設計書 §16 に、本計画書で足した次の項目を加える。

- T0 の baseline と T10 の結果が記録されている。
- 各コミットの時点で lint / typecheck / test が通っている。
- `server.ts` の到達グラフを変えたコミット(1、5、6、8)に `dist/server.mjs` の差分が含まれ、変えないコミット(2〜4)に `dist/` の差分が無い。
- T1 の契約の凍結の例外と、更新した既存テストの期待値の一覧が §10 に記録されている。
- §1 のレビューの焦点 G1〜G5 のテストが、指定したタスクのテストファイルにある。
- T11 の報告と T12 の突き合わせで見つかった食い違いが §7 に記録され、解消されているか判断待ちとして残っている。

## 10. 実施記録

実施日: 2026-09-26。外部ベンダーの委譲先が途中で API の認証エラー(401)になったため、T6 の途中以降は担当表の「Claude モデル」列へ読み替えて委譲した。

### T0 baseline

- 本件と無関係な未コミット変更: `.claude/settings.json`、`CLAUDE.md`、`cliproxyapi.config.example.yaml`、`.raphael/`、`docs/chat/`。触れていない。
- `pnpm run lint` / `typecheck` / `test` / `build` はすべてパス。テストは全体 2475 件(jevriel 192 件)。build の差分なし。
- `plugin.json` と `package.json` の version は `0.1.0-dev`。キー無しの `tools/list` は 10 ツール。
- `yaml@^2.9.0` の最新は 2.9.1(ロックファイルはワークスペースの既存解決により 2.9.0)。
- 初版の export 名は初版計画 T5〜T7 の produces と一致。計画に無い追加として `loop.ts` の `InitialBudgetExceeded` がある。
- 初版の予算超過は `reason: "budget_exceeded"`、`error.errorClass: "InitialBudgetExceeded"`、`error.kind: "budget_exceeded"`。

### T1 契約の凍結の例外と既存テストの変更

- `ApiGoalInput.requests` を `source: RequestSource` に置き換え、`dropSummary` を足した(契約の凍結の例外)。
- path に `{{inputs.*}}` を書いたときは、証跡と state の URL の該当要素が `[redacted]` になる。
- 更新した既存テストの期待値: なし。既存テストの変更は `loop.test.ts` の入力を `source: templateSource(...)` と `dropSummary: false` にしたもの(許可する差分 (3))だけ。
- テンプレート経路の検証例の添字は §7 の #8 のとおり `[2]` にした。

### 設計書 §17-1(choice の選択肢数の下限)

SDK 0.6.0 の `choice` は選択肢 1 個を受け付ける(`index.d.mts` の `ChoiceCriteria` に下限が無く、`index.mjs` の `choice` は配列だけを拒否する)。扱いは変えず、候補 1 個の対象は問わない。

### T9 ARCHITECTURE

変更しない。`yaml` はプラグイン固有のランタイム依存で、「プラグイン固有のランタイム依存はそのプラグインの `package.json` に置く」の範囲に収まる。システム概要・ディレクトリ構成・依存方向・ADR に食い違いは無い。

### T10 統合検証

1. lint / typecheck / test はパス。全体 2593 件(+118)、jevriel 310 件(+118)。レビュー指摘の修正後は jevriel 321 件。
2. build 後の `plugins/jevriel/dist` に差分なし。
3. `dist/server.mjs` の `yaml@` は 144 件、`playwright-core@` と `/playwright@` は 0 件。
4. キー無しで `tools/list` が 11 ツールを返し、`api_list_operations` が `sample-3.1.json` の 4 操作を返し、`api_run_goal` が `not_configured` を返した。stdout に応答以外の行は無い。
5. 保留。`TYPESAFE_API_KEY` が無いため、実キーでの完走と `steps[].values` の確認は未実施。
6. 他プラグイン名の grep は 0 件。

### T11 レビューと T12 突き合わせ

- T11a: critical 1 件(§7 の #10)と low 1 件(件数の単数形)。どちらも採用。
- T11b: 確認点はすべて満たす。medium 1 件(深さ 7 の葉のテストが空振り)と low 1 件(ハンドラの `baseUrl` 検査のテスト欠落)。どちらも採用。
- T11c: 確認点はすべて満たす。low 2 件(README の伏字の説明の欠け)。どちらも採用。
- 修正はコミット `8ab6ebb` にまとめた。
- T12: 入力スキーマ・`RunRecord` の型・コミット単位と `dist` の差分・G1〜G5 のテストを突き合わせ、食い違いは §7 の #8〜#10 だけだった。設計書 §16 の実キーの項目は保留。
