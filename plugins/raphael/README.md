# raphael

raphael は、セッション中の失敗兆候を infection record として蓄積し、再発防止の「抗体」を次回以降の該当ツール実行時だけ注入する Claude Code プラグインです。

通常時に常駐する指示ファイルを増やさず、`PreToolUse` フックで抗体の正規表現が一致したときだけ予防指示を `additionalContext` として注入します。検知と注入は Node.js の決定的処理であり、Anthropic API や API キーは使用しません。

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## 導入

Claude Code で Marketplace を追加します。

```text
/plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
```

Marketplace から `raphael` をインストールします。

```text
/plugin raphael
```

プロジェクト単位またはユーザー単位で導入する場合はスコープを指定します。

```text
/plugin raphael --scope project
/plugin raphael --scope user
```

インストールまたはフック設定の更新後は、Claude Code のセッションを再起動してフックを反映してください。

## `.gitignore` の設定

raphael のプロジェクトデータはプロジェクトルートの `.raphael/` に保存されます。利用プロジェクトの `.gitignore` には次を追加することを推奨します。

```gitignore
.raphael/infections/
.raphael/state.json
.raphael/stats.json
.raphael/commands.jsonl
.raphael/log/
.claude/raphael.local.md
```

`.raphael/infections/` には失敗したコマンドやユーザープロンプトの抜粋が保存されます。secret redaction は best-effort であり、機密情報が残らないことを保証しません。**`infections/` はコミットしないでください。**

一方、`.raphael/antibodies/` は再発防止ルールの共有資産です。ignore せず、内容を確認したうえでコミットすることを推奨します。raphael は `.gitignore` を自動変更しません。

## 動作モデル

1. `PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit` フックが、コマンド失敗、連続失敗、ユーザー差し戻し、編集チャーンを検知して infection record に記録します。
2. `Stop` フックは未蒸留かつ未解決の再発キーの種類数が既定の 3 以上になった場合、抗体を作成・更新する専用サブエージェントの起動を促します。
3. `PreToolUse` フックは `active` または `confirmed` の抗体を評価し、マッチしたものだけを注入します。1 回に注入する抗体数は既定で最大 3 件です。

抗体は `.raphael/antibodies/<id>.md` の Markdown + YAML frontmatter です。frontmatter は発火条件、本文は発火時に注入する予防指示です。

```markdown
---
id: ab-2026-0724-001
created: 2026-07-24
source: manual
trigger:
  event: PreToolUse
  tool: Bash
  pattern: "pnpm\\s+test"
  scope: "src/**"
status: active
expires: 2026-08-23
---

テストを実行する前に、対象パッケージと既知の失敗条件を確認すること。
```

`scope` は `Edit` と `Write` のプロジェクト相対 POSIX パスにだけ適用され、`Bash` では無視されます。抗体ファイルを手書きで更新する代わりに、管理 CLI を使用して frontmatter の整合性を保ってください。

## 設定

設定ファイルはプロジェクトの `.claude/raphael.local.md` です。存在しない場合、または個別の値が不正な場合は、その値だけ組み込み既定値を使います。設定は flat frontmatter の許可済み key のみを読み取ります。

以下は全設定 key と既定値を含むテンプレートです。

```markdown
---
detect_command_failure: true
detect_retry_loop: true
detect_user_rejection: true
detect_edit_churn: true
retry_threshold: 3
edit_churn_threshold: 3
distill_threshold: 3
default_expiry_days: 30
max_injections: 3
rejection_patterns: []
benign_exit1_commands: []
benign_exit1_extended: true
breadth_max_ratio: 10
breadth_min_corpus: 50
miss_window_minutes: 30
ineffective_min_fired: 10
ineffective_miss_ratio: 50
antibodies_git_policy: commit
---
```

| Key | 既定値 | 説明 |
|---|---:|---|
| `detect_command_failure` | `true` | Bash の失敗を検知する |
| `detect_retry_loop` | `true` | 同じ正規化済みコマンドの連続失敗を検知する |
| `detect_user_rejection` | `true` | ユーザー差し戻し語を検知する |
| `detect_edit_churn` | `true` | 同じファイルの重なる編集を検知する |
| `retry_threshold` | `3` | リトライループとみなす連続失敗回数。`2`–`10` |
| `edit_churn_threshold` | `3` | 編集チャーンとみなす重なる編集回数。`2`–`10` |
| `distill_threshold` | `3` | 蒸留の通知を出す未解決の再発キーの種類数。`1`–`100` |
| `default_expiry_days` | `30` | 抗体の既定有効日数。`1`–`365` |
| `max_injections` | `3` | 1 回のツール実行で注入する抗体数。`1`–`10` |
| `rejection_patterns` | `[]` | 組み込みの日英差し戻し語彙へ追加する正規表現の JSON 配列 |
| `benign_exit1_commands` | `[]` | exit code 1 を失敗扱いしないコマンド接頭辞の JSON 配列 |
| `benign_exit1_extended` | `true` | テスト・lint・型検査ランナー等の拡張 benign 判定を有効にする |
| `breadth_max_ratio` | `10` | trigger の広さ検査で許容する一致率の上限(整数 1–100、百分率) |
| `breadth_min_corpus` | `50` | 広さ検査を行うために必要な母集団の最小件数(整数 1–5000) |
| `miss_window_minutes` | `30` | 注入後の失敗を miss と突き合わせる時間窓(分、整数 1–1440) |
| `ineffective_min_fired` | `10` | ineffective 判定に必要な最小発火回数(整数 1–1000) |
| `ineffective_miss_ratio` | `50` | ineffective 判定の miss 比率閾値(整数 1–100、百分率) |
| `antibodies_git_policy` | `commit` | 抗体の Git 方針。`commit` または `ignore` |

