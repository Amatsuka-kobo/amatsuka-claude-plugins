# pitcrew Stage 4.2(serve restart・ビューア config 変更・Ctrl+Enter 送信) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビューアに設定パネル(全 7 項目の編集・保存)と Ctrl+Enter 送信を追加し、`/pitcrew:serve` に restart 手順を追加する。

**Architecture:** config の検証・保存を `config.ts`(`validateConfig` / `saveConfig`)に集約し、`http.ts` は `GET/POST /api/config` の HTTP 関心事のみ担う。UI(`ui.html`)は ⚙ ボタンで開閉する設定パネルとコメント textarea の keydown ハンドラを追加。restart はコマンド手順書(`commands/serve.md`)のみの拡張で、`serve.ts` は変更しない。設計書: `docs/superpowers/specs/2026-07-18-pitcrew-stage4.2-design.md`

**Tech Stack:** TypeScript(Node 標準ライブラリのみ・依存追加禁止)、vitest、単一 HTML の vanilla JS UI

## Global Constraints

- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装は禁止(CLAUDE.md)
- 依存パッケージの追加は禁止(pitcrew は Node 標準ライブラリのみ)
- UI の動的 DOM 生成は `createElement` + `textContent` のみ。`innerHTML` は禁止(静的マークアップを HTML に直接書くのは可)
- バンドル出力は git 管理。ソース変更後は必ずリポジトリルートで `pnpm build` を実行し、生成物(`plugins/pitcrew/scripts/*.mjs`・`scripts/ui.html`)の差分もコミットする
- テストはリポジトリルートで `pnpm test`(vitest)。lint は `pnpm lint`(biome)、型は `pnpm typecheck`。**各タスクのコミット前に必ず `pnpm lint` を通す**(Stage 4.1 で整形漏れによる lint 失敗の前例あり)
- コミットメッセージは既存の慣習(`feat:` / `fix:` / `chore:` + 日本語)に従う
- `plugins/pitcrew/.claude-plugin/plugin.json` のバージョンは **Task 6 でのみ** 0.9.3 → 0.9.4 に変更する。他のタスクで plugin.json を触らない(Stage 4.1 で計画外のバージョン変更が混入した前例あり)
- POST /api/config は全 7 項目必須(部分更新なし)。バリデーションエラーは**フィールド定義順(viewer → captureTargets → artifactGlobs → testCommands → injectionTiming → theme → port)で最初の 1 件**だけを返す
- UI に再起動ボタン・`/api/restart` は追加しない(設計で明示的にスコープ外)

**作業ディレクトリ:** すべてのパスはリポジトリルート `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/` からの相対パス。

---

### Task 1: config.ts に validateConfig / saveConfig を追加

**Files:**
- Modify: `plugins/pitcrew/src/lib/config.ts`
- Test: `plugins/pitcrew/src/lib/__test__/config.test.ts`

**Interfaces:**
- Consumes: 既存の `PitcrewConfig` 型・`configPath()`・`loadConfig()`(同ファイル)、`writeFileAtomic(filePath: string, content: string): void`(`../atomic.js`)
- Produces:
  - `validateConfig(input: unknown): { config: PitcrewConfig } | { error: string }` — Task 2 が使う
  - `saveConfig(projectDir: string, config: PitcrewConfig): void` — Task 2 が使う

- [ ] **Step 1: ベースライン確認**

Run: `pnpm test`
Expected: 711 tests PASS(失敗があれば着手前に報告して停止)

- [ ] **Step 2: 失敗するテストを書く**

`plugins/pitcrew/src/lib/__test__/config.test.ts` の import を次に変更し、ファイル末尾にテストを追記する:

```ts
import {
  configPath,
  DEFAULT_ARTIFACT_GLOBS,
  DEFAULT_PORT,
  loadConfig,
  saveConfig,
  validateConfig
} from "../config.js"
```

追記するテスト(既存の `makeProject` ヘルパーを再利用):

