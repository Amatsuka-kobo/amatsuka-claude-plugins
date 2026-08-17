# metatron CLI の使い方

```bash
node <metatron-plugin-root>/scripts/metatron.mjs <subcommand> [options]
```

CLI の絶対パスは `get config` の出力の `cli.path`、または deny hook の拒否メッセージから取る。インストール先を推測して組み立てない。

## サブコマンド

| サブコマンド | 種別 | 返すもの |
| --- | --- | --- |
| `get config` | 読 | `docRoot`・文書の絶対パス・既定値を適用した理由・CLI の絶対パス・入力書式 |
| `get architecture [--section <見出し>]` | 読 | 全文と見出し一覧、または指定セクションの本文 |
| `get domains` | 読 | `metatron:domains` を構造化したもの。読めないときは理由 |
| `get gotchas [--recent N \| --id <ID> \| --query <語>] [--exclude-tagged] [--promotion-candidates]` | 読 | GOTCHAS のエントリ配列・総数・昇格候補数 |
| `get adr [--id <ID> \| --status <状態>]` | 読 | ADR のエントリ配列と次の採番 |
| `scan` | 読 | コードベース解析の事実 |
| `diff-architecture` | 読 | `scan` と現行 ARCHITECTURE の乖離候補 |
| `stage-architecture --input <path>` | 段階 | diff と `stagingId`。書き込みはしない |
| `stage-adr --input <path>` | 段階 | diff と `stagingId`、追加時は `assignedId`。書き込みはしない |
| `commit-architecture --staging-id <id>` | 書 | `stagingId` を消費して ARCHITECTURE へ書き込む |
| `append-gotcha --input <path>` | 書 | 採番したエントリを `## 失敗パターン一覧` の直下へ挿入する |
| `tag-gotcha --id <ID> --tag <解決済み\|対象外> --reason <理由>` | 書 | 見出しへタグを挿入し、エントリ末尾へ理由行を追記する |

## 入出力の規約

- 出力は常に JSON を stdout へ返す。人間向けの補足と警告は stderr へ出る。判断は stdout の JSON だけで行う。
- 読み取り系は常に exit 0 で終わる。読めなかったことも `ok: false` と `error` を持つ JSON で返るため、exit code で読み取りの成否を判定しない。
- 読み取り系の `error: "not_created"` は「文書が未作成」という事実であって異常ではない。
- 書き込み系は成功で exit 0、拒否・失敗で非 0 で終わる。理由は JSON の `error` に入る。
- 非 0 は 1(内容の拒否)と 2(呼び出し方の誤り。サブコマンド不明・必須オプション欠落・入力を読めない)に分かれる。
- 書き込み系が非 0 で終わったとき、対象ファイルは 1 バイトも変わっていない。
- `lock_timeout` が返ったときは、同じ文書へ書く別プロセスの完了を待って再実行する。ロックファイルを手で消さない。

## 長い入力の渡し方

`--input <path>` を取るサブコマンドには、入力 JSON を一時ファイルへ書いてからそのパスを渡す。一時ファイルは Write ツールで作る。

- 引数へ本文を直接埋めない。引用符・バッククォート・`$`・改行がシェルで解釈されて壊れる。
- ヒアドキュメントで stdin へ流さない。終端トークンが本文に現れたときとインデントの扱いで壊れる。
- Write ツールで書けばファイルの書き込みがシェルを通らず、CLI に渡るのはパス 1 個だけになる。
- 置き場は OS の一時ディレクトリとする。CLI は読み取り後に削除しない。

## 書き込み系の入力 JSON

### stage-architecture

```json
{ "sections": [{ "heading": "レイヤー構造", "body": "..." }], "reason": "更新の理由" }
```

- `heading` は ARCHITECTURE の見出しキーのいずれか。一覧は `get config` の `inputSchemas["stage-architecture"].headings` から取る。未知の見出しは拒否される。
- `heading` に `ADR 一覧` を指定すると拒否される。ADR の追加と状態変更は `stage-adr` を使う。
- `body` は見出し行を含まない本文。同じ `heading` を 2 回書くと拒否される。
- `reason` は任意。

### stage-adr(追加)

```json
{ "mode": "add", "title": "...", "status": "採用", "decidedOn": "2026-08-16", "decidedBy": "...", "background": "...", "options": ["選択肢A: ..."], "conclusion": "...", "rationale": "...", "impact": "..." }
```

