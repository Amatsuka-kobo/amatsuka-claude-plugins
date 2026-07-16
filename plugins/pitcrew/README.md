# pitcrew

オーケストレーション実行中の「待ち時間」を人間の並走レビュー時間に変えるプラグイン。

サブエージェントが完了するたびの diff、設計書等の成果物ファイル(`docs/**/*.md`、
`docs/chat/` は除外)、テスト・ビルド結果を `.pitcrew/review/` に逐次書き出します。人間はエディタでそれを
開いてその場でレビューできます(Stage 1 時点。コメントのセッションへの注入・
専用ビューア・設定コマンドは後続ステージで追加予定)。

テスト・ビルドの成功したコマンドは `PostToolUse`、失敗したコマンドは
`PostToolUseFailure` で捕捉します。

設計書: `docs/superpowers/specs/2026-07-16-pitcrew-design.md`

## 使い方(Stage 1: エディタ直接方式)

1. プラグインを有効にしてオーケストレーションを実行する
2. サブエージェントの完了やテスト実行のたびに `.pitcrew/review/NNN-*.md` が増える
3. エディタで開いてレビューする
   - frontmatter に種別(diff / artifact / test)・発生元エージェント・対象パス・base/head が入っている
   - レビューし終えた項目は `.pitcrew/reviewed/` に手で移動する(任意)
4. コメントは各項目末尾のテンプレートに従い `.pitcrew/comments/c-<連番>.md` に保存する
   (Stage 1 ではまだセッションに注入されない。Stage 2 で注入層が入る)

## `.pitcrew/` の構造

```
.pitcrew/
├── run.json     # 実行状態(diff の base・レビュー ID 採番)
├── review/      # レビューキュー(捕捉層が書く)
├── reviewed/    # レビュー済み(人間が移動)
├── comments/    # コメント(人間が書く。注入は Stage 2)
└── log/         # 捕捉スクリプトのエラーログ
```

- `.pitcrew/` は `.gitignore` への追加を推奨
- リセットしたいときは `.pitcrew/` を丸ごと削除(全状態がこの配下に閉じている)

## 開発

- ソース: `src/`(TypeScript)。`pnpm build` で `scripts/*.mjs` にバンドル(git 管理)
- テスト: リポジトリルートで `pnpm test`(vitest)
- 依存: Node 標準ライブラリと git CLI のみ
