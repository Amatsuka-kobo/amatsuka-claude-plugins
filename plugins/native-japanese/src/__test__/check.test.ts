import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"
import { fakeDataDir as makeFakeDataDir } from "./helpers/fake-data-dir.js"

const SCRIPT = fileURLToPath(new URL("../check.ts", import.meta.url))
const BUNDLE = fileURLToPath(
  new URL("../../scripts/check.mjs", import.meta.url)
)

const FIXTURE: { text: string }[] = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/morph/tokens.json", import.meta.url),
    "utf8"
  )
)
// sentences.txt の n 行目(1 始まり)
const sentence = (n: number) => (FIXTURE[n - 1] as { text: string }).text
// bun-nagasa に当たる 110 字の文と、どの規則にも当たらない短い文
const LONG = sentence(17)
const PLAIN = sentence(26)

// 書き込み先のファイルと、記録先の os.tmpdir() に向ける TMPDIR を、テストごとに一時ディレクトリへ作る
let work: string
let tmp: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-check-"))
  tmp = path.join(work, "tmp")
  fs.mkdirSync(tmp)
})
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true })
})

// 実行する側の環境の設定が結果を変えないよう、関係する変数を外してから渡す
function run(
  input: unknown,
  env: Record<string, string> = {},
  script = SCRIPT
): string {
  const {
    CLAUDE_PLUGIN_DATA: _d,
    AMATSUKA_NATIVE_JAPANESE_MORPH: _m,
    AMATSUKA_NATIVE_JAPANESE_CHECK: _c,
    ...rest
  } = process.env
  const opts = {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...rest, TMPDIR: tmp, ...env }
  }
  return script.endsWith(".mjs")
    ? execFileSync(process.execPath, [script], { encoding: "utf8", ...opts })
    : runTs(script, [], opts)
}

function block(out: string): string {
  const lines = out.trim().split("\n")
  expect(lines).toHaveLength(1)
  const r = JSON.parse(lines[0] as string) as {
    decision: string
    reason: string
  }
  expect(r.decision).toBe("block")
  return r.reason
}

function write(name: string, text: string): string {
  const p = path.join(work, name)
  fs.writeFileSync(p, text)
  return p
}

function hookInput(
  tool_name: string,
  tool_input: Record<string, unknown>,
  session_id = "s1"
) {
  return {
    hook_event_name: "PostToolUse",
    session_id,
    cwd: work,
    tool_name,
    tool_input
  }
}

function writeInput(p: string, content: string, session_id = "s1") {
  return hookInput("Write", { file_path: p, content }, session_id)
}

const fakeDataDir = () => {
  fs.mkdirSync(path.join(work, "data"))
  return makeFakeDataDir(path.join(work, "data"))
}

const RECORD = () => path.join(tmp, "native-japanese", "s1.json")

test("Write の違反を block で差し戻し、差し戻し文に行・該当部分・分類・advice を載せる", () => {
  const text = "# 見出し\n\nこの設定で作業時間を短縮することができる。\n"
  const p = write("a.md", text)
  const reason = block(run(writeInput(p, text)))
  expect(reason).toContain(
    `[native-japanese] ${p} に書いた日本語に、書き方の規律の違反が 1 件ある。該当箇所を書き直す。`
  )
  expect(reason).toMatch(/^- L3: 「ことができ」\(翻訳調\)→ .+$/m)
  expect(reason).toContain(
    "引用・固有名詞・識別子・コード例として意図して書いた箇所と、検査の誤りと判断した箇所は、直さずに残してよい。直すときは、否定・条件・確信度を元の文のまま保つ。"
  )
})

test("違反が無ければ何も出さない", () => {
  const p = write("a.md", `${PLAIN}\n`)
  expect(run(writeInput(p, `${PLAIN}\n`))).toBe("")
})

test("Edit で、ファイルに元からある違反を差し戻さず、new_string の違反だけを差し戻す", () => {
  const p = write(
    "a.md",
    "既存の行で作業時間を短縮することができる。\n\n情報を整理することによって判断が速くなる。\n"
  )
  const reason = block(
    run(
      hookInput("Edit", {
        file_path: p,
        old_string: "x",
        new_string: "情報を整理することによって判断が速くなる。"
      })
    )
  )
  expect(reason).toContain("違反が 1 件ある")
  // 行番号はファイルの中での位置に直す
  expect(reason).toContain("- L3: 「ことによって」")
  expect(reason).not.toContain("することができ")
})

