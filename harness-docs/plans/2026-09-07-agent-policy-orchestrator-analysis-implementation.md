# agent-policy 上流 2 帯のサブエージェント化とオーケストレーターの役割定義 実装計画書

- 作成日: 2026-09-07
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.15.0-dev` → `0.16.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-07-agent-policy-orchestrator-analysis-design.md`
- 着手時の HEAD: `23fbd25`
- baseline: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` はいずれも成功(Test Files 153 passed | 1 skipped、Tests 2024 passed | 2 skipped)
- 版注: 第 1 版。

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、設計判断を上書きしない。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §8「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

## 1. 進め方の共通規律

- 各タスクはテストを先に書いてから実装する。テストのパスは各タスクの表に明記する。
- `plugins/agent-policy/scripts/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する。
- **AI が読む指示書の本文(`skills/*/SKILL.md`・`references/*.md`・`assets/roles/**/*.md`・`assets/context-map-template.md`)の改修と新規作成は、`prompt-smith:prompt-smith` スキルをロードした担当に行わせる**(設計書 §9-5)。依頼文に「`prompt-smith:prompt-smith` スキルをロードしてから作業する」と明記する。同スキル本体と参照文書の合計は 14,252 バイト(30KB 未満)であり、そのままロードさせてよい。README・設計書・Serena メモリはこの対象外である。
- 委譲するタスクの依頼文には、対象ファイル・テストのパス・テスト先行・使用してよい tools・報告形式・§5 の共有契約を転記する。方針スキルはロードさせない。
- 同一フェーズ内のタスクは 1 メッセージで並列に dispatch する。フェーズ間は直列とする。
- **`pnpm run typecheck` と `pnpm run test` が全体で通ることを完了条件にできるのは、フェーズ 2 以降である。** フェーズ 1 だけは型エラーとテスト失敗の残る中間状態を許容し、その範囲を §2 のフェーズ 1 に明示する。
- 設計判断・要件の追加・スコープ拡大は担当が決めず、オーケストレーターへ差し戻す。
- 本改修と無関係な未コミット変更(raphael 抗体・会話記録・`cliproxyapi.config.example.yaml` など)は触らない。revert もしない。

### 網羅型による中間状態の連鎖(必読)

`policies.ts` の `ASSIGNMENTS` / `RECOMMENDED` と、`policies.test.ts` の `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` / `EXPECTED_AGENT_TOOL` はいずれも `Record<RoleId, …>` の網羅型である。したがって **`roles.ts` へ `RoleId` を 2 種追加した瞬間に、`policies.ts` と `policies.test.ts` の合計 5 定数がすべて型エラーになる**。この 3 ファイル(`roles.ts` / `policies.ts` / `policies.test.ts`)は分割せず 1 タスク(T1)で扱う。

T1 完了時点で残る中間状態は次に限る。これ以外にエラー・失敗が出た場合は、その原因を解消してから T1 を完了とする。

| 種別 | 対象 | 理由 | 解消するタスク |
| --- | --- | --- | --- |
| test 失敗 | `src/agents/__test__/fragments.test.ts` L57(`toBe(14)`) | 断片が 16 本になるのは T2、リテラル追随は T3 | T3 |
| test 失敗 | `src/agents/__test__/compose.test.ts` L294-331(断片と `ROLES` の整合性) | ja 断片 2 本が未作成 | T2 |
| test 失敗 | `src/__test__/setup-agents.test.ts` L359 / L418(`toHaveLength(14)`) | リテラル追随が T4 | T4 |

`tsc --noEmit` は T1 の完了時点でエラー 0 に戻す(型エラーを次フェーズへ持ち越さない)。

## 2. タスク分割

### フェーズ 1: コード正本と断片(並列 2)

| ID | 内容 | 対象 | テスト | 担当帯 | prompt-smith |
| --- | --- | --- | --- | --- | --- |
| T1 | `RoleId` に `design-plan` / `explore-lead` を追加し、`ROLES` へ `general` の直後・`explore` の直前の順で 2 要素を挿入(設計書 §4.1)。`ASSIGNMENTS["claude-model-policy"]` と `RECOMMENDED` へ各 2 行を追加(§4.2)。`policies.test.ts` の 3 定数へ各 2 行を追加し、テスト名の「14」を「16」へ。`roles.test.ts` の期待配列・`size`・テスト名を 16 へ。新 2 役割の `label` / `kind` / `tools` を固定する検査を追加。`policy-skill-assignments.test.ts` L151 のテスト名を「全 16 役割」へ | `src/agents/roles.ts` / `src/agents/policies.ts` | `src/agents/__test__/roles.test.ts` / `src/agents/__test__/policies.test.ts` / `src/agents/__test__/policy-skill-assignments.test.ts` | 複雑または重要な実装 | 不要 |
| T2 | 役割断片 4 本を新規作成(設計書 §4.12)。`assets/roles/ja/design-plan.md` と `assets/roles/ja/explore-lead.md` は設計書 §4.12 の全文をそのまま用いる。`assets/roles/en/design-plan.md` と `assets/roles/en/explore-lead.md` は同じ節構成・同じ内容の英語版とし、`label` は `Design and Implementation Plan Authoring` / `Codebase Exploration Lead`、`default-name` は ja と同一値にする。`label` の一致検査は ja のみが対象であり、en の `label` は英語表記でよい(`id` / `default-name` / `tools` / `kind` は ja と一致させる。T3 が en 検査を新設する) | `assets/roles/{ja,en}/design-plan.md`(新規) / `assets/roles/{ja,en}/explore-lead.md`(新規) | `src/agents/__test__/compose.test.ts`(既存の整合性検査が自動的に対象にする。新規テストは書かない) | 通常の実装 | **必要** |

- T1 の検証: `ROLES` の並びが `complex-impl, normal-impl, light-impl, escalation, general, design-plan, explore-lead, explore, …, advisor` であること。`roleOrder("complex-impl") === 0` と `roleOrder("advisor") === ROLES.length - 1` が値の変更なしで通ること。新 2 帯の `allowsAgentTool` が `true` であること(`SOLO_DENIED_ROLES` は変更しない)。`ASSIGNMENTS` / `RECOMMENDED` の新 2 行がともに `["opus"]` であること。
- T1 で変更しないもの: `AGENT_DENIED_MODELS` / `SOLO_DENIED_ROLES` / `allowsAgentTool` の実装 / `RoleKind` の 2 値 / `hasMixedKinds` / `MODELS` / `POLICIES`。
- T2 の検証: frontmatter の `label` / `tools` / `kind` が §5 の共有契約と一字一句一致すること(`compose.test.ts` L321-330 が ja を固定する)。本文に他定義の固有名(`GPT Sol` / `GPT Terra` / `GPT Luna` / `Grok Implementer` / `Grok Researcher` / `Claude Researcher`)を含まないこと(同 L332-354)。`tools` は `Agent` を含まない基底値であること。
- T1 と T2 は対象ファイルが重ならない。両方の完了後にオーケストレーターが `pnpm run typecheck` を実行し、エラー 0 を確認してからフェーズ 2 へ進む。

### フェーズ 2: テスト追随(並列 2)

| ID | 内容 | 対象 | テスト | 担当帯 | prompt-smith |
| --- | --- | --- | --- | --- | --- |
| T3 | `fragments.test.ts` L57 を `toBe(16)` へ。`compose.test.ts` の断片整合性検査を `assets/roles/en` にも回し、`label` の言語差を除いた `id` / `default-name` / `tools` / `kind` の一致を検査する(設計書 §8-2 の決定)。`compose.test.ts` L121 のマーカー並び順ケースへ新 ID を含むケースを 1 件追加 | — | `src/agents/__test__/fragments.test.ts` / `src/agents/__test__/compose.test.ts` | 通常の実装 | 不要 |
| T4 | `setup-agents.test.ts` L359 / L418 の `toHaveLength(14)` を `16` へ。`marker-scan.test.ts` へ `design-plan` / `explore-lead` の表示名解決ケースを 1 件追加。`session-start.test.ts` L530 へ新 ID を含む並び順ケースを 1 件追加 | — | `src/__test__/setup-agents.test.ts` / `src/hooks/__test__/marker-scan.test.ts` / `src/hooks/__test__/session-start.test.ts` | 軽量な実装 | 不要 |

- T3 の en 検査は新規に書く検査である。既存 14 本の en 断片も対象になるため、既存断片に `default-name` の書き忘れなどの不備が見つかった場合は、**修正せずオーケストレーターへ報告する**(設計書のスコープ外の可能性があるため)。
- T4 は `--list-coverage` の `roles` 長のみを変える。差分保護・カバレッジ算出の検証内容は落とさない。
- フェーズ 2 の完了条件: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の全体が通る。この時点でコードとテストは全 green に戻る。

### フェーズ 3: 指示書の改修(並列 4・全タスクで prompt-smith をロード)

対象ファイルは互いに重ならない。各依頼文の冒頭に「`prompt-smith:prompt-smith` スキルをロードしてから作業する」と明記する。設計書の変更前・変更後の文言をそのまま依頼文へ転記し、担当が文言を創作しないようにする。

| ID | 内容 | 対象 | 担当帯 | prompt-smith |
| --- | --- | --- | --- | --- |
| T5 | 共通規律の改訂。(a) L5 の定義文へ節名を併記し、担当表の全帯がサブエージェントの役割であるという宣言を追加(§4.5、§8-1 の決定「併記する」)。(b) `## モデル別役割の運用` の直前に「## オーケストレーターが自ら担う作業」節を新設し、L14 の条項をそこへ移す(§4.6)。(c) L46 の合成対象を 13 帯 → 15 帯へ拡張し、括弧書きを撤回(§4.7)。(d) L85-86 を 3 項へ書き換え(§4.8)。(e) L96-99 を 6 項へ書き換え(§4.9) | `references/orchestration-discipline.md` | 通常の実装 | **必要** |
| T6 | (a) `custom-policy/SKILL.md` L36 の箇条を削除(§4.4)。担当表の 2 行と L14 の段落は変更しない。(b) `claude-model-policy/SKILL.md` の「実行帯の解決順」節(L54-55)の番号付きリストを、1 項目しかないため番号を外す整形(§8-4 の決定)。担当表の 2 行は `Opus` のまま維持する。(c) 両 SKILL.md の担当表の前後に「全帯はサブエージェントの役割である」旨の宣言文を**置かない**(§4.3。宣言は共通規律の 1 箇所のみ) | `skills/custom-policy/SKILL.md` / `skills/claude-model-policy/SKILL.md` | 通常の実装 | **必要** |
| T7 | (a) `context-map-guide.md` L12 の用語表を書き換え(§4.10 変更 1)。(b) 同 L40 の map 作成者行を書き換え(§4.10 変更 2)。L37 と L81 は**変更しない**。(c) `assets/context-map-template.md` L4 を `**作成者**: [map を作成したモデル名](コードベース探索統括の帯)` へ(§4.11)。テンプレートの他の行は変更しない | `references/context-map-guide.md` / `assets/context-map-template.md` | 通常の実装 | **必要** |
| T8 | `setup-agents/SKILL.md` L236 の MCP 既定の実装役割列挙へ `design-plan` / `explore-lead` を追加。同じ節へ「`--list-coverage` の `mixedKinds` が真のとき、読み取り帯と実装帯が同居していることを知らせ、定義の分離を提案する」手順を追加(§4.13、§4.1 の副作用対処)。挿入位置は L236 と同じ MCP 既定の節とし、`explore` と `explore-lead` の同居を例に挙げる。コード変更は不要で散文だけを追随させる | `skills/setup-agents/SKILL.md` | 通常の実装 | **必要** |

