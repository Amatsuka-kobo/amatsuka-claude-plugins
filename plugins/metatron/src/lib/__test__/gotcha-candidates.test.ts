// 持続層の `[GOTCHAS 候補]` の走査と削除(記録のタイミングとサブエージェントへの注入の
// 設計書 2-1、7 の `gotcha-candidates.test.ts` の項目)の検証。
// 書式の正本は codiel の `references/intent-format.md` の「GOTCHAS 候補」。

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test, vi } from "vitest"
import { loadConfig } from "../config.js"
import {
  GotchaCandidateError,
  type GotchaCandidateErrorCode,
  removeGotchaCandidate,
  scanGotchaCandidates
} from "../gotcha-candidates.js"
import { hashContent } from "../staging.js"

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
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-gotcha-cand-"))
  const dir = fs.realpathSync(raw)
  tmpDirs.push(dir)
  return dir
}

function repo(): string {
  const root = mkTmp()
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" })
  return root
}

function writeFile(
  root: string,
  relative: string,
  body: string | Buffer
): string {
  const abs = path.join(root, relative)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
  return abs
}

function writeDomain(
  root: string,
  name: string,
  body: string | Buffer
): string {
  return writeFile(root, `docs/intents/domains/${name}`, body)
}

// ---------------------------------------------------------------------------
// フィクスチャ
// ---------------------------------------------------------------------------

/** 印付きのエントリ。`omit` に挙げたキーの行は書かない。 */
function entry(
  title: string,
  options: { omit?: string[]; values?: Record<string, string> } = {}
): string[] {
  const values: Record<string, string> = {
    date: "2026-10-01",
    run: "login-rework try-2",
    task: `${title} の作業`,
    mistake: `${title} の失敗`,
    cause: `${title} の原因`,
    countermeasure: `${title} の対策`,
    promotionCandidate: "Yes",
    ...options.values
  }
  const lines = [`### ${title} [GOTCHAS 候補]`]
  for (const [key, value] of Object.entries(values)) {
    if (options.omit?.includes(key)) continue
    lines.push(`- ${key}: ${value}`)
  }
  return lines
}

/** `## GOTCHAS 候補` を末尾近くに持つ領域ファイル。 */
function durable(parent: string, ...entries: string[][]): string {
  return [
    "# frontend",
    "",
    "## 目的",
    "",
    "画面を提供する。",
    "",
    `## ${parent}`,
    "",
    ...entries.flatMap((e) => [...e, ""]),
    "## 由来",
    "",
    "- docs/intents/2026-09-30-login-rework.md(取り込み日 2026-10-02)",
    ""
  ].join("\n")
}

function ledger(titles: string[]): string {
  return [
    "# GOTCHAS",
    "",
    "## 失敗パターン一覧",
    "",
    ...titles.flatMap((title, i) => [
      `### [2026-08-10] GOTCHA-${String(i + 1).padStart(3, "0")}: ${title}`,
      "",
      "**タスク**: 何かをしようとした",
      "**失敗内容**: 間違えた",
      "**原因 (推測)**: 確認しなかった",
      "**対策**: 実行前に対象ファイルを Read して確認する",
      "**昇格候補**: No",
      ""
    ])
  ].join("\n")
}

function scan(cwd: string) {
  const config = loadConfig(cwd)
  return scanGotchaCandidates(config.docRoot, config.gotchasPath)
}

function find(cwd: string, title: string) {
  const found = scan(cwd).candidates.find((c) => c.title === title)
  if (found === undefined) throw new Error(`${title} が走査で見つからない`)
  return found
}

function remove(
  cwd: string,
  file: string,
  hash: string,
  fileHash: string = hashContent(fs.readFileSync(file))
) {
  const config = loadConfig(cwd)
  return removeGotchaCandidate({
    docRoot: config.docRoot,
    file,
    hash,
    fileHash
  })
}

function expectRejected(
  fn: () => unknown,
  code: GotchaCandidateErrorCode
): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught, `${code} で拒否されなかった`).toBeInstanceOf(
    GotchaCandidateError
  )
  expect((caught as GotchaCandidateError).code).toBe(code)
}

