# chat-history 原文記録 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/chat/` の会話記録で、AI の発言を transcript の原文のまま残し、Tool 使用行を削除する。

**Architecture:** 本文の生成を LLM から外す。`prepare-chat-recording` が原文本文を `bodyFile` へ書き出し、chat-recorder サブエージェント（haiku）はセッション要旨・INDEX 行・ヘッダーだけを書き、`commit-chat-recording` が両者を結合して記録ファイルへ書き込む。chat-recorder は `bodyFile` に触れないため、本文への改変経路が構造上存在しなくなる。

**Tech Stack:** TypeScript (Node >= 26)、vitest、esbuild（`build.ts`）、pnpm 11.8.0

**Spec:** `harness-docs/design/2026-08-16-chat-record-verbatim.md`

## Global Constraints

- 作業ディレクトリは `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement`。ブランチは `chat-history-improvement`（既にチェックアウト済み。新しいブランチを切らない）
- ソースは `plugins/chat-history/src/` にのみ置く。バンドル出力 `plugins/chat-history/scripts/` は `pnpm build` で生成し、git 管理下に置く
- `plugins/chat-history/src/` を変更したタスクのコミットには、`pnpm build` で再生成した `scripts/` の差分を必ず同じコミットに含める
- コミット前に `pnpm lint`・`pnpm typecheck`・`pnpm test` を通す
- TypeScript / JavaScript / Markdown のファイル編集には Serena のツール（`replace_content`・`replace_symbol_body` 等）を使う。新規ファイル作成のみ Write を使う
- バージョンは `plugins/chat-history/.claude-plugin/plugin.json` と `plugins/chat-history/package.json` の両方を `0.6.0` から `0.7.0` に揃える（Task 5 Step 5 で実施）
- サイズ上限の値: 本文 8MB（`8 * 1024 * 1024`）、セッション要旨 512 バイト、ヘッダー 64KB、INDEX 行 8192 バイト（既存値を維持）
- 記録の見出し形式: ユーザー側 `# <workerName>`、AI 側 `# AI`。セッション見出しは `## セッション <N>: <要旨>`
- 一時ファイル名の規約: `<sessionKey>-<attemptId>.body.md` / `.index-line.md` / `.session-title.md` / `.header.md`

---

### Task 1: `extract-conversation.ts` — Tool 行の削除と見出しの機械化

**Files:**
- Modify: `plugins/chat-history/src/extract-conversation.ts`
- Test: `plugins/chat-history/src/__test__/extract-conversation.test.ts`

**Interfaces:**
- Consumes: なし（このタスクが起点）
- Produces:
  - `extractConversation(content: string, sinceLine?: number, targetLine?: number, workerName?: string): string`
  - `extractConversationFile(file: string, sinceLine?: number, targetLine?: number, workerName?: string): string`
  - CLI: `node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]`
  - 出力形式: 各セクションが `# <workerName>` または `# AI` の見出しで始まり、セクション同士は `\n\n` で連結される（`---` の区切りは入れない）

- [ ] **Step 1: 既存テストを新しい期待値へ書き換える**

`plugins/chat-history/src/__test__/extract-conversation.test.ts` の以下 6 箇所を差し替える。

1 つ目。`## USER` を `# unknown`（`workerName` の既定値）に変える:

```ts
test("ユーザー発言は原文のまま、ハーネス注入は除外される", () => {
  const out = run([
    user("<command-name>/model</command-name>"),
    user("これは 原文の  発言です。改変されないこと。"),
    user("メタ発言", { isMeta: true })
  ])
  expect(out).toMatch(
    /# unknown\n\n> これは 原文の {2}発言です。改変されないこと。/
  )
  expect(out).not.toMatch(/command-name|メタ発言/)
})
```

2 つ目。tool_use が出力されないことを検証するテストへ置き換える:

```ts
test("AI の text だけが出力され、thinking と tool_use は出ない", () => {
  const out = run([
    assistant([
      { type: "thinking", thinking: "内心" },
      { type: "text", text: "結論を報告します。" },
      {
        type: "tool_use",
        name: "Bash",
        input: { description: "テストを実行" }
      },
      { type: "tool_use", name: "Write", input: { file_path: "/x/y.md" } }
    ])
  ])
  expect(out).toMatch(/# AI\n\n結論を報告します。/)
  expect(out).not.toMatch(/\(tool:/)
  expect(out).not.toMatch(/Bash|テストを実行|\/x\/y\.md/)
  expect(out).not.toMatch(/内心/)
})
```

3 つ目。`## ASSISTANT` を `# AI` に変える:

```ts
test("連続する ASSISTANT エントリは1セクションに結合される", () => {
  const out = run([
    user("質問"),
    assistant([{ type: "text", text: "前半。" }]),
    assistant([{ type: "text", text: "後半。" }])
  ])
  expect(out.match(/# AI/g)?.length).toBe(1)
  expect(out).toMatch(/前半。\n\n後半。/)
})
```

4 つ目。tool_use への期待を外す:

```ts
test("先頭が ASSISTANT・末尾が USER の window で AI の作業が失われない", () => {
  const out = extractConversation(
    [
      user("前回の指示"),
      assistant([{ type: "text", text: "実装しました。" }]),
      assistant([{ type: "text", text: "テストも通しました。" }]),
      user("次の指示")
    ].join("\n"),
    1,
    4
  )
  expect(out).toMatch(/実装しました。/)
  expect(out).toMatch(/テストも通しました。/)
  expect(out).toMatch(/次の指示/)
  expect(out).not.toMatch(/前回の指示/)
})
```

5 つ目。引用ブロックの見出しを変える:

