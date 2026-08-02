# optimize-agents スキル eval 機構と agent-creator 設計書

- 作成日: 2026-08-02
- 対象プラグイン: `plugins/optimize-agents`(現行 `0.10.2-dev` → `0.11.0-dev`)
- 引き継ぎ書: `docs/handover/2026-08-02-skill-eval-into-optimize-agents.md`
- context-map: `.claude/context-maps/2026-08-02-skill-eval-into-optimize-agents.md`

## 1. 背景と目的

スキルの品質を測る機構が、リポジトリルートの手書き `.mjs` と task-utility 配下の専用チェッカーに散在している。これを optimize-agents プラグインの資産として集約し、手順化・スクリプト化する。

あわせて、プラグインのコンセプト(エージェントの最適化)に対して Agent 定義の作成・検証を担うスキルが無い状態を埋める。

### 引き継ぎ書の 4 項目に対する実態

| 項目 | 引き継ぎ書の記述 | 調査で判明した実態 |
| --- | --- | --- |
| 1. run-trigger-eval | 「実装済み、型付けと配置の変更が主」 | そのとおり。150 行、Node 標準のみ |
| 2. output eval チェッカー | 「要一般化」 | 一般化以前に**ランナーが存在しない**。`check-chat-output.mjs` に自動呼び出し元が 1 つも無く、サンドボックス構築・2 構成実行・反復はすべて手作業だった |
| 3. ベンチマーク集計 | 「未着手」 | `grading.json` 形式が確定済みなので、入力が揃えば独立に書ける |
| 4. ループ構造 | 「未着手」 | 1〜3 が揃わないと手順だけ書いても回らない |

作業量の中心は項目 2 である。項目 1 は移設作業にあたる。

## 2. 確定事項

| 事項 | 決定 | 決定者 |
| --- | --- | --- |
| スコープ | 引き継ぎ書の全 4 項目 | ユーザー |
| output eval のチェッカー | 測定対象スキル側に採点スクリプトを残す。optimize-agents は実行と集計だけを担う | ユーザー |
| 測定対象スキルの形態 | プラグイン同梱に限らない。`.claude/skills/` と `~/.claude/skills/` も測る | ユーザー |
| チェッカーの言語 | 新規は Python 既定。プロジェクト指定があればそれに従う。測定器は言語を知らない | ユーザー |
| 認証経路 | 環境変数は剥がさず、経路を結果に記録する | ユーザー |
| eval の測定対象 | **skill のみ**。Agents 定義は対象外 | ユーザー |
| Agents 定義のサポート | eval ではなく作成・検証スキル(`agent-creator`)で担う | ユーザー |
| `description-guide` | reference のまま。スキルに昇格しない | ユーザー |
| Agent 定義の検証 | スクリプトを付ける | ユーザー |
| `skill-eval` → `description-guide` | 参照する | ユーザー |
| `plugin-dev` の無効化 | 今回の作業に含めない(ユーザー環境の設定であってリポジトリの変更ではない) | ユーザー |

### eval を skill 専用に絞った理由

Agents を trigger eval の対象に含めると、現行の測定器が依存する 2 つの前提が崩れる。

| 前提 | Agents での崩れ方 |
| --- | --- |
| `Skill` ツール呼び出し = 発火 | ビルトイン agents が常に併存するため、`Agent` 呼び出しだけでは正解と言えない。`subagent_type` の判別が要るが、これは `content_block_start` に乗らず `input_json_delta` の累積が要る |
| 最初のツール呼び出しで打ち切れる | 委譲は状況を見てから決まることが多い。ファイルを読んでから `Agent` を呼ぶ経路では、第 1 手打ち切りが必ず「発火せず」を返す |

2 つ目は、引き継ぎ書が警告した「壊れた測定に合わせて本番を改悪する」の再演になりうる。skill で 8/8 出ている測定器が agent で 0/8 を返し、それを description の問題と誤診する筋が残る。

## 3. 成果物の構成

```
plugins/optimize-agents/
├── package.json                       ← 新設
├── build.ts                           ← 新設
├── src/
│   ├── run-trigger-eval.ts            ← ルートの .mjs を TS 移植
│   ├── run-output-eval.ts             ← 新規
│   ├── aggregate-benchmark.ts         ← 新規
│   ├── check-agent-definition.ts      ← 新規
│   └── __test__/*.test.ts
├── scripts/                           ← バンドル出力(git 管理)
├── skills/
│   ├── skill-eval/SKILL.md            ← 新規
│   ├── agent-creator/SKILL.md         ← 新規
│   ├── prompt-smith/SKILL.md          ← 参照先の微修正
│   ├── setup-gpt/                     ← 変更なし
│   ├── with-codex-policy/             ← 変更なし
│   └── claude-model-policy/           ← 変更なし
├── references/
│   ├── description-guide.md           ← Agents 節を追加
│   ├── agent-definition-spec.md       ← 新規(公式仕様の要約)
│   ├── context-map-guide.md           ← 変更なし
│   └── orchestration-discipline.md    ← 変更なし
└── docs/
    ├── description-out-of-scope.md    ← パス参照の更新
    └── agent-creator-rationale.md     ← 新規(公式仕様との差分の根拠)
```

### 3.0 執筆の規律

新規・改稿するスキル本文(`skills/*/SKILL.md`)と references(`references/*.md`)は、`prompt-smith` の基準で書く。frontmatter の description には `prompt-smith` を当てず、`description-guide` に従う。

具体的には次を守る。

- 指示を正当化する根拠・出典・経緯は本文に書かない。`docs/` へ退避する
- 命令形ではなく望ましい動きの言い切りで書く
- 1 文に 1 指示だけを書く
- 禁止を書くときは代わりに取る動きを併記する
- 例は 1 つで伝わるなら 2 つ目以降を削る
- 素案を書き切ってから別のパスで基準を当てて削る

本設計書が §7.2・§8.2 等で挙げている根拠・実測値・公式仕様は、スキル本文ではなく `references/` と `docs/` に置く。スキル本文には規律だけを書く。

### 3.1 スキルの担当境界

