# Codiel プラグイン discuss フェーズ 設計

- 日付: 2026-07-10
- 参加者: phyllis998, AI (Claude Fable 5)
- 成果物: `docs/superpowers/specs/2026-07-10-codiel-discuss-phase-design.md`(コミット `42bba75`)
- 前提: `plugins/codiel/docs/DESIGN.md`、`plugins/codiel/skills/orchestrating-runs/SKILL.md`、`plugins/codiel/skills/writing-design-docs/SKILL.md`、`plugins/codiel/skills/analyzing-issues/SKILL.md`、`plugins/codiel/hooks/scripts/stop-guard.mjs`、`plugins/codiel/hooks/scripts/guard-write.mjs`

---

## セッション1: discuss フェーズのブレインストーミング

# phyllis998

> Codielプラグインの改修を行います。
> GitHub Issueから内容を取得後、設計を行うフェーズがあると思いますが、そのフェーズの進め方として、ユーザーとのディスカッションを行うブレインストーミングの手法を取り入れたいと思います。どのように実装するかを一緒に考えてください。

Codiel の設計フェーズにおいて、GitHub Issue の内容理解から設計実装までの過程において、ユーザーとのブレインストーミングを導入したいという要望。設計手法の詳細は一緒に検討すべき段階。

# AI

Codiel の現状設計(DESIGN.md、orchestrating-runs スキル、writing-design-docs スキル、analyzing-issues スキル)と brainstorming スキルの両者を読み込み、質疑を通じて discussion フェーズの仕様を詰めていった。

**現状の理解**: Codiel のワークフローは init → design → implement → review → triage の5段階。設計フェーズは Issue の読解(analyzing-issues)と design.md 執筆(writing-design-docs)で構成。人間参加は triage のみ。

**ブレインストーミング導入の位置づけ**: Issue 読解の後・design 执筆の前に新フェーズ `discuss` を挿入。architect エージェントが論点リスト(`agenda.md`)を作成 → オーケストレーターがユーザーとのディスカッション進行(`discussion.md` に合意を記録)→ architect が合意を入力に design.md 執筆 → ウォークスルー → `evaluate_design`。

**常時実施 vs. GATED**: ユーザー質疑「discuss フェーズは常に実施か、条件付きか」に対し AI が複数の判断基準を提示(Issue 種別・複雑度など)。ユーザーの回答「常に実施したい」で方針確定。

**発動条件**: 常に実施。GATED ではない(non-GATED)。

**実施主体**: アジェンダ駆動型の実装。architect が論点を明示化し、オーケストレーターがユーザーとの対話を進行。

**設計原則の改定**: DESIGN.md §1「設計工程は AI が自律的に行う」から「設計工程は人間と共同で行う」への改定。人間参加ポイントは discuss フェーズ・ウォークスルー・triage の3つ。

**HARD-GATE の整合性**: `discussion.md` を `review-<n>.md` と同じ「進行管理としての記録」に分類。facilitating スキル側には「合意の捏造禁止」「アジェンダの改変禁止」の逆向き HARD-GATE を実装。

**変更対象の把握**: 新規スキル2つ(discuss フェーズ用)+ 既存スキル3つ(orchestrating-runs, writing-design-docs, analyzing-issues の改修)+ `codiel-state.mjs` + hooks 3本 + DESIGN.md + テスト追随 + マイナーバージョンアップ。

設計書を `docs/superpowers/specs/2026-07-10-codiel-discuss-phase-design.md` に作成し、コミット(`42bba75`)。設計書ではブレインストーミングで合意した以下を軸に詳細を記載：
- 常に実施する新フェーズ `discuss`(init と design の間・非 GATED)
- アジェンダ駆動型: architect が論点リスト作成 → オーケストレーターが ユーザーとの対話進行 → architect が合意を入力に design 実行 → ウォークスルー → evaluate_design
- 人間参加ポイント: discuss / ウォークスルー / triage の3つ
- 合意記録の HARD-GATE: 捏造禁止・アジェンダ改変禁止

---

注意事項: ブランチは `feat/task-utility-issue-craft` 上に置かれている(issue-craft の作業ブランチと混在)。問題なければ次は設計書のレビュー。

## セッション2: 実装計画の作成

# phyllis998

> 実装計画に進んでください

# AI

writing-plans スキルを用いて、実装計画を作成。

**調査対象**: `codiel-state.mjs` の STAGES 構成、hooks の3本スクリプト（guard-write / stop-guard / subagent-stop）の verify/finalize 動作、raguel-gating スキルの objective 規約、テストの様式（既存テスト4ファイルの構成と実行コマンド）。

**重要な発見**: 既存テスト4ファイル（codiel-state.test.mjs、guard-write.test.mjs、guard-bash.test.mjs、stop-guard.test.mjs）がフェーズ列文字列 `["init","design",...]` を直に歩いているため、discuss フェーズを STAGES に挿入する Task 1 時に、これら4ファイルの全テストケースでフェーズ列が自動更新されるよう配慮が必要。各コミットで green を保つため Task 1 で同時更新となる。

**実装計画の構成**: 全10タスク

- **Task 1–3（コード+TDD）**: 
  - Task 1: `codiel-state.mjs` の STAGES リストに discuss を挿入。併せてテスト4ファイルの追随更新
  - Task 2: `guard-write` の DOC_PHASES に discuss を追加
  - Task 3: `stop-guard` の agenda.md 検証ロジック、`subagent-stop` の discuss 完了判定

- **Task 4–5（新規スキル）**:
  - Task 4: `preparing-design-agendas`（architect エージェント用、agenda.md 作成）
  - Task 5: `facilitating-design-discussions`（オーケストレーター用、ユーザーとの対話進行と discussion.md 記録）
  - SKILL.md の全文を計画に埋め込み済み

- **Task 6–8（既存スキル改修）**:
  - Task 6: `orchestrating-runs` の discuss フェーズ組み込み（進行表・フローチャート・HARD-GATE）
  - Task 7: `writing-design-docs` への合意読み込み（discussion.md を入力に設計実装）
  - Task 8: `analyzing-issues` / `raguel-gating` の objective 規約統一

- **Task 9–10（ドキュメント+仕上げ）**:
  - Task 9: DESIGN.md / README のフェーズ番号振り直し（§2 \[8\] 参照の総ざらい）、reviewer-doc の検査観点補足
  - Task 10: プラグイン version を `1.0.0-alpha.3` へアップデート、全テスト+スペック突き合わせ

実装計画を `docs/superpowers/plans/2026-07-10-codiel-discuss-phase.md` に作成し、コミット(`e020f0c`)。

**実行方法の選択**: 以下2択いずれかで進行

1. **Subagent-Driven(推奨)** — タスクごとに新しいサブエージェントをディスパッチ。タスク間でレビューを挟み、反復が速い
2. **Inline Execution** — このセッションで executing-plans スキルに従い、チェックポイントを挟みながら一括実行

**ブランチ管理**: 現在 `feat/task-utility-issue-craft` 上（issue-craft の作業ブランチと混在）。実装開始前に専用ブランチ（例: `feat/codiel-discuss-phase`）への切り替えを推奨。

---

注意事項: 実装計画の保存完了。実行方法の選択とブランチ分岐の指示待ち。
