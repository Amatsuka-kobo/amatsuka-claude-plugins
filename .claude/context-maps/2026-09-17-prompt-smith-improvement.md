# Context Map: prompt-smith 発火測定・description 改善ループの改修(バックログ 8 項目)

**作成日**: 2026-09-17
**作成者**: Claude Opus 5 (1M context)(コードベース探索統括の役割)
**対象タスク**: `plugins/prompt-smith/docs/improvement-backlog.md` の 8 項目(測定の隔離漏れ・環境記録・`--model` の不揃い・既定モデル・`--help`・holdout の採否・改善案の長さ・eval セット基準)に着手するための前提整理。
**関連するBlueprintセクション**: `harness-docs/design/2026-08-09-prompt-smith-skill-creator-port-design.md`(公式 skill-creator の TypeScript 移植設計) / `plugins/prompt-smith/docs/skill-creator-port-rationale.md`

---

## 1. 目的・スコープ

- バックログ 8 項目の改修対象を、ファイル・関数・行の粒度で特定し、判断が要る論点を洗い出す。
- スコープ内: `plugins/prompt-smith/src/`(4 エントリ + `lib/` 6 モジュール)、`skills/skill-creator/SKILL.md`、`README.md`、`references/description-guide.md`、`evals/*.json`、テスト 11 本、`build.ts`、バージョン 2 ファイル。
- スコープ外: `prompt-smith` / `agent-creator` の 2 スキル本文(測定器を使わない)、`scripts/` と `dist/`(バンドル出力。`src/` を直して `pnpm run build` で再生成する)。

## 2. 現在のコードベース構造

### 2.1 構成

```
plugins/prompt-smith/
├── src/
│   ├── run-trigger-eval.ts     発火測定 CLI + runEval(ライブラリ)
│   ├── run-loop.ts             改善ループ CLI + runLoop
│   ├── improve-description.ts  改善案生成 CLI + buildImprovePrompt / improveDescription
│   ├── generate-report.ts      HTML レポート生成(CLI main を持たない)
│   ├── lib/
│   │   ├── claude-cli.ts       buildEnv / describeEnvironment / callClaudeText
│   │   ├── sandbox.ts          測定用の一時プロジェクトを作る
│   │   ├── split-eval-set.ts   train/holdout 分割(seed 固定)
│   │   ├── stream-parse.ts     stream-json から Skill 発火を判定 / judge
│   │   ├── pool.ts             並列実行
│   │   ├── parse-skill-md.ts   frontmatter から name/description を取る
│   │   └── types.ts            EvalItem / EvalResult / IterationRecord / LoopResult
│   └── __test__/               11 本(vitest)
├── skills/skill-creator/SKILL.md   232 行。測定手順の指示書
├── references/                     description-guide.md / agent-definition-spec.md
├── evals/                          3 本 × 20 問
└── build.ts                        esbuild で src/ の 4 エントリ → scripts/*.mjs
```

### 2.2 重要なファイル

| ファイルパス | 役割・内容の概要 | 重要度 | 備考 |
|--------------|------------------|--------|------|
| `src/lib/claude-cli.ts` | 88 行。`callClaudeText` L48-87(spawn L57)、`buildEnv` L24-33、`describeEnvironment` L35-45 | **High** | 項目 1 の本丸 |
| `src/run-loop.ts` | 529 行。`score` L75-77 / `selectBest` L79-86 / `makeLoopResult` L98-129 / `runLoop` L171-360 / `main` L394-514 | **High** | 項目 2・3・4・5・6 |
| `src/improve-description.ts` | 450 行。`buildImprovePrompt` L74-172(長さ指示 L159)、`main` L365-435 | **High** | 項目 7 |
| `src/run-trigger-eval.ts` | 309 行。`runSingleQuery` L37-119、`runEval` L121-186、`main` L228-294 | **High** | 項目 3・4・5 |
| `src/lib/types.ts` | `LoopResult` L61-74(`environment` を持たない)、`RunEvalOptions.model?` L40 | High | 項目 2・4 |
| `src/lib/split-eval-set.ts` | `splitEvalSet` L37-65。正例・負例を別々に分けて最低 1 問を保証 | High | 項目 6 |
| `skills/skill-creator/SKILL.md` | L131-139 description の規律 / L141-162 eval セット / L219-225 測定の規律 | **High** | 項目 8。項目 4・7 の追随先 |
| `plugins/prompt-smith/README.md` | L15-24 に 4 スクリプトの CLI 引数表 | High | 項目 3・4・5 の追随先 |
| `src/__test__/bundle-cli-smoke.test.ts` | 45 行。バンドル 3 本を引数なしで起動し必須フラグのエラー文言を照合 | **High** | 項目 3・4・5 で壊れる(§8.2) |
| `src/__test__/improve-description.test.ts` | 414 行。L74-85 が `"1024 characters"` と `"100-200 words"` を assert | High | 項目 7 で壊れる |
| `.claude-plugin/plugin.json` / `package.json` | ともに `version: "0.3.5-dev"` | Medium | 揃えて上げる |
| `references/description-guide.md` | 22 行。**長さ・字数・語数・発火測定の記述は 0 件** | Low | 長さの正本は改善プロンプト側 |

