# agent-policy 改修の実装計画書: サブエージェントの文脈の作り直しを減らす策と、codiel 1.1〜2.0 との食い違いの解消

> **実装の進め方:** このリポジトリの運用方針(SessionStart が注入する方針スキル)に従ってタスクごとに進める。各ステップは checkbox(`- [ ]`)で進捗を記録する。

**Goal:** 設計書の決定 D1〜D20 と執筆者の判断 J1〜J29 を、agent-policy の規律・役割断片・setup-agents・SessionStart に反映する。

**Architecture:** 変更の大半は指示書の文面である。規律(`references/orchestration-discipline.md`)がオーケストレーターの振る舞いを、`assets/roles/{ja,en}/_common.md` と役割断片が委譲先の振る舞いを持つ。コードの変更は、`vocabulary.ts`・`compose.ts`(前置きの役割 ID)、`setup-agents.ts`(`omitClaudeMd` と `experimental.cacheTtl` の書き込み)、`marker-scan.ts` と `session-start.ts`(環境変数の警告)に限る。

**Tech Stack:** TypeScript(strict)、esbuild(ESM・node22・`.mjs`)、vitest

**Spec:** `harness-docs/design/2026-11-10-agent-policy-subagent-performance-and-codiel-gaps-design.md`(承認済み。コミット `d35d0d0a`・`a2c9a93d`・`a6c1a213`・`d57ac911`)

- 作成日: 2026-11-11
- 対象プラグイン: `plugins/agent-policy/`(`0.21.8-dev`。上げない)
- 計画立案時の HEAD: `ad3db392`
- そろえる相手: better-agentics の設計書(`ad3db392` まで)、codiel の設計書 1.1・1.2・2.0(`c463e252` まで)。better-agentics の実装計画は別に書かれる

この計画書は、タスクの分割・順序・検証方法・タスク間の契約を定める。設計判断は設計書を正本とし、各タスクに設計書のセクションと決定の番号を添える。設計書と実装の食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。

## Global Constraints

設計書と規約から値をそのまま写す。

- バージョンは `plugin.json` と `package.json` の両方で `0.21.8-dev` のまま上げない(D9)。規約は改修でバージョンを上げるとするが、`-dev` のプラグインはユーザーに確かめて決める運用で、上げないと決まっている。
- 指示書(`skills/`・`references/`・`assets/`)には、codiel の名前も codiel 固有の語も書かない。固有の語は「Workflow」「Auto Ask」「委譲の指定」、codiel のコマンド名としての `run`、`declined` などである。代わりに「このプラグインの外のスキルやコマンドが定める手順(外側の手順)」「スクリプトに渡す起動の指定」「人の判断の代わりに別の仕組みで判断する」と書く(設計書 5.1・5.3、J10)。Jev の名前も書かない。英語の断片の動詞の Run は、この制約に当たらない。
- 指示書には、他プラグインの名前(better-agentics を含む)、設計書の決定と判断の番号(D・J・M・S)、設計書と規律の行番号、決めた根拠の文を書かない。設計書の箇条は、条項の文面に書き直して入れる。規律の中の別の条項は、条項の文面か見出しで指す。
- 設計書 5.1 の「今わかっている両立しない例」の表は、規律に写さない。原則だけを書く。
- 担当表(13 役割・種別・Claude モデル・effort)は変えない。`src/agents/__test__/discipline-role-table.test.ts` を通し続ける。
- `hooks/hooks.json` は変えない(設計書 16 章)。
- このリポジトリの `.claude/agents/` の 13 定義は、この計画では作り直さない。better-agentics の形の本文で、両方のマーカーを持つ(設計書 3.2)。
- テストは対象ソースと同じディレクトリの `__test__/<対象ファイル名>.test.ts` に置く。子プロセスのエントリは `src/testing/` に置く(testing-policy)。
- `plugins/agent-policy/scripts/` は手で編集しない。`src/` を変えたタスクは `pnpm --filter agent-policy-scripts build` を実行し、`scripts/` の差分を同じコミットに入れる。役割断片と規律は実行時に読まれ、バンドルされないので、それだけを変えたタスクにビルドは要らない。
- AI が読む Markdown を書く前に、`prompt-smith:prompt-smith` を起動して規律に従う。対象は、`skills/**/SKILL.md`・`references/*.md`・`assets/**/*.md`・`harness-docs/**/*.md`(食い違いの文書と、この計画書の実施記録を含む)である。
- ブランチを切らず、main で作業する。タスクごとにコミットする。コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける。
- ステージ済みの `.claude/settings.local.example.json`、作業ツリーの `.claude/settings.json`、`docs/chat/` の変更をコミットに混ぜない。コミットはパスを指定して行う。
- オーケストレーターは Opus・Fable・Sonnet のどれにもなる。実機の確認は、計画が名指しするモデルで行う。Sonnet で動かないときは、モデルを上げる案に逃げず、規律の文面で直す。

## Review Focus

設計書が直接は書いていないが、利用者が踏みやすい入力と、そのときに期待される振る舞い。各行のテストは担当タスクに入れてある。

1. 既存の定義の `experimental` に `cacheTtl` 以外の下位キーがある — 下位キーを残して `cacheTtl` だけを書き換える(T3)。
2. 既存の定義に `omitClaudeMd: true` があり、質問しない経路(`--yes`・`--recommended`・個別に調整しない再生成)で再生成する — 値を残す(T3)。
3. ステップ 5b の「完全上書き」で再生成する — 質問で答えていない `omitClaudeMd` と `experimental` の他の下位キーを、生成の前に読んだ値で書き戻す(T3)。
4. 再生成でモデルを外部ベンダーのものに変えた — `cacheTtl` だけを消す。下位キーが残らなければ `experimental:` の行も消す(T3)。
5. `model` が Claude の別名で `agent-policy-vendor` が外部ベンダーの定義 — `cacheTtl` を書かない(T3)。
6. 2 キーを持つ定義を、変更せずに `--check` する — `identical: true` になり、`keysOnlyInExisting` に 2 キーが載らない(T3)。
7. `experimental` がブロックの形でない(フロー形式など) — 書き換えず、応答の `twoKeys` で変わらないことを示す(T3)。
8. 複数の役割を持つ定義 — 前置きに全役割のラベルと ID が並ぶ。`omitClaudeMd` の推奨は、全役割が knowledge-elicitation のときだけ「付ける」(T1・T3)。
9. `AMATSUKA_AGENT_AUTO_INJECTION` が custom の旧値(`with-codex` など) — 警告の対象に入れる(T4)。
10. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` が `0`・`false`・空 — 警告しない(T4)。

---

## 0. 触らないもの・扱わないこと

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`、`.claude/rules/metatron/` の 3 ファイル。ARCHITECTURE はプラグインの中の契約を書いていないので、変えない見込みである(設計書 9 章)。変更が要ると気付いたら、T7 で `/metatron:update` を起動して扱う。
- 他プラグインのファイル。better-agentics と codiel は読むだけにする。codiel 1.2 の設計書の試作 S7(この計画の S7 とは別のもの)は、codiel の実装計画で行う。この計画は、そのための改修前の定義を残すだけである(T0 の Step 0)。
- `hooks/hooks.json`、`tsconfig.json`・`vitest.config.ts`・`biome.json`。
- 本件と無関係な未コミット変更。触らず、revert もしない。
- 書く作業の無い決定: テストを書く時点を規定しない(D19)。readonly の役割に出力ファイルを書かせる外側の手順は扱わない(J15)。D8 の「役割断片の安全弁を残す」は、T2 で外すのが light-impl の hooks の項目だけであることで守る。
- 設計書 4.3 のとおり、レビューの役割を外して再生成した定義に残った `cacheTtl` には触れない。

## 1. 共通の進め方

- `src/` を変えるタスク(T1・T3・T4)は TDD で進める。失敗するテストを書く → 失敗を確かめる → 実装する → パスを確かめる → コミットする。
- 1 タスクの完了条件は、`pnpm run test`(全体)・`pnpm run typecheck`・`pnpm run lint` が通ることと、運用方針のレビューの規律が求めるレビューを終えていることである。レビューの時点・回し方・止め方は、実装のセッションの運用方針(SessionStart が注入する方針スキル)に従う。この計画は独自の止め方を定めない。実装のセッションが読む方針は、インストール済みのキャッシュにある改修前のものなので、作業の途中で変わらない。
- 最後のタスク(T8)で `pnpm run build` を通し、`scripts/` に差分が残っていないことを確かめる。
- 指示書だけを変えるタスク(T2・T5・T6)は、上のテストを通し、設計書の該当セクションと文面を突き合わせて確かめる。
- 規律の箇所は、行番号ではなく条項の文面で指す。T5 の編集で行番号がずれるためである。この計画書の行番号(`:81` など)は、HEAD `ad3db392` の時点のものである。

### 1-1. 実機の確認(T0・T8)

