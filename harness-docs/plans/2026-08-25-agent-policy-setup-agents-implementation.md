# agent-policy setup 統合 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `setup-gpt` / `setup-grok` を単一の `setup-agents` スキルへ統合し、ポリシー・モデル・役割を選んで複数のエージェント定義を一度に生成できるようにする。担当表を実装層の正本に置き、担当表上あり得ない組み合わせを CLI が拒否する。あわせて表示と生成本文の多言語対応、MCP ツールの選択的付与、`LSP` の除去を行う。

**Architecture:** 4 つの運用方針の担当表を `src/agents/policies.ts` へ機械可読な形で置き、そこから同梱プリセット・CLI の検証・ウィザードの選択肢をすべて導出する。役割断片は言語別ディレクトリへ分け、`compose.ts` は言語別語彙を持つ。MCP はサーバー単位で許可(allowlist)し、読み取り役割にはツール単位で禁止(denylist)する。MCP の選択は専用ファイルへ保存せず、既存定義から逆算して既定値にする。エージェント定義を書く主体は CLI に限り、スキルは翻訳断片だけを `Edit` で触る。

**Tech Stack:** TypeScript(esbuild で ESM へバンドル)、vitest、Claude Code のプラグイン機構(skills / agents / hooks)

**Spec:** `harness-docs/design/2026-08-25-agent-policy-setup-agents-design.md`

## Global Constraints