## 3. データフロー

```
run-loop main (L394)
 └→ runLoop (L171)
      ├→ splitEvalSet(evalSet, holdout)           lib/split-eval-set.ts:37
      ├→ 反復 1..maxIterations
      │    ├→ runEval  (run-trigger-eval.ts:121)  ← train+test を一度に測る
      │    │    └→ runSingleQuery (L37)  createSandbox → spawn("claude", …, {cwd: sandbox.dir}) → TriggerDetector
      │    ├→ record を history へ push、train_failed===0 で all_passed 打ち切り
      │    └→ improveDescription (improve-description.ts:291)
      │         └→ callClaudeText (claude-cli.ts:48)  ★ cwd 指定なし = 項目 1
      └→ makeLoopResult → selectBest ★ 項目 6
 └→ JSON を stdout と results.json へ(L508-511)★ environment を含まない = 項目 2
```

**隔離の非対称が要点。** 測定経路(`runSingleQuery`)は `cwd: sandbox.dir`(L66)で一時ディレクトリへ逃がしてある。改善案生成経路(`callClaudeText`)だけが `spawn("claude", args, { env: buildEnv() })`(L57)で cwd を指定せず、親プロセスの作業ディレクトリを継承する。同じファイル内で扱いが割れている。

`buildEnv` が落とすのは `CLAUDECODE` 1 つだけ(L29)。`~/.claude/` 側の設定・ユーザースキル・有効なプラグインは、cwd を変えても効いたままである。

## 4. 既存の実装パターン・規約

- **CLI とライブラリの二重構造。** 各エントリは `export` した純関数 + 末尾の `if (isDirectRun("<出力名>")) main()`。`run-loop` は他 2 本を import するため 1 バンドルに 3 つの `main` が同居し、`isDirectRun` が出力ファイル名で振り分ける(L516-521)。
- **引数解析は `node:util` の `parseArgs`、`strict: true` / `allowPositionals: false`。** 未知オプションは例外になる。`--help` を定義していないため `Unknown option '--help'` で落ちる(項目 5 の原因はここ)。
- **必須チェックは `main` の先頭で素の `throw new Error("--x is required")`。** この文言をスモークテストが照合している。
- **数値オプションは `parseNumericOption(name, value, default, integer?)` に集約**(`run-trigger-eval.ts:188`)。既定値は呼び出し側に散っている。`--model` だけは文字列なのでこの経路を通らない。
- **テストは DI でモックする。** `vi.mock` は 11 本すべてに無い。`runLoop({ runEval, improveDescription })` と `improveDescription({ callClaude })` の optional 引数へ `vi.fn()` を差す。`claude` を起動するテストは 1 本も無い。
- **移植元(Anthropic 公式 `run_loop.py` / `improve_description.py`)との対応をコメントで明示する規約。** 各ファイル冒頭に「移植時に変えた点」が書いてある。挙動を変える改修ではこのコメントも更新する。

## 5. 変更の影響範囲

### 5.1 直接影響を受ける箇所(バックログ 8 項目の対応表)

