# agent-policy 同梱エージェント化と自動注入 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent-policy のエージェント定義 7 種をプラグイン同梱で提供し、モデルエイリアスと方針の自動注入を 5 つの環境変数で運用できるようにする。

**Architecture:** 同梱定義の `model` には既定エイリアスをリテラルで書く。環境変数が既定と異なるときだけ、SessionStart フックが同梱定義の `model` 行を差し替えた定義をプロジェクトの `.claude/agents/` へ生成する。同じフックが `AMATSUKA_AGENT_AUTO_INJECTION` に従って方針スキルの使用指示を `additionalContext` として注入する。

**Tech Stack:** TypeScript(esbuild で ESM へバンドル)、vitest、Claude Code のプラグイン機構(agents / hooks)

**Spec:** `harness-docs/design/2026-08-16-agent-policy-bundled-agents-design.md`

## Global Constraints

- Node は `>=26`、パッケージマネージャは pnpm `11.8.0`。
- スクリプトのソースは `plugins/agent-policy/src/`、バンドル出力は `plugins/agent-policy/scripts/`。バンドル出力は git 管理下に置く。
- `plugins/agent-policy/src/` を変更したら `pnpm build` を実行し、生成物の差分も同じコミットに含める。
- コミット前に `pnpm lint`・`pnpm typecheck`・`pnpm test` を通す。
- TypeScript / JavaScript / Markdown のファイルを作成・編集するときは Serena のツールを使う。
- Agent 定義を作成・点検するときは `prompt-smith:agent-creator` スキルを使う。
- AI 向けの指示書(SKILL.md・references)を編集するときは `prompt-smith:prompt-smith` スキルを使う。
- 既定エイリアスは次の値をリテラルで使う。`gpt-sol` = `claude-gpt-5-6-sol`、`gpt-terra` と `gpt-researcher` = `claude-gpt-5-6-terra`、`gpt-luna` = `claude-gpt-5-6-luna`、`grok-researcher` と `grok-implementer` = `claude-grok-4-5`、`claude-researcher` = `sonnet`。
- 注入する方針指示の文言は `最初に必ず agent-policy:<policy> スキルを使用し、この規律に従う` で固定する。
- 環境変数名は `AMATSUKA_AGENT_GPT_SOL_ALIAS` / `AMATSUKA_AGENT_GPT_TERRA_ALIAS` / `AMATSUKA_AGENT_GPT_LUNA_ALIAS` / `AMATSUKA_AGENT_GROK_ALIAS` / `AMATSUKA_AGENT_AUTO_INJECTION`。
- 原則ブランチは切らない。現在のブランチ `agent-policy-improvement` で作業する。

## ファイル構成

新規:

| パス | 責務 |
| --- | --- |
| `plugins/agent-policy/agents/gpt-sol.md` | 複雑または重要な実装を担う GPT エージェント定義 |
| `plugins/agent-policy/agents/gpt-terra.md` | 通常の実装・一般作業を担う GPT エージェント定義 |
| `plugins/agent-policy/agents/gpt-luna.md` | 軽量な実装を担う GPT エージェント定義 |
| `plugins/agent-policy/agents/gpt-researcher.md` | 独立レビュー・リアルタイム情報調査・探索実働を担う GPT エージェント定義 |
| `plugins/agent-policy/agents/grok-researcher.md` | 同上の Grok 版 |
| `plugins/agent-policy/agents/grok-implementer.md` | 通常・軽量の実装、一般作業を担う Grok エージェント定義 |
| `plugins/agent-policy/agents/claude-researcher.md` | 同上の Claude 版(`model: sonnet`) |
| `plugins/agent-policy/hooks/hooks.json` | SessionStart フックの登録 |
| `plugins/agent-policy/src/hooks/session-start.ts` | 環境変数の読み取り、定義の生成、`additionalContext` の組み立て |
| `plugins/agent-policy/src/hooks/__test__/session-start.test.ts` | 上記の契約テスト |
| `plugins/agent-policy/scripts/session-start.mjs` | 上記のバンドル出力 |

削除:

| パス | 理由 |
| --- | --- |
| `plugins/agent-policy/skills/setup-gpt/` | 同梱化とフックの自動生成で役割を失う |
| `plugins/agent-policy/skills/setup-grok/` | 同上 |
| `plugins/agent-policy/src/setup-agents.ts` | 同上 |
| `plugins/agent-policy/scripts/setup-agents.mjs` | 同上 |
| `plugins/agent-policy/src/__test__/setup-agents.test.ts` | 同上 |

変更:

| パス | 変更内容 |
| --- | --- |
| `plugins/agent-policy/skills/claude-model-policy/SKILL.md` | description の選択条件、担当表、解決順 |
| `plugins/agent-policy/skills/with-codex-policy/SKILL.md` | 同上 |
| `plugins/agent-policy/skills/with-grok-policy/SKILL.md` | description の選択条件、解決順 |
| `plugins/agent-policy/skills/codex-grok-policy/SKILL.md` | description の選択条件、担当表、解決順、フォールバック節 |
| `plugins/agent-policy/build.ts` | エントリーポイントの差し替え |
| `plugins/agent-policy/README.md` | 環境変数の運用手順と移行手順へ書き換え |
| `plugins/agent-policy/.claude-plugin/plugin.json` | version を `0.7.0-dev` へ |
| `plugins/agent-policy/package.json` | version を `0.7.0-dev` へ |
| `.claude-plugin/marketplace.json` | agent-policy の description |
| `README.md` | agent-policy の記述 |

