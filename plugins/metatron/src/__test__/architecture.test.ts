// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §1・§4 の検証。
// ケース ID は metatron 設計書 §13-1 の architecture.ts の表(A1〜A19)に対応する。
// 末尾の「追加」ケースは契約 §4-2 の正規化(インデント・CRLF・末尾空白)に対応する。

import { describe, expect, test } from "vitest"
import {
  ARCHITECTURE_HEADINGS,
  applySectionChanges,
  extractDomains,
  findSection,
  parseArchitecture,
  parseArchitectureForRead,
  parseArchitectureForWrite,
  parseDomainsContent,
  prepareArchitectureUpdate,
  UNCLOSED_FENCE_WARNING,
  validateHeadingKey
} from "../lib/architecture.js"

// 行の配列から文書を組み立てる。末尾の "" が最終改行になる。
function doc(...lines: string[]): string {
  return lines.join("\n")
}

const TEN_SECTIONS = doc(
  "# ARCHITECTURE",
  "",
  "## システム概要",
  "",
  "サンプルプロジェクトの概要を 1 段落で書く。",
  "",
  "```mermaid",
  "graph TD",
  "  A[## これは見出しではない] --> B",
  "```",
  "",
  "## 技術スタック",
  "",
  "| 項目 | 値 |",
  "| --- | --- |",
  "| 言語 | TypeScript |",
  "",
  "## レイヤー構造",
  "",
  "- UI 層 → ドメイン層 → データ層",
  "- ドメイン層は UI 層を参照しない。",
  "",
  "## ディレクトリ構成と責務",
  "",
  "- `src/` 実装",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  "{",
  '  "frontend": ["src/app/**", "src/components/**"],',
  '  "backend": ["src/server/**"]',
  "}",
  "```",
  "",
  "## コマンド定義",
  "",
  "| 用途 | コマンド |",
  "| --- | --- |",
  "| test | pnpm test |",
  "",
  "## テスト方針",
  "",
  "- vitest を使う。",
  "",
  "## 保護パス",
  "",
  "- `.env`",
  "",
  "## 規約",
  "",
  "- biome に従う。",
  "",
  "## ADR 一覧",
  "",
  "### ADR-001: 最初の判断",
  "",
  "- 状態: 採用",
  "- 決定日: 2026-08-16",
  ""
)

const MINIMAL_DOMAINS_ONLY = doc(
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
)

const UNCLOSED = doc(
  "# ARCHITECTURE",
  "",
  "## システム概要",
  "",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "",
  "## 技術スタック",
  "",
  "閉じ忘れたフェンスの後ろにある本文。",
  ""
)

// 対象セクション以外の全バイト(前置き + 他セクションの原文)。
function untouchedBytes(text: string, heading: string): string {
  const parsed = parseArchitecture(text)
  return (
    parsed.preamble +
    parsed.sections
      .filter((s) => s.heading !== heading)
      .map((s) => s.raw)
      .join("")
  )
}

function headings(text: string): string[] {
  return parseArchitecture(text).sections.map((s) => s.heading)
}

function expectOk(
  result: ReturnType<typeof prepareArchitectureUpdate>
): Extract<typeof result, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result
}

test("A1: 10 セクションの分解 — 見出し単位に正しく分割される", () => {
  const parsed = parseArchitecture(TEN_SECTIONS)

  expect(parsed.error).toBeNull()
  expect(parsed.warnings).toEqual([])
  expect(parsed.sections.map((s) => s.heading)).toEqual([
    ...ARCHITECTURE_HEADINGS
  ])
  // 分解は可逆であること(前置き + 全セクションの原文 = 元テキスト)。
  expect(parsed.preamble + parsed.sections.map((s) => s.raw).join("")).toBe(
    TEN_SECTIONS
  )
  expect(parsed.preamble).toBe("# ARCHITECTURE\n\n")
  expect(findSection(parsed, "テスト方針")?.body).toBe(
    "\n- vitest を使う。\n\n"
  )
})

