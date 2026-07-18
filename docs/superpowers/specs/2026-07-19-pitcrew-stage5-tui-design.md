# pitcrew Stage 5: TUI ビューア(`pitcrew watch`) 設計書

- 日付: 2026-07-19
- 対象: `plugins/pitcrew`(現行バージョン 0.9.4)
- 前提: Stage 1-4.2 完成・main マージ済み(直近コミット 4b086e7)
- 出典: マスター設計書 `docs/superpowers/specs/2026-07-16-pitcrew-design.md` §5「B: ターミナル TUI」・§12「実装ステージ(概要)」(Stage 5 = TUI ビューア)

## 1. 目的

マスター設計書が Stage 5 として予約していた「B: ターミナル TUI」を実装する。ブラウザビューア(Stage 4)と並ぶ、ファイルバス(`.pitcrew/`)上のもう1つの選択式ビューアとして、`pitcrew watch` コマンドでキュー一覧・詳細プレビュー・コメント作成・承認をターミナル上で行えるようにする。

## 2. 決定事項(ユーザー合意済み)

| 論点 | 決定 |
|---|---|
| `/pitcrew:watch` の役割 | Claude は何も実行しない。ターミナルで直接実行するコマンドの案内のみ(TUI はキー入力を扱うため Claude の Bash ツールでは操作できない) |
| diff プレビューの色付け | `+`/`-` 行のみ色付け(緑/赤)。ファイルタブ・行番号などブラウザ相当の作り込みはしない |
| 一覧の自動更新 | `watchPitcrew` を流用したライブリロード(手動リフレッシュキーは設けない) |
| `$EDITOR`/`$VISUAL` 未設定時 | エラー表示のみ(`vi`/`notepad` へのフォールバックはしない) |
| 一覧の表示範囲 | `review/`(未レビュー)のみ。`reviewed/` の一覧表示はしない |
| 画面描画方式 | 代替スクリーンバッファ(alt screen buffer, `\x1b[?1049h`/`l`)+ 全画面再描画 |
| ロジックの共有 | `approveItem`・`writeComment` 等の操作ロジックはブラウザビューアと共有し、TUI 側で再実装しない |

## 3. 設計

### 3.1 モジュール構成

```
src/tui/
├── render.ts   # 純粋関数: QueueItem[] + 選択位置 + 端末サイズ → 描画用文字列配列
├── keymap.ts    # 純粋関数: キー入力 + 現在状態 → アクション(Move/Comment/Approve/Quit/Resize)
├── editor.ts     # $EDITOR を子プロセスとして起動し、編集結果を読み戻す
└── loop.ts       # 上記を束ねるイベントループ(raw mode・alt screen・fs watch)
scripts/watch.mjs  # src/tui/main.ts のバンドル出力(build.ts にエントリを追加)
```

**既存資産の再利用**:

- `src/server/state.ts` の `listState`/`readItems` → キュー一覧・本文の取得
- `src/server/watch.ts` の `watchPitcrew` → ライブリロードの検知
- `viewer-ops.ts` の `approveItem`・`writeComment`・`nextCommentNumber` → 承認・コメント保存

**既存構造への手直し**: `viewer-ops.ts` は HTTP に依存しない純粋な操作関数群だが、現在 `src/server/` 配下にあり TUI からの import が層をまたぐ。`src/lib/viewer-ops.ts` へ移動し、`src/server/http.ts` と `src/tui/` の両方がそこから import する(ロジック変更なし、置き場所と import パスのみの変更)。

`build.ts` に `scripts/watch.mjs` のバンドルエントリ(`src/tui/main.ts` を入口)を追加する。

### 3.2 画面レイアウトと操作

