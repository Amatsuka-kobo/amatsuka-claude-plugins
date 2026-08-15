# pitcrew

オーケストレーション実行中の「待ち時間」を人間の並走レビュー時間に変えるプラグイン。

サブエージェントが完了するたびの diff、設計書等の成果物ファイル(`docs/**/*.md`、
`docs/chat/` は除外)、テスト・ビルド結果を `.pitcrew/review/` に逐次書き出します。人間はエディタでそれを
開いてその場でレビューできます(ブラウザビューアと TUI ビューアを利用できます)。

テスト・ビルドの成功したコマンドは `PostToolUse`、失敗したコマンドは
`PostToolUseFailure` で捕捉します。

設計書: `harness-docs/superpowers/specs/2026-07-16-pitcrew-design.md`

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## 使い方(Stage 1: エディタ直接方式)

1. プラグインを有効にしてオーケストレーションを実行する
2. サブエージェントの完了やテスト実行のたびに `.pitcrew/review/NNN-*.md` が増える
3. エディタで開いてレビューする
   - frontmatter に種別(diff / artifact / test)・発生元エージェント・対象パス・base/head が入っている
   - レビューし終えた項目は `.pitcrew/reviewed/` に手で移動する(任意)
4. コメントは各項目末尾のテンプレートに従い `.pitcrew/comments/c-<連番>.md` に保存する
   (Stage 1 ではまだセッションに注入されない。Stage 2 で注入層が入る)

## コメントの注入(Stage 2)

`.pitcrew/comments/c-<連番>.md` に置いたコメントは、次のタイミングでセッションに注入される:

| urgency | タイミング | 届き先 |
| --- | --- | --- |
| `urgent` | 対象パスに一致する Write/Edit の直前(PreToolUse) | そのファイルを触るエージェント(早い者勝ちで 1 エージェント) |
| `normal` | メインのターン境界(Stop) | メインセッション(まとめて差し戻し) |

- パスに一致しないまま残った `urgent` も、ターン境界で `normal` と一緒に回収される
- 注入済みコメントは `.pitcrew/comments/processed/` へ移動する(再注入されない)。
  取り消したいコメントは注入前に `comments/` から削除すればよい
- 注入は at-most-once: 注入直前にセッションが落ちた場合など、まれに未注入のまま
  `processed/` に移ることがある。届いていない様子なら `processed/` から `comments/` に
  戻せば再注入される

## 並行動作について(Stage 2)

- 複数サブエージェントの同時終了に備え、`run.json` の更新は `.pitcrew/run.lock` で
  直列化される(取得できない場合はロックなしで続行し、まれに重複 diff が出ることを許容)
- `run.lock` が残留してもロック待ちで止まることはない(10 秒より古いロックは自動回収される)

## ブラウザビューア(Stage 4: /pitcrew:serve)

`/pitcrew:serve` でローカル HTTP サーバーが起動し、トークン付き URL が表示される。
ブラウザで開くと 2 ペインのレビュー画面(左: キュー、右: 詳細+コメント欄)が使える。

- レビューキューは `.pitcrew/` の変更を SSE で自動反映(リロード不要)。一覧は新しい順(ID 降順)で表示
- 「レビュー待ち」の各項目はチェックボックスで選択でき、「全選択」トグルと「選択を既読 (N)」ボタンで確認後に一括既読
- diff は行単位で色分け表示。「承認して既読」で `reviewed/` へ移動
- コメントは 📮 通常 / 🚨 緊急 を選んで送信すると `.pitcrew/comments/` に保存され、
  Stage 2 の注入層がセッションへ届ける(選択中項目の paths / reviewId / base が自動で付く)。
  `Ctrl+Enter` / `Cmd+Enter` でも送信できる
- ⚙ 設定パネルからすべての設定をブラウザで変更できる。`port` / `theme` の変更はビューアの再起動で反映される
- テーマはライト / ダーク / デバイス追従。優先順位は
  「画面での手動切替(localStorage)> config の `theme` > デバイス設定」
- サーバーは `127.0.0.1` のみで待ち受け、URL のトークンが無いと 401 を返す。
  起動情報は `.pitcrew/serve.json`(停止時に削除)
- 停止は `/pitcrew:serve stop`。再起動は `/pitcrew:serve restart`

## TUI ビューア(pitcrew watch)

ブラウザの代わりにターミナル上でレビューするビューアです。
**ユーザー自身のターミナルで直接実行します**(Claude には起動させない):

```bash
node "<プラグインの絶対パス>/scripts/watch.mjs" --dir "<プロジェクトルート>"
```

`/pitcrew:watch` で、自分の環境に合わせた起動コマンドを Claude に案内させられます。

| キー | 動作 |
|---|---|
| `j` / `k` | 選択の移動(下 / 上) |
| `c` | 選択項目へのコメント作成(`$EDITOR` / `$VISUAL` で編集) |
| `a` | 承認して既読(`reviewed/` へ移動) |
| `q` | 終了 |

- 一覧は `.pitcrew/review/`(未レビュー)のみを新しい順に表示します
- `.pitcrew/` の変更は自動で反映されます(ライブリロード)
- コメントの緊急度を上げたい場合は、エディタで開いたテンプレートの
  `urgency: normal` を `urgency: urgent` に書き換えてください

## 設定(Stage 3: /pitcrew:config)

`/pitcrew:config` の対話で `.claude/pitcrew.local.md` に保存する(手で編集してもよい。
次の hook 起動から反映される)。設定ファイルが無い・壊れている場合は既定値で動く。

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `viewer` | `files` | ビューア。`browser` / `tui` はいずれも実装済み(`viewer` の値は捕捉・注入の既定挙動の選択であり、どのビューアも常に起動できる) |
| `capture_targets` | `[diff, artifact, test]` | 捕捉対象。外した種別は捕捉しない |
| `artifact_globs` | `["docs/**/*.md"]` | 成果物 glob(設定時は既定を置き換え。空配列は既定のまま。`docs/chat/` は常に除外。成果物の捕捉自体を止めたい場合は `capture_targets` から `artifact` を外す) |
| `test_commands` | `[]` | テスト・ビルド判定の追加コマンド接頭辞(既定リストに追加) |
| `injection_timing` | `hybrid` | `hybrid` / `turn-boundary`(全コメントをターン境界で注入)/ `immediate`(全コメントを即時照合。取り残しはターン境界で回収) |
| `theme` | `device` | ブラウザビューアの初期テーマ(後続ステージで使用) |
| `port` | `7373` | ブラウザビューアの待受ポート(後続ステージで使用) |

frontmatter はフラットな key-value とインライン配列のみ(ネスト不可)。
glob など `*` を含む値と `port` は `"` で囲む。

## `.pitcrew/` の構造

```
.pitcrew/
├── run.json     # 実行状態(diff の base・レビュー ID 採番)
├── serve.json   # ブラウザビューア起動情報(serve 起動中のみ)
├── review/      # レビューキュー(捕捉層が書く)
├── reviewed/    # レビュー済み(人間が移動)
├── comments/    # コメント(人間が書く)
└── log/         # 捕捉スクリプトのエラーログ
```

- `.pitcrew/` は `.gitignore` への追加を推奨
- リセットしたいときは `.pitcrew/` を丸ごと削除(全状態がこの配下に閉じている)

## 開発

- ソース: `src/`(TypeScript)。`pnpm build` で `scripts/*.mjs` にバンドル(git 管理)
- テスト: リポジトリルートで `pnpm test`(vitest)
- 依存: Node 標準ライブラリと git CLI のみ
