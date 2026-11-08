# codiel 1.1 設計書: 作業の担い手を書かず、run で決まった設計を持続層に残す

- 日付: 2026-11-08
- 対象: plugins/codiel
- バージョン: 1.0.1 → 1.1.0(マイナー。ユーザーの予定表の表記は 1.1)。実装中は 1.1.0-dev とする
- 前提の ADR: ADR-004・ADR-006・ADR-009・ADR-013
- 後続: 1.2(`harness-docs/design/2026-11-08-codiel-1-2-workflow-modes-design.md`)は、この改修を前提にする

## 0. 決まったこと

ユーザーと次を決めた。再検討しない。

| 番号 | 改修 | 決定 |
| --- | --- | --- |
| D1 | 1 | codiel は作業の担い手(委譲するか、誰に委譲するか)を書かない。書くのは、作業の単位・入出力・書いてよい範囲の契約だけである。委譲するかどうかはプロジェクトの運用方針(better-agentics・agent-policy など)に従い、方針が無ければ Claude Code の既定の判断に任せる |
| D2 | 2 | run で決まった設計を持続層に設計資料として残す。AI が開発中に必要に応じて読むものとし、読み方の規律は書かない |
| D3 | 2 | 新しい run に知らせるのは、持続層の位置だけとする。設計資料は持続層の中に置き、設計資料専用の案内は足さない |
| D4 | 2 | 設計資料は Markdown だけで書き、図が必要な箇所には Mermaid を使う。drawio / html の生成は持ち込まない |
| D5 | 2 | basic-design は単体のプラグインとして残し、codiel とは連携しない。codiel が取り込むのは basic-design の観点(各種別で何を書くか)だけである |
| D6 | 2 | 設計資料は種別ごとに 1 ファイルに分ける |
| D7 | 2 | 軽量 run でも設計資料を更新する |
| D8 | 1 | コミットと worktree の扱いは codiel が定める。agent-policy や better-agentics の規律とぶつかるなら、両プラグインの規律を改める。改める範囲は codiel の run の中に限らない。食い違いは `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md` にまとめる |
| D9 | 3 | codiel が対応する GitHub の Issue と PR には、ラベル `codiel` を付ける。人が作った既存の Issue でも、codiel が対応するなら付ける。GitHub には codiel と関係の無い Issue もあるので、codiel が拾う範囲をこのラベルで区切る |

ユーザーは、委譲の指示が運用方針とぶつかって困った場面は無かったと述べている。改修 1 の動機は実害ではなく、責務の分け方である。誰が・どのモデルで・いつ作業するかはプロジェクトの運用方針に任せ、codiel は何をするかだけを書く。

D1 は、codiel の手順書が定める作業に当てる。1.2 の Workflow モードでは、ユーザーが「Workflow が起動したエージェントがサブ intent ごとに作業する」「レビューと修正の Workflow を回す」と決めた(1.2 の D4・D6)。Workflow のスクリプトで起動するエージェントの構成は、そのモードの定義であり、D1 の対象から外れる。

## 1. 改修 1: 作業の担い手を書かない

### 1.1 1.0.1 には担い手を決め打つ記述が 6 種類ある

codiel は ADR-004 以降、委譲先の定義名・モデル・effort を書いていない。`plugins/codiel/` の skills・references・commands・assets・README・docs を `subagent_type`・`effort`・`opus|sonnet|haiku`・`model:` で grep した結果も 0 件だった。それでも、次の 6 種類では担い手を決め打っている。表の行番号は `skills/orchestrating-runs/SKILL.md` の位置である。

| 記号 | 箇所 | 内容 |
| --- | --- | --- |
| A | `:394` | 運用方針が無ければ、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ送る |
| B | `:161-177` のフェーズ表の列「委譲の種別と作業内容」と、`references/phase-*.md` | test-spec、test-code、implement(worktree で並列)、implement のタスクレビュー、test-loop の修正、review(観点ごとに並列)、fix-loop、`e2e/` の実行を委譲すると決めている |
| C | `:341-373` の依頼文テンプレート | 冒頭が「あなたはサブエージェントである」で、末尾に「セッションの規律の転記」がある |
| D | `:383` | 委譲先だけが使う 5 スキル(`writing-test-specs`・`scripting-tests`・`implementing`・`fixing-failures`・`reviewing-diffs`)の本文を、オーケストレーターは読まない |
| E | `:313-319`(§3 の冒頭)、`:47`、`:273`、`skills/facilitating-design-discussions/SKILL.md:14` | オーケストレーターはコード・`spec.md` / `cases.md`・タスクレビュー・review の所見を自分で書かずに委譲する、と義務づけている。pr の前の確認は「担当のサブエージェントに差し戻す」、§0 は「サブエージェントには解決させない」と書く |
| F | `:246`、`:257`(2.1 のコミットの規約) | 文書系フェーズでは「委譲先は git 操作をしない」。コード系フェーズでは「委譲先が自分の変更を自分でコミットし、オーケストレーターのコミットは worktree のブランチの merge と E2E のレポートだけ」 |

