# guidepost 実装計画書(WBS)

- 対象: 新プラグイン `guidepost`(設計書 `plugins/guidepost/DESIGN.md`)
- 目標バージョン: `0.1.0-dev`
- 参照実装: `plugins/pitcrew/`(v0.10.0)— コード共有はせず、パターンをコピーして自己完結させる
- タスク数: 13(T01〜T13。T13 が統合検証)

## 0. 共通規約(全タスク共通の前提)

すべてのタスクで以下を守ること。各タスク詳細では繰り返さない。

- ソースは TypeScript、`plugins/guidepost/src/` 配下。バンドル出力は `plugins/guidepost/scripts/`(git 管理)。
- **Anthropic API・API キー・外部 API クライアント・外部 npm ランタイム依存は一切使わない。** Node 標準モジュールのみ。LLM 処理はスキル(メインセッション)に閉じる。
- テストは実装と同じタスクで書く。配置は実装ファイルの隣の `__test__/`(例: `src/lib/__test__/queue.test.ts`)。`vitest.config.ts` の `include` は `plugins/**/__test__/**/*.test.ts` なのでルートの設定変更は不要。
- ルート `tsconfig.json` の `include` に `plugins/*/src/**/*.ts` と `plugins/*/build.ts` が既に含まれるため、プラグイン個別の tsconfig は作らない。
- コードコメントは日本語。biome の設定(2 スペース / ダブルクォート / セミコロン asNeeded / 行幅 80)に従う。整形は `pnpm lint` で確認。
- hook とサーバーは**フェイルオープン**。例外は握り潰して `logError` に記録し、セッションを絶対に阻害しない。
- 検証コマンドはリポジトリルートから実行する: `pnpm test`(vitest)/ `pnpm typecheck` / `pnpm lint` / `pnpm build`。
- 各タスクの完了条件には「該当テストが green」「typecheck・lint が通る」を暗黙に含む。

### 担当帯の凡例

| 帯 | 目安 |
| --- | --- |
| 複雑(GPT Sol 相当) | アーキテクチャ判断・非自明なトレードオフ・複数コンポーネントの協調 |
| 通常(GPT Terra 相当) | 仕様が確定した実装・ドキュメント・設定 |
| 軽量(GPT Luna 相当) | 定型のコピー・一括適用・軽微な編集 |

## 1. タスク一覧と依存関係

```text
T01 足場 ──┬─ T02 lib 基盤 ──┬─ T03 tour-store ──┬─ T06 http-handler ── T07 serve ── T08 ui.html ─┐
           │                 └─ T04 queue ───────┤                                                 │
           │                                     └─ T05 hooks(2種)+ hooks.json ───────────────────┤
           └─ T09 skill(T03 の tour.json スキーマ確定後)────────────────────────────────────────┤
                                                                                                    │
T10 build.ts 実体化 + scripts 生成 ◀── T05, T07, T08 ──────────────────────────────────────────────┘
T11 README / T12 marketplace 登録・DESIGN 更新 ◀── T10
T13 統合検証 ◀── 全部
```

> **T09 の完全動作確認は T10 後**: SKILL.md はビューア起動(`scripts/serve.mjs`)まで含む最終形を書くが、
> `scripts/serve.mjs` が生成されるのは T10。T09 の完了条件は「tour.json の生成と `validateTour` 通過」までとし、
> URL 提示を含む一気通貫の確認は T13 で行う。

| ID | タスク | 依存 | 担当帯 |
| --- | --- | --- | --- |
| T01 | プラグイン足場と workspace 登録 | — | 軽量 |
| T02 | lib 基盤(types / paths / atomic / hook-io / frontmatter) | T01 | 通常 |
| T03 | lib/tour-store.ts(tour.json スキーマ検証・一覧・answers) | T02 | 複雑 |
| T04 | lib/queue.ts(質問キューと processed 移動) | T02 | 通常 |
| T05 | hooks 2 種 + lib/injection.ts + hooks/hooks.json | T03, T04 | 複雑 |
| T06 | lib/http-handler.ts(純関数ルーティング) | T03, T04 | 複雑 |
| T07 | src/serve.ts(listen・ポートリトライ・--open) | T06 | 通常 |
| T08 | ui.html(ビューア本体) | T07 | 複雑 |
| T09 | skills/guidepost/SKILL.md(ツアー生成) | T03(完全動作確認は T10 後 → T13) | 複雑 |
| T10 | build.ts 実体化と scripts/ バンドル生成 | T05, T07, T08 | 通常 |
| T11 | README.md | T10 | 通常 |
| T12 | marketplace.json 登録・DESIGN ステータス更新 | T11 | 軽量 |
| T13 | 統合検証 | 全部 | 通常 |

---

## T01. プラグイン足場と workspace 登録

