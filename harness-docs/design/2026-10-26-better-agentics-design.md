# better-agentics プラグイン 設計書

- 作成日: 2026-10-26
- ステータス: 承認済み(2026-10-26)
- 更新基準: 実装を始めた後に本書を直すのは、(a) 本書の 2 箇所が両立しないと実装中に分かったときの解消と、(b) 実装のほうが正しいと判断した箇所への追随(理由を添える)に限る。設計判断を変える必要が出たら、実装を止めてユーザーに確認する。
- 対象プラグイン: `plugins/better-agentics/`(新規。`0.0.1-dev`)
- 前提資料:
  - `harness-docs/ARCHITECTURE.md`(レイヤー構造、依存方向、ディレクトリ構成、コマンド定義)
  - `.claude/rules/metatron/conventions.md` / `testing-policy.md` / `protected-paths.md`
  - `plugins/agent-policy/references/orchestration-discipline.md`(規律の出発点)
  - `plugins/agent-policy/skills/setup-agents/SKILL.md` と `src/setup-agents.ts`・`src/agents/*`(setup の出発点)
  - `plugins/agent-policy/assets/roles/{ja,en}/`(役割断片の出発点)
  - `plugins/agent-policy/src/hooks/session-start.ts` と `marker-scan.ts`(SessionStart の出発点)
  - `plugins/jevriel/src/jev/client.ts`(Jev の呼び出し方の参考。import はしない)

---

## 1. 背景・目的

### 1-1. agent-policy との違いは「オーケストレーターが自分で働く」こと

agent-policy の規律では、オーケストレーターは担当表のどの役割も自分で実行せず、調査も実装もサブエージェントへ委譲する。better-agentics はこの配分を逆にする。調査・分析・要件確定・設計書と計画書の執筆・実装・テスト・検証は、オーケストレーター自身が行う。サブエージェントへ委譲するのは、次の 3 つの理由のどれかに当たるときだけである。

| 理由 | 場面 |
| --- | --- |
| `review` | 自分の成果物を、自分以外の目で確かめる必要があるとき |
| `split` | 大きな作業を、自分と分担して進めるとき |
| `stuck` | 自分で原因を追っても解決しないとき |

### 1-2. 委譲先は Jev が選び、選択基準はオーケストレーターに持たせない

オーケストレーターが持つのは「いつ委譲するか」の基準だけである。委譲すると決めたら、理由と作業内容をスクリプト `pick-delegate` に渡す。スクリプトは TypeSafe AI の判断モデル Jev に、どの定義へ委譲するかを問う。各定義の「どんな作業に向くか」という基準は、定義本文の `## When to invoke` に書き、スクリプトだけが読む。Claude Code がオーケストレーターの Agent 一覧に載せるのは定義の `description` だけで、本文は載らない。そのため基準はオーケストレーターの文脈に入らない。

### 1-3. agent-policy の claude プロファイルだけを抜き出して軽くする

外部ベンダーのモデル、ローカルプロキシの live models 照会、1 つの役割に複数の定義(特化定義)、起動形態の判定(モデル注入・合成)を持たない。定義は 1 役割に 1 つで、`model` と `effort` を frontmatter に固定する。役割の種類(RoleId 13 種)は agent-policy と同じにする。

---

## 2. スコープ / 非スコープ

### 2-1. スコープ

- スキル 2 本: `better-agentics:setup`(定義の生成ウィザード)、`better-agentics:orchestration`(オーケストレーターの規律)
- 参照文書 1 本: `references/subagent-policy.md`(サブエージェントの規律)
- 役割断片: `assets/roles/{ja,en}/_common.md` と 13 役割
- スクリプト: `scripts/` に `setup.mjs`(setup の CLI)、`pick-delegate.mjs`(委譲先の決定)、`session-start.mjs`、`subagent-start.mjs` の 4 本を出力する。元は `src/` の同名の `.ts`
- hook: SessionStart(規律の注入)、SubagentStart(サブエージェントの規律の注入)
- 環境変数 `AMATSUKA_AGENT_ENABLE_ORCHESTRATION`
- README、`docs/`、ルート README・marketplace・workspace への登録

### 2-2. 非スコープ

- 外部ベンダーのモデル、プロキシ、live models の照会、ベンダーの確定
- 1 つの役割に複数の定義を置くこと(特化定義)
- 起動形態の判定(モデル注入起動・合成)
- 廃止済み role-id の書き換え(廃止済みの ID がまだ無いため)
- setup の非対話モード(`--yes`)
- delegation gate(直接編集の差し止め)。オーケストレーターが自分で編集するので要らない
- `TYPESAFE_API_KEY` が無いときの代替経路
- worktree による並列作業の切り離し
- agent-policy の変更。agent-policy の `orchestration-discipline.md:129` にある「保護パス」も metatron 固有の語で、配布物では意味が定まらない。これは別件として扱う

### 2-3. 前提とする制約

