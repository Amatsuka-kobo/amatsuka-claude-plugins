---
name: raguel-gating
description: Codiel の run で、オーケストレーターが各フェーズの成果物を Raguel MCP の evaluate ツールに通し、返った verdict に応じて state を遷移させるときに使う。orchestrating-runs が名指しで起動する。
---

# Raguel ゲート運用規約

## 概要

Codiel オーケストレーターは各フェーズの成果物(判断・設計・計画・コード)を Raguel MCP に検査させ、
返ってきた `verdict`(`PROCEED` / `ASK` / `STOP`)に従ってのみ `state.json` を遷移させる。
成果物の本文や差分は Raguel がリポジトリから自分で読むので、オーケストレーターは範囲を指す入力(`paths`・`baseRef`)だけを渡す。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/raguel-gating` である。
`<plugin-root>` はそのベースディレクトリの 2 階層上である。`codiel-state` は以下の形で呼ぶ(対象プロジェクトの
ルートで実行する):

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## チェックリスト

### コマンド起動時(1 回)

`/codiel:run` / `/codiel:test` などの codiel コマンドが起動したら、フェーズ処理に入る前に:

1. outcome 自動同期を行う(「outcome の自動同期」参照)。ゲートのたびに行うものではなく、
   コマンド起動の冒頭で 1 回だけ行う。

### ゲートを 1 回通すたびに

1. `codiel-state get --slug <slug>` で現在の `state.json` を取得し、
   `raguelRunId`(`<slug>-try-<n>` 形式)を確認する。これが Raguel へ渡す `runId` になる。code 系のフェーズでは、
   `phases.<phase>.startHead` も控える。これが `baseRef` になる。
2. objective の本体は、intent 文書の `## 要求` と `## 受け入れ基準` から 1〜2 文で書き、
   run を通じて同じ文言にする(本体がブレると、Jev の内容判定が成果物を照らす基準が揺れる)。フェーズに固有の
   事情があれば、本体の後に 1 文だけ注記を足す。intent ゲートでは、intent に不明点が残っていても
   「不明点は後続の discuss フェーズでユーザーと対話的に解消される」ことを注記に含める(不明点の存在だけを
   理由に ASK へ倒す必要はないという文脈を Raguel に渡す。解消の場が保証されているため)。test-code ゲートでは、
   注記に「実装の前なので、対象のテストが失敗するのは期待どおりである」を足す。
   テスト結果を渡すときは、`evaluate_code` の `testResults` に入れる。
3. 評価の前に、成果物をコミットしておく。code 系のフェーズでは、E2E のレポートを含め、追跡しているファイルの
   未コミットの変更が残っていると入力の誤りになる。文書のフェーズは、追跡されていない `design.md` などもそのまま読まれる。
4. フェーズ→ツール対応表(下記)に従い evaluate ツールを呼ぶ。`runId`・`phase`・`objective` は全呼び出しで必須である。
   evaluate を呼ばない限り `evaluationId` は存在せず、`pass-gate` は失敗する。
5. verdict で分岐する(下記「verdict 別ハンドリング」)。
6. PROCEED なら次フェーズのディスパッチプロンプトに前フェーズの findings 要約を含める
   (「findings の引き継ぎ」参照)。

## フェーズ→ツール対応表

| フェーズ | 呼び出すツール | `phase` | 渡すもの |
|---|---|---|---|
| intent | `mcp__plugin_codiel_raguel__evaluate_decision` | `intent` | 判断文(`decision`)。検討した代替案と切り戻し計画があれば `optionsConsidered`・`rollbackPlan` にも入れる |
| design | `mcp__plugin_codiel_raguel__evaluate_design` | `design` | `paths: [<design.md のパス>]` |
| test-spec | `mcp__plugin_codiel_raguel__evaluate_plan` | `test-spec` | `paths`: 作成・更新した `spec.md` と `cases.md`(dev-plan とは独立にゲートする) |
| dev-plan | `mcp__plugin_codiel_raguel__evaluate_plan` | `dev-plan` | `paths: [<dev-plan.md のパス>]`(test-spec とは独立にゲートする) |
| test-code | `mcp__plugin_codiel_raguel__evaluate_code` | `test-code` | `baseRef`: test-code の `startHead` |
| implement | `mcp__plugin_codiel_raguel__evaluate_code` | `implement` | `baseRef`: implement の `startHead` |
| test-loop | `mcp__plugin_codiel_raguel__evaluate_code` | `test-loop` | `baseRef`: test-loop の `startHead` |
| fix-loop | `mcp__plugin_codiel_raguel__evaluate_code` | `fix-loop` | `baseRef`: fix-loop の `startHead` |
| intent-sync | `mcp__plugin_codiel_raguel__evaluate_design` | `intent-sync` | `paths`: intent-sync で書き換えた intent と持続層のファイル |

