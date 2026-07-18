# pitcrew Stage 4.2: serve restart・ビューアから config 変更・Ctrl+Enter 送信 設計書

- 日付: 2026-07-18
- 対象: `plugins/pitcrew`(現行バージョン 0.9.3)
- 前提: Stage 4.1(新しい順ソート・一括既読)完成・main マージ済み(コミット a6462bb)
- 出典: ユーザー要望 3 件(docs/chat/2026/0718/phyllis998/pitcrew-stage4.1-design.md セッション4。バックログ: メモリ pitcrew-viewer-backlog.md)

## 1. 目的

Stage 4.1 実機確認で出た要望 3 件に対応する:

1. **`/pitcrew:serve` に restart**: 現状は start / stop のみで、再起動には 2 回の依頼が必要
2. **ビューアから config を変更**: 現状は `/pitcrew:config`(対話式)のみ。ブラウザ UI から設定を変更したい
3. **コメントの Ctrl+Enter 送信**: 現状は「送信」ボタンのクリックのみ

## 2. 決定事項(ユーザー合意済み)

| 論点 | 決定 |
|---|---|
| UI から編集できる config の範囲 | 全 7 項目(viewer / capture_targets / artifact_globs / test_commands / injection_timing / theme / port) |
| port / theme などサーバー側設定の反映 | 保存のみ行い、再起動が必要な旨を UI で案内(自動ホット適用はしない) |
| restart の実装方式 | コマンド手順(serve.md)のみ拡張。serve.ts のコード変更なし。UI に再起動ボタンは付けない |
| config 変更 API の方式 | 案A: 構造化 config API(`GET/POST /api/config`)+ `saveConfig()` 新設 |
| ビューア保存時の .gitignore の扱い | サーバーは .gitignore を編集しない。レスポンスの `gitignoreMissing` で UI が追記推奨を一言案内 |

## 3. 設計

### 3.1 要望① `/pitcrew:serve restart`(`commands/serve.md` のみ)

- 手順書に「引数に `restart` が含まれる場合」の節を追加する:
  1. 既存の停止手順を実行(`serve.json` の `pid` へ SIGTERM)
  2. **プロセスの終了を確認してから**次へ進む: `kill -0 <pid>` が失敗するまで 1 秒間隔・最大 10 秒待機。旧プロセスがポートを掴んだまま起動すると EADDRINUSE で失敗するため
  3. 既存の起動手順を実行し、URL を提示する
- 起動していない状態(serve.json 無し・pid 死亡)で restart された場合は、エラーにせずそのまま起動だけ行う
- 10 秒待っても旧プロセスが終了しない場合は、その旨と手動確認(`kill -9` は案内しない。プロセス確認を促す)をユーザーに伝えて中断する
- `serve.ts` は変更しない

### 3.2 要望③ コメントの Ctrl+Enter 送信(`src/server/ui.html` のみ)

- `#comment-body`(textarea)に `keydown` ハンドラを追加: `(e.ctrlKey || e.metaKey) && e.key === "Enter"` で送信処理を発火(macOS の Cmd+Enter にも対応)
- 発火方法は既存の click ハンドラ(ui.html 内 `$("comment-send").addEventListener("click", ...)`)の処理を共有する。関数への切り出し or `$("comment-send").click()` のどちらにするかは実装計画で確定(挙動は同一)
- 空本文のガードは既存の送信処理側がそのまま効く(新規バリデーション不要)
- placeholder 文言に「Ctrl+Enter で送信」を追記して発見可能性を確保

### 3.3 要望② ビューアから config 変更

#### 3.3.1 API(`src/server/http.ts` に 2 ルート追加)

既存ルートと同じくトークン必須(認証機構は変更なし)。

**`GET /api/config`**

- `loadConfig(projectDir)` の結果をそのまま JSON で返す(200)
- ファイルが無い・壊れている場合も既定値が返る(既存のフェイルオープンをそのまま利用)

**`POST /api/config`**

- リクエスト: 7 項目**すべて**を含む完全な JSON(PUT 的セマンティクス。部分更新は受け付けない):

```json
{
  "viewer": "browser",
  "captureTargets": { "diff": true, "artifact": true, "test": true },
  "artifactGlobs": ["docs/**/*.md"],
  "testCommands": [],
  "injectionTiming": "hybrid",
  "theme": "dark",
  "port": 7373
}
```

