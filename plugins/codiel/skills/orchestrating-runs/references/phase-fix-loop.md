# fix-loop の運転

`start-phase fix-loop` の直後に読む。所見の検証・修正の単位・反論の記録は `fixing-review-findings` に従う。worktree と単位の並べ方は `references/delegation-env.md` に従う。ここには、オーケストレーターが行う state の操作、ゲートの回数、再レビューの前の手順を書く。

## ゲートの回数と通過の時点

- `evaluate_code` は修正が 1 件返るごとに呼ぶ。範囲はいつも fix-loop の `startHead` から今の HEAD までである。
- `pass-gate fix-loop` は fix-loop の中で 1 回だけ呼ぶ。`pass-gate` は `in_progress` のフェーズにしか効かず、通すとフェーズが `passed` になって以後の修正を受け付けない。
- `pass-gate` を呼ぶのは、再レビューの critical/high(反論済みの所見を除く)が 0 件になった後である。今の HEAD で評価した PROCEED の `evaluationId` を渡す。最後の評価の後に HEAD が動いていれば(E2E のレポートのコミットなど)、評価し直してから渡す。
- fix-loop が `passed` になるのは、この `pass-gate` が成功した時点である。

## 手順

- 1 つの `review-<m>.md` の所見を直す 1 サイクル(テスト側・コード側・ドメインごとの修正をすべて含む)を 1 ラウンドとし、サイクルの修正がすべて返った時点で `record-attempt fix-loop --slug <slug>` を 1 回呼ぶ。`record-attempt` はオーケストレーターだけが呼ぶ。
- `record-attempt` は回数を数えるためだけに呼び、修正のループに上限は無い。所見がすべて反論済みで修正を 1 件も出さなかったサイクルは数えない。これから出す修正のラウンドは、記録された回数 + 1 である。
- ドメインごとに修正を分けたサイクルでは、ドメインごとの作業者がそれぞれ続ける。
- 修正の 1〜3 ラウンドは、同じ作業者が文脈を保ったまま続ける。委譲したときは同じ委譲先を続投させる。4 ラウンド以上は、2 ラウンドごとに(4・5、6・7、…)、作業内容に「行き詰まりの打開」と明記した新しい修正の単位にする。委譲するときの委譲先の選び方は運用方針に任せる。自分で作業するときは、新しい単位に移るたびに、それまでの修正の方針を捨てて原因の調べ直しから始める。再レビューの扱いは変えない。
- 所見がテストに向くと `fixing-review-findings` の検証で確かめたら、`set-test-edit --slug <slug>` を実行してからテスト側の修正の単位を始める。その単位が終わった直後(委譲したときは `wait-done` の直後)に `clear-test-edit --slug <slug>` を実行し、その後でコードの修正の単位を始める。
- github モードでは、修正のコミットが済んだ後、再レビューの単位を始める前に `git push` して PR ブランチを最新化する。
- 再レビューの単位を始める前に `references/review-common.md` を Read し、その規則で観点を選び直し、「レビューの単位の前の準備」を行う。返った所見のうち反論済み一覧と同じ指摘は、本文 §3 のとおり `review-<m+1>.md` に書く前に除く。統合した報告は `review-<m+1>.md` に書く。
- 直した所見に、設計時に想定していなかった仕様漏れ・考慮漏れがあったときは、fix-loop の `pass-gate` の前に `references/gotcha-candidates.md` を Read する。`pass-gate` の後に、その手順で漏れごとに GOTCHAS 候補を書く。
- 設計を変える修正を採ったときは、fix-loop の `pass-gate` の前に `references/adr-candidates.md` を Read する。`pass-gate` の後に、その手順で ADR の 3 条件を判定し、満たす判断ごとに ADR 候補を書く。