| スキル | 担当 | 担当しない | 内部で参照 |
| --- | --- | --- | --- |
| `prompt-smith` | AI 向け指示書の**本文** | description、測定 | — |
| `skill-eval` | **skill の** description の改稿と、発火精度・出力契約の測定 | Agents の測定、本文の書き方 | `description-guide` |
| `agent-creator` | **Agent 定義**の作成・検証 | skill の作成、eval 測定 | `prompt-smith`、`description-guide`、`agent-definition-spec` |

`agent-creator` は書き方の基準を自前で持たない。本文は `prompt-smith`、description は `description-guide` に委ねる。固有に持つのは frontmatter の仕様知識と検証手順である。

`setup-gpt` との境界: `setup-gpt` は 3 本の固定テンプレートを配るウィザード、`agent-creator` は任意の Agent 定義を作る汎用スキル。責務は重ならない。

#### prompt-smith と agent-creator が両方当たる場面

`prompt-smith` の対象には Agents 定義の本文が含まれる。`agent-creator` も Agent 定義を扱う。境界を依頼の種類で分ける。

| 依頼 | 担当 |
| --- | --- |
| Agent 定義を新しく作る | `agent-creator` |
| Agent 定義の frontmatter を直す・検証する | `agent-creator` |
| Agent 定義の本文だけを評価・改稿する | `prompt-smith` |
| CLAUDE.md・SKILL.md の本文を評価・改稿する | `prompt-smith` |

`agent-creator` は本文を書く段(§8.4 の 5)で `prompt-smith` を参照する。両者が同時に発火した場合は `agent-creator` を優先する。作成の文脈では frontmatter と本文の両方が要るためである。

この境界を両スキルの description に書く。`prompt-smith` の description には「Agent 定義を新しく作るときは `agent-creator` を使う」を足す。

### 3.2 スクリプトの責務

| スクリプト | 入力 | 出力 | 担当しない |
| --- | --- | --- | --- |
| `run-trigger-eval` | SKILL.md + `[{query, should_trigger}]` | 合否 JSON | 出力の中身の評価 |
| `run-output-eval` | `output-evals.json` + スキル一式 | 構成別ディレクトリに `grading.json` / `timing.json` を配置 | **採点そのもの** |
| チェッカー(測定対象スキル側が保持) | `<outDir> <evalId>` | stdout に `grading.json` | 実行・集計 |
| `aggregate-benchmark` | `grading.json` 群 | `benchmark.json` / `benchmark.md` | 実行・採点 |
| `check-agent-definition` | Agent 定義 `.md` のパス | 検査結果 JSON | 定義の修正 |

## 4. run-trigger-eval(項目 1)

既存 `scripts/run-trigger-eval.mjs` の TypeScript 移植。**ロジックは変更しない**。実測値の基準がこの挙動に紐づいているため。

### 保持する挙動

- 一時ディレクトリに `.claude/skills/<name>/SKILL.md` を作って登録する(`.claude/commands/` ではない)
- `claude -p <query> --output-format stream-json --verbose --include-partial-messages --model <model>` を cwd = 一時ディレクトリで起動し、`CLAUDECODE` 環境変数を削除する
- 最初の `content_block_start` が `tool_use` の時点で判定し `SIGKILL`
- `Skill` ツールなら発火とみなす
- `should_trigger: true` は発火率 >= 0.5、`false` は発火率 === 0 で合格
- 既定値: `--runs 2 --workers 4 --model claude-opus-5 --timeout 240`

### 変更する点

- TypeScript 化と型付け
- 独自 `pool()` の切り出し(テスト可能にする)
- stream-json のパース部分を純関数として分離(実プロセスを起動せず単体テストする)

### パース部分の切り出し方

判定ロジックの心臓部なので、切り出しの契約を固定する。

```
detectFirstToolUse(line: string): "skill" | "other" | null
```

- 1 行を受け取り、`content_block_start` かつ `content_block.type === "tool_use"` なら、ツール名が `Skill` かどうかで `"skill"` / `"other"` を返す
- それ以外の行(`content_block_delta`、`message_start` 等)は `null` を返す
- 呼び出し側は **最初に `null` 以外を返した時点**で判定を確定し、以降の行を読まない

「最初のツール呼び出しだけを見る」という状態は呼び出し側が持ち、パーサは行単位のステートレス関数にする。これによりパーサ単体を固定 JSON 行列でテストできる。

移植時は、旧実装が実際に扱っていた JSON 行のサンプルを保存し、テストの入力に使う。旧実装と新実装が同じ行に対して同じ判定を返すことを、回帰測定の前に単体テストで確かめる。

### 4.1 認証経路の記録

`claude -p` は親プロセスの環境変数を継承する。起動に使ったエイリアスによって認証経路が変わる。

2026-08-02 に実測した事実。

| 対象 | `ANTHROPIC_*` |
| --- | --- |
| `claude-proxy` を打ったシェル | なし |
| `claude` プロセス | `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` |
| Bash ツールが起動する子シェル | 上記を継承 |

親シェルに無く claude プロセスに有るため、これらはエイリアスが起動時に注入したものである。`.bashrc` 由来ではない。

`ANTHROPIC_BASE_URL` を到達不能なポートへ向けると `claude -p` がタイムアウトする。設定は無視されておらず、通信経路として機能している。

**環境変数は剥がさない。継承したまま測り、どの経路で測ったかを記録する。**

`run-trigger-eval` は結果 JSON に `environment` を足す。

```json
{
  "skill": "...",
  "environment": {
    "base_url": "http://127.0.0.1:8317",
    "auth_source": "ANTHROPIC_AUTH_TOKEN",
    "model": "claude-opus-5"
  },
  "results": [],
  "summary": {}
}
```

| キー | 内容 |
| --- | --- |
| `base_url` | `ANTHROPIC_BASE_URL` の値。未設定なら `"(default)"` |
| `auth_source` | 設定されている認証系変数の**名前**。値は記録しない。`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `(claude.ai login)` のいずれか |
| `model` | `--model` に渡した値 |

`run-output-eval` は同じ内容を `timing.json` に含める。`aggregate-benchmark` は構成間で `environment` が食い違う場合に警告を出す。異なる経路で測った結果を比較しても意味がないためである。

**トークンやキーの値は記録しない。** 変数名と URL だけを残す。

過去の実測値(§12.1)は `base_url=http://127.0.0.1:8317` / `auth_source=ANTHROPIC_AUTH_TOKEN` で取得された。回帰確認は同じ経路で行う。

