# carry-over の運転

`start-phase carry-over` の直後に読む。carry-over は、前の try から run ブランチに残るコードを、分岐点からの差分としてゲートで評価するフェーズである。try-1 では `init` が `SKIPPED` にするので、このファイルを読む場面は無い。

1. `raguel-gating` の対応表に従い、`evaluate_code`(`phase: carry-over`、`baseRef` は carry-over の `startHead`)を呼ぶ。`startHead` は `start-phase` が記録したベースブランチとの分岐点なので、intent の評価の後のコミットも差分に入る。
2. PROCEED なら `pass-gate carry-over` する。返った findings は、design(軽量では dev-plan)の入力と、依頼文の「前フェーズの申し送り」にする。
3. ASK なら `raguel-gating` の手順で人に確かめる。選択肢は「承認して続ける(findings を後のフェーズへ申し送る)」「修正して再提出」「stop」とする。
4. STOP は、誤検知の裁定なら `raguel-gating` の手順で通す。妥当の裁定なら、「修正して再提出」と「stop」を人に選ばせる。carry-over だけは、妥当の STOP の後も修正して再評価できる。修正は、STOP を受けた HEAD の上に新しいコミットとして足し、その HEAD で再評価する。amend で内容を変えずに HEAD を替えたとき、reset で戻したとき、別ブランチへ switch したときは、`pass-gate` が通らない。
5. 「修正して再提出」が選ばれたら、次の順に進める。ASK から選んだときも同じである。ASK から選んだときは、手順 1 の前に `raguel-gating` の裁定 A の手順 1〜2(`resume` と、`record_outcome` の `outcome: "rejected"`・`ruling: "revise"`・`notes` に人の指示・`evaluationId` は ASK を出した evaluate のもの)に従って記録する。
   1. `codiel-state resume --slug <slug>` でフェーズを `in_progress` に戻す。STOP の後は `awaiting_human` のままで、`pass-gate` が失敗する。ASK から選んだときは、裁定 A の手順 1 で済んでいるので重ねない。
   2. 先に `references/delegation-env.md` を Read し、所見を直す委譲(`implementing` の修正モード)を出す。worktree は使わず、run ブランチ上で直接コミットさせる。依頼文には、carry-over の所見(severity・対象・内容・根拠・提案)と対象ファイル、担当タグ、担当範囲を載せる。この try の `dev-plan.md` はまだ無いので、依頼文に載せず、範囲は担当範囲と所見のパスに限らせる。コミットの件名は `codiel(carry-over): <修正内容> (<slug> try-<n>)` とさせる。報告は `delegation-env.md` の置き場の表に従う。
   3. `mapped` では、所見のパスから担当タグを決め、§4 の規則(`set-domain`・担当範囲)に従う。`unscoped` では担当範囲を「なし」にする。
   4. 委譲先のコミットを待ってから、`evaluate_code` をやり直す。`startHead` は変えない。
   5. 再評価の verdict は手順 2〜4 で扱う。ASK や STOP が返るたびに人が選ぶので、回数の上限は置かない。
6. 「stop」が選ばれたら、由来で分ける。
   - STOP 由来: `raguel-gating` の STOP の手順 5 に従う。`stop --reason raguel-stop` で止め、`gotcha-candidates.md` の手順で GOTCHAS 候補を書く。
   - ASK 由来: `raguel-gating` の ASK の中止の手順に従う。`waits` を片付けてから `stop --reason ask-aborted` で止め、GOTCHAS 候補は書かない。
7. 修正の委譲では、テストと `<testsDir>/**` の仕様を保護対象として扱わせる。書き換えが要る所見は直さずに報告させ、報告を人への確認に回す。
