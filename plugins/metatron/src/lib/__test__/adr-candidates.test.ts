// 持続層の `[ADR 候補]` の走査と縮約(codiel intent 駆動化の設計書 §6.11、§8.2 の
// 「metatron の走査」「metatron の縮約」の行)の検証。
// 書式の正本は codiel の `references/intent-format.md` の「持続層」セクション。

import { execFileSync, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test, vi } from "vitest"
import {
  AdrCandidateError,
  type AdrCandidateErrorCode,
  scanAdrCandidates,
  shrinkAdrCandidate
} from "../adr-candidates.js"
import { loadConfig } from "../config.js"

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
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-adr-cand-"))
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

const SECTION_HEADINGS = [
  "背景",
  "検討した選択肢",
  "採用した結論",
  "理由",
  "影響範囲"
]

/** 印付きのエントリ。`omit` に挙げた小見出しは書かない。 */
function entry(
  id: string,
  title = `判断 ${id}`,
  omit: string[] = []
): string[] {
  const lines = [
    `### ${title} [ADR 候補: ${id}]`,
    `- 制約: ${title} の制約`,
    "- 決定日: 2026-10-01",
    "- 出典 intent: docs/intents/2026-09-30-login-rework.md",
    "- 出典 intent: docs/intents/2026-10-01-session-timeout.md",
    "- 関連 ADR: なし(ADR 候補)"
  ]
  for (const heading of SECTION_HEADINGS) {
    if (omit.includes(heading)) continue
    lines.push(`#### ${heading}`)
    if (heading === "検討した選択肢") {
      lines.push(`1. ${title} の案 A`, `2. ${title} の案 B`)
    } else {
      lines.push(`${title} の${heading}`)
    }
  }
  return lines
}

/** 縮約の後の参照形。 */
function reference(id: string, adr: string, title = `判断 ${id}`): string[] {
  return [
    `### ${title}`,
    `- 制約: ${title} の制約`,
    `- 関連 ADR: ${adr}(候補 ID: ${id})`
  ]
}

/** 持続層の 1 ファイル。`## 意図的な制約` に既存の制約と、渡したエントリを並べる。 */
function durable(...entries: string[][]): string {
  return [
    "# frontend",
    "",
    "## 目的",
    "",
    "画面を提供する。",
    "",
    "## 意図的な制約",
    "",
    "### 既存の制約",
    "- 制約: 既存の制約",
    "- 理由: 既存の理由",
    "- 出典 intent: docs/intents/2026-09-01-first.md",
    "- 関連 ADR: なし",
    "",
    ...entries.flatMap((e) => [...e, ""]),
    "## 非ゴール",
    "",
    "なし",
    "",
    "## 由来",
    "",
    "- docs/intents/2026-09-30-login-rework.md(取り込み日 2026-10-02)",
    "",
    "## 出典",
    "",
    "なし",
    ""
  ].join("\n")
}

interface AdrFixture {
  num: number
  title: string
  background: string[]
}

function architecture(adrs: AdrFixture[]): string {
  const blocks = adrs.map((a) =>
    [
      `### ADR-${String(a.num).padStart(3, "0")}: ${a.title}`,
      "",
      "- 状態: 採用",
      "- 決定日: 2026-10-02",
      "- 決定者: team",
      "",
      "#### 背景",
      "",
      ...a.background,
      "",
      "#### 検討した選択肢",
      "",
      "1. 案",
      "",
      "#### 採用した結論",
      "",
      "結論",
      "",
      "#### 理由",
      "",
      "理由",
      "",
      "#### 影響範囲",
      "",
      "影響"
    ].join("\n")
  )
  return [
    "# ARCHITECTURE",
    "",
    "## システム概要",
    "",
    "概要。",
    "",
    "## ADR 一覧",
    "",
    blocks.join("\n\n---\n\n"),
    ""
  ].join("\n")
}

function adoptedAdr(num: number, id: string, title = `判断 ${id}`): AdrFixture {
  return {
    num,
    title,
    background: [
      "XSS でトークンが漏れた。",
      "- 出典 intent: docs/intents/2026-09-30-login-rework.md",
      `ADR 候補 ID: ${id}`
    ]
  }
}

function scan(cwd: string) {
  const config = loadConfig(cwd)
  return scanAdrCandidates(config.docRoot, config.architecturePath)
}