test("MultiEdit の edits[] を 1 件ずつ別の本文として扱う", () => {
  const p = write("a.md", "設定を変えることが\nできると書いた。\n")
  expect(
    run(
      hookInput("MultiEdit", {
        file_path: p,
        edits: [
          { old_string: "a", new_string: "設定を変えることが" },
          { old_string: "b", new_string: "できると書いた。" }
        ]
      })
    )
  ).toBe("")
  const q = write(
    "b.md",
    "時間を短縮することができる。\nこれは変化に他ならない。\n"
  )
  const reason = block(
    run(
      hookInput("MultiEdit", {
        file_path: q,
        edits: [
          { old_string: "a", new_string: "時間を短縮することができる。" },
          { old_string: "b", new_string: "これは変化に他ならない。" }
        ]
      })
    )
  )
  expect(reason).toContain("- L1: 「ことができ」")
  expect(reason).toContain("- L2: 「に他ならない」")
})

test("NotebookEdit の code セルでコメントの違反を差し戻す", () => {
  const p = write("n.ipynb", "{}")
  const reason = block(
    run(
      hookInput("NotebookEdit", {
        notebook_path: p,
        new_source: "x = 1  # 時間を短縮することができる",
        cell_type: "code",
        edit_mode: "replace"
      })
    )
  )
  expect(reason).toContain("することができ")
})

