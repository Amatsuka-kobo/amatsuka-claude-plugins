---
name: fixing-review-findings
description: Codiel の fix-loop フェーズでオーケストレーターがレビュー所見(critical/high)への対応を運転するとき使用する。所見に検証なしで盲従したくなる場面・critical/high を握り潰したくなる場面・反論を PR に記録せず済ませたくなる場面でこそ必ず使用する。
---

# fix-loop 運転規約

## 概要

`orchestrating-runs` の [8] fix-loop フェーズで**オーケストレーター自身**が使うスキルである。
オーケストレーターが自分でコードを直すことは許されない。

入力は `reports/review-<n>.md` の所見のうち **critical / high のみ**。medium/low は本スキルの
対象外であり、修正せず `triage` フェーズ(`filing-followup-issues`)へそのまま持ち越す
(`reviewing-diffs` の severity 定義表のとおり下流の扱いが分かれる)。

review で critical/high が **一件もなかった場合、本スキルは発動しない**。その場合
`orchestrating-runs` §5「fix-loop のスキップ経路」に従い `codiel-state skip-phase fix-loop`
で明示的にスキップする(本スキルを空振りで起動しない)。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/fixing-review-findings` である。**`<plugin-root>` はそのベースディレクトリの
2 階層上**。`codiel-state` は対象プロジェクトのルートで次の形で呼ぶ:

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --issue <番号>
```

## チェックリスト

1. 最新の `reports/review-<n>.md` を読み、critical/high の所見を一覧化する(medium/low は対象外
   として除外する。除外した件数も後で triage へ引き継ぐため覚えておく)。
2. 所見ごとに、対象ファイル・行・design.md/spec.md/issue.md の根拠を突き合わせて技術的に検証する。
   必要なら読み取り専用サブエージェントへ調査を委譲するが、妥当性の最終判断は自分で行う。
3. 妥当と判断した所見は、該当ドメインの implementer へ `implementing` の契約 (b) レビュー所見由来
   の形式(所見: severity・対象・内容・根拠・提案 + 対象ファイル)でディスパッチする(1 所見ずつ
   でも複数所見まとめてでもよいが、ドメインが混在する場合はドメインごとに分けてディスパッチする)。
4. 不当と判断した所見は、`reports/review-<n>.md` に記録された PR コメント URL への返信として、
   下記「PR 反論記録書式」に従い `gh api` で反論を投稿する(URL が未記録なら新規コメントでよい)。
   修正はしない。反論後は所見の要約・反論根拠・投稿した PR コメント URL を「反論済み一覧」に
   追記する。
5. ディスパッチ 1 往復(implementer への修正依頼 → 完了報告)ごとに
   `node <plugin-root>/scripts/codiel-state.mjs record-attempt fix-loop --issue N` を呼ぶ。
   exit code が `3`(`capExceeded`)なら、それ以上ディスパッチせず `raguel-gating` の ASK
   ハンドリングに合流する(「あと 1 回だけ」と自己判断で続行しない)。
6. implementer が返した修正 diff を `mcp__raguel__evaluate_code` に通す(`raguel-gating` の
   フェーズ→ツール対応表のとおり)。`STOP`/`ASK` が返れば `raguel-gating` の該当ハンドリングに
   従う(自己判断で握り潰さない)。
7. 修正が反映されたら `running-regression-tests` の手順で回帰全体(影響 unit + 既存全 unit +
   ARCHITECTURE のテストコマンド)を再実行する(修正対象のケースだけの再実行にしない)。
8. 回帰が green になったら、**オーケストレーターが `git push` して PR ブランチ(`state.branch`)を
   リモートへ最新化する**(reviewer は `gh pr diff` で PR の diff を読むため、push を怠ると
   reviewer は修正前の stale な diff を見ることになり、既に対応済みの所見を再度報告してしまう。
   guard-bash は fix-loop フェーズ + test-loop passed の条件下でこの push を許可済み)。
