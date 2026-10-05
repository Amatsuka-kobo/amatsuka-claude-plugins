---
name: orchestrating-runs
description: Codiel の run で、メインセッション自身がオーケストレーターとして Issue 番号・intent 文書のパス・省略のいずれかから intent フェーズから finalize フェーズまでの全フェーズを進行させ、サブエージェントへのディスパッチと Raguel ゲートの運転を担うときに使う。/codiel:run が名指しで起動する。
---

# Codiel run オーケストレーション

## 概要

`/codiel:run [<Issue番号> | <intent パス> | 省略]` はメインセッション自身がオーケストレーターとなり、
intent を起点に
intent → carry-over → discuss → design → test-spec/dev-plan → test-code → implement → test-loop → intent-sync → pr → review → fix-loop → triage → finalize
の全フェーズを進行させる。intent フェーズの聞き取りと合意形成は `capturing-intent` を通じてオーケストレーター
本体が担う。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/orchestrating-runs`
である。`<plugin-root>` はそのベースディレクトリの 2 階層上である。`codiel-state` は対象プロジェクトの
ルートで次の形で呼ぶ。

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

このスキルの `references/<file>.md` は、ベースディレクトリからの相対パスである。

## チェックリスト

- [ ] 0. 前提確認・実行モード・連携モードの決定を行う(§0)。停止条件に当たればここで終了する
- [ ] 1. outcome の自動同期を行う(`<plugin-root>/skills/raguel-gating/references/outcome-sync.md` に従う。起動時に 1 回だけ)
- [ ] 2. run を解決する。`codiel-state get --active` でほかの run が active でないことを確かめ、
      intent フェーズ(`capturing-intent` スキル)へつないで run を開始または再開する(§1)
- [ ] 3. 現在のフェーズから、フェーズ進行表の定型(start-phase → 手順ファイルを読む → ディスパッチ → 成果物の検証 →
      raguel-gating でゲート → pass-gate/complete-phase)を順に実行する。ドメイン別のディスパッチは
      §4 の set-domain / clear-domain を伴う。discuss は raguel-gating を経ず、facilitating-design-discussions
      に従って進行し、complete-phase で完了する
- [ ] 4. ASK / STOP が返ったフェーズは `raguel-gating` の手順に従い、人の裁定を受けてから続ける
- [ ] 5. 全フェーズが `passed` になったら、`references/phase-finalize.md` の手順で結果レポートと intent の
      `status` を確定してから `codiel-state finalize --slug <slug>` を呼び、結果レポートを出力して終了する

## 0. 前提確認と実行モードの決定

run を開始する前に、初期化の外形とドメインマップの状態から実行モードを決め、連携モードと画像添付・ADR の
書き先を判定する。ドメインマップの不在それ自体は初期化の欠落に当たらない。

手順 1・2 の 4 つのコマンドは run ごとに 1 回だけ実行し、以降は得た値を各所へ渡す。サブエージェントには
解決させない。`<plugin-root>` は絶対パスに展開して実行する。

1. 対象プロジェクトのルートで次を実行し、ARCHITECTURE のパスとドメインマップの状態を解決する。

   ```
   node -e 'import("<plugin-root>/scripts/lib.mjs").then(({ resolveDocPaths, readDomainsResult }) => {
     const p = resolveDocPaths(process.cwd());
     const d = readDomainsResult(process.cwd());
     console.log(JSON.stringify({ architecture: p.architecture, domains: d.domains, unreadable: d.unreadable, warnings: [...p.warnings, ...d.warnings] }));
   })'
   ```

2. 続けて次の 3 つを実行する。
   - `check-intent-env.mjs`: 連携モードと `imageUpload`・`knowledgeTarget` の判定材料を得る。
   - `codiel-state.mjs config`: テストの仕様の置き場(testsDir)と run の文書の置き場(runsDir)を得る。
   - `codiel-state.mjs gitignore`: `.gitignore` に足りない行(出力の `missing`)を得る。判定 D に使う。

   ```
   node <plugin-root>/scripts/check-intent-env.mjs
   node <plugin-root>/scripts/codiel-state.mjs config
   node <plugin-root>/scripts/codiel-state.mjs gitignore
   ```

   手順 1・2 のコマンドのどれかが非ゼロで終わったとき、または出力が JSON として読めないときは、続行せず、標準エラー出力を示して止める。プラグインの再インストールか再ビルドを案内し、run は作らない。
   ただし `config` と `gitignore` の失敗(`.codiel/config.json` が不正なときは、標準エラー出力に理由を出して終了コード 1 になる)は、C・D を揃っていないものとして扱う。手順 6 の表の行 2 で止めるときに、
   標準エラー出力の理由を添え、`.codiel/config.json` を直すか `/codiel:init` をやり直すよう案内する。

3. 手順 2 の出力にある事実(`repoSlug`・`ghAuthenticated`・`ghAttachSupported`・`projectDocs.architecture`
   など)から、次のとおり判断する。判断はここで行い、check-intent-env は事実だけを返す。

   | 項目 | 判断 |
   | --- | --- |
   | 連携モード | `repoSlug` が null でなく、かつ `ghAuthenticated` が true なら `github`。それ以外は `local`(GHES を含む) |
   | `imageUpload.ghAttach` | 連携モードが `local` なら `false`。`github` では `ghAttachSupported` が true のとき `true` |
   | `imageUpload.chrome` | 連携モードが `local` なら `false`。`github` ではセッションで `mcp__claude-in-chrome__*` のツールが使えるとき `true` |
   | `knowledgeTarget` | `projectDocs.architecture` が null でなく、かつ `projectDocs.metatronRules` が true なら `metatron`、それ以外は `intents` |

   これらの値と手順 6 で決めた実行モードは run の開始時に決めて固定し、intent フェーズ(`capturing-intent`)が
   `codiel-state init` へ渡す `--integration` / `--image-upload` / `--knowledge-target` / `--domain-mode` の値になる。
   再開時の再判定は `references/resume.md` に従う。
4. 初期化の外形は B + C + D の 3 点で確認する。

   | 記号 | 確認対象 | 「揃っている」の判定 |
   | --- | --- | --- |
   | B | `.claude/rules/codiel.md` / `CLAUDE.md` | `.claude/rules/codiel.md` が存在し、かつ `CLAUDE.md` に、行全体が(前後の空白を除き)`## Codiel` と一致する行がある |
   | C | `.codiel/config.json` | JSON のオブジェクトとして読め、`raguel` がオブジェクトである(空のオブジェクトでよい) |
   | D | `.codiel/runs` / `.codiel/reports` / `.gitignore` | 2 ディレクトリが存在し、`codiel-state gitignore` の `missing` が空である |

