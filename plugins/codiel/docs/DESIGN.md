# Codiel オーケストレーター設計書

GitHub Issue を起点に、設計 → テスト仕様 → 開発計画 → 実装 → 回帰テスト → PR → レビュー → 修正を
一気通貫で行うオーケストレーターと、それを支える skills / agents / hooks / docs の設計。

各フェーズの進行には **Raguel MCP のゲートを逐一挟み**、AI の暴走(フェーズ飛ばし・偽装グリーン・
自己承認・無限修正ループ)を構造的に抑止するハーネスエンジニアリングを行う。

- スキルの記述様式は superpowers を模倣する(チェックリスト・プロセスフローチャート・Red Flags 表・HARD-GATE)。
  ただし superpowers への依存はなく、プラグインとして自己完結する。
- **設計工程は人間と共同で行う**: discuss フェーズ(論点の合意)・design ウォークスルー
  (設計書の確認)・triage(起票指示)が常設の人間参加ポイント。それ以外のフェーズに固定
  承認ポイントはなく、人間が介入するのは Raguel が ASK / STOP を出したときのみ。
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
| コマンド構成 | `/codiel:run <issue番号>`(オーケストレーター)+ `/codiel:test`(単独テスト実行)。state による再開機能 |
| 実行モデル | メインセッション=オーケストレーター。各フェーズは専用サブエージェント(fresh コンテキスト・ツール制限付き)が実行 |
| テスト仕様書 | run 使い捨てではなく**機能単位の永続資産**。機能更新時に仕様書を更新しテストケースを再生成する |
| テスト体系 | 仕様書駆動テストは **Playwright 等の E2E**。ユニットテストは別レイヤーで、implementer が ARCHITECTURE.md のテスト方針宣言に従い TDD の中で作成する |
| implementer | frontend / backend / data のドメイン別 3 体 |
| reviewer | frontend / backend / data / doc / security の 5 体 |
| ドメイン縮退 | ドメイン分割が馴染まないプロジェクトは、ドメインマップを `generic` 1 つに縮退させ、implementer / reviewer も汎用 1 体で回す |
| runId / 再挑戦 | runId は `issue-123` 形式。その下に **try 毎のフォルダ**(`try-<n>/`)を切り、同一 Issue の再挑戦を管理する |
| record_outcome | **マージ検知を自動化**: codiel コマンド起動時に未確定 run の PR 状態を gh で走査し自動記録。incident のみ人間の明示申告 |
| 役割別書き込み制御 | hooks の判定は deny ではなく **ask**(誤爆に備える)。hooks が機械的に制御するのはフェーズ単位まで(エージェント個体を識別できないため)。ドメイン単位の規律はエージェント定義とレビューで担保 |
| 設計ディスカッション | 常に実施・アジェンダ駆動型(論点抽出=architect、進行と記録=オーケストレーター、決定=ユーザー)。discuss は非 GATED、ウォークスルーは design フェーズ内。詳細は `harness-docs/superpowers/specs/2026-07-10-codiel-discuss-phase-design.md` |

## 2. 全体フロー(フェーズと Raguel ゲート)

