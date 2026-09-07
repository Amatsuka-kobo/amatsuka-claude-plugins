---
name: setup-agents
description: custom プロファイル専用で使う Agent 定義を、実在するモデルと役割を選んでプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したとき、または SessionStart フックがエイリアス不一致を通知したときに必ず使用する。役割名の表示と生成される定義の本文はユーザーの使用言語に合わせる。接続済みの MCP サーバーを検出し、許可するものを選んで tools へ入れられる。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), Edit(**/.claude/agent-policy/roles/**), AskUserQuestion
disallowed-tools: Write
---

# Agent 定義セットアップ

生成対象はプロジェクトの `.claude/agents/` に置く Markdown の Agent 定義だけである。プロキシ、秘密値、MCP サーバーの設定そのものは管理しない。

生成した定義の `agent-policy-role` マーカーは、その帯の委譲先候補になることと、外部 Agent を名指しで dispatch するときの合成ホスト候補になることの両方を表す。`agent-policy-vendor` が出力された定義では、ベンダー別の役割断片と色もその値に従う。

## 書き込みと対話の規律

- `.claude/agents/` のファイルを `Write` / `Edit` で直接編集しない。差分確認と生成は必ず次の CLI で行う。コマンドは対象プロジェクトのルートから実行し、`--dir "$PWD"` を渡す。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" ... --dir "$PWD"
  ```

- `Edit` を使ってよいのは、CLI が作成した `.claude/agent-policy/roles/<lang>/` 配下の翻訳断片だけである。それ以外のファイルを編集しない。
- 各 CLI 応答の `ok` が `false` なら、`error` を報告してその処理を止める。生成・差分確認の応答は、単一モデルでも必ず `results` 配列で読む。生成・差分確認では `warnings` と `modelsDropped` も読む。
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

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従い、対話モードの質問は一切しない。推奨構成を一括で保持マージ生成する。

1. live models を照会する。応答の `ok`、`reason`、`models`、`claudeEnums` を保持する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-live-models --dir "$PWD"
   ```

2. 会話の使用言語から決めた `lang` を使う。`lang` が `ja` / `en` 以外なら、翻訳断片の状態を確認する。`missing` または `stale` があれば、質問や scaffold をせず、対話モードで翻訳を準備するよう案内してエラーで終了する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check-fragments --lang <lang> --dir "$PWD"
   ```

3. 推奨モデル ID の全件 `gpt-sol,gpt-terra,gpt-luna,gpt-astra,grok,haiku,sonnet,fable,opus` を `--models` へ渡し、既定名・既定役割で保持マージ生成する。照会成功時に実在しない既定エイリアスは CLI が生成対象から除外し、`modelsDropped` で返す。照会失敗時は全件を生成し、`warnings` に実在検証を行わなかった警告が入る。照会成功後、生成対象に含まれる外部既定エイリアスの `vendor` が `unknown` なら、CLI はベンダーを推定できず `ok: false` を返す。非対話モードでは選択できないため、`error` を報告して終了し、対話モードでベンダーを確定するよう案内する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --lang <lang> --models gpt-sol,gpt-terra,gpt-luna,gpt-astra,grok,haiku,sonnet,fable,opus --dir "$PWD"
   ```

4. [ステップ 7: 報告](#ステップ-7-報告)の形式で `results`、`warnings`、`modelsDropped` を報告する。MCP は明示的な選択なしに付与しない。

## 対話モード

`$ARGUMENTS` に `--yes` が含まれないときは、次を順に実施する。

### ステップ 0: 言語判定

会話でユーザーが使用している言語から `lang` を決める。会話が複数言語なら直近のユーザー発話の言語を採る。ステップ 1 の冒頭で「表示と生成には `<lang>` を使う」と明示し、変更したい場合は変更の機会を与える。以後の全 CLI コマンドに同じ `--lang <lang>` を渡す。

### ステップ 1: live models の照会

live models を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-live-models --dir "$PWD"
```

応答の `models` は `id`、`vendor`、`recommendedFor` を持つ。`claudeEnums` はプロキシ照会の成否にかかわらず常に返る Claude enum である。以後のために、この応答と `ok` / `reason` を保持する。

- `ok: true` のときは、`models` にある実在エイリアスと `claudeEnums` の両方をモデル候補にする。各実在エイリアスには `vendor` と `recommendedFor` を添え、`recommendedFor` が空でないものには推奨役割を明示する。
- `ok: false` のときは、`claudeEnums` と、推奨モデル ID の既定エイリアスを候補にする。推奨モデル ID と既定エイリアスは、`gpt-sol` = `claude-gpt-5-6-sol`、`gpt-terra` = `claude-gpt-5-6-terra`、`gpt-luna` = `claude-gpt-5-6-luna`、`gpt-astra` = `claude-gpt-6-astra`、`grok` = `claude-grok-4-6`、`haiku` = `haiku`、`sonnet` = `sonnet`、`fable` = `fable`、`opus` = `opus` である。「プロキシ未検出または照会失敗(`<reason>`)のため実在の確認ができない。定義は作れるが実在は保証されない」と明示して続行する。

### ステップ 1b: 既存定義の被覆確認

推奨の帯集合が、プロジェクトの既存定義でどこまで埋まっているかを取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --dir "$PWD"
```

この応答の `roles` は `RECOMMENDED` の全 RoleId を対象にし、各要素は `id`、`label`、`defaultName`、推奨の `models`、`coveredBy` を返す。`uncovered` は `coveredBy` が空の役割だけである。

すべての役割の `coveredBy` が空なら、既存定義が無いということである。何も聞かずステップ 2 へ進む。

1 つでも `coveredBy` が空でないときは、「役割 / 推奨モデル / 既存定義」の表を提示したうえで、次を聞く。

- `uncovered` が空でないときは 3 択とする。

  1. 未カバーの役割だけ作る(推奨)
  2. すべてのモデルを選び直す
  3. 中止する

- `uncovered` が空のときは 2 択とする。

  1. すべてのモデルを選び直す
  2. 中止する

「未カバーの役割だけ作る」を選ばれたときは、ステップ 4 と 5 と 5b と 5c と 6 を飛ばし、ステップ 2 と 3 の後に直接ステップ 6b へ進む。

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

### ステップ 4: モデル値とベンダーの選択

ステップ 1 で保持した候補から、作る定義の `model` 値を複数選択で選ばせる。候補数の共通規則に従い、5 件以上なら配列順で 4 件ずつに分割する。`ok: true` のときは実在エイリアスを先に、`claudeEnums` を後に並べる。

照会成功時は、`recommendedFor` を持つ実在エイリアスで構成できる推奨構成を数え、「推奨構成をそのまま作る」を第一候補に出す。推奨の既定エイリアスが live models に無いモデルは、推奨構成から除外したことと、そのモデル ID を明示する。この選択では、実在する推奨エイリアスに対応する推奨モデル ID を `--models` で一括生成する。`--models` は実在エイリアスそのものではなく、`gpt-sol`、`gpt-terra`、`gpt-luna`、`gpt-astra`、`grok`、`haiku`、`sonnet`、`fable`、`opus` の推奨モデル ID を受け取る。

推奨構成以外の実在エイリアスまたは Claude enum を選んだときは、選んだ `model` 値ごとに、CLI の `--model-id` に渡す 1 つの推奨モデル ID も決める。`--model-id` は既定名、Agent tool の付与判定、推奨外役割の警告に使われる。`--model` の値と役割は担当表で拘束されない。実在エイリアスが既定エイリアスと一致する場合は対応する ID を既定にし、それ以外は利用者に選ばせる。

モデル値ごとにベンダーを確定する。

- Claude enum は `claude` として扱い、確認を求めない。
- `vendor` が `gpt` / `grok` / `claude` の実在エイリアスは、その推定値を表示して確認だけを取る。変更を選ばれたときは `gpt` / `grok` / `claude` / `none` から選ばせる。
- `vendor` が `unknown` の実在エイリアスは、`gpt` / `grok` / `claude` / 「どれでもない」の 4 択で選ばせる。「どれでもない」は `--vendor none` として記録する。
- 照会失敗時に提示した既定エイリアスは、対応する推奨モデル ID のベンダーを使う。自由に指定された値ではベンダーを 4 択で選ばせる。

推定値を使う場合は `--vendor` を渡さない。選択または変更した値は個別の `--check` / `--write` に `--vendor <gpt|grok|claude|none>` を渡す。`vendor: unknown`、または推定値から変更したモデルは、`--models` に混ぜず、個別調整対象として記録する。

候補が 0 件なら質問せず、生成可能なモデルがないことを報告して終了する。

### ステップ 5: 一括確認

ステップ 4 で推奨構成または既定エイリアスのまま一括生成対象にした全モデルについて、確認コマンドを 1 回だけ実行する。個別調整対象だけを選んだ場合はこのコマンドを実行せず、全件をステップ 5b へ進める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --lang <lang> --models <model-id,...> --dir "$PWD"
```

`results` の各要素とステップ 4 の一覧を結び付け、モデルごとに次を一覧で示す。

- 既定名 (`defaultName`) と `model` 値
- 役割
- 既存状態 (`exists` / `identical`) と差分
- `mcpCurrent` から読んだ、各定義の既存のサーバー付与状況
- `warnings` と `modelsDropped`。照会成功時に `modelsDropped` に入ったモデルは生成対象外である。

次の 3 択を提示する。

1. このまま全部作る（推奨）
2. 一部を調整する
3. 中止する

「一部を調整する」を選んだときは、調整対象モデルを候補数の共通規則に従って選び、そのモデルだけステップ 5b へ進める。個別調整対象はこの選択にかかわらずステップ 5b へ進める。調整しないモデルは既定の一括生成対象として保持する。

### ステップ 5b: 個別調整

調整対象の各モデルについて、次を順に決める。

1. 役割候補を取得する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-roles --model-id <model-id> --lang <lang> --dir "$PWD"
   ```

   返った `roles` のみを複数選択として提示する。表示名は `lang` ごとに次を使う。

   | `lang` | 選択肢の役割名 |
   | --- | --- |
   | `ja` | `label` |
   | `en` | `id` |
   | その他 | 翻訳断片の `label` |

   `source` が `project` の候補にはプロジェクト固有である旨を添える。`languageMismatch: true` の候補には、プロジェクト断片は選択した言語の見出し集合(`--lang ja` なら `## 作業手順` / `## 制約`、それ以外なら `## Procedure` / `## Constraints`)を使う必要があり、一致しない見出しの節は合成結果に現れない旨を添える。候補数の共通規則を適用する。

2. 定義名を尋ねる。表示だけで済ませず、必ず質問する。選択肢は「既定名 `<defaultName>` を使う」と「別の名前を指定する」の 2 つとし、後者が選ばれたら自由入力で受ける。定義名は `.claude/agents/<name>.md` のファイル名になる。
3. `model` 値を尋ねる。表示だけで済ませず、必ず質問する。選択肢は「ステップ 4 で選んだ `<model>` を使う」と「別の値を指定する」の 2 つとし、後者が選ばれたら自由入力で受ける。照会成功時に別の値を指定すると、Claude enum でも live models の `id` でもない値は書き込み時に拒否される。既定と異なる値にすると、SessionStart フックのエイリアス不一致検知の対象から外れることを添える。
4. `model` 値を変更したとき、またはステップ 4 で `--vendor` を明示するモデルとして記録したときは、ベンダーを改めて確定する。`none` はベンダー断片を付けず、色は blue になる。
5. 選択した `kind` に `readonly` と `impl` の両方が含まれるとき、次を警告して続行確認を取る。既定は続行しない。

   > 選んだ役割に読み取り専用の役割と実装役割が混在しています。生成される定義には Write / Edit が付くため、読み取り専用の担保は依頼文の制約に委ねられます。読み取り専用の定義が必要なら、読み取り役割だけを選んだ定義を別に作れます。

6. 決めた定義名・`model` 値・ベンダー・役割をまとめて示してから、現在の定義と、個別設定を反映した差分を確認する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --model-id <model-id> --lang <lang> --name <name> --model <model-value> --roles <role-id,...> [--vendor <gpt|grok|claude|none>] --dir "$PWD"
   ```

   差分では、既存にしかない tools / frontmatter キー / 節と、共通キーの値差分 / preamble / 節本文の差分を区別して提示する。節本文は節単位でしか検出できず、見出し外の追記と HTML コメントは検出できないことを添える。
7. 差分方針を次から選ぶ。

   | 方針 | 生成時の指定 |
   | --- | --- |
   | 保持マージ（推奨） | `--write --merge` |
   | 項目を選んで保持 | `--write --merge` と、選んだ `--keep key:<name>` / `--keep section:<heading>` / `--keep preamble` |
   | 既存定義だけにある tool を名指しで保持 | `--write --merge --keep tools:<name>`。`mcp__` で始まる tool は `keptNeedsReview` で報告されるため、保持してよいか再確認する |
   | 完全上書き | `--write` |
   | スキップ | 生成しない |

   調整済みモデルは個別生成対象として記録する。スキップは、既定一括生成対象からも除外する。

### ステップ 5c: MCP の付与

MCP の選択はステップ 5 と 6 の間に行う。まず接続済みサーバーを取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-mcp --dir "$PWD"
```

`--list-mcp` が失敗した場合、または `servers` が 0 件なら、何も質問せず次へ進む。成功したときは、次を順に行う。

1. ステップ 5 の `mcpCurrent` を、既存定義から読み戻した既定値として提示する。既存定義がなければ空である。
2. `usable: true` のサーバーだけを名前と status とともに提示する。プラグイン側の既定は「付けない」だが、`mcpCurrent` があればそれを既定にする。サーバーの選択には候補数の共通規則を適用し、「どのサーバーも使わない」を先頭の選択肢に置く。それが選ばれたら、以降の MCP の質問をすべて省いてステップ 6 へ進む。
3. 既定の配分を計算する。MCP の付与単位は役割ではなく定義である。`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` のいずれかを持つ定義には、選んだ全サーバーを付ける。読み取り役割だけの定義には付けない。

   実装役割と読み取り役割を同じモデルの定義が持つ場合、MCP はその定義全体に付き、役割ごとには分離できない。

4. 既定の配分を「定義 → 付与するサーバー」の表として提示し、「この配分で進む」か「定義ごとに調整する」かを 1 回だけ聞く。付与先が 0 件の定義も、付けないことが分かるよう表に載せる。
5. 調整を選ばれたときだけ、定義ごとに付与するサーバーを複数選択で聞く。選択肢はステップ 5c-2 で選んだサーバーに限り、既定の配分を初期選択とする。「この定義には付与しない」を先頭の選択肢に置き、それが選ばれた定義は付与するサーバーを 0 件として扱う。既定で付与先が 0 件の定義も、付けたい利用者がいるため同じ質問をする。
6. 各サーバーについて、実際に適用される `_common.md` の制約と矛盾しないことを確認する。プロジェクト側の `_common.md` がある場合はそちらを優先して確認し、同梱版だけを根拠にしない。
7. 読み取り役割だけを持つ定義にサーバーが付いたときだけ、実行中の Agent 自身のツール一覧から、そのサーバーの編集・書き込み・削除など外部状態を変えるツールを列挙する。読み取り・検索・解析だけのツールは除外する。`disallowedTools` に入れる案を提示して確認を取り、追加・削除を受け付ける。該当する定義が複数あっても、denylist はツール名の集合なので 1 回にまとめて聞く。

   denylist は列挙漏れを許可する方式である。漏れた編集系ツールは読み取り役割から使えてしまうことを明示する。確定した denylist は、サーバーが付いた全定義へ `--mcp-deny` で渡す。

### ステップ 6: 生成

1 回のコマンドに渡した `--mcp-servers` / `--mcp-deny` は、そのコマンドが生成する全定義へ同じ内容で適用される。MCP を選ばなかったときは、ステップ 5 で「このまま全部作る」を選んだモデルと、個別調整しなかったモデルを、従来どおり 1 回の一括生成で保持マージする。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --lang <lang> --models <model-id,...> --dir "$PWD"
```

MCP を選んだときは、付与するサーバーと denylist が同じモデルをグループに分け、グループごとに `--write` を発行する。付与内容が異なるモデルを同じ `--models` に含めてはならない。MCP を付けないモデルのグループでは `--mcp-servers` と `--mcp-deny` を省く。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --lang <lang> --models <same-mcp-model-id,...> --mcp-servers <server,...> --mcp-deny <tool,...> --dir "$PWD"
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --lang <lang> --models <model-id-without-mcp,...> --dir "$PWD"
```

個別調整したモデルは、モデルごとに選んだ差分方針と、その定義に決めた MCP の付与内容を使って生成する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write [--merge] --model-id <model-id> --lang <lang> --name <name> --model <model-value> --roles <role-id,...> [--vendor <gpt|grok|claude|none>] [--keep <selector> ...] [--mcp-servers <server,...>] [--mcp-deny <tool,...>] --dir "$PWD"
```

`--keep` は `--models` と併用できない。`--keep` を選んだ場合は必ず個別コマンドで実行する。各書き込みの `results`、`warnings`、`modelsDropped` を保存し、次の報告に使う。

### ステップ 6b: 未カバー役割の生成

被覆を取り直す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --dir "$PWD"
```

この節は、ステップ 1b でどの選択をした場合でも必ず通る。`uncovered` が空なら何も聞かずステップ 7 へ進む。

空でないときは、この会話で「作らない」と決めた役割を除いたものを対象とし、対象が無くなるまで次を繰り返す。

1. 対象のうち `models` が同じ役割が 2 つ以上あるとき、それらを 1 つの定義にまとめるかを聞く。「まとめて 1 つの定義にする」と「1 つずつ別の定義にする」の 2 択とする。まとめるほうを選ばれたときは、まとめる役割を複数選択で選ばせる。
2. 作る単位ごとに「この定義を作る」か「この役割の定義は作らない」かを聞く。「作らない」を選ばれた役割は、この会話の間だけ対象から外す。ファイルへは記録しないため、次に setup-agents を実行したときには改めて尋ねる。
3. 「作る」を選ばれたら、使う推奨モデル ID を決める。`models` が 1 件ならその ID を使い、質問しない。2 件以上なら、どの ID を使うかを聞く。ステップ 1 の照会が成功しており、その ID の既定エイリアスが `models` に無い場合は、既定値での書き込みが拒否されるため候補から外し、その ID を報告する。別の実在エイリアスを使うときは、選んだ ID と `--model <model-value>` を個別コマンドへ渡す。
4. 定義名を尋ねる。表示だけで済ませず、必ず質問する。既定は `<model-id>-<default-name>` である。`<default-name>` は被覆の応答が返した `defaultName` であり、ステップ 4 の選択で用いた定義名とは別物である。まとめた場合は、選んだ役割のうち被覆の応答の並びで最初のものを使う。選択肢は「既定名 `<name>` を使う」と「別の名前を指定する」の 2 つとし、後者が選ばれたら自由入力で受ける。

   被覆の応答に `defaultName` が無い役割では、既定名を組み立てられない。その場合は既定名を提示せず、定義名を自由入力だけで受ける。
5. その定義へ付与する MCP サーバーを聞く。候補はステップ 5c で選んだサーバーとし、ステップ 5c を通っていなければ `--list-mcp` の `usable: true` を候補にする。候補が 0 件なら質問しない。「この定義には付与しない」を先頭の選択肢に置く。既存定義の付与内容は流用しない。
6. 実在エイリアスの `vendor` が `unknown`、または自由な `--model` 値を選んだときは、ステップ 4 と同じ方法でベンダーを確定する。
7. 生成する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --model-id <model-id> --lang <lang> --name <name> [--model <model-value>] --roles <role-id,...> [--vendor <gpt|grok|claude|none>] [--mcp-servers <server,...>] [--mcp-deny <tool,...>] --dir "$PWD"
   ```

8. 被覆を取り直し、残った対象について 1 へ戻る。

各書き込みの `results`、`warnings`、`modelsDropped` を保存し、ステップ 7 の報告に使う。

### ステップ 7: 報告

すべての書き込み応答の `results` から、次を報告する。

- 生成した `target` のパス
- ステップ 6b で「作らない」と決めた役割があれば、その一覧と、次に setup-agents を実行したときに再び尋ねられること
- 各定義の `action`、`kept`、`discarded`、`keptNeedsReview`
- `mcpDropped`。再検証で落としたサーバーがあれば、tools へ入らなかったこと
- 各応答の `warnings` と `modelsDropped`。照会失敗時は実在検証を行わなかった警告、照会成功時は `modelsDropped` にある推奨モデルを生成しなかったことを報告する
- モデル値とベンダーの確定方法。`agent-policy-vendor` を出力しない `none` の定義では、ベンダー断片を付けず色が blue になること
- 方針の読み込ませ方。`AMATSUKA_AGENT_AUTO_INJECTION` は trim と小文字化の後、`none` / `claude` / `custom` の 3 値で扱われる。

  - 未設定、空、または `none` のとき。自動注入はない。CLAUDE.md への追記文例を出す。自動では追記しない。

    > - 最初に必ず `agent-policy:custom-policy` スキルを使用し、この規律に従う。

  - `claude` のとき。SessionStart フックは `claude-model-policy` を注入する。生成した custom 定義を担当表のマーカーで使うには、環境変数を `custom` へ変更するか、CLAUDE.md へ上の 1 行を足すよう案内する。
  - `custom` のとき。SessionStart フックは役割マーカー付き定義の `model` を検証する。すべて実在すれば custom プロファイルとマーカー対応表を注入する。照会失敗、実在しないモデル、または役割マーカー付き定義が 0 件なら、セッション全体で `claude-model-policy` へフォールバックすることを伝える。
  - 旧値 `with-codex` / `with-grok` / `with-codex-grok` のとき。custom として扱われるが、`custom` へ移行する通知が出る。環境変数を `custom` へ変更するよう案内する。
  - それ以外の値のとき。自動注入を行わない警告が出るため、`none` / `claude` / `custom` のいずれかへ変更するよう案内する。

- `.claude/agents/` を git 追跡するかはプロジェクトの判断であること
- `.claude/agents/` ディレクトリを新規作成した初回だけ、Claude Code に読み込ませるため再起動が必要であること
