---
name: orchestrating-runs
description: Codiel の run で、メインセッション自身がオーケストレーターとして Issue 番号・intent 文書のパス・省略のいずれかから intent フェーズから finalize フェーズまでの全フェーズを進行させ、サブエージェントへのディスパッチと Raguel ゲートの運転を担うときに使う。/codiel:run が名指しで起動する。
---

# Codiel run オーケストレーション

## 概要

`/codiel:run [<Issue番号> | <intent パス> | 省略]` はメインセッション自身がオーケストレーターとなり、
intent を起点に
intent → discuss → design → test-spec/dev-plan → test-code → implement → test-loop → intent-sync → pr → review → fix-loop → triage → finalize
の全フェーズを進行させる。intent フェーズの聞き取りと合意形成は `capturing-intent` を通じてオーケストレーター
本体が担う。agenda.md・design.md・dev-plan.md・discussion.md・intent 文書(持続層を含む)の執筆と、
プロジェクトの test コマンドと `units/` のテストの実行も、オーケストレーター本体が行う。調査・
spec.md / cases.md の執筆・テストコード・実装と修正・タスクレビュー・review・`e2e/` の実行は専用
サブエージェントにディスパッチし、成果物は Raguel MCP のゲートを経てのみ次フェーズへ進む。
オーケストレーター自身は、コード(テストコードを含む)・spec.md / cases.md・レビューの所見を自分では書かない。

Raguel ゲートの呼び出し規約(evaluate ツール対応・verdict 別ハンドリング・record_outcome の運用)は
すべて `raguel-gating` スキルに一元化されている。

intent の聞き取りと確定は `capturing-intent` に、intent-sync フェーズの書き戻しは `syncing-intents` に
一元化されている。設計工程は人間と共同で行う: discuss フェーズ(論点の合意)と design フェーズの
ウォークスルー(設計書の確認)が常設の人間参加ポイントであり、進行規約は `facilitating-design-discussions`
スキルに一元化されている。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/orchestrating-runs`
である。**`<plugin-root>` はそのベースディレクトリの 2 階層上**。`codiel-state` は対象プロジェクトの
ルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## チェックリスト

- [ ] 0. **前提確認・実行モード・連携モードの決定**を行う(下記)。停止条件に当たればここで終了する
- [ ] 1. **outcome 自動同期**を行う(`raguel-gating` の「outcome の自動同期」に従う。起動時に 1 回のみ)
- [ ] 2. **run を解決する**: `codiel-state get --active` でほかの run が active でないことを確かめ、
      intent フェーズ(`capturing-intent` スキル)へつないで run を開始または再開する
      (詳細は「1. run の解決」参照)
- [ ] 3. 現在フェーズから、フェーズ進行表の定型(start-phase → ディスパッチ → 成果物検証 → raguel-gating
      でゲート → pass-gate/complete-phase)を順に実行する。ドメイン別のディスパッチは
      §4.1 の set-domain / clear-domain を伴う
      (discuss は raguel-gating を経ず、facilitating-design-discussions に従って進行し
      complete-phase で完了する)
- [ ] 4. ASK / STOP が返ったフェーズは `raguel-gating` の手順に厳密に従う(自己判断しない)。
      失敗の契機が起きたら「7. 失敗の記録」に従って記録する
- [ ] 5. 全フェーズ `passed` になったら「2.3 finalize の運転」の手順で結果レポートと intent の
      `status` を確定してから `codiel-state finalize --slug <slug>` を呼ぶ。結果レポート
      (原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」を含む)を出力して終了する

## 0. 前提確認と実行モードの決定

run を開始する前に、初期化の外形とドメインマップの状態から実行モードを決め、連携モードと画像添付・ADR の
書き先を判定する。ドメインマップの不在それ自体は初期化の欠落に当たらない。

1. 対象プロジェクトルートで次を実行し、ARCHITECTURE / GOTCHAS のパスとドメインマップの状態を解決する。
   **解決はこの 1 回だけ行い、以降は解決した値を各所へ渡す**(サブエージェントに解決させない)。

   ```
   node -e 'import("<plugin-root>/scripts/lib.mjs").then(({ resolveDocPaths, readDomainsResult }) => {
     const p = resolveDocPaths(process.cwd());
     const d = readDomainsResult(process.cwd());
     console.log(JSON.stringify({ architecture: p.architecture, gotchas: p.gotchas, domains: d.domains, unreadable: d.unreadable, warnings: [...p.warnings, ...d.warnings] }));
   })'
   ```

   (`<plugin-root>` は絶対パスに展開して実行する)
2. 続けて次を実行し、連携モードと `imageUpload`・`adrTarget` の判定材料を得る。**この呼び出しも 1 回だけ
   行い、以降の手順は同じ出力を使い回す**。

   ```
   node <plugin-root>/scripts/check-intent-env.mjs
   ```

   続けて次を実行し、テストの仕様の置き場(testsDir)と run の文書の置き場(runsDir)を得る。**この呼び出しも
   1 回だけ行い、以降の手順(軽量の run の同定・test-spec・dev-plan・test-code・test-loop・review の依頼文と、
   run の文書の出力先)は同じ値を使い回す**。

   ```
   node <plugin-root>/scripts/codiel-state.mjs config
   ```

   続けて次を実行し、`.gitignore` に足りない行(出力の `missing`)を得る。判定 D に使う。この呼び出しも 1 回
   だけ行う。

   ```
   node <plugin-root>/scripts/codiel-state.mjs gitignore
   ```

   `config` と `gitignore` のどちらかが失敗したとき(`.codiel/config.json` が不正なときは、標準エラー出力に
   理由を出して終了コード 1 になる)は、C・D を揃っていないものとして扱う。手順 6 の表の行 2 で止まるときに、
   標準エラー出力の理由を添え、`.codiel/config.json` を直すか `/codiel:init` をやり直すよう案内する。

3. 手順 2 の出力にある事実(`repoSlug`・`ghAuthenticated`・`ghAttachSupported`・`projectDocs.architecture`
   など)から、次のとおり判断する。判断はここで行い、check-intent-env は事実だけを返す。

   | 項目 | 判断 |
   | --- | --- |
   | 連携モード | `repoSlug` が null でなく、かつ `ghAuthenticated` が true なら `github`。それ以外は `local`(GHES を含む) |
   | `imageUpload.ghAttach` | 連携モードが `local` なら `false`。`github` では `ghAttachSupported` が true のとき `true` |
   | `imageUpload.chrome` | 連携モードが `local` なら `false`。`github` ではセッションで `mcp__claude-in-chrome__*` のツールが使えるとき `true` |
   | `adrTarget` | `projectDocs.architecture` が null なら `intents`、それ以外は `metatron` |

   これらの値は run の開始時に決めて固定し、intent フェーズ(`capturing-intent`)が `codiel-state init` へ
   渡す `--integration` / `--image-upload` / `--adr-target` の判断根拠になる。resume 時の再判定は
   「6. 再開手順」に従う。
4. 初期化の外形は B + C + D の 3 点で確認する。

   | 記号 | 確認対象 | 「揃っている」の判定 |
   | --- | --- | --- |
   | B | `.claude/rules/codiel.md` / `CLAUDE.md` | `.claude/rules/codiel.md` が存在し、かつ `CLAUDE.md` に、行全体が(前後の空白を除き)`## Codiel` と一致する行がある |
   | C | `.codiel/config.json` | JSON のオブジェクトとして読め、`raguel` がオブジェクトである(空のオブジェクトでよい) |
   | D | `.codiel/runs` / `.codiel/reports` / `.gitignore` | 2 ディレクトリが存在し、`codiel-state gitignore` の `missing` が空である |

5. 既存 run がある場合は `state.domainMode` の記録も分岐の入力にする。新規 run と `domainMode` のない既存
   run は記録なしとして扱う。
6. 次の分岐表を上から順に評価し、最初に当たった行を採る。

   | # | 条件 | 判断 |
   | --- | --- | --- |
   | 1 | Raguel MCP(`mcp__plugin_codiel_raguel__*`)が使えない | **止める。** ARCHITECTURE の欠落とは別の理由を示す |
   | 2 | B / C / D のいずれかが欠けている | **止める。** 欠けている項目を名指しし(C は config.json の `raguel`、D は足りない `.gitignore` の行)、`/codiel:init` を案内する。**ARCHITECTURE には言及しない** |
   | 3 | `unreadable === null`(マップが読める) | **`mapped` で開始する。** 担当は §4 のルーティングで必ず決まるため、ここでの追加確認は要らない |
   | 4 | `unreadable` が `architecture_missing` または `block_missing`、かつ state に `domainMode` の記録がある | 記録された値で開始する。再確認しない |
   | 5 | `unreadable` が `architecture_missing` または `block_missing`、かつ記録が無い | **ユーザーに「ドメイン別の境界を設けずに実行してよいか」を確認し、許可後に `unscoped` で開始する。** 恒久ファイルは生成しない。記録先は run state のみ |
   | 6 | `unreadable` が `invalid_json` / `invalid_shape` / `read_error` | **一旦止めて確認する。** 読めない理由と `warnings` の全文を提示し、(a) マップを修復して再実行する、(b) この run に限り境界なしで進むため `unscoped` へ切り替える、のどちらかをユーザーに選ばせる |
   | 7 | 記録が `mapped` なのに再開時に `unreadable !== null` | **止めて確認する。** run 中のマップ消失を暗黙のモード変更にしない |

   機械的に決まるのは行の選択だけである。ユーザー確認を伴うのは行 5 と行 6 だけとする。行 2 で止めるとき、
   リポジトリに `raguel.config.yaml` があれば、中身を config.json の `raguel` へ移すために `/codiel:init` を
   実行するよう添える。
7. 出力の `warnings` が空でなければ、その全文をユーザーへ提示してから次へ進む。手順 2 の出力の
   `configWarnings` が空でないときも同様に提示する。警告だけを理由に run を止めない。
8. 行 6 で (b) が選ばれた場合も `unscoped` を記録し、ユーザーが選択した事実を完了報告に残す。
9. 新規 run では決めたモードを `codiel-state init` の `--domain-mode` にそのまま渡す。既存 run の再開時は
   記録を正とする。未記録はモード未決としてこの判定をやり直す。
10. 出力の `architecture` / `gotchas`、実行モード、使用するドメインマップ、連携モード、`imageUpload`、
    `adrTarget` は、intent フェーズとディスパッチプロンプト(§3)でそのまま使う。GOTCHAS はファイルが
    無くても終了せず、各所でスキップする。

## 1. run の解決

`/codiel:run` は次の 3 形のいずれかで起動する。

```
/codiel:run <Issue番号>
/codiel:run <intent パス>
/codiel:run
```

