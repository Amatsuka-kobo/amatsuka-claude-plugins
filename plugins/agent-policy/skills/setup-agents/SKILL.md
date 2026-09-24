---
name: setup-agents
description: Agent 定義を、モデルと役割を選んでプロジェクトの .claude/agents/ に生成するウィザード。Claude のモデルだけで構成するか、外部ベンダーのモデルも候補に含めるかを最初に選ぶ。ユーザーが「エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したとき、または SessionStart フックがエイリアス不一致を通知したときに必ず使用する。役割名の表示と生成される定義の本文はユーザーの使用言語に合わせる。接続済みの MCP サーバーを検出し、許可するものを選んで tools へ入れられる。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), Edit(**/.claude/agent-policy/roles/**), AskUserQuestion
disallowed-tools: Write
---

# Agent 定義セットアップ

生成対象はプロジェクトの `.claude/agents/` に置く Markdown の Agent 定義だけである。プロキシ、秘密値、MCP サーバーの設定そのものは管理しない。

生成した定義の `agent-policy-role` マーカーは、その役割の委譲先候補になることと、外部 Agent を名指しで dispatch するときの合成ホスト候補になることの両方を表す。`agent-policy-vendor` が出力された定義では、ベンダー別の役割断片と色もその値に従う。

## 書き込みと対話の規律

- `.claude/agents/` のファイルを `Write` / `Edit` で直接編集しない。差分確認と生成は必ず次の CLI で行う。コマンドは対象プロジェクトのルートから実行し、`--dir "$PWD"` を渡す。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" ... --dir "$PWD"
  ```

- `Edit` を使ってよいのは、CLI が作成した `.claude/agent-policy/roles/<lang>/` 配下の翻訳断片だけである。それ以外のファイルを編集しない。
- 各 CLI 応答の `ok` が `false` なら、`error` を報告してその処理を止める。生成・差分確認の応答は、単一モデルでも必ず `results` 配列で読む。生成・差分確認では `warnings` も読む。
- `AskUserQuestion` は 1 問につき選択肢を 2〜4 個しか受け付けない。すべての選択で次を守る。

  | 候補数 | 扱い |
  | --- | --- |
  | 0 件 | 質問せず、候補がないことを報告して次へ進む。 |
  | 1 件 | `AskUserQuestion` を使わず、「これを使うか」を通常の確認文で尋ねる。 |
  | 2〜4 件 | 1 回の `AskUserQuestion` で尋ねる。 |
  | 5 件以上 | 配列の並び順のまま 4 件ずつに分け、各質問に `(1/2)` のような通し番号を付ける。 |

この規則は特にモデル、役割、MCP サーバーの選択で守る。

- 選択の結果が空になりうるときは、「付与しない」に相当する選択肢を先頭に明示して置く。`AskUserQuestion` は空の選択を受け付けないため、選択肢を出した時点で必ず 1 つ以上選ばれる。この選択肢が無いと、何も選ばないという意思を利用者が表せない。5 件以上で分割するときは先頭のページに置き、それが選ばれたら残りのページを尋ねない。

## 非対話モード

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従い、対話モードの質問は一切しない。推奨構成を役割ごとに 1 定義ずつ保持マージ生成する。

`$ARGUMENTS` に `--scope claude` または `--scope custom` があればそれを使う。無ければ `AMATSUKA_AGENT_AUTO_INJECTION` から決める(`custom` 系なら `custom`、それ以外は `claude`)。決めた値を以後の全 CLI コマンドへ渡す。

1. live models を照会する。応答の `ok`、`reason`、`models`、`claudeEnums` を保持する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-live-models --scope <claude|custom> --dir "$PWD"
   ```

2. 会話の使用言語から決めた `lang` を使う。`lang` が `ja` / `en` 以外なら、翻訳断片の状態を確認する。`missing` または `stale` があれば、質問や scaffold をせず、対話モードで翻訳を準備するよう案内してエラーで終了する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check-fragments --lang <lang> --dir "$PWD"
   ```

3. 次のコマンドで、役割ごとの推奨モデル定義を保持マージ生成する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --scope <claude|custom> --lang <lang> --dir "$PWD"
   ```

   custom の照会成功時は、各役割の推奨候補を順に調べ、実在する最初のモデルを採る。先頭の既定エイリアスが存在しない役割は次の候補へ進む。Claude のモデルは必ず実在するため、最初の Claude モデルで採用を止める。照会に失敗したときは各役割の先頭候補を採り、`warnings` に実在検証なしの警告が入る。

   `--scope claude` では Claude の役割モデルを使い、live models の照会は生成時に行わない。

4. 結果を報告する。MCP は明示的な選択なしに付与しない。

## 対話モード

`$ARGUMENTS` に `--yes` が含まれないときは、次を順に実施する。

### ステップ 0: 言語判定

会話でユーザーが使用している言語から `lang` を決める。会話が複数言語なら直近のユーザー発話の言語を採る。以後の全 CLI コマンドに同じ `--lang <lang>` を渡す。

### ステップ 0b: 構成の選択

`AskUserQuestion` を 1 回だけ使い、次の 2 択で構成を決める。選んだ値は以後の全 CLI コマンドへ `--scope <claude|custom>` として渡す。

- **Claude のみ**(`--scope claude`)—— Claude のモデル(`sonnet` / `opus` / `haiku` / `fable`)だけを候補にする。プロキシは要らない。
- **カスタム**(`--scope custom`)—— 外部ベンダーのモデルも候補に含める。ローカルプロキシの `/v1/models` に実在するモデルから選ぶ。

同じ質問の中で「表示と生成には `<lang>` を使う」ことを伝え、変更の機会も与える。

既存の `.claude/agents/` に役割マーカー付き定義があるときは、その `model` 値の内訳(Claude のモデルが何件、外部ベンダーが何件)を選択肢の説明に添える。

### ステップ 1: live models の照会

`--scope claude` のときは `--list-live-models` を実行しない(実行しても `models` は空で返る)。候補は `sonnet` / `opus` / `haiku` / `fable` の 4 値に固定し、ステップ 3 を飛ばしてステップ 4 へ進む。以下は `--scope custom` の手順である。

live models を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-live-models --scope <claude|custom> --dir "$PWD"
```

応答の `models` は `id`、`vendor`、`recommendedFor` を持つ。`claudeEnums` はプロキシ照会の成否にかかわらず常に返る Claude enum である。以後のために、この応答と `ok` / `reason` を保持する。

- `ok: true` のときは、`models` にある実在エイリアスと `claudeEnums` の両方をモデル候補にする。各実在エイリアスには `vendor` と `recommendedFor` を添え、`recommendedFor` が空でないものには推奨役割を明示する。
- `ok: false` のときは、`claudeEnums` と、推奨モデル ID の既定エイリアスを候補にする。推奨モデル ID と既定エイリアスは、`gpt-sol` = `claude-gpt-6-sol`、`gpt-terra` = `claude-gpt-5-6-terra`、`gpt-luna` = `claude-gpt-6-luna`、`gpt-astra` = `claude-gpt-6-astra`、`grok` = `claude-grok-4-7`、`haiku` = `haiku`、`sonnet` = `sonnet`、`fable` = `fable`、`opus` = `opus` である。「プロキシ未検出または照会失敗(`<reason>`)のため実在の確認ができない。定義は作れるが実在は保証されない」と明示して続行する。

### ステップ 1b: 既存定義の被覆確認

`--list-coverage` にも `--scope` を渡す。`--scope claude` では、外部ベンダーのモデルを指定した既存定義は被覆に数えない。GPT / Grok の定義で埋まっている役割も未カバーとして現れる。

推奨の役割集合が、プロジェクトの既存定義でどこまで埋まっているかを取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --scope <claude|custom> --dir "$PWD"
```

この応答の `roles` は `RECOMMENDED` の全 RoleId を対象にし、各要素は `id`、`label`、`defaultName`、推奨の `models`、`coveredBy` を返す。`uncovered` は `coveredBy` が空の役割だけである。

すべての役割の `coveredBy` が空なら、既存定義が無いということである。何も聞かずステップ 2 へ進む。

1 つでも `coveredBy` が空でないときは、「役割 / 推奨モデル / 既存定義」の表を提示したうえで、次を聞く。

- `uncovered` が空でないときは 3 択とする。

  1. 未カバーの役割だけ作る(推奨)
  2. すべての役割の定義を確認し直す
  3. 中止する

- `uncovered` が空のときは 2 択とする。

  1. すべての役割の定義を確認し直す
  2. 中止する

「未カバーの役割だけ作る」を選ばれたときは、ステップ 2 と 3 の後に次を実行し、ステップ 6b を経由せずステップ 7 へ進む。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --recommended --roles <uncovered…> --scope <claude|custom> --lang <lang> --dir "$PWD"
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --roles <uncovered…> --scope <claude|custom> --lang <lang> --dir "$PWD"
```

差分を表で示し、生成後に結果を報告する。コマンドは空の `uncovered` では実行しない。

### ステップ 2: 翻訳断片の準備

`lang` が `ja` または `en` なら、このステップを飛ばす。それ以外では次を行う。

1. 翻訳断片の状態を取得する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check-fragments --lang <lang> --dir "$PWD"
   ```

2. `missing` と `stale` がともに空なら次へ進む。どちらかがあれば、`--scaffold-fragments` を実行する前に `stale` の既存訳の内容を確認し、必要なら退避するよう促す。scaffold は stale のファイルを英語ソースで上書きするため、既存の訳は失われる。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --scaffold-fragments --lang <lang> --dir "$PWD"
   ```

3. 応答の `written` にある各ファイルを `Edit` で翻訳する。翻訳するのは本文と frontmatter の `label` / `description` だけである。`id` / `kind` / `tools` / `source-lang` / `source-hash` は変更しない。節見出しは英語のまま保つ。合成器は見出しで節を突き合わせるためである。
4. 状態確認を再実行し、`missing` と `stale` が空になったことを確認する。空でない場合は生成へ進まない。

### ステップ 3: 照会結果の確認

ステップ 1 の `--list-live-models` がプロキシ前提確認を兼ねる。別の検証コマンドの実行は求めない。

- `ok: true` のときは、`models` の各 `id` だけを外部モデルの実在する候補として扱う。
- `ok: false` のときは、`reason` を示し、外部モデルの生成物は実在保証を持たないことを再度伝える。後続の `--write` / `--check` は、照会失敗を `warnings` に入れて検証なしで続行する。

### ステップ 4: 推奨定義の確認

`--scope claude` では Claude 用の割り当てを使い、custom では `RECOMMENDED` を使う。次のコマンドで生成対象の差分を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --recommended --scope <claude|custom> --lang <lang> --dir "$PWD"
```

`results` を `役割 / 採用モデル / 定義名 / 既存状態と差分` の表にして提示する。採用モデルは各結果の `roleId` と `modelId`、定義名は `target` から読み取る。`exists` / `identical` と差分を示す。`warnings` があれば併記する。

照会成功時に候補先頭の既定エイリアスが存在しない役割は次の候補へ進む。Claude のモデルは必ず存在するため、最初の Claude のモデルで採用を止める。照会失敗時は先頭候補を採用する。

ベンダーの確定はステップ 5b で行う。

### ステップ 5: 生成範囲の確認

次の 3 択を `AskUserQuestion` で尋ねる。

1. このまま全部作る
2. 一部の役割を調整する
3. 中止する

一部調整を選んだ場合は、調整する役割を候補数の共通規則に従って選ばせ、選んだ役割をステップ 5b へ進める。各役割についてモデル ID と定義名を 5b で決める。

### ステップ 5b: 役割ごとの個別調整

調整する役割ごとに、モデル ID と定義名を決める。モデル ID の候補は、その役割の `--list-coverage` 応答にある `models` とする。質問では「どのモデル ID を使うか」を尋ね、1 件なら通常の確認文、2〜4 件なら `AskUserQuestion`、5 件以上なら配列順のまま 4 件ずつに分けた `AskUserQuestion` で選ばせる。候補が無い場合は質問せず報告して止める。

選んだ ID で `--list-roles --model-id <model-id>` を実行して役割候補を確認する。調整対象の役割が候補に含まれない場合は、その ID を使わず利用者へ報告する。各個別定義は `--model-id … --roles <1 件>` で確認・生成し、既定の model 値は CLI がその ID から決める。定義名は「既定名を使う」か「別の名前を指定する」の 2 択で必ず尋ね、後者は自由入力で受ける。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --model-id <model-id> --lang <lang> --name <name> --model <model-value> --roles <1 件> [--vendor <gpt|grok|claude|none>] --scope <claude|custom> --dir "$PWD"
```

モデル値を既定エイリアスから変更した場合、またはベンダーが `unknown` の場合はベンダーを確定する。候補は `gpt` / `grok` / `claude` / 「どれでもない」(`none`) の 4 値とする。既知ベンダーは推定値を示して確認し、変更を望む場合に 4 値から選ばせる。ベンダーが `none` なら `--vendor none` を渡す。

複数役割を一括で個別調整し、その選択に impl と readonly の両方が含まれる場合だけ、kind 混在を警告して続行確認を取る。既定は続行しない。

差分方針は保持マージ、選択した項目の保持、完全上書き、スキップから尋ねる。保持対象を選ぶ場合は `--keep` を個別コマンドに渡す。`--recommended` は `--model-id` / `--name` / `--model` / `--vendor` / `--keep` と併用しない。

### ステップ 5c: MCP の付与

MCP の選択はステップ 5 と 6 の間に行う。まず接続済みサーバーを取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-mcp --dir "$PWD"
```

`--list-mcp` が失敗した場合、または `servers` が 0 件なら、何も質問せず次へ進む。成功したときは、次を順に行う。

1. ステップ 4 の `mcpCurrent` を、既存定義から読み戻した既定値として提示する。既存定義がなければ空である。
2. `usable: true` のサーバーだけを名前と status とともに提示する。プラグイン側の既定は「付けない」だが、`mcpCurrent` があればそれを既定にする。サーバーの選択には候補数の共通規則を適用し、「どのサーバーも使わない」を先頭の選択肢に置く。それが選ばれたら、以降の MCP の質問をすべて省いてステップ 6 へ進む。
3. 既定の配分を計算する。MCP は impl 役割の定義に付け、readonly 役割の定義には付けない。既定で付与する役割は `complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan` である。
4. 既定の配分を「役割 → 付与するサーバー」の表で提示し、「この配分で進む」か「役割ごとに調整する」かを 1 回だけ質問する。付与先が 0 件の役割も表に載せる。
5. 調整を選んだときだけ、役割ごとに付与するサーバーを複数選択で聞く。選択肢は選んだサーバーに限り、既定配分を初期選択とする。「この役割には付与しない」を先頭に置く。既定で付与先が 0 件の役割も同じ質問をする。
6. 各サーバーについて、適用される `_common.md` の制約と矛盾しないことを確認する。プロジェクト側の `_common.md` があれば優先し、同梱版だけを根拠にしない。
7. サーバーを付与する readonly 役割について、実行中の Agent 自身のツール一覧から外部状態を変えるツールを列挙する。読み取り・検索・解析ツールは除外する。`disallowedTools` に入れる案を提示して確認を取り、denylist は該当する役割間で 1 回にまとめて聞く。

denylist は列挙漏れを許可する方式である。漏れた編集系ツールは readonly 役割から使えてしまうことを明示する。確定した denylist は、サーバーが付いた全定義へ `--mcp-deny` で渡す。

### ステップ 6: 生成

個別調整した役割は、ステップ 5b で決めた設定と差分方針を使い、個別コマンドで生成する。個別調整しない役割に MCP を選ばなかった場合は、次のコマンドを 1 回実行する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --scope <claude|custom> --lang <lang> --dir "$PWD"
```

MCP を選んだ場合は、impl 役割と readonly 役割を別々に生成する。MCP を付与する impl 役割だけを含む最初のコマンドに `--mcp-servers` と `--mcp-deny` を渡す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --roles <impl 役割…> --mcp-servers <server,...> --mcp-deny <tool,...> --scope <claude|custom> --lang <lang> --dir "$PWD"
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --roles <readonly 役割…> --scope <claude|custom> --lang <lang> --dir "$PWD"
```

MCP を選ばなかった場合は `--recommended` の 1 回だけを使う。`--recommended` は `--model-id` / `--name` / `--model` / `--vendor` / `--keep` と併用できない。個別調整した役割は上記の一括生成に含めず、個別コマンドで生成する。

### ステップ 6b: 未カバー役割の生成

被覆を取り直す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --scope <claude|custom> --dir "$PWD"
```

`uncovered` が空なら質問せずステップ 7 へ進む。空でなければ、次の `--check` で差分を示してから `--write` で未カバー役割を生成する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --recommended --roles <uncovered…> --scope <claude|custom> --lang <lang> --dir "$PWD"
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --roles <uncovered…> --scope <claude|custom> --lang <lang> --dir "$PWD"
```

差分を示す。利用者が個別調整を望む場合は、生成前に対象役割をステップ 5b へ戻し、役割単位で調整する。その他の未カバー役割は `--recommended` で生成し、モデル ID や定義名を個別に尋ねない。

### ステップ 7: 報告

すべての書き込み応答の `results` から、次を報告する。

- 生成した `target` のパス
- ステップ 6b で「作らない」と決めた役割があれば、その一覧と、次に setup-agents を実行したときに再び尋ねられること
- 各定義の `action`、`kept`、`discarded`、`keptNeedsReview`
- `mcpDropped`。再検証で落としたサーバーがあれば、tools へ入らなかったこと
- 各応答の `warnings`
- モデル値とベンダーの確定方法。`agent-policy-vendor` を出力しない `none` の定義では、ベンダー断片を付けず色が blue になること
- 方針の読み込ませ方。`AMATSUKA_AGENT_AUTO_INJECTION` は trim と小文字化の後、`none` / `claude` / `custom` の 3 値で扱われる。

  - 未設定、空、または `none` のとき。自動注入はない。CLAUDE.md への追記文例は、選んだ構成に応じて出し分ける。自動では追記しない。

    - `--scope claude` のとき。

      > - 最初に必ず `agent-policy:claude-model-policy` スキルを使用し、この規律に従う。

    - `--scope custom` のとき。

      > - 最初に必ず `agent-policy:custom-policy` スキルを使用し、この規律に従う。

  - `claude` のとき。SessionStart フックは `claude-model-policy` と、Claude のモデルで実行される定義だけの役割マーカー対応表を注入します。`--scope claude` で生成した定義はそのまま対応表に載ります。外部ベンダーの定義を委譲先に使うには、環境変数を `custom` へ変更します。
  - `custom` のとき。SessionStart フックは役割マーカー付き定義の `model` を検証する。すべて実在すれば custom プロファイルとマーカー対応表を注入する。照会失敗、実在しないモデル、または役割マーカー付き定義が 0 件なら、セッション全体で `claude-model-policy` へフォールバックすることを伝える。
  - 旧値 `with-codex` / `with-grok` / `with-codex-grok` のとき。custom として扱われるが、`custom` へ移行する通知が出る。環境変数を `custom` へ変更するよう案内する。
  - それ以外の値のとき。自動注入を行わない警告が出るため、`none` / `claude` / `custom` のいずれかへ変更するよう案内する。

- `.claude/agents/` を git 追跡するかはプロジェクトの判断であること
- `.claude/agents/` ディレクトリを新規作成した初回だけ、Claude Code に読み込ませるため再起動が必要であること
