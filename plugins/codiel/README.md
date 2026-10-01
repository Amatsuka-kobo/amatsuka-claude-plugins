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

`.gitignore` に足す E2E の行は testsDir をエスケープせずに使います。testsDir に `#` や `!` で始まる名前、空白、
`[` などを含めると、行が意図どおりに当たりません。testsDir にはこれらを含まない名前を使ってください。

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

## Raguel の運用

Raguel は、各フェーズの成果物を検査して PROCEED / ASK / STOP を返すゲートです。呼び出し側が渡した要約ではなく、Raguel 自身が git の差分とファイルを読んで検査します。設計は [`raguel-mcp/docs/DESIGN.md`](./raguel-mcp/docs/DESIGN.md)、codiel との間のファイル形式と pass-gate の検査は [`docs/raguel-contract.md`](./docs/raguel-contract.md) にあります。

### 設定は `.codiel/config.json` の `raguel` キーに JSON で書く

Raguel の設定は、プロジェクトルートの `.codiel/config.json` の `raguel` キーに、内蔵の既定値との差分だけを JSON で書きます。読む順は次のとおりで、最初に見つかったものだけを使います。

1. 環境変数 `RAGUEL_CONFIG` が指すファイル(中身は `raguel` キーの値と同じ形の JSON)
2. プロジェクトルートの `.codiel/config.json` の `raguel` キー
3. 内蔵の既定値

```json
{
  "raguel": {
    "storage": { "projectId": "my-project" }
  }
}
```

- 旧設定ファイルの `raguel.config.yaml` は廃止しました。YAML は読まず、残っていても使いません。以前の版から移すときは `/codiel:init` をやり直してください。
- プロジェクトルートは、`.codiel` を持つ最も近い祖先のディレクトリです。利用者が自分で作った worktree で Claude Code を起動するときは、その worktree に `.codiel/config.json` を置いてください。持たない worktree では、メインの作業ツリーの設定を読みません。
- 設定は評価のたびに読み直します。書き直した内容は、Claude Code を再起動せずに次の評価から効きます。
- 設定が壊れていても Raguel は起動し、評価は ASK になって、所見に設定のパスと理由が出ます。直せば次の評価から使われます。
- 未知のキー・ルール ID・パラメータは読み込みエラーです。書き間違いが黙って無視されることはありません。例外は、撤去したキー(後述)で、警告付きで無視します。
- マージの規則: オブジェクトは再帰的に重ね、配列は置き換えます。例外は、sealed ルール(`common/secrets`・`code/protected-paths` など、設定で無効にできないルール)の一覧を表す配列で、既定値との和集合になります(`code/protected-paths.globs`、`common/secrets.allowPatterns` など)。緩める方向の配列を、和集合のせいで置き換えられない事態は起きません。どの配列が和集合かは `list_rules` の `params` に出ます。
- `testsDir` は、`RAGUEL_CONFIG` を設定したときも、プロジェクトルートの `.codiel/config.json` から読みます。不正な値(文字列でない・空・絶対パス・`..` を含む)は、Raguel も codiel も失敗にします。
- `RAGUEL_CONFIG` は、MCP サーバーの設定の `env` だけに書くと、hook のプロセスから見えません。guard が `RAGUEL_CONFIG` のファイルを守れなくなるので、Claude Code を起動するシェルの環境変数として設定してください。
- `.codiel/config.json` の `raguel` を書き換えるのは、run が active でないときにしてください。run が active か awaiting_human の間は、codiel の hook が `.codiel/config.json` の全体・`RAGUEL_CONFIG` のファイル・ケースファイルの置き場への書き込みを拒みます。設定を変えるときは run を止めるか、利用者が自分の手で変えます。

### Jev(TYPESAFE_API_KEY)を設定すると内容も判定する

Raguel の判定は、決定論のルール層に、Jev(TypeSafe AI)による判定を足した形です。正規表現と語彙のルールは文脈を見ないため、説明文の中の `rm -rf /` を誤検知したり、否定文や中身の無い欄を見逃したりします。Jev はこれを補い、さらに成果物が objective を満たすか(code なら範囲外の変更・テストの弱体化・セキュリティ上の持ち込みの有無、設計なら矛盾や未決の決定の有無)を、種別ごとの固定の問いで判定します。codiel は Jev を推奨依存とします。

