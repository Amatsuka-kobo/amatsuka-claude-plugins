# sandalphon プラグイン 設計書

- 作成日: 2026-08-16
- ステータス: ユーザーレビュー待ち
- 対象プラグイン:
  - `plugins/sandalphon/`(新規。`0.1.0-dev`)
  - `plugins/codiel/`(`0.4.1-dev` → `0.4.2-dev`。スキル 2 件の追記)
  - `plugins/gh-utility/`(`0.5.1-dev` → `0.5.2-dev`。スキル 1 件の追記)
- 前提資料:
  - `CLAUDE.md`(リポジトリ規約)
  - `plugins/codiel/README.md`、`plugins/codiel/skills/analyzing-issues/SKILL.md`、`plugins/codiel/skills/preparing-design-agendas/SKILL.md`
  - `plugins/gh-utility/README.md`、`plugins/gh-utility/skills/issue-craft/SKILL.md`、`plugins/gh-utility/references/github-issue-common.md`
  - `plugins/gh-utility/src/check-issue-env.ts`(環境検出スクリプトの既存パターン)

---

## 1. 背景・目的

### 1-1. intent 駆動開発とは

ここでいう intent(意図)とは、「ソフトウェアの現状(ASIS)」と「ユーザーがそれをどう変えたいか(TOBE)」を、
検証可能な受け入れ基準まで落として一つの文書に固定したものである。intent 駆動開発とは、
コードを書き始める前にこの intent を確定させ、以降の設計・実装・レビューをすべて intent への
参照で駆動する進め方を指す。

### 1-2. 解く問題

現状の Codiel は「GitHub Issue #N がある」ところから始まる。しかし実際の開発で最も欠落しやすく、
最も手戻りコストが高いのは、その **Issue が生まれる前の区間** である。

- ユーザーは「やりたいこと」を持っているが、それは断片的な要望であり、ASIS と接続されていない。
- ASIS を知らないまま書かれた Issue は、実現不能な要求や既に満たされている要求を含む。
- 「なぜその方針にしたか」の合意が Issue に残らないため、Codiel の discuss フェーズで同じ分岐が
  もう一度議論される(二度手間)。
- そもそも GitHub リポジトリを持たない小さな作業でも、intent を固定する価値は同じだけあるのに、
  Issue 起点のツールはそこに手が届かない。

sandalphon はこの上流区間を担当する。ユーザーの願いを聞き取り、ASIS と突き合わせて構造化し、
GitHub issue という形で実行系へ届ける。実行系が無い環境では、自前の軽量フローで完遂まで運ぶ。

### 1-3. 名前の由来

人間の祈り・願いを束ねて天へ届ける天使 Sandalphon に由来する。ユーザーの願い(TOBE)を束ね、
実行系(Codiel)へ届けるという役割そのものを表す。README に記載する。

### 1-4. 既存プラグインとの関係

| プラグイン | 担当区間 |
| --- | --- |
| **sandalphon** | 願い → intent 確定 → issue 起票 → 実行系への引き渡し(または軽量実行) |
| codiel | Issue #N → 設計 → 実装 → テスト → PR → レビュー |
| gh-utility | Issue の起票・分割・棚卸しという単機能ユーティリティ |

sandalphon は codiel の前段であり、置き換えではない。gh-utility の issue-craft は
「ユーザーが Issue を作りたいとき」に呼ぶ汎用スキルであり、sandalphon はその特殊化された
呼び出し元になる(§8-3)。

---

## 2. スコープ / 非スコープ

### 2-1. スコープ

- TOBE のヒアリングと構造化。
- intent に関係する範囲に限定した ASIS 探索。
- intent 文書の生成・保存・承認ゲート。
- 環境検出(git / remote / gh / Codiel ハーネス初期化状況 / 既存 intent 文書)。
- intent-issue フォーマットでの GitHub issue 起票(オプションフェーズ)。
- 実行経路の決定と引き渡し(Codiel 委譲 / 自前実行)。
- 自前実行フロー(テスト仕様 → TDD 実装 → ドキュメント更新 → 報告)。
- Codiel 2 スキル・gh-utility 1 スキルの連携改修。

### 2-2. 非スコープ

| 非スコープ | 理由 |
| --- | --- |
| 状態の永続化・中断再開機構 | Codiel の `.codiel/` state 機構は run の長さに見合うコストである。sandalphon の自前実行はワンセッションで終わる軽量フローであり、state 機構を持つと sandalphon が「小さい Codiel」に育つ。再開は intent 文書という成果物を入力に別セッションでやり直す形で足りる(§5-3)。 |
| プロジェクト全体の ASIS スナップショット生成 | 全体像は ARCHITECTURE の担当であり、それは metatron が管理する(Codiel 単体環境では `/codiel:init` が最小構成を作る)。intent と無関係な領域まで読むのはトークンの純損失で、しかも生成直後から陳腐化する。 |
| Codiel の実行フェーズ(設計 → PR → レビュー)の再実装 | Codiel があるならそれを使う。無い環境向けの自前実行は、Codiel の劣化コピーではなく「テスト仕様 → TDD → 報告」に絞った別物として設計する(§9)。 |
| Raguel MCP 相当の機械的ゲート | sandalphon のゲートは人間の承認 2 点のみ。機械判定の導入は Codiel の領分。 |
| GitHub 以外の issue トラッカー対応 | 現時点で需要が無い。intent 文書は保存されるため、他トラッカーへは人間が転記できる。 |
| PR 作成・レビュー | 自前実行は作業ツリーへの変更と報告までで終える。PR 化は既存の手段に委ねる。 |

---

## 3. 全体フロー

### 3-1. フェーズ図

```
/sandalphon:run "やりたいこと"
        │
        ▼
┌─ Phase 1: capturing-intent ────────────────────────────────┐
│  1. 環境検出(check-intent-env.mjs)                        │
│  2. TOBE ヒアリング(不足観点だけ 1 問ずつ)                │
│  3. ASIS 探索(intent 関連範囲のみ。既存文書 → コード)     │
│  4. 分岐の提示と合意(→「合意済み事項」へ蓄積)            │
│  5. intent 文書ドラフトを全文提示                           │
│                                                             │
│         ★ ゲート 1: intent 文書の承認 ★                     │
│           承認 → docs/intents/ へ保存(status: approved)   │
│           差し戻し → 2. へ戻る                              │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Phase 2: bridging-execution ──────────────────────────────┐
│  1. 起票可否の判定(git / remote / gh / 権限)              │
│  2. 実行経路の提示(1 回の質問にまとめる)                  │
│       (a) Codiel へ委譲   ※起票が必須                      │
│       (b) sandalphon 自前実行(起票する / しない)          │
│       (c) intent 文書だけ残して終了                        │
│  3. 起票する場合 → intent-issue を組み立て                  │
│       gh-utility あり → issue-craft(持ち込みモード)へ委譲 │
│       gh-utility なし → 自前で gh issue create             │
│       ※どちらの経路でも起票前の全文提示＋承認は必須         │
│  4. issue 番号 / URL を intent 文書へ追記(status: issued) │
└─────────────────────────────────────────────────────────────┘
        │
        ├── (a) Codiel 委譲 ──▶ `/codiel:run <番号>` を提示して終了
        │                        (以降は Codiel のフェーズとゲート)
        ├── (c) ────────────▶ 終了
        │
        ▼ (b)
┌─ Phase 3: executing-intent(汎用実行) ────────────────────┐
│  0. Codiel run との併存チェック(未完了 run があれば停止)  │
│  1. テスト基盤の判定(あり / なし)                        │
│  2. テスト仕様(基盤なしなら手動検証手順)を作成            │
│                                                             │
│         ★ ゲート 2: テスト仕様の承認 ★                      │
│           承認対象: ケース一覧 / 実行コマンド / 作業ブランチ│
│           以降は自律実行(設計判断の問いかけなし。          │
│           ただし §9-4 の安全境界に触れる操作は都度確認)    │
│                                                             │
│  3. TDD 実装(受け入れ基準単位で Red → Green → Refactor)  │
│  4. ドキュメント更新                                        │
│  5. 結果報告(intent 文書を status: done に更新)           │
└─────────────────────────────────────────────────────────────┘
```

### 3-2. ゲートの位置と根拠

承認ゲートを 2 点に絞ったのは、「取り消しコストが跳ね上がる直前」だけに置くという基準による。

- **ゲート 1(intent 文書)**: ここを誤ると以降のすべてが誤る。単一の最重要ゲート。
- **ゲート 2(テスト仕様)**: 自前実行での「完了の定義」を固定する点。ここを過ぎるとコードが書かれる。
- ゲート 2 以降(TDD 実装 → ドキュメント更新 → 報告)は自律実行する。テスト仕様が承認済みなら
  実装は仕様への追従作業であり、そこに人間の判断を挟んでも情報が増えないため。

なお **issue 起票そのものは外部公開行為であり、ゲートとは別に必ず承認を取る**(gh-utility 共通規律の
大原則と同じ)。ゲート 2 点という数え方は「フェーズを進めてよいかの判断点」の数であり、
外部公開行為の承認はそれとは独立に常に必要である。

### 3-3. 経路の直交性

「issue を起票するか」と「誰が実行するか」は独立した軸である。ただし
**Codiel 委譲を選ぶなら起票は必須**(`/codiel:run` は issue 番号を引数に取るため)。

| | 起票する | 起票しない |
| --- | --- | --- |
| Codiel 委譲 | ○(標準経路) | × (不成立。§10-2 のフォールバックへ) |
| 自前実行 | ○(記録を残したい場合) | ○(最小経路) |
| 実行しない | ○(issue だけ作って終わる) | ○(intent 文書だけ残す) |

---

## 4. プラグイン構成

### 4-1. ディレクトリツリー

```
plugins/sandalphon/
  .claude-plugin/plugin.json          name: sandalphon / version: 0.1.0-dev
  package.json                        private / name: sandalphon-scripts / version: 0.1.0-dev
  build.ts                            esbuild(gh-utility の build.ts と同型)
  src/
    check-intent-env.ts               環境検出スクリプト本体
    testing/run-ts.ts                 tsx 経由でスクリプトを子プロセス実行するテストヘルパ
    __test__/check-intent-env.test.ts vitest 単体テスト
  scripts/
    check-intent-env.mjs              バンドル出力(git 管理)
  commands/
    run.md                            /sandalphon:run の入口
  skills/
    capturing-intent/SKILL.md         Phase 1
    bridging-execution/SKILL.md       Phase 2
    executing-intent/SKILL.md         Phase 3
  references/
    intent-format.md                  intent 文書・intent-issue フォーマットの正本
    handoff-contract.md               外部スキルへの委譲に使う呼び出し契約の正本
    sandalphon-common.md              フェーズ間で共有する規律
  docs/
    rationale.md                      設計根拠(本設計書からの要約と、実装時に判明した経緯)
  README.md
```

`src/testing/run-ts.ts` は gh-utility に既にある同名ヘルパと同一内容になるが、プラグインは
独立して配布されるため共有せず複製する(プラグイン間のファイル参照は不可という制約と同じ理由)。

### 4-2. コマンド定義の責務

`commands/run.md`

- frontmatter: `description`(intent を聞き取り、構造化し、issue 化して実行系へ渡す旨)、
  `argument-hint: [やりたいこと]`。
- 本文の責務は **Phase 1 のスキルを Skill ツールで起動すること、フェーズ順序と経路分岐の骨格を
  示すこと、スキルを読まずに進めることを禁じること** の 3 点に限る。
- フェーズの中身(ヒアリングの作法、探索の作法、書式)は一切書かない。すべてスキルに置く。
  理由: コマンド定義は毎回コンテキストに載るが、スキル本文は必要になった時点で載る。
- 引数が空でも起動できる。空の場合は Phase 1 の冒頭で「何をしたいか」から聞く。

`/codiel:run` の既存コマンド定義と同じ構造(スキルへの委譲 + 「スキルを読まずに進めるのは禁止」)を
踏襲する。

### 4-3. スキルの責務・入出力・発動条件

#### skills/capturing-intent(Phase 1)