function shrink(
  cwd: string,
  file: string,
  candidateId: string,
  adrNumber: number,
  hash: string
) {
  const config = loadConfig(cwd)
  return shrinkAdrCandidate({
    docRoot: config.docRoot,
    architecturePath: config.architecturePath,
    file,
    candidateId,
    adrNumber,
    hash
  })
}

function hashOf(cwd: string, candidateId: string): string {
  const found = scan(cwd).candidates.find((c) => c.candidateId === candidateId)
  if (found === undefined)
    throw new Error(`${candidateId} が走査で見つからない`)
  return found.hash
}

function expectRejected(fn: () => unknown, code: AdrCandidateErrorCode): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught, `${code} で拒否されなかった`).toBeInstanceOf(AdrCandidateError)
  expect((caught as AdrCandidateError).code).toBe(code)
}

// ---------------------------------------------------------------------------
// 走査
// ---------------------------------------------------------------------------

test("走査: docs/intents/domains/ が無ければ candidates は空", () => {
  const root = repo()
  writeFile(root, "docs/ARCHITECTURE.md", architecture([]))

  const result = scan(root)

  expect(result.repoRoot).toBe(root)
  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toStrictEqual([])
})

test("走査: git リポジトリでなければ、持続層があっても走査しない", () => {
  const root = mkTmp()
  expect(
    spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root }).status
  ).not.toBe(0)
  writeDomain(root, "frontend.md", durable(entry("frontend-1")))

  const result = scan(root)

  expect(result.repoRoot).toBeNull()
  expect(result.candidates).toStrictEqual([])
})

test("走査: git が無い環境では例外を投げず走査しない", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(entry("frontend-1")))
  const originalPath = process.env.PATH
  try {
    process.env.PATH = path.join(root, "no-such-bin-dir")
    const result = scan(root)
    expect(result.repoRoot).toBeNull()
    expect(result.candidates).toStrictEqual([])
  } finally {
    process.env.PATH = originalPath
  }
})

test("走査: 印付きエントリが無ければ candidates は空", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(reference("frontend-1", "ADR-001")))

  const result = scan(root)

  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toStrictEqual([])
})

test("走査: 印付きエントリを候補 ID・見出し・各項目・ハッシュつきで返す", () => {
  const root = repo()
  const lines = entry("frontend-3", "認証トークンはサーバーでだけ保持する")
  const file = writeDomain(root, "frontend.md", durable(lines))

  const result = scan(root)

  expect(result.warnings).toStrictEqual([])
  expect(result.candidates).toHaveLength(1)
  const [candidate] = result.candidates
  expect(candidate.file).toBe(file)
  expect(candidate.relative).toBe("docs/intents/domains/frontend.md")
  expect(candidate.candidateId).toBe("frontend-3")
  expect(candidate.heading).toBe(
    "### 認証トークンはサーバーでだけ保持する [ADR 候補: frontend-3]"
  )
  expect(candidate.title).toBe("認証トークンはサーバーでだけ保持する")
  expect(candidate.constraint).toBe(
    "認証トークンはサーバーでだけ保持する の制約"
  )
  expect(candidate.decidedOn).toBe("2026-10-01")
  expect(candidate.sourceIntents).toStrictEqual([
    "docs/intents/2026-09-30-login-rework.md",
    "docs/intents/2026-10-01-session-timeout.md"
  ])
  expect(candidate.sections).toStrictEqual({
    background: "認証トークンはサーバーでだけ保持する の背景",
    options:
      "1. 認証トークンはサーバーでだけ保持する の案 A\n2. 認証トークンはサーバーでだけ保持する の案 B",
    conclusion: "認証トークンはサーバーでだけ保持する の採用した結論",
    rationale: "認証トークンはサーバーでだけ保持する の理由",
    impact: "認証トークンはサーバーでだけ保持する の影響範囲"
  })
  // エントリの範囲は印付きの見出しから次の `##` 見出しの直前まで(末尾の空行を含む)。
  expect(candidate.hash).toBe(
    crypto
      .createHash("sha256")
      .update(`${lines.join("\n")}\n\n`)
      .digest("hex")
  )
  expect(candidate.adoptedAs).toBeNull()
})

