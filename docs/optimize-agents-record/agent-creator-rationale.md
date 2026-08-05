# agent-creator の設計根拠

スキル本文に書かなかった根拠をまとめた人間向けの文書である。

## `<example>` ブロックを推奨しない理由

`plugin-dev` プラグインの `agent-creator` エージェントと `agent-development` スキルは、description に `<example>` ブロックを埋め込む様式を使う。

```markdown
description: |
  Use this agent when the user asks to "create an agent"...

  <example>
  Context: User wants to create a code review agent
  user: "Create an agent that reviews code for quality issues"
  assistant: "I'll use the agent-creator agent to generate the agent configuration."
  <commentary>
  User requesting new agent creation, trigger agent-creator to generate it.
  </commentary>
  </example>
```

2026-08-02 に公式ドキュメント(code.claude.com)を調査したが、**この形式への言及は無かった**。plugin-dev 独自の様式である。

公式が description について明記しているのは 2 点だけである。

- "When Claude should delegate to this subagent" を書く
- 発火を強めるには "use proactively" のような句を含める

`<example>` に効果が無いと判断したわけではない。効果の有無を測る手段がこの設計には無いので、公式推奨として提示しないという判断である。

plugin-dev を参考にした利用者がこの差分に気づけるよう、ここに記録する。

## 書き方の基準を自前で持たない理由

`agent-creator` は本文の基準を `prompt-smith`、description の基準を `description-guide` に委ねる。

同じ基準を 2 箇所に書くと、片方だけが更新されて食い違う。基準の正本は 1 つに保つ。

`agent-creator` が固有に持つのは frontmatter の仕様知識(`agent-definition-spec.md`)と検証手順である。

## Agent 定義の発火を測る手段を持たない理由

trigger eval の測定器は 2 つの前提に依存する。

| 前提 | Agents での崩れ方 |
| --- | --- |
| `Skill` ツール呼び出し = 発火 | ビルトイン agents が常に併存するため、`Agent` 呼び出しだけでは正解と言えない。`subagent_type` の判別が要るが、これは `content_block_start` に乗らず `input_json_delta` の累積が要る |
| 最初のツール呼び出しで打ち切れる | 委譲は状況を見てから決まることが多い。ファイルを読んでから `Agent` を呼ぶ経路では、第 1 手打ち切りが必ず「発火せず」を返す |

2 つ目が危険である。skill で 8/8 出ている測定器が agent で 0/8 を返し、それを description の問題と誤診する筋が残る。

将来この測定を実装するなら、次の 2 点を解く必要がある。

1. `subagent_type` を stream から取り出す(`input_json_delta` の累積が要る)
2. 打ち切り条件を「第 1 手」から変える(何手目まで見るかの実測が要る)

## plugin-dev との住み分け

| 項目 | optimize-agents:agent-creator | plugin-dev |
| --- | --- | --- |
| description の様式 | `description-guide` の基準。`<example>` なし | `<example>` ブロックを含む独自様式 |
| 本文の基準 | `prompt-smith` へ委譲 | スキル内に自前の指針 |
| frontmatter の仕様 | 公式 16 フィールドを reference に記録 | name/description/model/color/tools を必須扱い |
| 検証 | `check-agent-definition`(project 配下も対象) | `validate-agent.sh` |
| 想定文脈 | 任意の Agent 定義 | プラグイン開発 |

どちらが優れているという判断ではない。基準の出所が違う。

なお plugin-dev は `model` と `color` を必須として扱うが、公式では両方とも任意である。`model` の既定は `inherit`。
