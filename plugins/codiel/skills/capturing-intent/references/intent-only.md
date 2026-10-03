# 文書だけ残して終える分岐

手順 4 で「終える」が選ばれたときに、手順 5 の (6) で読む。ユーザーへの確認は挟まず(Raguel の ASK の裁定待ちは除く)、次の順に進める。run ブランチは作らない。

1. 開始時のブランチで `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
2. `codiel-state start-phase intent --slug <slug>` を実行する。
3. Raguel MCP の `evaluate_decision` を呼ぶ。ASK が返ったときは、`mark-ask` で `awaiting_human` にしてから人の裁定を待つ。STOP が返ったときは `pass-gate` へ進まず、`raguel-gating` の手順に従う。
4. `codiel-state pass-gate intent --slug <slug> --evaluation-id <id> --verdict PROCEED` を実行する。
5. `codiel-state close --slug <slug> --reason intent-only` を実行する。phase は `close` まで `intent` のままである。
