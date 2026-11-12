# worktree とテストを実行する単位

test-code・implement・test-loop・fix-loop に入ったとき、および carry-over の所見の修正の単位を始めるときに読む。

## worktree

test-code・implement・test-loop の並列の単位として登録した要素は、作業者によらず、1 ステップまたは 1 仕様のディレクトリにつき 1 worktree で作業する。オーケストレーターが自分で 1 つずつ処理するときも同じである。直列の単位(`serial` グループ・`final`・run ブランチ上の修正)は run ブランチ上で作業する。

- パスは `.codiel/worktrees/<slug>/<名前>`、ブランチは `codiel/<slug>-try-<n>-<名前>` とする。
- 名前は、implement のステップが `step-<k>`、test-code が `test-code-<k>`、test-loop の修正が `test-loop-<k>` である。k は、その表(`implement.steps` / `testCode.units` / `testLoop.units`)に登録した順の番号(1 から)で、test-loop の登録し直しでも変わらない。
- 起点は、そのグループ・仕様のディレクトリを始める時点の run ブランチの HEAD とする。
- 作成は `git worktree add -b codiel/<slug>-try-<n>-<名前> .codiel/worktrees/<slug>/<名前> <run ブランチ>` で行う。
- worktree のパスは run の中で一意にする。`step-update --worktree` は、ほかの要素がすでに記録したパスを拒否する。
- run の最初の worktree を作るときに、`.codiel/worktrees/` を `.git/info/exclude` へ加える。
- worktree の開始時に、dev-plan の `## 環境準備` のコマンドで依存をインストールする。「なし」のときは lockfile の種類から既定を選び、lockfile が無ければ省く。
- worktree の中のコマンドは、単独の `cd` を使わず、`git -C <パス>` か `( cd <パス> && <コマンド> )` のサブシェルで実行する。
- マージ済みの worktree は、マージの直後に `git worktree remove` し、ブランチを削除する。空になった `.codiel/worktrees/<slug>/` は、リポジトリ相対のパスの `rmdir` で消す。`rmdir` は空でなければ失敗するので、残った worktree を巻き込まない。
- 失敗した worktree は run の終了まで残す。やり直す前に削除し、新しい HEAD で作り直す。

## 並列に進める場合

単位同士を並列に進めるかは運用方針に任せる。並列に進める場合は、次の 3 つの条件を満たす単位に限る。

- 書き込むファイルが重ならない。
- 互いの成果を入力にしない。
- テストを実行する単位は、下の「並列可」に当たるものだけとし、同時に 4 件まで並べる。

中でテストを実行する単位は、並列可と単独の 2 種類に分ける。対象は、test-code の単位、implement の実装と修正ラウンドの単位、グループのマージの後の `e2e/` の実行の単位、test-loop と fix-loop の `e2e/` の回帰の実行の単位、test-loop の修正の単位、run ブランチ上の修正の単位、環境の失敗の実行し直しの単位である。タスクレビューのような読み取りだけの単位には当てない。

- 並列可の単位: テストの置き場がすべて `parallel: true` の仕様のディレクトリである単位。`parallel` は `spec.md` の frontmatter の値である。動いている単位(同じフェーズでこの規則を当てる単位のうち、作業が終わっていないもの)が無いか、並列可の単位だけのときに始める。同時に動かすのは 4 件までとし、委譲するときは、始められるものが 2 件以上あれば、上限の範囲で同じ応答からまとめて出す。
- 単独の単位: 並列可に当たらないもの。動いている単位が無いときだけ始め、終わるまで同じフェーズのほかの単位を始めない。次の単位が当たる。
  - implement の単位で、通すテストに `parallel` の無い仕様のディレクトリを含むもの
  - `parallel` の無い仕様のディレクトリの test-code と test-loop の修正
  - test-loop と fix-loop の `e2e/` の回帰の実行
  - run ブランチ上の修正

test-code と test-loop の修正は、担当する仕様のディレクトリの `parallel` で種類が決まる。implement では単位ごとに選ぶ。ステップが 2 つ以上のグループの単位(最初の実装と修正ラウンド)は、そのステップの通すテストがすべて `parallel: true` の仕様のディレクトリにあるときだけ並列可にし、それ以外は単独にする。ステップが 1 つのグループ・`serial` グループ・`final`・衝突の後のやり直しは、通すテストによらず単独にする。

オーケストレーターが自分で実行するテスト(プロジェクトの test コマンドと `units/` のテスト)は、run ブランチ上で直列に実行する。実行してよいかは、同じフェーズで動いている単位で決める。

- 動いている単位が無いとき: すべて実行する。
- 動いている単位が並列可だけのとき: `parallel: true` の仕様のディレクトリのテストだけを実行する。
- 単独の単位が動いているとき: 実行しない。単独の単位は、ほかのテストと資源を取り合う。run ブランチ上の単独の単位は作業ツリーも書き換える。

## 環境の失敗

環境の失敗(サーバーが起動しない、接続が拒否される、ポートが使用中、必要なサービスが無いなど)は、未実装の失敗にもプロダクトの失敗にも数えない。

- 作業者が報告した環境の失敗は、動いている単位が無いときに 1 回だけ単独で実行し直す。実行し直した結果は、元の報告の末尾の `## 実行し直し` のセクションへ書く(state は変えない)。
- 自分で実行したテストの環境の失敗も、自分で 1 回だけ実行し直し、その回の報告の `## 実行し直し` のセクションへ書く。
- 中断後の再開では、`## 実行し直し` のセクションの有無で実行し直しが済んだかを判断する。
- 実行し直しても環境の失敗なら、`mark-ask <phase> --slug <slug> --kind confirm` の後に人に確かめる。

## 報告の置き場

単位の報告と自分の実行結果は、次の置き場へ書く。委譲したときは委譲先の返答から、自分で作業したときは自分の結果から、オーケストレーターが書く。パスは `.codiel/runs/<slug>/try-<n>/` からの相対である。brief を書く単位は、同じディレクトリに `brief.md` を置く。

| 報告 | 置き場 |
| --- | --- |
| `parallel` グループの各ステップ・test-code・test-loop の各仕様のディレクトリ | `steps/<worktree の名前>/report.md` |
| `serial` グループと `final` | `steps/step-<k>/report.md` |
| グループのマージの後の修正 | `steps/merge-fix-<g>/report.md` |
| グループのマージの後のテストの実行(自分の実行結果と `e2e/` の実行の単位の報告を合わせる) | `steps/merge-test-<g>/report.md` |
| test-loop のどの仕様のディレクトリにも属さない失敗の修正 | `steps/test-loop-project/report.md` |
| carry-over の所見の修正(run ブランチ上の単位) | `steps/carry-over-fix-<m>/report.md` |
| test-loop の回帰(自分の実行結果と `e2e/` の単位の報告を合わせる) | `reports/test-run-<n>.md` |
| fix-loop の回帰 | `reports/test-run-<n+1>.md` |

g は、そのグループのステップの state の `group.index`(0 から)に 1 を足した値である。m は、その try で carry-over の修正の単位を始めた順の番号(1 から)である。