```ts
test("USER 発言は各行 > 前置の引用ブロックで出力される(空行は > のみ)", () => {
  const out = run([user("1行目\n\n2行目")])
  expect(out).toMatch(/# unknown\n\n> 1行目\n>\n> 2行目/)
})
```

6 つ目。新規テストを 2 本、ファイル末尾に追加する:

```ts
test("--worker で指定した名前がユーザー側の見出しになる", () => {
  const out = run([user("質問")], ["--worker", "phyllis998"])
  expect(out).toMatch(/# phyllis998\n\n> 質問/)
})

test("セクションの間に --- の区切りを入れない", () => {
  const out = run([user("質問"), assistant([{ type: "text", text: "回答" }])])
  expect(out).not.toMatch(/^---$/m)
  expect(out).toMatch(/# unknown\n\n> 質問\n\n# AI\n\n回答/)
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm vitest run plugins/chat-history/src/__test__/extract-conversation.test.ts`

Expected: FAIL。`# unknown` / `# AI` を期待する assertion が `## USER` / `## ASSISTANT` を受け取って落ちる。`--worker` を渡すテストも落ちる。

- [ ] **Step 3: `extract-conversation.ts` を実装する**

`MAX_TOOL_HINT` 定数を削除し、`TranscriptContent` から不要フィールドを落とす:

```ts
interface TranscriptContent {
  type?: string
  text?: string
}
```

`extractConversation` を次に置き換える:

```ts
export function extractConversation(
  content: string,
  sinceLine = 0,
  targetLine = Number.POSITIVE_INFINITY,
  workerName = "unknown"
): string {
  const sections: Section[] = []
  const push = (role: Section["role"], part: string): void => {
    const last = sections.at(-1)
    if (last?.role === role) last.parts.push(part)
    else sections.push({ role, parts: [part] })
  }

  let lineNo = 0
  for (const line of content.split("\n")) {
    lineNo++
    if (lineNo <= sinceLine) continue
    if (lineNo > targetLine) break
    if (!line.trim()) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    const message = entry.message
    if (!message || entry.isSidechain) continue

    if (entry.type === "user" && typeof message.content === "string") {
      const text = message.content.trim()
      if (!text || text.startsWith("<") || entry.isMeta) continue
      push("USER", quote(text))
      // 抽出区間 (sinceLine, targetLine] の両端はどちらも「ユーザー発言の行」であり、
      // AI の作業本体は必ず区間の前方(最初の USER 発言より手前)に来る。
      // sinceLine は記録済みユーザー発言の行そのものなので、それより後はすべて未記録である。
    } else if (entry.type === "assistant" && Array.isArray(message.content)) {
      // tool_use は記録しない。記録は AI の発言(text)だけを原文で残す。
      for (const part of message.content)
        if (part.type === "text" && part.text?.trim())
          push("ASSISTANT", part.text.trim())
    }
  }

  return sections
    .map(
      (section) =>
        `# ${section.role === "USER" ? workerName : "AI"}\n\n${section.parts.join("\n\n")}`
    )
    .join("\n\n")
}
```

`extractConversationFile` に `workerName` を通す:

```ts
export function extractConversationFile(
  file: string,
  sinceLine = 0,
  targetLine = Number.POSITIVE_INFINITY,
  workerName = "unknown"
): string {
  return extractConversation(
    fs.readFileSync(file, "utf8"),
    sinceLine,
    targetLine,
    workerName
  )
}
```

`main()` に `--worker` を追加する:

```ts
function main(): void {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file || file.startsWith("--") || !fs.existsSync(file)) {
    console.error(
      "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]"
    )
    process.exitCode = 1
    return
  }
  const sinceIndex = args.indexOf("--since-line")
  const sinceLine =
    sinceIndex === -1 ? 0 : Math.max(0, Number(args[sinceIndex + 1]) || 0)
  const workerIndex = args.indexOf("--worker")
  const workerName =
    workerIndex === -1 ? "unknown" : (args[workerIndex + 1] ?? "unknown")
  console.log(
    extractConversationFile(
      file,
      sinceLine,
      Number.POSITIVE_INFINITY,
      workerName
    )
  )
}
```

ファイル冒頭のコメント（3 行目）の使い方も合わせる:

```ts
// 使い方: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm vitest run plugins/chat-history/src/__test__/extract-conversation.test.ts`

Expected: PASS（全テスト）

- [ ] **Step 5: ビルドしてコミットする**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm build && pnpm lint && pnpm typecheck
```

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && git add plugins/chat-history/src/extract-conversation.ts plugins/chat-history/src/__test__/extract-conversation.test.ts plugins/chat-history/scripts/extract-conversation.mjs && git commit -m "feat(chat-history): 会話抽出から Tool 行を外し記録見出しを機械生成する"
```

---

### Task 2: `prepare-chat-recording.ts` — 本文の書き出し・セッション番号の確定・一時ファイルの掃除

**Files:**
- Modify: `plugins/chat-history/src/prepare-chat-recording.ts`
- Test: `plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`

**Interfaces:**
- Consumes: `extractConversationFile(file, sinceLine, targetLine, workerName)`（Task 1）
- Produces:
  - `prepareChatRecording` の戻り値 JSON に次を追加する
    - `sessionTitleFile: string` — `<tempDir>/<sessionKey>-<attemptId>.session-title.md` の絶対パス
    - `headerFile: string` — `<tempDir>/<sessionKey>-<attemptId>.header.md` の絶対パス
    - `sessionNumber: number` — このターンで書き込むセッション番号（`lastSessionNumber + 1`）
  - `bodyFile` は従来どおり返すが、**このタスク以降は `prepare` が中身を書き込む**。内容は `extractConversationFile` の出力（末尾に改行 1 個を保証）
  - plan JSON (`<planDir>/<sessionKey>.json`) に `sessionNumber` を保存する。Task 3 の `commit` がここから読む
  - 既存フィールド（`conversation`・`skillContract`・`recordTarget`・`lastSessionNumber`・`tailContext`・`indexLine`・`indexEntryPath`・`indexLineExample`・`metadataHints`・`allowedNewRecordDir`・`newRecordPathExample`・`indexLineFile`）はすべて維持する

