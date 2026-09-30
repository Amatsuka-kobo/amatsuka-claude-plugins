# agent-policy 同じ役割に置いた特化定義への振り分け 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じ役割マーカーを宣言する定義が複数あるとき、オーケストレーターが委譲のたびに特化定義 → 汎用定義 → `general` → ビルトインの順で選べるようにする。

**Architecture:** 選び方の本体は共通規律 `references/orchestration-discipline.md` の文言で表す。フックが変えるのは、役割マーカーの対応表の冒頭文 1 文だけである。利用者の Agent 定義と frontmatter の契約は変えない。

**Tech Stack:** TypeScript(ESM)、vitest、esbuild、pnpm workspace

**Spec:** `harness-docs/design/2026-09-30-agent-policy-role-specialization-design.md`(承認済み。以下「設計書」)

## Global Constraints

- バージョンは `0.21.0-dev` から `0.21.1-dev` に上げる。`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` を揃える。
- 設計書 §3.1 と §3.2 に書いた変更後の文言は、そのまま使う。言い回しを変えない。
- 規律の文言に「段」「順 N」「版」を使わない。選ぶ順の各項目は「ステップ N」、表の行は「N 行目」と書く。
- `plugins/*/scripts/` は手で編集しない。`src/` を変えて `pnpm run build` で再生成し、同じコミットに含める。
- `references/**/*.md` を編集する前に `prompt-smith:prompt-smith` を起動し、その規律に従う。
- TypeScript と Markdown の編集は Serena の編集ツールで行う。
- Done の条件は `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` が通ること。

## Review Focus

このリポジトリの規律文には、文言を検査するテストが無い。次の 5 点は、どのタスクのテストも確かめない。各タスクの手順に、grep で確かめるステップを入れた。

1. 特化定義が 1 件だけの役割で、その定義に当たらない作業が来たとき。新しい節の冒頭文「1 件のときはその定義へ委譲する」により、その 1 件へ委譲される。ステップ 3 へは進まない(設計書 §2.2)。
2. 「設計書・実装計画書のレビュー」に特化定義しか無く、どれにも当たらないとき。ステップ 3 と 4 へ進まず、レビューを省略する。`:50` の既存の例外と、新しい節の最後の項目が食い違わないこと。
3. `readonly` の役割からステップ 3 で `general` へ回し、委譲先が `Write` / `Edit` を持つとき。依頼文に `:115` の明記が入ること。
4. custom から claude へフォールバックしたセッション。外部ベンダーの定義が表から消え、候補集合が減る。候補が 1 件になった役割は、新しい節の冒頭文どおりその 1 件へ委譲する。
5. SubagentStart フックが同じ冒頭文をサブエージェントへ注入するとき。サブエージェントは再委譲しないので、参照先の節を読めなくても支障はない。冒頭文の変更で SubagentStart の文脈長の上限(`MAX_CONTEXT_CHARS`)を超えないこと。

---

### Task 1: 対応表の冒頭文を差し替える

**Files:**
- Modify: `plugins/agent-policy/src/hooks/marker-scan.ts:235`
- Modify: `plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts:20`
- Modify: `plugins/agent-policy/src/hooks/__test__/session-start.test.ts:23`
- Modify: `plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts:19`
- Regenerate: `plugins/agent-policy/scripts/*.mjs`

**Interfaces:**
- Consumes: なし
- Produces: 冒頭文の文字列。Task 2 が作る節名 §同じ役割の候補から選ぶ を参照する。

- [ ] **Step 1: テスト 3 本の期待値を先に書き換える**

3 ファイルとも、定数の値を次の文字列に置き換える。定数名は `marker-scan.test.ts` が `TABLE_HEADING`、`session-start.test.ts` と `subagent-start.test.ts` が `TABLE_INTRO` である。

```ts
  "次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは、共通規律の §同じ役割の候補から選ぶ に従う。"
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `pnpm vitest run plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts plugins/agent-policy/src/hooks/__test__/session-start.test.ts plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts`
Expected: 冒頭文を比べるテストが FAIL する。

- [ ] **Step 3: `markerTable()` の冒頭文を書き換える**

`plugins/agent-policy/src/hooks/marker-scan.ts` の `lines` 配列の先頭要素を次にする。

```ts
    "次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは、共通規律の §同じ役割の候補から選ぶ に従う。",
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: Step 2 と同じコマンド
Expected: PASS

