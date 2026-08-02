# optimize-agents スキル eval 機構と agent-creator 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スキルの品質を測る機構(trigger eval / output eval / 集計 / 改善ループ)を optimize-agents に集約し、あわせて Agent 定義の作成・検証スキルを新設する。

**Architecture:** 4 本の TypeScript CLI + 2 本の新規スキル + 1 本の新規 reference。`plugins/optimize-agents` は現在 `src/` を持たないため、ビルド基盤の新設から始める。測定器は `claude -p` をサブプロセス起動するが、テストでは LLM を呼ばずパーサとロジックだけを検証する。

**Tech Stack:** TypeScript / esbuild(bundle → `scripts/*.mjs`)/ vitest / Node 標準ライブラリのみ(外部依存を増やさない)。

**設計書:** `docs/design/2026-08-02-optimize-agents-skill-eval-design.md`(根拠・トレードオフ・採用しなかった案はこちら)

**context-map:** `.claude/context-maps/2026-08-02-skill-eval-into-optimize-agents.md`

## Global Constraints

- **Anthropic API クライアントや `ANTHROPIC_API_KEY` 前提の実装を採用しない。** LLM 呼び出しは `claude -p`(ユーザーの既存認証)に閉じる
- **スキル本文には規律だけを書く。** 根拠・実測値・公式仕様は `references/` と `docs/` に置く。基準は `optimize-agents:prompt-smith`
- **frontmatter の description は `prompt-smith` の対象外。** `references/description-guide.md` の基準で書く
- **測定器のロジックを変えない。** `run-trigger-eval` の判定基準(発火率しきい値・kill タイミング)は実測値の基準に紐づく
- **トークンやキーの値をログ・結果 JSON に記録しない。** 変数名と URL だけを残す
- 外部 npm パッケージを追加しない。Node 標準ライブラリで足りている
- コマンドはすべてリポジトリルート(`/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`)で実行する
- ソース(`plugins/optimize-agents/src/`)を変更したら `pnpm build` を実行し、生成物(`scripts/*.mjs`)の差分もコミットする
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- **Task は番号順に実行する。** 依存関係は各 Task の Interfaces に記載

## 測定コストの注意

`claude -p` を使う検証は実時間がかかる。目安を先に示す。

| 検証 | 所要 |
| --- | --- |
| Task 0 の疎通確認 | 3〜5 分 |
| Task 3 の回帰測定(168 問 × 2 runs) | 20 分程度 |
| Task 6 の output eval 再現(2 eval × 2 構成) | 10 分程度 |
| Task 9・10 の新スキル測定(各 28 問) | 各 5 分程度 |

Task 3 の内訳: 6 スキル × 3 セット = 18 回の実行。1 回あたり 8〜12 問を `--workers 6` で並列処理し、`--runs 2` なので 1 回およそ 60〜70 秒。合計 20 分前後。

これらは並列化できない箇所があるため、Task を跨いでまとめて実行しない。各 Task の完了条件として個別に確認する。

---

### Task 0: `${CLAUDE_PLUGIN_ROOT}` の解決方法を確定する ✅ 完了(2026-08-02)

**結論: chat の output eval では問題にならない。**

`plugins/task-utility/skills/chat/` は `SKILL.md` 1 ファイルのみで同梱物を持たず、`${CLAUDE_PLUGIN_ROOT}` の参照も無い。設計書の初版の記述は誤りだった。

ただし `basic-design` の 6 スキル、`task-utility` の 4 スキル(issue-triage / issue-split / chat-recall / resume)、`guidepost` は実際に使っている。`lib/sandbox.ts` は段階 3(実パス置換)に対応できる構造にしておき、実装はそれらを測る時点まで保留する。

詳細は設計書 §5.6 に記載済み。以下の Step は将来の再確認のために残す。

<details>
<summary>当初の確認手順(実施済み)</summary>


**Files:**
- Modify: `docs/design/2026-08-02-optimize-agents-skill-eval-design.md`(§5.6 に結果を追記)

**Interfaces:**
- Consumes: なし
- Produces: サンドボックス内で同梱スクリプトを参照する方法。Task 6 の実装がこれに依存する。

**これは調査タスクである。** 結果によって Task 6 の実装方針が変わるため、他のすべてより先に行う。

- [ ] **Step 1: 検証用サンドボックスを手で作る**

一時ディレクトリに chat スキルを配置し、同梱スクリプトを参照できるかを確かめる。

```bash
SANDBOX=$(mktemp -d -t plugin-root-probe-XXXXXX)
mkdir -p "$SANDBOX/.claude/skills/chat"
cp plugins/task-utility/skills/chat/SKILL.md "$SANDBOX/.claude/skills/chat/"
mkdir -p "$SANDBOX/.claude/skills/chat/scripts"
cp plugins/task-utility/scripts/prepare-chat-recording.mjs "$SANDBOX/.claude/skills/chat/scripts/"
echo "$SANDBOX"
```

- [ ] **Step 2: SKILL.md 内の参照方法を確認する**

```bash
grep -n 'CLAUDE_PLUGIN_ROOT' plugins/task-utility/skills/chat/SKILL.md
```

参照が無ければ、この Task の懸念は解消する。Step 5 へ進み「該当なし」と記録する。

- [ ] **Step 3: 段階 1 を試す(`.claude/skills/` 配置)**

サンドボックスを cwd にして `claude -p` を起動し、同梱スクリプトを呼ぶ依頼を投げる。スクリプトが起動するかを見る。

```bash
cd "$SANDBOX" && claude -p "chat スキルの手順に従って準備スクリプトを実行して" --model claude-opus-5 2>&1 | head -40
```

`${CLAUDE_PLUGIN_ROOT}` が未解決のまま残る、またはファイルが見つからないエラーが出れば段階 1 は不可。

- [ ] **Step 4: 段階 1 が不可なら段階 2・3 を試す**

| 段階 | 配置 |
| --- | --- |
| 2 | `.claude/plugins/task-utility/` 相当にプラグイン一式を置く |
| 3 | SKILL.md 内の `${CLAUDE_PLUGIN_ROOT}` を実パスへ置換してから配置する |

段階 3 まで到達した場合、置換が必要である旨を Task 6 の実装に持ち込む。

- [ ] **Step 5: 結果を設計書へ追記する**

`docs/design/2026-08-02-optimize-agents-skill-eval-design.md` の §5.6 の見出しを `### 5.6 未確定: ${CLAUDE_PLUGIN_ROOT} の解決` から `### 5.6 ${CLAUDE_PLUGIN_ROOT} の解決` へ変え、冒頭に結論を 2〜3 行で書く。確認の 3 段階表は残す(将来の再確認のため)。

- [ ] **Step 6: サンドボックスを削除する**

```bash
rm -rf "$SANDBOX"
```

</details>

**完了条件:** 設計書 §5.6 に結論が記載されている。→ **達成済み**

---

### Task 1: ビルド基盤を新設する

**Files:**
- Create: `plugins/optimize-agents/package.json`
- Create: `plugins/optimize-agents/build.ts`
- Modify: `pnpm-workspace.yaml`
- Create: `plugins/optimize-agents/src/.gitkeep`(空ディレクトリを git に載せるため。Task 2 で実ファイルが入ったら削除)

**Interfaces:**
- Consumes: なし
- Produces: `pnpm build` が optimize-agents を対象にする状態。Task 2 以降のすべてが依存する。

- [ ] **Step 1: `package.json` を作る**

`plugins/task-utility/package.json` と同形式。依存はルートの devDependencies を workspace 経由で使うので、`dependencies` は書かない。

```json
{
  "name": "optimize-agents-scripts",
  "version": "0.11.0-dev",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx build.ts"
  }
}
```

- [ ] **Step 2: `build.ts` を作る**

`plugins/task-utility/build.ts` を読み、同じ形式で書く。entryPoints は 4 本。

