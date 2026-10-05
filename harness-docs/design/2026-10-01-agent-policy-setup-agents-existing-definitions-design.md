# agent-policy setup-agents 既存定義の点検と新規生成の聞き取り 設計書

- 対象: `plugins/agent-policy`(0.21.2-dev のまま。バージョンは上げない)
- 状態: 承認済みの方針を設計に起こしたもの。理解レビュー 1 回と前提検証レビュー 2 回の指摘を反映済み。実装前

## 1. 要件

setup-agents を再実行したとき、既存の Agent 定義の不整合が利用者に知らされず、新規生成でも何も聞かれない。次の 5 点を直す。

- R1: 対話モードで定義を新規生成するときは、経路を問わず、対象の役割ごとにモデル・定義名・MCP を聞き取る。
- R2: どの経路でも、既存定義の点検を省かない。
- R3: 役割が許していない組み込みツール(`Agent` など MCP 以外)を、利用者に知らせずに残さない。
- R4: 廃止済みの役割 ID を宣言する定義に、対処を案内する。
- R5: readonly の役割にも、書き込みを行わない MCP ツールを既定で付与する。

受け入れ基準:

- A1: 対話モードで、生成先のファイルがまだ無い役割(新規生成)があるとき、どの経路を選んでも、その役割ごとにステップ 5b のモデル ID と定義名の質問が出る。MCP サーバーが 1 つ以上検出され、「どのサーバーも使わない」が選ばれなかったときは、その役割ごとにステップ 5c の MCP の質問も出る。
- A2: `tools` に `Agent` を持つ既存定義があるとき、どの経路を選んでも、被覆の有無にかかわらず、ステップ 1b でその定義名とツール名が示され、削除か保持かを聞かれる。廃止済み ID だけを持つ定義も対象に含む。
- A3: 削除を選ぶと、その定義の `tools` から当該ツールだけが消え、他の行はバイト単位で変わらない。保持を選ぶと残り、以降の保持マージでも残る。
- A4: `--yes`(非対話)では、3-6 で変更しないと定めた定義を除き、マーカー付きの定義から許されていないツールが外れ、定義名とツール名が報告に載る。変更しなかった定義も理由とともに報告に載る。
- A5: `agent-policy-role` に `final-review` を持つ定義があるとき、ステップ 1b で書き換え先 `complex-review` とともに示される。「廃止 ID を外す」を選ぶとマーカーから `final-review` が消え、`complex-review` は未カバーとして残って新規生成の対象になる。「このまま残す」を選ぶとマーカーは変わらない。
- A6: 対話モードで MCP サーバーを選ぶと、ステップ 5c の既定の配分に readonly の役割も含まれる。readonly の役割の定義には、選んだサーバーが `tools` に入り、確定した書き込み系ツールが `disallowedTools` に入る。impl の役割の定義には `disallowedTools` が入らない。

## 2. 現状