9. push 後、diff のドメインに応じた `codiel-reviewer-*`(+ 常時参加の doc/security)を
   再ディスパッチし、`reviewing-diffs` の手順で `review-<n+1>.md` を作る。ディスパッチ時の
   申し送りに「反論済み一覧」を含め、reviewer が新たな根拠なしに同一所見を再報告しないようにする。
10. `review-<n+1>.md` の critical/high 件数を確認する。件数からは「反論済み一覧」に載る所見を
    除外する(ただし reviewer が新たな根拠を伴って再主張したものは未決に戻し件数に含める)。
    除外後に 1 件でも残っていれば手順 2 に戻る。ゼロになったら手順 11 へ。
    反論済み所見が新根拠なしに再報告された場合は再反論せず、その事実を PR コメントに 1 度だけ記録して件数から除外する。
11. 最終の修正 diff に対する `evaluate_code` の verdict が `PROCEED` であることを確認し、
    `node <plugin-root>/scripts/codiel-state.mjs pass-gate fix-loop --issue N --evaluation-id <id>
    --verdict PROCEED` を呼んでフェーズを完了させる(`pass-gate` はループの最後に 1 回だけ呼ぶ。
    修正の度に呼ぶのは `record-attempt` と `evaluate_code` であり、`pass-gate` ではない)。

## 所見と PR コメントの対応付け

所見を PR へ投稿する(`reviewing-diffs` の「所見の統合と投稿」節、および再レビュー後)際、
オーケストレーターは投稿した各行コメントの URL(または ID)を `reports/review-<n>.md` の該当所見に
追記する。以降の「反論」「対応」の返信は常にこの URL に対して行う(所見テキストの一致だけで
コメントを探し直さない)。

## PR 反論記録書式

不当と判断した所見への反論は、元の所見コメントへの返信(なければ新規コメント)として次の形式で投稿する。

```markdown
反論: <なぜこの指摘は不当か。design.md/spec.md/issue.md のどこと整合しているか、
再現を試みた結果どうだったか、といった技術的根拠>
```

妥当と判断し修正が完了した所見には、修正を行った implementer のコミットハッシュを添えて次の形式で対応済みを記録する。

```markdown
対応: <commit hash>
```

「対応」も「反論」も**必ずどちらかを記録する**。所見に対して何も投稿しない状態を残さない。

<HARD-GATE>
- **検証せずに指摘へ盲従しない**。所見の severity や書き方がどれだけ断定的でも、対象ファイル・
  design.md/spec.md/issue.md との突き合わせで技術的に検証するまでは、妥当と決めつけて
  implementer にディスパッチしない。
- **critical/high の握り潰し禁止**。不当と判断して修正しない場合も、必ず PR 上に反論を記録する
  (「対応」も「反論」もせず沈黙することは、指摘そのものが無かったことにするのと同じ)。
- **medium/low を本スキルの対象に含めない**。critical/high 以外を fix-loop で修正することは
  triage フェーズの職掌への越境であり行わない。
- **オーケストレーターは自分でコードを直さない**。`orchestrating-runs` の HARD-GATE と同じく、
  修正は必ず implementer へのディスパッチを経由する。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「レビュアーは経験豊富そうだから指摘どおり直させよう」 | レビュアーの信頼度に応じて検証を省略してよい理由にはならない。手順 2 のとおり対象ファイルと根拠文書を自分で突き合わせて検証してから判断する。 |
| 「不当だと思うので黙って対応しないでおこう」 | 反論しないまま放置すると、後で読む人には「見落とし」なのか「意図的に却下」なのか区別がつかない。不当と判断した場合こそ根拠を PR に記録する。 |
| 「record-attempt は面倒だからまとめて最後に 1 回呼ぼう」 | 試行上限は暴走的な修正ループを止めるための仕組み。ディスパッチのたびに呼ばないと実際の試行回数とずれ、上限超過の検知が機能しなくなる。 |
