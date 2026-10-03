# codiel の run の構造に関わる残りの改修 引き継ぎ書

- 日付: 2026-10-03
- 引き継ぎ元: codiel:run のコスト改修の残りの改修のセッション(ADR-013 まで完了)
- 引き継ぎ先: codiel の run の構造を改修するセッション
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`、ブランチ `intent-driven-development`。PR は作らない

## 現在地

| 工程 | 状態 |
| --- | --- |
| ADR 候補と GOTCHAS 候補の扱い | 完了(ADR-013、コミット `4a7eddc`・`6a6679c` ほか) |
| 下の 5 件 | 未着手。1 と 2 は検討から始める |

## 決まったこと

再検討しない。

- codiel は ADR と GOTCHAS を直接記録せず、候補を出して metatron に渡す(ADR-013)。
- 候補はどちらの `knowledgeTarget` でも try のローカルレポートに書く。`intents` のときは intent-sync と finalize で持続層へ写す(`plugins/codiel/skills/orchestrating-runs/references/adr-candidates.md`・`gotcha-candidates.md`)。
- 前の try の未写しの ADR 候補は、写す前に人に確かめる。GOTCHAS 候補は確かめずに持ち越す。
- review の委譲へ ARCHITECTURE のパスを渡す規則は残す(doc 観点がファイルの存在を知る必要があるため)。
- バージョンは上げない。この改修は codiel の 1.0.0 のリリースに含める。

## 改修する 5 件

### 1. try ごとのブランチの 1 本化を検討する

- 今は try ごとに `codiel/<slug>-try-<n>` のブランチを作り、新しい try はベースブランチから作る(`plugins/codiel/src/codiel-state.ts` の `init`、`capturing-intent` の手順 1)。
- 理由は、STOP を受けた前の try の成果物を、新しい try のゲートを通さずに持ち込まないためである(`orchestrating-runs` §1)。
- 困っている点: stop で止めた try のブランチに載せたコミット(候補の写しなど)は、ベースにも次の try にも届かない。このため候補の写しを intent-sync と finalize に寄せた。
- 論点:
  - 前の try の成果物の持ち込み規則と、ADR-006・ADR-009 の run の構造
  - `codiel-state` の `init`・`branch`、outcome の同期の判定(`merge-base --is-ancestor <branch> <baseBranch>`)
  - 1 本化したときの、STOP を受けた成果物の扱い
- run の構造を変える判断になる。案を添えてユーザーに確かめ、決まったら ADR を `metatron:updating-architecture` で足す。

### 2. incident の候補の持続層への写し(保留)

- `record_outcome(incident)` は、run がマージ済みか却下済みになった後の outcome の同期で起きる。今は候補を try の手元の記録に書き、同期の報告に一覧するだけで、持続層へ写さない(`raguel-gating/references/outcome-sync.md`)。
- どのブランチの領域ファイルへ書くかが決まらない。1 と同じ問題から決まるので、1 の後に決める。

### 3. ARCHITECTURE はあるが metatron が無いときの `knowledgeTarget`

- `knowledgeTarget` は、metatron が入っているかではなく ARCHITECTURE のファイルがあるかで決まる(`orchestrating-runs` §0)。
- 手で ARCHITECTURE を書いたプロジェクトでは `metatron` になり、候補は git に載らないローカルレポートと結果レポートにしか残らない。台帳へ移す担い手もいない。
- 判定を変えるかを検討する。

### 4. 依頼文テンプレートの「ドメインマップ」の行を消す(metatron の改修の後)

- metatron の SubagentStart の注入(metatron の引き継ぎ書 `2026-10-03-metatron-recording-timing-and-subagent-injection-handover.md` の改修 3)が入ると、ARCHITECTURE の本文(ドメインマップを含む)がサブエージェントに届く。
- そのとき、`orchestrating-runs` §3 の依頼文テンプレートの「ドメインマップ」の行(JSON の全文)は二重になるので消す。
- metatron が無いプロジェクト(ADR-003。codiel は metatron が無くても動く)で、委譲先にドメインマップをどう渡すかを決めてから消す。
- metatron の改修が終わるまで着手しない。

### 5. review の観点ごとにテスト・型検査が並列に走る

- `reviewing-diffs` の手順 6 は、観点ごとの委譲先(最大 7 つ)がそれぞれテスト・型検査を実行する。読み取りだけの委譲にはテストの並べ方の規則が当たらない(`orchestrating-runs/references/delegation-env.md`)。
- 資源の取り合い(ポート・生成物)と、E2E を含むときの扱いが決まっていない。
- 案: 実行してよいテストを絞る。オーケストレーターが 1 回実行して結果を依頼文に渡す。改修前からある問題である。

## 踏みやすい点

- `plugins/codiel/scripts/` は手で編集しない。`src/` を変えて `pnpm run build` を実行し、差分を同じコミットに入れる。
- 指示書は `prompt-smith:prompt-smith` の規律で書く。`orchestrating-runs/SKILL.md` の §2.1・§2.4 は他のスキルから番号で参照されているので、番号を変えない。
- `orchestrating-runs` §0 の分岐表の行番号は、本文と `references/resume.md` が参照している。行を足したら参照を合わせる。
- `plugins/metatron/src/__test__/section-reference-inventory.test.ts` が落ちたら、登録簿を合わせる。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」「契機」(条件や時点の意味のとき)を使わない。

## 参照

- ADR-003・ADR-006・ADR-009・ADR-013
- 設計書: `harness-docs/design/2026-10-02-codiel-run-cost-design.md`(§1 の K12)
- 実装計画書: `harness-docs/plans/2026-10-02-codiel-run-cost-plan.md`(「別の Issue にする事項」)
