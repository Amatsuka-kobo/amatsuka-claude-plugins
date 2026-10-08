# 再開手順

run を再開するときに読む。

1. run を特定し、state を読む。
   - `--slug <slug>` が分かっていればそれを使う。intent パスだけが分かっているときは、その frontmatter `run` の値、無ければ state の `intent` が同じ値の run を slug として使う。
   - state の `intent` だけで当たった run は、続ける前に slug・intent のパス・現在のフェーズを示してユーザーに確かめる。
   ```
   node <plugin-root>/scripts/codiel-state.mjs get --slug <slug>
   ```
   - `phases` に `test-code` を持たない state(M4 より前に作った run)は、どのフェーズにあっても続行しない。`waits` が残っていれば、本文 §2.4 の手順で `wait-clear` してから `stop --slug <slug> --reason migrate` で止め、止めたことと理由をユーザーに示し、同じ intent パスを入口に新しい try を始める(本文 §1)。intent は `abandoned` にしない。
   - `state.status` が `awaiting_outcome` の run は再開しない。outcome の同期に任せ、ここで終える。
2. 本文 §2「手順ファイルと読む時点」の再開の範囲の手順ファイルを Read する。carry-over が `in_progress` か `awaiting_human` なら、`references/phase-carry-over.md` も読む。
3. `state.branch` が `null` でなければ、`git switch <state.branch>` で run のブランチ(`codiel/<slug>`。改修の前に作った run は `-try-<n>` 付きの名前)に切り替える。
   - 切り替える先のブランチがまだ無いとき(`init` の後、`git switch -c` の前で止まった run)は、`capturing-intent` の手順 5 の (6) の続きから行い、`git switch -c <state.branch>` でブランチを作ってから続ける。
   - `state.branch` が `null` の run(`--intent-only` の run)は、開始時のブランチの作業ツリーで intent フェーズの続きを行う。
4. §0 の判定をやり直し、記録と違えば人に確かめる。
   - 連携モードの判断が `state.integration` と違えば、どちらで続けるかを人に確かめる。記録を変えるときは `codiel-state set-integration --slug <slug> --integration <github|local> --image-upload <値>` を実行する。
   - ADR 候補と GOTCHAS 候補の有効無効は、run の開始時に固定した `state.candidates` を使い、判定し直さない。
   - 実行モードは、§0 の分岐表の行 3・行 4 のとおり `state.domainMode` の記録を使う。記録が無ければ行 5〜7 で判定し直す。
5. `state.phase` から続行する前に、待ちを次の順に処理する。前のセッションの委譲は失われたものとして扱う。
   1. 最初に `codiel-state wait-clear --slug <slug>` を 1 回だけ呼び、出力の `cleared`(前のセッションで残った待ちの一覧)を控える。出し直した委譲の待ちを後から消さないよう、出し直しより先に呼ぶ。
   2. `cleared` の待ちごとに、`waits/<id>.md` が `startedAt` より後に書かれているかを確かめる。書かれていれば、返答を受け取り済みとして、報告の置き場への転記を済ませる。書かれていなければ、委譲を出し直す(新しい回の `id` で `wait-add` する)。古い報告のファイルや成果が残っていても、`waits/<id>.md` が無い委譲の成果としては使わない。
   3. `cleared` に無くても、state の要素(`implement.steps`・`testCode.units`・`testLoop.units`)が `running` か `reviewing` のままで、その要素の `waits/*.md` が無いものは、起動から `wait-add` までの間に失われた委譲として出し直す。続投していた修正ラウンドも、新しい委譲に切り替える。
   4. worktree の中の委譲を出し直すときは、`references/delegation-env.md` の worktree の規則どおり、残っている worktree とそのブランチを削除し、新しい HEAD で作り直す。
   5. 委譲を出し直す判断はこの手順に一本化する。フェーズごとの再開の分岐(test-spec など)は、この手順の後に、受け取り済みの返答でゲートへ進むかだけを決める。
6. `state.phase` から続行する。すでに `passed` のフェーズはやり直さず、`in_progress` のフェーズから再開する。中断していた委譲があれば、次の報告の末尾の `## 実行し直し` のセクションの有無で、環境の失敗の実行し直しが済んだかを判断する。済んでいれば実行し直さない。
   - `steps/` の下の、状態が `running` か `reviewing` の要素の `report.md`
   - implement では全グループの `steps/merge-test-<g>/report.md` と `steps/merge-fix-<g>/report.md`、test-loop では `steps/test-loop-project/report.md`
   - test-loop では最新の `test-run-<n>.md`、fix-loop では最新の `test-run-<n+1>.md`
   - intent-sync では `steps/intent-sync/report.md`。このファイルがあれば、取り込みと ADR 候補の書き残しは済んでいる。

   discuss で中断していたときの再開位置(アジェンダ作成から/未決論点から/最終確認から)は、`facilitating-design-discussions` の「中断再開」に従う。design で `design.md` が既にあるときは、ウォークスルーの再提示から再開する。
7. `state.status` が `awaiting_human` なら、該当フェーズの `evaluationId` / `note` を手がかりに直近の findings を再提示し、`raguel-gating` の ASK の手順(裁定 A / 裁定 B / 中止)に従う。人の裁定を受けてから続行する。
