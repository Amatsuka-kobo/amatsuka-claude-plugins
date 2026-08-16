// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §11
// 「staging の保証と保存先」の検証。
// ケース ID は metatron 設計書 §13-1 の staging.ts の表(T1〜T6)に対応する。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import {
  commitStaging,
  createStaging,
  DEFAULT_STAGING_TTL_MS,
  hashContent,
  readStaging,
  stagingDirFor,
  stagingRecordPath,
  stagingRootDir
} from "../lib/staging.js"

const projectRoots: string[] = []

afterAll(() => {
  for (const root of projectRoots) {
    for (const dir of [stagingDirFor(root), root]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // 後始末の失敗はテスト結果に影響させない
      }
    }
  }
})

// /tmp が symlink である環境でも projectKey が実体パスから安定するよう realpath で解決する。
function mkProject(): string {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-staging-test-"))
  const root = fs.realpathSync(raw)
  projectRoots.push(root)
  return root
}

function writeDoc(root: string, relative: string, body: string): string {
  const abs = path.join(root, relative)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
  return abs
}

function docPath(root: string, relative = "docs/ARCHITECTURE.md"): string {
  return path.join(root, relative)
}

function readRecordJson(
  root: string,
  stagingId: string
): Record<string, unknown> {
  const recordPath = stagingRecordPath(root, stagingId)
  if (recordPath === null) throw new Error("stagingId が不正です")
  return JSON.parse(fs.readFileSync(recordPath, "utf8"))
}

function writeRecordJson(
  root: string,
  stagingId: string,
  record: Record<string, unknown>
): void {
  const recordPath = stagingRecordPath(root, stagingId)
  if (recordPath === null) throw new Error("stagingId が不正です")
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
}

test("T1: stage → commit の正常系 → 書き込まれ、staging が消費される", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "# ARCHITECTURE\n\n## 規約\n\n旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "# ARCHITECTURE\n\n## 規約\n\n新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  expect(staged.stagingId).not.toBe("")
  expect(staged.expiresAt - staged.createdAt).toBe(DEFAULT_STAGING_TTL_MS)

  const committed = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(committed.ok).toBe(true)
  if (!committed.ok) return

  expect(committed.path).toBe(docPath(root))
  expect(committed.kind).toBe("architecture")
  expect(committed.bytesWritten).toBe(
    Buffer.byteLength("# ARCHITECTURE\n\n## 規約\n\n新\n", "utf8")
  )
  expect(committed.warnings).toStrictEqual([])
  expect(fs.readFileSync(docPath(root), "utf8")).toBe(
    "# ARCHITECTURE\n\n## 規約\n\n新\n"
  )

  // 消費済みの印が残る(削除ではない。2 回目を already_used と判別するため)
  const after = readStaging(root, staged.stagingId)
  expect(after.ok).toBe(true)
  if (!after.ok) return
  expect(after.record.usedAt).not.toBeNull()
})

test("T2: 同じ stagingId で 2 回 commit → 2 回目は already_used", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  expect(
    commitStaging({ projectRoot: root, stagingId: staged.stagingId }).ok
  ).toBe(true)

  // 2 回目の前に第三者が書き換えても、判定順は already_used が先
  fs.writeFileSync(docPath(root), "第三者\n")

  const second = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(second.ok).toBe(false)
  if (second.ok) return
  expect(second.error).toBe("already_used")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("第三者\n")
})

test("T3: 期限切れ後の commit → expired(TTL を注入して検証)", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")
  const base = 1_700_000_000_000

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n",
    ttlMs: 30 * 60 * 1000,
    now: base
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return
  expect(staged.expiresAt).toBe(base + 30 * 60 * 1000)

  // 期限内は通る
  const inside = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId,
    now: base + 29 * 60 * 1000
  })
  expect(inside.ok).toBe(true)

  // 別 staging で期限超過を確認する
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")
  const staged2 = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新 2\n",
    ttlMs: 30 * 60 * 1000,
    now: base
  })
  expect(staged2.ok).toBe(true)
  if (!staged2.ok) return

  const expired = commitStaging({
    projectRoot: root,
    stagingId: staged2.stagingId,
    now: base + 30 * 60 * 1000 + 1
  })
  expect(expired.ok).toBe(false)
  if (expired.ok) return
  expect(expired.error).toBe("expired")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("旧\n")
})

