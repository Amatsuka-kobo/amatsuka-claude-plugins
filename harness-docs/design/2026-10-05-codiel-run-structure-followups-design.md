# codiel の run の構造に関わる残りの改修 設計書

- 日付: 2026-10-05
- 対象: plugins/codiel(raguel-mcp を含む)
- 引き継ぎ書: `harness-docs/handover/2026-10-03-codiel-run-structure-followups-handover.md`
- 前提の ADR: ADR-003・ADR-006・ADR-008・ADR-009・ADR-011・ADR-013
- バージョンは上げない。codiel 1.0.0 のリリースに含める。

## 0. 決まったこと

引き継ぎ書の「決まったこと」に加え、このセッションでユーザーと次を決めた。再検討しない。

| 番号 | 改修 | 決定 |
| --- | --- | --- |
| D1 | 1 | run のブランチは slug ごとに 1 本(`codiel/<slug>`)にする。新しい try は同じブランチで前の try の続きから進め、状態を戻さない。直す必要があれば直す |
| D2 | 1 | 前の try から引き継いだコードは、新しいゲート付き code フェーズ `carry-over` で評価する。`carry-over` は intent の直後のステージに置く |
| D3 | 2 | incident の GOTCHAS 候補は手元の記録に未写しの候補として残す。次の `intents` の run の intent-sync が、他の slug の incident 候補も集めて持続層へ写す |
| D4 | 3 | `knowledgeTarget` は、ARCHITECTURE があり、かつ metatron の rules ディレクトリがあるときだけ `metatron` にする。それ以外は `intents` にする |
| D5 | 4 | 依頼文テンプレートの「ドメインマップ」の行(JSON の全文)を消し、担当タグの glob 配列を「担当範囲」の行で渡す |
| D6 | 5 | review の観点の委譲先はテストも型検査も実行しない。オーケストレーターが用意した結果を入力に渡す。`test-run` に実行時の HEAD を記録する |

改修 4 の前提(metatron の SubagentStart の注入)はコミット `4da64cc` で入っている。注入は予算(既定 9,000 文字、上限 10,000 文字)を超えると ARCHITECTURE を見出しと各セクションの最初の文に縮め、ドメインマップの JSON を落とす。`injection.enabled=false` と metatron の無いプロジェクトでは何も届かない。このため行を消すだけにせず、D5 で置き換える。

## 1. 改修 1: run のブランチを 1 本にし、引き継いだコードを carry-over で評価する

### 1.1 困っていたこと

新しい try はベースブランチから新しいブランチを切るので、stop した try のブランチに載ったコミットは次の try にもベースにも届かない。intent-sync で GOTCHAS 候補を領域ファイルへ写してコミットし、手元の記録に `写し先` の行を付けた後に review で STOP すると、写しは前の try のブランチに取り残される。次の try の intent-sync は `写し先` の行のある候補を写さないので、候補が消える(`gotcha-candidates.md:28`・`:35`)。

### 1.2 ブランチとベースブランチ

- `codiel-state init` が作る `branch` は `codiel/<slug>` とする(`--intent-only` では従来どおり `null`)。`codiel-state.ts:876`
- `init` は、try-2 以降で `--base-branch` が渡されないとき、最新の try の state の `baseBranch` を引き継ぐ。try-2 以降で最新の try の `baseBranch` と違う値が渡されたときは失敗させる。
- `raguelRunId`(`<slug>-try-<n>`)、`.codiel/runs/<slug>/try-<n>/`、コミットの件名の `(<slug> try-<n>)`、E2E のレポートのディレクトリは try ごとのまま変えない。
- worktree のブランチ `codiel/<slug>-try-<n>-<名前>` は変えない。`codiel/<slug>` と ref 名が衝突しない(`codiel/<slug>/…` の形ではない)。
- `capturing-intent` の手順 1 は、ベースブランチの解決(既存の順)と「開始時のブランチ」を分ける。
  - ベースブランチ: 従来の解決順で決める。try-2 以降は最新の try の state の `baseBranch` になる。`init` の `--base-branch` にはこの値を渡す。
  - 開始時のブランチ(intent を書くブランチ): `git rev-parse --verify --quiet refs/heads/codiel/<slug>` が成功すれば `codiel/<slug>` へ `git switch` し、`git pull` はしない。失敗すれば従来どおりベースブランチへ切り替えて `git pull --ff-only` する。
  - ブランチ `codiel/<slug>` が無いのは、初めての run、前の try が `--intent-only`、利用者が消した、改修の前に作った run(名前が `-try-<n>` 付き)のときである。
