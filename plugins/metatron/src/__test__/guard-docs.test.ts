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

test("D1: ARCHITECTURE への Write は deny。理由に stage-architecture --input と CLI 絶対パスを含む", () => {
  const root = project()
  const r = write(root, path.join(root, "docs/ARCHITECTURE.md"))
  expect(r?.hookEventName).toBe("PreToolUse")
  expect(r?.permissionDecision).toBe("deny")
  const reason = r?.permissionDecisionReason ?? ""
  expect(reason).toContain(`node ${CLI} stage-architecture --input`)
  expect(path.isAbsolute(CLI)).toBe(true)
  expect(reason).toContain(`node ${CLI} commit-architecture --staging-id`)
  // ADR の誘導を必ず添える(これが無いと二度目の拒否に当たる)。
  expect(reason).toContain("stage-adr")
  expect(reason).toContain("stage-architecture では拒否されます")
  expect(reason).toContain("docs/ARCHITECTURE.md")
})

test("D2: GOTCHAS への Edit は deny。理由に append-gotcha --input と tag-gotcha を含む", () => {
  const root = project()
  const r = edit(root, path.join(root, "docs/GOTCHAS.md"))
  expect(r?.permissionDecision).toBe("deny")
  const reason = r?.permissionDecisionReason ?? ""
  expect(reason).toContain(`node ${CLI} append-gotcha --input`)
  expect(reason).toContain(`node ${CLI} tag-gotcha --id`)
  expect(reason).toContain("--tag")
  expect(reason).toContain("--reason")
  expect(reason).toContain("docs/GOTCHAS.md")
  // GOTCHAS の案内に ARCHITECTURE の 2 段階コミットを混ぜない。
  expect(reason).not.toContain("stage-architecture")
})

test("D3: GOTCHAS への NotebookEdit は notebook_path を見て deny", () => {
  const root = project('{"version":1,"paths":{"gotchas":"docs/GOTCHAS.ipynb"}}')
  const r = notebookEdit(root, path.join(root, "docs/GOTCHAS.ipynb"))
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("append-gotcha --input")
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
  const root = project('{"version":1,"paths":{"gotchas":"docs/GOTCHAS.ipynb"}}')
  const r = notebookEditBoth(root, "", path.join(root, "docs/GOTCHAS.ipynb"))
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("append-gotcha --input")
})