- [ ] **Step 5: 旧文言が残っていないことを確かめる**

Run: `grep -rn "依頼内容に近いものを選ぶ。\"" plugins/agent-policy/src`
Expected: 出力なし

- [ ] **Step 6: バンドルを再生成する**

Run: `pnpm --filter agent-policy-scripts build`
Expected: 成功し、`git diff --stat plugins/agent-policy/scripts` に `session-start.mjs`・`subagent-start.mjs`・`delegation-gate.mjs` が出る。

- [ ] **Step 7: Review Focus 5 を確かめる**

上限は `subagent-start.ts:16` の `MAX_CONTEXT_CHARS = 9500` である。冒頭文は約 10 字増える。既存の SubagentStart テストが切り詰めに入らないことを、Step 4 の PASS で確かめる。

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/src/hooks plugins/agent-policy/scripts
git commit -m "feat(agent-policy): 対応表の冒頭文を同じ役割の候補の選び方への参照にする"
```

### Task 2: 共通規律に選び方を書く

**Files:**
- Modify: `plugins/agent-policy/references/orchestration-discipline.md`(`:40` `:42` `:46` `:47` `:50` `:120` `:134` `:137` `:142` `:167`、および §委譲先の解決 の直後への節の追加)

**Interfaces:**
- Consumes: Task 1 の冒頭文が参照する節名 §同じ役割の候補から選ぶ
- Produces: 節 §同じ役割の候補から選ぶ

- [ ] **Step 1: `prompt-smith:prompt-smith` を起動する**

- [ ] **Step 2: 解決順の表を書き換える**

`:40` の列見出し `| 順  |` を `| 優先順位 |` にする。`:42` の委譲先欄を次の文にする。表の列幅は揃え直さなくてよい。

```text
その役割の候補集合。集合内の選び方は §同じ役割の候補から選ぶ に従う
```

- [ ] **Step 3: 表の下の項目を書き換える**

`:46` の 1 文を、次の 2 文に置き換える。

```text
- 実務タスクへ着手する前に、役割ごとの委譲先(対応表にある役割では候補集合)を一度確定し、以後タスクごとに確定し直さない。候補集合から 1 件を選ぶことと、その起動形態を決めることは、委譲のたびに行う。
```

`:47` を次の文にする。

```text
- ビルトインは最後の受け皿である。表の 1 行目と 2 行目に該当があるかぎりビルトインへ委譲しない。例外は §同じ役割の候補から選ぶ のステップ 4 だけである。
```

`:50` の「順 2 と順 3 へ進めず」を「表の 2 行目と 3 行目へ進めず」にする。同じ文の他の部分は変えない。

- [ ] **Step 4: 新しい節を置く**

§委譲先の解決 の最後の項目(`:50`)の直後、`## オーケストレーターが自ら担う作業` の前に、次を置く。

```markdown
### 同じ役割の候補から選ぶ

役割マーカーの対応表で、1 つの役割に 2 件以上の定義があるときに当てる。1 件のときはその定義へ委譲する。

委譲のたびに、上から順に評価し、最初に該当したステップで確定する。

1. 同じ役割の特化定義のうち、担当に作業が含まれるもの。複数当たるときは依頼内容に近いものを選ぶ。
2. 同じ役割の汎用定義。
3. 「その他のタスク」の役割。その役割の候補に、件数を問わずこの節のステップ 1 とステップ 2 を当てる。
4. ビルトイン Agents。元の役割の種別が `readonly` なら `Explore`、`impl` なら `general-purpose` とする。

- 特化定義は、`description` か本文が担当をディレクトリ・技術領域・機能領域のいずれかに限っている定義である。
- 汎用定義は、その限定が無い定義である。
- 「その他のタスク」の役割そのものへ委譲するときは、ステップ 3 を飛ばす。
- ステップ 3 は種別を問わず当てる。
- ステップ 3 で回した作業は、起動形態の判定でも「その他のタスク」の役割として扱う。
- 元の役割の種別が `readonly` で、ステップ 3 の委譲先が `Write` / `Edit` を持つときは、§モデル別役割の運用 の `readonly` の明記を依頼文に入れる。
- ステップ 4 のビルトインへ注入するモデルは、担当表の「Claude モデル」列で元の役割に当たる値とする。
- 「設計書・実装計画書のレビュー」はステップ 3 とステップ 4 へ進めず、ステップ 1 とステップ 2 に該当が無ければそのレビューを省略する。
```

