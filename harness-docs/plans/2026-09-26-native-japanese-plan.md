# native-japanese 新設と agent-policy からの文書規律の撤去 実装計画書

- 作成日: 2026-09-26
- 対象プラグイン: `plugins/native-japanese`(新規。`0.1.0-dev`)、`plugins/agent-policy`(`0.20.0-dev` → `0.20.1-dev`)
- 設計書(正本): `harness-docs/design/2026-09-26-native-japanese-design.md`(以下「設計書」)
- 設計書のユーザー承認: 取得済み(2026-09-26)(コミット `407879f`)
- 計画立案時の HEAD: `0e4639f`(本計画書の初版と、設計書 §8-3・§8-4 の更新を含む)
- 前提: 計画立案時点で `plugins/native-japanese/` は無い。agent-policy の `plugin.json` と `package.json` は `0.20.0-dev`
- 実装は別セッションで行う。

この計画書はタスクの分割・順序・検証方法・タスク間の契約だけを定め、設計判断を上書きしない。各タスクの要点に設計書の節番号を添える。実装者は設計書の該当節を正本として読み、対象ファイルを実際に読んでから手を入れる。設計書・実コード・この計画書の間に食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。オーケストレーターは §7 に記録し、設計書の修正要否を判断する。

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`。変更が要るかは T9 でオーケストレーターが確かめ、要るときだけ metatron のスキルと CLI で行う。
- `.claude/rules/metatron/` の 3 ファイル(`conventions.md`・`protected-paths.md`・`testing-policy.md`)。
- `.raphael/`(`antibodies/` を含む)。
- 派生元のキャッシュディレクトリ `/home/hiro0209/.claude/plugins/cache/natural-japanese/`。素材として読むだけにする。
- `plugins/*/scripts/` の手編集。`src/` を変え、`pnpm run build` で再生成する。
- `.serena/memories/` を Edit / Write で触ること。T5 でオーケストレーターが Serena の `edit_memory` で行う。
- `.claude/agents/`。T6 でオーケストレーターが `setup-agents.mjs` で再生成するときだけ書き換わる。
- 本件と無関係な未コミット変更。計画立案時点で `.claude/settings.json`、`CLAUDE.md`、`cliproxyapi.config.example.yaml`、`docs/chat/`、`.raphael/antibodies/` に未コミット変更がある。T0 で記録し、触らず、revert もしない。コミットには含めない。
- 設計書 §11 の未解決事項(`CLAUDE.md` の派生元スキルの使用指示)。本計画の範囲外とする。

## 1. 進め方の共通規律

### 全体の制約

設計書から原文の値で写す。

- native-japanese の `plugin.json` と `package.json` の `version` は `0.1.0-dev` で揃える(設計書 §4-2)。
- agent-policy の `plugin.json` と `package.json` の `version` は `0.20.1-dev` で揃える(設計書 §8-3)。
- `references/discipline.md` は 9,000 文字以内とし、テストで守る(設計書 §2-3、§4-4)。
- 派生元の名前(`natural-japanese`、`coji`)を書いてよいのは `plugins/native-japanese/LICENSE` と `plugins/native-japanese/README.md` の「由来」節だけである。`discipline.md`、`plugin.json` と `marketplace.json` の `description`、README の説明文には書かない(設計書 §7)。
- `discipline.md` に他プラグインの名前を書かない(設計書 §2-3、ARCHITECTURE「禁止される依存方向」)。
- `inject.ts` はほかのモジュールを import しない。使ってよいのは `node:fs`・`node:path`・`node:url` だけである(設計書 §4-2)。
- ブランチを切らない(プロジェクト規約)。main で作業する。
- コミットは「native-japanese の新設」と「agent-policy からの撤去」の 2 つに分ける(設計書 §9-2)。本計画書は `0e4639f` でコミット済みである。
- `git add` はパスを列挙して行う。`git add -A` と `git add .` は使わない。

### 作業の規律

- テストを伴うタスクでは、テストを先に書いてから実装する。タスクの完了時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ることを完了条件にする。
- `plugins/*/src/` を変えるタスクは、最後に `pnpm run build` を実行し、対応する `scripts/` の差分を同じコミットに含める。
- 整形は `pnpm exec biome check --write <対象ディレクトリ>` で行う。付録と手順のコードは biome の整形で改行位置が変わってよい。中身は変えない。
- 各タスクの「生み出す契約」の名前・パス・形は、タスク間の契約である。担当は変えない。変える必要が出たら止めて報告する。
- 各タスクの「検証」のテストケースは最低限の一覧である。担当が足すのはよい。削るのは報告を要する。
- スキルは各タスクの「スキル」行に書いたものだけをロードする。
- 設計判断・要件の追加・スコープの拡大は担当が決めず、オーケストレーターへ差し戻す。

### レビューの焦点

設計書が暗に要求しているのに、設計書 §4-4 の 8 ケースと §8-2 の撤去後のテストのどれも検査しない入力や条件を 5 件挙げる。担当タスクにテストか検証を足した。T8 のコードレビューでは、この 5 件を必ず見る。

| # | 入力・条件 | 検査するタスク |
| --- | --- | --- |
| R1 | 失敗したときに stderr へ何も書かない(設計書 §5-3) | T2 のテスト「失敗しても stderr に書かない」 |
| R2 | 標準入力が空、JSON の `null`、`hook_event_name` が文字列でない(設計書 §5-3 の列挙のうち 8 ケースに無いもの) | T2 のテスト「〜なら何も出力しない」の追加の 3 行 |
| R3 | 出力が末尾に改行を持つ 1 行である(設計書 §5-2) | T2 のテスト「〜で discipline.md の全文を 1 行の JSON で注入する」 |
| R4 | バンドル後の `scripts/inject.mjs` が、cwd に依らず `../references/discipline.md` を読める(設計書 §4-4、§5-3)。テストはソースしか起動しない | T2 の検証コマンド 2、T7 の目視検証 |
| R5 | 撤去後の合成定義に、日英どちらでも執筆の節が現れない(設計書 §8-1)。撤去で消えるテストの裏返しを誰も検査しない | T4 のテスト「日英の合成定義に執筆の節を出さない」 |

## 2. タスク

### T0: baseline(オーケストレーター)

**要点**: 着手前の状態を記録する。

**触るファイル**: なし。

**消費する契約・生み出す契約**: 生み出すのは §9 実施記録の T0 の欄。

**手順**:

1. `git rev-parse --short HEAD` を記録する。`0e4639f` 以降のコミットがあれば、その一覧を `git log --oneline 0e4639f..HEAD` で記録する。
2. `git status --short` で本件と無関係な未コミット変更を記録する。
3. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` を実行し、結果とテスト件数(全体と agent-policy)を記録する。
4. `plugins/native-japanese` が無いことを `ls plugins` で確かめる。
5. `plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` が `0.20.0-dev` であることを確かめる。
6. `grep -c writingHeading plugins/agent-policy/scripts/setup-agents.mjs` の件数を記録する(計画立案時は 4)。

**検証**: 4 コマンドがすべて通る。通らないとき、`plugins/native-japanese` があるとき、agent-policy の version が違うときは本件に入らず報告する。

**コミット**: なし。

### T1: `references/discipline.md`

**要点**: 設計書 §6(節構成と各節の項目)、§2-3(9,000 文字以内、他プラグイン名なし)、§3(基底層の宣言を節 1 に置く)、§7(派生元の名前を書かない)。

**触るファイル**: `plugins/native-japanese/references/discipline.md`(新規)。

**消費する契約・生み出す契約**: 生み出す契約は §4 の「discipline.md」の行。

**スキル**: `prompt-smith:prompt-smith`、`natural-japanese:natural-japanese`(クイック)。

**担当**: 通常の実装。

**手順**:

1. 付録 A の草案全文を `plugins/native-japanese/references/discipline.md` に置く。フェンスの行(````` ````markdown ````` と `````` ```` ``````)は含めない。
2. `prompt-smith:prompt-smith` の「削る基準」「残す基準」「書き方の基準」で 1 パス削る。節 4 と節 5 は引くための記述として扱い、重複・例の基準を当てない。
3. 削った後も次を保つ。
   - 1 行目の見出しは `# 日本語の書き方` のまま変えない(T7 の目視検証が使う)。
   - 節 1〜6 の見出しと順序(`## 適用範囲` / `## 構成` / `## 文` / `## 翻訳調の言い換え` / `## 避ける語` / `## 訳語`)を変えない。
   - 設計書 §6 の各節の項目をすべて残す。
   - 9,000 文字以内。
4. 行数が 120 行を下回ったときは、行を足して合わせず、削った項目を報告に列挙する。オーケストレーターが §7 に記録する。
5. 文字数と行数を次のコマンドで測り、報告に書く。

```bash
node -e 'const t=require("fs").readFileSync("plugins/native-japanese/references/discipline.md","utf8");console.log(t.length, t.split("\n").length - (t.endsWith("\n") ? 1 : 0))'
```

**検証**:

- 上のコマンドの 1 つ目の値が 9000 以下。
- `grep -n -i -e natural-japanese -e coji -e agent-policy -e prompt-smith -e metatron -e codiel plugins/native-japanese/references/discipline.md` が 0 件。
- `grep -c "^## " plugins/native-japanese/references/discipline.md` が 6。
- `head -1 plugins/native-japanese/references/discipline.md` が `# 日本語の書き方`。

**コミット**: なし(T3 の後に、コミット 1 でまとめる)。

### T2: 注入スクリプト・テスト・hook・ビルド定義

**要点**: 設計書 §3(3 つの構成要素)、§4-1(ディレクトリ)、§4-2(`plugin.json`・`hooks.json`・`inject.ts`・`build.ts`・`package.json`)、§4-4(テストの配置と 8 ケース、一時ディレクトリへの複製)、§5(契約の全体)。レビューの焦点 R1〜R4。

**触るファイル**(すべて新規):

- `plugins/native-japanese/.claude-plugin/plugin.json`
- `plugins/native-japanese/hooks/hooks.json`
- `plugins/native-japanese/src/inject.ts`
- `plugins/native-japanese/src/__test__/inject.test.ts`
- `plugins/native-japanese/src/testing/run-ts.ts`
- `plugins/native-japanese/build.ts`
- `plugins/native-japanese/package.json`
- `plugins/native-japanese/scripts/inject.mjs`(ビルド出力)

**消費する契約・生み出す契約**: 消費するのは T1 の `discipline.md`(パスと 9,000 文字の上限)。生み出すのは §4 の「注入スクリプト」「hook」「バージョンと description」の行。

**スキル**: 不要。

**担当**: 通常の実装。

**手順**:

1. `plugins/native-japanese/src/testing/run-ts.ts` を置く。中身は `plugins/gh-utility/src/testing/run-ts.ts` と同一にする(設計書 §4-4)。

```ts
import { type ExecFileSyncOptions, execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

// TypeScript ソースを tsx 経由で子プロセス実行する(ビルド前でもテストできるようにするため)。
// exit code・stdout/stderr の契約を検証するテスト用。opts で cwd / input / env を指定できる。
export function runTs(
  script: string,
  args: string[] = [],
  opts: ExecFileSyncOptions = {}
): string {
  return execFileSync(process.execPath, [TSX_CLI, script, ...args], {
    encoding: "utf8",
    ...opts
  }) as string
}
```

2. テストを先に書く。`plugins/native-japanese/src/__test__/inject.test.ts` を次の内容で置く。一時ディレクトリには `package.json`(`{"type":"module"}`)も置く。tsx がスクリプトを ESM として読み、`import.meta.url` が使えるようにするためである。「差し替えた本文を注入する」は、一時ディレクトリでの起動そのものが壊れていないことを示す対照で、ファイル不在と空白だけの本文のケースが空振りでパスするのを防ぐ。

```ts
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../inject.ts", import.meta.url))
const DISCIPLINE = fileURLToPath(
  new URL("../../references/discipline.md", import.meta.url)
)
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const SESSION_START = JSON.stringify({ hook_event_name: "SessionStart" })

function inject(input: string, script = SCRIPT): string {
  return runTs(script, [], { input })
}

// src/inject.ts だけを複製したプラグインルートを一時ディレクトリに作る。
// discipline が null なら references/ を置かない。
function withPluginRoot(
  discipline: string | null,
  run: (script: string) => void
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-"))
  try {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n')
    fs.mkdirSync(path.join(root, "src"))
    const script = path.join(root, "src", "inject.ts")
    fs.copyFileSync(SCRIPT, script)
    if (discipline !== null) {
      fs.mkdirSync(path.join(root, "references"))
      fs.writeFileSync(
        path.join(root, "references", "discipline.md"),
        discipline
      )
    }
    run(script)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test.each(["SessionStart", "SubagentStart"])(
  "%s で discipline.md の全文を 1 行の JSON で注入する",
  (event) => {
    const out = inject(JSON.stringify({ hook_event_name: event }))
    expect(out.endsWith("\n")).toBe(true)
    expect(out.slice(0, -1)).not.toContain("\n")
    expect(JSON.parse(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: fs.readFileSync(DISCIPLINE, "utf8")
      }
    })
  }
)

test.each([
  ["イベント名が無い", "{}"],
  ["未知のイベント名", JSON.stringify({ hook_event_name: "Stop" })],
  ["JSON として読めない", "not json"],
  ["標準入力が空", ""],
  ["JSON の null", "null"],
  ["イベント名が文字列でない", JSON.stringify({ hook_event_name: 1 })]
])("%s なら何も出力しない", (_, input) => {
  expect(inject(input)).toBe("")
})

test("差し替えた本文を注入する(一時ディレクトリでの起動の対照)", () => {
  withPluginRoot("# 見出し\n\n- 本文\n", (script) => {
    expect(
      JSON.parse(inject(SESSION_START, script)).hookSpecificOutput
        .additionalContext
    ).toBe("# 見出し\n\n- 本文\n")
  })
})

test("discipline.md が無ければ何も出力しない", () => {
  withPluginRoot(null, (script) => {
    expect(inject(SESSION_START, script)).toBe("")
  })
})

test("discipline.md が空白だけなら何も出力しない", () => {
  withPluginRoot(" \n\t\n  \n", (script) => {
    expect(inject(SESSION_START, script)).toBe("")
  })
})

test("失敗しても stderr に書かない", () => {
  withPluginRoot(null, (script) => {
    for (const input of ["not json", SESSION_START]) {
      const result = spawnSync(process.execPath, [TSX_CLI, script], {
        input,
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1" }
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toBe("")
    }
  })
})

test("discipline.md は 9,000 文字以内", () => {
  expect(fs.readFileSync(DISCIPLINE, "utf8").length).toBeLessThanOrEqual(
    9000
  )
})
```

3. `pnpm exec vitest run plugins/native-japanese` を実行し、`inject.ts` が無いために失敗することを確かめる。
4. `plugins/native-japanese/src/inject.ts` を次の内容で置く。失敗時の早期終了は `plugins/prefetch/src/check-prefetch-manifest.ts` の `process.exit(0)` の形に倣う。本文のパスは `import.meta.url` から解決し、`CLAUDE_PLUGIN_ROOT` を読まない(設計書 §5-3)。`fs.readFileSync` は URL を直接受け取るので、`node:path` と `node:url` は使わない。

