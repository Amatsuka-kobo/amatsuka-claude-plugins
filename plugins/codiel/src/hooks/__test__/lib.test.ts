import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
// 契約 §13 の実装間一致検証(R4)のためだけの相対 import。
// codiel の実行時に metatron を参照することはない(テストコード限定)。
import { extractDomains } from "../../../../metatron/src/lib/architecture.js"
import { loadConfig } from "../../../../metatron/src/lib/config.js"
import {
  findDocRoot,
  findProjectRoot,
  globToRegExp,
  readDomains,
  readDomainsResult,
  resolveDocPaths
} from "../lib.js"

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

// /tmp が symlink である環境(macOS 等)で findDocRoot の realpath 解決と食い違わせない。
function mkTmp(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  tmpDirs.push(dir)
  return dir
}

function mkSub(root: string, ...segments: string[]): string {
  const dir = path.join(root, ...segments)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

function writeConfig(dir: string, value: unknown): void {
  writeFile(
    path.join(dir, "metatron.config.json"),
    `${JSON.stringify(value, null, 2)}\n`
  )
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" })
}

function insideGitRepo(dir: string): boolean {
  return (
    spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8"
    }).status === 0
  )
}

// 契約 §13: 同一構成に対して metatron の config.ts と codiel の resolveDocPaths が
// docRoot と解決パスの**両方**で一致することを検証する。
function expectSameResolution(startDir: string, label: string): void {
  const mine = resolveDocPaths(startDir)
  const theirs = loadConfig(startDir)
  expect(mine.docRoot, `${label}: docRoot`).toBe(theirs.docRoot)
  expect(mine.architecture, `${label}: architecture`).toBe(
    theirs.architecturePath
  )
  expect(mine.gotchas, `${label}: gotchas`).toBe(theirs.gotchasPath)
  // 既定値へ落とした理由も揃える。文言の完全一致は求めず(3 実装の同期コストが上がる)、
  // 警告が出るか出ないかと件数を見る(契約 §3 規則 3)。
  expect(mine.warnings.length > 0, `${label}: 警告の有無`).toBe(
    theirs.warnings.length > 0
  )
  expect(mine.warnings.length, `${label}: 警告の件数`).toBe(
    theirs.warnings.length
  )
}

test("globToRegExp: src/** は src/a/b.ts にマッチする", () => {
  expect("src/a/b.ts").toMatch(globToRegExp("src/**"))
})

test("globToRegExp: src/** は other/x にマッチしない", () => {
  expect("other/x").not.toMatch(globToRegExp("src/**"))
})

test("globToRegExp: *.md はディレクトリを跨がずファイル名にマッチする", () => {
  expect("readme.md").toMatch(globToRegExp("*.md"))
})

test("globToRegExp: *.md はディレクトリを跨ぐパスにはマッチしない", () => {
  expect("src/readme.md").not.toMatch(globToRegExp("*.md"))
})

test("globToRegExp: ** は深いネストのパスにもマッチする", () => {
  expect("a/b/c.ts").toMatch(globToRegExp("**"))
})

test("R1: readDomains は json metatron:domains ブロックを抽出できる", () => {
  const root = mkTmp("lib-domains-")
  const body = [
    "# Architecture",
    "",
    "```json metatron:domains",
    '{"domains": ["auth", "billing"]}',
    "```",
    ""
  ].join("\n")
  writeFile(path.join(root, "docs", "ARCHITECTURE.md"), body)
  expect(readDomains(root)).toStrictEqual({ domains: ["auth", "billing"] })
})

test("readDomains: json metatron:domains ブロックがなければ null", () => {
  const root = mkTmp("lib-domains-")
  writeFile(
    path.join(root, "docs", "ARCHITECTURE.md"),
    "# Architecture\n\nno domains block here\n"
  )
  expect(readDomains(root)).toBe(null)
})

