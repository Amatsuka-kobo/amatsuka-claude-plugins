# Codiel の run を速くする 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raguel の LLM パネルと重さ判定を撤去し、Jev の内容判定に置き換える。codiel のオーケストレーターが文書の執筆とコマンドの実行を自分で担うよう、スキルを改める。

**Architecture:** Raguel の判定は「ルール層 → Jev(鍵があるとき。文脈補正と内容判定を同じ 2 本の問い合わせで)→ 判例検索 → 4 行の合成」になる。MCP ツールの名前と入力は変えない。codiel 側の変更はスキルの文書だけで、`src/` は変えない。

**Tech Stack:** TypeScript(ESM)、zod、`@typesafe-ai/sdk` 0.6.0、vitest、esbuild、pnpm workspace

**Spec:** `harness-docs/design/2026-10-01-codiel-run-speedup-design.md`(承認済み。以下「設計書」)と ADR-012。以下 `R/` は `plugins/codiel/raguel-mcp/src/`、`ORS` は `plugins/codiel/skills/orchestrating-runs/SKILL.md` を指す。

## Global Constraints

- codiel のバージョンは `1.0.0-dev` のまま上げない。raguel-mcp だけを `0.0.2-dev` から `1.0.0-dev` に上げる(ユーザー決定)。`plugins/codiel/raguel-mcp/package.json:3` を Task 1 のコミットで変え、`pnpm run build` で `dist/server.mjs` が名乗るバージョンも作り直す。
- `plugins/*/scripts/` と `raguel-mcp/dist/` は手で編集しない。`src/` を変えて `pnpm run build` で再生成し、同じコミットに含める。
- `skills/**/SKILL.md`・`references/**/*.md`・`.serena/memories/` を編集する前に `prompt-smith:prompt-smith` を起動し、その規律に従う。`.serena/memories/` は Serena の `edit_memory` / `write_memory` で変える。
- TypeScript と Markdown の編集は Serena の編集ツールで行う。
- 規律の文言に「段」「版」を使わない。手順の項目は「ステップ N」と書く。
- Done の条件は `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` が通り、`pnpm run build` の差分が同じコミットにあること。raguel-mcp のテストと型検査もルートのコマンドで走る(`tsconfig.json:20-21`、`vitest.config.ts` の include)。

## 細目の決定(設計書が計画書に委ねたもの)

| 項目 | 決定 |
| --- | --- |
| 応答から外すフィールド | `EvaluationResult.weightTier`(`R/core/types.ts:129`)と `meta`(:136)。verdict.json の `weightTier`(:281)と `meta`(:284)も書かない。`degradedReasons` は残す |
| `contextJudge` の応答 | 設定の `ContextJudgeSettings.enabled`(`R/context/judge.ts:25`)は撤去する。応答の `ContextJudgeSummary.enabled`(`R/core/types.ts:109-113`)は残し、鍵の有無を表す。`status` から `off` を外し、鍵が無いときは `unavailable` にする。`ContextJudgeStatus`(`R/context/judge.ts:74-78`)を直す |
| 撤去したキーの警告 | 読み込みの結果(`R/config/loader.ts:104` の戻り値)に `retiredKeys: string[]` を足す。パイプラインは評価のたびに、空でなければ取り除いたキーをすべて 1 つの message に並べて `reasons` に 1 件足す。キーが残る間は毎回出し、利用者に削除を促す。`rules.common/resubmission-loop.stopAfter` は今どおり読み込みエラーのままにする |
| `contextJudge.timeoutMs` の上限 | `R/core/invariants.ts:21` の `MAX_DEADLINE_MS`(600000)を上限として残す。`judge.deadlineMs` との比較だけを外す |
| 鍵が無いときの所見 | `contextJudge/unavailable`(info)の message を「TYPESAFE_API_KEY が無いため、Jev による内容の判定と文脈の補正をしていない」にする |
| test-spec の再開 | dev-plan が passed で test-spec が passed でなければ、同定の一覧で spec の委譲を出す(一覧が手元に無ければ同定し直す)。どちらも passed でなければ、同定からやり直す |
| 較正の割合 | 問いごとに、分母はその問いを当てた成果物の件数(kind と phase が合うもの)、分子は ASK になった件数とする。10% 以下の問いは変えない |
| 書かなくなるケースファイル | `02-weight.json`・`03-adversarial.md`・`04-steelman.md`・`05-crosscheck.md`・`08-meta.md`。`EVIDENCE_FILES`(`R/casefile/store.ts:41-55`)からは消さない |
| 撤去した設定キー | `judge`・`weight`・`panel` の全体と `contextJudge.enabled`。`R/config/schema.ts` の `strictObject` から外し、`R/config/loader.ts` で読み込み前に取り除いて警告を 1 件残す。今の `ABOLISHED_KEYS`(:32-44)の `judge.canStop`・`panel.<tier>` はこの扱いに吸収する |
| 判例の文面 | `R/tools/recordOutcome.ts:171` の `weightTier` を文面から外す |
| 前フェーズの meta | `R/core/pipeline.ts:630` の `meta?.rationale` の利用をやめる |
| `panel/*-error` の正規表現 | `R/precedent/store.ts:27-29` は残す。過去の判例の `firedRules` に残るため |
| 旧称の書き換え先 | 作業内容で表す。`writing-dev-plans/SKILL.md:19-20` の「implementer(frontend/backend/data)」はドメイン別の実装の委譲先として書き換え、ドメインの区分は残す |
| 較正の道具 | 一時スクリプトとして `/tmp` に置き、`tsx` で `R/context/judge.ts` の問い合わせの組み立てと `R/context/jev.ts` の呼び出しを直接使う。リポジトリには入れない |

