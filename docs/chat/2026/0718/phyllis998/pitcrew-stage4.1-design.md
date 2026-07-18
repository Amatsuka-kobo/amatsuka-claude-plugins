# Pitcrew Stage 4.1 — ビューア改善設計(ソート・一括既読)

- 日付: 2026-07-18
- 参加者: phyllis998, AI (Claude Sonnet 5, Haiku)
- 成果物: 
  - 設計書: `docs/superpowers/specs/2026-07-18-pitcrew-stage4.1-design.md` (コミット `bbd12bb`)
- 前提: 
  - `docs/chat/2026/0717/phyllis998/pitcrew-stage4-implementation.md` (Stage 4 完成・v0.9.2 正式リリース)
  - プロジェクトメモリ `pitcrew-viewer-backlog.md` (ビューア層の要望 2 件の出典)
  - `docs/superpowers/specs/2026-07-16-pitcrew-design.md` (§5 ビューア層のアーキテクチャ)

---

## セッション1: Stage 4.1 要件確認・アプローチ比較・設計確定

# AI

chat-recall スキルに従い前提知識を収集。Stage 4 完成記録と pitcrew-viewer-backlog.md のメモリから、ビューア層の 2 つの改善要望を確認した：

1. **新しい順ソート** — 現在は追加順のため、新しい diff が下に溜まって見づらい
2. **一括既読** — 複数の review 待ち項目をまとめて approved に移動したい

superpowers:brainstorming スキルに従い、各要望について 2 案を比較し提示：

**要望1(新しい順ソート):**
- **A案(推奨)**: サーバー側 `state.ts` の `readItems` で降順ソート。API の返す順序自体が仕様になり、UI は受け取った順に描画するだけ。テストもサーバー側ユニットテストで完結
- **B案**: UI 側 `ui.html` の `renderQueue` で逆順描画。サーバーの返却順と表示順が食い違い、将来 API 利用者(別 UI 等)が同じ処理を重複実装することになる

**要望2(一括既読):**
- **A案(推奨)**: `POST /api/approve-batch` を新設し、`viewer-ops.ts` に `approveItems` を追加。1 リクエストで完結し、途中失敗も 1 レスポンスで報告できる
- **B案**: UI 側で選択項目分 `/api/approve` をループ呼び出し。サーバー変更ゼロだが、途中失敗時の状態が分かりにくく、SSE 再描画が選択状態とレースする

キュー項目のファイル名が `<連番ID>-<type>-<slug>.md` 形式(src/lib/review.ts:100)であることを実コード確認し、降順ソートの堅牢性を検証した。

# phyllis998

> どちらもA案でよろしくお願いします

# AI

A 案で設計方針を確定。設計書を `docs/superpowers/specs/2026-07-18-pitcrew-stage4.1-design.md` に作成し、CLAUDE.md の方針に従い Haiku レビューを実施。

Haiku レビューで以下の指摘を反映：

- **部分成功のセマンティクス明確化**: 「途中失敗しても移動済み項目は戻さない(ロールバックしない)。結果は `moved`/`failed` に完全に反映される」と明記
- **既存 API との関係性明記**: 単件 `/api/approve` と「承認して既読」ボタンはそのまま変更しない
- **UI 側 1000 件上限チェックの有無**: UI 側チェックはしない(API 側の防御のみ。実運用で達しない)
- **選択状態の保持方法・再接続時の挙動**: クロージャ変数 `checkedNames` の Set 方式と、再接続後も復元されることを明記
- **renderQueue() の肥大化リスク**: セクションヘッダー生成を補助関数に切り出す方針を追記
- **既存テストへの影響範囲**: 実装の最初のステップとしてソート順依存の既存テストを洗い出すことを追加

自検証として実コードを確認し、ファイル名形式(ソート堅牢性の前提)と連番 ID 上限(1000 到達時の既知の限界・許容)を設計書に反映。コミット bbd12bb で設計書を確定。

---

注意事項: 設計書の Haiku レビューが完了し、指摘を全て反映済み。次は writing-plans で実装計画を作成予定(実装は CLAUDE.md 方針に従い GPT Terra へ委譲予定)。