// ---------------------------------------------------------------------------
// 走査
// ---------------------------------------------------------------------------

test("走査: git リポジトリでなければ、領域ファイルがあっても走査しない", () => {
  const root = mkTmp()
  expect(
    spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root }).status
  ).not.toBe(0)
  writeDomain(root, "frontend.md", durable("GOTCHAS 候補", entry("失敗 A")))

  const result = scan(root)

  expect(result.repoRoot).toBeNull()
  expect(result.candidates).toStrictEqual([])
})

test("走査: docs/intents/domains/ が無い、または印付きエントリが無ければ candidates は空", () => {
  const root = repo()
  expect(scan(root)).toMatchObject({ repoRoot: root, candidates: [] })
  expect(scan(root).warnings).toStrictEqual([])

  writeDomain(root, "frontend.md", durable("意図的な制約", ["### 普通の制約"]))
  expect(scan(root).candidates).toStrictEqual([])
})

test("走査: 印付きのエントリを、見出し・タイトル・キー・ハッシュつきで返す", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("キャッシュを消し忘れた"))
  )

  const result = scan(root)

  expect(result.warnings).toStrictEqual([])
  expect(result.candidates).toHaveLength(1)
  const [candidate] = result.candidates
  expect(candidate.file).toBe(file)
  expect(candidate.relative).toBe("docs/intents/domains/frontend.md")
  expect(candidate.heading).toBe("### キャッシュを消し忘れた [GOTCHAS 候補]")
  expect(candidate.title).toBe("キャッシュを消し忘れた")
  expect(candidate.fields).toStrictEqual({
    date: "2026-10-01",
    run: "login-rework try-2",
    task: "キャッシュを消し忘れた の作業",
    mistake: "キャッシュを消し忘れた の失敗",
    cause: "キャッシュを消し忘れた の原因",
    countermeasure: "キャッシュを消し忘れた の対策",
    promotionCandidate: "Yes"
  })
  expect(candidate.problems).toStrictEqual([])
  expect(candidate.ledgerMatches).toStrictEqual([])

  // hash はエントリの範囲(見出しから次の `##` の直前まで。末尾の空行を含む)、
  // fileHash はファイル全体のバイト列の sha256。
  const text = fs.readFileSync(file, "utf8")
  const start = text.indexOf("### キャッシュ")
  const end = text.indexOf("## 由来")
  expect(candidate.hash).toBe(hashContent(text.slice(start, end)))
  expect(candidate.fileHash).toBe(hashContent(fs.readFileSync(file)))
})

test("走査: エントリの範囲は次の `###` か `##` の直前までで、親の `##` 見出しを問わない", () => {
  const root = repo()
  const body = [
    "# frontend",
    "",
    "## 意図的な制約",
    "",
    ...entry("失敗 A"),
    "",
    "### 普通の制約",
    "- 制約: これは候補ではない",
    "",
    ...entry("失敗 B"),
    "",
    "## GOTCHAS 候補",
    "",
    ...entry("失敗 C"),
    "",
    "#### 小見出しは範囲の中",
    "- mistake: 上書きしない",
    "",
    "## 由来",
    ""
  ].join("\n")
  const file = writeDomain(root, "frontend.md", body)

  const { candidates } = scan(root)

  expect(candidates.map((c) => c.title)).toStrictEqual([
    "失敗 A",
    "失敗 B",
    "失敗 C"
  ])
  const text = fs.readFileSync(file, "utf8")
  const ranges = [
    text.slice(text.indexOf("### 失敗 A"), text.indexOf("### 普通の制約")),
    text.slice(text.indexOf("### 失敗 B"), text.indexOf("## GOTCHAS 候補")),
    text.slice(text.indexOf("### 失敗 C"), text.indexOf("## 由来"))
  ]
  expect(candidates.map((c) => c.hash)).toStrictEqual(
    ranges.map((r) => hashContent(r))
  )
  // 範囲の中の `####` の下の行も、最初に現れたキーの行が優先される。
  expect(candidates[2].fields.mistake).toBe("失敗 C の失敗")
})

