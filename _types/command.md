---
kind: mdbase.type
name: command
version: 1
description: Claude Code のスラッシュコマンド定義。

match:
  path_glob: "plugins/*/commands/*.md"

schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [description]
    properties:
      description:
        type: string
        minLength: 1
        description: "コマンド一覧に表示される説明。"
      argument-hint:
        type: string
        minLength: 1
        description: "引数の形を示すヒント。例: <issue-number>"
      allowed-tools:
        type: string
        minLength: 1
      model:
        type: string
        minLength: 1
      disable-model-invocation:
        type: boolean
---

# Command

Claude Code のスラッシュコマンド定義。`plugins/<plugin>/commands/<name>.md` に置く。
コマンド名はファイル名から決まるため、frontmatter に `name` は持たない。

## 必須は description のみ

このリポジトリの既存 7 件のうち `argument-hint` を持つのは 2 件。
引数を取らないコマンドでは不要なため、必須にしていない。
