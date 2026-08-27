# chat-history 1 セッション 1 ファイル化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/chat/` の記録ファイルを 1 Claude Code セッション 1 ファイルにし、記録先・ファイル名・INDEX 行の決定を LLM からスクリプトへ移す。

**Architecture:** `prepare-chat-recording` がセッション開始時刻を確定して日付ディレクトリとファイル名プレフィックスを導き、記録先の選択を `state.recordPath` だけに絞る。`commit-chat-recording` はトピックのスラッグと要旨だけを受け取り、ファイルパス・INDEX 行・ヘッダーの `セッション ID` 行を自分で合成する。chat-recorder が書くのは短い自然言語だけになる。

**Tech Stack:** TypeScript 6 (strict, ESM) / Node.js 26 / vitest 4 / esbuild / pnpm workspace

**Spec:** `harness-docs/design/2026-08-26-chat-history-session-split-design.md`

## Global Constraints

- 実装は TypeScript で書く。`plugins/chat-history/scripts/` は編集せず `pnpm run build` で再生成する。
- **ビルドは Task 6 まで行わない。** 通常の規約は「`src/` を変更したらビルドして `scripts/` を同じコミットに含める」だが、この改修では従わない。本番の記録経路は chat-recorder（Agent 定義）が `scripts/*.mjs` を CLI で叩く経路だけであり、バンドルと Agent 定義のどちらか片方だけが新契約になると記録が失敗する。このリポジトリはブランチを切らず `docs/chat/` を持つため、実装中の会話自身が Stop フックで記録対象になり、この不整合を実際に踏む。Task 1〜5 は `src/` とテストだけを変更し、Task 6 で Agent 定義とバンドルを同一コミットに入れる。
- テストは vitest。対象ソースと同じディレクトリの `__test__/` に置き、ファイル名は `<対象ファイル名>.test.ts` とする。
- vitest が拾うのは `plugins/**/__test__/**/*.test.ts` のみ。実行環境は node、プロセス分離は forks、タイムアウト 20 秒。
- 各タスクの終了時に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ること。
- ブランチを切らない。必要なら git worktree を使う。`git push` に `--force` 系を付けない。
- 記録ファイル名のプレフィックスは `HHMM`（セッション開始時刻のローカル時分）。スラッグの形式は `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`、上限 80 文字、先頭 4 桁数字（`/^\d{4}($|-)/`）は拒否。
- INDEX 行の形式は `` - `<docs/chat からの相対パス>` | <YYYY-MM-DD> | <作業者名> | <要旨> ``。要旨に `|` と改行を含めない。
- plan スキーマの `version` は `2`。`prepare` が明示的に書き、`commit` が `!== 2` を拒否する。
- `plugins/chat-history/.claude-plugin/plugin.json` と `package.json` のバージョンを 0.7.0 → 0.8.0 に揃えて上げる（Task 6）。

## 環境上の注意

`tools/delegation_gate.py` が PreToolUse で編集系ツールを止める構成になっている。メインエージェントが直接 Edit / Write できない場合は、サブエージェントへ委譲するか `scripts/direct-edit.sh` で解除する。

---

## ファイル構成

| ファイル | 責務 | 変更 |
| --- | --- | --- |
| `plugins/chat-history/src/prepare-chat-recording.ts` | セッション開始時刻の確定、日付ディレクトリとプレフィックスの算出、記録先の選択、plan の確定値書き込み | Modify |
| `plugins/chat-history/src/commit-chat-recording.ts` | スラッグからのパス合成、EEXIST リトライ、INDEX 行の合成、`セッション ID` 行の追記 | Modify |
| `plugins/chat-history/src/hooks/check-chat-recorded.ts` | `AttemptPlan` 型定義を plan v2 に揃える | Modify |
| `plugins/chat-history/src/find-chat-records.ts` | index モードの並び順を日付降順にする | Modify |
| `plugins/chat-history/src/__test__/commit-chat-recording-cli.test.ts` | CLI（`parseArgs`）を踏む契約テスト | Create |
| `plugins/chat-history/skills/chat/SKILL.md` | 保存場所・索引・ファイル構成の契約 | Modify |
| `plugins/chat-history/agents/chat-recorder.md` | 手順 2 / 3 / 4 の引数と生成物 | Modify |
| `vitest.config.ts` | テスト実行時のタイムゾーン固定 | Modify |

`chat-recording-state.ts` は変更しない。設計の 2 巡目レビューで `state.sessionStartedAt` を廃止したため、状態スキーマは現状のままでよい。

---

## Task 1: セッション開始時刻とローカル時刻変換

**Files:**
- Modify: `plugins/chat-history/src/prepare-chat-recording.ts`
- Modify: `vitest.config.ts`
- Test: `plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `export function localRecordParts(at: Date): { year: string; monthDay: string; hhmm: string; date: string }`
  - `export function firstTranscriptTimestamp(file: string): Date | null`
  - `export function resolveSessionStartedAt(transcript: string): Date`

- [ ] **Step 1: vitest のタイムゾーンを固定する**

`vitest.config.ts` を次に変える。`localRecordParts` は `Date` のローカル getter を使うため、固定しないと CI や他タイムゾーンで期待値が割れる。

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["plugins/**/__test__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 20_000,
    env: { TZ: "Asia/Tokyo" }
  }
})
```

- [ ] **Step 2: TZ が実際に効いていることを確認するテストを書く**

開発機のタイムゾーンが既に `Asia/Tokyo` だと、設定が効いていなくてもこの後のテストは通ってしまう。設定自体を検証する 1 本を `prepare-chat-recording.test.ts` に置く。

```ts
test("テストは Asia/Tokyo 固定で走る", () => {
  expect(process.env.TZ).toBe("Asia/Tokyo")
  // UTC 21:59 は JST では翌日 06:59
  expect(new Date("2026-08-25T21:59:00Z").getHours()).toBe(6)
})
```

- [ ] **Step 3: 全テストを走らせる**

Run: `pnpm run test`
Expected: PASS（Step 2 の新テストを含めて全件）

タイムゾーン固定で落ちる既存テストがあれば、そのテストが暗黙にローカル時刻へ依存していたことになる。落ちた場合はそのテストの期待値を `Asia/Tokyo` 前提に直してから次へ進む。

- [ ] **Step 4: `localRecordParts` の失敗テストを書く**

同じテストファイルに追加する。import 行に `localRecordParts` を足すこと。

```ts
test("localRecordParts は与えた Date のローカル年月日と時分を返す", () => {
  // 2026-08-25T21:59:21Z は Asia/Tokyo では 2026-08-26 06:59
  const parts = localRecordParts(new Date("2026-08-25T21:59:21.651Z"))
  expect(parts).toEqual({
    year: "2026",
    monthDay: "0826",
    hhmm: "0659",
    date: "2026-08-26"
  })
})

test("localRecordParts は 1 桁の月日時分をゼロ埋めする", () => {
  const parts = localRecordParts(new Date("2026-01-04T00:05:00+09:00"))
  expect(parts).toEqual({
    year: "2026",
    monthDay: "0104",
    hhmm: "0005",
    date: "2026-01-04"
  })
})
```

- [ ] **Step 5: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts -t localRecordParts`
Expected: FAIL（`localRecordParts` が export されていない）

- [ ] **Step 6: `localRecordParts` を実装する**

`plugins/chat-history/src/prepare-chat-recording.ts` の `safeWorker` の下に追加する。

```ts
// 日付ディレクトリとファイル名プレフィックスは同じ Date から導く。
// 別々に算出すると、日をまたぐセッションでディレクトリと時刻が食い違う。
export function localRecordParts(at: Date): {
  year: string
  monthDay: string
  hhmm: string
  date: string
} {
  const pad = (value: number): string => String(value).padStart(2, "0")
  const year = String(at.getFullYear())
  const month = pad(at.getMonth() + 1)
  const day = pad(at.getDate())
  return {
    year,
    monthDay: `${month}${day}`,
    hhmm: `${pad(at.getHours())}${pad(at.getMinutes())}`,
    date: `${year}-${month}-${day}`
  }
}
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts -t localRecordParts`
Expected: PASS

- [ ] **Step 8: `firstTranscriptTimestamp` の失敗テストを書く**

同じテストファイルに追加する。import 行に `firstTranscriptTimestamp` と `resolveSessionStartedAt` を足すこと。`roots` はこのファイルの先頭で宣言済みの配列（`afterEach` で削除される）をそのまま使う。

```ts
function writeTranscript(lines: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-start-"))
  roots.push(root)
  const file = path.join(root, "transcript.jsonl")
  fs.writeFileSync(file, `${lines.join("\n")}\n`)
  return file
}