- 環境変数 `TYPESAFE_API_KEY` を設定すると、自動で使います。有効にする設定はありません。
- 鍵が無いときは、ルール層だけで判定します。Jev による内容の判定と文脈の補正は行わず、`contextJudge/unavailable`(info)の所見を残します。判定が ASK や degraded になることはありません。
- **鍵があると、検査する成果物(差分・ファイルの本文)が、秘密情報の伏せ字を当てた後の形で TypeSafe AI へ送られます。** 鍵を設定するかどうかは、その内容を送ってよいかを踏まえて決めてください。
- 秘密情報の混入は、`common/secrets` が stop を出した時点で Jev を呼ばずに止めます(`code/protected-paths` と `casefile/tampered` の stop も同じです)。ただし、ルールが見逃した秘密情報は外へ出えます。
- Jev が動かせる向きは限られます。破壊操作の stop を ask に下げる向きと、語彙系の info を ask に上げる向きなどの補正と、内容の問いが閾値の外のときの ask です。Jev 単独で STOP も PROCEED も出しません。
- 判定の閾値は `contextJudge.thresholds` の `lower`(既定 0.5。確率がこれ以下なら stop を ask に下げ、「満たす」型の問いを ask にする)と `raise`(既定 0.7。これ以上なら info を ask に上げ、「持ち込む」型の問いを ask にする)です。
- 鍵があっても、Jev が失敗した(時間切れ・応答の形の不正)・入力が大きすぎるときは、失敗した問い合わせの結果だけを使わず、`contextJudge/unavailable`(info)に原因を残します。再試行はしません。判定が ASK や degraded になることはありません。

### 評価は Jev の上限(既定 20 秒)で返る

Jev の問い合わせは 2 本を並列に送り、1 回の上限は `contextJudge.timeoutMs`(既定 20000。ミリ秒)です。LLM を起動するパネルは無いので、評価は通常この上限の範囲で返ります。鍵が無ければルール層だけなので、待ちはほとんどありません。

Claude Code は MCP の呼び出しが 120 秒を超えるとバックグラウンドへ移し、完了の通知で結果を返します。通常の評価はこの手前で返りますが、移ったときは codiel が通知を待ち、待つ間に evaluate を呼び直しません。

`degraded` になるのは、設定を読み込めない・Raguel の内部エラーのときだけです。degraded は、成果物の懸念ではなく Raguel 側の障害を表し、codiel は「再評価 / そのまま承認 / 止める」を人に聞きます。

### 撤去した設定キーは警告付きで無視される

LLM パネルと重さ判定の撤去(ADR-012)で、`judge`・`weight`・`panel` の全体と `contextJudge.enabled` は廃止しました。`.codiel/config.json` に残っていても、読み込みエラーにはならず、無視されます。評価のたびに、無視したキーを並べた警告が `reasons` に 1 件出るので、設定から削除してください。

### 保護パスの既定の除外と生成物の宣言は、使い終えたら戻す

`code/protected-paths` は、既定で `.github/**`・`infra/**`・`**/*.env*` への変更を STOP にします。IaC や CI を直す run と、ビルドの出力をソースと同じコミットに入れる規約のプロジェクトでは、次の 2 つのパラメータを使います。

```json
{
  "raguel": {
    "rules": {
      "code/protected-paths": {
        "excludeDefaults": ["infra/**"],
        "generated": ["plugins/*/dist/**"]
      }
    }
  }
}
```

- `excludeDefaults` は、既定の glob のうち保護から外すものを、文字列で完全に一致する形で名指しします。既定に無い文字列は読み込みエラーです。`globs` は既定との和集合なので、`globs` で既定の保護を外すことはできません。
- `generated` は、生成物のパスの glob です。生成物には `common/secrets` だけを当て、保護パス・Jev の対象から外します。リポジトリ全体を生成物にする glob(`**/*` など)は宣言できません。
- 生成物だけの差分には `code/generated-only` の info が付きます。宣言したパスに手書きの変更を紛れ込ませても、生成物との対応は検証されません(既知の限界)。
- 外した glob と `generated` は、評価の応答の `policy.protectedPaths` と `list_rules` に毎回出ます。
- **`excludeDefaults` は、run が終わったら戻してください。** IaC や CI を直す事情が過ぎても外したままだと、その変更が STOP されません。`generated` は、生成物を同じコミットに入れる規約が続く間は残して構いません。