```
/codiel:run <issue番号>
   │
   ▼
[0] init        gh issue view で Issue 取得 → 要件・受け入れ基準・スコープを分析
                → feature ブランチ作成 → .codiel/runs/<runId>/ 初期化
                ▶ Raguel: evaluate_decision(「この解釈・スコープで進む」という判断)
   ▼
[1] discuss     architect が論点リスト agenda.md を作成(選択肢・トレードオフ・推奨案。
                issue.md の不明点は全件論点化)→ オーケストレーターがユーザーと
                ディスカッション(「すべて推奨案で進める」ショートカットあり)
                → 合意を discussion.md に記録し、ユーザーの最終確認を経て完了
                ▶ Raguel ゲートなし(人間が直接参加するフェーズ。合意の検査は
                  後続の evaluate_design が design.md との整合として担う)
   ▼
[2] design      設計書 design.md を執筆。影響を受ける機能単位(画面・API・データモデル)を列挙
                執筆後、オーケストレーターが design.md の要点をユーザーに提示するウォークスルーを行い、
                修正要望があれば architect を再ディスパッチ。ユーザー承認後に evaluate_design。
                ▶ Raguel: evaluate_design
   ▼
[3] test-spec ∥ dev-plan   並列実行:
                (a) test-spec: 影響を受ける機能単位ごとにテスト仕様書を新規作成 or 更新し、
                    続けてテストケースを(再)生成(§4 テスト資産モデル)
                (b) dev-plan: 開発手順書を作成。各ステップにドメイン(frontend/backend/data)をタグ付け
                ▶ Raguel: evaluate_plan ×2(それぞれ独立にゲート)
   ▼
[4] implement   開発手順書に従い TDD で実装。ステップのドメインタグに応じて
                frontend / backend / data の implementer にディスパッチ。
                ユニットテストは ARCHITECTURE.md のテスト方針宣言に従い implementer が作成する
                (仕様書駆動の E2E テストとは別レイヤー)
                ▶ Raguel: evaluate_code(diff + testResults)
   ▼
[5] test-loop   二段構え(§5 test-loop の詳細):
                (A) スクリプト安定化: テストケースを実行するスクリプトを作成し、
                    正常終了(全ケースが OK/NG の判定を出す)まで何度でもスクリプトを修正
                (B) TDD 修正: スクリプトが正常に回るようになって初めて、NG=バグとして
                    該当ドメインの implementer にコード修正をディスパッチ → 全ケース OK まで反復
                いずれのループにも試行上限(既定 5 回)
                ▶ Raguel: コード修正・テストスクリプト修正の度に evaluate_code
                  (同一 runId のため resubmission-loop 検知が効く)
   ▼
[6] pr          PR 作成(設計書・テスト仕様書・テストケース込みの diff)
                ▶ hooks が「テスト green + code PROCEED」を state で検証してから許可
   ▼
[7] review      diff のドメインに応じたレビューアー(frontend/backend/data)
                + 常時参加のレビューアー(doc/security)を並列ディスパッチ。
                所見を統合し PR コメントに投稿(severity: critical / high / medium / low)
   ▼
[8] fix-loop    critical & high を該当ドメインの implementer が修正 → 回帰テスト再実行
                → 再レビュー → critical/high ゼロ & テスト合格まで反復(試行上限あり)
                medium 以下の指摘は修正せず triage へ持ち越す
                レビューで critical/high がゼロなら fix-loop は開始せず
                `codiel-state skip-phase fix-loop --reason ...` でスキップする
                (verdict は "SKIPPED" として監査記録に残る。未開始=pending のときのみ可)
                ▶ Raguel: 修正毎に evaluate_code
   ▼
[9] triage      medium / low の指摘を一覧化してユーザーに提示し、指示を待つ
                (state 機構上は phases.triage が in_progress のまま。非 GATED フェーズのため
                mark-ask は使わず、「回答が来るまで進まない」運転で待機する)。
                **ユーザーの指示のもと**、起票対象に選ばれた指摘を gh issue create で
                別 Issue として起票する(見送り・まとめて 1 件などの裁量もユーザーに委ねる)。
                リポジトリに ISSUE_TEMPLATE があれば指摘の種類に応じて適切なテンプレートを
                選択し、その項目を最大限埋めて起票する。
                起票済み Issue の番号は review-<n>.md と PR コメントに追記して追跡可能にする
                ▶ Raguel ゲートなし(人間が直接指示するフェーズのため)。
                  ただし gh issue create は hooks により triage フェーズ以外では実行不可(§8)
   ▼
[10] finalize   結果レポートを出力し、state を awaiting_outcome にして終了。
                以後の codiel コマンド起動時に PR 状態を自動検知して record_outcome を呼び、
                Raguel に判例を還流する(下記「outcome の自動同期」)
```

### outcome の自動同期

- finalize 後の run は state `awaiting_outcome` で残る。
- **すべての codiel コマンド(`/codiel:run` / `/codiel:test`)は起動時に `awaiting_outcome` の run を走査**し、
  `gh pr view --json state,mergedAt` で PR の現況を確認して自動記録する:
  - マージ済み → `record_outcome(approved)`
  - マージされずクローズ → `record_outcome(rejected)`
  - オープンのまま → 何もしない(次回また確認)
- **incident(PROCEED したのに実害が出た)だけは自動検知できない**ため、人間が明示的に申告したときに
  `record_outcome(incident)` を記録する。最も価値の高い失敗判例なので、CLAUDE.md に申告の運用ルールを書く(§9)。