B〜F は、運用方針の規律と理屈の上で食い違う。

- better-agentics は、調査・設計・実装を自分で行い、委譲を review・split・stuck に限る(B・E と食い違う)。
- better-agentics では、C の冒頭の一文を起動時に自動注入するため、依頼文には書かないと定めている。
- agent-policy は「サブエージェントに毎タスクの git commit はさせない。バッチの最後にオーケストレーター側で行う」と定める(`plugins/agent-policy/references/orchestration-discipline.md:221`)。better-agentics の split も、git commit を自分だけが行うと定める(`plugins/better-agentics/skills/orchestration/SKILL.md:113-128`)。どちらも F の「委譲先が自分の変更をコミットする」と食い違う。
- better-agentics の split は worktree を使わず、書き込むファイルが重ならない作業を同じ作業ツリーで並列に進める。これは現行の「並列の委譲は 1 ステップ 1 worktree」(`references/delegation-env.md:5-17`)と食い違う。
- better-agentics は、レビュアーに原本と満たすべき要件だけを渡し、自分の結論を渡さないと定める(`plugins/better-agentics/skills/orchestration/SKILL.md:73`)。現行の再レビューでは、依頼文で「反論済み所見」の全件を渡している(`skills/orchestrating-runs/SKILL.md:362`)。

担い手(B・C・E)は運用方針に任せる(D1)。コミットと worktree(F、および並列作業での worktree)は codiel が定め、食い違う点については運用方針の規律を改める(D8)。

### 1.2 6 種類の記述を、作業の単位と契約に置き換える

- A を削り、方針が無いときの既定の委譲先は設けない。codiel は運用方針の有無を検出せず、セッションに注入された規律(または Claude Code の既定の判断)に従って担い手を決める。
- B のフェーズ表の列を「作業の単位と作業内容」に改める。
  - 各フェーズの作業を単位(仕様のディレクトリ・dev-plan のステップ・タスクレビュー・review の観点など)に分けて示す。
  - 単位同士を並列に進めてよい条件を書き、運用方針で並列化を判断する材料にする。条件は次の 3 つである。
    - 書き込むファイルが重ならない。
    - 互いの成果を入力にしない。
    - テストを実行する単位は、仕様のディレクトリに `parallel: true` があるものだけとし、同時に 4 件まで並べる(現行の `references/delegation-env.md:19-35`。テストがポートや DB を取り合うため)。
  - `codiel-state waves` のグループ分けは現行どおり使う。並列に進める単位は、担い手によらず、codiel の手順で作った worktree 内で作業する(現行の `references/delegation-env.md:5-17`)。
  - `references/phase-*.md` の「委譲を出す」「委譲先に」の記述は、「単位ごとに作業する」形に書き換える。
- C のテンプレートを「作業の契約」に改める。
  - 冒頭の一文と「セッションの規律の転記」のセクションを削る。
  - 契約には現行テンプレートの項目を引き継ぐ。含める項目は、作業内容、読むスキル、観点ファイル、入力ファイル、出力ファイル、前提(diff の範囲・ARCHITECTURE・実行モード・testsDir・担当タグ・担当範囲)、前フェーズの申し送り、書いてよい範囲と使ってよい tools、完了の条件(単位の変更が run ブランチに入っていること)である。
  - 再レビューの契約からは「反論済み所見」を外す。反論済み所見と同じ指摘が再び出たときは、オーケストレーターが再レビューの結果を受け取った後に除外する。
  - 委譲するときは、契約を依頼文にする。運用方針が依頼文に求める項目(役割・冒頭の一文・規律の転記・出力の形式など。agent-policy の `references/orchestration-discipline.md:136-145`)は、契約の前後に足してよい。codiel が定めるのは契約の中身である。自分で作業するときは、同じ契約を自分への作業指示として使う。
  - 委譲の種類に応じた条項(`:375-381` の使ってよい tools と書き込み先)は、単位の契約として残す。自分で作業するときも同じ範囲を守る。