describe("A2: セクション置換 — 対象セクション以外がバイト単位で不変", () => {
  test("既存セクションの差し替え", () => {
    const result = expectOk(
      prepareArchitectureUpdate(TEN_SECTIONS, [
        { heading: "技術スタック", body: "- 言語: Rust\n- ランタイム: なし" }
      ])
    )

    expect(untouchedBytes(result.text, "技術スタック")).toBe(
      untouchedBytes(TEN_SECTIONS, "技術スタック")
    )
    expect(headings(result.text)).toEqual([...ARCHITECTURE_HEADINGS])
    expect(
      findSection(parseArchitecture(result.text), "技術スタック")?.body
    ).toBe("\n- 言語: Rust\n- ランタイム: なし\n\n")
    expect(result.text).not.toContain("| 言語 | TypeScript |")
    // 見出し行そのものも書き換えない。
    expect(result.text).toContain("\n## 技術スタック\n")
  })

  test("先頭セクションと末尾セクションでも成り立つ", () => {
    for (const heading of ["システム概要", "規約"]) {
      const result = expectOk(
        prepareArchitectureUpdate(TEN_SECTIONS, [
          { heading, body: `差し替え後の ${heading}` }
        ])
      )
      expect(untouchedBytes(result.text, heading)).toBe(
        untouchedBytes(TEN_SECTIONS, heading)
      )
    }
  })

  test("複数セクションの同時差し替えでも他は不変", () => {
    const result = expectOk(
      prepareArchitectureUpdate(TEN_SECTIONS, [
        { heading: "テスト方針", body: "- 変更後" },
        { heading: "技術スタック", body: "- 変更後" }
      ])
    )
    const skip = new Set(["テスト方針", "技術スタック"])
    const before = parseArchitecture(TEN_SECTIONS)
    const after = parseArchitecture(result.text)
    expect(after.preamble).toBe(before.preamble)
    for (const section of before.sections) {
      if (skip.has(section.heading)) continue
      expect(findSection(after, section.heading)?.raw).toBe(section.raw)
    }
  })
})

test("A3: metatron:domains の抽出 — 正しい JSON を返す", () => {
  const result = extractDomains(TEN_SECTIONS)

  expect(result.ok).toBe(true)
  expect(result.domains).toEqual({
    frontend: ["src/app/**", "src/components/**"],
    backend: ["src/server/**"]
  })
  expect(result.warnings).toEqual([])
})

test("A4: 旧 codiel:domains マーカーは抽出されない", () => {
  const legacy = doc(
    "# ARCHITECTURE",
    "",
    "## ドメインマップ",
    "",
    "```json codiel:domains",
    "{",
    '  "frontend": ["src/app/**"]',
    "}",
    "```",
    ""
  )

  const result = extractDomains(legacy)

  expect(result.ok).toBe(false)
  expect(result.reason).toBe("block_not_found")
  expect(result.domains).toBeNull()
})

describe("A5: ドメインマップの検証 4 項目", () => {
  const cases: Array<[string, string, string]> = [
    ["不正 JSON", "{ invalid", "invalid_json"],
    ["配列トップレベル", '["src/**"]', "not_an_object"],
    ["空オブジェクト", "{}", "no_domains"],
    ["空配列の値", '{ "frontend": [] }', "invalid_globs"],
    ["文字列でない要素", '{ "frontend": [1] }', "invalid_globs"],
    ["null トップレベル", "null", "not_an_object"]
  ]

  for (const [label, content, reason] of cases) {
    test(`${label} → 検証失敗`, () => {
      const parsed = parseDomainsContent(content)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) return
      expect(parsed.reason).toBe(reason)

      // stage も拒否する(壊れたブロックは stage すらできない)。
      const body = doc("```json metatron:domains", content, "```", "")
      const result = prepareArchitectureUpdate(TEN_SECTIONS, [
        { heading: "ドメインマップ", body }
      ])
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe("invalid_domains")
    })
  }

  test("正当なブロックは stage できる", () => {
    const body = doc(
      "```json metatron:domains",
      "{",
      '  "generic": ["**"]',
      "}",
      "```",
      ""
    )
    const result = expectOk(
      prepareArchitectureUpdate(TEN_SECTIONS, [
        { heading: "ドメインマップ", body }
      ])
    )
    expect(extractDomains(result.text).domains).toEqual({ generic: ["**"] })
    expect(untouchedBytes(result.text, "ドメインマップ")).toBe(
      untouchedBytes(TEN_SECTIONS, "ドメインマップ")
    )
  })
})