### 移行後の後始末

| 対象 | 変更 |
| --- | --- |
| `scripts/run-trigger-eval.mjs` | 削除 |
| `CLAUDE.md:15` | 参照先を新パスへ |
| `CLAUDE.example.md:15` | 同上 |
| `plugins/task-utility/evals/README.md:7,18` | コマンド例を新パスへ |
| `plugins/optimize-agents/docs/description-out-of-scope.md:32` | 同上 |
| 抗体 `ab-2026-0802-001` | 本文全体を見て旧パスの記述をすべて新パスへ。下記参照 |

抗体の本文には旧パスが 2 箇所ある(説明文中の 1 箇所とコマンド例の 1 箇所)。加えて末尾に `plugins/optimize-agents/docs/description-out-of-scope.md` への参照がある。この文書自体は移動しないが、その中の記述が変わるため、抗体の記述と食い違わないか確認する。

更新には `plugins/raphael/scripts/update-antibody.mjs patch <id>` を使う。手で `.raphael/antibodies/*.md` を編集しない。

`trigger.pattern`(`run_eval.py` 等にマッチする正規表現)は変更しない。抗体が防いでいるのは skill-creator の Python スクリプトの使用であり、それは今回変わらない。

## 5. run-output-eval(項目 2)

### 5.0 測定対象スキルの 3 形態

`skill-eval` はプラグイン同梱スキルに限らない。次のすべてを測る。

| 形態 | 例 | 同梱物 |
| --- | --- | --- |
| プラグイン同梱 | `plugins/task-utility/skills/chat/` | scripts / references / assets |
| プロジェクトのスキル | `.claude/skills/<name>/` | ある場合とない場合 |
| ユーザーのスキル | `~/.claude/skills/<name>/` | 同上 |

`run-trigger-eval` は SKILL.md 1 ファイルを受け取る設計なので、3 形態すべてでそのまま動く。追加の対応は要らない。

`run-output-eval` は同梱物をサンドボックスへ持ち込むため、対象の実体がどこにあるかを知る必要がある。これを `skill_root` として表す。**プラグインである必要はない。**

### 5.1 欠落していた処理

前セッションで手作業だったのは次である。これをスクリプト化する。

1. 一時ディレクトリにサンドボックスを作る
2. `skill_root` 配下の一式を配置する
3. fixtures(eval が前提とする既存ファイル)を配置する
4. `with_skill` / `without_skill` の 2 構成で `claude -p` を実行する
5. 各実行の出力ディレクトリに対してチェッカーを起動する
6. `grading.json` と `timing.json` を所定のディレクトリ構造に配置する

### 5.2 構成の作り分け

| 構成 | サンドボックスの内容 |
| --- | --- |
| `with_skill` | `skill_root` 配下の一式(SKILL.md・scripts・references・assets)を配置 |
| `without_skill` | SKILL.md を配置しない。同梱物も配置しない |

`without_skill` はスキルが無い素の Claude Code の挙動を測る。assertion に識別力があるかを判定するための対照である。

### 5.3 出力のディレクトリ構造

`aggregate_benchmark.py` が読む形式に合わせる。

```
<runDir>/
└── eval-<id>/
    ├── with_skill/
    │   └── run-1/
    │       ├── grading.json
    │       ├── timing.json
    │       └── output/          ← スキルが作ったファイル
    └── without_skill/
        └── run-1/
            ├── grading.json
            ├── timing.json
            └── output/
```

- `<id>` は `output-evals.json` の `evals[].id` をそのまま使う
- `run-<n>` の `<n>` は **1 始まりの連番**。タイムスタンプや UUID は使わない
- **構成名はディレクトリ名で識別する**。`with_skill` / `without_skill` の 2 つに固定する。メタデータファイルは置かない
- `timing.json` は `{total_duration_seconds, total_tokens}` を持つ

`aggregate-benchmark` は `<runDir>` を受け取り、`eval-*/` → 直下のディレクトリ名を構成名 → `run-*/` の順に走査する。この 3 階層が §6 との唯一のデータ契約である。

### 5.4 チェッカーの契約

optimize-agents は採点しない。測定対象スキル側が持つチェッカーを起動し、その stdout を `grading.json` として保存する。チェッカーの置き場はプラグインとは限らず、`output-evals.json` の隣(§5.7)である。

```
<checker-cmd> <outDir> <evalId>  →  stdout に grading.json 形式の JSON
```

| 項目 | 決定 |
| --- | --- |
| `checker` の値 | **実行コマンド文字列**。インタプリタを含めて書く |
| パスの基準 | `output-evals.json` **からの相対**。リポジトリルートやプラグインルートを基準にしない |
| cwd | **`output-evals.json` があるディレクトリ**。チェッカーが隣接ファイルを相対パスで参照できる |
| `<outDir>` | 絶対パスで渡す。サンドボックス内の `output/` を指す |
| 終了コード | 非 0 はチェッカーの実行失敗とみなし、その run を失敗として記録する。採点結果の合否とは区別する |
| stdout が JSON として解釈できない | チェッカーの実行失敗として扱う |

基準を `output-evals.json` の位置に置くことで、プラグイン配下でも単独スキルの `evals/` でも同じ書き方になる。リポジトリの有無に依存しない。

### 5.4.1 チェッカーの言語

**測定器はチェッカーの言語を知らない。** `checker` に書かれたコマンドを起動し、stdout を読むだけである。

```json
"checker": "python3 ./check_chat_output.py"
"checker": "node ./check-chat-output.mjs"
"checker": "./check-output.sh"
"checker": "uv run ./check_output.py"
```

契約は標準入出力で閉じているため、言語検出の実装は不要である。

| 事項 | 決定 |
| --- | --- |
| チェッカーを新規に書くときの既定言語 | **Python** |
| プロジェクトが言語を指定している場合 | その指定に従う |
| 既存チェッカーの言語 | 変更しない |

