# agent-policy プロファイル統合 実装計画書

- 作成日: 2026-09-09
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.17.1-dev` → `0.18.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-09-agent-policy-profile-unification-design.md`(第 2 版。A-1 / A-2 の整合修正を反映済み)
- **設計書のユーザー承認: 2026-09-09(承認済み)。オーケストレーターの Approve: 済み。**
- context-map: `.claude/context-maps/2026-09-09-subagent-discipline-removal.md`(第 2 版)
- 実行方式: **Claude Code の Workflow ツール(Dynamic Workflow)**
- 版注: **第 2 版。** 最終ゲートの「着手不可」判定を受け、B-1〜B-8 と C-1〜C-7 を反映した。

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、**設計判断を上書きしない**。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §8「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

## 0. baseline(実装セッションが着手時に記入する)

### 0.1 記入欄

| 項目 | 値 |
| --- | --- |
| 着手時の HEAD(`git rev-parse HEAD`) | (記入) |
| `git status --short` の全文 | (記入) |
| `git diff --stat`(unstaged) | (記入) |
| `git diff --cached --stat`(staged) | (記入) |
| `git ls-files --others --exclude-standard`(未追跡) | (記入) |
| `pnpm run lint` | (記入) |
| `pnpm run typecheck` | (記入) |
| `pnpm run test` の Test Files / Tests / Duration | (記入) |

**baseline は `plugins/agent-policy/` に限定せず、リポジトリ全体で取る。** ルートの `package.json` L6 の `build` は `pnpm -r build` であり**全 workspace** を対象にする。他プラグインの生成物が変わっても検出できるようにするためである(B-8)。staged / unstaged / 未追跡を別々に記録するのは、最終確認で「許可対象外の新規差分」を識別するためである。

### 0.2 着手前に確認済みの事実(2026-09-09 時点の実測。実装セッションで再確認する)

- HEAD は `183774d`。
- `pnpm run test` は **Test Files 1 failed | 156 passed | 1 skipped (158)、Tests 8 failed | 2164 passed | 2 skipped (2174)**。
- 失敗 8 件はすべて `src/agents/__test__/discipline-role-table.test.ts` の describe「規律の役割」である。原因は L41 の `/^## 役割$/m` が、working tree で `## 担当表` へ改名された見出しに一致しないこと。エラーは `規律の「役割」節が見つからない`。**フェーズ 0(T1)が解消する。**
- 内訳(8 件): 役割節が表を 1 つ持つ / データ行数が ROLES と一致する / 行の並びが ROLES の定義順と一致する / 役割名が role.label と一致する / RoleId が role.id と一致する / 種別が role.kind と一致する / Agent Tool が allowsAgentTool と一致する / Claude モデルが ASSIGNMENTS と一致する。

### 0.3 触ってはならない未コミット差分(必読)

`plugins/agent-policy/` 配下には**ユーザーが意図して入れた未コミット差分が 3 ファイルある**。これらは本改修の前提であり、**revert してはならない**。

| ファイル | 差分の内容 |
| --- | --- |
| `references/orchestration-discipline.md` | 見出し `## 役割` → `## 担当表`、冒頭の定義文の削除、担当表の整形(区切り行が `---` から長いダッシュ列へ)、起動形態表の整形(1 列目は `\| --- \|` のまま、2・3 列目だけ長い)、用語変更(L33「dispatch」→「サブエージェントの起動」、**L35「実働は役割へ委譲してよい」→「実働はサブエージェントへ委譲してよい」および「次の 3 つ」→「次の3つ」「1 つの役割」→「1つの役割」**、L45「単一コンポーネントに閉じ」→「単一コンポーネントが対象で」、L48「1 メッセージ内で可能な限り並列に dispatch」→「可能な限り並列に起動」) |
| `skills/claude-model-policy/SKILL.md` | L10 から「担当表(…)はその文書の §役割 にある。」を削除 |
| `skills/custom-policy/SKILL.md` | 同上 |

リポジトリの他のディレクトリ(`docs/chat/`、`cliproxyapi.config.example.yaml`、`.raphael/`、`docs/prompts/` など)にも本改修と無関係な差分と未追跡ファイルがある。**触らない。revert もしない。** ただし §0.1 の baseline には全体を記録し、最終確認で「baseline に無い新規差分」を検出できるようにする(B-8)。

## 1. 進め方の共通規律

- 各タスクは**テストを先に書いてから実装する**。テストと実装が同じタスクに入る場合も、タスク内で順序を守る。
- `plugins/agent-policy/scripts/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する。
- **フェーズの境界では常に緑にする。** 赤が残ってよいのはタスクの内部だけである(§1「中間状態の許容範囲」)。
- **依頼文の生成規則(必須)。** 委譲するタスクの依頼文には、次をすべて転記する(C-2)。
  1. 対象ファイルの**絶対パス**と、そのタスクが書き込んでよいパスの列挙。それ以外へは書き込まない。
  2. 設計書の該当節番号と、**その節の「変更前」「変更後」ブロックの全文**。実装担当は設計書の全文を読まない前提で書く。
  3. §5 の共有契約のうち、そのタスクに必要な小節だけ(§5 全体を丸ごと渡さない)。
  4. **§6「想定される失敗と対策」のうち、そのタスクの ID が挙がっている行の全文。** これを転記しないと、タスク本体の記述だけでは足りない。
  5. 使用してよい tools、Agent tool の可否、報告形式。
  6. 「設計判断・要件の追加・スコープ拡大は自分で決めず、オーケストレーターへ差し戻す」。
  7. §0.3 の「触ってはならない未コミット差分」。
- 指示書(`references/*.md`・`skills/*/SKILL.md` の本文)の改修タスクでは、**`prompt-smith:prompt-smith` の評価工程(既存指示書の評価 → 承認 → 修正)を省略させる**。適用するのは書き方の基準だけである。評価を回すと設計書が決めた文面が書き換わる。
- 同一フェーズ内のタスクは 1 メッセージで並列に dispatch する。フェーズ間は直列とする。
- **`Skill` tool を持たない役割へスキル付きタスクを割り当てない。** `src/agents/roles.ts` L46 のとおり `ROLES` カタログ上の「軽量な実装」の `tools` に `Skill` が無い。
- 「軽量な実装」「コードレビュー」「コードベース探索実働」へ dispatch するタスクの依頼文には、**使用してよい tools を明記し、Agent tool を使わないことを書く**。読み取りだけのタスク(T15 / T17)には「ファイルを変更しない」「報告のみを返す」も書き、**テストの実行やビルドをさせない**。
- **grep によるゼロ件検証の扱い(B-3)。** ゼロ件を期待するコマンドを「終了コード 0」の要求へ変換しない。`grep` は一致なしで終了コード 1 を返すため、`grep -c` の**出力値**を見るか `|| true` を付けて件数で判定する。実行エラー(パスの誤り等)と「一致なし」を区別できる形で書く。

### 中間状態の許容範囲(必読)

**フェーズの境界はすべて緑である。** 一時的に赤になるのはタスクの内部だけで、次の 2 区間である。

| 区間 | 何が赤になるか | 解消するもの |
| --- | --- | --- |
| T3 の内部 | `markerTable()` に第 3 引数を足した直後、**呼び出し 9 箇所(本番 3 + テスト 6)が typecheck エラーになる**。加えて `marker-scan.test.ts` L390-396 の完全一致アサーションと `subagent-start.test.ts` L446 の `slice(1)` が実行時に落ちる | T3 の後半(同一タスク内で 9 箇所すべてを追随させる) |
| T4 / T5 / T6 / T7 の内部 | テストを先に書いた時点で、実装がまだ無いため赤 | 同一タスク内の実装 |

**T3 の設計上の要点。** 第 3 引数の追加とその 9 箇所の追随を**同じタスクに閉じる**。分割すると T3 から T6 まで typecheck が赤のままになり、フェーズ境界で判定できない。T3 では**振る舞いを変えない**。3 つの本番呼び出しにはいずれも `"with-external"` を渡し、現行と同じ結果になるようにする。プロファイルに応じた出し分けは T4 / T5 / T6 が行う。

**T3 完了後に「緑だが意味を失う」テストが 1 件ある。** `subagent-start.test.ts` L465-486(設計書 §9.2 の No. 38)は `firstRoleLine = fullTable.split("\n")[1]` を最初の役割行として扱うが、T3 以降この行は scope 行になる。`toContain(intro + "\n" + scope)` は成立するため緑のままだが、テストの意図は失われる。**T5 が削除するまでの間、このテストが緑であることを根拠に何かを判断しない。**

## 2. タスク分割

### フェーズ 0: 既存 8 failed の解消(直列 1)

**目的**: baseline の 8 failed を解消し、以降のフェーズを緑から判定できるようにする。**他のどのタスクよりも先に置く。**

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T1 | `discipline-role-table.test.ts` の 3 箇所を直す。(a) L41 の `/^## 役割$/m` を `/^## 担当表$/m` へ、L43 のエラー文言を「規律の「担当表」節が見つからない」へ。(b) L81-84 の区切りセル判定を `cell === "---"` から `/^-+$/.test(cell)` へ、L83 のエラー文言を「担当表の区切り行が不正」へ。(c) L227-228 の `FORBIDDEN_ROLE_TABLE_HEADINGS` へ `担当表` を先頭に足す。あわせて L57 / L73 / L78 のエラー文言中の「役割の表」を「担当表」へ揃える | `plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts` | 通常の実装 | 不要 |