```
node <plugin-root>/scripts/codiel-state.mjs get --active
```

- **同時にアクティブにできる run は 1 つだけ**(hooks の `findActiveRun` は単一 run の存在を前提に
  動作する)。既存の `active`/`awaiting_human` の run のうち、今回再開しないものだけを
  `finalize`(全フェーズ完了時)または `codiel-state stop --slug <slug> --reason <理由>`(中止時)で
  終端状態にする。`waits` が残っている run を止めるときは、2.4 の手順で先に待ちを片付ける。今回再開する
  run かどうかの判定は `capturing-intent` の手順 0 に従う。
- run の解決自体は intent フェーズ(`capturing-intent` スキル)へつなぐ。Issue 番号・intent パス・省略の
  どの入口でも、既存 intent との重複確認、聞き取り、現状調査、分岐の合意、ドラフト提示、承認ゲート、
  `codiel-state init` による run 作成までを `capturing-intent` の手順に従って進める。
- intent パスの frontmatter `run` に対応する未終端の run、または state の `intent` が入口の intent パス
  と同じ未終端の run があれば、`capturing-intent` の入口の分岐がそれを検出し、`state.phase` から続ける
  べき既存 run として扱う。この場合は「6. 再開手順」に従う。frontmatter の `run` で当たった run は確か
  めずに再開し、state の `intent` だけで当たった run(frontmatter の `run` で確かめられない run)は、
  続ける前に slug・intent のパス・現在のフェーズを示してユーザーに確かめる。
- 前の try が `stopped` で、`stopReason` が `raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` の
  フェーズを持つときは、`capturing-intent` の手順 1 の承認を経てからでないと新しい try を作れない
  (`init --human-approved`)。前の try の成果物(intent 以外。STOP を受けたファイルを含む)を新しい try
  で使うときは、それを作るフェーズを新しい try で進めて新しい try のゲートを通す。ゲートを通さずに run
  ブランチへ持ち込まない。
- `capturing-intent` の承認ゲートで「文書だけ残して終える(intent-only)」が選ばれたら、run は `close`
  で `completed` になり、以降のフェーズ進行表(discuss 以降)は実行しない。「続行する」が選ばれたら、
  intent フェーズが `passed` になった run ブランチから、フェーズ進行表の discuss 以降を続ける。

## 2. フェーズ進行表

各フェーズはチェックリスト 3 の定型で進行する。
ゲート種別と完了コマンドはフェーズ進行表の「ゲート種別」列に従う。`STAGES` は次の 13 ステージである。

```ts
[["intent"], ["discuss"], ["design"], ["test-spec", "dev-plan"], ["test-code"], ["implement"],
 ["test-loop"], ["intent-sync"], ["pr"], ["review"], ["fix-loop"], ["triage"], ["finalize"]]
```

表の `<n>` は try と test-loop の回の番号、`<m>` はレビューの回の番号(review フェーズが 1、fix-loop の再レビューごとに 1 つ増える)である。

| フェーズ | 委譲の種別と作業内容 | 参照スキル | 入力ファイル | 出力ファイル | ゲート種別 | コミット担当 |
|---|---|---|---|---|---|---|
| [intent] | オーケストレーター本体が対話で聞き取り、ドラフトを書く。現状調査は読み取りだけの委譲 | capturing-intent | Issue 本文(任意。`gh issue view` または GitHub MCP)、既存 intent(任意)、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ)、持続層 | `docs/intents/YYYY-MM-DD-<slug>.md` | ユーザー承認の後に pass-gate(`evaluate_decision`) | オーケストレーター(intent-only では開始時のブランチへ、続行では run ブランチへ、ゲート通過直後) |
| [discuss] | オーケストレーター本体がアジェンダを書き、進行する。intent → `agenda.md` | preparing-design-agendas | intent、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | `agenda.md`、`discussion.md` | complete-phase(Raguel ゲートなし。人間が直接参加) | オーケストレーター(complete-phase 直前に agenda.md / discussion.md をまとめて) |
| [design] | オーケストレーター本体が書く。intent + `discussion.md` → `design.md` | writing-design-docs | intent、`discussion.md`、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ)、持続層 | `design.md`(`## 影響を受ける機能単位` に仕様のディレクトリの ID。新しい画面は名前の候補) | pass-gate(`evaluate_design`)。**ゲートの前に `facilitating-design-discussions` の「設計ウォークスルー」を実施し、新しい画面の名前を聞いてから evaluate する** | オーケストレーター(ゲート通過直後) |
| [test-spec] | オーケストレーター本体が仕様のディレクトリを同定し(ファイルは書かない)、成果物を書く委譲を出して待ちを記録し、その間に dev-plan を書いてゲートする。`design.md`(軽量では intent と持続層、同定した一覧) → `spec.md` / `cases.md` | writing-test-specs | `design.md`(`## 影響を受ける機能単位`。軽量では intent の `## 受け入れ基準` と `## 実装方針`、名前の候補を含む一覧) | `<testsDir>/<仕様のディレクトリ>/spec.md` / `cases.md`(新規 or 更新) | pass-gate(`evaluate_plan`。dev-plan とは独立) | オーケストレーター(ゲート通過直後) |
| [dev-plan] | オーケストレーター本体が書く。`design.md`(軽量では intent と持続層、test-spec と同じ一覧) → `dev-plan.md` | writing-dev-plans | `design.md`(軽量では intent の `## 受け入れ基準` と `## 実装方針`、test-spec と同じ一覧) | `dev-plan.md`(ステップ毎にドメインタグ・触るファイル・前提ステップ・通すテスト、`## 環境準備`・`## 生成物`) | pass-gate(`evaluate_plan`。test-spec とは独立。`codiel-state waves` の成功を確かめた後) | オーケストレーター(ゲート通過直後) |
| [test-code] | 成果物を書く委譲を仕様のディレクトリごとに worktree で並列(2.5〜2.7)。`spec.md` / `cases.md` → テストコード | scripting-tests | `spec.md` / `cases.md`、`design.md`(軽量では intent)、`dev-plan.md` | テストコード(ユニットと E2E)、`spec.md` の `tests`(`report.md` は委譲先の返答からオーケストレーターが書く。2.1) | 全ディレクトリのマージ後に pass-gate(`evaluate_code`)を 1 回 | 委譲先が worktree の中で自分の変更をコミットし、オーケストレーターがレビュー後に run ブランチへマージする |
| [implement] | 成果物を書く委譲を `codiel-state waves` の順で worktree に並列(2.8)。グループのマージの後に、そのグループの通すテストのうちプロジェクトの test コマンドと `units/` のテストをオーケストレーターが実行し、`e2e/` のテストは実行の委譲を出す | implementing + fixing-failures | `dev-plan.md`(該当ステップ)、test-code のテスト(ユニットと E2E)、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | テストを通すコード diff | 全 wave の後に pass-gate(`evaluate_code`)を 1 回 | 委譲先が worktree の中で自分の変更をコミットし、オーケストレーターがレビュー後に run ブランチへマージする |
| [test-loop] | 回帰の実行(プロジェクトの test コマンドと `units/` のテストはオーケストレーター本体、`e2e/` は委譲)と、NG の修正の委譲(仕様のディレクトリごとに worktree で並列。並べ方は 2.6)(2.9) | running-regression-tests + fixing-failures | 全 `spec.md` の `tests`、プロジェクトの test コマンド | `test-run-<n>.md`(自分の実行結果と `e2e/` の委譲の返答を合わせてオーケストレーターが書く。2.1)、修正 diff | pass-gate(`evaluate_code`) | 修正の委譲先が worktree の中で自分の変更をコミットし、オーケストレーターがレビュー後に run ブランチへマージする |
| [intent-sync] | オーケストレーター本体が書く(書く前に 2.11 の確認を行う)。承認済みの受け入れ基準変更と、intent-sync より前に追記された原文の要望 → 派生文のセクションと `## 変更履歴` への反映、関係する領域の持続層への取り込み | syncing-intents | intent、承認済みの受け入れ基準変更、追記された原文の要望、持続層 | intent の派生文のセクションと `## 変更履歴`、`docs/intents/domains/<領域>.md` | pass-gate(`evaluate_design`) | オーケストレーター(ゲート通過直後) |
| [pr] | オーケストレーター本体。— | — | `design.md`、`dev-plan.md`、`cases.md`、diff | github: PR / local: state の記録だけ(詳細は「2.2 pr の運転」) | complete-phase(github のときだけ `--pr-url` 必須) | オーケストレーター。開始前に `git status --short` を実行し、2.1 の確認義務に従う |
| [review] | 読み取りだけの委譲(観点ごと)。`git diff <base>...<branch>` + intent + `design.md` → 指定観点の所見一覧(テキスト) | reviewing-diffs | `git diff <base>...<branch>`、intent、`design.md`(軽量では intent と `dev-plan.md`)、`<testsDir>/**` と記録されたテスト、持続層 | `reports/review-<m>.md`(全観点の待ちが消えてから書く。§3)+ PR コメント(github のみ) | complete-phase | ―(`reports/` の下のレポートと本文ファイル(`review-body-<m>.md`・`review-comment-<連番>.md`)はコミットしない) |
| [fix-loop] | 成果物を書く委譲(修正)、回帰の実行(プロジェクトの test コマンドと `units/` のテストはオーケストレーター本体、`e2e/` は委譲)、読み取りだけの委譲(再レビュー)。レビュー所見 → コード修正 diff / `test-run-<n+1>.md` / `review-<m+1>.md` | fixing-review-findings + running-regression-tests + reviewing-diffs | `reports/review-<m>.md` の critical/high | コード修正 diff、`test-run-<n+1>.md`、`review-<m+1>.md` | pass-gate(`evaluate_code`。修正の度) | コード系フェーズの委譲先(自分の変更を自分でコミット)。`review-<m+1>.md` と、反論・対応・再報告記録の本文ファイル(`rebuttal-<連番>.md` など)は `reports/` に書き、コミットしない(github モードでは続けて投稿する)。**修正コミット完了後・再レビューの委譲前に、github モードではオーケストレーターが `git push` して PR ブランチを最新化する** |
| [triage] | オーケストレーター本体。`reports/review-<m>.md` の medium/low → github: 起票された Issue 番号 / local: `status: proposed` の intent 草案 | filing-followup-issues | `reports/review-<m>.md` の medium/low | github: 起票された Issue 番号(`review-<m>.md` と PR コメントに追記)/ local: `docs/intents/` の intent 草案 | complete-phase(Raguel ゲートなし) | ―(`review-<m>.md` への追記分と、Issue・フォローアップコメントの本文ファイル(`issue-<連番>.md`・`followup-<連番>.md`)はコミットしない。コード変更はなし) |
| [finalize] | オーケストレーター本体。全フェーズの成果物、intent の原文のセクション → 結果レポート | ―(失敗の契機があれば「7. 失敗の記録」) | 全フェーズの成果物、intent の原文のセクション | 結果レポート(原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」を含む)、intent の `status` | `node <plugin-root>/scripts/codiel-state.mjs finalize --slug <slug>`(全フェーズ passed を検証し `status` を `awaiting_outcome` にする唯一のコマンド。`complete-phase` ではない。詳細は「2.3 finalize の運転」) | ―(intent の更新分はオーケストレーターがコミットし、github モードでは push する) |