| # | 対象ファイル | 対象関数・行 |
|---|---|---|
| 1 | `src/lib/claude-cli.ts` | `callClaudeText` L48-87(spawn L57 に `cwd` が無い)。補助に `buildEnv` L24-33 |
| 2 | `src/run-loop.ts` / `src/lib/types.ts` | `makeLoopResult` L98-129 と `main` L508-511 / `LoopResult` L61-74。`describeEnvironment`(claude-cli.ts:35)を呼ぶ |
| 3 | `src/run-loop.ts` / `src/run-trigger-eval.ts` | `main` L418 の `if (!values.model) throw` / `main` L239 のオプション定義と L284 の受け渡し。`improve-description.ts` L382 も同じ必須チェックを持つ |
| 4 | 同上 + `src/lib/types.ts` | `RunLoopOptions.model: string`(L67、必須)と `RunEvalOptions.model?: string`(types.ts L40、任意)の型が割れている。既定値の置き場をどちらかに寄せる |
| 5 | 3 エントリの `main` | `run-loop.ts` L395-414 / `run-trigger-eval.ts` L229-244 / `improve-description.ts` L366-379 の `parseArgs` |
| 6 | `src/run-loop.ts` | `score` L75-77 と `selectBest` L79-86(採否の条件式)。分割側は `lib/split-eval-set.ts` `splitEvalSet` L37-65 |
| 7 | `src/improve-description.ts` | `buildImprovePrompt` L74-172。長さ指示は L159。追随先に `skills/skill-creator/SKILL.md` L131-139 |
| 8 | `skills/skill-creator/SKILL.md` | `## eval セット` / `### 形式` L141-162。コード変更なし |

### 5.2 holdout の採否判断(原文)

`src/run-loop.ts` L75-86。

```ts
function score(record: IterationRecord, hasTestSet: boolean): number {
  return hasTestSet ? (record.test_passed ?? 0) : record.train_passed
}

export function selectBest(
  history: IterationRecord[],
  hasTestSet: boolean
): IterationRecord {
  return history.reduce((best, candidate) =>
    score(candidate, hasTestSet) > score(best, hasTestSet) ? candidate : best
  )
}
```

読み方:

- holdout > 0 のとき、比較対象は **test_passed だけ**である。train は一切見ない。
- 比較は**狭義の大なり(`>`)**。同点なら `reduce` の畳み込み順で先の要素が残る。history は反復順なので、**同点は常に古い反復(反復 1 = 元の description)が勝つ**。
- バックログ項目 6 が報告した「train 6/12 → 8/12 に改善したが holdout 7/8 同点で不採用」は、この 2 点の直接の帰結である。
- `train_failed === 0` の打ち切り判定(L276)は train だけを見る。**打ち切り条件と採否条件が別の数値を見ている**。

### 5.3 改善案生成プロンプトの全文

`src/improve-description.ts` `buildImprovePrompt` L74-172 が組み立てる。テンプレート本体は L94-169。`${…}` は実行時に埋まる。

L94-105(冒頭):

```
You are optimizing a skill description for a Claude Code skill called "${skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
```

L107-145(条件付きで積む部分):

```
FAILED TO TRIGGER (should have triggered but didn't):
  - "${query}" (triggered ${triggers}/${runs} times)

FALSE TRIGGERS (triggered but shouldn't have):
  - "${query}" (triggered ${triggers}/${runs} times)

PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):

<attempt train=${a}/${b}, test=${c}/${d}>
Description: "${attempt.description}"
Train results:
  [PASS|FAIL] "${query の先頭 80 字}" (triggered ${triggers}/${runs})
Note: ${attempt.note}
</attempt>
```

L147-169(末尾):

```
</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 

Please respond with only the new description text in <new_description> tags, nothing else.
```

補足(項目 7 に効く点):

- `<new_description>` の要求は **L169 の最終行 1 箇所のみ**。タグが無い応答は `buildTagRetryPrompt`(L199-205)で 1 回だけ再依頼し、2 回目も無ければ `MissingDescriptionTagError`(L66-71)を投げる。
- 「100-200 words」は **L159 の 1 箇所のみ**。`buildShortenPrompt`(L187-197)は 1024 **文字**超のときだけ発火し、100-200 words 超では発火しない。日本語 description では 1024 文字の門しか実質機能しない。
- **現行 description の字数も語数もプロンプトに入っていない。** 長さの相対比較を求める材料が渡っていない。
- L167 の行末に半角スペースが 1 つ入っている(`${" "}` として明示されている)。テンプレートを書き換えるときに落としやすい。

### 5.4 間接的に波及する箇所