- **担当帯**: 軽量
- **目的**: `plugins/guidepost/` を pnpm workspace の一員として認識させ、以降のタスクがビルド・テストできる状態にする。
- **対象ファイル**
  - 新規 `plugins/guidepost/package.json` — `plugins/pitcrew/package.json` をコピーし、`name` を `guidepost-scripts`、`version` を `0.1.0-dev` に変更。`private: true` / `type: module` / `scripts.build: "tsx build.ts"` はそのまま。
  - 新規 `plugins/guidepost/.claude-plugin/plugin.json` — `{"name": "guidepost", "description": "<DESIGN §1 のコンセプトを 1 行で>", "version": "0.1.0-dev"}`。
  - 編集 `pnpm-workspace.yaml` — `packages:` に `- plugins/guidepost` を追加。
  - 新規 `plugins/guidepost/build.ts` — **no-op スタブ**。中身は `console.log("guidepost: build stub")` の 1 行のみ(esbuild を呼ばない)。
    ルートの `pnpm build` は `pnpm -r build` で全 workspace を回すため、`build.ts` が不在だと T10 まで**リポジトリ全体のビルドが壊れる**。
    スタブを置くことで T02〜T09 の間もルートの `pnpm build` が通る状態を保つ。T10 で実体に差し替える。
  - 新規 `plugins/guidepost/scripts/.gitkeep`(T10 でバンドル出力が入るまでの空ディレクトリ保持。T10 で不要になれば削除してよい)。
- **完了条件**
  - ルートで `pnpm install` が成功し、`pnpm ls -r --depth -1` に `guidepost-scripts@0.1.0-dev` が現れる。
  - ルートで `pnpm build` が成功し、`guidepost: build stub` が出力される(他プラグインのビルドも壊れていない)。
  - `plugin.json` が有効な JSON で、`name` が `guidepost`。

## T02. lib 基盤(types / paths / atomic / hook-io / frontmatter)

- **担当帯**: 通常
- **目的**: 以降すべてのモジュールが依存する型・パス解決・アトミック書き込み・hook 入出力・frontmatter を、pitcrew からコピーして guidepost 用に自己完結させる。
- **対象ファイル**
  - 新規 `src/lib/types.ts` — DESIGN §3 の tour.json スキーマ v1 をそのまま型に落とす。
    - `TourSource { type: "range" | "pr"; value: string }`
    - `TourStopHunk { oldStart, oldLines, newStart, newLines: number }`
    - `TourStop { id, file, title, what, why, ifBroken: string; hunk?: TourStopHunk; diffText?: string }`(概要ストップは `hunk`/`diffText` を持たないため任意)
    - `Tour { version: 1; tourId, title, baseSha, headSha: string; source: TourSource; stops: TourStop[] }`
    - `Question { name, tourId, stopId, createdAt, body: string }`
    - `Answer { stopId, ts, body: string }`
  - 新規 `src/lib/paths.ts` — `guidepostDir(projectDir)` = `<projectDir>/.guidepost`、`toursDir()`、`tourDir(projectDir, tourId)`、`answersDir(projectDir, tourId)`、`questionsDir(projectDir)` = `.guidepost/queue/questions`、`processedDir(projectDir)` = `.guidepost/queue/questions/processed`。
    - pitcrew では `pitcrewDir` が `lib/run.ts` に同居しているが、guidepost に `run.ts` 相当は無いため独立ファイルにする(DESIGN §2.1 の構成図への追記が必要 → T12 で反映)。
  - 新規 `src/lib/atomic.ts` — `plugins/pitcrew/src/lib/atomic.ts` を**そのままコピー**(改変不要。コメント中の「設計書 §9」参照だけ guidepost の DESIGN §2.2 に書き換える)。
  - 新規 `src/lib/hook-io.ts` — `plugins/pitcrew/src/lib/hook-io.ts` をコピーし、`pitcrewDir` の import を `./paths.js` の `guidepostDir` に差し替え、ログ出力先を `.guidepost/log/errors.log` にする。`HookInput` 型・`readStdinSync` / `resolveProjectDir` はそのまま。
  - 新規 `src/lib/frontmatter.ts` — `plugins/pitcrew/src/lib/frontmatter.ts` を**そのままコピー**(質問ファイルの YAML frontmatter に使う。外部 YAML ライブラリを入れないため)。DESIGN §2.1 の構成図への追記が必要 → T12。
  - 新規 `src/testing/run-ts.ts` — `plugins/pitcrew/src/testing/run-ts.ts` をコピー(hook をビルド前に子プロセス実行してテストするため。`runTs` のみで足り、`runTsAsync` は不要なら落としてよい)。
  - 新規 `src/lib/__test__/atomic.test.ts` — pitcrew の同名テストを参考に、書き込み成功・親ディレクトリ自動作成・書き込み失敗時に tmp が残らないことを検証。
  - 新規 `src/lib/__test__/frontmatter.test.ts` — pitcrew の同名テストを流用(引用が必要な値のラウンドトリップ、frontmatter 無しのとき body 全体が返ること)。
  - 新規 `src/lib/__test__/paths.test.ts` — 各パス関数が `.guidepost/` 配下の期待パスを返すこと。
- **完了条件**
  - `pnpm test` で上記 3 テストファイルが green。
  - `src/lib/` 配下に pitcrew への import が 1 つも無い(`grep -r "pitcrew" plugins/guidepost/src` が空)。
  - `pnpm typecheck` が通る。

## T03. lib/tour-store.ts(tour.json の読み書きとスキーマ検証)

