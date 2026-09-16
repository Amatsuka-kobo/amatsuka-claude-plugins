# agent-policy 役割 `doc-writing` とベンダー `gemini` の追加 実装計画書

- 作成日: 2026-09-16
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.18.0-dev` → `0.19.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md`
- 設計書のユーザー承認: **未取得**(承認後に着手する)
- context-map: `.claude/context-maps/2026-09-16-agent-policy-doc-writing-role.md`
- 着手時の HEAD: `f17f4c0`

この計画書はタスク分割・順序・検証方法だけを立てるものであり、設計判断を上書きしない。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §7「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

## 1. 進め方の共通規律

- テストを先に直してから実装する(フェーズ 1 → フェーズ 2)。フェーズ 1 の完了時点でテストは赤であり、それが期待値である。
- `plugins/agent-policy/scripts/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する。
- 委譲するタスクの依頼文には、対象ファイル・設計書の該当節・使用してよい tools・報告形式を転記する。設計書の「変更前」「変更後」のコードブロックをそのまま転記し、担当が文言を創作しないようにする。
- 指示書の改修(断片・規律・SKILL.md の本文)は `prompt-smith:prompt-smith` をロードした担当に行わせる。ただし**評価工程(既存指示書の評価 → 承認 → 修正)は省略させる**。適用する文言は設計書で確定済みである。依頼文に「評価工程は省略し、設計書の『変更後』をそのまま適用する。文言を創作しない」と書く。
- README・テストコード・`src/**/*.ts`・バージョン・生成物にはスキルをロードさせない。
- `Skill` tool を持たない役割へスキル付きタスクを割り当てない。`ROLES` 上で `Skill` を持たないのは「軽量な実装」「コードベース探索実働」「設計書・実装計画書のレビュー」「設計書の最終ゲートレビュー」「設計・計画・実装のアドバイザー」である。
- 同一フェーズ内のタスクは 1 メッセージで並列に dispatch する。フェーズ間は直列とする。
- 設計判断・要件の追加・スコープ拡大は担当が決めず、オーケストレーターへ差し戻す。
- 本改修と無関係な未コミット変更(会話記録・`.raphael/antibodies/` など)は触らない。revert もしない。

### 中間状態の許容範囲

| フェーズ | `pnpm run typecheck` | `pnpm run test` |
| --- | --- | --- |
| 1(テスト更新) | **失敗してよい** | 失敗してよい |
| 2 の T4 完了時 | **通る**(T4 が型の追加と、型が強制する追随をすべて含むため) | 失敗してよい(断片と `vendorFor` がまだ無い) |
| 2 の T5 完了時 | 通る | vendor 関連の検査が通る。断片の整合検査は T6 待ちで落ちてよい |
| 2(完了時) | 通る | 通る |
| 3 以降 | 通る | 通る |

フェーズ 1 で許容する型エラーは次の 4 種だけである。

1. `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` / `EXPECTED_AGENT_TOOL` の `Record<RoleId, …>` に未知のキー `"doc-writing"` を足したことによるもの。
2. `ModelId` に無いリテラル `"gemini-flash"` を `EXPECTED_RECOMMENDED` や `modelById` の検査で使ったことによるもの。
3. `discipline-role-table.test.ts` の `MODEL_IDS` の `satisfies Record<string, ModelId>` が `"gemini-flash"` で成立しないもの。
4. `ComposeInput.vendor`(= `Vendor`)に無い `"gemini"` を `compose.test.ts` で渡したことによるもの。

これら以外の型エラーが出たら、テストの書き方を疑う。

フェーズ 2 では、断片(ja/en の `doc-writing.md`)が無い状態で `roles.ts` を変えると `compose.test.ts` の断片整合検査が落ちる。フェーズ 2 の完了までは全体 green を判定しない。

## 2. タスク分割

### フェーズ 1: テストの更新(並列 3)

3 タスクの対象ファイルは重ならない。

| ID | 内容 | 対象 | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T1 | 役割数 16 → 17 を固定する検査と、`policies.test.ts` のモデル追加分を更新する。設計書 §7.1 の `roles.test.ts` 5 箇所、`fragments.test.ts` 2 箇所、`policies.test.ts` 7 箇所と、**設計書 §7.2 の `policies.test.ts` 分**(`toHaveLength(9)` → `10`、`MODELS.map((m) => m.id)` の全 10 件の順序検査と `modelById("gemini-flash")` の値検査の新設。`MODELS.at(7)` / `at(8)` の既存アサーションは変更しない)、**設計書 §7.2b の `policies.test.ts` 分**(`EXPECTED_AGENT_TOOL` の `light-impl` を `true` へ、`:206-215` / `:217-225` / `:243-246` から `allowsAgentTool` の第 2 引数を落とす、`:232-235` の it「モデル側の除外を適用する」を削除、`:237-241` の GPT Luna の it を削除または役割だけの検査へ縮約)。`EXPECTED_RECOMMENDED` の `doc-writing` は **`["sonnet", "gemini-flash", "gpt-terra"]`** である。`roles.test.ts` には `doc-writing` の label / kind / tools を固定する検査を、既存の「追加した 2 役割の…」の it に倣って足す。`policies.test.ts` の `rolesFor("sonnet")` は 8 件・設計書 §7.1 の並びにする | `src/agents/__test__/roles.test.ts` / `fragments.test.ts` / `policies.test.ts` | 通常の実装 | 不要 |
| T2 | ModelId / Vendor の追加と Agent Tool の規定変更に伴う検査を更新する。設計書 §7.2 のうち `compose.test.ts` の色と vendor marker、`discipline-role-table.test.ts` の `MODEL_IDS`、`live-models.test.ts`(`owned_by: "antigravity"` → `gemini`。**`google` は `unknown` のままであり、`google` の検査を足さない**)。**加えて §7.2b の `compose.test.ts` 分**(`:140-155` の Agent 付与を役割だけで決まる形へ、`:157-167` の `light-impl` を反転、`:169-173` の Haiku 除外の it を削除、**`:237-239` のアドバイザー節の検査を `light-impl` から Agent 否の役割(`code-review`)へ差し替え**、`:241` / `:247` / `:253-257` の `_common.md` 文言検査を改訂後の文言へ) | `src/agents/__test__/compose.test.ts` / `discipline-role-table.test.ts` / `live-models.test.ts` | 通常の実装 | 不要 |
| T3 | `setup-agents.test.ts` を更新する。設計書 §7.1 の `:543` / `:610` / `:737-754`、§7.2 の `:129` / `:1778-1783` / `:1915`、**§7.2b の `:966-986`(it「Agent tool の可否を役割から返す」の `light-impl` = `false` を Agent 否の役割へ差し替え)、`:988-1015`(`agentToolFor` を役割だけで決まる形へ。`light-impl` を `true`。テスト名も直す)、`:1016-`(モデル制約が消えるため、テスト名を直すか削除するかを判断する)** | `src/__test__/setup-agents.test.ts` | 通常の実装 | 不要 |

