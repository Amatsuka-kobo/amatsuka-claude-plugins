// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §6・§11 の検証。
// ケース ID は metatron 設計書 §13-1 の gotchas.ts の表(G1〜G22)に対応する。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, expect, test } from "vitest"
import {
  appendGotcha,
  filterGotchas,
  GotchaError,
  type GotchaErrorCode,
  LOCK_STALE_MS,
  lockPathFor,
  parseGotchas,
  tagGotcha,
  withFileLock
} from "../lib/gotchas.js"
import { runTsAsync } from "../testing/run-ts.js"

const APPEND_ENTRY_SCRIPT = fileURLToPath(
  new URL("../testing/append-gotcha-entry.ts", import.meta.url)
)

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 後始末の失敗はテスト結果に影響させない
    }
  }
})

function mkTmp(): string {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-gotchas-"))
  const dir = fs.realpathSync(raw)
  tmpDirs.push(dir)
  return dir
}

const TEMPLATE_SECTION = [
  "## 記入テンプレート",
  "",
  "### [2026-01-01] GOTCHA-999: 失敗のタイトル",
  "",
  "**タスク**: (何をしようとしていたか)",
  "**失敗内容**: (具体的に何を間違えたか)",
  "**原因 (推測)**: (なぜそうなったか)",
  "**対策**: (今後 AI はどう振る舞うべきか)",
  "**昇格候補**: Yes / No (スキルや Hook にするべきか)"
]

interface EntryOptions {
  date?: string
  tag?: string
  title?: string
  promotion?: "Yes" | "No"
}

function entryBlock(num: number, opts: EntryOptions = {}): string {
  const id = `GOTCHA-${String(num).padStart(3, "0")}`
  const tagPart = opts.tag === undefined ? "" : `[${opts.tag}] `
  return [
    `### [${opts.date ?? "2026-08-10"}] ${id}: ${tagPart}${opts.title ?? `失敗 ${num}`}`,
    "",
    `**タスク**: タスク ${num}`,
    `**失敗内容**: 失敗内容 ${num}`,
    `**原因 (推測)**: 原因 ${num}`,
    `**対策**: 対策 ${num} を実行する前に対象を Read して確認する`,
    `**昇格候補**: ${opts.promotion ?? "No"}`
  ].join("\n")
}

function ledger(blocks: string[], opts: { template?: boolean } = {}): string {
  const parts = [
    "# GOTCHAS",
    "",
    "このプロジェクトで AI が実際にやってしまった失敗のパターンを蓄積する。",
    ""
  ]
  if (opts.template !== false) parts.push(...TEMPLATE_SECTION, "")
  parts.push("## 失敗パターン一覧", "")
  if (blocks.length > 0) parts.push(blocks.join("\n\n"), "")
  return parts.join("\n")
}

function writeLedger(dir: string, text: string): string {
  const filePath = path.join(dir, "docs", "GOTCHAS.md")
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
  return filePath
}

const VALID_INPUT = {
  title: "新しい失敗",
  date: "2026-08-16",
  task: "何かをしようとした",
  mistake: "何かを間違えた",
  cause: "前提を確認しなかった",
  countermeasure: "編集する前に対象ファイルを Read して確認する",
  promotionCandidate: "No"
} as const

function expectGotchaError(
  fn: () => unknown,
  code: GotchaErrorCode
): GotchaError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(GotchaError)
    const err = error as GotchaError
    expect(err.code).toBe(code)
    return err
  }
  throw new Error(`GotchaError(${code}) が投げられませんでした`)
}

// ---------------------------------------------------------------------------
// 採番と挿入
// ---------------------------------------------------------------------------

test("G1: 空台帳への追記 → 雛形ごと作成され GOTCHA-001 が採番される", () => {
  const dir = mkTmp()
  const filePath = path.join(dir, "docs", "GOTCHAS.md")

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  expect(result.id).toBe("GOTCHA-001")
  expect(result.created).toBe(true)
  const text = fs.readFileSync(filePath, "utf8")
  expect(text.startsWith("# GOTCHAS")).toBe(true)
  expect(text).toContain("## 運用ルール")
  expect(text).toContain("## 記入テンプレート")
  expect(text).toContain("## 失敗パターン一覧")
  expect(text).toContain("### [2026-08-16] GOTCHA-001: 新しい失敗")

  const doc = parseGotchas(text)
  expect(doc.entries.map((e) => e.id)).toStrictEqual(["GOTCHA-001"])
  expect(doc.entries[0].promotionCandidate).toBe("No")
})