- `paths` はプロジェクトルートからの相対パスで、1〜20 件である。
- code 系フェーズ(test-code・implement・test-loop・fix-loop)の evaluate_code には `baseRef` だけを渡し、`paths` を渡さない。`paths` で範囲を絞った評価は pass-gate の検査 8 が拒む。
- 文書のフェーズで渡すファイルは、pass-gate の検査 9 が照合する。design は `design.md`、dev-plan は `dev-plan.md`、test-spec は `testsDir` 配下の `spec.md` か `cases.md` を、`paths` に含める。intent-sync は、書き換えたファイルをすべて渡す(書き換えるべきファイルがすべて含まれるかは照合されない)。
- `discuss` は Raguel ゲート対象外(`pr / review / triage` と同様)。人間が直接参加する
  フェーズであり、合意内容の検査は design ゲートが design.md と discussion.md の整合として担う。
- 全呼び出し共通の必須引数は `runId`(= `state.raguelRunId`)・`phase`・`objective` である。`repoPath` は渡さない。
- 本文・差分・要約を自分で組んで渡さず、範囲の指定だけを渡す。Raguel が範囲からファイルと差分を読む。
- fix-loop は、fix-loop を始めたときの HEAD から現在の HEAD までを 1 回で評価する。修正ごとに範囲を切らない。
- code 系フェーズの `baseRef` には、そのフェーズで変更が無くても、そのフェーズの `startHead` を渡す。
  run 全体の範囲や、ほかのフェーズの起点へ替えて空の差分を避けない。空の差分は Raguel が PROCEED と
  「変更なし」の info で返す。E2E のレポートだけの差分も、Raguel が変更なしとして扱う。
- 入力の誤り(`isError`)が返ったら、入力を直して呼び直す。入力の誤りは判定ではなく、評価の記録も残らない。
- `evaluate_code` が、未コミットの変更を理由に入力の誤りを返したら、未コミットのパスごとに、run の成果物かどうかで扱いを分ける。
  - このフェーズで変えたファイルなら、コミットしてから呼び直す。
  - run と関係の無いファイル(会話記録など、ほかの仕組みが書くもの)は、run ブランチへコミットしない。
    そのパスが `.codiel/config.json` の `raguel.subject.ignoreUncommitted` に宣言済みなら、未コミットの検査から外れているので、宣言に当たらないパスだけを直して呼び直す。
    宣言されていなければ、`mark-ask` で run を `awaiting_human` にしてから人に知らせ、AskUserQuestion で次のどちらかを聞く。
    宣言を足す(run の間は guard が `.codiel/config.json` への書き込みを拒むので、足すのは人の手か run の外である)、または人が自分でそのファイルを退避する。
  - 宣言する glob は、run と関係の無いファイルの置き場だけにする。ソースのパスは宣言しない。
- test-spec と dev-plan は同じステージで直列に進めるフェーズだが、Raguel へは、それぞれ独立に `evaluate_plan` を呼ぶ。
  片方が PROCEED でももう片方の結果には影響しない。
- 同一 runId で呼び続けるからこそ `common/resubmission-loop`(暴走的な再提出の検知)が効く。
  フェーズが変わっても try が同じなら `raguelRunId` は変えない。
- evaluate の呼び出しが 120 秒を超えて Claude Code にバックグラウンドへ移されたら、完了の通知を待つ。待つ間は evaluate を呼び直さない。
  Jev の問い合わせの上限は既定で 20 秒なので、通常は移る前に返る。
- 評価のあとに成果物を動かさない。code 系フェーズは、pass-gate までコミットを足さない(HEAD が変わると
  pass-gate が止まる)。文書のフェーズは、pass-gate まで文書を書き換えない(内容が変わると止まる)。
- pass-gate の後も、次のフェーズの `start-phase` までコミットを足さない。`start-phase` は、直前に通ったフェーズの
  `passedHead` と今の HEAD が等しいことを要り、コミットがあると「評価の後にコミットがある」旨で失敗する。

## verdict 別ハンドリング

### PROCEED

1. `node <plugin-root>/scripts/codiel-state.mjs pass-gate <phase> --slug <slug> --evaluation-id <evaluationId> --verdict PROCEED`
2. state の `phases.<phase>.status` が `passed` になったことを確認し、次フェーズへ自動遷移する。

### ASK

