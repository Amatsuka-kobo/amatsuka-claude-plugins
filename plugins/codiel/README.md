# Codiel 👀🌿

GitHub issue の内容を取得・分析し、設計・開発・PR起票・レビューまでを一気通貫で行うオーケストレーターです。

## コマンド

### `/codiel:init`

対象プロジェクトに Codiel ハーネスを初期化します。対話インタビュー(技術スタック・ドメイン分割・
コマンド定義・保護パス等の 8 テーマ)の回答から、プロジェクトに合った `docs/ARCHITECTURE.md` /
`CLAUDE.md` / `raguel.config.yaml` を生成し、`docs/GOTCHAS.md` の雛形と `.codiel/` 配下の
ディレクトリを配置します。既存ファイルは壊さず不足分だけを追記するため、再実行は常に安全です
(不足セクションの補完になります)。内部では `initializing-harness` スキルの手順に従います。

### `/codiel:run <issue番号>`

GitHub Issue #`<issue番号>` を起点に、設計→実装→テスト→PR→レビューまでを自律実行します。
未完了の run(試行)があれば自動的に再開します。内部では `orchestrating-runs` スキルの手順に従い、
以下のフェーズを順に進めます(各フェーズは Raguel MCP のゲートを通過して初めて次に進みます)。

```
[0] init         Issue を取得・分析しスコープを決定、feature ブランチと run を初期化
                 ▶ Raguel: evaluate_decision
[1] discuss      論点リストを基にユーザーとディスカッションし、設計方針・スコープを合意
                 (合意は discussion.md に記録。Raguel ゲートなし)
[2] design       設計書 design.md を執筆し、ユーザーとウォークスルー ▶ Raguel: evaluate_design
[3] test-spec ∥ dev-plan  並列: テスト仕様書+テストケース作成 / 開発手順書作成
                                                                ▶ Raguel: evaluate_plan ×2
[4] implement    開発手順書に従い TDD で実装(domain 別 implementer)
                                                                ▶ Raguel: evaluate_code
[5] test-loop    (A) テストスクリプト安定化 → (B) NG=バグを TDD で修正、全ケース OK まで反復
                                                                ▶ Raguel: evaluate_code(修正の都度)
[6] pr           PR 作成(テスト green かつコード PROCEED を hooks が検証)
[7] review       ドメイン別レビューアー + doc/security レビューアーを並列ディスパッチ、所見を PR に投稿
[8] fix-loop     critical/high を修正 → 回帰テスト → 再レビュー、ゼロになるまで反復(所見が無ければ skip)
                                                                ▶ Raguel: evaluate_code(修正の都度)
[9] triage       medium/low の指摘をユーザーに提示し、指示のもとフォローアップ Issue を起票
[10] finalize    結果レポートを出力し run を終了(以後 PR のマージ/クローズを検知して自動で outcome を記録)
```

詳細は [`docs/DESIGN.md`](./docs/DESIGN.md) を参照してください(§2 に全体フロー、§3-9 に state・テスト資産モデル・
二段ループ・スキル/エージェント構成・hooks 仕様などを記載)。

### `/codiel:test [unit-id...]`

`.codiel/specs/` のテスト仕様に基づく回帰テストを、run とは独立に単体実行します。unit-id を省略すると全 unit が対象です。
NG があってもコード修正はディスパッチせず、結果を `.codiel/reports/` にレポートするだけに留めます
(state 遷移や record_outcome は行いません)。

## セットアップ

1. このプラグインを Claude Code にインストールします(marketplace 経由、または `--plugin-dir` で直接指定)。
2. 対象プロジェクトのルートで `/codiel:init` を実行します。対話インタビューに答えると、
   `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` / `CLAUDE.md` / `raguel.config.yaml` と
   `.codiel/` 配下のディレクトリが、プロジェクトに合った内容で作成されます。
3. `/codiel:run <issue番号>` で run を開始します。未初期化のまま `/codiel:run` を実行した場合は
   `/codiel:init` の実行を案内して終了します(フェイルクローズド)。

## raguel-mcp

Codiel オーケストレータ―の基幹システム。名前は「他の天使たちの行いを監視する天使 Raguel」に由来。
LLM が出した回答をチェックし、機械的に PROCEED(続行)/ ASK(人に確認)/ STOP(停止)を判断するツールを提供する MCP サーバー。

### 開発手法

このプロジェクトでは、Node.js のバージョニングに Volta を推奨しています。
パッケージマネージャーは PNPM です。
リンター・フォーマッターに Biome を使用しています。

### エディターについて

Biome 拡張機能を入れた VSCode を推奨しています。
`biome.json` はリポジトリルートにあるため、リンター・フォーマッターが効く関係でリポジトリルートを開いて作業するようにします。