- **`policies.test.ts` の全変更は T1 に寄せた**(§7.1 分と §7.2 分の両方)。T2 の対象から外してあるため、3 タスクは同一ファイルを触らず並列でよい。この付け替えを T1 / T2 の依頼文へ明記する。
- 3 タスクの依頼文には、§1 の中間状態表と「フェーズ 1 で許容する型エラー 4 種」を転記し、「typecheck と test は赤でよい。`src/**/*.ts` を触らない」と明記する。
- フェーズ 1 の完了条件: 3 タスクの変更が設計書 §7 と一致し、`pnpm run lint` が通ること。typecheck と test は赤でよい。

### フェーズ 2: 実装(並列 4)

| ID | 内容 | 対象 | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T4 | **型の追加と、型が強制する追随をすべて足す。** `roles.ts` の `RoleId` と `ROLES`(設計書 §5.1)、`policies.ts` の `ModelId` / `MODELS` / `ASSIGNMENTS` / `RECOMMENDED` / `SOLO_DENIED_ROLES` / `AGENT_DENIED_MODELS` の削除 / `allowsAgentTool` のシグネチャ(§5.2)、`fragments.ts` の `Vendor`(§5.3)、`compose.ts` の `COLORS` の 1 行と `allowsAgentTool` の呼び出し 2 箇所(§5.4)、`setup-agents.ts` の `VENDOR_COLORS` の 1 行(§5.6 のうち色だけ)、**`references/orchestration-discipline.md` の担当表の `light-impl` の Agent Tool 列を `否` → `可` にする 1 セル**(§5.12-2)。`SOLO_DENIED_ROLES` は **`light-impl` を削除し `doc-writing` を末尾へ足す**。`RECOMMENDED["doc-writing"]` は **`["sonnet", "gemini-flash", "gpt-terra"]`**。**`setup-agents.ts` は `VENDOR_COLORS` だけを触り、`--vendor` の検証と推定失敗の文言には手を付けない**(T5 の担当) | `src/agents/roles.ts` / `policies.ts` / `fragments.ts` / `compose.ts` / `src/setup-agents.ts`(`VENDOR_COLORS` のみ)/ `references/orchestration-discipline.md`(担当表の `light-impl` の 1 セルのみ) | 複雑または重要な実装 | 不要 |
| T5 | 型が強制しない追随。`live-models.ts` の全変更(`LiveVendor` の新設、`Vendor` の import、ローカル `type Vendor` の削除、`vendorFor` の戻り値型と `antigravity` の case。設計書 §5.5)、`setup-agents.ts` の `--vendor` 検証と推定失敗の文言(§5.6 の残り)。**`vendorFor` の case 追加は型が強制しないため、`antigravity` を必ず足す。`google` は足さない** | `src/agents/live-models.ts` / `src/setup-agents.ts`(`--vendor` 検証と文言のみ) | 通常の実装 | 不要 |
| T6 | 役割断片を作る。`assets/roles/ja/doc-writing.md` と `assets/roles/en/doc-writing.md` を設計書 §5.7 / §5.8 の全文で新規作成する。**ja と en を必ず対で作る**。frontmatter の `default-name` / `tools` / `kind` は ja と en で完全一致させる | `assets/roles/{ja,en}/doc-writing.md`(新規 2 件) | 通常の実装 | `prompt-smith:prompt-smith` |
| T7 | 既存断片を追随させる。`general.md`(ja: §5.9 / en: §5.10)の 3 行ずつ、`design-plan.md` と `explore-lead.md`(ja/en 計 4 件)へ文体の 1 行(§5.11) | `assets/roles/{ja,en}/general.md` / `design-plan.md` / `explore-lead.md`(6 件) | 通常の実装 | `prompt-smith:prompt-smith` |
| T7b | **`_common.md`(ja/en)の Agent tool の節を改訂する(設計書 §5.11b / §5.11c)。** 変更後の全文は設計書にある。**節の見出し(`## Agent tool の制約` / `## Agent tool limits`)は 1 文字も変えない**(`vocabulary.ts` の `agentConstraintHeading` と一致している必要がある)。他の節は変更しない | `assets/roles/{ja,en}/_common.md` | 通常の実装 | `prompt-smith:prompt-smith` |

- **T4 を先に完了させ、その後 T5 / T6 / T7 を 3 並列で出す。** T4 は 3 つの型の追加と、型が強制する追随(`Record<RoleId, …>` 2 つ、`Record<Vendor, string>` 2 つ)をすべて含む。T5 は型が強制しない追随だけになる。
- **T4 の完了条件は `pnpm run typecheck` のパスである。** `test` は未追随分(断片の整合検査、`vendorFor` の検査)が落ちてよい。
  - この分割の根拠。`MODELS` に `vendor: "gemini"` を書く時点で `fragments.ts` の `Vendor` が要るため、`Vendor` の追加を T5 へ回しても T4 だけでは typecheck が通らない。`Vendor` を足せば `compose.ts` の `COLORS` と `setup-agents.ts` の `VENDOR_COLORS` の `Record<Vendor, string>` がキー不足になる。**型が強制する範囲は分割できない**ので、その全体を T4 が持つ。