- 未カバー経路は、ステップ 1b の直後に `--check` / `--write --merge --recommended --roles <uncovered>` を実行してステップ 7 へ飛ぶ(`skills/setup-agents/SKILL.md` ステップ 1b 末尾)。ステップ 6b も「モデル ID や定義名を個別に尋ねない」と定める。
- ステップ 1b は、すべての役割の `coveredBy` が空なら質問せずにステップ 2 へ進む。
- 保持マージの自動保持 `automaticKeep`(`src/setup-agents.ts`)は、テンプレートに無い既存ツールのうち `mcp__` 以外をすべて保持する。`disallowedTools` キーは保持しない。
- 生成時のツール集合は `resolveToolsFor`(`src/agents/compose.ts`、未 export)が決める。役割断片の `tools` の和から `Agent` を除き、選んだ MCP サーバーを足す。
- `--list-coverage` は役割ごとの `coveredBy` と `uncovered` だけを返す。役割の `kind` は返さない。
- `parseDocument` / `render`(`src/setup-agents.ts`)は往復で空行・コメント・block 配列を落とす。`tools` の block 配列・flow 配列・引用符を解釈できるのは `frontmatter` / `parseToolsField`(`src/hooks/marker-scan.ts`)である。
- 廃止済み役割 ID の集合と書き換え先は、SessionStart の `RETIRED_ROLES` と `retiredRoleBlock` の文言にだけある。`roleLabel`(`marker-scan.ts`)は組み込みに無い ID をプロジェクトの断片の `label` で解決するので、`final-review.md` などが残っていると対応表に廃止 ID が載る。
- ステップ 5c-7 は確定した denylist を「サーバーが付いた全定義」へ渡すと書き、ステップ 6 は `--mcp-deny` を impl のコマンドに渡し、readonly のコマンドには `--mcp-servers` も渡していない。既定の配分は `complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` だけで、kind が impl の `e2e-verify` が漏れている。
- 個別生成コマンドの制約(前提検証レビューで確認):
  - `--scope claude` では、vendor が claude でない model-id と、enum(`sonnet` / `opus` / `haiku` / `fable`)以外の `--model` を拒否する。
  - custom で live 照会が成功しているとき、`--model` が live に無いと `--write` が失敗する。`--recommended` は live にいる最初の候補へ進むが、個別の `--model-id` は進まない。
  - live 照会が成功し、vendor が unknown のときは `--vendor` が必須になる。
  - `--list-roles --model-id` は model-id で役割を絞らない。
  - `--name` は `^[a-z0-9]+(?:-[a-z0-9]+)*$` だけを受け付ける。

## 3. 設計

### 3-1. 廃止済み役割の表を共有し、どこでも役割として解決しない

- `src/agents/roles.ts` に `RETIRED_ROLE_REPLACEMENTS: Record<string, RoleId | null>` を置く。値は書き換え先で、`null` は後継が無いことを表す。
  - `final-review` → `complex-review`
  - `gate-review` → `complex-review`
  - `design-plan` → `null`
  - `advisor` → `null`
- この表にある ID は、プロジェクトの `.claude/agent-policy/roles/` に同名の断片が残っていても、役割として解決しない。次の 3 か所で表を先に引く。
  - setup-agents の断片解決(`--list-coverage`・生成・`--rewrite-roles` の検証)
  - `roleLabel`(`marker-scan.ts`)。表にある ID は `undefined` を返し、対応表に載せない。
  - SessionStart の `RETIRED_ROLES`。この表のキーから作る。`retiredRoleBlock` の文面は固定のまま変えない。
- README の移行案内の項目 10(残った断片はプロジェクト独自の役割になる、という記述)を、「廃止済み ID の断片が残っていても役割として扱わない」に改める。

### 3-2. `--list-coverage` に定義単位の点検結果を足す

応答に 2 つを足す。既存の `roles` と `uncovered` の意味は変えない。

- `roles` の各要素に `kind`(`impl` / `readonly`)を足す。
- `definitions` 配列を足す。
  - 対象は `.claude/agents/` の定義のうち、`agent-policy-role` を持つものすべて。`--scope claude` でも外部ベンダーの定義を除かない。
  - 要素のフィールド:
    - `name`、`file`(プロジェクトルート相対)、`model`、`vendor`
    - `roles`: マーカーのうち、廃止済みでなく、組み込みまたはプロジェクト独自断片として解決できる ID
    - `retiredRoles`: マーカーのうち `RETIRED_ROLE_REPLACEMENTS` にある ID と書き換え先の組 `{ id, replacement }`
    - `disallowedTools`: 定義の `tools` のうち、`mcp__` で始まらず、許可集合に無いもの
    - `toolsFormat`: `tools` の書式。`"csv"`(1 行のカンマ区切り)、`"other"`(block 配列・flow 配列・引用符付き)、`"none"`(欄が無い)
  - `tools` の解釈には `parseToolsField` を使う。引用符は外してから比べる。
  - 許可集合は `resolveToolsFor` を export して求める。渡す断片は `roles` の断片だけとする。
  - `roles` が空の定義(廃止済み ID だけの定義)は、`tools` にある `Agent` だけを `disallowedTools` に入れる。
  - `toolsFormat` が `"none"` の定義は、`roles` が 1 つ以上あるときだけ `disallowedTools` に `"*"` を 1 件入れる。
  - 問題の無い定義も配列に含める。スキルは `retiredRoles` と `disallowedTools` のどちらかが空でない定義だけを扱う。

