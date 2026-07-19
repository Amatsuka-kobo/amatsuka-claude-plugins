# Pitcrew Stage 5: TUI ビューア設計セッション

- 日付: 2026-07-19
- 参加者: phyllis998, AI (Claude Haiku 4.5, Claude Opus)
- 成果物: `docs/superpowers/specs/2026-07-19-pitcrew-stage5-tui-design.md`(コミット `266a4cd`, `1fabd89`, 複数修正), `docs/superpowers/plans/2026-07-19-pitcrew-stage5.md`, 実装コミット `e102a32`, `a1b6d8f`, `d3689b0`, `2b84c13`, `52c1d29`, `dbc41ed`, マージコミット `d4ee5d7`
- 前提: `docs/chat/2026/0718/phyllis998/pitcrew-stage4.2-design.md`, `docs/superpowers/specs/2026-07-16-pitcrew-design.md`, `docs/superpowers/specs/2026-07-18-pitcrew-stage4.2-design.md`, 前回記録(`docs/chat/2026/0719/phyllis998/pitcrew-stage5-tui-design.md`のセッション 1-6)

---

## セッション 1: Stage 4.2 の完了状況確認と Stage 5 の発見

# phyllis998

> pitcrewプラグインの設計書がsuperpowers/specs/2026-0716-pitcrew-design.mdにあります。これを見てください

# AI

chat-recall により過去記録(`docs/chat/2026/0718/phyllis998/pitcrew-stage4.2-design.md`)を検索し読解。

**Stage 4.2 の要旨**：
- serve restart 機能(`/pitcrew:serve` に restart 手順追加)
- 設定パネル(`GET/POST /api/config` + UI のモーダル dialog、7項目設定対応)
- Ctrl+Enter 送信(コメント欄での Ctrl+Enter/Cmd+Enter キー送信)
- v0.9.4、733/733 テスト PASS、記録時点で main へのマージ待機中

**Stage 5 について**：過去記録には Stage 5 の言及・具体的計画がない。既存メモリ(`pitcrew-viewer-backlog.md`)では「受領済み要望は Stage 4.2 までですべて対応済み・未対応なし」。

マスター設計書(`docs/superpowers/specs/2026-07-16-pitcrew-design.md`)を確認したところ、§12(実装ステージ概要)に Stage 5 = TUI ビューア(`pitcrew watch`)であることが記載。

---

## セッション 2: 既存実装の確認と TUI の役割定義

# AI

既存実装確認。`PitcrewConfig.viewer` に `"tui"` が予約されており、`state.ts`(`listState`/`readItems`)、`watch.ts`(`watchPitcrew`)、`comments.ts`、`viewer-ops.ts` など TUI からも再利用できる基盤が整っている。

**重要な制約**: TUI はキー入力(j/k, c, a, q)を受け取る必要があり、Claude Code の Bash ツール(バックグラウンド実行・ポーリング出力)では原理的に扱えない。ブラウザビューア(`serve`)は「Claude がサーバーを起動 → 人間がブラウザで操作」という分業だが、TUI は起動から操作まで人間が自分のターミナルで直接行う必要がある。

**質問**: `/pitcrew:watch` コマンドの役割をどうするか？

# phyllis998

> 「ターミナルで直接実行できる `pitcrew watch` を作り、`/pitcrew:watch` はその案内」でいいです

# AI

了解。`/pitcrew:watch` はターミナル実行案内のみとする(Claude は実行しない)。

続いて、プレビュー(右側/下部の詳細表示)の作り込み度合いを確認。複数の質問を提示。

# phyllis998

複数回の回答により、以下が確定：
- diff プレビューは +/- 行のみ色付け
- ファイルタブ・スクロール等は作らない(§3 の切り詰め済み本文をそのまま表示)
- キュー一覧の自動更新は `watchPitcrew` を流用したライブリロード

# AI

画面描画方式について選択肢を提示。
1. インライン全画面再描画(単純だがスクロールバックが汚れる)
2. 差分描画(複雑で YAGNI 方針に反する)
3. 代替スクリーンバッファ + 全画面再描画(`\x1b[?1049h/l`、vim/less/htop 同様)