- 軽量の経路(`scale: light`)では discuss と design を `skip-phase` で飛ばす。`SKIPPABLE` はこの 2 フェーズと
  fix-loop に限られ、discuss と design の `skip-phase` は `state.scale === "light"` のときだけ成功する。
  test-spec と dev-plan は `design.md` の代わりに intent の `## 受け入れ基準` と `## 実装方針`、関係する
  持続層を入力にする。review も同様に `design.md` の代わりに intent と `dev-plan.md` を設計の入力にする。
- 軽量の経路では、`start-phase test-spec` の直後に、オーケストレーター本体が仕様のディレクトリを同定する
  (`writing-test-specs` の同定の規則。ファイルは書かない)。新しい画面があれば
  `mark-ask test-spec --slug <slug> --kind confirm` の後に画面ごとの名前の候補を AskUserQuestion で聞き、
  候補の外の答えはケバブケースの 1 セグメントに直して確かめてから `resume` する。無ければ聞かない。決ま
  った一覧は、dev-plan の執筆と spec の委譲の依頼文に同じ値で使う。
- test-spec と dev-plan は、design が `passed` か `skipped` になった後、`start-phase test-spec` を行ってから、
  次の順に並列で進める(軽量の経路では、上の同定が `start-phase test-spec` の直後に入る)。
  1. 仕様のディレクトリを同定する(軽量でなければ `design.md` の一覧を使う)。
  2. spec.md / cases.md の委譲を出し、`wait-add` する。
  3. 委譲の完了を待つ間に、`start-phase dev-plan` の後で dev-plan.md を自分で書き、`evaluate_plan` でゲートする。
  4. spec の委譲の完了通知を受けたら、報告を書いて `wait-done` し、spec の `evaluate_plan` でゲートする。

  2 つのゲートの判定は互いに独立で、一方の verdict が他方の判定を変えない(raguel-gating 参照)。dev-plan が
  `ASK`/`STOP` でも、spec の委譲は止めず、完了したら spec のゲートまで進める。
- dev-plan が `ASK`/`STOP` になっても、spec の委譲の待ちが残っている間は `mark-ask` を呼ばない。`mark-ask` は
  run を `awaiting_human` にし、その間は guard-write の境界が外れるためである。spec のゲートの結果が出てから、
  2 つのゲートの結果をまとめて人に示す。2 つとも `ASK`/`STOP` なら、両方に `mark-ask` し、両方の裁定を
  `record_outcome` で記録してから `resume` する。`resume` は awaiting_human のフェーズを一括で戻すので、
  片方の裁定だけで呼ばない。
- test-code へ進めるのは、dev-plan と test-spec の両方が `passed` になってからである。
- test-spec の再開は、標準でも軽量でも、次の順で分ける。
  1. 裁定待ちの `ASK`/`STOP` があれば、先に人の裁定を受ける(`STOP` の後に再評価しない)。
  2. dev-plan が `passed` でなく裁定待ちでもなければ、dev-plan を書いてゲートする。
  3. spec の委譲の出し直しは §6 の手順に任せる。その後で、受け取り済みの返答があれば spec のゲートへ進み、無ければ出し直した委譲を待つ(待つ間に 2. を進めてよい)。
  4. 両方 `passed` なら、test-spec の作業は済んでいるので次のフェーズへ進む。
  - 一覧が手元に無いときは、dev-plan が `passed` なら `dev-plan.md` の各ステップの通すテストから取り直し、そうでなければ同定し直す。
- 実行モード(`mapped` / `unscoped`)に応じたドメインディスパッチは「4. ドメインディスパッチ」を参照。
  test-code・implement・test-loop の運転は「2.6〜2.9」を参照。
- critical/high が review でゼロだった場合、fix-loop は実作業なしで
  `node <plugin-root>/scripts/codiel-state.mjs skip-phase fix-loop --slug <slug> --reason "<理由>"`
  でスキップする(詳細は「5. ループ運転」を参照)。
- ゲートで evaluate ツールへ渡すもの(`phase`・`paths`・`baseRef` など)は、`raguel-gating` のフェーズ→ツール
  対応表だけが定める。このスキルは渡すものを書かず、各フェーズのゲートの手順から対応表の行を引く。
- test-code・implement・test-loop・fix-loop の `start-phase` は、そのフェーズの開始の HEAD を state の
  `phases.<phase>.startHead` に記録する。`baseRef` の値はこの記録であり、オーケストレーターが自分で決めない。

### 2.1 成果物コミット規約

文書系フェーズの委譲先は git 操作をしない。したがって成果物のコミット責務はフェーズの種類で分かれる。

- **文書系フェーズ(intent / discuss / design / test-spec / dev-plan / intent-sync)**: 成果物(intent 文書 /
  `agenda.md`・`discussion.md` / `design.md` / `spec.md`・`cases.md` / `dev-plan.md` / intent の派生文の
  セクションと `## 変更履歴`)は、**ゲート通過直後にオーケストレーター自身が**
  ```
  git add <成果物パス>
  git commit -m "codiel(<phase>): <要約> (<slug> try-<n>)"
  ```
  で確定する。discuss は Raguel ゲートを持たないため、「ゲート通過直後」ではなく **complete-phase の
  直前**にコミットする(facilitating-design-discussions チェックリスト 8 のとおり)。intent フェーズの
  コミットは「1. run の解決」と `capturing-intent` の手順に従う。
- **コード系フェーズ(test-code / implement / test-loop / fix-loop)**: 委譲先が**自分の変更を自分で
  コミットする**。worktree で動く委譲(implement の `parallel` グループの各ステップ、test-code の仕様の
  ディレクトリごとの委譲、test-loop の仕様のディレクトリごとの修正)は worktree のブランチへコミットし、
  オーケストレーターがタスクレビューを通ったものから `git merge --no-ff` で run ブランチへマージする
  (2.5・2.7〜2.9)。`serial` グループ・`final`・グループのマージの後の修正・test-loop のプロジェクト全体
  の修正・fix-loop の修正は run ブランチ上で直接委譲するので、委譲先が run ブランチへ直接コミットする。
  オーケストレーターはマージと worktree の後始末と、E2E のレポートのコミット(2.10)を除き、これらの
  フェーズで自分の判断によるコミットをしない。コード系フェーズの pass-gate の後は、次のフェーズの
  `start-phase` までコミットしない(`start-phase` が、直前に通ったフェーズの `passedHead` と今の HEAD の一致を要る)。
- **文書系フェーズの後のコミットの範囲**: ゲート通過の直後にコミットするのは、そのゲートで評価した文書
  (`paths` に渡したファイル)だけにする。ほかのファイルを同じコミットや次の code 系フェーズの `start-phase`
  より前のコミットに入れると、`start-phase` がそのパスを挙げて失敗する。test-spec と dev-plan は、両方で
  評価した文書をそれぞれの通過の直後にコミットしてよい。
- **run の文書の置き場**: オーケストレーターが書く `agenda.md`・`discussion.md`・`design.md`・
  `dev-plan.md` は `<repoRoot>/<runsDir>/<slug>/` に置き、try で分けない。依頼文の出力先には
  `<repoRoot>/<runsDir>/<slug>/<ファイル名>` の絶対パスを書き、後のフェーズの入力にも同じパスを渡す。
  コミットの時機は上のとおりである。新しい try は同じパスに書き直し、前の try の文書は
  `git show <前の try のブランチ>:<runsDir>/<slug>/<ファイル名>` で読む。
- **`.codiel/runs/` の下のファイルはコミットしない**: `state.json`・`steps/`・`reports/` は `.gitignore` で
  git から外れている。`pr-body.md` や `review-body-<m>.md` などの本文ファイルは Write ツールで `reports/` に
  書き、コミットせずに投稿する。
- **報告のファイル**: 報告のファイル(`report.md`・`test-run-<n>.md`)を持つ委譲の先は、報告の本文を最終の
  返答で返し、報告のファイルを書かず、`git add` もしない。オーケストレーターは、完了通知を受けた直後に、
  state の更新や次の委譲より先に、本文を要約せずに `waits/<id>.md` と報告のファイルへ書き、その後で
  `wait-done` を呼ぶ(§3)。置き場は 2.6 に従う。
  `test-run-<n>.md` は、自分で実行した結果と `e2e/` の委譲の返答を合わせて書く。E2E の
  `summary.md` と `failure.md` は 2.10 に従う。
- **確認義務**: `pr` フェーズを開始する前に `git status --short` を実行し、残ったファイルを次のとおり分ける。
  - run の成果物(委譲先の変更、run の文書、intent、E2E のレポートの `results.json` と md)が残っていれば、
    `pr` を開始しない。E2E のレポートはオーケストレーターがコミットし、ほかは担当のサブエージェントに
    「変更をコミットしてください」と差し戻す(未コミット差分を抱えたまま PR を作成しない)。
  - それ以外は run の外のファイルとして扱う。`/codiel:init` の成果物(`.codiel/config.json`・`.gitignore`・
    `.claude/rules/codiel.md`・`CLAUDE.md`)、利用者のファイル、run に関係の無い記録が当たり、判定が付か
    ないものも含める。run の外のファイルはコミットしない。退避もしない。`start-phase pr` の後に
    `mark-ask pr --slug <slug> --kind confirm` で待ち、一覧を示して AskUserQuestion で「残したまま pr を
    続ける(PR には入らない)」か「ユーザーが自分で扱ってから続ける」かを聞く。答えを得たら `resume` する。

### 2.2 pr の運転

連携モードで手順が分かれる(§0 で判定した値を使う)。