- **担当帯**: 複雑(スキーマ検証の網羅性と壊れたツアーのスキップ挙動が肝)
- **目的**: `.guidepost/tours/` を単一の読み取り口に閉じ込め、壊れた tour.json をビューア・hook が安全にスキップできるようにする。
- **対象ファイル**
  - 新規 `src/lib/tour-store.ts`
    - `makeTourId(date: Date, headSha: string): string` — `YYYYMMDD-HHmmss-<短縮SHA7桁>`(DESIGN §2.2)。
    - `validateTour(value: unknown): { tour: Tour } | { error: string }` — `version === 1`、必須文字列フィールド、`source.type` が `range | pr`、`stops` が 1 件以上 20 件以下、各 stop の `id` が `stop-NN` 形式でツアー内一意、`hunk` があれば 4 つの数値が揃っていること、を検証。エラーは人間が読める 1 行の文字列。
    - `listTours(projectDir): { tourId, title, createdAt, stopCount, error?: string }[]` — `tours/` を新しい順に列挙。壊れた tour.json は `error` 付きのエントリとして返し、例外にしない(DESIGN §6 の「エラーバナーを表示して壊れたツアーをスキップ」を UI 側で実現するため)。
    - `readTour(projectDir, tourId): { tour: Tour } | { error: string }` — `tourId` は `[A-Za-z0-9-]+` のみ許可し、パストラバーサル(`..` / セパレータ)を明示的に拒否する。
    - `writeTour(projectDir, tour): void` — `writeFileAtomic` で `tour.json` を書く。
    - `listAnswers(projectDir, tourId): Answer[]` — `answers/<stop-id>-<ts>.md` をファイル名から `stopId` / `ts` に分解し、`ts` の昇順(=作成順)で返す。命名規則に合わないファイルは無視。
    - `answerPath(projectDir, tourId, stopId, ts): string` — 回答書き込み先の解決(hook の指示文で使う)。
  - 新規 `src/lib/__test__/tour-store.test.ts` — 一時ディレクトリ(`fs.mkdtempSync`)を使い、(a) 正常な tour.json の往復、(b) `version: 2` / stops 空 / stop id 重複 / 必須フィールド欠落それぞれで `error` が返ること、(c) JSON として壊れたファイルが `listTours` で `error` エントリになり例外を投げないこと、(d) `readTour("../../etc")` 等が拒否されること、(e) `listAnswers` が作成順に並ぶこと、を検証。
- **完了条件**
  - 上記テストが green。異常系ケースが 5 つ以上あること。
  - `listTours` / `readTour` / `listAnswers` のいずれも、`.guidepost/` が存在しないプロジェクトで例外を投げず空配列 or `error` を返す。

## T04. lib/queue.ts(質問キューと processed 移動)

- **担当帯**: 通常
- **目的**: 質問の書き込み(serve 側)と、列挙・クレーム(hook 側)を 1 モジュールに閉じる。pitcrew の `comments.ts` の「rename をもって所有権獲得」パターンをそのまま持ち込む。
- **対象ファイル**
  - 新規 `src/lib/queue.ts` — `plugins/pitcrew/src/lib/comments.ts` を骨格として改変。
    - `writeQuestion(projectDir, { tourId, stopId, body }): string | null` — ファイル名は `<ts>.md`(`ts` は `YYYYMMDDTHHmmssSSS` 等のソート可能形式)。同一ミリ秒衝突時は連番サフィックスを付ける。中身は `serializeFrontmatter({ tourId, stopId, createdAt })` + 本文。`writeFileAtomic` を使う。本文が空なら `null`。
    - `listQuestions(projectDir): Question[]` — `queue/questions/*.md` を名前昇順で読み、`parseFrontmatter` で `tourId` / `stopId` / `createdAt` を取る。frontmatter が無い・壊れているファイルも本文だけで拾う(pitcrew の `listComments` と同じ寛容さ)。ディレクトリ・非 `.md` は無視。
    - `claimQuestion(projectDir, name): boolean` — `questions/<name>` → `questions/processed/<name>` の `fs.renameSync`。成功のみ true(pitcrew の `claimComment` と同型)。
  - 新規 `src/lib/__test__/queue.test.ts` — (a) 書き込み→列挙の往復、(b) 空本文で `null`、(c) frontmatter 無しファイルも列挙される(`tourId`/`stopId` は `null` になる)、(d) `claimQuestion` 後に元ファイルが消え `processed/` に現れる、(e) 同じ name を 2 回 claim したら 2 回目は false、(f) キューディレクトリが無いとき `listQuestions` が空配列、(g) 改行を含む `tourId` / `stopId` が frontmatter を壊さない(引用される)こと。
- **テスト責務の分担(T05 と重複させない)**
  - **T04 が持つ**: `claimQuestion` の rename 単体挙動(成功で移動する / 2 回目は false)。
  - **T05 が持つ**: hook 経由の二重注入防止(Stop → PreToolUse を順次実行して 2 回目に注入が出ないこと)。
  - **書かない**: 複数プロセスを同時起動する race テストは不要。同一ディレクトリ内 rename の原子性は OS が保証しており、テストが不安定になるだけで得るものが無い。
- **完了条件**
  - 上記テストが green(7 ケース以上)。
  - `queue.ts` が `tour-store.ts` に依存しないこと(キューは全ツアー共有で、ツアーの実在確認は行わない — DESIGN §2.2)。

## T05. hooks 2 種 + lib/injection.ts + hooks/hooks.json