- **改修を読むセッション:** インストール済みのプラグインは、バージョン別のキャッシュ(`~/.claude/plugins/cache/amatsuka-claude-plugins/agent-policy/0.21.8-dev/`)から読まれる。バージョンを上げないので、作業ツリーの改修はキャッシュに入らない。そのため、`--plugin-dir` でプラグインのディレクトリを指して起動する。同じ名前のインストール済みのプラグインは、`--plugin-dir` のものに置き換わる。T0 は下書きの写し(T0 の Step 1)を、T8 は `plugins/agent-policy` を指す。
- **試験用のプロジェクト:** リポジトリの外の消えない場所(例: `~/agent-policy-trial/project/`)に作る。このリポジトリは使わない。`enabledPlugins` が他のプラグインを有効にしていて、`.claude/agents/` の定義が better-agentics の形だからである。
  - `git init` し、小さなサンプルのコードとテストを置く。ローカルの bare リポジトリ(例: `~/agent-policy-trial/remote.git`)を `origin` にする。
  - `.claude/settings.json` には `enabledPlugins` を書かない。`permissions.allow` に、試作で委譲先が使う操作(`Edit`・`Write`・サンプルのテストの実行・`git` の操作)を書く。`-p` の実行では、許可の無い操作は確認なしに拒否され、委譲先が断ったように見えるためである。S7 で読むプロジェクトの外のパスは、許可に入れない。
  - `.claude/agents/` は、`--plugin-dir` で指したディレクトリの CLI で生成する(下の CLI の呼び方)。
- **起動:** 実装のセッションが、試験用のプロジェクトを作業ディレクトリにして、次の形で起動する。値は実際のものに置き換える。

  ```bash
  AMATSUKA_AGENT_AUTO_INJECTION=<claude|custom> \
    claude -p --setting-sources project --plugin-dir <プラグインのディレクトリ> --model <opus|sonnet|fable> --max-turns 150 "<依頼>"
  ```

  - `--setting-sources project` で、ユーザーの設定が有効にしているプラグインと許可を読まない。
  - `AMATSUKA_AGENT_ENABLE_ORCHESTRATION` は環境から外す。
  - `--max-turns` で、レビューと修正のループが止まらないときの上限を置く。150 は、S2 の 6 ラウンドと 7 巡目のレビューが収まる見込みの値である。上限で止まった試行は、判定に使わずに記録だけ残し、原因を調べてから試し直す。
  - 判断を仰ぐ場面は、オーケストレーターが仰いで止まったことを観測して判定する。続きを見るときは、`claude -p --resume <セッション ID>` で答えを渡す。
- **`-p` の確認(最初に行う):** 1 回の `-p` の実行の中で、バックグラウンドの委譲先の完了を待って次のターンが続くか、`--resume` の後に前の実行の委譲先を SendMessage で再開できるかを確かめる(better-agentics の S10 と共有してよい)。どちらかが成り立たないときは、S1・S2・S6 をユーザーに対話のセッションで行ってもらい、実装のセッションは transcript で判定する。
- **読み込みの確認:** 起動したセッションが写しの規律を読んでいることを、最初に確かめる。写しの規律に一時的な目印の文を入れ、セッションに引用させる。確かめたら目印を消す。
- **CLI の呼び方:** setup-agents は、`--plugin-dir` で指したディレクトリの `scripts/setup-agents.mjs` を直接呼ぶ。全役割を推奨のモデルで生成するときは次の形にする。

  ```bash
  node <プラグインのディレクトリ>/scripts/setup-agents.mjs --write --merge --recommended --scope <claude|custom> --lang <ja|en> --dir <試験用のプロジェクト>
  ```

- **判定:** セッションの transcript(`~/.claude/projects/<プロジェクト>/` の下)を使う。見るのは、Agent ツールの呼び出し(`subagent_type`・`model`・`effort`)、SendMessage の宛先、委譲先の報告の本文である。入力のトークンは、transcript の `usage` から読む。
- **記録:** 結果は、5 章に「試作・構成・オーケストレーターのモデル・観測・判定」の表で記録する。

## 2. ファイル構成

| 層 | ファイル | タスク |
| --- | --- | --- |
| 素材 | `assets/roles/{ja,en}/_common.md` | T1 |
| 素材 | `assets/roles/{ja,en}/*.md` の Output Format、`light-impl.md` の制約 | T2 |
| 実装 | `src/agents/vocabulary.ts`・`src/agents/compose.ts`(前置きの役割 ID) | T1 |
| 実装 | `src/setup-agents.ts`(2 キーの専用の処理・`--check` の比較・CLI の引数・応答) | T3 |
| 指示 | `skills/setup-agents/SKILL.md`(`omitClaudeMd` の質問・報告) | T3 |
| 実装 | `src/hooks/marker-scan.ts`・`src/hooks/session-start.ts`(警告) | T4 |
| 参照 | `references/orchestration-discipline.md` | T5・T6 |
| 配布物 | `scripts/` の再生成 | T1・T3・T4 |
| 文書 | プラグインの `README.md`、ルートの `README.md`、`.serena/memories/agent_policy/core.md`、食い違いの文書 | T7 |

## 3. タスク間の契約

### 3-1. 前置きの役割 ID(T1)

- `compose` は、`_common.md` の `{{ROLE_LABELS}}` に、役割ごとにラベルと ID を並べて入れる。ID は、引用符で囲んだラベルの後に、半角の括弧で添える。
  - ja: `「コードレビュー」(code-review)`(括弧の前に空白を置かない)
  - en: `"Code review" (code-review)`(括弧の前に空白を 1 つ置く)
- 引用符・区切り・括弧の付け方は、言語ごとに `src/agents/vocabulary.ts` に持たせる。`compose.ts` に言語の分岐を書かない。複数の役割の区切りは、現行の `listSeparator` のまま変えない。en の純度の検査(`compose.test.ts`)を通す。
- T5 の依頼文の役割の明示と、T7 の README は、この書式を前提にする。依頼文では、ラベルは依頼文の言語のもの、ID は共通のものを書く。

### 3-2. setup-agents の 2 キー(T3)

- テンプレート(`compose`)は `omitClaudeMd` と `experimental` を出さない(J17)。
- 専用の処理は、生成の前に既存のファイルから 2 キーの値を読み、生成と保持マージの後に行単位で書き戻す。`parseDocument`・`render` の往復を使わない(J17)。
  - `--check` と `--write` は、同じ専用の処理を通した結果を使う。`--check` の `identical` と `keysOnlyInExisting` は、この結果と既存のファイルを比べて出す。
  - 保持マージの自動保持(`automaticKeep`)は変えない(設計書 4.3)。自動保持が戻した行は、この処理が決めた値で上書きする。
  - 自動保持の応答の `kept` には、2 キーが `key:omitClaudeMd`・`key:experimental` として載りうる。SKILL.md の報告は、`kept` のこの 2 項目を載せず、2 キーの状態を `twoKeys` だけで報告する。
- 字下げした `cacheTtl` の行は、既存の行単位の補助関数(`keyLineAmbiguous`・`keyLineIndex`)が拒む。`experimental:` のブロックの下の行を扱う補助関数を新しく作る。扱うのはブロックの形だけである。フロー形式(`experimental: {…}`)など扱えない形のときは書き換えず、`after` を `before` と同じにする。
- `omitClaudeMd`:
  - `--write` と `--check` に引数 `--omit-claude-md <true|false>` を足す。質問に答えた定義にだけ渡す。
  - `true` なら `omitClaudeMd: true` を書き、`false` なら行を消す。
  - 引数が無いときは、既存の定義では既存の値を保ち、新しく作る定義では推奨に従う(J7)。推奨は、全役割が knowledge-elicitation のときだけ「付ける」(J5)。
- `experimental.cacheTtl`(引数は無い。規則で決める):
  - 書く条件: レビューの 5 役割(design-review・knowledge-elicitation・code-review・complex-review・adversarial-review)を 1 つでも持ち、Claude のモデルで動く定義(D4・J5)。既存の値が `1h` 以外なら `1h` に書き換える。
  - Claude のモデルで動くかは、規律 §委譲先の候補(`:31`)と同じ条件で判定する。`runsOnClaude(model)`(`src/agents/policies.ts`)が真で、かつ `agent-policy-vendor` が未宣言・`claude`・`none` のどれかであること。`runsOnClaude` だけでは、ベンダーを見ない。
  - 外部ベンダーのモデルの定義からは、`cacheTtl` だけを消す。下位キーが残らなければ `experimental:` の行も消す(J6)。
  - レビューの役割を持たない定義では、`experimental` に触れない。
  - S3 で `cacheTtl` が効かないと分かったときは、この規則を作らない(T0 の分岐)。
