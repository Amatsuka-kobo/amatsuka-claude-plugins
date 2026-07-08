# Codiel オーケストレーター 設計・実装セッション

- 日付: 2026-07-08
- 参加者: hiro0209, AI (Claude Fable 5)
- 成果物: Codiel オーケストレーターの設計書(`docs/DESIGN.md`)、実装計画(`docs/plans/2026-07-08-codiel-orchestrator.md`)、本体実装一式(commands 2 / skills 14 / agents 13 / hooks 4 + codiel-state CLI / docs example 3 点 + install-harness.sh)。テスト 86 件全 PASS、main へマージ(`124a0d9`)
- 前提: Raguel MCP は実装済み(`raguel-mcp/docs/DESIGN.md` と同 chat 記録を参照)

---

## セッション1: 設計ブレインストーミング

# hiro0209

GitHub Issue から情報を取得して設計書を書き、テスト仕様書・テストケースを書き、並行して開発手順書を書き、実装し、テストに合格するまで修正し、PR を作成してレビューし、critical & high を修正して回帰テストに合格するまで回すオーケストレーターコマンドと、それを実現する skills・agents・hooks を一緒に設計してほしい。Raguel MCP のチェックを逐一入れて AI の暴走を抑えるハーネスエンジニアリングを行う。`docs/ARCHITECTURE.example.md`・`docs/GOTCHAS.example.md`・`CLAUDE.example.md` の整備も。各フェーズは superpowers を模倣する形に。

# AI

superpowers:brainstorming に従い、一問一答で要件を確定:

- **superpowers の模倣** → スタイルのみ模倣(チェックリスト・dot フローチャート・Red Flags 表・HARD-GATE)。依存しない自前スキル群
- **人間の承認ゲート** → Raguel の ASK / STOP のみ。PROCEED が続く限り完全自律
- **成果物の置き場** → 対象プロジェクトの `.codiel/` 配下にコミット
- **コマンド構成** → `/codiel:run <issue番号>` 単一 + state による再開機能
- **実行モデル** → 案A採用: メインセッション=オーケストレーター(進行管理と Raguel ゲート専任)、各フェーズはツール制限付きサブエージェント(コンテキスト隔離・利益相反の構造的分離・並列化)

チャット上の長文提示が読みづらかった指摘を受け、設計ドラフトを `docs/DESIGN.md` に直接書き出す方式へ変更。9 フェーズ(init → design → test-spec∥dev-plan → implement → test-loop → pr → review → fix-loop → triage → finalize)、state.json をスクリプト経由でしか遷移できなくする保護、skills/agents/hooks の構成を提示。

## セッション2: 設計への追加要件

# hiro0209

テスト仕様書は機能単位(フロントは画面毎、バックは API 毎)でフォルダを分けた永続資産にし、機能更新時に仕様書を更新してテストケースを再生成する。test-loop は「テストスクリプトを作成し正常に回るまで何度でもスクリプトを修正 → 正常に回ったら NG=バグとして TDD で修正」の二段構え。オーケストレーター外でもテストを回せるコマンドも欲しい。implementer は frontend/backend/data の 3 分割、reviewer は frontend/backend/data/doc/security の 5 分割に。

# AI

DESIGN.md に反映: `.codiel/specs/<unit-id>/`(spec.md → cases.md → scripts/ の三層)、二段ループ(担当分離: 期待値=test-designer、スクリプト=tester、コード修正=implementer の三権分立)、`/codiel:test`、ドメインマップ(ARCHITECTURE.md 内の `json codiel:domains` フェンスブロック)によるエージェント選択。

# hiro0209

未確定 5 項目への回答: (1) generic 縮退モード OK、(2) 仕様書駆動テストは Playwright 等の E2E で、ユニットテストは implementer が ARCHITECTURE.md の宣言に従い別レイヤーで書く、(3) runId は issue-123 で、その下に try 毎フォルダ、(4) マージ検知はできれば自動化、(5) 役割別書き込み制御は deny でなく ask に。

# AI

すべて反映。マージ検知は「コマンド起動時に awaiting_outcome の run を `gh pr view` で走査して record_outcome を自動記録」する機会的ポーリングで実現(incident のみ人間申告)。

# hiro0209

追加要件: レビューの medium 以下は、ユーザーの指示のもと別 Issue として起票するフェーズ(triage)を入れたい。起票時はリポジトリの ISSUE_TEMPLATE を適切に選択し最大限活かすこと。また、本プラグインは Anthropic API を使えないユーザーも使えるよう、API 呼び出しや Python CLI 運用は一切想定しないことを明確にしておく(過去に同種スキルで API/CLI 前提になってしまった経験があるため)。