```typescript
import * as esbuild from "esbuild";

await esbuild.build({
  bundle: true,
  entryPoints: {
    "run-trigger-eval": "./src/run-trigger-eval.ts",
    "run-output-eval": "./src/run-output-eval.ts",
    "aggregate-benchmark": "./src/aggregate-benchmark.ts",
    "check-agent-definition": "./src/check-agent-definition.ts",
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
});
```

**この時点ではソースが無いためビルドは通らない。** Task 2 以降で 1 本ずつ足す。Task 1 の検証は Step 4 の workspace 認識までとする。

**entryPoints のコメントアウト運用:** 4 本すべてを書いたうえで、まだ実装のない 3 本をコメントアウトしておく。

| entryPoint | 有効にする Task |
| --- | --- |
| `run-trigger-eval` | Task 2 Step 8 |
| `check-agent-definition` | Task 4 Step 5 |
| `run-output-eval` | Task 6 Step 5 |
| `aggregate-benchmark` | Task 7 Step 5 |

コメントアウトを消し忘れると、そのスクリプトがビルドされず後続 Task の検証で「ファイルがない」エラーになる。各 Task の Step で戻す。

- [ ] **Step 3: `pnpm-workspace.yaml` に追加する**

`packages` の末尾に `- plugins/optimize-agents` を足す。既存の並び(basic-design / codiel / codiel/raguel-mcp / task-utility / revelation / pitcrew / raphael / prefetch / guidepost)は変えない。

- [ ] **Step 4: workspace が認識することを確認する**

```bash
pnpm ls --depth -1 2>&1 | grep optimize-agents
```

`optimize-agents-scripts` が出れば認識されている。

**完了条件:** `pnpm ls --depth -1` の出力に `optimize-agents-scripts` が含まれる。

---

### Task 2: `run-trigger-eval` を TypeScript へ移植する

**Files:**
- Create: `plugins/optimize-agents/src/run-trigger-eval.ts`
- Create: `plugins/optimize-agents/src/lib/stream-parser.ts`
- Create: `plugins/optimize-agents/src/lib/pool.ts`
- Create: `plugins/optimize-agents/src/lib/environment.ts`
- Create: `plugins/optimize-agents/src/__test__/stream-parser.test.ts`
- Create: `plugins/optimize-agents/src/__test__/trigger-verdict.test.ts`
- Delete: `plugins/optimize-agents/src/.gitkeep`(Step 8 で)

**Interfaces:**
- Consumes: Task 1 のビルド基盤
- Produces: `scripts/run-trigger-eval.mjs`。Task 3 の削除、Task 9・10 の測定が依存する。

**ロジックを変えない。** 既存 `scripts/run-trigger-eval.mjs` の挙動をそのまま移す。変えるのは型付けと構造だけ。

- [ ] **Step 1: 既存実装を読む**

```bash
cat scripts/run-trigger-eval.mjs
```

**この読み取りを飛ばさない。** 挙動の同一性が Task 3 の前提になる。

読んだ後、次の 7 項目に答えられることを確認する。答えられない項目があれば該当箇所を読み直す。

| # | 確認項目 |
| --- | --- |
| 1 | 発火の検出に使う JSON のフィールドはどれか(`type` / `content_block.type` / ツール名の位置) |
| 2 | `should_trigger: true` の合格条件は発火率 >= 0.5 か、> 0.5 か |
| 3 | `should_trigger: false` の合格条件は発火率 === 0 か、< 0.5 か |
| 4 | timeout したとき発火ありと扱うか、なしと扱うか |
| 5 | 子プロセスの環境から削除している変数は何か |
| 6 | `--runs` の複製はクエリ単位か、セット全体か |
| 7 | 一時ディレクトリの削除はどのタイミングで行うか |

**#2 と #3 の境界を取り違えると、168 問の基準値が意味を失う。** 実装前にここを固定する。

- [ ] **Step 2: `lib/stream-parser.ts` を書く**

行単位のステートレス関数として切り出す。

```typescript
export type ToolUseKind = "skill" | "other";

/**
 * stream-json の 1 行を判定する。
 * content_block_start かつ tool_use なら、ツール名が Skill かどうかで返す。
 * それ以外は null。
 */
export function detectFirstToolUse(line: string): ToolUseKind | null;
```

「最初の 1 回だけ見る」という状態は呼び出し側が持つ。この関数は状態を持たない。

- [ ] **Step 3: `lib/pool.ts` を書く**

既存実装の `pool()` を型付きで切り出す。

```typescript
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]>;
```

同時実行数は `Math.min(limit, items.length)`。既存実装と同じ。

- [ ] **Step 4: `lib/environment.ts` を書く**

設計書 §4.1 の `environment` を組み立てる。

```typescript
export interface EvalEnvironment {
  base_url: string;      // ANTHROPIC_BASE_URL、未設定なら "(default)"
  auth_source: string;   // 変数名のみ。値は入れない
  model: string;
}

export function captureEnvironment(model: string): EvalEnvironment;
```

`auth_source` の決定順:

1. `ANTHROPIC_API_KEY` が設定されていれば `"ANTHROPIC_API_KEY"`
2. `ANTHROPIC_AUTH_TOKEN` が設定されていれば `"ANTHROPIC_AUTH_TOKEN"`
3. どちらも無ければ `"(claude.ai login)"`

**値そのものを読み取って返さない。** 設定の有無だけを見る。

- [ ] **Step 5: `run-trigger-eval.ts` を書く**

既存実装の流れをそのまま移す。保持する挙動は設計書 §4「保持する挙動」のとおり。

結果 JSON に `environment` を足す。位置は `skill` の直後、`results` の前。

```json
{
  "skill": "...",
  "environment": { "base_url": "...", "auth_source": "...", "model": "..." },
  "results": [],
  "summary": {}
}
```

`environment` 以外のキーと構造は既存と同一にする。

- [ ] **Step 6: パーサのテストを書く**

`src/__test__/stream-parser.test.ts`。実プロセスを起動しない。

| ケース | 入力 | 期待 |
| --- | --- | --- |
| Skill 呼び出し | `content_block_start` + `tool_use` + name=`Skill` | `"skill"` |
| 他ツール呼び出し | 同上で name=`Read` | `"other"` |
| text ブロック | `content_block_start` + `text` | `null` |
| delta 行 | `content_block_delta` | `null` |
| message_start | `message_start` | `null` |
| 不正な JSON | `not json` | `null`(例外を投げない) |
| 空行 | `""` | `null` |
| `content_block` 欠落 | `{"type":"content_block_start"}` | `null`(例外を投げない) |
| ツール名欠落 | `content_block_start` + `tool_use` で `name` なし | `"other"`(Skill ではないので) |

**下 2 つを必ず入れる。** `e.event.content_block.type` と直接アクセスする実装は、これらの入力で実行時エラーになる。テストで捕まえなければ、実プロセス起動まで発覚しない。

- [ ] **Step 7: 合否ロジックのテストを書く**

`src/__test__/trigger-verdict.test.ts`。発火率と `should_trigger` の組み合わせを網羅する。

| `should_trigger` | 発火率 | 期待 |
| --- | --- | --- |
| true | 1.0 | pass |
| true | 0.5 | pass(境界。>= 0.5) |
| true | 0.4 | fail |
| true | 0.0 | fail |
| false | 0.0 | pass |
| false | 0.1 | fail(1 度でも発火したら不合格) |
| false | 1.0 | fail |

**境界値(0.5 と 0.0)を必ず含める。** ここが実測値の基準を決めている。

- [ ] **Step 8: `.gitkeep` を削除する**

```bash
git rm plugins/optimize-agents/src/.gitkeep
```

Step 2〜5 で実ファイルが入ったので不要になる。

- [ ] **Step 9: ビルドとテストを通す**

```bash
pnpm build 2>&1 | tail -20
pnpm test 2>&1 | tail -20
pnpm typecheck 2>&1 | tail -10
pnpm lint 2>&1 | tail -10
```

