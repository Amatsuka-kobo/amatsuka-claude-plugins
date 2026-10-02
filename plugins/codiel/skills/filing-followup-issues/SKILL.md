---
name: filing-followup-issues
description: Codiel の triage フェーズで、オーケストレーター本体が review-<m>.md の medium・low 所見をユーザーの指示のもと Issue または intent 草案として起票するときに使う。orchestrating-runs が名指しで起動する。
---

# triage フェーズ運転規約

## 概要

`orchestrating-runs` の [12] triage フェーズでオーケストレーター自身が使うスキルである。
`fixing-review-findings` と同様にオーケストレーターの進行規約であり、サブエージェントへの
ディスパッチは発生しない(起票作業そのものをオーケストレーターが行う)。

triage は非 GATED フェーズであり、Raguel の `evaluate_*` は経ない。`complete-phase triage` の
前提として人間の明示的な指示を必須とする。起票対象・まとめ方・見送りは常にユーザーが決める。

入力は `reports/review-<m>.md` の所見のうち medium / low だけである。

連携モードで手順が分かれる。github モードは Issue として起票し、手順は本文の「github モードのチェックリスト」に従う。
local モードは `status: proposed` の intent 草案を `docs/intents/` に書き、`references/local-mode.md` を Read して従う。

github モードで投稿する本文の文の組み立ては `../../references/github-writing.md` に、画像の載せ方は `../../references/github-writing-images.md` に従う。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/filing-followup-issues` である。`<plugin-root>` はそのベースディレクトリの
2 階層上である。`codiel-state` は対象プロジェクトのルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## ユーザーへの確認の待ち方

ユーザーに問いかける前に、`node <plugin-root>/scripts/codiel-state.mjs mark-ask triage --slug <slug> --kind confirm`
で run を `awaiting_human` にしてから待つ。回答を得たら `node <plugin-root>/scripts/codiel-state.mjs resume --slug <slug>` で戻る。

## github モードのチェックリスト

1. 最新の `reports/review-<m>.md` を読み、medium/low の所見だけを抽出する(critical/high は
   すでに fix-loop で処理済みのはずであり、対象に含めない)。既に「フォローアップ: #N」の
   注記が付いている所見は起票済みなので除外する(triage 途中でセッションが切れて再開した場合の
   二重提示・二重起票の防止。`gh issue list --search` の重複確認はキーワード一致頼みで
   フェイルセーフにならないため、この除外が一次防壁)。
2. 抽出した所見を番号付き一覧(番号・severity・要約・対象 `src/...:42`)にしてユーザーに提示する。
3. 起票対象の選択・複数所見のまとめ方・見送りをユーザーに確認する(AskUserQuestion か平文で
   問いかける)。まとめる/見送るの裁量はユーザーにあり、オーケストレーターが勝手に判断しない。
   待ち方は「ユーザーへの確認の待ち方」に従う。回答が来るまで次の手順に進まない(「ユーザーの回答を待つ」
   という運転自体がこのフェーズの唯一のゲートであり、一部だけの先行起票もしない)。
4. ユーザーが起票対象を指示したら、対象ごとに以下を行う。
   `gh` が使えないときは起票せず、所見一覧をユーザーへ提示して triage を保留する。
5. ISSUE_TEMPLATE を探してテンプレートを選ぶ。`references/issue-template.md` を Read して従う
   (テンプレートが無ければ同ファイルの既定書式を使う)。
6. 重複確認: 起票前に `gh issue list --search "<要約のキーワード>"` で既存 Issue との重複を
   確認する。ヒットがあれば起票を保留し、該当 Issue へのリンクをユーザーに提示して
   「新規起票する/既存 Issue に集約する/見送る」の判断を仰ぐ(ここも自己判断しない)。
   待ち方は「ユーザーへの確認の待ち方」に従う。
7. 選んだテンプレート(または既定書式)を最大限埋めた本文を、`github-writing.md` の執筆規則に
   従って組み立てる。本文には `<!-- codiel:generated -->` を含める。組み立てた本文を Write ツールで
   `.codiel/runs/<slug>/try-<n>/reports/issue-<連番>.md` に書く(投稿ごとに別名にする)。
   このファイルはコミットしない。`review-<m>.md` は git に載らないので、本文には
   `review-<m>.md` の行を指すだけにせず、所見の内容(severity・対象・内容)を書く。書いたら、別の Bash 呼び出しで
   `gh issue create --title "<タイトル>" --body-file .codiel/runs/<slug>/try-<n>/reports/issue-<連番>.md --label "<ラベル>"`
   を実行する(テンプレートの labels が複数ある場合は `--label` を複数回指定する)。
   `gh issue create` を実行できるのは triage フェーズだけである(アクティブ run の現在フェーズが triage でなければ、
   `guard-bash` が機械的に deny する)。
8. 起票の都度、直ちに Issue 番号を `reports/review-<m>.md` の該当所見の行に追記する。`<!-- codiel:generated -->`
   を含むフォローアップの本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/followup-<連番>.md`
   に書く。このファイルもコミットしない。書いたら、別の Bash 呼び出しで
   `gh pr comment <PR番号> --body-file .codiel/runs/<slug>/try-<n>/reports/followup-<連番>.md`
   を実行する。
9. 全対象(見送られたものを除く)の処理が終わったら
   `node <plugin-root>/scripts/codiel-state.mjs complete-phase triage --slug <slug>` を呼び
   フェーズを完了させる。

## 起票済み Issue の記録書式(`reports/review-<m>.md` への追記)

該当所見ブロック(`### [severity] <要約>` から始まる一連の箇条書き)の末尾に次の形式で追記する。

```markdown
→ フォローアップ: #<Issue番号>
```