# AI

triage フェーズ([8])を挿入し、`gh issue create` を triage フェーズ以外 deny とする hooks を追加。ISSUE_TEMPLATE(form .yml / markdown .md / レガシー)の探索・選択・項目展開を `filing-followup-issues` スキルに規定。DESIGN.md に §0「実行環境の制約(最重要)」を新設(API 不使用・node/bash のみ・ユーザー接点はスラッシュコマンドのみ)し、この制約をメモリにも保存。

## セッション3: 実装計画

# hiro0209

実装計画に移ってください。

# AI

superpowers:writing-plans で 20 タスクの実装計画を作成(`docs/plans/2026-07-08-codiel-orchestrator.md`)。冒頭に「共有インターフェース」(フェーズ定義・codiel-state CLI 全仕様・state.json スキーマ・ドメインマップ形式)を一元化し、全タスクがそれを参照する構成。コード部分(codiel-state・hooks)は実装・テストコードを計画に全文掲載、npm 依存ゼロ。

## セッション4: サブエージェント駆動実装

# hiro0209

(実行方式の選択で)1(サブエージェント駆動)で進めてください。 …(途中で)全てのユーザー確認が必要な事項を PROCEED とするので、実装が終わるまで進めてください。私はこれから寝ます。

# AI

superpowers:subagent-driven-development で 20 タスクを「実装サブエージェント → タスクレビューアー → 指摘修正 → 再レビュー」のループで完走。台帳 `.superpowers/sdd/progress.md` で進捗管理。主な攻防:

1. **Task 3(guard-write)**: レビューアーが state.json 保護のバイパス(cwd がプロジェクトルート外のとき絶対パス指定で素通り)を実証 → 絶対パス基準 + ケース非依存の判定と `findProjectRoot` に修正
2. **Task 4(guard-bash)**: 3 回の修正ラウンドで `git -C`/絶対パス git/サブシェル/`&` 区切り/`+main` refspec/`refs/heads/main`/`--force-with-lease` のすり抜けと `git stash push` 等の誤爆を解消。最終的にセグメント分割+サブコマンド解析+トークンベース保護ブランチ判定に到達
3. **Task 7(raguel-gating)**: レビューアーが「ASK を人間が as-is 承認 → 再 evaluate すると sealed な resubmission-loop と衝突してライブロック」という設計ギャップを発見 → `codiel-state pass-gate --human-approved` を新設(verdict=ASK のまま humanApproved を監査記録する正直な通過経路)
4. **Task 8(orchestrating-runs)**: 「レビュー無指摘だと fix-loop が通過不能で run が座礁」を発見 → `skip-phase`(verdict=SKIPPED)を追加。成果物コミット責務・ベースブランチ手順も規定
5. **Task 12〜14**: hooks のドメイン制御に関する記述を実装実態(フェーズ単位制御まで。エージェント個体は識別不能なのでドメイン規律はエージェント定義で担保)に整合
6. **Task 15(record-attempt)**: 呼び出し責務がスキル間で矛盾し二重計上/計上漏れの恐れ → オーケストレーター専権(1 ディスパッチ往復 = 1 attempt)に一本化
7. **Task 17(fix-loop)**: 修正ディスパッチの入力契約を 2 系統(テスト NG 由来 4 項目 / レビュー所見由来)に統一し、反論済み所見の再検出ループを遮断

## セッション5: 最終レビューとマージ

# AI

ブランチ全体の最終レビュー(最上位モデル・実機注入検証込み)で修正必須 4 件を検出:

- **C1**: fix-loop で誰も push しないため再レビューが stale diff を見る/修正が PR に載らない → push 責務をオーケストレーターに明記
- **I1**: finalize の手順が `complete-phase` と誤記(実装は専用 `finalize` コマンド)→ 統一
- **I2**: 並列ステージ(test-spec∥dev-plan)で subagent-stop が誤 block → in_progress 複数時は検査スキップ
- **I3**: state.json 保護を `cp`/`mv`/`dd` が素通り → ALWAYS_DENY に追加

一括修正のサブエージェントがセッション上限で中断したが、翌朝ユーザーの「続きをお願いします」を受けて AI が残作業(raguel-gating フローチャートの裁定 A 順序)を引き継ぎ完了。修正確認の再レビューで **Ready to merge** 判定。テスト 86/86 PASS を確認して main へマージ(`124a0d9`)。push は未実施(ユーザーに委任)。

# hiro0209

ここまでの会話を chat に記録してください。

# AI

本記録を作成。
