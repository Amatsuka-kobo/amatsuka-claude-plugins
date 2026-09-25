# jevriel 初版 引き継ぎ書

- 日付: 2026-09-25
- 引き継ぎ元: 設計・計画セッション(実装は未着手)
- 引き継ぎ先: 実装セッション
- 対象プラグイン: `plugins/jevriel`(新規、`0.1.0-dev`)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 完成。理解レビューと独立レビューの指摘を反映済み。ユーザー承認済み |
| 実装計画書 | 完成。T0〜T16 とコミット単位を定義済み。理解レビューと独立レビューの指摘を反映済み。ユーザー承認済み |
| 実装 | 未着手 |
| 未解決事項 | 設計書 §17 の実装時確認事項のみ(SDK の型の実物確認、Playwright の `exports`、`filechooser` の挙動、見積り係数)。着手を止めるものは無い |
| 後続設計 | OpenAPI からの操作自動列挙は別設計書 `harness-docs/design/2026-09-25-jevriel-openapi-design.md` で進行中。初版の実装には含めない |

設計書は `harness-docs/design/2026-09-25-jevriel-design.md`、実装計画書は `harness-docs/plans/2026-09-25-jevriel-plan.md` である。どちらもコミット `9cc3bb7` に含まれる。

作業ツリーには本件と無関係な未コミット変更がある。`cliproxyapi.config.example.yaml`、`.raphael/`、`docs/chat/` 配下には触れない。

## 次セッションが最初にやること

