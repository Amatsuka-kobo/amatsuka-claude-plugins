# review の観点と所見の統合

review に入ったときと、fix-loop で再レビューの委譲を出す前に読む。

## 観点を選ぶ規則

観点は、`<plugin-root>/skills/reviewing-diffs/references/` にある frontend・backend・data・doc・security・infra・generic の 7 つから選ぶ。

- `git diff --name-only <base>...<branch>`(`<base>`・`<branch>` は、委譲の依頼文に書く「diff の範囲」の値と同じ)の変更パスと内容から、frontend・backend・data・infra のうち当たる観点を選ぶ。
- doc と security は、変更の内容によらず毎回選ぶ。
- generic は、frontend・backend・data・infra のどれにも当たらず、doc の担当でもない変更パスがあるときだけ選ぶ。Markdown などの文書と、run の成果物(`docs/intents/` の intent 文書、agenda・discussion・design・dev-plan)は doc の担当なので、generic を選ぶ理由にしない。
- fix-loop の再レビューも、同じ規則で観点を選び直す。所見が出た観点だけに絞らない。
- 観点ごとに読み取りだけの委譲を 1 つ出し、その依頼文に `<plugin-root>/skills/reviewing-diffs/references/<観点>.md` を足す。観点ファイルの存在は `Glob` か `ls` で確かめる。

## 所見の統合と投稿

観点ごとの返答を本文 §3 の手順で `waits/<id>.md` に書き、グループの待ちがすべて消えてから行う。

1. `reports/review-<m>.md` を書く。`<m>` はレビューの回の番号で、review フェーズが 1、fix-loop の再レビューごとに 1 つ増える。
   - 先頭の段落に、選んだ観点ごとに 1 行、観点の名前とその観点を選んだ理由(当たった変更パス)を書く。この段落は所見の一覧の外に置く。
   - 所見を severity 順(critical → high → medium → low)に並べる。
   - 同じ対象・内容の所見が複数の観点から出たら、最も高い severity で 1 件に統合し、観点を併記する。
   - 委譲先は所見を 1 件ずつ、次の項目で返す。統合では、これらをそのまま保つ。
     - severity: critical・high・medium・low のいずれか。
     - 一行要約。
     - 観点: 委譲した観点ファイルの名前(frontend・backend・data・doc・security・infra・generic)。
     - 対象: `src/...:42` の形。github モードの行コメントはこの値で投稿する。
     - 抜粋・内容・根拠・提案。
   - 返答の確認方法に「実行できなかった」とあるテスト・型検査は、所見の一覧には入れない。観点ごとの確認結果として `review-<m>.md` に書く。
2. local モードでは投稿しない。`review-<m>.md` の記録だけを成果物とする。
3. github モードでは、`<plugin-root>/references/github-writing.md` の執筆規則でレビュー本文を組み立てて投稿する。
   - 概要(件数・severity の内訳・fix-loop の対象の有無)に `<!-- codiel:generated -->` を含める。
   - テストで得たスクリーンショットなど関連する画像があれば、`<plugin-root>/references/github-writing-images.md` にあるレビュー本文の縮退の順序で載せる。
   - 本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/review-body-<m>.md` に書き、別の Bash 呼び出しで `gh pr review <PR番号> --comment --body-file .codiel/runs/<slug>/try-<n>/reports/review-body-<m>.md` を実行する。
4. github モードでは、各所見の「対象」(`src/...:42` の形)に対応する行コメントを投稿する。
   - 本文に `<!-- codiel:generated -->` を含め、所見ごとに Write ツールで `.codiel/runs/<slug>/try-<n>/reports/review-comment-<連番>.md` に書く。連番は同じ try の中で通し番号とし、レビューの回をまたいでも振り直さない。
   - 行コメントの `commit_id` には PR の head を使う。値は `gh pr view <PR番号> --json headRefOid` で取る。手元のコミットを `commit_id` に使うための push は guard-bash が止めるので、review では push しない。
   - 別の Bash 呼び出しで、`gh api` を `-F body=@.codiel/runs/<slug>/try-<n>/reports/review-comment-<連番>.md` の形で呼んで投稿する。
