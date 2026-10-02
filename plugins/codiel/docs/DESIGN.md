# Codiel オーケストレーター設計書

ユーザーの要望を聞き取って固定した intent 文書を起点に、discuss → design → テスト仕様 → 開発計画 →
実装 → 回帰テスト → intent-sync → PR → レビュー → 修正を一気通貫で行うオーケストレーターと、
それを支える skills / hooks / docs の設計。起点は GitHub Issue に限らず、Issue 番号・
確定済み intent 文書のパス・省略のいずれからも始められる(§2)。

各フェーズの進行には **Raguel MCP のゲートを逐一挟み**、AI の暴走(フェーズ飛ばし・偽装グリーン・
自己承認・無限修正ループ)を構造的に抑止するハーネスエンジニアリングを行う。

- スキルの記述様式は superpowers を模倣する(チェックリスト・プロセスフローチャート)。HARD-GATE と Red Flags は廃止した(§6 に理由)。
  ただし superpowers への依存はなく、プラグインとして自己完結する。
- **設計工程は人間と共同で行う**: intent フェーズ(聞き取りと承認ゲート)・discuss フェーズ
  (論点の合意)・design ウォークスルー(設計書の確認)・triage(起票指示)が常設の人間参加ポイント。
  それ以外のフェーズに固定承認ポイントはなく、人間が介入するのは Raguel が ASK / STOP を
  出したときのみ。
- **Claude Code 上で完結するプラグインである**(下記「実行環境の制約」)。

## 0. 実行環境の制約(最重要)

本プラグインは **Anthropic API を使用できないユーザーも使える**ことを必須要件とする。

- **Anthropic API を呼ぶ実装は一切持たない**。`ANTHROPIC_API_KEY` を前提にしない。
  LLM が必要な処理はすべて Claude Code の機構(メインセッション・サブエージェント)か、
  Raguel MCP が内部で行う `claude` CLI ヘッドレス実行(ユーザーの既存ログイン=サブスクリプション認証)で賄う。
- **CLI 単体での運用(Python スクリプトや独自 CLI をユーザーが直接叩く運用)は想定しない**。
  ユーザーとの接点は Claude Code のスラッシュコマンド(`/codiel:init`, `/codiel:run`, `/codiel:test`)のみ。
- 同梱スクリプト(`codiel-state`、hooks、install-harness.sh)は **node / bash のみ**で書く
  (Claude Code と raguel-mcp が既に依存しているランタイムに閉じる。Python 等の追加ランタイムを要求しない)。
  これらはオーケストレーターや hooks が内部的に呼ぶ決定論的な補助であり、LLM 呼び出しを含まない。
- この制約に反する設計変更(API クライアントの追加、外部 LLM サービス連携、
  ユーザーに CLI 操作を要求するフロー)は、実装フェーズでどれだけ便利に見えても採用しない。

## 1. 決定済みの前提(ブレインストーミングでの合意)

| 論点 | 決定 |
|---|---|
| 実行環境 | Claude Code 上で完結。Anthropic API 不使用・Python 等の追加ランタイム不使用・ユーザーへの CLI 操作要求なし(§0) |
| superpowers の扱い | スタイルのみ模倣。依存しない自前スキル群 |
| 人間の承認ゲート | discuss フェーズ・design ウォークスルー・triage は常設の人間参加ポイント。それ以外は Raguel の ASK / STOP のみで、PROCEED が続く限り自律 |
| 成果物の置き場 | 対象プロジェクトの `.codiel/` 配下。feature ブランチにコミットする |
| コマンド構成 | `/codiel:run [<Issue番号> \| <intentパス>]`(省略可。オーケストレーター)+ `/codiel:test`(単独テスト実行)。state による再開機能 |
| 連携モード | `github`(gh / GitHub MCP で起票・PR・投稿する)と `local`(投稿せず記録だけで終える)の 2 択。§0 で判定し run の間固定する(§2) |
| 実行モデル | メインセッション=オーケストレーター。文書(agenda.md・design.md・dev-plan.md・discussion.md・intent 文書)の執筆と、テストコマンドの実行は、オーケストレーターが自分で行う。spec.md / cases.md・テストコード・実装・レビュー・E2E の実行は、サブエージェント(fresh コンテキスト・ツール制限付き)へ委譲する |
| テスト仕様書 | run 使い捨てではなく**機能単位の永続資産**。機能更新時に仕様書を更新しテストケースを再生成する |
| テスト体系 | 仕様書駆動テストは **Playwright 等の E2E**。ユニットテストは別レイヤーで、実装の委譲先が TDD の中で作成する |
| 実装の委譲先 | frontend / backend / data のドメイン別に分ける |
| レビューの委譲先 | frontend / backend / data / infra / doc / security / generic の観点別に分ける |
| ドメイン縮退 | ドメイン分割が馴染まないプロジェクトは、ドメインマップを `generic` 1 つに縮退させ、実装とレビューの委譲先も汎用の 1 つで回す |
| runId / 再挑戦 | runId は intent フェーズで決めた **slug**(英小文字ケバブケース)。その下に **try 毎のフォルダ**(`try-<n>/`)を切り、同一 run の再挑戦を管理する |
| record_outcome | **マージ検知を自動化**: codiel コマンド起動時に未確定 run の PR 状態を gh で走査し自動記録。incident のみ人間の明示申告 |
| 役割別書き込み制御 | hooks の判定は deny ではなく **ask**(誤爆に備える)。hooks が機械的に制御するのはフェーズ単位まで(エージェント個体を識別できないため)。ドメイン単位の規律はエージェント定義とレビューで担保 |
| 設計ディスカッション | 常に実施・アジェンダ駆動型(論点抽出・進行・記録=オーケストレーター、決定=ユーザー)。discuss は非 GATED、ウォークスルーは design フェーズ内。詳細は `harness-docs/superpowers/specs/2026-07-10-codiel-discuss-phase-design.md` |

## 2. 全体フロー(フェーズと Raguel ゲート)

コード上の `STAGES`(正本 `plugins/codiel/src/codiel-state.ts`)は次の 13 ステージである。テスト駆動の
順序(決定 73)により、test-code フェーズが test-spec / dev-plan と implement の間に入る。

```
/codiel:run [<Issue番号> | <intentパス>]
   │
   ▼
[intent]       オーケストレーター本体がユーザーと対話し、TOBE を聞き取って ASIS(現状調査)と
               突き合わせ、intent 文書 `docs/intents/<slug>.md` に確定する(capturing-intent の
               手順)。連携モード(github / local)は §0 でこのフェーズより前に判定し、run の間
               固定する。
               ▶ Raguel: evaluate_decision(承認ゲートで規模・終え方・Issue 起票の 3 項目も決める)
   ▼
[discuss]      オーケストレーターが論点リスト agenda.md を作成(選択肢・トレードオフ・推奨案。
               intent の不明点は全件論点化)→ ユーザーとディスカッション
               (「すべて推奨案で進める」ショートカットあり)→ 合意を discussion.md に記録する
               (軽量な run では skip)
               ▶ Raguel ゲートなし(合意の検査は design の evaluate_design が担う)
   ▼
[design]       設計書 design.md を執筆(軽量な run では skip し、intent と持続層を直接使う)。
               `## 影響を受ける機能単位` にテストの仕様のディレクトリ(§4)の ID を列挙し、既に
               ある画面の仕様を更新するときはその名前を、新しい画面には名前の候補を書く
               (決定 81)。執筆後、オーケストレーターが要点をユーザーに提示するウォークスルーを
               行い、新しい画面があれば候補から名前を決めてから、承認後に evaluate_design する。
               ▶ Raguel: evaluate_design
   ▼
[test-spec ∥ dev-plan]  並列(設計書 2026-10-01-codiel-run-speedup-design.md §10.3):
               1. オーケストレーターが仕様のディレクトリを同定する(軽量でなければ design.md の
                  一覧を使い、軽量な run では新しい画面があれば名前を聞いてから同定する)
               2. test-spec: 影響を受ける機能単位ごとにテスト仕様書 spec.md を新規作成 or 更新し、
                  続けて ID 付きテストケース表 cases.md を(再)生成する委譲を出し、待ちを記録する
                  (§4)。新しい画面の名前の候補は委譲の報告で受け取る
               3. dev-plan: 委譲が動いている間に、オーケストレーターが開発手順書 dev-plan.md を
                  書く。各ステップにドメイン(frontend/backend/data)タグ・触るファイル・前提
                  ステップ・通すテスト(仕様のディレクトリの ID)を書く。文書の先頭に
                  `## 環境準備`(worktree で依存をインストールするコマンド)と `## 生成物`
                  (ビルド生成物を各ステップでコミットする方式 a か、全 wave の後の最終ステップで
                  まとめる方式 b か)を置く
               4. spec の委譲の完了通知を受けたら、報告を書いて待ちを消す
               ▶ Raguel: evaluate_plan ×2(dev-plan と test-spec をそれぞれ独立にゲート)
   ▼
[test-code]    仕様のディレクトリごとに worktree を作り、cases.md からテストコード(ユニットと
               E2E)を実装より先に並列で書いて実行し、失敗すること(Red)を確かめる。テストを
               通すコードはまだ書かない。置いたテストファイルのパスを spec.md の frontmatter
               `tests` に記録し、タスクレビューを通ったディレクトリから run ブランチへ順に
               マージする。cases.md の誤りを見つけたら、直す委譲を挟んでからやり直す
               ▶ Raguel: evaluate_code(全ディレクトリのマージ後に 1 回。diff はテストコードと
                 spec.md の `git diff`)
   ▼
[implement]    `codiel-state waves` が計算した実行順(触るファイルが重ならない範囲で最大 4 ステップ
               の wave に分け、lockfile を触るステップは単独の直列グループにする)で、各 wave を
               worktree に並列実装する。各ステップは、そのステップまでで通る仕様のディレクトリ
               (ユニットと E2E の両方。E2E も除外しない。決定 80)を「通すテスト」として通す
               (Green)。wave のマージの後、そのグループの通すテストを run ブランチで実行して確かめる
               (プロジェクトの test コマンドと `units/` はオーケストレーターが自分で、`e2e/` は委譲で実行する)
               ▶ Raguel: evaluate_code(全 wave の後に 1 回。diff + testResults)
   ▼
[test-loop]    記録された全テスト(各 spec.md の `tests`)とプロジェクトの test コマンドで回帰を
               確認し、全件が通るまで修正を繰り返す。判定が出て期待と違うもの(NG)は仕様の
               ディレクトリごとに worktree で修正し、判定が出ないもの(broken)はテストが
               保護されているため人に確かめてから直す。テストを書く手順は持たない(§5)
               ▶ Raguel: コード修正の度に evaluate_code
   ▼
[intent-sync]  承認済みの受け入れ基準の変更と、途中でユーザーが追記した原文を、派生文の
               セクションへ人の確認つきで反映する(原文のセクション自体は書き換えない)。
               `docs/intents/domains/` の持続層を更新する。intent の `status` は変えない
               (`done` を付けるのは finalize だけである)。
               ▶ Raguel: evaluate_design
   ▼