### 3-3. 既存定義を 1 行だけ書き換える CLI 操作を足す

既存定義の修正には、作り直しを使わない。frontmatter の 1 行だけを文字列として差し替える。`parseDocument` / `render` は使わない。model・scope・MCP・翻訳断片に依存しない。

- `--prune-tools --name <name> --tools <tool,...>`
  - `.claude/agents/<name>.md` の `tools:` 行から、指定したツールだけを外す。並び順と他の行は変えない。
  - `tools` が `"csv"` 以外の書式なら書き込まず、`ok: false` と「未対応の書式」を返す。
  - `--tools "*"` は、`tools` 欄が無い定義に、許可集合を `tools:` の 1 行として `name:` 行の直後に足す。`roles` が空の定義には使えず、`ok: false` を返す。
  - 指定したツールが行に無ければ、そのツールは無視して `warnings` に載せる。
- `--rewrite-roles --name <name> --roles <id,...>`
  - `agent-policy-role:` 行だけを、指定した ID の並びに置き換える。
  - ID は、廃止済みでない組み込み役割か、プロジェクト独自断片で解決できるものに限る。解決できない ID があれば書き込まず `ok: false` を返す。
  - `--roles` に空を渡すと、`agent-policy-role:` 行を消す。
- 両操作に共通する規則:
  - 対象ファイル・frontmatter・対象の行が無いときは、書き込まず `ok: false` を返す。
  - 応答は `{ ok, target, changed, warnings }` とする。
  - `--dir "$PWD"` を受け付ける。`--scope` と `--lang` は受け付けない。

保持マージの自動保持(`automaticKeep`)は変えない。点検で「残す」を選んだツールは、以降の保持マージでもそのまま残る。

### 3-4. スキル: ステップ 1b で点検してから被覆を確かめる

- ステップ 1b の最初に `--list-coverage` を実行し、`definitions` を読む。すべての役割の `coveredBy` が空でも、点検は省かない。
- `retiredRoles` か `disallowedTools` が空でない定義があれば、「定義 / 廃止済み役割と後継 / 許されていないツール」の表を示す。
- 質問は定義ごとに、`retiredRoles` → `disallowedTools` の順で別々に出す。1 回の `AskUserQuestion` には最大 4 問まで入るので、複数の定義の質問を 4 問ずつまとめてよい。
  - `retiredRoles`: 「廃止 ID を外す(推奨)」「このまま残す」の 2 択。質問文に後継の役割を書き、後継は新規生成で作ると伝える。
  - `disallowedTools`: ツールごとに「削除する(推奨)」「残す」の 2 択。`"*"` のときは「役割の既定ツールに絞る(推奨)」「全ツール継承のまま残す」の 2 択とする。
  - `toolsFormat` が `"other"` の定義は質問せず、手で直す箇所としてステップ 7 で報告する。
- 回答が出そろったら、変更を選んだ定義にその場で操作を実行する。
  - 「廃止 ID を外す」を選んだ定義は、`roles` だけを残した並びで `--rewrite-roles` を実行する。後継の役割は未カバーとして残し、以降の新規生成で作る(3-5)。
  - `roles` が空になった定義は、マーカーが消えて委譲先の候補から外れる。ステップ 7 で、ファイルの絶対パスを示して削除を利用者に委ねる。
  - 削除または絞り込みを選んだツールは、`--prune-tools` で外す。
  - ステップ 1b と非対話モード(3-6)の `--prune-tools` と `--rewrite-roles` に限り、`ok: false` でもウィザードを止めない。失敗した定義名と `error` を控え、ステップ 7 で報告する。スキル冒頭の「`ok: false` なら止める」の規律に、この例外を書き足す。