| 項目 | 内容 |
| --- | --- |
| 責務 | TOBE のヒアリング、intent 関連範囲の ASIS 探索、分岐の合意形成、intent 文書の作成とゲート 1 |
| 入力 | `/sandalphon:run` の引数、`check-intent-env.mjs` の JSON、対象プロジェクトの既存文書とコード |
| 出力 | `docs/intents/YYYY-MM-DD-<slug>.md`(`status: approved`) |
| 発動条件 | `/sandalphon:run` からの明示起動のみ。自律発火しない |
| 主要手順 | ①環境検出 ②既存 intent 文書との重複確認 ③TOBE ヒアリング ④ASIS 探索 ⑤分岐の提示と合意 ⑥ドラフト全文提示 ⑦ゲート 1 ⑧保存 |

ヒアリングの規律は issue-craft の手順 4 に倣う。**不足している観点だけを 1 問ずつ**聞き、選択式で
聞ける場面は AskUserQuestion を使う。埋まるべき観点は次のとおり。

- 何を達成したいか(TOBE の中核)
- 今それができない理由・困っている具体的な場面(ASIS 側の課題)
- どうなったら「できた」と言えるか(受け入れ基準の種)
- 今回やらないこと(非スコープの種)

ASIS 探索の規律(§2-2 の非スコープと対になる実務ルール):

1. 既存文書を先に読む。優先順は **ARCHITECTURE**(`projectDocs.architecture` で解決したパス)
   → `CLAUDE.md` → **GOTCHAS**(`projectDocs.gotchas`)→ `README.md`。
   これらは人間が書いた要約であり、コードを読むより桁で安い。
   **パスは固定値で持たず、`check-intent-env.mjs` の解決結果を使う**(§7-3)。

   **注入済みの内容は読み直さない。** metatron が導入された環境では、SessionStart で
   ARCHITECTURE と GOTCHAS 要約がメインセッションに注入されている。既にコンテキストにある内容を
   Read で読み直すのは純粋な重複であり、注入済みならそれを ASIS の初期材料として使う。
   判定は「コンテキストに既にあるか」を見るだけでよく、metatron の導入検出は要らない。

   ただし次の 2 点に注意する。

   - **注入は縮退しうる。** metatron の注入はプラットフォームの文字数上限に収めるため、
     ARCHITECTURE が目次+要約に縮退したり、GOTCHAS が目次だけになったりする。
     縮退が明示されていて、かつ**全文が判断に必要なら `contextDocs` のパスを Read する**。
     「注入されていたから全部見た」と扱わない。
   - **注入はサブエージェントに継承されない。** ASIS 探索をサブエージェントへ委譲する場合、
     委譲先には注入が届かない前提で、**解決済みのパスを渡して読ませる**。
     「オーケストレーターが読んだから委譲先も知っている」は成立しない。
2. 文書で埋まらない部分だけコードを読む。探索範囲は TOBE に登場する語から辿れる範囲に限定する。
   Serena が利用可能なら優先して使う(`get_symbols_overview` / `find_symbol` /
   `find_referencing_symbols`)。利用できない場合は Grep / Glob / Read で代替する。
   sandalphon はどんなプロジェクトでも動くことを要件とするため、**対象プロジェクトに Serena が
   導入されている前提を置かない**。Serena の有無で探索の深さは変えず、手段だけを切り替える。
3. 探索を打ち切る基準: 「受け入れ基準を書ける」かつ「実装方針の選択肢を 2 つ挙げられる」状態に
   なったら止める。それ以上は設計フェーズの仕事である。

**ドメインマップを探索スコープの決定に使ってよい**(必須ではない)。
`projectDocs.domainsReadable` が `true` なら、ARCHITECTURE の `metatron:domains` は
「どのコードがどの関心事に属するか」の写像を持っている。TOBE が特定のドメインに閉じると
判断できる場合、そのドメインの glob に絞って探索すれば、範囲の決定が推測でなく
**プロジェクト自身の宣言**に基づく。ドメインマップが無い・読めない環境でも
探索は成立するため、これは強化であって前提ではない。

#### skills/bridging-execution(Phase 2)

| 項目 | 内容 |
| --- | --- |
| 責務 | 起票可否の判定、issue 起票の提案と実行、実行経路の決定 |
| 入力 | intent 文書のパス、Phase 1 が取得済みの環境 JSON |
| 出力 | issue の番号と URL(起票時)、intent 文書への追記、次に進む経路の決定 |
| 発動条件 | Phase 1 のゲート 1 通過後にのみ起動する |
| 主要手順 | ①起票可否の判定 ②経路の提示(1 回の質問) ③intent-issue の組み立てと起票 ④intent 文書の更新 ⑤引き渡し |

**issue 起票の提案は intent 確定時に 1 回だけ行う。** 断られたら以降のフェーズで再提案しない
(同じ提案の反復は体験を損ねるだけで情報を増やさない)。

**経路の質問文には品質差を 1 行で明示する。** 「Codiel 委譲はレビューとゲート付きの重い経路、
sandalphon の自前実行はレビューなしの軽量経路」という差をユーザーが知らずに選ぶと、
軽量経路を選んだ結果に対して重い経路の品質を期待してしまう。選択肢の提示時に次の 1 行を添える。

`(a) は設計・レビュー・PR まで含む重い経路、(b) はテストと実装だけの軽量経路でレビューは付かない。`

**Codiel 委譲を提示する前に Raguel MCP の可用性を確認する。** `/codiel:run` は各フェーズで
Raguel MCP のゲート(`evaluate_decision` 等)を通す設計であり、MCP サーバーが接続されていないと
run を開始できない。可用性はファイルシステムの事実ではないためスクリプトでは検出できず、
**自分の利用可能ツール一覧に `mcp__raguel__*` が含まれるかを確認する**(プラグイン導入判定と
同じ手法。§7-3)。含まれない場合でも委譲の選択肢は消さず、次の注記を添える。

`※ /codiel:run は Raguel MCP 接続が無いと開始しない。現在このセッションからは接続を確認できていない。`

選択肢を消さず注記に留めるのは、sandalphon のセッションで見えないだけで、ユーザーが別セッションで
接続済みという状況がありうるためである(引き渡し先は新しいセッションになる。後述)。

**Codiel への引き渡しはコマンド文字列の提示で行う。** 具体的には `/codiel:run <番号>` を提示し、
sandalphon のセッションはそこで終える。codiel の `orchestrating-runs` スキルを Skill ツールで
直接起動する案は採らない。理由は 3 つ。

1. 別プラグインの内部スキル名に結合すると、Codiel 側のリファクタで sandalphon が壊れる。
   コマンド名は利用者向けの公開インタフェースであり、内部スキル名より安定している。
2. Codiel の run は長く、独自のゲートを 10 個以上持つ。sandalphon のセッションに抱え込むと
   Phase 1 のヒアリング履歴と Codiel の全フェーズが同一コンテキストに積み上がる。
3. `/codiel:run` は未初期化時に `/codiel:init` を案内して止まるフェイルクローズド設計であり、
   その入口を迂回すべきでない。

**引き渡しの報告には「新しいセッションで実行する」ことを推奨する 1 行を含める。** sandalphon の
セッションには Phase 1 のヒアリング履歴と ASIS 探索の読み込み結果が積み上がっており、
そのまま Codiel の全フェーズを重ねるとコンテキストが早期に逼迫する。intent は issue として
外部化済みで、`/codiel:run` は issue 番号だけを入力に取るため、セッションを跨いでも情報は失われない。

`次は新しいセッションで /codiel:run 57 を実行することを推奨する(本セッションの文脈は issue #57 に外部化済み)。`

#### skills/executing-intent(Phase 3)

| 項目 | 内容 |
| --- | --- |
| 責務 | テスト仕様の作成とゲート 2、TDD 実装、ドキュメント更新、結果報告 |
| 入力 | intent 文書、issue 番号(あれば) |
| 出力 | 作業ツリーへの変更、テスト、更新されたドキュメント、結果報告、`status: done` の intent 文書 |
| 発動条件 | Phase 2 で「自前実行」経路が選ばれたときのみ |
| 主要手順 | §9 参照 |

### 4-4. references の責務

- `references/intent-format.md`: intent 文書と intent-issue の**唯一の正本**。3 スキルすべてが読む。
  書式を変えるときはここだけを直す。
- `references/handoff-contract.md`: 外部スキルへの委譲に使う**呼び出し契約**の正本。現時点の
  内容は issue-craft 持ち込みモードの契約(§8-3)のみ。intent の書式(`intent-format.md`)とは
  変更の頻度も影響範囲も異なるため、ファイルを分ける。
- `references/sandalphon-common.md`: フェーズ間で共有する規律。
  - ディスカッションの言語はユーザーの使用言語に従う。intent 文書・issue 本文の言語は別途確認する。
  - 外部から見える操作(起票・ラベル付与)はユーザーの明示承認を得るまで行わない。
  - STOP するときは「理由」と「次にユーザーがすべきこと」を必ず伝える。
  - 環境 JSON の読み方と、各フィールドが false のときに畳む経路の対応表(§10-1)。
  - 失敗時は生のエラーを報告して停止する。勝手なリトライも代替手段への切り替えもしない。

gh-utility の `github-issue-common.md` と同じ構成を採る。ただし内容は複製せず、sandalphon が
gh-utility に委譲する場合は issue-craft 側の規律がそのまま効く。自前起票の場合に必要な最小限
(承認必須・`--body-file` 経由・失敗時の扱い)だけを `sandalphon-common.md` に書く。

---

## 5. intent 文書仕様

### 5-1. 保存先と命名

- 保存先: **対象プロジェクトの** `docs/intents/YYYY-MM-DD-<slug>.md`。
- `<slug>` は TOBE を表す英小文字ケバブケース(例: `add-oauth-login`)。日本語プロジェクトでも
  slug は英字にする(ファイル名の可搬性のため)。
- 同日に同一 slug が既に存在する場合は `-2` を付す。上書きしない。
- `docs/intents/` が無ければ作成する。作成は intent 文書の保存時(ゲート 1 通過後)に行い、
  ゲート前にディレクトリを作らない。
- **git リポジトリでない場合**(`isGitRepo: false`)は基準にできる `repoRoot` が存在しない。
  この場合はカレントディレクトリ基準の `docs/intents/` を提案し、**保存前に絶対パスを提示して
  ユーザーの確認を取る**。git 外では sandalphon が「プロジェクトのルート」を推定できず、
  無確認で書くと意図しない場所(ホームディレクトリ直下など)にファイルを作る恐れがあるため。

`docs/` 配下に置く理由: intent はプロジェクトの資産であり、sandalphon をアンインストールしても
価値が残る文書である。ツール固有のドット付きディレクトリ(`.sandalphon/` 等)に隠さない。

### 5-2. セクション構成

```markdown
---
intent: v1
slug: add-oauth-login
created: 2026-08-16
status: approved
issue:
---

# intent: <一行で表した TOBE>

## ASIS

- <intent に関係する範囲の現状。関連ファイル・モジュールを添える>

## TOBE

- <達成したいこと 1(要求 1 件 = 1 行)>
- <達成したいこと 2>

## 受け入れ基準

- <機械的に YES/NO を判定できる基準 1>

## 実装方針

- <どの層をどう変えるか。影響範囲。想定手順>

## 合意済み事項

- <論点>: <採用した選択肢>(理由: <...>)

## 非スコープ

- <今回扱わない範囲>

## 未確定事項

- <推測で埋めずに残した疑問。無ければ「なし」>
```

各セクションの根拠:

- **ASIS / TOBE** — この plugin の中核。並べて書くことで「差分が実装対象」であることが自明になる。
  ASIS を先に置くのは、issue を初めて読む人の理解順に合わせるため。
- **受け入れ基準** — 「完了の定義」。書式は analyzing-issues の「受け入れ基準の変換」と同じ規律
  (人が雰囲気で判定する文にしない)を適用する。Codiel へ渡ったとき無変換で使えることを狙う。
- **実装方針** — 設計書ではなく方針。Codiel へ渡す場合は design フェーズの入力になり、
  自前実行では実装の道筋そのものになる。ゲート 1 の承認対象に含める(要件で確定済み)。