## Review Focus

次の 5 点は、テストが直接は確かめない。レビューの依頼文に含める。

1. 鍵が無い利用者の run で、パネルの撤去後に ASK・STOP の件数が増えないこと。増えうるのは引き下げ規則の外の `code/destructive-ops` の STOP だけ(設計書 S3)。
2. `contextJudge.status` の `off` を消したとき、codiel 側に `off` を読む箇所が無いこと(`plugins/codiel/src/raguel-records.ts` は `judgeStatus` だけを読む)。
3. 撤去したキーを持つ利用者の `.codiel/config.json` で、Raguel が起動し、警告が 1 件だけ出ること。
4. スキルの改訂で、委譲を続ける作業(spec.md / cases.md、テストコード、実装、レビュー、E2E)まで「オーケストレーターが行う」と読める文になっていないこと。
5. HARD-GATE の書き直し後も、オーケストレーターがコード・テストコード・レビューの所見を書かない制約が残っていること。

---

### Task 1: Raguel からパネル・重さ判定・judge 設定を撤去し、合成を 4 行にする

役割: 複雑または重要な実装。テストの共通基盤・型・合成・設定・パイプラインが互いに依存し、分けると中間の状態で型検査が通らない。

**Files:**
- Delete: `R/panel/`(テストとヘルパーを含む)、`R/core/weight.ts`、`R/core/__test__/weight.test.ts`、`R/testing/fake-claude.mjs`、`R/testing/fake-codex.mjs`
- Modify: `R/core/types.ts`(:2, 26, 34-40, 43, 67, 127-141, 203, 281-284, 310, 317, 328, 344-367)
- Modify: `R/core/verdict.ts`、`R/core/invariants.ts:21, 164-177`、`R/core/pipeline.ts`(:30, 34-36, 82, 112, 117, 237, 385-386, 422, 458-514, 519, 575, 630, 886-895, 1035-1041, 1068-1075, 1109-1117, 1128-1138, 1157, 1193-1201, 1253-1258, 1279-1281)
- Modify: `R/config/schema.ts`、`R/config/defaults.ts:17-37, 57-80`、`R/config/loader.ts:32-44, 148-157`
- Modify: `R/server.ts:12-14, 32-49`、`R/tools/shared.ts:19, 125-129`、`R/tools/listRules.ts:4, 7, 21, 60 付近(e2eReports の文言の「重さ・パネル」), 67-73, 85-87`、`R/tools/recordOutcome.ts:171`- Modify: `R/context/judge.ts`(enabled の判定 :25, 374-380、severity の問い :261-265、`WEIGHT_ID` :122、tierFloor :108, 115, 447, 551-554, 570, 574)
- Modify(テスト): `R/rules/testHelpers.ts:32, 41`、`R/tools/__test__/helpers/harness.ts`、`R/tools/__test__/tools.test.ts`、`R/core/__test__/verdict.test.ts`、`R/core/__test__/invariants.test.ts:251-270`、`R/core/__test__/pipeline.golden.test.ts`、`R/config/__test__/loader.test.ts`、`R/context/__test__/judge.test.ts`、`R/casefile/__test__/store.test.ts:54`

