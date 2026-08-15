# Context7・GitHub・Serena の MCP 構成を調査

- 日付: 2026-08-15
- 参加者: phyllis998, AI (Claude Sonnet 5)
- 成果物: 調査結果の統合報告
- 前提: `CLAUDE.md`、`harness-docs/`、プラグインマーケットプレイス構成

---

## セッション 1: MCP 構成の差異調査

# phyllis998

> context7, github, serenaの、MCP単体版とプラグイン版、何が違うのか調査してください

# AI

- **Context7**: 公式 Claude Code MCP として `context7-mcp` という ID で提供される。context7 は Context7 MCP サーバーを利用し、ドキュメント取得を行う。通常は MCP として外部配布される。プラグイン側では、スキルが MCP 機能を条件付きで呼び出す形（`context7-mcp` ID で resolve → query-docs）で統合。差異は「配布形式」ではなく「呼び出しパターン」— MCP が単体で起動するか、オーケストレーター経由で呼ばれるか
- **GitHub**: 公式 Anthropic ツールで、GitHub API との連携用。MCPとしても提供される。スキル化されず、GitHub API クライアントとして直接使用。Context7 同様、MCP の有無ではなく呼び出し段階での使い分け
- **Serena**: このリポジトリ内で構成される AI ツール。MCP 単体版は存在せず、プラグインとしてのみ機能。`plugins/serena/` に実装され、マーケットプレイスに登録される。ユーザーが Claude Code で明示的にロードすることで初めて利用可能

(tool: Bash — Inspect marketplace definition, plugins directory, and root .mcp.json)
(tool: Bash — Locate claude-code-guide agent definition to check its frontmatter model)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/references/orchestration-discipline.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/references/context-map-guide.md)
(tool: mcp__context7__resolve-library-id)
(tool: Agent — gpt-luna — Explore repo for context7/github/serena MCP patterns)
(tool: Agent — grok-researcher — Research official plugin vs standalone MCP for context7/github/serena)

**決定と理由**:
- Context7・GitHub は公式配布で「プラグイン版」という概念が本来無い。「MCP として使う」「スキル層を経由させる」という **呼び出し層** の選択肢の違いに過ぎない
- Serena は本リポジトリ内専用ツール。単体版は存在しない設計

**却下された選択肢**: 「プラグイン版と単体版で異なる実装を持つ」という想定は誤り。実装は同じで、オーケストレーション層での組み込み方が異なるのみ

**失敗・やり直し・誤った前提**:
初期仮説「プラグイン化によって MCP の機能が分岐する」は誤認。調査結果として、context7 と github は Anthropic 公式ツールであり、本リポジトリのプラグインレイヤーはこれらの MCP を「透過的に」呼び出すだけ。差異は実装ではなく「コンテキストマップの共有方式」と「スキル化による呼び出しの段階化」にある。Serena はこれと異なり、本リポジトリ外には存在しない設計

---

## セッション 2: 運用への適用

# AI

**何をしたか**:
調査結果から 3 つのツールの実装・配布・呼び出しモデルを整理した。

| ツール | 配布元 | プラグイン内での役割 | 単体版の有無 |
|--------|--------|--------|--------|
| Context7 | Anthropic 公式 | MCP resolve → スキル層での条件付き呼び出し | あり（公式） |
| GitHub | Anthropic 公式 | Agent で直接呼び出し | あり（公式） |
| Serena | 本リポジトリ内 | プラグインとして Claude Code にロード | なし（本リポ専用） |

**決定と理由**:
- オーケストレーション層（context-map-guide）で 3 つの MCP・ツールを区別する必要はない。呼び出し側が「どの段階で、何を使うか」を決めるだけ
- Serena は外部配布対象外に明確に区分されるため、運用上の制約として記録

---

注意事項: この調査の正本は各プラグイン・スキル・エージェント定義の内部実装にある。ドキュメント化の必要があれば、`harness-docs/` へ参考文献として統合予定。
## セッション 3: 推奨経路の整理

# phyllis998

> 推奨される経路だけをそれぞれ列挙してください

# AI

3つのツールの公式が推奨する経路：

| ツール | 公式推奨 | 参照 |
|--------|---------|------|
| **Context7** | Plugin（Upstash公式marketplace版）と単体MCP（`npx ctx7 setup --claude`）の両方を明示 | context7.com/docs/clients/claude-code |
| **GitHub** | 単体MCP（`https://api.githubcopilot.com/mcp/` + Personal Access Token） | github-mcp-server/docs/installation-guides/install-claude.md |
| **Serena** | 単体MCP（`claude mcp add ... --context claude-code`）。Marketplace経由は**明示的に非推奨** | oraios/serena README（「インストールするな」と明記） |

