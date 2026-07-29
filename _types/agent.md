---
kind: mdbase.type
name: agent
version: 1
description: Claude Code のサブエージェント定義。

match:
  path_glob: "plugins/*/agents/*.md"

schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [name, description]
    properties:
      name:
        type: string
        pattern: "^[a-z0-9]+(-[a-z0-9]+)*$"
        description: "kebab-case。ファイル名 (拡張子を除く) と一致させる。"
      description:
        type: string
        minLength: 1
        description: "いつ委譲するかの判断材料。オーケストレーターはこれだけを見て選ぶ。"
      model:
        type: string
        minLength: 1
        description: >-
          inherit / haiku / sonnet / opus / fable、またはプロキシ経由の
          GPT モデル名。値域を enum で閉じていないのは、
          .claude/agents/ 側で claude-gpt-5-6-* を使う運用があるため。
      tools:
        type: string
        minLength: 1
        description: "カンマ区切りの文字列。YAML 配列ではない。"
---

# Agent

Claude Code のサブエージェント定義。`plugins/<plugin>/agents/<name>.md` に置く。

## tools が配列でない理由

frontmatter の `tools` は `Read, Grep, Glob, Bash` のようなカンマ区切り文字列で、
YAML 配列ではない。スキーマを `type: array` にすると既存の全定義が違反になる。

## model を enum で閉じていない理由

このリポジトリの `plugins/*/agents/` は `inherit` と `haiku` しか使っていないが、
`.claude/agents/` 配下の GPT エージェントは `claude-gpt-5-6-sol` などを使う。
将来ここに同種の定義が入る可能性があるため、値域は開いてある。