```ts
// ---- validateConfig / saveConfig(Stage 4.2)----

function validInput(): Record<string, unknown> {
  return {
    viewer: "browser",
    captureTargets: { diff: true, artifact: false, test: true },
    artifactGlobs: ["docs/**/*.md", "notes/*.md"],
    testCommands: ["deno test"],
    injectionTiming: "immediate",
    theme: "dark",
    port: 8080
  }
}

test("validateConfig: 正常な入力で config を返す", () => {
  const result = validateConfig(validInput())
  expect(result).toEqual({
    config: {
      viewer: "browser",
      captureTargets: { diff: true, artifact: false, test: true },
      artifactGlobs: ["docs/**/*.md", "notes/*.md"],
      testCommands: ["deno test"],
      injectionTiming: "immediate",
      theme: "dark",
      port: 8080
    }
  })
})

test("validateConfig: オブジェクトでない入力は config エラー", () => {
  expect(validateConfig(null)).toEqual({ error: "config" })
  expect(validateConfig("x")).toEqual({ error: "config" })
  expect(validateConfig([])).toEqual({ error: "config" })
})

test("validateConfig: viewer の列挙値違反", () => {
  const input = { ...validInput(), viewer: "web" }
  expect(validateConfig(input)).toEqual({ error: "viewer" })
})

test("validateConfig: captureTargets の型違反", () => {
  expect(validateConfig({ ...validInput(), captureTargets: null })).toEqual({
    error: "captureTargets"
  })
  expect(
    validateConfig({
      ...validInput(),
      captureTargets: { diff: true, artifact: "yes", test: true }
    })
  ).toEqual({ error: "captureTargets" })
})

test("validateConfig: glob 要素のカンマ混入", () => {
  const input = { ...validInput(), artifactGlobs: ["a.md", "b,c.md"] }
  expect(validateConfig(input)).toEqual({ error: "artifactGlobs" })
})

test("validateConfig: glob 要素の改行混入", () => {
  const input = { ...validInput(), artifactGlobs: ["a\n.md"] }
  expect(validateConfig(input)).toEqual({ error: "artifactGlobs" })
})

test("validateConfig: artifactGlobs 空配列は不可", () => {
  const input = { ...validInput(), artifactGlobs: [] }
  expect(validateConfig(input)).toEqual({ error: "artifactGlobs" })
})

test("validateConfig: testCommands は空配列可・空文字列要素は不可", () => {
  expect("config" in validateConfig({ ...validInput(), testCommands: [] }))
    .toBe(true)
  expect(validateConfig({ ...validInput(), testCommands: [""] })).toEqual({
    error: "testCommands"
  })
})

test("validateConfig: injectionTiming / theme の列挙値違反", () => {
  expect(
    validateConfig({ ...validInput(), injectionTiming: "later" })
  ).toEqual({ error: "injectionTiming" })
  expect(validateConfig({ ...validInput(), theme: "auto" })).toEqual({
    error: "theme"
  })
})

test("validateConfig: port 範囲外・非整数", () => {
  expect(validateConfig({ ...validInput(), port: 0 })).toEqual({
    error: "port"
  })
  expect(validateConfig({ ...validInput(), port: 65536 })).toEqual({
    error: "port"
  })
  expect(validateConfig({ ...validInput(), port: 7373.5 })).toEqual({
    error: "port"
  })
  expect(validateConfig({ ...validInput(), port: "7373" })).toEqual({
    error: "port"
  })
})

test("validateConfig: フィールド欠落はそのフィールド名を返す", () => {
  const input = validInput()
  delete input.theme
  expect(validateConfig(input)).toEqual({ error: "theme" })
})

test("validateConfig: 複数違反時は定義順で最初の 1 件", () => {
  // viewer と port が同時に違反 → 定義順で先の viewer が返る
  const input = { ...validInput(), viewer: "web", port: 0 }
  expect(validateConfig(input)).toEqual({ error: "viewer" })
})

test("saveConfig → loadConfig ラウンドトリップ", () => {
  const dir = makeProject()
  try {
    const config = {
      viewer: "browser" as const,
      captureTargets: { diff: true, artifact: false, test: true },
      artifactGlobs: ["docs/specs/*.md", "notes/**/*.md"],
      testCommands: ["deno test", "bun test"],
      injectionTiming: "immediate" as const,
      theme: "dark" as const,
      port: 8080
    }
    saveConfig(dir, config)
    expect(loadConfig(dir)).toEqual(config)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("saveConfig: .claude/ が無くても作成して書く", () => {
  const dir = makeProject()
  try {
    saveConfig(dir, loadConfig(dir)) // 既定値をそのまま保存
    expect(fs.existsSync(configPath(dir))).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("saveConfig: 書式は config.md 準拠(glob 引用・port 引用・フラット YAML)", () => {
  const dir = makeProject()
  try {
    saveConfig(dir, {
      viewer: "files",
      captureTargets: { diff: true, artifact: true, test: true },
      artifactGlobs: ["docs/**/*.md"],
      testCommands: [],
      injectionTiming: "hybrid",
      theme: "device",
      port: 7373
    })
    const raw = fs.readFileSync(configPath(dir), "utf8")
    expect(raw).toContain('artifact_globs: ["docs/**/*.md"]')
    expect(raw).toContain('port: "7373"')
    expect(raw).toContain("viewer: files")
    expect(raw).toContain("capture_targets: [diff, artifact, test]")
    expect(raw).toContain("test_commands: []")
    expect(raw).toContain("# pitcrew 設定")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/config.test.ts`
