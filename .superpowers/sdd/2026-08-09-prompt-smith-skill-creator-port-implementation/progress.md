# SDD ledger — plan: docs/plans/2026-08-09-prompt-smith-skill-creator-port-implementation.md

Task 1: complete (commits 7b09b0d..87d862b, review clean)
Task 2: minor (deferred): stripChar の「同じ引用符が連続する場合」を検証するテストが無い(ブリーフ由来)
Task 2: complete (commits 87d862b..aca1097, review clean)
Task 3: minor (deferred): 判定確定後に TriggerDetector を再利用する経路が未テスト(契約外の使い方)
Task 3: complete (commits aca1097..0ca02c8, review clean)
Task 4: BLOCKED を解消 — 計画のテスト 2 件が JSON.stringify と矛盾していたため計画側を修正
Task 4: fix round 1/5 開始 — plan-mandated 2 件(ブロックスカラー内の空行 / frontmatter 解析の重複)をユーザー判断で「2 件とも直す」
Task 4: fix round 1/5 (2 addressed, 0 open; commits df5ddd9..eccd3ed)
Task 4: minor (deferred): replaceDescription の JSDoc が BLOCK_SCALARS 定数にぶら下がって見える(見た目のみ)
Task 4: complete (commits 0ca02c8..eccd3ed, review clean)
Task 5: minor (deferred): main() が移植元の親切なエラー文言と --verbose の要約行を落としている(UX の後退)
Task 5: minor (deferred): replaceDescription が main と runSingleQuery で二重適用される旨のコメントが無い
Task 5: 対照実験の結果 skills 10/24 / commands 10/24。登録先は判別要因でないと判明し、設計書 §1・§4.1#1・§8.1・§11.1・§13 とプラン Task 14 を実測に合わせて訂正
Task 5: fix round 1/5 (1 addressed, 0 open; commits 8ae2505..32a6571)
Task 5: complete (commits eccd3ed..32a6571, review clean)
Task 6: minor (deferred): Math.floor と Python int() の等価性が非負入力に依存する旨のコメントが無い
Task 6: complete (commits 32a6571..23f1f03, review clean)
Task 7: minor (deferred): main() に --log-dir / --iteration があるがブリーフの列挙に無い
Task 7: minor (deferred): stripQuotes が parse-skill-md.ts の stripChar と同一アルゴリズムの再実装(6 行)
Task 7: minor (deferred): --log-dir の書き込みと main() 自体のテストが無い(ブリーフ由来)
Task 7: complete (commits 23f1f03..57853b5, review clean)
Task 8: fix round 1/5 (1 addressed, 0 open; commits a749721..3b21194)
Task 8: minor (deferred): onIteration が前の反復の exit_reason を渡す(1 反復ずれる)。Task 9 の消費側で注意
Task 8: minor (deferred): blindHistory の戻り値の型境界が弱い(description だけ as string)
Task 8: minor (deferred): runLoop のテストが runEval の description 引数の変化を検証していない(ブリーフ由来)
Task 8: minor (deferred): run-trigger-eval.mjs だけシバンが無い
Task 8: complete (commits 57853b5..3b21194, review clean)
Task 9: 実地確認で異常を 1 件観測 — improve-description の claude -p が eval と全く無関係な日本語テキスト(このセッションの抗体蒸留の話)を返し、<new_description> タグも無かったため全文が新 description として採用された。ループ自体は正しく動き、スコアが下がったので best は初回のまま維持された。ローカルプロキシの多重化が疑われる。Task 13 の本番実行前に要確認
Task 9: fix round 1/5 (1 addressed, 0 open; commits 7c9738b..a1f828e)
Task 9: minor (deferred): escape のテストが < > だけで & と " を検証していない。query と skillName の escape もテストが無い
Task 9: minor (deferred): in progress / Current best のライブマスキングにテストが無い
Task 9: minor (deferred): run-loop.ts が 506 行で src 内最大。--report の配線は抽出できる
Task 9: minor (deferred): --report "" (空文字) が none と同じ扱いになる
Task 9: complete (commits 3b21194..a1f828e, review clean)
Task 10: complete (commits a1f828e..4f7f6a6, review clean)
Task 11: parked (要ユーザー判断) — 公式 Writing Style の核心「explain the why」が prompt-smith の「根拠は削り指示だけ残す」と方向が逆で、本文にも委譲先にも残っていない。設計書 §8.6 のマッピングに内在する緊張。実行品質の問題ではない
Task 11: minor (deferred): SKILL.md:9 が 1 文に 2 動作(姉妹スキルとの表記統一を優先した判断)
Task 11: minor (deferred): rationale に「移植元が更新されたときの同期」への言及が無い
Task 11: complete (commits 4f7f6a6..1d7ff71, review clean, 1 parked)
Task 12: minor (deferred): agent-creator/SKILL.md:37 が 1 文に 2 指示(ブリーフ指定の文言をそのまま移植したもの)
Task 12: complete (commits 1d7ff71..4ead088, review clean)
Task 13: eval セット 3 本をユーザーが承認。commit fbba09d
Task 13: 改善ループの実行は時間の都合で別セッションへ持ち越し
決定 (2026-08-10): 「explain the why」は放置。prompt-smith の基準を優先する
決定 (2026-08-10): タグ無し応答のフォールバックは移植元どおりのままとする
引き継ぎ書: docs/handover/2026-08-10-prompt-smith-skill-creator-port.md
Task 13: 改善ループ 1 回目の実行は 3 本とも失敗 — improve の claude -p が 300s タイムアウトし run-loop が異常終了(exit 1)。測定結果が全損した
Task 13: 失敗の相関 — improve の成否がメインセッションの応答生成中かどうかと一致。idle 中の 2 回は 127.7s / 132.9s で成功、生成中の 4 回は汚染 1 回・タイムアウト 3 回。Task 9 の異常は一過性ではなく同じ根(ローカルプロキシの同時実行)
決定 (2026-08-10): タグ無し応答のフォールバックを覆す。タグ必須+1 回再依頼、2 回目も無ければエラー。2026-08-10 の「移植元どおり据え置き」は異常が一過性という前提の決定だった
決定 (2026-08-10): improve の失敗は種類を問わずループを打ち切って best-so-far を返す。死んでいた timeoutSeconds を配線し --improve-timeout / --timeout を追加
決定 (2026-08-10): ループはオーケストレーターが起動し、完走通知まで応答を生成しない
Task 13/14 外の修正: commit 37e2bd4(改善ループの全損対策、テスト 96 件 PASS)
Task 14: README 新設・ルート README 反映・抗体 ab-2026-0802-001 の書き換え完了。commit daf9e8e
Task 14: Step 4 の grep は docs/ の日付入り履歴に 28 件残る。生きた指示書側は 0 件。履歴の改変は行わない判断
Task 13: 改善ループ 2 回目 3 本とも完走(exit 0)。--improve-timeout 600、開始前 300s の待ち、実行中はメインセッションを止めた
Task 13: skill-creator best=反復 1(現行) train 9/12 test 7/8。反復 3/4 は train 10/12 だが test 据え置きで holdout が過学習を棄却。exit_reason=improve_failed(iteration 4) で打ち切り、測定は保全された
Task 13: agent-creator best=反復 4 train 12/12 test 7/8(現行 9/12・5/8)。適用。commit 6ad8d41。YAML はブロックスカラー |- で書き、測定文字列とバイト一致を確認
Task 13: prompt-smith best=反復 2 train 6/12 test 5/8(現行 5/12・4/8)。差が holdout 8 問中 1 問でばらつきの範囲、かつ英語になるためユーザー判断で現行据え置き
Task 13: 3 スキルとも偽陽性ゼロ。失敗はすべて expected=true の取りこぼし。prompt-smith は 5 反復とも test 4〜5/8 で頭打ち
Task 13: complete (commits fbba09d..6ad8d41)
Task 14: complete (commits 4ead088..daf9e8e)
最終レビュー: マージブロッカーなし。採用 4 件 + 追加 1 件を commit d19ae34 で対応
最終レビュー: pool.ts への Copyright Anthropic, PBC 追加は不採用。置き換えているのは Python 標準ライブラリの ProcessPoolExecutor であって Anthropic のコードではない。代わりに NOTICE のファイル対応表で帰属と、pool.ts だけ表記が違う理由を明示
最終レビュー: 未処理 minor 20 件のうち 14 件は残す判断。残り 6 件のうち 5 件を d19ae34 で解消、Task 8 の onIteration ずれは generateHtml が exit_reason を描画しないため無症状として残す
最終レビュー: 追加で見つけた穴 — 失敗経路の writeTranscript が自分で例外を投げると本来の失敗理由がすり替わる。writeTranscriptBeforeThrow で塞ぎ、ガード無しで落ちることをテストで確認
検証: pnpm build / pnpm test (1125 件 PASS) / pnpm typecheck / pnpm lint すべて成功