- 手順 5 の (6) は、開始時のブランチが `codiel/<slug>` ならそのままコミットし、`git switch -c` を行わない。
- ベースの更新を run ブランチへ取り込むかは利用者に任せる。

### 1.3 carry-over フェーズ

- `STAGES` の `["intent"]` の直後に `["carry-over"]` を置く。ステージは 14 になり、discuss 以降の添字が 1 つずつ増える。
- `GATED` と `CODE_PHASES`(`raguel-records.ts:18`)に `carry-over` を足す。pass-gate の検査 8(評価の起点が `startHead` と一致し、`paths` で絞っていない)がそのまま効く。
- `start-phase carry-over` は `startHead` に `git merge-base <baseBranch> HEAD` を記録する。`baseBranch` が state に無いときと、`merge-base` が失敗したときは失敗させる。
- `start-phase carry-over` では `continuityProblem` を当てない。起点が分岐点なので、intent の評価の後のコミットも差分に入って評価される。
- carry-over の後の code 系フェーズ(test-code)の連続性検査は、最も近いゲート付きステージ(test-spec・dev-plan)と照らすので、carry-over の `passedHead` は参照されない。discuss と design は code 系フェーズでないので連続性検査を受けない。
- `init` は、作る try の番号が 1 のとき、carry-over を `status: "passed"`・`verdict: "SKIPPED"`・`note: "try-1"` にする。`SKIPPABLE` には足さず、`skip-phase carry-over` は従来どおり拒否する。
- try-2 以降では、引き継いだコードが無くても carry-over を進める(差分が intent だけでも評価する)。
- 改修の前に作られた version 2 の state(`phases` に `carry-over` が無い)は、読み込み時に carry-over を `passed`・`SKIPPED`・`note: "carry-over の導入前の run"` として補う。`isLegacy` の条件は変えない。
- guard-write の `CODE_PHASES` に carry-over を足す(修正の委譲の書き込みを通す)。`TEST_GUARD_PHASES` には足さない。

オーケストレーターの手順は新しい手順ファイル `orchestrating-runs/references/phase-carry-over.md` に置く。

1. `start-phase carry-over` の直後にこのファイルを読む。
2. `raguel-gating` の対応表に従い、`evaluate_code`(`phase: carry-over`、`baseRef` は carry-over の `startHead`)を呼ぶ。
3. PROCEED なら `pass-gate` する。返った findings は、design(軽量では dev-plan)の入力と依頼文の「前フェーズの申し送り」にする。
4. ASK なら `raguel-gating` の手順で人に確かめる。選択肢は「承認して続ける(findings を後のフェーズへ申し送る)」「修正して再提出」「stop」とする。
5. STOP は、誤検知の裁定なら `raguel-gating` の手順で通す。妥当の裁定なら「修正して再提出」と「stop」を人に選ばせる。carry-over では、妥当の STOP の後も修正して再評価できる(ほかのフェーズとの違い)。
6. 修正して再提出するときは、所見を直す委譲(実装の委譲、`implementing` の修正モード)を run ブランチ上で出し、委譲先にコミットさせてから `evaluate_code` をやり直す。`startHead` は変えない。
7. carry-over ではテストと `<testsDir>/**` の仕様を書き換えさせない。

### 1.4 test-code の Red 判定

carry-over が SKIPPED でない try では、引き継いだ実装で既に通るケースがありうる。

