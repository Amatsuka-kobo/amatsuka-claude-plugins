# agent-policy 外部 Agent モデル割当・合成 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

agent-policy プラグインの「外部 Agent へのモデル割当と最適化定義の合成」を、承認済みの設計書と実装計画書に従って実装まで完遂せよ。

## 入力文書（この順で読む）

1. 引き継ぎ書: `harness-docs/handover/2026-08-27-agent-policy-external-agent-model-assignment-implementation-handover.md` — 現在地・最初にやること・落とし穴・Done 条件のすべてがここにある
2. 実装計画書: `harness-docs/plans/2026-08-27-agent-policy-external-agent-model-assignment.md`（第 2 版）— Task 1〜8 と確定済み実装仕様
3. 設計書: `harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md`(第 4 版・承認済み)— 判断に迷ったときの根拠

## 進め方

- 引き継ぎ書「実装セッションが最初にやること」を順守する（git status 確認と無関係変更の保全 → baseline 再現 → 計画レビュー第 2 巡の要否判断 → Task 1 から着手）
- 計画は Task 1 → 2 → 3 → 4 の順に依存する。Task 5・6 は Task 2 完了後に並行可能。Task 7 → 8 は最後
- 各 Task は**テスト先行**（失敗するテストを先に追加 → 実装 → 通過）。Task 完了ごとに `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` を通す
- 実装は計画の Interfaces・解釈規則・照合規則・fail-open 仕様に従う。仕様と実測が食い違ったら独断で変えず、設計書へ立ち返り、判断が要る場合はユーザーへ確認する
- references / SKILL.md / README の文面確定は `prompt-smith:prompt-smith` を起動して行う（計画のドラフトは入力素材）
- コード実装の差分は、コミット前に担当表のコードレビュー帯によるレビューを受ける
- Task 8（実装後検証）は新セッションでのフック発火確認を含む。同一セッションで完結できない項目は、完了報告に残項目と手順を明記する

## 制約（違反しない）

- 計画の「ファイル構成」に無いファイルへ触れない（作業ツリーの無関係変更を revert・削除・上書き・コミット混入しない）
- ブランチを切らない。`git push` に `--force` 系を付けない
- `plugins/agent-policy/scripts/` を手で編集しない（`pnpm run build` で再生成し、`src/` 変更と同じコミットに含める）
- フックは常に exit 0。stdout には注入 JSON 以外を出さない
- 設計で不採用が確定した案（割当マップ・派生定義生成・CLAUDE.md 焼き込み・反転注入・監査所見 1〜2/4〜11 の修正）に手を出さない

## 完了報告に含めること

- Task 1〜8 の完了状況と、lint / typecheck / test / build の最終結果
- バージョン（0.13.0-dev）・README・ARCHITECTURE 追随（`/metatron:update`）の実施結果
- 実装後検証（Task 8）の実測結果。特に「プラグイン定義の `agent_type` 形式」（設計 §8.6 残項目）と「機械契約 Agent への注入副作用なし」
- 「移行期の運用条件のうち、本実装で緩和されるのは親子 map 非仮定のみ」の明記
- 残課題（あれば）と、その扱いの提案