test("走査: 5 つの小見出しが揃わないエントリは候補にせず warnings に載せる", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    durable(entry("frontend-1", "欠けた判断", ["理由"]), entry("frontend-2"))
  )

  const result = scan(root)

  expect(result.candidates.map((c) => c.candidateId)).toStrictEqual([
    "frontend-2"
  ])
  expect(result.warnings).toHaveLength(1)
  expect(result.warnings[0]).toContain("frontend-1")
  expect(result.warnings[0]).toContain("理由")
})

test("走査: 候補 ID の無い印は候補にせず warnings に載せる", () => {
  const root = repo()
  const noId = entry("x-1", "ID の無い判断")
  noId[0] = "### ID の無い判断 [ADR 候補]"
  const noNumber = entry("x-1", "連番の無い判断")
  noNumber[0] = "### 連番の無い判断 [ADR 候補: frontend]"
  writeDomain(root, "frontend.md", durable(noId, noNumber))

  const result = scan(root)

  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toHaveLength(2)
  expect(result.warnings[0]).toContain("ID の無い判断")
  expect(result.warnings[1]).toContain("連番の無い判断")
})

test("走査: 同じファイルで重複した候補 ID は候補にせず warnings に載せる", () => {
  const root = repo()
  writeDomain(
    root,
    "frontend.md",
    durable(
      entry("frontend-2", "先の判断"),
      entry("frontend-2", "後の判断"),
      entry("frontend-3", "参照形と重なる判断"),
      reference("frontend-3", "ADR-001"),
      entry("frontend-4")
    )
  )

  const result = scan(root)

  expect(result.candidates.map((c) => c.candidateId)).toStrictEqual([
    "frontend-4"
  ])
  expect(result.warnings).toHaveLength(3)
  expect(result.warnings.filter((w) => w.includes("frontend-2"))).toHaveLength(
    2
  )
  expect(result.warnings.filter((w) => w.includes("frontend-3"))).toHaveLength(
    1
  )
})

test("走査: 本文に「ADR 候補 ID: <候補 ID>」の行を持つ ADR があれば adoptedAs にその番号が入る", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([
      { num: 1, title: "関係の無い判断", background: ["背景"] },
      adoptedAdr(12, "frontend-3")
    ])
  )

  expect(scan(root).candidates[0].adoptedAs).toBe("ADR-012")
})

test("走査: ADR のタイトルが候補のタイトルと違っても、候補 ID の行で adoptedAs が入る", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(4, "frontend-3", "草案で付け直したタイトル")])
  )

  expect(scan(root).candidates[0].adoptedAs).toBe("ADR-004")
})

test("走査: タイトルだけが同じで候補 ID の行を持たない ADR では adoptedAs は null", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([
      { num: 2, title: "判断 frontend-3", background: ["frontend-3 の話"] }
    ])
  )

  expect(scan(root).candidates[0].adoptedAs).toBeNull()
})

test("走査: 候補 frontend-1 に対し「ADR 候補 ID: frontend-10」だけを持つ ADR では adoptedAs は null", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(entry("frontend-1")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(10, "frontend-10", "判断 frontend-1")])
  )

  expect(scan(root).candidates[0].adoptedAs).toBeNull()
})

/** コードフェンスの中だけに「ADR 候補 ID: <id>」の行を持つ ADR。書式の例を引いた本文を想定する。 */
function fencedOnlyAdr(num: number, id: string): AdrFixture {
  return {
    num,
    title: `判断 ${id}`,
    background: [
      "背景に書き写す行の例:",
      "",
      "```markdown",
      `ADR 候補 ID: ${id}`,
      "```"
    ]
  }
}

test("走査: コードフェンスの中にだけ「ADR 候補 ID:」の行を持つ ADR では adoptedAs は null", () => {
  const root = repo()
  writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([fencedOnlyAdr(12, "frontend-3")])
  )

  expect(scan(root).candidates[0].adoptedAs).toBeNull()
})

// ---------------------------------------------------------------------------
// 縮約
// ---------------------------------------------------------------------------

/** 候補 frontend-3 と、それを採った ADR-012 を持つリポジトリ。 */
function adoptedRepo(): { root: string; file: string } {
  const root = repo()
  const file = writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(12, "frontend-3")])
  )
  return { root, file }
}