## 検証用のヘルパー

複数のタスクで、プラグインが実際に読み込めるかをヘッドレス実行で確かめる。次のコマンドを使う。リポジトリ外の空ディレクトリで実行することで、リポジトリ自身の `.claude/agents/` に影響されないようにする。

```bash
rm -rf /tmp/ap-verify && mkdir -p /tmp/ap-verify && cd /tmp/ap-verify && claude -p "起動可能なサブエージェント(agent type)の名前を、名前だけカンマ区切りで全て列挙せよ。他の作業はするな。" --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-improvement/plugins/agent-policy --model sonnet --output-format text
```

`--model sonnet` を明示するのは、空ディレクトリではプロジェクトのモデル設定が効かず、既定モデルがプロキシ上に存在しない場合があるためである。

---

### Task 1: 既存 5 定義を同梱へ移設する

**Files:**
- Create: `plugins/agent-policy/agents/gpt-sol.md`
- Create: `plugins/agent-policy/agents/gpt-terra.md`
- Create: `plugins/agent-policy/agents/gpt-luna.md`
- Create: `plugins/agent-policy/agents/grok-researcher.md`
- Create: `plugins/agent-policy/agents/grok-implementer.md`
- Read: `plugins/agent-policy/skills/setup-gpt/assets/*.template.md`
- Read: `plugins/agent-policy/skills/setup-grok/assets/*.template.md`

**Interfaces:**
- Produces: 同梱エージェント `agent-policy:gpt-sol` / `agent-policy:gpt-terra` / `agent-policy:gpt-luna` / `agent-policy:grok-researcher` / `agent-policy:grok-implementer`。Task 3 のフックはこれらのファイルを `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md` として読む。frontmatter には `model: ` で始まる行がちょうど 1 行あり、フックはこの行だけを差し替える。

この時点では旧テンプレートを消さない。削除は Task 6 で行う。

- [ ] **Step 1: `prompt-smith:agent-creator` スキルを読み込む**

Skill ツールで `prompt-smith:agent-creator` を invoke する。以降のステップはこのスキルの規律に従って進める。

- [ ] **Step 2: 5 つのテンプレートを `agents/` へ複製する**

5 ファイルを次の対応で複製する。内容は 1 文字も変えずに写す。

| 複製元 | 複製先 |
| --- | --- |
| `skills/setup-gpt/assets/gpt-sol.template.md` | `agents/gpt-sol.md` |
| `skills/setup-gpt/assets/gpt-terra.template.md` | `agents/gpt-terra.md` |
| `skills/setup-gpt/assets/gpt-luna.template.md` | `agents/gpt-luna.md` |
| `skills/setup-grok/assets/grok-researcher.template.md` | `agents/grok-researcher.md` |
| `skills/setup-grok/assets/grok-implementer.template.md` | `agents/grok-implementer.md` |

- [ ] **Step 3: `{{MODEL_ALIAS}}` を既定エイリアスへ確定させる**

各ファイルの frontmatter にある `model: {{MODEL_ALIAS}}` を、次の値へ置き換える。

```text
agents/gpt-sol.md          model: claude-gpt-5-6-sol
agents/gpt-terra.md        model: claude-gpt-5-6-terra
agents/gpt-luna.md         model: claude-gpt-5-6-luna
agents/grok-researcher.md  model: claude-grok-4-5
agents/grok-implementer.md model: claude-grok-4-5
```

- [ ] **Step 4: プレースホルダが残っていないことを確認する**

Run: `grep -rn "{{MODEL_ALIAS}}" plugins/agent-policy/agents/`
Expected: 一致なし(終了コード 1)

- [ ] **Step 5: `model` 行がちょうど 1 行であることを確認する**

Run: `for f in plugins/agent-policy/agents/*.md; do printf '%s %s\n' "$f" "$(grep -c '^model: ' "$f")"; done`
Expected: 5 ファイルすべてが `1`

- [ ] **Step 6: プラグインが 5 定義を読み込めることを確認する**

「検証用のヘルパー」のコマンドを実行する。
Expected: 出力に `gpt-sol` `gpt-terra` `gpt-luna` `grok-researcher` `grok-implementer` の 5 つがすべて含まれる。プラグイン名前空間が付き `agent-policy:gpt-sol` のような形で現れる場合もある。どちらの表記でも可。

- [ ] **Step 7: `prompt-smith:agent-creator` の規律で 5 定義を点検する**