test("D3c: NotebookEdit で file_path が無関係でも notebook_path が正本なら deny", () => {
  const root = project('{"version":1,"paths":{"gotchas":"docs/GOTCHAS.ipynb"}}')
  const r = notebookEditBoth(
    root,
    path.join(root, "scratch.ipynb"),
    path.join(root, "docs/GOTCHAS.ipynb")
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("append-gotcha --input")
})

test("D3d: file_path が正本で notebook_path が無関係でも deny(逆方向)", () => {
  const root = project()
  const r = notebookEditBoth(
    root,
    path.join(root, "docs/ARCHITECTURE.md"),
    path.join(root, "scratch.ipynb")
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("stage-architecture --input")

  // 2 つのフィールドが別々の正本に当たる場合は ARCHITECTURE の案内を出す
  // (実装側のコメントに選択理由を残してある)。
  const both = notebookEditBoth(
    root,
    path.join(root, "docs/ARCHITECTURE.md"),
    path.join(root, "docs/GOTCHAS.md")
  )
  expect(both?.permissionDecision).toBe("deny")
  expect(both?.permissionDecisionReason).toContain("stage-architecture --input")
})

test("D4: 無関係なファイルへの Write は素通し(permissionDecision を出さない)", () => {
  const root = project()
  expect(write(root, path.join(root, "src/index.ts"))).toBe(null)
  expect(edit(root, path.join(root, "docs/README.md"))).toBe(null)
  expect(edit(root, path.join(root, "README.md"))).toBe(null)
})

test("D5: 設定でパスを変更した正本は変更後のパスが deny される", () => {
  const root = project(
    '{"version":1,"paths":{"architecture":"internal/ARCH.md","gotchas":"internal/GOT.md"}}'
  )
  expect(
    write(root, path.join(root, "internal/ARCH.md"))?.permissionDecision
  ).toBe("deny")
  expect(
    write(root, path.join(root, "internal/GOT.md"))?.permissionDecision
  ).toBe("deny")
  // 既定パスはもはや正本ではないので素通しする。
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md"))).toBe(null)
  expect(write(root, path.join(root, "docs/GOTCHAS.md"))).toBe(null)
})

test("D6: 相対パス指定は cwd 基準で解決してから判定され deny される", () => {
  const root = project()
  expect(write(root, "docs/GOTCHAS.md")?.permissionDecision).toBe("deny")
  expect(write(root, "./docs/ARCHITECTURE.md")?.permissionDecision).toBe("deny")
  // cwd がサブディレクトリでも、そこからの相対で正本に届けば deny。
  const sub = path.join(root, "sub")
  fs.mkdirSync(sub, { recursive: true })
  expect(write(sub, "../docs/GOTCHAS.md")?.permissionDecision).toBe("deny")
})

test("D7: シンボリックリンク経由の書き込みは realpath 解決後に一致し deny される", () => {
  const root = project()
  fs.writeFileSync(path.join(root, "docs/GOTCHAS.md"), "# GOTCHAS\n")

  // (a) ディレクトリのシンボリックリンク越し。
  const linkDir = path.join(root, "link-docs")
  fs.symlinkSync(path.join(root, "docs"), linkDir, "dir")
  expect(
    write(root, path.join(linkDir, "GOTCHAS.md"))?.permissionDecision
  ).toBe("deny")

  // (b) ファイル自体のシンボリックリンク越し。
  const alias = path.join(root, "alias.md")
  fs.symlinkSync(path.join(root, "docs/GOTCHAS.md"), alias)
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
  const root = project()
  fs.mkdirSync(path.join(root, "real"), { recursive: true })
  // (a) 相対リンク。リンク自身のディレクトリ基準で解決される。
  fs.symlinkSync("../real/GOTCHAS.md", path.join(root, "docs/GOTCHAS.md"))
  // (b) 絶対リンク。
  fs.symlinkSync(
    path.join(root, "real/ARCH.md"),
    path.join(root, "docs/ARCHITECTURE.md")
  )
  // 前提: リンク先はどちらも未作成(存在すると realpath が効いてしまい検証にならない)。
  expect(fs.existsSync(path.join(root, "real/GOTCHAS.md"))).toBe(false)
  expect(fs.existsSync(path.join(root, "real/ARCH.md"))).toBe(false)

  expect(
    write(root, path.join(root, "real/GOTCHAS.md"))?.permissionDecision
  ).toBe("deny")
  expect(write(root, path.join(root, "real/ARCH.md"))?.permissionDecision).toBe(
    "deny"
  )
  // 正本パスそのものへの Write は引き続き deny。
  expect(
    write(root, path.join(root, "docs/GOTCHAS.md"))?.permissionDecision
  ).toBe("deny")
  // リンク先と同じディレクトリの別ファイルは素通し(部分一致・前方一致はしない)。
  expect(write(root, path.join(root, "real/OTHER.md"))).toBe(null)
  expect(write(root, path.join(root, "real/GOTCHAS.md.bak"))).toBe(null)
})

test("D7c: 正本が 2 段の dangling symlink でも最終的なリンク先が deny される", () => {
  const root = project()
  fs.mkdirSync(path.join(root, "real"), { recursive: true })
  // docs/GOTCHAS.md -> hop.md -> real/GOTCHAS.md(実体は未作成)
  fs.symlinkSync("../hop.md", path.join(root, "docs/GOTCHAS.md"))
  fs.symlinkSync("real/GOTCHAS.md", path.join(root, "hop.md"))
  expect(fs.existsSync(path.join(root, "real/GOTCHAS.md"))).toBe(false)

  expect(
    write(root, path.join(root, "real/GOTCHAS.md"))?.permissionDecision
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
  fs.symlinkSync("../loop-a.md", path.join(root, "docs/GOTCHAS.md"))

  // 辿り切れないので実体を確定できない。停止も例外も起こさず素通しへ倒す。
  expect(write(root, path.join(root, "loop-a.md"))).toBe(null)
  expect(write(root, path.join(root, "loop-b.md"))).toBe(null)
  // 循環していない側の判定は壊れない。
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
      write(root, path.join(root, "docs/gotchas.MD"))?.permissionDecision
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
    write(root, path.join(root, "docs/../docs/./GOTCHAS.md"))
      ?.permissionDecision
  ).toBe("deny")
  expect(
    write(root, `${root}/./sub/../docs/ARCHITECTURE.md`)?.permissionDecision
  ).toBe("deny")
})

test("D10: 区切り文字が \\ のパスは正規化後に一致し deny される", () => {
  const root = project()
  expect(write(root, `${root}\\docs\\GOTCHAS.md`)?.permissionDecision).toBe(
    "deny"
  )
  expect(write(root, "docs\\ARCHITECTURE.md")?.permissionDecision).toBe("deny")
})

test("D11: 正本と似た名前(.bak / .orig)は素通し(前方一致・部分一致はしない)", () => {
  const root = project()
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md.bak"))).toBe(null)
  expect(write(root, path.join(root, "docs/ARCHITECTURE.md.orig"))).toBe(null)
  expect(write(root, path.join(root, "docs/GOTCHAS.md.bak"))).toBe(null)
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
      edit(root, path.join(root, "docs/GOTCHAS.md"))?.permissionDecision
    ).toBe("deny")
    expect(write(root, path.join(root, "src/index.ts"))).toBe(null)
  }
})

test("D13: 内部エラーは素通し(フェイルオープン。codiel の guard-write と逆)", () => {
  const root = project()

  // 設定解決を意図的に失敗させる。cwd が文字列でないと loadConfig 内の
  // findDocRoot → path.resolve が TypeError を投げ、既定値へのフォールバックも
  // path.join で再度投げる。hook 側の catch がそれを素通しへ倒すことを確認する。
  expect(edit(12345, path.join(root, "docs/GOTCHAS.md"))).toBe(null)
  expect(edit({ nested: true }, path.join(root, "docs/GOTCHAS.md"))).toBe(null)

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
      paths: { gotchas: relative.normalize("NFC") }
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
      paths: { gotchas: relative.normalize("NFD") }
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
        tool_input: { file_path: path.join(root, "docs/GOTCHAS.md") }
      })
    })
  ).not.toThrow()
  expect(() => runTs(HOOK, [], { input: "壊れた入力" })).not.toThrow()
})