- **github**: 本文を組み立てる前に、次の読み取り専用の Bash で PR テンプレートを探す。
  ```
  find . -maxdepth 2 -iname 'pull_request_template.*'
  ```
  ヒットのうち `.github/`・リポジトリのルート・`docs/` にある `pull_request_template.md` / `.txt`
  (大文字小文字を区別しない)だけを対象にし、`.github/` → ルート → `docs/` の順で最初に見つかった
  ものを使う。`PULL_REQUEST_TEMPLATE/` 配下にしかヒットがないときは使わない(GitHub の Web 画面も
  `?template=` の指定が無ければそれらを適用しないため)。
  テンプレートを使うときは、見出しの構成を保ち、記入の案内の HTML コメントを消す。
  `<!-- codiel:generated -->` などの codiel のマーカーは消さない。codiel が必ず書く項目(変更の説明、
  intent 文書へのリンク、`Closes #N`(Issue を入口にした run)、テストの結果)に当たる見出しが無ければ
  末尾に足す。PR 本文に入れない内容(要望・受け入れ基準・原文・run の経緯)を求める見出しには、intent
  文書へのリンクを書き、転記しない。同意・署名・人の確認を表すチェックボックス(行動規範への同意、CLA
  の署名、「テストした」など)は付けずに残し、人が確かめる項目であることを本文に書く。テンプレートが
  見つからなければ、`github-writing.md` の執筆規則だけに従って書く。
  本文の内容は `github-writing.md` の「PR 本文」に従う(要望・経緯は転記せず、リンクだけを置く)。
  `imageUpload` に使える手段があれば、E2E のレポート(2.10)の画像など、関連する画像を画像の
  縮退の順序で載せる。本文には `<!-- codiel:generated -->` を含める(投稿する本文すべてに共通する規律)。
  組み立てた本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/pr-body.md` に書く。この本文ファイルは
  コミットしない。`git push -u origin <state.branch>` を実行してから、別の Bash 呼び出しで次を実行して PR を作る。
  gh の `-T` / `--template`・`--fill` 系・`--web` / `-w` は使わない。
  ```
  gh pr create --title "<タイトル>" --body-file .codiel/runs/<slug>/try-<n>/reports/pr-body.md
  ```
  作成後、次を実行する。
  ```
  node <plugin-root>/scripts/codiel-state.mjs complete-phase pr --slug <slug> --pr-url <URL>
  ```
- **local**: push しない。run ブランチと base は `state.branch` / `state.baseBranch` にある。次を
  `--pr-url` なしで呼ぶ。
  ```
  node <plugin-root>/scripts/codiel-state.mjs complete-phase pr --slug <slug>
  ```
  完了報告に、ベースブランチへ取り込むためのマージ手順(マージ元のブランチ名とマージ先)を載せる。

開始前に `git status --short` を実行し、2.1 の確認義務に従う。

### 2.3 finalize の運転

全フェーズが `passed` になったら、`codiel-state finalize --slug <slug>` を呼ぶ前に、次の手順で結果
レポートと intent の `status` を確定する。

1. intent の原文のセクション(`## ASIS` / `## TOBE`)の記録 1 件ごとに、「達成 / 未達 / 要確認 / 持ち越し」
   のいずれかを判定する。持ち越しの注記(`intent-format.md` が定める形)がある記録は判定から外し、結果
   レポートに「持ち越し」として示す。要望の単位は原文の記録 1 件を基本とし、1 件に複数の要望があるときは
   原文の該当箇所を引用して分けて示す。分け方は表示のためだけであり、原文へ書き戻さない。
2. 派生文のセクション(`## 現状調査`・`## 要求`・`## 受け入れ基準`)、設計、実装が原文と食い違ったら、
   **原文を正とし**、次を実行して人に確認する。原文は自動で書き換えない。
   ```
   node <plugin-root>/scripts/codiel-state.mjs mark-ask finalize --slug <slug> --kind confirm
   ```
   人が派生文側を直すと決めたら、intent の派生文のセクションをこのフェーズの中で直し、確認を終えたら
   `codiel-state resume --slug <slug>` で戻す。食い違いは結果レポートの「要確認」として示す。
3. 持ち越しを除いて原文の要望が**すべて達成のときだけ `status: done`** にする。1 件でも「未達」か
   「要確認」が残れば `in-progress` のままにし、結果レポートに残りを示す。
4. intent を更新したら run ブランチへコミットする。続けて E2E の途中のレポートを消してコミットする
   (2.10)。github モードでは続けて `git push` し、PR に反映させる。local モードでは push しない。
5. 上記を終えてから次を呼ぶ(全フェーズ `passed` を検証し `status` を `awaiting_outcome` にする唯一の
   コマンド。`complete-phase` ではない)。
   ```
   node <plugin-root>/scripts/codiel-state.mjs finalize --slug <slug>
   ```
6. run 中に委譲先またはオーケストレーターが気づいた ARCHITECTURE と実装の乖離を一覧にする。
   metatron が導入されていれば `/metatron:update` へ引き渡す旨を結果レポートに書き、導入されていな
   ければ報告に残すだけにする。codiel は ARCHITECTURE を作らない。
7. ADR 候補を結果レポートに挙げる。一覧の出どころは `adrTarget` で分ける。
   `metatron` は `steps/intent-sync/report.md` に書き残した ADR 候補の一覧、`intents` は今回取り込んだ持続層のファイルにある
   `[ADR 候補: <候補 ID>]` の見出しの一覧である。候補が無いときは、3 条件を満たす判断が無かったのか、取り込みを飛ばしたのかを書く。
8. 結果レポートを、原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」の表と、6. の乖離の一覧と、
   7. の ADR 候補の一覧と、持続層への取り込みの結果を含めて出力し、終了する。取り込みの結果には、取り込んだ
   領域ファイルのパスを書く。取り込みを飛ばしたときは「対象外」とだけ書かず、「取り込みを飛ばした理由」を
   書く。理由には、`domains` が空で `## 意図的な制約` が「なし」だった場合と、2.11 の確認でユーザーが
   領域を決めなかった場合がある。

### 2.4 共通

- フェーズの途中で人に確認するときは `mark-ask`(`--kind confirm` を付ける)を使う一般則とする。
  ```
  node <plugin-root>/scripts/codiel-state.mjs mark-ask <phase> --slug <slug> --kind confirm
  node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>
  ```
  `awaiting_human` にしてから確認し、答えを得たら `resume` で戻す。`evaluationId` は無くてよい。
  `mark-ask` が受け付けるのは `in_progress` のフェーズと、`pending` の finalize だけである。
  フェーズの合間(直前のフェーズが passed で、次がまだ pending)に確認するときは、次のフェーズを
  `start-phase` してから `mark-ask` する。
- ユーザーが run の途中で言葉を足したら、どのフェーズでもその場で intent の原文のセクション
  (`## ASIS` / `## TOBE`)の末尾へ、日付・話者・出所の行つきで即座に追記する。承認は要らない。
  既存の原文は書き換えない。
- 追記が intent-sync より後で、この run に含めると決めたときは、次を実行して run を止め、新しい
  try を intent から始める。intent は `abandoned` にせず `in-progress` のまま残る。
  ```
  node <plugin-root>/scripts/codiel-state.mjs stop --slug <slug> --reason intent-updated
  ```
- run を止めるとき(人が中止を選んだとき、`intent-updated` で止めるとき、別の try を始めるとき)は、`stop` の前に、
  `codiel-state get` の `waits` に残っている委譲を、出どころで分けて片付ける。
  - 今のセッションで出した委譲: `taskId` があれば `TaskStop` で止め、`wait-clear` で待ちを消す(返答が無いので `wait-done` は使えない)。`taskId` が無ければ完了通知を待ち、返答を書いて `wait-done` する。
  - 前のセッションから残った待ち: 通知は来ないので待たず、`wait-clear` で消す。
  `stop` は待ちが残っていると失敗する。`--abandon-waits` は、今のセッションの委譲を止めず完了も待たずに止めると人が決めたときだけ付ける。worktree とブランチの
  削除は、`waits` が空になってから行う。委譲が止まる前に、書き込み中の worktree を消さないためである。

### 2.5 worktree

test-code・implement・test-loop の並列委譲は、1 ステップまたは 1 仕様のディレクトリにつき 1 worktree で
行う。

- パスは `.codiel/worktrees/<slug>/<名前>`、ブランチは `codiel/<slug>-try-<n>-<名前>` とする。名前は、
  implement のステップ番号 k で `step-<k>`、test-code は `test-code-<k>`、test-loop の修正は
  `test-loop-<k>` である。k は、その表(`implement.steps` / `testCode.units` / `testLoop.units`)に
  登録した順の番号(1 から)で、test-loop の登録し直しでも変わらない。
- 起点は、そのグループ・仕様のディレクトリを始める時点の run ブランチ HEAD である。
- worktree のパスは run の中で一意である。`step-update --worktree` は、ほかの要素がすでに記録した
  パスを拒否する。
- `.codiel/worktrees/` は、run の最初の worktree 作成時に `.git/info/exclude` へ加える。追跡ファイルを
  変えずに、`pr` 前の `git status --short` の確認を汚さないためである。
- worktree の開始時に、dev-plan の `## 環境準備` のコマンドで依存をインストールする。「なし」のときは
  lockfile の種類から既定を選び、lockfile が無ければ省く。
- マージ済みの worktree は、マージの直後に `git worktree remove` し、ブランチを削除する。`git worktree remove` の後に空になった
  `.codiel/worktrees/<slug>/` は、リポジトリ相対のパスの `rmdir` で消す。`rmdir` は空でなければ失敗するので、
  残った worktree を巻き込まない。失敗した worktree は run の終了まで残すが、やり直す前には必ず削除してから
  新しい HEAD で作り直す。run の終了時(finalize または stop)には、残っている worktree とブランチを
  すべて削除する。stop のときは、`waits` が空になってから削除する(2.4)。

### 2.6 テストを実行する委譲の並べ方と環境の失敗

中でテストを実行する委譲(test-code の委譲、implement の実装と修正ラウンドの委譲、グループのマージの
後の `e2e/` の実行の委譲、test-loop の `e2e/` の回帰の実行と修正の委譲、fix-loop の `e2e/` の回帰の実行の委譲、グループのマージの後や test-loop のプロジェクト全体の run ブランチ上の修正の委譲、
下記の環境の失敗の実行し直しの委譲)を、次の 2 種類に分けて出す。タスクレビューのような読み取りだけの
委譲には当てない。

- 並列可の委譲: `parallel: true` を `spec.md` の frontmatter に持つ仕様のディレクトリで、そのテストだけを
  実行する委譲。「動いている委譲」は、同じフェーズでこの規則を当てる委譲のうち待ちの記録が残っているものを指す。
  動いている委譲が無いか、並列可の委譲だけのときに出す。同時に動かすのは 4 件までとし、出せるものが 2 件以上
  あれば、上限の範囲で同じ応答からまとめて出す。
- 単独の委譲: 並列可の委譲に当たらないもの(implement のすべての通すテストを実行する委譲、`parallel`
  を持たない仕様のディレクトリの test-code・test-loop の修正、test-loop と fix-loop の `e2e/` の回帰の実行、run ブランチ上の
  修正)。待ちが空のときだけ出し、その待ちが残っている間は同じフェーズのほかの委譲を出さない。
  メインの作業ツリーで `set-domain` を伴う委譲の待ちが残っている間は、メインの作業ツリーで動くほかの委譲も出さない(`domain` は 1 値しか持てない)。worktree の中で動く委譲には当てない。

