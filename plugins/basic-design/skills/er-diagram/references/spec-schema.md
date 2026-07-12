# ER図 spec JSON スキーマ

`design-gen.mjs` が受け付ける ER図 spec の完全な定義。

## トップレベル

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | string | ✓ | 固定値 `"er"` |
| `title` | string | ✓ | 図のタイトル(空文字不可) |
| `entities` | Entity[] | ✓ | 1 件以上 |
| `relations` | Relation[] | - | 省略時はリレーションなし |

## Entity

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 物理名。全エンティティで一意 |
| `label` | string | - | 論理名(日本語名など)。図では「label(name)」と表示 |
| `columns` | Column[] | ✓ | 1 件以上 |

## Column

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | カラム物理名 |
| `type` | string | - | データ型(例: `BIGINT`, `VARCHAR(255)`) |
| `pk` | boolean | - | 主キーなら true。図では `[PK]` と表示 |
| `fk` | boolean | - | 外部キーなら true。図では `[FK]` と表示 |
| `unique` | boolean | - | ユニーク制約なら true。図では `[UQ]` と表示 |

## Relation

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `from` | string | ✓ | 起点エンティティの `name`(定義済みであること) |
| `to` | string | ✓ | 終点エンティティの `name`(定義済みであること) |
| `cardinality` | string | ✓ | `"1:1"` / `"1:N"` / `"N:1"` / `"N:M"` のいずれか |
| `label` | string | - | 関係の説明(例: 「発注する」) |

## 記述例

```json
{
  "type": "er",
  "title": "受注管理システム ER図",
  "entities": [
    {
      "name": "users",
      "label": "ユーザー",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "email", "type": "VARCHAR(255)", "unique": true }
      ]
    },
    {
      "name": "orders",
      "label": "注文",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "user_id", "type": "BIGINT", "fk": true }
      ]
    }
  ],
  "relations": [
    { "from": "users", "to": "orders", "cardinality": "1:N", "label": "発注する" }
  ]
}
```