test("G1: 空ファイルの台帳も雛形ごと作り直す(既存の記述が無いため)", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, "   \n\n")

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  expect(result.id).toBe("GOTCHA-001")
  expect(result.created).toBe(true)
  expect(fs.readFileSync(filePath, "utf8")).toContain("## 運用ルール")
})

test("G2: 既存 6 件への追記 → GOTCHA-007", () => {
  const dir = mkTmp()
  const blocks = [6, 5, 4, 3, 2, 1].map((n) => entryBlock(n))
  const filePath = writeLedger(dir, ledger(blocks))

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  expect(result.id).toBe("GOTCHA-007")
  expect(parseGotchas(fs.readFileSync(filePath, "utf8")).entries).toHaveLength(
    7
  )
})

test("G3: 番号が飛んでいる台帳(001, 005)→ GOTCHA-006", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(5), entryBlock(1)]))

  expect(appendGotcha(filePath, { ...VALID_INPUT }).id).toBe("GOTCHA-006")
})

test("G4: 追記後、既存エントリがバイト単位で不変", () => {
  const dir = mkTmp()
  const before = ledger([entryBlock(2), entryBlock(1)])
  const filePath = writeLedger(dir, before)

  const firstEntryAt = before.indexOf("### [2026-08-10] GOTCHA-002")
  const existingTail = before.slice(firstEntryAt)

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  const after = fs.readFileSync(filePath, "utf8")
  // 既存エントリ以降が 1 バイトも変わらずそのまま含まれている
  expect(after).toContain(existingTail)
  // 追記前の冒頭(雛形と節見出し)も 1 バイトも変わらない
  expect(after.startsWith(before.slice(0, firstEntryAt))).toBe(true)
  // 新エントリは冒頭と既存エントリの間にだけ入り、変更はその挿入だけである
  const inserted = after.slice(firstEntryAt, after.length - existingTail.length)
  expect(inserted).toContain(`${result.id}: 新しい失敗`)
  expect(`${before.slice(0, firstEntryAt)}${inserted}${existingTail}`).toBe(
    after
  )
})

test("G5: 新エントリが `## 失敗パターン一覧` の直下(先頭)に入る", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(2), entryBlock(1)]))

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  expect(doc.entries.map((e) => e.id)).toStrictEqual([
    result.id,
    "GOTCHA-002",
    "GOTCHA-001"
  ])
  // 節見出しと新エントリの間に他のエントリが挟まっていない
  const listSection = doc.listSection
  expect(listSection).not.toBeNull()
  if (listSection !== null) {
    expect(doc.entries[0].startIndex).toBe(listSection.headingIndex + 2)
  }
})

test("G6: `## 記入テンプレート` の GOTCHA-999 をエントリとして数えない", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  expect(doc.entries.map((e) => e.id)).toStrictEqual(["GOTCHA-001"])
  expect(doc.maxNumber).toBe(1)

  // 採番にも影響しない(999 に引きずられない)
  expect(appendGotcha(filePath, { ...VALID_INPUT }).id).toBe("GOTCHA-002")
})

test("G7: 手編集で並びが崩れた台帳でも全件走査で最大値 + 1 になる", () => {
  const dir = mkTmp()
  // 先頭が最大でない(005 → 002 → 004 の順)
  const filePath = writeLedger(
    dir,
    ledger([entryBlock(5), entryBlock(2), entryBlock(4)])
  )

  expect(appendGotcha(filePath, { ...VALID_INPUT }).id).toBe("GOTCHA-006")
})

// ---------------------------------------------------------------------------
// タグ付与
// ---------------------------------------------------------------------------

