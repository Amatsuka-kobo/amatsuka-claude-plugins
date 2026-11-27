import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { extractChecks, prepareArchitectureUpdate } from "../architecture.js"
import {
  type CheckDefinition,
  compileGlob,
  extractImports,
  parseChecksContent,
  runChecks
} from "../checks.js"

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-checks-"))
  )
  tmpDirs.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body, "utf8")
  }
  return root
}

const CROSS: CheckDefinition = {
  id: "cross",
  kind: "no-import",
  from: ["plugins/<plugin>/src/**"],
  exceptFrom: ["plugins/*/src/**/__test__/**"],
  to: ["plugins/*/src/**"],
  exceptTo: ["plugins/<plugin>/src/**"],
  message: "他プラグインの src を import しない"
}

function block(value: unknown): string {
  return JSON.stringify(value)
}

describe("C1: 定義の検証", () => {
  const base = {
    id: "a",
    kind: "no-import",
    from: ["src/**"],
    to: ["lib/**"],
    message: "m"
  }
  test.each([
    ["JSON でない", "{"],
    ["空の配列", block([])],
    ["配列でない", block(base)],
    ["未知の kind", block([{ ...base, kind: "run-command" }])],
    ["message が無い", block([{ ...base, message: undefined }])],
    ["from が空", block([{ ...base, from: [] }])],
    ["to が文字列", block([{ ...base, to: "lib/**" }])],
    ["id の重複", block([base, base])],
    ["to の <名前>", block([{ ...base, to: ["lib/<p>/**"] }])],
    ["覚えていない <名前>", block([{ ...base, exceptTo: ["lib/<p>/**"] }])],
    ["区間の一部の <名前>", block([{ ...base, from: ["src/x-<p>/**"] }])],
    ["同じ <名前> が 2 回", block([{ ...base, from: ["<p>/<p>/**"] }])],
    [".. の区間", block([{ ...base, from: ["../src/**"] }])],
    ["/ で始まる", block([{ ...base, to: ["/etc/**"] }])],
    [
      "from の <名前> の組が揃わない",
      block([{ ...base, from: ["a/<p>/**", "b/**"] }])
    ]
  ])("%s は読めない定義になる", (_, content) => {
    const result = parseChecksContent(content)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("invalid_checks")
  })

  test("正しい定義は読め、except は省ける", () => {
    const result = parseChecksContent(block([base]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.checks[0].exceptFrom).toEqual([])
      expect(result.checks[0].exceptTo).toEqual([])
    }
  })

  test("ブロックが無い文書は block_not_found", () => {
    const result = extractChecks("# ARCHITECTURE\n\n## 禁止事項\n\n- なし\n")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("block_not_found")
  })
})

describe("C2: glob", () => {
  test.each([
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/x/y/b", true],
    ["a/**/b", "a/xb", false],
    ["plugins/*/src/**", "plugins/x/src", true],
    ["plugins/*/src/**", "plugins/x/src/a/b.ts", true],
    ["plugins/*/src/**", "plugins/x/y/src/a.ts", false],
    ["**/__test__/**", "a/__test__/b.ts", true],
    ["**/__test__/**", "a/foo__test__/b.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/a/b.ts", false]
  ])("%s と %s → %s", (glob, file, expected) => {
    expect(compileGlob(glob).re.test(file)).toBe(expected)
  })
})

describe("C3: import の抽出", () => {
  test("1 行・複数行・型・export・副作用・動的・require を拾い、行番号は指定子の位置", () => {
    const text = [
      'import a from "./a"',
      "import {",
      "  b,",
      "  c",
      '} from "./b"',
      'import type { T } from "./t"',
      'export * from "./e"',
      'import "./side"',
      'const d = await import("./dyn")',
      'const r = require("./req")',
      '// import x from "./comment"',
      ' * import y from "./block"',
      "const s = 'import z from \"./str\"'"
    ].join("\n")
    expect(extractImports(text)).toEqual([
      { specifier: "./a", line: 1 },
      { specifier: "./b", line: 5 },
      { specifier: "./t", line: 6 },
      { specifier: "./e", line: 7 },
      { specifier: "./side", line: 8 },
      { specifier: "./dyn", line: 9 },
      { specifier: "./req", line: 10 }
    ])
  })
})

