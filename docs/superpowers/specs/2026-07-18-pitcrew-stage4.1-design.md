# pitcrew Stage 4.1: ビューア改善(新しい順ソート・一括既読) 設計書

- 日付: 2026-07-18
- 対象: `plugins/pitcrew`(現行バージョン 0.9.2)
- 前提: Stage 4(ブラウザビューア)完成・main マージ済み(コミット de35d25)
- 出典: ユーザー要望 2 件(docs/chat/2026/0717/phyllis998/pitcrew-stage4-implementation.md セッション5)

## 1. 目的

Stage 4 実機確認で出たビューアへの要望 2 件に対応する:

1. **左ペインの並び順を新しい順に**: 現状はファイル名昇順(= 連番 ID 昇順 = 古い順)で、新しい捕捉が一番下に埋もれる
2. **一括既読機能**: 現状は 1 件ずつ「承認して既読」しかなく、たまったキューを一掃できない

## 2. 決定事項(ユーザー合意済み)

| 論点 | 決定 |
|---|---|
| 一括既読の操作単位 | チェックボックス選択式 + 「全選択」トグル |
| ソート対象 | 「レビュー待ち」「レビュー済み」の両セクション |
| ソートの実装位置 | サーバー側(`state.ts` の `readItems`)— A 案 |
| 一括既読の実装方式 | 一括 API `POST /api/approve-batch` を新設 — A 案 |

## 3. 設計

### 3.1 新しい順ソート(読み取り側: `src/server/state.ts`)

- `readItems()` の `names.sort()` を **降順ソート** に変更する
- 根拠: キューのファイル名は `<3桁ゼロ埋め連番ID>-<type>-<slug>.md`(`src/lib/review.ts` の `writeReviewItem`)なので「ファイル名降順 = 新しい順」が成り立つ。frontmatter の `created`(破損ファイルでは null になり得る)に依存しない堅牢な方法
- ソートは文字列比較の降順で十分(先頭が同一桁数のゼロ埋め連番のため)。`review` / `reviewed` 両方に適用される(同一関数のため変更は 1 箇所)
- 既知の限界: ID が 1000 に達するとゼロ埋め 3 桁を超え文字列順が崩れるが、1 実行あたりの捕捉件数として現実的でないため許容する(現行の昇順ソートも同じ限界を持つ)
- API(`/api/state`)の返却順そのものが仕様となり、UI は受け取った順に描画するだけ(UI 側のソート処理は追加しない)

### 3.2 一括既読 — サーバー側

#### `src/server/viewer-ops.ts`: `approveItems()` を追加

```ts
export interface BatchApproveResult {
  moved: string[]
  failed: string[]
}
export function approveItems(projectDir: string, names: string[]): BatchApproveResult
```

- 各 name を `isSafeName` で検証し、`review/<name>` → `reviewed/<name>` に rename
- **1 件の失敗で全体を止めない**(フェイルオープン。設計書 §9 の精神): 検証 NG・rename 失敗は `failed` に積み、残りを続行
- **部分成功のセマンティクス**: 途中で失敗があっても、既に移動した項目は戻さない(ロールバックしない)。各 rename は独立・アトミックであり、結果は `moved` / `failed` にすべて反映されるため、呼び出し側は結果を見れば完全な状態が分かる
- `reviewed/` の `mkdirSync(recursive)` はループ前に 1 回
- 既存の `approveItem()`(単件)は互換のため残す

#### `src/server/http.ts`: `POST /api/approve-batch` を追加

- リクエスト: `{ "names": ["a.md", "b.md", ...] }`
- バリデーション: JSON パース失敗・`names` が配列でない → 400。配列要素は string のみ抽出。**空配列 → 400**(`{ error: "empty names" }`)。**上限 1000 件**を超えたら 400(暴走・DoS 的リクエストの抑止。通常運用で超えることはない)
- レスポンス: `200 { ok: true, moved: [...], failed: [...] }`(部分失敗でも 200。クライアントは `failed` を見て報告する)
- 既存の `/api/approve`(単件)とそれを使う UI の「承認して既読」ボタン(`#approve-btn`)は**そのまま変更しない**。トークン認証は既存の全ルート共通機構に乗る(変更不要)
- 上限 1000 件は API 側の防御であり、UI 側での上限チェックは行わない(全選択でも実運用でこの件数に達しないため。達した場合は 400 が toast で「失敗」として報告される)