- D を削り、5 スキルは担い手を問わず読めるようにする。
  - description と本文の「委譲先が」「サブエージェントが」は「担い手が」に書き換える。
  - 観点ファイルの選び方(`:385-388`)は、担い手が読むファイルの選び方として残す。
- E の義務づけを削る。オーケストレーターが自分で書くか委譲するかは、運用方針に任せる。
- F のコミットの規約は codiel が定めたまま、主語を「委譲先」から「担い手」に改める(D8)。
  - コード系フェーズでは、担い手が自分の変更を、作業しているブランチ(並列の単位は worktree のブランチ、直列の単位は run ブランチ)にコミットする。オーケストレーター自身が担い手のときも同じである。
  - worktree のブランチから run ブランチへのマージと、E2E レポートのコミットは、現行どおりオーケストレーターが行う。
  - 文書系フェーズの文書は、現行どおりゲートを通過した直後にオーケストレーターがコミットする。
  - agent-policy(`references/orchestration-discipline.md:221`)は委譲先にコミットさせない。better-agentics(`skills/orchestration/SKILL.md:113-128`)は委譲先にコミットさせず、worktree も使わない。どちらの規律も改める(D8)。この変更は両プラグインの改修として別に行う。

### 1.3 委譲の有無で分かれる仕組みは、委譲したときだけ働かせる

`codiel-state wait-add` は、バックグラウンドで委譲した作業の完了待ちを state の `waits[]` に記録する。stop-guard は、run が active で `waits` が空のときだけ停止を止める(`src/hooks/stop-guard.ts:12-16`)。完了通知を受け取るには一度ターンを終える必要があり、`wait-add` はその停止を正当なものとして通すために記録する。

| 仕組み | 1.1 の扱い |
| --- | --- |
| `wait-add` / `wait-done` と `waits/<id>.md` | 委譲したときだけ使う。自分で作業する間は待ちが生まれず、stop-guard が停止を止め続けるが、作業を続けるべき場面なのでそれで正しい。stop-guard は変えない |
| 出し直しの規則(`:332`) | 委譲したときだけ当てる |
| worktree(`references/delegation-env.md`) | 並列に進める単位は、担い手によらず、現行と同じ置き場・命名(`.codiel/worktrees/<slug>/<名前>`)の worktree で作業し、現行の後始末の手順に従う。オーケストレーターが自分で 1 つずつ処理するときも、並列の単位として登録したなら worktree を使う。直列の単位は run ブランチ上で作業する(現行の `serial` グループ)。`codiel-state waves` の計算は変えない |
| `set-domain` / `clear-domain` | 担い手によらず、ドメインに紐づく単位の作業の間は巻く |
| implement と test-code のタスクレビュー(`references/phase-implement.md:13`) | 作業の単位として残す。委譲するかは運用方針に任せる |
| 修正ループの続投(`references/phase-implement.md:14-16`) | 1〜3 ラウンドは同じ文脈で続ける。4〜5 ラウンドは、契約に「行き詰まりの打開」と書いた新しい単位にする。委譲するかは運用方針に任せる。自分で作業するときは、それまでの修正の方針を捨て、原因の調べ直しから始める |
| 報告のファイル(`report.md`・`test-run-<n>.md`・`steps/merge-fix-<g>/report.md`・e2e の `failure.md`) | 委譲したときは、現行どおり委譲先の返答からオーケストレーターが書く。自分で作業したときは、オーケストレーターが自分の結果から直接書く |
| `evaluate_*` がバックグラウンド化されたときの `gate-<フェーズ>-<回>` の待ち | 変えない(担い手と関係しない) |
| `codiel-state` のルート | 現行は cwd をそのままルートにする(`src/codiel-state.ts:840`)。オーケストレーターが自分で worktree 内の単位を作業し、メインセッションで `cd` が引き継がれると、run を見失う。そこで全コマンドのルートを `findMainRoot`(`src/hooks/lib.ts:654-659`)で解決する形に改め、`.codiel/runs/` はメインの作業ツリーにだけ置く |
| オーケストレーターの `cd` | メインセッションでは `cd` が次の呼び出しに引き継がれる。worktree を操作するときは単独の `cd` を使わず、`git -C <パス>` か `( cd <パス> && <コマンド> )` のサブシェルを使う |

