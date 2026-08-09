# prompt-smith:skill-creator 移植 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anthropic 公式プラグイン `skill-creator` の description 改善ループを TypeScript へ移植し、測定の欠陥を直したうえで `prompt-smith` の独立スキル `skill-creator` として持つ。

**Architecture:** `claude -p` をサブプロセスで起動して発火を測る `run-trigger-eval`、失敗から description を提案させる `improve-description`、両者を反復して最良を選ぶ `run-loop`、結果を HTML にする `generate-report` の 4 本の CLI と、それらが共有する純関数群(`src/lib/`)で構成する。判定ロジックは実プロセスを起動しない純関数へ切り出し、vitest で固定入力から検証する。

**Tech Stack:** TypeScript / Node 26 / esbuild(バンドル) / vitest(テスト) / pnpm workspace

**設計書:** `docs/design/2026-08-09-prompt-smith-skill-creator-port-design.md`

**移植元:** `/home/hiro0209/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/`(Apache License 2.0, 著作権者 Anthropic)

## Global Constraints

- ソースは `plugins/prompt-smith/src/`、バンドル出力は `plugins/prompt-smith/scripts/` に置く。
- バンドル出力は git 管理する。`src/` を変更したら `pnpm build` を実行し、生成物の差分もコミットする。
- `ANTHROPIC_API_KEY` を前提とする実装を入れない。LLM の呼び出しは `claude` CLI のヘッドレス実行(`claude -p`)だけとする。
- 外部依存を足さない。Node 標準ライブラリだけで書く。
- 各移植ソースのヘッダに Apache-2.0 の boilerplate、Anthropic の著作権表示、移植元ファイル名、変更点を書く。
- バンドル出力にも esbuild の `banner` で同じ通知を載せる。
- SKILL.md の本文は `prompt-smith:prompt-smith` の基準で書く。根拠・出典・実測値は本文に書かず `plugins/prompt-smith/docs/` へ置く。
- `plugins/prompt-smith/.claude-plugin/plugin.json` の `version` は `0.3.0-dev` にする。
- esbuild の設定は `bundle: true` / `outdir: "./scripts"` / `outExtension: { ".js": ".mjs" }` / `platform: "node"` / `format: "esm"` / `sourcemap: false` とする。
- CLI の既定値は移植元どおりとする。`--runs-per-query 3` / `--num-workers 10` / `--timeout 30` / `--trigger-threshold 0.5` / `--holdout 0.4` / `--max-iterations 5` / 分割の seed は 42。
- テストで `claude -p` を実起動しない。プロセス起動部分は差し替え可能にする。
- テストは `plugins/prompt-smith/src/__test__/*.test.ts` に置く。実行はリポジトリルートから `pnpm exec vitest run <パス>`。
- コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `plugins/prompt-smith/LICENSE` | Apache-2.0 全文 |
| `plugins/prompt-smith/NOTICE` | 帰属と変更点の一覧 |
| `plugins/prompt-smith/package.json` | ワークスペースのパッケージ定義 |
| `plugins/prompt-smith/build.ts` | esbuild によるバンドル |
| `src/lib/types.ts` | 複数のファイルが共有する型。実装を持たない |
| `src/lib/parse-skill-md.ts` | SKILL.md の frontmatter から `name` と `description` を取り出す |
| `src/lib/stream-parse.ts` | `claude -p` の stream-json 行を読み、発火の有無を判定する状態機械 |
| `src/lib/sandbox.ts` | 測定用の一時ディレクトリと SKILL.md を作る。description の差し替えもここが担う |
| `src/lib/split-eval-set.ts` | seed 付き PRNG と層化分割 |
| `src/lib/pool.ts` | 並列実行のワーカープール |
| `src/lib/claude-cli.ts` | `claude -p` の起動と環境の記録 |
| `src/run-trigger-eval.ts` | 発火測定の CLI |
| `src/improve-description.ts` | description の改善案を得る CLI |
| `src/run-loop.ts` | 測定と改善の反復 CLI |
| `src/generate-report.ts` | 反復結果の HTML |
| `skills/skill-creator/SKILL.md` | スキル本文 |
| `skills/skill-creator/assets/eval-review.html` | eval セットのレビュー UI |
| `evals/*.json` | 3 スキルの eval セット |
| `docs/skill-creator-port-rationale.md` | 根拠・実測・移植前の姿 |

---

### Task 1: ライセンス表示とパッケージ基盤

移植コードを 1 行も置く前に、ライセンス表示を済ませる。

**Files:**
- Create: `plugins/prompt-smith/LICENSE`
- Create: `plugins/prompt-smith/NOTICE`
- Create: `plugins/prompt-smith/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `plugins/prompt-smith/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: なし
- Produces: `prompt-smith-scripts` というワークスペースパッケージ。この時点では `build` スクリプトを持たない(`pnpm -r build` はスクリプトのないパッケージを飛ばす)

- [ ] **Step 1: Apache-2.0 の全文をコピーする**

```bash
cp /home/hiro0209/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/LICENSE \
   plugins/prompt-smith/LICENSE
```

- [ ] **Step 2: NOTICE を書く**

`plugins/prompt-smith/NOTICE` に次を書く。

```
prompt-smith
Copyright 2026 amatsuka-koubou

This product includes software developed by Anthropic, PBC.

Portions of plugins/prompt-smith/src/ are a TypeScript port of the
"skill-creator" Claude Code plugin (Apache License, Version 2.0),
Copyright Anthropic, PBC. The original is available at:
https://github.com/anthropics/claude-code (plugins/skill-creator)

Ported on 2026-08-09. The upstream source carries no NOTICE file;
this file is provided as an attribution convenience, not to satisfy
Section 4(d) of the License.

Changes made to the ported code
-------------------------------
run_eval.py -> src/run-trigger-eval.ts
  1. The measured skill is registered as <tmp>/.claude/skills/<name>/SKILL.md
     instead of <project>/.claude/commands/<name>.md, with
     disable-model-invocation set to false.
  2. Trigger matching uses a "<skill-name>-skill-" prefix instead of the
     full unique name.
  3. The working directory is a per-run temporary directory instead of the
     repository root returned by find_project_root(). find_project_root()
     is not ported.
  4. Only the Skill tool counts as a trigger. The Read tool does not.
  5. Added: the result JSON records an "environment" object (base URL,
     the NAME of the auth environment variable, and model). No secret
     values are recorded.
  6. Added: an optional --out flag. Without it the JSON goes to stdout,
     as upstream does.
  7. The results array is ordered by the eval set, not by completion order.
     The keys and values are unchanged.
  8. The measured description is applied to the SKILL.md frontmatter before
     staging, because this port copies the whole SKILL.md rather than
     building a file from the description alone.

run_loop.py -> src/run-loop.ts
  9. split_eval_set uses a seeded PRNG implemented in this project instead
     of Python's random module. The shuffle is deterministic across runs
     but does not reproduce Python's sequence.

improve_description.py -> src/improve-description.ts
  No behavioural changes. The English prompt is carried over verbatim.

generate_report.py -> src/generate-report.ts
  10. The Google Fonts <link> tags are dropped and replaced with a system
      font stack, so the report renders without network access.

utils.py -> src/lib/parse-skill-md.ts
  No behavioural changes.

assets/eval_review.html -> skills/skill-creator/assets/eval-review.html
  No behavioural changes.

Not ported: aggregate_benchmark.py, package_skill.py, quick_validate.py,
eval-viewer/generate_review.py, agents/*.md.

An earlier design document for this repository (2026-08-02) decided to
reimplement rather than port. That decision was reversed on 2026-08-09.
```

- [ ] **Step 3: package.json を書く**

```json
{
  "name": "prompt-smith-scripts",
  "version": "0.3.0-dev",
  "private": true,
  "type": "module"
}
```

`build` スクリプトはまだ書かない。`build.ts` が無い状態で `pnpm -r build` を壊さないためである。Task 5 で追加する。

- [ ] **Step 4: workspace に登録する**

`pnpm-workspace.yaml` の `packages` へ `  - plugins/prompt-smith` を追加する。

- [ ] **Step 5: plugin.json のバージョンを上げる**

`plugins/prompt-smith/.claude-plugin/plugin.json` の `"version"` を `"0.2.0-dev"` から `"0.3.0-dev"` にする。

- [ ] **Step 6: workspace が認識されることを確かめる**

Run: `pnpm -r list --depth -1 2>&1 | grep prompt-smith-scripts`
Expected: `prompt-smith-scripts@0.3.0-dev` が表示される

- [ ] **Step 7: 既存のビルドが壊れていないことを確かめる**

Run: `pnpm build`
Expected: 既存 9 プラグインのビルドが成功する。`prompt-smith-scripts` は build スクリプトを持たないため飛ばされる

- [ ] **Step 8: Commit**

```bash
git add plugins/prompt-smith/LICENSE plugins/prompt-smith/NOTICE \
        plugins/prompt-smith/package.json plugins/prompt-smith/.claude-plugin/plugin.json \
        pnpm-workspace.yaml
git commit -m "$(cat <<'EOF'
chore(prompt-smith): Apache-2.0 表示とパッケージ基盤を追加 (0.3.0-dev)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: parse-skill-md

**Files:**
- Create: `plugins/prompt-smith/src/lib/parse-skill-md.ts`
- Test: `plugins/prompt-smith/src/__test__/parse-skill-md.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface ParsedSkill { name: string; description: string; content: string }`
  - `function parseSkillMd(content: string): ParsedSkill`

- [ ] **Step 1: Write the failing test**

`plugins/prompt-smith/src/__test__/parse-skill-md.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseSkillMd } from "../lib/parse-skill-md.js"

