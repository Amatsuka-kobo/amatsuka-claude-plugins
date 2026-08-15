---
kind: mdbase.type
name: antibody
version: 1
description: Raphael の抗体レコード。infection の蒸留結果として生成される再発防止知識。

match:
  path_glob: ".raphael/antibodies/*.md"

schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [id, created, source, trigger, status, expires]
    additionalProperties: false
    properties:
      id:
        type: string
        pattern: "^ab-[0-9]{4}-[0-9]{4}-[0-9]{3}$"
        description: "ab-YYYY-MMDD-NNN 形式。management CLI が採番する。"
      created:
        type: string
        format: date
      source:
        type: string
        minLength: 1
        description: "抗体の出自。'<plugin> / <失敗の種別>' の形をとる。"
      trigger:
        type: object
        required: [event, tool, pattern]
        additionalProperties: false
        properties:
          event:
            enum: [PreToolUse]
            description: "PreToolUse のみ。PostToolUseFailure は指定できない。"
          tool:
            type: string
            minLength: 1
          pattern:
            type: string
            minLength: 1
            description: "tool 入力に対する正規表現。"
      status:
        enum: [active, retired]
      stats:
        type: object
        additionalProperties: false
        properties:
          fired:
            type: integer
            minimum: 0
          last_fired:
            # 未発火の抗体は fired: 0 / last_fired: null を持つ。
            type: [string, "null"]
            format: date
      expires:
        type: string
        format: date
---

# Antibody

Raphael が infection を蒸留して生成する再発防止知識。`.raphael/antibodies/` 配下に置かれ、
`trigger` に一致する操作の直前に本文が注入される。

## 制約の根拠

`trigger.event` を `PreToolUse` だけに閉じているのは、注入が操作の「直前」にしか行われないため。
`PostToolUseFailure` を指定した抗体は management CLI の検証で弾かれる。これは実際に繰り返された
失敗で、抗体 `ab-2026-0725-001` として蒸留されている。

## 編集方法

このファイル群を直接編集せず、`plugins/raphael/scripts/update-antibody.mjs` を経由すること。
CLI は採番・検証・統計の更新を行う。
