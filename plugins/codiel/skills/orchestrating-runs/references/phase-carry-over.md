# carry-over の運転

`start-phase carry-over` の直後に読む。carry-over は、前の try から run ブランチに残るコードを、分岐点からの差分としてゲートで評価するフェーズである。try-1 では `init` が `SKIPPED` にするので、このファイルを読む場面は無い。

1. `raguel-gating` の対応表に従い、`evaluate_code`(`phase: carry-over`、`baseRef` は carry-over の `startHead`)を呼ぶ。`startHead` は `start-phase` が記録したベースブランチとの分岐点なので、intent の評価の後のコミットも差分に入る。
2. PROCEED なら `pass-gate carry-over` する。返った findings は、design(軽量では dev-plan)の入力と、依頼文の「前フェーズの申し送り」にする。
3. ASK なら `raguel-gating` の手順で人に確かめる。選択肢は「承認して続ける(findings を後のフェーズへ申し送る)」「修正して再提出」「stop」とする。
4. STOP は、誤検知の裁定なら `raguel-gating` の手順で通す。妥当の裁定なら、「修正して再提出」と「stop」を人に選ばせる。carry-over だけは、妥当の STOP の後も修正して再評価できる。
5. 修正して再提出するときは、所見を直す委譲(実装の委譲、`implementing` の修正モード)を run ブランチ上で出す。委譲先にコミットさせてから、`evaluate_code` をやり直す。`startHead` は変えない。
6. 修正の委譲には、テストと `<testsDir>/**` の仕様を書き換えさせない。