test("G8: tag-gotcha --tag 解決済み → 見出しにタグ、末尾に理由行、本文は不変", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(2), entryBlock(1)]))
  const before = fs.readFileSync(filePath, "utf8")

  const result = tagGotcha(filePath, {
    id: "GOTCHA-001",
    tag: "解決済み",
    reason: "原因を取り除いた",
    date: "2026-08-20"
  })

  expect(result.previousTag).toBeNull()
  expect(result.tag).toBe("解決済み")

  const after = fs.readFileSync(filePath, "utf8")

  const taggedHeading = "### [2026-08-10] GOTCHA-001: [解決済み] 失敗 1"
  const originalHeading = "### [2026-08-10] GOTCHA-001: 失敗 1"
  const reasonLine = "**[解決済み] (2026-08-20)**: 原因を取り除いた"

  // 変更は「見出しへのタグ挿入」と「エントリ末尾への理由行 1 行の追記」の 2 箇所だけ。
  // 差分箇所だけを取り除いたものが before と完全一致することを見る(R-A5 と同じ手法)。
  // 部分文字列の存在確認では、行順の入れ替え・フィールド間への空行や空白の混入・
  // 別エントリ内の同一文字列との偶然一致を検出できない。
  expect(after.split(taggedHeading)).toHaveLength(2)
  expect(after.split(`\n${reasonLine}`)).toHaveLength(2)
  const restored = after
    .replace(`\n${reasonLine}`, "")
    .replace(taggedHeading, originalHeading)
  expect(restored).toBe(before)

  // 本文(5 フィールド)は同じ位置から切り出して 1 バイトも変わらない。
  const bodyAt = (text: string, heading: string): string =>
    text.slice(text.indexOf(heading) + heading.length)
  expect(bodyAt(after, taggedHeading).replace(`\n${reasonLine}`, "")).toBe(
    bodyAt(before, originalHeading)
  )
  expect(
    bodyAt(after, taggedHeading)
      .split("\n")
      .filter((line) => line.startsWith("**"))
  ).toStrictEqual([
    "**タスク**: タスク 1",
    "**失敗内容**: 失敗内容 1",
    "**原因 (推測)**: 原因 1",
    "**対策**: 対策 1 を実行する前に対象を Read して確認する",
    "**昇格候補**: No",
    reasonLine
  ])

  // 理由行はエントリ末尾(最後のフィールド行の直後)に入る。
  const headingAt = after.indexOf(taggedHeading)
  const reasonAt = after.indexOf(reasonLine)
  expect(reasonAt).toBeGreaterThan(headingAt)
  expect(after.slice(headingAt, reasonAt)).toBe(
    `${taggedHeading}\n\n**タスク**: タスク 1\n**失敗内容**: 失敗内容 1\n**原因 (推測)**: 原因 1\n**対策**: 対策 1 を実行する前に対象を Read して確認する\n**昇格候補**: No\n`
  )

  // 他のエントリの見出しは不変
  expect(after).toContain("### [2026-08-10] GOTCHA-002: 失敗 2")

  const doc = parseGotchas(after)
  const tagged = doc.entries.find((e) => e.id === "GOTCHA-001")
  expect(tagged?.tag).toBe("解決済み")
  expect(tagged?.title).toBe("失敗 1")
  expect(tagged?.countermeasure).toBe(
    "対策 1 を実行する前に対象を Read して確認する"
  )
})

test("G9: 再付与(解決済み → 対象外)で見出しは差し替わり理由行は追記される", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))

  tagGotcha(filePath, {
    id: "GOTCHA-001",
    tag: "解決済み",
    reason: "原因を取り除いた",
    date: "2026-08-20"
  })
  const second = tagGotcha(filePath, {
    id: "GOTCHA-001",
    tag: "対象外",
    reason: "設計変更で前提が変わった",
    date: "2026-08-21"
  })

  expect(second.previousTag).toBe("解決済み")

  const after = fs.readFileSync(filePath, "utf8")
  expect(after).toContain("### [2026-08-10] GOTCHA-001: [対象外] 失敗 1")
  expect(after).not.toContain("[解決済み] 失敗 1")
  // 前の理由行も残る
  expect(after).toContain("**[解決済み] (2026-08-20)**: 原因を取り除いた")
  expect(after).toContain("**[対象外] (2026-08-21)**: 設計変更で前提が変わった")

  expect(parseGotchas(after).entries[0].tag).toBe("対象外")
})

test("G10: --tag の値域外は拒否され、書き込みも起きない", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))
  const before = fs.readFileSync(filePath, "utf8")

  expectGotchaError(
    () =>
      tagGotcha(filePath, {
        id: "GOTCHA-001",
        tag: "無効",
        reason: "理由"
      }),
    "invalid_tag"
  )

  expect(fs.readFileSync(filePath, "utf8")).toBe(before)
  expect(fs.existsSync(lockPathFor(filePath))).toBe(false)
})

