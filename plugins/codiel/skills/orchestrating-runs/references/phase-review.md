# review の運転

`start-phase review` の直後に読む。

1. `references/review-common.md` を Read し、その規則で観点を選び、「レビューの単位の前の準備」を行う。
2. 観点ごとの読み取りだけの単位を始める。委譲するときは、同じ応答からまとめて出す。入力はフェーズ進行表の review の行に従う。review では `set-domain` を実行しない(本文 §4)。
3. すべての観点の単位が終わったら(委譲したときは待ちが消えたら)、`review-common.md` の「所見の統合と投稿」に従う。
4. `complete-phase review` する。
5. `review-<m>.md` に critical/high があれば fix-loop へ進む。1 件も無ければ、本文 §2 の規則で fix-loop をスキップして triage へ進む。