test("readDomains: 壊れた JSON なら null", () => {
  const root = mkTmp("lib-domains-")
  const body = ["```json metatron:domains", "{not valid json", "```", ""].join(
    "\n"
  )
  writeFile(path.join(root, "docs", "ARCHITECTURE.md"), body)
  expect(readDomains(root)).toBe(null)
})

test("readDomains: ARCHITECTURE が存在しなければ null", () => {
  const root = mkTmp("lib-domains-")
  expect(readDomains(root)).toBe(null)
})

test("R2: 旧マーカー codiel:domains は読まない(互換読みは無い)", () => {
  const root = mkTmp("lib-domains-old-")
  const body = [
    "# Architecture",
    "",
    "```json codiel:domains",
    '{"domains": ["auth"]}',
    "```",
    ""
  ].join("\n")
  writeFile(path.join(root, "docs", "ARCHITECTURE.md"), body)
  expect(readDomains(root)).toBe(null)
})

test("R3: 設定ファイルでパスを変えた ARCHITECTURE を読む", () => {
  const root = mkTmp("lib-domains-config-")
  writeConfig(root, {
    version: 1,
    paths: { architecture: "arch/MAIN.md", gotchas: "arch/GOTCHAS.md" }
  })
  // 既定パスにはダミーを置き、設定側が優先されることを確かめる
  writeFile(
    path.join(root, "docs", "ARCHITECTURE.md"),
    ["```json metatron:domains", '{"domains": ["default"]}', "```", ""].join(
      "\n"
    )
  )
  writeFile(
    path.join(root, "arch", "MAIN.md"),
    ["```json metatron:domains", '{"domains": ["configured"]}', "```", ""].join(
      "\n"
    )
  )
  const sub = mkSub(root, "src", "deep")
  expect(readDomains(sub)).toStrictEqual({ domains: ["configured"] })
})

test("R8: 最小 ARCHITECTURE(ドメインマップだけ)を readDomains が読める", () => {
  const root = mkTmp("lib-domains-minimal-")
  const body = [
    "# ARCHITECTURE",
    "",
    "## ドメインマップ",
    "",
    "```json metatron:domains",
    "{",
    '  "generic": ["**"]',
    "}",
    "```",
    ""
  ].join("\n")
  writeFile(path.join(root, "docs", "ARCHITECTURE.md"), body)
  expect(readDomains(root)).toStrictEqual({ generic: ["**"] })
})

// ---------------------------------------------------------------------------
// R9: フェンス判定は契約 §4-2 の状態機械に従う(独自のフェンス判定を書かない。契約 §1)
//
// 正規表現でブロックを切り出す実装は CRLF 改行の文書を読めず、チルダのフェンスにも
// 対応できず、「開始と同じ文字を開始と同数以上」という終了条件も表現できない。
// 同じ ARCHITECTURE を metatron / sandalphon が読めて codiel だけ読めない状態を防ぐ。
// ---------------------------------------------------------------------------

function writeArchitecture(root: string, lines: string[], eol = "\n"): void {
  writeFile(
    path.join(root, "docs", "ARCHITECTURE.md"),
    `${lines.join(eol)}${eol}`
  )
}

test("R9: CRLF 改行の ARCHITECTURE からドメインマップを読める", () => {
  const root = mkTmp("lib-domains-crlf-")
  writeArchitecture(
    root,
    [
      "# ARCHITECTURE",
      "",
      "## ドメインマップ",
      "",
      "```json metatron:domains",
      '{ "frontend": ["src/app/**"] }',
      "```"
    ],
    "\r\n"
  )
  expect(readDomains(root)).toStrictEqual({ frontend: ["src/app/**"] })
})

test("R9: チルダ 3 個のフェンスからドメインマップを読める", () => {
  const root = mkTmp("lib-domains-tilde-")
  writeArchitecture(root, [
    "~~~json metatron:domains",
    '{ "backend": ["src/server/**"] }',
    "~~~"
  ])
  expect(readDomains(root)).toStrictEqual({ backend: ["src/server/**"] })
})