- `--check` と `--write` の応答の各定義に、次の形の `twoKeys` を足す。`before` は既存のファイルの値、`after` は書き込む(書き込んだ)値で、無いときは `null` とする。

  ```ts
  twoKeys: {
    omitClaudeMd: { before: boolean | null, after: boolean | null },
    cacheTtl: { before: string | null, after: string | null },
  }
  ```

  - ステップ 5b の質問は、`--check` の `twoKeys.omitClaudeMd.before` で既存の値を得る。
  - 対話モードのステップ 7 と、非対話モード(`--yes`)の手順 5 の報告は、`before` と `after` から「書き込んだ・書き換えた・消した」を決めて載せる。

### 3-3. 走査の結果(T4)

- `MarkedAgent`(`src/hooks/marker-scan.ts`)に `cacheTtl1h: boolean` を足す。`experimental:` のブロックの下に `cacheTtl: 1h` があるときだけ真とする(J9)。

## 4. タスク

### T0: 試作(S1〜S7)と改修前の定義の保存

設計書 13 章。実装の前に行う。結果を 5 章に記録し、下の「分岐」に従って後のタスクを変える。実行の形は 1-1 に従う。

- [x] **Step 0: 改修前のプラグインと定義を保存する。**
  - 改修前のプラグインは、コミット `ad3db392` から取り出せる。保存先は、再起動で消えないリポジトリの外のディレクトリにする(`~/agent-policy-prechange/`)。

    ```bash
    mkdir -p ~/agent-policy-prechange && git archive ad3db392 plugins/agent-policy | tar -x -C ~/agent-policy-prechange
    ```

  - 取り出したプラグイン(`~/agent-policy-prechange/plugins/agent-policy`)の CLI(1-1 の形)で、空のディレクトリ 2 つに定義を生成する。1 つは `--scope claude --lang ja`、もう 1 つは `--scope custom --lang ja` とする。custom の照会に失敗したときは、先頭の候補で生成される。
  - 保存先のパスとコミットを 5 章に記録する。
- [x] **Step 1: 下書きの写しと試験用のプロジェクトを作る。**
  - `plugins/agent-policy` を、リポジトリの外の消えない場所(`~/agent-policy-trial/plugin/`)へ写す。写しに、設計書の改めた文面を下書きする。
  - 規律に下書きするもの: 5.1 の原則、4.1 の再レビュー・再開・修正のループ、4.2 の fork の条件と依頼文の冒頭、J20 のコミットの指示、D16 のスキルの渡し方、依頼文の役割の明示に役割 ID を添える条項(T5 Step 6)、6.1 の §サブエージェントの規律 の 3 条項(出力の形・役割 ID・J16 の Agent ツール)。
  - `_common.md` に下書きするもの: 6.1 の表の全条項(`:16` のスキルのロードを含む)。light-impl の断片からは、hooks の項目を外す。
  - 写しの中では、`compose.ts` の役割 ID(T1)はまだ効かない。前置きの役割 ID の確認は T8 に回す。
  - 1-1 のとおり、試験用のプロジェクトを作る。
- [x] **Step 2: S1(fork)。**
  - オーケストレーターは Opus・Sonnet・Fable で試す。Opus のオーケストレーターが claude-model-policy の下で complex-impl を fork するかを見る。
  - fork が依頼文の冒頭の指示に従い、さらに委譲せず、オーケストレーターの規律で動かないかを見る。
  - `CLAUDE_CODE_FORK_SUBAGENT=0` と `permissions.deny` の `Agent(fork)` の下で、起動がオーケストレーターに分かるエラーになり、通常の起動に戻るかを見る。
  - Sonnet と Fable のオーケストレーターが、条件を満たさないときに fork しないかを見る。
- [x] **Step 3: S2(再開と修正のループ)。** オーケストレーターは Opus・Fable・Sonnet で試す。
  - 試験用の準備(ラウンドを重ねる仕掛け):
    - code-review と design-review の定義の本文の末尾に、追加の要件 6 項目と、「満たされていない追加の要件のうち、最初の 1 件だけを high の指摘として返す。すべて満たされていれば、表記の指摘を medium で 1 件だけ返す」を書く。要件はオーケストレーターに見えるファイルに置かない。オーケストレーターが 7 項目をまとめて依頼すると、ラウンドが重ならないためである。
    - オーケストレーターへの最初の依頼(実装の作業と文書の執筆の作業の 2 つ)には、作業の内容と「レビューの critical・high の指摘はすべて採って直す」を書く。S2 で見るのはラウンドの扱いで、指摘の採否の判断ではないので、採否は依頼で固定する。
    - 1 巡に 1 項目ずつ満たされ、6 ラウンドまで回る。7 巡目は medium だけになり、オーケストレーターが直さずに判断を仰いで止まるかを見る。
  - 5 つの起動形態を用意する。
    - 生成した定義: 1-1 の CLI で生成したもの。
    - モデル注入起動の `general-purpose`: 生成した定義から実装の 4 役割(light-impl・normal-impl・complex-impl・general)の定義をすべて消し、解決順の 3 行目(ビルトイン)に落とす。transcript の `subagent_type` が `general-purpose` であることを確かめ、違えばやり直す。
    - 合成で起動した定義: 役割マーカーの無い外部定義を 1 つ置き、§委譲先の実行モデルの確定 の判定表で合成になる形にする。
    - custom 構成の外部ベンダーのモデルの定義: `--scope custom` で生成したもの。
    - fork: S1 と同じ条件で起こす。
  - 完了した委譲先を、5 つの起動形態のそれぞれで SendMessage で再開できるかを見る。再開後の model と effort も見る。
  - 修正の依頼の再開と新しい起動で、修正の作業全体の入力を比べる。指標は、修正の作業で委譲先が出した全リクエストの、費用で換算した入力トークン(`input_tokens` + `cache_creation_input_tokens` × 1.25 + `cache_read_input_tokens` × 0.1)の合計とする。新しい起動の側は、ファイルを読み直す分を含む。
    - 新しい起動の側の試料は、Step 0 で保存した改修前のプラグインに同じ仕掛けを入れ、同じ依頼を流して得る。改修前の規律には再開の条項が無いので、修正は新しい起動で行われる。
    - 比べるのは 1〜3 ラウンドの修正の分(どちらの規律でも書いた委譲先の役割が直す範囲)とする。
  - critical・high があった巡の後に再レビューを依頼し、SendMessage を読み込んで再開を選ぶかを見る。critical・high が無くなったところで回すのを止め、残った medium 以下の判断を仰いで止まるかも見る。
  - 4 ラウンド目で escalation に移り、6 ラウンド目で escalation を新しく起動し直すかを見る。1〜3 ラウンドで escalation に回さないか、差し戻しで escalation に届いたときに 2 ラウンドで起動し直すかも見る。
  - 文書の修正で escalation に回さず、4 ラウンド目から自分で直し、2 ラウンドごとに方針を立て直すかを見る。
- [x] **Step 4: S3(1 時間のキャッシュ)。** better-agentics の S5 と結果を共有してよい。
  - 前提をそろえる: `FORCE_PROMPT_CACHING_5M` と `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` を環境から外す。設定ファイルに `subagentPromptCacheTtl` が無いことを確かめる。サブスクリプションの使用クレジットを消費していない状態で行う。
  - ファイルの定義に `experimental.cacheTtl: 1h` を書き、そのレビュアーを起動する。
  - 判定: 委譲先の `usage` の `cache_creation.ephemeral_1h_input_tokens` が 0 より大きければ効いている。【要確認】transcript にこの項目が残らないときは、5 分を超えてから再開し、`cache_read_input_tokens` が接頭辞の分あれば効いているとみなす。
  - 効かないときは、前提がそろっていたかを確かめ直してから分岐に進む。
- [x] **Step 5: S4(環境変数)。** 設定ファイルの `env` で設定した変数が、SessionStart の hook のプロセスに見えるか確かめる。`CLAUDE_CODE_EFFORT_LEVEL` が `auto`・`unset` のとき、役割の effort が捨てられるかを見る(better-agentics の S9・S1 と共有してよい)。
- [x] **Step 6: S5(委譲先の規律の下書き)。** オーケストレーターは Opus と Sonnet で試す。写しの CLI で、claude 構成と custom 構成の定義を生成する。複数の役割を持つ定義も 1 つ作る。試験用のプロジェクトには、hooks の設定ファイルに手順を定める規約を置かない。次を見る。
  - 依頼文に列挙した外部への操作(push・PR の作成・PR の本文の更新・投稿・MCP 経由の評価)を断らないか。
    - 実在のサービスに届かない環境で試す。起動の環境で `GH_CONFIG_DIR` を空のディレクトリにして gh を未認証にし、`--strict-mcp-config` を付けて MCP サーバーを読まない。
    - push は 1-1 の bare リポジトリへ実際に行う。それ以外は、委譲先がコマンドやツールの呼び出しを試みたかで判定する。
    - 試みて失敗したもの(未認証・ツールが無い)は、断ったとはみなさない。禁止を理由に試みなかったものを、断ったとみなす。
  - 役割の指定が無い依頼文で、複数の役割を持つ定義が作業内容から役割を決めるか。
  - 依頼文の出力の形に従うか。断るときに、依頼文の役割の明示から得た役割 ID を報告に添えるか。
  - Skill ツールの無い定義が、依頼文のパスから SKILL.md を読むか。
  - light-impl が hooks の変更を引き受けるか。hooks の設定ファイルは `.claude/` の下の保護パスで、`permissions.allow` があっても `-p` では書き込みが拒否される。そのため、light-impl が編集を試みたかで判定し、書き込みの拒否は断ったとはみなさない。
  - 並列の 2 つの実装の委譲先が、パスを指定したコミットで互いの変更を混ぜないか。
  - `general-purpose` へ委譲したとき、転記を受けた委譲先が Agent ツールで委譲しないか(J16)。
