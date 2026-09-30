# agent-policy setup-agents 既存定義の点検と未カバー経路の聞き取り 設計書

- 対象: `plugins/agent-policy`(0.21.2-dev のまま。バージョンは上げない)
- 状態: 承認済みの方針 4 点を設計に起こしたもの。実装前

## 1. 要件

setup-agents を再実行したとき、既存の Agent 定義の不整合が利用者に知らされず、未カバー役割の生成でも何も聞かれない。次の 4 点を直す。

- R1: 「未カバーの役割だけ作る」を選んだとき、モデル・定義名・MCP を聞き取る。
- R2: 同じ経路でも、既存定義の点検を省かない。
- R3: 役割が許していない組み込みツール(`Agent` など MCP 以外)を、保持マージで黙って残さない。
- R4: 廃止済みの役割 ID を宣言する定義に、書き換えを案内する。

受け入れ基準:

- A1: 未カバー役割が 1 つ以上あり「未カバーだけ作る」を選んだとき、その役割についてステップ 4・5・5b・5c の質問が出る。
- A2: `tools` に `Agent` を持つ既存定義があるとき、どの経路を選んでもステップ 1b でその定義名とツール名が示され、削除か保持かを聞かれる。
- A3: 削除を選ぶと、生成後の定義の `tools` から当該ツールが消える。保持を選ぶと残る。
- A4: `--yes`(非対話)で再生成すると、許されていないツールは残らず、応答の `discarded.tools` に載る。
- A5: `agent-policy-role` に `final-review` を持つ定義があるとき、ステップ 1b で書き換え先 `complex-review` とともに示され、書き換えを選ぶとマーカーが `complex-review` になる。

## 2. 現状

- 未カバー経路は、ステップ 1b の直後に `--check` / `--write --merge --recommended --roles <uncovered>` を実行してステップ 7 へ飛ぶ(`skills/setup-agents/SKILL.md` ステップ 1b 末尾)。ステップ 6b も「モデル ID や定義名を個別に尋ねない」と定める。
- 保持マージの自動保持 `automaticKeep`(`src/setup-agents.ts`)は、テンプレートに無い既存ツールのうち `mcp__` 以外をすべて保持する。`keptNeedsReview` は `tools:mcp__` だけを拾う。
- 生成時のツール集合は `resolveToolsFor`(`src/agents/compose.ts`)が決める。役割断片の `tools` の和から `Agent` を除き、選んだ MCP サーバーを足す。
- `--list-coverage` は役割ごとの `coveredBy` と `uncovered` だけを返す。定義単位の情報は返さない。マーカーに組み込み外の ID があっても黙って無視する。
- 廃止済み役割 ID の集合と書き換え先は、SessionStart の `RETIRED_ROLES` と `retiredRoleBlock` の文言にだけある(`src/hooks/session-start.ts`)。

## 3. 設計

### 3-1. 廃止済み役割の表を共有する

- `src/agents/roles.ts` に `RETIRED_ROLE_REPLACEMENTS: Record<string, RoleId | null>` を置く。値は書き換え先で、`null` は「マーカーから外す」を表す。
  - `final-review` → `complex-review`
  - `gate-review` → `complex-review`
  - `design-plan` → `null`
  - `advisor` → `null`
- SessionStart の `RETIRED_ROLES` と `retiredRoleBlock` の書き換え先の文は、この表から組み立てる。文面は変えない。

### 3-2. `--list-coverage` に定義単位の点検結果を足す

応答に `definitions` 配列を足す。既存の `roles` と `uncovered` は変えない。

- 対象は `.claude/agents/` の定義のうち、`agent-policy-role` を持つものすべて。`--scope claude` でも外部ベンダーの定義を除かない(点検は被覆と独立に行う)。
- 要素のフィールド:
  - `name`、`file`(プロジェクトルート相対)、`model`、`vendor`
  - `roles`: マーカーのうち組み込みまたはプロジェクト独自断片として解決できる ID
  - `retiredRoles`: マーカーのうち `RETIRED_ROLE_REPLACEMENTS` にある ID と、その書き換え先の組 `{ id, replacement }`
  - `disallowedTools`: 定義の `tools` のうち、`mcp__` で始まらず、`resolveToolsFor(roles の断片, [])` に無いもの
- `roles` が空の定義(廃止済み ID しか持たない定義)は、許可集合が決まらないため `disallowedTools` を空にする。`retiredRoles` だけで示す。
- `tools` 欄が無い定義(全ツール継承)は `disallowedTools` に `"*"` を 1 件入れる。
- 問題の無い定義も配列に含める。スキルは `retiredRoles` と `disallowedTools` のどちらかが空でない定義だけを扱う。

### 3-3. 保持マージで MCP 以外の既存ツールを自動保持しない

- `automaticKeep` が返す `tools:` の選択子を 0 件にする。MCP も組み込みも、既存にだけあるツールは自動では保持しない。既存にだけある `keys`(`disallowedTools` を除く)と `sections` の自動保持は変えない。
- MCP ツールの扱いは現状と同じで、`--mcp-servers` で選ばれたサーバーだけがテンプレートに入る。
- テンプレートに無く、`--keep` でも指定されなかった既存ツールは、書き込み応答の `Discarded` 型に足す `tools: string[]` に載せる。`mcp__` のツールも同じ欄に載せる。
- 利用者が意図して足した組み込みツールは、スキルが保持を聞き取り、`--keep tools:<name>` で渡す。

### 3-4. 廃止済み役割の書き換え

新しい CLI 操作は足さない。既存の個別生成で書き換える。