```ts
#!/usr/bin/env node
// SessionStart と SubagentStart で、references/discipline.md の全文を
// additionalContext として注入する。どの失敗でも何も書かず exit 0 で終える。

import fs from "node:fs"

const EVENTS = ["SessionStart", "SubagentStart"]

let event: unknown
try {
  const input = JSON.parse(fs.readFileSync(0, "utf8")) as {
    hook_event_name?: unknown
  } | null
  event = input?.hook_event_name
} catch {
  process.exit(0)
}
if (typeof event !== "string" || !EVENTS.includes(event)) process.exit(0)

let discipline: string
try {
  discipline = fs.readFileSync(
    new URL("../references/discipline.md", import.meta.url),
    "utf8"
  )
} catch {
  process.exit(0)
}
if (discipline.trim() === "") process.exit(0)

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: discipline
    }
  })}\n`
)
```

5. `plugins/native-japanese/build.ts` を置く。形は `plugins/prefetch/build.ts` と同じにする。

```ts
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    inject: "./src/inject.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
```

6. `plugins/native-japanese/package.json` を置く。

```json
{
  "name": "native-japanese-scripts",
  "version": "0.1.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

7. `plugins/native-japanese/.claude-plugin/plugin.json` を置く。`description` は §4 の共有契約の文をそのまま使う。

```json
{
  "name": "native-japanese",
  "description": "日本語で書く出力のすべてに、翻訳調や決まり文句を避けて結論から書く規律を、セッション開始時とサブエージェント起動時に注入する",
  "version": "0.1.0-dev"
}
```

8. `plugins/native-japanese/hooks/hooks.json` を置く。どちらのイベントも `matcher` を持たない(設計書 §4-2)。

```json
{
  "description": "日本語の書き方の規律を、セッション開始時とサブエージェント起動時に注入する",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/inject.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/inject.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

9. `pnpm exec biome check --write plugins/native-japanese` で整形する。
10. `pnpm exec vitest run plugins/native-japanese` がパスすることを確かめる。
11. `cd plugins/native-japanese && pnpm exec tsx build.ts` で `scripts/inject.mjs` を作る。ワークスペースへの登録(T3)の前なので、`pnpm run build` はまだ本プラグインを含まない。T3 で `pnpm run build` を通し直す。

**検証**:

1. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。native-japanese のテストは 13 件(`test.each` の 2 + 6、単独の 5)。
2. バンドル後のパス解決(R4)。cwd をリポジトリの外に置いて、次を実行する。出力が `SessionStart true` と `SubagentStart true` の 2 行になる。

```bash
cd /tmp
for e in SessionStart SubagentStart; do
  echo "{\"hook_event_name\":\"$e\"}" \
    | node /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/native-japanese/scripts/inject.mjs \
    | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8")).hookSpecificOutput;const t=fs.readFileSync("/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/native-japanese/references/discipline.md","utf8");console.log(o.hookEventName, o.additionalContext===t)'
done
```

3. `echo '{"hook_event_name":"Stop"}' | node plugins/native-japanese/scripts/inject.mjs; echo "exit=$?"` の出力が `exit=0` の 1 行だけ。
4. `grep -n -e "^import" plugins/native-japanese/src/inject.ts` が `import fs from "node:fs"` の 1 行だけ。

**コミット**: なし(コミット 1 でまとめる)。

### T3: README・LICENSE・ワークスペースと marketplace への登録

**要点**: 設計書 §4-2(README に置く内容)、§4-3(ワークスペース・marketplace・ルート README)、§7(LICENSE と「由来」節)。

**触るファイル**:

- `plugins/native-japanese/README.md`(新規)
- `plugins/native-japanese/LICENSE`(新規)
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`(`pnpm install` による更新)
- `.claude-plugin/marketplace.json`
- `README.md`(ルート)
- `plugins/native-japanese/scripts/inject.mjs`(`pnpm run build` で差分が出ないことを確かめるだけ)

**消費する契約・生み出す契約**: 消費するのは §4 の「バージョンと description」「hook」の行と、T1 の `discipline.md` の節見出し。生み出す契約は無い。

**スキル**: `natural-japanese:natural-japanese`(クイック。README とルート README の文面だけに使う)。

**担当**: 軽量な実装。

**手順**:

1. `plugins/native-japanese/LICENSE` を次の内容で置く。本文は派生元の `LICENSE` と同じ MIT の許諾文で、著作権表示を 2 行にする(設計書 §7)。

```text
MIT License

Copyright (c) 2026 amatsuka-koubou
Copyright (c) 2026 coji (references/discipline.md is derived from coji/natural-japanese v1.5.0)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

2. `plugins/native-japanese/README.md` を、次の章立てと内容で書く。形は `plugins/prefetch/README.md` の冒頭 3 章(導入文・動作要件・導入)に揃える。派生元の名前は「由来」節にだけ書く。

   | 章 | 書く内容 |
   | --- | --- |
   | `# native-japanese` と導入文 | 日本語で書く出力(会話の返答・コード内のコメント・コミットメッセージ・文書)に、書き方の規律を注入するプラグインであること。スキルと違い、呼び出さなくても毎回届くこと |
   | `## 動作要件` | `plugins/prefetch/README.md` の同名の章と同じ内容(Node.js 22 以上が PATH 上に要る) |
   | `## 導入` | `plugins/prefetch/README.md` の同名の章の手順で、`prefetch` を `native-japanese` に置き換えたもの。導入後にセッションを再起動すること |
   | `## 注入される内容` | 本文は `references/discipline.md` の全文であること。6 つの節(適用範囲・構成・文・翻訳調の言い換え・避ける語・訳語)の名前と、それぞれが何を定めるかを 1 行ずつ。本文は 9,000 文字以内に保っていること |
   | `## 届くタイミング` | SessionStart(起動・再開・`/clear`・`/compact`・fork のすべて)と SubagentStart(すべてのサブエージェント)の 2 つで、同じ本文が届くこと |
   | `## 他の口調指示との関係` | 設計書 §3 の層の説明。口調と文体(敬体と常体、圧縮した口調、体言止めなど)を CLAUDE.md・output style・他の注入が決めているときは、その項目だけが上書きされること。翻訳調の言い換えや結論を先に書く規律は残ること |
   | `## 無効にする方法` | `/plugin` の管理画面で native-japanese を無効にし、セッションを再起動すること。規律の一部だけを止める設定は無いこと |
   | `## 規律を直すとき` | `references/discipline.md` を編集するだけでよく、ビルドは要らないこと。9,000 文字を超えるとテストが失敗すること |
   | `## 由来` | 下の文面 |
   | `## ライセンス` | MIT License であることと、`LICENSE` を参照すること |

   「由来」節の文面(本文に載せる):

```markdown
## 由来

`references/discipline.md` の規律は、[coji/natural-japanese](https://github.com/coji/natural-japanese) v1.5.0(MIT License)の文体憲法・禁止語のカタログ・翻訳調のパターン集・読みやすさの原則から、書く瞬間に当てられる項目を抜き出し、常に適用する規律として組み直したものです。

natural-japanese は、文書を作るときに呼び出して設計・執筆・検査・収束の工程を回すスキルです。本プラグインは工程も検査スクリプトも持たず、規律だけを常に届けます。両者は併用できます。併用すると本プラグインの規律が下地になり、文書を仕上げる工程は natural-japanese が担います。
```

3. `pnpm-workspace.yaml` の `packages` の末尾(`  - plugins/jevriel` の次の行)に 1 行を足す。

```yaml
  - plugins/jevriel
  - plugins/native-japanese
allowBuilds:
```

4. `pnpm install` を実行する。`pnpm-lock.yaml` の `importers` に `plugins/native-japanese` が加わる。
5. `.claude-plugin/marketplace.json` の `plugins` 配列の末尾(`jevriel` の要素の後)に 1 要素を足す。`description` は `plugin.json` と同じ文にする。

```json
    {
      "name": "native-japanese",
      "source": "./plugins/native-japanese",
      "description": "日本語で書く出力のすべてに、翻訳調や決まり文句を避けて結論から書く規律を、セッション開始時とサブエージェント起動時に注入する"
    }
```

6. ルート `README.md` の「配布プラグイン」表(`README.md:44` の節)の `jevriel` の行の次に 1 行を足す。

```markdown
| native-japanese | 日本語で書く出力に、翻訳調や決まり文句を避けて結論から書く規律を、毎セッションとサブエージェントへ注入するプラグイン | 開発中 |
```

7. ルート `README.md` の末尾の `### jevriel` の節の後に、次の節を足す(本文に載せる)。

```markdown
### native-japanese

日本語で書く出力に、翻訳調や決まり文句を避けて結論から書く規律を注入するプラグインです。<br>
セッションの開始時(`/clear` と `/compact` の後を含む)とサブエージェントの起動時に、同じ規律をコンテキストへ加えます。会話の返答・コードコメント・コミットメッセージ・文書のすべてが対象です。<br>
敬体と常体などの口調を別の指示で決めている場合は、その項目だけ別の指示が優先されます。
```

8. `pnpm run build` を実行する。

**検証**:

1. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` が通る。
2. 手順 8 の前と後で `sha256sum plugins/native-japanese/scripts/inject.mjs` を取り、値が一致する(ワークスペース経由のビルドが T2 のビルドと同じ出力を作る)。
3. `grep -n "native-japanese" pnpm-workspace.yaml .claude-plugin/marketplace.json README.md pnpm-lock.yaml` が 4 ファイルすべてで 1 件以上。
4. `node -e 'const m=require("./.claude-plugin/marketplace.json").plugins.find(p=>p.name==="native-japanese");const p=require("./plugins/native-japanese/.claude-plugin/plugin.json");console.log(m.description===p.description)'` が `true`。
5. 派生元の名前の位置(設計書 §7): `grep -rn -i -e natural-japanese -e coji plugins/native-japanese --include=*.md --include=*.json` の該当が `README.md` の「由来」節の中だけ。`LICENSE` は拡張子が無いので対象外になる。
6. `grep -c "^Copyright" plugins/native-japanese/LICENSE` が 2。

**コミット**: コミット 1(§5)。T1〜T3 の成果物をまとめてコミットする。

### T4: agent-policy からの文書規律の撤去

**要点**: 設計書 §8-1(撤去の理由と帰結)、§8-2(削る箇所)、§8-3(バージョンと README の追随)。レビューの焦点 R5。

**触るファイル**:

- `plugins/agent-policy/references/orchestration-discipline.md`
- `plugins/agent-policy/assets/roles/ja/_common.md`
- `plugins/agent-policy/assets/roles/en/_common.md`
- `plugins/agent-policy/src/agents/compose.ts`
- `plugins/agent-policy/src/agents/vocabulary.ts`
- `plugins/agent-policy/src/agents/__test__/compose.test.ts`
- `plugins/agent-policy/scripts/setup-agents.mjs`(ビルド出力)
- `plugins/agent-policy/.claude-plugin/plugin.json`
- `plugins/agent-policy/package.json`
- `plugins/agent-policy/README.md`

**消費する契約・生み出す契約**: 生み出すのは §4 の「撤去後の agent-policy」の行。

**スキル**: `prompt-smith:prompt-smith`(`orchestration-discipline.md` と `_common.md` の削除後の見え方を確かめるためだけに使い、ほかの文は書き換えない)、`natural-japanese:natural-japanese`(クイック。README の移行の項目だけに使う)。

**担当**: 通常の実装。

**手順**:

1. テストを先に直す。`plugins/agent-policy/src/agents/__test__/compose.test.ts` を次のとおり変える。
   - 「節の順序が仕様どおりになる」(192-209 行): 配列 `order` から 199 行の `"## 文書の執筆",` を削る。直した後の配列は次のとおり。

```ts
    const order = [
      "## When to invoke",
      "## Core Responsibilities",
      "## 作業手順",
      "## アドバイザーへの相談",
      "## 制約",
      "## Output Format"
    ]
```

   - 「執筆の節を Agent の有無にかかわらず一度だけ出す」(211-223 行)と「英語の定義でも執筆の節を出す」(225-229 行)を、間と直後の空行(224 行と 230 行)を含めて削る。
   - 削った位置に、次のテストを足す(R5)。

```ts
  it("日英の合成定義に執筆の節を出さない", () => {
    for (const [lang, fragmentDirs] of [
      ["ja", [PLUGIN_ROLES]],
      ["en", [EN]]
    ] as const) {
      for (const role of ["complex-impl", "code-review"]) {
        const body = build([role], { lang, fragmentDirs })
        expect(body).not.toMatch(/^## (文書の執筆|Writing)$/m)
      }
    }
  })
```

   直した後の 209 行付近の見え方は次のとおり。

```ts
      cursor = at
    }
  })

  it("日英の合成定義に執筆の節を出さない", () => {
    // (上のテスト本体)
  })

  it("日英の合成定義に廃止した役割や探索文書への参照を含めない", () => {
```

2. `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/compose.test.ts` を実行し、「日英の合成定義に執筆の節を出さない」が失敗することを確かめる。
3. `plugins/agent-policy/assets/roles/ja/_common.md` の 27-39 行(`## 文書の執筆` の見出しから、38 行の「Step は…」の項目と直後の空行まで)を削る。削った後の見え方は次のとおり。

```markdown
- 自身が起動したサブエージェントに `Agent` tool を許可しない。

## 制約
```

4. `plugins/agent-policy/assets/roles/en/_common.md` の 27-34 行(`## Writing` の見出しから、33 行の「When writing in a language other than English…」の項目と直後の空行まで)を削る。削った後の見え方は次のとおり。

```markdown
- Do not grant the `Agent` tool to any subagent you start.

## Constraints
```

5. `plugins/agent-policy/src/agents/compose.ts` の 82-85 行(`const writing = …` から `body.push(vocabulary.writingHeading, …)` と直後の空行まで)を削る。削った後の見え方は次のとおり。

```ts
  if (withAgent) {
    const advisor = common.get(vocabulary.advisorHeading)
    if (advisor !== undefined)
      body.push(vocabulary.advisorHeading, "", ...advisor, "")
  }

  const constraints = [
```

6. `plugins/agent-policy/src/agents/vocabulary.ts` の 3 行を削る。7 行の `  writingHeading: string`、19 行の `  writingHeading: "## 文書の執筆",`、32 行の `  writingHeading: "## Writing",` である。削った後の `interface Vocabulary` は次のとおり。

```ts
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
```

7. `plugins/agent-policy/references/orchestration-discipline.md` の 72-83 行(`### 文書の執筆` の見出しから、82 行の「Step は…」の項目と直後の空行まで)を削る。84 行の `### 文書の執筆を委譲するとき` 以下は残す(設計書 §8-2)。削った後の見え方は次のとおり。

```markdown
レビューの指摘が対立し採否の軸を自分で言葉にできないとき、または要件確定で選択肢が複数ありユーザーへ示す判断軸を立てられないときは、advisor に軸と推奨を求めてから判断する。依頼文には選択肢・判断を縛る制約・関係ファイルのパスを含め、推奨は 1 案を求める。結論はオーケストレーターが出し、採否を委ねない。

### 文書の執筆を委譲するとき

- 文書の執筆を委譲する依頼文には、確定した内容・対象ファイルのパス・参照すべき既存文書を渡す。内容の決定はオーケストレーターが担う。
```

8. `plugins/agent-policy/README.md` を 2 箇所直す(§7 の #2)。
   - 212 行(「0.19 系から 0.20 系へ」の 2.)の文「執筆基準は全定義の共通部分に含まれ、再生成で反映されます。」を削る。前後の文は残す。
   - 同じ番号付きリストの末尾(221 行の 10. の後)に 11. を足す(本文に載せる)。

```markdown
11. 0.20.1 で、生成する定義の共通部分から「## 文書の執筆」(英語は「## Writing」)の節を削除しました。日本語の書き方の規律は、このプラグインでは扱いません。生成済みの定義からこの節を消すには、定義ファイルから節を手で削除するか、setup-agents の差分方針で「完全上書き」を選んでください。「保持マージ」では、テンプレートに無い節として残ります。
```

9. `plugins/agent-policy/.claude-plugin/plugin.json` の `"version": "0.20.0-dev"` と、`plugins/agent-policy/package.json` の 3 行目の `"version": "0.20.0-dev",` を、どちらも `0.20.1-dev` にする。
10. `pnpm run build` を実行する。
11. README の追随漏れを探す(設計書 §8-3)。`grep -n -e "文書の執筆" -e "## Writing" -e "執筆基準" plugins/agent-policy/README.md` を実行し、該当が手順 8 で足した移行リストの 11. の 1 行だけであることを確かめる。ほかに該当があれば報告する。

**検証**:

1. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` が通る。agent-policy のテスト件数は T0 から 1 件減る(2 件削って 1 件足す)。
2. `grep -c writingHeading plugins/agent-policy/scripts/setup-agents.mjs` が 0。
3. `git status --short plugins/agent-policy/scripts` の差分が `setup-agents.mjs` の 1 ファイルだけ。
4. `grep -rn -e writingHeading -e "^## 文書の執筆$" -e "^## Writing$" plugins/agent-policy/src plugins/agent-policy/assets` が 0 件。
5. `grep -nx "### 文書の執筆" plugins/agent-policy/references/orchestration-discipline.md` が 0 件で、`grep -n "### 文書の執筆を委譲するとき" plugins/agent-policy/references/orchestration-discipline.md` が 1 件。
6. `grep -n "0.20.1-dev" plugins/agent-policy/.claude-plugin/plugin.json plugins/agent-policy/package.json` が 2 件。

**コミット**: コミット 2(§5)。T5 のメモリの変更と同じコミットにする。

### T5: Serena メモリの追随(オーケストレーター)

**要点**: 設計書 §8-3(`.serena/memories/agent_policy/core.md:116-120`)。

**触るファイル**: `.serena/memories/agent_policy/core.md`(Serena の `edit_memory` だけで変える。Edit / Write は使わない)。

**消費する契約・生み出す契約**: 消費するのは T4 の撤去後の事実。

**スキル**: 不要。

**手順**:

1. `edit_memory` を `memory_name: "agent_policy/core"`、`mode: "literal"` で呼び、116-120 行を置き換える。`needle` は次の 5 行そのまま。

```text
- **Writing standards are common to every definition**: `_common.md` has `## 文書の執筆` / `## Writing`
  (`Vocabulary.writingHeading`), emitted by `compose()` **regardless of `withAgent`**, after the
  advisor section and before `## 制約`. Japanese rewording examples live only in the ja fragment.
  The discipline carries the same standards for the orchestrator (duplication allowed: different
  readers). The orchestrator may now write file-persisted documents itself (F1 withdrawn).
```

   `repl` は次の 6 行。

```text
- **Writing standards were removed in 0.20.1-dev**: `_common.md` (ja/en) no longer has
  `## 文書の執筆` / `## Writing`, `Vocabulary.writingHeading` and its `compose()` branch are gone,
  and the discipline lost `### 文書の執筆` (its `### 文書の執筆を委譲するとき` stays: it governs request
  text, not style). Japanese writing style now comes from the separate `native-japanese` plugin's
  SessionStart/SubagentStart injection; English definitions carry no style rules (accepted trade-off).
  The orchestrator may write file-persisted documents itself (F1 withdrawn).
```

2. `edit_memory` をもう一度 `mode: "literal"` で呼び、1 行目の `(0.20.0-dev, pkg `agent-policy-scripts`)` の `0.20.0-dev` を `0.20.1-dev` にする。`needle` は `` `plugins/agent-policy` (0.20.0-dev, `` とし、`repl` は `` `plugins/agent-policy` (0.20.1-dev, `` とする。

**検証**: `read_memory` で `agent_policy/core` を読み、`Vocabulary.writingHeading` が「removed」の文脈にだけ現れ、1 行目が `0.20.1-dev` である。

**コミット**: コミット 2(§5)。

### T6: Agent 定義の再生成(オーケストレーター)

**要点**: 設計書 §8-4、GOTCHAS の GOTCHA-001。`--check` で差分が「## 文書の執筆」節の有無だけの定義は、`--merge` を付けずに `--write` で上書きする。ほかの差分がある定義は再生成せず、手で節を削る。

**触るファイル**: `.claude/agents/*.md` の 14 ファイル(git の管理外。`.gitignore:14`)。

**消費する契約・生み出す契約**: 消費するのは T4 の撤去後の `scripts/setup-agents.mjs`。

**スキル**: 不要。

**手順**: リポジトリのルートで、1 つの bash セッションの中で順に実行する。期待と違う出力が出たら、その段で止めて手順 8 で戻し、ユーザーへ報告する。

1. T4 の検証 2 で `grep -c writingHeading plugins/agent-policy/scripts/setup-agents.mjs` が 0 であることを確かめ直す。
2. 複製と作業用ディレクトリを作り、14 定義の引数を表にする。表の値は計画立案時の各定義の frontmatter から写した(`model-id` は `README.md` の推奨モデル ID の表で `model` 値から引いた)。表の後のループで、実ファイルの `model`・`agent-policy-vendor`・`agent-policy-role` と表を照合する。`agent-policy-role` はカンマの後に空白を持つので、空白を除いてから比べる。`--roles` には空白付きの値を渡しても通る(`splitList` が各要素を trim する)。

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
SETUP=plugins/agent-policy/scripts/setup-agents.mjs
BACKUP=$(mktemp -d /tmp/agents-backup-XXXXXX)
WORK=$(mktemp -d /tmp/agents-regen-XXXXXX)
cp -a .claude/agents/. "$BACKUP/"
echo "BACKUP=$BACKUP WORK=$WORK"
cat > "$WORK/targets.txt" <<'EOF'
adversarial-reviewer gpt-sol claude-gpt-6-sol gpt adversarial-review
code-reviewer sonnet sonnet claude code-review
complex-reviewer gpt-astra claude-gpt-6-astra gpt e2e-verify,final-review,gate-review
docs-reviewer grok claude-grok-4-7 grok design-review
general-explore grok claude-grok-4-7 grok explore
general-implementer gpt-luna claude-gpt-6-luna gpt normal-impl,light-impl,general
general-worker sonnet sonnet claude general
independent-tech-adviser gpt-astra claude-gpt-6-astra gpt advisor
knowledge-elicitationer haiku haiku claude knowledge-elicitation
lead-implementer gpt-sol claude-gpt-6-sol gpt complex-impl
realtime-researcher grok claude-grok-4-7 grok realtime-research
system-planner opus opus claude design-plan
technical-adviser fable fable claude advisor
technical-leader gpt-astra claude-gpt-6-astra gpt escalation
EOF
for f in .claude/agents/*.md; do
  n=$(basename "$f" .md)
  row=$(grep "^$n " "$WORK/targets.txt") || { echo "表に無い定義: $n"; continue; }
  read -r _ _ t_model t_vendor t_roles <<< "$row"
  model=$(sed -n 's/^model: //p' "$f" | head -1)
  vendor=$(sed -n 's/^agent-policy-vendor: //p' "$f" | head -1)
  roles=$(sed -n 's/^agent-policy-role: //p' "$f" | head -1 | tr -d ' ')
  if [ "$model $vendor $roles" = "$t_model $t_vendor $t_roles" ]; then
    echo "$n 一致"
  else
    echo "$n 不一致: $model $vendor $roles"
  fi
done
```

   期待: 14 行すべて「一致」で、「表に無い定義」が出ない。「不一致」が出たら、表の該当行を実値に直してから進める。

3. 全定義を `--check` し、`mcpCurrent` と差分を控える。

```bash
while read -r name mid model vendor roles; do
  node "$SETUP" --check --name "$name" --model-id "$mid" --model "$model" \
    --vendor "$vendor" --roles "$roles" --scope custom --lang ja --dir "$PWD" \
    < /dev/null > "$WORK/$name.check.json"
done < "$WORK/targets.txt"
```

4. 定義ごとに、再生成してよいかを判定する。差分が「## 文書の執筆」節の有無だけの定義を `ok.txt` に、ほかの差分がある定義を `ng.txt` に分ける。14 定義がどちらかに入るまで進め、`NG` があっても止めない。complex-reviewer は、断片の `e2e-verify` が `Write`・`Edit`・`Skill` を持ち、今の定義の `tools` と一致しないため `NG` になる想定である。判定はこの想定でなく、コマンドの結果で行う。

```bash
node -e '
const fs = require("fs"); const dir = process.argv[1]; const ok = []; const ng = []
for (const line of fs.readFileSync(dir + "/targets.txt", "utf8").trim().split("\n")) {
  const name = line.split(" ")[0]
  const r = JSON.parse(fs.readFileSync(`${dir}/${name}.check.json`, "utf8"))
  const x = r.results?.[0]
  const pass = r.ok === true && x?.exists === true &&
    x.frontmatter.changed.length === 0 &&
    x.frontmatter.toolsOnlyInTemplate.length === 0 &&
    x.frontmatter.toolsOnlyInExisting.every((t) => t.startsWith("mcp__")) &&
    x.frontmatter.keysOnlyInExisting.every((k) => k === "disallowedTools") &&
    x.preambleChanged === false &&
    x.body.sectionsChanged.length === 0 &&
    x.body.sectionsOnlyInTemplate.length === 0 &&
    JSON.stringify(x.body.sectionsOnlyInExisting) === JSON.stringify(["## 文書の執筆"])
  ;(pass ? ok : ng).push(line)
  console.log(name, pass ? "OK" : "NG " + JSON.stringify({ error: r.error, frontmatter: x?.frontmatter, preambleChanged: x?.preambleChanged, body: x?.body }))
}
fs.writeFileSync(dir + "/ok.txt", ok.map((l) => l + "\n").join(""))
fs.writeFileSync(dir + "/ng.txt", ng.map((l) => l + "\n").join(""))' "$WORK"
```

5. `ok.txt` の定義を 1 件ずつ上書きで生成する。`--merge` は付けない。`mcpCurrent.servers` を `--mcp-servers` に、`mcpCurrent.denyTools` を同じコマンドの `--mcp-deny` に渡す(GOTCHA-001)。値が空のときはその引数を付けない。`--write` はモデルが live models に無いと失敗する。失敗しても `while` は次の行へ進むので、失敗した時点で `break` で止める。止まったら手順 8 の「1 件だけ戻す」を行い、その定義を手順 6 の手作業へ回す。

```bash
: > "$WORK/written.txt"
while read -r name mid model vendor roles; do
  cur=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).results[0].mcpCurrent;console.log(c.servers.join(",")+" "+c.denyTools.join(","))' "$WORK/$name.check.json" < /dev/null)
  servers=${cur% *}; deny=${cur#* }
  mcp=()
  [ -n "$servers" ] && mcp+=(--mcp-servers "$servers")
  [ -n "$deny" ] && mcp+=(--mcp-deny "$deny")
  if node "$SETUP" --write --name "$name" --model-id "$mid" --model "$model" \
       --vendor "$vendor" --roles "$roles" --scope custom --lang ja --dir "$PWD" \
       "${mcp[@]}" < /dev/null > "$WORK/$name.write.json" &&
     node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(r.ok===true&&r.results[0].ok===true&&r.results[0].mcpDropped.length===0?0:1)' "$WORK/$name.write.json" < /dev/null
  then
    echo "$name" >> "$WORK/written.txt"
  else
    echo "NG: $name"; cat "$WORK/$name.write.json"; break
  fi
done < "$WORK/ok.txt"
```

   期待: `written.txt` が `ok.txt` と同じ件数になる。`mcpDropped` が空でない定義は、MCP サーバーが今のセッションで使えず `tools` から外れている。これも `NG` として止まる。

6. `ng.txt` の定義(と、手順 5 で止まって戻した定義)は再生成しない。`.claude/agents/<name>.md` を Edit で開き、「## 文書の執筆」の見出し行から、次の `## ` 見出しの直前までを削る。`.claude/agents/` は git の管理外で metatron の保護対象でもないので、Edit で直してよい。
7. 複製との差分を取る。追加された行が 0 で、削除された行が各定義で「## 文書の執筆」節の行だけであることを確かめる。

```bash
for f in "$BACKUP"/*.md; do
  n=$(basename "$f")
  added=$(diff "$f" ".claude/agents/$n" | grep -c '^>')
  removed=$(diff "$f" ".claude/agents/$n" | grep '^<' | grep -vc '^< *$')
  echo "$n added=$added removed_nonblank=$removed"
done
grep -l "文書の執筆" .claude/agents/*.md
```

   期待: 全定義で `added=0`、`removed_nonblank=11`(見出し 1 行と `assets/roles/ja/_common.md` の 29-38 行に当たる 10 行)。最後の `grep -l` の出力が空。`diff "$f" ".claude/agents/$n"` を 1 ファイルだけ目で見て、削除行が節の中身だけであることも確かめる。再生成した定義で `tools` の並びだけが複製と違うときは、手順 4 の判定を通っても `added=0` にならない。その定義は手順 8 の「1 件だけ戻す」で戻し、手順 6 の手作業で節を削る。

8. 戻す手順は 2 つある。
   - 1 件だけ戻す: `cp "$BACKUP/<name>.md" .claude/agents/<name>.md` を実行し、その定義を手順 6 へ回す。
   - 全部戻す(手順 2〜7 を中止するとき): `cp -a "$BACKUP/." .claude/agents/` を実行する。
9. 期待どおりなら、`BACKUP` と `WORK` のパス、`ok.txt` と `ng.txt` の中身、手順 7 の出力の要約を §9 に記録する。複製は T7 が終わるまで消さない。

**検証**: 手順 5 で `written.txt` と `ok.txt` の件数が一致する。手順 7 が全定義で `added=0` と `removed_nonblank=11`、`grep -l` が空。

**コミット**: なし(`.claude/agents/` は git の管理外)。

### T7: 目視検証(オーケストレーター)

**要点**: 設計書 §9-1。hooks.json の変更は全セッションの挙動を変えるため、この確認を省かない(protected-paths)。

**触るファイル**: なし。`.claude/settings.json` を変えずに試すため、`--plugin-dir` で本プラグインを読み込ませる。

**消費する契約・生み出す契約**: 消費するのは §4 の「discipline.md」の 1 行目の見出しと 6 つの節見出し。

**手順**:

1. 別の端末で、リポジトリのルートから新しいセッションを起動する。

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
claude --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/native-japanese
```

2. 最初の入力で次を送る。

```text
ファイルを読まずに答えてください。セッション開始時にフックが追加したコンテキストのうち、「# 日本語の書き方」で始まる文書の「## 」見出しを、上から順にそのまま列挙してください。
```

   期待: ツールを呼ばずに `## 適用範囲` / `## 構成` / `## 文` / `## 翻訳調の言い換え` / `## 避ける語` / `## 訳語` の 6 つを返す(T1 で見出しを変えていない前提)。

3. `/clear` を実行し、手順 2 と同じ文を送る。期待は同じ。
4. 何往復か会話してから `/compact` を実行し、手順 2 と同じ文を送る。期待は同じ。
5. 次を送り、サブエージェントへの注入を確かめる。

```text
general-purpose のサブエージェントを 1 体起動してください。依頼文は「ファイルを読まずに答えてください。起動時にフックが追加したコンテキストのうち、「# 日本語の書き方」で始まる文書の「## 」見出しを、上から順にそのまま列挙してください。」とし、返答をそのまま見せてください。
```

   期待: サブエージェントの返答に手順 2 と同じ 6 つの見出しがある。

6. どれかが期待と違ったら、そのセッションで `echo '{"hook_event_name":"SessionStart"}' | node plugins/native-japanese/scripts/inject.mjs | head -c 200` を実行して出力の有無を切り分け、結果を §9 に記録して報告する。
7. 結果を §9 に記録する。T6 の複製ディレクトリ `BACKUP` と `WORK` を `rm -rf` で消す。

**検証**: 手順 2〜5 がすべて期待どおり。

**コミット**: なし。

### T8: コードレビュー(並列、読み取りのみ)

| ID | 対象 | 必ず見る点 | 担当 |
| --- | --- | --- | --- |
| T8a | コミット 1(T1〜T3) | (1) §1 のレビューの焦点 R1〜R4 のテストと検証がある (2) `inject.ts` が §5 の契約(入力・出力・異常時・パス解決)をすべて満たし、`node:fs` 以外を import しない (3) テストの一時ディレクトリのケースに対照(差し替えた本文を注入する)がある (4) 派生元の名前が `LICENSE` と README の「由来」節の外に無い (5) `plugin.json` と `marketplace.json` の `description` が同じ文 (6) `discipline.md` が設計書 §6 の節と項目をすべて持ち、他プラグイン名を含まない | コードレビュー |
| T8b | コミット 2(T4・T5) | (1) 削った範囲が設計書 §8-2 の表どおりで、`### 文書の執筆を委譲するとき` が残っている (2) R5 のテストがある (3) `scripts/setup-agents.mjs` の差分が `src/` の変更に見合い、`writingHeading` が残っていない (4) `plugin.json` と `package.json` が `0.20.1-dev` で揃っている (5) README の移行の項目と Serena メモリが撤去後の事実と一致する | コードレビュー |

依頼文に「ファイルを変更しない」「報告のみを返す」「使用してよい tools を読み取り系に限定する」を明記する。

### T9: 最終突き合わせ(オーケストレーター)

全差分を分割せず一度に読み、設計書と突き合わせる。特に次を確かめる。

1. 設計書 §4-4 の 8 ケースが、T2 のテストの次の行で確かめられている。

   | 設計書 §4-4 のケース | T2 のテスト |
   | --- | --- |
   | SessionStart | 「SessionStart で discipline.md の全文を 1 行の JSON で注入する」 |
   | SubagentStart | 「SubagentStart で discipline.md の全文を 1 行の JSON で注入する」 |
   | イベント名なし | 「イベント名が無い なら何も出力しない」 |
   | 未知のイベント名 | 「未知のイベント名 なら何も出力しない」 |
   | stdin 不正 | 「JSON として読めない なら何も出力しない」 |
   | ファイル不在 | 「discipline.md が無ければ何も出力しない」 |
   | 空白だけの本文 | 「discipline.md が空白だけなら何も出力しない」 |
   | 文字数の上限 | 「discipline.md は 9,000 文字以内」 |

2. 設計書 §9-2 の Done 条件の各項目に、T0〜T7 の記録か該当コミットがある。
3. ARCHITECTURE への影響を確かめる(設計書 §9-2)。ARCHITECTURE はプラグインの一覧を持たず、本プラグインは既存のレイヤー規則(フック層が配布物層を実行し、配布物層が参照層を実行時に読む)に収まる想定である。食い違いが見つかったときだけ `metatron:updating-architecture` を起動してから反映する。変えなかったときは、その判断を §9 に記録する。
4. §1 のレビューの焦点 R1〜R5 のテストと検証が、指定したタスクにある。

食い違いは §7 に記録し、該当タスクをやり直す。

## 3. 依存関係

```
T0 ─ T1 ─ T2 ─ T3 ─(コミット 1)─ T4 ─ T5 ─(コミット 2)─ T6 ─ T7 ─┬─ T8a ─┬─ T9
                                                                   └─ T8b ─┘
```

- T1 を T2 の前に置く。T2 のテストは本物の `discipline.md` の全文と文字数を読む。
- T3 は T2 の後に置く。`pnpm-workspace.yaml` に加えた時点で `pnpm run build` が本プラグインの `build.ts` を実行するため、`build.ts` と `package.json` が先に要る。
- T4 はコミット 1 の後に置く。2 つのコミットの中身を混ぜないためである。T4 と T1〜T3 はファイルが重ならないので、担当を分けて並行してもよい。その場合もコミットはコミット 1 → コミット 2 の順にする。
- T5 は T4 の後に置く。メモリは撤去後の事実を書く。
- T6 は T4 の `pnpm run build` の後に置く(設計書 §8-4)。`setup-agents.mjs` は `vocabulary.ts` をインラインで含むので、ビルド前に再生成すると節が残る。
- T7 は T6 の後に置く。サブエージェントの確認で、再生成後の定義と注入の両方を一度に見られる。T7 は built-in の `general-purpose` を使うので、T6 が失敗しても T7 は行える。
- T8 は T7 の後に並列で行う。

## 4. タスク間で共有する契約

依頼文へ転記し、担当が推測で決めないようにする。

| 契約 | 値 | 生み出すタスク | 使うタスク |
| --- | --- | --- | --- |
| discipline.md | パス `plugins/native-japanese/references/discipline.md`。1 行目 `# 日本語の書き方`。節見出しは `## 適用範囲` / `## 構成` / `## 文` / `## 翻訳調の言い換え` / `## 避ける語` / `## 訳語` の順。9,000 文字以内(JavaScript の `string.length`) | T1 | T2、T3、T7 |
| 注入スクリプト | 入口 `plugins/native-japanese/src/inject.ts`、出力 `plugins/native-japanese/scripts/inject.mjs`。入力は標準入力の JSON の `hook_event_name` だけを読む。`SessionStart` と `SubagentStart` のとき `{"hookSpecificOutput":{"hookEventName":"<入力の値>","additionalContext":"<全文>"}}` と改行を stdout に書く。それ以外と全ての失敗は、stdout と stderr に何も書かず exit 0 | T2 | T3、T7 |
| hook | `hooks/hooks.json` の `SessionStart` と `SubagentStart` に各 1 件。`matcher` なし。コマンド `node "${CLAUDE_PLUGIN_ROOT}/scripts/inject.mjs"`、`timeout` 10 | T2 | T7 |
| バージョンと description | native-japanese の `version` は `0.1.0-dev`(`plugin.json` と `package.json`)。`package.json` の `name` は `native-japanese-scripts`。`description` は `日本語で書く出力のすべてに、翻訳調や決まり文句を避けて結論から書く規律を、セッション開始時とサブエージェント起動時に注入する`(`plugin.json` と `marketplace.json` で同じ文) | T2 | T3 |
| 撤去後の agent-policy | `Vocabulary` に `writingHeading` が無い。`compose()` は執筆の節を出さない。`_common.md`(ja/en)に `## 文書の執筆` / `## Writing` が無い。`orchestration-discipline.md` に `### 文書の執筆` が無く、`### 文書の執筆を委譲するとき` はある。`version` は `0.20.1-dev` | T4 | T5、T6 |

**ファイルの持ち主**

| ファイル | 変えるタスク |
| --- | --- |
| `plugins/native-japanese/references/discipline.md` | T1 |
| `plugins/native-japanese/src/**`、`build.ts`、`package.json`、`.claude-plugin/plugin.json`、`hooks/hooks.json`、`scripts/inject.mjs` | T2 |
| `plugins/native-japanese/README.md`、`LICENSE`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.claude-plugin/marketplace.json`、ルート `README.md` | T3 |
| `plugins/agent-policy/**`(§2 の T4 に列挙したファイル) | T4 |
| `.serena/memories/agent_policy/core.md` | T5 |
| `.claude/agents/*.md` | T6 |

## 5. コミット

| # | タスク | メッセージ | 含めるファイル |
| --- | --- | --- | --- |
| 1 | T1〜T3 | `feat(native-japanese): 日本語の書き方の規律を注入するプラグインを追加する` | `plugins/native-japanese/.claude-plugin/plugin.json`、`plugins/native-japanese/hooks/hooks.json`、`plugins/native-japanese/references/discipline.md`、`plugins/native-japanese/src/inject.ts`、`plugins/native-japanese/src/__test__/inject.test.ts`、`plugins/native-japanese/src/testing/run-ts.ts`、`plugins/native-japanese/scripts/inject.mjs`、`plugins/native-japanese/build.ts`、`plugins/native-japanese/package.json`、`plugins/native-japanese/README.md`、`plugins/native-japanese/LICENSE`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.claude-plugin/marketplace.json`、`README.md` |
| 2 | T4・T5 | `refactor(agent-policy): 文書の執筆の規律を撤去し 0.20.1-dev に上げる` | `plugins/agent-policy/references/orchestration-discipline.md`、`plugins/agent-policy/assets/roles/ja/_common.md`、`plugins/agent-policy/assets/roles/en/_common.md`、`plugins/agent-policy/src/agents/compose.ts`、`plugins/agent-policy/src/agents/vocabulary.ts`、`plugins/agent-policy/src/agents/__test__/compose.test.ts`、`plugins/agent-policy/scripts/setup-agents.mjs`、`plugins/agent-policy/.claude-plugin/plugin.json`、`plugins/agent-policy/package.json`、`plugins/agent-policy/README.md`、`.serena/memories/agent_policy/core.md` |

- すべてのメッセージの末尾に、セッションの指示にある Co-Authored-By の行を付ける。
- 本計画書は `0e4639f` でコミット済みのため、計画書のためのコミットは置かない。
- コミット 1 は `scripts/inject.mjs` を、コミット 2 は `scripts/setup-agents.mjs` を、それぞれ対応する `src/` の変更と同じコミットに含める(設計書 §9-2)。
- 各コミットの前に `git status --short` を見て、上の列のファイルだけを `git add <パス>` で加える。§0 の無関係な未コミット変更を含めない。
- 各コミットの時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` が通り、build の後に `git status --short plugins/*/scripts` に未コミットの差分が残らない。
- T6 の再生成はコミットを生まない(`.claude/agents/` は `.gitignore:14` の対象)。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| `setup-agents.mjs` の `--merge` が、テンプレートから消えた「## 文書の執筆」を利用者の節として残す(`src/setup-agents.ts:582-595` の `automaticKeep` が `sectionsOnlyInExisting` を保持し、`merge` が末尾へ足す) | T6 は `--merge` を付けずに上書きする(設計書 §8-4)。上書きで失うものが無いことを、書き込み前の `--check` の判定(T6 の手順 4)で定義ごとに確かめる。ほかの差分がある定義は再生成せず、手で節を削る(T6 の手順 6) |
| 再生成で `disallowedTools` が消える(GOTCHA-001) | `--check` の `mcpCurrent.denyTools` を同じコマンドの `--mcp-deny` に渡す。書き込み前に複製を取り、書き込み後に追加行が 0 であることを差分で確かめる |
| 再生成の時点でモデルが live models に無い、または MCP サーバーが使えず `mcpDropped` に落ちる | T6 の手順 5 で 1 件ずつ実行し、失敗した時点で止める。その定義は複製から戻し、手で節を削る(T6 の手順 8・6) |
| 一時ディレクトリに複製した `inject.ts` を tsx が CommonJS として扱い、`import.meta.url` が使えずに空出力になる。ファイル不在のテストが空振りでパスする | 一時ディレクトリに `{"type":"module"}` の `package.json` を置く。差し替えた本文を注入する対照のテストで、起動そのものが通ることを確かめる |
| tsx や Node の警告が stderr に出て、「失敗しても stderr に書かない」が本件と無関係な理由で失敗する | `NODE_NO_WARNINGS=1` を渡す。それでも出るときは、出力の中身を報告し、スクリプト由来でないことを確かめてからオーケストレーターが扱いを決める |
| `discipline.md` を後から直したときに 9,000 文字を超え、注入がファイルへの退避に変わる(設計書 §2-3) | T2 のテストで上限を守る。README の「規律を直すとき」に上限を書く |
| 無関係な未コミット変更をコミットに混ぜる | §5 のとおりパスを列挙して `git add` する |
| prompt-smith の 1 パスで削りすぎ、設計書 §6 の項目が落ちる | T1 の手順 3 で「設計書 §6 の各節の項目をすべて残す」を条件にし、T8a の (6) で確かめる |

## 7. 設計書との食い違い

計画立案時に検出した事項。実装中に見つけた食い違いも、この表へ追記する。

| # | 検出タスク | 設計書の記述 | 計画での扱い | 判断 |
| --- | --- | --- | --- | --- |
| 1 | 計画 | 承認時の §8-4 の手順 4 は `--write --merge` で再生成するとしていた。`--merge` を付けると `automaticKeep`(`src/setup-agents.ts:582-595`)が `body.sectionsOnlyInExisting` を保持の対象に入れ、`merge`(同 572-577 行)がテンプレートに無い節を末尾へ残すので、執筆の節は消えない。設計書は `0e4639f` で更新済みで、現行の §8-4 は `--check` で差分が節の有無だけかを 14 定義で確かめ、他の差分がある定義は手で節を削り、`--merge` を付けずに `--write` で上書きする | 現行の §8-4 に従う。T6 は定義ごとに再生成か手作業かを分け、再生成では `--mcp-servers` と `--mcp-deny` を同じコマンドで渡す | 設計書へ反映済み(0e4639f)。計画は現行設計書に従う |
| 2 | 計画 | 承認時の §8-3 は「設計時点の grep では README に該当は無かった」としていた。`plugins/agent-policy/README.md:212`(0.19→0.20 の移行の 2.)に「執筆基準は全定義の共通部分に含まれ、再生成で反映されます。」があり、撤去後は事実と食い違う。設計書は `0e4639f` で更新済みで、現行の §8-3 はこの 1 文を削り、移行リストに撤去と再生成の注意を 1 項として足すとする | 現行の §8-3 に従う。212 行のその 1 文を削り、同じリストに 11. を足す(T4 の手順 8) | 設計書へ反映済み(0e4639f)。計画は現行設計書に従う |
| 3 | 計画 | 依頼では `setup-agents.mjs --help` から引数の形を写すとしていたが、`--help` は `{"ok":false,"error":"Unsupported option: --help","results":[]}` を返す | 引数の形は `src/setup-agents.ts:869-1031`(`parseArgs`)と `skills/setup-agents/SKILL.md:194`・`234` から写した。1 回の呼び出しで 1 定義を扱う個別の経路(`--name`・`--model-id`・`--model`・`--vendor`・`--roles`)を使う | 計画で決定 |
| 4 | 計画 | §4-2 は `inject.ts` の依存を `node:fs` と `node:path` と `node:url` だけとする | `fs.readFileSync` が URL を直接受け取るので、`node:fs` だけを使う。「だけ」の範囲に収まる | 計画で決定 |
| 5 | 計画 | §4-4 は一時ディレクトリに `src/inject.ts` と `references/discipline.md` だけを置くとする | ESM として起動させるため、一時ディレクトリに `{"type":"module"}` の `package.json` も置く。起動の対照のテストを 1 件足す(T2) | 計画で決定 |
| 6 | 計画 | §9-1 は新しいセッションで目視するとだけ書き、本プラグインをどう読み込ませるかを書いていない | `.claude/settings.json` に未コミットの変更があり触らないため、`claude --plugin-dir` で読み込ませる(T7) | 計画で決定 |
| 7 | 計画 | §8-3 は `core.md:116-120` の修正だけを挙げる | 同じメモリの 1 行目の `0.20.0-dev` も `0.20.1-dev` に直す(T5) | 計画で決定 |

## 8. Done 条件

設計書 §9-2 に、本計画書で足した次の項目を加える。

- T0 の baseline と、T6・T7 の結果が §9 に記録されている。
- 各コミットの時点で lint / typecheck / test / build が通っている。
- `plugins/native-japanese/references/discipline.md` の文字数と行数が §9 に記録されている。
- §1 のレビューの焦点 R1〜R5 のテストと検証が、指定したタスクにある。
- `.claude/agents/` の 14 定義に「## 文書の執筆」が無く、`disallowedTools` と MCP の `tools` が再生成前と同じである。
- T8 の報告と T9 の突き合わせで見つかった食い違いが §7 に記録され、解消されているか判断待ちとして残っている。

## 9. 実施記録

(実装時に記入する)

### T0 baseline

### T1 discipline.md の文字数と行数

### T6 Agent 定義の再生成

### T7 目視検証

### T8 レビューと T9 突き合わせ

## 付録 A: `references/discipline.md` の草案

T1 がこの草案を置き、prompt-smith で 1 パス削ってから採用する。フェンスの行は含めない。

````markdown
# 日本語の書き方

## 適用範囲

- 日本語で書く出力のすべてに、この規律を当てる。
- 会話の返答、コード内のコメント、コミットメッセージ、文書を対象に含める。
- 口調と文体を別の指示が定めているときは、その項目だけ別の指示に従う。
- 口調と文体の項目は、敬体と常体の別、圧縮した口調、体言止めの可否などを指す。
- 別の指示が定めていない項目には、この規律を当て続ける。
- この規律の項目同士がぶつかったときは、読み手の理解を助けるほうを選ぶ。

## 構成

- 挨拶・依頼の復唱・内容の予告を置かず、最初の一文に結論を書く。
- 見出しには、その節の結論を含める。
  - 「背景」「まとめ」のようなラベルだけの見出しは、結論を述べる句に書き換える。
  - 見出しだけを順に読んで、論旨が通るようにする。
  - すべての見出しを同じ書式に揃えず、内容に合う形を選ぶ。
  - 見出しの断定の強さは、本文の確信度に合わせる。
- 箇条書きは、項目が互いに並列なときだけ使う。
  - 項目の間に「そのため」「だが」でつながる関係があれば、地の文に書き直す。
  - 因果と経緯は地の文で書き、接続詞で前後の関係を示す。
- 専門用語は、機能を説明してから名前を示す。
  - 読み手がその用語を初めて見るときは、初出の箇所に括弧で一言の説明を添える。
- 固有名詞・数値・実例で書く。
  - 「担当者」は実名に置き換える。
  - 「一部の」は実数に置き換える。
  - 抽象的な主張が 3 文続いたら、実例か数値を足す。
  - 素材が無いときは推測で埋めず、何を確かめれば書けるかを書く。
- 太字は、文中の核になる 1 箇所だけに使う。
  - 強調したい文は、絵文字や記号で飾らずに短く言い切る。
- 重要な節は厚く書く。
- 軽い節は、厚さを揃えるための内容を足さずに短く終える。
  - 5 項目以上を並べるときは、上位 2〜3 項目に実例と数値を添え、残りは一言で済ませる。
  - 内容が順序を持たないときは、順序や優先順位を付けずに並べる。
- 同じ鋳型が 2 回続いたら、3 回目は書き出しか組み立てを変える。
  - 鋳型には、定義文の型、節の内部の組み立て、文の書き出しを含める。
- 「〜ではなく」は、読み手が実際に抱いている誤解を正すときだけ使う。
  - 対比の後半だけで意味が通らない文は、肯定の文に書き直す。
- 確信度は語尾でぼかさず、ラベルで書き分ける。
  - 未検証の内容には【要確認】を付ける。
  - 推定にとどまる内容は「〜と推定する」と書く。
  - 確かめた事実は言い切る。
  - 誤りを直したときは、冒頭に訂正の履歴を書く。
- 事実と意見を分けて書く。
  - 事実には、出典か確かめた方法を添える。
  - 意見には、「私は」「筆者は」のように判断の主体を添える。
- 結びでは要約を繰り返さず、本文の要点を 1〜2 文に統合する。
  - 調査の文書では、結果から次に何をするかへつなぐ。
  - 次の行動の提案は、根拠が支える範囲にとどめる。
- 文書を書き終えたら、見出しと各段落の先頭文だけを通して読み、論旨が通るかを確かめる。

## 文

- 長い修飾語を先に置き、短い修飾語を被修飾語の直前に置く。
  - 節は句より先に置く。
  - 時と場所は、大きな枠から順に置く。
- 読点は、統語の切れ目に打つ。
  - 長い修飾語が並ぶときは、その境界に打つ。
  - 短い修飾語を先に置くときは、その直後に打つ。
  - 統語の切れ目に当たらない読点は削る。
- 一文に一つの内容を書く。
  - 長さは 40〜60 字を目安にする。
  - 目安を超えても一文一義を保てている文は、割らずに残す。
  - 文を短くするときも、必要な事実と主語は残す。
- 主語と述語を近づける。
  - 主語と述語の間に長い修飾が入るときは、文を割る。
  - 主語に対応する述語で文を結ぶ。
  - 「〜の理由は」で始めた文は、「〜ことだ」「〜である」で受けるか、文を分ける。
- 1 つの名詞に連体修飾を重ねず、文を割る。
  - 名詞の前に修飾の節が 2 つ以上重なったら、時系列か因果の順に文を分ける。
- 段落の先頭に、その段落の主題を述べる文を置く。
  - 段落の残りの文は、先頭の文を補う内容に限る。
- 文末の形を単調にしない。
  - 同じ文末表現が 3 文続いたら、次の文で形を変える。
  - 短い文と長い文を隣り合わせに置く。
- 接続詞がどこまでを受けるか(射程)を、前後の関係に合わせる。
  - 近い語句の並列には「あるいは」を使う。
  - 段落単位の対比には「一方」を使う。
  - 対比でない事柄を足すときは「また」を使う。
  - 逆接の接続詞を続けず、射程の合う別の語に言い換える。

## 翻訳調の言い換え

Before の形を書いたら、After の形に書き換える。
型の名前に当たらなくても、英語の構文を写した文は同じように書き換える。

| 型 | Before | After |
| --- | --- | --- |
| 無生物主語 + 他動詞 | この事実は、前提が誤っていたことを示している。 | この事実から、前提が誤っていたと分かる。 |
| 〜することができる | この設定で作業時間を短縮することができる。 | この設定で作業時間を短縮できる。 |
| 〜という観点から | コストという観点から見ると、この案は妥当だ。 | コストで見れば、この案は妥当だ。 |
| 〜にとって重要 | この計画にとって、初期の合意は重要だ。 | この計画は、初期に合意を作れるかで決まる。 |
| 〜を持つ | この決定は大きな意味を持つ。 | この決定には大きな意味がある。 |
| 〜することによって | 情報を整理することによって、判断が速くなる。 | 情報を整理すると、判断が速くなる。 |
| 〜に他ならない | これは時代の変化の表れに他ならない。 | 時代が変わったから、こうなった。 |
| ダッシュで挟む挿入句 | 指摘が出なくなるまで——つまり収束するまで——繰り返す。 | 指摘が出なくなる(収束する)まで繰り返す。 |
| cleft 構文(それは〜。なぜなら〜) | それは単純ではない。なぜなら、利害が絡み合っているからだ。 | 利害が絡み合っていて、単純ではない。 |

## 避ける語

表の語を書きかけたら、語を消して具体的な事実・数値・条件を書く。
語尾や前後の形が違っても、同じ働きの言い回しは同じように扱う。
「実は」「驚くべきことに」は、その情報が読み手にとって意外なときだけ使う。
意外でない情報は、前置きの語を付けずに事実だけを書く。

| 分類 | 語 |
| --- | --- |
| まとめ口調 | 「と言えるでしょう」「と言えます」「ということになるでしょう」「のではないでしょうか」「結論から言うと」「結論として」「まとめると」「総じて」「いかがでしたか」「ということです」「ぜひ〜してみてください」 |
| 過剰な強調 | 「非常に重要」「極めて重要」「重要なのは」「大切なのは」「ポイントは」「言うまでもなく」「まさしく」 |
| 空疎な接続 | 「さて、」「それでは、」「このように」「このような中」「ここで注目したいのは」「見ていきましょう」「紹介していきます」「解説していきます」「今回は〜について紹介します」 |
| 予防線 | 「一概には言えません」「個人差がありますが」「あくまで一例ですが」「という側面もあります」「とも限りません」「と言われています」「ではないかと思います」「という声もあります」「していきたいと思います」 |
| 三点構成・数の宣言 | 「大きく分けて 3 つの」「理由は 3 つあります」「軸は 2 つあります」「ポイントは主に以下の通りです」 |
| 空虚な形容・動詞 | 「不可欠」「核心的」「鍵となる」「根本的な」「多角的」「包括的」「総合的」「様々な」「多様な」「掘り下げる」「深掘りする」「言語化する」「について見ていく」「を探求する」「正面から扱う」「正面から向き合う」 |
| 決め文 | 「ところまでが仕事です」「これこそが〜の真髄です」「と言っても過言ではありません」「であることは間違いない」 |
| 水増しの講釈 | 「近年、〜の重要性がますます高まっています」「ここでは〜について詳しく見ていきましょう」「つまり、〜ということでもあります」 |
| 感嘆・共感の演出 | 「〜なんですよね」「興味深いことに」「まさにその通り」「いかがでしょう、あなたも〜」 |

## 訳語

- 英語を直訳せず、日本語の慣用に合わせて意訳する。
- Version は単に「版」とせず、「確定版」「新しいバージョン」などから文脈に合うものを選ぶ。
- テスト結果の Green / Red は「パス」「失敗」と書く。
- Frozen Document は「確定版の文書」と書く。
- Ledger は用途に応じて「一覧」「管理表」「ログ」と書き分ける。
- Step は「Step」または「ステップ」と書く。
````
