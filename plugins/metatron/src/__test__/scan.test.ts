// scan.ts の検証。
// ケース ID は metatron 設計書 §13-1 の「scan.ts / CLI 統合」の表に対応する。
// S5 / S6 は CLI 統合テストのため、このファイルでは扱わない。
// 後半は §9-3 の乖離候補(diffArchitecture)の検証。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import {
  ARCHITECTURE_SECTIONS,
  type DiffFinding,
  type DiffFindingKind,
  diffArchitecture,
  type ScanResult,
  scan
} from "../lib/scan.js"

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
function mkTmp(): string {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-scan-"))
  const dir = fs.realpathSync(raw)
  tmpDirs.push(dir)
  return dir
}

function write(root: string, rel: string, body: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

function writeJson(root: string, rel: string, value: unknown): void {
  write(root, rel, `${JSON.stringify(value, null, 2)}\n`)
}

function treePaths(result: ScanResult): string[] {
  return result.tree.map((entry) => entry.path)
}

function subjectsOf(findings: DiffFinding[], kind: DiffFindingKind): string[] {
  return findings.filter((f) => f.kind === kind).map((f) => f.subject)
}

// ---------------------------------------------------------------------------
// S1: パッケージマネージャの判定
// ---------------------------------------------------------------------------

test("S1: pnpm-lock.yaml → pnpm", () => {
  const dir = mkTmp()
  write(dir, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
  writeJson(dir, "package.json", { name: "x" })

  const result = scan(dir, { root: dir })

  expect(result.packageManager.name).toBe("pnpm")
  expect(result.packageManager.lockfiles).toEqual(["pnpm-lock.yaml"])
  expect(result.warnings).toEqual([])
})

test("S1: package-lock.json → npm", () => {
  const dir = mkTmp()
  write(dir, "package-lock.json", "{}\n")

  const result = scan(dir, { root: dir })

  expect(result.packageManager.name).toBe("npm")
  expect(result.packageManager.lockfiles).toEqual(["package-lock.json"])
})

test("S1: yarn.lock → yarn", () => {
  const dir = mkTmp()
  write(dir, "yarn.lock", "# yarn lockfile v1\n")

  const result = scan(dir, { root: dir })

  expect(result.packageManager.name).toBe("yarn")
})

test("S1: lockfile が無ければ null(エラーにしない)", () => {
  const dir = mkTmp()
  writeJson(dir, "package.json", { name: "x" })

  const result = scan(dir, { root: dir })

  expect(result.packageManager.name).toBeNull()
  expect(result.packageManager.lockfiles).toEqual([])
})

test("S1: lockfile が複数あれば優先順位の先頭を採り、警告を残す", () => {
  const dir = mkTmp()
  write(dir, "pnpm-lock.yaml", "")
  write(dir, "package-lock.json", "{}")

  const result = scan(dir, { root: dir })

  expect(result.packageManager.name).toBe("pnpm")
  expect(result.packageManager.lockfiles).toEqual([
    "pnpm-lock.yaml",
    "package-lock.json"
  ])
  expect(result.warnings.length).toBe(1)
})

test("S1: packageManager フィールドも事実として返す", () => {
  const dir = mkTmp()
  write(dir, "pnpm-lock.yaml", "")
  writeJson(dir, "package.json", { packageManager: "pnpm@11.8.0" })

  const result = scan(dir, { root: dir })

  expect(result.packageManager.packageManagerField).toBe("pnpm@11.8.0")
})

// ---------------------------------------------------------------------------
// S2: コマンド候補の抽出
// ---------------------------------------------------------------------------

test("S2: scripts から test / lint / build / typecheck / e2e が拾える", () => {
  const dir = mkTmp()
  write(dir, "pnpm-lock.yaml", "")
  writeJson(dir, "package.json", {
    scripts: {
      test: "vitest",
      lint: "biome check .",
      build: "tsx build.ts",
      typecheck: "tsc --noEmit",
      "test:e2e": "playwright test",
      dev: "vite"
    }
  })

  const result = scan(dir, { root: dir })
  const byScript = new Map(result.commands.map((c) => [c.script, c]))

  expect(byScript.get("test")?.kind).toBe("test")
  expect(byScript.get("lint")?.kind).toBe("lint")
  expect(byScript.get("build")?.kind).toBe("build")
  expect(byScript.get("typecheck")?.kind).toBe("typecheck")
  // `test:e2e` は test より e2e を優先する。
  expect(byScript.get("test:e2e")?.kind).toBe("e2e")
  // 該当しないキーは候補にしない。
  expect(byScript.has("dev")).toBe(false)
  // scripts 全件は別に返す(事実として落とさない)。
  expect(result.scripts.map((s) => s.name)).toContain("dev")
})

test("S2: 実行形はパッケージマネージャを前置する", () => {
  const dir = mkTmp()
  write(dir, "pnpm-lock.yaml", "")
  writeJson(dir, "package.json", { scripts: { test: "vitest" } })

  const result = scan(dir, { root: dir })

  expect(result.commands[0]?.invocation).toBe("pnpm run test")
})

test("S2: パッケージマネージャが判らなければ実行形は null", () => {
  const dir = mkTmp()
  writeJson(dir, "package.json", { scripts: { test: "vitest" } })

  const result = scan(dir, { root: dir })

  expect(result.commands[0]?.invocation).toBeNull()
})

test("S2: 壊れた package.json は例外にせず警告にする", () => {
  const dir = mkTmp()
  write(dir, "package.json", "{ this is not json")

  const result = scan(dir, { root: dir })

  expect(result.commands).toEqual([])
  expect(result.dependencies.source).toBeNull()
  expect(result.warnings.some((w) => w.includes("package.json"))).toBe(true)
})

// ---------------------------------------------------------------------------
// S3: ツリーの除外
// ---------------------------------------------------------------------------

test("S3: node_modules / .git / ビルド出力がツリーから除外される", () => {
  const dir = mkTmp()
  write(dir, "node_modules/left-pad/index.js", "")
  write(dir, ".git/config", "")
  write(dir, "dist/bundle.js", "")
  write(dir, "coverage/lcov.info", "")
  write(dir, "src/index.ts", "")
  write(dir, "README.md", "# x\n")

  const result = scan(dir, { root: dir })
  const paths = treePaths(result)

  expect(paths).toContain("src")
  expect(paths).toContain("src/index.ts")
  expect(paths).toContain("README.md")
  for (const excluded of ["node_modules", ".git", "dist", "coverage"]) {
    expect(
      paths.some((p) => p === excluded || p.startsWith(`${excluded}/`))
    ).toBe(false)
  }
  expect(result.files.some((f) => f.startsWith("node_modules/"))).toBe(false)
  expect(result.fileCount).toBe(2)
})

test("S3: ツリーの深さは 3 まで(既定)", () => {
  const dir = mkTmp()
  write(dir, "a/b/c/d/deep.ts", "")

  const result = scan(dir, { root: dir })
  const paths = treePaths(result)

  expect(paths).toContain("a/b/c")
  expect(paths).not.toContain("a/b/c/d")
  // ツリーに載らなくてもファイル一覧と件数には反映される。
  expect(result.files).toContain("a/b/c/d/deep.ts")
  expect(result.fileCount).toBe(1)
})

// ---------------------------------------------------------------------------
// S4: 空ディレクトリ / 異常環境
// ---------------------------------------------------------------------------

test("S4: 空ディレクトリで例外なく空の結果を返す", () => {
  const dir = mkTmp()

  const result = scan(dir, { root: dir })

  expect(result.root).toBe(dir)
  expect(result.tree).toEqual([])
  expect(result.files).toEqual([])
  expect(result.fileCount).toBe(0)
  expect(result.languages).toEqual([])
  expect(result.dependencies.dependencies).toEqual([])
  expect(result.dependencies.devDependencies).toEqual([])
  expect(result.scripts).toEqual([])
  expect(result.commands).toEqual([])
  expect(result.domainCandidates).toEqual([])
  expect(result.documents).toEqual([])
  expect(result.packageManager.name).toBeNull()
  expect(result.truncation.notes).toEqual([])
  expect(result.warnings).toEqual([])
})

test("S4: 存在しないディレクトリでも例外を投げない", () => {
  const dir = path.join(mkTmp(), "missing")

  const result = scan(dir, { root: dir })

  expect(result.tree).toEqual([])
  expect(result.warnings.length).toBeGreaterThan(0)
})

test("S4: 基準ディレクトリを省略しても findDocRoot で解決する", () => {
  const dir = mkTmp()
  write(dir, "src/index.ts", "")

  const result = scan(dir)

  expect(result.root).toBe(dir)
  expect(result.files).toEqual(["src/index.ts"])
})

// ---------------------------------------------------------------------------
// 打ち切り上限
// ---------------------------------------------------------------------------

test("打ち切り上限に当たったことが結果に含まれる", () => {
  const dir = mkTmp()
  for (let i = 0; i < 6; i++) write(dir, `src/f${String(i)}.ts`, "")

  const result = scan(dir, { root: dir, limits: { maxFiles: 2 } })

  expect(result.files.length).toBe(2)
  expect(result.truncation.files).toBe(true)
  expect(result.truncation.notes.length).toBe(1)
  // 打ち切っても総数は事実として返す。
  expect(result.fileCount).toBe(6)
})

test("テストファイル検出の打ち切りが結果に含まれる", () => {
  const dir = mkTmp()
  for (let i = 0; i < 5; i++) write(dir, `src/a${String(i)}.test.ts`, "")

  const result = scan(dir, { root: dir, limits: { maxTestFiles: 2 } })

  expect(result.truncation.testFiles).toBe(true)
  expect(
    result.truncation.notes.some((n) => n.includes("テストファイル"))
  ).toBe(true)
})

// ---------------------------------------------------------------------------
// 言語・依存・テストフレームワーク・ドメイン候補・既存ドキュメント
// ---------------------------------------------------------------------------

test("言語とランタイムを package.json / tsconfig.json / go.mod から返す", () => {
  const dir = mkTmp()
  writeJson(dir, "package.json", {
    type: "module",
    engines: { node: ">=26" }
  })
  write(
    dir,
    "tsconfig.json",
    '{\n  // comment\n  "compilerOptions": { "strict": true, "target": "esnext" }\n}\n'
  )
  write(dir, "go.mod", "module example.com/x\n\ngo 1.22\n")

  const result = scan(dir, { root: dir })
  const byName = new Map(result.languages.map((l) => [l.name, l]))

  expect(byName.get("Node.js")?.details).toEqual({
    type: "module",
    "engines.node": ">=26"
  })
  // コメント付き tsconfig.json も読める。
  expect(byName.get("TypeScript")?.details.strict).toBe("true")
  expect(byName.get("TypeScript")?.details.target).toBe("esnext")
  expect(byName.get("Go")?.details).toEqual({
    module: "example.com/x",
    go: "1.22"
  })
})

test("dependencies と devDependencies を分けて返す", () => {
  const dir = mkTmp()
  writeJson(dir, "package.json", {
    dependencies: { zod: "^3.0.0" },
    devDependencies: { vitest: "^4.0.0", esbuild: "^0.25.0" }
  })

  const result = scan(dir, { root: dir })

  expect(result.dependencies.dependencies).toEqual([
    { name: "zod", version: "^3.0.0" }
  ])
  expect(result.dependencies.devDependencies.map((d) => d.name)).toEqual([
    "esbuild",
    "vitest"
  ])
})

test("テストフレームワークを設定ファイル・依存・命名パターンから返す", () => {
  const dir = mkTmp()
  write(dir, "vitest.config.ts", "export default {}\n")
  writeJson(dir, "package.json", { devDependencies: { vitest: "^4.0.0" } })
  write(dir, "src/__test__/a.test.ts", "")
  write(dir, "src/__test__/b.test.ts", "")
  write(dir, "src/c.spec.ts", "")

  const result = scan(dir, { root: dir })

  expect(result.testFrameworks.configs).toEqual([
    { framework: "vitest", path: "vitest.config.ts" }
  ])
  expect(result.testFrameworks.fromDependencies).toEqual(["vitest"])
  expect(result.testFrameworks.filePatterns[0]).toEqual({
    pattern: "*.test.ts",
    count: 2,
    examples: ["src/__test__/a.test.ts", "src/__test__/b.test.ts"]
  })
  expect(result.testFrameworks.filePatterns.map((p) => p.pattern)).toContain(
    "*.spec.ts"
  )
  expect(result.testFrameworks.directories).toContain("src/__test__")
})

test("ドメイン候補はトップレベルと src/ 直下、各配下のファイル数つき", () => {
  const dir = mkTmp()
  write(dir, "src/app/page.ts", "")
  write(dir, "src/app/layout.ts", "")
  write(dir, "src/server/api.ts", "")
  write(dir, "prisma/schema.prisma", "")
  write(dir, "docs/deep/nested/note.md", "# n\n")
  write(dir, "README.md", "# r\n")

  const result = scan(dir, { root: dir })
  const byPath = new Map(result.domainCandidates.map((c) => [c.path, c]))

  // 候補はトップレベルと src/ 直下だけ。docs/deep は候補にしない。
  expect([...byPath.keys()]).toEqual([
    "docs",
    "prisma",
    "src",
    "src/app",
    "src/server"
  ])
  expect(byPath.get("src")?.fileCount).toBe(3)
  expect(byPath.get("src/app")?.fileCount).toBe(2)
  expect(byPath.get("prisma")?.name).toBe("prisma")
  // 深い階層のファイルもトップレベルの件数には数える。
  expect(byPath.get("docs")?.fileCount).toBe(1)
  expect(byPath.get("src/app")?.samplePaths).toEqual([
    "src/app/layout.ts",
    "src/app/page.ts"
  ])
})

test("既存ドキュメントの見出しを返す(フェンス内の ## を見出しにしない)", () => {
  const dir = mkTmp()
  write(
    dir,
    "README.md",
    "# タイトル\n\n## 使い方\n\n```md\n## これは見出しではない\n```\n\n## 開発\n"
  )
  write(dir, "CLAUDE.md", "# 指示\n\n## 規約\n")
  write(dir, "docs/design.md", "# 設計\n")

  const result = scan(dir, { root: dir })
  const byPath = new Map(result.documents.map((d) => [d.path, d]))

  expect(byPath.get("README.md")?.headings).toEqual([
    { level: 1, text: "タイトル" },
    { level: 2, text: "使い方" },
    { level: 2, text: "開発" }
  ])
  expect(byPath.get("CLAUDE.md")?.headings.length).toBe(2)
  expect(byPath.get("docs/design.md")?.headings).toEqual([
    { level: 1, text: "設計" }
  ])
})

// ---------------------------------------------------------------------------
// diffArchitecture(設計書 §9-3)
// ---------------------------------------------------------------------------

function scanFixture(): { dir: string; result: ScanResult } {
  const dir = mkTmp()
  write(dir, "pnpm-lock.yaml", "")
  writeJson(dir, "package.json", {
    scripts: { test: "vitest", lint: "biome check .", build: "tsx build.ts" },
    dependencies: { zod: "^3.0.0" },
    devDependencies: { vitest: "^4.0.0", esbuild: "^0.25.0" }
  })
  write(dir, "src/app/page.ts", "")
  write(dir, "src/server/api.ts", "")
  write(dir, "prisma/schema.prisma", "")
  return { dir, result: scan(dir, { root: dir }) }
}

test("技術スタックの追加: package.json の依存が節に無い", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: { 技術スタック: "| 名前 | 用途 |\n| `zod` | 検証 |\n" }
  })

  const added = subjectsOf(diff.findings, "tech_stack_added")
  expect(added).toContain("vitest")
  expect(added).toContain("esbuild")
  expect(added).not.toContain("zod")
})

