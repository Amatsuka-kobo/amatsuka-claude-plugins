`plugins/codiel` (1.0.0) — intent-driven orchestrator: 変更ごとの intent 文書(`docs/intents/`)を起点に、
design discussion, planning, implementation, testing, intent-sync, PR and review を同梱の `raguel` MCP server の
ゲートつきで進める。`/codiel:run` の入口は Issue 番号・intent パス・省略の 3 形で、GitHub を使えない環境は
local モードで進む。 The largest plugin here. Flow spec: `plugins/codiel/docs/DESIGN.md`
(§0 states the no-Anthropic-API invariant, `mem:core`); flowcharts were pulled out into
`docs/skill-flowcharts.md` (commit 86b9483). MCP internals: `mem:codiel/raguel_mcp`.

## 2026-08-16 の再編 — ARCHITECTURE / GOTCHAS は metatron の管轄になった

- **`docs/ARCHITECTURE.example.md` / `docs/GOTCHAS.example.md` は codiel から削除され metatron へ移った**
  (`plugins/codiel/docs/` に残るのは `DESIGN.md` と `skill-flowcharts.md` の 2 本だけ)。
- **ドメインマップのマーカーは ` ```json metatron:domains ` に変わった。旧 `codiel:domains` は読まない**
  (互換読みを一切設けない)。書式・ルート解決の正本は `mem:file_contract`。
- **GOTCHAS は新書式**: 本文は `タスク / 失敗内容 / 原因 (推測) / 対策 / 昇格候補` の 5 フィールドのみ。
  関連ファイル欄・関連エントリ欄・Codiel フェーズ名欄は**持たない**(必要ならすべて `対策` の本文へ)。
  タグは `[解決済み]` / `[対象外]` の 2 種だけを `GOTCHA-NNN:` の直後に置く。
- `install-harness.sh` は **`.codiel/{runs,reports}` と `.codiel/config.json`(無ければ `{ "testsDir": "docs/codiel/tests", "runsDir": "docs/codiel/runs" }`。`raguel` と `.gitignore` の行は `initializing-harness` が承認を得て足す)を作るだけ**。GOTCHAS は生成せず、台帳の生成は metatron が担う。
  テストの仕様の置き場は config の `testsDir`(既定 `docs/codiel/tests`)の下にある。run の文書(agenda・discussion・design・dev-plan)は `<runsDir>/<slug>/` に try で分けずに置き、コミットする。
  try ごとの `state.json`・`steps/`・`reports/` は `.codiel/runs/<slug>/try-<n>/`、`/codiel:test` の報告は `.codiel/reports/` に置き、`.gitignore` で外す(2026-09-29、M4-C。ADR-009)。
  Raguel の設定は config.json の `raguel` にあり、以前の版の YAML の設定ファイルは読まれない(init が承認を得て写してから消す)。
- GOTCHAS の記録は metatron の `metatron:recording-gotchas` に委ねる(codiel の `recording-gotchas` スキルは 2026-09-27 に削除)。codiel が持つのは記録の契機(Raguel の STOP・ループ上限超過・incident・レビューで発覚した設計漏れ)と、CLI の案内が無いときの退避(「未記録の GOTCHAS」を `<runsDir>/<slug>/unrecorded-gotchas.md`(run が無ければ `.codiel/reports/unrecorded-gotchas.md`)と完了報告へ持ち越す)だけで、`orchestrating-runs` の `references/failures.md` にある。

## `/codiel:init` — 保護パスだけを確認する

`/codiel:init` は ARCHITECTURE を生成・修復しない。簡易な ARCHITECTURE の生成と JSON 修復を
削除し、聞き取るのは保護パスだけとした。ドメイン分割は聞かない。ARCHITECTURE の作成と更新は
metatron が行う。

ARCHITECTURE にある ` ```json metatron:domains ` のドメインマップは、codiel が実行時に読み取る。
マーカー名とドメインマップの存在は事実として扱うが、codiel が ARCHITECTURE に書き込むことはない。

