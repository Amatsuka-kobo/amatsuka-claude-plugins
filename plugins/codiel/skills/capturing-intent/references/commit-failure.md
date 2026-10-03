# intent フェーズのコミットの失敗

手順 5 の (6) で `git switch -c` か `git commit` が失敗したときに読む。

- `git commit` が「変更なし」で失敗したとき(前の try からパスだけを渡して続行する場合など)は、そのコミットを飛ばして次へ進む。
- `git switch -c` が失敗したとき、またはそれ以外の理由で `git commit` が失敗したときは、この区間では `mark-ask` できない(intent フェーズは `start-phase` 前の `pending` である)。次の順に進める。
  1. `codiel-state stop --slug <slug> --reason commit-failed` で run を終端にする。完了報告の候補の一覧は `orchestrating-runs` の 2.4 に従う。
  2. 失敗の出力と intent 文書のパスをユーザーに示して、扱いを確かめる。終端にした run は stop-guard の対象にならないので、この確認は応答を待って止まれる。
  3. 続行する分岐で失敗したときは、確かめる前に `git switch <開始時のブランチ>` で開始時のブランチへ戻る。作った run ブランチはそのまま残してよく、やり直しの試行は別の名前のブランチになる。
- intent 文書は作業ツリーに残す。この停止では intent の `status` を変えない。intent を続けないという判断ではないので、`abandoned` にしない。
- やり直すときは、その intent パスを入口に run を始め直す。次の try でこの intent を持ち込むときは、作業ツリーに残したこの intent をそのまま使い、この run ブランチからは持ち込まない(`references/carry-over-intent.md`)。