- 操作の後に、同じ `--lang` と `--scope` で `--list-coverage` を取り直し、その結果で被覆の質問を出す。

### 3-5. スキル: 新規生成では役割ごとにモデル・定義名・MCP を聞く

新規生成は、ステップ 4 の `--check` で生成先の `exists` が `false` になる役割を指す。既存ファイルの再生成(`exists: true`)の聞き方は変えない。

実装では、新規生成の手順を独立したステップ 5n にまとめた(実機検証で、ステップ 5〜6 に散らばった分岐が読み落とされたため)。5n は役割を 1 つずつ「モデル ID → 定義名 → MCP(readonly は denylist)→ 個別コマンドで生成」の順に最後まで処理する。MCP サーバーの一覧取得と「どのサーバーも使わない」の質問は、新規生成と再生成が共有するステップ 4b に置く。ステップ 5〜6 は再生成の役割だけを扱い、0 件なら飛ばす。以下の各項目は、この構成の中の該当ステップに当たる。

- 「未カバーの役割だけ作る」が選ばれたときは、以降のステップの対象役割を `uncovered` に絞り、ステップ 4・5・5b・5c・6 を通す。各コマンドに `--roles <uncovered…>` を付ける。ステップ 1b 末尾の「ステップ 7 へ進む」と、専用の `--check` / `--write` の例を削る。
- ステップ 5 では、新規生成の役割を「このまま全部作る」の一括生成に含めない。新規生成の役割はすべてステップ 5b へ進め、役割ごとにモデル ID と定義名を聞く。ステップ 5 の 3 択は、再生成の役割があるときだけ、その役割について出す。
- ステップ 5b のモデル ID の候補は、次のように絞る。
  - `--scope claude`: `claudeEnums` だけ。
  - `--scope custom` で live 照会が成功したとき: `--list-coverage` の `models` のうち、既定のエイリアスが live にある ID と `claudeEnums`。
  - `--scope custom` で live 照会が失敗したとき: `models` 全件。
