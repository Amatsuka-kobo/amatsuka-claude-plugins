# Agent 定義の仕様

2026-08-02 時点の Anthropic 公式ドキュメントに基づく。

出典: https://code.claude.com/docs/en/sub-agents / https://code.claude.com/docs/en/plugins-reference

仕様は変わる。この文書と実際の挙動が食い違うときは公式ドキュメントを正とする。

## frontmatter のフィールド

必須は 2 つ。

| フィールド | 内容 |
| --- | --- |
| `name` | 小文字英字とハイフンのみの識別子 |
| `description` | いつこの subagent へ委譲するか |

任意は 14 個。

| フィールド | 値 | 既定 |
| --- | --- | --- |
| `tools` | 使えるツール。カンマ区切りまたは配列 | 省略時はすべて継承 |
| `disallowedTools` | 禁止するツール。`tools` より先に適用される | なし |
| `model` | `sonnet` / `opus` / `haiku` / `fable` / 完全 ID / `inherit` | `inherit` |
| `permissionMode` | `default` / `acceptEdits` / `auto` / `dontAsk` / `bypassPermissions` / `plan` / `manual` | `default` |
| `maxTurns` | 停止までの最大ターン数 | 制限なし |
| `skills` | 起動時にロードするスキル | なし |
| `mcpServers` | 使える MCP サーバー | なし |
| `hooks` | この subagent に閉じたライフサイクルフック | なし |
| `memory` | 永続メモリの範囲。`user` / `project` / `local` | なし |
| `background` | `true` で常にバックグラウンド実行 | `false` |
| `effort` | `low` / `medium` / `high` / `xhigh` / `max` | セッションの設定を継承 |
| `isolation` | `worktree` で専用の git worktree を作る | なし |
| `color` | 表示色。8 色から選ぶ | なし |
| `initialPrompt` | メインセッションとして動くときの最初の入力 | なし |

## 配置による制約

プラグインが提供する agents は 3 つのフィールドを使えない。公式がセキュリティ上の理由として明記している。

| 配置 | 使えないフィールド |
| --- | --- |
| `.claude/agents/` / `~/.claude/agents/` | なし |
| プラグインの `agents/` | `hooks` / `mcpServers` / `permissionMode` |

プラグイン配下では `isolation` の値は `worktree` のみ。

## 優先順位

同名の定義が複数あるとき、上が勝つ。

1. managed settings
2. `--agents` CLI フラグ
3. `.claude/agents/`
4. `~/.claude/agents/`
5. プラグインの `agents/`

プロジェクトの agents は cwd から上へ辿って探す。v2.1.178 以降、同名なら cwd に最も近い定義が勝つ。

プラグインのサブフォルダは識別子に含まれる。`agents/review/security.md` は `my-plugin:review:security` になる。

## model の解決順

1. `CLAUDE_CODE_SUBAGENT_MODEL` 環境変数
2. 起動時に渡した `model`
3. 定義の `model`
4. メイン会話のモデル

## 公式ドキュメントに記述がない事項

次は公式に記述がない。慣習や独自様式であり、公式推奨として扱わない。

- description に `<example>` ブロックを埋め込む形式
- 本文(system prompt)の構成
- 本文の長さ
- 命名の慣例(kebab-case は必須だが、それ以上の推奨はない)

## 公式が示す設計原則

- "Design focused subagents: each subagent should excel at one specific task"
- "Limit tool access: grant only necessary permissions for security and focus"
- 非 fork の subagent は会話履歴・ロード済みスキル・既読ファイルを引き継がない

## 検証手段

| 手段 | 対象 |
| --- | --- |
| `claude plugin validate <path>` | プラグイン配下。`--strict` で警告もエラー扱い |
| `/doctor` | 同一ディレクトリ内の name 重複 |
| `optimize-agents` の `scripts/check-agent-definition.mjs` | プラグイン配下と project 配下の双方 |
