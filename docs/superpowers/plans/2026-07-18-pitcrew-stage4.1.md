# pitcrew Stage 4.1(新しい順ソート・一括既読) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビューア左ペインを新しい順に並べ、チェックボックス選択式の一括既読機能を追加する。

**Architecture:** 読み取り側(`state.ts`)のソート変更と、書き込み側(`viewer-ops.ts` の `approveItems` + `http.ts` の `POST /api/approve-batch`)の追加。UI(`ui.html`)はチェックボックス・全選択トグル・一括既読ボタンを「レビュー待ち」セクションに追加する。設計書: `docs/superpowers/specs/2026-07-18-pitcrew-stage4.1-design.md`

**Tech Stack:** TypeScript(Node 標準ライブラリのみ・依存追加禁止)、vitest、単一 HTML の vanilla JS UI

## Global Constraints

- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装は禁止(CLAUDE.md)
- 依存パッケージの追加は禁止(pitcrew は Node 標準ライブラリのみ)
- UI の DOM 生成は `createElement` + `textContent` のみ。`innerHTML` は禁止
- ファイル名の検証は必ず `isSafeName`(`src/server/state.ts`)を通す
- バンドル出力は git 管理。ソース変更後は必ずリポジトリルートで `pnpm build` を実行し、生成物の差分もコミットする
- テストはリポジトリルートで `pnpm test`(vitest)。lint は `pnpm lint`(biome)、型は `pnpm typecheck`
- コミットメッセージは既存の慣習(`feat:` / `fix:` / `chore:` + 日本語)に従う
- 部分失敗のセマンティクス: 一括既読は移動済み項目をロールバックしない。結果は `moved` / `failed` に完全に反映する

**作業ディレクトリ:** すべてのパスはリポジトリルート `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/` からの相対パス。

---

### Task 1: readItems の降順ソート(新しい順)

**Files:**
- Modify: `plugins/pitcrew/src/server/state.ts:66`
- Test: `plugins/pitcrew/src/server/__test__/state.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `listState()` の `review` / `reviewed` 配列がファイル名降順(= 連番 ID 降順 = 新しい順)で返る。後続タスクはこの順序に依存しない

- [ ] **Step 1: 既存テストが全て PASS することを確認(ベースライン)**

Run: `pnpm test`
Expected: 704 tests PASS(失敗があれば着手前に報告して停止)

- [ ] **Step 2: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/state.test.ts` の末尾に追加:

```ts
test("review/ と reviewed/ はファイル名降順(新しい順)で返す", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "001-diff-a-ts.md", ITEM)
    writeItem(dir, "review", "003-test-vitest.md", ITEM)
    writeItem(dir, "review", "002-diff-b-ts.md", ITEM)
    writeItem(dir, "reviewed", "004-artifact-x-md.md", ITEM)
    writeItem(dir, "reviewed", "005-diff-c-ts.md", ITEM)
    const s = listState(dir)
    expect(s.review.map((i) => i.name)).toEqual([
      "003-test-vitest.md",
      "002-diff-b-ts.md",
      "001-diff-a-ts.md"
    ])
    expect(s.reviewed.map((i) => i.name)).toEqual([
      "005-diff-c-ts.md",
      "004-artifact-x-md.md"
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm test -- state`
Expected: 新テストが FAIL(昇順で返るため expected と逆順)

- [ ] **Step 4: 最小実装**

`plugins/pitcrew/src/server/state.ts` の `readItems` 内、66 行目:

```ts
  for (const name of names.sort()) {
```

を次に変更(ファイル名は 3 桁ゼロ埋め連番プレフィックスのため文字列降順 = 新しい順):

```ts
  for (const name of names.sort().reverse()) {
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm test`
Expected: 全テスト PASS(705 tests。既存テストは各セクション 1 件しか置いていないため順序変更の影響なし。万一失敗した既存テストがあれば、それがソート順依存かを確認し期待値だけを更新する)

- [ ] **Step 6: Commit**

