---
description: Raphael 抗体を一覧・レビューし、承認、却下、安全な編集を対話的に行う
---

Raphael の抗体を対話的にレビューしてください。抗体ファイルを直接変更してはいけません。読み取りには `list-antibodies.mjs`、更新には `update-antibody.mjs` だけを使用します。Bash で実行してよいのは、この2つの script の呼び出しだけです。更新結果が失敗したときも、ファイルを直接直さないでください。

すべての CLI request body は stdin の JSON、result/error は stdout の JSON です。`ok: true` を成功として扱い、非ゼロ終了または `ok: false` では表示された error を示します。推測で更新を再試行しません。

## 1. 一覧取得

最初に、本文を含む全抗体を取得します。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-antibodies.mjs" --json --include-body
```

取得結果を、次の group と sort で表示します。

1. group は `active` → `confirmed` → `expired`
2. 各 group 内は `stats.last_fired` の降順（`null` は末尾）
3. 次に `created` の降順
4. 最後に `id` の昇順

一覧には、件数、ID、status、tool、pattern、scope、fired、last_fired、expires、本文先頭80文字を Markdown table で表示します。`scope` がない場合は `-` と表示します。本文の表内改行は空白にし、Markdown table を壊さないよう `|` はエスケープします。CLI が返した `errors` もあれば、対象外になったファイルとエラーを明示します。

全 group 合計が 0 件なら「レビュー対象なし」と報告して終了します。

## 2. 対象選択

抗体が1件以上あるとき、AskUserQuestion を1回使い、次の選択肢を提示します。

- `active を順番にレビュー(推奨)`
- `IDを指定してレビュー`（Other で ID を入力）
- `confirmed / expired も含めて選ぶ`（Other で ID を入力）
- `終了`

ID の入力が空、または一覧に存在しない場合は、更新せず理由を表示して同じ質問を再提示します。`終了` なら更新せず終了します。

`active を順番にレビュー(推奨)` を選んだ場合は queue mode です。**この開始時点で取得した active 抗体だけ**を snapshot として固定し、上記の `last_fired` 降順（null末尾）→ `created` 降順 → `id` 昇順で最後まで処理します。各操作後に一覧を再取得しても、queue の順序・対象・cursor は変更しません。レビュー中に新規作成または更新された別の抗体は、この queue に加えず次回の `/raphael:review` で扱います。

queue snapshot に active 抗体がない場合は、その旨を表示し、対象選択に戻ります。queue mode の開始時に counters `confirmed`、`expired`、`edited`、`skipped` をすべて0に初期化します。

ID を指定する2つの mode は ID mode とします。指定 ID を表示するため、次を実行します。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-antibodies.mjs" --json --include-body --id "<id>"
```

ID mode では、表示上の一覧・要約に使用する順序は全体一覧と同じ group sort（active → confirmed → expired、各 group は `last_fired` → `created` → `id`）です。1件の操作が終わったら終了します。

## 3. 1件の詳細表示

選んだ抗体ごとに、frontmatter の全項目（`id`、`created`、`source`、`trigger.tool`、`trigger.pattern`、任意の `trigger.scope`、`status`、`stats.fired`、`stats.last_fired`、`expires`）、本文、source、発火統計、期限状態を表示します。

期限状態は status と `expires` の日付を明示して表示します。ただし `confirmed` は **期限評価を行わない唯一の status** です。承認しても `expires` field/value は保持されますが、confirmed の間はその値を無視します。

## 4. 1件の操作

各抗体について AskUserQuestion を使い、次の選択肢を提示します。

- `承認`
- `却下`
- `編集`
- `スキップ/終了`

### 承認

承認は `status` を `confirmed` にします。stdin に空 object を渡して実行します。

```bash
printf '{}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/update-antibody.mjs" set-status "<id>" confirmed
```