- **合意済み事項** — sandalphon の固有価値。ヒアリングで決着した分岐をここに残すことで、
  Codiel の discuss フェーズが**合意済みの分岐を再質問しない**(§8-2)。discuss が消えるわけでは
  なく、`## 未確定事項` 由来の論点や、既存コードの調査から新たに立つ論点は通常どおり残る。
- **非スコープ / 未確定事項** — それぞれ Codiel の `## 非スコープ` `## 不明点` に直結する。
  推測で埋めない規律は analyzing-issues の HARD-GATE と揃える。

frontmatter は文書ローカルのメタデータであり、**issue 本文へは転記しない**。

### 5-3. ライフサイクル

| status | 意味 | 遷移させる主体 |
| --- | --- | --- |
| `draft` | ドラフト提示中。ファイルとしては未保存 | (ファイルに現れない。概念上の状態) |
| `approved` | ゲート 1 を通過し保存された | capturing-intent |
| `issued` | issue 化された(`issue:` に番号または URL が入る) | bridging-execution |
| `done` | 自前実行が完了した | executing-intent |

- Codiel へ委譲した場合、intent 文書は `issued` のまま残る。以降の状態は issue と PR が持つため、
  sandalphon は追跡しない(状態の二重管理を避ける)。
- 別セッションでのやり直しは、`/sandalphon:run` に既存 intent 文書のパスを渡すことで行う。
  Phase 1 は既存文書を読み込んだ状態からヒアリングを再開する。これが「状態永続機構を持たない」
  という決定と両立する再開手段である。
- Phase 1 の冒頭で `docs/intents/` の既存ファイル一覧を確認し、TOBE が既存 intent と重なる場合は
  「既存を更新するか、新規に起こすか」をユーザーに確認する。重複した intent の乱立を防ぐ。
- **frontmatter の書き込みはスキルの責務である。** `status` と `issue` の更新は各フェーズのスキルが
  Edit ツールで行う。`check-intent-env.mjs` は intent 文書を**読み取るだけ**で、一切書き込まない
  (§7-1 の「事実だけを返す」契約と対になる規律)。スクリプトに書き込みを持たせると、
  検出のたびにファイルが変わる副作用が生まれ、テストも実行環境に依存するようになる。
- **再開の粒度はフェーズ単位である。** `/sandalphon:run <intent 文書のパス>` での再開は
  「どのフェーズから始めるか」までしか復元しない。Phase 2 の途中(起票の一部だけ完了)や
  Phase 3 の途中(3 件中 1 件だけ実装済み)という中間状態は表現しない。これは状態永続機構を
  持たないという決定(§2-2)の直接の帰結であり、中間状態の復元が必要な規模の作業は
  Codiel 委譲が適する。

---

## 6. intent-issue フォーマット仕様

### 6-1. 本文の構造

```markdown
<!-- intent:v1 -->

## ASIS
...
## TOBE
...
## 受け入れ基準
...
## 実装方針
...
## 合意済み事項
...
## 非スコープ
...
## 未確定事項
...

<!-- intent-source: docs/intents/2026-08-16-add-oauth-login.md -->
```

- **`<!-- intent:v1 -->` を含める。書き出す位置は 1 行目を推奨する。** HTML コメントなので
  GitHub 上では表示されない。
  **検知側は本文全体を対象にマーカーを探し、位置の制約を課さない。** Issue テンプレートが
  ヘッダ行やチェックボックスを前置する場合、マーカーが本文の中ほどに落ちることがあり、
  「先頭 N 行以内」のような位置条件を課すと intent issue を取りこぼす。取りこぼしの損失
  (写像が効かず精度が落ちる)は、誤検知の損失(本文中に文字列が偶然現れる)より確実に大きい。
  マーカーは HTML コメント形式で十分に特徴的であり、偶然の一致は実質的に起きない。
- **見出しは `##` レベル、名称と順序は intent 文書と完全に一致させる。** 一致させることで、
  Phase 2 の転記は frontmatter を落として見出し以下をそのまま貼る機械的作業になり、
  転記時の要約・加工が入り込む余地が無くなる。
- **末尾に `<!-- intent-source: <相対パス> -->`。** issue から intent 文書へ辿れるようにする。
  パスは対象リポジトリのルートからの相対パス。
- タイトルは intent 文書の `# intent: <...>` の内容をそのまま使う(`intent:` の接頭辞は外す)。

### 6-2. バージョニング

`v1` はフォーマットのバージョンである。見出しの追加・削除・改名を行う場合は `v2` に上げ、
検知側は自分が知らないバージョンを見たら「intent issue だが未知のバージョン」として扱い、
機械的写像をせず本文全文を原文として扱う既定動作に落とす。これによりフォーマット更新時に
古い Codiel が誤った写像をしない。

### 6-3. 正本と写しの管理方針

プラグインはそれぞれ独立してインストールされ、インストールパスが不定であるため、
**プラグイン間のファイル参照はできない**。したがって正本と写しを分けて管理する。

| 場所 | 内容 | 分量 |
| --- | --- | --- |
| **正本**: `plugins/sandalphon/references/intent-format.md` | 全セクションの定義、書き方の規律、例、v1 の完全仕様 | 数十行 |
| 写し: `plugins/codiel/skills/analyzing-issues/SKILL.md` 内 | マーカー文字列、見出し名の一覧、issue.md への写像表 | 1 節(15 行程度) |
| 写し: `plugins/codiel/skills/preparing-design-agendas/SKILL.md` 内 | マーカー文字列、`## 合意済み事項` の扱い | 1 節(8 行程度) |
| **正本**: `plugins/sandalphon/references/handoff-contract.md` | 持ち込みモードの固定開始句と必須フィールド(§8-3) | 10 行程度 |
| 写し: `plugins/gh-utility/skills/issue-craft/SKILL.md` 内 | 固定開始句と必須フィールド、「持ち込まれた本文を改変しない」規律(intent の見出し名は持たない) | 1 節(15 行程度) |

写しに持たせるのは **「マーカーと見出し名の認識」に必要な最小限だけ** とする。書き方の規律・
理由・例は正本にのみ置く。写し側が仕様を語り始めると、正本を直しても写しが古いまま残り、
二重管理が破綻するため。

同期の運用: `intent-format.md` の冒頭に「この仕様を変更したら codiel の analyzing-issues /
preparing-design-agendas と gh-utility の issue-craft の該当節も更新する」というチェックリストを
置く。仕組みで担保はできないため、正本側にチェックリストを持たせるのが現実解である。

---

## 7. 環境検出スクリプト仕様

### 7-1. 位置づけ

`plugins/sandalphon/src/check-intent-env.ts` → `plugins/sandalphon/scripts/check-intent-env.mjs`。

gh-utility の `check-issue-env.ts` と同じ契約に揃える。

- 事実だけを JSON で stdout に出す。STOP するか等の**判断は一切行わない**。
- **読み取り専用である。** ファイル・ディレクトリの作成も更新も行わない(`docs/intents/` の作成も、
  intent 文書の `status` 更新も行わない。いずれもスキルの責務。§5-3)。
- どんな環境でも例外で落ちず **常に exit 0** で JSON を出力する。
- 引数は `[projectDir]`(省略時は `process.cwd()`)。
- 外部依存を持たない(esbuild でバンドルして単一 `.mjs` にする)。

判断をスクリプトに入れない理由: 判断はスキル(=モデル)側が文脈と併せて行うべきで、
スクリプトが STOP を返す設計にすると、スキルはその判断を覆せず、デグラデーション設計(§10)が
書けなくなる。

### 7-2. 検出項目

| フィールド | 型 | 検出方法 |
| --- | --- | --- |
| `isGitRepo` | boolean | `git rev-parse --is-inside-work-tree` |
| `repoRoot` | string \| null | `git rev-parse --show-toplevel` |
| `remoteUrl` | string \| null | `git remote get-url origin` |
| `repoSlug` | string \| null | remoteUrl から `owner/repo` を抽出。SSH / HTTPS 両形式、ホスト名は `github.com` 完全一致(check-issue-env.ts と同一の正規表現を用いる) |
| `ghInstalled` | boolean | `gh --version` の exit code(未導入時は ENOENT で `status: null` になる) |
| `ghAuthenticated` | boolean | `ghInstalled && gh auth status` の exit code |
| `templates` | object[] | `.github/ISSUE_TEMPLATE/` を解析した `{ file, name, about, title, labels }` の配列。gh-utility の `check-issue-env.ts` と**同一の実装パターン**(frontmatter / YAML のトップレベルキーのみ簡易抽出、`config.yml` は除外) |
| `blankIssuesEnabled` | boolean | `.github/ISSUE_TEMPLATE/config.yml` の `blank_issues_enabled`(既定 `true`) |
| `docRoot` | string | **ファイル契約のルート**。`metatron.config.json` を持つ最も近い祖先 → git ルート → cwd の順で決まる(§7-3) |
| `projectDocs` | object | `{ architecture, gotchas, domainsReadable, domainCount }`。パスは `metatron.config.json` 経由で解決する(§7-3) |
| `codielReady` | boolean | `codielHarness.dirExists && projectDocs.domainsReadable`(§7-3) |
| `codielHarness` | object | `{ dirExists, codielRoot, runDirs }`。**Codiel 固有資産のみ**。`.codiel/` は**開始ディレクトリから上方向に探索**する(codiel の `findProjectRoot` と同じ基準。§7-3)。`runDirs` は見つかった `.codiel/runs/` 直下のディレクトリ名(昇順、無ければ `[]`) |
| `intentsDir` | string \| null | `repoRoot/docs/intents` の存在(無ければ null。作成はしない) |
| `existingIntents` | object[] | `intentsDir` 配下の `*.md` を列挙し、frontmatter から `slug` / `status` / `issue` と `# intent: ` 行のタイトルを抽出 |
| `contextDocs` | string[] | 既存文書のうち存在するもののパス。ARCHITECTURE / GOTCHAS は **`projectDocs` の解決結果**を使い、固定パスを前提にしない。`CLAUDE.md` / `README.md` は `docRoot` 直下を見る |
| `testRunner` | object | テスト基盤の推定(§7-4) |
| `configWarnings` | string[] | `metatron.config.json` の解決で既定値へ落とした理由。空配列が正常。設定ファイルが無いことは警告にしない(ファイル契約 §2)。スキルは空でないときだけ 1 行報告に使う |

`existingIntents` の frontmatter 解析と `templates` の解析は、どちらも YAML パーサを導入せず
check-issue-env.ts と同じ「トップレベルのキーだけを行単位で抽出する」簡易方式にする。
intent 文書の frontmatter は本仕様で定めた 5 キーのフラットな構造に限られ、Issue テンプレートの
必要項目も同様にトップレベルに限られるため、簡易方式で十分である。

`templates` / `blankIssuesEnabled` を持たせるのは、**gh-utility が無い環境で sandalphon が自前起票を
行う経路**(§10-2)のためである。gh-utility へ委譲する場合は issue-craft 側が自前で環境チェックを
実行するため重複するが、委譲できない環境でテンプレートの存在に気づけないと、
テンプレート必須のリポジトリで起票が失敗する。重複実行のコストは 1 プロセス分であり、
経路ごとに検出項目を変える複雑さより安い。

### 7-3. Codiel / gh-utility の導入有無の扱い(重要な設計判断)

**プラグインの導入有無はスクリプトで決定的に検出しない。スキル側の判断に委ねる。**

検出できない理由:

- Claude Code のプラグイン導入状態は `~/.claude/plugins/installed_plugins.json` に記録されるが、
  これは内部形式であり、公開された契約ではない。形式変更で静かに壊れる。
- 同ファイルはキーが `plugin@marketplace` 形式かつ `projectPath` スコープ付きであり、
  `--plugin-dir` による直接指定や、設定側の有効/無効(`enabledPlugins`)は反映されない。
  すなわち「ファイルに載っている = そのセッションで使える」ではない。
- 「導入されているか」ではなく「**このセッションで実際に呼べるか**」が知りたい情報であり、
  それを正確に知っているのはモデル自身である。

したがって次の二段構えにする。

