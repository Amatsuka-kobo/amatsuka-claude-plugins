# codiel の同梱 Agent 定義撤去 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

codiel の同梱 Agent 定義 13 体を撤去し、指示文を Skills と観点ファイルへ移し、ディスパッチを作業内容による委譲へ書き換えよ。あわせて、agent-policy の parallel-nudge の注入文と規律 1 条項を改め、`e2e-verify` の種別を直せ。

## 最初に読む文書

`harness-docs/handover/2026-09-23-codiel-agents-to-skills-handover.md` を最初に読む。現在地、確定した判断、実装順、再提案しない案、注意点はこの 1 本にある。

設計書と実装計画書は確定済みであり、このセッションの成果物は**実装**である。設計判断を再検討しない。

## 着手と進め方

1. 引き継ぎ書の指示に従って `git status` と HEAD を確認し、本件と無関係な未コミット変更には触れない。
2. 実装計画書 `harness-docs/plans/2026-09-22-codiel-agents-to-skills-plan.md` §0 の手順で baseline を取り、記録する。
3. T0 から計画書の順序とコミット単位に従って実装する。
4. 指示書を触るタスクでは `prompt-smith:prompt-smith` を起動する。ADR を追加する T16 では `metatron:updating-architecture` を起動する。

## 制約

- `plugins/*/scripts/` を手で編集しない。削除は `git rm` を使い、内容の変更は `src/` を直してから `pnpm run build` で再生成する。
- 触ってはならないものは、実装計画書 §0.4 に従う。
- Done 条件は設計書 `harness-docs/design/2026-09-22-codiel-agents-to-skills-design.md` §11 と実装計画書 §7 に従う。
- ブランチを切らない。リポジトリの運用に従い、main で作業する。
