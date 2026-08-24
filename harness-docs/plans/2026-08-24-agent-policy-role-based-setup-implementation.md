# agent-policy 役割ベース setup と MCP 非同梱化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent-policy のエージェント定義を役割断片から合成する方式へ変え、MCP 依存を取り除き、利用者が役割を選んで自分の定義を作れる `setup-gpt` / `setup-grok` を復活させる。

**Architecture:** 役割断片(`assets/roles/*.md`)を唯一の正とし、そこから同梱プリセット(`pnpm build` で生成)と setup の生成物(`.claude/agents/`)の両方を組み立てる。定義の frontmatter に役割マーカー `agent-policy-role` を持たせ、SessionStart フックがそれを走査して「担当表の帯 → エージェント名」を注入する。フックはファイルを書かず、書き込みは setup スクリプトだけが行う。

**Tech Stack:** TypeScript(esbuild で ESM へバンドル)、vitest、Claude Code のプラグイン機構(agents / hooks / skills)

**Spec:** `harness-docs/design/2026-08-24-agent-policy-role-based-setup-design.md`

## Global Constraints

- Node は `>=26`、パッケージマネージャは pnpm `11.8.0`。
- スクリプトのソースは `plugins/agent-policy/src/`、バンドル出力は `plugins/agent-policy/scripts/`。バンドル出力は git 管理下に置く。
- `plugins/agent-policy/src/` を変更したら `pnpm build` を実行し、生成物の差分も同じコミットに含める。同梱プリセット `plugins/agent-policy/agents/*.md` もビルド生成物であり、同じ規律に従う。
- コミット前に `pnpm lint`・`pnpm typecheck`・`pnpm test` を通す。
- TypeScript / JavaScript / Markdown のファイルを作成・編集するときは Serena のツールを使う。
- Agent 定義(役割断片を含む)を作成・点検するときは `prompt-smith:agent-creator` スキルを使う。
- スキル(`SKILL.md`)を作成・改善するときは `prompt-smith:skill-creator` スキルを使う。
- その他 AI 向けの指示書(方針スキル本文・`references/`)を編集するときは `prompt-smith:prompt-smith` スキルを使う。
- 既定エイリアスは次の値をリテラルで使う。`gpt-sol` = `claude-gpt-5-6-sol`、`gpt-terra` = `claude-gpt-5-6-terra`、`gpt-luna` = `claude-gpt-5-6-luna`、`grok` = `claude-grok-4-6`。
- 役割マーカーの frontmatter キーは `agent-policy-role`。値は役割 ID を `, `(カンマ + 半角スペース)で連結した CSV。並び順は `ROLES` の定義順。
- 環境変数名は `AMATSUKA_AGENT_GPT_SOL_ALIAS` / `AMATSUKA_AGENT_GPT_TERRA_ALIAS` / `AMATSUKA_AGENT_GPT_LUNA_ALIAS` / `AMATSUKA_AGENT_GROK_ALIAS` / `AMATSUKA_AGENT_AUTO_INJECTION`。
- 注入する方針指示の文言は `最初に必ず agent-policy:<policy> スキルを使用し、この規律に従う` で固定する。
- 生成する定義の `tools` に MCP ツール(`mcp__` で始まる名前)を含めない。
- 生成する定義に「ツール運用」節を作らない。
- 役割断片の本文に他エージェント定義の固有名(`GPT Sol` / `GPT Terra` / `GPT Luna` / `Grok Implementer` / `Grok Researcher` / `Claude Researcher`)を書かない。
- 作業ブランチは `agent-policy-change`(worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-change`)。すべてのコマンドをこのディレクトリで実行する。
- テスト内のパス解決は、既存 `src/hooks/__test__/session-start.test.ts` の流儀に合わせて `fileURLToPath(new URL("...", import.meta.url))` を使う。`import.meta.dirname` は使わない。
- テストから `runTs` を import するときは `import { runTs } from "../../testing/run-ts.js"` のように `.js` 拡張子を付ける(既存の流儀)。
- 新規テストは `plugins/**/__test__/**/*.test.ts` に置く(`vitest.config.ts` の `include` がこのパターン)。

## ファイル構成

新規:

| パス | 責務 |
| --- | --- |
| `plugins/agent-policy/src/agents/roles.ts` | 役割 ID の定義、tools 導出、担当表とプリセットの対応 |
| `plugins/agent-policy/src/agents/fragments.ts` | 役割断片の読み込みとパース |
| `plugins/agent-policy/src/agents/compose.ts` | 断片からエージェント定義 Markdown を合成 |
| `plugins/agent-policy/src/agents/presets.ts` | 同梱プリセット 4 種の定義 |
| `plugins/agent-policy/src/agents/build-presets.ts` | プリセットを `agents/*.md` へ書き出す |
| `plugins/agent-policy/src/setup-agents.ts` | 差分検出とマージ書き込みの CLI |
| `plugins/agent-policy/assets/roles/_common.md` | 全定義に共通する冒頭宣言・制約・アドバイザー節 |
| `plugins/agent-policy/assets/roles/<role-id>.md` | 役割ごとの本文断片(10 件) |
| `plugins/agent-policy/assets/roles/realtime-research.grok.md` | Grok 固有の追記(ソーシャル由来情報の扱い) |
| `plugins/agent-policy/skills/setup-gpt/SKILL.md` | GPT 定義の役割選択セットアップウィザード |
| `plugins/agent-policy/skills/setup-grok/SKILL.md` | Grok 定義の役割選択セットアップウィザード |
| `plugins/agent-policy/scripts/setup-agents.mjs` | `setup-agents.ts` のバンドル出力 |
| `plugins/agent-policy/src/agents/__test__/roles.test.ts` | 役割定義と tools 導出の契約テスト |
| `plugins/agent-policy/src/agents/__test__/compose.test.ts` | 合成の契約テスト |
| `plugins/agent-policy/src/agents/__test__/presets.test.ts` | プリセットと担当表の一致検査 |
| `plugins/agent-policy/src/__test__/setup-agents.test.ts` | 差分検出とマージの契約テスト |

削除:

| パス | 理由 |
| --- | --- |
| `plugins/agent-policy/agents/claude-researcher.md` | researcher 3 定義を廃止(設計書 §2.1) |
| `plugins/agent-policy/agents/gpt-researcher.md` | 同上 |
| `plugins/agent-policy/agents/grok-researcher.md` | 同上 |
| `plugins/agent-policy/agents/grok-implementer.md` | `grok.md` へ統合(設計書 §2.2) |

変更:

| パス | 変更内容 |
| --- | --- |
| `plugins/agent-policy/agents/gpt-sol.md` | 手書きからビルド生成物へ。MCP 削除、役割マーカー付与 |
| `plugins/agent-policy/agents/gpt-terra.md` | 同上 |
| `plugins/agent-policy/agents/gpt-luna.md` | 同上 |
| `plugins/agent-policy/agents/grok.md` | 新規(旧 `grok-implementer.md` の位置付けを継ぐ) |
| `plugins/agent-policy/src/hooks/session-start.ts` | 生成を廃止、役割マーカー走査と促しを追加 |
| `plugins/agent-policy/src/hooks/__test__/session-start.test.ts` | 上記に合わせて全面改訂 |
| `plugins/agent-policy/build.ts` | `setup-agents` の entryPoint 追加、プリセット生成の実行 |
| `plugins/agent-policy/skills/*/SKILL.md` | 担当表・解決順・dispatch 節の改訂(4 本) |
| `plugins/agent-policy/references/orchestration-discipline.md` | 役割マーカーへの言及を追加 |
| `plugins/agent-policy/README.md` | 役割ベース setup・エイリアス更新・移行手順 |
| `plugins/agent-policy/.claude-plugin/plugin.json` | version `0.8.0-dev` |
| `plugins/agent-policy/package.json` | version `0.8.0-dev` |
| `.claude-plugin/marketplace.json` | description |
| ルート `README.md` | agent-policy の記述 |

## 検証用のヘルパー

既存の `plugins/agent-policy/src/testing/run-ts.ts` の `runTs` を使い、CLI を子プロセスで実行する。環境変数と一時ディレクトリを子プロセスへ渡して差し替えるため、依存注入のための構造分割は行わない。

テストの一時ディレクトリは `fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))` で作り、`afterEach` で `fs.rmSync(dir, { recursive: true, force: true })` する。

---

### Task 1: 役割 ID の定義と tools 導出を実装する

**Files:**
- Create: `plugins/agent-policy/src/agents/roles.ts`
- Test: `plugins/agent-policy/src/agents/__test__/roles.test.ts`

**Interfaces:**
- Consumes: なし(最初のタスク)
- Produces:
  - `type RoleId`(10 個の文字列リテラル union)
  - `type RoleKind = "impl" | "readonly"`
  - `interface Role { id: RoleId; label: string; kind: RoleKind; tools: string[] }`
  - `const ROLES: readonly Role[]`
  - `function roleById(id: string): Role | undefined`
  - `function sortRoleIds(ids: RoleId[]): RoleId[]` — `ROLES` の定義順に並べ替える
  - `function resolveTools(ids: RoleId[]): string[]` — 和集合 + `Agent` の付与判定込み
  - `function allowsAgentTool(ids: RoleId[]): boolean`
  - `function hasMixedKinds(ids: RoleId[]): boolean`
  - `type PolicyName`、`const PRESET_ASSIGNMENTS: Record<PolicyName, Partial<Record<RoleId, string>>>`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/roles.test.ts` を作る。

```typescript
import { describe, expect, it } from "vitest"
import {
  ROLES,
  allowsAgentTool,
  hasMixedKinds,
  resolveTools,
  roleById,
  sortRoleIds
} from "../roles"

describe("ROLES", () => {
  it("役割 ID が 10 件あり、重複しない", () => {
    expect(ROLES).toHaveLength(10)
    expect(new Set(ROLES.map((role) => role.id)).size).toBe(10)
  })

  it("すべての役割が label と kind と tools を持つ", () => {
    for (const role of ROLES) {
      expect(role.label.length).toBeGreaterThan(0)
      expect(["impl", "readonly"]).toContain(role.kind)
      expect(role.tools.length).toBeGreaterThan(0)
    }
  })

  it("tools に MCP ツールを含まない", () => {
    for (const role of ROLES) {
      for (const tool of role.tools) {
        expect(tool.startsWith("mcp__")).toBe(false)
      }
    }
  })

  it("読み取り役割に Write / Edit を含まない", () => {
    for (const role of ROLES.filter((entry) => entry.kind === "readonly")) {
      expect(role.tools).not.toContain("Write")
      expect(role.tools).not.toContain("Edit")
    }
  })
})

describe("roleById", () => {
  it("既知の ID を引ける", () => {
    expect(roleById("complex-impl")?.label).toBe("複雑または重要な実装")
  })

  it("未知の ID では undefined を返す", () => {
    expect(roleById("no-such-role")).toBeUndefined()
  })
})

describe("sortRoleIds", () => {
  it("ROLES の定義順に並べ替える", () => {
    expect(sortRoleIds(["explore", "complex-impl", "light-impl"])).toEqual([
      "complex-impl",
      "light-impl",
      "explore"
    ])
  })
})

describe("resolveTools", () => {
  it("単一の読み取り役割では Write / Edit / Agent が付かない", () => {
    const tools = resolveTools(["independent-review"])
    expect(tools).toContain("Read")
    expect(tools).not.toContain("Write")
    expect(tools).not.toContain("Edit")
    expect(tools).not.toContain("Agent")
  })

  it("realtime-research だけが WebSearch / WebFetch を持ち込む", () => {
    expect(resolveTools(["realtime-research"])).toContain("WebSearch")
    expect(resolveTools(["explore"])).not.toContain("WebSearch")
  })

  it("複数役割で和集合になる", () => {
    const tools = resolveTools(["normal-impl", "realtime-research"])
    expect(tools).toContain("Write")
    expect(tools).toContain("WebSearch")
  })

  it("MCP ツールを 1 つも含まない", () => {
    const tools = resolveTools(["complex-impl", "explore", "realtime-research"])
    expect(tools.some((tool) => tool.startsWith("mcp__"))).toBe(false)
  })

  it("同じ役割集合なら順序が安定する", () => {
    expect(resolveTools(["explore", "normal-impl"])).toEqual(
      resolveTools(["normal-impl", "explore"])
    )
  })
})

describe("allowsAgentTool", () => {
  it("complex-impl / normal-impl / general のいずれかを含むと許可する", () => {
    expect(allowsAgentTool(["complex-impl"])).toBe(true)
    expect(allowsAgentTool(["normal-impl"])).toBe(true)
    expect(allowsAgentTool(["general"])).toBe(true)
  })

  it("light-impl のみでは許可しない", () => {
    expect(allowsAgentTool(["light-impl"])).toBe(false)
  })

  it("読み取り役割のみでは許可しない", () => {
    expect(allowsAgentTool(["explore", "independent-review"])).toBe(false)
  })

  it("light-impl と complex-impl の併用では許可する", () => {
    expect(allowsAgentTool(["light-impl", "complex-impl"])).toBe(true)
  })
})

describe("hasMixedKinds", () => {
  it("実装役割と読み取り役割の混在を検出する", () => {
    expect(hasMixedKinds(["normal-impl", "independent-review"])).toBe(true)
  })

  it("同じ種別だけなら false", () => {
    expect(hasMixedKinds(["normal-impl", "light-impl"])).toBe(false)
    expect(hasMixedKinds(["explore", "doc-review"])).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/agents/__test__/roles.test.ts`
Expected: FAIL — `Cannot find module '../roles'`

- [ ] **Step 3: `roles.ts` を実装する**

`plugins/agent-policy/src/agents/roles.ts` を作る。