- **担当帯**: 複雑(注入の二段構えと at-most-once の担保)
- **目的**: 未処理質問をセッションへ届ける層を作る。Stop で差し戻し、PreToolUse で `additionalContext` 注入。判定は決定的(ファイル存在チェックのみ)で、LLM も外部プロセスも呼ばない。
- **対象ファイル**
  - 新規 `src/lib/injection.ts` — `renderInjection(questions: Question[], projectDir, maxChars): string`。pitcrew の `comments.ts#renderInjection` を骨格に、guidepost 用の指示文へ差し替える:
    - 見出しは `[guidepost] ツアー閲覧者からの質問(N 件)`。
    - 各質問セクションに `tourId` / `stopId` と、**回答の書き込み先の絶対パス**(`answerPath()` で解決したもの)を明記する。
    - 「該当ストップの文脈は `.guidepost/tours/<tourId>/tour.json` の該当エントリを読むこと」「回答は `answers/<stop-id>-<ts>.md` に**新規ファイルとして**書く(既存ファイルへの追記はしない)」を指示に含める(DESIGN §5)。
    - 上限超過時は切り詰め、`processed/` の該当ファイル名を参照として付記(pitcrew と同じ)。
    - `MAX_INJECT_CHARS = 9000`。
    - **frontmatter 欠損時のフォールバック(必須)**: T04 の `listQuestions` は frontmatter が無い・壊れた質問ファイルも本文だけで拾うため、`tourId` / `stopId` が `null` になりうる。この場合 `answerPath()` が解決できないので、**回答先パスを提示してはならない**。代わりにそのセクションへ「どのツアー・どのストップへの質問か特定できないため、セッション内で回答のみ行い `answers/` への書き込みは不要」と明記する。パスを勝手に推測したり、既定のツアーへ書かせたりしない。
  - 新規 `src/hooks/inject-stop.ts` — `plugins/pitcrew/src/hooks/inject-stop.ts` をコピーして改変。`stop_hook_active !== true` のときだけ `listQuestions` → `claimQuestion` に成功したものを `{ decision: "block", reason: renderInjection(...) }` で出力。例外は `logError(projectDir, "inject-stop", err)`。常に `process.exit(0)`。
  - 新規 `src/hooks/inject-pre-tool-use.ts` — `plugins/pitcrew/src/hooks/inject-pre-tool-use.ts` をコピーして改変。**パス照合は行わない**(guidepost の質問はファイルパスに紐づかない)。代わりに「未処理質問があれば claim して `hookSpecificOutput.additionalContext` で注入」する。`permissionDecision` は返さない。キューディレクトリが存在しない場合は `readdirSync` の例外を握って即終了(通常時のオーバーヘッドを readdir 1 回に抑える)。
  - 新規 `hooks/hooks.json` — pitcrew の `hooks/hooks.json` を骨格に、guidepost 用の 2 エントリのみ:
    - `Stop` → `node "${CLAUDE_PLUGIN_ROOT}/scripts/inject-stop.mjs"`(timeout 10)
    - `PreToolUse`(matcher `"*"`)→ `node "${CLAUDE_PLUGIN_ROOT}/scripts/inject-pre-tool-use.mjs"`(timeout 10)
    - `description` は guidepost の役割を 1 行で。
  - 新規 `src/hooks/__test__/inject-stop.test.ts` / `src/hooks/__test__/inject-pre-tool-use.test.ts` — pitcrew の同名テストの構造(`runTs` で hook を子プロセス実行し stdout を検証、一時ディレクトリを毎回作って消す)をそのまま流用。ケース:
    - (a) 未処理質問ありで `decision: "block"` かつ質問本文と回答先パスが reason に含まれる
    - (b) `stop_hook_active: true` では無出力かつ質問が `questions/` に残る
    - (c) 質問なしで無出力
    - (d) 壊れた(frontmatter 無し)質問ファイルでも注入されるが、**回答先パスは提示されず**「特定できないため回答のみ」の指示が含まれる(上記フォールバックの検証)
    - (e) 不正な stdin で無出力・exit 0
    - (f) PreToolUse で `hookSpecificOutput.additionalContext` が出ること
    - (g) 注入後に質問が `processed/` へ移動していること
    - (h) **二重注入防止**: 質問 1 件を置いて Stop hook → PreToolUse hook を**順次**実行し、2 回目が無出力であること(claim の rename が唯一の所有権であることの検証。T04 の rename 単体テストとは別レイヤー)
- **完了条件**
  - 上記 2 テストファイルが green(合計 8 ケース以上)。
  - どの異常系でも hook の exit code が 0(フェイルオープン)であることをテストで確認済み。
  - ケース (h) により、同一質問が Stop と PreToolUse の両方から二重注入されないことが確認済み。

## T06. lib/http-handler.ts(純関数ルーティング)

- **担当帯**: 複雑
- **目的**: DESIGN §7 の要求どおり、リクエスト処理を HTTP リスナーから分離した純関数にし、実ポートを開かずにルーティング・エラー応答・書き込み副作用をテストできるようにする。
- **対象ファイル**
  - 新規 `src/lib/http-handler.ts`
    - `export interface HandlerResult { status: number; contentType: string; body: string }`
    - `export function handleRequest(opts: { projectDir: string; html: string }, method: string, pathname: string, body: string): HandlerResult`
    - ルート(DESIGN §4):
      - `GET /` → 200 / `text/html` / `html`
      - `GET /api/tours` → 200 / `listTours()` の JSON
      - `GET /api/tours/<id>` → 200 / `{ tour, answers }`。`readTour` が `error` を返したら 400 で `{ error }`(ビューアがエラーバナーを出せるよう、壊れたツアーでも 500 にしない)。存在しない id は 404。
      - `POST /api/questions` → body を JSON parse。`{tourId, stopId, question}` の型検証。JSON パース失敗は 400 `{ error: "bad json" }`、`question` が文字列でない・空・空白のみ、または改行入り `tourId`/`stopId` は 400 `{ error: "bad field" }`。検証通過後に `writeQuestion()` を呼び、**戻り値が `null`(空本文と判定された)場合も 400 `{ error: "empty question" }` を返す**(ハンドラ側の事前検証と `writeQuestion` 側の判定がずれても 500 や 200 にしない)。成功時 200 `{ ok: true, name }`。
      - それ以外 → 404 `{ error: "not found" }`
    - パストラバーサル対策は `tour-store` 側の id 検証に委ねつつ、ハンドラでも `decodeURIComponent` 後に `[A-Za-z0-9-]+` を検査する。
  - 新規 `src/lib/__test__/http-handler.test.ts` — 一時ディレクトリに tour を用意し、`handleRequest` を直接呼んで検証。ケース: 各ルートの正常系、未知パスの 404、不正 JSON の 400、空 question の 400、**空白のみの question も 400(`writeQuestion` が `null` を返す経路)**、`../` を含む tourId の 400/404、`POST /api/questions` 後に実際に `queue/questions/*.md` が生成されていること、壊れた tour.json で 400 かつ例外を投げないこと。