[pr]           github: `git push` して `gh pr create` で PR を作成する(本文に intent パスを書く)
               / local: push せず、run ブランチと base を state に記録するだけで終える
               ▶ hooks が「テスト green + code PROCEED」を state で検証してから許可
   ▼
[review]       diff(`git diff <base>...<branch>`)の変更パスと内容に当たる観点
               (frontend/backend/data/infra)+ 毎回選ぶ観点(doc/security)を並列
               ディスパッチする。frontend・backend・data・infra のどれにも当たらず、
               doc の担当でもない変更パスがあるときだけ generic を足す。intent の原文(`## ASIS` / `## TOBE`)の要望が未達なら
               severity high、持続層の制約に反していても high とする。所見を統合し、
               github では PR コメントに投稿し(local では投稿しない)、
               severity(critical / high / medium / low)を付ける
   ▼
[fix-loop]     critical & high を該当ドメインの実装の委譲先が修正 → 回帰テスト再実行
               → 再レビュー → critical/high ゼロ & テスト合格まで反復(試行上限あり)
               medium 以下の指摘は修正せず triage へ持ち越す
               レビューで critical/high がゼロなら fix-loop は開始せず
               `codiel-state skip-phase fix-loop --slug <slug> --reason ...` でスキップする
               ▶ Raguel: 修正毎に evaluate_code
   ▼
[triage]       medium / low の指摘を一覧化してユーザーに提示し、指示を待つ。
               github: 起票対象に選ばれた指摘を `gh issue create` で別 Issue として起票する
               / local: `status: proposed` の intent 草案として `docs/intents/` に書く
               ▶ Raguel ゲートなし(人間が直接指示するフェーズのため)
   ▼
[finalize]     intent の原文(`## ASIS` / `## TOBE`)の要望ごとに「達成 / 未達 / 要確認 /
               持ち越し」を結果レポートに記録する。持ち越しを除いてすべて達成のときだけ
               intent の `status` を `done` にする。未達・要確認が残れば `in-progress` の
               ままにする。state を `awaiting_outcome` にして終了する
               ▶ `codiel-state finalize`
```

- `GATED`(Raguel ゲート必須)は intent / design / test-spec / dev-plan / test-code / implement /
  test-loop / intent-sync / fix-loop の 9 フェーズである。discuss・pr・review・triage・
  finalize は `complete-phase` で進む(Raguel ゲートなし)。
- フェーズの途中でユーザーに確認するとき(Raguel の判定とは別)は
  `codiel-state mark-ask <phase> --slug <slug> --kind confirm` で run を `awaiting_human`
  にし、答えを得たら `codiel-state resume --slug <slug>` で戻す。

### outcome の自動同期

- finalize 後の run は state `awaiting_outcome` で残る。
- **すべての codiel コマンド(`/codiel:run` / `/codiel:test`)は起動時に `awaiting_outcome` の run を走査**し、
  連携モードに応じて次のとおり自動記録する。
  - github: `gh pr view --json state,mergedAt` で PR の現況を確認する。
    - マージ済み → `record_outcome(approved)`
    - マージされずクローズ → `record_outcome(rejected)`
    - オープンのまま → 何もしない(次回また確認)
  - local: `git merge-base --is-ancestor <run ブランチ> <ベースブランチ>` が真なら取り込み済み
    として `record_outcome(approved)`。偽なら squash merge・未取り込み・却下を履歴だけでは
    区別できないため、ユーザーに聞いて判定する。
- **incident(PROCEED したのに実害が出た)だけは自動検知できない**ため、人間が明示的に申告したときに
  `record_outcome(incident)` を記録する。最も価値の高い失敗判例なので、`.claude/rules/codiel.md` に申告の運用ルールを書く(§9)。

### verdict 別ハンドリング

- **PROCEED** → 次フェーズへ自動遷移
- **ASK** → findings を人間に提示して停止(state は `awaiting_human`)。
  人間の裁定を `record_outcome` で記録し、再開(修正指示つき差し戻し or 続行)または中止。
  裁定が「as-is 承認」の場合は**再 evaluate せず**(sealed な resubmission-loop ルールと衝突しライブロックするため)、
  `codiel-state pass-gate <phase> --slug <slug> --verdict ASK --human-approved` で通過させる。
  verdict は ASK のまま `humanApproved: true` が監査記録として残る。`record_outcome(approved)` の記録が
  前提条件(運用規約は raguel-gating スキル)
- **STOP** → 人が裁定する(Raguel の応急処置。決定 83)。所見(ruleId・severity・message・evidence)と
  `casePath` を示し、`mark-ask <phase> --slug <slug> --kind raguel --verdict STOP
  --evaluation-id <STOP の evaluationId>` で run を `awaiting_human` にする。「誤検知として続ける」か
  「妥当として止める」かを AskUserQuestion で聞き、オーケストレーターはどちらの裁定も自分で選ばない。
  誤検知として続けるときは `record_outcome(approved, ruling: false-positive)` を記録し、`resume` の後に
  `pass-gate <phase> --slug <slug> --evaluation-id <STOP の evaluationId> --verdict STOP
  --human-approved` で通す。フェーズの `verdict` は `STOP` のまま残り、`humanApproved` が記録される。
  妥当として止めるときは `stop --slug <slug> --reason raguel-stop` で止める。STOP の後に evaluate を
  呼び直して verdict を上書きしない。2026-10-02 までは、誤検知を「未記録の GOTCHAS」へ退避し、妥当な STOP を
  GOTCHAS へ記録していた。K12(§9「ARCHITECTURE と GOTCHAS を codiel の指示層から外した理由(K12)」)で両方を外した。
  誤検知の内容は `record_outcome` の `notes` に残る。
- **ループ上限超過**(test-loop / fix-loop の試行回数)→ ASK に倒す。
  Raguel の `common/resubmission-loop` ルールと合わせて二重の暴走防止

`--human-approved` が正規に使える例外は、ASK の as-is 承認と、STOP の誤検知の裁定の 2 つだけである。
どちらも `record_outcome(approved)` を記録済みの、実在する `evaluationId` に対してのみ許される。

## 3. 成果物と state 管理

### 置き場と git の扱い(run の文書と intent 文書は feature ブランチにコミットする)

```
docs/intents/<slug>.md      # 確定した intent 文書(原文の ASIS/TOBE・派生文・受け入れ基準。§6.3)[git で共有]
docs/intents/domains/       # 持続層(領域ごとの意図的な制約・非ゴール)[git で共有]
<runsDir>/<slug>/           # run の文書(既定 docs/codiel/runs)。try では分けず、新しい try は同じパスへ書き直す [git で共有]
  agenda.md                 # ディスカッション論点リスト(選択肢・トレードオフ・推奨案)
  discussion.md             # ユーザーとの合意記録(論点毎の決定・理由・却下案)
  design.md                 # 設計書(影響を受ける機能単位の列挙を含む)
  dev-plan.md               # 開発手順書(ステップ毎にドメインタグ・触るファイル・前提ステップ・通すテスト)
<testsDir>/                 # ★永続テスト資産(既定 docs/codiel/tests。run を跨いで蓄積・更新される。§4)[git で共有]
  units/<対象ファイルの repoRoot 相対パス>/  # ユニットテストの仕様のディレクトリ
  e2e/frontend/<画面名>/             # 画面ごとの E2E の仕様のディレクトリ
  e2e/backend/<API のルートパス>/    # API ルートごとの E2E の仕様のディレクトリ
  e2e/cli/<コマンド名>/              # 画面でも API でもない入口(CLI 等)の仕様のディレクトリ
    spec.md                         # テスト仕様書(振る舞い・受け入れ基準との対応・tests の記録)
    cases.md                        # ID 付きテストケース表(前提・操作・期待結果)。仕様書から生成
    reports/<日時>-<slug>-try<n>/   # E2E のレポート(実行ごと)。results.json・summary.md・failure.md だけ共有し、画像などは共有しない
.codiel/
  config.json               # testsDir・runsDir・raguel の 3 つのキーを持つ設定(キーが無ければ既定値。§4)[git で共有]
  worktrees/<slug>/<名前>/  # 並列実装・test-code・test-loop が作る一時 worktree(マージ後・run 終了時に削除)[.git/info/exclude で外す]
  reports/                  # /codiel:test(単独実行)のレポートと E2E のレポート [.gitignore で外す]
  runs/<slug>/              # slug は intent フェーズの承認ゲートで決める識別子 [.gitignore で外す]
    try-<n>/                # 同一 run の挑戦毎のフォルダ(再挑戦で try-2, try-3, …)
      state.json            # フェーズ進捗・ゲート記録・試行カウンタ(直接編集は hooks で禁止)
      steps/                # ステップ・仕様のディレクトリ毎の brief.md / report.md(§6.6.4)
        step-<k>/            # implement の直列グループ・最終ステップ・run ブランチ上の修正
        test-code-<k>/       # test-code の仕様のディレクトリごとの委譲
        test-loop-<k>/       # test-loop の NG 修正の委譲
        merge-fix-<g>/       # implement の wave のマージ後の run ブランチ上の修正
        test-loop-project/   # test-loop のどの仕様のディレクトリにも属さない修正
      reports/
        test-run-<n>.md     # 各回のテスト実行結果
        review-<n>.md       # 各回のレビュー所見
