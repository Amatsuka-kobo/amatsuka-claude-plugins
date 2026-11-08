# agent-policy・better-agentics の規律と codiel 1.1〜2.0 の食い違い

- 日付: 2026-11-08
- 対象: plugins/agent-policy(`references/orchestration-discipline.md`)、plugins/better-agentics(`skills/orchestration/SKILL.md`)
- 前提: codiel の設計書 3 本
  - 1.1: `harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`
  - 1.2: `harness-docs/design/2026-11-08-codiel-1-2-workflow-modes-design.md`
  - 2.0: `harness-docs/design/2026-11-08-codiel-2-0-loop-engineering-design.md`
- 決まったこと: ユーザーが 2026-11-08 に次を決めた。
  - コミットと worktree の扱いは codiel が定める。
  - agent-policy や better-agentics の規律とぶつかるなら、両プラグインの規律を変更する。変更の範囲は codiel の run の中に限らない。
- この文書の役割: 両プラグインの改修の入力にする。何が食い違い、どの場面で問題になるかを並べる。直し方の文言は、両プラグインの改修の設計で決める。

## 0. 必ず直す食い違いは 6 件、方向を決める食い違いは 5 件ある

| 番号 | 食い違い | 対象 | 区分 | 表に出るバージョン |
| --- | --- | --- | --- | --- |
| G1 | 委譲先にコミットさせない | 両方 | 必ず直す | 1.1 |
| G2 | 並列の作業に worktree を使わない | better-agentics | 必ず直す | 1.1 |
| G3 | Workflow のスクリプトが起動するエージェントに、委譲先の選び方・依頼文の規律を当てる | 両方 | 必ず直す | 1.2 |
| G4 | 人の手が届かないセッションで、ユーザーへの質問や報告を前提にする | 両方 | 必ず直す | 2.0 |
| G9 | 委譲先の選定に失敗したとき、作業を止めてユーザーの指示を待つ | better-agentics | 必ず直す | 2.0 |
| G11 | メインセッションの書き込みを拒否する delegation gate | agent-policy | 必ず直す(有効にしている場合) | 1.1 |
| G5 | 設計書・実装のコミット・rules の変更の前ごとに、レビューを必須にする | better-agentics | 方向を決める | 1.1 |
| G6 | 設計書をオーケストレーターが書き、2 つのレビューとユーザーの承認を経る | agent-policy | 方向を決める | 1.1 |
| G7 | サブエージェントに Agent ツールを許可しない | agent-policy | 方向を決める | 1.2 |
| G8 | 担当表の全役割をサブエージェントが担い、オーケストレーターは自ら実行しない | agent-policy | 方向を決める | 1.1 |
| G10 | 並列化の条件に、スキルが定める並列の制約を含めない | 両方 | 方向を決める | 1.1 |

「必ず直す」は、codiel の設計書の規約と正面からぶつかり、どちらかを変えないと codiel が動かないか、止まり続けるもの。「方向を決める」は、codiel は動くが、重複や想定外の振る舞いが出るもの。

agent-policy には、既に「コマンドで起動したスキルの手順(スキル駆動のワークフロー)がこの規律のオーケストレーター条項と衝突するときは、ワークフローの手順を優先する」という条項がある(`orchestration-discipline.md:81`)。この条項を、オーケストレーター条項だけでなく規律の全体(コスト規律・設計の規律を含む)に当てる形へ広げると、agent-policy 側の G1・G6・G8・G10 をまとめて解ける。better-agentics には同じ条項が無いので、同じ形の条項を足すかを両プラグインの改修の設計で決める。

## 1. codiel 側の規約

- 担い手(委譲するか、誰に委譲するか)は運用方針に任せる(1.1 の D1)。
- コミットと worktree は codiel が定める(1.1 の D8)。
  - コード系フェーズでは、担い手が自分の変更を、作業しているブランチにコミットする。並列の単位は worktree のブランチ、直列の単位は run ブランチにコミットする。
  - Raguel のゲートは、コミットされた差分と HEAD を照合する(`plugins/codiel/src/raguel-records.ts:449-466`)。ゲートの前に単位の変更がコミットされている必要がある。
  - 並列に進める単位は、担い手によらず、codiel が作る worktree で進める(`plugins/codiel/skills/orchestrating-runs/references/delegation-env.md:5-17`)。
