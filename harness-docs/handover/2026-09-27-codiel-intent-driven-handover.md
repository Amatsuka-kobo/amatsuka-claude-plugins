# codiel の intent 駆動化と sandalphon 吸収 引き継ぎ書

- 日付: 2026-09-27
- 引き継ぎ元: 設計・計画セッション(調査・設計・実装計画は完了、実装は未着手)
- 引き継ぎ先: 実装セッション(Dynamic Workflow で実装する)
- 環境: `gh` 2.101.0(`--attach` あり)
- 対象プラグイン: `plugins/codiel`(主)、`plugins/sandalphon`(撤去)、`plugins/metatron`、`plugins/gh-utility`
- 作業場所: worktree `amatsuka-claude-plugins-intent-driven-development`、ブランチ `intent-driven-development`

## 現在地

| 工程 | 状態 |
| --- | --- |
| 調査(intent 駆動開発・SDD の事例・sandalphon との突き合わせ) | 完了 |
| 設計書 | 承認済み(第 9 版、決定 53 件、未決 0 件)。コミット `00fb6ae8` |
| 実装計画書 | 承認済み(第 2 版、Workflow 8 本)。コミット `24377da3` |
| 実装 | 未着手。計画書 §0.2 の baseline も未記入 |

## 正本

- 設計書: `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`。決定・受け入れ基準・不採用案はここが正本で、実装中に再検討しない。
- 実装計画書: `harness-docs/plans/2026-09-27-codiel-intent-driven-plan.md`。Workflow の割り当て、タスク、共通の制約ブロック、Workflow 間のオーケストレーター手順(O0-1〜O4-4)、コミット表はここに従う。
- 計画書と設計書が食い違うときは設計書を正とし、計画書 §9.4 に記録してから進める。

## 設計の要点

- codiel の起点を GitHub Issue から自前の intent 文書へ変える。入口は `/codiel:run [<Issue番号> | <intent パス> | 省略]` の 3 通り。
- intent は 2 層にする。変更ごとの `docs/intents/YYYY-MM-DD-<slug>.md`(書式 v2)と、領域ごとの持続層 `docs/intents/domains/<領域>.md`。
- 原文(人が書いた・語った言葉)を完了判定の最高権威にする。`## ASIS` と `## TOBE` は原文、AI が書くものは派生文(`## 現状調査`・`## 要求` など)。
- GitHub への投稿は run が active な間 `<!-- codiel:generated -->` を必須にし、hook で強制する。
- ADR 候補の移送は metatron の init・update が担う。codiel と metatron はどちらか一方だけでも成り立つ。
- 実装は SDD の手法で、独立したステップを worktree で並列に実行する(M4)。

## 進め方

- M1(吸収)→ M2(起点変更)→ M3(持続層)→ M4(並列化)の順で進める。各 Workflow は、前の Workflow のゲートがコミットまで終えてから始める。
- Workflow 間のオーケストレーター手順は、Workflow の中に入れずメインセッションで実行する。ユーザーの手作業が要るのは次の 4 つ。
  - O1-5: `plugins/sandalphon/` の一括削除。クラシファイアに拒否されたら、絶対パスの `rm` をユーザーに `!` で実行してもらう。
  - O2-0: `hooks.json` の変更後、新しいセッションで hook の発火を確かめる。M2-B へ進む条件である。
  - O2-2: `gh` を 2.99.0 以上へ更新する。2026-09-27 に 2.101.0 へ更新済みで、`gh issue create --help` に `--attach` があることを確かめた。実装セッションでは `gh --version` の確認だけを行う。
  - O2-3: claude-in-chrome を含む画像添付の E2E。確定した手順を計画書 §9.3 に記録し、M2-T14 がそれを読む。
- ADR は `metatron:updating-architecture` スキルを起動して起票する。`stage-adr` → `commit-architecture` の直接呼び出しで代えない。

## 踏みやすい点

- 設計・計画のサブエージェントが、指示に反して Bash(python・`sed -i`)でファイルを書いた例が 2 回あった。委譲の依頼文に「書き込みは Edit・Write・Serena の編集ツールで行う」を必ず入れ、ゲートで `git status` を見て範囲外の変更がないか確かめる。
- プラグインに書く日本語は `plugins/native-japanese/references/discipline.md` に従う。ユーザーは「段」(Step の直訳)、「節」(section の直訳)、「〜の側」を指摘した。書くときは Step・ステップ、セクション、「〜側」を使う。
- 一括置換は熟語を壊す(「一節」→「一セクション」の例があった)。置換後に複合語を確かめる。
- 並列の phase で `pnpm run typecheck` を実行すると、隣のタスクの書きかけで落ちる。タスクは自分のテストだけを実行し、型検査・lint・build はゲートで行う。
- codiel のバンドルは `codiel-state` を各 hook の mjs にインラインする。`scripts/` をタスク単位のコミットに分けず、ゲートごと・プラグインごとにまとめる。
- Jevriel は API クレジット不足(402)で使えなかった。判定を Jevriel に頼る手順は、クレジットを確かめてから使う。
- 作業ツリーに `docs/chat/` の会話記録の未コミット変更がある。本件のコミットに混ぜない。

## 未決事項(実装セッションで確定する)

- Workflow の `agent()` で、役割マーカー付きの Agent 定義を委譲先に指定できるか。`workflow-authoring` スキルで確かめる。
- 計画書で決めた CLI の形(`next-adr-candidate-id`、`step-add --kind unit` など)とファイルの置き場。実装中に不都合があれば変えてよく、変えたら計画書 §9.4 に記録する。
- local モードの手動確認に使う、origin を持たない一時リポジトリの作り方。

## スコープ外

- raguel-mcp の変更、`harness-docs/design/2026-08-16-file-contract-freeze.md` の本文、ADR-003・ADR-004 の本文の書き換え。
- codiel を通さずに投稿された GitHub のコメントの識別。
- gh-utility の投稿へのマーカー付与(gh-utility は codiel の run 中に起動しない)。

## 参照

- 設計書・実装計画書: 上記「正本」。
- 会話記録: `docs/chat/2026/0926/phyllis998/2333-intent-driven-development-research.md`
- 規約: `.claude/rules/metatron/{conventions,protected-paths,testing-policy}.md`、`harness-docs/ARCHITECTURE.md`
