# agent-policy

Claude Code を使うときのエージェント運用方針を、スキルとして配布する Claude Code プラグインです。

モデル別の役割分担、設計/実装フロー、アドバイザー運用、並列原則、コードベース探索のコスト効率化施策(context-map)を定めます。方針スキルに従う 7 種のサブエージェント定義を同梱し、`AMATSUKA_AGENT_AUTO_INJECTION` を設定するだけで、任意のプロジェクトへ同じ運用を持ち込めます。

## 動作要件

方針スキル自体に依存はありません。

SessionStart フックは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

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

環境変数 `AMATSUKA_AGENT_AUTO_INJECTION` の値に応じて、SessionStart フックが使う方針スキルを選び、セッション開始時の指示として自動で注入します。

| `AMATSUKA_AGENT_AUTO_INJECTION` | 使う方針スキル |
| --- | --- |
| `claude` | `agent-policy:claude-model-policy` |
| `with-codex` | `agent-policy:with-codex-policy` |
| `with-grok` | `agent-policy:with-grok-policy` |
| `with-codex-grok` | `agent-policy:codex-grok-policy` |
| `none`(または未設定) | 注入しない |

自動注入を使わず、CLAUDE.md に選んだ方針スキルへ従う旨を直接書くこともできます。

```markdown
- 最初に必ず `agent-policy:codex-grok-policy` スキルを使用し、この規律に従う。
```

## 環境変数

| 変数名 | 用途 | 既定値 |
| --- | --- | --- |
| `AMATSUKA_AGENT_AUTO_INJECTION` | 使う方針スキルの選択(`claude` / `with-codex` / `with-grok` / `with-codex-grok` / `none`) | 未設定(注入しない) |
| `AMATSUKA_AGENT_GPT_SOL_ALIAS` | `gpt-sol` のモデルエイリアス | `claude-gpt-5-6-sol` |
| `AMATSUKA_AGENT_GPT_TERRA_ALIAS` | `gpt-terra` と `gpt-researcher` のモデルエイリアス | `claude-gpt-5-6-terra` |
| `AMATSUKA_AGENT_GPT_LUNA_ALIAS` | `gpt-luna` のモデルエイリアス | `claude-gpt-5-6-luna` |
| `AMATSUKA_AGENT_GROK_ALIAS` | `grok-researcher` と `grok-implementer` のモデルエイリアス | `claude-grok-4-5` |

エイリアスはモデル本体の ID ではなく、ローカルプロキシ(CLIProxyAPI などの ProxyAPI サーバー)が配信するクライアント側の別名です。Codex 系 / Grok 系のモデルをこの ProxyAPI サーバー経由で使える環境が前提です。`claude-researcher` は Anthropic のモデルをそのまま使うため、対応するエイリアス変数はありません。

### 設定場所

これらの変数は、OS の環境変数として与えても、Claude Code の `settings.json` / `settings.local.json` の `env` に書いても構いません。プロジェクト単位で効かせる場合は、そのプロジェクトの `.claude/settings.json` に書きます。

```json
{
  "env": {
    "AMATSUKA_AGENT_AUTO_INJECTION": "with-codex",
    "AMATSUKA_AGENT_GPT_SOL_ALIAS": "my-sol"
  }
}
```

`AMATSUKA_AGENT_AUTO_INJECTION` に上の表にない値を設定した場合、方針スキルは注入されず、値が未知である旨の警告だけが注入されます。

## 同梱エージェント

`plugins/agent-policy/agents/` に 7 定義を同梱しています。呼び出し名は `agent-policy:<name>`(例: `agent-policy:gpt-sol`)です。

| 名前 | 既定モデル | 役割 |
| --- | --- | --- |
| `claude-researcher` | `sonnet` | 独立レビュー・リアルタイム情報調査・コードベース探索実働 |
| `gpt-sol` | `claude-gpt-5-6-sol` | 複雑なコーディング(アーキテクチャ判断・設計トレードオフ) |
| `gpt-terra` | `claude-gpt-5-6-terra` | 通常のコーディング・ドキュメント作成・設定編集・ビルド/テスト実行 |
| `gpt-researcher` | `claude-gpt-5-6-terra` | 独立レビュー・リアルタイム情報調査・コードベース探索実働 |
| `gpt-luna` | `claude-gpt-5-6-luna` | 軽量タスク(一括適用・反復変換・軽微なコーディング) |
| `grok-researcher` | `claude-grok-4-5` | 独立レビュー・リアルタイム情報調査・コードベース探索実働 |
| `grok-implementer` | `claude-grok-4-5` | 通常のコーディング・一括適用・反復変換・ドキュメント作成 |

## エイリアスを変更する

環境変数(例 `AMATSUKA_AGENT_GPT_SOL_ALIAS`)を既定値と異なる値に設定すると、SessionStart フックがそのエージェントの定義を `.claude/agents/` へ生成します。設定場所は「[環境変数](#環境変数)」の「設定場所」を参照してください。

生成は今のセッションには反映されません。次回セッションから効くため、エイリアスに依存する委譲を行う前に Claude Code を再起動してください。

生成された `.claude/agents/` の定義は、同梱定義(`agent-policy:<name>`)より優先されます。

## 旧バージョンからの移行

`setup-gpt` / `setup-grok` スキルは廃止されました。Agent 定義は同梱で提供されるため、生成の手間なく使えます。

旧セットアップが `.claude/agents/` へ生成した `gpt-*.md` / `grok-*.md` は、同梱定義より優先されるファイルとして残り続けます。削除しないと、同梱定義を更新しても古い定義が使われ続けます。SessionStart フックはこれらの残骸を検知すると、セッション開始時に削除を促す通知を出します。
