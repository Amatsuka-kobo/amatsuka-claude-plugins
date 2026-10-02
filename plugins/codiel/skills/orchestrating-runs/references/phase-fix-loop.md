# fix-loop の運転

`start-phase fix-loop` の直後に読む。所見の検証・修正の委譲・反論の記録は `fixing-review-findings` に従う。worktree と委譲の並べ方は `references/delegation-env.md` に従う。ここには、オーケストレーターが行う state の操作と再レビューの前の手順を書く。

- 修正の委譲の 1 往復(1 attempt)ごとに、`record-attempt fix-loop --slug <slug>` を呼ぶ。`record-attempt` はオーケストレーターだけが呼び、委譲先には呼ばせない。
- exit code が `3`(試行上限超過・`capExceeded`)なら、`raguel-gating` の ASK と同じ扱いにする。`awaiting_human` は `record-attempt` がセットしている。findings に当たる情報を人に示し、裁定を受けてから続ける。
- 所見がテストに向くと `fixing-review-findings` の検証で確かめたら、`set-test-edit --slug <slug>` を実行してからテスト側の修正を委譲する。その委譲を `wait-done` した直後に `clear-test-edit --slug <slug>` を実行し、その後でコードの修正を委譲する。
- github モードでは、修正のコミットが済んだ後、再レビューの委譲の前に `git push` して PR ブランチを最新化する。
- 再レビューの委譲を出す前に `references/review-common.md` を Read し、その規則で観点を選び直す。統合した報告は `review-<m+1>.md` に書く。
- 直した所見に、設計時に想定していなかった仕様漏れ・考慮漏れがあったときは、最後の pass-gate の前に `references/gotcha-candidates.md` を Read する。pass-gate の後に、その手順で漏れごとに GOTCHAS 候補を書く。
