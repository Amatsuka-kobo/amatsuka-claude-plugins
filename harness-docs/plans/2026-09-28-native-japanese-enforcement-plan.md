# native-japanese 強化(0.2.0-dev)実装計画書

- 作成日: 2026-09-29
- 対象プラグイン: `plugins/native-japanese`(`0.1.0-dev` → `0.2.0-dev`)
- 設計書(正本): `harness-docs/design/2026-09-28-native-japanese-enforcement-design.md`(以下「設計書」)
- 設計書のユーザー承認: 取得済み(コミット `346abd77`)
- 計画立案時の HEAD: `348a5304`。未コミットの変更は無い
- 前提: 計画立案時点の native-japanese は `0.1.0-dev` で、`src/` には `inject.ts` と `__test__/inject.test.ts` と `testing/run-ts.ts` だけがある。`references/` には `discipline.md`(3,853 文字)だけがある
- 実装は別セッションで行う。

改訂の履歴(2026-09-29): design-review と knowledge-elicitation の指摘を反映した。主な変更は次の 5 つである。

- T16 と T18 の順序を、フックとテストがぶつからない位置に移した。
- 辞書の取得先を契約に固定した。
- 担当役割を見直した。
- `description` の変更を T20 に加えた。
- 承認地点 A3 を足した。

この計画書は、タスクの分割・順序・検証方法・タスク間の契約だけを定める。設計判断は上書きしない。各タスクの要点には設計書のセクション番号を添える。本計画書の中で「設計書のセクション N」と書いたものは設計書を、「セクション N」とだけ書いたものは本計画書を指す。

実装者は設計書の該当セクションを正本として読み、対象ファイルを実際に読んでから手を入れる。設計書・実コード・この計画書のあいだに食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。オーケストレーターはそれをセクション 7 に記録し、設計書を直すかを判断する。

