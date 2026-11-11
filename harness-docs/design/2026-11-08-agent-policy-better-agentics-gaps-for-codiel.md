# agent-policy・better-agentics の規律と codiel 1.1〜2.0 の食い違い

- 日付: 2026-11-08
- 対象: plugins/agent-policy(`references/orchestration-discipline.md`、`assets/roles/{ja,en}/_common.md` と役割断片 `assets/roles/{ja,en}/<役割>.md`)、plugins/better-agentics(`skills/orchestration/SKILL.md`、`references/subagent-policy.md`)
- 前提: codiel の設計書 3 本
  - 1.1: `harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`
  - 1.2: `harness-docs/design/2026-11-08-codiel-1-2-workflow-modes-design.md`
  - 2.0: `harness-docs/design/2026-11-08-codiel-2-0-loop-engineering-design.md`
- 決まったこと: ユーザーが 2026-11-08 に次を決めた。
  - コミットと worktree の扱いは codiel が定める。
  - agent-policy や better-agentics の規律とぶつかるなら、両プラグインの規律を変更する。変更の範囲は codiel の run の中に限らない。
- この文書の役割: 両プラグインの改修の入力にする。何が食い違い、どの場面で問題になるかを並べる。直し方の文言は、両プラグインの改修の設計で決める。

## 0. 必ず直す食い違いは 4 件、方向を決める食い違いは 6 件ある

| 番号 | 食い違い | 対象 | 区分 | 表に出るバージョン |
| --- | --- | --- | --- | --- |
| G3 | Workflow のエージェントに方針の定義を渡すと、外部への副作用の禁止と役割の差し戻しが、push・PR・Issue の起票とサブの担当を止める | 両方 | 必ず直す | 1.2 |
| G4 | 人の手が届かないセッションで、ユーザーへの質問や報告を前提にする | 両方 | 必ず直す | 2.0 |
| G9 | 委譲先の選定に失敗したとき、作業を止めてユーザーの指示を待つ | better-agentics | 必ず直す | 2.0 |
| G11 | メインセッションの書き込みを拒否する delegation gate | agent-policy | 必ず直す(有効にしている場合) | 1.1 |
| G5 | 設計書・実装のコミット・rules の変更の前ごとに、レビューを必須にする | better-agentics | 方向を決める | 1.1 |
| G6 | 設計書をオーケストレーターが書き、2 つのレビューとユーザーの承認を経る | agent-policy | 方向を決める | 1.1 |
| G7 | サブエージェントに Agent ツールを許可しない | agent-policy | 方向を決める | 1.2 |
| G8 | 担当表の全役割をサブエージェントが担い、オーケストレーターは自ら実行しない | agent-policy | 方向を決める | 1.1 |
| G10 | 並列化の条件に、スキルが定める並列の制約を含めない | 両方 | 方向を決める | 1.1 |
| G12 | 委譲を review・split・stuck に限り、split では設計判断を手元に残す | better-agentics | 方向を決める | 1.2 |

G1(委譲先にコミットさせない)は、2026-11-10 の両プラグインの改修で解消したので、表から外した。経緯は 2 章の G1 に残す。

G2 は欠番である。当初「better-agentics の split は、同じ作業ツリーで並列に進める」と挙げたが、SKILL.md にその記述は無く、食い違いではなかったので削った。

「必ず直す」は、codiel の設計書の規約と正面からぶつかり、どちらかを変えないと codiel が動かないか、止まり続けるもの。「方向を決める」は、codiel は動くが、重複や想定外の振る舞いが出るもの。

agent-policy には、既に「コマンドで起動したスキルの手順(スキル駆動のワークフロー)がこの規律のオーケストレーター条項と衝突するときは、ワークフローの手順を優先する」という条項がある(`orchestration-discipline.md:81`)。この条項を、オーケストレーター条項だけでなく規律の全体(設計の規律を含む)に当てる形へ広げると、agent-policy 側の G6・G8・G10 をまとめて解ける。better-agentics には同じ条項が無いので、同じ形の条項を足すかを両プラグインの改修の設計で決める。