「初期化済み」の判定に ARCHITECTURE は使わない。B = `.claude/rules/codiel.md`(運用の規律。init が
`assets/rules/codiel.md` から置く。paths 指定なし)と、CLAUDE.md に行全体が `## Codiel` と一致する見出し
(置き場の地図と入口だけ。`CLAUDE.example.md` が雛形)、C = `.codiel/config.json` が JSON のオブジェクトで `raguel` がオブジェクト、D = `.codiel/runs`・`.codiel/reports` の存在と `codiel-state gitignore` の `missing` が空、で
判定する(設計書の決定 70、M4-C の決定 87・93)。`/codiel:run` の §0 も C・D を見て、欠けたら `/codiel:init` を案内する。旧セクション「## Codiel ハーネス運用ルール」は前方一致でも B を満たさず、
init が差分を示して承認を得てから取り除く。

## `/codiel:run` のドメインモード

`/codiel:run` はドメインマップが無くても開始できる。実行モードは 2 つある。
`mapped` は有効なドメインマップに基づいて境界を課すモード、`unscoped` は境界を設けないことを
run 開始時に明示選択したモードである。選択したモードは run state の `domainMode` に記録する。

## 2 つのルート概念(混同しない)

| 関数 (`src/hooks/lib.ts`) | 基準 | 用途 |
| --- | --- | --- |
| `findDocRoot(startDir)` | 契約 §3 規則 1(`metatron.config.json` を持つ祖先 → git ルート → 開始ディレクトリ) | **文書**(ARCHITECTURE / GOTCHAS)の解決 |
| `findProjectRoot(startDir)` | `.codiel` を持つ祖先 | **codiel 固有資産**(`.codiel/runs` 等)の解決 |

どちらを使うかは「探しているものが文書か codiel 資産か」で決まる。
`lib.ts` は他に `resolveDocPaths` / `readDomainsResult` / `readDomains` / `DOMAINS_MARKER` /
`globToRegExp` を持つ。

**`guard-write` は 2 つの相対パスを持つ(2026-08-17。同じ `rel` で兼ねない)。**

| 変数 | 基準 | 判定対象 |
| --- | --- | --- |
| `codielRel` | `findProjectRoot(cwd)` = `codielRoot` | `.codiel/` 配下か、文書フェーズの `docs/` 判定、フェーズ外の書き込み |
| `repoRel` | `findRepoRoot(mainRoot)` = `repoRoot`(git ルート) | `state.intent` との一致、`docs/intents/**`、テストの保護と `<testsDir>/` |
| `docRel` | `findDocRoot(cwd)` = `docRoot` | **ドメイン境界の glob 照合のみ** |

(M4 で 3 つになった。書き込み先が `.codiel/worktrees/<slug>/<名前>` の中なら、3 つとも worktree のルートを基準に取り直す。
run は常にメインの作業ツリーで探す: `findMainRoot(cwd)` は git を呼ばず、パスが `/.codiel/worktrees/` を含めば
その手前を、含まなければ `findProjectRoot` を返す。linked worktree で run を始めても run が見つかるようにするため。)

ドメインマップは ARCHITECTURE に書かれ、ARCHITECTURE の位置は契約 §3 規則 1 の `docRoot` で
決まる。したがってそこに書かれた glob は `docRoot` 相対と読むのが唯一整合する
(metatron の `scan` も同じ)。`codielRel` で照合すると、`docRoot ≠ codielRoot` の構成
(`repo/.codiel` + `repo/sub/metatron.config.json`)で担当範囲内の書き込みが `ask` に落ち、
`docRoot` 外のパスが範囲内として通りうる。

**`readDomains` は契約 §1 の検証 4 項目を行う。** 以前は JSON として parse できただけの値を
返し、形の検証は `guard-write` の `toDomainMap` 側にあった。現在は `lib.ts` の
`validateDomainsValue` が担い、`guard-write` の `toDomainMap` は**プロトタイプなしのマップへの
詰め替えだけ**を行う(`Object.create(null)`。`toString` 等の継承プロパティと `__proto__` 対策)。
`readDomainsResult(startDir)` は `{ domains, warnings }` を返し、`readDomains` はその
`domains` だけを返す薄い包み。警告は重複ブロック・未閉フェンス・マーカーを呑み込む未閉フェンスの
3 種で、metatron の `findDomainsBlock` と**出る条件と件数を揃える**(文言も現状は一致)。

