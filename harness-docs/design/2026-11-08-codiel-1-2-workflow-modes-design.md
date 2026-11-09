# codiel 1.2 設計書: 親 intent を Workflow で並列に片付ける Dynamic Workflow モードと Workflow Intents モード

- 日付: 2026-11-08
- 対象: plugins/codiel(raguel-mcp を含む)
- バージョン: 1.1.0 → 1.2.0(マイナー。ユーザーの予定表の表記は 1.2)。実装中は 1.2.0-dev とする。1.1 が未リリースなら 1.1.0-dev から上げる
- 前提: 1.1 の設計書(`harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`)。ADR-006・ADR-009・ADR-011・ADR-014
- 後続: 2.0(`harness-docs/design/2026-11-08-codiel-2-0-loop-engineering-design.md`)は、このモードの Workflow を子として呼ぶ

## 0. 決まったこと

ユーザーと次を決めた。再検討しない。

| 番号 | 対象 | 決定 |
| --- | --- | --- |
| D1 | 共通 | Workflow モード(親 intent とサブ intent に分けて進める形)には、`/codiel:run` の起動時の指定(例: `--workflow`)で入る。指定が無ければ 1.1 の run になる |
| D2 | Dynamic Workflow | run は親 intent に対して 1 つだけ作る。Workflow が起動した各エージェントが、それぞれの run を行うのではない |
| D3 | Dynamic Workflow | 親 intent 用のブランチを用意し、各サブ intent はそのブランチに向けて PR を出す |
| D4 | Dynamic Workflow | 実装の Workflow では、サブ intent ごとのエージェントが worktree の中で成果物を作り、PR を出す。他のサブ intent に依存しない限り並列に進める |
| D5 | Dynamic Workflow | 実装の Workflow の完了条件は、worktree の中にサブ intent の成果物があり、PR が作成されていることである |
| D6 | Dynamic Workflow | 実装の Workflow が終わったら、レビューと修正を行う Workflow を回す。その後、オーケストレーターがコンフリクトを解消しながらサブ PR を親ブランチへマージする |
| D7 | Dynamic Workflow | discuss だけを親 run でまとめて行う。design 以降は、各エージェントがサブ intent ごとに行う |
| D8 | Dynamic Workflow | 新しい画面名が決まるときは、その時点でユーザーに確認する |
| D9 | Dynamic Workflow | 全サブ intent を親ブランチへマージした後、親ブランチで通常の test-loop → intent-sync → pr → review → fix-loop → triage → finalize を回す |
| D10 | Dynamic Workflow | 親 intent のパスに加えて、親 Issue の番号(サブ Issue 付き)からも始められる |
| D11 | Workflow Intents | 引数を省略した run を Workflow に対応させたもので、親 intent の起票と、タスク分解したサブ intent の起票を行う。github モードでは親 Issue とサブ Issue も起票する。Issue を起点にした intent フェーズには適用しない |
| D12 | Workflow Intents | gh-utility の機能(サブ Issue の作成とつなぎ)を codiel に取り込む。gh-utility は単体のプラグインとして残す |
| D13 | Workflow Intents | codiel が対応する親 Issue にはラベル `story` を、サブ Issue にはラベル `subtask` を、1.1 の `codiel` と併記する。人が作った既存の Issue にも付ける |
| D14 | Dynamic Workflow | Workflow のスクリプトが起動するエージェントにも、運用方針の委譲先を当てる。スクリプトは委譲の指定を `args` で受け取るだけで、委譲先を決める手順は codiel に書かない。指定は役割ごとに渡し、サブごとに上書きできる |

予定表の原文では Dynamic Workflow モードを「implフェーズ」としていたが、ユーザーとの合意(D7)により、サブ intent の design から test-loop までを各エージェントが進める形になった。

## 1. 前提: Claude Code の性質と codiel 1.1 の制約

### 1.1 Workflow の中のエージェントはユーザーと話せず、Workflow も起動できない

2026-11-08 に、Claude Code の公式ドキュメント(code.claude.com/docs/en/ の sub-agents・workflows・hooks・worktrees・agent-sdk)と、Claude Code 2.1.319 のツール説明文で確かめた。

| 性質 | 内容 | 出典 |
| --- | --- | --- |
| 呼び出しの返り方 | Workflow ツールは受け付けた直後に `taskId` を返し、完了は後からタスクの完了として届く | agent-sdk/typescript の `WorkflowOutput` |
| 実行中の人の入力 | エージェントがユーザーに質問する手段は無い(「No mid-run user input」)。Workflow が自分から止まるのは、エージェントの許可の確認と、利用上限の待ちのときだけである(「A run pauses on its own only for agent permission prompts and a usage-limit wait」)。判断を求める質問は、Workflow が終わってメインセッションへ戻った後に行う | workflows |
| サブエージェントのツール | 全サブエージェントから `AskUserQuestion` と `Workflow` が外される。Skill ツールは使える。Agent ツールはメイン会話の下 3 階層まで使え、サブエージェントからの呼び出しは既定で完了を待つ | sub-agents、agent-sdk |
| Workflow のエージェントのツール | Agent ツールが使えるかは記述が無い【要確認: S1】 | — |
| 入れ子の Workflow | スクリプトの `workflow()` で別の Workflow を子として呼べる。子の中からさらに呼ぶことはできない | 2.1.319 のツール説明文 |
| 上限 | 同時 16 エージェント(設定で変更可)、1 回の Workflow で合計 1,000 エージェント。止まったか失敗したエージェントの `agent()` は null を返す | workflows |
| 再開 | `resumeFromRunId` で、完了済みの `agent()` の結果を再利用して再開できる。同じセッションの中だけ | workflows |
| `isolation: 'worktree'` | 起点は既定でリポジトリの既定ブランチ。利用者の設定 `worktree.baseRef: "head"` でだけ現在の HEAD に変わり、呼び出しごとには指定できない。置き場は `.claude/worktrees/` | sub-agents・worktrees |
| hook | PreToolUse はサブエージェントの tool 呼び出しでも発火し、入力に `agent_id`・`agent_type`・`cwd` が入る。Bash の `cd` はメインセッションでだけ次の呼び出しに引き継がれる。サブエージェントの終了では Stop ではなく SubagentStop が発火する | hooks、Bash ツールの説明文 |
| 無効化 | 利用者の設定(/config の Dynamic workflows)で Workflow ツールが無効にされうる | claude-security プラグインの手順書 |
| 同梱 | プラグインは `workflows/<名前>.js` に `meta.name` を付けたスクリプトを同梱でき、`Workflow({ name: "<プラグイン>:<名前>", args })` で呼べる | claude-security 0.12.0 |
| `agent()` の定義の指定 | `agentType` で定義を指定でき、定義は Agent ツールと同じ一覧から引かれる。`model`・`effort` も呼び出しごとに指定できる。`agentType` を指定すると、エージェントのツールはその定義で決まる | 2.1.319 のツール説明文、agent-sdk の AgentDefinition、claude-security 0.12.0 の `workflows/scan.js`(`agentType` と `effort` の実例) |

サブ intent の worktree は、`isolation` を使わずに codiel 側で作る(3.4)。`isolation` の worktree では起点を呼び出しごとに親ブランチへ合わせられず、置き場も hook の判定形式(`.codiel/worktrees/<a>/<b>`)に当たらないためである。

Claude Code の Ultracode(セッション単位で、作業ごとに Workflow を書いて回す設定)は、1.1 の D1 でいう運用方針の一種として扱う。`--workflow` は Ultracode の有無に関係なく動く。Ultracode が有効なセッションで通常の run を回したとき、セッションが自分で Workflow を書くかどうかは、codiel ではなくその設定に従う。

### 1.2 codiel 1.1 のまま並列に動かすと壊れる箇所がある

- 同時に進められる run は 1 つだけである(`src/codiel-state.ts:892-903`)。hook で active な run を 1 つしか選ばないためである(`findActiveRun`、`:363`)。
- `codiel-state` の state の読み書きにはロックが無い。並列に呼ぶと更新が失われる(`skills/orchestrating-runs/SKILL.md:325`)。
- `mark-ask` を呼ぶと run 全体が `awaiting_human` になり、1 つのサブ intent の ASK で他のサブ intent の hook 判定まで変わってしまう。
- guard-bash と guard-github-mcp では、PR 作成を pr フェーズだけに、push を pr・fix-loop・triage・finalize だけに限り、どちらも test-loop の合格を求めている。また `gh issue create` は triage でだけ許している(`src/hooks/lib.ts:46-59`、`guard-bash.ts:1218-1233`、`guard-github-mcp.ts:30-46`)。そのため、親 run の現在のフェーズでサブ intent の push や PR 作成を判定すると、すべて拒否される。
- `start-phase` は前のステージがすべて passed であることを求め、`skip-phase` で飛ばせるのは discuss・design・fix-loop だけである(`codiel-state.ts:163-194,1029-1033,1072-1089`)。
- `isLegacy` では `phases` に `test-code` のキーが無い state を旧形式と見なし、`findActiveRun` と `loadRun` の対象から外している(`codiel-state.ts:382-384,363-377,821-833`)。
- Raguel はフェーズの表(`GATED_PHASES`)に無いフェーズの評価を拒み、run ID を `/^[A-Za-z0-9._-]{1,64}$/` で検査する(`raguel-mcp/src/core/pipeline.ts:164-169`、`raguel-mcp/src/casefile/store.ts:32,87-95`)。Raguel のフェーズの表は 1 本で、各行の `stage` は codiel の `STAGES` の添字であり、2 者比較のテストで両者の一致を検査している(`raguel-mcp/src/codiel/phases.ts:35-62`、`raguel-mcp/src/codiel/__test__/phases.test.ts:6-24`)。
- `pass-gate` は、HEAD の照合と成果物のハッシュの照合をメインの作業ツリーで行い、文書の置き場を `<runsDir>/<runId>/<フェーズ>.md` に固定して検査する(`codiel-state.ts:1159-1200`、`src/raguel-records.ts:376-384,449-466`)。
- テストの保護では、メインの作業ツリーの `spec.md` だけを読んで、記録済みのテストを特定している(`guard-write.ts:152-169`)。

