# Revelation フック層 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 下位モデルが revelation スキルを自発的に invoke しない問題への対策として、SessionStart トリガー表注入 + PreToolUse 1回差し戻しの2層フックを revelation プラグインに追加する。

**Architecture:** スキル本体(`skills/*/SKILL.md`)は変更しない。`plugins/revelation/hooks/` を新設し、SessionStart で約10行のトリガー表を additionalContext として注入(第1層)、Edit/Write と Task/Agent の PreToolUse で該当スキル未読なら deny + invoke 誘導をセッション・スキルごとに最大1回だけ返す(第2層)。仕様の全文は `plugins/revelation/docs/DESIGN.md`。

**Tech Stack:** Node.js 標準ライブラリのみ(外部依存なし)。テストは `node --test`。codiel の `hooks/scripts/*.mjs` と同じ command フック構造に揃える。

## Global Constraints

- Anthropic API・`ANTHROPIC_API_KEY` を使わない(リポジトリ全体の制約。フックは純粋な Node スクリプトなので該当なし、追加もしない)
- 外部 npm 依存を追加しない(Node 標準ライブラリのみ)
- 判定不能な状況(transcript が読めない・形式が想定外・マーカー書き込み失敗)はすべて **allow(フェイルオープン)**。規律の補助でユーザーの作業を止めない
- コメント・ドキュメント・deny メッセージは日本語(リポジトリの流儀)
- フック設定はセッション開始時に読み込まれるため、実機確認には Claude Code の再起動が必要

## ファイル構成

```
plugins/revelation/
├── hooks/
│   ├── hooks.json                      # SessionStart + PreToolUse の定義(Task 4)
│   ├── trigger-map.md                  # 第1層で注入するトリガー表(Task 2)
│   └── scripts/
│       ├── lib.mjs                     # readStdin / emit / hasSkillInvocation(Task 1)
│       ├── lib.test.mjs                # hasSkillInvocation のテスト(Task 1)
│       ├── inject-trigger-map.mjs      # 第1層: SessionStart(Task 2)
│       ├── inject-trigger-map.test.mjs # (Task 2)
│       ├── remind-skill.mjs            # 第2層: PreToolUse(Task 3)
│       └── remind-skill.test.mjs       # (Task 3)
├── docs/DESIGN.md                      # 仕様(コミット済み・変更なし)
└── README.md                           # 「既知の制約」節を更新(Task 4)
```

---

### Task 1: lib.mjs — 共有ユーティリティと既読判定

**Files:**
- Create: `plugins/revelation/hooks/scripts/lib.mjs`
- Test: `plugins/revelation/hooks/scripts/lib.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces:
  - `readStdin(): Promise<object>` — stdin の JSON をパースして返す
  - `emit(decision: "allow"|"deny"|"ask", reason: string): never` — PreToolUse の hookSpecificOutput を stdout に書いて `process.exit(0)`
  - `hasSkillInvocation(transcriptPath: string, skillName: string): boolean` — transcript(JSONL)に該当スキルの Skill tool_use があるか。ファイルが読めなければ **throw する**(フェイルオープンの判断は呼び出し側)

**重要な設計上の注意:** 既読判定を単純な文字列 grep にすると、第1層が注入するトリガー表自体に `revelation:fable-restraint` 等の文字列が含まれるため、未読なのに既読と誤判定する。必ず JSONL の各行をパースし、`message.content[]` 内の `type === "tool_use"` かつ `name === "Skill"` のエントリの `input.skill` だけを見ること。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/revelation/hooks/scripts/lib.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasSkillInvocation } from "./lib.mjs";

function writeTranscript(lines) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rev-lib-")), "t.jsonl");
  fs.writeFileSync(p, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return p;
}

const skillUse = (skill) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

test("Skill tool_use があれば true", () => {
  const p = writeTranscript([skillUse("revelation:fable-restraint")]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), true);
});

test("別スキルの invoke では false", () => {
  const p = writeTranscript([skillUse("superpowers:brainstorming")]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), false);
});

test("テキスト中にスキル名が現れるだけでは false(注入トリガー表への誤検知防止)", () => {
  const p = writeTranscript([
    { type: "user", message: { content: [{ type: "text", text: 'Skill ツールで revelation:fable-restraint を invoke せよ ("name":"Skill")' }] } },
  ]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), false);
});

test("壊れた JSON 行はスキップして残りを読む", () => {
  const p = writeTranscript(['{"Skill" broken json', JSON.stringify(skillUse("revelation:fable-restraint"))]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), true);
});

test("transcript が存在しなければ throw(フェイルオープン判断は呼び出し側)", () => {
  assert.throws(() => hasSkillInvocation("/nonexistent/t.jsonl", "revelation:fable-restraint"));
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/revelation/hooks/scripts/lib.test.mjs`
Expected: FAIL(`Cannot find module ... lib.mjs`)

