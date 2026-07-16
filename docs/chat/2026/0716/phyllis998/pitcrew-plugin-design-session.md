# Pitcrew プラグイン設計セッション（革新的なプラグイン検討会）

- 日付: 2026-07-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `docs/superpowers/specs/2026-07-16-pitcrew-design.md`（コミット 57dd921、設計書更新 14ef8e2）、`docs/superpowers/plans/2026-07-16-pitcrew-stage1.md`（コミット bb74c1e）、`docs/superpowers/plans/2026-07-16-pitcrew-stage2.md`（実装開始時作成、コミット 不明）、plugins/pitcrew/ Stage 1 完成（コミット bffb798〜9d69489、main マージ済み、v0.6.0-dev）、Stage 2 実装・マージ完了（feature/pitcrew-stage2 ブランチ、全 10 コミット ff3426c〜c4649cb、v0.7.1-dev、main @ c4649cb）
- 前提: CLAUDE.md（リポジトリルート）、`.claude-plugin/marketplace.json`、既存プラグイン README.md、Stage 1 成果物（plugins/pitcrew/ 一式、main @ 9d69489）

---

## セッション1: ブレインストーミング〜プラグイン案の決定

# phyllis998

> まだこの世にあまりない、他を圧倒するような革新的なプラグインを考えてください。
> いくつかの案から、実際に作るプラグインを決めたいです。

# AI

**実行内容:**
既存プラグイン群（basic-design / codiel / revelation / task-utility）の調査を開始。Marketplace manifest と各プラグイン README を確認し、現状の機能カバレッジと不足領域を把握するためのタスク実行。

**確認内容:**
- 目的・制約・成功基準を段階的にユーザーに確認（5 つの質問を実施）
- ターゲット、ペイン、制約条件の明確化

**確定した方向性:**
- **ターゲット**: 開発者自身の日常開発作業
- **ペイン**: 待ち時間・フィードバックの遅さ（主にサブエージェント/オーケストレーション待ち）
- **解決方向**: 「待ち時間自体を減らす」 + 「待ち時間を活用する」
- **重要な制約**: トークン消費なしの仕組みで勝負

**提示した複数案の比較:**
1. **案A: Pitcrew** — 並走レビュー基盤。実行中に成果を逆流させて人間をパイプライン化
2. **案B: Memoise** — コマンド結果キャッシュ。実行結果の再利用で待ち時間削減
3. **案C: Briefing** — 事前情報注入。コンテキストを事前に詰めて投入時間を削減
4. **案B+D合体案** — キャッシュと別レイヤーの組み合わせ検討

**決定:**
ユーザーは **案A: Pitcrew** を選択。実行中に成果を逆流させて人間をパイプライン化する並走レビュー基盤を作ることに決定。

---

## セッション2: ビューア形態の議論

# AI

**設計セクション1の提示を開始:**
3層構成（捕捉層 hooks / ローカルビューア / 注入層 hooks）+ `.pitcrew/` 共有バスの全体方針を示した段階で、ユーザーから次のステップの要望を受信。

**ユーザーの優先判断:**
ビューアの形態がレビュー体験の中核であり、先に固めるべきと指摘。

**提案:**
ブラウザタブにモックアップや比較画面を組み立てながら進められるブレスト用ビジュアルコンパニオンの起動を提案した段階で、会話記録の指示が到達。

**残課題:**
- ビューアの具体的な形態（ブラウザコンパニオンの活用可否を含む）
- 各層の詳細設計（hooks の実装位置、バス スキーマ）
- 成果物の確認（設計書の作成と承認）

---

## セッション3: ビューア形態の決定とモック提示

# phyllis998

> Cを土台にA or Bを載せる方式が良いと思います。それらの設定を行うconfigコマンドも用意したいです。

# AI

**方針の確定:**
C 土台 + ビューアを載せる段階構成（C: ファイル直接方式をデータ層に、A: ブラウザ Web ビューア / B: ターミナル TUI をオプショナルに乗せる）と、`/pitcrew:config` コマンドによる対話式セットアップの追加、両方を採用。