### verdict 別ハンドリング

- **PROCEED** → 次フェーズへ自動遷移
- **ASK** → findings を人間に提示して停止(state は `awaiting_human`)。
  人間の裁定を `record_outcome` で記録し、再開(修正指示つき差し戻し or 続行)または中止。
  裁定が「as-is 承認」の場合は**再 evaluate せず**(sealed な resubmission-loop ルールと衝突しライブロックするため)、
  `codiel-state pass-gate --verdict ASK --human-approved` で通過させる。verdict は ASK のまま
  `humanApproved: true` が監査記録として残る。これがゲートの唯一の正規例外で、
  `record_outcome(approved)` の記録が前提条件(運用規約は raguel-gating スキル)
- **STOP** → run を停止。`recording-gotchas` スキルを起動して失敗を GOTCHAS.md に記録
- **ループ上限超過**(test-loop / fix-loop の試行回数)→ ASK に倒す。
  Raguel の `common/resubmission-loop` ルールと合わせて二重の暴走防止

## 3. 成果物と state 管理

### .codiel/ ディレクトリ(feature ブランチにコミットする)

```
.codiel/
  specs/                    # ★永続テスト資産(run を跨いで蓄積・更新される)
    <unit-id>/              # 機能単位のフォルダ。例: screen-login, api-users-post, model-order
      spec.md               # テスト仕様書(その画面/API/モデルの振る舞い仕様)
      cases.md              # ID 付きテストケース表(前提・操作・期待結果)。仕様書から生成
      scripts/              # テストケースを実行する E2E テストスクリプト(§5)
  reports/                  # /codiel:test(単独実行)の結果レポート
  runs/<runId>/             # runId = issue-123(Issue 番号ベース)
    try-<n>/                # 同一 Issue の挑戦毎のフォルダ(再挑戦で try-2, try-3, …)
      state.json            # フェーズ進捗・ゲート記録・試行カウンタ(直接編集は hooks で禁止)
      issue.md              # Issue スナップショット + 分析結果(要件・受け入れ基準・スコープ/非スコープ)
      agenda.md             # ディスカッション論点リスト(選択肢・トレードオフ・推奨案)
      discussion.md         # ユーザーとの合意記録(論点毎の決定・理由・却下案)
      design.md             # 設計書(影響を受ける機能単位の列挙を含む)
      dev-plan.md           # 開発手順書(ステップ毎にドメインタグ)
      reports/
        test-run-<n>.md     # 各回のテスト実行結果
        review-<n>.md       # 各回のレビュー所見
```

- **try の運用**: `/codiel:run 123` 実行時、最新 try が未完了なら**その try を再開**、
  終了状態(completed / stopped / rejected)なら **try-<n+1> を新規作成**して開始する。
  新 try のサブエージェントは過去 try の成果物・レビュー所見を参照できる(前回の失敗を繰り返さないための入力)。
- Raguel へ渡す runId は `issue-123-try-2` の形式(try 毎に独立したケースファイル・resubmission-loop カウンタを持つ)。

- フェーズ間の引き継ぎは**すべてファイル経由**。サブエージェントには「入力ファイルパス」と
  「出力ファイルパス」を渡す。コンテキストが切れても壊れない。
- PR に設計書・テスト仕様書・テストケースが含まれるため、人間のレビュアーが設計意図と
  テスト根拠を diff 上で確認できる。

### state.json とフェーズ遷移の保護

```jsonc
{
  "runId": "issue-123",
  "try": 1,
  "issue": 123,
  "branch": "codiel/issue-123-try-1",   // ブランチは try 毎(旧 try のブランチ・PR と衝突させない)
  "phase": "implement",            // 現在フェーズ
  "phases": {
    "init":      { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "design":    { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "test-spec": { "status": "passed", "evaluationId": "...", "verdict": "PROCEED",
                   "units": ["screen-login", "api-users-post"] },
    "dev-plan":  { "status": "passed", "evaluationId": "...", "verdict": "PROCEED" },
    "implement": { "status": "in_progress", "attempts": 1 }
  },
  "limits": { "maxFixAttempts": 5 }
}
```