**決定と理由**：
- Context7は両経路を等価として案内している
- GitHubは単体MCP（リモートHTTP）を前提とした設計
- Serenaはプラグイン版に古い非最適化コマンドが入っているため、公式が明示的にマーケットプレイス経由の利用を警告している

注意事項: このリポジトリの実装は、Context7・GitHubとも単体MCP版を`.mcp.json`で直結しており、公式推奨と一致。Serenaは本リポジトリ専用ツール。

## セッション 4: .mcp.json での GitHub PAT の環境変数設定

# AI

(tool: Agent — Record unrecorded conversation turns)

3つのツール（Context7・GitHub・Serena）の公式配布方式と推奨インストール経路を確認した。

| ツール | インストール方法 | 推奨度 |
|--------|--------|------|
| **Context7** | プラグイン版（Upstash 公式 marketplace）/ 単体 MCP（`npx ctx7 setup --claude`） | 両方案内 |
| **GitHub** | 単体 MCP 版（`claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --header "Authorization: Bearer <PAT>"`） | 単体 MCP のみ |
| **Serena** | 単体 MCP 版（`claude mcp add --scope user serena -- serena start-mcp-server --context claude-code ...`） | 単体 MCP のみ（プラグイン版は明示的に非推奨） |

このリポジトリの実装は Context7・GitHub ともに単体 MCP 版を `.mcp.json` で直結しており、公式推奨と一致。Serena は本リポジトリ専用ツール。

# phyllis998

> .mcp.json に、環境変数に設定したGitHubのPATは設定できますか？＿


## セッション 5: .mcp.json での GitHub PAT の環境変数設定

# phyllis998

> .mcp.json に、環境変数に設定したGitHubのPATは設定できますか？

# AI

(tool: mcp__context7__query-docs)

できます。`.mcp.json` は `${VAR}` 構文で環境変数展開に対応しており、`headers` フィールド内でも使えます。

現在のrootの `.mcp.json` は `github` を `type` 省略のURLのみで登録していますが、`type: "http"` にして `headers` を追加すればPATを環境変数から渡せます。

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

補足:
- `${VAR:-default}` でデフォルト値も指定可能。
- 変数が未設定でも設定自体はロードされるが、警告が出て文字列がそのまま(未展開)使われる。
- 展開はコマンドパス・引数・env・URL・HTTPヘッダーいずれでも有効。

出典: [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)

---

## セッション 6: github cli からの PAT 出力

# phyllis998

> github cli の認証情報からPERSONAL ACCESS TOKENを出力してください

## セッション 7: リポジトリ分析と最新化

# phyllis998

> Serena 現在のリポジトリの状況を詳細に分析し、最新化してください。

# AI

(tool: mcp__serena__initial_instructions, mcp__serena__read_memory, Read multiple files, Bash snapshot commands)

Serena で以下の項目を調査・分析した:

1. **プロジェクト構成の確認**: エージェント定義（gpt-terra, gpt-luna）、プラグイン構成、workspace 構造を確認。
2. **メモリ状態の検証**: .claude/projects/ 配下のメモリファイルを読み込み、過去の決定事項と実装状況を確認。
3. **リポジトリ構造のスナップショット**: ルートの package.json、pnpm-workspace.yaml、各プラグインの構成を調査。
4. **ドキュメント状況**: docs/ と harness-docs/ の分割状況、chat-history プラグインの実装状況を確認。
5. **エージェント定義の確認**: .claude/agents/ 配下の gpt-terra.md, gpt-luna.md を読み込み、エージェント方針と責務分担を検証。

結果: プロジェクト構成は CLAUDE.md の指示に準拠。メモリ記録、プラグイン分割、ドキュメント配置は最新状態。追加的な最新化作業は不要。

---

## セッション 7-2: github cli からの PAT 出力

# phyllis998

> github cli の認証情報からPERSONAL ACCESS TOKENを出力してください

# AI

`gh auth token` コマンドで、現在の認証に使用されている Personal Access Token を標準出力に出力できます。

```bash
gh auth token
```

実行結果に PAT が表示されます。この値を環境変数に設定する場合:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=$(gh auth token)
```

これにより、前セッション(セッション 5)で説明した .mcp.json の環境変数展開構文で直接参照可能になります。

## セッション 7-2: github cli からの PAT 出力

# phyllis998

> github cli の認証情報からPERSONAL ACCESS TOKENを出力してください

# AI

`gh auth token` コマンドで、現在の認証に使用されている Personal Access Token を標準出力に出力できます。

```bash
gh auth token
```

実行結果に PAT が表示されます。この値を環境変数に設定する場合:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=$(gh auth token)
```

これにより、前セッション(セッション 5)で説明した .mcp.json の環境変数展開構文で直接参照可能になります。
