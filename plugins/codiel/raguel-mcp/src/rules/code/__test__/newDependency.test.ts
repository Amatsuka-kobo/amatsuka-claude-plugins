import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { newDependencyRule } from "../newDependency.js"
import { fileDiff } from "./helpers/diff.js"

function check(content: string) {
  return newDependencyRule.check(makeArtifact({ content }), makeCtx())
}

/** hunk にコンテキスト行を持つ package.json の diff */
function packageJsonHunk(lines: string[]): string {
  const old = lines.filter((l) => !l.startsWith("+")).length
  const neu = lines.filter((l) => !l.startsWith("-")).length
  return [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    `@@ -1,${old} +1,${neu} @@`,
    ...lines
  ].join("\n")
}

describe("newDependencyRule の package.json(所見 A10)", () => {
  it("dependencies のブロックの中の追加を出す", () => {
    const findings = check(
      packageJsonHunk([
        '   "dependencies": {',
        '+    "lodash": "^4.17.21",',
        '     "zod": "^4.0.0"',
        "   },"
      ])
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
    expect(findings[0].message).toContain("lodash")
    expect(findings[0].evidence?.line).toBe(6)
  })

  it.each([
    "devDependencies",
    "peerDependencies",
    "optionalDependencies"
  ])("%s のブロックも見る", (block) => {
    const findings = check(
      packageJsonHunk([`   "${block}": {`, '+    "vitest": "^4.0.0"', "   }"])
    )
    expect(findings).toHaveLength(1)
  })

  it("scripts のブロックの追加は出さない", () => {
    const findings = check(
      packageJsonHunk([
        '   "scripts": {',
        '     "build": "tsc",',
        '+    "lint": "biome check ."',
        "   },"
      ])
    )
    expect(findings).toEqual([])
  })

  it("版の更新(削除行と同じ名前)は出さない", () => {
    const findings = check(
      packageJsonHunk([
        '   "dependencies": {',
        '-    "zod": "^3.0.0"',
        '+    "zod": "^4.0.0"',
        "   }"
      ])
    )
    expect(findings).toEqual([])
  })

  it("トップレベルの version の更新は出さない", () => {
    const findings = check(
      packageJsonHunk([
        '   "name": "x",',
        '-  "version": "0.1.0",',
        '+  "version": "0.2.0",',
        '   "private": true,'
      ])
    )
    expect(findings).toEqual([])
  })

  it("見出しが hunk の外にあるときは、値が版の指定に見える行だけを出す", () => {
    const findings = check(
      packageJsonHunk([
        '     "a": "^1.0.0",',
        '+    "lodash": "^4.17.21",',
        '+    "lint": "biome check ."'
      ])
    )
    expect(findings.map((f) => f.message)).toEqual([
      "依存パッケージの追加を検出しました: package.json(lodash)"
    ])
  })
})

describe("newDependencyRule のほかのマニフェスト", () => {
  it("pnpm-lock.yaml へのパッケージの追加を出し、任意のキーは出さない", () => {
    const findings = check(
      fileDiff("pnpm-lock.yaml", ["  lodash@4.17.21:", "    resolution:"])
    )
    expect(findings).toHaveLength(1)
  })

  it("requirements.txt・Cargo.toml・go.mod への追加を出す", () => {
    expect(
      check(fileDiff("requirements.txt", ["requests==2.31.0"]))
    ).toHaveLength(1)
    expect(check(fileDiff("Cargo.toml", ['serde = "1.0"']))).toHaveLength(1)
    expect(
      check(fileDiff("go.mod", ["github.com/pkg/errors v0.9.1"]))
    ).toHaveLength(1)
  })

  it("requirements.txt の版の更新は出さない", () => {
    const findings = check(
      fileDiff("requirements.txt", ["requests==2.32.0"], ["requests==2.31.0"])
    )
    expect(findings).toEqual([])
  })

  it("Cargo.toml の [package] のメタ情報の変更では出さない", () => {
    expect(check(fileDiff("Cargo.toml", ['edition = "2021"']))).toEqual([])
  })

  it(".gitmodules への submodule の追加を出し、既存の名前の再掲は出さない", () => {
    const findings = check(
      fileDiff(".gitmodules", [
        '[submodule "vendor/lib"]',
        "\tpath = vendor/lib",
        "\turl = https://example.invalid/lib.git"
      ])
    )
    expect(findings.map((f) => f.message)).toEqual([
      "依存パッケージの追加を検出しました: .gitmodules(vendor/lib)"
    ])
    expect(
      check(
        fileDiff(
          ".gitmodules",
          ['[submodule "vendor/lib"]', "\turl = https://example.invalid/b.git"],
          ['[submodule "vendor/lib"]', "\turl = https://example.invalid/a.git"]
        )
      )
    ).toEqual([])
  })

  it("submodule の参照先の変更(Subproject commit の更新)を、パスを名前にして出す", () => {
    const findings = check(
      fileDiff(
        "vendor/lib",
        [`Subproject commit ${"b".repeat(40)}`],
        [`Subproject commit ${"a".repeat(40)}`]
      )
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
    expect(findings[0].message).toContain("vendor/lib")
  })

  it("依存に無関係なファイルでは出さない", () => {
    expect(check(fileDiff("src/index.ts", ["const x = 1"]))).toEqual([])
  })
})