test("R9: インデント 2 のフェンス(リスト項目の中のブロック)を読める", () => {
  const root = mkTmp("lib-domains-indent2-")
  writeArchitecture(root, [
    "## ドメインマップ",
    "",
    "- ドメイン定義:",
    "",
    "  ```json metatron:domains",
    "  {",
    '    "frontend": ["src/app/**"],',
    '    "_note": ["コードブロックは ``` で囲む"]',
    "  }",
    "  ```"
  ])
  expect(readDomains(root)).toStrictEqual({
    frontend: ["src/app/**"],
    _note: ["コードブロックは ``` で囲む"]
  })
})

test("R9: インデント 4 の行はフェンスとして扱わない", () => {
  const root = mkTmp("lib-domains-indent4-")
  writeArchitecture(root, [
    "# ARCHITECTURE",
    "",
    "    ```json metatron:domains",
    '    { "indented": ["never"] }',
    "    ```",
    "",
    "```json metatron:domains",
    '{ "real": ["src/**"] }',
    "```"
  ])
  expect(readDomains(root)).toStrictEqual({ real: ["src/**"] })
})

test("R9: 開始が 4 個のバッククォートなら 3 個の行では閉じない", () => {
  const root = mkTmp("lib-domains-fence4-")
  writeArchitecture(root, [
    "# ARCHITECTURE",
    "",
    "````markdown",
    "書き方の例:",
    "",
    "```json metatron:domains",
    '{ "example": ["docs/**"] }',
    "```",
    "````",
    "",
    "## ドメインマップ",
    "",
    "```json metatron:domains",
    '{ "frontend": ["src/app/**"] }',
    "```"
  ])
  expect(readDomains(root)).toStrictEqual({ frontend: ["src/app/**"] })
})

test("R9: ブロックが 2 個以上あれば最初のものを採る", () => {
  const root = mkTmp("lib-domains-first-")
  writeArchitecture(root, [
    "```json metatron:domains",
    '{ "first": ["a/**"] }',
    "```",
    "",
    "```json metatron:domains",
    '{ "second": ["b/**"] }',
    "```"
  ])
  expect(readDomains(root)).toStrictEqual({ first: ["a/**"] })
})

test("R9: 最初のブロックがチルダでもそれを採る", () => {
  const root = mkTmp("lib-domains-first-tilde-")
  writeArchitecture(root, [
    "~~~json metatron:domains",
    '{ "first": ["a/**"] }',
    "~~~",
    "",
    "```json metatron:domains",
    '{ "second": ["b/**"] }',
    "```"
  ])
  expect(readDomains(root)).toStrictEqual({ first: ["a/**"] })
})

// ---------------------------------------------------------------------------
// R11: 契約 §1 の検証 4 項目を読み取り時にも適用する
//
// JSON として parse できただけの値を「読めた」として返すと、metatron
// (`extractDomains`)と sandalphon(`readDomains`)が「読めない」とする同じ入力を
// codiel だけが受け入れ、3 実装の契約が割れる。各ケースで metatron の判定とも
// 突き合わせ、割れていないことを機械的に確かめる。
// ---------------------------------------------------------------------------

// ブロックの中身だけを差し替えた ARCHITECTURE を書き、codiel と metatron の
// 「読めたか」が一致することを確かめる。
function expectUnreadable(prefix: string, content: string): void {
  const root = mkTmp(prefix)
  const lines = [
    "# ARCHITECTURE",
    "",
    "```json metatron:domains",
    content,
    "```"
  ]
  writeArchitecture(root, lines)
  expect(readDomains(root), `codiel: ${content}`).toBe(null)
  expect(
    extractDomains(`${lines.join("\n")}\n`).ok,
    `metatron: ${content}`
  ).toBe(false)
}