- **完了条件**
  - 上記テストが green(9 ケース以上)。テスト内で HTTP サーバーを一度も listen しないこと。
  - `handleRequest` が例外を投げない(内部で握って 500 を返す)。

## T07. src/serve.ts(listen・ポートリトライ・--open)

- **担当帯**: 通常
- **目的**: `node scripts/serve.mjs` で起動する薄いエントリを作る。ロジックは持たず、引数解析・listen・ポートリトライ・URL 表示・終了処理のみ。
- **対象ファイル**
  - 新規 `src/serve.ts` — `plugins/pitcrew/src/server/serve.ts` の構造を流用。
    - `parseArgs`: `--port N` / `--dir PATH` / `--open`。デフォルトポートは **4870**(DESIGN §4)、デフォルト dir は `process.cwd()`。
    - UI は `new URL("./ui.html", import.meta.url)` で自分の隣から読む(`src/` でも `scripts/` でも同じ相対位置になるよう、`ui.html` は `src/ui.html` に置き、build 時に `scripts/ui.html` へコピーする — pitcrew と同じ流儀)。
    - `http.createServer` の中で `handleRequest` を呼ぶ。リクエストボディの読み取り上限は 1 MB(pitcrew の `readBody` を流用)。
    - **ポートリトライ**: `EADDRINUSE` のとき port+1 で再試行、最大 10 回。すべて失敗したらエラーメッセージを出して exit 1。確定したポートを含む URL を標準出力に 1 行で出す(例 `guidepost viewer: http://127.0.0.1:4870/`)。
    - `127.0.0.1` のみにバインド。トークンは使わない(DESIGN §4 は localhost バインドのみを要求)。
    - `--open` 指定時は `child_process` でプラットフォーム別のオープンコマンドを実行し、失敗しても無視して続行。
    - `SIGINT` / `SIGTERM` で `server.close()` → exit 0。
  - 新規 `src/__test__/serve.test.ts` — `runTs` で `serve.ts --port 0 --dir <tmp>` を起動して標準出力の URL 行フォーマットを確認する軽量テスト 1 本(プロセスは即 kill)。**ポートリトライの実挙動テストは不要**(ルーティングは T06 でカバー済み)。テストが不安定になるようならこのテストは落とし、手動確認へ回してよい。
- **完了条件**
  - `pnpm tsx plugins/guidepost/src/serve.ts --dir <一時ディレクトリ>` で起動し、`curl http://127.0.0.1:4870/api/tours` が `[]` を返す(ディレクトリ未作成でも 200)。
  - 同じポートで 2 つ目を起動すると 4871 で起動し、その旨が標準出力に出る。
  - Ctrl-C でプロセスが 1 秒以内に終了する。

## T08. ui.html(ビューア本体)

- **担当帯**: 複雑(単一ファイル・依存なし・オフライン動作)
- **目的**: ツアーを 1 ストップずつ巡回する 2 ペイン UI を、外部 CDN 依存ゼロの単一 HTML で実装する。
- **対象ファイル**
  - 新規 `src/ui.html` — `plugins/pitcrew/src/server/ui.html`(655 行)を**構造の参考**にする(単一ファイル・inline CSS/JS・テーマ変数・fetch でのポーリング)。ただし画面構成は別物なので、丸ごとコピーせずレイアウトとテーマ変数だけ借りる。
    - 左ペイン: ツアー選択(`/api/tours`)+ ストップ一覧。各ストップに既読チェック(`localStorage` に `guidepost:<tourId>:read` として保存)。
    - 右ペイン: 現在のストップの `title` / `file` / diff 表示 / 解説 3 要素(何をしているか・なぜこの設計か・壊すと何が起きるか)/ 既存の回答一覧。
    - diff 表示: `diffText` を行単位で分解し、`+` / `-` / `@@` / 文脈行を色分け。加えて**自前の軽量トークナイザ**による最小限のシンタックスハイライト(文字列リテラル・行コメント・数値・キーワード)を実装する。
      - **外部ライブラリは読み込まないだけでなく、同梱もしない**(highlight.js 等をバンドルに入れる選択肢は本計画で閉じる)。ui.html は自前実装のみで自己完結させる。
      - 対応言語は**拡張子ベースで TS / JS(`.ts` `.tsx` `.js` `.jsx` `.mts` `.mjs`)/ JSON / Markdown 程度**にキーワード定義を持つ。それ以外の拡張子は**diff の色分けのみ**にフォールバックする(言語を増やす作業はしない)。
    - 下部: 質問ボックス。送信で `POST /api/questions`(`tourId` / `stopId` / `question`)。`Ctrl+Enter` / `Cmd+Enter` でも送信。送信後は「質問を送りました。回答が届くとここに表示されます」を表示。
    - 「次へ / 前へ」ボタンとキーボードショートカット(`j`/`k` または矢印)。
    - **2 秒間隔のポーリング**で `/api/tours/<id>` を再取得し、`answers` の増分を該当ストップに反映する。ページ全体を再描画せず、現在のストップと選択状態を保つこと。
    - エラーバナー: `/api/tours` のエントリに `error` があるツアーは一覧でグレーアウト+バナー表示し、選択しても本文表示せずエラー理由を出す(DESIGN §6)。
    - `baseSha` が現在の HEAD と異なる場合の警告表示は、サーバーが git を触らない方針のため**表示しない**(DESIGN §6 の警告は将来拡張として README に記載するに留める)。この判断はタスク完了報告で明示すること。
    - HTML エスケープを徹底する(diff・解説・回答はすべてユーザー/LLM 由来のテキスト。`innerHTML` に生で入れない)。