5. 既存 run の `state.domainMode` の記録も分岐の入力にする。最初の §0 では run がまだ特定されていないので、
   記録なしとして扱う。§1 で既存の run に当たったら、`references/resume.md` の手順 4 で §0 の分岐をやり直し、
   その run の記録を入力にする。新規 run と `domainMode` のない既存 run は記録なしとして扱う。
6. 次の分岐表を上から順に評価し、最初に当たった行を採る。

   | # | 条件 | 判断 |
   | --- | --- | --- |
   | 1 | Raguel MCP(`mcp__plugin_codiel_raguel__*`)が使えない | 止める |
   | 2 | B / C / D のいずれかが欠けている | 止める。欠けている項目を名指しし(C は config.json の `raguel`、D は足りない `.gitignore` の行)、`/codiel:init` を案内する |
   | 3 | 記録が `mapped` なのに再開時に `unreadable !== null` | 止めて確認する。run 中のマップ消失を暗黙のモード変更にしない |
   | 4 | state に `domainMode` の記録がある(行 3 に当たらない) | 記録された値で開始(再開なら続行)する。記録が `unscoped` なら、マップが読めても `unscoped` のままにする。再確認しない |
   | 5 | `unreadable === null`(マップが読める) | `mapped` で開始する。担当は §4 のルーティングで決まるので、ここで追加の確認はしない |
   | 6 | `unreadable` が `architecture_missing` または `block_missing` | ユーザーに「ドメイン別の境界を設けずに実行してよいか」を確認し、許可されたら `unscoped` で開始(再開なら続行)する。恒久ファイルは生成しない。記録先は run の state だけである。許可されなかったときは表の下の段落に従う |
   | 7 | `unreadable` が `invalid_json` / `invalid_shape` / `read_error` | 一旦止めて確認する。読めない理由と `warnings` の全文を提示し、(a) マップを修復して再実行する、(b) この run に限り境界なしで進むため `unscoped` へ切り替える、のどちらかをユーザーに選ばせる。(b) を選んだ事実は完了報告に残す |

   記録がある run は行 3 か行 4 で決まり、行 5〜7 には記録の無い run だけが届く。

   行 6 で許可されなかったときは、`architecture_missing` か `block_missing` のどちらかを示し、ARCHITECTURE に
   ドメインマップを用意してから `/codiel:run` をやり直すよう案内して終了する。
   - 新規 run: run を開始しない。run が無いので、state の後始末は要らない。
   - 既存 run の再開(`domainMode` の記録が無い run): run を `stop` せず、状態をそのまま残して終了し、残したことを伝える。

   機械的に決まるのは行の選択だけである。ユーザー確認を伴うのは行 3・行 6・行 7 だけとする。行 2 で止めるとき、
   リポジトリに `raguel.config.yaml` があれば、中身を config.json の `raguel` へ移すために `/codiel:init` を
   実行するよう添える。
7. 出力の `warnings` が空でなければ、その全文をユーザーへ提示してから次へ進む。手順 2 の出力の
   `configWarnings` が空でないときも同様に提示する。警告だけを理由に run を止めない。

## 1. run の解決

- 同時にアクティブにできる run は 1 つだけである(hooks の `findActiveRun` は単一 run の存在を前提に
  動作する)。既存の `active`/`awaiting_human` の run のうち、今回再開しないものだけを
  `finalize`(全フェーズ完了時)または `codiel-state stop --slug <slug> --reason <理由>`(中止時)で
  終端状態にする。`waits` が残っている run を止めるときは、2.4 の手順で先に待ちを片付ける。今回再開する
  run かどうかの判定は `capturing-intent` の手順 0 に従う。
- run の解決自体は intent フェーズ(`capturing-intent` スキル)へつなぐ。Issue 番号・intent パス・省略の
  どの入口でも、既存 intent との重複確認、聞き取り、現状調査、分岐の合意、ドラフト提示、承認ゲート、
  `codiel-state init` による run 作成までを `capturing-intent` の手順に従って進める。