test-code と test-loop の修正は、担当する仕様のディレクトリの `parallel` で種類が決まる。implement で
はオーケストレーターが委譲ごとに選ぶ。ステップが 2 つ以上のグループの最初の委譲は並列可、ステップが
1 つのグループ・`serial` グループ・`final`・衝突の後のやり直しは単独にする。修正ラウンドの委譲は、動い
ている委譲があれば並列可、無ければどちらでもよい。

グループのマージの後、オーケストレーターは run ブランチでそのグループの実行する通すテストのうち、
プロジェクトの test コマンドと `units/` のテストを自分で実行する。`e2e/` のテストは、仕様のディレクトリ
ごとに実行の委譲を出す(2.10)。自分の実行は直列で行い、このセクションの並列可・単独の規則は委譲にだけ当てる。
同じグループのほかの委譲が動いている間は `parallel: true` のものだけを実行し、動いていなければすべて
を実行する。実行しなかったものは委譲先が報告に挙げ、ここで含めて実行する(`e2e/` は委譲する)。

環境の失敗(サーバーが起動しない、接続が拒否される、ポートが使用中、必要なサービスが無いなど)は、
未実装による失敗にもプロダクトの失敗にも数えない。委譲先は理由と出力の抜粋を報告(`report.md`。
test-loop の `e2e/` の回帰の実行では `test-run-<n>.md`、fix-loop の回帰の実行では `test-run-<n+1>.md`)に挙げ、最終の返答で返す。オーケストレーターは、動いている委譲が
無いときに 1 回だけ単独で実行し直させ、実行し直した委譲の返答を、元の報告の末尾の `## 実行し直し` の
セクションへ自分で書く(state は変えない)。オーケストレーター自身が実行したテスト(プロジェクトの test コマンドと `units/` のテスト)は、自分で 1 回だけ実行し直し、
その回の報告(implement のグループのマージの後は `steps/merge-test-<g>/report.md`、test-loop は `test-run-<n>.md`、fix-loop は `test-run-<n+1>.md`)の `## 実行し直し` のセクションへ自分で書く。
中断後の再開では、このセクションの有無で実行し直しが済んだかを判断し、1 回だけの規則を保つ。
実行し直しても環境の失敗なら、`mark-ask <phase> --slug <slug> --kind confirm` の後に人に確かめる。

報告のファイルは、完了通知で返答を受けたオーケストレーターが `waits/<id>.md` に書いた後、次の置き場へ書く(2.1)。
- `parallel` グループの各ステップ・test-code・test-loop の各仕様のディレクトリ: `steps/<worktree の
  名前>/report.md`
- `serial` グループと `final`: `steps/step-<k>/report.md`
- グループのマージの後の修正: `steps/merge-fix-<g>/report.md`(g は、そのグループのステップの state の
  `group.index`(0 から)に 1 を足した値)
- グループのマージの後のテストの実行: `steps/merge-test-<g>/report.md`(g は `merge-fix-<g>` と同じ番号)。
  自分で実行した結果と、そのグループの `e2e/` の実行の委譲の返答を合わせて書く
- test-loop のどの仕様のディレクトリにも属さない失敗の修正: `steps/test-loop-project/report.md`
- intent-sync の控え(取り込んだ領域ファイルのパス・書かずに終えた矛盾・ADR 候補): `steps/intent-sync/report.md`(テストの実行ではなく、`syncing-intents` が書く)
- test-loop の回帰: `reports/test-run-<n>.md`
- fix-loop の回帰: `reports/test-run-<n+1>.md`

### 2.7 test-code の運転

1. test-spec と dev-plan の pass-gate の後に `start-phase test-code` する。
2. test-spec が作成・更新した仕様のディレクトリを、
   `step-add --slug <slug> --kind test-code --id <ID>` で `testCode.units` に登録する。
   `--files`・`--deps`・`--final`・`--domain` は渡さない(test-code はドメイン境界を課さない)。
3. 「2.6」に従って委譲する。委譲先は worktree(名前は `test-code-<k>`)の中で Red を確かめ、worktree の
   ブランチへコミットする。brief と report は `.codiel/runs/<slug>/try-<n>/steps/test-code-<k>/` に
   置く。report は委譲先の返答から書く(2.1)。E2E は仕様のディレクトリごとに 1 回起動させ、レポートの出力先を
   渡す(2.10)。brief には testsDir の値、仕様のディレクトリの ID、入力のパスを書く。
4. report.md の環境の失敗を実行し直させてから(2.6)、読み取りだけのタスクレビューへ進む。観点は、
   ケースとテストの 1 対 1、期待結果が `cases.md` の文言どおりか、Red の理由、置き場が規約どおりか、
   `tests` の記録と置いたファイルの一致の 5 つである。所見があれば「2.8」の 6 と同じ上限で修正ループを
   回す。ラウンドは `testCode.units[<ID>].attempts` で数える。
5. レビューを通ったディレクトリから、run ブランチへ順にマージする。
6. 委譲先が「cases.md の誤り」を報告したディレクトリは、マージせずに要素を `failed` にして worktree を
   後始末し、`writing-test-specs` に従う成果物を書く委譲で run ブランチ上の `cases.md` を直させる。期待
   結果を変える必要が無いと直す委譲が報告したら `mark-ask test-code --kind confirm` の後に人に確かめる。
   直したら要素を `pending` に戻し、そのディレクトリの test-code をやり直す。
7. 全ディレクトリのマージの後、E2E のレポートをコミットしてから(2.10)`evaluate_code` を呼ぶ。渡すものは
   `raguel-gating` の対応表の test-code の行に従う。`testResults` は各 report.md の Red の確認の
   要約とする。objective は、本体の後に「実装の前なので、Red の対象のテストが失敗するのは期待どおりで
   ある」の 1 文を足す。
8. `pass-gate test-code` する。

### 2.8 implement の運転

1. dev-plan のステップを `step-add --slug <slug> --id <ID> --files '<JSON 配列>' --deps '<JSON 配列>'
   [--final] [--domain <名前>]` で登録し、`codiel-state waves --slug <slug>` で実行順を得る。非ゼロで
   終わったら dev-plan を差し戻し、`evaluate_plan` を呼ばない(循環依存は dev-plan のゲートで検出す
   る)。
2. `waves` の `groups` を先頭から順に処理する。`parallel` グループは 3〜8、`serial` グループと `final`
   は run ブランチ上で 1 ステップずつ、`set-domain` を使って委譲する(§4.1)。
3. `parallel` グループの各ステップに brief ファイル
   `.codiel/runs/<slug>/try-<n>/steps/step-<k>/brief.md` を書く。内容は §3 のテンプレートに、worktree
   の絶対パス・触るファイル・前提ステップ・環境準備のコマンドと、選んだ委譲の種類・実行する通すテスト
   (そのステップの `spec.md` の `tests` を写す)・選んだ観点ファイル・通すテストに E2E があるときのレポートの
   出力先(2.10)を加えたものである。
4. 実装の委譲を「2.6」に従って出す。依頼文は brief の絶対パスを読ませる。委譲先は worktree 内で依存の
   インストール・実装・brief が挙げた通すテストの実行を行い、実行しなかった通すテストと環境の失敗を
   最終の返答で報告し(オーケストレーターが `report.md` に書く)、worktree のブランチへコミットする。生成物は dev-plan の `## 生成物` の方式に
   従う(方式 a はソースと同じコミットに入れ、方式 b はコミットしない)。
5. report.md の環境の失敗を実行し直させてから(2.6)、ステップごとに並列でタスクレビュー(読み取り
   だけ)を出す。観点は仕様適合(dev-plan のステップと受け入れ基準に合うか)と品質である。
6. 所見があれば修正ループを回す。上限は 5 ラウンドとし、`implement.steps[k].attempts` で数える。
   - 1〜3 ラウンド: 同じ委譲先を、文脈を保ったまま続投させる。
   - 4〜5 ラウンド: 作業内容を「行き詰まりの打開」と明記した新しい委譲として出す。委譲先の選択は
     セッションの規律に委ね、役割名もモデル名も書かない。
   - 5 ラウンドで通らなければ、run を `awaiting_human` にする。
7. レビューを通ったステップから、run ブランチへ順に `git merge --no-ff` する。衝突したら
   `git merge --abort` し、そのステップを `failed` にする。グループの残りのマージが済んだ後、worktree
   を後始末してから新しい HEAD で作り直し、直列にやり直す。
8. グループのマージが済んだら、run ブランチでそのグループの実行する通すテストを実行する(プロジェクトの
   test コマンドと `units/` は自分で、`e2e/` は委譲する。2.6)。自分の実行結果と `e2e/` の委譲の返答は
   `steps/merge-test-<g>/report.md` に書く。それ
   以外の失敗は、修正を成果物を書く委譲として run ブランチ上で直列に出す。報告は
   返答で返させ、`steps/merge-fix-<g>/report.md` に書く(2.6)。
9. 方式 b では、全グループの後に `final` の最終ステップ(生成物の生成とコミット)を run ブランチ上で
   委譲する。
10. 全グループと `final` の後、E2E のレポートをコミットしてから(2.10)、implement 全体に対して
    `evaluate_code` を 1 回呼び(渡すものは `raguel-gating` の対応表の implement の行に従う)、
    `pass-gate implement` する。

state を書くのはオーケストレーターだけである。ステップ担当のサブエージェントとレビュー担当は
`codiel-state` を呼ばない。

### 2.9 test-loop の運転

test-loop はテストを書く手順を持たない。記録された全テストの回帰の確認と修正を、全件が通るまで繰り
返す。

1. `<testsDir>/**/spec.md` の `tests` に記録された全テストと、プロジェクトの test コマンドを実行する。
   プロジェクトの test コマンドと ID が `units/` で始まる仕様のディレクトリは、オーケストレーターが
   run ブランチ上で直列に実行する。ID が `e2e/` で始まる仕様のディレクトリは実行の委譲を出し、
   同時実行は `spec.md` の frontmatter `parallel: true` の仕様のディレクトリだけとし、無ければ直列に
   する(2.6)。影響の有無で絞らない。E2E の仕様のディレクトリは、ディレクトリごとに 1 回の実行にし、出力を 2.10 の置き場へ出させる。
2. 判定が出ないもの(broken)はテストの欠陥の疑いとし、判定が出て期待と違うもの(NG)はプロダクトの
   バグとする。理由が環境にある失敗は broken にも NG にも数えず、「2.6」のとおり扱う。