## 2. Workflow Intents モード: 親 intent とサブ intent を起票する

### 2.1 入口は `--workflow` と引数の組み合わせで決まる

| 呼び出し | 動き |
| --- | --- |
| `/codiel:run --workflow`(引数なし) | Workflow Intents モードで親 intent とサブ intent を作り、承認後に Dynamic Workflow へ進む |
| `/codiel:run --workflow <親 intent のパス>` | 既存の親 intent と、それを `parent` に指定したサブ intent から Dynamic Workflow を始める |
| `/codiel:run --workflow <親 Issue の番号>` | 親 Issue とサブ Issue を取り込んで親 intent とサブ intent を作り、Dynamic Workflow を始める(2.6) |

- `--workflow` の run を始める前に、オーケストレーターが自分の使えるツールの一覧に Workflow があるかを見る。手順書に名前があることは数えない。無ければ、利用者の設定で無効になっている可能性を添えて報告し、run を始めない。この判定は指示層で行う。Node のスクリプトからはツールの一覧が見えないためである。
- 親 intent のパスを渡されたとき、その親を `parent` に指定したサブ intent が 1 件も無ければ、2.2 の分解案の提示へ進む。
- 親とサブの intent がすべて `status: approved` のときは、承認ゲート(2.3)を省く。それ以外は承認ゲートを通す。
- `--workflow` の無い呼び出しは、1.1 の run と同じように動く。

### 2.2 親 intent の聞き取りは現行と同じで、その後に分解の案を示す

- 親 intent の聞き取りは `skills/capturing-intent/SKILL.md` の現行の手順(ASIS / TOBE の原文、4 観点、現状調査、領域名、分岐の合意)と同じにする。
- 聞き取りの後、AI がサブ intent への分解案と、サブ intent 同士の依存関係を示す。
- 分解の基準は gh-utility の issue-split(`plugins/gh-utility/skills/issue-split/SKILL.md:50-57`)から取り込む。
  - 各サブ intent が独立して閉じられる。
  - 粒度が揃う。完了条件の数が最も多いサブ intent でも、最も少ないサブ intent の 3 倍を超えない。
  - サブ intent の完了条件の合計が、親の受け入れ基準を覆う。
  - 親のスコープ外を混ぜない。
- 規模(標準 / 軽量)はサブ intent ごとに決め、分解案に含めて示す。軽量のサブ intent は design を飛ばす。サブの規模は、サブ intent の frontmatter の `scale` に書く。後から `--workflow <親 intent のパス>` で始めるときに読むためである。
- 親 run の `scale` は常に `standard` とする。D7 で discuss を必ず行い、`skip-phase discuss` を使わないためである。

### 2.3 承認ゲートでは親とサブをまとめて承認する

- 親 intent とサブ intent の全ドラフトを一覧で示し、まとめて承認を得る。
- github モードでは、起票する親 Issue とサブ Issue の本文の全文も同じゲートで示す(D11 により github モードでは必ず起票する)。
- 承認ゲートで選ぶのは、続行(Dynamic Workflow へ進む)か、intent だけ残して終えるかの 1 項目である。
- 差し戻されたら、聞き取りか分解案の提示に戻る。

### 2.4 サブ intent は通常の intent 文書に `parent` と `depends` を足して書く

- サブ intent も `docs/intents/YYYY-MM-DD-<slug>.md` に置く。
- frontmatter に 3 つのキーを足す。
  - `parent`: 親 intent の slug
  - `scale`: サブの規模(`standard` / `light`)
  - `depends`: 依存先のサブ intent の slug の配列(1 行のフロー形式)。依存先は、このサブ intent より先に親ブランチへマージされている必要がある。frontmatter の配列は現行では `domains` だけなので、その規則を広げる
- サブ intent の `run` は親 run の slug(親 intent の slug)にする。
- `/codiel:run <サブ intent のパス>`(`--workflow` 無し)で呼ばれたときは、`parent` を見て、親 run の再開として扱うかをユーザーに確かめる。現行の入口では frontmatter の `run` に一致した run を確認なしに再開する(`skills/orchestrating-runs/SKILL.md:136-140`)が、サブ intent では必ず確認する。サブ intent を単独の run としては始めない。
- `status` を `in-progress` にする時点は、現行の「implement の開始時」から、Workflow モードでは「`workflow` フェーズの開始時」に改める。親とすべてのサブを同時に `in-progress` にし、親 run の finalize でまとめて `done` にする。更新はオーケストレーターが行う。
- 原文の扱いは、サブ intent の作られ方で分ける。
  - 分解で作ったサブ intent では、ユーザーの原文を親 intent に置く。サブの `## ASIS` と `## TOBE` には、親を参照する新しいマーカーだけを置く(現行の `<!-- codiel:unrecorded -->` と同じ置き方)。
  - サブ Issue から取り込んだサブ intent は、現行の Issue 起点の規則(`references/intent-format.md:224-233`)に従い、人が書いた本文を原文に記録する。
  - 原文と派生文の照合(review と finalize)では、親の原文を必ず基準にする。原文があるサブは、その原文も基準に加える。
- `references/intent-format.md` は書式の契約なので、変更時は `docs/format-change-checklist.md` の項目をすべて追随させる。

### 2.5 github モードでは親 Issue とサブ Issue を起票し、Sub-issues API でつなぐ

- 現行の intent フェーズの起票は、gh-utility の issue-craft を持ち込みモードで呼び、使えないときだけ codiel 自身が起票する(`skills/capturing-intent/SKILL.md:150`、`references/intent-common.md:26`)。Workflow Intents モードでは、この経路を変え、親 Issue とサブ Issue を codiel 自身が起票する。issue-craft の承認は、2.3 の承認ゲートで全文を示すことで代える。
- 親 Issue を起票した後、サブ Issue を 1 件ずつ起票して親につなぐ。
- ラベルは、親 Issue に `codiel` と `story`、サブ Issue に `codiel` と `subtask` を付ける(D13)。
  - `story` と `subtask` のラベルが無ければ、`codiel:init` で `codiel` と一緒に作るかを聞く。init の後に不足が分かったときは、起票前の承認ゲートで作るかを聞く。
  - サブ PR(3.4)と親 PR(3.9)には、1.1 のとおり `codiel` を付ける。
- つなぐ手順は gh-utility の `link-sub-issue`(`plugins/gh-utility/src/link-sub-issue.ts:50-73`)と同じにし、codiel の同梱スクリプトとして独立に実装する。
  1. `gh api repos/<owner/repo>/issues/<子の番号>` で、子の内部 ID を得る。
  2. `gh api -X POST repos/<owner/repo>/issues/<親の番号>/sub_issues -F sub_issue_id=<内部 ID>` でつなぐ。内部 ID は数値型で送るので `-F` を使う。
- 起票は、現行の intent 承認時と同じく run を作る前に行う。run を作る前は hook の対象外なので、`gh issue create` を triage に限る規則とはぶつからない。
- 依存関係は、サブ intent の `depends` を正とする。Issue の本文の末尾にも依存先の番号を書く。
- 起票やつなぎが途中で失敗したら、作成済み・つなぎ済みの分を報告して止まる。

### 2.6 親 Issue の番号から始めるときは、既存のサブ Issue の分け方を使う

- github モードだけで受け付ける。local モードでは理由を添えて断る。
- `gh issue view <親>` で親を、`gh api repos/<owner/repo>/issues/<親>/sub_issues` でサブ Issue の一覧を取り込む。
- ラベルは、codiel が対応する Issue の印として付ける(1.1 の D9)。人が作った既存の Issue にも付ける。
  - 親 Issue に `codiel` と `story` が無ければ、聞かずに足す。
  - 承認ゲートで、取り込むサブ Issue の一覧を示す。既定はすべてを取り込み、ユーザーが外すものを選べる。
  - 取り込むサブ Issue に `codiel` と `subtask` が無ければ、承認後に足す。外したサブ Issue にはラベルを付けない。