推奨は方式3(フレームワークなし素朴描画との両立、標準的 TUI 作法)。

# phyllis998

(質問への回答なし — 設計提示まで進む前に確認)

# AI

ブラウザビューアの承認・コメント送信(`viewer-ops.ts`)を確認。`approveItem`・`writeComment`・`nextCommentNumber` は HTTP に依存しない純粋関数で、TUI からも再利用可能。

現在 `src/server/` 配下の `viewer-ops.ts` を `src/lib/viewer-ops.ts` に移動し、`server/` と `tui/` が共通参照する設計を提案。

---

## セッション 3: 設計セクション A〜H の提示

# AI

以下の設計セクションを提示(全 8 セクション)。

### A. アーキテクチャ全体像

`plugins/pitcrew/src/tui/` を新設。`src/server/`(ブラウザビューア)と対になる構成：

```
src/tui/
├── render.ts     # 純粋関数: QueueItem[] + 選択位置 + 端末サイズ → 描画用文字列配列
├── keymap.ts      # 純粋関数: キー入力 + 現在状態 → アクション
├── editor.ts       # $EDITOR を子プロセスとして起動
└── loop.ts         # イベントループ(raw mode・alt screen・fs watch)
scripts/watch.mjs    # バンドル出力
```

**既存資産の再利用**：
- `src/server/state.ts` の `listState`/`readItems`
- `src/server/watch.ts` の `watchPitcrew`
- `src/server/viewer-ops.ts` の `approveItem`・`writeComment`・`nextCommentNumber`(共有ロジック)

**構造変更**: `viewer-ops.ts` を `src/lib/` に移動(層をまたぐ import を統一)

### B. 画面レイアウトと操作

`review/` のみを対象にした 1 画面構成：

```
┌─────────────────────────────────────────┐
│ 未レビュー: 3   未回収コメント: 1          │ ← ステータスバー
├─────────────────────────────────────────┤
│→ 003  diff       implementer#2   2分前    │ ← キュー一覧
│  002  artifact   designer        5分前    │
│  001  test        implementer#1   8分前    │
├─────────────────────────────────────────┤
│ id:002 type:artifact agent:designer      │ ← 詳細プレビュー
│ + 追加行 (緑)                             │   +/- のみ色付け
│ - 削除行 (赤)                             │
│   コンテキスト行 (無色)                    │
├─────────────────────────────────────────┤
│ [j/k]移動 [c]コメント [a]承認 [q]終了     │ ← キーヘルプ
└─────────────────────────────────────────┘
```

操作：
- `j/k`: 選択移動(端で止まる)
- `a`: `approveItem()` で `reviewed/` へ移動 → 一覧から消える
- `c`: エディタ起動フロー(下記 C 節)
- `q`: 後始末して終了
- 端末リサイズで行数再計算・再描画

### C. コメント作成フロー(`c` キー)

1. raw mode 一時解除
2. コメントテンプレート(urgency, paths, reviewId, base 等)をスクラッチ一時ファイルに書き出し
3. `$EDITOR <tmpfile>` を `stdio: "inherit"` で子プロセス起動、終了を待つ
4. raw mode 復帰、alt screen 維持のまま全画面再描画
5. ファイル読み込み、本文が空なら何もせず削除。空でなければ `writeComment()` に渡して確定
6. `$EDITOR`/`$VISUAL` 未設定時はエラー表示のみ(フォールバックなし)

### D. ライブリロード

`watchPitcrew` のコールバックで `.pitcrew/` 変更を検知するたびに `listState`/`readItems` を再取得。選択中アイテムを `id` で追跡(該当 id が消えていればクランプ)して再描画。キー入力とは別イベントソースとして共存。

### E. `/pitcrew:watch` コマンド

Claude は何も実行しない。以下を提示：

```
node "<CLAUDE_PLUGIN_ROOT を解決した絶対パス>/scripts/watch.mjs" --dir "<プロジェクトルート>"
```

「このコマンドはあなたのターミナルで直接実行してください(Claude はこの対話ツールを操作できません)」と明記。

### F. エラーハンドリング

