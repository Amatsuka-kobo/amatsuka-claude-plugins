---
name: orchestrating-runs
description: /codiel:run で intent 駆動の開発 run を進行するとき使用。フェーズ進行・サブエージェントディスパッチ・Raguel ゲート・再開のすべてはこのスキルに従う
---

# Codiel run オーケストレーション

## 概要

`/codiel:run [<Issue番号> | <intent パス> | 省略]` はメインセッション自身がオーケストレーターとなり、
intent を起点に
intent → discuss → design → test-spec/dev-plan → implement → test-loop → intent-sync → pr → review → fix-loop → triage → finalize
の全フェーズを進行させる。intent フェーズの聞き取りと合意形成は `capturing-intent` を通じてオーケストレーター
本体が担い、それ以外のフェーズの実作業(調査・設計・実装・テスト・レビュー)はすべて専用サブエージェントに
ディスパッチし、成果物は Raguel MCP のゲートを経てのみ次フェーズへ進む。オーケストレーター自身は
「進行管理」のみを行い、コードも文書もレビューも自分では書かない。

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
   | B | `CLAUDE.md` | ファイルが存在し、`## Codiel ハーネス運用ルール` 見出しを含む |
   | C | `raguel.config.yaml` | ファイルが存在し、YAML としてパースできる |
   | D | `.codiel/specs` / `.codiel/runs` / `.codiel/reports` | 3 ディレクトリが存在する |

5. 既存 run がある場合は `state.domainMode` の記録も分岐の入力にする。新規 run と `domainMode` のない既存
   run は記録なしとして扱う。
6. 次の分岐表を上から順に評価し、最初に当たった行を採る。

   | # | 条件 | 判断 |
   | --- | --- | --- |
   | 1 | Raguel MCP(`mcp__raguel__*`)が使えない | **止める。** ARCHITECTURE の欠落とは別の理由を示す |
   | 2 | B / C / D のいずれかが欠けている | **止める。** 欠けている項目を名指しし、`/codiel:init` を案内する。**ARCHITECTURE には言及しない** |
   | 3 | `unreadable === null`(マップが読める) | **`mapped` で開始する。** 担当は §4 のルーティングで必ず決まるため、ここでの追加確認は要らない |
   | 4 | `unreadable` が `architecture_missing` または `block_missing`、かつ state に `domainMode` の記録がある | 記録された値で開始する。再確認しない |
   | 5 | `unreadable` が `architecture_missing` または `block_missing`、かつ記録が無い | **ユーザーに「ドメイン別の境界を設けずに実行してよいか」を確認し、許可後に `unscoped` で開始する。** 恒久ファイルは生成しない。記録先は run state のみ |
   | 6 | `unreadable` が `invalid_json` / `invalid_shape` / `read_error` | **一旦止めて確認する。** 読めない理由と `warnings` の全文を提示し、(a) マップを修復して再実行する、(b) この run に限り境界なしで進むため `unscoped` へ切り替える、のどちらかをユーザーに選ばせる |
   | 7 | 記録が `mapped` なのに再開時に `unreadable !== null` | **止めて確認する。** run 中のマップ消失を暗黙のモード変更にしない |

   機械的に決まるのは行の選択だけである。ユーザー確認を伴うのは行 5 と行 6 だけとする。
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
  終端状態にする。今回再開する run かどうかの判定は `capturing-intent` の手順 0 に従う。
- run の解決自体は intent フェーズ(`capturing-intent` スキル)へつなぐ。Issue 番号・intent パス・省略の
  どの入口でも、既存 intent との重複確認、聞き取り、現状調査、分岐の合意、ドラフト提示、承認ゲート、
  `codiel-state init` による run 作成までを `capturing-intent` の手順に従って進める。
- intent パスの frontmatter `run` に対応する未終端の run があれば、`capturing-intent` の入口の分岐が
  それを検出し、`state.phase` から続けるべき既存 run として扱う。この場合は「6. 再開手順」に従う。
