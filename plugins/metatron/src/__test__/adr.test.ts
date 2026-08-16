// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §5(ADR の書式)・
// §4(セクション分割)・§11(ロック)の検証。
// ケース ID は metatron 設計書 §13-1 の adr.ts の表(R-A1〜R-A9)に対応する。
// 末尾の「追加」ケースは、契約 §5-1 の採番規則と §4-2 のフェンス規則に対応する。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  ADR_STATUSES,
  type AdrAddInput,
  AdrError,
  type AdrStatusInput,
  buildAdrAddition,
  buildAdrStatusChange,
  filterAdrEntries,
  formatAdrId,
  parseAdrDocument,
  parseAdrId,
  stageAdr
} from "../lib/adr.js"

// 行の配列から文書を組み立てる。末尾の "" が最終改行になる。
function doc(...lines: string[]): string {
  return lines.join("\n")
}

const BASE_ADD: AdrAddInput = {
  mode: "add",
  title: "永続化に SQLite を使う",
  decidedBy: "あまつか工房",
  background: "ローカルで完結する保存先が要る。",
  options: [
    "SQLite: 単一ファイルで完結する / 同時書き込みに弱い",
    "PostgreSQL: 堅い / 常駐プロセスが要る"
  ],
  conclusion: "SQLite を採用する。",
  rationale: "常駐プロセスを増やさない方針と一致するため。",
  impact: "永続化層とテストのセットアップ。"
}

const EMPTY_ADR_SECTION = doc(
  "# ARCHITECTURE",
  "",
  "## 規約",
  "",
  "- biome に従う。",
  "",
  "## ADR 一覧",
  ""
)

const THREE_ADRS = doc(
  "# ARCHITECTURE",
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
  "- 決定日: 2026-08-01",
  "- 決定者: あまつか工房",
  "",
  "#### 背景",
  "",
  "最初の背景。",
  "",
  "### ADR-002: 2 番目の判断",
  "",
  "- 状態: 採用",
  "- 決定日: 2026-08-05",
  "- 決定者: あまつか工房",
  "",
  "#### 背景",
  "",
  "2 番目の背景。",
  "",
  "#### 影響範囲",
  "",
  "永続化層。",
  "",
  "### ADR-003: 3 番目の判断",
  "",
  "- 状態: 提案",
  "- 決定日: 2026-08-10",
  "- 決定者: あまつか工房",
  "",
  "#### 背景",
  "",
  "3 番目の背景。",
  ""
)

const NO_ADR_SECTION = doc(
  "# ARCHITECTURE",
  "",
  "## システム概要",
  "",
  "サンプル。",
  "",
  "## 規約",
  "",
  "- biome に従う。",
  ""
)

function entryRawById(text: string, id: string): string {
  const entry = parseAdrDocument(text).entries.find((e) => e.id === id)
  if (entry === undefined) throw new Error(`${id} が見つかりません`)
  return entry.raw
}