test("firstTranscriptTimestamp は timestamp を持たない先頭行を読み飛ばす", () => {
  const file = writeTranscript([
    JSON.stringify({ type: "last-prompt", leafUuid: "x" }),
    JSON.stringify({ type: "mode" }),
    JSON.stringify({ type: "permission-mode" }),
    JSON.stringify({ type: "atis-latch" }),
    JSON.stringify({ type: "user", timestamp: "2026-08-25T21:59:21.651Z" }),
    JSON.stringify({ type: "assistant", timestamp: "2026-08-25T22:10:00.000Z" })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-08-25T21:59:21.651Z"
  )
})

test("firstTranscriptTimestamp は壊れた行と不正な timestamp を読み飛ばす", () => {
  const file = writeTranscript([
    "{ not json",
    JSON.stringify({ type: "mode", timestamp: 12345 }),
    JSON.stringify({ type: "mode", timestamp: "not-a-date" }),
    JSON.stringify({ type: "user", timestamp: "2026-03-01T00:00:00.000Z" })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-03-01T00:00:00.000Z"
  )
})

// 最初のユーザー発言に大きな貼り付けがあると、1 行が数百 KiB になる。
// 先頭を一定バイトだけ読む実装だと、この行の timestamp を取りこぼす。
test("firstTranscriptTimestamp は 1 行が非常に長くても timestamp を拾う", () => {
  const file = writeTranscript([
    JSON.stringify({ type: "mode" }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-05-05T00:00:00.000Z",
      message: { content: "x".repeat(300_000) }
    })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-05-05T00:00:00.000Z"
  )
})

test("firstTranscriptTimestamp は timestamp が無ければ null を返す", () => {
  const file = writeTranscript([
    JSON.stringify({ type: "last-prompt" }),
    JSON.stringify({ type: "mode" })
  ])
  expect(firstTranscriptTimestamp(file)).toBeNull()
})

test("firstTranscriptTimestamp は読めないファイルで null を返す", () => {
  expect(firstTranscriptTimestamp("/nonexistent/transcript.jsonl")).toBeNull()
})

test("resolveSessionStartedAt は timestamp が無ければファイルの時刻へ落ちる", () => {
  const file = writeTranscript([JSON.stringify({ type: "mode" })])
  const stat = fs.statSync(file)
  const expected = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs
  expect(resolveSessionStartedAt(file).getTime()).toBe(expected)
})
```

- [ ] **Step 9: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts -t firstTranscriptTimestamp`
Expected: FAIL（関数が export されていない）

- [ ] **Step 10: `firstTranscriptTimestamp` と `resolveSessionStartedAt` を実装する**

`localRecordParts` の下に追加する。transcript は全文を読む。直後に `extractConversationFile` が同じファイルを全文読みするため窓読みに利益がなく、1 行が窓を超える場合に timestamp を取りこぼす境界バグだけを持ち込むためである。

```ts
// 先頭の数行(last-prompt / mode / permission-mode / atis-latch など)は timestamp を
// 持たない。行の type では判定できないため「最初に有効な timestamp を持つ行」を採る。
export function firstTranscriptTimestamp(file: string): Date | null {
  let text: string
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let entry: { timestamp?: unknown }
    try {
      entry = JSON.parse(line) as { timestamp?: unknown }
    } catch {
      continue
    }
    if (typeof entry.timestamp !== "string") continue
    const at = new Date(entry.timestamp)
    if (!Number.isNaN(at.getTime())) return at
  }
  return null
}

// セッション開始時刻。transcript から採れないときはファイルの作成時刻へ落ちる。
// この値でファイル名が決まるだけなので、最後は現在時刻でも記録は成立する。
export function resolveSessionStartedAt(transcript: string): Date {
  const fromTranscript = firstTranscriptTimestamp(transcript)
  if (fromTranscript) return fromTranscript
  try {
    const stat = fs.statSync(transcript)
    if (stat.birthtimeMs > 0) return stat.birthtime
    if (stat.mtimeMs > 0) return stat.mtime
  } catch {
    // 取得できなければ現在時刻へ落とす
  }
  return new Date()
}
```

- [ ] **Step 11: テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`
Expected: PASS（既存テストも含めて全件）

- [ ] **Step 12: lint と typecheck を通す**

Run: `pnpm run lint && pnpm run typecheck`
Expected: エラーなし

- [ ] **Step 13: コミットする**

```bash
git add vitest.config.ts plugins/chat-history/src/prepare-chat-recording.ts plugins/chat-history/src/__test__/prepare-chat-recording.test.ts && git commit -m "feat(chat-history): セッション開始時刻とローカル時刻変換の関数を追加する"
```

---

## Task 2: 記録先の選択をセッション単位にする

**Files:**
- Modify: `plugins/chat-history/src/prepare-chat-recording.ts`
- Modify: `plugins/chat-history/src/hooks/check-chat-recorded.ts`
- Test: `plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`

**Interfaces:**
- Consumes: `localRecordParts`, `resolveSessionStartedAt`（Task 1）
- Produces:
  - plan の確定値: `version: 2`, `recordFilePrefix: string`, `recordDate: string`, `workerName: string`, `sessionId?: string`
  - `prepare` の返り値の変更:
    - 削除: `recordCandidates`, `newRecordPathExample`, `indexLine`, `indexLineExample`
    - 改名: `indexLineFile` → `indexSummaryFile`
    - 追加: `recordFilePrefix: string`, `recordSlugExample: string`, `sessionId?: string`

- [ ] **Step 1: 新セッションが既存ファイルへ追記しない失敗テストを書く**

既存テスト「state.recordPath のファイルが無ければ単一候補判定に戻る」を次で**置き換える**。

```ts
test("新しいセッションは候補が 1 件でも既存ファイルへ追記しない", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  fs.mkdirSync(path.join(value.project, dir), { recursive: true })
  fs.writeFileSync(path.join(value.project, dir, "only.md"), "# Only\n")
  expect(prepareChatRecording(argsOf(value)).recordTarget).toEqual({
    relativePath: null,
    appendMode: false
  })
})
```

- [ ] **Step 2: フォールバックに依存している既存テストを書き換える**

既存テスト「既存 INDEX は docs/chat 相対キーで探索し例も同じ表記にする」は、記録ファイルを 1 つ置いて**フォールバックで追記対象に選ばれること**を前提にしている。フォールバックを消すとこのテストは成立しない。加えて、このテストが検証している `indexLine` と `indexLineExample` は Step 6 で返り値から削除する。

このテストを削除し、代わりに `state.recordPath` を設定して追記対象になる経路を検証する 1 本を置く。

```ts
test("同一セッションが書いたファイルは追記対象になる", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const relativePath = `${dir}/topic.md`
  fs.mkdirSync(path.join(value.project, dir), { recursive: true })
  fs.writeFileSync(
    path.join(value.project, relativePath),
    "# Existing\n\n## セッション 1\n"
  )
  setRecordPath(value, relativePath)
  const result = prepareChatRecording(argsOf(value))
  expect(result.recordTarget).toEqual({ relativePath, appendMode: true })
  expect(result.indexEntryPath).toBe(relativePath.replace(/^docs\/chat\//, ""))
})
```

`setRecordPath` はこのテストファイルに既にあるヘルパーを使う。

- [ ] **Step 3: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts -t "既存ファイルへ追記しない"`
Expected: FAIL（`relativePath` が `.../only.md`、`appendMode: true` になる）

- [ ] **Step 4: 単一候補フォールバックを削除する**

`plugins/chat-history/src/prepare-chat-recording.ts` の該当箇所を置き換える。

変更前:

```ts
  const selected =
    resumable ?? (candidates.length === 1 ? (candidates[0] as string) : null)
  const relativeCandidates = candidates.map((file) =>
    path.relative(args.project, file).replaceAll("\\", "/")
  )
```

変更後:

```ts
  // 記録先は同一セッションが既に書いたファイルだけで決める。日付ディレクトリの
  // 候補数で決めると、別セッションの記録が同じファイルへ同居する。
  const selected = resumable
```

あわせて `const candidates = markdownFiles(recordDir)` の行と `markdownFiles` 関数の定義を削除する。どこからも参照されなくなる。

- [ ] **Step 5: 日付ディレクトリの基準に関する失敗テストを書く**

**先にヘルパーを 1 つ足す。** 既存の `argsOf` は `targetLine: 1` を固定で返す一方、`setup` は plan と lock に `targetLine: lines.length` を書く。transcript を 2 行にすると `plan.targetLine`(2) と `args.targetLine`(1) が食い違い、prepare が `attempt/lock/plan mismatch` で落ちる。timestamp と本文を 1 行にまとめるヘルパーを、既存の `user` の定義のすぐ下に置く。

```ts
const userAt = (text: string, timestamp: string) =>
  JSON.stringify({ type: "user", timestamp, message: { content: text } })
```

そのうえでテストを追加する。

```ts
test("日付ディレクトリとプレフィックスはセッション開始時刻から決まる", () => {
  // 2026-08-25T21:59Z は Asia/Tokyo で 2026-08-26 06:59
  const value = setup([userAt("質問", "2026-08-25T21:59:21.651Z")])
  const result = prepareChatRecording(argsOf(value))
  expect(result.allowedNewRecordDir).toBe("docs/chat/2026/0826/unknown")
  expect(result.recordFilePrefix).toBe("0659")
  expect(result.date).toBe("2026-08-26")
})
```

`user(...)` と `argsOf(...)` はこのテストファイルの既存ヘルパーをそのまま使う。

- [ ] **Step 6: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts -t "セッション開始時刻から決まる"`
Expected: FAIL（`recordFilePrefix` が undefined、ディレクトリが今日の日付になる）

- [ ] **Step 7: セッション開始時刻を基準にする**

`prepareChatRecording` の中の日付算出を置き換える。**state へは書かない。** Stop フックが判定前に state を無条件で書くため、`prepare` が読み取り時点のスナップショットを書き戻すと、フックが更新した `attemptedLine` / `attemptId` / `transcriptIdentity` を巻き戻す。

変更前:

```ts
  const workerName = gitUser(args.project)
  const now = new Date()
  const year = String(now.getFullYear())
  const monthDay = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  const recordDir = path.join(
    args.project,
    "docs",
    "chat",
    year,
    monthDay,
    safeWorker(workerName)
  )
```

変更後:

```ts
  const workerName = gitUser(args.project)
  // プレフィックスが使われるのは新規作成の 1 回だけで、2 回目以降は
  // state.recordPath が記録先を決める。毎回計算しても実害は無く、
  // state への書き込みを増やすとフックの書き込みと後勝ちで競合する。
  const parts = localRecordParts(resolveSessionStartedAt(args.transcript))
  const recordDir = path.join(
    args.project,
    "docs",
    "chat",
    parts.year,
    parts.monthDay,
    safeWorker(workerName)
  )
```

以降で `year` / `monthDay` を使っている箇所を `parts` に置き換える。返り値の `date` は `parts.date` にする。

- [ ] **Step 8: テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts -t "セッション開始時刻から決まる"`
Expected: PASS

- [ ] **Step 9: plan の確定値と返り値を差し替える**

`AttemptPlan` インターフェースを次に変える。

```ts
interface AttemptPlan {
  version: 1 | 2
  attemptId: string
  targetLine: number
  metadataHints: string[]
  recordTarget?: { relativePath: string | null; appendMode: boolean }
  allowedNewRecordDir?: string
  recordFilePrefix?: string
  recordDate?: string
  workerName?: string
  sessionId?: string
  sessionNumber?: number
  preparedAt?: string
}
```

`atomicWriteJson(planPath, …)` を次に変える。

```ts
  atomicWriteJson(planPath, {
    ...plan,
    // フックが書く初期値は version 1。ここで明示的に上げないと commit が全件を拒否する
    version: 2,
    recordTarget,
    allowedNewRecordDir,
    recordFilePrefix: parts.hhmm,
    recordDate: parts.date,
    workerName,
    sessionId: state.sessionId,
    sessionNumber,
    preparedAt: new Date().toISOString()
  })
```

一時ファイルのパスを組む箇所で、変数名とファイル名を改名する。

変更前:

```ts
  const indexLineFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.index-line.md`
  )
```

変更後:

```ts
  const indexSummaryFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.index-summary.md`
  )
```

返り値を次のように変える。

- `recordCandidates` を削除する
- `newRecordPathExample` を削除する（`const newRecordPathExample = …` の行も削除）
- `indexLineFile` を `indexSummaryFile` に改名する
- `indexLine` を削除する（`const indexLine = …` と、その材料である `indexLines` / `indexPath` の読み込みも削除する）
- `indexLineExample` を削除する。書式の見本にはパスが含まれるため、残すと SKILL.md からパス例を消しても返り値経由で二重プレフィックスを誘導する
- 次の 3 つを加える

```ts
    recordFilePrefix: parts.hhmm,
    recordSlugExample: "conversation-topic",
    sessionId: state.sessionId,
```

`indexEntryPath` と `tailContext` はそのまま残す。

- [ ] **Step 10: フックの型定義を揃える**

`plugins/chat-history/src/hooks/check-chat-recorded.ts` の `AttemptPlan` を次に変える。フックが書くのは初期値であり `version: 1` のままでよいが、型として v2 を許すようにする。

```ts
interface AttemptPlan {
  version: 1 | 2
  attemptId: string
  targetLine: number
  metadataHints: string[]
}
```

- [ ] **Step 11: plan と返り値を検証するテストを書く**

```ts
test("plan には version 2 と確定値が書かれる", () => {
  const value = setup([userAt("質問", "2026-08-25T21:59:21.651Z")])
  prepareChatRecording(argsOf(value))
  const plan = readJson<Record<string, unknown>>(
    path.join(value.paths.planDir, `${value.sessionKey}.json`)
  )
  expect(plan?.version).toBe(2)
  expect(plan?.recordFilePrefix).toBe("0659")
  expect(plan?.recordDate).toBe("2026-08-26")
  expect(plan?.workerName).toBe("unknown")
  expect(plan).not.toHaveProperty("recordCandidates")
})

test("返り値から旧契約のフィールドが消えている", () => {
  const value = setup([user("質問")])
  const result = prepareChatRecording(argsOf(value))
  expect(result).not.toHaveProperty("recordCandidates")
  expect(result).not.toHaveProperty("newRecordPathExample")
  expect(result).not.toHaveProperty("indexLine")
  expect(result).not.toHaveProperty("indexLineExample")
  expect(result).not.toHaveProperty("indexLineFile")
  expect(result.indexSummaryFile).toEqual(expect.any(String))
  expect(result.recordSlugExample).toBe("conversation-topic")
})
```

テストファイル冒頭の import に `readJson` を足すこと。

- [ ] **Step 12: 全テストと lint / typecheck を通す**

Run: `pnpm run test && pnpm run lint && pnpm run typecheck`
Expected: PASS

削除したフィールド（`recordCandidates` / `newRecordPathExample` / `indexLine` / `indexLineExample` / `indexLineFile`）を参照している既存テストが他にあれば、この時点で落ちる。新しい契約に合わせて書き換えるか削除する。

- [ ] **Step 13: コミットする**

```bash
git add plugins/chat-history/src && git commit -m "feat(chat-history): 記録先の選択をセッション単位にする"
```

---

## Task 3: commit がパスと INDEX 行を合成する

**このタスクを分割しない理由:** `commit` は現在「chat-recorder が書いた INDEX 行に対象パスが含まれるか」を `validateInputs` の中で検証している。パス合成だけを先に入れると、パスは書き込み後に確定するのに検証は書き込み前に走るため、中間状態が成立しない。パス合成と INDEX 合成は同じタスクで入れる。

**Files:**
- Modify: `plugins/chat-history/src/commit-chat-recording.ts`
- Test: `plugins/chat-history/src/__test__/commit-chat-recording.test.ts`
- Create: `plugins/chat-history/src/__test__/commit-chat-recording-cli.test.ts`

**Interfaces:**
- Consumes: plan の `version: 2`, `recordFilePrefix`, `recordDate`, `workerName`, `allowedNewRecordDir`, `recordTarget`（Task 2）
- Produces:
  - `commitChatRecording` の引数から `recordPath` と `indexLineFile` が消え、`recordSlug?: string` と `indexSummaryFile: string` が加わる
  - CLI 引数 `--record-slug` と `--index-summary-file`（`--record-path` と `--index-line-file` は廃止）

- [ ] **Step 1: テストの `setup` を plan v2 と新しい引数に合わせる**

`plugins/chat-history/src/__test__/commit-chat-recording.test.ts` の `setup` を次のように変える。

記録先のパスを、新規時はプレフィックス付きの想定にする。

```ts
  const relativePath = appendMode
    ? "docs/chat/2026/0724/unknown/topic.md"
    : "docs/chat/2026/0724/unknown/0712-topic.md"
  const docsRelative = appendMode
    ? "2026/0724/unknown/topic.md"
    : "2026/0724/unknown/0712-topic.md"
```

plan を v2 にする。

```ts
  atomicWriteJson(path.join(paths.planDir, `${sessionKey}.json`), {
    version: 2,
    attemptId,
    targetLine: 2,
    recordTarget: {
      relativePath: appendMode ? relativePath : null,
      appendMode
    },
    allowedNewRecordDir: "docs/chat/2026/0724/unknown",
    recordFilePrefix: "0712",
    recordDate: "2026-07-24",
    workerName: "unknown",
    sessionId: "cfa925f8-d36b-4dad-8b79-47bdddf1a653",
    sessionNumber: appendMode ? 2 : 1
  })
```

`indexLineFile` を `indexSummaryFile` に差し替え、中身を要旨だけにする。

```ts
  const indexSummaryFile = path.join(paths.tempDir, "index-summary.md")
  fs.writeFileSync(indexSummaryFile, "会話の要旨\n")
```

`setup` の `return` の `indexLineFile` を `indexSummaryFile` に差し替える。

既存テストの `commitChatRecording({ … })` 呼び出しをすべて次の形に揃える。

- `indexLineFile: value.indexLineFile` → `indexSummaryFile: value.indexSummaryFile`
- `recordPath: appendMode ? undefined : value.relativePath` → `recordSlug: appendMode ? undefined : "topic"`

- [ ] **Step 2: 新しい契約と矛盾する既存テストを置き換える**

次の 2 本は新しい契約と両立しないので置き換える。

**「既存新規パスとの衝突を排他的作成で拒否する」** — `EEXIST` を失敗ではなく連番リトライで扱うようになるため、期待が逆になる。Step 3 の「同名のファイルがあれば連番を付けて新規作成する」で置き換える形にし、このテストは削除する。

**「新規パス検証エラーは prepare と同じ期待形式と実値を示す」** — 検証対象がパス全体からスラッグへ変わる。Step 3 の不正スラッグのテストで置き換える形にし、このテストは削除する。

- [ ] **Step 3: 新しい振る舞いの失敗テストを書く**

```ts
test.each([
  ["大文字を含む", "Topic"],
  ["スラッシュを含む", "dir/topic"],
  ["拡張子付き", "topic.md"],
  ["先頭が 4 桁数字", "0712-topic"],
  ["4 桁数字のみ", "0712"],
  ["連続ハイフン", "topic--name"],
  ["長さ超過", "a".repeat(81)]
])("不正なスラッグ(%s)を拒否する", (_label, slug) => {
  const value = setup(false)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: slug
    })
  ).toThrow(/record slug/)
})

test("新規記録でスラッグが無ければ失敗する", () => {
  const value = setup(false)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile
    })
  ).toThrow(/--record-slug is required/)
})

test("スラッグからプレフィックス付きのパスを合成する", () => {
  const value = setup(false)
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(result.recordPath).toBe("docs/chat/2026/0724/unknown/0712-topic.md")
})

test("追記時は recordSlug を無視して plan のパスへ書く", () => {
  const value = setup(true)
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    recordSlug: "ignored-slug"
  })
  expect(result.recordPath).toBe("docs/chat/2026/0724/unknown/topic.md")
})

test("plan の version が 2 でなければ拒否する", () => {
  const value = setup(false)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, { ...plan, version: 1 })
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow(/plan schema version/)
})

test.each(["recordFilePrefix", "recordDate", "workerName"])(
  "plan の確定値 %s が欠けていれば拒否する",
  (field) => {
    const value = setup(false)
    const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
    const plan = readJson<Record<string, unknown>>(planPath) ?? {}
    delete plan[field]
    atomicWriteJson(planPath, plan)
    expect(() =>
      commitChatRecording({
        project: value.project,
        sessionKey: value.sessionKey,
        attemptId: value.attemptId,
        targetLine: 2,
        bodyFile: value.bodyFile,
        indexSummaryFile: value.indexSummaryFile,
        sessionTitleFile: value.sessionTitleFile,
        headerFile: value.headerFile,
        recordSlug: "topic"
      })
    ).toThrow()
  }
)

test("INDEX 行を plan の確定値と要旨から合成する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  const index = fs.readFileSync(
    path.join(value.project, "docs/chat/INDEX.md"),
    "utf8"
  )
  expect(index).toContain(
    "- `2026/0724/unknown/0712-topic.md` | 2026-07-24 | unknown | 会話の要旨"
  )
})

test.each([
  ["区切り文字を含む", "要旨 | 追加"],
  ["空", ""]
])("不正な要旨(%s)を拒否する", (_label, summary) => {
  const value = setup(false)
  fs.writeFileSync(value.indexSummaryFile, `${summary}\n`)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow(/INDEX summary/)
})

test("追記時は既存の INDEX 行を再合成して置き換える", () => {
  const value = setup(true)
  const indexPath = path.join(value.project, "docs/chat/INDEX.md")
  fs.writeFileSync(
    indexPath,
    `# Chat Records Index\n\n- \`${value.docsRelative}\` | 2026-07-24 | unknown | 古い要旨\n`
  )
  fs.writeFileSync(value.indexSummaryFile, "新しい要旨\n")
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })
  const index = fs.readFileSync(indexPath, "utf8")
  expect(index).toContain("新しい要旨")
  expect(index).not.toContain("古い要旨")
  expect(
    index.split("\n").filter((line) => line.includes(value.docsRelative))
  ).toHaveLength(1)
})