- ARCHITECTURE により、指示層と参照層には他プラグインの名前を書かない。実装層は他プラグインの `src/` を import しない。agent-policy から流用するコード(断片の合成、マーカーの走査、MCP の検出)は、better-agentics の中に独立して実装し直す。Jev の呼び出しも jevriel を経由せず、`@typesafe-ai/sdk` を直接依存に持つ。
- ADR-005 により、Anthropic 以外の外部 API(TypeSafe AI)を必須依存にしてよい。
- TypeSafe AI は 2026-09-22 から新規サインアップを停止している。キーを持たない利用者は、委譲を使えない(§8-1)。
- Jev の主な対象は英語である。Jev に渡す文(When to invoke と作業内容)は英語で書く。

---

## 3. 全体像

### 3-1. 構成要素

```
plugins/better-agentics/
├── .claude-plugin/plugin.json
├── package.json                 better-agentics-scripts。依存: @typesafe-ai/sdk
├── build.ts
├── hooks/hooks.json             SessionStart / SubagentStart
├── skills/
│   ├── setup/SKILL.md
│   └── orchestration/SKILL.md
├── references/subagent-policy.md
├── assets/roles/{ja,en}/        _common.md + 13 役割
├── src/
│   ├── setup.ts                 setup の CLI
│   ├── pick-delegate.ts         委譲先の決定
│   ├── hooks/session-start.ts
│   ├── hooks/subagent-start.ts
│   └── lib/                     役割表・断片の合成・定義の走査・Jev クライアント・MCP 検出
├── scripts/                     バンドル出力
├── docs/rationale.md            不採用案と経緯
└── README.md
```

### 3-2. 委譲の流れ

1. SessionStart が、環境変数が有効でキーがあるときに orchestration スキルの使用指示を注入する。
2. オーケストレーターは作業を自分で進める。委譲の理由(§5)に当たったら、理由と作業内容(英語)を JSON で `pick-delegate` に渡す。
3. `pick-delegate` は `.claude/agents/` の role-id 付き定義を走査する。理由に対応する役割の定義を候補にし、各定義の When to invoke を選択肢の説明にして Jev に問う。
4. オーケストレーターは返った定義名で Agent を起動する。`review` で複数返ったときと、`split` で複数の作業があるときは、1 つのメッセージで全員をバックグラウンド起動する。
5. サブエージェントが起動すると、SubagentStart が `references/subagent-policy.md` の全文を注入する。
6. 戻った成果は、オーケストレーターが確かめてから取り込む。

---

## 4. 役割

### 4-1. 役割表

RoleId・種別・モデル・effort は agent-policy の担当表の Claude モデル列と同じ値にする。「理由」は §5 のどの理由で候補になるかを示す。

| RoleId | 役割名 | 種別 | model | effort | 理由 | 既定の定義名 |
| --- | --- | --- | --- | --- | --- | --- |
| `complex-impl` | 複雑または重要な実装 | impl | opus | medium | split | agent-policy の断片の `default-name` をそのまま使う |
| `normal-impl` | 通常の実装 | impl | sonnet | medium | split | 同上 |
| `light-impl` | 軽量な実装 | impl | haiku | medium | split | 同上 |
| `general` | その他のタスク | impl | sonnet | high | split | 同上 |
| `explore` | コードベース探索 | readonly | sonnet | high | split | 同上 |
| `realtime-research` | リアルタイム情報調査 | readonly | sonnet | high | split | 同上 |
| `e2e-verify` | E2E 動作検証・ブラウザ/GUI 操作 | impl | sonnet | high | split | 同上 |
| `escalation` | 行き詰まり時のエスカレーション | impl | fable | high | stuck | 同上 |
| `design-review` | 設計書・実装計画書のレビュー | readonly | opus | high | review | 同上 |
| `knowledge-elicitation` | 暗黙知の抽出・理解レビュー | readonly | haiku | low | review | 同上 |
| `code-review` | コードレビュー | readonly | sonnet | high | review | 同上 |
| `complex-review` | 重要な実装・高リスク設計書の最終レビュー | readonly | fable | high | review | 同上 |
| `adversarial-review` | 敵対的レビュー | readonly | opus | high | review | 同上 |

- 役割表は `src/lib/roles.ts` に 1 か所で持つ。setup・`pick-delegate`・hook はここを参照する。
- setup では、役割ごとのモデルを Claude の 4 モデル(`sonnet` / `opus` / `haiku` / `fable`)から選べる。表の model 列はその推奨である。
- effort は、選んだモデルが表の model 列と同じときは表の値を書き、質問しない。
- 違うモデルを選んだときは、effort を聞く。候補は `low` / `medium` / `high` / `xhigh` / `max` と「書かない(モデルの既定に任せる)」の 6 件で、表の effort 列の値を推奨にする。単一選択はページに分けられないため、2 問に分けて聞く。1 問目は「推奨の値」「その他の値」「書かない」の 3 択とし、「その他の値」が選ばれたときだけ、2 問目で残りの 4 値から選ばせる。agent-policy の `src/agents/policies.ts` の `EFFORT` 表のうち、Claude のモデルの値はこの表と同じである。
- 役割に許可するツールは、役割断片の frontmatter の `tools` とする。値は agent-policy の断片と同じにする。

### 4-2. 役割断片

