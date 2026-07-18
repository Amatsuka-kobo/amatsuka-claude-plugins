# Pitcrew Stage 4.1 — ビューア改善設計(ソート・一括既読)

- 日付: 2026-07-18
- 参加者: phyllis998, AI (Claude Sonnet 5, Haiku)
- 成果物: 
  - 設計書: `docs/superpowers/specs/2026-07-18-pitcrew-stage4.1-design.md` (コミット `bbd12bb`)
  - 実装計画書: `docs/superpowers/plans/2026-07-18-pitcrew-stage4.1.md` (コミット `ca1cb4b`)
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

## セッション2: 実装計画書の作成・Haiku レビュー・実行方法の選択

# phyllis998

> 実装計画に進んでください

# AI

設計書が承認されたので、writing-plans スキルで実装計画書を作成。まず既存テストのパターンを確認し、実装方針を組み立てた。

既存テストスイート(state.test.ts / viewer-ops.test.ts / http.test.ts)を実際に読み、ソート順に依存する既存テストが各セクション 1 件配置のみであること、新しい Task 1 の実装(降順ソート)によっても影響がないことを裏取りした。

`docs/superpowers/plans/2026-07-18-pitcrew-stage4.1.md` に実装計画書を作成。CLAUDE.md の方針に従い、Haiku にレビューさせた。

Haiku レビューで以下の軽微な指摘 3 点を反映：

- **置き換え行数の誤記**: 「`state.ts` 内の 3 行を置き換え」→「4 行に変更」(降順ソートで `reverse()` が 1 行増加)と正確化
- **選択解除ロジックの挿入位置**: セクションのクリアリスナーに選択状態クリアロジックを挿入する際、早期リターン後を指定地点と明記
- **`headers` 変数の由来**: `POST /api/approve-batch` の実装で用いる `headers` 変数が既存コードの `http.ts` 内で定義されていることを Task 3 に追記

計画は TDD 方式で 5 タスク構成：

1. **Task 1**: `readItems` の降順ソート(テスト先行、`names.sort().reverse()` の実装)
2. **Task 2**: `viewer-ops.ts` に `approveItems(projectDir, names)` メソッド追加(フェイルオープン、`moved`/`failed` 配列返却)
3. **Task 3**: `http.ts` に `POST /api/approve-batch` エンドポイント追加(400 系バリデーション、1000 件上限)
4. **Task 4**: `ui.html` にチェックボックス・全選択トグル・「選択を既読 (N)」ボタン追加(自動テスト対象外、完了後に実機確認)
5. **Task 5**: README 追記・`plugin.json` のバージョン 0.9.3・`pnpm build` でバンドル再生成

コミット ca1cb4b で実装計画書を確定。重大な問題はなく、軽微な指摘はすべて反映済み。

---

注意事項: 実装計画書が確定し、実行方法の選択待ち。Subagent-Driven 方式(タスクごとに新規サブエージェント起動、GPT Terra へ委譲)と Inline Execution 方式(このセッション内でバッチ実行)の 2 案をユーザーに提示して終了。
