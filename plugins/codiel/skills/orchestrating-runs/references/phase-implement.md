# implement の運転

`start-phase implement` の直後に読む。worktree と単位の並べ方は `references/delegation-env.md` に従う。

1. dev-plan のステップを `step-add --slug <slug> --id <ID> --files '<JSON 配列>' --deps '<JSON 配列>' [--final] [--domain <名前>]` で登録し、`codiel-state waves --slug <slug>` で実行順を得る。非ゼロで終わったら dev-plan を差し戻し、`evaluate_plan` を呼ばない(循環依存は dev-plan のゲートで検出する)。
2. `waves` の `groups` を先頭から順に処理する。`parallel` グループは手順 3〜8 で進める。`serial` グループと `final` は、run ブランチ上で 1 ステップずつ、`set-domain` を使って単位の作業を進める(本文 §4)。
3. `parallel` グループの各ステップに brief ファイル `.codiel/runs/<slug>/try-<n>/steps/step-<k>/brief.md` を書く。内容は本文 §3 のテンプレートに、次を加えたものである。
   - worktree の絶対パス・触るファイル・前提ステップ・環境準備のコマンド
   - 選んだ単位の種類(`delegation-env.md` の並列可・単独)と、実行する通すテスト(そのステップの `spec.md` の `tests` を写す)
   - 選んだ観点ファイル
   - 通すテストに E2E があるときは、レポートの出力先(`references/e2e.md`)
4. 実装の単位を始める。契約では brief の絶対パスを読ませる。始める前に `step-update --slug <slug> --id <ステップ> --status running --worktree <repoRoot 相対のパス> --branch <ブランチ名> --base <worktree を作った HEAD>` を実行する。
5. 報告の環境の失敗を実行し直させてから、ステップごとに並列で読み取りだけのタスクレビューを出す。観点は、仕様適合(dev-plan のステップと受け入れ基準に合うか)と品質である。
   修正の後の再レビューを含め、タスクレビューを出す前に毎回 `step-update --slug <slug> --id <ステップ> --status reviewing` を実行する。
6. 所見があれば修正ループを回す。ループに上限は無い。所見を直させる前に `step-update --slug <slug> --id <ステップ> --status running` を実行する。この遷移で `implement.steps[k].attempts` が 1 増え、その値をラウンドの番号とする。
   - 1〜3 ラウンド: 同じ作業者が文脈を保ったまま続ける。委譲したときは同じ委譲先を続投させる。
   - 4 ラウンド以上: 2 ラウンドごとに(4・5、6・7、…)、作業内容に「行き詰まりの打開」と明記した新しい単位にする。委譲するときの委譲先の選び方は運用方針に任せる。state に新しい記録は足さない。
   - 自分で作業するときは、新しい単位に移るたびに、それまでの修正の方針を捨てて原因の調べ直しから始める。
7. レビューを通ったステップから、run ブランチへ順に `git merge --no-ff` する。マージしたステップは `step-update --slug <slug> --id <ステップ> --status merged --head <ステップのブランチの HEAD>` で記録する。衝突したら `git merge --abort` し、`--status failed` でそのステップを `failed` にする。グループの残りのマージが済んだ後、worktree を後始末してから新しい HEAD で作り直し、直列にやり直す。
8. グループのマージが済んだら、run ブランチでそのグループの実行する通すテストを実行する。
   - プロジェクトの test コマンドと `units/` のテストは自分で実行し、`e2e/` のテストは仕様のディレクトリごとの実行の単位にする。
   - 作業者が実行しなかったと報告した通すテストも、ここで含めて実行する。
   - 自分の実行結果と `e2e/` の単位の報告は、`steps/merge-test-<g>/report.md` に書く。
   - 失敗(環境の失敗を除く)は、修正を成果物を書く単位として run ブランチ上で直列に進め、報告を `steps/merge-fix-<g>/report.md` に書く。
9. 方式 b(dev-plan の `## 生成物`)では、全グループの後に、`final` の最終ステップ(生成物の生成とコミット)を run ブランチ上の単位にする。
10. 全グループと `final` の後、`references/e2e.md` に従って E2E のレポートをコミットしてから、implement 全体に対して `evaluate_code` を 1 回呼ぶ。渡すものは `raguel-gating` の対応表の implement の行に従う。続けて `pass-gate implement` する。

state を書くのはオーケストレーターだけである。作業者は `codiel-state` を呼ばない。オーケストレーター自身が作業者のときは、単位の作業の中では呼ばない。
