---
name: fixing-review-findings
description: Codiel の fix-loop フェーズで、オーケストレーター本体が review-<m>.md の critical・high 所見を検証し、実装への修正委譲と反論の記録までを運転するときに使う。orchestrating-runs が名指しで起動する。
---

# fix-loop 運転規約

## 概要

`orchestrating-runs` の [11] fix-loop フェーズでオーケストレーター自身が使うスキルである。
修正は実装の委譲先へのディスパッチで行う。オーケストレーターは、`orchestrating-runs` §3 冒頭の分担のとおり、自分でコードを直さない。

入力は `reports/review-<m>.md` の所見のうち critical / high だけである。medium/low は修正せず、
`triage` フェーズ(`filing-followup-issues`)へそのまま持ち越す(`reviewing-diffs` の severity 定義表のとおり下流の扱いが分かれる)。

review で critical/high が 1 件も無かったときは、このスキルを起動せず、
`orchestrating-runs` §2 の fix-loop をスキップする規則に従って `skip-phase fix-loop` を呼ぶ。

GitHub へ投稿する本文の文の組み立ては `../../references/github-writing.md` に従う。

`rebuttal-<連番>.md`・`resolution-<連番>.md`・`restatement-<連番>.md` の連番は、同じ try の中で
通し番号とする。レビューの回をまたいでも振り直さず、前の回で書いたファイルを上書きしない。
これらのファイルはコミットしない。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/fixing-review-findings` である。`<plugin-root>` はそのベースディレクトリの
2 階層上である。`codiel-state` は対象プロジェクトのルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## 記録の投稿手順

反論・対応・再主張の本文は、`github-writing.md` の執筆規則に従って組み立て、`<!-- codiel:generated -->` を含める。

1. 所見ごとに Write ツールで `.codiel/runs/<slug>/try-<n>/reports/<種別>-<連番>.md` に本文を書く。このファイルはコミットしない。
2. github モードでは、別の Bash 呼び出しで `gh api` を `-F body=@<そのパス>` で呼んで投稿する(1 回の Bash 呼び出しに 1 件)。`reports/review-<m>.md` に記録された PR コメント URL への返信とする。反論で URL が未記録なら新規コメントでよい。
3. local モードでは投稿せず、ファイルを手元に残して記録を終える。

## チェックリスト

1. 最新の `reports/review-<m>.md` を読み、critical/high の所見を一覧化する(medium/low は対象外
   として除外する。除外した件数も後で triage へ引き継ぐため覚えておく)。
2. 所見ごとに、対象ファイル・行・intent(`docs/intents/**`)/design.md/spec.md の根拠を突き合わせて
   技術的に検証する。所見の severity や書き方が断定的でも、検証が済むまでは妥当と決めず、
   実装の委譲先へディスパッチしない。必要なら読み取り専用サブエージェントへ調査を委譲するが、
   妥当性の最終判断は自分で行う。
3. 所見がテスト・`spec.md`・`cases.md` の誤りや不足に向くときは、
   `node <plugin-root>/scripts/codiel-state.mjs set-test-edit --slug <slug>` を実行してから、
   `writing-test-specs`(`spec.md`・`cases.md` の直し)と `scripting-tests`(テストコードの直し)に
   従う委譲でテスト側を先に直させる。振る舞いを変える修正なら、コードの修正の前にテストが失敗することを確かめさせる。
   報告を `waits/<id>.md` に書いて `wait-done` した直後に `node <plugin-root>/scripts/codiel-state.mjs clear-test-edit --slug <slug>` を
   実行する。妥当と判断したそれ以外の所見(テスト側の修正の後にコードの修正が要る所見を含む)は、
   該当ドメインの実装の委譲先へ `implementing` の契約 (b) レビュー所見由来
   の形式(所見: severity・対象・内容・根拠・提案 + 対象ファイル)でディスパッチする(1 所見ずつ
   でも複数所見まとめてでもよいが、ドメインが混在する場合はドメインごとに分けてディスパッチする)。
4. 不当と判断した所見は、下記「PR 反論記録書式」の内容で `rebuttal-<連番>.md` を作り、「記録の投稿手順」で記録する。
   修正はしない。反論後は所見の要約・反論根拠・(github モードでは投稿した PR コメント URL、
   local モードでは `rebuttal-<連番>.md` のパス)を「反論済み一覧」に追記する。
5. ディスパッチ 1 往復(実装の委譲先への修正依頼 → 完了報告)ごとに
   `node <plugin-root>/scripts/codiel-state.mjs record-attempt fix-loop --slug <slug>` を呼ぶ。
   exit code が `3`(`capExceeded`)なら、それ以上ディスパッチせず `raguel-gating` の ASK
   ハンドリングに合流する(「あと 1 回だけ」と自己判断で続行しない)。
6. 実装の委譲先が返した修正 diff を `mcp__plugin_codiel_raguel__evaluate_code` に通す(`raguel-gating` の
   フェーズ→ツール対応表のとおり)。`STOP`/`ASK` が返れば `raguel-gating` の該当ハンドリングに
   従う(自己判断で握り潰さない)。
7. 修正が反映されたら `running-regression-tests` の手順で回帰全体(影響 unit + 既存全 unit +
   プロジェクトの test コマンド)を再実行する(修正対象のケースだけの再実行にしない)。プロジェクトの
   test コマンドと `units/` のテストはオーケストレーターが実行し、`e2e/` のテストは実行を委譲する。
8. github モードでは、回帰がパスしたらオーケストレーターが `git push` して PR ブランチ
   (`state.branch`)をリモートへ最新化する。local モードでは push しない。
9. 回帰がパスしたら(github モードでは push の後)、再レビューの委譲を出す前に
   `../orchestrating-runs/references/review-common.md` を Read し、その規則で観点を選んで担当を
   再ディスパッチし、`reviewing-diffs` の手順で `review-<m+1>.md` を作る。ディスパッチ時の
   申し送りに「反論済み一覧」を含め、レビューの委譲先が新たな根拠なしに同一所見を再報告しないようにする。
10. `review-<m+1>.md` の critical/high 件数を確認する。件数からは「反論済み一覧」に載る所見を
    除外する(ただしレビューの委譲先が新たな根拠を伴って再主張したものは未決に戻し件数に含める)。
    除外後に 1 件でも残っていれば手順 2 に戻る。ゼロになったら手順 11 へ。
    反論済み所見が新根拠なしに再報告された場合は再反論せず、その事実を 1 度だけ
    `restatement-<連番>.md` として「記録の投稿手順」で記録し、件数から除外する。
11. 最後の評価の後に HEAD が動いていれば(E2E のレポートのコミットなど)、評価し直す(`../orchestrating-runs/references/phase-fix-loop.md` の定義に従う)。
    最終の修正 diff に対する `evaluate_code` の verdict が `PROCEED` であることを確認し、
    `node <plugin-root>/scripts/codiel-state.mjs pass-gate fix-loop --slug <slug> --evaluation-id <id>
    --verdict PROCEED` を呼んでフェーズを完了させる(`pass-gate` はループの最後に 1 回だけ呼ぶ。
    修正の度に呼ぶのは `record-attempt` と `evaluate_code` であり、`pass-gate` ではない)。

## 所見と PR コメントの対応付け

所見を PR へ投稿する(`../orchestrating-runs/references/review-common.md` の「所見の統合と投稿」、および再レビュー後)際、
オーケストレーターは投稿した各行コメントの URL(または ID)を `reports/review-<m>.md` の該当所見に
追記する。以降の「反論」「対応」の返信は常にこの URL に対して行う(所見テキストの一致だけで
コメントを探し直さない)。

## PR 反論記録書式

不当と判断した所見への反論は、次の内容を本文に組み立てる。

```markdown
反論: <なぜこの指摘は不当か。intent/design.md/spec.md のどこと整合しているか、
再現を試みた結果どうだったか、といった技術的根拠>
```

妥当と判断し修正が完了した所見には、修正を行った委譲先のコミットハッシュを添えて次の形式で
対応済みを `resolution-<連番>.md` として「記録の投稿手順」で記録する。

```markdown
対応: <commit hash>
```

所見には「対応」か「反論」のどちらかを必ず記録し、何も記録しない状態を残さない。critical/high を、反論も対応もせずに沈黙で終えない。