- バリデーションは `validateConfig()`(後述)に委譲。違反時は `400 { "error": "<フィールド名>" }`
- JSON パース失敗は `400 { "error": "bad json" }`
- 成功時: `saveConfig()` で保存し `200 { "ok": true, "gitignoreMissing": [...] }`
- `gitignoreMissing`: プロジェクトの `.gitignore` を読み、`.pitcrew/` と `.claude/pitcrew.local.md` のうち未登録のものを列挙(`.gitignore` が無ければ両方)。判定は**前後空白を無視した行の完全一致**で十分とし、gitignore パターンの完全解釈はしない。サーバーは `.gitignore` を**編集しない**

#### 3.3.2 `src/lib/config.ts`: `saveConfig()` / `validateConfig()` を追加

```ts
export function validateConfig(input: unknown): { config: PitcrewConfig } | { error: string }
export function saveConfig(projectDir: string, config: PitcrewConfig): void
```

- **`validateConfig()`**: 検証規則は `loadConfig()` と同一(列挙値・port は整数 1〜65535・配列要素は string)に加え、**書式制約由来の規則**を追加:
  - `artifactGlobs` / `testCommands` の要素にカンマ・改行を含めない(フラット YAML のインライン配列を壊すため)。空文字列要素も不可
  - `artifactGlobs` は空配列不可(`loadConfig` が「指定なし」として既定に落とす値を UI から保存させない)
  - `testCommands` は空配列可
  - フィールド欠落・型違いはそのフィールド名を `error` に入れて返す
- **`saveConfig()`**: `.claude/pitcrew.local.md` を書き出す
  - frontmatter は `/pitcrew:config`(config.md §3)と同一形式: フラットな key-value+インライン配列、glob 等 `*` / `/` を含む値は `"` で囲む、`port` は `"7373"` の引用文字列、配列要素にカンマなし(validateConfig が保証)
  - 本文(設定の説明文)は config.md 記載のテンプレートと同内容の固定文字列で出力する。**既存ファイルの本文は保持しない**(本文は説明書きであり設定値ではないため、単純さを優先して frontmatter+テンプレ本文で上書き)
  - 書き込みは既存 `writeFileAtomic` を使用。`.claude/` が無ければ作成(`mkdirSync recursive`)
- 読み(`loadConfig`)・検証(`validateConfig`)・書き(`saveConfig`)を config.ts の 1 モジュールに集約し、http.ts には HTTP の関心事だけを残す

#### 3.3.3 UI(`src/server/ui.html`)

- ヘッダーに ⚙(設定)ボタンを追加。クリックで設定パネルを開閉(モーダルではなくインライン展開のセクション。既存 UI の作りに合わせる)
- パネルを開くたびに `GET /api/config` で現在値を取得しフォームへ反映
- フォーム構成:
  - `viewer` / `injectionTiming` / `theme`: ラジオまたはセレクト
  - `captureTargets`: チェックボックス 3 つ(diff / artifact / test)
  - `artifactGlobs` / `testCommands`: 1 行 1 要素の textarea(送信時に行分割し空行を除去)
  - `port`: number input
- 「保存」ボタンで `POST /api/config`:
  - 成功時: 「保存しました。port / theme の変更は次回のビューア起動から反映されます(`/pitcrew:serve restart`)」と表示。`gitignoreMissing` が非空なら「`.pitcrew/` と `.claude/pitcrew.local.md` は .gitignore への追記を推奨します(`/pitcrew:config` で追記できます)」を併記
  - 400 時: エラーのフィールド名を添えて表示
- theme は保存成功時に UI 側のテーマ切替を即時実行する(既存の theme 適用処理を再利用できる場合のみ。再利用できなければ即時適用はせず再起動案内に含める — 実装計画で確定)
- XSS 方針の維持: 既存方針どおり DOM 生成は `createElement` + `textContent` のみ。`innerHTML` は使わない

#### 3.3.4 反映のセマンティクス

- hooks(捕捉層・注入層)は短命プロセスで毎回 `loadConfig()` するため、保存が**次の hook 起動から自動反映**される(既存設計どおり。追加実装なし)
- ビューアサーバー自身が起動時に読む `port` / `theme` は再起動(`/pitcrew:serve restart`)まで反映されない — UI の保存成功メッセージで案内する
- `/pitcrew:config`(対話式コマンド)は従来どおり残す。同じファイルを両者が書くが形式が同一のため相互運用に問題なし