- 親 Issue は親 intent に、取り込む各サブ Issue はサブ intent になる。本文のマーカーごとの扱いは、現行の Issue 起点の規則(`skills/capturing-intent/references/entry-branches.md`、`references/intent-format.md:224-233`)に従う。
- 分解の聞き取りは行わない。
- サブ Issue 同士の依存関係は、GitHub の Issue の依存関係から読む【要確認: S4】。読めないか、依存関係が無いときは、AI が依存の案を示し、承認ゲートでユーザーが確かめる。
- サブ Issue が 1 件も無い親 Issue では、`--workflow` を外した通常の run を案内して止まる。

## 3. Dynamic Workflow モード: 親 run 1 つでサブ intent を並列に片付ける

### 3.1 ステージ表は 1 本のまま `workflow` を足し、モードで飛ばすフェーズを変える

codiel の `STAGES` と Raguel のフェーズの表は 1 本のまま保つ。discuss と design の間に、新しいゲート付きフェーズ `workflow` を足す。

```
intent → carry-over → discuss → workflow → design → (test-spec ∥ dev-plan) → test-code → implement → test-loop → intent-sync → pr → review → fix-loop → triage → finalize
```

- state に `mode`(`standard` / `workflow`)を足し、`init` で固定する。`mode` の無い state は `standard` と見なす。
- `init` の時点で、モードに合わないフェーズを `SKIPPED` として作る。

| state | `SKIPPED` で作るフェーズ |
| --- | --- |
| 標準の run(`mode: standard`) | `workflow` |
| Workflow モードの親 run(`mode: workflow`) | design・test-spec・dev-plan・test-code・implement |
| サブの state(3.2) | intent・carry-over・discuss・workflow・intent-sync・triage・finalize。軽量のサブは design も |

- `phases` には全キーが揃うため、`isLegacy` の判定(`test-code` のキーの有無)は変わらない。
- 1.1 で作られた進行中の state には `workflow` のキーが無い。そこで `readState` の中で、欠けたキーを `SKIPPED` として補う。carry-over の欠落を補う現行の処理(`codiel-state.ts:276-293`)と同じ場所で行う。`start-phase`・`skip-phase`・`continuityProblem` が `phases[<名前>]` を直接参照するためである。
- `SKIPPED` は、現行どおり passed の一種(verdict が `SKIPPED`)として扱う。try-1 の carry-over や、軽量の run の design と同じである。
- `close`(intent だけ残して終える)は、intent 以外のフェーズが pending であることを求め、例外は carry-over の `SKIPPED` だけである(`codiel-state.ts:1445-1452`)。モードに合わないために `SKIPPED` で作ったフェーズも、例外に加える。
- `workflow` は、`evaluate_code` で評価するコード系フェーズとして扱う。次の集合に足す。
  - `src/raguel-records.ts` の `CODE_PHASES`(`startHead` の記録と pass-gate の検査 8)
  - `src/hooks/guard-write.ts` の `CODE_PHASES` と `TEST_GUARD_PHASES`
- 連続性の検査(`codiel-state.ts:770-815`)は、「直前のゲート付きステージ」を探すときに `SKIPPED` のフェーズを飛ばす。現行は、直前のゲート付きステージに `passedHead` が無いと照合をやめる(`:784`)。
  - 親の `workflow` の直前は、try-1 では intent、try-2 以降では carry-over になる。
  - 親の test-loop の直前は `workflow` になる。
- `workflow` の `start-phase` の連続性の検査は、次の形にする。
  - 直前のゲート付きステージの `passedHead` が HEAD の祖先であることを求める。
  - その間のコミットが `<runsDir>/<親 slug>/agenda.md` と `discussion.md` だけを変更していることを求める。discuss の文書は、直前のゲートを通過した後に必ずコミットされるためである。
  - サブ intent の文書は intent フェーズで作り、intent のゲートの前に親ブランチへコミットする(現行の intent のコミットと同じ時点。`skills/capturing-intent/SKILL.md:173-174`)。このため、この検査には掛からない。
- `start-phase workflow` の直後に、オーケストレーターが親とサブの intent の `status` を `in-progress` にしてコミットする。github モードでは、続けて親ブランチを push する。最初のサイクルのサブの worktree は、その後で作る。サブの worktree に、サブ intent の文書と最新の `status` が入るようにするためである。
- `workflow` の評価は、全サイクルのマージが済んだ後、最後のマージコミットで 1 回だけ行う。評価の後は、test-loop を始めるまでコミットを足さない。
- Raguel 側は次を同じコミットで追随させる(`docs/format-change-checklist.md` の Raguel との契約の項)。
  - `raguel-mcp/src/codiel/phases.ts` の表に `workflow` の行を足す。`stage` は 3 とし、design 以降の `stage` はそれぞれ 1 大きくなる(design は 3 から 4、fix-loop は 11 から 12)
  - `GATED_PHASES`・`phaseSchema`・フェーズとツールの対応(`workflow` → `evaluate_code`)
  - 2 者比較のテストと `docs/raguel-contract.md`
- 変更はフェーズの追加だけで、標準の run の評価の意味は変わらない。state の `raguelContract` の値は上げない。上げると、1.2 へ上げた時点で進行中の run がすべて pass-gate で止まるためである(`codiel-state.ts:1113-1114`)。

### 3.2 サブ intent ごとに state を分け、書き手を 1 体に限る

- `codiel-state` のルートは、1.1 で全コマンド共通に `findMainRoot` で解決する形になっている(1.1 の 1.3)。worktree の中から呼んでも同じ state に届く。
- 親の state は `.codiel/runs/<親 slug>/try-<n>/state.json` に置く。
- Workflow の実行中にオーケストレーターが親の state に書くのは、待ちの記録(`wait-add` / `wait-done`)だけとする。
- 親の state に、サブごとの進みの表を置く。
  - 項目は、番号 `k`・サブ slug・worktree のパス・ブランチ・分岐点(`base`。worktree を作った時点の親ブランチの HEAD)・Raguel の run ID・進み・PR の URL・置き換えた委譲の指定(3.6)である。
  - 進みは、未着手 / 実行中 / PR 済み / マージ済み / 人の判断待ち / failed のどれかとする。
  - 書き手は Workflow の外のオーケストレーターだけとする。着手の判定・再開・結末の記録は、この表を正にする。サブの state には終端の status を置かない。
- サブの報告(`review-<m>.md`・`report.md`・`test-run-<n>.md`)は、`subs/<サブ slug>/reports/` に置く。
- サブの state は `.codiel/runs/<親 slug>/try-<n>/subs/<サブ slug>/state.json` に置く。
  - `latestTries` は `try-<n>` の直下だけを読むので、`findActiveRun` の検索には混ざらない(`codiel-state.ts:332-355`)。
  - このパスも、guard-write による state 直接編集の拒否(`guard-write.ts:246`)の対象になる。
- サブの state のステージ表は 3.1 の 1 本の表で、使うのは次のフェーズである。

```
design → (test-spec ∥ dev-plan) → test-code → implement → test-loop → pr → review → fix-loop
```

- `codiel-state` に、サブの state を指す引数 `--sub <サブ slug>` を足す。`--sub` のときは基準を次のように分ける。

| 基準 | 値 |
| --- | --- |
| state の置き場(ルート) | メインの作業ツリー(全コマンド共通) |
| HEAD の照合と差分 | サブの worktree(3.4) |
| pass-gate の検査 9 の文書の置き場 | `<runsDir>/<親 slug>/<サブ slug>/` |
| pass-gate の成果物のハッシュの照合の基準 | サブの worktree |
| `evaluate_*` に渡す `repoPath` | サブの worktree の絶対パス。`skills/raguel-gating/` の対応表を改める |

- サブの state を書くのは、ある時点でそのサブを担当する 1 体だけとする。1 つのファイルを 1 体だけが書くので、ロックが無くても更新は失われない。
  - 実装の Workflow では、サブの担当エージェント。
  - レビューと修正の Workflow では、サブごとの修正担当のエージェント(3.7)。観点ごとのレビュアーは `codiel-state` を呼ばない。
  - Workflow の外では、オーケストレーター(人に確認した後の `resume`、マージなど)。
- 「同時に進められる run は 1 つ」の制限は親の run で数える。サブの state は数えない。
- サブの ASK は、サブの state だけを `awaiting_human` にする。親は `workflow` フェーズのまま変わらない。
- Raguel の run ID は、サブごとに `<親 slug>-try-<n>-s<k>` とする。
  - `k` はサブの登録順の番号で、進みの表に記録する。
  - slug は 40 文字まで(`references/intent-format.md:7`、`codiel-state.ts:204-205`)なので、最長でも 64 文字の上限に収まる。
  - 親自身のゲートは、現行どおり `<親 slug>-try-<n>` を使う。