- **担当表の `light-impl` の 1 セルだけを T4 へ前倒しする。** `discipline-role-table.test.ts` L181-184 が担当表の Agent Tool 列と `allowsAgentTool` の一致を検査するため、`SOLO_DENIED_ROLES` から `light-impl` を外した時点で表も直さないとこの検査が落ちる。T4 の依頼文には「`references/orchestration-discipline.md` は担当表の `light-impl` の行の Agent Tool 列の 1 セルだけを触る。行の追加と条項の追加は T8 の担当である」と明記する。残りの担当表の変更(行追加・D1 条項)は T8 のままフェーズ 3 に置く。
- **T5 の完了条件は `pnpm run typecheck` のパスと、`live-models.test.ts` / `setup-agents.test.ts` の vendor 関連の検査のパスである。** 断片の整合検査は T6 待ちであり、落ちてよい。
- T6 / T7 / T7b は対象ファイルが重ならず並列でよい。T7b の依頼文には設計書 §5.11b / §5.11c の変更前後の全文を転記し、「節の見出しを変えない」「**en 断片に日本語を書かない**(`compose.test.ts:616` が英語出力への日本語と日本語約物の混入を弾く。§7-2)」を強調する。見出しを変えると `compose.ts` が節を見つけられず、Agent tool の制約が本文から消える。
- T6 の依頼文には設計書 §5.7 / §5.8 の Markdown 全文を転記する。「文言を創作しない」「**断片本文で `###` を使わない**(§4.12)」「ja と en を必ず対で作る」を明記する。
- T7 の依頼文には設計書 §5.9-5.11 の変更前後の対応表を転記し、次を明記する。「**`general` 断片は変更表に挙がった行だけを触る。着手前に ja / en の現況の文言を実際に読んで確認する。en の L13 を複製しない**」「表に無い行は変更しない」。
- フェーズ 2 の完了条件: `pnpm run lint` / `pnpm run typecheck` が通り、`pnpm run test` が全体 green になる。

### フェーズ 3: 規律と文書(並列 4)

| ID | 内容 | 対象 | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T8 | 共通規律の 3 件(設計書 §5.12)。(a) 担当表の `design-plan` の行の直後へ `doc-writing` の行を挿入し、列の幅を既存の桁揃えに合わせる。(b) 「サブエージェントは〜」の条項の並びへ D1 の 1 項を足す(位置は「サブエージェントは、アドバイザーとして相談する相手を…」の直前)。(c) **§オーケストレーターが自ら担う作業 の末尾(分析の 3 項目の直後)へ F1 の 3 項を足す**(設計書 §5.12-4 の全文をそのまま使う)。**`light-impl` の Agent Tool 列は T4 が既に変更済みであり、触らない。L59 / L61-65 / L166 も変更しない。** **この 3 件以外は 1 文字も変更しない**(L72 / L75 / L115 は変更不要であることを設計書 §5.12 で確認済み) | `references/orchestration-discipline.md` | 通常の実装 | `prompt-smith:prompt-smith` |
| T9 | `skills/setup-agents/SKILL.md` の 6 箇所を設計書 §5.14 のとおり更新する。**frontmatter は変更しない** | `skills/setup-agents/SKILL.md` | 通常の実装 | `prompt-smith:prompt-smith` |
| T10 | プラグイン README の 4 件を設計書 §5.13 のとおり更新する。移行節の文面は設計書のコードブロック(**9 項**。D1 / D2 / F1 の 3 項を含む)をそのまま使い、「0.17 系から 0.18 系へ」の節の直前へ置く | `plugins/agent-policy/README.md` | 軽量な実装 | 不要 |
| T11 | ルート README の **L112**(「全16種」→「全17種」)と **L114**(「GPT と Grok をサポート」→「GPT・Grok・Gemini をサポート」)を設計書 §5.15 のとおり更新する。他の行は変更しない。`.claude-plugin/marketplace.json` は変更しない | `README.md` | 軽量な実装 | 不要 |

- T8 の検証: `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts` が通ること。
- T10 / T11 は README であり `prompt-smith` の対象外である。
- 「軽量な実装」へ dispatch する依頼文には「Agent tool を使わない」と明記する(担当表の Agent Tool 列が「否」のため)。
- フェーズ 3 の完了条件: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。

### フェーズ 4: バージョンと build(直列 1)