1. **プラグインが呼べるか** — スキル本文で「自分が利用可能なスキル・コマンドの一覧を確認する」
   と指示する。gh-utility の共通規律 §操作手段の決定 が「自分の利用可能ツール一覧を確認し」と
   書いているのと同じ手法であり、リポジトリ内に前例がある。
   - `codiel` の `/codiel:run`(または `orchestrating-runs` スキル)が一覧にあるか
   - `gh-utility` の `issue-craft` スキルが一覧にあるか
2. **対象プロジェクトが受け入れ可能な状態か** — こちらはファイルシステムの事実なので
   スクリプトが決定的に返す。具体的には `codielReady`(次項)。
3. **Raguel MCP に接続できるか** — スキル側で `mcp__raguel__*` の有無を確認する(§4-3)。
   MCP の接続状態もファイルシステムの事実ではないため、スクリプトでは扱わない。

#### ハーネス初期化の判定は複合条件にする

`.codiel/` ディレクトリの存在**だけ**では初期化済みと判定しない。`/codiel:run` が実際に
フェイルクローズドする条件は、ドメイン別 implementer / reviewer のディスパッチが依存する
**ARCHITECTURE のドメイン定義が読めること**にある。`.codiel/` の配下ディレクトリは
作られているのにドメイン定義だけ欠けている、という中途半端な初期化状態は現実に起こりうる。
`.codiel/` 単独判定ではこの状態を「初期化済み」と誤判定し、ユーザーは委譲を選んだ直後に
Codiel 側で止められる。

**文書と Codiel 固有資産は別のフィールドに分ける。** ARCHITECTURE / GOTCHAS は
Codiel 専属の資産ではなく、metatron が管理し、Codiel 単体環境でも最小構成が存在しうる
**プロジェクトの文書**である。したがって `codielHarness` に文書の可読性を含めず、
`projectDocs` として独立させる。

| フィールド | 判定 |
| --- | --- |
| `projectDocs.architecture` | 解決した ARCHITECTURE のパス(無ければ null) |
| `projectDocs.gotchas` | 解決した GOTCHAS のパス(無ければ null) |
| `projectDocs.domainsReadable` | ARCHITECTURE 内に **`metatron:domains`** を伴う JSON コードフェンスがあり、中身が JSON として parse でき、ドメインが 1 件以上ある |
| `projectDocs.domainCount` | parse できたドメイン数(parse 不能なら 0) |
| `codielHarness.dirExists` | **開始ディレクトリから上方向に探索して `.codiel/` ディレクトリが見つかる**(codiel 自身の `findProjectRoot` と同じ基準)。`docRoot` 直下だけを見ない — `docRoot` と `repoRoot` が分かれる構成で `repoRoot/.codiel` を見落とし、codiel が実際には動くのに委譲を畳んでしまうため |
| `codielHarness.codielRoot` | 上の探索で見つかった `.codiel` を持つディレクトリの絶対パス(見つからなければ null)。`runDirs` はこのルート基準で読む |
| `codielHarness.runDirs` | `.codiel/runs/` 直下のディレクトリ名(昇順。無ければ `[]`) |

**`codielReady = codielHarness.dirExists && projectDocs.domainsReadable`** とし、
委譲経路はこれが `true` のときだけ選択肢に出す。式の形は変えていない
——「Codiel の器がある」かつ「ドメイン定義が読める」の論理積であることは同じで、
後者の出所が文書側のフィールドに移っただけである。

#### パスはファイル契約で解決する

ARCHITECTURE / GOTCHAS のパスを固定値で持たない。`metatron.config.json` による
**ファイル契約**に従って解決する。規則は metatron 設計書 §5-4 の正本に従い、
`check-intent-env.ts` はその**独立実装**になる(ソースは共有しない。
プラグインのインストールパスが互いに不定であるため)。

1. **ルート解決**: `metatron.config.json` を持つ最も近い祖先 → `git rev-parse --show-toplevel`
   → cwd の順。結果を `docRoot` として返す。
2. `paths.architecture` / `paths.gotchas` を `docRoot` からの相対パスとして解決する。
   設定が無ければ既定値 `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md`。
3. 絶対パス・ルート脱出は拒否して既定値に落とす。

**ルート解決まで契約に含める**のが要点である。相対パスの解釈だけを揃えても、
基準ディレクトリが実装ごとに違えば同じ cwd から別のファイルに辿り着く。

#### 案内の分岐

いずれの場合も選択肢としては出さず、1 行の案内に留める(選ばせても必ず失敗するため)。
**案内先は metatron が使えるかで分岐する。**

| 状況 | 案内 |
| --- | --- |
| `dirExists: false` | 「`/codiel:init` を実行すると次回から Codiel へ委譲できる」 |
| `dirExists: true` かつ `domainsReadable: false`、**`/metatron:init` が利用可能** | 「ドメイン定義を読めない。`/metatron:init`(推奨)で ARCHITECTURE を整備すると解消する」 |
| 同上で **`/metatron:init` が利用不可** | 「ドメイン定義を読めない。`/codiel:init` がドメインマップだけの最小 ARCHITECTURE を生成できる」 |

metatron の有無の判定は、プラグイン導入検出ではなく
**`/metatron:init` が自分の利用可能コマンドにあるか**で行う(この節の二段構えと同じ手法)。

実装時の確認事項: ドメイン定義ブロックの正確な記法は metatron の
`references/architecture-format.md`(正本)に合わせる。記法が変わった場合に壊れるのは
`domainsReadable` の判定だけで、`dirExists` は残るため、誤って「初期化済み」と判定する側には倒れない(安全側に倒れる)。

### 7-4. テスト基盤の推定(`testRunner`)

```json
"testRunner": {
  "detected": true,
  "evidence": ["package.json:scripts.test", "vitest.config.ts", "src/**/__test__/*.test.ts"],
  "command": "pnpm test"
}
```

判定ルール(いずれか 1 つでも該当すれば `detected: true`):

1. `package.json` の `scripts.test` が存在する(`command` はパッケージマネージャを
   lockfile から推定して組み立てる。`pnpm-lock.yaml` → `pnpm test` 等)。
2. テストランナーの設定ファイルが存在する(`vitest.config.*` / `jest.config.*` / `pytest.ini` /
   `pyproject.toml` の `[tool.pytest]` / `go.mod` / `Cargo.toml`)。
3. テストファイルらしきパスが存在する(`**/*.test.*` / `**/*.spec.*` / `test_*.py` / `*_test.go`。
   `node_modules` と `.git` を除外し、検出は最大 200 ファイルで打ち切る)。

`evidence` を返すのは、Phase 3 がユーザーへ「この根拠でテスト基盤ありと判断した」と示せるように
するため。推定が外れたときにユーザーが即座に訂正できる。

### 7-5. 出力例

```json
{
  "isGitRepo": true,
  "repoRoot": "/home/user/proj",
  "remoteUrl": "git@github.com:owner/proj.git",
  "repoSlug": "owner/proj",
  "ghInstalled": true,
  "ghAuthenticated": true,
  "templates": [
    { "file": "bug_report.yml", "name": "バグ報告", "about": "不具合の報告", "title": "", "labels": ["bug"] }
  ],
  "blankIssuesEnabled": false,
  "docRoot": "/home/user/proj",
  "projectDocs": {
    "architecture": "/home/user/proj/docs/ARCHITECTURE.md",
    "gotchas": null,
    "domainsReadable": false,
    "domainCount": 0
  },
  "codielReady": false,
  "codielHarness": {
    "dirExists": true,
    "codielRoot": "/home/user/proj",
    "runDirs": ["2026-08-14-0031"]
  },
  "intentsDir": "/home/user/proj/docs/intents",
  "existingIntents": [
    { "file": "2026-08-10-add-cache.md", "title": "レスポンスキャッシュを入れる", "slug": "add-cache", "status": "done", "issue": "42" }
  ],
  "contextDocs": ["/home/user/proj/README.md", "/home/user/proj/CLAUDE.md"],
  "testRunner": { "detected": true, "evidence": ["package.json:scripts.test"], "command": "pnpm test" },
  "configWarnings": []
}
```

---

### 7-6. 制約と既知の限界

挙動として受け入れる制約。回避策を実装しないことを明示的な決定として記録する。

| 制約 | 内容 | 受け入れる理由 |
| --- | --- | --- |
| **GitHub 判定は `origin` の `github.com` のみ** | `origin` 以外の remote 名、GitHub Enterprise Server(自己ホストドメイン)、複数 remote 構成は `repoSlug: null` になり、issue 経路が畳まれる | gh-utility の `check-issue-env.ts` と**同一の制約**であり、リポジトリ内で挙動が揃う。intent 文書は保存されるため、該当環境でも上流の価値は失われない。畳まれた理由は §10-3 のとおり 1 行報告される |
| **frontmatter は 5 キー平坦のみ** | `intent` / `slug` / `created` / `status` / `issue` のトップレベル記法だけを解釈する。ネスト・複数行文字列・リストは解釈しない | 本仕様が生成する形に限れば十分。パース不能な既存 intent 文書があった場合は、そのファイルを `existingIntents` から落として続行し、**重複確認を出さない**。重複確認が出ないことによる不利益(intent が 1 件重複する)は、パースエラーで Phase 1 全体が止まる不利益より小さい |
| **monorepo は `repoRoot` 基準** | `docs/intents/` はリポジトリルート直下に固定する。パッケージごとのローカル intent(`packages/foo/docs/intents/`)は v1 では扱わない | intent は「ソフトウェアをどう変えたいか」の単位であり、変更が単一パッケージに収まる保証がない。ルート集約のほうが一覧性が高く、パッケージ横断の intent を置く場所に迷わない。パッケージローカル化が必要になった時点で v2 として検討する |
| **`docRoot` と `repoRoot` は一致しないことがある** | intent 文書は `repoRoot` 基準、ARCHITECTURE / GOTCHAS は `docRoot`(ファイル契約)基準で解決する。サブディレクトリに `metatron.config.json` を置いた構成では両者が別ディレクトリを指す | 2 つの基準は用途が違う。intent は sandalphon の資産でありリポジトリ単位に集約したい。文書は metatron / Codiel / sandalphon が共有する契約であり、契約側の規則に従わないと**同じ cwd から 3 者が別のファイルを読む**。用途ごとに基準を分けたうえで、フィールド名(`repoRoot` / `docRoot`)で区別する |

## 8. 連携仕様(既存プラグインの改修)

3 件の改修はいずれも**精度と体験の強化であり、必須ではない**。無改修でも連携は成立する
(analyzing-issues は issue 本文全文を `## 原文` へ写すため、intent の内容は失われない)。
この性質は各改修の記述にも明記し、「改修が入っていない Codiel と組み合わせても壊れない」ことを
保証する。

### 8-1. 改修 1: codiel / analyzing-issues

**追記場所**: `## 出力書式` の直後、`## 受け入れ基準の変換` の前に `## intent issue の写像` 節を新設する。

出力書式のすぐ後に置く理由: この節は「書式のどこに何を入れるか」の特例であり、書式の直後が
読み手にとって自然な位置である。チェックリストの手順 2〜6 の実行中に参照される。

**追記内容案**:

```markdown
## intent issue の写像

本文のどこかに `<!-- intent:v1 -->` があれば **intent issue** である(位置は問わない。
テンプレートのヘッダが前置されてマーカーが本文の中ほどに来ることがある)。この場合、
要件抽出を一から行わず、次の表のとおり**転記**する。intent issue は起票前に人間の承認を
経ており、セクションは既に構造化済みであるため、再解釈は精度を上げずに揺らぎだけを増やす。

| issue 本文のセクション | issue.md の写像先 | 扱い |
| --- | --- | --- |
| `## TOBE` | `## 要件` | 1 行 1 要求のまま**そのまま転記**する |
| `## 受け入れ基準` | `## 受け入れ基準` | そのまま転記する。機械的に YES/NO を判定できない行だけ `## 不明点` へ格下げする |
| `## 非スコープ` | `## 非スコープ` | そのまま転記する |
| `## 未確定事項` | `## 不明点` | そのまま転記する。「なし」だけなら何も写さない |
| `## ASIS` | (写像先なし) | `## 原文` に含まれるため十分。要件として写さない |
| `## 実装方針` | (写像先なし) | **`## スコープ` へ要約して落とさない**。`## 原文` に残す |
| `## 合意済み事項` | 条件付き | スコープの合意(「X は今回やる」「Y は後続 Issue」等)が含まれる場合のみ、その行を `## スコープ` / `## 非スコープ` へ**そのまま転記**する。それ以外の合意事項は要件にも不明点にも写さず `## 原文` に残し、discuss フェーズが読む |