- 入口の intent パスに当たる未終端の run は、`capturing-intent` の入口の分岐が検出する。当たるのは、intent の
  frontmatter `run` に対応する run と、state の `intent` が入口の intent パスと同じ run である。検出した run は、
  `state.phase` から続ける既存 run として扱う。この場合は `references/resume.md` に従う。frontmatter の `run` で当たった run は
  確かめずに再開し、state の `intent` だけで当たった run(frontmatter の `run` で確かめられない run)は、
  続ける前に slug・intent のパス・現在のフェーズを示してユーザーに確かめる。
- 前の try が `stopped` で、`stopReason` が `raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` の
  フェーズを持つときは、`capturing-intent` の手順 1 の承認を経てから新しい try を作る
  (`init --human-approved`)。引き継いだコード(STOP を受けたファイルを含む)は carry-over のゲートで評価する。
  文書は各フェーズで書き直して評価する。
- `capturing-intent` の承認ゲートで「文書だけ残して終える(intent-only)」が選ばれたら、run は `close`
  で `completed` になり、以降のフェーズ進行表(carry-over 以降)は実行しない。「続行する」が選ばれたら、
  intent フェーズが `passed` になった run ブランチから、フェーズ進行表の carry-over 以降を続ける。

## 2. フェーズ進行表

各フェーズはチェックリスト 3 の定型で進行する。
ゲート種別と完了コマンドはフェーズ進行表の「ゲート種別」列に従う。`STAGES` は次の 14 ステージである。

```ts
[["intent"], ["carry-over"], ["discuss"], ["design"], ["test-spec", "dev-plan"], ["test-code"], ["implement"],
 ["test-loop"], ["intent-sync"], ["pr"], ["review"], ["fix-loop"], ["triage"], ["finalize"]]
```

表の `<n>` は try と test-loop の回の番号、`<m>` はレビューの回の番号(review フェーズが 1、fix-loop の再レビューごとに 1 つ増える)である。コミットは 2.1 に従う。

| フェーズ | 委譲の種別と作業内容 | 参照スキル | 入力ファイル | 出力ファイル | ゲート種別 |
|---|---|---|---|---|---|
| [intent] | オーケストレーター本体が対話で聞き取り、ドラフトを書く。現状調査は読み取りだけの委譲 | capturing-intent | Issue 本文(任意。`gh issue view` または GitHub MCP)、既存 intent(任意)、持続層 | `docs/intents/YYYY-MM-DD-<slug>.md` | ユーザー承認の後に pass-gate(`evaluate_decision`) |
| [carry-over] | 前の try から run ブランチに残るコードを、分岐点からの差分としてゲートで評価する。所見の修正は実装の委譲に出す。try-1 は `init` が `SKIPPED` にするので進めない | implementing(修正モード) | run ブランチの分岐点からの差分(`startHead` が分岐点) | 所見の修正 diff(所見があるときだけ) | pass-gate(`evaluate_code`) |
| [discuss] | オーケストレーター本体がアジェンダを書き、進行する。intent → `agenda.md` | preparing-design-agendas | intent | `agenda.md`、`discussion.md` | complete-phase(Raguel ゲートなし。人間が直接参加) |
| [design] | オーケストレーター本体が書く。intent + `discussion.md` → `design.md` | writing-design-docs | intent、`discussion.md`、持続層 | `design.md`(`## 影響を受ける機能単位` に仕様のディレクトリの ID。新しい画面は名前の候補) | pass-gate(`evaluate_design`)。ゲートの前に `facilitating-design-discussions` の「設計ウォークスルー」を行い、新しい画面の名前を聞いてから evaluate する |
| [test-spec] | オーケストレーター本体が仕様のディレクトリを同定し(ファイルは書かない)、成果物を書く委譲を出して待ちを記録し、その間に dev-plan を書いてゲートする。`design.md`(軽量では intent と持続層、同定した一覧) → `spec.md` / `cases.md` | writing-test-specs | `design.md`(`## 影響を受ける機能単位`。軽量では intent の `## 受け入れ基準` と `## 実装方針`、名前の候補を含む一覧) | `<testsDir>/<仕様のディレクトリ>/spec.md` / `cases.md`(新規 or 更新) | pass-gate(`evaluate_plan`。dev-plan とは独立) |
| [dev-plan] | オーケストレーター本体が書く。`design.md`(軽量では intent と持続層、test-spec と同じ一覧) → `dev-plan.md` | writing-dev-plans | `design.md`(軽量では intent の `## 受け入れ基準` と `## 実装方針`、test-spec と同じ一覧) | `dev-plan.md`(ステップ毎にドメインタグ・触るファイル・前提ステップ・通すテスト、`## 環境準備`・`## 生成物`) | pass-gate(`evaluate_plan`。test-spec とは独立。`codiel-state waves` の成功を確かめた後) |
| [test-code] | 成果物を書く委譲を仕様のディレクトリごとに worktree で並列に出す。`spec.md` / `cases.md` → テストコード | scripting-tests | `spec.md` / `cases.md`、`design.md`(軽量では intent)、`dev-plan.md` | テストコード(ユニットと E2E)、`spec.md` の `tests`、`report.md`(委譲先の返答からオーケストレーターが書く) | 全ディレクトリのマージ後に pass-gate(`evaluate_code`)を 1 回 |
| [implement] | 成果物を書く委譲を `codiel-state waves` の順で worktree に並列に出す。グループのマージの後に、そのグループの通すテストのうちプロジェクトの test コマンドと `units/` のテストをオーケストレーターが実行し、`e2e/` のテストは実行の委譲を出す | implementing + fixing-failures | `dev-plan.md`(該当ステップ)、test-code のテスト(ユニットと E2E) | テストを通すコード diff | 全 wave の後に pass-gate(`evaluate_code`)を 1 回 |
| [test-loop] | 回帰の実行(プロジェクトの test コマンドと `units/` のテストはオーケストレーター本体、`e2e/` は委譲)と、NG の修正の委譲(仕様のディレクトリごとに worktree で並列) | running-regression-tests + fixing-failures | 全 `spec.md` の `tests`、プロジェクトの test コマンド | `test-run-<n>.md`(自分の実行結果と `e2e/` の委譲の返答を合わせてオーケストレーターが書く)、修正 diff | pass-gate(`evaluate_code`) |
| [intent-sync] | オーケストレーター本体が書く。承認済みの受け入れ基準変更と、intent-sync より前に追記された原文の要望 → 派生文のセクションと `## 変更履歴` への反映、関係する領域の持続層への取り込み | syncing-intents | intent、承認済みの受け入れ基準変更、追記された原文の要望、持続層 | intent の派生文のセクションと `## 変更履歴`、`docs/intents/domains/<領域>.md` | pass-gate(`evaluate_design`) |
| [pr] | オーケストレーター本体が、github では PR を作り、local では state に記録する | なし | `design.md`、`dev-plan.md`、`cases.md`、diff | github: PR / local: state の記録だけ | complete-phase(github のときだけ `--pr-url` 必須) |
| [review] | 読み取りだけの委譲(観点ごと)。依頼文の前提「diff の範囲」の `git diff <範囲>` + intent + `design.md` → 指定観点の所見一覧(テキスト) | reviewing-diffs | `git diff <範囲>`(依頼文の前提「diff の範囲」の値)、intent、`design.md`(軽量では intent と `dev-plan.md`)、`<testsDir>/**` と記録されたテスト、持続層、ARCHITECTURE(§0 で解決したパス。無ければ「なし」) | `reports/review-<m>.md`(全観点の待ちが消えてから書く。§3)+ PR コメント(github のみ) | complete-phase |
| [fix-loop] | 成果物を書く委譲(修正)、回帰の実行(プロジェクトの test コマンドと `units/` のテストはオーケストレーター本体、`e2e/` は委譲)、読み取りだけの委譲(再レビュー)。レビュー所見 → コード修正 diff / `test-run-<n+1>.md` / `review-<m+1>.md` | fixing-review-findings + running-regression-tests + reviewing-diffs | `reports/review-<m>.md` の critical/high、再レビューの diff の範囲(依頼文の前提「diff の範囲」の値)、ARCHITECTURE(再レビューの委譲のとき。§0 で解決したパス。無ければ「なし」) | コード修正 diff、`test-run-<n+1>.md`、`review-<m+1>.md` | pass-gate(`evaluate_code`。回数と通過の時点は `references/phase-fix-loop.md`) |
| [triage] | オーケストレーター本体。`reports/review-<m>.md` の medium/low → github: 起票された Issue 番号 / local: `status: proposed` の intent 草案 | filing-followup-issues | `reports/review-<m>.md` の medium/low | github: 起票された Issue 番号(`review-<m>.md` と PR コメントに追記)/ local: `docs/intents/` の intent 草案 | complete-phase(Raguel ゲートなし) |
| [finalize] | オーケストレーター本体。全フェーズの成果物、intent の原文のセクション → 結果レポート | なし | 全フェーズの成果物、intent の原文のセクション | 結果レポート(原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」を含む)、intent の `status` | `node <plugin-root>/scripts/codiel-state.mjs finalize --slug <slug>`(`complete-phase` ではない) |