```typescript
export type RoleKind = "impl" | "readonly"

export type RoleId =
  | "complex-impl"
  | "normal-impl"
  | "light-impl"
  | "general"
  | "explore"
  | "realtime-research"
  | "independent-review"
  | "doc-review"
  | "code-review"
  | "advisor"

export interface Role {
  id: RoleId
  label: string
  kind: RoleKind
  tools: string[]
}

// 並び順は設計書 §4 の表順であり、agent-policy-role の CSV の並びにも使う。
export const ROLES: readonly Role[] = [
  {
    id: "complex-impl",
    label: "複雑または重要な実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "normal-impl",
    label: "通常の実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "light-impl",
    label: "軽量な実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "LSP"]
  },
  {
    id: "general",
    label: "その他のタスク",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "explore",
    label: "コードベース探索実働",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "realtime-research",
    label: "リアルタイム情報調査",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
  },
  {
    id: "independent-review",
    label: "設計書・実装計画書の独立レビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "doc-review",
    label: "設計書・実装計画書のレビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  },
  {
    id: "code-review",
    label: "コードレビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "advisor",
    label: "設計・計画・実装のアドバイザー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  }
]

// Agent tool を許可する実装役割。orchestration-discipline の
// 「軽量な実装の帯に Agent Tool を許可しない」に従い light-impl を除く。
const AGENT_CAPABLE: readonly RoleId[] = ["complex-impl", "normal-impl", "general"]

export function roleById(id: string): Role | undefined {
  return ROLES.find((role) => role.id === id)
}

export function sortRoleIds(ids: RoleId[]): RoleId[] {
  const order = new Map(ROLES.map((role, index) => [role.id, index]))
  return [...ids].sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)
  )
}

export function allowsAgentTool(ids: RoleId[]): boolean {
  return ids.some((id) => AGENT_CAPABLE.includes(id))
}

export function hasMixedKinds(ids: RoleId[]): boolean {
  const kinds = new Set(ids.map((id) => roleById(id)?.kind))
  return kinds.has("impl") && kinds.has("readonly")
}

// tools の並びは ROLES の定義順に現れた順とし、Agent を末尾へ置く。
export function resolveTools(ids: RoleId[]): string[] {
  const tools: string[] = []
  for (const id of sortRoleIds(ids)) {
    for (const tool of roleById(id)?.tools ?? []) {
      if (!tools.includes(tool)) tools.push(tool)
    }
  }
  if (allowsAgentTool(ids)) tools.push("Agent")
  return tools
}

export type PolicyName =
  | "claude-model-policy"
  | "with-codex-policy"
  | "with-grok-policy"
  | "codex-grok-policy"

// 各方針の担当表で、その役割をどのプリセットが担うか。
// Claude 帯(model 上書きで済む帯)は載せない。
export const PRESET_ASSIGNMENTS: Record<
  PolicyName,
  Partial<Record<RoleId, string>>
> = {
  "claude-model-policy": {},
  "with-codex-policy": {
    "complex-impl": "gpt-sol",
    "normal-impl": "gpt-terra",
    "light-impl": "gpt-luna",
    general: "gpt-terra",
    explore: "gpt-terra",
    "realtime-research": "gpt-terra",
    "independent-review": "gpt-terra"
  },
  "codex-grok-policy": {
    "complex-impl": "gpt-sol",
    "normal-impl": "gpt-terra",
    "light-impl": "gpt-luna",
    general: "gpt-terra",
    explore: "grok",
    "realtime-research": "grok",
    "independent-review": "grok"
  },
  "with-grok-policy": {
    "normal-impl": "grok",
    "light-impl": "grok",
    general: "grok",
    explore: "grok",
    "realtime-research": "grok",
    "independent-review": "grok"
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/agents/__test__/roles.test.ts`
Expected: PASS(20 件前後)