- [ ] **Step 1: 失敗するテストを書く**

`plugins/chat-history/src/__test__/prepare-chat-recording.test.ts` の末尾に追加する:

```ts
test("bodyFile に原文本文を書き出し、パスとセッション番号を返す", () => {
  const value = setup([user("質問")])
  const result = prepareChatRecording(argsOf(value))
  expect(result.sessionTitleFile).toBe(
    path.join(
      value.paths.tempDir,
      `${value.sessionKey}-${value.attemptId}.session-title.md`
    )
  )
  expect(result.headerFile).toBe(
    path.join(
      value.paths.tempDir,
      `${value.sessionKey}-${value.attemptId}.header.md`
    )
  )
  expect(result.sessionNumber).toBe(1)
  const body = fs.readFileSync(result.bodyFile as string, "utf8")
  expect(body).toContain("> 質問")
  expect(body.endsWith("\n")).toBe(true)
  expect(body).toBe(`${result.conversation as string}\n`)
})

test("sessionNumber は既存記録の最大セッション番号 + 1 になる", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const relativePath = `${dir}/topic.md`
  fs.mkdirSync(path.join(value.project, dir), { recursive: true })
  fs.writeFileSync(
    path.join(value.project, relativePath),
    "# Existing\n\n## セッション 1\n\n## セッション 2\n"
  )
  setRecordPath(value, relativePath)
  const result = prepareChatRecording(argsOf(value))
  expect(result.lastSessionNumber).toBe(2)
  expect(result.sessionNumber).toBe(3)
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(value.paths.planDir, `${value.sessionKey}.json`),
      "utf8"
    )
  )
  expect(plan.sessionNumber).toBe(3)
})

test("同一セッションの古い attempt の一時ファイルだけを掃除する", () => {
  const value = setup([user("質問")])
  // attemptId("attempt") を名前に含めない。含めると掃除の除外条件に当たって残ってしまう
  const stale = path.join(
    value.paths.tempDir,
    `${value.sessionKey}-previous.body.md`
  )
  const otherSession = path.join(value.paths.tempDir, "other-session-x.body.md")
  fs.writeFileSync(stale, "stale\n")
  fs.writeFileSync(otherSession, "keep\n")
  prepareChatRecording(argsOf(value))
  expect(fs.existsSync(stale)).toBe(false)
  expect(fs.existsSync(otherSession)).toBe(true)
})

test("ユーザー側の見出しに作業者名を使う", () => {
  const value = setup([user("質問")])
  const result = prepareChatRecording(argsOf(value))
  expect(result.conversation).toMatch(
    new RegExp(`^# ${safeWorker(result.workerName as string)}\\n\\n> 質問`)
  )
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`

Expected: FAIL。`result.sessionTitleFile` が `undefined`、`bodyFile` が存在しない、掃除が行われない。

- [ ] **Step 3: `prepare-chat-recording.ts` を実装する**

`AttemptPlan` に `sessionNumber` を足す:

```ts
interface AttemptPlan {
  version: 1
  attemptId: string
  targetLine: number
  metadataHints: string[]
  recordTarget?: { relativePath: string | null; appendMode: boolean }
  recordCandidates?: string[]
  allowedNewRecordDir?: string
  sessionNumber?: number
  preparedAt?: string
}
```

`lastSessionNumber` 関数の下に掃除関数を足す:

```ts
// 失敗した attempt の一時ファイルは commit の削除処理を通らずに残る。
// 同じセッションの過去 attempt 分だけをここで掃除する(他セッションには触れない)。
function cleanStaleTemp(
  tempDir: string,
  sessionKey: string,
  attemptId: string
): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(tempDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.startsWith(`${sessionKey}-`) || name.includes(attemptId)) continue
    try {
      fs.rmSync(path.join(tempDir, name), { force: true })
    } catch {
      // 掃除の失敗は記録本体の成否に影響させない
    }
  }
}
```

`updateHeartbeat(paths.lockPath, args.attemptId)` の直後に掃除を挿入する:

```ts
  updateHeartbeat(paths.lockPath, args.attemptId)
  cleanStaleTemp(paths.tempDir, args.sessionKey, args.attemptId)
  const workerName = gitUser(args.project)
```

`indexLineFile` の定義の直後に、残り 2 本のパスとセッション番号・本文の書き出しを足す:

```ts
  const sessionTitleFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.session-title.md`
  )
  const headerFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.header.md`
  )
  const conversation = extractConversationFile(
    args.transcript,
    state.recordedLine,
    args.targetLine,
    safeWorker(workerName)
  )
  const sessionNumber = lastSessionNumber(tailContext) + 1
  // 本文は prepare が書き切る。chat-recorder は bodyFile を読み書きしない。
  fs.mkdirSync(paths.tempDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    bodyFile,
    conversation.endsWith("\n") ? conversation : `${conversation}\n`,
    { encoding: "utf8", mode: 0o600 }
  )
```

plan の保存に `sessionNumber` を含める:

```ts
  atomicWriteJson(planPath, {
    ...plan,
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    sessionNumber,
    preparedAt: new Date().toISOString()
  })