- 置き場所は `assets/roles/<lang>/<RoleId>.md` と `_common.md`。agent-policy の断片を出発点にし、次の点を変える。
- `## When to invoke` は ja/en のどちらの断片でも英語で書く。`pick-delegate` が Jev に渡す基準になる。
- `_common.md` の「制約」は `references/subagent-policy.md` へ移す。定義本文の前置きには、名前と担う役割だけを残す。規律を更新したときに、定義を作り直さずプラグインの更新だけで全定義へ効かせるためである。
- `default-name` は agent-policy の断片の値をそのまま使う(例: `code-reviewer`)。agent-policy は既定名の前にモデル ID を付けるが、better-agentics は付けない。
- レビュー役割の Output Format では、指摘ごとに重大度を `critical` / `high` / `medium` / `low` のどれかで書かせる。§5-2 の再レビューの判定に使う。knowledge-elicitation では、「矛盾・不整合」と「記述の過不足」の項目だけに重大度を付け、「理解した内容」と「暗黙知」には付けない。
- `realtime-research.grok.md` のようなベンダー別の断片は持たない。
- 断片の読み込み元は agent-policy の `fragments.ts` の探索順に倣う。`ja` / `en` はプラグインの `assets/roles/<lang>/` から読む。それ以外の言語は、プロジェクトの `.claude/better-agentics/roles/<lang>/` にある翻訳断片から読む。翻訳断片は、英語の断片のハッシュ(`source-hash`)で古さを判定する。プラグインの更新では上書きしない。

---

## 5. オーケストレーターの規律(`better-agentics:orchestration`)

スキル本文には規律だけを書く。根拠と不採用案は `docs/rationale.md` に置く。

### 5-1. 既定は自分で行う

- 調査・分析・要件確定・設計書と計画書の執筆・実装・テスト・検証は、オーケストレーター自身が行う。
- 委譲するのは `review` / `split` / `stuck` のどれかに当たるときだけとする。
- 委譲先は自分で選ばず、`pick-delegate` が返した定義で起動する。
- `pick-delegate` が `ok: false` を返したら、理由を問わず委譲も作業の続行もせず、`error` の種別と内容をユーザーへ報告して指示を待つ。必須のレビュー(§5-2)の前なら、ユーザーへの提示とコミットにも進まない。
- Jev に渡す作業内容(`summary`)は英語で書く。

### 5-2. review

レビューは次の時点で必ず依頼する。

1. 設計書・実装計画書を書き終え、ユーザーへ示す前。
2. 実装を終え、コミットする前。
3. 次のどれかに変更を加えたとき。変更の大きさは問わない。
   - 全セッションに効く設定(hooks など)
   - プロジェクトの指示(CLAUDE.md・rules など)が、変更を禁じているか、確認や手順を求めているパス
   - データ移行

2 のコードレビューは、次の条件を両方満たすときだけ省ける。

- 変更した全箇所の正誤を、型検査・テスト・lint・grep のいずれかで判定できる。
- 3 に当たらない。

省いたときは、判定に使った検査とその結果を報告に書く。判定に使う検査を示せない変更は、検証困難として扱い、レビューを省かない。

進め方:

- レビュアーには、原本と満たすべき要件だけを渡す。自分の結論と、別のレビューの指摘は渡さない。
  - 文書のレビューでは、文書のパスを渡す。
  - コードのレビューでは、差分を取るコマンドを渡す(例: コミット前なら `git diff HEAD`、コミット済みの範囲なら `git diff <base>..<head>`)。値は実際の範囲に置き換える。
- `pick-delegate` が複数のレビュアーを返したら、全員を並列に起動する。
- 出力に `fallback: true` が付いていたら(Jev がどの候補も選ばなかった)、そのレビュアーで進め、ユーザーへの報告にその旨を添える。
- 再レビューは、前の巡と同じ定義を、`pick-delegate` を呼ばずに起動する。巡の数はこの組で数える。
- 指摘の採否はオーケストレーターが決める。指摘が対立して採否の軸を言葉にできないときは、`AskUserQuestion` でユーザーへ聞く。
- critical・high・medium の指摘を直したときは、再レビューを依頼する。low だけを直したときは再レビューしない。
- 再レビューを 2 巡しても critical・high・medium の指摘が残るなら、ユーザーへ判断を仰ぐ。

### 5-3. split

分担してよいのは、次のどちらかに当たる部分である。

- 並列化: 自分の作業と同時に進められ、状態を共有しない部分。
- 文脈の保護: 結論だけが要り、過程を手元に置く必要が無い部分。grep/read の反復が 3 ターン以上見込まれる探索と、多数のファイルへの機械的な一括変更が該当する。

分担の前提:

- 切り出す部分の仕様は、型・関数シグネチャ・ファイル配置・変更箇所の列挙の形で書いて渡す。委譲先が追加の判断なしに進められる形にできない部分は、切り出さずに自分で行う。
- 全体の設計判断、部品の結合、最終検証は、オーケストレーターが手元に残す。

手順:

1. 分担する作業を洗い出し、作業ごとに書き込むファイルの集合と、他の作業の成果を待つかを書き出す。
2. 次の条件を両方満たす作業同士を、同じ並列グループに入れる。
   - 書き込むファイルの集合が重ならない。オーケストレーター自身の分担とも比べる。
   - どちらも相手の成果を入力にしない。