スキルの点検観点に従い、frontmatter の妥当性、tools の最小性、description の記述を確認する。旧テンプレートからの移設であるため、内容の書き換えは frontmatter の `model` 以外行わない。指摘が出た場合は Task 2 以降のタスクとして切り出し、このタスクでは修正しない。

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/agents/
git commit -m "feat(agent-policy): 既存の GPT/Grok エージェント定義をプラグイン同梱へ移設"
```

---

### Task 2: `gpt-researcher` と `claude-researcher` を新規作成する

**Files:**
- Create: `plugins/agent-policy/agents/gpt-researcher.md`
- Create: `plugins/agent-policy/agents/claude-researcher.md`
- Read: `plugins/agent-policy/agents/grok-researcher.md`(Task 1 で作成済み)

**Interfaces:**
- Consumes: Task 1 が作った `agents/grok-researcher.md`。役割の 3 分類・Output Format・制約はこれを基準に揃える。
- Produces: 同梱エージェント `agent-policy:gpt-researcher` / `agent-policy:claude-researcher`。`gpt-researcher.md` の `model` 行は `model: claude-gpt-5-6-terra`、`claude-researcher.md` は `model: sonnet`。Task 3 のフックは `gpt-researcher` を `AMATSUKA_AGENT_GPT_TERRA_ALIAS` の生成対象に含め、`claude-researcher` は生成対象から除外する。

- [ ] **Step 1: `prompt-smith:agent-creator` スキルを読み込む**

Skill ツールで `prompt-smith:agent-creator` を invoke する。以降のステップはこのスキルの規律に従って進める。

- [ ] **Step 2: 2 定義の要件をスキルへ渡して本文を作る**

満たすべき要件は次のとおり。

共通:

- 3 つの役割を持つ。どの役割かは依頼文の冒頭で指定され、指定がないときは作業に入らず差し戻す。
  - 独立レビュー — 設計書・実装計画書の前提・暗黙の仮定・楽観的な見積もりを検証し、根拠付きの反証を提示する。採否は判断しない。
  - リアルタイム情報調査 — 最新動向・リリース情報・外部エコシステムを、一次情報源の URL と鮮度を添えて報告する。
  - 探索実働 — 指定範囲を走査し、ファイルパスと行番号付きで報告する。
- 成果物(ファイル)を作らず、報告のみを返す。
- 指摘・調査結果の採否を自分で判断しない。
- アドバイザーへの相談をしない。判断に迷ったときは差し戻す。
- 独立レビューでは対象文書の原本のみを読み、他のレビューの指摘が渡されても読まずにその旨を報告する。
- 独立レビューでは、文書が言及するコード・ファイルの実在と記述の整合を確かめてから指摘する。
- 探索実働では依頼された範囲だけを走査し、範囲外に気づいた事項は報告に含めて自分では追わない。
- 役割ごとの Output Format を持つ。
- 読み取り専用とする。`Write` / `Edit` と、ファイルを変更する Serena ツール(`replace_symbol_body` / `insert_after_symbol` / `insert_before_symbol` / `rename_symbol` / `replace_in_files` / `replace_content`)を与えない。tools は `agents/grok-researcher.md` の構成を基準にする。
- Agent Tool を与えない。

`gpt-researcher` 固有:

- `model: claude-gpt-5-6-terra`
- 冒頭の自己紹介は「あなたは GPT Researcher」。
- リアルタイム情報調査の主たる情報源は Context7 と WebSearch / WebFetch とする。
- description は「agent-policy の with-codex-policy 運用方針における `GPT Researcher` に対応する」旨を含める。ファイルを変更する作業は `GPT Terra` / `GPT Luna` が担当する旨も書く。

`claude-researcher` 固有:

- `model: sonnet`
- 冒頭の自己紹介は「あなたは Claude Researcher」。
- 本文に、オーケストレーターと同一ベンダーであるため独立レビューの独立性が限定的であることを明記する。そのうえで、レビュー系統を分ける意義(原本のみを読む・他レビューの指摘を渡されない)を示し、前提検証と反証提示に集中する旨を書く。
- description は「agent-policy の claude-model-policy 運用方針における `Claude Researcher` に対応する」旨を含める。

- [ ] **Step 3: `model` 行を確認する**

Run: `grep -n '^model: ' plugins/agent-policy/agents/gpt-researcher.md plugins/agent-policy/agents/claude-researcher.md`
Expected:

```text
plugins/agent-policy/agents/gpt-researcher.md:4:model: claude-gpt-5-6-terra
plugins/agent-policy/agents/claude-researcher.md:4:model: sonnet
```

行番号は frontmatter の並びによって変わってよい。値が一致することを見る。

- [ ] **Step 4: 書き込み系ツールが含まれていないことを確認する**

Run: `grep -nE '^tools:.*(Write|Edit|replace_|insert_|rename_symbol|Agent)' plugins/agent-policy/agents/gpt-researcher.md plugins/agent-policy/agents/claude-researcher.md`
Expected: 一致なし(終了コード 1)

- [ ] **Step 5: プラグインが 7 定義を読み込めることを確認する**

「検証用のヘルパー」のコマンドを実行する。
Expected: 出力に `gpt-sol` `gpt-terra` `gpt-luna` `gpt-researcher` `grok-researcher` `grok-implementer` `claude-researcher` の 7 つがすべて含まれる。

- [ ] **Step 6: `claude-researcher` が実際に起動することを確認する**

`claude-researcher` は `model: sonnet` でありプロキシを必要としないため、実起動を確かめられる。

```bash
cd /tmp/ap-verify && claude -p "claude-researcher サブエージェントを1回だけ起動し、リポジトリ探索は行わず『疎通確認』とだけ報告させよ。冒頭で役割は『探索実働』と指定せよ。" --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-improvement/plugins/agent-policy --model sonnet --output-format text
```

Expected: エラーにならず、サブエージェントからの報告が返る。

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/agents/gpt-researcher.md plugins/agent-policy/agents/claude-researcher.md
git commit -m "feat(agent-policy): gpt-researcher と claude-researcher の Agent 定義を追加"
```

---

### Task 3: SessionStart フックの方針注入を実装する