test("R11-1: ブロックが有効な JSON でなければ読めない", () => {
  expectUnreadable("lib-domains-v1-", '{ "frontend": ')
})

test("R11-2: トップレベルが配列・null・数値・文字列なら読めない", () => {
  expectUnreadable("lib-domains-v2-array-", "[]")
  expectUnreadable("lib-domains-v2-array2-", '["src/**"]')
  expectUnreadable("lib-domains-v2-null-", "null")
  expectUnreadable("lib-domains-v2-num-", "42")
  expectUnreadable("lib-domains-v2-str-", '"frontend"')
})

test("R11-3: 値が 1 要素以上の文字列配列でなければ読めない", () => {
  expectUnreadable("lib-domains-v3-empty-", '{ "x": [] }')
  expectUnreadable("lib-domains-v3-num-", '{ "x": [1] }')
  expectUnreadable("lib-domains-v3-mixed-", '{ "x": ["src/**", 1] }')
  expectUnreadable("lib-domains-v3-str-", '{ "x": "src/**" }')
  expectUnreadable("lib-domains-v3-obj-", '{ "x": { "glob": "src/**" } }')
  expectUnreadable("lib-domains-v3-null-", '{ "x": null }')
  // 1 つでも反すれば全体を「読めない」とする(部分採用をしない)。
  expectUnreadable("lib-domains-v3-partial-", '{ "ok": ["src/**"], "ng": [] }')
})

test("R11-4: キーが 1 個も無ければ読めない", () => {
  expectUnreadable("lib-domains-v4-", "{}")
})

test("R11: 4 項目を満たす値はそのまま返す(検証で弾きすぎない)", () => {
  const root = mkTmp("lib-domains-valid-")
  writeArchitecture(root, [
    "```json metatron:domains",
    '{ "frontend": ["src/app/**", "src/components/**"], "data": ["db/**"] }',
    "```"
  ])
  expect(readDomains(root)).toStrictEqual({
    frontend: ["src/app/**", "src/components/**"],
    data: ["db/**"]
  })
})

// ---------------------------------------------------------------------------
// R11: 重複ブロックの警告(契約 §1「警告は経路を問わず返す」)
//
// 最初のブロックを採るだけで黙ると、重複という異常な状態に誰も気づけない。
// metatron は `findDomainsBlock` で同じ警告を返す。警告の口が無いことが割れであった。
// ---------------------------------------------------------------------------

test("R11: ブロックが 2 個以上あれば警告を返す(採るのは最初のもの)", () => {
  const root = mkTmp("lib-domains-dup-warn-")
  writeArchitecture(root, [
    "```json metatron:domains",
    '{ "first": ["a/**"] }',
    "```",
    "",
    "```json metatron:domains",
    '{ "second": ["b/**"] }',
    "```"
  ])
  const result = readDomainsResult(root)
  expect(result.domains).toStrictEqual({ first: ["a/**"] })
  expect(result.warnings.length).toBe(1)
  expect(result.warnings[0]).toContain("metatron:domains")
  // 警告の有無と件数を metatron と揃える(文言の一致までは求めない)。
  const text = fs.readFileSync(
    path.join(root, "docs", "ARCHITECTURE.md"),
    "utf8"
  )
  expect(result.warnings.length).toBe(extractDomains(text).warnings.length)
})

test("R11: ブロックが 1 個だけなら警告は出ない", () => {
  const root = mkTmp("lib-domains-single-warn-")
  writeArchitecture(root, [
    "```json metatron:domains",
    '{ "only": ["a/**"] }',
    "```"
  ])
  expect(readDomainsResult(root).warnings).toStrictEqual([])
})

