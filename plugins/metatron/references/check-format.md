# 検査の定義の書式

ARCHITECTURE の `## 禁止事項` に、`json metatron:checks` で始まるフェンスで検査の定義を書く。`metatron check` が定義を読み、LLM を使わずに違反を返す。文書全体で最初のブロックを採る。

## 定義の形

トップレベルは 1 件以上の要素を持つ配列とし、要素は 1 件の検査とする。次は例示であり、値は実際のパスに置き換える。

````
```json metatron:checks
[
  {
    "id": "no-cross-package-src-import",
    "kind": "no-import",
    "from": ["packages/<pkg>/src/**"],
    "exceptFrom": ["packages/*/src/**/__test__/**"],
    "to": ["packages/*/src/**"],
    "exceptTo": ["packages/<pkg>/src/**"],
    "message": "他パッケージの src/ を import しない。共有する処理は packages/shared に置く"
  }
]
```
````

| 項目 | 必須 | 値 |
| --- | --- | --- |
| `id` | ○ | 配列内で一意な文字列 |
| `kind` | ○ | 検査の種類。今は `no-import` だけ |
| `from` | ○ | 走査するファイルの glob。1 要素以上 |
| `exceptFrom` | — | `from` から除くファイルの glob |
| `to` | ○ | import してはいけない先の glob。1 要素以上 |
| `exceptTo` | — | `to` から除く先の glob |
| `message` | ○ | 違反の報告に添える文。禁止と代わりの手段を書く |

- 種類は metatron が用意したものだけを受け付ける。文書に書いたコマンドは実行しない。
- 未知の `kind`、欠けた項目、型の誤り、空の配列、規則に反する glob は読めない定義になる。`stage-architecture` は `invalid_checks` で拒否する。

## glob と `<名前>`

- glob とパスは docRoot からの相対パスで書く。`/` で始めず、`..`・`.`・空の区間を持たない。
- `from` は固定の接頭辞(`packages/` など)で始める。接頭辞が無いと docRoot 全体を走査し、20,000 件の上限に当たりやすい。
- `*` は区間の一部、`**` は 0 個以上の区間に一致する。末尾の `/**` は手前のパスそのものにも一致する。
- `<名前>` は `from` の区間の全体に置き、その区間の値を覚える。1 つの glob に同じ名前は 1 回だけ置き、`from` の各要素は同じ組の名前を持つ。
- `exceptFrom`・`exceptTo` の `<名前>` は覚えた値に置き換えて照合する。`to` には置けない。

## `no-import` の判定

1. `from` に一致し `exceptFrom` に一致しない ECMAScript のファイル(`.ts` `.tsx` `.mts` `.cts` `.js` `.jsx` `.mjs` `.cjs`)を読む。他の拡張子のファイルは `skipped` に数える。
2. コメント・テンプレートリテラル・文字列の中身を伏せてから、文の始まり(行頭かセミコロンの後)の `import` / `export` の `from "x"`、文の始まりの `import "x"`、`import("x")`、`require("x")` の指定子を取る。
3. `.`・`..`・`./`・`../` で始まる指定子だけを、ファイルのディレクトリから解決する。
4. 解決したパスが `to` に一致し、`exceptTo` に一致しなければ違反とする。

限界:

- パッケージ名(workspace の名前や tsconfig の paths)を経由した import は見ない。
- 正規表現のリテラルの中の引用符とバッククォートは、文字列の始まりと読み違えることがある。バッククォートのときは、次のバッククォートまでが照合から外れる。
- 開始点の下は `from` に一致しないディレクトリも読む。読めないディレクトリが 1 つでもあると、終了コード 2 で止まる。
- 拡張子の補完とディレクトリの index の解決はしない。
- ECMAScript 以外の言語の import は見ない。

## 実行

`node <CLI の絶対パス> check` で実行する。CLI の絶対パスは `get config` の `cli.path` が返す。引数は取らない。

| 終了コード | 意味 |
| --- | --- |
| 0 | 違反が無い |
| 1 | 違反がある |
| 2 | ARCHITECTURE・ブロック・読める定義のどれかが無い、`from` に一致する ECMAScript のファイルが無い、走査が 20,000 件を超えた、読めないファイルやディレクトリがある、走査の開始点が docRoot の外を指す |
| 3 | 想定外の内部エラー |

- 標準出力に JSON(`violations`・`checked`・`skipped`・`warnings`)、標準エラーに `<file>:<line>: <message>(<specifier>)` を出す。
- lint に組み込むときは、プロジェクトの lint のコマンドの後に `check` をつなぐ。プラグインの入る場所はバージョンで変わるので、絶対パスを設定に固定したときは更新のたびに直す。