- 起動時: `process.stdout.isTTY` が false なら「対話端末が必要です」で exit(1)
- 終了時・異常終了時: 必ず raw mode 解除・カーソル表示・alt screen 復帰(`\x1b[?1049l`)
- `.pitcrew/` 読み取り失敗: fail-open で空一覧として続行

### G. テスト方針

- `render.ts`・`keymap.ts`: vitest で単体テスト(純粋関数の検証)
- `editor.ts`: spawn 呼び出し引数の検証のみ
- `loop.ts`(raw mode・alt screen・実キー入力): 自動テスト対象外、実機確認で検証

### H. スコープ外(YAGNI)

- TUI 内での `/pitcrew:config` 相当の設定変更(既存の `/pitcrew:config` のみ)
- `reviewed/` の一覧表示・差し戻し操作
- プレビュー領域内でのスクロール
- Windows のネイティブターミナル個別対応(WSL/Git Bash 前提、ANSI alt screen 対応端末を前提)

---

# phyllis998

(返答なし — 設計承認待ちの状態で Stop hook が発火)

---

## セッション 4: 設計書の作成と自己レビュー

# phyllis998

> 問題ありません。設計書を書いてください

# AI

マスター設計書(`docs/superpowers/specs/2026-07-18-pitcrew-stage4.2-design.md`)を参照テンプレートとして読了。設計書を `docs/superpowers/specs/2026-07-19-pitcrew-stage5-tui-design.md` に新規作成し、セクション A〜H を整形して書き込み。

**自己レビューで 2 つの問題を発見・修正**：
1. **README 完了条件の記述漏れ**：設定表の `viewer` 行も(Stage 4.2 で追加されたため)更新対象に含める必要がある
2. **§7 担当ファイル列挙の抜け**：新規モジュール 4 個のうち `keymap.ts` と `loop.ts` の記載が漏れていた

`git commit(266a4cd)` で設計書をコミット。

---

## セッション 5: Haiku レビューと修正

# AI

Haiku(汎用サブエージェント)にレビューを依頼。以下 3 点の指摘を受けた：

1. **コメント本文の未変更判定(§3.3)**：「テンプレートのまま」の厳密な比較方法が未定義。trim 後にプレースホルダ文字列と完全一致するか判定する方式を明記。また、TUI 用スクラッチファイルの雛形が Stage 1 の `commentTemplate()` での手書き案内用テンプレートとは別であること、及び両者がどう異なるかを明記。

2. **ライブリロード時のクランプ規則(§3.4)**：選択中 id が消えた場合の動作が曖昧。配列インデックス基準で新しい一覧に適用する具体的な規則を追記。特に、`a` キー自身が起こした削除(自分の操作による)と他プロセス由来の削除(ライブリロード時の変更)を混同しないよう分けて記述。

3. **極小端末サイズでの描画退行(§3.2)**：行数配分が 0 以下になった領域の扱いが未定義。単に描画しないだけ(クラッシュ・特別なエラー表示はしない)と明記し、最小サイズ検証はスコープ外と明示。

上記 3 点を設計書に反映。`git commit(1fabd89)` で修正版をコミット。

---

## セッション 6: ユーザーへの報告

# AI

設計書は `docs/superpowers/specs/2026-07-19-pitcrew-stage5-tui-design.md` にコミット済み。前提資料として `docs/superpowers/specs/2026-07-16-pitcrew-design.md`(マスター設計書 §5, §12)と `docs/superpowers/specs/2026-07-18-pitcrew-stage4.2-design.md`(書式テンプレート)を参照。

内容をご確認いただき、変更が必要な点があれば教えてください。問題なければ次は `writing-plans` スキルで実装計画書の作成に進む予定。

---

## セッション 7: 設計書検査・実装計画作成・実装実行

# AI

**設計書検査**（chat 記録との突き合わせ + コード実態との突き合わせ）

前回の記録では未決事項なしでしたが、実装コード と突き合わせると実装者が確実に詰まる不整合が 3 件発見：