**要約を伴う抽出をしない**のがこの写像の要点である。`## 実装方針` から `## スコープ` を導くには
文章の要約が必要で、要約は原文にない語を持ち込む。それは HARD-GATE の「発明の禁止」と
実質的に同じ危険を持つ。転記だけに限れば、写像元はすべて issue 本文の記述であり、
根拠は常に issue 側にあるため HARD-GATE に抵触しない。
`## スコープ` が結果として薄くなることは許容する(スコープの境界は通常の手順 5 で引く)。

### 適用順

- この写像は**既存チェックリストの手順 3(要求の写像)・手順 4(受け入れ基準の変換)に優先する
  特例**である。手順 1(取得)・2(原文の書き写し)・5(スコープ)・6(不明点)・7(出力)・
  8(自己チェック)は通常どおり実行する。
- **コメントは通常手順のまま扱う。** マーカーが指すのは issue 本文であって、コメントではない。
  本文より新しい仕様変更・合意がコメントに書かれている場合は、手順 1 の規律どおりコメントを読み、
  通常の要件抽出で反映する。本文の転記結果とコメントの内容が矛盾する場合は、
  どちらかを勝手に採らず `## 不明点` に「本文(intent)とコメントで <X> の扱いが食い違う」と記す。
- `intent:` のバージョンが `v1` 以外のときは写像せず、通常どおり本文から要件を抽出する
  (知らない書式を推測で写像しない)。
```

**Red Flags テーブルへの追加 1 行**:

| 思考 | 現実 |
|---|---|
| 「intent issue でも自分で読み直したほうが精度が上がる」 | intent の各セクションは起票前に人間が承認した確定情報である。読み直しは精度を上げず、承認済みの文言を analyst の言い換えに置き換えるだけで、人間が承認した内容と issue.md がずれる。 |

### 8-2. 改修 2: codiel / preparing-design-agendas

**追記場所**: `## 論点の粒度` の直後に `## 合意済み事項の継承` 節を新設する。

論点の粒度の直後に置く理由: この節は「何を論点にしないか」の規則であり、粒度の議論と同じ文脈に
属する。

**追記内容案**:

````markdown
## 合意済み事項の継承

`issue.md` の `## 原文` に `<!-- intent:v1 -->` と `## 合意済み事項` があるとき、そこに書かれた分岐は
**起票前にユーザーと合意済み**である。これらを論点として再提示しない。同じ分岐を二度議論させると、
ユーザーは既に払った判断コストをもう一度払うことになり、前回と違う結論が出れば intent 文書と
issue の内容が食い違う。

除外するのは**合意済みの分岐だけ**である。discuss フェーズ自体は省略しない。
`## 不明点`(intent の `## 未確定事項` 由来)の論点、および既存コードの調査から新たに立つ論点は
通常どおり全件を論点化する。

代わりに `agenda.md` の冒頭に `## 合意済みとして継承` 節を置き、各項目を 1 行で列挙する。

```markdown
## 合意済みとして継承

- <論点>: <採用済みの選択肢>(intent issue の合意事項。本 run では再議論しない)
```

例外: 既存コードの調査で、合意済みの選択肢が**実現不能または重大な副作用を持つ**と判明した場合は、
論点として立て直してよい。その論点の「背景」には「intent issue で <選択肢> に合意済みだが、
<根拠となる既存コードの事実> により再検討が必要」と明記する。合意の破棄はユーザーに気づかれる
形でのみ行う。
````

**HARD-GATE への追加**: 既存の 2 項目に次を足す。

```
- `## 合意済み事項` にある分岐を、再検討が必要な根拠(§合意済み事項の継承 の例外)を示さずに
  論点として立てない。
```

### 8-3. 改修 3: gh-utility / issue-craft

**追記場所**: `## 複数起票モード` の直前に `## 持ち込みモード` 節を新設する。

複数起票モードと同じ「モード」の並びに置くことで、標準手順(手順 1〜6)の後にモードの
バリエーションが並ぶ構造を保つ。

**追記内容案**:

````markdown
## 持ち込みモード

呼び出し元(他のスキル・エージェント)が**次の固定開始句**でこのスキルを起動したときに入る。

```
持ち込みモード: 以下の完成済み本文で起票
```

続けて次のフィールドを受け取る。`title` と `body` は必須で、欠けていたら持ち込みモードに入らず、
不足を呼び出し元へ報告して停止する(欠けた本文を補って起票すると、承認された内容と
起票される内容がずれる)。

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `title` | 必須 | Issue のタイトル(そのまま使う) |
| `body` | 必須 | Issue 本文の全文(そのまま使う) |
| `labels` | 任意 | 希望ラベル。リポジトリに存在しないものは付けない(共通規律) |

**判定は固定開始句の一致で行う。** 「完成済みの本文を渡された気がする」といった推測で
このモードに入らない。ユーザーが素の依頼(「issue にしといて」等)をしたときは入らない ——
このモードはブレストを飛ばすため、内容が練られていない依頼に適用すると
質の低い Issue がそのまま起票される。固定句を契約にすることで、この誤入りを構文で防ぐ。

| 手順 | 持ち込みモードでの扱い |
| --- | --- |
| 1. 環境チェック | 実行する |
| 2. 操作手段の決定 | 実行する |
| 3. 最初の確認 | テンプレートと言語の確認のみ実行する |
| 4. ブレインストーミング | **スキップする** |
| 5. ドラフト提示 → 明示承認 | **必ず実行する**(渡された本文を全文提示して承認を得る) |
| 6. 起票 | 実行する |

規律:

- **渡された本文を書き換えない。** 誤字の修正・整形・要約・見出しの並べ替えを行わない。
  本文には呼び出し元が解釈する機械可読マーカー(HTML コメント等)や見出し規約が含まれることが
  あり、善意の整形がそれを壊す。
- テンプレートの項目と持ち込み本文の見出し構成が衝突する場合(特に `blank_issues_enabled: false` で
  テンプレートの使用が必須のリポジトリ)は、黙ってどちらかに寄せず、衝突の内容を 1〜3 行で提示して
  **ユーザーに選択させる**。選択肢は「本文のまま起票する」「テンプレートに合わせて呼び出し元が
  作り直す」「テンプレートの項目を本文の末尾に追補して起票する」の 3 つ。
  本文には呼び出し元が解釈する構造が含まれるため、整形の判断をスキルが単独で行わない。
- 承認ゲートは省略しない。ブレストを省くのは内容が既に確定しているためであり、外部公開行為の
  承認が不要になるわけではない(共通規律の大原則)。
- ラベルは共通規律に従い、リポジトリの既存ラベルから提案する。呼び出し元がラベルを指定していても、
  リポジトリに存在しないラベルは作らない。
````

**description は変更しない。** このスキルは明示発動型であり、持ち込みモードへの入り方は
呼び出し元が本文を読んで知る。description に持ち込みモードの記述を足すと、通常の
「issue にして」という依頼での発動判定にノイズが乗る。

---

## 9. 自前実行フロー詳細(Phase 3)

### 9-1. 手順

0. **前提確認(Codiel run との併存チェック)**
   - `codielHarness.runDirs` が空でなければ `.codiel/runs/` に run の痕跡がある。未完了の run が残ったまま
     Phase 3 を走らせると、同じ作業ツリーを 2 つのフローが同時に触ることになり、Codiel の state と
     実際の変更が食い違う。
   - run ディレクトリの一覧を提示し、**未完了の run があるかをユーザーに確認する**。ある場合は
     Phase 3 を開始せず、「その run を完了させる」または「この intent も Codiel 側で扱う」ことを
     案内して停止する。
   - 「未完了かどうか」を sandalphon 側で判定しないのは、Codiel の run state の形式に結合しないため
     である(結合すれば Codiel の内部変更で sandalphon が静かに誤判定するようになる)。
     一覧という事実の提示までがスクリプトとスキルの責務で、判断はユーザーと Codiel が持つ。
1. **テスト基盤の確認**
   - `check-intent-env.mjs` の `testRunner` を読む。`detected: true` なら §9-2、`false` なら §9-3。
   - `evidence` と推定した実行コマンドをユーザーに 1 行で示す。訂正があればそれに従う。
     推定した実行コマンドは**ゲート 2 の承認事項に含める**(手順 3)。推定は根拠つきでも外れうるため、
     承認の場で 1 度だけ確実に訂正機会を作る。
2. **テスト仕様の作成**
   - intent 文書の `## 受け入れ基準` を 1 対 1 でテストケースに写像する。基準 1 件に対して
     ケースが 0 件になってはならない(自己チェック項目)。
   - 各ケースに「対象」「前提」「操作」「期待結果」を書く。期待結果は受け入れ基準の文言を
     そのまま使う(言い換えない)。
   - 出力先はテスト仕様の性質で分ける。自動テストなら実際のテストファイル(未実装のまま Red に
     なる状態)、手動検証手順なら intent 文書と同じディレクトリの
     `docs/intents/YYYY-MM-DD-<slug>-verify.md`。
3. **ゲート 2: テスト仕様の承認**
   - 次の 3 点をまとめて提示し、一括で承認を得る。差し戻されたら 2. へ戻る。
     1. テストケースの一覧(全文)
     2. **テスト実行コマンド**(`testRunner.command` の推定値と `evidence`)
     3. **作業ブランチ**(下記)
   - 承認後は完了までユーザーへ問いかけない。判断が必要な状況に至った場合は、勝手に決めず
     作業を止めて報告する(問いかけないことと、勝手に決めることは別である)。
     ただし §9-4 の安全境界に触れる操作は、承認後であっても都度確認する。

**作業ブランチ**: git リポジトリでは、ゲート 2 の承認時に作業ブランチを作成するのを**既定**とする。
名前は intent の slug を流用した `sandalphon/<slug>`。現行ブランチのまま作業するのは、
ユーザーが承認の場で明示的にそれを選んだときだけとする。

既定でブランチを切る理由: Phase 3 はレビューもゲートも持たない軽量経路であり、成果が意図と違った
ときに丸ごと捨てられる形にしておく価値が、ブランチ 1 本のコストを上回る。なお本リポジトリの
「原則ブランチは切らない」という規約は**このリポジトリの運用**であって、sandalphon が動く対象
プロジェクトの運用ではない。対象プロジェクト側にブランチ運用の規約があれば、承認の場で
ユーザーがそれを選び直せる。
4. **TDD 実装**
   - 受け入れ基準 1 件を 1 サイクルとして Red → Green → Refactor を回す。
   - 全基準が Green になるまで繰り返す。既存テストも毎サイクル走らせ、回帰が出たら
     そのサイクル内で直す。
   - 実装がテスト仕様と食い違う必要が出たときは、テスト仕様を先に直し、その差分を最終報告に含める。
5. **ドキュメント更新**
   - 更新対象の判定基準: 「今回の変更で記述が事実と食い違うようになった文書」だけを更新する。
     具体的には README(利用者が読まないと使えない情報が変わった場合)、`docs/ARCHITECTURE.md`
     (構造が変わった場合)、`CLAUDE.md`(AI 向けの規約が変わった場合)。
   - 該当が無ければ「更新対象なし」と報告する。文書を増やすこと自体を目的にしない。
6. **結果報告**
   - 報告内容: 受け入れ基準ごとの達成状況(達成 / 未達成 / 仕様変更)、変更したファイルの一覧、
     テスト実行結果、更新したドキュメント、残った未確定事項。
   - intent 文書の `status` を `done` に更新する。
   - コミットはしない(リポジトリの運用方針が sandalphon から見えないため)。変更は作業ツリーに
     残し、報告でその旨を明示する。