**設計セクション3（ビューア層）に関する対話的決定:**
5〜7つの確認質問への回答を得て、以下を確定：
- **ビューアの構成**: A (ブラウザ Web ビューア) と B (ターミナル TUI) の両方を実装計画に含める。ユーザーが選択可能な構成。
- **config コマンド**: `/pitcrew:config` として対話式セットアップを実装。ビューア選択・捕捉対象の設定・注入タイミングの選択を対話で行い、`.claude/pitcrew.local.md` に保存。
- **注入タイミング**: ハイブリッド方式を採用。緊急コメント（🚨）は PreToolUse フェーズで即時注入、通常コメント（📮）は Stop フェーズ・各フェーズ境界でまとめて注入。
- **捕捉対象**: 3種に絞定。①設計書・実装計画書等の成果物ファイル、②コード diff、③テスト・ビルド結果。

**ビューア UI モックの作成・提示:**
ブラウザビューアの UI モックをビジュアルコンパニオンに表示。構成は以下の通り：
- **上部ステータスバー** — 実行中フェーズ進行状況（例: implement 3/5）・未レビュー数・未回収コメント数・SSE 最終更新
- **左ペイン: レビューキュー** — 捕捉対象3種が種別バッジ（設計/diff/テスト）+ 発生元エージェント + 経過時間つきで時系列に並ぶ。レビュー済みはグレーアウト
- **右ペイン: 詳細** — diff はファイルタブ + 色分け表示で差分を視覚化。行単位コメントの入口つき。「承認して既読」ボタンでキューから消化
- **コメント欄** — 送信時に通常（📮: フェーズ境界で注入）/ 緊急（🚨: 次のツール実行前に注入）を選択可能

**確認ポイント A～D:**
モックに対する複数選択形式の確認ポイントを提示。良い点はクリック選択、変更希望があればターミナルで伝えるよう促した。

**ビューアの追加要望:**
ユーザーからライト/ダークモード切替 UI（デフォルトはデバイス設定）の追加要望を受け、設計書に反映（localStorage での手動切替 > config 初期値 > `prefers-color-scheme` の優先順位）。

**設計セクション4（注入層）の詳細詰め:**
ユーザーが「注入層の詳細をもう少し詰めたいこと」を選択。以下が確定：
- **コメントの配送先**: 緊急度で使い分け。緊急は `PreToolUse` フェーズで即注入（パス一致ルーティング）、通常はフェーズ境界でまとめて注入
- **ルーティング判定方式**: パス一致（`PreToolUse` ツール入力パスと、コメント対象パスの完全一致、または同一ディレクトリ内の判定）
- **コメント陳腐化の扱い**: base commit を付記し、受け手の LLM が判断できる形で「そのまま注入」

**設計書の執筆と承認:**
全12セクション（コンセプト、3層アーキテクチャ、.pitcrew/ 構造、捕捉層、ビューア層、注入層、config、プラグイン構成、エラーハンドリング、テスト方針、スコープ外、実装ステージ5段階）を含む設計書 `docs/superpowers/specs/2026-07-16-pitcrew-design.md` を執筆。Haiku サブエージェントのレビューを実施し、指摘（run.json スキーマ未定義、緊急コメントの競合、Stop 重複防止、テスト判定方式、テーマの二重管理等）を反映してコミット（57dd921）。

---

## セッション4: 設計承認と実装計画への委譲

# phyllis998

> 実装計画に進んでください。なお、ビジュアルコンパニオンは一旦停止で大丈夫です。

# AI

**設計承認:**
設計書の全体が承認された。

**ビジュアルコンパニオンの停止:**
ブラウザビューア開発用のローカルサーバー（port 65453）を停止。

**エージェント運用方針に従った委譲:**
CLAUDE.md で定義されたエージェント運用方針に従い、実装計画の立案を Opus サブエージェントに委譲。`superpowers:writing-plans` スキルを起動。

**Stage 1（ファイルバス+捕捉層）の実装計画立案:**
Opus サブエージェントが計画立案を開始。調査フェーズ（`.pitcrew/run.json` スキーマ定義、捕捉対象ファイルの glob パターン、hook 挿入位置、初期化スクリプト、エラーハンドリング）を完了した後、計画書の執筆に進行。

**API エラーによる中断と再開:**
Opus の実装計画書作成途中で API エラーが発生し中断。トランスクリプトから再開させ、計画書の執筆を継続中。完了通知を待機している。

---

## セッション5: 実装計画書の完成と Stage 1 実装（サブエージェント駆動）

# phyllis998

> 再開してください

# AI

**実装計画書の完成:**
Opus サブエージェントが分割書き込み方式（骨子を先に保存 → タスクを小分けに追記）で計画書の完成を達成。`docs/superpowers/plans/2026-07-16-pitcrew-stage1.md` にコミット（bb74c1e、2,247行）。Self-Review を実施し、frontmatter の YAML 引用バグ等 3 件の欠陥を検出・修正済み。