- `scripting-tests` の Red の判定: 実行モードの前提に「引き継いだ実装あり」と書かれた委譲では、追加・変更したケースが実装の前に通っても、cases.md の誤りとして報告しない。「引き継いだ実装で通る」としてケース ID を報告する。
- `phase-test-code.md`: carry-over が SKIPPED でない try では、依頼文の前提にその旨を書く。「引き継いだ実装で通る」の報告はマージを止めず、`report.md` に一覧する。Raguel へ渡す説明の「実装の前に失敗する」は「実装の前に失敗するか、引き継いだ実装で通る」に直す。

### 1.5 PR

- 同じブランチの PR が `OPEN` なら作り直さず、`gh pr edit <url> --title <タイトル> --body-file <本文ファイル>` で今の try の本文に更新してから `--pr-url` に使う。
- `CLOSED` か `MERGED` なら、`gh pr create` で新しく作る。

### 1.6 Raguel

- `raguel-mcp/src/codiel/phases.ts` の `GatedPhase` と `GATED_PHASES` に `{ phase: "carry-over", stage: 1, kind: "code", tool: "evaluate_code" }` を足し、後ろの stage を 1 つずつ増やす(design 3、test-spec と dev-plan 4、test-code 5、implement 6、test-loop 7、intent-sync 8、fix-loop 11)。
- `raguel-mcp/src/context/judge.ts` の `PHASE_SCOPE` に carry-over の文を足す。文の内容: このフェーズは run ブランチ全体の差分を評価する。差分は前の try から引き継いだもので、テストと製品コードの両方を含みうる。
- implement の文の「earlier test-spec and test-code phases」はそのまま正しいので変えない。
- `plugins/codiel/docs/raguel-contract.md` のフェーズ表(:9-21)、ゲートの無いステージの列挙(:23)、検査 8 の code 系フェーズの列挙と「4 フェーズ」(:184)を追随させる。
- raguel-mcp のバージョンも上げない。

### 1.7 指示層

| ファイル | 変更 |
| --- | --- |
| `capturing-intent/SKILL.md` 手順 1・手順 5 | §1.2 のとおり。(4) の branch の説明を `codiel/<slug>` に、`--base-branch` の値をベースブランチに直す |
| `capturing-intent/references/carry-over-intent.md` | 前の try のブランチからの `git checkout` の持ち込みを消し、run ブランチへの切り替えに置き換える。`commit-failed` の扱い(作業ツリーの intent を使う)と、STOP の承認(`--human-approved`)は残す。「前の try の成果物はゲートを通してから使う」は「引き継いだコードは carry-over で評価する」に置き換える |
| `capturing-intent/references/commit-failure.md` | 「作った run ブランチは残してよい」「次の try は別のブランチ」を、1 本のブランチに合わせて直す |
| `orchestrating-runs/SKILL.md` 概要・§1・§2 | フェーズの列と進行表に carry-over を足す。§1 の :139-142 を「引き継いだコードは carry-over のゲートで評価する。文書は各フェーズで書き直して評価する」に直す。§2.1 の :260-261 の `git show <前の try のブランチ>:…` を、同じブランチの履歴(`git log -p -- <path>`)で読む形に直す。「手順ファイルと読む時点」の表と時点 3 の説明に `phase-carry-over.md` を足す。§2.1・§2.4 の番号は変えない |
| `orchestrating-runs/references/resume.md` | 再開時のブランチの復帰を `codiel/<slug>` に合わせる。carry-over が `in_progress` か `awaiting_human` の run では `phase-carry-over.md` を読む |
| `orchestrating-runs/references/phase-pr.md` | §1.5 |
| `orchestrating-runs/references/phase-test-code.md`・`scripting-tests/SKILL.md` | §1.4 |
| `raguel-gating/SKILL.md` | フェーズ→ツール対応表に carry-over の行を足す。code 系フェーズの列挙を直す。STOP の妥当の裁定の後の選択肢に、carry-over だけの例外(§1.3 の 5)を書く |
| `fixing-review-findings/SKILL.md:10`・`filing-followup-issues/SKILL.md:10` | フェーズの番号(`[11]`・`[12]`)を 1 つずつ増やす |
| `docs/DESIGN.md`・`docs/skill-flowcharts.md`・`README.md` | ブランチの例(`codiel/add-dark-mode-toggle-try-1` など)、フェーズの列、`git show <前の try の branch>` の記述を直す |