test("技術スタックの削除: 節に書かれた依存が package.json に無い", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: [
      {
        heading: "技術スタック",
        body: "`zod` / `vitest` / `esbuild` / `left-pad` を使う。\n"
      }
    ]
  })

  const removed = subjectsOf(diff.findings, "tech_stack_removed")
  expect(removed).toEqual(["left-pad"])
  expect(subjectsOf(diff.findings, "tech_stack_added")).toEqual([])
})

test("技術スタック: フェンス内の inline code は削除候補にしない", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: {
      技術スタック: "`zod` `vitest` `esbuild`\n\n```\n`left-pad`\n```\n"
    }
  })

  expect(subjectsOf(diff.findings, "tech_stack_removed")).toEqual([])
})

test("コマンドの変更: 節に無い scripts と、scripts に無いコマンドの両方を返す", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: {
      コマンド定義:
        "| 用途 | コマンド |\n| test | `pnpm run test` |\n| 型 | `pnpm run typecheck` |\n"
    }
  })

  const added = subjectsOf(diff.findings, "command_added")
  expect(added).toEqual(["build", "lint"])
  expect(subjectsOf(diff.findings, "command_removed")).toEqual(["typecheck"])
})

test("コマンドの変更: パッケージマネージャのサブコマンドは削除候補にしない", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: {
      コマンド定義:
        "`pnpm install` / `pnpm run test` / `pnpm run lint` / `pnpm run build`\n"
    }
  })

  expect(subjectsOf(diff.findings, "command_removed")).toEqual([])
  expect(subjectsOf(diff.findings, "command_added")).toEqual([])
})

