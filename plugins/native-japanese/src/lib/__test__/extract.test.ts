import { describe, expect, test } from "vitest"
import {
  type Block,
  extractBlocks,
  extractLines,
  hasIgnoreMarker,
  isHtml,
  type Source
} from "../extract.js"

const PH = "甲"

function lines(path: string, text: string, cellType?: Source["cellType"]) {
  return extractLines({ path, text, cellType })
}

function blocks(path: string, text: string, cellType?: Source["cellType"]) {
  return extractBlocks({ path, text, cellType })
}

// text の各字に付いた行番号が、lineOf と同じ長さで並んでいるかも確かめる
function lineOfSub(b: Block, sub: string): number[] {
  expect(b.lineOf).toHaveLength(b.text.length)
  const i = b.text.indexOf(sub)
  expect(i).toBeGreaterThanOrEqual(0)
  return b.lineOf.slice(i, i + sub.length)
}

describe("extractLines: 拡張子ごとの抜き出し", () => {
  test("Markdown は全行を抜き出し、コードフェンスの中を除く", () => {
    const text = [
      "設定を変える。",
      "```ts",
      "// フェンスの中のコメント",
      "```",
      "~~~",
      "チルダのフェンスの中",
      "~~~",
      "## 見出しです",
      "| 表の | 行です |"
    ].join("\n")
    for (const ext of [".md", ".mdx", ".markdown", ".txt"]) {
      expect(lines(`a${ext}`, text)).toEqual([
        { line: 1, text: "設定を変える。" },
        { line: 8, text: "## 見出しです" },
        { line: 9, text: "| 表の | 行です |" }
      ])
    }
  })

  test("Markdown のインラインコードは同じ長さの空白に置き換える", () => {
    expect(lines("a.md", "値は `することができる` で決まる")).toEqual([
      { line: 1, text: `値は ${" ".repeat(10)} で決まる` }
    ])
    expect(lines("a.md", "``a`` と `b` だけです")).toEqual([
      { line: 1, text: `${" ".repeat(5)} と ${" ".repeat(3)} だけです` }
    ])
  })

  test("ひらがなもカタカナも無い行を除く", () => {
    expect(
      lines("a.md", "漢字文字列\nEnglish only\nカタカナ\nひらがな")
    ).toEqual([
      { line: 3, text: "カタカナ" },
      { line: 4, text: "ひらがな" }
    ])
    expect(lines("a.md", "`コードだけ`")).toEqual([])
  })

  test("// 系は // 以降、/* */ の内側、* で始まる行を抜き出す", () => {
    const text = [
      "const a = 1 // 行末のコメントです",
      "const s = 'コードの文字列'",
      "/* 1 行のブロックです */ const b = 2",
      "/**",
      " * JSDoc の本文です",
      " */",
      "/* 複数行の",
      "   ブロックの続きです */",
      "const c = 3"
    ].join("\n")
    for (const ext of [".ts", ".tsx", ".js", ".mjs", ".go", ".rs", ".c"]) {
      expect(lines(`a${ext}`, text)).toEqual([
        { line: 1, text: "行末のコメントです" },
        { line: 3, text: "1 行のブロックです" },
        { line: 5, text: "JSDoc の本文です" },
        { line: 7, text: "複数行の" },
        { line: 8, text: "ブロックの続きです" }
      ])
    }
  })

  test("Edit の断片が * で始まる行から始まっても抜き出す", () => {
    expect(lines("a.ts", " * 断片のコメントです\n */\nfoo()")).toEqual([
      { line: 1, text: "断片のコメントです" }
    ])
  })

  test("# 系は # 以降を抜き出し、.py は三重引用符の内側も含める", () => {
    expect(
      lines("a.sh", "echo 1 # 行末のコメントです\necho 'ひらがな'")
    ).toEqual([{ line: 1, text: "行末のコメントです" }])
    expect(lines("a.yaml", "# 設定の説明です\nkey: value")).toEqual([
      { line: 1, text: "設定の説明です" }
    ])
    const py = [
      "def f():",
      '    """関数の説明です。',
      "",
      "    続きの説明です。",
      '    """',
      "    return 1  # 戻り値です",
      "'''単一引用符の説明です'''"
    ].join("\n")
    expect(lines("a.py", py)).toEqual([
      { line: 2, text: "関数の説明です。" },
      { line: 4, text: "続きの説明です。" },
      { line: 6, text: "戻り値です" },
      { line: 7, text: "単一引用符の説明です" }
    ])
    expect(lines("a.rb", '""" 三重引用符はコメントでない """')).toEqual([])
  })

  test("-- 系は -- 以降を抜き出す", () => {
    expect(lines("a.sql", "select 1 -- 件数を数えます")).toEqual([
      { line: 1, text: "件数を数えます" }
    ])
  })

  test("HTML と未対応の拡張子は行単位で抜き出さない", () => {
    expect(lines("a.html", "<p>設定を変える。</p>")).toEqual([])
    expect(lines("a.htm", "<p>設定を変える。</p>")).toEqual([])
    expect(lines("a.json", '{"a": "ひらがな"}')).toEqual([])
    expect(lines("Makefile", "# ひらがな")).toEqual([])
  })

  test("ノートの code セルは // 以降と # 以降の両方を抜き出す", () => {
    const text =
      "x = 1  # Python のコメントです\nlet y = 2 // JS のコメントです"
    expect(lines("a.ipynb", text, "code")).toEqual([
      { line: 1, text: "Python のコメントです" },
      { line: 2, text: "JS のコメントです" }
    ])
  })

  test("ノートの markdown セルは Markdown として扱う", () => {
    expect(
      lines("a.ipynb", "本文です\n```\nコードです\n```", "markdown")
    ).toEqual([{ line: 1, text: "本文です" }])
  })
})