この規律は `skill-eval` スキルの本文に書く。スクリプト側の判定は行わない。

既定を Python とするのは、スキル開発の一般的な環境で最も手に入りやすいためである。このリポジトリは CLAUDE.md でスクリプトを TypeScript と定めているので、ここで新規にチェッカーを書く場合は TypeScript になる。

**測定器自身(`run-trigger-eval` 等)はこの規律の対象外である。** optimize-agents が配るスクリプトは TypeScript でバンドルし、利用者が Node だけで動かせる状態を保つ(§10)。

`grading.json` の形式は既存のものをそのまま使う。

```json
{
  "eval_id": 0,
  "expectations": [{"text": "...", "passed": true, "evidence": "..."}],
  "summary": {"total": 9, "passed": 9, "failed": 0}
}
```

この契約により、既存の `check-chat-output.mjs` は無改造で接続できる。

### 5.5 output-evals.json への追加

後方互換で 2 つのキーを足す。既存ファイルは `checker` を補うだけで動く。

| キー | 位置 | 内容 |
| --- | --- | --- |
| `checker` | トップレベル | 採点コマンド文字列(インタプリタを含む)。パスは `output-evals.json` からの相対。省略時は output eval を行わない |
| `skill_root` | トップレベル | サンドボックスへ配置する測定対象のディレクトリ。`output-evals.json` からの相対パス |
| `fixtures` | `evals[]` | eval が前提とする既存ファイル。下表の 2 形式 |

`skill_root` は**プラグインディレクトリとは限らない**。測定対象スキルの実体があるディレクトリを指す。

```json
{
  "skill_name": "chat",
  "skill_root": "../..",
  "checker": "node ./check-chat-output.mjs",
  "evals": []
}
```

| 形態 | `skill_root` の例(`evals/output-evals.json` からの相対) |
| --- | --- |
| プラグイン同梱 | `"../.."`(プラグインルート。scripts や references を含む) |
| 単独スキル(同梱物あり) | `".."`(スキルディレクトリ) |
| 単独スキル(SKILL.md のみ) | `".."` |

`skill_root` 配下のうち、サンドボックスへ配置するのは SKILL.md とその同梱物である。`evals/` 自身と `.git` は配置しない。測定対象に eval セットが混入すると、スキルがそれを読んで挙動が変わりうる。

`fixtures` は eval-1(既存ファイルへの追記)のように、開始状態にファイルが要るケースのために設ける。前セッションでは手で置いていた。

| 形式 | 使う場面 |
| --- | --- |
| `{path, content}` | 内容が数行で、eval の意図が読んで分かるもの。`output-evals.json` 内で完結する |
| `{path, from}` | 内容が長い、またはバイナリ。`from` は `output-evals.json` からの相対パスで別ファイルを指す |

`fixtures` は `with_skill` / `without_skill` の両構成に同一内容で配置する。開始状態が構成で違うと差が測れない。

### 5.6 `${CLAUDE_PLUGIN_ROOT}` の解決

**2026-08-02 調査済み。chat の output eval では問題にならない。**

`plugins/task-utility/skills/chat/` は `SKILL.md` 1 ファイルのみで、同梱物を持たない。`${CLAUDE_PLUGIN_ROOT}` の参照も無い。よって chat の測定は SKILL.md を配置するだけで足りる。

設計書の初版は「chat スキルは `prepare-chat-recording.mjs` 等を `${CLAUDE_PLUGIN_ROOT}` 経由で参照する」と記していたが、これは誤りだった。同梱スクリプトを呼ぶのは hook(`check-chat-recorded.mjs`)と `chat-recorder` エージェントであり、SKILL.md ではない。

ただし他スキルは実際に使っている。機構としては対応が要る。

| プラグイン | 参照するスキル |
| --- | --- |
| `basic-design` | system-architecture / er-diagram / sequence-diagram / screen-flow / api-list / nfr-checklist |
| `task-utility` | issue-triage / issue-split / chat-recall / resume |
| `guidepost` | guidepost |

これらを測る段になったら、次の順で確認する。chat の測定では通らない経路なので、実装は後回しでよい。

| 段階 | 試すこと | 判定 |
| --- | --- | --- |
| 1 | `.claude/skills/<name>/` に置き、同梱スクリプトを呼ぶ eval を 1 本流す | スクリプトが起動すれば解決している |
| 2 | 1 が不可なら、`.claude/plugins/<name>/` 相当の配置を試す | 同上 |
| 3 | 2 も不可なら、サンドボックス配置時に SKILL.md 内の `${CLAUDE_PLUGIN_ROOT}` を実パスへ置換する | 起動すれば可 |

3 に倒す場合、置換を行った旨を実行ログに出し、`timing.json` の隣に `sandbox-note.txt` として残す。測定対象が原文と異なることを隠さない。

`lib/sandbox.ts` は段階 3 の置換に対応できる構造にしておく。実装は `${CLAUDE_PLUGIN_ROOT}` を含むスキルを測る時点まで保留してよい。

### 5.7 eval セットの置き場

**測定対象スキルの隣に置く。** スキルと一緒に移動し、同じ版管理に乗る。

```
<スキルの実体>/
└── evals/
    ├── trigger/<skill>.json
    ├── short/<skill>.json
    ├── fp/<skill>.json
    ├── output-evals.json      ← output eval を持つ場合のみ
    └── check_*.py             ← 同上。言語は §5.4.1 に従う
```

| 形態 | 置き場 |
| --- | --- |
| プラグイン同梱 | `plugins/<plugin>/evals/`(複数スキルを 1 つの `evals/` にまとめてよい) |
| プロジェクトのスキル | `.claude/skills/<name>/evals/` |
| ユーザーのスキル | `~/.claude/skills/<name>/evals/` |

プラグインの場合、1 プラグインが複数スキルを持つため `trigger/<skill>.json` のようにスキル名でファイルを分ける。既存の `plugins/task-utility/evals/` がこの形である。

単独スキルは 1 スキルなので `trigger/<name>.json` の 1 本になる。ディレクトリ構造は揃える。