3. グループ内の全作業を、1 回の `pick-delegate` 呼び出しに渡す。
4. 返った委譲先を、1 つのメッセージで全員バックグラウンド起動する。その間に自分の分担を進める。
5. 全員が戻ったら差分を突き合わせ、型検査・テスト・ビルドをオーケストレーターが 1 回実行する。
6. 依存がある作業は次のグループに回し、前のグループの成果を依頼文に載せる。

補足:

- 同じ役割が複数の作業に選ばれたら、同じ定義を複数起動する。
- 書き込むファイルの集合が重なる作業は、並列にせず順に委譲する。
- 並列化と文脈の保護のどちらで切り出した作業も、手順 1〜6 で同じように扱う。探索のように書き込みの無い作業は、書き込みの集合が空なので、他の作業と同じグループに入れられる。
- 並列中の委譲先に実行させてよい検査は、対象のファイルを指定して範囲を絞れるもの(対象を指定したテスト、対象を指定した lint など)に限る。依頼文には、使ってよい検査のコマンドを書く。
- プロジェクト全体が対象の検査(型検査・ビルド)と、ビルド出力・lockfile・lint の自動修正・git commit は、手順 5 でオーケストレーターだけが行う。
- 依頼文には「変更範囲の外が原因の失敗は直さず、出力をそのまま報告する」と書く。
- 文書の執筆を委譲するときは、agent-policy の「文書の執筆を委譲するとき」と同じ規律を当てる(完成文を渡さない、本文に載せる例には「本文に載せる」と添える、など)。スキルには規律の本文を書き写す。

### 5-4. stuck

次のどれかに当たったら、それ以上自分で追わずに `stuck` で委譲する。

- 同じ失敗が、異なる修正を 2 回試しても再現する。
- 原因の候補を 1 つに絞れない。
- 設計の前提が崩れ、再設計が要る。

依頼文には、試行の履歴(何を試し、何が返ったか)、失敗出力の原文、未解決の制約を載せる。

### 5-5. 依頼文

- 冒頭に、担わせる役割を書く。
- 目的、確定した事実(パス・行番号)、制約、受け入れ基準を書く。
- 「サブエージェントである」旨とサブエージェントの規律は SubagentStart が注入するので、依頼文には書かない。
- Output Format は定義本文にあるので、依頼文で指定し直さない。
- 委譲先にスキルを使わせるときは、依頼文でスキル名を名指しする。名指しが無いスキルを、サブエージェントはロードしない(§6)。ロードには Skill ツールを使う。
- スキルを名指しできるのは、`tools` に `Skill` を持つ役割(complex-impl・normal-impl・general・e2e-verify・escalation)の定義に限る。それ以外の役割には、要る節・手順・制約を依頼文へ書き写す。
- 名指しする前に、`wc -c` で本文と参照文書の合計を測る。30KB を超えるものは名指しせず、要る節・手順・制約だけを依頼文へ書き写す。

---

## 6. サブエージェントの規律(`references/subagent-policy.md`)

SubagentStart が全文を注入する。内容は次の 2 つを統合したもの。

- agent-policy の `orchestration-discipline.md` の「サブエージェントの規律」
- `_common.md` の「制約」(§4-2 で移したもの)

加える規律:

- 冒頭で、受け手がメインオーケストレーターから起動されたサブエージェントであることを述べる(`_common.md` の Preamble から移す)。
- 依頼文で指示された変更範囲の検査だけを実行する。ビルド出力・lockfile を書き換えるコマンド、lint の自動修正、git commit は、依頼文で指示されたときだけ実行する。
- 依頼文に書かれた書き込み範囲の外のファイルを変更しない。範囲外の変更が要るときは差し戻す。

SubagentStart の `additionalContext` は、10,000 文字を超えると本文の代わりにファイルパスと短いプレビューに置き換わる(Claude Code の hooks の仕様)。subagent-policy.md はこの上限に収める。

---

## 7. `pick-delegate` の契約

### 7-1. 呼び出し