- `skills/skill-creator/SKILL.md` L222「過去の測定と比べるときは `environment` の一致を確かめる」— **run-loop は `environment` を出力しない**(項目 2)。指示書が存在しない出力を参照している。項目 2 の修正でこの矛盾が解ける。
- 同 L131-139「description の規律」は「1024 字以内」「100〜200 words 相当へ収める」「発火精度より 100〜200 words 相当の範囲を優先する」と定める。バックログ項目 7 の実測(188〜223 字で 20/20、302〜460 字で 13〜15/20)はこの規律と方向が逆である。項目 7 をコード側だけ直すと、指示書とプロンプトが別々の長さ基準を持つ。
- 同 L223「有効なプラグインやユーザースキルが変わった後の値を、変わる前の値と比べない」は、測定が `~/.claude/` の影響を受ける前提で書かれている。項目 1 の隔離方針によってこの条文の意味が変わる。
- `plugins/prompt-smith/README.md` L19-21 の CLI 引数表は必須・任意の別を明記している。項目 3・4・5 で更新が要る。
- `.serena/memories/agent_policy/core.md` L426-429 に 4 スクリプトの説明がある。挙動を変えたら追随が要る(Done 条件)。

### 5.5 変更を避けるべき箇所

- `runSingleQuery`(`run-trigger-eval.ts` L37-119)の `cwd: sandbox.dir` と `stdio: ["ignore", "pipe", "ignore"]`。既に隔離できており、実測値の基準がこの挙動に紐づいている。
- `createSandbox`(`lib/sandbox.ts` L132-146)。`mkdtemp` した一時ディレクトリに `.claude/skills/<cleanName>/SKILL.md` だけを置き、`finally` で `rm` する。項目 1 で `callClaudeText` に cwd を与えるときも、この作りに合わせるのが筋である。
- `splitEvalSet` の seed 既定 42(L40)。変えると過去の測定値と分割が変わる。
- `isDirectRun` のファイル名ディスパッチ(3 エントリ共通)。バンドル同居の前提。

## 6. 守るべき既存契約

- **eval セット JSON のスキーマ**: トップレベルは配列。要素は `query`(string)と `should_trigger`(boolean)の 2 キーのみ。`parseEvalSet`(`run-trigger-eval.ts` L202-225)が配列・型・query 重複なしを検証する。3 本とも 20 問 = true 10 / false 10。項目 8 で問数を増やすなら、SKILL.md L152-154 の「20 問」「8〜10 問」も同時に変える。
- **`run-trigger-eval` の結果 JSON**: `{ skill_name, description, environment, results[], summary }`(`EvalResult`、types.ts L23-29)。項目 2 はこれに揃える。
- **必須フラグのエラー文言**: `--eval-set is required` / `--skill-path is required` / `--eval-results is required`。スモークテストが排他条件込みで照合する(§8.2)。
- **`disable-model-invocation: false` の強制**: `buildSandboxSkillMd`(sandbox.ts L61-80)が frontmatter へ必ず入れる。測定が成立する前提。
- **ライセンス**: Apache-2.0 の移植部分。各ファイル冒頭の著作権表示と「移植時の変更点」コメントを消さない。`NOTICE` に対応が書いてある。

## 7. 未解決事項・不明点(Open Questions)