設計書の Step 1〜8(設計書のセクション 14)を、T0〜T22 のタスクに分けた。前回の計画書と違い、コードの全文は載せない。規模が大きく、全文を載せると契約より先に実装を固めてしまうためである。代わりに、タスク間で受け渡す関数の形と値をセクション 4 に固定する。

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`。ADR の追加は T7 で、ARCHITECTURE の追随は T21 で、どちらも metatron のスキルと CLI を通して行う。
- `.claude/rules/metatron/` の 3 ファイル。
- `.raphael/`(`antibodies/` を含む)。
- `plugins/*/scripts/` の手編集。`src/` を変え、`pnpm run build` で再生成する。
- `.serena/memories/` を Edit / Write で触ること。変更が要れば、T21 でオーケストレーターが Serena の `edit_memory` で行う。
- `.claude-plugin/marketplace.json` の、native-japanese の `description` 以外の箇所。`description` は T20 だけが変える(セクション 7 の #5)。
- `pnpm-workspace.yaml`。native-japanese は登録済みである(16 行目)。
- `/tmp/nj-morph/` と `/tmp/nj-pin/`。設計時の計測の素材で、読むだけにする。
- 本件と無関係な未コミット変更。T0 で記録し、触らず、コミットにも含めない。

## 1. 進め方の共通規律

### 全体の制約

設計書から原文の値で写す。

- `plugin.json` と `package.json` の `version` は `0.2.0-dev` で揃える。上げるのは T6 で、コミット 1 に含める(セクション 7 の #3)。
- `package.json` の `dependencies` は増やさない。コードは Node.js の標準ライブラリだけで書く(設計書のセクション 3-3)。
- lindera は npm のパッケージを import しない。取得した `.node` を `createRequire(import.meta.url)` で読み込む(設計書のセクション 2-3、5-1、GOTCHA-004)。
- lindera のトークンの活用は、`details[4]`(活用型)と `details[5]`(活用形)の添字で読む。`conjugation_form` と `conjugation_type` の名前は `src/lib/morph.ts` の外に出さない(設計書のセクション 5-4、GOTCHA-003)。
- 辞書は IPADIC の zip だけを取得する。neologd の辞書は取得しない(セクション 4 の「形態素解析の実行時」、セクション 7 の #6)。
- `references/discipline.md` は 9,000 文字以内、`references/reminder.md` は 300 文字以内とし、テストで守る。
- 環境変数の名前は `AMATSUKA_NATIVE_JAPANESE_CHECK` と `AMATSUKA_NATIVE_JAPANESE_MORPH` で、止める値は `off` とする。テスト専用の変数は `NATIVE_JAPANESE_MORPH_DIR` とする。
- 本計画書の `<データディレクトリ>` は、T10 で記録した `CLAUDE_PLUGIN_DATA` の実際のパス(`morph/` を直下に持つディレクトリ)を指す。`NATIVE_JAPANESE_MORPH_DIR`、測定 CLI の `--data-dir`、`dump-tokens.mjs` の第 1 引数には、どれもこのパスを渡す。
- `src/lib/` のモジュールはファイルを読まない。`discipline.md` を読むのはエントリポイント(`src/check.ts` `src/measure.ts` `src/inject.ts`)だけとする(設計書のセクション 4-1)。
- 出力は esbuild で ESM の `.mjs` にする。`target` は node22。
- ブランチを切らない。main で作業する。
- `git add` はパスを列挙して行う。`git add -A` と `git add .` は使わない。

### 作業の規律

- テストを伴うタスクでは、テストを先に書いてから実装する。タスクの完了時点で `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通ることを完了条件にする。
- `plugins/native-japanese/src/` を変えるタスクは、最後に `pnpm --filter native-japanese-scripts build` を実行し、`scripts/` の差分を同じコミットに入れる。
- 整形は `pnpm exec biome check --write plugins/native-japanese` で行う。
- 実装で書く TypeScript・JavaScript・Markdown は Serena の編集ツールで作り、直す(conventions)。
- セクション 4 の関数の名前・引数・戻り値・パス・値は、タスク間の契約である。担当は変えない。変える必要が出たら止めて報告する。担当役割の選び方も、契約を変えないことを前提にしている。
- 各タスクの「検証」に挙げたテストは最低限の一覧である。担当が足すのはよい。削るときは報告する。
- スキルは各タスクの「スキル」行に書いたものだけをロードする。
- 設計判断・要件の追加・スコープの拡大は担当が決めず、オーケストレーターへ差し戻す。
- 新しいセッションでの確認に `claude -p` を使うときは、リポジトリの外の空のディレクトリを cwd にする。リポジトリの中で実行すると、chat-history の hook が会話記録を作る(設計書のセクション 18)。フラグは T10 と同じ `--model haiku --setting-sources "" --strict-mcp-config` を付ける。

### AI 向けの指示書の編集

`.claude/rules/metatron/conventions.md` の「AI 向けの指示書」の対象は `plugins/<plugin>/references/**/*.md` を含む。本改修では次の 2 ファイルがこれに当たる。

- `plugins/native-japanese/references/discipline.md`(T4 と T16)
- `plugins/native-japanese/references/reminder.md`(T17)

T16 と T17 は、編集の前に `prompt-smith:prompt-smith` を起動し、その規律に従って全文を評価して書く。担当は、Skill ツールを使える general の定義にする。T4 は目印の 2 行を機械的に挿入するだけなので、prompt-smith を起動しない(セクション 7 の #8)。

設計書・本計画書・セクション 9 の実施記録には、prompt-smith を当てない。ユーザーの決定による(セクション 7 の #7)。

### レビューの焦点

設計書が暗に要求しているのに、設計書のセクション 13-2 の表のどの行も直接には検査しない条件を 6 件挙げる。それぞれ担当タスクにテストか検証を足した。T22 のレビューでは、この 6 件を必ず見る。

| # | 条件 | 検査するタスク |
| --- | --- | --- |
| R1 | バンドル後の `scripts/*.mjs` が、`.node` をバンドルに含めず、実行時に `createRequire` で読み込める(設計書のセクション 5-1) | T12 の検証 4、T14 の検証 3 |
| R2 | SessionStart で取得の子プロセスを起動しても、`inject.mjs` の stdout が注入の JSON 1 行だけで、hook の終了を待たせない(設計書のセクション 5-2) | T9 のテスト「取得を起動しても子プロセスを待たずに終わる」 |
| R3 | `discipline.md` の先頭の目印の行が、注入文からも測定の対象からも外れる(設計書のセクション 4-3、9) | T5 のテスト、T6 の検証 4 |
| R4 | HTML 以外のファイルでは、正規表現の層を書き込み後のファイル全体ではなく、今回の本文にだけ当てる(設計書のセクション 7-2) | T14 のテスト「Edit で既存の違反を差し戻さない」 |
| R5 | `ready.json` が常に最後に置かれ、途中で失敗したときに `morph/lindera-6.2.0` も `ready.json` も残らない(設計書のセクション 5-2) | T9 のテスト「sha256 が合わなければ何も残さない」 |
| R6 | 取得物の中の `NOTICE.txt` が `ipadic/` に展開される(設計書のセクション 5-2 の置き場所) | T9 のテスト「NOTICE.txt を展開する」 |

## 2. タスク

各タスクの「担当」は、依頼に使う役割マーカーである。「(オーケストレーター)」と書いたタスクは、オーケストレーターが自分で行う。

### T0: baseline(オーケストレーター)

**担当**: general(オーケストレーター)

**入力**: なし。

**出力**: セクション 9 の T0 の欄。

**手順**:

1. `git rev-parse --short HEAD` を記録する。`348a5304` 以降のコミットがあれば、`git log --oneline 348a5304..HEAD` で一覧を記録する。
2. `git status --short` で、本件と無関係な未コミット変更を記録する。
3. `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` と `pnpm run build` を実行し、結果と、全体と native-japanese のテスト件数を記録する(計画立案時の native-japanese は `inject.test.ts` の 1 ファイル)。
4. `plugins/native-japanese/.claude-plugin/plugin.json` と `package.json` の `version` が `0.1.0-dev` であることを確かめる。
5. `node -e 'console.log(require("fs").readFileSync("plugins/native-japanese/references/discipline.md","utf8").length)'` を記録する。

**完了条件**: 4 つのコマンドがすべて通り、version が `0.1.0-dev` である。通らないとき、または version が違うときは本件に入らず報告する。

**検証コマンド**: 手順 3 の 4 つ。

**コミット**: なし。

---

Step 1: 正規表現の層の lint 本体と測定 CLI(設計書のセクション 4、6)

### T1: `src/lib/rules.ts`

**要点**: 設計書のセクション 4-2。避ける語の表から規則を作り、翻訳調の 7 型をコードに定義する。

**担当**: normal-impl(1 コンポーネントの中で、設計書が決めた規則を写す)

**スキル**: 不要。

**入力**: `plugins/native-japanese/references/discipline.md`(テストで実物を読む)、セクション 4 の「規則」の契約。

**出力**: `plugins/native-japanese/src/lib/rules.ts`、`plugins/native-japanese/src/lib/__test__/rules.test.ts`。

**手順**:

1. テストを先に書く。テストは実物の `discipline.md` を読む。次を確かめる。
   - 実物の `discipline.md` から避ける語の規則が 1 件以上作られ、表の 9 行すべての分類が `category` に現れる。
   - 表の各行の「」内の語が、どれも対応する規則の `pattern` に含まれる。語ごとに、その語をそのまま含む文が、その行の `category` の規則のどれかに当たることで確かめる。
   - `〜` を含む語(例: `ぜひ〜してみてください`)が、中間に語句を挟んだ文に当たる。
   - `承認ポイントはなく` に当たらない。`ポイントは主に以下の通りです` の単独の出現には当たる。
   - 翻訳調の 7 型それぞれに、当たる例が 1 つ以上ある。
   - `wo-motsu` が `意味を持つ。` と行末の `意味を持つ` に当たり、`意味を持つ定義` `役割を持つ定義` `鍵を持つ` `責任を持って` に当たらない。
   - `hoka-naranai` が `に他ならない` と `にほかならない` の両方に当たる。
   - 「## 避ける語」の表が無い本文を渡すと、避ける語の規則は 0 件で、翻訳調の 7 型だけが返る。
2. `rules.ts` を実装する。
3. `pnpm exec vitest run plugins/native-japanese/src/lib/__test__/rules.test.ts` でパスを確かめる。

**完了条件**: 上のテストがパスし、lint・typecheck・test が通る。

**検証コマンド**: `pnpm exec vitest run plugins/native-japanese/src/lib/__test__/rules.test.ts`、`pnpm run lint`、`pnpm run typecheck`。

**コミット**: なし(コミット 1 でまとめる)。

### T2: `src/lib/extract.ts`

**要点**: 設計書のセクション 4-3。T2 で扱うのは、抜き出した本文、行番号、ignore-file の目印、除外する範囲までとする。規則が当たるかは T3、形態素解析での品詞は T12 で確かめる。

**担当**: complex-impl(HTML の抜き出しの構造を決める。除外する要素、ブロックの区切り、1 字ごとの元の行番号の対応づけ)

**スキル**: 不要。

**入力**: セクション 4 の「抜き出し」の契約。

**出力**: `plugins/native-japanese/src/lib/extract.ts`、`plugins/native-japanese/src/lib/__test__/extract.test.ts`、必要なら `src/fixtures/extract/` の固定データ。

**手順**:

1. テストを先に書く。設計書のセクション 13-2 の `extract.ts` の行のうち、次に当たる項目を含める。
   - 拡張子ごとの抜き出し。
   - コードフェンスとインラインコードの除外。
   - ひらがな・カタカナを含まない行の除外。
   - ノートの code セルで `//` と `#` の両方を抜き出す。
   - 段落の組み方(地の文・リスト・コメント)。
   - ignore-file の目印。
2. HTML は次を確かめる。
   - `<p>設定を変えることが<em>できる</em>。</p>` が 1 ブロックになり、本文が `設定を変えることができる。` になる。各字の元の行番号が正しい。
   - `<p><code>することができる</code></p>` の `<code>` の中が抜き出されない。
   - `<p>A&nbsp;&amp;&nbsp;B は、情報を整理すること&#12395;よって決まる。</p>` の実体参照が戻り、本文に `ことによって` が現れる。
   - 複数行にまたがる段落で、各字の元の行番号が正しい。
   - `.vue` `.jsx` `.tsx` では HTML の抜き出しを使わない。
   - `<script>` の中の `//` コメントと、`alt` `title` の属性値を抜き出さない。
   - `<!-- native-japanese: ignore-file -->` の 1 行を目印として認める。
3. `extract.ts` を実装する。HTML の正規表現による抜き出しの関数には、上限を書いたコメントを付ける。コメントは `ponytail:` で始め、次の 3 点を書く(設計書のセクション 4-3)。
   - 壊れた HTML で区切りがずれること。
   - パーサーを使わない理由。
   - 問題になったらパーサーに置き換えること。

**完了条件**: 上のテストがパスし、lint・typecheck・test が通る。`ponytail:` のコメントが 1 件以上ある。

**検証コマンド**: `pnpm exec vitest run plugins/native-japanese/src/lib/__test__/extract.test.ts`、`grep -c "ponytail:" plugins/native-japanese/src/lib/extract.ts` の出力が `0` でない。

**コミット**: なし(コミット 1)。

### T3: `src/lib/lint.ts`(正規表現の層と編集範囲)

**要点**: 設計書のセクション 4-4。違反の型、正規表現の層の適用、編集範囲の特定と絞り込み。形態素解析の層は、解析器を受け取る口だけを作り、中身は T12 で足す。編集範囲で違反を絞る処理は、形態素解析の違反にも使う前提でここで作る。

**担当**: complex-impl(編集範囲の照合を決める。書き込み後のファイルの中から本文を探す方法と、違反の行の範囲との重なりの判定)

**スキル**: 不要。

**入力**: T1 の `rules.ts`、T2 の `extract.ts`、セクション 4 の「lint」の契約。

**出力**: `plugins/native-japanese/src/lib/lint.ts`、`plugins/native-japanese/src/lib/__test__/lint.test.ts`。

**手順**:

1. テストを先に書く。設計書のセクション 13-2 の `lint.ts` の行のうち、形態素解析に関わらない項目をすべて含める。加えて次を確かめる。
   - `analyzer` を渡さないと、正規表現の層だけの結果になる。
   - HTML の `<p>設定を変えることが<em>できる</em>。</p>` で、タグをまたいで `koto-dekiru` に当たる。`line` と `endLine` が元のファイルの行になる。
   - 複数行にまたがる HTML の違反で、`line` と `endLine` が違う値になる。
   - `findEditRanges` が、ファイルの中から本文を探して 1 始まりの両端を含む行の範囲を返し、見つからない本文には `null` を返す。
   - `overlaps` が、範囲と 1 行でも重なる違反だけを真にする。範囲の端の行だけで重なる場合も真になる。
2. `lint.ts` を実装する。

**完了条件**: 上のテストがパスし、lint・typecheck・test が通る。

**検証コマンド**: `pnpm exec vitest run plugins/native-japanese/src/lib/__test__/lint.test.ts`。

**コミット**: なし(コミット 1)。

### T4: `discipline.md` の先頭に ignore-file の目印を置く

**要点**: 設計書のセクション 4-3、9。目印は `discipline.md` にだけ置く。これを置かないと、T13 の基準値で `discipline.md` の避ける語の表が違反として数えられる。

**担当**: light-impl(変更内容を完全に指定できる機械的な挿入)

**スキル**: 不要。prompt-smith は起動しない(セクション 7 の #8)。

**入力**: `plugins/native-japanese/references/discipline.md`。

**出力**: 同じファイル。1 行目に `<!-- native-japanese: ignore-file -->` を、2 行目に空行を挿入する。3 行目以降は現行の本文のまま変えない。

**完了条件**: `head -3` が目印、空行、`# 日本語の書き方` の 3 行になる。`git diff --numstat` が追加 2 行、削除 0 行である。

**検証コマンド**: `head -3 plugins/native-japanese/references/discipline.md`、`git diff --numstat plugins/native-japanese/references/discipline.md` の出力が `2	0	plugins/native-japanese/references/discipline.md`。

**コミット**: なし(コミット 1)。

### T5: `inject.ts` で目印の行を取り除く

**要点**: 設計書のセクション 9 の最終項目。

**担当**: normal-impl

**スキル**: 不要。

**入力**: T4 の後の `discipline.md`、現行の `src/inject.ts` と `src/__test__/inject.test.ts`。

**出力**: `src/inject.ts`、`src/__test__/inject.test.ts`、`scripts/inject.mjs`。

**手順**:

1. テストを先に直す。
   - 既存のテスト「`%s で discipline.md の全文を 1 行の JSON で注入する`」の期待値を、目印の行とその直後の空行を除いた本文にする。テスト名も「目印の行を除いて注入する」趣旨に直す。
   - 「注入文に ignore-file の行が含まれない」を足す。
   - 既存のテスト「`差し替えた本文を注入する(一時ディレクトリでの起動の対照)`」に並べて、目印の無い本文がそのまま注入されるケースを足す。
2. `inject.ts` を直す。行全体が目印である行だけを取り除く。
3. `pnpm --filter native-japanese-scripts build` を実行する。

**完了条件**: テストがパスし、lint・typecheck・test が通る。

**検証コマンド**:

1. `pnpm exec vitest run plugins/native-japanese/src/__test__/inject.test.ts`
2. 次の出力が `0` である。`grep -c` は一致が 0 件のとき終了コード 1 を返すので、終了コードではなく出力を比べる。

```bash
echo '{"hook_event_name":"SessionStart"}' | node plugins/native-japanese/scripts/inject.mjs | grep -c "ignore-file" || true
```

**コミット**: なし(コミット 1)。

### T6: `src/measure.ts`(測定 CLI)、ビルド定義、バージョン

**要点**: 設計書のセクション 6-1、6-2。出力 JSON の形はこのタスクで確定させる。`morph` は `{ used: false, reason }` まで作り、T12 では値を埋めるだけにする。

**担当**: complex-impl(CLI の引数と出力 JSON の形を新しく作る)

**スキル**: 不要。

**入力**: T3 の `lint.ts`、セクション 4 の「測定 CLI」の契約。

**出力**: `src/measure.ts`、`src/__test__/measure.test.ts`、`src/fixtures/transcripts/` の固定データ、`build.ts`(`entryPoints` に `measure` を足す)、`scripts/measure.mjs`、`.claude-plugin/plugin.json` と `package.json`(`0.2.0-dev`)。

**手順**:

1. 固定の transcript を `src/fixtures/transcripts/` に置く。main の jsonl 1 本と、`subagents/agent-<id>.jsonl` と `agent-<id>.meta.json` の組 1 つを含める。
2. テストを先に書く。
   - 書き手ごとの集計(main と agentType)が合う。
   - `--since` で、その日より前の記録が数えられない。
   - `--format json` の出力が、セクション 4 の「測定 CLI」の形をすべて持つ。`morph` は `{ used: false, reason: <文字列> }` である。
   - `--git` で、一時的な git リポジトリに加えた行だけが数えられ、既存の行は数えられない。
   - `--git` で、先頭に目印を持つファイルが数えられない。
3. `measure.ts` を実装する。`discipline.md` の読み込みと `buildRules` の呼び出しは、実行のたびに行う(セクション 4 の「規則」)。`build.ts` の `entryPoints` に `measure: "./src/measure.ts"` を足す。
4. `plugin.json` と `package.json` の `version` を `0.2.0-dev` にする。
5. `pnpm --filter native-japanese-scripts build` を実行する。

**完了条件**: テストがパスし、lint・typecheck・test・build が通る。バンドル後の `scripts/measure.mjs` で違反を数えられる。

**検証コマンド**:

1. `pnpm exec vitest run plugins/native-japanese/src/__test__/measure.test.ts`
2. `node plugins/native-japanese/scripts/measure.mjs --git 4049e9e..HEAD --format text` が exit 0 で、違反数を出す。
3. `grep -n '"version"' plugins/native-japanese/.claude-plugin/plugin.json plugins/native-japanese/package.json` がどちらも `0.2.0-dev`。
4. 検証 2 の出力の違反の例に、`references/discipline.md` の行が含まれない(R3)。

**コミット**: コミット 1。T1〜T6 をまとめる。

---

Step 2: ADR と形態素解析の取得(設計書のセクション 11、5-1〜5-3、5-5)

### T7: ADR の追加(オーケストレーター)

**要点**: 設計書のセクション 11 の草案の要点。

**担当**: general(オーケストレーター)

**スキル**: `metatron:updating-architecture`。

**入力**: 設計書のセクション 11。

**出力**: `harness-docs/ARCHITECTURE.md` の ADR 一覧に 1 件。タイトルは `[native-japanese] 形態素解析の実行物と辞書は初回に取得し、git に同梱しない`。ADR の影響範囲に書いたシステム概要と技術スタックの追記も、同じ手順で入れる。

**手順**:

1. `metatron:updating-architecture` を起動し、その手順に従う。手順は `diff-architecture`、`get rules`、草案の第三者検査、`stage-adr` と `stage-architecture`、`commit-architecture` の順である。
2. ADR の草案とシステム概要・技術スタックの追記を、ユーザーに全文で示す。

**承認地点 A1**: ユーザーが ADR を承認するまで、T9 に入らない。T8 は承認を待たずに進めてよい。

**完了条件**: ユーザーが承認し、`commit-architecture` が成功している。

**検証コマンド**: `grep -c "\[native-japanese\]" harness-docs/ARCHITECTURE.md` の出力が `0` でない。

**コミット**: コミット 2。

### T8: `src/lib/archive.ts`

**要点**: 設計書のセクション 5-2 の手順 7。tarball と zip の Buffer から、指定した名前のファイルだけを取り出す。標準ライブラリの `zlib` だけで書く。

**担当**: normal-impl

**スキル**: 不要。

**入力**: セクション 4 の「展開」の契約。

**出力**: `src/lib/archive.ts`、`src/lib/__test__/archive.test.ts`、`src/fixtures/archive/` の小さな tarball と zip。

**手順**:

1. 固定データを作る。tarball は `tar czf` で、zip は `python3 -m zipfile -c` で、数百バイトのファイルを 2〜3 個含むものを作る。zip には deflate の項目と、名前に `..` を含む項目を入れる。作り方は `src/fixtures/archive/README.md` に 3 行ほどで残す。
2. テストを先に書く。
   - tarball から指定の 1 ファイルを取り出し、中身が一致する。
   - zip から指定の接頭辞と名前の一覧に当たるファイルだけを取り出す。
   - `..` や絶対パスを含む項目と、一覧に無い名前を取り出さない。
   - 壊れた Buffer を渡すと例外を投げる(呼び出し側の T9 が失敗として扱う)。
3. `archive.ts` を実装する。

**完了条件**: テストがパスし、lint・typecheck・test が通る。

**検証コマンド**: `pnpm exec vitest run plugins/native-japanese/src/lib/__test__/archive.test.ts`、`grep -n "from \"" plugins/native-japanese/src/lib/archive.ts` の import 先が `node:` で始まるものだけ。

**コミット**: なし(コミット 3)。

### T9: `src/morph-runtime.ts`、`src/fetch-morph.ts`、SessionStart からの取得の起動

**要点**: 設計書のセクション 5-1、5-2、5-3、5-5。取得・展開・照合・`ready.json`・読み込み・起動の条件。レビューの焦点 R2、R5、R6。

**担当**: complex-impl(2 つのエントリポイントと hook の挙動を同時に変える)

**スキル**: 不要。

**入力**: T8 の `archive.ts`、承認地点 A1、コミット 1 の後の `inject.ts`、セクション 4 の「形態素解析の実行時」の契約。

**出力**: `src/morph-runtime.ts`、`src/fetch-morph.ts`、`src/inject.ts`(SessionStart で `maybeStartFetch` を呼ぶ)、`src/__test__/morph-runtime.test.ts`、`src/__test__/inject.test.ts` の追加、`src/testing/` の差し替え用スクリプト、`build.ts`(`entryPoints` に `fetch-morph`)、`scripts/fetch-morph.mjs`、`scripts/inject.mjs`。

**手順**:

1. テストを先に書く。設計書のセクション 13-2 の `morph-runtime.ts` と `inject.ts` の行のうち、取得に関わる項目をすべて含める。加えて次を確かめる。
   - 取得を起動しても子プロセスを待たずに終わる(R2)。条件は次の 3 つである。
     - `inject` の親プロセスが exit 0 で終わり、stdout が注入の JSON 1 行だけである。
     - 親が終わった時点では、差し替え用のスクリプトの目印のファイルがまだ無い。
     - その後、目印のファイルができる。
   - sha256 が合わないとき、`morph/lindera-6.2.0` も `ready.json` も残らず、一時ディレクトリも消える(R5)。
   - 展開後の `ipadic/NOTICE.txt` がある(R6)。
   - `ready.json` に 11 ファイルのサイズと mtime が記録される。
   - `morph/` の下に別のバージョンのディレクトリ(例: `lindera-6.1.0/`)があると、取得の後に消える。
   - `AMATSUKA_NATIVE_JAPANESE_CHECK=off` でも取得を起動しない。
2. `installMorph` のテストは、`node:http` で立てたローカルのサーバーと、T8 の固定データから計算した sha256 を渡す。ネットワークに出ない。
3. 起動のテストでは、起動先を `src/testing/` に置いた差し替え用のスクリプトにする。このスクリプトは、一定時間(例: 1 秒)待ってから目印のファイルを書く。拡張子は `.mjs` にする(testing-policy)。
4. 実装する。`SOURCES` の値は、セクション 4 の「形態素解析の実行時」の契約から写す。`.node` のパスは target ごとに契約の値をそのまま持ち、`<target>` から組み立てない。
5. `pnpm --filter native-japanese-scripts build` を実行する。

**完了条件**: テストがパスし、lint・typecheck・test・build が通る。

**検証コマンド**:

1. `pnpm exec vitest run plugins/native-japanese/src/__test__/morph-runtime.test.ts plugins/native-japanese/src/__test__/inject.test.ts`
2. `grep -rn 'from "lindera"\|require("lindera")' plugins/native-japanese/src plugins/native-japanese/scripts | wc -l` の出力が `0`。npm の lindera パッケージを読み込んでいない。
3. `grep -c "neologd" plugins/native-japanese/src/morph-runtime.ts || true` の出力が `0`。

**コミット**: コミット 3(T8・T9)。

### T10: 新しいセッションでの取得の確認

**要点**: 設計書のセクション 14 の Step 2 の完了条件。設計書のセクション 18 の【要確認】のうち、`CLAUDE_PLUGIN_DATA` の値と、子プロセスが残るかを確かめる。

**担当**: e2e-verify

**スキル**: 不要。

**入力**: T9 のバンドル。

**出力**: セクション 9 の T10 の欄。

**手順**:

1. リポジトリの外の空のディレクトリを cwd にし、次を実行する。

```bash
claude -p --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/native-japanese --model haiku --setting-sources "" --strict-mcp-config "こんにちは"
```

2. 実行の直後と 60 秒後に、`~/.claude/plugins/data/` の下で native-japanese のディレクトリを探し、`morph/` の中身を記録する。`--plugin-dir` では `native-japanese-inline` になると推定している。
3. 手順 1 の `claude` が終わった後に、`ps -ef | grep fetch-morph` で子プロセスが残って取得を続けたかを確かめる。`ready.json` ができれば、残って取得を終えたとみなす。
4. `ready.json` の中身と、`lindera-6.2.0/` の 11 ファイルのサイズを記録する。
5. hook が止まらなかったこと(手順 1 の `claude` の応答までの時間)を記録する。

**完了条件**: `ready.json` ができ、手順 1 の応答が取得を待たずに返る。`CLAUDE_PLUGIN_DATA` の実際のパスが記録されている。

**検証コマンド**: `ls -la ~/.claude/plugins/data/*native-japanese*/morph/lindera-6.2.0/`、`cat ~/.claude/plugins/data/*native-japanese*/morph/lindera-6.2.0/ready.json`。

**コミット**: なし。

---

Step 3: 形態素解析の 4 規則(設計書のセクション 5-4、6)

### T11: 固定データの生成

**要点**: 設計書のセクション 13-1。実物の lindera の解析結果を JSON の固定データにする。

**担当**: normal-impl

**スキル**: 不要。

**入力**: `<データディレクトリ>`、セクション 4 の「固定データ」の契約。

**出力**: `src/testing/dump-tokens.mjs`、`src/fixtures/morph/sentences.txt`、`src/fixtures/morph/tokens.json`。

**手順**:

1. `dump-tokens.mjs` を書く。引数に `<データディレクトリ>` と例文のファイルをとり、`tokens.json` を書き出す。`.node` は `createRequire` で読む。
2. 例文は、設計書のセクション 5-4 で「当たる」「当たらない」とした文をすべて含める。加えて、次の文を作って入れる。
   - 閾値のちょうど前後の文(99 字と 100 字、29 字と 30 字、同じ文末表現の 3 文と 4 文)。
   - インラインコードを置き換えた 1 字を含む文(T12 で名詞として解析されることを確かめる)。
3. `node plugins/native-japanese/src/testing/dump-tokens.mjs <データディレクトリ> plugins/native-japanese/src/fixtures/morph/sentences.txt` を実行する。

**完了条件**: `tokens.json` ができ、`する` の `details[4]` が `サ変・スル`、`details[5]` が `基本形` である例が含まれる。

**検証コマンド**: `node -e 'const j=require("./plugins/native-japanese/src/fixtures/morph/tokens.json");console.log(j.length)'` が `sentences.txt` の行数と同じ。

**コミット**: なし(コミット 4)。

### T12: `src/lib/morph.ts` と、lint と測定 CLI への組み込み

**要点**: 設計書のセクション 5-4 の全体、4-4 の形態素解析の違反、6-1 の `--data-dir` と `--git` の扱い、6-2 の出力。測定 CLI の出力 JSON の形は T6 で確定しているので、ここでは値を埋めるだけにする。

**担当**: complex-impl(4 規則の判定を新しく作り、lint と測定 CLI の 2 つを同時に変える)

**スキル**: 不要。

**入力**: T3 の `lint.ts`、T6 の `measure.ts`、T9 の `loadAnalyzer`、T11 の固定データ。

**出力**: `src/lib/morph.ts`、`src/lib/__test__/morph.test.ts`、`src/lib/lint.ts` と `src/measure.ts` の変更、それぞれのテストの追加、`scripts/measure.mjs`。

**手順**:

1. テストを先に書く。T11 の `tokens.json` を読む。
   - 設計書のセクション 13-2 の `morph.ts` の行をすべて含める。
   - インラインコードを置き換えた 1 字が、名詞として解析される。
   - T3 の `overlaps` による絞り込みが、形態素解析の違反にも効く。編集範囲の外の文の違反が残らない。
   - `measure.ts` の `--data-dir` の項目(設計書のセクション 13-2)。
   - `--since` と、形態素解析の違反の `--git` での数え方。
   - HTML のファイルを含む `--git` で、変更後のファイル全体からブロックを取り出し、加わった行と重なる違反だけを数える。
2. 実物の lindera を使うテストを `describe.skipIf(!process.env.NATIVE_JAPANESE_MORPH_DIR)` で書く(設計書のセクション 13-1)。固定データの再解析との一致と、4 規則の違反の一致を確かめる。
3. `morph.ts` を実装し、`lint.ts` の解析器の口につなぐ。閾値は `morph.ts` の先頭の定数に集める。
4. `measure.ts` で、`--data-dir` を渡されたときは `AMATSUKA_NATIVE_JAPANESE_MORPH` を見ずに `loadAnalyzer` を呼び、`morph` の値を埋める。出力 JSON の形は変えない。
5. `pnpm --filter native-japanese-scripts build` を実行する。

**完了条件**: 固定データのテストがパスする。`NATIVE_JAPANESE_MORPH_DIR` を設定したテストもパスする。lint・typecheck・test・build が通る。

**検証コマンド**:

1. `pnpm exec vitest run plugins/native-japanese`
2. `NATIVE_JAPANESE_MORPH_DIR=<データディレクトリ> pnpm exec vitest run plugins/native-japanese`
3. `grep -rn "conjugation_form\|conjugation_type" plugins/native-japanese/src --include=*.ts | grep -v "src/lib/morph.ts" | wc -l` の出力が `0`。
4. (R1)`node plugins/native-japanese/scripts/measure.mjs --git HEAD~1..HEAD --data-dir <データディレクトリ> --format json` の `morph.used` が `true`。バンドル後のスクリプトが `.node` を実行時に読み込めている。

**コミット**: コミット 4(T11・T12)。

---

Step 4: 基準値(設計書のセクション 6-3)

### T13: 基準値と違反例の抽出

**要点**: 設計書のセクション 6-3。general の担当は、測定と違反例の抽出までを行う。誤検知の判定と、規則を絞る案の採否はオーケストレーターが行う。

**担当**: general(抽出)。判定はオーケストレーター。

**スキル**: 不要。

**入力**: T12 の `scripts/measure.mjs`、`<データディレクトリ>`。

**出力**: `/tmp/nj-baseline/` の測定結果と、規則ごとの違反例の一覧。オーケストレーターの判定はセクション 9 の T13 の欄に書く。

**手順**(general):

1. `git rev-parse --short HEAD` を記録する。
2. 次の 2 つを `--format json` で実行し、出力を `/tmp/nj-baseline/` に保存する。
   - `node plugins/native-japanese/scripts/measure.mjs --git 4049e9e..HEAD --data-dir <データディレクトリ>`
   - `node plugins/native-japanese/scripts/measure.mjs --transcripts ~/.claude/projects/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins/ --since 2026-09-26 --data-dir <データディレクトリ>`
3. 規則ごとに違反例を抜き出し、一覧にして返す。形態素解析の 4 規則は、例が 20 件を超えるときは 20 件を抜き出す。誤検知かどうかは書かない。

**手順**(オーケストレーター):

4. 違反例を読み、誤検知かを判定する。基準は、設計書のセクション 16 の 2 つ(意図した引用・固有名詞・識別子・コード例、規律の文言に照らすと違反でない箇所)とする。
5. 規則ごとに誤検知の割合を出す。
6. 誤検知が違反の半分を超えた規則と、`muse-shugo` の述語の一覧について、絞り方の案を作り、採否を決める。
7. 4〜6 の結果をセクション 9 に書く。絞る規則が無いときは「無し」と書く。

**完了条件**: 規則ごとの誤検知の割合と、採った絞り方(または「無し」)がセクション 9 に記録されている。

**検証コマンド**: 手順 2 の 2 つ。

**コミット**: なし。記録は計画書の実施記録としてコミット 8 に入れる。

### T13a: 規則の絞り込み

**担当**: normal-impl

**入力**: T13 で採った絞り方。

**出力**: `src/lib/morph.ts` か `src/lib/rules.ts` の変更、テストの追加、`scripts/*.mjs`。

**手順**: T13 で採った絞り方が「無し」のときは、セクション 9 の T13a の欄に「無し」と記録して終える。あるときは、テストで固定してから実装する。

**完了条件**: 採った案がテストで固定され、T13 の手順 2 を再実行して誤検知の割合が下がったことが記録されている。または「無し」と記録されている。

**検証コマンド**: `pnpm exec vitest run plugins/native-japanese`、T13 の手順 2。

**コミット**: 変更したときだけコミット 4a。

---

Step 5: 書き込み後の検査(設計書のセクション 7)

### T14: `src/check.ts` と PostToolUse の登録

**要点**: 設計書のセクション 7 の全体。入力からの検査対象の取り出し、編集範囲の絞り込み、差し戻し文、無効化、1 セッション 1 回の記録。レビューの焦点 R1、R4。

**担当**: complex-impl(hook を加え、lint・形態素解析の実行時・記録の 3 つをつなぐ)

**スキル**: 不要。

**入力**: T3 の `lint.ts`、T9 の `loadAnalyzer`、T12 の形態素解析の層、T13a の完了。

**出力**: `src/check.ts`、`src/__test__/check.test.ts`、`build.ts`(`entryPoints` に `check`)、`scripts/check.mjs`、`hooks/hooks.json`(PostToolUse を加える)。

**手順**:

1. テストを先に書く。設計書のセクション 13-2 の `check.ts` と `check.ts`(バンドル後)の行をすべて含める。加えて次を確かめる。
   - Edit で、ファイルに元からある違反を差し戻さず、今回の `new_string` の違反だけを差し戻す(R4)。
   - HTML で、編集範囲の外のブロックの違反を差し戻さない。
   - 差し戻し文が 10 件で切られ、残りが件数で書かれる。
   - `session_id` ごとの記録が一時ファイルからの rename で書かれる。
2. `check.ts` を実装する。`discipline.md` の読み込みと `buildRules` の呼び出しは、実行のたびに行う。`build.ts` の `entryPoints` に `check` を足す。
3. `hooks/hooks.json` の PostToolUse に、設計書のセクション 7-1 の matcher で `node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs"` を `timeout` 10 で登録する。
4. `pnpm --filter native-japanese-scripts build` を実行する。

**完了条件**: テストがパスし、lint・typecheck・test・build が通る。

**検証コマンド**:

1. `pnpm exec vitest run plugins/native-japanese/src/__test__/check.test.ts`
2. バンドル後の検証には、次の 2 本の入力を使う。どちらも、書き込み後のファイルを先に置いてから実行する。`session_id` を分けて、1 セッション 1 回の記録が互いに影響しないようにする。

```bash
mkdir -p /tmp/nj-check
printf 'この設定で作業時間を短縮することができる。\n' > /tmp/nj-check/a.md
echo '{"hook_event_name":"PostToolUse","session_id":"nj-verify-1","cwd":"/tmp/nj-check","tool_name":"Write","tool_input":{"file_path":"/tmp/nj-check/a.md","content":"この設定で作業時間を短縮することができる。\n"}}' \
  | node plugins/native-japanese/scripts/check.mjs
```

   出力が `"decision":"block"` を含み、差し戻し文に `koto-dekiru` の違反がある。

3. (R1)形態素解析の違反が当たる入力。`b.md` の本文は、設計書のセクション 5-4 の `bun-nagasa` の当たる例文(句点を除いて 110 字)とする。

```bash
printf '%s\n' '取得が終わるまでの書き込みは正規表現の層だけで検査するので、形態素解析の規則による差し戻しは届かないが、取得が終わった後に書き込めば同じセッションの途中からでも形態素解析の層が加わり文の長さや文末の連続も検査の対象になる。' > /tmp/nj-check/b.md
node -e 'const fs=require("fs");const c=fs.readFileSync("/tmp/nj-check/b.md","utf8");console.log(JSON.stringify({hook_event_name:"PostToolUse",session_id:"nj-verify-2",cwd:"/tmp/nj-check",tool_name:"Write",tool_input:{file_path:"/tmp/nj-check/b.md",content:c}}))' \
  | CLAUDE_PLUGIN_DATA=<データディレクトリ> node plugins/native-japanese/scripts/check.mjs
```

   出力が `"decision":"block"` を含み、差し戻し文に `bun-nagasa` の違反がある。

**コミット**: コミット 5。

### T15: 新しいセッションでの差し戻しの確認

**要点**: 設計書のセクション 14 の Step 5 の完了条件。設計書のセクション 18 の【要確認】のうち、MCP ツールの `tool_input` の形と、サブエージェントの `session_id` を確かめる。hooks.json を変えたので、protected-paths の規則により新しいセッションで発火を確かめる。

**担当**: e2e-verify。Serena を使う手順 3 は、ヘッドレスでは Serena が起動しないため、対話セッションでユーザーに依頼する。

**スキル**: 不要。

**入力**: T14 のバンドル。

**出力**: セクション 9 の T15 の欄。

**手順**:

1. 取得前の確認。`<データディレクトリ>/morph/` に、mtime が今から 10 分以内の `fetch.lock` を置く。これで `maybeStartFetch()` は取得を起動しない。あわせて `morph/lindera-6.2.0/ready.json` を `ready.json.bak` に改名し、`loadAnalyzer` が `null` を返す状態にする。`AMATSUKA_NATIVE_JAPANESE_MORPH=off` はこの確認の代わりに使わない。
2. リポジトリの外の空のディレクトリで `claude -p --plugin-dir <本プラグイン> --model haiku --setting-sources "" --strict-mcp-config` を起動する。Markdown を Write させ、差し戻しを記録する。本文には、避ける語に当たる文と、形態素解析の規則に当たる文の両方を入れる。
3. `ready.json.bak` を `ready.json` に戻し、`fetch.lock` を消す。
4. 取得後の確認。手順 2 と同じ依頼をもう一度行い、差し戻しを記録する。
5. サブエージェントの確認。手順 4 の中で、general-purpose のサブエージェントに Write をさせ、差し戻しがサブエージェントに届くことを確かめる。親とサブエージェントの `session_id` が同じかを、`os.tmpdir()/native-japanese/` の記録ファイルの数で確かめる。
6. Serena の確認(ユーザーの対話セッション)。`claude --plugin-dir <本プラグイン>` でこのリポジトリを開き、Serena の `replace_content` で一時ファイルに避ける語を書かせる。差し戻しが出ることを確かめる。あわせて、`--debug` の出力で `tool_name` と `tool_input` の形を記録する。
7. 確認で作った一時ファイルと記録を消す。

**完了条件**: 次の 2 つをどちらも満たし、手順 5 と 6 の結果が記録されている。

- 取得前(手順 2)は、正規表現の層の違反が 1 件以上あり、形態素解析の違反が 0 件である。
- 取得後(手順 4)は、形態素解析の規則の違反が 1 件以上ある。

**検証コマンド**: `ls "$(node -p 'require("os").tmpdir()')/native-japanese/"`。

**コミット**: なし。

---

Step 6: 適用範囲と規律の組み直し(設計書のセクション 8、10)

### T16: `discipline.md` の改稿(B と D)

**要点**: 設計書のセクション 8(適用範囲の 1 項目)とセクション 10(D の手順 1〜7)。

**担当**: general

**スキル**: `prompt-smith:prompt-smith`(編集の前に起動し、改稿後の全文を評価する)。

**入力**: T13 の基準値と誤検知を除いた度数、T13a の完了(または「無し」の記録)、設計書のセクション 8 の項目の文案。

**出力**: `plugins/native-japanese/references/discipline.md`。

**手順**:

1. 設計書のセクション 8 の 1 項目を、「## 適用範囲」の 3 項目めと 4 項目めの間に加える。
2. 設計書のセクション 10 の手順 2〜7 を、T13 の度数で行う。表の形式(分類の列と「」で囲む語)は変えない。変える必要が出たら止めて報告する(`rules.ts` の読み取りが追随を要するため)。
3. prompt-smith で全文を評価する。prompt-smith が「適用するか」を尋ねる地点で、改稿前との差分と評価の結果をユーザーに示す。この地点を承認地点 A2 と兼ね、ユーザーが止まる地点を 1 か所にする。
4. テストは、コミット 5 の後に実行する。T14 と並行して作業するときは、T14 の作業中のコードで `pnpm run test` が失敗するのを避けるためである。

**承認地点 A2**: ユーザーが `discipline.md` の改稿を承認するまで、T17 に入らず、コミット 6 を作らない。

**完了条件**: ユーザーが承認している。9,000 文字以内。先頭の目印の行が残っている。コミット 5 の後の `pnpm run test` がパスする。

**検証コマンド**: `node -e 'console.log(require("fs").readFileSync("plugins/native-japanese/references/discipline.md","utf8").length)'`、`head -1 plugins/native-japanese/references/discipline.md`、`pnpm run test`。

**コミット**: コミット 6。

---

Step 7: 毎ターンの要約(設計書のセクション 9)

### T17: `references/reminder.md`

**要点**: 設計書のセクション 9。固定のファイルで、300 文字以内。会話の口調は変えない旨の 1 文と、違反の多い規則を最大 5 行。

**担当**: general

**スキル**: `prompt-smith:prompt-smith`(編集の前に起動し、全文を評価する)。

**入力**: T13 の度数、T16 の後の `discipline.md`。

**出力**: `plugins/native-japanese/references/reminder.md`。

**完了条件**: 300 文字以内。載せた規則が T13 の度数の上位から選ばれ、選んだ理由がセクション 9 に記録されている。

**検証コマンド**: `node -e 'console.log(require("fs").readFileSync("plugins/native-japanese/references/reminder.md","utf8").length)'`。

**コミット**: なし(コミット 7)。

### T18: UserPromptSubmit での注入

**要点**: 設計書のセクション 9。コミット 5 の後に置き、`hooks/hooks.json` を T14 と同時に編集しない。

**担当**: complex-impl(フックを加える)

**スキル**: 不要。

**入力**: T17 の `reminder.md`、コミット 5 の後の `inject.ts` と `hooks/hooks.json`。

**出力**: `src/inject.ts`、`src/__test__/inject.test.ts`、`hooks/hooks.json`(UserPromptSubmit を加える)、`scripts/inject.mjs`。

**手順**:

1. テストを先に書く。設計書のセクション 13-2 の `inject.ts` の行のうち、UserPromptSubmit と `reminder.md` の項目を含める。UserPromptSubmit では取得を起動しないことも確かめる。
2. `inject.ts` を直し、`hooks/hooks.json` に UserPromptSubmit を、既存の 2 件と同じコマンドと `timeout` で加える。
3. `pnpm --filter native-japanese-scripts build` を実行する。

**完了条件**: テストがパスし、lint・typecheck・test・build が通る。

**検証コマンド**: `echo '{"hook_event_name":"UserPromptSubmit"}' | node plugins/native-japanese/scripts/inject.mjs` が `reminder.md` の本文を含む JSON 1 行を返す。

**コミット**: コミット 7(T17・T18)。

### T19: 新しいセッションでの注入の確認

**担当**: e2e-verify

**入力**: T18 のバンドル。

**出力**: セクション 9 の T19 の欄。

**手順**: リポジトリの外の空のディレクトリで `claude -p --plugin-dir <本プラグイン> --model haiku --setting-sources "" --strict-mcp-config` を起動し、「ファイルを読まずに、このターンにフックが追加したコンテキストの本文をそのまま示してください」と送る。`reminder.md` の本文が返ることを確かめる。SessionStart の注入(`discipline.md`)が従来どおり届くことも、前回の計画書の T7 と同じ問いで確かめる。

**完了条件**: 2 つの注入がどちらも確かめられている。

**検証コマンド**: 手順の `claude -p`。

**コミット**: なし。

---

Step 8: バージョン・README・ビルド

### T20: README、ルート README、description

**要点**: 設計書のセクション 12 の README の行と、設計書のセクション 16 の README の項目。`description` の変更(セクション 7 の #5)。

**担当**: general

**スキル**: 不要。

**入力**: T1〜T19 の成果物、承認地点 A3 の判断、設計書のセクション 2-2、2-5、5、7-4。

**承認地点 A3**: IPADIC の NOTICE の扱い(設計書のセクション 18)をユーザーに確かめる。判断が出るまで T20 に入らない。

**出力**: `plugins/native-japanese/README.md`、ルートの `README.md`、`plugins/native-japanese/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`。

**手順**:

1. プラグインの README に次を書く。
   - 書き込み後の検査の説明(対象のツール、差し戻しの形、1 セッション 1 回)。
   - 形態素解析の取得物(取得元の URL、サイズ、置き場所、ディスクの使用量)。
   - IPADIC のライセンスと、`NOTICE.txt` の置き場所。書き方は A3 の判断に従う。
   - 対応する OS と、linux-x64 以外は確かめていないこと。
   - 測定 CLI の使い方(`--data-dir` の渡し方を含む)。
   - 「他の口調指示との関係」を、設計書のセクション 8 の 3 項目に揃える。
2. プラグインの README の既存の記述を 2 か所直す。
   - 「## 注入される内容」の「`references/discipline.md` の全文を」を、目印の行を除いて注入する旨に直す。
   - 「## 無効にする方法」(計画立案時の 54 行)の「規律の一部だけを止める設定はありません。」を、2 つの環境変数と、それぞれが止める範囲の説明に置き換える。
3. `description` を次の文言にし、3 か所で揃える。

   日本語の出力に翻訳調や決まり文句を避けて結論から書く規律を注入し、コメントと文書は書き込んだ後に検査して直させ、AIが正しい日本語を書けるようにするプラグイン

   - `plugins/native-japanese/.claude-plugin/plugin.json` の `description`
   - `.claude-plugin/marketplace.json` の native-japanese の要素の `description`(76 行目)
   - ルートの `README.md` の一覧表の native-japanese の行(63 行目)の説明の列
4. ルートの `README.md` の native-japanese の節(152 行目)に、書き込み後の検査を足す。

**完了条件**: 設計書のセクション 16 の README の項目をすべて満たす。`description` が 3 か所で一致する。

**検証コマンド**:

1. `grep -c "AMATSUKA_NATIVE_JAPANESE_CHECK" plugins/native-japanese/README.md` と、`AMATSUKA_NATIVE_JAPANESE_MORPH` `NOTICE` `lindera` の同じコマンドの出力が、どれも `0` でない。
2. `grep -c "規律の一部だけを止める設定はありません" plugins/native-japanese/README.md || true` の出力が `0`。
3. 次の出力が `true`。

```bash
node -e 'const m=require("./.claude-plugin/marketplace.json").plugins.find(p=>p.name==="native-japanese");const p=require("./plugins/native-japanese/.claude-plugin/plugin.json");const r=require("fs").readFileSync("README.md","utf8");console.log(m.description===p.description&&r.includes(p.description))'
```

**コミット**: なし(コミット 8)。

### T21: ARCHITECTURE の追随と Serena メモリ(オーケストレーター)

**担当**: general(オーケストレーター)

**スキル**: `metatron:updating-architecture`(`/metatron:update` から起動する)。

**入力**: T1〜T20 の後の実装。

**出力**: 必要なら ARCHITECTURE の更新、`.serena/memories/` の更新。

**手順**:

1. `/metatron:update` を実行し、`diff-architecture` の乖離(技術スタック、ディレクトリ構成、ドメインマップ)を確かめる。T7 の ADR と食い違う記述があれば直す。変えなかったときは、その判断を記録する。
2. `list_memories` で native-japanese に関わるメモリを探し、改修後の事実と食い違えば `edit_memory` で直す。

**完了条件**: 手順 1 と 2 の結果が記録されている。

**検証コマンド**: `diff-architecture` の `findings` が本件に関わる項目を含まない。

**コミット**: ARCHITECTURE を変えたときはコミット 8a、メモリはコミット 8 に入れる。

### T22: 最終突き合わせとレビュー(オーケストレーター)

**担当**: general(オーケストレーター)。レビューは読み取りだけの依頼として、オーケストレーターがレビューの役割へ出す。

**手順**:

1. 全差分を分割せず読み、設計書と突き合わせる。設計書のセクション 13-2 の表の各行が、どのテストで確かめられているかを表にしてセクション 9 に残す。
2. セクション 1 のレビューの焦点 R1〜R6 のテストと検証がある。
3. `NATIVE_JAPANESE_MORPH_DIR` を設定した `pnpm run test` と、設定しない `pnpm run test` の両方がパスする。
4. 設計書と本計画書を測定 CLI にかける。測定 CLI にはパスで絞るオプションが無いので、2 ファイルだけを入れた一時的な git リポジトリを作り、空のツリーからの差分として測る。

```bash
ROOT=/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
T=$(mktemp -d /tmp/nj-docs-XXXXXX) && cd "$T" && git init -q
cp "$ROOT/harness-docs/design/2026-09-28-native-japanese-enforcement-design.md" "$ROOT/harness-docs/plans/2026-09-28-native-japanese-enforcement-plan.md" .
git add 2026-09-28-native-japanese-enforcement-design.md 2026-09-28-native-japanese-enforcement-plan.md
git -c user.name=t -c user.email=t@t commit -qm docs
node "$ROOT/plugins/native-japanese/scripts/measure.mjs" --git 4b825dc642cb6eb9a060e54bf8d69288fbee4904..HEAD --data-dir <データディレクトリ> --format text
```

   `4b825dc…` は git の空のツリーのハッシュである。違反の例は規則ごとに 3 件までしか出ないので、直してから測り直すことを、合格するまで繰り返す。直すときは、設計書か計画書を直すコミットを足す。

   合格の条件は、測定 CLI が数える範囲(避ける語、翻訳調の 7 型、形態素解析の 4 規則)に限る。その範囲で、誤検知と判断した箇所を除いて違反が 0 件であることとする。判断した箇所と、設計書のセクション 16 の 2 つの基準のどちらに当たるかを記録する。
5. `git status --short plugins/native-japanese/scripts` に未コミットの差分が無い。

**完了条件**: セクション 8 の Done 条件をすべて満たす。

**コミット**: 手順 4 で直したときだけ、文書の修正のコミットを足す。

## 3. 依存関係

```text
T0 ─┬─ T1 ─┬─ T3 ─┐
    ├─ T2 ─┘      │
    ├─ T4 ─ T5 ───┴─ T6 ─(コミット 1)─┐
    ├─ T7 ─(A1)─(コミット 2)──────────┤
    └─ T8 ────────────────────────────┴─ T9(コミット 1 の後)─(コミット 3)─ T10 ─ T11 ─ T12 ─(コミット 4)─ T13 ─ T13a
                                                                                                               │
                                     ┌─────────────────────────────────────────────────────────────────────────┤
                                     ├─ T14 ─(コミット 5)─ T15
                                     └─ T16 ─(A2)─(コミット 6)
    コミット 5 とコミット 6 の後: T17 ─ T18 ─(コミット 7)─ T19 ─(A3)─ T20 ─ T21 ─ T22
```

- T1、T2、T4 は互いにファイルが重ならないので、並行してよい。T3 は T1 と T2 の後に置く。`lint.ts` は両方の契約を使う。
- T5 は T4 の後に置く。テストの期待値が目印の行の有無に依る。
- T6 は T3 と T5 の後に置く。測定 CLI は lint を使い、`--git` の検証で目印の効き目を見る。
- T7 と T8 は T0 の直後から並行してよい。T7 は文書だけ、T8 は純粋な関数だけを扱い、Step 1 のファイルと重ならない。
- T9 は T8、承認地点 A1、コミット 1 の後に置く。ADR の承認前に、外部から取得する実装を入れない。T9 は T5 が変えた `inject.ts` を続けて変える。
- T11 は T10 の後に置く。固定データは実物の取得物から作る。
- T12 は T3、T6、T9、T11 の後に置く。
- T14 は、実装だけなら T12 の後に T13 と並行して始めてよい。完了とコミット 5 は T13a の後にする。絞る前の規則で hook を有効にしないためである。
- T16 は T13a の完了後に始める。T13a が不要なときは、「無し」と記録してから始める。T14 との並行は許すが、T16 のテストの実行はコミット 5 の後に限る。コミットの順は、コミット 5 → コミット 6 とする。
- T17 は T16 の後に置く。要約に載せる規則は、組み直した後の `discipline.md` の文言に合わせる。
- T18 は T17 とコミット 5 の後に置く。`hooks/hooks.json` を T14 と同時に編集しないためである。
- T19 は T18 の後に置く。T20 は T19 と承認地点 A3 の後に置く。README には確かめた結果(対応 OS、取得物のパス)を書く。
- T21 と T22 は最後に置く。

## 4. タスク間で共有する契約

依頼文へ転記し、担当が推測で決めないようにする。型は TypeScript の概略で示す。

| 契約 | 値 | 生み出すタスク | 使うタスク |
| --- | --- | --- | --- |
| 規則 | `src/lib/rules.ts` が `export interface Rule { id: string; category: string; pattern: RegExp; advice: string }` と `export function buildRules(discipline: string): Rule[]` を持つ。翻訳調の 7 型の `id` は設計書のセクション 4-2 の表の値。`buildRules` は、エントリポイント(`check.ts`、`measure.ts`)が呼び出しのたびに `discipline.md` を読んで実行する。キャッシュしない。テストは実物の `discipline.md` を読む | T1 | T3、T6、T12、T13a、T14 |
| 抜き出し | `src/lib/extract.ts` が次を持つ。`export type BlockKind = "prose" \| "list" \| "comment" \| "heading" \| "table"`。`export interface Block { kind: BlockKind; text: string; lineOf: number[] }`(`lineOf[i]` は `text` の i 字目の元の行番号、1 始まり)。`export interface Source { path: string; text: string; cellType?: "markdown" \| "code" }`。`export function extractLines(src: Source): { line: number; text: string }[]`、`export function extractBlocks(src: Source): Block[]`、`export function hasIgnoreMarker(src: Source): boolean`、`export function isHtml(path: string): boolean` | T2 | T3、T6、T12、T14 |
| lint | `src/lib/lint.ts` が次を持つ。`export interface Violation { line: number; endLine: number; text: string; ruleId: string; category: string; match: string; advice: string }`。`export interface Analyzer { tokenize(text: string): { surface: string; details: string[] }[] }`。`export function lint(src: Source, opts: { rules: Rule[]; analyzer?: Analyzer \| null; wholeFile?: Source }): Violation[]`。`wholeFile` は書き込み後のファイル全体で、形態素解析の層と HTML の正規表現の層はこちらに当てる。`export function findEditRanges(fileText: string, bodies: string[]): ({ start: number; end: number } \| null)[]`。`start` と `end` は 1 始まりの行番号で、両端を含む。`export function overlaps(v: Violation, ranges: { start: number; end: number }[]): boolean`。`v.line` から `v.endLine` までが、どれかの範囲と 1 行でも重なれば真 | T3 | T6、T12、T14 |
| 形態素解析 | `src/lib/morph.ts` が `export interface Token { surface: string; pos: string; pos1: string; pos2: string; conjType: string; conjForm: string; base: string }`、`export function toToken(raw: { surface: string; details: string[] }): Token`、`export function checkBlocks(blocks: Block[], analyzer: Analyzer): Violation[]` を持つ。規則の `id` は `muse-shugo` `bunmatsu-renzoku` `bun-nagasa` `rentai-kasanari` | T12 | T13a、T14 |
| 固定データ | `src/fixtures/morph/sentences.txt` は 1 行 1 例文。`src/fixtures/morph/tokens.json` は `{ text: string; tokens: { surface: string; details: string[] }[] }[]` で、`sentences.txt` と同じ順 | T11 | T12 |
| 展開 | `src/lib/archive.ts` が `export function extractTarEntry(tgz: Buffer, name: string): Buffer \| null` と `export function extractZipEntries(zip: Buffer, prefix: string, names: string[]): Map<string, Buffer>` を持つ。`extractTarEntry` は gzip の展開も行う | T8 | T9 |
| 形態素解析の実行時 | `src/morph-runtime.ts` が `SOURCES`、`export function resolveTarget(): string \| null`、`export function loadAnalyzer(dataDir: string \| undefined): Analyzer \| null`、`export function maybeStartFetch(env: NodeJS.ProcessEnv): void`、`export async function installMorph(opts: { dataDir: string; target: string; sources: typeof SOURCES }): Promise<void>` を持つ。`SOURCES` の `.node` の 6 種は、設計書のセクション 2-5 の表の URL・tarball 内のパス・sha256 をそのまま持つ。辞書は URL `https://github.com/lindera/lindera/releases/download/v6.2.0/lindera-ipadic-6.2.0.zip`、sha256 `5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72` の 1 件だけで、neologd の辞書は持たない。置き場所は設計書のセクション 5-2 の図のとおり `${CLAUDE_PLUGIN_DATA}/morph/lindera-6.2.0/` | T9 | T10、T12、T14 |
| 測定 CLI | 入口 `src/measure.ts`、出力 `scripts/measure.mjs`。オプションは設計書のセクション 6-1 の表の 5 つ。`--format json` の出力は `{ morph: { used: boolean; reason?: string }, lines: number, sentences: number, violations: number, per100Lines: number, byRule: { ruleId: string; layer: "regex" \| "morph"; count: number }[], byWriter?: { writer: string; lines: number; violations: number }[], examples: Record<string, Violation[]> }`。形は T6 で確定し、T6 の時点の `morph` は `{ used: false, reason }`、`sentences` は `0` とする。T12 は値を埋めるだけで、形を変えない | T6 | T12、T13、T22 |
| hook | `hooks/hooks.json` は SessionStart と SubagentStart(既存)、PostToolUse(T14、設計書のセクション 7-1 の matcher)、UserPromptSubmit(T18)を持つ。コマンドは `node "${CLAUDE_PLUGIN_ROOT}/scripts/<名前>.mjs"`、`timeout` 10 | T14、T18 | T15、T19 |
| バージョンと description | `plugin.json` と `package.json` の `version` は `0.2.0-dev`(T6)。`description` は T20 で、セクション 2 の T20 の手順 3 の文言に変え、`plugin.json`・`marketplace.json`・ルートの `README.md` の一覧表で揃える | T6、T20 | T22 |

**ファイルの持ち主**

| ファイル | 変えるタスク |
| --- | --- |
| `src/lib/rules.ts` | T1、T13a |
| `src/lib/extract.ts` | T2 |
| `src/lib/lint.ts` | T3、T12 |
| `src/lib/morph.ts` | T12、T13a |
| `src/lib/archive.ts`、`src/fixtures/archive/` | T8 |
| `src/morph-runtime.ts`、`src/fetch-morph.ts` | T9 |
| `src/inject.ts`、`src/__test__/inject.test.ts`、`scripts/inject.mjs` | T5、T9、T18 |
| `src/measure.ts`、`scripts/measure.mjs`、`src/fixtures/transcripts/` | T6、T12 |
| `src/check.ts`、`scripts/check.mjs` | T14 |
| `src/testing/dump-tokens.mjs`、`src/fixtures/morph/` | T11 |
| `build.ts` | T6、T9、T14 |
| `hooks/hooks.json` | T14、T18 |
| `references/discipline.md` | T4、T16 |
| `references/reminder.md` | T17 |
| `.claude-plugin/plugin.json` | T6(`version`)、T20(`description`) |
| `package.json` | T6 |
| `plugins/native-japanese/README.md`、ルートの `README.md`、`.claude-plugin/marketplace.json` | T20 |
| `harness-docs/ARCHITECTURE.md` | T7、T21(metatron の CLI だけ) |
| `.serena/memories/` | T21(`edit_memory` だけ) |

## 5. コミット

| # | タスク | メッセージ | 含めるファイル |
| --- | --- | --- | --- |
| 1 | T1〜T6 | `feat(native-japanese): 書き込みを検査する lint 本体と測定 CLI を追加し 0.2.0-dev に上げる` | `plugins/native-japanese/src/lib/{rules,extract,lint}.ts` とそのテスト、`src/inject.ts`、`src/__test__/inject.test.ts`、`src/measure.ts`、`src/__test__/measure.test.ts`、`src/fixtures/transcripts/`、`build.ts`、`scripts/inject.mjs`、`scripts/measure.mjs`、`references/discipline.md`、`.claude-plugin/plugin.json`、`package.json` |
| 2 | T7 | `docs(architecture): [native-japanese] 形態素解析の取得物を git に同梱しない ADR を追加し、システム概要と技術スタックに実行時の取得を追記する` | `harness-docs/ARCHITECTURE.md` |
| 3 | T8・T9 | `feat(native-japanese): 形態素解析の実行物と辞書を初回に取得して読み込む` | `src/lib/archive.ts` とそのテスト、`src/fixtures/archive/`、`src/morph-runtime.ts`、`src/fetch-morph.ts`、`src/inject.ts`、`src/__test__/{morph-runtime,inject}.test.ts`、`src/testing/` の差し替え用スクリプト、`build.ts`、`scripts/{inject,fetch-morph}.mjs` |
| 4 | T11・T12 | `feat(native-japanese): 形態素解析で文の規律 4 つを検査する` | `src/lib/morph.ts` とそのテスト、`src/lib/lint.ts`、`src/measure.ts` とそれぞれのテスト、`src/testing/dump-tokens.mjs`、`src/fixtures/morph/`、`scripts/measure.mjs` |
| 4a | T13a | `fix(native-japanese): 基準値の誤検知から規則を絞る` | 変えたファイルとテスト、`scripts/*.mjs` |
| 5 | T14 | `feat(native-japanese): 書き込み後に規律の違反を差し戻す PostToolUse を加える` | `src/check.ts`、`src/__test__/check.test.ts`、`build.ts`、`scripts/check.mjs`、`hooks/hooks.json` |
| 6 | T16 | `docs(native-japanese): 規律の適用範囲を明記し、測定結果から組み直す` | `references/discipline.md` |
| 7 | T17・T18 | `feat(native-japanese): 毎ターン短い要約を注入する` | `references/reminder.md`、`src/inject.ts`、`src/__test__/inject.test.ts`、`hooks/hooks.json`、`scripts/inject.mjs` |
| 8 | T20・T21・実施記録 | `docs(native-japanese): README と description を更新し、実施記録を残す` | `plugins/native-japanese/README.md`、`plugins/native-japanese/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`、`README.md`、`harness-docs/plans/2026-09-28-native-japanese-enforcement-plan.md`、`.serena/memories/` の変更 |
| 8a | T21 | `docs(architecture): native-japanese 0.2.0-dev に追随する` | `harness-docs/ARCHITECTURE.md`(変えたときだけ) |

- 含めるファイルのパスは、特に書かない限り `plugins/native-japanese/` からの相対である。
- すべてのメッセージの末尾に、セッションの指示にある Co-Authored-By の行を付ける。
- `src/` を変えたコミットには、対応する `scripts/*.mjs` を含める。
- 各コミットの前に `git status --short` を見て、上の列のファイルだけを `git add <パス>` で加える。
- 各コミットの時点で lint・typecheck・test・build が通り、build の後に `git status --short plugins/native-japanese/scripts` に未コミットの差分が残らない。
- コミット 2 は `commit-architecture` が書き込んだ後に、オーケストレーターが git のコミットを作る。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| T10 の取得が、このマシンのネットワークの制限で失敗する | `fetch-failed.json` の理由を記録して止める。設計時の取得物(`/tmp/nj-pin/`)の sha256 は契約の値と一致しているので、ローカルの HTTP サーバーから配って `installMorph` を通す代替を、オーケストレーターの判断で行う |
| 形態素解析の規則の誤検知が多く、T13a が 1 回で済まない | T13 と T13a を繰り返してよい。2 回で半分を下回らない規則は、その規則を hook から外す案をオーケストレーターがユーザーに示す。外すかは設計の変更なので、担当は決めない |
| T14 の PostToolUse が、実装中のこのリポジトリのセッションで差し戻しを出し、作業を妨げる | `--plugin-dir` で読み込ませたセッションだけで確かめる。インストール済みのプラグインは更新しない。作業のセッションでは `AMATSUKA_NATIVE_JAPANESE_CHECK=off` を使ってよい |
| `inject.ts` を T5・T9・T18 が、`hooks/hooks.json` を T14・T18 が順に変え、変更がぶつかる | ファイルの持ち主の表のとおり順に変える。T18 はコミット 5 の後に置き、並行させない |
| T15 の取得前の確認で、`ready.json` を戻し忘れる | T15 の手順 3 で戻し、手順 4 の前に `ls` で確かめる |
| 取得の子プロセスが、Claude Code の終了とともに止められる(【要確認】) | T10 で確かめる。止められるときは設計の前提が崩れるので、実装を止めて報告する |
| 固定データの JSON が大きくなり、差分が読めない | 例文を規則の確認に要る数に絞る。`surface` と `details` 以外を書き出さない |
| HTML の正規表現の抜き出しで、テストの例以外の形が崩れる | T2 の手順 2 で、複数行・`<script>`・属性値を固定する。上限は `ponytail:` のコメントに残す |

## 7. 設計書との食い違い

計画立案時に決めた事項と、見つけた食い違いを記録する。実装中に見つけたものも、この表へ追記する。

| # | 検出タスク | 設計書の記述 | 計画での扱い | 判断 |
| --- | --- | --- | --- | --- |
| 1 | 計画 | 設計書のセクション 4-4 は `lint(path, text, analyzer?)` とする。一方で設計書のセクション 4-1 は `src/lib/` がファイルを読まないとするので、規則をどこから得るかが書かれていない | `lint(src, { rules, analyzer, wholeFile })` とし、規則と書き込み後のファイル全体を呼び出し側から渡す(セクション 4 の「lint」) | 計画で決定 |
| 2 | 計画 | 設計書のセクション 9 は、`discipline.md` の目印の行を E(Step 7)の中で置くとする | 目印は Step 1 の T4 で置き、`inject.ts` の除去も T5 で入れる。Step 4 の基準値で `discipline.md` の避ける語の表を違反として数えないためである | 計画で決定 |
| 3 | 計画 | 設計書のセクション 14 は、バージョンを Step 8 で上げるとする | T6(コミット 1)で `0.2.0-dev` に上げる。conventions は改修したらバージョンを上げるとしており、最初の改修のコミットから揃える | 計画で決定 |
| 4 | 計画 | 設計書のセクション 18 は、lindera のフィールド名の逆転と ESM のバンドルの失敗を GOTCHAS に記録するかは決めていないとする | 設計書の承認後に、GOTCHA-003 と GOTCHA-004 としてコミット `1de0b5cf` で記録済みである。本計画ではこの項目を解決済みとして扱う | 解決済み |
| 5 | 計画 | 設計書のセクション 12 は `plugin.json` の変更をバージョンだけとする。`description` はセッション開始時とサブエージェント起動時の注入だけを述べ、書き込み後の検査に触れない | ユーザーが `description` を変えると決めた。文言は T20 の手順 3 のとおりで、`plugin.json`・`marketplace.json`・ルートの `README.md` の一覧表の 3 か所で揃える。protected-paths は `marketplace.json` をプラグインの追加と削除のときだけ変えるとするが、今回の変更はユーザーの指示による例外である | ユーザーの決定 |
| 6 | 計画 | 設計書のセクション 2-2 と 2-5 は、辞書の zip のファイル名と sha256 を示すが、ダウンロードの URL を契約として書いていない | 辞書の URL を `https://github.com/lindera/lindera/releases/download/v6.2.0/lindera-ipadic-6.2.0.zip`、sha256 を `5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72` に固定する。neologd の辞書は取得しない(セクション 4 の「形態素解析の実行時」) | 計画で決定 |
| 7 | 計画 | conventions は、`harness-docs/**/*.md` の作成と編集の前に `prompt-smith:prompt-smith` を起動するとする | 設計書・本計画書・セクション 9 の実施記録には prompt-smith を当てない | ユーザーの決定 |
| 8 | 計画 | conventions は、`references/**/*.md` の編集の前に `prompt-smith:prompt-smith` を起動するとする | T4 は目印の 2 行を機械的に挿入するだけなので、prompt-smith を起動しない。全文の評価は T16 と T17 で行う | オーケストレーターの決定 |
| 9 | T1 | 設計書も計画書も、避ける語の規則の `id` を定めていない | `avoid:<語>` とする(例: `avoid:ポイントは`)。測定 CLI の `byRule` はこの `id` で集計する | オーケストレーターの決定 |
| 10 | T3 | 設計書セクション 4-2 の `koto-dekiru` の正規表現(概略)は `することが(でき\|可能)` である。一方で設計書 13-2 と計画書 T3 は、`変えることができる` が `koto-dekiru` に当たるとする | 正規表現を `ことが(でき\|可能)` に広げ、advice を「`することができ` は `でき` に、`〜ことができ` は可能形に縮める」に直した。`discipline.md` の「〜することができる」の型は、「する」以外の動詞にも同じく当たる | オーケストレーターの決定。誤検知は T13 で見る |
| 11 | T2 | 設計書セクション 4-3 の表は、行単位の抜き出しでインラインコードを空白にする対象を Markdown に限っている | コードのコメントでも、インラインコードを空白に置き換える。避ける語をバッククォートで引用したコメントが差し戻されないようにするためである | オーケストレーターの決定 |
| 12 | T2、T11 | 設計書セクション 4-3 は、インラインコードと URL を置き換える 1 字を実装で決めるとし、名詞として解析されることを求める | T2 は全角の `Ｘ`(U+FF38)にしたが、T11 で IPADIC が `記号,アルファベット` と解析すると分かった。`甲` は `名詞,一般` になるので、T12 で置き換え字を `甲` に変えた | オーケストレーターの決定 |
| 13 | T8 | 計画書 T8 の手順 1 は、zip を `python3 -m zipfile -c` で作るとする | `..` を含む項目名は `-c` では入れられないので、Python の `zipfile` の `writestr` で作った | 実装で決定 |
| 15 | T14 | 設計書セクション 7-2 は、書き込み後のファイルの中から本文を探して編集範囲を決めるとする。NotebookEdit の `.ipynb` は JSON なので、セルの本文をそのままでは探せない | NotebookEdit では、書いたセルの本文を書き込み後のファイル全体とみなし、セル全体を編集範囲にする。ノートの他のセルにある目印は見ず、段落もセルをまたいで組まない | オーケストレーターの決定 |
| 16 | T13 | 設計書セクション 5-4 は 4 規則の判定を定め、6-3 は基準値の誤検知が半分を超えた規則を絞るとする | セクション 9 の T13 の欄の N1〜N4 で絞った。N1(引用のブロック)は `extract.ts`、N2(「」の中の一致)は `lint.ts` を変える。計画書のファイルの持ち主の表では、T13a が変えるのは `morph.ts` と `rules.ts` だけである | オーケストレーターの決定 |
| 17 | T22 | セクション 5 は、T22 で足すコミットを文書の修正だけとする | 最終レビューの指摘 6 件の修正を、コミット `18b1f708`(`fix(native-japanese): 最終レビューの指摘を直す`)として足した。設計書の修正は、コミット `0d232de8` として足した | オーケストレーターの決定 |
| 14 | 実施 | 計画書は委譲先を custom 構成の役割マーカーで想定している | セッションの途中で claude 構成へフォールバックし、さらに Sonnet のモデルがプロキシに無かった。Sonnet の役割(normal-impl、general、e2e-verify)は Opus で起動した | オーケストレーターの決定 |

## 8. Done 条件

conventions の Done の条件と、設計書のセクション 16 を合わせる。

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` がパスする。`NATIVE_JAPANESE_MORPH_DIR` を設定した `pnpm run test` も、取得済みの開発機でパスする。
- `pnpm run build` の成果物(`plugins/native-japanese/scripts/*.mjs`)が、対応する `src/` の変更と同じコミットに入っている。
- `plugins/native-japanese/.claude-plugin/plugin.json` と `package.json` の `version` が `0.2.0-dev` で揃っている。
- ルートの `README.md` に本改修が反映され、`description` が `plugin.json` と `marketplace.json` と揃っている(T20)。
- ADR が `metatron:updating-architecture` の手順で ARCHITECTURE に入っている(T7)。ARCHITECTURE のほかの記述が `/metatron:update` で追随している(T21)。
- 改修した内容と `.serena/memories/` の記述が食い違わない(T21)。
- コミットがセクション 5 の単位に分かれている。
- 新しいセッションで、取得の前は正規表現の層の違反だけが、取得の後は形態素解析の規則の違反も差し戻される(T15 の完了条件)。
- 設計書と本計画書を測定 CLI にかけ、測定 CLI が数える範囲で、誤検知と判断した箇所を除いて違反が 0 件である。判断した箇所と、設計書のセクション 16 の 2 つの基準のどちらに当たるかが、セクション 9 に記録されている(T22)。
- プラグインの README に、取得する外部資産(取得元、サイズ、置き場所)、IPADIC のライセンス、2 つの環境変数が書いてある(T20)。
- 承認地点 A1・A2・A3 の結果が、セクション 9 に記録されている。
- セクション 1 のレビューの焦点 R1〜R6 のテストと検証が、指定したタスクにある。
- T0 の baseline と、T10・T13・T13a・T15・T19 の結果がセクション 9 に記録されている。