- [ ] ステップ 1: テストの共通基盤を Jev の差し替え(`PipelineDeps.jevCall`)だけで動く形に直す(`harness.ts`・`rules/testHelpers.ts`)。
- [ ] ステップ 2: 設定から `judge`・`weight`・`panel`・`contextJudge.enabled` を撤去し、残っていたら取り除いて警告を 1 件残す。loader のテストに、撤去したキーを持つ設定が読めて警告が 1 件出るケースを足す。
- [ ] ステップ 3: 合成を設計書 §4.5 の 4 行にする。verdict のテストを 4 行と `rule-error` が通常の ASK になるケースに置き換える。
- [ ] ステップ 4: パイプラインから重さ判定・パネル・締切を外し、判例検索をルールの stop が無いとき毎回行う。応答と verdict.json から `weightTier`・`meta` を外す。
- [ ] ステップ 5: 文脈判定の有効化を鍵の有無だけにし、severity の問い(本文の問い合わせから削除する)と tierFloor を外す。`status` の `off` を `unavailable` に置き換える。
- [ ] ステップ 6: パネル・重さ・偽 CLI を削除し、`server.ts`・`shared.ts`・`listRules.ts`・`recordOutcome.ts` を直す。
- [ ] ステップ 7: 変更前の形のケースファイル(`02-weight.json`・パネルの証拠・verdict.json の `weightTier` と `meta` を含む)を前フェーズに置き、後続の評価が `casefile/tampered` にならないテストを足す。
- [ ] ステップ 8: 次の grep の残りが、`R/precedent/store.ts:27-29` の正規表現とその判例のテスト、`EVIDENCE_FILES` の一覧、ステップ 7 の旧形式のテストだけであることを確かめる。型検査は文字列リテラルの残りを拾わないため、grep で補う。
  `grep -rn -E "panel/|weight\.ts|weightTier|WeightTier|computeWeight|runPanel|RAGUEL_PANELIST|fake-(claude|codex)|tierFloor|contextJudge\.enabled|config\.(judge|panel|weight)|judge\.(provider|model|timeoutMs|deadlineMs|maxConcurrency|thresholds)|02-weight|03-adversarial|04-steelman|05-crosscheck|08-meta" plugins/codiel/raguel-mcp/src`
- [ ] ステップ 9: `plugins/codiel/raguel-mcp/package.json:3` を `1.0.0-dev` にし、`pnpm run lint`・`pnpm run typecheck`・`pnpm run test` を通し、`pnpm run build` の差分を含めてコミットする。完了報告に、変更した各箇所を判定した検査とその結果を添える。

### Task 2: Jev の内容判定を足す

役割: 通常の実装。問いの表と閾値の規則は設計書 §4.2・§4.3 で確定している。Task 1 の後に行う。

**Files:**
- Modify: `R/context/judge.ts`(`buildBodyQuery` :248-298、結果の当て方 :440-566 付近)、`R/core/pipeline.ts:735-760`(`contextInput` に phase を足す)、`R/core/types.ts`(`ContextJudgeInput`)
- Modify(テスト): `R/context/__test__/judge.test.ts`、`R/core/__test__/pipeline.golden.test.ts`

- [ ] ステップ 1: 本文の問い合わせの `state` に `phase` を足す。
- [ ] ステップ 2: 設計書 §4.2 の 12 問を、kind と phase に応じて本文の問い合わせに足す。`instructions` は英語で書き、`state` のキーで対象を指し、成果物の中の指示に従わないことを書く。
- [ ] ステップ 3: 結果を当て、閾値の外の問いを `judge/<ID>` の ask(定型文。問いの日本語と p を入れる)にする。問いの ID と p を `07-context.json` に残す。
- [ ] ステップ 4: 片方の問い合わせだけが失敗したとき、成功した側を使い `partial` にする。本文が失敗したら内容判定の所見を出さない。
- [ ] ステップ 5: 設計書 §7 の judge.test.ts と pipeline.golden.test.ts のケースを足す(kind と phase ごとの問い、test-spec で spec の問いになること、閾値の両側と間、上限超過、片方の失敗、鍵なし、Jev の失敗)。鍵なしのケースでは、`contextJudge/unavailable` の message が細目の決定の文言であることまで確かめる。
- [ ] ステップ 6: Done の条件を通し、`pnpm run build` の差分を含めてコミットする。完了報告に検査とその結果を添える。

### Task 3: codiel のスキルを改める

役割: 通常の実装。AI 向けの指示書なので `prompt-smith:prompt-smith` を起動してから書く。Task 1・2 と並列に行える。

