---
name: orchestrating-runs
description: /codiel:run で GitHub Issue 駆動の開発 run を進行するとき使用。フェーズ進行・サブエージェントディスパッチ・Raguel ゲート・再開のすべてはこのスキルに従う
---

# Codiel run オーケストレーション

## 概要

`/codiel:run <issue番号>` はメインセッション自身がオーケストレーターとなり、Issue を起点に
init → discuss → design → test-spec/dev-plan → implement → test-loop → pr → review → fix-loop → triage → finalize
の全フェーズを進行させる。各フェーズの実作業(分析・設計・実装・テスト・レビュー)はすべて
専用サブエージェントにディスパッチし、成果物は Raguel MCP のゲートを経てのみ次フェーズへ進む。
オーケストレーター自身は「進行管理」のみを行い、コードも文書もレビューも自分では書かない。

Raguel ゲートの呼び出し規約(evaluate ツール対応・verdict 別ハンドリング・record_outcome の運用)は
すべて `raguel-gating` スキルに一元化されている。

設計工程は人間と共同で行う: discuss フェーズ(論点の合意)と design フェーズのウォークスルー
(設計書の確認)が常設の人間参加ポイントであり、進行規約は `facilitating-design-discussions`
スキルに一元化されている。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/orchestrating-runs`
である。**`<plugin-root>` はそのベースディレクトリの 2 階層上**。`codiel-state` は対象プロジェクトの
ルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --issue <番号>
```

## チェックリスト

- [ ] 0. **前提チェック**(下記)。満たさなければここで終了する
- [ ] 1. **outcome 自動同期**を行う(`raguel-gating` の「outcome の自動同期」節。起動時に 1 回のみ)
- [ ] 2. **run を解決する**: `codiel-state get --issue N` → 未完了 try があれば `state.phase` から再開。
      なければベースブランチを解決(ARCHITECTURE の「規約」節 → なければ main)→
      `git switch <ベース> && git pull --ff-only` → `codiel-state init --issue N --base-branch <ベース>` →
      `git switch -c <state.branch>`(詳細は「1. run の解決」参照)
- [ ] 3. 現在フェーズから、フェーズ進行表の定型(start-phase → ディスパッチ → 成果物検証 → raguel-gating
      でゲート → pass-gate/complete-phase)を順に実行する。ドメイン別のディスパッチは
      §4.1 の set-domain / clear-domain を伴う
      (discuss は raguel-gating を経ず、facilitating-design-discussions に従って進行し
      complete-phase で完了する)
- [ ] 4. ASK / STOP が返ったフェーズは `raguel-gating` の手順に厳密に従う(自己判断しない)
- [ ] 5. 全フェーズ `passed` になったら
      `node <plugin-root>/scripts/codiel-state.mjs finalize --issue N` を呼ぶ(全フェーズ passed を
      検証し `status` を `awaiting_outcome` にする唯一のコマンド。`complete-phase` ではない)。
      結果レポートを出力して終了する

## 0. 前提チェック(フェイルクローズド)

run を開始する前に、必ず次を確認する。ひとつでも欠けていれば **run を開始しない**。

1. 対象プロジェクトルートで次を実行し、ARCHITECTURE / GOTCHAS のパスとドメインマップを解決する。
   **解決はこの 1 回だけ行い、以降は解決した値を各所へ渡す**(サブエージェントに解決させない)。

   ```
   node -e 'import("<plugin-root>/scripts/lib.mjs").then(({ resolveDocPaths, readDomainsResult }) => {
     const p = resolveDocPaths(process.cwd());
     const d = readDomainsResult(process.cwd());
     console.log(JSON.stringify({ architecture: p.architecture, gotchas: p.gotchas, domains: d.domains, warnings: [...p.warnings, ...d.warnings] }));
   })'
   ```

   (`<plugin-root>` は絶対パスに展開して実行する)