`rejection_patterns` は組み込み語彙を置換せず、追加します。たとえば、日本語と英語の追加語彙は次のように指定します。

```markdown
---
rejection_patterns: ["(?:期待と違う|それは違います)", "\\bplease (?:revert|undo) this\\b"]
---
```

正規表現として不正な追加パターンは、そのパターンだけを無視します。

`benign_exit1_commands` は、exit code が **1 の場合だけ**組み込み除外リストに追加されます。たとえば `pnpm lint` の exit 1 を無害として扱う場合は、次のように指定します。

```markdown
---
benign_exit1_commands: ["pnpm lint"]
---
```

組み込みの基本 benign exit-1 コマンドは `grep`、`rg`、`git grep`、`diff`、`git diff --quiet`、`cmp`、`test`、`[` です。`benign_exit1_extended: true`(既定)では、`vitest`、`jest`、`mocha`、`pytest`、`biome`、`eslint`、`prettier`、`tsc` と、`test`、`lint`、`typecheck`、`check` の script を拡張リストとして扱います。拡張リストは exit code 1 と 2 の両方に適用されます。false にすると拡張リストと正規化を無効にできます。

拡張リストの比較では、複合コマンドの最後のセグメント、環境変数代入、`npx` / `pnpm dlx`、pnpm/npm/yarn の option・`exec`・`run`、実行ファイルの basename を順に正規化します。接頭辞比較は直後が空白または終端であることを要求するため、`pnpm test` は `pnpm test:unit` に一致しません。このため、`pnpm test` は `pnpm test:unit` に一致しません。

## 移行手順

stats 分離への移行は必須ではありませんが、強く推奨します。次の順で実行してください。

1. 利用プロジェクトの `.gitignore` に `.raphael/stats.json` と `.raphael/commands.jsonl` を追記します。
2. `--dry-run migrate-stats` で移行内容を確認します。

   ```bash
   printf '{}' | node plugins/raphael/scripts/update-antibody.mjs --dry-run migrate-stats
   ```

3. 問題がなければ `migrate-stats` を実行します。

   ```bash
   printf '{}' | node plugins/raphael/scripts/update-antibody.mjs migrate-stats
   ```

4. 抗体ファイル全件が dirty になるので、内容を確認してコミットします。frontmatter の `stats` ブロックは `.raphael/stats.json` へ移ります。
5. `audit` で棚卸しします。

   ```bash
   printf '{}' | node plugins/raphael/scripts/update-antibody.mjs audit
   ```

移行しなくても抗体は読めますが、`list-antibodies` では frontmatter の旧統計を使わないため全件 `fired: 0` に見えます。書き込み operation を通した抗体だけ、その時点で `stats` ブロックが消えます。移行後は発火統計を `.raphael/stats.json` に保存するため、抗体ファイルは発火で dirty になりません。

`audit` の広さ検査は `.raphael/commands.jsonl` を母集団にするため、改修直後は母集団が空です。母集団が 50 件に満たない間は全抗体が `corpus_too_small` になり、`noisy` は付きません。通常の作業で履歴を蓄積してから棚卸ししてください。

## `/raphael:review`

`/raphael:review` は抗体を一覧し、承認、却下、編集、`confirmed` から `active` への格下げを行うレビューコマンドです。承認済みの抗体は `confirmed` になり、`expires` の値を保持したまま期限評価の対象外になります。却下はファイルを削除せず `expired` へ遷移させます。`list-antibodies --ineffective` で効かない候補を絞り込めます。また、`audit` の結果から `recommendation` が `expire` または `narrow` の抗体を順にレビューする導線を利用できます。提案は自動適用されず、最終判断はレビューで行います。

コマンドは `scripts/list-antibodies.mjs` で一覧・詳細を取得し、`scripts/update-antibody.mjs` だけで更新します。抗体ファイルを直接編集せず、JSON の `ok` 結果と validation error を確認してください。編集では `patch --dry-run` で変更後の抗体を確認してから、同一 JSON patch を適用します。

## データ保存先とライフサイクル

| パス | 内容 | 推奨 Git 方針 |
|---|---|---|
| `.raphael/antibodies/<id>.md` | 再発防止の抗体 | 内容を確認してコミット |
| `.raphael/infections/session-<sha256(session_id)先頭16桁>.jsonl` | 検知した失敗兆候。1 行 1 JSON object | ignore、コミット禁止 |
| `.raphael/state.json` | 現セッションの直近コマンド、編集、注入済み抗体の状態 | ignore |
| `.raphael/stats.json` | セッションを跨ぐ発火・miss 統計と蒸留通知 digest | ignore |
| `.raphael/commands.jsonl` | 成功・失敗を問わず記録するコマンド履歴。広さ検査・audit の母集団 | ignore |
| `.raphael/log/` | フックのエラーログ | ignore |
| `.claude/raphael.local.md` | プロジェクトローカル設定 | ignore |