## Flow — 13 stages / 14 named phases

`intent → discuss → design → (test-spec, dev-plan) → test-code → implement → test-loop → intent-sync → pr →
review → fix-loop → triage → finalize`. `test-spec` と `dev-plan` は 1 つの並列ステージ(仕様のディレクトリを同定 → spec.md / cases.md の委譲を出して wait-add →
待つ間に dev-plan.md をオーケストレーターが書いてゲート → spec の完了通知で wait-done してゲート)。片方の委譲の待ちが残る間は mark-ask を
呼ばず、2 つとも ASK・STOP なら両方の裁定を記録してから resume する。

**委譲はバックグラウンド前提(2026-10-02、設計書 `harness-docs/design/2026-10-01-codiel-run-speedup-design.md` §10.2)**:
Claude Code の対話セッションでは Agent の委譲が常にバックグラウンドで起動し、完了は後のターンに通知で届く。委譲を出したら
`codiel-state wait-add`(id は try の中で一意、英小文字と数字のハイフン区切り)で待ちを記録し、通知を受けたら返答を
`.codiel/runs/<slug>/try-<n>/waits/<id>.md` と既存の報告に書いて `wait-done`(報告が無いと失敗する)。stop-guard は待ちが
1 件以上あれば止めない。再開時は `startedAt` より後の `waits/<id>.md` の有無で出し直しを決め、`wait-clear` する。`stop` は
待ちが残ると失敗し、`--abandon-waits` で通る。codiel-state は並列に呼ばない(ロックが無い)。
Raguel gates(`GATED` の 9 フェーズ)`intent`, `design`, `test-spec`, `dev-plan`, `test-code`, `implement`, `test-loop`, `intent-sync`, `fix-loop`.

### テスト駆動と並列実装(2026-09-28、M4。設計書 §6.6・§6.13、決定 72〜81)

- `test-code` は test-spec の仕様からテストを書き、implement の前に失敗することを確かめる。書いたテストのパスは
  `spec.md` の frontmatter の `tests` に記録する。E2E も implement で通す(通すテスト = unit + E2E)。
  worktree で走らないテストは、グループのマージの後に run ブランチで走らせる。
- テストの仕様は `<testsDir>/units/<パス>/` と `<testsDir>/e2e/{frontend,backend,cli}/<名前>/` に置く。
  `spec.md` の `parallel: true` が無い仕様のディレクトリは、ほかと同時に走らせない。新しい画面の名前だけは、候補を出してユーザーに聞く。
- implement は dev-plan の Step を `codiel-state waves` でグループに分け、グループごとに Step を `.codiel/worktrees/<slug>/<名前>` の
  worktree で並列に実装してマージする。`waves` が扱うのは `implement.steps` だけで、`testCode.units` と `testLoop.units` は対象外。
  dev-plan の `## 生成物` は方式 a(各 Step が生成物をコミット)か方式 b(既定。最後の生成だけの Step)を規約で選ぶ。
- `.codiel/config.json` の `testsDir`(既定 `docs/codiel/tests`)と `runsDir`(既定 `docs/codiel/runs`)は `readCodielConfig(codielRoot)` で読み、`codiel-state config` でも出る。`codiel-state gitignore` は必要な `.gitignore` の 6 行と欠けている行(`missing`)を出す。
- E2E のレポートは `<testsDir>/e2e/{frontend,backend,cli}/<名前>/reports/<YYYYMMDD-HHMMSS>-<slug>-try<n>/`(ローカルのタイムゾーン)に置き、`results.json` と `summary.md`/`failure.md` だけをコミットする。書式は `references/e2e-report-format.md`。
- 報告のファイル(`report.md`・`test-run-<n>.md`)は委譲先が最終の返答で返し、オーケストレーターが書く。
  オーケストレーター自身が実行したテストの結果と実行し直しも同じ報告に書く(implement のマージ後は `steps/merge-test-<g>/report.md`、
  intent-sync の控えと ADR 候補は `steps/intent-sync/report.md`)。