**計画の構成:**
9 タスク・59 ステップ、すべて TDD ベースの実装計画。タスク詳細は以下の通り：
- **Task 1** (Luna): プラグイン雛形（plugin.json / package.json / run.ts）、pnpm-workspace.yaml と marketplace.json への登録、原子的書き込み lib (atomic.ts)
- **Task 2** (Luna): frontmatter lib（YAML サブセットの serialize/parse、Stage 2 のコメント解析でも再利用）
- **Task 3** (Luna): run.json 管理 lib（RunState 型・load による初期値フォールバック・save による原子的書き込み）
- **Task 4** (Terra): git スナップショット lib（一時 index + `git write-tree` で未追跡ファイル込みの worktree tree 化、tree 間 diff、.pitcrew 除外）
- **Task 5** (Luna): レビュー項目 lib（§4 フォーマット Markdown 生成・600行切り詰め・ID 採番・コメントテンプレート付記）
- **Task 6** (Sol): hook 入出力 lib + SubagentStop diff 捕捉 hook（stdin 読取・projectDir 解決・エラーログ+SubagentStop diff 捕捉・hooks.json/build.ts 導入）
- **Task 7** (Terra): PostToolUse 成果物捕捉（docs/**/*.md 捕捉、docs/chat/ 除外、連続 Write/Edit の同一項目コアレス）
- **Task 8** (Terra): PostToolUse テスト・ビルド結果捕捉（前方一致ホワイトリスト・tool_response からの成否推定・末尾120行サマリ）
- **Task 9**: README（C 方式の使い方・リセット手順）・バンドル最新化・全体検証（44 tests）+手動スモークテスト

**実行方式の選択:**
ユーザーが「1: サブエージェント駆動（推奨）」を選択。CLAUDE.md の運用方針に従い、実装タスクを GPT エージェント（複雑度に応じて Sol/Terra/Luna を使い分け）に、レビューを Sonnet に振り分けて実行。

**Stage 1 実装の進捗:**

**Task 1～5 の実行 (Luna + Sonnet):**
Task 1 から Task 5 までは gpt-luna で実装を進め、それぞれ Sonnet レビューで一発承認（Minor 指摘数件は台帳に記録）。以下が実装内容：
- Task 1 (コミット bffb798): プラグイン雛形と marketplace 登録、原子的書き込み lib の実装
- Task 2 (コミット 0b57468): frontmatter パーサの実装
- Task 3 (コミット caa567d): run.json 管理 lib の実装
- Task 4 (コミット 57a6449): git スナップショット lib の実装
- Task 5 (コミット 4b947e6): レビュー項目 lib の実装

**Task 6 の実行 (Sol + Sonnet)：並行競合の既知制限を検出**
gpt-sol で hook 入出力 lib + SubagentStop diff 捕捉 hook を実装（コミット a334a43）。Sonnet レビューで重大指摘が発生：

**指摘内容:**
SubagentStop hook が複数のサブエージェントから並行で起動された場合、run.json に対する read-modify-write の競合が発生し、ID 衝突・diff の重複や欠落が生じる可能性を検出。Stage 1 では hook 自体の実装を完了したが、この並行制御問題は設計段階で認識できておらず、実装段階で明らかになった。

**ユーザー判断:**
「後続 Stage で対応」と判断。この制限を既知の制限として設計書に明記することを決定。

**対応:**
設計書 `docs/superpowers/specs/2026-07-16-pitcrew-design.md` の §10.5 に「並行起動での run.json ID 衝突」を既知制限として追記し、コミット（557c6fc）。

**Task 7 の実行 (Terra + Sonnet):**
gpt-terra で PostToolUse 成果物捕捉（docs/**/*.md 捕捉）を実装（コミット cdd454e）。Sonnet レビューで一発承認。

**Task 8 の実行 (Terra + Sonnet)：PostToolUseFailure バグを検出**
gpt-terra でテスト・ビルド結果捕捉を実装（コミット 2ba07ae）。Sonnet レビューで重大指摘が 2 件発生：