- `capturing-intent` の承認ゲートで「文書だけ残して終える(intent-only)」が選ばれたら、run は `close`
  で `completed` になり、以降のフェーズ進行表(discuss 以降)は実行しない。「続行する」が選ばれたら、
  intent フェーズが `passed` になった run ブランチから、フェーズ進行表の discuss 以降を続ける。

## 2. フェーズ進行表

各フェーズはチェックリスト 3 の定型で進行する。
ゲート種別と完了コマンドはフェーズ進行表の「ゲート種別」列に従う。`STAGES` は次の 12 ステージである。

```ts
[["intent"], ["discuss"], ["design"], ["test-spec", "dev-plan"], ["implement"],
 ["test-loop"], ["intent-sync"], ["pr"], ["review"], ["fix-loop"], ["triage"], ["finalize"]]
```

| フェーズ | 委譲の種別と作業内容 | 参照スキル | 入力ファイル | 出力ファイル | ゲート種別 | コミット担当 |
|---|---|---|---|---|---|---|
| [intent] | オーケストレーター本体が対話で聞き取り、ドラフトを書く。現状調査は読み取りだけの委譲 | capturing-intent | Issue 本文(任意。`gh issue view` または GitHub MCP)、既存 intent(任意)、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ)、持続層 | `docs/intents/YYYY-MM-DD-<slug>.md` | ユーザー承認の後に pass-gate(`evaluate_decision`) | オーケストレーター(intent-only では開始時のブランチへ、続行では run ブランチへ、ゲート通過直後) |
| [discuss] | 成果物を書く委譲(アジェンダ)+ 本体の進行。intent → `agenda.md` | preparing-design-agendas | intent、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | `agenda.md`、`discussion.md` | complete-phase(Raguel ゲートなし。人間が直接参加) | オーケストレーター(complete-phase 直前に agenda.md / discussion.md をまとめて) |
| [design] | 成果物を書く委譲。intent + `discussion.md` → `design.md` | writing-design-docs | intent、`discussion.md`、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ)、持続層 | `design.md` | pass-gate(`evaluate_design`)。**ゲートの前に `facilitating-design-discussions` の「設計ウォークスルー」を実施し、ユーザー承認を得てから evaluate する** | オーケストレーター(ゲート通過直後) |
| [test-spec] | 成果物を書く委譲。`design.md`(軽量では intent と持続層) → `spec.md` / `cases.md` | writing-test-specs | `design.md`(影響 unit 一覧。軽量では intent の `## 受け入れ基準` と `## 実装方針`) | `.codiel/specs/<unit-id>/spec.md` / `cases.md`(新規 or 更新) | pass-gate(`evaluate_plan`。dev-plan とは独立) | オーケストレーター(ゲート通過直後) |
| [dev-plan] | 成果物を書く委譲。`design.md`(軽量では intent と持続層) → `dev-plan.md` | writing-dev-plans | `design.md`(軽量では intent の `## 受け入れ基準` と `## 実装方針`) | `dev-plan.md`(ステップ毎にドメインタグ) | pass-gate(`evaluate_plan`。test-spec とは独立) | オーケストレーター(ゲート通過直後) |
| [implement] | 成果物を書く委譲。`dev-plan.md` の担当ステップ → コード diff + ユニットテスト | implementing + fixing-failures | `dev-plan.md`(該当ステップ)、ARCHITECTURE、GOTCHAS(§0 で解決したパス。無ければスキップ) | コード diff + ユニットテスト | pass-gate(`evaluate_code`) | コード系フェーズの委譲先(自分の変更を自分でコミット) |
| [test-loop A] | 成果物を書く委譲。`cases.md` → `scripts/` + `test-run-<n>.md` | scripting-tests + running-regression-tests | `.codiel/specs/<unit-id>/cases.md` | `.codiel/specs/<unit-id>/scripts/`、`reports/test-run-<n>.md` | pass-gate(`evaluate_code`。スクリプト diff) | コード系フェーズの委譲先(自分の変更を自分でコミット) |
| [test-loop B] | 成果物を書く委譲。NG ケースの再現手順・期待結果・実際の結果 → コード修正 diff | implementing + fixing-failures | NG ケース ID + 再現手順 + 期待結果 + 実際の結果 | コード修正 diff | pass-gate(`evaluate_code`) | コード系フェーズの委譲先(自分の変更を自分でコミット) |
| [intent-sync] | 成果物を書く委譲。承認済みの受け入れ基準変更と、intent-sync より前に追記された原文の要望 → 派生文のセクションと `## 変更履歴` への反映 | syncing-intents | intent、承認済みの受け入れ基準変更、追記された原文の要望、持続層 | intent の派生文のセクションと `## 変更履歴`、`docs/intents/domains/<領域>.md` | pass-gate(`evaluate_design`) | オーケストレーター(ゲート通過直後) |
| [pr] | オーケストレーター本体。— | — | `design.md`、`dev-plan.md`、`cases.md`、diff | github: PR / local: state の記録だけ(詳細は「2.2 pr の運転」) | complete-phase(github のときだけ `--pr-url` 必須) | ―(開始前に `git status --short` で未コミット差分がないことを確認) |
| [review] | 読み取りだけの委譲(観点ごと)。`git diff <base>...<branch>` + intent + `design.md` → 指定観点の所見一覧(テキスト) | reviewing-diffs | `git diff <base>...<branch>`、intent、`design.md`(軽量では intent と `dev-plan.md`)、`.codiel/specs/**`、持続層 | `reports/review-<n>.md` + PR コメント(github のみ) | complete-phase | オーケストレーター(review レポートのコミットも) |
| [fix-loop] | 成果物を書く委譲(修正・回帰)と読み取りだけの委譲(再レビュー)。レビュー所見 → コード修正 diff / `test-run-<n+1>.md` / `review-<n+1>.md` | fixing-review-findings + running-regression-tests + reviewing-diffs | `reports/review-<n>.md` の critical/high | コード修正 diff、`test-run-<n+1>.md`、`review-<n+1>.md` | pass-gate(`evaluate_code`。修正の度) | コード系フェーズの委譲先(自分の変更を自分でコミット)。`review-<n+1>.md` はオーケストレーター。**修正コミット完了後・再レビューの委譲前に、github モードではオーケストレーターが `git push` して PR ブランチを最新化する** |
| [triage] | オーケストレーター本体。`reports/review-<n>.md` の medium/low → github: 起票された Issue 番号 / local: `status: proposed` の intent 草案 | filing-followup-issues | `reports/review-<n>.md` の medium/low | github: 起票された Issue 番号(`review-<n>.md` と PR コメントに追記)/ local: `docs/intents/` の intent 草案 | complete-phase(Raguel ゲートなし) | オーケストレーター(`review-<n>.md` への追記分。コード変更はなし) |
| [finalize] | オーケストレーター本体。全フェーズの成果物、intent の原文のセクション → 結果レポート | ―(失敗の契機があれば「7. 失敗の記録」) | 全フェーズの成果物、intent の原文のセクション | 結果レポート(原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」を含む)、intent の `status` | `node <plugin-root>/scripts/codiel-state.mjs finalize --slug <slug>`(全フェーズ passed を検証し `status` を `awaiting_outcome` にする唯一のコマンド。`complete-phase` ではない。詳細は「2.3 finalize の運転」) | ―(intent の更新分はオーケストレーターがコミットし、github モードでは push する) |