test("同名のファイルがあれば連番を付けて新規作成する", () => {
  const value = setup(false)
  const taken = path.join(
    value.project,
    "docs/chat/2026/0724/unknown/0712-topic.md"
  )
  fs.mkdirSync(path.dirname(taken), { recursive: true })
  fs.writeFileSync(taken, "do not replace")
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(result.recordPath).toBe("docs/chat/2026/0724/unknown/0712-topic-2.md")
  expect(fs.readFileSync(taken, "utf8")).toBe("do not replace")
})

// 連番へ逃げたあと INDEX 検証で落ちたとき、消すのは自分が作った連番ファイルであり、
// 衝突していた既存ファイル(別セッションの記録)を触ってはならない。
test("連番で作成したあと失敗したら、連番ファイルだけを消す", () => {
  const value = setup(false)
  const taken = path.join(
    value.project,
    "docs/chat/2026/0724/unknown/0712-topic.md"
  )
  fs.mkdirSync(path.dirname(taken), { recursive: true })
  fs.writeFileSync(taken, "do not replace")
  // INDEX に重複行を仕込んで検証を失敗させる
  const docsRelative = "2026/0724/unknown/0712-topic-2.md"
  fs.writeFileSync(
    path.join(value.project, "docs/chat/INDEX.md"),
    `# Chat Records Index\n\n- \`${docsRelative}\` | 2026-07-24 | unknown | 1\n- \`${docsRelative}\` | 2026-07-24 | unknown | 2\n`
  )
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow()
  expect(fs.readFileSync(taken, "utf8")).toBe("do not replace")
  expect(
    fs.existsSync(
      path.join(value.project, "docs/chat/2026/0724/unknown/0712-topic-2.md")
    )
  ).toBe(false)
})
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording.test.ts`
Expected: FAIL（`recordSlug` / `indexSummaryFile` が引数型に存在しない）

- [ ] **Step 5: 引数と型を差し替える**

`Args` を変える。

```ts
interface Args {
  project: string
  sessionKey: string
  attemptId: string
  targetLine: number
  bodyFile: string
  indexSummaryFile: string
  sessionTitleFile: string
  headerFile?: string
  recordSlug?: string
}
```

`AttemptPlan` を変える。

```ts
interface AttemptPlan {
  version: 2
  attemptId: string
  targetLine: number
  recordTarget: { relativePath: string | null; appendMode: boolean }
  allowedNewRecordDir: string
  recordFilePrefix: string
  recordDate: string
  workerName: string
  sessionId?: string
  sessionNumber: number
}
```

`parseArgs` の該当行を差し替える。

```ts
    indexSummaryFile: path.resolve(value("--index-summary-file") as string),
    …
    recordSlug: value("--record-slug", true)
