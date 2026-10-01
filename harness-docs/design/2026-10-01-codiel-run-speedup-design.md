# Codiel の run を速くする 設計書

## 1. 確定済みの決定(この設計の前提)

ユーザーとの合意(2026-10-01)で次を決めた。実装の判断で覆さない。

| ID | 決定 |
| --- | --- |
| S1 | Raguel の LLM パネル(adversarial・steelman・crosscheck・meta)を廃止する。`claude -p` と `codex exec` の子プロセス起動を撤去する |
| S2 | パネルの代わりに、Jev が使える環境では Jev が成果物の内容を判定する。使えない環境では内容の判定をスキップし、ルール層だけで判定する |
| S3 | ルール層の結果を Jev で補正する現行の文脈判定(`contextJudge`)は残す。決定論の引き下げ規則(`.md`・テストファイル・コメント行で stop を ask に下げる。`R/rules/code/patternScan.ts:18-36`)が拾わない場所、たとえばソースコード中の文字列リテラルの `code/destructive-ops` の誤検知を、Jev が STOP から ASK に下げるためである |
| S4 | 内容判定の問いは、評価の種別(code・plan・design・decision)ごとに固定で持つ。設定で問いを足す仕組みは作らない |
| S5 | Jev は `TYPESAFE_API_KEY` があれば自動で使う。`contextJudge.enabled` は廃止する |
| S6 | codiel は Jev を推奨依存とする |
| S7 | 重さ判定(tier)を廃止する |
| S8 | 判例検索は残し、tier に関係なく毎回行う |
| S9 | オーケストレーターは agenda.md・design.md・dev-plan.md・discussion.md・intent 文書(持続層を含む)を自分で書く |
| S10 | オーケストレーターはユニットテスト・型検査・lint・ビルドなど、コマンドを実行するだけの作業を自分で行う |
| S11 | spec.md / cases.md の執筆、テストコード、実装と修正、タスクレビュー、review、E2E の実行は委譲を続ける |
| S12 | 内容判定の欠落を問う問いに、フェーズの担当範囲を渡す(手動確認の後、§10.1) |
| S13 | codiel の委譲をバックグラウンド前提に組み替える。委譲の完了待ちは state に記録し、待ちがある間は stop-guard が止めない(§10.2) |
| S14 | test-spec と dev-plan を並列に戻す。§5.3 の直列化を置き換える(§10.3) |

S1・S2 は ADR-011 の「LLM パネルを残す」決定と、設計書 `2026-09-28-raguel-redesign-design.md` §12 の不採用案(R1「ルールだけに縮める」、§6.7.1「`provider: none` をルールだけで PROCEED するモードにする」)を覆す。理由は §2 に置く。

## 2. 背景と目的

codiel の run は、フェーズの成果物ができても次の作業へ移るまでの待ちが長い。原因は 2 つある。

- Raguel のゲートがパネルの完了を待つ。パネルは `claude -p` を、standard で 2〜3 体を 2 回の待ちに分けて、critical で 4 体を 3 回の待ちに分けて起動する(`R/panel/runner.ts:76-93`。最初の 2 体だけが並列)。1 回の起動の上限は 180 秒で、失敗すると 1 回再試行する。ゲートの締切は 600 秒である。
- パネルが誤検知の ASK を多く出す。`~/.raguel` に残る 2026-09-28〜10-01 の判定 106 件(PROCEED 71・ASK 28・STOP 7、Jev はすべて無効)で、ASK を出した所見の出どころは次のとおりだった。ルール層だけの ASK は 2 件で、残りはパネルが出した。
  - `panel/crosscheck` 26 件、`panel/adversarial`・`assumption`・`precedent` 11 件
  - パネルの起動失敗とタイムアウト(`panel/*-error`)22 件
  - ルール層は `plan/irreversible-ops` 3 件(今は info に下げてあり ASK にならない)と `code/new-dependency` 2 件
  - STOP 7 件はすべて `common/secrets` で、うち 4 件は偽の鍵を使った確認の run だった
- オーケストレーターが文書の執筆とコマンドの実行まで委譲する。委譲のたびに、委譲先が文脈を読み直す時間と、報告の往復の時間がかかる。

codiel を最初に設計したとき、パネルを置いた目的は、AI の暴走を内容の水準で止めることだった。現行のモデルと Claude Code の権限機構は、その当時より精密になった。そのためユーザーは、パネルの検査力を手放しても run の速さを取ると判断した(S1)。決定論のルール層と、Jev による補正と内容判定は残る。

## 3. 前提

### 3.1 現行の Raguel の判定の流れ

出典は `plugins/codiel/raguel-mcp/src/core/pipeline.ts` である(以下 `R/` は `plugins/codiel/raguel-mcp/src/` を指す)。

1. phase と tool の組の検証(:193)と、設定の読み直し(:201)
2. 評価対象の収集(`collectTarget`、:273-356)。変更が無ければ PROCEED で終える(:390-397)
3. 前フェーズの改竄検証、ルール層、testResults の検査、再提出の検査(:399-416)
4. Jev の文脈判定(:418-455。`contextJudge.enabled` が true のときだけ)
5. 重さ判定(:458、`R/core/weight.ts`)
6. 判例検索とパネル(:463-514。ルールの stop が無く、tier が trivial でないときだけ)
7. 合成(:518、`R/core/verdict.ts:149`)
8. ケースファイルと索引の記録(:527)

### 3.2 判例検索はパネルの外でも使われている

`R/core/pipeline.ts:481-496` は、rejected・incident の判例に似ているとき `failure-match` の info 所見を出す。判例は `record_outcome` と `retire_precedent` が書き込み、`list_precedents` と検索が読む。評価に効く読み手は検索だけで、検索をやめると記録が評価に使われなくなるので、検索は残す(S8)。

