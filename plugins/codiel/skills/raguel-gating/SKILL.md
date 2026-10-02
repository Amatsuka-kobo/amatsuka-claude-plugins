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

`/codiel:run` や `/codiel:test` などの codiel コマンドが起動したら、フェーズ処理に入る前に `references/outcome-sync.md` を Read し、outcome の自動同期を 1 回だけ行う。ゲートのたびには行わない。

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
   evaluate はフェーズごとに呼ぶ。前のフェーズが PROCEED だったことや diff が小さいことを理由に省かず、`pass-gate` へは Raguel がその場で返した `evaluationId` だけを渡す。
   evaluate や `record_outcome` が接続断・タイムアウトで失敗したら、先に評価が記録済みでないか(`evaluationId` が返っていないか)を確かめ、同じ呼び出しを 1 回だけ呼び直す。呼び直しが重なると `common/resubmission-loop` の ASK を誘発しうる。
   それでも失敗するなら、`mark-ask <phase> --slug <slug> --kind confirm` で待ち、AskUserQuestion で「再試行」「時間を置いて続行」「中止」を聞く。中止は、`waits` を片付けてから(`orchestrating-runs` の 2.4 の片付け方に従う)`stop --slug <slug> --reason raguel-unavailable` で止める。
   成果物は動かさず、ASK や as-is の裁定で代用しない。Raguel の記録なしにゲートを通す手段は無い。
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
- `evaluate_code` が未コミットの変更を理由に入力の誤りを返したら、`references/uncommitted-changes.md` を Read して従う。
- test-spec と dev-plan は同じステージで並列に進めるフェーズで、Raguel へは、それぞれ独立に `evaluate_plan` を呼ぶ。
  片方が PROCEED でももう片方の結果には影響しない。
- 片方が ASK・STOP(degraded の ASK を含む)になったら、`mark-ask` を呼ぶ前に `references/parallel-gates.md` を Read して従う。
- 同一 runId で呼び続けるからこそ `common/resubmission-loop`(暴走的な再提出の検知)が効く。
  フェーズが変わっても try が同じなら `raguelRunId` は変えない。
- evaluate の呼び出しが 120 秒を超えて Claude Code にバックグラウンドへ移されたら、`orchestrating-runs` §3 に従い、`gate-<フェーズ>-<回>` の `id` で待ちを記録して完了の通知を待つ。結果が届いたら §3 の手順で扱う。待つ間は evaluate を呼び直さない。
  Jev の問い合わせの上限は既定で 20 秒なので、通常は移る前に返る。
- 評価のあとに成果物を動かさない。code 系フェーズは、pass-gate までコミットを足さない(HEAD が変わると
  pass-gate が止まる)。文書のフェーズは、pass-gate まで文書を書き換えない(内容が変わると止まる)。
- pass-gate の後も、次のフェーズの `start-phase` までコミットを足さない。`start-phase` は、直前に通ったフェーズの
  `passedHead` と今の HEAD が等しいことを要り、コミットがあると「評価の後にコミットがある」旨で失敗する。

## verdict 別ハンドリング

`ASK` と `STOP` は `PROCEED` として扱わず、所見を人に見せて裁定を待つ。

### PROCEED

1. `node <plugin-root>/scripts/codiel-state.mjs pass-gate <phase> --slug <slug> --evaluation-id <evaluationId> --verdict PROCEED`
2. state の `phases.<phase>.status` が `passed` になったことを確認し、次フェーズへ自動遷移する。

`pass-gate` が検査で拒否したときは、終了コード 1 で標準エラー出力に理由が出る。state は書かれず、フェーズは `in_progress` のままである。理由で対処を分ける。