- **state.json は AI が直接書けない**。フェーズ遷移は同梱スクリプト `codiel-state`(Bash 経由で実行)
  だけが行い、スクリプトが遷移の正当性を機械的に検証する:
  - ゲート必須フェーズは Raguel の `evaluationId` + `verdict: PROCEED` なしに `passed` にできない
  - フェーズ順序のスキップ不可(init → design → … の順序を強制)
  - 試行カウンタはインクリメントのみ(リセット不可)
- Edit / Write ツールによる state.json への直接変更は hooks で拒否(§8)。
  これが「フェーズ飛ばし」「ゲート偽装」への構造的防壁。
- **再開**: `/codiel:run 123` を再実行すると state.json を読み、未完了フェーズから自動再開。

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
- codiel-tester をディスパッチし、`.codiel/specs/**/scripts/` を実行、
  結果を `.codiel/reports/test-run-<timestamp>.md` に保存して要約を報告する。
- run 中でなくても使える(手動回帰・CI 前チェック用)。スクリプト安定化ループは含むが、
  コード修正(B)はディスパッチしない(報告のみ)。
- 単独実行中も hooks の書き込み制御は有効(アクティブ run がない場合も、tester の書き込み先は
  `.codiel/specs/**/scripts/` と `.codiel/reports/` に限られる)。

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
| `orchestrating-runs` | `/codiel:run` の本体プロセス。state 駆動のフェーズ進行、サブエージェントのディスパッチ規約(担当スキル名・入出力パス・ARCHITECTURE/GOTCHAS 参照を必ず含める・ドメインタグによる implementer/reviewer の選択)、再開手順、ループ上限管理。HARD-GATE:「オーケストレーターは自分で実装・レビューしない」「Raguel ゲートを省略して遷移しない」 |
| `raguel-gating` | Raguel 呼び出し規約。フェーズ→evaluate ツールの対応、objective の書き方、verdict 別ハンドリング、findings の次フェーズへの引き継ぎ、record_outcome の運用(承認・却下・incident)。Red Flags:「PROCEED 確実だからスキップ」「前回 PROCEED だったから今回も不要」等 |
| `facilitating-design-discussions` | discuss フェーズの進行規約。論点の提示順序、AskUserQuestion と自由議論の使い分け、「すべて推奨案で進める」ショートカット、discussion.md の記録書式、design フェーズの設計ウォークスルー手順。HARD-GATE:「合意の捏造禁止」「アジェンダの改変禁止」 |

### フェーズ用(各サブエージェントが読む)