## 0-1. agent-policy 側の扱い(2026-11-11 の改修で確定)

agent-policy の改修(設計書 `2026-11-10-agent-policy-subagent-performance-and-codiel-gaps-design.md`、`0.21.8-dev` のまま)で、agent-policy 側の項目を次のように扱った。better-agentics 側の項目は、この表の対象外である。

| 番号 | agent-policy 側の扱い |
| --- | --- |
| G3 | 解消済み。`_common.md` の 4 条を依頼文を優先する形に改め、出力の形と断るときの役割 ID の条項を足した。役割断片の「引き受けない」「差し戻す」は残した。生成済みの定義には setup-agents の再実行で入る |
| G4 | 解消済み。規律の `AskUserQuestion` の条項を外し、名前で起動した外側の手順が人の判断の代わりの仕組みを定めていれば、起動のエラーの報告・設計書の承認・再レビューの判断を仰ぐ場面もそれに従う |
| G6 | 解消済み。外側の手順と規律の両方に従い、両立しないとき(同じ目的の手順が重なるときを含む)だけ、名前で起動した外側の手順を優先する。2 つの設計レビューは並列に起動する |
| G7 | 直さない。全役割で Agent ツールを否にする 2026-09-29 の決定を保つ。ツールの一覧で担保できない `general-purpose` と fork の経路にも、規律の「サブエージェントは、Agent ツールでさらに委譲しない」で届かせた |
| G8 | 解消済み(条項は残す)。外側の手順が作業ごとに担い手を明記して両立しないときだけ、「担当表の役割を自ら実行しない」を当てない。担い手を条件として書いた手順の下では委譲を続ける |
| G10 | 解消済み。並列の起動に、書き込むファイルの集合が重ならないことと互いの成果を入力にしないことの 2 条件を足した。外側の手順がさらに狭い並列の定めを持つときは、両立しなければ外側の手順を優先する |
| G11 | 直さない。delegation gate を有効にしたプロジェクトでは codiel と併用できない。プラグインの README の gate の説明に、両立しない運用を書いた |

codiel への申し送り: 生成済みの定義を作り直さないと、codiel 1.2 の Workflow で push・PR が断られうる。codiel 1.2 のリリースの案内(codiel の README)に、agent-policy の setup-agents の再実行を書く。

## 1. codiel 側の規約

- 担い手(委譲するか、誰に委譲するか)は運用方針に任せる(1.1 の D1)。
- コミットと worktree は codiel が定める(1.1 の D8)。
  - コード系フェーズでは、担い手が自分の変更を、作業しているブランチにコミットする。並列の単位は worktree のブランチ、直列の単位は run ブランチにコミットする。
  - Raguel のゲートは、コミットされた差分と HEAD を照合する(`plugins/codiel/src/raguel-records.ts:449-466`)。ゲートの前に単位の変更がコミットされている必要がある。
  - 並列に進める単位は、担い手によらず、codiel が作る worktree で進める(`plugins/codiel/skills/orchestrating-runs/references/delegation-env.md:5-17`)。
- Workflow モード(1.2)と Loop(2.0)では、codiel が同梱する Workflow のスクリプトがエージェントを起動する。どの作業を別のエージェントで動かすかはモードが決め、各エージェントの委譲の指定(定義名・モデル・effort・依頼文の前置き)は、スクリプトが `args` で受け取る(1.2 の 3.4)。
- Loop(2.0)の Epic のセッションは、人のいないバックグラウンドで、許可モード `auto` で動く。人への質問は、全体のセッションに集める(2.0 の D11・D12)。

## 2. 食い違いの詳細

### G1 委譲先にコミットさせない(両方。2026-11-10 に解消)