- 転記する設計書の節: **§6.11 / §7.16**。§6 の失敗 1。
- **(b) を必ず含める。** (a) だけを直すと、次は L83 の「役割の表区切り行が不正」で同じ 8 件が落ちる。working tree の担当表の区切り行は `| -------------------------------- | ... |` であり `"---"` との厳密一致に当たらない(実機確認済み)。**担当表の整形はユーザーの未コミット差分であり revert してはならない。**
- 検証: `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts` が **13 passed / 0 failed**。`pnpm run typecheck` エラー 0。`pnpm run lint` が通る。
- 完了条件: 上記 + **`pnpm run test` が 0 failed**。

### フェーズ 1: 候補集合の正本(直列 1)

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T2 | `policies.ts` へ `CandidateScope` / `CLAUDE_ENUM_MODELS` / `runsOnClaude()` / `candidateScopeFor()` を新設。L39 の `label` を「Claude のみ(レガシー)」から「Claude のみ」へ。L122 のコメント「共通規律 §役割」を「共通規律 §担当表」へ。`policies.test.ts` を先に書き換える(L84 の label、`CLAUDE_ENUM_MODELS` と `MODELS` の集合一致、`runsOnClaude`、`candidateScopeFor` の新規ケース) | `plugins/agent-policy/src/agents/policies.ts`、`plugins/agent-policy/src/agents/__test__/policies.test.ts` | 複雑または重要な実装 | 不要 |

- 転記する設計書の節: **§6.1 / §7.9 / §9.4 の `policies.test.ts` 部分**。§5 のうち **§5.1 だけ**を渡す(§5.2-5.7 は不要)。§6 の失敗 該当なし。
- **`CLAUDE_ENUM_MODELS` の並びは `["sonnet","opus","haiku","fable"]`。** `MODELS` の定義順(opus 先頭)から導かない。`MODELS` との一致は**集合として**テストする。
- **`setup-agents.ts` L73 の `CLAUDE_ENUMS` はこのタスクでは消さない。** 消すと同ファイルが typecheck で落ちる。統合は T7 が行う。
- 検証: `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/policies.test.ts` 全緑。`pnpm run typecheck` エラー 0。`pnpm run lint` が通る。
- 完了条件: 上記 + `pnpm run test` 0 failed。

### フェーズ 2: `markerTable` の第 3 引数化と 9 箇所の追随(直列 1)

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T3 | `marker-scan.ts` へ `CLAUDE_VENDORS` / `runsOnClaudeAgent()` / `candidateAgents()` / `SCOPE_LINES` を新設し、`markerTable()` に第 3 引数 `scope: CandidateScope` を足して `lines` の初期値を 2 行にする。**同じタスクで呼び出し 9 箇所すべてを追随させる**(§5.3)。本番 3 箇所にはいずれも `"with-external"` を渡し、振る舞いを変えない。`marker-scan.test.ts` へ `candidateAgents` と scope 行のケースを足す | `plugins/agent-policy/src/hooks/marker-scan.ts`、`.../session-start.ts`、`.../subagent-start.ts`、`.../delegation-gate.ts`、`.../__test__/marker-scan.test.ts`、`.../__test__/subagent-start.test.ts`、`.../__test__/delegation-gate.test.ts`(**7 ファイル**) | 複雑または重要な実装 | 不要 |

- 転記する設計書の節: **§6.6 / §7.10 / §9.4 の `marker-scan.test.ts` 部分**。§5.2 と §5.3。§6 の失敗 2 / 3 / 4 / 5。
- **アサーションの書き換えが要る 2 箇所。**
  - `marker-scan.test.ts` L390-396: `expect(result).toBe([TABLE_HEADING, "- 通常の実装: …", "- コードレビュー: …"].join("\n"))` は**完全一致**である。期待値の配列の 2 番目へ scope 行を挿入する。文面は §5.2 から写す。
  - `subagent-start.test.ts` L446: `const fullRoleLines = fullLines.slice(1)` を `slice(2)` へ。scope 行が 2 行目に入り役割行の起点が 1 つずれるため、直さないと L456-458 の `toEqual` が左右でずれて落ちる。
- 検証: `pnpm run typecheck` エラー 0(追随漏れがあればここで落ちる)。`pnpm exec vitest run plugins/agent-policy/src/hooks/__test__/` 全緑。`pnpm run test` 0 failed。
- 完了条件: 上記 + **振る舞いが変わっていないこと**(表の 2 行目が増える以外の差が無い)。

### フェーズ 3: 3 フックのプロファイル対応(並列 3)

3 タスクの対象ファイルは互いに重ならない。1 メッセージで並列に dispatch する。

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T4 | `session-start.ts`: `CLAUDE_RESOLVED_MODELS`(L24-30)を削除して `runsOnClaude` へ置換、L2 のコメント差し替え、`claudeBlocks()` の新設(`unknownRoleBlock` を含み、渡す配列は `candidateAgents` の後)、`successBlocks()` の**本体差し替え**、claude 分岐、claude フォールバック 3 経路。`session-start.test.ts` を先に書き換える(**既存 1 ケースの期待値変更 + 改題**、新設 10 ケース) | `plugins/agent-policy/src/hooks/session-start.ts`、`.../__test__/session-start.test.ts` | 複雑または重要な実装 | 不要 |
| T5 | `subagent-start.ts`: 断片関連の削除(`import fs` L5 / `MARKER_LINE` L17 / `ContextSections` L42-46 / `fragmentLines` L192-198 / `composeSections` L200-222 / `render` L224-226 / `readFragment` L255-270)、冒頭コメント、`truncateTable()` への置換、`tableFor()` の新設、`buildContext()` の書き換え。`subagent-start.test.ts` の整理(削除 6 ケース / 期待値差し替え 8 / fixture のみ 1 / 新設 3 / describe 改題)。**最後に `references/subagent-discipline.md` を削除する** | `plugins/agent-policy/src/hooks/subagent-start.ts`、`.../__test__/subagent-start.test.ts`、`plugins/agent-policy/references/subagent-discipline.md`(削除) | 複雑または重要な実装 | 不要 |
| T6 | `delegation-gate.ts` L321-333: `candidateScopeFor` で scope を求め(`undefined` なら `"claude-only"`)、`candidateAgents` を通した配列と scope を `markerTable` へ渡す。**`delegation-gate.test.ts` の環境隔離を直す**(下記)。scope 別のケースを足す | `plugins/agent-policy/src/hooks/delegation-gate.ts`、`.../__test__/delegation-gate.test.ts` | 通常の実装 | 不要 |

- 転記する設計書の節: T4 → **§6.3 / §7.11 / §9.3**。T5 → **§6.2 / §6.5 / §6.7 / §7.1 / §7.12 / §9.2**。T6 → **§7.13 / §9.4 の `delegation-gate.test.ts` 部分**。§5.1 と §5.2 を 3 タスクとも渡す。§6 の失敗は T4 → 8、T5 → 6 / 7、T6 → 該当なし。

**T4 の既存テストの扱い(B-1。「L213 の改題だけ」では済まない)。**

`session-start.test.ts` L213-220 は `place("hidden", ["agent-policy-role: no-such-role"])` を置き、次の 3 つを固定する。

```ts
    expect(output).toContain("agent-policy:claude-model-policy")
    expect(output).not.toContain("hidden")
    expect(output).not.toContain("未知の役割 ID")
```

- `markerTable`(`marker-scan.ts` L197)は未知 RoleId を落とすため**表は出ない**。ここは設計どおり。
- しかし `unknownRoleBlock`(`session-start.ts` L52-69)は同じ RoleId で通知を作り、行は `- ${entry.name}: ${role}` である。見出しは「次の Agent 定義は未知の役割 ID を宣言している。無視した。…」。
- `no-such-role` の定義は `model` 未宣言なので `runsOnClaude(undefined)` が真、`vendor` も未宣言なので**候補に残る**。

したがって T4 が `claudeBlocks` へ `unknownRoleBlock(env, candidates)` を入れると、**L218(`not.toContain("hidden")`)と L219(`not.toContain("未知の役割 ID")`)の両方が落ちる。** これは退行ではなく設計どおりの新しい挙動である。

T4 は次のように扱う。

1. **既存 L213-220 を期待値変更 + 改題する。** 新しいタイトルは「claude では対応表を出さないが、候補内の未知 RoleId は通知する」。アサーションを `toContain("agent-policy:claude-model-policy")` / `not.toContain(TABLE_INTRO)` / **`toContain("未知の役割 ID")`** / **`toContain("hidden")`** へ変える。
2. **新設ケースを 2 つ足す(設計書 §9.3 の 8 ケースに加えて)。**
   - 「候補内の未知 RoleId は通知される」——(1) で置き換えた内容を独立ケースにしてもよい。
   - **「候補外の外部定義の未知 RoleId は通知されない」** —— `place("gpt-def", ["model: claude-gpt-5-6-luna", "agent-policy-vendor: gpt", "agent-policy-role: no-such-role"])` を置き、`claude` で `not.toContain("gpt-def")` を固定する。これが `unknownRoleBlock` へ渡す配列を `candidateAgents` の**後**にした理由の回帰である。