test("G11: 存在しない ID へのタグ付与は拒否され、書き込みも起きない", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))
  const before = fs.readFileSync(filePath, "utf8")

  expectGotchaError(
    () =>
      tagGotcha(filePath, {
        id: "GOTCHA-999",
        tag: "解決済み",
        reason: "理由"
      }),
    "not_found"
  )

  expect(fs.readFileSync(filePath, "utf8")).toBe(before)
  expect(fs.existsSync(lockPathFor(filePath))).toBe(false)
})

// ---------------------------------------------------------------------------
// 入力検証
// ---------------------------------------------------------------------------

test("G12: promotionCandidate が Yes / No 以外なら拒否し、書き込まない", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))
  const before = fs.readFileSync(filePath, "utf8")

  for (const value of ["yes", "YES", "はい", ""]) {
    expectGotchaError(
      () =>
        appendGotcha(filePath, { ...VALID_INPUT, promotionCandidate: value }),
      "invalid_input"
    )
  }

  expect(fs.readFileSync(filePath, "utf8")).toBe(before)
})

test("G13: 精神論のみの対策は警告を返すが書き込みは行われる", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))

  const result = appendGotcha(filePath, {
    ...VALID_INPUT,
    countermeasure: "気をつける"
  })

  expect(result.id).toBe("GOTCHA-002")
  expect(result.warnings.some((w) => w.includes("精神論"))).toBe(true)
  expect(fs.readFileSync(filePath, "utf8")).toContain("**対策**: 気をつける")

  const empty = appendGotcha(filePath, {
    ...VALID_INPUT,
    countermeasure: "   "
  })
  expect(empty.id).toBe("GOTCHA-003")
  expect(empty.warnings.some((w) => w.includes("countermeasure が空"))).toBe(
    true
  )
})

// ---------------------------------------------------------------------------
// ロック(契約 §11)
// ---------------------------------------------------------------------------

test("G14: append-gotcha を 5 プロセス同時実行しても採番が重複しない", async () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([]))
  const barrier = path.join(dir, "barrier")
  fs.mkdirSync(barrier, { recursive: true })

  const titles = [1, 2, 3, 4, 5].map((n) => `同時実行 ${n}`)
  const runs = titles.map((title) =>
    runTsAsync(APPEND_ENTRY_SCRIPT, [filePath, title, barrier])
  )

  // 5 プロセスすべてが起動を終えるまで待ってから一斉に走らせる
  // (tsx の起動時間の差で競合が起きないまま通ってしまうのを防ぐ)
  const deadline = Date.now() + 30_000
  while (
    fs.readdirSync(barrier).filter((f) => f.startsWith("ready.")).length < 5
  ) {
    if (Date.now() > deadline) throw new Error("子プロセスが起動しませんでした")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  fs.writeFileSync(path.join(barrier, "go"), "")

  const results = await Promise.all(runs)
  const ids = results
    .map((r) => JSON.parse(r.stdout) as { id: string })
    .map((r) => r.id)
    .sort()

  expect(ids).toStrictEqual([
    "GOTCHA-001",
    "GOTCHA-002",
    "GOTCHA-003",
    "GOTCHA-004",
    "GOTCHA-005"
  ])

  // 全エントリが失われずに残っている
  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  expect(doc.entries.map((e) => e.id).sort()).toStrictEqual(ids)
  expect(doc.entries.map((e) => e.title).sort()).toStrictEqual(
    [...titles].sort()
  )
  expect(fs.existsSync(lockPathFor(filePath))).toBe(false)
}, 60_000)

test("G15: 新しいロックファイルが残っていると lock_timeout で拒否する", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))
  const before = fs.readFileSync(filePath, "utf8")
  fs.writeFileSync(lockPathFor(filePath), "other-process\n")

  const started = Date.now()
  expectGotchaError(
    () => appendGotcha(filePath, { ...VALID_INPUT }),
    "lock_timeout"
  )

  // 50ms × 20 回のリトライを尽くしている(合計約 1 秒)
  expect(Date.now() - started).toBeGreaterThanOrEqual(800)
  expect(fs.readFileSync(filePath, "utf8")).toBe(before)
  // 他プロセスのロックは奪わずに残す
  expect(fs.existsSync(lockPathFor(filePath))).toBe(true)
})

test("G16: 60 秒より古いロックファイルは死んだロックとして奪う", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))
  const lockPath = lockPathFor(filePath)
  fs.writeFileSync(lockPath, "dead-process\n")
  const stale = (Date.now() - LOCK_STALE_MS * 2) / 1000
  fs.utimesSync(lockPath, stale, stale)

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  expect(result.id).toBe("GOTCHA-002")
  expect(fs.readFileSync(filePath, "utf8")).toContain(
    "### [2026-08-16] GOTCHA-002: 新しい失敗"
  )
  expect(fs.existsSync(lockPath)).toBe(false)
})