- サブを前のフェーズからやり直すときは、新設の `codiel-state sub-reset --sub <サブ slug> --from <フェーズ>` でサブの state を作り直す。マージ後のテストの失敗(3.8)、解消できないコンフリクト(3.8)、壊れた state(3.6)で使う。
  - 前の state は `subs/<サブ slug>/archive/<m>.json` に残す。
  - `<フェーズ>` より前の passed のフェーズを写し、`<フェーズ>` 以降を pending にする。
  - Raguel の run ID は `<親 slug>-try-<n>-s<k>-r<m>` に改める。`m` はやり直しの回数である。Raguel は前のフェーズの記録が無い run ID の評価を拒まない(`raguel-mcp/src/core/pipeline.ts:545-547`)。
  - 作り直した state に、作り直した時点の HEAD を `rebaseHead` として記録する。`<フェーズ>` の `start-phase` の連続性の検査は、写した前のフェーズの `passedHead` ではなく `rebaseHead` と照らす。作り直しの前に、親ブランチのマージなどで HEAD が進んでいるためである。差し替えは、`continuityProblem` のコード系の経路(`codiel-state.ts:787-788`)と文書系の経路(`:806` の `changedPathsSince`)の両方で行う。
  - `--from implement` では、親ブランチの新しい HEAD から新しいサブのブランチを作り、前のブランチの `base..<test-code の passedHead>` のコミット(design.md・spec.md・cases.md・dev-plan.md・テスト)を cherry-pick する。始点は進みの表の `base` を使う。親ブランチをサブへマージした後は `git merge-base` の分岐点が動くためである。implement 以降のコミットは持ち込まない。cherry-pick が衝突したら、親を `mark-ask` して「design からやり直す(`--from design`)」か「中止」を聞く。
  - 1.2 の中止(3.6)は親 run ごと止める。`sub-reset` は中止ではなく、続けるためのやり直しである。

### 3.3 hook はパスとコマンドの `cd` の行き先からサブを見分ける

- guard-write は、書き込み先のパスがサブの worktree の下にあるとき、サブの state で判定する。それ以外は親の state で判定する。サブの見分けは、パスから slug を読み取らず、進みの表に記録した worktree のパスと照らして行う(guard-write の現行の方針。`guard-write.ts:171-172`)。
- ドメイン境界: サブの worktree への書き込みには、サブの state の `domain` を当てる。サブの担当エージェントは、ドメインに紐づくステップの間、`set-domain --sub` で担当タグを設定する。現行の判定は、worktree の下への書き込みには `step-add --domain` の記録を使う(`guard-write.ts:435-446`)。サブの worktree ではサブの state を読む分岐を足す。
- guard-bash は、コマンドの文字列から作業ディレクトリの候補を拾う既存の仕組み(`cd`・`pushd` の行き先。`guard-bash.ts:793-831`)でサブを見分ける。候補に `git -C <パス>` の値も加える。hook の入力の `cwd` には頼らない。PreToolUse はコマンドの実行前に発火し、サブエージェントでは `cd` が次の呼び出しに引き継がれないためである。
- このため、サブの担当エージェントの作業の契約に、Bash のコマンドを必ず `cd <サブの worktree の絶対パス> &&` で始めることを書く。
- guard-github-mcp は、PR 作成の引数の head ブランチが `codiel/<親 slug>--<サブ slug>` の形なら、そのサブの state で判定する。
- サブの state で判定するときの規則:
  - テストの保護では、サブの worktree の `<testsDir>/**/spec.md` を読んで記録済みのテストを特定する。サブの test-code で記録したテストは、マージ前はサブの worktree にしか無いためである。
  - サブの test-loop が passed の後は、そのサブのブランチの push と、親ブランチを base にした PR の作成を許す。
  - サブの fix-loop が passed になった後は、マージ時のコンフリクトを解消する書き込み(3.8)を許す。
  - 保護ブランチへの push は、現行どおり常に拒否する。
  - refspec の無い `git push` は、サブの文脈では拒否する。push には refspec を明示させる。
- オーケストレーターはメインセッションで動き、`cd` が次の呼び出しに引き継がれる。サブの worktree を操作するときは `cd` を単独で使わず、`git -C <パス>` か、`( cd <パス> && <コマンド> )` のサブシェルを使う(1.1 の 1.3)。
- guard-bash の作業ディレクトリの候補:
  - 現行の `parseCommands` は `(` と `)` でコマンドを区切るので、サブシェルの中の `cd` の行き先は既に候補に入る(`guard-bash.ts:392-396,797-803`)。新しく足すのは `git -C` の値だけである。
  - 現行の候補は state.json の保護の判定(`:859`)にだけ使われ、push と `gh` のフェーズの判定(`:1198-1233`)は `findActiveRun(findMainRoot(cwd))` の 1 つの run だけを見る。候補からサブの state を選んでフェーズの判定に使う配線は新設である。
  - 候補が異なる state(親とサブ、別のサブ)に分かれたときは、規則違反として扱う。1.2 の run では ask、2.0 の Loop では deny(2.0 の 4.8)にする。
- 親の `workflow` フェーズのメインの作業ツリーには、テストの保護を含むコード系フェーズの規則を当てる(3.1 の集合への追加)。オーケストレーターの書き込みがテストのファイルに触れると ask になるが、これは意図した動きである。
- 親の `workflow` フェーズでは、親ブランチ `codiel/<親 slug>` への push だけを、test-loop の合格の前でも許す。現行の不変条件(push は test-loop の合格の後)を意図して緩める箇所であり、許す refspec を親ブランチに限る。
- 親の state に `workflow-` で始まる待ちが残る間、メインの作業ツリーの `.codiel/` の外への書き込みは ask にする。サブの担当エージェントが worktree の外を誤って書き換えることへの備えである。
- `state.intent` の例外(`guard-write.ts:328`。どのフェーズでも run の intent 文書を通す)を、親の state に登録したサブ intent にも広げる。`workflow` フェーズでの `status` の更新と、review・fix-loop での書き戻しが ask にならないようにするためである。
- Workflow のエージェントの tool 呼び出しで、hook の入力に `agent_id` が入るかは確かめる【要確認: S2】。入るなら、上の判定の補強に使える。

### 3.4 実装の Workflow: 1 体が 1 つのサブ intent を design から PR まで進める

- Workflow のスクリプトは、プラグインの `workflows/` に名前付きで同梱する(例: `workflows/implement-subs.js`、`meta.name` は `implement-subs`)。呼び出しは `Workflow({ name: "codiel:implement-subs", args })` とする。
- 2.0 の Loop がこのスクリプトを `workflow()` の子として呼ぶので、入力と戻り値は `args` と戻り値だけで完結させる。
- `args` には、対象のサブ intent の一覧、各サブの worktree のパスとブランチ、サブの state の指し方、規模、run ID、プラグインのルートを渡す。任意で、委譲の指定(下記)も渡せる。
- 親ブランチは、現行の run と同じく intent の承認の後に `codiel/<親 slug>` として作る。github モードでは、`workflow` フェーズの開始時に親ブランチを push する。サブ PR の base にするためである。
- サブの worktree は、オーケストレーターが各サイクルの始めに、そのサイクルで着手するサブのぶんだけ作る。
  - パス: `.codiel/worktrees/<親 slug>/<サブ slug>`(現行の `WORKTREE_REL_RE` が受ける 2 階層の形。`guard-write.ts:47`)
  - ブランチ: `codiel/<親 slug>--<サブ slug>`。git は `codiel/<親 slug>` と `codiel/<親 slug>/<サブ slug>` を同時に持てないので、`/` で区切らない。
  - 起点: その時点のローカルの親ブランチの HEAD。前のサイクルで止まり、再開するサブの worktree は作り直さない。
- 1 体のエージェントが、担当するサブ intent を design → test-spec ∥ dev-plan → test-code → implement → test-loop と進め、サブ PR を出す。軽量のサブ intent は design を飛ばす。
- サブの design では、ユーザーとのウォークスルー(`skills/facilitating-design-discussions/references/design-walkthrough.md`)を行わない。D7 で design 以降をエージェントに任せたためである。新しい画面名だけは D8 で止まる(3.6)。
- サブの文書(design.md・spec.md・cases.md・dev-plan.md)は、ゲートを通過した直後にサブの担当エージェントがサブのブランチへコミットする。
- サブ intent の中のステップは、1 体のエージェントがサブのブランチの上で直列に進める。サブの中で worktree は作らない。
  - エージェントが Agent ツールを持つ場合、ステップの作業を委譲するかは 1.1 の規則どおり運用方針に任せる。委譲する場合は、サブの worktree の中で 1 件ずつ完了を待つ形に限り、並列には起動しない。1.2 には、サブの中の並列の単位の worktree を state に対応づける設計が無いためである(hook は、進みの表に記録した worktree だけをサブに対応づける。3.3)。
- エージェントへの指示は、1.1 の「作業の契約」の形で書く。読むスキル、入力(intent・`discussion.md`・持続層の位置)、出力、書いてよい範囲、Bash の `cd` の規則を含める。
- 契約には、任せる判断とその材料を明記する(1.1 の D10)。サブの design・test-spec・dev-plan の判断は担い手が行い、材料は intent・`discussion.md`・持続層とする。test-code・implement・test-loop で、design.md と dev-plan.md の範囲に収まる構造の選択(インターフェース・ファイル配置・依存関係)も担い手が行う。範囲を超える変更は決めずに返し(3.6)、新しい画面名は `awaiting-human` で返す。次の外部への操作も、契約の作業に含める。
  - サブのブランチの push、サブ PR の作成、既存の PR の本文の更新(`gh pr edit`。現行の `references/phase-pr.md:23,29`)
  - 画像のアップロード。PR の本文の画像と E2E の証拠の添付で、`gh --attach` かブラウザから行う(現行の `references/github-writing-images.md:17`、`phase-pr.md:19`、`e2e.md:11`)
  - Raguel のゲートの評価。`TYPESAFE_API_KEY` があれば、Raguel が成果物について Jev へ問い合わせる(`raguel-mcp/src/context/judge.ts:3,489-492`)。MCP 経由の評価を方針の規律が「送信」と見なすかは【要確認: S7】