- Node は `>=26`、パッケージマネージャは pnpm `11.8.0`。
- スクリプトのソースは `plugins/agent-policy/src/`、バンドル出力は `plugins/agent-policy/scripts/`。バンドル出力は git 管理下に置く。
- `plugins/agent-policy/src/` を変更したら `pnpm run build` を実行し、生成物の差分も同じコミットに含める。同梱プリセット `plugins/agent-policy/agents/*.md` もビルド生成物である。
- コミット前に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` を通す。
- テストは対象ソースと同じディレクトリの `__test__/` に置き、ファイル名は `<対象ファイル名>.test.ts` とする。vitest が拾うのは `plugins/**/__test__/**/*.test.ts` だけである。
- 子プロセスとして起動するエントリポイントと故障注入は `src/testing/` に置く。lint と型検査の対象外にするものは拡張子を `.mjs` にする。
- TypeScript / JavaScript / Markdown のファイルを作成・編集するときは Serena のツールを使う。
- AI 向けの指示書(SKILL.md・references・役割断片)を編集するときは `prompt-smith:prompt-smith` スキルを使う。スキルの新規作成は `prompt-smith:skill-creator` を使う。
- ブランチは切らない。現在のブランチ `main` で作業する。
- 既定のモデルエイリアスは次の値をリテラルで使う。`gpt-sol` = `claude-gpt-5-6-sol`、`gpt-terra` = `claude-gpt-5-6-terra`、`gpt-luna` = `claude-gpt-5-6-luna`、`grok` = `claude-grok-4-6`。Claude 帯は `opus` / `sonnet` / `haiku` / `fable` のエイリアスをそのまま使う。
- `color` は公式が受け付ける 8 種のみを使う。`red` / `blue` / `green` / `yellow` / `purple` / `orange` / `pink` / `cyan`。`magenta` は無い。
- 環境変数名は `AMATSUKA_AGENT_GPT_SOL_ALIAS` / `AMATSUKA_AGENT_GPT_TERRA_ALIAS` / `AMATSUKA_AGENT_GPT_LUNA_ALIAS` / `AMATSUKA_AGENT_GROK_ALIAS` / `AMATSUKA_AGENT_AUTO_INJECTION`。Claude 帯に対応する環境変数は作らない。
- 役割 ID は 10 種(`complex-impl` / `normal-impl` / `light-impl` / `general` / `explore` / `realtime-research` / `independent-review` / `doc-review` / `code-review` / `advisor`)。増減させない。
- ファイル削除がクラシファイアに拒否された場合、絶対パスを提示してユーザーの手で実行してもらう。自分で回避策を試みない。

### 既存テストの契約(守るべき前提)

新規テストを書くときは、既存ファイルのヘルパーと変数名に合わせる。別名で書くと重複定義になる。

| ファイル | ヘルパー | 一時ディレクトリ変数 | 備考 |
| --- | --- | --- | --- |
| `src/__test__/setup-agents.test.ts` | `run<T>(args: string[]): T` | `project` | **同期**。`await` を付けない。`runTs` 経由で CLI を子プロセス実行し、非ゼロ終了時は stdout を拾う |
| `src/__test__/setup-agents.test.ts` | `check(extra: string[]): CheckResult` | 同上 | 現在 `--vendor gpt --name gpt-sol --model ... --roles complex-impl` を固定で渡す。Task 9 で書き換える |
| `src/hooks/__test__/session-start.test.ts` | `context(env: Record<string, string>): string` | `project` | `build` ではない。`session-start.ts` の `build` は未 export |
| `src/hooks/__test__/session-start.test.ts` | `place(name, frontmatter[])` | 同上 | `.claude/agents/<name>.md` を置く |
| `src/agents/__test__/compose.test.ts` | `PLUGIN_ROLES` | — | 現在は `assets/roles` を指す文字列。Task 4 で `FragmentDir` へ変わる |

## ファイル構成

新規:

| パス | 責務 |
| --- | --- |
| `plugins/agent-policy/src/agents/policies.ts` | 4 方針の担当表、`ModelSpec` 一覧、導出関数、注入値からの写像 |
| `plugins/agent-policy/src/agents/vocabulary.ts` | `compose.ts` が使う言語別の語彙 |
| `plugins/agent-policy/src/agents/mcp.ts` | `claude mcp list` のパース、`usable` 判定、プレフィックス変換、既存定義からの逆算 |
| `plugins/agent-policy/src/agents/hash.ts` | 断片の本文ハッシュ計算(frontmatter を除外) |
| `plugins/agent-policy/src/testing/fake-claude.mjs` | `claude mcp list` の代わりに固定出力を返す故障注入用スクリプト |
| `plugins/agent-policy/assets/roles/ja/` | 日本語の役割断片。既存 12 ファイルの移動先 |
| `plugins/agent-policy/assets/roles/en/` | 英語の役割断片。12 ファイルを書き下ろす |
| `plugins/agent-policy/skills/setup-agents/SKILL.md` | 統合ウィザード |
| `plugins/agent-policy/src/agents/__test__/policies.test.ts` | 担当表の網羅性と導出関数 |
| `plugins/agent-policy/src/agents/__test__/vocabulary.test.ts` | 言語別語彙 |
| `plugins/agent-policy/src/agents/__test__/mcp.test.ts` | MCP のパースと逆算 |
| `plugins/agent-policy/src/agents/__test__/fragments.test.ts` | 3 段探索と `source-hash` |

変更:

| パス | 変更内容 |
| --- | --- |
| `plugins/agent-policy/src/agents/roles.ts` | `LSP` 除去、`PRESET_ASSIGNMENTS` と `PolicyName` の削除 |
| `plugins/agent-policy/src/agents/presets.ts` | `PRESETS` を担当表からの導出へ |
| `plugins/agent-policy/src/agents/fragments.ts` | `FragmentDir` 化、3 段探索、ベンダー別断片の置換、`source-hash` 検証、scaffold |
| `plugins/agent-policy/src/agents/compose.ts` | 言語別語彙、MCP の `tools` 追加、`disallowedTools` の出力 |
| `plugins/agent-policy/src/agents/build-presets.ts` | 断片ディレクトリのパス追随 |
| `plugins/agent-policy/src/setup-agents.ts` | `--vendor` 廃止、新サブコマンド群、検証、MCP 付与 |
| `plugins/agent-policy/src/hooks/session-start.ts` | `ALIASES.skill` の変更、`labelOf` の言語別ディレクトリ対応 |
| `plugins/agent-policy/skills/*-policy/SKILL.md` | 実行帯の解決順を役割ベースへ統一(4 本) |
| `plugins/agent-policy/README.md` | setup-agents 前提へ改稿、移行節に 5 項目追加 |
| `docs/development/cliproxyapi-setup.md` | `setup-gpt` / `setup-grok` を `setup-agents` へ |
| ルート `README.md` | agent-policy の記述を追随 |

削除:

| パス | 理由 |
| --- | --- |
| `plugins/agent-policy/skills/setup-gpt/` | `setup-agents` へ統合 |
| `plugins/agent-policy/skills/setup-grok/` | 同上 |

---

### Task 1: 担当表の正本 `policies.ts`

**Files:**
- Create: `plugins/agent-policy/src/agents/policies.ts`
- Test: `plugins/agent-policy/src/agents/__test__/policies.test.ts`

**Interfaces:**
- Consumes: `RoleId` / `ROLES` / `sortRoleIds`(`./roles`)、`Vendor`(`./fragments`)
- Produces: `ModelId`、`Lang`、`ModelSpec`、`PolicyName`、`Policy`、`POLICIES`、`MODELS`、`ASSIGNMENTS`、`modelById`、`policyById`、`policyForInjection`、`modelsFor`、`rolesFor`、`rolesAcrossPolicies`、`resolveModelValue`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/policies.test.ts` を作成する。

```ts
import { describe, expect, it } from "vitest"
import {
  ASSIGNMENTS,
  MODELS,
  modelById,
  modelsFor,
  POLICIES,
  policyForInjection,
  resolveModelValue,
  rolesAcrossPolicies,
  rolesFor
} from "../policies"
import { ROLES } from "../roles"

describe("ASSIGNMENTS", () => {
  it("4 方針それぞれが役割 10 種すべてに担当モデルを持つ", () => {
    for (const policy of POLICIES) {
      for (const role of ROLES) {
        const models = ASSIGNMENTS[policy.id][role.id]
        expect(models, `${policy.id}/${role.id}`).toBeDefined()
        expect(models.length, `${policy.id}/${role.id}`).toBeGreaterThan(0)
      }
    }
  })

  it("担当モデルはすべて MODELS に存在する", () => {
    const known = new Set(MODELS.map((model) => model.id))
    for (const assignments of Object.values(ASSIGNMENTS)) {
      for (const models of Object.values(assignments)) {
        for (const id of models) expect(known).toContain(id)
      }
    }
  })

  it("advisor は 4 方針すべてで fable と opus の 2 モデルを持つ", () => {
    for (const policy of POLICIES) {
      expect(ASSIGNMENTS[policy.id].advisor).toEqual(["fable", "opus"])
    }
  })

  it("advisor 以外はすべて単一モデルである", () => {
    for (const assignments of Object.values(ASSIGNMENTS)) {
      for (const [role, models] of Object.entries(assignments)) {
        if (role === "advisor") continue
        expect(models.length, role).toBe(1)
      }
    }
  })
})

describe("MODELS", () => {
  it("color が公式の 8 色から選ばれている", () => {
    const allowed = [
      "red",
      "blue",
      "green",
      "yellow",
      "purple",
      "orange",
      "pink",
      "cyan"
    ]
    for (const model of MODELS) {
      expect(allowed, model.id).toContain(model.color)
    }
  })

  it("color が重複しない", () => {
    const colors = MODELS.map((model) => model.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it("Claude 帯は aliasEnv を持たない", () => {
    for (const model of MODELS.filter((m) => m.vendor === "claude")) {
      expect(model.aliasEnv, model.id).toBeUndefined()
    }
  })
})

describe("modelsFor", () => {
  it("claude-model-policy は Claude 4 種のみを返す", () => {
    expect(modelsFor("claude-model-policy").map((m) => m.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable"
    ])
  })

  it("codex-grok-policy は 8 種すべてを返す", () => {
    expect(modelsFor("codex-grok-policy").map((m) => m.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable",
      "gpt-sol",
      "gpt-terra",
      "gpt-luna",
      "grok"
    ])
  })
})

describe("rolesFor", () => {
  it("claude-model-policy の sonnet は 6 役割を担う", () => {
    expect(rolesFor("claude-model-policy", "sonnet")).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review",
      "code-review"
    ])
  })

  it("codex-grok-policy の gpt-terra は normal-impl と general だけを担う", () => {
    expect(rolesFor("codex-grok-policy", "gpt-terra")).toEqual([
      "normal-impl",
      "general"
    ])
  })

  it("fable は advisor だけを担う", () => {
    expect(rolesFor("with-codex-policy", "fable")).toEqual(["advisor"])
  })

  it("そのポリシーに登場しないモデルには空配列を返す", () => {
    expect(rolesFor("claude-model-policy", "grok")).toEqual([])
  })
})

describe("rolesAcrossPolicies", () => {
  it("gpt-terra は 5 役割の和集合になる", () => {
    expect(rolesAcrossPolicies("gpt-terra")).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ])
  })

  it("grok は 6 役割の和集合になる", () => {
    expect(rolesAcrossPolicies("grok")).toEqual([
      "normal-impl",
      "light-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ])
  })
})

describe("policyForInjection", () => {
  it("AMATSUKA_AGENT_AUTO_INJECTION の値をポリシー ID へ写す", () => {
    expect(policyForInjection("claude")).toBe("claude-model-policy")
    expect(policyForInjection("with-codex")).toBe("with-codex-policy")
    expect(policyForInjection("with-grok")).toBe("with-grok-policy")
    expect(policyForInjection("with-codex-grok")).toBe("codex-grok-policy")
  })

  it("none と未知の値と未設定には undefined を返す", () => {
    expect(policyForInjection("none")).toBeUndefined()
    expect(policyForInjection("nope")).toBeUndefined()
    expect(policyForInjection(undefined)).toBeUndefined()
  })
})

describe("resolveModelValue", () => {
  it("環境変数があればそれを使う", () => {
    const spec = modelById("gpt-sol")
    expect(spec).toBeDefined()
    expect(
      resolveModelValue(spec as never, { AMATSUKA_AGENT_GPT_SOL_ALIAS: "mine" })
    ).toBe("mine")
  })

  it("環境変数が無ければ既定値を使う", () => {
    expect(resolveModelValue(modelById("gpt-sol") as never, {})).toBe(
      "claude-gpt-5-6-sol"
    )
  })

  it("Claude 帯は既定値を返す", () => {
    expect(resolveModelValue(modelById("sonnet") as never, {})).toBe("sonnet")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/policies.test.ts
```

期待: `Failed to resolve import "../policies"` で失敗する。

- [ ] **Step 3: `policies.ts` を実装する**

```ts
import type { Vendor } from "./fragments"
import { type RoleId, sortRoleIds } from "./roles"

export type ModelId =
  | "opus"
  | "sonnet"
  | "haiku"
  | "fable"
  | "gpt-sol"
  | "gpt-terra"
  | "gpt-luna"
  | "grok"

// ja / en は同梱断片を持つ。それ以外は翻訳断片を要する任意のコード。
export type Lang = string

export type PolicyName =
  | "claude-model-policy"
  | "with-codex-policy"
  | "with-grok-policy"
  | "codex-grok-policy"

export interface Policy {
  id: PolicyName
  label: string
  // AMATSUKA_AGENT_AUTO_INJECTION が取る値。フックと README の表と同じ。
  injection: string
}

export interface ModelSpec {
  id: ModelId
  vendor: Vendor
  label: string
  defaultName: string
  model: string
  aliasEnv?: string
  color: string
}

export const POLICIES: readonly Policy[] = [
  { id: "claude-model-policy", label: "Claude のみ", injection: "claude" },
  {
    id: "with-codex-policy",
    label: "Claude + Codex 併用",
    injection: "with-codex"
  },
  {
    id: "with-grok-policy",
    label: "Claude + Grok 併用",
    injection: "with-grok"
  },
  {
    id: "codex-grok-policy",
    label: "Claude + Codex + Grok 併用",
    injection: "with-codex-grok"
  }
]

// color は公式が受け付ける 8 色。ちょうど 8 モデルなので重複させない。
export const MODELS: readonly ModelSpec[] = [
  {
    id: "opus",
    vendor: "claude",
    label: "Opus",
    defaultName: "claude-opus",
    model: "opus",
    color: "blue"
  },
  {
    id: "sonnet",
    vendor: "claude",
    label: "Sonnet",
    defaultName: "claude-sonnet",
    model: "sonnet",
    color: "purple"
  },
  {
    id: "haiku",
    vendor: "claude",
    label: "Haiku",
    defaultName: "claude-haiku",
    model: "haiku",
    color: "pink"
  },
  {
    id: "fable",
    vendor: "claude",
    label: "Fable",
    defaultName: "claude-fable",
    model: "fable",
    color: "orange"
  },
  {
    id: "gpt-sol",
    vendor: "gpt",
    label: "GPT Sol",
    defaultName: "gpt-sol",
    model: "claude-gpt-5-6-sol",
    aliasEnv: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    color: "yellow"
  },
  {
    id: "gpt-terra",
    vendor: "gpt",
    label: "GPT Terra",
    defaultName: "gpt-terra",
    model: "claude-gpt-5-6-terra",
    aliasEnv: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    color: "green"
  },
  {
    id: "gpt-luna",
    vendor: "gpt",
    label: "GPT Luna",
    defaultName: "gpt-luna",
    model: "claude-gpt-5-6-luna",
    aliasEnv: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    color: "cyan"
  },
  {
    id: "grok",
    vendor: "grok",
    label: "Grok",
    defaultName: "grok",
    model: "claude-grok-4-6",
    aliasEnv: "AMATSUKA_AGENT_GROK_ALIAS",
    color: "red"
  }
]

// 方針スキルの担当表(モデル別役割)をそのまま写したもの。
// advisor だけが 2 モデルを持つ。担当表が変わったらここも変える。
export const ASSIGNMENTS: Record<PolicyName, Record<RoleId, ModelId[]>> = {
  "claude-model-policy": {
    "complex-impl": ["opus"],
    "normal-impl": ["sonnet"],
    "light-impl": ["haiku"],
    general: ["sonnet"],
    explore: ["sonnet"],
    "realtime-research": ["sonnet"],
    "independent-review": ["sonnet"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "with-codex-policy": {
    "complex-impl": ["gpt-sol"],
    "normal-impl": ["gpt-terra"],
    "light-impl": ["gpt-luna"],
    general: ["gpt-terra"],
    explore: ["gpt-terra"],
    "realtime-research": ["gpt-terra"],
    "independent-review": ["gpt-terra"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "with-grok-policy": {
    "complex-impl": ["opus"],
    "normal-impl": ["grok"],
    "light-impl": ["grok"],
    general: ["grok"],
    explore: ["grok"],
    "realtime-research": ["grok"],
    "independent-review": ["grok"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "codex-grok-policy": {
    "complex-impl": ["gpt-sol"],
    "normal-impl": ["gpt-terra"],
    "light-impl": ["gpt-luna"],
    general: ["gpt-terra"],
    explore: ["grok"],
    "realtime-research": ["grok"],
    "independent-review": ["grok"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  }
}

export function modelById(id: string): ModelSpec | undefined {
  return MODELS.find((model) => model.id === id)
}

export function policyById(id: string): Policy | undefined {
  return POLICIES.find((policy) => policy.id === id)
}

// AMATSUKA_AGENT_AUTO_INJECTION の値はポリシー ID と別体系である。
// 対話の第一候補を決めるときと、非対話モードでポリシーを解決するときに使う。
export function policyForInjection(
  value: string | undefined
): PolicyName | undefined {
  if (value === undefined) return undefined
  return POLICIES.find((policy) => policy.injection === value.trim())?.id
}

// 並びは MODELS の定義順。担当表に一度でも現れるモデルだけを返す。
export function modelsFor(policy: PolicyName): ModelSpec[] {
  const used = new Set<ModelId>()
  for (const models of Object.values(ASSIGNMENTS[policy])) {
    for (const id of models) used.add(id)
  }
  return MODELS.filter((model) => used.has(model.id))
}

// 並びは ROLES の定義順。ウィザードの選択肢と CLI の検証の双方で使う。
export function rolesFor(policy: PolicyName, model: ModelId): RoleId[] {
  const assignments = ASSIGNMENTS[policy]
  const roles = (Object.keys(assignments) as RoleId[]).filter((role) =>
    assignments[role].includes(model)
  )
  return sortRoleIds(roles)
}

// 全方針でそのモデルが担う役割の和集合。同梱プリセットの役割集合に使う。
export function rolesAcrossPolicies(model: ModelId): RoleId[] {
  const roles = new Set<RoleId>()
  for (const policy of POLICIES) {
    for (const role of rolesFor(policy.id, model)) roles.add(role)
  }
  return sortRoleIds([...roles])
}

export function resolveModelValue(
  spec: ModelSpec,
  env: NodeJS.ProcessEnv
): string {
  if (spec.aliasEnv === undefined) return spec.model
  const value = env[spec.aliasEnv]?.trim()
  return value === undefined || value === "" ? spec.model : value
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/policies.test.ts && pnpm run lint && pnpm run typecheck
```

- [ ] **Step 5: コミット**

```bash
git add plugins/agent-policy/src/agents/policies.ts plugins/agent-policy/src/agents/__test__/policies.test.ts
git commit -m "feat(agent-policy): 4 方針の担当表を実装層の正本として追加する"
```

---

### Task 2: `LSP` の除去

**Files:**
- Modify: `plugins/agent-policy/src/agents/roles.ts`
- Modify: `plugins/agent-policy/assets/roles/complex-impl.md` ほか 3 件
- Test: `plugins/agent-policy/src/agents/__test__/roles.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `ROLES` の `tools` から `LSP` が消える

- [ ] **Step 1: 失敗するテストを書く**

`roles.test.ts` の `describe("ROLES")` の中へ**新規に**追加する。既存の `resolveTools` テストには `LSP` を含む完全配列のアサーションが無いため、置き換える対象は無い。

```ts
  it("どの役割も LSP を持たない(背景サブエージェントで除去されるため)", () => {
    for (const role of ROLES) {
      expect(role.tools, role.id).not.toContain("LSP")
    }
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/roles.test.ts
```

期待: 追加した 1 件が FAIL する。

- [ ] **Step 3: `roles.ts` から `LSP` を除去する**

`ROLES` の 4 役割の `tools` 配列から `"LSP"` を削除する。削除後は次のようになる。

```ts
  {
    id: "complex-impl",
    label: "複雑または重要な実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
```

`light-impl` は `Skill` を持たないため `["Read", "Grep", "Glob", "Write", "Edit", "Bash"]` となる。`normal-impl` と `general` は `complex-impl` と同じ 7 件になる。

- [ ] **Step 4: 役割断片の frontmatter からも `LSP` を除去する**

Serena の `replace_in_files` を dry_run で実行し、4 件が対象になることを確認してから適用する。

```
mode: regex
needle: ^(tools: .*), LSP$
repl: $!1
paths_include_glob: plugins/agent-policy/assets/roles/*.md
```

- [ ] **Step 5: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/ && pnpm run typecheck
```

期待: 全件 PASS。`compose.test.ts` の期待値に `LSP` が現れる箇所があれば取り除く。

- [ ] **Step 6: 同梱プリセットを再生成する**

```bash
pnpm run build && git diff --stat plugins/agent-policy/agents/
```

期待: 4 定義の `tools:` 行から `LSP` が消えている。

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/agents/ plugins/agent-policy/assets/roles/ plugins/agent-policy/agents/ plugins/agent-policy/scripts/
git commit -m "fix(agent-policy): 背景サブエージェントで落ちる LSP を役割定義から除去する"
```

---

### Task 3: `PRESETS` を担当表からの導出へ

**Files:**
- Modify: `plugins/agent-policy/src/agents/presets.ts`
- Modify: `plugins/agent-policy/src/agents/roles.ts`
- Test: `plugins/agent-policy/src/agents/__test__/presets.test.ts`

**Interfaces:**
- Consumes: `MODELS` / `rolesAcrossPolicies`(`./policies`)
- Produces: `PRESETS` は同じ形のまま。`PRESET_ASSIGNMENTS` と `roles.ts` の `PolicyName` は消える

- [ ] **Step 1: 失敗するテストを書く**

`presets.test.ts` の `describe("担当表との一致")` ブロックを削除し、次を追加する。`PRESET_ASSIGNMENTS` の import も削除し、`MODELS` と `rolesAcrossPolicies` を import する。

現行の手書き `PRESETS` でも通るテストと、通らないテストが混ざる。red を作るのは 2 番目である。

```ts
describe("担当表からの導出", () => {
  it("各プリセットの役割が全方針の和集合と一致する", () => {
    for (const preset of PRESETS) {
      expect(preset.roleIds, preset.name).toEqual(
        rolesAcrossPolicies(preset.name as never)
      )
    }
  })

  it("PRESETS が MODELS の非 Claude 帯から導かれている", () => {
    const derived = MODELS.filter((model) => model.vendor !== "claude").map(
      (model) => ({
        name: model.defaultName,
        vendor: model.vendor,
        defaultAlias: model.model,
        color: model.color
      })
    )
    expect(
      PRESETS.map(({ name, vendor, defaultAlias, color }) => ({
        name,
        vendor,
        defaultAlias,
        color
      }))
    ).toEqual(derived)
  })

  it("Claude 帯は同梱プリセットに含まれない", () => {
    for (const preset of PRESETS) {
      expect(preset.vendor, preset.name).not.toBe("claude")
    }
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/presets.test.ts
```

期待: 「PRESETS が MODELS の非 Claude 帯から導かれている」が FAIL する。現行 `PRESETS` は手書きなので、`MODELS` から機械的に導いた配列とはオブジェクトの生成元が違い、値が同じでも導出関係は保証されない。値まで一致していれば PASS するが、その場合でも Step 3 の導出化によって同じテストが構造的に保証されるようになる。

- [ ] **Step 3: `presets.ts` を導出へ書き換える**

全文を次に置き換える。

```ts
import { MODELS, type ModelSpec, rolesAcrossPolicies } from "./policies"
import type { RoleId } from "./roles"

export interface Preset {
  name: string
  vendor: ModelSpec["vendor"]
  defaultAlias: string
  color: string
  roleIds: RoleId[]
}

// 同梱プリセットは GPT / Grok の帯だけを持つ。Claude 帯は方針によって
// 役割集合が大きく変わるため、和集合を配ると担当表と食い違う定義になる。
// Claude 帯の定義は setup で生成する。
export const PRESETS: readonly Preset[] = MODELS.filter(
  (model) => model.vendor !== "claude"
).map((model) => ({
  name: model.defaultName,
  vendor: model.vendor,
  defaultAlias: model.model,
  color: model.color,
  roleIds: rolesAcrossPolicies(model.id)
}))

export const DEFAULT_ALIASES: Record<string, string> = Object.fromEntries(
  PRESETS.map((preset) => [preset.name, preset.defaultAlias])
)
```

- [ ] **Step 4: `roles.ts` から `PRESET_ASSIGNMENTS` と `PolicyName` を削除する**

末尾の `export type PolicyName = ...` と `export const PRESET_ASSIGNMENTS = ...` を削除する。`PolicyName` は `policies.ts` が提供する。

- [ ] **Step 5: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/ && pnpm run typecheck
```

期待: 全件 PASS。typecheck が `PRESET_ASSIGNMENTS` の残存参照を検出する。

- [ ] **Step 6: 同梱プリセットの差分を確認する**

```bash
pnpm run build && git diff plugins/agent-policy/agents/
```

期待: 差分なし。差分が出た場合は `MODELS` の `color` または `model` が現行 `PRESETS` とずれているので、`MODELS` 側を現行の値へ合わせる。

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/agents/ plugins/agent-policy/scripts/ plugins/agent-policy/agents/
git commit -m "refactor(agent-policy): 同梱プリセットの役割集合を担当表から導出する"
```

---

### Task 4: 断片の言語別階層化と 3 段探索

**Files:**
- Move: `plugins/agent-policy/assets/roles/*.md` → `plugins/agent-policy/assets/roles/ja/`
- Create: `plugins/agent-policy/src/agents/hash.ts`
- Modify: `plugins/agent-policy/src/agents/fragments.ts`
- Modify: `plugins/agent-policy/src/agents/compose.ts`(`fragmentDirs` の型)
- Modify: `plugins/agent-policy/src/agents/build-presets.ts`
- Modify: `plugins/agent-policy/src/setup-agents.ts`(`--lang` の追加と `fragmentDirs`)
- Test: `plugins/agent-policy/src/agents/__test__/fragments.test.ts`
- Test: `plugins/agent-policy/src/agents/__test__/compose.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `FragmentDir`、`loadFragments(dirs: FragmentDir[], vendor)`、`loadCommon(dirs: FragmentDir[])`、`fragmentDirsFor(pluginRoot, projectDir, lang)`、`bodyHash(content)`

- [ ] **Step 1: 断片を `ja/` へ移動する**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy && mkdir -p assets/roles/ja && git mv assets/roles/_common.md assets/roles/complex-impl.md assets/roles/normal-impl.md assets/roles/light-impl.md assets/roles/general.md assets/roles/explore.md assets/roles/realtime-research.md assets/roles/independent-review.md assets/roles/doc-review.md assets/roles/code-review.md assets/roles/advisor.md assets/roles/realtime-research.grok.md assets/roles/ja/
```

`ls assets/roles/ja/` で 12 ファイルあることを確認する。

- [ ] **Step 2: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/fragments.test.ts` を作成する。一時ディレクトリ変数は既存ファイルの慣習に合わせ `project` とする。

```ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type FragmentDir, loadCommon, loadFragments } from "../fragments"
import { bodyHash } from "../hash"

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const JA: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "ja"),
  source: "plugin"
}

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function writeFragment(dir: string, id: string, label: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `label: ${label}`,
      `description: ${id} description`,
      "tools: Read, Grep, Glob",
      "kind: readonly",
      "---",
      "",
      "## When to invoke",
      "",
      `- ${id} body`,
      ""
    ].join("\n")
  )
}

describe("loadFragments の 3 段探索", () => {
  it("同梱断片を読み込む", () => {
    const fragments = loadFragments([JA], "claude")
    expect(fragments.size).toBe(10)
    expect(fragments.get("explore")?.source).toBe("plugin")
  })

  it("プロジェクト翻訳が同梱を置き換える", () => {
    const translated = path.join(project, "roles", "de")
    writeFragment(translated, "explore", "translated label")
    const fragments = loadFragments(
      [JA, { path: translated, source: "project" }],
      "claude"
    )
    expect(fragments.get("explore")?.label).toBe("translated label")
    expect(fragments.get("explore")?.source).toBe("project")
  })

  it("プロジェクト独自が翻訳より優先される", () => {
    const translated = path.join(project, "roles", "de")
    const own = path.join(project, "roles")
    writeFragment(translated, "explore", "translated label")
    writeFragment(own, "explore", "own label")
    const fragments = loadFragments(
      [
        JA,
        { path: translated, source: "project" },
        { path: own, source: "project" }
      ],
      "claude"
    )
    expect(fragments.get("explore")?.label).toBe("own label")
  })

  it("ベンダー別断片は後勝ちで置き換わり、二重に追記されない", () => {
    const translated = path.join(project, "roles", "de")
    fs.mkdirSync(translated, { recursive: true })
    fs.writeFileSync(
      path.join(translated, "realtime-research.grok.md"),
      [
        "---",
        "id: realtime-research",
        "vendor: grok",
        "---",
        "",
        "## 作業手順",
        "",
        "- translated grok step",
        ""
      ].join("\n")
    )
    const fragments = loadFragments(
      [JA, { path: translated, source: "project" }],
      "grok"
    )
    const steps = fragments.get("realtime-research")?.sections.get("## 作業手順")
    expect(steps?.filter((line) => line.includes("grok step")).length).toBe(1)
    expect(steps?.join("\n")).toContain("translated grok step")
  })

  it("vendor が一致しないベンダー別断片は読まない", () => {
    const fragments = loadFragments([JA], "claude")
    const steps = fragments.get("realtime-research")?.sections.get("## 作業手順")
    expect(steps?.join("\n")).not.toContain("X 由来")
  })
})

describe("loadCommon", () => {
  it("同梱の _common.md を読む", () => {
    expect(loadCommon([JA]).has("## Preamble")).toBe(true)
  })
})

describe("bodyHash", () => {
  it("frontmatter を変えてもハッシュが変わらない", () => {
    const a = "---\nid: x\nlabel: A\n---\n\n## H\n\n- body\n"
    const b = "---\nid: x\nlabel: B\n---\n\n## H\n\n- body\n"
    expect(bodyHash(a)).toBe(bodyHash(b))
  })

  it("本文を変えるとハッシュが変わる", () => {
    const a = "---\nid: x\n---\n\n## H\n\n- body\n"
    const b = "---\nid: x\n---\n\n## H\n\n- other\n"
    expect(bodyHash(a)).not.toBe(bodyHash(b))
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/fragments.test.ts
```

期待: `../hash` の解決失敗と `FragmentDir` 未定義で FAIL する。

- [ ] **Step 4: `hash.ts` を実装する**

```ts
import crypto from "node:crypto"

// frontmatter を除いた本文のハッシュ。翻訳で label / description が
// 書き換わってもハッシュが変わらないよう、本文だけを対象にする。
export function bodyHash(content: string): string {
  const lines = content.split("\n")
  let body = lines
  if (lines[0]?.trim() === "---") {
    const close = lines.indexOf("---", 1)
    if (close !== -1) body = lines.slice(close + 1)
  }
  return crypto
    .createHash("sha256")
    .update(body.join("\n").trim())
    .digest("hex")
    .slice(0, 16)
}
```

- [ ] **Step 5: `fragments.ts` を書き換える**

`FragmentDir` を導入し、ベンダー別断片を後勝ちの置換にする。

```ts
export interface FragmentDir {
  path: string
  source: "plugin" | "project"
}

export function loadFragments(
  dirs: FragmentDir[],
  vendor: Vendor
): Map<string, Fragment> {
  const fragments = new Map<string, Fragment>()

  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue
    const files = fs
      .readdirSync(dir.path)
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .sort((left, right) => left.localeCompare(right))

    for (const name of files) {
      // <id>.<vendor>.md はベンダー別断片。ここでは読み飛ばす。
      if (name.split(".").length > 2) continue
      const fragment = readFragment(path.join(dir.path, name), dir.source)
      fragments.set(fragment.id, fragment)
    }
  }

  // ベンダー別断片は探索順で後勝ちにする。追記方式のままだと、言語別に
  // 用意した同じ役割の断片が複数ディレクトリから重ねて積まれる。
  const overlays = new Map<string, Map<string, string[]>>()
  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue
    for (const name of fs
      .readdirSync(dir.path)
      .sort((left, right) => left.localeCompare(right))) {
      if (!name.endsWith(`.${vendor}.md`)) continue
      const { meta, sections } = parse(
        fs.readFileSync(path.join(dir.path, name), "utf8")
      )
      const id = meta.id
      if (id === undefined || id === "") continue
      overlays.set(id, sections)
    }
  }
  for (const [id, sections] of overlays) {
    const target = fragments.get(id)
    if (target !== undefined) appendSections(target, sections)
  }

  return fragments
}

export function loadCommon(dirs: FragmentDir[]): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  for (const dir of dirs) {
    const file = path.join(dir.path, "_common.md")
    if (!fs.existsSync(file)) continue
    for (const [heading, body] of parse(fs.readFileSync(file, "utf8"))
      .sections) {
      sections.set(heading, body)
    }
  }
  if (sections.size === 0) throw new Error("_common.md not found")
  return sections
}

// 探索順は後勝ち。同梱 → プロジェクト翻訳 → プロジェクト独自。
// lang が ja / en 以外のときは同梱として en を使い、翻訳断片で置き換える。
export function fragmentDirsFor(
  pluginRoot: string,
  projectDir: string,
  lang: string
): FragmentDir[] {
  const bundled = lang === "ja" || lang === "en" ? lang : "en"
  const dirs: FragmentDir[] = [
    {
      path: path.join(pluginRoot, "assets", "roles", bundled),
      source: "plugin"
    }
  ]
  const projectRoles = path.join(projectDir, ".claude", "agent-policy", "roles")
  if (bundled !== lang) {
    dirs.push({ path: path.join(projectRoles, lang), source: "project" })
  }
  dirs.push({ path: projectRoles, source: "project" })
  return dirs
}
```

- [ ] **Step 6: 呼び出し側を追随させる**

`compose.ts` の `ComposeInput.fragmentDirs` を `FragmentDir[]` へ変える。

`build-presets.ts` を次のように変える。

```ts
  const roles = path.join(pluginRoot, "assets", "roles", "ja")
  // ...
    const document = compose({
      name: preset.name,
      model: preset.defaultAlias,
      vendor: preset.vendor,
      roleIds: preset.roleIds,
      fragmentDirs: [{ path: roles, source: "plugin" }],
      color: preset.color
    })
```

`lang` はまだ `ComposeInput` に無い。Task 6 で追加したときに `lang: "ja"` を足す。

`setup-agents.ts` に `--lang` を導入する。`Options` へ `lang: string`(既定 `"ja"`)を足し、`parseArgs` に次を加える。

```ts
      case "--lang":
        options.lang = requireValue(value, "lang")
        index += 1
        break
```

既存の `fragmentDirs(projectDir)` 関数を削除し、呼び出しを `fragmentDirsFor(pluginRoot(), options.dir, options.lang)` へ置き換える。**`--lang` の導入をこのタスクで行うのは、`fragmentDirsFor` が `lang` を要求するためである。** Task 7 まで遅らせると、このタスクの typecheck が通らない。

`compose.test.ts` の `PLUGIN_ROLES` を `FragmentDir` へ変える。

```ts
const PLUGIN_ROLES: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "ja"),
  source: "plugin"
}
```

`fragmentDirs: [PLUGIN_ROLES]` の形で渡す。`as never` を使っている箇所は型が合うようになるので外す。

- [ ] **Step 7: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/ && pnpm run typecheck && pnpm run lint
```

- [ ] **Step 8: ビルドして同梱プリセットが変わらないことを確認する**

```bash
pnpm run build && git diff --stat plugins/agent-policy/agents/
```

期待: 差分なし。

- [ ] **Step 9: コミット**

```bash
git add plugins/agent-policy/assets/ plugins/agent-policy/src/ plugins/agent-policy/scripts/
git commit -m "refactor(agent-policy): 役割断片を言語別ディレクトリへ分け 3 段探索にする"
```

---

### Task 5: 英語の役割断片を書き下ろす

**Files:**
- Create: `plugins/agent-policy/assets/roles/en/` に 12 ファイル
- Test: `plugins/agent-policy/src/agents/__test__/compose.test.ts`

**Interfaces:**
- Consumes: `assets/roles/ja/` の各断片(構造の写し元)
- Produces: `assets/roles/en/` に 12 ファイル。`id` / `kind` / `tools` は ja と同一

- [ ] **Step 1: `prompt-smith:prompt-smith` スキルをロードする**

英語断片は Agent のシステムプロンプト本体である。指示書として書くため、このスキルの規律に従う。

- [ ] **Step 2: 失敗するテストを書く**

`compose.test.ts` に追加する。この時点では見出しが日本語のままなので、見出し行を除いて検証する。Task 6 で全文検証へ戻す。

```ts
const EN: FragmentDir = {
  path: path.join(PLUGIN_ROOT, "assets", "roles", "en"),
  source: "plugin"
}

describe("英語断片での合成", () => {
  it("すべての役割が英語断片で合成できる", () => {
    for (const role of ROLES) {
      const document = compose({
        name: "test-agent",
        model: "sonnet",
        vendor: "claude",
        roleIds: [role.id],
        fragmentDirs: [EN]
      })
      expect(document, role.id).toContain("name: test-agent")
      expect(document, role.id).toContain("## Output Format")
    }
  })

  it("英語断片の id と kind と tools は日本語断片と一致する", () => {
    const ja = loadFragments([PLUGIN_ROLES], "claude")
    const en = loadFragments([EN], "claude")
    expect([...en.keys()].sort()).toEqual([...ja.keys()].sort())
    for (const [id, fragment] of en) {
      expect(fragment.kind, id).toBe(ja.get(id)?.kind)
      expect(fragment.tools, id).toEqual(ja.get(id)?.tools)
    }
  })

  it("英語断片の本文に日本語が混入しない(見出しは Task 6 で対応)", () => {
    const document = compose({
      name: "test-agent",
      model: "sonnet",
      vendor: "claude",
      roleIds: ["complex-impl", "explore"],
      fragmentDirs: [EN]
    })
    const body = document
      .split("\n")
      .filter(
        (line) => !line.startsWith("#") && !line.startsWith("description:")
      )
      .join("\n")
    expect(body).not.toMatch(/[぀-ゟ゠-ヿ一-龯、。「」]/)
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/compose.test.ts
```

期待: `assets/roles/en` が存在せず FAIL する。

- [ ] **Step 4: 英語断片を書き下ろす**

`assets/roles/ja/` の 12 ファイルそれぞれについて英語版を作る。frontmatter の `id` / `kind` / `tools` は ja と同一の値を使い、`label` と `description` を英語にする。

**本文の節見出しは、この時点では ja と同じ日本語のままにする。** `compose.ts` が見出し文字列で節を突き合わせるため、先に見出しだけ英語化すると節が落ちる。Task 6 で語彙を導入したあとに見出しを英語へ変える。

`_common.md` の英語版は次の構造を持つ。

```markdown
---
id: _common
---

## Preamble

You are {{NAME}}, a subagent launched by the main orchestrator.

Your roles are {{ROLE_LABELS}}. The role you are invoked for is stated at the top of the request. If it is not stated and you cannot tell which of your roles applies, do not start work — send it back and ask which role to use.

## アドバイザーへの相談

- Consult an advisor with the Agent tool only when you are genuinely undecided.
- Use the definition for the "design, planning, and implementation advisor" band. If the project has one, call it by name; otherwise start a subagent with a `model` override of `Fable`, falling back to `Opus`.
- State explicitly in the request that the advisor returns advice only, and that it must not use the Agent tool.
- Do not consult an advisor when you are not undecided.

## Agent tool の制約

- The `Agent` tool is for advisor consultation only. Do not use it to re-delegate work, and do not grant the `Agent` tool to any subagent you start.

## 制約

- Do not take on work outside your role. Send it back to the orchestrator.
- Do not cause irreversible side effects on external systems (publishing, posting, sending, writing). Report to the orchestrator instead.
- Browser use is limited to viewing and verification. Do not perform operations that change data in the target system.
- Do not load any skill with the Skill tool other than those named explicitly in the brief.
- A skill's own trigger conditions rank below the explicit instructions in the brief.
- If you realize a skill is needed, do not load it. Report it and send the task back.
- When the orchestrator gives you a context-map, use it as your starting point and report any discrepancy between it and the actual code.
```

役割断片 10 件も同様に、`## When to invoke` / `## Core Responsibilities` / `## 作業手順` / `## 制約` / `## Output Format` の見出しを保ったまま本文を英語で書く。日本語版の内容を規律として写し、直訳ではなく英語の指示書として自然な命令形で書く。

`realtime-research.grok.md` の英語版も作る。

- [ ] **Step 5: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/compose.test.ts
```

期待: 3 件とも PASS。

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/assets/roles/en/ plugins/agent-policy/src/agents/__test__/compose.test.ts
git commit -m "feat(agent-policy): 英語の役割断片を追加する"
```

---

### Task 6: `compose.ts` の言語別語彙

**Files:**
- Create: `plugins/agent-policy/src/agents/vocabulary.ts`
- Modify: `plugins/agent-policy/src/agents/compose.ts`
- Modify: `plugins/agent-policy/assets/roles/en/*.md`(見出しを英語へ)
- Test: `plugins/agent-policy/src/agents/__test__/vocabulary.test.ts`
- Test: `plugins/agent-policy/src/agents/__test__/compose.test.ts`

**Interfaces:**
- Consumes: `Lang`(`./policies`)
- Produces: `Vocabulary`、`vocabularyFor(lang: Lang): Vocabulary`。`ComposeInput` に `lang` / `mcpServers` / `denyTools` が加わる

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/vocabulary.test.ts` を作成する。

```ts
import { describe, expect, it } from "vitest"
import { vocabularyFor } from "../vocabulary"

describe("vocabularyFor", () => {
  it("ja は日本語の見出しと約物を返す", () => {
    const vocabulary = vocabularyFor("ja")
    expect(vocabulary.bodyOrder).toContain("## 作業手順")
    expect(vocabulary.constraintHeading).toBe("## 制約")
    expect(vocabulary.listSeparator).toBe("、")
    expect(vocabulary.quote("実装")).toBe("「実装」")
    expect(vocabulary.describe("実装")).toBe(
      "Use this agent when 実装を委譲するとき。詳細は本文の「When to invoke」を参照。"
    )
  })

  it("en は英語の見出しと約物を返す", () => {
    const vocabulary = vocabularyFor("en")
    expect(vocabulary.bodyOrder).toContain("## Procedure")
    expect(vocabulary.constraintHeading).toBe("## Constraints")
    expect(vocabulary.listSeparator).toBe(", ")
    expect(vocabulary.quote("implementation")).toBe('"implementation"')
    expect(vocabulary.describe("implementation")).toBe(
      'Use this agent when delegating implementation. See "When to invoke" below for details.'
    )
  })

  it("ja と en 以外は en の語彙を返す", () => {
    expect(vocabularyFor("de").bodyOrder).toEqual(vocabularyFor("en").bodyOrder)
    expect(vocabularyFor("de").listSeparator).toBe(", ")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/vocabulary.test.ts
```

期待: `../vocabulary` の解決失敗で FAIL する。

- [ ] **Step 3: `vocabulary.ts` を実装する**

```ts
import type { Lang } from "./policies"

export interface Vocabulary {
  bodyOrder: string[]
  advisorHeading: string
  agentConstraintHeading: string
  constraintHeading: string
  outputFormatHeading: string
  listSeparator: string
  quote: (value: string) => string
  describe: (roles: string) => string
}

const JA: Vocabulary = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## 作業手順"],
  advisorHeading: "## アドバイザーへの相談",
  agentConstraintHeading: "## Agent tool の制約",
  constraintHeading: "## 制約",
  outputFormatHeading: "## Output Format",
  listSeparator: "、",
  quote: (value) => `「${value}」`,
  describe: (roles) =>
    `Use this agent when ${roles}を委譲するとき。詳細は本文の「When to invoke」を参照。`
}

const EN: Vocabulary = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## Procedure"],
  advisorHeading: "## Consulting an advisor",
  agentConstraintHeading: "## Agent tool limits",
  constraintHeading: "## Constraints",
  outputFormatHeading: "## Output Format",
  listSeparator: ", ",
  quote: (value) => `"${value}"`,
  describe: (roles) =>
    `Use this agent when delegating ${roles}. See "When to invoke" below for details.`
}

// ja / en 以外は en の語彙を使う。翻訳断片の見出しも英語のままとし、
// 翻訳するのは本文と label / description に限る(合成器が見出しで節を
// 突き合わせるため)。
export function vocabularyFor(lang: Lang): Vocabulary {
  return lang === "ja" ? JA : EN
}
```

- [ ] **Step 4: `compose.ts` を語彙対応にする**

`ComposeInput` に 3 つ足す。`mcpServers` と `denyTools` は Task 10 で使う。

```ts
export interface ComposeInput {
  name: string
  model: string
  vendor: Vendor
  roleIds: RoleId[]
  fragmentDirs: FragmentDir[]
  lang: Lang
  color?: string
  mcpServers?: string[]
  denyTools?: string[]
}
```

`compose` 本体で見出しを語彙から取る。

```ts
export function compose(input: ComposeInput): string {
  const vocabulary = vocabularyFor(input.lang)
  const common = loadCommon(input.fragmentDirs)
  const { ids: ordered, selected } = selectFragments(input)
  const withAgent = allowsAgentTool(input.roleIds)
  const tools = resolveToolsFor(selected, withAgent, input.mcpServers ?? [])
  const denyTools = input.denyTools ?? []

  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${describe(selected, vocabulary)}`,
    `model: ${input.model}`,
    `color: ${input.color ?? COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    ...(denyTools.length > 0
      ? [`disallowedTools: ${denyTools.join(", ")}`]
      : []),
    `agent-policy-role: ${ordered.join(", ")}`,
    "---",
    ""
  ]

  const body: string[] = []
  body.push(...preamble(common, input.name, selected, vocabulary), "")

  for (const heading of vocabulary.bodyOrder) {
    const items = selected.flatMap(
      (fragment) => fragment.sections.get(heading) ?? []
    )
    if (items.length === 0) continue
    body.push(heading, "", ...items, "")
  }

  if (withAgent) {
    const advisor = common.get(vocabulary.advisorHeading)
    if (advisor !== undefined)
      body.push(vocabulary.advisorHeading, "", ...advisor, "")
  }

  const constraints = [
    ...(withAgent ? (common.get(vocabulary.agentConstraintHeading) ?? []) : []),
    ...(common.get(vocabulary.constraintHeading) ?? []),
    ...selected.flatMap(
      (fragment) => fragment.sections.get(vocabulary.constraintHeading) ?? []
    )
  ]
  if (constraints.length > 0)
    body.push(vocabulary.constraintHeading, "", ...constraints, "")

  body.push(vocabulary.outputFormatHeading, "")
  if (selected.length === 1) {
    body.push(
      ...(selected[0]?.sections.get(vocabulary.outputFormatHeading) ?? []),
      ""
    )
  } else {
    for (const fragment of selected) {
      const items = fragment.sections.get(vocabulary.outputFormatHeading)
      if (items === undefined || items.length === 0) continue
      body.push(`### ${fragment.label}`, "", ...items, "")
    }
  }

  return `${[...head, ...body]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`
}
```

`describe` / `preamble` / `resolveToolsFor` を語彙対応にする。

```ts
function describe(selected: Fragment[], vocabulary: Vocabulary): string {
  const list = selected
    .map((fragment) => fragment.description)
    .join(vocabulary.listSeparator)
  return vocabulary.describe(list)
}

function preamble(
  common: Map<string, string[]>,
  name: string,
  selected: Fragment[],
  vocabulary: Vocabulary
): string[] {
  const labels = selected
    .map((fragment) => vocabulary.quote(fragment.label))
    .join(vocabulary.listSeparator)
  return (common.get("## Preamble") ?? []).map((line) =>
    line.replace("{{NAME}}", name).replace("{{ROLE_LABELS}}", labels)
  )
}

// MCP サーバーはサーバー単位で末尾へ足す。Agent はその手前へ置く。
// mcpServers には mcp__ プレフィックス付きの完成した名前を渡す。
function resolveToolsFor(
  selected: Fragment[],
  withAgent: boolean,
  mcpServers: string[]
): string[] {
  const tools: string[] = []
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (tool !== "Agent" && !tools.includes(tool)) tools.push(tool)
    }
  }
  if (withAgent) tools.push("Agent")
  for (const server of mcpServers) {
    if (!tools.includes(server)) tools.push(server)
  }
  return tools
}
```

`## Preamble` の見出しは ja / en 共通なので語彙に含めない。

- [ ] **Step 5: 英語断片の見出しを英語へ変える**

Serena の `replace_in_files` で 4 件を置換する。対象は `plugins/agent-policy/assets/roles/en/*.md` に限る。

| needle(literal) | repl |
| --- | --- |
| `## 作業手順` | `## Procedure` |
| `## 制約` | `## Constraints` |
| `## アドバイザーへの相談` | `## Consulting an advisor` |
| `## Agent tool の制約` | `## Agent tool limits` |

- [ ] **Step 6: 呼び出し側に `lang` を渡す**

`build-presets.ts` は `lang: "ja"` を渡す。`setup-agents.ts` の `composeInput` は `lang: options.lang` を渡す。`compose.test.ts` の既存呼び出しにも `lang: "ja"` を足す。Task 5 で追加した英語テストは `lang: "en"` を渡す。

- [ ] **Step 7: 英語合成の検証を全文へ戻す**

Task 5 Step 2 で追加した「見出しは Task 6 で対応」のテストを次の 2 件に置き換える。

```ts
  it("英語で合成した定義に日本語と日本語約物が混入しない", () => {
    const document = compose({
      name: "test-agent",
      model: "sonnet",
      vendor: "claude",
      roleIds: ["complex-impl", "explore"],
      fragmentDirs: [EN],
      lang: "en"
    })
    expect(document).not.toMatch(/[぀-ゟ゠-ヿ一-龯、。「」]/)
  })

  it("英語で合成した定義の見出しが英語になっている", () => {
    const document = compose({
      name: "test-agent",
      model: "sonnet",
      vendor: "claude",
      roleIds: ["complex-impl"],
      fragmentDirs: [EN],
      lang: "en"
    })
    expect(document).toContain("## Procedure")
    expect(document).toContain("## Constraints")
    expect(document).not.toContain("## 作業手順")
  })
```

- [ ] **Step 8: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/ && pnpm run typecheck && pnpm run lint
```

- [ ] **Step 9: ビルドして同梱プリセットが変わらないことを確認する**

```bash
pnpm run build && git diff --stat plugins/agent-policy/agents/
```

期待: 差分なし(`lang: "ja"` で従来と同じ出力になる)。

- [ ] **Step 10: コミット**

```bash
git add plugins/agent-policy/src/ plugins/agent-policy/assets/roles/en/ plugins/agent-policy/scripts/
git commit -m "feat(agent-policy): 定義の合成に言語別語彙を導入する"
```

---

### Task 7: 翻訳断片の陳腐化検知とひな形生成

**Files:**
- Modify: `plugins/agent-policy/src/agents/fragments.ts`
- Modify: `plugins/agent-policy/src/setup-agents.ts`
- Test: `plugins/agent-policy/src/agents/__test__/fragments.test.ts`
- Test: `plugins/agent-policy/src/__test__/setup-agents.test.ts`

**Interfaces:**
- Consumes: `bodyHash`(`./hash`)
- Produces: `FragmentStatus`、`checkFragments(pluginRoot, projectDir, lang)`、`scaffoldFragments(pluginRoot, projectDir, lang)`

- [ ] **Step 1: 失敗するテストを書く**

`fragments.test.ts` に追加する。`import` に `checkFragments` / `scaffoldFragments` を足す。

```ts
describe("checkFragments", () => {
  it("ja では missing も stale も空で targetDir が null", () => {
    const status = checkFragments(PLUGIN_ROOT, project, "ja")
    expect(status.missing).toEqual([])
    expect(status.stale).toEqual([])
    expect(status.targetDir).toBeNull()
  })

  it("翻訳先が空なら全断片が missing になる", () => {
    const status = checkFragments(PLUGIN_ROOT, project, "de")
    expect(status.missing).toContain("_common")
    expect(status.missing).toContain("explore")
    expect(status.ready).toEqual([])
  })

  it("scaffold 後は missing が空になる", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const status = checkFragments(PLUGIN_ROOT, project, "de")
    expect(status.missing).toEqual([])
    expect(status.stale).toEqual([])
    expect(status.ready.length).toBeGreaterThan(0)
  })

  it("source-hash がずれると stale になる", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const file = path.join(
      project,
      ".claude",
      "agent-policy",
      "roles",
      "de",
      "explore.md"
    )
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(/^source-hash: .*$/m, "source-hash: stale")
    )
    const status = checkFragments(PLUGIN_ROOT, project, "de")
    expect(status.stale.map((entry) => entry.id)).toContain("explore")
  })

  it("scaffold は source-lang と source-hash を書き込む", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const content = fs.readFileSync(
      path.join(
        project,
        ".claude",
        "agent-policy",
        "roles",
        "de",
        "explore.md"
      ),
      "utf8"
    )
    expect(content).toContain("source-lang: en")
    expect(content).toMatch(/^source-hash: [0-9a-f]{16}$/m)
  })

  it("scaffold は最新の翻訳を上書きしない", () => {
    scaffoldFragments(PLUGIN_ROOT, project, "de")
    const file = path.join(
      project,
      ".claude",
      "agent-policy",
      "roles",
      "de",
      "explore.md"
    )
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("## When to invoke", "## Wann")
    )
    const written = scaffoldFragments(PLUGIN_ROOT, project, "de")
    expect(written).toEqual([])
    expect(fs.readFileSync(file, "utf8")).toContain("## Wann")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/fragments.test.ts
```

期待: `checkFragments` 未定義で FAIL する。

- [ ] **Step 3: `checkFragments` と `scaffoldFragments` を実装する**

`fragments.ts` へ追加する。`parse` は既存の内部関数をそのまま使う。

```ts
export interface StaleFragment {
  id: string
  expected: string
  actual: string
}

export interface FragmentStatus {
  lang: string
  sourceDir: string
  targetDir: string | null
  missing: string[]
  stale: StaleFragment[]
  ready: string[]
}

function bundledDir(pluginRoot: string, lang: string): string {
  const bundled = lang === "ja" || lang === "en" ? lang : "en"
  return path.join(pluginRoot, "assets", "roles", bundled)
}

function translationDir(projectDir: string, lang: string): string {
  return path.join(projectDir, ".claude", "agent-policy", "roles", lang)
}

// 同梱断片のファイル名一覧。_common.md とベンダー別断片も対象に含める。
function bundledFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
}

export function checkFragments(
  pluginRoot: string,
  projectDir: string,
  lang: string
): FragmentStatus {
  const sourceDir = bundledDir(pluginRoot, lang)
  if (lang === "ja" || lang === "en") {
    return {
      lang,
      sourceDir,
      targetDir: null,
      missing: [],
      stale: [],
      ready: []
    }
  }

  const targetDir = translationDir(projectDir, lang)
  const missing: string[] = []
  const stale: StaleFragment[] = []
  const ready: string[] = []

  for (const name of bundledFiles(sourceDir)) {
    const id = name.replace(/\.md$/, "")
    const target = path.join(targetDir, name)
    if (!fs.existsSync(target)) {
      missing.push(id)
      continue
    }
    const expected = bodyHash(
      fs.readFileSync(path.join(sourceDir, name), "utf8")
    )
    const actual = parse(fs.readFileSync(target, "utf8")).meta["source-hash"]
    if (actual !== expected) {
      stale.push({ id, expected, actual: actual ?? "" })
      continue
    }
    ready.push(id)
  }

  return { lang, sourceDir, targetDir, missing, stale, ready }
}

// 同梱英語断片を翻訳先へコピーし、source-lang と source-hash を書き込む。
// 中身の翻訳はスキルが Edit で行う。source-hash が一致するファイルは
// 最新の翻訳とみなして上書きしない。ずれているファイルは英語ソースで
// 上書きするため、既存の訳が失われる。スキル側で確認させる。
export function scaffoldFragments(
  pluginRoot: string,
  projectDir: string,
  lang: string
): string[] {
  if (lang === "ja" || lang === "en") return []

  const sourceDir = bundledDir(pluginRoot, lang)
  const targetDir = translationDir(projectDir, lang)
  fs.mkdirSync(targetDir, { recursive: true })
  const written: string[] = []

  for (const name of bundledFiles(sourceDir)) {
    const target = path.join(targetDir, name)
    const source = fs.readFileSync(path.join(sourceDir, name), "utf8")
    const hash = bodyHash(source)
    const current = fs.existsSync(target)
      ? parse(fs.readFileSync(target, "utf8")).meta["source-hash"]
      : undefined
    if (current === hash) continue

    const lines = source.split("\n")
    const close = lines.indexOf("---", 1)
    const injected = [
      ...lines.slice(0, close),
      "source-lang: en",
      `source-hash: ${hash}`,
      ...lines.slice(close)
    ]
    fs.writeFileSync(target, injected.join("\n"))
    written.push(target)
  }

  return written
}
```

- [ ] **Step 4: CLI へ 2 つのサブコマンドを足す**

`Options` へ `checkFragments: boolean` / `scaffoldFragments: boolean` を足し、`parseArgs` で受ける。必須チェックは `listRoles` と同じ扱いにする(`name` / `roles` を要求しない)。

エントリポイントの分岐へ次を足す。

```ts
  if (options.checkFragments) {
    respond({
      ok: true,
      ...checkFragments(pluginRoot(), options.dir, options.lang)
    })
  } else if (options.scaffoldFragments) {
    const written = scaffoldFragments(pluginRoot(), options.dir, options.lang)
    respond({
      ok: true,
      lang: options.lang,
      written: written.map((file) =>
        path.relative(options.dir, file).split(path.sep).join("/")
      )
    })
  } else if (options.listRoles) {
```

- [ ] **Step 5: CLI のテストを書く**

`setup-agents.test.ts` に追加する。既存の `run` ヘルパーは同期なので `await` を付けない。

```ts
interface FragmentStatusResult {
  ok: boolean
  missing: string[]
  stale: { id: string }[]
  targetDir: string | null
  written?: string[]
}

describe("--check-fragments", () => {
  it("ja では missing が空で targetDir が null", () => {
    const result = run<FragmentStatusResult>([
      "--check-fragments",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.targetDir).toBeNull()
  })

  it("未翻訳の言語では missing が返る", () => {
    const result = run<FragmentStatusResult>([
      "--check-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    expect(result.missing).toContain("explore")
  })
})

describe("--scaffold-fragments", () => {
  it("翻訳先へひな形を書き、書いたパスを返す", () => {
    const result = run<FragmentStatusResult>([
      "--scaffold-fragments",
      "--lang",
      "de",
      "--dir",
      project
    ])
    expect(result.ok).toBe(true)
    expect(result.written?.length).toBeGreaterThan(0)
    expect(result.written?.[0]).toMatch(/^\.claude\/agent-policy\/roles\/de\//)
  })
})
```

- [ ] **Step 6: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/ && pnpm run typecheck && pnpm run lint
```

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/
git commit -m "feat(agent-policy): 翻訳断片の陳腐化検知とひな形生成を追加する"
```

---

### Task 8: MCP モジュール

**Files:**
- Create: `plugins/agent-policy/src/agents/mcp.ts`
- Create: `plugins/agent-policy/src/testing/fake-claude.mjs`
- Test: `plugins/agent-policy/src/agents/__test__/mcp.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `McpServer`、`McpCurrent`、`parseMcpList`、`toolPrefix`、`listMcpServers(env)`、`mcpCurrentOf(content)`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/agent-policy/src/agents/__test__/mcp.test.ts` を作成する。

```ts
import { describe, expect, it } from "vitest"
import { mcpCurrentOf, parseMcpList, toolPrefix } from "../mcp"

const SAMPLE = [
  "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set",
  "Checking MCP server health…",
  "",
  "plugin:context7:context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected",
  "serena: uvx --from git+https://github.com/oraios/serena serena start - ✔ Connected",
  "broken: node /tmp/broken.mjs - ✘ Failed to connect",
  "needsauth: https://example.com/mcp (HTTP) - ! Needs authentication",
  "pending: node /tmp/pending.mjs - ⏸ Pending approval",
  "lazy: node /tmp/lazy.mjs - cached, connects on first use"
].join("\n")

describe("parseMcpList", () => {
  it("警告行とヘルスチェック行を無視する", () => {
    expect(parseMcpList(SAMPLE).map((s) => s.name)).toEqual([
      "plugin:context7:context7",
      "serena",
      "broken",
      "needsauth",
      "pending",
      "lazy"
    ])
  })

  it("コロンを含む名前を最初のコロンで切らない", () => {
    expect(parseMcpList(SAMPLE)[0]?.name).toBe("plugin:context7:context7")
  })

  it("Connected と cached だけを usable とする", () => {
    expect(
      parseMcpList(SAMPLE)
        .filter((s) => s.usable)
        .map((s) => s.name)
    ).toEqual(["plugin:context7:context7", "serena", "lazy"])
  })

  it("空の出力では空配列を返す", () => {
    expect(parseMcpList("")).toEqual([])
  })
})

describe("toolPrefix", () => {
  it("英数字とアンダースコアとハイフン以外を _ に置き換える", () => {
    expect(toolPrefix("plugin:context7:context7")).toBe(
      "mcp__plugin_context7_context7"
    )
  })

  it("素の名前はそのまま使う", () => {
    expect(toolPrefix("serena")).toBe("mcp__serena")
  })

  it("ハイフンを保つ", () => {
    expect(toolPrefix("my-server")).toBe("mcp__my-server")
  })
})

describe("mcpCurrentOf", () => {
  const definition = [
    "---",
    "name: claude-explorer",
    "description: x",
    "model: sonnet",
    "color: purple",
    "tools: Read, Grep, Glob, Bash, mcp__serena",
    "disallowedTools: mcp__serena__write_memory, mcp__serena__rename_symbol",
    "agent-policy-role: explore",
    "---",
    "",
    "本文"
  ].join("\n")

  it("tools から MCP のプレフィックスを拾う", () => {
    expect(mcpCurrentOf(definition).servers).toEqual(["mcp__serena"])
  })

  it("disallowedTools をそのまま返す", () => {
    expect(mcpCurrentOf(definition).denyTools).toEqual([
      "mcp__serena__write_memory",
      "mcp__serena__rename_symbol"
    ])
  })

  it("MCP を持たない定義では空になる", () => {
    const plain = ["---", "name: x", "tools: Read, Grep", "---", "", "本文"].join(
      "\n"
    )
    expect(mcpCurrentOf(plain)).toEqual({ servers: [], denyTools: [] })
  })

  it("frontmatter が無い内容では空になる", () => {
    expect(mcpCurrentOf("本文だけ")).toEqual({ servers: [], denyTools: [] })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/mcp.test.ts
```

期待: `../mcp` の解決失敗で FAIL する。

- [ ] **Step 3: `mcp.ts` を実装する**

```ts
import { execFileSync } from "node:child_process"

export interface McpServer {
  name: string
  status: string
  usable: boolean
}

export interface McpCurrent {
  servers: string[]
  denyTools: string[]
}

// claude mcp list が付けるステータス。usable は「いま tools に書いてよいか」。
// Connected と cached だけを採る。Failed / Needs authentication / Pending /
// Rejected を書くと、存在しないツール名を tools に載せることになる。
const USABLE = ["✔ Connected", "cached"]
const STATUSES = [
  "✔ Connected",
  "✘ Failed to connect",
  "! Needs authentication",
  "⏸ Pending approval",
  "✘ Rejected",
  "cached"
]

// 名前自体がコロンを含みうる(plugin:<plugin>:<server>)ため、最初のコロンで
// 切ってはならない。行末のステータスを切り落としてから、先頭の空白までを
// 名前として採り、末尾のコロンを除く。
export function parseMcpList(output: string): McpServer[] {
  const servers: McpServer[] = []

  for (const raw of output.split("\n")) {
    const line = raw.trim()
    if (line === "") continue
    if (line.startsWith("⚠") || line.startsWith("Checking")) continue

    const at = line.lastIndexOf(" - ")
    if (at === -1) continue
    const status = line.slice(at + 3).trim()
    if (!STATUSES.some((known) => status.startsWith(known))) continue

    const head = line.slice(0, at)
    const space = head.indexOf(" ")
    const name = (space === -1 ? head : head.slice(0, space)).replace(/:$/, "")
    if (name === "") continue

    servers.push({
      name,
      status,
      usable: USABLE.some((known) => status.startsWith(known))
    })
  }

  return servers
}

export function toolPrefix(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

// claude mcp list を実行する。テストでは AGENT_POLICY_CLAUDE_BIN で
// src/testing/fake-claude.mjs を指す。ヘルスチェックは全サーバーへの
// 接続試行を伴うため timeout と maxBuffer を明示し、失敗しても例外を
// 投げずに空を返す(claude が無い環境でウィザードを止めないため)。
export function listMcpServers(env: NodeJS.ProcessEnv): McpServer[] {
  const bin = env.AGENT_POLICY_CLAUDE_BIN
  const options = {
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "pipe"] as const,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024
  }
  try {
    const output =
      bin === undefined || bin === ""
        ? execFileSync("claude", ["mcp", "list"], options)
        : execFileSync(process.execPath, [bin], options)
    return parseMcpList(output)
  } catch {
    return []
  }
}

// 既存定義から MCP の付与状況を逆算する。専用の設定ファイルを持たず、
// 生成物そのものを前回の選択の記録として使う。
export function mcpCurrentOf(content: string): McpCurrent {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") return { servers: [], denyTools: [] }
  const close = lines.indexOf("---", 1)
  if (close === -1) return { servers: [], denyTools: [] }

  const meta = new Map<string, string>()
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ")
    if (at <= 0) continue
    meta.set(line.slice(0, at).trim(), line.slice(at + 2).trim())
  }

  const split = (value: string | undefined): string[] =>
    value === undefined
      ? []
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "")

  return {
    servers: split(meta.get("tools")).filter((tool) => tool.startsWith("mcp__")),
    denyTools: split(meta.get("disallowedTools"))
  }
}
```

- [ ] **Step 4: 故障注入用スクリプトを作る**

`plugins/agent-policy/src/testing/fake-claude.mjs` を作成する。lint と型検査の対象外にするため `.mjs` とする。

```js
#!/usr/bin/env node
// claude mcp list の代わりに固定出力を返す。AGENT_POLICY_CLAUDE_BIN が
// このファイルを指しているとき、mcp.ts の listMcpServers がこれを実行する。
// AGENT_POLICY_FAKE_MCP に出力したい内容を渡す。未設定なら空を返す。
process.stdout.write(process.env.AGENT_POLICY_FAKE_MCP ?? "")
```

- [ ] **Step 5: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/agents/__test__/mcp.test.ts && pnpm run lint && pnpm run typecheck
```

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/src/agents/mcp.ts plugins/agent-policy/src/agents/__test__/mcp.test.ts plugins/agent-policy/src/testing/fake-claude.mjs
git commit -m "feat(agent-policy): MCP の検出と既存定義からの逆算を追加する"
```

---

### Task 9: CLI の一覧系サブコマンドと `--vendor` 廃止

**Files:**
- Modify: `plugins/agent-policy/src/setup-agents.ts`
- Test: `plugins/agent-policy/src/__test__/setup-agents.test.ts`

**Interfaces:**
- Consumes: Task 1 と Task 8 の export
- Produces: `--list-policies` / `--list-models` / `--list-roles` / `--list-mcp`

- [ ] **Step 1: 既存テストを新しい引数へ移行する**

`--vendor` を削除する前に、既存テストを書き換える。これを先にやらないと Step 6 で大量に落ちる。

`check()` ヘルパーを次の形にする。

```ts
function check(extra: string[] = []): CheckResult {
  return run([
    "--policy",
    "with-codex-policy",
    "--model-id",
    "gpt-sol",
    "--name",
    "gpt-sol",
    "--roles",
    "complex-impl",
    "--lang",
    "ja",
    "--dir",
    project,
    "--check",
    ...extra
  ])
}
```

`grep -n '"--vendor"' src/__test__/setup-agents.test.ts` で全件を洗い出し、同じ形へ直す。`--model` を明示していたテストは既定値で解決されるため削ってよい。エイリアスの上書きを検証しているテストだけ `--model` を残す。

- [ ] **Step 2: 失敗するテストを書く**

```ts
interface PolicyListResult {
  ok: boolean
  policies: { id: string; label: string; injection: string }[]
}

interface ModelListResult {
  ok: boolean
  error?: string
  models: {
    id: string
    label: string
    defaultName: string
    model: string
    vendor: string
    color: string
    roles: string[]
  }[]
}

describe("--list-policies", () => {
  it("4 方針を返す", () => {
    const result = run<PolicyListResult>(["--list-policies"])
    expect(result.policies.map((p) => p.id)).toEqual([
      "claude-model-policy",
      "with-codex-policy",
      "with-grok-policy",
      "codex-grok-policy"
    ])
  })

  it("AMATSUKA_AGENT_AUTO_INJECTION の値を添える", () => {
    const result = run<PolicyListResult>(["--list-policies"])
    expect(result.policies[0]?.injection).toBe("claude")
    expect(result.policies[3]?.injection).toBe("with-codex-grok")
  })
})

describe("--list-models", () => {
  it("claude-model-policy は Claude 4 種を返す", () => {
    const result = run<ModelListResult>([
      "--list-models",
      "--policy",
      "claude-model-policy"
    ])
    expect(result.models.map((m) => m.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable"
    ])
  })

  it("各モデルに既定名と担える役割と色を添える", () => {
    const result = run<ModelListResult>([
      "--list-models",
      "--policy",
      "claude-model-policy"
    ])
    const sonnet = result.models.find((m) => m.id === "sonnet")
    expect(sonnet?.defaultName).toBe("claude-sonnet")
    expect(sonnet?.model).toBe("sonnet")
    expect(sonnet?.color).toBe("purple")
    expect(sonnet?.roles).toContain("code-review")
  })

  it("未知のポリシーを拒否する", () => {
    const result = run<ModelListResult>(["--list-models", "--policy", "nope"])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/policy/)
  })
})

describe("--list-roles", () => {
  it("担当表で担える役割だけを返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "codex-grok-policy",
      "--model-id",
      "gpt-terra",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.roles.map((r) => r.id)).toEqual(["normal-impl", "general"])
  })

  it("id と label の両方を返す", () => {
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "haiku",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    const light = result.roles.find((r) => r.id === "light-impl")
    expect(light?.label).toBe("軽量な実装")
    expect(light?.kind).toBe("impl")
  })

  it("プロジェクト独自役割は担当表に無くても含める", () => {
    const dir = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の一次切り分け",
        "description: 障害の一次切り分け",
        "tools: Read, Grep, Glob",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- 障害の一次切り分け"
      ].join("\n")
    )
    const result = run<ListRolesResult>([
      "--list-roles",
      "--policy",
      "claude-model-policy",
      "--model-id",
      "haiku",
      "--lang",
      "ja",
      "--dir",
      project
    ])
    expect(result.roles.map((r) => r.id)).toContain("triage")
  })
})
```

`ListedRole` に `languageMismatch?: boolean` を足す。

- [ ] **Step 3: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts
```

期待: `Unsupported option: --list-policies` などで FAIL する。

- [ ] **Step 4: import と `Options` を書き換える**

ファイル先頭へ import を足す。

```ts
import { listMcpServers } from "./agents/mcp"
import {
  type ModelSpec,
  modelById,
  modelsFor,
  POLICIES,
  policyById,
  type PolicyName,
  resolveModelValue,
  rolesFor
} from "./agents/policies"
import {
  type Fragment,
  type FragmentDir,
  fragmentDirsFor,
  loadFragments
} from "./agents/fragments"
import { roleById, roleOrder } from "./agents/roles"
```

`Options` から `vendor` を削除し、`policy: string` / `modelId: string` / `listPolicies` / `listModels` / `listMcp` を足す。`--vendor` の `case` を削除し、次を足す。

```ts
      case "--policy":
        options.policy = requireValue(value, "policy")
        index += 1
        break
      case "--model-id":
        options.modelId = requireValue(value, "model-id")
        index += 1
        break
      case "--list-policies":
        options.listPolicies = true
        break
      case "--list-models":
        options.listModels = true
        break
      case "--list-mcp":
        options.listMcp = true
        break
```

必須チェックは、一覧系・断片系のいずれかが真なら `name` / `roles` を要求しない形にする。`--model` の必須チェックは削除する(既定値から解決するため)。

- [ ] **Step 5: 一覧系のハンドラを実装する**

```ts
function requirePolicy(options: Options): PolicyName {
  const policy = policyById(options.policy)
  if (policy === undefined) {
    throw new Error(
      `policy: must be one of ${POLICIES.map((entry) => entry.id).join(", ")}`
    )
  }
  return policy.id
}

function requireModel(options: Options, policy: PolicyName): ModelSpec {
  const spec = modelById(options.modelId)
  if (spec === undefined) throw new Error("model-id: is unknown")
  if (!modelsFor(policy).some((entry) => entry.id === spec.id)) {
    throw new Error(`model-id: ${spec.id} is not used in ${policy}`)
  }
  return spec
}

function listPolicies(): unknown {
  return {
    ok: true,
    policies: POLICIES.map(({ id, label, injection }) => ({
      id,
      label,
      injection
    }))
  }
}

function listModels(options: Options): unknown {
  const policy = requirePolicy(options)
  return {
    ok: true,
    policy,
    models: modelsFor(policy).map((spec) => ({
      id: spec.id,
      label: spec.label,
      defaultName: spec.defaultName,
      model: resolveModelValue(spec, process.env),
      vendor: spec.vendor,
      color: spec.color,
      roles: rolesFor(policy, spec.id)
    }))
  }
}

function listMcp(): unknown {
  return { ok: true, servers: listMcpServers(process.env) }
}
```

`listAvailableRoles` を担当表で絞る形へ書き換える。

```ts
function listAvailableRoles(options: Options): unknown {
  const policy = requirePolicy(options)
  const model = requireModel(options, policy)
  const allowed = new Set<string>(rolesFor(policy, model.id))
  const dirs = fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  const fragments = loadFragments(dirs, model.vendor)
  // 第 3 段(プロジェクト独自)は言語別ディレクトリより優先されるため、
  // lang が ja 以外でもここ由来の断片は元の言語のまま合成へ入る。
  const ownDir = dirs.at(-1)?.path

  const roles = [...fragments.values()]
    .filter(
      (fragment) =>
        allowed.has(fragment.id) || roleById(fragment.id) === undefined
    )
    .sort(
      (left, right) =>
        roleOrder(left.id) - roleOrder(right.id) ||
        left.id.localeCompare(right.id)
    )
    .map((fragment) => ({
      id: fragment.id,
      label: fragment.label,
      kind: fragment.kind,
      tools: fragment.tools,
      source: fragment.source,
      languageMismatch:
        options.lang !== "ja" &&
        fragment.source === "project" &&
        ownDir !== undefined &&
        fs.existsSync(path.join(ownDir, `${fragment.id}.md`))
    }))

  return { ok: true, policy, modelId: model.id, lang: options.lang, roles }
}
```

エントリポイントの分岐へ 3 つを追加する。

- [ ] **Step 6: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/ && pnpm run typecheck && pnpm run lint
```

期待: 全件 PASS。既存テストが Step 1 で移行済みであることが前提。

- [ ] **Step 7: コミット**

```bash
git add plugins/agent-policy/src/
git commit -m "feat(agent-policy): 担当表に基づく一覧系サブコマンドを追加し --vendor を廃止する"
```

---

### Task 10: CLI の差分と書き込み

**Files:**
- Modify: `plugins/agent-policy/src/setup-agents.ts`
- Test: `plugins/agent-policy/src/__test__/setup-agents.test.ts`

**Interfaces:**
- Consumes: Task 8 と Task 9 の export
- Produces: `--check` / `--write` が `--models` / `--mcp-servers` / `--mcp-deny` を受ける。応答は `results` 配列

- [ ] **Step 1: 失敗するテストを書く**

```ts
interface WriteResults {
  ok: boolean
  error?: string
  results: {
    modelId: string
    target: string
    action?: string
    kept?: string[]
    roles: RolesSummary
    mcpCurrent: { servers: string[]; denyTools: string[] }
    mcpDropped: string[]
  }[]
}

const FAKE_CLAUDE = fileURLToPath(
  new URL("../testing/fake-claude.mjs", import.meta.url)
)

function runWithMcp<T>(args: string[], listOutput: string): T {
  const previous = {
    bin: process.env.AGENT_POLICY_CLAUDE_BIN,
    fake: process.env.AGENT_POLICY_FAKE_MCP
  }
  process.env.AGENT_POLICY_CLAUDE_BIN = FAKE_CLAUDE
  process.env.AGENT_POLICY_FAKE_MCP = listOutput
  try {
    return run<T>(args)
  } finally {
    process.env.AGENT_POLICY_CLAUDE_BIN = previous.bin
    process.env.AGENT_POLICY_FAKE_MCP = previous.fake
  }
}

describe("担当表の検証", () => {
  it("担当表にある役割は通る", () => {
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "ja", "--name", "claude-sonnet",
      "--roles", "normal-impl,code-review", "--dir", project
    ])
    expect(result.ok).toBe(true)
  })

  it("担当表に無い組み込み役割を拒否する", () => {
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "ja", "--name", "claude-sonnet",
      "--roles", "normal-impl,light-impl", "--dir", project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain("light-impl")
  })

  it("そのポリシーに登場しないモデルを拒否する", () => {
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "grok",
      "--lang", "ja", "--name", "grok", "--roles", "explore", "--dir", project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/model-id/)
  })

  it("プロジェクト独自役割は担当表の検証を免除する", () => {
    const dir = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "triage.md"),
      [
        "---", "id: triage", "label: 障害の一次切り分け",
        "description: 障害の一次切り分け", "tools: Read, Grep, Glob",
        "kind: readonly", "---", "", "## When to invoke", "", "- 一次切り分け"
      ].join("\n")
    )
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "ja", "--name", "claude-sonnet",
      "--roles", "explore,triage", "--dir", project
    ])
    expect(result.ok).toBe(true)
  })

  it("翻訳断片が欠けている言語を拒否する", () => {
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "de", "--name", "claude-sonnet",
      "--roles", "explore", "--dir", project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/fragment/i)
  })
})

describe("--models による一括", () => {
  it("複数モデルの差分を配列で返す", () => {
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--lang", "ja",
      "--models", "sonnet,haiku", "--dir", project
    ])
    expect(result.ok).toBe(true)
    expect(result.results.length).toBe(2)
    expect(result.results[0]?.modelId).toBe("sonnet")
    expect(result.results[0]?.roles.ids).toEqual([
      "normal-impl", "general", "explore",
      "realtime-research", "independent-review", "code-review"
    ])
  })

  it("単一指定でも要素 1 の配列を返す", () => {
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "haiku",
      "--lang", "ja", "--name", "claude-haiku",
      "--roles", "light-impl", "--dir", project
    ])
    expect(result.results.length).toBe(1)
  })

  it("--models と --merge を併用できる", () => {
    const result = run<WriteResults>([
      "--write", "--merge", "--policy", "claude-model-policy", "--lang", "ja",
      "--models", "haiku", "--dir", project
    ])
    expect(result.ok).toBe(true)
    expect(result.results[0]?.action).toBe("written")
  })

  it("--models と --keep は併用できない", () => {
    const result = run<WriteResults>([
      "--write", "--policy", "claude-model-policy", "--lang", "ja",
      "--models", "haiku", "--keep", "preamble", "--dir", project
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/keep/)
  })
})

describe("MCP の付与", () => {
  const CONNECTED = "serena: uvx serena - ✔ Connected"

  it("--mcp-servers で渡したサーバーを tools へ足す", () => {
    const result = runWithMcp<WriteResults>([
      "--write", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "ja", "--name", "claude-explorer", "--roles", "explore",
      "--dir", project, "--mcp-servers", "serena",
      "--mcp-deny", "mcp__serena__write_memory"
    ], CONNECTED)
    expect(result.ok).toBe(true)
    const written = fs.readFileSync(
      path.join(project, ".claude", "agents", "claude-explorer.md"), "utf8"
    )
    expect(written).toMatch(/^tools:.*mcp__serena$/m)
    expect(written).toMatch(/^disallowedTools: mcp__serena__write_memory$/m)
  })

  it("usable でないサーバーは落として報告する", () => {
    const result = runWithMcp<WriteResults>([
      "--write", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "ja", "--name", "claude-explorer", "--roles", "explore",
      "--dir", project, "--mcp-servers", "gone"
    ], CONNECTED)
    expect(result.results[0]?.mcpDropped).toEqual(["gone"])
    const written = fs.readFileSync(
      path.join(project, ".claude", "agents", "claude-explorer.md"), "utf8"
    )
    expect(written).not.toContain("mcp__")
  })

  it("既存定義から mcpCurrent を逆算して返す", () => {
    const file = path.join(project, ".claude", "agents", "claude-explorer.md")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, [
      "---", "name: claude-explorer", "description: old", "model: sonnet",
      "color: purple", "tools: Read, Grep, Glob, Bash, mcp__serena",
      "disallowedTools: mcp__serena__write_memory",
      "agent-policy-role: explore", "---", "", "## Output Format", "", "- old"
    ].join("\n"))
    const result = run<WriteResults>([
      "--check", "--policy", "claude-model-policy", "--model-id", "sonnet",
      "--lang", "ja", "--name", "claude-explorer", "--roles", "explore",
      "--dir", project
    ])
    expect(result.results[0]?.mcpCurrent.servers).toEqual(["mcp__serena"])
    expect(result.results[0]?.mcpCurrent.denyTools).toEqual([
      "mcp__serena__write_memory"
    ])
  })
})

describe("automaticKeep", () => {
  it("既存の mcp__ ツールを保持しない", () => {
    const file = path.join(project, ".claude", "agents", "claude-explorer.md")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, [
      "---", "name: claude-explorer", "description: old", "model: sonnet",
      "color: purple", "tools: Read, Grep, Glob, Bash, mcp__legacy",
      "agent-policy-role: explore", "---", "", "## Output Format", "", "- old"
    ].join("\n"))
    const result = run<WriteResults>([
      "--write", "--merge", "--policy", "claude-model-policy",
      "--model-id", "sonnet", "--lang", "ja", "--name", "claude-explorer",
      "--roles", "explore", "--dir", project
    ])
    expect(result.results[0]?.kept).not.toContain("tools:mcp__legacy")
    expect(fs.readFileSync(file, "utf8")).not.toContain("mcp__legacy")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts
```

- [ ] **Step 3: `parseArgs` へ残りのオプションを足し、検証を実装する**

`Options` へ `models: ModelId[]` / `mcpServers: string[]` / `mcpDeny: string[]` を足す。

```ts
      case "--models":
        options.models = splitList(requireValue(value, "models")) as ModelId[]
        index += 1
        break
      case "--mcp-servers":
        options.mcpServers = splitList(requireValue(value, "mcp-servers"))
        index += 1
        break
      case "--mcp-deny":
        options.mcpDeny = splitList(requireValue(value, "mcp-deny"))
        index += 1
        break
```

`splitList` はカンマ区切りを重複除去して返すヘルパーとして追加する。

必須チェックを次のように変える。`--merge` は `--models` と併用でき、`--keep` だけを単一指定時に限る。

```ts
  if (options.models.length > 0) {
    if (options.policy === "") throw new Error("policy: is required")
    if (options.keep.length > 0) {
      throw new Error("keep: cannot be used with --models")
    }
    return options
  }
  if (options.name === "") throw new Error("name: is required")
  if (options.modelId === "") throw new Error("model-id: is required")
  if (options.roles.length === 0) throw new Error("roles: is required")
```

検証関数を 2 つ足す。

```ts
function validateRoles(
  options: Options,
  policy: PolicyName,
  model: ModelSpec
): void {
  const allowed = new Set<string>(rolesFor(policy, model.id))
  // 組み込み役割だけを担当表で検証する。プロジェクト独自役割は担当表に
  // 現れないため、ここで弾くと既存利用者が setup を実行できなくなる。
  const invalid = options.roles.filter(
    (role) => roleById(role) !== undefined && !allowed.has(role)
  )
  if (invalid.length > 0) {
    throw new Error(
      `roles: ${invalid.join(", ")} is not assigned to ${model.id} in ${policy}`
    )
  }
}

// lang が ja / en 以外のときは翻訳断片が揃っていなければ止める。
// 揃っていないまま進むと、英語見出しの定義がその言語の指定で書かれる。
function validateFragments(options: Options): void {
  const status = checkFragments(pluginRoot(), options.dir, options.lang)
  if (status.missing.length === 0 && status.stale.length === 0) return
  throw new Error(
    `fragments: translation for "${options.lang}" is incomplete. missing=${status.missing.join(", ")} stale=${status.stale.map((entry) => entry.id).join(", ")}. Run --scaffold-fragments and translate them first`
  )
}
```

`--check` と `--write` の入口で `validateFragments(options)` を呼ぶ。

- [ ] **Step 4: `--models` による一括処理を実装する**

```ts
interface Target {
  modelId: ModelId
  name: string
  model: string
  roles: RoleId[]
  color: string
  vendor: Vendor
}

// --models は既定名・既定役割で複数を、--model-id は明示指定で 1 件を作る。
function targetsFor(options: Options, policy: PolicyName): Target[] {
  if (options.models.length > 0) {
    return options.models.map((id) => {
      const spec = modelById(id)
      if (spec === undefined) throw new Error(`models: ${id} is unknown`)
      if (!modelsFor(policy).some((entry) => entry.id === spec.id)) {
        throw new Error(`models: ${id} is not used in ${policy}`)
      }
      return {
        modelId: spec.id,
        name: spec.defaultName,
        model: resolveModelValue(spec, process.env),
        roles: rolesFor(policy, spec.id),
        color: spec.color,
        vendor: spec.vendor
      }
    })
  }

  const spec = requireModel(options, policy)
  validateRoles(options, policy, spec)
  return [
    {
      modelId: spec.id,
      name: options.name,
      model:
        options.model === ""
          ? resolveModelValue(spec, process.env)
          : options.model,
      roles: options.roles,
      color: spec.color,
      vendor: spec.vendor
    }
  ]
}

// color を必ず渡す。渡さないと COLORS[vendor] にフォールバックし、
// Claude 帯の 4 定義がすべて blue になる。
function composeInputFor(
  options: Options,
  target: Target,
  mcpServers: string[]
): ComposeInput {
  return {
    name: target.name,
    model: target.model,
    vendor: target.vendor,
    roleIds: target.roles,
    fragmentDirs: fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    lang: options.lang,
    color: target.color,
    mcpServers,
    denyTools: options.mcpDeny
  }
}
```

`diff` と `write` を `Target` ごとに回し、結果を `results` 配列で返す。各要素に `modelId` / `mcpCurrent` / `mcpDropped` を含める。

- [ ] **Step 5: MCP の付与と読み戻しを実装する**

```ts
// --mcp-servers で渡された名前のうち、claude mcp list で usable なものだけを
// tools へ書く。落としたものは mcpDropped として報告する。
function resolveMcp(options: Options): {
  servers: string[]
  dropped: string[]
} {
  if (options.mcpServers.length === 0) return { servers: [], dropped: [] }
  const usable = new Set(
    listMcpServers(process.env)
      .filter((server) => server.usable)
      .map((server) => server.name)
  )
  const servers: string[] = []
  const dropped: string[] = []
  for (const name of options.mcpServers) {
    if (usable.has(name)) servers.push(toolPrefix(name))
    else dropped.push(name)
  }
  return { servers, dropped }
}

// 前回の選択は既存定義から逆算する。専用の設定ファイルは持たない。
function mcpCurrentFor(file: string): McpCurrent {
  if (!fs.existsSync(file)) return { servers: [], denyTools: [] }
  return mcpCurrentOf(fs.readFileSync(file, "utf8"))
}
```

`mcp.ts` から `McpCurrent` / `mcpCurrentOf` / `toolPrefix` を import する。

- [ ] **Step 6: `automaticKeep` から `mcp__` と `disallowedTools` を除外する**

```ts
function automaticKeep(difference: Diff): string[] {
  return [
    ...difference.frontmatter.toolsOnlyInExisting
      // MCP の付与は --mcp-servers と再検証が決める。既存ファイルの内容を
      // 根拠に残すと、切断済みサーバーのツール名が生き残り続ける。
      .filter((tool) => !tool.startsWith("mcp__"))
      .map((tool) => `tools:${tool}`),
    ...difference.frontmatter.keysOnlyInExisting
      // disallowedTools も同じ理由で保持しない。
      .filter((key) => key !== "disallowedTools")
      .map((key) => `key:${key}`),
    ...difference.body.sectionsOnlyInExisting.map(
      (heading) => `section:${heading}`
    )
  ]
}
```

- [ ] **Step 7: テストを実行して通ることを確認する**

```bash
pnpm vitest run plugins/agent-policy/src/ && pnpm run typecheck && pnpm run lint
```

- [ ] **Step 8: ビルドして同梱プリセットが変わらないことを確認する**

```bash
pnpm run build && git diff --stat plugins/agent-policy/agents/
```

期待: 差分なし。

- [ ] **Step 9: コミット**

```bash
git add plugins/agent-policy/src/ plugins/agent-policy/scripts/
git commit -m "feat(agent-policy): 担当表の検証と一括生成と MCP 付与を CLI へ実装する"
```

---

### Task 11: `setup-agents` スキル

**Files:**
- Create: `plugins/agent-policy/skills/setup-agents/SKILL.md`
- Delete: `plugins/agent-policy/skills/setup-gpt/`
- Delete: `plugins/agent-policy/skills/setup-grok/`

**Interfaces:**
- Consumes: Task 7・9・10 の全サブコマンド
- Produces: `agent-policy:setup-agents` スキル

- [ ] **Step 1: `prompt-smith:skill-creator` スキルをロードする**

スキルの新規作成であるため、このスキルの規律に従う。description の作成と発火測定もここが担当する。

- [ ] **Step 2: frontmatter を書く**

```yaml
---
name: setup-agents
description: 4 つの運用方針(claude-model / with-codex / with-grok / codex-grok)で使う Agent 定義を、ポリシーとモデルと役割を選んでプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したとき、または SessionStart フックがエイリアス不一致を通知したときに必ず使用する。担当表上あり得ないモデルと役割の組み合わせは選べない。役割名の表示と生成される定義の本文はユーザーの使用言語に合わせる。接続済みの MCP サーバーを検出し、許可するものを選んで tools へ入れられる。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), Edit(**/.claude/agent-policy/roles/**), AskUserQuestion
disallowed-tools: Write
---
```

- [ ] **Step 3: 本文を書く**

設計書 §6.1 のステップ 0〜7 と §7.4 の MCP 対話を手順として書く。次を必ず含める。

**冒頭の規律**

- `.claude/agents/` のファイルは `Write` / `Edit` で直接編集せず、必ずスクリプトで書き込む
- `Edit` を使ってよいのは `.claude/agent-policy/roles/<lang>/` 配下の翻訳断片だけである
- 選択肢の個数規則 — 候補 0 件は質問しない、1 件は確認文で尋ねる、2〜4 件は 1 回の質問、5 件以上は 4 個ずつ分割して通し番号を添える

**ステップ 0(言語判定)**

会話でユーザーが使用している言語から `lang` を決め、ステップ 1 の冒頭で明示して変更の機会を与える。

**ステップ 1(ポリシー選択)**

`--list-policies` を実行する。応答の `injection` フィールドと `AMATSUKA_AGENT_AUTO_INJECTION` の値を突き合わせ、一致するポリシーを第一候補に置く。環境変数の値(`claude` など)とポリシー ID(`claude-model-policy` など)は別体系なので、`--policy` へ渡すのは必ず `id` の方である。

**ステップ 2(翻訳断片の準備)**

`lang` が `ja` / `en` 以外のときのみ。`--check-fragments --lang <l>` → `missing` / `stale` があれば `--scaffold-fragments --lang <l>` → 返ったパスを `Edit` で翻訳 → `--check-fragments` で再確認。

- 翻訳するのは本文と frontmatter の `label` / `description` のみ
- `id` / `kind` / `tools` / `source-lang` / `source-hash` は変更しない
- 節見出しは英語のまま保つ(合成器が見出しで節を突き合わせるため)
- `stale` のファイルは scaffold が英語ソースで上書きする。既存の訳が失われるため、実行前に内容を確認し、必要なら退避を促す

**ステップ 3(前提確認)**

GPT または Grok を含むポリシーのときのみ。満たせない場合も終了せず、該当ベンダーのモデルをステップ 4 の選択肢から外して続行する。除外した旨と、方針スキル側のフォールバック規定を報告に含める。

**ステップ 4(モデル選択)**

`--list-models --policy <p>`。既定は全モデル選択。件数規則に従って分割する。ベンダーで分割して 1 件だけのグループを作らない。

**ステップ 5(一括確認)**

`--check --policy <p> --lang <l> --models <選んだモデル>` を 1 回実行し、モデルごとに「既定名 / `model` 値 / 役割 / 既存の状態 / `mcpCurrent`」を一覧提示する。3 択(このまま作る / 一部を調整する / 中止)。

**ステップ 5b(個別調整)**

`--list-roles` の結果から役割を選ぶ。`languageMismatch` が `true` の役割には、プロジェクト独自断片が言語別断片より優先されるため元の言語のまま合成される旨を添える。定義名・`model` 値・`kind` 混在の警告・差分方針も決める。

**ステップ 5c(MCP)**

`--list-mcp` を実行。0 件なら何も聞かずに次へ。`usable: true` のサーバーを提示し、`mcpCurrent` があれば既定値にする。付与先の役割を決め(既定は実装役割 4 種)、読み取り役割へ付けるサーバーがあれば自身のツール一覧から編集・書き込み・削除系を列挙して `disallowedTools` 案を提示する。選んだサーバーが `_common.md` の制約と矛盾しないかを一度確認する。

**ステップ 6(生成)**

既定どおりのモデルは `--write --models ... --merge`、調整したモデルは個別に `--write --model-id ... --keep ...`。MCP は `--mcp-servers` と `--mcp-deny` で渡す。`--keep` は `--models` と併用できない。

**ステップ 7(報告)**

生成パス、`action` / `kept` / `discarded` / `keptNeedsReview`、`mcpDropped`、CLAUDE.md への追記文例、`.claude/agents/` の git 追跡はプロジェクト判断である旨、初回のみ再起動が要る旨。

**非対話モード**

`--yes` があればポリシーの全モデル・全役割を既定名で一括生成する。ポリシーは `--policy` 指定 → `AMATSUKA_AGENT_AUTO_INJECTION` の順で解決し、どちらでも決まらなければ質問せずエラーで終了する。`lang` が `ja` / `en` 以外で翻訳断片が未整備の場合もエラーで終了し、対話モードでの実行を案内する。

**表示言語の規則**

`lang` が `ja` なら `label`、`en` なら `id`、それ以外なら翻訳断片の `label` を表示に使う。

- [ ] **Step 4: 旧スキルを削除する**

```bash
git rm -r plugins/agent-policy/skills/setup-gpt plugins/agent-policy/skills/setup-grok
```

拒否された場合は絶対パスを提示してユーザーの手で実行してもらう。

- [ ] **Step 5: スキルが発火することを確認する**

新しいセッションで `/agent-policy:setup-agents` を実行し、ステップ 1 のポリシー選択まで到達することを確認する。

- [ ] **Step 6: コミット**

```bash
git add plugins/agent-policy/skills/
git commit -m "feat(agent-policy): setup-gpt と setup-grok を setup-agents へ統合する"
```

---

### Task 12: 移行

**Files:**
- Modify: `plugins/agent-policy/src/hooks/session-start.ts`
- Modify: `plugins/agent-policy/skills/*-policy/SKILL.md`(4 本)
- Modify: `plugins/agent-policy/assets/roles/ja/_common.md`
- Modify: `plugins/agent-policy/assets/roles/en/_common.md`
- Modify: `plugins/agent-policy/README.md`
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json`
- Modify: `plugins/agent-policy/package.json`
- Modify: `docs/development/cliproxyapi-setup.md`
- Modify: ルート `README.md`
- Test: `plugins/agent-policy/src/hooks/__test__/session-start.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: なし(移行のみ)

- [ ] **Step 1: 失敗するテストを書く**

既存ヘルパー `context(env)` と `place(name, frontmatter)` を使う。`build` という名前のヘルパーは存在しない。

```ts
describe("setup の案内先", () => {
  it("エイリアス不一致で setup-agents を案内する", () => {
    const injected = context({ AMATSUKA_AGENT_GROK_ALIAS: "custom-grok" })
    expect(injected).toContain("agent-policy:setup-agents")
    expect(injected).not.toContain("agent-policy:setup-grok")
  })
})

describe("labelOf の言語別ディレクトリ", () => {
  it("roles/<lang>/ に置いた独自役割の label を読む", () => {
    const dir = path.join(project, ".claude", "agent-policy", "roles", "de")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "triage.md"),
      "---\nid: triage\nlabel: Ersteinschatzung\nkind: readonly\n---\n"
    )
    place("de-triage", ["model: sonnet", "agent-policy-role: triage"])
    const injected = context()
    expect(injected).toContain("Ersteinschatzung")
    expect(injected).not.toContain("未知の役割 ID")
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
pnpm vitest run plugins/agent-policy/src/hooks/__test__/session-start.test.ts
```

- [ ] **Step 3: フックを修正する**

`ALIASES` の 4 件の `skill` を `"agent-policy:setup-agents"` へ変える。

`labelOf` のプロジェクト断片探索を、`roles/` 直下に加えて `roles/*/` も見る形へ変える。

```ts
  const base = path.join(projectDir, ".claude", "agent-policy", "roles")
  const candidates = [path.join(base, `${id}.md`)]
  try {
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(base, entry.name, `${id}.md`))
        }
      }
    }
  } catch {
    // 走査に失敗しても、直下の候補だけで解決を試みる。
  }

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const label = frontmatter(file).get("label")
      const resolved = label === "" ? undefined : label
      LABELS.set(id, resolved)
      return resolved
    } catch {
      // 1 ファイルが読めなくても、他の候補と方針注入は生かす。
    }
  }