- Workflow モード(1.2)と Loop(2.0)では、codiel が同梱する Workflow のスクリプトがエージェントを起動する。このエージェントの構成はモードの定義に含まれる(1.1 の D1 の注記)。
- Loop(2.0)の Epic のセッションは、人のいないバックグラウンドで、許可モード `auto` で動く。人への質問は、全体のセッションに集める(2.0 の D11・D12)。

## 2. 食い違いの詳細

### G1 委譲先にコミットさせない(両方)

- agent-policy: 「サブエージェントに毎タスクの git commit・広域 grep 検証はさせない。バッチの最後にオーケストレーター側で行う」(`plugins/agent-policy/references/orchestration-discipline.md:221`)
- better-agentics: 「ビルド出力・lockfile・lint の自動修正・git commit は、手順 5 で自分だけが行う」(`plugins/better-agentics/skills/orchestration/SKILL.md:128`)
- 問題になる場面:
  - codiel の implement で、並列の単位を委譲すると、worktree のブランチにコミットが残らない。オーケストレーターがマージするものが無くなる。
  - 単位ごとのゲート(タスクレビュー、test-code・implement の評価)では、コミットされていない変更を評価できない。
  - バッチの最後にまとめてコミットすると、単位ごとの `passedHead` と連続性の検査(`plugins/codiel/src/codiel-state.ts:770-815`)が成り立たない。
- 直す方向: 委譲先が自分の変更をコミットする作業の流れを認める。少なくとも、スキルや手順がコミットの主体を定めているときは、それに従う。

### G2 並列の作業に worktree を使わない(better-agentics)

- better-agentics: split は、書き込むファイルの集合が重ならない作業を、同じ作業ツリーで並列に委譲する(`plugins/better-agentics/skills/orchestration/SKILL.md:113-128`)。worktree の記述は無い。
- 問題になる場面:
  - codiel の並列の単位では、テストを実行し、コミットしてブランチをマージする。同じ作業ツリーを使うと、テストの実行結果やコミットが互いに混ざる。
  - Raguel は単位ごとの差分を評価するので、作業ツリーを分けないと差分が分けられない。
- 直す方向: 並列作業の隔離方法(同じ作業ツリーか worktree か)を、スキルや手順が定めているときはそれに従う。

### G3 Workflow のエージェントに委譲の規律を当てる(両方)

- better-agentics: 「委譲先は自分で選ばず、`pick-delegate` が返した定義で起動する」(`SKILL.md:20`)。
- agent-policy:
  - 委譲先を担当表の役割とモデルで解決する(`orchestration-discipline.md:16-20` ほか)。
  - 起動するときに「あなたはサブエージェントである」と明示する(`:136`)。
  - 「サブエージェントは〜」の条項をすべて依頼文へ転記する(`:145`)。
- 問題になる場面: codiel の Workflow のスクリプト(1.2 の `workflows/implement-subs.js`・`review-fix-subs.js`、2.0 のストーリーの Workflow)は、`agent()` で定義名とモデルを指定せずにエージェントを起動する。依頼文もスクリプトが組み立てる。どちらの規律も、スクリプトの中の起動には当てられない。
- 直す方向: Workflow のスクリプトが起動するエージェントを、委譲の規律の対象から外す。モデルや定義を役割で揃えたいなら、codiel の Workflow の `args` で役割ごとの `agentType` を受け取る形を、codiel 側の改修として別に検討する。

### G4 人の手が届かないセッションで、ユーザーへの質問を前提にする(両方)