- [x] **Step 7: S6(外側の手順の原則の下書き)。** オーケストレーターは Opus・Fable・Sonnet で試す。
  - 試験用の準備: 試験用のプロジェクトの `.claude/skills/` に、外側の手順にあたる試験用のスキルを置く。それぞれが次の 1 つを定める。
    - 作業の担い手を明記する(オーケストレーター自身が行う作業を含む)
    - 担い手を条件として書く(「委譲する場合は〜」)
    - 並列の上限
    - 人への聞き方(判断をファイルに書いて止まる、など)
    - 自分のレビュー
    - 別のスキルを名指しで起動させる(連鎖)
  - `.claude/rules/` に、試験用のスキルの名前を挙げて起動を求める rule を 1 つ置く。執筆のスキルの評価の手順を模したものも 1 つ置く。
  - 名前で起動した外側の手順の下で、次を見る。
    - 両立する規律に従い続け、両立しないときだけ外側の手順を優先するか。
    - 外側の手順が自分で行うと定めた作業を委譲しないか。並列の上限を守るか。人への聞き方を使うか。fork を使わないか。
    - 外側の手順が自分のレビューを持つとき、2 つのレビューを重ねずに外側の手順のレビューを優先するか。表に無い対立にも原則を当てるか。
  - 連鎖の先のスキルと、rules が名前を挙げて起動を求めるスキルの手順も、外側の手順として扱うかを見る。rules の執筆のスキルの評価の手順を、レビューの重なりとみなしてレビューを外さないかも見る。
  - 担い手を条件として書いた手順の下では、作業を委譲し続けるかを見る。自分から読み込んだスキルの下では、設計書の 2 つのレビューを続けるかを見る。
- [x] **Step 8: S7(スキルの絶対パス)。** オーケストレーターが SKILL.md の絶対パスを得られるか確かめる。Skill ツールの無い委譲先が、プロジェクトの外のそのパスを許可の確認なしに読めるかも見る。`-p` の実行で Read が拒否されたら、対話のセッションでは許可の確認が出るとみなす。この推定で変わるのは T7 の README の記述だけなので、推定で分岐に進んでよい。バックグラウンドで止まらないかは、ユーザーに対話のセッションで確かめてもらう(better-agentics の 6.5 と共有してよい)。
- [x] **Step 9:** 5 章に結果と分岐の判断を記録し、計画書をパスを指定してコミットする。

**分岐(試作の結果で後のタスクを変える箇所):**

| 試作 | 想定と違うとき | 変えるタスク |
| --- | --- | --- |
| `-p` の確認(1-1) | バックグラウンドの委譲先の完了を待てない、`--resume` の後に再開できない | S1・S2・S6 を、ユーザーに対話のセッションで行ってもらう。実装のセッションは手順を示し、transcript で判定する。T8 も同じ形で行う |
| S1 | fork が委譲を始める | 依頼文の冒頭の指示を強めて試し直す。それでも直らなければ、T6 の fork の条項を書く前にユーザーと D2 を見直す |
| S1 | Sonnet・Fable が条件の判定を誤って fork する | T6 の fork の条件の文面を直して試し直す |
| S1 | 止める設定の下でエラーが分からない | T7 の README に「fork を止めた環境では complex-impl の委譲が失敗しうる」と書く |
| S2 | ある起動形態で再開できない | T6 の再開の条項で、その起動形態は新しく起動する経路だけにする |
| S2 | 修正の作業全体で、再開が新しい起動より高い | 差の大小によらず、T6 の前に両方の数値を添えて、D1 の修正の部分を見直すかをユーザーに聞く。設計書 4.1 は再開が高くなりうると見込んで D1 を決めているので、見直すかはユーザーが決める |
| S2 | 再レビューや再開を選ばない、ラウンドの規則に従わない、文書を escalation に回す | T6 の該当する条項の文面を直して試し直す |
| S3 | 前提をそろえても `cacheTtl: 1h` が効かない | T3 で `experimental` を書かない。T4 のキャッシュの 2 つの警告を作らない。T5 の許可一覧(J8)に `experimental` を足さない。T7 の README に 1 時間のキャッシュを書かない |
| S4 | `env` の変数が hook に見えない | T4 の警告は作る。T7 の README に警告の限界として書く |
| S4 | `auto`・`unset` で effort が捨てられない | T4 の `CLAUDE_CODE_EFFORT_LEVEL` の条件から `auto`・`unset` を外す |
| S5 | 列挙した操作を断る、役割を決めない、パスから読まない | T1 の `_common.md` の文面を強めて試し直す |
| S5 | light-impl が hooks の変更を断る | T2 の断片の文面を見直す。規約が手順を定めるパスに当たっていないかを先に確かめる |
| S5 | 並列の委譲先が互いの変更を混ぜる、Agent ツールで委譲する | T6 のコミットの条項か J16 の条項の文面を直して試し直す |
| S6 | 原則に従わない | T5 の原則の文面を強めて試し直す |
| S7 | 絶対パスを得られない | T5 のスキルの渡し方と T1 の `_common.md:16` の改め方を、「名前で渡し、Skill ツールの無い委譲先には要る手順を依頼文に書く」にする |
| S7 | 許可の確認が出る | T7 の README に、Read の許可の設定(`permissions.allow`)を書く |

### T1: `_common.md` と前置きの役割 ID

設計書 6.1(M3・D16)、J5。契約は 3-1。

**Files:**
- Modify: `plugins/agent-policy/assets/roles/ja/_common.md`、`plugins/agent-policy/assets/roles/en/_common.md`
- Modify: `plugins/agent-policy/src/agents/vocabulary.ts`、`plugins/agent-policy/src/agents/compose.ts`
- Test: `plugins/agent-policy/src/agents/__test__/compose.test.ts`

- [x] **Step 1: 失敗するテストを書く。** 1 役割と 2 役割の定義で、前置きに 3-1 の書式のラベルと ID が並ぶこと(ja・en)。en の定義に日本語と日本語の約物が混ざらないこと。
- [x] **Step 2: `vocabulary.ts` と `compose.ts` を直す。** `{{ROLE_LABELS}}` に ID を添える。前置きのハッシュを使う setup-agents のテスト(`src/__test__/setup-agents.test.ts`)が通ることも確かめる。
- [x] **Step 3: `_common.md`(ja・en)を改める。** 設計書 6.1 の表のとおりである。
  - `:9`: 指定が無いときは、その定義の役割のうち、依頼文の作業内容に最も近い役割で作業する。
  - `:13`: 依頼文が判断を任せた範囲の不明点は、自分で決めて報告に書く。任せた範囲の外は、現行どおり差し戻す。
  - `:14`: 依頼文が作業と書いてよい範囲を列挙しているときは、その列挙を役割の範囲より優先する。作業範囲の拡大は、現行どおり差し戻す。
  - `:15`: 依頼文が作業として明示した外部への操作は、禁止の例外とする。
  - `:16`: 名前と SKILL.md の絶対パスで示されたスキルは、Skill ツールでロードし、Skill ツールが無ければパスを Read で読む。`:17` は残す。S7 の分岐に従う。
  - 足す条項: 出力の形と、断るときの役割 ID(出力の形が定められていても添える)。
  - 出力の形の条項は、readonly の役割断片の「成果物(ファイル)を作らず、報告のみを返す」を外さない(設計書 6.1、J15)。依頼文が出力ファイルを書かせても、readonly の委譲先は断る。
  - Agent ツールの条項は `_common.md` に足さない(J16)。
- [x] **Step 4: テストと build を通し、コミットする。** `pnpm --filter agent-policy-scripts build` の差分を同じコミットに入れる。

### T2: 役割断片の Output Format と light-impl の制約

設計書 4.5(D6・J18)、6.2(D8・D18)。

**Files:**
- Modify: `plugins/agent-policy/assets/roles/{ja,en}/` の 13 役割の断片。`realtime-research.grok.md` は変えない(設計書 4.5)
- Test: `plugins/agent-policy/src/agents/__test__/compose.test.ts`(英語純度)