```
┌─────────────────────────────────────────┐
│ 未レビュー: 3   未回収コメント: 1          │ ← ステータスバー(1行)
├─────────────────────────────────────────┤
│→ 003  diff       implementer#2   2分前    │ ← キュー一覧(新しい順・ID 降順)
│  002  artifact   designer        5分前    │
│  001  test        implementer#1   8分前    │
├─────────────────────────────────────────┤
│ id:002 type:artifact agent:designer      │ ← 詳細プレビュー(残り全行)
│ + 追加行 (緑)                             │
│ - 削除行 (赤)                             │
│   コンテキスト行 (無色)                    │
├─────────────────────────────────────────┤
│ [j/k]移動 [c]コメント [a]承認して既読 [q]終了│ ← キーヘルプ(1行)
└─────────────────────────────────────────┘
```

- キュー一覧は `review/` のみを対象に、ID 降順(新しい順)で表示する(ブラウザビューアと同じ並び順)
- `j`/`k`: 選択移動(先頭・末尾で止まる。ラップしない)
- `a`: `approveItem(projectDir, name)` を呼び `reviewed/` へ移動。一覧から即座に消える(選択は次の項目、無ければ直前の項目へ移動)
- `c`: 3.3 節のフロー
- `q`: 3.5 節の後始末をして終了(exit code 0)
- 端末の `resize` イベントで一覧・プレビューの行数配分を再計算し全画面再描画する
- プレビュー領域内のスクロールは実装しない。表示内容は捕捉時点(マスター設計書 §3)で既に「先頭 N 行+全文へのパス参照」に切り詰め済みのため、追加のスクロール機構なしでも実用上問題にならない
- 端末が極端に小さい場合(ステータス行・キューヘッダー行・キーヘルプ行の固定 3 行を確保できない)への特別対応は行わない。行数配分の計算結果が 0 以下になった領域は単にその行数分を描画しない(該当領域が空になるだけで、クラッシュ・エラー表示はしない)。最小端末サイズの検証・警告は本ステージのスコープ外(YAGNI: `serve.md` 等の既存コマンドも端末サイズの下限チェックは行っていない)

### 3.3 コメント作成フロー(`c` キー)

1. `$EDITOR`/`$VISUAL` のどちらも未設定なら、エディタを起動せずステータス行に「$EDITOR または $VISUAL を設定してください」を表示して終了(以降の手順を行わない)
2. raw mode を一時解除し、選択項目に対する `commentTemplate()` 相当の内容(`urgency: normal`・`paths`・`reviewId`・`base` を埋め込み済み)をスクラッチ一時ファイル(OS の一時ディレクトリ配下。`.pitcrew/` の外)に書き出す
3. `$EDITOR` (`$VISUAL` があればそちらを優先) を `stdio: "inherit"` で子プロセスとして起動し、終了を待つ
4. 終了後、raw mode を復帰。alt screen は維持したまま全画面再描画する(エディタの描画残りを消す)
5. スクラッチファイルの frontmatter(`urgency` 等)と本文を読む。本文を前後の空白・改行を除去(trim)した上で、以下のいずれかに該当する場合は**何もせず**スクラッチファイルを削除する(送信しない):
   - trim 後の本文が空文字列
   - trim 後の本文が、スクラッチファイル生成時に埋め込んだプレースホルダ文字列 `(ここにコメント本文)` と完全一致する

   (注: この判定に使うスクラッチファイルの雛形は、`src/lib/review.ts` の `commentTemplate()` とは別物。`commentTemplate()` は Stage 1 の「レビュー項目内に手書き用の例を埋め込む」ための文字列で、コードフェンス・案内文を含む。TUI のスクラッチファイルはエディタで直接編集して `writeComment()` に渡すだけなので、frontmatter と本文プレースホルダのみのシンプルな雛形を新たに生成する)
6. それ以外の場合、内容を `writeComment(projectDir, { urgency, paths, reviewId, base, body })` に渡す。番号採番・原子的書き込みは既存ロジックにすべて任せる。成功後スクラッチファイルを削除する
7. 緊急度を上げたい場合はテンプレート内の `urgency: normal` を `urgency: urgent` に書き換えるのみ(TUI 独自の緊急フラグ入力 UI は作らない。マスター設計書 §5 B と同じ方針)