function sectionRaw(text: string, heading: string): string {
  const idx = text.indexOf(`## ${heading}\n`)
  if (idx < 0) throw new Error(`## ${heading} が見つかりません`)
  const rest = text.slice(idx)
  const next = rest.indexOf("\n## ", 1)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

// ---------------------------------------------------------------------------
// 追加(契約 §5-1)
// ---------------------------------------------------------------------------

describe("R-A1: 空の `## ADR 一覧` への追加", () => {
  test("ADR-001 が採番される", () => {
    const result = buildAdrAddition(EMPTY_ADR_SECTION, BASE_ADD, "2026-08-16")
    expect(result.id).toBe("ADR-001")
    expect(result.number).toBe(1)
    expect(result.sectionCreated).toBe(false)
    expect(result.text).toContain("### ADR-001: 永続化に SQLite を使う")
  })

  test("契約 §5-1 のエントリ書式で出力される", () => {
    const result = buildAdrAddition(EMPTY_ADR_SECTION, BASE_ADD, "2026-08-16")
    expect(result.text).toContain("- 状態: 採用")
    expect(result.text).toContain("- 決定日: 2026-08-16")
    expect(result.text).toContain("- 決定者: あまつか工房")
    expect(result.text).toContain("#### 背景")
    expect(result.text).toContain("#### 検討した選択肢")
    expect(result.text).toContain(
      "1. SQLite: 単一ファイルで完結する / 同時書き込みに弱い"
    )
    expect(result.text).toContain("2. PostgreSQL: 堅い / 常駐プロセスが要る")
    expect(result.text).toContain("#### 採用した結論")
    expect(result.text).toContain("#### 理由")
    expect(result.text).toContain("#### 影響範囲")
  })

  test("`## 規約` はバイト単位で不変", () => {
    const result = buildAdrAddition(EMPTY_ADR_SECTION, BASE_ADD, "2026-08-16")
    expect(sectionRaw(result.text, "規約")).toBe(
      sectionRaw(EMPTY_ADR_SECTION, "規約")
    )
  })
})

describe("R-A2: 既存 3 件への追加", () => {
  test("ADR-004 が採番される", () => {
    const result = buildAdrAddition(THREE_ADRS, BASE_ADD, "2026-08-16")
    expect(result.id).toBe("ADR-004")
    expect(result.number).toBe(4)
  })

  test("節の末尾に追加される(GOTCHAS と逆向き)", () => {
    const result = buildAdrAddition(THREE_ADRS, BASE_ADD, "2026-08-16")
    const ids = parseAdrDocument(result.text).entries.map((e) => e.id)
    expect(ids).toEqual(["ADR-001", "ADR-002", "ADR-003", "ADR-004"])
    expect(result.text.indexOf("### ADR-004:")).toBeGreaterThan(
      result.text.indexOf("### ADR-003:")
    )
  })

  test("既存エントリはバイト単位で不変", () => {
    const result = buildAdrAddition(THREE_ADRS, BASE_ADD, "2026-08-16")
    expect(entryRawById(result.text, "ADR-001")).toBe(
      entryRawById(THREE_ADRS, "ADR-001")
    )
    expect(entryRawById(result.text, "ADR-002")).toBe(
      entryRawById(THREE_ADRS, "ADR-002")
    )
    expect(sectionRaw(result.text, "規約")).toBe(sectionRaw(THREE_ADRS, "規約"))
  })
})

describe("R-A3: `状態` が値域外", () => {
  test("追加時の値域外 status は拒否される", () => {
    expect(() =>
      buildAdrAddition(
        THREE_ADRS,
        { ...BASE_ADD, status: "検討中" },
        "2026-08-16"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_status" })
    )
  })

  test("状態変更時の値域外 status は拒否される", () => {
    expect(() =>
      buildAdrStatusChange(
        THREE_ADRS,
        {
          mode: "status",
          id: "ADR-002",
          status: "検討中",
          reason: "方針が変わったため"
        },
        "2026-08-20"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_status" })
    )
  })

  test("値域は 採用 / 提案 / 廃止 の 3 つだけ", () => {
    expect([...ADR_STATUSES]).toEqual(["採用", "提案", "廃止"])
    for (const status of ADR_STATUSES) {
      const result = buildAdrAddition(
        EMPTY_ADR_SECTION,
        { ...BASE_ADD, status },
        "2026-08-16"
      )
      expect(result.text).toContain(`- 状態: ${status}`)
    }
  })
})

describe("R-A4: 必須項目の欠落", () => {
  const cases: [string, Partial<AdrAddInput>][] = [
    ["title", { title: "" }],
    ["decidedBy", { decidedBy: "" }],
    ["background", { background: "" }],
    ["conclusion", { conclusion: "" }],
    ["rationale", { rationale: "" }],
    ["impact", { impact: "" }],
    ["options(空配列)", { options: [] }]
  ]

  for (const [label, patch] of cases) {
    test(`${label} の欠落は拒否される`, () => {
      expect(() =>
        buildAdrAddition(THREE_ADRS, { ...BASE_ADD, ...patch }, "2026-08-16")
      ).toThrowError(
        expect.objectContaining({ name: "AdrError", code: "invalid_input" })
      )
    })
  }

  test("options が配列でない場合も拒否される", () => {
    const broken = { ...BASE_ADD, options: "SQLite" } as unknown as AdrAddInput
    expect(() =>
      buildAdrAddition(THREE_ADRS, broken, "2026-08-16")
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_input" })
    )
  })

  test("decidedOn の書式違反は拒否される", () => {
    expect(() =>
      buildAdrAddition(
        THREE_ADRS,
        { ...BASE_ADD, decidedOn: "2026/08/16" },
        "2026-08-16"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_input" })
    )
  })

  test("options が 1 件なら警告(拒否はしない)", () => {
    const result = buildAdrAddition(
      THREE_ADRS,
      { ...BASE_ADD, options: ["SQLite: 単一ファイルで完結する"] },
      "2026-08-16"
    )
    expect(result.warnings.join("\n")).toContain("options が 1 件だけです")
  })
})

// ---------------------------------------------------------------------------
// 状態変更(契約 §5-2)
// ---------------------------------------------------------------------------

const STATUS_CHANGE: AdrStatusInput = {
  mode: "status",
  id: "ADR-002",
  status: "廃止",
  reason: "同時書き込みの要件が後から入り、SQLite では満たせないため"
}

describe('R-A5: `mode: "status"` での状態変更', () => {
  test("`状態` 行が最新値に変わる", () => {
    const result = buildAdrStatusChange(THREE_ADRS, STATUS_CHANGE, "2026-08-20")
    expect(result.from).toBe("採用")
    expect(result.to).toBe("廃止")
    const entry = parseAdrDocument(result.text).entries.find(
      (e) => e.id === "ADR-002"
    )
    expect(entry?.status).toBe("廃止")
    expect(entry?.statusRaw).toBe("廃止")
  })

  test("エントリ末尾へ `- 状態変更(YYYY-MM-DD): 旧 → 新。理由` が追記される", () => {
    const result = buildAdrStatusChange(THREE_ADRS, STATUS_CHANGE, "2026-08-20")
    const line = `- 状態変更(2026-08-20): 採用 → 廃止。${STATUS_CHANGE.reason}`
    expect(result.text).toContain(line)

    const entry = parseAdrDocument(result.text).entries.find(
      (e) => e.id === "ADR-002"
    )
    expect(entry?.statusChanges).toHaveLength(1)
    expect(entry?.statusChanges[0]).toMatchObject({
      date: "2026-08-20",
      from: "採用",
      to: "廃止",
      reason: STATUS_CHANGE.reason
    })

    // 「エントリ末尾」= 当該エントリの最後の非空行。次のエントリより前にある。
    const at = result.text.indexOf(line)
    expect(at).toBeGreaterThan(result.text.indexOf("### ADR-002:"))
    expect(at).toBeLessThan(result.text.indexOf("### ADR-003:"))
    expect(at).toBeGreaterThan(result.text.indexOf("永続化層。"))
  })

  test("他のフィールドは不変", () => {
    const result = buildAdrStatusChange(THREE_ADRS, STATUS_CHANGE, "2026-08-20")
    const before = entryRawById(THREE_ADRS, "ADR-002")
    const after = entryRawById(result.text, "ADR-002")
    // 変更は「状態行の値」と「末尾 1 行の追加」の 2 箇所だけ。
    const removed = after
      .replace(
        `\n- 状態変更(2026-08-20): 採用 → 廃止。${STATUS_CHANGE.reason}\n`,
        ""
      )
      .replace("- 状態: 廃止", "- 状態: 採用")
    expect(removed).toBe(before)
    expect(after).toContain("- 決定日: 2026-08-05")
    expect(after).toContain("- 決定者: あまつか工房")
    expect(after).toContain("2 番目の背景。")
  })

  test("エントリは削除されない(他のエントリも不変)", () => {
    const result = buildAdrStatusChange(THREE_ADRS, STATUS_CHANGE, "2026-08-20")
    const ids = parseAdrDocument(result.text).entries.map((e) => e.id)
    expect(ids).toEqual(["ADR-001", "ADR-002", "ADR-003"])
    expect(entryRawById(result.text, "ADR-001")).toBe(
      entryRawById(THREE_ADRS, "ADR-001")
    )
    expect(sectionRaw(result.text, "規約")).toBe(sectionRaw(THREE_ADRS, "規約"))
  })
})

describe("R-A8: 状態変更を 2 回行う", () => {
  test("状態変更行が 2 行残り、`状態` 行は最新値のみ", () => {
    const first = buildAdrStatusChange(
      THREE_ADRS,
      { mode: "status", id: "ADR-002", status: "廃止", reason: "一度目の理由" },
      "2026-08-20"
    )
    const second = buildAdrStatusChange(
      first.text,
      { mode: "status", id: "ADR-002", status: "採用", reason: "二度目の理由" },
      "2026-09-01"
    )

    expect(second.from).toBe("廃止")
    expect(second.to).toBe("採用")

    const entry = parseAdrDocument(second.text).entries.find(
      (e) => e.id === "ADR-002"
    )
    expect(entry?.statusChanges).toHaveLength(2)
    expect(entry?.statusChanges.map((c) => c.raw)).toEqual([
      "採用 → 廃止。一度目の理由",
      "廃止 → 採用。二度目の理由"
    ])

    // 過去の行を消さない。履歴は上から順に読める。
    const firstAt = second.text.indexOf("- 状態変更(2026-08-20):")
    const secondAt = second.text.indexOf("- 状態変更(2026-09-01):")
    expect(firstAt).toBeGreaterThan(0)
    expect(secondAt).toBeGreaterThan(firstAt)

    // `状態` 行は最新値のみ。値が 2 つ並ばない。
    const raw = entryRawById(second.text, "ADR-002")
    expect(raw.match(/^- 状態: .*$/gm)).toEqual(["- 状態: 採用"])
    expect(entry?.status).toBe("採用")
  })

  test("1 行目は本文と空行で区切られ、2 行目以降は履歴として連続する", () => {
    const first = buildAdrStatusChange(
      THREE_ADRS,
      { mode: "status", id: "ADR-002", status: "廃止", reason: "一度目の理由" },
      "2026-08-20"
    )
    const second = buildAdrStatusChange(
      first.text,
      { mode: "status", id: "ADR-002", status: "採用", reason: "二度目の理由" },
      "2026-09-01"
    )
    expect(second.text).toContain(
      doc(
        "永続化層。",
        "",
        "- 状態変更(2026-08-20): 採用 → 廃止。一度目の理由",
        "- 状態変更(2026-09-01): 廃止 → 採用。二度目の理由",
        ""
      )
    )
  })

  test("3 回目も履歴が積み上がる", () => {
    let text = THREE_ADRS
    const dates = ["2026-08-20", "2026-09-01", "2026-09-10"]
    const statuses = ["廃止", "提案", "採用"] as const
    dates.forEach((date, i) => {
      text = buildAdrStatusChange(
        text,
        {
          mode: "status",
          id: "ADR-002",
          status: statuses[i],
          reason: `理由 ${i + 1}`
        },
        date
      ).text
    })
    const entry = parseAdrDocument(text).entries.find((e) => e.id === "ADR-002")
    expect(entry?.statusChanges).toHaveLength(3)
    expect(entry?.status).toBe("採用")
  })
})

describe('R-A9: `mode: "status"` で `reason` を省略', () => {
  test("reason が undefined なら拒否される", () => {
    const input = {
      mode: "status",
      id: "ADR-002",
      status: "廃止"
    } as unknown as AdrStatusInput
    expect(() =>
      buildAdrStatusChange(THREE_ADRS, input, "2026-08-20")
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_input" })
    )
  })

  test("reason が空文字・空白のみでも拒否される", () => {
    for (const reason of ["", "   ", "\t"]) {
      expect(() =>
        buildAdrStatusChange(
          THREE_ADRS,
          { ...STATUS_CHANGE, reason },
          "2026-08-20"
        )
      ).toThrowError(
        expect.objectContaining({ name: "AdrError", code: "invalid_input" })
      )
    }
  })

  test("拒否のメッセージが「理由は必須」であることを示す", () => {
    try {
      buildAdrStatusChange(
        THREE_ADRS,
        { ...STATUS_CHANGE, reason: "" },
        "2026-08-20"
      )
      throw new Error("拒否されなかった")
    } catch (error) {
      expect(error).toBeInstanceOf(AdrError)
      expect((error as AdrError).message).toContain("reason")
    }
  })
})

describe("R-A6: 存在しない ADR-NNN の状態変更", () => {
  test("not_found で拒否され、テキストは生成されない", () => {
    expect(() =>
      buildAdrStatusChange(
        THREE_ADRS,
        { ...STATUS_CHANGE, id: "ADR-099" },
        "2026-08-20"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "not_found" })
    )
  })

  test("`## ADR 一覧` 節が無いファイルでも not_found", () => {
    expect(() =>
      buildAdrStatusChange(NO_ADR_SECTION, STATUS_CHANGE, "2026-08-20")
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "not_found" })
    )
  })

  test("id の形式が不正なら invalid_input", () => {
    expect(() =>
      buildAdrStatusChange(
        THREE_ADRS,
        { ...STATUS_CHANGE, id: "ADR-A" },
        "2026-08-20"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_input" })
    )
  })
})

describe("R-A7: `## ADR 一覧` 節が無いファイル", () => {
  test("節ごと作成される", () => {
    const result = buildAdrAddition(NO_ADR_SECTION, BASE_ADD, "2026-08-16")
    expect(result.sectionCreated).toBe(true)
    expect(result.id).toBe("ADR-001")
    expect(result.text).toContain("## ADR 一覧")
    expect(result.text).toContain("### ADR-001: 永続化に SQLite を使う")
  })

  test("既存セクションはバイト単位で不変、`## ADR 一覧` は末尾に来る", () => {
    const result = buildAdrAddition(NO_ADR_SECTION, BASE_ADD, "2026-08-16")
    expect(sectionRaw(result.text, "システム概要")).toBe(
      sectionRaw(NO_ADR_SECTION, "システム概要")
    )
    expect(result.text.indexOf("## ADR 一覧")).toBeGreaterThan(
      result.text.indexOf("## 規約")
    )
  })

  test("ファイルそのものが無い場合は全文を新規作成する", () => {
    const result = buildAdrAddition(null, BASE_ADD, "2026-08-16")
    expect(result.created).toBe(true)
    expect(result.sectionCreated).toBe(true)
    expect(result.text.startsWith("# ARCHITECTURE")).toBe(true)
    expect(result.text).toContain("### ADR-001: 永続化に SQLite を使う")
  })
})

// ---------------------------------------------------------------------------
// 追加ケース: 採番(契約 §5-1「全件走査して最大値 + 1」)
// ---------------------------------------------------------------------------

describe("採番", () => {
  test("番号が飛んでいても最大値 + 1", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 一つ目",
      "",
      "- 状態: 採用",
      "",
      "### ADR-005: 五つ目",
      "",
      "- 状態: 採用",
      ""
    )
    expect(parseAdrDocument(text).nextNumber).toBe(6)
    expect(buildAdrAddition(text, BASE_ADD, "2026-08-16").id).toBe("ADR-006")
  })

  test("並びが降順でも最大値 + 1(手編集で崩れた台帳)", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-007: 後から足したもの",
      "",
      "- 状態: 採用",
      "",
      "### ADR-002: 古いもの",
      "",
      "- 状態: 廃止",
      ""
    )
    expect(buildAdrAddition(text, BASE_ADD, "2026-08-16").id).toBe("ADR-008")
  })

  test("`## ADR 一覧` の外にある `### ADR-NNN:` は数えない", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## 規約",
      "",
      "### ADR-010: 節の外にある同形の見出し",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 本物",
      "",
      "- 状態: 採用",
      ""
    )
    const parsed = parseAdrDocument(text)
    expect(parsed.entries.map((e) => e.id)).toEqual(["ADR-001"])
    expect(parsed.nextNumber).toBe(2)
  })

  test("コードフェンス内の `### ADR-NNN:` は数えない(契約 §4-2 規則 3)", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "````markdown",
      "### ADR-900: 書式の例",
      "",
      "- 状態: 採用",
      "````",
      "",
      "### ADR-001: 本物",
      "",
      "- 状態: 採用",
      ""
    )
    const parsed = parseAdrDocument(text)
    expect(parsed.entries.map((e) => e.id)).toEqual(["ADR-001"])
    expect(parsed.nextNumber).toBe(2)
  })

  test("`~~~` フェンスでも同じ", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "~~~",
      "### ADR-900: 例",
      "~~~",
      "",
      "### ADR-002: 本物",
      "",
      "- 状態: 採用",
      ""
    )
    expect(parseAdrDocument(text).nextNumber).toBe(3)
  })

  test("formatAdrId / parseAdrId", () => {
    expect(formatAdrId(1)).toBe("ADR-001")
    expect(formatAdrId(42)).toBe("ADR-042")
    expect(formatAdrId(1234)).toBe("ADR-1234")
    expect(parseAdrId("ADR-003")).toBe(3)
    expect(parseAdrId("adr-3")).toBe(3)
    expect(parseAdrId("3")).toBe(3)
    expect(parseAdrId("ADR-")).toBeNull()
    expect(parseAdrId(undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 追加ケース: 解析(契約 §5-1・§5-2)
// ---------------------------------------------------------------------------

describe("解析", () => {
  test("`#### 背景` などの小見出しはエントリを切らない", () => {
    const parsed = parseAdrDocument(THREE_ADRS)
    expect(parsed.entries).toHaveLength(3)
    expect(parsed.entries[1].raw).toContain("#### 影響範囲")
  })

  test("`- 状態変更(...)` を `- 状態:` 行と取り違えない", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 判断",
      "",
      "- 状態: 廃止",
      "- 決定日: 2026-08-01",
      "",
      "- 状態変更(2026-08-20): 採用 → 廃止。要件が変わったため",
      ""
    )
    const entry = parseAdrDocument(text).entries[0]
    expect(entry.statusRaw).toBe("廃止")
    expect(entry.statusChanges).toHaveLength(1)
    expect(entry.statusChanges[0].from).toBe("採用")
    expect(entry.statusChanges[0].to).toBe("廃止")
    expect(entry.statusChanges[0].reason).toBe("要件が変わったため")
  })

  test("値域外の `状態` は status: null として読む(読み取りは止めない)", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 判断",
      "",
      "- 状態: 検討中",
      ""
    )
    const entry = parseAdrDocument(text).entries[0]
    expect(entry.status).toBeNull()
    expect(entry.statusRaw).toBe("検討中")
  })

  test("未閉フェンスは読み取り経路では例外にならない", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 判断",
      "",
      "```json",
      "{}",
      ""
    )
    const parsed = parseAdrDocument(text)
    expect(parsed.unclosedFence).toBe(true)
  })

  test("未閉フェンスは書き込み経路では拒否される(契約 §4-3)", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 判断",
      "",
      "- 状態: 採用",
      "",
      "```json",
      "{}",
      ""
    )
    expect(() => buildAdrAddition(text, BASE_ADD, "2026-08-16")).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "unclosed_fence" })
    )
    expect(() =>
      buildAdrStatusChange(
        text,
        { ...STATUS_CHANGE, id: "ADR-001" },
        "2026-08-20"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "unclosed_fence" })
    )
  })

  test("`- 状態:` 行の無いエントリへの状態変更は invalid_entry", () => {
    const text = doc(
      "# ARCHITECTURE",
      "",
      "## ADR 一覧",
      "",
      "### ADR-001: 状態行の無いエントリ",
      "",
      "- 決定日: 2026-08-01",
      ""
    )
    expect(() =>
      buildAdrStatusChange(
        text,
        { ...STATUS_CHANGE, id: "ADR-001" },
        "2026-08-20"
      )
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_entry" })
    )
  })

  test("CRLF の文書でも分解と追記が成立する", () => {
    const crlf = THREE_ADRS.replace(/\n/g, "\r\n")
    const parsed = parseAdrDocument(crlf)
    expect(parsed.entries.map((e) => e.id)).toEqual([
      "ADR-001",
      "ADR-002",
      "ADR-003"
    ])
    const result = buildAdrStatusChange(crlf, STATUS_CHANGE, "2026-08-20")
    expect(result.text).toContain(
      `- 状態変更(2026-08-20): 採用 → 廃止。${STATUS_CHANGE.reason}\r\n`
    )
    expect(result.text).not.toMatch(/[^\r]\n/)
  })

  test("同じ状態への変更は警告つきで履歴だけ増える", () => {
    const result = buildAdrStatusChange(
      THREE_ADRS,
      { ...STATUS_CHANGE, status: "採用", reason: "再確認したため" },
      "2026-08-20"
    )
    expect(result.warnings.join("\n")).toContain("既に「採用」です")
    expect(result.text).toContain(
      "- 状態変更(2026-08-20): 採用 → 採用。再確認したため"
    )
  })
})

