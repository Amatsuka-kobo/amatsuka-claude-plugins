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
- 各 CLI 応答の `ok` が `false` なら、`error` を報告してその処理を止める。
- 例外は次の 2 つだけである。どちらも `ok: false` を返したら、定義名と `error` を控えてウィザードを続ける。控えた内容は、対話モードではステップ 7、非対話モードでは手順 5 で報告する。
  - ステップ 1b と非対話モード手順 3 の `--prune-tools` / `--rewrite-roles`
  - ステップ 5n と 6 の 1 定義ごとの `--write`(失敗した定義を飛ばし、残りの定義の生成を続ける)
- `--scope` / `--lang` は、各コマンド例に書かれたコマンドにだけ渡す。
- `AskUserQuestion` は 1 回ずつ呼び、前の回答を受け取ってから次を呼ぶ。1 つのメッセージで複数回呼ばない。
- 生成・差分確認の応答は、単一モデルでも必ず `results` 配列で読む。生成・差分確認では `warnings` も読む。
- `AskUserQuestion` は 1 問につき選択肢を 2〜4 個しか受け付けない。すべての選択で次を守る。

  | 候補数 | 扱い |
  | --- | --- |
  | 0 件 | 質問せず、候補がないことを報告して次へ進む。 |
  | 1 件 | `AskUserQuestion` を使わず、「これを使うか」を通常の確認文で尋ねる。 |
  | 2〜4 件 | 1 回の `AskUserQuestion` で尋ねる。 |
  | 5 件以上(複数選択) | 配列の並び順のままページに分け、各ページを候補 1〜3 件にする(5 件なら 3 件と 2 件)。各ページの末尾に「このページでは選ばない」を置く。各質問に `(1/2)` のような通し番号を付ける。 |
  | 5 件以上(単一選択) | ページに分けない。モデル ID の選択は、5n の手順 1 の 2 問の手順で絞る。 |

単一選択の `AskUserQuestion` は 1 ページ目で選んだ時点で終わり、次のページへ進めないため、ページ分けは複数選択にだけ当てる。

- 表の候補数は、ページに分ける前の数で引く。分けた後のページは 1 件の行に当てず、どのページも `AskUserQuestion` で出す。
- ページに分けたときは、すべてのページを順に出す。Other で残りを選ばせない。
- 質問文で次のページを案内するときは、実際の分け方(ページ数と各ページの件数)と一致させる。

- ツール呼び出しより前に書いた本文は、利用者に表示されないことがある。質問の前提になる表は `AskUserQuestion` の中に入れる。
  - 短い表は `question` 本文に、長い表は各選択肢の `preview` に、Markdown の表で入れる。`preview` に入れるときは、全選択肢に同じ表を入れる。
  - 質問文は、質問の中だけで読めるように書き、「上の表」「上の案」のように質問の外の本文を指さない。
  - 質問をせずに表だけ示す報告は、ターン末尾の本文に置く。

- 選択の結果が空になりうるときは、「付与しない」「作らない」「再生成しない」に相当する選択肢を明示して置く。`AskUserQuestion` は空の選択を受け付けないため、この選択肢が無いと、何も選ばないという意思を利用者が表せない。
  - 推奨や既定の候補を先頭に置く。
  - 空の選択に当たる選択肢は、候補の最後に必ず置く。
  - 候補数には、空の選択肢も含めて数える。
  - ステップ 5 の調整する定義の選択、5n と 5c の MCP のように、複数選択の前に単一選択で空の選択を聞けるときは、複数選択に空の選択肢を置かない。
- 複数選択をページに分けるときは、全体を空にする選択肢を置かず、各ページの末尾に「このページでは選ばない」を置く。
  - 「このページでは選ばない」はそのページだけに効き、前のページの選択を取り消さない。質問文にもそう書く。
  - すべてのページで「このページでは選ばない」が選ばれたら、その質問の回答は空とする。空の回答の扱いは各ステップに従う。

## 非対話モード

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従い、対話モードの質問は一切しない。推奨構成を役割ごとに 1 定義ずつ保持マージ生成する。

`$ARGUMENTS` に `--scope claude` または `--scope custom` があればそれを使う。無ければ `AMATSUKA_AGENT_AUTO_INJECTION` から決める(`custom` 系なら `custom`、それ以外は `claude`)。

1. live models を照会する。応答の `ok` と `reason` を保持する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-live-models --scope <claude|custom> --dir "$PWD"
   ```

2. 会話の使用言語から決めた `lang` を使う。`lang` が `ja` / `en` 以外なら、翻訳断片の状態を確認する。`missing` または `stale` があれば、質問や scaffold をせず、対話モードで翻訳を準備するよう案内してエラーで終了する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check-fragments --lang <lang> --dir "$PWD"
   ```