Expected: FAIL(`validateConfig` / `saveConfig` が export されていない)

- [ ] **Step 4: 実装**

`plugins/pitcrew/src/lib/config.ts` の先頭 import に `writeFileAtomic` を追加:

```ts
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import { parseFrontmatter } from "./frontmatter.js"
```

ファイル末尾(`loadConfig` の後)に追加:

```ts
// ---- ビューアからの設定保存(設計書 Stage 4.2 §3.3)----
// 検証・シリアライズの規則をこのモジュールに集約し、http.ts には
// HTTP の関心事だけを残す。

// 配列要素の検証: string・非空・カンマ改行なし(フラット YAML の
// インライン配列を壊す値は保存前に拒否する)
function validStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== "string" || v === "" || /[,\n\r]/.test(v)) return null
    out.push(v)
  }
  return out
}

// 全 7 項目必須(部分更新なし)。複数違反時はフィールド定義順で
// 最初の 1 件だけを error に入れて返す。
export function validateConfig(
  input: unknown
): { config: PitcrewConfig } | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { error: "config" }
  const obj = input as Record<string, unknown>

  const viewer = obj.viewer
  if (viewer !== "browser" && viewer !== "tui" && viewer !== "files")
    return { error: "viewer" }

  const ct = obj.captureTargets
  if (typeof ct !== "object" || ct === null || Array.isArray(ct))
    return { error: "captureTargets" }
  const targets = ct as Record<string, unknown>
  if (
    typeof targets.diff !== "boolean" ||
    typeof targets.artifact !== "boolean" ||
    typeof targets.test !== "boolean"
  )
    return { error: "captureTargets" }

  const globs = validStringArray(obj.artifactGlobs)
  if (globs === null || globs.length === 0) return { error: "artifactGlobs" }

  const commands = validStringArray(obj.testCommands)
  if (commands === null) return { error: "testCommands" }

  const timing = obj.injectionTiming
  if (timing !== "hybrid" && timing !== "turn-boundary" && timing !== "immediate")
    return { error: "injectionTiming" }

  const theme = obj.theme
  if (theme !== "device" && theme !== "light" && theme !== "dark")
    return { error: "theme" }

  const port = obj.port
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return { error: "port" }

  return {
    config: {
      viewer,
      captureTargets: {
        diff: targets.diff,
        artifact: targets.artifact,
        test: targets.test
      },
      artifactGlobs: globs,
      testCommands: commands,
      injectionTiming: timing,
      theme,
      port
    }
  }
}

// commands/config.md §3 のテンプレートと同内容(本文は説明書きであり
// 設定値ではないため、保存のたびにこの固定文で上書きする)
const CONFIG_BODY = `
# pitcrew 設定

\`/pitcrew:config\` で生成。手で編集しても有効(次の hook 起動から反映される)。

- viewer: browser | tui | files
- capture_targets: diff / artifact / test の組み合わせ(外した種別は捕捉しない)
- artifact_globs: 成果物として捕捉する glob(設定時は既定 docs/**/*.md を置き換え。空配列は既定のまま。docs/chat/ は常に除外)
- test_commands: テスト・ビルド判定の追加コマンド接頭辞(既定リストに追加)
- injection_timing: hybrid | turn-boundary | immediate
- theme: ブラウザビューアの初期テーマ(device | light | dark)
- port: ブラウザビューアの待受ポート
`

