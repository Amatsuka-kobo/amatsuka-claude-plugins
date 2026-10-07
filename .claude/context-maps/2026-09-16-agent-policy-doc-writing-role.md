# Context Map: agent-policy 役割 `doc-writing` 追加とベンダー `gemini` / ModelId `gemini-flash` 追加

**作成日**: 2026-09-16
**作成者**: Opus 5 (1M context)(コードベース探索統括の役割)
**対象タスク**: agent-policy に 17 番目の役割 `doc-writing`(文書作成)を追加し、`general` から文書責務を分離する。併せて新ベンダー `gemini` と新 ModelId `gemini-flash` を追加する。
**関連する設計書**: `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`(担当表の一本化)、`2026-08-31-agent-policy-two-profile-design.md`(2 プロファイル・`owned_by` の実測)

> **配置の注記**: 依頼文は `harness-docs/context-maps/` を指定したが、同ディレクトリは存在せず、既存 context-map 12 件はすべて `.claude/context-maps/` にある(`references/context-map-guide.md` の規定も同じ)。依頼文の「既存の context-map があれば配置に倣う」に従い `.claude/context-maps/` へ置いた。

---

## 1. 目的・スコープ

- 役割 `doc-writing` を追加し、`general`(その他のタスク)が現在担っている「ドキュメント作業」を移す。
- `Vendor` に `gemini`、`ModelId` に `gemini-flash` を追加し、setup-agents が Gemini 系の定義を生成できるようにする。
- **スコープ外**: プロキシ(CLIProxyAPI)自体の設定、既存生成済み定義の自動移行、他プラグインへの波及(他プラグインは `Vendor` / `ModelId` を import していない)。

## 2. 現在のコードベース構造

```
plugins/agent-policy/
├── src/agents/      roles.ts(役割正本) policies.ts(ModelId/割当) fragments.ts(Vendor)
│                    compose.ts(色・合成) live-models.ts(owned_by→vendor)
├── src/hooks/       session-start.ts subagent-start.ts marker-scan.ts
├── src/setup-agents.ts  CLI 本体(--vendor 検証・VENDOR_COLORS)
├── assets/roles/{ja,en}/  役割断片 <id>.md + _common.md + <id>.<vendor>.md
├── references/orchestration-discipline.md  §担当表(正本)
├── skills/setup-agents/SKILL.md            ウィザード手順
└── README.md
```

### 2.2 重要なファイル(絶対パスは `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/` 起点)

| ファイル | 役割 | 重要度 |
|---|---|---|
| `plugins/agent-policy/src/agents/roles.ts` | `RoleId` union(L3-20)と `ROLES`(L29-126)。並び順が担当表・CSV の順 | High |
| `plugins/agent-policy/src/agents/policies.ts` | `ModelId`(L4-13)、`MODELS`(L47-119)、`ASSIGNMENTS`(L124-146)、`RECOMMENDED`(L149-166)、`SOLO_DENIED_ROLES`(L174-181) | High |
| `plugins/agent-policy/src/agents/fragments.ts` | `Vendor`(L6)。overlay は `endsWith(".${vendor}.md")`(L124-140) | High |
| `plugins/agent-policy/src/agents/compose.ts` | `COLORS: Record<Vendor,string>`(L33-37)。`none` のみ特別扱い(L59-61, L135) | High |
| `plugins/agent-policy/src/setup-agents.ts` | `VENDOR_COLORS: Record<Vendor,string>`(L79-83)、`--vendor` 検証(L942-949)、推定失敗文言(L267)、live 不通時の `spec.vendor` フォールバック(L254-270) | High |
| `plugins/agent-policy/src/agents/live-models.ts` | **独立した Vendor union**(L5: `gpt\|grok\|claude\|unknown`)と `vendorFor`(L17-31) | High |
| `plugins/agent-policy/references/orchestration-discipline.md` | §担当表(L5-29)。5 列 × 16 行 | High |
| `plugins/agent-policy/assets/roles/{ja,en}/general.md` | 文書責務の現在地(ja: L4/L12/L17) | High |
| `plugins/agent-policy/README.md` | 役割表(L109-128)、モデル表(L130-142)、MCP 既定 7 役割(L103)、移行節(L206-) | High |
| `plugins/agent-policy/skills/setup-agents/SKILL.md` | モデル列挙(L45,46,80,89,159,163)、エイリアス表(L100)、vendor 4 値(L170,171,174,232,291,321)、MCP 既定 7 役割(L260) | High |