| スキル | 模倣元 | 内容 |
|---|---|---|
| `analyzing-issues` | brainstorming(要件探索部) | Issue から要件・受け入れ基準・スコープ・非スコープを抽出し issue.md に構造化。曖昧な点は推測で補完せず「不明点」として列挙(Raguel の ASK 材料になる) |
| `preparing-design-agendas` | (独自) | issue.md・ARCHITECTURE.md・既存コードから、ユーザーと合意すべき論点(方針分岐・不明点・スコープ線引き)を抽出し agenda.md に構造化する。選択肢 2 つ以上+トレードオフ+推奨案。issue.md の不明点は全件論点化。HARD-GATE:「不明点を agenda から落とさない」 |
| `writing-design-docs` | brainstorming(設計部) | issue.md + ARCHITECTURE.md + GOTCHAS.md を入力に設計書を執筆。YAGNI、既存パターン踏襲、変更対象ファイルの明示、**影響を受ける機能単位(unit)の列挙**、代替案の検討記録 |
| `writing-test-specs` | (独自) | unit の同定・命名規則、`.codiel/specs/<unit-id>/` の三層構造(spec.md → cases.md)の新規作成・**更新と再生成**の手順。実装詳細ではなく振る舞いをテストする。期待結果は受け入れ基準から導出する |
| `writing-dev-plans` | writing-plans | 設計書を工程分解した開発手順書。各ステップに「変更ファイル・完了条件・検証コマンド・**ドメインタグ(frontend/backend/data)**」 |
| `implementing` | executing-plans + test-driven-development | 手順書に沿った TDD 実装(RED→GREEN→REFACTOR)。手順逸脱の禁止、「ついでのリファクタ」禁止。3 ドメインの implementer 共通 + ドメイン別の注意事項(各エージェント定義に記載) |
| `scripting-tests` | (独自) | cases.md からテストスクリプトを作成・修正する規約。ケース ID との対応、OK/NG の機械判定可能な出力、ARCHITECTURE.md のテストフレームワーク準拠。HARD-GATE:「期待値の変更・プロダクトコードの変更は禁止」 |
| `running-regression-tests` | verification-before-completion | スクリプト安定化ループ(A)と TDD 修正ループ(B)の運転規約(§5)。回帰範囲の決定。HARD-GATE:「出力を見ずに合格を主張しない」「異常終了とテスト NG を混同しない」 |
| `fixing-failures` | systematic-debugging | NG ケースの修正。根本原因特定→最小修正。**テストスクリプト・cases.md を触る修正の禁止**。「テストの方が間違っている」と思ったら ASK へ |
| `reviewing-diffs` | requesting-code-review | 設計書・テスト仕様書・Issue を基準に diff をレビュー。severity 定義(critical/high/medium/low)、`gh pr review` / `gh pr comment` での投稿形式。5 観点の reviewer 共通プロセス(観点別の職務は各エージェント定義に記載) |
| `fixing-review-findings` | receiving-code-review | 指摘の技術的検証→妥当なら修正、不当なら根拠を添えて反論コメント。盲目的追従の禁止。対象は critical / high のみ(medium 以下は triage へ) |
| `filing-followup-issues` | (独自) | triage フェーズの運転規約。medium / low 指摘の一覧提示の形式、ユーザーへの確認の取り方、Issue 本文の書式(指摘内容・severity・関連ファイル・元 PR へのリンク・ラベル付け)、既存 Issue との重複確認。**ISSUE_TEMPLATE の活用**: `.github/ISSUE_TEMPLATE/`(form 形式 .yml / markdown 形式 .md)や `.github/ISSUE_TEMPLATE.md` を探索し、指摘の種類(バグ / 改善 / タスク等)に最も合うテンプレートを選択、その項目・ラベル・タイトル接頭辞を最大限活かして本文を構成する。テンプレートがない場合のみ既定書式で起票。HARD-GATE:「ユーザーの指示なしに起票しない」 |
| `recording-gotchas` | (独自・成長機構) | 失敗(STOP・ループ上限超過・incident・レビューで発覚した設計漏れ)から「プロジェクト固有で再発しうる教訓」を抽出し GOTCHAS.md に追記する基準と書式 |

### スキル本文に置かない根拠(退避)

各スキルが「なぜその規律が必要か」を述べていた記述を、指示から分離してここに残す。

- `preparing-design-agendas`: agenda に挙げた論点がそのままディスカッションの議題になり、合意結果(discussion.md)は design フェーズの設計を拘束する。論点を漏らすと、その分岐はユーザーに諮られないまま architect の独断で設計されることになる。
- `analyzing-issues`: issue.md で要件を取り違えたり曖昧さを握り潰したりすると、その誤りは後続フェーズすべてに伝播し、design 以降で作り直しになる。
- `recording-gotchas`: Codiel は 2 つの記憶で「プロジェクト毎に賢くなる」。Raguel の判例ストアは判定側の記憶(次の evaluate をどう判定するか)を、`docs/GOTCHAS.md` は生成側の記憶(次の実装・設計をどう書くか)を賢くする。GOTCHAS.md は全フェーズのサブエージェントが作業前に必読する共有資産であり、記録を怠れば同じプロジェクト固有の罠に次の run が再度落ちる。逆に何でも書けば台帳が肥大化しシグナルが埋もれるため、記録基準を 1 問に絞っている。
- `writing-design-docs`: design.md で設計を誤ったり影響 unit を漏らすと、その誤りはテスト仕様書の漏れ・実装漏れとしてそのまま後続フェーズに伝播する。
- `writing-dev-plans`: `[domain: ...]` タグはディスパッチ先の決定と implementer のドメイン規律の 2 箇所から機械的に参照される。タグを誤るか複数ドメインを 1 ステップに混ぜると、誤った implementer が呼ばれるか、hooks が正当な書き込みを ask で止める誤爆を招く。両者ともタグを機械的にしか読まないため、曖昧・複合のタグは下流のどこかで必ず事故になる。

## 7. Agents(ツール制限 = 構造的ハーネス)