- 改修前の規律:
  - agent-policy: 「サブエージェントに毎タスクの git commit・広域 grep 検証はさせない。バッチの最後にオーケストレーター側で行う」(改修前の `plugins/agent-policy/references/orchestration-discipline.md:221`、「コスト規律」のセクション)
  - better-agentics: 「ビルド出力・lockfile・lint の自動修正・git commit は、手順 5 で自分だけが行う」(`plugins/better-agentics/skills/orchestration/SKILL.md:128`)
- 問題になっていた場面:
  - codiel の implement で、並列の単位を委譲すると、worktree のブランチにコミットが残らない。オーケストレーターがマージするものが無くなる。
  - 単位ごとのゲート(タスクレビュー、test-code・implement の評価)では、コミットされていない変更を評価できない。
  - バッチの最後にまとめてコミットすると、単位ごとの `passedHead` と連続性の検査(`plugins/codiel/src/codiel-state.ts:770-815`)が成り立たない。
- 解消した改修(2026-11-10):
  - agent-policy は「コスト規律」のセクションを削った。委譲先のコミットを禁じる条項が無くなった。同じセクションにあった、30KB を超えるスキルをロードさせない条項も消えた。
  - better-agentics は、オーケストレーターだけが行う作業から git commit を外した(`SKILL.md:128`)。サブエージェント側の規律は「git commit は、依頼文で指示されたときだけ実行する」(`references/subagent-policy.md:25`)なので、codiel の契約がコミットを指示すれば当たらない。

### G3 Workflow のエージェントに方針の定義を渡すと、外部への副作用の禁止と役割の差し戻しが、push・PR・Issue の起票とサブの担当を止める(両方)

- codiel 側: Workflow のスクリプトは、委譲の指定(定義名・`model`・`effort`・依頼文の前置き)を `args` で受け取る(1.2 の 3.4・3.7、2.0 の 4.4)。`agentType` は Agent ツールと同じ一覧から引かれるので、どちらの方針が選んだ定義も渡せる(1.2 の 1.1 の表)。
- 両方針とも、外部システムへの不可逆な副作用(公開・投稿・送信・書き込み)を、依頼文の内容によらず禁じる。条文は「書き込み」を例示に含むので push も当たると読めるが、取り消せる操作(ブランチへの push、PR の本文の更新)を「不可逆」に含むかは条文から決まらない。字面で止まる場合と、モデルが慎重に解釈して止まる場合の両方がありうる(実機での確認は 1.2 の S7)。
  - better-agentics: 定義で起動したサブエージェントに、SubagentStart でこの規律を注入する(`references/subagent-policy.md:27`)。
  - agent-policy: setup-agents が生成する定義の本文に、同じ一文が入る(`assets/roles/ja/_common.md:15`。en も同じ)。
- 問題になる場面: Workflow のエージェントは、次の外部への操作を行う。codiel の契約がこれらを作業として明示しても(1.2 の 3.4・3.7、2.0 の 4.4)、方針の規律と食い違い、どちらに従うかが決まらない。
  - 1.2 のサブの担当: Raguel のゲートの評価(Raguel が成果物について Jev へ問い合わせる。`raguel-mcp/src/context/judge.ts:3,489-492`。MCP 経由の評価を「送信」と見なすかは【要確認: 1.2 の S7】)、サブのブランチの push、サブ PR の作成、既存の PR の本文の更新、画像のアップロード(1.2 の 3.4。codiel の `references/github-writing-images.md:17` は「取り消せない外部公開行為」と書く)
  - 1.2 の修正担当: Raguel のゲートの評価、修正の push、github モードでの所見と返信の投稿(画像のアップロードを含む。1.2 の 3.7)
  - 2.0 のストーリーの担当: Raguel のゲートの評価、ストーリーのブランチの push、マージのためのサブのブランチの push とサブ PR のマージ、既存の PR の本文の更新、画像のアップロード、ストーリーの親 PR の作成、親 PR への所見と返信の投稿、triage での PR へのコメント、サブ Issue と triage の Issue の起票、サブ Issue のつなぎ(2.0 の 4.4)。サブ PR の作成とサブ PR への投稿は、子の 1.2 の Workflow のエージェント(上の 2 者)が行う