`judgeStatus` が `degraded` の ASK は、下の「degraded の ASK」に従う。それ以外の ASK は次のとおりである。

1. 所見(`ruleId`・`severity`・`message`)と `decisionPoint`・`reasons`・`casePath` を読み、何がどこで引っかかったかを要約する。
2. `node <plugin-root>/scripts/codiel-state.mjs mark-ask <phase> --slug <slug> --kind raguel --evaluation-id <evaluationId>`
   で run を `awaiting_human` にして停止する。
3. AskUserQuestion で人の裁定を聞く。質問文の中に、懸念の要約(何が、どこで)と `decisionPoint` を入れる。
   応答の本文だけに書いて質問文を短くしない。所見の原文(`message` や `evidence` の全文)は質問文に添えない。
   選択肢は「修正して再提出」「このまま承認」「中止」である。
4. 裁定はオーケストレーターが選ばない。「多分大丈夫」の代理判断は、Red Flags のとおり自己承認である。
   「中止」なら、STOP の「妥当として止める」と同じ手順で終了させる。

#### 裁定 A: 修正して再提出

1. `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で再開する。
   `resume` はフェーズを `in_progress` に戻すだけで `passed` にはしない。
   `awaiting_human` 中は guard-write のフェーズ制御(`in_progress` フェーズ以外への書き込み制限)が
   効かないため、成果物を修正する前に必ず `resume` してフェーズを `in_progress` に戻しておく。
2. 再評価の前に、`mcp__plugin_codiel_raguel__record_outcome`(`outcome: "rejected"`、`ruling: "revise"`、
   `notes` に人の指示、`evaluationId` は ASK を出した evaluate の evaluationId)を記録する。
3. 人の指示に沿って成果物を修正し、コミットする(文書のフェーズは保存する)。
4. 修正済みの成果物で evaluate を呼び直す。`PROCEED` が返って初めて `pass-gate --verdict PROCEED` する
   通常の再ゲート手順を通る(pass-gate の後は「PROCEED」の手順に合流する)。
5. 再評価が `resubmission-loop` などで再び ASK になったら、握り潰さず、もう一度人の裁定を聞く(ASK のたびに
   人が裁定するので、回数の上限は置かない)。`STOP` が返れば STOP の手順に従う。

#### 裁定 B: このまま承認(as-is)

成果物は修正せず、ASK の指摘を踏まえた上でそのまま先へ進めてよいと人が判断した場合である。
この裁定では再 evaluate を呼ばず、`--human-approved` でゲートを通す。`--human-approved`
が正規に使えるのは、この裁定 B と STOP の誤検知の裁定(「STOP」参照)だけである。

1. `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "approved"`、`ruling: "as-is"`、`evaluationId` は ASK を出した
   evaluate の evaluationId)で、人が as-is 承認した裁定を記録する。この記録を飛ばして次に進まない。
   `record_outcome` が失敗したら `pass-gate` に進まず、失敗内容を人に示して裁定を仰ぐ。
2. `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で `in_progress` に戻す。
3. `node <plugin-root>/scripts/codiel-state.mjs pass-gate <phase> --slug <slug> --evaluation-id <ASK の evaluationId> --verdict ASK --human-approved`
   でゲートを通す。`state.phases[<phase>].verdict` は `"ASK"` のまま、`humanApproved: true` が
   記録されるため、「Raguel は ASK を返したが人が as-is 承認して通過した」という事実が監査ログに残る
   (verdict を `PROCEED` に書き換えない)。

### degraded の ASK

`judgeStatus` が `degraded` の ASK は、内容の懸念ではなく、評価の基盤が失敗したことを表す(設定の読み込みエラー・パイプラインの内部エラーなど)。

1. 所見と `degradedReasons` を読み、何が失敗したかを要約する。
2. 通常の ASK と同じく `mark-ask <phase> --slug <slug> --kind raguel --evaluation-id <evaluationId>` で run を `awaiting_human` にする。
3. AskUserQuestion で「再評価」「そのまま承認」「止める」を聞く。質問文の中に、失敗の要約(何が、どこで)と
   `decisionPoint` を入れる。応答の本文だけに書かず、所見の原文は添えない。
4. 再評価が選ばれたら、`resume` してフェーズを `in_progress` に戻し、evaluate を呼び直す。
5. そのまま承認が選ばれたら、裁定 B と同じ手順(record_outcome の `ruling: "as-is"` から pass-gate まで)で通す。
6. 止めるが選ばれたら、`node <plugin-root>/scripts/codiel-state.mjs stop --slug <slug> --reason raguel-degraded` で止める。