- [ ] **Step 5: 後段の参照を書き換える**

`:120` を次の文にする。

```text
- 役割マーカーの対応表が注入されているとき、その役割の委譲先を担当表より優先してその定義とする。同じ役割に複数あるときは §同じ役割の候補から選ぶ に従う。
```

`:134` の第 2 文「役割に対して委譲先を選ぶときはこの節を当てず、§委譲先の解決 に従って実務タスクの着手前に一度だけ確定させる。」を次の文にする。

```text
役割に対して委譲先を選ぶときは、委譲先を §委譲先の解決 と §同じ役割の候補から選ぶ で決め、起動形態を委譲のたびにこの節で決める。
```

`:137` の「`custom-policy` の運用では、役割モデルは役割マーカーの対応表でその役割に解決された定義の `model` である。」を次の 2 文にする。同じ項目の他の文は変えない。

```text
`custom-policy` の運用では、役割モデルは §同じ役割の候補から選ぶ でそのタスクに選んだ定義の `model` である。委譲先がビルトインのときは、担当表の「Claude モデル」列で元の役割に当たる値とする。
```

`:142` の列見出し `| 順  |` を `| 優先順位 |` にする。

`:167` を次の文にする。

```text
- ホストは、§同じ役割の候補から選ぶ でそのタスクに選んだ定義とする。
```

- [ ] **Step 6: 文言を確かめる**

Run: `grep -nE "順 ?[0-9]|\| 順 |依頼内容に近いものを選ぶ|一度だけ確定|段 ?[0-9]" plugins/agent-policy/references/orchestration-discipline.md`
Expected: 出力は 2 件だけ。解決順の表の 2 行目の委譲先欄と、新しい節のステップ 1 である。どちらも「依頼内容に近いものを選ぶ」を含み、残してよい。

- [ ] **Step 7: Review Focus 1〜4 を読み合わせる**

新しい節と `:46` `:47` `:50` `:115` を通して読み、次の 4 点がこの文言から一意に決まることを確かめる。決まらなければ、設計書の文言のどこが足りないかをオーケストレーターへ差し戻す。
- 特化定義 1 件だけの役割では、その 1 件へ委譲する。
- 「設計書・実装計画書のレビュー」はステップ 3 と 4 へ進まない。
- `readonly` からステップ 3 へ回したとき、`:115` の明記が入る。
- 候補が 1 件に減った役割は、その 1 件へ委譲する。

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/references/orchestration-discipline.md
git commit -m "feat(agent-policy): 同じ役割の候補から委譲のたびに選ぶ規律を足す"
```

### Task 3: 利用者向けの説明とバージョン

**Files:**
- Modify: `plugins/agent-policy/README.md`(§役割を選んで自分の定義を作る の、マーカーの説明の段落の直後)
- Modify: `README.md`(ルート。`#### カスタムエージェント`)
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json`
- Modify: `plugins/agent-policy/package.json`

**Interfaces:**
- Consumes: Task 2 の選ぶ順
- Produces: なし

- [ ] **Step 1: プラグインの README に節を足す**

「このマーカーは、その役割の委譲先候補になることに加えて、…マーカーを外してください。」の段落の直後に、次を置く。

```markdown
### 同じ役割に複数の定義を置く

同じ役割マーカーを宣言する定義を、複数置けます。たとえば `frontend-general-implementer` と `backend-general-implementer` に、どちらも `agent-policy-role: normal-impl` を付けられます。定義を分けるときは、担当するディレクトリ・技術領域・機能領域を `description` と本文に書いてください。frontmatter に新しい欄は要りません。

オーケストレーターは委譲のたびに、次の順で委譲先を選びます。