| ID | 内容 | 対象 | 担当役割 | スキル |
| --- | --- | --- | --- | --- |
| T12 | `plugin.json` と `package.json` の `version` を `0.19.0-dev` へ揃える(設計書 §5.16)。その後 `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分を確認する。**差分が出るのが期待値である**(`src/` の実行される行を変えたため)。差分の内容が今回の変更に対応していることを確認して報告する | `.claude-plugin/plugin.json` / `package.json` / `scripts/`(生成物) | 軽量な実装 | 不要 |

- T12 の検証: 2 ファイルの `version` がともに `0.19.0-dev`。`git diff --stat plugins/agent-policy/scripts` に差分があり、`grep -c 'gemini' plugins/agent-policy/scripts/setup-agents.mjs` が 1 件以上であること。
- フェーズ 4 の完了条件: build 後に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。

### フェーズ 5: 検証(T13・T14・T15 は並列 3、その後 T16 → T17 → T18 は直列)

| ID | 内容 | 担当役割 | スキル |
| --- | --- | --- | --- |
| T13 | **統合検証(機械コマンドの実行と記録に限る)。** 次を順に実行し、出力を記録する。(1) `pnpm run build` (2) `pnpm run lint` (3) `pnpm run typecheck` (4) `pnpm run test` — baseline からのテスト数の増減が今回の追加分だけであること (5) `git status --short` と `git diff` の両方を見て、新規ファイル(断片 2 件)が untracked として存在することを確認する (6) `node plugins/agent-policy/scripts/setup-agents.mjs --list-roles --lang ja --dir "$PWD"` で 17 役割が定義順に出ること (7) `node plugins/agent-policy/scripts/setup-agents.mjs --list-coverage --scope custom --dir "$PWD"` で `doc-writing` の `models` が `["sonnet","gemini-flash"]` になり、`uncovered` に `doc-writing` が入ること | オーケストレーター | 不要 |
| T14 | 変更差分のコードレビュー。次を必ず見る。(1) **`vendorFor` の switch に `antigravity` の case があり `gemini` を返すこと**(型が強制しないため足し忘れうる。`google` の case は**無いこと**) (2) `LiveVendor` が `Exclude<Vendor, "none"> \| "unknown"` であり、`resolveVendor` の narrowing を壊していないこと (3) `SOLO_DENIED_ROLES` と担当表の Agent Tool 列が揃っていること (4) `MODELS` の末尾追加で `at(7)` / `at(8)` が無傷なこと (5) 断片の frontmatter が ja / en で一致していること (6) **`AGENT_DENIED_MODELS` が残っておらず、`allowsAgentTool` が `ids` だけを受けること** (7) **`_common.md` の節の見出しが `vocabulary.ts` の `agentConstraintHeading` と一致したままであること** (8) **T18 の再生成後、7 定義の `disallowedTools` が保持されていること**(`independent-tech-adviser.md` のプレフィックス無しの別名を含む) | コードレビュー | 不要 |
| T15 | ARCHITECTURE への影響確認。新規ファイル(断片 2 件、本設計書、本計画書)がドメインマップの glob に入ること、`harness-docs/ARCHITECTURE.md` が `agent-policy` の役割数やベンダーを名指ししていないことを確認する。取りこぼしがあれば**修正せず報告する**(追随は `/metatron:update` で行う) | コードベース探索実働 | 不要 |
| T16 | **オーケストレーターによる最終突き合わせ。** 全差分を分割せず一度に読み、設計書 §5.1-5.16 の「変更後」と一致することを確認する。特に (1) 役割 17 種の並びが `roles.ts` / 担当表 / README / `--list-roles` で同一であること (2) `doc-writing` の label が 4 箇所(`roles.ts` / ja 断片 / 担当表 / README)で「文書作成」に揃っていること (3) vendor 5 値が `fragments.ts` / `compose.ts` / `setup-agents.ts` の検証 / 推定失敗の文言 / SKILL.md の 7 箇所で揃っていること (4) `general` 断片から文書責務が消えていること (5) **Agent Tool の規定が `SOLO_DENIED_ROLES` / 担当表 / `EXPECTED_AGENT_TOOL` / 生成物の 4 箇所で揃っていること**(`light-impl` = 可、`doc-writing` = 否) (6) **D1 の規律が共通規律の条項と `_common.md`(ja/en)の 2 箇所にあり、文意が一致していること** (7) **D1 条項(サブエージェント向け)と F1 条項(オーケストレーター向け)が同じ文書範囲を指していること**(対象の列挙が同じ文言であること)。要約の要約では判断しない | オーケストレーター | 不要 |
| T17 | `.serena/memories/agent_policy/core.md` の更新(設計書 §5.17)。役割数 16 → 17、役割 ID の列挙、`RECOMMENDED` の値、`ModelId` / `Vendor` の集合、**Agent Tool の規定の変更(`light-impl` が「可」、モデルによる除外の廃止)、共通規律に加わった 2 種の条項(D1 / F1)**、バージョン `0.19.0-dev`、設計書の一覧への追加。**オーケストレーター自身が Serena の `edit_memory` / `write_memory` で行う。** サブエージェントはこれらの tool を持たないため委譲できない | オーケストレーター | 不要 |
| T18 | このリポジトリの `.claude/agents/` の再生成(設計書 §5.18)。`agent-policy:setup-agents` で `doc-writing` の定義を新設し(Sonnet / gemini-flash の 2 件。`gpt-terra` も推奨に入るため 3 件目を作るかはユーザーが決める。**`doc-writing` は単独の役割を持つ定義にする**)、既存 13 定義を再生成する。**再生成が 13 定義すべてに及ぶ主因は `_common.md` の Agent tool の節の改訂であり、次いで `general` の文言である。Agent tool の付与が実際に変わるのは `light-impl` を持つ `general-implementer.md` だけである。唯一の Haiku 定義 `knowledge-elicitationer.md` は `doc-review` のみを持つため Agent 否のまま変わらない。** **着手前に 13 定義の `disallowedTools` と MCP の付与を一覧化する。**7 定義が `disallowedTools` を持つ(`complex-reviewer` / `general-explore` / `docs-reviewer` / `code-reviewer` / `realtime-researcher` / `technical-adviser` / `independent-tech-adviser`)。ウィザードで同じ `--mcp-deny` を再指定し、`independent-tech-adviser.md` のプレフィックス無しの別名(`write_memory` 等)は手で復元する。ウィザードは対話であり、定義名・MCP・作る定義の選択はユーザーが決める。完了後 `--list-coverage` で未被覆が無いことと、**7 定義の `disallowedTools` が保持されていること**を確認する | オーケストレーター | `agent-policy:setup-agents` |

- T14 / T15 の依頼文には「ファイルを変更しない」「報告のみを返す」「使用してよい tools を読み取り系に限定する」を明記する。
- **T14 の項目 (8)(`disallowedTools` の保持)は T18 の後でなければ確認できない。** T14 は T18 に先行するため、この項目だけは後追いで確認する。**実施結果: オーケストレーターが T18 の完了後に自分で確認した(T14 の再 dispatch は行わなかった)。**

#### T18 の実施記録(2026-09-16)

- 新設は **`document-writer.md` の 1 件**のみ。`model` は `gemini-flash`、役割は `doc-writing` **単独**、MCP は serena、書き込み系の 11 ツールを `disallowedTools` で deny。
- 既存 13 定義は `--write --merge` で再生成し、MCP と deny を現状どおり再指定した。
- `independent-tech-adviser.md` の deny を、プレフィックス無しの別名から `mcp__serena__` 付きの表記へ統一した。
- `--list-coverage` の `uncovered` は空。deny を持つ定義は **8 件**(既存 7 + 新規 1)。
- `warnings` / `mcpDropped` / `keptNeedsReview` はいずれも空。
- `sonnet` と `gpt-terra` の `doc-writing` 定義は**作らなかった**(ユーザー判断)。`RECOMMENDED` には残るため、次回のウィザードでも候補として提示される。
- T16 で食い違いが見つかった場合は §7 へ記録し、該当フェーズのタスクをやり直す。
- **T17 は T12 の後**(バージョンが確定していないと書けない)。**T18 は T12 の後**(`scripts/` が再生成されていないと新役割を生成できない)。
- T18 はプラグインの改修ではなくこのリポジトリの構成変更である。別コミットに分ける(§5)。

## 3. 依存関係

```
T1 ─┐                ┌─ T5 ─┐
T2 ─┼─(F1完了)─ T4 ─┼─ T6 ─┤                ┌─ T8 ──┐
T3 ─┘                ├─ T7 ─┼─(F2完了)─────┼─ T9 ──┼─(F3完了)─ T12 ─┬─ T13 ─┐
                     └─ T7b ┘                ├─ T10 ─┤                 ├─ T14 ─┼─ T16 ─ T17 ─ T18
                                             └─ T11 ─┘                 └─ T15 ─┘
