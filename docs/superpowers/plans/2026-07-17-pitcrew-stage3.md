# Pitcrew Stage 3(/pitcrew:config + 設定反映)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 対話式セットアップコマンド `/pitcrew:config` を追加し、設定(捕捉対象・成果物 glob・テストコマンド追加・注入タイミング・ビューア/テーマ/ポート)を `.claude/pitcrew.local.md` に保存して、捕捉層・注入層の hooks がそれを機械的に読んで挙動を変えられるようにする。

**Architecture:** 設定の読み取りは新規の `src/lib/config.ts` に集約する。hooks は短命プロセスなので起動のたびに設定ファイルを読み直す(キャッシュ不要・保存した瞬間から次の hook 起動に反映)。パースは Stage 1 の自前 frontmatter パーサを再利用し、壊れた値・欠損はすべて既定値へフォールバックする(フェイルオープンの一貫)。`/pitcrew:config` コマンド自体は Markdown コマンドで、メインセッションの AskUserQuestion による対話でファイルを書く(LLM が関与するのはこの対話だけで、hooks 側は機械的処理のまま)。

**Tech Stack:** TypeScript(strict / ESM)→ esbuild バンドル(`.mjs`)、vitest、Node >= 26 標準ライブラリのみ(glob 判定は `path.matchesGlob`)、git CLI。Stage 1-2 の共有ライブラリ(`src/lib/`)を再利用・拡張する。

**Design doc:** `docs/superpowers/specs/2026-07-16-pitcrew-design.md`(§4 捕捉対象の config 選択・§7 `/pitcrew:config`・§9 エラーハンドリングが Stage 3 の対象)

## Global Constraints

- **Anthropic API 不使用・LLM 呼び出し禁止**: hooks・スクリプトは機械的処理のみ。LLM が関与するのは `/pitcrew:config` の対話(メインセッション)だけ(リポジトリ共通制約)
- **フェイルオープン**: hooks は全経路で、失敗時に何も出力せず exit 0。設定ファイルが無い・壊れている場合は既定値で動作する(Stage 1-2 と同一挙動)。例外は `.pitcrew/log/errors.log` に追記して黙って続行
- **外部ランタイム依存ゼロ**: 依存は `node:*` モジュールと git CLI のみ。glob 判定は `path.matchesGlob`(Node 26 で利用可能なことを確認済み)。プラグイン package.json に依存を追加しない
- **バンドル出力を git 管理**: `src/` を変更したら `pnpm build` を実行し `scripts/*.mjs` の差分もコミット(利用者はビルド不要)
- **esbuild 設定**: 既存 `build.ts` のまま(エントリ追加なし — Stage 3 は新規 hook を作らない)
- **テスト**: vitest。`plugins/pitcrew/src/**/__test__/**/*.test.ts` に配置。TDD(失敗するテスト → 実装 → パス → コミット)。root の testTimeout は 20s
- **lint/format**: biome(double quote / semicolons asNeeded / trailingCommas none / lineWidth 80 / インデント 2)。`scripts/` は biome 対象外
- **コードスタイル**: Stage 1-2 の既存ソースに合わせる(セミコロンなし・日本語コメントは設計書参照付き)
- **設定ファイルパス**: `.claude/pitcrew.local.md`(plugin-settings の `.local.md` パターン。YAML frontmatter はフラット key-value + インライン配列のみ — Stage 1 の `frontmatter.ts` が読める範囲)
- **設定キーと既定値**(このプラン全体で共通):
  - `viewer`: `browser | tui | files`(既定 `files`)— Stage 4-5 のビューアが消費。Stage 3 では保存のみ
  - `capture_targets`: `diff` / `artifact` / `test` の配列(既定 3 種すべて)
  - `artifact_globs`: 成果物 glob の配列(既定 `["docs/**/*.md"]`。**設定時は既定を置き換える**。設計書 §4「追加・変更できる」)。`docs/chat/**` の除外は設定によらず常に効く
  - `test_commands`: テスト・ビルド判定コマンド接頭辞の配列(**既定ホワイトリストへの追加**。設計書 §4「既定リスト+config で追加」)
  - `injection_timing`: `hybrid | turn-boundary | immediate`(既定 `hybrid`)。Stop hook の回収は全モード共通で変更しない(取り残し防止の最終防衛線。設計書 §7)
  - `theme`: `device | light | dark`(既定 `device`)— Stage 4 が消費。Stage 3 では保存のみ
  - `port`: 1〜65535 の整数(既定 `7373`)— Stage 4 が消費。Stage 3 では保存のみ
- **バージョン**: 完了時に `plugins/pitcrew/.claude-plugin/plugin.json` を `0.7.1-dev` → `0.8.0-dev` に上げる(マイナー更新・自動判断の範囲)
- **コミットメッセージ**: 既存の流儀(`feat: pitcrew ...` / `docs: pitcrew ...` の日本語 conventional commits)に合わせる