1. 同じ役割の定義のうち、担当に作業が含まれるもの
2. 同じ役割の定義のうち、担当を限っていないもの(汎用定義)
3. 「その他のタスク」(`general`)の役割の定義。選び方は 1 と 2 と同じです
4. ビルトインの `Explore`(読み取り専用の役割)または `general-purpose`

担当の限定を書かない定義は汎用定義として扱われます。どの定義にも当たらない作業を受けさせたい定義は、担当を限らずに書いてください。「設計書・実装計画書のレビュー」だけは 3 と 4 へ進まず、該当が無ければレビューを省略します。
```

- [ ] **Step 2: ルートの README に 1 行足す**

`#### カスタムエージェント` の「Agents 定義の名前、本文、その他フロントマターは利用者が自由に編集できます。<br>」の直後に、次の行を置く。

```markdown
同じ役割の定義を領域ごとに複数置くと、オーケストレーターが依頼内容に合う定義を委譲のたびに選びます。<br>
```

- [ ] **Step 3: バージョンを上げる**

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `"version": "0.21.0-dev"` を `"version": "0.21.1-dev"` にする。

Run: `grep -rn '"version"' plugins/agent-policy/.claude-plugin/plugin.json plugins/agent-policy/package.json`
Expected: 2 行とも `0.21.1-dev`

- [ ] **Step 4: コミット**

```bash
git add plugins/agent-policy/README.md README.md plugins/agent-policy/.claude-plugin/plugin.json plugins/agent-policy/package.json
git commit -m "docs(agent-policy): 同じ役割に複数の定義を置く方法を説明し 0.21.1-dev に上げる"
```

### Task 4: 全体の検査とメモリの追随

**Files:**
- Modify(該当があれば): `.serena/memories/` 配下

- [ ] **Step 1: lint・typecheck・test を通す**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: すべて成功

- [ ] **Step 2: Serena メモリの記述を確かめる**

Run: `grep -rnE "依頼内容に近い|一度確定|1 役割 1|順 [0-9]" .serena/memories`
Expected: 出力なし。出力があれば、設計書 §2.2・§2.3 に合わせて Serena の `edit_memory` で直し、コミットする。

- [ ] **Step 3: 作業ツリーが空であることを確かめる**

Run: `git status --short`
Expected: `docs/chat/` の記録以外に出力なし

### Task 5: 新しいセッションでの実機確認(ユーザーと行う)

**Files:**
- Create(確認の後に削除): `.claude/agents/verify-frontend-impl.md`、`.claude/agents/verify-backend-impl.md`、`.claude/agents/verify-generic-impl.md`

- [ ] **Step 1: 確認用の定義を 3 件置く**

3 件とも `agent-policy-role: normal-impl` を付け、`model` は既存の `general-implementer` と同じ値にする。`description` は次のとおりにする。
- `verify-frontend-impl`: 「frontend(UI コンポーネントとスタイル)の実装を担当する。」
- `verify-backend-impl`: 「backend(API と DB アクセス)の実装を担当する。」
- `verify-generic-impl`: 「通常の実装を担当する。」

- [ ] **Step 2: 新しいセッションで 3 種の作業を依頼する**

frontend の作業、backend の作業、CI 設定の修正を 1 つずつ依頼する。transcript で Agent 呼び出しの `subagent_type` を読み、それぞれ `verify-frontend-impl`・`verify-backend-impl`・`verify-generic-impl` になっていることを確かめる。

- [ ] **Step 3: 汎用定義を外して確かめる**

`verify-generic-impl.md` を外して新しいセッションを開き、CI 設定の修正を依頼する。委譲先が `general` の定義になり、依頼文に外部定義の本文が入っていないことを確かめる。

- [ ] **Step 4: `general` の定義も外して確かめる**

`general` の定義も一時的に外して新しいセッションを開き、CI 設定の修正を依頼する。委譲先が `general-purpose` になり、`model` に担当表の `normal-impl` の Claude モデルが入ることを確かめる。

- [ ] **Step 5: 確認用の定義を取り除き、外した定義を戻す**

Run: `git status --short .claude/agents`
Expected: 出力なし