test("A6: 未知の見出しを stage → エラー", () => {
  const result = prepareArchitectureUpdate(TEN_SECTIONS, [
    { heading: "パフォーマンス方針", body: "本文" }
  ])

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("unknown_heading")
  expect(result.message).toContain("パフォーマンス方針")

  expect(validateHeadingKey("システム概要").ok).toBe(true)
})

test("A7: ファイル未作成での stage → 全文追加(新規作成)を返す", () => {
  const result = expectOk(
    prepareArchitectureUpdate(null, [
      { heading: "ドメインマップ", body: "本文" },
      { heading: "システム概要", body: "概要の散文。" }
    ])
  )

  expect(result.created).toBe(true)
  expect(result.applied).toEqual([
    { heading: "ドメインマップ", mode: "added" },
    { heading: "システム概要", mode: "added" }
  ])
  expect(result.text.startsWith("# ARCHITECTURE\n\n")).toBe(true)
  // 契約 §4-1 の順序で並ぶ。
  expect(headings(result.text)).toEqual(["システム概要", "ドメインマップ"])
  expect(parseArchitecture(result.text).error).toBeNull()

  // 空白のみのファイルも新規作成として扱う。
  expect(
    expectOk(
      prepareArchitectureUpdate("\n \n", [{ heading: "規約", body: "- biome" }])
    ).created
  ).toBe(true)
})

test("A8: ドメインマップのみの最小ファイル → 正当。他セクションを追加できる", () => {
  const parsed = parseArchitecture(MINIMAL_DOMAINS_ONLY)
  expect(parsed.error).toBeNull()
  expect(parsed.warnings).toEqual([])
  expect(parsed.sections).toHaveLength(1)

  const result = expectOk(
    prepareArchitectureUpdate(MINIMAL_DOMAINS_ONLY, [
      { heading: "システム概要", body: "後から足した概要。" },
      { heading: "規約", body: "- biome に従う。" }
    ])
  )

  expect(headings(result.text)).toEqual([
    "システム概要",
    "ドメインマップ",
    "規約"
  ])
  // 既存セクションの中身はバイト単位で不変。
  // (末尾へ節を足したため、区切りの空行 1 行だけが直前の節の末尾に増える。)
  const trimTrailingBlank = (s: string | undefined): string =>
    (s ?? "").replace(/(\r?\n)+$/, "\n")
  expect(
    trimTrailingBlank(
      findSection(parseArchitecture(result.text), "ドメインマップ")?.raw
    )
  ).toBe(trimTrailingBlank(findSection(parsed, "ドメインマップ")?.raw))
  expect(extractDomains(result.text).domains).toEqual({ generic: ["**"] })
})

test("A9: システム概要の更新 — Mermaid を含んでも分割が壊れない", () => {
  const body = doc(
    "新しい概要の散文。",
    "",
    "```mermaid",
    "graph LR",
    "  CLI[## CLI] --> Hook",
    "  Hook --> Doc[### 文書]",
    "```"
  )

  const result = expectOk(
    prepareArchitectureUpdate(TEN_SECTIONS, [{ heading: "システム概要", body }])
  )

  expect(headings(result.text)).toEqual([...ARCHITECTURE_HEADINGS])
  expect(untouchedBytes(result.text, "システム概要")).toBe(
    untouchedBytes(TEN_SECTIONS, "システム概要")
  )
  expect(result.text).toContain("  CLI[## CLI] --> Hook")
  expect(parseArchitecture(result.text).error).toBeNull()
})