- [x] **Step 1:** 13 役割の Output Format に、結果が無いときの書き方を足す。文言は役割ごとに決める。例は code-review の「指摘が無いときは『指摘なし』と書き、確かめた範囲を添える」である。
- [x] **Step 2:** レビューの 5 役割の Output Format に、指摘ごとの重大度(critical・high・medium・low)を足す。knowledge-elicitation は、矛盾・不整合と記述の過不足の各項目に付ける。重大度の基準は、設計書 4.1 の「重大度は」の箇条(要件を満たさない・動かない・安全を損なうは critical か high、誤解や後の不具合を招くは medium、表記や体裁だけは low)に合わせる。
- [x] **Step 3:** light-impl の断片(ja・en)の制約から、「全セッションに作用する設定(hooks など)の変更」を外す。規約が手順を定めるパスとデータ移行の項目は残す。ほかの断片の「引き受けない」「差し戻す」の条項は変えない(D8)。
- [x] **Step 4:** `pnpm run test` を通し、コミットする。

### T3: setup-agents の `omitClaudeMd` と `experimental.cacheTtl`

設計書 4.3(D3・D4)、J5・J6・J7・J17、15 章。契約は 3-2。

**Files:**
- Modify: `plugins/agent-policy/src/setup-agents.ts`
- Modify: `plugins/agent-policy/skills/setup-agents/SKILL.md`
- Test: `plugins/agent-policy/src/__test__/setup-agents.test.ts`

- [x] **Step 1: 失敗するテストを書く。**
  - 既存の `experimental` の他の下位キーが残る。
  - 「付けない」の回答(`--omit-claude-md false`)を受けたときだけ、`omitClaudeMd` の行が消える。`--merge` で再生成し、自動保持が戻した行も消える。
  - 質問しない経路で、既にある定義の `omitClaudeMd` が残り、新しく作る定義には推奨どおり付く。複数の役割を持つ定義では、全役割が knowledge-elicitation のときだけ付く。
  - 「完全上書き」でも、答えていない値と他の下位キーが残る。
  - レビューの役割を持ち Claude のモデルで動く定義に、`cacheTtl: 1h` が書かれる。既存の `cacheTtl: 5m` は `1h` に書き換わる。
  - `model` が Claude の別名で `agent-policy-vendor: gpt` の定義には書かれない。
  - 外部ベンダーのモデルに変えた定義から、`cacheTtl` だけが消える。下位キーが残らなければ `experimental:` の行も消える。
  - レビューの役割を持たない定義と、フロー形式の `experimental` を持つ定義では、`experimental` が変わらない。
  - 2 キーを持つ定義を変えずに `--check` すると、`identical: true` で、`keysOnlyInExisting` に 2 キーが載らない。
  - `--check` と `--write` の `twoKeys` の `before`・`after` が正しい。`--check` に `--omit-claude-md` を渡してもエラーにならない。
- [x] **Step 2:** 3-2 の専用の処理、ブロックの下の行の補助関数、`--check` の比較、CLI の引数を実装する。`automaticKeep` は変えない。
- [x] **Step 3:** `SKILL.md` を改める。質問の書き方は、既存の SKILL.md の「書き込みと対話の規律」に従う。
  - ステップ 5n・5b に、`omitClaudeMd` の質問を足す。生成する定義ごとに 1 回聞く。1 つの役割だけを持つ定義では、設計書 4.3 の「役割ごとに聞く」と同じになる。複数の役割を持つ定義の推奨は、3-2 のとおりにする。選択肢は「付けない」「付ける」である。
  - 推奨の側に「(推奨)」を付ける。既存の値(5b では `--check` の `twoKeys.omitClaudeMd.before`)があればその側を先頭に、無ければ推奨の側を先頭に置く。
  - 選択肢の説明に、CLAUDE.md・`.claude/rules/`・ユーザーの rules が届かなくなることを書く。
  - 対話モードのステップ 7 と非対話モードの手順 5 の報告に、`twoKeys` から決めた「書き込んだ・書き換えた・消した」定義を載せる。`kept` の `key:omitClaudeMd`・`key:experimental` は、保持した項目として載せない。
- [x] **Step 4:** テストと build を通し、コミットする。

### T4: SessionStart の警告

設計書 4.4(D5)、J9。契約は 3-3。

**Files:**
- Modify: `plugins/agent-policy/src/hooks/marker-scan.ts`、`plugins/agent-policy/src/hooks/session-start.ts`
- Test: `plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts`、`plugins/agent-policy/src/hooks/__test__/session-start.test.ts`

- [x] **Step 1: 失敗するテストを書く。** 設計書 4.4 の表の 4 条件で警告が出ること。
  - `none`・未設定では出ないこと。custom の旧値では出ること。
  - `CLAUDE_CODE_SUBAGENT_MODEL` だけでは出ないこと。
  - `FORCE_PROMPT_CACHING_5M` は空でない値のときに当たり、`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` は `5m` のときだけ当たること。どちらも `cacheTtl1h` の定義があるときだけ出ること。
  - `cacheTtl1h` の判定は、親のブロックが `experimental` で値が `1h` のときだけ真になること。
- [x] **Step 2:** 実装する。値は、既存の `isCustomInjection` に合わせて `trim().toLowerCase()` で比べる。警告の文言は、既存の注入文のブロックと同じ形で足す。
- [x] **Step 3:** テストと build を通し、コミットする。

### T5: 規律の原則と整理(外側の手順・人に聞く場面・並列・レビュー・スキル・起動の指定・判定表)

設計書 4.7(D13〜D16・D19・J21・J26)、5 章(D7・D12・J14・J22・J24)、5.3(J10・J11・M1)、5.4(J12)、4.5(J19)、6.1(`:139`)、6.2(J25)、J8・J23。

**Files:**
- Modify: `plugins/agent-policy/references/orchestration-discipline.md`
- Test: `plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts`(担当表が変わっていないこと)

- [x] **Step 1:** §オーケストレーターが自ら担う作業 を改める(設計書 5.1)。
  - 最後の文(「コマンドで起動したスキルの手順…ワークフローの手順を優先する」)を、原則に置き換える。原則は「両方に従い、両立しないとき(同じ目的の手順が重なるときを含む)だけ、名前で起動した外側の手順を優先する」である。両立しない条項だけを当てない。
  - 「名前で起動した」の範囲(J24。連鎖を含む)と、外側の手順の期間を書く。自分から読み込んだスキルは、両立しないときは規律に従う(D12)。
  - 担い手を条件として書いた手順の扱い(J14)を書く。
  - 外側の手順が複数の役割にまたがる作業の単位を定めたときは、その単位の全体を 5 軸で 1 つの役割に当てる、を書く。
  - 「担当表の全役割はサブエージェントが担い、オーケストレーターはそのどれも自ら実行しない」に、選び直しの候補が尽きたときはオーケストレーターが自分で行う、の例外を足す(J23)。
  - 5.1 の表は写さない。
- [x] **Step 2:** 人に聞く場面を改める(設計書 4.7・5.4)。
  - 「レビューの指摘が対立し…`AskUserQuestion`…」の条項を、前半・後半とも消す(D14・J21)。
  - 起動のエラーの報告の条項を、§モデル別役割の運用 に足す。起動のエラーは、Agent ツールの呼び出しがエラーを返すことを指し、委譲先の報告の中の失敗は含まない。
    - claude 構成では、最初の起動のエラーで、別のモデルで起動し直さずに報告する。
    - custom 構成では、方針スキルの読み替え(同じ委譲先で 2 回続いたら担当表のモデルへ)を保つ。読み替えた後も起動できないときに、さらに別のモデルで起動し直さずに報告する。
  - 外側の手順が人の判断の代わりの仕組みを定めていれば、それに従う条項を足す。対象は、起動のエラーの報告、§設計・実装計画の規律 のユーザーの承認、再レビューの最後の巡の判断を仰ぐ場面の 3 つである。
  - §外部定義固有の MCP tool の提案の条項に、外側の手順が人への聞き方を定めているときは提案せず手順 3 に進む、を足す(J12)。
- [x] **Step 3:** 「独立したタスクが複数あるとき…並列に起動する」の条項に、並列の 2 条件と並列中の検査の制限を足す(D13・J26)。
- [x] **Step 4:** §設計・実装計画の規律 を改める。
  - 2 つのレビューを並列に起動する(D15)。他のレビューの指摘を渡さない規定は残す。
  - 「補足修正を加えてからユーザーへ提示して承認を得る」は、T6 の再レビューの回し方を終えた後に行う(設計書 4.1)。