describe("filterAdrEntries", () => {
  const entries = parseAdrDocument(THREE_ADRS).entries

  test("--id で 1 件に絞れる", () => {
    expect(
      filterAdrEntries(entries, { id: "ADR-002" }).map((e) => e.id)
    ).toEqual(["ADR-002"])
    expect(filterAdrEntries(entries, { id: "2" }).map((e) => e.id)).toEqual([
      "ADR-002"
    ])
  })

  test("--status で絞れる", () => {
    expect(
      filterAdrEntries(entries, { status: "採用" }).map((e) => e.id)
    ).toEqual(["ADR-001", "ADR-002"])
    expect(
      filterAdrEntries(entries, { status: "提案" }).map((e) => e.id)
    ).toEqual(["ADR-003"])
    expect(filterAdrEntries(entries, { status: "検討中" })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ファイル入口とロック(契約 §11)
// ---------------------------------------------------------------------------

describe("stageAdr", () => {
  const dirs: string[] = []

  function makeProject(content: string | null): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-adr-"))
    dirs.push(dir)
    const file = path.join(dir, "ARCHITECTURE.md")
    if (content !== null) fs.writeFileSync(file, content)
    return file
  }

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("書き込みを行わない(commit-architecture の責務)", () => {
    const file = makeProject(THREE_ADRS)
    const result = stageAdr(file, BASE_ADD, { now: new Date(2026, 7, 16) })
    expect(result.assignedId).toBe("ADR-004")
    expect(result.nextText).toContain("### ADR-004:")
    expect(fs.readFileSync(file, "utf8")).toBe(THREE_ADRS)
    expect(result.baseText).toBe(THREE_ADRS)
    expect(result.baseExists).toBe(true)
  })

  test("decidedOn 省略時は当日日付になる", () => {
    const file = makeProject(EMPTY_ADR_SECTION)
    const result = stageAdr(file, BASE_ADD, { now: new Date(2026, 7, 16) })
    expect(result.date).toBe("2026-08-16")
    expect(result.nextText).toContain("- 決定日: 2026-08-16")
  })

  test("状態変更も書き込まない", () => {
    const file = makeProject(THREE_ADRS)
    const result = stageAdr(file, STATUS_CHANGE, { now: new Date(2026, 7, 20) })
    expect(result.mode).toBe("status")
    expect(result.previousStatus).toBe("採用")
    expect(result.status).toBe("廃止")
    expect(result.nextText).toContain("- 状態変更(2026-08-20):")
    expect(fs.readFileSync(file, "utf8")).toBe(THREE_ADRS)
  })

  test("R-A6: 存在しない ADR の状態変更は非 0(not_found)で書き込みなし", () => {
    const file = makeProject(THREE_ADRS)
    expect(() =>
      stageAdr(file, { ...STATUS_CHANGE, id: "ADR-099" })
    ).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "not_found" })
    )
    expect(fs.readFileSync(file, "utf8")).toBe(THREE_ADRS)
  })

  test("R-A9: reason 省略は拒否され、ファイルは不変", () => {
    const file = makeProject(THREE_ADRS)
    const input = {
      mode: "status",
      id: "ADR-002",
      status: "廃止"
    } as unknown as AdrStatusInput
    expect(() => stageAdr(file, input)).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_input" })
    )
    expect(fs.readFileSync(file, "utf8")).toBe(THREE_ADRS)
  })

  test("ファイルが無ければ追加は新規作成、状態変更は not_found", () => {
    const addFile = makeProject(null)
    const added = stageAdr(addFile, BASE_ADD, { now: new Date(2026, 7, 16) })
    expect(added.baseExists).toBe(false)
    expect(added.created).toBe(true)
    expect(fs.existsSync(addFile)).toBe(false)

    const statusFile = makeProject(null)
    expect(() => stageAdr(statusFile, STATUS_CHANGE)).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "not_found" })
    )
  })

  test("mode が add / status のいずれでもなければ拒否", () => {
    const file = makeProject(THREE_ADRS)
    const input = { mode: "delete", id: "ADR-002" } as unknown as AdrStatusInput
    expect(() => stageAdr(file, input)).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "invalid_input" })
    )
  })

  test("契約 §11: ロックは ARCHITECTURE のパス + .lock で、実行後に残らない", () => {
    const file = makeProject(THREE_ADRS)
    stageAdr(file, BASE_ADD, { now: new Date(2026, 7, 16) })
    expect(fs.existsSync(`${file}.lock`)).toBe(false)
  })

  test("契約 §11: 新しいロックが残っていれば lock_timeout", () => {
    const file = makeProject(THREE_ADRS)
    fs.writeFileSync(`${file}.lock`, "held")
    expect(() => stageAdr(file, BASE_ADD)).toThrowError(
      expect.objectContaining({ name: "AdrError", code: "lock_timeout" })
    )
    expect(fs.readFileSync(file, "utf8")).toBe(THREE_ADRS)
  })

  test("契約 §11: 60 秒より古いロックは奪う", () => {
    const file = makeProject(THREE_ADRS)
    const lock = `${file}.lock`
    fs.writeFileSync(lock, "stale")
    const old = new Date(Date.now() - 120_000)
    fs.utimesSync(lock, old, old)
    const result = stageAdr(file, BASE_ADD, { now: new Date(2026, 7, 16) })
    expect(result.assignedId).toBe("ADR-004")
    expect(fs.existsSync(lock)).toBe(false)
  })

  test("GOTCHAS のロックとは別ファイルになる(互いをブロックしない)", () => {
    const file = makeProject(THREE_ADRS)
    const gotchasLock = path.join(path.dirname(file), "GOTCHAS.md.lock")
    fs.writeFileSync(gotchasLock, "held")
    const result = stageAdr(file, BASE_ADD, { now: new Date(2026, 7, 16) })
    expect(result.assignedId).toBe("ADR-004")
  })
})