```

- T1 / T2 / T3(テスト)はすべての実装タスクに先行する。
- **T2 の対象から `policies.test.ts` を外し、T1 へ寄せる**(§2 のフェーズ 1 の注記)。同一ファイルへの並列書き込みを避けるためである。これで T1 / T2 / T3 は対象が重ならず並列でよい。
- **T4 は T5 に先行する(直列)。** 両者が `setup-agents.ts` を触るためである。T4 は `VENDOR_COLORS` の 1 行、T5 は `--vendor` の検証と推定失敗の文言を扱う。依頼文に触る箇所を明記し、並列に出さない。
- T6(新規断片)/ T7(既存断片)/ T7b(`_common.md`)は対象が重ならず並列でよい。ただし T4 が `ROLES` に `doc-writing` を足した後でないと `compose.test.ts` の断片整合検査の判定ができない。
- **T7b は T4 の後に置く。** `_common.md` の Agent tool の節は `withAgent` が真のときだけ出力されるため、`light-impl` が「可」になっていないと `compose.test.ts` の文言検査の判定がずれる。
- フェーズ 3 の 4 タスクは対象が重ならない。T8 だけがテストで検証される。
- T12 の `pnpm run build` はフェーズ 2 の `src/` 変更をすべて前提にする。
- T18 は T12 の後に置く。生成される定義の断片は `assets/roles/` から読まれるため、T6 の完了も前提になる。

## 4. タスク間で共有する契約

並列実装者が推測で決めないよう、次を依頼文へ転記する。

**役割の並び(17 件。`ROLES` の定義順)**

```
complex-impl, normal-impl, light-impl, escalation, general, design-plan,
doc-writing, explore-lead, explore, realtime-research, e2e-verify,
independent-review, doc-review, code-review, final-review, gate-review, advisor
```

**`doc-writing` の固定値**

| 項目 | 値 |
| --- | --- |
| label(ja) | `文書作成` |
| label(en) | `Document Authoring` |
| kind | `impl` |
| tools | `Read, Grep, Glob, Write, Edit, Bash, Skill` |
| default-name | `writer` |
| `ASSIGNMENTS["claude-model-policy"]` | `["sonnet"]` |
| `RECOMMENDED` | `["sonnet", "gemini-flash", "gpt-terra"]`(この順) |
| `SOLO_DENIED_ROLES` | 含む(配列の**末尾**へ追加。Agent Tool = 否) |
| 担当表の行 | `| 文書作成 | \`doc-writing\` | \`impl\` | 否 | \`Sonnet\` |` |

**Agent Tool の規定(追加要件 D2)**

| 項目 | 変更後 |
| --- | --- |
| `SOLO_DENIED_ROLES` | `["advisor", "doc-review", "code-review", "final-review", "gate-review", "doc-writing"]`(`light-impl` を削除) |
| `AGENT_DENIED_MODELS` | **削除する**(`grep -rn "AGENT_DENIED_MODELS" src` が 0 件になること) |
| `allowsAgentTool` | `allowsAgentTool(ids: RoleId[]): boolean`。`model` 引数を削除する |
| 呼び出し側 | `compose.ts` L44 と L127 の第 2 引数を落とす。`ComposeInput.modelId` は残し、「Agent の可否には使わない」とコメントを付ける |
| 担当表の `light-impl` | Agent Tool 列を `否` → `可`。**T4 が行う**(`discipline-role-table.test.ts` L181-184 が関数と表の一致を検査するため) |
| `EXPECTED_AGENT_TOOL` | `light-impl: true` / `doc-writing: false`。他は現行どおり |

**`gemini-flash` の固定値**

| 項目 | 値 |
| --- | --- |
| id | `gemini-flash` |
| vendor | `gemini` |
| label | `Gemini Flash` |
| defaultName | `gemini-flash` |
| model | `claude-gemini-3-8-flash` |
| color | `green` |
| `MODELS` の位置 | 末尾(添字 9) |