- 役割の範囲の外の作業と、作業範囲の拡大が要る作業も、両方針は差し戻させる(better-agentics `subagent-policy.md:18`、agent-policy `_common.md:14`・`orchestration-discipline.md:154`)。サブの担当は design から PR までを受け持つので、方針の役割の範囲に収まる定義が無いと、サイクルのたびに断られる。
- agent-policy の生成定義は、役割の指定が依頼文の冒頭に無く、複数の役割のどれとも判断できないときも差し戻させる(`_common.md:9`)。codiel の前置きは任意なので、複数の役割を持つ定義を渡すときに役割の指定が入る保証が無い。
- agent-policy の生成定義の本文には、役割断片の制約も入る(`src/agents/compose.ts:79-87`)。実装の役割の断片は構造が変わる判断を差し戻させ(`assets/roles/ja/complex-impl.md:27`・`normal-impl.md:27`・`light-impl.md:29`・`general.md:27`)、light-impl は判断と設計を要する作業を引き受けない(`light-impl.md:34`)。codiel の前置きが無くても、これらは常に効く。
- 直す方向: 次の一文を、両方針のサブエージェントの規律に足す。agent-policy では `_common.md` と役割断片の制約の両方に足し、生成済みの定義を作り直す。
  - 依頼文が作業として明示した操作は、副作用の禁止の例外にする。
  - 依頼文が作業の範囲を明示しているときは、役割の範囲よりその範囲を優先する。
  - 依頼文に役割の指定が無いときは、依頼文の作業内容から役割を決めて引き受ける(agent-policy だけ)。
  - 依頼文が判断を任せた範囲の不明点は、差し戻さずに担い手が決める(agent-policy の `_common.md:13` だけ)。この条項は、任せた判断かどうかを区別せずに差し戻させる。依頼文が判断を任せたことで不明点が決まったと読めるかは、条文からは定まらない。
- agent-policy では、オーケストレーター側の条項もあわせて整合させる。「各モデルは担当表に従い、その役割タスクのみを担当する」(`orchestration-discipline.md:105`)と、readonly の役割を書き込み用の定義へ回すときの明記(`:141-144`)は、役割の範囲を前提にしている。
- 構造が変わる判断の差し戻し(`subagent-policy.md:15`、agent-policy の `orchestration-discipline.md:150`)は、codiel 側で解く(3 章)。この読み方で差し戻されないかは 1.2 の S7 で確かめ、差し戻されたら G3 に戻す【要確認】。
- あわせて決めること:
  - better-agentics の注入が Workflow のエージェントに届くかは、1.2 の S2 で確かめる。届かなければ前置きで規律を渡すことになるが、better-agentics は規律を依頼文に書かないと定めている(`SKILL.md:145`)。
  - better-agentics は、Skill を持たない定義と 30KB を超えるスキルについて、要るセクションを依頼文へ書き写させる(`SKILL.md:148-149`)。codiel は、スキルを名前と絶対パスで示し、Skill の無いエージェントにはパスから読ませる(1.2 の 3.4)。
  - better-agentics は、`pick-delegate` が複数のレビュアーを返したら全員を起動する(`SKILL.md:76`)。codiel のレビューの指定は 1 つなので、全員は起動できない(1.2 の 9 章)。

### G4 人の手が届かないセッションで、ユーザーへの質問を前提にする(両方)

- agent-policy: 指摘が対立したときや判断の軸を立てられないとき、`AskUserQuestion` で質問する(`orchestration-discipline.md:91`)。
- better-agentics:
  - `pick-delegate` が `ok: false` を返したら、作業を止めてユーザーへ報告し、指示を待つ(`SKILL.md:21-22`)。
  - 指摘が対立したときは `AskUserQuestion` で聞く(`:79`)。