### 1.8 ADR

ADR-014「[codiel] run のブランチを slug ごとに 1 本にし、新しい try は続きから進めて、引き継いだコードを carry-over で評価する」を `metatron:updating-architecture` で足す。影響範囲には次を書く。

- ADR-009 の理由にある「前の版は前の try のブランチから読める」は、同じブランチの履歴から読む形に置き換わる。
- ADR-006 の run state version 2 は保ち、`phases` に carry-over が加わる。改修の前の state は読み込み時に補う。
- 前の try の STOP を受けたコードは、新しい try の carry-over のゲートで人の裁定を受け、妥当の STOP でも carry-over の中で直して再評価できる。
- 改修の前に `-try-<n>` 付きのブランチへ写し、`写し先` を付けた候補は回収しない(既知の限界)。

### 1.9 テスト

- `codiel-state.test.ts`
  - 期待値を直す: init の `branch`(:157・:487)、`STAGES` と `GATED` の一覧(:554)、`STAGES` の添字(:586)、code 系の検査の一覧(:3665)。
  - 足す: try-1 の init で carry-over が SKIPPED になる。try-2 の init が `baseBranch` を引き継ぐ。違う `--base-branch` で失敗する。try-2 の `start-phase carry-over` が `merge-base` を `startHead` に記録する。`baseBranch` が無いと失敗する。`skip-phase carry-over` が拒否される。carry-over の無い state を読むと補われる。
- `raguel-records.test.ts`: 分岐点と HEAD が異なる実差分を Raguel の evaluate_code に通し、carry-over の pass-gate が通ること、誤った `baseRef` と `paths` 付きの評価が拒否されることを足す。
- `raguel-mcp/src/codiel/__test__/phases.test.ts`: `priorPhasesOf` の期待値を直す。2 者比較(`GATED`・`STAGES` との一致)はそのまま通ることを確かめる。
- `raguel-mcp/src/context/__test__/judge.test.ts`: `PHASE_SCOPE` の表に carry-over を足す。
- `guard-write.test.ts`: carry-over 中のコードへの書き込みが通り、テストの書き換えが保護対象外であることを確かめる。
- `stop-guard.test.ts` の `setupRunAtImplement` が通ることを確かめる。

## 2. 改修 2: incident の GOTCHAS 候補を次の run の intent-sync で写す

- incident の候補は、書くときに `- 写し先: 写さない(incident)` を付けず、`- 由来: incident` を付ける。手元の記録の置き場(incident を記録する run の `statePath` と同じディレクトリの `reports/gotcha-candidates.md`)は変えない。
- 手元の記録のエントリの単位は、`intent-format.md` の「GOTCHAS 候補」の見出し(`### <タイトル> [GOTCHAS 候補]`)から次の見出しまでとする。`由来` と `写し先` の行は領域ファイルへ写さない。
- 写したときの `写し先` の行は `- 写し先: <領域ファイルのパス>(<写した run の slug>)` とする。同じ slug の候補にも同じ形で書く。
- 改修の前に書かれた `- 写し先: 写さない(incident)` の行は、`由来: incident` があり `写し先` の無いエントリと同じに扱う。

### 2.1 集める範囲

`knowledgeTarget` が `intents` の run の intent-sync で、オーケストレーターが集める。走査は Glob と Read で行い、src にコマンドは足さない。

- 同じ slug のすべての try の候補(従来どおり)。
- `.codiel/runs/*/try-*/reports/gotcha-candidates.md` の incident の候補のうち、次のどちらかに当たるもの。
  - `写し先` の行が無い。
  - `写し先` の slug の run の最新の try が `completed` でも `awaiting_outcome` でもなく、今の run の slug とも違う。写したブランチがベースへ届いていないので集め直す。