- 定義名の自由入力は、`^[a-z0-9]+(?:-[a-z0-9]+)*$` に合わなければ聞き直す。
- ステップ 5c では、新規生成の役割には既定の配分を「この配分で進む」で一括承認させない。役割ごとに、付与するサーバーを複数選択で聞く。「この役割には付与しない」を先頭に置き、既定の配分を初期選択として示す。サーバーの一覧取得と「どのサーバーも使わない」の最初の質問は従来どおりで、それが選ばれたら役割ごとの質問も省く。
- 新規生成の役割は、ステップ 6 で `--recommended` の一括生成に含めず、1 役割ずつ次の個別コマンドで生成する。値はステップ 5b と 5c で決めたものを使う。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --model-id <model-id> --name <name> --model <model-value> --roles <1 件> [--vendor <vendor>] [--mcp-servers <server,...>] [--mcp-deny <tool,...>] --scope <claude|custom> --lang <lang> --dir "$PWD"
  ```

  - `--vendor` は、5b の既存手順でベンダーを確定したときだけ渡す。
  - `--mcp-servers` と `--mcp-deny` の付け方は 3-5b に従う。
- ステップ 6b の「モデル ID や定義名を個別に尋ねない」を削る。未カバー役割が残るときは、その役割ごとに 5b と 5c の質問をしてから生成する。

### 3-5e. 実機検証を受けた実装上の決定(0.21.3-dev)

実機検証で、モデルが手順の中で計算や判断をする箇所が run ごとに崩れた。計算は CLI に移し、質問の手順は減らした。

- モデル候補: `--list-coverage` が役割ごとの `candidates`(`{ modelId, model, recommended }`、推奨を先頭)と `liveOk` を返す。custom では `--list-coverage` も live を照会する。スキルは `candidates` をそのまま使う。内訳は `modelBreakdown` を返す。
- 単一選択はページ分けしない。候補が空の選択肢を含めて 4 件を超えるときは、「推奨(最大 2 件)/その他のモデル/空の選択肢」の 1 問目と、残りの候補の 2 問目に分ける。ページ分けは複数選択だけに残す。
- 空の選択肢(「作らない」「付与しない」「再生成しない」)は候補の最後に置く。推奨は先頭に置く。
- MCP は先に単一選択で聞く。再生成は「既存のまま(推奨)/変更する/付与しない」、新規生成は「既定のサーバーを付ける(推奨)/選ぶ/付与しない」。複数選択は「変更する」「選ぶ」のときだけ出す。
- ステップ 6b(被覆の取り直し)は廃止した。生成で `ok: false` になった役割と定義は、ステップ 7 で報告する。「作らない」を選んだ役割は、同じ実行の中で聞き直さない。
- 対話モードでも、`$ARGUMENTS` に `--scope` があれば 0b を省く。

### 3-5f. 外部モデルのエイリアスを部分一致で判定する(0.21.3-dev)

外部モデルの認識が既定エイリアスとの完全一致だけに依存しているため、プロキシ側の名前変更(例: `claude-gpt-6-sol` → `claude-gpt-6-1-sol`)で既知のモデルが未知扱いになった。エイリアスの付け方は利用者ごとに変わる(`claude-gpt6-sol`、`claude-gpt-6.1-sol`、`claude-gpt-6.1-sol-pro` など)。

- 判定関数を `src/agents/policies.ts` に 1 つ置く。入力は live のエイリアス、出力は一致したモデル ID(無ければ `undefined`)。
  - エイリアスが `claude-` で始まることを必須とする(Claude Code で外部モデルをサブエージェントにするときの制約)。
  - 大文字と小文字は区別しない。
  - ベンダー語(`gpt`、`grok`)は部分一致で判定する(`gpt6` のように数字と続く書き方を拾う)。
  - 系統名(`sol`、`terra`、`luna`、`astra`)は、エイリアスを `-` `.` `_` で区切ったトークンとの完全一致で判定する(`console` などの誤検出を避ける)。
  - gpt 系は「ベンダー語 gpt と系統名の両方」、grok は「ベンダー語 grok」で判定する。gpt 系の系統名がどれも当たらないエイリアスは未知とする。
- 同じモデル ID に複数のエイリアスが当たるとき:
  - 推奨の印は、既定エイリアスと完全一致するもの、無ければ文字数が最も短いもの(同じ長さなら辞書順で先)に付ける。
  - 対話モードは、当たったエイリアスをそれぞれ別の候補として出し、エイリアス名を示す。
  - 非対話モードは推奨の印の付いた 1 つを使い、選ばなかったエイリアスを報告に載せる。
- この判定を通す箇所: `--list-live-models` の vendor と推奨役割、`--list-coverage` の `definitions[].modelId` の逆引きと `candidates`、生成時の実在確認(`modelIsAvailable`)、SessionStart の実在検証。
- 既定エイリアス(`MODELS[].model`)は、live の照会に失敗したときの値と、推奨の印の優先順位にだけ使う。

### 3-5c. 再生成の対象を被覆する定義で決める

作成先を既定名(`<model-id>-<default-name>`)のファイルの有無で決めると、既定名でない既存定義が担う役割が新規生成になり、同じ役割の定義が並立する。新規生成か再生成かは、ファイル名でなく被覆で決める。

- 新規生成: 対象の構成(`--scope`)で `coveredBy` が空の役割。作成先は従来どおり既定名とし、ステップ 5n で作る。
- 再生成: `coveredBy` が空でない役割。作成先は、その役割を被覆する既存定義のファイルとする。
  - 1 つの役割を 2 件以上の定義が被覆するときは、どの定義を再生成するか、または再生成しないかを聞く(対話モード)。非対話モードでは再生成せず、報告に載せる。
  - 複数の役割を持つ定義は、その定義の `roles` をすべて渡して 1 回だけ再生成する。
- CLI:
  - `--list-coverage` の `definitions[]` に `modelId` を足す。定義の `model` が Claude の enum ならその値、`MODELS` のいずれかの `model` と一致すればその `id`、どちらでもなければ `null` とする。
  - `--recommended` の作成先の決め方を改める。対象の構成で被覆する定義がちょうど 1 件あり、その `modelId` が `null` でない役割は、その定義を作成先にする(`name` はファイル名から `.md` を除いた値、`model` と `vendor` は定義の値、`roles` は定義の `roles`)。1 つの定義は 1 回だけ生成する。被覆する定義が 2 件以上ある役割と、`modelId` が `null` の定義は生成せず、`warnings` に載せる。被覆されていない役割は従来どおり既定名で作る。
- スキル(対話モード):
  - ステップ 4 の振り分けを、`--check` の `exists` から、`--list-coverage` の `coveredBy` に改める。
  - 再生成は、定義ごとに `--write --merge --model-id <modelId> --name <ファイル名> --model <定義の model> --roles <定義の roles> [--vendor] [--mcp-servers] [--mcp-deny] --scope --lang --dir` の個別コマンドで行う。`--recommended` は使わない。
  - `modelId` が `null` の定義は、ステップ 5b でモデル ID を聞いてから再生成する。
  - `--scope custom` で live 照会が成功し、定義の `model` が live に無いときは、その定義を再生成せずにステップ 7 で報告する。
- 非対話モード(`--yes`)は `--recommended` のまま、上の CLI の改修で被覆する定義を作成先にする。

### 3-5d. 再生成で description と前置きを既定で保持する

実機検証で、保持マージが既存定義の description と前置き(最初の見出しより前の本文)をテンプレートで置き換え、差分の表と報告にそれが現れないことが分かった。description と前置きは既定で保持し、役割の断片の更新で内容が変わったときだけ置き換えを勧める。

- 生成時の記録: compose は frontmatter に `agent-policy-description-hash` と `agent-policy-preamble-hash` を書く。値は書き込んだ description と前置きのハッシュ(`bodyHash` と同じ 16 桁)とする。
- 状態の判定: `--check` と `--write` の結果の各 target に、`description` と `preamble` の状態を返す。
  - `same`: 既存がテンプレートと一致する。
  - `templateChanged`: 既存が記録のハッシュと一致し、テンプレートは違う。利用者は編集しておらず、役割の断片の更新で変わった。
  - `userEdited`: 記録があり、既存が記録と一致しない。
  - `unknown`: 記録が無く、既存がテンプレートと違う。
- 保持マージの既定: `--merge` は、`same` 以外の description と前置きを既存のまま保持する。`--replace <description|preamble>`(カンマ区切り)を渡したものだけテンプレートで置き換える。
- 記録の更新: 置き換えたときは新しい値のハッシュを書く。保持したときは既存の記録をそのまま残す(記録が無ければ書かない)。
- スキル(対話モード): ステップ 5 の差分の表に、再生成する定義ごとの description と前置きの状態を載せる。
  - `templateChanged`: 「テンプレートに置き換える(推奨)」「保持する」を聞く。
  - `unknown`: 既存とテンプレートの両方を preview に示し、「保持する」「テンプレートに置き換える」を聞く。推奨は付けない。
  - `userEdited`: 質問せずに保持し、ステップ 7 で報告する。
- 非対話モード: すべて保持する。`templateChanged` の定義は報告に載せ、対話モードでの再実行を案内する。

### 3-5b. スキル: readonly の役割にも MCP を既定で付与する

CLI は readonly の役割への `--mcp-servers` と `--mcp-deny` を既に受け付ける。`--mcp-deny` はコマンド単位で全対象に付くので、impl と readonly は別のコマンドで生成する。サーバー単位で許可しツール単位で禁止する形は ADR-001 に従う。

- 役割の kind は、`--list-coverage` の `roles[].kind` で判定する。`e2e-verify` は impl である。
- ステップ 5c の既定の配分に、kind を問わず全役割を含める。
- readonly の役割にサーバーが 1 つでも付くときは、ステップ 5c-7 で書き込み系ツールの denylist を確定させる。
  - 書き込み系ツールは、ファイル・リポジトリ・外部サービスの状態を変えるツールを指す。読み取り・検索・解析のツールは含めない。
  - denylist は列挙漏れを許可する方式である。漏れた書き込み系ツールは readonly の役割から使えてしまうことを、確認の質問に書く。
  - 利用者が denylist の確定を拒んだ readonly の役割には、サーバーを付けない。
- ステップ 5c-7 の「確定した denylist は、サーバーが付いた全定義へ `--mcp-deny` で渡す」を、「readonly の役割の定義にだけ渡す」に改める。
- ステップ 6 と 3-5 の個別コマンドの組み立てを次に改める。
  - impl の役割: `--mcp-servers` だけを渡し、`--mcp-deny` は渡さない。
  - readonly の役割: サーバーが付くときは `--mcp-servers` と `--mcp-deny` を必ず両方渡す。保持マージは `disallowedTools` を保持しないので、再生成のたびに渡す。
  - 役割ごとにサーバーが違うときは、同じサーバー集合を持つ役割ごとにコマンドを分ける。
- 既定の配分の列挙(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general`)を削り、kind で判定する記述に置き換える。
- README の「MCP は既定で実装役割(…)の定義に付与し、読み取り役割だけの定義には付与しません」を、「MCP は既定で全役割に付与します。読み取り役割には、書き込み系ツールを `disallowedTools` に入れて付与します」に置き換える。