| # | 質問内容 | 影響度 | 上流報告先(役割) | 現状の仮定 |
|---|----------|--------|------------------|------------|
| 1 | **項目 1 の隔離手段。バックログの「`--bare` は skills を切らないので発火測定にも使える」という前提は実測で誤りだった**(§11-1)。`callClaudeText` には `--bare`(スキル不要なので無害)、`runSingleQuery` には現状の `cwd` 隔離を維持、と手段を分けてよいか | **High** | 最上位オーケストレーター | 手段を分ける。`callClaudeText` は `cwd` に一時ディレクトリ + `--bare` の併用 |
| 2 | 項目 1 で `~/.claude/` 側(ユーザースキル・ユーザー hooks・有効なプラグイン)まで隔離するか。`cwd` だけでは隔離されない。隔離すると SKILL.md L223 の条文が不要になる代わり、「実運用に近い条件で測る」という現行の測定観が変わる | **High** | 最上位オーケストレーター | 測定経路は隔離しない(実運用条件を保つ)。改善案生成経路だけ隔離する |
| 3 | 項目 6 の採否基準。(a) `>` を `>=` にして新しい反復を優先 / (b) test 同点時に train をタイブレークに使う / (c) train と test の重み付き和 / (d) 採否基準を CLI オプションで選べるようにする、のどれか。`selectBest` は `blindHistory` と組んで「改善側に test を見せない」設計になっており、採否側だけ train を混ぜても設計は壊れない | **High** | 最上位オーケストレーター | (b) test 優先・同点時に train で決める。最小の変更で報告された取りこぼしが直る |
| 4 | 項目 4 の「Sonnet」の具体値。`--model` にエイリアス `sonnet` を入れるか、`sonnet[1m]` のような 1M 版か、完全な model id か。`~/.claude/settings.json` の現行既定は `sonnet[1m]` である。既定値を変えた時点で過去の測定値と比較不能になる(バックログ自身が明記) | **High** | 最上位オーケストレーター | エイリアス `sonnet`。CLI 側の解決に委ねる |
| 5 | 項目 7 の長さ基準を、実測に合わせて何字にするか。実測で 20/20 が出たのは 188〜223 字(日本語)である。プロンプトの「100-200 words」は英語前提であり、日本語 description には過大な上限になる。SKILL.md L131-139 の規律も同時に変えるか | **High** | 最上位オーケストレーター | 「現行 description の字数を渡し、それを超えない案を求める」を先に入れ、絶対値の上限は据え置く |
| 6 | 項目 7 の「短縮方向の案を必ず 1 つ含める」を採るなら、1 反復あたりの測定回数が倍になる。実行時間とコストの増加を許容するか。`maxIterations` の既定 5 を下げて相殺するか | Medium | 戦術オーケストレーター | 反復ごと 2 案は採らず、まずプロンプト側の指示強化で様子を見る |
| 7 | 項目 8 の 5 つの基準を SKILL.md へ入れる位置。`### 形式` の箇条書きへ足すと 11 → 16 項目になる。`### 実運用の経路を確かめる` のような小見出しを新設するか | Medium | 戦術オーケストレーター | 小見出しを新設する。「eval を作る前にユーザーへ聞く」は手順であり形式ではない |
| 8 | 項目 8 の「実運用の起動経路をユーザーへ聞く」を、SKILL.md の手順(L42-47)のどこへ挿すか。手順 8「eval セットの有無を確かめる」の前か後か | Medium | 戦術オーケストレーター | 手順 8 の直前に新しい手順として挿す |
| 9 | 項目 2・3・4・5 を入れるとスモークテストの期待値が変わる。`--model` を任意化すると `run-loop` の必須チェックが 2 つ(`--eval-set` / `--skill-path`)に減り、スモークの排他条件は生き残る見込みだが、`--help` 追加で `Unknown option` を含まない条件の意味が変わる | Medium | 戦術オーケストレーター | スモークテストの期待値を同じコミットで更新する |
| 10 | バージョンを 0.3.5-dev → 0.3.6-dev(パッチ)と 0.4.0-dev(マイナー)のどちらにするか。8 項目は CLI の既定値と採否基準の変更を含み、影響範囲は広い | Low | 戦術オーケストレーター | マイナー(0.4.0-dev)。既定モデルの変更で過去値と比較不能になる |

## 8. テスト戦略・既存テスト

### 8.1 既存の構成

- vitest。`vitest.config.ts` の include は `plugins/**/__test__/**/*.test.ts`、`pool: "forks"`、`testTimeout: 20_000`。
- **`vi.mock` は 11 本すべてに無い。`claude` を起動するテストも無い。** 子プロセスの遮断は 2 つの DI で実現している。
  - `runLoop({ runEval, improveDescription })` — `RunLoopOptions` L70-71 の optional。未指定なら本番実装。
  - `improveDescription({ callClaude })` — `ImproveOptions` L60 の optional。未指定なら `callClaudeText`。
- **`callClaudeText` と `runSingleQuery` はどちらも未テストである。** 項目 1 の変更点(`spawn` の第 3 引数)を直接固定する既存テストは存在しない。
- `sandbox.test.ts` は実ファイルシステムの一時ディレクトリを使う(プロセスは vitest 自身)。項目 1 で一時ディレクトリを作るなら、この流儀に倣える。

### 8.2 改修で壊れるテスト