### 1.4 自分で作業すると、review の独立性が下がり、文脈が増える

方針が無いプロジェクトで Claude Code が委譲を選ばなければ、review の観点ごとの所見も、実装したセッション自身が作ることになる。独立した目で読むかどうかは、運用方針の review 規律に任せる。better-agentics は review を委譲の理由に挙げているため、better-agentics を入れたプロジェクトでは委譲される。

また、自己実行では test-code・implement・review の作業がすべて 1 つのセッションの文脈に載る。文脈が圧縮された後に読み直す手順(`skills/orchestrating-runs/SKILL.md:230-236`)は、現行のまま使う。

## 2. 改修 2: run で決まった設計を持続層の設計資料に残す

### 2.1 置き場所は持続層の中の `docs/intents/design/` にする

- 設計資料は `docs/intents/design/<種別>.md` に置く。基準は repoRoot で固定し、設定では変えない。
- 既存の持続層 `docs/intents/domains/<領域>.md` と並べる。持続層はこの 2 つのディレクトリを指す。変更ごとの intent 文書(`docs/intents/YYYY-MM-DD-<slug>.md`)は持続層に含めない。
- 設定キー(`designDir` など)は作らない。
- `docs/intents/design/` は、intent-sync で最初の設計資料を書くときに作る。`codiel:init` では作らない。

### 2.2 種別は 6 つで、必要になった種別だけ作る

| ファイル | 種別 | 書く観点(basic-design から取り込む) | 図 |
| --- | --- | --- | --- |
| `data-model.md` | データモデル | エンティティ / 属性・キー / リレーション / 命名規約 | Mermaid の erDiagram |
| `api.md` | API 一覧 | エンドポイント / メソッドとパス / 認証 / リクエスト概要 / レスポンス概要 | 表。完全な JSON スキーマは書かない |
| `screen-flow.md` | 画面遷移 | 画面一覧 / 画面グループ / 遷移とトリガー / 開始・終了点 | Mermaid の flowchart か stateDiagram |
| `architecture.md` | システム構成 | ゾーン / ノード / 通信経路とプロトコル / 外部システム | Mermaid の flowchart |
| `sequence.md` | シーケンス | 1 ユースケース 1 セクション。登場するアクターとシステム / メッセージの順序 / 同期・非同期・応答の別 | Mermaid の sequenceDiagram |
| `nfr.md` | 非機能要件 | 8 分類(性能・拡張性 / 可用性 / セキュリティ / 運用・保守性 / 移行性 / 互換性・システム環境 / データ / コスト・体制)ごとに 要否 / 目標値・方針 / 備考 | 表 |

- 観点の出典は basic-design 0.6.2-dev である。データモデル・API 一覧・画面遷移・システム構成・シーケンスは、各スキルの SKILL.md の「観点」表(`plugins/basic-design/skills/{er-diagram,api-list,screen-flow,system-architecture,sequence-diagram}/SKILL.md`)から取る。非機能要件の 8 分類は `plugins/basic-design/skills/nfr-checklist/references/catalog.md` から取る。
- basic-design のファイルは実行時に参照せず、内容を codiel の書式の契約へ写す。プラグイン間で `src/` も指示層も参照しない規則に従うためである。
- run で初めてその種別に当たる変更を行ったとき(2.4 の判定)に、対応するファイルを作る。空のファイルや見出しだけのファイルは置かない。
- 各ファイルには「今のシステムの姿」を書き、変更の経緯(何をなぜ変えたか)は書かない。経緯は git の履歴と run の `design.md` に残る。
- 各ファイルの末尾に `## 由来` を置き、そのファイルを更新した intent のパスと取り込み日を並べる。持続層の領域ファイルの `## 由来`(`skills/syncing-intents/references/persistent-layer.md:16`)と同じ形にし、経緯の文は書かない。
- `knowledgeTarget` が `metatron` のプロジェクトでは、コードの層とディレクトリの構成を ARCHITECTURE に書く。`architecture.md` には実行時の構成(ゾーン・ノード・通信経路・外部システム)だけを書き、ARCHITECTURE と重なる内容は書かない。

### 2.3 書式の契約は intent-format.md にセクションを足して定める