- [ ] **Step 5: lint と typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/src/agents/roles.ts plugins/agent-policy/src/agents/__test__/roles.test.ts
git commit -m "feat(agent-policy): 役割 ID の定義と tools 導出を追加する"
```

---

### Task 2: 役割断片を作成する

`prompt-smith:agent-creator` スキルを使う。断片は最終的にエージェント定義の本文になるため、agent 定義の観点で点検する。

**Files:**
- Create: `plugins/agent-policy/assets/roles/_common.md`
- Create: `plugins/agent-policy/assets/roles/complex-impl.md`
- Create: `plugins/agent-policy/assets/roles/normal-impl.md`
- Create: `plugins/agent-policy/assets/roles/light-impl.md`
- Create: `plugins/agent-policy/assets/roles/general.md`
- Create: `plugins/agent-policy/assets/roles/explore.md`
- Create: `plugins/agent-policy/assets/roles/realtime-research.md`
- Create: `plugins/agent-policy/assets/roles/independent-review.md`
- Create: `plugins/agent-policy/assets/roles/doc-review.md`
- Create: `plugins/agent-policy/assets/roles/code-review.md`
- Create: `plugins/agent-policy/assets/roles/advisor.md`
- Create: `plugins/agent-policy/assets/roles/realtime-research.grok.md`

**Interfaces:**
- Consumes: `RoleId` / `Role`(Task 1)
- Produces: 断片ファイル群。Task 3 の `fragments.ts` がこれをパースする

素材は現行の `plugins/agent-policy/agents/*.md` にある。移設時に次を必ず行う。

1. MCP に言及する行を落とす。「ツール運用」節は作らない。
2. 他定義の固有名(`GPT Sol` 等)を書かない。差し戻し文言へ置き換える。
3. 読み取り役割の制約に役割名を冠する(「〜として依頼されたときは」)。
4. MCP と独立な権限規律(GitHub への書き込み禁止、ブラウザ操作は閲覧のみ、0 件を結論にしない)は該当する役割の断片へ退避する。

- [ ] **Step 1: `_common.md` を作る**

```markdown
---
id: _common
---

## Preamble

あなたは {{NAME}}。メインオーケストレーターから起動されたサブエージェントである。

担う役割は {{ROLE_LABELS}} である。どの役割で呼ばれたかは依頼文の冒頭で指定される。指定がなく、複数の役割のどれとも判断できないときは作業に入らず、役割の指定を求めて差し戻す。

## アドバイザーへの相談

- 判断に迷ったときだけ、Agent ツールでアドバイザーを呼び出す。
- 相談相手は `Fable` サブエージェントとし、Fable を起動できないときは `Opus` サブエージェントにする。
- アドバイザーへの依頼文には「あなたはアドバイザーであり、助言のみを返すこと」「Agent ツールを使用しないこと(サブエージェントの起動を許可しない)」を必ず明記する。
- 迷っていないときはアドバイザーを呼ばない。

## 制約

- 自分の役割に含まれない作業は引き受けず、オーケストレーターへ差し戻す。
- ブリーフで明示的に指定されたスキル以外を Skill ツールでロードしない。
- スキル側のトリガー定義はブリーフの明示指定に劣後する。
- ロードが必要だと気づいたときもロードせず、その旨を報告して差し戻す。
- オーケストレーターから context-map を渡されたときは、それを出発点として用い、記載と実際のコードに食い違いがあれば報告する。
```

`{{NAME}}` と `{{ROLE_LABELS}}` は合成時に置き換える。`## アドバイザーへの相談` 節は `Agent` が付くときだけ使う。

- [ ] **Step 2: 実装役割の断片 4 件を作る**

`complex-impl.md`:

```markdown
---
id: complex-impl
label: 複雑または重要な実装
description: 複雑なコーディング(アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う実装)
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP
kind: impl
---

## When to invoke

- **複雑な実装。** アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う、難度の高い実装を行うとき。

## Core Responsibilities

- 複雑、または重要な実装を、根拠(ファイルパス・行番号)付きで自ら遂行する。

## 作業手順

- 着手前に対象コードとその呼び出し元を読み、リポジトリの流儀に合わせる。推測で書かず、シグネチャや既存パターンを確認してから実装する。
- 実装後は、変更した振る舞いをテスト実行・型チェック等で観測して検証する。検証していないものを「動く」と報告しない。

## 制約

- **複雑または重要な実装として依頼されたときは**、スコープの境界を守る。最上位の承認判断はオーケストレーターに委ね、自分は求めない。
- `Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。
- GitHub への書き込み(PR 作成・レビュー投稿)は行わず、必要ならオーケストレーターへ報告する。
- ブラウザでの動作確認は閲覧・動作確認に限り、対象システムのデータを変更する操作は行わない。

## Output Format

- 結論(成果物の完了状況)を冒頭に一文で
- 根拠となるファイルパスと行番号
- 成果物の内容と、その検証方法・結果
- 未解決の懸念・人間の判断が必要な事項
```

`normal-impl.md`:

```markdown
---
id: normal-impl
label: 通常の実装
description: 通常のコーディング(複雑でない実装)、設定編集、ビルド/テスト実行
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP
kind: impl
---

## When to invoke

- **通常のコーディング。** アーキテクチャ判断を伴わない、既存パターンに沿った実装・修正を行うとき。
- **設定・構成の整備。** 設定ファイルの編集、マニフェストの更新、ディレクトリ構成の整理が必要なとき。
- **ビルド・テストの実行と報告。** コマンドを実行し、結果を整理して報告する作業が必要なとき。

## Core Responsibilities

- 指示された作業を、既存のリポジトリ規約(ファイル配置・命名・文体)に合わせて遂行する。

## 作業手順

- 対象ファイル・ディレクトリの現状を確認してから変更する。
- 変更は最小限に留め、指示にない「ついで」の修正をしない。
- 検証手段(テスト・lint・ビルド)がある場合は実行し、結果を確認する。

## 制約

- **通常の実装として依頼されたときは**、作業範囲を指示の範囲に留め、スコープ外の変更を行わない。
- `Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。
- GitHub への書き込み(PR 作成・レビュー投稿)は行わず、必要ならオーケストレーターへ報告する。
- ブラウザでの動作確認は閲覧・動作確認に限り、対象システムのデータを変更する操作は行わない。

## Output Format

- 実施した変更のファイルパス一覧と各変更の要旨
- 実行したコマンドと結果(失敗した場合はその出力)
- 未完了・要判断の事項
```

`light-impl.md`:

```markdown
---
id: light-impl
label: 軽量な実装
description: 一括適用・一括チェック・反復変換・軽微なコーディング
tools: Read, Grep, Glob, Write, Edit, Bash, LSP
kind: impl
---

## When to invoke

- **一括適用。** 多数のファイルに同一の機械的な変更(リネーム、インポート差し替え、表記統一など)を適用するとき。
- **一括チェック。** 大量のファイルを走査して、特定パターンの有無や規約違反をリスト化するとき。
- **反復変換。** フォーマット変換・整形・抽出など、判断を要さない処理を多数の対象に繰り返すとき。
- **軽微なコーディング。** 定型的で判断をほとんど伴わない小さなコード変更を行うとき。

## Core Responsibilities

- 与えられたパターンを全対象に漏れなく適用する。

## 作業手順

- まず対象の全リストを確定させる(Glob / Grep で件数を把握)。
- 1〜2 件で変更内容を確認してから、残りに展開する。
- 完了後、変更が全対象に適用されたことを検索で再確認する。

## 制約

- **軽量な実装として依頼されたときは**、パターンに合致しない対象を勝手に判断せず処理を止める。指示されたパターン以外の変更をしない。
- **軽量な実装として依頼されたときは**、判断・設計・複雑な読解を要する作業を引き受けない。判断に迷った場合もアドバイザーへ相談せず、その旨を報告して差し戻す。

## Output Format

- 処理した件数(対象 / 変更 / スキップ)
- 変更したファイルパスの一覧
- 例外・判断保留にした対象とその理由
```

`general.md`:

```markdown
---
id: general
label: その他のタスク
description: ドキュメント作成、定型メンテナンスなど、レビュー・設計を除く一般作業
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP
kind: impl
---

## When to invoke

- **ドキュメント作業。** README・手順書の作成や更新、既存ドキュメントの整合性チェックが必要なとき。
- **定型メンテナンス。** 単発では終わらないが専門性を要さない、リポジトリ内の一般作業が必要なとき。

## Core Responsibilities

- 指示された作業を、既存のリポジトリ規約(ファイル配置・命名・文体)に合わせて遂行する。

## 作業手順

- 長時間にわたる作業では、途中経過を報告に残す。
- 判断に迷い、アドバイザーに相談しても決められない事項は、選択肢と推奨を添えて報告する。

## 制約

- **その他のタスクとして依頼されたときは**、作業範囲を指示の範囲に留め、スコープ外の変更を行わない。

## Output Format

- 実施した変更のファイルパス一覧と各変更の要旨
- 未完了・要判断の事項
```

- [ ] **Step 3: 読み取り役割の断片 6 件を作る**

`explore.md`:

```markdown
---
id: explore
label: コードベース探索実働
description: オーケストレーターが統括するコードベース探索の実働
tools: Read, Grep, Glob, Bash
kind: readonly
---

## When to invoke

- **探索実働。** オーケストレーターが統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。

## Core Responsibilities

- 指定された範囲を漏れなく走査し、根拠(ファイルパス・行番号)付きで報告する。

## 作業手順

- 依頼された探索範囲だけを走査する。範囲外に気づいた事項は報告に含め、自分で追わない。
- 検索が 0 件でもそれを結論とせず、別の語や別の手段で裏を取る。

## 制約

- **探索実働として依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。

## Output Format

- 見つけた対象のファイルパスと行番号
- 走査した範囲と、範囲外で気づいた事項
```

`realtime-research.md`:

```markdown
---
id: realtime-research
label: リアルタイム情報調査
description: 最新動向・リリース情報・外部エコシステムなど、外部の最新情報を要する調査
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch
kind: readonly
---

## When to invoke

- **リアルタイム情報調査。** 最新動向・リリース情報・外部エコシステムなど、外部の最新情報へのアクセスが主目的の調査を行うとき。

## Core Responsibilities

- 一次情報源の URL と情報の鮮度を添えて報告する。

## 作業手順

- 最新動向・リリース情報は WebSearch / WebFetch で調べ、一次情報源に当たる。
- 二次情報しか得られなかった項目は、その旨を明示する。

## 制約

- **リアルタイム情報調査として依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。
- 調査結果の採否を自分で判断しない。判断材料を揃えて返す。

## Output Format

- 情報源 URL 付きの要約
- 各情報の鮮度(いつ時点の情報か)
- 未検証情報と検証済み情報の区別
```

`realtime-research.grok.md`(ベンダー別追記):

```markdown
---
id: realtime-research
vendor: grok
---

## 作業手順

- X 由来・ソーシャル由来の情報を未検証として明示し、一次情報源で裏を取れたものと区別する。
```

`independent-review.md`:

```markdown
---
id: independent-review
label: 設計書・実装計画書の独立レビュー
description: 設計書・実装計画書の前提検証と反証提示
tools: Read, Grep, Glob, Bash
kind: readonly
---

## When to invoke

- **独立レビュー。** 設計書・実装計画書の前提・暗黙の仮定・楽観的な見積もりを検証し、反証を提示するとき。

## Core Responsibilities

- 文書に書かれた前提を疑い、根拠付きの反証を提示する。採否の判断はせず、オーケストレーターに委ねる。

## 作業手順

- 対象文書の原本のみを読む。他のレビューの指摘が渡されても、読まずにその旨を報告する。
- 文書が言及するコード・ファイルの実在と記述の整合を Read / Grep / Glob で確かめてから指摘する。

## 制約

- **独立レビューとして依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。
- **独立レビューとして依頼されたときは**、指摘の採否を自分で判断しない。判断材料を揃えて返す。

## Output Format

指摘ごとに次を書く。

- 対象箇所(節・行)
- 疑った前提と、その反証(根拠のファイルパス・行番号または情報源)
- 反証が正しい場合の影響範囲
```

`doc-review.md`:

```markdown
---
id: doc-review
label: 設計書・実装計画書のレビュー
description: 設計書・実装計画書の理解の言語化と暗黙知・矛盾の抽出
tools: Read, Grep, Glob
kind: readonly
---

## When to invoke

- **文書レビュー。** 設計書・実装計画書を読み、理解した内容を言語化し、暗黙知と矛盾を抽出するとき。

## Core Responsibilities

- 文書から読み取れた内容を自分の言葉で述べ、書かれていないが実装時に必要になる判断を列挙する。

## 作業手順

- 文書を通読してから、節をまたいだ食い違いを探す。
- 「この記述からは A とも B とも読める」という曖昧さを具体的に指摘する。

## 制約

- **文書レビューとして依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。
- **文書レビューとして依頼されたときは**、指摘の採否を自分で判断しない。

## Output Format

- 理解した内容
- 暗黙知(実装時に決める必要がある事項)
- 矛盾・不整合
- 記述の過不足
```

`code-review.md`:

```markdown
---
id: code-review
label: コードレビュー
description: 変更差分のレビュー
tools: Read, Grep, Glob, Bash
kind: readonly
---

## When to invoke

- **コードレビュー。** 変更差分を読み、欠陥・規約違反・設計上の懸念を指摘するとき。

## Core Responsibilities

- 差分の範囲で欠陥を指摘し、根拠(ファイルパス・行番号)を添える。

## 作業手順

- 差分だけでなく、変更箇所の呼び出し元も読む。
- 指摘には修正案を添える。

## 制約

- **コードレビューとして依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。指摘の適用は行わない。
- 差分の範囲を越えた改善提案は、指摘とは分けて書く。

## Output Format

- 指摘ごとに、ファイルパス・行番号・問題・修正案
- 差分の範囲外で気づいた事項(分けて記載)
```

`advisor.md`:

```markdown
---
id: advisor
label: 設計・計画・実装のアドバイザー
description: 設計・計画・実装の判断に対する助言
tools: Read, Grep, Glob
kind: readonly
---

## When to invoke

- **助言。** 設計・計画・実装の判断に迷った依頼元から、選択肢の評価を求められたとき。

## Core Responsibilities

- 選択肢とその trade-off を整理し、推奨と理由を述べる。

## 作業手順

- 判断に必要な前提が依頼文にないときは、推測で埋めず、何が足りないかを返す。

## 制約

- **アドバイザーとして依頼されたときは**、助言のみを返し、作業をしない。ファイルを変更しない。
- **アドバイザーとして依頼されたときは**、サブエージェントを起動しない。

## Output Format

- 推奨と、その理由
- 判断を左右する軸と、選択肢ごとの評価
- 前提が足りず判断できない事項
```

- [ ] **Step 4: 固有名の混入を検査する**

Run:
```bash
grep -rn "GPT Sol\|GPT Terra\|GPT Luna\|Grok Implementer\|Grok Researcher\|Claude Researcher" plugins/agent-policy/assets/roles/
```
Expected: 出力なし(1 件でも出たら §6.4 違反なので該当行を差し戻し文言へ置き換える)

- [ ] **Step 5: MCP 言及の混入を検査する**

Run:
```bash
grep -rn "mcp__\|Context7\|Playwright\|Serena\|MCP" plugins/agent-policy/assets/roles/
```
Expected: 出力なし

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/assets/roles/
git commit -m "feat(agent-policy): 役割断片を追加する"
```

---

### Task 3: 断片の読み込みと合成を実装する

**Files:**
- Create: `plugins/agent-policy/src/agents/fragments.ts`
- Create: `plugins/agent-policy/src/agents/compose.ts`
- Test: `plugins/agent-policy/src/agents/__test__/compose.test.ts`

**Interfaces:**
- Consumes: `RoleId` / `ROLES` / `resolveTools` / `allowsAgentTool` / `sortRoleIds`(Task 1)、断片ファイル(Task 2)
- Produces:
  - `interface Fragment { id: string; label: string; description: string; tools: string[]; kind: RoleKind; sections: Map<string, string[]> }`
  - `function loadFragments(dirs: string[], vendor: Vendor): Map<string, Fragment>` — `dirs` は探索順(後の要素が優先)
  - `function loadCommon(dirs: string[]): Map<string, string[]>`
  - `type Vendor = "gpt" | "grok" | "claude"`
  - `interface ComposeInput { name: string; model: string; vendor: Vendor; roleIds: RoleId[]; fragmentDirs: string[] }`
  - `function compose(input: ComposeInput): string`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/compose.test.ts` を作る。

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { compose } from "../compose"

const PLUGIN_ROLES = fileURLToPath(
  new URL("../../../assets/roles/", import.meta.url)
)

let temporary: string

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
})

afterEach(() => {
  fs.rmSync(temporary, { recursive: true, force: true })
})

function build(roleIds: string[], overrides: Record<string, unknown> = {}) {
  return compose({
    name: "test-agent",
    model: "test-alias",
    vendor: "gpt",
    roleIds: roleIds as never,
    fragmentDirs: [PLUGIN_ROLES],
    ...overrides
  } as never)
}

function frontmatter(document: string): Record<string, string> {
  const lines = document.split("\n")
  const close = lines.indexOf("---", 1)
  const entries: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ")
    if (at > 0) entries[line.slice(0, at)] = line.slice(at + 2)
  }
  return entries
}

describe("frontmatter", () => {
  it("name と model を反映する", () => {
    const meta = frontmatter(build(["complex-impl"]))
    expect(meta.name).toBe("test-agent")
    expect(meta.model).toBe("test-alias")
  })

  it("description を役割の description から組み立てる", () => {
    const meta = frontmatter(build(["complex-impl"]))
    expect(meta.description).toContain("Use this agent when")
    expect(meta.description).toContain("複雑なコーディング")
    expect(meta.description).toContain("を委譲するとき")
  })

  it("複数役割の description を連結する", () => {
    const meta = frontmatter(build(["normal-impl", "explore"]))
    expect(meta.description).toContain("通常のコーディング")
    expect(meta.description).toContain("コードベース探索")
  })

  it("color をベンダーごとの固定値にする", () => {
    expect(frontmatter(build(["complex-impl"])).color).toBe("yellow")
    expect(
      frontmatter(build(["normal-impl"], { vendor: "grok" })).color
    ).toBe("red")
    expect(
      frontmatter(build(["normal-impl"], { vendor: "claude" })).color
    ).toBe("blue")
  })

  it("役割マーカーを ROLES の定義順で並べる", () => {
    const meta = frontmatter(build(["explore", "complex-impl"]))
    expect(meta["agent-policy-role"]).toBe("complex-impl, explore")
  })

  it("tools に MCP ツールを含まない", () => {
    const meta = frontmatter(build(["complex-impl", "explore"]))
    expect(meta.tools).not.toContain("mcp__")
  })

  it("Agent の付与が役割で決まる", () => {
    expect(frontmatter(build(["complex-impl"])).tools).toContain("Agent")
    expect(frontmatter(build(["light-impl"])).tools).not.toContain("Agent")
    expect(frontmatter(build(["explore"])).tools).not.toContain("Agent")
    expect(
      frontmatter(build(["light-impl", "complex-impl"])).tools
    ).toContain("Agent")
  })
})

describe("本文", () => {
  it("節の順序が仕様どおりになる", () => {
    const body = build(["complex-impl"])
    const order = ["## When to invoke", "## Core Responsibilities", "## 作業手順", "## アドバイザーへの相談", "## 制約", "## Output Format"]
    let cursor = -1
    for (const heading of order) {
      const at = body.indexOf(heading)
      expect(at).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it("Agent が付かないとき「アドバイザーへの相談」節を出さない", () => {
    expect(build(["explore"])).not.toContain("## アドバイザーへの相談")
  })

  it("ツール運用節を作らない", () => {
    expect(build(["complex-impl", "explore"])).not.toContain("## ツール運用")
  })

  it("単一役割では Output Format に小見出しを立てない", () => {
    const body = build(["complex-impl"])
    const section = body.slice(body.indexOf("## Output Format"))
    expect(section).not.toContain("### ")
  })

  it("複数役割では Output Format に役割ごとの h3 を立てる", () => {
    const body = build(["complex-impl", "explore"])
    const section = body.slice(body.indexOf("## Output Format"))
    expect(section).toContain("### 複雑または重要な実装")
    expect(section).toContain("### コードベース探索実働")
  })

  it("読み取り役割の制約が役割スコープ付きで出る", () => {
    expect(build(["independent-review"])).toContain(
      "**独立レビューとして依頼されたときは**"
    )
  })

  it("冒頭宣言に定義名と役割名が入る", () => {
    const body = build(["complex-impl", "explore"])
    expect(body).toContain("あなたは test-agent")
    expect(body).toContain("複雑または重要な実装")
    expect(body).toContain("コードベース探索実働")
  })

  it("他定義の固有名を含まない", () => {
    const body = build(["complex-impl", "normal-impl", "light-impl"])
    for (const name of ["GPT Sol", "GPT Terra", "GPT Luna", "Grok Researcher"]) {
      expect(body).not.toContain(name)
    }
  })
})

describe("断片の解決", () => {
  it("ベンダー別断片が共通断片の同名節へ追記される", () => {
    const withGrok = compose({
      name: "g",
      model: "m",
      vendor: "grok",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES]
    })
    const withGpt = compose({
      name: "g",
      model: "m",
      vendor: "gpt",
      roleIds: ["realtime-research"] as never,
      fragmentDirs: [PLUGIN_ROLES]
    })
    expect(withGrok).toContain("ソーシャル由来")
    expect(withGpt).not.toContain("ソーシャル由来")
    // 追記であって置き換えではないため、共通側の記述も残る
    expect(withGrok).toContain("一次情報源")
  })

  it("プロジェクト側の断片が共通断片を置き換える", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "explore.md"),
      [
        "---",
        "id: explore",
        "label: コードベース探索実働",
        "description: プロジェクト独自の探索規律",
        "tools: Read, Grep, Glob",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **独自探索。** プロジェクト固有の探索規律に従うとき。",
        ""
      ].join("\n")
    )

    const body = compose({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["explore"] as never,
      fragmentDirs: [PLUGIN_ROLES, projectRoles]
    })
    expect(body).toContain("独自探索")
    expect(body).not.toContain("依頼された探索範囲だけを走査する")
  })

  it("プロジェクト側にしかない役割 ID を解決できる", () => {
    const projectRoles = path.join(temporary, "roles")
    fs.mkdirSync(projectRoles, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoles, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の切り分け",
        "description: 障害の切り分け",
        "tools: Read, Grep, Glob, Bash",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **切り分け。** 障害の原因を切り分けるとき。",
        ""
      ].join("\n")
    )

    const body = compose({
      name: "x",
      model: "m",
      vendor: "gpt",
      roleIds: ["triage"] as never,
      fragmentDirs: [PLUGIN_ROLES, projectRoles]
    })
    expect(body).toContain("切り分け")
  })

  it("未知の役割 ID ではエラーを投げる", () => {
    expect(() => build(["no-such-role"])).toThrow(/no-such-role/)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/agents/__test__/compose.test.ts`
Expected: FAIL — `Cannot find module '../compose'`

- [ ] **Step 3: `fragments.ts` を実装する**

```typescript
import fs from "node:fs"
import path from "node:path"
import type { RoleKind } from "./roles"

export type Vendor = "gpt" | "grok" | "claude"

export interface Fragment {
  id: string
  label: string
  description: string
  tools: string[]
  kind: RoleKind
  sections: Map<string, string[]>
}

interface Parsed {
  meta: Record<string, string>
  sections: Map<string, string[]>
}

function parse(content: string): Parsed {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") throw new Error("Fragment has no frontmatter")
  const close = lines.indexOf("---", 1)
  if (close === -1) throw new Error("Fragment frontmatter is not closed")

  const meta: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }

  const sections = new Map<string, string[]>()
  let heading: string | undefined
  for (const line of lines.slice(close + 1)) {
    if (line.startsWith("## ")) {
      heading = line.trim()
      if (!sections.has(heading)) sections.set(heading, [])
      continue
    }
    if (heading === undefined) continue
    sections.get(heading)?.push(line)
  }

  for (const [key, body] of sections) {
    sections.set(key, trim(body))
  }
  return { meta, sections }
}

function trim(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === "") start += 1
  while (end > start && lines[end - 1]?.trim() === "") end -= 1
  return lines.slice(start, end)
}

function require(meta: Record<string, string>, key: string, file: string): string {
  const value = meta[key]
  if (value === undefined || value === "") {
    throw new Error(`Fragment is missing "${key}": ${file}`)
  }
  return value
}

function readFragment(file: string): Fragment {
  const { meta, sections } = parse(fs.readFileSync(file, "utf8"))
  const kind = require(meta, "kind", file)
  if (kind !== "impl" && kind !== "readonly") {
    throw new Error(`Fragment "kind" must be impl or readonly: ${file}`)
  }
  return {
    id: require(meta, "id", file),
    label: require(meta, "label", file),
    description: require(meta, "description", file),
    tools: require(meta, "tools", file)
      .split(",")
      .map((tool) => tool.trim()),
    kind,
    sections
  }
}

function appendSections(base: Fragment, extra: Map<string, string[]>): void {
  for (const [heading, body] of extra) {
    const current = base.sections.get(heading)
    base.sections.set(heading, current === undefined ? body : [...current, ...body])
  }
}

// dirs は探索順。後の要素が同じ役割 ID を持つとき、その断片で置き換える。
export function loadFragments(dirs: string[], vendor: Vendor): Map<string, Fragment> {
  const fragments = new Map<string, Fragment>()

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .sort((left, right) => left.localeCompare(right))

    for (const name of files) {
      // <id>.<vendor>.md はベンダー別断片。ここでは読み飛ばす。
      if (name.split(".").length > 2) continue
      const fragment = readFragment(path.join(dir, name))
      fragments.set(fragment.id, fragment)
    }
  }

  // ベンダー別断片は、置き換え後の断片へ追記する。
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(`.${vendor}.md`)) continue
      const { meta, sections } = parse(fs.readFileSync(path.join(dir, name), "utf8"))
      const target = fragments.get(meta.id ?? "")
      if (target !== undefined) appendSections(target, sections)
    }
  }

  return fragments
}

export function loadCommon(dirs: string[]): Map<string, string[]> {
  let sections = new Map<string, string[]>()
  for (const dir of dirs) {
    const file = path.join(dir, "_common.md")
    if (!fs.existsSync(file)) continue
    sections = parse(fs.readFileSync(file, "utf8")).sections
  }
  if (sections.size === 0) throw new Error("_common.md not found")
  return sections
}
```

- [ ] **Step 4: `compose.ts` を実装する**

```typescript
import { type Fragment, type Vendor, loadCommon, loadFragments } from "./fragments"
import { type RoleId, allowsAgentTool, resolveTools, sortRoleIds } from "./roles"

export interface ComposeInput {
  name: string
  model: string
  vendor: Vendor
  roleIds: RoleId[]
  fragmentDirs: string[]
}

const COLORS: Record<Vendor, string> = {
  gpt: "yellow",
  grok: "red",
  claude: "blue"
}

const BODY_ORDER = [
  "## When to invoke",
  "## Core Responsibilities",
  "## 作業手順"
] as const

export function compose(input: ComposeInput): string {
  const fragments = loadFragments(input.fragmentDirs, input.vendor)
  const common = loadCommon(input.fragmentDirs)
  const ordered = sortRoleIds(input.roleIds)

  const selected: Fragment[] = ordered.map((id) => {
    const fragment = fragments.get(id)
    if (fragment === undefined) throw new Error(`Unknown role id: ${id}`)
    return fragment
  })

  const withAgent = allowsAgentTool(input.roleIds)
  const tools = resolveToolsFor(input.roleIds, selected, withAgent)

  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${describe(selected)}`,
    `model: ${input.model}`,
    `color: ${COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    `agent-policy-role: ${ordered.join(", ")}`,
    "---",
    ""
  ]

  const body: string[] = []
  body.push(...preamble(common, input.name, selected), "")

  for (const heading of BODY_ORDER) {
    const items = selected.flatMap((fragment) => fragment.sections.get(heading) ?? [])
    if (items.length === 0) continue
    body.push(heading, "", ...items, "")
  }

  if (withAgent) {
    const advisor = common.get("## アドバイザーへの相談")
    if (advisor !== undefined) body.push("## アドバイザーへの相談", "", ...advisor, "")
  }

  const constraints = [
    ...(common.get("## 制約") ?? []),
    ...selected.flatMap((fragment) => fragment.sections.get("## 制約") ?? [])
  ]
  if (constraints.length > 0) body.push("## 制約", "", ...constraints, "")

  body.push("## Output Format", "")
  if (selected.length === 1) {
    body.push(...(selected[0]?.sections.get("## Output Format") ?? []), "")
  } else {
    for (const fragment of selected) {
      const items = fragment.sections.get("## Output Format")
      if (items === undefined || items.length === 0) continue
      body.push(`### ${fragment.label}`, "", ...items, "")
    }
  }

  return [...head, ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}

// プロジェクト側の断片が持ち込んだ未知の役割 ID でも tools を解決できるよう、
// ROLES に無い役割は断片の tools をそのまま足す。
function resolveToolsFor(
  ids: RoleId[],
  selected: Fragment[],
  withAgent: boolean
): string[] {
  const tools = resolveTools(ids).filter((tool) => tool !== "Agent")
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (!tools.includes(tool)) tools.push(tool)
    }
  }
  if (withAgent) tools.push("Agent")
  return tools
}

function describe(selected: Fragment[]): string {
  const list = selected.map((fragment) => fragment.description).join("、")
  return `Use this agent when ${list}を委譲するとき。詳細は本文の「When to invoke」を参照。`
}

function preamble(
  common: Map<string, string[]>,
  name: string,
  selected: Fragment[]
): string[] {
  const labels = selected.map((fragment) => `「${fragment.label}」`).join("、")
  return (common.get("## Preamble") ?? []).map((line) =>
    line.replace("{{NAME}}", name).replace("{{ROLE_LABELS}}", labels)
  )
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/agents/__test__/compose.test.ts`
Expected: PASS

失敗するときは、断片の節見出しが `compose.ts` の期待(`## When to invoke` / `## Core Responsibilities` / `## 作業手順` / `## 制約` / `## Output Format`)と一致しているかを先に疑う。

- [ ] **Step 6: lint と typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/agents/fragments.ts plugins/agent-policy/src/agents/compose.ts plugins/agent-policy/src/agents/__test__/compose.test.ts
git commit -m "feat(agent-policy): 役割断片の読み込みと定義合成を実装する"
```

---

### Task 4: プリセットを定義し、ビルドで同梱定義を生成する

**Files:**
- Create: `plugins/agent-policy/src/agents/presets.ts`
- Create: `plugins/agent-policy/src/agents/build-presets.ts`
- Test: `plugins/agent-policy/src/agents/__test__/presets.test.ts`
- Modify: `plugins/agent-policy/build.ts`
- Delete: `plugins/agent-policy/agents/claude-researcher.md`
- Delete: `plugins/agent-policy/agents/gpt-researcher.md`
- Delete: `plugins/agent-policy/agents/grok-researcher.md`
- Delete: `plugins/agent-policy/agents/grok-implementer.md`

**Interfaces:**
- Consumes: `compose`(Task 3)、`PRESET_ASSIGNMENTS` / `RoleId`(Task 1)
- Produces:
  - `interface Preset { name: string; vendor: Vendor; defaultAlias: string; roleIds: RoleId[] }`
  - `const PRESETS: readonly Preset[]`
  - `const DEFAULT_ALIASES: Record<string, string>` — プリセット名 → 既定エイリアス。フックの `fallback` もこれを参照する
  - `function buildPresets(pluginRoot: string): void`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/presets.test.ts` を作る。

```typescript
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { compose } from "../compose"
import { DEFAULT_ALIASES, PRESETS } from "../presets"
import { PRESET_ASSIGNMENTS } from "../roles"

const PLUGIN_ROLES = fileURLToPath(
  new URL("../../../assets/roles/", import.meta.url)
)

describe("PRESETS", () => {
  it("4 種を定義する", () => {
    expect(PRESETS.map((preset) => preset.name)).toEqual([
      "gpt-sol",
      "gpt-terra",
      "gpt-luna",
      "grok"
    ])
  })

  it("既定エイリアスが仕様どおりである", () => {
    expect(DEFAULT_ALIASES["gpt-sol"]).toBe("claude-gpt-5-6-sol")
    expect(DEFAULT_ALIASES["gpt-terra"]).toBe("claude-gpt-5-6-terra")
    expect(DEFAULT_ALIASES["gpt-luna"]).toBe("claude-gpt-5-6-luna")
    expect(DEFAULT_ALIASES.grok).toBe("claude-grok-4-6")
  })

  it("PRESETS と DEFAULT_ALIASES が同じ値を指す", () => {
    for (const preset of PRESETS) {
      expect(preset.defaultAlias).toBe(DEFAULT_ALIASES[preset.name])
    }
  })
})

describe("担当表との一致", () => {
  it("各方針が割り当てた役割を、担当プリセットが漏れなく持つ", () => {
    const byName = new Map(PRESETS.map((preset) => [preset.name, preset]))
    const missing: string[] = []

    for (const [policy, assignments] of Object.entries(PRESET_ASSIGNMENTS)) {
      for (const [roleId, presetName] of Object.entries(assignments)) {
        const preset = byName.get(presetName)
        if (preset === undefined) {
          missing.push(`${policy}: unknown preset ${presetName}`)
          continue
        }
        if (!preset.roleIds.includes(roleId as never)) {
          missing.push(`${policy}: ${presetName} lacks ${roleId}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})

describe("合成結果", () => {
  it("すべてのプリセットが合成でき、MCP ツールを含まない", () => {
    for (const preset of PRESETS) {
      const document = compose({
        name: preset.name,
        model: preset.defaultAlias,
        vendor: preset.vendor,
        roleIds: preset.roleIds,
        fragmentDirs: [PLUGIN_ROLES]
      })
      expect(document).toContain(`name: ${preset.name}`)
      expect(document).toContain(`model: ${preset.defaultAlias}`)
      expect(document).not.toContain("mcp__")
      expect(document).not.toContain("## ツール運用")
    }
  })

  it("grok が Agent を持つ(with-grok-policy の例外を満たす)", () => {
    const grok = PRESETS.find((preset) => preset.name === "grok")
    const document = compose({
      name: "grok",
      model: "m",
      vendor: "grok",
      roleIds: grok?.roleIds ?? [],
      fragmentDirs: [PLUGIN_ROLES]
    })
    expect(document).toMatch(/^tools:.*\bAgent\b/m)
  })

  it("gpt-luna が Agent を持たない", () => {
    const luna = PRESETS.find((preset) => preset.name === "gpt-luna")
    const document = compose({
      name: "gpt-luna",
      model: "m",
      vendor: "gpt",
      roleIds: luna?.roleIds ?? [],
      fragmentDirs: [PLUGIN_ROLES]
    })
    expect(document).not.toMatch(/^tools:.*\bAgent\b/m)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/agents/__test__/presets.test.ts`
Expected: FAIL — `Cannot find module '../presets'`

- [ ] **Step 3: `presets.ts` を実装する**

```typescript
import type { Vendor } from "./fragments"
import type { RoleId } from "./roles"

export interface Preset {
  name: string
  vendor: Vendor
  defaultAlias: string
  roleIds: RoleId[]
}

// 役割は設計書 §8.1。各方針の担当表(PRESET_ASSIGNMENTS)と一致させる。
export const PRESETS: readonly Preset[] = [
  {
    name: "gpt-sol",
    vendor: "gpt",
    defaultAlias: "claude-gpt-5-6-sol",
    roleIds: ["complex-impl"]
  },
  {
    name: "gpt-terra",
    vendor: "gpt",
    defaultAlias: "claude-gpt-5-6-terra",
    roleIds: [
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ]
  },
  {
    name: "gpt-luna",
    vendor: "gpt",
    defaultAlias: "claude-gpt-5-6-luna",
    roleIds: ["light-impl"]
  },
  {
    name: "grok",
    vendor: "grok",
    defaultAlias: "claude-grok-4-6",
    roleIds: [
      "normal-impl",
      "light-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ]
  }
]

export const DEFAULT_ALIASES: Record<string, string> = Object.fromEntries(
  PRESETS.map((preset) => [preset.name, preset.defaultAlias])
)
```

- [ ] **Step 4: `build-presets.ts` を実装する**

```typescript
import fs from "node:fs"
import path from "node:path"
import { compose } from "./compose"
import { PRESETS } from "./presets"

// 同梱プリセットはプラグイン同梱の断片だけから作る。
// プロジェクト側の断片(.claude/agent-policy/roles/)は読まない。
export function buildPresets(pluginRoot: string): void {
  const roles = path.join(pluginRoot, "assets", "roles")
  const outDir = path.join(pluginRoot, "agents")
  fs.mkdirSync(outDir, { recursive: true })

  for (const preset of PRESETS) {
    const document = compose({
      name: preset.name,
      model: preset.defaultAlias,
      vendor: preset.vendor,
      roleIds: preset.roleIds,
      fragmentDirs: [roles]
    })
    fs.writeFileSync(path.join(outDir, `${preset.name}.md`), document)
  }
}
```

- [ ] **Step 5: `build.ts` を更新する**

このタスクの時点では `src/setup-agents.ts` がまだ存在しない。entryPoints へ足すのは Task 6 Step 5 で行う。ここではプリセット生成の呼び出しだけを足す。

```typescript
import path from "node:path"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"
import { buildPresets } from "./src/agents/build-presets"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "session-start": "./src/hooks/session-start.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})

buildPresets(path.dirname(fileURLToPath(import.meta.url)))
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/agents/__test__/presets.test.ts`
Expected: PASS

- [ ] **Step 7: 旧定義を削除し、プリセットを生成する**

```bash
git rm plugins/agent-policy/agents/claude-researcher.md \
       plugins/agent-policy/agents/gpt-researcher.md \
       plugins/agent-policy/agents/grok-researcher.md \
       plugins/agent-policy/agents/grok-implementer.md
pnpm --filter agent-policy-scripts build
```

Expected: `plugins/agent-policy/agents/` に `gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` / `grok.md` の 4 件だけが残る

- [ ] **Step 8: 生成物を目視で確認する**

Run:
```bash
ls plugins/agent-policy/agents/
grep -c "mcp__" plugins/agent-policy/agents/*.md
head -10 plugins/agent-policy/agents/grok.md
```
Expected: 4 ファイル、`mcp__` は全ファイルで 0 件、`grok.md` の frontmatter に `model: claude-grok-4-6` と `agent-policy-role` がある

- [ ] **Step 9: コミット**

```bash
git add plugins/agent-policy/src/agents/presets.ts plugins/agent-policy/src/agents/build-presets.ts plugins/agent-policy/src/agents/__test__/presets.test.ts plugins/agent-policy/build.ts plugins/agent-policy/agents/
git commit -m "feat(agent-policy): プリセットをビルド生成に切り替え、researcher 3 定義を廃止する"
```

---

### Task 5: 差分検出を実装する

**Files:**
- Create: `plugins/agent-policy/src/setup-agents.ts`
- Test: `plugins/agent-policy/src/__test__/setup-agents.test.ts`

**Interfaces:**
- Consumes: `compose`(Task 3)、`PRESETS` / `DEFAULT_ALIASES`(Task 4)
- Produces: CLI。`--check` で差分 JSON を stdout へ 1 行出力する
  - オプション: `--vendor <gpt|grok>` `--name <name>` `--model <alias>` `--roles <csv>` `--dir <path>` `--check` `--write` `--keep <selector>`(繰り返し可)
  - 差分 JSON の形は設計書 §10.2

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/__test__/setup-agents.test.ts` を作る。

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../setup-agents.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url))

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
  fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true })
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

// CLI が stdout へ書く JSON。実行時にはエラー系で一部フィールドが欠けるが、
// 各テストは自分が検証するフィールドしか触らないため非 optional で受ける。
interface CheckResult {
  ok: boolean
  error: string
  target: string
  exists: boolean
  identical: boolean
  preambleChanged: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
  action: string
  kept: string[]
}

function run(args: string[]): CheckResult {
  let output: string
  try {
    output = runTs(CLI, args, {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
    })
  } catch (error) {
    // CLI はエラー時も JSON を stdout へ書いてから終了コード 1 で終わる。
    // runTs(execFileSync)は非ゼロ終了で例外を投げるため、stdout を取り出す。
    const stdout = (error as { stdout?: string }).stdout
    if (stdout === undefined || stdout === "") throw error
    output = stdout
  }
  return JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as CheckResult
}

function check(extra: string[] = []): CheckResult {
  return run([
    "--vendor", "gpt",
    "--name", "gpt-sol",
    "--model", "claude-gpt-5-6-sol",
    "--roles", "complex-impl",
    "--dir", project,
    "--check",
    ...extra
  ])
}

function target(): string {
  return path.join(project, ".claude", "agents", "gpt-sol.md")
}

describe("--check", () => {
  it("既存が無いとき exists: false を返す", () => {
    const result = check()
    expect(result.ok).toBe(true)
    expect(result.exists).toBe(false)
  })

  it("既存がテンプレートと同一のとき identical: true を返す", () => {
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write"
    ])
    const result = check()
    expect(result.exists).toBe(true)
    expect(result.identical).toBe(true)
  })

  it("既存にしかない tools を toolsOnlyInExisting に出す", () => {
    seed({ tools: "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7" })
    const result = check()
    expect(result.frontmatter.toolsOnlyInExisting).toContain("mcp__context7")
  })

  it("既存にしかない frontmatter キーを keysOnlyInExisting に出す", () => {
    seed({ extraKeys: { permissionMode: "plan" } })
    const result = check()
    expect(result.frontmatter.keysOnlyInExisting).toContain("permissionMode")
  })

  it("値の違う共通キーを changed に出す", () => {
    seed({ model: "my-own-alias" })
    const entry = check().frontmatter.changed.find(
      (item) => item.key === "model"
    )
    expect(entry?.existing).toBe("my-own-alias")
    expect(entry?.template).toBe("claude-gpt-5-6-sol")
  })

  it("既存にしかない節を sectionsOnlyInExisting に出す", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const result = check()
    expect(result.body.sectionsOnlyInExisting).toContain("## ツール運用")
  })

  it("冒頭宣言の変更を preambleChanged に出す", () => {
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    const result = check()
    expect(result.preambleChanged).toBe(true)
  })

  it("節の中身の変更を sectionsChanged に出す", () => {
    seed({ replaceConstraints: "- 私が書き換えた制約。\n" })
    const result = check()
    expect(result.body.sectionsChanged).toContain("## 制約")
  })

  it("不正な役割 ID でエラーを返す", () => {
    const result = run([
      "--vendor", "gpt", "--name", "x", "--model", "m",
      "--roles", "no-such-role", "--dir", project, "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("no-such-role")
  })

  it("model の欠落でエラーを返す", () => {
    const result = run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--roles", "complex-impl", "--dir", project, "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("model")
  })
})

// テンプレートを生成してから指定箇所を書き換え、既存ファイルとして置く。
function seed(options: {
  tools?: string
  model?: string
  extraKeys?: Record<string, string>
  extraSection?: string
  preamble?: string
  replaceConstraints?: string
}): void {
  run([
    "--vendor", "gpt", "--name", "gpt-sol",
    "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
    "--dir", project, "--write"
  ])
  let content = fs.readFileSync(target(), "utf8")

  if (options.tools !== undefined) {
    content = content.replace(/^tools: .*$/m, `tools: ${options.tools}`)
  }
  if (options.model !== undefined) {
    content = content.replace(/^model: .*$/m, `model: ${options.model}`)
  }
  for (const [key, value] of Object.entries(options.extraKeys ?? {})) {
    content = content.replace(/^---$/m, "---").replace(
      /^(name: .*)$/m,
      `$1\n${key}: ${value}`
    )
  }
  if (options.extraSection !== undefined) {
    content = `${content}\n${options.extraSection}`
  }
  if (options.preamble !== undefined) {
    content = content.replace(/あなたは gpt-sol。[^\n]*/, options.preamble)
  }
  if (options.replaceConstraints !== undefined) {
    content = content.replace(
      /## 制約\n\n[\s\S]*?(?=\n## )/,
      `## 制約\n\n${options.replaceConstraints}`
    )
  }

  fs.writeFileSync(target(), content)
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts`
Expected: FAIL — `setup-agents.ts` が存在しない

- [ ] **Step 3: `setup-agents.ts` の骨格と `--check` を実装する**

```typescript
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compose } from "./agents/compose"
import type { Vendor } from "./agents/fragments"
import type { RoleId } from "./agents/roles"