`run-trigger-eval` は `--eval-set` でパスを直接受け取るため、この規律に従わない配置でも動く。規律は探しやすさのためのものである。

## 6. aggregate-benchmark(項目 3)

`grading.json` 群を読み、構成ごとに集計する。

### 集計する指標

| 指標 | 出す統計 |
| --- | --- |
| `pass_rate` | mean / stddev / min / max |
| `time_seconds` | 同上 |
| `tokens` | 同上 |

加えて先頭 2 構成(`with_skill` / `without_skill`)の差分を `delta` として出す。

### 出力

| ファイル | 内容 |
| --- | --- |
| `benchmark.json` | metadata・全 run 明細・集計・notes |
| `benchmark.md` | 平均 ± 標準偏差と差分の Markdown 表 |

### ライセンス

`aggregate_benchmark.py` は Apache License 2.0 の skill-creator に含まれる。**コードは流用せず**、読む入力形式(`grading.json`)と出す指標の定義のみを参考にした独立実装とする。`run-trigger-eval` と同じ扱いである。

コードを参照して移植する方針に変える場合は、著作権表示と変更点の記載を追加する。

## 7. skill-eval スキル(項目 4)

### 7.1 手順

```
1. 現状を測る    → run-trigger-eval を 3 セット同時に回す
2. 結果を読む    → 3 種の内訳を見る。片側だけで判断しない
3. 直す          → description-guide の基準で改稿する
4. 測り直す      → 1 に戻る。3 種すべてを測る
5. 出力を測る    → run-output-eval を 2 構成で回す
6. 集計する      → aggregate-benchmark で差を見る
```

### 7.2 スキル本文に書く規律

引き継ぎ書が「前提知識(これを知らないと同じ失敗をする)」として挙げた点を、規律として本文に置く。**左列だけを本文に書く**。右列は本設計書の読み手向けであり、`docs/` に退避する。

| 本文に書く規律 | 退避する根拠 |
| --- | --- |
| スコアが動かないときは、実績のある description で対照実験してから本番を直す | 前セッションで 3 イテレーション分の測定を無駄にした |
| 3 種(substantive / short / fp)を同時に測る | 除外を足すと fp は改善するが substantive/short が落ちる。逆も同様 |
| output eval は with_skill / without_skill の 2 構成で測り、差を見る | with_skill だけでは assertion が緩いのかスキルが効いているのか区別できない |
| 測定は一時ディレクトリを cwd にする | `.claude/` を上へ探す挙動があり、リポジトリの設定を拾う |
| 過去の測定と比べるときは `environment` の一致を確かめる | `claude -p` は起動エイリアス由来の環境変数を継承する。経路が違うと差の原因を切り分けられない |
| チェッカーを新規に書くときは Python を使う。プロジェクトが言語を指定していればそれに従う | スキル開発の一般的な環境で最も手に入りやすい |

`run_eval.py` / `run_loop.py` を使わない理由は本文に書かない。抗体 `ab-2026-0802-001` が PreToolUse で注入するため重複する。

### 7.3 description の方針

`description-guide` の基準で書く。近接スキルとの境界を明記する。

- 発火する: 「スキルの発火精度を測って」「description を直したので測り直したい」「eval を回して」「この SKILL.md の description を直して」
- 発火しない: `prompt-smith`(本文の改稿)、`agent-creator`(Agent 定義)

### 7.4 description の改稿も担当する

`skill-eval` は測定だけでなく、**skill の description を書く・直す**ことも担当する。

この担当を持たせる理由は、CLAUDE.md から description の基準への参照を外すためである。reference は自律発火しないので、誰かが読ませなければ効かない。担当スキルが無いと、CLAUDE.md に参照を常駐させ続けることになる。

| 依頼 | 担当 |
| --- | --- |
| skill の description を書く・直す | `skill-eval` |
| skill の発火精度を測る | `skill-eval` |
| Agent 定義の description を書く | `agent-creator` |
| 指示書の本文を書く・直す | `prompt-smith` |

改稿と測定は一体の作業である。直したら測る、という手順が `skill-eval` の本文にある(§7.1)。

これに伴い `CLAUDE.md` から次の 2 行を削除する。

- description の基準を示す行(14 行目) → `skill-eval` が担当を持つ
- 測定ツールのパスを示す行(15 行目) → 同上

本文の基準を示す行(16 行目)は `optimize-agents:prompt-smith` をスキル名で参照しており、残す。

## 8. agent-creator スキル

### 8.1 責務

Agent 定義(`.claude/agents/*.md` および `plugins/*/agents/*.md`)の作成と検証。

### 8.2 公式仕様の要約(references/agent-definition-spec.md)

調査(2026-08-02, code.claude.com)で確認した仕様を reference に置く。スキル本文には置かない。仕様は変わりうるため、参照断片として分離する。

#### frontmatter の全フィールド

必須: `name` / `description`

任意: `tools` / `disallowedTools` / `model` / `permissionMode` / `maxTurns` / `skills` / `mcpServers` / `hooks` / `memory` / `background` / `effort` / `isolation` / `color` / `initialPrompt`

このリポジトリの既存 Agent 定義は 4 つ(`name` / `description` / `model` / `color` / `tools`)しか使っていない。

#### 配置による制約の違い

| 配置 | 使えないフィールド |
| --- | --- |
| `.claude/agents/` / `~/.claude/agents/` | なし |
| プラグインの `agents/` | `hooks` / `mcpServers` / `permissionMode`(公式がセキュリティ上の理由で明記)。`isolation` は `worktree` のみ |

#### 優先順位

managed settings > `--agents` CLI > `.claude/agents/` > `~/.claude/agents/` > プラグインの `agents/`

プロジェクト agents は cwd から上へ walk する。v2.1.178 以降、同名時は cwd に最も近い定義が勝つ。

#### model の解決順

`CLAUDE_CODE_SUBAGENT_MODEL` 環境変数 → 実行時 `model` → 定義の `model` → メイン会話。未指定時の既定は `inherit`。

### 8.3 公式が定めていない領域の扱い

公式ドキュメントに記述が無い項目は、推奨として書かない。あるいは出典を明記して書く。