```bash
git add plugins/pitcrew/src/server/state.ts plugins/pitcrew/src/server/__test__/state.test.ts
git commit -m "feat: pitcrew ビューアの一覧をファイル名降順(新しい順)にソート"
```

---

### Task 2: viewer-ops に approveItems(一括既読)を追加

**Files:**
- Modify: `plugins/pitcrew/src/server/viewer-ops.ts`
- Test: `plugins/pitcrew/src/server/__test__/viewer-ops.test.ts`

**Interfaces:**
- Consumes: `isSafeName(name: string): boolean`(`../state.js` から import 済み)
- Produces: `approveItems(projectDir: string, names: string[]): BatchApproveResult` と `interface BatchApproveResult { moved: string[]; failed: string[] }`。Task 3 の HTTP 層がこのシグネチャで呼ぶ

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/viewer-ops.test.ts` の import を変更:

```ts
import { approveItem, approveItems, writeComment } from "../viewer-ops.js"
```

末尾にテストを追加:

```ts
test("approveItems は複数項目を reviewed/ へ移動する", () => {
  const dir = makeProject()
  try {
    const review = path.join(dir, ".pitcrew", "review")
    fs.mkdirSync(review, { recursive: true })
    fs.writeFileSync(path.join(review, "001-diff-a.md"), "a")
    fs.writeFileSync(path.join(review, "002-diff-b.md"), "b")
    const result = approveItems(dir, ["001-diff-a.md", "002-diff-b.md"])
    expect(result.moved).toEqual(["001-diff-a.md", "002-diff-b.md"])
    expect(result.failed).toEqual([])
    expect(fs.existsSync(path.join(review, "001-diff-a.md"))).toBe(false)
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "reviewed", "002-diff-b.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItems は失敗を failed に積み残りを続行する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const review = path.join(dir, ".pitcrew", "review")
    fs.mkdirSync(review, { recursive: true })
    fs.writeFileSync(path.join(review, "002-diff-ok.md"), "ok")
    const result = approveItems(dir, [
      "../run.json", // 不正な名前
      "001-diff-nope.md", // 存在しない
      "002-diff-ok.md" // 正常
    ])
    expect(result.moved).toEqual(["002-diff-ok.md"])
    expect(result.failed).toEqual(["../run.json", "001-diff-nope.md"])
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "reviewed", "002-diff-ok.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItems は空配列で moved も failed も空", () => {
  const dir = makeProject()
  try {
    expect(approveItems(dir, [])).toEqual({ moved: [], failed: [] })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- viewer-ops`
Expected: FAIL(`approveItems` が export されていない)

- [ ] **Step 3: 最小実装**

`plugins/pitcrew/src/server/viewer-ops.ts` の `approveItem` 関数の直後に追加:

```ts
export interface BatchApproveResult {
  moved: string[]
  failed: string[]
}

// 一括既読(設計書 Stage 4.1)。1 件の失敗で全体を止めない(フェイルオープン)。
// 移動済み項目はロールバックしない。結果は moved / failed に完全に反映される
export function approveItems(
  projectDir: string,
  names: string[]
): BatchApproveResult {
  const base = pitcrewDir(projectDir)
  const moved: string[] = []
  const failed: string[] = []
  try {
    fs.mkdirSync(path.join(base, "reviewed"), { recursive: true })
  } catch {
    // 作成失敗時は各 rename が失敗して failed に計上される
  }
  for (const name of names) {
    if (!isSafeName(name)) {
      failed.push(name)
      continue
    }
    try {
      fs.renameSync(
        path.join(base, "review", name),
        path.join(base, "reviewed", name)
      )
      moved.push(name)
    } catch {
      failed.push(name)
    }
  }
  return { moved, failed }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- viewer-ops`
Expected: PASS(全件)

- [ ] **Step 5: Commit**

```bash
git add plugins/pitcrew/src/server/viewer-ops.ts plugins/pitcrew/src/server/__test__/viewer-ops.test.ts
git commit -m "feat: pitcrew viewer-ops に一括既読 approveItems を追加"
```

---

### Task 3: HTTP 層に POST /api/approve-batch を追加

**Files:**
- Modify: `plugins/pitcrew/src/server/http.ts`
- Test: `plugins/pitcrew/src/server/__test__/http.test.ts`

**Interfaces:**
- Consumes: `approveItems(projectDir, names)` / `BatchApproveResult`(Task 2)
- Produces: `POST /api/approve-batch`。リクエスト `{ names: string[] }`、レスポンス `200 { ok: true, moved: string[], failed: string[] }`(部分失敗でも 200)、`400 { error: "bad json" | "bad names" | "empty names" | "too many names" }`。Task 4 の UI がこの API を呼ぶ

- [ ] **Step 1: 失敗するテストを書く**

`plugins/pitcrew/src/server/__test__/http.test.ts` の末尾に追加:

```ts
test("POST /api/approve-batch は複数項目を移動し moved/failed を返す", async () => {
  const base = await start()
  const review = path.join(projectDir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  fs.writeFileSync(path.join(review, "001-diff-a.md"), "a")
  fs.writeFileSync(path.join(review, "002-diff-b.md"), "b")
  const res = await fetch(`${base}/api/approve-batch`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ names: ["001-diff-a.md", "002-diff-b.md", "nope.md"] })
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    moved: ["001-diff-a.md", "002-diff-b.md"],
    failed: ["nope.md"]
  })
  expect(
    fs.existsSync(path.join(projectDir, ".pitcrew", "reviewed", "001-diff-a.md"))
  ).toBe(true)
})

test("POST /api/approve-batch は不正リクエストを 400 で拒否する", async () => {
  const base = await start()
  const post = (body: string) =>
    fetch(`${base}/api/approve-batch`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body
    })
  expect((await post("{壊れたJSON")).status).toBe(400)
  expect((await post(JSON.stringify({ names: "not-array" }))).status).toBe(400)
  expect((await post(JSON.stringify({ names: [] }))).status).toBe(400)
  const tooMany = Array.from({ length: 1001 }, (_, i) => `${i}.md`)
  expect((await post(JSON.stringify({ names: tooMany }))).status).toBe(400)
})

test("POST /api/approve-batch は認証なしで 401", async () => {
  const base = await start()
  const res = await fetch(`${base}/api/approve-batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ names: ["001-diff-a.md"] })
  })
  expect(res.status).toBe(401)
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- http`
Expected: 新テストが FAIL(未知パスのため 404 が返る)

- [ ] **Step 3: 最小実装**

`plugins/pitcrew/src/server/http.ts` の import(4 行目)を変更:

```ts
import {
  approveItem,
  approveItems,
  type NewComment,
  writeComment
} from "./viewer-ops.js"
```

`handle` 関数内、`/api/approve` ブロックの直後(`/api/comment` の前)にルートを追加:

```ts
    if (req.method === "POST" && url.pathname === "/api/approve-batch") {
      let names: string[]
      try {
        const parsed = JSON.parse(await readBody(req)) as { names?: unknown }
        if (!Array.isArray(parsed.names)) {
          sendJson(res, 400, { error: "bad names" })
          return
        }
        names = parsed.names.filter((x): x is string => typeof x === "string")
      } catch {
        sendJson(res, 400, { error: "bad json" })
        return
      }
      if (names.length === 0) {
        sendJson(res, 400, { error: "empty names" })
        return
      }
      // 上限は暴走リクエストの抑止(通常運用で達しない)
      if (names.length > 1000) {
        sendJson(res, 400, { error: "too many names" })
        return
      }
      const result = approveItems(projectDir, names)
      sendJson(res, 200, { ok: true, moved: result.moved, failed: result.failed })
      return
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- http`
Expected: PASS(全件)

- [ ] **Step 5: Commit**

```bash
git add plugins/pitcrew/src/server/http.ts plugins/pitcrew/src/server/__test__/http.test.ts
git commit -m "feat: pitcrew HTTP 層に POST /api/approve-batch を追加"
```

---

### Task 4: UI にチェックボックス・全選択・一括既読ボタンを追加

**Files:**
- Modify: `plugins/pitcrew/src/server/ui.html`

**Interfaces:**
- Consumes: `POST /api/approve-batch`(Task 3。`{ names }` → `{ ok, moved, failed }`)、`/api/state` の返却順(Task 1 で新しい順)
- Produces: なし(最終消費者)

**注意:** `ui.html` は自動テスト対象外(既存方針)。ロジックはサーバー側テストで担保済み。DOM 生成は `createElement` + `textContent` のみで、`innerHTML` は使わないこと。

- [ ] **Step 1: CSS を追加**

`ui.html` の `<style>` 内、`.badge` 定義の後(`.badge.test` の行の下)に追加:

```css
.queue-item input[type="checkbox"] { flex-shrink: 0; margin: 0; }
#queue-pane .section { display: flex; align-items: center; gap: 8px; }
#queue-pane .section input[type="checkbox"] { margin: 0; }
#queue-pane .section .grow { flex: 1; }
#batch-approve {
  border: none; background: var(--accent); color: var(--accent-fg);
  border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 11px;
  text-transform: none; letter-spacing: normal;
}
#batch-approve:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: 選択状態の Set を追加**

`<script>` 内の `let selected = null;` の直後に追加:

```js
  // 一括既読の選択状態。SSE 再描画・再接続後も維持される(描画時に Set を参照して復元)
  const checkedNames = new Set();
```

- [ ] **Step 3: renderItem にチェックボックスを追加**

`renderItem` 関数内、`const row = document.createElement("div"); row.className = "row";` の直後(badge 生成の前)に追加:

```js
    if (item.status === "review") {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = checkedNames.has(item.name);
      // クリックで詳細表示(項目選択)が発火しないようにする
      check.addEventListener("click", (e) => e.stopPropagation());
      check.addEventListener("change", () => {
        if (check.checked) checkedNames.add(item.name);
        else checkedNames.delete(item.name);
        updateBatchControls();
      });
      row.append(check);
    }
```

- [ ] **Step 4: セクションヘッダー生成を補助関数に切り出し、renderQueue を更新**

`renderQueue` 関数の**前**に補助関数 2 つを追加:

```js
  // 「レビュー待ち」ヘッダー(全選択トグル + 一括既読ボタン)。renderQueue の肥大化を避けて分離
  function renderReviewHeader() {
    const label = document.createElement("div");
    label.className = "section";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "select-all";
    selectAll.title = "全選択";
    const allNames = state.review.map((i) => i.name);
    selectAll.checked =
      allNames.length > 0 && allNames.every((n) => checkedNames.has(n));
    selectAll.addEventListener("change", () => {
      if (selectAll.checked) for (const n of allNames) checkedNames.add(n);
      else checkedNames.clear();
      renderQueue();
    });
    const text = document.createElement("span");
    text.textContent = "レビュー待ち";
    const grow = document.createElement("span");
    grow.className = "grow";
    const btn = document.createElement("button");
    btn.id = "batch-approve";
    btn.type = "button";
    btn.textContent = "選択を既読 (" + checkedNames.size + ")";
    btn.disabled = checkedNames.size === 0;
    btn.addEventListener("click", batchApprove);
    label.append(selectAll, text, grow, btn);
    return label;
  }

  // チェック変更時にヘッダーの表示だけを更新する(全再描画を避ける)
  function updateBatchControls() {
    const btn = $("batch-approve");
    const selectAll = $("select-all");
    if (!btn || !selectAll || !state) return;
    btn.textContent = "選択を既読 (" + checkedNames.size + ")";
    btn.disabled = checkedNames.size === 0;
    const allNames = state.review.map((i) => i.name);
    selectAll.checked =
      allNames.length > 0 && allNames.every((n) => checkedNames.has(n));
  }
```

`renderQueue` 関数を次のとおり変更:

1. 空状態チェック(`if (!state || ...) { ... return; }` ブロック)の**後**に、消えた項目の選択解除を追加(`state` が null の場合に触らないよう、early return の後に置く。`if (state)` ガードは二重の保険):

```js
    // review/ から消えた項目(既読化・注入で移動)は選択から外す
    if (state) {
      const present = new Set(state.review.map((i) => i.name));
      for (const n of [...checkedNames])
        if (!present.has(n)) checkedNames.delete(n);
    }
```

2. 「レビュー待ち」セクションの見出し生成 4 行:

```js
      const label = document.createElement("div");
      label.className = "section";
      label.textContent = "レビュー待ち";
      pane.append(label);
```

を次に置き換え:

```js
      pane.append(renderReviewHeader());
```

(「レビュー済み」セクションの見出しは変更しない)

- [ ] **Step 5: 一括既読の実行関数を追加**

`$("approve-btn").addEventListener(...)` ブロックの直後に追加(`headers` はスクリプト冒頭で定義済みの認証ヘッダーのクロージャ変数):

```js
  async function batchApprove() {
    const names = [...checkedNames];
    if (names.length === 0) return;
    if (!confirm("選択した " + names.length + " 件を既読にしますか?")) return;
    const res = await fetch("/api/approve-batch", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ names })
    });
    if (res.ok) {
      const data = await res.json();
      for (const n of data.moved) checkedNames.delete(n);
      toast(
        data.moved.length + " 件を既読にしました" +
          (data.failed.length > 0 ? "(" + data.failed.length + " 件失敗)" : "")
      );
      await refresh();
    } else toast("一括既読に失敗しました");
  }
```

- [ ] **Step 6: 全テスト・lint・型チェック**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: すべて PASS(ui.html は lint 対象の場合のみ整形指摘に対応)

- [ ] **Step 7: Commit**

```bash
git add plugins/pitcrew/src/server/ui.html
git commit -m "feat: pitcrew ビューアにチェックボックス選択式の一括既読を追加"
```

---

### Task 5: ドキュメント・バージョン・バンドル更新

**Files:**
- Modify: `plugins/pitcrew/README.md`(ビューア節)
- Modify: `plugins/pitcrew/.claude-plugin/plugin.json`(version)
- Modify: バンドル生成物(`pnpm build` の出力差分)

**Interfaces:**
- Consumes: Task 1-4 の全変更
- Produces: リリース可能な 0.9.3

- [ ] **Step 1: README のビューア節に一括既読・新しい順を追記**

`plugins/pitcrew/README.md` のビューア(/pitcrew:serve)を説明している節を探し、機能列挙に以下の内容を追記する(節の既存の文体・箇条書き形式に合わせること):

- 一覧は新しい順(ID 降順)で表示される
- 「レビュー待ち」の各項目はチェックボックスで選択でき、「全選択」トグルと「選択を既読 (N)」ボタンで一括既読できる(確認ダイアログあり)

- [ ] **Step 2: バージョンを 0.9.3 に上げる**

`plugins/pitcrew/.claude-plugin/plugin.json`:

```json
  "version": "0.9.3"
```

- [ ] **Step 3: バンドルを再生成**

Run: `pnpm build`
Expected: 正常終了。`git status` で生成物(`plugins/pitcrew/scripts/` 等)の差分を確認

- [ ] **Step 4: 最終確認(全テスト・lint・型)**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: すべて PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/pitcrew/README.md plugins/pitcrew/.claude-plugin/plugin.json plugins/pitcrew/scripts
git status  # 他に生成物差分があれば add する
git commit -m "chore: pitcrew 0.9.3(ビューア新しい順ソート・一括既読)"
```

---

## 実機確認(実装完了後・ユーザーと共に)

自動テストの対象外である UI は、ユーザーに以下を実機確認してもらう:

1. `/pitcrew:serve` でビューアを起動し、一覧が新しい順であること
2. チェックボックスで複数選択 → 「選択を既読 (N)」→ confirm → toast 報告 → 一覧から消えること
3. 全選択トグルの動作(全選択 → 一括既読で全件一掃)
4. チェックボックスクリックで詳細ペインが切り替わらないこと(stopPropagation)