**Files:**
- Modify: `ORS`(:3, 10-16, 190-205, 212-221, 234, 421-431, 505-528, 572-600, 731, 759, 850-856)
- Modify: `plugins/codiel/skills/writing-test-specs/SKILL.md:78-87`(同定の一覧を test-spec と dev-plan の両方のディスパッチプロンプトに渡す記述)
- Modify: `plugins/codiel/skills/` の `preparing-design-agendas`(:3, 7-9, 111)、`facilitating-design-discussions`(:11, 24, 31, 43, 58, 62, 68, 77)、`writing-design-docs`(:3, 6, 132)、`writing-dev-plans`(:3, 6, 19-20, 167)、`syncing-intents`(:3, 6, 12 付近)、`running-regression-tests`(:3, 6, 40-62)、`fixing-review-findings`(:10, 50, 62, 66, 76-80, 111, 129, 137)、`implementing`(:119, 129, 145)、`filing-followup-issues`(:10)、`reviewing-diffs`(:124)、`raguel-gating`(:39, 105, 147, 149, 159, 259)、`initializing-harness`(:94 と鍵の案内)の各 SKILL.md

- [ ] ステップ 1: 実行者を示す記述(description と、誰が書くか・誰が実行するかを述べる文)を、設計書 §5.1・§5.2 の線引きに合わせて書き換える。このステップでは手順・規律・出力の形を変えない。手順を変えるのはステップ 2 と 3 だけである。
- [ ] ステップ 2: test-spec の順序を設計書 §5.3 の 3 ステップにする。`ORS:212-221` の同時に出す手順と再開の分岐を、細目の決定「test-spec の再開」に書き換える。`writing-test-specs/SKILL.md:78-87` の「両方のディスパッチプロンプトに渡す」を、spec の委譲にだけ渡し、dev-plan はオーケストレーターが同じ一覧を使って書く形に直す。`ORS:597-600` の「委譲はすべて前景で出す」は変えない。
- [ ] ステップ 3: HARD-GATE を設計書 §5.4 の内容に書き直す。
- [ ] ステップ 4: 旧称(architect・implementer・tester・reviewer・reviewer-doc)を作業内容の表現に直し、`[8] fix-loop`・`[9] triage` を `ORS:182-187` の番号に直す。
- [ ] ステップ 5: raguel-gating のパネル・crosscheck・meta・重さ判定・パネリストの失敗への言及を外し、`degradedReasons` の説明をパイプラインの例外に合わせる。
- [ ] ステップ 6: initializing-harness に、`TYPESAFE_API_KEY` が無いとき Raguel が内容を判定しないことと鍵の設定方法を伝える記述を足す。設定の有無で初期化を止めない。`:94` の廃止キーの注意を、撤去したキーは警告で無視される旨に直す。
- [ ] ステップ 7: `grep -rn -E "architect|implementer|tester|reviewer|crosscheck|パネル|weight tier|重さ判定|両方のディスパッチ|同じ応答で" plugins/codiel/skills` の残りが、意図して残したもの(手順上の語として必要なもの)だけであることを確かめ、残した理由を完了報告に書く。
- [ ] ステップ 8: コミットする。

### Task 4: 文書・メモリを追随させる

役割: 軽量な実装と、オーケストレーター自身の作業(メモリ)。Task 1〜3 の後に行う。

**Files:**
- Modify: `plugins/codiel/README.md:195-229, 256`、`README.md:50, 68-78`、`plugins/codiel/raguel-mcp/docs/DESIGN.md`(:33, 218-269, 297-323, 336, 450-473)
- Modify: `plugins/codiel/docs/raguel-contract.md:39, 131`、`plugins/codiel/src/__test__/raguel-records.test.ts:310-313`(フィクスチャの verdict.json の形)、`plugins/codiel/docs/DESIGN.md:46-53, 70`(architect・implementer・reviewer の名指し)
- Modify(Serena): `codiel/raguel_mcp`(:23-26, 53-54)、`codiel/core`(:99, 135-141)、`core`(:148)