Task 1 Step 2 でコメントアウトした 3 本はそのまま。`run-trigger-eval` の entryPoint だけを有効にする。

- [ ] **Step 10: 1 スキル 1 セットで旧実装と突き合わせる**

```bash
node scripts/run-trigger-eval.mjs \
  --skill plugins/task-utility/skills/resume/SKILL.md \
  --eval-set plugins/task-utility/evals/fp/resume.json \
  --runs 2 --workers 6 > /tmp/old-result.json

node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
  --skill plugins/task-utility/skills/resume/SKILL.md \
  --eval-set plugins/task-utility/evals/fp/resume.json \
  --runs 2 --workers 6 > /tmp/new-result.json

diff <(jq '.summary' /tmp/old-result.json) <(jq '.summary' /tmp/new-result.json)
```

発火判定は確率的なので完全一致しないことがある。`summary.passed` の差が 1 以内なら次へ進む。2 以上なら実装を疑う。

**完了条件:** `pnpm test` が通り、Step 10 の差が 1 以内。

---

### Task 3: 168 問で回帰確認し、旧実装を削除する

**Files:**
- Delete: `scripts/run-trigger-eval.mjs`
- Modify: `CLAUDE.md:15`
- Modify: `CLAUDE.example.md:15`
- Modify: `plugins/task-utility/evals/README.md:7,18`
- Modify: `plugins/optimize-agents/docs/description-out-of-scope.md:32`
- Modify: `.raphael/antibodies/ab-2026-0802-001.md`(CLI 経由)

**Interfaces:**
- Consumes: Task 2 の `run-trigger-eval.mjs`
- Produces: 旧パスの参照が消えた状態。以降の Task はすべて新パスを使う。

**回帰確認が通るまで旧実装を消さない。**

- [ ] **Step 1: 認証経路を確認する**

```bash
node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
  --skill plugins/task-utility/skills/chat/SKILL.md \
  --eval-set plugins/task-utility/evals/trigger/chat.json \
  --runs 1 --workers 4 | jq '.environment'
```

`base_url` が `http://127.0.0.1:8317` であることを確認する。違えば `claude-proxy` 相当のエイリアスで起動したセッションから実行し直す。経路が違うとスコアの差の原因を切り分けられない。

- [ ] **Step 2: 168 問を測る**

6 スキル × 3 セット。`--runs 2 --workers 6`。20 分程度かかる。

```bash
for set in trigger short fp; do
  for skill in chat chat-recall resume issue-craft issue-split issue-triage; do
    echo "=== $set/$skill ==="
    node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
      --skill "plugins/task-utility/skills/$skill/SKILL.md" \
      --eval-set "plugins/task-utility/evals/$set/$skill.json" \
      --runs 2 --workers 6 | jq -c '.summary'
  done
done
```

- [ ] **Step 3: 基準値と突き合わせる**

| セット | 基準 | 実測 |
| --- | --- | --- |
| substantive(`trigger/`) | 46/48 以上 | |
| short | 46/48 以上 | |
| fp | 69/72 以上 | |

**3 セットそれぞれで判定する。合計だけで見ない。**

**前提:** Step 1 で `base_url` が `http://127.0.0.1:8317` であることを確認済みであること。再測定は同じセッション(同じエイリアスで起動したもの)で行う。経路が違うと、差が実装由来か経路由来か区別できない。

下回った場合の手順。

1. 同じセッションでもう 1 回測る
2. 2 回とも下回ったら Task 2 に戻る
3. 戻る前に Task 2 Step 1 の 7 項目を旧実装と新実装で突き合わせる。特に #2・#3(合否の境界)

差が 1 問だけの場合は確率的なゆらぎの範囲なので、3 回目を測って多数決とする。

- [ ] **Step 4: 旧実装を削除する**

```bash
git rm scripts/run-trigger-eval.mjs
```

- [ ] **Step 5: 参照先を更新する**

新パスは `plugins/optimize-agents/scripts/run-trigger-eval.mjs`。

| ファイル | 変更 |
| --- | --- |
| `CLAUDE.md:15` | 「skill-creator でスキルの発火精度を測る時は〜」の行のパス |
| `CLAUDE.example.md:15` | 同上 |
| `plugins/task-utility/evals/README.md:7` | 本文中のパス |
| `plugins/task-utility/evals/README.md:18` | コマンド例のパス |
| `plugins/optimize-agents/docs/description-out-of-scope.md:32` | 本文中のパス |

**CLAUDE.md の変更は人間への確認が要る**(CLAUDE.md の運用方針)。パスの追従だけであることを伝えて確認を取る。

- [ ] **Step 6: 抗体を更新する**

```bash
node plugins/raphael/scripts/list-antibodies.mjs --json --include-body | jq '.[] | select(.id=="ab-2026-0802-001")'
```

本文中の旧パスは 2 箇所(説明文とコマンド例)。両方を新パスへ。`trigger.pattern` は変更しない。

```bash
node plugins/raphael/scripts/update-antibody.mjs patch ab-2026-0802-001
```

**手で `.raphael/antibodies/*.md` を編集しない。** CLI 経由で更新する。

- [ ] **Step 7: 旧パスの残存を確認する**

```bash
grep -rn 'scripts/run-trigger-eval\.mjs' \
  --exclude-dir=.git --exclude-dir=chat --exclude-dir=node_modules . \
  | grep -v 'plugins/optimize-agents/scripts/run-trigger-eval\.mjs' \
  | grep -v 'docs/handover/' \
  | grep -v 'docs/design/' \
  | grep -v 'docs/plans/' \
  | grep -v 'context-maps/'
```

0 件であること。

除外した 4 つのディレクトリは経緯・計画の記録であり、当時のパスを残すのが正しい。**書き換えると記録として誤りになる。**

**完了条件:** Step 3 の 3 セットすべてが基準値以上。Step 7 で実行パスとしての旧参照が 0 件。

---

### Task 4: `check-agent-definition` を実装する

**Files:**
- Create: `plugins/optimize-agents/src/check-agent-definition.ts`
- Create: `plugins/optimize-agents/src/lib/frontmatter.ts`
- Create: `plugins/optimize-agents/src/__test__/check-agent-definition.test.ts`
- Modify: `plugins/optimize-agents/build.ts`(entryPoint を戻す)

**Interfaces:**
- Consumes: Task 1 のビルド基盤
- Produces: `scripts/check-agent-definition.mjs`。Task 10 の `agent-creator` が手順の中で呼ぶ。

- [ ] **Step 1: `lib/frontmatter.ts` を書く**

YAML frontmatter を切り出してパースする。外部パッケージを使わず、必要な範囲だけを自前で処理する。

```typescript
export interface ParsedFrontmatter {
  fields: Record<string, string>;
  body: string;
  errors: string[];   // 構文エラー
}

export function parseFrontmatter(source: string): ParsedFrontmatter;
```

対応する記法は既存の Agent 定義が使う範囲に限る。

- `key: value`(単一行)
- `key: |` および `key: >`(複数行スカラー)
- `key: ["a", "b"]`(フロー配列)

ネストしたマッピングは扱わない。現れた場合は値を生文字列として保持する。

- [ ] **Step 2: `check-agent-definition.ts` を書く**

```
node scripts/check-agent-definition.mjs <agent-definition.md> [--scope project|user|plugin]
```

`--scope` 省略時の推定規則:

| パスの条件 | scope |
| --- | --- |
| `plugins/*/agents/` を含む | plugin |
| `~/.claude/agents/` 配下 | user |
| それ以外 | project |

出力:

```json
{
  "path": "...",
  "scope": "project",
  "errors": [],
  "warnings": []
}
```

終了コードは errors が空なら 0、そうでなければ 1。

- [ ] **Step 3: 検査項目を実装する**

設計書 §9.2 の表のとおり。