- 問題になる場面:
  - 2.0 の Epic のセッションは、人のいないバックグラウンドで動く。`AskUserQuestion` を呼ぶと、誰も答えないまま止まる。
  - Workflow のエージェントには、実行中にユーザーへ質問する手段が無い(workflows.md の「No mid-run user input」)。Agent ツールのサブエージェントからは `AskUserQuestion` が外される(sub-agents.md)。Workflow のエージェントで使えるツールの一覧そのものは、codiel 1.2 の S1 で確かめる。
- 直す方向: 人に聞く手段を、スキルや手順が定めているときはそれに従う。codiel の Loop では、問いを state に記録して全体のセッションへ回す(2.0 の 4.6)。2.0 の 4.6 は、運用方針が人の判断を求めたときも人に聞く場面に含める。
- better-agentics 側の直し方は、better-agentics の改修設計書(`harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md` の 5.1)で決めた。実装はまだである。

### G5 設計書・実装のコミット・rules の変更の前ごとに、レビューを必須にする(better-agentics)

- better-agentics: 次の 3 つの時点で必ずレビューを依頼する(`SKILL.md:55-66`)。
  - 設計書・実装計画書を書き終え、ユーザーへ示す前(`:57`)
  - 実装を終え、コミットする前(`:58`)。省けるのは、全箇所の正誤を型検査・テスト・lint・grep で判定できるときだけである
  - 全セッションに効く設定や、rules など変更に手順を求めるパスを変えたとき(`:59-61`)
- 問題になる場面:
  - codiel は、ステップや仕様のディレクトリごとにコミットし、その後で Raguel のゲート・タスクレビュー・review フェーズを通す。コミットのたびに better-agentics のレビューが入ると、同じ差分を何度もレビューする。レビューが済むまでコミットできないので、codiel のゲートの順序(コミット → 評価)とも食い違う。
  - codiel の design.md・dev-plan.md を書くたびに、設計書のレビューが入る。2.0 の Epic のセッションには「ユーザーへ示す」相手がいない。
  - 1.1 で `codiel:init` が `.claude/rules/codiel.md` を置き換えるとき、rules の変更のレビューが入る。
- 直す方向: スキルや手順がレビューの時点と方法を定めているときは、それに従う。codiel の run の中では、codiel の review フェーズ・タスクレビュー・Raguel のゲートが、better-agentics の必須のレビューを満たすものとして扱う。

### G6 設計書の書き方とレビューの順序(agent-policy)

- agent-policy: 設計書・実装計画書は、オーケストレーターが書く。書いたら、暗黙知を抽出する役割、設計書をレビューする役割の順にレビューする。最後にユーザーの承認を得る(`orchestration-discipline.md:219-224`)。
- 問題になる場面:
  - codiel の run の design.md・dev-plan.md も設計書に当たる。codiel は Raguel のゲートと design のウォークスルーで確かめるので、agent-policy のレビューと重なる。
  - 1.2 では、サブの design.md をエージェントが書き、ユーザーとのウォークスルーも行わない(1.2 の D7)。agent-policy の「オーケストレーターが書く」「ユーザーの承認を得る」と食い違う。
- 決める方向: codiel の run の文書を、agent-policy の設計書の規律の対象に含めるか。含めないなら、スキル駆動のワークフローの手順を優先するという既存の条項(`:81`)を、この規律にも明示的に当てる。

### G7 サブエージェントに Agent ツールを許可しない(agent-policy)

- agent-policy: 「サブエージェントに Agent Tool を許可しない」(`orchestration-discipline.md:138`)。
- 問題になる場面: 1.2 では、Workflow のエージェントで Agent ツールが使えると分かった場合、サブ intent の中の作業を委譲するかを運用方針に任せる(1.2 の 3.4)。agent-policy の下では、サブ intent の中は常に直列になる。codiel はそれでも動く。
- 決める方向: 現状のままでよいか。

### G8 オーケストレーターは担当表の役割を自ら実行しない(agent-policy)