3. 設計書 §9.3 の新設 8 ケースと合わせて **新設は 10 ケース**になる。

**T6 のテスト環境隔離(B-2)。** `delegation-gate.test.ts` L31-44 の `environment()` は `process.env` を複製し、`AMATSUKA_AGENT_DELEGATION_GATE` と `CLAUDE_PROJECT_DIR` だけを削除する。**`AMATSUKA_AGENT_AUTO_INJECTION` はホストセッションから継承される。** T6 で gate が scope を計算するようになると、ホストの環境変数によって scope が変わり、L390 が `markerTable(env, scanAgents(agentsDir))` に固定値の scope を渡していると実出力と食い違う。fixture の `lead.md` は `model: opus` なのでどちらの scope でも表に載るが、**2 行目の scope 行が違う**ため `toContain` が落ちる。T6 は次を行う。

- `environment()` から `AMATSUKA_AGENT_AUTO_INJECTION` を**削除する**(隔離する)。
- ケースごとに `overrides` で明示的に値を与える。
- L390 の `expected` は、そのケースの env から導いた scope を渡して作る。

**T5 の削除順序を守る(C-2)。** テストの整理 → 実装の改修 → 断片の削除、の順である。断片が残っている間はテストが実ファイルを読むため、差し替えた期待値が偶然通る紛れが生じる。**`import path from "node:path"` は削除しない。** `fs` の使用箇所は `readFragment` L262 の 1 つだけだが、`path` は `bundledAgentsDir()`(L275)が使う。

**T4 と T5 の共有面。** `subagent-start.test.ts` の No. 17(L276-293)は `sessionContext()` 経由で `session-start.ts` を起動し、SessionStart と SubagentStart の対応表が同一であることを固定する。`custom` 環境で走るため両者とも `with-external` になり、T4 の変更(claude 分岐とフォールバック)は当たらない。並列でよいが、**このケースが落ちたときは T4 の `successBlocks` を疑う**。

- T4 の検証: `pnpm exec vitest run plugins/agent-policy/src/hooks/__test__/session-start.test.ts` 全緑。新設 10 ケースが存在する。
- T5 の検証: `pnpm exec vitest run plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts` 全緑。展開ケース数が **35**(38 − 6 + 3)。`ls plugins/agent-policy/references/subagent-discipline.md` が失敗する。`grep -rn "subagent-discipline" plugins/agent-policy/src/ | wc -l` が **0**。
- T6 の検証: `pnpm exec vitest run plugins/agent-policy/src/hooks/__test__/delegation-gate.test.ts` 全緑。`environment()` が `AMATSUKA_AGENT_AUTO_INJECTION` を削除している。
- 完了条件: 3 タスク + `pnpm run typecheck` エラー 0 + `pnpm run test` 0 failed。

### フェーズ 4: `setup-agents` の `--scope`(直列 1)

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T7 | 設計書 §7.15 の **11 行**すべてを実装する。あわせて **既存テストの scope 前提を棚卸しする**(下記)。テストを先に書き換える | `plugins/agent-policy/src/setup-agents.ts`、`plugins/agent-policy/src/__test__/setup-agents.test.ts` | 複雑または重要な実装 | 不要 |

- 転記する設計書の節: **§6.9(食い違い表を含む)/ §7.9 の `CLAUDE_ENUM_MODELS` 部分 / §7.15 / §9.4 の `setup-agents.test.ts` 部分**。§5.1。§6 の失敗 9 / 10 / 11。
  - **注意(B-4)**: `CLAUDE_ENUM_MODELS` の定義は設計書 **§7.9**(`policies.ts`)にある。§7.12 は `subagent-start.ts`(T5 の担当ファイル)なので**転記しない**。
- **設計書 §7.15 は 11 行である。** `CLAUDE_ENUMS` の削除 / `Options.scope` の追加 / `--scope` の新設 / 拒否メッセージ / `listLiveModels(live, scope)` / `main()` の照会回避 / `targetsFor` の `--models` 経路 / `targetsFor` の `--model-id` 経路 / `coveredDefinitions` / `listCoverage` / 6b の推奨の出所。
- **既定の導出には `candidateScopeFor` を使う。`policyForInjection` を使わない。** 設計書 §7.15 の該当行と §6.9 は同じ結論であり、矛盾しない(第 2 版で整合済み)。
- **`--model-id` 経路のフィルタを忘れない。** 現行 L309-313 は `--models` 経路の外にあり、フィルタが掛かっていない。

**既存テストの scope 前提の棚卸し(B-2)。** `setup-agents.test.ts` は **1,875 行 / describe 15 / `it`・`it.each` 75 宣言 / 展開後 80 ケース**である。`AMBIENT_ENV_VARS`(L145-154)は `AMATSUKA_AGENT_AUTO_INJECTION` を含み、`inheritedTestEnv()`(L156-160)がそれを子プロセス環境から削除する。`run()`(L162-176)と `runAsync()`(L178-199)はいずれも `inheritedTestEnv()` の上に第 2 引数の env を重ねる。**したがって既存テストは全件が「injection 未設定」で走り、新仕様では既定 scope が `claude-only` になる。** `targetsFor` は `--check` でも `--write` でも通るため、`--model-id gpt-sol` を渡すケースは `--check` だけのものも含めて落ちる。

T7 は次の手順で棚卸しする。**件数は実測値である。**

1. **分類する。**
   - (a) `--list-live-models` で外部モデル ID を期待するケース —— **1 件**。L287「live models と Claude enum を推奨役割付きで返す」(L306 で `claude-gpt-5-6-sol`、L311 で `claude-gpt-6-astra` を期待)。
   - (b) `--list-coverage` で `models` に GPT / Grok の ModelId を期待するケース —— **2 件**。L394「複数モデルの役割と各役割の defaultName を返す」(L405 で `gpt-astra`)、L415「RECOMMENDED の役割集合とモデル割当を返す」(L421 で `gpt-sol`、L424 / L427 で `gpt-astra`)。claude-only の出所は `ASSIGNMENTS` になるため期待値が変わる。
   - (c) `--model-id` に `gpt-` / `grok` を渡し `--scope` を持たないケース —— **39 宣言 / 展開後 42 ケース**。多くは共通ヘルパー `check()`(L224-238)と `writeArgs()`(L1402-1414)が `--model-id gpt-sol` を既定で渡すことによる。代表: L612 / L618 / L635 / L644 / L650 / L659 / L665 / L671 / L677 / L687(`gpt-terra`)/ L711(`gpt-luna`)/ L729(`grok`)/ L778 / L788 / L797 / L827 / L868 / L924 / L942 / L966 / L982 / L1009 / L1029 / L1050 / L1068 / L1086 / L1106 / L1151 / L1189 / L1213 / L1237 / L1261 / L1285 / L1326(`gpt-astra`)/ L1416 / L1437 / L1457 / L1470(`it.each` 4 パラメータ)/ L1494。
   - (d) `--models` を使い `--scope` を持たないケース —— **7 件**。L1512 / L1540 / L1568 / L1597 / L1618 / L1640(`haiku`)/ L1655(`haiku`)。
   - **`--scope` のリテラルは現在ファイル内に 1 つも無い。**
2. **従来の custom 動作を検証するケースには `--scope custom` を明示的に足す。** `check()` と `writeArgs()` が `--scope` を受け取れるようにし、(c) の 39 宣言と (d) の 7 件のうち外部モデルを前提とするものへ渡す。(a) と (b) は期待値の性質が変わるため、`--scope custom` を足して現行の期待値を維持するケースと、`--scope claude` で新しい期待値を固定するケースの**両方**を置く。
3. **ヘルパー全体を custom 固定にしない。** それをすると新しい既定値が検証不能になる。既定値の検証は**専用のケース**で行い、`--scope` を明示するケースと分離する。`check()` / `writeArgs()` の既定を `--scope custom` にするのではなく、**呼び出し側が明示的に渡す**形にする。
4. 分類の件数と、変更したケースの一覧を報告に載せる。**実測と食い違ったら実装を止めて報告する。**

- T7 の検証:
  - `pnpm exec vitest run plugins/agent-policy/src/__test__/setup-agents.test.ts` 全緑。
  - `--scope` の新設ケースが存在する: 解析(`claude` / `custom` / 不正値のエラー)/ 既定の一致(未設定・`none`・`claude`・`custom`・旧 3 値・`CuStOm` の 6 通りが `candidateScopeFor` と同じ結論)/ `--models` の絞り込みと `modelsDropped` / `--model-id gpt-sol` のエラー / `--list-live-models` の非照会 / `--list-coverage` の被覆判定 / **通常 setup 経路(`--write`)でも照会しないこと** / **`--model-id sonnet --model <外部モデル値>` の拒否** / **claude の未カバー役割の推奨が `ASSIGNMENTS` 由来であること**(C-6)。
  - **非照会の検証は「返却 JSON の `models` が空」だけで済ませない。** 模擬サーバーへの到達回数(`server.requests` 等)が 0 であることで固定する(C-6)。
  - `pnpm run typecheck` エラー 0。
