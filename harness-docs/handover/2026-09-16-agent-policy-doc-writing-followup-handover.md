# agent-policy 0.19 doc-writing 追加分 未解決事項の後始末 引き継ぎ書

- 日付: 2026-09-16
- 引き継ぎ元: doc-writing 役割・gemini ベンダー追加の実装セッション(実装完了・コミット済み)
- 引き継ぎ先: 未解決事項の後始末セッション(A〜C は実装まで、D は設計書の承認まで)
- 対象プラグイン: `plugins/agent-policy`(0.19.0-dev)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 役割 doc-writing・ベンダー gemini・Agent Tool 役割限定判定・再委譲規律(D1/F1)の実装 | **完了**。`a721770` / `2650e55` / `0f9c3a0` / `58f3cfd`(main) |
| lint / typecheck / test | **パス**(test 2254 件) |
| Agent 定義再生成 | **完了**。`.claude/agents/` は gitignore(`.gitignore:14`)対象で差分はコミットに出ない。`document-writer`(gemini-flash / doc-writing 単独 / MCP serena)を新設、既存 13 件を再生成 |
| 設計書 §10 の未解決事項 10 件 | **4 件が対象(A〜D)、6 件は対象外**(運用観測待ち 3 件、決着済み 2 件、CLI 変更を伴い別起票 1 件。内訳は本書「スコープ外」) |

**補足事実**: `document-writer`(gemini-flash)は 2026-09-16 の初運用で API 429(quota)により失敗した。プロキシ側の Gemini quota に依存する。失敗時の読み替え先は担当表の Claude モデル(Sonnet)。

**この文書だけを読んで作業を再開できるように書いてある。**設計書は §10 と §4.13 だけ参照すればよい。

## 次セッションが最初にやること