- agent-policy: 「担当表の全役割はサブエージェントが担い、オーケストレーターはそのどれも自ら実行しない」(`orchestration-discipline.md:81`)。
- 問題になる場面: 1.1 以降の codiel は担い手を書かないので、agent-policy の下では codiel の作業の単位がすべて委譲される。コミット(G1。解消済み)とレビュー(G5・G6)の扱いを変えたうえで、この条項と矛盾しないかを確かめる必要がある。
- 決める方向: 現状のままでよいか。G1 の解消で、委譲先がコミットし、オーケストレーターがマージする分担になった。この分担が、この条項と噛み合うかを確かめる。

### G9 委譲先の選定の失敗で作業を止める(better-agentics)

- better-agentics: `pick-delegate` が `ok: false` を返したら、理由を問わず委譲も作業の続行もしない(`SKILL.md:21-22`)。
- 問題になる場面: 2.0 の Epic のセッションでは、Jev の呼び出しの失敗(`jev-failed`)のような一時的な失敗でも Loop が止まり、誰も気づかない(G4 と重なる)。
- 直す方向: 人のいないセッションでの失敗を、G4 の手段(スキルや手順が定める人への聞き方)で人に回す。codiel 2.0 では、4.6 の「運用方針が人の判断を求めたとき」の問いになる。Auto Ask が有効なら Jev が判断し、失敗の原因が Jev(`no-api-key`・`jev-failed`)のときだけ人に回す(2.0 の 5.1、better-agentics の改修設計書の D20)。better-agentics 側の直し方は G4 と同じ設計書の 5.1 にある。

### G10 並列化の条件に、スキルが定める並列の制約を含めない(両方)

- better-agentics の split は、並列のグループの条件を「書き込むファイルが重ならない」「相手の成果を入力にしない」の 2 つに固定し、条件を満たす作業を同じグループに入れて全員を起動する(`SKILL.md:114-118`)。agent-policy は「独立したタスクが複数あるとき、それらを並列に起動する」(`orchestration-discipline.md:137`)。
- 問題になる場面: codiel では、テストを実行する単位を、仕様のディレクトリに `parallel: true` があるものだけに限り、同時に 4 件までとしている(`plugins/codiel/skills/orchestrating-runs/references/delegation-env.md:19-35`)。テストがポートや DB を取り合うためである。1.1 では、指示層に「並列に進める場合は、この条件を満たす単位に限る」と書く(1.1 の 1.2 の B、D10)。しかし両方針の並列の規律は手順で条件が外れる形になっておらず、better-agentics には手順を優先する条項も無い。agent-policy の `:81` が `:137` に及ぶかは、条文からは読み方が分かれる(「オーケストレーター条項」に定義が無い)。
- 1.2・2.0 のサブとストーリーの並列は、スクリプトが決めるので方針の規律は当たらない。サブの中のステップの委譲(1.2 の 3.4)にも、better-agentics の split の規律は届かない。split はオーケストレーターのスキルにあり、SubagentStart が Workflow のエージェントに注入するのは `references/subagent-policy.md` だけである(`src/hooks/subagent-start.ts`)。codiel は、サブの中で委譲する場合は 1 件ずつ完了を待つ形に限ると書く。
- 決める方向: スキルや手順が並列の制約を定めているときは、それに従う条項を足すか(0 章の末尾の案と同じ形)。

### G11 メインセッションの書き込みを拒否する delegation gate(agent-policy)

- agent-policy: opt-in の PreToolUse の delegation gate は、`agent_id` の無い呼び出し(メインセッション)の Edit・Write・指定した MCP を、`denyGlobs` に当たれば拒否する(`plugins/agent-policy/src/hooks/delegation-gate.ts` の `runHook`)。
- 問題になる場面:
  - 1.1 で、運用方針が委譲を選ばずにオーケストレーターが自分で作業する経路が、拒否される。
  - 2.0 で、Epic のセッション自身の書き込み(Epic 文書、マージのコンフリクトの解消)が拒否される。
  - Workflow のエージェントによる tool 呼び出しで hook の入力に `agent_id` が入らなければ(codiel 1.2 の S2)、その書き込みも拒否される。