### run と関係の無い未コミットのファイルは、パスを宣言して検査から外す

`evaluate_code` は、評価した内容と作業ツリーが食い違ったまま記録を残さないために、未コミットの変更があると入力の誤りを返します。たとえば会話記録を `docs/chat/` に追記するプラグインが、同じ作業ツリーで動くとします。その記録は run と関係が無いのに、code 系のゲートのたびにこの誤りを起こします。そのファイルの置き場を `raguel.subject.ignoreUncommitted` に宣言すると、その未コミットの変更は検査に数えません。

```json
{
  "raguel": {
    "subject": { "ignoreUncommitted": ["docs/chat/**"] }
  }
}
```

- 値は glob の列で、既定は空です。配列は置き換わります。
- 宣言したパスの変更は、未コミットのままだと評価に入りません。後でコミットすると HEAD が変わり、pass-gate で止まります。
- 宣言した glob は、評価の応答の `policy.ignoreUncommitted` と `list_rules` に毎回出ます。
- ワイルドカードより前の固定部が空の glob(`**/*`・`*.js` など)は宣言できず、読み込みエラーです。作業ツリー全体を検査から外す宣言を防ぐためです。
- **ソースのパスは宣言しないでください。** 宣言すると、未コミットのコードの変更が評価に入らないまま、テストの結果に効きます。書くのは、run と関係の無いファイルの置き場だけにしてください。
- run の間は guard が `.codiel/config.json` への書き込みを拒みます。宣言は run の外で足してください。宣言が無いまま未コミットのファイルで止まったときは、オーケストレーターが run を `awaiting_human` にして知らせます。宣言を足すか、そのファイルを自分で退避してください。

### E2E のレポートは Raguel が評価から外す

`<testsDir>/**/reports/**` の E2E のレポートは、利用者の設定なしに、生成物と同じ扱いで評価から外れます(`common/secrets` だけを当てます)。レポートだけの差分は「変更なし」として PROCEED になります。オーケストレーターがレポートを評価の前にコミットしても、差分に混ざって評価されることはありません。`testsDir` の外にある `reports/` は対象外です。

### intent-sync のゲートには照合の限界がある

intent-sync のゲートは、書き換えるべきファイルがすべて評価されたかを照合しません(既知の限界)。書き換えるファイルが run ごとに違うので、評価したファイルが、ゲートの後で変わっていないことだけを見ます。intent-sync では、書き換えたファイルをすべて `paths` に渡してください。

### ケースファイル・判例・ログの置き場

- ケースファイルと判例は、作業ツリーの外の `~/.raguel`(既定)に置きます。`raguel.storage.casesDir` で変えられ、その下の `cases/<projectId>/` と `precedents/<projectId>/` に入ります。`<runId>/<phase>/attempt-NN/` に証拠が残り、評価の索引 `evaluations.jsonl` と裁定の記録 `outcomes.jsonl` を codiel の pass-gate が照合します。
- 古い run は、既定で 200 件か 90 日を超えたものから消えます(`storage.retention`)。
- ログは stderr にだけ出ます。詳しく見たいときは環境変数 `RAGUEL_LOG_LEVEL=debug` を設定します。
- **projectId の算出が変わりました。** git の共通ディレクトリから決まるので、どの worktree から評価しても同じ値になりますが、以前の版のケースファイルと判例は引き継ぎません。内蔵のシード判例は残ります。複数のクローンで 1 つの projectId を共有したいときは、`raguel.storage.projectId` に同じ値を書いてください。

### 判例の一覧と退役は `list_precedents` と `retire_precedent` を使う

判例は、人の裁定(承認・差し戻し・誤検知)と、PROCEED のあとに実害が出た incident からだけ作られます。一覧は `list_precedents`、誤った判例の取り消しは `retire_precedent` で、どちらも人か、人に頼まれたオーケストレーターが使います。codiel の run は呼びません。退役した判例は検索に出なくなり、ファイルは消えません。内蔵のシード判例をまとめて外すには `precedent.seedCatalog: false` を書きます。

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