```

同じ役割 ID が複数の言語ディレクトリにあるとき、`readdirSync` の順で先に見つかったものが使われる。フックは会話言語を知らないため、どれが選ばれるかは決まらない。README にこの制約を記す。

- [ ] **Step 4: 方針スキル 4 本の解決順を書き換える**

`prompt-smith:prompt-smith` スキルをロードしてから編集する。4 本の `## 実行帯の解決順` を次の形にそろえる。登場しないベンダー帯の行は各方針で削る。

```markdown
## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. SessionStart フックが役割マーカーで注入した定義があれば、その帯はそれを使う。
2. 注入が無い帯は、担当表のモデルで分岐する。
   - Claude 帯: dispatch 時の `model` 上書きで実行帯を指定して起動する。読み取り役割はビルトイン `Explore`、実装帯は `general-purpose` へ委譲する。
   - GPT 帯: プラグイン同梱の `agent-policy:gpt-sol` / `agent-policy:gpt-terra` / `agent-policy:gpt-luna` を使う。
   - Grok 帯: プラグイン同梱の `agent-policy:grok` を使う。
3. GPT / Grok をローカルプロキシ経由で呼び出せないときは、§フォールバック に従う。
```

`claude-model-policy` は Claude 帯の行だけを残し、ステップ 3 を削る。`with-codex-policy` は Grok 帯の行を削る。`with-grok-policy` は GPT 帯の行を削る。

