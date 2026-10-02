# codiel:run のコスト改修 残りの改修の引き継ぎ書

- 日付: 2026-10-03
- 引き継ぎ元: codiel:run のコスト改修のセッション(評価・設計・計画・実装・計測まで完了)
- 引き継ぎ先: 残りの 9 件を改修するセッション(Issue は起票しない。2026-10-03 ユーザー決定)
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`、ブランチ `intent-driven-development`(PR は作らず、ブランチはそのまま。2026-10-03 ユーザー決定)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 承認済み。`harness-docs/design/2026-10-02-codiel-run-cost-design.md`(決定 K1〜K13、読み替え規則 W1〜W5)と付録 `2026-10-02-codiel-run-cost-findings.md` |
| 実装計画書 | 承認済み・Task 1〜11 完了。`harness-docs/plans/2026-10-02-codiel-run-cost-plan.md` |
| 本体の改修 | 完了。lint・typecheck・test は通る。受け入れは 1 ターンあたりのコンテキストで −11.8%(設計書 §7.3) |
| 残りの改修 | 未着手。下の 9 件をこのセッションで行う |

## 決まったこと

設計書 §1 の K1〜K13 が正本である。再検討しない。残りの改修に関わる要点は次のとおり。

- ARCHITECTURE と GOTCHAS は metatron の資産である。codiel の指示層に残すのは、§0 のドメインマップの抽出と、review の委譲へ ARCHITECTURE のパスを渡すことだけ(K12)。失敗を GOTCHAS へ記録する手順は削除済み。
- 委譲先だけが使うスキル(`writing-test-specs`・`scripting-tests`・`implementing`・`fixing-failures`・`reviewing-diffs`)の本文は、オーケストレーターが読まない(K13)。
- HARD-GATE と Red Flags は使わない。条項は、その操作をする手順の中へ条件付きの 1 文で書く(K2)。
- 場面限定の手順は、スキル配下の `references/` に置き、読む時点を本文に書く(K4)。`orchestrating-runs` の手順ファイルと読む契機は、本文 §2 の「手順ファイルと読む契機」にある。

## 改修する 9 件

`C/` は `plugins/codiel/`、`ORS` は `C/skills/orchestrating-runs/SKILL.md`。

1. **pr と worktree の手順の欠落**(付録 A23・A24): `C/skills/orchestrating-runs/references/phase-pr.md` に、`gh pr create` が失敗したとき(認証切れ・既存の PR あり)の扱いを足す。人に確かめるなら `mark-ask pr --kind confirm` を使う。`references/delegation-env.md` に、worktree を作るコマンドの例を 1 行足す。
2. **充足度の欠落 S1〜S17**(2026-10-02 の prompt-smith の再評価。改修前から無かった規則): 下の一覧の欠落ごとに、判断基準か分岐を書く。決め方が 1 つに定まらないものは、案を添えてユーザーに確かめる。
3. **K12 の `src/` 側の追随**: `C/src/check-intent-env.ts` の `contextDocs` とコメント(L304〜311 付近)が ARCHITECTURE・GOTCHAS を含む。`capturing-intent` は `CLAUDE.md`・`README.md` だけを使うので、外すかコメントを直す。`C/src/hooks/guard-write.ts` L317〜322 の `unrecorded-gotchas.md` の免除は、書き込む手順が無くなったので外す。テストと `C/docs/DESIGN.md` §8 も合わせる。
4. **ARCHITECTURE の古い記述**: `harness-docs/ARCHITECTURE.md:403` の退避先の記述。Edit できないので `metatron:updating-architecture` を起動して直す。
5. **finalize の後の compaction**: `references/phase-finalize.md` で `finalize` を呼ぶと run が `awaiting_outcome` になる。その後の手順(ADR 候補・結果レポート)の間に compaction が起きると、`ORS` の読み直しの対象(`active`・`awaiting_human`)から外れる。案は 2 つ。`finalize` を呼ぶ前に ADR 候補と結果レポートを済ませるよう手順を並べ替えるか、読み直しの対象に「`awaiting_outcome` で結果レポートが未出力の run」を足す。`finalize` コマンドが何を検証するか(`C/src/codiel-state.ts`)を確かめてから決める。
6. **プラグインルート参照規約の不整合**: `C/skills/facilitating-design-discussions/SKILL.md` は `<plugin-root>` を使うのに規約のセクションを持たないので足す。`C/skills/initializing-harness/SKILL.md` L198 の「CLAUDE.md / ARCHITECTURE はプロジェクトの恒久資産。承認なしの書き込みは HARD-GATE 違反」を、L49(codiel は ARCHITECTURE を書かない)と K2 に合わせて直す。
7. **`reviewing-diffs` の description**: 「`review-<m>.md` にまとめる」と書いているが、本文は「所見はテキストで返す。ファイルは書かない」。description の改修は `prompt-smith:skill-creator` の規律で行う。
8. **K13 の残り**: 改修後の run で、オーケストレーターが `scripting-tests` の「報告」の部分(委譲先の返答の項目)と、`reviewing-diffs` の所見の書式を `sed` で読んでいた。自分の作業(`report.md` の作成、`review-<m>.md` への統合)に要るためである。要る部分を `references/phase-test-code.md` と `references/review-common.md` へ写し、委譲先のスキルを読まずに済むようにする。
9. **計測の道具の不具合**: `tools/codiel_run_usage.py`。(a) セッション `11b4b570-3060-4ec8-a598-fe8a3db089d2`(`~/.claude/projects/-home-hiro0209-codiel-cost-bench/`)で、test-code より後のフェーズへの割り振りが崩れた(合計は正しい)。`start-phase` の呼び方(変数・ループ・複数コマンドの連結)を transcript で確かめて直す。(b) Read の一覧が Bash の `cat`・`sed` で読んだファイルを数えない。`--self-check` に両方の場面を足す。

### S1〜S17 の一覧(改修 2 の対象)

- `orchestrating-runs`
  - S1: 委譲先が異常終了したとき、返答が空のとき、成果物が空か不在のときの扱い(再委譲か人への確認か)が無い。
  - S2: §0 の分岐表の行 5 で、ユーザーが `unscoped` を許可しなかったときの動きが無い。
  - S3: §2.4 に「追記が intent-sync より後で、この run に含めると決めたとき」だけがあり、含めないと決めたときの扱い(持ち越しの記録先)が無い。
  - S4: §0 の手順 1 の `resolveDocPaths` や `check-intent-env.mjs` が例外・不正な終了コードで失敗したときの扱いが無い。
  - S5: §1 で、今回再開しない active・awaiting_human の run を `stop` で終端するとき、ユーザーへの確認の要否が無い。
- `raguel-gating`
  - S6: `pass-gate` が検査(HEAD の不一致など)で拒否したときの対処が無い。
  - S7: `record-attempt` を呼ぶ契機と、上限超過の後に再開する選択肢が選ばれたときの扱い。呼ぶ契機は `phase-test-loop.md`・`phase-fix-loop.md` にある。上限超過の後の再開が書かれているかを確かめる。
  - S8: Raguel MCP が評価の途中で不通になったときの扱いが無い。
- `reviewing-diffs`
  - S9: チェックリスト 2 の `<base>` と `<branch>` の出所が無い。
  - S10: テスト・型検査が実行できないとき、または失敗が受け入れ基準と無関係なときの severity の基準が無い。
  - S11: 「機械的に判定する」と「迷ったら基準文書に立ち返る」が併記され、迷ったときの基準が空。security 観点の「原則 medium 以上を検討する」の「検討する」も基準を欠く。
  - S12: 依頼文に観点ファイルが無いとき、複数の観点が渡されたときの扱いが無い。所見書式の「観点」の列挙が閉じたまま、観点ファイルとの対応が無い。
- `capturing-intent`
  - S13: 手順 1 の「ベースブランチの名前を解決し」で解決の方法が無い。作業ツリーが dirty で `git switch` できないときの扱いも無い。
  - S14: 手順 4 の承認ゲートで、ユーザーが承認も差し戻しもせず「やめる」を選んだときの扱い(run を作らず終える・書いた文書の扱い)が無い。
  - S15: 手順 4 の言語の確認で、推定した推奨を付けられないときの既定が無い。
  - S16: 手順 5 (2) の `issue-craft` が起票の承認を得られなかったとき・失敗したときの分岐が無い。
  - S17: 手順 5 (4) の `codiel-state init` が失敗したとき(slug の重複・既存の run との衝突など)の扱いが無い。

各行の位置は 2026-10-02 時点(HEAD `eff8799` 前後)のもので、その後のコミットでずれている。直す前に本文を読んで位置を確かめる。

## 進め方

- 9 件は互いに独立である。改修 3 と 9 はコード(`C/src/`・`tools/`)、改修 4 は metatron の CLI、ほかは指示書である。並列に委譲するときは、触るファイルが重ならないように分ける(改修 2 と 5 と 8 は `ORS` か `orchestrating-runs/references/` を触りうる)。
- 指示書(`skills/**`・`references/**`)を編集する前に `prompt-smith:prompt-smith` を起動する。description は `prompt-smith:skill-creator` の担当。
- 改修 3 は `C/src/` を変えるので、`pnpm run build` で `C/scripts/` を作り直し、同じコミットに含める。
- 改修の後、`orchestrating-runs`・`raguel-gating`・`reviewing-diffs`・`capturing-intent` に prompt-smith の評価を当て、充足度の評点が下がっていないことを確かめる。差分を code-reviewer の役割にレビューさせる。
- 計測(サンドボックスの run)は必須ではない。行う場合は、計画書の「Task 1 の結果」の手順(`scripts/reset-cost-bench.sh`、`claude --plugin-dir`)に従う。

## 踏みやすい点

- バージョン: 本体の改修では codiel・metatron・gh-utility のバージョンを上げなかった(K5)。この残りの改修で上げるかは、作業の前にユーザーに確かめる。
- `metatron` のテスト `plugins/metatron/src/__test__/section-reference-inventory.test.ts` は、codiel の文書の ARCHITECTURE への言及を登録簿 `plugins/metatron/src/fixtures/section-reference-inventory.json` と照合する。言及を足す・消す・別のファイルへ移すと落ちるので、登録簿を合わせる。
- 手順ファイルへ写すときは、読む文の位置に気をつける。「A のときは B を読む」の文が A を実行する文より後にあると、B は読まれない(本体の改修のレビューで見つかった)。
- `ORS` の §2 の 2.1 と 2.4 は、他のスキルから番号で参照されている。番号を変えない。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」を使わない。PostToolUse の hook が違反を報告したら直す。
- `docs/chat/` の未コミットの変更を、本件のコミットに混ぜない。

## スコープ外

- run のターン数を減らす改修(ASK の誤検知、委譲の待ちの間の往復)。指示書の削減は 1 ターンあたりの量にしか効かず、ターン数は別の設計が要る。
- 設計の決定 K1〜K13 の再検討。
- Issue の起票、PR の作成とブランチの統合。

## 参照

- 設計書: `harness-docs/design/2026-10-02-codiel-run-cost-design.md`
- 付録(指摘 181 件): `harness-docs/design/2026-10-02-codiel-run-cost-findings.md`
- 実装計画書: `harness-docs/plans/2026-10-02-codiel-run-cost-plan.md`(「別の Issue にする事項」「Task 10 の結果」)
- 会話記録: `docs/chat/2026/1002/phyllis998/0901-codiel-run-cost-optimization-scope.md`
- 計測の道具: `tools/codiel_run_usage.py`、`scripts/reset-cost-bench.sh`