- 軽量の経路(`scale: light`)では discuss と design を `skip-phase` で飛ばす。`SKIPPABLE` はこの 2 フェーズと
  fix-loop に限られ、discuss と design の `skip-phase` は `state.scale === "light"` のときだけ成功する。
  ほかのフェーズは、規模によらず定型どおりに進める。
- review の所見に critical/high が 1 件も無ければ、fix-loop を `start-phase` せず、次のコマンドでスキップする。
  critical/high が 1 件でもあれば、このコマンドを使わず、fix-loop で修正を委譲する。
  ```
  node <plugin-root>/scripts/codiel-state.mjs skip-phase fix-loop --slug <slug> --reason "review で critical/high 0 件"
  ```
- ゲートで evaluate ツールへ渡すもの(`phase`・`paths`・`baseRef` など)は、`raguel-gating` のフェーズ→ツール
  対応表だけが定める。このスキルは渡すものを書かず、各フェーズのゲートの手順から対応表の行を引く。
- ゲートを持つフェーズは、`evaluate_*` の verdict を得てから進める。`pass-gate` の `--evaluation-id` には、
  そのフェーズで `evaluate_*` が返した `evaluationId` を渡す。
- フェーズの遷移と state の変更は `codiel-state` のコマンドで行う。`.codiel/runs/**/state.json` は Edit / Write
  で書き換えない。
- carry-over・test-code・implement・test-loop・fix-loop の `start-phase` は、そのフェーズの開始の HEAD を state の
  `phases.<phase>.startHead` に記録する。carry-over の記録は、ベースブランチとの分岐点(`git merge-base`)である。`baseRef` の値はこの記録であり、オーケストレーターが自分で決めない。

### 手順ファイルと読む時点

フェーズに入った後にだけ要る手順は、このスキルの `references/` の手順ファイルにある。次の表の「読む時点」に、
そのファイルを Read して従う。intent・discuss・design・triage は手順ファイルを持たず、フェーズ進行表の参照スキルに従う。