### 3.3 codiel の委譲の現況

出典は `plugins/codiel/skills/orchestrating-runs/SKILL.md`(以下 `ORS`)である。

- HARD-GATE(`ORS:850-856`)は、オーケストレーターが実装・レビュー・テスト作成をせず、design.md も書かないと定める。
- 文書の執筆の委譲: discuss の agenda.md(`ORS:194`)、design の design.md(`ORS:195`)、dev-plan の dev-plan.md(`ORS:197`)、intent-sync の書き戻しと持続層への取り込み(`ORS:201, 572-593`)。
- コマンドを実行するだけの委譲: test-loop の回帰の実行(`ORS:200, 505-528`)、fix-loop の回帰(`fixing-review-findings/SKILL.md:76`)、環境の失敗の実行し直し(`ORS:425-431`)、test-spec の仕様のディレクトリの同定(読み取り 1 回、`ORS:212-219`)。
- 委譲はすべて foreground で出す(`ORS:597-600`)。test-spec と dev-plan は同じ応答で 2 件を並列に出す(`ORS:220-221`)。
- 仕様のディレクトリの ID は `units/` か `e2e/` で始まる(`writing-test-specs/SKILL.md:45`)。E2E は ID で見分けられる。

## 4. Raguel の変更

### 4.1 撤去するもの

| 撤去するもの | 所在 |
| --- | --- |
| パネルの層 | `R/panel/` の全体(runner・panelists・prompts・rubrics・schema・provider・claudeCli・codexCli)と `R/panel/**/__test__/` |
| 偽の CLI | `R/testing/fake-claude.mjs`・`fake-codex.mjs` |
| 重さ判定 | `R/core/weight.ts` とそのテスト |
| パネルの再帰防止 | `R/server.ts:32-36` の `RAGUEL_PANELIST` の分岐と、プロバイダーの組み立て(:40-46) |
| 設定キー | `judge.*`(provider・model・timeoutMs・deadlineMs・maxConcurrency・thresholds)、`panel.*`、`weight.*`、`contextJudge.enabled` |
| Jev の重さの問い | `R/context/judge.ts` の severity(score)の問いと `tierFloor` |

撤去した設定キーが `.codiel/config.json` に残っていたら、読み込みエラーにせず無視し、警告を `reasons` に 1 件残す。既存の利用者の設定ファイルで run が止まらないようにするためである。

### 4.2 Jev の内容判定

内容判定の問いは、`contextJudge` の本文の問い合わせ(現行の injection・語彙 4 ルール・再提出と同じ 1 回)に足す。候補の問い合わせ(候補があるときだけ)と本文の問い合わせを並列に送る形は変えない。リクエストの本数は現行と同じである。

問いは noul で、真である確率 p を閾値と比べる。閾値は現行の `contextJudge.thresholds`(`lower` 0.5、`raise` 0.7)を使う。

`evaluate_plan` は dev-plan と test-spec の両方に使う(`raguel-gating/SKILL.md:59-60`)。test-spec の成果物は手順ではないので、plan の問いは phase で分ける。phase を本文の問い合わせの `state` に足す(現行は渡していない。`R/core/pipeline.ts:740-760`)。表の「対象」列は kind か、kind と phase の組である。

| 対象 | ID | 問い | ASK にする条件 |
| --- | --- | --- | --- |
| code | `judge/code-omits-objective` | diff は、objective がこのフェーズに求める変更を明らかに欠いている | `p ≥ raise` |
| code | `judge/code-out-of-scope` | diff は objective の外の変更を含む | `p ≥ raise` |
| code | `judge/code-weakens-tests` | diff はテストを弱める(アサーションを緩める、skip する、期待値を実装に合わせて書き換える) | `p ≥ raise` |
| code | `judge/code-security` | diff は認証の回避・注入・秘密の露出のいずれかを持ち込む | `p ≥ raise` |
| plan(test-spec 以外) | `judge/plan-omits-objective` | 計画は、objective が求める作業を明らかに欠いている | `p ≥ raise` |
| plan(test-spec 以外) | `judge/plan-verifiable` | 各手順は、完了を確かめる方法を持つ | `p ≤ lower` |
| plan(test-spec) | `judge/spec-verifiable` | 各ケースは、判定できる期待結果を持つ | `p ≤ lower` |
| design | `judge/design-omits-objective` | 設計は、objective が明示する要件を明らかに欠いている | `p ≥ raise` |
| design | `judge/design-contradiction` | 設計は互いに矛盾する決定を含む | `p ≥ raise` |
| design | `judge/design-unlisted-open-decision` | 設計は、実装に要る決定を未決事項として挙げないまま残している | `p ≥ raise` |
| decision | `judge/decision-contradicts-objective` | 判断は objective と矛盾する | `p ≥ raise` |

問いは較正(2026-10-01、§7)で決めた。結果は次のとおりである。

- 誤検知は、`~/.raguel` の過去の評価のうち PROCEED か approved の 52 件に当てて数えた。
- 検出力は、同じ 52 件の objective を別の run のものに差し替えた擬似欠陥に当てて数えた。

| 問い | 誤検知 | 擬似欠陥の検出 |
| --- | --- | --- |
| code-omits-objective | 0/21(p の最大 0.44) | 20/21 |
| plan-omits-objective | 0/7(最大 0.38) | 7/7 |
| design-omits-objective | 0/10(最大 0.31) | 9/10 |
| decision-contradicts-objective | 0/7(最大 0.34) | 7/7 |
| design-unlisted-open-decision | 0/10(最大 0.60) | 擬似欠陥では測れない |
| code-out-of-scope・code-weakens-tests・code-security・design-contradiction・plan-verifiable・spec-verifiable | 0 件(code-out-of-scope の最大 0.64、design-contradiction の最大 0.67) | 未測定 |