- 書き換え先がある ID は置き換え、`null` の ID は外した役割の集合を作る。重複は除く。
- 集合が空でなければ、その定義の `name`・`model`・`vendor` を引き継いで次を実行する。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --write --merge --model-id <model> --name <name> --model <model> --roles <新しい集合> [--vendor <vendor>] --scope <claude|custom> --lang <lang> --dir "$PWD"
  ```

  実行の前に `--list-roles --model-id <model> --scope <claude|custom> --dir "$PWD"` を実行する。応答が `ok: false`、または新しい集合の役割が応答の候補に含まれないときは、その定義を書き換えない。報告には定義名・`model` 値・通らなかった役割を載せ、ステップ 5b の個別調整で作り直すよう案内する【要確認: 推奨表に無いエイリアスを `--model-id` に渡したときの応答】。
- 集合が空(すべて `null`)なら書き換えない。定義の削除は利用者の手に委ね、削除するファイルの絶対パスを示す。

### 3-5. スキル: ステップ 1b を点検と被覆確認の 2 ステップに分ける

- ステップ 1b の最初に `--list-coverage` の `definitions` を読み、`retiredRoles` か `disallowedTools` が空でない定義があれば、被覆の質問より先に「定義 / 廃止済み役割と書き換え先 / 許されていないツール」の表を示す。
- 質問は定義ごとに、`retiredRoles` → `disallowedTools` の順で別々に出す。1 回の `AskUserQuestion` には最大 4 問まで入るので、複数の定義の質問を 4 問ずつまとめてよい。
  - `retiredRoles`: 「書き換える(推奨)」「このまま残す」の 2 択。書き換え先が空になる定義は質問せず、削除の案内だけを出す。
  - `disallowedTools`: ツールごとに「削除する(推奨)」「残す」の 2 択。`"*"` のときは「役割の既定ツールに絞る(推奨)」「全ツール継承のまま残す」の 2 択とする。
- 回答が出そろったら、変更を選んだ定義をその場で生成する。
  - 書き換えを選んだ定義は、3-4 のコマンドで生成する。
  - 書き換えず、ツールの削除だけを選んだ定義は、`--write --merge --model-id <model> --name <name> --model <model> --roles <現在の roles>` で生成する。
  - ツールの保持を選んだものは、その定義のコマンドに `--keep tools:<name>` を足す。
  - 「このまま残す」「残す」だけの定義は生成しない。
- 生成の後に `--list-coverage` を取り直し、その結果で従来の被覆の質問を出す。書き換えで被覆された役割は、未カバーから外れる。

### 3-6. スキル: 「未カバーの役割だけ作る」を対象の絞り込みにする

- 選ばれたときは、以降のステップの対象役割を `uncovered` に絞る。ステップ 4・5・5b・5c・6 はすべて通す。各コマンドに `--roles <uncovered…>` を付ける。
- ステップ 1b 末尾の「ステップ 7 へ進む」と、専用の `--check` / `--write` の例を削る。
- ステップ 6b の「モデル ID や定義名を個別に尋ねない」を削り、未カバー役割が残るときはステップ 5 の 3 択(このまま作る / 一部を調整する / 作らない)で聞く。

### 3-7. 非対話モード(`--yes`)

- 点検の質問はしない。3-3 により許されていないツールは既存定義を再生成したときに落ち、`discarded.tools` に載る。報告に定義名とツール名を並べる。
- 廃止済み役割の書き換えはしない。報告に該当定義と書き換え先を並べ、対話モードでの再実行を案内する。

### 3-8. README

- 「旧バージョンからの移行」セクションの「`--merge` で再生成すると既存定義の tools にある `Agent` が残るため、手で消してください」を、「setup-agents の再実行で、役割に許されていないツールの削除を確認します」に置き換える。

## 4. 変更対象とテスト

- `src/agents/roles.ts`: `RETIRED_ROLE_REPLACEMENTS` を追加。
- `src/hooks/session-start.ts`: 3-1 の表を参照する。出力文は不変(既存テストで固定)。
- `src/setup-agents.ts`: `listCoverage` に `definitions`、`automaticKeep` の変更、`discarded.tools`。
- `skills/setup-agents/SKILL.md`: ステップ 1b・6b・非対話モード・ステップ 7 の報告項目(`discarded.tools`)。書き換えの前に `prompt-smith:skill-creator` を起動する。
- `README.md`: 3-8。
- テスト(`src/__test__/setup-agents.test.ts`):
  - `definitions` が `Agent` を `disallowedTools` に、`final-review` を `retiredRoles`(書き換え先 `complex-review`)に載せる。
  - 廃止済み ID だけの定義は `disallowedTools` が空になる。`tools` 欄が無い定義は `"*"` になる。
  - `mcp__` のツールは `disallowedTools` に入らない。
  - `--write --merge` で既存の `Agent` が落ち、`discarded.tools` に載る。`--keep tools:Agent` なら残る。
  - 既存にだけある frontmatter キーと本文のセクションは、従来どおり自動保持される。
- スキルの手順は受け入れ基準 A1・A2・A5 を実機の対話で確かめる。

## 5. 不採用案

- 許されていないツールを確認なしで削除する: 利用者が意図して足した組み込みツール(例: `WebFetch`)まで消える。
- 警告だけ出して保持を続ける: 現状と同じく、利用者が手で直すまで残る。
- 廃止済み役割の書き換え専用の CLI 操作を足す: 既存の個別生成で書けるため、契約を増やさない。
- 点検を SessionStart に持たせる: 毎セッションの注入が増える。直す手段は setup-agents にしかない。