### 3.4 ライブリロード

`watchPitcrew` のコールバックで `.pitcrew/` の変更を検知するたびに `listState`/`readItems` を再取得し、**選択中アイテムの `id` を追跡**して選択位置を維持する。該当 id が新しい一覧に存在すれば、そのアイテムを選択状態のまま維持する(一覧内の並び順が変わっても id で追跡する)。該当 id が一覧から消えていれば(承認・削除等)、**旧一覧における配列インデックスと同じ位置**を新しい一覧に適用し、新しい一覧の件数を超える場合は末尾にクランプする(例: `[003, 002, 001]` の 3 件表示中に `002`(インデックス 1)を承認 → `a` キー操作自身がこの承認を起こした場合は 3.2 節の規定(次の項目、無ければ直前の項目)を優先し、それ以外の要因(他プロセスによる移動等)でインデックス 1 の項目が消えた場合は新しい一覧のインデックス 1(無ければ末尾)を選択する)。キー入力(`readline.emitKeypressEvents` + raw mode)は別イベントソースとして共存させ、どちらのイベントが来ても同じ描画関数(`render.ts`)を呼ぶ。

### 3.5 起動・終了・エラーハンドリング

- 起動時に `process.stdout.isTTY` が `false` の場合、「pitcrew watch は対話端末(TTY)が必要です」を stderr に出して `exit(1)`(alt screen 等には一切入らない)
- 正常終了(`q`)・異常終了(`SIGINT`/`SIGTERM`/uncaughtException)のいずれの経路でも、必ず次を実行してから終了する: raw mode 解除 → カーソル表示(`\x1b[?25h`)→ alt screen 復帰(`\x1b[?1049l`)。`process.on` のハンドラを一本化し、経路によって後始末が漏れないようにする
- `.pitcrew/` の読み取り失敗(ディレクトリ未作成・壊れたファイル等)は既存の fail-open 方針を踏襲し、空一覧として起動・継続する(hooks 側の fail-open と同じ考え方をビューア側にも適用)

### 3.6 `/pitcrew:watch` コマンド(`commands/watch.md`)

Claude は起動・停止のいずれも行わない。コマンドの内容は次の案内のみ:

```
node "<CLAUDE_PLUGIN_ROOT を解決した絶対パス>/scripts/watch.mjs" --dir "<プロジェクトルート>"
```

を提示し、「このコマンドはあなたのターミナルで直接実行してください。TUI はキー入力を伴う対話型ツールのため、Claude はこの中では操作できません」と明記する。`serve.md` と異なり `run_in_background` や `serve.json` によるプロセス確認の手順は持たない(Claude 側にプロセスが存在しないため)。

### 3.7 変更しないもの

- `src/server/http.ts` の既存 API・`ui.html`: 変更不要(`viewer-ops.ts` の import パス変更のみ影響)
- `src/lib/config.ts`: `PitcrewConfig.viewer` に既に `"tui"` が定義済みのため型変更は不要。ただし `viewer: "tui"` は現状「値として保存できるが hooks の挙動を変えない」フラグのままとし、本ステージでは `pitcrew watch` の起動要否をこの値で分岐させる実装は行わない(config で選ぶのはあくまで捕捉・注入の既定挙動であり、ビューアは常にどれでも起動できる。既存の `browser`/`files` も同様)
- `commands/config.md`・`commands/serve.md`: 変更不要

## 4. エラー処理

| ケース | 挙動 |
|---|---|
| 非 TTY で起動 | stderr にメッセージ、`exit(1)` |
| `$EDITOR`/`$VISUAL` 未設定で `c` | ステータス行にエラー表示のみ、以降の手順を行わない |
| エディタ終了後、本文が空 or 未変更 | コメントを送信せずスクラッチファイルを削除 |
| `.pitcrew/` 読み取り失敗 | 空一覧として起動・継続(fail-open) |
| `a` 実行時に対象ファイルが既に無い(他プロセスが移動済み等) | `approveItem` が `false` を返すのでステータス行に一言表示し、次の `watchPitcrew` 検知で一覧を再取得する |
| プロセス強制終了(SIGINT 等) | raw mode 解除・カーソル表示・alt screen 復帰を必ず実行してから終了 |