**Files:**
- Create: `plugins/agent-policy/src/hooks/session-start.ts`
- Create: `plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
- Modify: `plugins/agent-policy/build.ts`
- Create: `plugins/agent-policy/hooks/hooks.json`

**Interfaces:**
- Produces: `scripts/session-start.mjs`。環境変数だけを入力に取り、stdout へ `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}` を 1 行書く。注入内容が無いときは何も書かない。例外時も stdout へ書かず、終了コードは常に 0。Task 4 はこのファイルへエイリアス差分の処理を追加する。

このタスクでは方針注入だけを実装する。エイリアス差分による定義生成は Task 4 で足す。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/hooks/__test__/session-start.test.ts` を作る。

```typescript
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))

function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, ...overrides }
}

function context(overrides: NodeJS.ProcessEnv): string | undefined {
  const stdout = runTs(HOOK, [], { env: environment(overrides) })
  if (stdout === "") return undefined
  expect(stdout.endsWith("\n")).toBe(true)
  const payload = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string }
  }
  expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart")
  return payload.hookSpecificOutput.additionalContext
}

test("環境変数が無いときは何も出力しない", () => {
  expect(context({})).toBeUndefined()
})

test("AUTO_INJECTION が none のときは何も出力しない", () => {
  expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "none" })).toBeUndefined()
})

test.each([
  ["claude", "claude-model-policy"],
  ["with-codex", "with-codex-policy"],
  ["with-grok", "with-grok-policy"],
  ["with-codex-grok", "codex-grok-policy"]
])("AUTO_INJECTION が %s のとき %s を注入する", (value, policy) => {
  expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: value })).toBe(
    `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
  )
})

test("AUTO_INJECTION が未知の値のときは方針を注入せず警告だけ出す", () => {
  const injected = context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-gemini" })
  expect(injected).toContain("with-gemini")
  expect(injected).not.toContain("スキルを使用し")
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm test plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
Expected: FAIL。`session-start.ts` が存在せず、モジュール解決に失敗する。

- [ ] **Step 3: 最小の実装を書く**

`plugins/agent-policy/src/hooks/session-start.ts` を作る。

```typescript
#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示を additionalContext として注入する。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

const POLICIES: Record<string, string> = {
  claude: "claude-model-policy",
  "with-codex": "with-codex-policy",
  "with-grok": "with-grok-policy",
  "with-codex-grok": "codex-grok-policy"
}

function policyBlock(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "none") return undefined

  const policy = POLICIES[value]
  if (policy === undefined) {
    return `AMATSUKA_AGENT_AUTO_INJECTION の値 "${value}" は未知のため、agent-policy の方針注入をスキップした。`
  }
  return `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
}

function build(env: NodeJS.ProcessEnv): string | undefined {
  const blocks = [policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION)].filter(
    (block): block is string => block !== undefined
  )
  return blocks.length === 0 ? undefined : blocks.join("\n\n")
}

function respond(context: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    })}\n`
  )
}

try {
  const context = build(process.env)
  if (context !== undefined) respond(context)
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error"
  process.stderr.write(`agent-policy session-start: ${message}\n`)
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `pnpm test plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
Expected: PASS(7 件)

- [ ] **Step 5: ビルド定義へエントリーポイントを足す**

`plugins/agent-policy/build.ts` の `entryPoints` を次にする。`setup-agents` は Task 6 で消すため、この時点では残す。

```typescript
  entryPoints: {
    "setup-agents": "./src/setup-agents.ts",
    "session-start": "./src/hooks/session-start.ts"
  },
```

- [ ] **Step 6: フックを登録する**

`plugins/agent-policy/hooks/hooks.json` を作る。

```json
{
  "description": "agent-policy の運用補助: SessionStart で方針スキルの使用指示とエージェント定義の状態を注入する",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: ビルドして生成物を確認する**

Run: `pnpm --filter agent-policy-scripts build`
Expected: `plugins/agent-policy/scripts/session-start.mjs` が生成される。

- [ ] **Step 8: バンドル出力が単体で動くことを確認する**

Run: `AMATSUKA_AGENT_AUTO_INJECTION=with-codex node plugins/agent-policy/scripts/session-start.mjs`
Expected:

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"最初に必ず agent-policy:with-codex-policy スキルを使用し、この規律に従う"}}
```

- [ ] **Step 9: lint / typecheck / test を通す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS

- [ ] **Step 10: コミット**

```bash
git add plugins/agent-policy/src/hooks plugins/agent-policy/hooks plugins/agent-policy/build.ts plugins/agent-policy/scripts/session-start.mjs
git commit -m "feat(agent-policy): SessionStart フックで方針スキルの使用指示を注入する"
```

---

### Task 4: エイリアス差分による定義生成と残骸通知を実装する

**Files:**
- Modify: `plugins/agent-policy/src/hooks/session-start.ts`
- Modify: `plugins/agent-policy/src/hooks/__test__/session-start.test.ts`

**Interfaces:**
- Consumes: Task 3 の `build(env)` と `respond(context)`。Task 1・Task 2 が作った `agents/*.md`(frontmatter に `model: ` 行がちょうど 1 行ある)。
- Produces: `${CLAUDE_PROJECT_DIR}/.claude/agents/<name>.md`。同梱定義の `model` 行だけを環境変数の値へ差し替えたもの。

- [ ] **Step 1: 失敗するテストを追記する**

`session-start.test.ts` の先頭の import に次を足す。

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
```

`HOOK` の定義の下に次を足す。

```typescript
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