- 必須は `mode` / `title` / `decidedBy` / `background` / `options`(1 要素以上) / `conclusion` / `rationale` / `impact`。
- `status` は省略時 `採用`。値域は `採用` / `提案` / `廃止`。
- `decidedOn` は省略時に当日日付。
- `options` が 1 件だけのときは警告が返る。拒否はされない。
- 採番は CLI が行う。`ADR-NNN` を入力に書かない。

### stage-adr(状態変更)

```json
{ "mode": "status", "id": "ADR-003", "status": "廃止", "reason": "...", "changedOn": "2026-08-16" }
```

- `reason` は必須。省略した状態変更は拒否される。
- `changedOn` は省略時に当日日付。

### append-gotcha

```json
{ "title": "...", "date": "2026-08-16", "task": "...", "mistake": "...", "cause": "...", "countermeasure": "...", "promotionCandidate": "No" }
```

- `date` は省略時に当日日付。
- `promotionCandidate` は `Yes` / `No` のみを受け付ける。他の値は拒否される。
- `countermeasure` が「気をつける」などの定型句だけのときは警告が返る。拒否はされない。

### tag-gotcha

入力 JSON を持たない。`--id` / `--tag` / `--reason` が必須で、`--date` は任意(省略時は当日日付)。

## stage から commit の 2 段階

ARCHITECTURE と ADR の書き込みは 2 段階で行う。

1. `stage-architecture` または `stage-adr` を実行し、`stagingId` と diff を得る。
2. diff を全文提示してユーザーの承認を得る。
3. `commit-architecture --staging-id <id>` を実行して書き込む。

### stage が返す diff

| フィールド | 内容 |
| --- | --- |
| `diff.unified` | unified 形式の差分。差分が無いときは空文字列。省略されたときは案内文だけが入る |
| `diff.truncated` | 行数が上限を超えて `diff.unified` を省略したかどうか |
| `diff.truncatedReason` | 省略の理由。省略していなければ `null` |
| `diff.beforeLines` / `diff.afterLines` | 変更前・変更後の行数 |
| `diff.maxLines` | 省略の判定に使った上限行数 |
| `diff.sections` | 変更対象セクションごとの `heading` / `mode` / `before` / `after`。`before` / `after` は省略が起きたときも完全な本文が入る |

- 省略の有無は `diff.truncated` で判定する。`diff.unified` の文面から判定しない。
- `diff.truncated` が `false` のときは `diff.unified` を全文提示する。
- `diff.truncated` が `true` のときは `diff.unified` を提示に使わない。`diff.sections` の `before` / `after` をセクション単位で全文提示する。
- セクション単位でも一度に提示しきれないときは、`diff.sections` の `heading` を一覧で示し、どのセクションから見るかをユーザーに尋ねる。
- 省略されたまま承認を求めない。

### 保証されるもの

機械的に保証されるのは次の 5 点だけである。

1. diff を計算せずに書き込むことはできない。`commit-architecture` は `stagingId` 無しでは失敗する。
2. staging は単回使用かつ有効期限つき(既定 30 分)である。使い回しと古い案の遅延適用ができない。
3. stage 後に対象ファイルが変化していたら、commit は `file_changed` で失敗する。
4. staging レコードを書き換えて commit すると `tampered` で失敗する。レコードは自身の内容ハッシュ(`recordHash`)を持ち、commit の前に再計算して照合する。`nextContent` だけ・`targetPath` だけ・`expiresAt` だけの差し替えは、いずれも書き込みに至らない。
5. 消費の印は書き込みの**前**に付く。印を保存できなかった commit は `staging_unavailable` で失敗し、対象ファイルは 1 バイトも変わらない。変更前後が同一の stage(no-op)でも、同じ `stagingId` が 2 度書き込みに至ることはない。

### 保証されないもの

保証されないのは次の 3 点である。

1. **人間が実際に diff を見て承認したか。** CLI は承認の有無を判定できない。`stage-*` が exit 0 で返ったことを承認と読み替えない。ユーザーの承認を得るまで `commit-architecture` を実行しない。
2. **`recordHash` まで整合的に打ち直した改変。** 同じユーザー権限で動くプロセスは正しい `recordHash` を計算できるため、検知できない。`recordHash` の照合が捕まえるのは、偶発的な破損と CLI を経由しない書き換えまでである。staging の内容を変えるときは、保存されたレコードを直接編集せず `stage-*` からやり直す。
3. **commit が失敗した staging を再実行できること。** 消費の印を付けた後に書き込みが失敗すると、その staging は消費済みのまま残る。`write_failed` で失敗した `stagingId` を再実行しない。`stage-*` からやり直す。

staging の保存先は `<tmpdir>/metatron-staging/<プロジェクトパスのハッシュ>/<id>.json` であり、プロジェクト内には置かれない。