- step-add / step-update は `--kind step|test-code|test-loop` を取り、`implement.steps`・`testCode.units`・`testLoop.units` に分けて記録する。
`discuss`・`design` は scale light の run でだけ skip でき、`fix-loop` は所見が無ければ skip する。
run state は version 2(slug で識別。`--issue` は任意の記録)。version 1 の run と、`phases` に `test-code` を持たない
M4 より前の version 2 の run はどちらも `isLegacy` で、`get`・`stop`(`--reason migrate`)と、
`awaiting_outcome` の run の outcome の記録だけを受け付ける。読み込み時に `test-code` を補わない。
`mark-ask` は `in_progress` のフェーズと `pending` の finalize だけを受け付ける(途中の確認は
`mark-ask --kind confirm` → `resume`。stop-guard は `active` の run の停止を止める)。

**Human touchpoints are not limited to Raguel ASK/STOP.** `discuss` は常時 human-in-the-loop、
`design` は walkthrough + ユーザー承認を Raguel 評価の前に置く、`triage` は常にユーザー主導。
「codiel には固定の人間承認チェックポイントが無い」という旧記述は誤り。

### intent 文書と capturing-intent(2026-09-27 に上流の intent 用プラグインから統合)

上流の intent 用プラグインの `capturing-intent` スキル・参照文書・`check-intent-env` は codiel へ移り、そのプラグインは撤去された。
run の起点は intent 文書である(2026-09-27 の改修。設計書 `harness-docs/design/2026-09-27-codiel-intent-driven-design.md` の決定 1〜70)。
intent-sync フェーズは `skills/syncing-intents/` が、承認済みの受け入れ基準の変更と原文の追記を派生文のセクションへ書き戻す。

- `skills/capturing-intent/`: TOBE の聞き取り → ASIS 探索 → 分岐の合意 → intent 文書
  `docs/intents/YYYY-MM-DD-<slug>.md` の全文提示と承認 → 保存。
- `references/intent-format.md`(intent 書式の正本)/ `handoff-contract.md`(gh-utility `issue-craft`
  持ち込みモードの呼び出し契約)/ `intent-common.md`(基本方針・畳む経路・自前起票・失敗時)。
- 基本方針は「経路の選択はグレースフルデグラデーション、承認はフェイルクローズド」。使えない経路は
  理由 1 行で畳む。issue の起票は外部公開行為なので、環境がどれだけ縮退しても全文提示と明示承認を経る。
- `scripts/check-intent-env.mjs`(`src/check-intent-env.ts`)は判断を持たず、常に exit 0 で事実の JSON
  だけを返す読み取り専用スクリプト。ルート解決とドメインマップ読み取りは `src/hooks/lib.ts` の
  `resolveDocPaths` / `readDomainsResult` を import し、写しを持たない。旧版の `codielHandoffCandidate` /
  `codielHarness` / `testRunner` の出力は削除した。
- intent 文書は `repoRoot`(git ルート)基準、ARCHITECTURE / GOTCHAS は契約 §3 の `docRoot` 基準。
  2 つが別ディレクトリを指すのは正常な状態。
- metatron との 2 者比較テストは `src/__test__/check-intent-env.test.ts` の `expectTwoWayMatch`
  (詳細は `mem:file_contract`)。
- Issue を入口にしたときは capturing-intent が本文を読み、マーカー(`<!-- intent:v1 -->`・`<!-- codiel:generated -->`)で
  原文か派生かを決める。`analyzing-issues` と `issue.md` は廃止した。

## Agents — 同梱しない。作業内容で委譲する

codiel は同梱 Agent を持たない(2026-09-27。`codiel-analyst` と `codiel-test-designer` を廃止し、ADR-004 の
「2 体に絞る」部分を上書きした)。test-spec の書き込み範囲の制限は、依頼文と `writing-test-specs` 本文の規律が担う。
すべてのフェーズは Agent 名や役割名を指定せず、「成果物を書く委譲」「読み取りだけの委譲」など作業内容と
委譲の種別でサブエージェントへ委譲する。委譲先はセッションに注入された運用規律が選び、
規律が無い環境では読み取りだけの委譲を `Explore`、それ以外を `general-purpose` へ縮退する。