3. 既存定義を点検し、役割に許可されていないツールを外す。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --scope <claude|custom> --dir "$PWD"
   ```

   応答の `definitions` のうち、`toolsFormat` が `csv` で `retiredRoles` が空の定義について、`disallowedTools` から `*` を除いたツールを外す。外すツールが無い定義には `--prune-tools` を実行しない。`--name` には `file` のファイル名から `.md` を除いた値を渡す。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --prune-tools --name <file の名前> --tools <tool,...> --dir "$PWD"
   ```

   `disallowedTools` が `*` だけの定義、`toolsFormat` が `other` の定義、`retiredRoles` を持つ定義は変更しない。

4. 次のコマンドで、役割ごとの推奨モデル定義を保持マージ生成する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --recommended --scope <claude|custom> --lang <lang> --dir "$PWD"
   ```

   custom の照会成功時は、各役割の推奨候補を順に調べ、live にエイリアスがある最初のモデルを採る。エイリアスは CLI が部分一致で判定するので、既定エイリアスと名前が違っても当たる。Claude のモデルは必ず実在するため、最初の Claude モデルで採用を止める。照会に失敗したときは各役割の先頭候補を採り、`warnings` に実在検証なしの警告が入る。

   1 つのモデル ID に live のエイリアスが複数当たったときは、CLI が推奨の印の付いた 1 つを `model` に使い、選ばなかったエイリアスを `warnings` に載せる。

   `--scope claude` では Claude の役割モデルを使い、live models の照会は生成時に行わない。

   その構成で役割を被覆する既存定義がちょうど 1 件あれば、CLI はその定義を作成先にして再生成する。被覆する定義が 2 件以上ある役割、`model` からモデル ID を引けない定義、廃止済みか未知の役割 ID を持つ定義、`agent-policy-vendor` が未知の値の定義は生成せず、`warnings` に載る。生成しなかった定義の役割は、既定名でも作らない。`--replace` は渡さず、既存の description と前置きはすべて保持する。

   `--mcp-servers` は渡さない。既存定義を作成先にする定義は、既存の MCP サーバーと `disallowedTools` を CLI が引き継ぐ。新規生成の定義には MCP を付けない。

5. 結果を報告する。全文の差分は載せない。手順 4 の `results` から、再生成した定義ごとに次を並べる。

   - `tools` 行の変更前と変更後。手順 3 で `--prune-tools` を実行した定義は 2 行に分け、1 行にまとめない。
     - 1 行目: `--prune-tools` の応答の `toolsBefore` → `toolsAfter`
     - 2 行目: 手順 4 の再生成の `toolsBefore` → `toolsAfter`
   - `--prune-tools` を実行しなかった定義は、手順 4 の `toolsBefore` → `toolsAfter` を 1 行で書く。
   - 再生成で外れた MCP サーバー。接続の再検証で落ちたもの(`mcpDropped`)
   - `description` と `preamble` の状態。`templateChanged` の定義には、対話モードで再実行すればテンプレートに置き換えられると案内する。

   手順 3 と 4 について次を並べ、対話モードでの再実行を案内する。

   - 外したツールと定義名
   - 変更しなかった定義と、その理由(全ツール継承・未対応の `tools` 書式・廃止済みか未知の役割 ID を持つ・操作に失敗・同じ役割を 2 件以上の定義が被覆する・モデル ID を引けない・`agent-policy-vendor` が未知の値)
   - 廃止済み役割と後継
   - 複数のエイリアスが当たったモデル ID と、使ったエイリアス・選ばなかったエイリアス(手順 4 の `warnings`)
   - `ok: false` になった操作の定義名と `error`
   - live models の照会が失敗したときは、その `reason` と、外部モデルの定義に実在の保証が無いこと

## 対話モード

`$ARGUMENTS` に `--yes` が含まれないときは、次を順に実施する。

### ステップ 0: 言語判定

会話でユーザーが使用している言語から `lang` を決める。会話が複数言語なら直近のユーザー発話の言語を採る。

### ステップ 0b: 構成の選択

`$ARGUMENTS` に `--scope claude` または `--scope custom` があれば、この質問を省いてその値を使う。

無ければ、`AskUserQuestion` を 1 回だけ使い、次の 2 択で構成を決める。選んだ値は `--scope <claude|custom>` として渡す。

- **Claude のみ**(`--scope claude`)—— Claude のモデル(`sonnet` / `opus` / `haiku` / `fable`)だけを候補にする。プロキシは要らない。
- **カスタム**(`--scope custom`)—— 外部ベンダーのモデルも候補に含める。ローカルプロキシの `/v1/models` に実在するモデルから選ぶ。

同じ質問の中で「表示と生成には `<lang>` を使う」ことを伝え、変更の機会も与える。

質問を組み立てる前に、既存の役割マーカー付き定義を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --scope claude --dir "$PWD"
```

