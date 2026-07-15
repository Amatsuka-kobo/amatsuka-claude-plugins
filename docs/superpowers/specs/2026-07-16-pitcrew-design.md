# Pitcrew プラグイン設計書

- 日付: 2026-07-16
- ステータス: ドラフト(ユーザーレビュー待ち)
- 対象リポジトリ: amatsuka-claude-plugins(`plugins/pitcrew/` として追加)

## 1. コンセプト

**Pitcrew は、オーケストレーション実行中の「待ち時間」を人間の並走レビュー時間に変えるプラグイン。**

マルチエージェントのオーケストレーション(codiel の run、GPT エージェント群への委譲など)では、
人間は数分〜数十分の実行完了をただ待つことが多い。完了後にまとめて成果物を確認すると、
問題の発見が遅れ、手戻りが実行時間まるごと分になる。

Pitcrew は実行中に完成した成果物(diff・設計書・テスト結果)を逐次「レビューキュー」へ流し、
人間がその場でレビューしたコメントを **実行中のセッションに逆流(注入)** させる。
人間をパイプラインの外の「待ち役」から、パイプラインの中の「並走レビュアー」に変える。

### 設計原則

1. **仕組み自体は LLM トークンを消費しない** — 捕捉・表示・注入はすべて機械的処理
   (hooks + スクリプト + ローカルサーバー)。LLM が関与するのは注入されたコメントを
   読んで対応するときだけで、それは本来のレビュー反映作業そのもの。
2. **Anthropic API 不使用** — リポジトリ共通制約。全機構は Claude Code の hooks と
   ローカルプロセスに閉じる。
3. **ファイルが正(file-first)** — すべての状態は `.pitcrew/` 配下のファイル。
   ビューアはその上に載る任意のオプションで、ビューアなし(エディタで直接ファイルを
   開く)でも全機能が成立する。

## 2. 全体アーキテクチャ

```
┌────────────────────────────┐
│ Claude Code セッション        │
│ (メイン + サブエージェント)      │
│                            │
│  捕捉層: SubagentStop /      │──── 成果物を書き出し ───┐
│         PostToolUse hooks   │                      ▼
│                            │              ┌──────────────┐
│  注入層: PreToolUse /        │◀── コメント ───│  .pitcrew/    │ ←── ファイルが正の共有バス
│         Stop hooks          │              └──────────────┘
└────────────────────────────┘                      ▲
                                        watch / 書き込み
                                                    │
                              ┌─────────────────────┴───────┐
                              │ ビューア層(任意・選択式)          │
                              │  A: ブラウザ (HTTP + SSE)      │
                              │  B: ターミナル TUI             │
                              │  C: エディタで直接ファイル編集     │
                              └─────────────────────────────┘
```

- **捕捉層**(hooks): サブエージェント完了やツール実行を検知し、成果物を `.pitcrew/review/` に落とす
- **ビューア層**(任意): `.pitcrew/` を watch して表示し、コメントを `.pitcrew/comments/` に書く。
  C(ファイル直接)が土台であり、A/B はその上の選択式ビューア
- **注入層**(hooks): `.pitcrew/comments/` の未回収コメントをセッションに注入する

ビューアとセッションは直接通信しない。すべて `.pitcrew/` のファイルを介する。
これによりビューアのクラッシュ・不在がセッションに影響せず、どのビューアでも動作が同一になる。

## 3. `.pitcrew/` ディレクトリ構造

```
.pitcrew/
├── run.json                 # 現在の実行状態(下記スキーマ)
├── serve.json               # ブラウザビューア起動情報(port・アクセストークン)。serve 起動時に生成
├── review/                  # レビューキュー(捕捉層が書き、人間が読む)
│   ├── 001-design-doc.md
│   ├── 002-diff-auth.md
│   └── 003-test-result.md
├── reviewed/                # レビュー済み(人間の「承認」操作で移動)
├── comments/                # 未回収コメント(人間が書き、注入層が読む)
│   └── c-001.md
├── comments/processed/      # 注入済みコメント(注入層が移動)
└── log/                     # 捕捉・注入スクリプトのエラーログ
```

- `run.json` スキーマ: `{ startedAt, lastCaptureCommit, lastCaptureAt, nextReviewId, phase? }`。
  `lastCaptureCommit` は diff の base 管理用(§4)。`phase` は将来の codiel 連携用の任意フィールド