- [ ] **Step 3: lib.mjs を実装する**

`plugins/revelation/hooks/scripts/lib.mjs`(`readStdin`/`emit` は codiel の `hooks/scripts/lib.mjs` と同形):

```js
import fs from "node:fs";

export async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}

export function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }) + "\n");
  process.exit(0);
}

// transcript(JSONL)に、指定スキルの Skill ツール呼び出しが記録されているか。
// 注入されたトリガー表など「テキスト中のスキル名」に誤反応しないよう、
// tool_use エントリ(name === "Skill")の input.skill だけを見る。
// ファイルが読めない場合は throw する(フェイルオープンの判断は呼び出し側)。
export function hasSkillInvocation(transcriptPath, skillName) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.includes('"Skill"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === "tool_use" && item.name === "Skill" && item.input?.skill === skillName)
        return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test plugins/revelation/hooks/scripts/lib.test.mjs`
Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/revelation/hooks/scripts/lib.mjs plugins/revelation/hooks/scripts/lib.test.mjs
git commit -m "feat(revelation): フック共有ライブラリと Skill 既読判定を追加"
```

---

### Task 2: 第1層 — SessionStart トリガー表注入

**Files:**
- Create: `plugins/revelation/hooks/trigger-map.md`
- Create: `plugins/revelation/hooks/scripts/inject-trigger-map.mjs`
- Test: `plugins/revelation/hooks/scripts/inject-trigger-map.test.mjs`

**Interfaces:**
- Consumes: なし(lib.mjs も使わない — stdin を読まず、スクリプト相対で trigger-map.md を読むだけ)
- Produces: stdout に `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "<trigger-map.md 全文>"}}`

- [ ] **Step 1: 失敗するテストを書く**

`plugins/revelation/hooks/scripts/inject-trigger-map.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const HOOK = new URL("./inject-trigger-map.mjs", import.meta.url).pathname;

test("トリガー表が SessionStart の additionalContext として出力される", () => {
  const out = execFileSync("node", [HOOK], { input: "{}", encoding: "utf8" });
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.hookEventName, "SessionStart");
  for (const s of ["revelation:fable-method", "revelation:fable-restraint", "revelation:fable-subagents"])
    assert.ok(o.additionalContext.includes(s), `${s} がトリガー表に含まれること`);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/revelation/hooks/scripts/inject-trigger-map.test.mjs`
Expected: FAIL(スクリプトが存在しない)

- [ ] **Step 3: trigger-map.md を作成する**

`plugins/revelation/hooks/trigger-map.md`:

```markdown
## Revelation スキル トリガー表(必読)

以下の場面に該当したら、応答や作業を始める**前に**、必ず Skill ツールで該当スキルを invoke すること。該当するのに invoke しないという選択肢はない。

| 場面 | invoke するスキル |
| --- | --- |
| 複数ステップの実装・調査・デバッグに着手する前 | `revelation:fable-method` |
| コードを変更する前 / テストが落ちたとき / git 操作・削除・上書きなど元に戻しにくい操作の前 / ユーザーから指摘・訂正を受けたとき | `revelation:fable-restraint` |
| サブエージェント(Agent/Task ツール)を起動する前 | `revelation:fable-subagents` |

単純な一問一答・1行の修正・読み取りだけの作業には不要。
```

- [ ] **Step 4: inject-trigger-map.mjs を実装する**

`plugins/revelation/hooks/scripts/inject-trigger-map.mjs`:

```js
#!/usr/bin/env node
// SessionStart フック: トリガー表(trigger-map.md)を additionalContext として注入する。
// 読めない場合は何も出力せず正常終了(フェイルオープン)。
import fs from "node:fs";

try {
  const content = fs.readFileSync(new URL("../trigger-map.md", import.meta.url), "utf8");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: content },
  }) + "\n");
} catch {}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test plugins/revelation/hooks/scripts/inject-trigger-map.test.mjs`
Expected: PASS(1 test)

- [ ] **Step 6: コミット**

```bash
git add plugins/revelation/hooks/trigger-map.md plugins/revelation/hooks/scripts/inject-trigger-map.mjs plugins/revelation/hooks/scripts/inject-trigger-map.test.mjs
git commit -m "feat(revelation): SessionStart トリガー表注入フックを追加"
```

---

### Task 3: 第2層 — PreToolUse リマインド(1回だけの差し戻し)

**Files:**
- Create: `plugins/revelation/hooks/scripts/remind-skill.mjs`
- Test: `plugins/revelation/hooks/scripts/remind-skill.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `readStdin()` / `emit(decision, reason)` / `hasSkillInvocation(transcriptPath, skillName)`
- Produces: PreToolUse hookSpecificOutput(allow / deny)。テスト用に環境変数 `REVELATION_STATE_DIR` でマーカー置き場を差し替え可能(未設定時は `os.tmpdir()/revelation-remind`)

