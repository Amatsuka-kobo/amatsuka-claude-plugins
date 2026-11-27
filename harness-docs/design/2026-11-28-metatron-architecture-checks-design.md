# ARCHITECTURE の禁止事項に検査の定義を添え、`metatron check` が LLM を使わずに違反を返す

Issue: #52(親 Story #49)

## 検査の定義は `json metatron:checks` のブロックに書く

ドメインマップと同じく、ARCHITECTURE の中の JSON のフェンスに書く。置く見出しは `## 禁止事項` とする。読み取りはドメインマップと同じフェンスの状態機械を使い、文書全体で最初の `json metatron:checks` のブロックを採る。置いた見出しは問わない。

例(このリポジトリに置く定義):

````
```json metatron:checks
[
  {
    "id": "no-cross-plugin-src-import",
    "kind": "no-import",
    "from": ["plugins/<plugin>/src/**"],
    "exceptFrom": ["plugins/*/src/**/__test__/**"],
    "to": ["plugins/*/src/**"],
    "exceptTo": ["plugins/<plugin>/src/**"],
    "message": "他プラグインの src/ を import しない。同じ規則は各プラグインで独立に実装する"
  },
  {
    "id": "no-raguel-to-plugin-src-import",
    "kind": "no-import",
    "from": ["plugins/codiel/raguel-mcp/src/**"],
    "exceptFrom": ["plugins/codiel/raguel-mcp/src/**/__test__/**"],
    "to": ["plugins/*/src/**"],
    "message": "raguel-mcp は独立した実装であり、プラグインの src/ を import しない"
  }
]
```
````

- トップレベルは 1 件以上の要素を持つ配列とし、要素は 1 件の検査とする。
- 必須の項目は `id`(配列内で一意な文字列)、`kind`、`from`・`to`(1 要素以上の文字列の配列)、`message`(違反の報告に添える文)である。`exceptFrom`・`exceptTo` は省ける。
- 種類は metatron が用意したものだけを受け付ける。文書に書かれた任意のコマンドは実行しない。文書の編集だけで任意のコマンドを実行できると、ARCHITECTURE が攻撃の入口になるためである。
- 未知の `kind`、欠けた項目、型の誤り、空の配列、規則に反する glob は「読めない定義」とする。書き込み経路(`stage-architecture`)は `invalid_checks` で拒否し、`metatron check` は終了コード 2 で返す。変更前から読めない文書では、ドメインマップと同じく書き込みを拒否しない。

## 最初の種類は `no-import` だけにする

Issue の候補は 2 つあった。`no-import`(ある glob のファイルが別の glob のファイルを import しない)を採り、同じコミットでの変更の連動は採らない。連動の検査は「どのコミットの範囲を見るか」の基準が要り、lint として作業ツリーで実行したときの意味が定まらない。

### glob とパス

- glob とパスは、docRoot(`metatron.config.json` で決まる文書のルート)からの相対パスで書く。
- `*` は `/` を含まない 1 区間の一部、`**` は 0 個以上の区間に一致する。`a/**/b` は `a/b` と `a/x/y/b` に一致し、`a/xb` には一致しない。末尾の `/**` は、その手前のパスそのものにも一致する(`plugins/*/src/**` は `plugins/x/src` に一致する)。
- glob は `/` で始めず、`..` の区間を持たない。持つ定義は読めない定義とする。
- 照合は検査の専用の関数で行う。ドメインマップの照合(`scan.ts` の `globToRegExp`)は区間の境界を見ないので使わない。

### `<名前>`

「他プラグインの `src/` を import しない」は、import 元と import 先が同じプラグインかで決まる。glob だけでは書けないので、`from` の区間に `<名前>` を置けるようにする。

- `<名前>` は区間の全体を占め、`/` を含まない 1 区間に一致し、一致した値を覚える。区間の一部(`x-<p>`)には置けない。
- 1 つの glob に同じ `<名前>` は 1 回だけ置ける。`from` の各要素は同じ組の `<名前>` を持つ。
- `exceptFrom` と `exceptTo` の中の `<名前>` は、覚えた値に置き換えてから照合する。値は文字としてそのまま照合し、ワイルドカードとして解釈しない。
- `to` には `<名前>` を置けない。`exceptFrom`・`exceptTo` に、`from` で覚えない `<名前>` を置けない。

### 判定