- **完了条件**
  - `pnpm tsx plugins/guidepost/src/serve.ts --dir <サンプル tour を置いた一時ディレクトリ>` で起動し、ブラウザで以下がすべて動くこと(手動確認・スクリーンショット不要だが実施報告は必須):
    1. ツアーが一覧に出て、選択するとストップ 1 が表示される
    2. 次へ/前へでストップが移動し、既読チェックがリロード後も保持される
    3. diff が色分け表示される
    4. 質問を送ると `.guidepost/queue/questions/` に `.md` が生成される
    5. `answers/<stop-id>-<ts>.md` を手で置くと 2 秒以内に該当ストップへ現れる
    6. ネットワークタブに外部ドメインへのリクエストが 1 件も無い
  - `grep -iE "https?://(?!127\.0\.0\.1)" src/ui.html` に外部リソース読み込みが無い。

## T09. skills/guidepost/SKILL.md(ツアー生成)

- **担当帯**: 複雑(手順の決定性と中断条件の明確さが価値の中心)
- **目的**: `/guidepost <範囲>` でツアーを生成する手順を、LLM が再現できる粒度で記述する。LLM 処理はここに閉じる。
- **実行環境の前提**: このスキルは**メインセッションで実行される**。`git` / `gh` / `node` はすべて Claude が Bash ツール経由で叩き、**ユーザーに CLI 操作を要求しない**(リポジトリ規約)。SKILL.md 本文にもこの前提を 1 行明記すること。
- **対象ファイル**
  - 新規 `plugins/guidepost/skills/guidepost/SKILL.md` — frontmatter の `name: guidepost` / `description`(「コミット範囲や PR の diff を、依存順に並べたコードリーディングツアーへ変換する。ユーザーが `/guidepost` を実行したとき、または直近の変更の解説を求めたときに使う」相当)。本文に以下の手順を書く:
    1. **引数解釈**: コミット範囲(`HEAD~3..HEAD` 等)/ PR 番号(`#42`)/ 省略時 `HEAD~1..HEAD`。
    2. **diff 取得**: 範囲モードは `git diff <range>` と `git rev-parse` で base/head SHA。PR モードは `gh pr view <n> --json baseRefOid,headRefOid` で base/head を**動的に**取得(`main` を仮定しない)→ `git diff <base>..<head>`。`gh` が無い/失敗した場合は**コミット範囲モードの使い方を案内して中断**する(部分的成功を装わない — DESIGN §6)。
    3. **サイズガード**: diff が 10,000 行を超えたら警告し、範囲の分割を提案して中断する。
    4. **並べ替え**: 型・データモデル定義 → コアロジック → 呼び出し側・配線 → テスト → 設定/雑務。
    5. **ストップ化**: hunk 単位。上限 20。超過分は末尾の「概要ストップ」1 つに畳む(`diffText` 無し、畳んだファイルのパス一覧と各 1 行の変更概要のみ)。`id` は並べ替え確定後に `stop-01`〜`stop-20` で採番。
    6. **解説**: 各ストップに `what` / `why` / `ifBroken` の 3 要素。空欄禁止。
    7. **書き出し**: `.guidepost/tours/<YYYYMMDD-HHmmss-短縮SHA>/tour.json`。DESIGN §3 のスキーマ v1 に厳密に従う(`version: 1` を必ず含む)。`diffText` は該当 hunk 単体の unified diff を**自己完結**で持つ。
    8. **提示**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" --dir "$(pwd)"` を `run_in_background: true` で起動し、標準出力の URL をユーザーに提示する(pitcrew の `commands/serve.md` の起動手順を参考にするが、guidepost は serve.json を持たないので出力行から URL を読む)。既に起動済みかは `curl -s -o /dev/null http://127.0.0.1:4870/` で判定してよい。
       - **注**: `scripts/serve.mjs` は T10 で生成される。SKILL.md にはこの最終形の手順をそのまま書いてよいが、**T09 の時点では実行して確認できない**(確認は T13)。
    9. **回答時の作法**: `[guidepost]` で始まる注入を受けたら、該当 `tour.json` のストップを読んでから回答を指定パスへ**新規ファイルとして**書く。既存 answers への追記はしない。`.guidepost/` の他のファイルは編集しない。
  - `.gitignore` への `.guidepost/` 追加の推奨をスキル本文でも 1 行案内する(実際の追記はユーザーの判断)。