応答の `modelBreakdown` の `claude` と `external` の合計が 1 以上なら、その値をそのまま「Claude のモデル <claude> 件、外部ベンダー <external> 件」の形で質問文に書く。<> の中は実際の値に置き換える。定義を自分で数え直さない。合計が 0 なら、内訳は書かない。

### ステップ 1: live models の照会

`--scope claude` のときは `--list-live-models` を実行しない。ステップ 1b と 2 は通常どおり進め、ステップ 3 だけを飛ばす。以下は `--scope custom` の手順である。

live models を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-live-models --scope <claude|custom> --dir "$PWD"
```

この応答の `ok` / `reason` を保持し、照会が成功したかどうかだけを決める。モデル候補はここで組み立てない。候補は 5n と 5b で、`--list-coverage` の `candidates` を使う。

- `ok: false` のときは、「プロキシ未検出または照会失敗(`<reason>`)のため実在の確認ができない。定義は作れるが実在は保証されない」と明示して続行する。

### ステップ 1b: 既存定義の点検と被覆確認

`--list-coverage` にも `--scope` を渡す。`--scope claude` では、外部ベンダーのモデルを指定した既存定義は被覆に数えない。GPT / Grok の定義で埋まっている役割も未カバーとして現れる。

推奨の役割集合が、プロジェクトの既存定義でどこまで埋まっているかを取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-coverage --lang <lang> --scope <claude|custom> --dir "$PWD"
```

この応答の `roles` は `RECOMMENDED` の全 RoleId を対象にし、各要素は `id`、`label`、`kind`(`impl` / `readonly`)、`defaultName`、`candidates`(`modelId`・`model`・`recommended`)、`coveredBy` を返す。`uncovered` は `coveredBy` が空の役割だけである。

`definitions` は、`agent-policy-role` を持つ全定義の点検結果である。`--scope` では絞られない。各要素は次を持つ。

- `name`、`file`(プロジェクトルート相対)、`model`、`vendor`
- `modelId`: `model` から引いたモデル ID。引けないときは `null`
- `roles`: マーカーのうち、役割として解決できる ID
- `retiredRoles`: マーカーのうち廃止済みの ID と、書き換え先の組 `{ id, replacement }`。`replacement` が `null` なら後継は無い。
- `unknownRoles`: マーカーのうち、廃止済みでも役割として解決できるものでもない ID
- `disallowedTools`: 役割に許可されていない組み込みツール。`*` は `tools` 欄が無く、全ツールを継承していることを表す。
- `toolsFormat`: `csv`(1 行のカンマ区切り)、`other`(1 行に特定できない・block 配列・flow 配列・引用符や括弧や `#` を含む)、`none`(欄が無い)

#### 点検

被覆の有無にかかわらず、点検を先に行う。`retiredRoles` と `disallowedTools` がともに空の定義は扱わない。扱う定義が無ければ「被覆確認」へ進む。

1. 扱う定義を、`file` のファイル名の昇順に並べる。
2. 定義ごとに、`retiredRoles` → `disallowedTools` の順で別々の質問を出す。質問は 1 で並べた定義の順に出す。1 回の `AskUserQuestion` には 4 問まで入るので、質問を 4 問ずつまとめてよい。
   - 各質問には、その質問が扱う定義の 1 行を「定義 / 廃止済み役割と後継 / 許可されていないツール」の表にして入れる。
   - `retiredRoles` は定義ごとに 1 問とし、「廃止 ID を外す(推奨)」「このまま残す」の 2 択で聞く。質問文には後継の役割を書く。後継が未カバーなら、被覆確認の後に新規生成で作ると添える。後継が無い ID は、後継が無いと書く。`unknownRoles` があれば、それもマーカーから落ちると質問文に書く。
   - `disallowedTools` はツールごとに 1 問とし、「削除する(推奨)」「残す」の 2 択で聞く。`*` のときは「役割の既定ツールに絞る(推奨)」「全ツール継承のまま残す」の 2 択にする。
   - `toolsFormat` が `other` の定義には、ツールの質問を出さない。
3. 回答が出そろったら、変更を選んだ定義にその場で操作を実行する。`--name` には `file` のファイル名から `.md` を除いた値を渡す。同じ定義に両方を実行するときは、`--prune-tools` を先に、`--rewrite-roles` を後に実行する。
   - 削除または絞り込みを選んだツールは、定義ごとにまとめて外す。`*` の絞り込みには `--tools "*"` を渡す。

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --prune-tools --name <file の名前> --tools <tool,...> --dir "$PWD"
     ```

   - 「廃止 ID を外す」を選んだ定義は、`roles` だけを残した並びでマーカー行を書き換える。`roles` が空なら `--roles ""` を渡し、マーカー行を消す。

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --rewrite-roles --name <file の名前> --roles <roles をカンマ区切り> --dir "$PWD"
     ```

   - 両コマンドには `--scope` と `--lang` を渡さない(CLI が受け付けない)。
   - マーカー行を消した定義は、委譲先の候補から外れる。
   - 応答の `warnings` は控え、ステップ 7 で報告する。