## 3. 関連モジュール・データフロー

- **役割**: `roles.ts` が唯一の正本 → `policies.ts` の `Record<RoleId,...>` 2 つが型で追随を強制 → 断片(assets)・担当表(references)・README/SKILL は**型の保護が無く手動追随**。
- **ベンダー**: `fragments.ts` の `Vendor` は合成側(色・overlay・marker)。`live-models.ts` の union は**別型**で、`none` の代わりに `unknown` を持つ。CLI が両者を `resolveVendor`(`setup-agents.ts:254-270`)で橋渡しする。
- **ModelId**: `MODELS` 配列のみ。`Record<ModelId,...>` も exhaustive switch も存在しないため、**追加しても型エラーは一切出ない**。

## 4. 既存の実装パターン・規約

- 役割断片の frontmatter は `id` / `label` / `description` / `default-name` / `tools` / `kind` の 6 キー。本文は `## When to invoke` / `## Core Responsibilities` / `## 作業手順` / `## 制約` / `## Output Format`(en は `## Procedure` / `## Constraints`)。`ja` と `en` を必ず対で作る。
- `default-name` が生成される Agent 定義の既定ファイル名になる(例 `design-plan` → `design-writer`)。
- 色は公式 8 色から選び、重複を許す。生成時に効くのは `VENDOR_COLORS` であって `ModelSpec.color` ではない(`policies.ts:46` の注記)。
- ベンダー別 overlay 断片は**任意**。現存は `realtime-research.grok.md`(ja/en)の 2 件だけで、gpt / claude 向けは無い。

## 5. 変更の影響範囲

### 5.1 直接影響(役割追加)

役割追加の前例は 2 コミット。`23fbd25`(4 役割: `escalation`/`e2e-verify`/`final-review`/`gate-review` + GPT Astra)と `99f5a93`(2 役割: `design-plan`/`explore-lead`、14→16)。後者が触った 29 ファイルが最良のチェックリストである。

- **型が追随を強制する**: `roles.ts`(union + 配列)、`policies.ts` の `ASSIGNMENTS` / `RECOMMENDED`(ともに `Record<RoleId,...>`)。
- **手動追随(型の保護なし)**: `assets/roles/{ja,en}/doc-writing.md` 新規 2 件、`references/orchestration-discipline.md` §担当表に 1 行、`README.md` L109「16 種」と役割表 L111-128、`skills/setup-agents/SKILL.md` L260 の MCP 既定列挙(入れる場合)。
- **プラグイン外の必須追随**: リポジトリ直下 `README.md:112`「全16種の役割」、`.serena/memories/agent_policy/core.md:89-96`(「16 role IDs」と ID 列挙)と `:279-284`(`RECOMMENDED` の値)。**core.md は保護パスであり Serena の `write_memory`/`edit_memory` でのみ変更する**。
- **ビルド**: `plugins/agent-policy/scripts/*.mjs` はバンドル出力(保護パス)。`src/` を直して `pnpm run build` し、差分を同じコミットに入れる。

**役割数 16 / 全 ID 配列を固定しているテスト(全件)**

| ファイル:行 | 固定内容 |
|---|---|
| `roles.test.ts:11,30` | テスト名「16 件」と `size).toBe(16)` |
| `roles.test.ts:12-29` | 全 16 ID の定義順配列 |
| `roles.test.ts:33-85` | `design-plan`/`explore-lead` ほか 6 役割の label/kind/tools 固定(新役割も同型の検査を足す前例) |
| `roles.test.ts:130` | **`roleOrder("advisor") === ROLES.length - 1`** — advisor を末尾に保つ契約 |
| `fragments.test.ts:57` | `fragments.size).toBe(16)` |
| `fragments.test.ts:61-69` | 一部役割の `defaultName` 固定 |
| `policies.test.ts:19-36 / 38-55 / 57-74` | `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` / `EXPECTED_AGENT_TOOL` 各 16 件 |
| `policies.test.ts:100,112,207` | テスト名「全 16 役割」 |
| `policies.test.ts:180-189 / 192-198` | `rolesFor("sonnet")` 7 件 / `rolesFor("fable")` 4 件 — **割当先のモデル次第で更新が要る** |
| `setup-agents.test.ts:543,610` | `--list-coverage` の `toHaveLength(16)` |
| `setup-agents.test.ts:737-754` | `--list-roles` が全 16 ID の定義順 |