test("A10: overview 疑似キーを指定 → エラー(廃止済み)", () => {
  for (const key of ["overview", "Overview", " overview "]) {
    const result = prepareArchitectureUpdate(TEN_SECTIONS, [
      { heading: key, body: "本文" }
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("retired_overview_key")
    expect(result.message).toContain("システム概要")
  }
})

test("A11: タイトルと最初の ## の間に本文 → stage は成功し警告を返す", () => {
  const withPreamble = doc(
    "# ARCHITECTURE",
    "",
    "見出しの外に置かれた概要の段落。",
    "",
    "## 技術スタック",
    "",
    "- TypeScript",
    ""
  )

  const parsed = parseArchitecture(withPreamble)
  expect(parsed.warnings).toHaveLength(1)
  expect(parsed.warnings[0]).toContain("本文")

  const result = expectOk(
    prepareArchitectureUpdate(withPreamble, [
      { heading: "技術スタック", body: "- Rust" }
    ])
  )
  expect(result.warnings.some((w) => w.includes("本文"))).toBe(true)
  // 拒否しない。前置きはバイト単位で保たれる。
  expect(parseArchitecture(result.text).preamble).toBe(parsed.preamble)
})

describe("A12: 新設 3 節(システム概要 / レイヤー構造 / ADR 一覧)", () => {
  test("他と同じ規則で分割される", () => {
    const parsed = parseArchitecture(TEN_SECTIONS)
    expect(findSection(parsed, "レイヤー構造")?.body).toContain(
      "ドメイン層は UI 層を参照しない。"
    )
    expect(findSection(parsed, "ADR 一覧")?.body).toContain(
      "### ADR-001: 最初の判断"
    )
    // `###` は節内の小見出しであり、セクション見出しにしない。
    expect(headings(TEN_SECTIONS)).not.toContain("ADR-001: 最初の判断")
  })

  test("レイヤー構造は stage-architecture で置換できる", () => {
    const result = expectOk(
      prepareArchitectureUpdate(TEN_SECTIONS, [
        { heading: "レイヤー構造", body: "- 1 層のみ" }
      ])
    )
    expect(untouchedBytes(result.text, "レイヤー構造")).toBe(
      untouchedBytes(TEN_SECTIONS, "レイヤー構造")
    )
  })

  test("ADR 一覧は低位 API(adr.ts 用)で置換できる", () => {
    const result = applySectionChanges(TEN_SECTIONS, [
      {
        heading: "ADR 一覧",
        body: doc(
          "### ADR-001: 最初の判断",
          "",
          "- 状態: 採用",
          "- 決定日: 2026-08-16",
          "",
          "### ADR-002: 次の判断",
          "",
          "- 状態: 提案"
        )
      }
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(untouchedBytes(result.text, "ADR 一覧")).toBe(
      untouchedBytes(TEN_SECTIONS, "ADR 一覧")
    )
    expect(result.text).toContain("### ADR-002: 次の判断")
  })
})

test("A13: Mermaid ブロック内の ## を見出しにしない", () => {
  const withFakeHeading = doc(
    "# ARCHITECTURE",
    "",
    "## システム概要",
    "",
    "```mermaid",
    "graph TD",
    "## 技術スタック",
    "  A --> B",
    "```",
    "",
    "## 規約",
    "",
    "- biome",
    ""
  )

  expect(headings(withFakeHeading)).toEqual(["システム概要", "規約"])
  expect(parseArchitecture(withFakeHeading).error).toBeNull()
})

test("A14: heading に ADR 一覧 → エラー。stage-adr へ誘導する", () => {
  const result = prepareArchitectureUpdate(TEN_SECTIONS, [
    { heading: "ADR 一覧", body: "### ADR-999: 差し替え" }
  ])

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("adr_heading")
  expect(result.message).toContain("stage-adr")
})

test("A15: ~~~ フェンス内の ## も見出しとして扱わない", () => {
  const tilde = doc(
    "# ARCHITECTURE",
    "",
    "## システム概要",
    "",
    "~~~text",
    "## 技術スタック",
    "~~~",
    "",
    "## 規約",
    "",
    "- biome",
    ""
  )

  expect(headings(tilde)).toEqual(["システム概要", "規約"])
  expect(parseArchitecture(tilde).error).toBeNull()

  // ``` では ~~~ フェンスを閉じられない(開始と同じ文字であること)。
  const mixed = doc(
    "# ARCHITECTURE",
    "",
    "## システム概要",
    "",
    "~~~",
    "本文",
    "```",
    ""
  )
  expect(parseArchitecture(mixed).error).toBe("unclosed_fence")
})

describe("A16: フェンス開始が 4 個以上のバッククォート", () => {
  test("3 個の行では閉じず、4 個の行で閉じる", () => {
    const nested = doc(
      "# ARCHITECTURE",
      "",
      "## システム概要",
      "",
      "````markdown",
      "```json metatron:domains",
      "## 偽の見出し",
      "```",
      "````",
      "",
      "## 規約",
      "",
      "- biome",
      ""
    )

    const parsed = parseArchitecture(nested)
    expect(parsed.error).toBeNull()
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      "システム概要",
      "規約"
    ])
    // 入れ子の内側は 4 個フェンスの本文であり、ドメインマップとして読まない。
    expect(findSection(parsed, "システム概要")?.body).toContain("## 偽の見出し")
  })

  test("4 個で開いて 3 個しか無ければ未閉フェンス", () => {
    const broken = doc(
      "# ARCHITECTURE",
      "",
      "## システム概要",
      "",
      "````",
      "本文",
      "```",
      "",
      "## 規約",
      ""
    )
    expect(parseArchitecture(broken).error).toBe("unclosed_fence")
  })

  test("開始より多い個数でも閉じる", () => {
    const closed = doc(
      "# ARCHITECTURE",
      "",
      "## システム概要",
      "",
      "```",
      "本文",
      "`````",
      "",
      "## 規約",
      ""
    )
    const parsed = parseArchitecture(closed)
    expect(parsed.error).toBeNull()
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      "システム概要",
      "規約"
    ])
  })
})