- [x] **Step 5:** スキルの渡し方の条項を足す(D16)。§サブエージェントの規律 の「依頼文で指定されたスキルだけをロードする」条項も、この形に改める。スキルの条項は T5 だけで扱う。S7 の分岐に従う。
- [x] **Step 6:** 依頼文の役割の明示(「委譲の依頼文の冒頭で、その委譲が担う役割を明示する」)を、すべての委譲で役割のラベルに ID を添える形に改める(設計書 6.1。書式は 3-1)。
- [x] **Step 7:** スクリプトに渡す起動の指定の条項を足す(設計書 5.3、J10・M1)。
  - 起動の指定は、Agent ツールで起動するときと同じ手順で決める。
  - 前置きに入れる項目(項目の名前は外側の手順に従う):
    - 依頼文に書く項目(サブエージェントの明示・役割の明示・「サブエージェントは〜」の転記・フォールバックの明記)
    - ビルトインへ委譲するときは、元の役割の役割断片の本文
    - 合成で起動するときは、外部定義の本文と、その禁止条項・制約条項がホストの本文より優先する旨
    - readonly の役割を Write・Edit を持つ定義へ回すときの明記
    - 実装の役割では、変更した各箇所を判定した検査とその結果を報告に添える指示
    - custom 構成では、「この tools のみ使用」の明記
  - fork の指定は渡さない(J3・M2)。
  - 断られた作業の選び直しの順を書く(J11)。どの定義が断ったかは渡した起動の指定の控えで、どの役割で断ったかは役割 ID で知る。実装の役割は差し戻しの経路で上げ、それ以外は §同じ役割の候補から選ぶ の順で次の候補を選ぶ。
  - 候補が尽きたときは委譲しない(D17)。外側の手順の中では外側の手順の既定の担い手に任せ、外側の手順の外ではオーケストレーターが自分で行う(J23)。
  - レビューの役割の候補が尽きて自分で見直したときは、再レビューの巡に数えず、レビューが済んでいないことをユーザーへの報告に書く。
- [x] **Step 8:** その他の条項を改める。
  - 「全セッションに作用する設定(hooks など)・保護パス・データ移行は…light-impl へ委譲しない」から全セッションの設定を外す。代わりに、全セッションに作用する設定を変えたときは、コミットの後に必ずコードレビューを依頼する、を足す(J25)。
  - 「その役割の Output Format を依頼文で指定する」を、「定義の本文か転記した断片に Output Format が無いときだけ指定する」に改める(J19)。
  - 起動形態の判定表の 3 行目の許可一覧に `omitClaudeMd` と `experimental` を足す。`experimental` は下位キーが `cacheTtl` だけのときに限る、という条件は、表の直後の注記に書く(J8。S3 の分岐に従う)。
- [x] **Step 9:** `pnpm run test` を通し、`wc -c` の結果を 5 章に記録してコミットする(J13)。

### T6: 規律の委譲の往復(再レビュー・再開・修正のループ・コミット・fork・サブエージェントの規律)

設計書 4.1(D1・D11・D20・J20・J27〜J29)、4.2(D2・J1〜J4・M2)、6.1(J16)。

設計書 4.1 の箇条は、すべて規律に書く。ステップの下の箇条は、落としやすい規則を挙げたもので、閉じた一覧ではない。書くときは Global Constraints のとおり、他プラグインの名前・判断の番号・行番号を除いて条項の文面にする。

**Files:**
- Modify: `plugins/agent-policy/references/orchestration-discipline.md`

- [x] **Step 1:** 再レビューの条項を足す(D11)。
  - 指摘の採否はオーケストレーターが決める。
  - critical・high があった巡では、その巡の指摘に medium 以下を含めてすべて対応する。対応とは、採る指摘を直すか、採らない指摘の理由を記録するかのどちらかである。対応したうえで、同じ観点の再レビューを依頼する。critical・high が残らなくなるまで上限なく回す。
  - critical・high の無い巡では、その巡の medium 以下に対応せず、直さないまま判断を仰ぎ、答えを待つ。答えを得るまで、ユーザーへの提示・完了の報告・push に進まない。仰ぐ先と聞き方は外側の手順に従い、定めが無ければオーケストレーターが選ぶ。
  - この条項は、§設計・実装計画の規律 の 2 つのレビューにも当てる。
  - 実装のレビューはコミットの後に行う。指摘を直した変更も、コミットしてから再レビューに回す。
  - 文書のレビュー中は、依頼したレビューがすべて戻るまで、その文書を編集しない。
  - 重大度が返らないときは、オーケストレーターが指摘ごとに判定する。基準は T2 Step 2 と同じである。
- [x] **Step 2:** 再開の条項を足す(D1)。
  - 再レビューは、前の巡のレビュアーを SendMessage で再開して頼む。送るのは、直した後の差分の取り方か文書のパスと、満たすべき要件だけとする。指摘の採否や自分の結論は送らない。
  - 修正の依頼では、直す指摘(採った指摘の本文)と、満たすべき要件を送る。直さないと決めた指摘は送らない。
  - レビューの対象のコードは、コミットの範囲で渡す。作業の間に別の委譲先が同じブランチへコミットしたときだけ、コミットの ID を列挙する(J20)。
  - レビューを依頼する前に、対象の変更がコミットされていることを確かめる(J20)。
  - 再開するときは、前の委譲で選んだ定義と起動形態を引き継ぎ、候補を選び直さない。「候補から 1 件を選ぶことと起動形態を決めることを委譲のたびに行う」の条項を当てない。
  - `agentId` で再開する相手を指し、委譲した作業との対応を会話に残す。失ったとき、再開できないとき、再開がエラーになったときは、同じ委譲先と起動形態で新しく起動する。S2 の分岐に従う。
- [x] **Step 3:** 修正のループの回し方を足す(D20)。置き場所は、差し戻しの経路の 2 行(「light-impl または normal-impl から差し戻された作業は…」と「complex-impl でも解けない作業は escalation へ委譲する」)の後とする。2 行の間には入れない。次を落とさない。
  - ラウンドの数え方(変更ごと、巡ごとに 1 つ)。文書と文書以外の指摘が同じ巡にあるときは、指摘ごとに規則を当て、ラウンドの番号は共通にする。
  - 1〜3 ラウンドは、指摘が当たる箇所を書いた委譲先を再開して直させる。書き手が複数なら書き手ごとに分ける。オーケストレーターが書いた箇所は自分で直す。
  - 実装と設定の修正は、4 ラウンド以上で escalation に委譲する。4 ラウンド目で 1 体目を起動し、5 ラウンド目はその再開とする。6 ラウンド目で同じ定義と起動形態の 2 体目を起動し、以降も 2 ラウンドごとに起動し直す。
  - escalation への依頼文の 3 項目(試行履歴・失敗出力の原文・未解決の制約)の中身。
  - ループの中では、5 軸の escalation の条件を当てず、1〜3 ラウンドは escalation に回さない(J28)。4 ラウンド目以降は「初回の作業は escalation へ委譲しない」に当たらない(J29)。
  - 差し戻しの例外。差し戻しで escalation に届いたら、その escalation が連続する 2 ラウンドまで受け持つ。escalation が断ったときは、オーケストレーターがそのラウンドを直し、次の起動し直しの時点で改めて escalation に委譲する。
  - 文書の修正(J27)。文書の定義(実行やテストだけでは正しさを確かめきれない成果物)と、設計書 4.1 の列挙(設計書・計画書・README・CLAUDE.md・rules・SKILL.md・役割断片・Agent 定義)を書く。役割断片や SKILL.md のように一部をテストが検査するものも、文面の正しさはテストで確かめきれないので、文書に含める。1〜3 ラウンドは書いた担い手が直し、委譲先が書いた文書はその委譲先を再開して直させる。文書を直す委譲先が差し戻したときは役割を上げず、オーケストレーターが直す。4 ラウンド目からはオーケストレーターが直し、4 ラウンド目と以降の 2 ラウンドごとに方針を立て直す。指摘の出た箇所だけを書き直す。
  - この規則はレビュアーには当てない。
  - 外側の手順の下では、修正の回し方も外側の手順に従う。外側の手順が行き詰まりの打開の単位を出したら escalation に委譲し、単位が文書の修正ならオーケストレーターが直す。
- [x] **Step 4:** コミットの指示の条項を足す(J20)。
  - レビューを依頼する変更だけ、委譲先にパスを指定してコミットさせる(`git commit -- <paths>`)。
  - コミットを禁じるプロジェクトでは、作業ツリーの差分で渡す。
- [x] **Step 5:** fork の条項を足す(D2・M2)。S1 の分岐に従う。
  - fork するのは、次をすべて満たすときだけとする。
    - 5 軸で complex-impl に当たり、判断部分の成果を文書に固定できず、作業の全体を complex-impl に任せる。
    - complex-impl の委譲先の実行モデルが、オーケストレーター自身のモデルと同じである。
    - 外側の手順に従って作業している間ではない。
  - 実行モデルの比べ方(J1): §委譲先の実行モデルの確定 で決まるモデルと、環境の欄のオーケストレーターのモデルの系統を、`fable`・`opus`・`sonnet`・`haiku` で比べる。決まらないとき、完全なモデル ID のとき、外部ベンダーのモデルのときは、一致とみなさない。
  - 拒否されたときは、complex-impl の通常の起動に戻す(J2)。
  - 依頼文の冒頭に置く項目(J4。設計書 4.2):
    - fork された complex-impl の担い手であること。会話の履歴にあるオーケストレーターの規律(委譲・担当表の役割を自ら実行しない・委譲先の解決)を当てず、依頼文の作業だけを行うこと。
    - 使ってよいツールは、選んだ complex-impl の定義の `tools` に限ること。定義が無いときは、complex-impl の役割断片の `tools` に限る。
    - 選んだ complex-impl の定義の本文。定義が無いときは、ビルトインへ委譲するときと同じ置き場所から選んだ complex-impl の役割断片の本文。
    - 「サブエージェントは〜」で始まる条項の転記(Step 6 の 3 条項を含む)。