function project(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-hook-"))
}

function generated(dir: string, name: string): string {
  return fs.readFileSync(
    path.join(dir, ".claude", "agents", `${name}.md`),
    "utf8"
  )
}

function place(dir: string, name: string, content: string): void {
  const target = path.join(dir, ".claude", "agents")
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, `${name}.md`), content)
}

function listing(dir: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, ".claude", "agents")).sort()
  } catch {
    return []
  }
}
```

`environment` を、プラグインルートも渡すよう次へ差し替える。

```typescript
function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides }
}
```

ファイル末尾に次のテストを足す。

```typescript
test("エイリアスが既定と同じときは何も生成しない", () => {
  const dir = project()
  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "claude-gpt-5-6-sol"
  })
  expect(injected).toBeUndefined()
  expect(listing(dir)).toEqual([])
})

test("エイリアスが既定と違うときは該当定義だけを生成する", () => {
  const dir = project()
  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  expect(listing(dir)).toEqual(["gpt-sol.md"])
  expect(generated(dir, "gpt-sol")).toContain("model: my-sol")
  expect(generated(dir, "gpt-sol")).not.toContain("claude-gpt-5-6-sol")
  expect(injected).toContain("gpt-sol")
  expect(injected).toContain("再起動")
})

test("TERRA のエイリアス変更は gpt-terra と gpt-researcher の両方を生成する", () => {
  const dir = project()
  context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_TERRA_ALIAS: "my-terra"
  })
  expect(listing(dir)).toEqual(["gpt-researcher.md", "gpt-terra.md"])
  expect(generated(dir, "gpt-researcher")).toContain("model: my-terra")
})

test("GROK のエイリアス変更は grok の 2 定義を生成する", () => {
  const dir = project()
  context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GROK_ALIAS: "my-grok"
  })
  expect(listing(dir)).toEqual(["grok-implementer.md", "grok-researcher.md"])
})