### STOP

STOP は人が裁定する。STOP はルール層の専権であり、Jev の内容判定は STOP を出さない
(Raguel 側の不変条件)。Codiel 側でこれを覆す操作は行わない。STOP の後に evaluate を呼び直して
verdict を上書きしない。

1. 所見(`ruleId`・`severity`・`message`・`evidence`)と `decisionPoint`・`reasons`・`casePath` を読み、
   `node <plugin-root>/scripts/codiel-state.mjs mark-ask <phase> --slug <slug> --kind raguel --verdict STOP --evaluation-id <STOP の evaluationId>`
   で run を `awaiting_human` にする。フェーズの `verdict` に `STOP` が残る。
   所見に `casefile/tampered` があるときは、記録の改竄であり覆せないので、手順 2 に進まず、AskUserQuestion を使わずに止める。
   応答の本文で、止めた理由(改竄の所見の要約と `decisionPoint`)を報告する(AskUserQuestion の選択肢は 2 件以上が要り、「止める」だけの質問にできないため)。
2. AskUserQuestion で「誤検知として続ける」か「妥当として止める」かを聞く。質問文の中に、懸念の要約(何が、どこで)と
   `decisionPoint` を入れる。応答の本文だけに書かず、所見の原文は添えない。オーケストレーターはどちらも選ばない。
3. 誤検知として続けるときは、次の順に行う。
   1. `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "approved"`、`ruling: "false-positive"`、STOP の `evaluationId`、
      `notes` に誤検知と裁定した所見と理由)を記録する。失敗したら `pass-gate` に進まず、失敗を人に示す。
   2. `orchestrating-runs` の「失敗の記録」の退避の形で、`<runsDir>/<slug>/unrecorded-gotchas.md` の
      `## 未記録の GOTCHAS` に 1 件書く。`<runsDir>` は `codiel-state config` の出力から取る。run が無いときの退避先は
      `.codiel/reports/unrecorded-gotchas.md` である。`title` は「Raguel の誤検知: <ruleId>」で始める。metatron の CLI の
      案内があっても、台帳へは書かない(誤検知は対象プロジェクトの失敗ではなく、Raguel の作り直しの材料である)。
   3. `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` の後に
      `node <plugin-root>/scripts/codiel-state.mjs pass-gate <phase> --slug <slug> --evaluation-id <STOP の evaluationId> --verdict STOP --human-approved`
      で通す。フェーズの `verdict` は `STOP` のまま残り、`humanApproved` が記録される。
   4. 次のフェーズへ、所見を「人が誤検知と裁定した指摘」として引き継ぐ。
4. 妥当として止めるときは、`node <plugin-root>/scripts/codiel-state.mjs stop --slug <slug> --reason raguel-stop` で止め、
   続けて `orchestrating-runs` の「7. 失敗の記録」に従い、失敗の内容を GOTCHAS に記録する
   (STOP は最も学習価値の高い失敗)。

### ループ上限超過

`codiel-state record-attempt` が上限超過(exit 3)を返した場合は ASK と同じ扱いにする
(`awaiting_human` は `record-attempt` 内部で既にセットされるため、findings 提示 → 人の裁定 → resume/stop の
流れに合流する)。

## findings の引き継ぎ

次フェーズのサブエージェントをディスパッチする際、前フェーズの `EvaluationResult.findings` のうち
残っているもの(severity: info 含む)を `ruleId` + `message` の短い箇条書きで渡す。
これにより、たとえば design フェーズで指摘された懸念を implement フェーズの実装の委譲先が
無視せず踏まえられる。findings の全文(evidence.excerpt 等)は転記しない
(`casePath` を渡し、必要なら読みに行かせる)。

裁定 B(as-is 承認)で通過した場合は必ず引き継ぐ。verdict が ASK のまま進んだフェーズの findings は
「人が承知の上で受け入れたリスク」であり、次フェーズの実行者に「承認済みだが未解消の指摘」として
明示的に渡す(PROCEED 通過時よりも引き継ぎの価値が高い)。

## outcome の自動同期

`/codiel:run` / `/codiel:test` などすべての codiel コマンドは、起動時に 1 回以下を行う。

1. `node <plugin-root>/scripts/codiel-state.mjs get --active` を実行する。この実装は
   `active` / `awaiting_human` / `awaiting_outcome` の run をすべて `runs` に含めて返す。
   ただし codiel 0.x の run(`state.version` が 1)は、`awaiting_outcome` のものだけが含まれる。
   同期対象はそのうち `state.status === "awaiting_outcome"` の run に絞り込む
   (それ以外の run はここでは何もしない)。
