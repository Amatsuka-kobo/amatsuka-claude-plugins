---
name: filing-followup-issues
description: Codiel の triage フェーズで、オーケストレーター本体が review-<m>.md の medium・low 所見をユーザーの指示のもと Issue または intent 草案として起票するときに使う。orchestrating-runs が名指しで起動する。
---

# triage フェーズ運転規約

## 概要

`orchestrating-runs` の [9] triage フェーズで**オーケストレーター自身**が使うスキルである。
`fixing-review-findings` と同様にオーケストレーターの進行規約であり、サブエージェントへの
ディスパッチは発生しない(起票作業そのものをオーケストレーターが行う)。

triage は非 GATED フェーズであり、Raguel の `evaluate_*` は経ない。`complete-phase triage` の
前提として人間の明示的な指示を必須とする。

入力は `reports/review-<m>.md` の所見のうち **medium / low のみ**。

連携モードで手順が分かれる。github モードは Issue として起票し、local モードは
`status: proposed` の intent 草案として `docs/intents/` に書く。

github モードで投稿する本文の文の組み立てと画像の載せ方は `../../references/github-writing.md` に、
local モードで書く intent 草案の文の組み立ては `../../references/intent-writing.md` に従う。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/filing-followup-issues` である。**`<plugin-root>` はそのベースディレクトリの
2 階層上**。`codiel-state` は対象プロジェクトのルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## github モードのチェックリスト

1. 最新の `reports/review-<m>.md` を読み、medium/low の所見だけを抽出する(critical/high は
   すでに fix-loop で処理済みのはずであり、対象に含めない)。**既に「フォローアップ: #N」の
   注記が付いている所見は起票済みなので除外する**(triage 途中でセッションが切れて再開した場合の
   二重提示・二重起票の防止。`gh issue list --search` の重複確認はキーワード一致頼みで
   フェイルセーフにならないため、この除外が一次防壁)。
2. 抽出した所見を**番号付き一覧**(番号・severity・要約・対象 `src/...:42`)にしてユーザーに提示する。
3. **起票対象の選択・複数所見のまとめ方・見送りをユーザーに確認する**(AskUserQuestion か平文で
   問いかける)。まとめる/見送るの裁量はユーザーにあり、オーケストレーターが勝手に判断しない。
   問いかける前に
   `node <plugin-root>/scripts/codiel-state.mjs mark-ask triage --slug <slug> --kind confirm`
   で `awaiting_human` にしてから待ち、回答を得たら
   `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で戻る。**回答が来るまで
   次の手順に進まない**(「ユーザーの回答を待つ」という運転自体がこのフェーズの唯一のゲートである)。
4. ユーザーが起票対象を指示したら、対象ごとに以下を行う。
   `gh` が使えないときは起票せず、所見一覧をユーザーへ提示して triage を保留する。
5. **ISSUE_TEMPLATE の探索**: Glob で次を探す。`config.yml`(テンプレート選択画面の設定ファイルで
   あり、テンプレートではない)は探索から除く。
   - `.github/ISSUE_TEMPLATE/*.yml` と `*.yaml`(`config.yml` を除く。GitHub フォーム形式)
   - `.github/ISSUE_TEMPLATE/*.md`(Markdown 形式、frontmatter 付き)
   - `.github/ISSUE_TEMPLATE.md`(レガシー単一テンプレート)
   複数ヒットする場合、指摘の種類(バグ/改善/タスク)に最も合うものを選ぶ(詳細は次節)。
   どれもヒットしなければ既定書式(下記)を使う。
6. **重複確認**: 起票前に `gh issue list --search "<要約のキーワード>"` で既存 Issue との重複を
   確認する。ヒットがあれば起票を保留し、該当 Issue へのリンクをユーザーに提示して
   「新規起票する/既存 Issue に集約する/見送る」の判断を仰ぐ(ここも自己判断しない)。問いかける前に
   `node <plugin-root>/scripts/codiel-state.mjs mark-ask triage --slug <slug> --kind confirm`
   で `awaiting_human` にしてから待ち、回答を得たら
   `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で戻る。
7. 選んだテンプレート(または既定書式)を最大限埋めた本文を、`github-writing.md` の執筆規則に
   従って組み立てる。本文には `<!-- codiel:generated -->` を含める。組み立てた本文を Write ツールで
   `.codiel/runs/<slug>/try-<n>/reports/issue-<連番>.md` に書く(投稿ごとに別名にする)。書いたら
   `review-<m>.md` と同じ書き方で run ブランチへコミットする(`git add <パス>` の後
   `git commit -m "codiel(triage): <要約> (<slug> try-<n>)"`)。コミット後、別の Bash 呼び出しで
   `gh issue create --title "<タイトル>" --body-file .codiel/runs/<slug>/try-<n>/reports/issue-<連番>.md --label "<ラベル>"`
   を実行する(テンプレートの labels が複数ある場合は `--label` を複数回指定する)。
8. 起票後、Issue 番号を `reports/review-<m>.md` の該当所見の行に追記する。`<!-- codiel:generated -->`
   を含むフォローアップの本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/followup-<連番>.md`
   に書き、同じく `review-<m>.md` と同じ書き方で run ブランチへコミットしてから、別の Bash 呼び出しで
   `gh pr comment <PR番号> --body-file .codiel/runs/<slug>/try-<n>/reports/followup-<連番>.md`
   を実行する。