- 完了条件: 上記 + `pnpm run test` 0 failed。

### フェーズ 5: 指示書と付随文書(並列 5)

5 タスクの対象ファイルは互いに重ならない。

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T8 | 共通規律の改稿。L3 / L54 の書き換え、**L60 の削除**、新設 7 条項、`## 委譲先の解決` 節の新設、L64 と L136 のダングリング参照の解消 | `plugins/agent-policy/references/orchestration-discipline.md` | 通常の実装 | `prompt-smith:prompt-smith` |
| T9 | `## 実行役割の解決順` 節(L12-18)を削除し、L10 の直後へ 1 段落を置く | `plugins/agent-policy/skills/claude-model-policy/SKILL.md` | 通常の実装 | `prompt-smith:prompt-smith` |
| T10 | `## 実行役割の解決順` 節(L14-25)を削除、L12 の書き換え、`## セッション途中で委譲先が使えなくなったとき` の L38 を削除 | `plugins/agent-policy/skills/custom-policy/SKILL.md` | 通常の実装 | `prompt-smith:prompt-smith` |
| T11 | ステップ 0b の新設、ステップ 1 / 1b / 4 / 6b / **7** の分岐追加、非対話モードの分岐、**§5.4 の「要」12 コマンドへの `--scope` の追加** | `plugins/agent-policy/skills/setup-agents/SKILL.md`(**本文のみ。frontmatter は触らない**) | 複雑または重要な実装 | `prompt-smith:prompt-smith` |
| T12 | プラグイン README の L13 / L150 / L210 / L212 / L214 / L236 と 0.18 移行節(8 項目)の新設、ルート README L113、`hooks.json` L2 の description | `plugins/agent-policy/README.md`、`README.md`、`plugins/agent-policy/hooks/hooks.json` | 軽量な実装 | 不要 |

- 転記する設計書の節: T8 → **§7.2 / §7.3 / §7.4 / §7.5 / §7.6 / §7.7**。T9・T10 → **§7.8**。T11 → **§7.14 の変更 2〜8 の全文**(B-5。**変更 8 = ステップ 7 の報告の書き換えを含む**)と §5.4。T12 → **§7.17 の全文**(変更前 / 変更後のブロックをすべて)。§6 の失敗は T8 → 12 / 13、T11 → 14 / 15、T12 → 16。
- **T8 の挿入位置(C-1)。** `## 委譲先の解決` は「**`## 担当表` 節の直後**、`## オーケストレーターが自ら担う作業` の前」に置く。**見出しの直後ではない。** 担当表の表本体と 4 つの補足箇条書きの後である。見出しの直後へ入れると `extractRoleBandSection`(`discipline-role-table.test.ts` L40-48)が次の `## ` までしか取らず担当表を失い、**T1 が直した 8 件が再失敗する。**
- **T8 は「L60 を削除する」を独立した項目として扱う。** 新設 2 は L60 の置き換えである。両方残すと主語の違う同内容の条項が並置される。
- **T11 は frontmatter を触らない。** `description` は T13 が扱う。同じファイルなので順序を守る。
- **T12 の `hooks.json` は `description` の 1 行だけを変える。`hooks` 配列は変更しない。** 保護パスの「変更に慎重を要するパス」である。
- 各タスクの検証:
  - T8: `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts` が **13 passed のまま**(担当表を失っていないことの確認を兼ねる)。`grep -c "^- サブエージェントは、" .../orchestration-discipline.md` が **9**。`grep -c "実行役割の解決順" .../orchestration-discipline.md` が **0**。`grep -c "^## 委譲先の解決$" .../orchestration-discipline.md` が **1**。
  - T9 / T10: `grep -c "実行役割の解決順" <対象>` が **0**。`grep -c "ビルトイン .Explore." <対象>` が **0**。同テストが 13 passed。
  - T11: **§5.4 の「要」12 コマンドすべてに `--scope` があること。** 判定は行番号ではなくコマンド内容で行う(下記の一行検査)。`grep -c "### ステップ 0b" <対象>` が **1**。
  - T12: **ゼロ件検証は使わない**(B-3)。`grep -n "サブエージェント向けの規律" plugins/agent-policy/README.md` の結果が**移行項目 5 の 1 行だけ**であり、L13 / L150 / L236 に残っていないことを行番号で確認する。`node -e "JSON.parse(require('fs').readFileSync('plugins/agent-policy/hooks/hooks.json','utf8'))"` が成功する。
- 完了条件: 5 タスク + `pnpm run test` 0 failed + `pnpm run lint` が通る。

### フェーズ 6: `setup-agents` の description(直列 1)

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T13 | frontmatter の `description` を設計書 §7.14 変更 1 の「変更後」へ差し替える | `plugins/agent-policy/skills/setup-agents/SKILL.md`(**frontmatter のみ**) | 通常の実装 | `prompt-smith:skill-creator` |

- 転記する設計書の節: **§7.14 変更 1**。**T11 の完了後に行う。**
- 検証: `grep -c "custom プロファイル専用" <対象>` が **0**。frontmatter が YAML として妥当。

### フェーズ 7: バージョンとビルド(直列 1)

| ID | 内容 | 書き込んでよいパス | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T14 | `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/.claude-plugin/plugin.json` と `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/package.json` の `version` を `0.18.0-dev` へ揃える。`plugin.json` の `description` を §7.18 の「変更後」へ。cwd をリポジトリルートにして `pnpm run build` を実行する | 上記 2 ファイル + `plugins/agent-policy/scripts/*.mjs`(生成物) | 軽量な実装 | 不要 |

- 転記する設計書の節: **§7.18**。§6 の失敗 17。
- **対象を取り違えない(B-8)。** manifest は `plugins/agent-policy/.claude-plugin/plugin.json`、package は `plugins/agent-policy/package.json` である。ルートの `package.json` と `.claude-plugin/marketplace.json` は**触らない**。
- **`pnpm run build` はルートで `pnpm -r build` を呼び、全 workspace の生成物を作り直す。** 実行後に `git status --short` を**リポジトリ全体**で取り、`plugins/agent-policy/scripts/` 以外に差分が出ていないかを確認する。出ていたら実装を止めてオーケストレーターへ報告する。
- 検証: 両 json が `0.18.0-dev`。`pnpm run build` が成功。`git diff --stat plugins/agent-policy/scripts/` に差分がある。**`git status --short` の全体が baseline + 本計画の変更一覧に収まる。**
- 完了条件: 上記 + `pnpm run test` 0 failed。

### フェーズ 8: 統合検証(**T16 → T15 / T17 並列 → T18 → T20 → 必要な再検証 → T19** の順。B-7)

**この順序は必須である。** 並列にしてよいのは T15 と T17 だけである。

| ID | 内容 | 担当役割 | スキル |
| --- | --- | --- | --- |
| T16 | **機械コマンドの実行と記録に限る。** (1) `pnpm run build`。(2) `pnpm run lint`。(3) `pnpm run typecheck`。(4) `pnpm run test`(Test Files / Tests / Duration を記録)。(5) `git diff --stat`(リポジトリ全体)。(6) `git status --short`(全体)と `git ls-files --others --exclude-standard`。(7) `wc -c plugins/agent-policy/references/orchestration-discipline.md plugins/agent-policy/references/context-map-guide.md` を §8 の実測欄へ記録。**各結果に、そのときの `git rev-parse HEAD` と `git diff \| sha256sum` を添える**(検証対象の差分を識別するため)。散文の突き合わせは行わない(T19 の担当) | オーケストレーター | 不要 |
| T15 | **残存参照の全数確認(読み取りのみ)。** §5.5 の検査コマンド表を上から実行し、結果を報告する。**ファイルを変更せず、テストの実行やビルドをしない** | コードベース探索実働 | 不要 |
| T17 | **差分のレビュー。** `git diff` と新規・削除ファイルを読み、設計書 §7 の「変更前」「変更後」との一致、命名(加算語彙)、fail-open の維持、deny-list の維持、`NO_MARKERS` の文言の維持を見る。**ファイルを変更せず、指摘のみを返す** | コードレビュー | 不要 |
| T18 | **実機検証。** §5.6 の手順に従う | オーケストレーター | 不要 |
| T20 | **保護パスの更新。** §5.7 の手順に従う | オーケストレーター | 不要 |
| — | **必要な再検証。** T15 / T17 / T18 / T20 の結果として差分が変わったら、影響する検証を再実行する(下記) | オーケストレーター | 不要 |
| T19 | **最終突き合わせ。** 全差分を分割せず一度に読み、§7 の Done 条件チェックリストを上から順に確認する。T15 / T17 の指摘の採否を判断する。要約の要約では判断しない | オーケストレーター | 不要 |

**再検証の規則(B-7)。**

- **レビュー指摘が未解決のまま T19 へ進まない。** 未解決なら停止し、オーケストレーターが採否を決める。
- 修正を入れたら、影響する検証を再実行する。対応表は次のとおり。