### 3.4 変更しないもの

- `serve.ts` / `watch.ts` / `state.ts` / `viewer-ops.ts`: 変更不要
- `commands/config.md`: 変更不要(.gitignore 案内は現行の手順 4 で既に `.pitcrew/` と `.claude/pitcrew.local.md` の両方を対象にしている)
- 既存 API(`/api/state` / `/api/item` / `/api/approve` / `/api/approve-batch` / `/api/comment` / `/api/events`): 変更なし
- UI からのサーバー再起動(`/api/restart`): スコープ外(決定事項どおりコマンド手順のみ)

## 4. エラー処理

| ケース | 挙動 |
|---|---|
| POST /api/config の JSON 破損 | 400 `{ error: "bad json" }` |
| フィールド欠落・型違い・列挙値違反・port 範囲外 | 400 `{ error: "<フィールド名>" }` |
| glob / testCommands の要素にカンマ・改行 | 400(フラット YAML を壊す値は保存前に拒否) |
| artifactGlobs 空配列 | 400 |
| 書き込み失敗(権限等) | 500(既存の共通ハンドラ)。writeFileAtomic により中途半端なファイルは残らない |
| .gitignore が読めない | `gitignoreMissing` は両方(未登録扱い)を返す。保存自体は成功 |
| restart 時に旧プロセスが 10 秒で終了しない | 起動へ進まず、状況をユーザーに伝えて中断(serve.md の手順) |

## 5. テスト

### 5.1 `src/lib/__test__/config.test.ts`(追加)

- `saveConfig()`: 保存 → `loadConfig()` で読み戻して全項目一致(ラウンドトリップ)。glob の引用・port の引用文字列・インライン配列が config.md の書式どおりであること。`.claude/` が無い場合の作成
- `validateConfig()`: 正常系(全項目)/ 異常系 — 列挙値違反・port 範囲外・非整数、glob / testCommands のカンマ・改行・空文字列混入、artifactGlobs 空配列、フィールド欠落、型違い。それぞれ `error` に該当フィールド名が入ること

### 5.2 `src/server/__test__/http.test.ts`(追加)

- `GET /api/config`: 401(トークン無し)/ 200 で現在値 JSON / config ファイル無しでも既定値
- `POST /api/config`: 200 で保存+ファイル生成 / 400(バリデーション違反・不正 JSON)/ 401
- `gitignoreMissing`: `.gitignore` 無し → 両方 / 片方のみ登録済み → 残りのみ / 両方登録済み(前後空白付き行でも一致)→ 空配列

### 5.3 実機確認(自動テスト対象外)

- 設定パネル: 開閉・現在値の反映・保存・エラー表示(不正 port 等)・保存後の再起動案内・gitignore 案内
- Ctrl+Enter / Cmd+Enter 送信(空本文で送信されないこと・送信後のクリア)
- `/pitcrew:serve restart`: 起動中の restart(URL 再提示)/ 未起動時の restart(そのまま起動)

### 5.4 回帰

- 既存 711 件+追加分の全テスト・lint(biome)・typecheck を最終レビュー前に通す
- Stage 4.1 の教訓: 実装タスクごとに biome 整形を確認する(整形漏れで lint 失敗した前例あり)

## 6. 完了条件

- 全テスト PASS(既存+追加)
- `pnpm build` でバンドル再生成し、生成物の差分もコミット(バンドルは git 管理)
- `plugins/pitcrew/.claude-plugin/plugin.json` のバージョンを 0.9.3 → 0.9.4 に上げる(計画外のバージョン変更をしない — Stage 4.1 で計画外の 0.10.0 変更が混入した前例あり)
- README のビューア節に設定パネルと Ctrl+Enter 送信、serve 節に restart の記述を追記

## 7. 制約(リポジトリ方針の再確認)

- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装は不可(本件は該当なし: ローカル HTTP サーバーと UI・コマンド手順書のみ)
- 実装は CLAUDE.md のエージェント運用方針に従い GPT エージェントへ委譲する(通常実装のため `GPT Terra` 想定。ui.html の設定パネルは分量があるが非自明な設計判断は本書で確定済み。オーケストレーターは設計・レビュー・最終確認を担う)
