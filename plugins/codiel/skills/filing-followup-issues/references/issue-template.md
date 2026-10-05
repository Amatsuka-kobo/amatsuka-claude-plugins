# ISSUE_TEMPLATE の探索と読み方

## 探索

Glob で次を探す。`config.yml`(テンプレート選択画面の設定ファイルであり、テンプレートではない)は探索から除く。

- `.github/ISSUE_TEMPLATE/*.yml` と `*.yaml`(`config.yml` を除く。GitHub フォーム形式)
- `.github/ISSUE_TEMPLATE/*.md`(Markdown 形式、frontmatter 付き)
- `.github/ISSUE_TEMPLATE.md`(レガシー単一テンプレート)

複数ヒットする場合、指摘の種類(バグ/改善/タスク)に最も合うものを選ぶ(詳細は次のセクション)。
どれもヒットしなければ、後述の既定書式を使う。

## ISSUE_TEMPLATE の読み方とテンプレート選択

### フォーム形式(`.github/ISSUE_TEMPLATE/*.yml`)

`name`(選択メニュー表示名)・`description`(用途説明)・`labels`(既定ラベル)・`title`(タイトル
接頭辞)を読み、`body` 配列の各フィールド(`input` / `textarea` / `dropdown` / `checkboxes` 等)の
`label`(見出し文)・`description`(補足)・`required` を確認する。`description`/`name` に
「bug」「feature」「improvement」等の語があれば所見の種類と突き合わせる。

本文組み立て時、各フィールドを `### <label>` の見出し + 回答の markdown に展開する。例えば
フィールドが `label: "現象"` なら本文に `### 現象\n<所見の内容>` を差し込む。`required: true` の
フィールドには、症状・根拠・対象ファイル・severity・元 PR リンクを割り当てる。
埋められない項目があれば「(triage 起票のため情報なし)」等と明記し、
無言で空欄にしない。`checkboxes` フィールドのうち、行動規範への同意・CLA の署名・「テストした」
など同意・署名・人の確認を表す項目にはチェックを付けずに残し、人が確かめる項目であることを本文に
書く。

### Markdown 形式(`.github/ISSUE_TEMPLATE/*.md` / `.github/ISSUE_TEMPLATE.md`)

先頭の frontmatter(`name` / `about` / `title` / `labels`)を読み、本文のセクション構造
(`## 見出し`等)をそのまま維持して各セクションに所見の情報を埋める。

### テンプレートがない場合の既定書式

```markdown
## 症状
<所見の要約>

## 根拠
<review-<m>.md に記録された根拠の内容(design.md/spec.md との不整合、または起こりうる障害)を本文に書く>

## 対象ファイル
`src/...:42`

## 元 PR
#<PR番号>(フォローアップ)

## severity
medium|low
```
