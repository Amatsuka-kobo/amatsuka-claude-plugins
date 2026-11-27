// 設計書 §13-1 の guard-docs.ts の表(D1〜D13)を全件実装する。
// テストは子プロセス実行(stdin に JSON を流し stdout を読む)。
// stdout が空なら「素通し」(permissionDecision を出さない)と判定する。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../guard-docs.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url))
const CLI = path.join(PLUGIN_ROOT, "scripts", "metatron.mjs")
// 実装と同じ文面を独立に持つ。書き込みの CLI 手順の代わりに、スキルへ誘導する。
const SKILL_LINE =
  "更新は Skill ツールで metatron:updating-architecture を起動し、その手順で行ってください。"

interface HookOutput {
  hookEventName: string
  permissionDecision: string
  permissionDecisionReason: string
}

// stdout が空 = 素通し。deny のときだけ hookSpecificOutput を返す。
function hook(payload: unknown): HookOutput | null {
  const out = runTs(HOOK, [], { input: JSON.stringify(payload) })
  if (out.trim() === "") return null
  return (JSON.parse(out) as { hookSpecificOutput: HookOutput })
    .hookSpecificOutput
}

function edit(cwd: unknown, filePath: unknown): HookOutput | null {
  return hook({ cwd, tool_name: "Edit", tool_input: { file_path: filePath } })
}

function write(cwd: unknown, filePath: unknown): HookOutput | null {
  return hook({ cwd, tool_name: "Write", tool_input: { file_path: filePath } })
}

function notebookEdit(cwd: string, notebookPath: string): HookOutput | null {
  return hook({
    cwd,
    tool_name: "NotebookEdit",
    tool_input: { notebook_path: notebookPath }
  })
}

// 一時プロジェクトを作る。config を必ず置くのは、findDocRoot の段 1(inclusive)で
// docRoot をこのディレクトリに固定し、祖先や git の状態にテストが依存しないようにするため。
function project(config = '{"version":1}'): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-guard-"))
  )
  fs.writeFileSync(path.join(root, "metatron.config.json"), config)
  fs.mkdirSync(path.join(root, "docs"), { recursive: true })
  return root
}

// 実行環境の FS が大文字小文字を区別するかを実測し、D8 の期待値をそれに合わせる。
function fsIsCaseInsensitive(root: string): boolean {
  const probe = path.join(root, "CaseProbe.tmp")
  fs.writeFileSync(probe, "x")
  try {
    return fs.existsSync(path.join(root, "caseprobe.tmp"))
  } finally {
    fs.rmSync(probe, { force: true })
  }
}

test("D1: ARCHITECTURE への Write は deny。理由はスキルへ誘導し、CLI 絶対パスを含む", () => {
  const root = project()
  const r = write(root, path.join(root, "docs/ARCHITECTURE.md"))
  expect(r?.hookEventName).toBe("PreToolUse")
  expect(r?.permissionDecision).toBe("deny")
  const reason = r?.permissionDecisionReason ?? ""
  expect(reason).toContain(SKILL_LINE)
  expect(path.isAbsolute(CLI)).toBe(true)
  expect(reason).toContain(`node ${CLI} get config`)
  // 書き込みの CLI 手順を見せると、スキルを起動せずに直行する。
  expect(reason).not.toContain("stage-architecture")
  expect(reason).not.toContain("commit-architecture")
  // ADR・GOTCHAS の案内は出さない(機能ごと廃止した)。
  expect(reason).not.toContain("ADR")
  expect(reason.replaceAll(CLI, "")).not.toMatch(/gotcha/i)
  expect(reason).toContain("/metatron:init")
  expect(reason).toContain("docs/ARCHITECTURE.md")
})

test("D3: ARCHITECTURE への NotebookEdit は notebook_path を見て deny", () => {
  const root = project(
    '{"version":1,"paths":{"architecture":"docs/ARCH.ipynb"}}'
  )
  const r = notebookEdit(root, path.join(root, "docs/ARCH.ipynb"))
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(SKILL_LINE)
})