| 手順ファイル | 読む時点 |
| --- | --- |
| `references/phase-carry-over.md` | `start-phase carry-over` の直後 |
| `references/phase-test-spec.md` | `start-phase test-spec` の直後。dev-plan もこの手順で進める |
| `references/phase-test-code.md` | `start-phase test-code` の直後 |
| `references/phase-implement.md` | `start-phase implement` の直後 |
| `references/phase-test-loop.md` | `start-phase test-loop` の直後 |
| `references/phase-intent-sync.md` | `start-phase intent-sync` の直後 |
| `references/phase-pr.md` | `start-phase pr` の直後 |
| `references/phase-review.md` | `start-phase review` の直後 |
| `references/phase-fix-loop.md` | `start-phase fix-loop` の直後 |
| `references/phase-finalize.md` | triage を終えて、finalize の作業を始める前 |
| `references/delegation-env.md` | test-code・implement・test-loop・fix-loop に入ったとき。carry-over で修正の委譲を出す前 |
| `references/review-common.md` | review に入ったとき。fix-loop で再レビューの委譲を出す前 |
| `references/e2e.md` | E2E を実行する委譲を出す前 |
| `references/gotcha-candidates.md` | GOTCHAS 候補を書くとき(STOP を妥当と裁定した・上限超過の後の中止(raguel-gating・implement・test-code)・incident・fix-loop で見つかった設計の漏れ)の手順に入る前。`intents` の run の intent-sync と finalize で候補を写す前 |
| `references/adr-candidates.md` | intent-sync で取り込み先の分岐を決める前。fix-loop で設計を変える修正を採ったときの fix-loop の pass-gate の前。finalize で候補を写す前と、結果レポートに一覧する前 |
| `references/resume.md` | run を再開するとき |

手順ファイルは次の 4 つの時点で読む。

1. フェーズの作業を始める前。`start-phase` を呼ぶフェーズでは、その直後に読む。finalize は `start-phase` を
   呼ばないので、triage を終えた時点で読む。
2. 共有の手順(`delegation-env.md`・`review-common.md`・`e2e.md`・`gotcha-candidates.md`・`adr-candidates.md`)を使う手順に入る前。読む時点は
   上の表に従う。fix-loop の再レビューでは、委譲を出す前に `review-common.md` を読む。
3. run を再開するとき。`resume.md` を読み、待ちの処理や委譲の出し直しより前に、続行する run の slug で
   `codiel-state get --slug <slug>` を呼んで state を読む。`status` が `in_progress` か `awaiting_human` の
   フェーズすべての手順ファイルと、それらが使う共有の手順を読む。carry-over が該当するときは `phase-carry-over.md` を読む。test-spec と dev-plan はどちらが該当しても
   `phase-test-spec.md` を読む。triage が `passed` で finalize がまだ完了していない run では、`phase-finalize.md` も読む。
4. compaction が起きたとき。会話の先頭が前の会話の要約で始まっていれば、compaction が起きている。次の順で読み直す。
   1. このスキルの本文を Read し直す。
   2. 続行中の run の slug を要約から取り、`codiel-state get --slug <slug>` で state を読む。要約に slug が
      無ければ `codiel-state get --active` を呼び、結果のうち `status` が `active` か `awaiting_human` の run を使う。`get --active`
      は `awaiting_outcome` の run も返すので、`status` で絞る。該当が 0 件か 2 件以上なら、人に確かめる。
   3. 時点 3 と同じ範囲の手順ファイルを読む。
   4. ほかのスキルは、そのスキルを使う手順に入ったときに読む。

委譲の待ちが無いフェーズの境目では、ユーザーは新しいセッションへ移ってよい。待ちが無いことは、state の
`waits` が空であることで確かめる。移った先では `/codiel:run` で再開し、`references/resume.md` に従う。

### 2.1 成果物コミット規約

- 文書系フェーズ(intent / discuss / design / test-spec / dev-plan / intent-sync)の成果物(intent 文書 /
  `agenda.md`・`discussion.md` / `design.md` / `spec.md`・`cases.md` / `dev-plan.md` / intent の派生文の
  セクションと `## 変更履歴`)は、ゲート通過の直後にオーケストレーターが次の形でコミットする。文書系フェーズの
  委譲先は git 操作をしない。
  ```
  git add <成果物パス>
  git commit -m "codiel(<phase>): <要約> (<slug> try-<n>)"
  ```
  - discuss は Raguel ゲートを持たないので、complete-phase の直前にコミットする(facilitating-design-discussions
    のチェックリスト 8)。
  - intent フェーズのコミットは §1 と `capturing-intent` の手順に従う。
  - コミットするのは、そのゲートで評価した文書(`paths` に渡したファイル)だけにする。ほかのファイルを同じ
    コミットや、次のコード系フェーズの `start-phase` より前のコミットに入れると、`start-phase` がそのパスを
    挙げて失敗する。test-spec と dev-plan は、それぞれの通過の直後に、評価した文書をコミットしてよい。
- コード系フェーズ(carry-over / test-code / implement / test-loop / fix-loop)では、委譲先が自分の変更を自分でコミットする。
  オーケストレーターがこれらのフェーズで行うコミットは、worktree のブランチの `git merge --no-ff` と、E2E の
  レポートのコミット(`references/e2e.md`)だけである。コード系フェーズの pass-gate の後は、次のフェーズの
  `start-phase` までコミットしない(`start-phase` が、直前に通ったフェーズの `passedHead` と今の HEAD の一致を要る)。