- **`bundle-cli-smoke.test.ts`(45 行)** — `execFileSync(process.execPath, [join(scriptsDir, "<name>.mjs")])` で **引数なし**に起動し、必須フラグ不足の stderr を照合する。`scriptsDir` は `plugins/prompt-smith/scripts`。3 本それぞれ「自分の必須フラグ文言を含み」「他エントリの文言と `Unknown option` を含まない」ことを見る。項目 3・4(必須チェックの削除)と項目 5(`--help` 追加)の両方がここに当たる。**`scripts/` を再ビルドしないと落ちる。**
- **`improve-description.test.ts` L74-85** — プロンプト本文に `"1024 characters"` と `"100-200 words"` が含まれることを assert する。項目 7 で文言を変えると落ちる。
- `run-loop.test.ts`(293 行)— `selectBest` / `blindHistory` / `parseImproveTimeout` / `runLoop` の打ち切り 3 系統。項目 6 で `selectBest` の意味を変えると期待値の更新が要る。同点ケースを固定しているかは実装時に確認する。
- `run-trigger-eval-options.test.ts`(54 行)— `parseEvalSet` と `parseNumericOption` のみ。`--model` の既定は未テストなので、項目 4 は新規テストになる。

### 8.3 追加すべきテストの方向性

1. `callClaudeText` が `spawn` へ `cwd` を渡すこと(項目 1)。現状 DI の口が無いので、`spawn` を差し替え可能にするか `buildSpawnOptions` のような純関数を切り出して検証する。
2. 改善案生成の一時ディレクトリが必ず後始末されること(例外時も)。`runSingleQuery` の `finally` と同じ保証。
3. `results.json` に `environment` が `run-trigger-eval` と同じ形で載ること(項目 2)。
4. `--model` 未指定で `run-loop` / `run-trigger-eval` が同じ既定値を使うこと(項目 3・4)。
5. `--help` が終了コード 0 で全オプションと既定値を出し、必須チェックより**前**に処理されること(項目 5)。スモークの排他条件と衝突しないこと。
6. `selectBest` の同点時の振る舞い(項目 6)。test 同点 + train 改善のケースを固定する。
7. `buildImprovePrompt` が現行 description の字数を含むこと、長さ上限の文言が新基準になっていること(項目 7)。

### 8.4 エッジケース

- eval セットが 20 問より少ない/多いときの `splitEvalSet`。`Math.max(1, …)` があるので正例 1 問でも test に 1 問取られ、train が 0 問になりうる。
- `holdout: 0` のとき `hasTestSet` が false になり、`selectBest` は train で決める。項目 6 の変更がこの経路を壊さないこと。
- 改善案が 1024 文字を超えたときの短縮経路(`buildShortenPrompt`)。項目 7 で上限を下げると、短縮経路の閾値と新しい上限が二重基準になる。

## 9. 依存関係・リスク・制約

- 外部依存は `claude` CLI(PATH 上)と Node 標準ライブラリのみ。ビルドは esbuild、`build.ts` は 4 エントリ固定、`external` 指定なし、`banner.js` に Apache-2.0 のコメント。
- **`scripts/` と `dist/` は保護パス。** `src/` を直して `pnpm run build` を実行し、`scripts/` の差分を同じコミットに入れる。`bundle-cli-smoke.test.ts` は再ビルドしないと落ちる。
- 検証環境の認証は `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`(CLIProxyAPI 経由)。`ANTHROPIC_API_KEY` は未設定。`--bare` の help は「auth は厳密に `ANTHROPIC_API_KEY` か `apiKeyHelper`」と書くが、**実測ではこの構成で `--bare` が通った**(§11-1)。他者の環境では通らない可能性がある。
- 測定のコスト。1 反復で `evalSet 全問 × runs-per-query` 回の `claude -p` が走る。20 問 × 3 = 60 回/反復、既定 5 反復で最大 300 回。項目 6・7 の変更は測定回数に直結する。
- 既定モデルを変えると過去の測定値と比較できなくなる。バックログ項目 4 自身が「変更後にベースラインを取り直す」と定めている。

## 10. 推奨アプローチ

