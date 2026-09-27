# Codiel オーケストレーター設計書

ユーザーの要望を聞き取って固定した intent 文書を起点に、discuss → design → テスト仕様 → 開発計画 →
実装 → 回帰テスト → intent-sync → PR → レビュー → 修正を一気通貫で行うオーケストレーターと、
それを支える skills / hooks / docs の設計。起点は GitHub Issue に限らず、Issue 番号・
確定済み intent 文書のパス・省略のいずれからも始められる(§2)。

各フェーズの進行には **Raguel MCP のゲートを逐一挟み**、AI の暴走(フェーズ飛ばし・偽装グリーン・
自己承認・無限修正ループ)を構造的に抑止するハーネスエンジニアリングを行う。

- スキルの記述様式は superpowers を模倣する(チェックリスト・プロセスフローチャート・Red Flags 表・HARD-GATE)。
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
| 実行モデル | メインセッション=オーケストレーター。各フェーズは専用サブエージェント(fresh コンテキスト・ツール制限付き)が実行 |
| テスト仕様書 | run 使い捨てではなく**機能単位の永続資産**。機能更新時に仕様書を更新しテストケースを再生成する |
| テスト体系 | 仕様書駆動テストは **Playwright 等の E2E**。ユニットテストは別レイヤーで、implementer が ARCHITECTURE.md のテスト方針宣言に従い TDD の中で作成する |
| implementer | frontend / backend / data のドメイン別 3 体 |
| reviewer | frontend / backend / data / doc / security の 5 体 |
| ドメイン縮退 | ドメイン分割が馴染まないプロジェクトは、ドメインマップを `generic` 1 つに縮退させ、implementer / reviewer も汎用 1 体で回す |
| runId / 再挑戦 | runId は intent フェーズで決めた **slug**(英小文字ケバブケース)。その下に **try 毎のフォルダ**(`try-<n>/`)を切り、同一 run の再挑戦を管理する |
| record_outcome | **マージ検知を自動化**: codiel コマンド起動時に未確定 run の PR 状態を gh で走査し自動記録。incident のみ人間の明示申告 |
| 役割別書き込み制御 | hooks の判定は deny ではなく **ask**(誤爆に備える)。hooks が機械的に制御するのはフェーズ単位まで(エージェント個体を識別できないため)。ドメイン単位の規律はエージェント定義とレビューで担保 |
| 設計ディスカッション | 常に実施・アジェンダ駆動型(論点抽出=architect、進行と記録=オーケストレーター、決定=ユーザー)。discuss は非 GATED、ウォークスルーは design フェーズ内。詳細は `harness-docs/superpowers/specs/2026-07-10-codiel-discuss-phase-design.md` |

## 2. 全体フロー(フェーズと Raguel ゲート)

コード上の `STAGES`(正本 `plugins/codiel/src/codiel-state.ts`)は次の 12 ステージである。

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
[discuss]      architect が論点リスト agenda.md を作成(選択肢・トレードオフ・推奨案。
               intent の不明点は全件論点化)→ オーケストレーターがユーザーとディスカッション
               (「すべて推奨案で進める」ショートカットあり)→ 合意を discussion.md に記録する
               (軽量な run では skip)
               ▶ Raguel ゲートなし(合意の検査は design の evaluate_design が担う)
   ▼
[design]       設計書 design.md を執筆(軽量な run では skip し、intent と持続層を直接使う)。
               執筆後、オーケストレーターが要点をユーザーに提示するウォークスルーを行い、
               承認後に evaluate_design。
               ▶ Raguel: evaluate_design
   ▼
[test-spec ∥ dev-plan]  並列実行:
               (a) test-spec: 影響を受ける機能単位ごとにテスト仕様書を新規作成 or 更新し、
                   続けてテストケースを(再)生成する(§4)
               (b) dev-plan: 開発手順書を作成。各ステップにドメイン(frontend/backend/data)を
                   タグ付けする
               ▶ Raguel: evaluate_plan ×2(それぞれ独立にゲート)
   ▼
[implement]    開発手順書に従い TDD で実装する。ステップのドメインタグに応じて implementer に
               ディスパッチする
               ▶ Raguel: evaluate_code(diff + testResults)
   ▼