感染 record は蒸留後に `distilled: true` として記録されます。`Stop` フック実行時には蒸留済みかつ 14 日より古い record、または `resolved: true` かつ `resolved_at` から 14 日より古い record を削除し、stats の孤児 entry を削除します。`.raphael/commands.jsonl` は 2,000 行へ切り詰めます。`state.json` はセッションスクラッチであり、現在の hook input の session が変わると新しい初期 state に切り替わります。

## フェイルオープン

raphael のフックは本来の作業を止めないことを優先します。

- `PreToolUse` は設定、ストア、stdin、正規表現などのエラー時に何も出力せず、注入を行いません。
- `PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit` の検知処理でエラーが起きても、元のツール実行を失敗させません。
- `Stop` の cleanup や通知に失敗しても、セッション終了をブロックしません。
- 抗体ストア内の不正 record は個別にスキップします。正常な抗体まで捨てません。

このため、raphael が失敗した場合は学習または注入が見送られるだけで、通常の Claude Code 作業は継続します。

## 手動シナリオ

実装後の確認は、新しいセッションで次の順に行います。hook の配線を変更した場合は、セッションを再起動してから始めてください。

1. **移行(前提)**
   - `printf '{}' | node plugins/raphael/scripts/update-antibody.mjs --dry-run migrate-stats` で確認した後、`printf '{}' | node plugins/raphael/scripts/update-antibody.mjs migrate-stats` を実行します。
   - `migrated` が実行時点の抗体数であり、`.raphael/stats.json` の `fired` 合計が移行前と一致し、抗体ファイルから `stats` が消えることを確認します。
   - 移行直後は抗体ファイル全件が dirty になるため、内容を確認してコミットします。
2. **意図した失敗を 3 回起こしても催促が出ないこと**
   - `pnpm vitest run plugins/raphael/src/lib/__test__/frontmatter.test.ts -t "存在しないテスト名"` のような exit 1 のテストランナーを 3 回実行して Stop します。
   - infection record は増えず、成功・失敗を問わず `.raphael/commands.jsonl` は増え、Stop の蒸留催促は出ないことを確認します。
   - 対照として、異なる存在しないコマンドを 3 種類実行すると、再発キーが 3 種類になり催促が出ること、同じコマンドを 3 回繰り返すと種類数 1 で催促が出ないことを確認します。`exit 128` は failure として記録されることも確認します。
3. **無関係な読み取りコマンドへの注入と audit**
   - `ab-2026-0803-002` の pattern は `&&.*[|;]` です。`ls -la && cat plugins/raphael/README.md | head -3` のように実際に pattern へ一致する、失敗と何の関係もない読み取り専用コマンドを実行します。
   - pattern を絞るか失効させた後なら、`ab-2026-0803-002` が注入されないことを確認します。対処前は一致するため注入されます。
   - `.raphael/commands.jsonl` の一意コマンド数が 50 件を超えるまで通常作業を行い、`wc -l .raphael/commands.jsonl` と `printf '{}' | node plugins/raphael/scripts/update-antibody.mjs audit` を実行します。
   - audit の `thresholds.breadth_max_ratio` が 10 であり、`ab-2026-0803-002` が `noisy: true`、`recommendation: narrow` または `expire` になることを確認します。この判定は 1 本のコマンドではなく `commands.jsonl` の母集団全体への一致率で決まります。`ab-2026-0810-001` など lint 系は広さ検査では捕まらず、`misses`(`ineffective`)側で判定されるため、`noisy` にならなくても不具合ではありません。
   - `/raphael:review` の `audit 結果を順にレビュー` から棚卸しし、pattern を絞るか失効させた後、同じ読み取りコマンドへ注入されないことを確認します。
4. **移行後に抗体が dirty にならないこと**
   - 移行結果をコミットした後、抗体が何度か注入される状態で通常作業を 10 分ほど行います。
   - `git status --porcelain .raphael/antibodies/` と `git status --porcelain .raphael/stats.json .raphael/commands.jsonl` を実行し、どちらも空であることを確認します。発火は stats.json に記録され、stats.json と commands.jsonl は ignore されています。

## bundle smoke

利用者はビルド不要です。リポジトリで `src/` を変更した保守者だけが、生成済み `scripts/*.mjs` を更新するためにビルドします。

```bash
pnpm --dir plugins/raphael build
node plugins/raphael/scripts/list-antibodies.mjs --dir "$(mktemp -d)" --json
```

2 行目は空の一時プロジェクトに対して bundle を実行し、`{"ok":true,"antibodies":[],"errors":[]}` を返すことを確認する smoke test です。一時ディレクトリは確認後に削除してください。

実装の構成、CLI schema、検知契約の詳細は [DESIGN.md](DESIGN.md) を参照してください。