describe("parseSkillMd", () => {
  it("単一行の name と description を取り出す", () => {
    const md = ["---", "name: my-skill", "description: does a thing", "---", "", "body"].join("\n")
    const parsed = parseSkillMd(md)
    expect(parsed.name).toBe("my-skill")
    expect(parsed.description).toBe("does a thing")
    expect(parsed.content).toBe(md)
  })

  it("引用符を剥がす", () => {
    const md = ["---", 'name: "my-skill"', "description: 'does a thing'", "---", ""].join("\n")
    const parsed = parseSkillMd(md)
    expect(parsed.name).toBe("my-skill")
    expect(parsed.description).toBe("does a thing")
  })

  it.each([">", "|", ">-", "|-"])("ブロックスカラー %s の継続行を連結する", (indicator) => {
    const md = [
      "---",
      "name: my-skill",
      `description: ${indicator}`,
      "  first line",
      "  second line",
      "---",
      "",
    ].join("\n")
    expect(parseSkillMd(md).description).toBe("first line second line")
  })

  it("タブ字下げの継続行も連結する", () => {
    const md = ["---", "name: s", "description: |", "\tfirst", "\tsecond", "---", ""].join("\n")
    expect(parseSkillMd(md).description).toBe("first second")
  })

  it("開始の --- が無いとき例外を投げる", () => {
    expect(() => parseSkillMd("name: x\n")).toThrow(/no opening/)
  })

  it("終了の --- が無いとき例外を投げる", () => {
    expect(() => parseSkillMd("---\nname: x\n")).toThrow(/no closing/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/parse-skill-md.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/parse-skill-md.js"`

- [ ] **Step 3: Write minimal implementation**

`plugins/prompt-smith/src/lib/parse-skill-md.ts`:

```ts
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * This file is a TypeScript port of scripts/utils.py from the skill-creator
 * Claude Code plugin. No behavioural changes.
 */

export interface ParsedSkill {
  name: string
  description: string
  content: string
}

/** Python の str.strip(ch) と同じく、先頭と末尾の ch をすべて剥がす。 */
function stripChar(value: string, ch: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === ch) start++
  while (end > start && value[end - 1] === ch) end--
  return value.slice(start, end)
}

function unquote(value: string): string {
  return stripChar(stripChar(value, '"'), "'")
}

const BLOCK_SCALARS = new Set([">", "|", ">-", "|-"])

export function parseSkillMd(content: string): ParsedSkill {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)")
  }

  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)")
  }

  const frontmatter = lines.slice(1, endIdx)
  let name = ""
  let description = ""
  let i = 0

  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (line.startsWith("name:")) {
      name = unquote(line.slice("name:".length).trim())
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim()
      if (BLOCK_SCALARS.has(value)) {
        const continuation: string[] = []
        i++
        while (i < frontmatter.length && (frontmatter[i].startsWith("  ") || frontmatter[i].startsWith("\t"))) {
          continuation.push(frontmatter[i].trim())
          i++
        }
        description = continuation.join(" ")
        continue
      }
      description = unquote(value)
    }
    i++
  }

  return { name, description, content }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/parse-skill-md.test.ts`
Expected: PASS(9 件)

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/src/lib/parse-skill-md.ts \
        plugins/prompt-smith/src/__test__/parse-skill-md.test.ts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): SKILL.md の frontmatter パーサを移植

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 発火判定の状態機械

`claude -p --output-format stream-json --include-partial-messages` が吐く 1 行を受け取り、最初のツール呼び出しだけを見て発火の有無を確定させる。実プロセスを起動しないので、固定の JSON 行から検証できる。

**Files:**
- Create: `plugins/prompt-smith/src/lib/stream-parse.ts`
- Test: `plugins/prompt-smith/src/__test__/stream-parse.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `class TriggerDetector { constructor(prefix: string); push(line: string): boolean | null }`
  - `function judge(triggerRate: number, shouldTrigger: boolean, threshold: number): boolean`

`push` は判定が確定した行で `true` / `false` を返し、確定していない間は `null` を返す。呼び出し側は `null` 以外が返った時点で読むのをやめてプロセスを kill する。

- [ ] **Step 1: Write the failing test**

`plugins/prompt-smith/src/__test__/stream-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { judge, TriggerDetector } from "../lib/stream-parse.js"

const streamEvent = (event: unknown) => JSON.stringify({ type: "stream_event", event })

const blockStart = (toolName: string) =>
  streamEvent({ type: "content_block_start", content_block: { type: "tool_use", name: toolName } })

const delta = (partial: string) =>
  streamEvent({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: partial } })

const blockStop = () => streamEvent({ type: "content_block_stop" })
const messageStop = () => streamEvent({ type: "message_stop" })

describe("TriggerDetector", () => {
  it("関係のない行では確定しない", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(streamEvent({ type: "message_start" }))).toBeNull()
    expect(d.push("")).toBeNull()
    expect(d.push("not json")).toBeNull()
  })

  it("Skill 以外のツールが最初に来たら発火せずで確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(blockStart("Bash"))).toBe(false)
  })

  it("Skill の入力に接頭辞が現れたら発火で確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(blockStart("Skill"))).toBeNull()
    expect(d.push(delta('{"skill": "my-skill-'))).toBeNull()
    expect(d.push(delta('skill-ab12cd34"}'))).toBe(true)
  })

  it("接頭辞は前方一致で判定し、hash は問わない", () => {
    const d = new TriggerDetector("my-skill-skill-")
    d.push(blockStart("Skill"))
    expect(d.push(delta('{"skill": "my-skill-skill-ffffffff"}'))).toBe(true)
  })

  it("別スキルを呼んだら content_block_stop で発火せずに確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    d.push(blockStart("Skill"))
    d.push(delta('{"skill": "other-skill"}'))
    expect(d.push(blockStop())).toBe(false)
  })

  it("Skill が来ないまま message_stop なら発火せず", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(messageStop())).toBe(false)
  })

  it("assistant メッセージのフォールバックで Skill を見る", () => {
    const d = new TriggerDetector("my-skill-skill-")
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "my-skill-skill-0011" } }] },
    })
    expect(d.push(line)).toBe(true)
  })

  it("フォールバックで Read は発火とみなさない", () => {
    const d = new TriggerDetector("my-skill-skill-")
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/my-skill-skill-0011/SKILL.md" } }],
      },
    })
    expect(d.push(line)).toBe(false)
  })

  it("result で確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(JSON.stringify({ type: "result" }))).toBe(false)
  })
})

describe("judge", () => {
  it.each([
    [1.0, true, 0.5, true],
    [0.5, true, 0.5, true],
    [0.34, true, 0.5, false],
    [0.0, false, 0.5, true],
    [0.34, false, 0.5, true],
    [0.5, false, 0.5, false],
    [1.0, false, 0.5, false],
  ])("rate=%s should=%s threshold=%s -> %s", (rate, should, threshold, expected) => {
    expect(judge(rate, should, threshold)).toBe(expected)
  })
})
```

`judge` の 5 番目のケース(`rate=0.34`, `should=false` で合格)が、移植元どおり `trigger_rate < threshold` である証拠になる。旧リポジトリ実装の「発火率 0 でのみ合格」ならここが落ちる。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/stream-parse.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/stream-parse.js"`

- [ ] **Step 3: Write minimal implementation**

`plugins/prompt-smith/src/lib/stream-parse.ts`:

```ts
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * This file is a TypeScript port of the stream detection logic in
 * scripts/run_eval.py from the skill-creator Claude Code plugin.
 *
 * Changes: only the Skill tool counts as a trigger (upstream also accepted
 * Read), and matching uses a name prefix instead of the full unique name.
 */

export function judge(triggerRate: number, shouldTrigger: boolean, threshold: number): boolean {
  return shouldTrigger ? triggerRate >= threshold : triggerRate < threshold
}

export class TriggerDetector {
  private pendingSkillTool = false
  private accumulated = ""

  constructor(private readonly prefix: string) {}

  /** 判定が確定したら true/false、確定していなければ null を返す。 */
  push(line: string): boolean | null {
    const trimmed = line.trim()
    if (trimmed === "") return null

    let event: Record<string, unknown>
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return null
    }

    if (event.type === "stream_event") {
      return this.pushStreamEvent((event.event ?? {}) as Record<string, unknown>)
    }
    if (event.type === "assistant") {
      return this.pushAssistant(event)
    }
    if (event.type === "result") {
      return false
    }
    return null
  }

  private pushStreamEvent(se: Record<string, unknown>): boolean | null {
    const seType = se.type

    if (seType === "content_block_start") {
      const block = (se.content_block ?? {}) as Record<string, unknown>
      if (block.type !== "tool_use") return null
      if (block.name === "Skill") {
        this.pendingSkillTool = true
        this.accumulated = ""
        return null
      }
      return false
    }

    if (seType === "content_block_delta" && this.pendingSkillTool) {
      const delta = (se.delta ?? {}) as Record<string, unknown>
      if (delta.type === "input_json_delta") {
        this.accumulated += String(delta.partial_json ?? "")
        if (this.accumulated.includes(this.prefix)) return true
      }
      return null
    }

    if (seType === "content_block_stop" || seType === "message_stop") {
      if (this.pendingSkillTool) return this.accumulated.includes(this.prefix)
      if (seType === "message_stop") return false
      return null
    }

    return null
  }

  private pushAssistant(event: Record<string, unknown>): boolean | null {
    const message = (event.message ?? {}) as Record<string, unknown>
    const content = (message.content ?? []) as Array<Record<string, unknown>>
    for (const item of content) {
      if (item.type !== "tool_use") continue
      if (item.name !== "Skill") return false
      const input = (item.input ?? {}) as Record<string, unknown>
      return String(input.skill ?? "").includes(this.prefix)
    }
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/stream-parse.test.ts`
Expected: PASS(16 件)

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/src/lib/stream-parse.ts \
        plugins/prompt-smith/src/__test__/stream-parse.test.ts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 発火判定の状態機械を移植

Skill ツールのみを発火とみなし、名前は前方一致で照合する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: サンドボックスの構築

**Files:**
- Create: `plugins/prompt-smith/src/lib/sandbox.ts`
- Test: `plugins/prompt-smith/src/__test__/sandbox.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `function buildSandboxSkillMd(original: string, cleanName: string): string`
  - `function replaceDescription(original: string, description: string): string`
  - `function makeCleanName(skillName: string): string`
  - `function createSandbox(skillMd: string, cleanName: string): Promise<Sandbox>`
  - `interface Sandbox { dir: string; cleanup(): Promise<void> }`

`replaceDescription` は改善ループが要求する。移植元は description 文字列だけからコマンドファイルを組み立てる(`run_eval.py:58-68`)ので、反復ごとに新しい description が自然に反映される。本移植は SKILL.md 全文をサンドボックスへ書くため、**反復ごとに frontmatter の description を差し替えないと、改善した description が測定に届かない**。

- [ ] **Step 1: Write the failing test**

`plugins/prompt-smith/src/__test__/sandbox.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildSandboxSkillMd, createSandbox, makeCleanName, replaceDescription } from "../lib/sandbox.js"