```

戻り値の `conversation` を再計算せず、上で作った値を使う。`lastSessionNumber` は既存フィールドとして残し、新フィールドを足す:

```ts
    conversation,
    skillContract: fs.readFileSync(pluginSkillPath, "utf8"),
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    newRecordPathExample,
    bodyFile,
    indexLineFile,
    sessionTitleFile,
    headerFile,
    sessionNumber,
```

（`conversation: extractConversationFile(...)` の行を `conversation,` に置き換える。二重に抽出しない。）

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm vitest run plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`

Expected: PASS（既存テストを含め全件）

- [ ] **Step 5: ビルドしてコミットする**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm build && pnpm lint && pnpm typecheck
```

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && git add plugins/chat-history/src/prepare-chat-recording.ts plugins/chat-history/src/__test__/prepare-chat-recording.test.ts plugins/chat-history/scripts/prepare-chat-recording.mjs && git commit -m "feat(chat-history): prepare が原文本文とセッション番号を確定する"
```

---

### Task 3: `commit-chat-recording.ts` — 結合ロジックと検証の移行

**Files:**
- Modify: `plugins/chat-history/src/commit-chat-recording.ts`
- Test: `plugins/chat-history/src/__test__/commit-chat-recording.test.ts`

**Interfaces:**
- Consumes: `prepare` が書いた `bodyFile`、plan の `sessionNumber`（Task 2）
- Produces:
  - `commitChatRecording(args)` の `args` に `sessionTitleFile: string` を必須で追加、`headerFile?: string` を任意で追加
  - CLI: `node commit-chat-recording.mjs --project <p> --session-key <k> --attempt-id <a> --target-line <N> --body-file <b> --index-line-file <i> --session-title-file <s> [--header-file <h>] [--record-path <r>]`
  - `--header-file` は `appendMode = false`（新規記録）のときのみ必須。`appendMode = true` のとき渡すとエラー
  - 記録ファイルへ書き込まれる文字列（結合後）:
    - 追記時: `\n## セッション <N>: <sessionTitle>\n\n<body>`
    - 新規時: `<header の末尾空白を除いたもの>\n\n---\n\n## セッション <N>: <sessionTitle>\n\n<body>`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/chat-history/src/__test__/commit-chat-recording.test.ts` の `setup` を差し替える。plan に `sessionNumber` を足し、`sessionTitleFile` と `headerFile` を作り、`bodyFile` の中身をセッション見出しを含まない本文だけにする:

```ts
  atomicWriteJson(path.join(paths.planDir, `${sessionKey}.json`), {
    version: 1,
    attemptId,
    targetLine: 2,
    recordTarget: {
      relativePath: appendMode ? relativePath : null,
      appendMode
    },
    allowedNewRecordDir: "docs/chat/2026/0724/unknown",
    sessionNumber: appendMode ? 2 : 1
  })
  const bodyFile = path.join(paths.tempDir, "body.md")
  const indexLineFile = path.join(paths.tempDir, "index.md")
  const sessionTitleFile = path.join(paths.tempDir, "session-title.md")
  const headerFile = path.join(paths.tempDir, "header.md")
  fs.writeFileSync(bodyFile, "# unknown\n\n> 質問\n\n# AI\n\n回答\n")
  fs.writeFileSync(sessionTitleFile, "話題の要旨\n")
  fs.writeFileSync(headerFile, "# New\n\n- 日付: 2026-07-24\n")
  fs.writeFileSync(
    indexLineFile,
    `- \`${docsRelative}\` | 2026-07-24 | unknown | summary\n`
  )
  return {
    root,
    project,
    sessionKey,
    attemptId,
    relativePath,
    docsRelative,
    recordPath,
    paths,
    bodyFile,
    indexLineFile,
    sessionTitleFile,
    headerFile
  }
```

既存テストの `commitChatRecording({...})` 呼び出しすべてに `sessionTitleFile: value.sessionTitleFile` を足し、`appendMode = false`（`setup(false)`）を使うテストには `headerFile: value.headerFile` も足す。対象は次のテスト:

- 「新規=%s の本文・INDEX・状態を一括更新する」（`appendMode` に応じて `headerFile` を渡す。`recordPath` と同じ条件）
- 「新規 INDEX はヘッダーと空行を付けて作成する」（`headerFile` あり）
- 「既存の%s INDEX 行を一意に更新して重複させない」（`setup(true)` なので `headerFile` なし）
- 「新規行をエントリのパス昇順位置へ挿入し非エントリ行を並べ替えない」（`headerFile` あり）
- 「既存新規パスとの衝突を排他的作成で拒否する」（`headerFile` あり）
- 「新規パス検証エラーは prepare と同じ期待形式と実値を示す」（`headerFile` あり）
- 「INDEX 参照エラーは期待する docs/chat 相対パスを示す」（`headerFile` あり）
- 「INDEX 重複失敗時は本文を元サイズへ truncate しロックを保持する」（`setup(true)` なので `headerFile` なし）

そのうえでファイル末尾に新規テストを追加する:

```ts
test("追記時はセッション見出しを生成して本文の前に置く", () => {
  const value = setup(true)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(
    "# Existing\n\n## セッション 2: 話題の要旨\n\n# unknown\n\n> 質問\n\n# AI\n\n回答\n"
  )
})

test("新規時はヘッダー・区切り・セッション見出し・本文を結合する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordPath: value.relativePath
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(
    "# New\n\n- 日付: 2026-07-24\n\n---\n\n## セッション 1: 話題の要旨\n\n# unknown\n\n> 質問\n\n# AI\n\n回答\n"
  )
})

test("追記時に --header-file を渡すと拒否する", () => {
  const value = setup(true)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile
    })
  ).toThrow(/header/)
})