| 修正の種類 | 再実行するもの |
| --- | --- |
| `src/**/*.ts` の変更 | T16 の (1)〜(4)、T15、T17、T18 |
| `references/` / `skills/` / README / `hooks.json` の変更 | T16 の (2)(4)(7)、T15、T17。`hooks.json` を触ったなら T18 の (c) |
| `.claude/agents/` に影響する変更 | T18 の (a)(b) |
| バージョン・生成物の変更 | T16 の (1)(5)(6)、T18 |

- **修正前の成功報告を最終 Done へ流用しない。** T16 が記録した `HEAD` と差分のハッシュが、T19 が見ている差分と一致することを確認する。一致しなければその検証は無効であり、再実行する。
- **T16 の `pnpm run build` はバンドルを書き換える。** そのため T15 / T17 は T16 の完了後に走らせる。並列にすると、書き換え中の生成物を読む経路が残る。

**T20 はサブエージェントに委譲できない。** `.serena/memories/` の更新は Serena の `write_memory` / `edit_memory` でしか行えず、委譲先の定義はこれらの tool を持たない。ARCHITECTURE も metatron の CLI 経由でしか更新できない保護パスである。オーケストレーター自身が行う。

## 3. 依存関係

```
T1 ── T2 ─┬─ T3 ─┬─ T4 ─┐
          │      ├─ T5 ─┼─┐
          │      └─ T6 ─┘ │
          └───── T7 ──────┴─(F3・F4 完了)─┬─ T8 ──┐
                                          ├─ T9 ──┤
                                          ├─ T10 ─┼─(F5 完了)─ T13 ── T14 ── T16 ─┬─ T15 ─┐
                                          ├─ T11 ─┤                                └─ T17 ─┴─ T18 ── T20 ──(再検証)── T19
                                          └─ T12 ─┘
```

- **T1 は全タスクに先行する。** baseline が 8 failed のままでは、以降のどのフェーズも「緑になったか」を判定できない。
- T2 は T3 / T4 / T6 / T7 が使う述語を定義する。
- **T3 は T4 / T5 / T6 に先行する。** 3 フックとも `markerTable` を呼ぶため、署名が変わる前に個別の改修を始めると衝突する。
- **T7 は T2 の完了後であれば T3 と並列にできる。** `setup-agents.ts` は `src/hooks/` を import せず、`policies.ts` の `CLAUDE_ENUM_MODELS` にだけ依存する。上図はこれを反映して T2 から分岐させている(本文と依存図の食い違いを解消した。B-7)。並列度を上げたいときは T3 / T7 を同時に走らせ、その後 T4 / T5 / T6 を 3 並列にする。
- フェーズ 3 の 3 タスクは対象ファイルが重ならない。共有面は `subagent-start.test.ts` No. 17 のみ。
- フェーズ 5 の 5 タスクは対象ファイルが重ならない。**T11 と T13 だけが同じファイル**であり、本文と frontmatter に分かれる。**T13 は T11 の後**。
- **フェーズ 5 を実装フェーズと並列にしない理由(C-7 の訂正)。** 第 1 版は「T9/T10 が消す節を T12 が参照するため」と書いたが、これは誤りである。T12 は README を書き換える側であり、T9/T10 の完了を技術的前提にしない。**正しい理由は 2 つある。** (1) T8 が変える共通規律を `discipline-role-table.test.ts` が読むため、T8 と T1 以外のテスト変更が同時に走ると、赤の原因の切り分けが難しくなる。(2) T12 の README 移行節が「`--scope` を足した」「対応表を注入するようになった」と書くため、T7 と T4 の実装が確定してから書くほうが食い違いを避けられる。**技術的な依存ではなく切り分けやすさのための直列である。** 並列にしてもビルドは壊れない。
- T14 の `pnpm run build` は T3 / T4 / T5 / T6 / T7 の `src/` 変更を前提にする。文書だけを変える T8-T13 は build に影響しない。
- **T18(実機検証)は T14 の後に置く。** `scripts/*.mjs` が再生成されていないと、フックは古い実装で動く。

## 4. 委譲先

| 担当役割 | 割り当てるタスク | 件数 |
| --- | --- | --- |
| 複雑または重要な実装 | T2 / T3 / T4 / T5 / T7 / T11 | 6 |
| 通常の実装 | T1 / T6 / T8 / T9 / T10 / T13 | 6 |
| 軽量な実装 | T12 / T14 | 2 |
| コードレビュー | T17 | 1 |
| コードベース探索実働 | T15 | 1 |
| オーケストレーター | T16 / T18 / T19 / T20 | 4 |
| **合計** | | **20** |

- **スキルをロードするタスク(T8 / T9 / T10 / T11 / T13)を「軽量な実装」へ割り当てない。** `src/agents/roles.ts` L46 のとおり `ROLES` カタログ上の「軽量な実装」の `tools` に `Skill` が無い。
- **`ROLES` の tools と、実際に委譲される定義の tools は別物である。** dispatch 前に委譲先定義の `tools` を確認し、`Skill` が無ければ `Skill` を持つ役割へ振り替える。
- 「軽量な実装」「コードレビュー」「コードベース探索実働」には Agent tool を許可しない。依頼文に「この tools のみ使用」「Agent tool は使わない」「迷いは相談ではなく差し戻しで解決する」と書く。
- T15 と T17 の依頼文には「**ファイルを変更しない**」「**報告のみを返す**」「**テストの実行やビルドをしない**」「この tools のみ使用: `Read` / `Grep` / `Glob` / 読み取りに限った `Bash`」を明記する。
- T2 / T3 / T4 / T5 / T7 を「複雑または重要な実装」にする理由: T3 は **7 ファイル**にまたがる署名変更(9 は呼び出し箇所の数であってファイル数ではない。C-4)、T4 は 6 箇所の書き換えと 10 ケースの新設、T7 は 11 行の CLI 改修と 31 件超の既存テストの棚卸し、T2 は新しい型と述語の設計を含む。T11 は 12 コマンドと 6 ステップの分岐を扱う。

## 5. タスク間で共有する契約

**依頼文には、そのタスクに必要な小節だけを転記する。** §5 全体を丸ごと渡さない。

### 5.1 候補集合の述語(T2 / T3 / T4 / T6 / T7 が共有)

| 名前 | 値・定義 | 置き場所 |
| --- | --- | --- |
| `CLAUDE_ENUM_MODELS` | `["sonnet", "opus", "haiku", "fable"]`(この並び) | `policies.ts` |
| `CLAUDE_RESOLVED` | `CLAUDE_ENUM_MODELS` + `"inherit"` | `policies.ts`(非 export) |
| `runsOnClaude(model)` | `model === undefined \|\| CLAUDE_RESOLVED.has(model)` | `policies.ts` |
| `CandidateScope` | `"claude-only" \| "with-external"` | `policies.ts` |
| `candidateScopeFor(v)` | `isCustomInjection(v)` なら `"with-external"`、`v?.trim().toLowerCase() === "claude"` なら `"claude-only"`、それ以外は `undefined` | `policies.ts` |
| `CLAUDE_VENDORS` | `new Set(["claude", "none"])` | `marker-scan.ts`(非 export) |
| 候補の条件 | `runsOnClaude(entry.model)` **かつ**(`entry.vendor === undefined` または `CLAUDE_VENDORS.has(entry.vendor)`) | `marker-scan.ts` の `runsOnClaudeAgent` |

### 5.2 `SCOPE_LINES` の全文(T3 が実装。T3 / T4 / T5 / T6 のテストが部分文字列で固定する)

```
claude-only:
表に無い役割の委譲先も、`model` が `sonnet` / `opus` / `haiku` / `fable` / `inherit` のいずれかまたは未宣言で、かつ `agent-policy-vendor` が `claude` / `none` のいずれかまたは未宣言である定義から選ぶ。それ以外の定義は委譲先にしない。

with-external:
表に無い役割の委譲先は、外部ベンダーのモデルを指定した定義も含めて選んでよい。
```

- 文面の正本は `marker-scan.ts` のコードである。
- **テストが固定するのは部分文字列だけ**とする。`claude-only` は **`"それ以外の定義は委譲先にしない"`**、`with-external` は **`"外部ベンダーのモデルを指定した定義も含めて選んでよい"`**。
- **`"外部ベンダーのモデルを指定した定義は委譲先にしない"` は `SCOPE_LINES` に存在しない。** それは共通規律の新設 7(設計書 §7.5)の文面である。取り違えると必ず落ちる。
- 候補範囲の行は **`- ` で始めない**。`markerTable()` の**冒頭行(L208)は変えない**。

### 5.3 `markerTable()` の呼び出し 9 箇所(T3 が全部を追随させる。7 ファイル)