test("R11: 未閉フェンスは終端までを内容として扱い警告を返す", () => {
  const root = mkTmp("lib-domains-unclosed-warn-")
  writeArchitecture(root, [
    "# ARCHITECTURE",
    "",
    "```json metatron:domains",
    '{ "frontend": ["src/app/**"] }'
  ])
  const result = readDomainsResult(root)
  expect(result.domains).toStrictEqual({ frontend: ["src/app/**"] })
  expect(result.warnings.length).toBe(1)
})

// 契約 §1「開始マーカーが他のフェンスに取り込まれ、ブロックとして認識されない
// ときは警告を返す」。`null` を返す点は「ブロックが無い」と同じだが原因が違う。
// 区別せずに黙ると、書き手は自分の置いたブロックが読まれていないことに気づけない。
test("R11: 無関係な未閉フェンスにマーカーが呑まれたら警告を 1 件返す", () => {
  const root = mkTmp("lib-domains-swallowed-")
  writeArchitecture(root, [
    "# ARCHITECTURE",
    "",
    "```ts",
    "const x = 1",
    "",
    "## ドメインマップ",
    "",
    "```json metatron:domains",
    '{ "frontend": ["src/app/**"] }',
    ""
  ])
  const result = readDomainsResult(root)
  expect(result.domains).toBe(null)
  expect(result.warnings.length).toBe(1)
  // 警告の有無と件数を metatron と揃える(文言の一致までは求めない)。
  const text = fs.readFileSync(
    path.join(root, "docs", "ARCHITECTURE.md"),
    "utf8"
  )
  expect(result.warnings.length).toBe(extractDomains(text).warnings.length)
})

test("R11: マーカーが無い最小 ARCHITECTURE は警告 0 件(正当な状態と区別する)", () => {
  const root = mkTmp("lib-domains-no-marker-")
  writeArchitecture(root, ["# ARCHITECTURE", "", "## ドメインマップ", ""])
  const result = readDomainsResult(root)
  expect(result.domains).toBe(null)
  expect(result.warnings).toStrictEqual([])
})

test("R11: 内容が読めなくても重複の警告は返す", () => {
  const root = mkTmp("lib-domains-dup-broken-")
  writeArchitecture(root, [
    "```json metatron:domains",
    "{}",
    "```",
    "",
    "```json metatron:domains",
    '{ "second": ["b/**"] }',
    "```"
  ])
  const result = readDomainsResult(root)
  expect(result.domains).toBe(null)
  expect(result.warnings.length).toBe(1)
})

// 契約 §1「警告は経路を問わず返す」に対する **到達経路の固定**。
// `readDomains` は警告を落とす。落とすこと自体は仕様だが、**警告を出す口を持つ経路が
// この薄いラッパを使ってはならない**。前回の欠陥はまさにそれで、`readDomainsResult` を
// 足しながら実運用の呼び出し元が `readDomains` のまま残り、警告が断線していた。
//
// 到達の可否は経路ごとに次で固定する。ここを「警告は捨ててよい」と読める形に緩めない。
// - lib の読み取り(この test)   : `readDomainsResult` は返す / `readDomains` は落とす
// - guard-write(PreToolUse hook): ask の理由に添う。素通し時は出す口が無く届かない
//   (`__test__/guard-write.test.ts` の「重複ブロック…ask の理由に警告が添う」で固定)
// - skills の検証コマンド        : `readDomainsResult` を呼び、完了報告へ出す
test("R11: 警告は readDomainsResult で届き、readDomains では落ちる(経路の固定)", () => {
  const root = mkTmp("lib-domains-wrapper-")
  writeArchitecture(root, [
    "```json metatron:domains",
    '{ "first": ["a/**"] }',
    "```",
    "",
    "```json metatron:domains",
    '{ "second": ["b/**"] }',
    "```"
  ])
  // 同じ入力・同じ値。違うのは警告が届くかどうかだけである。
  const result = readDomainsResult(root)
  expect(result.domains).toStrictEqual({ first: ["a/**"] })
  expect(result.warnings.length).toBe(1)
  expect(readDomains(root)).toStrictEqual({ first: ["a/**"] })
})

