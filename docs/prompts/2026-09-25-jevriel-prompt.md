# jevriel 初版 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

新プラグイン jevriel(TypeSafe AI の判断モデル Jev を MCP サーバーで使う。判断系 5・ブラウザ系 3・API 系 2 の計 10 ツールとスキル 1 本)を、実装計画書の T0〜T16 の順で実装する。設計書と計画書の Done 条件を満たし、計画書で定めた単位に分けてコミットする。

## 最初に読む文書

まず `harness-docs/handover/2026-09-25-jevriel-handover.md` を読む。現在地、確定事項、実装順、再提案しない案、踏みやすい点はこの文書にある。

設計書 `harness-docs/design/2026-09-25-jevriel-design.md` と実装計画書 `harness-docs/plans/2026-09-25-jevriel-plan.md` はユーザー承認済みである。設計判断を再検討せず、実装計画書の順序に従う。各タスクの実装者には担当タスクの表と設計書の該当節を渡す。

## 着手と進め方

1. `git status` と HEAD を確認する。`cliproxyapi.config.example.yaml`、`.raphael/`、`docs/chat/` 配下にある本件と無関係な未コミット変更には触れない。
2. T0 の baseline を取る。`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` を実行し、結果とテスト件数を記録する。
3. T1 から T16 まで、実装計画書の順序とコミット単位で進める。T1〜T10 は直列である。
4. T2 の着手時に `@typesafe-ai/sdk` 0.6.0 の型(`SystemOneResult<Q>`、`Questions`、noul の `criteria`、例外クラス名)を実物で確かめ、設計書と違えば止めて報告する。
5. T9 の固定データは実際の Playwright 1.63 で採取する。手書きの JSON は禁止。
6. T11 のスキル `judging` は `prompt-smith:skill-creator` で作り、description の発火評価ループを回す。評価セットは `plugins/jevriel/evals/` に置く。
7. T13 の ADR は `metatron:updating-architecture` スキルを起動してから `stage-adr` → `commit-architecture` で追加する。ARCHITECTURE と GOTCHAS を手で編集しない。
8. 設計書 §17 の実装時確認事項(Playwright の `exports`、`filechooser`)は該当タスクで確かめ、結果を計画書 §10 に記録する。

## 制約

- Jev に関わる部分の依存は `@typesafe-ai/sdk` 0.6.0 だけ。Playwright はバンドルせず、値 import を書かず、`createRequire` で実行時に解決する。
- ツール説明文・スキル・references に他プラグインの名前や固有概念を書かない。README にだけ「Codiel との併用」節を置く。
- `TYPESAFE_API_KEY` が無い環境では、実キーを要する検証を保留として記録し、他をすべて完了させる。
- `plugins/*/scripts/` と `dist/` を手で編集しない。ブランチを切らず main で作業する。
- Done 条件は設計書 §16 と実装計画書 §9 に従う。
- OpenAPI からの操作自動列挙は別設計であり、この実装に含めない。