- 軽量の経路(`scale: light`)では discuss と design を `skip-phase` で飛ばす。`SKIPPABLE` はこの 2 フェーズと
  fix-loop に限られ、discuss と design の `skip-phase` は `state.scale === "light"` のときだけ成功する。
  test-spec と dev-plan は `design.md` の代わりに intent の `## 受け入れ基準` と `## 実装方針`、関係する
  持続層を入力にする。review も同様に `design.md` の代わりに intent と `dev-plan.md` を設計の入力にする。
- test-spec と dev-plan は単一メッセージで 2 体並列ディスパッチする(Task ツールの呼び出しを 1 回の
  応答の中に 2 件含める)。片方が `ASK`/`STOP` でももう片方の結果には影響しない(raguel-gating 参照)。
- 実行モード(`mapped` / `unscoped`)に応じたドメインディスパッチは「4. ドメインディスパッチ」を参照。
- critical/high が review でゼロだった場合、fix-loop は実作業なしで
  `node <plugin-root>/scripts/codiel-state.mjs skip-phase fix-loop --slug <slug> --reason "<理由>"`
  でスキップする(詳細は「5. ループ運転」を参照)。

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
- **コード系フェーズ(implement / test-loop / fix-loop)**: コード系フェーズの委譲先は**自分の変更を自分で
  コミットする**。オーケストレーターはこれらのフェーズではコミットしない。