```

定数を差し替える。

```ts
const MAX_INDEX_SUMMARY_BYTES = 8192
const MAX_SLUG_LENGTH = 80
```

`validKebabMarkdown` を削除し、スラッグ検証を追加する。

```ts
// 先頭 4 桁数字を弾くのは二重プレフィックス対策。SKILL.md の全文が skillContract
// として chat-recorder へ渡るため、パス例を見た LLM がスラッグ自体へ "0712-" を
// 入れると 0712-0712-topic.md が検証を素通りしてしまう。
// ハイフンを伴わない "0712" 単体も弾く(0712-0712.md になる)。
function validSlug(value: string): boolean {
  if (!value || value.length > MAX_SLUG_LENGTH) return false
  if (/^\d{4}($|-)/.test(value)) return false
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}
```

INDEX 行の合成関数を `docsRelativePath` の下に追加する。

```ts
function composeIndexLine(
  relativePath: string,
  date: string,
  worker: string,
  summary: string
): string {
  return `- \`${docsRelativePath(relativePath)}\` | ${date} | ${worker} | ${summary}`
}
```

- [ ] **Step 6: `validateInputs` を書き換える**

返り値の型を変える。

```ts
function validateInputs(
  args: Args,
  paths: ReturnType<typeof getStatePaths>,
  plan: AttemptPlan
): {
  /** 追記時は確定パス 1 件、新規時は EEXIST のときに順に試す候補 */
  candidates: string[]
  body: string
  summary: string
} {
```

`temporaryFiles` の `args.indexLineFile` を `args.indexSummaryFile` へ差し替える。

INDEX 行の検証を要旨の検証へ差し替える。

変更前:

```ts
  const indexLine = fs.readFileSync(args.indexLineFile, "utf8").trim()
```

変更後:

```ts
  const summary = fs.readFileSync(args.indexSummaryFile, "utf8").trim()
```

変更前:

```ts
  if (
    !indexLine ||
    indexLine.includes("\n") ||
    Buffer.byteLength(indexLine) > MAX_INDEX_LINE_BYTES
  )
    fail("INDEX entry must be exactly one bounded line")
```

変更後:

```ts
  if (
    !summary ||
    summary.includes("\n") ||
    // find-chat-records は INDEX 行を " | " で分解して要旨を取り出す。
    // 要旨に区切り文字が混ざると検索結果の表示が壊れる。
    summary.includes("|") ||
    Buffer.byteLength(summary) > MAX_INDEX_SUMMARY_BYTES
  )
    fail("INDEX summary must be exactly one bounded line without '|'")
```

plan の検証を、`sessionNumber` の検証の直前に足す。バージョンだけでなく、合成に使う確定値の欠落も個別に見る。欠けたまま合成すると `undefined-slug.md` や `| undefined |` を静かに書いてしまう。

```ts
  if (plan.version !== 2)
    fail(
      `plan schema version mismatch: expected 2, got ${String(plan.version)}`
    )
  for (const field of [
    "allowedNewRecordDir",
    "recordFilePrefix",
    "recordDate",
    "workerName"
  ] as const)
    if (typeof plan[field] !== "string" || !plan[field])
      fail(`plan.${field} is missing`)
```

パス決定部分を置き換える。

変更前:

```ts
  let relativePath: string
  if (plan.recordTarget.relativePath !== null) {
    if (args.recordPath)
      fail("--record-path is forbidden for an existing target")
    relativePath = plan.recordTarget.relativePath
  } else {
    const requestedPath = args.recordPath
    if (!requestedPath)
      throw new Error("--record-path is required for a new target")
    relativePath = requestedPath.replaceAll("\\", "/")
    if (
      path.posix.dirname(relativePath) !== plan.allowedNewRecordDir ||
      !validKebabMarkdown(path.posix.basename(relativePath))
    )
      fail(
        `new record path violates the naming or directory contract: expected ${plan.allowedNewRecordDir}/<kebab-case>.md, got ${relativePath}`
      )
  }
  const recordPath = path.resolve(args.project, relativePath)
  if (!isInside(args.project, recordPath)) fail("record path escapes project")
  const docsRelative = docsRelativePath(relativePath)
  if (!indexLine.includes(docsRelative))
    fail(
      `INDEX entry does not reference the target record: expected docs/chat-relative path ${docsRelative}`
    )
  return { recordPath, relativePath, body, indexLine }
```

変更後:

```ts
  // 追記時はパスが plan で確定している。--record-slug が付いていても無視する。
  // 拒否にすると、chat-recorder が習慣的にスラッグを付けただけで追記が落ちる。
  let candidates: string[]
  if (plan.recordTarget.relativePath !== null) {
    candidates = [plan.recordTarget.relativePath]
  } else {
    const slug = args.recordSlug
    if (!slug) throw new Error("--record-slug is required for a new target")
    if (!validSlug(slug))
      fail(
        `record slug violates the naming contract: expected at most ${MAX_SLUG_LENGTH} chars of [a-z0-9-] not starting with 4 digits, got ${slug}`
      )
    const base = `${plan.allowedNewRecordDir}/${plan.recordFilePrefix}-${slug}`
    candidates = [`${base}.md`]
    for (let suffix = 2; suffix <= 9; suffix++)
      candidates.push(`${base}-${suffix}.md`)
  }
  for (const candidate of candidates)
    if (!isInside(args.project, path.resolve(args.project, candidate)))
      fail("record path escapes project")
  return { candidates, body, summary }
```

- [ ] **Step 7: 書き込みとロールバックを書き換える**

`commitChatRecording` の書き込み部を次に変える。**新規時は `oldRecordExisted` を必ず false に保つ。** 衝突していた既存ファイルのサイズを掴んでしまうと、ロールバックで他セッションのファイルを truncate する。

```ts
  const indexPath = path.join(args.project, "docs", "chat", "INDEX.md")
  const indexExisted = fs.existsSync(indexPath)
  const oldIndex = indexExisted ? fs.readFileSync(indexPath, "utf8") : ""
  let relativePath = ""
  let recordPath = ""
  let oldRecordExisted = false
  let oldSize = 0
  let bodyUpdated = false
  try {
    if (plan.recordTarget.appendMode) {
      relativePath = input.candidates[0] as string
      recordPath = path.resolve(args.project, relativePath)
      if (!fs.existsSync(recordPath)) fail("append target disappeared")
      oldRecordExisted = true
      oldSize = fs.statSync(recordPath).size
      fs.appendFileSync(recordPath, input.body)
    } else {
      // 同じ分に始まった別セッションが同じスラッグを選んだときだけ衝突する。
      // 連番は 2 から始める(サフィックス無しが実質の 1 番目)。
      // ここで作ったファイルは oldRecordExisted=false のままなので、
      // ロールバックでは truncate ではなく削除になる。
      let written = false
      for (const candidate of input.candidates) {
        const absolute = path.resolve(args.project, candidate)
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        try {
          fs.writeFileSync(absolute, input.body, {
            encoding: "utf8",
            flag: "wx"
          })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
          // EEXIST 以外(ENOSPC 等)では部分作成が残りうるので消してから投げる
          fs.rmSync(absolute, { force: true })
          throw error
        }
        relativePath = candidate
        recordPath = absolute
        written = true
        break
      }
      if (!written) fail("every candidate record path is already taken")
    }
    bodyUpdated = true

    const indexLine = composeIndexLine(
      relativePath,
      plan.recordDate,
      plan.workerName,
      input.summary
    )
    const lines = indexExisted
      ? (oldIndex.endsWith("\n") ? oldIndex.slice(0, -1) : oldIndex).split("\n")
      : ["# Chat Records Index", ""]
    const matches = indexMatches(lines, relativePath)
    if (matches.length > 1) fail("INDEX contains duplicate target entries")
    if (matches.length === 1) lines[matches[0] as number] = indexLine
    else insertIndexLine(lines, indexLine, relativePath)
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, `${lines.join("\n")}\n`, "utf8")
```

以降の検証・状態確定でも `input.relativePath` / `input.recordPath` を `relativePath` / `recordPath` に置き換える。成功時の一時ファイル削除リストの `args.indexLineFile` を `args.indexSummaryFile` へ差し替える。

`catch` 節のロールバックを次に変える。パス確定前に失敗した場合（`recordPath` が空文字）は記録ファイルを触らない。

```ts
    let manualRepairRequired = false
    if (bodyUpdated && recordPath) {
      try {
        if (oldRecordExisted) fs.truncateSync(recordPath, oldSize)
        else fs.rmSync(recordPath, { force: true })
        if (indexExisted) fs.writeFileSync(indexPath, oldIndex, "utf8")
        else fs.rmSync(indexPath, { force: true })
      } catch {
        manualRepairRequired = true
      }
    }
```

`lastError` に入れる `recordPath: input.relativePath` を `recordPath: relativePath` に置き換える。

- [ ] **Step 8: テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording.test.ts`
Expected: PASS

- [ ] **Step 9: CLI を踏むテストを新規作成する**

`plugins/chat-history/src/__test__/commit-chat-recording-cli.test.ts` を作る。上のテストはすべて `commitChatRecording()` を直接呼ぶため、`parseArgs` のフラグ名を差し替え忘れても緑になる。本番経路は chat-recorder が CLI を叩く経路だけであり、フラグ名そのものが契約である。

```ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, test } from "vitest"
import {
  atomicWriteJson,
  createInitialState,
  ensureStateDirs,
  getStatePaths,
  type RecordingLock
} from "../chat-recording-state.js"
import { runTs } from "../../src/testing/run-ts.js"

const SCRIPT = fileURLToPath(
  new URL("../commit-chat-recording.ts", import.meta.url)
)

const roots: string[] = []
const previousStateRoot = process.env.TASK_UTILITY_CHAT_STATE_DIR

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
  if (previousStateRoot === undefined)
    delete process.env.TASK_UTILITY_CHAT_STATE_DIR
  else process.env.TASK_UTILITY_CHAT_STATE_DIR = previousStateRoot
})

test("CLI は --record-slug と --index-summary-file で新規記録を作る", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-cli-"))
  roots.push(root)
  const project = path.join(root, "project")
  fs.mkdirSync(path.join(project, "docs", "chat"), { recursive: true })
  const stateRoot = path.join(root, "state")
  process.env.TASK_UTILITY_CHAT_STATE_DIR = stateRoot
  const sessionKey = "session"
  const attemptId = "attempt"
  const transcript = path.join(project, "transcript.jsonl")
  fs.writeFileSync(transcript, "{}\n")
  const paths = getStatePaths(project, sessionKey)
  ensureStateDirs(paths)
  atomicWriteJson(paths.statePath, {
    ...createInitialState(project, transcript, { dev: 1, ino: 1 }),
    attemptId,
    attemptedLine: 2
  })
  atomicWriteJson(paths.lockPath, {
    version: 2,
    attemptId,
    targetLine: 2,
    createdAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  } satisfies RecordingLock)
  atomicWriteJson(path.join(paths.planDir, `${sessionKey}.json`), {
    version: 2,
    attemptId,
    targetLine: 2,
    recordTarget: { relativePath: null, appendMode: false },
    allowedNewRecordDir: "docs/chat/2026/0724/unknown",
    recordFilePrefix: "0712",
    recordDate: "2026-07-24",
    workerName: "unknown",
    sessionId: "cfa925f8-d36b-4dad-8b79-47bdddf1a653",
    sessionNumber: 1
  })
  const bodyFile = path.join(paths.tempDir, "body.md")
  const indexSummaryFile = path.join(paths.tempDir, "index-summary.md")
  const sessionTitleFile = path.join(paths.tempDir, "session-title.md")
  const headerFile = path.join(paths.tempDir, "header.md")
  fs.writeFileSync(bodyFile, "# unknown\n\n> 質問\n\n# AI\n\n回答\n")
  fs.writeFileSync(indexSummaryFile, "会話の要旨\n")
  fs.writeFileSync(sessionTitleFile, "話題の要旨\n")
  fs.writeFileSync(headerFile, "# New\n\n- 日付: 2026-07-24\n")

  const out = JSON.parse(
    runTs(SCRIPT, [
      "--project", project,
      "--session-key", sessionKey,
      "--attempt-id", attemptId,
      "--target-line", "2",
      "--body-file", bodyFile,
      "--index-summary-file", indexSummaryFile,
      "--session-title-file", sessionTitleFile,
      "--header-file", headerFile,
      "--record-slug", "topic"
    ])
  )
  expect(out.ok).toBe(true)
  expect(out.recordPath).toBe("docs/chat/2026/0724/unknown/0712-topic.md")
  expect(
    fs.existsSync(
      path.join(project, "docs/chat/2026/0724/unknown/0712-topic.md")
    )
  ).toBe(true)
})
```

`runTs` の引数の渡し方は `find-chat-records.test.ts` の使い方に合わせること。

- [ ] **Step 10: CLI テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording-cli.test.ts`
Expected: PASS

- [ ] **Step 11: 全テストと lint / typecheck を通す**

Run: `pnpm run test && pnpm run lint && pnpm run typecheck`
Expected: PASS

- [ ] **Step 12: コミットする**

```bash
git add plugins/chat-history/src && git commit -m "feat(chat-history): commit がファイル名と INDEX 行を合成する"
```

---

## Task 4: 記録ファイルへ session_id を刻む

**Files:**
- Modify: `plugins/chat-history/src/commit-chat-recording.ts`
- Test: `plugins/chat-history/src/__test__/commit-chat-recording.test.ts`

**Interfaces:**
- Consumes: plan の `sessionId`（Task 2）、`setup` の新形式（Task 3）
- Produces: 新規記録のヘッダー末尾に `- セッション ID: <sessionId>` の 1 行

- [ ] **Step 1: 失敗テストを書く**

```ts
test("新規記録のヘッダー末尾にセッション ID を刻む", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  const record = fs.readFileSync(
    path.join(value.project, "docs/chat/2026/0724/unknown/0712-topic.md"),
    "utf8"
  )
  expect(record).toContain(
    "- セッション ID: cfa925f8-d36b-4dad-8b79-47bdddf1a653"
  )
  // 区切り行より前(ヘッダー内)にあること
  expect(record.indexOf("- セッション ID:")).toBeLessThan(record.indexOf("---"))
})