- 当初の「objective を満たす・網羅する」を `p ≤ lower` で問う 5 問は、正しい成果物 52 件のすべてで ASK になったので外した(p は 0.08〜0.48)。「未決のまま残す」は 70% が ASK になったので、未決事項として挙げていないものに絞った。
- test-spec の網羅を問う問いは、言い換えても擬似欠陥を 0/7 しか検出できなかったので置かない(ユーザー決定)。test-spec の網羅は review と人の裁定に任せる。
- 擬似欠陥は objective が丸ごと違う成果物であり、一部の要件の抜けのような小さな欠陥への検出力は測っていない。

- 問いの `instructions` は英語で書き、`state` のキーで対象を指す。成果物の中の指示に従わないことを書く(現行の §6.4.4 の規則と同じ)。
- ASK の所見の message は定型文にする。問いの日本語と p を入れる。例(本文に載せる形の一例で、値は実際の判定で置き換える): `Jev: diff は objective の外の変更を含む可能性が高い(p=0.82)`。
- p が閾値の間にあるときは所見を出さない。
- 問いの ID と p は、現行の文脈判定と同じく `07-context.json` に残す。
- 入力の上限(合計 51,200 トークン、1 値 25,600 トークン)を超えた本文の問い合わせは送らない。そのときは内容判定と本文の補正をスキップし、`contextJudge/unavailable`(info)に「入力が上限を超えた」と書く。本文を切って送らない理由は現行の §6.4.4 と同じである。

### 4.3 Jev を使うかどうか

- `TYPESAFE_API_KEY`(テストでは `deps.jevApiKey`)があれば、文脈判定と内容判定を行う。
- 鍵が無いときは両方をスキップする。`contextJudge/unavailable`(info)を 1 件残し、message に「鍵が無いため内容の判定をしていない」と書く。ASK にも degraded にもしない。
- 鍵があるのに問い合わせが失敗した(タイムアウト・応答の形の不正・入力の上限超過を含む)ときは、失敗した問い合わせの結果だけを使わない。成功した側の結果は使い、`status` を `partial` にする(現行の `R/context/judge.ts:443-450` の扱い)。本文の問い合わせが失敗すると、内容判定は行われない。どちらの失敗でも `contextJudge/unavailable`(info)に原因を書き、ASK にも degraded にもしない。再試行はしない。
- `common/secrets`・`code/protected-paths`・`casefile/tampered` が stop を出したときは、現行どおり Jev を呼ばない。
- 問い合わせの時間の上限は `contextJudge.timeoutMs`(既定 20000)だけで決める。`judge.deadlineMs` を撤去するので、締切との調整(`R/panel/provider.ts:88-97` の `launchBudget`)も撤去する。

### 4.4 判例検索

- 検索の条件から tier を外し、ルールの stop が無いときに毎回行う。
- 検索結果の使い道は `failure-match` の info だけになる。パネルへの入力は無くなる。
- `06-precedents.json` の記録は残す。

### 4.5 合成規則

`R/core/verdict.ts` の `synthesize` を、上から順に評価して最初に該当した行で確定する形に縮める。

| 順 | 条件 | verdict |
| --- | --- | --- |
| 1 | ルール層に stop がある | STOP |
| 2 | 設定の読み込みエラーか内部エラー | ASK(degraded) |
| 3 | ルール層か Jev の内容判定に ask がある | ASK |
| 4 | 上記以外 | PROCEED |

- 順 2 の内部エラーは、パイプラインが例外で止まったとき(`R/core/pipeline.ts:241-265`)だけを指す。個々のルールの例外は現行どおり `rule-error` の ask(`R/rules/registry.ts:286-309`)になり、順 3 の通常の ASK になる。
- パネル由来の手順(所見の分類、steelman の反駁、乖離、meta の軸、tier ごとの分岐)は撤去する。
- degraded になるのは順 2 だけになる。「tier が trivial でないのにパネルが無い」ことによる degraded は撤去する。
- 不変条件のテスト(`R/core/__test__/invariants.test.ts`)のうち、パネルと tier に関わるものは撤去し、上の 4 行を検査するものに置き換える。

### 4.6 応答・ケースファイル・ツールの変更

- 応答(現行設計書 §6.2.5)から、パネルと tier に由来するフィールドを外す。`contextJudge` の `enabled` は鍵の有無を表すように意味を変える。【要確認】外すフィールドの一覧は、実装計画の前に `R/core/types.ts` と `R/tools/shared.ts` を読んで確定する。
- 新しい評価では、パネルの出力ファイルと重さの記録(`02-weight.json` など)を書かない。【要確認】ファイル名の一覧は `R/casefile/store.ts:41-55` で確定する。
- 既知のファイル名の一覧(`R/casefile/store.ts:41-55`)からは、撤去したファイル名を消さない。`verifyAttempt`(:334-354)は、`verdict.json` の evidence に一覧外の名前があると改竄とみなす。消すと、変更前に通した前フェーズのケースファイルが `casefile/tampered` の stop になり、進行中の run を再開できなくなる。
- `list_rules` が返すパネル構成・閾値・configHash から、撤去したキーを外す。
- MCP ツールの名前と入力は変えない。codiel 側の呼び出しは変わらない。

### 4.7 設定の既定値