### 9-2. テスト基盤がある場合

既存の基盤に**合わせる**。ランナーの変更・追加、テストディレクトリ構成の変更、アサーション
ライブラリの追加を行わない。既存テストファイルの書き方(命名・配置・記述スタイル)を 1 つ読み、
それに揃える。

### 9-3. テスト基盤が無い場合

**テスト基盤を勝手に導入しない。** intent の `## TOBE` に「テストを整備する」旨が明記されている
場合のみ導入し、その場合は導入自体が実装対象になる。

明記が無い場合は次のとおり縮退する。

- テスト仕様の代わりに **手動検証手順** を作る。各項目は「何を実行し、何が見えれば OK か」を
  ユーザーが再現できる粒度で書く(コマンド、入力、期待出力)。
- ゲート 2 の承認対象はこの手動検証手順になる。
- TDD の代わりに「実装 → 手動検証手順を自分で実行 → 結果を記録」を受け入れ基準単位で回す。
  自分で実行できない項目(ブラウザ操作、外部サービス連携等)は、その旨を記して報告でユーザーに
  実行を依頼する。
- 報告に「このプロジェクトには自動テスト基盤が無いため手動検証で確認した」と明記する。
  検証の強度が下がっている事実を隠さない。

理由: テスト基盤の導入は依存追加・CI 設定・既存コードへの波及を伴う独立した意思決定であり、
「ついでに入れる」規模ではない。intent に無い変更を勝手に持ち込まない原則を優先する。

---

### 9-4. 自律実行の安全境界

ゲート 2 の承認は「このテスト仕様を満たす実装を進めてよい」という承認であって、
**リポジトリに対する任意の操作の白紙委任ではない**。次の操作は承認後であっても自律実行せず、
その場でユーザーに確認する。確認は 1 操作 1 回、何を・なぜ行うかを 2 行以内で示す。

| 操作 | 具体例 | 確認する理由 |
| --- | --- | --- |
| **secrets への接触** | `.env` / `.env.*` / 認証情報を含む設定ファイルの読み取り・作成・変更 | 値がセッションの文脈に載る。載った時点で取り消せない |
| **DB マイグレーション** | マイグレーションファイルの追加・適用、スキーマ変更コマンドの実行 | 適用は多くの場合不可逆で、開発用 DB でも失われるデータがある |
| **破壊的操作** | ファイル・ディレクトリの削除、`git reset --hard` / `git clean`、既存ブランチの強制更新、外部サービスへの書き込み | 作業ツリーの変更と違い、ブランチを捨てても復元できない |
| **依存パッケージの追加** | `package.json` 等への依存追加、ロックファイルの更新 | 供給網とライセンスに影響する意思決定であり、テスト仕様の承認に含意されていない |

判断基準は「**その操作は作業ブランチを捨てれば元に戻るか**」である。戻るなら自律実行してよく、
戻らないなら確認する。この 1 本の基準で表にない操作も判断できる。

この規律はゲート 2 の「承認後は問いかけない」と矛盾しない。問いかけないのは**設計判断**に
ついてであり、安全境界の確認は設計判断ではなく取り消し不能性への対処である。

## 10. エラー・デグラデーション設計

### 10-1. 基本方針

**経路の選択はグレースフルデグラデーション、承認はフェイルクローズド。**

- 使えない経路は選択肢に出さず、理由を 1 行添えて静かに畳む。エラーで止めない。
- 承認ゲートと外部公開行為の承認は、取れなければ必ず止まる。デグラデーションの対象にしない。

この 2 分割が重要なのは、両者を混ぜると「gh が無いから承認を省く」のような危険な縮退が
入り込むためである。

### 10-2. 状況別の挙動

| 状況 | 検出 | 挙動 |
| --- | --- | --- |
| git リポジトリでない | `isGitRepo: false` | issue 経路を提示しない。「git リポジトリでないため issue 起票は行わない」と 1 行報告。intent 文書は**カレントディレクトリ基準の `docs/intents/` を提案し、絶対パスを提示して確認を取ってから**保存する(§5-1)。Phase 3 へは進めるが、作業ブランチは作成しない(git 管理下でないため) |
| remote が無い / GitHub 以外 | `repoSlug: null` | 同上(理由の文言だけ変える) |
| `gh` 未導入 | `ghInstalled: false` | GitHub 操作系 MCP Tool が使えるならそちらを使う。無ければ issue 経路を提示せず理由を報告 |
| `gh` 未認証 | `ghAuthenticated: false` | 同上。報告に「`gh auth login` を実行すれば issue 起票も使える」と添える |
| gh-utility 未導入 | 利用可能スキル一覧に `issue-craft` が無い | 自前で `gh issue create --title <title> --body-file <一時ファイル>` を実行する。全文提示と承認は sandalphon 側で行う |
| Codiel 未導入 | 利用可能コマンド一覧に `/codiel:run` が無い | Codiel 委譲を選択肢に出さない。言及もしない(使えないツールの宣伝はノイズ) |
| Codiel 導入済み・`.codiel/` なし | `codielHarness.dirExists: false` | 委譲を選択肢に出さない。「`/codiel:init` を実行すると次回から委譲できる」と 1 行案内する |
| metatron 未導入(注入も CLI も無い) | 注入がコンテキストに無く `/metatron:init` も使えない | **何も畳まない。** ARCHITECTURE / GOTCHAS はファイル契約で読めるため ASIS 探索は通常どおり動く。Codiel 単体環境でも最小 ARCHITECTURE が存在しうる(§7-3) |
| Codiel 導入済み・ドメイン定義が読めない | `codielHarness.dirExists: true` かつ `projectDocs.domainsReadable: false` | 委譲を選択肢に出さない。案内先は **metatron の有無で分岐**する(§7-3): `/metatron:init` が使えるならそれを推奨、使えなければ `/codiel:init` の最小 ARCHITECTURE 生成を案内する |
| Raguel MCP が確認できない | 利用可能ツールに `mcp__raguel__*` が無い | 委譲の選択肢は**出す**。「`/codiel:run` は Raguel MCP 接続が無いと開始しない」の注記を添える(§4-3)。引き渡し先は新しいセッションであり、そちらで接続済みの可能性があるため消さない |
| Codiel の run が残っている | `codielHarness.runDirs` が空でない | Phase 3 に入る前に一覧を提示して未完了 run の有無を確認する。未完了なら Phase 3 を開始せず案内して停止(§9-1 手順 0) |
| Codiel 委譲を選んだが起票できない | 経路確定後に起票が失敗 / 不可 | **理由を提示し、選び直させる。** 選択肢は (a) 環境を直して `/sandalphon:run <intent 文書のパス>` で再実行 (b) 汎用実行(Phase 3)へフォールバック (c) intent 文書だけ残して終了。黙って Phase 3 へ落とさない —— ユーザーは Codiel の品質を期待して選んでいるため。**(b) を選んだ場合、同一セッションでは承認済みの intent をそのまま使い、ゲート 1 を再実施せずに Phase 3 へ直進する**(intent の内容は変わっておらず、再承認は同じ文書を二度承認させるだけになる) |
| 起票権限が無い | 起票時に GitHub が 403 等を返す | 事前検出しない(`gh auth status` は認証の有無しか示さず、対象リポジトリへの issue 作成権限までは保証しない)。起票時に判明したら上記「Codiel 委譲を選んだが起票できない」と同じ選び直しに合流する |
| テンプレートが必須で本文と衝突 | `blankIssuesEnabled: false` かつテンプレートあり | 自前起票の場合は衝突内容を提示して 3 択で選ばせる(§8-3 と同じ規律)。gh-utility へ委譲する場合は issue-craft 側が同じ処理を行う |
| 起票が途中で失敗 | `gh` の非 0 終了 | 生のエラーを報告して停止する。リトライも代替手段への切り替えもしない。intent 文書は保存済みなので再実行できる旨を添える(gh-utility 共通規律 §失敗時 と同じ扱い) |
| `docs/intents/` に書き込めない | 保存時の例外 | intent 文書の全文をセッション内に提示し、保存先をユーザーに確認する。文書を失わせない |
| ASIS 探索で対象が見つからない | 探索の結果 | 推測で ASIS を書かない。「該当する既存実装は見つからなかった(新規追加とみなす)」と ASIS に明記する |
| `/codiel:run` 実行後の失敗 | — | sandalphon の責務外。引き渡し時の報告に「intent 文書と issue が残っているため、Codiel 側で失敗しても intent からやり直せる」と明記しておく |
| テスト基盤が無い | `testRunner.detected: false` | §9-3 の手動検証手順へ縮退する |

### 10-3. 報告の書き方

畳んだ経路は**必ず 1 行で理由を報告する**。無言で選択肢を減らすと、ユーザーは
「sandalphon はそれができない」と誤解する。逆に理由を長々と書くと本題が埋もれるため、
1 行(理由 + 使えるようにする方法)に収める。

例: `gh が未認証のため issue 起票は行わなかった(gh auth login で有効になる)。`

---

## 11. テスト計画

### 11-1. vitest 単体テスト(`plugins/sandalphon/src/__test__/check-intent-env.test.ts`)

gh-utility の `check-issue-env.test.ts` と同じ手法を採る。`src/testing/run-ts.ts` で tsx 経由の
子プロセス実行を行い、stdout の JSON を検証する。一時ディレクトリに `git init` した実リポジトリを
作り、`PATH` を差し替えて `gh` の有無を擬似する。

