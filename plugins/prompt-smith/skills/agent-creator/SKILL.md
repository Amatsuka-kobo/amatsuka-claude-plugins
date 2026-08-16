---
name: agent-creator
description: |-
  `.claude/agents/` や `plugins/*/agents/` にある subagent 定義ファイル(`*.md`)を触るときに使う。作る前も、直す前も、まずこの skill を開く。

  含まれる依頼の形:
  - 新規作成 —「〜するエージェントを作りたい」「subagent を追加」
  - 既存定義の点検 — レビュー、監査、不備探し、「本当にこれで妥当か見て」
  - 権限の見直し — tools を最小に、read-only にすべき agent に Write/Edit/Bash が付いている
  - 責務の整理 — 1 つの agent を分割する、agent 間の境界・受け渡し形式・model 継承を決める
  - 上記の判断を踏まえた実際の修正

  依頼の動詞ではなく、触る対象で判断する。パスが `agents/` 配下、または「この agent 定義」を指しているなら、たとえ話題が「契約PDFの抽出精度」「コスト報告の中身」のような業務内容でも、作業の実体は agent 定義の編集なのでこの skill を使う。

  skill / command / output-style / references のファイルは対象外。subagent の概念説明だけの質問には使わない。
---

# Agent 定義の作成

対象は `.claude/agents/*.md` と `plugins/*/agents/*.md` である。
`../../references/agent-definition-spec.md` を併せて読み、これに従う。

## 手順

### 1. 用途を聞く

- 何をする agent かを聞く。
- 1 つの責務に収まらないときは分割を提案する。

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

`../../references/description-guide.md` に従う。

- 使用する場面を具体的に書き、「積極的に使用する」と書く。

### 5. 本文を書く

- `prompt-smith:prompt-smith` の基準に従う。
- 何をする agent か、どう進めるか、何を返すかを書く。

### 6. 既存定義を点検する

- 手順 3・4・5 の基準を既存の記述に当て、逸脱箇所を挙げる。
- `tools` に、本文が使わないツールが含まれていないかを照合する。
- `../../references/agent-definition-spec.md` §配置による制約 に照らし、その配置で使えないフィールドが書かれていないかを確認する。