4. 操作を 1 つでも実行したときは、同じ `--lang` と `--scope` で `--list-coverage` を取り直し、その結果で被覆確認に進む。

#### 被覆確認

すべての役割の `coveredBy` が空なら、既存定義が無いということである。何も聞かずステップ 2 へ進む。

1 つでも `coveredBy` が空でないときは、「役割 / 推奨モデル / 既存定義」の表を入れた質問で、次を聞く。

- `uncovered` が空でないときは 3 択とする。

  1. 未カバーの役割だけ作る(推奨)
  2. すべての役割の定義を確認し直す
  3. 中止する

- `uncovered` が空のときは 2 択とする。

  1. すべての役割の定義を確認し直す
  2. 中止する

「未カバーの役割だけ作る」を選ばれたときは、以降の対象役割を `uncovered` に絞る。ステップ 4 の `--check` に `--roles <uncovered…>` を付け、以降のステップはその役割だけを扱う。

「すべての役割の定義を確認し直す」を選ばれたときは、全 RoleId を対象にステップ 2 へ進む。「中止する」を選ばれたときは、生成せずに終える。ステップ 1b の点検で操作を実行していれば、その結果だけをステップ 7 の形式で報告する。

### ステップ 2: 翻訳断片の準備

`lang` が `ja` または `en` なら、このステップを飛ばす。それ以外では次を行う。

1. 翻訳断片の状態を取得する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check-fragments --lang <lang> --dir "$PWD"
   ```

2. `missing` と `stale` がともに空なら次へ進む。どちらかがあれば、`--scaffold-fragments` を実行する前に、`stale` の既存訳があれば退避するよう促す。scaffold は stale のファイルを英語ソースで上書きするため、既存の訳は失われる。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --scaffold-fragments --lang <lang> --dir "$PWD"
   ```

3. 応答の `written` にある各ファイルを `Edit` で翻訳する。翻訳するのは本文と frontmatter の `label` / `description` だけである。`id` / `kind` / `tools` / `source-lang` / `source-hash` は変更しない。節見出しは英語のまま保つ。合成器は見出しで節を突き合わせるためである。
4. 状態確認を再実行し、`missing` と `stale` が空になったことを確認する。空でない場合は生成へ進まない。

### ステップ 3: 照会結果の確認

ステップ 1 の `--list-live-models` がプロキシ前提確認を兼ねる。別の検証コマンドの実行は求めない。

- `ok: false` のときは、`reason` を示し、外部モデルの生成物は実在保証を持たないことを再度伝える。後続の `--write` / `--check` は、照会失敗を `warnings` に入れて検証なしで続行する。

### ステップ 4: 推奨定義の確認

`--scope claude` では Claude 用の割り当てを使い、custom では `RECOMMENDED` を使う。次のコマンドで生成対象の差分を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --recommended --scope <claude|custom> --lang <lang> --dir "$PWD"
```

新規生成と再生成は、ステップ 1b で最後に取った `--list-coverage` で振り分ける。

- 新規生成: `coveredBy` が空の役割。作成先は既定名である。
- 再生成: `coveredBy` にある既存定義。役割ではなく定義を単位にし、複数の役割を持つ定義は 1 回だけ扱う。`coveredBy` の名前は `definitions[].name` と突き合わせ、`file`・`model`・`modelId`・`vendor`・`roles` を引く。

`results` のうち再生成の定義を、`定義 / 役割 / 採用モデル / 既存状態と差分 / description / 前置き` の表にする。定義は `target`、採用モデルは `modelId`、description と前置きの列は `description` と `preamble` の状態から読み取る。`exists` / `identical` と差分を示す。新規生成の役割は差分が無いので、表に載せない。

次の再生成の定義は `results` に現れず、`warnings` に載る。定義ごとに扱いを決める。

- 1 つの役割を 2 件以上の定義が被覆する: どの定義を再生成するか、または再生成しないかを `AskUserQuestion` で聞く。選択肢は被覆する定義と「再生成しない」とする。候補の定義の表(名前・`model`・`roles`)を質問の中に入れる。
- `modelId` が `null`: ステップ 5b でモデル ID を聞いてから再生成する。
- `--scope custom` で live 照会が成功し、`model` が live に無い: 再生成せず、ステップ 7 で報告する。`warnings` に同じモデルの live のエイリアスが載っていれば、書き換え先の候補として報告に添える。
- `retiredRoles` か `unknownRoles` が残っている: 作り直すとそれらの ID がマーカーから落ちるため、再生成せず、ステップ 7 で報告する。その定義が被覆する役割は、新規生成もしない。ステップ 1b で「廃止 ID を外す」を選んで外し終えた定義は、ここに当たらず再生成してよい。
- `agent-policy-vendor` が未知の値: 再生成せず、ステップ 7 で報告する。

生成する定義の frontmatter には、役割とモデルの組に応じた `effort` が入り、組に対応する値が無いときは入らない。値は CLI が決めるので、表には書かない。

再生成の対象は、振り分けで決まった定義をすべて含む。description と前置きが既存とテンプレートで違うことは、対象から外す理由にせず、ステップ 5 の質問で扱う。対象から外せるのは、次の場合に限る。

- 被覆が 2 件以上の役割で、選ばれなかった定義
- 廃止済みか未知の役割 ID が残っている定義
- `modelId` が `null` で、5b で「再生成しない」が選ばれた定義
- `model` が live に無い定義
- `agent-policy-vendor` が未知の値の定義

新規生成の役割はステップ 5n、再生成の定義はステップ 5〜6 で扱う。ステップ 4b の後、5n、5、5b、5c、6 の順に進む。

### ステップ 4b: MCP サーバーの選択

ステップ 5n と 5c は、ここで選んだサーバーを使う。接続済みサーバーを取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-mcp --dir "$PWD"
```