test("ドメインマップの穴: どの glob にも一致しないソースディレクトリ", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: { ドメインマップ: "" },
    domains: { frontend: ["src/app/**"] }
  })

  const gaps = subjectsOf(diff.findings, "domain_gap")
  expect(gaps).toContain("src/server")
  expect(gaps).toContain("prisma")
  expect(gaps).not.toContain("src/app")
  // src 直下のいずれかが一致していれば src 自体は穴ではない。
  expect(gaps).not.toContain("src")
})

test("ドメインマップの死んだ glob: どのファイルにも一致しない", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: { ドメインマップ: "" },
    domains: {
      frontend: ["src/app/**"],
      backend: ["src/server/**"],
      data: ["prisma/**", "db/**"]
    }
  })

  expect(subjectsOf(diff.findings, "domain_dead_glob")).toEqual(["db/**"])
})

test("ドメインマップ: domains が渡されなければ検出せず理由を返す", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: { ドメインマップ: "" }
  })

  expect(subjectsOf(diff.findings, "domain_gap")).toEqual([])
  expect(subjectsOf(diff.findings, "domain_dead_glob")).toEqual([])
  expect(diff.skipped.some((s) => s.includes("metatron:domains"))).toBe(true)
})

test("ドメインマップ: ファイル走査が打ち切られたら死んだ glob を検出しない", () => {
  const dir = mkTmp()
  write(dir, "src/app/page.ts", "")
  write(dir, "src/app/layout.ts", "")
  const result = scan(dir, { root: dir, limits: { maxFiles: 1 } })

  const diff = diffArchitecture({
    scan: result,
    sections: { ドメインマップ: "" },
    domains: { data: ["db/**"] }
  })

  expect(subjectsOf(diff.findings, "domain_dead_glob")).toEqual([])
  expect(diff.skipped.some((s) => s.includes("死んだ glob"))).toBe(true)
})

