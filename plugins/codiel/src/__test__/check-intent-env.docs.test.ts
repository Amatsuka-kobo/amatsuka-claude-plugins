import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  DOMAINS_ARCHITECTURE,
  gitRepo,
  INTENT_DOC,
  mkdir,
  runScript,
  write
} from "./helpers/check-intent-env-fixtures.js"

// ---------------------------------------------------------------------------
// ケース 11〜16e: projectDocs と文書パスの解決
// ---------------------------------------------------------------------------

test("T14 回帰 7: ドメインマップの読み取り事実は従来どおり返る", () => {
  const readable = gitRepo()
  write(readable, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const readableOut = runScript(readable)
  expect(readableOut.projectDocs.domainsReadable).toBe(true)
  expect(readableOut.projectDocs.domainCount).toBe(2)

  const unreadable = gitRepo()
  const unreadableOut = runScript(unreadable)
  expect(unreadableOut.projectDocs.domainsReadable).toBe(false)
  expect(unreadableOut.projectDocs.domainCount).toBe(0)
})

test("ケース 11: ARCHITECTURE が無ければ projectDocs のパスは null", () => {
  const dir = gitRepo()
  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(null)
  expect(out.projectDocs.domainCount).toBe(0)
})

test("ケース 12: ドメイン定義ブロックが壊れた JSON でも exit 0", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/ARCHITECTURE.md",
    ["```json metatron:domains", '{ "frontend": [', "```", ""].join("\n")
  )
  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(false)
  expect(out.projectDocs.domainCount).toBe(0)
})

test("ケース 16a: 旧マーカー codiel:domains は読まない", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/ARCHITECTURE.md",
    [
      "```json codiel:domains",
      '{ "frontend": ["src/app/**"] }',
      "```",
      ""
    ].join("\n")
  )
  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(false)
  expect(out.projectDocs.domainCount).toBe(0)
})

test("ケース 16b: metatron.config.json で文書パスを変更できる", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md" }
    })
  )
  write(dir, "arch/MAIN.md", DOMAINS_ARCHITECTURE)
  write(dir, "docs/ARCHITECTURE.md", "既定パスの方は使われない\n")

  const out = runScript(dir)
  expect(out.docRoot).toBe(dir)
  expect(out.projectDocs.architecture).toBe(path.join(dir, "arch/MAIN.md"))
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.configWarnings).toEqual([])
})

test("ケース 16c: metatron.config.json が無ければ既定値で解決する", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(
    path.join(dir, "docs/ARCHITECTURE.md")
  )
  // 設定ファイルが無いことはエラーではなく、報告もしない(契約 §2)
  expect(out.configWarnings).toEqual([])
})

test("ケース 16d: サブディレクトリの metatron.config.json は docRoot を repoRoot と分ける", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "packages/app")
  write(
    dir,
    "packages/app/metatron.config.json",
    JSON.stringify({ version: 1 })
  )
  write(dir, "packages/app/docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "docs/ARCHITECTURE.md", "ルート側は docRoot ではない\n")

  const out = runScript(sub)
  expect(out.docRoot).toBe(sub)
  expect(out.repoRoot).toBe(dir)
  expect(out.projectDocs.architecture).toBe(
    path.join(sub, "docs/ARCHITECTURE.md")
  )
  expect(out.projectDocs.domainsReadable).toBe(true)
})

test("ケース 16e: paths が絶対パス / ルート脱出なら既定値に落ち理由を返す", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "/etc/ARCHITECTURE.md" }
    })
  )
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)

  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(
    path.join(dir, "docs/ARCHITECTURE.md")
  )
  expect(out.configWarnings.length).toBe(1)
  expect(out.configWarnings[0]).toContain("architecture")
})

// ---------------------------------------------------------------------------
// ケース 17〜19: intent 文書
// ---------------------------------------------------------------------------

test("ケース 17: docs/intents/ が無ければ null を返し、作成もしない", () => {
  const dir = gitRepo()
  const out = runScript(dir)
  expect(out.intentsDir).toBe(null)
  expect(out.existingIntents).toEqual([])
  expect(fs.existsSync(path.join(dir, "docs", "intents"))).toBe(false)
})

test("ケース 18: intent 文書 2 件をファイル名昇順で返す", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-08-10-add-cache.md",
    INTENT_DOC("add-cache", "done", "42", "レスポンスキャッシュを入れる")
  )
  write(
    dir,
    "docs/intents/2026-08-16-add-oauth-login.md",
    INTENT_DOC("add-oauth-login", "approved", "", "OAuth ログインを足す")
  )
  write(dir, "docs/intents/notes.txt", "md ではないので拾わない\n")

  const out = runScript(dir)
  expect(out.intentsDir).toBe(path.join(dir, "docs/intents"))
  expect(out.existingIntents).toEqual([
    {
      file: "2026-08-10-add-cache.md",
      title: "レスポンスキャッシュを入れる",
      slug: "add-cache",
      status: "done",
      issue: "42",
      intent: "v1"
    },
    {
      file: "2026-08-16-add-oauth-login.md",
      title: "OAuth ログインを足す",
      slug: "add-oauth-login",
      status: "approved",
      issue: "",
      intent: "v1"
    }
  ])
})

test("ケース 19: frontmatter が壊れた intent 文書は落として続行する", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-08-01-broken.md",
    ["---", "intent: v1", "slug: broken", "# 閉じの --- が無い", ""].join("\n")
  )
  write(
    dir,
    "docs/intents/2026-08-02-nofm.md",
    "# intent: frontmatter が無い\n"
  )
  write(
    dir,
    "docs/intents/2026-08-03-ok.md",
    INTENT_DOC("ok", "approved", "", "正しい intent")
  )

  const out = runScript(dir)
  expect(out.existingIntents.map((i: { file: string }) => i.file)).toEqual([
    "2026-08-03-ok.md"
  ])
})

test("intent 書式 v2: v1 と v2 の intent 文書をどちらも列挙し、それぞれの intent の値を返す", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-08-10-add-cache.md",
    INTENT_DOC("add-cache", "done", "42", "レスポンスキャッシュを入れる")
  )
  write(
    dir,
    "docs/intents/2026-09-20-add-oauth-login.md",
    INTENT_DOC("add-oauth-login", "approved", "", "OAuth ログインを足す", "v2")
  )

  const out = runScript(dir)
  expect(
    out.existingIntents.map((i: { file: string; intent: string }) => ({
      file: i.file,
      intent: i.intent
    }))
  ).toEqual([
    { file: "2026-08-10-add-cache.md", intent: "v1" },
    { file: "2026-09-20-add-oauth-login.md", intent: "v2" }
  ])
})

test("intent 書式 v2: リスト形式の値は項目値として読まない", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-09-21-list-value.md",
    [
      "---",
      "intent: v2",
      "slug: list-value",
      "status:",
      "  - approved",
      "issue: 7",
      "---",
      "",
      "# intent: リスト",
      ""
    ].join("\n")
  )

  const out = runScript(dir)
  expect(out.existingIntents[0].status).toBe("")
  expect(out.existingIntents[0].issue).toBe("7")
})

test("intent 書式 v2: ---x の行は frontmatter の閉じ区切りにならない", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-09-21-fake-close.md",
    [
      "---",
      "intent: v2",
      "slug: fake-close",
      "----x",
      "status: approved",
      "---",
      "",
      "# intent: 偽の閉じ",
      ""
    ].join("\n")
  )

  const out = runScript(dir)
  expect(out.existingIntents[0].status).toBe("approved")
})
