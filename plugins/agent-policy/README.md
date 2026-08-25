# agent-policy

Claude Code を使うときのエージェント運用方針を、スキルとして配布する Claude Code プラグインです。

モデル別の役割分担、設計/実装フロー、アドバイザー運用、並列原則、コードベース探索のコスト効率化施策(context-map)を定めます。方針スキルに従う 4 種のプリセット定義を同梱し、役割を選んでプロジェクト固有の Agent 定義も作れます。`AMATSUKA_AGENT_AUTO_INJECTION` を設定すれば、任意のプロジェクトへ同じ運用を持ち込めます。

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
| `AMATSUKA_AGENT_GPT_TERRA_ALIAS` | `gpt-terra` のモデルエイリアス | `claude-gpt-5-6-terra` |
| `AMATSUKA_AGENT_GPT_LUNA_ALIAS` | `gpt-luna` のモデルエイリアス | `claude-gpt-5-6-luna` |
| `AMATSUKA_AGENT_GROK_ALIAS` | `grok` のモデルエイリアス | `claude-grok-4-6` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Claude Code が全サブエージェントへ適用するモデル | 未設定 |

エイリアスはモデル本体の ID ではなく、ローカルプロキシ(CLIProxyAPI などの ProxyAPI サーバー)が配信するクライアント側の別名です。Codex 系 / Grok 系のモデルをこの ProxyAPI サーバー経由で使える環境が前提です。

`CLAUDE_CODE_SUBAGENT_MODEL` を設定すると、Agent 定義の frontmatter にある `model` より優先されます。定義ごとに選んだモデルを使う場合は設定しないでください。

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

プラグインの `agents/` には、役割断片からビルド生成した 4 種のプリセット定義を同梱しています。呼び出し名は `agent-policy:<name>`(例: `agent-policy:gpt-sol`)です。

| 名前 | 既定モデル | color | 役割 ID |
| --- | --- | --- | --- |
| `gpt-sol` | `claude-gpt-5-6-sol` | yellow | `complex-impl` |
| `gpt-terra` | `claude-gpt-5-6-terra` | green | `normal-impl`, `general`, `explore`, `realtime-research`, `independent-review` |
| `gpt-luna` | `claude-gpt-5-6-luna` | cyan | `light-impl` |
| `grok` | `claude-grok-4-6` | red | `normal-impl`, `light-impl`, `general`, `explore`, `realtime-research`, `independent-review` |

利用者が setup で作る定義の color は、`--list-models` が返すモデル別の値を使います。

| モデル ID | color |
| --- | --- |
| `opus` | blue |
| `sonnet` | purple |
| `haiku` | pink |
| `fable` | orange |
| `gpt-sol` | yellow |
| `gpt-terra` | green |
| `gpt-luna` | cyan |
| `grok` | red |

## エイリアスを変更する

同梱プリセットは上の表の既定エイリアスを使います。別名を使う場合は、対応する `AMATSUKA_AGENT_*_ALIAS` を設定したうえで、`agent-policy:setup-agents` を実行してプロジェクトの `.claude/agents/` に定義を生成してください。

SessionStart フックは Agent 定義を生成せず、ファイルも書き込みません。既定値と異なるエイリアスが環境変数に設定されているときだけ、プロジェクト側の対応する定義が無い、または `model` が一致しないことを検知して setup の実行を促します。環境変数が未設定、または既定値と同じ場合は不一致を検知しません。

プロジェクトの `.claude/agents/` に生成した定義は同梱プリセットより優先されます。既存定義がある状態で setup を実行した場合は、差分を確認して、利用者が加えた tools・frontmatter・節を保持するか選べます。

## 役割を選んで自分の定義を作る

`agent-policy:setup-agents` は、選んだ運用方針に沿って複数の Agent 定義をまとめて作る対話ウィザードです。

```text
/agent-policy:setup-agents
```

対話モードでは次の順に選びます。

1. 使用言語を確認します。日本語と英語の役割断片は同梱されています。それ以外の言語では `.claude/agent-policy/roles/<lang>/` に英語の雛形を作り、翻訳してから生成します。
2. `claude-model-policy` / `with-codex-policy` / `with-grok-policy` / `codex-grok-policy` から運用方針を選びます。`AMATSUKA_AGENT_AUTO_INJECTION` と一致する方針があれば第一候補になります。
3. 方針の担当表に登場するモデルから、生成するものを複数選びます。担当表にないモデルと役割の組み合わせは選べません。
4. 必要なモデルだけ、定義名・`model`・役割・既存定義の保持方法を個別に調整します。調整しないモデルは既定名と既定役割で一括生成します。
5. 接続済みの MCP サーバーを検出し、許可するサーバーと付与先の役割を選びます。既定では MCP ツールを付けません。既存定義があれば前回の選択を読み戻します。

MCP サーバーの検出には `claude mcp list` を使い、接続済みまたはキャッシュ済みのサーバーだけを候補にします。WebSocket 経由の MCP サーバーは検出対象外です。読み取り役割へ MCP を付ける場合は、外部状態を変更するツールを `disallowedTools` へ入れる案を確認してから生成します。