- **確認義務**: オーケストレーターは `pr` フェーズを開始する前に `git status --short` を実行し、
  未コミットの変更がないことを確認する。残っていれば `pr` を開始せず、該当フェーズのサブエージェントに
  「変更をコミットしてください」と差し戻す(未コミット差分を抱えたまま PR を作成しない)。

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
  `<!-- codiel:generated -->` などの codiel のマーカーは消さない。codiel が必ず書く項目(intent の
  パス、`Closes #N`、画像、`## 出典`)に当たる見出しが無ければ末尾に足す。同意・署名・人の確認を
  表すチェックボックス(行動規範への同意、CLA の署名、「テストした」など)は付けずに残し、人が
  確かめる項目であることを本文に書く。テンプレートが見つからなければ、`github-writing.md` の
  執筆規則だけに従って書く。
  本文は `github-writing.md` の執筆規則に従って書き、intent 文書のパスを含め、`state.issue` が
  あれば `Closes #N` を含める。`imageUpload` に使える手段があれば、test-loop で得たスクリーン
  ショットなど関連する画像を `github-writing.md` の縮退の順序で載せる。本文には
  `<!-- codiel:generated -->` を含める(投稿する本文すべてに共通する規律。§6.8)。
  組み立てた本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/pr-body.md` に書き、
  `review-<n>.md` と同じ書き方で run ブランチへコミットする(`git add <パス>` の後
  `git commit -m "codiel(pr): <要約> (<slug> try-<n>)"`)。コミット後、
  `git push -u origin <state.branch>` を実行してから、別の Bash 呼び出しで次を実行して PR を作る。
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

開始前に `git status --short` を実行し、未コミットの変更がないことを確認する(§2.1)。

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
4. intent を更新したら run ブランチへコミットする。github モードでは続けて `git push` し、PR に反映
   させる。local モードでは push しない。
5. 上記を終えてから次を呼ぶ(全フェーズ `passed` を検証し `status` を `awaiting_outcome` にする唯一の
   コマンド。`complete-phase` ではない)。
   ```
   node <plugin-root>/scripts/codiel-state.mjs finalize --slug <slug>
   ```
6. run 中に委譲先またはオーケストレーターが気づいた ARCHITECTURE と実装の乖離を一覧にする。
   metatron が導入されていれば `/metatron:update` へ引き渡す旨を結果レポートに書き、導入されていな
   ければ報告に残すだけにする。codiel は ARCHITECTURE を作らない。
7. 結果レポートを、原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」の表と、6. の乖離の一覧を
   含めて出力し、終了する。

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

## 3. ディスパッチプロンプトの規約

サブエージェントのディスパッチは **Task ツール**で行う。
委譲先は名指しせず、作業内容を渡して委譲する。作業内容による委譲の解決はセッションに注入された規律に従い、規律が無ければビルトインの委譲先へ送る。

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

## セッションの規律の転記
セッションの規律が依頼文への転記を求める条項があれば、ここに置く。
```

読み取りだけの委譲では、依頼文に次の 3 条項を追加する。
- 使用してよい tools を読み取り系に限定する。`Read` / `Grep` / `Glob` と読み取りに限った `Bash` だけを許可する。
- ファイルを変更しない。
- 報告のみを返す。

discuss / design / test-spec / dev-plan の依頼文には、git 操作をしない旨を追加する。

test-spec の依頼文には、次の 2 条項も追加する。
- 使用してよい tools を `Read` / `Grep` / `Glob` / `Write` / `Edit` と Context7 に限定する。`Bash` は使わない。
- 書き込み先を `.codiel/specs/<unit-id>/` の `spec.md` と `cases.md` に限る。