- 直す方向: codiel の run の中(codiel の hook が見つける active な run がある間)は、gate を当てない。または、スキル駆動のワークフローの手順を優先する条項(`:81`)を gate にも当てる。

### G12 委譲の場面と split の前提が、Workflow モードの分担と合わない(better-agentics)

- better-agentics: 委譲は review・split・stuck の 3 つの理由に限る(`SKILL.md:12-18`)。split では、全体の設計判断を手元に残す。追加の判断なしに進められる形にできない部分は切り出さない(`:107-109`)。
- 問題になる場面: 1.2 の Workflow モードと 2.0 の Loop では、別のエージェントに作業させることをモードが決める(1.1 の D1 の注記)。サブの担当は design から PR までを受け持ち、設計判断も行う(1.2 の D7)。サブの担当の委譲先を `pick-delegate` で選ぶときの理由は split に当たるが、split の前提とぶつかる。
- 決める方向: スキルや手順が分担を定めているときはそれに従う条項を、better-agentics に足すか(0 章の末尾の案と同じ形)。

## 3. codiel 側で解消したもの

次の食い違いは、codiel 1.1・1.2・2.0 の設計で codiel 側を改めたので、両プラグインの改修は不要である。委譲を義務づけずに「委譲する場合」の規律として書く形(1.1 の D10)で解いたものを含む。

| 食い違い | 両プラグインの規律 | codiel での扱い |
| --- | --- | --- |
| 依頼文の「あなたはサブエージェントである」と規律の転記 | better-agentics は注入するので書かない(`SKILL.md:145`)。agent-policy は冒頭の一文・役割・出力の形式・規律の転記を求める(`orchestration-discipline.md:136-145`) | codiel のテンプレートからは削り、運用方針が求める項目を契約の前後に足してよいとした(1.1 の 1.2 の C)。どちらの方針も満たせる |
| 委譲を義務づける記述 | better-agentics は自分で行うのを基本とする(`SKILL.md:16-18`) | 委譲の義務づけを削り、担い手を運用方針に任せる(1.1 の D1) |
| 再レビューに渡す「反論済み所見」 | better-agentics はレビュアーに自分の結論を渡さない(`SKILL.md:73`) | 再レビューの契約から外し、オーケストレーターが受け取った後に除く(1.1 の J13) |
| 方針が無いときの組み込みのエージェントへの委譲 | — | 削る(1.1 の 1.2 の A) |
| 依頼文に無い判断で構造が変わるときの差し戻し(旧 G3 の一部) | better-agentics は注入する規律で差し戻させ(`references/subagent-policy.md:15`)、実装の役割の断片にも同じ条項を持つ(`assets/roles/ja/complex-impl.md:27`・`normal-impl.md:27`・`light-impl.md:29`・`general.md:27`)。agent-policy は同じ条項を依頼文へ転記させ(`orchestration-discipline.md:145`・`:150`)、実装の役割の断片の制約として生成定義の本文にも入れる(`assets/roles/ja/complex-impl.md:27` ほか。G3) | 担い手に判断を任せる単位では、任せる判断とその材料を契約に明記する(1.1 の 1.2 の C、1.2 の 3.4・3.7、2.0 の 4.4)。`:15`・`:150` の条件は「依頼文に無い判断」なので、判断を任せたことが依頼文にあれば当たらないと読む。`_common.md:13` の条件は「依頼文で決まらない不明点」で、判断の中身が依頼文に無ければ当たりうるので G3 に残す。この読み方で差し戻されないかは、1.2 の S7 で確かめる【要確認】。差し戻されたら、この差し戻しを G3 に戻す。役割の範囲の外と役割の指定の差し戻しは G3 に残る。その他の差し戻し(依頼文と実コードの食い違い、原因を 1 つに絞れない失敗、書き込み範囲の外の変更、名指しされていないスキル。`subagent-policy.md:16-17,19,33`、agent-policy の `orchestration-discipline.md:150` の後半・`_common.md:17`)と、`_common.md:13` のうち任せた判断の外の不明点は、codiel の契約の「決めずに返す」で受ける(1.1 の 1.2 の C)。返し方は `undecided`、担い手が作業そのものを断ったときは `declined` とする(1.2 の 3.6、2.0 の 4.4)。任せた判断の中の不明点の差し戻しは G3 に残る |