サブエージェントは `agents/` で定義し、frontmatter の `tools` で権限を最小化する。
**「できないことは暴走もできない」**が原則。ドメインの境界(どのパスが frontend/backend/data か)は
ARCHITECTURE.md の**ドメインマップ**(§9)で宣言し、hooks が書き込み制御に使う。

### MCP ツールの付与方針

Context7 は全員に付与する。GitHub は読み取り系ツールだけを列挙して付与する。guard-bash hooks の matcher は Bash のみであり、GitHub MCP の書き込みツールは state ゲートを迂回するため、サーバー単位では許可しない。Playwright は codiel-implementer-frontend、codiel-tester、codiel-reviewer-frontend にだけ付与する。未接続の MCP エントリは他に解決するツールがあるため無視されるだけで、未接続環境でも動作に支障はない。

### 文書系・分析系

| エージェント | 担当フェーズ | ツール権限 | 権限設計の意図 |
|---|---|---|---|
| `codiel-analyst` | init | Read, Grep, Glob, Write, Bash, Context7, GitHub Issue 読み取りツール | Issue 取得(gh issue view)と issue.md 執筆のみ |
| `codiel-architect` | discuss(アジェンダ作成)/ design | Read, Grep, Glob, Write, Context7 | **Edit なし・Bash なし** — コードを触れない |
| `codiel-test-designer` | test-spec | Read, Grep, Glob, Write, Edit, Context7 | spec.md / cases.md の新規作成と**更新**。書き込み先は hooks で `.codiel/specs/**` に制限 |
| `codiel-planner` | dev-plan | Read, Grep, Glob, Write, Context7 | **Edit なし・Bash なし** |

### 実装系(ドメイン別 3 体)

| エージェント | 担当 | ツール権限 | 権限設計の意図 |
|---|---|---|---|
| `codiel-implementer-frontend` | UI・画面・クライアントロジック | Read, Grep, Glob, Edit, Write, Bash, Context7, Playwright | 書き込みはドメインマップの frontend パスに hooks で制限 |
| `codiel-implementer-backend` | API・サーバーロジック | Read, Grep, Glob, Edit, Write, Bash, Context7 | 同 backend パスに制限 |
| `codiel-implementer-data` | スキーマ・マイグレーション・シード | Read, Grep, Glob, Edit, Write, Bash, Context7 | 同 data パスに制限。不可逆操作が多い領域なので Raguel の `plan/irreversible-ops`・保護パスと整合させる |

- 共通制約: **テストスクリプト(`.codiel/specs/**`)への書き込み禁止**(hooks)。
  git push / gh pr create は hooks が state ゲートで制御。
- ドメインを跨ぐステップは、開発手順書の段階でドメイン単位に分割することを `writing-dev-plans` が要求する。

### テスト系

| エージェント | 担当 | ツール権限 | 権限設計の意図 |
|---|---|---|---|
| `codiel-tester` | scripts/ の作成・修正、テスト実行、合否判定 | Read, Grep, Glob, Edit, Write, Bash, Context7, Playwright | **プロダクトコードと cases.md(期待値)は書かない** — スクリプトは直せるが期待値と実装は直せない。cases.md への書き込みは hooks が ask で機械的に検知、それ以外の境界はエージェント定義の職務規律で担保 |

### レビュー系(観点別 5 体・全員読み取り専用)

| エージェント | 観点 | 職務の焦点 | ツール権限 |
|---|---|---|---|
| `codiel-reviewer-frontend` | frontend | UI 実装・状態管理・アクセシビリティ・既存画面との一貫性 | Read, Grep, Glob, Bash, Context7, GitHub PR 読み取りツール, Playwright |
| `codiel-reviewer-backend` | backend | API 設計・エラーハンドリング・パフォーマンス・互換性 | Read, Grep, Glob, Bash, Context7, GitHub PR 読み取りツール |
| `codiel-reviewer-data` | data | スキーマ変更の妥当性・マイグレーションの可逆性・データ整合性 | Read, Grep, Glob, Bash, Context7, GitHub PR 読み取りツール |
| `codiel-reviewer-doc` | doc | 設計書/テスト仕様書/実装の相互整合・ARCHITECTURE.md との乖離・ドキュメント更新漏れ | Read, Grep, Glob, Bash, Context7, GitHub PR 読み取りツール |
| `codiel-reviewer-security` | security | 認可・入力検証・シークレット・依存脆弱性・インジェクション | Read, Grep, Glob, Bash, Context7, GitHub PR 読み取りツール |

