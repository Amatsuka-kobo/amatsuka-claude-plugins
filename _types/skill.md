---
kind: mdbase.type
name: skill
version: 1
description: Claude Code のスキル定義 (SKILL.md)。

match:
  path_glob: "plugins/*/skills/*/SKILL.md"

schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [name, description]
    properties:
      name:
        type: string
        pattern: "^[a-z0-9]+(-[a-z0-9]+)*$"
        description: "kebab-case。ディレクトリ名と一致させる。"
      description:
        type: string
        minLength: 1
        description: "スキル一覧に常駐する唯一の要素。発火条件が読み取れる文にする。"
---

# Skill

Claude Code のスキル定義。`plugins/<plugin>/skills/<name>/SKILL.md` に置く。

## description が重要な理由

スキル本文は呼び出し時にしかロードされないが、`description` は全セッションのスキル一覧に
常駐する。一覧はコンテキストウィンドウの約 1% が予算で、超えると切り詰められてルーティング
精度が落ちる。「何をするか」ではなく「いつ使うか」を書くこと。

## 未知フィールドについて

`additionalProperties` を指定していないため、Claude Code が今後導入する frontmatter キーは
そのまま通る。必須フィールドの欠落と `name` の書式違反のみを検出する。