test("R11: ARCHITECTURE が無ければ警告も出ない(正常な状態)", () => {
  const root = mkTmp("lib-domains-absent-warn-")
  expect(readDomainsResult(root)).toStrictEqual({
    domains: null,
    warnings: []
  })
})

// ---------------------------------------------------------------------------
// R10: 契約 §3 規則 3 — 拒否した理由を呼び出し元へ返す(黙って既定値に落とさない)
//
// metatron は ResolvedConfig.warnings、sandalphon は出力 JSON の configWarnings で
// 同じ理由を返す。codiel だけが理由を落とすと、利用者は設定が効いていないことに
// 気づけない。
// ---------------------------------------------------------------------------

test("R10: paths が絶対パスなら既定値に落ち、理由を warnings で返す", () => {
  const root = mkTmp("lib-warn-abs-")
  writeConfig(root, {
    version: 1,
    paths: { architecture: "/etc/ARCHITECTURE.md", gotchas: "C:/GOTCHAS.md" }
  })
  const resolved = resolveDocPaths(root)
  expect(resolved.architecture).toBe(path.join(root, "docs", "ARCHITECTURE.md"))
  expect(resolved.gotchas).toBe(path.join(root, "docs", "GOTCHAS.md"))
  expect(resolved.warnings.length).toBe(2)
  expect(resolved.warnings.join("\n")).toContain("paths.architecture")
  expect(resolved.warnings.join("\n")).toContain("paths.gotchas")
})

test("R10: paths がルート脱出なら既定値に落ち、理由を warnings で返す", () => {
  const root = mkTmp("lib-warn-escape-")
  writeConfig(root, {
    version: 1,
    paths: { architecture: "../outside/ARCHITECTURE.md", gotchas: ".." }
  })
  const resolved = resolveDocPaths(root)
  expect(resolved.architecture).toBe(path.join(root, "docs", "ARCHITECTURE.md"))
  expect(resolved.gotchas).toBe(path.join(root, "docs", "GOTCHAS.md"))
  expect(resolved.warnings.length).toBe(2)
})

test("R10: 壊れた JSON なら全項目が既定値になり、理由を warnings で返す", () => {
  const root = mkTmp("lib-warn-broken-")
  writeFile(path.join(root, "metatron.config.json"), "{ not json")
  const resolved = resolveDocPaths(root)
  expect(resolved.architecture).toBe(path.join(root, "docs", "ARCHITECTURE.md"))
  expect(resolved.gotchas).toBe(path.join(root, "docs", "GOTCHAS.md"))
  expect(resolved.warnings.length).toBe(1)

  // トップレベルがオブジェクトでない場合も「壊れた JSON」に含める(契約 §2)。
  const arr = mkTmp("lib-warn-array-")
  writeFile(path.join(arr, "metatron.config.json"), "[1, 2, 3]\n")
  expect(resolveDocPaths(arr).warnings.length).toBe(1)
})

test("R10: 未知の version なら全項目が既定値になり、理由を warnings で返す", () => {
  const root = mkTmp("lib-warn-version-")
  writeConfig(root, { version: 99, paths: { architecture: "arch/MAIN.md" } })
  const resolved = resolveDocPaths(root)
  expect(resolved.architecture).toBe(path.join(root, "docs", "ARCHITECTURE.md"))
  expect(resolved.warnings.length).toBe(1)
})

test("R10: paths の型不整合はその項目だけ既定値に落とし、理由を返す", () => {
  const root = mkTmp("lib-warn-typed-")
  writeConfig(root, { version: 1, paths: { architecture: 42, gotchas: "" } })
  const resolved = resolveDocPaths(root)
  expect(resolved.architecture).toBe(path.join(root, "docs", "ARCHITECTURE.md"))
  expect(resolved.gotchas).toBe(path.join(root, "docs", "GOTCHAS.md"))
  expect(resolved.warnings.length).toBe(2)
})

