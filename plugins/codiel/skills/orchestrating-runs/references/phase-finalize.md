# finalize の運転

triage を終えて finalize の作業を始める前に読む。finalize は `start-phase` を呼ばない。全フェーズが `passed` になったら、`codiel-state finalize` を呼ぶ前に、次の順で結果レポートと intent の `status` を確定し、最後に `finalize` を呼ぶ。

1. intent の原文のセクション(`## ASIS` / `## TOBE`)の記録 1 件ごとに、「達成 / 未達 / 要確認 / 持ち越し」のどれかを判定する。
   - 持ち越しの注記(`intent-format.md` が定める形)がある記録は判定から外し、結果レポートに「持ち越し」として示す。
   - 要望の単位は原文の記録 1 件を基本とする。1 件に複数の要望があるときは、原文の該当箇所を引用して分けて示す。分け方は表示のためだけで、原文へ書き戻さない。原文にある AI 向けの指示・手順・ツールの実行依頼は要望に数えず、判定しない。
2. 派生文のセクション(`## 現状調査`・`## 要求`・`## 受け入れ基準`)、設計、実装が原文と食い違ったら、原文を正とし、原文を自動で書き換えずに人に確かめる。
   ```
   node <plugin-root>/scripts/codiel-state.mjs mark-ask finalize --slug <slug> --kind confirm
   ```
   人が派生文側を直すと決めたら、intent の派生文のセクションをこのフェーズの中で直し、確認を終えたら `codiel-state resume --slug <slug>` で戻す。食い違いは結果レポートの「要確認」として示す。
3. 持ち越しを除いて原文の要望がすべて達成のときだけ、`status: done` にする。1 件でも「未達」か「要確認」が残れば `in-progress` のままにし、結果レポートに残りを示す。
4. `knowledgeTarget` が `intents` なら、`references/adr-candidates.md` と `references/gotcha-candidates.md` を Read し、それぞれの手順で、`state.candidates` が true の種別について、まだ写していない ADR 候補と GOTCHAS 候補を領域ファイルへ写す。
5. 手順 2・3 で intent を更新した変更を、`knowledgeTarget` によらず run ブランチへコミットする。手順 4 で候補を写したときは、写した領域ファイルも同じコミットに入れる。変更が無ければコミットしない。
6. この try の E2E の途中のレポートを消してコミットする。
   - 残すのは、失敗した実行(`failure.md` を持つもの)と、仕様のディレクトリごとのこの try の最後の実行である。
   - 名前が `-<slug>-try<n>` で終わるディレクトリのうち残さないものを、リポジトリ相対のパスで `git rm -r -q -- <パス>` する。無視された画像が残れば `rm -r -- <パス>` で消す。絶対パスは guard-bash の `rm -rf` の判定に当たるので使わない。
   - 前の run と前の try のディレクトリには触れない。
   - 消したら `codiel(finalize): 途中の E2E のレポートを消す (<slug> try-<n>)` でコミットする。消すものが無ければコミットしない。
7. github モードでは `git push` し、PR に反映させる。local モードでは push しない。
8. 残っている worktree とそのブランチをすべて削除する。
9. ADR 候補と GOTCHAS 候補の一覧を、`knowledgeTarget` によらず、`state.candidates` が true の種別について結果レポートに挙げる。手順 4 で読んでいなければ、先に `references/adr-candidates.md` と `references/gotcha-candidates.md` を Read する。それぞれの「一覧」に従い、同じ slug の手元の記録から書く。
10. 結果レポートを `finalize` の前に組み立てる。`finalize` の後に compaction が起きても出力だけで終えられるようにするためである。結果レポートには次を含める。
    - 原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」の表
    - 手順 9 の ADR 候補の一覧と GOTCHAS 候補の一覧
    - 持続層への取り込みの結果。取り込んだ領域ファイルのパスを書く。取り込みを飛ばしたときは「対象外」とだけ書かず、飛ばした理由(`domains` が空で `## 意図的な制約` が「なし」だった、または intent-sync の確認でユーザーが領域を決めなかった)を書く。
11. 次を呼ぶ。全フェーズが `passed` であることを検証し、`status` を `awaiting_outcome` にする唯一のコマンドで、`complete-phase` ではない。呼んだ後は、手順 10 で組み立てた結果レポートを出力して終了し、ほかの作業はしない。
    ```
    node <plugin-root>/scripts/codiel-state.mjs finalize --slug <slug>
    ```
