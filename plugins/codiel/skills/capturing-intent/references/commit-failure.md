# intent フェーズのコミットの失敗

手順 5 の (6) で、続行する分岐の 1 の切り替えか `git commit` が失敗したとき、および `intent-only.md` の手順 1 のベースブランチへの切り替えが失敗したときに読む。退避を伴う切り替えでは、退避・`git restore`・`git switch`・書き戻し・`git add` のどれの失敗も含む。

- `git commit` が「変更なし」で失敗したとき(前の try からパスだけを渡して続行する場合など)は、そのコミットを飛ばして次へ進む。
- 続行する分岐の 1 の切り替えが失敗したとき、`intent-only.md` の手順 1 の切り替えが失敗したとき、またはそれ以外の理由で `git commit` が失敗したときは、この区間では `mark-ask` できない(intent フェーズは `start-phase` 前の `pending` である)。次の順に進める。
  1. `codiel-state stop --slug <slug> --reason commit-failed` で run を終端にする。完了報告の候補の一覧は `orchestrating-runs` の 2.4 に従う。
  2. 失敗の出力と intent 文書のパスをユーザーに示して、扱いを確かめる。終端にした run は stop-guard の対象にならないので、この確認は応答を待って止まれる。
  3. 続行する分岐で失敗したときは、確かめる前に、開始時のブランチが run ブランチ `codiel/<slug>` でなければ `git switch <開始時のブランチ>` で戻る。`git switch -c` で作った `codiel/<slug>` はそのまま残してよく、やり直しは同じ名前のブランチを使う。
- 退避を伴う切り替えで失敗したときは、`.codiel/runs/<slug>/intent-backup.md` に書き直した本文が残っている。ユーザーへ示す intent 文書のパスに、この退避ファイルのパスを添える。
- intent 文書は作業ツリーに残す。この停止では intent の `status` を変えない。intent を続けないという判断ではないので、`abandoned` にしない。
- やり直すときは、その intent パスを入口に run を始め直す。次の try でこの intent を使うときは、作業ツリーに残したこの intent をそのまま使う(`references/carry-over-intent.md`)。