test("R10: 設定ファイルが無いことは警告にしない(正常な状態)", () => {
  const root = mkTmp("lib-warn-none-")
  expect(resolveDocPaths(root).warnings).toStrictEqual([])
})

test("findDocRoot: 開始ディレクトリ自身の設定ファイルを採る(inclusive)", () => {
  const dir = mkTmp("lib-docroot-self-")
  writeConfig(dir, { version: 1 })
  expect(findDocRoot(dir)).toBe(dir)
})

test("findDocRoot: 設定も git も無ければ開始ディレクトリを返す", () => {
  const root = mkTmp("lib-docroot-none-")
  const sub = mkSub(root, "a", "b")
  if (insideGitRepo(sub)) return
  expect(findDocRoot(sub)).toBe(sub)
})

test("R5: findDocRoot と findProjectRoot は別ディレクトリを返す", () => {
  // repo/metatron.config.json と repo/sub/.codiel/ が併存し、repo/sub から実行する構成。
  const root = mkTmp("lib-two-roots-")
  writeConfig(root, { version: 1 })
  const sub = mkSub(root, "sub")
  fs.mkdirSync(path.join(sub, ".codiel"), { recursive: true })

  // 文書は config 祖先基準(repo)、codiel 資産は .codiel 祖先基準(repo/sub)。
  expect(findDocRoot(sub)).toBe(root)
  expect(findProjectRoot(sub)).toBe(sub)
  expect(findDocRoot(sub)).not.toBe(findProjectRoot(sub))
  expect(resolveDocPaths(sub).architecture).toBe(
    path.join(root, "docs", "ARCHITECTURE.md")
  )
})

test("R4: 設定ファイル無し(git 管理外)で metatron と一致する", () => {
  const root = mkTmp("lib-cmp-nogit-")
  const sub = mkSub(root, "a", "b")
  if (insideGitRepo(sub)) return
  expectSameResolution(root, "git 管理外のルート")
  expectSameResolution(sub, "git 管理外のサブディレクトリ")
})

test("R4: 設定ファイル無し(git リポジトリ)で metatron と一致する", () => {
  const root = mkTmp("lib-cmp-git-")
  gitInit(root)
  const sub = mkSub(root, "a", "b")
  expectSameResolution(sub, "git リポジトリのサブディレクトリ")
  expect(resolveDocPaths(sub).docRoot).toBe(root)
})

test("R4: 祖先の設定ファイル・開始ディレクトリ自身の設定ファイルで一致する", () => {
  const root = mkTmp("lib-cmp-ancestor-")
  writeConfig(root, { version: 1, paths: { architecture: "arch/MAIN.md" } })
  const sub = mkSub(root, "a", "b")
  expectSameResolution(sub, "祖先に設定ファイル")
  expectSameResolution(root, "開始ディレクトリ自身に設定ファイル")

  const mid = mkSub(root, "a")
  writeConfig(mid, { version: 1 })
  expectSameResolution(sub, "最も近い祖先の設定ファイル")
  expect(resolveDocPaths(sub).docRoot).toBe(mid)
})

test("R4: repo/metatron.config.json と repo/sub/.codiel の併存で一致する", () => {
  const root = mkTmp("lib-cmp-codiel-")
  writeConfig(root, { version: 1 })
  const sub = mkSub(root, "sub")
  fs.mkdirSync(path.join(sub, ".codiel"), { recursive: true })
  expectSameResolution(sub, ".codiel と設定ファイルの併存")
})

