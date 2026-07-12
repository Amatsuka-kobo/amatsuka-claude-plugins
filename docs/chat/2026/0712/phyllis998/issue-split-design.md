# issue-split スキル設計ディスカッション

- 日付: 2026-07-12
- 参加者: phyllis998, AI (Claude Opus 4.8)
- 成果物: `docs/superpowers/specs/2026-07-12-issue-split-design.md`、コミット `3e1d5e4`(設計ドキュメント初版)、`be1a5cd`(セルフレビュー修正)；`docs/superpowers/plans/2026-07-12-issue-split.md`、コミット `71e70c0`(実装計画)；`plugins/task-utility/scripts/link-sub-issue.mjs`、`plugins/task-utility/scripts/link-sub-issue.test.mjs`、コミット `8744633`(Task 1)；`plugins/task-utility/skills/issue-split/SKILL.md`、コミット `577f44d`(Task 2)；`plugins/task-utility/README.md`、`plugins/task-utility/.claude-plugins/plugin.json`、コミット `551631e`(Task 3)
- 前提: `plugins/task-utility/skills/issue-craft/SKILL.md`、`plugins/task-utility/scripts/check-issue-env.mjs`、`CLAUDE.md`

---

## セッション 1: 新スキル提案と設計検討

# phyllis998

> task-utilityプラグインに、GitHubのIssueをタスク分解して子Issueを作成するスキルを追加します。
> 基本方針・挙動はissue-craftスキルに倣ってユーザーとのディスカッションを行う形にしたいです。

# AI

issue-craft に倣った子Issue分解スキルの追加を確認。創作的な機能追加として、superpowers:brainstorming を使った要件確認プロセスを開始。

以下の工程で設計を進める方針を採用：
1. task-utility プラグインの構成と issue-craft スキルの実装を確認（TaskCreate で確認依頼）
2. スキルの目的・制約・成功基準を一問ずつ確認（AskUserQuestion を複数実行）
3. 実装アプローチ（Sub-issues API 活用 vs. 別API）のトレードオフを分析し推奨案を提示
4. 設計ドキュメント作成→ユーザー承認→実装計画へ移行

問い合わせした確認項目：
- スキル名の案：「issue-split」の採用を確認
- 親子表現：GitHub Sub-issues 機能の活用を確認
- 入力方式：既存 Issue の番号または URL を入力として受け取ることを確認
- 進め方：たたき台提示→ユーザーとの議論による改善を確認
- 子 Issue 本文：タスク型で軽量な本文に統一することを確認
- 親 Issue 本文：更新しないことを確認

実装アプローチの検討に進む段階で、ユーザーから実装方法についての質問の明確化を希望。複数のアプローチ（Sub-issues API 直接使用、スクリプト切り出し、既存チェック機構の再利用など）を提示した。

---

## セッション 2: 設計案提示と承認

# phyllis998

> この設計で問題ないです。

# AI

ユーザーの承認を受けて、設計案全体を提示。

**実装方式の確定**: 「SKILL.md + スクリプト、ただし MCP Tool 優先」方針を採用。GitHub 操作系 MCP Tool(Issue 作成 + Sub-issue リンクの両方が可能)を優先し、なければ `gh` コマンドにフォールバック。Issue 作成だけできる MCP Tool の場合は、作成は MCP・リンクはスクリプトの併用で対応する。

**設計案の主要決定事項**:
1. 配置と構成物：`skills/issue-split/SKILL.md`、`scripts/link-sub-issue.mjs`(Sub-issues リンク用、gh フォールバック時のみ使用)、`scripts/link-sub-issue.test.mjs` を新規作成。既存の `check-issue-env.mjs` を再利用。`.claude-plugins/plugin.json` をバージョン `1.1.0-dev` → `1.2.0-dev` に更新。
2. スキルのフロー(8手順)：環境チェック → 操作手段決定 → 親Issue取得 → 最初の確認 → 分解たたき台提示→ディスカッション → 全ドラフト一覧提示→一括承認 → 起票+リンク → 途中失敗時の対応。issue-craft と同じ大原則(ユーザー言語厳守、明示承認まで起票しない、STOP時は理由と次の行動を伝える)を踏襲。
3. link-sub-issue.mjs 仕様：`gh api` で子 Issue の内部 ID を取得後、`-F`(型付きフィールド)で Sub-issues API にリンク。スクリプトは成否の JSON を stdout に返し、判断はスキル側が行う(「事実はスクリプト・判断はスキル」の設計方針)。テストは `node --test` で実行。
4. issue-craft との棲み分け：issue-craft は「ゼロから Issue を練って起票」、issue-split は「既存の親 Issue を分解して子を起票し Sub-issues でリンク」。issue-craft 側は変更なし。

**失敗と対応の明記**: 設計過程で、「Issue 作成だけできる MCP Tool があるが gh も使えない」環境の扱いについてセルフレビューで修正。Sub-issues リンクを張れない旨を説明して STOP する、と明記した。

設計ドキュメント `docs/superpowers/specs/2026-07-12-issue-split-design.md` を作成し、コミット `3e1d5e4` で初版をコミット。セルフレビューで `be1a5cd` で修正。

---

## セッション 3: 実装計画の立案と全タスク実行

# phyllis998

> 実装計画に進んでください

# AI

スペック承認を受けて、実装計画作成フェーズに移行。writing-plans スキルで実装計画ドキュメント `docs/superpowers/plans/2026-07-12-issue-split.md` を作成し、コミット `71e70c0` で記録。

実装計画から以下の 3 タスクを抽出・構造化：
1. **Task 1: Sub-issues リンクスクリプト** - `link-sub-issue.mjs` と単体テスト `link-sub-issue.test.mjs` を実装
2. **Task 2: issue-split スキル本体** - `skills/issue-split/SKILL.md` を実装
3. **Task 3: プラグイン統合** - README に issue-split 節を追記、`plugin.json` のバージョンを `1.2.0-dev` に更新、テスト実行

実装方式として subagent-driven-development を採用し、各タスクを専任サブエージェントで順次実行。

**Task 1（link-sub-issue.mjs + テスト）実行・レビュー・承認**:
- 実装サブエージェント派遣で `link-sub-issue.mjs` と `link-sub-issue.test.mjs` を実装（コミット `8744633`）
- レビューで生成ファイルの正確性、テスト网羅性、エラーハンドリングを確認
- 指摘なく承認。タスク台帳に記録

**Task 2（issue-split SKILL.md）実行・レビュー・承認**:
- 実装サブエージェント派遣で `skills/issue-split/SKILL.md` を実装（コミット `577f44d`）
- レビューでスキルの構成、フロー表現、issue-craft との一貫性を確認
- 指摘なく承認。タスク台帳に記録

**Task 3（README・version）実行・レビュー・承認**:
- 実装サブエージェント派遣で README 追記と `plugin.json` バージョン更新を実行（コミット `551631e`）
- テスト実行結果 42/42 パス。ドキュメント网羅性をレビュー
- 指摘なく承認。タスク台帳に記録

**全タスク完了状況**: 3 タスクすべてが指摘なしで承認。テストスイート全パス。feat/task-utility-issue-split ブランチは実装計画の全要件を満たしている。

**最終レビュー**: 全タスク完了後、最終ブランチレビューを GPT Sol サブエージェントに派遣。バックグラウンド実行中。完了通知到来時にマージ判断に進む予定。

---

注意事項: Task 1～3 すべて実装・レビュー・承認完了。テスト 42/42 パス。最終ブランチレビュー実行中。マージ判断待機中。
