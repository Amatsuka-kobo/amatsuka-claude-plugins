# Codiel 👀🌿

ユーザーの要望を聞き取って固定した intent(意図)を起点に、設計・開発・PR起票・レビューまでを
一気通貫で行うオーケストレーターです。

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## コマンド

### `/codiel:init`

対象プロジェクトに Codiel ハーネスを初期化します。対話で保護パスを聞き取り、
`.codiel/config.json`(testsDir・runsDir・Raguel の設定)と `.gitignore` の Codiel 用の行、
`.claude/rules/codiel.md`、`CLAUDE.md` の `## Codiel` セクション、
`.codiel/` 配下のディレクトリを用意します。`.gitignore` に足す行は差分を示して承認を得てから書きます。
既存ファイルへの変更は不足分の追記に限り、旧セクション
「## Codiel ハーネス運用ルール」があるときだけ承認を得て取り除くため、再実行は安全です。旧セクション
のまま初期化していたプロジェクトは `.claude/rules/codiel.md` を持たないため、更新後の `/codiel:run`
が未初期化と判定します。そのときは `/codiel:init` をもう一度実行すると、`.claude/rules/codiel.md`
などの不足分が追記されます。内部では `initializing-harness` スキルの手順に従います。

Codiel は単体で完結します。技術スタック・レイヤー構造・規約・既知の落とし穴といった、より豊かな
前提をプロジェクトに持たせたい場合は、ARCHITECTURE / GOTCHAS を専門に扱う metatron の併用を
検討してください。ARCHITECTURE と GOTCHAS は metatron が管理し、Codiel は解決されたパスから
読み取るだけです。パスは `metatron.config.json` で変更できます。run で起きた失敗(Raguel の STOP など)の
GOTCHAS への記録は、metatron の `recording-gotchas` スキルに任せます。metatron が無い環境では、失敗の
記録は「未記録の GOTCHAS」として `<runsDir>/<slug>/unrecorded-gotchas.md`(run が無いときは
`.codiel/reports/unrecorded-gotchas.md`)と完了報告に残り、台帳へは追記されません。後で metatron を
導入すれば、残った記録を台帳へ移せます。

Codiel は `docs/intents/domains/` に持続層を持ちます。領域ごとに 1 ファイルで、intent をまたいで効き続ける
意図的な制約を蓄積します。metatron が無い環境では、ADR の条件を満たす判断も `[ADR 候補]` の印を付けて
持続層に全文を残します。metatron を導入すると、`/metatron:init` と `/metatron:update` がこの印を ADR へ移し、
持続層を参照形に縮めます。

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
[design]         設計書 design.md を執筆し、ユーザーとウォークスルー(軽量な run では skip。
                 新しい画面があれば候補から名前を決める)      ▶ Raguel: evaluate_design
[test-spec ∥ dev-plan]  並列: テスト仕様(spec.md/cases.md)作成・更新 / 開発手順書作成
                                                                ▶ Raguel: evaluate_plan ×2
[test-code]      仕様のディレクトリごとに worktree でテストコードを実装より先に書き、
                 失敗すること(Red)を確認してから run ブランチへマージ
                                                                ▶ Raguel: evaluate_code
[implement]      依存の無い開発ステップを wave(worktree の並列グループ)ごとに実装し、
                 通すテスト(ユニットと E2E)を Green にする  ▶ Raguel: evaluate_code
[test-loop]      記録された全テストと test コマンドの回帰を確認し、NG を修正、全件 green まで反復
                 (broken の疑いがあるテストは人の確認後に直す)
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

実装フェーズでは、依存関係の無い開発ステップを worktree(`.codiel/worktrees/` 配下の一時ディレクトリ)
に分けて並列に進めます。ステップはレビューを終えたものから run ブランチへマージされ、
`.codiel/worktrees/` の中身はマージ後または run の終了時に削除されます(`.git/info/exclude` に
追加されるため、通常の `git status` には現れません)。

テストの仕様(`spec.md`・`cases.md`)は、`.codiel/config.json` の `testsDir`(既定は `docs/codiel/tests`)配下に
機能単位で永続します。テストコードの置き場はプロジェクトの規約に従って決まり、置いたパスは各 `spec.md`
の `tests` に記録されます。run の文書(`agenda.md`・`discussion.md`・`design.md`・`dev-plan.md`)は
`runsDir`(既定は `docs/codiel/runs`)の `<slug>/` に置きます。`testsDir` と `runsDir` を書き換えるのは
run が active でないときにしてください(run の途中で変えると、進行中のディスパッチが使う値と食い違います)。
値を書き換えると `.gitignore` の E2E の行が合わなくなり、`/codiel:run` が止まります。そのときは
`/codiel:init` をやり直すと新しい行が足されます。古い行は残るので、消すかどうかは利用者が決めてください。