test("A17: 未閉フェンス → 書き込み経路は unclosed_fence で拒否", () => {
  const parsed = parseArchitectureForWrite(UNCLOSED)
  expect(parsed.ok).toBe(false)
  if (parsed.ok) return
  expect(parsed.error).toBe("unclosed_fence")

  const staged = prepareArchitectureUpdate(UNCLOSED, [
    { heading: "規約", body: "- biome" }
  ])
  expect(staged.ok).toBe(false)
  if (staged.ok) return
  expect(staged.error).toBe("unclosed_fence")

  // adr.ts が使う低位 API も同様に拒否する(stage-adr の経路)。
  const applied = applySectionChanges(UNCLOSED, [
    { heading: "ADR 一覧", body: "### ADR-001: x" }
  ])
  expect(applied.ok).toBe(false)
})

test("A18: 未閉フェンス → 読み取り経路は警告つきで結果を返す", () => {
  const parsed = parseArchitectureForRead(UNCLOSED)

  expect(parsed.error).toBe("unclosed_fence")
  expect(parsed.warnings).toContain(UNCLOSED_FENCE_WARNING)
  // 未閉フェンス以降は 1 セクション扱いになる。
  expect(parsed.sections.map((s) => s.heading)).toEqual(["システム概要"])
  expect(findSection(parsed, "システム概要")?.body).toContain("## 技術スタック")
  // 例外を投げない。ドメインマップの抽出も落ちない。
  expect(() => extractDomains(UNCLOSED)).not.toThrow()
  expect(extractDomains(UNCLOSED).ok).toBe(false)
})

test("A19: 同名の ## 見出しが 2 つ → 最初を採り、stage は警告を返す", () => {
  const duplicated = doc(
    "# ARCHITECTURE",
    "",
    "## 技術スタック",
    "",
    "- 最初",
    "",
    "## 規約",
    "",
    "- biome",
    "",
    "## 技術スタック",
    "",
    "- 二番目",
    ""
  )

  const parsed = parseArchitecture(duplicated)
  expect(parsed.sections).toHaveLength(3)
  expect(findSection(parsed, "技術スタック")?.body).toContain("- 最初")
  expect(parsed.warnings.some((w) => w.includes("技術スタック"))).toBe(true)

  const result = expectOk(
    prepareArchitectureUpdate(duplicated, [
      { heading: "技術スタック", body: "- 差し替え" }
    ])
  )
  expect(result.warnings.some((w) => w.includes("技術スタック"))).toBe(true)
  // 差し替わるのは最初の 1 つだけ。2 つ目はバイト単位で不変。
  const after = parseArchitecture(result.text)
  expect(after.sections[0].body).toContain("- 差し替え")
  expect(after.sections[2].raw).toBe(parsed.sections[2].raw)
  expect(after.sections[1].raw).toBe(parsed.sections[1].raw)
})