| キー | 既定 | 備考 |
| --- | --- | --- |
| `contextJudge.model` | なし(SDK の既定) | 変更なし |
| `contextJudge.timeoutMs` | 20000 | `judge.deadlineMs` との検証を外す |
| `contextJudge.thresholds.lower` / `raise` | 0.5 / 0.7 | 内容判定にも使う |
| `precedent.*` | 現行どおり | 変更なし |

## 5. codiel の変更

### 5.1 オーケストレーターが自分で行う作業

| フェーズ | 作業 | 使うスキル |
| --- | --- | --- |
| discuss | agenda.md の作成と、論点追加時の書き足し | preparing-design-agendas(オーケストレーターが読む) |
| discuss | discussion.md への合意の記録 | facilitating-design-discussions(現行どおり) |
| design | design.md の執筆と、ウォークスルーでの修正 | writing-design-docs |
| test-spec | 仕様のディレクトリの同定 | なし |
| dev-plan | dev-plan.md の執筆 | writing-dev-plans |
| intent / intent-sync | intent 文書の執筆、派生文セクションと変更履歴への反映、持続層への取り込み | capturing-intent・syncing-intents |
| test-loop・fix-loop | プロジェクトの test コマンドと、ID が `units/` で始まる仕様のディレクトリのテストの実行 | running-regression-tests |
| implement | グループのマージの後の通すテストのうち、プロジェクトの test コマンドと `units/` のテストの実行(現行どおり) | なし |
| 共通 | 自分で実行したテストの、環境の失敗の実行し直し | なし |

- 自分で実行するテストは、run ブランチ上で直列に実行する。`ORS` 2.6 の並列可・単独の規則は委譲にだけ当て、自分の実行には当てない。ただし、動いている E2E の委譲があるときは `parallel: true` のものだけを実行する(現行の `ORS:421-423` と同じ)。
- プロジェクトの test コマンドは、中身が E2E を起動するかを問わず、そのままオーケストレーターが実行する。test コマンドの中身は Codiel から分けられないためである。`e2e/` の仕様のディレクトリと実行が重なることは許す。
- スキルの改訂は、実行者を示す記述(description と、誰が書くか・誰が実行するかを述べる文)に限る。手順・規律・出力の形は変えない。
- test-loop の `test-run-<n>.md` は、自分の実行結果と E2E の委譲の返答を合わせて書く。
- 文書系フェーズのコミットは現行どおり、ゲートの通過の直後にオーケストレーターが行う(`ORS:236-246`)。

### 5.2 委譲を続ける作業

- test-spec の spec.md / cases.md の執筆(writing-test-specs)
- test-code のテストコード作成とタスクレビュー
- implement の実装・タスクレビュー・修正ラウンド・マージ後の修正
- test-loop と fix-loop の修正
- review と fix-loop の再レビュー
- ID が `e2e/` で始まる仕様のディレクトリの実行と、その環境の失敗の実行し直し(2.6 の並列可・単独の規則はそのまま当てる)。implement では、グループのマージの後に通すテストを実行する。そこに E2E が含まれるときも、オーケストレーターは E2E を自分で実行せず委譲する

### 5.3 test-spec と dev-plan の並び

このセクションの直列化は、§10.3(S14)で並列に置き換えた。経緯として残す。

現行は 2 件の委譲を同じ応答から foreground で並列に出す(`ORS:220-221`)。dev-plan をオーケストレーターが書くと、並列にするには spec の委譲を background で出すしかない。background の委譲の完了を待ってターンを終えると、stop-guard の hook(`plugins/codiel/src/hooks/stop-guard.ts:44-68`)が止めて foreground で出し直すよう促す。foreground に限った理由は codiel 設計書 `2026-09-27-codiel-intent-driven-design.md:1995-1999` にある。そこで並列をやめ、次の順に直列で行う。

1. 仕様のディレクトリを自分で同定する。
2. dev-plan.md を自分で書き、`evaluate_plan` でゲートする。
3. spec.md / cases.md の委譲を foreground で出し、返ったら spec の `evaluate_plan` でゲートする。

`ORS:597-600` の「委譲はすべて foreground で出す」は変えない。

### 5.4 HARD-GATE と委譲先の旧称

- `ORS:850-856` の HARD-GATE を次の内容に書き直す。
  - オーケストレーターは、コード(テストコードを含む)・spec.md / cases.md・レビューの所見を自分で書かない。
  - オーケストレーターは、§5.1 の文書を自分で書き、§5.1 のコマンドを自分で実行する。
- `ORS:600` の「委譲先は名指しせず、作業内容を渡して委譲する」と食い違う旧称を、作業内容の表現に直す。対象は次のとおり。
  - architect: `facilitating-design-discussions/SKILL.md:11,24,31,58,62,68,77`、`writing-design-docs/SKILL.md:114,132`、`preparing-design-agendas/SKILL.md:111`。§5.1 で自分が書く文書になったので、「オーケストレーター」に直す。
  - implementer・reviewer・tester: `fixing-review-findings/SKILL.md:50,62,66,73,78,80,111,129,137`、`implementing/SKILL.md:119,129,145`、`writing-dev-plans/SKILL.md:19-20,167`、`ORS:731,759`。書き換え先は作業内容で表す(本文に載せる語の一例で、閉じた列挙ではない: 「実装の委譲先」「レビューの委譲先」「テストコードを書く委譲先」)。役割名もモデル名も書かない。
- `fixing-review-findings/SKILL.md:10` の「[8] fix-loop」と `filing-followup-issues/SKILL.md:10` の「[9] triage」の旧番号を、`ORS:182-187` の現行の番号に直す。

### 5.5 raguel-gating スキルと利用者向けの案内