**`Vendor` の 5 値と並び**

```
gpt, grok, gemini, claude, none
```

`COLORS` / `VENDOR_COLORS` の値: `gpt:yellow / grok:red / gemini:green / claude:blue / none:blue`。
`--vendor` のエラー文言: `vendor: must be gpt, grok, gemini, claude or none`。
推定失敗の文言: `vendor: could not infer vendor for model "<model>"; pass --vendor gpt|grok|gemini|claude|none`。
`vendorFor` の写像: `openai → gpt` / `xai → grok` / `anthropic → claude` / `antigravity → gemini` / **それ以外 → `unknown`(`google` も `unknown` のままとする)**。
`LiveVendor` の定義: `Exclude<Vendor, "none"> | "unknown"`。

**`rolesFor("sonnet")` の期待値(8 件)**

```
normal-impl, general, doc-writing, explore, realtime-research,
e2e-verify, independent-review, code-review
```

並びは `ROLES` の定義順である(`sortRoleIds` が `roleOrder` で並べ替える)。`e2e-verify` が `independent-review` より前に来る。`rolesFor("fable")` は変わらない。

## 5. コミット分割案

**役割追加と gemini 追加は 1 コミットにまとめる(オーケストレーター決定 2026-09-16)。** 分割は不可能ではないが、相互依存が `RECOMMENDED["doc-writing"]` だけではないためである。`MODELS` の新エントリが `vendor: "gemini"` を持ち、テスト側でも `EXPECTED_RECOMMENDED` / `MODEL_IDS` の `satisfies` / `compose.test.ts` の vendor 配列が両方の変更に同時に依存する。分けるなら中間コミットで値を仮置きし、次のコミットで戻す作業が要る。得られるものに見合わない。

| # | 内容 | 含むタスク | メッセージ案 |
| --- | --- | --- | --- |
| 1 | 役割 `doc-writing`、ベンダー `gemini`、ModelId `gemini-flash`、Agent Tool の規定変更(D)の追加(テスト・実装・断片・`_common.md`・担当表・プラグイン README・SKILL.md) | T1-T11(T7b を含む) | `feat(agent-policy): 役割 doc-writing とベンダー gemini を追加する` |
| 2 | バージョンと生成物 | T12 | `chore(agent-policy): 0.19.0-dev` |
| 3 | ルート README と Serena メモリ | T11・T17 | `docs: agent-policy 0.19 に追随する` |