- ツール権限は全員 Read、Grep、Glob、Bash、Context7、GitHub PR 読み取りツールである。frontend には Playwright も付与する。**Edit・Write なし**。
  所見はテキストで返し、PR への投稿(`gh pr review --comment` / 行コメント)は**オーケストレーターの職務**。
- diff のドメインに応じて frontend/backend/data を選択参加、**doc / security は常時参加**。並列ディスパッチ。
- 所見はオーケストレーターが統合して severity 順に review-<n>.md へ記録し、PR コメントに投稿。
- **critical / high は fix-loop で修正**、**medium / low は triage フェーズでユーザーの指示のもと別 Issue 化**(§2 [9])。

この分離により「テスターが期待値を緩めて合格させる」「レビューアーが自分で直して自己承認する」
という利益相反経路が権限レベルで存在しなくなる(Raguel の「自己評価は採用しない」原則のエージェント版)。

## 8. Hooks(決定論的な外壁)

Raguel が「成果物」を検査するのに対し、hooks は「行動」を検査する。相補的な二層防御。
`hooks/hooks.json` + 同梱スクリプト(node)で実装する。

| フック | 対象 | 内容 |
|---|---|---|
| PreToolUse | Bash(`gh pr create`, `git push`) | state.json を参照し、「テスト green + implement/test-loop が passed(PROCEED または human-approved の ASK)」でなければ **deny**。保護ブランチ(main 等)への push は常に deny |
| PreToolUse | Bash(`gh issue create`) | アクティブ run の現在フェーズが **triage でなければ deny**(ユーザーの指示なき起票の防止。§2 [9]) |
| PreToolUse | Bash(危険コマンド) | `rm -rf`(作業ツリー外)、`curl \| sh`、`git push --force` 等を deny。Raguel の `code/dangerous-patterns` はコード成果物を見るが、こちらは実行コマンドそのものを見る |
| PreToolUse | Edit / Write(`.codiel/runs/**/state.json`) | **deny**。state 遷移は `codiel-state` スクリプト経由のみ(§3) |
| PreToolUse | Edit / Write(フェーズ別書き込み制御) | アクティブ run の現在フェーズを参照し、フェーズと不整合な書き込みを **ask**(人間に確認)。例: 文書フェーズ(init/discuss/design/test-spec/dev-plan)中の `src/**` への書き込み、コードフェーズ(implement/test-loop/fix-loop)中の `.codiel/specs/**` の spec.md / cases.md(期待値)への書き込み。deny にしない(ask)のは、正当な例外書き込みでの誤爆に備えるため。**ドメイン単位の制御は、state.json の `domain`(`codiel-state` の `set-domain` / `clear-domain` で設定・解除する)を根拠に行う** — hooks はツール呼び出しの発行元エージェントを識別できないため、エージェント名ではなく**宣言された domain** を境界の根拠にする。コードフェーズ中に `domain` が設定されているとき、ARCHITECTURE のドメインマップにあるそのドメインの glob に一致しない書き込みは **ask**(ドメイン名がマップに無いときも ask)。`domain` が無いとき・ドメインマップが読めないときは境界を課さない |
| SubagentStop | 各フェーズ完了時 | 期待される成果物ファイルが存在し空でないかを検証。欠けていればフィードバックを返して差し戻す |
| Stop | メインセッション | アクティブ run が `completed` / `stopped` / `awaiting_human` / `awaiting_outcome` 以外の状態で停止しようとしたら block し「run が未完了。継続するか、明示的に中止せよ」と通知(尻切れ完了宣言の防止) |

## 9. docs(プロジェクト毎に成長するハーネス資産)

対象プロジェクトに配置するハーネス資産。`/codiel:init`(`initializing-harness` スキル)が
初期化する: `.codiel/` 配下のディレクトリは同スキルが呼ぶ `scripts/install-harness.sh` が
機械的に配置し、ARCHITECTURE(ドメインマップだけの最小構成)/ CLAUDE.md / raguel.config.yaml は
聞き取り(ドメイン分割と保護パス)の回答から生成する(既存ファイルは不足分のみ追記)。
GOTCHAS は `/codiel:init` の対象ではなく、失敗を記録する時点で `recording-gotchas` が台帳ごと作成する。
`/codiel:run` は資産配置を行わず、未初期化を検出したら `/codiel:init` を案内して終了する。