test("G17: 書き込み後にロックファイルが残っていない", () => {
  const dir = mkTmp()
  const filePath = writeLedger(dir, ledger([entryBlock(1)]))

  appendGotcha(filePath, { ...VALID_INPUT })
  expect(fs.existsSync(lockPathFor(filePath))).toBe(false)

  tagGotcha(filePath, {
    id: "GOTCHA-001",
    tag: "解決済み",
    reason: "原因を取り除いた"
  })
  expect(fs.existsSync(lockPathFor(filePath))).toBe(false)
})

// ---------------------------------------------------------------------------
// タグの検出規則(契約 §6-4)
// ---------------------------------------------------------------------------

test("G18: タイトル内の角括弧はタグとして扱わない", () => {
  const dir = mkTmp()
  const filePath = writeLedger(
    dir,
    ledger([
      entryBlock(1, { title: "[Prisma] マイグレーションを二重適用した" })
    ])
  )

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  const entry = doc.entries[0]
  expect(entry.tag).toBeNull()
  expect(entry.title).toBe("[Prisma] マイグレーションを二重適用した")

  // --exclude-tagged で除外されない
  expect(filterGotchas(doc.entries, { excludeTagged: true })).toHaveLength(1)
})

test("G19: 規定外の位置・形のタグは認識しない(タグ無し扱い)", () => {
  const dir = mkTmp()
  const text = ledger([
    // 末尾に置いた
    "### [2026-08-10] GOTCHA-004: 失敗 4 [解決済み]\n\n**タスク**: t\n**失敗内容**: m\n**原因 (推測)**: c\n**対策**: 対象を Read する\n**昇格候補**: No",
    // 区切りが半角スペース 2 個
    "### [2026-08-10] GOTCHA-003:  [解決済み] 失敗 3\n\n**タスク**: t\n**失敗内容**: m\n**原因 (推測)**: c\n**対策**: 対象を Read する\n**昇格候補**: No",
    // リテラルが変形している
    "### [2026-08-10] GOTCHA-002: [ 解決済み ] 失敗 2\n\n**タスク**: t\n**失敗内容**: m\n**原因 (推測)**: c\n**対策**: 対象を Read する\n**昇格候補**: No",
    // 日付の位置にあるものはタグではない
    "### [解決済み] GOTCHA-001: 失敗 1\n\n**タスク**: t\n**失敗内容**: m\n**原因 (推測)**: c\n**対策**: 対象を Read する\n**昇格候補**: No"
  ])
  const filePath = writeLedger(dir, text)

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  // 日付の位置が壊れている GOTCHA-001 はエントリとして解析されない
  expect(doc.entries.map((e) => e.id)).toStrictEqual([
    "GOTCHA-004",
    "GOTCHA-003",
    "GOTCHA-002"
  ])
  for (const entry of doc.entries) expect(entry.tag).toBeNull()
  expect(filterGotchas(doc.entries, { excludeTagged: true })).toHaveLength(3)
})

// ---------------------------------------------------------------------------
// フィルタ(5 件ルールの集計)
// ---------------------------------------------------------------------------

test("G20: --promotion-candidates は 昇格候補: Yes のエントリだけを返す", () => {
  const dir = mkTmp()
  const filePath = writeLedger(
    dir,
    ledger([
      entryBlock(3, { promotion: "Yes" }),
      entryBlock(2, { promotion: "No" }),
      entryBlock(1, { promotion: "Yes" })
    ])
  )

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  const ids = filterGotchas(doc.entries, { promotionCandidates: true }).map(
    (e) => e.id
  )
  expect(ids).toStrictEqual(["GOTCHA-003", "GOTCHA-001"])
})

test("G21: --promotion-candidates + --exclude-tagged は Yes かつタグ無しだけを返す", () => {
  const dir = mkTmp()
  const filePath = writeLedger(
    dir,
    ledger([
      entryBlock(3, { promotion: "Yes", tag: "解決済み" }),
      entryBlock(2, { promotion: "Yes" }),
      entryBlock(1, { promotion: "No", tag: "対象外" })
    ])
  )

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  expect(doc.entries.map((e) => e.tag)).toStrictEqual([
    "解決済み",
    null,
    "対象外"
  ])
  const ids = filterGotchas(doc.entries, {
    promotionCandidates: true,
    excludeTagged: true
  }).map((e) => e.id)
  expect(ids).toStrictEqual(["GOTCHA-002"])
})

