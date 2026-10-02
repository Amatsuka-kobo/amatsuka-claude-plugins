# codiel:run のコスト改修 残りの事項の引き継ぎ書

- 日付: 2026-10-03
- 引き継ぎ元: codiel:run のコスト改修のセッション(評価・設計・計画・実装・計測まで完了)
- 引き継ぎ先: 残りの事項を GitHub Issue に起票するセッション
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`、ブランチ `intent-driven-development`(PR は作らず、ブランチはそのまま残す。2026-10-03 ユーザー決定)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 承認済み。`harness-docs/design/2026-10-02-codiel-run-cost-design.md`(決定 K1〜K13、読み替え規則 W1〜W5)と付録 `2026-10-02-codiel-run-cost-findings.md` |
| 実装計画書 | 承認済み・Task 1〜11 完了。`harness-docs/plans/2026-10-02-codiel-run-cost-plan.md`(計測の結果は「Task 1 の結果」「Task 10 の結果」) |
| 実装 | 完了。HEAD `0746807`。lint・typecheck・test は通る |
| 受け入れ | 満たした。オーケストレーターの 1 ターンあたりのコンテキスト(中央値)の平均が −11.8%(基準はユーザー決定で合計から置き換えた。設計書 §7.3) |
| 残りの事項の起票 | 未着手。このセッションで行う |

## 決まったこと

設計書 §1 の K1〜K13 が正本である。再検討しない。起票の内容に関わる要点は次のとおり。

- codiel・metatron・gh-utility のバージョンは上げない(K5)。
- ARCHITECTURE と GOTCHAS は metatron の資産で、codiel の指示層に残すのはドメインマップの抽出と、review の委譲へ ARCHITECTURE のパスを渡すことだけである(K12)。失敗を GOTCHAS へ記録する手順(`failures.md`)は削除した。
- 委譲先だけが使うスキルの本文は、オーケストレーターが読まない(K13)。
- 受け入れの判定は 1 ターンあたりのコンテキストで行う。合計トークンは run のターン数(計測では 124〜156)に引きずられる。

## 起票する事項

計画書の「別の Issue にする事項」の 7 件と、計測で分かった 3 件である。

1. `gh pr create` が失敗したときの扱いと、worktree を作るコマンドの例(付録 A23・A24、設計書 §8.1)。
2. prompt-smith の再評価で出た充足度の欠落 S1〜S17。委譲先の異常終了・返答が空、`codiel-state init` の失敗、`pass-gate` の拒否、Raguel の不通など。改修前から無かった規則である。出典は会話記録(下の参照)の Task 9 の再評価。
3. K12 の `src/` 側の追随: `plugins/codiel/src/check-intent-env.ts` の `contextDocs` とコメントが ARCHITECTURE・GOTCHAS を含む。`plugins/codiel/src/hooks/guard-write.ts` の `unrecorded-gotchas.md` の免除が使われなくなった。
4. `harness-docs/ARCHITECTURE.md:403` の退避先の記述が古い(`/metatron:update` で直す)。
5. `phase-finalize.md` で `finalize` を呼んで run が `awaiting_outcome` になった後、ADR 候補と結果レポートの手順の間に compaction が起きると、読み直しの対象(`active`・`awaiting_human`)から外れる。
6. `facilitating-design-discussions` が `<plugin-root>` を使うのにプラグインルート参照規約を持たない。`initializing-harness` L198 が L49 と食い違う。
7. `reviewing-diffs` の description が本文(所見はテキストで返す)と食い違う。
8. K13 の残り: オーケストレーターが `scripting-tests` の返答の項目と `reviewing-diffs` の所見の書式を `sed` で読んでいる。自分の作業に要る部分なので、`orchestrating-runs` の手順ファイル(`phase-test-code.md`・`review-common.md`)へ写す。
9. 計測の道具 `tools/codiel_run_usage.py` の不具合: test-code より後のフェーズへの割り振りが崩れる run がある(合計は正しい)。Bash の `cat`・`sed` で読んだファイルを Read の一覧に数えない。
10. 次のコスト改修の候補: run のターン数を減らす(ASK の誤検知、委譲の待ちの間の往復)。指示書の削減は 1 ターンあたりの量にしか効かない。

## 進め方

- `gh-utility:issue-craft` を起動して起票する。複数の一括起票に対応している。
- まとめ方(1 件ずつか、関連するものを束ねるか)とラベルは、起票の前にユーザーと決める。
- 各 Issue の本文には、出典(設計書・計画書・付録のセクション、ファイル:行)を書く。

## 踏みやすい点

- 事項 2 の S1〜S17 の一覧は、計画書には要約しか無い。全文は会話記録にある。`chat-history:recall` で引くか、`orchestrating-runs`・`raguel-gating`・`reviewing-diffs`・`capturing-intent` に prompt-smith の評価をもう一度当てて取り直す。
- 計測の題材 `~/codiel-cost-bench` と、`scripts/reset-cost-bench.sh` は残してある。事項 10 の計測に使える。リセットには、取り消せない削除(追跡外のファイル、main 以外のブランチ、題材の Raguel の記録)が含まれる。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」を使わない。
- `docs/chat/` の未コミットの変更を、本件のコミットに混ぜない。

## スコープ外

- 起票した Issue への対応(実装)。
- 設計の決定 K1〜K13 の再検討。
- PR の作成とブランチの統合。

## 参照

- 設計書: `harness-docs/design/2026-10-02-codiel-run-cost-design.md`
- 付録(指摘 181 件): `harness-docs/design/2026-10-02-codiel-run-cost-findings.md`
- 実装計画書: `harness-docs/plans/2026-10-02-codiel-run-cost-plan.md`
- 会話記録: `docs/chat/2026/1002/phyllis998/0901-codiel-run-cost-optimization-scope.md`
- 計測の道具: `tools/codiel_run_usage.py`(`--self-check` あり)