test("セクションの欠落: 10 セクションのうち存在しないものを返す", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: { ドメインマップ: "", 技術スタック: "`zod` `vitest` `esbuild`" }
  })

  const missing = subjectsOf(diff.findings, "section_missing")
  expect(missing).not.toContain("ドメインマップ")
  expect(missing).not.toContain("技術スタック")
  expect(missing.length).toBe(ARCHITECTURE_SECTIONS.length - 2)
  expect(missing).toContain("ADR 一覧")
  expect(missing).toContain("システム概要")
})

test("セクションの欠落: ARCHITECTURE が無ければ 10 セクションすべて", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: [],
    architectureExists: false
  })

  expect(subjectsOf(diff.findings, "section_missing").length).toBe(
    ARCHITECTURE_SECTIONS.length
  )
})

test("ディレクトリ構成: 未記載のトップレベルと実在しない記述を返す", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    sections: {
      ディレクトリ構成と責務: "- src: 実装\n- `src/legacy`: 旧実装\n"
    }
  })

  expect(subjectsOf(diff.findings, "directory_undocumented")).toEqual([
    "prisma"
  ])
  expect(subjectsOf(diff.findings, "directory_stale")).toEqual(["src/legacy"])
})

test("決定的に検出できない項目は理由つきで skipped に入る", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({ scan: result, sections: {} })

  expect(diff.skipped.some((s) => s.includes("保護パス"))).toBe(true)
  expect(diff.skipped.some((s) => s.includes("ADR"))).toBe(true)
})

test("diffArchitecture は壊れた入力でも例外を投げない", () => {
  const { result } = scanFixture()

  const diff = diffArchitecture({
    scan: result,
    // biome-ignore lint/suspicious/noExplicitAny: 契約外の入力を渡す検証
    sections: [null, { heading: "", body: 1 }] as any,
    // biome-ignore lint/suspicious/noExplicitAny: 契約外の入力を渡す検証
    domains: { frontend: "src/**" } as any
  })

  expect(diff.warnings).toEqual([])
  expect(subjectsOf(diff.findings, "section_missing").length).toBe(
    ARCHITECTURE_SECTIONS.length
  )
})