- [x] **Step 6:** §サブエージェントの規律 に「サブエージェントは〜」の形で 3 つの条項を足す(設計書 6.1)。スキルのロードの条項は T5 で扱ったので、ここでは扱わない。
  - 出力の形の条項(readonly の安全弁を外さない)
  - 役割 ID の条項
  - Agent ツールでさらに委譲しない条項(J16)
- [x] **Step 7:** `pnpm run test` を通し、`wc -c` の結果を 5 章に記録してコミットする。

### T7: 文書と移行の案内

設計書 9 章、7 章(D10・M6)、14 章。

**Files:**
- Modify: `plugins/agent-policy/README.md`、ルートの `README.md`
- Modify: `.serena/memories/agent_policy/core.md`(Serena の `edit_memory` で変える)
- Modify: `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`

- [x] **Step 1:** プラグインの README に、設計書 9 章の項目をすべて書く。
  - 「0.21.8-dev の改修で変わる挙動」と移行の案内。前置きの `:9` と役割 ID は、setup-agents の再実行で前置きの置き換えを選ぶまで入らないことを書く。プロジェクトの `_common.md` と翻訳断片についても書く。
  - fork・警告・2 キー・必要なバージョン、gate と両立しない運用(M6)。
  - 修正のループの回し方と限界、`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`。
  - T0 の分岐で足すと決まった記述。
- [x] **Step 2:** ルートの README の agent-policy の説明に、再レビュー・再開・fork・外側の手順の条項を反映する。
- [x] **Step 3:** Serena のメモリの agent-policy の項を、規律と生成する定義の変更に追随させる。
- [x] **Step 4:** 食い違いの文書を直す。
  - G3・G4・G6・G8・G10 の agent-policy 側を「解消済み」にする。
  - G7 は「直さない」と記し、J16 を添える。
  - G11 は「直さない。delegation gate を有効にしたプロジェクトでは codiel と併用できない」と記す(M6)。
- [x] **Step 5:** ARCHITECTURE に影響する変更が無いかを確かめる。あれば `/metatron:update` で追随させる。
- [x] **Step 6:** codiel への申し送り(設計書 9 章)を、作業の報告に書く。内容は、codiel 1.2 のリリースの案内(codiel の README)に agent-policy の setup-agents の再実行を書いてもらうことである。codiel のファイルは変えない。
- [x] **Step 7:** コミットする。

### T8: 最終の検証と実機の確認

設計書 13 章(S2・S5・S6 の本番の文面での確かめ直し)、規約の「Done の条件」。

- [x] **Step 1:** `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` を通す。`scripts/` に差分が残っていないことを確かめる。
- [x] **Step 2:** 1-1 の手順で、`--plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy` を指して S2・S5・S6 を確かめ直す。試験用のプロジェクトの `.claude/agents/` は、このディレクトリの CLI で生成し直す。生成し直すと本文に足した仕掛けが消えるので、T0 の Step 3 の仕掛けと起動形態の用意をやり直す。
  - オーケストレーターは、S2・S6 では Opus・Fable・Sonnet、S5 では Opus と Sonnet で試す。
  - T0 で T8 に回した項目(前置きの役割 ID と、断るときに添える ID)も確かめる。
- [x] **Step 3:** 確認の結果を 5 章に記録する。想定と違う点は、規律の文面で直してから確かめ直す。
- [x] **Step 4:** `plugin.json` と `package.json` が `0.21.8-dev` のままであることを確かめ、計画書をパスを指定してコミットする。

## 5. 実施記録

### 5-1. 改修前のプラグインと定義の保存先(T0 Step 0)

- 改修前のプラグイン: `~/agent-policy-prechange/plugins/agent-policy`。コミット `ad3db392` から `git archive` で取り出した。`plugins/agent-policy` は `ad3db392` から `aa12bddc` まで差分が無い。
- claude 構成の定義(13): `~/agent-policy-prechange/defs-claude-ja/.claude/agents/`
- custom 構成の定義(13): `~/agent-policy-prechange/defs-custom-ja/.claude/agents/`。プロキシに届かず、既定のエイリアスで生成された。

### 5-2. 下書きの写しと試験用のプロジェクト(T0 Step 1)

- 下書きの写し: `~/agent-policy-trial/plugin/`。規律の下書きは `~/agent-policy-trial/build/final.md`(T5・T6 の後の形)。
- 試験用のプロジェクト: 場面とモデルごとに `~/agent-policy-trial/p-<場面>-<モデル>/` を作った。作り直しは `setup-project.sh`、起動は `run.sh`、transcript の判定は `analyze.py` と `segcost.py`。
- 計画書 1-1 の起動の形に、次の 3 点を足した。
  - 信頼ダイアログを経ていないプロジェクトでは `.claude/settings.json` の `permissions.allow` が無視される。許可は `--allowedTools` で渡した。
  - プロンプトは標準入力で渡した。`--allowedTools` が後ろの引数を取り込むためである。
  - 親セッションの環境変数(`AMATSUKA_AGENT_ENABLE_ORCHESTRATION`・`CLAUDE_CODE_PLUGIN_DIRS`・`TYPESAFE_API_KEY` など)を外して起動した。

### 5-3. T0 の結果

| 試作 | 構成 | オーケストレーター | 観測 | 判定 |
| --- | --- | --- | --- | --- |
| `-p` の確認 | claude | Sonnet | バックグラウンドの委譲先の完了を待って結果を返した。`--resume` の後に、前の実行の委譲先を SendMessage で再開できた | 成立。対話のセッションに回さない |
| 読み込みの確認 | claude | Sonnet | 写しの規律に入れた目印の行を引用した | 写しを読んでいる。目印は消した |
| S1 | claude | Opus | complex-impl を fork で起動した。依頼文の冒頭に、担い手であること・規律を当てないこと・tools・定義の本文・転記を置いた。fork の中で Agent ツールを呼ばなかった | 想定どおり。定義の本文を要約して載せたので、規律に「frontmatter より後の全文」と書いた |
| S1 | claude | Sonnet・Fable | モデルの系統が違うことを理由に fork せず、通常の起動にした | 想定どおり |
| S1 | claude、`CLAUDE_CODE_FORK_SUBAGENT=0` | Opus | `Agent type 'fork' not found` を受けて、opus-lead-implementer の通常の起動に戻った | 想定どおり。README の注記は要らない |
| S1 | claude、`--disallowedTools "Agent(fork)"` | Opus | 許可の規則による拒否を受けて、通常の起動に戻った | 想定どおり |
| S2(再開の形態) | claude | Sonnet・Opus | 生成した定義・モデル注入起動の `general-purpose`・fork・名指しの外部定義は、SendMessage で再開でき、再開後もモデルが保たれた。合成は、オーケストレーターがそのまま起動を選んだので観測していない | 再開できない形態は無い。合成はホストが生成した定義なので、生成した定義と同じく再開できると推定する |
| S2(ループ) | claude | Sonnet | 1〜3 ラウンドは実装の委譲先を再開した。4 ラウンド目で escalation を起動し、5 ラウンド目はその再開、6 ラウンド目で 2 体目を起動した。7 ラウンド目の README は自分で直した。medium だけの巡で直さずに判断を仰いで止まった | 想定どおり |
| S2(ループ) | claude | Fable | 1〜3 ラウンドは再開、4 ラウンド目で escalation を起動、5 ラウンド目はその再開。6 ラウンド目の README と、設計メモの 5 ラウンドはすべて自分で直した。medium だけの巡で判断を仰いだ | 想定どおり。6 ラウンド目の escalation の起動し直しは Sonnet でだけ観測した |
| S2(ループ) | claude | Opus | 1〜3 ラウンドは再開、4 ラウンド目で escalation を起動、README は自分で直した。medium だけの巡で判断を仰いだ | 想定どおり |
| S2(費用) | claude | Sonnet | 1〜3 ラウンドの修正の 1 ラウンドあたりの費用換算の入力トークン。Haiku の light-impl は、再開が 4,542〜6,657、新しい起動(改修前)が 9,044〜10,125。Sonnet の normal-impl は、再開が 6,861〜8,735、新しい起動(改修前)が 14,584 | 再開のほうが安い。分岐に当たらない |
| S2・S5(custom) | custom | Sonnet | プロキシ経由で、GPT の実装の定義(`gpt-sol-implementer`)が依頼文に列挙したパス指定のコミットと origin への push を断らずに行った。GPT のレビューの定義(`gpt-sol-code-reviewer`)は SendMessage で同じ agentId のまま再開でき、再開後も `gpt-6.1-sol` で動いた | 想定どおり |
| S3 | claude | Sonnet | `cacheTtl: 1h` を書いたレビュアーは `ephemeral_1h_input_tokens` に 7,700 を書き込んだ。書かないレビュアーは 5 分の書き込みだけだった | 効く。T3・T4・T5 をそのまま行う |
| S4 | claude | Haiku | 設定ファイル(`--settings`)の `env` の変数が、SessionStart の hook に見えた | 見える。`CLAUDE_CODE_EFFORT_LEVEL` は、ユーザーが対話のセッションで確かめた。設定なしでは `/tasks` に `haiku, low` と出た。`auto` と `unset` では effort が出ず、`unset` ではメインセッションから付けられなかった。役割の effort が捨てられるので、警告の条件は空でない値すべてのまま変えない |
| S5 | claude | Opus・Sonnet | 依頼文に列挙した push を行い、gh は試みて許可外で失敗した。断ったものは無い。役割の指定の無い複数役割の定義が code-review を選んだ。出力ファイルの指定を断り、役割 ID `code-review` を添えた。Skill ツールの無い light-impl が絶対パスから SKILL.md を読んだ。light-impl が hooks の設定ファイルの編集を試みた(保護パスで拒否)。並列の 2 つの委譲先のパスを指定したコミットは混ざらなかった。`general-purpose` は Agent ツールを呼ばなかった | 想定どおり。MCP 経由の評価は、MCP サーバーを読まない条件で試したので観測していない |
| S6a | claude | 3 モデル | 調査を委譲せず、実装を 1 つずつ委譲し、外側の手順のレビュー 1 回だけで再レビューせず、fork しなかった | 想定どおり。人への聞き方は、判断が要る点が出ず観測していない |
| S6b | claude | 3 モデル | 担い手を条件として書いた手順の下で、委譲を続けた | 想定どおり |
| S6c | claude | 3 モデル | rules が名前を挙げた執筆のスキルの自己点検があっても、2 つのレビューを並列に続けた | 想定どおり |
| S6d | claude | Opus・Fable | 自分から読み込んだスキルの「レビューに回さない」より規律を優先した | 想定どおり |
| S6d | claude | Sonnet | 規律の文書を読まずに、自分から読み込んだスキルに従ってレビューを省いた。方針スキルに「作業の前に規律を全文読む」、規律に「自分から読み込んだスキルが規律の手順を省くと定めても省かない」を足して試し直すと、2 つのレビューを行った | 分岐に当たる。T5 で直した |
| S7 | claude | Sonnet | SKILL.md の絶対パスは、Skill ツールでロードしたときの Base directory から得た。Skill ツールの無い委譲先の、プロジェクトの外の Read は `-p` で拒否された | 対話のセッションでは許可の確認が出るとみなす。T7 の README に Read の許可を書く。`_common.md` に、示されたスキルを読めないときは差し戻す条項を足した |