describe("追加: 契約 §4-2 の行の正規化", () => {
  test("CRLF の文書でも判定が割れず、改行コードが保たれる", () => {
    const crlf = TEN_SECTIONS.replace(/\n/g, "\r\n")
    const parsed = parseArchitecture(crlf)

    expect(parsed.error).toBeNull()
    expect(parsed.eol).toBe("\r\n")
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      ...ARCHITECTURE_HEADINGS
    ])

    const result = expectOk(
      prepareArchitectureUpdate(crlf, [
        { heading: "テスト方針", body: "- 変更後" }
      ])
    )
    expect(result.text).toContain("\r\n- 変更後\r\n")
    expect(result.text).not.toMatch(/[^\r]\n/)
    expect(untouchedBytes(result.text, "テスト方針")).toBe(
      untouchedBytes(crlf, "テスト方針")
    )
  })

  test("リスト項目に 2 スペース下げて置かれたフェンスも認識する", () => {
    const indented = doc(
      "# ARCHITECTURE",
      "",
      "## システム概要",
      "",
      "- 使い方:",
      "",
      "  ```sh",
      "  ## これはシェルのコメント",
      "  ```",
      "",
      "## 規約",
      "",
      "- biome",
      ""
    )

    expect(headings(indented)).toEqual(["システム概要", "規約"])
    expect(parseArchitecture(indented).error).toBeNull()
  })

  test("終了フェンスの後ろの末尾空白で閉じ損ねない", () => {
    const trailing = doc(
      "# ARCHITECTURE",
      "",
      "## システム概要",
      "",
      "```",
      "本文",
      "```   ",
      "",
      "## 規約",
      "",
      "- biome",
      ""
    )

    const parsed = parseArchitecture(trailing)
    expect(parsed.error).toBeNull()
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      "システム概要",
      "規約"
    ])
  })

  test("4 スペース以上のインデントはフェンスとみなさない", () => {
    const overIndented = doc(
      "# ARCHITECTURE",
      "",
      "## システム概要",
      "",
      "    ```",
      "    本文",
      "    ```",
      "",
      "## 規約",
      "",
      "- biome",
      ""
    )

    const parsed = parseArchitecture(overIndented)
    expect(parsed.error).toBeNull()
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      "システム概要",
      "規約"
    ])
  })

  test("`### ` と `#` はセクション見出しにしない", () => {
    const levels = doc(
      "# ARCHITECTURE",
      "",
      "## 規約",
      "",
      "### 小見出し",
      "",
      "#### さらに小さい見出し",
      "",
      "##見出しではない(スペースが無い)",
      ""
    )
    expect(headings(levels)).toEqual(["規約"])
  })
})

describe("追加: metatron:domains の位置と多重定義", () => {
  test("info string の余分な空白は許容する", () => {
    const spaced = doc(
      "# ARCHITECTURE",
      "",
      "## ドメインマップ",
      "",
      "```json  metatron:domains  ",
      '{ "generic": ["**"] }',
      "```",
      ""
    )
    expect(extractDomains(spaced).domains).toEqual({ generic: ["**"] })
  })

  test("ブロックが 2 個あるときは最初を採り警告する", () => {
    const twice = doc(
      "# ARCHITECTURE",
      "",
      "## ドメインマップ",
      "",
      "```json metatron:domains",
      '{ "first": ["a/**"] }',
      "```",
      "",
      "```json metatron:domains",
      '{ "second": ["b/**"] }',
      "```",
      ""
    )
    const result = extractDomains(twice)
    expect(result.domains).toEqual({ first: ["a/**"] })
    expect(result.warnings.some((w) => w.includes("2 個"))).toBe(true)
  })

  test("ブロックが無い文書は block_not_found", () => {
    expect(
      extractDomains(MINIMAL_DOMAINS_ONLY.replace("metatron", "x")).reason
    ).toBe("block_not_found")
  })

  // 契約 §1「開始マーカーが他のフェンスに取り込まれ、ブロックとして認識されない
  // ときは警告を返す」。結果はどちらも null だが原因が違う。黙って落とすと、
  // 書き手は自分の置いたブロックが読まれていないことに気づけない。
  test("無関係な未閉フェンスにマーカーが呑まれたら警告を 1 件返す", () => {
    const swallowed = doc(
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
    )
    const result = extractDomains(swallowed)
    expect(result.ok).toBe(false)
    expect(result.domains).toBe(null)
    expect(result.reason).toBe("block_not_found")
    expect(result.warnings.length).toBe(1)
  })

  test("マーカーが無い最小文書は警告 0 件(正当な状態と区別する)", () => {
    const result = extractDomains(MINIMAL_DOMAINS_ONLY.replace("metatron", "x"))
    expect(result.domains).toBe(null)
    expect(result.warnings).toStrictEqual([])
  })
})