- agent-policy: 指摘が対立したときや判断の軸を立てられないとき、`AskUserQuestion` で質問する(`orchestration-discipline.md:91`)。
- better-agentics:
  - `pick-delegate` が `ok: false` を返したら、作業を止めてユーザーへ報告し、指示を待つ(`SKILL.md:21-22`)。
  - 指摘が対立したときは `AskUserQuestion` で聞く(`:79`)。
- 問題になる場面:
  - 2.0 の Epic のセッションは、人のいないバックグラウンドで動く。`AskUserQuestion` を呼ぶと、誰も答えないまま止まる。
  - Workflow のエージェントには、実行中にユーザーへ質問する手段が無い(workflows.md の「No mid-run user input」)。Agent ツールのサブエージェントからは `AskUserQuestion` が外される(sub-agents.md)。Workflow のエージェントで使えるツールの一覧そのものは、codiel 1.2 の S1 で確かめる。
- 直す方向: 人に聞く手段を、スキルや手順が定めているときはそれに従う。codiel の Loop では、問いを state に記録して全体のセッションへ回す(2.0 の 4.6)。

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

- agent-policy: 設計書・実装計画書は、オーケストレーターが書く。書いた後、暗黙知を抽出する役割 → 設計書をレビューする役割の順にレビューし、ユーザーの承認を得る(`orchestration-discipline.md:224-229`)。
- 問題になる場面:
  - codiel の run の design.md・dev-plan.md も設計書に当たる。codiel は Raguel のゲートと design のウォークスルーで確かめるので、agent-policy のレビューと重なる。
  - 1.2 では、サブの design.md をエージェントが書き、ユーザーとのウォークスルーも行わない(1.2 の D7)。agent-policy の「オーケストレーターが書く」「ユーザーの承認を得る」と食い違う。
- 決める方向: codiel の run の文書を、agent-policy の設計書の規律の対象に含めるか。含めないなら、スキル駆動のワークフローの手順を優先するという既存の条項(`:81`)を、この規律にも明示的に当てる。

### G7 サブエージェントに Agent ツールを許可しない(agent-policy)

- agent-policy: 「サブエージェントに Agent Tool を許可しない」(`orchestration-discipline.md:138`)。
- 問題になる場面: 1.2 では、Workflow のエージェントで Agent ツールが使えると分かった場合、サブ intent の中の作業を委譲するかを運用方針に任せる(1.2 の 3.4)。agent-policy の下では、サブ intent の中は常に直列になる。codiel はそれでも動く。
- 決める方向: 現状のままでよいか。Workflow のエージェントを G3 で規律の外に出すなら、この条項もその範囲では当たらない。

### G8 オーケストレーターは担当表の役割を自ら実行しない(agent-policy)

- agent-policy: 「担当表の全役割はサブエージェントが担い、オーケストレーターはそのどれも自ら実行しない」(`orchestration-discipline.md:81`)。
- 問題になる場面: 1.1 以降の codiel は担い手を書かないので、agent-policy の下では codiel の作業の単位がすべて委譲される。コミットとマージ(G1)、レビュー(G5・G6)の扱いを変えたうえで、この条項と矛盾しないかを確かめる必要がある。
- 決める方向: 現状のままでよいか。G1 を直すと、委譲先のコミットとオーケストレーターのマージの分担が、この条項と噛み合うかを確かめる。

### G9 委譲先の選定の失敗で作業を止める(better-agentics)

- better-agentics: `pick-delegate` が `ok: false` を返したら、理由を問わず委譲も作業の続行もしない(`SKILL.md:21-22`)。
- 問題になる場面: 2.0 の Epic のセッションでは、Jev の呼び出しの失敗(`jev-failed`)のような一時的な失敗でも Loop が止まり、誰も気づかない(G4 と重なる)。
- 直す方向: 人のいないセッションでの失敗を、G4 の手段(スキルや手順が定める人への聞き方)で人に回す。

### G10 並列化の条件に、スキルが定める並列の制約を含めない(両方)