### 3-6. 非対話モード(`--yes`)

- 既存定義の MCP は既定で残す。`--recommended --merge` で `--mcp-servers` を渡さないとき、既存ファイルを作成先にする target は、そのファイルの `mcpCurrent` のサーバーを引き継ぐ。既存の `disallowedTools` も引き継ぐ。引き継いだサーバーも通常と同じく接続を再検証し、落ちたものは `mcpDropped` に載せる。新規生成の target には MCP を付けない(従来どおり)。

- 生成の前に `--list-coverage` を実行し、`definitions` を読む。
- `toolsFormat` が `"csv"` の定義について、`disallowedTools` のうち `"*"` 以外のツールを `--prune-tools` で外す。
- 次の定義は変更しない。
  - `"*"`(全ツール継承)の定義
  - `toolsFormat` が `"other"` の定義
  - `retiredRoles` を持つ定義
- 報告に次を定義ごとに並べ、対話モードでの再実行を案内する。全文の差分は載せない。
  - `tools` 行の変更前と変更後
  - 再生成で外れた MCP サーバー(変更前の `mcpCurrent` と変更後の比較)
  - description と前置きの状態(3-5d)
  - 外したツールと定義名
  - 変更しなかった定義と、その理由
  - 廃止済み役割と後継

### 3-7. README