**委譲の線引き(2026-10-01、設計書 `harness-docs/design/2026-10-01-codiel-run-speedup-design.md` §5)**:
オーケストレーターは agenda.md・design.md・dev-plan.md・discussion.md・intent 文書(持続層を含む)を自分で書き、
プロジェクトの test コマンドと `units/` の仕様のディレクトリのテストを run ブランチで自分で直列に実行する。
spec.md / cases.md・テストコード・実装と修正・タスクレビュー・review・`e2e/` の実行は委譲を続ける。
コード(テストコードを含む)・spec.md / cases.md・レビューの所見をオーケストレーターが書かないという規律は、`orchestrating-runs` の本文に書く(2026-10-02 に HARD-GATE と Red Flags のセクションを廃止し、本文の手順へ移した。理由は DESIGN.md §6)。
ドメイン固有の観点は
`plugins/codiel/skills/implementing/references/{frontend,backend,data,infra}.md` と
`plugins/codiel/skills/reviewing-diffs/references/{frontend,backend,data,infra,doc,security,generic}.md`
に置く。review の観点は変更パスと内容から選び、doc と security は毎回、generic はどれにも当たらない変更パスがあるときだけ足す(規則は `orchestrating-runs/references/review-common.md`)。

## Skills (17) and commands (3)

Commands: `/codiel:init`, `/codiel:run`, `/codiel:test`.
Skills: `capturing-intent`, `preparing-design-agendas`, `facilitating-design-discussions`,
`writing-design-docs`, `writing-test-specs`, `writing-dev-plans`, `implementing`, `scripting-tests`,
`running-regression-tests`, `fixing-failures`, `syncing-intents`, `reviewing-diffs`, `fixing-review-findings`,
`filing-followup-issues`, `orchestrating-runs`, `raguel-gating`,
`initializing-harness` (+ その `config.example.json`)。
どのスキルも description の照合では起動されず、コマンド・`orchestrating-runs` の手順・依頼文から名前かパスで起動される
(そのため evals は持たない)。
全スキルは commit 86b9483 で prompt-smith 標準に書き直され、2026-08-16 に契約追随の改訂が入った。
2026-10-02 のコスト改修で、`orchestrating-runs` の本文は run の開始から要る §0〜§4(前提確認と実行モード、run の解決、フェーズ進行表、ディスパッチ規約、ドメインディスパッチ)に絞り、
フェーズ別・共有の手順を `skills/orchestrating-runs/references/`(`phase-<フェーズ名>.md`・`delegation-env.md`・`review-common.md`・`e2e.md`・`resume.md`・`failures.md`)へ切り出した。フェーズに入るときに読む。
ほかのスキルも HARD-GATE と Red Flags を持たず(その条項は本文の手順へ統合)、場面限定の手順は各スキルの `references/` にある。
GitHub の執筆規則は `references/github-writing.md` と、画像の載せ方の `github-writing-images.md`、PR 本文の `github-writing-pr.md` に分かれた。
フェーズの境目で委譲の待ち(`waits`)が空なら、ユーザーは新しいセッションへ移り `/codiel:run` で再開してよい(P7)。

## Hooks — phase-scoped, ask-by-default with hard denies

`hooks/hooks.json`: `PreToolUse(Bash)` → `guard-bash.mjs`; `PreToolUse(mcp__*github*__<書き込みツール 15 個>)` → `guard-github-mcp.mjs`; `PreToolUse(Edit|Write)` → `guard-write.mjs`; `Stop` → `stop-guard.mjs`.