- **完了条件**
  - SKILL.md の frontmatter が有効(`name` / `description` のみ)。
  - 手順に「中断条件」(gh 失敗・巨大 diff)が明記され、部分的成功を許す記述が無い。
  - スキルを読んだだけで tour.json の必須フィールドが全部埋められる(DESIGN §3 のスキーマと突き合わせて欠落なし)。
  - **確認範囲は手順 1〜7 まで**: 本リポジトリで `/guidepost HEAD~1..HEAD` 相当を手動実行し、`.guidepost/tours/<id>/tour.json` が生成され、T03 の `validateTour()` を通ること(`pnpm tsx` で直接呼んで確認)を 1 回検証する。
  - **手順 8(ビューア起動と URL 提示)の確認は T09 の完了条件に含めない**。`scripts/serve.mjs` が未生成のため。一気通貫の確認は T13 手順 5 で行う。

## T10. build.ts 実体化と scripts/ バンドル生成

- **担当帯**: 通常
- **目的**: 利用者がビルド不要で使えるよう、`scripts/` にバンドル成果物を生成・コミットする。
- **対象ファイル**
  - 編集 `plugins/guidepost/build.ts` — **T01 で置いた no-op スタブを実体に差し替える**。`plugins/pitcrew/build.ts` をコピーし、エントリを差し替える:
    - `entryPoints`: `{ serve: "./src/serve.ts", "inject-stop": "./src/hooks/inject-stop.ts", "inject-pre-tool-use": "./src/hooks/inject-pre-tool-use.ts" }`
    - `outdir: "./scripts"` / `outExtension: { ".js": ".mjs" }` / `platform: "node"` / `format: "esm"` / `target: "node26"` / `sourcemap: false`
    - 末尾で `fs.copyFileSync("./src/ui.html", "./scripts/ui.html")`
  - 生成物(git 管理・コミット対象): `scripts/serve.mjs` / `scripts/inject-stop.mjs` / `scripts/inject-pre-tool-use.mjs` / `scripts/ui.html`。
  - T01 で置いた `scripts/.gitkeep` を削除。
- **完了条件**
  - リポジトリルートで `pnpm build` が成功し、上記 4 ファイルが生成される(`guidepost: build stub` の出力が消えていること = スタブが残っていない)。
  - `node plugins/guidepost/scripts/serve.mjs --dir <tmp> --port 0` が起動して URL を出力する。
  - `echo '{}' | node plugins/guidepost/scripts/inject-stop.mjs` が exit 0・無出力(フェイルオープン)。
  - 生成物が `.gitignore` されておらず `git status` に現れる。

## T11. README.md

- **担当帯**: 通常
- **目的**: 利用者が「入れて・生成して・巡回して・質問する」まで到達できるドキュメントを置く。
- **対象ファイル**
  - 新規 `plugins/guidepost/README.md` — `plugins/pitcrew/README.md` の構成(コンセプト → 使い方 → 各機能 → 注意点)を参考に:
    - コンセプト(DESIGN §1 の 3 行 + 図)
    - **導入(使い方の先頭に必ず置く)**: プラグインの有効化手順。marketplace の追加(`/plugin marketplace add <このリポジトリ>`)→ `/plugin install guidepost` 相当の流れを、実際のコマンド付きで書く。他プラグインの README に既存の記載があればその書式に揃える。hook が有効になるにはセッションの再起動が必要な点も明記する
    - 使い方: `/guidepost` → URL を開く → 巡回 → 質問 → 回答が届く
    - `.guidepost/` のディレクトリ構造と、**`.gitignore` に `.guidepost/` を追加する推奨**
    - ビューアの操作(次へ/前へ・既読・質問ボックス・2 秒ポーリング)とデフォルトポート 4870、ポート衝突時の自動リトライ
    - 質問→回答ループの仕組み(Stop / PreToolUse の二段構え、at-most-once、セッションが閉じていれば次回セッションへ遅延配送)
    - 制限事項: ストップ上限 20 / 巨大 diff は中断 / rebase 後も diffText 自己完結で表示は壊れない(現ブランチとの一致警告は未実装)/ ツアーの共有・履歴機能は初版対象外(DESIGN §9)
    - **ビューアの手動テスト手順**(DESIGN §7 が README への記載を要求): T08 の完了条件 1〜6 を再現手順として書く
    - 開発者向け: `pnpm build` でソース変更を `scripts/` に反映すること
- **完了条件**
  - README の手順どおりに未経験者が一周できる(手順に前提の飛びが無い)。**プラグインの有効化から始まっていること**(いきなり `/guidepost` から始めない)。
  - 手動テスト手順が 6 項目以上、実行コマンド付きで書かれている。

## T12. marketplace.json 登録・DESIGN 更新

- **担当帯**: 軽量
- **目的**: マーケットプレースから導入可能にし、設計書を実装の実態に合わせる。
- **対象ファイル**
  - 編集 `.claude-plugin/marketplace.json` — `plugins` 配列の末尾に追加:
    ```json
    { "name": "guidepost", "source": "./plugins/guidepost", "description": "コミット範囲や PR の diff を、依存順に並べた AI 同行のコードリーディングツアーに変換し、読中の疑問をその場でセッションへ届ける" }
    ```
    `description` は `plugins/guidepost/.claude-plugin/plugin.json` の `description` と一致させる。
  - 編集 `plugins/guidepost/DESIGN.md` —
    - §2.1 の構成図に、実装で追加した `src/lib/paths.ts` / `src/lib/frontmatter.ts` / `src/lib/injection.ts` / `src/lib/http-handler.ts` / `src/ui.html` / `src/testing/run-ts.ts` を反映(`src/serve.ts` は listen 専用である旨を 1 行注記)。
    - ステータス行を「設計レビュー中(未実装)」→「実装済み(v0.1.0-dev)」に更新。
    - §6 の「ベース SHA 不一致の警告」を初版未実装として §9 に移すか、注記を付ける。