以下 2 節の見出しは既定パスであり、`metatron.config.json` で変更されうる。
本節が記す ARCHITECTURE の節構成と GOTCHAS のエントリ書式は執筆当時の設計であり、
現行の正本はファイル契約(`harness-docs/design/2026-08-16-file-contract-freeze.md` §4・§6)である。
**以下の列挙は当時の決定の記録として残す。現在の仕様として参照しない** ——
節構成は契約 §4-1 の 10 節に、GOTCHAS のエントリ書式は契約 §6 の新書式に置き換わっている。

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
- 全フェーズのサブエージェントが作業前に必読(ディスパッチプロンプトで強制)
- Raguel の判例ストア(判定側の記憶)と GOTCHAS(生成側の記憶)で両輪の成長ループを構成する

### CLAUDE.md(← CLAUDE.example.md)

上記 2 つを適切に運用するための決まり。

- 作業前に ARCHITECTURE.md を読む。GOTCHAS.md の該当エントリを確認する
- 失敗したら recording-gotchas の基準に従い GOTCHAS.md に追記する
- `.codiel/runs/**/state.json` を直接編集しない(codiel-state 経由のみ)
- Raguel ゲートは省略しない。ASK / STOP には従う
- ARCHITECTURE.md が現実と乖離したら更新する(乖離の放置は GOTCHAS 行き)
- テスト仕様書(`.codiel/specs/`)は機能の一部。機能を変えたら仕様書とケースも更新する
- PROCEED した変更が原因で実害(障害・リグレッション)が出たら、必ず incident として申告し
  `record_outcome(incident)` を記録させる(自動検知できない唯一の結末であり、最も価値の高い失敗判例)

## 10. ディレクトリ構成(プラグイン側)

```
plugins/codiel/
  .claude-plugin/plugin.json
  commands/
    init.md                    # /codiel:init(薄い入口。initializing-harness を起動)
    run.md                    # /codiel:run <issue番号>(薄い入口。orchestrating-runs を起動)
    test.md                   # /codiel:test [unit-id...](単独テスト実行。§5)
  skills/
    initializing-harness/SKILL.md(+ raguel.config.example.yaml)
    orchestrating-runs/SKILL.md
    raguel-gating/SKILL.md
    facilitating-design-discussions/SKILL.md
    analyzing-issues/SKILL.md
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
    filing-followup-issues/SKILL.md
    recording-gotchas/SKILL.md
  agents/
    codiel-analyst.md
    codiel-architect.md
    codiel-test-designer.md
    codiel-planner.md
    codiel-implementer-frontend.md / -backend.md / -data.md
    codiel-tester.md
    codiel-reviewer-frontend.md / -backend.md / -data.md / -doc.md / -security.md
  hooks/
    hooks.json
    scripts/                  # フックスクリプト(node)
  scripts/
    codiel-state.mjs          # state 遷移の検証つき CLI(§3)
    install-harness.sh        # .codiel/ 配下のディレクトリを機械的に配置(initializing-harness から呼ばれる)
  docs/
    DESIGN.md                 # 本書
  CLAUDE.example.md
  raguel-mcp/                 # 実装済み
```

## 11. 実装マイルストーン(案)

1. **M1 基盤**: `codiel-state` スクリプト(state 遷移検証)+ hooks 一式 + docs 3 点セットの example + install-harness.sh
2. **M2 骨格**: `/codiel:run` コマンド + `orchestrating-runs` / `raguel-gating` スキル + 文書系フェーズ(init〜dev-plan)のスキル・エージェント
3. **M3 実装系**: implementer 3 体 + `implementing` スキル + implement フェーズの Raguel ゲート統合
4. **M4 テスト系**: テスト資産モデル(specs/)+ tester + `scripting-tests` / `running-regression-tests` / `fixing-failures` + `/codiel:test` コマンド
5. **M5 レビュー系**: PR 作成 + reviewer 5 体 + `reviewing-diffs` / `fixing-review-findings` + fix-loop + triage(`filing-followup-issues`)
6. **M6 成長機構**: `recording-gotchas` + outcome 自動同期 + try 再挑戦フロー