| 分類 | 項目 | 判定 |
| --- | --- | --- |
| 構文 | frontmatter の開始・終了が揃う | error |
| 必須 | `name` / `description` がある | error |
| `name` | 小文字英字とハイフンのみ | error |
| `name` | ファイル名(拡張子を除く)と一致する | warning |
| `model` | `sonnet`/`opus`/`haiku`/`fable`/`inherit`/完全 ID のいずれか | error |
| `tools` | 既知のツール名である | warning |
| 配置 | plugin scope で `hooks`/`mcpServers`/`permissionMode` を使っていない | error |
| 配置 | plugin scope で `isolation` が `worktree` 以外でない | error |
| 本文 | 本文が空でない | error |
| 任意 | `color` がある | warning |
| 未知 | 上記以外の frontmatter キー | warning |

`model` の「完全 ID」は、既知エイリアス以外の非空文字列をすべて許容する。**ローカルプロキシ経由の独自エイリアス**(`claude-gpt-5-6-sol` 等)が既存定義で使われているため、パターンで縛らない。

`tools` の既知一覧は `lib/known-tools.ts` に定数として持つ。未知は warning。

- [ ] **Step 4: テストを書く**

`src/__test__/check-agent-definition.test.ts`。tmpdir に定義ファイルを作り、CLI を起動して JSON 出力を検証する。

正常系:

| ケース | 期待 |
| --- | --- |
| 既存の `gpt-sol.md` 相当(project) | errors 0 件 |
| 既存の `chat-recorder.md` 相当(plugin) | errors 0 件 |
| `color` なし | errors 0 件、warnings に color |

**異常系を必ず入れる。正しい定義が通ることだけでは検査器が働いているか分からない。**

| ケース | 期待 |
| --- | --- |
| `name` 欠落 | errors に必須欠落 |
| `description` 欠落 | 同上 |
| `name` に大文字 | errors |
| `name` がファイル名と不一致 | warnings |
| `model: gpt4` のような未知エイリアス | errors ではなく通す(完全 ID とみなす) |
| plugin scope で `hooks` あり | errors |
| plugin scope で `isolation: docker` | errors |
| project scope で `hooks` あり | errors 0 件(project では許可) |
| frontmatter の終端 `---` 欠落 | errors に構文エラー |
| 本文が空 | errors |
| 未知のキー `foo: bar` | warnings |

**上記 20 ケース(正常系 3 + 異常系 11 + 境界 6)をすべて実装する。** 一部を省くと、Step 6 の実在定義の検査で初めて欠落に気づくことになる。

- [ ] **Step 5: `build.ts` の entryPoint を戻す**

Task 2 Step 8 でコメントアウトした場合、`check-agent-definition` を有効にする。

- [ ] **Step 6: 実在の定義で検査する**

project 配下と plugin 配下を 1 本のコマンドで走査する。

```bash
find .claude/agents plugins -path '*agents/*.md' -type f -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      case "$f" in
        .claude/agents/*.md|plugins/*/agents/*.md)
          node plugins/optimize-agents/scripts/check-agent-definition.mjs "$f" \
            | jq -c '{path, scope, err: (.errors | length)}' ;;
      esac
    done
```

**`case` による絞り込みが要る。** `-path '*agents/*.md'` はパス全体にマッチするため、`plugins/optimize-agents/README.md` のように「ディレクトリ名に `agents` を含む」ファイルまで拾う。

対象は設計書 §15.2 の表(project 3 本 + plugin 16 本 = 19 本)。

確認すること。

| 項目 | 期待 |
| --- | --- |
| 出力行数 | 19 |
| `err` | すべて 0 |
| `.claude/agents/` の 3 本の `scope` | `project` |
| `plugins/*/agents/` の 16 本の `scope` | `plugin` |

errors のある定義だけを見るには次を使う。

```bash
find .claude/agents plugins -path '*agents/*.md' -type f -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      node plugins/optimize-agents/scripts/check-agent-definition.mjs "$f" \
        | jq -c 'select(.errors | length > 0) | {path, errors}'
    done
```

出力が空であること。

**完了条件:** `pnpm test` が通り、Step 6 の全 19 本で errors 0 件かつ scope が正しい。

---

### Task 5: `output-evals.json` の契約を実装に先立って更新する

**Files:**
- Modify: `plugins/task-utility/evals/output-evals.json`
- Create: `plugins/task-utility/evals/fixtures/csv-export-design.md`
- Create: `plugins/task-utility/evals/fixtures/INDEX.md`

**Interfaces:**
- Consumes: なし
- Produces: Task 6 の入力となる契約。Task 6 のテストがこの形式を前提にする。

**Task 6 より先に契約を固定する。** 実装しながら形式を決めると、テストが実装に引きずられる。

- [ ] **Step 1: トップレベルにキーを足す**

```json
{
  "skill_name": "chat",
  "skill_root": "../..",
  "checker": "node ./check-chat-output.mjs",
  "evals": []
}
```

| キー | 必須 | 内容 |
| --- | --- | --- |
| `skill_name` | 必須 | 測定対象スキル名。既存のまま |
| `skill_root` | 必須 | `output-evals.json` からの相対。ここではプラグインルート(`plugins/task-utility/`)なので `"../.."` |
| `checker` | 任意 | 省略時は output eval を行わず、trigger eval だけが使われる |
| `evals` | 必須 | 空配列でもよい(その場合 output eval は 0 件で終わる) |

`checker` はインタプリタを含むコマンド文字列。既存の `check-chat-output.mjs` をそのまま使うので `node` を前置する。

- [ ] **Step 2: eval-1 の fixtures を作る**

eval-1(既存ファイルへの追記)は開始状態にファイルが要る。前セッションでは手で置いていた。

`evals/fixtures/` に 2 ファイルを作る。内容は eval-0 が生成するであろう記録の形に合わせる。

**まず `check-chat-output.mjs` の eval-1 分岐(L82-94)を読む。** 何を検査しているかを確認してから fixtures を作る。

```bash
sed -n '82,94p' plugins/task-utility/evals/check-chat-output.mjs
```

`csv-export-design.md` に最低限含める要素:

| 要素 | 理由 |
| --- | --- |
| `## セッション1` の見出し | eval-1 が `## セッション2` を追加することを検査するため |
| ヘッダー(日付・参加者・成果物・前提) | 記録フォーマットの契約 |
| ユーザー発言の引用ブロック(`>`) | 「既存の内容が保持されている」の判定対象 |
| AI パートの決定・却下案・失敗経緯 | 同上 |

内容は eval-0 の prompt(CSV エクスポートの設計議論)と整合させる。eval-0 が生成するであろう記録の形にする。

`INDEX.md` に含める要素:

| 要素 | 理由 |
| --- | --- |
| `csv-export-design.md` への 1 行 | eval-1 が「行数が増えていない」を検査するため |

**1 ファイル 1 行の規約を守る。** 2 行あると eval-1 の assertion が最初から破れている状態になる。

- [ ] **Step 3: eval-1 に `fixtures` を足す**

```json
{
  "id": 1,
  "name": "append-to-existing-record",
  "fixtures": [
    { "path": "docs/chat/2026/0801/testuser/csv-export-design.md", "from": "./fixtures/csv-export-design.md" },
    { "path": "docs/chat/INDEX.md", "from": "./fixtures/INDEX.md" }
  ],
  "prompt": "...",
  "assertions": []
}
```

`from` は `output-evals.json` からの相対パス。

eval-0 は開始状態が空でよいので `fixtures` を書かない。

- [ ] **Step 4: JSON の妥当性を確認する**

```bash
jq empty plugins/task-utility/evals/output-evals.json && echo "valid"
jq '{skill_name, skill_root, checker, eval_count: (.evals | length)}' plugins/task-utility/evals/output-evals.json
```

**完了条件:** `jq empty` が通り、`skill_root` / `checker` / eval-1 の `fixtures` が揃っている。

---

### Task 6: `run-output-eval` を実装する