[test-loop]    二段構え(§5 test-loop の詳細):(A) スクリプト安定化 →(B) TDD 修正。
               いずれのループにも試行上限(既定 5 回)
               ▶ Raguel: コード修正・テストスクリプト修正の度に evaluate_code
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
[review]       diff(`git diff <base>...<branch>`)のドメインに応じたレビューアー
               (frontend/backend/data)+ 常時参加のレビューアー(doc/security)を並列
               ディスパッチする。intent の原文(`## ASIS` / `## TOBE`)の要望が未達なら
               severity high、持続層の制約に反していても high とする。所見を統合し、
               github では PR コメントに投稿し(local では投稿しない)、
               severity(critical / high / medium / low)を付ける
   ▼
[fix-loop]     critical & high を該当ドメインの implementer が修正 → 回帰テスト再実行
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

- `GATED`(Raguel ゲート必須)は intent / design / test-spec / dev-plan / implement /
  test-loop / intent-sync / fix-loop の 8 フェーズである。discuss・pr・review・triage・
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
  `record_outcome(incident)` を記録する。最も価値の高い失敗判例なので、CLAUDE.md に申告の運用ルールを書く(§9)。

### verdict 別ハンドリング

- **PROCEED** → 次フェーズへ自動遷移
- **ASK** → findings を人間に提示して停止(state は `awaiting_human`)。
  人間の裁定を `record_outcome` で記録し、再開(修正指示つき差し戻し or 続行)または中止。
  裁定が「as-is 承認」の場合は**再 evaluate せず**(sealed な resubmission-loop ルールと衝突しライブロックするため)、
  `codiel-state pass-gate <phase> --slug <slug> --verdict ASK --human-approved` で通過させる。
  verdict は ASK のまま `humanApproved: true` が監査記録として残る。これがゲートの唯一の正規例外で、
  `record_outcome(approved)` の記録が前提条件(運用規約は raguel-gating スキル)
- **STOP** → run を停止。`orchestrating-runs` の「失敗の記録」に従い、失敗を GOTCHAS に記録する
  (記録は metatron の `recording-gotchas` に委ね、記録の手段が無ければ run のレポートへ退避する。§9)
- **ループ上限超過**(test-loop / fix-loop の試行回数)→ ASK に倒す。
  Raguel の `common/resubmission-loop` ルールと合わせて二重の暴走防止

## 3. 成果物と state 管理

### .codiel/ ディレクトリと intent 文書(feature ブランチにコミットする)

```
docs/intents/<slug>.md      # 確定した intent 文書(原文の ASIS/TOBE・派生文・受け入れ基準。§6.3)
docs/intents/domains/       # 持続層(領域ごとの意図的な制約・非ゴール)
.codiel/
  specs/                    # ★永続テスト資産(run を跨いで蓄積・更新される)
    <unit-id>/              # 機能単位のフォルダ。例: screen-login, api-users-post, model-order
      spec.md               # テスト仕様書(その画面/API/モデルの振る舞い仕様)
      cases.md              # ID 付きテストケース表(前提・操作・期待結果)。仕様書から生成
      scripts/              # テストケースを実行する E2E テストスクリプト(§5)
  reports/                  # /codiel:test(単独実行)の結果レポート
  runs/<slug>/              # slug は intent フェーズの承認ゲートで決める識別子
    try-<n>/                # 同一 run の挑戦毎のフォルダ(再挑戦で try-2, try-3, …)
      state.json            # フェーズ進捗・ゲート記録・試行カウンタ(直接編集は hooks で禁止)
      agenda.md             # ディスカッション論点リスト(選択肢・トレードオフ・推奨案)
      discussion.md         # ユーザーとの合意記録(論点毎の決定・理由・却下案)
      design.md             # 設計書(影響を受ける機能単位の列挙を含む)
      dev-plan.md           # 開発手順書(ステップ毎にドメインタグ)
      reports/
        test-run-<n>.md     # 各回のテスト実行結果
        review-<n>.md       # 各回のレビュー所見
```

- intent 文書は run ディレクトリの外、`docs/intents/` に置く。state の `intent` フィールド
  (repoRoot 相対パス)が指す。