### 3.3 一括既読 — UI 側(`src/server/ui.html`)

- **チェックボックス**: 「レビュー待ち」セクションの各項目の行頭に配置。クリックは項目選択(詳細表示)と干渉しないよう `stopPropagation` する。「レビュー済み」セクションには付けない(reviewed → review の逆方向移動は設計書 §5 で書き込み対象外)
- **セクションヘッダー**: 「レビュー待ち」見出し行に「全選択」トグル(チェックボックス)と「選択を既読 (N)」ボタンを配置。N は選択件数で、0 件時はボタン無効化
- **実行フロー**: ボタン押下 → `confirm("選択した N 件を既読にしますか?")` → `/api/approve-batch` 呼び出し → toast で結果報告(例: 「N 件を既読にしました」。`failed` があれば「M 件失敗」も併記) → `refresh()`
- **選択状態の維持**: 既存の `let selected` と同様に、クロージャ変数 `const checkedNames = new Set()` で選択済み name を保持し、`renderQueue()` が描画時に Set を参照してチェック状態を復元する。この方式により SSE 再描画・SSE 再接続後の `refresh()` でも選択は維持される。`state.review` に存在しなくなった name(既読化・注入で移動した項目)は描画時に Set から除去する
- **`renderQueue()` の整理**: セクションヘッダー(見出し + 全選択トグル + 一括既読ボタン)の生成は肥大化を避けるため補助関数(例: `renderSectionHeader`)に切り出す
- **XSS 方針の維持**: 既存方針どおり DOM 生成は `createElement` + `textContent` のみ。`innerHTML` は使わない

### 3.4 変更しないもの

- `watch.ts` / `serve.ts` / `run.json` まわり: 変更不要(rename は既存の watcher が検知し SSE が発火する)
- 一括既読の Undo(reviewed → review へ戻す機能): スコープ外。必要になったら将来の Stage で扱う
- 「レビュー済み」セクションの一括操作: スコープ外

## 4. エラー処理

| ケース | 挙動 |
|---|---|
| 不正な name(パストラバーサル等) | `isSafeName` で弾き `failed` に計上(サーバーは 200 を返す) |
| rename 失敗(既に移動済み・削除済み) | `failed` に計上し残りを続行 |
| `names` が空・非配列・JSON 破損 | 400 |
| 一括実行中に注入が同じファイルを先に移動 | rename が失敗 → `failed` 計上のみ。データ破壊なし(rename はアトミック) |

## 5. テスト

- `state.test.ts`: `readItems` が降順(新しい順)で返すことを検証(review / reviewed 両方)
- `viewer-ops.test.ts`: `approveItems` の正常系・部分失敗(不正 name 混在・存在しないファイル混在)・空配列
- `http.test.ts`: `/api/approve-batch` の 200(全成功・部分失敗)・400(空・非配列・JSON 破損)・401(トークンなし)・上限超過 400
- 既存 704 テストを壊さないこと。**実装の最初のステップとして**、ソート順(`readItems` の返却順)に依存する既存テストを洗い出し、影響範囲を把握してから着手する(期待値の更新が必要なのはその範囲のみ)
- UI(`ui.html`)は既存どおり自動テスト対象外(サーバー側 API のユニットテストでロジックを担保し、UI は実機確認で検証する)

## 6. 完了条件

- 全テスト PASS(既存 + 追加)
- `pnpm build` でバンドル再生成し、生成物の差分もコミット(バンドルは git 管理)
- `plugins/pitcrew/.claude-plugin/plugin.json` のバージョンを 0.9.2 → 0.9.3 に上げる
- README のビューア節に一括既読の記述を追記(スクリーンショット更新は不要)

## 7. 制約(リポジトリ方針の再確認)

- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装は不可(本件は該当なし: ローカル HTTP サーバーと UI のみ)
- 実装は CLAUDE.md のエージェント運用方針に従い GPT エージェントへ委譲する(通常実装のため `GPT Terra` 想定。オーケストレーターは設計・レビュー・最終確認を担う)