test("走査: コードフェンスの中の見出しは候補にしない", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    [
      "# frontend",
      "",
      "## GOTCHAS 候補",
      "",
      "```markdown",
      ...entry("例の中の失敗"),
      "```",
      "",
      ...entry("本物の失敗"),
      ""
    ].join("\n")
  )

  const { candidates } = scan(root)

  expect(candidates.map((c) => c.title)).toStrictEqual(["本物の失敗"])
})

test("走査: 値の前後の空白を落とし、未知のキーの行は無視する", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", [
      "### 空白のある失敗   [GOTCHAS 候補]  ",
      "- date:   2026-10-01  ",
      "- run: login-rework try-1",
      "- 写し先: GOTCHA-009",
      "- task:\t作業",
      "- mistake: 失敗",
      "- cause: 原因",
      "- countermeasure: 対策",
      "- promotionCandidate: No   "
    ])
  )

  const [candidate] = scan(root).candidates

  expect(candidate.title).toBe("空白のある失敗")
  expect(candidate.fields).toStrictEqual({
    date: "2026-10-01",
    run: "login-rework try-1",
    task: "作業",
    mistake: "失敗",
    cause: "原因",
    countermeasure: "対策",
    promotionCandidate: "No"
  })
  expect(candidate.problems).toStrictEqual([])
  expect(JSON.stringify(candidate)).not.toContain("GOTCHA-009")
})

test("走査: キーの行が無い・値が空のキーは null にして problems に載せる", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    durable(
      "GOTCHAS 候補",
      entry("run が無い", { omit: ["run"] }),
      entry("cause が空", { values: { cause: "" } })
    )
  )

  const { candidates, warnings } = scan(root)

  expect(warnings).toStrictEqual([])
  expect(candidates[0].fields.run).toBeNull()
  expect(candidates[0].problems).toHaveLength(1)
  expect(candidates[0].problems[0]).toContain("run")
  expect(candidates[1].fields.cause).toBeNull()
  expect(candidates[1].problems).toHaveLength(1)
  expect(candidates[1].problems[0]).toContain("cause")
})

test("走査: promotionCandidate が Yes/No 以外なら problems に載せる", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    durable(
      "GOTCHAS 候補",
      entry("値が崩れている", { values: { promotionCandidate: "たぶん" } }),
      entry("No は正しい", { values: { promotionCandidate: "No" } })
    )
  )

  const { candidates } = scan(root)

  expect(candidates[0].problems).toHaveLength(1)
  expect(candidates[0].problems[0]).toContain("promotionCandidate")
  expect(candidates[0].fields.promotionCandidate).toBe("たぶん")
  expect(candidates[1].problems).toStrictEqual([])
})

test("走査: ledgerMatches は台帳のエントリのうちタイトルが完全一致するものの ID を返す", () => {
  const root = repo()
  writeFile(
    root,
    "docs/GOTCHAS.md",
    ledger(["同じ失敗", "別の失敗", "同じ失敗", "同じ失敗 の続き"])
  )
  writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("同じ失敗"), entry("台帳に無い失敗"))
  )

  const { candidates } = scan(root)

  expect(candidates[0].ledgerMatches).toStrictEqual([
    "GOTCHA-001",
    "GOTCHA-003"
  ])
  expect(candidates[1].ledgerMatches).toStrictEqual([])
})

test("走査: 台帳が無ければ ledgerMatches は空で、warnings も出ない", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable("GOTCHAS 候補", entry("失敗 A")))

  const result = scan(root)

  expect(result.candidates[0].ledgerMatches).toStrictEqual([])
  expect(result.warnings).toStrictEqual([])
})

test("走査: 複数の領域ファイルを名前順に走査し、fileHash はファイルごとに違う", () => {
  const root = repo()
  writeDomain(root, "b.md", durable("GOTCHAS 候補", entry("失敗 B")))
  writeDomain(root, "a.md", durable("GOTCHAS 候補", entry("失敗 A")))

  const { candidates } = scan(root)

  expect(candidates.map((c) => c.relative)).toStrictEqual([
    "docs/intents/domains/a.md",
    "docs/intents/domains/b.md"
  ])
  expect(candidates[0].fileHash).not.toBe(candidates[1].fileHash)
})