describe("C4: 実行", () => {
  test("他プラグインの src への import だけを違反にし、同じプラグイン・テスト・パッケージ名は除く", () => {
    const root = project({
      "plugins/a/src/x.ts": [
        'import { y } from "./y"',
        'import { b } from "../../b/src/b"',
        'import pkg from "b"',
        'import dir from "../../b/src"'
      ].join("\n"),
      "plugins/a/src/y.ts": "export const y = 1\n",
      "plugins/a/src/__test__/x.test.ts":
        'import { b } from "../../../b/src/b"\n',
      "plugins/b/src/b.ts": "export const b = 1\n"
    })
    const result = runChecks(root, [CROSS])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.violations).toEqual([
      {
        check: "cross",
        file: "plugins/a/src/x.ts",
        line: 2,
        specifier: "../../b/src/b",
        target: "plugins/b/src/b",
        message: CROSS.message
      },
      {
        check: "cross",
        file: "plugins/a/src/x.ts",
        line: 4,
        specifier: "../../b/src",
        target: "plugins/b/src",
        message: CROSS.message
      }
    ])
  })

  test("docRoot の外へ出る指定子は見ず、ECMAScript 以外は skipped に数える", () => {
    const root = project({
      "src/a.ts": 'import x from "../../outside/src/x"\n',
      "src/b.py": "import os\n"
    })
    const result = runChecks(root, [
      {
        id: "out",
        kind: "no-import",
        from: ["src/**"],
        exceptFrom: [],
        to: ["**"],
        exceptTo: [],
        message: "m"
      }
    ])
    expect(result).toEqual({ ok: true, violations: [], checked: 1, skipped: 1 })
  })

  test("from に一致するファイルが無い定義は no_match", () => {
    const root = project({ "src/a.ts": "" })
    const result = runChecks(root, [{ ...CROSS }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_match")
  })
})

describe("C5: 書き込み経路", () => {
  const doc = (content: string) =>
    `# ARCHITECTURE\n\n## 禁止事項\n\n\`\`\`json metatron:checks\n${content}\n\`\`\`\n`

  test("読めない定義を書き込むと invalid_checks で拒否する", () => {
    const before = "# ARCHITECTURE\n\n## 禁止事項\n\n- なし\n"
    const result = prepareArchitectureUpdate(before, [
      {
        heading: "禁止事項",
        body: `\`\`\`json metatron:checks\n${block([{ id: "a", kind: "x" }])}\n\`\`\``
      }
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalid_checks")
  })

  test("変更前から読めない文書では拒否しない", () => {
    const before = doc("{")
    const result = prepareArchitectureUpdate(before, [
      { heading: "テスト方針", body: "- vitest" }
    ])
    expect(result.ok).toBe(true)
  })
})

describe("C6: レビューで見つかった入力", () => {
  test("コメントの中の引用符・同じ行の 2 つ目・BOM の後の import を拾う", () => {
    const text = [
      '﻿import a from "./a"',
      "import {",
      "  b, // don't",
      "  c",
      '} from "../x"',
      'import d from "./d"; import e from "../e"',
      'import f from "."'
    ].join("\n")
    expect(extractImports(text).map((i) => i.specifier)).toEqual([
      "./a",
      "../x",
      "./d",
      "../e",
      "."
    ])
  })

  test("コメント・ブロックコメント・テンプレート・文字列・プロパティの中の import は拾わない", () => {
    const text = [
      "export const A = 1",
      '// copied from "../b/src/x"',
      "/*",
      'import x from "../b"',
      "*/",
      "const t = `",
      'import y from "../c"',
      "`",
      'const s = "await import(\\"../d\\")"',
      '// const r = require("../b/src/y")',
      'a.import("../z")'
    ].join("\n")
    expect(extractImports(text)).toEqual([])
  })

  test.each([
    ["空の区間", "a//b"],
    [". の区間", "b/./c"]
  ])("%s を持つ glob は読めない定義になる", (_, glob) => {
    const result = parseChecksContent(
      block([
        {
          id: "a",
          kind: "no-import",
          from: ["src/**"],
          to: [glob],
          message: "m"
        }
      ])
    )
    expect(result.ok).toBe(false)
  })

  test("連続する ** は 1 つにまとめる", () => {
    expect(compileGlob("a/**/**/b").re.test("a/b")).toBe(true)
  })

  test("from に一致するのが ECMAScript 以外だけなら no_match", () => {
    const root = project({ "src/a.py": "import os\n" })
    const result = runChecks(root, [
      {
        id: "py",
        kind: "no-import",
        from: ["src/**"],
        exceptFrom: [],
        to: ["lib/**"],
        exceptTo: [],
        message: "m"
      }
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_match")
  })

  test("途中の区間のリンクで docRoot の外へ出る開始点は outside_root", () => {
    const outside = project({ "src/a.ts": 'import x from "../lib/x"\n' })
    const root = project({})
    fs.symlinkSync(outside, path.join(root, "linked"))
    const result = runChecks(root, [
      {
        id: "out",
        kind: "no-import",
        from: ["linked/src/**"],
        exceptFrom: [],
        to: ["**"],
        exceptTo: [],
        message: "m"
      }
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("outside_root")
  })
})