test("新規時に --header-file が無ければ拒否する", () => {
  const value = setup(false)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile,
      recordPath: value.relativePath
    })
  ).toThrow(/header/)
})

test("セッション要旨が空または複数行なら拒否する", () => {
  const value = setup(true)
  fs.writeFileSync(value.sessionTitleFile, "一行目\n二行目\n")
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/session title/)
})

test("成功時に一時ファイル 4 本をすべて削除する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordPath: value.relativePath
  })
  expect(fs.existsSync(value.bodyFile)).toBe(false)
  expect(fs.existsSync(value.indexLineFile)).toBe(false)
  expect(fs.existsSync(value.sessionTitleFile)).toBe(false)
  expect(fs.existsSync(value.headerFile)).toBe(false)
})

test("本文が 8MB を超えると拒否する", () => {
  const value = setup(true)
  fs.writeFileSync(value.bodyFile, `> 質問\n${"a".repeat(8 * 1024 * 1024)}\n`)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/too large/)
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording.test.ts`

Expected: FAIL。`sessionTitleFile` が型に存在しない（typecheck）、結合された文字列が期待と一致しない。

- [ ] **Step 3: `commit-chat-recording.ts` を実装する**

`Args` と `AttemptPlan` を広げる:

```ts
interface Args {
  project: string
  sessionKey: string
  attemptId: string
  targetLine: number
  bodyFile: string
  indexLineFile: string
  sessionTitleFile: string
  headerFile?: string
  recordPath?: string
}

interface AttemptPlan {
  version: 1
  attemptId: string
  targetLine: number
  recordTarget: { relativePath: string | null; appendMode: boolean }
  allowedNewRecordDir: string
  sessionNumber: number
}
```

`fail` の下に上限の定数を置く:

```ts
const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_SESSION_TITLE_BYTES = 512
const MAX_HEADER_BYTES = 64 * 1024
const MAX_INDEX_LINE_BYTES = 8192
```

`parseArgs` に 2 つのフラグを足す:

```ts
    bodyFile: path.resolve(value("--body-file") as string),
    indexLineFile: path.resolve(value("--index-line-file") as string),
    sessionTitleFile: path.resolve(value("--session-title-file") as string),
    headerFile: (() => {
      const raw = value("--header-file", true)
      return raw ? path.resolve(raw) : undefined
    })(),
    recordPath: value("--record-path", true)
```

`validateInputs` を書き換える。`body` は結合後の文字列を返す:

```ts
function validateInputs(
  args: Args,
  paths: ReturnType<typeof getStatePaths>,
  plan: AttemptPlan
): {
  recordPath: string
  relativePath: string
  body: string
  indexLine: string
} {
  const temporaryFiles = [
    args.bodyFile,
    args.indexLineFile,
    args.sessionTitleFile,
    ...(args.headerFile ? [args.headerFile] : [])
  ]
  for (const file of temporaryFiles)
    if (!isInside(paths.tempDir, file))
      fail("temporary files must be inside the recording state temp directory")

  const rawBody = fs.readFileSync(args.bodyFile, "utf8")
  const indexLine = fs.readFileSync(args.indexLineFile, "utf8").trim()
  const sessionTitle = fs.readFileSync(args.sessionTitleFile, "utf8").trim()
  if (!rawBody) fail("record body is empty")
  if (!rawBody.includes("> ")) fail("record body must contain a USER quote block")
  if (
    !sessionTitle ||
    sessionTitle.includes("\n") ||
    Buffer.byteLength(sessionTitle) > MAX_SESSION_TITLE_BYTES
  )
    fail("session title must be exactly one bounded line")
  if (
    !indexLine ||
    indexLine.includes("\n") ||
    Buffer.byteLength(indexLine) > MAX_INDEX_LINE_BYTES
  )
    fail("INDEX entry must be exactly one bounded line")

  let header = ""
  if (plan.recordTarget.appendMode) {
    if (args.headerFile)
      fail("--header-file is forbidden when appending to an existing record")
  } else {
    if (!args.headerFile) fail("--header-file is required for a new record")
    header = fs.readFileSync(args.headerFile, "utf8")
    if (!header.startsWith("# ") || Buffer.byteLength(header) > MAX_HEADER_BYTES)
      fail("record header must start with a title line and stay bounded")
  }

  const heading = `## セッション ${plan.sessionNumber}: ${sessionTitle}`
  const body = plan.recordTarget.appendMode
    ? `\n${heading}\n\n${rawBody}`
    : `${header.trimEnd()}\n\n---\n\n${heading}\n\n${rawBody}`
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) fail("record body is too large")
  if (!body.includes("## セッション"))
    fail("composed record must contain a session heading")

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
}
```

成功時の削除リストに 2 本を足す:

```ts
    for (const file of [
      args.bodyFile,
      args.indexLineFile,
      args.sessionTitleFile,
      ...(args.headerFile ? [args.headerFile] : []),
      planPath,
      paths.lockPath
    ])
      fs.rmSync(file, { force: true })
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm vitest run plugins/chat-history/src/__test__/commit-chat-recording.test.ts`

Expected: PASS（既存テストを含め全件）

- [ ] **Step 5: ビルドしてコミットする**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && git add plugins/chat-history/src/commit-chat-recording.ts plugins/chat-history/src/__test__/commit-chat-recording.test.ts plugins/chat-history/scripts/commit-chat-recording.mjs && git commit -m "feat(chat-history): commit が本文とメタを結合して記録を書き込む"
```

---

### Task 4: 記録フォーマット契約の書き換え（`SKILL.md` / `chat-recorder.md` / `rationale.md`）

