# システム構成図 spec JSON スキーマ

`design-gen.mjs` が受け付けるシステム構成図 spec の完全な定義。

## トップレベル

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | string | ✓ | 固定値 `"architecture"` |
| `title` | string | ✓ | 図のタイトル(空文字不可) |
| `zones` | Zone[] | - | 省略時はゾーンなし |
| `nodes` | Node[] | ✓ | 1 件以上 |
| `edges` | Edge[] | - | 省略時は通信経路なし |

## Zone

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | string | ✓ | ゾーン ID。ゾーン・ノード間で一意 |
| `label` | string | - | ゾーン名。省略時は `id` を表示 |
| `children` | string[] | ✓ | 1 件以上。定義済みノード `id` の配列。1 ノードは最大 1 ゾーンにのみ所属可能 |

## Node

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | string | ✓ | ノード ID。全ノードで一意 |
| `label` | string | - | ノード名。省略時は `id` を表示 |
| `icon` | string | - | 種別のメモ(例: `server`, `db`)。詳細パネル表示用 |
| `kind` | string | - | 色・アイコンの種別。API サーバーなら `api` を推奨 |

- `kind` (任意文字列): 色・アイコンの種別。推奨値は `generic` / `user` / `api` / `data` / `messaging` / `external` / `screen` / `entity`。未知値は生成エラーにせず `generic` 表示になる。

## Edge

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `from` | string | ✓ | 起点ノードの `id`(定義済みであること) |
| `to` | string | ✓ | 終点ノードの `id`(定義済みであること) |
| `label` | string | - | 通信内容(例: プロトコル名)。図ではエッジラベルになる |

## 記述例

```json
{
  "type": "architecture",
  "title": "EC サイト システム構成図(サンプル)",
  "zones": [
    { "id": "aws", "label": "AWS", "children": ["api", "db"] }
  ],
  "nodes": [
    { "id": "client", "label": "Web ブラウザ", "icon": "client" },
    { "id": "api", "label": "API サーバー", "icon": "server", "kind": "api" },
    { "id": "db", "label": "データベース", "icon": "db" }
  ],
  "edges": [
    { "from": "client", "to": "api", "label": "HTTPS" },
    { "from": "api", "to": "db", "label": "TCP" }
  ]
}
```
