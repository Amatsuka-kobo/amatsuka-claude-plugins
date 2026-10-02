# active run の扱い

`get --active` が `active` または `awaiting_human` の run を返したときに読む。

見つかった run が今回再開する run かどうかを、次のとおり判定する。

- 入口が intent パスで、その frontmatter の `run` が見つかった run の slug と一致するときは、確かめずに今回再開する run とみなす。
- 入口が intent パスで、frontmatter の `run` では当たらないが、見つかった run の state の `intent`(repoRoot 相対にしたもの)が入口のパスと同じときは、state の `intent` だけで当たった run とみなす。作業ツリーに intent のファイルが無く frontmatter を読めないときも、この照合で再開する run を見つけられる。この run は確かめずには再開せず、内容(slug・intent のパス・現在のフェーズ)を示して今回再開するかをユーザーに確かめる。
- それ以外(上の 2 つに当たらない intent パス、Issue 番号、省略)では、見つかった run が `commands/run.md` の「未完了の run があれば再開」に当たる可能性がある。終端にする前にその run の内容(slug・intent のパス・現在のフェーズ)を示し、今回再開するかをユーザーに確かめる(run を作る前なので `mark-ask` は要らない)。

今回再開する run と決まったものは終端にせず、`orchestrating-runs` の `references/resume.md` へ進める。

`get --active` は複数件を返しうる。再開すると決まった 1 件以外のすべてについて、1 件ずつ内容(slug・intent のパス・現在のフェーズ)を示し、終端にしてよいかを確かめる。確認文には、終端にすると `stop` で止まり、その intent が `abandoned` になることを含める。

確認が済んでいない run は終端にしない。終端にしてよいと答えたものだけを、次のいずれかで終端にする。終端を拒まれた run があるときは、その run を残したまま進めてよいかをユーザーに確かめる。

- `codiel-state finalize --slug <slug>`
- 前のセッションから残った待ちを `codiel-state wait-clear --slug <slug>` で消してから、`codiel-state stop --slug <slug> --reason <理由>`

この確認で、手順 5 の (1)〜(3) の間は、再開する run 以外に active run が無い状態になる。
