# 文書だけ残して終える分岐

手順 4 で「終える」が選ばれたときに、手順 5 の (6) で読む。ユーザーへの確認は挟まず(Raguel の ASK の裁定待ちは除く)、次の順に進める。run ブランチは作らない。

1. 開始時のブランチが `codiel/<slug>` のときは、コミットの前に次の順でベースブランチへ移る。intent-only の文書は、run ブランチではなくベースブランチに残す。
   1. 書き直した intent の本文を、`.codiel/runs/<slug>/intent-backup.md` へ退避する。`.codiel/runs/` は git に載らないので、ディレクトリが無ければ作る。
   2. run ブランチ側で `git restore <intent パス>` を実行し、前の try のコミットの内容へ戻す。前の try の intent は run ブランチにだけあり、書き直しは tracked の変更になるので、戻さないと `git switch` が拒否される。
   3. ベースブランチへ `git switch` する。`git stash` は使わない。
   4. 退避した本文を、同じ intent パスへ書き戻し、退避ファイルを消す。
   5. 手順 1 のどこかが失敗したら `commit-failure.md` に従う。このとき退避ファイルは消さずに残す。
2. 開始時のブランチ(上で切り替えたときはベースブランチ)で `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
3. `codiel-state start-phase intent --slug <slug>` を実行する。
4. Raguel MCP の `evaluate_decision` を呼ぶ。ASK が返ったときは、`mark-ask` で `awaiting_human` にしてから人の裁定を待つ。STOP が返ったときは `pass-gate` へ進まず、`raguel-gating` の手順に従う。
5. `codiel-state pass-gate intent --slug <slug> --evaluation-id <id> --verdict PROCEED` を実行する。
6. `codiel-state close --slug <slug> --reason intent-only` を実行する。phase は `close` まで `intent` のままである。