test("縮約: 候補 ID で特定したエントリを、候補 ID を残した参照形にする", () => {
  const { root, file } = adoptedRepo()

  const result = shrink(
    root,
    file,
    "frontend-3",
    12,
    hashOf(root, "frontend-3")
  )

  expect(result).toStrictEqual({
    file,
    candidateId: "frontend-3",
    adr: "ADR-012",
    written: true
  })
  expect(fs.readFileSync(file, "utf8")).toBe(
    durable(reference("frontend-3", "ADR-012"))
  )
})

test("縮約: CRLF と不正な UTF-8 を含むファイルでも、エントリの範囲の外は 1 バイトも変わらない", () => {
  const root = repo()
  const invalid = Buffer.from([0xff, 0xfe, 0xc3])
  const prefix = Buffer.concat([
    Buffer.from("# frontend\r\n\r\n## 目的\r\n\r\n", "utf8"),
    invalid,
    Buffer.from("\r\n\r\n## 意図的な制約\r\n\r\n", "utf8")
  ])
  // 範囲の末尾の空行は縮約の後も残るので、suffix はその空行から始める。
  const suffix = Buffer.concat([
    Buffer.from("\r\n## 非ゴール\r\n\r\n", "utf8"),
    invalid,
    Buffer.from("\r\n\r\n## 出典\r\n\r\nなし", "utf8")
  ])
  const file = writeDomain(
    root,
    "frontend.md",
    Buffer.concat([
      prefix,
      Buffer.from(`${entry("frontend-3").join("\r\n")}\r\n`, "utf8"),
      suffix
    ])
  )
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(12, "frontend-3")])
  )

  shrink(root, file, "frontend-3", 12, hashOf(root, "frontend-3"))

  expect(
    fs
      .readFileSync(file)
      .equals(
        Buffer.concat([
          prefix,
          Buffer.from(
            `${reference("frontend-3", "ADR-012").join("\r\n")}\r\n`,
            "utf8"
          ),
          suffix
        ])
      )
  ).toBe(true)
})

test("縮約: 既に参照形なら何もせず written: false で終わる", () => {
  const { root, file } = adoptedRepo()
  const hash = hashOf(root, "frontend-3")
  shrink(root, file, "frontend-3", 12, hash)
  const before = fs.readFileSync(file)

  const again = shrink(root, file, "frontend-3", 12, hash)

  expect(again.written).toBe(false)
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: エントリのハッシュが走査のときと違えば、何も書かずに拒否する", () => {
  const { root, file } = adoptedRepo()
  const hash = hashOf(root, "frontend-3")
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace("判断 frontend-3 の理由", "判断 frontend-3 の書き換えた理由")
  )
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-3", 12, hash),
    "hash_mismatch"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: ADR が無ければ、何も書かずに拒否する", () => {
  const { root, file } = adoptedRepo()
  const hash = hashOf(root, "frontend-3")
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-3", 13, hash),
    "adr_not_found"
  )
  fs.rmSync(path.join(root, "docs", "ARCHITECTURE.md"))
  expectRejected(
    () => shrink(root, file, "frontend-3", 12, hash),
    "adr_not_found"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: ADR の本文に「ADR 候補 ID:」の行が無ければ、何も書かずに拒否する", () => {
  const root = repo()
  const file = writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([
      { num: 12, title: "判断 frontend-3", background: ["背景"] },
      adoptedAdr(13, "frontend-30")
    ])
  )
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-3", 12, hashOf(root, "frontend-3")),
    "candidate_id_line_missing"
  )
  expectRejected(
    () => shrink(root, file, "frontend-3", 13, hashOf(root, "frontend-3")),
    "candidate_id_line_missing"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: 「ADR 候補 ID:」の行がコードフェンスの中にしか無ければ、何も書かずに拒否する", () => {
  const root = repo()
  const file = writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([fencedOnlyAdr(12, "frontend-3")])
  )
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-3", 12, hashOf(root, "frontend-3")),
    "candidate_id_line_missing"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: 書き込みに失敗したら、何も書かずに拒否し一時ファイルを残さない", () => {
  const { root, file } = adoptedRepo()
  const hash = hashOf(root, "frontend-3")
  const before = fs.readFileSync(file)
  const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
    const err: NodeJS.ErrnoException = new Error("EIO: i/o error, rename")
    err.code = "EIO"
    throw err
  })
  try {
    expectRejected(
      () => shrink(root, file, "frontend-3", 12, hash),
      "write_failed"
    )
  } finally {
    spy.mockRestore()
  }
  expect(fs.readFileSync(file).equals(before)).toBe(true)
  expect(fs.readdirSync(path.dirname(file))).toStrictEqual(["frontend.md"])
})