| # | ケース | 期待 |
| --- | --- | --- |
| 1 | git リポジトリでないディレクトリ | `isGitRepo: false` / `repoRoot: null` / `repoSlug: null`、exit 0 |
| 2 | remote 未設定の git リポジトリ | `isGitRepo: true` / `remoteUrl: null` / `repoSlug: null` |
| 3 | SSH 形式の GitHub remote | `repoSlug: "owner/repo"` |
| 4 | HTTPS 形式(`.git` 有り / 無し) | 両方とも `repoSlug: "owner/repo"` |
| 5 | GitHub 以外の remote(GitLab、`notgithub.com`) | `repoSlug: null` |
| 6 | `gh` が PATH に無い | `ghInstalled: false` / `ghAuthenticated: false`、例外を投げず exit 0 |
| 7 | `gh` スタブが exit 0 を返す | `ghInstalled: true` / `ghAuthenticated: true` |
| 7 補 | `gh` はあるが `auth status` が非 0 | `ghInstalled: true` / `ghAuthenticated: false` |
| 8 | Issue テンプレート 2 件 + `config.yml` あり | `templates` に `name` / `about` / `labels` が入り、`config.yml` 自体は含まれない / `blankIssuesEnabled: false` |
| 9 | `.github/ISSUE_TEMPLATE/` なし | `templates: []` / `blankIssuesEnabled: true` |
| 10 | `.codiel/` あり + `metatron:domains` が読める ARCHITECTURE | `codielReady: true` / `dirExists: true` / **`codielRoot` が `.codiel` を持つディレクトリ** / `projectDocs.domainsReadable: true` / `domainCount` が定義数と一致 |
| 11 | `.codiel/` あり + ARCHITECTURE なし | `codielReady: false` / `dirExists: true` / `projectDocs.architecture: null` / `gotchas: null` / `domainCount: 0` |
| 12 | `.codiel/` あり + ドメイン定義ブロックが壊れた JSON | `codielReady: false` / `domainsReadable: false`、例外を投げず exit 0 |
| 13 | `.codiel/` あり + ドメイン定義が空オブジェクト `{}` / glob が空配列 | いずれも `codielReady: false` / `domainsReadable: false`(1 件以上かつ glob 1 件以上を要求する) |
| 14 | `.codiel/` なし + ドメイン定義は読める | `codielReady: false` / `dirExists: false` / **`codielRoot: null`**(複合条件の両方を要求する) |
| 15 | `.codiel` が**ファイル**として存在 | `dirExists: false` / **`codielRoot: null`** / `runDirs: []` / `codielReady: false`(上方向探索でもディレクトリだけを認める) |
| 15 補 | **サブディレクトリの `.codiel` がファイル**で、祖先に `.codiel/` ディレクトリがある | `dirExists: true` / **`codielRoot` が祖先** / `runDirs` が祖先側の run(ファイルは通過して探索を続ける) |
| 16 | `.codiel/runs/` に 2 件(+ ファイル 1 件) / ディレクトリ自体が無い | `codielHarness.runDirs` が昇順のディレクトリ 2 件のみ / `[]` |
| 16a | **旧マーカー `codiel:domains` の ARCHITECTURE** | `domainsReadable: false`(互換読みが無いことの確認) |
| 16b | **`metatron.config.json` でパスを変更** | `projectDocs.architecture` / `gotchas` と `contextDocs` が新パスを指す |
| 16c | **`metatron.config.json` 無し** | 既定値 `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` で解決する(設定不在はエラーではない) |
| 16d | **サブディレクトリに `metatron.config.json`** があり、そこから実行 | `docRoot` がその祖先になり、`repoRoot`(git ルート)とは別値になる(§7-6) |
| 16e | **設定の `paths` が絶対パス / ルート脱出** | 拒否して既定値に落ち、理由を返す |
| 16f | **ルート解決の突き合わせ(3 者比較)** | 同一入力に対し metatron の `config.ts` / Codiel の `resolveDocPaths` と**同じ `docRoot` と同じ解決パス**を返す。ファイル契約 §13 が列挙する全構成(設定なし + git / 設定なし + git 管理外 / 祖先の設定 / 開始ディレクトリ自身の設定 / `.codiel` と設定の併存 / 絶対パス・ルート脱出 / シンボリックリンク / git バイナリ無し / ネストした git / Windows 区切り / 壊れた設定・未知の version・型不整合)を網羅する。**3 実装の一致を機械的に担保しているのはこのケース群だけである**(§12 M0) |
| 17 | `docs/intents/` なし | `intentsDir: null` / `existingIntents: []`、**ディレクトリを作成しない** |
| 18 | intent 文書 2 件あり | `existingIntents` に slug / status / issue / title が入り、ファイル名昇順 |
| 19 | frontmatter が壊れた intent 文書 | 例外を投げず exit 0。解釈できないファイルは `existingIntents` に含めない(§7-6) |
| 20 | 実行前後で対象ディレクトリの内容が変化しない | **読み取り専用の検証**。ファイル・ディレクトリが作成も更新もされていない(§7-1) |
| 21 | `contextDocs` の検出 | 存在するものだけが列挙される |
| 22 | `package.json` に `scripts.test` あり | `testRunner.detected: true` / `command` が lockfile に応じて `pnpm test` |
| 22 補 | 設定ファイル(`vitest.config.*` 等)とテストファイルのみ | `detected: true` / `evidence` に設定ファイル名とテストファイルのパスが入る |
| 23 | テスト関連の痕跡が一切無い | `testRunner.detected: false` / `evidence: []` |
| 24 | 読み取り権限の無いディレクトリを含む | 例外を投げず exit 0(該当エントリはスキップ) |

#### ルート解決の単体検証(ファイル契約 §13)

3 者比較(16f)とは別に、sandalphon 単体でルート解決の各構成を検証する。
`docRoot`(契約 §3 規則 1)と `codielRoot`(`.codiel` の上方向探索)は**別々に決まる**ため、
両方が同時に正しいことをここで確かめる。

| # | ケース | 期待 |
| --- | --- | --- |
| C1 | 設定なし + git リポジトリのサブディレクトリから実行 | `docRoot` = `repoRoot` = git ルート(段 2) |
| C2 | 開始ディレクトリ自身に `metatron.config.json` | `docRoot` が開始ディレクトリ(inclusive 探索) |
| C3 | `repo/metatron.config.json` と `repo/sub/.codiel/` が併存し `repo/sub` から実行 | `docRoot: repo` / `repoRoot: repo` / `dirExists: true` / **`codielRoot: repo/sub`**。**上方向探索へ変える前は `dirExists: false` だった** —— 3 基準が別ディレクトリを指すのは正常な状態である(§7-3) |
| C4 | `repo/.codiel/` と `repo/sub/metatron.config.json` が併存し `repo/sub` から実行 | `docRoot: repo/sub` / **`codielRoot: repo`** / `docRoot ≠ codielRoot` / `runDirs` は **`codielRoot` 基準**で読む / `codielReady: true`。**上方向探索へ変える前は `dirExists: false` になり、codiel が実際には動くのに委譲経路を塞いでいた** |
| C5 | `.codiel` が祖先を辿ってもどこにも無い | `dirExists: false` / `codielRoot: null` / `runDirs: []` / `codielReady: false` |
| C6 | シンボリックリンク経由で開始ディレクトリを与える | 実体パスへ解決してから探索し、`docRoot` が実体側になる |
| C7 | `git` バイナリが無い | 例外を投げず段 3 へ落ちる。`isGitRepo: false` / `repoRoot: null` / `docRoot` = 開始ディレクトリ |
| C8 | ネストした git リポジトリ(`repo/inner/.git`)の `repo/inner/sub` から実行 | `repoRoot` = `docRoot` = `inner` |
| C9 | `paths` に Windows 形式の区切り(`arch\MAIN.md`) | POSIX 上でも同じ位置へ解決し、`configWarnings: []` |
| C10 | 壊れた JSON / 未知の `version` / トップレベルが配列 | いずれも全項目を既定値に落とし、`configWarnings` が 1 件 |

### 11-2. スキルの手動検証シナリオ

スキル本文の挙動は自動テストできないため、シナリオ実行で確認する。各シナリオは
「一時ディレクトリに条件を満たすプロジェクトを作り、`/sandalphon:run` を実行する」形で行う。

| # | シナリオ | 確認点 |
| --- | --- | --- |
| A | フル構成(git + remote + gh 認証済み + Codiel 初期化済み + gh-utility あり) | ゲート 1 が効く / 経路の質問に品質差の 1 行が入る / 起票提案が 1 回だけ出る / issue-craft が固定開始句で持ち込みモードに入る / 本文が改変されない / `/codiel:run <番号>` が**新セッション推奨の 1 行つきで**提示されてセッションが終わる |
| B | gh 無し | issue 経路が提示されない / 理由が 1 行報告される / Phase 3 へ進む / ゲート 2 でケース一覧・実行コマンド・作業ブランチ `sandalphon/<slug>` の 3 点が提示されて止まる |
| C | gh あり・gh-utility 無し | 自前で `gh issue create` が実行される / 起票前に全文提示と承認がある |
| D | ゲート 1 で差し戻し | ヒアリングに戻る / 差し戻し内容が intent 文書に反映される / 文書が保存されないまま次フェーズへ進まない |
| E | テスト基盤の無いプロジェクト | 手動検証手順が作られる / テストランナーを勝手に導入しない / 報告に検証強度の低下が明記される |
| F | Codiel 導入済み・`.codiel/` なし | 委譲が選択肢に出ない / `/codiel:init` の案内が 1 行出る |
| G | 既存 intent 文書と重複する TOBE | 「既存を更新 / 新規に起こす」の確認が出る |
| H | Codiel 導入済み・`.codiel/` あり・ドメイン定義が読めない・**metatron 併用** | 委譲が選択肢に出ない / 案内が **`/metatron:init`(推奨)** になる(`.codiel/` の存在だけで委譲を出さないことの確認) |
| H2 | 同上・**metatron 未導入** | 案内が **`/codiel:init` の最小 ARCHITECTURE 生成**になる(案内先の分岐の確認) |
| L | metatron 併用でメインセッション開始 → `/sandalphon:run` | 注入済みの ARCHITECTURE / GOTCHAS を ASIS の初期材料に使い、**同じ内容を Read で読み直さない** |
| M | 注入が縮退している状態(ARCHITECTURE が目次+要約) | 縮退を認識し、全文が必要なら `contextDocs` のパスを Read する |
| N | metatron 未導入・Codiel 単体の最小 ARCHITECTURE のみ | ASIS 探索が成立する / ドメインマップを探索スコープに使える / 何も畳まれない |
| I | Raguel MCP が確認できない | 委譲は選択肢に**出る** / 「Raguel MCP 接続が無いと開始しない」の注記が付く |
| J | 未完了の Codiel run がある状態で自前実行を選ぶ | Phase 3 を開始せず、run 一覧の提示と案内で停止する |
| K | 起票に失敗し汎用実行へフォールバック | 理由が提示され 3 択で選び直しになる / (b) 選択時に**ゲート 1 を再実施せず** Phase 3 へ直進する |

### 11-3. 連携改修の検証

| # | 対象 | 確認点 |
| --- | --- | --- |
| X1 | analyzing-issues | intent issue から生成した `issue.md` で、TOBE が `## 要件` に、未確定事項が `## 不明点` に転記され、合意済み事項が要件・不明点のどちらにも入っていない |
| X2 | analyzing-issues | `## 実装方針` が `## スコープ` へ**要約されていない**(原文にない語が `## スコープ` に現れない) |
| X3 | analyzing-issues | マーカーが本文の中ほど(テンプレートヘッダの後)にある issue でも intent issue として検知される |
| X4 | analyzing-issues | 本文より新しい仕様変更がコメントにある intent issue で、コメントが通常手順で反映され、本文と矛盾する場合は `## 不明点` に食い違いが記録される |
| X5 | analyzing-issues | `<!-- intent:v2 -->` の issue で写像せず通常抽出に落ちる |
| X6 | analyzing-issues | マーカーの無い通常 issue で従来どおり動く(退行がない) |
| X7 | preparing-design-agendas | 合意済み事項が論点にならず `## 合意済みとして継承` に出る。一方で `## 不明点` 由来の論点は全件残る |
| X8 | issue-craft | 固定開始句つきの依頼で持ち込みモードに入り、本文が改変されず、承認ゲートは維持される |
| X9 | issue-craft | 通常依頼(固定開始句なし)で手順 4 のブレストが従来どおり実行される(持ち込みモードに誤って入らない) |

`pnpm lint` / `pnpm typecheck` / `pnpm test` はコミット前に必ず通す(リポジトリ規約)。

---

## 12. 実装手順

各マイルストーンは独立してレビュー可能な単位である。

### M0. 前提: metatron のファイル契約の凍結(sandalphon の実装に先行する)

**`check-intent-env.ts` の実装は、metatron 設計書 §14 の N0(ファイル契約の凍結)が
完了していることを前提とする。** sandalphon の環境検出は次の 4 点を metatron の契約に
依存しており、凍結前に実装すると契約変更のたびに作り直しになる。

- マーカー名 `metatron:domains`
- `metatron.config.json` のスキーマ
- ルート解決とパス解決の規則(§7-3)
- ARCHITECTURE / GOTCHAS の既定パス

sandalphon 側はこの契約の**独立実装**である(metatron のソースは参照しない)。
そのため実装完了時に、**3 者の解決結果の突き合わせテストを sandalphon 側へ置く**
—— 同一の一時ディレクトリ構成に対して metatron の `config.ts` / Codiel の `resolveDocPaths` /
sandalphon の `check-intent-env` を走らせ、`docRoot` と解決パスが一致することを検証する
(テストケース 16f。§11-1)。metatron 設計書 §13-2 の R4 は metatron と Codiel の
**2 者比較**として codiel 側に残り、3 者比較はここへ集約する。
これが 3 実装が写しを持つ設計における唯一の機械的担保であり、
**`plugins/sandalphon/src/__test__/check-intent-env.test.ts` の 1 ファイルに集中している**。

### M1. sandalphon 本体

1. `plugins/sandalphon/` の骨格を作る(`.claude-plugin/plugin.json`、`package.json`、`build.ts`)。
   バージョンは両方 `0.1.0-dev` で揃える。
2. `src/check-intent-env.ts` を実装し、`src/testing/run-ts.ts` と
   `src/__test__/check-intent-env.test.ts` を追加する。`pnpm build` でバンドルを生成し、
   `scripts/check-intent-env.mjs` を git 管理下に入れる。
3. `references/intent-format.md`・`references/handoff-contract.md`・`references/sandalphon-common.md` を
   作る。**`prompt-smith:prompt-smith` を使う**(references は AI 向け指示書に当たる)。