- 「旧バージョンからの移行」セクションの「`--merge` で再生成すると既存定義の tools にある `Agent` が残るため、手で消してください」を、「setup-agents の再実行で、役割に許されていないツールの削除を確認します」に置き換える。
- 項目 10 を 3-1 に合わせて改める。
- `--prune-tools` と `--rewrite-roles` の説明を足す。
- MCP の既定付与の記述を 3-5b に合わせる。

## 4. 変更対象とテスト

- `src/agents/roles.ts`: `RETIRED_ROLE_REPLACEMENTS` を追加。
- `src/agents/fragments.ts` または呼び出し側: 廃止済み ID の断片を役割として解決しない。
- `src/agents/compose.ts`: `resolveToolsFor` を export する。
- `src/hooks/marker-scan.ts`: `roleLabel` が廃止済み ID を解決しない。
- `src/hooks/session-start.ts`: `RETIRED_ROLES` を 3-1 の表から作る。出力文は不変(既存テストで固定)。
- `src/setup-agents.ts`: `listCoverage` の `roles[].kind` と `definitions`、`--prune-tools`、`--rewrite-roles`、引数の併用規則。
- `skills/setup-agents/SKILL.md`: 冒頭の `ok: false` の規律への例外、ステップ 1b・5・5b・5c・6・6b・非対話モード・ステップ 7 の報告項目。書き換えの前に `prompt-smith:skill-creator` を起動する。
- `README.md`: 3-7。
- テスト:
  - `setup-agents.test.ts`
    - `definitions` が `Agent` を `disallowedTools` に、`final-review` を `retiredRoles`(後継 `complex-review`)に載せる。
    - `final-review` だけを持つ定義でも、`Agent` が `disallowedTools` に載る。`"*"` は載らない。
    - `tools` 欄が無く `roles` がある定義は `"*"` になる。`mcp__` のツールは `disallowedTools` に入らない。
    - block 配列・引用符付きの `tools` を `parseToolsField` で解釈し、`Agent` を検出する。`toolsFormat` は `"other"` になる。
    - プロジェクトに `final-review.md` の断片が残っていても、`final-review` は `roles` に入らない。
    - `roles[].kind` が返る。`e2e-verify` は `impl`。
    - `--prune-tools` は指定ツールだけを外し、他の行はバイト単位で変わらない(空行・コメントを含むファイルで確かめる)。`"other"` の書式は `ok: false`。`--tools "*"` は許可集合の 1 行を足す。`roles` が空の定義への `"*"` は `ok: false`。
    - `--rewrite-roles` はマーカー行だけを置き換える。空の `--roles` で行を消す。廃止済み ID や未知の ID は `ok: false` で書き込まない。
    - 対象ファイルが無いときは両操作とも `ok: false`。
  - `marker-scan.test.ts`: プロジェクトに `final-review.md` の断片が残っていても、`roleLabel("final-review")` が `undefined` を返し、対応表に載らない。