1. `from` の各 glob の先頭の固定部分(ワイルドカードと `<名前>` の手前まで)から走査を始める。`node_modules` と `.git` には入らず、シンボリックリンクはたどらない。走査するファイルが 20,000 件を超えたら打ち切り、終了コード 2 で返す。
2. `from` に一致し、`exceptFrom` に一致しないファイルを対象にする。対象は ECMAScript の拡張子(`.ts` `.tsx` `.mts` `.cts` `.js` `.jsx` `.mjs` `.cjs`)のファイルとし、他の拡張子のファイルは `skipped` に件数で返す。
3. 定義の `from` に一致するファイルが 1 件も無いときは、死んだ定義として終了コード 2 で返す。
4. ファイルの全文から、次の形の指定子を正規表現で取る。行の区切りをまたいでよい。行番号は指定子の位置で数える。
   - 行頭(空白の後)の `import` または `export` から、引用符とセミコロンを挟まずに続く `from "x"`(`import type` を含む)
   - 行頭の `import "x"`
   - `import("x")` と `require("x")`
5. 指定子が `./` か `../` で始まるときだけ、ファイルのディレクトリから解決して docRoot からの相対パスにする。解決したパスが docRoot の外に出るときは見ない。パッケージ名・絶対パス・テンプレートリテラルの指定子は見ない。
6. 解決したパスが `to` のどれかに一致し、`exceptTo` のどれにも一致しなければ違反とする。拡張子の補完やディレクトリの index の解決はしない。

検査の限界として、次を `references/check-format.md` に書く。

- パッケージ名(workspace の名前や tsconfig の paths)を経由した import は見ない。
- 行頭が引用符やコメントで始まる文字列の中の `import` は拾わない。`import(` と `require(` は、文字列の中にあっても拾う。
- `vi.mock("x")` のような、import でない参照は見ない。
- ECMAScript 以外のファイルの import は見ない。

### 言語に依存しない形に絞れるか

絞れない。import の構文と相対パスの解決規則は言語ごとに違う。最初の種類は ECMAScript に限り、言語を問わない部分(glob とパスの照合、定義の形、報告の形)を共通にしておく。他の言語は、要るときに `kind` を足して受ける。

## `metatron check`

- docRoot の ARCHITECTURE を読み、定義を順に実行する。LLM を使わない。引数は取らない。
- 標準出力に JSON を返す。`violations` は `file`・`line` の順に並べ、要素は `check`(定義の `id`)・`file`(docRoot からの相対パス)・`line`・`specifier`・`target`(解決したパス)・`message` を持つ。`checked`(調べたファイル数)・`skipped`・`warnings` も返す。
- 標準エラーに、違反を `<file>:<line>: <message>(<specifier>)` の形で 1 件 1 行、警告を `warning: <文>` の形で出す。
- 終了コード:

| コード | 意味 |
| --- | --- |
| 0 | 違反が無い |
| 1 | 違反がある |
| 2 | ARCHITECTURE が無い、`metatron:checks` のブロックが無い、定義が読めない、`from` に一致するファイルが無い、走査を打ち切った |
| 3 | 想定外の内部エラー |

- `check` は読み取りの層(常に exit 0)にも書き込みの層にも当たらない。CLI に第 3 の「検査の層」を置き、`main.ts` の例外の受け口で終了コード 3 に振り分ける。CLI の層を定めた文書(契約凍結文書 §12・`references/cli-usage.md`・`paths.ts` の `USAGE_LINES`)を揃える。
- ブロックが無いときを 2 にするのは、lint に組み込んだ後でブロックが消えても黙って通らないようにするためである。検査を持たないプロジェクトは、lint に `check` を入れない。
- 利用者のリポジトリからは、`get config` の `cli.path` が返す絶対パスで `node <cli.path> check` を実行する。プラグインの入る場所はバージョンで変わるので、利用者のリポジトリの設定に固定するときは、その旨を `check-format.md` に書く。

## hook からは実行しない

検査は `pnpm run lint` で実行する。違反は lint で気づけば足りる。編集の途中では import が一時的に崩れることがあり、PreToolUse で拒否にすると作業が止まる。警告にとどめる hook は、要るときに追加する。このリポジトリに CI は無い(`.github/` に workflow が無い)。

## 検査にする禁止と、しない禁止

このリポジトリの ARCHITECTURE の `## 禁止事項` の 6 項目のうち、検査の定義を付けるのは 1 項目である。