interface Options {
  vendor: Vendor
  name: string
  model: string
  roles: RoleId[]
  dir: string
  check: boolean
  write: boolean
  keep: string[]
}

interface Diff {
  ok: true
  target: string
  exists: boolean
  identical: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  preambleChanged: boolean
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
}

interface Document {
  order: string[]
  meta: Map<string, string>
  preamble: string
  sections: Map<string, string>
}

function parseDocument(content: string): Document {
  const lines = content.split("\n")
  const close = lines.indexOf("---", 1)
  const meta = new Map<string, string>()
  const order: string[] = []

  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ")
    if (at <= 0) continue
    const key = line.slice(0, at)
    meta.set(key, line.slice(at + 2))
    order.push(key)
  }

  const preamble: string[] = []
  const sections = new Map<string, string>()
  let heading: string | undefined
  let buffer: string[] = []

  for (const line of lines.slice(close + 1)) {
    if (line.startsWith("## ")) {
      if (heading !== undefined) sections.set(heading, buffer.join("\n").trim())
      heading = line.trim()
      buffer = []
      continue
    }
    if (heading === undefined) preamble.push(line)
    else buffer.push(line)
  }
  if (heading !== undefined) sections.set(heading, buffer.join("\n").trim())

  return { order, meta, preamble: preamble.join("\n").trim(), sections }
}