- `references/intent-format.md` に「設計資料」のセクションを足し、2.2 の種別・観点・図の書き方・`## 由来` を定める。
- intent-format.md は書式の契約なので、変更時は `docs/format-change-checklist.md` の項目をすべて追随させる。

### 2.4 取り込みは intent-sync で、実装の差分を正にして行う

- 設計資料の更新は intent-sync フェーズで行う。手順の位置は、領域ファイルへの取り込み(`skills/syncing-intents/references/persistent-layer.md`)の後とする。
- 入力:
  - 標準 run は、`<runsDir>/<slug>/design.md` と run の差分(`<baseBranch>...<branch>`)。
  - 軽量 run は、run の差分と intent の `## 実装方針`。
- intent-sync の時点では実装が済んでいる。design.md と差分が食い違うときは、差分(実装された姿)を書く。
- 各ファイルの更新は、次の変更を含む run だけに絞る。該当するかはオーケストレーターが入力を読んで判定する。

| 種別 | 当たる変更 |
| --- | --- |
| データモデル | 永続化されるデータの構造の追加・変更・削除(スキーマ・マイグレーション・エンティティやモデルの定義) |
| API 一覧 | 外部から呼ばれる口の追加・変更・削除(ルーティング・ハンドラ・OpenAPI などの定義) |
| 画面遷移 | 画面の追加・削除と、画面間の遷移の変更 |
| システム構成 | コンポーネント・サービス・外部システム・インフラの構成と、それらの間の通信経路の変更 |
| シーケンス | 複数のコンポーネントにまたがる処理の流れの追加・変更 |
| 非機能要件 | intent や design.md で決めた性能・可用性・セキュリティなどの目標値や方針の追加・変更 |

- どの種別にも当たらない run(内部のリファクタリングなど)では、設計資料を更新しない。
- intent の `domains` が空でも、設計資料の更新は行う。設計資料は領域で分けていないからである。
- 設計資料は、run の差分と、それを読むのに必要な既存のコードの範囲だけから書く。初回の run でも、既存のシステム全体を書き起こさない。
- intent-sync のゲートは現行どおり `evaluate_design` とし、更新した設計資料を評価の対象に含める。
- 評価対象のパスは、intent・領域ファイル・設計資料(最大 6 件)を合わせると、Raguel の上限 20 件(`raguel-mcp/src/subject/files.ts:23` の `MAX_PATHS`)を超えうる。そこで上限を 50 件に引き上げる。この変更は、同じ上限を使う `evaluate_plan`(`raguel-mcp/src/tools/evaluatePlan.ts:16`)にも効く。本文の文字数の上限(`common/max-size`)は変えない。

### 2.5 新しい run には、持続層の位置だけを知らせる

- `assets/rules/codiel.md` の「文書の扱い」の持続層の行を、`docs/intents/domains/` と `docs/intents/design/` の 2 つを持続層とする書き方に改める。
- 同じ行にある「持続層を intent-sync の外で書き換えない」という規則は、設計資料にもそのまま適用する。finalize で ADR 候補と GOTCHAS 候補を書き足す例外は、領域ファイルだけに残す。
- intent フェーズと design フェーズに、設計資料を読む手順は足さない。
- `codiel:init` は `.claude/rules/codiel.md` が既にあれば触らない(`skills/initializing-harness/SKILL.md:120-125`)。このままでは既存のプロジェクトに変更が届かず、D3 が成り立たない。そこで `codiel:init` を次のように改める。
  - `.claude/rules/codiel.md` が既にあり、同梱の `assets/rules/codiel.md` と内容が違うときは、差分を示して置き換えるかを聞く。
  - README の移行手順に、1.1 へ上げたら `/codiel:init` を実行し直すことを書く。

### 2.6 guard-write の持続層の規則を設計資料へ広げる

現行の `src/hooks/guard-write.ts` では、`docs/intents/design/**` は `INTENT_DOC_RE`(`^docs/intents/[^/]+\.md$`)にも `INTENT_DOMAIN_RE`(`^docs/intents/domains/.+`)にも当たらない。そのため intent・discuss・design・test-spec・dev-plan・intent-sync のどの文書フェーズでも、`docs/` の接頭辞の規則で通っている(`guard-write.ts:53,60,342-366`)。

コード系フェーズ(carry-over・test-code・implement・test-loop・fix-loop)でも、`domain` が無ければ CODE_PHASES の分岐の末尾で通っている(`guard-write.ts:377-506`)。