- T6 の検証: `policy-skill-assignments.test.ts` が通ること。両 SKILL の担当表 16 行(既存 14 行 + 対象 2 行)が正本と一致する。パーサは行の 1 列目を `startsWith(label)` で照合するため、新 label が既存 label と前方一致で衝突しないこと(設計書 §6 で双方向の確認済み)を回帰として確認する。
- T5 / T7 / T8 の検証: 該当箇所の文言が設計書の「変更後」と一致すること。文書検証テストは無いため、フェーズ 6 の一括突き合わせで確認する。
- フェーズ 3 の完了条件: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の全体が通る。

### フェーズ 4: README・バージョン・build(並列 2)

| ID | 内容 | 対象 | 担当帯 | prompt-smith |
| --- | --- | --- | --- | --- |
| T9 | (a) `plugins/agent-policy/README.md` L103 の実装役割列挙へ 2 種を追加。(b) L109 の「14 種」→「16 種」。(c) L111-127 の表へ `general` の行の後に `| design-plan | 設計書・実装計画書(WBS)の作成 |` と `| explore-lead | コードベース探索統括 |` を挿入。(d) §旧バージョンからの移行 へ「0.15 系から 0.16 系へ移行する場合」の節を新設(設計書 §4.13 の 4 項目をすべて書く)。(e) ルート `README.md` L111 の「14 の役割帯」→「16 の役割帯」。`.claude-plugin/marketplace.json` は変更しない | `plugins/agent-policy/README.md` / `README.md` | 軽量な実装 | 不要 |
| T10 | `plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.16.0-dev` へ揃える。その後 `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が `src/` の変更に対応していることを確認する | `plugin.json` / `package.json` / `scripts/`(生成物) | 軽量な実装 | 不要 |

- T9 は README であり `prompt-smith` の対象外である(設計書 §9-5)。
- T10 は `scripts/` を手で編集しない。`pnpm run build` の出力だけをコミット対象にする。
- フェーズ 4 の完了条件: 2 ファイルのバージョンが `0.16.0-dev` で揃い、`pnpm run build` 後に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。

### フェーズ 5: 追随(並列 2)

| ID | 内容 | 対象 | 担当帯 | prompt-smith |
| --- | --- | --- | --- | --- |
| T11 | `.serena/memories/agent_policy/core.md` を設計書 §8-5 の 5 項目に沿って更新する。(1) 冒頭のバージョン表記を `0.16.0-dev` へ。(2) 見出し「Role fragments and the 10 role IDs」を 16 種の実体へ。(3) 「The two policy skills — role tables」節の `RECOMMENDED` 列挙へ `design-plan` / `explore-lead` を追加し、併せて既存の食い違い(`normal-impl` は `["sonnet","gpt-luna","grok"]`、`general` は `["sonnet","gpt-luna"]`)を実体へ直す。(4) 「Custom's execution-tier resolution」へ、担当表の全帯がサブエージェントの役割であるという宣言と、オーケストレーターの担当(dispatch / 要件確定 / 採否判断 / 承認 / 分析)を追記。(5) 設計書の一覧へ本設計書を追加。**更新は Serena の `write_memory` / `edit_memory` で行う**(`.serena/memories/` は保護パスであり Edit / Write では触らない)。`agent_policy` メモリは `core.md` 1 本だけである | `.serena/memories/agent_policy/core.md` | 通常の実装 | 不要 |
| T12 | ARCHITECTURE のドメインマップの glob が本改修の新規ファイルを取りこぼさないことを確認する。確認対象は (a) `assets/roles/**` の新規 4 本が `prompt` ドメインの glob(`plugins/*/assets/**`)に入ること、(b) `harness-docs/plans/**` の本計画書が `docs` ドメインの glob(`harness-docs/**`)に入ること。設計書 §8-6 のとおり ARCHITECTURE 本文は本改修の影響を受けない見込みである。取りこぼし・食い違いが 1 つでもあれば**修正せず報告する**(追随は `/metatron:update` で行うため) | `harness-docs/ARCHITECTURE.md`(読み取りのみ) | 軽量な実装 | 不要 |

- T12 は読み取りと報告だけであり、ファイルを変更しない。依頼文に「ファイルを変更しない」「報告のみを返す」を明記する。
- 事前調査の結果、ARCHITECTURE L96 の `prompt` glob は `plugins/*/assets/**` を、L99 の `docs` glob は `harness-docs/**` を含む。T12 はこれを追認する位置づけであり、想定外の結果が出たときだけ `/metatron:update` を起動する。
- フェーズ 5 の完了条件: T11 のメモリが更新済みで、T12 の確認結果が報告されている。

### フェーズ 6: 全体検証と最終突き合わせ(直列)

| ID | 内容 | 担当帯 |
| --- | --- | --- |
| T13 | `pnpm run build` → `pnpm run lint` → `pnpm run typecheck` → `pnpm run test`。baseline(Test Files 153 passed | 1 skipped、Tests 2024 passed | 2 skipped)からの増減が、本改修で追加したテストケース分だけであることを確認する | オーケストレーター |
| T14 | 変更差分のコードレビュー。`src/` の差分と `scripts/` の生成差分の対応、断片 4 本の frontmatter、テスト追随の抜けを見る | コードレビュー |
| T15 | **オーケストレーターによる最終確認。** 全フェーズの差分(`git diff` と新規ファイル)を分割せず一度に読み、次を突き合わせる。(1) 設計書 §4.1-4.13 の変更前・変更後の文言と実際の差分が一致すること。(2) 新 2 帯の `label` が `roles.ts` / 断片 ja / 両 SKILL 担当表 / README 表 / 規律 §合成の対象 の 5 箇所で完全に同一であること。(3) 規律の宣言が `orchestration-discipline.md` の 1 箇所にだけあり、両 SKILL.md に重複していないこと。(4) 設計書 §9-6 の Done 条件がすべて満たされていること。要約の要約では判断しない | オーケストレーター |

- T14 の依頼文には「ファイルを変更しない」「報告のみを返す」を明記する。
- T15 で食い違いが見つかった場合は §8 へ記録し、該当フェーズのタスクをやり直す。

## 3. 依存関係

```
T1 ─┬─ T3 ─┬─ T5 ─┐
T2 ─┘   T4 ─┘  T6 ─┼─ T9 ──┬─ T11 ─┬─ T13 ─ T14 ─ T15
                T7 ─┤  T10 ─┘  T12 ─┘
                T8 ─┘
```

- T1 と T2 は並列だが、両方が揃うまで `compose.test.ts` の断片整合性検査は通らない。
- T3 の `fragments.test.ts` リテラル追随は T2 の断片 4 本を前提にする。
- T10 の `pnpm run build` は T1 の `src/` 変更を前提にする。文書だけを変える T5-T9 は build に影響しない。
- T11 は T1・T10 の確定値(役割 16 種・バージョン `0.16.0-dev`)を前提にする。

## 4. 委譲先

セッションに注入された役割マーカー対応表の帯で解決する。対応表が無いセッションでは `claude-model-policy` の同帯モデルへ読み替える。

| 担当帯 | 割り当てるタスク |
| --- | --- |
| 複雑または重要な実装 | T1 |
| 通常の実装 | T2 / T3 / T5 / T6 / T7 / T8 / T11 |
| 軽量な実装 | T4 / T9 / T10 / T12 |
| コードレビュー | T14 |
| オーケストレーター | T13 / T15 |

- 指示書の改修(T2 / T5-T8)は `prompt-smith:prompt-smith` をロードするため、「軽量な実装」へは割り当てない。
- 「軽量な実装」の帯には Agent tool を許可しない。依頼文に「この tools のみ使用」と、迷いは相談ではなく差し戻しで解決することを明記する。

## 5. タスク間で共有する契約

並列実装者が推測で決めないよう、次を依頼文へ転記する。

```ts
// T1 が定義し、T2 の断片 frontmatter と T3 / T4 のテストが一致させる
type RoleId =
  | "complex-impl" | "normal-impl" | "light-impl" | "escalation" | "general"
  | "design-plan" | "explore-lead"
  | "explore" | "realtime-research" | "e2e-verify" | "independent-review"
  | "doc-review" | "code-review" | "final-review" | "gate-review" | "advisor"

// ROLES への挿入位置は general の直後・explore の直前。順序は design-plan → explore-lead
{
  id: "design-plan",
  label: "設計書・実装計画書(WBS)の作成",
  kind: "impl",
  tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
}
{
  id: "explore-lead",
  label: "コードベース探索統括",
  kind: "impl",
  tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
}

// T1 が追加する値(ASSIGNMENTS["claude-model-policy"] / RECOMMENDED とも同値)
"design-plan": ["opus"],
"explore-lead": ["opus"],

// T1 が追加する期待値(policies.test.ts の EXPECTED_AGENT_TOOL)
"design-plan": true,
"explore-lead": true,
```

断片 frontmatter の固定値(T2。ja の `label` は上表と一字一句一致させる):

| ファイル | id | label | default-name | tools | kind |
| --- | --- | --- | --- | --- | --- |
| `ja/design-plan.md` | `design-plan` | `設計書・実装計画書(WBS)の作成` | `design-writer` | `Read, Grep, Glob, Write, Edit, Bash, Skill` | `impl` |
| `en/design-plan.md` | `design-plan` | `Design and Implementation Plan Authoring` | `design-writer` | 同上 | `impl` |
| `ja/explore-lead.md` | `explore-lead` | `コードベース探索統括` | `explore-lead` | 同上 | `impl` |
| `en/explore-lead.md` | `explore-lead` | `Codebase Exploration Lead` | `explore-lead` | 同上 | `impl` |

- `tools` に `Agent` を書かない。`compose.ts` L44-45 が `allowsAgentTool` の結果で付与する。
- `default-name` は言語をまたいで同一にする。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| `RoleId` 追加で 5 つの網羅型が同時に壊れ、分割委譲すると誰の担当でも typecheck が通らない | `roles.ts` / `policies.ts` / `policies.test.ts` を T1 の 1 タスクへ束ねる。中間状態の許容範囲を §1 の表で限定する |
| フェーズ 1 終了時にテストが赤のまま次フェーズへ進む | フェーズ 1 の完了確認は `typecheck` エラー 0 のみとし、赤で残ってよいテストファイルを §1 の表に列挙する。フェーズ 2 の完了条件を全 green とする |
| T3 の en 断片検査の新設で、既存 14 本の en 断片の不備が露見して作業が膨らむ | T3 は既存断片を修正せず報告する。修正要否はオーケストレーターが判断する |
| 指示書の担当が設計書の文言を創作する | 設計書の変更前・変更後のコードブロックを依頼文へそのまま転記する。担当は差分のみを適用する |
| `policy-skill-assignments.test.ts` の前方一致パーサが新 label で誤マッチする | 設計書 §6 で双方向の非衝突を確認済み。複数一致時はパーサが例外を投げるため沈黙しない。T6 の完了条件に本テストの通過を含める |
| `explore-lead` と `explore` の同居で `mixedKinds` が真になるが利用者に届かない | T8 で `setup-agents/SKILL.md` に提示手順を足す。生成は止めない |
| `scripts/` を手で編集してしまう | T10 だけが `pnpm run build` を実行する。他タスクの依頼文に「`scripts/` を触らない」と書く |
| `.serena/memories/` を Edit / Write で触ってしまう | T11 の依頼文に「Serena の `write_memory` / `edit_memory` で行う」と明記する |
| 並列 dispatch した担当が同じファイルへ書き込む | 各フェーズ内でタスクの対象ファイルが重ならないよう分割済み。依頼文で対象ファイルを明示する |
| 規律の改訂が広く、`orchestration-discipline.md` を読む全セッションの挙動が変わる | 変更は帯の追加と役割分担の明文化であり、既存の判定フロー(§委譲先の実行モデルの確定)は対象集合が広がるだけである。T15 の一括突き合わせで意図しない挙動変化が無いことを確認する |

## 7. Done 条件

設計書 §9-6 に、本計画書で追加した項目を足したものである。

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が `src/` の変更に対応して同じコミットにある。
- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` が揃って `0.16.0-dev` である。
- `README.md`(プラグイン・ルートの両方)の役割 ID 表が 16 種になり、0.15 系からの移行節が追記されている。
- `policy-skill-assignments.test.ts` が両 SKILL の担当表 16 行を正本と一致させて通る。
- 断片が ja / en それぞれ 16 本(`_common.md` とベンダー overlay を除く)あり、`compose.test.ts` の整合性検査が ja / en の両方で通る。
- `.serena/memories/agent_policy/core.md` の食い違い(設計書 §8-5)が更新されている。
- ARCHITECTURE のドメインマップ glob が新規ファイルを取りこぼさないことを確認した記録が残っている。取りこぼしがあれば `/metatron:update` で追随している。
- オーケストレーターが全差分を一度に読んで設計書と突き合わせ、食い違いが無いことを確認している(T15)。

## 8. 設計書との食い違い

現時点で検出した食い違いは無い。実装中に見つけた食い違いは、実装を止めてオーケストレーターへ報告し、この節へ次の形式で追記する。

| # | 検出タスク | 設計書の記述 | 実際 | 判断 |
| --- | --- | --- | --- | --- |
| 1 | 計画レビュー | §4.12「`compose.test.ts` L321-341 が固定する」「同 L332-355」 | label/tools/kind 検査は L321-330、固有名検査は L332-354 | 行範囲の実測誤り。設計書を訂正済み(設計判断に影響なし) |

事前に実測で追認した設計書の記述(食い違いなし):

| 設計書 | 記述 | 実測 |
| --- | --- | --- |
| §2.2 / 冒頭 | 現行バージョン `0.15.0-dev` | `plugin.json` / `package.json` とも `0.15.0-dev` |
| §2.1 | `assets/roles/{ja,en}/` は `_common.md` + 14 本 + `realtime-research.grok.md` | ja / en とも 16 ファイル(内訳一致) |
| §6 | `fragments.test.ts` L57 に `expect(fragments.size).toBe(14)` | L57 に存在 |
| §6 | `setup-agents.test.ts` L359 / L418 が `toHaveLength(14)` | 両行に存在 |
| §6 | `policies.test.ts` の 3 定数が `Record<RoleId, …>` の網羅型 | `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` / `EXPECTED_AGENT_TOOL` の 3 つで確認 |
| §6 | `roles.test.ts` L108-109 の `roleOrder` 検査 | 存在。挿入位置の決定により追随不要 |
| §8-5 | `agent_policy` メモリは `core.md` 1 本 | `.serena/memories/agent_policy/core.md` のみ |
| §8-6 | ARCHITECTURE で `agent-policy` を名指しするのは ADR-001 のみ | L125 の ADR-001 だけ。ドメインマップは L96 `plugins/*/assets/**` と L99 `harness-docs/**` で新規ファイルを覆う |

## 9. 未解決事項

1. 上流 2 帯を委譲に変えたときのトークン・レイテンシは未計測である(設計書 §8-3)。運用後に観測し、`references/orchestration-discipline.md` のコスト規律へ追記するかを別途判断する。本改修のスコープ外とする。
2. T3 の en 断片整合性検査で既存 14 本の不備が見つかった場合、その修正を本改修に含めるかは未決である。報告を受けてオーケストレーターが判断する。
3. 本改修のコミット分割(1 コミットか、コード / 指示書 / 文書の 3 コミットか)は決めていない。フェーズ 6 の完了時にオーケストレーターが決める。