- 読むスキルは、名前と SKILL.md の絶対パスで示す。Skill ツールを持たないエージェントは、パスから読む。プラグインのルートは `args` で受け取る。
- 各フェーズの Raguel のゲートは、エージェントがサブの run ID で通す。エージェントが Raguel MCP のツールを持たないときは、評価の手前で `gate-pending` を返し、オーケストレーターが Workflow の後に評価してゲートを通す。Workflow のエージェント全体で使えない場合(S1)と、渡された定義の tools に無い場合のどちらも、この経路になる。
- 委譲の指定は、Agent ツールで起動するときと同じ `agentType`・`model`・`effort` に、依頼文の前置きの文を加えたものである。どれも任意である(D14)。
  - 役割(サブの担当・レビュー・修正)ごとに渡す。レビューの指定は、観点によらず同じものを使う。
  - サブの一覧の各要素に指定があれば、そのサブについて、その役割の指定を丸ごと置き換える。項目ごとには混ぜない。方針が選ばなかった定義とモデルの組を作らないためである。3.7 のレビューと修正の Workflow も、同じ形のサブの一覧を受け取る。
  - スクリプトは、置き換えた後の指定のうち、値のある項目だけを `agent()` に渡す。値の無い項目は渡さず、Workflow の既定に任せる。
  - 前置きは、スクリプトが組み立てる依頼文の頭に付ける。運用方針が依頼文に求める項目(1.1 の 1.2 の C)を足すためのものである。
  - どの指定を渡すかは運用方針に任せ、codiel は書かない(1.1 の D1)。
- 渡された定義が、作業に要るツール(書き込み・Bash・Skill・Raguel MCP)を持つかは確かめない(9 章)。
- 戻り値はスキーマで固定し、少なくとも次の項目を含める。
  - サブ intent の slug
  - 結果を返した役割(サブの担当・レビュー・修正)。`agent()` が null のときは、スクリプトが起動した役割を入れる
  - 結果(`pr-created` / `awaiting-human` / `gate-pending` / `undecided` / `declined` / `failed`)。`undecided` は契約の「決めずに返す」で返したこと、`declined` は担い手が作業を引き受けなかったことを表し、どちらも理由を添える(3.6)
  - PR の URL(local モードではブランチ名)
  - 人への確認の内容(種類・問い・選択肢の材料・評価 ID)
- `agent()` が null を返したサブは `failed` として扱う。
- 完了条件は D5 のとおり、worktree の中にサブ intent の成果物があり、PR が作成されていることである。local モードでは PR の代わりに、サブのブランチにコミットが済んでいることを条件にする。

### 3.5 サイクルを回し、止まったサブは独立したサブを塞がない

親 run の `workflow` フェーズは、次のサイクルを、すべてのサブが親ブランチへマージされるまで繰り返す。dev-plan の `codiel-state waves` と修正ループの「ラウンド」と区別するため、この単位を「サイクル」と呼ぶ。

1. 着手できるサブを集める。条件は、依存先がすべて親ブランチへマージ済みで、人の確認を待っていないことである。
2. 着手できるサブを、実装の Workflow で並列に進める。同時に動くエージェントの上限を超えた分は、Workflow が順に待たせる。
3. Workflow が戻ったら、`awaiting-human`・`gate-pending`・`undecided`・`declined`・`failed` のサブを扱う(3.6)。
4. このサイクルで PR を出したサブを、レビューと修正の Workflow に回す(3.7)。
5. レビューと修正が済んだサブから、オーケストレーターが親ブランチへマージする(3.8)。

- 止まったサブに依存するサブだけが待つ。依存しないサブは次のサイクルで着手する。
- 親 run は、Workflow を起動したら `wait-add --id workflow-<サイクル>-<回> --task-id <Workflow が返した taskId>` で待ちを記録し、ターンを終えて完了の通知を待つ。stop-guard は変えない。

### 3.6 人への確認はサブを止めて Workflow の後にまとめて行い、中止は親ごと止める

- 次の場面では、エージェントはサブの state に `mark-ask` を記録し、`awaiting-human` を返して終わる。他のサブ intent は進める。
  - Raguel の ASK と STOP
  - 新しい画面名が必要なとき(D8)。標準のサブでは design で、軽量のサブでは test-spec で、仕様のディレクトリを決めるときに生じる(現行の `references/phase-test-spec.md:14` と同じ時点)。名前の候補を返す
  - 試行回数の上限を超えたとき
  - 現行の手順が、サブのフェーズの中で人に確認を求める場面(broken のテストの修正の承認など)。design のウォークスルーは除く(3.4)
- `evaluate_*` が Claude Code にバックグラウンドへ移され、エージェントが verdict を受け取れなかったときは、`gate-pending` と評価の手がかりを返して終わる【要確認: S6】。オーケストレーターは Workflow の後に Raguel の記録から verdict を読み、次のサイクルで続きから再開させる。
- エージェントが Raguel MCP のツールを持たずに `gate-pending` を返したとき(3.4)は、オーケストレーターが Workflow の後にそのゲートを評価し、次のサイクルで続きから再開させる。
- Workflow が終わったら、オーケストレーターは次の順で扱う。
  1. Workflow の戻り値を要約せずに `waits/workflow-<サイクル>-<回>.md` に書き、待ちを `wait-done` で消す。`wait-done` はこのファイルが無いと失敗する(`codiel-state.ts:1373-1376`)。
  2. 人に聞くサブがあれば、親を `mark-ask workflow --kind confirm` で `awaiting_human` にする。待ちが空になると stop-guard が停止を止めるためである。
  3. `awaiting-human` のサブごとに、AskUserQuestion で聞く。選択肢は現行と同じものを使い、現行に無い場面(上の一覧で選択肢を決めた場面)はその選択肢を使う。
- 答えに応じて、次のように扱う。

| 答え | 扱い |
| --- | --- |
| 続行(修正して再提出・このまま承認・誤検知として続ける・画面名の決定・上限超過の続行) | サブの state を `resume` し、次のサイクルの実装の Workflow で、止まった場所から再開させる。worktree とコミットは残してある。「このまま承認」と「誤検知として続ける」は、オーケストレーターが Workflow の外で `record_outcome` と `pass-gate --human-approved` をサブに対して済ませてから再開させる。「修正して再提出」と画面名は、裁定の内容を次のサイクルの `args` でエージェントへ渡す |
| 続行(`undecided`・`declined`・`failed` からの、判断を示して続ける・委譲の指定を変えて続ける・再試行) | サブの state は `awaiting_human` でないので `resume` しない。進みの表のそのサブを「実行中」に戻し、次のサイクルで止まった場所から着手させる(下の箇条)。示した判断は次のサイクルの `args` で渡し、委譲の指定を変えるときは `args` でその役割の指定を置き換える |
| 中止(ASK の中止・STOP を妥当として止める・上限超過の中止・決めずに返した場面の中止) | 実行中の Workflow が無いことを確かめ、親 run を現行と同じ理由(`ask-aborted`・`raguel-stop`・`attempts-exceeded`)で `stop` する。決めずに返した場面の中止は `ask-aborted` にする |

- 契約の「決めずに返す」場面(1.1 の 1.2 の C)では、エージェントはサブの state に触れずに返す。フェーズが pending か passed の時点では、サブの state に `mark-ask` を記録できない(`codiel-state.ts:1259-1262`)ためである。上の一覧の場面(Raguel の ASK と STOP、新しい画面名、試行回数の上限超過、現行の手順が求める確認)は、フェーズの中で生じるので、従来どおり `mark-ask` して `awaiting-human` で返す。一覧に無い任せない判断は `undecided` で返す。
  - 任せた範囲の外の判断が要るとき、または作業を進められないときは、`undecided` に理由と、判断が要るなら問いと選択肢の材料を添えて返す。
  - 作業を引き受けないときは、`declined` と理由を返す。
  - オーケストレーターは Workflow の後に、進みの表のそのサブを「人の判断待ち」にし、親を `mark-ask workflow --kind confirm` で人の判断待ちにして聞く。答えを受けたら、親を `resume` して `workflow` フェーズを `in_progress` に戻す。親を `mark-ask` する他の場面(`failed` の 2 回目、解消できないコンフリクト)も同じである。
  - 選択肢は、判断を示して続ける・委譲の指定を変えて続ける・中止とする。「判断を示して続ける」は、担い手が問いを返したときだけ出す。
  - 続けるときは、サブの state を `resume` しない(`awaiting_human` ではないため。`codiel-state.ts:1299-1302`)。進みの表のそのサブを「実行中」に戻し、次のサイクルで新しいエージェントに、止まった場所から着手させる。
