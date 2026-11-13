# test-code の運転

`start-phase test-code` の直後に読む。worktree と単位の並べ方は `references/delegation-env.md` に従う。

1. test-spec が作成・更新した仕様のディレクトリを、`step-add --slug <slug> --kind test-code --id <ID>` で `testCode.units` に登録する。test-code はドメイン境界を課さないので、`--files`・`--deps`・`--final`・`--domain` は渡さない。
2. 仕様のディレクトリごとに、worktree(名前は `test-code-<k>`)で成果物を書く単位を始める。始める前に `delegation-env.md` の規則で worktree を作り、その後で `step-update --slug <slug> --kind test-code --id <ID> --status running --worktree <repoRoot 相対のパス> --branch <ブランチ名> --base <worktree を作った HEAD>` を 1 回だけ実行する。brief には testsDir の値、仕様のディレクトリの ID、入力のパスを書く。carry-over が `SKIPPED` でない try では、契約の前提に「引き継いだ実装あり」と書く。E2E の仕様のディレクトリでは、`references/e2e.md` に従ってレポートの出力先を渡す。
3. 単位の作業が終わったら(委譲したときは完了通知を受けたら)、報告を `steps/test-code-<k>/report.md` に書く。報告に入っている次の項目を書く。
   - ケースごとの結果(Red・通過・環境の失敗・cases.md の誤り・引き継いだ実装で通る)と理由。「引き継いだ実装で通る」の報告はマージを止めず、`report.md` にケース ID を一覧する
   - 置いたテストファイルのパスと、`spec.md` の `tests` に足した値
   - 置き場の根拠(フレームワークの既定の置き場で決めたとき、推定で決めたとき)
   - 実行したコマンドと出力の抜粋
   - E2E の仕様のディレクトリでは、スクリーンショットの撮り方と、`e2e-report-format.md` の返答の項目

   報告の環境の失敗を実行し直してから、読み取りだけのタスクレビューの単位を始める。観点は、ケースとテストの 1 対 1、期待結果が `cases.md` の文言どおりか、Red の理由、置き場が規約どおりか、`tests` の記録と置いたファイルの一致、の 5 つである。
   修正の後の再レビューを含め、タスクレビューの単位を始める前に毎回 `step-update --slug <slug> --kind test-code --id <ID> --status reviewing` を実行する。
4. 所見があれば修正ループを回す。ループに上限は無い。所見を直す前に `step-update --slug <slug> --kind test-code --id <ID> --status running` を実行する。この遷移(`reviewing` から `running`)で `testCode.units[<ID>].attempts` が 1 増え、その値をラウンドの番号とする。手順 2 の最初の `running` では増えない。
   - 1〜3 ラウンド: 同じ作業者が文脈を保ったまま続ける。委譲したときは同じ委譲先を続投させる。
   - 4 ラウンド以上: 2 ラウンドごとに(4・5、6・7、…)、作業内容に「行き詰まりの打開」と明記した新しい単位にする。委譲するときの委譲先の選び方は運用方針に任せる。state に新しい記録は足さない。
   - 自分で作業するときは、新しい単位に移るたびに、それまでの修正の方針を捨てて原因の調べ直しから始める。
5. レビューを通ったディレクトリから、run ブランチへ順にマージし、`step-update --slug <slug> --kind test-code --id <ID> --status merged --head <worktree のブランチの HEAD>` で記録する。衝突したら `git merge --abort` し、`--status failed` にする。残りのマージが済んだ後、worktree を後始末し、`--status pending` で戻してから新しい HEAD で作り直し、手順 2 からやり直す。
6. 作業者が「cases.md の誤り」を報告したディレクトリは、マージせずに `--status failed` で要素を `failed` にして worktree を後始末する。続けて、`writing-test-specs` に従う成果物を書く単位で、run ブランチ上の `cases.md` を直す。
   - 期待結果を変える必要が無いと直す単位の作業者が報告したら、`mark-ask test-code --kind confirm` の後に人に確かめる。
   - 直したら `--status pending` で要素を戻し、そのディレクトリの test-code をやり直す。やり直しのラウンドは、要素の `attempts` の続きから数える。
7. 全ディレクトリのマージの後、`references/e2e.md` に従って E2E のレポートをコミットしてから `evaluate_code` を呼ぶ。
   - 渡すものは `raguel-gating` の対応表の test-code の行に従う。
   - `testResults` は、各 report.md の Red の確認の要約とする。
   - objective は、本体の後に「実装の前なので、Red の対象のテストが失敗するのは期待どおりである」の 1 文を足す。carry-over が `SKIPPED` でない try では、「実装の前に失敗するか、引き継いだ実装で通る」に直す。
8. `pass-gate test-code` する。