- `raguel-gating/SKILL.md:39` の crosscheck への言及を外す。
- ゲートの応答から外れるフィールド(§4.6)を読んでいる箇所を直す。
- `/codiel:init`(initializing-harness)は、`TYPESAFE_API_KEY` が無いとき、Raguel が内容を判定しないことを伝え、鍵の設定方法を案内する。設定の有無で初期化を止めない。
- `plugins/codiel/README.md:195-229` を、Jev を推奨依存とし、鍵が無いときはルールだけで判定する書き方に改める。codex のパネルで成果物が OpenAI に送られるという記述は外す。パネルを前提とした所要時間と、120 秒後に background へ移す案内(:227-229)も、Jev の既定の上限 20 秒に合わせて直す。

## 6. 記録と付随する作業

- ADR-012 `[codiel] Raguel の LLM パネルを廃止し、Jev を推奨依存として内容を判定する` を足した(2026-10-01)。ADR-011 のうちパネルに関わる部分を置き換える。
- §5 の委譲の線引きは ADR にしない。オーケストレーターが文書を書き、作業を選んで委譲する考え方は agent-policy などで既に採っており、codiel をそれに合わせるだけで新しい決定ではないため(ユーザー決定)。
- codiel のバージョンは 1.0.0-dev のまま上げない。raguel-mcp だけを 0.0.2-dev から 1.0.0-dev に上げる(ユーザー決定)。
- ルートの `README.md` の codiel の説明を改める。
- `.serena/memories/` のうち、Raguel のパネルと codiel の委譲に触れるものを更新する。
- `plugins/codiel/raguel-mcp/docs/DESIGN.md` は旧文書の疑いがある。パネルの記述が残っていれば、現行設計書への参照に置き換える。

## 7. テスト方針

- 撤去するテスト: `R/panel/**/__test__/`、`R/core/__test__/weight.test.ts`、`R/context/__test__/judge.test.ts` のうち severity と tierFloor を扱うもの。
- 直す共通の基盤: `R/tools/__test__/helpers/harness.ts:22,114-154` はパネルの `FakeJudgeProvider` を作り、`R/tools/__test__/tools.test.ts:15` と `R/core/__test__/pipeline.golden.test.ts:13-14` はパネルのプロバイダーを import する。パネルを撤去する前に、これらを Jev の差し替え(`PipelineDeps.jevCall`)だけで動く形に直す。
- 足すテスト:
  - `R/context/__test__/judge.test.ts`: 内容判定の問いが kind と phase ごとに本文の問い合わせへ入ること(test-spec では spec の問いになること)、閾値の両側と間で所見の有無が決まること、上限超過でスキップすること。
  - `R/context/__test__/judge.test.ts`: 候補の問い合わせが成功して本文が失敗したとき、候補の補正を残して `partial` になり、内容判定の所見が出ないこと。逆の組み合わせも確かめる。
  - `R/core/__test__/verdict.test.ts`: §4.5 の 4 行と、`rule-error` が通常の ASK になること。
  - `R/core/__test__/pipeline.golden.test.ts`: 鍵ありで内容判定の ask が ASK になること、鍵なしでルールだけで PROCEED になること、Jev の失敗で ASK にも degraded にもならないこと。
  - `R/core/__test__/pipeline.golden.test.ts` か `R/casefile/__test__/`: 変更前の形のケースファイル(`02-weight.json` とパネルの証拠を含む)を前フェーズに置き、後続の評価が `casefile/tampered` にならないこと。
  - `R/config/__test__/loader.test.ts`: 撤去したキーを無視して警告を残すこと。
- 内容判定の較正: Jev の内容判定は ASK を足す向きにしか効かず、問いに crosscheck と同じ性質のもの(objective を満たすか、矛盾が無いか)を含む。§2 の crosscheck の 26 件と同じ誤検知が、Jev の側で再発しうる。実装の後、手動確認の前に次を行う。
  1. `~/.raguel` のケースファイルのうち、PROCEED になった評価と、人が approved と裁定した評価の成果物(`submission.txt`)を集める。
  2. 各成果物に、その kind と phase の問いを当てる。
  3. 問いごとに、ASK になった割合を測る。
  4. 割合が 10% を超える問いは、閾値を問いごとに変えるか、問いを外す。変えた閾値と外した問いは、この設計書の §4.2 に書き戻す。
- codiel 側はスキルの文書の変更なので、vitest の対象は無い。手動確認は、1 回の run で次を確かめる。
  - design・dev-plan・intent-sync をオーケストレーターが書く。
  - test-spec で dev-plan のゲートの後に spec の委譲を foreground で出す。
  - implement のマージの後と test-loop で、`units/` と test コマンドを自分で、`e2e/` を委譲で実行する。
  - Raguel の変更前に通したフェーズがある run を、変更後に再開して後続のゲートを通せる。
- 速さの確認として、変更前後で同じ intent の run のゲート 1 回あたりの所要時間を比べる。【要確認】比べる run の選び方は実装計画で決める。

## 8. 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| ルール層の Jev の補正をやめる | 引き下げ規則の外(ソースコード中の文字列リテラルなど)にある `code/destructive-ops` の誤検知が、ASK でなく STOP のまま残る(ユーザー決定、S3)。補正は ASK を減らさないので、補正の有無で ASK の件数は増えない |
| `code/destructive-ops` を ask に下げて Jev を外す | 実際に危険な操作でも毎回人の裁定が要る。補正のリクエストは内容判定と同じ時間に並列で終わるので、外しても速くならない |
| 内容判定の問いを設定で足せるようにする | 設定キーと検証が増える(ユーザー決定、S4) |
| `contextJudge.enabled` を残す | 推奨依存の扱いに合わず、鍵を設定しても有効化を忘れると内容判定が黙って無くなる(ユーザー決定、S5) |
| spec.md / cases.md もオーケストレーターが書く | テスト仕様は委譲を続ける(ユーザー決定、S11) |
| パネルを 1 体に減らして残す | 1 体でも `claude -p` の起動と応答の待ちが残り、Jev の 1 リクエストより遅い |
| spec の委譲を background で出し、dev-plan の執筆と並列にする | 完了待ちでターンを終えると stop-guard が止める(`plugins/codiel/src/hooks/stop-guard.ts:44-68`)。hook を直すと全 run の挙動が変わる |
| test-spec のゲートで内容判定をしない | test-spec はテストの網羅を見る唯一のゲートで、問いを phase で分ければ判定できる |
| 既知のケースファイル名から撤去したものを消す | 変更前のケースファイルが改竄扱いになり、進行中の run を再開できない |

