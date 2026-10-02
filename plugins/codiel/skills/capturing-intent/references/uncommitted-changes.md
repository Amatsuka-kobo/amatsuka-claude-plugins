# intent 以外の未コミットの変更の扱い

手順 5 の (3) で、intent 以外の未コミットの変更があるときに読む。変更をユーザーに示して、扱いを決めてもらう。

- 終える(intent-only)とき: intent 以外の変更には触れず、作業ツリーに残すことを告げる。
- 続行するとき: この後の `git switch -c` が stage 済みの intent もほかの未コミットの変更も新しいブランチへ持ち越すことを示し、AskUserQuestion で扱いを聞く。選択肢は「コミットしてから始める(推奨)」「退避する」「持ち越す」とする。
  - コミットしてから始める: 変更をユーザーが見られる形で示し、パスを指定して `git add -- <パス>` とコミットを行う。intent 以外のステージ済みの変更を巻き込まない。
  - 持ち越す: 持ち越した変更が、code 系のゲート(`evaluate_code`)で未コミットの変更を評価できずに止まること、pr フェーズ前の `git status --short` の確認で止まること(`orchestrating-runs` 2.1 の確認義務)を示す。run に無関係なファイルなら、`.codiel/config.json` の `raguel.subject.ignoreUncommitted` に glob を宣言すればゲートで止まらないことも示す。run の間は guard が `.codiel/config.json` への書き込みを拒むので、宣言は run の前、この (3) の中で済ませる。
  - 退避する: `git stash push -m <タグ> -- <intent 以外のパス>` をパスを指定して使う。intent も持っていく `git stash -u` は使わない。自動では退避しない。退避はこの (3) の中で済ませる。
