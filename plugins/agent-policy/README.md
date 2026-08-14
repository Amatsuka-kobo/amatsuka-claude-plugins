# agent-policy

Claude Code を使うときのエージェント運用方針を、スキルとして配布する Claude Code プラグインです。

モデル別の役割分担、設計/実装フロー、アドバイザー運用、並列原則、コードベース探索のコスト効率化施策(context-map)を定めます。CLAUDE.md に方針スキルへ従う旨を書くだけで、任意のプロジェクトへ同じ運用を持ち込めます。

## 動作要件

方針スキル自体に依存はありません。

`setup-gpt` / `setup-grok` が使う生成スクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## 導入

Claude Code で Marketplace を追加します。

```text
/plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
```

Marketplace から `agent-policy` をインストールします。

```text
/plugin agent-policy
```

プロジェクト単位またはユーザー単位で導入する場合はスコープを指定します。

```text
/plugin agent-policy --scope project
/plugin agent-policy --scope user
```

## プロファイル

`.claude/agents/` に置かれた Agent 定義に応じて、使う方針スキルを選びます。

| 方針スキル | 使う条件 |
| --- | --- |
| `agent-policy:codex-grok-policy` | `gpt-sol` / `gpt-terra` / `gpt-luna` と `grok-researcher` がすべて存在する |
| `agent-policy:with-codex-policy` | `gpt-*` が存在し、`grok-*` が存在しない |
| `agent-policy:with-grok-policy` | `grok-*` が存在し、`gpt-*` が存在しない |
| `agent-policy:claude-model-policy` | どちらも存在しない |

CLAUDE.md には、選んだ方針スキルへ従う旨を書きます。

```markdown
- 最初に必ず `agent-policy:codex-grok-policy` スキルを使用し、この規律に従う。
```

## Agent 定義のセットアップ

`setup-gpt` と `setup-grok` が、方針で使う Agent 定義を `.claude/agents/` へ生成します。生成するのは Markdown の Agent 定義ファイルのみで、プロキシや秘密値は扱いません。

Codex 系 / Grok 系のモデルをローカルプロキシ(CLIProxyAPI などの ProxyAPI サーバー)経由で使える環境が前提です。

### 対話で生成する

```text
/agent-policy:setup-gpt
/agent-policy:setup-grok
```

モデルエイリアスを確認し、既存ファイルがあれば上書き可否を尋ねます。

### 非対話で生成する

`--yes` を付けると、確認を一切行わず、既定のエイリアスで全ファイルを上書きします。

```bash
claude -p "/agent-policy:setup-gpt --yes"
claude -p "/agent-policy:setup-grok --yes"
```

`--allowedTools` の指定は不要です。スキルが必要な Bash 実行だけを事前承認します。

`--yes` を付けずに `-p` で起動すると対話パスへ入り、応答待ちで止まります。

### CI で生成する

`claude -p` は生成スクリプトが失敗しても終了コード 0 を返しうるため、終了コードで成否を判定したい場合は `claude` を介さず直接実行します。

```bash
node <plugin-root>/scripts/setup-agents.mjs --profile gpt --overwrite
node <plugin-root>/scripts/setup-agents.mjs --profile grok --overwrite
```

`<plugin-root>` は Marketplace 経由でインストールした場合 `~/.claude/plugins/cache/` 配下にあります。

`--bare` は skills と plugins の自動発見をスキップします。将来 `-p` の既定になる予定のため、その環境では `--plugin-dir` を明示するか、上の直接実行を使います。

### 生成されるエージェント

| プロファイル | エージェント | 既定のエイリアス |
| --- | --- | --- |
| gpt | `gpt-sol` | `claude-gpt-5-6-sol` |
| gpt | `gpt-terra` | `claude-gpt-5-6-terra` |
| gpt | `gpt-luna` | `claude-gpt-5-6-luna` |
| grok | `grok-researcher` | `claude-grok-4-5` |
| grok | `grok-implementer` | `claude-grok-4-5` |

エイリアスはモデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名です。対話モードではプロキシ設定に合わせて変更できます。

生成後は Claude Code を再読み込みすると Agent が認識されます。

`.claude/agents/` を git 追跡対象にするか gitignore するかは、プロジェクトごとの判断です。

## 生成スクリプトのオプション

`scripts/setup-agents.mjs` は stdout へ JSON を 1 行出力します。

| オプション | 意味 |
| --- | --- |
| `--profile gpt\|grok` | 必須。生成するプロファイル |
| `--check` | 書き込まず現状のみ報告する |
| `--overwrite` | 既存ファイルを上書きする。無指定時は既存を `skipped` にする |
| `--agents <csv>` | 対象を絞る。既定は全件 |
| `--alias <name>=<alias>` | エイリアスを個別に上書きする。繰り返し指定可 |
| `--dir <path>` | 出力先ルートを明示する。既定は git root、git 管理外なら cwd |

出力先は `<ルート>/.claude/agents/` です。ディレクトリが無ければ作成します。

失敗時は `{"ok": false, "error": "..."}` を出力し、終了コード 1 で終わります。