## 5. テスト

### 5.1 `src/tui/__test__/render.test.ts`(新規)

- 空一覧・複数件・選択位置の境界(先頭/末尾)での出力
- diff 本文の `+`/`-` 行色付け(該当行にのみ ANSI コードが付くこと)
- 端末幅・高さに応じた一覧/プレビューの行数配分

### 5.2 `src/tui/__test__/keymap.test.ts`(新規)

- `j`/`k` による選択移動(境界でのクランプ)
- `c`/`a`/`q` の各キーが対応するアクションを返すこと
- 未定義キーは no-op アクションを返すこと

### 5.3 `src/tui/__test__/editor.test.ts`(新規)

- `$EDITOR`/`$VISUAL` の優先順位(`$VISUAL` が設定されていればそちらを使う)
- どちらも未設定時にエラー扱いとなること(子プロセスを起動しない)
- spawn に渡す引数(スクラッチファイルパス・`stdio: "inherit"`)の検証

### 5.4 `src/lib/__test__/viewer-ops.test.ts`(移動)

- `src/server/__test__/viewer-ops.test.ts` を移動元の内容のまま `src/lib/__test__/` へ移す(ロジック変更なし)

### 5.5 実機確認(自動テスト対象外)

- `pitcrew watch` の起動(alt screen への切り替え・終了後の画面復帰)
- `j`/`k` 移動・`a` 承認・`c` コメント作成(エディタ起動・保存・キャンセル)・`q` 終了
- 別プロセス(Claude Code セッション)がサブエージェントを完了させた際のライブリロード(選択位置の維持を含む)
- 端末リサイズ時の再描画
- 非 TTY での起動時のエラーメッセージ

### 5.6 回帰

- 既存の全テスト・lint(biome)・typecheck を最終レビュー前に通す

## 6. 完了条件

- 全テスト PASS(既存+新規)
- `pnpm build` でバンドル再生成し、生成物の差分もコミット(バンドルは git 管理)
- `plugins/pitcrew/.claude-plugin/plugin.json` のバージョンを 0.9.4 → 0.10.0 に上げる(新ビューアの追加であり Stage 4 相当の規模。メジャーバージョンは変更しない)
- README に TUI ビューア節(`pitcrew watch` の起動方法・キー操作一覧)を追加し、「TUI は後続ステージで追加予定」の記述(冒頭の説明文、および設定表の `viewer` 行「`browser` / `tui` は後続ステージで実装予定」)を削除・更新する(`browser` は Stage 4 で既に実装済みのため、この 2 箇所は本ステージ以前から既に古い記述だったが、本ステージの完了条件として合わせて是正する)
- `docs/superpowers/specs/2026-07-16-pitcrew-design.md` §12 の Stage 5 行は変更しない(実装済みマーキングは README・chat 記録側で行う)

## 7. 制約(リポジトリ方針の再確認)

- Anthropic API・`ANTHROPIC_API_KEY` 前提の実装は不可(本件は該当なし: ローカルの Node CLI プロセスのみ)
- 依存は Node 標準ライブラリのみ(既存方針を継続。TUI フレームワーク・キー入力ライブラリの追加は行わない)
- 実装は CLAUDE.md のエージェント運用方針に従い GPT エージェントへ委譲する。`src/tui/` 配下(`render.ts`/`keymap.ts`/`editor.ts`/`loop.ts`)・`viewer-ops.ts` の移動・`build.ts`/README 更新はいずれも非自明な設計判断を含まない通常実装であり `GPT Terra` 想定(担当の割り振り自体は後続の実装計画で確定する)。オーケストレーターは設計・レビュー・最終確認を担う