1.1 では、設計資料への書き込みを intent-sync に絞る。`design/**` に当たる正規表現を足し、`INTENT_DOMAIN_RE` と同じく DOC_PHASES の分岐(`docs/` の接頭辞で通す)より前に置く。intent-sync では通し、それ以外のフェーズでは ask を返す。今は通っている文書フェーズとコード系フェーズの書き込みがどちらも ask に変わるので、両方のテストを足す。

### 2.7 現行コードとの接点と変更

| 対象 | 現行の挙動 | 1.1 での変更 |
| --- | --- | --- |
| `skills/orchestrating-runs/SKILL.md` §3・§4・2.1 | 委譲を義務づけ、委譲先がコミットし、方針が無ければ組み込みのエージェントへ送る(`:47,161-177,246,257,273,313-319,341-394`) | 1.2 のとおり作業の単位と契約に置き換える |
| `src/hooks/guard-write.ts` の `docs/intents/**` の規則 | `design/**` はどの規則にも当たらず、`docs/` の接頭辞か CODE_PHASES の末尾で通る(`:53,60,342-366,377-506`) | `design/**` の正規表現を足し、intent-sync だけで通す(2.6) |
| `raguel-mcp/src/subject/files.ts` の `MAX_PATHS` | 20 件(`:23`、検査は `:65-66`) | 50 件にする(2.4)。`raguel-mcp/docs/DESIGN.md:81-82` の「1〜20 件」の記述も直す |
| `src/codiel-state.ts` の `main` のルート(`:840`) | cwd をそのままルートにする | 全コマンドで `findMainRoot` で解決する(1.3) |
| `skills/raguel-gating/SKILL.md` の paths の件数 | 「1〜20 件」(`:69`) | 「1〜50 件」にする |
| `skills/syncing-intents/` と `references/phase-intent-sync.md` | `domains` が空なら取り込みを終える(`phase-intent-sync.md:16-17`) | 領域ファイルの取り込みの後に、`domains` の有無によらず設計資料の更新を行う形に分岐を組み替える |
| `references/intent-format.md` | 持続層は領域ファイルだけ | 設計資料のセクションを足す(2.3) |
| `assets/rules/codiel.md` | 持続層を `docs/intents/domains/` とだけ書く(`:8`) | 2 つのディレクトリを持続層とする(2.5) |
| `skills/initializing-harness/SKILL.md` | rules ファイルが既にあれば触らない(`:120-125`) | 差分を示して置き換えを聞く(2.5) |
| stop-guard、`codiel-state` のルート以外 | — | 変えない |

## 3. 改修 3: codiel が対応する Issue と PR に `codiel` ラベルを付ける

### 3.1 付ける場面

github モードで、codiel が対応する Issue と PR に、ラベル `codiel` を付ける(D9)。印の意味は「codiel が対応する」であり、誰が作ったかは問わない。

| 場面 | 現行 | 1.1 |
| --- | --- | --- |
| Issue 番号から始める run(`/codiel:run <番号>`)。人が作った既存の Issue を含む | ラベルを見ない | 取り込んだ Issue に `codiel` が無ければ、聞かずに足す(`gh issue edit <番号> --add-label codiel`)。run を作る前に行う |
| intent の承認時の Issue の起票(issue-craft の持ち込みモードと自前起票) | ラベルは任意(`references/handoff-contract.md` の `labels`) | その run が対応する Issue なので、`labels` に必ず `codiel` を含める |
| pr フェーズでの PR 作成(`references/phase-pr.md`) | ラベルの指定なし | `codiel` を付ける。既存の PR を `gh pr edit` で更新するときも、無ければ足す |
| triage での Issue 起票(`skills/filing-followup-issues/`) | ラベルの指定なし | 付けない。後続の作業を codiel が対応するかはまだ決まっていないためである。後でその Issue から run を始めたときに、上の 1 行目で付く |

- `codiel` ラベルの無い Issue は、codiel が自分から拾うことはない。1.1 の時点で Issue を一覧から拾う処理は無く、2.0 の Loop がこのラベルで拾う範囲を区切る。

### 3.2 ラベルの用意と強制