4. 3 つの SKILL.md と `commands/run.md` を作る。**`prompt-smith:skill-creator` を使う**
   (リポジトリ規約。description の発火測定まで含む)。
5. `README.md` を書く(名前の由来、動作要件、コマンド、フェーズ、他プラグインとの関係、
   Codiel / gh-utility / gh が無い場合の挙動)。**Codiel 委譲の前提として「`/codiel:run` は
   Raguel MCP 接続と `/codiel:init` 済みハーネスを必要とする」ことを要件節に明記する**
   —— これは sandalphon 単体では満たせない外部条件であり、利用者が読まないと委譲経路を
   使えないため README に置く(`docs/` ではない)。`docs/rationale.md` に設計根拠を退避する。

M1 の完了条件: シナリオ B(最小構成)と E(テスト基盤なし)が通ること。

**M1 と M2 の間で intent-issue v1 フォーマットを凍結する。** 見出し名・順序・マーカー文字列を
確定し、`intent-format.md` を正本として固定してから連携改修に着手する。凍結前に M2 / M3 を始めると、
写しを持つ 3 つの SKILL.md を書式変更のたびに追随させることになり、どれか 1 つが取り残された
状態でリリースされる危険が高い。凍結後に変更が必要になった場合は `v2` を立てる(§6-2)。

### M2. codiel 改修

1. `skills/analyzing-issues/SKILL.md` に `## intent issue の写像` 節と Red Flags 1 行を追記(§8-1)。
2. `skills/preparing-design-agendas/SKILL.md` に `## 合意済み事項の継承` 節と HARD-GATE 1 行を追記(§8-2)。
3. どちらも `prompt-smith:prompt-smith` を使う。
4. `plugins/codiel/.claude-plugin/plugin.json` と `package.json` を `0.4.2-dev` に上げる。
5. `plugins/codiel/README.md` に intent issue 連携を 2〜3 行で追記する。

M2 の完了条件: 検証 X1〜X7 が通ること。特に X6(マーカー無し issue での退行なし)と
X2(要約写像をしていないこと)を必ず確認する。

### M3. gh-utility 改修

1. `skills/issue-craft/SKILL.md` に `## 持ち込みモード` 節を追記(§8-3)。`prompt-smith:prompt-smith` を使う。
2. `plugins/gh-utility/.claude-plugin/plugin.json` と `package.json` を `0.5.2-dev` に上げる。
3. `plugins/gh-utility/README.md` の issue-craft の説明に持ち込みモードを 1 行追記する。

M3 の完了条件: シナリオ C と検証 X8 / X9 が通ること。

### M4. マーケットプレイス登録と全体整合

1. `.claude-plugin/marketplace.json` に sandalphon を追加する。
2. `pnpm-workspace.yaml` の `packages` に `plugins/sandalphon` を追記する。
3. ルート `README.md` に sandalphon の項を追加し、codiel / gh-utility の改修内容を反映する。
4. `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` をすべて通す。
5. シナリオ A / D / F / G / H / I / J / K を実行する(全プラグインが揃った状態でしか確認できないため最後)。

### M5. 実運用と `-dev` 除去の判断

実際の開発で数件の intent を通し、問題が出なければ 3 プラグインの `-dev` を外す。
これは別セッションでの判断とし、本設計のスコープに含めない。

---

## 13. 不採用案・検討済み代替

### 13-1. 構成案 B: フェーズ別コマンド

`/sandalphon:capture` `/sandalphon:bridge` `/sandalphon:execute` の 3 コマンドに分ける案。

- 利点: 途中フェーズだけを単独で回せる。intent 文書があるプロジェクトで Phase 2 だけ再実行する、
  といった使い方が明示的になる。
- 不採用の理由: フェーズ間の受け渡し(どの intent 文書か、環境検出の結果、経路の決定)を
  ユーザーが引数で指定することになり、事実上の状態管理をユーザーに押しつける。
  「状態永続機構を持たない」という決定と噛み合わない。また、初めて使うユーザーが
  「どのコマンドから始めるのか」を判断できない。
- 代替の手当て: 途中からの再開は `/sandalphon:run <intent 文書のパス>` で吸収する(§5-3)。
  引数がパスなら Phase 1 は既存文書の読み込みから始まる。

### 13-2. 構成案 C: 自動発火スキルのみ(コマンドを持たない)

「〜したい」という発話を description で捕まえて自動発火するスキル群にする案。

- 利点: ユーザーがコマンドを覚えなくてよい。intent 駆動が「常に効いている」状態になる。
- 不採用の理由: 誤発火のコストが非対称に大きい。ユーザーが軽い修正を頼んだだけで
  ヒアリングと ASIS 探索が始まると、明確な妨害になる。sandalphon は承認ゲートを持つ
  重いフローであり、この種のフローは明示発動に限るのがリポジトリ内の既存判断
  (issue-craft / issue-split / issue-triage がいずれも「明示的な依頼があったときのみ使い、
  自律的には発動しない」と description に明記している)と整合する。
- 部分採用: `/sandalphon:run` は明示発動だが、スキルの description には「intent 駆動で進めたい」
  「ASIS と TOBE を整理して」という明示的な依頼を捕まえる記述を含める。発火の判定は
  `prompt-smith:skill-creator` の発火測定で調整する。

### 13-3. 承認ゲートを 1 点に絞る案

ゲート 1(intent 文書)のみとし、テスト仕様も自律で進める案。

- 利点: 手番が減る。自前実行がワンストップになる。
- 不採用の理由: intent 文書の受け入れ基準は「何が達成されればよいか」を定めるが、
  「何をもってそれを確認するか」までは定めない。両者の間には解釈の幅があり、そこがずれたまま
  実装まで走ると、テストが通っているのに intent が満たされていないという最悪の結果になる。
  ゲート 2 はこの解釈を固定する 1 手番であり、費用対効果が最も高い位置にある。
- 補足: ゲート 2 は「テスト仕様の一覧を見て OK と言うだけ」の軽い手番であり、
  ゲート 1 のような対話を伴わない。手番の重さは同じでないため、単純な個数比較で判断しない。

### 13-4. 全体スナップショット ASIS 案

初回実行時にプロジェクト全体を探索し、`docs/ASIS.md` のような全体像を生成して以後キャッシュする案。

- 利点: 2 回目以降の ASIS 探索が速い。プロジェクト全体の把握が資産として残る。
- 不採用の理由: (a) 生成コストが intent 1 件の価値に対して大きすぎる。(b) 生成直後から陳腐化し、
  更新の仕組みを持たないキャッシュは誤情報の供給源になる。(c) 全体像を持つ文書は
  ARCHITECTURE として既に metatron が担当しており、役割が重複する。
- 代替: `check-intent-env.mjs` の `contextDocs` で既存文書を検出し、それを優先的に読む(§4-3)。
  人間が書いた要約を再利用するほうが、AI が生成したスナップショットより安く正確である。

### 13-5. intent 文書を持たず issue だけを成果物にする案

- 不採用の理由: GitHub リポジトリを持たないプロジェクトで何も残らない。また、承認ゲート 1 の
  対象が「起票前の下書き」になり、承認済みの内容が手元に残らないため、起票に失敗した瞬間に
  合意が消える。文書を一次成果物、issue を派生物とする現設計はこの問題を持たない。

### 13-6. Codiel の `orchestrating-runs` スキルを直接起動する案

§4-3 に記載のとおり不採用。内部スキル名への結合、コンテキストの二重消費、
Codiel のフェイルクローズド入口の迂回、の 3 点による。

---

## 14. 未解決事項

決めきれなかった点を、選択肢と推奨付きで残す。実装着手前にユーザーの判断を仰ぐ。

### 14-1. intent 文書を自動コミットするか

- 選択肢 A: コミットしない(作業ツリーに残す)。
- 選択肢 B: intent 文書だけを単独コミットする。
- **推奨: A。** リポジトリの運用方針(コミット粒度、コミットメッセージ規約、ブランチ戦略)が
  sandalphon からは見えない。Codiel は `/codiel:init` でハーネスを敷いた前提があるためコミットできるが、
  sandalphon はどんなプロジェクトでも動くことを要件としており、同じ前提を置けない。
  報告で「`docs/intents/...` を作成した(未コミット)」と明示すれば十分である。

### 14-2. intent 文書の言語

- 選択肢 A: ユーザーのディスカッション言語に合わせる。
- 選択肢 B: issue 本文の言語確認と同時に 1 回で聞く(リポジトリの言語を推定して推奨提示)。
- **推奨: B。** intent 文書はそのまま issue 本文に転記されるため、両者の言語が食い違うと
  転記時に翻訳という加工が入り、「機械的に転記する」という設計が崩れる。
  Phase 1 のドラフト提示前に 1 回だけ確認する。

### 14-3. 既存 issue から intent を起こす逆方向の経路

「既に issue があるが intent が構造化されていない」場合に、issue を読んで intent 文書を起こし、
issue 本文を intent フォーマットへ更新する経路。

- 選択肢 A: 今回のスコープに入れる。
- 選択肢 B: 将来の拡張とし、今回は入れない。
- **推奨: B。** 既存 issue の本文を書き換えるのは取り消しの効きにくい破壊的操作であり、
  複数人が読んでいる issue では特に慎重を要する。まず順方向(intent → issue)を実運用で
  固めてから、需要を見て検討する。M5 の判断と合わせて再訪する。

### 14-4. `existingIntents` の重複判定をどこまで行うか

- 選択肢 A: スクリプトは列挙のみ。重複判定はスキル(モデル)が TOBE を読んで行う。
- 選択肢 B: スクリプトが slug の文字列類似度で候補を絞る。
- **推奨: A。** 「同じ intent か」は意味の判断であり、文字列類似度では誤判定が多い。
  intent 文書は 1 プロジェクトに数十件が上限と見込まれ、タイトル一覧をモデルが読む
  コストは無視できる。スクリプトに意味判断を持ち込まないという §7-1 の方針とも整合する。

---

## 15. 参考: 完成イメージ(シナリオ A の会話)

設計の妥当性を確認するための、フル構成での一連の流れ。

```
ユーザー: /sandalphon:run OAuth ログインを足したい

sandalphon: (環境検出) git + GitHub remote + gh 認証済み。
            docRoot 直下の ARCHITECTURE で metatron:domains が読める
            → projectDocs.domainsReadable: true。
            .codiel/ あり → codielHarness.dirExists: true。よって codielReady: true。
            codielHarness.runDirs は空。mcp__raguel__* は利用可能ツール一覧にある。
            metatron の SessionStart 注入がコンテキストにある(縮退なし)。
            既存 intent 文書 1 件(add-cache / done)—— 重複なし。
            → 「今のログインはどう実装されていますか」ではなく、まず自分で ASIS を読む
            → src/auth/ を Serena で探索し、セッションベースの独自認証を確認
            → 不足観点を 1 問ずつ質問(対応プロバイダ / 既存アカウントとの紐付け / 移行の要否)
            → 分岐「既存ユーザーの紐付け方式」を選択肢 2 つで提示 → 合意
            → intent 文書ドラフトを全文提示

            ★ ゲート 1 → 承認
            → docs/intents/2026-08-16-add-oauth-login.md を保存(approved)

            → 実行経路を 1 回の質問で提示:
              (a) issue を起票して /codiel:run へ渡す(推奨)
              (b) issue を起票して sandalphon が実行する
              (c) issue を起票せず sandalphon が実行する
              (d) intent 文書だけ残して終了
              ※ (a) は設計・レビュー・PR まで含む重い経路、(b)(c) はテストと実装だけの
                軽量経路でレビューは付かない。
            → (a) を選択
            → issue-craft を固定開始句「持ち込みモード: 以下の完成済み本文で起票」で起動
              → テンプレート・言語確認 → 全文提示 → 承認
            → #57 を起票。intent 文書に issue: 57 / status: issued を追記

            報告: intent を #57 として起票した。
                  次は新しいセッションで `/codiel:run 57` を実行することを推奨する
                  (本セッションの文脈は issue #57 に外部化済み)。
                  Codiel の init フェーズは intent のセクションを転記し、discuss は
                  合意済みの分岐を再質問しない(未確定事項由来の論点は通常どおり出る)。
```
