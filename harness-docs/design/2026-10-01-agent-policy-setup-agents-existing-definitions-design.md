# agent-policy setup-agents 既存定義の点検と未カバー経路の聞き取り 設計書

- 対象: `plugins/agent-policy`(0.21.2-dev のまま。バージョンは上げない)
- 状態: 承認済みの方針 4 点を設計に起こしたもの。理解レビューと前提検証レビューの指摘を反映済み。実装前

## 1. 要件

setup-agents を再実行したとき、既存の Agent 定義の不整合が利用者に知らされず、未カバー役割の生成でも何も聞かれない。次の 4 点を直す。

- R1: 対話モードで定義を新規生成するときは、経路を問わず、対象の役割ごとにモデル・定義名・MCP を聞き取る。
- R2: どの経路でも、既存定義の点検を省かない。
- R3: 役割が許していない組み込みツール(`Agent` など MCP 以外)を、利用者に知らせずに残さない。
- R4: 廃止済みの役割 ID を宣言する定義に、書き換えを案内する。

受け入れ基準:

- A1: 対話モードで、生成先のファイルがまだ無い役割(新規生成)があるとき、どの経路を選んでも、その役割ごとにステップ 5b のモデル ID と定義名の質問と、ステップ 5c の MCP サーバーの質問が出る。「未カバーだけ作る」「すべて確認し直す」「ステップ 6b の未カバー生成」のいずれも含む。
- A2: `tools` に `Agent` を持つ既存定義があるとき、どの経路を選んでも、被覆の有無にかかわらず、ステップ 1b でその定義名とツール名が示され、削除か保持かを聞かれる。廃止済み ID だけを持つ定義も対象に含む。
- A3: 削除を選ぶと、その定義の `tools` から当該ツールだけが消え、他の行は変わらない。保持を選ぶと残り、以降の保持マージでも残る。
- A4: `--yes`(非対話)では、マーカー付きの全定義から許されていないツールが外れ、定義名とツール名が報告に載る。
- A5: `agent-policy-role` に `final-review` を持つ定義があるとき、ステップ 1b で書き換え先 `complex-review` とともに示される。書き換えを選ぶとマーカーが `complex-review` になり、「このまま残す」を選ぶとマーカーは変わらない。

## 2. 現状

- 未カバー経路は、ステップ 1b の直後に `--check` / `--write --merge --recommended --roles <uncovered>` を実行してステップ 7 へ飛ぶ(`skills/setup-agents/SKILL.md` ステップ 1b 末尾)。ステップ 6b も「モデル ID や定義名を個別に尋ねない」と定める。
- ステップ 1b は、すべての役割の `coveredBy` が空なら質問せずにステップ 2 へ進む。
- 保持マージの自動保持 `automaticKeep`(`src/setup-agents.ts`)は、テンプレートに無い既存ツールのうち `mcp__` 以外をすべて保持する。
- 生成時のツール集合は `resolveToolsFor`(`src/agents/compose.ts`)が決める。役割断片の `tools` の和から `Agent` を除き、選んだ MCP サーバーを足す。
- `--list-coverage` は役割ごとの `coveredBy` と `uncovered` だけを返す。マーカーに組み込み外の ID があっても黙って無視する。
- 廃止済み役割 ID の集合と書き換え先は、SessionStart の `RETIRED_ROLES` と `retiredRoleBlock` の文言にだけある(`src/hooks/session-start.ts`)。
- 既存定義を作り直す経路(`--write --merge --model-id … --name …`)は、次の理由で既存定義の修正に使えない(前提検証レビューで確認)。
  - `--model-id` は `MODELS` の `id`(`gpt-sol` など)しか受け付けず、定義の `model` 値(`claude-gpt-6-sol` など)を渡すと失敗する。`--scope claude` では外部モデルの `--model` 自体を拒否する。
  - 廃止済み ID は断片が無く `--roles` に渡せないため、作り直すとマーカーから落ちる。
  - `--mcp-servers` を渡さないと既存の MCP ツールが落ちる。
  - lang が ja / en 以外で翻訳断片が未準備だと書き込めない。

## 3. 設計

### 3-1. 廃止済み役割の表を共有する

- `src/agents/roles.ts` に `RETIRED_ROLE_REPLACEMENTS: Record<string, RoleId | null>` を置く。値は書き換え先で、`null` は「マーカーから外す」を表す。
  - `final-review` → `complex-review`
  - `gate-review` → `complex-review`
  - `design-plan` → `null`
  - `advisor` → `null`
- SessionStart の `RETIRED_ROLES` と `retiredRoleBlock` の書き換え先の文は、この表から組み立てる。文面は変えない。
- この表にある ID は、プロジェクトの `.claude/agent-policy/roles/` に同名の断片が残っていても、役割として解決しない。点検でも生成でも廃止済み ID として扱う。

### 3-2. `--list-coverage` に定義単位の点検結果を足す

応答に `definitions` 配列を足す。既存の `roles` と `uncovered` は変えない。