`--list-mcp` が失敗した場合、または `servers` が 0 件なら、何も質問せず、ステップ 5n の MCP の質問を省く。成功したときは、次を順に行う。

1. ステップ 4 の `mcpCurrent` を、既存定義から読み戻した既定値として扱う。既存定義がなければ空である。
2. `usable: true` のサーバーだけを、名前と status を添えて選択肢にする。プラグイン側の既定は「付けない」だが、`mcpCurrent` があればそれを既定にする。サーバーの選択には候補数の共通規則を適用し、「どのサーバーも使わない」を最後の選択肢に置く。ページに分けるときは「どのサーバーも使わない」を置かず、回答が空になったときを「どのサーバーも使わない」として扱う。
3. 「どのサーバーも使わない」が選ばれたら、ステップ 5n の MCP の質問を省く。この選択は新規生成にだけ効く。再生成する定義は、5c の既定(その定義の `mcpCurrent`)で既存の MCP を残す。

### ステップ 5n: 新規生成

対象は、ステップ 4 で新規生成に振り分けた役割である。0 件なら、このステップを飛ばす。

役割を 1 つずつ、次の 1〜4 を最後まで処理してから、次の役割へ進む。モデル ID・定義名・MCP は、それぞれ別の `AskUserQuestion` 呼び出しで、前の回答を受け取ってから聞く。複数の役割をまとめて決める選択肢(「推奨をそのまま使う」「既定で全部作る」「全役割に付与」など)は出さない。`--recommended` と `--merge` は使わない。役割の kind(`impl` / `readonly`)は、`--list-coverage` の `roles[].kind` で判定する。

1. モデル ID を聞く。候補は、ステップ 1b で最後に取った `--list-coverage` の、その役割の `candidates` をそのまま使う。
   - 候補を自分で組み立てず、足したり除いたりせず、並び順も変えない。
   - `recommended` が `true` の候補に推奨の印を付ける。
   - 各選択肢には `modelId` とエイリアス名(`model`)を示す。同じ `modelId` の候補が複数あっても 1 つにまとめない。選ばれた候補の `model` を、手順 4 の `--model` にそのまま渡す。
   - 選択肢の数は「この役割は作らない」と候補を合わせて数える。
   - 4 件以内なら、1 問で聞く。推奨の候補を先頭に、「この役割は作らない」を最後に置く。
   - 4 件を超えるときは、2 問に分ける。2 問は別々の `AskUserQuestion` 呼び出しにし、1 問目の回答を受け取ってから 2 問目を出す。
     - 1 問目: 推奨の候補(推奨の順に最大 2 件)/「その他のモデル」/「この役割は作らない」の順に並べる。
     - 2 問目: 1 問目で「その他のモデル」が選ばれたときだけ出す。1 問目に出さなかった残りの候補を、推奨のものを先にして並べる。
     - 2 問目の候補が 4 件を超えるときは、先に「Claude のモデル」「外部ベンダーのモデル」の 2 択を聞き、選ばれた側の候補から選ばせる。
   - 選択肢は、この手順で決めたものだけを出す。「次ページ」「このページからは選ばない」のような選択肢を足さず、Other で次へ進ませず、この手順の 2 問目で残りを聞く。
   - 「この役割は作らない」が選ばれたら、この役割の 2〜4 を聞かずに次の役割へ進み、ステップ 7 で報告する。
   - 質問はこの役割だけを対象にし、他の役割の確認を同じ質問に入れない。