describe("buildSandboxSkillMd", () => {
  it("name を差し替える", () => {
    const md = ["---", "name: my-skill", "description: d", "---", "", "body"].join("\n")
    const out = buildSandboxSkillMd(md, "my-skill-skill-abcd1234")
    expect(out).toContain("name: my-skill-skill-abcd1234")
    expect(out).not.toContain("name: my-skill\n")
  })

  it("disable-model-invocation が無ければ足す", () => {
    const md = ["---", "name: s", "description: d", "---", "", "body"].join("\n")
    const out = buildSandboxSkillMd(md, "s-skill-1")
    expect(out).toContain("disable-model-invocation: false")
    expect(out.match(/disable-model-invocation/g)).toHaveLength(1)
  })

  it("disable-model-invocation: true があれば置換し、二重に書かない", () => {
    const md = ["---", "name: s", "description: d", "disable-model-invocation: true", "---", "", "body"].join("\n")
    const out = buildSandboxSkillMd(md, "s-skill-1")
    expect(out).toContain("disable-model-invocation: false")
    expect(out).not.toContain("disable-model-invocation: true")
    expect(out.match(/disable-model-invocation/g)).toHaveLength(1)
  })

  it("本文と他の frontmatter を触らない", () => {
    const md = ["---", "name: s", "description: d", "allowed-tools: Read", "---", "", "# body", "text"].join("\n")
    const out = buildSandboxSkillMd(md, "s-skill-1")
    expect(out).toContain("allowed-tools: Read")
    expect(out).toContain("# body")
    expect(out).toContain("text")
  })
})

describe("replaceDescription", () => {
  // 値は JSON の文字列書式で書く。YAML のダブルクォート文字列は JSON と互換なので、
  // コロン・引用符・改行を含む description をそのまま安全に置ける。
  it("単一行の description を差し替える", () => {
    const md = ["---", "name: s", "description: old text", "---", "", "body"].join("\n")
    const out = replaceDescription(md, "new text")
    expect(out).toContain('description: "new text"')
    expect(out).not.toContain("old text")
    expect(out).toContain("name: s")
    expect(out).toContain("body")
  })

  it("ブロックスカラーの description を単一行へ畳んで差し替える", () => {
    const md = ["---", "name: s", "description: |", "  line one", "  line two", "---", "", "body"].join("\n")
    const out = replaceDescription(md, "new text")
    expect(out).toContain('description: "new text"')
    expect(out).not.toContain("line one")
    expect(out).not.toContain("line two")
    expect(out).toContain("body")
  })

  it("ブロックスカラー内の空行を越えて継続行を読み飛ばす", () => {
    const md = [
      "---",
      "name: s",
      "description: |",
      "  para one",
      "",
      "  para two",
      "other: kept",
      "---",
      "",
      "body",
    ].join("\n")
    const out = replaceDescription(md, "new text")
    expect(out).toContain('description: "new text"')
    expect(out).not.toContain("para one")
    expect(out).not.toContain("para two")
    expect(out).toContain("other: kept")
    expect(out).toContain("body")
  })

  it("コロンや引用符を含む description を壊さずに書く", () => {
    const md = ["---", "name: s", "description: old", "---", "", "body"].join("\n")
    const original = 'Use this: "always", even when unclear'
    const out = replaceDescription(md, original)
    const line = out.split("\n").find((l) => l.startsWith("description:"))
    expect(line).toBe(`description: ${JSON.stringify(original)}`)
    // 内側の引用符が escape され、YAML の 1 行として閉じている。
    expect(line).toBe('description: "Use this: \\"always\\", even when unclear"')
  })

  it("本文の description という語には触らない", () => {
    const md = ["---", "name: s", "description: old", "---", "", "description: not frontmatter"].join("\n")
    const out = replaceDescription(md, "new")
    expect(out).toContain("description: not frontmatter")
  })
})

describe("makeCleanName", () => {
  it("<name>-skill-<8桁hex> を作る", () => {
    expect(makeCleanName("my-skill")).toMatch(/^my-skill-skill-[0-9a-f]{8}$/)
  })

  it("呼ぶたびに違う hash になる", () => {
    expect(makeCleanName("s")).not.toBe(makeCleanName("s"))
  })
})

