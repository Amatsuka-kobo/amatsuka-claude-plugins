## PR 本文

PR の本文は、行った変更の説明を中心にする。要望と経緯は intent 文書にあるので、PR にはリンクだけを置く。PR を作るのは github モードだけで、local モードの pr フェーズは state に記録するだけで本文を書かない。

- 変更の説明は、何をどう変えたかを `git diff <base>...<run ブランチ>` と `dev-plan.md` から書く。
- ほかに入れるのは次だけである。
  - `Closes #<N>`(`state.issue` があるとき)
  - 変更を示す画像(UI の変更など。載せ方は `github-writing-images.md` に従う)
  - intent 文書へのリンク
  - テストの結果(test-loop の最後の `test-run-<n>.md` のサマリ)
  - `<!-- codiel:generated -->`
- 要望・受け入れ基準・原文の転記と、run の経緯(フェーズの進み方、ゲートの記録、修正の往復)は入れない。
- `## 出典` を置かない。「引用・出典は削らず末尾にまとめる」はここでは当てない。
- intent 文書へのリンクは `https://<remoteHost>/<repoSlug>/blob/<SHA>/<state.intent>` の形にする。`remoteHost` と `repoSlug` は環境判定の出力、SHA は本文を書く直前の run ブランチの HEAD である。ブランチ名でなく SHA を使うのは、マージの後に run ブランチを消してもリンクが切れないようにするためである。
