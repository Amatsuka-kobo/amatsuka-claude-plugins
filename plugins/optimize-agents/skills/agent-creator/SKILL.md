---
name: agent-creator
description: Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gptが担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。
---

# Agent 定義の作成

対象は `.claude/agents/*.md` と `plugins/*/agents/*.md` である。
`../../references/agent-definition-spec.md` を併せて読み、これに従う。

## 手順

### 1. 用途を聞く

何をする agent かを聞く。1 つの責務に収まらないときは分割を提案する。

### 2. 配置を決める

| 配置                     | 使う場面             |
| ------------------------ | -------------------- |
| `.claude/agents/`        | このプロジェクト専用 |
| `~/.claude/agents/`      | 全プロジェクトで使う |
| `plugins/<name>/agents/` | プラグインとして配る |

配置で使えるフィールドが変わる。

### 3. frontmatter を書く

- `tools` は必要なものだけを許可する。読み取りだけの agent に `Write` や `Edit` を与えない。
- `model` は、担当表で実行帯を決める運用なら省略する。特定のモデルに固定したいときだけ書く。

### 4. description を書く

- `../../references/description-guide.md` に従う。

### 5. 本文を書く

- `optimize-agents:prompt-smith` の基準に従う。
- 本文は system prompt になる。何をする agent か、どう進めるか、何を返すかを書く。