## 4. 改修の進め方

- 「必ず直す」の食い違いは、0 章の表の「表に出るバージョン」の codiel のリリースまでに直す。G11 は 1.1、G3 は 1.2、G4・G9 は 2.0 である。G1 は 2026-11-10 の改修で済んだ。
- 「方向を決める」の食い違いは、両プラグインの改修の設計で方向を決める。0 章の末尾のとおり、agent-policy の `:81` の条項を広げる案を、最初に検討する。
- 両プラグインは改修したらバージョンを上げる(プロジェクトの規約)。
- どちらも AI が読む指示書なので、改修は prompt-smith の規律に従って書く。

## 5. 両プラグインの改修の設計で詰める事項

2026-11-09 の再レビューで残った所見である。両プラグインの改修の設計で詰める。

- G3 で agent-policy の役割断片に何を足すか。直す方向の一文が当たる条文は `_common.md` の `:9`・`:13`・`:14`・`:15` で、役割断片には無い。役割断片にある差し戻しは、構造が変わる判断(`complex-impl.md:27` ほか。3 章で codiel 側で解くとしたもの)と、判断と設計を要する作業を引き受けない `light-impl.md:34` である。`:34` を外すか、構造の条項まで緩めるかを決める。
- 改修が既存の利用者の環境に届く経路。生成済みの定義は利用者のプロジェクトにあり、作り直すには利用者が setup-agents を再実行する必要がある。プロジェクトの `.claude/agent-policy/roles/<RoleId>.md` は同梱の断片より優先される(`orchestration-discipline.md:75`)ので、プラグインの改修では届かない。移行の手順を、1.2 のリリースの案内に含めるか。
- better-agentics の、役割の指定が無い依頼文の扱い。`subagent-policy.md:3` は「依頼文の冒頭に書かれた役割で作業する」とし、`:18` は役割に含まれない作業を差し戻させる。役割の指定を求めて差し戻す明文は無いが、codiel の前置きは任意なので、この 2 条が重なって同じ結果になりうる。G3 の直す方向の「役割の指定が無いとき」を、better-agentics にも当てるか。

## 出典

- ユーザーの決定(2026-11-08 の会話): 「コミットとワークツリーの扱いはCodiel側で持って良いです。agent-policyとbetter-agenticsが障害になるならそちらの規律を変更します。」「CodielのRun内ではというか、普通にagent-policyとbetter-agenticsの規律を変更します。何が問題であるかを別の文書にまとめて欲しいです」
- ユーザーの指摘(同日、G3 について): 「委譲先の決定をWorkflowで起動するエージェントに当てはめられない事はないと思いますがどうでしょうか？ 委譲先のエージェント定義をWorkflowで起動すればいいだけなので」「そもそも委譲先を決定してからWorkflowを起動する旨の規律をCodielに書く必要はないです。そんな規律が無くてもClaudeモデルはそうするはずです(観測済)」
- ユーザーの提案(2026-11-09、構造が変わる判断の差し戻しの解消と G10 の指示層の条件。1.1 の D10): 「Codielの指示層に、サブエージェントに委譲する指示書かずとも、"サブエージェントに委譲する場合"という名目で規律を書くようにすれば解決できる部分があるのでは」
- G1 の解消: ユーザーによる両プラグインの改修(2026-11-10。agent-policy の `references/orchestration-discipline.md` の「コスト規律」の削除、better-agentics の `skills/orchestration/SKILL.md:128` の修正)
- 会話記録: `docs/chat/2026/1107/phyllis998/2356-codiel-1-1-to-2-0-design-kickoff.md`