| # | ファイル | 行 | T3 で渡す値 | 後で変えるタスク |
| ---: | --- | ---: | --- | --- |
| 1 | `src/hooks/session-start.ts` | 129 | `"with-external"` | — (T4 が `successBlocks` として維持し、`claudeBlocks` を別に足す) |
| 2 | `src/hooks/subagent-start.ts` | 299 | `"with-external"` | T5(`tableFor()` へ移す) |
| 3 | `src/hooks/delegation-gate.ts` | 322 | `"with-external"` | **T6**(`candidateScopeFor ?? "claude-only"` へ) |
| 4 | `src/hooks/__test__/subagent-start.test.ts` | 249 | `"with-external"` | T5(ケース改題) |
| 5 | 同 | 433 | `"with-external"` | — |
| 6 | 同 | 468 | `"with-external"` | T5(ケース削除) |
| 7 | `src/hooks/__test__/marker-scan.test.ts` | 359 | `"with-external"` | — (**L390-396 の期待値へ scope 行を追加**) |
| 8 | 同 | 417 | `"with-external"` | — |
| 9 | `src/hooks/__test__/delegation-gate.test.ts` | 390 | `"with-external"` | **T6**(env から導いた scope へ) |

`plugins/agent-policy/scripts/*.mjs` はビルド成果物であり、手で編集しない。数にも入れない。

### 5.4 `skills/setup-agents/SKILL.md` の bash フェンスとコマンド(T11 / T15 / Done #18 が共有)

同ファイルの ` ```bash ` フェンスは **17 本**、CLI コマンド行は **18 本**である(L259-262 のフェンスだけが 2 コマンドを持つ)。**コマンド単位**で判定する。以下は実測(フェンスの開始行と終了行、直前の見出し、コマンド行)に基づく。

| # | フェンス開始行 | コマンド行 | 節 | コマンドの要点 | `--scope` |
| ---: | ---: | ---: | --- | --- | --- |
| 1 | 18 | 19 | 書き込みと対話の規律 | `... --dir "$PWD"`(引数を省略した書式の例示) | 不要(実行しない例示) |
| 2 | 43 | 44 | 非対話モード 手順 1 | `--list-live-models` | **要**(`claude` なら実行自体を省く) |
| 3 | 49 | 50 | 非対話モード 手順 2 | `--check-fragments` | 不要 |
| 4 | 55 | 56 | 非対話モード 手順 3 | `--write --merge --models gpt-sol,…,opus` | **要**(`claude` では `--models haiku,sonnet,fable,opus`) |
| 5 | 73 | 74 | ステップ 1 | `--list-live-models` | **要**(同上) |
| 6 | 86 | 87 | ステップ 1b | `--list-coverage` | **要** |
| 7 | 115 | 116 | ステップ 2 | `--check-fragments` | 不要 |
| 8 | 121 | 122 | ステップ 2 | `--scaffold-fragments` | 不要 |
| 9 | 158 | 159 | ステップ 5 | `--check --models` | **要** |
| 10 | 184 | 185 | ステップ 5b | `--list-roles --model-id` | 不要(**設計書 §7.15 は scope を通す関数として `listAvailableRoles` を挙げていない**) |
| 11 | 207 | 208 | ステップ 5b | `--check --model-id … --model … --roles …` | **要** |
| 12 | 228 | 229 | ステップ 5c | `--list-mcp` | 不要 |
| 13 | 253 | 254 | ステップ 6 | `--write --merge --models` | **要** |
| 14 | 259 | 260 | ステップ 6 | `--write --merge --models … --mcp-servers … --mcp-deny …` | **要** |
| 15 | 259 | 261 | ステップ 6 | `--write --merge --models <model-id-without-mcp,...>` | **要** |
| 16 | 266 | 267 | ステップ 6 | `--write [--merge] --model-id …` | **要** |
| 17 | 276 | 277 | ステップ 6b | `--list-coverage` | **要** |
| 18 | 294 | 295 | ステップ 6b | `--write --model-id …` | **要** |

**「要」は 12 コマンド(11 フェンス)、「不要」は 6 コマンド(6 フェンス)。** フェンス 259 は 2 コマンドを持ち、両方が「要」である。

**T11 の完了条件(行番号に依存しない機械検査)。** 編集で行番号がずれるため、コマンドの内容で判定する。

```bash
grep -n 'setup-agents\.mjs' plugins/agent-policy/skills/setup-agents/SKILL.md \
  | grep -E -- '--list-live-models|--list-coverage|--check |--write ' \
  | grep -v -- '--scope'