9. 全対象(見送られたものを除く)の処理が終わったら
   `node <plugin-root>/scripts/codiel-state.mjs complete-phase triage --slug <slug>` を呼び
   フェーズを完了させる。

## local モードのチェックリスト

1. 最新の `reports/review-<m>.md` を読み、medium/low の所見だけを抽出する(critical/high は
   すでに fix-loop で処理済みのはずであり、対象に含めない)。既に intent 草案のパスが付記
   されている所見は処理済みなので除外する。
2. 抽出した所見を**番号付き一覧**(番号・severity・要約・対象 `src/...:42`)にしてユーザーに提示する。
3. **起票対象の選択・複数所見のまとめ方・見送りをユーザーに確認する**(github モードの手順 3 と
   同じ唯一のゲート)。問いかける前に
   `node <plugin-root>/scripts/codiel-state.mjs mark-ask triage --slug <slug> --kind confirm`
   で `awaiting_human` にしてから待ち、回答を得たら
   `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で戻る。**回答が来るまで
   次の手順に進まない**。
4. ユーザーが対象を指示したら、対象ごとに `intent-writing.md` の規則に従い、`status: proposed` の
   intent 草案を `docs/intents/YYYY-MM-DD-<slug>.md` に書く。frontmatter の `run` は空にする。
   `## 現状調査` に、所見の出所(`review-<m>.md` の該当行)を書く。レビュー所見は AI が生成した文
   なので、原文にしない。原文のセクション(`## ASIS` / `## TOBE`)には本文を置かず、見出しの下に
   `<!-- codiel:unrecorded -->` だけを置く。この草案を入力に run を始めたときは、このセクションを
   不足セクションとして聞き取りで埋める。
5. 書いた intent 草案をコミットする。
6. `reports/review-<m>.md` の該当所見の行に、書いた intent 草案のパスを追記する。
7. 全対象(見送られたものを除く)の処理が終わったら
   `node <plugin-root>/scripts/codiel-state.mjs complete-phase triage --slug <slug>` を呼び
   フェーズを完了させる。

## ISSUE_TEMPLATE の読み方とテンプレート選択

### フォーム形式(`.github/ISSUE_TEMPLATE/*.yml`)

`name`(選択メニュー表示名)・`description`(用途説明)・`labels`(既定ラベル)・`title`(タイトル
接頭辞)を読み、`body` 配列の各フィールド(`input` / `textarea` / `dropdown` / `checkboxes` 等)の
`label`(見出し文)・`description`(補足)・`required` を確認する。`description`/`name` に
「bug」「feature」「improvement」等の語があれば所見の種類と突き合わせる。

本文組み立て時、**各フィールドを `### <label>` の見出し + 回答の markdown に展開**する。例えば
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
<review-<m>.md に記録された根拠(design.md/spec.md との不整合、または起こりうる障害)>

## 対象ファイル
`src/...:42`

## 元 PR
#<PR番号>(フォローアップ)

## severity
medium|low
```

## 起票済み Issue の記録書式(`reports/review-<m>.md` への追記)

該当所見ブロック(`### [severity] <要約>` から始まる一連の箇条書き)の末尾に次の形式で追記する。

```markdown
→ フォローアップ: #<Issue番号>
```

<HARD-GATE>
- **ユーザーの指示なしに起票・記録しない**。手順 2〜3 の提示と確認を経ず、あるいはユーザーの回答を
  待たずに `gh issue create` や intent 草案の作成を実行することは禁止。起票対象・まとめ方・見送りは
  常にユーザーが決める。
- **critical/high をこのフェーズに持ち込まない**。critical/high は `fixing-review-findings` の
  fix-loop で必ず修正対象になっており、triage で「起票して終わり」にすることは fix-loop の職掌
  への越境であり行わない。
- **`gh issue create` の実行はこのフェーズでのみ許される**(github モードだけに当たる)。
  `guard-bash`(hooks)はアクティブ run の現在フェーズが triage でなければ `gh issue create` を
  機械的に deny する(`docs/DESIGN.md` §8 / §2 [9])。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「テンプレートを読むのが面倒なので自由書式で起票する」 | ISSUE_TEMPLATE はリポジトリのラベル運用・Definition of Done と紐づく。自由書式は起票後にラベル漏れ・トリアージ漏れを招く。手順 5 のとおり探索・選択を必ず行う。 |
| 「重複確認は面倒だから省略して起票する」 | 重複起票は Issue トラッカーを汚し、後続の対応を分散させる。`gh issue list --search` での確認を省略しない。 |
| 「ユーザーの返信を待たずに一部だけ先に起票しておこう」 | 「回答が来るまで起票しない」がこのフェーズ唯一のゲート。一部でも先行起票すれば、ユーザーが後から「その所見は見送りたかった」と言っても取り消せない。 |
| 「起票さえすれば review-<m>.md への追記や PR コメントは後回しでいい」 | 追記・コメントを怠ると Issue 番号と所見の対応が追跡不能になり、triage が行われたこと自体が記録に残らない。起票の都度、手順 8 を即時に行う。 |