`--yes` を渡す非対話モードでは、`--policy <id>` または `AMATSUKA_AGENT_AUTO_INJECTION` から方針を決め、その方針の全モデルを既定名・既定役割でまとめて生成します。明示的な選択がないため MCP ツールは付きません。

組み込みの役割 ID は次の 10 種です。

| 役割 ID | 内容 |
| --- | --- |
| `complex-impl` | 複雑または重要な実装 |
| `normal-impl` | 通常の実装 |
| `light-impl` | 軽量な実装 |
| `general` | その他のタスク |
| `explore` | コードベース探索実働 |
| `realtime-research` | リアルタイム情報調査 |
| `independent-review` | 設計書・実装計画書の独立レビュー |
| `doc-review` | 設計書・実装計画書のレビュー |
| `code-review` | コードレビュー |
| `advisor` | 設計・計画・実装のアドバイザー |

生成した定義の frontmatter には、選んだ役割を記録する `agent-policy-role` マーカーが入ります。

```yaml
agent-policy-role: normal-impl, explore
```

SessionStart フックはプロジェクトの `.claude/agents/` を走査し、このマーカーから「役割 → Agent 名」の対応をセッションへ注入します。方針スキルの担当表に該当する役割があるときは、この対応を優先して使います。注入される役割マーカー表の役割名は日本語表記です。

プロジェクト固有の役割断片は `.claude/agent-policy/roles/` に Markdown ファイルとして置けます。断片の frontmatter には `id`、`label`、`description`、`tools`、`kind` を指定します。`kind` は `impl` または `readonly` です。独自の `id` は setup の選択肢に追加され、既存の役割と同じ `id` を指定すると組み込み断片を置き換えます。

断片の節見出しは、生成時に選んだ言語の見出し集合と一致させてください。`--lang ja` では `## 作業手順` / `## 制約`、それ以外では `## Procedure` / `## Constraints` を使います。一致しない見出しの節は合成結果に現れません。`ja` / `en` 以外の翻訳断片でも見出しは英語のままにし、翻訳するのは本文と frontmatter の `label` / `description` です。

SessionStart フックは独自役割の表示名を解決するとき、`.claude/agent-policy/roles/<id>.md` に加えて `.claude/agent-policy/roles/*/<id>.md` も走査します。同じ役割 ID が複数の言語ディレクトリにある場合、フックは会話言語を知らないため、どの表示名が使われるかは決まりません。

## 旧バージョンからの移行

1. `claude-researcher.md`、`gpt-researcher.md`、`grok-researcher.md`、`grok-implementer.md` は廃止しました。`.claude/agents/` に残っていれば削除してください。プロジェクト定義は同梱定義より優先されるため、放置すると古い定義が使われ続けます。SessionStart フックは残骸を検知すると削除を促す通知を出します。
2. Grok の既定エイリアスは `claude-grok-4-5` から `claude-grok-4-6` へ変わりました。
   - プロキシ設定に `claude-grok-4-6` の別名が無い場合、委譲時に `unknown provider for model` で失敗します。
   - `AMATSUKA_AGENT_GROK_ALIAS` が未設定なら、フックが既定値と一致するとみなすため、エイリアス不一致としては検知されません。
   - ただし手順 1 の廃止済み定義(`grok-researcher.md` など)が `.claude/agents/` に残っていて、かつ `AMATSUKA_AGENT_GROK_ALIAS` が未設定の場合は、残骸通知にこのエイリアス変更が併記されます。
   - 推奨する対処は、プロキシ設定に `claude-grok-4-6` の別名を追加することです。
   - CLIProxyAPI では `oauth-model-alias` の `xai` に `grok-4.6` → `claude-grok-4-6` を追加します。
   - Grok 4.5 を使い続ける場合は、`AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を明示的に設定してください。
3. MCP ツールは同梱定義から外れました。同梱定義には引き続き付かず、必要な定義へは手順 6 の setup で付与できます。
4. `setup-gpt` と `setup-grok` は `setup-agents` へ統合しました。ポリシーとモデルと役割を選んで複数の定義を一度に作れます。
5. 役割定義から `LSP` を外しました。背景で起動するサブエージェントでは Claude Code が `LSP` を除去するため、定義に書いても機能しません。
6. MCP ツールを付けられるようになりました。`claude mcp list` で接続済みのサーバーを検出し、許可するものを選ぶと `tools` へ入ります。既定では付きません。前回の選択は生成された定義から読み戻します。
7. `_common.md` の共通規律を変更しました。
   - 制約から GitHub の名指しを外し、「外部システムへの不可逆な副作用」という一般則へ書き換えました。この規律を外したい場合は `.claude/agent-policy/roles/_common.md` に `## 制約` 節を書いて差し替えてください。
   - アドバイザーの相談先は、`Fable`(起動できなければ `Opus`)を直接指定する方式から、担当表の「設計・計画・実装のアドバイザー」帯の定義を使う方式へ変わりました。プロジェクトに該当する定義がなければ、`model` 上書きで `Fable`、起動できなければ `Opus` を指定します。
8. 方針スキルの「実行帯の解決順」から、定義名による探索を外しました。プロジェクト定義は `agent-policy-role` マーカーで解決されます。マーカーを持たない手書きの定義は、マーカーを 1 行足してください。
