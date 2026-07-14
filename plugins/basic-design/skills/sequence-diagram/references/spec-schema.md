# シーケンス図 spec JSON スキーマ

`design-gen.mjs` が受け付けるシーケンス図 spec の完全な定義。

## トップレベル

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | string | ✓ | 固定値 `"sequence"` |
| `title` | string | ✓ | 図のタイトル(空文字不可) |
| `actors` | Actor[] | ✓ | 1 件以上 |
| `messages` | Message[] | - | 省略時はメッセージなし |

## Actor

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | string | ✓ | アクター ID。全アクターで一意 |
| `label` | string | - | アクター名。省略時は `id` を表示 |
| `kind` | string | - | 色・アイコンの種別。人は `user`、内部システムは `generic`、外部サービスは `external` を推奨 |

- `kind` (任意文字列): 色・アイコンの種別。推奨値は `generic` / `user` / `api` / `data` / `messaging` / `external` / `screen` / `entity`。未知値は生成エラーにせず `generic` 表示になる。

## Message

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `from` | string | ✓ | 送信元アクターの `id`(定義済みであること) |
| `to` | string | ✓ | 送信先アクターの `id`(定義済みであること、`from` と同一不可。**自己メッセージは未対応**) |
| `label` | string | - | メッセージ内容。図ではエッジラベルになる |
| `style` | string | - | `"async"`(非同期)/ `"return"`(応答)。省略時は同期 |

配列内の並び順がそのままシーケンス図上のメッセージの順序になる。

## 記述例

```json
{
  "type": "sequence",
  "title": "ログイン処理シーケンス図(サンプル)",
  "actors": [
    { "id": "user", "label": "利用者", "kind": "user" },
    { "id": "web", "label": "Web アプリ", "kind": "generic" },
    { "id": "api", "label": "認証 API", "kind": "external" }
  ],
  "messages": [
    { "from": "user", "to": "web", "label": "ログイン情報入力" },
    { "from": "web", "to": "api", "label": "認証リクエスト", "style": "async" },
    { "from": "api", "to": "web", "label": "認証結果", "style": "return" }
  ]
}
```