test("縮約: 読み込みの後で候補の外の行が書き換わったら、file_changed で拒否し書き換えた内容を残す", () => {
  const { root, file } = adoptedRepo()
  const hash = hashOf(root, "frontend-3")
  const edited = fs
    .readFileSync(file, "utf8")
    .replace("画面を提供する。", "画面と API を提供する。")
  // 縮約が対象を読んだ後、書き込みの前に別の編集が入った状態を再現する。
  // 2 回目に読まれる時点でファイルを書き換え、書き換えた内容を返す。
  const realReadFileSync = fs.readFileSync
  let reads = 0
  const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
    target: Parameters<typeof fs.readFileSync>[0],
    options?: Parameters<typeof fs.readFileSync>[1]
  ) => {
    if (target === file) {
      reads++
      if (reads === 2) fs.writeFileSync(file, edited)
    }
    return realReadFileSync(target, options)
  }) as typeof fs.readFileSync)
  try {
    expectRejected(
      () => shrink(root, file, "frontend-3", 12, hash),
      "file_changed"
    )
  } finally {
    spy.mockRestore()
  }
  expect(fs.readFileSync(file, "utf8")).toBe(edited)
  expect(fs.readdirSync(path.dirname(file))).toStrictEqual(["frontend.md"])
})

test("縮約: 書き込み先が repoRoot の docs/intents/domains/*.md 以外なら拒否する", () => {
  const { root } = adoptedRepo()
  const body = durable(entry("frontend-3"))
  const other = repo()
  const targets = [
    writeFile(root, "docs/intents/frontend.md", body),
    writeFile(root, "docs/intents/domains/nested/frontend.md", body),
    writeFile(root, "docs/intents/domains/frontend.txt", body),
    writeDomain(other, "frontend.md", body)
  ]
  const link = path.join(root, "docs", "intents", "domains", "link.md")
  fs.symlinkSync(targets[0], link)
  const hash = hashOf(other, "frontend-3")

  for (const target of [...targets, link]) {
    const before = fs.readFileSync(target)
    expectRejected(
      () => shrink(root, target, "frontend-3", 12, hash),
      "outside_domains_dir"
    )
    expect(fs.readFileSync(target).equals(before), target).toBe(true)
  }
})

test("縮約: docRoot が git リポジトリの外なら、何も書かずに拒否する", () => {
  const root = mkTmp()
  expect(
    spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root }).status
  ).not.toBe(0)
  const file = writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-3", 12, "dummy-hash"),
    "not_git_repository"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: --file の対象が無ければ、何も書かずに拒否する", () => {
  const root = repo()
  const file = writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  const missing = path.join(root, "docs/intents/domains/missing.md")
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, missing, "frontend-3", 12, "dummy-hash"),
    "file_not_found"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
  expect(fs.existsSync(missing)).toBe(false)
})

test("縮約: 候補 ID がファイルに無ければ、何も書かずに拒否する", () => {
  const { root, file } = adoptedRepo()
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-9", 12, "dummy-hash"),
    "candidate_not_found"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: 同じファイルに同じ候補 ID が 2 つあれば、何も書かずに拒否する", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable(entry("frontend-2", "先の判断"), entry("frontend-2", "後の判断"))
  )
  const before = fs.readFileSync(file)

  expectRejected(
    () => shrink(root, file, "frontend-2", 1, "dummy-hash"),
    "duplicate_candidate"
  )
  expect(fs.readFileSync(file).equals(before)).toBe(true)
})

test("縮約: docRoot の外(repoRoot の直下)にある持続層も書ける", () => {
  const root = repo()
  const sub = path.join(root, "sub")
  writeFile(sub, "metatron.config.json", "{}")
  writeFile(
    sub,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(12, "frontend-3")])
  )
  const file = writeDomain(root, "frontend.md", durable(entry("frontend-3")))
  expect(loadConfig(sub).docRoot).toBe(sub)

  const result = shrink(sub, file, "frontend-3", 12, hashOf(sub, "frontend-3"))

  expect(result.written).toBe(true)
  expect(fs.readFileSync(file, "utf8")).toBe(
    durable(reference("frontend-3", "ADR-012"))
  )
})

