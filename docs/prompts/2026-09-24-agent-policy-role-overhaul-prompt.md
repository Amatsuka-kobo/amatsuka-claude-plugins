# agent-policy 役割体系改修 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

agent-policy の役割体系改修の 9 要件を、実装計画書の T0〜T16(T1b を含む)の順で実装する。設計書と計画書の Done 条件を満たし、計画書で定めた単位に分けてコミットする。

## 最初に読む文書

まず `harness-docs/handover/2026-09-24-agent-policy-role-overhaul-handover.md` を読む。現在地、確定事項、実装順、再提案しない案、注意点はこの文書にある。

設計書と実装計画書はユーザー承認済みである。設計判断を再検討せず、実装計画書の順序に従う。

## 着手と進め方

1. `git status` と HEAD を確認する。`cliproxyapi.config.example.yaml` と `docs/chat/` 配下にある本件と無関係な未コミット変更には触れない。
2. T0 の baseline を取る。`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`、`git status --short plugins/agent-policy/scripts`、方針スキル本文と規律の `wc -c` を実行し、26,737B を基準値として記録する。
3. T1 から T16 まで、実装計画書 `harness-docs/plans/2026-09-24-agent-policy-role-overhaul-plan.md` の順序とコミット単位で進める。
4. `assets/roles/`、`references/`、`skills/` を変えるタスクでは `prompt-smith:prompt-smith` を起動する。
5. T16 の敵対的レビュー定義は、名前 `adversarial-reviewer`、モデル `gpt-sol`(`claude-gpt-6-sol`)で作る。確認済みであり、改めて聞かない。

## 制約

- `plugins/*/scripts/` を手で編集しない。対応する `src/` を変更してから `pnpm run build` で再生成する。
- 触らない対象は実装計画書 §0 に従う。特に `.gitignore` の `.claude/context-maps` 行は残す。
- Done 条件は設計書 `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md` §11 と実装計画書 §9 に従う。
- ブランチを切らず、main で作業する。