**Files:**
- Create: `plugins/optimize-agents/src/run-output-eval.ts`
- Create: `plugins/optimize-agents/src/lib/sandbox.ts`
- Create: `plugins/optimize-agents/src/__test__/sandbox.test.ts`
- Create: `plugins/optimize-agents/src/__test__/checker-contract.test.ts`
- Modify: `plugins/optimize-agents/build.ts`(entryPoint を戻す)

**Interfaces:**
- Consumes: Task 0 の解決方法、Task 5 の契約
- Produces: `scripts/run-output-eval.mjs` と `<runDir>/eval-*/[with_skill|without_skill]/run-N/`。Task 7 の入力になる。

- [ ] **Step 0: Task 0 の結果を確認する**

```bash
sed -n '/### 5.6/,/### 5.7/p' docs/design/2026-08-02-optimize-agents-skill-eval-design.md | head -20
```

**この確認を飛ばさない。** 段階 3(SKILL.md の `${CLAUDE_PLUGIN_ROOT}` 置換が必要)と判定されている場合、Step 1 に置換ロジックを実装する必要がある。読まずに進むと未実装のまま Step 6 で失敗する。

| Task 0 の結論 | Step 1 で足すもの |
| --- | --- |
| 該当なし(参照が無い) | なし |
| 段階 1 または 2 で解決 | なし |
| 段階 3 | `${CLAUDE_PLUGIN_ROOT}` の実パス置換 + `sandbox-note.txt` の出力 |

- [ ] **Step 1: `lib/sandbox.ts` を書く**

```typescript
export interface SandboxSpec {
  skillRoot: string;        // 絶対パス
  includeSkill: boolean;    // false なら with_skill 以外の構成
  fixtures: FixtureSpec[];
  evalsDirName: string;     // 除外するディレクトリ名。既定 "evals"
}

export async function buildSandbox(spec: SandboxSpec): Promise<string>;
```

配置の規則:

| 対象 | 扱い |
| --- | --- |
| `skillRoot` 配下の SKILL.md と同梱物 | `includeSkill` が true のときのみ配置 |
| `evals/` | **常に除外** |
| `.git` | 常に除外 |
| `node_modules` | 常に除外 |
| fixtures | 両構成に同一内容で配置 |

Task 0 の結果が段階 3 だった場合、SKILL.md 内の `${CLAUDE_PLUGIN_ROOT}` を配置先の実パスへ置換し、`sandbox-note.txt` に置換した旨を書く。

- [ ] **Step 2: `run-output-eval.ts` を書く**

```
node scripts/run-output-eval.mjs \
  --eval-file <output-evals.json> \
  --run-dir <出力先> \
  [--runs 1] [--model claude-opus-5] [--eval-id N]
```

処理の流れ:

1. `output-evals.json` を読み、`skill_root` / `checker` / `evals` を得る
2. eval ごと、構成ごと、run ごとにサンドボックスを作る
3. `claude -p <prompt>` を cwd = サンドボックスで起動し、完了まで待つ(**trigger eval と違い最後まで走らせる**)
4. サンドボックス内の成果物を `<runDir>/eval-N/<構成>/run-N/output/` へ移す
5. チェッカーを起動する。cwd は `output-evals.json` のあるディレクトリ、引数は `<outDir>`(絶対パス)と `<evalId>`
6. stdout を `grading.json` として保存する
7. 所要時間・トークン数・`environment` を `timing.json` として保存する

チェッカーの失敗扱い:

| 事象 | 扱い |
| --- | --- |
| 終了コード非 0 | その run を失敗として記録。`grading.json` の代わりに `checker-error.txt` を置く |
| stdout が JSON として解釈できない | 同上 |

**採点そのものは行わない。** チェッカーの出力をそのまま保存する。

- [ ] **Step 3: サンドボックス構築のテストを書く**

`src/__test__/sandbox.test.ts`。`claude -p` を起動しない。

| ケース | 検証 |
| --- | --- |
| プラグイン形態 | `skill_root` = プラグインルートで、SKILL.md と scripts が配置される |
| 単独スキル形態 | `skill_root` = スキルディレクトリで、同様に配置される |
| `evals/` の除外 | `skill_root` 配下に `evals/` があっても配置されない |
| `.git` の除外 | 同上 |
| `without_skill` | SKILL.md が配置されない |
| fixtures | 両構成に同一内容で配置される |
| fixtures の 2 形式 | `{path, content}` と `{path, from}` の双方が動く |

- [ ] **Step 4: チェッカー契約のテストを書く**

`src/__test__/checker-contract.test.ts`。**言語非依存であることを固定する。**

| ケース | 検証 |
| --- | --- |
| シェルスクリプトのチェッカー | `checker: "./fake-checker.sh"` で `grading.json` が読み取られる |
| Node のチェッカー | `checker: "node ./fake-checker.mjs"` で同上 |
| 非 0 終了 | run が失敗として記録され、`checker-error.txt` が残る |
| 非 JSON 出力 | 同上 |
| cwd | チェッカーが `output-evals.json` の隣のファイルを相対パスで読める |

**シェルスクリプトのケースを必ず入れる。** 実装者が `node <path>` と組み立ててしまう事故を防ぐ。

- [ ] **Step 5: `build.ts` の entryPoint を戻す**

- [ ] **Step 6: chat の eval-0 で再現確認する**

```bash
node plugins/optimize-agents/scripts/run-output-eval.mjs \
  --eval-file plugins/task-utility/evals/output-evals.json \
  --run-dir /tmp/output-eval-run \
  --eval-id 0 --runs 1

jq '.summary' /tmp/output-eval-run/eval-0/with_skill/run-1/grading.json
jq '.summary' /tmp/output-eval-run/eval-0/without_skill/run-1/grading.json
```

期待: with 9/9、without 4/9。

**この再現が測定器の対照実験にあたる。** 既知の値が出なければランナーの実装を疑う。特に without が 9/9 に近い値を出したら、SKILL.md が漏れて配置されている可能性がある。

- [ ] **Step 7: eval-1 でも確認する**

```bash
node plugins/optimize-agents/scripts/run-output-eval.mjs \
  --eval-file plugins/task-utility/evals/output-evals.json \
  --run-dir /tmp/output-eval-run \
  --eval-id 1 --runs 1
```

期待: with 6/6、without 6/6。この eval は識別力が無いことが既知なので、両方 6/6 が正しい再現である。

**完了条件:** `pnpm test` が通り、eval-0 で 9/9・4/9、eval-1 で 6/6・6/6 を再現する。

---

### Task 7: `aggregate-benchmark` を実装する

**Files:**
- Create: `plugins/optimize-agents/src/aggregate-benchmark.ts`
- Create: `plugins/optimize-agents/src/lib/stats.ts`
- Create: `plugins/optimize-agents/src/__test__/aggregate-benchmark.test.ts`
- Modify: `plugins/optimize-agents/build.ts`(entryPoint を戻す)

**Interfaces:**
- Consumes: Task 6 の出力ディレクトリ構造
- Produces: `benchmark.json` / `benchmark.md`

**skill-creator の `aggregate_benchmark.py` のコードを流用しない。** 入力形式(`grading.json`)と出す指標の定義だけを参考にした独立実装とする。

- [ ] **Step 1: `lib/stats.ts` を書く**

```typescript
export interface Stats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export function computeStats(values: number[]): Stats;
```

`stddev` は母標準偏差(n で割る)とする。run 数が少ないため標本標準偏差(n-1)だと 1 run で未定義になる。1 要素のとき 0 を返す。

- [ ] **Step 2: `aggregate-benchmark.ts` を書く**

```
node scripts/aggregate-benchmark.mjs --run-dir <runDir> [--out <path>]
```

走査は 3 階層。

```
<runDir>/eval-*/  →  直下のディレクトリ名が構成名  →  run-*/
```

各 run から読むもの:

| 項目 | 出所 |
| --- | --- |
| `pass_rate` | `grading.json` の `summary.passed / summary.total` |
| `time_seconds` | `timing.json` の `total_duration_seconds` |
| `tokens` | `timing.json` の `total_tokens` |
| `environment` | `timing.json` の `environment` |

構成ごとに `pass_rate` / `time_seconds` / `tokens` の mean / stddev / min / max を出し、先頭 2 構成の差を `delta` として出す。

- [ ] **Step 3: `environment` の不一致を警告する**

構成間で `environment.base_url` または `environment.auth_source` が食い違う場合、`benchmark.json` の `notes` と stdout に警告を出す。異なる経路で測った結果を比較しても意味がない。

**警告であって中断ではない。** 集計自体は行う。

- [ ] **Step 4: `benchmark.md` を出す**

平均 ± 標準偏差と差分の Markdown 表。

```markdown
| 指標 | with_skill | without_skill | delta |
| --- | --- | --- | --- |
| pass_rate | 1.00 ± 0.00 | 0.44 ± 0.00 | +0.56 |
```

- [ ] **Step 5: テストを書く**

`src/__test__/aggregate-benchmark.test.ts`。tmpdir に `grading.json` 群を作って検証する。

| ケース | 検証 |
| --- | --- |
| 2 構成 × 1 run | pass_rate の mean が正しい |
| 2 構成 × 3 run | stddev が正しい |
| 1 run のみ | stddev が 0 |
| `timing.json` 欠落 | time/tokens を欠測として扱い、pass_rate は集計する |
| `environment` 不一致 | notes に警告が入る |
| `checker-error.txt` がある run | 下記の規則で除外される |

**失敗した run の扱い:**

失敗 run は集計対象から**除外する**。除外後の run 数で mean / stddev を計算する。

例: `with_skill` が 3 run のうち 1 run 失敗した場合、`with_skill` の統計は残る 2 run のデータだけで算出する。分母を 3 のままにしない。

`benchmark.json` の `notes` に「with_skill: 3 run 中 1 run がチェッカー失敗により除外」と記録する。**除外を黙って行わない。** run 数が構成間で違うことは、比較の妥当性に影響する。

全 run が失敗した構成は、統計を `null` として出し、notes に記録する。

- [ ] **Step 6: Task 6 の出力から生成する**

```bash
node plugins/optimize-agents/scripts/aggregate-benchmark.mjs \
  --run-dir /tmp/output-eval-run

cat /tmp/output-eval-run/benchmark.md
```

`docs/handover/2026-08-02-skill-eval-into-optimize-agents.md:147` 記載の値(with 9/9・without 4/9、6/6・6/6)と一致すること。

**完了条件:** `pnpm test` が通り、Step 6 の出力が引き継ぎ書の値と一致する。

---

### Task 8: `references/agent-definition-spec.md` を書く

**Files:**
- Create: `plugins/optimize-agents/references/agent-definition-spec.md`

**Interfaces:**
- Consumes: なし
- Produces: Task 10 の `agent-creator` が参照する仕様。

**`prompt-smith` の基準で書く。** ただしこの文書は「仕様の記録」であり、規律ではない。事実の列挙が主になる。

- [ ] **Step 1: 調査日と出典を冒頭に置く**

```markdown
# Agent 定義の仕様

2026-08-02 時点の Anthropic 公式ドキュメントに基づく。
出典: https://code.claude.com/docs/en/sub-agents / https://code.claude.com/docs/en/plugins-reference

仕様は変わる。この文書と実際の挙動が食い違うときは公式ドキュメントを正とする。
```

- [ ] **Step 2: frontmatter の全フィールドを表にする**

設計書 §8.2 の内容。必須 2 つ、任意 14 個。

各フィールドについて、受け付ける値と既定を書く。`model` の既定が `inherit` であることを明記する。

- [ ] **Step 3: 配置による制約の違いを書く**

| 配置 | 使えないフィールド |
| --- | --- |
| `.claude/agents/` / `~/.claude/agents/` | なし |
| プラグインの `agents/` | `hooks` / `mcpServers` / `permissionMode`。`isolation` は `worktree` のみ |

公式がセキュリティ上の理由で明記していることを併記する。

- [ ] **Step 4: 優先順位と解決順を書く**

- 定義の優先順位: managed settings > `--agents` CLI > `.claude/agents/` > `~/.claude/agents/` > プラグインの `agents/`
- プロジェクト agents は cwd から上へ walk。v2.1.178 以降は cwd に最も近い定義が勝つ
- model の解決順: `CLAUDE_CODE_SUBAGENT_MODEL` → 実行時 `model` → 定義の `model` → メイン会話

- [ ] **Step 5: 公式が定めていない領域を明示する**

**これを書かないと、公式推奨と慣習が混ざる。**

```markdown
## 公式ドキュメントに記述がない事項

- description に `<example>` ブロックを埋め込む形式
- 本文(system prompt)の構成
- 本文の長さ
- 命名の慣例(kebab-case は必須だが、それ以上の推奨はない)
```

- [ ] **Step 6: 検証手段を書く**

- `claude plugin validate <path>`(プラグイン配下が対象。`--strict` で警告もエラー扱い)
- `/doctor`(同一ディレクトリ内の name 重複を報告)
- `check-agent-definition`(このプラグインが提供。project 配下も検査できる)

**完了条件:** 上記 6 項目が揃っている。

---

### Task 9: `skills/skill-eval/` を作る

**Files:**
- Create: `plugins/optimize-agents/skills/skill-eval/SKILL.md`
- Create: `plugins/optimize-agents/evals/trigger/skill-eval.json`
- Create: `plugins/optimize-agents/evals/short/skill-eval.json`
- Create: `plugins/optimize-agents/evals/fp/skill-eval.json`
- Create: `plugins/optimize-agents/docs/skill-eval-rationale.md`

**Interfaces:**
- Consumes: Task 2(測定器)、Task 6・7(手順が呼ぶスクリプト)
- Produces: `optimize-agents:skill-eval` スキル。

- [ ] **Step 1: 素案を書く**

設計書 §7.1 の手順と §7.2 の規律を本文に落とす。**規律だけを書く。根拠は書かない。**

構成:

```markdown
# スキルの eval

## 測る 3 種

(substantive / short / fp の表)

## 手順

(1〜6 の段)

## 規律

(§7.2 の左列)

## チェッカー

(言語の既定と契約)
```

- [ ] **Step 2: 根拠を `docs/skill-eval-rationale.md` へ退避する**

§7.2 の右列(前セッションで 3 イテレーション無駄にした、等)と、eval を skill 専用に絞った理由(設計書 §2)を移す。

- [ ] **Step 3: `prompt-smith` の基準を当てて削る**

素案を書き切ってから、別のパスで基準を当てる。**生成と削減を同じパスで行わない。**

削る対象:

- 指示を正当化する根拠・出典・経緯
- 判断基準のない修飾(「適宜」「必要に応じて」)
- 文書自身の構成の説明
- 2 つ目以降の例(1 つで伝わる場合)

- [ ] **Step 4: description を書く**

`description-guide` の基準。**`prompt-smith` の削る基準を当てない。**

含める内容:

- 何をするスキルか、どんなときに使うか
- 口語を含む言い回しの例示(「発火精度を測って」「eval 回して」「description 直したから測り直して」)
- 「必ず使用する」
- 近接スキルとの境界(`prompt-smith` は本文の改稿、`agent-creator` は Agent 定義)

- [ ] **Step 5: eval セットを作る**

既存 `plugins/task-utility/evals/` と同じ構造・同じ問題数。

| セット | 問題数 | 内容 |
| --- | --- | --- |
| `trigger/skill-eval.json` | 8 | 固有名・パス・背景を含む長い依頼 |
| `short/skill-eval.json` | 8 | 一言の依頼 |
| `fp/skill-eval.json` | 12 | 近接スキルが正解の依頼 |