```

**この出力が空(0 行)であること。** 出力があれば、そのコマンドに `--scope` が足りていない。`grep` の終了コードではなく行数で判定する。`--list-roles`(#10)は `--check` / `--write` を含まないためこの検査に掛からない。

### 5.5 T15 の検査コマンド表(B-3。ゼロ件条件を実行時参照に限定する)

| # | 検査 | コマンド | 期待 |
| ---: | --- | --- | --- |
| 1 | 実行用ソースに旧断片への参照が無い | `grep -rn "subagent-discipline" plugins/agent-policy/src/ plugins/agent-policy/hooks/ \| wc -l` | **0** |
| 2 | 再生成済みバンドルにも無い | `grep -rn "subagent-discipline" plugins/agent-policy/scripts/ \| wc -l` | **0** |
| 3 | 断片ファイルが存在しない | `ls plugins/agent-policy/references/subagent-discipline.md` | **存在しない**(コマンドは失敗する) |
| 4 | README に**現在形で配布を案内する記述**が残っていない | `grep -n "サブエージェント向けの規律" plugins/agent-policy/README.md README.md` | **移行項目 5 の 1 行だけ**。L13 / L150 / L236 に無い。**ゼロ件は期待しない**(移行説明は必須である) |
| 5 | 指示書に旧節への参照が無い | `grep -rn "実行役割の解決順" plugins/agent-policy/references/ plugins/agent-policy/skills/ \| wc -l` | **0** |
| 6 | README の移行節にだけ旧節名が残る | `grep -n "実行役割の解決順" plugins/agent-policy/README.md` | 0.17 移行項目 5 と 0.18 移行項目の**説明文だけ** |
| 7 | `§役割` への参照が無い | `grep -rn "§役割" plugins/agent-policy/ --include=*.md --include=*.ts \| grep -v "/scripts/" \| wc -l` | **0** |
| 8 | `markerTable(` がすべて 3 引数 | `grep -rn "markerTable(" plugins/agent-policy/src/ \| wc -l` の各行を目視 | 定義 1 + 呼び出し 9 |
| 9 | `--scope` の追随 | §5.4 の一行検査 | **出力 0 行** |
| 10 | 「ビルトイン `Explore` を第一候補にする」記述が無い | `grep -rn "ビルトイン .Explore." plugins/agent-policy/skills/ plugins/agent-policy/references/ \| wc -l` | **0**(README の移行節は**対象外**。C-4) |

**#4 と #6 は「ゼロ件」を期待しない。** 設計書 §7.17 の 0.18 移行項目 5 は「SubagentStart フックが配布していたサブエージェント向けの規律断片(`references/subagent-discipline.md`)を廃止しました。」であり、**両方の文字列を含む**。移行説明は必須であり、削らせてはならない。検査は「現在形の配布案内が残っていないこと」を行番号で確かめる形にする。

### 5.6 T18 の実機検証手順(C-6)

**証拠を残す。** 各セッションについて次を記録する。読み込んだプラグインのパス(`CLAUDE_PLUGIN_ROOT`)、`plugin.json` の `version` が `0.18.0-dev` であること、`AMATSUKA_AGENT_AUTO_INJECTION` の値、実行日時。**改修版を検証したことが後から判別できない記録は無効とする。**

| # | 検証 | 手順 | 合格条件 |
| ---: | --- | --- | --- |
| (a) | claude 構成の対応表 | `AMATSUKA_AGENT_AUTO_INJECTION=claude` で新しいセッションを開く | 対応表が注入され、載っているのが §5.8 の 4 定義 / 5 役割だけである。7 つの外部定義が載っていない。2 行目が `claude-only` の候補範囲を示す |
| (b) | SubagentStart の注入内容 | **deny-list に掛からない起動先**へ dispatch する(`tools` に `Agent` を含む定義。ビルトイン `Explore` / `Plan` は注入されないので使わない)。子に「SubagentStart で注入された内容」を復唱させる | 対応表だけが届き、規律断片の文言(`あなたはサブエージェントである` / `依頼文で指定されたスキルだけをロードする`)が無い |
| (c) | `hooks.json` 変更後の発火 | (b) と同じセッションで、フックが実際に発火したことを確認する(`AMATSUKA_AGENT_SUBSTART_DEBUG=1` の stderr でも可) | SubagentStart が発火している |
| (d) | 転記の到達 | 依頼文へ「サブエージェントは〜」9 条項を転記して dispatch し、子に**依頼文で受け取った条項**を復唱させる | 9 条項が届いている。**(b) のフック注入内容と区別して報告させる**(どちらの経路で届いたかを子に明示させる) |

**実行手段が使えない場合は、ユニットテストや復唱結果で代替完了にしない。** 該当する Done を「未検証」として返し、オーケストレーターが判断する。

### 5.7 T20 の保護パス更新手順(C-5)

1. **Serena の memory を列挙する。** `list_memories` を実行し、実在する名前を確認する。**推測で名前を作らない。**
2. **本改修と食い違う記述を持つのは `agent_policy/core.md` である。** 実測で次の 3 箇所が該当する。
   - L122「SubagentStart | — | always distributes the discipline fragment; the marker table **only under custom-family injection**」
   - L141-144「All present → inject `custom-policy` + the marker table … **The marker table is not injected on fallback.**」
   - 同節の見出し「SessionStart's custom validation」以下の手順 3
3. `write_memory` または `edit_memory` で更新する。**直接ファイルを編集しない**(保護パス)。
4. `/home/hiro0209/.claude/projects/.../memory/` にある**自動メモリ**(`agents-with-codex-policy` / `agent-policy-context-map-sharing-backlog` など)は Serena の memory ではない。**Serena memory として新設しない。**
5. ARCHITECTURE への影響を確認し、必要なら `/metatron:update` で追随させる。**直接編集しない**(保護パス)。
6. **必要なツールが使えないときは、直接編集へ逃げず Done #31(および #30)を未完了として返す。**

### 5.8 このリポジトリの 11 定義と claude 構成の期待表(T18 が突き合わせる)

claude 構成の対応表に載るのは **4 定義 / 5 役割**である。

| 載る定義 | model | vendor | 役割 |
| --- | --- | --- | --- |
| `code-reviewer` | `sonnet` | `claude` | コードレビュー |
| `fable-adviser` | `fable` | `claude` | 設計・計画・実装のアドバイザー |
| `haiku-reviewer` | `haiku` | `claude` | 設計書・実装計画書のレビュー |
| `system-planner` | `opus` | `claude` | 設計書・実装計画書(WBS)の作成 / コードベース探索統括 |

載らないのは `astra-complex-reviewer` / `astra-tech-leader` / `gpt-luna` / `gpt-sol-lead-implementer` / `gpt-terra-explorer` / `grok-docs-reviewer` / `grok-researcher` の 7 定義である。

### 5.9 「サブエージェントは〜」条項は 9 つ / バージョン

新設 3〜6 の 4 条項 + 既存 L55-L59 の 5 条項。新設 1・2・7 はオーケストレーター向けなので数に入らない。実測サイズは既存 5 条項が 985 B、新設 4 条項が 943 B で**合計約 1,928 B**。バージョンは `0.17.1-dev` → **`0.18.0-dev`**(`plugin.json` と `package.json` の両方)。

## 6. 想定される失敗と対策

**依頼文の生成規則(§1)に従い、該当タスクの行を必ず転記する。**

| # | 対象 | 想定される失敗 | 対策 |
| --- | --- | --- | --- |
| 1 | T1 | 見出しの正規表現だけを直し、区切り行パーサを直さない。「8 failed が 8 failed のまま」になり、原因を見出しの書き方に求めて担当表を書き換えようとする | 「(a) と (b) の**両方**を直さないと緑にならない」と明記する。担当表の整形はユーザーの未コミット差分であり **revert してはならない** |
| 2 | T3 | `markerTable` の署名だけ変えて呼び出しの追随を次のタスクへ回す。typecheck が T6 まで赤のままになる | §5.3 の 9 箇所の表を転記し、「このタスクの完了条件は `pnpm run typecheck` がエラー 0」と書く |
| 3 | T3 | `marker-scan.test.ts` L390-396 の**完全一致**アサーションを見落とす。第 3 引数を渡しただけでは実行時に落ちる | 「アサーションの書き換えが要る 2 箇所」を明記する |
| 4 | T3 | `subagent-start.test.ts` L446 の `slice(1)` を見落とす。`toEqual`(L456-458)が左右でずれ、エラーが配列の差分なので原因を役割行の並びに求めやすい | 「scope 行が 2 行目に入るため役割行の起点が 1 つずれる」と理由まで書く |
| 5 | T3 | 振る舞いを変えてしまう。プロファイル判定をここで入れるとフェーズ 3 のテストが二重に変わる | 「本番 3 箇所にはいずれも `"with-external"` を渡す。プロファイル判定は入れない」と書く |
| 6 | T5 | 断片を先に削除する。テストの整理より前に消すと、差し替え前の期待値が「ファイルが無い」経路で偶然通る | 順序(テスト → 実装 → 削除)と、その理由を明記する |
| 7 | T5 | `import path` まで消す。`fs` は `readFragment` の 1 箇所だけだが、`path` は `bundledAgentsDir()`(L275)が使う | 「`import path from "node:path"` は残す」を独立した項目として書く |
| 8 | T4 | `claudeBlocks` に `unknownRoleBlock` を入れ忘れる。現行は `successBlocks` にしかないため写経すると落ちる | §7.11 の変更 3 のコードをそのまま転記する。「渡す配列は `candidateAgents` の**後**」も書く |
| 8b | T4 | 既存 L213-220 が落ちたのを退行と判断し、`unknownRoleBlock` を外して緑へ戻す | §2 フェーズ 3 の「T4 の既存テストの扱い」を全文転記する。**落ちるのは設計どおりであり、期待値を変える** |
| 8c | T4 | `successBlocks()` に第 3 引数を足そうとする。同関数は L122-126 で**既に** `legacyValue?: string` を持つ | 設計書 §7.11 変更 4 は**本体の差し替えだけ**である。署名は変えない |
| 9 | T7 | 既定の導出に `policyForInjection` を使う。旧 3 値と大文字混じりで CLI とフックが違う結論を出す | 設計書 §6.9 の食い違い表を転記し、「`candidateScopeFor` を使う」と明記する |
| 10 | T7 | `--model-id` 経路のフィルタを忘れる。`--models` 経路だけ直すと `--scope claude` で `--model-id gpt-sol` が通る | 「現行 L309-313 は `--models` 経路の外にある」と書き、テストで固定させる |
| 10b | T7 | 既存テストの棚卸しを飛ばし、`--scope` 無しのケースが落ちたのを新機能のバグと誤診する | §2 フェーズ 4 の棚卸し手順を全文転記する。**ヘルパー全体を custom 固定にしない** |
| 11 | T7 | `setup-agents.test.ts` の廃止フラグ拒否テストを不要に書き換える | §8 の食い違い 1 を転記する。**無変更で通る** |
| 12 | T8 | L60 を残したまま新設 2 を足す。主語の違う同内容の条項が並置される | 「L60 は削除する。新設 2 はその置き換えである」を独立した項目として書く |
| 12b | T8 | `## 委譲先の解決` を `## 担当表` の**見出しの直後**へ入れる。`extractRoleBandSection` が担当表を失い、T1 が直した 8 件が再失敗する | 「担当表**節**の直後(表本体と 4 つの補足箇条書きの後)、`## オーケストレーターが自ら担う作業` の前」と書く |
| 13 | T8 / T9 / T10 / T11 | `prompt-smith` の評価工程を回し、設計書が決めた文面を書き換える | 「評価工程は行わない。適用するのは書き方の基準だけ」と書く。設計書の「変更後」ブロックを全文転記する |
| 14 | T11 | frontmatter の `description` も直す。T13 と競合する | 「frontmatter は触らない」と明記する |
| 15 | T11 | フェンスの追随を「以後の全 CLI へ渡す」の一文で済ませ、L277 / L295 が漏れる | §5.4 の 18 コマンドの表と一行検査を転記する |
| 15b | T11 | ステップ 7 の報告(設計書 §7.14 **変更 8**)を転記されず、文面を創作する | 転記対象は「変更 2〜**8**」である。変更 8 の全文(claude での案内、`none` 時の追記文例の出し分け)を渡す |
| 16 | T12 | `hooks.json` の `hooks` 配列を触る。全セッションの挙動が変わる | 「`description` の 1 行だけ。`hooks` 配列は変更しない」と書く。T19 が `git diff` で確認する |
| 16b | T12 | 検証を緑にするために移行項目 5 の説明を削る | §5.5 の #4 を転記する。**移行説明は必須であり、ゼロ件を期待していない** |
| 17 | T14 | `scripts/` を手で編集する。バンドル出力である | 「`pnpm run build` で再生成する。手で編集しない」と書く |
| 17b | T14 | ルートの `package.json` や `.claude-plugin/marketplace.json` のバージョンを触る | 対象 2 ファイルを**絶対パス**で渡す |
| 17c | T14 | `pnpm -r build` が他プラグインの生成物も作り直すことに気づかず、差分をプラグイン内だけで確認する | 実行後に `git status --short` を**リポジトリ全体**で取らせる |
| 18 | T17 | custom フォールバック時の親子の乖離を「bug」と判断して直す提案をする(設計書 §10 リスク 4) | **既知の受容である。**「SubagentStart が injection 値しか見ないことは設計どおり。直す提案をしない」と書く |
| 19 | T17 | `none` 構成で規律が届かなくなることを退行と判断する(設計書 §10 リスク 12) | **意図的な縮退である。**同様の注記を入れる |
| 19b | T17 | レビューの観点が曖昧で、指摘が網羅されない | 検証基準を具体化する。(1) 命名が加算語彙か(`claudeRunnable` のような減算語が無い)。(2) フックが例外を握りつぶし exit 0 を返す経路が残っているか。(3) deny-list(`tools` に `Agent` が無い定義、`Explore` / `Plan`)の判定が変わっていないか。(4) `NO_MARKERS` の文字列が一字も変わっていないか。(5) `markerTable()` の冒頭行が変わっていないか |
| 20 | 全タスク | 本改修と無関係な未コミット差分を revert する | §0.3 を全タスクの依頼文へ転記する |
| 21 | T15 / T17 | ファイルを変更する。テストやビルドを実行する | 「ファイルを変更しない」「報告のみを返す」「テストの実行やビルドをしない」「この tools のみ使用」を明記する |
| 22 | T20 | サブエージェントへ委譲する。`write_memory` / `edit_memory` を持たないため失敗する | §2 フェーズ 8 と §5.7 に明記。オーケストレーター自身が行う |
| 23 | 検証全般 | `grep` のゼロ件期待を「終了コード 0」の要求へ変換し、実行エラーを成功と誤認する | §1 の「grep によるゼロ件検証の扱い」を転記する。`wc -l` の値で判定する |

## 7. Done 条件チェックリスト

| # | 条件 | 確認者 | 手段 |
| ---: | --- | --- | --- |
| 1 | `references/subagent-discipline.md` が存在しない | T15 / T19 | §5.5 の #3 |
| 2 | SubagentStart が custom 系で全定義、`claude` で候補だけ、それ以外で `NO_MARKERS` を返す | T5 / T19 | `subagent-start.test.ts` の新設ケース 1・2 と No. 12 / 22-26 |
| 3 | SubagentStart のスキップ条件が従前どおり働く | T5 | `subagent-start.test.ts` No. 1 / 5-7 / 9 が**無変更で**通る |
| 4 | SessionStart が `claude` 分岐と custom フォールバック 3 経路で `claude-only` の表を注入する。`none` / 未設定では出さない | T4 | `session-start.test.ts` の新設 10 ケース |
| 5 | 対応表の 2 行目が候補範囲を示し、切り詰めで落ちない。冒頭行の文面が変わっていない | T3 | `marker-scan.test.ts` の scope 行ケースと `subagent-start.test.ts` No. 37 |
| 6 | 2 行目の文面が §6.1 の候補条件と過不足なく一致 | T19 | §5.2 と実装の突き合わせ |
| 7 | claude 分岐と custom フォールバックで `unknownRoleBlock` が出る。渡す配列は `candidateAgents` の後 | T4 / T17 | `session-start.test.ts` の「候補内の未知 RoleId は通知される」「候補外は通知されない」の 2 ケース |
| 8 | `model: sonnet` + `vendor: gpt` が claude の表に載らない。`vendor` 未宣言は載る | T4 | `session-start.test.ts` の新設ケース |
| 9 | `markerTable()` の 9 箇所すべてが第 3 引数を渡している。L390-396 と L446 が書き換わっている | T15 | §5.5 の #8 と `pnpm run typecheck` |
| 10 | 共通規律に `## 委譲先の解決` があり、候補集合が順 1・順 2 の両方へ当たる。両 SKILL に `## 実行役割の解決順` が無い | T15 / T19 | §5.5 の #5 + 本文の読み合わせ |
| 11 | 「`readonly` の役割はビルトイン `Explore`」が第一候補として残っていない | T15 | §5.5 の #10(**README の移行節は対象外**) |
| 12 | 規律 L64 と L136 が「§委譲先の解決」を指す。旧 L60 が削除されている | T15 / T19 | §5.5 の #5 + 差分の確認 |
| 13 | 「サブエージェントは〜」で始まる条項が 9 つあり、連続したブロックになっている | T8 / T19 | `grep -c "^- サブエージェントは、"` が 9 + 目視 |
| 14 | 共通規律に新設 7(フォールバック時の転記)がある | T8 | grep |
| 15 | `--scope` が全経路へ伝わる。`--scope claude` で照会しない。`--model-id sonnet --model <外部値>` を拒否。claude の未カバー推奨が `ASSIGNMENTS` 由来 | T7 / T17 | `setup-agents.test.ts` の新設ケース。**非照会は模擬サーバーへの到達回数 0 で固定する** |
| 16 | `--scope` の既定が `candidateScopeFor` から導かれ、旧 3 値と大文字混じりでフックと同じ結論になる | T7 | `setup-agents.test.ts` の既定ケース(6 通り) |
| 17 | `--scope claude` で `--model-id gpt-sol` がエラーになる | T7 | `setup-agents.test.ts` の新設ケース |
| 18 | §5.4 の「要」12 コマンドすべてに `--scope` がある | T11 / T15 | §5.4 の一行検査(**出力 0 行**) |
| 19 | `description` から「custom プロファイル専用」が消えている | T13 | grep |
| 20 | `POLICIES` の label が「Claude のみ」で `policies.test.ts` が追随 | T2 | `policies.test.ts` |
| 21 | `pnpm run lint` / `typecheck` / `test` / `build` がすべて通る。**テストは 0 failed** | T16 | コマンド実行(HEAD と差分ハッシュを添える) |
| 22 | `git diff --stat plugins/agent-policy/scripts` に差分があり同じコミットに含まれる | T16 / T19 | コマンド + コミット前確認 |
| 23 | `plugin.json` と `package.json` の `version` がともに `0.18.0-dev` | T14 / T16 | grep(**絶対パスで対象を確定**) |
| 24 | `references/` の 2 本合計が 30,720 B 未満 | T16 | `wc -c`(§8 の実測欄へ記録) |
| 25 | プラグイン README とルート README が実体と一致し、移行説明が削られていない | T12 / T19 | §5.5 の #4 / #6 + 目視 |
| 26 | `hooks.json` 変更後、新しいセッションで SubagentStart が発火し対応表だけが注入される | T18 | §5.6 の (b)(c) |
| 27 | **リポジトリ全体**で、baseline に無い差分が本計画の変更一覧に収まる | T19 | `git status --short` / `git diff --stat` / 未追跡一覧を baseline と比較 |
| 28 | 実機の dispatch 検証で「サブエージェントは〜」条項が届いている | T18 | §5.6 の (d)(**フック注入と転記を区別して報告**) |
| 29 | `claude` セッションで対応表が注入され、外部ベンダーの定義が載っていない | T18 | §5.6 の (a)(§5.8 の期待表と突き合わせ) |
| 30 | ARCHITECTURE に影響する変更があれば `/metatron:update` で追随 | T20 | §5.7 の 5(**直接編集しない**) |
| 31 | `.serena/memories/agent_policy/core.md` の食い違い(L122 / L141-144)が更新されている | T20 | §5.7 の 1〜4(**ツールが使えなければ未完了として返す**) |

**コミットは許可されたパスだけを対象とする。** `git add` に `-A` や `.` を使わず、本計画の変更一覧にあるパスだけを明示的に指定する。既存の無関係な差分を含めない(B-8)。

## 8. 設計書との食い違い

| # | 箇所 | 設計書の記述 | 実測 | 扱い |
| ---: | --- | --- | --- | --- |
| 1 | §9.4 の `setup-agents.test.ts` | 「L274 の拒否テストが、メッセージ変更に追随する。期待するメッセージが `setup-agents is custom-profile only` を含むなら差し替える」 | 同テスト(L272-284)は `expect(result.error).toContain(flag)` と `expect(result.error).toMatch(/removed\|廃止/i)` しか見ない。新メッセージも両方を満たす | **条件が偽であり、差し替え不要。** 設計書の記述は条件付きなので矛盾ではない。T7 の依頼文へ「無変更で通る」と明記する |
| 2 | §9.3 の新設 8 ケース | `unknownRoleBlock` の挙動を固定するケースが無い | `unknownRoleBlock` は候補内の未知 RoleId を通知するため、既存 L213-220 の `not.toContain("hidden")` と `not.toContain("未知の役割 ID")` が落ちる | **設計書の変更は不要。** 計画側で既存 1 ケースの期待値変更と新設 2 ケースを足し、**新設は 10 ケース**とする(§2 フェーズ 3) |
| 3 | §7.15 の bash フェンス言及 | §7.14 のフェンス表は「12 本 / 要 8 本・不要 4 本」 | 実ファイルは **17 フェンス / 18 コマンド**。要は **12 コマンド(11 フェンス)**、不要は 6 コマンド | **設計書の表は節単位の粗い集計であり、計画側でコマンド単位へ展開した(§5.4)。** 設計判断は変わらない。T11 / T15 / Done #18 は §5.4 を出典とする |
| 4 | (追記欄) | | | |

### 実測値の記録(T16 の (7) で記入する)

| 対象 | 設計書 §9.5 の見積り | 実測 |
| --- | --- | --- |
| `references/orchestration-discipline.md` | 約 19,256 B(16,563 + 約 2,693) | (記入) |
| `references/context-map-guide.md` | 6,169 B(無変更) | (記入) |
| 2 本合計 | 約 25,425 B(上限 30,720 B) | (記入) |
| `references/subagent-discipline.md` | 削除(919 B) | (記入: 不在であること) |

## 9. 未解決事項

設計書 §12 の 13 項目は**すべて本改修の実装に影響しない**。同節の表が項目ごとに非影響の理由を持つ。実装担当は §12 を読まずに着手してよい。

この計画書の側で未決なものは無い。実装中に判断を要する事項が生じたときは、担当が決めずにオーケストレーターへ差し戻す。
