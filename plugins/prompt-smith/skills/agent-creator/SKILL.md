---
name: agent-creator
description: |-
  `agents/` 配下(`.claude/agents/`, `plugins/*/agents/`, `~/.claude/agents/`)の subagent 定義 `*.md` を作る・直す・監査するときに使う。tools権限の絞り込み、責務分割、model継承、agent間の受け渡し形式を扱う。話題が契約書、請求、費用集計などの業務内容でも、対象ファイルが agent 定義なら使う。skill/command/output-style/references ファイルの編集や、subagent概念の説明だけの質問には使わない。
---
# Agent 定義の作成

対象は `.claude/agents/*.md` と `plugins/*/agents/*.md` である。
`../../references/agent-definition-spec.md` を併せて読み、これに従う。

## 手順

### 1. 用途を聞く

- 何をする agent かを聞く。
- 1 つの責務に収まらないときは分割を提案する。

### 2. 配置を決める


| 配置                       | 使う場面       |
| ------------------------ | ---------- |
| `.claude/agents/`        | このプロジェクト専用 |
| `~/.claude/agents/`      | 全プロジェクトで使う |
| `plugins/<name>/agents/` | プラグインとして配る |


配置で使えるフィールドが変わる。

### 3. frontmatter を書く

- `tools` は必要なものだけを許可する。読み取りだけの agent に `Write` や `Edit` を与えない。
- `model` は、呼び出し側でモデルを決める運用なら省略する。特定のモデルに固定したいときだけ書く。

### 4. description を書く

`../../references/description-guide.md` に従う。

- 使用する場面を具体的に書き、「積極的に使用する」と書く。

### 5. 本文を書く

- 本文を書く前に `prompt-smith:prompt-smith` スキルを起動し、その規律で書く。
- 何をする agent か、どう進めるか、何を返すかを書く。

### 6. 既存定義を点検する

- 手順 3・4・5 の基準を既存の記述に当て、逸脱箇所を挙げる。
- `tools` に、本文が使わないツールが含まれていないかを照合する。
- `../../references/agent-definition-spec.md` §配置による制約 に照らし、その配置で使えないフィールドが書かれていないかを確認する。