- 集めた候補があれば、`phase-intent-sync.md` の分岐では未写しの候補があるときと同じに扱い、取り込みを行う。
- `knowledgeTarget` が `metatron` の run は incident の候補を集めない。

### 2.2 写し方

- 写し先の領域は、エントリの `task` と `mistake` から既存の `docs/intents/domains/*.md` の 1 つを選ぶ。今の run の取り込み先でなくてよい。選べないときは写さず、手元に残し、結果レポートに理由を添えて一覧する。
- 領域ファイルの `## GOTCHAS 候補` に同じ見出しがあれば、写さずに `写し先` の行だけを付け直す(既存の規則)。
- 写した領域ファイルは intent-sync の評価の `paths` に含め、ゲート通過の直後のコミットに入れる。コミットの後に、元の手元の記録のエントリの `写し先` の行を書く(既にあれば置き換える)。
- finalize の写しは同じ slug に限るまま変えない。

### 2.3 書式の契約

領域ファイルの `## GOTCHAS 候補` の書式は変えない。metatron の `gotchas-format.md` の写しと `gotcha-candidates.ts` は手元の記録を読まないので、追随は要らない。実装の際に `plugins/codiel/docs/format-change-checklist.md` の項目を当てて確かめる。

変えるファイル: `orchestrating-runs/references/gotcha-candidates.md`(:19・:26-29・:35・:56)、`phase-intent-sync.md`(:9)、`raguel-gating/references/outcome-sync.md`(:28)。

## 3. 改修 3: knowledgeTarget の判定に metatron の rules ディレクトリを使う

- `hooks/lib.ts` に `resolveRulesDir(startDir)` を足し、export する。`resolveDocPaths` と同じ経路で `metatron.config.json` を探し、同じ検証(トップレベルの型・未知の version・`paths` の型)を経て、`paths.rulesDir` を `resolveConfiguredPath` で docRoot を基準に解決する。既定は `.claude/rules/metatron` とする。未知の version と壊れた設定では、metatron と同じく既定の場所を返す。
- `DocPaths` と `resolveDocPaths` の戻り値は変えない(契約 §14 の 2 者比較の対象を広げない)。
- `check-intent-env` の出力の `projectDocs` に `metatronRules`(真偽値)を足す。`resolveRulesDir` の場所がディレクトリとして存在するときに `true` とする。存在しない・読めないときは `false` とする。
- `orchestrating-runs/SKILL.md:83` の表の判断を「`projectDocs.architecture` が null でなく、かつ `projectDocs.metatronRules` が true なら `metatron`、それ以外は `intents`」に直す。
- `resume.md` の再判定の記述が判定式を写していれば合わせる。
- `docs/DESIGN.md:352-354`・`:695` の判定の記述を直す。
- テスト(`check-intent-env.test.ts`): rules ディレクトリがあるとき・無いとき、`paths.rulesDir` で場所を変えたとき、`paths.rulesDir` が絶対パス・ルート外で既定に落ちるとき、未知の version・壊れた設定のとき。

## 4. 改修 4: 依頼文の「ドメインマップ」の行を「担当範囲」に置き換える

- `orchestrating-runs/SKILL.md` §3 のテンプレートの :360 を次の行に置き換える: `担当範囲: <mapped で担当タグがドメインマップのキーにあるときは、そのキーの glob 配列。それ以外は「なし」>`。
- §4 に、担当範囲は §0 で読み取ったドメインマップから担当タグのキーの値を引いて作る、と書く。
- `implementing/SKILL.md:29-30` を次のとおり直す。
  - 確認する値は「渡された実行モード、担当タグ、担当範囲」とする。
  - `mapped` で担当範囲が glob 配列なら、その glob だけを対象とする。担当範囲が「なし」なら、glob による境界を設けず、担当タグでステップを選ぶだけにする。
