# Codiel 👀🌿

ユーザーの要望を聞き取って固定した intent(意図)を起点に、設計・開発・PR起票・レビューまでを
一気通貫で行うオーケストレーターです。

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## コマンド

### `/codiel:init`

対象プロジェクトに Codiel ハーネスを初期化します。対話で保護パスを聞き取り、
`raguel.config.yaml` と `CLAUDE.md` の運用ルール節、`.codiel/` 配下のディレクトリを用意します。
既存ファイルは壊さず不足分だけを追記するため、再実行は常に安全です。内部では
`initializing-harness` スキルの手順に従います。

Codiel は単体で完結します。技術スタック・レイヤー構造・規約・既知の落とし穴といった、より豊かな
前提をプロジェクトに持たせたい場合は、ARCHITECTURE / GOTCHAS を専門に扱う metatron の併用を
検討してください。ARCHITECTURE と GOTCHAS は metatron が管理し、Codiel は解決されたパスから
読み取るだけです。パスは `metatron.config.json` で変更できます。run で起きた失敗(Raguel の STOP など)の
GOTCHAS への記録は、metatron の `recording-gotchas` スキルに任せます。metatron が無い環境では、失敗の
記録は「未記録の GOTCHAS」として run のレポートと完了報告に残り、台帳へは追記されません。後で metatron を
導入すれば、残った記録を台帳へ移せます。

### `/codiel:run [<Issue番号> | <intentパス>]`

引数を省略するとユーザーへの聞き取りから、Issue 番号を渡すと Issue の内容を intent の原文の
入力として、intent 文書のパスを渡すとその内容から、それぞれ run を開始・再開します。未完了の
run(試行)があれば自動的に再開します。内部では `orchestrating-runs` スキルの手順に従い、
以下のフェーズを順に進めます(各フェーズは Raguel MCP のゲートを通過して初めて次に進みます)。

```
[intent]        TOBE を聞き取り ASIS(現状調査)と突き合わせ、intent 文書
                 docs/intents/<slug>.md に確定(連携モード github/local は
                 このフェーズより前に判定) ▶ Raguel: evaluate_decision
[discuss]        論点リストを基にユーザーとディスカッションし、設計方針・スコープを合意
                 (合意は discussion.md に記録。軽量な run では skip。Raguel ゲートなし)
[design]         設計書 design.md を執筆し、ユーザーとウォークスルー(軽量な run では skip)
                                                                ▶ Raguel: evaluate_design
[test-spec ∥ dev-plan]  並列: テスト仕様書+テストケース作成 / 開発手順書作成
                                                                ▶ Raguel: evaluate_plan ×2
[implement]      開発手順書に従い TDD で実装(domain 別 implementer)
                                                                ▶ Raguel: evaluate_code
[test-loop]      (A) テストスクリプト安定化 → (B) NG=バグを TDD で修正、全ケース OK まで反復
                                                                ▶ Raguel: evaluate_code(修正の都度)
[intent-sync]    承認済みの受け入れ基準の変更と、途中で追記された原文を派生文へ反映。持続層を更新
                                                                ▶ Raguel: evaluate_design
[pr]             github: PR 作成(テスト green かつコード PROCEED を hooks が検証) / local: 記録だけで終える
[review]         ドメイン別レビューアー + doc/security レビューアーを並列ディスパッチ、所見を統合
                 (github は PR にも投稿、local は投稿しない)
[fix-loop]       critical/high を修正 → 回帰テスト → 再レビュー、ゼロになるまで反復(所見が無ければ skip)
                                                                ▶ Raguel: evaluate_code(修正の都度)
[triage]         medium/low の指摘をユーザーに提示し、指示のもと github はフォローアップ Issue を起票、
                 local は intent 草案を書く
[finalize]       intent の原文(`## ASIS`/`## TOBE`)の要望ごとに達成/未達/要確認/持ち越しを報告し、
                 持ち越しを除いてすべて達成のときだけ intent の status を done にして run を終了
                 (以後 PR のマージ/クローズを検知して自動で outcome を記録)
```

Issue 番号を渡した場合、本文に `<!-- intent:v2 -->` を持つ Issue は確定済みの intent として、
`<!-- intent:v1 -->` を持つ Issue は聞き直しが要る intent として取り込みます。マーカーが無い
Issue は本文を原文としてそのまま記録します。

詳細は [`docs/DESIGN.md`](./docs/DESIGN.md) を参照してください(§2 に全体フロー、§3-9 に state・テスト資産モデル・
二段ループ・スキル・作業内容による委譲構成・hooks 仕様などを記載)。Codiel は Agent 定義を同梱しません。
各フェーズの作業は作業内容を渡して委譲し、委譲先はプロジェクトの Agent 定義やセッションの運用方針で
決まります(方針が無ければ Claude Code の組み込みのサブエージェントへ送ります)。

run が active な間は、gh-utility のスキル(`issue-craft` など)から GitHub へ投稿しないでください。
投稿する本文に codiel のマーカー `<!-- codiel:generated -->` が付かないため、codiel の hook に
deny されます。intent 承認時の任意の Issue 起票は run の作成前に行うため、この制限の対象外です。

### `/codiel:test [unit-id...]`

`.codiel/specs/` のテスト仕様に基づく回帰テストを、run とは独立に単体実行します。unit-id を省略すると全 unit が対象です。
NG があってもコード修正はディスパッチせず、結果を `.codiel/reports/` にレポートするだけに留めます
(state 遷移や record_outcome は行いません)。

## セットアップ

1. このプラグインを Claude Code にインストールします(marketplace 経由、または `--plugin-dir` で直接指定)。
2. 対象プロジェクトのルートで `/codiel:init` を実行します。対話に答えると、
   `CLAUDE.md` / `raguel.config.yaml` / `.codiel/` 配下のディレクトリが用意されます。
3. `/codiel:run [<Issue番号> | <intentパス>]` で run を開始します。未初期化のまま `/codiel:run` を実行した場合は
   `/codiel:init` の実行を案内して終了します(フェイルクローズド)。

## 推奨 MCP サーバー(任意)

`context7`、`github`、`playwright` を MCP サーバーとして登録すると、仕様確認や GitHub 情報の参照を行う委譲先が利用できます。テスト・実装・レビューの作業を受ける委譲先は、Playwright が付与されていれば画面挙動の確認にも活用できます。委譲先にどの MCP が付与されるかはプロジェクト側の定義によります。未接続でもエラーにはならず、利用可能な他のツールで作業を継続します。GitHub は読み取り系ツールだけを許可しています。

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