test("T3b: 保存された expiresAt を過去に書き換えても expired になる", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  // 実時間を待たず、保存済みレコードの時刻を過去へずらす
  const record = readRecordJson(root, staged.stagingId)
  record.createdAt = Date.now() - 61 * 60 * 1000
  record.expiresAt = Date.now() - 31 * 60 * 1000
  writeRecordJson(root, staged.stagingId, record)

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("expired")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("旧\n")
})

test("T4: stage 後にファイルを書き換えて commit → file_changed、書き込みなし", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return
  expect(staged.baseHash).toBe(hashContent("旧\n"))

  fs.writeFileSync(docPath(root), "第三者が書いた\n")

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("file_changed")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("第三者が書いた\n")

  // 弾かれた staging は消費されていない
  const after = readStaging(root, staged.stagingId)
  expect(after.ok).toBe(true)
  if (!after.ok) return
  expect(after.record.usedAt).toBeNull()
})

test("T4b: 未作成のまま stage し、commit 前に作成された → file_changed", () => {
  const root = mkProject()
  // 対象ファイルは存在しない(新規作成の stage)
  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "# ARCHITECTURE\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return
  expect(staged.baseHash).toBeNull()

  writeDoc(root, "docs/ARCHITECTURE.md", "誰かが先に作った\n")

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("file_changed")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("誰かが先に作った\n")
})

test("T4c: 未作成のまま stage し、未作成のまま commit → 親ごと新規作成される", () => {
  const root = mkProject()
  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "# ARCHITECTURE\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(true)
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("# ARCHITECTURE\n")
})

test("T4d: stage 後に対象ファイルが削除された → file_changed", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  fs.rmSync(docPath(root))

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("file_changed")
  expect(fs.existsSync(docPath(root))).toBe(false)
})

test("T5: 存在しない stagingId → unknown_id", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const result = commitStaging({
    projectRoot: root,
    stagingId: "00000000-0000-4000-8000-000000000000"
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("unknown_id")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("旧\n")
})

test("T5b: staging ディレクトリごと消えた → unknown_id", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  fs.rmSync(stagingDirFor(root), { recursive: true, force: true })

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("unknown_id")
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("旧\n")
})

test("T5c: レコードが壊れている / パス区切りを含む id → unknown_id", () => {
  const root = mkProject()
  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const recordPath = stagingRecordPath(root, staged.stagingId)
  expect(recordPath).not.toBeNull()
  if (recordPath === null) return
  fs.writeFileSync(recordPath, "{ 壊れた JSON")

  const broken = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(broken.ok).toBe(false)
  if (broken.ok) return
  expect(broken.error).toBe("unknown_id")

  // ファイル名として危険な id は読みにいかずに unknown_id
  expect(stagingRecordPath(root, "../../etc/passwd")).toBeNull()
  const traversal = commitStaging({
    projectRoot: root,
    stagingId: "../../etc/passwd"
  })
  expect(traversal.ok).toBe(false)
  if (traversal.ok) return
  expect(traversal.error).toBe("unknown_id")
})

test("T5d: レコードを改竄してルート外を指させても書き込まない", () => {
  const root = mkProject()
  const outside = path.join(mkProject(), "STOLEN.md")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "乗っ取り\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const record = readRecordJson(root, staged.stagingId)
  record.targetPath = outside
  writeRecordJson(root, staged.stagingId, record)

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("unknown_id")
  expect(fs.existsSync(outside)).toBe(false)
})

