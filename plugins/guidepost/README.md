# guidepost

コミット範囲や PR の diff を、依存順に並べた AI 同行のコードリーディングツアーに変換し、読中の疑問をその場でセッションへ届けるプラグインです。

```text
/guidepost <範囲> ──→ ツアー生成 ──→ ブラウザで巡回
                        (tour.json)      │
        回答を追記 ◀── 質問を注入 ◀── 質問ボックス
      (answers/)     (Stop hook)    (queue/questions/)
```

`/guidepost` は対象の diff を、型・データモデル、コアロジック、呼び出し側、テストのような理解しやすい依存順で案内します。ブラウザで各ストップの diff と解説を読み、疑問を書き込むと、Claude Code セッションからの回答をツアー上で受け取れます。

## 使い方

### 導入

1. Marketplace を追加します。

   ```text
   /plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
   ```

2. guidepost をインストールします。

   ```text
   /plugin install guidepost@amatsuka-claude-plugins
   ```

3. Claude Code のセッションを再起動します。質問をセッションへ届ける hook を有効にするために必要です。

### ツアーを作成して巡回する

1. 対象プロジェクトで `/guidepost` を実行します。
   - 引数なしでは直近のコミット (`HEAD~1..HEAD`) を対象にします。
   - コミット範囲は `/guidepost HEAD~3..HEAD` のように指定できます。
   - PR は `/guidepost #42` のように指定できます。
2. Claude が表示するローカル URL をブラウザで開きます。
3. 左ペインのストップを選び、右ペインの diff と「何をしているか」「なぜこの設計か」「壊すと何が起きるか」を読みます。
4. 疑問があれば質問ボックスから送信します。回答が届くと該当ストップに表示されます。

ビューアの既定ポートは `4870` です。使用中の場合は `4871` から最大 10 回、自動で空いているポートを探します。

## ビューア操作

- **次へ / 前へ**: ボタン、`j` / `k`、または矢印キーでストップを移動します。
- **既読**: 表示したストップは既読になります。既読状態はブラウザの localStorage に保存され、再読み込み後も維持されます。
- **質問**: 質問ボックスに入力して送信します。`Ctrl+Enter` または `Cmd+Enter` でも送信できます。
- **回答の反映**: 2 秒ごとに回答を確認し、到着した回答を現在の表示状態を保ったまま追加します。

## `.guidepost/` の構造

ツアーと質問・回答は、対象プロジェクトの `.guidepost/` に保存されます。

```text
.guidepost/
├── tours/<tour-id>/
│   ├── tour.json                 # ツアー本体
│   └── answers/<stop-id>-<ts>.md # 質問への回答
└── queue/
    └── questions/
        ├── <ts>.md               # 未処理の質問
        └── processed/            # 注入済みの質問
```

通常はプロジェクトの `.gitignore` に次を追加することを推奨します。

```gitignore
.guidepost/
```

## 質問から回答まで

質問はまず `queue/questions/` にファイルとして保存されます。`PreToolUse` hook はターン中に質問を見つけるとセッションの追加コンテキストへ注入し、`Stop` hook は未処理の質問があればセッションを差し戻して届けます。

質問ファイルは注入時に `processed/` へアトミックに移動するため、同じ質問が複数回注入されない at-most-once の動作です。セッションが閉じている間の質問はキューに残り、次のセッションで遅延配送されます。

## 制限事項

- ツアーのストップは最大 20 件です。超過分は最後の概要ストップにまとめます。
- diff が 10,000 行を超える場合は生成を中断し、範囲を分けるよう案内します。
- rebase 後でも `diffText` をツアー自身に保存しているため表示は壊れません。ただし、現在のブランチとの SHA 一致警告は初版では未実装です。
- ツアーの共有機能、理解度の記録、履歴の蓄積は初版の対象外です。

## ビューアの手動テスト

以下は、サンプルの `tour.json` を `.guidepost/tours/<tour-id>/tour.json` に置いたプロジェクトディレクトリを `<project-dir>` として確認する手順です。

1. サーバーを起動します。

   ```bash
   node "<plugin-root>/scripts/serve.mjs" --dir "<project-dir>"
   ```

   表示された URL を開き、ツアーが一覧に現れ、選択時にストップ 1 が表示されることを確認します。

2. **次へ** と **前へ**（または `j` / `k`）でストップを移動します。ページを再読み込みして、既読チェックが維持されることを確認します。

3. TypeScript、JSON、Markdown の diff を含むストップを開き、追加行・削除行・hunk・文脈行が色分け表示されることを確認します。

4. 質問ボックスから質問を送信し、次のコマンドで質問ファイルが生成されたことを確認します。

   ```bash
   find "<project-dir>/.guidepost/queue/questions" -maxdepth 1 -name '*.md'
   ```

5. 表示中のストップに対応する回答ファイルを手で置きます。

   ```bash
   printf '回答のテスト' > "<project-dir>/.guidepost/tours/<tour-id>/answers/stop-01-20260727T120000000.md"
   ```

   2 秒以内に該当ストップへ回答が表示されることを確認します。

6. ブラウザの開発者ツールの Network タブを開き、ページ操作・質問送信・polling の間に外部ドメインへのリクエストが 1 件もないことを確認します。

## 開発

ソースは `src/` にあります。ソースを変更したらリポジトリルートで次を実行し、git 管理する `scripts/` のバンドル成果物を更新してください。

```bash
pnpm build
```

テスト、型検査、lint はそれぞれ `pnpm test`、`pnpm typecheck`、`pnpm lint` で実行できます。