- S2 の仕掛けは 3 回作った。1 回目は隠した要件を定義の本文に書いたので、オーケストレーターが原本の確認で読み、先回りして直した。2 回目は確認スクリプトが 1 件ずつ返す形にした。依頼外の公開 API を求められて止まる試行があったので、3 回目は依頼文で範囲内と明記した。判定には 2 回目と 3 回目を使った。
- 依頼文が「途中で質問しない」を含む試行では、medium 以下の判断を自分で決めたものがあった。依頼文に引かれたもので、規律の文面は変えない。

### 5-4. 分岐の判断

| 試作 | 判断 |
| --- | --- |
| `-p` の確認 | 成立。T8 も `-p` で行う |
| S1 | 分岐なし |
| S2 | 分岐なし |
| S3 | 分岐なし。`experimental` を書き、警告を作り、許可一覧に足す |
| S4 | `env` は見えるので、README に限界として書かない。`auto`・`unset` でも effort が捨てられるので、T4 の警告の条件を変えない |
| S5 | 分岐なし |
| S6 | S6d の Sonnet で当たった。T5 で方針スキル 2 本と原則の文面を直し、試し直して通った |
| S7 | 許可の確認が出る側。T7 の README に Read の許可の設定を書く |

### 5-5. レビューで採らなかった指摘

- T1・T2: `_common.md` に入らない既存の文(design-review の「原本のみ」、「本文に載せる」例、light-impl のパターン、ja と en の「必要なら」の差)。今回の変更の範囲外である。CRLF の定義で 2 キーの行の改行が混ざる指摘(T3)は、保持マージが CRLF の定義を元々扱えないので採らない。
- T5: 判断が要る差し戻しを上位の役割へ送ること、custom 構成の読み替えの発動条件は、既存の差し戻しの経路と custom-policy の既存の定めそのもので、範囲外である。delegation gate と候補が尽きたときの経路の衝突は、T7 の README の gate の説明に書く。英語の依頼文の役割名、合成の前置きの tools の上限、本文を読まない起動形態の Output Format は low で採らない。T5 の再レビューは 3 巡で、毎巡、直した箇所から新しい medium が出た。ユーザーの判断で、3 巡目の指摘を直した形でコミットした。
- T6: 文書と実装でラウンドの番号を共通にするので実装の初めての修正が escalation に行くこと(設計どおり)、委譲先ごとのコミットでソースとバンドルが別のコミットになること(このリポジトリの規約の話)、英語の依頼文の役割名・`inherit` の定義の fork の判定・fork の effort などの low は採らない。修正のループの本体は、計画の「差し戻しの経路の 2 行の後」ではなく、その位置に参照の 1 行を置き、本体を `### 修正のループ` として §委譲先の再開 の後に置いた。差し戻しの経路の箇条の並びを割らないためで、T0 で試した下書きと同じ構成である。T6 の再レビューは 4 巡で、4 巡目の knowledge-elicitor の high 1 件と medium 1 件を直してコミットした(ユーザーの判断で 4 巡目まで回した)。
- T7: ARCHITECTURE は ADR とプロジェクト全体の構成だけを持ち、agent-policy の規律や生成する定義の契約を書いていない。直す記述が無いので `/metatron:update` は使わない。

### 5-6. 規律の `wc -c`

- 改修前: 24,909 バイト
- T5 の後: 34,429 バイト
- T6 の後: 48,462 バイト

### 5-7. T8 の結果

`--plugin-dir` で `plugins/agent-policy` を指し、試験用のプロジェクトの定義をこのディレクトリの CLI で生成し直して試した。生成した定義の前置きには `「コードレビュー」(code-review)` の形で役割 ID が入り、レビューの役割の定義には `experimental.cacheTtl: 1h`、knowledge-elicitation の定義には `omitClaudeMd: true` が入った。

| 試作 | オーケストレーター | 観測 | 判定 |
| --- | --- | --- | --- |
| S2 | Opus・Fable・Sonnet | 1〜3 ラウンドは実装の委譲先を SendMessage で再開した。4 ラウンド目で escalation を起動し、5 ラウンド目はその再開、6 ラウンド目で同じ定義の 2 体目を新しく起動した。7 ラウンド目の README は文書の規則で扱った。medium だけの巡で直さずに判断を仰いで止まった。レビュアーは 1 時間のキャッシュを書き込んだ(Sonnet のレビュアーで 18,724〜23,206 トークン) | 想定どおり |
| S5 | Opus・Sonnet | 依頼文に列挙した push を行い、gh は試みて許可外で拒否された。light-impl は hooks の設定ファイルの編集を試みた(保護パスで拒否)。Skill ツールの無い委譲先が絶対パスから SKILL.md を読んだ。役割の指定の無い複数役割の定義が code-review を選んだ。readonly の委譲先は出力ファイルを書くことだけを断り、結果と役割 ID `code-review` を返した。オーケストレーターはそれを選び直しに回さなかった。並列の委譲先のコミットは混ざらなかった | 想定どおり |
| S6a | Opus・Fable・Sonnet | 調査を委譲せず、実装を 1 つずつ(Sonnet は 1 本にまとめて)委譲し、外側の手順のレビュー 1 回だけで再レビューせず、fork しなかった | 想定どおり |
| S6b | Opus・Fable・Sonnet | 担い手を条件として書いた手順の下で、実装を委譲した | 想定どおり |
| S6c | Opus・Fable・Sonnet | rules が名前を挙げた執筆のスキルの自己点検があっても、2 つのレビューを並列に回した | 想定どおり |
| S6d | Opus・Fable・Sonnet | 自分から読み込んだスキルの「レビューに回さない」より規律を優先し、2 つのレビューを並列に回した | 想定どおり。T0 で失敗した Sonnet も通った |

- 規律の文面を直してから確かめ直した箇所は無い。
- `pnpm run lint`(既存の codiel の警告 1 件のみ)・`typecheck`・`test`(4,248 件パス)・`build` が通り、build の後に `plugins/` の差分は無い。
- `plugin.json` と `package.json` は `0.21.8-dev` のままである。