2. 定義名を「既定名を使う」「別の名前を指定する」の 2 択で必ず尋ね、後者は自由入力で受ける。既定名は `<model-id>-<defaultName>` である。自由入力が `^[a-z0-9]+(?:-[a-z0-9]+)*$` に合わなければ聞き直す。

3. MCP サーバーを聞く。ステップ 4b で `servers` が 1 つ以上あり、「どのサーバーも使わない」が選ばれていないときだけ行う。

   - 先に単一選択で「既定のサーバーを付ける(推奨)」「選ぶ」「付与しない」の 3 択を聞く。既定のサーバーは、kind を問わず 4b で選んだ全サーバーである。質問文に既定のサーバー名を書く。
   - 「選ぶ」が選ばれたときだけ、続けて別の呼び出しで、付与するサーバーを複数選択で聞く。選択肢は 4b で選んだサーバーに限り、候補数の共通規則(複数選択のページ分け)に従う。空の選択肢は置かない。ページ分けで回答が空になったら、「付与しない」と同じに扱う。
   - 選んだサーバーが、適用される `_common.md` の制約と矛盾しないことを確認する。プロジェクト側の `_common.md` があれば優先し、同梱版だけを根拠にしない。
   - readonly の役割にサーバーが付くときは、書き込み系ツールの denylist を確定させる。書き込み系ツールは、ファイル・リポジトリ・外部サービスの状態を変えるツールを指す。実行中の Agent 自身のツール一覧から、付与するサーバーの書き込み系ツールを列挙する。読み取り・検索・解析のツールは含めない。サーバーの選択の回答を受け取った後に、`disallowedTools` に入れる案を、サーバーの選択とは別の `AskUserQuestion` 呼び出しで確認する。同じサーバー集合で確定済みの denylist があれば、聞き直さずに使う。
   - denylist は列挙漏れを許可する方式である。確認の質問文には、次の文をそのまま入れる。

     > 一覧に無い書き込み系ツールは、読み取り専用の役割からも使えます。

   - 利用者が denylist の確定を拒んだ readonly の役割には、サーバーを付けない。

4. この 1 役割だけを対象にした個別コマンドで生成する。`--recommended` と `--merge` は付けない。

   - モデル値が `candidates` の `model` に無い場合、またはベンダーが `unknown` の場合は、ベンダーを確定する。候補は `gpt` / `grok` / `claude` / 「どれでもない」(`none`) の 4 値とする。既知ベンダーは推定値を示して確認し、変更を望む場合に 4 値から選ばせる。ベンダーが `none` なら `--vendor none` を渡す。`--vendor` は、ここでベンダーを確定したときだけ渡す。
   - MCP の引数は、impl の役割にサーバーが付くときは `--mcp-servers` だけを渡す。readonly の役割にサーバーが付くときは、`--mcp-servers` と `--mcp-deny` の両方を渡す。

   まず生成対象を確認する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --check --model-id <model-id> --lang <lang> --name <name> --model <model-value> --roles <この 1 役割> [--vendor <gpt|grok|claude|none>] --scope <claude|custom> --dir "$PWD"
   ```

   確認後に生成する。

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --model-id <model-id> --name <name> --model <model-value> --roles <この 1 役割> [--vendor <gpt|grok|claude|none>] [--mcp-servers <server,...>] [--mcp-deny <tool,...>] --scope <claude|custom> --lang <lang> --dir "$PWD"
   ```

### ステップ 5: 再生成の生成範囲の確認

再生成の定義が 0 件なら、このステップを飛ばす。

再生成の定義について、次の 3 択を `AskUserQuestion` で尋ねる。ステップ 4 の差分の表を、この質問に入れる。

1. このまま全部作る
2. 一部の定義を調整する
3. 中止する

一部調整を選んだ場合は、調整する定義を候補数の共通規則に従って選ばせ、選んだ定義をステップ 5b の対象にする。3 択で調整を選んでいるので、空の選択肢は置かない。ページ分けで回答が空になったら、「このまま全部作る」と同じに扱う。

「中止する」を選んだ場合は、再生成しない。ステップ 5n で生成した定義は残る(CLI に取り消しの操作は無い)。ステップ 7 へ進み、生成した定義と再生成しなかった定義を報告する。

「中止する」以外が選ばれたら、再生成する定義ごとに description と前置きの扱いを状態で決める。この質問は 3 択の直後に出し、すべて聞き終えてからステップ 5b、5c へ進む。決めた置き換えは、ステップ 6 の `--replace` に渡す。