test("同一内容が既にあるときは書き込まず再起動も促さない", () => {
  const dir = project()
  context({ CLAUDE_PROJECT_DIR: dir, AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
  const first = fs.statSync(
    path.join(dir, ".claude", "agents", "gpt-sol.md")
  ).mtimeMs

  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  const second = fs.statSync(
    path.join(dir, ".claude", "agents", "gpt-sol.md")
  ).mtimeMs

  expect(second).toBe(first)
  expect(injected).toContain("gpt-sol")
  expect(injected).not.toContain("再起動")
})

test("差分が無いのに定義が置かれているときは残骸として通知する", () => {
  const dir = project()
  place(dir, "grok-researcher", "---\nname: grok-researcher\n---\n")
  const injected = context({ CLAUDE_PROJECT_DIR: dir })
  expect(injected).toContain("grok-researcher")
  expect(injected).toContain("旧セットアップ")
})

test("CLAUDE_PROJECT_DIR が無いときは生成せず注入だけ行う", () => {
  const injected = context({
    AMATSUKA_AGENT_AUTO_INJECTION: "claude",
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  expect(injected).toBe(
    "最初に必ず agent-policy:claude-model-policy スキルを使用し、この規律に従う"
  )
})

test("同梱定義が読めないときは stdout へ何も出さない", () => {
  const dir = project()
  const stdout = runTs(HOOK, [], {
    env: environment({
      CLAUDE_PROJECT_DIR: dir,
      CLAUDE_PLUGIN_ROOT: path.join(dir, "missing"),
      AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
    })
  })
  expect(stdout).toBe("")
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm test plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
Expected: FAIL。生成処理が無いため、`listing(dir)` が空のまま新規テストが落ちる。

- [ ] **Step 3: 生成処理を実装する**

`session-start.ts` のファイル先頭(shebang とコメントの直後、`POLICIES` の宣言より前)へ次の import を足す。biome は import をファイル冒頭に集めることを求めるため、途中へ差し込まない。

```typescript
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
```

続けて `POLICIES` の下へ次を足す。

```typescript
interface AgentSpec {
  name: string
  variable: string
  fallback: string
}

const AGENTS: AgentSpec[] = [
  {
    name: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    fallback: "claude-gpt-5-6-sol"
  },
  {
    name: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    fallback: "claude-gpt-5-6-terra"
  },
  {
    name: "gpt-researcher",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    fallback: "claude-gpt-5-6-terra"
  },
  {
    name: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    fallback: "claude-gpt-5-6-luna"
  },
  {
    name: "grok-researcher",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    fallback: "claude-grok-4-5"
  },
  {
    name: "grok-implementer",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    fallback: "claude-grok-4-5"
  }
]

interface SyncResult {
  overridden: string[]
  written: string[]
  stale: string[]
}

function pluginRoot(env: NodeJS.ProcessEnv): string {
  return (
    env.CLAUDE_PLUGIN_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  )
}

function replaceModel(content: string, alias: string): string {
  const lines = content.split("\n")
  const index = lines.findIndex((line) => line.startsWith("model: "))
  if (index === -1) {
    throw new Error("Bundled agent has no model line")
  }
  lines[index] = `model: ${alias}`
  return lines.join("\n")
}

function sync(env: NodeJS.ProcessEnv): SyncResult {
  const result: SyncResult = { overridden: [], written: [], stale: [] }
  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return result

  const outDir = path.join(projectDir, ".claude", "agents")

  for (const spec of AGENTS) {
    const alias = env[spec.variable]
    const target = path.join(outDir, `${spec.name}.md`)

    if (alias === undefined || alias === "" || alias === spec.fallback) {
      if (fs.existsSync(target)) result.stale.push(spec.name)
      continue
    }

    const source = fs.readFileSync(
      path.join(pluginRoot(env), "agents", `${spec.name}.md`),
      "utf8"
    )
    const content = replaceModel(source, alias)
    result.overridden.push(spec.name)

    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
      continue
    }
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(target, content)
    result.written.push(spec.name)
  }

  return result
}
```

`build` を次へ差し替える。

```typescript
function build(env: NodeJS.ProcessEnv): string | undefined {
  const result = sync(env)
  const blocks = [
    policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION),
    overrideBlock(result.overridden),
    restartBlock(result.written),
    staleBlock(result.stale)
  ].filter((block): block is string => block !== undefined)

  return blocks.length === 0 ? undefined : blocks.join("\n\n")
}

function overrideBlock(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `次の Agent はプロジェクト定義(.claude/agents/)を使う。agent-policy: プレフィックス付きの同梱定義は使わない: ${names.join(", ")}`
}

function restartBlock(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `上記のうち ${names.join(", ")} の定義を今のセッションで生成した。生成した定義は現セッションには反映されないため、エイリアスに依存する委譲を行う前に Claude Code を再起動する。`
}

function staleBlock(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `次の Agent 定義が .claude/agents/ に残っている。プロジェクト定義は同梱定義より優先されるため、旧セットアップの生成物であれば削除する: ${names.join(", ")}`
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `pnpm test plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
Expected: PASS(15 件)

- [ ] **Step 5: ビルドして生成物を更新する**

Run: `pnpm --filter agent-policy-scripts build`
Expected: `plugins/agent-policy/scripts/session-start.mjs` が更新される。

- [ ] **Step 6: lint / typecheck / test を通す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/hooks plugins/agent-policy/scripts/session-start.mjs
git commit -m "feat(agent-policy): 環境変数のエイリアス差分でプロジェクト定義を生成する"
```

---

### Task 5: 方針スキル 4 本を改訂する

**Files:**
- Modify: `plugins/agent-policy/skills/claude-model-policy/SKILL.md`
- Modify: `plugins/agent-policy/skills/with-codex-policy/SKILL.md`
- Modify: `plugins/agent-policy/skills/with-grok-policy/SKILL.md`
- Modify: `plugins/agent-policy/skills/codex-grok-policy/SKILL.md`

**Interfaces:**
- Consumes: Task 1・Task 2 の同梱エージェント名、Task 3・Task 4 の環境変数の値。
- Produces: 各方針スキルの担当表。Task 7 の README 記述はこの担当表と一致させる。

- [ ] **Step 1: `prompt-smith:prompt-smith` スキルを読み込む**

Skill ツールで `prompt-smith:prompt-smith` を invoke する。以降のステップはこのスキルの規律に従って進める。

- [ ] **Step 2: 4 本の description を書き換える**

各 description から「`.claude/agents/` に <ファイル名> が存在する / 存在しない」という条件と、他方針への振り分け案内を削除する。代わりに次の条件を書く。

| スキル | 使う条件として書く内容 |
| --- | --- |
| `claude-model-policy` | `AMATSUKA_AGENT_AUTO_INJECTION` が `claude` のとき |
| `with-codex-policy` | 同変数が `with-codex` のとき |
| `with-grok-policy` | 同変数が `with-grok` のとき |
| `codex-grok-policy` | 同変数が `with-codex-grok` のとき |

4 本とも、末尾の「CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。」はそのまま残す。

- [ ] **Step 3: `claude-model-policy` の担当表を更新する**

「コードベース探索実働」の行の担当を `Sonnet` / `Haiku` から `Claude Researcher` へ変更し、次の 2 行を足す。

```markdown
| リアルタイム情報調査(最新動向・外部エコシステム)      | `Claude Researcher` |
| 設計書・実装計画書の独立レビュー(前提検証・反証提示)  | `Claude Researcher` |
```

表の下に次の箇条書きを足す。

```markdown
- `Claude Researcher` と `Haiku` には Agent Tool を許可しない。
- 「調査・分析」と「リアルタイム情報調査」は、外部の最新情報へのアクセスが主目的なら `Claude Researcher`、思考の深さが主目的なら `Opus` へ振り分ける。
- `Claude Researcher` はオーケストレーターと同一ベンダーであるため、独立レビューの独立性は限定的である。文書の原本のみを読ませ、他レビューの指摘を渡さない運用でこれを補う。
```

- [ ] **Step 4: `with-codex-policy` の担当表を更新する**

「コードベース探索実働」の行の担当を `GPT Terra` / `GPT Luna` から `GPT Researcher` へ変更し、次の 2 行を足す。

```markdown
| リアルタイム情報調査(最新動向・外部エコシステム)      | `GPT Researcher`         |
| 設計書・実装計画書の独立レビュー(前提検証・反証提示)  | `GPT Researcher`         |
```

既存の「`orchestration-discipline` の『軽量な実装』の帯として扱うのは `GPT Luna` と `Haiku` である。この 2 つには Agent Tool を許可しない。」の下に次を足す。

```markdown
- `GPT Researcher` にも Agent Tool を許可しない。
- 「調査・分析」と「リアルタイム情報調査」は、外部の最新情報へのアクセスが主目的なら `GPT Researcher`、思考の深さが主目的なら `Opus` へ振り分ける。
```

「実行帯が GPT モデルの場合の dispatch」節に次を足す。

```markdown
- `GPT Researcher` へ dispatch するときは、依頼文の冒頭で「独立レビュー」「リアルタイム情報調査」「探索実働」のどれかを明示し、その役割の Output Format を指定する。
```

「独立レビューの手順」節を新設する。`codex-grok-policy` の同名節と同じ 4 手順を書き、`Grok Researcher` を `GPT Researcher` に置き換える。

- [ ] **Step 5: `codex-grok-policy` の担当表とフォールバックを更新する**

「コードベース探索実働」の行の担当を `GPT Terra` / `GPT Luna` から `Grok Researcher` へ変更する。他の行は変更しない。

「Grok が利用不可のときのフォールバック」節へ次を足す。

```markdown
- 探索実働: `GPT Terra` / `GPT Luna` へ読み替える。
```

- [ ] **Step 6: `with-grok-policy` を確認する**

担当表の「コードベース探索実働」は既に `Grok Researcher` である。変更しない。「Grok が利用不可のときのフォールバック」節にも探索実働の行が既にある。description だけを Step 2 のとおり書き換える。

- [ ] **Step 7: 4 本の実行帯の解決順を書き換える**

4 本すべての「実行帯の解決順」節を次の内容にする。方針ごとに対象の帯(GPT のみ / Grok のみ / 両方 / Claude のみ)が違うため、その方針に存在する帯だけを書く。

```markdown
## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. プロジェクトの `.claude/agents/<name>.md` が存在すればそれを使う。環境変数で既定と異なるエイリアスを指定したときは、SessionStart フックがここへ定義を生成する。
2. 存在しなければ、プラグイン同梱の `agent-policy:<name>` を使う。
3. ローカルプロキシ経由で呼び出せないときは、§利用不可のときのフォールバック に従う。
```

`claude-model-policy` には 3 を書かない。`with-codex-policy` の 3 では、GPT の帯について `codex@openapi-codex` プラグイン(`/codex:rescue --model gpt-5.6-sol` / `--model gpt-5.6-terra` / `--model gpt-5.6-luna`)を先に試し、それも不可なら `agent-policy:claude-model-policy` の担当表へ読み替える、と書く。`codex-grok-policy` は GPT の帯を `with-codex-policy` と同じ扱いにし、Grok の帯は既存のフォールバック節へ送る。

- [ ] **Step 8: setup スキルへの参照が残っていないことを確認する**

Run: `grep -rn "setup-gpt\|setup-grok" plugins/agent-policy/skills/`
Expected: 一致なし(終了コード 1)

- [ ] **Step 9: 担当表に旧担当が残っていないことを確認する**

Run: `grep -n "コードベース探索実働" plugins/agent-policy/skills/*/SKILL.md`
Expected: 4 行が出力され、担当がそれぞれ `Claude Researcher` / `GPT Researcher` / `Grok Researcher` / `Grok Researcher` になっている。

- [ ] **Step 10: コミット**

```bash
git add plugins/agent-policy/skills/
git commit -m "feat(agent-policy): 方針スキルを同梱エージェントと環境変数の運用へ更新"
```

---

### Task 6: 旧セットアップ一式を削除する

**Files:**
- Delete: `plugins/agent-policy/skills/setup-gpt/`
- Delete: `plugins/agent-policy/skills/setup-grok/`
- Delete: `plugins/agent-policy/src/setup-agents.ts`
- Delete: `plugins/agent-policy/scripts/setup-agents.mjs`
- Delete: `plugins/agent-policy/src/__test__/setup-agents.test.ts`
- Modify: `plugins/agent-policy/build.ts`

**Interfaces:**
- Consumes: Task 1 で `agents/` へ移設済みのテンプレート内容。移設が済んでいることが削除の前提になる。

- [ ] **Step 1: 移設が完了していることを確認する**

Run: `ls plugins/agent-policy/agents/`
Expected: 7 ファイル(`claude-researcher.md` `gpt-luna.md` `gpt-researcher.md` `gpt-sol.md` `gpt-terra.md` `grok-implementer.md` `grok-researcher.md`)

- [ ] **Step 2: ビルド定義からエントリーポイントを外す**

`plugins/agent-policy/build.ts` の `entryPoints` を次にする。

```typescript
  entryPoints: {
    "session-start": "./src/hooks/session-start.ts"
  },
```

- [ ] **Step 3: 旧ファイルを削除する**

```bash
git rm -r plugins/agent-policy/skills/setup-gpt plugins/agent-policy/skills/setup-grok
git rm plugins/agent-policy/src/setup-agents.ts plugins/agent-policy/scripts/setup-agents.mjs plugins/agent-policy/src/__test__/setup-agents.test.ts
```

- [ ] **Step 4: 参照が残っていないことを確認する**

Run: `grep -rn "setup-agents\|setup-gpt\|setup-grok" plugins/agent-policy/ --exclude-dir=node_modules --exclude=README.md`
Expected: 一致なし(終了コード 1)。README.md はこの時点でまだ旧手順を含むため除外する。Task 7 で書き換えたうえで、除外なしの確認を行う。

- [ ] **Step 5: ビルドと検証を通す**

Run: `pnpm --filter agent-policy-scripts build && pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS。`scripts/` には `session-start.mjs` だけが残る。

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy
git commit -m "refactor(agent-policy): setup-gpt / setup-grok と生成スクリプトを廃止"
```

---

### Task 7: ドキュメントとバージョンを更新し、通しで検証する

**Files:**
- Modify: `plugins/agent-policy/README.md`
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json`
- Modify: `plugins/agent-policy/package.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1〜6 のすべて。README の記述は Task 5 の担当表と一致させる。

- [ ] **Step 1: プラグイン README を書き換える**

次の構成にする。

- 「動作要件」— 生成スクリプトの記述を削除する。フックは Node.js で動くため、`node` が PATH 上にありバージョンが 22 以上である必要がある旨は残す。
- 「プロファイル」— `.claude/agents/` の定義有無による選択表を、`AMATSUKA_AGENT_AUTO_INJECTION` の値による選択表へ差し替える。値は `claude` / `with-codex` / `with-grok` / `with-codex-grok` / `none`。
- 「環境変数」節を新設する。5 変数の表(変数名・用途・既定値)と、エイリアスが ProxyAPI サーバー側の別名である旨を書く。
- 「同梱エージェント」節を新設する。7 定義の表(名前・既定モデル・役割)と、呼び出し名が `agent-policy:<name>` になる旨を書く。
- 「エイリアスを変更する」節を新設する。環境変数を設定するとフックが `.claude/agents/` へ定義を生成すること、生成は次のセッションから効くこと、生成された定義は同梱定義より優先されることを書く。
- 「旧バージョンからの移行」節を新設する。`setup-gpt` / `setup-grok` が廃止されたこと、旧セットアップが生成した `.claude/agents/gpt-*.md` と `grok-*.md` は同梱定義より優先されるため削除すること、削除しないと古い定義が使われ続けることを書く。
- 「Agent 定義のセットアップ」「生成スクリプトのオプション」の 2 節を削除する。

- [ ] **Step 2: バージョンを上げる**

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.7.0-dev` にする。

- [ ] **Step 3: marketplace とルート README を更新する**

`.claude-plugin/marketplace.json` の agent-policy の description に、エージェント定義を同梱で提供する旨を加える。ルート `README.md` の agent-policy の記述も、同梱化と環境変数運用に合わせて更新する。

- [ ] **Step 4: バージョンが揃っていることを確認する**

Run: `grep -n '"version"' plugins/agent-policy/.claude-plugin/plugin.json plugins/agent-policy/package.json`
Expected: 両方が `0.7.0-dev`

- [ ] **Step 5: 廃止したスキルへの参照が残っていないことを確認する**

Run: `grep -rn "setup-gpt\|setup-grok\|setup-agents" README.md .claude-plugin/marketplace.json plugins/agent-policy/`
Expected: 一致なし(終了コード 1)

- [ ] **Step 6: 通しの静的検証を行う**

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS。`git status` に `scripts/session-start.mjs` 以外のビルド差分が出ないこと。

- [ ] **Step 7: 既定エイリアスでの実機挙動を確認する**

```bash
rm -rf /tmp/ap-default && mkdir -p /tmp/ap-default && cd /tmp/ap-default && AMATSUKA_AGENT_AUTO_INJECTION=claude claude -p "セッション開始時に注入された指示があれば、その全文をそのまま出力せよ。他の作業はするな。" --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-improvement/plugins/agent-policy --model sonnet --output-format text && ls -a /tmp/ap-default
```

Expected: 出力に `最初に必ず agent-policy:claude-model-policy スキルを使用し、この規律に従う` が含まれる。`/tmp/ap-default` に `.claude` ディレクトリが作られていない。

- [ ] **Step 8: エイリアス変更時の実機挙動を確認する**

```bash
rm -rf /tmp/ap-alias && mkdir -p /tmp/ap-alias && cd /tmp/ap-alias && AMATSUKA_AGENT_AUTO_INJECTION=with-codex AMATSUKA_AGENT_GPT_SOL_ALIAS=my-sol claude -p "セッション開始時に注入された指示があれば、その全文をそのまま出力せよ。他の作業はするな。" --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-improvement/plugins/agent-policy --model sonnet --output-format text && cat /tmp/ap-alias/.claude/agents/gpt-sol.md | head -6
```

Expected: 出力に方針指示・優先指示・再起動指示の 3 つが含まれる。生成された `gpt-sol.md` の frontmatter に `model: my-sol` がある。

- [ ] **Step 9: 残骸通知の実機挙動を確認する**

```bash
rm -rf /tmp/ap-stale && mkdir -p /tmp/ap-stale/.claude/agents && printf -- '---\nname: gpt-terra\n---\n' > /tmp/ap-stale/.claude/agents/gpt-terra.md && cd /tmp/ap-stale && claude -p "セッション開始時に注入された指示があれば、その全文をそのまま出力せよ。他の作業はするな。" --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-improvement/plugins/agent-policy --model sonnet --output-format text
```

Expected: 出力に `gpt-terra` と「旧セットアップ」を含む残骸通知が現れる。

- [ ] **Step 10: 検証用ディレクトリを片付ける**

Run: `rm -rf /tmp/ap-verify /tmp/ap-default /tmp/ap-alias /tmp/ap-stale`

- [ ] **Step 11: コミット**

```bash
git add README.md .claude-plugin/marketplace.json plugins/agent-policy
git commit -m "docs(agent-policy): 同梱エージェントと環境変数運用へドキュメントを更新し 0.7.0-dev へ上げる"
```