`with-codex-policy` と `codex-grok-policy` のステップ 3 が指す「§フォールバック」は、現行の解決順 4 にある `codex@openai-codex` プラグインの案内を独立した節へ移して作る。

- [ ] **Step 5: `_common.md` の制約と相談先を書き換える**

`assets/roles/ja/_common.md` の `## 制約` の GitHub 行だけを置き換える。ブラウザ行は一般則の適用例として残す。

置換前:
```markdown
- GitHub への書き込み(PR 作成・レビュー投稿)は行わず、必要ならオーケストレーターへ報告する。
```

置換後:
```markdown
- 外部システムへの不可逆な副作用(公開・投稿・送信・書き込み)は行わず、必要ならオーケストレーターへ報告する。
```

`## アドバイザーへの相談` の 2 行目を置き換える。

置換前:
```markdown
- 相談相手は `Fable` サブエージェントとし、Fable を起動できないときは `Opus` サブエージェントにする。
```

置換後:
```markdown
- 担当表の「設計・計画・実装のアドバイザー」帯の定義を使う。プロジェクトに該当する定義があればその名前で、無ければ `model` 上書きで `Fable`(起動できないときは `Opus`)を指定して起動する。
```

`assets/roles/en/_common.md` は Task 5 で既にこの文面で書いてある。差異があれば揃える。

