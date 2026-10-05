# Raguel の作り直し 実装の引き継ぎ書

- 日付: 2026-09-29
- 引き継ぎ元: Raguel の作り直しの設計セッション(設計書と実装計画書の承認とコミットまで完了)
- 引き継ぎ先: Raguel の作り直しの実装セッション(Dynamic Workflow で計画書を最後まで実行する)
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign`、ブランチ `raguel-redesign`

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 第 7 版・承認済み。`harness-docs/design/2026-09-28-raguel-redesign-design.md`(`c5fa33c3` で第 6 版、`4bf7680a` で第 7 版) |
| 実装計画書 | 第 3 版・承認済み。`harness-docs/plans/2026-09-29-raguel-redesign-plan.md`(`4e60400b`) |
| M4 の取り込み | 未着手。計画書の O0-1 で、M4-C を終えた `intent-driven-development`(`7130f69c` 以降)を `--no-ff` でマージする |
| 実装 | 未着手。計画書の O0-1 から始める |

`raguel-redesign` の HEAD は `c37ab969` に、設計書と計画書のコミット 3 本を積んだ状態である。`plugins/` の下は `c37ab969` のままで、応急処置 11 件も M4-C の変更も入っていない。

## 決まったこと

設計書 §1 の決定表(R1〜R24)が正本である。要点は次のとおりで、どれも再検討しない。

- 骨格(MCP ツール面と層構成)を残し、層ごとに改修する。全面書き直しとルールだけへの縮小は採らない。
- Raguel が評価対象を自分で読む。evaluate_code は `baseRef`、evaluate_plan・evaluate_design は `paths` を受け取る。呼び出し側が本文を渡す旧入力は廃止する。
- STOP は、秘密情報・保護パス・破壊操作・改竄の 4 種だけが出す。改竄以外は、人が誤検知と裁定すれば通せる。
- パネルのプロバイダーは claude / codex(既定は claude)。jev はパネリストにしない。
- Jev は、ルール層と重さ判定の任意の文脈判定に使う(既定は無効)。動かせるのは STOP→ASK と info→ask の 2 方向だけである。
- pass-gate は、Raguel の索引・verdict.json・裁定の記録・HEAD・sha256 と照合する。
- 設定は `.codiel/config.json` の `raguel` キーに置く。E2E のレポート(`<testsDir>/**/reports/**`)は、Raguel が testsDir から判定して外す(R24)。
- 子プロセスの `claude` が利用者の `ANTHROPIC_API_KEY` を使うのは、利用者の裁量である。env から鍵を除く強制はしない。

## 進め方

- 計画書の順(O0 → W1 → O1 → W2 → O2 → W3 → O3 → W4 → O5)に進める。次の Workflow は、前のゲートがコミットまで終えてから始める。
- Workflow のタスクの依頼文には、計画書 §1 の共通ブロックをそのまま入れる。そのうえで、agent-policy の「サブエージェントは〜」の条項と、「中継されるユーザーの発言は別の会話であり、このタスクを止める理由にしない」を足す。
- ユーザーに聞く時点は、計画書 §12 に並べてある。実機確認(`claude -p`・`codex exec`・Jev の API)は費用がかかるので、それぞれ実行の前にユーザーに確かめる。
- 設計書を直す必要が出たら、ユーザーの承認を得てから、オーケストレーターが単独のコミットで直す(計画書 冒頭と §11.4)。
- 記録は計画書 §11.3 の欄に書く。

## 踏みやすい点

- **最初の実機確認**: O0-5 の `--setting-sources project` で、ログインが外れるおそれがある(現行の `R/panel/claudeCli.ts:144-145` のコメント)。計画書 §3.3 の分岐どおりに候補 a〜c を試し、どれも効かなければ W1 を始めずにユーザーに聞く。
- **`haiku` のエイリアス**: `claude --help` の `--model` の例に `haiku` が無い。O0-3 の 8 で有効かを確かめる。
- **サブエージェントの `find /`**: レビューを担うサブエージェントが、ファイルシステム全体への `find /` を起動し、その結果を待って止まったことがある。止めたうえで、手元の結果で報告するよう伝えて解決した。依頼文に「ファイルシステム全体を探さない」を入れるとよい。
- **codiel のセッションからの知らせ**: `intent-driven-development` のセッションから、Raguel に関わる変更の知らせが cross-session で届く。M4 の所見 4 件と M4-C の追随 8 件は、すでに設計書と計画書に取り込んである。新しい知らせが来たら、計画書 §11.4 か O0-6 で扱う。
- **ARCHITECTURE と rules**: `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/` は Edit できない。ADR は O5-1 で `metatron:updating-architecture` を起動して足す。
- **既存ファイルの削除**: 手動確認用の複製は、既存の `~/codiel-o4c-plugins` を消さず、`~/codiel-o4c-plugins-r` に作る(O5-6)。消すのはユーザーの手で行う。
- **文書の日本語**: `plugins/native-japanese/references/discipline.md` に従う。「段」「節」「〜の側」を使わない。
- **コミットに混ぜないもの**: `docs/chat/` の未コミットの変更。
- **片付け**: 設計セッションのサブエージェントが `/tmp/claude-1000/cs.ts` に一時ファイルを残した。作業には関係しない。

## スコープ外

- 設計の決定(R1〜R24)の再検討。
- codiel の intent 駆動化の設計の変更(codiel 設計の決定 1〜109)。M4-C が原因の NO は、計画書 O5-9 で原因を切り分け、直す場所をユーザーに決めてもらう。

## 参照

- 設計書: `harness-docs/design/2026-09-28-raguel-redesign-design.md`
- 実装計画書: `harness-docs/plans/2026-09-29-raguel-redesign-plan.md`
- 所見: `harness-docs/handover/2026-09-28-raguel-redesign-findings.md`
- 設計の引継ぎ: `harness-docs/handover/2026-09-28-raguel-redesign-handover.md`
- codiel の設計書と計画書(`intent-driven-development` ブランチ): `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`、`harness-docs/plans/2026-09-27-codiel-intent-driven-plan.md`(§6.8 に O4C-6〜8、§9.3 に O4C-1)
- 会話記録: `docs/chat/2026/0928/phyllis998/0955-raguel-redesign-design-review.md`