- better-agentics の split は、並列のグループの条件を「書き込むファイルが重ならない」「相手の成果を入力にしない」の 2 つだけにし、グループの全員を同時に起動する(`SKILL.md:114-118`)。agent-policy は「独立したタスクが複数あるとき、それらを並列に起動する」(`orchestration-discipline.md:137`)。
- 問題になる場面: codiel では、テストを実行する単位を、仕様のディレクトリに `parallel: true` があるものだけに限り、同時に 4 件までとしている(`plugins/codiel/skills/orchestrating-runs/references/delegation-env.md:19-35`)。テストがポートや DB を取り合うためである。1.1 ではこの条件を、運用方針で並列化を判断する材料として作業の契約に書くが、両方針にはその材料を読む条項が無い。
- 決める方向: スキルや手順が並列の制約を定めているときは、それに従う条項を足すか。

### G11 メインセッションの書き込みを拒否する delegation gate(agent-policy)

- agent-policy: opt-in の PreToolUse の delegation gate は、`agent_id` の無い呼び出し(メインセッション)の Edit・Write・指定した MCP を、`denyGlobs` に当たれば拒否する(`plugins/agent-policy/src/hooks/delegation-gate.ts` の `runHook`)。
- 問題になる場面:
  - 1.1 で、運用方針が委譲を選ばずにオーケストレーターが自分で作業する経路が、拒否される。
  - 2.0 で、Epic のセッション自身の書き込み(Epic 文書、マージのコンフリクトの解消)が拒否される。
  - Workflow のエージェントによる tool 呼び出しで hook の入力に `agent_id` が入らなければ(codiel 1.2 の S2)、その書き込みも拒否される。
- 直す方向: codiel の run の中(codiel の hook が見つける active な run がある間)は、gate を当てない。または、スキル駆動のワークフローの手順を優先する条項(`:81`)を gate にも当てる。

## 3. codiel 側で解消したもの

次の食い違いは、codiel 1.1 の設計で codiel 側を改めたので、両プラグインの改修は不要である。

| 食い違い | 両プラグインの規律 | codiel 1.1 での扱い |
| --- | --- | --- |
| 依頼文の「あなたはサブエージェントである」と規律の転記 | better-agentics は注入するので書かない(`SKILL.md:145`)。agent-policy は冒頭の一文・役割・出力の形式・規律の転記を求める(`orchestration-discipline.md:136-145`) | codiel のテンプレートからは削り、運用方針が求める項目を契約の前後に足してよいとした(1.1 の 1.2 の C)。どちらの方針も満たせる |
| 委譲を義務づける記述 | better-agentics は自分で行うのを基本とする(`SKILL.md:16-18`) | 委譲の義務づけを削り、担い手を運用方針に任せる(1.1 の D1) |
| 再レビューに渡す「反論済み所見」 | better-agentics はレビュアーに自分の結論を渡さない(`SKILL.md:73`) | 再レビューの契約から外し、オーケストレーターが受け取った後に除く(1.1 の J13) |
| 方針が無いときの組み込みのエージェントへの委譲 | — | 削る(1.1 の 1.2 の A) |

## 4. 改修の進め方

- 「必ず直す」の食い違いは、0 章の表の「表に出るバージョン」の codiel のリリースまでに直す。G1・G2・G11 は 1.1、G3 は 1.2、G4・G9 は 2.0 である。
- 「方向を決める」の食い違いは、両プラグインの改修の設計で方向を決める。0 章の末尾のとおり、agent-policy の `:81` の条項を広げる案を、最初に検討する。
- 両プラグインは改修したらバージョンを上げる(プロジェクトの規約)。
- どちらも AI が読む指示書なので、改修は prompt-smith の規律に従って書く。

## 出典

- ユーザーの決定(2026-11-08 の会話): 「コミットとワークツリーの扱いはCodiel側で持って良いです。agent-policyとbetter-agenticsが障害になるならそちらの規律を変更します。」「CodielのRun内ではというか、普通にagent-policyとbetter-agenticsの規律を変更します。何が問題であるかを別の文書にまとめて欲しいです」
- 会話記録: `docs/chat/2026/1107/phyllis998/2356-codiel-1-1-to-2-0-design-kickoff.md`
