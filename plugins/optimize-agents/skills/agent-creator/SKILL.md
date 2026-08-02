---
name: agent-creator
description: Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt、スキルの作成と測定は skill-eval、指示書の本文だけの改稿は prompt-smith が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。
---

# Agent 定義の作成

対象は `.claude/agents/*.md` と `plugins/*/agents/*.md` である。

## 手順

### 1. 用途を聞く

何をする agent かを聞く。1 つの責務に収まらないときは分割を提案する。公式は "each subagent should excel at one specific task" を設計原則としている。

### 2. 配置を決める

| 配置 | 使う場面 |
| --- | --- |
| `.claude/agents/` | このプロジェクト専用 |
| `~/.claude/agents/` | 全プロジェクトで使う |
| `plugins/<name>/agents/` | プラグインとして配る |

配置で使えるフィールドが変わる。プラグイン配下では `hooks` / `mcpServers` / `permissionMode` を使えない。

### 3. frontmatter を書く

`../../references/agent-definition-spec.md` に従う。

`tools` は必要なものだけを許可する。読み取りだけの agent に `Write` や `Edit` を与えない。

`model` を省略すると `inherit` になる。担当表で実行帯を決める運用なら省略してよい。特定のモデルに固定したいときだけ書く。

### 4. description を書く

`../../references/description-guide.md` の Agents 節に従う。

`<example>` ブロックは使わない。公式ドキュメントに記述がない。

### 5. 本文を書く

`optimize-agents:prompt-smith` の基準に従う。指示だけを残し、根拠は書かない。

本文は system prompt になる。何をする agent か、どう進めるか、何を返すかを書く。

### 6. 検証する

```bash
node plugins/optimize-agents/scripts/check-agent-definition.mjs <定義ファイル>
```

errors が 0 件になるまで直す。warnings は内容を見て判断する。

プラグイン配下なら `claude plugin validate <プラグインのパス>` も併せて使う。これは plugin.json だけを検査する。

SKILL.md とコマンド定義には `check-skill-definition.mjs` を使う。

## 発火を測りたいと言われたとき

Agent 定義の発火精度を自動で測る手段は無い。次を行う。

1. 自動測定を提供していないことを伝える
2. `check-agent-definition` で静的検査を行う
3. 実際に依頼文を投げて `Agent` が呼ばれるかを手で確かめる方法を案内する

`skill-eval` は skill だけを測る。Agent 定義には使えない。
