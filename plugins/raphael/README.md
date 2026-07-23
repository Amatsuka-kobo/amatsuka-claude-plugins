# raphael

raphael は、セッション中の失敗兆候を infection record として蓄積し、再発防止の「抗体」を次回以降の該当ツール実行時だけ注入する Claude Code プラグインです。

通常時に常駐する指示ファイルを増やさず、`PreToolUse` フックで抗体の正規表現が一致したときだけ予防指示を `additionalContext` として注入します。検知と注入は Node.js の決定的処理であり、Anthropic API や API キーは使用しません。

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
.raphael/log/
.claude/raphael.local.md
```

`.raphael/infections/` には失敗したコマンドやユーザープロンプトの抜粋が保存されます。secret redaction は best-effort であり、機密情報が残らないことを保証しません。**`infections/` はコミットしないでください。**

一方、`.raphael/antibodies/` は再発防止ルールの共有資産です。ignore せず、内容を確認したうえでコミットすることを推奨します。raphael は `.gitignore` を自動変更しません。

## 動作モデル

1. `PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit` フックが、コマンド失敗、連続失敗、ユーザー差し戻し、編集チャーンを検知して infection record に記録します。
2. `Stop` フックは未蒸留 record が既定の 3 件以上になった場合、抗体を作成・更新する専用サブエージェントの起動を促します。
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
stats:
  fired: 0
  last_fired: null
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
| `distill_threshold` | `3` | 蒸留の通知を出す未蒸留 record 件数。`1`–`100` |
| `default_expiry_days` | `30` | 抗体の既定有効日数。`1`–`365` |
| `max_injections` | `3` | 1 回のツール実行で注入する抗体数。`1`–`10` |
| `rejection_patterns` | `[]` | 組み込みの日英差し戻し語彙へ追加する正規表現の JSON 配列 |
| `benign_exit1_commands` | `[]` | exit code 1 を失敗扱いしないコマンド接頭辞の JSON 配列 |
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

組み込みの benign exit-1 コマンドは `grep`、`rg`、`git grep`、`diff`、`git diff --quiet`、`cmp`、`test`、`[` です。コマンドは空白を正規化した接頭辞で比較されます。

## `/raphael:review`

`/raphael:review` は抗体を一覧し、承認、却下、編集するためのレビューコマンドです。承認済みの抗体は `confirmed` になり、`expires` の値を保持したまま期限評価の対象外になります。却下はファイルを削除せず `expired` へ遷移させます。

コマンドは `scripts/list-antibodies.mjs` で一覧・詳細を取得し、`scripts/update-antibody.mjs` だけで更新します。抗体ファイルを直接編集せず、JSON の `ok` 結果と validation error を確認してください。編集では `patch --dry-run` で変更後の抗体を確認してから、同一 JSON patch を適用します。

## データ保存先とライフサイクル

| パス | 内容 | 推奨 Git 方針 |
|---|---|---|
| `.raphael/antibodies/<id>.md` | 再発防止の抗体 | 内容を確認してコミット |
| `.raphael/infections/session-<sha256(session_id)先頭16桁>.jsonl` | 検知した失敗兆候。1 行 1 JSON object | ignore、コミット禁止 |
| `.raphael/state.json` | 現セッションの直近コマンド、編集、注入済み抗体の状態 | ignore |
| `.raphael/log/` | フックのエラーログ | ignore |
| `.claude/raphael.local.md` | プロジェクトローカル設定 | ignore |

感染 record は蒸留後に `distilled: true` として記録され、`Stop` フック実行時に蒸留済みかつ 14 日より古いものを削除します。`state.json` はセッションスクラッチであり、現在の hook input の session が変わると新しい初期 state に切り替わります。

## フェイルオープン

raphael のフックは本来の作業を止めないことを優先します。

- `PreToolUse` は設定、ストア、stdin、正規表現などのエラー時に何も出力せず、注入を行いません。
- `PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit` の検知処理でエラーが起きても、元のツール実行を失敗させません。
- `Stop` の cleanup や通知に失敗しても、セッション終了をブロックしません。
- 抗体ストア内の不正 record は個別にスキップします。正常な抗体まで捨てません。

このため、raphael が失敗した場合は学習または注入が見送られるだけで、通常の Claude Code 作業は継続します。

## 手動シナリオ

次の 3 件で、導入後の基本動作を確認できます。

1. **感染の蓄積と蒸留通知**
   - 同じ失敗する Bash コマンドを 3 回実行します。
   - `PostToolUseFailure` により `command-failure` と `retry-loop` が `.raphael/infections/` に記録されます。
   - セッションを終えると、未蒸留 record が既定の `distill_threshold: 3` 以上であれば、Stop フックが蒸留サブエージェントの起動を促すことを確認します。
2. **抗体の注入**
   - `.raphael/antibodies/` に有効な `active` 抗体を用意します。
   - `trigger.tool` と `trigger.pattern` に一致する Bash、Edit、または Write を実行します。
   - `PreToolUse` の出力に `[raphael:<id>]` 見出し付きの `additionalContext` が含まれ、抗体の `stats.fired` と `stats.last_fired` が更新されることを確認します。
3. **期限とレビュー**
   - `expires` が今日より前の `active` 抗体に一致するツール実行、または Stop フックを発生させます。
   - 抗体が `expired` へ遷移して注入されないことを確認します。
   - `/raphael:review` で抗体を選択し、`confirmed` と `expired` の遷移、および編集時の validation を確認します。

## bundle smoke

利用者はビルド不要です。リポジトリで `src/` を変更した保守者だけが、生成済み `scripts/*.mjs` を更新するためにビルドします。

```bash
pnpm --dir plugins/raphael build
node plugins/raphael/scripts/list-antibodies.mjs --dir "$(mktemp -d)" --json
```

2 行目は空の一時プロジェクトに対して bundle を実行し、`{"ok":true,"antibodies":[],"errors":[]}` を返すことを確認する smoke test です。一時ディレクトリは確認後に削除してください。

実装の構成、CLI schema、検知契約の詳細は [DESIGN.md](DESIGN.md) を参照してください。