- 「判断を示して続ける」が選ばれたら、担い手が返した問いと選択肢の材料で 2 問目を聞く。
- 「委譲の指定を変えて続ける」が選ばれたら、オーケストレーターが運用方針に従って指定を選び直す。人が指定を示したときはそれを使う。置き換えるのは、断ったか失敗した役割の指定だけとする。置き換えた指定は進みの表のそのサブの項目に役割ごとに記録し、以後のサイクルと、その役割を使うレビューと修正の Workflow でも使う。
- `failed` のサブは、worktree とサブの state を残したまま、次のサイクルで新しいエージェントに、止まったフェーズから 1 回だけやり直させる。state が壊れているときは `sub-reset` で作り直す。2 回目も `failed` なら、親を `mark-ask` して「再試行」か「委譲の指定を変えて続ける」か「中止」を聞く。スキーマに沿わない返答(`agent()` が null)には、担い手が断った場合も含まれるためである。中止は親 run の `stop` にする。
- 親 run を止めた後の新しい try(ADR-014 の続きの try)は、次のように扱う。
  - 親ブランチへマージ済みのサブは済んだものとし、そのコードは現行どおり carry-over で評価する。
  - 未マージのサブは、stop の後のオーケストレーターの後始末(現行の `skills/orchestrating-runs/SKILL.md:301-307`)で worktree とブランチが消えるので、design からやり直す。CLI の `stop` は片付けを行わない。
  - 親の `init` は、親の run ID に加えて、親の state の対応表にあるサブの run ID の未解決の STOP も調べる。「STOP の後の try は人の承認の後に作る」という不変条件(`codiel-state.ts:905-942`)をサブにも当てるためである。
- `resumeFromRunId` は、Workflow 自体が中断されたとき(セッションの中断・スクリプトの修正)にだけ使う。完了した `agent()` の結果は再利用されるので、`awaiting-human` を返したサブのやり直しには使わない。
- 2.0 の Auto Ask が有効なら、Raguel の ASK はエージェントの中で Jev が裁定するので、サブ intent は止まらない。新しい画面名は Auto Ask でも人に回す。

### 3.7 レビューと修正の Workflow は、サブごとに観点のレビュアーと修正の担当を分ける

- スクリプトは `workflows/review-fix-subs.js` として同梱する。各サイクルで、そのサイクルに PR を出したサブを対象にする。
- サブ PR ごとに、次の順で進める。
  1. 現行の review の観点(`references/review-common.md` の規則で選ぶ)ごとに、レビュアーのエージェントを並列に起動する。レビュアーはサブの worktree を読むだけで、`codiel-state` を呼ばない。
  2. サブごとに 1 体の修正担当エージェントが、所見をまとめて `review-<m>.md` を書き、review と fix-loop の state 遷移およびゲートを担う。
  3. critical と high の所見が残る間、再レビューと修正を繰り返す。上限は現行の `maxFixAttempts` に従う。上限を超えたら `awaiting-human` を返す(3.6)。
- レビュアーと修正担当には、3.4 の委譲の指定のうち、レビューと修正の役割の分を使う。
- スキルの読み方、Raguel MCP のツールが無いときの `gate-pending` の経路、戻り値の形は、3.4 と同じにする。
- 修正担当の契約には、任せる判断(所見の採否と直し方。材料は所見・intent・サブの設計書)と、修正の push、github モードでの所見と返信の投稿(画像のアップロードを含む)、Raguel のゲートの評価を作業として明記する(1.1 の D10)。
- github モードでは、所見を現行どおりサブ PR に投稿する。local モードでは `review-<m>.md` に残す。
- medium と low の所見は、親 run の triage でまとめて扱う。

### 3.8 マージはサブの worktree でコンフリクトを解消してから行う

サブのレビューと修正が済んだら、オーケストレーターが次の順にマージする。サブの worktree の操作は、3.3 のとおり `git -C` かサブシェルで行う。

1. github モードでは、メインの作業ツリーで親ブランチを fetch し、fast-forward する。git は、別の worktree でチェックアウト中のブランチを更新できないので、親ブランチの更新はメインの作業ツリーでだけ行う。
2. サブの worktree で、親ブランチをサブのブランチへマージする。github モードでは `origin/codiel/<親 slug>`、local モードではローカルの `codiel/<親 slug>` をマージする。コンフリクトはここで解消する。
3. マージしたサブのテストを、サブの worktree で実行する。失敗したら、`sub-reset --from fix-loop` でサブを作り直し、次のサイクルのレビューと修正に戻す。
4. 親ブランチへ入れる。
   - github モード: サブのブランチを push し、`gh pr merge --merge` でサブ PR を親ブランチへマージする。その後、メインの作業ツリーで親ブランチを fetch し、fast-forward する。
   - local モード: メインの作業ツリーで `git merge --no-ff codiel/<親 slug>--<サブ slug>` する。
5. 進みの表のそのサブを「マージ済み」にし、サブの worktree とブランチを片付ける。サブの結末は親 PR と一緒に記録する(4 章)ので、ブランチは残さなくてよい。

- 解消できないコンフリクトは、親を `mark-ask` して人に聞く。選択肢は「サブを親の新しい HEAD から implement でやり直す」と「中止」である。やり直すときは `sub-reset --from implement` で作り直す(3.2。test-code までのコミットを新しいブランチへ cherry-pick する)。
- 手順 2 で解消したコードはサブのゲートを通らないが、`workflow` フェーズの評価(全サブをマージした後の `evaluate_code`)で親ブランチ全体として評価する。
- 全サブのマージが済んだら、`workflow` フェーズを `evaluate_code` で評価する(3.1)。

### 3.9 親ブランチでの後工程は通常の run と同じ

- test-loop: 親ブランチで、記録された全テストの回帰を実行する。
- intent-sync: 持続層と 1.1 の設計資料を、親 run で 1 回だけ更新する。
  - 入力は、標準のサブの design.md、軽量のサブの intent の `## 実装方針`、親ブランチの差分である。複数のサブが同じ種別の設計資料に当たるときも、親ブランチの差分(統合された姿)を正にする。
  - 受け入れ基準の変更などの書き戻しは、親 intent と、該当するサブ intent に行う。
  - `evaluate_design` に渡すパスの上限は、1.1 で 50 件に上げてある。サブが多く 50 件を超えるときは、intent-sync で変えたファイルだけを渡す。
- pr: github モードでは、親ブランチからベースブランチへ PR を出し、本文に各サブ PR へのリンクを含める。local モードでは現行どおり PR を作らない。
- review・fix-loop: 親ブランチ全体の差分に対して行う。サブ PR では見えない結合の問題を拾うためである。
- triage: 親 PR の所見と、サブ PR の medium・low の所見を扱う。
- finalize: 親 intent と全サブ intent の `status` を `done` にし、残った worktree とブランチを片付ける。`workflow` フェーズを抜ける時点で全サブはマージ済みなので、未マージのサブは残らない。

### 3.10 再開

- 同じセッションの中で中断した Workflow は、`resumeFromRunId` で再開する。
- セッションをまたぐときは、親の state とサブの state から、着手できるサブと再開するサブを集めて新しいサイクルを始める。
- 現行の `skills/orchestrating-runs/references/resume.md` に、サブの state を読む手順を足す。

### 3.11 現行コードとの接点と変更

| 対象 | 現行の挙動 | 1.2 での変更 |
| --- | --- | --- |
| `src/codiel-state.ts` の `STAGES`・`GATED`(`:163-194`) | 1 本のステージ表 | `workflow` を discuss と design の間に足す。`init` が `mode` に応じて `SKIPPED` を作る(3.1) |
| `readState`(`:276-293`) | carry-over の欠けを補う | `workflow` の欠けを `SKIPPED` で補う |
| `main` のルート(`:840`) | cwd をそのままルートにする | 1.1 で `findMainRoot` で解決する形になっている |
| `continuityProblem` と `sub-reset` | — | 作り直した state の最初のフェーズは `rebaseHead` と照らす(3.2) |
| `wait-done`(`:1373-1376`) | `waits/<id>.md` が無ければ失敗する | 変えない。Workflow の戻り値をこのファイルに書く(3.6) |
| `init`(`:886-962`) | 同時に 1 run。前の try の STOP を `unresolvedStops` で調べる | 親の run ID に加えて、進みの表のサブの run ID の未解決の STOP も調べる |
| `continuityProblem`(`:770-815`) | 直前のゲート付きステージに `passedHead` が無ければ照合をやめる | `SKIPPED` を飛ばして探す。`workflow` の開始では discuss の文書のコミットだけを許す |
| `start-phase`(`:1029-1037`) | 前のステージがすべて passed であることを求める | 変えない(`SKIPPED` は passed の一種) |
| `pass-gate`(`:1113-1200`) | メインの作業ツリーの HEAD と `<runsDir>/<runId>/` で照合する | `--sub` のときは、サブの worktree と `<runsDir>/<親 slug>/<サブ slug>/` で照合する |
| `close`(`:1445-1452`) | 例外は carry-over の `SKIPPED` だけ | モードの `SKIPPED` も例外にする |
| `mark-ask`・`resume`・`set-domain`・`wait-*` | run 全体が対象 | `--sub` でサブの state だけを対象にできる |
| 新設 | — | `--sub`、`sub-reset`、進みの表、`mode` |
| `src/raguel-records.ts` の `CODE_PHASES`(`:18-24`) | code 系の集合 | `workflow` を足す |
| `src/hooks/guard-write.ts` | `CODE_PHASES`・`TEST_GUARD_PHASES`(`:31,39`)、worktree の判定(`:47,435-446`)、記録されたテスト(`:152-169`)、`state.intent` の例外(`:328`) | `workflow` を足す。サブの worktree はサブの state で判定し、サブの worktree の `spec.md` を読む。`state.intent` の例外を登録したサブ intent に広げる。`workflow-` の待ちの間はメインの `.codiel/` の外を ask にする(3.3) |
| `src/hooks/guard-bash.ts` | push の判定(`:1218-1233`)は 1 つの run だけを見る。作業ディレクトリの候補(`:793-831`)は state.json の保護にだけ使う | 親の `workflow` の親ブランチの push、サブの push を許す。`git -C` を候補に加え、候補からサブの state を選んでフェーズの判定に使う。サブの文脈で refspec の無い push を拒否する |
| `src/hooks/guard-github-mcp.ts`(`:30-46`) | 現在の run のフェーズで PR の作成を判定する | head ブランチ `codiel/<親>--<サブ>` でサブの state を引く |
| `src/hooks/lib.ts` の `ghPostPhaseProblem`(`:46-59`) | push は pr・fix-loop・triage・finalize、PR は pr | 3.3 の許可を足す |
| `raguel-mcp/src/codiel/phases.ts`(`:35-62`)と 2 者比較のテスト | 1 本の表 | `workflow` の行を足し、後ろの `stage` を 1 ずつ大きくする |
| `skills/raguel-gating/references/outcome-sync.md` | トップレベルの run の評価を選んで結末を記録する | 4 章のとおり、親の選び順とサブへの記録を足す |