- run の文書の置き場: オーケストレーターが書く `agenda.md`・`discussion.md`・`design.md`・
  `dev-plan.md` は `<repoRoot>/<runsDir>/<slug>/` に置き、try で分けない。依頼文の出力先には
  `<repoRoot>/<runsDir>/<slug>/<ファイル名>` の絶対パスを書き、後のフェーズの入力にも同じパスを渡す。
  新しい try は同じパスに書き直し、前の try の文書は
  同じブランチの履歴(`git log -p -- <runsDir>/<slug>/<ファイル名>`)で読む。
- `.codiel/runs/` の下のファイルはコミットしない。`state.json`・`steps/`・`reports/` は `.gitignore` で
  git から外れている。`pr-body.md` や `review-body-<m>.md` などの本文ファイルは Write ツールで `reports/` に
  書き、コミットせずに投稿する。
- 報告のファイル(`report.md`・`test-run-<n>.md` など)は、委譲先の返答と自分の実行結果からオーケストレーターが
  §3 の手順で書く。置き場は `references/delegation-env.md` の表に従う。
- 確認義務: `pr` フェーズを開始する前に `git status --short` を実行し、残ったファイルを次のとおり分ける。
  - run の成果物(委譲先の変更、run の文書、intent、E2E のレポートの `results.json` と md)が残っていれば、
    `pr` を開始しない。E2E のレポートはオーケストレーターがコミットし、ほかは担当のサブエージェントに
    「変更をコミットしてください」と差し戻す。
  - それ以外は run の外のファイルとして扱う。`/codiel:init` の成果物(`.codiel/config.json`・`.gitignore`・
    `.claude/rules/codiel.md`・`CLAUDE.md`)、利用者のファイル、run に関係の無い記録が当たり、判定が付か
    ないものも含める。run の外のファイルはコミットも退避もしない。`start-phase pr` の後に
    `mark-ask pr --slug <slug> --kind confirm` で待ち、一覧を示して AskUserQuestion で「残したまま pr を
    続ける(PR には入らない)」か「ユーザーが自分で扱ってから続ける」かを聞く。答えを得たら `resume` する。

### 2.4 共通

- フェーズの途中で人に確認するときは、`mark-ask`(`--kind confirm` を付ける)で `awaiting_human` にしてから
  確認し、答えを得たら `resume` で戻す。`evaluationId` は無くてよい。
  ```
  node <plugin-root>/scripts/codiel-state.mjs mark-ask <phase> --slug <slug> --kind confirm
  node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>
  ```
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
- 追記が intent-sync より後で、この run に含めないと決めたときは、run を止めず現在のフェーズを続ける。該当の原文の記録の直後に、`<plugin-root>/references/intent-format.md` の持ち越しの注記を足す。finalize が結果レポートに「持ち越し」として載せる(`references/phase-finalize.md` の手順 1)。含めるかを人に確かめるときは、この §2.4 冒頭の `mark-ask --kind confirm` の後に確かめ、答えを得たら `resume` する。
- run を止めるとき(人が中止を選んだとき、`intent-updated` で止めるとき、別の try を始めるとき、ゲートの裁定で止めるときなど、`stop` を呼ぶすべてのとき)は、`stop` の前に、
  `codiel-state get` の `waits` に残っている委譲を、出どころで分けて片付ける。
  - 今のセッションで出した委譲: `taskId` があれば `TaskStop` で止め、待ちを消す(返答が無いので `wait-done` は使えない)。待ちが 1 件だけなら `wait-clear` で消す。ほかの待ちが残るなら、止めた委譲の旨を `waits/<id>.md` に書いて `wait-done --id <id>` で 1 件ずつ消し、`wait-clear` は使わない。`taskId` が無ければ完了通知を待ち、返答を書いて `wait-done` する。
  - 前のセッションから残った待ち: 通知は来ないので待たず、`wait-clear` で消す。
  `stop` は待ちが残っていると失敗する。`--abandon-waits` は、今のセッションの委譲を止めず完了も待たずに止めると人が決めたときだけ付ける。
  E2E のレポートが残っていれば、`stop` の前に `references/e2e.md` のコミットの手順に従う。
  `waits` が空になってから、残っている worktree とブランチをすべて削除する。委譲が止まる前に、書き込み中の worktree を消さないためである。
  止めた理由によらず、完了報告には、同じ slug のすべての try の `reports/adr-candidates.md` と `reports/gotcha-candidates.md` のエントリのうち `写し先` の行が無いものを、タイトルと手元の記録のパスで一覧する。止めた後に GOTCHAS 候補を書く経路では、書き終えてから一覧する。該当が無ければ「なし」と書く。

## 3. ディスパッチプロンプトの規約

オーケストレーターは、コード(テストコードを含む)・spec.md / cases.md・タスクレビューと review の所見を
自分で書かず、委譲する。委譲先の返答の本文を `waits/<id>.md` や `review-<m>.md` などの報告のファイルへ
転記することは、所見を書くことに当たらない。オーケストレーターが自分で書くのは、agenda.md・design.md・
dev-plan.md・discussion.md・intent 文書(持続層を含む)である。自分で実行するのは、プロジェクトの test
コマンドと、ID が `units/` で始まる仕様のディレクトリのテストである。ID が `e2e/` で始まる仕様の
ディレクトリの実行は委譲する。