成功後、次を実行して更新済みの要約を再取得・表示します。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-antibodies.mjs" --json --include-body --id "<id>"
```

queue mode では `confirmed` を1増やして、固定 snapshot の未処理の次 item に進みます。ID mode では終了します。

### 却下

却下は削除ではありません。監査可能なまま `status` を `expired` にします。抗体ファイルを削除する操作は提供しません。

```bash
printf '{}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/update-antibody.mjs" set-status "<id>" expired
```

成功後は、承認と同様に ID 指定の list CLI で再取得した要約を表示します。queue mode では `expired` を1増やして次 item に進み、ID mode では終了します。

### スキップ/終了

この選択は一切更新しません。queue mode では `skipped` を1増やして固定 snapshot の次 item に進みます。ID mode では終了します。

### 更新失敗

承認・却下・編集のいずれでも CLI が `ok: false` または非ゼロ終了なら、返された validation/runtime/I/O error を表示します。ファイルを直接編集せず、同じ item の操作選択に戻ります。queue の cursor や counters は更新成功時以外に進めません。

## 5. 編集 flow

`編集` を選んだら AskUserQuestion を使い、次の選択肢を提示します。

- `trigger`
- `本文`
- `両方`
- `キャンセル`

`キャンセル` は dry-run を含めて書き込みを行わず、同じ item の操作選択に戻ります。

### trigger 入力

`trigger` または `両方` の場合、対話で `tool`、`pattern`、任意 `scope` を受け取ります。

- `tool` と `pattern` の空入力は現値を維持します。
- `scope` の空入力は現値を維持します。
- `scope` に `-` を明示した場合だけ scope を削除します。
- 空入力を空文字への更新として扱わず、tool/pattern を空にする更新は行いません。
- 不正な値または不明瞭な入力は推測せず、再入力を求めます。

### 本文入力

`本文` または `両方` の場合、本文を自由入力で受け取ります。空入力は現値を維持します。空本文に更新することは禁止です。不正または空本文への更新になった入力は、再入力を求めます。

### dry-run と確認

入力から、変更する field だけを含む JSON patch を作ります。例えば trigger と本文を変更する場合、stdin JSON は次の形式です。

```json
{
  "trigger": {
    "tool": "<tool>",
    "pattern": "<pattern>",
    "scope": "<scope>"
  },
  "body": "<body>"
}
```

scope を削除する場合は、`trigger` object から `scope` key を省きます。本文中の改行、引用符、バックスラッシュを正しい JSON としてエンコードし、shell 文字列の連結や手作業のエスケープによって値を変えません。

同じ JSON patch を stdin で渡し、最初に必ず dry-run を実行します。

```bash
printf '%s' '<JSON patch>' | node "${CLAUDE_PLUGIN_ROOT}/scripts/update-antibody.mjs" patch --dry-run "<id>"
```

`ok: true` かつ `dry_run: true` の場合だけ、返された normalized antibody と `diff` を使い、変更前/変更後（trigger、本文を含む）を表示します。変更 field がない場合は更新不要と表示し、書き込まず同じ item の操作選択に戻ります。

続けて AskUserQuestion を使い、次の選択肢を提示します。

- `この変更を適用`
- `修正して再入力`
- `キャンセル`

- `修正して再入力` は編集対象の選択からやり直します。書き込みは行いません。
- `キャンセル` は書き込みを行わず、同じ item の操作選択に戻ります。
- dry-run が失敗した場合は error を表示し、書き込みを行わず、編集対象の選択から再入力します。

`この変更を適用` を選んだ場合だけ、dry-run と**同一の JSON patch**を stdin で渡して実行します。

```bash
printf '%s' '<JSON patch>' | node "${CLAUDE_PLUGIN_ROOT}/scripts/update-antibody.mjs" patch "<id>"
```

成功後、次を実行して更新済みの要約を再取得・表示します。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-antibodies.mjs" --json --include-body --id "<id>"
```

queue mode では `edited` を1増やして固定 snapshot の次 item に進み、ID mode では終了します。適用失敗時は「更新失敗」の手順に従い、同じ item の操作選択へ戻ります。

## 6. queue 完了報告

固定 snapshot の全 item を処理したら、queue mode の最終 summary を表示して終了します。summary には、開始時 snapshot 件数と `confirmed`、`expired`、`edited`、`skipped` の各件数を Markdown table で含めます。counter の合計が snapshot 件数と一致することを確認し、不一致なら操作結果を再確認してから報告します。
