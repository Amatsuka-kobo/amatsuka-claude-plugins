---
name: setup-agents
description: 4 つの運用方針(claude-model / with-codex / with-grok / codex-grok)で使う Agent 定義を、ポリシーとモデルと役割を選んでプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したとき、または SessionStart フックがエイリアス不一致を通知したときに必ず使用する。担当表上あり得ないモデルと役割の組み合わせは選べない。役割名の表示と生成される定義の本文はユーザーの使用言語に合わせる。接続済みの MCP サーバーを検出し、許可するものを選んで tools へ入れられる。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), Edit(**/.claude/agent-policy/roles/**), AskUserQuestion
disallowed-tools: Write
---

# Agent 定義セットアップ

生成対象はプロジェクトの `.claude/agents/` に置く Markdown の Agent 定義だけである。プロキシ、秘密値、MCP サーバーの設定そのものは管理しない。

## 書き込みと対話の規律

- `.claude/agents/` のファイルを `Write` / `Edit` で直接編集しない。差分確認と生成は必ず次の CLI で行う。コマンドは対象プロジェクトのルートから実行し、`--dir "$PWD"` を渡す。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" ... --dir "$PWD"
  ```

- `Edit` を使ってよいのは、CLI が作成した `.claude/agent-policy/roles/<lang>/` 配下の翻訳断片だけである。それ以外のファイルを編集しない。
- 各 CLI 応答の `ok` が `false` なら、`error` を報告してその処理を止める。生成・差分確認の応答は、単一モデルでも必ず `results` 配列で読む。
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

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従い、対話モードの質問は一切しない。

1. `$ARGUMENTS` の `--policy <id>` を最優先する。指定がないときは `--list-policies` の応答から、`AMATSUKA_AGENT_AUTO_INJECTION` と `injection` が一致するポリシーを解決する。どちらでも決まらないときは、質問せずエラーで終了する。

   `AMATSUKA_AGENT_AUTO_INJECTION` の値とポリシー ID は別体系である。たとえば環境変数値 `claude` に対応する ID は `claude-model-policy` である。CLI の `--policy` へは必ず ID を渡す。

2. 会話の使用言語から決めた `lang` を使う。`lang` が `ja` / `en` 以外なら、翻訳断片の状態を確認する。`missing` または `stale` があれば、質問や scaffold をせず、対話モードで翻訳を準備するよう案内してエラーで終了する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check-fragments --lang <lang> --dir "$PWD"
   ```

3. 解決済みポリシーのモデル一覧を取得し、その `id` をすべて `--models` へカンマ区切りで渡す。全モデルを既定名・既定役割で保持マージ生成する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-models --policy <policy-id> --dir "$PWD"
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --policy <policy-id> --lang <lang> --models <model-id,...> --dir "$PWD"
   ```

4. [ステップ 7: 報告](#ステップ-7-報告)の形式で `results` を報告する。MCP は明示的な選択なしに付与しない。

## 対話モード

`$ARGUMENTS` に `--yes` が含まれないときは、次を順に実施する。

### ステップ 0: 言語判定

会話でユーザーが使用している言語から `lang` を決める。会話が複数言語なら直近のユーザー発話の言語を採る。ステップ 1 の冒頭で「表示と生成には `<lang>` を使う」と明示し、変更したい場合は変更の機会を与える。以後の全 CLI コマンドに同じ `--lang <lang>` を渡す。

### ステップ 1: ポリシー選択

ポリシー一覧を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-policies --dir "$PWD"
```

返った `id` / `label` / `injection` を使い、4 ポリシーを単一選択で提示する。応答の `injected` が非 null なら、その `id` のポリシーを第一候補に置き、SessionStart フックが現在その方針を注入していることを添える。`injected` が null なら第一候補を置かない。

`injected` の値はステップ 7 でも使うため保持する。

環境変数の値を ID と混同しない。選択後の以後の `--policy` には、必ず応答の `id`、たとえば `claude-model-policy` を渡す。

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

### ステップ 3: プロキシ前提確認

選んだポリシーに GPT または Grok が含まれるときだけ、該当ベンダーごとに次を確認する。検証コマンドの実行は求めず、確認方法の提示に留める。

- Claude Code がそのベンダーのモデルを配信するローカルプロキシ経由で起動しているか。
- プロキシの `/v1/models` 応答に使用予定のモデルエイリアスがあるか。

満たせないベンダーがあっても終了しない。そのベンダーのモデルをステップ 4 の選択肢から除外し、Claude 帯の定義は続けて生成できることを伝える。ステップ 7 では、除外したベンダーと対応ポリシーのフォールバック規定を報告する。

- GPT が利用不可の場合、`with-codex-policy` / `codex-grok-policy` は実行帯の代替帯を使い、`codex@openai-codex` も不可なら Claude の担当表へ読み替える。
- Grok が利用不可の場合、`with-grok-policy` は実装帯・探索実働を Claude の同名行へ読み替え、独立レビューは省略し、リアルタイム情報調査は Opus と WebSearch で代行する。`codex-grok-policy` は独立レビューを省略し、リアルタイム情報調査を Opus と WebSearch で代行し、探索実働を GPT Terra / GPT Luna へ読み替える。

### ステップ 4: モデル選択

モデル一覧を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-models --policy <policy-id> --dir "$PWD"
```

ステップ 3 で除外したベンダーを取り除いた `models` を、複数選択として提示する。既定は全モデル選択とする。各候補には `label`、`defaultName`、解決済みの `model`、`roles` を示す。候補数の共通規則に従い、5 件以上なら配列順で 4 件ずつに分割する。ベンダーごとの分割で 1 件だけのグループを作らない。

候補が 0 件なら質問せず、生成可能なモデルがないことを報告して終了する。

### ステップ 5: 一括確認

選んだ全モデルについて、確認コマンドを 1 回だけ実行する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --policy <policy-id> --lang <lang> --models <model-id,...> --dir "$PWD"
```

`results` の各要素とステップ 4 の一覧を結び付け、モデルごとに次を一覧で示す。

- 既定名 (`defaultName`) と `model` 値
- 役割
- 既存状態 (`exists` / `identical`) と差分
- `mcpCurrent` から読んだ、各定義の既存のサーバー付与状況

次の 3 択を提示する。

1. このまま全部作る（推奨）
2. 一部を調整する
3. 中止する

「一部を調整する」を選んだときは、調整対象モデルを候補数の共通規則に従って選び、そのモデルだけステップ 5b へ進める。調整しないモデルは既定の一括生成対象として保持する。

### ステップ 5b: 個別調整

調整対象の各モデルについて、次を順に決める。

1. 役割候補を取得する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-roles --policy <policy-id> --model-id <model-id> --lang <lang> --dir "$PWD"
   ```

   返った `roles` のみを複数選択として提示する。表示名は `lang` ごとに次を使う。

   | `lang` | 選択肢の役割名 |
   | --- | --- |
   | `ja` | `label` |
   | `en` | `id` |
   | その他 | 翻訳断片の `label` |

   `source` が `project` の候補にはプロジェクト固有である旨を添える。`languageMismatch: true` の候補には、プロジェクト断片は選択した言語の見出し集合(`--lang ja` なら `## 作業手順` / `## 制約`、それ以外なら `## Procedure` / `## Constraints`)を使う必要があり、一致しない見出しの節は合成結果に現れない旨を添える。候補数の共通規則を適用する。

2. 定義名を尋ねる。表示だけで済ませず、必ず質問する。選択肢は「既定名 `<defaultName>` を使う」と「別の名前を指定する」の 2 つとし、後者が選ばれたら自由入力で受ける。定義名は `.claude/agents/<name>.md` のファイル名になる。
3. `model` 値を尋ねる。表示だけで済ませず、必ず質問する。選択肢は「ステップ 4 が返した `<model>` を使う」と「別の値を指定する」の 2 つとし、後者が選ばれたら自由入力で受ける。既定と異なる値にすると、SessionStart フックのエイリアス不一致検知の対象から外れることを添える。
4. 選択した `kind` に `readonly` と `impl` の両方が含まれるとき、次を警告して続行確認を取る。既定は続行しない。

   > 選んだ役割に読み取り専用の役割と実装役割が混在しています。生成される定義には Write / Edit が付くため、読み取り専用の担保は依頼文の制約に委ねられます。読み取り専用の定義が必要なら、読み取り役割だけを選んだ定義を別に作れます。

5. 決めた定義名・`model` 値・役割をまとめて示してから、現在の定義と、個別設定を反映した差分を確認する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --policy <policy-id> --model-id <model-id> --lang <lang> --name <name> --model <model-value> --roles <role-id,...> --dir "$PWD"
   ```

   差分では、既存にしかない tools / frontmatter キー / 節と、共通キーの値差分 / preamble / 節本文の差分を区別して提示する。節本文は節単位でしか検出できず、見出し外の追記と HTML コメントは検出できないことを添える。
6. 差分方針を次から選ぶ。

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
3. 既定の配分を計算する。MCP の付与単位は役割ではなく定義である。`complex-impl` / `normal-impl` / `light-impl` / `general` のいずれかを持つ定義には、選んだ全サーバーを付ける。読み取り役割だけの定義には付けない。

   実装役割と読み取り役割を同じモデルの定義が持つ場合、MCP はその定義全体に付き、役割ごとには分離できない。

4. 既定の配分を「定義 → 付与するサーバー」の表として提示し、「この配分で進む」か「定義ごとに調整する」かを 1 回だけ聞く。付与先が 0 件の定義も、付けないことが分かるよう表に載せる。

5. 調整を選ばれたときだけ、定義ごとに付与するサーバーを複数選択で聞く。選択肢はステップ 5c-2 で選んだサーバーに限り、既定の配分を初期選択とする。「この定義には付与しない」を先頭の選択肢に置き、それが選ばれた定義は付与するサーバーを 0 件として扱う。既定で付与先が 0 件の定義も、付けたい利用者がいるため同じ質問をする。

6. 各サーバーについて、実際に適用される `_common.md` の制約と矛盾しないことを確認する。プロジェクト側の `_common.md` がある場合はそちらを優先して確認し、同梱版だけを根拠にしない。

7. 読み取り役割だけを持つ定義にサーバーが付いたときだけ、実行中の Agent 自身のツール一覧から、そのサーバーの編集・書き込み・削除など外部状態を変えるツールを列挙する。読み取り・検索・解析だけのツールは除外する。`disallowedTools` に入れる案を提示して確認を取り、追加・削除を受け付ける。該当する定義が複数あっても、denylist はツール名の集合なので 1 回にまとめて聞く。

   denylist は列挙漏れを許可する方式である。漏れた編集系ツールは読み取り役割から使えてしまうことを明示する。確定した denylist は、サーバーが付いた全定義へ `--mcp-deny` で渡す。

### ステップ 6: 生成

1 回のコマンドに渡した `--mcp-servers` / `--mcp-deny` は、そのコマンドが生成する全定義へ同じ内容で適用される。MCP を選ばなかったときは、ステップ 5 で「このまま全部作る」を選んだモデルと、個別調整しなかったモデルを、従来どおり 1 回の一括生成で保持マージする。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --policy <policy-id> --lang <lang> --models <model-id,...> --dir "$PWD"
```

MCP を選んだときは、付与するサーバーと denylist が同じモデルをグループに分け、グループごとに `--write` を発行する。付与内容が異なるモデルを同じ `--models` に含めてはならない。MCP を付けないモデルのグループでは `--mcp-servers` と `--mcp-deny` を省く。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --policy <policy-id> --lang <lang> --models <same-mcp-model-id,...> --mcp-servers <server,...> --mcp-deny <tool,...> --dir "$PWD"
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --policy <policy-id> --lang <lang> --models <model-id-without-mcp,...> --dir "$PWD"
```

個別調整したモデルは、モデルごとに選んだ差分方針と、その定義に決めた MCP の付与内容を使って生成する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write [--merge] --policy <policy-id> --model-id <model-id> --lang <lang> --name <name> --model <model-value> --roles <role-id,...> [--keep <selector> ...] [--mcp-servers <server,...>] [--mcp-deny <tool,...>] --dir "$PWD"
```

`--keep` は `--models` と併用できない。`--keep` を選んだ場合は必ず個別コマンドで実行する。各書き込みの `results` を保存し、次の報告に使う。

### ステップ 7: 報告

すべての書き込み応答の `results` から、次を報告する。

- 生成した `target` のパス
- 各定義の `action`、`kept`、`discarded`、`keptNeedsReview`
- `mcpDropped`。再検証で落としたサーバーがあれば、tools へ入らなかったこと
- ステップ 3 で除外したベンダーと、適用するフォールバック規定
- 方針の読み込ませ方。ステップ 1 で保持した `injected` と、選んだポリシーの `id` を突き合わせ、次の 3 通りに分ける。

  - `injected` が null のとき。CLAUDE.md への追記文例を出す。自動では追記しない。

    > - 最初に必ず `agent-policy:<policy-id>` スキルを使用し、この規律に従う。

  - `injected` が選んだ `id` と一致するとき。CLAUDE.md への追記は要らない。SessionStart フックが同じ方針を注入していることだけを伝える。
  - `injected` が選んだ `id` と食い違うとき。フックは `injected` の方針を注入し続けるが、生成した定義は選んだポリシーに沿っている。担当表と役割マーカーがずれることを警告し、`AMATSUKA_AGENT_AUTO_INJECTION` を選んだポリシーの `injection` へ変えるか、CLAUDE.md へ上の 1 行を足すかを選ばせる。

- `.claude/agents/` を git 追跡するかはプロジェクトの判断であること
- `.claude/agents/` ディレクトリを新規作成した初回だけ、Claude Code に読み込ませるため再起動が必要であること