## 9. 実施記録

実施時に記入する。prompt-smith は当てない(セクション 7 の #7)。

### T0 baseline

- 実施日: 2026-09-29。HEAD は `a302ced8`。`348a5304` 以降のコミットは `46d027b0`(計画書)と `a302ced8`(引き継ぎ資料)の 2 件で、どちらも文書だけである。
- 本件と無関係な未コミット変更: `docs/chat/2026/0928/phyllis998/native-japanese-guideline-reinforcement.md` と `docs/chat/INDEX.md`。触らず、コミットにも含めない。
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` はすべて exit 0 だった。全体のテストは 175 ファイル(1 ファイルはスキップ)、2616 件がパスし 2 件がスキップされた。native-japanese は 1 ファイル 13 件がパスした。build の後、`scripts/` に差分は出なかった。
- `plugin.json` と `package.json` の `version` は、どちらも `0.1.0-dev` だった。
- `discipline.md` は 3,853 文字だった。
- セッションの途中で agent-policy の方針が custom から claude へフォールバックした(プロキシの `/v1/models` を照会できなかったため)。normal-impl と light-impl の委譲先は、ビルトインの `general-purpose` に Sonnet と Haiku を注入して起動する。

### A1 ADR の承認

- 2026-09-29 にユーザーが承認した。ADR-006 として追加した(コミット `1e1221fd`)。
- 草案は、`metatron:updating-architecture` の手順で第三者に執筆規律を検査させ、11 件の指摘を反映した。設計書セクション 11 の `.node` の大きさ「5〜7.4MB」は下限の根拠が無かったので、「最大 7.4MB」と書いた(linux-x64 の実物は 7,654,784 バイト)。
- システム概要と技術スタックへの追記は別の stage で承認を得た。ユーザーの指示で、追記の文から「(ADR-006)」の参照を外した。
- `diff-architecture` が返した本件と無関係な既存の乖離 17 件(技術スタックの語の誤検出、`.vscode` `private` などの未記載のディレクトリ、死んだ glob)は、ユーザーの判断で今回は扱わない。

### T10 取得の確認

- 実施日: 2026-09-29。リポジトリの外の一時ディレクトリで、`claude -p --plugin-dir <本プラグイン> --model haiku --setting-sources "" --strict-mcp-config "こんにちは"` を実行した。
- `CLAUDE_PLUGIN_DATA` の実際のパスは `/home/hiro0209/.claude/plugins/data/native-japanese-inline` だった(推定どおり)。以下の `<データディレクトリ>` はこのパスを指す。実行前の `morph/` は無かった。
- 1 回目(取得あり)の所要は 4.222 秒で、exit 0 だった。`ready.json` がある状態の 2 回目は 4.425 秒で、差が無い。hook は取得の終了を待っていない。
- `morph/lindera-6.2.0/` に `lindera.linux-x64-gnu.node`(7,654,784 バイト)、`ipadic/` の 10 ファイル(`NOTICE.txt` 4,092 バイトを含む)、11 項目の `ready.json` ができた。`dict.words` が最大で 32,674,733 バイトある。`fetch.lock` と `fetch-failed.json` は残らなかった。
- 取得は hook の開始から約 2.4 秒で終わり、`claude` が終わる 1.4 秒前に `ready.json` が置かれた。そのため、`claude` の終了後も子プロセスが残って取得を続けるか(設計書セクション 18 の【要確認】)は、今回の実行では確かめられていない【要確認】。起動は `detached: true` と `unref()` で行っている。取得にかかる 2.4 秒は対話セッションの長さより十分短いので、オーケストレーターは、取得が終わる前にセッションが終わる場合を設計の前提を崩すものとは扱わず、次回の取得で補われると判断した。

### T13 基準値、誤検知の判定、採った絞り方

測定は HEAD `e493f9ab` の測定 CLI で、形態素解析を使って行った(2 つとも `morph.used: true`)。測定結果の全件は `/tmp/nj-baseline/` に置いた。

| 対象 | 行数 | 文の数 | 違反 | 100 行あたり |
| --- | --- | --- | --- | --- |
| `--git 4049e9e..HEAD` | 4,062 | 5,532 | 90 | 2.22 |
| `--transcripts … --since 2026-09-26` | 3,011 | 3,641 | 166 | 5.51 |

規則ごとの件数(`--git` / `--transcripts`)は次のとおり。

- 形態素解析の層: `rentai-kasanari` 61 / 54、`bun-nagasa` 5 / 3、`muse-shugo` 4 / 3、`bunmatsu-renzoku` 2 / 2
- 正規表現の層: `koto-dekiru` 8 / 10、`hoka-naranai` 2 / 5、`kanten` 1 / 4、`koto-ni-yotte` 1 / 4、`ni-totte-juyo` 1 / 4、`avoid:様々な` 4 / 0、`avoid:まとめると` 1 / 1。残りの避ける語は `--transcripts` の側だけで、ほぼすべてが `discipline.md` の表の行である

誤検知の判定は、設計書セクション 16 の 2 つの基準で行った。基準 1 は意図した引用・固有名詞・識別子・コード例、基準 2 は規律の文言に照らすと違反でない箇所である。

- 正規表現の層(`--git` 18 件、`--transcripts` 約 100 件): 誤検知でないのは、`--git` の `avoid:まとめると` 1 件(会話記録の応答文「3 者の結果をまとめると、…」)だけだった。残りはすべて基準 1 に当たる。
  - 会話記録の `>` で始まる行に記録されたユーザーの発言(`様々な判断` `行うことができれば` など)
  - 「」で囲んで型の名前を引いた箇所(`「〜することができる」のような癖` `「短縮することができる」を解析し` など)
  - 規律の表の行と、本プラグインの固定データとテスト
  - `--transcripts` では、Edit の本文に ignore-file の目印が含まれないので、`discipline.md` への書き込みも数えている。hook では、書き込み後のファイル全体で目印を判定するので差し戻さない
  - 規則ごとの誤検知の割合は、`avoid:まとめると`(1 件中 0 件)を除き、どれも 100% だった。
- `rentai-kasanari`(`--git` の 20 件の抜粋): 誤検知でないのは 4 件(会話記録の応答文 1、プロンプト 1、ARCHITECTURE のシステム概要の先頭の文 1、テストのコメント 1)で、誤検知は 16 件(80%)だった。誤検知の内訳は次のとおり。
  - 基準 1: 会話記録の `>` の行のユーザーの発言が 5 件、固定データと文字列リテラルが 2 件
  - 基準 2: 3 つに分かれる。
    - 動詞や助動詞の直後に括弧が来て、括弧の中の名詞を修飾の先と数えたもの 4 件(`加えた(セクション 8)` `記録する(計画書 T7)` など)
    - 形容詞 1 語の修飾を節と数えたもの 1 件(`新しい node プロセス`)
    - 別々の名詞への並列の修飾 4 件(`使っているテストと…比べているテスト` `判別する案・opt-in化する案・…足す案` など)
  - `--transcripts` の抜粋も同じ型に分かれた。
- `bun-nagasa`(8 件): 誤検知でないのは 2 件(抗体の文、ADR の草案の背景の文)だった。残る 6 件のうち 4 件は本プラグインの固定データ、1 件は会話記録のユーザーの発言、1 件は「」の引用が大半を占める文である。本プラグインの固定データを除くと、4 件中 2 件(50%)が誤検知で、半分を超えない。
- `muse-shugo`(7 件): 固定データ以外は 1 件(`docs-reviewer が…ぶつかることを示しました`)だけで、設計書セクション 5-4 が「人を指す普通名詞が主語の文」として誤検知に残すとした型だった。述語の一覧の見直しに使える例が 1 件しか無いので、一覧は変えない。
- `bunmatsu-renzoku`(4 件): 固定データ以外は 2 件で、どちらも誤検知だった。1 件は会話記録のユーザーの発言、もう 1 件は敬体の README(`plugins/jevriel/README.md`)で「ます」が 4 文続いたものである。敬体では、どの文も「ます」か「です」で終わる。

採った絞り方は次の 4 つである。どれも、設計書セクション 5-4 の「保守的に判定する」の範囲で判定を狭める。

- N1: Markdown の `>` で始まる行(引用のブロック)を、どちらの層でも抜き出さない。引用はその文書の書き手の文ではない(基準 1)。
- N2: 正規表現の層で、`「…」` か `『…』` の中に収まる一致を違反にしない。型の名前や語を引くときの書き方である(基準 1)。
- N3: `rentai-kasanari` で、修飾する語と名詞の間に記号(括弧など)がある箇所は、修飾の節に数えない。形容詞 1 語の修飾も、形容動詞と同じく 1 語の形容とみなして数えない。
- N4: `bunmatsu-renzoku` で、文末表現が「ます」「です」「ました」「でした」だけのときは、1 字の文末表現と同じく連続を切る。

別々の名詞への並列の修飾(`rentai-kasanari`)は、品詞の並びだけでは入れ子と区別できないので、今回は絞らない。N1〜N3 の後も誤検知が半分を超えるかは、T13a で測り直して確かめる。

### T13a 規則の絞り込み

絞り込みは 3 回行った(コミット `dd97631f`)。各回の後に、T13 と同じ 2 つを同じ HEAD(`e493f9ab`)で測り直した。結果は `/tmp/nj-baseline/after*.json` にある。`--transcripts` では、測り直しのあいだに会話記録が増えた。そのため、行数が 3,011 行から 3,105 行に変わっている。

| 回 | 絞り方 | 違反(`--git` / `--transcripts`) |
| --- | --- | --- |
| 前 | — | 90 / 166 |
| 1 | N1〜N4(T13 の欄) | 45 / 63 |
| 2 | N5: `rentai-kasanari` の区間の区切りに、括弧類(`(` `)` `（` `）` `[` `]` `「` `」` `『` `』` `【` `】`)とコロンを加える | 30 / 44 |
| 3 | N6: 正規表現の層で、直前 3 字以内に区切りの字を挟まず「〜」がある一致(`〜することができる` のように型の名前を示す書き方)を違反にしない。N7: 避ける語の先頭と末尾の「〜」を取り除いてから規則を組み立てる。N8: `rentai-kasanari` で数えない名詞に `たび` `度` を足す | 24 / 27 |

1 回目の実装で、IPADIC が半角の括弧を `名詞,サ変接続` と解析すると分かった。そのため N3 の「記号」には、表層が半角の記号だけの形態素も含めた。

3 回目の後の誤検知の割合は、オーケストレーターが次のように判定した。

- `rentai-kasanari`(`--git` 13 件、`--transcripts` 11 件): 2 回目の後の 20 件の抜粋のうち、誤検知は 9 件(45%)だった。内訳は、別々の名詞への並列の修飾が 4 件、本プラグインの固定データが 3 件、用語として固まった語(`避ける語`)が 1 件、`〜するたび` が 1 件である。`〜するたび` は 3 回目の N8 で外した。誤検知は半分を下回る。
- 正規表現の層(`--git` 3 件、`--transcripts` 10 件): 誤検知でないのは、`--git` の `avoid:まとめると` 1 件だけである。残りの 12 件は、次の 3 つのどれかにある誤検知(基準 1)である。
  - `discipline.md` の表の例文。ignore-file の目印があるので、hook では差し戻さない。`--transcripts` は Edit の本文だけを見るので、数えてしまう。
  - 本プラグインの固定データ。
  - テストの文字列リテラル。
  - 本プラグインの外の書き込みでは、誤検知が 0 件になった。
- `bun-nagasa`(3 / 3)、`muse-shugo`(4 / 3)、`bunmatsu-renzoku`(1 / 1): 固定データを除くと 3 件である。抗体の文(`bun-nagasa`)は誤検知ではない。メモリの description を引いた文(`bun-nagasa`)と、`docs-reviewer が…示しました`(`muse-shugo`、設計書が残すとした型)は誤検知である。

誤検知を除いた度数(T16 と T17 の入力)は、`--git` と `--transcripts` の合計で次のとおりとする。

| 規則 | 度数 |
| --- | --- |
| `rentai-kasanari` | 13(24 件に抜粋の 55% を掛けて推定) |
| `bun-nagasa` | 1 |
| `avoid:まとめると` | 1 |
| ほかの正規表現の層の規則、`muse-shugo`、`bunmatsu-renzoku` | 0 |

別々の名詞への並列の修飾は、品詞の並びだけでは入れ子と区別できないので、絞らずに残した。

### T15 差し戻しの確認

- 実施日: 2026-09-29。リポジトリの外の一時ディレクトリで、`claude -p --plugin-dir <本プラグイン> --model haiku --setting-sources "" --strict-mcp-config --permission-mode acceptEdits` を実行した。hook の出力の原文は、`--output-format stream-json --verbose --include-hook-events` の `system/hook_response` から取り出した。
- 同じ本文を Write させた。本文の 1 行目は `koto-dekiru` に当たり、2 行目は設計書セクション 5-4 の `bun-nagasa` の例文である。
- 取得前(`fetch.lock` を置き、`ready.json` を `ready.json.bak` に改名した状態): 差し戻しは `koto-dekiru` の 1 件だけで、`bun-nagasa` は 0 件だった。hook は `PostToolUse:Write` として発火し、exit code は 0 だった。
- 取得後(`ready.json` を戻し、`fetch.lock` を消した状態): 差し戻しは 2 件だった。L1 が `koto-dekiru`、L2 が `bun-nagasa` で、該当箇所には文の先頭 20 字が載った。
- サブエージェント: `general-purpose` のサブエージェントの Write にも、同じ差し戻しが届いた。記録ファイルは 1 つだけ増え、その `session_id` は親セッションの `session_id` と一致した。サブエージェントの PostToolUse は、親と同じ `session_id` を受け取る(設計書セクション 18 の【要確認】の 2 項目めを解消した)。親とサブエージェントは記録を共有する。
- 完了条件を 2 つとも満たした。データディレクトリは元の状態に戻し、記録ファイルと一時ディレクトリは消した。
- 手順 6(Serena の編集の確認): ユーザーが対話セッション(`claude --plugin-dir <本プラグイン> --debug`、このリポジトリ)で行った。どちらの書き込みでも差し戻しが出た。確かめた事実は、`~/.claude/debug/<セッション ID>.txt` のログで裏付けた。
  - 1 回目の書き込みは、Serena の `create_text_file` ではなく Write で行われた。このリポジトリの Serena の構成では、`create_text_file` が無効になっている。
  - 2 回目は `mcp__serena__replace_content` で行われた。ログには `Hook PostToolUse:mcp__serena__replace_content` と、`check.mjs` が返した `{"decision":"block",…}` が残っている。差し戻し文のパスは、`relative_path` を `cwd` から解決した絶対パスになっていた。`tool_name` は `mcp__serena__<ツール>` の形で、matcher に当たることを実機で確かめた(設計書セクション 18 の【要確認】の 1 項目めを解消した)。

### A2 discipline.md の改稿の承認

- 2026-09-29 にユーザーが承認した。改稿は prompt-smith の規律で全文を評価してから書いた。
- B: 「## 適用範囲」の 3 項目めと 4 項目めの間に、設計書セクション 8 の 1 項目を加えた。
- D: 誤検知を除いた度数が 1 以上の避ける語は「まとめると」だけだった。「まとめ口調」の行でこの語を先頭に移し、表の下に書き換えの例を 2 つ添えた。翻訳調の表は、度数がすべて 0 なので並べ替えていない。型も足していない。
- D の手順 5: `〜にとって重要` の After を「この計画では、初期の合意が重要だ。」に、`〜に他ならない` の After を「これは時代の変化の表れだ。」に直した。
- prompt-smith の評価で範囲外の指摘が 2 件出た。ユーザーの判断で、どちらも今回あわせて直した。
  - 「重要な節は厚く書く」を「読み手の判断が分かれる節は厚く書く」にした。
  - 「Beforeの形」「Afterの形」を「Before の形」「After の形」にした。
- 改稿後の長さは約 4,150 文字である。

### T17 reminder.md に載せた規則と理由

- `reminder.md` は 173 文字で、prompt-smith の規律で評価して書いた。書き込み後の検査(バンドル後の `check.mjs`)に通すと、違反は 0 件だった。
- 載せた規則は、T13a の欄の、誤検知を除いた度数が 1 以上のものである。度数の多い順に並べた。度数が 0 の規則は載せていないので、5 行の上限まで使わず 3 行になった。

| 行 | 規則 | 度数 | 合わせた `discipline.md` の項目 |
| --- | --- | --- | --- |
| 2 | `rentai-kasanari` | 13 | 1 つの名詞に連体修飾を重ねず、文を割る |
| 3 | `bun-nagasa` | 1 | 一文に一つの内容、40〜60 字の目安、一文一義なら割らずに残す |
| 4 | `avoid:まとめると` | 1 | 避ける語の表の下の「まとめると」の書き換え |

- 1 行目の 1 文には、口調を変えないことと、直してから書くことの 2 つの指示が入っている。prompt-smith はこれを「1 文 1 指示」の指摘として挙げた。設計書セクション 9 が「1 文」と定めているので、1 文のまま残した。

### T19 注入の確認

- 実施日: 2026-09-29。リポジトリの外の一時ディレクトリで、`claude -p --plugin-dir <本プラグイン> --model haiku --setting-sources "" --strict-mcp-config --output-format stream-json --verbose --include-hook-events` を実行した。
- UserPromptSubmit: hook の `additionalContext` は、`reminder.md` の全文(173 文字)と一致した。モデルも、ファイルを読まずにこの本文を答えた。答えの中で「割る」を「割く」と 1 字写し間違えたが、hook の出力は正しい。
- SessionStart: hook の `additionalContext` は、`discipline.md` から目印の行と続く空行を除いた本文(4,123 文字)と一致した。`ignore-file` の文字列は含まれていない。前回の計画書の T7 と同じ問いで、モデルは「## 」見出しを 5 つとも順に答えた。
- 2 つの注入を、どちらも確かめた。

### A3 IPADIC の NOTICE の扱い

- 2026-09-29 にユーザーが「設計どおり」と判断した。辞書は再配布しない。README に IPADIC のライセンスの要点と、取得物と一緒に置かれる `NOTICE.txt` の場所(`${CLAUDE_PLUGIN_DATA}/morph/lindera-6.2.0/ipadic/NOTICE.txt`、4,092 バイト)を書く。`NOTICE.txt` の全文はプラグインに同梱しない。

### T21 ARCHITECTURE とメモリ

- `diff-architecture` の `findings` は 17 件で、どれも A1 の時点からある本件と無関係な乖離だった(技術スタックの語の誤検出、未記載のディレクトリ、死んだ glob)。本件で新しく生じた乖離は無い。
- ARCHITECTURE の散文を実装と突き合わせた。システム概要と技術スタックの追記と ADR-006 は、T7 で入れた記述が実装と合っていた。ディレクトリ構成とドメインマップは、native-japanese の新しいファイル(`src/lib/` `src/fixtures/` `src/testing/` `references/reminder.md` `scripts/*.mjs`)を既存の glob で覆っている。ARCHITECTURE は変えず、コミット 8a は作らない。
- `.serena/memories/` で native-japanese に触れているのは `agent_policy/core.md` の 1 か所で、「SessionStart と SubagentStart の注入が日本語の書き方を担う」と書いている。改修後もこの記述は正しいので、メモリは変えない。

### T22 突き合わせと測定 CLI の結果

**レビュー**: `a302ced8..HEAD` の native-japanese の差分の全体を、code-review の役割に読み取りだけで出した(Sonnet が無いため Opus で起動した)。critical と high の所見は無く、medium 2 件と low 4 件が出た。オーケストレーターは 6 件とも採り、コミット `18b1f708` で直した。

| # | 所見 | 対処 |
| --- | --- | --- |
| M1 | 形態素解析の層で例外が起きると、正規表現の層の違反まで失われる(設計書 7-4) | 形態素解析の層の呼び出しを try で包み、失敗したら形態素解析の違反を空にする |
| M2 | `cell_type` を省いた NotebookEdit(replace)が検査されない(設計書 4-3) | 書き込み後の `.ipynb` から `cell_id` のセルの `cell_type` を読む。読めなければ `code` とみなす |
| L1 | rename の後に失敗すると、`ready.json` の無い `lindera-6.2.0/` が残る(R5) | 失敗したら、`ready.json` の無い `lindera-6.2.0/` を消す。古いバージョンの削除の失敗は、取得の失敗にしない |
| L2 | R1 を自動で確かめるテストが無い | バンドル後の `check.mjs` と `measure.mjs` で、形態素解析の違反が出るテストを足した |
| L3 | 書き込み後の sha256 照合の失敗のテストが無い | テストを足した |
| L4 | `ready.json` の `files` が空でも照合を通る(設計書 5-1) | 11 ファイルがそろうことを照合の条件に足した |

**設計書セクション 13-2 の表とテストの対応**: レビューで項目ごとに対応を取った。L2 と L3 を足した後は、表のすべての項目に、確かめるテストがある。主な対応は次のとおり(テストのファイルは `plugins/native-japanese/src/` からの相対)。

| 対象 | テスト |
| --- | --- |
| `rules.ts` | `lib/__test__/rules.test.ts`(表の 9 行の分類、各語が当たる、「〜」を挟む語、複合語の一部) |
| `extract.ts` | `lib/__test__/extract.test.ts`(拡張子ごと、フェンスとインラインコード、ノートの code セル、段落、目印、HTML の 3 例)、`lib/__test__/morph.test.ts`(置き換え字が名詞になる) |
| `lint.ts` | `lib/__test__/lint.test.ts`(7 型の当たる例と当たらない例、`にほかならない`、解析器なし、`line` と `endLine`) |
| `morph.ts` | `lib/__test__/morph.test.ts`(付け替え、固定データの例文ごとの判定、閾値の前後、文末表現の切れ目、`は、`、`静かな部屋`、`事実` と `結果`、最も近い `は`) |
| `archive.ts` | `lib/__test__/archive.test.ts` |
| `morph-runtime.ts` | `__test__/morph-runtime.test.ts`(target、判定できない環境、`ready.json` の照合、壊れた `.node`、取得と展開、sha256 の不一致、ロック、同名のディレクトリ、書き込み後の照合の失敗、rename の後の失敗) |
| `check.ts` とバンドル後 | `__test__/check.test.ts`(各ツールの入力、何も出さない条件、1 セッション 1 回、データディレクトリ無し、編集範囲、`edits[]`、`MORPH=off`、バンドル後の `check.mjs` の正規表現の層と形態素解析の層) |
| `measure.ts` | `__test__/measure.test.ts`(書き手ごと、`morph` の出力、`--data-dir`、`--git` の数え方、バンドル後の `measure.mjs`) |
| `inject.ts` | `__test__/inject.test.ts`(UserPromptSubmit、目印の除去、300 文字以内、取得の起動と起動しない条件、起動の例外) |

**レビューの焦点 R1〜R6**:

- R1: `check.test.ts` と `measure.test.ts` のバンドル後のテスト、T14 の検証 3、T12 の検証 4、T15。
- R2: `inject.test.ts` の「取得を起動しても子プロセスを待たずに終わる」と T10。
- R3: `inject.test.ts` の目印のテスト、`measure.test.ts` の「--git で先頭に目印を持つファイルを数えない」、T6 の検証 4(コミット 1 の後に測り直し、`discipline.md` からの違反は 0 件だった)、T19。
- R4: `check.test.ts` の「Edit で既存の違反を差し戻さない」。
- R5: `morph-runtime.test.ts` の sha256 の不一致、HTTP のエラー、書き込み後の照合の失敗、rename の後の失敗。
- R6: `morph-runtime.test.ts` の「展開後の ipadic/NOTICE.txt がある」と T10。

**テスト**: 修正の後の `pnpm run test` は 2,894 件がパスし、5 件がスキップされた。`NATIVE_JAPANESE_MORPH_DIR=<データディレクトリ>` を設定すると、native-japanese の 294 件がすべてパスした(スキップ 0 件)。`pnpm run lint` と `pnpm run typecheck` も通った。

**設計書と本計画書の測定**: 2 ファイルだけの一時的な git リポジトリを作り、空のツリーからの差分として測った(形態素解析あり)。

- 1 回目: 1,081 行で、違反は `rentai-kasanari` の 4 件だった。設計書 638 行、設計書 671 行、本計画書 627 行の 3 件は違反と判定し、文を分けて直した。設計書の修正はコミット `0d232de8` に入れた。
- 2 回目: 1,083 行で、違反は 1 件だった。設計書 131 行の `計測に使った zip とリリースから取り直した zip で値が一致した。` である。2 つの `zip` をそれぞれ修飾した並列で、1 つの名詞に修飾を重ねていないので、誤検知と判定した(設計書セクション 16 の基準 2)。誤検知を除いた違反は 0 件で、合格の条件を満たした。

**バンドル**: build の後の `git status --short plugins/native-japanese/scripts` に、未コミットの差分は無い。

## 10. 設計書のセクション 18 の【要確認】の割り当て

| # | 設計書の【要確認】 | 確かめるタスク | 確かめ方 |
| --- | --- | --- | --- |
| 1 | MCP ツールの `tool_input` の形 | T15 の手順 6 | 対話セッションで Serena の `replace_content` を 1 回使い、`--debug` の出力で入力を記録する |
| 2 | サブエージェントの PostToolUse の `session_id` が親と同じか | T15 の手順 5 | 記録ファイルの数と名前で確かめる。違えば、同じ違反をサブエージェントでもう一度差し戻すことを記録する(設計書は許容している) |
| 3 | `CLAUDE_PLUGIN_DATA` の実際の値と、hook に渡ること | T10 の手順 2 | `~/.claude/plugins/data/` の下のディレクトリを記録する |
| 4 | SessionStart の hook の後も子プロセスが残るか | T10 の手順 3 | `claude` の終了後に `ready.json` ができるかで確かめる |
| 5 | IPADIC の NOTICE の扱い | 承認地点 A3(T20 の前) | ユーザーの判断を T20 の依頼文に書く |
| 6 | linux-x64 以外の 5 種の target と、node 22.0〜22.12 での読み込み | 本計画では確かめない | このマシンは linux-x64(WSL2)だけである。T20 で README に「未検証」と書く |
| 7 | 設計書のセクション 5-4 の閾値と `muse-shugo` の述語の一覧 | T13、T13a | 基準値の誤検知の割合で見直す |

設計書のセクション 18 の残りの 2 項目は、【要確認】ではない。ヘッドレス実行の注意は、セクション 1 の作業の規律に写した。GOTCHAS の記録は、セクション 7 の #4 のとおり解決済みである。