- [ ] **Step 6: ビルドして同梱プリセットの差分を確認する**

```bash
pnpm run build && git diff plugins/agent-policy/agents/
```

期待: 4 定義の `## 制約` と `## アドバイザーへの相談` が更新されている。

- [ ] **Step 7: README を改稿する**

`plugins/agent-policy/README.md` の次を更新する。

- 「エイリアスを変更する」節の `agent-policy:setup-gpt` / `setup-grok` を `setup-agents` へ
- 「役割を選んで自分の定義を作る」節を `setup-agents` 前提へ全面改稿(ポリシー選択・モデル選択・言語・MCP)
- 環境変数節に `CLAUDE_CODE_SUBAGENT_MODEL` が frontmatter の `model` を上書きする旨を追記
- WebSocket 経由の MCP サーバーは検出対象外である旨を追記
- SessionStart の役割マーカー表が日本語表記であり、同じ役割 ID が複数の言語ディレクトリにあるとどれが使われるか決まらない旨を追記
- 移行節に 5 項目を追加

```markdown
4. `setup-gpt` と `setup-grok` は `setup-agents` へ統合しました。ポリシーとモデルと役割を選んで複数の定義を一度に作れます。
5. 役割定義から `LSP` を外しました。背景で起動するサブエージェントでは Claude Code が `LSP` を除去するため、定義に書いても機能しません。
6. MCP ツールを付けられるようになりました。`claude mcp list` で接続済みのサーバーを検出し、許可するものを選ぶと `tools` へ入ります。既定では付きません。前回の選択は生成された定義から読み戻します。
7. `_common.md` の制約から GitHub の名指しを外し、「外部システムへの不可逆な副作用」という一般則へ書き換えました。この規律を外したい場合は `.claude/agent-policy/roles/_common.md` に `## 制約` 節を書いて差し替えてください。
8. 方針スキルの「実行帯の解決順」から、定義名による探索を外しました。プロジェクト定義は `agent-policy-role` マーカーで解決されます。マーカーを持たない手書きの定義は、マーカーを 1 行足してください。
```

- [ ] **Step 8: 他のドキュメントを追随させる**

`docs/development/cliproxyapi-setup.md` の `agent-policy:setup-gpt` / `setup-grok` を `agent-policy:setup-agents` へ置き換える。

ルート `README.md` の agent-policy の記述を確認し、スキル一覧に `setup-gpt` / `setup-grok` が載っていれば `setup-agents` へ直す。

- [ ] **Step 9: バージョンを上げる**

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.10.0-dev` にする。

- [ ] **Step 10: 全体の検証を通す**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
git status --short
```

期待: すべて成功し、`plugins/agent-policy/scripts/` と `plugins/agent-policy/agents/` の差分が残っている。

- [ ] **Step 11: コミット**

```bash
git add plugins/agent-policy/ docs/development/cliproxyapi-setup.md README.md
git commit -m "refactor(agent-policy): 解決順を役割ベースへ統一し移行を完了して 0.10.0-dev へ上げる"
```

- [ ] **Step 12: ARCHITECTURE を追随させる**

`assets/roles/<lang>/` という新しいレイアウトが ARCHITECTURE のディレクトリ構成に反映されていないため、`/metatron:update` を実行して追随させる。

---

## 完了条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` がすべて通る
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` と `plugins/agent-policy/agents/` の差分が同じコミットに含まれている
- `plugin.json` と `package.json` の `version` が `0.10.0-dev` で揃っている
- `plugins/agent-policy/README.md` とルート `README.md` と `docs/development/cliproxyapi-setup.md` が追随している
- `/metatron:update` で ARCHITECTURE のディレクトリ構成が追随している
- 新しいセッションで `/agent-policy:setup-agents` が発火し、ポリシー選択まで到達する