- リポジトリに `codiel` ラベルが無ければ、`codiel:init` で作るかを聞き、承認を得て作る。gh-utility の規律(存在しないラベルは作らない)とは別に、codiel 自身のラベルは codiel 側で用意する。
- run 中の `gh pr create`(GitHub MCP で PR を作成するツールを含む)に `codiel` ラベルが無ければ、guard-bash と guard-github-mcp で拒否する。現行の `<!-- codiel:generated -->` マーカーの検査(`docs/DESIGN.md` の hooks の表)と同じ扱いにする。run 中の `gh issue create`(triage)には、ラベルを求めない。
- ラベルだけを足す `gh issue edit --add-label` には本文が無いので、現行のマーカー検査には当たらない。
- intent 承認時の起票と Issue へのラベル付与は run を作る前に行うため、hook の対象外である。指示層(`skills/capturing-intent/`)で必ず行う。

## 4. 私の判断

次はユーザーとの合意ではなく、この設計書の執筆者(オーケストレーター)の判断である。

| 番号 | 判断 | 判断の軸 |
| --- | --- | --- |
| J1 | 置き場所を `docs/intents/design/` に固定し、設定キーを作らない | D3(持続層の位置だけで足りる)を満たし、intent と同じく repoRoot に固定する |
| J2 | 種別のファイル名を 2.2 の表のとおりにする | 内容を表す英語の名詞にする。basic-design の ER 図の出力先は `er/` だが、AI が名前から中身を推せる `data-model` を採る |
| J3 | 必要になった種別だけ作る | 空のファイルを置くと、読んだ AI が「設計がある」と誤解する |
| J4 | 取り込みを intent-sync で行い、設計資料には finalize の例外を広げない | 持続層を書くのは intent-sync で、finalize の例外は ADR 候補と GOTCHAS 候補のためのものである。設計資料には候補を書き足さない |
| J5 | design.md と差分が食い違ったら差分を正とする | 設計資料は「今の姿」を書く文書で、intent-sync の時点で実装は済んでいる |
| J6 | 書式の契約を intent-format.md に置く | 持続層の書式は既に intent-format.md で定めている |
| J7 | `wait-add` は委譲したときだけ使う | 待ちは委譲の仕組みで、担い手を書かない D1 と切り離せる。worktree は J10 のとおり担い手によらず使う |
| J8 | `set-domain` は担い手によらず巻く | ドメインの境界はステップの属性で、担い手の属性ではない |
| J9 | 設計資料の末尾に `## 由来` を置く | 領域ファイルと同じ形にし、どの intent が姿を変えたかを辿れるようにする |
| J10 | コミットの規約の主語を「担い手」に改め、並列の単位は担い手によらず worktree で進める | D8 で、コミットと worktree は codiel が定める。担い手が誰でも同じ規約が当たるようにする |
| J11 | `codiel:init` で既存の rules ファイルとの差分を示して置き換えを聞く | D3 は rules ファイルが届いて初めて成り立つ。既存のプロジェクトの利用者に手で写させない |
| J12 | 種別の判定基準を 2.4 の表で定め、判定はオーケストレーターが行う | 判定は design.md と差分の意味を読む作業で、コードの機械的な判定には向かない |
| J13 | 再レビューの契約から「反論済み所見」を外し、オーケストレーターが受け取った後に除く | better-agentics はレビュアーに自分の結論を渡さないと定める。除く働きはオーケストレーター側で保てる |
| J14 | Raguel の入力のパスの上限を 1.1 で 50 件に上げる | 設計資料を足すと、intent-sync の評価の対象が 20 件を超えうる |
| J15 | `codiel` ラベルは `codiel:init` で承認を得て作り、run での PR 作成時にラベルが無ければ hook で拒否する | ラベルの無いリポジトリでは付けられない。指示だけだと付け忘れが残る |
| J16 | triage で起票する後続の Issue には `codiel` を付けない | ラベルの意味は「codiel が対応する」で、後続の作業を誰が対応するかは起票の時点で決まっていない |

## 5. 採らなかった案

ユーザーが選ばなかった案を残す。再提案しない。

- 運用方針が無いときは、メインセッションが全作業を自分で行うと codiel に明記する案
- 運用方針が無いときの `general-purpose` / `Explore` への既定の委譲を残し、方針とぶつかる部分だけを消す案
- 図の生成の仕組み(basic-design の spec JSON → .drawio / .html)ごと codiel に移す案
- 吸収した後に basic-design を削除する案
- 設計資料を領域ごとのファイルに分け、中に種別のセクションを置く案
- 標準 run(design.md がある run)だけで設計資料を更新する案
- `.claude/rules/codiel.md` に設計資料専用の案内の行を足す案と、置き場所を設定キー `designDir` で変えられるようにする案(D3 で不要になった)
- 新しい run に設計資料の読み方の規律を書く案(D2)