// ---------------------------------------------------------------------------
// ロックの独立性(契約 §11「2 文書のロックは独立しており、互いをブロックしない」)
// ---------------------------------------------------------------------------

test("G22: gotchas のロックは architecture のロックを取らない(互いをブロックしない)", () => {
  const dir = mkTmp()
  const gotchasPath = writeLedger(dir, ledger([entryBlock(1)]))
  const architecturePath = path.join(dir, "docs", "ARCHITECTURE.md")
  fs.writeFileSync(architecturePath, "# ARCHITECTURE\n")

  // ARCHITECTURE 側のロックを保持したまま append-gotcha が通る
  const architectureLock = lockPathFor(architecturePath)
  fs.writeFileSync(architectureLock, "stage-adr\n")
  const appended = appendGotcha(gotchasPath, { ...VALID_INPUT })
  expect(appended.id).toBe("GOTCHA-002")
  expect(fs.existsSync(architectureLock)).toBe(true)
  fs.rmSync(architectureLock)

  // 逆向き: GOTCHAS のロックを保持したまま ARCHITECTURE のロックが取れる
  const acquired = withFileLock(gotchasPath, () => {
    expect(fs.existsSync(lockPathFor(gotchasPath))).toBe(true)
    return withFileLock(architecturePath, () => "ok")
  })
  expect(acquired).toBe("ok")
  expect(fs.existsSync(lockPathFor(gotchasPath))).toBe(false)
  expect(fs.existsSync(architectureLock)).toBe(false)
})

// ---------------------------------------------------------------------------
// 節が無い台帳・コードフェンス(契約 §6-3・§4-2)
// ---------------------------------------------------------------------------

test("`## 失敗パターン一覧` 節が無い台帳は節ごと作成し、既存の記述を保持する", () => {
  const dir = mkTmp()
  const before =
    "# GOTCHAS\n\n手書きのメモ。\n\n## 運用ルール\n\n- 削除しない。\n"
  const filePath = writeLedger(dir, before)

  const result = appendGotcha(filePath, { ...VALID_INPUT })

  expect(result.id).toBe("GOTCHA-001")
  expect(result.sectionCreated).toBe(true)
  const after = fs.readFileSync(filePath, "utf8")
  expect(after).toContain("手書きのメモ。")
  expect(after).toContain("- 削除しない。")
  expect(after).toContain("## 失敗パターン一覧")
  expect(parseGotchas(after).entries.map((e) => e.id)).toStrictEqual([
    "GOTCHA-001"
  ])
})

test("コードフェンス内の `###` `##` を見出しとして扱わない", () => {
  const dir = mkTmp()
  const fenced = [
    "### [2026-08-10] GOTCHA-001: フェンスを含むエントリ",
    "",
    "**タスク**: t",
    "**失敗内容**: m",
    "**原因 (推測)**: c",
    "**対策**: 対象を Read する",
    "**昇格候補**: No",
    "",
    "```markdown",
    "## 失敗パターン一覧",
    "### [2026-08-10] GOTCHA-500: これは例示であってエントリではない",
    "```"
  ].join("\n")
  const filePath = writeLedger(dir, ledger([fenced]))

  const doc = parseGotchas(fs.readFileSync(filePath, "utf8"))
  expect(doc.entries.map((e) => e.id)).toStrictEqual(["GOTCHA-001"])
  expect(appendGotcha(filePath, { ...VALID_INPUT }).id).toBe("GOTCHA-002")
})

test("CRLF の台帳でも採番・挿入が壊れず、改行コードが保たれる", () => {
  const dir = mkTmp()
  const before = ledger([entryBlock(1)]).replace(/\n/g, "\r\n")
  const filePath = writeLedger(dir, before)

  const result = appendGotcha(filePath, { ...VALID_INPUT })
  expect(result.id).toBe("GOTCHA-002")

  const after = fs.readFileSync(filePath, "utf8")
  expect(after).toContain("### [2026-08-16] GOTCHA-002: 新しい失敗\r\n")
  expect(after).toContain(before.slice(before.indexOf("### [2026-08-10]")))
  expect(/[^\r]\n/.test(after)).toBe(false)
})