test("T6: 検証失敗時 → stagingId が発行されない", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "壊れた metatron:domains を含む本文\n",
    validationErrors: [
      "ドメインマップのトップレベルがオブジェクトではありません。"
    ]
  })
  expect(staged.ok).toBe(false)
  if (staged.ok) return
  expect(staged.error).toBe("invalid")
  expect(staged.reasons).toHaveLength(1)

  // staging がひとつも保存されていない
  expect(fs.existsSync(stagingDirFor(root))).toBe(false)
  expect(fs.readFileSync(docPath(root), "utf8")).toBe("旧\n")
})

test("T6b: ルート外を対象にした stage も stagingId を発行しない", () => {
  const root = mkProject()
  const outside = path.join(mkProject(), "docs", "ARCHITECTURE.md")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: outside,
    nextContent: "外へ書く\n"
  })
  expect(staged.ok).toBe(false)
  if (staged.ok) return
  expect(staged.error).toBe("invalid")
  expect(fs.existsSync(stagingDirFor(root))).toBe(false)
})

test("保存先は OS の一時ディレクトリ配下で、プロジェクト内に置かない", () => {
  const root = mkProject()
  const staged = createStaging({
    projectRoot: root,
    kind: "adr",
    targetPath: docPath(root),
    nextContent: "本文\n",
    meta: { assignedId: "ADR-004" }
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const dir = stagingDirFor(root)
  expect(stagingRootDir()).toBe(path.join(os.tmpdir(), "metatron-staging"))
  expect(path.dirname(dir)).toBe(stagingRootDir())
  expect(path.basename(dir)).toMatch(/^[0-9a-f]{16}$/)
  expect(staged.recordPath).toBe(path.join(dir, `${staged.stagingId}.json`))
  expect(path.relative(root, staged.recordPath).startsWith("..")).toBe(true)

  // meta と kind はレコードに残り、commit で戻ってくる
  const committed = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(committed.ok).toBe(true)
  if (!committed.ok) return
  expect(committed.kind).toBe("adr")
  expect(committed.meta).toStrictEqual({ assignedId: "ADR-004" })
})

test("プロジェクトが違えば保存先ディレクトリが分かれ、id は衝突しない", () => {
  const a = mkProject()
  const b = mkProject()
  expect(stagingDirFor(a)).not.toBe(stagingDirFor(b))
  expect(stagingDirFor(a)).toBe(stagingDirFor(a))

  const first = createStaging({
    projectRoot: a,
    kind: "architecture",
    targetPath: docPath(a),
    nextContent: "1\n"
  })
  const second = createStaging({
    projectRoot: a,
    kind: "architecture",
    targetPath: docPath(a),
    nextContent: "2\n"
  })
  expect(first.ok && second.ok).toBe(true)
  if (!first.ok || !second.ok) return
  expect(first.stagingId).not.toBe(second.stagingId)

  // 別プロジェクトの id では引けない
  const cross = commitStaging({ projectRoot: b, stagingId: first.stagingId })
  expect(cross.ok).toBe(false)
  if (cross.ok) return
  expect(cross.error).toBe("unknown_id")
})

test("baseHash を明示指定すると、その値で照合される", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "diff を取った時点の内容\n")

  // 呼び出し元が diff 計算に使ったバイト列のハッシュをそのまま渡す
  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n",
    baseHash: hashContent("別の内容\n")
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const result = commitStaging({
    projectRoot: root,
    stagingId: staged.stagingId
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("file_changed")
})

test("readStaging は staging を消費しない", () => {
  const root = mkProject()
  writeDoc(root, "docs/ARCHITECTURE.md", "旧\n")

  const staged = createStaging({
    projectRoot: root,
    kind: "architecture",
    targetPath: docPath(root),
    nextContent: "新\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const read = readStaging(root, staged.stagingId)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  expect(read.record.nextContent).toBe("新\n")
  expect(read.record.usedAt).toBeNull()

  expect(
    commitStaging({ projectRoot: root, stagingId: staged.stagingId }).ok
  ).toBe(true)

  const missing = readStaging(root, "00000000-0000-4000-8000-000000000000")
  expect(missing.ok).toBe(false)
  if (missing.ok) return
  expect(missing.error).toBe("unknown_id")
})