- `review/` の項目は番号付き Markdown。YAML frontmatter にメタデータ
  (種別 `diff|artifact|test`、発生元エージェント、タイムスタンプ、base/head commit、対象パス)を持つ
- `comments/` のコメントも Markdown + frontmatter。`urgency: urgent|normal`、
  `paths`(リポジトリ相対パスの配列。ワイルドカード不可)、`reviewId`(任意)、`base`(commit)
- **ディレクトリの生成**: 捕捉層・注入層の hooks が必要時に `mkdir -p` 相当で自動作成する。
  フェイルオープン(§9)は「書き込みに失敗したとき」の話であり、初回は自動で使い始められる
- **リセット**: `.pitcrew/` を丸ごと削除すれば初期状態に戻る(全状態がこの配下に閉じているため)。
  `/pitcrew:config` にもリセットの選択肢を置く
- `review/` の項目が巨大な場合(diff が数千行等)は先頭 N 行+全文へのパス参照に切り詰める
- `.pitcrew/` は `.gitignore` 推奨(config コマンドが追記を提案)

## 4. 捕捉層

### 捕捉対象(確定)

| 種別 | 捕捉タイミング | 生成方法 |
| --- | --- | --- |
| コード diff | SubagentStop(サブエージェント完了時) | 直前の捕捉時点からの `git diff` を機械的に生成 |
| 設計書・計画書等の成果物ファイル | SubagentStop + PostToolUse(Write/Edit) | docs/ 等への Markdown 新規作成・更新を検知しコピー+変更概要 |
| テスト・ビルド結果 | PostToolUse(Bash) | test/build 系コマンドの実行を検知し、終了コードと出力サマリを抽出 |

- どの種別を有効にするかは config で選択可能(既定: 3 種すべて有効)
- 全処理は Node スクリプト(TypeScript ソース → バンドル)で、LLM を使わない
- **diff の base 管理**: 捕捉のたびに作業ツリー状態のスナップショット
  (`git stash create` 相当で得る一時 commit、または HEAD)を `run.json.lastCaptureCommit` に記録し、
  次の捕捉はそこからの差分を取る。サブエージェント A → B と連続捕捉した場合、
  B の diff の base は「A 捕捉直後の状態」であり、各 diff は重複しない
- **テスト・ビルド結果の判定**: PostToolUse(Bash) の command 文字列を既知パターン
  (`pnpm test`、`npm run build` 等の既定リスト+config で追加したコマンド)と前方一致で照合する
  ホワイトリスト方式。全 Bash 出力を無差別に取り込まない
- **成果物ファイルの対象範囲**: 既定は `docs/**/*.md`。config で glob を追加・変更できる。
  捕捉時はファイル全文を review 項目にコピーし、更新の場合は変更前後の diff も併記する

### レビュー項目のフォーマット

```markdown
---
id: 002
type: diff
agent: implementer#2
created: 2026-07-16T14:23:05+09:00
base: a3f2c01
head: 7be90d4
paths: [src/auth.ts, src/auth.test.ts]
---
# auth.ts ほか 2 ファイルの diff

(diff 本文または成果物の内容/サマリ)
```

## 5. ビューア層

### 共通仕様

- 読み: `.pitcrew/` 全体を watch(fs.watch / ポーリングのフォールバック)
- 書き: `comments/` への新規コメントと、`review/` → `reviewed/` への移動のみ
  (例外としてブラウザビューアは自身の起動情報 `serve.json` を書く)
- セッションと直接通信しない

### C: ファイル直接方式(土台・常時利用可能)

エディタで `.pitcrew/review/*.md` を開いて読み、コメントは `comments/` に Markdown を
手書きする(テンプレートを review 項目の末尾に付記しておく)。依存ゼロ。
A/B が動いていなくても常にこの経路が生きている。

### A: ブラウザビューア

- ローカル HTTP サーバー(`pitcrew serve`)。`.pitcrew/` を watch し SSE でプッシュ更新
- 画面構成(モック承認済み):
  - **上部ステータスバー**: 実行状態・フェーズ進行・未レビュー数・未回収コメント数・最終更新
  - **左ペイン: レビューキュー**: 種別バッジ(diff/設計書/テスト)+発生元+経過時間。
    レビュー済みはグレーアウト
  - **右ペイン: 詳細**: diff はファイルタブ+行単位色分け、行コメントの入口。
    「承認して既読」ボタンで `reviewed/` へ移動
  - **コメント欄**: 送信時に「📮 通常 / 🚨 緊急」を選択 → `comments/` に frontmatter 付きで保存
