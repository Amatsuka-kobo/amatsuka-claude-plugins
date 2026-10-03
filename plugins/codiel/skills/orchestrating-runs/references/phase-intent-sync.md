# intent-sync の運転

`start-phase intent-sync` の直後に読む。書き戻しと持続層への取り込みは `syncing-intents` に従う。

intent-sync を書く前に、intent の frontmatter `domains` と `## 意図的な制約` を読み、取り込み先を次の分岐で決める。人の確認で止まった後に再開するときは、書く直前に intent をもう一度読み、`domains` をこの時点の値に置き換えてから分岐を決める。

分岐を決める前に `references/adr-candidates.md` を Read する。取り込みで ADR の 3 条件を満たす判断を見つけたら、その手順で手元の記録に ADR 候補を書く。

`knowledgeTarget` が `intents` のときは、分岐を決める前に `references/gotcha-candidates.md` も Read し、同じ slug の手元の記録に、まだ写していない ADR 候補と GOTCHAS 候補があるかを確かめる。候補があれば、下の分岐では `## 意図的な制約` に行があるときと同じに扱う。取り込みを行うときは、取り込みで書いた ADR 候補とあわせて、それぞれの手順で候補を領域ファイルへ写す。

- `domains` が空で、`## 意図的な制約` の表に 1 行以上ある(「なし」でない)ときは、次の順に進める。
  1. `mark-ask intent-sync --slug <slug> --kind confirm` で `awaiting_human` にする。
  2. 制約の行と、`domains` が空であることを示し、AskUserQuestion で領域名を聞く。候補は、ドメインマップが読めればそのキー、読めなければ TOBE と現状調査から作った 2〜3 個(英小文字のケバブケース)にする。複数を選べるようにし、候補の外の答えも受ける。
  3. 決まった領域名を intent の frontmatter `domains` に 1 行のフロー形式で書く。
  4. `resume` で戻し、`domains` を使って intent-sync を書く。frontmatter の変更は、intent-sync の成果物と一緒にコミットする。
- 領域を決めないと答えたときは、`domains` を空のまま `resume` し、取り込みを行わずに進む。
- `## 意図的な制約` が「なし」で `domains` が空なら、確かめずに取り込みを行わない。`## 目的` と `## 非スコープ` だけのために領域を聞かない。
- 取り込み先は `domains` の領域とする。取り込まなかったときは、その理由と、`## 意図的な制約` に行があったかを finalize の結果レポートに書く(`references/phase-finalize.md`)。