**指摘1: PostToolUseFailure のバグ**
設計書では「失敗したテスト・ビルドの結果を捕捉する」という主目的を掲げており、Task 8 では PostToolUse hook に頼るように実装されていた。しかし、Claude Code の実装では PostToolUse hook は**成功時のみ発火**し、失敗した Bash コマンドは PostToolUseFailure イベントに行く。つまり設計書由来の欠陥であり、実環境では「失敗した」テスト結果が捕捉されず、機能要件の主目的が達成されないことが判明。

**指摘2: 成否推定の正規表現が大文字小文字を区別**
tool_response からの成否推定ロジックで、大文字小文字を区別する正規表現マッチングを使用しており、実装の柔軟性が不足。

**ユーザー判断:**
「今回修正する」と決定。実装エージェント（gpt-terra）に PostToolUseFailure 対応と正規表現修正（大文字小文字非区別）の fix を依頼し、バックグラウンドで実行中。

**設計書の修正:**
並行して、設計書 `docs/superpowers/specs/2026-07-16-pitcrew-design.md` の §4 を PostToolUseFailure を前提とした実装に修正（コミット 91e2fdc）。

**既知の制限と後続 Stage への持ち越し:**
- **§10.5**: SubagentStop hook 並行起動時の run.json ID 衝突（Stage 2 で対応予定）
- **Task 8 修正**: PostToolUseFailure 対応と正規表現修正は当セッション内で完了予定

---

## セッション6: Task 8修正〜Task 9実装・最終ブランチレビュー・マージ完了

# AI

**Task 8 の修正完了と再レビュー:**
実装エージェント（gpt-terra）による PostToolUseFailure 対応と正規表現修正が完了（コミット b1aa616）。失敗マーカーの正規表現を大文字小文字非区別の `/\b(fail(?:ed)?|errors?)\b/i` に修正。Sonnet による再レビューで両 Important 指摘が解消され、リグレッションがないことを確認して承認。

**Task 9 の実装（gpt-terra）:**
README（.pitcrew/ ファイルベース方式の使い方・リセット手順）、バンドル最新化、全体検証（44 tests）を実装完了（コミット 944e03a）。

**Task 9 のレビュー（Sonnet）:**
Task 9 レビューで Important 1 件「README に docs/chat/ 除外が明記されていない」という指摘を受ける。オーケストレーター自身が fix を実施（コミット 9d69489）し、差分目視で承認。

**最終ブランチレビュー（オーケストレーター=Fable 実施）:**
CLAUDE.md の方針どおり、オーケストレーター自身が全 13 コミット（bffb798〜9d69489）の diff を通読。以下を検証：
- pnpm build 後のバンドル整合（差分なし）
- lint 結果（177 files clean）
- typecheck（OK）
- テストスイート（625/625 tests パス）
- 設計制約の充足確認：LLM 不使用・node:* + git CLI のみ・フェイルオープン・原子的書き込み・docs/chat/ 除外

マージ可と判定。新規 Minor 1 件（capture-post-tool-use.ts 冒頭コメントの「Task 8 で追加」という計画参照の残留）は台帳に記録。

**main へのマージとテスト確認:**
fast-forward マージ（main @ 9d69489）、feature/pitcrew-stage1 ブランチ削除。マージ後テスト 625/625 パスを確認。

---

## セッション7: 完了報告

# phyllis998

> チャットに記録してください

# AI

**Stage 1 完成（最終報告）:**
plugins/pitcrew/ 一式が完成し main にマージされました（コミット 9d69489、Fast-forward）。マーケットプレイス登録済み・バージョン 0.6.0-dev。

**実装内容の確認：**
- **SubagentStop hook（コミット bffb798〜57a6449）**: サブエージェント完了ごとに前回捕捉時点からの diff を `.pitcrew/review/NNN-diff-*.md` に記録（未追跡ファイル込み、`.pitcrew/` 除外）
- **PostToolUse 成果物捕捉（コミット cdd454e）**: docs/**/*.md の成果物を捕捉（docs/chat/ 除外）、連続 Write/Edit は同一項目に上書き
- **PostToolUse + PostToolUseFailure テスト・ビルド結果捕捉（コミット 2ba07ae + b1aa616）**: ホワイトリスト前方一致で成否を判定、成功・失敗の両方を記録（正規表現は大文字小文字非区別 `/\b(fail(?:ed)?|errors?)\b/i`）

**設計段階で検出できなかった重大欠陥と修正（Task 8 レビュー）:**
当初設計では PostToolUse 成功時のみを想定していたが、実環境ではテスト失敗等を PostToolUseFailure イベントで捕捉する必要があることが判明。Task 8 実装レビューで検出され、修正実装・設計書更新で対応完了。