委譲は Agent ツールで行う。委譲先は名指しせず、作業内容を渡して委譲する。委譲先の決め方は §4 に従う。

委譲はバックグラウンドで動く。完了は後のターンに通知として届く。run があるときの委譲は、次の順で扱う。

- Agent ツールの結果で起動を確かめてから、`codiel-state wait-add --slug <slug> --id <id> --purpose <文> --task-id <返った ID>` で待ちを記録する。起動に失敗した委譲は記録しない。
- `id` は `<フェーズ>-<要素>-<回>` の形で委譲ごとに付け、try の中で使い回さない。要素の部分は、仕様のディレクトリの ID やステップの名前から作る。英小文字と数字以外の文字(`/`・`_`・`.`・大文字など)は、小文字にしてハイフンに置き換え、連続するハイフンは 1 つにする。100 文字を超える `id` は `wait-add` が拒否する。修正ラウンド・回帰の巡・実行し直しは回を上げて別の待ちにする。`purpose` は何の委譲かを書く 1 文にする。
- 並列にする委譲は同じ応答からまとめて出し(review の観点ごとの委譲を含む)、`wait-add` は 1 件ずつ順に呼ぶ。`codiel-state` の呼び出しは並列の Bash にしない。state の読み書きにロックが無く、並列に呼ぶと更新が失われる。
- `evaluate_*` が Claude Code にバックグラウンドへ移されたときも、`gate-<フェーズ>-<回>` の `id` で `wait-add` する。`<回>` は、そのフェーズの評価の回(attempt)である。
- 待つ間にできる作業(自分が書く文書・自分が実行するテスト)があれば進める。自分でテストを実行してよい条件は `references/delegation-env.md` の「テストを実行する委譲の並べ方」に従う。作業が無ければターンを終えて完了通知を待つ。
- 並列に出した委譲のグループ(同じ応答で出した委譲、implement の同じグループ、観点ごとの review)は、そのグループの待ちがすべて消えてから、マージ・まとめての実行・`evaluate_*` へ進む。要素ごとに進めてよいのは、タスクレビューのような要素単位の作業だけである。
- 完了通知を受けたら、state の更新や次の委譲より先に、返答の本文を要約せずに `.codiel/runs/<slug>/try-<n>/waits/<id>.md` へ書き、続けて報告の置き場(`references/delegation-env.md` の表)へ書く。その後で `codiel-state wait-done --slug <slug> --id <id>` を呼び、次の委譲やゲートへ進む。
- 複数の返答をまとめる報告(review と再レビューの `review-<m>.md` など)は、返答ごとに `waits/<id>.md` を書いて `wait-done` を呼び、グループの待ちがすべて消えてから書く。
- 委譲を出し直すときは、新しい回の `id` で記録する。
- Agent ツールの起動に失敗した、委譲先が異常終了した、返答が空だった、または成果物が空か不在だったときは、新しい回の `id` で 1 回だけ出し直す。2 回目も同じなら、`mark-ask <phase> --slug <slug> --kind confirm` の後に人に確かめる。
  - 返答が無い待ちは、返答が無かった旨を `waits/<id>.md` に書き、`wait-done --id <id>` で消す。`wait-clear` は `--id` を取らずその run の待ちを全部消すので、並列の待ちが残るときは使わない。
  - 返答はあるが成果物が空か不在のときは、返答を `waits/<id>.md` に書いて `wait-done` した後で出し直す。

run が無いときの委譲(`capturing-intent` の現状調査、`/codiel:test` の単独実行)は、待ちを記録しない。stop-guard も run が無ければ止めない。
active な run があるときの `/codiel:test` の単独実行は、`adhoc-` で始まる `id` で待ちを記録する。

待ちの記録が残っている間、stop-guard は停止を止めない。消し忘れた待ちがあると、その run では未完了の停止を検出できなくなるので、報告を書いたら `wait-done` を呼ぶ。

依頼文は次のテンプレートで書く。`<>` の値は実際の内容に置き換え、パスは解決済みの絶対パスで書く。

```
あなたはサブエージェントである。次の作業を担当する。
- 作業内容: <このフェーズの作業内容>

## 読むスキル
- <plugin-root>/skills/<スキル名>/SKILL.md

## 観点ファイル
- <plugin-root>/skills/<スキル名>/references/<観点>.md(無ければ「なし」)

## 入力ファイル
- <入力ファイルのパス>

## 出力ファイル
- <出力ファイルのパス>

## 前提
- diff の範囲: <review と再レビューの委譲のときだけこの行を書く。`<baseBranch>...<branch>` の形で、値は `codiel-state get --slug <slug>` の出力の `baseBranch` と `branch`。state に `baseBranch` が無いときは、`capturing-intent` の手順 1 のベースブランチの解決規則で解決した値>
- ARCHITECTURE: <review と再レビューの委譲のときだけこの行を書く。§0 で解決した絶対パス。存在しなければ「なし」>
- 反論済み所見: <再レビューの委譲のときだけこの行を書く。`fixing-review-findings` の反論済み一覧の全件。無ければ「なし」>
- 実行モード: <mapped | unscoped>
- testsDir: <§0 で得た値>
- 担当タグ: <このディスパッチで担当するタグ。ドメインに紐づかない委譲では「なし」>
- 担当範囲: <mapped で担当タグがドメインマップのキーにあるときは、そのキーの glob 配列。それ以外は「なし」>

## 前フェーズの申し送り(findings)
<前フェーズの EvaluationResult.findings を ruleId + message の箇条書きで要約したもの。無ければ「なし」>

## セッションの規律の転記
<セッションの規律が依頼文への転記を求める条項。無ければ「なし」>
```

