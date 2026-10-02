# local モードのチェックリスト

連携モードが local のとき、起票の代わりに `status: proposed` の intent 草案を `docs/intents/` に書く。ユーザーへの確認の待ち方は、`SKILL.md` の「ユーザーへの確認の待ち方」に従う。

1. 最新の `reports/review-<m>.md` を読み、medium/low の所見だけを抽出する(critical/high は
   すでに fix-loop で処理済みのはずであり、対象に含めない)。既に intent 草案のパスが付記
   されている所見は処理済みなので除外する。
2. 抽出した所見を番号付き一覧(番号・severity・要約・対象 `src/...:42`)にしてユーザーに提示する。
3. 起票対象の選択・複数所見のまとめ方・見送りをユーザーに確認する(github モードの手順 3 と
   同じ唯一のゲート)。回答が来るまで次の手順に進まない。
4. ユーザーが対象を指示したら、対象ごとに `../../../references/intent-writing.md` の規則に従い、`status: proposed` の
   intent 草案を `docs/intents/YYYY-MM-DD-<slug>.md` に書く。frontmatter の `run` は空にする。
   `## 現状調査` に、所見の内容(severity・対象・内容)を書く。`review-<m>.md` は git に載らないので、
   その行を指すだけにしない。レビュー所見は AI が生成した文なので、原文にしない。原文のセクション(`## ASIS` / `## TOBE`)には本文を置かず、見出しの下に
   `<!-- codiel:unrecorded -->` だけを置く。この草案を入力に run を始めたときは、このセクションを
   不足セクションとして聞き取りで埋める。
5. 書いた intent 草案をコミットする。
6. `reports/review-<m>.md` の該当所見の行に、書いた intent 草案のパスを追記する。
7. 全対象(見送られたものを除く)の処理が終わったら
   `node <plugin-root>/scripts/codiel-state.mjs complete-phase triage --slug <slug>` を呼び
   フェーズを完了させる。