件数リテラルは無いが断片・表の追加で自動追随するもの: `compose.test.ts:318-367`(ja/en 断片のファイル名・id・label・tools・kind が `ROLES` と一致、en の default-name/tools/kind が ja と一致)、`compose.test.ts:594-608`(全役割が en で合成できる)、`discipline-role-table.test.ts:154`(行数 = `ROLES.length`)。

- **`general` の文言剥がし**: `assets/roles/ja/general.md` の L4(description)・L12(When to invoke)・L17(Core Responsibilities)、`en/general.md` の同位置 L4/L12/L17。**これらの文言を検証しているテストは無い**ので、剥がしても既存テストは落ちない。

### 5.2 直接影響(ベンダー / ModelId 追加)

- **型エラーになる 2 箇所のみ**: `compose.ts:33-37` と `setup-agents.ts:79-83` の `Record<Vendor,string>`。
- **型エラーにならず実行時に漏れる**: `setup-agents.ts:942-949`(`--vendor` 検証)、`:267`(推定失敗文言)、`live-models.ts:5`(別 union)と `:17-31`(`vendorFor` の switch)、`policies.ts:47-119`(`MODELS` に行を足さないと `modelById` が unknown)。
- **テスト**: `policies.test.ts:119-120`(`toHaveLength(9)`)、`:139-148`(`MODELS.at(7)`/`at(8)` の位置依存 — **末尾追加で壊れる**)、`:18-54`(`EXPECTED_RECOMMENDED`)、`compose.test.ts:85-112`(vendor×色)、`setup-agents.test.ts:129`(live vendor union)・`:1778-1783`(`--vendor` 4 値 it.each)・`:1915`(失敗文言)、`live-models.test.ts:47-68`(owned_by 3 種のみ)、`discipline-role-table.test.ts:17-27`(`MODEL_IDS` ラベル表)。

### 5.3 波及しない / 変更不要

- `src/hooks/session-start.ts` と `subagent-start.ts` は `Vendor` 型を使わず、外部判定は `runsOnClaude(model)` で行う。**フック改修は不要**。
- `marker-scan.ts:189-194` の `CLAUDE_VENDORS = {"claude","none"}` は `gemini` を claude 構成から自動的に除外する。これは外部ベンダーとして**正しい挙動**なので変更しない。
- 他プラグインは `Vendor` / `ModelId` を import していない。

## 6. 守るべき既存契約

- `roles.ts` の `ROLES` の**並び順**が担当表の行順・`--list-roles` / `--list-coverage` の順の正本である。挿入位置がそのまま外部に出る。
- **`advisor` は `ROLES` の末尾でなければならない**(`roles.test.ts:130` の `roleOrder("advisor") === ROLES.length - 1`)。`doc-writing` を末尾に置くとこのテストが壊れる。
- 役割断片の必須 frontmatter は `id` / `label` / `description` / `tools` / `kind` の 5 キー(`fragments.ts` の `readFragment`)。`default-name` は**任意**。ja の `label`/`tools`/`kind` は `ROLES` と完全一致、en の `default-name`/`tools`/`kind` は ja と完全一致が要る。
- 担当表(`orchestration-discipline.md` L7-24)の列は `役割名 | RoleId | 種別 | Agent Tool | Claude モデル` の 5 列。`discipline-role-table.test.ts` が `ROLES` と突き合わせるため、列の値は実装と一致していなければならない。
- 「Claude モデル」列は、custom プロファイルで**委譲先が決まらない役割の読み替え先**を兼ねる(L29)。`doc-writing` にも必ず 1 つ Claude モデルが要る。
- `SOLO_DENIED_ROLES`(単一役割定義への Agent Tool 禁止)と担当表の「Agent Tool」列は同じ事実の 2 表現であり、必ず揃える。
- MCP の付与単位は**役割ではなく定義**。CLI は役割を見ずに `--mcp-servers` を渡した定義へ無条件で付ける(`setup-agents.test.ts:2001-2028` が readonly の `explore` にも付くことを固定)。既定の 7 役割列挙は SKILL.md L260 と README L103 の**文書側の規律**にすぎない。
- 既存の生成済み定義の後方互換: 新役割のマーカーが無い定義は「Claude モデル」列へ読み替えられる(0.15→0.16 移行節 L230 の前例)。

## 7. 未解決事項(Open Questions)