// ---------------------------------------------------------------------------
// 削除
// ---------------------------------------------------------------------------

test("削除: エントリの範囲だけを消し、範囲の外は 1 バイトも変えない", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"), entry("失敗 B"), entry("失敗 C"))
  )
  const target = find(root, "失敗 B")

  const result = remove(root, file, target.hash)

  expect(result).toStrictEqual({ file, title: "失敗 B" })
  expect(fs.readFileSync(file, "utf8")).toBe(
    durable("GOTCHAS 候補", entry("失敗 A"), entry("失敗 C"))
  )
  expect(scan(root).candidates.map((c) => c.title)).toStrictEqual([
    "失敗 A",
    "失敗 C"
  ])
})

test("削除: CRLF と不正な UTF-8 を含むファイルでも、範囲の外は 1 バイトも変わらない", () => {
  const root = repo()
  const invalid = Buffer.from([0xff, 0xfe, 0xc3])
  const prefix = Buffer.concat([
    Buffer.from("# frontend\r\n\r\n## 目的\r\n\r\n", "utf8"),
    invalid,
    Buffer.from("\r\n\r\n## GOTCHAS 候補\r\n\r\n", "utf8"),
    Buffer.from(`${entry("失敗 A").join("\r\n")}\r\n\r\n`, "utf8")
  ])
  const suffix = Buffer.concat([
    Buffer.from("## 由来\r\n\r\n", "utf8"),
    invalid,
    Buffer.from("\r\n\r\nなし", "utf8")
  ])
  const file = writeDomain(
    root,
    "frontend.md",
    Buffer.concat([
      prefix,
      Buffer.from(`${entry("失敗 B").join("\r\n")}\r\n\r\n`, "utf8"),
      suffix
    ])
  )

  remove(root, file, find(root, "失敗 B").hash)

  expect(fs.readFileSync(file).equals(Buffer.concat([prefix, suffix]))).toBe(
    true
  )
})

test("削除: 空になった `## GOTCHAS 候補` は、見出しから次の `##` の直前まで消す", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )

  remove(root, file, find(root, "失敗 A").hash)

  expect(fs.readFileSync(file, "utf8")).toBe(
    [
      "# frontend",
      "",
      "## 目的",
      "",
      "画面を提供する。",
      "",
      "## 由来",
      "",
      "- docs/intents/2026-09-30-login-rework.md(取り込み日 2026-10-02)",
      ""
    ].join("\n")
  )
})

test("削除: 空になった `## GOTCHAS 候補` が末尾にあれば、ファイル末尾まで消す", () => {
  const root = repo()
  const head = "# frontend\n\n## 目的\n\n画面を提供する。\n\n"
  const file = writeDomain(
    root,
    "frontend.md",
    `${head}## GOTCHAS 候補\n\n${entry("失敗 A").join("\n")}\n`
  )

  remove(root, file, find(root, "失敗 A").hash)

  expect(fs.readFileSync(file, "utf8")).toBe(head)
})

test("削除: `## GOTCHAS 候補` に別の内容が残るときは、見出しを残す", () => {
  const root = repo()
  const body = [
    "# frontend",
    "",
    "## GOTCHAS 候補",
    "",
    "移していない候補は次のとおり。",
    "",
    ...entry("失敗 A"),
    ""
  ].join("\n")
  const file = writeDomain(root, "frontend.md", body)

  remove(root, file, find(root, "失敗 A").hash)

  expect(fs.readFileSync(file, "utf8")).toBe(
    "# frontend\n\n## GOTCHAS 候補\n\n移していない候補は次のとおり。\n\n"
  )
})

test("削除: 別の親の下にある候補は、親が空になっても見出しを残す", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("意図的な制約", entry("失敗 A"))
  )

  remove(root, file, find(root, "失敗 A").hash)

  expect(fs.readFileSync(file, "utf8")).toBe(durable("意図的な制約"))
})

