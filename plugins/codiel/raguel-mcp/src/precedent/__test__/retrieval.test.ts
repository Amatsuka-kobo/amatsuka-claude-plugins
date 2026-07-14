import { describe, expect, it } from "vitest"
import type { Precedent } from "../../core/types"
import { searchPrecedents, tokenize } from "../retrieval"

function makePrecedent(overrides: Partial<Precedent>): Precedent {
  return {
    id: "p-000",
    source: "project",
    kind: "code",
    outcome: "rejected",
    summary: "",
    firedRules: [],
    changedPaths: [],
    lesson: "",
    ...overrides
  }
}

describe("tokenize", () => {
  it("英数字連続を 1 語として小文字化する", () => {
    expect(tokenize("Hello World123")).toEqual(["hello", "world123"])
  })

  it("CJK 文字連続を文字 bigram に分割する", () => {
    expect(tokenize("秘密鍵")).toEqual(["秘密", "密鍵"])
  })

  it("単一 CJK 文字はそのまま 1 トークンになる", () => {
    expect(tokenize("鍵")).toEqual(["鍵"])
  })

  it("英数字と CJK が混在するテキストを分離して扱う", () => {
    expect(tokenize("api秘密鍵123")).toEqual(["api", "秘密", "密鍵", "123"])
  })
})

describe("searchPrecedents", () => {
  const corpus: Precedent[] = [
    makePrecedent({
      id: "seed-secret",
      source: "seed",
      kind: "code",
      summary: "ハードコードされたAPIキーの混入",
      firedRules: ["common/secrets"],
      changedPaths: ["src/config/keys.ts"],
      lesson: "秘密鍵はコードに書かない"
    }),
    makePrecedent({
      id: "seed-test-deletion",
      source: "seed",
      kind: "code",
      summary: "テストファイルの削除で偽装グリーンにした",
      firedRules: ["code/test-deletion"],
      changedPaths: ["src/foo/foo.test.ts"],
      lesson: "テストを消して通すのは禁止"
    }),
    makePrecedent({
      id: "seed-scope",
      source: "seed",
      kind: "plan",
      summary: "頼まれていない機能を追加してスコープが肥大した",
      firedRules: ["plan/scope-keywords"],
      changedPaths: ["docs/plan.md"],
      lesson: "スコープ外の提案は分離する"
    })
  ]

  it("同じ入力を 2 回検索すると同じ順序になる(決定論性)", () => {
    const query = {
      kind: "code" as const,
      objective: "APIキーを設定ファイルから読むようにする",
      summaryText: "設定ファイルにシークレットを直書きした差分",
      firedRules: ["common/secrets"],
      changedPaths: ["src/config/keys.ts"]
    }
    const first = searchPrecedents(query, corpus, 5)
    const second = searchPrecedents(query, corpus, 5)
    expect(first.map((m) => m.precedent.id)).toEqual(
      second.map((m) => m.precedent.id)
    )
  })

  it("firedRules の一致が語彙一致より強く効くケース", () => {
    // 語彙は test-deletion 側に薄く寄せつつ、firedRules は secrets に完全一致させる
    const query = {
      kind: "code" as const,
      objective: "設定の見直し",
      summaryText: "特に語彙的な手がかりが薄いケース",
      firedRules: ["common/secrets"],
      changedPaths: [] as string[]
    }
    const results = searchPrecedents(query, corpus, 5)
    expect(results[0]?.precedent.id).toBe("seed-secret")
  })

  it("kind 一致がスコアを押し上げる", () => {
    const query = {
      kind: "plan" as const,
      objective: "計画のレビュー",
      summaryText: "計画のレビュー",
      firedRules: [] as string[],
      changedPaths: [] as string[]
    }
    const results = searchPrecedents(query, corpus, 5)
    expect(results[0]?.precedent.id).toBe("seed-scope")
  })

  it("project 判例が同条件の seed 判例に勝つ", () => {
    const projectPrecedent = makePrecedent({
      id: "project-secret",
      source: "project",
      kind: "code",
      summary: "ハードコードされたAPIキーの混入",
      firedRules: ["common/secrets"],
      changedPaths: ["src/config/keys.ts"],
      lesson: "秘密鍵はコードに書かない"
    })
    const seedPrecedent = makePrecedent({
      id: "seed-secret-dup",
      source: "seed",
      kind: "code",
      summary: "ハードコードされたAPIキーの混入",
      firedRules: ["common/secrets"],
      changedPaths: ["src/config/keys.ts"],
      lesson: "秘密鍵はコードに書かない"
    })
    const query = {
      kind: "code" as const,
      objective: "APIキーを設定ファイルから読むようにする",
      summaryText: "ハードコードされたAPIキーの混入",
      firedRules: ["common/secrets"],
      changedPaths: ["src/config/keys.ts"]
    }
    const results = searchPrecedents(
      query,
      [seedPrecedent, projectPrecedent],
      5
    )
    expect(results[0]?.precedent.id).toBe("project-secret")
  })

  it("CJK テキストの検索が機能する", () => {
    const query = {
      kind: "code" as const,
      objective: "秘密鍵の取り扱い改善",
      summaryText: "秘密鍵が混入していないか確認する",
      firedRules: [] as string[],
      changedPaths: [] as string[]
    }
    const results = searchPrecedents(query, corpus, 5)
    expect(results[0]?.precedent.id).toBe("seed-secret")
  })

  it("スコア 0 の判例は返さない", () => {
    const query = {
      kind: "design" as const,
      objective: "まったく無関係な設計",
      summaryText: "zzzzz qqqqq wwwww",
      firedRules: ["nonexistent/rule"],
      changedPaths: ["totally/unrelated/dir"]
    }
    const results = searchPrecedents(query, corpus, 5)
    expect(results).toEqual([])
  })

  it("同点は id の辞書順でタイブレークする", () => {
    const a = makePrecedent({
      id: "b-tie",
      kind: "code",
      summary: "",
      firedRules: [],
      changedPaths: [],
      lesson: ""
    })
    const b = makePrecedent({
      id: "a-tie",
      kind: "code",
      summary: "",
      firedRules: [],
      changedPaths: [],
      lesson: ""
    })
    const query = {
      kind: "code" as const,
      objective: "",
      summaryText: "",
      firedRules: [] as string[],
      changedPaths: [] as string[]
    }
    // kind 一致のみで両者スコアが同点になる
    const results = searchPrecedents(query, [a, b], 5)
    expect(results.map((m) => m.precedent.id)).toEqual(["a-tie", "b-tie"])
  })

  it("空コーパスでは空配列を返す", () => {
    const query = {
      kind: "code" as const,
      objective: "x",
      summaryText: "x",
      firedRules: [] as string[],
      changedPaths: [] as string[]
    }
    expect(searchPrecedents(query, [], 5)).toEqual([])
  })
})
