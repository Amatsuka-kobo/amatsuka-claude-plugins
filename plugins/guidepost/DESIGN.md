# guidepost 設計書

- プラグイン: `guidepost`
- manifest version: `0.1.0-dev`
- 実装同期先: `plugins/guidepost/`
- ステータス: 設計レビュー中(未実装)

## 1. コンセプト

guidepost は、コミット範囲または PR の diff を「AI が同行解説するコードリーディングツアー」に変換するプラグインである。AI が書いたコードが動いているが中身を説明できない——「理解の置去り」を、作業後の復習体験として解消する。

```text
/guidepost <範囲> ──→ ツアー生成 ──→ ブラウザで巡回
                        (tour.json)      │
        回答を追記 ◀── 質問を注入 ◀── 質問ボックス
      (answers/)     (Stop hook)    (queue/questions/)
```

1. **生成**: `/guidepost` スキルが対象 diff を分析し、読む順序を依存関係ベースで並べ替えたツアーストップ列を `tour.json` として生成する。LLM 処理はメインセッションに閉じる。
2. **巡回**: ローカルサーバがブラウザ UI を配信し、ユーザーはシンタックスハイライト付き diff と解説を 1 ストップずつ読む。サーバは静的配信と質問受付のみを行う純粋なプロセスである。
3. **質問→回答ループ**: ビューアの質問ボックスへの入力はファイルキューに書き込まれ、hook がセッションへ注入する。Claude の回答は `answers/` に書かれ、ビューアが polling で拾って該当ストップに追記表示する。

Anthropic API・API キー・外部 API クライアントは使用しない。LLM 処理(diff 分析・解説生成・質問への回答)はすべて Claude Code セッション内で行う。

既存の diff ビューア・PR サマリツールとの本質的差分は 2 点: (a) diff のファイル名順ではなく「データモデル→コアロジック→呼び出し側→テスト」のような理解の依存順にストップを並べること、(b) 読中の疑問がその場でセッションに届き、回答がツアーへ追記される双方向性。

## 2. 実装構成

### 2.1 配置とビルド

```text
plugins/guidepost/
├── .claude-plugin/plugin.json
├── README.md
├── DESIGN.md
├── package.json
├── build.ts
├── hooks/hooks.json
├── skills/
│   └── guidepost/SKILL.md        # ツアー生成の入口
├── src/
│   ├── serve.ts                  # ローカルサーバ(静的配信+質問POST受付)
│   ├── hooks/
│   │   ├── inject-stop.ts        # Stop 時に未処理質問を注入
│   │   └── inject-pre-tool-use.ts# ターン中の注入(pitcrew と同型)
│   ├── lib/
│   │   ├── tour-store.ts         # tour.json / answers/ の読み書き・スキーマ検証
│   │   ├── queue.ts              # questions キューの読み書き
│   │   ├── atomic.ts             # アトミック書き込み(pitcrew と同型)
│   │   ├── hook-io.ts            # hook 入出力(pitcrew と同型)
│   │   └── types.ts
│   └── __test__/
├── scripts/                      # バンドル出力(git 管理)
│   ├── serve.mjs
│   ├── inject-stop.mjs
│   ├── inject-pre-tool-use.mjs
│   └── ui.html
└── dist/ は使わない
```

- ソースは TypeScript(`src/`)、バンドル出力は `scripts/`(利用者はビルド不要)。`pnpm build` で同期。
- ビューア UI は `ui.html` 1 枚(依存 CDN なしの自己完結。シンタックスハイライトは軽量な自前実装または同梱ライブラリ)。

### 2.2 データレイアウト(対象プロジェクト側)

```text
.guidepost/
├── tours/<tour-id>/
│   ├── tour.json                 # ツアー本体
│   └── answers/<stop-id>-<ts>.md # 質問への回答(追記型)
└── queue/
    └── questions/<ts>.md         # 未処理質問(処理後は processed/ へ移動)
```

`<tour-id>` は `YYYYMMDD-HHmmss-<短縮SHA(7文字)>`。`.guidepost/` ディレクトリはスキルがツアー生成時に作成する。`.gitignore` 推奨(README に記載)。

- 質問キューは全ツアー共有の 1 箇所とし、各質問ファイルの frontmatter(YAML)に `tourId` / `stopId` を持たせてスコープする。
- 質問・回答の書き込みはすべて「一時ファイルに書いて rename」のアトミック書き込み(`lib/atomic.ts`)で行い、hook・serve・セッションの並行アクセスによる読みかけ・書きかけを防ぐ。`processed/` への移動主体は hook(注入に成功したターンで移動)。

## 3. ツアー生成(`/guidepost` スキル)

- 引数: コミット範囲(例 `HEAD~3..HEAD`)、PR 番号(例 `#42`)、省略時は `HEAD~1..HEAD`。PR 指定時は `gh pr view --json baseRefOid,headRefOid` で base/head SHA を動的に取得する(base ブランチを暗黙に `main` と仮定しない)。
- 手順:
  1. 対象 diff とベース SHA を取得する。
  2. diff を分析し、ストップを重要度と依存順で並べる。並べ替え基準: 型・データモデル定義 → コアロジック → 呼び出し側・配線 → テスト → 設定/雑務。
  3. 各ストップに解説 3 要素(何をしているか / なぜこの設計か / 壊すと何が起きるか)を書く。
  4. `tour.json` を書き出し、`serve` の起動方法と URL をユーザーに提示する。
- ストップ数上限は 20。超過分は末尾の「概要ストップ」1 つに畳む。概要ストップは `diffText` を持たず、畳んだファイルのパス一覧と各 1 行の変更概要のみを解説欄に列挙する。
- ストップ `id` は並び順の連番 `stop-01`〜`stop-20` とする(並べ替え確定後に採番。ユニークキーはツアー内で閉じる)。