## 9. 未決事項

未決事項は、実装計画書 `harness-docs/plans/2026-10-01-codiel-run-speedup-plan.md` の「細目の決定」と Task 7 で決めた。

## 10. 追補: 手動確認の後の変更(2026-10-01)

手動確認(計画書 Task 7。検証用リポジトリ `~/codiel-speedup`、slug `add-reverse-function`)で 2 つの問題が見つかった。どちらもユーザーの判断で、この設計の範囲で直す。

- 内容判定が、ほかのフェーズの担当を欠落と判定した。dev-plan の `judge/plan-omits-objective`(p=0.84)と implement の `judge/code-omits-objective`(p=0.94)で、どちらも人が「修正して再提出」と裁定した。objective は intent 全体の目的(「テストも書く」)で、テストを書くのは test-spec と test-code の担当である。
- 委譲がすべてバックグラウンドで起動した。完了待ちでターンを終えるたびに stop-guard が止め、オーケストレーターが `mark-ask` と `resume` を往復した。

### 10.1 内容判定に担当範囲を渡す(S12)

- 本文の問い合わせの `state` に `phaseScope`(フェーズごとの固定の英文)を足す。値は次のとおりにする。

| phase | phaseScope |
| --- | --- |
| intent | This phase records the intent of the whole change. |
| design | This phase designs the whole change. |
| dev-plan | This phase plans the implementation steps of product code. Test specifications and test code are produced in the separate test-spec and test-code phases, not in this plan. |
| test-spec | This phase writes test specifications only. |
| test-code | This phase writes test code only. Product code is written later in the implement phase. |
| implement | This phase writes product code only. Test specifications and test code were already written in the earlier test-spec and test-code phases. |
| test-loop | This phase only fixes failures found by running the existing tests; the diff may be small or empty. |
| fix-loop | This phase only fixes review findings; the diff may be small. |
| intent-sync | This phase writes the agreed changes back to the intent documents. |

- `code-omits-objective`・`plan-omits-objective`・`design-omits-objective` の instructions の先頭に「Considering only the work that state.phaseScope assigns to this phase,」を、末尾(GUARD の前)に「Work assigned to other phases is not an omission.」を足す。ID・向き・閾値・問いの日本語は変えない。足す 2 文は `CONTENT` の instructions の定数そのものに書き、GUARD は今のとおり組み立て時に末尾へ付ける。
- 較正(2026-10-01)の結果は次のとおりである。

| 組 | code-omits | plan-omits | design-omits |
| --- | --- | --- | --- |
| 手動確認の誤検知 | 0.94 → 0.25 | 0.84 → 0.24 | — |
| 正しい成果物の誤検知 | 0/21(最大 0.35) | 0/7(最大 0.31) | 0/10(最大 0.27) |
| 擬似欠陥の検出 | 20/21 | 6/7(漏れは p=0.69) | 9/10 |

### 10.2 委譲をバックグラウンド前提にする(S13)

前提となる Claude Code の挙動は次のとおりである(公式ドキュメント「sub-agents」「hooks」と、このセッションと手動確認での観察)。