- 評価の記録が無い・別の run やフェーズのもの・verdict の不一致、最新の評価でない、code 系で評価した HEAD や起点が現在と違う、`paths` で範囲が絞られている、文書系で評価後に内容が変わった、期待する文書が `paths` に無い、のいずれかなら、原因を直して evaluate を呼び直し、返った新しい `evaluationId` で `pass-gate` する。`--human-approved` で迂回しない。
- `raguelContract` の不一致なら、理由文の指示に従う。
- Raguel の記録を読めないなら、理由を人に示して指示を待つ。
- 同じ拒否が 2 回続いたら、`mark-ask <phase> --slug <slug> --kind confirm` で人に確かめる。

### ASK

`judgeStatus` が `degraded` の ASK は、下の「degraded の ASK」に従う。それ以外の ASK は次のとおりである。

1. 所見(`ruleId`・`severity`・`message`)と `decisionPoint`・`reasons`・`casePath` を読み、何がどこで引っかかったかを要約する。
2. `node <plugin-root>/scripts/codiel-state.mjs mark-ask <phase> --slug <slug> --kind raguel --evaluation-id <evaluationId>`
   で run を `awaiting_human` にして停止する。
3. AskUserQuestion で人の裁定を聞く。質問文の中に、懸念の要約(何が、どこで)と `decisionPoint` を入れる。
   応答の本文だけに書いて質問文を短くしない。所見の原文(`message` や `evidence` の全文)は質問文に添えない。
   選択肢は「修正して再提出」「このまま承認」「中止」である。
4. 裁定はオーケストレーターが選ばない。「多分大丈夫」の代理判断は自己承認なので、選択肢の回答を待つ。
   「中止」なら、STOP の「妥当として止める」と同じ手順で終了させる。ただし GOTCHAS 候補は書かない。

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
が使えるのは、この裁定 B と STOP の誤検知の裁定(「STOP」参照)だけである。どちらも `record_outcome` に `ruling`(ASK は `as-is`、STOP は `false-positive`)を記録済みの、実在する `evaluationId` に対してだけ付ける。

1. `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "approved"`、`ruling: "as-is"`、`evaluationId` は ASK を出した
   evaluate の evaluationId)で、人が as-is 承認した裁定を記録する。この記録を飛ばして次に進まない。
   `record_outcome` が接続断・タイムアウトで失敗したら、手順 4 の不通時の手順で呼び直す。それでも、または別の理由で失敗したら `pass-gate` に進まず、失敗内容を人に示して裁定を仰ぐ。