| 項目 | 公式 | 本スキルの扱い |
| --- | --- | --- |
| description の書き方 | "When Claude should delegate to this subagent"。発火強化に "use proactively" を推奨 | `description-guide` を参照させる。方向は一致する |
| `<example>` ブロック | **記述なし**(plugin-dev 独自の様式) | 推奨しない |
| 本文の構成 | 記述なし。実例は 手順 → チェックリスト → 出力仕様 | `prompt-smith` を参照させる |
| 本文の長さ | 記述なし | 触れない |
| 単一責任 | "each subagent should excel at one specific task" | 規律として書く |
| ツール権限 | "grant only necessary permissions" | 規律として書く |

`<example>` を推奨しない判断の根拠は `docs/agent-creator-rationale.md` に残す。plugin-dev を参考にした利用者が差分に気づけるようにする。

### 8.4 手順

```
1. 用途を聞く        → 何をする agent か、単一責任に収まるか
2. 配置を決める      → project / user / plugin。制約が変わる
3. frontmatter を書く → agent-definition-spec の仕様に従う
4. description を書く → description-guide の基準に従う
5. 本文を書く        → prompt-smith の基準に従う
6. 検証する          → check-agent-definition を回す
```

### 8.5 description の方針

- 発火する: 「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」
- 発火しない: `setup-gpt`(GPT 3 本の定型セットアップ)、`skill-eval`(測定)、`prompt-smith`(本文一般)

### 8.6 「作った Agent の発火を測りたい」への応答

`skill-eval` は skill のみを測る(§2)。Agent 定義の発火を測る手段はこの設計には無い。

`agent-creator` は、この依頼を受けたとき次を行う。

1. 発火精度の自動測定は提供していないことを伝える
2. `check-agent-definition` による静的検査を行う
3. 実際に依頼文を投げて `Agent` が呼ばれるかを手で確かめる方法を案内する

「対応できない」で終わらせず、代わりに取れる手段を示す。この分担を `agent-creator` の本文に規律として書く。

測定手段を将来足す場合の技術的障壁は §2 に記載した。

## 9. check-agent-definition スクリプト

### 9.1 入力と出力

```
node scripts/check-agent-definition.mjs <agent-definition.md> [--scope project|user|plugin]
```

`--scope` 省略時はパスから推定する。`plugins/*/agents/` 配下ならプラグイン、それ以外は project とみなす。

```json
{
  "path": ".claude/agents/gpt-sol.md",
  "scope": "project",
  "errors": [],
  "warnings": ["color が未指定"]
}
```

終了コードは errors が空なら 0、そうでなければ 1。

### 9.2 検査項目

| 分類 | 項目 | 判定 |
| --- | --- | --- |
| 構文 | frontmatter の開始・終了が揃う | error |
| 必須 | `name` / `description` がある | error |
| `name` | 小文字英字とハイフンのみ(公式: "Unique identifier using lowercase letters and hyphens") | error |
| `name` | ファイル名と一致する | warning |
| `model` | `sonnet`/`opus`/`haiku`/`fable`/`inherit`/完全 ID のいずれか | error |
| `tools` | 既知のツール名である | warning(将来のツール追加を誤検出しないため) |
| 配置 | プラグイン配下で `hooks`/`mcpServers`/`permissionMode` を使っていない | error |
| 配置 | プラグイン配下で `isolation` が `worktree` 以外でない | error |
| 本文 | 本文が空でない | error |
| 任意 | `color` がある | warning |

`tools` を warning に留めるのは、ツール名の一覧が Claude Code の版で増減するためである。未知の名前を error にすると、新しいツールを使う正しい定義が落ちる。

### 9.3 検査しないもの

- description の質(発火するかどうか)。測定手段が無いため機械判定しない
- 本文の質。`prompt-smith` の評価モードが担当する

### 9.4 仕様の鮮度

検査項目は 2026-08-02 時点の公式ドキュメントに基づく。Claude Code の仕様は変わる。

- `references/agent-definition-spec.md` の冒頭に調査日と出典 URL を記す
- 未知の frontmatter キーは **error ではなく warning** とする。仕様追加を誤検出しないため
- 未知の `tools` 名も warning とする(§9.2 と同じ理由)

error にするのは、公式が明示的に禁止している組み合わせ(プラグイン配下の `hooks` 等)と、必須項目の欠落・構文エラーに限る。

## 10. ビルド基盤

`plugins/optimize-agents` は現在 `src/` も `package.json` も持たない。次を新設する。

### package.json