3. NG は仕様のディレクトリごとにまとめ、`step-add --kind test-loop --id <ID>` で `testLoop.units` に
   登録し、「2.5」と同じ worktree(名前は `test-loop-<k>`)とマージの方式で修正を委譲する。前の巡で
   `merged` になった要素は次の巡で登録し直す(k は変わらない)。brief と report は
   `.codiel/runs/<slug>/try-<n>/steps/test-loop-<k>/` に置き、登録し直しても同じディレクトリに書き
   直す。修正の委譲には、失敗した仕様のディレクトリの最新のレポートの絶対パスを渡す(2.10)。
4. どの仕様のディレクトリにも属さない失敗(プロジェクトの test コマンドだけが見つけた失敗)は、run
   ブランチ上で直列に修正を委譲する。報告は返答で返させ、`steps/test-loop-project/report.md` に書く。次の巡でも
   同じ置き場に書き直す。
5. broken は、テストが保護されているので、`mark-ask test-loop --kind confirm` の後に人に確かめてから
   直す。直す委譲の書き込みは ask になり、人が承認する。
6. 修正の 1 巡(委譲・マージ・全体の再実行)を、`record-attempt test-loop --slug <slug>` の 1 回と数え
   る。
7. 要素のドメインは、ID が `units/<パス>` のときそのパスがドメインマップのどのドメインの glob に収まる
   かで決め、`step-add --domain` で渡す。E2E の ID と 1 つのドメインに決まらないものは境界を課さない。

### 2.10 E2E のレポート

E2E のレポートは、E2E の仕様のディレクトリの `reports/` に実行ごとに置く。置き場・名前・md の形・直し方の
規則は `<plugin-root>/references/e2e-report-format.md` に従い、ここには運転だけを書く。

- 対象は、test-code の Red の確認、implement の委譲とグループのマージの後の実行、test-loop の回帰の実行と
  修正、fix-loop の回帰の実行、環境の失敗の実行し直しである。`units/` の仕様のディレクトリには置かない。
- 実行の前に、実行ごとのディレクトリの名前 `<日時>-<slug>-try<n>` を決める。日時は実行する機械の
  ローカルのタイムゾーンの `YYYYMMDD-HHMMSS` とし、Bash では `date +%Y%m%d-%H%M%S` で得る(`date -u` を使わない)。
  メインの作業ツリーの絶対パスで置き場を依頼文(worktree の委譲では brief)に書く。worktree の中で実行する
  委譲も、出力はメインの作業ツリーの置き場に出させる。
- E2E は仕様のディレクトリごとに 1 回起動させる。1 回の起動で複数の仕様のディレクトリを走らせると、
  `results.json` を置き場ごとに分けられない。
- `summary.md`・`failure.md`・JSON を出せないフレームワークの `results.json` は、委譲先の完了通知を受けて
  `waits/<id>.md` を書いた直後に、`e2e-report-format.md` に従ってオーケストレーターが書く。Red の確認の実行は、ケースの結果にかかわらず `summary.md` を置く。
- `failure.md` の直し方は、その回の失敗を直した委譲の返答から書く。書く時点で分からなければ「未記入」と書き、
  次のどれかで書き換える。修正の委譲の完了通知を受けて `waits/<id>.md` を書いた直後に、返答の直し方を書く。修正の委譲が無いまま失敗が
  消えたときは、同じ仕様のディレクトリの次の実行がパスした時点で「なし」と理由を書く。直す前に run が止まる
  ときは、stop の前に「なし」と理由を書く。
- コミットは 2 つの契機で行う。`evaluate_code` を呼ぶ前に、そのフェーズで作った実行ごとのディレクトリと、
  そのフェーズで直し方を書き換えた前のフェーズの `failure.md` を `git add -- <パス>` し、
  `codiel(<phase>): E2E のレポート (<slug> try-<n>)` でコミットする。`codiel-state stop` を呼ぶ stop の直前に、
  まだコミットしていない実行ごとのディレクトリと `failure.md`(直し方を「なし」に書き換えたものを含む)を
  同じ形でコミットする。コミットするものが無ければ行わない。git に載るのは `results.json` と md だけで、画像は
  `.gitignore` が外す。
- review に渡す diff からは、E2E のレポートを pathspec `':(exclude,glob)<testsDir>/**/reports/**'` で
  除く。Raguel は差分を自分で作ってレポートを評価から外すので、`evaluate_code` にはこの除外を渡さない。
  一方、レポートのコミットは `evaluate_code` の前に要る。
- implement の修正(タスクレビューの修正ラウンドとグループのマージの後の修正)と test-loop の修正の委譲には、
  失敗した仕様のディレクトリの最新のレポート(名前の順で最後の実行ごとのディレクトリ)の絶対パスを渡す。
  委譲先は `failure.md`・`results.json`・画像を読んで直し方を決め、直した実行ごとのディレクトリの名前と
  直し方を返答に入れる。
- finalize で、この try の途中のパスした実行と Red の確認の実行を消す。残すのは、失敗した実行(`failure.md`
  を持つもの)と、仕様のディレクトリごとのこの try の最後の実行である。名前が `-<slug>-try<n>` で終わる
  ディレクトリのうち残さないものを、リポジトリ相対のパスで `git rm -r -q -- <パス>` し、無視された画像が
  残れば `rm -r -- <パス>` で消す。絶対パスは guard-bash の `rm -rf` の判定に当たる。消したら
  `codiel(finalize): 途中の E2E のレポートを消す (<slug> try-<n>)` でコミットし、github モードでは push する。
  前の run と前の try のディレクトリには触れず、stop で終えた try では刈り込まない。
- PR・Issue・コメントに証拠を載せるときは、レポートの画像とログを使い、画像は `imageUpload` の手段で載せる。
  local モードと手段が無いときは、画像の置き場(実行ごとのディレクトリ)を本文に書く。

### 2.11 intent-sync の運転

intent-sync を書く前に、オーケストレーターが intent の frontmatter `domains` と `## 意図的な制約` を
読む。取り込みを黙って飛ばさないための確認である。
人の確認で止まった後に再開するときは、書く直前に intent をもう一度読み、`domains` の値をこの時点の
値に置き換えてから、下の分岐を決める。止まっている間に、人が `domains` を書き換えていることがある。

- `domains` が空で、`## 意図的な制約` の表に 1 行以上ある(「なし」でない)ときは、次の順に進める。
  1. intent-sync を `start-phase` した後に、`mark-ask intent-sync --slug <slug> --kind confirm` で
     `awaiting_human` にする。
  2. 制約の行と、`domains` が空であることを示し、AskUserQuestion で領域名を聞く。候補は、ドメインマップが
     読めればそのキー、読めなければ TOBE と現状調査から作った 2〜3 個(英小文字のケバブケース)にする。
     複数を選べるようにし、候補の外の答えも受ける。
  3. 決まった領域名を intent の frontmatter `domains` に書く(1 行のフロー形式)。
  4. `resume` で戻し、`domains` を使って intent-sync を書く。frontmatter の変更は、intent-sync の成果物と
     一緒にコミットする。
- 領域を決めないと答えたときは、`domains` を空のまま `resume` し、取り込みを行わずに進む。理由は finalize の
  結果レポートに書く(2.3)。
- `## 意図的な制約` が「なし」で `domains` が空なら、確かめずに取り込みを行わない。`## 目的` と `## 非スコープ`
  だけのために領域を聞かない。
- 取り込み先は `domains` の領域とする。領域が空なら取り込みを行わず、取り込まなかった理由と、
  `## 意図的な制約` に行があったかを finalize の結果レポートに書く(2.3)。

## 3. ディスパッチプロンプトの規約

サブエージェントのディスパッチは **Agent ツール**で行う。
委譲先は名指しせず、作業内容を渡して委譲する。作業内容による委譲の解決はセッションに注入された規律に従い、規律が無ければビルトインの委譲先へ送る。

委譲はバックグラウンドで動く。完了は後のターンに通知として届く。run があるときの委譲は、次の順で扱う。

- Agent ツールの結果で起動を確かめてから、`codiel-state wait-add --slug <slug> --id <id> --purpose <文> --task-id <返った ID>` で待ちを記録する。起動に失敗した委譲は記録しない。
- `id` は `<フェーズ>-<要素>-<回>` の形で委譲ごとに付け、try の中で使い回さない。要素の部分は、仕様のディレクトリの ID やステップの名前から作る。英小文字と数字以外の文字(`/`・`_`・`.`・大文字など)は、小文字にしてハイフンに置き換え、連続するハイフンは 1 つにする。100 文字を超える `id` は `wait-add` が拒否する。修正ラウンド・回帰の巡・実行し直しは回を上げて別の待ちにする。`purpose` は何の委譲かを書く 1 文にする。
- 並列にする委譲は同じ応答からまとめて出し(review の観点ごとの委譲を含む)、`wait-add` は 1 件ずつ順に呼ぶ。`codiel-state` の呼び出しは並列の Bash にしない。state の読み書きにロックが無く、並列に呼ぶと更新が失われる。
- `evaluate_*` が Claude Code にバックグラウンドへ移されたときも、`gate-<フェーズ>-<回>` の `id` で `wait-add` する。`<回>` は、そのフェーズの評価の回(attempt)である。
- 待つ間にできる作業(自分が書く文書・自分が実行するテスト)があれば進める。自分でテストを実行するのは、2.6 の規則で許される場合(動いている委譲が worktree の中だけか、`parallel: true` のものだけ)に限る。メインの作業ツリーで単独の委譲が動いている間は実行しない。作業が無ければターンを終えて完了通知を待つ。
- 並列に出した委譲のグループ(同じ応答で出した委譲、implement の同じグループ、観点ごとの review)は、そのグループの待ちがすべて消えてから、マージ・まとめての実行・`evaluate_*` へ進む。要素ごとに進めてよいのは、タスクレビューのような要素単位の作業だけである。
- 完了通知を受けたら、返答の本文を要約せずに `.codiel/runs/<slug>/try-<n>/waits/<id>.md` へ書き、続けて既存の報告の置き場(2.1・2.6)へ書く。その後で `codiel-state wait-done --slug <slug> --id <id>` を呼び、次の委譲やゲートへ進む。報告を書く前に state の更新や次の委譲へ進まない。
- review と再レビューでは、観点ごとの返答を各 `waits/<id>.md` に書いて、観点ごとに `wait-done` を呼ぶ。観点をまとめる `review-<m>.md`(再レビューでは `review-<m+1>.md`)は、グループのすべての待ちが消えてから書く。この統合報告は、上の「`wait-done` の前に書く」規則の例外である。
- 委譲を出し直すときは、新しい回の `id` で記録する。