## Stage 2 からの引き継ぎ事項(このプランで解消するもの)

- `capture-rules.ts` の「config による glob / コマンド追加は Stage 3」コメント → Task 2 で実装・コメント更新
- `.gitignore` への `.pitcrew/` 追記提案 → Task 4 の `/pitcrew:config` に組み込み(このリポジトリ自体の `.gitignore` には追記済み)
- 実機確認(Stage 2 の注入層)はユーザーが完了済み(2026-07-17)

---

## File Structure

```
plugins/pitcrew/
├── commands/
│   └── config.md                          # 新規: /pitcrew:config(対話手順)
├── src/
│   ├── lib/
│   │   ├── config.ts                      # 新規: .claude/pitcrew.local.md の読み取り+既定値
│   │   ├── capture-rules.ts               # 修正: glob / 追加コマンドを引数化
│   │   └── __test__/
│   │       ├── config.test.ts             # 新規
│   │       └── capture-rules.test.ts      # 修正: 引数化のテスト追加
│   └── hooks/
│       ├── capture-subagent-stop.ts       # 修正: diff 無効時はスキップ
│       ├── capture-post-tool-use.ts       # 修正: artifact/test の有効判定+glob/コマンド反映
│       ├── inject-pre-tool-use.ts         # 修正: injection_timing の反映
│       └── __test__/
│           ├── capture-subagent-stop.test.ts   # 修正: config テスト追加
│           ├── capture-post-tool-use.test.ts   # 修正: config テスト追加
│           └── inject-pre-tool-use.test.ts     # 修正: config テスト追加
├── scripts/*.mjs                          # 再生成(pnpm build)
├── README.md                              # 修正: /pitcrew:config と設定の説明
└── .claude-plugin/plugin.json             # 修正: 0.8.0-dev
```

`inject-stop.ts` は変更しない(全モードで「残っているコメントをターン境界で全回収」が正しい挙動。設計書 §7)。

---

### Task 1: 設定読み取りライブラリ `config.ts`

**Files:**
- Create: `plugins/pitcrew/src/lib/config.ts`
- Test: `plugins/pitcrew/src/lib/__test__/config.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter(text)`(`src/lib/frontmatter.ts` — `{ data: Record<string, string | string[]>, body }` を返す。インライン配列 `[a, b]` は `string[]`、`[]` は空配列、それ以外の値は常に `string` として返る。引用符 `"..."` は外して返す。パース不能な行は黙って読み飛ばすだけで、**この関数は例外を投げない**)
- Produces: 後続タスクが使う次のエクスポート
  - `interface PitcrewConfig { viewer: "browser" | "tui" | "files"; captureTargets: { diff: boolean; artifact: boolean; test: boolean }; artifactGlobs: string[]; testCommands: string[]; injectionTiming: "hybrid" | "turn-boundary" | "immediate"; theme: "device" | "light" | "dark"; port: number }`
  - `loadConfig(projectDir: string): PitcrewConfig`
  - `configPath(projectDir: string): string`(= `<projectDir>/.claude/pitcrew.local.md`)
  - `DEFAULT_ARTIFACT_GLOBS: string[]`(= `["docs/**/*.md"]`)
  - `DEFAULT_PORT: number`(= `7373`)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/config.test.ts` を新規作成:

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  DEFAULT_ARTIFACT_GLOBS,
  DEFAULT_PORT,
  configPath,
  loadConfig
} from "../config.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-config-"))
}

function writeConfig(dir: string, frontmatter: string): void {
  const claudeDir = path.join(dir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    `---\n${frontmatter}\n---\n\n# pitcrew 設定\n`
  )
}