## 4. Raguel への影響

- `workflow` フェーズの追加(3.1)。
- サブごとの run ID でケースファイルを分ける(3.2)。`evaluate_*` の `repoPath` にサブの worktree を渡す。
- 結末の同期(`skills/raguel-gating/references/outcome-sync.md`)を改める。
  - Workflow モードの親の評価の選び順を、fix-loop → test-loop → workflow の順にする。
  - 親の結末を記録したら、親の state の対応表を読み、各サブの run ID にも同じ結末を記録する。サブの評価の選び順は fix-loop → test-loop → implement → test-code とする。
  - サブ PR から親ブランチへのマージは最終の結末ではない。サブの結末は、親 PR がベースブランチにマージされたとき(approved)か、閉じられたとき(rejected)に記録する。
  - local モードでは、現行の判定(親ブランチがベースブランチに入ったか。`outcome-sync.md:10-18`)で親の結末を決め、サブにも同じ結末を記録する。
- 契約の変更点を `docs/raguel-contract.md` に反映する。`raguelContract` の値は上げない(3.1)。
- ケースファイルは一時ファイルからの rename と追記で書くので、run ID が分かれていれば並列の評価で壊れにくい(`raguel-mcp/src/casefile/store.ts:99-103,440-451`)。1 つの MCP サーバーのプロセスが同時の呼び出しをどう扱うかは確かめる【要確認: S3】。

## 5. 私の判断

次はユーザーとの合意ではなく、この設計書の執筆者(オーケストレーター)の判断である。

| 番号 | 判断 | 判断の軸 |
| --- | --- | --- |
| J1 | サブ intent ごとに state を分ける(3.2)。親の state を 1 つにして Workflow の間だけ hook を緩める案は採らない | サブ intent ごとの再開と ASK の切り分けができるか。緩める案は hook の改修が小さいものの、1 つの ASK で全体が止まり、サブ intent 単位でやり直せない |
| J2 | ステージ表を 1 本のまま `workflow` を足し、モードに合わないフェーズを `SKIPPED` で作る | Raguel の表と 2 者比較のテストを 1 本のまま保てる。`isLegacy` を変えずに済む。モード別の表にすると、codiel-state・hook・Raguel の構造が二重になる |
| J3 | `workflow` の開始の連続性は、discuss の文書のコミットだけを許す形にする | try-2 以降で discuss のコミットが必ず入る。検査を外すと、引き継いだコードの評価(carry-over)の後に別の変更が紛れ込める |
| J4 | サブの worktree は codiel が作り、ブランチ名を `codiel/<親>--<サブ>` にする | `isolation` の worktree は起点を呼び出しごとに合わせられず、置き場が hook の判定の形に当たらない。git の ref の衝突を避ける |
| J5 | guard-bash はコマンドの `cd` の行き先と `git -C` でサブを見分ける | PreToolUse はコマンドの実行前に発火し、サブエージェントでは `cd` が引き継がれない。既存の仕組みを使い回せる |
| J6 | サブの中のステップは直列に進める | 1 体の文脈で design から test-loop までを通す形が、Workflow のエージェントの性質(Agent の有無が未確認)に依らず成り立つ |
| J7 | 依存はサイクルで解き、止まったサブは独立したサブを塞がない | 依存先の未マージのコードの上に積まない。1 つの ASK で全体を待たせない |
| J8 | サブの中止は親 run ごと止め、未マージのサブは次の try でやり直す | サブだけを外すと親の受け入れ基準が欠け、ユーザーの意図が変わる。サブ単位の try を作ると、run ID と STOP の扱いが二重になる |
| J9 | 人への確認は Workflow の後にまとめて行い、やり直しは新しいサイクルで行う | Workflow の中ではユーザーと話せない。`resumeFromRunId` は完了済みの結果を再利用する |
| J10 | マージの前にサブの worktree で親を取り込み、`gh pr merge` でマージし、ローカルの親ブランチを fast-forward する | GitHub の上でサブ PR を確実にマージ済みにする。コンフリクトの解消をサブのテストで確かめてから親へ入れる。次のサイクルの worktree の起点を最新にする |
| J11 | local モードでは PR の代わりにサブのブランチを使う | 現行の local モードは PR を作らず、記録をファイルに残す |
| J12 | サブ intent の規模は分解案で決め、親 run の規模は常に標準にする | discuss を親でまとめるので、design を飛ばしてよいかはサブ intent ごとに違う |
| J13 | Workflow のスクリプトは名前付きで同梱し、`args` と戻り値だけで完結させる | スクリプトを毎回生成すると run ごとに構成がぶれる。2.0 の Loop から子として呼べる |
| J14 | 親 Issue とサブ Issue の起票は codiel が行い、issue-craft を呼ばない | issue-craft にはサブ Issue をつなぐ機能が無い。全文の承認は codiel の承認ゲートで取れる |
| J15 | 親 Issue 起点は github モードだけで受け付ける | local モードには Sub-issues の構造が無い |
| J19 | 親 Issue から始めるときは、サブ Issue をすべて取り込むのを既定にし、外すものを承認ゲートで選ばせる | 親を指定したのはユーザーなので、配下のサブ Issue は対応の対象と見なせる。関係の無いサブ Issue だけを外せるようにする |
| J16 | サブの結末は親 PR の結末と一緒に記録する | サブ PR のマージは親ブランチへの取り込みで、ベースブランチに入るかは親 PR で決まる |
| J17 | `raguelContract` は上げない | 変更はフェーズの追加だけで、記録の形式は変わらない。上げると進行中の run がすべて止まる |
| J18 | サブの design ではユーザーとのウォークスルーを行わない | D7 で design 以降をエージェントに任せた。Workflow の中では人と話せない |

## 6. 採らなかった案

ユーザーが選ばなかった案を残す。再提案しない。

- Workflow の各エージェントが、サブ intent ごとにそれぞれの run を行う案
- discuss から test-code までを親 run でまとめて行い、Workflow は実装だけを担う案
- 各エージェントが新しい画面名を自分で決めて記録する案
- 親 PR をレビューせず、サブ PR のレビューだけで済ませる案
- 規模が大きいと AI が判断したときに、承認ゲートで Workflow を選ばせる入り方
- 親 intent のパスからだけ始められるようにし、親 Issue の番号を受けない案

## 7. 影響範囲