describe("extractBlocks: 段落の組み方", () => {
  test("Markdown の地の文は空行・見出し・リスト・表・フェンスで区切り、改行をつなぐ", () => {
    const text = [
      "# 見出しです", // 1
      "日本語の文を途中で", // 2
      "折り返した段落です。", // 3
      "", // 4
      "次の段落は English", // 5
      "で終わります。", // 6
      "- 一つ目の項目です", // 7
      "  折り返した続きです。", // 8
      "- 二つ目の項目です", // 9
      "| 表の | 行です |", // 10
      "表の後の段落です。", // 11
      "```", // 12
      "フェンスの中です", // 13
      "```", // 14
      "> 引用の段落です。" // 15
    ].join("\n")
    const got = blocks("a.md", text)
    expect(got.map((b) => [b.kind, b.text])).toEqual([
      ["heading", "見出しです"],
      ["prose", "日本語の文を途中で折り返した段落です。"],
      ["prose", "次の段落は English で終わります。"],
      ["list", "一つ目の項目です折り返した続きです。"],
      ["list", "二つ目の項目です"],
      ["table", "| 表の | 行です |"],
      ["prose", "表の後の段落です。"],
      ["prose", "引用の段落です。"]
    ])
    expect(lineOfSub(got[1] as Block, "途中で折り")).toEqual([2, 2, 2, 3, 3])
    expect(lineOfSub(got[3] as Block, "です折")).toEqual([7, 7, 8])
  })

  test("インラインコードと URL を名詞として解析される 1 字に置き換える", () => {
    const got = blocks(
      "a.md",
      "設定は `foo` で変え、https://example.com/a?b=1 を見る。"
    )
    expect(got).toHaveLength(1)
    expect(got[0]?.text).toBe(`設定は ${PH} で変え、${PH} を見る。`)
    expect(got[0]?.lineOf).toHaveLength(got[0]?.text.length ?? -1)
  })

  test("コメントは連続する行を 1 段落にし、コードの行と空のコメントで区切る", () => {
    const text = [
      "// 一つ目の段落の", // 1
      "// 続きです。", // 2
      "//", // 3
      "// 二つ目の段落です。", // 4
      "foo()", // 5
      "/**", // 6
      " * 三つ目の段落で `bar` を使う。", // 7
      " */" // 8
    ].join("\n")
    const got = blocks("a.ts", text)
    expect(got.map((b) => [b.kind, b.text])).toEqual([
      ["comment", "一つ目の段落の続きです。"],
      ["comment", "二つ目の段落です。"],
      ["comment", `三つ目の段落で ${PH} を使う。`]
    ])
    expect(lineOfSub(got[0] as Block, "の続")).toEqual([1, 2])
  })

  test("ひらがなもカタカナも無い段落は返さない", () => {
    expect(blocks("a.md", "漢字文字列\n\n`コード`")).toEqual([])
  })

  test("未対応の拡張子は空", () => {
    expect(blocks("a.json", "ひらがな")).toEqual([])
  })
})

