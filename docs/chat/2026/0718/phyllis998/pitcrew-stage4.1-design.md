# Pitcrew Stage 4.1 — ビューア改善設計(ソート・一括既読)

- 日付: 2026-07-18
- 参加者: phyllis998, AI (Claude Sonnet 5, Haiku)
- 成果物: 
  - 設計書: `docs/superpowers/specs/2026-07-18-pitcrew-stage4.1-design.md` (コミット `bbd12bb`)
  - 実装計画書: `docs/superpowers/plans/2026-07-18-pitcrew-stage4.1.md` (コミット `ca1cb4b`)
  - 実装ブランチ: `feature/pitcrew-stage4.1` (6 コミット、main @ `7a0ed19` から作成)
    - Task 1: `0d4ae2c`
    - Task 2: `32eada4`
    - Task 3: `5fd98d0`
    - Task 4: `114b4c7` (初版) + `0a380c3` (混入修正)
    - Task 5: `7e45841`
  - マージコミット: `a6462bb` (main へ --no-ff マージ、13 ファイル +515 -17)
  - リリース: **pitcrew v0.9.3**(正式版)
  - プロジェクトメモリ: `pitcrew-viewer-backlog.md` 更新(対応済み 2 件 → 対応済みセクション移動、新規要望 3 件記録)
  - 進捗台帳: `.superpowers/sdd/progress.md` にクローズ記録
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

> 実装計画に進めてください

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

## セッション3: Subagent-Driven 実装・全タスク完了・最終レビュー

# phyllis998

> 1で進めてください

# AI

Subagent-Driven 方式(タスクごとにサブエージェント起動、実装者は GPT Terra / GPT Luna、レビューは Sonnet)で進行開始。subagent-driven-development スキルに従い、フィーチャーブランチを `feature/pitcrew-stage4.1` として main @ `7a0ed19` から作成し、進捗台帳(.superpowers/sdd/progress.md)を初期化した。

**Task 1 — readItems 降順ソート** (`0d4ae2c`)

テスト先行で既存 704 テストのベースラインを確認後、`readItems()` の `review` / `reviewed` 両セクションで `names.sort().reverse()` へ修正。実装者は既存テストパターンに従い新規テストを追加。Sonnet レビューで spec・quality を検証し承認。

**Task 2 — approveItems メソッド追加** (`32eada4`)

`viewer-ops.ts` に `approveItems(projectDir, names)` を追加。フェイルオープン設計に従い、各 `isSafeName` 検証 → `rename` → 結果を `moved` / `failed` に分類。1 件の失敗も全体を止めず、結果は配列で完全に返却。Sonnet レビューで実装と仕様の整合、エラーハンドリングを検証し承認。

**Task 3 — POST /api/approve-batch エンドポイント追加** (`5fd98d0`)

`http.ts` に新エンドポイントを実装。body の `names` 配列を検証(400 系 3 種: 欠落・型エラー・1000 件超過)し、Task 2 の `approveItems()` に委譲。結果を `{moved: string[], failed: string[]}` で返却。Sonnet レビューで API 仕様・バリデーション・既存ヘッダー変数との整合を検証し承認。

**Task 4 — UI 層チェックボックス・全選択・一括既読ボタン** (`114b4c7` + `0a380c3`)

`ui.html` にチェックボックス UI を追加。「レビュー待ち」セクション各項目に checkbox 追加(クリック時の `stopPropagation` で項目選択と干渉しない)。セクション見出しに「全選択」トグルと「選択を既読 (N)」ボタン実装。実行前に `confirm()` で誤操作防止。実行後は toast で件数報告 → `refresh()`。選択状態は Set `checkedNames` で管理し、SSE 再描画後も復元される設計。

**実装中の逸脱 2 件:**

1. **Task 4 実装者が plugin.json を計画外に 0.10.0 に変更** — `git show --stat` で即検出。本来は Task 5 で 0.9.3 へ統一する計画のため、0.9.2 へ復元して 114b4c7 にコミット。この逸脱が最終的に修正の必要がなくなる伏線
2. **Task 3 実装者の biome 整形漏れで lint 失敗** — 初版 5fd98d0 の直後にレビューが回り、修正されず Task 4 に進んだため。Task 4 完了後に lint をクリアする追加コミット 0a380c3 を実装者に回し、修正完了

両事案ともタスク間ゲートで検出でき、本体実装には影響を与えず。

**Task 5 — ドキュメント・バージョン・バンドル再生成** (`7e45841`)