function splitTools(value: string | undefined): string[] {
  if (value === undefined) return []
  return value.split(",").map((tool) => tool.trim()).filter((tool) => tool !== "")
}

function only(left: string[], right: string[]): string[] {
  return left.filter((item) => !right.includes(item))
}

function pluginRoot(): string {
  return (
    process.env.CLAUDE_PLUGIN_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  )
}

function fragmentDirs(projectDir: string): string[] {
  return [
    path.join(pluginRoot(), "assets", "roles"),
    path.join(projectDir, ".claude", "agent-policy", "roles")
  ]
}

function template(options: Options): string {
  return compose({
    name: options.name,
    model: options.model,
    vendor: options.vendor,
    roleIds: options.roles,
    fragmentDirs: fragmentDirs(options.dir)
  })
}

function targetPath(options: Options): string {
  return path.join(options.dir, ".claude", "agents", `${options.name}.md`)
}

function diff(options: Options): Diff {
  const rendered = template(options)
  const file = targetPath(options)
  const relative = path.relative(options.dir, file).split(path.sep).join("/")

  if (!fs.existsSync(file)) {
    return {
      ok: true,
      target: relative,
      exists: false,
      identical: false,
      frontmatter: {
        changed: [],
        toolsOnlyInExisting: [],
        toolsOnlyInTemplate: [],
        keysOnlyInExisting: []
      },
      preambleChanged: false,
      body: {
        sectionsOnlyInExisting: [],
        sectionsOnlyInTemplate: [],
        sectionsChanged: []
      }
    }
  }

  const existingRaw = fs.readFileSync(file, "utf8")
  const existing = parseDocument(existingRaw)
  const expected = parseDocument(rendered)

  const existingTools = splitTools(existing.meta.get("tools"))
  const expectedTools = splitTools(expected.meta.get("tools"))

  const changed: Diff["frontmatter"]["changed"] = []
  for (const [key, value] of expected.meta) {
    if (key === "tools") continue
    const current = existing.meta.get(key)
    if (current !== undefined && current !== value) {
      changed.push({ key, existing: current, template: value })
    }
  }

  const sectionsChanged: string[] = []
  for (const [heading, body] of expected.sections) {
    const current = existing.sections.get(heading)
    if (current !== undefined && current !== body) sectionsChanged.push(heading)
  }

  return {
    ok: true,
    target: relative,
    exists: true,
    identical: existingRaw === rendered,
    frontmatter: {
      changed,
      toolsOnlyInExisting: only(existingTools, expectedTools),
      toolsOnlyInTemplate: only(expectedTools, existingTools),
      keysOnlyInExisting: only([...existing.meta.keys()], [...expected.meta.keys()])
    },
    preambleChanged: existing.preamble !== expected.preamble,
    body: {
      sectionsOnlyInExisting: only(
        [...existing.sections.keys()],
        [...expected.sections.keys()]
      ),
      sectionsOnlyInTemplate: only(
        [...expected.sections.keys()],
        [...existing.sections.keys()]
      ),
      sectionsChanged
    }
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    vendor: "gpt",
    name: "",
    model: "",
    roles: [],
    dir: process.cwd(),
    check: false,
    write: false,
    keep: []
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    switch (arg) {
      case "--vendor":
        if (value !== "gpt" && value !== "grok" && value !== "claude") {
          throw new Error("vendor: must be gpt, grok or claude")
        }
        options.vendor = value
        index += 1
        break
      case "--name":
        options.name = requireValue(value, "name")
        index += 1
        break
      case "--model":
        options.model = requireValue(value, "model")
        index += 1
        break
      case "--roles":
        options.roles = requireValue(value, "roles")
          .split(",")
          .map((role) => role.trim())
          .filter((role) => role !== "") as RoleId[]
        index += 1
        break
      case "--dir":
        options.dir = path.resolve(requireValue(value, "dir"))
        index += 1
        break
      case "--check":
        options.check = true
        break
      case "--write":
        options.write = true
        break
      case "--keep":
        options.keep.push(requireValue(value, "keep"))
        index += 1
        break
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
  }

  if (options.name === "") throw new Error("name: is required")
  if (options.model === "") throw new Error("model: is required")
  if (options.roles.length === 0) throw new Error("roles: is required")
  return options
}

function requireValue(value: string | undefined, field: string): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${field}: is required`)
  }
  return value
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.write) {
    respond(write(options))
  } else {
    respond(diff(options))
  }
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error"
  })
  process.exitCode = 1
}
```

`write` は Task 6 で実装する。このステップでは次の暫定実装を置き、Task 6 で差し替える。

```typescript
function write(options: Options): unknown {
  const file = targetPath(options)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, template(options))
  return {
    ok: true,
    target: path.relative(options.dir, file).split(path.sep).join("/"),
    action: "written"
  }
}
```

- [ ] **Step 4: `--check` のテストが通ることを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts -t "--check"`
Expected: PASS

- [ ] **Step 5: lint と typecheck を通す**

Run: `pnpm lint && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/src/setup-agents.ts plugins/agent-policy/src/__test__/setup-agents.test.ts
git commit -m "feat(agent-policy): setup の差分検出を実装する"
```

---

### Task 6: 保持マージと書き込みを実装する

**Files:**
- Modify: `plugins/agent-policy/src/setup-agents.ts`(`write` を差し替え)
- Modify: `plugins/agent-policy/src/__test__/setup-agents.test.ts`(テストを追加)
- Modify: `plugins/agent-policy/build.ts`(`setup-agents` の entryPoint を戻す)

**Interfaces:**
- Consumes: Task 5 の `Options` / `parseDocument` / `template` / `targetPath`
- Produces: `--write` の挙動。`--keep` セレクタは `tools:<name>` / `key:<name>` / `section:<heading>` / `preamble` の 4 形式

- [ ] **Step 1: 失敗するテストを追加する**

`plugins/agent-policy/src/__test__/setup-agents.test.ts` の末尾へ追加する。

```typescript
describe("--write", () => {
  it("既存が無いときテンプレートどおりに書く", () => {
    const result = run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write"
    ])
    expect(result.ok).toBe(true)
    expect(fs.existsSync(target())).toBe(true)
    expect(fs.readFileSync(target(), "utf8")).toContain("name: gpt-sol")
  })

  it("--keep なしでは完全上書きになる", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write"
    ])
    expect(fs.readFileSync(target(), "utf8")).not.toContain("## ツール運用")
  })

  it("--keep section で既存にしかない節を残す", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write", "--keep", "section:## ツール運用"
    ])
    const content = fs.readFileSync(target(), "utf8")
    expect(content).toContain("## ツール運用")
    expect(content).toContain("Context7 を使う")
  })

  it("--keep tools で既存にしかない tools を残す", () => {
    seed({ tools: "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7" })
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write", "--keep", "tools:mcp__context7"
    ])
    expect(fs.readFileSync(target(), "utf8")).toMatch(
      /^tools:.*mcp__context7/m
    )
  })

  it("--keep key で既存にしかないキーを残す", () => {
    seed({ extraKeys: { permissionMode: "plan" } })
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write", "--keep", "key:permissionMode"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain("permissionMode: plan")
  })

  it("--keep key で値の違う共通キーを残す", () => {
    seed({ model: "my-own-alias" })
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write", "--keep", "key:model"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain("model: my-own-alias")
  })

  it("--keep preamble で冒頭宣言を残す", () => {
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write", "--keep", "preamble"
    ])
    expect(fs.readFileSync(target(), "utf8")).toContain(
      "あなたは私が書き換えた冒頭である。"
    )
  })

  it("不正な --keep セレクタでエラーを返す", () => {
    const result = run([
      "--vendor", "gpt", "--name", "gpt-sol",
      "--model", "claude-gpt-5-6-sol", "--roles", "complex-impl",
      "--dir", project, "--write", "--keep", "bogus:value"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("keep")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts -t "--write"`
Expected: FAIL(`--keep` が効かず、暫定実装が完全上書きするため)

- [ ] **Step 3: `write` を実装し直す**

`setup-agents.ts` の暫定 `write` を次で置き換える。

```typescript
interface Keep {
  tools: Set<string>
  keys: Set<string>
  sections: Set<string>
  preamble: boolean
}

function parseKeep(selectors: string[]): Keep {
  const keep: Keep = {
    tools: new Set(),
    keys: new Set(),
    sections: new Set(),
    preamble: false
  }

  for (const selector of selectors) {
    if (selector === "preamble") {
      keep.preamble = true
      continue
    }
    const at = selector.indexOf(":")
    const kind = at === -1 ? selector : selector.slice(0, at)
    const value = at === -1 ? "" : selector.slice(at + 1)
    if (value === "") throw new Error(`keep: must be <kind>:<value>: ${selector}`)

    switch (kind) {
      case "tools":
        keep.tools.add(value)
        break
      case "key":
        keep.keys.add(value)
        break
      case "section":
        keep.sections.add(value)
        break
      default:
        throw new Error(`keep: unknown selector kind: ${selector}`)
    }
  }

  return keep
}

function render(document: Document): string {
  const head = ["---"]
  for (const key of document.order) {
    head.push(`${key}: ${document.meta.get(key) ?? ""}`)
  }
  head.push("---", "")

  const body: string[] = []
  if (document.preamble !== "") body.push(document.preamble, "")
  for (const [heading, content] of document.sections) {
    body.push(heading, "")
    if (content !== "") body.push(content, "")
  }

  return `${[...head, ...body].join("\n").trimEnd()}\n`
}

function merge(existingRaw: string, renderedRaw: string, keep: Keep): string {
  const existing = parseDocument(existingRaw)
  const merged = parseDocument(renderedRaw)

  // tools: テンプレートの並びを保ち、保持指定されたものを末尾へ足す。
  const tools = splitTools(merged.meta.get("tools"))
  for (const tool of splitTools(existing.meta.get("tools"))) {
    if (keep.tools.has(tool) && !tools.includes(tool)) tools.push(tool)
  }
  merged.meta.set("tools", tools.join(", "))

  // frontmatter キー: 保持指定されたものは既存の値を採る。
  for (const key of keep.keys) {
    const value = existing.meta.get(key)
    if (value === undefined) continue
    if (!merged.order.includes(key)) merged.order.push(key)
    merged.meta.set(key, value)
  }

  if (keep.preamble && existing.preamble !== "") {
    merged.preamble = existing.preamble
  }

  // 節: 保持指定されたものは既存の内容を採る。テンプレートに無い節は末尾へ。
  for (const heading of keep.sections) {
    const content = existing.sections.get(heading)
    if (content === undefined) continue
    merged.sections.set(heading, content)
  }

  return render(merged)
}

function write(options: Options): unknown {
  const file = targetPath(options)
  const rendered = template(options)
  const keep = parseKeep(options.keep)
  const exists = fs.existsSync(file)

  const content =
    exists && options.keep.length > 0
      ? merge(fs.readFileSync(file, "utf8"), rendered, keep)
      : rendered

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)

  return {
    ok: true,
    target: path.relative(options.dir, file).split(path.sep).join("/"),
    action: exists ? "overwritten" : "written",
    kept: options.keep
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts`
Expected: PASS(`--check` と `--write` の全ケース)

- [ ] **Step 5: `build.ts` へ `setup-agents` の entryPoint を追加する**

`entryPoints` を次にする。

```typescript
  entryPoints: {
    "session-start": "./src/hooks/session-start.ts",
    "setup-agents": "./src/setup-agents.ts"
  },
```

Run: `pnpm --filter agent-policy-scripts build`
Expected: `plugins/agent-policy/scripts/setup-agents.mjs` が生成される

- [ ] **Step 6: 生成された CLI を直接動かす**

```bash
tmp=$(mktemp -d) && \
node plugins/agent-policy/scripts/setup-agents.mjs \
  --vendor gpt --name my-agent --model my-alias \
  --roles complex-impl,explore --dir "$tmp" --check && \
rm -rf "$tmp"
```
Expected: `{"ok":true,...,"exists":false,...}` が 1 行出力される

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/setup-agents.ts plugins/agent-policy/src/__test__/setup-agents.test.ts plugins/agent-policy/build.ts plugins/agent-policy/scripts/setup-agents.mjs
git commit -m "feat(agent-policy): setup の保持マージと書き込みを実装する"
```

---

### Task 7: SessionStart フックを改修する

**Files:**
- Modify: `plugins/agent-policy/src/hooks/session-start.ts`
- Modify: `plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
- Modify: `plugins/agent-policy/scripts/session-start.mjs`(ビルド生成物)

**Interfaces:**
- Consumes: `ROLES` / `roleById`(Task 1)、`PRESETS` / `DEFAULT_ALIASES`(Task 4)
- Produces: `additionalContext` の 4 ブロック。ファイル書き込みは一切行わない

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/hooks/__test__/session-start.test.ts` を全面的に書き替える。

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function agentsDir(): string {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function place(name: string, frontmatter: string[]): void {
  fs.writeFileSync(
    path.join(agentsDir(), `${name}.md`),
    ["---", `name: ${name}`, ...frontmatter, "---", "", "本文", ""].join("\n")
  )
}

function context(env: Record<string, string> = {}): string {
  const output = runTs(HOOK, [], {
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CLAUDE_PROJECT_DIR: project,
      ...env
    }
  }).trim()
  if (output === "") return ""
  const parsed = JSON.parse(output.split("\n").at(-1) ?? "{}")
  return parsed.hookSpecificOutput?.additionalContext ?? ""
}

function listFiles(): string[] {
  const dir = path.join(project, ".claude", "agents")
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

describe("方針の注入", () => {
  it("値が未設定なら何も出さない", () => {
    expect(context()).toBe("")
  })

  it("既知の値で方針スキルを指す", () => {
    expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-codex" })).toContain(
      "agent-policy:with-codex-policy"
    )
    expect(
      context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-codex-grok" })
    ).toContain("agent-policy:codex-grok-policy")
  })

  it("未知の値では方針を指さず、未知である旨だけを出す", () => {
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "bogus" })
    expect(output).toContain("bogus")
    expect(output).not.toContain("スキルを使用し")
  })
})

describe("ファイルを書かない", () => {
  it("エイリアス差分があっても定義を生成しない", () => {
    expect(
      context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    ).not.toBe(undefined)
    expect(listFiles()).toEqual([])
  })

  it("役割マーカーを読んでもファイルを増やさない", () => {
    place("my-agent", ["agent-policy-role: complex-impl"])
    context()
    expect(listFiles()).toEqual(["my-agent.md"])
  })
})

describe("役割マーカーの走査", () => {
  it("帯 → 名前の対応を注入する", () => {
    place("my-heavy", ["agent-policy-role: complex-impl, explore"])
    const output = context()
    expect(output).toContain("my-heavy")
    expect(output).toContain("複雑または重要な実装")
    expect(output).toContain("コードベース探索実働")
  })

  it("同じ役割を複数定義が宣言したとき全て列挙する", () => {
    place("first", ["agent-policy-role: normal-impl"])
    place("second", ["agent-policy-role: normal-impl"])
    const output = context()
    expect(output).toContain("first")
    expect(output).toContain("second")
  })

  it("未知の役割 ID を無視し、その旨を出す", () => {
    place("odd", ["agent-policy-role: no-such-role"])
    const output = context()
    expect(output).toContain("no-such-role")
    expect(output).toContain("odd")
  })

  it("プロジェクト側断片の役割 ID を label で解決する", () => {
    const roles = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(roles, { recursive: true })
    fs.writeFileSync(
      path.join(roles, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の切り分け",
        "description: 障害の切り分け",
        "tools: Read, Grep, Glob, Bash",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **切り分け。** 障害の原因を切り分けるとき。",
        ""
      ].join("\n")
    )
    place("triager", ["agent-policy-role: triage"])
    const output = context()
    expect(output).toContain("障害の切り分け")
    expect(output).toContain("triager")
    expect(output).not.toContain("未知の役割 ID")
  })

  it("マーカーの無い定義は対応表に出さない", () => {
    place("plain", ["model: sonnet"])
    expect(context()).not.toContain("plain")
  })

  it("同梱プリセットを走査しない", () => {
    // プラグイン同梱の gpt-sol はマーカーを持つが、注入対象にしない。
    expect(context()).not.toContain("agent-policy:gpt-sol")
  })
})

describe("setup の促し", () => {
  it("エイリアス差分があり定義が無いとき促す", () => {
    const output = context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    expect(output).toContain("setup-gpt")
    expect(output).toContain("gpt-sol")
  })

  it("エイリアス差分があり model が食い違うとき促す", () => {
    place("gpt-sol", ["model: claude-gpt-5-6-sol"])
    const output = context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    expect(output).toContain("setup-gpt")
  })

  it("エイリアス差分があり model も一致するとき促さない", () => {
    place("gpt-sol", ["model: my-sol"])
    const output = context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    expect(output).not.toContain("setup-gpt")
  })

  it("エイリアスが既定と同じなら促さない", () => {
    const output = context({ AMATSUKA_AGENT_GROK_ALIAS: "claude-grok-4-6" })
    expect(output).not.toContain("setup-grok")
  })
})

describe("旧定義の残骸通知", () => {
  it("廃止した 4 種を検出する", () => {
    for (const name of [
      "claude-researcher",
      "gpt-researcher",
      "grok-researcher",
      "grok-implementer"
    ]) {
      place(name, ["model: sonnet"])
    }
    const output = context()
    expect(output).toContain("claude-researcher")
    expect(output).toContain("grok-implementer")
    expect(output).toContain("廃止")
  })

  it("現行のプリセット名は残骸として扱わない", () => {
    place("gpt-sol", ["model: claude-gpt-5-6-sol"])
    expect(context()).not.toContain("廃止")
  })
})

describe("フェイルオープン", () => {
  it("CLAUDE_PROJECT_DIR が無いとき走査せず方針だけ出す", () => {
    const output = runTs(HOOK, [], {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
        CLAUDE_PROJECT_DIR: "",
        AMATSUKA_AGENT_AUTO_INJECTION: "claude"
      }
    }).trim()
    expect(output).toContain("claude-model-policy")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
Expected: FAIL — 現行フックが定義を生成してしまい、「ファイルを書かない」と役割マーカー系が落ちる

- [ ] **Step 3: `session-start.ts` を書き替える**

```typescript
#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示と、役割マーカーの対応表を注入する。
// ファイルは書かない。定義の生成は setup-gpt / setup-grok が担う。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

import fs from "node:fs"
import path from "node:path"
import { DEFAULT_ALIASES } from "../agents/presets"
import { roleById } from "../agents/roles"

const POLICIES: Record<string, string> = {
  claude: "claude-model-policy",
  "with-codex": "with-codex-policy",
  "with-grok": "with-grok-policy",
  "with-codex-grok": "codex-grok-policy"
}

// 廃止した定義。プロジェクト側に残っていると同梱プリセットより優先されるため通知する。
const RETIRED = [
  "claude-researcher",
  "gpt-researcher",
  "grok-researcher",
  "grok-implementer"
]

interface AliasSpec {
  preset: string
  variable: string
  skill: string
}

const ALIASES: AliasSpec[] = [
  {
    preset: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    skill: "agent-policy:setup-gpt"
  },
  {
    preset: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    skill: "agent-policy:setup-gpt"
  },
  {
    preset: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    skill: "agent-policy:setup-gpt"
  },
  {
    preset: "grok",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    skill: "agent-policy:setup-grok"
  }
]

interface Marked {
  name: string
  model: string | undefined
  roles: string[]
}

function policyBlock(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "none") return undefined

  const policy = POLICIES[value]
  if (policy === undefined) {
    return `AMATSUKA_AGENT_AUTO_INJECTION の値 "${value}" は未知のため、agent-policy の方針注入をスキップした。`
  }
  return `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
}

function agentsDir(env: NodeJS.ProcessEnv): string | undefined {
  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return undefined
  const dir = path.join(projectDir, ".claude", "agents")
  return fs.existsSync(dir) ? dir : undefined
}

function frontmatter(file: string): Map<string, string> {
  const lines = fs.readFileSync(file, "utf8").split("\n")
  const meta = new Map<string, string>()
  if (lines[0]?.trim() !== "---") return meta
  const close = lines.indexOf("---", 1)
  if (close === -1) return meta

  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return meta
}

// 走査対象はプロジェクトの .claude/agents/ のみ。同梱プリセットは読まない。
function scan(dir: string | undefined): Marked[] {
  if (dir === undefined) return []
  const found: Marked[] = []

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue
    const meta = frontmatter(path.join(dir, file))
    const marker = meta.get("agent-policy-role")
    found.push({
      name: meta.get("name") ?? file.replace(/\.md$/, ""),
      model: meta.get("model"),
      roles:
        marker === undefined
          ? []
          : marker
              .split(",")
              .map((role) => role.trim())
              .filter((role) => role !== "")
    })
  }

  return found
}

// 役割 ID の表示名を解決する。プラグイン既知の ROLES に無いときは、
// プロジェクト側の役割断片(.claude/agent-policy/roles/<id>.md)の label を読む。
// setup はプロジェクト側断片の役割 ID もマーカーへ書き込むため、ここで拾えないと
// 「未知の役割」として誤って報告してしまう。
function labelOf(env: NodeJS.ProcessEnv, id: string): string | undefined {
  const known = roleById(id)
  if (known !== undefined) return known.label

  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return undefined

  const file = path.join(
    projectDir,
    ".claude",
    "agent-policy",
    "roles",
    `${id}.md`
  )
  if (!fs.existsSync(file)) return undefined
  const label = frontmatter(file).get("label")
  return label === "" ? undefined : label
}

function markerBlock(
  env: NodeJS.ProcessEnv,
  marked: Marked[]
): string | undefined {
  const byRole = new Map<string, string[]>()
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(env, role) === undefined) continue
      byRole.set(role, [...(byRole.get(role) ?? []), entry.name])
    }
  }
  if (byRole.size === 0) return undefined

  const lines = [
    "次の Agent は役割マーカーを宣言している。担当表の該当する帯は、これらを優先して使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。"
  ]
  for (const [role, names] of byRole) {
    lines.push(`- ${labelOf(env, role)}: ${names.join(" / ")}`)
  }
  return lines.join("\n")
}

function unknownRoleBlock(
  env: NodeJS.ProcessEnv,
  marked: Marked[]
): string | undefined {
  const lines: string[] = []
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(env, role) === undefined) {
        lines.push(`- ${entry.name}: ${role}`)
      }
    }
  }
  if (lines.length === 0) return undefined
  return [
    "次の Agent 定義は未知の役割 ID を宣言している。無視した。役割 ID の誤記であれば修正する:",
    ...lines
  ].join("\n")
}