**挙動仕様(DESIGN.md §3, §4):**
1. `tool_name` が対象外 → allow
2. transcript に該当スキルの invoke 履歴あり → allow(transcript が読めない場合は allow = フェイルオープン)
3. マーカーファイルあり(= このセッションで差し戻し済み)→ allow
4. それ以外 → マーカーを書いてから deny + invoke 誘導メッセージ

- [ ] **Step 1: 失敗するテストを書く**

`plugins/revelation/hooks/scripts/remind-skill.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = new URL("./remind-skill.mjs", import.meta.url).pathname;
let seq = 0;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rev-remind-"));
  return {
    stateDir: path.join(dir, "state"),
    transcript: path.join(dir, "t.jsonl"),
    session: `s-${process.pid}-${seq++}`,
  };
}

function hook(ctx, toolName, transcriptPath) {
  const input = JSON.stringify({
    session_id: ctx.session,
    tool_name: toolName,
    transcript_path: transcriptPath ?? ctx.transcript,
    cwd: os.tmpdir(),
  });
  const out = execFileSync("node", [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir },
  });
  return JSON.parse(out).hookSpecificOutput;
}

const skillUseLine = (skill) => JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

test("未読の Edit は deny(fable-restraint への誘導)、同一セッション2回目は allow", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  const first = hook(ctx, "Edit");
  assert.equal(first.permissionDecision, "deny");
  assert.match(first.permissionDecisionReason, /revelation:fable-restraint/);
  assert.equal(hook(ctx, "Edit").permissionDecision, "allow");
});

test("fable-restraint invoke 済みなら Write は allow(マーカー消費なし)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, skillUseLine("revelation:fable-restraint") + "\n");
  assert.equal(hook(ctx, "Write").permissionDecision, "allow");
  // 既読による allow はマーカーを消費しない(deny 履歴が残らない)
  assert.equal(fs.existsSync(ctx.stateDir), false);
});

test("Task/Agent は fable-subagents を要求する(restraint 既読でも別枠)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, skillUseLine("revelation:fable-restraint") + "\n");
  const r = hook(ctx, "Task");
  assert.equal(r.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /revelation:fable-subagents/);
});

test("スキルごとにマーカーは独立(restraint の差し戻し後も subagents は差し戻される)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  assert.equal(hook(ctx, "Edit").permissionDecision, "deny");
  assert.equal(hook(ctx, "Agent").permissionDecision, "deny");
  assert.equal(hook(ctx, "Agent").permissionDecision, "allow");
});

test("対象外ツールは allow", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  assert.equal(hook(ctx, "Read").permissionDecision, "allow");
});

test("transcript が読めなければ allow(フェイルオープン)", () => {
  const ctx = setup();
  const r = hook(ctx, "Edit", "/nonexistent/t.jsonl");
  assert.equal(r.permissionDecision, "allow");
});

test("入力が JSON として壊れていても allow で終了する(フェイルオープン)", () => {
  const ctx = setup();
  const out = execFileSync("node", [HOOK], {
    input: "not-json",
    encoding: "utf8",
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir },
  });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "allow");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test plugins/revelation/hooks/scripts/remind-skill.test.mjs`
Expected: FAIL(スクリプトが存在しない)

- [ ] **Step 3: remind-skill.mjs を実装する**

`plugins/revelation/hooks/scripts/remind-skill.mjs`:

```js
#!/usr/bin/env node
// PreToolUse フック: 対象ツールの初回使用前に、対応する revelation スキルが
// このセッションでまだ invoke されていなければ 1 回だけ差し戻して invoke を促す。
// 判定不能な状況ではすべて素通し(フェイルオープン)— 規律の補助でユーザーの作業を止めない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStdin, emit, hasSkillInvocation } from "./lib.mjs";

const TOOL_TO_SKILL = new Map([
  ["Edit", "revelation:fable-restraint"],
  ["Write", "revelation:fable-restraint"],
  ["Task", "revelation:fable-subagents"],
  ["Agent", "revelation:fable-subagents"],
]);

try {
  const input = await readStdin();
  const skill = TOOL_TO_SKILL.get(input.tool_name);
  if (!skill) emit("allow", "");

  let invoked = false;
  try {
    invoked = hasSkillInvocation(input.transcript_path, skill);
  } catch {
    emit("allow", ""); // transcript が読めない → フェイルオープン
  }
  if (invoked) emit("allow", "");

  const dir = process.env.REVELATION_STATE_DIR || path.join(os.tmpdir(), "revelation-remind");
  const marker = path.join(dir, `${input.session_id}-${skill.replace(/[^a-zA-Z0-9-]/g, "_")}`);
  if (fs.existsSync(marker)) emit("allow", "");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marker, "");
  emit("deny", `[revelation] このセッションではまだ ${skill} を読んでいません。先に Skill ツールで ${skill} を invoke して規律を確認してから、この操作を再試行してください(この差し戻しは 1 回だけです)。`);
} catch {
  emit("allow", "");
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test plugins/revelation/hooks/scripts/remind-skill.test.mjs`
Expected: PASS(7 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/revelation/hooks/scripts/remind-skill.mjs plugins/revelation/hooks/scripts/remind-skill.test.mjs
git commit -m "feat(revelation): PreToolUse スキル未読リマインドフックを追加"
```

---

### Task 4: hooks.json・ドキュメント更新・全体検証

**Files:**
- Create: `plugins/revelation/hooks/hooks.json`
- Modify: `plugins/revelation/README.md`(「既知の制約」節)
- Modify: `CLAUDE.md`(ルート。開発コマンド表のスクリプト系テスト)

**Interfaces:**
- Consumes: Task 2 の `inject-trigger-map.mjs`、Task 3 の `remind-skill.mjs`(いずれも `${CLAUDE_PLUGIN_ROOT}` 相対で参照)
- Produces: プラグインとして完結したフック層

- [ ] **Step 1: hooks.json を作成する**

`plugins/revelation/hooks/hooks.json`(task-utility と同じ wrapper 形式):

```json
{
  "description": "revelation スキルの適用補助: SessionStart でトリガー表を注入し、PreToolUse で未読スキルを1回だけ差し戻して invoke を促す",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/inject-trigger-map.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/remind-skill.mjs\"",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "Task|Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/remind-skill.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: hooks.json が妥当な JSON であることを確認する**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/revelation/hooks/hooks.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: README.md の「既知の制約」節を更新する**

`plugins/revelation/README.md` の以下の節:

```markdown
## 既知の制約

このスキル群は、モデルが自発的にスキルを invoke する規律を持っていることに依存する。皮肉なことに、規律を最も必要とするモデルほどこの前提が弱い。フック(SessionStart 等)によるチートシートの強制注入は将来の検討事項。
```

を次に置き換える:

```markdown
## フック層

スキルの自発的な invoke に依存する pull 型の仕組みは、規律を最も必要とする下位モデルほど機能しない(実運用で「そもそも invoke しない」ことを確認済み)。このため `hooks/` に2層の補助を持つ:

1. **SessionStart トリガー表注入** — セッション開始時に約10行のトリガー表(いつ・どのスキルを invoke するか)を注入する。チートシート全文は注入しない(スキル本体との二重管理と「読んだ気」の逆効果を避ける)。
2. **PreToolUse リマインド** — 最初の Edit/Write の前に `fable-restraint`、最初の Agent/Task の前に `fable-subagents` が未読なら、1回だけ差し戻して invoke を促す。判定不能時はすべて素通し(フェイルオープン)。

設計の詳細と将来課題(モデル判別による出し分け等)は `docs/DESIGN.md` を参照。

テスト: `node --test plugins/revelation/hooks/scripts/*.test.mjs`
```

- [ ] **Step 4: ルート CLAUDE.md の開発コマンド表を更新する**

`CLAUDE.md` の行:

```markdown
| スクリプト系テスト | `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs` |
```

を次に置き換える:

```markdown
| スクリプト系テスト | `node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs plugins/revelation/hooks/scripts/*.test.mjs` |
```

- [ ] **Step 5: 全テストを回す**

Run: `node --test plugins/revelation/hooks/scripts/*.test.mjs && node --test plugins/codiel/scripts/*.test.mjs plugins/task-utility/scripts/*.test.mjs`
Expected: すべて PASS(revelation 13 tests + 既存テストに退行なし)

- [ ] **Step 6: コミット**

```bash
git add plugins/revelation/hooks/hooks.json plugins/revelation/README.md CLAUDE.md
git commit -m "feat(revelation): フック層を hooks.json で有効化しドキュメントを更新"
```

---

## 実機確認(実装完了後・手動)

フック設定はセッション開始時に読み込まれるため、Claude Code を再起動して Sonnet/Haiku セッションで以下を観測する(DESIGN.md §5):

1. セッション冒頭にトリガー表が additionalContext として注入される(`claude --debug` で確認可能)
2. スキル未読のまま Edit/Write すると1回だけ差し戻され、モデルがスキルを invoke してから再試行する
3. invoke 後および2回目以降は素通しになる
