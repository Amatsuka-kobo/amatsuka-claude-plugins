# worktree とテストを実行する委譲

test-code・implement・test-loop・fix-loop に入ったときに読む。

## worktree

test-code・implement・test-loop の並列の委譲は、1 ステップまたは 1 仕様のディレクトリにつき 1 worktree で行う。

- パスは `.codiel/worktrees/<slug>/<名前>`、ブランチは `codiel/<slug>-try-<n>-<名前>` とする。
- 名前は、implement のステップが `step-<k>`、test-code が `test-code-<k>`、test-loop の修正が `test-loop-<k>` である。k は、その表(`implement.steps` / `testCode.units` / `testLoop.units`)に登録した順の番号(1 から)で、test-loop の登録し直しでも変わらない。
- 起点は、そのグループ・仕様のディレクトリを始める時点の run ブランチの HEAD とする。
- 作成は `git worktree add -b codiel/<slug>-try-<n>-<名前> .codiel/worktrees/<slug>/<名前> <run ブランチ>` で行う。
- worktree のパスは run の中で一意にする。`step-update --worktree` は、ほかの要素がすでに記録したパスを拒否する。
- run の最初の worktree を作るときに、`.codiel/worktrees/` を `.git/info/exclude` へ加える。
- worktree の開始時に、dev-plan の `## 環境準備` のコマンドで依存をインストールする。「なし」のときは lockfile の種類から既定を選び、lockfile が無ければ省く。
- マージ済みの worktree は、マージの直後に `git worktree remove` し、ブランチを削除する。空になった `.codiel/worktrees/<slug>/` は、リポジトリ相対のパスの `rmdir` で消す。`rmdir` は空でなければ失敗するので、残った worktree を巻き込まない。
- 失敗した worktree は run の終了まで残す。やり直す前に削除し、新しい HEAD で作り直す。

## テストを実行する委譲の並べ方

中でテストを実行する委譲は、並列可と単独の 2 種類に分けて出す。対象は、test-code の委譲、implement の実装と修正ラウンドの委譲、グループのマージの後の `e2e/` の実行の委譲、test-loop と fix-loop の `e2e/` の回帰の実行の委譲、test-loop の修正の委譲、run ブランチ上の修正の委譲、環境の失敗の実行し直しの委譲である。タスクレビューのような読み取りだけの委譲には当てない。

- 並列可の委譲: `spec.md` の frontmatter に `parallel: true` を持つ仕様のディレクトリで、そのテストだけを実行する委譲。動いている委譲(同じフェーズでこの規則を当てる委譲のうち、待ちの記録が残っているもの)が無いか、並列可の委譲だけのときに出す。同時に動かすのは 4 件までとし、出せるものが 2 件以上あれば、上限の範囲で同じ応答からまとめて出す。
- 単独の委譲: 並列可に当たらないもの(implement のすべての通すテストを実行する委譲、`parallel` を持たない仕様のディレクトリの test-code・test-loop の修正、test-loop と fix-loop の `e2e/` の回帰の実行、run ブランチ上の修正)。待ちが空のときだけ出し、その待ちが残っている間は同じフェーズのほかの委譲を出さない。

test-code と test-loop の修正は、担当する仕様のディレクトリの `parallel` で種類が決まる。implement では委譲ごとに選ぶ。ステップが 2 つ以上のグループの最初の委譲は並列可、ステップが 1 つのグループ・`serial` グループ・`final`・衝突の後のやり直しは単独にする。修正ラウンドの委譲は、動いている委譲があれば並列可、無ければどちらでもよい。

オーケストレーターが自分で実行するテスト(プロジェクトの test コマンドと `units/` のテスト)は、run ブランチ上で直列に実行する。上の 2 種類の規則は委譲にだけ当てる。実行してよいかは、同じフェーズで動いている委譲で決める。
- 動いている委譲が無いとき: すべて実行する。
- 動いている委譲が並列可だけのとき: `parallel: true` の仕様のディレクトリのテストだけを実行する。
- 単独の委譲が動いているとき: 実行しない。単独の委譲は、ほかのテストと資源を取り合う。run ブランチ上の単独の委譲は作業ツリーも書き換える。

## 環境の失敗

環境の失敗(サーバーが起動しない、接続が拒否される、ポートが使用中、必要なサービスが無いなど)は、未実装の失敗にもプロダクトの失敗にも数えない。

- 委譲先が返した環境の失敗は、動いている委譲が無いときに 1 回だけ単独で実行し直させる。実行し直した委譲の返答は、元の報告の末尾の `## 実行し直し` のセクションへ書く(state は変えない)。
- 自分で実行したテストの環境の失敗は、自分で 1 回だけ実行し直し、その回の報告の `## 実行し直し` のセクションへ書く。
- 中断後の再開では、`## 実行し直し` のセクションの有無で実行し直しが済んだかを判断する。
- 実行し直しても環境の失敗なら、`mark-ask <phase> --slug <slug> --kind confirm` の後に人に確かめる。

## 報告の置き場

委譲の返答と自分の実行結果は、次の置き場へ書く。パスは `.codiel/runs/<slug>/try-<n>/` からの相対である。brief を書く委譲は、同じディレクトリに `brief.md` を置く。

| 報告 | 置き場 |
| --- | --- |
| `parallel` グループの各ステップ・test-code・test-loop の各仕様のディレクトリ | `steps/<worktree の名前>/report.md` |
| `serial` グループと `final` | `steps/step-<k>/report.md` |
| グループのマージの後の修正 | `steps/merge-fix-<g>/report.md` |
| グループのマージの後のテストの実行(自分の実行結果と `e2e/` の実行の委譲の返答を合わせる) | `steps/merge-test-<g>/report.md` |
| test-loop のどの仕様のディレクトリにも属さない失敗の修正 | `steps/test-loop-project/report.md` |
| test-loop の回帰(自分の実行結果と `e2e/` の委譲の返答を合わせる) | `reports/test-run-<n>.md` |
| fix-loop の回帰 | `reports/test-run-<n+1>.md` |

g は、そのグループのステップの state の `group.index`(0 から)に 1 を足した値である。