- `same`: 質問しない。
- `templateChanged`: 「テンプレートに置き換える(推奨)」「保持する」の 2 択で聞く。
- `unknown`: 既存とテンプレートの両方を選択肢の preview に示し、「保持する」「テンプレートに置き換える」の 2 択で聞く。推奨は付けない。description の両方の値は `frontmatter.changed` の `description` から、前置きの両方の本文は `preambleTexts` から読み取る。
- `userEdited`: 質問せずに保持し、ステップ 7 で報告する。

どの経路で再生成する定義も、再生成の前に状態を確かめて上の質問を出す。

- ステップ 4 の `results` にある定義は、3 択の直後に聞く。
- 5b だけで再生成する定義(`modelId` が `null` の定義)は、5b でモデル ID を選んだ後に、選んだモデルで `--check` を実行し、その結果で状態を確かめてから聞く。モデル ID を選ぶ前に `--check` を実行しない。

### ステップ 5b: 再生成の定義の個別調整

ステップ 5 で調整を選んだ定義と、`modelId` が `null` の定義が 0 件なら、このステップを飛ばす。

定義を 1 つずつ、次の順で処理する。定義名は既存のファイル名のまま変えない。

1. モデル ID を、5n の 1 の手順と候補で尋ねる。1 問か 2 問かの分け方も 5n の 1 に従う。
   - `modelId` が `null` の定義(どのモデル ID にも当たらないエイリアス、`inherit`、`model` 欄なし)では、5n の「この役割は作らない」の位置に「再生成しない」を置き、選択肢の数に含める。選ばれたら、その定義をステップ 7 で報告する。
   - `modelId` が `null` でない定義では、空の選択肢を置かない。
   - `modelId` が `null` の定義の質問文には、「この定義の model は <元の値、または未設定> から <選んだ候補の `model`> に変わる」と書く。<> の中は実際の値に置き換える。
2. ベンダーを、5n の 4 の条件で確定する。
3. 差分方針を、保持マージ、選択した項目の保持、完全上書き、スキップから尋ねる。保持対象を選ぶ場合は `--keep` を個別コマンドに渡す。`modelId` が `null` だけが理由の定義では、差分方針を尋ねず保持マージにする。

調整する定義の役割に impl と readonly の両方が含まれる場合だけ、kind 混在を警告して続行確認を取る。既定は続行しない。

確認は、ステップ 6 のコマンドの `--write` を `--check` に替え、`--merge` と `--replace` を外して行う。`--check` に `--merge` を付けると `merge: requires --write` で、`--replace` を付けると `replace: requires --merge` で CLI が止まる。`--keep` は `--check` でも使えるので外さない。

### ステップ 5c: 再生成の定義への MCP の付与

再生成の定義が 0 件のときは、このステップを飛ばす。ステップ 4b で MCP の質問を省いたとき(「どのサーバーも使わない」が選ばれた、またはサーバーが取れなかった)は、`mcpCurrent` を持つ定義にだけ聞き、1 件も無ければ飛ばす。

各定義の `mcpCurrent` はステップ 4 の `results` から読み、`results` に無い定義は 5b の `--check` の結果から読む。

1. 定義ごとに 1 回ずつ、別の `AskUserQuestion` 呼び出しで、単一選択の「既存のまま(推奨)」「変更する」「付与しない」の 3 択を聞く。質問文に、その定義の `mcpCurrent` のサーバー名(無ければ「MCP なし」)を書く。
   - 役割の kind や `mcpCurrent` の有無にかかわらず、選択肢は常にこの 3 つにする。
   - この質問は MCP の付与だけを対象にし、denylist などほかの確認は 4 で別に聞く。
   - 「既存のまま」: `mcpCurrent` のサーバーを付ける。MCP の無い定義は MCP なしのままにする。
   - 「付与しない」: サーバーを付けない。
2. 「変更する」が選ばれたときだけ、続けて別の呼び出しで、付与するサーバーを複数選択で聞く。選択肢は 4b で選んだサーバーとその定義の `mcpCurrent` のサーバーとし、候補数の共通規則(複数選択のページ分け)に従う。空の選択肢は置かない。ページ分けで回答が空になったら、「付与しない」と同じに扱う。
3. 各サーバーが `_common.md` の制約と矛盾しないことを、5n の 3 の手順で確認する。
4. readonly の役割を 1 つでも持つ定義にサーバーが付くときは、1〜3 の回答を受け取った後に、別の `AskUserQuestion` 呼び出しで、5n の 3 の手順で denylist を確定させる。denylist は該当する定義間で 1 回にまとめて聞く。

### ステップ 6: 再生成の生成

再生成の定義が 0 件なら、このステップを飛ばす。