2. 絞り込んだ各 run を `state.integration` で分岐する。
   - github: `state.pr.url` が null でない run だけを対象にし、`gh pr view <state.pr.url>
     --json state,mergedAt` で PR の現況を確認する。マージ済み(`mergedAt` が非 null)なら取り込み済み、
     マージされずクローズ(`state: "CLOSED"` かつ `mergedAt` が null)なら却下とする。オープンのまま
     (`state: "OPEN"`)なら何もせず、次回の起動時にまた確認する。
   - local: `git merge-base --is-ancestor <state.branch> <state.baseBranch>` を実行する。
     終了コードが真(0)なら取り込み済みとする。偽なら、この run を取り込み済みとして扱うかを
     ユーザーに聞く。回答が「取り込み済み」なら取り込み済み、「却下」なら却下とし、判断が
     付かなければ何もせず次回の起動時にまた確認する。
3. 取り込み済みと判定した run は `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "approved"`、
   `evaluationId` は下記の選定順)を呼び、続けて
   `node <plugin-root>/scripts/codiel-state.mjs record-outcome --slug <slug> --outcome approved`。
   却下と判定した run は同様に `outcome: "rejected"`(`evaluationId` は下記の選定順)で両方を記録する。
   run 全体の結末には `ruling` を付けない(`ruling` はフェーズのゲートでの人の裁定を表す)。
4. incident(PROCEED したのに実害が出た)は自動検知できない。人が明示的に申告したときのみ、
   `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "incident"`、`evaluationId` は下記の選定順)+
   `codiel-state record-outcome --slug <slug> --outcome incident` を記録する。最も価値の高い失敗判例
   なので、申告を勝手に補ったり省略したりしない。記録したら `orchestrating-runs` の「7. 失敗の記録」に従う。

run 全体の結末(`approved` / `rejected` / `incident`)を記録する際の `evaluationId` は、
「最後にコードを検査した evaluate」の evaluationId を使う。優先順は次のとおり:
`state.phases["fix-loop"].evaluationId` → なければ `state.phases["test-loop"].evaluationId` →
なければ `state.phases["implement"].evaluationId` → なければ `state.phases["test-code"].evaluationId`。

`state.version` が 1 の run は、次のとおり読む。

- `state.integration` を持たないので、github として扱う。
- `state.pr.url` と、選定順に挙げたフェーズのうち fix-loop・test-loop・implement の 3 つは version 2 と同じ名前で持つので(test-code は version 1 に無い)、そのまま読む。
- `record-outcome` の `--slug` には `state.runId`(`issue-<N>` の形)を渡す。

<HARD-GATE>
- 実在しない `evaluationId` での `pass-gate` は許されない。`evaluationId` は、Raguel からその場で返ってきた
  本物だけを渡す。捏造はゲートそのものの無効化である。
- `--human-approved` の正規の例外は 2 つだけである。ASK の裁定 B(このまま承認)と、STOP の誤検知の裁定
  (「STOP」参照)である。どちらも `record_outcome` に `ruling`(ASK は `as-is`、STOP は `false-positive`)を付けて
  記録済みの、実在する `evaluationId` に対してのみ使う。record_outcome を経ていない `evaluationId` や、
  AI が自己判断で作った `evaluationId` に `--human-approved` を付けて通すことは、捏造と同じくゲートの無効化である。
- verdict が `ASK` または `STOP` のときは、`PROCEED` として扱わず、findings を人に見せてから裁定を待つ。
  STOP 後に別の evaluate を呼び直して verdict を上書きしない。人の裁定(ASK は裁定 A / 裁定 B、STOP は
  誤検知として続ける / 妥当として止める)を経ずに、AI が独断で `--human-approved` を付けない。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「前回 PROCEED だったから今回も呼ばなくていい」 | フェーズが変われば成果物も objective も別物。`resubmission-loop` 検知も呼び出しの継続があって初めて機能する。呼ばない run は判例としても蓄積されない。 |
| 「軽微な diff だから evaluate_code は過剰」 | 危険かどうかは Raguel 側のルール層が決定論で判定する。「軽く見える危険な変更」を人間・AI の目で先に篩い落とす行為自体が、Raguel が対策している攻撃パターン。呼び出しコストを気にして省略していい理由にはならない。 |
| 「ASK だが人間は多分承認するので進めてよい」 | 「多分」は推測であり ASK の意味そのものを無効化する。ASK は人間の判断を要求している合図であり、AI が代理で承認したことにするのは自己承認の別形態。必ず停止して裁定を待つ。 |