E2E のテストは実行のたびに、仕様のディレクトリの `reports/` へ `results.json` と、成功なら `summary.md`、
失敗なら `failure.md` を置きます(frontend は各ケースの最後の画面の画像も残します)。途中でパスした実行と、
実装の前に Red を確かめた実行のレポートは、finalize で消えます。

### git で共有するもの・しないもの

共有するのは次の置き場です。

- `.codiel/config.json`
- run の文書(`<runsDir>/<slug>/`。未記録の GOTCHAS の退避を含む)
- テストの仕様とテストコード(`<testsDir>/`)
- E2E のレポートの `results.json`・`summary.md`・`failure.md`

共有しないのは次の置き場です。`.gitignore` の行で外すのは `.codiel/runs/`・`.codiel/reports/` と E2E のレポートの画像などで、
`.codiel/worktrees/` は run の最初の worktree の作成時に `.git/info/exclude` へ加わります。

- `.codiel/runs/`(try ごとの state・委譲の brief と報告・各回のテスト結果とレビュー所見)
- `.codiel/reports/`(`/codiel:test` の単独実行のレポートと、run が無いときの未記録の GOTCHAS の退避)
- `.codiel/worktrees/`
- E2E のレポートの画像とフレームワークのほかの成果物

委譲先は報告を最終の返答で返し、報告のファイルはオーケストレーターが `.codiel/runs/` の下へ書きます。

### 以前の版からの移行

以前の版で `/codiel:init` を済ませたプロジェクトは、更新後の `/codiel:run` が未初期化と判定して止まります。
Raguel の設定が `.codiel/config.json` の `raguel` に無く、`.gitignore` に Codiel 用の行が無いためです。
`/codiel:init` をやり直すと、以前の版で別ファイルに書いた Raguel の設定を承認のうえで `raguel` へ移し、
移した元のファイルは承認を得て消します。`.gitignore` に足りない行も同じ機会に足されます。
`/codiel:init` の成果物は run の外のファイルなので、コミットは利用者が行ってください。

### 既知の限界

`.codiel` は git のルートに置いてください。git のルートの下のディレクトリ(たとえば `app/.codiel`)に置くと、
`/codiel:init` が足す `.gitignore` の行が当たらず、`.codiel/runs/` などが `git status` に出続けます。

詳細は [`docs/DESIGN.md`](./docs/DESIGN.md) を参照してください(§2 に全体フロー、§3-9 に state・テスト資産モデル・
test-loop の詳細・スキル・作業内容による委譲構成・hooks 仕様などを記載)。Codiel は Agent 定義を同梱しません。
各フェーズの作業は作業内容を渡して委譲し、委譲先はプロジェクトの Agent 定義やセッションの運用方針で
決まります(方針が無ければ Claude Code の組み込みのサブエージェントへ送ります)。

run が active な間は、gh-utility のスキル(`issue-craft` など)から GitHub へ投稿しないでください。
投稿する本文に codiel のマーカー `<!-- codiel:generated -->` が付かないため、codiel の hook に
deny されます。intent 承認時の任意の Issue 起票は run の作成前に行うため、この制限の対象外です。

### `/codiel:test [<testsDir> からの相対パス>]`

`.codiel/config.json` の `testsDir`(既定 `docs/codiel/tests`)配下のテスト仕様に基づく回帰テストを、run とは
独立に単体実行します。引数を省略すると testsDir 全体、指定するとその配下の仕様のディレクトリだけが
対象です。NG があってもコード修正はディスパッチせず、結果を `.codiel/reports/` にレポートするだけに
留めます(state 遷移や record_outcome は行いません)。

## セットアップ

1. このプラグインを Claude Code にインストールします(marketplace 経由、または `--plugin-dir` で直接指定)。
2. 対象プロジェクトのルートで `/codiel:init` を実行します。対話に答えると、
   `.claude/rules/codiel.md` / `CLAUDE.md` / `.codiel/config.json` / `.gitignore` の Codiel 用の行 /
   `.codiel/` 配下のディレクトリが用意されます。
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
