# test-code の運転

`start-phase test-code` の直後に読む。worktree と委譲の並べ方は `references/delegation-env.md` に従う。

1. test-spec が作成・更新した仕様のディレクトリを、`step-add --slug <slug> --kind test-code --id <ID>` で `testCode.units` に登録する。test-code はドメイン境界を課さないので、`--files`・`--deps`・`--final`・`--domain` は渡さない。
2. 仕様のディレクトリごとに、worktree(名前は `test-code-<k>`)で成果物を書く委譲を出す。brief には testsDir の値、仕様のディレクトリの ID、入力のパスを書く。E2E の仕様のディレクトリでは、`references/e2e.md` に従ってレポートの出力先を渡す。
3. 委譲先の完了通知を受けたら、返答を `steps/test-code-<k>/report.md` に書く。返答に入っている次の項目を転記する。
   - ケースごとの結果(Red・通過・環境の失敗・cases.md の誤り)と理由
   - 置いたテストファイルのパスと、`spec.md` の `tests` に足した値
   - 置き場の根拠(フレームワークの既定の置き場で決めたとき、推定で決めたとき)
   - 実行したコマンドと出力の抜粋
   - E2E の仕様のディレクトリでは、スクリーンショットの撮り方と、`e2e-report-format.md` の返答の項目

   報告の環境の失敗を実行し直させてから、読み取りだけのタスクレビューを出す。観点は、ケースとテストの 1 対 1、期待結果が `cases.md` の文言どおりか、Red の理由、置き場が規約どおりか、`tests` の記録と置いたファイルの一致、の 5 つである。
4. 所見があれば修正ループを回す。ラウンドは `testCode.units[<ID>].attempts` で数え、上限は 5 ラウンドとする。
   - 1〜3 ラウンド: 同じ委譲先を、文脈を保ったまま続投させる。
   - 4〜5 ラウンド: 作業内容を「行き詰まりの打開」と明記した新しい委譲として出す。委譲先の選択はセッションの規律に委ね、役割名もモデル名も書かない。
   - 5 ラウンドで通らなければ、`mark-ask test-code --slug <slug> --kind confirm` で待ち、人に続行か中止かを裁定してもらう。続行は `resume --slug <slug>`、中止は `stop --slug <slug> --reason attempts-exceeded` で行う。`stop` の前に、本文 §2.4 の手順で待ちを片付ける。
   - 中止を選ばれたら、`stop` の前に `references/gotcha-candidates.md` を Read する。止めたら、その手順で GOTCHAS 候補を書く。完了報告の候補の一覧は本文 §2.4 に従う。
5. レビューを通ったディレクトリから、run ブランチへ順にマージする。
6. 委譲先が「cases.md の誤り」を報告したディレクトリは、マージせずに要素を `failed` にして worktree を後始末する。続けて、`writing-test-specs` に従う成果物を書く委譲で、run ブランチ上の `cases.md` を直させる。
   - 期待結果を変える必要が無いと直す委譲が報告したら、`mark-ask test-code --kind confirm` の後に人に確かめる。
   - 直したら要素を `pending` に戻し、そのディレクトリの test-code をやり直す。
7. 全ディレクトリのマージの後、`references/e2e.md` に従って E2E のレポートをコミットしてから `evaluate_code` を呼ぶ。
   - 渡すものは `raguel-gating` の対応表の test-code の行に従う。
   - `testResults` は、各 report.md の Red の確認の要約とする。
   - objective は、本体の後に「実装の前なので、Red の対象のテストが失敗するのは期待どおりである」の 1 文を足す。
8. `pass-gate test-code` する。