intent-sync 以外の委譲の依頼文には「intent 文書を書き換えない。原文の追加が必要ならオーケストレーターへ
報告する」の文を入れる。intent-sync の依頼文には、派生文のセクションだけを書き換え、原文のセクションを
書き換えないと明記する。

観点ファイルは次の規則で依頼文に足す。
- 実装の委譲(implement / test-loop B / fix-loop の修正)では、`mapped` のときに `<plugin-root>/skills/implementing/references/<担当タグ>.md` が存在すれば足す。存在しなければ足さない。`unscoped` では足さない。
- review / 再レビューでは、観点ごとに `<plugin-root>/skills/reviewing-diffs/references/<観点>.md` を必ず足す。
- 観点ファイルの存在はオーケストレーターが `Glob` または `ls` で確認する。委譲先に探させない。

ARCHITECTURE / GOTCHAS のパス、実行モード、ドメインマップは §0 で解決した値をそのまま埋める。サブエージェントに解決させない。

ディスパッチ後、オーケストレーターは成果物ファイルが実際に存在し空でないことを確認する。確認後に raguel-gating のゲート手順に進む。サブエージェントの報告だけで完了としない。

## 4. ドメインディスパッチ

委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。

- `mapped` の実装 / test-loop B / fix-loop の修正では、ステップのタグ `X` を依頼文にそのまま渡し、`set-domain` にも渡す。汎用の実装へ送るときも `X` を渡す。
- `set-domain` に渡す値はタグの値そのままとする。タグから別名を作らない。
- review / 再レビューでは `set-domain` を実行しない。
- `unscoped` では `set-domain` を呼ばない。ディスパッチ前に `clear-domain` を呼ぶ。

### 4.1 domain の設定と解除

実行モードが `mapped` のときだけ、ドメインに紐づく実装の委譲中に run の `domain` へ担当タグを持たせる。guard-write はこの値とドメインマップで境界を判定する。判定が働くのは implement / test-loop / fix-loop の 3 フェーズである。

```
node <plugin-root>/scripts/codiel-state.mjs set-domain --slug <slug> --domain <タグ>
node <plugin-root>/scripts/codiel-state.mjs clear-domain --slug <slug>
```

- `mapped` で実装 / test-loop の TDD 修正 / fix-loop の修正を委譲する直前に `set-domain` を実行する。
- `--domain` にはステップに付いたタグの値をそのまま渡す。汎用の実装へ送るときもタグの値を渡し、タグから別名を作らない。
- `set-domain` を実行した委譲先の報告を受け取った直後に `clear-domain` を実行する。解除しないと、次に `set-domain` するまで前の境界が効き続ける。
- `unscoped` では `set-domain` を呼ばない。各ディスパッチの前に `clear-domain` を実行し、`domain` を残さない。
- ドメインに紐づかない委譲へ移る前に、`domain` が残っている可能性があれば `clear-domain` を実行する。
- 実装の委譲は 1 体ずつ逐次ディスパッチする。未着手のステップが複数ドメインにまたがっていても、同じ応答で複数の実装を起動しない。
- 複数のドメイン別委譲を同じ応答でディスパッチするとき(レビューで複数の観点を同時に扱う場合など)は、先に `clear-domain` を実行し、`set-domain` は実行しない。state が持てる `domain` は 1 つだけである。この場合のドメイン規律はディスパッチプロンプトで運用する。

境界違反は `deny` ではなく `ask` で返る。止まったら、`set-domain` した値と `dev-plan.md` の該当ステップのドメインタグを照合する。値が誤っていれば正しい値で `set-domain` し直して続行する。値が正しければ越境であり、その書き込みを認めず、該当ドメインの実装の委譲をやり直す。

## 5. ループ運転(test-loop / fix-loop)

test-loop の内部運転(スクリプト安定化 → TDD 修正の二段構え)は `running-regression-tests` /
`fixing-failures` に、fix-loop の指摘対応は `fixing-review-findings` に定める。オーケストレーターの
役割は次の 2 点のみ:

1. 修正のためのサブエージェント・ディスパッチ 1 往復ごとに(= 1 attempt)
   `node <plugin-root>/scripts/codiel-state.mjs record-attempt <phase> --slug <slug>` を呼ぶ。
   **record-attempt を呼ぶのはオーケストレーターのみ**(tester / implementer は呼ばない。二重計上の防止)。
2. exit code が `3`(試行上限超過・`capExceeded`)なら、**raguel-gating の ASK と同じ扱い**にする
   (`awaiting_human` は `record-attempt` 内部で既にセットされている。findings 相当の情報を人間に
   提示し裁定を待つ。自分で「あと1回だけ」と続行してはならない)。

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
  implementer にディスパッチして修正させる。

## 6. 再開手順

1. run を特定する。`--slug <slug>` が分かっていればそれを使う。intent パスだけが分かっているときは、
   その frontmatter `run` の値を slug として使う(逆引き)。
   ```
   node <plugin-root>/scripts/codiel-state.mjs get --slug <slug>
   ```
   で `state.json` を取得する。
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
5. `state.phase` から続行する。すでに `passed` のフェーズはやり直さない。フェーズ進行表の定型に従い、
   `in_progress` のフェーズから再開する。discuss フェーズで中断していた場合の再開位置(アジェンダ作成
   から/未決論点から/最終確認から)は facilitating-design-discussions の「中断再開」に従う。design
   フェーズで design.md が既に存在する場合は、ウォークスルーの再提示から再開する。
6. `state.status` が `awaiting_human` なら、該当フェーズの `evaluationId` / `note` を手がかりに直近の findings を再提示し、raguel-gating の ASK ハンドリング(裁定 A / 裁定 B / 中止)に従って人間の裁定を待つ。**再開できると思って勝手に続行しない**。

## 7. 失敗の記録

次の 4 つの契機では、オーケストレーター本体が失敗を GOTCHAS に記録する。記録の判断・エントリの書式・採番・タグは
`metatron:recording-gotchas` スキルに従う。

| 契機 | 記録する時点 |
|---|---|
| Raguel が `STOP` を返した | `raguel-gating` の STOP の手順で run を止めた直後 |
| test-loop / fix-loop の `record-attempt` が上限超過(exit 3)を返した | 人の裁定が中止に確定した時点 |
| `record_outcome(incident)` を記録した | incident を記録した直後 |
| レビューで、設計時に想定していなかった仕様漏れ・考慮漏れが見つかった | fix-loop を終えた時点 |

記録の手段は、metatron の CLI の案内がコンテキストにあるかで分ける。

- 案内があるときは、`metatron:recording-gotchas` スキルを名指しで起動して記録させる。
- 案内が無いとき(metatron が無い、または未初期化)は台帳へ書かず、次の順で退避する。
  1. エントリを `## 未記録の GOTCHAS` の見出しの下に書く。書き先は run があれば
     `.codiel/runs/<slug>/try-<n>/reports/unrecorded-gotchas.md`、無ければ `.codiel/reports/unrecorded-gotchas.md` とする。
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
- 台帳へ記録したときは台帳(§0 で解決した GOTCHAS のパス)を、退避したときは退避先のレポートを、`codiel(gotchas): <一行要約> (<slug> try-<n>)`
  の形式でコミットする。run が無いときだけ `(<slug> try-<n>)` を省く。

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
| 「サブエージェントより自分でやった方が速い」 | 依頼文で範囲と tools を限定した委譲が「暴走できない」構造の前提。オーケストレーターが自分でコードを書けば hooks・Raguel の役割分離が意味を失う。 |
| 「テストは明らかに通るので test-loop 省略」 | 「明らか」という判断こそ偽装グリーンのリスク源。スクリプトを実際に実行して出力を見るまで合否は不明。 |
| 「state は手で直した方が早い」 | state.json への Edit/Write は hooks が deny する前提。手直しは「ゲート偽装」「フェーズ飛ばし」の温床であり、codiel-state の遷移検証を迂回する。 |
| 「ASK だが自明なので自分で判断して続行」 | raguel-gating が明確に禁止する自己承認そのもの。ASK は人間の裁定を要求する合図であり、AI の代理判断はその意味を無効化する。 |