// 書き込み後のノートを置く。セル a は markdown、b は code
function notebook(): string {
  return write(
    "n.ipynb",
    JSON.stringify({
      cells: [
        { id: "a", cell_type: "markdown", source: [], metadata: {} },
        { id: "b", cell_type: "code", source: [], metadata: {} }
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5
    })
  )
}

const PROSE = "時間を短縮することができる。"
const COMMENTED = "x = 1  # 時間を短縮することができる"

function replaceCell(p: string, cell_id: string, new_source: string) {
  return run(
    hookInput(
      "NotebookEdit",
      { notebook_path: p, cell_id, new_source, edit_mode: "replace" },
      `nb-${cell_id}-${new_source.length}`
    )
  )
}

test("cell_type の無い replace で、ノートの markdown のセルを markdown として検査する", () => {
  expect(block(replaceCell(notebook(), "a", PROSE))).toContain("することができ")
})

test("cell_type の無い replace で、ノートの code のセルはコメントだけを検査する", () => {
  const p = notebook()
  expect(replaceCell(p, "b", PROSE)).toBe("")
  expect(block(replaceCell(p, "b", COMMENTED))).toContain("することができ")
})

test("cell_type の無い replace で、セルの種類が取れなければ code とみなす", () => {
  const p = notebook()
  expect(replaceCell(p, "missing", PROSE)).toBe("")
  expect(block(replaceCell(p, "missing", COMMENTED))).toContain(
    "することができ"
  )
  write("n.ipynb", "{broken")
  expect(replaceCell(p, "a", PROSE)).toBe("")
  expect(block(replaceCell(p, "a", COMMENTED))).toContain("することができ")
})

test("Serena の relative_path を cwd から解決して差し戻す", () => {
  write("c.md", "前の行。\n時間を短縮することができる。\n")
  const reason = block(
    run(
      hookInput("mcp__serena__replace_content", {
        relative_path: "c.md",
        needle: "x",
        repl: "時間を短縮することができる。",
        mode: "literal"
      })
    )
  )
  expect(reason).toContain(`${path.join(work, "c.md")} に書いた日本語`)
  expect(reason).toContain("- L2: 「ことができ」")
})

test("ignore-file の目印を持つファイルでは何も出さない", () => {
  const text =
    "<!-- native-japanese: ignore-file -->\n\n時間を短縮することができる。\n"
  const p = write("a.md", text)
  expect(
    run(
      hookInput("Edit", {
        file_path: p,
        old_string: "x",
        new_string: "時間を短縮することができる。"
      })
    )
  ).toBe("")
})

test("AMATSUKA_NATIVE_JAPANESE_CHECK=off で何も出さない", () => {
  const text = "時間を短縮することができる。\n"
  const p = write("a.md", text)
  expect(
    run(writeInput(p, text), { AMATSUKA_NATIVE_JAPANESE_CHECK: "off" })
  ).toBe("")
})

test("壊れた入力とパスや本文の無い入力で何も出さず exit 0 で終える", () => {
  expect(run("{not json")).toBe("")
  expect(run("null")).toBe("")
  expect(run(hookInput("Write", { content: "することができる。" }))).toBe("")
  expect(
    run(hookInput("Write", { file_path: path.join(work, "none.md") }))
  ).toBe("")
  // 書き込み後のファイルが読めないとき
  expect(
    run(writeInput(path.join(work, "none.md"), "することができる。"))
  ).toBe("")
})

test("ディレクトリへの replace_in_files で何も出さない", () => {
  write("d.md", "時間を短縮することができる。\n")
  expect(
    run(
      hookInput("mcp__serena__replace_in_files", {
        relative_path: ".",
        needle: "x",
        repl: "時間を短縮することができる。",
        mode: "literal"
      })
    )
  ).toBe("")
})

test("同じ違反を 2 回目は差し戻さず、新しい違反だけを差し戻す", () => {
  const first = "時間を短縮することができる。\n"
  const p = write("a.md", first)
  expect(block(run(writeInput(p, first)))).toContain("することができ")
  expect(run(writeInput(p, first))).toBe("")
  const second = `${first}これは変化に他ならない。\n`
  write("a.md", second)
  const reason = block(run(writeInput(p, second)))
  expect(reason).toContain("違反が 1 件ある")
  expect(reason).toContain("に他ならない")
  expect(reason).not.toContain("することができ")
  // 別のセッションでは記録が効かない
  expect(block(run(writeInput(p, first, "s2")))).toContain("することができ")
})

test("記録を一時ファイルからの rename で書く", () => {
  // 記録先を別のファイルへのシンボリックリンクにしておく。rename ならリンクそのものが置き換わり、
  // リンク先には書き込まれない
  fs.mkdirSync(path.dirname(RECORD()), { recursive: true })
  const target = path.join(work, "linked.json")
  fs.writeFileSync(target, "[]")
  fs.symlinkSync(target, RECORD())
  const text = "時間を短縮することができる。\n"
  const p = write("a.md", text)
  block(run(writeInput(p, text)))
  expect(fs.lstatSync(RECORD()).isSymbolicLink()).toBe(false)
  expect(fs.readFileSync(target, "utf8")).toBe("[]")
  expect(JSON.parse(fs.readFileSync(RECORD(), "utf8"))).toHaveLength(1)
  expect(fs.readdirSync(path.dirname(RECORD()))).toEqual(["s1.json"])
})

test("記録が読めなければ記録なしとして差し戻す", () => {
  fs.mkdirSync(path.dirname(RECORD()), { recursive: true })
  fs.writeFileSync(RECORD(), "{broken")
  const text = "時間を短縮することができる。\n"
  const p = write("a.md", text)
  expect(block(run(writeInput(p, text)))).toContain("することができ")
})

test("差し戻し文には 10 件までを載せ、残りは件数だけを書く", () => {
  const text = Array.from(
    { length: 12 },
    (_, i) => `手順${i}を短縮することができる。`
  ).join("\n")
  const p = write("a.md", text)
  const reason = block(run(writeInput(p, text)))
  expect(reason).toContain("違反が 12 件ある")
  expect(reason.match(/^- L\d+:/gm)).toHaveLength(10)
  expect(reason).toContain("- L10:")
  expect(reason).not.toContain("- L11:")
  expect(reason).toMatch(/ほか 2 件/)
})

test("HTML で、編集範囲の外のブロックの違反を差し戻さない", () => {
  const p = write(
    "a.html",
    "<p>設定を変えることが<em>できる</em>。</p>\n<p>情報を整理することによって決まる。</p>\n"
  )
  const reason = block(
    run(
      hookInput("Edit", {
        file_path: p,
        old_string: "x",
        new_string: "<p>情報を整理することによって決まる。</p>"
      })
    )
  )
  expect(reason).toContain("違反が 1 件ある")
  expect(reason).toContain("- L2: 「ことによって」")
  // 本文がファイルに見つからなければ、HTML では正規表現の層も当てない
  expect(
    run(
      hookInput("Edit", {
        file_path: p,
        old_string: "x",
        new_string: "<p>別の本文で短縮することができる。</p>"
      })
    )
  ).toBe("")
})

test("CLAUDE_PLUGIN_DATA が無いか空のディレクトリでも、正規表現の層の違反を返す", () => {
  const text = "時間を短縮することができる。\n"
  const p = write("a.md", text)
  expect(block(run(writeInput(p, text, "n1")))).toContain("することができ")
  const empty = path.join(work, "empty")
  fs.mkdirSync(empty)
  expect(
    block(run(writeInput(p, text, "n2"), { CLAUDE_PLUGIN_DATA: empty }))
  ).toContain("することができ")
})

test("形態素解析の違反を、文の先頭 20 字で差し戻す", () => {
  const p = write("b.md", `${LONG}\n`)
  const reason = block(
    run(writeInput(p, `${LONG}\n`), { CLAUDE_PLUGIN_DATA: fakeDataDir() })
  )
  expect(reason).toContain(`- L1: 「${[...LONG].slice(0, 20).join("")}」(文)→`)
})

test("形態素解析の違反のうち、編集範囲と重なるものだけを差し戻す", () => {
  const data = fakeDataDir()
  const p = write("b.md", `${LONG}\n\n${PLAIN}\n`)
  const edit = (new_string: string, session_id: string) =>
    run(
      hookInput(
        "Edit",
        { file_path: p, old_string: "x", new_string },
        session_id
      ),
      { CLAUDE_PLUGIN_DATA: data }
    )
  expect(edit(PLAIN, "m1")).toBe("")
  expect(block(edit(LONG, "m2"))).toContain("- L1: ")
  // 本文がファイルに見つからなければ、形態素解析の層を当てない
  write("b.md", `${LONG}\n`)
  expect(edit(`${LONG}追記`, "m3")).toBe("")
})

test.each([
  ["a.md", "時間を短縮することができる。\n"],
  ["a.html", "<p>時間を短縮することができる。</p>\n"]
])("%s で形態素解析の層が例外を投げても、正規表現の層の違反を差し戻す", (name, text) => {
  const p = write(name, text)
  const reason = block(
    run(writeInput(p, text), {
      CLAUDE_PLUGIN_DATA: fakeDataDir(),
      NJ_FAKE_LINDERA_THROW: "1"
    })
  )
  expect(reason).toContain("違反が 1 件ある")
  expect(reason).toContain("することができ")
})

test("AMATSUKA_NATIVE_JAPANESE_MORPH=off で解析器を読み込まない", () => {
  const p = write("b.md", `${LONG}\n`)
  expect(
    run(writeInput(p, `${LONG}\n`), {
      CLAUDE_PLUGIN_DATA: fakeDataDir(),
      AMATSUKA_NATIVE_JAPANESE_MORPH: "off"
    })
  ).toBe("")
})

test("バンドル後の scripts/check.mjs が discipline.md を読み、違反のある入力で block を返す", () => {
  const text = "この事態は様々な要因で起きた。\n"
  const p = write("a.md", text)
  // 避ける語の規則は discipline.md から作るので、これが当たれば discipline.md を読めている
  expect(block(run(writeInput(p, text), {}, BUNDLE))).toContain("様々な")
})

test("バンドル後の scripts/check.mjs が解析器を読み込み、形態素解析の違反を返す", () => {
  const p = write("b.md", `${LONG}\n`)
  const reason = block(
    run(
      writeInput(p, `${LONG}\n`),
      { CLAUDE_PLUGIN_DATA: fakeDataDir() },
      BUNDLE
    )
  )
  expect(reason).toContain(`- L1: 「${[...LONG].slice(0, 20).join("")}」(文)→`)
})