- 対象は `.claude/agents/` の定義のうち、`agent-policy-role` を持つものすべて。`--scope claude` でも外部ベンダーの定義を除かない。
- 要素のフィールド:
  - `name`、`file`(プロジェクトルート相対)、`model`、`vendor`
  - `roles`: マーカーのうち、廃止済みでなく、組み込みまたはプロジェクト独自断片として解決できる ID
  - `retiredRoles`: マーカーのうち `RETIRED_ROLE_REPLACEMENTS` にある ID と書き換え先の組 `{ id, replacement }`
  - `disallowedTools`: 定義の `tools` のうち、`mcp__` で始まらず、許可集合に無いもの
- 許可集合は `resolveToolsFor` に、`roles` と、`retiredRoles` の書き換え先(`null` を除く)を合わせた断片を渡して求める。`Agent` は `resolveToolsFor` が常に除くため、どの定義でも許されていないツールになる。
- 許可集合を求める断片が 1 つも無い定義(`design-plan` / `advisor` だけを持つ定義など)は、`tools` にある `Agent` だけを `disallowedTools` に入れる。
- `tools` 欄が無い定義(全ツール継承)は、`disallowedTools` に `"*"` を 1 件入れる。
- 問題の無い定義も配列に含める。スキルは `retiredRoles` と `disallowedTools` のどちらかが空でない定義だけを扱う。

### 3-3. 既存定義を行単位で直す CLI 操作を足す

既存定義の修正には、作り直しを使わず、frontmatter の 1 行だけを書き換える操作を使う。model・scope・MCP・翻訳断片に依存しない。

- `--prune-tools --name <name> --tools <tool,...>`
  - `.claude/agents/<name>.md` の `tools` 行から、指定したツールだけを外す。並び順と他の行は変えない。
  - `--tools "*"` は、`tools` 欄が無い定義に、3-2 の許可集合を `tools` 行として足す。
  - 指定したツールが `tools` 行に無ければ、そのツールは無視して `warnings` に載せる。
- `--rewrite-roles --name <name> --roles <id,...>`
  - `agent-policy-role` 行だけを、指定した ID の並びに置き換える。
  - ID は、廃止済みでない組み込み役割かプロジェクト独自断片で解決できるものに限る。解決できない ID があれば書き込まず `ok: false` を返す。
  - 本文と `description` は書き換えない。応答に `bodyMayBeStale: true` を返す。
- 両操作に共通する規則:
  - 対象ファイルが無い、frontmatter が無い、`--rewrite-roles` で `agent-policy-role` 行が無いときは、書き込まず `ok: false` を返す。
  - 応答は `{ ok, target, changed, warnings }` とし、`--rewrite-roles` は `bodyMayBeStale` を足す。
  - `--dir "$PWD"` を受け付ける。`--scope` と `--lang` は受け付けない。

保持マージの自動保持(`automaticKeep`)は変えない。点検で「残す」を選んだツールは、以降の保持マージでもそのまま残る。

### 3-4. スキル: ステップ 1b で点検してから被覆を確かめる

- ステップ 1b の最初に `--list-coverage` を実行し、`definitions` を読む。すべての役割の `coveredBy` が空でも、点検は省かない。
- `retiredRoles` か `disallowedTools` が空でない定義があれば、「定義 / 廃止済み役割と書き換え先 / 許されていないツール」の表を示す。
- 質問は定義ごとに、`retiredRoles` → `disallowedTools` の順で別々に出す。1 回の `AskUserQuestion` には最大 4 問まで入るので、複数の定義の質問を 4 問ずつまとめてよい。
  - `retiredRoles`: 「書き換える(推奨)」「このまま残す」の 2 択。書き換え先がすべて `null` の定義は質問せず、定義の削除を利用者に委ね、削除するファイルの絶対パスを示す。
  - `disallowedTools`: ツールごとに「削除する(推奨)」「残す」の 2 択。`"*"` のときは「役割の既定ツールに絞る(推奨)」「全ツール継承のまま残す」の 2 択とする。
- 回答が出そろったら、変更を選んだ定義にその場で操作を実行する。
  - 書き換えを選んだ定義は、書き換え先を置き換え、`null` を外し、重複を除いた集合で `--rewrite-roles` を実行する。
  - 削除または絞り込みを選んだツールは、`--prune-tools` で外す。
  - 1 つの定義で失敗しても、ウィザードは止めない。失敗した定義名と `error` を控え、ステップ 7 で報告する。
  - `bodyMayBeStale: true` が返った定義は、ステップ 7 で「本文と description は旧役割のまま。ステップ 5b の個別調整で作り直すと更新される」と報告する。
- 操作の後に `--list-coverage` を取り直し、その結果で被覆の質問を出す。書き換えで被覆された役割は、未カバーから外れる。

### 3-5. スキル: 新規生成では役割ごとにモデル・定義名・MCP を聞く

新規生成は、ステップ 4 の `--check` で生成先の `exists` が `false` になる役割を指す。既存ファイルの再生成(`exists: true`)の聞き方は変えない。

