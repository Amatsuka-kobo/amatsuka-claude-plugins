# codiel の intent 駆動化 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

承認済みの設計書と実装計画書に従い、codiel を intent 駆動へ改造して sandalphon を吸収する実装を、Dynamic Workflow を使って M1〜M4 まで完了させる(use a workflow)。

## 最初に読む文書

1. `harness-docs/handover/2026-09-27-codiel-intent-driven-handover.md`(現在地・進め方・踏みやすい点)
2. `harness-docs/plans/2026-09-27-codiel-intent-driven-plan.md`(Workflow 8 本、タスク、共通の制約ブロック、オーケストレーター手順 O0-1〜O4-4、コミット表)
3. `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`(正本。決定 53 件と受け入れ基準)

設計の決定は再検討しない。計画書と設計書が食い違ったら設計書を正とし、計画書 §9.4 に記録してから進める。

## 進め方

1. `workflow-authoring` スキルを読み、Workflow スクリプトの書き方を確かめる。役割マーカー付きの Agent 定義を `agent()` の委譲先にできるかもここで確かめ、計画書 §9.3 に記録する。
2. O0-1: `git status`・HEAD・`pnpm run lint`・`typecheck`・`test`・`build`・`gh --version` を実測し、計画書 §0.2 に記入する。
3. 計画書の順(M1 → M2-A → M2-B → M2-C → M2-D → M3-A → M3-B → M4)に Workflow を 1 本ずつ実行する。次の Workflow は、前の Workflow のゲートがコミットまで終えてから始める。
4. Workflow の合間に、計画書のオーケストレーター手順をメインセッションで実行する。ユーザーの手作業(O1-5 の sandalphon 削除、O2-0 の新しいセッションでの hook 発火確認、O2-2 の gh 2.99.0 以上への更新、O2-3 の画像添付 E2E)は、ユーザーに依頼してから待つ。
5. 各 M の終わりに計画書のレビュータスクを実行し、critical・high は同じ M の修正 Workflow で直してから次へ進む。
6. 中断したら `resumeFromRunId` で再開する。完了したタスクを再実行しない。

## 制約

- 各タスクの依頼文には、計画書 §1 の共通の制約ブロックをそのまま入れる。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行い、Bash では書き込まない。ゲートで `git status` を見て、範囲外の変更がないか確かめる。
- プラグインに書く日本語は `plugins/native-japanese/references/discipline.md` に従う。「段」「節」「〜の側」のような直訳語を使わず、Step・ステップ、セクション、「〜側」と書く。
- `plugins/*/scripts/` と `dist/` は手で編集せず、`pnpm run build` で再生成する。コミットはゲートごと・プラグインごとにまとめる。
- ADR は `metatron:updating-architecture` スキルで起票する。`/metatron:update` もメインセッションで実行する。
- ブランチを切らない。`docs/chat/` の未コミット変更を本件のコミットに混ぜない。

## Done の条件

- 設計書 §4 の受け入れ基準と §14 の Done 条件をすべて満たす。
- `pnpm run lint`・`typecheck`・`test`・`build` が通り、`scripts/` の差分が対応するコミットにある。
- バージョンが codiel `1.0.0`、metatron `0.4.0-dev`、gh-utility `0.5.3-dev` に揃って上がっている。
- sandalphon が marketplace・workspace・README から消え、設計書 §7.6 の許可リスト以外に名前が残っていない。
- ルートの README、ARCHITECTURE(`/metatron:update`)、Serena メモリが改修に追随している。