**Files:**
- Modify: `plugins/chat-history/skills/chat/SKILL.md`
- Modify: `plugins/chat-history/agents/chat-recorder.md`
- Modify: `plugins/chat-history/docs/rationale.md`

**Interfaces:**
- Consumes: Task 2 が返す JSON フィールド（`sessionTitleFile`・`headerFile`・`sessionNumber`）、Task 3 の CLI フラグ（`--session-title-file`・`--header-file`）
- Produces: chat-recorder が書く 3 種のファイルの内容契約。本文は書かない

このタスクは AI 向けの指示書を書き換えるため、`prompt-smith:prompt-smith` スキルを使う。編集は Serena の `replace_content` で行う。

- [ ] **Step 1: `skills/chat/SKILL.md` の粒度契約を反転する**

「## 本文の粒度契約(非対称)」の節（48 行目付近）から「この対応を崩さない。」までを、次に置き換える:

````markdown
## 本文の粒度契約

**ユーザーの発言も AI の発言も原文で残す。** 本文はスクリプトが transcript から機械的に生成し、要約を挟まない。

### ユーザーの発言

引用ブロック(`>`)に原文のまま入る。見出しは `# <作業者名>`。

### AI の発言

地の文に原文のまま入る。見出しは `# AI`。記録されるのは transcript の発言本文だけで、Tool の使用記録と思考ブロックは含まれない。

### 記録の生成者

本文を書くのはスクリプトであり、chat-recorder サブエージェントではない。chat-recorder が書くのは次の 3 つだけである。

- **セッション要旨**: `## セッション N: <要旨>` の `<要旨>` にあたる 1 行。そのターンで何を扱ったかを 30 字程度で表す。改行を含めない
- **INDEX の 1 行**: 「索引(INDEX.md)」の節の形式に従う
- **ヘッダー**: 新規ファイルを作るときだけ。「ファイルの構成」の節の 1.(ヘッダー)にあたる部分

chat-recorder は本文を読み書きしない。
````

- [ ] **Step 2: `skills/chat/SKILL.md` の「ファイルの構成」から末尾節を外す**

「## ファイルの構成(この順で書く)」の 3 項目目を削除し、2 項目構成にする:

```markdown
## ファイルの構成(この順で書く)

1. **ヘッダー**: タイトル(`# <題名>`)と箇条書きのメタ情報
   - 日付
   - 参加者(ユーザーは GitHub ユーザー名。不明なら必ず本人に確認する)
   - 成果物(作成・変更したファイルのパス、コミットハッシュ)
   - 前提(参照した設計書・過去のチャット記録)
2. **本文**: `## セッション N: <要旨>` で区切り、各ターンを `# <ユーザー名>` / `# AI` の見出しで記録する
```

- [ ] **Step 3: `skills/chat/SKILL.md` のテンプレートを新形式へ差し替える**

「## テンプレート」以下のコードブロック全体を置き換える:

````markdown
## テンプレート

```markdown
# CSV エクスポート機能 設計セッション

- 日付: 2026-01-15
- 参加者: exampleuser, AI (Claude Sonnet 5)
- 成果物: `docs/DESIGN-csv-export.md`、コミット `f00ba55`
- 前提: `docs/chat/2026/0110/exampleuser/reporting-requirements.md`

---

## セッション 1: 方式の決定

# exampleuser

> エクスポートはストリーミングでお願いします。以前 10 万行を一括生成してメモリ落ちしたことがあるので。文字コードは Excel 互換のため BOM 付き UTF-8 固定で。

# AI

ライブラリを 2 案比較しました。csv-stringify を採用します。ストリーム API が安定しているためです。fast-csv は BOM 制御が不安定なので見送ります。

当初 Transform ストリームを自作しましたが、背圧処理に欠陥があり負荷テストでメモリが線形増加しました。pipeline() への置き換えで解消しています。

エンドポイント 4 本のうち /reports だけページネーション互換の特殊処理を追加しました。残り 3 本は無風です。
```
````

あわせて「### 網羅性の明記」の節と「### 表記規約」の節を削除する。前者は要約を書かなくなるため対象が消え、後者は「引用ブロック = 原文 / 地の文 = 要約」の対応が成立しなくなるためである。

- [ ] **Step 4: 「目的」の節を新しい責務に合わせる**

「## 目的」の第 1 段落を置き換える:

```markdown
`docs/chat/` はリポジトリにコミットされる**唯一の永続的な会話記録**である(生ログはローカル限定で消える)。将来のAIと人間が「何をして、何を決め、なぜそう決め、何がうまくいかなかったか」を検証するための一次資料として書く。要約を挟むと、要約が原文から乖離しても後から検知できない。**ユーザーの発言も AI の発言も原文のまま残す**ことがこの記録の最優先の責務である。
```

- [ ] **Step 5: `agents/chat-recorder.md` を書き換える**

「# AI パートの粒度」の節（11〜20 行目）を、次の節に置き換える:

````markdown
# 書くもの・書かないもの

記録フォーマットの正本は `skills/chat/SKILL.md`(prepare が `skillContract` として全文を返す)である。両者が矛盾する場合は SKILL.md を優先する。

本文はスクリプトが生成する。あなたが書くのは次の 3 つだけである。

- **セッション要旨**(`sessionTitleFile`): そのターンで何を扱ったかを表す 1 行。30 字程度。改行を含めない。「作業した」「対応した」で終わらせず、対象を具体名で示す
- **INDEX の 1 行**(`indexLineFile`): `indexLineExample` と同じ形式。要旨は記録ファイル全体を表す 1 行にする
- **ヘッダー**(`headerFile`、新規ファイルを作るときだけ): `# <題名>` で始め、日付・参加者・成果物・前提の箇条書きを続ける。`---` の区切り行とセッション見出しは commit が付けるので書かない