run が無いときの委譲(`capturing-intent` の現状調査、`/codiel:test` の単独実行)は、待ちを記録しない。stop-guard も run が無ければ止めない。
active な run があるときの `/codiel:test` の単独実行は、`adhoc-` で始まる `id` で待ちを記録する。

待ちの記録が残っている間、stop-guard は停止を止めない。消し忘れた待ちがあると、その run では未完了の停止を検出できなくなるので、報告を書いたら必ず `wait-done` を呼ぶ。

プロンプトは次のテンプレートを満たす。作業内容、読むスキルと観点ファイルの絶対パス、入出力ファイル、§0 で解決した前提値、前フェーズ findings の要約、完了条件を含める。

```
あなたはサブエージェントである。次の作業を担当する。
- 作業内容: <このフェーズの作業内容>
- 入力から出力: <入力 → 出力>

## 読むスキル
このフェーズで読むすべてのスキルを、解決済みの絶対パスで列挙する。
- <plugin-root>/skills/<スキル名>/SKILL.md

## 観点ファイル
このフェーズで読むすべての観点ファイルを、解決済みの絶対パスで列挙する。
- <plugin-root>/skills/<スキル名>/references/<担当タグまたは観点>.md

## 入力ファイル
- <入力ファイルパス1>
- <入力ファイルパス2(あれば)>

## 出力ファイル
- <出力ファイルパス>

## 前提
- ARCHITECTURE: <§0 で解決した絶対パス。読み物として渡す。存在しなければ「なし」>
- GOTCHAS: <§0 で解決した絶対パス。存在しなければ「なし」>
- 実行モード: <mapped | unscoped>
- ドメインマップ: <mapped のときは §0 で読み取った JSON の全文。unscoped のときは「なし」>
- 担当タグ: <このディスパッチで担当するタグ。ドメインに紐づかない役割では「なし」>

ARCHITECTURE と GOTCHAS は、存在すれば作業前に読み、存在しなければスキップする。
ドメインマップは上記の値を使い、ARCHITECTURE から読み直さない。
過去の落とし穴は GOTCHAS を踏まえる。委譲先は ARCHITECTURE と GOTCHAS を書き換えない。
ARCHITECTURE と実装の乖離、または記録すべき失敗に気づいたら、その場で直さず報告に書く。

## 前フェーズの申し送り(findings)
<前フェーズの EvaluationResult.findings を ruleId + message の箇条書きで要約したもの。
なければ「なし」>

## 完了条件
完了したら、成果物のファイルパスのみを報告する。
diff の中身やファイル内容を会話に貼り付けない。
報告のファイルを持つ委譲(2.1)は、報告の本文を最終の返答で返す。報告のファイルは書かない。

## セッションの規律の転記
セッションの規律が依頼文への転記を求める条項があれば、ここに置く。
```

読み取りだけの委譲では、依頼文に次の 3 条項を追加する。
- 使用してよい tools を読み取り系に限定する。`Read` / `Grep` / `Glob` と読み取りに限った `Bash` だけを許可する。
- ファイルを変更しない。
- 報告のみを返す。

test-spec の依頼文には、git 操作をしない旨を追加する。

すべての委譲の依頼文に、§0 で得た testsDir の値を書く。

test-spec の依頼文には、次の 2 条項も追加する。
- 使用してよい tools を `Read` / `Grep` / `Glob` / `Write` / `Edit` と Context7 に限定する。`Bash` は使わない。
- 書き込み先を `<testsDir>/<仕様のディレクトリ>/` の `spec.md` と `cases.md` に限る。

test-code の依頼文には、次の 2 条項も追加する。
- 担当する仕様のディレクトリの ID と、`<testsDir>/<仕様のディレクトリ>/` の `spec.md` / `cases.md`
  のパスを書く。
- テストコードは規約の場所に置き、`spec.md` の frontmatter `tests` にパスを足す以外は `spec.md` の
  本文と `parallel`・`cases.md`・プロダクトコードを書き換えない。

implement・test-loop・fix-loop の依頼文には「テストと `<testsDir>/**` の仕様(`spec.md`・`cases.md`)を
書き換えない」の文を入れる。

委譲の依頼文には「intent 文書を書き換えない。原文の追加が必要ならオーケストレーターへ
報告する」の文を入れる。intent-sync はオーケストレーターが `syncing-intents` に従って書く。派生文の
セクションだけを書き換え、原文のセクションを書き換えず、関係する領域の持続層
(`docs/intents/domains/<領域>.md`)への取り込み作業を含める。

観点ファイルは次の規則で依頼文に足す。
- 実装の委譲(implement / test-loop の修正 / fix-loop の修正)では、変更の中身から、`<plugin-root>/skills/implementing/references/` の中で合う観点ファイルを選んで足す(dev-plan の触るファイルと内容、直す所見や失敗を見る)。`mapped` でタグ名と同じ名前のファイルがあれば必ず含める。`unscoped` でも、変更の中身に合うものを渡す。
- review / 再レビューでは、観点ごとに `<plugin-root>/skills/reviewing-diffs/references/<観点>.md` を必ず足す。
- 観点ファイルの存在はオーケストレーターが `Glob` または `ls` で確認する。委譲先に探させない。

ARCHITECTURE / GOTCHAS のパス、実行モード、ドメインマップは §0 で解決した値をそのまま埋める。サブエージェントに解決させない。

ディスパッチ後、オーケストレーターは成果物ファイルが実際に存在し空でないことを確認する。確認後に raguel-gating のゲート手順に進む。サブエージェントの報告だけで完了としない。

## 4. ドメインディスパッチ

委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。

- `mapped` の実装 / test-loop の修正では、ステップのタグ `X` を依頼文にそのまま渡す。worktree 内の境界
  は `step-add --domain` で記録した `X` を guard-write が引いて判定するので、`set-domain` は使わない
  (§4.1)。`serial` グループ・`final`・run ブランチ上の修正・fix-loop の修正では、依頼文に `X` を渡し、
  `set-domain` にも渡す。汎用の実装へ送るときも `X` を渡す。
- `set-domain` に渡す値はタグの値そのままとする。タグから別名を作らない。
- review / 再レビューでは `set-domain` を実行しない。
- `unscoped` では `set-domain` を呼ばない。ディスパッチ前に `clear-domain` を呼ぶ。

### 4.1 domain の設定と解除

実行モードが `mapped` のときだけ、ドメインに紐づく実装の委譲中に run の `domain` へ担当タグを持たせる。guard-write はこの値とドメインマップで境界を判定する。判定が働くのは implement / test-loop / fix-loop の 3 フェーズである。

```
node <plugin-root>/scripts/codiel-state.mjs set-domain --slug <slug> --domain <タグ>
node <plugin-root>/scripts/codiel-state.mjs clear-domain --slug <slug>
```

- worktree 内で動く委譲(implement の `parallel` グループの各ステップ、test-loop の仕様のディレクトリ
  ごとの修正)では `set-domain` を使わない。guard-write は、書き込み先が属する worktree の要素が
  `step-add --domain` で記録した `domain` を引いて境界を判定する。
- `set-domain` を使うのは、メインの作業ツリーで動く委譲(`serial` グループ、`final`、グループのマージの
  後の run ブランチ上の修正、test-loop のプロジェクト全体の修正、fix-loop の修正)を委譲する直前だけで
  ある。
- `--domain` にはステップに付いたタグの値をそのまま渡す。汎用の実装へ送るときもタグの値を渡し、タグから別名を作らない。
- `set-domain` を実行した委譲の完了通知を受け、`wait-done` を呼んだら、直後に `clear-domain` を実行する。解除しないと、次に `set-domain` するまで前の境界が効き続ける。
- `unscoped` では `set-domain` を呼ばない。各ディスパッチの前に `clear-domain` を実行し、`domain` を残さない。
- ドメインに紐づかない委譲へ移る前に、`domain` が残っている可能性があれば `clear-domain` を実行する。
- 実装と test-loop の修正の委譲の並べ方は「2.6 テストを実行する委譲の並べ方と環境の失敗」に従う。
- メインの作業ツリーで `set-domain` を伴う委譲の待ちが残っている間は、メインの作業ツリーで動くほかの委譲を出さない(2.6)。
- 複数のドメイン別委譲を同じ応答でディスパッチするとき(レビューで複数の観点を同時に扱う場合など)は、先に `clear-domain` を実行し、`set-domain` は実行しない。state が持てる `domain` は 1 つだけである。この場合のドメイン規律はディスパッチプロンプトで運用する。

境界違反は `deny` ではなく `ask` で返る。止まったら、`set-domain` した値と `dev-plan.md` の該当ステップのドメインタグを照合する。値が誤っていれば正しい値で `set-domain` し直して続行する。値が正しければ越境であり、その書き込みを認めず、該当ドメインの実装の委譲をやり直す。

## 5. ループ運転(test-loop / fix-loop)

test-loop の内部運転(回帰の実行と修正。「2.9 test-loop の運転」)は `running-regression-tests` /
`fixing-failures` に、fix-loop の指摘対応は `fixing-review-findings` に定める。オーケストレーターの
役割は次の 3 点のみ:

1. 修正のためのサブエージェント・ディスパッチ 1 往復ごとに(= 1 attempt)
   `node <plugin-root>/scripts/codiel-state.mjs record-attempt <phase> --slug <slug>` を呼ぶ。
   **record-attempt を呼ぶのはオーケストレーターのみ**(委譲先は呼ばない。二重計上の防止)。
   test-loop では修正の 1 巡(委譲・マージ・全体の再実行)を 1 回と数える。
2. exit code が `3`(試行上限超過・`capExceeded`)なら、**raguel-gating の ASK と同じ扱い**にする
   (`awaiting_human` は `record-attempt` 内部で既にセットされている。findings 相当の情報を人間に
   提示し裁定を待つ。自分で「あと1回だけ」と続行してはならない)。
3. fix-loop の所見がテストに向くと `fixing-review-findings` の検証で確かめたら、
   `node <plugin-root>/scripts/codiel-state.mjs set-test-edit --slug <slug>` を実行してからテスト側の
   修正を委譲する。完了通知を受けて報告を `waits/<id>.md` に書き、`wait-done` した直後に
   `node <plugin-root>/scripts/codiel-state.mjs clear-test-edit --slug <slug>` を実行する。その後でコードの
   修正を委譲する。

### fix-loop のスキップ経路

review フェーズの所見に critical / high が **一件もなければ**、fix-loop で実施することは何もない。
この場合、fix-loop を `start-phase` してから空振りで `complete-phase`/`pass-gate` しようとせず、
次のコマンドで明示的にスキップする:

```
node <plugin-root>/scripts/codiel-state.mjs skip-phase fix-loop --slug <slug> --reason "review で critical/high 0 件"
```