標準入力で JSON を受け取り、標準出力に JSON を 1 行で返す。終了コードは常に 0 とし、成否は `ok` で表す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pick-delegate.mjs" --dir "$PWD" <<'EOF'
{"reason": "review", "task": {"summary": "Review the design doc for ...", "artifacts": ["harness-docs/design/x.md"]}}
EOF
```

入力の形(値は例示であり、実際の内容に置き換える):

| reason | 入力 |
| --- | --- |
| `review` | `{"reason": "review", "task": {"summary": string, "artifacts": string[]}}` |
| `split` | `{"reason": "split", "tasks": [{"id": string, "summary": string}]}`。`id` は配列内で一意 |
| `stuck` | `{"reason": "stuck", "task": {"summary": string}}` |

### 7-2. 候補の集め方

- 基準のディレクトリは、環境変数 `CLAUDE_PROJECT_DIR` があればそれを使い、無いときだけ `--dir` を使う。hook 2 本も同じ順で決める(`--dir` の代わりに入力の `cwd` を使う)。
- 基準のディレクトリの `.claude/agents/*.md` のうち、frontmatter に `better-agentics-role` を持つ定義を読む。`~/.claude/agents/` と他プラグインの定義は読まない。
- `better-agentics-role` の値が §4-1 の役割表に無い定義は候補にしない。
- 理由に対応する役割(§4-1 の「理由」列)の定義を候補にする。
- 理由に対応する役割のどれかを 2 件以上の定義が持つときは、`duplicate-role` で止まる。理由に対応しない役割の重複では止まらない(SessionStart が報告する)。
- 本文から `## When to invoke` 見出しの配下を抜き出し、Jev への基準にする。見出しが無い定義は基準を空文字にして候補に残す。

### 7-3. Jev への問い方

Jev は、1 回のリクエストで `state`(判断の材料)を 1 回読み、複数の質問を並列に評価する。質問の型のうち、ここでは次の 2 つを使う。呼び出しは `@typesafe-ai/sdk` の `TypeSafeClient.systemOne({ state, questions })` で行う(jevriel の `src/jev/client.ts` と同じ形)。

- `noul`: 命題が真である確率(0〜1)を返す。`p` はこの確率(`NoulResponse.noul`)である。
- `choice`: 選択肢から 1 つと、選択肢ごとの確率を返す。`p` は選んだ選択肢の確率(`ChoiceResponse.probabilities[choice]`)である。`confidence` は使わない。

| reason | 問い | 出力 |
| --- | --- | --- |
| `review` | 候補ごとに `noul` を 1 問ずつ、1 リクエストで問う。確率 0.5 以上を yes とする | `agents: [{agent, role, p}]`(yes の全員)。全員が no なら、確率が最も高い 1 人を返し、`fallback: true` を付ける |
| `split` | 作業ごとに `choice` を 1 問ずつ、1 リクエストで問う。選択肢は候補の定義名、説明は When to invoke | `assignments: [{id, agent, role, p}]`。`p` は選んだ選択肢の確率 |
| `stuck` | Jev を呼ばない | `agents: [{agent, role: "escalation"}]` |

- `state` には作業内容(`summary`・`artifacts`)だけを入れる。`split` では作業の配列を入れる。
- 候補の基準(When to invoke)は、質問の側にだけ置く。`review` では各 `noul` の `instructions` に、その候補の名前と基準を書く。`split` では `choice` の選択肢の説明に書く。
- `split` の各 `choice` の `instructions` には、対象の作業の `id` と `summary` を書く。
- 候補が 1 つだけの `review` と `split` も、Jev を呼ばずにその定義を返す。
- Jev 呼び出しの時間の上限は、リトライを含めた全体で 30 秒とする。SDK の `timeout` は試行ごとの値で全体の上限にならないため、`AbortSignal.timeout(30000)` を `signal` に渡す。`retry` は `maxRetries: 1`、`maxRetryAfterMs: 5000` とする。モデルは SDK の既定に任せる。
- 入力の大きさの上限は設けず、分割もしない。Jev が大きさを理由に拒んだときは `jev-failed` になる。基準と要約はどちらも数行で、作業の数も数件にとどまる見込みのため、jevriel のようなバッチ分割は持たない。

出力の例(値は例示であり、実際の内容に置き換える):

```json
{"ok": true, "reason": "review", "agents": [{"agent": "docs-reviewer", "role": "design-review", "p": 0.91}, {"agent": "knowledge-elicitor", "role": "knowledge-elicitation", "p": 0.73}]}
{"ok": true, "reason": "split", "assignments": [{"id": "a", "agent": "implementer", "role": "normal-impl", "p": 0.82}, {"id": "b", "agent": "explorer", "role": "explore", "p": 0.95}]}
{"ok": false, "error": "no-api-key", "message": "..."}
```

### 7-4. エラー

| `error` | 条件 |
| --- | --- |
| `invalid-input` | JSON として読めない、必須の項目が欠ける、`split` の `id` が重複する |
| `no-candidates` | 理由に対応する役割の定義が 1 つも無い。`message` で setup の実行を案内する |
| `duplicate-role` | 同じ役割を 2 件以上の定義が持つ。`message` に定義名を並べ、setup の実行を案内する |
| `no-api-key` | Jev を呼ぶ必要がある(`review` / `split` で候補が 2 つ以上)のに、`TYPESAFE_API_KEY` が無い |
| `jev-failed` | Jev の呼び出しが失敗した(タイムアウト・HTTP エラー・応答の形が想定外)。`message` に原因を書く |

キーが無いとき、SessionStart は orchestration スキルを注入しない。ただしユーザーがスキルを名指しで起動すれば、キーが無いまま `pick-delegate` が呼ばれうる。その場合は `no-api-key` で止まり、§5-1 に従ってユーザーの指示を待つ。orchestration スキルの description には、環境変数とキーの両方が揃っていることを使用条件として書く。


---

## 8. hook

### 8-1. SessionStart

`AMATSUKA_AGENT_ENABLE_ORCHESTRATION` は trim と小文字化の後で判定する。上から順に評価し、最初に当たった行で決める。

| 状態 | 注入する内容 |
| --- | --- |
| 未設定・空・`0`・`false`・`off` | 何も注入しない |
| `1`・`true`・`on` 以外の値 | 未知の値であるという警告だけ |
| `AMATSUKA_AGENT_AUTO_INJECTION` が空でも `none` でもない | 規律を注入せず、2 つの環境変数が同時に有効だという警告だけ |
| `AMATSUKA_AGENT_DELEGATION_GATE` が `1`・`true`・`on` | 規律を注入せず、直接編集を差し止める gate が有効で、オーケストレーターが自分で編集できないという警告だけ |
| `TYPESAFE_API_KEY` が無い | 規律を注入せず、キーが無いという警告だけ |
| 上記以外 | orchestration スキルの使用指示。加えて、該当するときだけ次を添える |

添える内容:

- role-id 付きの定義が 1 つも無い: setup の実行を案内する。
- 同じ役割を 2 件以上の定義が持つ: 定義名を並べ、setup の実行を案内する。
- 役割表に無い role-id を持つ定義: 定義名と role-id を並べる。

役割の対応表は注入しない。委譲先は `pick-delegate` が決めるため、オーケストレーターは表を使わない。

hook 2 本とも、例外は捕まえて標準エラーに 1 行の理由を書き、終了コード 0 で終わる(Claude Code の起動とサブエージェントの起動を妨げない)。定義ディレクトリの走査に失敗しても、SessionStart は規律の注入を続ける。

### 8-2. SubagentStart

- 入力の `agent_type` と同じ `name` を持つ定義を `.claude/agents/` から探す。
- その定義に `better-agentics-role` があり、§8-1 の表で「上記以外」(規律を注入する行)に当たる環境変数の状態のときだけ、`references/subagent-policy.md` の全文を `additionalContext` で注入する。キーの有無は問わない。
- 環境変数で絞るのは、agent-policy だけを使うセッションへの二重注入を避けるためである。agent-policy の委譲先候補はマーカーの有無を問わない(`orchestration-discipline.md:31`)。そのため better-agentics の定義も、agent-policy の解決順の 2 行目で委譲先に選ばれうる。そのとき agent-policy は自分のサブエージェント規律を依頼文へ書き写す。
- 当てはまらなければ何も出力しない。

---

## 9. setup(`better-agentics:setup`)

agent-policy の setup-agents の対話モードを出発点にし、§2-2 の非スコープを外す。

### 9-1. 書き込みの規律

- `.claude/agents/` のファイルは `Write` / `Edit` で直接編集せず、CLI で生成する。
- `Edit` を使ってよいのは、CLI が作った `.claude/better-agentics/roles/<lang>/` 配下の翻訳断片だけとする。
- `AskUserQuestion` の扱い(1 回ずつ呼ぶ、選択肢 2〜4 件、ページ分け、空の選択肢)は setup-agents の規律を引き継ぐ。

### 9-2. ステップ

1. 言語の判定。会話でユーザーが使っている言語から `lang` を決める。複数の言語が混ざるときは、直近のユーザー発話の言語を採る。
2. 既存定義の点検。`better-agentics-role` を持つ全定義について、次を順に扱う。
   - 役割に許可されていないツール: ツールごとに「削除する(推奨)」「残す」を聞き、`--prune-tools` で外す。
   - 同じ役割を 2 件以上の定義が持つ: どの定義を残すかを聞き、残さない定義のマーカーを `--rewrite-roles` で外す。
   - 役割表に無い role-id: 報告する。
3. 被覆の確認。役割ごとに既存定義の有無を示し、「未カバーの役割だけ作る(推奨)」「すべての役割を確認し直す」「中止する」を聞く。
4. 翻訳断片の準備。`lang` が `ja` / `en` 以外のとき、`--check-fragments` と `--scaffold-fragments` で断片を用意し、`Edit` で翻訳する。`## When to invoke` は翻訳しない(英語のまま残す)。
5. MCP サーバーの選択。`--list-mcp` で接続済みのサーバーを取り、付与するものを選ぶ。CLI は `claude mcp list` の出力を解析し、`✔ Connected` と `cached` のサーバーだけを使えるものとする(agent-policy の `src/agents/mcp.ts` と同じ判定)。
6. 新規生成。役割を 1 つずつ、モデル → effort(推奨と違うモデルを選んだときだけ。§4)→ 定義名 → MCP の順に聞いて生成する。作成先に同名のファイルがあり、そのファイルに `better-agentics-role` が無いときは、§9-3 の再生成と同じ手順で取り込む。frontmatter は §9-3 の規則で引き継ぐため、MCP サーバーのツール・`disallowedTools`・他プラグインのキー(`agent-policy-role` など)は残る。R が無いので、本文はファイルごとに先に 1 回、「本文をまとめてテンプレートに置き換える(推奨)」「セクションごとに選ぶ」を聞く。後者を選んだときだけ、各セクションを `unknown` として聞く。readonly の役割にサーバーを付けるときは、書き込み系ツールの denylist を確定させる。書き込み系ツールは、ファイル・リポジトリ・外部サービスの状態を変えるツールを指す。setup を実行している Agent が自分のツール一覧から列挙し、ユーザーに確認する(setup-agents のステップ 5n の 3 と同じ手順)。
7. 再生成。既存定義をセクションごとに比べ(§9-3)、利用者が編集したセクションを報告して、置き換えるかを聞く。
8. 報告。生成・再生成した定義、点検の結果、保持したセクション、`AMATSUKA_AGENT_ENABLE_ORCHESTRATION` と `TYPESAFE_API_KEY` の設定方法を示す。

### 9-3. セクションごとの編集の判定

- 生成時に、`description` と、前置きと各 `##` セクションの本文のハッシュを frontmatter の `better-agentics-hash` に記録する。値の書式(1 行に収める符号化)は実装計画で決める。
- 再生成時は、セクションごとに次の 3 つを比べる。R は記録したハッシュ、C は既存の内容のハッシュ、T は今回のテンプレートのハッシュである。上から順に評価し、最初に当たった分類にする。
  - `same`: C = T。質問しない。
  - `unknown`: R が無い。両方を preview に示して聞く。推奨は付けない。
  - `templateChanged`: C = R(利用者は編集していない)で、C ≠ T。「テンプレートに置き換える(推奨)」「保持する」を聞く。
  - `userEdited`: C ≠ R。テンプレートが変わったかは問わない。「保持する(推奨)」「テンプレートに置き換える」を聞く。When to invoke の調整がここに当たる。
- frontmatter は、セクションの比較とは別に扱う。
  - CLI が生成するキー(`name`・`description` を除く `model`・`effort`・`tools`・`better-agentics-role`・`better-agentics-hash`)は、今回の選択で書き直す。
  - MCP サーバーのツールと `disallowedTools` は、既存の定義から読み戻して引き継ぐ。setup で変更を選んだときだけ書き直す。
  - それ以外のキーは保持し、報告に載せる。

### 9-4. CLI のコマンド

setup-agents の CLI から、次のコマンドを引き継ぐ。`--scope`・`--vendor`・`--list-live-models`・`--recommended`・`--merge` の custom 向けの分岐は持たない。

| コマンド | 用途 |
| --- | --- |
| `--list-coverage --lang <lang>` | 役割ごとの被覆と、全定義の点検結果(許可外ツール・重複・未知の role-id) |
| `--check-fragments` / `--scaffold-fragments --lang <lang>` | 翻訳断片の状態確認と雛形作成 |
| `--list-mcp` | 接続済み MCP サーバー |
| `--check` / `--write --role <RoleId> --model <model> [--effort <effort|none>] --name <name> [--mcp-servers ...] [--mcp-deny ...] [--keep <section,...>] --lang <lang>` | 1 役割の差分確認と生成。`--effort` を省くと表の値を使い、`none` なら `effort` を書かない。`--keep` は保持するセクション |
| `--prune-tools --name <name> --tools <tool,...>` | 許可外ツールの除去 |
| `--rewrite-roles --name <name> --roles <RoleId|"">` | マーカーの書き換え(重複の解消) |

すべてのコマンドに `--dir "$PWD"` を渡す。応答は JSON で、`ok` が `false` なら `error` を報告して処理を止める。

---

## 10. 生成する定義の形

値は例示であり、実際の内容に置き換える。

```markdown
---
name: code-reviewer
description: 変更差分のレビュー
model: sonnet
effort: high
tools: Read, Grep, Glob, Bash
better-agentics-role: code-review
better-agentics-hash: <§9-3 の記録>
---

あなたは code-reviewer。担う役割はコードレビューである。

## When to invoke

- (英語の基準)

## Core Responsibilities
## 作業手順
## 制約
## Output Format
```

- `description` は短い 1 文にする。基準は書かない。
- 1 定義は 1 役割だけを持つ。

---

## 11. ワークスペースへの登録

- `.claude-plugin/marketplace.json` に追加し、`plugins/better-agentics/.claude-plugin/plugin.json` があることを確かめる。
- `pnpm-workspace.yaml` に追加し、`pnpm install` と `pnpm run build` を通す。
- `package.json` の名前は `better-agentics-scripts`、バージョンは `0.0.1-dev` とし、`plugin.json` と揃える。
- ルートの `README.md` に追加する。
- `@typesafe-ai/sdk` は jevriel と同じ `0.6.0` に固定する。
- orchestration スキルの frontmatter の `allowed-tools` に `Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/pick-delegate.mjs" *)` を入れ、委譲のたびの権限確認を避ける。
- README には、委譲のたびに作業の要約と成果物のパスが TypeSafe AI へ送られることを書く。成果物の中身は送らない。

---

## 12. テスト方針

テストは vitest で書き、配置は testing-policy に従う。

- `pick-delegate`: Jev クライアントを引数で差し替えられるようにし、偽の応答で次を確かめる。
  - `review` の yes 複数・全員 no のときの `fallback`
  - `split` の作業複数を 1 リクエストにまとめること、候補 1 つのときに Jev を呼ばないこと
  - `stuck` で Jev を呼ばないこと
  - §7-4 のエラー 5 種
- 定義の走査と When to invoke の抽出: `src/fixtures/` の定義ファイルで確かめる。
- hook 2 本: `src/testing/` のエントリから子プロセスとして起動し、§8-1 の表の各行と §8-2 の一致・不一致を確かめる。
- setup の CLI: 断片の合成、§9-3 の 4 分類、重複の検出と `--rewrite-roles`、`--prune-tools`、翻訳断片で When to invoke を対象から外すこと。
- 実機の確認(手動): 新しいセッションで SessionStart と SubagentStart が発火すること、`pick-delegate` が実際の Jev で日本語の会話中にも妥当な委譲先を返すこと。

---

## 13. 不採用案

- jevriel の MCP ツールをオーケストレーターに呼ばせる案。ARCHITECTURE の例外を足す必要があるうえ、ツールの引数に基準を組むため、オーケストレーターが基準を読むことになる。
- PreToolUse hook で Agent の `subagent_type` を書き換える案。選択が会話記録に残らずデバッグしにくい。`updatedInput` には `permissionDecision` を組み合わせる前提があり、権限確認への副作用もある。
- 定義の `description` に基準を書く案。Agent 一覧に載り、オーケストレーターが基準を持つ。
- 基準を専用ファイル(`.claude/better-agentics/routing.md`)に置く案。定義の追加・削除との同期が要る。
- 同梱の役割断片を role-id で引いて基準にする案。利用者が定義を編集しても基準が変わらない。
- キーが無いときに、理由ごとの既定先へ回す案と、オーケストレーターが自分で選ぶ案。判断の経路が 2 つになる。後者は基準を持たせない方針にも反する。
- サブエージェントの規律を、オーケストレーターが依頼文へ書き写す案。書き写し漏れが起きる。setup が定義本文に埋め込む案は、規律の更新に再生成が要る。
- マーカーのキーを agent-policy と共用する案。特化定義や外部ベンダーの定義も拾い、除外の規則が要る。2 つのプラグインの仕様が結びつく。
- escalation を `split` の候補に含める案。行き詰まりは分担とは別の場面で、試行の履歴を載せる規律も別に要る。
- worktree で切り離して並列にする案(対象は書き込みが重なる作業)。取り込みの手間が増える。プロジェクトごとのブランチ運用の決まりを、配布物の規律から判定できない。
- 非対話モード(`--yes`)。対話モードで推奨のまま全部作れば同じ結果になる。
- agent-policy の「暗黙知の抽出 → 設計書レビュー」の順序を守る案。better-agentics では、どのレビュアーに回すかを Jev が決め、返った全員を並列に起動する。順序を固定すると、レビュアーの組をオーケストレーターが知っている必要があり、基準を持たせない方針と合わない。
- 断片のプロジェクト独自の層(agent-policy の `.claude/agent-policy/roles/<RoleId>.md`)。基準と本文の調整は、生成した定義を直接編集し、§9-3 で保持する形で足りる。
- SubagentStart で環境変数を問わずに注入する案。agent-policy だけを使うセッションでも better-agentics の定義が委譲先に選ばれうるため、規律が二重になる。

---

## 14. リスク

- Jev の選択の質。基準の書き方しだいで、委譲先が偏る。`p` を出力に含め、When to invoke を定義の編集で調整できるようにしている。
- Jev の言語。When to invoke と `summary` を英語にしても、`artifacts` のパスや日本語の固有名詞が混ざる。実機の確認(§12)で妥当性を見る。
- キーの入手。新規サインアップの停止が続くと、委譲を使える利用者が増えない。
- 並列の衝突。書き込むファイルの集合の見積もりを誤ると、同じファイルを 2 者が書き換える。サブエージェントの規律で範囲外の変更を禁じ、最後にオーケストレーターが差分を突き合わせて検出する。
- agent-policy との二重注入。2 つの環境変数を同時に有効にした利用者には、SessionStart が警告だけを出し、規律は注入しない。SubagentStart も同じ条件で注入しない。
- delegation gate との衝突。gate が有効だとオーケストレーターの編集が差し止められる。SessionStart が警告を出し、規律は注入しない。
- 定義を名指しで起動したときの規律の欠落。環境変数が無効なセッションでは、better-agentics の定義を名指しで起動しても subagent-policy が届かない。

---

## 15. Done 条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `pnpm run build` を実行し、`plugins/better-agentics/scripts/` の差分が同じコミットにある。
- `plugin.json` と `package.json` のバージョンが `0.0.1-dev` で揃っている。
- marketplace・workspace・ルート README に反映されている。
- 新しいセッションで SessionStart と SubagentStart の発火を確かめている。
- 編集内容を適切に分けてコミットしている。

---

## 16. 未解決事項

- `better-agentics-hash` の値の書式(§9-3)。実装計画で決める。
- 役割断片のうち、agent-policy の内容から変える箇所。実装計画で断片ごとに列挙する。少なくとも次を含む。
  - When to invoke の英語化(13 役割)
  - `_common.md` の Preamble を名前と役割だけにし、制約を subagent-policy へ移すこと
  - レビュー役割の Output Format への重大度の追加(knowledge-elicitation は §4-2 の範囲に限る)