2. 出力の `domains` が `null` でなく、各ドメインが 1 つ以上の glob を持つことを確認する
   (ARCHITECTURE の ` ```json metatron:domains ` ブロックが読めた状態)。
3. **`domains` が `null` または形式不正の場合**: ハーネスが未初期化である。`install-harness.sh` を
   実行したり雛形を自分で作ったりせず、ユーザーに「`/codiel:init` を実行して初期化してください」と
   案内して、**この run はここで終了する**(未初期化のまま先へ進まない)。
4. 出力の `warnings` が空でなければ、その全文をユーザーへ提示してから次へ進む。
   警告だけを理由に run を止めない。
5. 出力の `architecture` / `gotchas` は、ベースブランチ解決(§1)とディスパッチプロンプト(§3)で
   そのまま使う。GOTCHAS はファイルが無くてもここでは終了せず、各所でスキップする。
6. `mcp__raguel__*` ツール群(`evaluate_decision` 等)が利用可能であることを確認する。
   利用できなければ run を開始しない。

## 1. run の解決

```
node <plugin-root>/scripts/codiel-state.mjs get --issue N
```

- **同時にアクティブにできる run は 1 つだけ**(hooks の `findActiveRun` は単一 run の存在を前提に
  動作する)。別 Issue の run を新たに開始する前に、既存の `active`/`awaiting_human` の run を
  `finalize`(全フェーズ完了時)または `codiel-state stop --reason`(中止時)して終端状態にする。
- run が存在し `status` が終端(`stopped` / `awaiting_outcome` / `completed` / `rejected`)でなければ、
  その `state.phase` から再開する(「再開手順」参照)。
- **run が存在しない場合、`codiel-state get` は非ゼロ終了し stderr にエラーメッセージを出す。
  これは異常ではなく「新規 init に進め」という合図である。** run 未存在をエラーとして扱って
  ここで停止しない。
- run が存在しない、または既存 run が終端状態なら、**init の前に**次の手順でベースブランチを
  解決してから新しい try を作る:
  1. §0 で解決した ARCHITECTURE の「規約」節(ブランチ/PR 規約)からベースブランチ名を読む。
     ファイルが無い・節が無い・記載がない場合は `main` を既定値とする。
  2. `git switch <ベースブランチ>` した上で `git pull --ff-only` を実行し、ベースブランチを
     最新化する。`pull --ff-only` が失敗した場合(ネットワーク不通・fast-forward 不可な競合など)は、
     **その旨を人間に確認してから続行する**(黙って force する・スキップするなどの自己判断は禁止)。
  3. 上記が完了したら:
     ```
     node <plugin-root>/scripts/codiel-state.mjs init --issue N --base-branch <ベースブランチ>
     git switch -c <init の結果で返る state.branch>
     ```

## 2. フェーズ進行表

各フェーズはチェックリスト 3 の定型で進行する。
ゲート種別と完了コマンドはフェーズ進行表の「ゲート種別」列に従う。

| フェーズ | 担当エージェント | 参照スキル | 入力ファイル | 出力ファイル | ゲート種別 | コミット担当 |
|---|---|---|---|---|---|---|
| [0] init | codiel-analyst | analyzing-issues | Issue(`gh issue view`)、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | `issue.md` | pass-gate(`evaluate_decision`) | オーケストレーター(ゲート通過直後) |
| [1] discuss | codiel-architect(アジェンダ作成)→ オーケストレーター本体(ディスカッション進行・記録) | preparing-design-agendas(architect)/ facilitating-design-discussions(オーケストレーター) | `issue.md`、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | `agenda.md`、`discussion.md` | complete-phase(Raguel ゲートなし。人間が直接参加) | オーケストレーター(complete-phase 直前に agenda.md / discussion.md をまとめて) |
| [2] design | codiel-architect | writing-design-docs | `issue.md`、`discussion.md`、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | `design.md` | pass-gate(`evaluate_design`)。**ゲートの前に `facilitating-design-discussions` の「設計ウォークスルー」を実施し、ユーザー承認を得てから evaluate する** | オーケストレーター(ゲート通過直後) |
| [3a] test-spec | codiel-test-designer | writing-test-specs | `design.md`(影響 unit 一覧)、既存 `.codiel/specs/<unit-id>/spec.md`(あれば) | `.codiel/specs/<unit-id>/spec.md` / `cases.md`(新規 or 更新) | pass-gate(`evaluate_plan`。dev-plan とは独立) | オーケストレーター(ゲート通過直後) |
| [3b] dev-plan | codiel-planner | writing-dev-plans | `design.md` | `dev-plan.md`(ステップ毎にドメインタグ) | pass-gate(`evaluate_plan`。test-spec とは独立) | オーケストレーター(ゲート通過直後) |
| [4] implement | codiel-implementer-{frontend,backend,data}(ステップのドメインタグで選択) | implementing | `dev-plan.md`(該当ステップ)、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | コード diff + ユニットテスト | pass-gate(`evaluate_code`) | 担当 implementer(自分の変更を自分でコミット) |
| [5A] test-loop(スクリプト安定化) | codiel-tester | scripting-tests, running-regression-tests | `.codiel/specs/<unit-id>/cases.md` | `.codiel/specs/<unit-id>/scripts/`、`reports/test-run-<n>.md` | pass-gate(`evaluate_code`。スクリプト diff) | codiel-tester(自分の変更を自分でコミット) |
| [5B] test-loop(TDD 修正) | codiel-implementer-{該当ドメイン} | fixing-failures | NG ケース ID + 再現手順 + 期待結果 + 実際の結果 | コード修正 diff | pass-gate(`evaluate_code`) | 担当 implementer(自分の変更を自分でコミット) |
| [6] pr | オーケストレーター本体(ディスパッチなし) | — | `design.md`、`dev-plan.md`、`cases.md`、diff | PR(`git push -u origin <state.branch>` してから `gh pr create`。未 push ブランチでは PR 作成が失敗する)。PR 本文には `design.md` の目的・`dev-plan.md` のステップ一覧・`test-run-<n>.md` の判定を転記し、`Closes #N` を含める。 | complete-phase(`--pr-url` 必須) | ―(開始前に `git status --short` で未コミット差分がないことを確認) |
| [7] review | codiel-reviewer-{frontend,backend,data}(diff のドメインで選択参加)+ codiel-reviewer-doc/-security(常時参加)。**所見の統合・`reports/review-<n>.md` への記録・PR コメント投稿はオーケストレーターが行う** | reviewing-diffs | diff、`design.md`、`issue.md`、`.codiel/specs/**` | `reports/review-<n>.md` + PR コメント | complete-phase | オーケストレーター(review レポートのコミットも) |
| [8] fix-loop | codiel-implementer-{該当ドメイン}(修正)+ codiel-tester(回帰再実行)+ reviewer 陣(再レビュー) | fixing-review-findings, running-regression-tests, reviewing-diffs | `reports/review-<n>.md` の critical/high | コード修正 diff、`test-run-<n+1>.md`、`review-<n+1>.md` | pass-gate(`evaluate_code`。修正の度) | 担当 implementer / codiel-tester(自分の変更を自分でコミット)。`review-<n+1>.md` はオーケストレーター。**修正コミット完了後・reviewer 再ディスパッチ前にオーケストレーターが `git push` して PR ブランチを最新化する**(reviewer は `gh pr diff` を読むため、push しないと stale diff を見て同一所見を再報告する。guard-bash は fix-loop フェーズ + test-loop passed でこの push を許可済み) |
| [9] triage | オーケストレーター本体(ユーザーの指示のもと) | filing-followup-issues | `reports/review-<n>.md` の medium/low | 起票された Issue 番号(`review-<n>.md` と PR コメントに追記) | complete-phase(Raguel ゲートなし。§2 [9] の運用) | オーケストレーター(`review-<n>.md` への Issue 番号追記分。コード変更はなし) |
| [10] finalize | オーケストレーター本体 | recording-gotchas(STOP/incident 発生時のみ起動) | 全フェーズの成果物 | 結果レポート | `node <plugin-root>/scripts/codiel-state.mjs finalize --issue N`(全フェーズ passed を検証し `status` を `awaiting_outcome` にする唯一のコマンド。`complete-phase` ではない) | ―(コード変更なし) |

- **test-spec と dev-plan は単一メッセージで 2 体並列ディスパッチする**(Task ツールの呼び出しを 1 回の
  応答の中に 2 件含める)。片方が `ASK`/`STOP` でももう片方の結果には影響しない(raguel-gating 参照)。
- ドメインマップが `generic` のみの場合の縮退運用は「ドメインディスパッチ」節を参照。
- critical/high が review でゼロだった場合、fix-loop は実作業なしで
  `node <plugin-root>/scripts/codiel-state.mjs skip-phase fix-loop --issue N --reason "<理由>"`
  でスキップする(詳細は「5. ループ運転」節)。

### 2.1 成果物コミット規約

`codiel-architect` / `codiel-test-designer` / `codiel-planner` は Bash を持たず、自分の成果物を
自分でコミットできない(§7 の権限設計どおり)。したがって成果物のコミット責務はフェーズの種類で分かれる。

- **文書系フェーズ(init / discuss / design / test-spec / dev-plan)**: 成果物(`issue.md` /
  `agenda.md`・`discussion.md` / `design.md` / `spec.md`・`cases.md` / `dev-plan.md`)は、
  **ゲート通過直後にオーケストレーター自身が**
  ```
  git add <成果物パス>
  git commit -m "codiel(<phase>): <要約> (issue-N try-M)"
  ```
discuss は Raguel ゲートを持たないため、「ゲート通過直後」ではなく
  **complete-phase の直前**にコミットする(facilitating-design-discussions チェックリスト 8
  のとおり)。
- **コード系フェーズ(implement / test-loop / fix-loop)**: 担当サブエージェント(implementer /
  codiel-tester。いずれも Bash を保持)が**自分の変更を自分でコミットする**。オーケストレーターは
  これらのフェーズではコミットしない。
- **確認義務**: オーケストレーターは `pr` フェーズを開始する前に `git status --short` を実行し、
  未コミットの変更がないことを確認する。残っていれば `pr` を開始せず、該当フェーズのサブエージェントに
  「変更をコミットしてください」と差し戻す(未コミット差分を抱えたまま PR を作成しない)。

## 3. ディスパッチプロンプトの規約

サブエージェントのディスパッチは **Task ツール**(Claude Code の Agent/Task 機構)で、
`subagent_type` にフェーズ担当のエージェント名(`codiel-analyst` 等)を指定して行う。
プロンプトは次のテンプレートを満たす(担当スキル名・入出力ファイルパス・§0 で解決した
ARCHITECTURE / GOTCHAS の実パス・前フェーズ findings 要約・報告形式のすべてを含める):

```
あなたは <エージェント名> として、codiel プラグインの <スキル名> スキルを
Skill ツールで起動し、その手順に厳密に従って作業してください。

## 入力ファイル
- <入力ファイルパス1>
- <入力ファイルパス2(あれば)>

## 出力ファイル
- <出力ファイルパス>

## 前提
- ARCHITECTURE: <§0 で解決した architecture の絶対パス>
- GOTCHAS: <§0 で解決した gotchas の絶対パス>

上記のファイルが存在すれば、作業前に必ず読んでください。存在しなければスキップして先へ進んでください。
ドメインマップ・コーディング規約・過去の落とし穴を踏まえて作業してください。

## 前フェーズの申し送り(findings)
<前フェーズの EvaluationResult.findings を ruleId + message の箇条書きで要約したもの。
なければ「なし」>

## 完了条件
完了したら、成果物のファイルパスのみを報告してください。
diff の中身やファイル内容を会話に貼り付けないこと。
```

ARCHITECTURE / GOTCHAS のパスは §0 で解決した値をそのまま埋める。サブエージェントに解決させない。

ディスパッチ後、成果物ファイルが実際に存在し空でないことを確認してから raguel-gating の
ゲート手順に進む(サブエージェントの報告を鵜呑みにしない)。

## 4. ドメインディスパッチ

- `dev-plan.md` の各ステップにはドメインタグ(`frontend` / `backend` / `data`)が付く。
  §0 で読み取ったドメインマップ(ARCHITECTURE の ` ```json metatron:domains ` ブロック)と
  突き合わせ、タグに応じて
  `codiel-implementer-frontend` / `-backend` / `-data` にディスパッチする。
  review フェーズも同様に、diff が触れたドメインに応じて `codiel-reviewer-frontend` /
  `-backend` / `-data` を選択参加させ、`codiel-reviewer-doc` / `-security` は常時参加させる。
- **generic 縮退**: ドメインマップが `{ "generic": ["**"] }` のみの場合、implementer は
  `codiel-implementer-backend` を汎用実装者として使う。reviewer は `codiel-reviewer-doc` +
  `codiel-reviewer-security` + `codiel-reviewer-backend`(汎用担当)の 3 体で回す。

### 4.1 domain の設定と解除

ドメイン別のサブエージェントへ委譲している間だけ、run の `domain` に担当ドメインを持たせる。
guard-write はこの値でドメイン境界を判定する。判定が働くのは implement / test-loop / fix-loop の
3 フェーズであり、`domain` が未設定のときとドメインマップが読めないときは境界を課さない。

```
node <plugin-root>/scripts/codiel-state.mjs set-domain --issue N --domain <ドメイン名>
node <plugin-root>/scripts/codiel-state.mjs clear-domain --issue N
```

- ドメイン別 implementer(implement / test-loop の TDD 修正 / fix-loop の修正)をディスパッチする
  直前に `set-domain` を実行する。
- そのサブエージェントの報告を受け取った直後に `clear-domain` を実行する。解除しないと、
  次に `set-domain` するまで前のドメインの境界が効き続ける。
- ドメイン別 reviewer を 1 体だけディスパッチするときも同じ手順を踏む。
- `--domain` にはドメインマップのキー(`frontend` / `backend` / `data`、縮退時は `generic`)を
  そのまま渡す。エージェント名から別名を作らない。generic 縮退で汎用実装者として
  `codiel-implementer-backend` を使うときも、渡す値は `generic` である。
- ドメインに紐づかないサブエージェント(`codiel-analyst` / `codiel-architect` /
  `codiel-test-designer` / `codiel-planner` / `codiel-tester` / `codiel-reviewer-doc` /
  `codiel-reviewer-security`)には `set-domain` を実行しない。`domain` が残っている可能性が
  あるときは、ディスパッチ前に `clear-domain` を実行する。
- ドメイン別 implementer は 1 体ずつ逐次ディスパッチする。未着手のステップが複数ドメインに
  またがっていても、同じ応答で複数の implementer を起動しない。
- 複数のドメイン別サブエージェントを同じ応答でディスパッチするとき(review フェーズで
  ドメイン別 reviewer を同時参加させる場合など)は `set-domain` を実行しない。state が持てる
  `domain` は 1 つだけで、境界判定は最後に `set-domain` した値で行われる。この場合の
  ドメイン規律は、従来どおりディスパッチプロンプトの指示で運用する。

境界違反は `deny` ではなく `ask` で返る。止まったら、`set-domain` した値と `dev-plan.md` の
該当ステップのドメインタグを照合する。値が誤っていれば正しい値で `set-domain` し直して続行する。
値が正しければ越境であり、その書き込みを認めず、該当ドメインの implementer にディスパッチし直す。

## 5. ループ運転(test-loop / fix-loop)

test-loop の内部運転(スクリプト安定化 → TDD 修正の二段構え)は `running-regression-tests` /
`fixing-failures` に、fix-loop の指摘対応は `fixing-review-findings` に定める。オーケストレーターの
役割は次の 2 点のみ:

1. 修正のためのサブエージェント・ディスパッチ 1 往復ごとに(= 1 attempt)
   `node <plugin-root>/scripts/codiel-state.mjs record-attempt <phase> --issue N` を呼ぶ。
   **record-attempt を呼ぶのはオーケストレーターのみ**(tester / implementer は呼ばない。二重計上の防止)。
2. exit code が `3`(試行上限超過・`capExceeded`)なら、**raguel-gating の ASK と同じ扱い**にする
   (`awaiting_human` は `record-attempt` 内部で既にセットされている。findings 相当の情報を人間に
   提示し裁定を待つ。自分で「あと1回だけ」と続行してはならない)。

### fix-loop のスキップ経路

review フェーズの所見に critical / high が **一件もなければ**、fix-loop で実施することは何もない。
この場合、fix-loop を `start-phase` してから空振りで `complete-phase`/`pass-gate` しようとせず、
次のコマンドで明示的にスキップする:

```
node <plugin-root>/scripts/codiel-state.mjs skip-phase fix-loop --issue N --reason "review で critical/high 0 件"
```

- `skip-phase` は `fix-loop` にしか使えない(他フェーズはフェイルクローズドで拒否される)。
- 前提として review までの全フェーズが `passed` である必要がある。
- 成功すると `fix-loop` は `status: passed` / `verdict: SKIPPED` になり、`attempts` はリセットされずに
  維持される。以降 `triage` を通常どおり `start-phase` できる。
- **review に critical/high が 1 件でも残っている場合は skip-phase を使わない**。通常どおり
  implementer にディスパッチして修正させる。

## 6. 再開手順

1. `node <plugin-root>/scripts/codiel-state.mjs get --issue N` で `state.json` を取得する。
2. `git switch <state.branch>` で run のブランチに切り替える(カレントブランチが別 run や
   ベースブランチのままだと、成果物コミットが誤ったブランチに乗る)。
3. `state.phase` から続行する(すでに `passed` のフェーズはやり直さない。フェーズ進行表の定型に
   従い、`in_progress` のフェーズから再開する)。
   discuss フェーズで中断していた場合の再開位置(アジェンダ作成から/未決論点から/最終確認から)は
   facilitating-design-discussions の「中断再開」節に従う。design フェーズで design.md が既に存在する
   場合は、ウォークスルーの再提示から再開する。
4. `state.status` が `awaiting_human` なら、該当フェーズの `evaluationId` / `note` を手がかりに
   直近の findings を再提示し、raguel-gating の ASK ハンドリング(裁定 A / 裁定 B / 中止)に従って
   人間の裁定を待つ。**再開できると思って勝手に続行しない**。

<HARD-GATE>
- **オーケストレーターは自分で実装・レビュー・テスト作成をしない**。すべてサブエージェントへの
  ディスパッチを経由する。コード・design.md・review コメント等をオーケストレーター自身が書くことは
  一切禁止。なお `discussion.md` への合意の記録・ウォークスルーの進行は「進行管理」であり本項に
  抵触しない(`review-<n>.md` と同じ分類。根拠は facilitating-design-discussions の概要)。
  ただし agenda.md / design.md の**内容**をオーケストレーターが書くことは引き続き禁止。
- **Raguel ゲートの省略禁止**。GATED フェーズを `evaluate_*` なしに `passed` にしようとする行為
  (`pass-gate` の `--evaluation-id` を捏造する、evaluate を呼ばずに次フェーズへ進むなど)は
  raguel-gating の HARD-GATE と同様に禁止。
- **state.json を直接編集しない**。フェーズ遷移は `codiel-state` スクリプト経由のみ。Edit/Write で
  `.codiel/runs/**/state.json` を書き換えようとする行為は hooks が deny する前提であり、
  それを回避しようとすること自体が禁止。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「小さい Issue だからフェーズを飛ばしていい」 | `codiel-state start-phase` はステージ順序を機械的に強制する。小ささの判断自体がAIの自己評価であり、飛ばしていい理由にはならない。 |
| 「サブエージェントより自分でやった方が速い」 | 権限を最小化したサブエージェントに任せることが「暴走できない」構造の前提。オーケストレーターが自分でコードを書けば hooks・Raguel の役割分離が意味を失う。 |
| 「テストは明らかに通るので test-loop 省略」 | 「明らか」という判断こそ偽装グリーンのリスク源。スクリプトを実際に実行して出力を見るまで合否は不明。 |
| 「state は手で直した方が早い」 | state.json への Edit/Write は hooks が deny する前提。手直しは「ゲート偽装」「フェーズ飛ばし」の温床であり、codiel-state の遷移検証を迂回する。 |
| 「ASK だが自明なので自分で判断して続行」 | raguel-gating が明確に禁止する自己承認そのもの。ASK は人間の裁定を要求する合図であり、AI の代理判断はその意味を無効化する。 |