2. `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で `in_progress` に戻す。
3. `node <plugin-root>/scripts/codiel-state.mjs pass-gate <phase> --slug <slug> --evaluation-id <ASK の evaluationId> --verdict ASK --human-approved`
   でゲートを通す。`state.phases[<phase>].verdict` は `"ASK"` のまま、`humanApproved: true` が
   記録されるため、「Raguel は ASK を返したが人が as-is 承認して通過した」という事実が監査ログに残る
   (verdict を `PROCEED` に書き換えない)。

### degraded の ASK

`judgeStatus` が `degraded` の ASK は、内容の懸念ではなく、評価の基盤が失敗したことを表す(設定の読み込みエラー・パイプラインの内部エラーなど)。

1. 所見と `degradedReasons` を読み、何が失敗したかを要約する。
2. 通常の ASK と同じく `mark-ask <phase> --slug <slug> --kind raguel --evaluation-id <evaluationId>` で run を `awaiting_human` にする。
3. 通常の ASK の手順 3 と同じ規則で質問文を書き、選択肢を「再評価」「そのまま承認」「止める」にする。
4. 再評価が選ばれたら、`resume` してフェーズを `in_progress` に戻し、evaluate を呼び直す。
5. そのまま承認が選ばれたら、裁定 B と同じ手順(record_outcome の `ruling: "as-is"` から pass-gate まで)で通す。
6. 止めるが選ばれたら、`waits` に残っている待ちを片付けてから(`orchestrating-runs` の 2.4 の片付け方に従う)、`node <plugin-root>/scripts/codiel-state.mjs stop --slug <slug> --reason raguel-degraded` で止める。

### STOP

STOP は人が裁定する。STOP はルール層の専権であり、Jev の内容判定は STOP を出さない
(Raguel 側の不変条件)。Codiel 側でこれを覆す操作は行わない。STOP の後に evaluate を呼び直して
verdict を上書きしない。

1. 所見(`ruleId`・`severity`・`message`・`evidence`)と `decisionPoint`・`reasons`・`casePath` を読み、
   `node <plugin-root>/scripts/codiel-state.mjs mark-ask <phase> --slug <slug> --kind raguel --verdict STOP --evaluation-id <STOP の evaluationId>`
   で run を `awaiting_human` にする。フェーズの `verdict` に `STOP` が残る。
   所見に `casefile/tampered` があるときは、記録の改竄であり覆せないので、手順 2 に進まず、AskUserQuestion を使わずに止める。
   応答の本文で、止めた理由(改竄の所見の要約と `decisionPoint`)を報告する(AskUserQuestion の選択肢は 2 件以上が要り、「止める」だけの質問にできないため)。
2. 通常の ASK の手順 3 と同じ規則で質問文を書き、AskUserQuestion で「誤検知として続ける」か「妥当として止める」かを聞く。オーケストレーターはどちらも選ばない。
3. 誤検知として続けるときは、次の順に行う。
   1. `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "approved"`、`ruling: "false-positive"`、STOP の `evaluationId`、
      `notes` に誤検知と裁定した所見と理由)を記録する。失敗したら `pass-gate` に進まず、失敗を人に示す。
   2. `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` の後に
      `node <plugin-root>/scripts/codiel-state.mjs pass-gate <phase> --slug <slug> --evaluation-id <STOP の evaluationId> --verdict STOP --human-approved`
      で通す。フェーズの `verdict` は `STOP` のまま残り、`humanApproved` が記録される。
   3. 次のフェーズへ、所見を「人が誤検知と裁定した指摘」として引き継ぐ。
4. 妥当として止めるときは、先に `<plugin-root>/skills/orchestrating-runs/references/gotcha-candidates.md` を Read する。`waits` に残っている待ちを片付けてから(`orchestrating-runs` の 2.4 の片付け方に従う)、`node <plugin-root>/scripts/codiel-state.mjs stop --slug <slug> --reason raguel-stop` で止める。止めたら、その手順で GOTCHAS 候補を書き、完了報告に一覧する。

### ループ上限超過

`codiel-state record-attempt` は上限(既定 5)を超えると run を `awaiting_human` にして exit 3 を返す。CLI に上限のリセットや引き上げの手段は無い。上限超過には `evaluationId` が無いので、ASK の裁定 A・B は使えない。

1. findings と試行の経過を示し、AskUserQuestion で「続行」か「中止」かを聞く。
2. 中止なら、先に `<plugin-root>/skills/orchestrating-runs/references/gotcha-candidates.md` を Read する。`waits` を片付けてから(`orchestrating-runs` の 2.4 の片付け方に従う)`stop --slug <slug> --reason attempts-exceeded` で止める。止めたら、その手順で GOTCHAS 候補を書き、完了報告に一覧する。
3. 続行なら、`resume --slug <slug>` で戻して修正の往復を続ける。上限超過の後は往復ごとに `record-attempt` が再び exit 3 を返すので、そのたびに人に確かめてから続ける。

## findings の引き継ぎ

次フェーズのサブエージェントをディスパッチする際、前フェーズの `EvaluationResult.findings` のうち
残っているもの(severity: info 含む)を `ruleId` + `message` の短い箇条書きで渡す。
これにより、たとえば design フェーズで指摘された懸念を implement フェーズの実装の委譲先が
無視せず踏まえられる。findings の全文(evidence.excerpt 等)は転記しない
(`casePath` を渡し、必要なら読みに行かせる)。

裁定 B(as-is 承認)で通過したフェーズの findings は、次フェーズの実行者に「承認済みだが未解消の指摘」として必ず渡す。

