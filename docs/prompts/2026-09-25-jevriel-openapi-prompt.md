# jevriel OpenAPI 拡張 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。初版(`plugins/jevriel` 0.1.0-dev)の実装完了後に使う。

---

jevriel に OpenAPI からの操作自動列挙と候補集合方式の値埋めを足す拡張(`api_run_goal` の `spec` 経路と `api_list_operations`、`0.2.0-dev`)を、実装計画書の T0〜T12 の順で実装する。設計書と計画書の Done 条件を満たし、計画書で定めた単位に分けてコミットする。

## 最初に読む文書

まず `harness-docs/handover/2026-09-25-jevriel-openapi-handover.md` を読む。現在地、確定事項、実装順、再提案しない案、踏みやすい点はこの文書にある。

拡張設計書 `harness-docs/design/2026-09-25-jevriel-openapi-design.md` と実装計画書 `harness-docs/plans/2026-09-25-jevriel-openapi-plan.md` はユーザー承認済みである。設計判断を再検討せず、計画書の順序に従う。初版設計書 `harness-docs/design/2026-09-25-jevriel-design.md` は前提として読む。

## 着手と進め方

1. `git status` と HEAD を確認する。`cliproxyapi.config.example.yaml`、`.raphael/`、`docs/chat/` 配下にある本件と無関係な未コミット変更には触れない。
2. T0 の baseline を取る。初版の 10 ツールが `tools/list` に出ること、`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` が通ることを確認し、初版の export 名が初版計画書の produces と一致するか確かめる。初版が未完了なら止めて報告する。
3. T1 のリファクタ(`ApiGoalInput.requests` → `source: RequestSource`)は契約凍結の明示的な例外である。許可する差分は計画書 T1 の列挙に限る。
4. T2 から T12 まで、計画書の順序とコミット単位で進める。T2〜T4 のコミットに dist 差分が無いのは正常である。
5. T7 のスキル追記は `prompt-smith:prompt-smith` を起動する。
6. 設計書 §17-1(SDK の choice が選択肢 1 個を受けるか)は T3 で確かめ、結果を計画書 §10 に記録する。扱いは変えない。

## 制約

- spec を信頼しない。`baseUrl` は必須、`servers` は表示のみ、spec の URL 取得は redirect を追わない、ローカルパスは `projectDir` 配下に限る。
- Jev に関わる依存は `@typesafe-ai/sdk` 0.6.0 だけ。`yaml ^2.9.0` の追加は計画書 §1 に明記した例外である。
- ツール説明文・スキル・references に他プラグインの名前や固有概念を書かない。
- `TYPESAFE_API_KEY` が無い環境では、実キーを要する検証を保留として記録し、他をすべて完了させる。
- `plugins/*/scripts/` と `dist/` を手で編集しない。ARCHITECTURE と GOTCHAS を手で編集しない。ブランチを切らず main で作業する。
- Done 条件は設計書 §16 と計画書 §9 に従う。