test("削除: 同じハッシュのエントリが 2 件あれば、先頭の 1 件だけを消す", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("同じ失敗"), entry("同じ失敗"))
  )
  const { candidates } = scan(root)
  expect(candidates[0].hash).toBe(candidates[1].hash)

  remove(root, file, candidates[0].hash)

  expect(fs.readFileSync(file, "utf8")).toBe(
    durable("GOTCHAS 候補", entry("同じ失敗"))
  )
})

test("削除: 走査の後にファイルが書き換わっていれば file_changed で拒否する", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )
  const target = find(root, "失敗 A")
  fs.appendFileSync(file, "\n追記\n")
  const before = fs.readFileSync(file)

  expectRejected(
    () => remove(root, file, target.hash, target.fileHash),
    "file_changed"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("削除: 書き込みの直前の読み直しで変わっていれば file_changed で拒否し、何も書かない", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )
  const target = find(root, "失敗 A")
  const original = fs.readFileSync(file)
  const changed = Buffer.concat([original, Buffer.from("\n追記\n")])

  // 1 回目の読み込みは元の内容を返し、2 回目(書き込みの直前)は書き換わった内容を返す。
  const realRead = fs.readFileSync
  let targetReads = 0
  const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
    p: fs.PathOrFileDescriptor,
    ...rest: unknown[]
  ) => {
    if (p === file) {
      targetReads++
      return targetReads === 1 ? original : changed
    }
    return (realRead as (...a: unknown[]) => unknown)(p, ...rest)
  }) as typeof fs.readFileSync)
  try {
    expectRejected(
      () => remove(root, file, target.hash, target.fileHash),
      "file_changed"
    )
  } finally {
    spy.mockRestore()
  }

  expect(targetReads).toBe(2)
  expect(fs.readFileSync(file).equals(original)).toBe(true)
  expect(fs.readdirSync(path.dirname(file))).toStrictEqual(["frontend.md"])
})

test("削除: ハッシュが一致するエントリが無ければ candidate_not_found で拒否する", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )
  const before = fs.readFileSync(file)

  expectRejected(() => remove(root, file, "0"), "candidate_not_found")
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("削除: 書き込み先が repoRoot の docs/intents/domains/*.md 以外なら outside_domains_dir で拒否する", () => {
  const root = repo()
  const body = durable("GOTCHAS 候補", entry("失敗 A"))
  const inside = writeDomain(root, "frontend.md", body)
  const hash = find(root, "失敗 A").hash
  const other = repo()
  const targets = [
    writeFile(root, "docs/intents/frontend.md", body),
    writeFile(root, "docs/intents/domains/nested/frontend.md", body),
    writeFile(root, "docs/intents/domains/frontend.txt", body),
    writeDomain(other, "frontend.md", body)
  ]
  const link = path.join(root, "docs", "intents", "domains", "link.md")
  fs.symlinkSync(inside, link)

  for (const target of [...targets, link]) {
    const before = fs.readFileSync(target)
    expectRejected(() => remove(root, target, hash), "outside_domains_dir")
    expect(fs.readFileSync(target).equals(before), target).toBe(true)
  }
})

test("削除: docRoot が git リポジトリの外なら not_git_repository で拒否する", () => {
  const root = mkTmp()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )
  const before = fs.readFileSync(file)

  expectRejected(
    () => remove(root, file, "0", hashContent(before)),
    "not_git_repository"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("削除: --file の対象が無ければ file_not_found で拒否する", () => {
  const root = repo()
  fs.mkdirSync(path.join(root, "docs/intents/domains"), { recursive: true })

  expectRejected(
    () =>
      remove(root, path.join(root, "docs/intents/domains/none.md"), "0", "0"),
    "file_not_found"
  )
})

test("削除: 書き込みに失敗したら write_failed で拒否し、一時ファイルを残さない", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )
  const hash = find(root, "失敗 A").hash
  const before = fs.readFileSync(file)
  const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
    const err: NodeJS.ErrnoException = new Error("EIO: i/o error, rename")
    err.code = "EIO"
    throw err
  })
  try {
    expectRejected(() => remove(root, file, hash), "write_failed")
  } finally {
    spy.mockRestore()
  }
  expect(fs.readFileSync(file).equals(before)).toBe(true)
  expect(fs.readdirSync(path.dirname(file))).toStrictEqual(["frontend.md"])
})