依頼文には、委譲の種類に応じて次の条項を足す。

- 読み取りだけの委譲: 使ってよい tools を `Read` / `Grep` / `Glob` と読み取りに限った `Bash` に限り、ファイルを変更せず、報告だけを返す。
- test-spec: 使ってよい tools を `Read` / `Grep` / `Glob` / `Write` / `Edit` と Context7 に限り、`Bash` は使わない。書き込み先は `<testsDir>/<仕様のディレクトリ>/` の `spec.md` と `cases.md` に限る。
- test-code: 担当する仕様のディレクトリの ID と、`<testsDir>/<仕様のディレクトリ>/` の `spec.md` / `cases.md` のパスを書く。テストコードは規約の場所に置き、`spec.md` の frontmatter `tests` にパスを足すだけにして、`spec.md` の本文と `parallel`・`cases.md`・プロダクトコードは書き換えない。
- implement・test-loop・fix-loop: テストと `<testsDir>/**` の仕様(`spec.md`・`cases.md`)は書き換えない。
- すべての委譲: intent 文書は書き換えず、原文の追加が要るときはオーケストレーターへ報告する。

委譲先だけが使うスキル(`writing-test-specs`・`scripting-tests`・`implementing`・`fixing-failures`・`reviewing-diffs`)の本文は、オーケストレーターが Read や `cat` で読まない。依頼文の「読むスキル」にスキル名を書き、委譲先に読ませる。オーケストレーター自身の作業に使うスキルは、従来どおり読む。

観点ファイルは次の規則で依頼文に足す。観点ファイルは、ファイル名を `Glob` か `ls` で確かめて選び、本文は読まずに依頼文へパスを書く。委譲先に探させない。

- 実装の委譲(implement / test-loop の修正 / fix-loop の修正)では、変更の中身(dev-plan の触るファイルと内容、直す所見や失敗)から、`<plugin-root>/skills/implementing/references/` の中で合う観点ファイルを選んで足す。`mapped` でタグ名と同じ名前のファイルがあれば含める。`unscoped` でも、変更の中身に合うものを渡す。`worktree.md`・`e2e.md`・`fix-mode.md` は手順ファイルで観点ファイルではないので、選ばない。
- review と再レビューの観点は、`references/review-common.md` の規則で選ぶ。

ディスパッチの後、成果物のファイルが実際に存在し空でないことを確かめてから、raguel-gating のゲート手順に進む。サブエージェントの報告だけで完了としない。存在しないか空のときは、待ちの扱いの異常時の出し直しに従う。

## 4. ドメインディスパッチ

委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ送る。

実行モードが `mapped` のときだけ、ドメインに紐づく実装の委譲の間、run の `domain` に担当タグを持たせる。guard-write はこの値とドメインマップで境界を判定する。判定が働くのは implement / test-loop / fix-loop の 3 フェーズである。

```
node <plugin-root>/scripts/codiel-state.mjs set-domain --slug <slug> --domain <タグ>
node <plugin-root>/scripts/codiel-state.mjs clear-domain --slug <slug>
```

- `mapped` の実装と test-loop の修正では、ステップのタグの値を依頼文にそのまま渡す。汎用の実装へ送るときもタグの値を渡し、タグから別名を作らない。
- 依頼文の担当範囲は、§0 で読み取ったドメインマップから担当タグのキーの値を引いて作る。キーが無いときは「なし」と書く。
- worktree の中で動く委譲(implement の `parallel` グループの各ステップ、test-loop の仕様のディレクトリごとの修正)では `set-domain` を使わない。worktree の要素には `step-add --domain` で `domain` を記録してあり、guard-write は書き込み先が属する要素のその値で境界を判定する。
- メインの作業ツリーで動く委譲(`serial` グループ、`final`、グループのマージの後の run ブランチ上の修正、test-loop のプロジェクト全体の修正、fix-loop の修正)では、委譲の直前にタグの値をそのまま `set-domain` に渡す。
- `set-domain` を伴う委譲を `wait-done` したら、直後に `clear-domain` を実行する。解除しないと、次に `set-domain` するまで前の境界が効き続ける。
- `set-domain` を伴う委譲の待ちが残っている間は、メインの作業ツリーで動くほかの委譲を出さない(`domain` は 1 値しか持てない)。worktree の中で動く委譲には当てない。
- 複数の委譲を同じ応答で出すとき(review の観点ごとの委譲など)は、先に `clear-domain` を実行し、`set-domain` は実行しない。このときのドメインの規律は依頼文で伝える。review と再レビューでは `set-domain` を実行しない。
- `unscoped` では `set-domain` を呼ばず、各ディスパッチの前に `clear-domain` を実行する。
- ドメインに紐づかない委譲へ移る前に、`domain` が残っている可能性があれば `clear-domain` を実行する。
- 実装と test-loop の修正の委譲の並べ方は `references/delegation-env.md` に従う。

境界違反は `deny` ではなく `ask` で返る。止まったら、`set-domain` した値と `dev-plan.md` の該当ステップのドメインタグを照合する。値が誤っていれば正しい値で `set-domain` し直して続行する。値が正しければ越境であり、その書き込みを認めず、該当ドメインの実装の委譲をやり直す。