| # | 内容 | 影響度 | 現状の仮定 |
|---|---|---|---|
| 1 | **Gemini の `owned_by` の実値が不明。** 設定例のプロバイダキーは `google` ではなく `antigravity`。ただしプロバイダキーは `owned_by` と一致しない(codex → `owned_by: openai`)。実測は `openai`/`anthropic`/`xai` の 3 値のみ(`plans/2026-09-04-...-implementation.md:25`)。リポジトリ内に手掛かりは**無い** | High | 未定。プロキシの `/v1/models` を実際に叩いて確認する必要がある。判明までは `vendorFor` が `unknown` を返し `resolveVendor` が throw する |
| 2 | `doc-writing` の `kind` と `tools`。文書を書くので `impl` が自然だが、`Bash` / `Skill` を持たせるか | High | `kind: impl`、`tools: Read, Grep, Glob, Write, Edit, Bash, Skill`(`design-plan` と同じ)と仮定 |
| 3 | `doc-writing` の Agent Tool 可否(= `SOLO_DENIED_ROLES` に入れるか、担当表の列の値) | High | 未定 |
| 4 | `ASSIGNMENTS` の Claude モデルと `RECOMMENDED` の並び。`gemini-flash` を `doc-writing` の推奨に入れるのか(この 2 改修を結び付ける意図があるのか)が依頼から読み取れない | High | 未定 |
| 5 | `ROLES` 配列への挿入位置。`general` の直後か、`design-plan` の近傍か。担当表・README・`--list-roles` の順に直結する。**末尾は不可**(advisor 末尾の契約) | Medium | 未定 |
| 6 | `gemini-flash` の `defaultName` と `model` 値。設定例の alias は `claude-gemini-3-8-flash`(ハイフン)だが、同ファイルのもう 1 件は `claude-gemini-3.1-pro-high`(ドット)で命名が揺れている | Medium | `model: claude-gemini-3-8-flash` と仮定 |
| 7 | `gemini` の色(`COLORS` / `VENDOR_COLORS`)。公式 8 色は既に gpt=yellow, grok=red, claude=blue 等で埋まりつつある | Medium | 未定(重複は許容される) |
| 8 | `doc-writing` を MCP 既定付与の列挙(SKILL.md L260 / README L103)に入れるか | Medium | 未定 |
| 9 | `general` から文書責務を剥がした後、`general` の description を何に置き換えるか(現行 ja L4 は「ドキュメント作成、定型メンテナンスなど、レビュー・設計を除く一般作業」) | Medium | 未定 |
| 10 | `live-models.ts` の Vendor union を `fragments.ts` の `Vendor` へ統合するか、別型のまま `gemini` を両方へ足すか | Medium | 別型のまま両方へ足すと仮定 |
| 11 | バージョン。役割 + ベンダー + ModelId の 3 追加はマイナー相当か(0.18.0-dev → 0.19.0-dev) | Low | マイナーと仮定 |
| 12 | `doc-writing.gemini.md` のような overlay 断片を作るか。現存 overlay は grok×realtime-research のみ | Low | 作らないと仮定 |
| 13 | `docs/development/cliproxyapi-setup.md` が example yaml の antigravity/Gemini に未追随。今回のスコープに含めるか | Low | 未定 |

## 8. テスト戦略

