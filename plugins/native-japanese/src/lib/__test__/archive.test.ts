import fs from "node:fs"
import { expect, test } from "vitest"
import { extractTarEntry, extractZipEntries } from "../archive.js"

const TGZ = fs.readFileSync(
  new URL("../../fixtures/archive/pkg.tgz", import.meta.url)
)
const ZIP = fs.readFileSync(
  new URL("../../fixtures/archive/dict.zip", import.meta.url)
)

test("tarball から指定の 1 ファイルを取り出す", () => {
  const out = extractTarEntry(TGZ, "package/a.node")
  expect(out?.toString("utf8")).toBe("lindera native addon stub\n".repeat(12))
  expect(extractTarEntry(TGZ, "package/package.json")?.toString("utf8")).toBe(
    '{"name":"stub"}\n'.repeat(10)
  )
})

test("tarball に無い名前は null を返す", () => {
  expect(extractTarEntry(TGZ, "package/missing.node")).toBeNull()
})

test("zip から接頭辞の直下で一覧にある名前だけを取り出す", () => {
  const out = extractZipEntries(ZIP, "lindera-ipadic/", [
    "NOTICE.txt",
    "metadata.json",
    "absent.bin"
  ])
  expect([...out.keys()].sort()).toEqual(["NOTICE.txt", "metadata.json"])
  // NOTICE.txt は deflate、metadata.json は stored で入っている
  expect(out.get("NOTICE.txt")?.toString("utf8")).toBe(
    "IPADIC notice stub\n".repeat(20)
  )
  expect(out.get("metadata.json")?.toString("utf8")).toBe('{"name":"ipadic"}\n')
})

test("zip の .. や絶対パスを含む項目と一覧に無い名前は取り出さない", () => {
  const out = extractZipEntries(ZIP, "lindera-ipadic/", [
    "../evil.txt",
    "evil.txt",
    "sub/NOTICE.txt"
  ])
  expect(out.size).toBe(0)
  const abs = extractZipEntries(ZIP, "/abs/", ["NOTICE.txt"])
  expect(abs.size).toBe(0)
  const all = extractZipEntries(ZIP, "lindera-ipadic/", ["NOTICE.txt"])
  // 入れ子の sub/NOTICE.txt ではなく直下のものが入る
  expect(all.get("NOTICE.txt")?.toString("utf8")).toBe(
    "IPADIC notice stub\n".repeat(20)
  )
})

test("壊れた Buffer を渡すと例外を投げる", () => {
  const junk = Buffer.from("not an archive at all")
  expect(() => extractTarEntry(junk, "package/a.node")).toThrow()
  expect(() =>
    extractZipEntries(junk, "lindera-ipadic/", ["NOTICE.txt"])
  ).toThrow()
  // 途中で切れた tarball と zip
  expect(() =>
    extractTarEntry(TGZ.subarray(0, TGZ.length / 2), "package/a.node")
  ).toThrow()
  expect(() =>
    extractZipEntries(ZIP.subarray(0, ZIP.length - 30), "lindera-ipadic/", [
      "NOTICE.txt"
    ])
  ).toThrow()
})