| 層 | 対象 |
| --- | --- |
| 指示層 | `commands/run.md`(`--workflow`)、`skills/orchestrating-runs/`(Workflow の有無の判定・Workflow の `args` の形(委譲の指定を含む)・`workflow` フェーズ・サイクル・人への確認・中止・マージ・再開)、`skills/capturing-intent/`(分解と一括承認・親 Issue 起点・起票の経路)、`skills/raguel-gating/`(サブの run ID・`repoPath` の対応表)と `references/outcome-sync.md`、`skills/syncing-intents/`(複数の design.md)、`skills/filing-followup-issues/`(サブ PR の所見)、`skills/reviewing-diffs/` と `skills/fixing-review-findings/`(レビューと修正の Workflow での分担)、`skills/facilitating-design-discussions/`(サブではウォークスルーを行わない旨) |
| 同梱スクリプト | `workflows/implement-subs.js`・`workflows/review-fix-subs.js`(新設、手で書く)。スキルが Workflow を呼ぶ許可の宣言 |
| 他のプラグイン(別の改修) | agent-policy と better-agentics の G3・G7・G12(`harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`) |
| 参照層 | `references/intent-format.md`(`parent`・`depends`・`run`・`status` の `in-progress` の時点・親を参照するマーカー。`docs/format-change-checklist.md` を追随させる)、`references/intent-common.md`(起票の経路とサブ Issue のつなぎ) |
| 実装層 | `src/codiel-state.ts`(`mode`・`workflow` フェーズ・`init` の `SKIPPED`・連続性の検査・`--sub`・サブの run ID の対応表・pass-gate の基準・親の `init` のサブの STOP の検査)、`src/raguel-records.ts`(`CODE_PHASES`)、`src/hooks/guard-write.ts`・`guard-bash.ts`・`guard-github-mcp.ts`・`lib.ts`(3.3)、サブ Issue をつなぐ新しいスクリプト |
| テスト | `workflows/*.js` の構文の検査(スクリプトの本文を非同期関数として組み立てて構文エラーを検出し、`meta.name` を確かめる vitest のテスト) |
| ワークスペースの設定 | `biome.json` の対象から `plugins/*/workflows/**` を外す。Workflow のスクリプトはトップレベルの `return` と大域名(`agent`・`args` など)を使うためである。変更後に `pnpm run typecheck`・`pnpm run lint`・`pnpm run test` をすべて通す |
| Raguel | `raguel-mcp/src/codiel/phases.ts`(`workflow` フェーズ。`phaseSchema` は `tools/shared.ts:29-30` で表から導出されるので追随する)、2 者比較のテスト、`docs/raguel-contract.md` |
| 文書 | `README.md`、`docs/DESIGN.md`、`docs/skill-flowcharts.md`、ルートの `README.md` |
| 配布宣言 | `.claude-plugin/plugin.json` と `package.json` を 1.2.0-dev にし、リリース時に 1.2.0 にする |
| ARCHITECTURE | ディレクトリ構成に `workflows/` を足す。「run は親 intent に 1 つ、サブ intent は state を分けて Workflow で並列に進める」は ADR の候補になる。どちらも `metatron:updating-architecture` を起動して扱う |

## 8. 確かめる事項

実装計画の最初に、次を確かめる小さな試作(スパイク)を置く。

| 記号 | 確かめること | 結果が想定と違うときの扱い |
| --- | --- | --- |
| S1 | Workflow のエージェントが使える tools(Agent・Skill・Raguel MCP の有無)。エージェントの終了で Stop と SubagentStop のどちらが発火するか | Skill が無ければ、3.4 のとおりスキルをパスから読ませる。Raguel MCP を呼べなければ、ゲートを `gate-pending` の経路でオーケストレーターが通す(3.4)。Stop が発火するなら、stop-guard を `agent_id` のある入力で通す |
| S2 | Workflow のエージェントの tool 呼び出しで、hook の入力に `agent_id` が入るか。`agent()` の起動で SubagentStart が発火するか | `agent_id` が入らなくても 3.3 の判定は成り立つ。補強に使わないだけである。SubagentStart が発火しなければ、SubagentStart で規律を注入する運用方針は、前置きで規律を渡すことになる |
| S3 | 複数のエージェントが同時に Raguel MCP の `evaluate_*` を呼んだときの挙動 | 同時に扱えないなら、サブのゲートの呼び出しを直列にする仕組み(ロックファイル)を Raguel に足す |
| S4 | GitHub の Issue の依存関係(blocked by)を `gh` で読み書きできるか | 読めなければ、2.6 の AI の依存の案に頼る |
| S5 | プラグインの名前付き Workflow を、スキルから呼ぶときの許可の宣言と確認の出方。`workflow()` の子として呼べるか | 子として呼べなければ、2.0 の Loop は子を呼ばずに同じ処理をスクリプトに書く |
| S6 | Workflow のエージェントの中で `evaluate_*` がバックグラウンドへ移されるか | 移されるなら、3.6 の `gate-pending` の経路を使う |
| S7 | 運用方針の定義を渡したエージェントが、契約で任せた判断で差し戻さないか。契約に明示した外部への操作(push・PR・投稿・画像のアップロード・Raguel の評価)を拒まないか | G3 の改修は、S7 の結果によらず 1.2 のリリースの前提である(食い違いの文書の 4 章)。任せた判断で差し戻すなら、構造が変わる判断の差し戻しも 3 章から G3 に戻す。codiel 側の対処は書かない(1.1 の D1)。agent-policy は役割断片の制約も定義の本文に入るので、生成した定義で試す |

## 9. 既知の限界

- Workflow の中ではユーザーと話せないので、人への確認はサイクルの終わりまで待たされる。
- 1 体のエージェントが 1 つのサブ intent を design から test-loop まで直列に進めるので、サブ intent が大きいとエージェントの文脈が溢れる。分解の粒度が、そのまま 1 体の作業量の上限になる。
- サブの design は、ユーザーのウォークスルーを経ない。
- サブの中止で親 run を止めると、未マージのサブの作業は次の try でやり直しになる。
- 親 PR の review は、サブ PR の review と範囲が重なる。
- `workflow` の評価は全サブの差分をまとめて見るので、既定の `code/max-diff-lines`(500 行)と `common/max-size` で ASK になりやすい(`raguel-mcp/src/rules/params.ts:129-134,184-188`)。
- 1.2 のままでは、別のセッションで別の親 run を同時に動かせない。
- 委譲の指定で渡された定義が書き込みか Bash を持たないと、そのサブは `failed` になる。指定を変えずにやり直すと再び失敗し、親の人の判断待ちに至る(3.6)。Raguel MCP と Skill が無い定義では、3.4 の経路で続く。
- Raguel MCP の無い定義では、ゲートのたびに Workflow が終わるので、1 つのサブに 6 回前後のサイクルがかかる。
- 依存しないサブは同時に進むので、サブをまたいでテストが同時に走る。1.1 の「`parallel: true` の仕様のディレクトリだけを同時 4 件まで」はサブの間には当たらず、テストがポートや DB を取り合いうる。
- レビューの指定は観点によらず 1 つなので、観点ごとに定義を変えることも、1 回のレビューに複数の定義を当てることもできない。

## 10. ビルダーに任せること

- `codiel-state` の `--sub` のサブコマンドの細部と、サブの run ID の対応表の持ち方。
- Workflow のスクリプトの戻り値のスキーマの細目と、サイクルの組み立ての細部。
- 親を参照するマーカーの文字列。
- サブ Issue の本文の依存の書き方。

## 11. 実装計画で詰める事項

2026-11-09 の再レビューで残った所見である。設計書の水準では閉じず、実装計画で現行のコードとスキルに当てて詰める。

- 修正担当が `undecided`・`declined`・`failed` で止めたサブの戻し先。止まる前は「PR 済み」で、3.6 のとおり「実行中」に戻すと、3.5 の手順 2 で実装の Workflow に乗る。レビューと修正の Workflow に戻す経路が要る。
- 観点ごとに並列に起動したレビュアーのうち、一部だけが `undecided`・`declined`・`failed` になったときの扱い。サブの結果のまとめ方(修正担当へ進むか、サブを止めるか)と、`review-fix-subs.js` の戻り値の形。レビューの指定は観点によらず 1 つなので、置き換えると全観点に当たる。
- 軽量のサブで、任せる構造の選択の材料。軽量のサブは design を飛ばし(3.4)、設計は intent の `## 実装方針` にある。3.4 の材料(design.md・dev-plan.md)に、これを加えるか。
- S7 を G3 の改修の前に走らせること。改修の後の定義で試しても、「依頼文に無い判断」の読み方だけで差し戻しが外れたことの確認にならない。

## 出典

- ユーザーの予定表(2026-11-08 の会話で貼り付け): 「Dynamic Workflowモード (implフェーズ) 親Intentを起点に、そのサブIntentを全て対応するUltracode。各IntemtはWorktree内で対応し、PRを出し、レビューし、修正するループを回す。他のIntentに依存しない限り並列で実行する。」「Workflow Intentsモード(intentフェーズ) gh-utilityの吸収。gh-utility単体は残す。Dynamic Workflowモードの起点となる親Intentの起票とタスク分解して親にぶら下がるサブIntentの起票、GitHubモードの場合はGitHubに親Issueの起票とサブIssueの起票を行う。引数省略RunのWorkflow対応版であり、issueを起点としたintentフェーズには適用しない。」
- ユーザーの補足(同日): 「Workflowで起動された各エージェントがそれぞれのRunを行うのではなく、親Intentに対する1つのRunで複数Intent(サブIntent)を対応するということです。親Intent用のブランチを用意し、各サブIntentはそこに対するPRを出します。」
- Claude Code の仕様: https://code.claude.com/docs/en/sub-agents.md 、https://code.claude.com/docs/en/workflows.md 、https://code.claude.com/docs/en/hooks.md 、https://code.claude.com/docs/en/worktrees.md 、https://code.claude.com/docs/en/agent-sdk/typescript.md (2026-11-08 に取得)、Claude Code 2.1.319 のツール説明文、`~/.claude/plugins/cache/claude-plugins-official/claude-security/0.12.0/`
- ユーザーの指摘(同日、D14): 「委譲先のエージェント定義をWorkflowで起動すればいいだけなので」「そもそも委譲先を決定してからWorkflowを起動する旨の規律をCodielに書く必要はないです。」
- 会話記録: `docs/chat/2026/1107/phyllis998/2356-codiel-1-1-to-2-0-design-kickoff.md`