- **テーマ: ライトモード・ダークモード切替 UI を持つ**。優先順位は
  「ブラウザの localStorage(手動切替の記憶)> config のテーマ初期値 > デバイス設定
  (`prefers-color-scheme`)」。config 値は「初回アクセス時の初期値」であり、
  ユーザーがビューア上で切り替えた後は localStorage が優先される
- 待受ポートは config で設定可能。ページはトークン付き URL でアクセスする。
  トークンはサーバー起動ごとにランダム生成して `.pitcrew/serve.json` に書き、
  起動時にターミナルへ URL として表示する(localhost バインドのみ・リモート公開はスコープ外)

### B: ターミナル TUI

- `pitcrew watch` で起動。キュー一覧+選択項目のプレビュー+キー操作
  (`j/k` 移動、`c` コメント、`a` 承認、`q` 終了)
- `c` は `$EDITOR` でコメントテンプレート(frontmatter に urgency: normal 入り)を開き、
  保存で `comments/` に配置する。緊急にしたい場合はテンプレート内の urgency を書き換える
  (TUI 内に独自のテキスト入力は作らない)
- 実装は軽量に保つ(フルスクリーン TUI フレームワークは使わず、素朴な描画から始める)

## 6. 注入層

### コメントの緊急度と配送先(確定)

| 緊急度 | 注入タイミング | 配送先 |
| --- | --- | --- |
| 🚨 緊急 (`urgent`) | PreToolUse で即時 | **パス一致ルーティング**: ツール入力(Edit/Write の file_path 等)がコメントの対象パスと一致・同一ディレクトリのエージェント(メイン/サブ問わず)に注入 |
| 📮 通常 (`normal`) | Stop(メインのターン境界) | メインセッション(オーケストレーター)にまとめて注入。メインが内容を判断してサブへの反映方法を決める |

- PreToolUse hook は `comments/` に urgent があるときだけパス照合を行い、
  マッチしたら hook 出力(additionalContext)としてコメント本文を注入 → `processed/` へ移動。
  **注入と同一トランザクションで processed/ に移動する**ため、複数のサブエージェントが同じパスを
  触っていても受け取るのは最初にマッチした 1 エージェントのみ(早い者勝ち)。同時に複数の urgent が
  マッチした場合は作成順にすべて連結して注入する
- Stop hook は normal コメントをまとめて差し戻し(`decision: block` + 理由にコメント本文)、
  メインに反映を促す → **差し戻しと同時に `processed/` へ移動**する。次の Stop 発火時には
  未回収コメントが残っていないため再差し戻しは起きない(重複防止はこのファイル移動が担う)
- パス照合はコメント frontmatter の `paths` とツール入力の単純比較(完全一致 or 祖先ディレクトリ)。
  決定的で LLM を使わない

### コメントの陳腐化(確定)

- 対象行がすでに書き換わっていても**そのまま注入**する。コメントには base commit が
  付記されており、受け取った LLM が現状と照合して自分で判断する(機械側では判定しない)
- 実装が最小で、拾いたい意図(「この方針はやめて」等、行が変わっても有効なコメント)を失わない

### 暴走防止

- 同一コメントの再注入はしない(`processed/` 移動が冪等性を担保)
- Stop hook の差し戻しは未回収の normal コメントがあるときのみ。加えて Claude Code が
  hook 入力で渡す `stop_hook_active: true`(直前の Stop 差し戻しから継続中のターン)の場合は
  差し戻さない。この二重ガードで無限ループを防ぐ

## 7. `/pitcrew:config` コマンド

対話式セットアップ。AskUserQuestion で以下を確認し、`.claude/pitcrew.local.md` に保存する:

1. **ビューア**: ブラウザ / TUI / ファイル直接のみ
2. **捕捉対象**: diff / 成果物ファイル / テスト・ビルド結果(複数選択、既定は全部)。
   成果物 glob・テストコマンドの追加パターンもここで設定