- **完了条件**
  - `.claude-plugin/marketplace.json` が有効な JSON で、`guidepost` エントリの `source` パスが実在する。
  - DESIGN の構成図と実際の `plugins/guidepost/src/` のファイル一覧が一致する(`find` 結果と目視突き合わせ)。

## T13. 統合検証

- **担当帯**: 通常(結果の合否判断はオーケストレーターが行う)
- **目的**: 全部品が繋がって動くことを、機械検証 + 手動確認の両方で確定させる。
- **手順**
  1. **クリーンビルド**: リポジトリルートで
     ```bash
     pnpm install
     pnpm build
     git status --porcelain plugins/guidepost/scripts
     ```
     → `scripts/` の 4 ファイルが生成され、ソース未変更なら差分ゼロで安定すること(2 回連続ビルドで差分が出ないこと)。
  2. **静的検証**:
     ```bash
     pnpm typecheck
     pnpm lint
     ```
     → いずれもエラー 0。
  3. **テスト一括**:
     ```bash
     pnpm test
     ```
     → guidepost の全テストが green。既存プラグインのテストにも回帰が無いこと。
  4. **自己完結の確認**:
     ```bash
     grep -rn "pitcrew" plugins/guidepost/src plugins/guidepost/hooks || echo OK
     grep -rniE "anthropic|api[_-]?key|openai" plugins/guidepost/src plugins/guidepost/skills || echo OK
     ```
     → いずれもヒット無し(README/DESIGN の言及は除く)。
  5. **エンドツーエンド手動確認**(このリポジトリ自身を対象に実施):
     1. guidepost プラグインを有効化したセッションで `/guidepost HEAD~2..HEAD` を実行 → `.guidepost/tours/<id>/tour.json` が生成され、ストップが依存順に並んでいる
     2. **T09 手順 8 の確認(T09 から持ち越し)**: 同じ実行の中でスキルが `scripts/serve.mjs` を `run_in_background` で起動し、URL をユーザーに提示できること。既に起動済みの場合に二重起動しないことも確認する
     3. 提示された URL をブラウザで開き、ストップを巡回できる(diff 表示・解説 3 要素・次へ/前へ・既読)
     4. 質問ボックスから質問を送る → `.guidepost/queue/questions/<ts>.md` が生成される
     5. セッションでツールを 1 回使う(PreToolUse 経路)か、ターンを終える(Stop 経路)→ `[guidepost]` の注入が届き、質問ファイルが `queue/questions/processed/` へ移動している
     6. Claude が `.guidepost/tours/<id>/answers/<stop-id>-<ts>.md` を書く → 2 秒以内にビューアの該当ストップに回答が現れる
     7. サーバーを Ctrl-C で停止 → 即座に終了する
     8. **遅延配送**: サーバーを止めた状態で質問だけ残し、新しいセッションを開始 → 最初の Stop で注入されること
  6. **異常系のスモーク**: `tour.json` を手で壊す → ビューアがエラーバナーを出して他のツアーは通常表示されること。`gh` を PATH から外して `/guidepost #1` → 中断メッセージが出ること(擬似的に PR 番号を存在しない値にするのでも可)。
- **完了条件**
  - 手順 1〜4 がすべてパス。
  - 手順 5 の 8 項目・手順 6 の 2 項目がすべて確認済みで、結果を報告に列挙(手順 5-2 は T09 から持ち越した確認項目なので落とさない)。
  - 未解決の不具合があれば、修正して再検証するか、README の「制限事項」に明記する(黙って残さない)。

---

## 2. DESIGN からの逸脱点(実装上の判断)

以下は DESIGN §2.1 の構成図には無いが、テスト可能性と依存整理のために追加するもの。T12 で DESIGN に反映する。

| 追加 | 理由 |
| --- | --- |
| `src/lib/paths.ts` | pitcrew では `lib/run.ts` にあった `pitcrewDir` 相当。guidepost に `run.ts` は無いため独立させる |
| `src/lib/frontmatter.ts` | 質問ファイルの YAML frontmatter 用。外部 YAML ライブラリを入れないため pitcrew から流用 |
| `src/lib/injection.ts` | 注入テキスト生成を 2 つの hook で共有するため |
| `src/lib/http-handler.ts` | DESIGN §7 が要求する「HTTP リスナーから分離した純関数」。`src/serve.ts` は listen 専用の薄いエントリになる |
| `src/ui.html`(`src/` 配下) | build 時に `scripts/ui.html` へコピーする pitcrew と同じ流儀。`import.meta.url` 相対で src/scripts どちらからも同じコードで読める |
| `src/testing/run-ts.ts` | hook をビルド前に子プロセス実行してテストするため |

また、ビューアのトークン認証は導入しない(DESIGN §4 は localhost バインドのみを要求。pitcrew は書き込み系 API が多いためトークンを持つが、guidepost の書き込みは質問キューのみ)。この判断で問題があれば T06/T07 の前に見直すこと。