### tour.json スキーマ(v1)

```jsonc
{
  "version": 1,
  "tourId": "20260726-153000-abc1234",
  "title": "認証フローのリファクタリング",
  "baseSha": "abc1234...",
  "headSha": "def5678...",
  "source": { "type": "range" | "pr", "value": "HEAD~3..HEAD" },
  "stops": [
    {
      "id": "stop-01",
      "file": "src/auth/session.ts",
      "hunk": { "oldStart": 10, "oldLines": 5, "newStart": 10, "newLines": 22 },
      "diffText": "@@ ... @@\n-...\n+...",   // 該当 hunk 単体の unified diff を自己完結で保持(ファイル全体ではない)
      "title": "セッション型の再定義",
      "what": "...",
      "why": "...",
      "ifBroken": "..."
    }
  ]
}
```

`diffText` を tour.json に自己完結で保持するため、ビューアは git に依存しない(rebase 後も表示は壊れない)。

## 4. ビューア(serve + ui.html)

- `node <plugin-root>/scripts/serve.mjs [--port N] [--open]` で起動(スキルが `${CLAUDE_PLUGIN_ROOT}` を解決した起動コマンドを提示する)。カレントディレクトリの `.guidepost/` を読む。デフォルトポートは 4870(pitcrew と衝突しない値)。ポート使用中なら +1 ずつ最大 10 回まで自動リトライし、確定したポートを標準出力に表示する。
- ルーティング: `GET /` → ui.html、`GET /api/tours` → ツアー一覧、`GET /api/tours/<id>` → tour.json + answers、`POST /api/questions` → キューへ書き込み。
- UI: 左ペインにストップ一覧(既読チェック付き)、右ペインに diffText のハイライト表示と解説 3 要素、下部に質問ボックス。「次へ/前へ」で巡回。
- シンタックスハイライトは外部 CDN に依存せず、diff の +/- 行色分け+主要言語の軽量トークナイザを ui.html に同梱する(highlight.js 等を使う場合もバンドルに同梱し、オフラインで動作すること)。
- polling(2 秒間隔)で answers/ の変化を検知し、回答を該当ストップへ自動反映する。
- localhost バインドのみ。外部公開しない。

## 5. 質問→回答ループ(hooks)

- `POST /api/questions` は `{tourId, stopId, question}` を `queue/questions/<ts>.md` として書き込む。形式は YAML frontmatter(`tourId` / `stopId` / `createdAt`)+ 本文が質問文。
- 回答は 1 質問 = 1 ファイル(`answers/<stop-id>-<ts>.md`、`<ts>` は質問ファイルのタイムスタンプを引き継ぐ)。同一ストップへの複数質問はファイルが並ぶだけで、ビューアは作成順に並べて表示する。追記(append)はしない。
- **Stop hook**: セッションの停止時に未処理質問があれば差し戻し、「該当ストップの文脈(tour.json の該当エントリ)を読み、回答を `answers/<stop-id>-<ts>.md` へ書け」と指示する。処理済み質問は `processed/` へ移動する。
- **PreToolUse hook**: ターン進行中にも軽量チェックで未処理質問を `additionalContext` として注入する(pitcrew の inject-pre-tool-use と同型)。
- セッションが閉じていた場合、質問はキューに残り、次回セッションの hook が拾う(遅延配送)。
- hook の判定はすべて決定的(ファイル存在チェックのみ)。hook 内で LLM・外部プロセスを呼ばない。

## 6. エラー処理

- 巨大 diff: ストップ上限 20 で畳む(§3)。diff 取得自体が巨大(10k 行超)な場合はスキルが警告し、範囲の分割を提案して中断する。
- `gh` 未インストール・PR 取得失敗: コミット範囲モードの使い方を案内して中断する。部分的成功を装わない。
- tour.json スキーマ不一致(手編集・版差): ビューアはエラーバナーを表示し、壊れたツアーをスキップする。
- ベース SHA 不一致(rebase 等): diffText 自己完結のため表示は維持し、ヘッダに「現在のブランチと一致しない」警告のみ出す。

## 7. テスト

- `src/__test__/` にユニットテスト: tour-store のスキーマ検証、queue の入出力と processed 移動、hook の注入判定(未処理質問あり/なし/壊れたファイル)、serve のルーティング。
- serve のテストは、リクエスト処理関数を HTTP リスナーから分離して純関数として実装し、`(method, path, body)` を渡してレスポンスを検証する形とする(実ポートを開かずにルーティング・エラー応答・書き込み副作用を検証できる)。ブラウザ上の polling・表示は手動確認の範囲。
- ビューア UI(ui.html)は手動確認。テスト手順を README に記載する。

## 8. pitcrew からの流用方針

pitcrew(v0.10.0)の実装を**設計パターンとして参照**するが、コード共有・パッケージ依存はしない(各プラグインは自己完結が原則)。流用するのは以下のパターン:

- `lib/atomic.ts` のアトミック書き込み(tmp + rename)
- `lib/hook-io.ts` の hook stdin/stdout 入出力の型と読み書き
- Stop / PreToolUse hook による注入の 2 段構え(Stop で差し戻し、PreToolUse で `additionalContext` 注入)
- serve.mjs + ui.html 単体構成(依存なしの Node http サーバ + 自己完結 HTML)

必要箇所は guidepost の `src/` にコピーして持ち、pitcrew 側の変更に追従しない。

## 9. 初版で見送るもの(YAGNI)

- 理解度の記録・カバレッジ蓄積(案C 相当)— ツアー履歴が欲しくなってから拡張する。
- セッション会話文脈を使ったツアー生成(セッション単位モード)— コミット/PR 単位で価値検証してから。
- 複数ツアーの同時巡回・共有機能。