run が active な間、GitHub へ投稿する本文(gh の issue/pr の 7 コマンド、`gh api` の body、GitHub MCP の書き込み)には
`<!-- codiel:generated -->` が要り、無ければ deny する(設計書の決定 53・60)。guard-bash はクォートと入れ子を追う字句解析で
gh の起動を探す。検査の範囲は決定 69(手順と自然な書き方のすり抜けと誤検知を直し、意図的な回避は設計書 §6.8 の既知の限界)。
本文は Write で run の `reports/` に投稿ごとに別名で書き、別の Bash 呼び出しで `--body-file` で渡す(決定 66)。
codiel の PreToolUse は**フェイルクローズド**(catch で `ask`)。metatron 側と方針が逆なので混同しない。

- 制限は**フェーズ単位でエージェント単位ではない**。フェーズ不一致は `ask`(偽陽性を許容)。
  無条件 `deny` は `rm -rf`、`curl | sh`、force push、main/master への push、
  shell からの `state.json` 書き込み、条件外の PR/issue 作成。
- `guard-write` は `intent`/`discuss`/`design`/`test-spec`/`dev-plan` などを文書フェーズとして扱う。`docs/intents/**` は
  直下の intent 文書と `domains/`(持続層)で許すフェーズを分け、active な run の `state.intent` は repoRoot 基準の
  パスで照合してどのフェーズでも通す。
- Phase state: `src/codiel-state.ts`(CLI エントリは `src/codiel-state-cli.ts` に分離。esbuild が
  ライブラリを hook へインライン化しても自己実行しないようにするため)。共有ヘルパは `src/hooks/lib.ts`。

### ドメイン境界の配線(2026-08-16、設計書 §16-5)

`RunState` に **optional な `domain?: string | null`** を追加した(version 据え置き。既存 state は
そのまま読める)。値がドメインマップに存在するかは**検証しない** — 判断は読む側 `guard-write` の責務。

- `codiel-state set-domain --domain <名前>` / `clear-domain` で操作する。**`clear-domain` は状態を
  問わず通る**(委譲中に run が `awaiting_human` へ落ちても解除できないと古い domain が残るため)。
- `guard-write` は CODE_PHASES(`test-code`/`implement`/`test-loop`/`fix-loop`)で `domain` が入っているときだけ
  境界を課す。worktree の中への書き込みでは `state.domain` を使わず、その worktree を記録した要素の `domain` を使う。
  境界より先にテストの保護を当てる: `implement`/`test-loop`/`fix-loop` の間、`<testsDir>/**/(spec|cases).md` と
  `spec.md` の `tests` に記録されたテストへの書き込みは `ask`。fix-loop だけ `codiel-state set-test-edit` で保護を外せる。
  config が不正なら、この 3 フェーズの書き込みをすべて `ask` にする(フェイルクローズド)。判定は `readDomains(cwd)`(契約 §1 の 4 項目はこの中で検証済み)→ `toDomainMap` で
  プロトタイプなしへ詰め替え → `globToRegExp` で **`docRel`(docRoot 基準)** を照合。
- 判定は **`deny` ではなく `ask`**(境界の誤りは人間が通せる余地があり、ドメインマップの記述漏れで
  正当な書き込みを止めたくないため)。ドメイン定義が無い・読めない環境では**新たに止めない**。
  ドメイン名がマップに無いときだけは材料が無いので `ask` で止める。
- **`.codiel/` 配下はドメイン境界の対象外。** 判定は **`codielRel`** で行う(運用資産の位置が
  基準であり、`docRel` ではない)。ハーネス自身の運用資産でありどのドメインにも属さない。
  免除が無いと、test-loop で domain 非紐付けと紐付けを往復するとき `clear-domain` の呼び忘れで
  `.codiel/runs/` の報告への正当な書き込みが黙って `ask` になる。

## Assets copied into target projects

`CLAUDE.example.md`(CLAUDE.md の `## Codiel` の雛形)と `settings.json` がプラグインルートに、
`assets/rules/codiel.md`(`.claude/rules/codiel.md` の雛形)が assets に、`scripts/install-harness.sh` が
`.codiel/` 3 ディレクトリの機械的配置を担う(hand-written、esbuild 出力ではない)。
ARCHITECTURE / GOTCHAS のテンプレートは**もうここには無い**(metatron へ移設)。