| 禁止 | 検査 |
| --- | --- |
| 実装層は他プラグインの `src/` を import しない | 付ける。上の 2 件の定義。テスト(`__test__/`)は 2 者比較テストのために除く |
| 指示層と参照層に、ルート固有のパスや他プラグインの名前を書かない | 付けない。文章の中の語の照合になり、例外(3 プラグイン同士)と誤検出の判定が `no-import` の範囲を超える |
| 配布物層を手で編集しない | 付けない。採らなかった連動の検査の領分である |
| `.serena/memories/` を直接編集しない | 付けない。成果物でなく作業の仕方の決まりで、ファイルの内容から判定できない |
| ネイティブコードと辞書をバンドル・git・`package.json` に入れない | 付けない。何がネイティブコードかを照合で決められない |
| ルートの `docs/` を読まない | 付けない。実行時の振る舞いであり、ファイルから判定できない |

`## ディレクトリ構成` の「許される依存方向」は許可の列挙であり、`no-import`(禁止の列挙)では書けない。許された方向以外を禁止として書き直せる場合だけ、`## 禁止事項` に禁止の文と定義を置く。

## スキルと文書

- `references/check-format.md` を新設し、定義の形・項目・glob・`<名前>`・判定・終了コード・限界・呼び出し方を書く。
- `references/architecture-format.md`
  - セクション構成の表で `## 禁止事項` の「機械可読」を ○ にし、書き込み経路が拒否する条件に `invalid_checks` を加える。
  - `## 禁止事項` に、検査にできる禁止には `metatron:checks` の定義を添える旨を書く。
- `references/cli-usage.md` に `check` と検査の層、`stage-architecture` のエラーコードに `invalid_checks` を加える。
- `updating-architecture` の起草で、禁止事項の文が `no-import` に当たるときは定義の案を草案に含める。
- `references/instruction-placement.md` の「強制の案」の構造の決まりの手段は、「lint などの検査。ECMAScript の import の方向なら ARCHITECTURE の検査の定義」とする。ECMAScript 以外のプロジェクトへの案内を残す。
- `docs/format-change-checklist.md` に検査の定義の書式の追随先を加え、#53 で置いた「検査の定義ができたら強制の案を差し替える」項目を消す。
- `docs/ARCHITECTURE.example.md` の `## 禁止事項` に定義の記入例を加える。
- 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §1(マーカー)・§4(書き込みの拒否)・§12(サブコマンドと層)を揃える。
- README(metatron・ルート)に `check` を加える。

## このリポジトリへの適用

- `harness-docs/ARCHITECTURE.md` の `## 禁止事項` の 1 項目めに「テスト(`__test__/`)は除く」を加え、上の例の定義を置く。「変更時の追随」の契約の一覧に `check-format.md` を加える。`/metatron:update` の手順で書く。
- ルートの `package.json` の `lint` を `biome check . && node plugins/metatron/scripts/metatron.mjs check` にする。
- 適用の時点で違反が 0 件であることを確かめる。違反があれば、定義を見直すか、その修正を別に起票する。

## バージョン

`0.6.4-dev` のまま据え置く。origin/dev は `0.6.4-dev`、origin/main は `0.6.3-dev` で、dev に main へ未反映の metatron のバージョンアップがある。Issue の「パッチバージョンを上げ」は CLAUDE.md の規則が優先する。

## 完了の条件

- `pnpm run lint`(`check` を含む)・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` が通り、`scripts/` の差分が `src/` と同じコミットにある。
- テスト:
  - 定義の検証(未知の kind・欠けた項目・空の配列・`to` の `<名前>`・束縛されない `<名前>`・区間の一部の `<名前>`・`..` と `/` で始まる glob)
  - import の各構文の検出(1 行・複数行・`import type`・`export ... from`・`import "x"`・`import()`・`require()`)と、コメント行の無視
  - 相対パスの解決と docRoot の外の無視、パッケージ名の無視
  - glob の区間の境界と、末尾の `/**` のディレクトリそのものへの一致
  - `<名前>` の取り出しと `exceptTo`・`exceptFrom` の置き換え
  - ECMAScript 以外の skipped、`from` に一致しない定義、ブロックが無い文書
  - 終了コード 0・1・2・3、`stage-architecture` の `invalid_checks`
- `.serena/memories/metatron/core.md` に `check` を追記する。