- T11(ルート README)はプラグイン外の追随であり、コミット 3 に寄せる。コミット 1 には含めない。
- コミット 2 は 1 の後に置く。`scripts/` は 1 の全変更を含むため分割できない。
- **T18(`.claude/agents/` の再生成)はコミットを伴わない。** `.claude/agents` は `.gitignore:14` で無視されており git 管理外である(§7-4)。当初案にあった 4 本目のコミットは成立しないため削除した。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| T1 と T2 が同じファイルを並列に書き換えて衝突する | `policies.test.ts` の全変更を T1 へ寄せた(§2 / §3)。依頼文に「このファイルのこの箇所だけ」と明記する |
| T4 と T5 が `setup-agents.ts` を並列に書き換えて衝突する | T4 → T5 を直列にした(§3)。T4 は `VENDOR_COLORS` の 1 行だけ、T5 は `--vendor` の検証と推定失敗の文言だけ、と依頼文に明記する |
| T4 の担当が typecheck の赤を残したまま完了報告する | T4 の完了条件を `pnpm run typecheck` のパスとした。型が強制する追随(`Record<Vendor, string>` 2 つ)を T4 の対象に入れてあるため、赤が残るのは変更漏れである |
| フェーズ 1 の担当が typecheck の赤を自分の失敗と受け取り、実装側へ手を出す | 依頼文に §1 の中間状態表と「許容する型エラー 4 種」を転記し、「typecheck と test は赤でよい。`src/**/*.ts` を触らない」と明記する |
| T5 が `vendorFor` に `antigravity` の case を足し忘れる。型が強制しないため typecheck は通ってしまう | T5 の依頼文に設計書 §4.7 / §5.5 を転記し、「case の追加は型が強制しない」と明記する。T2 が足す `live-models.test.ts` の検査が落ちる。T14 のレビュー項目の第 1 項でもある |
| T5 が `google` の case も足す(前版の設計書に載っていたため) | 設計書 §4.8 / §9 で不採用を明記した。§4 の共有契約にも「`google` も `unknown` のまま」と書いた。T14 で確認する |
| **T7b が `_common.md` の節の見出しを変え、`vocabulary.ts` の `agentConstraintHeading` と一致しなくなる。** 節が見つからず Agent tool の制約が本文から静かに消える | T7b の依頼文に「見出しを 1 文字も変えない」と明記する。`compose.test.ts` の文言検査(T2 が更新する 3 箇所)が落ちるため検出できる。T14 の項目にも入れた |
| **en 断片へ日本語を書き、`compose.test.ts:616` の英語出力の純度検査が落ちる** | 実装中に実際に起きた(§7-2)。日本語ラベルの併記は撤回済み。T7b の依頼文に「en 断片に日本語を書かない」と明記する |
| T1 が書く固定値の並びを、実コードや設計書と照らさずに書く | 実装中に実際に起きた(§7-1。`MODELS` の `gpt-terra` / `gpt-luna` の順)。T1 の依頼文へ §4 の共有契約と設計書 §3.1 を転記し、並びは実コードから写すよう明記する |
| T2 が `_common.md` の新しい文言を推測で書き、T7b の実文言と食い違う | 両タスクの依頼文へ設計書 §5.11b / §5.11c の変更後の全文を転記する。検査に使う語は「`Agent` tool を使うのは」とし、両者で同じ語を使う |
| T7 が `general` 断片の現況を確認せずに書き換え、en の L13 を複製する・変更表に無い行を触る | T7 の依頼文に「着手前に ja / en の現況を読む」「変更表の行だけを触る」「en の L13 を複製しない」を明記する |
| T6 が ja だけ作り en を忘れ、`compose.test.ts` が落ちる | T6 の完了条件に「ja と en の 2 ファイルが存在し、`default-name` / `tools` / `kind` が一致すること」を入れる |
| T6 が断片に `###` 見出しを入れ、合成時に他役割の箇条書きへ紛れる | 設計書 §4.12 を依頼文へ転記し、「`###` を使わない」と明記する |
| T7 が `general.md` の L13(定型メンテナンス)まで書き換える | 変更前後の対応表を転記し、「表に無い行は変更しない」と明記する |
| T5 が `live-models.ts` の型統合で `resolveVendor` の narrowing を壊す | 設計書 §4.7 / §5.5 を転記する。T14 のレビュー項目に入れている |
| `MODELS` を末尾以外へ挿し、`MODELS.at(7)` / `at(8)` が落ちる | §4 の共有契約に「末尾(添字 9)」と明記する |
| `SOLO_DENIED_ROLES` と担当表の Agent Tool 列がずれる | `discipline-role-table.test.ts` が `allowsAgentTool` と突き合わせるため、ずれるとテストが落ちる |
| `scripts/` を手で編集してしまう | T12 だけが `pnpm run build` を実行する。他タスクの依頼文に「`scripts/` を触らない」と書く |
| `.serena/memories/` を Edit / Write で触ってしまう | T17 はオーケストレーター自身が Serena の tool で行う。委譲しない |
| T18 のウィザードが対話であり、サブエージェントに任せると質問が飛ぶ | T18 はオーケストレーターが実行し、定義名と MCP の選択をユーザーへ確認する |
| `vendorFor` の `owned_by` が想定と違い、live 照会成功時に throw する | T13 の (7) で `--list-coverage` を実行し、プロキシ照会を通す。throw したら実測値を報告し、設計書 §4.8 の写像を見直す |
| コミット分割の判断をフェーズ 5 まで持ち越し、作業が止まる | §5 で 1 本化を確定済みである。分割案を蒸し返さない |
| T8 の担当が F1 の 3 項を置く位置を誤り、`## モデル別役割の運用` の並びへ入れてしまう | 設計書 §4.16 で位置(§オーケストレーターが自ら担う作業 の末尾、分析の 3 項目の直後)と根拠を確定した。T8 の依頼文へ転記する |
| F1 と D1 の対象の列挙がずれる | 両方の全文を T8 の依頼文へ転記し、「対象の列挙は同じ文言にする」と明記する。T16 の項目 (7) で確認する |
| T4 と T8 が `orchestration-discipline.md` を別フェーズで触り、片方が他方の変更を巻き戻す | T4 は担当表の `light-impl` の 1 セルだけ、T8 は行追加と条項追加だけ、と依頼文に明記する。T4 → T8 はフェーズが分かれており同時編集にはならない |
| **T18 の再生成で 7 定義の `disallowedTools` と MCP の付与が失われる** | T18 の着手前に一覧化し、ウィザードで同じ `--mcp-deny` を再指定する。`independent-tech-adviser.md` のプレフィックス無しの別名は手で復元する。完了確認に保持の検査を入れた。**実施結果: 保持を確認済み。同定義の別名は `mcp__serena__` 付きへ統一した**(§2 フェーズ 5 の T18 実施記録) |
| T18 で `doc-writing` を実装役割と兼ねた定義に入れてしまい、Agent Tool が「可」になる | T18 の記述に「`doc-writing` は単独の役割を持つ定義にする」と明記した(設計書 §5.18 / §8) |

## 7. 設計書との食い違い

計画立案時に検出した食い違いは無い。実装中に見つけた食い違いは、実装を止めてオーケストレーターへ報告し、この節へ次の形式で追記する。

| # | 検出タスク | 設計書の記述 | 実際 | 判断 |
| --- | --- | --- | --- | --- |
| 1 | T4 | 設計書 §3.1 と実コードの `MODELS` の並びは `gpt-sol, gpt-terra, gpt-luna, gpt-astra, grok` である | T1 が書いた `policies.test.ts` の `MODELS` 順序検査が `gpt-luna, gpt-terra` の順になっていた。**テスト側の誤記**であり、設計書と実コードは正しい | **テストを正本へ合わせる。** 設計書は変更しない。オーケストレーターが修正済み |
| 2 | T7b | 設計書 §5.11c が en 断片へ日本語ラベルを併記する(`文書作成 (Document Authoring)`)としていた | `compose.test.ts:616`「英語で合成した定義に日本語と日本語約物が混入しない」が落ちる | **既存テストを英語出力の品質契約として維持し、併記を撤回する。** en 断片は `"Document Authoring"` のみとする。設計書 §5.11c / §9 / §10-9 を訂正済み。対応表の照合の問題は既存の欠陥のままスコープ外(設計書 §10-9) |
| 3 | T14 | 設計書 §8 は「D1(§5.11b / §5.11c)と F1(§5.12-4)の対象の列挙を同じ文言で書く」としていた | D1 側が「…プロンプト・引継ぎ書)、…、その他の文書」、F1 側が「…プロンプト)、引継ぎ書と goal コマンドのプロンプト(…)、…、その他ファイルとして残す文書」で、文言も範囲も違っていた | **D1 側を F1 へ揃える。** ja / en とも設計書 §5.11b / §5.11c の列挙を差し替え済み。**パスの例示だけは F1 側にのみ残す**(オーケストレーター向けの具体化であり範囲は変えない)。この非対称を設計書 §8 のリスク欄へ明記した。実装はオーケストレーターが修正済み |
| 4 | T18 | 本計画書 §5 が T18 を 4 本目のコミット(`chore: doc-writing の Agent 定義を追加する`)として置いていた | `.claude/agents` は `.gitignore:14` で無視されており、git 管理外である。コミットできない | **コミット 4 を削除する。** §5 に「T18 はコミットを伴わない」と注記した。コミットは 3 本のままで、§8 の Done 条件「変更を §5 の方針で分けてコミットしている」は成立する |