1. この引き継ぎ書、設計書 §1〜§3・§5-1・§16、実装計画書 §0〜§2 の順に読む。各タスクの実装者は担当タスクの表と設計書の該当節を読む。
2. T0 として `git status`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` を実行し、結果とテスト件数を記録する。
3. baseline が通った後、T1 から計画書の順序とコミット単位で実装する。確定した設計を実装中に再検討しない。
4. T2 の着手時に `@typesafe-ai/sdk` 0.6.0 の型定義(`SystemOneResult<Q>`、`Questions`、noul の `criteria` が `{true?, false?} | null`、例外クラス名)を実物で確かめる。設計書と違えば止めて報告する。

## 確定した決定

設計書を正本とする。実装では次の要約だけで判断を補わず、詳細は該当節に従う。

| 項目 | 決定 |
| --- | --- |
| 位置づけ | TypeSafe AI の判断モデル Jev(`jev-1.13.0`、別名 `jev-latest`)を MCP サーバーで使う。noul / choice / score の 3 種の型付き判断だけを返し、テキスト生成はしない |
| 依存 | Jev 部は公式 `@typesafe-ai/sdk` 0.6.0 のみ。コミュニティ製 MCP / ブラウザ実装に依存しない。ツール体系は独自(`jev_ask` の被りだけ許容) |
| キー | `TYPESAFE_API_KEY` 必須。キー無しの代替経路は無い。キー未設定時はサーバーは起動し、`browser_setup` 以外の全ツールが `not_configured` を返す |
| ツール | 判断系 5(`jev_ask` / `classify_items` / `rank_items` / `check_claims` / `assess_action`)、ブラウザ系 3(`browser_setup` / `browser_check` / `browser_run_goal`)、API 系 2(`api_check` / `api_run_goal`)。ツール名は `mcp__jevriel__<tool>` になる |
| Playwright | TypeScript ライブラリを直接使う。バンドルしない。解決順はプロジェクトの `node_modules`(1.63.0 以上)→ `~/.cache/jevriel` → `browser_setup` の案内エラー。`browser_setup` は MCP ツールで、シェルスクリプトは持たない |
| 独立運用 | ツール説明文・スキル・references に他プラグインの名前や固有概念を書かない。README にだけ「Codiel との併用」節を置く |
| 証跡 | 成否に関わらず `.jevriel/runs/<browser\|api>/<name>/<timestamp>/` へ保存。`result.json` はツール出力そのもの。`evidence: always \| on_failure \| none`。`name` はツール引数(省略時は URL 由来) |
| 出力型 | ブラウザ系・API 系 4 ツールの出力は共通型 `RunRecord`。開始前の失敗は `isError`、開始後の例外は `status: "error"` + 証跡 |
| 予算 | 64k / 32k の 8 割を上限。判断系は自動分割、ブラウザ系・API 系は本文を切り詰める。ループ途中の超過は `status: "error"`(`error.kind: "budget_exceeded"`) |
| スキル | `judging` 1 本。`prompt-smith:skill-creator` で作り、description の発火評価ループを回す。評価セットは `plugins/jevriel/evals/` |
| ADR | 外部有料 API に依存する初のプラグインとして 1 本。`metatron:updating-architecture` スキルを起動してから `stage-adr` → `commit-architecture` |
| バージョン | `0.1.0-dev`。パッケージ名は `jevriel-scripts` |

## ユーザー指摘による改定

同じ案を再提案しないため、決定に至る経緯を残す。

| 段階 | 改定 |
| --- | --- |
| セットアップ | `scripts/setup-browser.sh` は「プラグイン利用者が簡単に実行できない」ため撤回し、MCP ツール `browser_setup` にした |
| ツール体系 | 担当表(agent-policy)や codiel の run フェーズに結びついたツール(`route_task` / `triage_findings` 等)は独立運用の原則に反するため撤回し、汎用の `classify_items` / `rank_items` / `check_claims` / `assess_action` にした。Codiel 向けの使い方は README にだけ書く |
| 証跡 | 失敗時だけ保存する案を撤回し、成功時も保存する。スクリーンショットと判定ステータスを `result.json` と `step-<n>.png` / `final.png` で残す |
| 証跡の階層 | 種別(browser / api)とテスト対象名で分ける。名前は呼び出し側が `name` に渡し、スキルが「機能名・画面名を渡す」と教える |
| evals | `skills/judging/evals/` へ移す案は撤回され、`plugins/jevriel/evals/` のまま |
| API 系 | `api_check` / `api_run_goal` を追加(ブラウザ系と対)。OpenAPI の自動列挙は初版に含めず別設計 |
| Playwright | MCP ではなく TypeScript ライブラリを直接使う |

## 再提案しない不採用案

設計書 §13 の不採用案を再提案しない。特に次を実装中の代替案にしない。

- コミュニティ製の Jev MCP や jev-browser への依存、Playwright MCP 経由の操作。
- Playwright の同梱、セットアップ用シェルスクリプト、キー無しのフォールバック。
- `aria-ref=` セレクタ(非公開契約)。要素特定は `getByRole(role, { name, exact: true, disabled: false }).nth(i)`。
- 他プラグイン固有のツール。

## 実装時に踏みやすい点

- `ariaSnapshotJSON()` の戻りは配列で、公開型は `Serializable`(any)。`AriaNode` は `snapshot.ts` のローカル構造型にする。除外フラグは `hidden` ではなく `ariaHidden`。
- noul の `criteria` は文字列ではなく `{true?, false?} | null`。claim / assertion / goal は state のキーに置き、instructions でキー名を指す。
- `SystemOneResult` は型引数必須。`SystemOneResult<Questions>` と書く。
- dist の差分を同じコミットに含めるのは、`server.ts` の到達グラフを変えるタスク(T1、T3、T4、T6〜T10)だけ。T2 と T5 は dist が変わらないのが正常。
- ループは observe → decide → 終了判定 → act の順。`done` / `stuck` / 到達時は操作しない。
- `page.route("**/*")` では許可外メインフレーム遷移だけ `abort()`、他は必ず `continue()`。`request.frame()` の例外は許可外扱い。`serviceWorkers: "block"`。リダイレクトは遷移後の `page.url()` で事後検査。
- Playwright の値 import を書かない(`import type` のみ)。実行時は `createRequire(<projectDir|cacheDir>/package.json)` で解決する。
- 固定データ(`src/fixtures/aria/`)は実際の Playwright 1.63 で採取する。手書き JSON は禁止。
- Claude Code の stdio MCP ツール呼び出しの既定タイムアウトは約 28 時間、アイドル検出は 30 分(progress 通知でリセット)。`browser_setup` は同期実行で progress を送る。
- `references/`、`skills/` を変えるタスクでは prompt-smith のスキルを使う。`plugins/*/scripts/` と `dist/` は手で編集しない。ブランチも切らない。
- ADR の追加は `metatron:updating-architecture` を起動してから行う(`stage-adr` 直呼びはスキルの代替にならない)。

## このセッションで確定させた事実

- Jev の提供状況(2026-09-25): 2026-09-20 に waitlist 撤廃、2026-09-22 に需要過多で新規サインアップを一時停止(既存は継続)。再開告知は未確認。README に「新規登録の受付状況は公式を確認」と書く。
- 料金は入力 $0.042 / 1M トークン、出力無料。レート 250,000 tokens/sec、1,200 req/min(動的)。
- Jev の不得意: 計算、多ホップ推論、テキスト生成、画像、敵対的テキスト。CJK は英語より精度が落ちるため instructions は英語で固定する。
- `@typesafe-ai/sdk` 0.6.0 は zero-dependency、MIT、Node 20 以上、`fetch` 差替可。
- Playwright 1.63.0 が安定版。`page.accessibility` は 1.57 で削除済み。

## スコープ外

- OpenAPI からの操作自動列挙(別設計書で進行中。初版の完了後に着手)。
- フックの同梱、画像判定、OAuth2 認証、E2E テストの同梱。

## 参照

- 設計書: `harness-docs/design/2026-09-25-jevriel-design.md`(§5・§6・§7・§9・§13・§16・§17)
- 実装計画書: `harness-docs/plans/2026-09-25-jevriel-plan.md`(§0〜§4・§7〜§9)
- 後続設計書: `harness-docs/design/2026-09-25-jevriel-openapi-design.md`
- 同型の既存実装: `plugins/codiel/raguel-mcp/`
- 規律: `plugins/agent-policy/references/orchestration-discipline.md`
- プロジェクト規約: `.claude/rules/metatron/conventions.md`
- 会話記録: `docs/chat/2026/0924/phyllis998/2352-jevriel-design.md`、`docs/chat/2026/0918/phyllis998/1245-jev-ai-integration-planning.md`