**実装プロセスで拾った既知の制限:**
1. **並行起動競合（設計書 §10.5 に明記）**: 複数サブエージェントの同時終了時に run.json の read-modify-write が競合する可能性。Stage 2 設計時に注入層の並行競合と合わせて解決予定。
2. **Minor 指摘群**: tmp ファイル残留の可能性、frontmatter の trim、コードフェンスのエスケープ等。.superpowers/sdd/progress.md に記録済み。

**次のステップ:**
- 実運用での動作確認：プラグイン有効化後、オーケストレーション実行で `.pitcrew/review/` にレビュー項目が溜まることを確認
- Stage 2（注入層）の設計・計画：コメント注入処理 + 並行競合の解決策を併せて設計

---

## セッション8: Stage 2 設計・実装・最終ブランチレビュー

# phyllis998

> その方針で進めてください

# AI

**Stage 2 再開準備：chat-recall による過去データ復元**
chat-recall スキルを実行して、Stage 1 完了時点の記録（セッション 1-7）を復元。設計書・実装計画書・実装コミット群から Stage 2 のスコープを確認。

**設計書の更新（14ef8e2）：**
Stage 1 での既知制限「§10.5 並行起動での run.json ID 衝突」を踏まえ、新規セクション §6「取り残し防止」「並行動作と競合の解決」を追加。並行制御の二方式を確定：

1. **注入側は lock 不要**: `comments/` → `comments/processed/` への rename クレーム方式を採用。rename 操作の原子性で at-most-once を保証し、構造的に重複注入を排除。クレーム敗北時（rename 失敗）はログして続行。取りこぼしは人間が processed/ から戻すことで復旧可能。

2. **捕捉側はアドバイザリロック**: `.pitcrew/run.json` の read-modify-write を `run.lock`（O_CREAT|O_EXCL）で直列化。stale ロック（mtime 10 秒超）は自動回収。待機 3 秒でロック取得に失敗した場合はロックなし続行（フェイルオープン維持）。

PreToolUse 注入の実装手段は claude-code-guide エージェントで公式確認済み（hookSpecificOutput.additionalContext 上限 10,000 文字、permissionDecision 省略時は権限フロー非介入）。

**実装計画書の作成：**
`docs/superpowers/plans/2026-07-16-pitcrew-stage2.md` を新規作成。7 タスク構成の TDD 計画書。Stage 1 の Minor 群（atomic.ts の tmp 残留・frontmatter 末尾空白 trim・計画参照コメント残留）も全消化対象に組み込み：

- **Task 1**: lock.ts + atomic tmp 残留解消
- **Task 2**: 捕捉 hooks へ withRunLock 適用 + 4 プロセス並行テスト
- **Task 3**: frontmatter trim 修正 + comments.ts（列挙・パス照合・クレーム・注入文生成）
- **Task 4**: inject-pre-tool-use.ts（urgent 即時注入）
- **Task 5**: inject-stop.ts（ターン境界一括差し戻し）
- **Task 6**: hooks.json/build.ts 登録 + バンドル
- **Task 7**: SKILL.md 新規・README・バージョン 0.7.1-dev 最終検証

**Haiku レビュー実施と設計書・計画書への反映：**
計画書執筆後、Claude Haiku 4.5 に審査を依頼。理解の要約は正確。採用した指摘：`pathMatchesComment` 引数順序の明文化（設計書・計画書両方）、`RunState`/`loadRun` など Stage 1 由来インターフェースの契約明記（設計書），9,000 文字マージンと 10 秒閾値の根拠追記。テスト追加指摘（Windows パス・逆方向マッチ・stop_hook_active 単独ケース）を計画に織り込み。見送り：NotebookEdit 対応（スコープ外既明記）、lost update flaky テスト（OS スケジューリング依存のため計画に意図的非実装を明記）。

**Subagent-Driven Development による全 7 タスク実装：**

**Task 1（lock.ts + atomic）実装と重大バグ検出:**
gpt-terra が lock.ts を実装（コミット ff3426c）。acquire ループで stale ロック回収時に deadline チェックが恒常失敗し、無限ループに陥る欠陥を Sonnet レビューで検出。原因：stale 判定が誤り、回収が成功しない場合、ループが deadline 条件を迂回。fix コミット aa8a638 で条件句を修正し、回帰テスト追加。再レビュー承認。

