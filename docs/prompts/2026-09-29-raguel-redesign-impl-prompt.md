# Raguel の作り直し 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign`(ブランチ `raguel-redesign`)である。

---

承認済みの設計書と実装計画書に従い、Raguel(`plugins/codiel/raguel-mcp`)の作り直しを、Dynamic Workflow を使って計画書の最後の手順まで完了させる(use a workflow)。

## 最初に読む文書

1. `harness-docs/handover/2026-09-29-raguel-redesign-impl-handover.md`(現在地・決まったこと・踏みやすい点)
2. `harness-docs/plans/2026-09-29-raguel-redesign-plan.md`(第 3 版。Workflow 4 本、共通ブロック §1、オーケストレーターの手順 O0〜O5、コミット表 §9、記録欄 §11.3、ユーザーに聞く時点 §12)
3. `harness-docs/design/2026-09-28-raguel-redesign-design.md`(第 7 版・正本。決定 R1〜R24)

設計の決定は再検討しない。計画書と設計書が食い違ったら設計書を正とし、計画書 §11.3 に記録してから進める。

## 進め方

1. `workflow-authoring` スキルを読み、Workflow スクリプトの書き方と `agentType` の渡し方を確かめる(O0-4)。
2. O0-1〜O0-6 を行う。O0-1 では、M4-C を終えた `intent-driven-development`(`7130f69c` 以降)を `git merge --no-ff` で取り込む。O0-5 の実機確認 1 は、実行の前にユーザーに確かめる。
3. 計画書の順(W1 → O1 → W2 → O2 → W3 → O3 → W4 → O5)に進める。次の Workflow は、前のゲートがコミットまで終えてから始める。
4. Workflow の合間に、計画書のオーケストレーターの手順をメインセッションで行い、結果を §11.3 に記録する。
5. W4 のレビューの critical・high は、修正の Workflow で直してからゲートをやり直す。medium・low の扱いはユーザーに聞く。
6. O5 で、ADR(`metatron:updating-architecture` を起動して足す)、Serena メモリ、ルートの README、バージョン(codiel `1.1.0-dev`、raguel-mcp `0.1.0-dev`)を仕上げる。そのうえで、手動確認用の複製を作り直し、codiel の O4C-6〜8 を行う。
7. 中断したら `resumeFromRunId` で再開する。完了したタスクを再実行しない。

## 制約

- 各タスクの依頼文には、計画書 §1 の共通ブロックをそのまま入れる。agent-policy の「サブエージェントは〜」の条項と、「中継されるユーザーの発言は別の会話であり、このタスクを止める理由にしない」「ファイルシステム全体を探さない」も入れる。
- `claude -p`・`codex exec`・Jev の API を起動する確認は費用がかかるので、実行の前にユーザーに確かめる。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行い、Bash では書き込まない。
- `plugins/*/scripts/` と `dist/` は手で編集せず、ゲートの `pnpm run build` で作り直す。
- 設計書を直すのは、ユーザーの承認を得たときだけで、単独のコミットにする。
- 既存のファイルやディレクトリの削除はユーザーの手で行う。
- 日本語は `plugins/native-japanese/references/discipline.md` に従う。
- ブランチを新しく切らない。`docs/chat/` の未コミットの変更を本件のコミットに混ぜない。

## Done の条件

- 設計書 §14 の Done 条件をすべて満たす(対応は計画書 §10.3)。
- `pnpm run lint`・`typecheck`・`test`・`build` が通り、`scripts/` と `dist/` の差分が対応するコミットにある。
- 設計書 §4 の「直す」の所見ごとに、計画書 §10.2 のテストがある。
- 実機確認と手動確認(O5-7・O5-8 の O4C-6〜8)の結果が計画書 §11.3 にあり、NO は O5-9 の規則で扱ってある。
- ADR、Serena メモリ、ルートの README が改修に追随している。