`bodyFile` を読まない。書かない。会話本文を転記しない。要約もしない。要旨とヘッダーを書くための材料は、prepare が返す JSON の `conversation` を読んで得る。
````

「# 手順」の節を次に置き換える:

````markdown
# 手順

ディスパッチプロンプトから `projectDir`、`transcriptPath`、`sessionKey`、`attemptId`、`targetLine`、`pluginRoot` を受け取る。`${CLAUDE_PLUGIN_ROOT}` が展開されない場合は、dispatch で渡された `pluginRoot` をコマンドの先頭パスに使う。コマンド中の `<sessionTitleFile>`、`<indexLineFile>`、`<headerFile>`、`<bodyFile>` は手順 1 の JSON が返す絶対パスを使い、それ以外のプレースホルダにはディスパッチプロンプトの同名の値をそのまま使う。

1. Bash で次を 1 回実行し、返された JSON 全体を読む

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/prepare-chat-recording.mjs" --project "<projectDir>" --transcript "<transcriptPath>" --session-key "<sessionKey>" --attempt-id "<attemptId>" --target-line <targetLine>
   ```

2. JSON の `skillContract`、`conversation`、`recordTarget`、`sessionNumber`、`tailContext`、`indexLine`、`indexEntryPath`、`indexLineExample`、`metadataHints` に厳密に従い、次を作る
   - セッション要旨 1 行
   - 対象記録を表す INDEX.md の完成後の 1 行。パスは `docs/chat/` からの相対パスをバッククォートで囲み、`indexLineExample` と同じ形式にする
   - `recordTarget.appendMode=false` のときだけ、ヘッダー(`# <題名>` とメタ情報の箇条書き)
   - `recordTarget.relativePath=null` のときだけ、`allowedNewRecordDir` 直下に、内容を表すケバブケース名と `.md` 拡張子を持つプロジェクト相対パス。`newRecordPathExample` と同じ形式にする
3. 手順 1 の JSON の `sessionTitleFile` と `indexLineFile` へ、セッション要旨と INDEX 1 行をそれぞれ Write する。`recordTarget.appendMode=false` のときは `headerFile` へヘッダーも Write する。それ以外のファイルを Write しない
4. Bash で次を 1 回実行する。`recordTarget.appendMode=false` のときだけ `--header-file` と `--record-path` を加える

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-chat-recording.mjs" --project "<projectDir>" --session-key "<sessionKey>" --attempt-id "<attemptId>" --target-line <targetLine> --body-file "<bodyFile>" --index-line-file "<indexLineFile>" --session-title-file "<sessionTitleFile>"
   ```

5. `ok=true` なら、最終応答は `recorded: <プロジェクト相対パス> (session <N>, +<M> lines)` の 1 行だけにする。`ok=false` またはコマンド失敗時は、記録先を直接修正せず、最終応答を `failed: <短い理由>` の 1 行だけにする
````

「# 厳守事項」の節を次に置き換える:

```markdown
# 厳守事項

- `bodyFile` を読まない・書かない。会話本文の転記も要約もしない
- 成果物・コミット・ユーザー名など、入力から確定できない情報は創作せず「不明」と書く
```

- [ ] **Step 6: `docs/rationale.md` を更新する**

「## chat: ユーザー発言を原文で残す理由」と「## chat: 引用ブロックと地の文を対応させる理由」の 2 節を、次の 2 節に置き換える:

```markdown
## chat: 発言を原文で残す理由

発言は要件と判断の一次資料である。AI の解釈で置き換えて記録すると、AI が誤解していた場合に「AI の誤解」が「実際に起きたこと」として歴史に残り、後から検証する手段が失われる。

当初はユーザーの発言だけを原文とし、AI の発言は構造化された要約としていた。しかし 2026-08-15 の記録(`docs/chat/2026/0815/phyllis998/context7-github-serena-mcp-investigation.md`)で、要約が外部プロジェクトである Serena を「このリポジトリ内のツール」と記述する誤りが生じ、原文が失われているため記録だけからは誤りと判定できない状態になった。要約を挟む限り同種の劣化は検知できないため、2026-08-16 に AI の発言も原文へ反転した。

## chat: 本文を chat-recorder に書かせない理由

「原文のまま転記せよ」と指示しても、LLM は長文の転記で省略と言い換えを起こす。本文が LLM の出力である限り、要約由来の劣化は同じ経路で再発する。そのため本文は `prepare-chat-recording` が transcript から機械的に生成し、chat-recorder には要旨・索引・ヘッダーという短いメタ情報だけを書かせている。本文への改変経路を構造的に存在させないことが、正確性の唯一の担保である。
```

- [ ] **Step 7: コミットする**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && git add plugins/chat-history/skills/chat/SKILL.md plugins/chat-history/agents/chat-recorder.md plugins/chat-history/docs/rationale.md && git commit -m "docs(chat-history): 記録フォーマット契約を原文記録へ反転する"
```

---

### Task 5: 読み手側の追随（`chat-reader.md` / `recall` / `resume` / README / バージョン）

**Files:**
- Modify: `plugins/chat-history/agents/chat-reader.md`
- Modify: `plugins/chat-history/skills/recall/SKILL.md`（必要な場合のみ）
- Modify: `plugins/chat-history/skills/resume/SKILL.md`（必要な場合のみ）
- Modify: `plugins/chat-history/README.md`
- Modify: `README.md`（リポジトリルート）
- Modify: `plugins/chat-history/.claude-plugin/plugin.json`
- Modify: `plugins/chat-history/package.json`

**Interfaces:**
- Consumes: Task 4 で確定した記録フォーマット
- Produces: なし（このタスクが終端）