- [ ] ステップ 1: codiel の README を、Jev を推奨依存とし、鍵が無いときはルールだけで判定する書き方に改める。codex のパネルの外部送信と、パネル前提の所要時間・120 秒後の background の案内を直す。
- [ ] ステップ 2: ルートの README の codiel のセクションを同じ内容に合わせる。
- [ ] ステップ 3: `raguel-mcp/docs/DESIGN.md` のパネル・重さの記述を、設計書と ADR-012 への参照に置き換える。
- [ ] ステップ 4: `plugins/codiel/docs/format-change-checklist.md:34-45`(記録の形を変えたとき)の項目をすべて追随させる。契約文書 `raguel-contract.md` の既知ファイル名(:39)は「撤去したファイル名は新しい評価では書かないが、改竄の検査では既知として扱う」と書き、verdict.json の表(:131)から `weightTier` と `meta` を外す。2 者比較テストのフィクスチャを新しい形に直す。codiel の `docs/DESIGN.md` の名指しを作業内容の表現に直す。
- [ ] ステップ 5: オーケストレーターが Serena のメモリ 3 件を、パネルの撤去と委譲の線引きに合わせて直す。ほかの候補(`conventions`・`tech_stack`・`suggested_commands`・`chat_history/core`・`jevriel/core`・`agent_policy/core`)は該当箇所を読んで、食い違うものだけ直す。
- [ ] ステップ 6: Done の条件を通してコミットする。

### Task 5: レビュー

役割: コードレビューと、重要な実装の最終レビュー。Task 1〜4 の後に行う。

- [ ] ステップ 1: Task 1・2 の diff を、コードレビューと重要な実装の最終レビューへ並列に出す。依頼文に Review Focus の 1〜3 を入れる。
- [ ] ステップ 2: Task 3 の diff を、コードレビューへ出す。依頼文に Review Focus の 4・5 を入れる。
- [ ] ステップ 3: 指摘の採否をオーケストレーターが決め、採った指摘を元の担当へ差し戻す。

### Task 6: 内容判定の較正(オーケストレーター)

`TYPESAFE_API_KEY` がある環境で行う。Task 2 の後、手動確認の前に行う。

- [ ] ステップ 1: `~/.raguel` のケースファイルのうち、PROCEED になった評価と、人が approved と裁定した評価の `submission.txt` と subject.json(kind・phase・objective)を集める。
- [ ] ステップ 2: `/tmp` の一時スクリプトで、各成果物に Task 2 の本文の問い合わせを当て、問いごとに ASK になった件数と割合を数える。
- [ ] ステップ 3: 割合が 10% を超える問いを挙げ、閾値を問いごとに変えるか問いを外すかをユーザーに示して決める。
- [ ] ステップ 4: 決めた変更を `R/context/judge.ts` に反映し(委譲先は Task 2 と同じ役割)、設計書 §4.2 に書き戻してコミットする。

### Task 7: 新しいセッションでの手動確認(ユーザーと行う)

- [ ] ステップ 1: 変更前に通したフェーズがある run を再開し、後続のゲートが `casefile/tampered` にならないことを確かめる。
- [ ] ステップ 2: 1 回の run で、design・dev-plan・intent-sync をオーケストレーターが書くこと、test-spec で dev-plan のゲートの後に spec の委譲を前景で出すことを確かめる。
- [ ] ステップ 3: implement のマージの後と test-loop で、`units/` と test コマンドを自分で、`e2e/` を委譲で実行することを確かめる。
- [ ] ステップ 4: ゲート 1 回あたりの所要時間を、`~/.raguel` の変更前の評価(同じ kind)の所要時間と比べる。所要時間は各評価の記録の時刻から取る。
- [ ] ステップ 5: 結果を、この計画書の末尾に「手動確認の結果」として書く。

## コミットの分け方

| コミット | 内容 |
| --- | --- |
| 1 | Task 1(raguel-mcp の src・テスト・dist・`package.json` のバージョン) |
| 2 | Task 2(raguel-mcp の src・テスト・dist) |
| 3 | Task 3(codiel のスキル) |
| 4 | Task 4(README・DESIGN.md 2 本・契約文書・2 者比較テストのフィクスチャ) |
| 5 | Task 6 の較正の反映と設計書の書き戻し |
| 6 | Task 7 の結果 |

`.serena/memories/` の変更は、Task 4 のコミットに含める。

## 既知のリスク

- 鍵がある利用者は、Task 2 のコミットから Jev の内容判定が既定で動く(今の `contextJudge.enabled` の既定は `false`)。内容判定の誤検知の ASK は、Task 6 の較正で抑える。較正が済むまでは、このリポジトリで run を回さない。

## 未決事項

1. 較正で閾値を問いごとに変えるとき、設定キーにせず `R/context/judge.ts` の定数にする(設計書 S4 の「設定で問いを足さない」に合わせる)。この扱いは Task 6 のステップ 3 でユーザーに確かめる。