計画立案時に実測で追認した記述(食い違いなし):

| 設計書 | 記述 | 実測 |
| --- | --- | --- |
| §3.1 | 現行バージョン `0.18.0-dev` | `plugin.json` L4 / `package.json` L3 とも `0.18.0-dev` |
| §3.1 | `SOLO_DENIED_ROLES` は非 export | `policies.ts` L174 は `const` |
| §3.1 | `MODELS` の末尾は `grok`(添字 8) | `policies.ts` L112-119 |
| §3.1 | 担当表は 5 列 16 行 | `orchestration-discipline.md` L7-24 |
| §4.6 | 規律 L115 は役割名を列挙せず担当表を参照する | 「担当表のうち「その他のタスク」を除く全役割とする」 |
| §4.12 | 断片は `## ` 単位で本文行を集める | `fragments.ts` L42-57 |
| §3.1 / §4.13 | `allowsAgentTool` の呼び出しは `compose.ts` の 2 箇所だけ | `grep -rn "allowsAgentTool" src` が `policies.ts` の定義と `compose.ts` L44 / L127、テスト 2 本のみ |
| §3.1 / §4.13 | `ComposeInput.modelId` の compose 内の用途は Agent 判定だけ | `grep -n "modelId" src/agents/compose.ts` が L15 / L44 / L127 の 3 件 |
| §3.1 / §4.14 | `## Agent tool の制約` 節は `withAgent` が真のときだけ出る | `compose.ts` L84 |
| §3.1 / §4.15 | SubagentStart はすべてのサブエージェントへ対応表を注入する | `subagent-start.ts` L218 / L254 |
| §7.2b | `_common.md` の本文を検査するのは `compose.test.ts` の 3 箇所だけ | `:241` / `:247` / `:253-257` |
| §7.2b | `light-impl` を前提にした検査が他に 2 件ある | `compose.test.ts:237-239`(アドバイザー節の不在)と `setup-agents.test.ts:966-986`(`agentTool: false`) |
| §5.18 / §8 | 既存 13 定義のうち 7 定義が `disallowedTools` を持つ | `grep -l disallowedTools .claude/agents/*.md` が 7 件。`independent-tech-adviser.md` だけプレフィックス無しの別名 |
| §5.18 | 唯一の Haiku 定義は `doc-review` のみを持ち Agent 否のまま | `grep -n "model: haiku" .claude/agents/*.md` が `knowledge-elicitationer.md` の 1 件 |
| §3.1 | `cliproxyapi.config.example.yaml` に Gemini の alias がある | L10-12 に `antigravity` / `claude-gemini-3-8-flash` |

## 8. Done 条件

設計書 §11 に本計画書で追加した項目を足したものである。

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る(T13)。
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が同じコミットに入っている(T12)。
- `plugin.json` と `package.json` がともに `0.19.0-dev` である(T12。T16 が追認)。
- `assets/roles/ja/doc-writing.md` と `en/doc-writing.md` が両方存在し、断片整合検査を通る(T6)。
- 担当表が 17 行になり、`light-impl` の Agent Tool が「可」で、D1 の「サブエージェントは〜」条項と F1 の 3 項があり、`discipline-role-table.test.ts` が通る(`light-impl` の列は T4、残りは T8)。
- D1 条項と F1 条項が同じ文書範囲を指している(T16)。
- `AGENT_DENIED_MODELS` が削除され、`allowsAgentTool` が `ids` だけを受ける(T4。T14 / T16 が追認)。
- `_common.md`(ja/en)の Agent tool の節が改訂され、見出しは変わっておらず、`compose.test.ts` の文言検査が通る(T7b / T2)。
- プラグイン README の役割表が 17 種、モデル表が 10 種、MCP 既定の列挙に `doc-writing` があり、移行節「0.18 系から 0.19 系へ」がある(T10。T16 が直接読んで追認)。
- `skills/setup-agents/SKILL.md` の vendor 列挙が 5 値、モデル列挙が 10 件、MCP 既定の列挙に `doc-writing` がある(T9)。
- ルート `README.md` が 17 種と Gemini に追随している(T11)。
- `--list-roles` が 17 役割を定義順で返し、`--list-coverage` が `doc-writing` を含む(T13)。
- ARCHITECTURE への影響の有無を確認した記録が残っている(T15)。
- オーケストレーターが全差分を一度に読んで設計書と突き合わせ、食い違いが無いことを確認している(T16)。
- `.serena/memories/agent_policy/core.md` が更新されている(T17)。
- このリポジトリの `.claude/agents/` に `doc-writing` を**単独で**持つ定義があり、`--list-coverage` の `uncovered` が空である(T18。`document-writer.md` で充足)。
- 再生成後も既存 7 定義の `disallowedTools` が保持されている(T18。新規 1 件を含め deny を持つ定義は 8 件)。
- **`.claude/agents/` は gitignore 対象のため、T18 の成果はコミットに現れない**(§5 / §7-4)。
- 変更を §5 の方針で分けてコミットしている。

## 9. 未解決事項

1. **解決済み(2026-09-16)。** T18 で作る `doc-writing` 定義は **`gemini-flash` の 1 件のみ**とし、名前は `document-writer`、MCP は serena(書き込み系 11 ツールを deny)とした。`sonnet` と `gpt-terra` の定義は作らない(ユーザー判断)。設計書 §10-3 / §10-7 もこの結果で閉じる。
2. 設計書 §10 の 5 項(cliproxyapi-setup.md の追随、`subagent-start.test.ts` の stale なフィクスチャ、定義名、`doc-writing` の運用実績、Gemini Flash の執筆品質)は本改修のスコープ外である。