// .claude/pitcrew.local.md を config.md と同一の書式で書く。
// frontmatter.ts の serializeFrontmatter は使わない(引用規則が
// レビュー項目向けで、glob を引用しないため書式が config.md とずれる)。
export function saveConfig(projectDir: string, config: PitcrewConfig): void {
  const targets: string[] = []
  if (config.captureTargets.diff) targets.push("diff")
  if (config.captureTargets.artifact) targets.push("artifact")
  if (config.captureTargets.test) targets.push("test")
  const lines = [
    "---",
    `viewer: ${config.viewer}`,
    `capture_targets: [${targets.join(", ")}]`,
    `artifact_globs: [${config.artifactGlobs.map((g) => JSON.stringify(g)).join(", ")}]`,
    `test_commands: [${config.testCommands.map((c) => JSON.stringify(c)).join(", ")}]`,
    `injection_timing: ${config.injectionTiming}`,
    `theme: ${config.theme}`,
    `port: "${config.port}"`,
    "---"
  ]
  const file = configPath(projectDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, `${lines.join("\n")}\n${CONFIG_BODY}`)
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/lib/__test__/config.test.ts`
Expected: 全 PASS(既存の config テスト+追加分)

- [ ] **Step 6: lint・typecheck・全テスト**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS

- [ ] **Step 7: コミット**

```bash
git add plugins/pitcrew/src/lib/config.ts plugins/pitcrew/src/lib/__test__/config.test.ts
git commit -m "feat: pitcrew config に validateConfig / saveConfig を追加(Stage 4.2 Task 1)"
```

---

### Task 2: http.ts に GET/POST /api/config を追加

**Files:**
- Modify: `plugins/pitcrew/src/server/http.ts`
- Test: `plugins/pitcrew/src/server/__test__/http.test.ts`

**Interfaces:**
- Consumes: `validateConfig` / `saveConfig` / `loadConfig`(`../lib/config.js`。Task 1 の成果物)
- Produces:
  - `GET /api/config` → `200` + `PitcrewConfig` の JSON
  - `POST /api/config` → `200 { ok: true, gitignoreMissing: string[] }` / `400 { error: string }`
  - UI(Task 3)はこの 2 エンドポイントを呼ぶ

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/http.test.ts` の末尾に追記する(既存の `start()` / `auth()` / `TOKEN` ヘルパーを再利用):

```ts
// ---- /api/config(Stage 4.2)----

function validConfigPayload(): Record<string, unknown> {
  return {
    viewer: "browser",
    captureTargets: { diff: true, artifact: true, test: false },
    artifactGlobs: ["docs/**/*.md"],
    testCommands: ["deno test"],
    injectionTiming: "hybrid",
    theme: "dark",
    port: 8080
  }
}

test("GET /api/config はトークン必須・ファイル無しでも既定値を返す", async () => {
  const base = await start()
  expect((await fetch(`${base}/api/config`)).status).toBe(401)
  const res = await fetch(`${base}/api/config`, { headers: auth() })
  expect(res.status).toBe(200)
  const cfg = (await res.json()) as { viewer: string; port: number }
  expect(cfg.viewer).toBe("files")
  expect(cfg.port).toBe(7373)
})

test("POST /api/config は保存してファイルを生成し、GET に反映される", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(validConfigPayload())
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; gitignoreMissing: string[] }
  expect(body.ok).toBe(true)
  expect(
    fs.existsSync(path.join(projectDir, ".claude", "pitcrew.local.md"))
  ).toBe(true)
  const after = await fetch(`${base}/api/config`, { headers: auth() })
  const cfg = (await after.json()) as { theme: string; port: number }
  expect(cfg.theme).toBe("dark")
  expect(cfg.port).toBe(8080)
})

test("POST /api/config: バリデーション違反は 400 + フィールド名", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ ...validConfigPayload(), port: 0 })
  })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "port" })
})

test("POST /api/config: 不正 JSON は 400", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: "{oops"
  })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "bad json" })
})

test("POST /api/config: gitignoreMissing は .gitignore 無しで両方返す", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(validConfigPayload())
  })
  const body = (await res.json()) as { gitignoreMissing: string[] }
  expect(body.gitignoreMissing).toEqual([
    ".pitcrew/",
    ".claude/pitcrew.local.md"
  ])
})

test("POST /api/config: gitignoreMissing は登録済み分を除く(空白・末尾スラッシュ許容)", async () => {
  const base = await start()
  // 前後空白付き・末尾スラッシュ無しでも登録済み扱いになること。
  // コメント行・空行は登録エントリとして扱われないこと
  fs.writeFileSync(
    path.join(projectDir, ".gitignore"),
    "# deps\nnode_modules/\n\n  .pitcrew  \n# .claude/pitcrew.local.md\n"
  )
  const res = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(validConfigPayload())
  })
  const body = (await res.json()) as { gitignoreMissing: string[] }
  expect(body.gitignoreMissing).toEqual([".claude/pitcrew.local.md"])
})

test("POST /api/config: 両方登録済みなら gitignoreMissing は空", async () => {
  const base = await start()
  fs.writeFileSync(
    path.join(projectDir, ".gitignore"),
    ".pitcrew/\n.claude/pitcrew.local.md\n"
  )
  const res = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(validConfigPayload())
  })
  const body = (await res.json()) as { gitignoreMissing: string[] }
  expect(body.gitignoreMissing).toEqual([])
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/http.test.ts`
Expected: 追加分が FAIL(404 が返る)

- [ ] **Step 3: 実装**

`plugins/pitcrew/src/server/http.ts` の import を変更:

```ts
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { loadConfig, saveConfig, validateConfig } from "../lib/config.js"
import { listState, readItemBody } from "./state.js"
```

`hasLineBreak` 関数の直後(`createPitcrewServer` の前)に追加:

```ts
// .gitignore に推奨エントリが登録済みかを返す(設計書 Stage 4.2 §3.3.1)。
// 判定は前後空白を無視した行一致+末尾スラッシュの有無を同一視。
// gitignore パターンの完全解釈はしない(案内が 1 回余計に出るだけで実害
// がないため)。このサーバーは .gitignore を編集しない。
const GITIGNORE_RECOMMENDED = [".pitcrew/", ".claude/pitcrew.local.md"]

function gitignoreMissing(projectDir: string): string[] {
  let lines: string[]
  try {
    lines = fs
      .readFileSync(path.join(projectDir, ".gitignore"), "utf8")
      .split("\n")
  } catch {
    return [...GITIGNORE_RECOMMENDED]
  }
  // 空行・コメント行は登録エントリとして扱わない
  const entries = new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.replace(/\/+$/, ""))
  )
  return GITIGNORE_RECOMMENDED.filter(
    (rec) => !entries.has(rec.replace(/\/+$/, ""))
  )
}
```

`handle()` 内、`/api/state` ルートの直後に 2 ルートを追加:

```ts
    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, loadConfig(projectDir))
      return
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      let parsed: unknown
      try {
        parsed = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      const result = validateConfig(parsed)
      if ("error" in result) {
        sendJson(res, 400, { error: result.error })
        return
      }
      saveConfig(projectDir, result.config)
      sendJson(res, 200, {
        ok: true,
        gitignoreMissing: gitignoreMissing(projectDir)
      })
      return
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run plugins/pitcrew/src/server/__test__/http.test.ts`
Expected: 全 PASS

- [ ] **Step 5: lint・typecheck・全テスト**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server/http.ts plugins/pitcrew/src/server/__test__/http.test.ts
git commit -m "feat: pitcrew ビューアに GET/POST /api/config を追加(Stage 4.2 Task 2)"
```

---

### Task 3: ui.html に設定パネルを追加

**Files:**
- Modify: `plugins/pitcrew/src/server/ui.html`

**Interfaces:**
- Consumes: `GET /api/config` / `POST /api/config`(Task 2 の成果物)、既存の `applyTheme()` / `headers` / `toast()` / `$()`(ui.html 内)
- Produces: ⚙ ボタンと設定パネル(実機確認対象。自動テストなし)

- [ ] **Step 1: CSS を追加**

`ui.html` の `<style>` 内、`#toast` ルールの直前に追加:

```css
#config-toggle {
  border: 1px solid var(--border); background: var(--pane); color: var(--fg);
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 13px;
}
#config-panel {
  border-bottom: 1px solid var(--border); padding: 12px 16px;
  background: var(--pane); display: flex; flex-direction: column; gap: 10px;
  font-size: 13px; max-height: 45vh; overflow-y: auto;
}
#config-panel .cfg-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
#config-panel .cfg-name { width: 140px; color: var(--muted); flex-shrink: 0; padding-top: 4px; }
#config-panel select, #config-panel input[type="number"] {
  border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  border-radius: 6px; padding: 4px 8px; font-size: 13px;
}
#config-panel textarea {
  border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  border-radius: 6px; padding: 6px 8px; font-size: 13px; width: 320px;
  min-height: 48px; resize: vertical; font-family: ui-monospace, monospace;
}
#cfg-save {
  border: none; background: var(--accent); color: var(--accent-fg);
  border-radius: 6px; padding: 6px 16px; cursor: pointer; font-size: 13px;
}
#cfg-msg { color: var(--muted); }
```

- [ ] **Step 2: マークアップを追加**

`#status-bar` 内の `<button id="theme-toggle" ...>` の直前に追加:

```html
  <button id="config-toggle" type="button" title="設定">⚙ 設定</button>
```

`</div>`(`#status-bar` 終了タグ)と `<main>` の間に追加:

```html
<div id="config-panel" hidden>
  <div class="cfg-row">
    <label class="cfg-name" for="cfg-viewer">ビューア</label>
    <select id="cfg-viewer">
      <option value="files">files(エディタ直接)</option>
      <option value="browser">browser</option>
      <option value="tui">tui(後続ステージで実装予定)</option>
    </select>
  </div>
  <div class="cfg-row">
    <span class="cfg-name">捕捉対象</span>
    <label><input type="checkbox" id="cfg-target-diff" /> コード diff</label>
    <label><input type="checkbox" id="cfg-target-artifact" /> 成果物</label>
    <label><input type="checkbox" id="cfg-target-test" /> テスト・ビルド</label>
  </div>
  <div class="cfg-row">
    <label class="cfg-name" for="cfg-globs">成果物 glob</label>
    <textarea id="cfg-globs" placeholder="1 行 1 glob(例: docs/**/*.md)"></textarea>
  </div>
  <div class="cfg-row">
    <label class="cfg-name" for="cfg-commands">テストコマンド追加</label>
    <textarea id="cfg-commands" placeholder="1 行 1 コマンド接頭辞(例: deno test)"></textarea>
  </div>
  <div class="cfg-row">
    <label class="cfg-name" for="cfg-timing">注入タイミング</label>
    <select id="cfg-timing">
      <option value="hybrid">hybrid(推奨)</option>
      <option value="turn-boundary">turn-boundary</option>
      <option value="immediate">immediate</option>
    </select>
  </div>
  <div class="cfg-row">
    <label class="cfg-name" for="cfg-theme">テーマ初期値</label>
    <select id="cfg-theme">
      <option value="device">device</option>
      <option value="light">light</option>
      <option value="dark">dark</option>
    </select>
  </div>
  <div class="cfg-row">
    <label class="cfg-name" for="cfg-port">ポート</label>
    <input type="number" id="cfg-port" min="1" max="65535" />
  </div>
  <div class="cfg-row">
    <button id="cfg-save" type="button">保存</button>
    <span id="cfg-msg"></span>
  </div>
</div>
```

- [ ] **Step 3: スクリプトを追加**

`ui.html` の `<script>` 内、`// ---- 同期(SSE + 再取得) ----` コメントの直前に追加:

```js
  // ---- 設定パネル(Stage 4.2)----
  // 保存はサーバー側で検証してからアトミックに書かれる。hooks は短命
  // プロセスで毎回読み直すため次の hook 起動から反映。port / theme の
  // サーバー側反映のみ再起動(/pitcrew:serve restart)が必要。
  $("config-toggle").addEventListener("click", async () => {
    const panel = $("config-panel");
    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }
    try {
      const res = await fetch("/api/config", { headers });
      if (!res.ok) throw new Error(String(res.status));
      fillConfigForm(await res.json());
      $("cfg-msg").textContent = "";
      panel.hidden = false;
    } catch {
      toast("設定の読み込みに失敗しました");
    }
  });

  function fillConfigForm(cfg) {
    $("cfg-viewer").value = cfg.viewer;
    $("cfg-target-diff").checked = cfg.captureTargets.diff;
    $("cfg-target-artifact").checked = cfg.captureTargets.artifact;
    $("cfg-target-test").checked = cfg.captureTargets.test;
    $("cfg-globs").value = cfg.artifactGlobs.join("\n");
    $("cfg-commands").value = cfg.testCommands.join("\n");
    $("cfg-timing").value = cfg.injectionTiming;
    $("cfg-theme").value = cfg.theme;
    $("cfg-port").value = String(cfg.port);
  }

  function splitLines(value) {
    return value.split("\n").map((s) => s.trim()).filter((s) => s !== "");
  }

  $("cfg-save").addEventListener("click", async () => {
    const payload = {
      viewer: $("cfg-viewer").value,
      captureTargets: {
        diff: $("cfg-target-diff").checked,
        artifact: $("cfg-target-artifact").checked,
        test: $("cfg-target-test").checked
      },
      artifactGlobs: splitLines($("cfg-globs").value),
      testCommands: splitLines($("cfg-commands").value),
      injectionTiming: $("cfg-timing").value,
      theme: $("cfg-theme").value,
      port: Number($("cfg-port").value)
    };
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        // config テーマの即時反映(localStorage の明示選択が優先される
        // 既存の優先順位は applyTheme() 側で維持される)
        document.documentElement.dataset.configTheme = payload.theme;
        applyTheme();
        let msg =
          "保存しました。捕捉・注入の設定は次の hook 起動から、" +
          "port / theme は次回のビューア起動(/pitcrew:serve restart)から反映されます。";
        if (data.gitignoreMissing.length > 0) {
          msg +=
            " " + data.gitignoreMissing.join(" と ") +
            " は .gitignore への追記を推奨します(/pitcrew:config で追記できます)。";
        }
        $("cfg-msg").textContent = msg;
        toast("設定を保存しました");
      } else {
        let field = "";
        try {
          field = ((await res.json()) || {}).error || "";
        } catch {}
        $("cfg-msg").textContent =
          "保存に失敗しました" + (field ? ": " + field + " が不正です" : "");
        toast("設定の保存に失敗しました");
      }
    } catch {
      toast("設定の保存に失敗しました");
    }
  });
```

- [ ] **Step 4: lint**

Run: `pnpm lint`
Expected: PASS(整形指摘が出たら `pnpm biome check --write plugins/pitcrew/src/server/ui.html` で修正。Stage 4.1 で整形漏れによる lint 失敗の前例があるため必ず実行する)

- [ ] **Step 5: 全テスト**

Run: `pnpm test`
Expected: 全 PASS(ui.html はテスト対象外だが回帰確認)

- [ ] **Step 6: コミット**

```bash
git add plugins/pitcrew/src/server/ui.html
git commit -m "feat: pitcrew ビューアに設定パネルを追加(Stage 4.2 Task 3)"
```

---

### Task 4: ui.html に Ctrl+Enter 送信を追加

**Files:**
- Modify: `plugins/pitcrew/src/server/ui.html`

**Interfaces:**
- Consumes: 既存の `$("comment-send")` click ハンドラ(ui.html 内)
- Produces: コメント textarea の Ctrl+Enter / Cmd+Enter 送信(実機確認対象。自動テストなし)

- [ ] **Step 1: keydown ハンドラを追加**

`ui.html` の `$("comment-send").addEventListener("click", ...)` ブロックの直後に追加:

```js
  // Ctrl+Enter / Cmd+Enter で送信(送信経路を 1 本に保つため click() を呼ぶ。
  // 空本文ガードは click ハンドラ側がそのまま効く)
  $("comment-body").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      $("comment-send").click();
    }
  });
```

- [ ] **Step 2: placeholder に発見可能性を追加**

`#comment-body` の placeholder を次に変更:

```html
      <textarea id="comment-body" placeholder="コメント(選択中の項目の paths / reviewId / base が自動で付きます。Ctrl+Enter で送信)"></textarea>
```

- [ ] **Step 3: lint・全テスト**

Run: `pnpm lint && pnpm test`
Expected: すべて PASS

- [ ] **Step 4: コミット**

```bash
git add plugins/pitcrew/src/server/ui.html
git commit -m "feat: pitcrew コメント入力に Ctrl+Enter 送信を追加(Stage 4.2 Task 4)"
```

---

### Task 5: serve.md に restart 手順を追加

**Files:**
- Modify: `plugins/pitcrew/commands/serve.md`

**Interfaces:**
- Consumes: 既存の起動手順(§2-3)・停止手順(§4)
- Produces: `/pitcrew:serve restart` のコマンド手順(実機確認対象)

- [ ] **Step 1: restart 手順を追記**

`plugins/pitcrew/commands/serve.md` の末尾(手順 4 の後)に追加:

```markdown

### 5. 再起動(ユーザーが "restart" を指定した場合)

引数に `restart` が含まれる場合は、停止 → 起動を続けて行う:

1. `.pitcrew/serve.json` が無い、または `pid` のプロセスが既に死んでいる場合は、
   停止をスキップして手順 2(起動)から実行する(エラーにしない)
2. `serve.json` の `pid` に `kill <pid>` で SIGTERM を送る
3. **プロセスの終了を確認してから次へ進む**: `kill -0 <pid>` が失敗する(=終了した)
   まで 1 秒間隔で最大 10 秒待つ(Bash の `until` ループ)。旧プロセスがポートを
   掴んだまま起動すると EADDRINUSE で失敗するため、この確認は省略しない
4. 10 秒待っても終了しない場合は起動へ進まず、「旧プロセス(pid: <pid>)が終了
   しません。プロセスの状態を確認してください」と伝えて終了する(以降の手順は
   実行しない。`kill -9` は案内しない)
5. 終了を確認できたら、手順 2(起動)と手順 3(URL の提示)を実行する
   - それでも起動がポート使用中(TIME_WAIT 等)で失敗した場合は、手順 3 の
     既存のエラーハンドリング(エラー内容の提示・`/pitcrew:config` でのポート
     変更案内)に従う
```

- [ ] **Step 2: コミット**

```bash
git add plugins/pitcrew/commands/serve.md
git commit -m "feat: /pitcrew:serve に restart 手順を追加(Stage 4.2 Task 5)"
```

---

### Task 6: README・バージョン・バンドル再生成・回帰確認

**Files:**
- Modify: `plugins/pitcrew/README.md`
- Modify: `plugins/pitcrew/.claude-plugin/plugin.json`
- Modify(生成物): `plugins/pitcrew/scripts/*`(pnpm build による再生成)

**Interfaces:**
- Consumes: Task 1-5 の全成果物
- Produces: リリース可能な状態(バージョン 0.9.4・バンドル最新・ドキュメント更新済み)

- [ ] **Step 1: README を更新**

`plugins/pitcrew/README.md` の「## ブラウザビューア(Stage 4: /pitcrew:serve)」節に以下の要点を追記する(既存の文体に合わせた記述で):

- ⚙ 設定パネルからすべての設定をブラウザで変更できる(port / theme はビューアの再起動で反映)
- コメントは Ctrl+Enter / Cmd+Enter でも送信できる
- `/pitcrew:serve restart` で再起動できる

スクリーンショットの更新は不要(追加 UI は ⚙ ボタンとパネルのみでレイアウトの大きな変化がないため)。

- [ ] **Step 2: バージョンを上げる**

`plugins/pitcrew/.claude-plugin/plugin.json` の `"version": "0.9.3"` を `"version": "0.9.4"` に変更する。**それ以外は変更しない。**

- [ ] **Step 3: バンドル再生成**

Run: `pnpm build`
Expected: 成功。`git status` で `plugins/pitcrew/scripts/` 配下の差分(serve.mjs・ui.html 等)を確認

- [ ] **Step 4: 回帰確認**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: すべて PASS(テストは 711 + Task 1-2 の追加分)

- [ ] **Step 5: コミット**

```bash
git add plugins/pitcrew/README.md plugins/pitcrew/.claude-plugin/plugin.json plugins/pitcrew/scripts/
git commit -m "chore: pitcrew 0.9.4(設定パネル・Ctrl+Enter 送信・serve restart)"
```

---

## 実機確認(実装完了後・ユーザーと共に)

自動テストで担保できない項目。最終レビュー後にユーザーへ依頼する:

1. **設定パネル**: ⚙ で開閉 / 現在値が反映される / 保存で `.claude/pitcrew.local.md` が更新される / 不正な port(0 等)でフィールド名付きエラー / 保存後の再起動案内と .gitignore 案内(未登録時のみ)/ theme 変更の即時反映(ヘッダーのテーマトグルで明示選択済みの場合はそちらが優先)
2. **Ctrl+Enter / Cmd+Enter 送信**: 送信されること / 空本文では送信されないこと / 送信後にクリアされること
3. **`/pitcrew:serve restart`**: 起動中の restart(URL 再提示)/ 未起動時の restart(そのまま起動)