定義ごとに次の個別コマンドで保持マージ生成する。`--recommended` は使わない。複数の役割を持つ定義も 1 回だけ実行する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --model-id <modelId> --name <file の名前> --model <model 値> --roles <定義の roles> [--vendor <vendor>] [--mcp-servers <server,...>] [--mcp-deny <tool,...>] [--replace <description,preamble>] --scope <claude|custom> --lang <lang> --dir "$PWD"
```

- `--model-id` には、定義の `modelId` か、ステップ 5b で決めたモデル ID を渡す。
- `--replace` には、ステップ 5 でテンプレートに置き換えると決めたもの(`description` / `preamble`)だけを渡す。渡さなかったものは、`same` 以外なら既存のまま保持される。
- `--model` には、定義の `model` を渡す。ステップ 5b でモデル ID を選んだ定義では、定義の元の値ではなく、選んだ候補の `model`(5n の 1)を渡す。
- `--name` には、`file` のファイル名から `.md` を除いた値を渡す。
- `--vendor` には、ステップ 5b でベンダーを確定したときはその値を渡す。確定していないときは、定義の `vendor` があればその値を、無ければ `none` を渡す。
- ステップ 5b で差分方針を決めた定義は、`--merge` と `--keep` をその方針に合わせる。
- MCP の引数は次に従う。保持マージは `disallowedTools` を保持しないため、再生成のたびに渡す。
  - impl の役割だけを持つ定義: サーバーが付くときは `--mcp-servers` だけを渡し、`--mcp-deny` は渡さない。
  - readonly の役割を 1 つでも持つ定義: サーバーが付くときは `--mcp-servers` と `--mcp-deny` を必ず両方渡す。

### ステップ 7: 報告

すべての書き込み応答の `results` から、次を報告する。

- 生成した `target` のパス
- ステップ 1b の点検の結果
  - 外したツールと、書き換えたマーカー(定義名ごと)
  - `toolsFormat` が `other` で質問しなかった定義。ファイルの絶対パスと、手で外すツール
  - マーカー行を消した定義。ファイルの絶対パスを示し、削除するかは利用者に委ねる
  - `ok: false` になった操作の定義名と `error`
  - 操作の応答にあった `warnings`
- 保持した description と前置き。`userEdited` で質問せずに保持したものは、そのことを書く。
- ステップ 4 と 5b で再生成しなかった定義と、その理由(再生成しないと選ばれた・`model` が live に無い・廃止済みか未知の役割 ID が残っている・`agent-policy-vendor` が未知の値・ステップ 5 で中止した)
- ステップ 5n で「作らない」と決めた役割があれば、その一覧と、次に setup-agents を実行したときに再び尋ねられること。この実行の中では聞き直さない。
- ステップ 5n と 6 の生成で `ok: false` になった役割と定義、その `error`
- 各定義の `action`、`kept`、`discarded`、`keptNeedsReview`
- `mcpDropped`。再検証で落としたサーバーがあれば、tools へ入らなかったこと
- 各応答の `warnings`
- モデル値とベンダーの確定方法。`agent-policy-vendor` を出力しない `none` の定義では、ベンダー断片を付けず色が blue になること
- 方針の読み込ませ方。`AMATSUKA_AGENT_AUTO_INJECTION` は trim と小文字化の後、`none` / `claude` / `custom` の 3 値で扱われる。

  - 未設定、空、または `none` のとき。自動注入はない。CLAUDE.md への追記文例は、選んだ構成に応じて出し分ける。自動では追記しない。

    - `--scope claude` のとき。

      > - 最初に `agent-policy:claude-model-policy` スキルを使用する。スキルの規律に従う。

    - `--scope custom` のとき。

      > - 最初に `agent-policy:custom-policy` スキルを使用する。スキルの規律に従う。

  - `claude` のとき。SessionStart フックは `claude-model-policy` と、Claude のモデルで実行される定義だけの役割マーカー対応表を注入する。`--scope claude` で生成した定義はそのまま対応表に載る。外部ベンダーの定義を委譲先に使うには、環境変数を `custom` へ変更する。
  - `custom` のとき。SessionStart フックは役割マーカー付き定義の `model` を検証する。すべて実在すれば custom プロファイルとマーカー対応表を注入する。照会失敗、実在しないモデル、または役割マーカー付き定義が 0 件なら、セッション全体で `claude-model-policy` へフォールバックすることを伝える。
  - 旧値 `with-codex` / `with-grok` / `with-codex-grok` のとき。custom として扱われるが、`custom` へ移行する通知が出る。環境変数を `custom` へ変更するよう案内する。
  - それ以外の値のとき。自動注入を行わない警告が出るため、`none` / `claude` / `custom` のいずれかへ変更するよう案内する。

- `.claude/agents/` を git 追跡するかはプロジェクトの判断であること
- `.claude/agents/` ディレクトリを新規作成した初回だけ、Claude Code に読み込ませるため再起動が必要であること