// 追記対象のファイルは、新規作成時に既にセッション ID を持っている。
// 追記のたびに足すと同じ行が積み上がる。
test("追記時はセッション ID を書かない", () => {
  const value = setup(true)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).not.toContain(
    "- セッション ID:"
  )
})

test.each([
  ["改行を含む", "abc\ndef"],
  ["長すぎる", "x".repeat(200)]
])("不正なセッション ID(%s)なら行を足さない", (_label, sessionId) => {
  const value = setup(false)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, { ...plan, sessionId })
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  const record = fs.readFileSync(
    path.join(value.project, "docs/chat/2026/0724/unknown/0712-topic.md"),
    "utf8"
  )
  expect(record).not.toContain("- セッション ID:")
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording.test.ts -t "セッション ID"`
Expected: FAIL（記録に該当行が無い）

- [ ] **Step 3: ヘッダー合成を実装する**

定数を足す。

```ts
const MAX_SESSION_ID_LENGTH = 128
```

`validateInputs` の本文合成部を次に変える。

変更前:

```ts
  const heading = `## セッション ${plan.sessionNumber}: ${sessionTitle}`
  const body = plan.recordTarget.appendMode
    ? `\n${heading}\n\n${rawBody}`
    : `${header.trimEnd()}\n\n---\n\n${heading}\n\n${rawBody}`
```

変更後:

```ts
  const heading = `## セッション ${plan.sessionNumber}: ${sessionTitle}`
  // state を失ったセッションや --fork-session で分岐したセッションを後から
  // 突き合わせられるよう、記録ファイル自身に session_id を残す。
  // 改行を含む値をそのまま埋めるとヘッダーの箇条書き構造が壊れるため、
  // 妥当でない値のときは行を足さない。
  const sessionId = plan.sessionId
  const usableSessionId =
    typeof sessionId === "string" &&
    sessionId.trim() !== "" &&
    !/[\r\n]/.test(sessionId) &&
    sessionId.length <= MAX_SESSION_ID_LENGTH
      ? sessionId
      : null
  const headerWithSession = usableSessionId
    ? `${header.trimEnd()}\n- セッション ID: ${usableSessionId}`
    : header.trimEnd()
  const body = plan.recordTarget.appendMode
    ? `\n${heading}\n\n${rawBody}`
    : `${headerWithSession}\n\n---\n\n${heading}\n\n${rawBody}`
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording.test.ts -t "セッション ID"`
Expected: PASS

- [ ] **Step 5: 全テストと lint / typecheck を通す**

Run: `pnpm run test && pnpm run lint && pnpm run typecheck`
Expected: PASS

- [ ] **Step 6: コミットする**

```bash
git add plugins/chat-history/src && git commit -m "feat(chat-history): 記録ファイルへセッション ID を刻む"
```

---

## Task 5: recall の検索結果を新しい順にする

**Files:**
- Modify: `plugins/chat-history/src/find-chat-records.ts`
- Test: `plugins/chat-history/src/__test__/find-chat-records.test.ts`

**Interfaces:**
- Consumes: なし（他タスクから独立）
- Produces: index モードの `hits` が日付降順・同日 mtime 降順で返る

- [ ] **Step 1: 失敗テストを書く**

このファイルの既存ヘルパー `fixture(files, index)` と `runScript(args)` を使う。日付違いだけのテストでは「配列を単に逆順にした」実装でも通ってしまうため、同日 mtime 降順も一緒に固定する。

```ts
test("index モード: hits は日付の新しい順で返る", () => {
  const dir = fixture(
    {
      "2026/0724/unknown/old.md": "# 古い記録\n",
      "2026/0826/unknown/new.md": "# 新しい記録\n"
    },
    [
      "# Chat Records Index",
      "",
      "- `2026/0724/unknown/old.md` | 2026-07-24 | unknown | キーワードの古い記録",
      "- `2026/0826/unknown/new.md` | 2026-08-26 | unknown | キーワードの新しい記録",
      ""
    ].join("\n")
  )
  const out = runScript(["--dir", dir, "キーワード"])
  expect(out.ok).toBe(true)
  expect(out.mode).toBe("index")
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual([
    "2026/0826/unknown/new.md",
    "2026/0724/unknown/old.md"
  ])
})

test("index モード: 同日は mtime の新しい順で返る", () => {
  const dir = fixture(
    {
      "2026/0826/unknown/a-first.md": "# 先\n",
      "2026/0826/unknown/b-second.md": "# 後\n"
    },
    [
      "# Chat Records Index",
      "",
      "- `2026/0826/unknown/a-first.md` | 2026-08-26 | unknown | キーワード先",
      "- `2026/0826/unknown/b-second.md` | 2026-08-26 | unknown | キーワード後",
      ""
    ].join("\n")
  )
  // a-first を新しく見せる(パス昇順とは逆順になる)
  const older = new Date("2026-08-26T01:00:00Z")
  const newer = new Date("2026-08-26T02:00:00Z")
  fs.utimesSync(
    path.join(dir, "docs", "chat", "2026/0826/unknown/b-second.md"),
    older,
    older
  )
  fs.utimesSync(
    path.join(dir, "docs", "chat", "2026/0826/unknown/a-first.md"),
    newer,
    newer
  )
  const out = runScript(["--dir", dir, "キーワード"])
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual([
    "2026/0826/unknown/a-first.md",
    "2026/0826/unknown/b-second.md"
  ])
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/find-chat-records.test.ts -t "index モード"`
Expected: FAIL（INDEX の行順、つまりパス昇順で返る）

- [ ] **Step 3: index モードにソートを入れる**

`plugins/chat-history/src/find-chat-records.ts` の index モードを次に変える。`byPath` は同じブロックの直前で `const byPath = new Map(records.map((r) => [r.path, r]))` として定義済みのものを使う。

変更前:

```ts
  for (const line of indexLines) {
    const p = line.match(/^- `([^`]+)`/)?.[1]
    const r = p ? byPath.get(p) : null
    if (!r || !inScope(r) || !hasKw(line)) continue
    const summary = line.split(" | ")[3]?.trim() ?? null
    hits.push({
      path: r.path,
      date: r.date,
      user: r.user,
      title: summary,
      matches: [line]
    })
  }
  output({ ok: true, mode: "index", hits, unindexed })
```

変更後:

```ts
  const indexHits: { abs: string; hit: (typeof hits)[number] }[] = []
  for (const line of indexLines) {
    const p = line.match(/^- `([^`]+)`/)?.[1]
    const r = p ? byPath.get(p) : null
    if (!r || !inScope(r) || !hasKw(line)) continue
    const summary = line.split(" | ")[3]?.trim() ?? null
    indexHits.push({
      abs: r.abs,
      hit: {
        path: r.path,
        date: r.date,
        user: r.user,
        title: summary,
        matches: [line]
      }
    })
  }
  // INDEX はパス昇順(=古い順)に並ぶ。recall は上位 15 件を新しい順で使う契約なので、
  // ここで並べ替えないと、キャップに掛かったとき新しい記録から落ちる。
  indexHits.sort(
    (a, b) =>
      b.hit.date.localeCompare(a.hit.date) || mtimeOf(b.abs) - mtimeOf(a.abs)
  )
  output({
    ok: true,
    mode: "index",
    hits: indexHits.map((entry) => entry.hit),
    unindexed
  })
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run plugins/chat-history/src/__test__/find-chat-records.test.ts`
Expected: PASS

- [ ] **Step 5: lint と typecheck を通す**

Run: `pnpm run lint && pnpm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミットする**

```bash
git add plugins/chat-history/src && git commit -m "fix(chat-history): index モードの検索結果を新しい順で返す"
```

---

## Task 6: 指示層・文書・バージョン・バンドルを同一コミットで揃える

**このタスクをまとめる理由:** 本番の記録経路は chat-recorder（Agent 定義）が `scripts/*.mjs` を CLI で叩く経路だけである。Agent 定義とバンドルのどちらか片方だけが新契約になると、次の Stop フックで引数不足により記録が失敗する。失敗時点で `attemptedLine` は既に上がっているため同じターンでは再試行されない。このリポジトリはブランチを切らず `docs/chat/` を持つため、実装中の会話自身がこの不整合を踏む。両者は必ず同じコミットに入れる。

**Files:**
- Modify: `plugins/chat-history/skills/chat/SKILL.md`
- Modify: `plugins/chat-history/agents/chat-recorder.md`
- Modify: `plugins/chat-history/README.md`
- Modify: `plugins/chat-history/docs/rationale.md`
- Modify: `plugins/chat-history/.claude-plugin/plugin.json`
- Modify: `plugins/chat-history/package.json`
- Modify: `plugins/chat-history/scripts/`（ビルド生成物）

**Interfaces:**
- Consumes: Task 1〜5 のすべて
- Produces: 配布可能な状態

- [ ] **Step 1: SKILL.md の「保存場所」節を書き換える**

```markdown
## 保存場所

- パス: `docs/chat/YYYY/MMDD/<作業者名>/<時刻>-<内容を表すケバブケース名>.md`
- `YYYY/MMDD` と `<時刻>` はセッション開始時刻(ローカル)から**スクリプトが決める**。chat-recorder が決めるのはケバブケースのトピック名だけで、時刻やディレクトリは組み立てない
- `<作業者名>` は git のユーザー名(`git config user.name` の値)。取得できない場合は必ず本人に確認する
- **1 ファイル = 1 Claude Code セッション**。既存ファイルへ追記するのは、同じセッションが続いている場合に限る。記録先はスクリプトが判定するため、AI が選ぶことはない
- トピックが同じでもセッションが違えば別ファイルになる
- `--resume` / `--continue` による再開は同じセッションとして扱われ、同じファイルへ追記が続く
```

**プレフィックスを含む具体的なパス例をこの節に書かないこと。** この SKILL.md の全文は `skillContract` として chat-recorder へ渡るため、`0712-topic.md` のような例を書くとトピック名自体に時刻を入れてしまう。

- [ ] **Step 2: SKILL.md の「索引(INDEX.md)」節を書き換える**

```markdown
- 各行の形式: パス(`docs/chat/` からの相対、バッククォート囲み)| 日付 | 作業者名 | 要旨 1 行
- **行を組み立てるのはスクリプトである。** chat-recorder が書くのは要旨の 1 行だけで、パス・日付・作業者名は書かない
- 要旨に `|` と改行を含めない(検索時の分解が壊れる)
- 記録ファイルを作成・追記すると、対応する行が追加または更新される
- 既存ファイルへの追記では既存行が再合成されて置き換わる(行を増やさない。1 ファイル 1 行の不変条件)
- 並び順はパス昇順。他の記録の行には触れない
```

節の冒頭にある INDEX の例（コードブロック）はそのまま残してよい。chat-recorder はパスを書かないため、二重プレフィックスの原因にならない。

- [ ] **Step 3: SKILL.md の「ファイルの構成」節に注記を足す**

```markdown
2. **本文**: `## セッション N: <要旨>` で区切り、各ターンを `# <ユーザー名>` / `# AI` の見出しで記録する
   - この `N` は**同一ファイル内の追記回**であり、Claude Code のセッション番号ではない。1 ファイルは 1 セッションに対応するため、`N` はそのセッション内で記録を追記した回数を数える
   - ヘッダーの箇条書き末尾には、スクリプトが `- セッション ID: <session_id>` を追加する。AI はこの行を書かない
```

- [ ] **Step 4: chat-recorder.md の手順 2 / 3 / 4 を書き換える**

手順 2:

```markdown
2. JSON の `skillContract`、`conversation`、`recordTarget`、`sessionNumber`、`tailContext`、`indexEntryPath`、`recordSlugExample`、`metadataHints` に厳密に従い、次を作る
   - セッション要旨 1 行
   - INDEX の要旨 1 行。パス・日付・作業者名は書かない(スクリプトが付ける)。`|` と改行を含めない
   - `recordTarget.appendMode=false` のときだけ、ヘッダー(`# <題名>` とメタ情報の箇条書き)。`- セッション ID:` の行は書かない(スクリプトが付ける)
   - `recordTarget.relativePath=null` のときだけ、内容を表すケバブケースのトピック名。`recordSlugExample` と同じ形式にする。**ディレクトリ・時刻のプレフィックス・拡張子を含めない**。先頭を 4 桁の数字にしない
```

手順 3:

```markdown
3. 手順 1 の JSON の `sessionTitleFile` と `indexSummaryFile` へ、セッション要旨と INDEX の要旨をそれぞれ Write する。`recordTarget.appendMode=false` のときは `headerFile` へヘッダーも Write する。それ以外のファイルを Write しない
```

手順 4 の冒頭にある `<indexLineFile>` への言及を `<indexSummaryFile>` へ置き換え、2 つのコマンドを次に変える。

追記時(`recordTarget.appendMode=true`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-chat-recording.mjs" --project "<projectDir>" --session-key "<sessionKey>" --attempt-id "<attemptId>" --target-line <targetLine> --body-file "<bodyFile>" --index-summary-file "<indexSummaryFile>" --session-title-file "<sessionTitleFile>"
```

新規記録時(`recordTarget.appendMode=false`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-chat-recording.mjs" --project "<projectDir>" --session-key "<sessionKey>" --attempt-id "<attemptId>" --target-line <targetLine> --body-file "<bodyFile>" --index-summary-file "<indexSummaryFile>" --session-title-file "<sessionTitleFile>" --header-file "<headerFile>" --record-slug "<手順 2 で決めたトピック名>"
```

- [ ] **Step 5: README の chat スキルの節を更新する**

「## chat スキル」の節を次に置き換える。

```markdown
## chat スキル

会話を `docs/chat/YYYY/MMDD/<作業者名>/<時刻>-<トピック>.md`(作業者名は git のユーザー名)に永続記録する。**記録ファイルは 1 Claude Code セッションにつき 1 つ**で、日付ディレクトリとファイル名の時刻プレフィックスはセッション開始時刻から決まる。`--resume` / `--continue` による再開は同じセッションとして扱われ、同じファイルへ追記が続く。

2026-08-16 以降の記録はユーザー発言・AI発言ともに transcript の原文をそのまま残し、要約を挟まない(Tool の使用記録と思考ブロックは含まれない)。それより前の記録は AI発言が構造化要約になっている。2026-08-26 より前の記録は 1 ファイルに複数セッションが同居している場合がある。粒度契約の正本は `skills/chat/SKILL.md` を参照。
```

「## 会話の自動記録」節の「記録処理」の項目を次に置き換える。

```markdown
- **記録処理**: chat-recorder は `prepare-chat-recording.mjs` による入力収集、一時ファイルへの Write、`commit-chat-recording.mjs` による追記・INDEX 更新・検証・状態確定を行う。記録先のパス・INDEX 行・ヘッダーのセッション ID 行はスクリプトが合成し、chat-recorder が書くのはセッション要旨・INDEX の要旨・トピック名・ヘッダー本体だけである
```

- [ ] **Step 6: rationale.md に分割軸の節を追加する**

「## chat: 本文を chat-recorder に書かせない理由」の節の後に、次の節を追加する。

```markdown
## chat: 記録先をセッション単位にした理由

記録ファイルの分割軸は、当初トピックだった。SKILL.md は「同じ成果物・同じ目的の作業を続けるときは既存ファイルへ追記する」と規定していたが、「同じ目的か」を判定できるのは LLM だけであり、判定は揺れる。

記録先の決定を LLM から外す方針との整合を取るため、`prepare-chat-recording` は「その日・その作業者のディレクトリに記録が 1 件だけなら、それに追記する」という機械的な近似を置いた。その結果、別の Claude Code セッションの会話が同じファイルへ同居するようになった。2026-08-26 の `docs/chat/2026/0826/phyllis998/agent-policy-codex-model-setup.md` には、`session_id` の異なる 5 セッションの会話が入っている。

同居は記録の断片化にとどまらなかった。`prepare` は記録ファイル全文から最後のセッション番号を読んで次の番号を決めるため、別々のセッションが同時に同じファイルを読むと同じ番号を振る。上記のファイルには `## セッション 16` と `## セッション 19` がそれぞれ 2 つある。ロックはセッション単位に掛かるため、ファイルを共有している間はこの競合を防げない。

2026-08-26 に分割軸をセッションへ変えた。セッションは `session_id` で機械的に判定でき、状態ファイルは以前からセッション単位に分かれていた。判定に必要な情報は揃っており、記録先の選択で使っていないだけだった。

ファイル名は `<セッション開始時刻の HHMM>-<トピック>.md` とし、プレフィックスと日付ディレクトリを `prepare` が確定する。chat-recorder が決めるのはトピックのスラッグだけである。プレフィックスまで LLM に組ませると「付け忘れる」「別の時刻を書く」経路が残り、検証で弾かれるたびに記録が次ターンへ持ち越されるためである。

スラッグの検証は先頭 4 桁数字を拒否する。SKILL.md の全文は `skillContract` として chat-recorder へ渡るため、SKILL.md にプレフィックス付きのパス例を書くと、LLM がスラッグ自体に時刻を入れて `0712-0712-topic.md` を作る。基本のケバブケース検証は数字を許すためこれを素通りさせてしまい、検証に落ちないので静かに歪む。同じ理由で、`prepare` の返り値からも INDEX 行の書式見本(`indexLineExample`)を外した。見本にはパスが含まれるため、SKILL.md から例を消しても返り値経由で同じ誘導が残る。

セッション開始時刻は状態ファイルへ保存せず、記録のたびに transcript から計算する。当初は「再試行のたびに値が動かないよう state へ 1 回だけ書く」設計だったが、Stop フックが記録の要否を判定する前に state を無条件で書き戻すため、`prepare` が読み取り時点のスナップショットを書くとフック側の更新を巻き戻す。プレフィックスが使われるのは新規作成の 1 回だけであり、保存しなくても実害は小さい。

既存の同居ファイルは移行していない。過去の記録を改変しないためである。`find-chat-records.mjs` はパス構造から日付と作業者を読み、ファイル名には依存しないため、旧形式の記録も従来どおり検索できる。
```

- [ ] **Step 7: バージョンを上げる**

`plugins/chat-history/.claude-plugin/plugin.json` と `plugins/chat-history/package.json` の `version` を `0.7.0` から `0.8.0` にする。両者を同じ値に揃える。

- [ ] **Step 8: 旧契約への参照が残っていないことを確認する**

Run: `grep -rn "record-path\|index-line-file\|recordCandidates\|newRecordPathExample\|indexLineFile\|indexLineExample" plugins/chat-history/skills plugins/chat-history/agents plugins/chat-history/src plugins/chat-history/README.md`
Expected: 一致なし

- [ ] **Step 9: バンドルを再生成する**

Run: `pnpm --filter chat-history-scripts build`
Expected: `plugins/chat-history/scripts/*.mjs` が更新される

- [ ] **Step 10: バンドルにも旧契約が残っていないことを確認する**

Run: `grep -c "index-summary-file" plugins/chat-history/scripts/commit-chat-recording.mjs`
Expected: 1 以上（ビルドが新しいソースを反映している）

Run: `grep -c "index-line-file" plugins/chat-history/scripts/commit-chat-recording.mjs`
Expected: 0

- [ ] **Step 11: Done の条件を満たすことを確認する**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: すべて PASS

- [ ] **Step 12: ルートの README にプラグインの記述があれば追随させる**

Run: `grep -n "chat-history" README.md`
Expected: 記述があれば内容を確認し、1 セッション 1 ファイルになったことと矛盾していないか確かめる。矛盾があれば直す。

- [ ] **Step 13: 単一コミットにまとめる**

Agent 定義とバンドルは必ず同じコミットに入れる。

```bash
git add plugins/chat-history README.md && git commit -m "feat(chat-history): 1 セッション 1 ファイルの契約へ指示層とバンドルを揃える"
```

---

## 実装後の確認

- [ ] 新しいセッションを開始し、`docs/chat/YYYY/MMDD/<user>/HHMM-<topic>.md` の形で新規ファイルが作られることを実機で確認する
- [ ] 同じセッションで 2 回目の記録が走り、同じファイルへ `## セッション 2` として追記されることを確認する
- [ ] INDEX.md に 1 行だけ追加され、2 回目で要旨が更新される（行が増えない）ことを確認する
- [ ] 記録ファイルのヘッダーに `- セッション ID:` が入っていることを確認する
- [ ] ARCHITECTURE に影響する変更があれば `/metatron:update` で追随させる
- [ ] `.serena/memories/` に chat-history の記録先に関する記述があれば更新する