1. 未解決 1〜5 を先に確定させる。とくに 1(隔離手段)と 3(採否基準)と 5(長さ基準)で実装の形が変わる。
2. 独立性の高い順に分けてコミットする。**(a) 項目 1(隔離)→ (b) 項目 2・3・4・5(CLI の揃え)→ (c) 項目 6(採否)→ (d) 項目 7(プロンプト)→ (e) 項目 8(SKILL.md)。** (a) は他と干渉せず、効果も独立に確認できる。
3. 各段で `pnpm run build` → `pnpm run test` を通す。`bundle-cli-smoke.test.ts` は再ビルドを忘れると落ちるので、ビルドを先に実行する。
4. 項目 4 を入れた直後に 3 スキルのベースラインを取り直す。それ以前の測定値は破棄する。項目 6・7 の効果は取り直した後の値でしか評価できない。
5. 指示書側(SKILL.md L131-139 / L219-225、README.md L19-21)の追随を、対応するコード変更と同じコミットに入れる。SKILL.md の編集は `prompt-smith:prompt-smith` の規律に従う(規約「AI 向けの指示書」)。

## 11. 補足・暗黙知

### 11-1. `--bare` は model-invoked skill を切る(実測。バックログの前提が誤り)

CLI 2.1.274 で、一時ディレクトリに `disable-model-invocation: false` を付けた probe スキルを置き、同じクエリを 2 通りで測った。

| 起動 | Skill 発火 | stream 内のスキル名の出現 |
|---|---|---|
| `claude -p …`(`--bare` なし) | `"name":"Skill"` あり | 2 回 |
| `claude --bare -p …` | **無し** | **0 回** |

`--help` の文言は「Skills still resolve via `/skill-name`」であり、**スラッシュによる明示起動だけが残る**という意味だった。バックログ項目 1 の「skills は切らないため、サンドボックスに置いたスキルを読ませる発火測定にも使える」は誤りである。**`--bare` を `runSingleQuery` へ入れると測定対象が消える。** `callClaudeText`(改善案生成)はスキルを使わないので `--bare` で問題ない。

`--bare` の全文(CLI 2.1.274):「Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets `CLAUDE_CODE_SIMPLE=1`. Anthropic auth is strictly `ANTHROPIC_API_KEY` or apiKeyHelper via `--settings` (OAuth and keychain are never read).」

### 11-2. cwd を変えてもユーザー設定は隔離されない

`runSingleQuery` が `cwd: sandbox.dir` にしているのはプロジェクトスコープの隔離であり、`~/.claude/settings.json` の hooks・ユーザースキル・有効なマーケットプレイスプラグインは効いたままである。SKILL.md L223 の条文はこの事実を前提に書かれている。項目 1 で「隔離する」と言うとき、どの層まで指すのかを決めないと、修正が半端になる。

### 11-3. 打ち切りと採否が別の数値を見ている

`train_failed === 0` で `all_passed` 打ち切り(L276)、採否は test のみ(L75-77)。train が全問通って打ち切られた反復が、test で劣るために不採用になることが起こりうる。項目 6 を触るときは打ち切り条件も併せて見る。

### 11-4. 改善側に test を見せない設計

`blindHistory`(L88-96)が `test_` で始まるキーを落とし、`runLoop` は `testResults: null` を渡す(L314)。holdout への過学習を防ぐ意図的な設計である。項目 6 で「train も採否に使う」と決めても、この遮蔽は壊れない(採否は改善側の外で起きる)。逆に「改善側に holdout の結果を見せる」案は、この設計を覆すので採らない。

### 11-5. 日本語 description と英語前提の指示

改善プロンプト(L159)と `buildShortenPrompt`(L192)は words と characters を英語前提で扱う。日本語 description では 1024 文字が先に来ることはまず無く、100-200 words の指示も字数に換算すると緩い。バックログ項目 7 が観測した「案がすべて 400 字超になる」現象は、この緩さと「失敗クエリを列挙する」構造の合わせ技である。

### 11-6. 隔離漏れの副作用は書き込みである

バックログ項目 1 の副作用の記述(`docs/chat/` に測定用セッションの記録が 4 件できた)は、読み取り専用のつもりの測定がリポジトリを書き換えた実例である。改修前に測定を回す必要があるときは、プロジェクト外の一時ディレクトリから起動する回避策(バックログ末尾)を使う。

---

**次のステップ提案**:

- この Context Map を基に設計書・実装計画を作成してよいか?
- 特に確認してほしい Open Questions: **#1(`--bare` の適用範囲。バックログの前提が実測で覆った)**、**#3(holdout の採否基準)**、**#5(長さ基準の具体値と SKILL.md の規律との整合)**。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。API キー・トークン・パスワードなどの機密情報を記録しないこと。*
