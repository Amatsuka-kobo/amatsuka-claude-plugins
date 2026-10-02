# implement の運転

`start-phase implement` の直後に読む。worktree と委譲の並べ方は `references/delegation-env.md` に従う。

1. dev-plan のステップを `step-add --slug <slug> --id <ID> --files '<JSON 配列>' --deps '<JSON 配列>' [--final] [--domain <名前>]` で登録し、`codiel-state waves --slug <slug>` で実行順を得る。非ゼロで終わったら dev-plan を差し戻し、`evaluate_plan` を呼ばない(循環依存は dev-plan のゲートで検出する)。
2. `waves` の `groups` を先頭から順に処理する。`parallel` グループは手順 3〜8 で進める。`serial` グループと `final` は、run ブランチ上で 1 ステップずつ、`set-domain` を使って委譲する(本文 §4)。
3. `parallel` グループの各ステップに brief ファイル `.codiel/runs/<slug>/try-<n>/steps/step-<k>/brief.md` を書く。内容は本文 §3 のテンプレートに、次を加えたものである。
   - worktree の絶対パス・触るファイル・前提ステップ・環境準備のコマンド
   - 選んだ委譲の種類と、実行する通すテスト(そのステップの `spec.md` の `tests` を写す)
   - 選んだ観点ファイル
   - 通すテストに E2E があるときは、レポートの出力先(`references/e2e.md`)
4. 実装の委譲を出す。依頼文では brief の絶対パスを読ませる。
5. 報告の環境の失敗を実行し直させてから、ステップごとに並列で読み取りだけのタスクレビューを出す。観点は、仕様適合(dev-plan のステップと受け入れ基準に合うか)と品質である。
6. 所見があれば修正ループを回す。上限は 5 ラウンドとし、`implement.steps[k].attempts` で数える。
   - 1〜3 ラウンド: 同じ委譲先を、文脈を保ったまま続投させる。
   - 4〜5 ラウンド: 作業内容を「行き詰まりの打開」と明記した新しい委譲として出す。委譲先の選択はセッションの規律に委ね、役割名もモデル名も書かない。
   - 5 ラウンドで通らなければ、`mark-ask implement --slug <slug> --kind confirm` で待ち、人に続行か中止かを裁定してもらう。続行は `resume --slug <slug>`、中止は `stop --slug <slug> --reason attempts-exceeded` で行う。`stop` の前に、本文 §2.4 の手順で待ちを片付ける。
   - 中止を選ばれたら、`stop` の前に `references/gotcha-candidates.md` を Read する。止めたら、その手順で GOTCHAS 候補を書き、完了報告に一覧する。
7. レビューを通ったステップから、run ブランチへ順に `git merge --no-ff` する。衝突したら `git merge --abort` し、そのステップを `failed` にする。グループの残りのマージが済んだ後、worktree を後始末してから新しい HEAD で作り直し、直列にやり直す。
8. グループのマージが済んだら、run ブランチでそのグループの実行する通すテストを実行する。
   - プロジェクトの test コマンドと `units/` のテストは自分で実行し、`e2e/` のテストは仕様のディレクトリごとに実行の委譲を出す。
   - 委譲先が実行しなかったと報告した通すテストも、ここで含めて実行する。
   - 自分の実行結果と `e2e/` の委譲の返答は、`steps/merge-test-<g>/report.md` に書く。
   - 失敗(環境の失敗を除く)は、修正を成果物を書く委譲として run ブランチ上で直列に出し、返答を `steps/merge-fix-<g>/report.md` に書く。
9. 方式 b(dev-plan の `## 生成物`)では、全グループの後に、`final` の最終ステップ(生成物の生成とコミット)を run ブランチ上で委譲する。
10. 全グループと `final` の後、`references/e2e.md` に従って E2E のレポートをコミットしてから、implement 全体に対して `evaluate_code` を 1 回呼ぶ。渡すものは `raguel-gating` の対応表の implement の行に従う。続けて `pass-gate implement` する。

state を書くのはオーケストレーターだけである。ステップを担う委譲先とタスクレビューの委譲先は `codiel-state` を呼ばない。