// NotebookEdit は file_path と notebook_path の両方を持ちうる。片方だけを見ると
// もう片方に正本を入れた呼び出しが素通りするため、2 つを独立に判定させる。
function notebookEditBoth(
  cwd: string,
  filePath: unknown,
  notebookPath: unknown
): HookOutput | null {
  return hook({
    cwd,
    tool_name: "NotebookEdit",
    tool_input: { file_path: filePath, notebook_path: notebookPath }
  })
}

test("D3b: NotebookEdit で file_path が空文字列でも notebook_path が正本なら deny", () => {
  const root = project(
    '{"version":1,"paths":{"architecture":"docs/ARCH.ipynb"}}'
  )
  const r = notebookEditBoth(root, "", path.join(root, "docs/ARCH.ipynb"))
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(SKILL_LINE)
})

test("D3c: NotebookEdit で file_path が無関係でも notebook_path が正本なら deny", () => {
  const root = project(
    '{"version":1,"paths":{"architecture":"docs/ARCH.ipynb"}}'
  )
  const r = notebookEditBoth(
    root,
    path.join(root, "scratch.ipynb"),
    path.join(root, "docs/ARCH.ipynb")
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(SKILL_LINE)
})

test("D3d: file_path が正本で notebook_path が無関係でも deny(逆方向)", () => {
  const root = project()
  const r = notebookEditBoth(
    root,
    path.join(root, "docs/ARCHITECTURE.md"),
    path.join(root, "scratch.ipynb")
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(SKILL_LINE)

  // 片方が GOTCHAS のパスでも、ARCHITECTURE に当たる側で deny する。
  const both = notebookEditBoth(
    root,
    path.join(root, "docs/ARCHITECTURE.md"),
    path.join(root, "docs/GOTCHAS.md")
  )
  expect(both?.permissionDecision).toBe("deny")
  expect(both?.permissionDecisionReason).toContain(SKILL_LINE)
})

test("D4: 無関係なファイルへの Write は素通し(permissionDecision を出さない)", () => {
  const root = project()
  expect(write(root, path.join(root, "src/index.ts"))).toBe(null)
  expect(edit(root, path.join(root, "docs/README.md"))).toBe(null)
  expect(edit(root, path.join(root, "README.md"))).toBe(null)
})

test("D5: 設定でパスを変更した正本は変更後のパスが deny される", () => {
  const root = project(
    '{"version":1,"paths":{"architecture":"internal/ARCH.md"}}'
  )
  expect(
    write(root, path.join(root, "internal/ARCH.md"))?.permissionDecision
  ).toBe("deny")
  // 既定パスはもはや正本ではないので素通しする。
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md"))).toBe(null)
})

test("D6: 相対パス指定は cwd 基準で解決してから判定され deny される", () => {
  const root = project()
  expect(write(root, "docs/ARCHITECTURE.md")?.permissionDecision).toBe("deny")
  expect(write(root, "./docs/ARCHITECTURE.md")?.permissionDecision).toBe("deny")
  // cwd がサブディレクトリでも、そこからの相対で正本に届けば deny。
  const sub = path.join(root, "sub")
  fs.mkdirSync(sub, { recursive: true })
  expect(write(sub, "../docs/ARCHITECTURE.md")?.permissionDecision).toBe("deny")
})

test("D7: シンボリックリンク経由の書き込みは realpath 解決後に一致し deny される", () => {
  const root = project()
  fs.writeFileSync(path.join(root, "docs/ARCHITECTURE.md"), "# ARCHITECTURE\n")

  // (a) ディレクトリのシンボリックリンク越し。
  const linkDir = path.join(root, "link-docs")
  fs.symlinkSync(path.join(root, "docs"), linkDir, "dir")
  expect(
    write(root, path.join(linkDir, "ARCHITECTURE.md"))?.permissionDecision
  ).toBe("deny")

  // (b) ファイル自体のシンボリックリンク越し。
  const alias = path.join(root, "alias.md")
  fs.symlinkSync(path.join(root, "docs/ARCHITECTURE.md"), alias)
  expect(write(root, alias)?.permissionDecision).toBe("deny")

  // (c) リンク先が正本でなければ素通しのまま。
  fs.writeFileSync(path.join(root, "docs/other.md"), "x")
  const alias2 = path.join(root, "alias2.md")
  fs.symlinkSync(path.join(root, "docs/other.md"), alias2)
  expect(write(root, alias2)).toBe(null)
})

// dangling symlink(リンク先がまだ存在しない symlink)は realpath で解決できない。
// 親ディレクトリだけを実体化する経路では正本がリンク自身のパスに留まり、
// リンク先への直接 Write が別パスに見えて素通りしていた。
// lstat + readlink はリンク先が未作成でも辿れるので、そこまで解決して比較する。
test("D7b: 正本が dangling symlink のとき、リンク先の絶対パスへの Write が deny される", () => {
  // (a) 相対リンク(リンク自身のディレクトリ基準で解決される)と (b) 絶対リンク。
  for (const mode of ["relative", "absolute"] as const) {
    const root = project()
    fs.mkdirSync(path.join(root, "real"), { recursive: true })
    const finalPath = path.join(root, "real/ARCHITECTURE.md")
    fs.symlinkSync(
      mode === "relative" ? "../real/ARCHITECTURE.md" : finalPath,
      path.join(root, "docs/ARCHITECTURE.md")
    )
    // 前提: リンク先は未作成(存在すると realpath が効いてしまい検証にならない)。
    expect(fs.existsSync(finalPath)).toBe(false)

    expect(write(root, finalPath)?.permissionDecision, mode).toBe("deny")
    // 正本パスそのものへの Write も deny。
    expect(
      write(root, path.join(root, "docs/ARCHITECTURE.md"))?.permissionDecision,
      mode
    ).toBe("deny")
    // リンク先と同じディレクトリの別ファイルは素通し(部分一致・前方一致はしない)。
    expect(write(root, path.join(root, "real/OTHER.md")), mode).toBe(null)
    expect(write(root, path.join(root, "real/ARCHITECTURE.md.bak")), mode).toBe(
      null
    )
  }
})

test("D7c: 正本が 2 段の dangling symlink でも最終的なリンク先が deny される", () => {
  const root = project()
  fs.mkdirSync(path.join(root, "real"), { recursive: true })
  // docs/ARCHITECTURE.md -> hop.md -> real/ARCHITECTURE.md(実体は未作成)
  fs.symlinkSync("../hop.md", path.join(root, "docs/ARCHITECTURE.md"))
  fs.symlinkSync("real/ARCHITECTURE.md", path.join(root, "hop.md"))
  expect(fs.existsSync(path.join(root, "real/ARCHITECTURE.md"))).toBe(false)

  expect(
    write(root, path.join(root, "real/ARCHITECTURE.md"))?.permissionDecision
  ).toBe("deny")
  // 中間の hop も同じ実体を指すので deny。
  expect(write(root, path.join(root, "hop.md"))?.permissionDecision).toBe(
    "deny"
  )
  // 無関係な兄弟は素通し。
  expect(write(root, path.join(root, "real/other.md"))).toBe(null)
})

test("D7d: symlink が循環していても例外を投げず素通しする(フェイルオープン)", () => {
  const root = project()
  fs.symlinkSync(path.join(root, "loop-b.md"), path.join(root, "loop-a.md"))
  fs.symlinkSync(path.join(root, "loop-a.md"), path.join(root, "loop-b.md"))
  fs.symlinkSync("../loop-a.md", path.join(root, "docs/ARCHITECTURE.md"))

  // 辿り切れないので実体を確定できない。停止も例外も起こさず素通しへ倒す。
  expect(write(root, path.join(root, "loop-a.md"))).toBe(null)
  expect(write(root, path.join(root, "loop-b.md"))).toBe(null)
  // 正本パスそのものへの判定は壊れない。
  expect(
    write(root, path.join(root, "docs/ARCHITECTURE.md"))?.permissionDecision
  ).toBe("deny")
})

// `alias/..` の `..` は、OS 上ではリンク先の親を指す。字句で先に畳むと
// `<root>/ARCHITECTURE.md` に化け、正本への Write が別パスに見えて素通りしていた。
test("D7g: symlink の後ろの `..` はリンク先の親として解決し deny する", () => {
  const root = project()
  fs.mkdirSync(path.join(root, "docs/inner"), { recursive: true })
  // alias は docs/inner を指すので、alias/.. は docs になる。
  fs.symlinkSync(path.join(root, "docs/inner"), path.join(root, "alias"), "dir")

  expect(
    write(root, `${root}/alias/../ARCHITECTURE.md`)?.permissionDecision
  ).toBe("deny")
  expect(write(root, "alias/../ARCHITECTURE.md")?.permissionDecision).toBe(
    "deny"
  )
  // 字句で畳んだ先(<root>/ARCHITECTURE.md)は正本ではないので素通しのまま。
  expect(write(root, path.join(root, "ARCHITECTURE.md"))).toBe(null)
})

// 字句で畳んだパスと実体で辿ったパスが別の場所を指すときは、どちらかが正本に当たれば拒否する。
test("D7g2: 字句では正本に当たり、実体では当たらない `alias/..` も deny する", () => {
  const root = project()
  fs.mkdirSync(path.join(root, "other/inner"), { recursive: true })
  // alias は other/inner を指す。実体では alias/.. は other、字句では root になる。
  fs.symlinkSync(
    path.join(root, "other/inner"),
    path.join(root, "alias"),
    "dir"
  )

  expect(
    write(root, `${root}/alias/../docs/ARCHITECTURE.md`)?.permissionDecision
  ).toBe("deny")
  expect(write(root, "alias/../docs/ARCHITECTURE.md")?.permissionDecision).toBe(
    "deny"
  )
  // どちらの解釈でも正本に当たらなければ素通しする。
  expect(write(root, "alias/../docs/OTHER.md")).toBe(null)
})

test("D7h: 親ディレクトリが未作成の正本へ、symlink を通した Write も deny する", () => {
  const root = project(
    '{"version":1,"paths":{"architecture":"docs/new/ARCHITECTURE.md"}}'
  )
  fs.symlinkSync(path.join(root, "docs"), path.join(root, "link-docs"), "dir")
  // 前提: 正本の親 docs/new は未作成。
  expect(fs.existsSync(path.join(root, "docs/new"))).toBe(false)

  expect(
    write(root, path.join(root, "link-docs/new/ARCHITECTURE.md"))
      ?.permissionDecision
  ).toBe("deny")
  expect(write(root, path.join(root, "link-docs/new/OTHER.md"))).toBe(null)
})

// 段数の境界。docs/ARCHITECTURE.md -> chain/n1.md -> ... -> chain/n<hops-1>.md -> real/ARCHITECTURE.md
// と張り、symlink がちょうど hops 本になるチェーンを作る。最終リンク先は未作成のまま
// (存在すると realpath が効いてしまい dangling の検証にならない)。
// 張れなかった場合は lstat / expect でテストを失敗させる(黙って飛ばさない)。
function buildDanglingChain(root: string, hops: number): string {
  fs.mkdirSync(path.join(root, "chain"), { recursive: true })
  fs.mkdirSync(path.join(root, "real"), { recursive: true })
  const node = (i: number): string => {
    if (i === 0) return path.join(root, "docs/ARCHITECTURE.md")
    if (i === hops) return path.join(root, "real/ARCHITECTURE.md")
    return path.join(root, "chain", `n${i}.md`)
  }
  for (let i = 0; i < hops; i++) fs.symlinkSync(node(i + 1), node(i))
  for (let i = 0; i < hops; i++) {
    expect(fs.lstatSync(node(i)).isSymbolicLink()).toBe(true)
  }
  expect(fs.existsSync(node(hops))).toBe(false)
  return node(hops)
}

// 上限ちょうどの段数では最終段で symlink でなくなり、最終パスが確定する。
// ループ回数だけで打ち切る実装は 40 本目を辿った直後に抜けて入力(リンク自身のパス)を
// 返すため、ちょうど 40 段のときだけ最終リンク先への Write が素通りしていた。
test("D7e: 正本がちょうど 40 段(上限)の dangling symlink でも最終リンク先が deny される", () => {
  const root = project()
  const final = buildDanglingChain(root, 40)
  expect(write(root, final)?.permissionDecision).toBe("deny")
  // 同じディレクトリの別ファイルは素通し(前方一致・部分一致はしない)。
  expect(write(root, path.join(root, "real/OTHER.md"))).toBe(null)
})

// 41 段は上限超え。最終パスを確定させずに入力へフォールバックする(設計どおりの素通し)。
test("D7f: 41 段(上限超え)は入力へフォールバックして素通しする", () => {
  const root = project()
  const final = buildDanglingChain(root, 41)
  expect(write(root, final)).toBe(null)
  // フォールバック先は正本パスそのものなので、そこへの Write は引き続き deny。
  expect(
    write(root, path.join(root, "docs/ARCHITECTURE.md"))?.permissionDecision
  ).toBe("deny")
})

test("D8: 大文字小文字が異なるパスは非区別 FS で deny、区別 FS では別ファイルとして素通し", () => {
  const root = project()
  const r = write(root, path.join(root, "docs/architecture.md"))
  if (fsIsCaseInsensitive(root)) {
    expect(r?.permissionDecision).toBe("deny")
  } else {
    expect(r).toBe(null)
  }
})

test("D8: 非区別 FS を模した構成では大文字小文字違いが deny される(区別 FS 上でも分岐を実行する)", () => {
  // 実行環境が区別 FS だと D8 の deny 側が一度も動かない。hook の FS 判定は
  // 「docRoot の名前を大文字小文字反転した名前が同じ inode を指すか」の実測なので、
  // 反転名のシンボリックリンクを張れば非区別 FS と同じ観測結果を作れる。
  const root = project()
  const flipped = path.join(
    path.dirname(root),
    path
      .basename(root)
      .replace(/[A-Za-z]/g, (c) =>
        c >= "a" && c <= "z" ? c.toUpperCase() : c.toLowerCase()
      )
  )
  if (fs.existsSync(flipped)) return
  fs.symlinkSync(root, flipped, "dir")
  try {
    expect(
      write(root, path.join(root, "docs/architecture.md"))?.permissionDecision
    ).toBe("deny")
    expect(
      write(root, path.join(root, "docs/Architecture.MD"))?.permissionDecision
    ).toBe("deny")
    // 非区別 FS でも部分一致はしない。
    expect(write(root, path.join(root, "docs/architecture.md.bak"))).toBe(null)
  } finally {
    fs.unlinkSync(flipped)
  }
})

test("D9: ./ や .. を含む冗長なパスは正規化後に一致し deny される", () => {
  const root = project()
  expect(
    write(root, path.join(root, "docs/../docs/./ARCHITECTURE.md"))
      ?.permissionDecision
  ).toBe("deny")
  expect(
    write(root, `${root}/./sub/../docs/ARCHITECTURE.md`)?.permissionDecision
  ).toBe("deny")
})

test("D10: 区切り文字が \\ のパスは正規化後に一致し deny される", () => {
  const root = project()
  expect(
    write(root, `${root}\\docs\\ARCHITECTURE.md`)?.permissionDecision
  ).toBe("deny")
  expect(write(root, "docs\\ARCHITECTURE.md")?.permissionDecision).toBe("deny")
})

test("D11: 正本と似た名前(.bak / .orig)は素通し(前方一致・部分一致はしない)", () => {
  const root = project()
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md.bak"))).toBe(null)
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md.orig"))).toBe(null)
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md.bak"))).toBe(null)
  expect(write(root, path.join(root, "docs/ARCHITECTURE.mdx"))).toBe(null)
  // 逆向きの部分一致(正本パスが対象パスを含む形)も拒否しない。
  expect(write(root, path.join(root, "docs"))).toBe(null)
})

test("D12: 設定が壊れていても既定パスで判定を継続する", () => {
  for (const broken of ["{ not json", "[1,2,3]", "null", '"文字列"']) {
    const root = project(broken)
    expect(
      write(root, path.join(root, "docs/ARCHITECTURE.md"))?.permissionDecision
    ).toBe("deny")
    expect(
      edit(root, path.join(root, "docs/ARCHITECTURE.md"))?.permissionDecision
    ).toBe("deny")
    expect(write(root, path.join(root, "src/index.ts"))).toBe(null)
  }
})

test("D13: 内部エラーは素通し(フェイルオープン。codiel の guard-write と逆)", () => {
  const root = project()

  // 設定解決を意図的に失敗させる。cwd が文字列でないと loadConfig 内の
  // findDocRoot → path.resolve が TypeError を投げ、既定値へのフォールバックも
  // path.join で再度投げる。hook 側の catch がそれを素通しへ倒すことを確認する。
  expect(edit(12345, path.join(root, "docs/ARCHITECTURE.md"))).toBe(null)
  expect(edit({ nested: true }, path.join(root, "docs/ARCHITECTURE.md"))).toBe(
    null
  )

  // stdin が JSON でない(readStdin が投げる)。
  expect(runTs(HOOK, [], { input: "これは JSON ではない" }).trim()).toBe("")

  // stdin が空。
  expect(runTs(HOOK, [], { input: "" }).trim()).toBe("")

  // tool_input が無い / file_path が文字列でない。
  expect(hook({ cwd: root, tool_name: "Write" })).toBe(null)
  expect(edit(root, 42)).toBe(null)
  expect(edit(root, "")).toBe(null)
})

test("D14: NFD 表記のパスと NFC 表記の設定値が同一ファイルを指すなら deny", () => {
  // 結合文字を含む名前は NFC と NFD で byte 列が異なる。対象ファイルが未作成だと
  // realpath による実体解決が効かず、生文字列同士の比較になってすり抜ける。
  const relative = "docs/設計ガイド.md"
  expect(relative.normalize("NFD")).not.toBe(relative.normalize("NFC"))

  const root = project(
    JSON.stringify({
      version: 1,
      paths: { architecture: relative.normalize("NFC") }
    })
  )
  const target = path.join(root, relative.normalize("NFD"))
  // 前提: 未作成であること(存在すると realpath が表記の差を吸収してしまう)。
  expect(fs.existsSync(target)).toBe(false)
  expect(write(root, target)?.permissionDecision).toBe("deny")

  // 逆向き(設定が NFD、対象が NFC)も同じく deny。
  const root2 = project(
    JSON.stringify({
      version: 1,
      paths: { architecture: relative.normalize("NFD") }
    })
  )
  expect(
    write(root2, path.join(root2, relative.normalize("NFC")))
      ?.permissionDecision
  ).toBe("deny")
})

test("フェイルオープンの exit code は常に 0(拒否時も含む)", () => {
  const root = project()
  // runTs は非 0 終了で例外を投げるため、投げないことが exit 0 の確認になる。
  expect(() =>
    runTs(HOOK, [], {
      input: JSON.stringify({
        cwd: root,
        tool_name: "Write",
        tool_input: { file_path: path.join(root, "docs/ARCHITECTURE.md") }
      })
    })
  ).not.toThrow()
  expect(() => runTs(HOOK, [], { input: "壊れた入力" })).not.toThrow()
})

test("D15: 旧 rules 3 ファイルと .claude/rules/ 配下は Write・Edit・NotebookEdit のどれも素通しする", () => {
  const root = project()
  for (const name of ["conventions", "protected-paths", "testing-policy"]) {
    const target = path.join(root, ".claude/rules/metatron", `${name}.md`)
    expect(write(root, target), name).toBe(null)
    expect(edit(root, target), name).toBe(null)
    expect(notebookEdit(root, target), name).toBe(null)
  }
  expect(write(root, path.join(root, ".claude/rules/my-own.md"))).toBe(null)
})

// --- GOTCHAS 機能の廃止後(設計書 2026-11-27)-----------------------------------

test("D24: 既定の docs/GOTCHAS.md への Write・Edit・NotebookEdit は素通しする", () => {
  const root = project()
  const target = path.join(root, "docs/GOTCHAS.md")
  expect(write(root, target)).toBe(null)
  expect(edit(root, target)).toBe(null)
  expect(notebookEdit(root, target)).toBe(null)
})

test("D25: 設定の paths.gotchas に書いたパスへの書き込みも素通しする", () => {
  const root = project('{"version":1,"paths":{"gotchas":"internal/GOT.md"}}')
  expect(write(root, path.join(root, "internal/GOT.md"))).toBe(null)
  // 未知キーは無視され、ARCHITECTURE の拒否は変わらない。
  expect(
    write(root, path.join(root, "docs/ARCHITECTURE.md"))?.permissionDecision
  ).toBe("deny")
})