describe("createSandbox", () => {
  it("SKILL.md を .claude/skills/<cleanName>/ に置く", async () => {
    const sandbox = await createSandbox("---\nname: x\n---\n", "x-skill-0000ffff")
    const path = join(sandbox.dir, ".claude", "skills", "x-skill-0000ffff", "SKILL.md")
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf8")).toContain("name: x")
    await sandbox.cleanup()
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it("祖先に .claude を持たない場所に作る", async () => {
    const sandbox = await createSandbox("---\nname: x\n---\n", "x-skill-0000ffff")
    let current = join(sandbox.dir, "..")
    const seen: string[] = []
    for (let i = 0; i < 20; i++) {
      seen.push(join(current, ".claude"))
      const parent = join(current, "..")
      if (parent === current) break
      current = parent
    }
    expect(seen.filter((p) => existsSync(p))).toEqual([])
    await sandbox.cleanup()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/sandbox.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/sandbox.js"`

- [ ] **Step 3: Write minimal implementation**

`plugins/prompt-smith/src/lib/sandbox.ts`:

```ts
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Replaces the command-file staging in scripts/run_eval.py from the
 * skill-creator Claude Code plugin. Upstream wrote a slash-command file into
 * the real project's .claude/commands/; this writes a project skill into a
 * per-run temporary directory instead.
 */

import { randomBytes } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface Sandbox {
  dir: string
  cleanup(): Promise<void>
}

export function makeCleanName(skillName: string): string {
  return `${skillName}-skill-${randomBytes(4).toString("hex")}`
}

interface FrontmatterSplit {
  frontmatter: string[]
  body: string[]
}

/** frontmatter の境界を 1 箇所で解く。書き換え関数はどちらもこれを使う。 */
function splitFrontmatter(original: string): FrontmatterSplit {
  const lines = original.split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)")
  }

  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)")
  }

  return { frontmatter: lines.slice(1, endIdx), body: lines.slice(endIdx + 1) }
}

function joinFrontmatter(frontmatter: string[], body: string[]): string {
  return ["---", ...frontmatter, "---", ...body].join("\n")
}

export function buildSandboxSkillMd(original: string, cleanName: string): string {
  const { frontmatter, body } = splitFrontmatter(original)
  let sawInvocationKey = false

  const rewritten = frontmatter.map((line) => {
    if (line.startsWith("name:")) return `name: ${cleanName}`
    if (line.startsWith("disable-model-invocation:")) {
      sawInvocationKey = true
      return "disable-model-invocation: false"
    }
    return line
  })

  if (!sawInvocationKey) rewritten.push("disable-model-invocation: false")

  return joinFrontmatter(rewritten, body)
}

/**
 * frontmatter の description を差し替える。ブロックスカラーは単一行へ畳む。
 * 改善ループが反復ごとに新しい description で測るために要る。
 */
const BLOCK_SCALARS = new Set([">", "|", ">-", "|-"])

export function replaceDescription(original: string, description: string): string {
  const { frontmatter, body } = splitFrontmatter(original)
  const rewritten: string[] = []
  let i = 0
  let replaced = false

  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (!line.startsWith("description:")) {
      rewritten.push(line)
      i++
      continue
    }

    const value = line.slice("description:".length).trim()
    i++
    if (BLOCK_SCALARS.has(value)) {
      // 継続行は字下げされた行である。段落を分ける空行も同じブロックの一部なので飛ばす。
      // 終わりは、字下げのない非空行(次のキー)か frontmatter の末尾とする。
      while (i < frontmatter.length) {
        const next = frontmatter[i]
        if (next.trim() === "") {
          i++
          continue
        }
        if (next.startsWith("  ") || next.startsWith("\t")) {
          i++
          continue
        }
        break
      }
    }
    rewritten.push(`description: ${JSON.stringify(description)}`)
    replaced = true
  }

  if (!replaced) rewritten.push(`description: ${JSON.stringify(description)}`)

  return joinFrontmatter(rewritten, body)
}

export async function createSandbox(skillMd: string, cleanName: string): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "prompt-smith-eval-"))
  const skillDir = join(dir, ".claude", "skills", cleanName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8")
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/sandbox.test.ts`
Expected: PASS(12 件)

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/src/lib/sandbox.ts \
        plugins/prompt-smith/src/__test__/sandbox.test.ts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 測定用サンドボックスの構築を追加

.claude/skills/ へ登録し、disable-model-invocation を false にする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 発火測定 CLI とビルド

このタスクで初めて `build.ts` を作る。バンドル出力が生まれるので、`banner` によるライセンス通知もここで入る。

**Files:**
- Create: `plugins/prompt-smith/src/lib/types.ts`
- Create: `plugins/prompt-smith/src/lib/pool.ts`
- Create: `plugins/prompt-smith/src/lib/claude-cli.ts`
- Create: `plugins/prompt-smith/src/run-trigger-eval.ts`
- Create: `plugins/prompt-smith/build.ts`
- Create: `plugins/prompt-smith/scripts/run-trigger-eval.mjs`(ビルド生成物)
- Test: `plugins/prompt-smith/src/__test__/pool.test.ts`
- Test: `plugins/prompt-smith/src/__test__/claude-cli.test.ts`
- Modify: `plugins/prompt-smith/package.json`

**Interfaces:**
- Consumes: `parseSkillMd`, `TriggerDetector`, `judge`, `buildSandboxSkillMd`, `makeCleanName`, `createSandbox`
- Produces:
  - `function pool<T, R>(items: T[], workers: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`
  - `function buildEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`
  - `function describeEnvironment(model: string | undefined, env?: NodeJS.ProcessEnv): Environment`
  - `function callClaudeText(prompt: string, model: string | undefined, timeoutSeconds?: number): Promise<string>` — Task 7 の `improveDescription` が既定の呼び出し口として使う
  - `interface Environment { base_url: string; auth_source: string; model: string | null }`
  - `interface EvalItem { query: string; should_trigger: boolean }`
  - `interface EvalResultItem { query: string; should_trigger: boolean; trigger_rate: number; triggers: number; runs: number; pass: boolean }`
  - `interface EvalResult { skill_name: string; description: string; environment: Environment; results: EvalResultItem[]; summary: { total: number; passed: number; failed: number } }`
  - `function runEval(options: RunEvalOptions): Promise<EvalResult>`

- [ ] **Step 1: Write the failing test for pool と環境記録**

`plugins/prompt-smith/src/__test__/pool.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { pool } from "../lib/pool.js"

describe("pool", () => {
  it("入力の順序どおりに結果を返す", async () => {
    const out = await pool([10, 20, 30], 2, async (n) => n * 2)
    expect(out).toEqual([20, 40, 60])
  })

  it("同時実行数が上限を超えない", async () => {
    let running = 0
    let peak = 0
    await pool([1, 2, 3, 4, 5, 6], 2, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return null
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it("空の入力で空を返す", async () => {
    expect(await pool([], 4, async () => 1)).toEqual([])
  })
})
```

`plugins/prompt-smith/src/__test__/claude-cli.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildEnv, describeEnvironment } from "../lib/claude-cli.js"

describe("buildEnv", () => {
  it("CLAUDECODE を落とす", () => {
    expect(buildEnv({ CLAUDECODE: "1", PATH: "/bin" })).toEqual({ PATH: "/bin" })
  })
})

describe("describeEnvironment", () => {
  it("base_url と認証変数の名前を記録する", () => {
    const env = describeEnvironment("claude-opus-5", {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
      ANTHROPIC_AUTH_TOKEN: "secret-value",
    })
    expect(env).toEqual({
      base_url: "http://127.0.0.1:8317",
      auth_source: "ANTHROPIC_AUTH_TOKEN",
      model: "claude-opus-5",
    })
  })

  it("値そのものは記録しない", () => {
    const env = describeEnvironment(undefined, { ANTHROPIC_API_KEY: "sk-do-not-log" })
    expect(JSON.stringify(env)).not.toContain("sk-do-not-log")
    expect(env.auth_source).toBe("ANTHROPIC_API_KEY")
  })

  it("未設定なら既定の表記にする", () => {
    expect(describeEnvironment(undefined, {})).toEqual({
      base_url: "(default)",
      auth_source: "(claude.ai login)",
      model: null,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/pool.test.ts plugins/prompt-smith/src/__test__/claude-cli.test.ts`
Expected: FAIL — 両方とも import が解決できない

- [ ] **Step 3: Write pool.ts**

```ts
/** Copyright 2026 amatsuka-koubou. Licensed under the Apache License, Version 2.0.
 *  Replaces the ProcessPoolExecutor usage in scripts/run_eval.py from the
 *  skill-creator Claude Code plugin.
 */

export async function pool<T, R>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const limit = Math.max(1, Math.min(workers, items.length))

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
```

- [ ] **Step 4: Write claude-cli.ts**

```ts
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0.
 *
 * Ported from the subprocess handling in scripts/run_eval.py and
 * scripts/improve_description.py of the skill-creator Claude Code plugin.
 *
 * Added: describeEnvironment records which auth path was used. Only the NAME
 * of the environment variable is recorded, never its value.
 */

import { spawn } from "node:child_process"

export interface Environment {
  base_url: string
  auth_source: string
  model: string | null
}

const AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const

export function buildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key === "CLAUDECODE") continue
    copy[key] = value
  }
  return copy
}

export function describeEnvironment(
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Environment {
  const authSource = AUTH_VARS.find((name) => env[name]) ?? "(claude.ai login)"
  return {
    base_url: env.ANTHROPIC_BASE_URL ?? "(default)",
    auth_source: authSource,
    model: model ?? null,
  }
}

/** `claude -p` を text 出力で 1 回呼び、標準出力を返す。プロンプトは stdin へ渡す。 */
export async function callClaudeText(
  prompt: string,
  model: string | undefined,
  timeoutSeconds = 300,
): Promise<string> {
  const args = ["-p", "--output-format", "text"]
  if (model) args.push("--model", model)

  return await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { env: buildEnv() })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`claude -p timed out after ${timeoutSeconds}s`))
    }, timeoutSeconds * 1000)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}\nstderr: ${stderr}`))
        return
      }
      resolve(stdout)
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/pool.test.ts plugins/prompt-smith/src/__test__/claude-cli.test.ts`
Expected: PASS(7 件)

- [ ] **Step 6: Write types.ts**

```ts
export interface EvalItem {
  query: string
  should_trigger: boolean
}

export interface EvalResultItem extends EvalItem {
  trigger_rate: number
  triggers: number
  runs: number
  pass: boolean
}

export interface EvalSummary {
  total: number
  passed: number
  failed: number
}

import type { Environment } from "./claude-cli.js"

export type { Environment }

export interface EvalResult {
  skill_name: string
  description: string
  environment: Environment
  results: EvalResultItem[]
  summary: EvalSummary
}

export interface RunEvalOptions {
  evalSet: EvalItem[]
  skillName: string
  skillContent: string
  description: string
  runsPerQuery: number
  numWorkers: number
  timeout: number
  triggerThreshold: number
  model?: string
  verbose?: boolean
}
```

`Environment` の定義は Step 4 で書いた `claude-cli.ts` に置いたままにし、`types.ts` は import して re-export する。`export type { X } from "..."` だけでは局所スコープに束縛されず、`EvalResult` 内の参照が解決しない。

`LoopResult` と `IterationRecord`(Task 8・Task 9 が共有する型)もこのファイルに置く。`run-loop.ts` と `generate-report.ts` が互いを import する循環を避けるためである。

```ts
export interface IterationRecord {
  iteration: number
  description: string
  train_passed: number
  train_failed: number
  train_total: number
  train_results: EvalResultItem[]
  test_passed: number | null
  test_failed: number | null
  test_total: number | null
  test_results: EvalResultItem[] | null
  passed: number
  failed: number
  total: number
  results: EvalResultItem[]
}

export interface LoopResult {
  exit_reason: string
  original_description: string
  best_description: string
  best_score: string
  best_train_score: string
  best_test_score: string | null
  final_description: string
  iterations_run: number
  holdout: number
  train_size: number
  test_size: number
  history: IterationRecord[]
}
```

- [ ] **Step 7: Write run-trigger-eval.ts**

`runEval` を export し、`main()` を分けて書く。`run-loop` が `runEval` を再利用する。

```ts
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0.
 *
 * TypeScript port of scripts/run_eval.py from the skill-creator Claude Code
 * plugin. Changes: the measured skill is registered as a project skill in a
 * per-run temporary directory rather than a slash command in the real
 * project; matching uses a name prefix; only the Skill tool counts;
 * find_project_root() is not ported; the result records an environment
 * object. See plugins/prompt-smith/NOTICE.
 */

import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { buildEnv, describeEnvironment } from "./lib/claude-cli.js"
import { parseSkillMd } from "./lib/parse-skill-md.js"
import { pool } from "./lib/pool.js"
import { buildSandboxSkillMd, createSandbox, makeCleanName } from "./lib/sandbox.js"
import { judge, TriggerDetector } from "./lib/stream-parse.js"
import type { EvalResult, EvalResultItem, RunEvalOptions } from "./lib/types.js"

/** 1 クエリを 1 回だけ測る。発火したら true。 */
async function runSingleQuery(
  query: string,
  skillName: string,
  skillContent: string,
  description: string,
  timeout: number,
  model: string | undefined,
): Promise<boolean> {
  const cleanName = makeCleanName(skillName)
  // 改善ループが渡す description を frontmatter へ反映してから測る。
  // これを飛ばすと、反復しても初回の description を測り続ける。
  const measured = buildSandboxSkillMd(replaceDescription(skillContent, description), cleanName)
  const sandbox = await createSandbox(measured, cleanName)

  try {
    const args = ["-p", query, "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    if (model) args.push("--model", model)

    const child = spawn("claude", args, {
      cwd: sandbox.dir,
      env: buildEnv(),
      stdio: ["ignore", "pipe", "ignore"],
    })

    return await new Promise<boolean>((resolve) => {
      const detector = new TriggerDetector(`${skillName}-skill-`)
      let buffer = ""
      let settled = false

      // kill したあと、プロセスが終わるのを待ってから resolve する。
      // 待たずに抜けると、呼び出し側の finally が cwd を削る間に
      // プロセスがまだ生きている状態になりうる(移植元は kill の後 wait する)。
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (child.exitCode === null && child.signalCode === null) {
          child.once("close", () => resolve(value))
          child.kill("SIGKILL")
          return
        }
        resolve(value)
      }

      const timer = setTimeout(() => finish(false), timeout * 1000)

      child.stdout.on("data", (chunk) => {
        if (settled) return
        buffer += String(chunk)
        let newline = buffer.indexOf("\n")
        while (newline !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const verdict = detector.push(line)
          if (verdict !== null) {
            finish(verdict)
            return
          }
          newline = buffer.indexOf("\n")
        }
      })

      child.on("error", (error) => {
        process.stderr.write(`Warning: query failed: ${error.message}\n`)
        finish(false)
      })

      child.on("close", () => finish(false))
    })
  } finally {
    await sandbox.cleanup()
  }
}

export async function runEval(options: RunEvalOptions): Promise<EvalResult> {
  const jobs = options.evalSet.flatMap((item) =>
    Array.from({ length: options.runsPerQuery }, () => item),
  )

  // 1 件の失敗で eval 全体を落とさない。移植元も future の例外を False として
  // 積み、残りを続ける(run_eval.py 221-225 行)。
  const outcomes = await pool(jobs, options.numWorkers, async (item) => {
    try {
      return await runSingleQuery(
        item.query,
        options.skillName,
        options.skillContent,
        options.description,
        options.timeout,
        options.model,
      )
    } catch (error) {
      process.stderr.write(`Warning: query failed: ${(error as Error).message}\n`)
      return false
    }
  })

  const triggersByQuery = new Map<string, number[]>()
  jobs.forEach((item, index) => {
    const list = triggersByQuery.get(item.query) ?? []
    list.push(outcomes[index] ? 1 : 0)
    triggersByQuery.set(item.query, list)
  })

  const results: EvalResultItem[] = options.evalSet.map((item) => {
    const outcomesForQuery = triggersByQuery.get(item.query) ?? []
    const triggers = outcomesForQuery.reduce((sum, value) => sum + value, 0)
    const runs = outcomesForQuery.length
    const triggerRate = runs === 0 ? 0 : triggers / runs
    const passed = judge(triggerRate, item.should_trigger, options.triggerThreshold)
    if (options.verbose) {
      process.stderr.write(
        `  [${passed ? "PASS" : "FAIL"}] rate=${triggers}/${runs} expected=${item.should_trigger}: ${item.query.slice(0, 60)}\n`,
      )
    }
    return {
      query: item.query,
      should_trigger: item.should_trigger,
      trigger_rate: triggerRate,
      triggers,
      runs,
      pass: passed,
    }
  })

  const passed = results.filter((r) => r.pass).length
  return {
    skill_name: options.skillName,
    description: options.description,
    environment: describeEnvironment(options.model),
    results,
    summary: { total: results.length, passed, failed: results.length - passed },
  }
}
```

同じクエリ文字列が eval セット内に重複していると `triggersByQuery` が混ざる。読み込み時に重複を検出し、あれば `Error` を投げて止める。移植元も同じ前提(クエリ文字列をキーにする)で書かれている。

`results` の並びは eval セットの入力順になる。移植元は完了順(`as_completed`)なので**並びが変わる**。キーと値は同じで、`improve-description` は並びに依存しない。この差は NOTICE の変更点一覧に足す。

`main()` は次を行う。

1. `--skill-path <dir>` から `<dir>/SKILL.md` を読み、`parseSkillMd` にかける。
2. `--description` があれば `description` を差し替える。`skillContent` の frontmatter の `description:` 行もその値へ置き換えてから `runEval` に渡す。
3. `--eval-set` の JSON を読み、クエリの重複を検査する。
4. `runEval` を呼ぶ。
5. `--out` があればそのパスへ、無ければ stdout へ `JSON.stringify(result, null, 2)` を書く。

- [ ] **Step 8: Write build.ts**

```ts
import esbuild from "esbuild"

const banner = `/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */`

await esbuild.build({
  bundle: true,
  entryPoints: {
    "run-trigger-eval": "./src/run-trigger-eval.ts",
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
  banner: { js: banner },
})
```

以降のタスクで CLI を足すたびに `entryPoints` へ 1 行加える。

- [ ] **Step 9: package.json に build スクリプトを足す**

```json
"scripts": { "build": "tsx build.ts" }
```

- [ ] **Step 10: ビルドが通ることを確かめる**

Run: `pnpm build`
Expected: `plugins/prompt-smith/scripts/run-trigger-eval.mjs` が生成され、先頭にライセンスの banner が入る

Run: `head -6 plugins/prompt-smith/scripts/run-trigger-eval.mjs`
Expected: `Apache License` と `Anthropic` を含む

- [ ] **Step 11: 対照実験を行う**

設計書 §11.1 の検証である。`plugins/prompt-smith/skills/prompt-smith/SKILL.md` の description を、`.claude/skills/` 経路(本実装)で 8 問測る。

Run: `node plugins/prompt-smith/scripts/run-trigger-eval.mjs --skill-path plugins/prompt-smith/skills/prompt-smith --eval-set /tmp/probe.json --runs-per-query 3 --verbose`

`/tmp/probe.json` には `should_trigger: true` の問を 4 つ、`false` の問を 4 つ、設計書 §6.1 の条件で書く。

次に、同じ description を `.claude/commands/` へ登録する経路で同じ問を測る。比較用の使い捨てスクリプトでよい。

判定は設計書 §11.1 の表に従う。

| 観測 | 次に行うこと |
| --- | --- |
| skills 経路だけ発火する | 合格。次のタスクへ進む |
| どちらも発火しない | `--timeout` を 120 に伸ばして再測。なお 0 なら stream-json の生ログを保存し、`Skill` の `content_block` が来ているかを直接読む |
| どちらも同じだけ発火する | 実装ではなく前提を疑う。設計書 §1・§4.1#1 と抗体 `ab-2026-0802-001` の記述を改める提案をユーザーへ出し、判断を仰ぐ |

- [ ] **Step 12: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/build.ts \
        plugins/prompt-smith/package.json plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 発火測定 CLI とビルド基盤を追加

登録先を .claude/skills/ に変え、cwd を一時ディレクトリにする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 層化分割

**Files:**
- Create: `plugins/prompt-smith/src/lib/split-eval-set.ts`
- Test: `plugins/prompt-smith/src/__test__/split-eval-set.test.ts`

**Interfaces:**
- Consumes: `EvalItem`
- Produces:
  - `function mulberry32(seed: number): () => number`
  - `function splitEvalSet(evalSet: EvalItem[], holdout: number, seed?: number): { train: EvalItem[]; test: EvalItem[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { mulberry32, splitEvalSet } from "../lib/split-eval-set.js"

const makeSet = (positives: number, negatives: number) => [
  ...Array.from({ length: positives }, (_, i) => ({ query: `pos-${i}`, should_trigger: true })),
  ...Array.from({ length: negatives }, (_, i) => ({ query: `neg-${i}`, should_trigger: false })),
]

describe("mulberry32", () => {
  it("同じ seed なら同じ列を返す", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it("違う seed なら違う列を返す", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it("0 以上 1 未満を返す", () => {
    const rand = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const value = rand()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe("splitEvalSet", () => {
  it("holdout の割合で分ける", () => {
    const { train, test } = splitEvalSet(makeSet(10, 10), 0.4)
    expect(test).toHaveLength(8)
    expect(train).toHaveLength(12)
  })

  it("両群から test を取る", () => {
    const { test } = splitEvalSet(makeSet(10, 10), 0.4)
    expect(test.filter((e) => e.should_trigger)).toHaveLength(4)
    expect(test.filter((e) => !e.should_trigger)).toHaveLength(4)
  })

  it("割合が小さくても各群から最低 1 問を test に入れる", () => {
    const { test } = splitEvalSet(makeSet(3, 3), 0.1)
    expect(test.filter((e) => e.should_trigger)).toHaveLength(1)
    expect(test.filter((e) => !e.should_trigger)).toHaveLength(1)
  })

  it("同じ入力と seed なら同じ分割になる", () => {
    const set = makeSet(10, 10)
    const a = splitEvalSet(set, 0.4)
    const b = splitEvalSet(set, 0.4)
    expect(a.test.map((e) => e.query)).toEqual(b.test.map((e) => e.query))
  })

  it("train と test の和が元の集合と一致する", () => {
    const set = makeSet(10, 10)
    const { train, test } = splitEvalSet(set, 0.4)
    expect([...train, ...test].map((e) => e.query).sort()).toEqual(set.map((e) => e.query).sort())
  })

  it("シャッフルを通っている", () => {
    // 固定 seed の結果が偶然入力順と一致しうるので、seed を変えて 3 回試し、
    // 1 回でも入力順と違えばシャッフルが効いているとみなす。
    const set = makeSet(10, 10)
    const heads = [1, 2, 3].map((seed) => splitEvalSet(set, 0.4, seed).test.map((e) => e.query).join(","))
    const inputOrder = "pos-0,pos-1,pos-2,pos-3,neg-0,neg-1,neg-2,neg-3"
    expect(heads.some((order) => order !== inputOrder)).toBe(true)
  })

  it("入力を壊さない", () => {
    const set = makeSet(4, 4)
    const before = set.map((e) => e.query)
    splitEvalSet(set, 0.4)
    expect(set.map((e) => e.query)).toEqual(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/split-eval-set.test.ts`
Expected: FAIL — import が解決できない

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0.
 *
 * Ported from split_eval_set in scripts/run_loop.py of the skill-creator
 * Claude Code plugin.
 *
 * Change: the shuffle uses a seeded PRNG implemented here instead of Python's
 * random module. The split is deterministic across runs but does not
 * reproduce Python's sequence.
 */

import type { EvalItem } from "./types.js"

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function splitEvalSet(
  evalSet: EvalItem[],
  holdout: number,
  seed = 42,
): { train: EvalItem[]; test: EvalItem[] } {
  const rand = mulberry32(seed)
  const positives = shuffled(evalSet.filter((e) => e.should_trigger), rand)
  const negatives = shuffled(evalSet.filter((e) => !e.should_trigger), rand)

  const nPositiveTest = Math.max(1, Math.floor(positives.length * holdout))
  const nNegativeTest = Math.max(1, Math.floor(negatives.length * holdout))

  return {
    test: [...positives.slice(0, nPositiveTest), ...negatives.slice(0, nNegativeTest)],
    train: [...positives.slice(nPositiveTest), ...negatives.slice(nNegativeTest)],
  }
}
```

`EvalItem` は Task 5 で作った `src/lib/types.ts` から import する。新しく定義しない。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/split-eval-set.test.ts`
Expected: PASS(10 件)

- [ ] **Step 5: 既存のテストが壊れていないことを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith`
Expected: PASS(全件)

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): eval セットの層化分割を移植

seed 付き PRNG で決定的にする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: description の改善

**Files:**
- Create: `plugins/prompt-smith/src/improve-description.ts`
- Test: `plugins/prompt-smith/src/__test__/improve-description.test.ts`
- Modify: `plugins/prompt-smith/build.ts`

**Interfaces:**
- Consumes: `callClaudeText`, `parseSkillMd`, `EvalResult`
- Produces:
  - `function buildImprovePrompt(input: ImprovePromptInput): string`
  - `function extractDescription(text: string): string`
  - `function improveDescription(options: ImproveOptions): Promise<string>`

`improveDescription` は `callClaude` を差し替え可能な引数として受け取る。テストで `claude -p` を起動しないためである。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest"
import { buildImprovePrompt, extractDescription, improveDescription } from "../improve-description.js"

const evalResults = {
  results: [
    { query: "should have fired", should_trigger: true, trigger_rate: 0, triggers: 0, runs: 3, pass: false },
    { query: "should not have fired", should_trigger: false, trigger_rate: 1, triggers: 3, runs: 3, pass: false },
    { query: "fine", should_trigger: true, trigger_rate: 1, triggers: 3, runs: 3, pass: true },
  ],
  summary: { total: 3, passed: 1, failed: 2 },
}

describe("buildImprovePrompt", () => {
  it("発火漏れと誤発火を分けて書く", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
    })
    expect(prompt).toContain("FAILED TO TRIGGER")
    expect(prompt).toContain("should have fired")
    expect(prompt).toContain("FALSE TRIGGERS")
    expect(prompt).toContain("should not have fired")
  })

  it("合格した問は失敗欄に入れない", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
    })
    const failureSection = prompt.slice(prompt.indexOf("FAILED TO TRIGGER"), prompt.indexOf("</scores_summary>"))
    expect(failureSection).not.toContain('"fine"')
  })

  it("1024 文字の上限を伝える", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
    })
    expect(prompt).toContain("1024 characters")
    expect(prompt).toContain("100-200 words")
  })

  it("過去の試行を積む", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      history: [{ description: "older one", train_passed: 1, train_total: 3, results: [] }],
      evalResults,
      testResults: null,
    })
    expect(prompt).toContain("PREVIOUS ATTEMPTS")
    expect(prompt).toContain("older one")
  })
})

describe("extractDescription", () => {
  it("タグの中身を取り出す", () => {
    expect(extractDescription('junk <new_description>the text</new_description> junk')).toBe("the text")
  })

  it("改行を含むタグも取り出す", () => {
    expect(extractDescription("<new_description>\nline one\nline two\n</new_description>")).toBe("line one\nline two")
  })

  it("タグが無ければ全文を使う", () => {
    expect(extractDescription("  plain text  ")).toBe("plain text")
  })

  it("引用符を剥がす", () => {
    expect(extractDescription('<new_description>"quoted"</new_description>')).toBe("quoted")
  })
})

describe("improveDescription", () => {
  it("1024 文字以内ならそのまま返す", async () => {
    const callClaude = vi.fn().mockResolvedValue("<new_description>short</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude,
    })
    expect(out).toBe("short")
    expect(callClaude).toHaveBeenCalledTimes(1)
  })

  it("1024 文字を超えたら 1 回だけ再依頼する", async () => {
    const tooLong = "x".repeat(1100)
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce(`<new_description>${tooLong}</new_description>`)
      .mockResolvedValueOnce("<new_description>shortened</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude,
    })
    expect(out).toBe("shortened")
    expect(callClaude).toHaveBeenCalledTimes(2)
    expect(callClaude.mock.calls[1][0]).toContain("over the 1024-character hard limit")
  })

  it("再依頼の結果がなお長くてもそのまま返す", async () => {
    const tooLong = "x".repeat(1100)
    const callClaude = vi.fn().mockResolvedValue(`<new_description>${tooLong}</new_description>`)
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude,
    })
    expect(out).toHaveLength(1100)
    expect(callClaude).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/improve-description.test.ts`
Expected: FAIL — import が解決できない

- [ ] **Step 3: Write minimal implementation**

移植元 `improve_description.py` の 79-142 行の英文プロンプトを**一字一句そのまま**テンプレートリテラルへ移す。訳さない。語順も変えない。

構造は次のとおり。

1. 冒頭の説明文(79-81 行)
2. `<current_description>` ブロック(83-86 行)
3. `Current scores ({scores_summary}):` と `<scores_summary>`(88-90 行)
4. `FAILED TO TRIGGER` の一覧(91-95 行)
5. `FALSE TRIGGERS` の一覧(97-101 行)
6. `PREVIOUS ATTEMPTS` の一覧(103-118 行)
7. `</scores_summary>` と `<skill_content>`(120-125 行)
8. 本文の指示(127-142 行)

1024 文字超の再依頼プロンプトは 164-173 行をそのまま移す。

`extractDescription` は `/<new_description>([\s\S]*?)<\/new_description>/` で抜き、無ければ全文を使う。どちらも前後の空白を落とし、引用符を剥がす(`parse-skill-md.ts` の `stripChar` と同じ扱い)。

`--log-dir` が渡されたら `improve_iter_<n>.json` に往復を記録する。記録するキーは移植元 149-156 行と同じ。

`main()` は `--eval-results` / `--skill-path` / `--history` / `--model` / `--verbose` を受け、`{ description, history }` を stdout へ出す。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/improve-description.test.ts`
Expected: PASS(11 件)

- [ ] **Step 5: プロンプトが原文と一致することを確かめる**

`buildImprovePrompt` の出力を一時ファイルへ書き、移植元の該当行と突き合わせる。TypeScript を直接実行できないので、テスト経由で書き出す。

`src/__test__/improve-description.test.ts` に一時的なテストを足す。

```ts
it.skip("プロンプトをファイルへ書き出す(照合用)", () => {
  const prompt = buildImprovePrompt({
    skillName: "SKILL",
    skillContent: "CONTENT",
    currentDescription: "DESC",
    evalResults: { results: [], summary: { total: 0, passed: 0, failed: 0 } },
    history: [],
    testResults: null,
  })
  writeFileSync("/tmp/ported-prompt.txt", prompt)
})
```

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/improve-description.test.ts -t 照合用 --no-threads`(`it.skip` を一時的に `it` へ変えて実行)

Run: `sed -n '79,142p' /home/hiro0209/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/scripts/improve_description.py > /tmp/original-prompt.txt && diff /tmp/original-prompt.txt /tmp/ported-prompt.txt`

差はテンプレート変数の展開箇所と Python の文字列連結の継ぎ目だけであることを目で確かめる。確認後、この一時テストは削除する。

- [ ] **Step 6: build.ts に entry を足してビルドする**

`entryPoints` へ `"improve-description": "./src/improve-description.ts"` を加える。

Run: `pnpm build`
Expected: `scripts/improve-description.mjs` が生成される

- [ ] **Step 7: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/build.ts plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): description の改善案生成を移植

改善プロンプトは英文のまま移す。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 反復ループ

**Files:**
- Create: `plugins/prompt-smith/src/run-loop.ts`
- Test: `plugins/prompt-smith/src/__test__/run-loop.test.ts`
- Modify: `plugins/prompt-smith/build.ts`

**Interfaces:**
- Consumes: `runEval`, `improveDescription`, `splitEvalSet`, `parseSkillMd`
- Produces:
  - `function selectBest(history: IterationRecord[], hasTestSet: boolean): IterationRecord`
  - `function blindHistory(history: IterationRecord[]): Record<string, unknown>[]`
  - `function runLoop(options: RunLoopOptions): Promise<LoopResult>`

`LoopResult` と `IterationRecord` は Task 5 で作った `src/lib/types.ts` から import する。新しく定義しない。

**このタスクでは HTML レポートを書き出さない。** `--report` の扱いと反復ごとのライブ更新は Task 9 で足す。`generate-report.ts` がまだ無い段階で `run-loop.ts` から import すると解決できないためである。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest"
import { blindHistory, runLoop, selectBest } from "../run-loop.js"

const record = (iteration: number, train: number, test: number) => ({
  iteration,
  description: `desc-${iteration}`,
  train_passed: train,
  train_failed: 12 - train,
  train_total: 12,
  train_results: [],
  test_passed: test,
  test_failed: 8 - test,
  test_total: 8,
  test_results: [],
  passed: train,
  failed: 12 - train,
  total: 12,
  results: [],
})

describe("selectBest", () => {
  it("test スコアで選ぶ", () => {
    const history = [record(1, 12, 4), record(2, 8, 7)]
    expect(selectBest(history, true).iteration).toBe(2)
  })

  it("test が無いときは train スコアで選ぶ", () => {
    const history = [record(1, 12, 0), record(2, 8, 0)]
    expect(selectBest(history, false).iteration).toBe(1)
  })

  it("同点なら先に来たものを選ぶ", () => {
    const history = [record(1, 10, 5), record(2, 9, 5)]
    expect(selectBest(history, true).iteration).toBe(1)
  })
})

describe("blindHistory", () => {
  it("test_ で始まるキーを落とす", () => {
    const [blinded] = blindHistory([record(1, 10, 5)])
    expect(blinded).not.toHaveProperty("test_passed")
    expect(blinded).not.toHaveProperty("test_results")
    expect(blinded).toHaveProperty("train_passed")
    expect(blinded).toHaveProperty("description")
  })
})

describe("runLoop", () => {
  const evalSet = [
    ...Array.from({ length: 10 }, (_, i) => ({ query: `pos-${i}`, should_trigger: true })),
    ...Array.from({ length: 10 }, (_, i) => ({ query: `neg-${i}`, should_trigger: false })),
  ]

  const allPass = (queries: { query: string; should_trigger: boolean }[]) => ({
    skill_name: "s",
    description: "d",
    environment: { base_url: "(default)", auth_source: "(claude.ai login)", model: null },
    results: queries.map((q) => ({ ...q, trigger_rate: 1, triggers: 3, runs: 3, pass: true })),
    summary: { total: queries.length, passed: queries.length, failed: 0 },
  })

  it("train が全問合格したら打ち切る", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) => allPass(queries))
    const improve = vi.fn()
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0.4,
      maxIterations: 5,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve,
    })
    expect(result.iterations_run).toBe(1)
    expect(result.exit_reason).toContain("all_passed")
    expect(improve).not.toHaveBeenCalled()
  })

  it("max-iterations で打ち切る", async () => {
    const failing = (queries: { query: string; should_trigger: boolean }[]) => ({
      ...allPass(queries),
      results: queries.map((q) => ({ ...q, trigger_rate: 0, triggers: 0, runs: 3, pass: false })),
      summary: { total: queries.length, passed: 0, failed: queries.length },
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => failing(queries))
    const improve = vi.fn(async () => "next description")
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0.4,
      maxIterations: 3,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve,
    })
    expect(result.iterations_run).toBe(3)
    expect(result.exit_reason).toContain("max_iterations")
    expect(improve).toHaveBeenCalledTimes(2)
  })

  it("改善モデルに test スコアを渡さない", async () => {
    const mixed = (queries: { query: string; should_trigger: boolean }[]) => ({
      ...allPass(queries),
      results: queries.map((q, i) => ({ ...q, trigger_rate: i % 2, triggers: i % 2, runs: 3, pass: i % 2 === 0 })),
      summary: { total: queries.length, passed: 1, failed: queries.length - 1 },
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => mixed(queries))
    const improve = vi.fn(async () => "next")
    await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0.4,
      maxIterations: 2,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve,
    })
    const passedHistory = improve.mock.calls[0][0].history
    expect(JSON.stringify(passedHistory)).not.toContain("test_passed")
  })

  it("holdout 0 のとき test を作らない", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) => allPass(queries))
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 1,
      model: "claude-opus-5",
      runEval,
      improveDescription: vi.fn(),
    })
    expect(result.test_size).toBe(0)
    expect(result.best_test_score).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/run-loop.test.ts`
Expected: FAIL — import が解決できない

- [ ] **Step 3: Write minimal implementation**

移植元 `run_loop.py` 47-241 行をそのまま写す。要点。

1. `holdout > 0` なら `splitEvalSet`。そうでなければ train = 全問、test = 空。
2. 反復ごとに train + test を 1 バッチで `runEval` に渡す。
3. 結果を train のクエリ集合で振り分ける。
4. `history` に 1 件積む。移植元 121-137 行のキーをそのまま持つ(後方互換の `passed` / `failed` / `total` / `results` を含む)。
5. train が全問合格なら `all_passed (iteration N)` で打ち切る。
6. `iteration === maxIterations` なら `max_iterations (N)` で打ち切る。
7. `blindHistory` を通してから `improveDescription` を呼ぶ。
8. 返ってきた description を `currentDescription` に入れ、次の反復で `runEval` の `description` として渡す。`runEval` がこれを frontmatter へ反映して測る(Task 5)。
9. 最良は test があれば `test_passed`、無ければ `train_passed` で選ぶ。

手順 8 が改善ループの要である。`runEval` に渡す `skillContent` は初回のまま変えず、`description` だけを差し替える。移植元も同じ形で、`run_single_query` が description からファイルを組み立てる(`run_eval.py:58-68`)。

`onIteration?: (partial: LoopResult) => void` を `RunLoopOptions` に足しておく。Task 9 がここへライブレポートの書き出しを差し込む。この段では呼び出し側が渡さなければ何も起きない。

`selectBest` は同点で先勝ちにする。JavaScript の `reduce` で `>` 比較にすれば自然にそうなる(Python の `max` と同じ挙動)。

`main()` は設計書 §4.3 の CLI 引数をすべて受ける。`--report` は Task 9 で実装するので、この段では受け取って無視する。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/run-loop.test.ts`
Expected: PASS(8 件)

- [ ] **Step 5: build.ts に entry を足してビルドする**

`entryPoints` へ `"run-loop": "./src/run-loop.ts"` を加える。

Run: `pnpm build`
Expected: `scripts/run-loop.mjs` が生成される

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/build.ts plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 測定と改善の反復ループを移植

最良は held-out test スコアで選び、改善モデルには test を見せない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: HTML レポート

**Files:**
- Create: `plugins/prompt-smith/src/generate-report.ts`
- Test: `plugins/prompt-smith/src/__test__/generate-report.test.ts`
- Modify: `plugins/prompt-smith/build.ts`

**Interfaces:**
- Consumes: `LoopResult`
- Produces: `function generateHtml(output: LoopResult, autoRefresh: boolean, skillName: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { generateHtml } from "../generate-report.js"

const output = {
  exit_reason: "all_passed (iteration 2)",
  original_description: "the original",
  best_description: "the best",
  best_score: "7/8",
  best_train_score: "11/12",
  best_test_score: "7/8",
  final_description: "the best",
  iterations_run: 2,
  holdout: 0.4,
  train_size: 12,
  test_size: 8,
  history: [
    {
      iteration: 1,
      description: "the original",
      train_passed: 9,
      train_failed: 3,
      train_total: 12,
      train_results: [{ query: "a query", should_trigger: true, trigger_rate: 0, triggers: 0, runs: 3, pass: false }],
      test_passed: 5,
      test_failed: 3,
      test_total: 8,
      test_results: [],
      passed: 9,
      failed: 3,
      total: 12,
      results: [],
    },
  ],
}

describe("generateHtml", () => {
  it("反復ごとのスコアを出す", () => {
    const html = generateHtml(output, false, "my-skill")
    expect(html).toContain("my-skill")
    expect(html).toContain("11/12")
    expect(html).toContain("7/8")
    expect(html).toContain("a query")
  })

  it("autoRefresh のとき meta refresh を入れる", () => {
    expect(generateHtml(output, true, "my-skill")).toContain("http-equiv=\"refresh\"")
    expect(generateHtml(output, false, "my-skill")).not.toContain("http-equiv=\"refresh\"")
  })

  it("description の山かっこを escape する", () => {
    const withTag = { ...output, best_description: "use <script>alert(1)</script>" }
    const html = generateHtml(withTag, false, "s")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/generate-report.test.ts`
Expected: FAIL — import が解決できない

- [ ] **Step 3: Write minimal implementation**

移植元 `generate_report.py` を写す。`autoRefresh` が真のとき `<meta http-equiv="refresh" content="5">` を入れる。ユーザーの入力(description・クエリ)は `&`・`<`・`>`・`"` を escape してから埋める。

**1 点だけ意図的に落とす。** 移植元 39-41 行は Google Fonts への `<link>` を 3 本持つ。これを写さず、`font-family` はシステムフォントのスタックに置き換える。ネットワークの無い環境でレポートが崩れないようにするためである。この差分を NOTICE の変更点一覧に足す。

`generateHtml` は `LoopResult` を `src/lib/types.ts` から import する。`run-loop.ts` は import しない。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/generate-report.test.ts`
Expected: PASS(3 件)

- [ ] **Step 5: run-loop へライブレポートを配線する**

Task 8 で `RunLoopOptions` に置いた `onIteration` を使う。`run-loop.ts` の `main()` に次を足す。

- `--report none` — 何もしない
- `--report auto`(既定) — 一時ファイルのパスを決め、`onIteration` で `generateHtml(partial, true, skillName)` を書き出す。初回の書き出し後にブラウザで開く
- `--report <path>` — 指定パスへ同様に書き出す。ブラウザは開かない
- ループ終了後、`autoRefresh` を false にした最終版で上書きする

`run-loop.ts` から `generate-report.ts` を import する。逆向きの import は作らない。共有する型は `src/lib/types.ts` にあるので循環しない。

- [ ] **Step 6: build.ts に entry を足してビルドする**

`entryPoints` へ `"generate-report": "./src/generate-report.ts"` を加える。

Run: `pnpm build`
Expected: `scripts/generate-report.mjs` と `scripts/run-loop.mjs` が生成される

- [ ] **Step 7: 反復ループが最後まで通ることを確かめる**

3 問程度の小さな eval セットで `run-loop.mjs` を 2 反復回し、HTML が生成され、反復ごとにスコアが更新されることを確かめる。

- [ ] **Step 8: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/build.ts plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 反復結果の HTML レポートを移植

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: eval レビュー UI

**Files:**
- Create: `plugins/prompt-smith/skills/skill-creator/assets/eval-review.html`

**Interfaces:**
- Consumes: なし
- Produces: 3 つのプレースホルダを持つ HTML。`__EVAL_DATA_PLACEHOLDER__` / `__SKILL_NAME_PLACEHOLDER__` / `__SKILL_DESCRIPTION_PLACEHOLDER__`

- [ ] **Step 1: 原本をコピーする**

```bash
mkdir -p plugins/prompt-smith/skills/skill-creator/assets
cp /home/hiro0209/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/assets/eval_review.html \
   plugins/prompt-smith/skills/skill-creator/assets/eval-review.html
```

- [ ] **Step 2: ライセンス通知を冒頭に足す**

`<!DOCTYPE html>` の直後に HTML コメントを入れる。

```html
<!--
  This file is a copy of assets/eval_review.html from the skill-creator
  Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
  Modified by amatsuka-koubou: this notice was added. No other changes.
  See plugins/prompt-smith/NOTICE and plugins/prompt-smith/LICENSE.
-->
```

- [ ] **Step 3: プレースホルダが 3 つとも残っていることを確かめる**

Run: `grep -c "__EVAL_DATA_PLACEHOLDER__\|__SKILL_NAME_PLACEHOLDER__\|__SKILL_DESCRIPTION_PLACEHOLDER__" plugins/prompt-smith/skills/skill-creator/assets/eval-review.html`
Expected: 3 以上

- [ ] **Step 4: ブラウザで開いて動くことを確かめる**

3 つのプレースホルダを実データで置換した一時ファイルを `/tmp/eval-review-probe.html` に作り、開く。

- 問の編集ができる
- `should_trigger` を切り替えられる
- 問の追加と削除ができる
- "Export Eval Set" で `~/Downloads/eval_set.json` に落ちる

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/skills/skill-creator/assets/eval-review.html
git commit -m "$(cat <<'EOF'
feat(prompt-smith): eval セットのレビュー UI を移植

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: skill-creator スキル本文

**Files:**
- Create: `plugins/prompt-smith/skills/skill-creator/SKILL.md`
- Create: `plugins/prompt-smith/docs/skill-creator-port-rationale.md`

**Interfaces:**
- Consumes: `scripts/run-loop.mjs`、`assets/eval-review.html`、`../../references/description-guide.md`、`prompt-smith:prompt-smith`
- Produces: スキル `prompt-smith:skill-creator`

- [ ] **Step 1: 本文を書く**

設計書 §8・§8.2・§8.4・§8.5 の内容を、`prompt-smith` の基準で書く。

節の構成。

| 節 | 内容の出どころ |
| --- | --- |
| 冒頭 | 対象と、`../../references/description-guide.md` を併せて読む旨 |
| 手順 | 設計書 §8 の 12 段 |
| スキルの構造 | 設計書 §8.4 三層のロード・書き方のパターン・安全・既存スキルの更新・frontmatter |
| description の規律 | 設計書 §8.2 の 5 行 |
| eval セット | 設計書 §6.1 の条件、§6.2 の置き場、§6.3 の承認と回収 |
| 出力の評価 | 設計書 §8.5 の手順 8 段と規律 8 件 |
| 測定の規律 | 設計書 §8.1 の 5 件(左列のみ)。下記に列挙する |
| 相手に合わせた言葉選び | 設計書 §8.4 |

測定の規律として本文に載せる 5 件。設計書 §8.1 の左列をそのまま持つ。

1. 1〜2 問の差で description や実装を疑わない。同条件で測り直す。
2. 過去の測定と比べるときは `environment` の一致を確かめる。
3. スコアは測定した環境に依存する。有効なプラグインやユーザースキルが変わった後の値を、変わる前の値と比べない。
4. 全問が発火 0 で返ったときは、description ではなくタイムアウトを疑い、`--timeout` を伸ばして測り直す。
5. 公式 `skill-creator` プラグインの `run_eval.py` / `run_loop.py` は使わない。

出力の評価(設計書 §8.5)は「出力の評価」という 1 つの節にまとめ、手順 8 段と規律 8 件を両方入れる。手順を本文から落として規律だけにしない。

守る規律。

- 指示を正当化する根拠・出典・経緯を本文に書かない。
- 命令形ではなく望ましい動きの言い切りで書く。
- 1 文に 1 指示だけ書く。
- 禁止を書くときは代わりに取る動きを併記する。
- 例は 1 つで伝わるなら 2 つ目以降を削る。
- 素案を書き切ってから、別のパスで基準を当てて削る。

description は Task 13 で eval を回して決める。この段では素案でよい。

- [ ] **Step 2: 根拠を docs へ退避する**

`plugins/prompt-smith/docs/skill-creator-port-rationale.md` に次を書く。

- 移植の経緯と、2026-08-02 設計書 §6 を覆した判断
- `run_eval.py` の 4 修正それぞれの根拠
- 前方一致の限界(設計書 §4.1.1)
- サンドボックスで隔離できない範囲(ユーザースキル・プラグインのスキル・同梱スキル)
- 測定のばらつきの実測(同一クエリ 10 回で 0/10〜3/10)
- 削除した `description-guide.md` §直したときの確かめ方 の 14 行(移植前の姿として)
- 設計書 §8.6 の対応表
- 移植しない 3 節とその理由

- [ ] **Step 3: 機能の抜けが無いことを確かめる**

設計書 §8.6 の対応表を 1 行ずつたどり、「移植後の所在」に挙げた節が本文または参照先に存在することを確かめる。「移植しない」と記した 3 節を除く。

存在しない行があれば本文へ足す。

- [ ] **Step 4: 本文を自己検査する**

`prompt-smith` の評価の手順で、書いた SKILL.md を評価する。冗長度・充足度・スタイル適合の 3 軸で評点を出し、指摘を直す。

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/skills/skill-creator/SKILL.md \
        plugins/prompt-smith/docs/skill-creator-port-rationale.md
git commit -m "$(cat <<'EOF'
feat(prompt-smith): skill-creator スキルを追加

スキルの作成、description の改善ループ、出力の評価を担う。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 経路の付け替え

`prompt-smith` から `skill-creator` を呼ぶ逆向きの経路を外し、`description-guide.md` から skill 専用の規律を抜く。Task 11 が済んでから行う。

**Files:**
- Modify: `plugins/prompt-smith/skills/prompt-smith/SKILL.md:3`(description)
- Modify: `plugins/prompt-smith/skills/prompt-smith/SKILL.md:16-29`(§description の担当)
- Modify: `plugins/prompt-smith/references/description-guide.md`
- Modify: `plugins/prompt-smith/skills/agent-creator/SKILL.md`(§4 に Agents 固有の規律を足す)

**Interfaces:**
- Consumes: スキル `prompt-smith:skill-creator`(Task 11)
- Produces: なし

- [ ] **Step 1: prompt-smith の §description の担当 を差し替える**

16-29 行(14 行)を次の 3 行に置き換える。

```markdown
## description の担当

- output style・メモリの description は `../../references/description-guide.md` に従って書く。
- SKILL.md・コマンド定義の description は `prompt-smith:skill-creator` が担当する。
- Agents 定義の description は `agent-creator` が担当する。
```

- [ ] **Step 2: prompt-smith の description に境界を足す**

frontmatter の `description` の末尾へ次を加える。

```
スキル・コマンド定義の description の作成・改善と発火測定は `skill-creator` が担当する。
```

- [ ] **Step 3: description-guide.md を改稿する**

| 対象 | 変更 |
| --- | --- |
| 3-8 行 | `skill-creator` の可否による分岐を削る。対象の列挙は残す |
| 23-28 行 §発火率を上げるための施策 | **節ごと削る。** 27-28 行は Task 11 で `skill-creator` の本文へ移済み。26 行(Agents 専用)は下記のとおり `agent-creator` の本文へ移す。25 行の但し書きは指す対象を失う |
| 30-35 行 §長さの上限 | 節ごと削る(33-35 行は Task 11 の本文へ移した。32 行は指す対象を失う) |
| 43-56 行 §直したときの確かめ方 | 節ごと削る |

改稿後の `description-guide.md` は**共通の基準だけ**を持つ。skill 固有の記述も Agents 固有の記述も残らない。`skill-creator` と `agent-creator` の両方がこれを読み、それぞれの固有の規律は自分の本文に持つ。

**あわせて `plugins/prompt-smith/skills/agent-creator/SKILL.md` を変更する。** §4 description を書く に、guide から移す Agents 固有の規律を足す。

> - 使用する場面を具体的に書き、「積極的に使用する」と書く。

`../../references/description-guide.md` への参照(35 行目)はそのまま残す。共通の基準はそちらで読む。

- [ ] **Step 4: 逆向きの経路が残っていないことを確かめる**

Run: `grep -n "skill-creator を invoke\|skill-creator が使える\|skill-creator を使えない" plugins/prompt-smith/skills/prompt-smith/SKILL.md plugins/prompt-smith/references/description-guide.md`
Expected: 0 件

Run: `grep -n "直したときの確かめ方" plugins/prompt-smith/references/description-guide.md`
Expected: 0 件

- [ ] **Step 5: agent-creator の参照が生きていることを確かめる**

Run: `grep -n "description-guide" plugins/prompt-smith/skills/agent-creator/SKILL.md`
Expected: 35 行目が残っている

改稿後の `description-guide.md` を読み、共通の基準(§書く内容・§配布するスキル・Agents 定義の書き方)だけが残っていることを確かめる。skill 固有の記述も Agents 固有の記述も残っていないこと。

Run: `grep -n "積極的に使用する" plugins/prompt-smith/skills/agent-creator/SKILL.md`
Expected: 1 件(guide から移した規律)

Run: `grep -n "積極的に使用する\|1024\|100〜200" plugins/prompt-smith/references/description-guide.md`
Expected: 0 件

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/skills/prompt-smith/SKILL.md \
        plugins/prompt-smith/references/description-guide.md
git commit -m "$(cat <<'EOF'
refactor(prompt-smith): description の担当を skill-creator へ寄せる

逆向きの経路を外し、guide から skill 専用の規律を抜く。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: eval セットと自己適用

**Files:**
- Create: `plugins/prompt-smith/evals/skill-creator.json`
- Create: `plugins/prompt-smith/evals/prompt-smith.json`
- Create: `plugins/prompt-smith/evals/agent-creator.json`
- Modify: `plugins/prompt-smith/skills/skill-creator/SKILL.md`(description)
- Modify: `plugins/prompt-smith/skills/prompt-smith/SKILL.md`(description)
- Modify: `plugins/prompt-smith/skills/agent-creator/SKILL.md`(description)

**Interfaces:**
- Consumes: `scripts/run-loop.mjs`、`assets/eval-review.html`
- Produces: 3 スキルの eval セットと、測定で選ばれた description

- [ ] **Step 1: eval セットを 3 本書く**

各 20 問。`should_trigger: true` を 8〜10 問、`false` を 8〜10 問。設計書 §6.1 の条件を満たす。

`skill-creator.json` の `false` 側には、`prompt-smith`(本文の改稿)と `agent-creator`(Agent 定義)が正解の依頼を入れる。境界が測れるようにするためである。

配布するスキルの eval なので、固有名は架空にする。同梱スキルの名前は残す。

- [ ] **Step 2: ユーザーの承認を得る**

`assets/eval-review.html` のプレースホルダを置換し、`/tmp/eval-review-<skill>.html` に書いて開く。ユーザーが編集してエクスポートしたら、`~/Downloads/` から更新時刻が最も新しい `eval_set*.json` を取る。

3 スキル分を順に行う。

- [ ] **Step 3: 改善ループを回す**

```bash
node plugins/prompt-smith/scripts/run-loop.mjs \
  --eval-set plugins/prompt-smith/evals/skill-creator.json \
  --skill-path plugins/prompt-smith/skills/skill-creator \
  --model claude-opus-5 \
  --max-iterations 5 --verbose
```

3 スキル分を順に回す。1 本あたり数十分かかる。

- [ ] **Step 4: 結果を確かめる**

| 確認 | 期待 |
| --- | --- |
| ループが完走する | `best_description` と `best_score` が返る |
| レポートが出る | HTML が生成され、反復ごとのスコアが表示される |
| `environment` が一致している | 3 本とも同じ `base_url` と `auth_source` |

全問が発火 0 で返ったときは、description ではなくタイムアウトを疑う。`--timeout 120` で測り直す。

- [ ] **Step 5: best_description を適用する**

各 SKILL.md の frontmatter へ書き、before / after とスコアをユーザーへ示す。

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/evals plugins/prompt-smith/skills
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 3 スキルの eval セットと測定済み description を追加

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: 文書と抗体の更新

**Files:**
- Create: `plugins/prompt-smith/README.md`
- Modify: `README.md`
- Modify: `.raphael/antibodies/ab-2026-0802-001.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: プラグインの README を書く**

利用者が読まなければ使えない情報だけを書く。

- 提供するスキル 3 本(`prompt-smith` / `skill-creator` / `agent-creator`)とその担当
- `skill-creator` が使うスクリプトと、`claude` CLI が要ること
- eval セットの置き場
- 公式 `skill-creator` プラグインと名前が重なること。両方を有効にすると発火が割れること
- Apache-2.0 の由来(`LICENSE` と `NOTICE` を指す)

- [ ] **Step 2: ルートの README に反映する**

`prompt-smith` の項へ `skill-creator` を足す。

- [ ] **Step 3: 抗体を更新する**

手で `.raphael/antibodies/*.md` を編集しない。

```bash
node plugins/raphael/scripts/update-antibody.mjs patch ab-2026-0802-001
```

本文を次の内容へ差し替える。**現行の本文は「登録先が `.claude/commands/` だから発火を検出できない」と主張しているが、2026-08-09 の対照実験でこれは否定された**(設計書 §1)。誤った規律が毎セッション注入され続けている状態なので、主張の中核を差し替える。

- `run_eval.py` / `run_loop.py` は、`find_project_root()` が実リポジトリのルートを cwd にするため、そのリポジトリの全スキルが同席した状態で測ることになる。得られるスコアは description の質ではなく手元のカタログとの競争結果である
- 加えて、本文を捨てた description だけの薄いファイルを測定対象にする。本番の SKILL.md とは別物を測っている
- 代わりに `plugins/prompt-smith/scripts/run-trigger-eval.mjs` または `run-loop.mjs` を使う
- 詳細は `plugins/prompt-smith/docs/skill-creator-port-rationale.md`

2026-08-01 の実測(登録先を変えると発火が 1/8 から 8/8 になった)は、登録先と cwd の 2 変数が同時に変わった交絡した比較である(設計書 §1)。本文から削り、交絡の分析込みで `plugins/prompt-smith/docs/skill-creator-port-rationale.md` へ移す。

削除済みの `plugins/optimize-agents/scripts/run-trigger-eval.mjs` への参照を残さない。

- [ ] **Step 4: 旧パスへの参照が残っていないことを確かめる**

Run: `grep -rn "optimize-agents/scripts" --exclude-dir=.git --exclude-dir=chat .`
Expected: 0 件

- [ ] **Step 5: 全体のテストとビルドを通す**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
Expected: すべて成功

Run: `git status --short plugins/prompt-smith/scripts`
Expected: 差分なし(ビルド出力がコミット済み)

- [ ] **Step 6: Commit**

```bash
git add README.md plugins/prompt-smith/README.md .raphael/antibodies/ab-2026-0802-001.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): README を追加し、抗体の参照先を移植版へ更新

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 検証の全体像

| 対象 | いつ | どう確かめるか |
| --- | --- | --- |
| 判定ロジック | Task 3 | 固定の JSON 行から `TriggerDetector` の返り値を検証 |
| 合否条件 | Task 3 | `judge(0.34, false, 0.5) === true` が移植元どおりであることの証拠 |
| サンドボックス | Task 4 | `disable-model-invocation` の置換と追加、祖先に `.claude` が無いこと |
| description の差し替え | Task 4 | `replaceDescription` がブロックスカラーを畳み、本文に触らないこと。これが効かないと改善ループが初回 description を測り続ける |
| 層化分割 | Task 6 | 同じ入力で同じ分割、各群から最低 1 問 |
| 1024 文字超の再依頼 | Task 7 | `callClaude` を差し替えて 2 回目の呼び出し内容を検証 |
| test スコアの秘匿 | Task 8 | `improveDescription` に渡る history に `test_` が無いこと |
| 測定器そのもの | Task 5 | `.claude/commands/` 経路との対照実験 |
| 機能の網羅 | Task 11 | 設計書 §8.6 の対応表を 1 行ずつたどる |
| ループ全体 | Task 13 | 3 スキルの自己適用が完走する |
| 配布物 | Task 14 | `pnpm build && pnpm test && pnpm typecheck && pnpm lint` |

## 判断が要る場面

| 場面 | 誰が決めるか |
| --- | --- |
| Task 5 の対照実験で「どちらも同じだけ発火する」観測になったとき | ユーザー。設計書 §1 の前提を改める判断が要る |
| Task 13 で eval セットの問が妥当かどうか | ユーザー。レビュー UI で承認を得る |
| Task 13 で `best_score` が現行 description を下回ったとき | ユーザー。適用するかどうか |