describe("extractBlocks: HTML", () => {
  test("インライン要素をまたぐ文を 1 ブロックにし、各字の行番号を持つ", () => {
    const got = blocks(
      "a.html",
      "<html>\n<body>\n<p>設定を変えることが<em>できる</em>。</p>\n</body>"
    )
    expect(got).toEqual([
      {
        kind: "prose",
        text: "設定を変えることができる。",
        lineOf: Array(13).fill(3)
      }
    ])
  })

  test("<code> の中は抜き出さない", () => {
    const got = blocks("a.html", "<p><code>することができる</code></p>")
    expect(got.map((b) => b.text).join("")).not.toContain("すること")
  })

  test("ブロックの途中の <code> は 1 字に置き換える", () => {
    expect(
      blocks("a.html", "<p>設定は <code>foo</code> で変える。</p>")[0]?.text
    ).toBe(`設定は ${PH} で変える。`)
  })

  test("実体参照を戻す", () => {
    const got = blocks(
      "a.html",
      "<p>A&nbsp;&amp;&nbsp;B は、情報を整理すること&#12395;よって決まる。</p>"
    )
    expect(got).toHaveLength(1)
    expect(got[0]?.text).toBe("A & B は、情報を整理することによって決まる。")
    expect(
      blocks("a.html", "<p>&#x3042;&lt;&gt;&quot;&copy;です</p>")[0]?.text
    ).toBe('あ<>"&copy;です')
  })

  test("複数行にまたがる段落で、各字の元の行番号を持つ", () => {
    const text = [
      "<div>", // 1
      "  <p>日本語の文を", // 2
      "    途中で折り返し、", // 3
      "    English", // 4
      "    で終わる。</p>", // 5
      "</div>" // 6
    ].join("\n")
    const got = blocks("a.html", text)
    expect(got).toHaveLength(1)
    const b = got[0] as Block
    expect(b.text).toBe("日本語の文を途中で折り返し、 English で終わる。")
    expect(lineOfSub(b, "を途")).toEqual([2, 3])
    expect(lineOfSub(b, "English")).toEqual(Array(7).fill(4))
    expect(lineOfSub(b, "終わる。")).toEqual([5, 5, 5, 5])
  })

  test("ブロックの区切りとブロックの種類", () => {
    const text = [
      "<h2>見出しです</h2>",
      "<ul><li>項目です<p>項目の中の段落です</p>項目の続きです</li></ul>",
      "<table><tr><th>列の名前</th><td>セルです</td></tr></table>",
      "<p>一行目です<br>二行目です</p>"
    ].join("\n")
    expect(blocks("a.html", text).map((b) => [b.kind, b.text])).toEqual([
      ["heading", "見出しです"],
      ["list", "項目です"],
      ["prose", "項目の中の段落です"],
      ["list", "項目の続きです"],
      ["table", "列の名前"],
      ["table", "セルです"],
      ["prose", "一行目です"],
      ["prose", "二行目です"]
    ])
  })

  test("除外する要素・コメント・属性値を抜き出さず、行番号をずらさない", () => {
    const text = [
      "<script>", // 1
      "// スクリプトのコメントです", // 2
      "</script>", // 3
      "<style>/* スタイルです */</style>", // 4
      "<!-- コメントです", // 5
      "-->", // 6
      '<img alt="代替のテキストです" title="題名です">', // 7
      "<pre>整形済みです</pre><template>テンプレートです</template>", // 8
      "<svg><text>図の文字です</text></svg>", // 9
      "<p>本文です</p>" // 10
    ].join("\n")
    expect(blocks("a.html", text)).toEqual([
      { kind: "prose", text: "本文です", lineOf: [10, 10, 10, 10] }
    ])
  })

  test(".vue .jsx .tsx では HTML の抜き出しを使わない", () => {
    const text = "<p>設定を変えることができる。</p>"
    for (const p of ["a.vue", "a.jsx", "a.tsx"]) {
      expect(blocks(p, text)).toEqual([])
    }
    expect(isHtml("a.html")).toBe(true)
    expect(isHtml("dir/A.HTM")).toBe(true)
    for (const p of ["a.vue", "a.jsx", "a.tsx", "a.md", "html"]) {
      expect(isHtml(p)).toBe(false)
    }
  })
})

describe("hasIgnoreMarker", () => {
  const MD = "<!-- native-japanese: ignore-file -->"

  test("Markdown と HTML は行全体が目印である行だけを認める", () => {
    expect(hasIgnoreMarker({ path: "a.md", text: `${MD}\n本文` })).toBe(true)
    expect(hasIgnoreMarker({ path: "a.md", text: `  ${MD}  ` })).toBe(true)
    expect(hasIgnoreMarker({ path: "a.html", text: `<p>x</p>\n${MD}` })).toBe(
      true
    )
    expect(
      hasIgnoreMarker({ path: "a.ipynb", text: MD, cellType: "markdown" })
    ).toBe(true)
    expect(hasIgnoreMarker({ path: "a.md", text: `本文 ${MD}` })).toBe(false)
  })

  test("インラインコードとコードフェンスの中では認めない", () => {
    expect(hasIgnoreMarker({ path: "a.md", text: `\`${MD}\`` })).toBe(false)
    expect(
      hasIgnoreMarker({ path: "a.md", text: `\`\`\`\n${MD}\n\`\`\`` })
    ).toBe(false)
  })

  test("コードは内容が目印だけのコメント行を認める", () => {
    const m = "native-japanese: ignore-file"
    expect(hasIgnoreMarker({ path: "a.ts", text: `// ${m}\nfoo()` })).toBe(true)
    expect(hasIgnoreMarker({ path: "a.ts", text: `/* ${m} */` })).toBe(true)
    expect(hasIgnoreMarker({ path: "a.py", text: `#${m}` })).toBe(true)
    expect(hasIgnoreMarker({ path: "a.sql", text: `-- ${m}` })).toBe(true)
    expect(
      hasIgnoreMarker({ path: "a.ipynb", text: `# ${m}`, cellType: "code" })
    ).toBe(true)
    expect(hasIgnoreMarker({ path: "a.ts", text: `foo() // ${m}` })).toBe(false)
    expect(hasIgnoreMarker({ path: "a.ts", text: `// ${m} です` })).toBe(false)
    expect(hasIgnoreMarker({ path: "a.ts", text: `# ${m}` })).toBe(false)
    expect(hasIgnoreMarker({ path: "a.json", text: `// ${m}` })).toBe(false)
  })
})