- [ ] **Step 1: 読み手側が旧形式を前提にしていないか調べる**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && grep -n "要約\|引用ブロック\|地の文\|スロット\|## USER\|## ASSISTANT\|注意事項" plugins/chat-history/agents/chat-reader.md plugins/chat-history/skills/recall/SKILL.md plugins/chat-history/skills/resume/SKILL.md
```

ヒットした箇所のうち、「AI の発言は要約である」「引用ブロックだけが原文である」を前提にした記述を洗い出す。`chat-reader.md` の「ユーザー発言(引用ブロック)を引用するときは原文のまま載せる(要約・改変しない)」は新形式でも正しいので残す。

- [ ] **Step 2: `chat-reader.md` に新旧混在の前提を書く**

「# 厳守事項」にあたる節（`chat-reader.md:20-23` 付近）に次の 1 行を足す:

```markdown
- 記録には 2 つの形式がある。2026-08-16 より前の記録は AI の発言が要約であり、それ以降は原文である。要約側を引用するときは、それが要約であることを明示する
```

Step 1 で他に旧形式前提の記述が見つかった場合は、同じ方針（新旧が混在する前提へ改める）で直す。見つからなければ `recall` と `resume` は変更しない。

- [ ] **Step 3: `plugins/chat-history/README.md` を更新する**

記録フォーマットに触れている箇所を、AI の発言が原文であること・Tool 使用記録が含まれないことを示す記述に改める。まず現状を確認する:

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && cat plugins/chat-history/README.md
```

- [ ] **Step 4: ルートの `README.md` に反映する**

chat-history プラグインの説明が記録フォーマットに触れている場合、同じ内容に更新する:

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && grep -n "chat-history" README.md
```

- [ ] **Step 5: バージョンを 0.7.0 に上げる**

`plugins/chat-history/.claude-plugin/plugin.json`:

```json
{
  "name": "chat-history",
  "description": "チャットの履歴を保存・検索するためのプラグイン",
  "version": "0.7.0"
}
```

`plugins/chat-history/package.json` の `"version"` も `"0.7.0"` にする。

- [ ] **Step 6: コミットする**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && git add plugins/chat-history/agents/chat-reader.md plugins/chat-history/README.md README.md plugins/chat-history/.claude-plugin/plugin.json plugins/chat-history/package.json && git commit -m "docs(chat-history): 読み手側を新旧混在の前提に合わせ 0.7.0 へ上げる"
```

---

### Task 6: 実機確認

**Files:**
- Verify: `docs/chat/2026/<MMDD>/phyllis998/*.md`（記録の実物）

**Interfaces:**
- Consumes: Task 1〜5 のすべて
- Produces: なし

- [ ] **Step 1: 全体のテストとビルドを通す**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Expected: すべて PASS。`git status` で `plugins/chat-history/scripts/` に未コミットの差分が残っていないこと。

- [ ] **Step 2: 記録を 1 往復させる**

このリポジトリで新しい Claude Code セッションを開き、任意の 1 ターンの会話を行う。Stop フックが chat-recorder を起動し、`docs/chat/` に記録が作られるのを待つ。

**注意:** 改修後のプラグインは `plugins/chat-history/` にあるが、実際にフックが呼ぶ `pluginRoot` はインストール済みのプラグイン（`/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history`）を指す場合がある。実機確認の前に、フック通知に出る `pluginRoot` がどこを指しているか確認し、改修後のコードが実行される状態にする。指していない場合は、`node plugins/chat-history/scripts/prepare-chat-recording.mjs` と `commit-chat-recording.mjs` を手で順に実行して確認する。

- [ ] **Step 3: 記録の内容を確認する**

新しくできた記録ファイルを開き、次を確認する:

- `# AI` の見出しの下が、会話で実際に出力された文面と一致していること（要約されていないこと）
- `(tool: ...)` の行が 1 つも無いこと
- `## セッション N: <要旨>` の要旨が埋まっていること
- `docs/chat/INDEX.md` に対応する 1 行があり、重複していないこと

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-chat-history-improvement && grep -rn "(tool:" docs/chat/2026/ | tail -5
```

Expected: 新しい日付のファイルにはヒットしない（過去の記録にはヒットしてよい）。

- [ ] **Step 4: 一時ファイルが消えていることを確認する**

```bash
ls -la ~/.claude/chat-history/chat-recorder/*/temp/ 2>/dev/null; ls -la "${TMPDIR:-/tmp}"/chat-history-recorder-*/*/temp/ 2>/dev/null
```

Expected: 成功した attempt の `.body.md` / `.index-line.md` / `.session-title.md` / `.header.md` が残っていない。

- [ ] **Step 5: 結果を報告する**

実機確認の結果（記録ファイルのパス、AI 原文が載っているか、Tool 行が消えているか、一時ファイルの状態）をユーザーへ報告する。問題が出た場合は、どのタスクの成果物が原因かを特定してから直す。

---

## 自己レビュー結果

**仕様網羅:** 設計書の 6 節はそれぞれ Task 1（§2）、Task 2（§1 の prepare 担当・§6 の掃除）、Task 3（§1 の commit 担当・§5）、Task 4（§3・§4）、Task 5（影響範囲の文書とバージョン）、Task 6（検証）に対応する。設計書「影響範囲」が挙げた改修対象はすべてどこかのタスクに含まれる。

**型の一貫性:** `sessionTitleFile` / `headerFile` / `sessionNumber` の名前は Task 2 の Produces で定義し、Task 3 の Consumes と Task 4 の chat-recorder 手順で同じ名前を使っている。CLI フラグ `--session-title-file` / `--header-file` も Task 3 と Task 4 で一致している。