- 対話セッションでは、Agent ツールの委譲は常にバックグラウンドで起動する。foreground を強制できるのは、全セッションに効く環境変数 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` だけである。
- 委譲の完了は、後のターンに自動のイベントとして届き、ターンを起こす。
- Stop hook の入力に、実行中の委譲を示すフィールドは無い。
- セッションを終えたときに実行中の委譲がどうなるかは文書に無い。失われるものとして扱う。

#### 10.2.1 待ちの記録

- `RunState` に任意のフィールド `waits?: Wait[]` を足す。`version` は 2 のまま据え置く(`domain` などと同じ扱い)。`Wait` は `{ id: string; purpose: string; phase: string; startedAt: string; taskId?: string }` とする。`taskId` は Agent ツールが返す委譲の ID で、run を止めるときに委譲を止めるのに使う。
- 待ちごとに、返答を書く報告のファイル `.codiel/runs/<slug>/try-<n>/waits/<id>.md` を 1 つ持つ。完了通知を受けたら、オーケストレーターは返答の本文を要約せずにこのファイルへ書く。既存の報告の置き場(`report.md`・`test-run-<n>.md`・`review-<m>.md` など)への転記は、今のとおりその後で行う。報告の置き場を持たなかった委譲(test-spec、タスクレビュー、観点ごとの review、E2E)も、このファイルで完了を判定できる。
- `codiel-state` に 3 つのサブコマンドを足す。

| サブコマンド | 動作 |
| --- | --- |
| `wait-add --slug <slug> --id <id> --purpose <文> [--task-id <ID>]` | `waits` に 1 件足す。`phase` は `state.phase`、`startedAt` は現在時刻。同じ `id` の待ちが残っているとき、または `waits/<id>.md` が既にあるときは失敗する(`id` は try の中で使い回さない)。run が終端の状態なら失敗する |
| `wait-done --slug <slug> --id <id>` | その `id` を取り除く。無いとき、または `waits/<id>.md` が無いときは失敗する(報告を書いてから消す順序を機械で守る) |
| `wait-clear --slug <slug>` | `waits` を空にし、消した待ちの一覧を出力する。状態を問わず通す(`clear-domain` と同じ) |

- `stop` は、`waits` が 1 件以上あるとき失敗する。`--abandon-waits` を付けたときだけ、`waits` を空にして止める。
- `codiel-state` の呼び出しは、`wait-add` を含めて並列にせず 1 つずつ行う。state の読み書きにロックが無く、並列に呼ぶと更新が失われるためである。
- 待ちは委譲 1 件につき 1 件記録する。仕様のディレクトリが 2 つあって spec の委譲を 2 件出すなら、`wait-add` も 2 回呼ぶ。
- `purpose` は、再開時に人とオーケストレーターが読む 1 文で、何の委譲かを書く(例: 「units/src/reverse の spec.md と cases.md を書く」。本文に載せる例で、閉じた列挙ではない)。
- `id` はオーケストレーターが委譲ごとに付け、try の中で一意にする。形は `<フェーズ>-<要素>-<回>`(例: `test-spec-units-src-reverse-1`、`step-1-impl-2`、`review-1-security-1`。本文に載せる例で、閉じた列挙ではない)。修正ラウンド・回帰の巡・実行し直しは、回を上げて別の待ちにする。

#### 10.2.2 stop-guard

- status が `active` で `waits` が 1 件以上あるときは、止めずに通す(何も出力しない)。
- `waits` が空のときは、今の分岐のとおりに止める。`in_progress` の分岐の末尾の文「委譲を foreground で出し直して報告を受け取ること」は、「委譲の完了を待つなら、`codiel-state wait-add` で待ちを記録してから停止すること」に置き換える。
- 待ちの記録を消し忘れると、その run では止まらなくなる。再開の手順(§10.2.4)で必ず `wait-clear` するので、影響はそのセッションの中に限られる。

#### 10.2.3 委譲の規律

`orchestrating-runs` の §3 の「委譲はすべて foreground で出す」を、次の規律に置き換える。

- 委譲は Agent ツールで出し、バックグラウンドで動くものとして扱う。
- Agent ツールの結果で起動を確かめてから、`wait-add` で待ちを記録する(`--task-id` に返った ID を渡す)。起動に失敗した委譲は記録しない。並列に出すものは同じ応答からまとめて出し、記録は 1 件ずつ順に行う。
- `evaluate_*` が長引いてバックグラウンドへ移ったときも、`gate-<フェーズ>-<回>` の id で `wait-add` し、結果を `waits/<id>.md` に書いてから `wait-done` する。
- 待つ間にできる作業(自分が書く文書・自分が実行するテスト)があれば進め、無ければターンを終えて完了通知を待つ。
- 完了通知を受けたら、返答の本文を `waits/<id>.md` と既存の報告の置き場へ書く。その後で `wait-done` で待ちを消し、次の委譲やゲートへ進む。今の「返答を受けた直後に、state の更新や次の委譲より先に本文を書く」の順序を保つためである。
- run が無いときの委譲(capturing-intent の現状調査、`/codiel:test` の単独実行)には待ちの記録を使わない。stop-guard も run が無ければ止めない。
- 2.6 の「並列可・単独」の規則は、「動いている委譲」を「待ちの記録が残っている委譲」と読み替えてそのまま使う。単独の委譲は、待ちが空のときだけ出す。
- `set-domain` を伴う委譲(メインの作業ツリーで動く単独の委譲)の待ちが残っている間は、メインの作業ツリーで動くほかの委譲を出さない。`domain` は 1 値しか持てないためである。worktree の中で動く委譲には当てない。
- `reviewing-diffs` の「レビュー担当がさらに委譲するときも foreground で出す」は削除する。サブエージェントは Agent ツールを使わない(セッションの規律)ためである。

#### 10.2.4 中断後の再開

- `orchestrating-runs` の §6(再開手順)に、次を足す。
  1. `waits` に残っている待ちを読む。前のセッションの委譲は失われたものとして扱う。
  2. 待ちごとに、`waits/<id>.md` が `startedAt` より後に書かれているかを確かめる。書かれていれば、その返答を受け取り済みとして既存の報告の置き場への転記を済ませる。書かれていなければ、委譲を出し直す(新しい回の id で記録する)。古い報告のファイルや成果が残っていても、`waits/<id>.md` が無い委譲の成果としては使わない。
  3. worktree の中の委譲を出し直すときは、2.5 の規則どおり、残っている worktree とそのブランチを削除し、新しい HEAD で作り直す。
  4. 確かめ終えたら `wait-clear` で残りを消す。

#### 10.2.5 run を止めるとき

- 人が中止を選んだとき、`intent-updated` で止めるとき、別の try を始めるときは、`waits` に残っている委譲を先に片付ける。`taskId` がある委譲は `TaskStop` で止め、無いものは完了通知を待つ。
- 片付けた後に `stop` を呼ぶ。委譲を止められず、完了も待てない事情があるときだけ、人に確かめてから `--abandon-waits` を付ける。
- worktree とブランチの削除は、`waits` が空になってから行う。委譲が止まる前に、書き込み中の worktree を消さないためである。

### 10.3 test-spec と dev-plan を並列に戻す(S14)

§5.3 の 3 ステップの直列を、次の順に置き換える。

1. オーケストレーターが仕様のディレクトリを同定する(§5.1)。
2. spec.md / cases.md の委譲を出し、`wait-add` する。
3. 委譲の完了を待つ間に、dev-plan.md を書き、`evaluate_plan` でゲートする。
4. 委譲の完了通知を受けたら、報告を書いて `wait-done` し、spec の `evaluate_plan` でゲートする。

- 2 つのゲートの判定は互いに独立である。dev-plan が ASK・STOP でも spec の委譲は止めず、完了したら spec のゲートまで進める。
- dev-plan が ASK・STOP になっても、spec の委譲の待ちが残っている間は `mark-ask` を呼ばない。`mark-ask` は run を `awaiting_human` にし、その間は guard-write の境界が外れるためである。spec のゲートの結果が出てから、2 つのゲートの結果をまとめて人に示す。
- 2 つとも ASK・STOP なら、両方に `mark-ask` し、両方の裁定を `record_outcome` で記録してから `resume` する。`resume` は awaiting_human のフェーズを一括で戻すので、片方の裁定だけで呼ばない。
- 次のステージ(test-code)へ進めるのは、今のステージの規則どおり、dev-plan と test-spec の両方が passed になってからである。
- 再開の分岐は、次の順に決める。裁定待ちの ASK・STOP があれば、先に人の裁定を受ける(STOP の後に再評価しない現行の規則を保つ)。そのうえで、dev-plan が passed でなく裁定待ちでもなければ dev-plan を書いてゲートする。test-spec は §10.2.4 の待ちの扱いで、受け取り済みならゲートし、そうでなければ spec の委譲を出し直す。
- §8 の不採用案「spec の委譲を background で出し、dev-plan の執筆と並列にする」は、委譲が常にバックグラウンドになったことと、§10.2.2 で stop-guard が待ちの間は止めなくなったことにより、採用に変わる。

### 10.4 変更の範囲

- 実装: `plugins/codiel/src/codiel-state.ts`(`waits`、3 サブコマンド、`stop` の `--abandon-waits`)、`plugins/codiel/src/hooks/stop-guard.ts`、`plugins/codiel/raguel-mcp/src/context/judge.ts`(`phaseScope` と 3 問の instructions)。
- スキル: `orchestrating-runs`(§3、2.1、2.6、2.8、2.9、test-spec の行と手順、§6 の再開、4.1、HARD-GATE の周辺、run を止める手順)、`raguel-gating`(:90 の evaluate のバックグラウンド化、:137-143・:158-180 の裁定と resume、:113-115・:182-183 の stop)、`reviewing-diffs:140-141`、`writing-test-specs:87`、`writing-dev-plans`、`raguel-gating:86`、`running-regression-tests`、`implementing:48`、`scripting-tests:16`。
- 文書: `plugins/codiel/docs/DESIGN.md`(:83-95、:93、:247、:440-445、:588)、`docs/skill-flowcharts.md:593`、`references/e2e-report-format.md:29, 86`、`README.md:55, 68, 84`、ルートの `README.md` の codiel のセクション。
- テスト: `src/__test__/codiel-state.test.ts`(3 サブコマンドと互換)、`src/hooks/__test__/stop-guard.test.ts`(:274 の foreground の文言のテストを置き換え、待ちがあると通すケースを足す)、`raguel-mcp/src/context/__test__/judge.test.ts`(`phaseScope` が state に入ること)。

### 10.5 テスト方針

- `codiel-state`: `wait-add`・`wait-done`・`wait-clear` の成功と失敗(残っている同じ id、`waits/<id>.md` が既にある id、無い id、報告の無い `wait-done`、終端の run)。`stop` が `waits` の残りで失敗し、`--abandon-waits` で通ること。`waits` を持たない既存の state を読めること。
- stop-guard: `waits` が 1 件以上なら何も出さない。空なら今の分岐のとおり止め、`in_progress` の案内に `wait-add` が入る。`awaiting_human` と `stop_hook_active` の扱いは変えない。
- judge: 本文の問い合わせの `state` に、9 つの phase のそれぞれで対応する `phaseScope` が入ること。3 問の instructions に「Work assigned to other phases is not an omission.」が入ること。入力の上限の近くで、`phaseScope` を足した分だけ上限を超えた本文は送らず、従来どおり `contextJudge/unavailable` になること。
- 手動確認: 新しいセッションで run を 1 本通し、次を確かめる。stop-guard による止めと `mark-ask`・`resume` の往復が起きないこと。test-spec の委譲の間に dev-plan を書いてゲートすること。内容判定の誤検知が出ないこと。途中でセッションを終えて再開し、`wait-clear` と委譲の出し直しが行われること。

### 10.6 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` で foreground を強制する | 全セッションに効き、利用者の環境変数に依存する。待ちの間に dev-plan を書ける利点も失う |
| stop-guard が transcript_path を読み、完了通知の届いていない委譲を探す | トランスクリプトの形は公開されておらず、Claude Code の更新で壊れうる(ユーザー決定) |
| `in_progress` のフェーズでは止めない | 委譲もせずに途中でターンを終えたときも黙って止まり、run が停滞する(ユーザー決定) |
| 待ちに期限を設けて古いものを無視する | 実装の委譲は長くかかることがあり、期限を決める根拠が無い。再開時の `wait-clear` で足りる |
| 既存の報告のファイル(`report.md` など)の有無で、待ちの完了を判定する | 修正ラウンド・回帰の巡・実行し直しは同じ報告のファイルを書き直すので、前の回の報告が残り、中断した委譲を完了と見誤る。test-spec・タスクレビュー・観点ごとの review は報告のファイルを持たない |
| state の読み書きにロックを入れる | 呼び出しを 1 つずつ行う規律で足り、全サブコマンドの書き込みの経路を変える費用に見合わない |