function setupBlock(env: NodeJS.ProcessEnv, marked: Marked[]): string | undefined {
  const byName = new Map(marked.map((entry) => [entry.name, entry]))
  const lines: string[] = []

  for (const spec of ALIASES) {
    const alias = env[spec.variable]?.trim()
    if (alias === undefined || alias === "") continue
    if (alias === DEFAULT_ALIASES[spec.preset]) continue

    const existing = byName.get(spec.preset)
    if (existing === undefined) {
      lines.push(`- ${spec.preset}: 定義が無い。${spec.skill} を実行する`)
      continue
    }
    if (existing.model !== alias) {
      lines.push(
        `- ${spec.preset}: 定義の model が "${existing.model}" で、${spec.variable} の "${alias}" と食い違う。${spec.skill} を実行する`
      )
    }
  }

  if (lines.length === 0) return undefined
  return [
    "次の Agent は既定と異なるエイリアスが指定されているが、プロジェクト定義が追随していない。エイリアスに依存する委譲を行う前に対処する:",
    ...lines
  ].join("\n")
}

function retiredBlock(marked: Marked[]): string | undefined {
  const found = marked
    .map((entry) => entry.name)
    .filter((name) => RETIRED.includes(name))
  if (found.length === 0) return undefined
  return `次の Agent 定義は廃止済みである。プロジェクト定義は同梱定義より優先されるため削除する: ${found.join(", ")}`
}