```json
{
  "name": "optimize-agents-scripts",
  "version": "0.11.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

依存はルートの devDependencies を workspace 経由で使う。既存プラグインと同じ形式。

### build.ts

`plugins/task-utility/build.ts` と同形式。

```
bundle: true
outdir: "./scripts"
outExtension: { ".js": ".mjs" }
platform: "node"
format: "esm"
target: "node26"
sourcemap: false
```

entryPoints はキー名が出力ファイル名になる。

| キー | ソース |
| --- | --- |
| `run-trigger-eval` | `./src/run-trigger-eval.ts` |
| `run-output-eval` | `./src/run-output-eval.ts` |
| `aggregate-benchmark` | `./src/aggregate-benchmark.ts` |
| `check-agent-definition` | `./src/check-agent-definition.ts` |

### pnpm-workspace.yaml

`packages` に `plugins/optimize-agents` を追加する。**これを忘れると `pnpm build` が対象にしない**。

## 11. テスト

`plugins/optimize-agents/src/__test__/*.test.ts` に置く。vitest。

### テストする対象

| 対象 | 方法 |
| --- | --- |
| stream-json のパース | 純関数として切り出し、固定の JSON 行列から発火判定を検証 |
| 合否ロジック | 発火率と `should_trigger` の組み合わせを網羅 |
| `check-agent-definition` | tmpdir に定義ファイルを作り、CLI を起動して JSON 出力を検証 |
| `aggregate-benchmark` | tmpdir に `grading.json` 群を作り、集計値を検証 |
| サンドボックス構築(プラグイン形態) | tmpdir に `skill_root` = プラグインルートで構築させ、SKILL.md と scripts が配置されることを検証 |
| サンドボックス構築(単独スキル形態) | tmpdir に `skill_root` = スキルディレクトリで構築させ、同様に検証 |
| `evals/` の除外 | `skill_root` 配下に `evals/` があっても、サンドボックスへ配置されないことを検証 |
| チェッカーの言語非依存 | `checker` にシェルスクリプトを指定し、`grading.json` が読み取られることを検証。Node 以外でも動く契約であることを固定する |
| チェッカーの失敗扱い | 非 0 終了と非 JSON 出力の 2 ケースで、run が失敗として記録されることを検証 |

### テストしない対象

`claude -p` の実起動。テストで LLM を呼ばない。プロセス起動部分は差し替え可能にし、パーサとロジックだけを検証する。

## 12. 検証と回帰

### 12.1 回帰の基準値

移行後、既存 168 問で測り直す。2026-08-02 時点の task-utility 6 スキルの実測値を下回らないこと。

| セット | 基準値 |
| --- | --- |
| substantive | 46/48 |
| short | 46/48 |
| fp | 69/72 |

output eval(chat): 新規記録 with 9/9 / without 4/9、既存への追記 6/6 / 6/6。

測定には 20 分程度かかる。

### 12.2 段階的な検証

| 段階 | 検証 |
| --- | --- |
| 基盤 | `pnpm build` が optimize-agents を対象にし、`scripts/*.mjs` が生成される |
| trigger 移植 | 1 スキル 1 セットで旧 `.mjs` と同じ結果を出す。その後 168 問で回帰 |
| output ランナー | chat の eval-0 を with/without で回し、既知の 9/9 と 4/9 を再現する |
| 集計 | 上記の出力から `benchmark.md` を生成し、手作業の集計値と一致する |
| agent 検証 | 既存の `gpt-sol.md` / `chat-recorder.md` 等で errors ゼロ |

`output eval` の再現は測定器の対照実験にあたる。既知の値が出なければ、ランナーの実装を疑う。

## 13. 影響範囲

### 13.1 新規

- `plugins/optimize-agents/package.json` / `build.ts` / `src/` / `scripts/`
- `plugins/optimize-agents/skills/skill-eval/SKILL.md`
- `plugins/optimize-agents/skills/agent-creator/SKILL.md`
- `plugins/optimize-agents/references/agent-definition-spec.md`
- `plugins/optimize-agents/docs/agent-creator-rationale.md`

### 13.2 変更

| ファイル | 変更 |
| --- | --- |
| `pnpm-workspace.yaml` | `plugins/optimize-agents` を追加 |
| `plugins/optimize-agents/.claude-plugin/plugin.json` | `0.10.2-dev` → `0.11.0-dev` |
| `plugins/optimize-agents/README.md` | §提供 Skill に 2 スキルを追加。§他プラグインとの棲み分けに plugin-dev との差分を追記。`setup` / `setup-gpt` の表記不一致も直す |
| `plugins/optimize-agents/references/description-guide.md` | Agents 節を追加。「直したときの確かめ方」から `skill-eval` を参照 |
| `plugins/optimize-agents/skills/prompt-smith/SKILL.md` | 参照先の記述を維持(変更は最小) |
| `plugins/optimize-agents/docs/description-out-of-scope.md` | `run-trigger-eval` のパス更新 |
| `CLAUDE.md` / `CLAUDE.example.md` | 測定ツールのパス更新。`agent-creator` の規律を追記するかは運用後に判断 |
| `plugins/task-utility/evals/README.md` | コマンド例のパス更新 |
| `plugins/task-utility/evals/output-evals.json` | `checker` / `skill_root` / `fixtures` を追加 |
| `.raphael/antibodies/ab-2026-0802-001.md` | 本文のコマンド例更新(`update-antibody.mjs patch` を使う) |

### 13.3 削除

- `scripts/run-trigger-eval.mjs`(回帰確認の後)

### 13.4 変更しないもの

- eval セットのデータ配置。測定対象スキルの隣に置く(§5.7)。既存の `plugins/task-utility/evals/` は移動しない
- `check-chat-output.mjs`。契約が一致するため無改造で接続する
- `.claude-plugin/marketplace.json`。コンポーネントは自動検出でありエントリの更新は不要

## 14. description-guide への Agents 節

現行の guide は冒頭で「SKILL.md・Agents 定義の description の基準」と宣言しているが、本文の 4 箇条はすべて skill の実測(168 問)から導かれている。eval を skill 専用に絞ったため、Agents 側に実測は入らない。

出典を分けて記述することで、未検証の基準と実測済みの基準が同格に見える状態を避ける。

| 節 | 出典 |
| --- | --- |
| 書く内容 / 削らない | ローカル実測 168 問 |
| 直したときの確かめ方 | 同上(`skill-eval` を参照) |
| Agents 定義での違い(新規) | Anthropic 公式ドキュメント |

公式が明記しているのは 2 点のみである。

- description には "When Claude should delegate to this subagent" を書く
- 発火を強めるには "use proactively" のような句を含める

これは skill 側の「必ず使用すると書く」と同方向であり、準用は妥当と判断する。

### 14.1 Agents 節に書く内容

Haiku レビューの指摘 #8 に対応する。「skill と Agents に同じ基準が適用されている」と読まれないよう、節の冒頭で範囲を限定する。

Agents 節に書くこと。

- skill 向けの基準を準用する
- **その準用は Anthropic 公式ドキュメントの記述に基づく。このリポジトリでの発火精度の実測はない**
- `<example>` ブロックは公式に記述がないため使わない
- Agent はオーケストレーターが担当表を見て選ぶ経路が主である。作業種別と、隣接する Agent との境界を書く

`agent-creator` が `description-guide` を参照するとき、Agents 節を読むことになる。実測の有無はそこで伝わる。

`skill-eval` は Agents 節を参照しない。測定対象が skill のみだからである。

## 15. 実装順序

依存関係の順に並べる。完了条件は機械的に判定できる形で書く。

| 順 | 作業 | 完了条件 |
| --- | --- | --- |
| 0 | **`${CLAUDE_PLUGIN_ROOT}` の解決を確かめる**(§5.6) | 3 段階のどれで解決するかが決まる。結果を設計書 §5.6 に追記する |
| 1 | ビルド基盤(`package.json` / `build.ts` / workspace 登録) | `pnpm build` の出力に `optimize-agents-scripts` が現れ、`scripts/` に `.mjs` が生成される |
| 2 | `run-trigger-eval` の TS 移植 + テスト | 下記 §15.1 の回帰基準を満たす |
| 3 | 旧 `.mjs` 削除 + 参照先の一括更新(抗体含む) | `grep -rn 'scripts/run-trigger-eval.mjs' --exclude-dir=.git --exclude-dir=chat` が 0 件 |
| 4 | `check-agent-definition` + テスト | 下記 §15.2 の対象すべてで errors が 0 件 |
| 5 | `run-output-eval` + テスト | chat eval-0 で with 9/9・without 4/9、eval-1 で 6/6・6/6 を再現 |
| 6 | `aggregate-benchmark` + テスト | 段 5 の出力から `benchmark.md` を生成し、`docs/handover` 記載の値と一致 |
| 7 | `references/agent-definition-spec.md` | — |
| 8 | **新スキル 2 本の eval セット作成** | `plugins/optimize-agents/evals/{trigger,short,fp}/{skill-eval,agent-creator}.json` が揃う(§5.7 のプラグイン形態) |
| 9 | `skills/skill-eval/SKILL.md` | 段 8 のセットで substantive 6/8 以上・short 6/8 以上・fp 12/12 |
| 10 | `skills/agent-creator/SKILL.md` | 同上 |
| 11 | `description-guide` の Agents 節 | — |
| 12 | README・CLAUDE.md・plugin.json の更新 | 下記 §15.3 のチェックリスト |

### 依存関係

- **段 0 は段 5 の前提**。解決方法が決まらないと `run-output-eval` のサンドボックス構築が書けない。着手コストが小さいので最初に置く
- 段 3 は段 2 の回帰確認が通ってから行う。通らないうちは旧実装を消さない
- 段 6 は段 5 の出力を入力とする。**段 5 の完了前に段 6 の完了判定はできない**
- 段 9・段 10 は段 2(測定器)と段 8(eval セット)の両方を前提とする
- 段 8 の eval セットは既存 `plugins/task-utility/evals/` と同じ構造・同じ問題数(trigger 8 / short 8 / fp 12)にする。fp には既存 4 スキルと `prompt-smith` が正解の依頼を含める

### 15.1 段 2 の回帰基準

旧実装と新実装で、**3 セットそれぞれの合格数が同数以上**であること。合計だけで判定しない。

| セット | 基準 |
| --- | --- |
| substantive | 46/48 以上 |
| short | 46/48 以上 |
| fp | 69/72 以上 |

発火判定は確率的なので、1 回の測定で下回った場合は同条件でもう 1 回測る。2 回とも下回ったら実装を疑う。

`--runs 2` で測る。基準値と同じ条件にする。

**認証経路も基準値と同じにする。** `claude-proxy` 相当のエイリアスで起動したセッションから測る(§4.1)。結果 JSON の `environment.base_url` が `http://127.0.0.1:8317` であることを確認してから合否を判定する。経路が違えば、スコアの差が実装由来か経路由来か区別できない。

### 15.2 段 4 の検査対象

次のすべてで errors が 0 件であること。scope の判定が正しいことも同時に確かめる。

| 対象 | 期待する scope |
| --- | --- |
| `.claude/agents/gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` | project |
| `plugins/task-utility/agents/*.md`(2 本) | plugin |
| `plugins/raphael/agents/antibody-synthesizer.md` | plugin |
| `plugins/codiel/agents/*.md`(13 本) | plugin |

加えて、意図的に壊した定義(必須欠落・不正な `model`・プラグイン配下の `hooks`)で errors が出ることをテストで確かめる。**正しい定義が通ることだけでは、検査器が働いているか分からない。**

### 15.3 段 12 のチェックリスト

- [ ] `README.md` §提供 Skill に `skill-eval` と `agent-creator` の行がある
- [ ] `README.md` の `setup` 表記を `setup-gpt` に統一した
- [ ] `README.md` §他プラグインとの棲み分けに `plugin-dev` との差分がある
- [ ] `plugin.json` が `0.11.0-dev`
- [ ] `CLAUDE.md` / `CLAUDE.example.md` の測定ツールのパスが新パス
- [ ] `agent-creator` の規律追記は**行わない**(§17 のとおり運用後に判断)

## 16. リスク

| リスク | 影響 | 対処 |
| --- | --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` がサンドボックスで解決しない | output eval が動かない | §5.6 の 3 段階で対処。最後は SKILL.md の書き換え |
| 移植で trigger eval の結果が変わる | 実測値の基準が失われる | 3 の削除前に 168 問で回帰確認する |
| 新スキル 2 本が既存 4 スキルと発火競合する | 誤発火 | 8・9 で自身を測る。fp セットに既存スキルが正解の依頼を含める |
| `run-output-eval` の実装が測定器として壊れる | 誤った改善判断 | 12.2 のとおり既知の 9/9・4/9 を再現できるかで検証する |

## 17. 判断を保留した事項

| 事項 | 状況 |
| --- | --- |
| ローカルプロキシ(`127.0.0.1:8317`)の上流 | 調査しない(ユーザー判断)。サブスク認証か API キーかは未確定。測定は `environment` に経路を記録することで、後から判断できる状態にする |
| `.claude/agents/` 直下を検証する公式手段 | `claude plugin validate` はプラグイン配下が対象。project 配下の公式手段は未確認。自前の `check-agent-definition` で埋める |
| resume / issue-craft の誤発火 3 件 | 前セッションから据え置き。文面では抑えきれないと判断済み |
| output eval の eval-1 に識別力がない | 追記でしか変化しない assertion を足す必要がある。今回の機構整備では扱わない |
| 他プラグインへの eval 展開 | task-utility 以外は未着手 |
| `agent-creator` の CLAUDE.md への規律追記 | 運用してから判断する |