**Task 2 (c105b5b)**: 捕捉 hooks（capture-post-tool-use.ts / capture-subagent-stop.ts）へ withRunLock 装着。runTsAsync ヘルパー追加。4 プロセス × 5 回の実並行テストで lost update ゼロ検証。Sonnet 一発承認。

**Task 3 (e73aa4c + lint fix 0a38667)**: frontmatter trim 修正。新規 comments.ts 実装（コメント列挙・パス照合 pathMatchesComment・rename クレーム・注入文生成 renderInjection）。実装者が renderInjection の 9,000 文字切り詰めエッジケース（コメント数多時の超過）を自己発見・対応。Sonnet 承認。

**Task 4 (22160f4)**: inject-pre-tool-use.ts（PreToolUse hook で urgent コメント即時注入）。permissionDecision 返さず権限フロー非介入。Sonnet 承認・指摘なし。

**Task 5 (ba8ea6a)**: inject-stop.ts（stop_hook_active ガードで無限ループ防止、ターン境界で未回収コメント一括差し戻し）。Sonnet 承認・指摘なし。

**Task 6 (3bef832)**: hooks.json への新 hook 登録。build.ts にバンドル対象追加。実注入 E2E テストをレビュアー（Sonnet）が独立検証して承認。

**Task 7 (c4649cb)**: SKILL.md 新規（注入層スキル説明）。README 追記（コメント記法・処理フロー）。バージョン 0.7.1-dev（計画 0.7.0 予定だが Task 1 fix で実装者が +0.1）。全 654 tests、lint 186 files clean、typecheck OK を確認。Sonnet 承認。

**最終ブランチレビュー（Fable 実施）：**
feature/pitcrew-stage2 の全 10 コミット（ff3426c〜c4649cb）を実施者ではない立場で通読。並行制御設計（クレーム方式・アドバイザリロック）の整合性、fork/4 プロセス并行テストの妥当性、バンドル差分ゼロ、E2E smoke 実施結果（urgent 即時注入・normal 差し戻し・stop_hook_active ガード全て期待動作）を確認。654/654 tests・lint clean・typecheck OK・pnpm build 差分ゼロ。設計制約充足（LLM 不使用・node:* + git CLI のみ・フェイルオープン）確認。**マージ可と判定**。

**マージ判定：**
実装完了。設計・計画・Haiku レビュー・全タスク実装・最終ブランチレビューすべて確認。あとはユーザーの main マージ判断を待機。バージョン v0.7.1-dev で、マージ後の実機確認（urgent 注入・normal 差し戻し・processed/ 移動）は計画書末尾に手順記載済み。`.gitignore` への `.pitcrew/` 追記は Stage 3 config コマンド実装時に。

---

## セッション9: Stage 2 マージ・実機確認前

# phyllis998

> マージお願いします

# AI

**main へのマージ実行:**
feature/pitcrew-stage2 を main へ fast-forward マージ（main @ c4649cb）。フィーチャーブランチ feature/pitcrew-stage2 を削除。

**マージ後テスト確認:**
マージ後のテストスイートを実行。76 files / **654/654 パス**を確認済み。

**実装成果の確認:**
- pitcrew は v0.7.1-dev になり、注入層（urgent の PreToolUse 即時注入 + normal の Stop 差し戻し）と並行競合対策（run.lock）が有効になった
- Stage 1（捕捉層）との統合確認も完了

**リモート状態の確認:**
main はローカルで origin より 19 コミット先行している状態。push は指示があれば実施予定。

**次のステップと実機確認手順:**
本格的な実機確認（プラグイン再読み込み後）の項目を説明。計画書末尾に手順あり：

1. サブエージェント作業中に `.pitcrew/comments/c-001.md`（urgency: urgent、実際に触るパス指定）を置き、対象ファイルの Edit 直前に注入されることを確認
2. urgency: normal のコメントがメインのターン終了時に差し戻されることを確認
3. 注入後に `comments/processed/` へ移動し、再注入されないことを確認

**ファイル管理方針:**
`.gitignore` への `.pitcrew/` 追記は Stage 3 の `/pitcrew:config` 実装（config コマンドと Web/TUI ビューア層）までは手動での追記は行わない。必要に応じてユーザーが手動で実施する方針。

---

注意事項: Stage 2 実装・main マージ完了。v0.7.1-dev。実機確認手順は計画書末尾参照。次は Stage 3（config コマンド + Web/TUI ビューア層）への移行またはユーザーの実運用確認。
