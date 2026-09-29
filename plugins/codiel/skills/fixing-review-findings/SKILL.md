---
name: fixing-review-findings
description: Codiel の fix-loop フェーズで、オーケストレーター本体が review-<m>.md の critical・high 所見を検証し、実装への修正委譲と反論の記録までを運転するときに使う。orchestrating-runs が名指しで起動する。
---

# fix-loop 運転規約

## 概要

`orchestrating-runs` の [8] fix-loop フェーズで**オーケストレーター自身**が使うスキルである。
オーケストレーターが自分でコードを直すことは許されない。

入力は `reports/review-<m>.md` の所見のうち **critical / high のみ**。medium/low は本スキルの
対象外であり、修正せず `triage` フェーズ(`filing-followup-issues`)へそのまま持ち越す
(`reviewing-diffs` の severity 定義表のとおり下流の扱いが分かれる)。

review で critical/high が **一件もなかった場合、本スキルは発動しない**。その場合
`orchestrating-runs` §5「fix-loop のスキップ経路」に従い `codiel-state skip-phase fix-loop`
で明示的にスキップする(本スキルを空振りで起動しない)。

GitHub へ投稿する本文の文の組み立ては `../../references/github-writing.md` に従う。

`rebuttal-<連番>.md`・`resolution-<連番>.md`・`restatement-<連番>.md` の連番は、同じ try の中で
通し番号とする。レビューの回をまたいでも振り直さず、前の回で書いたファイルを上書きしない。
これらのファイルはコミットしない。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/fixing-review-findings` である。**`<plugin-root>` はそのベースディレクトリの
2 階層上**。`codiel-state` は対象プロジェクトのルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## チェックリスト

1. 最新の `reports/review-<m>.md` を読み、critical/high の所見を一覧化する(medium/low は対象外
   として除外する。除外した件数も後で triage へ引き継ぐため覚えておく)。
2. 所見ごとに、対象ファイル・行・intent(`docs/intents/**`)/design.md/spec.md の根拠を突き合わせて
   技術的に検証する。必要なら読み取り専用サブエージェントへ調査を委譲するが、妥当性の最終判断は
   自分で行う。
3. 所見がテスト・`spec.md`・`cases.md` の誤りや不足に向くときは、
   `node <plugin-root>/scripts/codiel-state.mjs set-test-edit --slug <slug>` を実行してから、
   `writing-test-specs`(`spec.md`・`cases.md` の直し)と `scripting-tests`(テストコードの直し)に
   従う委譲でテスト側を先に直させる。振る舞いを変える修正なら、コードの修正の前に Red を確かめさせる。
   報告を受けた直後に `node <plugin-root>/scripts/codiel-state.mjs clear-test-edit --slug <slug>` を
   実行する。妥当と判断したそれ以外の所見(テスト側の修正の後にコードの修正が要る所見を含む)は、
   該当ドメインの implementer へ `implementing` の契約 (b) レビュー所見由来
   の形式(所見: severity・対象・内容・根拠・提案 + 対象ファイル)でディスパッチする(1 所見ずつ
   でも複数所見まとめてでもよいが、ドメインが混在する場合はドメインごとに分けてディスパッチする)。
4. 不当と判断した所見は、`github-writing.md` の執筆規則に従い、下記「PR 反論記録書式」の内容と
   `<!-- codiel:generated -->` を本文に含めて組み立てる。組み立てた本文を Write ツールで所見ごとに
   別名の `.codiel/runs/<slug>/try-<n>/reports/rebuttal-<連番>.md` に書く。このファイルはコミットしない。
   github モードでは、書いた後、`reports/review-<m>.md` に記録された PR コメント URL への返信として
   (URL が未記録なら新規コメントでよい)、別の Bash 呼び出しで `gh api` を
   `-F body=@.codiel/runs/<slug>/try-<n>/reports/rebuttal-<連番>.md` のように `-F body=@<パス>` で
   本文を渡して呼び、反論を投稿する。local モードでは投稿せず、`rebuttal-<連番>.md` を手元に残して
   記録を終える。修正はしない。反論後は所見の要約・反論根拠・(github モードでは投稿した PR コメント URL、
   local モードでは `rebuttal-<連番>.md` のパス)を「反論済み一覧」に追記する。
5. ディスパッチ 1 往復(implementer への修正依頼 → 完了報告)ごとに
   `node <plugin-root>/scripts/codiel-state.mjs record-attempt fix-loop --slug <slug>` を呼ぶ。
   exit code が `3`(`capExceeded`)なら、それ以上ディスパッチせず `raguel-gating` の ASK
   ハンドリングに合流する(「あと 1 回だけ」と自己判断で続行しない)。
6. implementer が返した修正 diff を `mcp__plugin_codiel_raguel__evaluate_code` に通す(`raguel-gating` の
   フェーズ→ツール対応表のとおり)。`STOP`/`ASK` が返れば `raguel-gating` の該当ハンドリングに
   従う(自己判断で握り潰さない)。
7. 修正が反映されたら `running-regression-tests` の手順で回帰全体(影響 unit + 既存全 unit +
   プロジェクトの test コマンド)を再実行する(修正対象のケースだけの再実行にしない)。
8. **github モードでは**、回帰が green になったらオーケストレーターが `git push` して PR ブランチ
   (`state.branch`)をリモートへ最新化する(PR を最新の状態に保つために push する。再レビューは
   `git diff <base>...<branch>` でその時点の作業ツリーを直接読むため、push の有無は reviewer が
   見る diff には影響しない。guard-bash は fix-loop フェーズ + test-loop passed の条件下でこの
   push を許可済み)。**local モードでは push しない**。
9. 回帰が green になったら(github モードでは push の後)、diff のドメインと共通観点に応じた担当を
   再ディスパッチし、`reviewing-diffs` の手順で `review-<m+1>.md` を作る。ディスパッチ時の
   申し送りに「反論済み一覧」を含め、reviewer が新たな根拠なしに同一所見を再報告しないようにする。
10. `review-<m+1>.md` の critical/high 件数を確認する。件数からは「反論済み一覧」に載る所見を
    除外する(ただし reviewer が新たな根拠を伴って再主張したものは未決に戻し件数に含める)。
    除外後に 1 件でも残っていれば手順 2 に戻る。ゼロになったら手順 11 へ。
    反論済み所見が新根拠なしに再報告された場合は再反論せず、その事実を 1 度だけ記録して件数から
    除外する。記録は反論と同じ流れで行う。組み立てた本文を Write ツールで所見ごとに別名の
    `.codiel/runs/<slug>/try-<n>/reports/restatement-<連番>.md` に書く。このファイルはコミットしない。
    github モードでは、書いた後、別の Bash 呼び出しで
    `gh api` を `-F body=@.codiel/runs/<slug>/try-<n>/reports/restatement-<連番>.md` のように
    `-F body=@<パス>` で本文を渡して投稿する(1 回の Bash 呼び出しに 1 つ)。local モードでは投稿しない。
11. 最終の修正 diff に対する `evaluate_code` の verdict が `PROCEED` であることを確認し、
    `node <plugin-root>/scripts/codiel-state.mjs pass-gate fix-loop --slug <slug> --evaluation-id <id>
    --verdict PROCEED` を呼んでフェーズを完了させる(`pass-gate` はループの最後に 1 回だけ呼ぶ。
    修正の度に呼ぶのは `record-attempt` と `evaluate_code` であり、`pass-gate` ではない)。

## 所見と PR コメントの対応付け

所見を PR へ投稿する(`reviewing-diffs` の「所見の統合と投稿」セクション、および再レビュー後)際、
オーケストレーターは投稿した各行コメントの URL(または ID)を `reports/review-<m>.md` の該当所見に
追記する。以降の「反論」「対応」の返信は常にこの URL に対して行う(所見テキストの一致だけで
コメントを探し直さない)。

## PR 反論記録書式

不当と判断した所見への反論は、`github-writing.md` の執筆規則に従い、次の内容を本文に組み立てる。
github モードでは元の所見コメントへの返信(なければ新規コメント)として投稿し、local モードでは
`rebuttal-<連番>.md` のパスを記録先とする。

```markdown
反論: <なぜこの指摘は不当か。intent/design.md/spec.md のどこと整合しているか、
再現を試みた結果どうだったか、といった技術的根拠>
```

妥当と判断し修正が完了した所見には、修正を行った implementer のコミットハッシュを添えて次の形式で
対応済みを記録する。記録は反論と同じ流れで行う。組み立てた本文を Write ツールで所見ごとに別名の
`.codiel/runs/<slug>/try-<n>/reports/resolution-<連番>.md` に書く。このファイルはコミットしない。
github モードでは、書いた後、別の Bash 呼び出しで `gh api` を
`-F body=@.codiel/runs/<slug>/try-<n>/reports/resolution-<連番>.md` のように `-F body=@<パス>` で
本文を渡して呼び、対応済みを投稿する。local モードでは投稿せず、`resolution-<連番>.md` を手元に残して
記録を終える。

```markdown
対応: <commit hash>
```

「対応」も「反論」も**必ずどちらかを記録する**。所見に対して何も記録しない状態を残さない。
本文には `<!-- codiel:generated -->` を含める。github モードでの投稿は 1 回の Bash 呼び出しに 1 つとする。

<HARD-GATE>
- **検証せずに指摘へ盲従しない**。所見の severity や書き方がどれだけ断定的でも、対象ファイル・
  intent/design.md/spec.md との突き合わせで技術的に検証するまでは、妥当と決めつけて
  implementer にディスパッチしない。
- **critical/high の握り潰し禁止**。不当と判断して修正しない場合も、必ず反論を記録する(github
  モードでは PR 上に、local モードでは `.codiel/runs/<slug>/try-<n>/reports/` の
  `rebuttal-<連番>.md` として `reports/` に書く)。「対応」も「反論」もせず沈黙することは、
  指摘そのものが無かったことにするのと同じ。
- **medium/low を本スキルの対象に含めない**。critical/high 以外を fix-loop で修正することは
  triage フェーズの職掌への越境であり行わない。
- **オーケストレーターは自分でコードを直さない**。`orchestrating-runs` の HARD-GATE と同じく、
  修正は必ず implementer へのディスパッチを経由する。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「レビュアーは経験豊富そうだから指摘どおり直させよう」 | レビュアーの信頼度に応じて検証を省略してよい理由にはならない。手順 2 のとおり対象ファイルと根拠文書を自分で突き合わせて検証してから判断する。 |
| 「不当だと思うので黙って対応しないでおこう」 | 反論しないまま放置すると、後で読む人には「見落とし」なのか「意図的に却下」なのか区別がつかない。不当と判断した場合こそ根拠を記録する(github モードでは PR に投稿し、local モードでは `reports/` に書く)。 |
| 「record-attempt は面倒だからまとめて最後に 1 回呼ぼう」 | 試行上限は暴走的な修正ループを止めるための仕組み。ディスパッチのたびに呼ばないと実際の試行回数とずれ、上限超過の検知が機能しなくなる。 |