test("R4: paths が絶対パス / ルート脱出のとき既定値に落ちて一致する", () => {
  const abs = mkTmp("lib-cmp-abs-")
  writeConfig(abs, {
    version: 1,
    paths: { architecture: "/etc/ARCHITECTURE.md", gotchas: "C:/GOTCHAS.md" }
  })
  expectSameResolution(abs, "絶対パス")
  expect(resolveDocPaths(abs).architecture).toBe(
    path.join(abs, "docs", "ARCHITECTURE.md")
  )

  const esc = mkTmp("lib-cmp-escape-")
  writeConfig(esc, {
    version: 1,
    paths: { architecture: "../outside/ARCHITECTURE.md", gotchas: ".." }
  })
  expectSameResolution(esc, "ルート脱出")
  expect(resolveDocPaths(esc).gotchas).toBe(
    path.join(esc, "docs", "GOTCHAS.md")
  )
})

test("R4: 壊れた設定・未知の version・型不整合で一致する", () => {
  const broken = mkTmp("lib-cmp-broken-")
  writeFile(path.join(broken, "metatron.config.json"), "{ not json")
  expectSameResolution(broken, "壊れた JSON")

  const arr = mkTmp("lib-cmp-array-")
  writeFile(path.join(arr, "metatron.config.json"), "[1, 2, 3]\n")
  expectSameResolution(arr, "トップレベルが配列")

  const unknown = mkTmp("lib-cmp-version-")
  writeConfig(unknown, {
    version: 99,
    paths: { architecture: "arch/MAIN.md" }
  })
  expectSameResolution(unknown, "未知の version")

  const typed = mkTmp("lib-cmp-typed-")
  writeConfig(typed, { version: 1, paths: { architecture: 42, gotchas: "" } })
  expectSameResolution(typed, "paths の型不整合")
})

test("R4: Windows 形式の区切りを含む paths で一致する", () => {
  const root = mkTmp("lib-cmp-winsep-")
  writeConfig(root, {
    version: 1,
    paths: { architecture: "docs\\arch\\MAIN.md", gotchas: "..\\outside.md" }
  })
  expectSameResolution(root, "Windows 形式の区切り")
})

test("R4: シンボリックリンク経由の開始ディレクトリで一致する", () => {
  const base = mkTmp("lib-cmp-symlink-")
  const real = mkSub(base, "real")
  writeConfig(real, { version: 1 })
  const link = path.join(base, "link")
  try {
    fs.symlinkSync(real, link, "dir")
  } catch {
    return // symlink を作れない環境(Windows 等)ではスキップする
  }
  expect(findDocRoot(link)).toBe(real)
  expectSameResolution(link, "シンボリックリンク経由")
})

test("R4: ネストした git リポジトリで一致する", () => {
  const root = mkTmp("lib-cmp-nested-git-")
  gitInit(root)
  const inner = mkSub(root, "inner")
  gitInit(inner)
  const sub = mkSub(inner, "sub")
  expectSameResolution(sub, "ネストした git リポジトリ")
  expect(resolveDocPaths(sub).docRoot).toBe(inner)
})

test("R4: git バイナリが無い環境でも例外を投げず一致する", () => {
  const root = mkTmp("lib-cmp-nogitbin-")
  const sub = mkSub(root, "a", "b")
  const savedPath = process.env.PATH
  process.env.PATH = ""
  try {
    expect(() => findDocRoot(sub)).not.toThrow()
    expect(findDocRoot(sub)).toBe(sub)
    expectSameResolution(sub, "git バイナリ無し")
  } finally {
    if (savedPath === undefined) delete process.env.PATH
    else process.env.PATH = savedPath
  }
})

test("findProjectRoot: サブディレクトリから祖先の .codiel を発見できる", () => {
  const root = mkTmp("lib-root-")
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true })
  const sub = mkSub(root, "a", "b")
  expect(fs.realpathSync(findProjectRoot(sub))).toBe(fs.realpathSync(root))
})

test("findProjectRoot: .codiel が見つからなければ startDir をそのまま返す", () => {
  const root = mkTmp("lib-noroot-")
  const sub = mkSub(root, "a", "b")
  expect(findProjectRoot(sub)).toBe(sub)
})