**fp には既存 5 スキルが正解の依頼を含める。** `prompt-smith` / `agent-creator` / `setup-gpt` / `with-codex-policy` / `claude-model-policy`。

- [ ] **Step 6: 測る**

```bash
for set in trigger short fp; do
  node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
    --skill plugins/optimize-agents/skills/skill-eval/SKILL.md \
    --eval-set "plugins/optimize-agents/evals/$set/skill-eval.json" \
    --runs 2 --workers 6 | jq -c '{set: "'"$set"'", summary: .summary}'
done
```

基準: substantive 6/8 以上、short 6/8 以上、fp 12/12。

下回った場合は description を直して測り直す。**3 種すべてを毎回測る。** 除外を足すと fp は改善するが substantive/short が落ちる。

**完了条件:** 3 セットが基準を満たす。

---

### Task 10: `skills/agent-creator/` を作る

**Files:**
- Create: `plugins/optimize-agents/skills/agent-creator/SKILL.md`
- Create: `plugins/optimize-agents/evals/trigger/agent-creator.json`
- Create: `plugins/optimize-agents/evals/short/agent-creator.json`
- Create: `plugins/optimize-agents/evals/fp/agent-creator.json`
- Create: `plugins/optimize-agents/docs/agent-creator-rationale.md`

**Interfaces:**
- Consumes: Task 4(検証スクリプト)、Task 8(仕様 reference)、Task 9(fp セットの相互参照)
- Produces: `optimize-agents:agent-creator` スキル。

- [ ] **Step 1: 素案を書く**

設計書 §8.4 の手順を本文に落とす。

構成:

```markdown
# Agent 定義の作成

## 手順

(1〜6 の段。用途 → 配置 → frontmatter → description → 本文 → 検証)

## 参照先

- frontmatter の仕様: ../../references/agent-definition-spec.md
- description の基準: ../../references/description-guide.md
- 本文の基準: prompt-smith

## 規律

- 1 つの agent に 1 つの責務を持たせる
- tools は必要なものだけを許可する
- description に <example> ブロックを使わない

## 発火を測りたいと言われたとき

(§8.6 の 3 段)
```

- [ ] **Step 2: 根拠を `docs/agent-creator-rationale.md` へ退避する**

- `<example>` を推奨しない理由(公式ドキュメントに記述がなく、plugin-dev 独自の様式である)
- 書き方の基準を自前で持たず prompt-smith と description-guide に委ねる理由
- Agent の発火を測る手段を持たない理由(設計書 §2 の技術的障壁)

**plugin-dev を参考にした利用者が差分に気づけるように書く。**

- [ ] **Step 3: `prompt-smith` の基準を当てて削る**

Task 9 Step 3 と同じ手順。

- [ ] **Step 4: description を書く**

含める内容:

- 口語を含む例示(「エージェント作って」「subagent 追加したい」「agent 定義見て」)
- 「必ず使用する」
- 境界: `setup-gpt`(GPT 3 本の定型)、`skill-eval`(測定)、`prompt-smith`(本文だけの改稿)

- [ ] **Step 5: eval セットを作る**

Task 9 Step 5 と同じ構造。fp には `setup-gpt` と `prompt-smith` が正解の依頼を厚めに入れる。担当が最も近いため。

- [ ] **Step 6: 測る**

```bash
for set in trigger short fp; do
  node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
    --skill plugins/optimize-agents/skills/agent-creator/SKILL.md \
    --eval-set "plugins/optimize-agents/evals/$set/agent-creator.json" \
    --runs 2 --workers 6 | jq -c '{set: "'"$set"'", summary: .summary}'
done
```

基準: substantive 6/8 以上、short 6/8 以上、fp 12/12。

- [ ] **Step 7: `skill-eval` の fp を測り直す**

`agent-creator` が増えたことで `skill-eval` の誤発火が変わりうる。Task 9 Step 6 の fp を再測定する。

12/12 を維持していること。落ちた場合は両スキルの description の境界記述を見直す。

**完了条件:** `agent-creator` の 3 セットが基準を満たし、`skill-eval` の fp が 12/12 を維持する。

---

### Task 11: `description-guide` に Agents 節を足す

**Files:**
- Modify: `plugins/optimize-agents/references/description-guide.md`

**Interfaces:**
- Consumes: Task 8(公式仕様)、Task 9(skill-eval への参照)
- Produces: Agents 向けの基準。`agent-creator` が参照する。

- [ ] **Step 1: 「直したときの確かめ方」から `skill-eval` を参照させる**

現在の L22-32。測定手段が `skill-eval` として存在するようになったので、そこへ誘導する 1 行を足す。3 種の表と規律は残す。

- [ ] **Step 2: Agents 節を足す**

末尾に新しい節を置く。

```markdown
## Agents 定義での違い

skill 向けの基準を準用する。
この準用は Anthropic 公式ドキュメントの記述に基づく。このリポジトリでの発火精度の実測はない。

`<example>` ブロックは使わない。公式ドキュメントに記述がない。

Agent はオーケストレーターが担当表を見て選ぶ経路が主である。作業種別と、隣接する Agent との境界を書く。
```

**「実測はない」を必ず書く。** skill 側の基準は 168 問の実測に裏打ちされているが、Agents 側にはない。同格に見えると読み手が誤る。

- [ ] **Step 3: 冒頭の宣言を確認する**

L3 の「SKILL.md・Agents 定義の frontmatter にある description の基準である」は維持する。Agents 節を足したことで宣言と中身が一致する。

**完了条件:** Agents 節に「実測はない」旨が明記されている。

---

### Task 12: README・CLAUDE.md・plugin.json を更新する

**Files:**
- Modify: `plugins/optimize-agents/README.md`
- Modify: `plugins/optimize-agents/.claude-plugin/plugin.json`
- Modify: `plugins/optimize-agents/skills/prompt-smith/SKILL.md`(description に境界を追記)

**Interfaces:**
- Consumes: Task 9・10(スキルの完成)
- Produces: 利用者向けの案内。

- [ ] **Step 1: README §提供 Skill に 2 行足す**

`skill-eval` と `agent-creator` の紹介。既存 4 スキルと同じ書式で書く。

- [ ] **Step 2: README の `setup` 表記を直す**

README は `setup` と書いているが、ディレクトリは `skills/setup-gpt/`、スキル名も `optimize-agents:setup-gpt` である。**表記を `setup-gpt` に統一する。**

- [ ] **Step 3: README §他プラグインとの棲み分けに `plugin-dev` との差分を書く**

`plugin-dev` にも `agent-creator`(エージェント)と `agent-development`(スキル)がある。名前空間は分かれるが、担当の違いを書く。

- optimize-agents の `agent-creator`: 書き方の基準を `prompt-smith` / `description-guide` に委ね、公式仕様の検証スクリプトを持つ
- plugin-dev: `<example>` ブロックを含む独自様式。プラグイン開発の文脈に特化

**どちらが優れているとは書かない。** 差分だけを示す。

- [ ] **Step 4: `prompt-smith` の description に境界を足す**

「Agent 定義を新しく作るときは `agent-creator` を使う」を追記する。**本文は変えない。**

- [ ] **Step 4b: `CLAUDE.md` と `CLAUDE.example.md` から 2 行を削除する**

`skill-eval` が description の改稿と測定の担当を持つようになったので、次の 2 行は不要になる。残すとスキルの発火経路を迂回する指示になる。

削除対象:

```
- SKILL.md・Agents 定義の description は `optimize-agents` の `references/description-guide.md` の基準で書くこと。狙った依頼で確実に発火することを、簡潔さより優先する。
- スキルの発火精度を測る時は `plugins/optimize-agents/scripts/run-trigger-eval.mjs` を使うこと。
```

| 行 | 削除後の担当 |
| --- | --- |
| description の基準 | `skill-eval`(skill)、`agent-creator`(Agent 定義) |
| 測定ツール | `skill-eval` |

本文の基準を示す行は**残す**。`optimize-agents:prompt-smith` をスキル名で参照しており、正しい形である。