// 領域ディレクトリ(またはその祖先)がリポジトリの外を指すリンクのとき、
// 走査せず、削除は outside_domains_dir で拒否する。
test("走査と削除: domains 自体が外部へのリンクなら、走査せず warnings に積み、削除は outside_domains_dir で拒否する", () => {
  const body = durable("GOTCHAS 候補", entry("失敗 A"))
  const reference = repo()
  writeDomain(reference, "frontend.md", body)
  const { hash } = find(reference, "失敗 A")

  const root = repo()
  const external = mkTmp()
  const externalFile = writeFile(external, "frontend.md", body)
  fs.mkdirSync(path.join(root, "docs/intents"), { recursive: true })
  fs.symlinkSync(external, path.join(root, "docs/intents/domains"))
  const before = fs.readFileSync(externalFile)

  const result = scan(root)
  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toHaveLength(1)

  const viaLink = path.join(root, "docs/intents/domains/frontend.md")
  expectRejected(
    () => remove(root, viaLink, hash, hashContent(before)),
    "outside_domains_dir"
  )
  expectRejected(
    () => remove(root, externalFile, hash, hashContent(before)),
    "outside_domains_dir"
  )
  expect(fs.readFileSync(externalFile).equals(before)).toBe(true)
})

test("走査と削除: 祖先のディレクトリが外部へのリンクでも、走査せず、削除は outside_domains_dir で拒否する", () => {
  const body = durable("GOTCHAS 候補", entry("失敗 A"))
  const reference = repo()
  writeDomain(reference, "frontend.md", body)
  const { hash } = find(reference, "失敗 A")

  const root = repo()
  const external = mkTmp()
  const externalFile = writeFile(external, "intents/domains/frontend.md", body)
  fs.symlinkSync(external, path.join(root, "docs"))
  const before = fs.readFileSync(externalFile)

  const result = scan(root)
  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toHaveLength(1)

  const viaLink = path.join(root, "docs/intents/domains/frontend.md")
  expectRejected(
    () => remove(root, viaLink, hash, hashContent(before)),
    "outside_domains_dir"
  )
  expect(fs.readFileSync(externalFile).equals(before)).toBe(true)
})

test("走査と削除: domains がリポジトリの中を指すリンクなら、走査も削除もできる", () => {
  const root = repo()
  const real = writeFile(
    root,
    "shared/domains/frontend.md",
    durable("GOTCHAS 候補", entry("失敗 A"))
  )
  fs.mkdirSync(path.join(root, "docs/intents"), { recursive: true })
  fs.symlinkSync(
    path.join(root, "shared/domains"),
    path.join(root, "docs/intents/domains")
  )

  const target = find(root, "失敗 A")
  remove(
    root,
    path.join(root, "docs/intents/domains/frontend.md"),
    target.hash,
    target.fileHash
  )

  expect(fs.readFileSync(real, "utf8")).not.toContain("失敗 A")
})

test("走査: 値の前後の全角空白を落とし、全角空白だけの値は空として problems に載せる", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    durable(
      "GOTCHAS 候補",
      entry("全角空白つき", {
        values: { cause: "　原因　", promotionCandidate: "　Yes　" }
      }),
      entry("全角空白だけ", {
        values: { cause: "　　", promotionCandidate: "　" }
      })
    )
  )

  const { candidates } = scan(root)

  expect(candidates[0].fields.cause).toBe("原因")
  expect(candidates[0].fields.promotionCandidate).toBe("Yes")
  expect(candidates[0].problems).toStrictEqual([])
  expect(candidates[1].fields.cause).toBeNull()
  expect(candidates[1].fields.promotionCandidate).toBeNull()
  expect(candidates[1].problems).toHaveLength(2)
})