```

- `.codiel/runs/` と `.codiel/reports/` の行、E2E のレポートの `results.json`・`summary.md`・`failure.md` を戻す 4 行は、
  `/codiel:init` が承認を得て `.gitignore` に足す。`.codiel/runs/` の下のファイルはコミットしない。
  pr の前の確認で run の外のファイルが残っていたら、コミットも退避もせずにユーザーに聞く。
- intent 文書は run の文書の外、`docs/intents/` に置く。state の `intent` フィールド
  (repoRoot 相対パス)が指す。
- **報告は返答で受ける**: 委譲先は報告の本文を最終の返答で返し、報告のファイル(`report.md`・
  `test-run-<n>.md` など)は、委譲の完了通知を受けた直後にオーケストレーターが `waits/<id>.md` と一緒に `.codiel/runs/` の下へそのまま書く。
  Claude Code 本体がサブエージェントによる報告ファイルの Write を拒否するためである(決定 95)。
- **E2E のレポート**: 仕様のディレクトリごとに 1 回の実行を、メインの作業ツリーの `reports/<日時>-<slug>-try<n>/`
  に置く。日時は実行する機械のローカルのタイムゾーンで `YYYYMMDD-HHMMSS` とする。`results.json` はテスト
  フレームワークの出力、`summary.md`(成功と Red の確認)と `failure.md`(失敗)はオーケストレーターが返答から書く。
  書式は `references/e2e-report-format.md`。オーケストレーターが、コード系フェーズの `evaluate_code` の前と
  `codiel-state stop` の直前にコミットし、finalize で途中のパスした実行と Red の確認の実行を消して、失敗した実行と
  仕様のディレクトリごとの最後の実行だけを残す。`/codiel:test` の単独実行のレポートは
  `.codiel/reports/test-run-<日時>/` にだけ置く。
- **try の運用**: `/codiel:run` 実行時、最新 try が未完了なら**その try を再開**、
  終了状態(stopped / awaiting_outcome / completed / rejected)なら **try-<n+1> を新規作成**して開始する。
  新 try のサブエージェントは過去 try の成果物・レビュー所見を参照できる(前回の失敗を繰り返さないための入力)。
  run の文書は try で分けず同じパスへ書き直すので、前の try の run ブランチにある文書は
  `git show <前の try の branch>:<runsDir>/<slug>/<ファイル名>` で読む。
- Raguel へ渡す `raguelRunId` は `<slug>-try-2` の形式(try 毎に独立したケースファイル・resubmission-loop カウンタを持つ)。
- テストの仕様の置き場(`testsDir`)と run の文書の置き場(`runsDir`)は `.codiel/config.json` で設定する。
  既定は `docs/codiel/tests` と `docs/codiel/runs`。ファイルが無い、またはキーが無ければ既定値を使う。
  値は repoRoot 相対で、run が active な間は書き換えない(§4)。Raguel の設定も同じファイルの `raguel` に
  置き、Raguel は YAML を読まない。
- 並列実装・test-code・test-loop の委譲は 1 ステップ(または 1 仕様のディレクトリ)につき 1 worktree
  (`.codiel/worktrees/<slug>/<名前>`)で行い、タスクレビューを通ったものから run ブランチへ
  `git merge --no-ff` する。worktree はマージ後、または run の終了時(finalize / stop)に削除する(§6.6)。

- フェーズ間の引き継ぎは**すべてファイル経由**。サブエージェントには「入力ファイルパス」と
  「出力ファイルパス」を渡す。コンテキストが切れても壊れない。
- PR に intent・設計書・テスト仕様書・テストケースが含まれるため、人間のレビュアーが要望の出所・
  設計意図・テスト根拠を diff 上で確認できる(github モードだけの手順。local は push しない)。

### state.json とフェーズ遷移の保護

```jsonc
{
  "version": 2,
  "runId": "add-dark-mode-toggle",       // slug。intent フェーズの承認ゲートで決める
  "try": 1,
  "issue": null,                          // Issue が無い run では null
  "intent": "docs/intents/2026-09-27-add-dark-mode-toggle.md",
  "branch": "codiel/add-dark-mode-toggle-try-1",   // ブランチは try 毎(旧 try のブランチ・PR と衝突させない)
  "integration": "github",                // "github" | "local"。§0 で判定し run の間固定
  "scale": "standard",                    // "standard" | "light"
  "imageUpload": { "ghAttach": true, "chrome": false },
  "knowledgeTarget": "metatron",          // "metatron" | "intents"。ADR 候補と GOTCHAS 候補の書き先
  "phase": "implement",            // 現在フェーズ
  "phases": {
    "intent":    { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "design":    { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "test-spec": { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "dev-plan":  { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "test-code": { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "implement": { "status": "in_progress", "attempts": 1 }
  },
  // 並列実装のステップと、test-code・test-loop の仕様のディレクトリの進捗(任意フィールド。§6.6.5)。
  // キーは implement.steps がステップ番号、testCode.units / testLoop.units が仕様のディレクトリの ID。
  // 各要素は状態(pending/running/reviewing/merged/failed)・触るファイル・前提ステップ・
  // wave の位置・worktree のパスとブランチ・コミット範囲・修正ラウンド数・ドメインを持つ
  "implement": { "steps": { "1": { "status": "merged", "worktree": null, "branch": null,
    "attempts": 0, "domain": "frontend" } } },
  "testCode": { "units": {} },
  "testLoop": { "units": {} },
  "pr": { "url": null },
  "limits": { "maxFixAttempts": 5 }
}
```

- **state.json は AI が直接書けない**。フェーズ遷移は同梱スクリプト `codiel-state`(Bash 経由で実行)
  だけが行い、スクリプトが遷移の正当性を機械的に検証する:
  - ゲート必須フェーズは Raguel の `evaluationId` + `verdict: PROCEED`(または人の裁定つき ASK/STOP)なしに `passed` にできない
  - フェーズ順序のスキップ不可(intent → discuss → design → … の順序を強制)
  - 試行カウンタはインクリメントのみ(リセット不可)
- **並列実装・test-code・test-loop のステップ**は `step-add --kind step|test-code|test-loop` で登録し、
  `pending → running → reviewing → merged / failed` の順でのみ遷移する(test-loop は `merged` の要素を
  次の巡で `pending` に登録し直せる)。実行順は `codiel-state waves` が、触るファイルの重なり・前提
  ステップ・lockfile の有無から wave(最大 4 ステップの並列グループ、または 1 ステップの直列グループ)
  にトポロジカル順で分け、循環依存は非ゼロで終了する(§6.6)。
- Edit / Write ツールによる state.json への直接変更は hooks で拒否(§8)。
  これが「フェーズ飛ばし」「ゲート偽装」への構造的防壁。
- **再開**: `/codiel:run` を Issue 番号・intent パス・省略のいずれかで再実行すると、対応する
  run の state.json を読み、未完了フェーズから自動再開する(解決の手順は orchestrating-runs)。

### 持続層(`docs/intents/domains/<領域>.md`)

変更ごとの intent は 1 回の要望を記録して終わるが、意図的な制約は複数の intent をまたいで効き続ける。
この差を吸収するのが持続層で、領域(`frontend` など)ごとに 1 ファイルへ蓄積する。基準は `repoRoot` に
固定し、設定では変えない。原文のセクション(`## ASIS` / `## TOBE`)は置かず、ユーザーの言葉は変更ごとの
intent にだけ残す。

書式は `# <領域名>` の下に `## 目的` / `## 意図的な制約` / `## 非ゴール` / `## 由来` / `## 出典` の
5 セクションを持つ(正本は `references/intent-format.md`)。`## 意図的な制約` の小見出しは、制約・理由・
出典 intent・関連 ADR を持つ。`knowledgeTarget` が `intents` のとき、ADR の 3 条件(覆すコストが大きい・
選択肢が実在した・理由が自明でない)を満たす判断は、小見出しの末尾に `[ADR 候補: <領域名>-<連番>]` の
印を付けて全文を書く。3 条件を満たさない設計理由と制約は、`knowledgeTarget` の値によらず持続層に書く。

読み手と書き手は次のとおりである。

| フェーズ | 扱い |
| --- | --- |
| intent | 読む。関係する領域の制約をユーザーに示す |
| design(標準)/ test-spec・dev-plan(軽量) | 読む。制約を設計・仕様・手順の前提にする |
| review | 読む。制約への違反は severity high の所見にする |
| intent-sync | 書く。取り込みと `[ADR 候補]` の採番を行う唯一のフェーズ |

`knowledgeTarget` は ADR 候補と GOTCHAS 候補の書き先を決める値で、intent フェーズの承認ゲートで決め、state.json に記録する。`metatron` の run は ADR 級の
判断を持続層に全文で残さず、metatron の ADR に直接任せる(持続層には `関連 ADR` の番号だけを書く)。
`intents` の run は metatron が無い、または ARCHITECTURE が見つからない環境で使う値で、ADR 級の判断も
`[ADR 候補]` として持続層に全文を残す。

metatron を導入すると、`/metatron:init` と `/metatron:update` が持続層を走査し、`[ADR 候補]` の印を
ADR へ移してから、そのエントリだけを参照形(見出し・制約・`関連 ADR: ADR-NNN(候補 ID: ...)` の 3 行)に
縮める。移送と縮約の対象はエントリの範囲に限り、ほかのエントリやセクションは変えない。codiel はこの
移送の手順を持たず、`[ADR 候補]` を作るところまでを担う。

`[ADR 候補]` の書式と参照形は codiel と metatron の共有ファイル契約で、正本は `references/intent-format.md` に置く。metatron は最小限の写しを参照文書に置く。

- 小見出しを metatron の ADR エントリと同じ名前と順序にするのは、metatron が ADR へ移すときに、小見出しの下をそのまま写せるようにするためである。
- 参照形に候補 ID を残すのは、採番で ID を再利用しないためである。
- 3 条件は metatron の執筆規律の写しである。
- 原文の区切りの前後に空行を置くのは、空行が無いと直前の行が見出しとして描画されうるためである。区切りは、どこから下を AI が書いたか、食い違えばどちらに従うかを人が分かるようにするために置く。

### intent issue のマーカー検知の根拠

intent issue を検知するときは、マーカーの位置制約を課さず、フェンス内の例示マーカーも検知する。ARCHITECTURE への言及は、`intent-format.md` から本書へ退避した根拠である。

- 位置制約を課さないのは、Issue テンプレートのヘッダが前置されてマーカーが本文の中ほどに来ることがあり、「先頭 N 行以内」の条件では intent issue を取りこぼすからである。
- フェンス内の例示マーカーも検知するのは、取りこぼしの損失(写像が効かず精度が落ちる)が誤検知の損失より大きいからである。ARCHITECTURE 側のフェンス除外と規律が異なるのは、意図した非対称である。

## 4. テスト資産モデル(永続・仕様のディレクトリ単位)

テストの仕様は run の使い捨て成果物ではなく、`<testsDir>`(既定 `docs/codiel/tests`。`.codiel/config.json` の
`testsDir` で変更できる。§6.13.4)配下に、仕様のディレクトリ単位で蓄積する永続資産である(決定 74)。

- **仕様のディレクトリの系統と ID**: `testsDir` からの相対パスがそのディレクトリの ID になる。

  | 系統 | 仕様のディレクトリ | 例(値は説明用) |
  | --- | --- | --- |
  | ユニットテスト | `units/<対象ファイルの repoRoot 相対パス>/` | `units/src/lib/foo.ts/` |
  | E2E(画面) | `e2e/frontend/<画面名>/` | `e2e/frontend/login/` |
  | E2E(API) | `e2e/backend/<API のルートパス>/` | `e2e/backend/api/users/{id}/` |
  | E2E(画面でも API でもない入口) | `e2e/cli/<コマンド名>/` | `e2e/cli/codiel-state/` |

  画面名・コマンド名は英小文字のケバブケースの 1 セグメント、API のルートパスはパラメータを `{id}`
  の形にそろえてディレクトリの並びにする(ルート `/` は `e2e/backend/_root/`)。命名と置き場の
  唯一の正式な定義元は `writing-test-specs` である。

- **画面名の決め方(決定 81)**: `<testsDir>/e2e/frontend/` に既にある画面の仕様を更新するときは
  その名前を使い、ユーザーには聞かない。まだ仕様のディレクトリが無い画面には、仕様のディレクトリを
  同定する委譲が英小文字のケバブケースの**名前の候補を 2〜3 個**出す。標準の run では design の
  ウォークスルーで、軽量の run では test-spec の開始時にオーケストレーターが
  `mark-ask --kind confirm` の後に AskUserQuestion でユーザーに聞き、決まった名前を ID にする。
  候補の外の答えはケバブケースの 1 セグメントに直した形を示して確かめる。コマンド名と API の
  ルートパスはコードから機械的に決まるので聞かない。

- **三層構造**: `spec.md`(振る舞い仕様。frontmatter に `parallel` と `tests` を持つ)→ `cases.md`
  (仕様から導出した ID 付きテストケース表)→ テストコード(ユニットと E2E)。上流が変わったら
  下流を再生成する。

- **作る仕様の決め方(決定 78・79)**: プロジェクトの規約(`CLAUDE.md`・`.claude/rules/**/*.md` の
  テスト方針)に定めがあれば従う。無ければ、E2E はユーザーから観測できる振る舞いが変わるときだけ
  (画面の表示・操作が変わる画面ごとに `e2e/frontend`、API の応答が変わるルートごとに
  `e2e/backend`、コマンドの入出力が変わるコマンドごとに `e2e/cli`)、ユニットテストは分岐・計算・
  変換などのロジックを持つ追加・変更ファイルにだけ作る。設定・型定義・表示だけのファイルには
  作らない。

- **テストコードの置き場(決定 76)**: codiel は場所を決めず、test-code フェーズの委譲先が
  「`CLAUDE.md`・`.claude/rules/**/*.md` の定め → 同じ種類の既存のテストの配置 → フレームワークの
  既定」の順で決める。置いたパスは `spec.md` の frontmatter `tests` に記録する。`tests` の各行は
  repoRoot 相対のファイルパスを 1 つ持ち、glob は使わない。

- **更新フロー**: 機能に更新が入る run では、design(標準)または test-spec 開始時の同定の委譲
  (軽量)が対象の仕様のディレクトリを列挙し、test-spec が該当ディレクトリの `spec.md` を更新
  (なければ新規作成)して `cases.md` を再生成し、test-code フェーズがテストコードを追随させる。

- **役割分担による捏造防止**: 期待結果(`cases.md`)を書くのは test-spec、テストコードを書くのは
  test-code、コードを直すのは implement・test-loop・fix-loop である。期待結果を書く者とテストを
  書く者とコードを直す者が全員別人なので、「期待値を書き換えて合格させる」改竄には最低 2 フェーズの
  同時汚染が必要になる。三層構造(`spec.md` → `cases.md` → テストコード)のうち、`scripting-tests` が担当するのはテストコードの作成と実行である。

- **実装より先にテストを書く(決定 73)**: test-code フェーズが `cases.md` から実装より先に
  テストコード(ユニットと E2E)を書いて実行し、失敗すること(Red)を確かめる。E2E も implement
  で通し、除外しない(決定 80)。implement の各ステップは、そのステップと前提ステップが終わった
  時点で通る仕様のディレクトリを「通すテスト」として通し(Green)、wave のマージの後に
  オーケストレーターが run ブランチでそのグループの通すテスト(E2E を含む)を実行して確かめる。
  test-loop は記録された全テストの回帰の確認と修正を、全件が通るまで繰り返す(§5)。

- **テストの保護(決定 77)**: implement・test-loop・fix-loop の間、`<testsDir>/**/{spec,cases}.md`
  と `spec.md` の `tests` に載ったファイルへの書き込みは guard-write が ask にする。test-spec と
  test-code は通す。fix-loop では、所見がテストに向くときだけ `set-test-edit` を立てている間、
  保護を外す(§8)。guard-write hook は `<testsDir>/**/spec.md` と `<testsDir>/**/cases.md` への書き込みを implement・test-loop・fix-loop で ask にし、test-code は通す。hooks は文書フェーズの `<testsDir>/` 配下への書き込みを止めず、呼び出し元の委譲先も識別できないので、これ以外の境界は委譲先自身の規律で守る。

## 5. test-loop の詳細と `/codiel:test`

test-loop はテストを書く手順を持たない(決定 73。テストを書くのは §4 の test-code)。記録された
全テスト(`<testsDir>/**/spec.md` の `tests`)とプロジェクトの test コマンドで回帰を確認し、全件が
通るまで修正を繰り返す。

- **判定**: 判定が出ないケース(broken)はテストの欠陥の疑いとし、判定が出て期待と違うケース
  (NG)はプロダクトのバグとする。理由が環境にある失敗(下記)は broken にも NG にも数えない。
- **NG の修正**: 仕様のディレクトリごとにまとめ、`step-add --kind test-loop --id <ID>` で
  `testLoop.units` に登録し、worktree(名前は `test-loop-<k>`)で該当ドメインの担当が修正する。
  前の巡で `merged` になった要素は次の巡で登録し直せる(k は変わらない)。どの仕様のディレクトリ
  にも属さない失敗(プロジェクトの test コマンドだけが見つけた失敗)は、run ブランチ上で直列に
  修正する。
- **broken の修正**: テストが保護されているため(§4)、`mark-ask test-loop --kind confirm` の後に
  人が承認してから、テスト側の保護を外して直す。
- **同時実行(決定 30)**: `spec.md` の frontmatter `parallel: true` を持つ仕様のディレクトリの
  テストだけを同時に実行し(上限 4 件)、持たないもの(ポート・データベースなど共有資源を使う
  テスト)は直列に実行する。frontmatter やキーが無ければ直列とする。この規則は test-loop・
  `/codiel:test`・implement の wave のマージ後の実行に共通で当てる。
- **テストを実行する委譲の並べ方(§6.13.1)**: 中でテストを実行する委譲(test-code・implement・
  test-loop の委譲、run ブランチ上の修正の委譲、環境の失敗の実行し直しの委譲)を、`parallel: true`
  の仕様のディレクトリだけを実行する「並列可の委譲」と、それ以外の「単独の委譲」に分ける。
  「動いている委譲」は待ちの記録が残っている委譲を指す。並列可の委譲は、動いている委譲が無いか
  並列可の委譲だけのときに、上限 4 件の範囲でまとめて出す。単独の委譲は、待ちが空のときだけ出し、
  その待ちが残っている間は同じフェーズのほかの委譲を出さない。メインの作業ツリーで `set-domain` を
  伴う委譲の待ちが残る間は、メインの作業ツリーのほかの委譲も出さない。
- **テストの実行環境と環境の失敗**: E2E の実行に要る準備(サーバー起動・データベースの用意など)
  はプロジェクトの規約とテストの設定に従い、codiel は準備の手順を持たない。サーバーが起動しない・
  接続が拒否される・ポートが使用中・必要なサービスが無い、といった理由の失敗は「環境の失敗」とし、
  未実装による失敗にもプロダクトの失敗にも数えない。委譲先は理由と出力の抜粋を報告に挙げ、
  オーケストレーターは動いている委譲が無いときに 1 回だけ単独で実行し直させる(この扱いは
  test-code・implement・test-loop・`/codiel:test` に共通)。実行し直しても環境の失敗なら、人に
  確かめる。委譲先の報告は最終の返答で返り、報告のファイルはオーケストレーターが書く(§3)。
- **E2E のレポート(決定 103〜105)**: E2E は仕様のディレクトリごとに 1 回の実行にし、`results.json` と
  スクリーンショットを、オーケストレーターが依頼文に書いた `<testsDir>/e2e/…/reports/<日時>-<slug>-try<n>/`
  へ出す(worktree の中で実行しても、出力はメインの作業ツリーに出す)。実行の結果から
  オーケストレーターが `summary.md` か `failure.md` を書く。test-code の Red の確認の実行は、結果に
  かかわらず失敗した実行に数えず、`summary.md` を置く。NG を直す委譲には、失敗した仕様のディレクトリの
  最新のレポートの絶対パスを渡し、委譲先が `failure.md`・`results.json`・画像から直し方を決める。
  PR などの証拠の画像とログにも、このレポートを使う。
- テストコードの diff も Raguel の `evaluate_code` に通す(期待値の骨抜き・ケースの無断削除は
  `code/test-deletion` 系ルール + レビューの検査対象)。

### /codiel:test(オーケストレーター外の単独テスト実行)

- `/codiel:test [<testsDir> からの相対パス>]` — 引数を省略すると `<testsDir>` 全体、指定時は
  その配下の仕様のディレクトリだけを対象にする。
- `<testsDir>/**/spec.md` の `tests` に記録されたテストを実行し、結果を
  `.codiel/reports/test-run-<日時>.md`(日時は実行する機械のローカルのタイムゾーンで
  `YYYYMMDD-HHMMSS`。決定 109)に保存して要約を報告する。E2E は仕様のディレクトリごとに実行し、
  そのレポートは `.codiel/reports/test-run-<日時>/<仕様のディレクトリの ID>/` にだけ置いて、
  報告からリンクする。`tests` を持たない仕様の
  ディレクトリは「テストコードなし」と報告し、テストは書かない。
- run 中でなくても使える(手動回帰・CI 前チェック用)。state を遷移させないので、NG があっても
  コード修正はディスパッチせず(報告のみ)、broken の確認も `mark-ask` を使わずユーザーに直接
  示す。環境の失敗は、実行し直しても残れば報告に挙げてユーザーに示す。
- 単独実行中も hooks の書き込み制御は有効(アクティブ run がない場合も、テスト作業を担う委譲先の
  書き込み先は `<testsDir>/**` の `spec.md`・`cases.md` とテストコード、`.codiel/reports/` に
  限られる)。

## 6. Skills(superpowers スタイルの自前スキル群)

すべて以下の superpowers 文法で記述する:

- frontmatter(`name` / `description`(発動条件を含む))
- **チェックリスト**(実行者はタスク化して順に消化)

越えてはならない一線は、その操作をする手順の中へ条件付きの 1 文として書く。`HARD-GATE` と `Red Flags` のセクションは持たない(理由は「HARD-GATE と Red Flags を廃止した理由」)。

プロセスフローチャート(dot 形式)は SKILL.md 本文には置かず、`docs/skill-flowcharts.md` に集約する。

### オーケストレーター用(メインセッションが読む)

| スキル | 内容 |
|---|---|
| `orchestrating-runs` | `/codiel:run` の本体プロセス。state 駆動のフェーズ進行(test-code フェーズを含む)、並列実装(dev-plan のステップを `codiel-state waves` で wave に分け、依存の無いステップを worktree で並列実装してから run ブランチへ順にマージする)の運転、サブエージェントのディスパッチ規約(担当スキル名・入出力パスを必ず含める・ARCHITECTURE のパスは review の委譲にだけ渡す・ドメインタグによる実装とレビューの委譲先の選択)、再開手順、ループ上限管理。本文はフェーズ別・共有の手順を `skills/orchestrating-runs/references/`(`phase-<フェーズ名>.md`・`delegation-env.md`・`review-common.md`・`e2e.md`・`resume.md`)へ切り出し、フェーズに入るときに読む。本文の規律:「オーケストレーターは自分で実装・レビューしない」「Raguel ゲートを省略して遷移しない」 |
| `capturing-intent` | intent フェーズの進行規約。TOBE の聞き取り、ASIS(現状調査)の突き合わせ、分岐の合意、ドラフト全文提示、承認ゲートでの規模・終え方・Issue 起票の決定、`docs/intents/` への保存までの手順。原文(`## ASIS`/`## TOBE`)はユーザーの言葉のまま記録し、要約・翻訳をしない |
| `raguel-gating` | Raguel 呼び出し規約。フェーズ→evaluate ツールの対応、objective の書き方、verdict 別ハンドリング(STOP は人が「誤検知として続ける」か「妥当として止める」かを裁定する)、findings の次フェーズへの引き継ぎ、record_outcome の運用(承認・却下・incident)。本文の規律:「PROCEED 確実だからスキップ」「前回 PROCEED だったから今回も不要」等 |
| `facilitating-design-discussions` | discuss フェーズの進行規約。論点の提示順序、AskUserQuestion と自由議論の使い分け、「すべて推奨案で進める」ショートカット、discussion.md の記録書式、design フェーズの設計ウォークスルー手順。本文の規律:「合意の捏造禁止」「アジェンダの改変禁止」 |

### フェーズ用(各サブエージェントが読む)

| スキル | 模倣元 | 内容 |
|---|---|---|
| `preparing-design-agendas` | (独自) | intent・既存コードから、ユーザーと合意すべき how(実現方法)の論点を抽出し agenda.md に構造化する。選択肢 2 つ以上+トレードオフ+推奨案。intent の `## 未確定事項` は全件論点化。what(達成すること・受け入れ基準)は intent で合意済みとして立てない。本文の規律:「不明点を agenda から落とさない」 |
| `writing-design-docs` | brainstorming(設計部) | intent + discussion.md + 持続層(意図的な制約)を入力に設計書を執筆。YAGNI、既存パターン踏襲、変更対象ファイルの明示、**影響を受ける機能単位(仕様のディレクトリの ID)の列挙**(新しい画面は決定 81 の名前の候補を書く)、代替案の検討記録 |
| `writing-test-specs` | (独自) | 仕様のディレクトリの同定・命名規則(§4)、`<testsDir>/<ID>/` の spec.md → cases.md の新規作成・**更新と再生成**の手順。実装詳細ではなく振る舞いをテストする。期待結果は受け入れ基準から導出する。新しい画面の名前の候補を出す(決定 81)。テストコードには触れない(test-code フェーズの `scripting-tests` が書く)。軽量な run では design.md の代わりに intent の `## 受け入れ基準` と持続層を入力にする。本文の規律:「書き込みは `<testsDir>/<ID>/` の spec.md と cases.md だけ」「テストコードに触れない」「Bash を使わない」 |
| `writing-dev-plans` | writing-plans | 設計書を工程分解した開発手順書。各ステップに「触るファイル・前提ステップ・内容・**通すテスト(仕様のディレクトリの ID)**・完了条件・検証コマンド・**ドメインタグ(frontend/backend/data)**」を書き、文書の先頭に `## 環境準備`(worktree での依存インストール)と `## 生成物`(ビルド生成物を方式 a/b のどちらで扱うか)を置く。オーケストレーターはこの手順書を `codiel-state waves` で wave に分割する。軽量な run では design.md の代わりに intent の `## 実装方針` と持続層を入力にする |
| `implementing` | executing-plans + test-driven-development | dev-plan の対象ステップの「通すテスト」(ユニットと E2E の両方。決定 80)を通す実装。依存の無いステップは worktree で並列に進み、環境の失敗は理由と出力の抜粋を報告に挙げ、報告は最終の返答で返す(`report.md` はオーケストレーターが書く)。手順逸脱の禁止、「ついでのリファクタ」禁止。3 ドメインの実装に共通の規律 + ドメイン別の注意事項と infra の観点(`skills/implementing/references/` に記載)。観点ファイルは、オーケストレーターが変更の中身から選んで依頼文に書く |
| `scripting-tests` | (独自) | test-code フェーズで、`cases.md` から実装より先にテストコード(ユニットと E2E)を書いて実行し、失敗すること(Red)を確かめる規約。置いたパスを `spec.md` の `tests` に記録する。期待結果が変わらず通ってしまったケースは「cases.md の誤り」として報告し、cases.md 自体は書き換えない。本文の規律:「Red を消すための実装の先取り・期待値の緩和の禁止」「`cases.md`・`spec.md` の本文・プロダクトコードを変更しない」 |
| `running-regression-tests` | verification-before-completion | 記録された全テスト(`<testsDir>/**/spec.md` の `tests`)とプロジェクトの test コマンドの回帰を確認し、判定(green/red/broken)を出す規約(§5)。テストを書く手順は持たない。NG の修正・broken の人への確認はオーケストレーターが担う。`/codiel:test` の単独実行にも使う。本文の規律:「出力を見ずに合格を主張しない」「broken と NG を混同しない」「単独実行では修正をディスパッチしない」 |
| `fixing-failures` | systematic-debugging | test-loop の NG 修正、fix-loop のレビュー所見修正を担う。根本原因特定→最小修正。**テストコード・`spec.md`・`cases.md` を触る修正の禁止**(所見がテストに向くときは `set-test-edit` の間だけ解除される)。「テストの方が間違っている」と思ったら ASK へ |
| `reviewing-diffs` | requesting-code-review | design.md・テスト仕様書・intent の原文(`## ASIS`/`## TOBE`)と `## 受け入れ基準` を基準に diff をレビュー。severity 定義(critical/high/medium/low、原文の要望の未達と持続層の制約違反は high)、github では `gh pr review` / `gh pr comment` での投稿(local では投稿しない)。観点(infra を含む)ごとのレビューに共通のプロセス(観点別の焦点は `skills/reviewing-diffs/references/` に記載)。軽量な run では design.md の代わりに intent と dev-plan.md を入力にする |
| `fixing-review-findings` | receiving-code-review | 指摘の技術的検証→妥当なら修正、不当なら根拠を添えて反論コメント。盲目的追従の禁止。対象は critical / high のみ(medium 以下は triage へ) |
| `syncing-intents` | (独自) | intent-sync フェーズの運転規約。承認済みの受け入れ基準の変更と、途中でユーザーが追記した原文を、人の確認つきで派生文のセクションへ反映する。持続層(`docs/intents/domains/`)の更新。本文の規律:「原文のセクションは書き換えない」「intent の `status` を `done` にしない(finalize だけが付ける)」 |
| `filing-followup-issues` | (独自) | triage フェーズの運転規約。medium / low 指摘の一覧提示の形式、ユーザーへの確認の取り方。github: Issue 本文の書式(指摘内容・severity・関連ファイル・元 PR へのリンク・ラベル付け)、既存 Issue との重複確認、**ISSUE_TEMPLATE の活用**(`.github/ISSUE_TEMPLATE/` の form 形式 .yml / markdown 形式 .md や `.github/ISSUE_TEMPLATE.md` を探索し、指摘の種類に最も合うテンプレートを選択、テンプレートがない場合のみ既定書式で起票)。local: `status: proposed` の intent 草案として `docs/intents/` に書く。本文の規律:「ユーザーの指示なしに起票しない」 |

### スキル本文に置かない根拠(退避)

各スキルが「なぜその規律が必要か」を述べていた記述を、指示から分離してここに残す。

- `preparing-design-agendas`: agenda に挙げた論点がそのままディスカッションの議題になり、合意結果(discussion.md)は design フェーズの設計を拘束する。論点を漏らすと、その分岐はユーザーに諮られないまま architect の独断で設計されることになる。
- `orchestrating-runs`(2026-10-02 まであった `references/failures.md` の失敗の記録): 当時は、Raguel の判例ストアを判定側の記憶、`docs/GOTCHAS.md` を生成側の記憶とし、GOTCHAS.md を全フェーズのサブエージェントが作業前に必読する共有資産とした。記録の判断・書式・採番・タグは metatron の `recording-gotchas` に委ね、codiel は記録の契機と、記録の手段が無いときの退避だけを持っていた。2026-09-27 までは codiel も同名のスキルで書式契約の写しを持っていたが、二重管理になるため削除した。K12 で契機と退避も外した(§9「ARCHITECTURE と GOTCHAS を codiel の指示層から外した理由(K12)」)。
- `writing-design-docs`: design.md で設計を誤ったり影響 unit を漏らすと、その誤りはテスト仕様書の漏れ・実装漏れとしてそのまま後続フェーズに伝播する。
- `capturing-intent`(言語の確認): intent 文書と issue 本文の言語が食い違うと、issue への転記に翻訳という加工が入り、原文をそのまま転記するという前提が崩れる。そのため、言語の確認を 1 回で取る。
- `preparing-design-agendas`(合意済み事項の再提示): 同じ分岐を二度議論させると、前回と違う結論が出ることがある。そうなると、intent 文書と discussion.md の内容が食い違う。
- `syncing-intents`: 追記された要望の反映先が誤っていても、書いた時点で派生文のセクションに残るので、確認前に書くと確認の意味が失われる。`## 変更履歴` は承認の経路を残す記録で、省くと後から変更の正当性を追えない。要約は派生文のセクションの役割で、`## ASIS` / `## TOBE` には手を入れない。矛盾の確認は `mark-ask --kind confirm` で取り、待たずに書き換えると確認の意味が失われる。参照形は ADR へ移した後の確定済みの形で、全文を書き戻すと ADR と持続層で正が二重になる。
- `fixing-review-findings`(修正の push): push は再レビューの diff に影響しない。guard-bash は fix-loop と test-loop が passed の条件で push を許可する。
- `implementing`: 期待値を書く委譲と直す委譲を分ける設計(§4)を、実装の側で崩さない。
- `writing-dev-plans`: `dev-plan.md` は implement が読む唯一の実行手順書である。`[domain: ...]` タグはディスパッチ先の決定と実装のドメイン規律の 2 箇所から機械的に参照される。タグを誤るか複数ドメインを 1 ステップに混ぜると、誤ったドメインの実装が呼ばれるか、hooks が正当な書き込みを ask で止める誤爆を招く。両者ともタグを機械的にしか読まないため、曖昧・複合のタグは下流のどこかで必ず事故になる。

### HARD-GATE と Red Flags を廃止した理由

2026-10-02 のコスト改修(設計書 `harness-docs/design/2026-10-02-codiel-run-cost-design.md` の K2)で、各スキルの `HARD-GATE` と `Red Flags` のセクションを廃止した。評価の担当とオーケストレーターは「HARD-GATE は縮めて残す」を推奨したが、採らなかった(ユーザーの決定)。

- 両セクションの条項の多くは、本文の手順と同じ内容を重ねて書いていた。run が開始から読むスキル本文の量が増え、毎ターンのキャッシュ読み出しが増える。
- 条項を削る前に、本文の手順に同じ内容があるかを 1 条項ずつ確かめた。本文に無い条項だけを、その操作をする手順の中へ条件付きの 1 文として移した。意味は変えていない。
- 直前の設計書 `2026-10-01-codiel-run-speedup-design.md` §5.4 が定めた、オーケストレーターが自分で書かない物(コード・spec.md / cases.md・レビューの所見)の規律は、`orchestrating-runs` の本文に残している。置き場を HARD-GATE から手順へ移しただけで、中身は同じである。
- 合理化への反論の表(Red Flags)は、反論が手順の条件と重なるので持たない。規律が弱まっていないかは、改修後の run の transcript で、オーケストレーターがコードや spec を自分で書いていないかを見て確かめる。
- `filing-followup-issues` の HARD-GATE が引いていた出典は、本書の §8 の PreToolUse(Bash)の行(`gh issue create` は triage でなければ deny)と、§2 の [triage](ユーザーに提示して指示を待つ。critical / high は fix-loop で修正し、triage へは持ち越さない)に書いてある。

## 7. Agents(同梱しない。作業内容で委譲する)

Codiel は Agent 定義を同梱しない。intent フェーズはオーケストレーター本体が対話を担い
(現状調査は読み取りだけの委譲)、その他のフェーズは、固定した Agent 名ではなく
「成果物を書く委譲」「読み取りだけの委譲」などの作業内容をディスパッチプロンプトに渡して委譲する。
委譲先の選択はセッションに注入された運用規律に委ね、規律が無い場合は成果物を書く作業を
`general-purpose`、読み取りだけの作業を `Explore` に縮退する。
ドメインの境界(どのパスが frontend/backend/data か)は ARCHITECTURE.md の**ドメインマップ**(§9)で
宣言し、hooks が書き込み制御に使う。

以前は frontmatter の `tools` で権限を最小化した Agent を同梱し、「できないことは暴走もできない」を
原則としていた。ADR-004(2026-09-23)で同梱を 2 体に絞り、intent 駆動化(2026-09-27)で残る
`codiel-analyst`(init フェーズの廃止に伴い削除)と `codiel-test-designer` も撤去した。
test-designer の「Bash を持たず、テスト仕様のディレクトリの spec.md と cases.md だけを書く」という
権限は、test-spec の依頼文の tools 限定条項と `writing-test-specs` 本文の規律が代わりに担う。
成果物をオーケストレーターがコミットする責務の分配は、「Bash を持たない」ではなく
「文書系フェーズの委譲先は git 操作をしない」という規約を根拠にする。

### MCP ツールの付与方針

Context7 はすべての委譲先に付与する。GitHub は読み取り系ツールだけを列挙して付与する。
guard-bash hooks の matcher は Bash のみであり、GitHub MCP の書き込みツールは state ゲートを迂回するため、
サーバー単位では許可しない。Playwright はテスト・実装・レビューの作業を受ける委譲先に必要に応じて付与する。
どの委譲先に MCP を付与するかは、委譲先の定義側で判断する。未接続の MCP エントリは他に解決する
ツールがあるため無視されるだけで、未接続環境でも動作に支障はない。

### 作業内容による委譲

作業内容で委譲するフェーズでは、依頼文に作業内容、読み込むスキルと観点ファイル、入出力、
実行モード、ドメイン境界、必要な tools の限定条項を含める。実装・テストのドメイン別注意事項は
`skills/implementing/references/{frontend,backend,data,infra}.md` に置く。`infra` は、IaC・
Kubernetes のマニフェスト・Dockerfile・CI の定義など、インフラをコードで管理する変更に当てる。
レビューの観点別の焦点は
`skills/reviewing-diffs/` の「観点別の焦点」セクションと
`skills/reviewing-diffs/references/{frontend,backend,data,doc,security,generic,infra}.md` に置く。

| 委譲の種別 | 主な作業 | 担保する境界 |
|---|---|---|
| 成果物を書く委譲 | アジェンダ・設計書・テスト仕様・開発計画、実装・テストスクリプト・修正 | 依頼文の tools 限定条項、hooks、各作業スキルの本文の規律 |
| 読み取りだけの委譲 | diff のレビュー、調査、再レビュー | 読み取り系 tools のみ、`reviewing-diffs` 本文の規律 |

実装・テストの委譲では、開発手順書のドメインタグとディスパッチプロンプトで渡すドメインマップに
従う。`mapped` では担当範囲外を書き込まず、`unscoped` ではドメイン境界を設けない。
ドメインを跨ぐステップは、開発手順書の段階でドメイン単位に分割することを
`writing-dev-plans` が要求する。

この分離により、テストの期待値を変更する委譲先が実装を修正して自己承認することや、
レビューを担う委譲先が自分でコードを修正して自己承認することを防ぐ。担保するのは固定した
Agent 名ではなく、依頼文の tools 限定条項、各作業スキル本文の規律、hooks による境界制御である。

## 8. Hooks(決定論的な外壁)

Raguel が「成果物」を検査するのに対し、hooks は「行動」を検査する。相補的な二層防御。
`hooks/hooks.json` + 同梱スクリプト(node)で実装する。

| フック | 対象 | 内容 |
|---|---|---|
| PreToolUse | Bash(`gh pr create`, `git push` 等の投稿系コマンド) | state.json を参照し、「テスト green + implement/test-loop が passed(PROCEED または human-approved の ASK)」でなければ **deny**。保護ブランチ(main 等)への push は常に deny。`gh issue create`・`gh pr create`・`gh pr comment`・`gh issue comment`・`gh pr edit`・`gh issue edit`・`gh pr review`・`gh api` の本文を持つ呼び出しに、本文へ `<!-- codiel:generated -->` マーカーを含むことを求める(active run が無ければ通す)。`--fill` 系・`-T`/`--template`・`--web`/`-w` を持つ呼び出しは、本文が検査できないため deny。`gh issue create` はアクティブ run の現在フェーズが **triage でなければ deny**(ユーザーの指示なき起票の防止)。追補(決定 96・99): push の拒否の理由文は「push は pr・fix-loop・triage・finalize のフェーズで、test-loop の合格の後にだけ実行できます(現在: <フェーズ>)」の形にし、`gh api` の本文に `@` で始まる `-f` の値があるときは、マーカー欠落の理由文に「`-f` は値をそのまま送る。ファイルの中身を本文にするには `-F body=@<パス>` を使う」旨を添える(deny の判定は変えない) |
| PreToolUse | Bash(危険コマンド) | `rm -rf`(作業ツリー外)、`curl \| sh`、`git push --force` 等を deny。Raguel の `code/dangerous-patterns` はコード成果物を見るが、こちらは実行コマンドそのものを見る。追補(決定 96): state.json へのシェル経由の書き込みも deny する。対象は、クォートの外のリダイレクトの行き先と、同じコマンドの区切りの中の `tee`・`sed -i` の引数が state.json のパスのとき。コミットの trailer の `>` から後ろのコマンドのパスへ誤って当たらないよう、判定を区切りの中に限る |
| PreToolUse | GitHub MCP の本文を書き込むツール(`issue_write`・`create_pull_request` 等。新設 `guard-github-mcp`) | 本文の引数(`body`)に `<!-- codiel:generated -->` マーカーが無ければ **deny**(active run が無ければ通す)。guard-bash と同じマーカーの規律を GitHub MCP 経由の投稿にも及ぼす |
| PreToolUse | Edit / Write(`.codiel/runs/**/state.json`) | **deny**。state 遷移は `codiel-state` スクリプト経由のみ(§3)。Bash からの書き込みの判定は Bash の行に書く |
| PreToolUse | Edit / Write(フェーズ別書き込み制御) | アクティブ run の現在フェーズを参照し、フェーズと不整合な書き込みを **ask**(人間に確認)。例: 文書フェーズ(intent/discuss/design/test-spec/dev-plan/intent-sync)中の `src/**` への書き込み、コードフェーズ(**test-code**/implement/test-loop/fix-loop)のうち implement・test-loop・fix-loop 中の `<testsDir>/**` の spec.md / cases.md(期待値)と、`spec.md` の `tests` に記録されたテストコードへの書き込み(test-spec と test-code は通す。fix-loop は `set-test-edit` を立てている間だけ通す。§4)。deny にしない(ask)のは、正当な例外書き込みでの誤爆に備えるため。worktree(`.codiel/worktrees/<slug>/<名前>`)の中への書き込みは、そのメインの作業ツリーと worktree のルートを基準に同じ規則を当てる。**ドメイン単位の制御は、worktree の中では `step-add --domain` で記録した値、メインの作業ツリーでは state.json の `domain`(`codiel-state` の `set-domain` / `clear-domain` で設定・解除する)を根拠に行う** — hooks はツール呼び出しの発行元エージェントを識別できないため、エージェント名ではなく**宣言された domain** を境界の根拠にする。コードフェーズ中に `domain` が決まるとき、ARCHITECTURE のドメインマップにあるそのドメインの glob に一致しない書き込みは **ask**(ドメイン名がマップに無いときも ask)。`domain` が無いとき・ドメインマップが読めないときは境界を課さない。追補(決定 106。K12 で退避先 `unrecorded-gotchas.md` の免除を外した): 判定の順序は state.json の deny → active run → `state.intent`(どのフェーズでも通す)→ config.json を 1 回読む(不正なら「読めない」として扱う)→ `docs/intents/**` → 文書フェーズ(`.codiel/`・`docs/`・`<testsDir>/`・`<runsDir>/` を通す)→ コード系フェーズ(テストの保護 → `<runsDir>/` の下への書き込みは実行モードと `domain` によらず ask → ドメイン境界。境界から `<testsDir>/**/reports/**` の E2E のレポートを免除する)→ pr・review・triage・finalize(`.codiel/` の外は ask。変更なし)。config.json が不正なときは、コード系フェーズの書き込みに ask を返し、文書フェーズの `<testsDir>/`・`<runsDir>/` の免除を外す。理由文は「run の文書(<パス>)は文書フェーズで書きます(<フェーズ> 中の変更は想定外)」と、「.codiel/config.json が不正なため、<フェーズ> 中の書き込みが run の文書(runsDir)に当たるか判定できません(<理由>)」である |
| Stop | メインセッション | アクティブ run が `completed` / `stopped` / `awaiting_human` / `awaiting_outcome` 以外の状態で停止しようとしたら block し「run が未完了。継続するか、明示的に中止せよ」と通知(尻切れ完了宣言の防止)。委譲は常にバックグラウンドで動くので、待ちが 1 件以上記録されている間は止めずに通す。待ちが無く `in_progress` のときは、委譲の完了を待つなら `codiel-state wait-add` で待ちを記録してから停止するよう案内する(設計書 2026-10-01-codiel-run-speedup-design.md §10.2) |

投稿の本文のマーカーは、スキルの規律で付け、hook で強制する。付け忘れた投稿は deny され、付けて投稿し直す。run が active なセッションの本文は、人のアカウントから投稿されても AI が生成した文として扱い、読む側は原文から除ける。intent の承認時の任意の起票は run の作成前なので hook は掛からないが、規律でマーカーを付ける。

dev-plan のドメインも同じ考え方である。hooks はエージェント個体を識別できないので、`[domain: ...]` タグが決める担当ドメインの規律は、委譲先自身の規律で担保する。

## 9. docs(プロジェクト毎に成長するハーネス資産)

対象プロジェクトに配置するハーネス資産。`/codiel:init`(`initializing-harness` スキル)が
初期化する: `.codiel/` 配下のディレクトリは同スキルが呼ぶ `scripts/install-harness.sh` が
機械的に配置し(`.codiel/config.json` は無ければ既定の 2 つのキーで作る)、Raguel の設定は聞き取り(保護パス)の
回答から `.codiel/config.json` の `raguel` へ書く。以前の版の YAML の設定が残っていれば、承認を得て
`raguel` へ移し、承認を得て消す。`.gitignore` には `codiel-state gitignore` の `missing` の行を、差分を示して
承認を得てから足す。運用の規律は
`assets/rules/codiel.md` を固定文言のまま `.claude/rules/codiel.md` に置き、CLAUDE.md には
`CLAUDE.example.md` の「## Codiel」セクションをそのまま追記する(既存ファイルは不足分のみ追記。
旧セクション「## Codiel ハーネス運用ルール」があれば承認を得て取り除く)。
ARCHITECTURE は `/codiel:init` の対象ではない。ドメインマップの生成は metatron が行う。codiel は
ドメインマップを作らない。
GOTCHAS は `/codiel:init` の対象ではない。台帳の生成は metatron が行う。記録時に台帳が無ければ `append-gotcha` が台帳ごと作る。codiel は台帳を作らない。
`/codiel:run` は資産配置を行わず、B + C + D が揃っていることを初期化済みと判定する。B は `.claude/rules/codiel.md` が存在し、かつ `CLAUDE.md` に行全体が(前後の空白を除き)`## Codiel` と一致する行があること。C は `.codiel/config.json` が JSON のオブジェクトとして読め、`raguel` がオブジェクトであること(空のオブジェクトでよい)。D は `.codiel/runs` / `.codiel/reports` の 2 ディレクトリが存在し、`codiel-state gitignore` の `missing` が空であること。C と D は `/codiel:run` と `/codiel:init` で同じ条件にする。テストの仕様の置き場と run の文書の置き場(`testsDir`・`runsDir`)は、キーが無くても既定値(`docs/codiel/tests`・`docs/codiel/runs`)で動くため、C の判定には含めない。いずれかが揃っていないときは未初期化として、欠けた項目を名指しして `/codiel:init` を案内して終了する。以前の版で初期化したプロジェクトは C と D を満たさないので、`/codiel:init` をやり直す(§3)。

以下 2 節の見出しは既定パスであり、`metatron.config.json` で変更されうる。
本節が記す ARCHITECTURE の節構成と GOTCHAS のエントリ書式は執筆当時の設計であり、
現行の正本はファイル契約(`harness-docs/design/2026-08-16-file-contract-freeze.md` §4・§7)である。
**以下の列挙は当時の決定の記録として残す。現在の仕様として参照しない** ——
節構成は契約 §4-1 の 7 節に、GOTCHAS のエントリ書式は契約 §7 の新書式に置き換わっている。

### ARCHITECTURE(既定 `docs/ARCHITECTURE.md`)

プロジェクトの技術的前提を宣言する。**Codiel はこれがないと run を開始しない**(フェイルクローズド)。

執筆当時は次の 8 項目を置くと決めた(**現行の節構成は契約 §4-1 が正本**)。

- 技術スタック(言語・フレームワーク・主要ライブラリとバージョン方針)
- ディレクトリ構成と各領域の責務
- **ドメインマップ**: frontend / backend / data それぞれのパス glob。
  実装とレビューの委譲先の選択と hooks の書き込み制御(§8)の基準になる。
  ドメイン分割が馴染まないプロジェクトは `generic` 1 つに縮退でき、その場合
  実装もレビューも汎用 1 体構成で動く
- **コマンド定義**: test / lint / build / typecheck の実行コマンド
  (テストスクリプトの作成とオーケストレーターの検証はここを読む)
- **テスト方針**: E2E フレームワーク(Playwright 等)と実行方法、
  ユニットテストの要否・フレームワーク・配置規約(実装の TDD はこの宣言に従う)
- 保護パス(`.codiel/config.json` の `raguel` の `code/protected-paths` と整合させる)
- コーディング規約・ブランチ/PR 規約(命名・ベースブランチ)・Definition of Done

このうち**ドメインマップの役割**(実装とレビューの委譲先の選択と hooks の書き込み制御の基準、
`generic` への縮退)は現在も生きている判断である。ブロックの記法(マーカー名を含む)は
契約 §1 が正本であり、`codiel:domains` から `metatron:domains` へ変わっている。

### GOTCHAS(既定 `docs/GOTCHAS.md`)

プロジェクト固有の落とし穴台帳。**失敗を記録してプラグインをプロジェクト毎に成長させる仕組み**の生成側。

- エントリ書式: 執筆当時は 日付 / 発生フェーズ / 症状 / 根本原因 / 予防策 / 関連ファイル と決めた。
  **この旧書式は廃止され、互換読みも設けない**(契約 §6)。現行の書式・挿入位置・採番・タグは
  契約 §6-1〜§6-4 が正本である
- 記録の契機(執筆当時): Raguel STOP、ループ上限超過、record_outcome(incident)、レビューで発覚した設計漏れ
- 執筆当時は、全フェーズのサブエージェントが作業前に必読とした(ディスパッチプロンプトで強制)
- 執筆当時は、Raguel の判例ストア(判定側の記憶)と GOTCHAS(生成側の記憶)で両輪の成長ループを構成するとした

2026-09-27 から 2026-10-02 までは、codiel が上の契機で metatron の `recording-gotchas` を起動し、CLI の案内が無い環境では「未記録の GOTCHAS」を `<runsDir>/<slug>/unrecorded-gotchas.md`(run が無いときは `.codiel/reports/unrecorded-gotchas.md`)へ退避していた(`orchestrating-runs` の `references/failures.md`)。K12 でこの手順と必読の規律を外した。理由は次の「ARCHITECTURE と GOTCHAS を codiel の指示層から外した理由(K12)」に書く。guard-write の退避先の免除(§8)も外した。

### ARCHITECTURE と GOTCHAS を codiel の指示層から外した理由(K12)

K12 は 2026-10-02 のユーザー決定で、正本は設計書 `harness-docs/design/2026-10-02-codiel-run-cost-design.md` にある。この決定で、codiel の指示層(`skills/`・`references/`・`commands/`)から 2 種類の規則を外した。1 つは ARCHITECTURE と GOTCHAS を読ませる規則で、もう 1 つはそれらに書き込ませる規則である。対象はオーケストレーターと委譲先の両方である。

- ARCHITECTURE と GOTCHAS は metatron の資産である。読み方・書き方・更新の契機は metatron が SessionStart の注入と `.claude/rules/metatron/` で伝える。codiel が別に規則を持つと、同じ資産の扱いが 2 か所に分かれ、食い違ったときにどちらに従うかが決まらない。
- 失敗の台帳への追記は metatron の担当になる。codiel は契機の判定・記録・退避の手順を持たない。

残したのは次の 2 つだけである。

1. §0 のドメインマップの抽出。`mapped` / `unscoped` の判定と guard-write の境界に使う。抽出のために ARCHITECTURE のパスを解決する手順は、この目的に限って残す。`knowledgeTarget` の判定では ARCHITECTURE の有無だけを使い、読まない。
2. review の委譲に ARCHITECTURE のパスを渡すこと。`reviewing-diffs/references/doc.md` の観点が、ARCHITECTURE と実装の乖離を見るためである。依頼文テンプレートの「前提」の ARCHITECTURE の行は、review と再レビューの委譲のときだけ書く。

外した規則は、各フェーズの入力列の ARCHITECTURE・GOTCHAS、`implementing`・`writing-design-docs`・`preparing-design-agendas`・`writing-dev-plans`・`capturing-intent` の読む規則、finalize の乖離の一覧化、`references/failures.md` とそれを指す参照(Raguel の STOP・誤検知の退避・incident・fix-loop の設計漏れ)である。

### `.claude/rules/codiel.md`(← `assets/rules/codiel.md`)

Codiel ハーネスを適切に運用するための決まり。ARCHITECTURE と GOTCHAS は metatron の資産であり、
codiel はこの 2 つに触れないので、rules にも書かない。metatron が有る環境では、これらの
存在と扱い方は SessionStart の注入と `.claude/rules/metatron/` を通して伝わる。

文書の扱い:

- intent 文書(`docs/intents/`)の原文のセクション(`## ASIS` / `## TOBE`)はユーザーの言葉のまま
  にし、要約・書き換えをせず、日付・話者・出所つきで末尾に追記する
- 持続層(`docs/intents/domains/`)を書き換えるのは intent-sync フェーズだけにし、`[ADR 候補]`
  の印が付いたエントリを参照形へ縮める作業も intent-sync フェーズの外で行う
- テスト仕様書(`<testsDir>/`)は機能の一部。機能を変えたら仕様書とケースも更新する

規則:

- run から渡された前提を使う
- `.codiel/runs/**/state.json` を直接編集しない(codiel-state 経由のみ)
- Raguel ゲートは省略しない。ASK / STOP には従う
- PROCEED した変更が原因で実害(障害・リグレッション)が出たら、必ず incident として申告し
  `record_outcome(incident)` を記録させる(自動検知できない唯一の結末であり、最も価値の高い失敗判例)

ARCHITECTURE / GOTCHAS を読む規律と、失敗を記録する手順は、codiel のどこにも置かない(K12)。
`orchestrating-runs` に残るのは、§0 のドメインマップの抽出と、review の委譲へ ARCHITECTURE のパスを渡す
依頼文テンプレートの行だけである。

### CLAUDE.md の `## Codiel`(← `CLAUDE.example.md`)

CLAUDE.md はセッションの最初にだけ読まれるので、規律の全文ではなく置き場の地図と入口の
コマンドだけを置く。intent 文書・持続層・run の状態・テスト仕様書・保護パスの置き場と、
`/codiel:run`・`/codiel:init`・`/codiel:test` の入口を示す(固定文言は `CLAUDE.example.md` の
「## Codiel」セクションを参照)。

## 10. ディレクトリ構成(プラグイン側)

```
plugins/codiel/
  .claude-plugin/plugin.json
  assets/
    rules/codiel.md             # `/codiel:init` が `.claude/rules/codiel.md` へ置く雛形(決定 70)
  commands/
    init.md                    # /codiel:init(薄い入口。initializing-harness を起動)
    run.md                     # /codiel:run [<Issue番号> | <intentパス>](薄い入口。orchestrating-runs を起動)
    test.md                    # /codiel:test [パス](testsDir からの相対パス。省略時は全体)
  skills/
    initializing-harness/SKILL.md(+ config.example.json)
    orchestrating-runs/SKILL.md
    raguel-gating/SKILL.md
    capturing-intent/SKILL.md
    facilitating-design-discussions/SKILL.md
    preparing-design-agendas/SKILL.md
    writing-design-docs/SKILL.md
    writing-test-specs/SKILL.md
    writing-dev-plans/SKILL.md
    implementing/SKILL.md
    scripting-tests/SKILL.md
    running-regression-tests/SKILL.md
    fixing-failures/SKILL.md
    reviewing-diffs/SKILL.md
    fixing-review-findings/SKILL.md
    syncing-intents/SKILL.md
    filing-followup-issues/SKILL.md
  references/
    intent-format.md          # 変更 intent と持続層の書式(§6.3、§6.4)
    intent-writing.md         # intent 文書・持続層の執筆規則(§6.12.2)
    github-writing.md         # Issue・PR・コメント・レビュー本文の執筆規則(§6.12.3)
    github-writing-images.md  # 画像の載せ方と縮退の順序(§6.12.4)
    github-writing-pr.md      # PR 本文の書式
    handoff-contract.md       # gh-utility issue-craft への持ち込みモードの契約
    intent-common.md          # 経路選択・畳む経路の共通規律
    e2e-report-format.md      # E2E のレポート(summary.md・failure.md)の書式と、委譲先が返答に入れる項目(§3)
  hooks/
    hooks.json
    scripts/                  # フックスクリプト(node)
  scripts/
    codiel-state.mjs          # state 遷移の検証つき CLI(§3)
    check-intent-env.mjs      # 前提確認・連携モード判定に使う環境判定スクリプト
    install-harness.sh        # .codiel/ 配下のディレクトリを機械的に配置(initializing-harness から呼ばれる)
  docs/
    DESIGN.md                 # 本書
    format-change-checklist.md
  CLAUDE.example.md
  raguel-mcp/                 # 実装済み
```

## 11. 実装マイルストーン(案)

1. **M1 基盤**: `codiel-state` スクリプト(state 遷移検証)+ hooks 一式 + docs 3 点セットの example + install-harness.sh
2. **M2 骨格**: `/codiel:run` コマンド + `orchestrating-runs` / `raguel-gating` スキル + 文書系フェーズ(intent〜dev-plan)のスキル・エージェント
3. **M3 実装系**: implementer 3 体 + `implementing` スキル + implement フェーズの Raguel ゲート統合
4. **M4 テスト系**: テスト資産モデル(specs/)+ tester + `scripting-tests` / `running-regression-tests` / `fixing-failures` + `/codiel:test` コマンド
5. **M5 レビュー系**: PR 作成 + reviewer 5 体 + `reviewing-diffs` / `fixing-review-findings` + fix-loop + triage(`filing-followup-issues`)
6. **M6 成長機構**: `recording-gotchas` + outcome 自動同期 + try 再挑戦フロー

## 12. capturing-intent の設計根拠(旧 sandalphon から統合)

このセクションは、旧 `sandalphon` プラグインの `docs/rationale.md` にあった設計根拠を統合したものである。
`sandalphon` の `capturing-intent` スキルは codiel の同名スキルへ移り、`bridging-execution` と
`executing-intent` は廃止された(移設の全体は
`harness-docs/design/2026-09-27-codiel-intent-driven-design.md` §7.1 が正本)。
以下は sandalphon が独立したプラグインだった時点で固まった判断の記録であり、経緯として残す。
現在の codiel の挙動を知りたいときは、このセクションではなく本書の他のセクションと実装を見る。

### 承認ゲートを 2 点に絞った基準

ゲートは「取り消しコストが跳ね上がる直前」だけに置く。この基準に照らすと 2 点になる。

- **ゲート 1(intent 文書)**: ここを誤ると以降のすべてが誤る。単一の最重要ゲートである。
- **ゲート 2(テスト仕様)**: 自前実行での「完了の定義」を固定する箇所であり、ここを過ぎるとコードが書かれる。

ゲート 2 以降(TDD 実装 → ドキュメント更新 → 報告)を自律実行にしたのは、テスト仕様が承認済みなら
実装は仕様への追従作業であり、そこに人間の判断を挟んでも情報が増えないためである。

数え方の注意として、issue の起票はゲートではない。起票は外部公開行為であり、ゲートの数え方
(フェーズを進めてよいかの判断点)とは別に、常に全文提示と明示承認を要する。両者を同じ枠で数えると
「ゲートを減らす」議論が起票の承認を巻き込み、「gh が無いから承認を省く」ような縮退が入り込む。
経路の選択はグレースフルデグラデーション、承認はフェイルクローズドという 2 分割はここに由来する。

### 状態の永続化・中断再開機構を持たない理由

Codiel の `.codiel/` state 機構は、10 個以上のフェーズとゲートを持つ長い run の長さに見合うコストである。
sandalphon の自前実行はワンセッションで終わる軽量フローであり、ここに state 機構を持ち込むと、
sandalphon は「小さい Codiel」に育つ。state を持てば状態遷移の検証・不整合の修復・再開時の整合確認が
順に必要になり、それらはいずれも intent を固定するという本来の価値に寄与しない。

再開は intent 文書という成果物を入力に、別セッションでやり直す形で足りる。
旧 `/sandalphon:run <intent 文書のパス>` を渡せば、Phase 1 は既存文書を読み込んだ状態から始まった。
intent 文書は承認済みの合意そのものであり、セッションの中間状態より価値が高く、寿命も長い。

再開の粒度はフェーズ単位であり、中間状態は表現しない。Phase 2 の途中(起票の一部だけ完了)や
Phase 3 の途中(3 件中 1 件だけ実装済み)は復元されない。これは state を持たないという決定の直接の帰結である。
中間状態の復元が必要な規模の作業は、そもそも Codiel 委譲が適する。

### プラグインの導入有無をスクリプトで検出しない理由

Claude Code のプラグイン導入状態は `~/.claude/plugins/installed_plugins.json` に記録されるが、
これは内部形式であり公開された契約ではない。形式が変わればこの検出は壊れる。

さらに、同ファイルはキーが `plugin@marketplace` 形式かつ `projectPath` スコープ付きであり、
`--plugin-dir` による直接指定や設定側の有効/無効(`enabledPlugins`)は反映されない。
「ファイルに載っている」と「そのセッションで使える」は同じ意味にならない。

知りたい情報は「導入されているか」ではなく「このセッションで実際に呼べるか」であり、
それを正確に知っているのはモデル自身である。検出は二段構えにする。

- **呼べるか**(プラグイン・MCP): スキル本文で「自分の利用可能なスキル・コマンド・ツールの一覧を確認する」と
  指示する。Raguel MCP の可用性(`mcp__plugin_codiel_raguel__*` の有無)も同じ手法で確かめる。
- **対象プロジェクトが受け入れ可能か**: これはファイルシステムの事実なので `check-intent-env.mjs` が決定的に返す。

### ハーネス検出を単一条件にした理由

`codielHandoffCandidate` は `.codiel/` の存在だけで判定していた。環境スクリプトの責務は、Codiel の器を
委譲先の候補として検出した事実を返すことにあり、実行可否の判定は Codiel の preflight が担う。

Codiel は ARCHITECTURE のドメイン定義を読めないときも、`unscoped` モードで汎用担当へディスパッチできる。
そのため `projectDocs.domainsReadable: false` は、委譲が必ず失敗することを意味しない。
ドメイン定義の可読性を委譲候補の条件に含めると、Codiel が受け入れられる正当な委譲経路まで塞ぐ。
`codielHandoffCandidate` と `codielHarness.dirExists` の同値は、委譲判断用の事実と生の検出事実を分けるために残していた。

文書と Codiel 固有資産をフィールドとして分けたのも同じ理由による。ARCHITECTURE / GOTCHAS は Codiel 専属の
資産ではなく、metatron が管理し Codiel 単体環境でも最小構成が存在しうるプロジェクトの文書である。
`codielHarness` に文書の可読性を混ぜると、metatron だけを使う環境で「Codiel のハーネス」という名前の
フィールドが文書の有無を語ることになる。

記法の変更に対しては安全側に倒す設計だった。ドメイン定義ブロックの記法が変わったときに壊れるのは
`domainsReadable` の判定だけで、`dirExists` は残るため、誤って「初期化済み」と判定する側には倒れない。

`codielHandoffCandidate`・`codielHarness`・`testRunner` の 3 フィールドは、本改修で codiel の
`check-intent-env` から削った(`harness-docs/design/2026-09-27-codiel-intent-driven-design.md` §6.9.3)。
capturing-intent はもう Codiel への委譲可否を自分で判定しない。ここに残すのは、なぜ当時この形にしたかの記録である。

### 不採用案

#### フェーズ別コマンドに分ける案

`/sandalphon:capture` `/sandalphon:bridge` `/sandalphon:execute` の 3 コマンドに分ける案。
途中フェーズだけを単独で回せる利点があるが、フェーズ間の受け渡し(どの intent 文書か、環境検出の結果、
経路の決定)をユーザーが引数で指定することになり、事実上の状態管理をユーザーへ押しつける。
状態永続機構を持たないという決定とも噛み合わない。初めて使うユーザーが「どのコマンドから始めるのか」を
判断できない点も大きい。途中からの再開は `/sandalphon:run <intent 文書のパス>` で吸収していた。

#### 自動発火スキルのみの案

コマンドを持たず、「〜したい」という発話を description で捕まえて自動発火するスキル群にする案。
誤発火のコストが非対称に大きい。軽い修正を頼んだだけでヒアリングと ASIS 探索が始まれば明確な妨害になる。
承認ゲートを持つ重いフローは明示発動に限るのがリポジトリ内の既存判断(issue 系 3 スキルはいずれも
「明示的な依頼があったときのみ使い、自律的には発動しない」と description に明記している)と整合する。
ただし各スキルの description には「intent 駆動で進めたい」「ASIS と TOBE を整理して」という明示的な依頼を
捕まえる記述を含めていた。

#### ゲートを 1 点に絞る案

ゲート 1 のみとし、テスト仕様も自律で進める案。intent 文書の受け入れ基準は「何が達成されればよいか」を
定めるが、「何をもってそれを確認するか」までは定めない。両者の間には解釈の幅があり、そこがずれたまま
実装まで走ると、テストが通っているのに intent が満たされていないという結果になる。
ゲート 2 はこの解釈を固定する 1 手番であり、費用対効果が最も高い位置にある。
ゲート 2 は一覧を見て承認するだけの軽い手番であり、対話を伴うゲート 1 と手番の重さが同じでないため、
単純な個数比較で判断しない。

#### 全体スナップショット ASIS 案

初回実行時にプロジェクト全体を探索し、`docs/ASIS.md` のような全体像を生成して以後キャッシュする案。
生成コストが intent 1 件の価値に対して大きすぎること、生成直後から陳腐化し更新の仕組みを持たない
キャッシュは誤情報の供給源になること、全体像を持つ文書は ARCHITECTURE として metatron が既に担当しており
役割が重複することの 3 点で採らなかった。代わりに `check-intent-env.mjs` の `contextDocs` で既存文書を検出し、
人間が書いた要約を優先して読む。AI が生成したスナップショットより安く正確である。

#### intent 文書を持たず issue だけを成果物にする案

GitHub リポジトリを持たないプロジェクトで何も残らない。またゲート 1 の承認対象が「起票前の下書き」になり、
承認済みの内容が手元に残らないため、起票に失敗した瞬間に合意が消える。
文書を一次成果物、issue を派生物とする設計はこの問題を持たない。

#### Codiel の内部スキルを直接起動する案

`orchestrating-runs` スキルを Skill ツールで直接起動する案。3 点の理由で採らなかった。

1. 別プラグインの内部スキル名に結合すると、Codiel 側のリファクタで sandalphon が壊れる。
   コマンド名は利用者向けの公開インタフェースであり、内部スキル名より安定している。
2. Codiel の run は長く独自のゲートを 10 個以上持つ。sandalphon のセッションに抱え込むと、
   Phase 1 のヒアリング履歴と Codiel の全フェーズが同一コンテキストに積み上がる。
3. `/codiel:run` は未初期化時に `/codiel:init` を案内して止まるフェイルクローズド設計であり、その入口を迂回すべきでない。