1. `git status` と HEAD を確認する。作業ツリーに本件と無関係な未コミット変更がある可能性がある。**触らない**(revert・削除・上書き・コミット混入すべて禁止)。
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` で baseline を再現する。
3. A・B・C は独立作業なので並列にディスパッチしてよい。D は設計書を書いてからユーザー承認を得て実装する(§3「進め方の規律」)。
4. 完了したら Done の条件(§3)をすべて満たしているか確認し、A / B / C / D を分けてコミットする。

---

## 1. 作業の目的

agent-policy 0.19.0-dev で役割 `doc-writing`(文書作成)・ベンダー `gemini`・ModelId `gemini-flash`・Agent Tool の役割限定判定・再委譲規律(D1 サブエージェント向け / F1 オーケストレーター向け)を追加し、コミット済み(`a721770` / `2650e55` / `0f9c3a0` / `58f3cfd`、2026-09-16、main)。設計書 `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md` §10 に未解決事項 10 項が残っており、うちスコープ外として見送った 4 項の対応が次セッションの目的である。運用観測待ちの項は対象外。

---

## 2. 未解決事項の対応(4 件・優先順)

### A. `ComposeInput.modelId` / `Target.composeModelId` の死んだ配管の除去(設計書 §10-6、§4.13)

- **事実**: `allowsAgentTool(ids)` から model 引数はすでに削除済みである。一方で次の 4 箇所が残っている。
  - `plugins/agent-policy/src/agents/compose.ts:16` の `modelId?: ModelId`(コメント「Agent の可否には使わない」)
  - `plugins/agent-policy/src/setup-agents.ts:65` の `composeModelId?: ModelId`
  - 同ファイル `:314` と `:354` での代入
  - 同ファイル `:374` での `modelId: target.composeModelId` として compose へ渡す箇所
  - compose 内部で `input.modelId` を読む箇所は存在しない。型検査・lint(biome recommended、`noUnusedLocals` 無し)では検出されない。
- **作業**: 上記 4 箇所を削除する。`compose.test.ts` の `build(..., { modelId })` を使うヘルパーと `buildWithoutModelId` を整理する(modelId を渡す意味が無くなるため、ヘルパー引数から外すか、テスト名を直す)。`setup-agents.test.ts` に `composeModelId` への依存があれば追随する。
- **注意**: `Target.modelId: ModelId`(`setup-agents.ts:64`)は別物(推奨モデル ID の識別)であり、消さない。

### B. `subagent-start.test.ts` の陳腐化した fixture(設計書 §10-2)

- **事実**: `plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts:21-36` の `ROLE_IDS` は 14 件しかなく、`design-plan` / `explore-lead` / `doc-writing` が欠けている(現行の役割は 17 件)。`placeBulkyRoleTable`(同ファイル `:65-71`)はこの 14 役割 × 8 定義で対応表のサイズ上限を検査する fixture であり、件数検査そのものではないため今のところテストは落ちていない。
- **作業**: `ROLES` から導出する(`ROLES.map(r => r.id)`)か、17 件に手で揃える。**導出が望ましい**(次に役割を追加したときに再び陳腐化するのを防ぐため)。サイズ上限の検査値が 14 × 8 を前提にしているなら、17 × 8 でも同じ検査意図で通ることを確認する。

### C. `docs/development/cliproxyapi-setup.md` の Gemini 追随(設計書 §10-1)

- **事実**: 現行の手順書は Codex / xAI / Claude の OAuth のみを扱う(`:3`、`:10`、`:66-70`、`:72-105`、`:135`)。`cliproxyapi.config.example.yaml`(`:10-14`)には `antigravity` プロバイダの alias(`claude-gemini-3-8-flash`、`claude-gemini-3-1-pro`)が既にあり、`/v1/models` は `owned_by: antigravity` として返す(2026-09-16 実測)。
- **作業**: 「この手順でできること」「先に確認すること」「2. プロジェクト用の設定」に alias の説明を加え、「3. OAuth を認証する」に antigravity(Gemini)の節を追加し、「4.」の確認項目に Gemini を加える。**ログインコマンド名は CLIProxyAPI のドキュメント(Context7 または WebSearch)で確認する。推測で書かない。**
- **補足**: `docs/` 配下の人間向け手順書であり、prompt-smith の対象外。文体は既存の手順書に倣う。

### D. en 生成定義が日本語ラベルの対応表を照合できない既存の欠陥(設計書 §10-9)

- **事実**: SubagentStart が注入する対応表の各行は `- ${roleById(role).label}: ${names}`(`plugins/agent-policy/src/hooks/marker-scan.ts:220-229`)で、label は `roles.ts` の日本語である。一方 `en/_common.md` は `"Document Authoring"` や "design, planning, and implementation advisor" のように英語で書かれているため、`--lang en` で生成した定義は対応表と突き合わせられない。日本語ラベルを併記する案は `compose.test.ts:616`(英語出力への日本語混入を禁じる検査)と衝突するため不採用である。
- **作業**: まず設計判断を行う。候補は次の 3 つ。
  - (a) 対応表の各行に RoleId を併記する(`- 文書作成 [doc-writing]: names`)。`_common.md` は両言語で RoleId を参照する形にする。
  - (b) 対応表を生成言語ごとに切り替える。ただしフックは会話言語を知らないため難しい(README `:158` に既知の限界の記述がある)。
  - (c) 現状を維持し、README に限界を明記するだけにとどめる。
  - (a) が有力な案だが、**設計書を起こしてユーザーの承認を得てから実装する**。`marker-scan.test.ts` / `session-start.test.ts` / `subagent-start.test.ts` の対応表の文言検査、および共通規律の「役割マーカーの対応表」を参照する条項との整合を確認する。

---

## 3. 進め方の規律

- A・B・C は独立している。並列にディスパッチしてよい。D は 設計 → レビュー → 承認 → 実装 の順で進める(担当表: design-plan → doc-review → independent-review → ユーザー承認)。
- 文書(C の手順書、D の設計書)の執筆はオーケストレーターが自分で書かず「文書作成」役へ委譲する(共通規律 F1)。内容の確定はオーケストレーターが行う。`document-writer` が 429 で使えないときは担当表の Claude モデル(Sonnet)へ読み替える。
- **Done の条件**:
  - lint / typecheck / test がすべて通る。
  - `src/` を変更したなら `pnpm run build` を実行し、`scripts/` の差分を同じコミットに含める。
  - バージョンは `0.19.0-dev` → `0.19.1-dev` を A・B・D の実装で 1 回上げる(C は文書のみのため対象外)。
  - D で挙動が変わる場合は README を追随させる。
  - D の場合は Serena メモリ `agent_policy/core` を追随させる。
  - A / B / C / D は別コミットに分ける。
- **制約**: ブランチを切らない。`git push` に `--force` 系を付けない。`scripts/` を手で編集しない。`.claude/agents/` は gitignore 対象であり再生成してもコミットに出ない。`ARCHITECTURE.md` / `GOTCHAS.md` / `.claude/rules/metatron/` は直接編集せず metatron の CLI を使う。

---

## 4. スコープ外

設計書 §10 のうち次の 6 件は対象外である。

- **運用観測待ち(3 件)**: §10-4(doc-writing が実際に呼ばれるか)、§10-5(gemini-flash / gpt-terra の日本語品質)、§10-8(light-impl / Haiku への再委譲の妥当性)。
- **決着済み(2 件)**: §10-3・§10-7(定義は `document-writer` 1 件とし、sonnet / gpt-terra 用の定義は作らない)。
- **別起票(1 件)**: §10-10(setup-agents の兼務検出)は CLI 変更を伴うため、本件とは別に起票する。

---

## 5. 参照(次セッションが開くもの)

- 設計書: `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md` §4.13 / §10 / §5.11c
- 計画書: `harness-docs/plans/2026-09-16-agent-policy-doc-writing-role-plan.md` §7(実装との食い違い 4 件の記録)
- コード: `plugins/agent-policy/src/agents/compose.ts`、`src/setup-agents.ts`、`src/hooks/marker-scan.ts`、`src/hooks/__test__/subagent-start.test.ts`、`src/agents/__test__/compose.test.ts`
- 文書: `docs/development/cliproxyapi-setup.md`、`cliproxyapi.config.example.yaml`
- Serena メモリ: `agent_policy/core`(0.19 の記述あり)