1. `readItems`/`nextCommentNumber` は非公開関数。設計書が「再利用する」と記述していたが、実際は公開 API(`listState`/`readItemBody`、採番は `writeComment` 内部)を使用 → 設計書を修正
2. `viewer-ops.ts` だけを `src/lib/` へ移すと `isSafeName`(state.ts 定義)への逆依存が発生 → **ユーザーに確認し、state/watch/viewer-ops の 3 ファイルとも lib へ移動する方針に決定**
3. エントリポイント `main.ts` がモジュール構成図から欠落 → 追記

以上 3 件と、その他表記上の細かい不整合を修正。

**Haiku レビュー（設計書修正版）**

修正版設計書をオーケストレーター自身で Haiku にレビュー依頼。指摘のうち有効なもの(行数配分規則の未定義、`a` キーの同期/非同期処理フロー、スクラッチ雛形の形式詳細、TTY 判定対象の明確化、cleanup の二重実行ガード、ビルドタイミングなど)を設計書に反映。

**実装計画書作成**

設計書のセクション A-H をタスク分割し、実装計画書を `docs/superpowers/plans/2026-07-19-pitcrew-stage5.md` に作成。6 つのタスク(lib へのファイル移動、keymap.ts、render.ts、editor.ts、loop.ts/main.ts/バンドル、watch.md/README/バージョン)を定義。各タスクの前提条件、実装期待値、テスト範囲を明記。

**Haiku レビュー（実装計画書）**

計画書自身で Haiku にレビュー依頼。指摘(環境変数展開の明確化、Task 間の依存関係、テストターゲットの精度など)を反映。

**実装実行（エージェント運用方針に従い GPT に委譲）**

計画書の 6 タスクを GPT エージェント(Terra/Luna/Sol)に委譲(Task 2-4 は並列実行)：

| コミット | タスク | 担当 |
|---|---|---|
| `8f0c876` | 設計書・計画書自体の doc コミット | オーケストレーター |
| `e102a32` | Task 1: state/watch/viewer-ops を src/lib/ へ移動、import 更新 | Terra |
| `a1b6d8f` | Task 2: keymap.ts 実装（キー→アクション、テスト 24 件追加） | Luna |
| `d3689b0` | Task 3: render.ts 実装（画面レイアウト描画） | Terra |
| `2b84c13` | Task 4: editor.ts 実装（子プロセス起動） | Terra |
| `52c1d29` | Task 5: loop.ts/main.ts/バンドル（イベントループ・raw mode・alt screen） | Sol |
| `dbc41ed` | Task 6: watch.md/README/v0.10.0（ドキュメント・バージョン更新） | Terra |

全タスク完了。

**Sonnet レビュー（Stage 5 差分全体）**

Sonnet による最終レビュー実施。修正必須・推奨ともゼロ(軽微所見 2 件は実害なし)。

**テスト・ビルド・非 TTY 起動確認**

- 757/757 テスト PASS(ベースライン 733+新規 24)
- lint・typecheck クリーン
- バンドル差分なし
- 非 TTY 起動の `exit=1` を実機で確認済み

**実機確認待機**

ブランチ `feature/pitcrew-stage5` 上にコード完成。設計書 §5.5 の実機確認(alt screen 切り替え、キー操作、コメント作成フロー、ライブリロード、リサイズなど)を待機。

---

## セッション 8: マージ実行

# phyllis998

> マージしてください

# AI

`main` へマージ実行。ブランチ `feature/pitcrew-stage5` を `--no-ff` でマージ、テスト・lint・typecheck 全てクリーン確認後、ブランチ削除・`origin/main` へ push 完了。

**結果**：
- マージコミット: `d4ee5d7`(23 ファイル +2512 行)
- マージ後の main で 757/757 テスト PASS、lint・typecheck クリーン
- pitcrew v0.10.0 として Stage 1〜5 全て main に統合完了

---

注意事項: Stage 5 実装の詳細は `docs/superpowers/specs/2026-07-19-pitcrew-stage5-tui-design.md` および `docs/superpowers/plans/2026-07-19-pitcrew-stage5.md` に記載。コミットハッシュ、テスト数、バージョンは上記の通り。未コミット変更は `.gitignore`・`README.md`・`docs/chat/INDEX.md`・他 chat 記録・`.vscode/settings.json`(記録スキル管理下)。