- `skip-phase` は `fix-loop`・`discuss`・`design` にしか使えない(それ以外のフェーズはフェイルクローズドで
  拒否される)。discuss と design の `skip-phase` は `state.scale === "light"` のときだけ成功する
  (「2. フェーズ進行表」の注記を参照)。
- 前提として review までの全フェーズが `passed` である必要がある。
- 成功すると `fix-loop` は `status: passed` / `verdict: SKIPPED` になり、`attempts` はリセットされずに
  維持される。以降 `triage` を通常どおり `start-phase` できる。
- **review に critical/high が 1 件でも残っている場合は skip-phase を使わない**。通常どおり
  修正を委譲する。

## 6. 再開手順

1. run を特定する。`--slug <slug>` が分かっていればそれを使う。intent パスだけが分かっているときは、
   その frontmatter `run` の値、無ければ state の `intent` が同じ値の run を slug として使う(逆引き)。
   state の `intent` だけで当たった run は、続ける前に slug・intent のパス・現在のフェーズを示して
   ユーザーに確かめる(「1. run の解決」と同じ扱い)。
   ```
   node <plugin-root>/scripts/codiel-state.mjs get --slug <slug>
   ```
   で `state.json` を取得する。`phases` に `test-code` を持たない state(M4 より前に作った run)は、
   どのフェーズにあっても続行せず、次の順で進める。intent は `abandoned` にしない。
   ```
   node <plugin-root>/scripts/codiel-state.mjs stop --slug <slug> --reason migrate
   ```
   止めたことと理由をユーザーに示し、同じ intent パスを入口に新しい try を始める(「1. run の解決」)。
2. `state.branch` が `null` でなければ `git switch <state.branch>` で run のブランチに切り替える。
   カレントブランチが別 run やベースブランチのままだと、成果物コミットが誤ったブランチに乗る。
   `git switch` の対象のブランチがまだ存在しないときは(`init` の後、`git switch -c` の前で止まった
   続行する run)、`capturing-intent` の手順 5 の (6) の続きから行い、`git switch -c <state.branch>`
   でブランチを作ってから続ける。`state.branch` が `null` の run(`--intent-only` の run)は、
   開始時のブランチの作業ツリーで intent フェーズの続きを行う。
3. 連携モードを再判定する。`node <plugin-root>/scripts/check-intent-env.mjs` を実行し直し、§0 の手順 3
   でもう一度判断する。判断が `state.integration` の記録と違えば、どちらで続けるかを人に確認する。
   記録を変えるときは次を実行する。記録どおりなら何もしない。
   ```
   node <plugin-root>/scripts/codiel-state.mjs set-integration --slug <slug> --integration <github|local> --image-upload <値>
   ```
4. `state.domainMode` から実行モードを復元する。
   - 記録が `mapped` なのに §0 の `unreadable !== null` なら、分岐表の行 7 として止めて確認する。run 中のマップ消失を暗黙のモード変更にしない。
   - それ以外で記録があれば、その値を正として復元する。`unreadable` が `architecture_missing` または `block_missing` の場合は分岐表の行 4 として再確認しない。
   - 記録がなければモード未決として §0 の判定をやり直す。
5. `state.phase` から続行する前に、待ちを次の順に処理する。前のセッションの委譲は失われたものとして扱う。
   1. 最初に `codiel-state wait-clear --slug <slug>` を 1 回だけ呼び、出力の `cleared`(前のセッションで残った待ちの一覧)を控える。出し直した委譲の待ちを後から消さないよう、出し直しより先に呼ぶ。
   2. `cleared` の待ちごとに、`waits/<id>.md` が `startedAt` より後に書かれているかを確かめる。書かれていれば、返答を受け取り済みとして、既存の報告の置き場への転記を済ませる。書かれていなければ、委譲を出し直す(新しい回の `id` で `wait-add` する)。古い報告のファイルや成果が残っていても、`waits/<id>.md` が無い委譲の成果としては使わない。
   3. `cleared` に無くても、state の要素(`implement.steps`・`testCode.units`・`testLoop.units`)が `running` か `reviewing` のままで、その要素の `waits/*.md` が無いものは、起動から `wait-add` までの間に失われた委譲として出し直す。続投していた修正ラウンドも、新しい委譲に切り替える。
   4. worktree の中の委譲を出し直すときは、2.5 の規則どおり、残っている worktree とそのブランチを削除し、新しい HEAD で作り直す。
   5. 委譲を出し直す判断はこの手順に一本化する。フェーズごとの再開の分岐(test-spec など)は、この手順の後に、受け取り済みの返答でゲートへ進むかだけを決める。

   続けて、`state.phase` から続行する。すでに `passed` のフェーズはやり直さない。フェーズ進行表の定型に従い、
   `in_progress` のフェーズから再開する。中断していた委譲があれば、次の報告ファイルの末尾の
   `## 実行し直し` セクションの有無で、環境の失敗の実行し直しが済んだかを判断する(済んでいれば実行し
   直さない。2.6)。
   - `steps/` の下の、状態が `running` か `reviewing` の要素(state で終わっていない要素)の `report.md`。
   - implement では全グループの `steps/merge-test-<g>/report.md` と `steps/merge-fix-<g>/report.md`、
     test-loop では `steps/test-loop-project/report.md`。
   - test-loop では、最新の `test-run-<n>.md`。fix-loop では、最新の `test-run-<n+1>.md`。
   - intent-sync では `steps/intent-sync/report.md`。このファイルがあれば、取り込みと控えは済んでいる。
   discuss フェーズで中断していた場合の再開位置(アジェンダ作成
   から/未決論点から/最終確認から)は facilitating-design-discussions の「中断再開」に従う。design
   フェーズで design.md が既に存在する場合は、ウォークスルーの再提示から再開する。
6. `state.status` が `awaiting_human` なら、該当フェーズの `evaluationId` / `note` を手がかりに直近の findings を再提示し、raguel-gating の ASK ハンドリング(裁定 A / 裁定 B / 中止)に従って人間の裁定を待つ。**再開できると思って勝手に続行しない**。

## 7. 失敗の記録

次の 4 つの契機では、オーケストレーター本体が失敗を GOTCHAS に記録する。記録の判断・エントリの書式・採番・タグは
`metatron:recording-gotchas` スキルに従う。

| 契機 | 記録する時点 |
|---|---|
| 人が Raguel の `STOP` を妥当と裁定した | `raguel-gating` の STOP の手順で `stop --reason raguel-stop` を実行した直後 |
| test-loop / fix-loop の `record-attempt` が上限超過(exit 3)を返した | 人の裁定が中止に確定した時点 |
| `record_outcome(incident)` を記録した | incident を記録した直後 |
| レビューで、設計時に想定していなかった仕様漏れ・考慮漏れが見つかった | fix-loop を終えた時点 |

人が誤検知として続けると裁定したときは、台帳へは書かず、`## 未記録の GOTCHAS` の退避の形で「Raguel の
誤検知: <ruleId>」として 1 件書く。誤検知は対象プロジェクトの失敗ではなく、Raguel の作り直しの材料だか
らである。

記録の手段は、metatron の CLI の案内がコンテキストにあるかで分ける。

- 案内があるときは、`metatron:recording-gotchas` スキルを名指しで起動して記録させる。
- 案内が無いとき(metatron が無い、または未初期化)は台帳へ書かず、次の順で退避する。
  1. エントリを `## 未記録の GOTCHAS` の見出しの下に書く。書き先は run があれば
     `<runsDir>/<slug>/unrecorded-gotchas.md`、無ければ `.codiel/reports/unrecorded-gotchas.md` とする。
     `<runsDir>/<slug>/` の退避は try で分けずに追記し、既存のエントリを消さない。
  2. 同じエントリを完了報告にも載せる。
  3. 完了報告に台帳へ入れる手段を添える。metatron を導入していれば「次のセッションで注入される CLI の案内から
     `append-gotcha` で追記する」、導入していなければ「`/metatron:init` で台帳を作ってから追記する」と書く。
- 退避では記録の可否を判断せず、契機ごとに 1 件書く。可否は台帳へ入れるときに判断する。

退避するエントリは、`append-gotcha` の入力にそのまま使える次の 6 つの値だけを持つ。

| キー | 値 |
|---|---|
| `title` | 失敗のタイトル |
| `task` | 何をしようとしていたか |
| `mistake` | 具体的に何を間違えたか |
| `cause` | なぜそうなったか(推測) |
| `countermeasure` | 次のエージェントがそのまま実行できる行動 |
| `promotionCandidate` | `Yes` か `No` |

- 台帳を Edit / Write で直接編集しない。
- 記録の手段が無くても run は止めない。
- 台帳へ記録したときは台帳(§0 で解決した GOTCHAS のパス)を、run があって退避したときは退避先を、
  `codiel(gotchas): <一行要約> (<slug> try-<n>)` の形式でコミットする。run が無いときの退避先
  `.codiel/reports/unrecorded-gotchas.md` は `.gitignore` の下にあるので、コミットしない。run が無いときの
  台帳のコミットだけ `(<slug> try-<n>)` を省く。

<HARD-GATE>
- **オーケストレーターは、コード(テストコードを含む)・spec.md / cases.md・レビューの所見を自分で書かない**。
  実装・テストコードの作成・spec.md / cases.md の執筆・タスクレビュー・review は、すべてサブエージェントへの
  ディスパッチを経由する。委譲先の返答の本文を `waits/<id>.md` や `review-<m>.md` などの報告のファイルへ転記することは、
  所見を書くことに当たらない。
- オーケストレーターは、agenda.md・design.md・dev-plan.md・discussion.md・intent 文書(持続層を含む)を
  自分で書く。プロジェクトの test コマンドと、ID が `units/` で始まる仕様のディレクトリのテストも自分で
  実行する。ID が `e2e/` で始まる仕様のディレクトリの実行は委譲する。
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
| 「サブエージェントより自分でやった方が速い」 | 依頼文で範囲と tools を限定した委譲が「暴走できない」構造の前提。オーケストレーターが自分でコードを書けば hooks・Raguel の役割分離が意味を失う。 |
| 「テストは明らかに通るので test-loop 省略」 | 「明らか」という判断こそ偽装グリーンのリスク源。スクリプトを実際に実行して出力を見るまで合否は不明。 |
| 「state は手で直した方が早い」 | state.json への Edit/Write は hooks が deny する前提。手直しは「ゲート偽装」「フェーズ飛ばし」の温床であり、codiel-state の遷移検証を迂回する。 |
| 「ASK だが自明なので自分で判断して続行」 | raguel-gating が明確に禁止する自己承認そのもの。ASK は人間の裁定を要求する合図であり、AI の代理判断はその意味を無効化する。 |