- 既存は vitest のユニットのみ、`plugins/**/__test__/**/*.test.ts` だけが拾われる。E2E は持たない。
- **必ず落ちるので先に直す**: 役割数 16 の 8 箇所、`MODELS` の `toHaveLength(9)` と `MODELS.at(7)/at(8)` の位置依存アサーション、`--vendor` の 4 値 it.each、推定失敗文言。
- **追加すべき**: `live-models.test.ts` に Google 系 `owned_by` のケース(#1 の確定後)、`compose.test.ts` に `gemini` の色と marker、`roles.test.ts` に `doc-writing` の並び、`discipline-role-table.test.ts` は担当表更新で自動的に検証される。
- **エッジケース**: `MODELS.at(n)` の位置依存があるため、`gemini-flash` を配列のどこに挿すかでテストの壊れ方が変わる。末尾追加なら `at(8)` は無傷だが `at(9)` の追加が要る。同様に `ROLES` は advisor 末尾の契約があるため `doc-writing` を末尾に置けない。
- **既存のずれ(今回必須ではない)**: `src/hooks/__test__/subagent-start.test.ts:21-36` の `ROLE_IDS` は 14 件のままで、`design-plan` / `explore-lead` が欠落している。件数検査ではなく fixture なので落ちないが、既に現行 `ROLES` とずれている。

## 9. リスク・制約

- 最大のリスクは **#1(`owned_by` 不明)**。ここが未確定のまま実装すると、live 照会成功時に Gemini が `unknown` と判定され `resolveVendor` が throw し、非対話モードが `ok: false` で止まる。実機確認が前提条件になる。
- 型の保護が効くのは 2 箇所だけで、残りは**文書とテストの手動追随**である。前回コミット `99f5a93` の 29 ファイルを突き合わせない限り漏れる。
- `.serena/memories/agent_policy/core.md` と リポジトリ直下 `README.md` も前回コミットで更新されている(規約の Done 条件にも含まれる)。core.md は保護パスで Serena 経由のみ。
- `.claude/agents/` のローカル定義 13 件は現行 16 役割を過不足なく覆っている。`doc-writing` を足すと**このリポジトリが uncovered になる**。現状ドキュメント作業は `general-worker.md:7`(`general`)が担い、設計執筆は `system-planner.md:7`(`design-plan, explore-lead`)。新役割をどの定義へ付けるかはプラグイン改修とは別判断で、setup-agents 再実行でも埋まる。
- 担当表の**表以外の本文**にも役割名が出る。新役割の運用を規律に書くなら追随先になる: `orchestration-discipline.md` L55(`independent-review` の省略)、L115(合成対象は「その他のタスク」以外の全役割)、L150-168(探索統括/実働と `design-plan` への委譲、`doc-review`→`independent-review` の順)。L115 は `general` を名指ししているため、文書責務の移動で意味が変わらないか確認が要る。

## 10. 推奨アプローチ

1. **先に #1 を解く。** プロキシへ `/v1/models` を実際に照会し、Gemini エイリアスの `owned_by` を確定させる。これが決まらないとベンダー追加は実装できない。
2. 役割追加とベンダー追加は**独立**しているので、#4(推奨に gemini-flash を入れるか)が「入れない」なら 2 本の別コミットに分けられる。
3. 実装順は「正本(`roles.ts` / `policies.ts` / `fragments.ts`)→ 型エラーの 2 箇所 → 実行時分岐 → 断片 → 担当表 → テスト → README/SKILL」。
4. 前例 `git show --stat 99f5a93`(と `23fbd25`)を最終チェックリストとして突き合わせる。前例の和として残るのは 11 点: ①`roles.ts` ②`policies.ts` の 2 表(+必要なら `SOLO_DENIED_ROLES`) ③ja/en 断片 2 件 ④担当表 1 行(+必要なら本文) ⑤テスト 5 系統 ⑥プラグイン README(16→17・表・MCP 列挙・移行節) ⑦ルート README ⑧`setup-agents/SKILL.md` L260 ⑨`plugin.json`+`package.json` ⑩Serena `agent_policy/core.md` ⑪`pnpm run build` で `scripts/` 追随。
5. `MODELS.at(7)/at(8)` の位置依存アサーションは、今回を機にインデックス依存をやめる案を検討してよい(不採用でも設計書に理由を残す)。

## 11. 補足・暗黙知

- 担当表は 0.17 で 3 箇所から 1 箇所へ集約された経緯がある(`design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`)。**方針スキル 2 本に表を書き戻さない**こと。現在 `claude-model-policy/SKILL.md` は 12 行、`custom-policy/SKILL.md` は 29 行しかない。
- 「帯」という語は 0.17.1 で「役割」へ改められた。新規文書で「帯」を使わない。
- `RECOMMENDED` は setup-agents 専用の正本であり、方針スキルは推奨列を持たない(0.17 で廃止)。
- 移行節は「N 系から N+1 系へ移行する場合は」の形式で README L206 以降に**新しい順で**積む。役割追加時は 0.15→0.16 の節(L229-231)が文面の手本になる。

---

**次のステップ提案**:

- #1(Gemini の `owned_by` 実値)は実機確認が要る。これを先に潰さないと設計を確定できない。
- #2〜#5(`doc-writing` の kind / tools / Agent Tool 可否 / モデル割当 / 挿入位置)はオーケストレーターの要件確定が要る。
- #4 の答え次第で、この改修を 1 本の設計書にするか 2 本に割るかが決まる。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。*