- **try の運用**: `/codiel:run` 実行時、最新 try が未完了なら**その try を再開**、
  終了状態(stopped / awaiting_outcome / completed / rejected)なら **try-<n+1> を新規作成**して開始する。
  新 try のサブエージェントは過去 try の成果物・レビュー所見を参照できる(前回の失敗を繰り返さないための入力)。
- Raguel へ渡す `raguelRunId` は `<slug>-try-2` の形式(try 毎に独立したケースファイル・resubmission-loop カウンタを持つ)。

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
  "adrTarget": "metatron",                // "metatron" | "intents"
  "phase": "implement",            // 現在フェーズ
  "phases": {
    "intent":    { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "design":    { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "test-spec": { "status": "passed", "evaluationId": "...", "verdict": "PROCEED",
                   "units": ["screen-login", "api-users-post"] },
    "dev-plan":  { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "implement": { "status": "in_progress", "attempts": 1 }
  },
  "pr": { "url": null },
  "limits": { "maxFixAttempts": 5 }
}
```

- **state.json は AI が直接書けない**。フェーズ遷移は同梱スクリプト `codiel-state`(Bash 経由で実行)
  だけが行い、スクリプトが遷移の正当性を機械的に検証する:
  - ゲート必須フェーズは Raguel の `evaluationId` + `verdict: PROCEED` なしに `passed` にできない
  - フェーズ順序のスキップ不可(intent → discuss → design → … の順序を強制)
  - 試行カウンタはインクリメントのみ(リセット不可)
- Edit / Write ツールによる state.json への直接変更は hooks で拒否(§8)。
  これが「フェーズ飛ばし」「ゲート偽装」への構造的防壁。
- **再開**: `/codiel:run` を Issue 番号・intent パス・省略のいずれかで再実行すると、対応する
  run の state.json を読み、未完了フェーズから自動再開する(解決の手順は orchestrating-runs)。

## 4. テスト資産モデル(永続・機能単位)

テスト仕様書は run の使い捨て成果物ではなく、**機能単位で分割された永続資産**として
`.codiel/specs/<unit-id>/` に蓄積する。

- **機能単位(unit)の粒度**: フロントエンドは画面毎、バックエンドは API 毎、データ層はモデル/マイグレーション毎。
  unit の同定と命名規則(`screen-*` / `api-*` / `model-*`)は `writing-test-specs` スキルに定める。
- **三層構造**: `spec.md`(振る舞い仕様)→ `cases.md`(仕様から導出した ID 付きテストケース)→
  `scripts/`(ケースを実行する自動テストスクリプト)。上流が変わったら下流を再生成する。
- **スクリプトは E2E テスト**: Playwright 等、ARCHITECTURE.md が宣言する E2E フレームワークで
  ユーザー視点の振る舞いを検証する。ユニットテストはこの体系には含めず、implementer が
  ARCHITECTURE.md のテスト方針に従い TDD の一部としてプロダクトコード側に書く(2 レイヤー体制)。
- **更新フロー**: 機能に更新が入る run では、design フェーズが影響 unit を列挙し、test-spec フェーズが
  該当 unit の spec.md を**更新**(なければ新規作成)→ cases.md を**再生成** → test-loop で scripts を追随させる。
- **役割分担による捏造防止**: 期待結果(cases.md)を書くのは test-designer、スクリプトを書くのは tester、
  コードを直すのは implementer。**期待結果を書く者とスクリプトを書く者と直す者が全員別人**なので、
  「期待値を書き換えて合格させる」改竄には最低 2 役の同時汚染が必要になる。
- **回帰テストの定義**: 「影響 unit の E2E ケース全件 + 既存全 unit の E2E ケース」に加え、
  ARCHITECTURE.md の test コマンド(ユニットテスト等)を全件実行する。既存 unit のスクリプトが
  資産として残っているため、回帰範囲が run を重ねるごとに厚くなる。

## 5. test-loop の詳細(スクリプト安定化 → TDD 修正)

「テストが失敗した」には**スクリプト自体の欠陥**と**プロダクトコードのバグ**の 2 種類があり、
これを混同すると「テストを直したつもりでバグを隠す」暴走が起きる。そこで二段に分ける。

```
(A) スクリプト安定化ループ(担当: tester)
    scripts/ を作成・修正 → 実行
    → 異常終了(ケースの OK/NG 判定が出ない・ランタイムエラー・環境問題)なら
      スクリプトを修正して再実行(何度でも。ただし試行上限あり)
    → 全ケースが OK / NG のいずれかの判定を出したら (B) へ
    HARD-GATE: (A) で許されるのはスクリプトの修正のみ。
               期待値(cases.md)の変更・プロダクトコードの変更は禁止
(B) TDD 修正ループ(担当: 該当ドメインの implementer)
    NG ケース = バグ。テストが先にあり実装が追いつく TDD の構図で、
    implementer に「NG ケース ID + 再現手順 + 期待結果 + 実際の結果」を渡してコード修正をディスパッチ
    → tester が再実行 → 全ケース OK まで反復(試行上限あり)
    HARD-GATE: implementer はテストスクリプト・cases.md を変更できない(hooks で強制)。
               「テストの方が間違っている」と判断した場合は修正せず ASK に上げる
```

- スクリプトは対象プロジェクトのテストフレームワーク(ARCHITECTURE.md の宣言に従う)で書き、
  **ケース ID との対応**と **OK/NG が機械判定できる出力**を必須とする。
- テストスクリプトの diff も Raguel の `evaluate_code` に通す(期待値の骨抜き・ケースの
  無断削除は `code/test-deletion` 系ルール + reviewer の検査対象)。

### /codiel:test(オーケストレーター外の単独テスト実行)

- `/codiel:test [unit-id...]` — 引数なしで全 unit、指定時はその unit のみ実行。
- テストスクリプトの作成・実行・合否判定を担う委譲先へディスパッチし、`.codiel/specs/**/scripts/` を実行、
  結果を `.codiel/reports/test-run-<timestamp>.md` に保存して要約を報告する。
- run 中でなくても使える(手動回帰・CI 前チェック用)。スクリプト安定化ループは含むが、
  コード修正(B)はディスパッチしない(報告のみ)。
- 単独実行中も hooks の書き込み制御は有効(アクティブ run がない場合も、テスト作業を担う委譲先の
  書き込み先は `.codiel/specs/**/scripts/` と `.codiel/reports/` に限られる)。

## 6. Skills(superpowers スタイルの自前スキル群)

すべて以下の superpowers 文法で記述する:

- frontmatter(`name` / `description`(発動条件を含む))
- **チェックリスト**(実行者はタスク化して順に消化)
- **Red Flags 表**(「これは省略していい」という合理化への反論)
- **HARD-GATE**(絶対に越えてはならない一線)

プロセスフローチャート(dot 形式)は SKILL.md 本文には置かず、`docs/skill-flowcharts.md` に集約する。

### オーケストレーター用(メインセッションが読む)

| スキル | 内容 |
|---|---|
| `orchestrating-runs` | `/codiel:run` の本体プロセス。state 駆動のフェーズ進行、サブエージェントのディスパッチ規約(担当スキル名・入出力パス・ARCHITECTURE/GOTCHAS 参照を必ず含める・ドメインタグによる implementer/reviewer の選択)、再開手順、ループ上限管理、失敗の記録(記録の契機と metatron への委譲、記録の手段が無いときの「未記録の GOTCHAS」への退避)。HARD-GATE:「オーケストレーターは自分で実装・レビューしない」「Raguel ゲートを省略して遷移しない」 |
| `capturing-intent` | intent フェーズの進行規約。TOBE の聞き取り、ASIS(現状調査)の突き合わせ、分岐の合意、ドラフト全文提示、承認ゲートでの規模・終え方・Issue 起票の決定、`docs/intents/` への保存までの手順。原文(`## ASIS`/`## TOBE`)はユーザーの言葉のまま記録し、要約・翻訳をしない |
| `raguel-gating` | Raguel 呼び出し規約。フェーズ→evaluate ツールの対応、objective の書き方、verdict 別ハンドリング、findings の次フェーズへの引き継ぎ、record_outcome の運用(承認・却下・incident)。Red Flags:「PROCEED 確実だからスキップ」「前回 PROCEED だったから今回も不要」等 |
| `facilitating-design-discussions` | discuss フェーズの進行規約。論点の提示順序、AskUserQuestion と自由議論の使い分け、「すべて推奨案で進める」ショートカット、discussion.md の記録書式、design フェーズの設計ウォークスルー手順。HARD-GATE:「合意の捏造禁止」「アジェンダの改変禁止」 |

### フェーズ用(各サブエージェントが読む)

| スキル | 模倣元 | 内容 |
|---|---|---|
| `preparing-design-agendas` | (独自) | intent・ARCHITECTURE.md・既存コードから、ユーザーと合意すべき how(実現方法)の論点を抽出し agenda.md に構造化する。選択肢 2 つ以上+トレードオフ+推奨案。intent の `## 未確定事項` は全件論点化。what(達成すること・受け入れ基準)は intent で合意済みとして立てない。HARD-GATE:「不明点を agenda から落とさない」 |
| `writing-design-docs` | brainstorming(設計部) | intent + discussion.md + ARCHITECTURE.md + GOTCHAS.md + 持続層(意図的な制約)を入力に設計書を執筆。YAGNI、既存パターン踏襲、変更対象ファイルの明示、**影響を受ける機能単位(unit)の列挙**、代替案の検討記録 |
| `writing-test-specs` | (独自) | unit の同定・命名規則、`.codiel/specs/<unit-id>/` の三層構造(spec.md → cases.md)の新規作成・**更新と再生成**の手順。実装詳細ではなく振る舞いをテストする。期待結果は受け入れ基準から導出する。軽量な run では design.md の代わりに intent の `## 受け入れ基準` と持続層を入力にする。HARD-GATE:「書き込みは `.codiel/specs/<unit-id>/` の spec.md と cases.md だけ」「`scripts/` に触れない」「Bash を使わない」 |
| `writing-dev-plans` | writing-plans | 設計書を工程分解した開発手順書。各ステップに「変更ファイル・完了条件・検証コマンド・**ドメインタグ(frontend/backend/data)**」。軽量な run では design.md の代わりに intent の `## 実装方針` と持続層を入力にする |
| `implementing` | executing-plans + test-driven-development | 手順書に沿った TDD 実装(RED→GREEN→REFACTOR)。手順逸脱の禁止、「ついでのリファクタ」禁止。3 ドメインの implementer 共通 + ドメイン別の注意事項(`skills/implementing/references/` に記載) |
| `scripting-tests` | (独自) | cases.md からテストスクリプトを作成・修正する規約。ケース ID との対応、OK/NG の機械判定可能な出力、ARCHITECTURE.md のテストフレームワーク準拠。HARD-GATE:「期待値の変更・プロダクトコードの変更は禁止」 |
| `running-regression-tests` | verification-before-completion | スクリプト安定化ループ(A)と TDD 修正ループ(B)の運転規約(§5)。回帰範囲の決定。HARD-GATE:「出力を見ずに合格を主張しない」「異常終了とテスト NG を混同しない」 |
| `fixing-failures` | systematic-debugging | NG ケースの修正。根本原因特定→最小修正。**テストスクリプト・cases.md を触る修正の禁止**。「テストの方が間違っている」と思ったら ASK へ |
| `reviewing-diffs` | requesting-code-review | design.md・テスト仕様書・intent の原文(`## ASIS`/`## TOBE`)と `## 受け入れ基準` を基準に diff をレビュー。severity 定義(critical/high/medium/low、原文の要望の未達と持続層の制約違反は high)、github では `gh pr review` / `gh pr comment` での投稿(local では投稿しない)。5 観点の reviewer 共通プロセス(観点別の焦点は `skills/reviewing-diffs/references/` に記載)。軽量な run では design.md の代わりに intent と dev-plan.md を入力にする |
| `fixing-review-findings` | receiving-code-review | 指摘の技術的検証→妥当なら修正、不当なら根拠を添えて反論コメント。盲目的追従の禁止。対象は critical / high のみ(medium 以下は triage へ) |
| `syncing-intents` | (独自) | intent-sync フェーズの運転規約。承認済みの受け入れ基準の変更と、途中でユーザーが追記した原文を、人の確認つきで派生文のセクションへ反映する。持続層(`docs/intents/domains/`)の更新。HARD-GATE:「原文のセクションは書き換えない」「intent の `status` を `done` にしない(finalize だけが付ける)」 |
| `filing-followup-issues` | (独自) | triage フェーズの運転規約。medium / low 指摘の一覧提示の形式、ユーザーへの確認の取り方。github: Issue 本文の書式(指摘内容・severity・関連ファイル・元 PR へのリンク・ラベル付け)、既存 Issue との重複確認、**ISSUE_TEMPLATE の活用**(`.github/ISSUE_TEMPLATE/` の form 形式 .yml / markdown 形式 .md や `.github/ISSUE_TEMPLATE.md` を探索し、指摘の種類に最も合うテンプレートを選択、テンプレートがない場合のみ既定書式で起票)。local: `status: proposed` の intent 草案として `docs/intents/` に書く。HARD-GATE:「ユーザーの指示なしに起票しない」 |

### スキル本文に置かない根拠(退避)

各スキルが「なぜその規律が必要か」を述べていた記述を、指示から分離してここに残す。

- `preparing-design-agendas`: agenda に挙げた論点がそのままディスカッションの議題になり、合意結果(discussion.md)は design フェーズの設計を拘束する。論点を漏らすと、その分岐はユーザーに諮られないまま architect の独断で設計されることになる。
- `orchestrating-runs`(失敗の記録): Codiel は 2 つの記憶で「プロジェクト毎に賢くなる」。Raguel の判例ストアは判定側の記憶(次の evaluate をどう判定するか)を、`docs/GOTCHAS.md` は生成側の記憶(次の実装・設計をどう書くか)を賢くする。GOTCHAS.md は全フェーズのサブエージェントが作業前に必読する共有資産であり、記録を怠れば同じプロジェクト固有の罠に次の run が再度落ちる。記録の判断(1 問)・書式・採番・タグは台帳の書式契約の持ち主である metatron の `recording-gotchas` に委ね、codiel は記録の契機と、記録の手段が無いときの退避だけを持つ。2026-09-27 までは codiel も同名のスキルで書式契約の写しを持っていたが、二重管理になるため削除した。
- `writing-design-docs`: design.md で設計を誤ったり影響 unit を漏らすと、その誤りはテスト仕様書の漏れ・実装漏れとしてそのまま後続フェーズに伝播する。
- `writing-dev-plans`: `[domain: ...]` タグはディスパッチ先の決定と implementer のドメイン規律の 2 箇所から機械的に参照される。タグを誤るか複数ドメインを 1 ステップに混ぜると、誤った implementer が呼ばれるか、hooks が正当な書き込みを ask で止める誤爆を招く。両者ともタグを機械的にしか読まないため、曖昧・複合のタグは下流のどこかで必ず事故になる。

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
test-designer の「Bash を持たず、`.codiel/specs/<unit-id>/` の spec.md と cases.md だけを書く」という
権限は、test-spec の依頼文の tools 限定条項と `writing-test-specs` の HARD-GATE が代わりに担う。
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
`skills/implementing/references/{frontend,backend,data}.md` に置く。レビューの観点別の焦点は
`skills/reviewing-diffs/` の「観点別の焦点」節と
`skills/reviewing-diffs/references/{frontend,backend,data,doc,security,generic}.md` に置く。

| 委譲の種別 | 主な作業 | 担保する境界 |
|---|---|---|
| 成果物を書く委譲 | アジェンダ・設計書・テスト仕様・開発計画、実装・テストスクリプト・修正 | 依頼文の tools 限定条項、hooks、各作業スキルの HARD-GATE |
| 読み取りだけの委譲 | diff のレビュー、調査、再レビュー | 読み取り系 tools のみ、`reviewing-diffs` の HARD-GATE |

実装・テストの委譲では、開発手順書のドメインタグとディスパッチプロンプトで渡すドメインマップに
従う。`mapped` では担当範囲外を書き込まず、`unscoped` ではドメイン境界を設けない。
ドメインを跨ぐステップは、開発手順書の段階でドメイン単位に分割することを
`writing-dev-plans` が要求する。

この分離により、テストの期待値を変更する委譲先が実装を修正して自己承認することや、
レビューを担う委譲先が自分でコードを修正して自己承認することを防ぐ。担保するのは固定した
Agent 名ではなく、依頼文の tools 限定条項、各作業スキル本文の HARD-GATE、hooks による境界制御である。

## 8. Hooks(決定論的な外壁)

Raguel が「成果物」を検査するのに対し、hooks は「行動」を検査する。相補的な二層防御。
`hooks/hooks.json` + 同梱スクリプト(node)で実装する。

| フック | 対象 | 内容 |
|---|---|---|
| PreToolUse | Bash(`gh pr create`, `git push`) | state.json を参照し、「テスト green + implement/test-loop が passed(PROCEED または human-approved の ASK)」でなければ **deny**。保護ブランチ(main 等)への push は常に deny |
| PreToolUse | Bash(`gh issue create`) | アクティブ run の現在フェーズが **triage でなければ deny**(ユーザーの指示なき起票の防止。§2 の triage) |
| PreToolUse | Bash(危険コマンド) | `rm -rf`(作業ツリー外)、`curl \| sh`、`git push --force` 等を deny。Raguel の `code/dangerous-patterns` はコード成果物を見るが、こちらは実行コマンドそのものを見る |
| PreToolUse | Edit / Write(`.codiel/runs/**/state.json`) | **deny**。state 遷移は `codiel-state` スクリプト経由のみ(§3) |
| PreToolUse | Edit / Write(フェーズ別書き込み制御) | アクティブ run の現在フェーズを参照し、フェーズと不整合な書き込みを **ask**(人間に確認)。例: 文書フェーズ(intent/discuss/design/test-spec/dev-plan)中の `src/**` への書き込み、コードフェーズ(implement/test-loop/fix-loop)中の `.codiel/specs/**` の spec.md / cases.md(期待値)への書き込み。deny にしない(ask)のは、正当な例外書き込みでの誤爆に備えるため。**ドメイン単位の制御は、state.json の `domain`(`codiel-state` の `set-domain` / `clear-domain` で設定・解除する)を根拠に行う** — hooks はツール呼び出しの発行元エージェントを識別できないため、エージェント名ではなく**宣言された domain** を境界の根拠にする。コードフェーズ中に `domain` が設定されているとき、ARCHITECTURE のドメインマップにあるそのドメインの glob に一致しない書き込みは **ask**(ドメイン名がマップに無いときも ask)。`domain` が無いとき・ドメインマップが読めないときは境界を課さない |
| Stop | メインセッション | アクティブ run が `completed` / `stopped` / `awaiting_human` / `awaiting_outcome` 以外の状態で停止しようとしたら block し「run が未完了。継続するか、明示的に中止せよ」と通知(尻切れ完了宣言の防止) |

## 9. docs(プロジェクト毎に成長するハーネス資産)

対象プロジェクトに配置するハーネス資産。`/codiel:init`(`initializing-harness` スキル)が
初期化する: `.codiel/` 配下のディレクトリは同スキルが呼ぶ `scripts/install-harness.sh` が
機械的に配置する。raguel.config.yaml は聞き取り(保護パス)の回答から生成し、CLAUDE.md は
`CLAUDE.example.md` の運用ルール節をそのまま追記する(既存ファイルは不足分のみ追記)。
ARCHITECTURE は `/codiel:init` の対象ではない。ドメインマップの生成は metatron が行う。codiel は
ドメインマップを作らない。
GOTCHAS は `/codiel:init` の対象ではない。台帳の生成は metatron が行う。記録時に台帳が無ければ `append-gotcha` が台帳ごと作る。codiel は台帳を作らない。
`/codiel:run` は資産配置を行わず、B + C + D(`CLAUDE.md` が存在し `## Codiel ハーネス運用ルール` 見出しを含むこと、`raguel.config.yaml` が存在し YAML としてパースできること、`.codiel/specs` / `.codiel/runs` / `.codiel/reports` の 3 ディレクトリが存在すること)が揃っていることを初期化済みと判定する。いずれかが揃っていないときは未初期化として `/codiel:init` を案内して終了する。

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
  implementer/reviewer の選択と hooks の書き込み制御(§8)の基準になる。
  ドメイン分割が馴染まないプロジェクトは `generic` 1 つに縮退でき、その場合
  implementer / reviewer も汎用 1 体構成で動く
- **コマンド定義**: test / lint / build / typecheck の実行コマンド
  (tester のスクリプト作成とオーケストレーターの検証はここを読む)
- **テスト方針**: E2E フレームワーク(Playwright 等)と実行方法、
  ユニットテストの要否・フレームワーク・配置規約(implementer の TDD はこの宣言に従う)
- 保護パス(raguel.config.yaml の `code/protected-paths` と整合させる)
- コーディング規約・ブランチ/PR 規約(命名・ベースブランチ)・Definition of Done

このうち**ドメインマップの役割**(implementer / reviewer の選択と hooks の書き込み制御の基準、
`generic` への縮退)は現在も生きている判断である。ブロックの記法(マーカー名を含む)は
契約 §1 が正本であり、`codiel:domains` から `metatron:domains` へ変わっている。

### GOTCHAS(既定 `docs/GOTCHAS.md`)

プロジェクト固有の落とし穴台帳。**失敗を記録してプラグインをプロジェクト毎に成長させる仕組み**の生成側。

- エントリ書式: 執筆当時は 日付 / 発生フェーズ / 症状 / 根本原因 / 予防策 / 関連ファイル と決めた。
  **この旧書式は廃止され、互換読みも設けない**(契約 §6)。現行の書式・挿入位置・採番・タグは
  契約 §6-1〜§6-4 が正本である
- 記録の契機: Raguel STOP、ループ上限超過、record_outcome(incident)、レビューで発覚した設計漏れ
- 台帳の生成と書き込みは metatron の CLI が行う。記録の判断と書式は metatron の `recording-gotchas` スキルに従い、codiel は契機が起きたらそのスキルを起動する(`orchestrating-runs` の「失敗の記録」)。CLI の案内が無い環境では、記録を「未記録の GOTCHAS」として run のレポートへ持ち越す(設計書 `2026-09-15-metatron-init-gotchas-design.md` §6.4)。
- 全フェーズのサブエージェントが作業前に必読(ディスパッチプロンプトで強制)
- Raguel の判例ストア(判定側の記憶)と GOTCHAS(生成側の記憶)で両輪の成長ループを構成する

### CLAUDE.md(← CLAUDE.example.md)

Codiel ハーネスを適切に運用するための決まり。ARCHITECTURE と GOTCHAS は metatron の資産であり、
codiel はこの 2 つに触れないので、CLAUDE.md にも書かない。metatron が有る環境では、これらの
存在と扱い方は SessionStart の注入と `.claude/rules/metatron/` を通して伝わる。

文書の扱い:

- intent 文書(`docs/intents/`)の原文のセクション(`## ASIS` / `## TOBE`)はユーザーの言葉のまま
  にし、要約・書き換えをせず、日付・話者・出所つきで末尾に追記する
- 持続層(`docs/intents/domains/`)を書き換えるのは intent-sync フェーズだけにし、`[ADR 候補]`
  の印が付いたエントリを参照形へ縮める作業も intent-sync フェーズの外で行う
- テスト仕様書(`.codiel/specs/`)は機能の一部。機能を変えたら仕様書とケースも更新する

規則:

- run から渡された前提を使う
- `.codiel/runs/**/state.json` を直接編集しない(codiel-state 経由のみ)
- Raguel ゲートは省略しない。ASK / STOP には従う
- PROCEED した変更が原因で実害(障害・リグレッション)が出たら、必ず incident として申告し
  `record_outcome(incident)` を記録させる(自動検知できない唯一の結末であり、最も価値の高い失敗判例)

ARCHITECTURE / GOTCHAS を作業の前提として読む規律、乖離の報告、失敗の記録の手順は
`orchestrating-runs`(依頼文テンプレートの「前提」、「7. 失敗の記録」、finalize の結果
レポート)に置く。

## 10. ディレクトリ構成(プラグイン側)

```
plugins/codiel/
  .claude-plugin/plugin.json
  commands/
    init.md                    # /codiel:init(薄い入口。initializing-harness を起動)
    run.md                     # /codiel:run [<Issue番号> | <intentパス>](薄い入口。orchestrating-runs を起動)
    test.md                    # /codiel:test [unit-id...](単独テスト実行。§5)
  skills/
    initializing-harness/SKILL.md(+ raguel.config.example.yaml)
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
    github-writing.md         # Issue・PR・コメント・レビュー本文の執筆規則と画像の載せ方(§6.12.3〜§6.12.4)
    handoff-contract.md       # gh-utility issue-craft への持ち込みモードの契約
    intent-common.md          # 経路選択・畳む経路の共通規律
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
  指示する。Raguel MCP の可用性(`mcp__raguel__*` の有無)も同じ手法で確かめる。
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