function build(env: NodeJS.ProcessEnv): string | undefined {
  const marked = scan(agentsDir(env))

  const blocks = [
    policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION),
    markerBlock(env, marked),
    unknownRoleBlock(env, marked),
    setupBlock(env, marked),
    retiredBlock(marked)
  ].filter((block): block is string => block !== undefined)

  if (blocks.length === 0) return undefined
  return blocks.join("\n\n")
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
  process.stderr.write(
    `agent-policy session-start: ${error instanceof Error ? error.message : "Unexpected error"}\n`
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
Expected: PASS

- [ ] **Step 5: 全テストと lint / typecheck を通す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて成功

- [ ] **Step 6: ビルドして生成物を更新する**

Run: `pnpm --filter agent-policy-scripts build`
Expected: `scripts/session-start.mjs` が更新され、`agents/*.md` に差分が出ない(Task 4 で生成済みのため)

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/hooks/ plugins/agent-policy/scripts/session-start.mjs
git commit -m "feat(agent-policy): フックの責務を注入のみへ変更し、役割マーカー走査を追加する"
```

---

### Task 8: setup-gpt / setup-grok スキルを作成する

`prompt-smith:skill-creator` スキルを使う。

**Files:**
- Create: `plugins/agent-policy/skills/setup-gpt/SKILL.md`
- Create: `plugins/agent-policy/skills/setup-grok/SKILL.md`

**Interfaces:**
- Consumes: `scripts/setup-agents.mjs`(Task 5・6)、役割 ID(Task 1)
- Produces: スキル 2 本。`agent-policy:setup-gpt` / `agent-policy:setup-grok` として呼べる

- [ ] **Step 1: `setup-gpt/SKILL.md` を作る**

````markdown
---
name: setup-gpt
description: with-codex-policy / codex-grok-policy 運用方針で使う GPT エージェント定義を、役割を選んでプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「GPT エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したとき、または SessionStart フックがエイリアス不一致を通知したときに必ず使用する。既存定義がある場合は差分を提示し、テンプレートに存在し得ない情報を残すかどうかを確認する。Codex 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), AskUserQuestion
---

# GPT エージェント セットアップウィザード

生成するのは Markdown の Agent 定義ファイルのみであり、プロキシや秘密値は一切管理しない。

## 非対話モード

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従う。対話モードの手順は実施しない。

既定プリセット 3 種を既定エイリアスで生成する。次を順に 1 回ずつ実行する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor gpt --name gpt-sol --model claude-gpt-5-6-sol --roles complex-impl --write
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor gpt --name gpt-terra --model claude-gpt-5-6-terra --roles normal-impl,general,explore,realtime-research,independent-review --write
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor gpt --name gpt-luna --model claude-gpt-5-6-luna --roles light-impl --write
```

`ok: true` のときは `target` と `action` を報告して終了する。`ok: false` のときは `error` をそのまま報告して終了する。

## 対話モードの手順

`$ARGUMENTS` に `--yes` が含まれないときは、以下を順に実施する。

### ステップ 1: 前提確認

ユーザーに次を確認する。検証コマンドは実行させず、確認方法の提示に留める。

- Claude Code を、Codex 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
- そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。

前提が満たせない場合は「GPT Agent は起動できないため、`agent-policy:claude-model-policy` 方針の利用を検討してください」と案内し、ユーザーが続行を求めない限り次へ進まず終了する。

### ステップ 2: 役割の選択

`AskUserQuestion` の複数選択で、作る定義が担う役割を選ばせる。選択肢は次の順で提示する。

- `complex-impl` — 複雑または重要な実装
- `normal-impl` — 通常の実装
- `light-impl` — 軽量な実装
- `general` — その他のタスク
- `explore` — コードベース探索実働
- `realtime-research` — リアルタイム情報調査
- `independent-review` — 設計書・実装計画書の独立レビュー
- `doc-review` — 設計書・実装計画書のレビュー
- `code-review` — コードレビュー
- `advisor` — 設計・計画・実装のアドバイザー

プロジェクトに `.claude/agent-policy/roles/*.md` があるときは、その `id` と `label` も選択肢へ加える。

選択数の上限は設けない。1 回のウィザードで作るのは 1 定義である。複数の定義が要るときは、ユーザーに繰り返し実行するか尋ねる。

### ステップ 3: 読み取り専用性の確認

読み取り役割(`explore` / `realtime-research` / `independent-review` / `doc-review` / `code-review` / `advisor`)と実装役割(`complex-impl` / `normal-impl` / `light-impl` / `general`)の両方が選ばれたときは、次を伝えて続行するか確認する。既定は「続行しない」とする。

> 選んだ役割に読み取り専用の役割と実装役割が混在しています。生成される定義には Write / Edit が付くため、読み取り専用の担保は依頼文の制約に委ねられます。読み取り専用の定義が必要なら、読み取り役割だけを選んだ定義を別に作れます。

### ステップ 4: 名前のヒアリング

定義名を尋ねる。次を第一候補として提示し、自由に変更できるようにする。

- 選んだ役割が `complex-impl` だけなら `gpt-sol`
- `light-impl` だけなら `gpt-luna`
- `normal-impl` / `general` / `explore` / `realtime-research` / `independent-review` の組み合わせなら `gpt-terra`
- どれとも一致しないなら、役割から導いた名前(例: `gpt-review`)

### ステップ 5: モデルエイリアスのヒアリング

次の推奨を提示し、変更できるようにする。

- `complex-impl` を含む → `claude-gpt-5-6-sol`
- `light-impl` のみ → `claude-gpt-5-6-luna`
- それ以外 → `claude-gpt-5-6-terra`

「これはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。

### ステップ 6: 既存確認と差分提示

次で現状を取得する。`<roles>` は選んだ役割 ID のカンマ区切り。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor gpt --name <name> --model <alias> --roles <roles> --check
```

- `exists: false` なら確認を挟まずステップ 7 へ進む。
- `identical: true` なら「変更はありません」と報告して終了する。
- それ以外は差分を提示し、`AskUserQuestion` で方針を選ばせる。

差分の提示では次を区別して見せる。

**テンプレートに存在し得ない情報**(利用者が足したもの。既定では残す)
- `frontmatter.toolsOnlyInExisting` — 既存にしかない tools
- `frontmatter.keysOnlyInExisting` — 既存にしかない frontmatter キー
- `body.sectionsOnlyInExisting` — 既存にしかない節

**値が違うもの**(既定ではテンプレート側を採る。残したいなら個別に選ぶ)
- `frontmatter.changed` — 共通キーの値の違い
- `preambleChanged` — 冒頭宣言の書き換え
- `body.sectionsChanged` — 節の中身の違い

選択肢は次の 4 つとする。

1. **保持マージ(推奨)** — テンプレートに存在し得ない情報を残し、それ以外はテンプレート側で更新する
2. **項目を選んで保持** — 上に加えて、`changed` / `preambleChanged` / `sectionsChanged` のうち残すものを個別に選ぶ
3. **完全上書き** — 既存を捨ててテンプレートどおりに書く
4. **スキップ** — 書き込まない

差分の提示には次を必ず添える。

> 節の中身の一部改変は節単位でしか検出できません。既存の節へ 1 行足しただけの変更は、その節の保持を選ばない限り消えます。見出しに属さないテキストの追記と本文中の HTML コメントも検出できません。

### ステップ 7: 生成

選択を `--keep` へ変換して実行する。

- 既存にしかない tools → `--keep tools:<name>`
- 既存にしかないキー → `--keep key:<name>`
- 既存にしかない節・保持する節 → `--keep section:<heading>`
- 冒頭宣言 → `--keep preamble`
- 値の違う共通キーを残す → `--keep key:<name>`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor gpt --name <name> --model <alias> --roles <roles> --write [--keep ...]
```

「完全上書き」を選ばれたときは `--keep` を 1 つも渡さない。

### ステップ 8: 後処理案内

- 生成したファイルのパスを報告する。
- `.claude/agents/` を git 追跡対象にするか gitignore するかはプロジェクト判断であることを案内する。
- Claude Code は `.claude/agents/` の変更を読み直す。ディレクトリを新しく作った初回だけ再起動が要ることを添える。
- 読み取り専用の作業(独立レビュー・探索実働)を tools レベルで担保したい場合は、読み取り役割だけを選んだ定義を別に作れることを案内する。
- CLAUDE.md への追記文例を提示する。自動では書き込まない。
  > - 最初に必ず `agent-policy:with-codex-policy` スキルを使用し、この規律に従う。
- Grok も併用するなら `agent-policy:setup-grok` の実行を案内し、その場合の方針名は `agent-policy:codex-grok-policy` になることを添える。
````

- [ ] **Step 2: `setup-grok/SKILL.md` を作る**

`setup-gpt` と同じ構成で、次を差し替える。

- `name` は `setup-grok`
- **`description` は全文を Grok 向けに書き直す。** 方針名を `codex-grok-policy` / `with-grok-policy` へ、「GPT エージェント定義」を「Grok エージェント定義」へ、トリガー例を「Grok エージェントをセットアップして」「setup-grok を実行して」へ、前提を「Grok 系モデルをローカルプロキシ経由で使える環境が前提」へ変える。方針名だけを差し替えると、`setup-gpt` と発火条件が区別できない description になる
- **H1 見出しを `# Grok エージェント セットアップウィザード` にする**
- `--vendor grok`
- 非対話モードは 1 定義だけ:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor grok --name grok --model claude-grok-4-6 --roles normal-impl,light-impl,general,explore,realtime-research,independent-review --write
  ```
- ステップ 1 の前提確認は Grok 系モデルのプロキシ。満たせないときは「Grok 帯はフォールバック運用(独立レビュー省略・リアルタイム調査は Opus 代行)になります」と案内する
- ステップ 4 の名前の第一候補は `grok`
- ステップ 5 のエイリアスは `claude-grok-4-6` の 1 つだけを推奨として提示する。**`setup-gpt` にある一般注記(「これはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」)はそのまま残し、**次を続けて添える:
  > 既定エイリアスは Grok 4.6 に合わせた `claude-grok-4-6` です。プロキシ設定にこの別名がまだ無い場合は、プロキシ側へ追加するか、4.5 を使い続けるなら `claude-grok-4-5` を指定してください。
- ステップ 8 の CLAUDE.md 文例は、GPT 定義があれば `agent-policy:codex-grok-policy`、無ければ `agent-policy:with-grok-policy` を使う
- ステップ 8 の末尾に、GPT も併用するなら `agent-policy:setup-gpt` の実行を案内する行を置く(`setup-gpt` 側の `setup-grok` 案内と対称にする)

**この差し替えリストに無い箇所は `setup-gpt` と同じ内容を保つ。** 一般的な説明や注意書きを勝手に削らないこと。

- [ ] **Step 3: スキルが読み込まれることを確認する**

Run: `claude plugin validate plugins/agent-policy --strict`
Expected: エラーなし(author 未記載の警告は既存由来なので許容)

- [ ] **Step 4: 非対話モードを実際に動かす**

```bash
tmp=$(mktemp -d) && cd "$tmp" && \
node /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-change/plugins/agent-policy/scripts/setup-agents.mjs \
  --vendor grok --name grok --model claude-grok-4-6 \
  --roles normal-impl,light-impl,general,explore,realtime-research,independent-review --write && \
cat .claude/agents/grok.md | head -12 && cd - && rm -rf "$tmp"
```
Expected: frontmatter に `model: claude-grok-4-6`、`agent-policy-role` に 6 役割、`tools` に `Agent` と `WebSearch` が含まれ `mcp__` が無い

- [ ] **Step 5: コミット**

```bash
git add plugins/agent-policy/skills/setup-gpt/ plugins/agent-policy/skills/setup-grok/
git commit -m "feat(agent-policy): 役割選択式の setup-gpt / setup-grok を追加する"
```

---

### Task 9: 方針スキル 4 本と共通規律を改訂する

`prompt-smith:prompt-smith` スキルを使う。

**Files:**
- Modify: `plugins/agent-policy/skills/claude-model-policy/SKILL.md`
- Modify: `plugins/agent-policy/skills/with-codex-policy/SKILL.md`
- Modify: `plugins/agent-policy/skills/with-grok-policy/SKILL.md`
- Modify: `plugins/agent-policy/skills/codex-grok-policy/SKILL.md`
- Modify: `plugins/agent-policy/references/orchestration-discipline.md`

**Interfaces:**
- Consumes: `PRESET_ASSIGNMENTS`(Task 1)、役割マーカーの注入文言(Task 7)
- Produces: 4 方針の担当表・解決順・dispatch 節。Task 10 の README がこれを参照する

- [ ] **Step 1: 担当表の該当行を書き替える**

4 本すべてで、次の 3 行の担当を差し替える。

| 方針 | リアルタイム情報調査 | コードベース探索実働 | 独立レビュー |
| --- | --- | --- | --- |
| `claude-model-policy` | `Sonnet` | `Sonnet` | `Sonnet` |
| `with-codex-policy` | `GPT Terra` | `GPT Terra` | `GPT Terra` |
| `codex-grok-policy` | `Grok` | `Grok` | `Grok` |
| `with-grok-policy` | `Grok` | `Grok` | `Grok` |

`with-grok-policy` はさらに、「通常の実装」「軽量な実装」「その他のタスク」の `Grok Implementer` を `Grok` へ改名する。

`claude-model-policy` の `Claude Researcher`、`with-codex-policy` の `GPT Researcher`、`codex-grok-policy` / `with-grok-policy` の `Grok Researcher` という表記は、担当表から消える。

- [ ] **Step 2: 箇条書きの注記を直す**

- `claude-model-policy`: 「`Claude Researcher` と `Haiku` には Agent Tool を許可しない」→「`Haiku` には Agent Tool を許可しない」
- `with-codex-policy` / `codex-grok-policy`: 「`GPT Researcher` にも Agent Tool を許可しない」「`Grok Researcher` にも Agent Tool を許可しない」の行を削除する
- `with-grok-policy`: 「`Grok Researcher` と `Grok Implementer` の振り分けは…」の行を削除する。「`Grok Researcher` と `Haiku` には Agent Tool を許可しない」→「`Haiku` には Agent Tool を許可しない」
- 4 本すべての「`... Researcher` へ dispatch するときは、依頼文の冒頭で『独立レビュー』…を明示し」の行を、次へ置き換える。

  > - 独立レビュー・リアルタイム情報調査・探索実働を委譲するときは、依頼文の冒頭でどの役割かを明示し、その役割の Output Format を指定する。

- [ ] **Step 3: 「役割マーカー付き定義の優先」節を 4 本すべてへ追加する**

`## モデル別役割` の直後に置く。

```markdown
## 役割マーカー付き定義の優先

SessionStart フックが「担当表の該当する帯は次を優先して使う」と対応表を注入したときは、その帯の委譲先を担当表より優先してその定義とする。同じ帯に複数の定義が挙がったときは、依頼内容に近いものを選ぶ。

注入が無い帯は、担当表のとおりに委譲する。
```

- [ ] **Step 4: dispatch 節へ読み取り限定の指示を追加する**

`with-codex-policy` / `codex-grok-policy` / `with-grok-policy` の dispatch 節、および `claude-model-policy` の担当表直後の箇条書きへ追加する。

```markdown
- 独立レビュー・探索実働・リアルタイム情報調査を、実装エージェント(`Write` / `Edit` を持つ帯)へ委譲するときは、依頼文に次を明記する。
  - 使用してよい tools を読み取り系に限定すること(`Read` / `Grep` / `Glob`、読み取りに限った `Bash`、必要なら `WebSearch` / `WebFetch`)
  - ファイルを変更しないこと、報告のみを返すこと
```

- [ ] **Step 5: 実行帯の解決順を書き替える**

4 本すべての `## 実行帯の解決順` を次の形にする。ベンダー名とプリセット名は方針ごとに読み替える。

```markdown
## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. SessionStart フックが役割マーカーで注入した定義があれば、その帯はそれを使う。
2. プロジェクトの `.claude/agents/gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` が存在すればそれを使う。既定と異なるエイリアスを使うときは `agent-policy:setup-gpt` で生成する。
3. 存在しなければ、プラグイン同梱の `agent-policy:gpt-sol` / `agent-policy:gpt-terra` / `agent-policy:gpt-luna` を使う。
4. ローカルプロキシ経由で呼び出せないときは、`codex@openai-codex` プラグイン(`/codex:rescue --model gpt-5.6-sol` / `--model gpt-5.6-terra` / `--model gpt-5.6-luna`)を使う。それも不可なら `agent-policy:claude-model-policy` の担当表へ読み替える。
```

「環境変数で既定と異なるエイリアスを指定したときは、SessionStart フックがここへ定義を生成する」という記述は 4 本すべてから削除する。フックは生成しない。

`claude-model-policy` の解決順は、`claude-researcher` への参照を削除し、次だけにする。

```markdown
## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. SessionStart フックが役割マーカーで注入した定義があれば、その帯はそれを使う。
2. 注入が無い帯は、担当表のモデルを dispatch 時の `model` 上書きで指定して起動する。
```

- [ ] **Step 6: フォールバック節を直す**

`with-grok-policy` の「Grok が利用不可のときのフォールバック」の `Grok Implementer` を `Grok` へ改名する。`codex-grok-policy` の同節は「探索実働: `GPT Terra` / `GPT Luna` へ読み替える」を維持する。

- [ ] **Step 7: `orchestration-discipline.md` へ役割マーカーの規律を追加する**

`## モデル別役割の運用` の末尾へ追加する。

```markdown
- SessionStart フックが役割マーカーの対応表を注入したときは、その帯の委譲先を担当表より優先してその定義とする。同じ帯に複数あるときは依頼内容に近いものを選ぶ。
```

- [ ] **Step 8: 廃止した定義名の残存を検査する**

Run:
```bash
grep -rn "Claude Researcher\|GPT Researcher\|Grok Researcher\|Grok Implementer\|claude-researcher\|gpt-researcher\|grok-researcher\|grok-implementer" plugins/agent-policy/skills/ plugins/agent-policy/references/
```
Expected: 出力なし

- [ ] **Step 9: コミット**

```bash
git add plugins/agent-policy/skills/ plugins/agent-policy/references/
git commit -m "refactor(agent-policy): 方針スキルの担当表と解決順を役割ベースへ改訂する"
```

---

### Task 10: ドキュメントとバージョンを更新し、通しで検証する

**Files:**
- Modify: `plugins/agent-policy/README.md`
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json`
- Modify: `plugins/agent-policy/package.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: ルート `README.md`

**Interfaces:**
- Consumes: これまでの全タスクの成果
- Produces: 利用者向けの導入・移行手順

- [ ] **Step 1: `plugins/agent-policy/README.md` を改訂する**

次を反映する。

- 冒頭の「7 種のサブエージェント定義を同梱」→「4 種のプリセット定義を同梱」
- 「環境変数」表の `AMATSUKA_AGENT_GROK_ALIAS` の既定値を `claude-grok-4-6` へ。用途の説明を「`grok` のモデルエイリアス」へ
- `AMATSUKA_AGENT_GPT_TERRA_ALIAS` の用途を「`gpt-terra` のモデルエイリアス」へ(`gpt-researcher` の記述を削除)
- 「同梱エージェント」表を 4 行(`gpt-sol` / `gpt-terra` / `gpt-luna` / `grok`)へ差し替え、役割の列に役割 ID を書く
- 「エイリアスを変更する」節を全面的に書き替える。フックは生成しないこと、`agent-policy:setup-gpt` / `agent-policy:setup-grok` で生成すること、フックは不一致を検知して促すだけであることを書く
- 「役割を選んで自分の定義を作る」節を新設する。setup の役割選択、役割マーカー、`.claude/agent-policy/roles/` によるプロジェクト側断片を説明する
- 「旧バージョンからの移行」節を書き替える。
  - `claude-researcher` / `gpt-researcher` / `grok-researcher` / `grok-implementer` は廃止したので、`.claude/agents/` に残っていれば削除する
  - **Grok の既定エイリアスが `claude-grok-4-6` へ変わった。** プロキシ設定に `claude-grok-4-6` の別名を追加するか、4.5 を使い続けるなら `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を設定する。どちらもしないと、委譲時に `unknown provider for model` で失敗する
  - MCP ツールは同梱定義から外れた。必要なら setup で生成した定義へ自分で足す。再 setup 時は差分確認で保持できる

- [ ] **Step 2: バージョンを上げる**

`plugins/agent-policy/.claude-plugin/plugin.json` の `version` を `0.8.0-dev` にする。`description` の「Claude+Codex+Grok 併用 / Claude+Codex 併用 / Claude+Grok 併用 / Claude オンリーの 4 プロファイルで提供する」は維持する。

`plugins/agent-policy/package.json` の `version` も `0.8.0-dev` に揃える。

- [ ] **Step 3: marketplace.json とルート README を更新する**

`.claude-plugin/marketplace.json` の agent-policy の description を、役割ベース setup に触れる形へ更新する。ルート `README.md` の agent-policy の記述も同様に更新する。

- [ ] **Step 4: 全体を検証する**

Run:
```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```
Expected: すべて成功。`pnpm build` 後に `git status` で `agents/*.md` と `scripts/*.mjs` に未コミットの差分が無いこと

- [ ] **Step 5: プラグイン定義を検証する**

Run: `claude plugin validate plugins/agent-policy --strict`
Expected: エラーなし

- [ ] **Step 6: MCP の残存を全体検査する**

Run:
```bash
grep -rn "mcp__" plugins/agent-policy/agents/ plugins/agent-policy/assets/roles/
grep -rn "## ツール運用" plugins/agent-policy/agents/ plugins/agent-policy/assets/roles/
```
Expected: どちらも出力なし

- [ ] **Step 7: 旧エイリアスの残存を検査する**

Run:
```bash
grep -rn "claude-grok-4-5" plugins/agent-policy/ .claude-plugin/ README.md
```
Expected: 次の 2 箇所だけが出る。どちらも意図した記述であり、削除しない。

- `plugins/agent-policy/README.md` の移行手順にある「4.5 を使い続けるなら」
- `plugins/agent-policy/skills/setup-grok/SKILL.md` のステップ 5 にある同趣旨の案内(setup を実行した利用者へその場で伝える必要がある)

- [ ] **Step 8: コミット**

```bash
git add plugins/agent-policy/README.md plugins/agent-policy/.claude-plugin/plugin.json plugins/agent-policy/package.json .claude-plugin/marketplace.json README.md
git commit -m "docs(agent-policy): 役割ベース setup と Grok 4.6 エイリアスを README へ反映し 0.8.0-dev へ上げる"
```

---

## 完了条件

- `pnpm build`・`pnpm lint`・`pnpm typecheck`・`pnpm test` がすべて通る。
- `plugins/agent-policy/agents/` に `gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` / `grok.md` の 4 件だけがあり、いずれも `mcp__` と「ツール運用」節を含まない。
- 役割断片に他エージェント定義の固有名が含まれない。
- 各方針の担当表が割り当てた役割を、担当プリセットが漏れなく持つ(`presets.test.ts` が検査)。
- SessionStart フックがファイルを 1 つも書かない(`session-start.test.ts` が検査)。
- `setup-gpt` / `setup-grok` が役割を選ばせ、既存定義があるときは差分を提示して保持マージできる。
- Grok の既定エイリアスが `claude-grok-4-6` であり、README に移行手順がある。