test("設定ファイルが無ければ全項目が既定値", () => {
  const dir = makeProject()
  try {
    const cfg = loadConfig(dir)
    expect(cfg).toEqual({
      viewer: "files",
      captureTargets: { diff: true, artifact: true, test: true },
      artifactGlobs: DEFAULT_ARTIFACT_GLOBS,
      testCommands: [],
      injectionTiming: "hybrid",
      theme: "device",
      port: DEFAULT_PORT
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("configPath は .claude/pitcrew.local.md を指す", () => {
  expect(configPath("/proj")).toBe(
    path.join("/proj", ".claude", "pitcrew.local.md")
  )
})

test("全キーを読み取れる", () => {
  const dir = makeProject()
  try {
    writeConfig(
      dir,
      [
        "viewer: browser",
        "capture_targets: [diff, test]",
        'artifact_globs: ["docs/specs/*.md", "notes/**/*.md"]',
        'test_commands: ["deno test", "bun test"]',
        "injection_timing: immediate",
        "theme: dark",
        'port: "8080"'
      ].join("\n")
    )
    const cfg = loadConfig(dir)
    expect(cfg.viewer).toBe("browser")
    expect(cfg.captureTargets).toEqual({
      diff: true,
      artifact: false,
      test: true
    })
    expect(cfg.artifactGlobs).toEqual(["docs/specs/*.md", "notes/**/*.md"])
    expect(cfg.testCommands).toEqual(["deno test", "bun test"])
    expect(cfg.injectionTiming).toBe("immediate")
    expect(cfg.theme).toBe("dark")
    expect(cfg.port).toBe(8080)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正値・未知キーは既定値へフォールバックする", () => {
  const dir = makeProject()
  try {
    writeConfig(
      dir,
      [
        "viewer: vscode",
        "injection_timing: sometimes",
        "theme: sepia",
        "port: abc",
        "unknown_key: x"
      ].join("\n")
    )
    const cfg = loadConfig(dir)
    expect(cfg.viewer).toBe("files")
    expect(cfg.injectionTiming).toBe("hybrid")
    expect(cfg.theme).toBe("device")
    expect(cfg.port).toBe(DEFAULT_PORT)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("port は 1〜65535 の範囲外なら既定値", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, 'port: "70000"')
    expect(loadConfig(dir).port).toBe(DEFAULT_PORT)
    writeConfig(dir, 'port: "0"')
    expect(loadConfig(dir).port).toBe(DEFAULT_PORT)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("capture_targets の空配列は 3 種すべて無効を意味する", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "capture_targets: []")
    expect(loadConfig(dir).captureTargets).toEqual({
      diff: false,
      artifact: false,
      test: false
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("artifact_globs の空配列は無視して既定を保つ", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "artifact_globs: []")
    expect(loadConfig(dir).artifactGlobs).toEqual(DEFAULT_ARTIFACT_GLOBS)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter が壊れていても既定値で返す(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const claudeDir = path.join(dir, ".claude")
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(
      path.join(claudeDir, "pitcrew.local.md"),
      "frontmatter なしの本文だけ\n"
    )
    expect(loadConfig(dir).injectionTiming).toBe("hybrid")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/config.test.ts`
Expected: FAIL(`../config.js` が存在しないため全件エラー)

- [ ] **Step 3: 実装を書く**

`plugins/pitcrew/src/lib/config.ts` を新規作成:

```typescript
import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"

// /pitcrew:config が書く .claude/pitcrew.local.md の読み取り(設計書 §7)。
// hooks は短命プロセスなので毎回読み直す(保存が次の hook 起動から反映される)。
// ファイルが無い・値が壊れている場合はすべて既定値に落とす(フェイルオープン。設計書 §9)。

export interface PitcrewConfig {
  viewer: "browser" | "tui" | "files"
  captureTargets: { diff: boolean; artifact: boolean; test: boolean }
  artifactGlobs: string[]
  testCommands: string[]
  injectionTiming: "hybrid" | "turn-boundary" | "immediate"
  theme: "device" | "light" | "dark"
  port: number
}

export const DEFAULT_ARTIFACT_GLOBS = ["docs/**/*.md"]
export const DEFAULT_PORT = 7373

function defaults(): PitcrewConfig {
  return {
    viewer: "files",
    captureTargets: { diff: true, artifact: true, test: true },
    artifactGlobs: [...DEFAULT_ARTIFACT_GLOBS],
    testCommands: [],
    injectionTiming: "hybrid",
    theme: "device",
    port: DEFAULT_PORT
  }
}

export function configPath(projectDir: string): string {
  return path.join(projectDir, ".claude", "pitcrew.local.md")
}

function oneOf<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[]
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function asArray(value: string | string[] | undefined): string[] | null {
  return Array.isArray(value) ? value.filter((v) => v !== "") : null
}

export function loadConfig(projectDir: string): PitcrewConfig {
  const cfg = defaults()
  let raw: string
  try {
    raw = fs.readFileSync(configPath(projectDir), "utf8")
  } catch {
    return cfg
  }
  const { data } = parseFrontmatter(raw)

  const viewer = oneOf(data.viewer, ["browser", "tui", "files"] as const)
  if (viewer) cfg.viewer = viewer

  const targets = asArray(data.capture_targets)
  if (targets)
    cfg.captureTargets = {
      diff: targets.includes("diff"),
      artifact: targets.includes("artifact"),
      test: targets.includes("test")
    }

  // 空配列は「glob 指定なし」とみなして既定を保つ(捕捉を止めたい場合は
  // capture_targets から artifact を外す)
  const globs = asArray(data.artifact_globs)
  if (globs && globs.length > 0) cfg.artifactGlobs = globs

  const commands = asArray(data.test_commands)
  if (commands) cfg.testCommands = commands

  const timing = oneOf(data.injection_timing, [
    "hybrid",
    "turn-boundary",
    "immediate"
  ] as const)
  if (timing) cfg.injectionTiming = timing

  const theme = oneOf(data.theme, ["device", "light", "dark"] as const)
  if (theme) cfg.theme = theme

  if (typeof data.port === "string" && /^\d+$/.test(data.port)) {
    const port = Number(data.port)
    if (port >= 1 && port <= 65535) cfg.port = port
  }
  return cfg
}
```

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/config.test.ts`
Expected: PASS(8 tests)

- [ ] **Step 5: lint・typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし(biome の指摘が出たら修正してから次へ)

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/lib/config.ts plugins/pitcrew/src/lib/__test__/config.test.ts
git commit -m "feat: pitcrew 設定ファイル(.claude/pitcrew.local.md)の読み取りライブラリ"
```

---

### Task 2: 捕捉層への設定反映

**Files:**
- Modify: `plugins/pitcrew/src/lib/capture-rules.ts`(`isArtifactPath` / `matchTestCommand` の引数化)
- Modify: `plugins/pitcrew/src/hooks/capture-post-tool-use.ts`(config の配線)
- Modify: `plugins/pitcrew/src/hooks/capture-subagent-stop.ts`(diff 無効時のスキップ)
- Test: `plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`(テスト追加)
- Test: `plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts`(テスト追加)
- Test: `plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`(テスト追加)

**Interfaces:**
- Consumes: Task 1 の `loadConfig(projectDir)` / `PitcrewConfig` / `DEFAULT_ARTIFACT_GLOBS`
- Produces: シグネチャ変更(後方互換のため既定引数つき)
  - `isArtifactPath(relPath: string, globs?: string[]): boolean`(既定 `DEFAULT_ARTIFACT_GLOBS`)
  - `matchTestCommand(command: string, extraPrefixes?: string[]): string | null`(既定 `[]`)

- [ ] **Step 1: capture-rules の失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/capture-rules.test.ts` の末尾に追加:

```typescript
test("isArtifactPath は glob 指定で対象を置き換えられる", () => {
  expect(isArtifactPath("notes/memo.md", ["notes/**/*.md"])).toBe(true)
  expect(isArtifactPath("docs/design.md", ["notes/**/*.md"])).toBe(false)
  expect(isArtifactPath("docs/specs/x.md", ["docs/specs/*.md"])).toBe(true)
  expect(isArtifactPath("docs/other/x.md", ["docs/specs/*.md"])).toBe(false)
})

test("glob 指定でも docs/chat/ の除外は常に効く", () => {
  expect(isArtifactPath("docs/chat/2026/x.md", ["docs/**/*.md"])).toBe(false)
  expect(isArtifactPath("docs/chat/2026/x.md", ["**/*.md"])).toBe(false)
})

test("matchTestCommand は追加接頭辞にもマッチする", () => {
  expect(matchTestCommand("deno test", ["deno test"])).toBe("deno test")
  expect(matchTestCommand("deno test --allow-read x.ts", ["deno test"])).toBe(
    "deno test"
  )
  expect(matchTestCommand("deno test", [])).toBeNull()
  // 既定ホワイトリストは追加指定があっても生きている
  expect(matchTestCommand("pnpm test", ["deno test"])).toBe("pnpm test")
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
Expected: FAIL(追加した 3 テストが「引数が多い」型エラーまたはアサーション失敗)

- [ ] **Step 3: capture-rules.ts を修正する**

`isArtifactPath` を次で置き換え(import に `DEFAULT_ARTIFACT_GLOBS` を追加):

```typescript
import fs from "node:fs"
import path from "node:path"
import { DEFAULT_ARTIFACT_GLOBS } from "./config.js"
import { parseFrontmatter } from "./frontmatter.js"
import { pitcrewDir } from "./run.js"

// 捕捉対象の判定ルール(設計書 §4)。glob / コマンド追加は config
// (.claude/pitcrew.local.md)から hooks が渡す。未指定なら既定値。

// 成果物ファイルの既定対象: docs/**/*.md(config で置き換え可能)。
// docs/chat/ は chat 記録(閲覧制限あり・レビュー対象外)なので設定によらず除外する。
export function isArtifactPath(
  relPath: string,
  globs: string[] = DEFAULT_ARTIFACT_GLOBS
): boolean {
  const p = relPath.replaceAll("\\", "/")
  if (p.startsWith("docs/chat/")) return false
  return globs.some((g) => path.matchesGlob(p, g))
}
```

`matchTestCommand` を次で置き換え(`TEST_COMMAND_PREFIXES` 定義はそのまま):

```typescript
export function matchTestCommand(
  command: string,
  extraPrefixes: string[] = []
): string | null {
  const trimmed = command.trimStart()
  for (const prefix of [...TEST_COMMAND_PREFIXES, ...extraPrefixes]) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) return prefix
  }
  return null
}
```

`TEST_COMMAND_PREFIXES` 直前のコメント「config による追加は Stage 3。」の行は
「config の `test_commands` が追加分として渡される。」に書き換える。

- [ ] **Step 4: capture-rules のテストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/capture-rules.test.ts`
Expected: PASS(既存テストも glob 既定値で従来どおり通る)

- [ ] **Step 5: hooks の失敗するテストを書く**

`plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts` に、既存の import はそのままでヘルパー 1 つとテスト 4 つを追加:

```typescript
function writeConfig(dir: string, frontmatter: string): void {
  const claudeDir = path.join(dir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    `---\n${frontmatter}\n---\n`
  )
}

test("config で artifact を外すと docs/ への Write を捕捉しない", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "capture_targets: [diff, test]")
    const abs = writeArtifact(dir, "docs/design.md", "# 設計\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config の artifact_globs で捕捉対象を置き換えられる", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, 'artifact_globs: ["notes/**/*.md"]')
    const notes = writeArtifact(dir, "notes/memo.md", "メモ\n")
    const docs = writeArtifact(dir, "docs/design.md", "# 設計\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: notes } })
    runHook(dir, { tool_name: "Write", tool_input: { file_path: docs } })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain("memo")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config で test を外すとホワイトリストコマンドも捕捉しない", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "capture_targets: [diff, artifact]")
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "1 passed", stderr: "" }
    })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config の test_commands で追加したコマンドを捕捉する", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, 'test_commands: ["deno test"]')
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "deno test --allow-read" },
      tool_response: { stdout: "ok", stderr: "" }
    })
    expect(reviewFiles(dir)).toHaveLength(1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

`plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts` にテスト 1 つを追加:

```typescript
test("config で diff を外すと捕捉せず run.json も作らない", () => {
  const dir = makeRepo()
  try {
    const claudeDir = path.join(dir, ".claude")
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(
      path.join(claudeDir, "pitcrew.local.md"),
      "---\ncapture_targets: [artifact, test]\n---\n"
    )
    fs.writeFileSync(path.join(dir, "feat.ts"), "export const f = 1\n")
    expect(runHook(dir).trim()).toBe("")
    expect(reviewFiles(dir)).toEqual([])
    expect(fs.existsSync(path.join(dir, ".pitcrew", "run.json"))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 6: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`
Expected: FAIL(追加した 5 テストのみ失敗。既存テストは通ったまま)

- [ ] **Step 7: capture-post-tool-use.ts を修正する**

import に `loadConfig` を追加し、`captureArtifact` / `captureTestResult` に設定を引数で渡す。変更点は次のとおり:

```typescript
import { loadConfig, type PitcrewConfig } from "../lib/config.js"
```

`captureArtifact` のシグネチャと glob 判定行を変更:

```typescript
function captureArtifact(
  projectDir: string,
  input: HookInput,
  config: PitcrewConfig
): void {
  const filePath = input.tool_input?.file_path
  if (typeof filePath !== "string") return
  const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
  if (rel.startsWith("..") || path.isAbsolute(rel)) return // プロジェクト外
  if (!isArtifactPath(rel, config.artifactGlobs)) return
  // (以降は既存のまま)
```

`captureTestResult` のシグネチャとコマンド照合行を変更:

```typescript
function captureTestResult(
  projectDir: string,
  input: HookInput,
  config: PitcrewConfig
): void {
  const command = input.tool_input?.command
  if (typeof command !== "string") return
  const matched = matchTestCommand(command, config.testCommands)
  if (!matched) return
  // (以降は既存のまま)
```

末尾のエントリ部を変更(config の読み込みと有効判定):

```typescript
const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const config = loadConfig(projectDir)
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    if (config.captureTargets.artifact) captureArtifact(projectDir, input, config)
  } else if (input.tool_name === "Bash") {
    if (config.captureTargets.test) captureTestResult(projectDir, input, config)
  }
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err)
}
process.exit(0)
```

ファイル冒頭コメントに「捕捉対象・glob・コマンド追加は config(設計書 §7)で変わる」の一文を追記する。

- [ ] **Step 8: capture-subagent-stop.ts を修正する**

import に `loadConfig` を追加し、`try` 冒頭(snapshot の前)に diff 無効時のスキップを入れる:

```typescript
import { loadConfig } from "../lib/config.js"
```

```typescript
try {
  // config で diff 捕捉が無効なら何もしない(設計書 §7。snapshot も作らない)
  if (!loadConfig(projectDir).captureTargets.diff) process.exit(0)

  const head = snapshotWorktree(projectDir)
  // (以降は既存のまま)
```

- [ ] **Step 9: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/capture-post-tool-use.test.ts plugins/pitcrew/src/hooks/__test__/capture-subagent-stop.test.ts`
Expected: PASS(既存+追加の全件)

- [ ] **Step 10: 全テスト・lint・typecheck・ビルド**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: すべて成功。`plugins/pitcrew/scripts/capture-*.mjs` に差分が出る

- [ ] **Step 11: コミット**

```bash
git add plugins/pitcrew/src plugins/pitcrew/scripts
git commit -m "feat: pitcrew 捕捉層に config(捕捉対象・glob・コマンド追加)を反映"
```

---

### Task 3: 注入層への設定反映(injection_timing)

**Files:**
- Modify: `plugins/pitcrew/src/hooks/inject-pre-tool-use.ts`
- Test: `plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`(テスト追加)

**Interfaces:**
- Consumes: Task 1 の `loadConfig(projectDir)`(`injectionTiming` を参照)
- Produces: なし(hook の挙動変更のみ)。挙動は次の表(設計書 §7):

| injection_timing | PreToolUse の照合対象 | Stop の回収 |
| --- | --- | --- |
| `hybrid`(既定) | urgent のみ(現行どおり) | 全部(変更なし) |
| `turn-boundary` | 照合しない(即終了) | 全部(変更なし) |
| `immediate` | urgency 不問で全コメント | 全部(変更なし・取り残し防止) |

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts` にヘルパー 1 つとテスト 3 つを追加:

```typescript
function writeConfig(dir: string, frontmatter: string): void {
  const claudeDir = path.join(dir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    `---\n${frontmatter}\n---\n`
  )
}

test("turn-boundary 設定ではパス一致した urgent も注入しない", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "injection_timing: turn-boundary")
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("immediate 設定では normal コメントもパス一致で注入される", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "injection_timing: immediate")
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: normal\npaths: [src/auth.ts]\n---\nすぐ見て。\n"
    )
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    expect(out).toContain("すぐ見て")
    expect(
      fs.existsSync(
        path.join(dir, ".pitcrew", "comments", "processed", "c-001.md")
      )
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("hybrid 設定(明示)は既定と同じく urgent のみ照合する", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "injection_timing: hybrid")
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: normal\npaths: [src/auth.ts]\n---\n後で見て。\n"
    )
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`
Expected: FAIL(turn-boundary と immediate の 2 テストが失敗。hybrid 明示は現行実装でも通る)

- [ ] **Step 3: inject-pre-tool-use.ts を修正する**

import に `loadConfig` を追加:

```typescript
import { loadConfig } from "../lib/config.js"
```

`try` 内を次のとおり変更(timing の分岐と照合条件):

```typescript
try {
  const timing = loadConfig(projectDir).injectionTiming
  const filePath =
    input.tool_name === "Write" || input.tool_name === "Edit"
      ? input.tool_input?.file_path
      : undefined
  // turn-boundary モードでは即時注入を止め、すべて Stop に委ねる(設計書 §7)
  if (timing !== "turn-boundary" && typeof filePath === "string") {
    const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
    // isAbsolute は Windows の別ドライブ(relative が絶対パスを返すケース)対策。
    // Stage 1 の capture-post-tool-use.ts と同一のガード
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      // 照合対象(設計書 §7): hybrid = urgent のみ / immediate = urgency 不問で
      // 全コメント / turn-boundary = ここに到達しない(上の分岐で除外済み)
      const matched = listComments(projectDir).filter(
        (c) =>
          (timing === "immediate" || c.urgency === "urgent") &&
          c.paths.some((p) => pathMatchesComment(p, rel))
      )
      // rename に成功したコメントだけを注入する(早い者勝ち。設計書 §6)
      const claimed = matched.filter((c) => claimComment(projectDir, c.name))
      if (claimed.length > 0) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: renderInjection(claimed, MAX_INJECT_CHARS)
            }
          })
        )
      }
    }
  }
} catch (err) {
  logError(projectDir, "inject-pre-tool-use", err)
}
```

ファイル冒頭コメントに「注入タイミングは config の injection_timing に従う(設計書 §7)」の一文を追記する。

- [ ] **Step 4: テストがパスすることを確認する**

Run: `pnpm vitest run plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts`
Expected: PASS(既存+追加の全件)

- [ ] **Step 5: 全テスト・lint・typecheck・ビルド**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: すべて成功。`plugins/pitcrew/scripts/inject-pre-tool-use.mjs` に差分が出る

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src plugins/pitcrew/scripts
git commit -m "feat: pitcrew 注入層に config(injection_timing)を反映"
```

---

### Task 4: `/pitcrew:config` コマンド

**Files:**
- Create: `plugins/pitcrew/commands/config.md`

**Interfaces:**
- Consumes: Task 1-3 が読む設定キー(Global Constraints の「設定キーと既定値」と完全一致させること)
- Produces: `.claude/pitcrew.local.md`(ユーザーのプロジェクトに生成される設定ファイル)

コマンドは Markdown(LLM への手順書)なので自動テストはない。Step 2 のセルフチェックと Task 5 の手動確認で検証する。

- [ ] **Step 1: commands/config.md を作成する**

`plugins/pitcrew/commands/config.md` を次の内容で新規作成:

````markdown
---
description: pitcrew の対話式セットアップ。捕捉対象・注入タイミング・ビューア・テーマ・ポートを .claude/pitcrew.local.md に保存する
---

pitcrew の設定を対話で確認し、`.claude/pitcrew.local.md`(プロジェクトルート基準)に保存してください。
以下の手順に厳密に従うこと。

## 手順

### 1. 現在値の読み取り

`.claude/pitcrew.local.md` があれば読み、frontmatter の現在値を対話の初期値にする。
無ければ既定値を初期値にする:

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `viewer` | `files` | ビューア(browser / tui / files)。browser・tui は後続ステージで実装予定 |
| `capture_targets` | `[diff, artifact, test]` | 捕捉対象の組み合わせ |
| `artifact_globs` | `["docs/**/*.md"]` | 成果物として捕捉する glob(設定時は既定を置き換え) |
| `test_commands` | `[]` | テスト・ビルド判定に追加するコマンド接頭辞(既定リストに追加) |
| `injection_timing` | `hybrid` | hybrid / turn-boundary / immediate |
| `theme` | `device` | ブラウザビューアの初期テーマ(device / light / dark) |
| `port` | `7373` | ブラウザビューアの待受ポート(1〜65535) |

### 2. 対話(AskUserQuestion を使う)

1 回目の AskUserQuestion で次の 4 問を聞く(各問の初期候補は現在値を最初に置き「(現在)」を付ける):

1. **ビューア**: 「ファイル直接(エディタ)」「ブラウザ(後続ステージで実装予定)」「TUI(後続ステージで実装予定)」
2. **捕捉対象**(multiSelect): 「コード diff」「成果物ファイル」「テスト・ビルド結果」
3. **注入タイミング**: 「ハイブリッド — urgent は即時・normal はターン境界(推奨)」「ターン境界のみ — 全コメントを Stop で注入」「即時のみ — 全コメントをパス一致で即時注入(取り残しはターン境界で回収)」
4. **ブラウザビューアのテーマ初期値**: 「デバイス追従」「ライト」「ダーク」

2 回目の AskUserQuestion で次の 3 問を聞く:

1. **成果物 glob**: 「既定のまま(docs/**/*.md)」「変更する(Other で glob をカンマ区切り入力)」
   - 注意書きとして「glob 自体にカンマは使えない」ことを options の description に含める
2. **テストコマンドの追加**: 「追加しない」「追加する(Other でコマンド接頭辞をカンマ区切り入力)」
3. **ブラウザビューアのポート**: 「7373(既定)」「変更する(Other でポート番号を入力)」

### 3. 保存

回答をまとめて `.claude/pitcrew.local.md` を次の形式で書く(`.claude/` が無ければ作成):

```markdown
---
viewer: files
capture_targets: [diff, artifact, test]
artifact_globs: ["docs/**/*.md"]
test_commands: []
injection_timing: hybrid
theme: device
port: "7373"
---

# pitcrew 設定

`/pitcrew:config` で生成。手で編集しても有効(次の hook 起動から反映される)。

- viewer: browser | tui | files
- capture_targets: diff / artifact / test の組み合わせ(外した種別は捕捉しない)
- artifact_globs: 成果物として捕捉する glob(設定時は既定 docs/**/*.md を置き換え。空配列は既定のまま。docs/chat/ は常に除外)
- test_commands: テスト・ビルド判定の追加コマンド接頭辞(既定リストに追加)
- injection_timing: hybrid | turn-boundary | immediate
- theme: ブラウザビューアの初期テーマ(device | light | dark)
- port: ブラウザビューアの待受ポート
```

書式の制約(hooks 側のパーサがフラット YAML しか読めないため厳守):

- frontmatter はフラットな key-value とインライン配列(`[a, b]`)のみ。ネスト・複数行は不可
- glob のように `*` や `/` を含む値は `"` で囲む
- `port` は `"7373"` のように引用して書く
- 配列要素にカンマを含めない

**ユーザーが対話を途中でやめた(キャンセルした)場合は、ファイルを一切変更せず「設定は変更しませんでした」と伝えて終了する。**

### 4. .gitignore の提案

保存後、プロジェクトの `.gitignore` に `.pitcrew/` が無ければ「`.pitcrew/` はローカル状態なので .gitignore への追記を推奨します。追記しますか?」と確認し、同意されたら追記する。既にあれば何もしない。

### 5. リセットの案内(最後に 1 回だけ確認)

「`.pitcrew/`(レビューキュー・コメント・実行状態)をリセットしますか? 通常は不要です」と確認する。
同意された場合のみ `.pitcrew/` ディレクトリを丸ごと削除する(全状態がこの配下に閉じているため、削除で初期状態に戻る)。拒否・無回答なら何もしない。

### 6. 完了報告

保存した設定の要約(変更点があれば変更前 → 変更後)を表で示して終了する。
````

- [ ] **Step 2: セルフチェック**

次を目視確認する:

- コマンドの表・保存形式のキー名と既定値が、`src/lib/config.ts` の実装(Task 1)と完全一致している(`viewer`/`capture_targets`/`artifact_globs`/`test_commands`/`injection_timing`/`theme`/`port`、既定 port 7373)
- 保存例の frontmatter を `parseFrontmatter` が読める形式か(フラット・インライン配列・引用の規約)
- キャンセル時の無変更、.gitignore 提案、リセット確認が含まれている

- [ ] **Step 3: コミット**

```bash
git add plugins/pitcrew/commands/config.md
git commit -m "feat: pitcrew /pitcrew:config コマンド(対話式セットアップ)"
```

---

### Task 5: README・バージョン・最終確認

**Files:**
- Modify: `plugins/pitcrew/README.md`
- Modify: `plugins/pitcrew/.claude-plugin/plugin.json`(`0.7.1-dev` → `0.8.0-dev`)

**Interfaces:**
- Consumes: Task 1-4 の成果(ドキュメント化のみ)
- Produces: なし

- [ ] **Step 1: README を更新する**

`plugins/pitcrew/README.md` に次の変更を加える:

1. 冒頭段落内の文字列「(Stage 1 時点。コメントのセッションへの注入・専用ビューア・設定コマンドは後続ステージで追加予定)」を「(専用ビューアは後続ステージで追加予定)」に変更(行番号ではなく文字列で探すこと)
2. 「## 並行動作について(Stage 2)」セクションの直後に次のセクションを追加:

```markdown
## 設定(Stage 3: /pitcrew:config)

`/pitcrew:config` の対話で `.claude/pitcrew.local.md` に保存する(手で編集してもよい。
次の hook 起動から反映される)。設定ファイルが無い・壊れている場合は既定値で動く。

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `viewer` | `files` | ビューア。`browser` / `tui` は後続ステージで実装予定 |
| `capture_targets` | `[diff, artifact, test]` | 捕捉対象。外した種別は捕捉しない |
| `artifact_globs` | `["docs/**/*.md"]` | 成果物 glob(設定時は既定を置き換え。空配列は既定のまま。`docs/chat/` は常に除外。成果物の捕捉自体を止めたい場合は `capture_targets` から `artifact` を外す) |
| `test_commands` | `[]` | テスト・ビルド判定の追加コマンド接頭辞(既定リストに追加) |
| `injection_timing` | `hybrid` | `hybrid` / `turn-boundary`(全コメントをターン境界で注入)/ `immediate`(全コメントを即時照合。取り残しはターン境界で回収) |
| `theme` | `device` | ブラウザビューアの初期テーマ(後続ステージで使用) |
| `port` | `7373` | ブラウザビューアの待受ポート(後続ステージで使用) |

frontmatter はフラットな key-value とインライン配列のみ(ネスト不可)。
glob など `*` を含む値と `port` は `"` で囲む。
```

3. 「## `.pitcrew/` の構造」内の「comments/ # コメント(人間が書く。注入は Stage 2)」を「comments/ # コメント(人間が書く)」に変更

- [ ] **Step 2: バージョンを上げる**

`plugins/pitcrew/.claude-plugin/plugin.json` の `version` を `0.8.0-dev` に変更する。

- [ ] **Step 3: 全体検証**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && git status --short`
Expected: テスト全件パス・lint/typecheck エラーなし・ビルド後に未コミット差分が README / plugin.json 以外に無いこと(あれば `scripts/` の取り込み漏れなのでコミットに含める)

- [ ] **Step 4: コミット**

```bash
git add plugins/pitcrew/README.md plugins/pitcrew/.claude-plugin/plugin.json
git commit -m "docs: pitcrew Stage 3 の README 更新とバージョン 0.8.0-dev"
```

---

## 実機確認手順(実装完了後・ユーザー向け)

1. `/pitcrew:config` を実行し、対話 → `.claude/pitcrew.local.md` の生成を確認する
2. `capture_targets` から `test` を外して保存 → `pnpm test` を実行しても `.pitcrew/review/` に test 項目が増えないことを確認する
3. `injection_timing: turn-boundary` に変更 → urgent コメント(実際に触るパス指定)を置いても Edit 直前に注入されず、ターン終了時にまとめて差し戻されることを確認する
4. 設定を既定に戻す(`/pitcrew:config` 再実行 or ファイル削除)→ Stage 2 までと同じ挙動(urgent 即時注入)に戻ることを確認する