3. **注入タイミング**:
   - ハイブリッド(既定): urgent は即時、normal はターン境界(§6 の表のとおり)
   - ターン境界のみ: urgency を無視して全コメントを Stop で注入(PreToolUse 照合を止める)
   - 即時のみ: 全コメントを urgent 扱いで PreToolUse 照合する。ただしパスにマッチしない
     コメントの取り残し防止として、ターン境界(Stop)での回収だけは残す
4. **ブラウザビューアのテーマ初期値**: デバイス追従(既定) / ライト / ダーク
5. **その他**: サーバーポート、`.gitignore` への `.pitcrew/` 追記の提案、`.pitcrew/` のリセット

再実行すると現在値を初期値として再設定できる(対話を途中でやめた場合は元の設定を変更しない)。
設定ファイルは plugin-settings の `.local.md` パターン(YAML frontmatter)に従う。

## 8. プラグイン構成

```
plugins/pitcrew/
├── .claude-plugin/plugin.json
├── README.md
├── commands/
│   └── config.md              # /pitcrew:config
├── hooks/                     # 捕捉層+注入層(バンドル済み .mjs を参照)
├── src/                       # TypeScript ソース(hooks・サーバー・TUI・共有ライブラリ)
├── scripts/                   # バンドル出力(git 管理、利用者はビルド不要)
├── skills/
│   └── pitcrew/SKILL.md       # 概念説明+コメント対応の作法(注入を受けた側の振る舞い)
└── package.json / build.ts
```

- 既存プラグインと同じ TypeScript → バンドル体制(`pnpm build`、生成物を git 管理)
- hooks の登録は plugin.json / hooks 定義で行い、`${CLAUDE_PLUGIN_ROOT}` でスクリプトを参照

## 9. エラーハンドリング方針

- hooks は全経路フェイルオープン: `.pitcrew/` の書き込み・読み取りに失敗した場合は
  何もせず正常終了し、セッションの進行を阻害しない(ディレクトリ自体は必要時に自動作成する。§3)
- ビューアのクラッシュ・不在はセッションに影響しない(ファイルバスのみ依存)
- 捕捉スクリプトの例外は `.pitcrew/log/` に記録して黙って続行
- 書き込みは「一時ファイル→rename」で行い、ビューアが書きかけのファイルを読まないようにする
  (同一ディレクトリ内 rename の原子性を利用。ロック機構は導入しない)

## 10. テスト方針

- 捕捉層・注入層の各スクリプトは純粋関数部分(パス照合・frontmatter 解析・diff 抽出)を
  vitest で単体テスト
- hook 入出力(stdin JSON → stdout/exit code)は fixture ベースの統合テスト
- ビューアはサーバーの API/SSE をテストし、UI は手動確認(モック承認済みのレイアウトを基準)

## 11. スコープ外(YAGNI)

- 複数 run の同時並走管理(単一 run 前提で開始。「run」の区切りは緩く、`run.json` が無ければ
  新規作成する程度。セッションを跨いでも `.pitcrew/` はそのまま使い続けられ、
  仕切り直したいときは `.pitcrew/` を削除する)
- `reviewed/`・`processed/` のアーカイブ・自動削除ポリシー(溜まったら手動削除 or リセット)
- リモート越しのレビュー(localhost のみ)
- レビューコメントの LLM による事前整形・要約
- codiel との深い統合(まずは汎用の SubagentStop/PostToolUse 捕捉のみ。
  codiel のフェーズ情報の取り込みは将来課題 — `run.json.phase` を予約済み)

## 12. 実装ステージ(概要)

1. **Stage 1: ファイルバス+捕捉層** — `.pitcrew/` スキーマ、SubagentStop/PostToolUse 捕捉、
   C(ファイル直接)方式で成立する最小構成
2. **Stage 2: 注入層** — PreToolUse(urgent・パス一致)+ Stop(normal・ターン境界)、processed 管理
3. **Stage 3: /pitcrew:config** — 対話式セットアップ、`.claude/pitcrew.local.md`
4. **Stage 4: ブラウザビューア** — HTTP + SSE、2ペイン UI、ライト/ダーク切替
5. **Stage 5: TUI ビューア** — `pitcrew watch`

各ステージ末尾で動作確認できる(前のステージだけで価値が出る)よう分割している。