- `implementing/references/worktree.md:3` の入力確認の「ドメインマップ」を担当範囲に直す。
- オーケストレーター自身が使うスキル(`writing-design-docs`・`writing-dev-plans`・`preparing-design-agendas`)の「渡されたドメインマップ」は、§0 でオーケストレーターが持つ値を指すので変えない。
- review の委譲へ ARCHITECTURE のパスを渡す規則は残す。
- `docs/DESIGN.md:601-602`・`docs/skill-flowcharts.md:155-156・197` の「渡されたドメインマップ」を担当範囲に直す。
- src は変えない(guard-write はドメインマップを自分で読む)。

## 5. 改修 5: review の観点の委譲はテストを実行せず、オーケストレーターが用意した結果を読む

### 5.1 test-run の HEAD

`running-regression-tests/SKILL.md` のレポート書式の `## サマリ` に `- 実行時の HEAD: <git rev-parse HEAD の値>` を足す。run 外の単独実行のレポートにも書く。

### 5.2 review の前の準備(オーケストレーター)

review と fix-loop の再レビューの委譲を出す前に、オーケストレーターが行う。手順は `review-common.md` に書く。待ちが残っている間は実行しない(`delegation-env.md` の自分で実行する条件に従う)。

1. 今の HEAD を控える。
2. テストの結果を決める。
   - 最新の `test-run-<n>.md` に実行時の HEAD があり、その HEAD から今の HEAD までの変更が「結果に影響しない変更」だけなら、その test-run を使う。
   - 結果に影響しない変更は、intent 文書(`docs/intents/**`)、`<runsDir>/<slug>/` の文書、`<testsDir>/**` の `spec.md`・`cases.md`・`reports/**` である。テストコードと製品コードの変更は影響する変更とする。
   - それ以外(test-run が無い、HEAD の行が無い、影響する変更がある)は、プロジェクトの test コマンドを run ブランチ上で 1 回実行する。E2E は実行しない。
3. 型検査のコマンドを決めて 1 回実行する。コマンドは、コンテキストに宣言があればそれ、無ければ `package.json` の `scripts` の `typecheck` とする。どちらも無ければ「型検査なし」とする。
4. `reports/review-checks-<m>.md` に、今の HEAD・使った test-run のパスか test コマンドの実行結果・型検査のコマンドと終了コード・失敗時の出力の抜粋を書く。
5. 観点の委譲の依頼文の「入力ファイル」に、`review-checks-<m>.md` の絶対パスと、使った test-run のパス(あれば)を足す。

### 5.3 reviewing-diffs

- 手順 6 を書き換える。
  - テストと型検査は実行せず、入力の `review-checks-<m>.md`(と test-run)を読んで裏取りする。
  - severity の決め方(受け入れ基準に関わる失敗は high など)は変えない。
  - 入力に結果が無い・「型検査なし」のときは、所見にせず、確認方法にその旨を書く。
- Bash は `git diff`・`git log`・`git rev-parse` だけに使う。
- 完了報告の「確認方法」(:71)を「読んだテストと型検査の結果のファイル」に直す。

### 5.4 ほかの追随

- `phase-review.md` と `phase-fix-loop.md` の再レビューの手順に、§5.2 の準備を `review-common.md` に従って行う旨を足す。
- `writing-dev-plans/SKILL.md:46` の「全体のテストと型検査は test-loop が担う」を、テストは test-loop、型検査は review の前にオーケストレーターが行う形に直す。
- `docs/skill-flowcharts.md:400` の reviewing-diffs の図を直す。
- `delegation-env.md` の「テストを実行する委譲の並べ方」は変えない(review の委譲はテストを実行しなくなる)。

## 6. 実装の順序とコミット

改修ごとに分けてコミットする。`src/` を変えたコミットには `pnpm run build` の差分を含める。