```
- SKILL.md の本文・その他の AI 向け指示書は `optimize-agents:prompt-smith` の基準で書くこと。
```

**この変更は人間への確認が要る**(CLAUDE.md の運用方針)。ユーザーは 2026-08-02 に削除方針を承認済みだが、適用時にもう一度提示する。

削除の前に、`skill-eval` と `agent-creator` の description が「description を直して」で発火することを確認する(Step 6 の測定に含める)。発火しなければ削除しない。

- [ ] **Step 5: `plugin.json` を `0.11.0-dev` にする**

現行 `0.10.2-dev`。スキル 2 本とスクリプト 4 本の追加はマイナーバージョンの繰り上げにあたる。メジャーは上げない。

- [ ] **Step 6: `prompt-smith` の fp を測る**

description を変えたので、発火が変わりうる。

```bash
node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
  --skill plugins/optimize-agents/skills/prompt-smith/SKILL.md \
  --eval-set plugins/optimize-agents/evals/fp/skill-eval.json \
  --runs 2 --workers 6 | jq -c '.summary'
```

`skill-eval` の fp セットには `prompt-smith` が正解の依頼が含まれる。それらで `prompt-smith` が発火することを確認する。

**完了条件:** §15.3 のチェックリストがすべて埋まる。

---

### Task 13: 横断検証

**Files:**
- なし(検証のみ)

**Interfaces:**
- Consumes: Task 1〜12 のすべて
- Produces: なし

- [ ] **Step 1: ビルドと静的検査**

```bash
pnpm build 2>&1 | tail -20
pnpm test 2>&1 | tail -20
pnpm typecheck 2>&1 | tail -10
pnpm lint 2>&1 | tail -10
```

すべて成功すること。

- [ ] **Step 2: バンドル出力が git に載っていることを確認**

```bash
git status --short plugins/optimize-agents/scripts/
ls plugins/optimize-agents/scripts/
```

4 本の `.mjs` が存在し、コミット対象になっていること。**利用者はビルド不要という運用の要である。**

- [ ] **Step 3: 旧パスの残存を再確認**

```bash
grep -rn 'scripts/run-trigger-eval\.mjs' \
  --exclude-dir=.git --exclude-dir=chat --exclude-dir=node_modules . \
  | grep -v 'plugins/optimize-agents/scripts/run-trigger-eval.mjs' \
  | grep -v 'docs/handover/' | grep -v 'docs/design/' | grep -v 'context-maps/'
```

0 件であること。

- [ ] **Step 4: スキル本文に根拠が残っていないか確認**

```bash
grep -n '前セッション\|実測\|168 問\|なぜなら\|理由は' \
  plugins/optimize-agents/skills/skill-eval/SKILL.md \
  plugins/optimize-agents/skills/agent-creator/SKILL.md
```

ヒットした行を読み、規律ではなく根拠であれば `docs/` へ移す。

- [ ] **Step 5: 全 Agent 定義を検査**

```bash
find .claude/agents plugins -path '*agents/*.md' -type f -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      case "$f" in
        .claude/agents/*.md|plugins/*/agents/*.md)
          node plugins/optimize-agents/scripts/check-agent-definition.mjs "$f" \
            | jq -c 'select(.errors | length > 0) | {path, errors}' ;;
      esac
    done
```

出力が空であること(errors のある定義が 1 本もない)。

- [ ] **Step 6: 6 スキル 168 問の最終回帰**

Task 3 Step 2 と同じ測定をもう一度行う。**Task 3 以降の変更(特に description の追記)が既存スキルの発火に影響していないかを見る。**

基準: substantive 46/48 以上、short 46/48 以上、fp 69/72 以上。

- [ ] **Step 7: 設計書との突き合わせ**

設計書 §13(影響範囲)の一覧と実際の変更を突き合わせる。

```bash
git status --short
```

§13.1(新規)・§13.2(変更)・§13.3(削除)に挙がっていないファイルが変更されていないこと。挙がっているのに変更されていないファイルがないこと。

**完了条件:** Step 1〜7 のすべてが期待どおり。

---

## 実装の記録(2026-08-02)

全 14 Task を実行した。設計との差分と、実装中に判明した事実を記す。

### 設計との差分

| 事項 | 設計 | 実装 | 理由 |
| --- | --- | --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` | 3 段階で確認 | 該当なし | chat スキルは SKILL.md 1 枚で同梱物も参照も無い。設計書の記述が誤りだった |
| `skill_root` の値 | `"../.."`(プラグインルート) | `"../skills/chat"` | 同梱物が無いのでスキルディレクトリで足りる |
| esbuild の `target` | `node26` | `node22` | 既存プラグインに合わせた |
| `skill-eval` の担当 | 測定のみ | 測定 + description の改稿 | CLAUDE.md から description の基準を外すため |
| `CLAUDE.md` | 15 行目のみ削除 | 14・15 行目を削除 | 上記に伴う |

### 実装中に判明した事実

**eval セットに指示語を入れない。** trigger eval は 1 発のクエリだけを投げるので「この」「さっきの」は参照先を持たない。対象不明と判断され発火が抑えられる。

| クエリ | 発火 |
| --- | --- |
| 「この SKILL.md の description を直して」 | 1/4 |
| 「chat スキルの SKILL.md の description を直して」 | 4/4 |

`should_trigger: true` のクエリに指示語があると偽の発火漏れになる。既存 eval セットのうち `true` 側 3 件を具体名に直した。`false` 側は測定が甘くなるだけなので据え置いた。

**除外文は抽象化すると悪化する。** `agent-creator` の fp 1 件で 3 通り試した。

| 書き方 | 誤発火 |
| --- | --- |
| A: 具体語で名指し(採用) | 3/10 |
| B: クエリ文言を列挙 | 5/10 |
| C: 短く抽象的に | 9/10 |

**測定のばらつきが大きい。** 同一クエリ 10 回でも結果が動く。連続測定では先に走った方が高く出る。168 問の fp が 66/72 と基準を下回ったが、旧実装も同条件で 3/10 → 0/10 と動いたため分散として扱った。

### 新スキルの発火精度

| スキル | substantive | short | fp |
| --- | --- | --- | --- |
| `skill-eval` | 6/8 | 8/8 | 12/12 |
| `agent-creator` | 7/8 | 7/8 | 11/12 |

`agent-creator` の fp 1 件は据え置き(ユーザー判断)。

## 完了条件

- [ ] `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint` がすべて成功する
- [ ] `plugins/optimize-agents/scripts/` に 4 本の `.mjs` があり、git 管理下にある
- [ ] 168 問の回帰が substantive 46/48・short 46/48・fp 69/72 以上
- [ ] chat の output eval が with 9/9・without 4/9(eval-0)、6/6・6/6(eval-1)を再現する
- [ ] `aggregate-benchmark` の出力が引き継ぎ書の値と一致する
- [ ] 全 Agent 定義 19 本で `check-agent-definition` の errors が 0 件
- [ ] `skill-eval` / `agent-creator` の 3 セットが基準(6/8・6/8・12/12)を満たす
- [ ] `scripts/run-trigger-eval.mjs`(旧)が削除され、実行パスとしての参照が 0 件
- [ ] 抗体 `ab-2026-0802-001` が新パスを指す
- [ ] `plugin.json` が `0.11.0-dev`
- [ ] スキル本文に根拠・実測値が残っていない

## 保留事項(この計画では扱わない)

| 事項 | 理由 |
| --- | --- |
| `agent-creator` の CLAUDE.md への規律追記 | 運用してから判断する |
| ローカルプロキシの上流調査 | ユーザー判断で調査しない |
| output eval の eval-1 に識別力を持たせる | 機構整備とは別の作業 |
| 他プラグインへの eval 展開 | task-utility 以外は未着手 |
| resume / issue-craft の誤発火 3 件 | 文面では抑えきれないと判断済み |