README に新機能(新しい順ソート・チェックボックス・一括既読)を追記。`plugin.json` を 0.9.3 へ。`pnpm build` 実行し、バンドル(`bundle/` 配下の .mjs / .html)を再生成してコミット。スクリーンショット等の補助ドキュメント追加なし(通常の小版バージョンアップ範囲)。Sonnet レビューで設計書との整合・バンドル整合・版番号の正確性を検証し承認。指摘なし。

**最終レビュー(オーケストレーター実施)**

全ブランチ diff (main @ 7a0ed19 から feature/pitcrew-stage4.1、6 コミット、11 ファイル +445 -14)を精査。以下の項目を検証：

- **バンドル / ソース整合**: 手書き改変・混入なし。biome 整形・git 圧縮に収まる。バンドル差分と src/ 差分が正確に対応
- **XSS 方針**: チェックボックス state 管理に `checkedNames` Set を使用し、DOM 再構築時に一貫性を保持。既存の `textContent` 設定方針に準拠
- **API 契約**: 既存の single `/api/approve` API は変更なし。新 `/api/approve-batch` は 1000 件上限・部分成功セマンティクス・400 系バリデーション 3 種で明確に独立
- **認証**: 既存 pitcrew の認証フロー(HTTP ベース、Token ヘッダー検証)に変更なし

**Deferred Minor 5 件の triage 完了**:
- Task 1: UI 型定義の補足ヒント → 既存スタイルと整合(修正不要)
- Task 2: `moved` 配列の順序保証なし → 計画で明記済み(修正不要)
- Task 3: 429(rate limit) エラーの将来拡張性 → 計画の 400 系 3 種に限定が確定仕様(修正不要)
- Task 4: 選択状態の localStorage 永続化 → 計画で「Set クロージャで済む」と明記(修正不要)
- Task 5: `plugin.json` のフィールド順序 → git diff では無視される無風(修正不要)

**テスト結果**: 711 テスト中 711 PASS。既存 704 テストはすべて通過、新規テスト 7 件も通過。lint、typecheck も PASS。

**状態**: Ready to merge = **Yes**。ユーザーへの確認待ち：
1. main への `--no-ff` マージの承認
2. 実機確認 4 項目(新しい順表示・複数選択一括既読・全選択一掃・チェック時に詳細ペイン非切替)

---

## セッション4: マージ・リリース完了・追加要望収集・Stage 4.1 クローズ

# phyllis998

> 動作確認ができました。追加の要望があります。今すぐでなくてよいので、どこかのStageで対応したいです。
> 1. /pitcrew:serve に restart 引数を追加したい
> 2. ビューワーに config を変える方法がほしい
> 3. コメントの入力時、ctl+enterで送信できるようにしたい

# AI

ユーザーが実機確認 4 項目の完了を報告。feature/pitcrew-stage4.1 を main へ **--no-ff マージ**実施。マージコミット `a6462bb` で 13 ファイル +515 -17 の変更を統合。マージ直後に全テスト実行し 711/711 PASS を確認。フィーチャーブランチ `feature/pitcrew-stage4.1` を削除。pitcrew を正式版 **v0.9.3** へ release。

**Stage 4.1 完全クローズ。** 追加要望 3 件をプロジェクトメモリの `pitcrew-viewer-backlog.md` に保存した：

1. **`/pitcrew:serve` に restart 引数** — 現状は start / stop のみ。serve.ts に restart 機能を追加
2. **ビューアから config を変更** — 現状は `/pitcrew:config` の対話式のみ。UI からの設定変更手段を追加
3. **コメント入力の Ctrl+Enter 送信** — ui.html の textarea に keydown ハンドラ追加(小規模な変更)

メモリには実装の起点となるファイル(serve.ts・pitcrew.local.md・ui.html の該当箇所)を注記。対応済みの 2 件(新しい順ソート・一括既読)は対応済みセクションに移動。

**次回の提案**: 3 件は独立性が高く、特に③は小規模であることから、次回まとめて 1 つの Stage(Stage 4.2 相当)として設計・実装するのが効率的と考えられる。着手時は従来どおり brainstorming → 設計書 → 実装計画の流れで進める。進捗台帳にも Stage 4.1 クローズを記録済み。

---

注意事項: Stage 4.1 完全クローズ。追加要望 3 件はバックログに保存済み、次回セッション着手可能。マージコミット a6462bb で pitcrew は v0.9.3 正式リリース。