test("縮約: 同じファイルの 2 候補を順に縮約しても、先の候補は印付きに戻らない", () => {
  const root = repo()
  const file = writeDomain(
    root,
    "frontend.md",
    durable(entry("frontend-1"), entry("frontend-2"))
  )
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(1, "frontend-1"), adoptedAdr(2, "frontend-2")])
  )
  const hash1 = hashOf(root, "frontend-1")
  const hash2 = hashOf(root, "frontend-2")

  shrink(root, file, "frontend-1", 1, hash1)
  shrink(root, file, "frontend-2", 2, hash2)

  expect(fs.readFileSync(file, "utf8")).toBe(
    durable(
      reference("frontend-1", "ADR-001"),
      reference("frontend-2", "ADR-002")
    )
  )
  expect(scan(root).candidates).toStrictEqual([])
})

// 領域ディレクトリ(またはその祖先)がリポジトリの外を指すリンクのとき、
// 走査せず、縮約は outside_domains_dir で拒否する。
test("走査と縮約: domains 自体が外部へのリンクなら、走査せず warnings に積み、縮約は outside_domains_dir で拒否する", () => {
  const body = durable(entry("frontend-3"))
  const reference = repo()
  writeDomain(reference, "frontend.md", body)
  const hash = hashOf(reference, "frontend-3")

  const root = repo()
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(12, "frontend-3")])
  )
  const external = mkTmp()
  const externalFile = writeFile(external, "frontend.md", body)
  fs.mkdirSync(path.join(root, "docs/intents"), { recursive: true })
  fs.symlinkSync(external, path.join(root, "docs/intents/domains"))
  const before = fs.readFileSync(externalFile)

  const result = scan(root)
  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toHaveLength(1)

  for (const file of [
    path.join(root, "docs/intents/domains/frontend.md"),
    externalFile
  ]) {
    expectRejected(
      () => shrink(root, file, "frontend-3", 12, hash),
      "outside_domains_dir"
    )
  }
  expect(fs.readFileSync(externalFile).equals(before)).toBe(true)
})

test("走査と縮約: 祖先のディレクトリが外部へのリンクでも、走査せず、縮約は outside_domains_dir で拒否する", () => {
  const body = durable(entry("frontend-3"))
  const reference = repo()
  writeDomain(reference, "frontend.md", body)
  const hash = hashOf(reference, "frontend-3")

  const root = repo()
  const external = mkTmp()
  const externalFile = writeFile(external, "intents/domains/frontend.md", body)
  writeFile(
    external,
    "ARCHITECTURE.md",
    architecture([adoptedAdr(12, "frontend-3")])
  )
  fs.symlinkSync(external, path.join(root, "docs"))
  const before = fs.readFileSync(externalFile)

  const result = scan(root)
  expect(result.candidates).toStrictEqual([])
  expect(result.warnings).toHaveLength(1)

  expectRejected(
    () =>
      shrink(
        root,
        path.join(root, "docs/intents/domains/frontend.md"),
        "frontend-3",
        12,
        hash
      ),
    "outside_domains_dir"
  )
  expect(fs.readFileSync(externalFile).equals(before)).toBe(true)
})

test("走査と縮約: domains がリポジトリの中を指すリンクなら、走査も縮約もできる", () => {
  const root = repo()
  const real = writeFile(
    root,
    "shared/domains/frontend.md",
    durable(entry("frontend-3"))
  )
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    architecture([adoptedAdr(12, "frontend-3")])
  )
  fs.mkdirSync(path.join(root, "docs/intents"), { recursive: true })
  fs.symlinkSync(
    path.join(root, "shared/domains"),
    path.join(root, "docs/intents/domains")
  )

  expect(scan(root).candidates).toHaveLength(1)
  shrink(
    root,
    path.join(root, "docs/intents/domains/frontend.md"),
    "frontend-3",
    12,
    hashOf(root, "frontend-3")
  )

  expect(fs.readFileSync(real, "utf8")).toContain("関連 ADR: ADR-012")
})