## 6. 影響範囲

| 層 | 対象 |
| --- | --- |
| 指示層 | `skills/orchestrating-runs/SKILL.md`(§0・2.1・§3 の委譲・テンプレート・§4・pr の前の確認)と `references/`(`phase-*.md`・`delegation-env.md`・`review-common.md`・`resume.md`・`e2e.md`)、`skills/capturing-intent/SKILL.md`(現状調査の委譲)、`skills/facilitating-design-discussions/SKILL.md`、`skills/writing-dev-plans/SKILL.md`(test-spec の委譲と並行して書く記述)、`skills/fixing-review-findings/SKILL.md`、`skills/filing-followup-issues/SKILL.md`、`skills/running-regression-tests/SKILL.md`、`skills/raguel-gating/SKILL.md` と `references/parallel-gates.md`、`skills/syncing-intents/`、`skills/initializing-harness/SKILL.md`(2.5)、`commands/test.md`、5 スキル(`writing-test-specs`・`scripting-tests`・`implementing`(`references/e2e.md`・`references/worktree.md` を含む)・`fixing-failures`・`reviewing-diffs`) |
| 参照層 | `references/intent-format.md`(書式の契約。`docs/format-change-checklist.md` を追随させる)、`references/e2e-report-format.md`、`references/handoff-contract.md` |
| 素材 | `assets/rules/codiel.md` |
| 実装層 | `src/hooks/guard-write.ts` とそのテスト(2.6)。`src/hooks/guard-bash.ts`・`guard-github-mcp.ts` とそのテスト(3.2 のラベルの検査)。`src/codiel-state.ts` のルートの解決(1.3)。stop-guard は変えない |
| ラベル | `references/handoff-contract.md`(`labels` に `codiel`)、`skills/capturing-intent/`(Issue 起点のラベルの付与)・`skills/orchestrating-runs/references/phase-pr.md`(3.1)、`skills/initializing-harness/`(ラベルの作成) |
| 文書 | `README.md`(移行手順を含む)、`docs/DESIGN.md`、`docs/skill-flowcharts.md`、ルートの `README.md` |
| 配布宣言 | `.claude-plugin/plugin.json` と `package.json` を 1.1.0-dev にし、リリース時に 1.1.0 にする |
| 他のプラグイン(別の改修) | agent-policy の `references/orchestration-discipline.md` と better-agentics の `skills/orchestration/SKILL.md` を改める(D8)。何を改めるかは `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md` の G1〜G11 にある。どちらも改修したプラグインのバージョンを上げる |
| ARCHITECTURE | ADR-004 の決定のうち「方針が無い環境では general-purpose / Explore へ縮退する」(`harness-docs/ARCHITECTURE.md:252`)を改める ADR が必要になる。ADR-006 の影響範囲の「持続層 `docs/intents/domains/`」(`:312`)にも `docs/intents/design/` を足す。どちらも `metatron:updating-architecture` を起動して扱う |

## 7. 既知の限界

- 運用方針が無いプロジェクトでは、委譲の有無が Claude Code の既定の判断に左右され、run ごとにぶれる。
- run の外で行った変更は設計資料に反映されない。持続層は intent-sync の外で書き換えないからである。
- 種別の判定(2.4)はオーケストレーターの読解に頼るため、該当する変更を見落とすことがある。
- fix-loop は intent-sync の後にあるので、fix-loop で設計を変える修正は、次の run の intent-sync まで設計資料に載らない。

## 8. ビルダーに任せること

- `codiel` ラベルの色と説明文。

- 各スキルの文言の具体的な書き換え。
- intent-format.md の「設計資料」のセクションの書き方と、種別ごとの観点の細目。
- 種別ごとの Mermaid の図の種類の最終的な選択。
- `codiel:init` の差分の示し方。

## 出典

- ユーザーの予定表(2026-11-08 の会話で貼り付け): 「単体でのサブエージェント起動指示を廃止(プロジェクト運用に任せる方針) Amatsukaの中だとbetter-agenticsやagent-policy」「basic-designを吸収。持続層としてそのRunで決まった設計を整理して残すようにする。」
- 会話記録: `docs/chat/2026/1107/phyllis998/2356-codiel-1-1-to-2-0-design-kickoff.md`