- スキルの手順は、受け入れ基準 A1・A2・A5・A6 を実機の対話で確かめる。

## 5. 不採用案

- 既存定義を作り直して直す(初版の設計): 外部モデルの `model` 値を `--model-id` に渡せない、廃止済み ID がマーカーから落ちる、MCP と保持したツールが後の生成で消える、翻訳断片の準備前に書けない、の 4 点で破綻する。
- `parseDocument` / `render` で 1 行を書き換える: 往復で空行・コメント・block 配列が落ち、他の行を保てない。
- 廃止済み ID を後継の ID に書き換える: 本文と `description` が旧役割のまま残り、後継の役割の委譲先として対応表に載る。同じ実行で作り直すと手順が複雑になる。
- 保持マージの自動保持から組み込みツールを外す(初版の設計): 点検で「残す」を選んだツールが、後の推奨生成で消える。点検が全経路で先に走るため、自動保持を変えなくても R3 を満たせる。
- 許されていないツールを確認なしで削除する: 利用者が意図して足した組み込みツール(例: `WebFetch`)まで消える。非対話モードだけは、承認済みの方針として確認なしで外す。
- 警告だけ出して保持を続ける: 利用者が手で直すまで残る。
- 点検を SessionStart に持たせる: 毎セッションの注入が増える。直す手段は setup-agents にしかない。