- 「未カバーの役割だけ作る」が選ばれたときは、以降のステップの対象役割を `uncovered` に絞り、ステップ 4・5・5b・5c・6 を通す。各コマンドに `--roles <uncovered…>` を付ける。ステップ 1b 末尾の「ステップ 7 へ進む」と、専用の `--check` / `--write` の例を削る。
- ステップ 5 では、新規生成の役割を「このまま全部作る」の一括生成に含めない。新規生成の役割はすべてステップ 5b へ進め、役割ごとにモデル ID と定義名を聞く。ステップ 5 の 3 択は、再生成の役割があるときだけ、その役割について出す。
- ステップ 5c では、新規生成の役割には既定の配分を「この配分で進む」で一括承認させない。役割ごとに、付与するサーバーを複数選択で聞く。「この役割には付与しない」を先頭に置き、既定の配分を初期選択として示す。サーバーの一覧取得と「どのサーバーも使わない」の最初の質問は従来どおりで、それが選ばれたら役割ごとの質問も省く。
- 新規生成の役割は、ステップ 6 で `--recommended` の一括生成に含めず、5b と 5c で決めた値の個別コマンド(`--model-id`・`--name`・`--model`・`--roles <1 件>`・`--mcp-servers`)で生成する。
- ステップ 6b の「モデル ID や定義名を個別に尋ねない」を削る。未カバー役割が残るときは、その役割ごとに 5b と 5c の質問をしてから生成する。

### 3-6. 非対話モード(`--yes`)

- 生成の前に `--list-coverage` を実行し、`definitions` を読む。
- `disallowedTools` のうち `"*"` 以外のツールを、各定義から `--prune-tools` で外す。
- `"*"`(全ツール継承)の定義と、`retiredRoles` を持つ定義は変更しない。
- 報告に次を並べ、対話モードでの再実行を案内する。
  - 外したツールと定義名
  - 全ツール継承のまま残した定義
  - 廃止済み役割と書き換え先

### 3-7. README

- 「旧バージョンからの移行」セクションの「`--merge` で再生成すると既存定義の tools にある `Agent` が残るため、手で消してください」を、「setup-agents の再実行で、役割に許されていないツールの削除を確認します」に置き換える。

## 4. 変更対象とテスト

- `src/agents/roles.ts`: `RETIRED_ROLE_REPLACEMENTS` を追加。
- `src/agents/fragments.ts` または呼び出し側: 廃止済み ID の断片を役割として解決しない。
- `src/hooks/session-start.ts`: 3-1 の表を参照する。出力文は不変(既存テストで固定)。
- `src/setup-agents.ts`: `listCoverage` に `definitions`、`--prune-tools`、`--rewrite-roles`、引数の併用規則。
- `skills/setup-agents/SKILL.md`: ステップ 1b・5・6b・非対話モード・ステップ 7 の報告項目。書き換えの前に `prompt-smith:skill-creator` を起動する。
- `README.md`: 3-7 と、2 つの新操作の説明。
- テスト(`src/__test__/setup-agents.test.ts`):
  - `definitions` が `Agent` を `disallowedTools` に、`final-review` を `retiredRoles`(書き換え先 `complex-review`)に載せる。
  - `final-review` だけを持つ定義でも、`Agent` が `disallowedTools` に載る。`design-plan` だけの定義でも同じ。
  - `tools` 欄が無い定義は `"*"` になる。`mcp__` のツールは `disallowedTools` に入らない。
  - プロジェクトに `final-review.md` の断片が残っていても、`final-review` は `roles` に入らない。
  - `--prune-tools` は指定ツールだけを外し、他の行はバイト単位で変わらない。`--tools "*"` は許可集合の `tools` 行を足す。
  - `--rewrite-roles` はマーカー行だけを置き換え、`bodyMayBeStale: true` を返す。廃止済み ID や未知の ID を渡すと `ok: false` で書き込まない。
  - 対象ファイルが無いときは両操作とも `ok: false`。
- スキルの手順は、受け入れ基準 A1・A2・A5 を実機の対話で確かめる。

## 5. 不採用案

- 既存定義を作り直して直す(初版の設計): 外部モデルの `model` 値を `--model-id` に渡せない、廃止済み ID がマーカーから落ちる、MCP と保持したツールが後の生成で消える、翻訳断片の準備前に書けない、の 4 点で破綻する。
- 保持マージの自動保持から組み込みツールを外す(初版の設計): 点検で「残す」を選んだツールが、後の推奨生成で消える。点検が全経路で先に走るため、自動保持を変えなくても R3 を満たせる。
- 許されていないツールを確認なしで削除する: 利用者が意図して足した組み込みツール(例: `WebFetch`)まで消える。非対話モードだけは、承認済みの方針として確認なしで外す。
- 警告だけ出して保持を続ける: 利用者が手で直すまで残る。
- 点検を SessionStart に持たせる: 毎セッションの注入が増える。直す手段は setup-agents にしかない。
