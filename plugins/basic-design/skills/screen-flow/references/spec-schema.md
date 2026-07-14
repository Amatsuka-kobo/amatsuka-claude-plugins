# 画面遷移図 spec JSON スキーマ

`design-gen.mjs` が受け付ける画面遷移図 spec の完全な定義。

## トップレベル

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | string | ✓ | 固定値 `"screen-flow"` |
| `title` | string | ✓ | 図のタイトル(空文字不可) |
| `screens` | Screen[] | ✓ | 1 件以上 |
| `transitions` | Transition[] | - | 省略時は遷移なし |

## Screen

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | string | ✓ | 画面 ID。全画面で一意 |
| `label` | string | - | 画面名。省略時は `id` を表示 |
| `group` | string | - | 画面のまとまり(例: 認証、商品、決済) |
| `kind` | string | - | 通常画面は `"screen"` を推奨。開始画面は `"start"`、終了画面は `"end"` とし、開始・終了の楕円形状を維持 |

- `kind` (任意文字列): 色・アイコンの種別。推奨値は `generic` / `user` / `api` / `data` / `messaging` / `external` / `screen` / `entity`。未知値は生成エラーにせず `generic` 表示になる。

## Transition

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `from` | string | ✓ | 起点画面の `id`(定義済みであること) |
| `to` | string | ✓ | 終点画面の `id`(定義済みであること) |
| `trigger` | string | - | 遷移のきっかけ(例: 「ログイン成功」)。図ではエッジラベルになる |

## 記述例

```json
{
  "type": "screen-flow",
  "title": "EC サイト画面遷移図(サンプル)",
  "screens": [
    { "id": "login", "label": "ログイン", "group": "認証", "kind": "start" },
    { "id": "home", "label": "ホーム", "kind": "screen" },
    { "id": "product-list", "label": "商品一覧" }
  ],
  "transitions": [
    { "from": "login", "to": "home", "trigger": "ログイン成功" },
    { "from": "home", "to": "product-list", "trigger": "カテゴリ選択" }
  ]
}
```