1. 改修 3(src: hooks/lib.ts・check-intent-env、テスト、SKILL の表、DESIGN.md)
2. 改修 4(指示層だけ)
3. 改修 5(指示層だけ)
4. 改修 1(src: codiel-state・raguel-records・guard-write・raguel-mcp、テスト、指示層、raguel-contract、DESIGN.md)と ADR-014
5. 改修 2(指示層だけ。改修 1 の後に、1 本のブランチを前提に書く)

各コミットの前に `pnpm run lint`・`typecheck`・`test`・`build` を通す。変更したスキルには prompt-smith の評価を当て、充足度の評点が変更前より下がっていないことを確かめる。最後に code-reviewer のレビューを受け、critical・high を残さない。

## 7. 確かめた事項

- metatron の SubagentStart の注入はコミット `4da64cc` にある。このリポジトリの ARCHITECTURE では注入にドメインマップの JSON が残ることを `inject-context.mjs` の実行で確かめた。縮退の outline 以降では落ちる(`inject-context.ts` の `summarizeSection`)。
- 連続性検査(`continuityProblem`)の呼び出し元は `start-phase` の code 系フェーズだけである(`codiel-state.ts:946-952`)。
- merge-base を `startHead`・`baseRef` に揃える方式は、Raguel の評価対象の取得(`raguel-mcp/src/subject/code.ts:265-334`)と検査 8(`raguel-records.ts:421-429`)に合う。
- Raguel の前フェーズの改竄検証(`pipeline.ts` の `tamperedPriorPhases`)は、ケースファイルの無い前フェーズを飛ばすので、SKIPPED の carry-over で失敗しない。
- オーケストレーターは型検査のコマンドを解決していない。解決規則は `reviewing-diffs/SKILL.md:36-37` にだけあり、改修 5 でオーケストレーターへ移す。`test-run` に型検査の結果は無い。
- stop で PR を閉じる記述は codiel に無い。

## 8. 実装時に決めた事項

承認の後、実装とコードレビューの中で次を決めた。

- pass-gate の carry-over の再提出は、次の条件をすべて満たすときだけ通す。
  - 渡された評価が STOP と別の evaluationId で、そのフェーズの最新の評価で、verdict が PROCEED である。
  - 今の HEAD が、そのフェーズの最後の STOP の評価の HEAD から進んでいる。
- 通したときは、そのフェーズの STOP の evaluationId をすべて state の note に残す。次の try の `init` は、その STOP を未解決に数えない。
- `init` は、前の try に `baseBranch` が無いとき(改修前の run)は、どの `--base-branch` も受け付ける。
- `close` は、SKIPPED の carry-over を進めたフェーズに数えない。
- capturing-intent は、slug が手順 1 の後に決まった入口で `codiel/<slug>` が既にあれば、`git switch -c` ではなく `git switch` で切り替える。
- try-2 以降の intent-only は、intent を `.codiel/runs/<slug>/intent-backup.md` へ退避する。続けて run ブランチ側を `git restore` で戻し、ベースブランチへ切り替えてから書き戻してコミットする。
- carry-over の修正の委譲は、`implementing` の修正モード(入力 (c))で行う。範囲は担当範囲と所見のパスに限る。報告は `steps/carry-over-fix-<m>/report.md`、コミットの件名は `codiel(carry-over): …` とする。
- carry-over の stop は、STOP から選んだときは `raguel-stop` とし、ASK から選んだときは `ask-aborted` とする。再提出の回数に上限は置かない。
- PR は `gh pr list --head <branch> --state all` で確かめる。`OPEN` があれば `gh pr edit` で更新し、無ければ作る。
- 改修前の `写し先: 写さない(incident)` は、他の slug の走査で `由来: incident` と同じに扱う。写し先の run が無い・読めないときは集め直す。

既知の限界:

- スカッシュマージ済みの `codiel/<slug>` を同じ slug で使い直すと、分岐点が古くなり、carry-over の差分が広がる。
- 改修前に `-try-<n>` 付きのブランチへ写し、`写し先` を付けた候補は回収しない。
- metatron の run の incident の候補は手元に残る。
- carry-over 中のテストの保護は手順の文だけで担保し、guard-write の保護の対象にはしない。
