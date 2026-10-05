---
name: facilitating-design-discussions
description: Codiel の discuss フェーズで、オーケストレーター本体が agenda.md を基にユーザーと論点を議論し合意を discussion.md に記録するとき、および design フェーズのウォークスルーで design.md をユーザーに確認し新しい画面の名前を決めるときに使う。orchestrating-runs が名指しで起動する。
---

# ディスカッション進行規約

## 概要

オーケストレーターが discuss フェーズの後半(ディスカッションの進行と記録)と、design フェーズの
ウォークスルーで使うスキル。設計の思考(論点抽出・案の比較)と進行と記録はオーケストレーターが、
決定はユーザーが担う。

オーケストレーターが書いてよい文書と、書かずに委譲するものの分担は、`orchestrating-runs` §3 冒頭に従う。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/facilitating-design-discussions`
である。`<plugin-root>` はそのベースディレクトリの 2 階層上である。`codiel-state` は対象プロジェクトの
ルートで次の形で呼ぶ。

```
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

このスキルの `references/<file>.md` は、ベースディレクトリからの相対パスである。

## チェックリスト(discuss フェーズ)

1. `agenda.md` を読み、論点の一覧と各推奨案の 1 行要約をユーザーに提示する。
2. 進め方を確認する: 「論点ごとに議論する」か「すべて推奨案で進める」かを最初に選んでもらう
   (AskUserQuestion)。後者が選ばれたら 5 へ。
3. 論点を一つずつ提示する。選択肢・トレードオフ・推奨案を agenda.md の記載のまま添え、
   要約で歪めず、オーケストレーター自身の意見で選択を誘導しない(推奨の出所は常に agenda.md)。
   議論が長引いても、要約して打ち切るのはユーザーの判断に任せる。
   AskUserQuestion を基本とし、選択肢に収まらない議論をユーザーが求めたら通常の対話に切り替える。
   各論点の提示には「残りの論点をすべて推奨案で進める」選択肢も含める。
   agenda.md に無い論点をユーザーが持ち出したときは、その場で決定せず、オーケストレーター自身が agenda.md に追記する。
4. 論点ごとに、決定・理由・却下案を `discussion.md` に記録する(書式は下記)。
   ユーザーが明示に選択・発言していない内容は決定として記録しない。回答が曖昧なら、確認し直すか
   「状態: 未決」のまま残す。ユーザーが保留した論点も「状態: 未決」のまま残す。
5. 「すべて推奨案で進める」が選ばれた場合は、残りの全論点に推奨案を採用として記録する
   (理由: 「ユーザーが推奨案の一括採用を選択」)。
6. 全論点の記録後、決定の一覧と未決の有無を要約してユーザーに提示し、最終確認を取る。
   修正があれば該当論点の提示に戻る。
7. 未決論点が残る場合は「この論点は未決のまま design に進む(オーケストレーターは未決を前提に設計し、
   ウォークスルーで再提示される)」ことを明示し、ユーザーの了解を得る。
8. `<runsDir>/<slug>/` の `agenda.md` と `discussion.md` を `orchestrating-runs` §2.1 の形でコミットし、
   `node <plugin-root>/scripts/codiel-state.mjs complete-phase discuss --slug <slug>` でフェーズを完了する。

## discussion.md の書式

design フェーズで design を書くオーケストレーター(writing-design-docs)と、`evaluate_design` のゲートがこの書式のまま読む。項目名を変更しない。

```markdown
# discussion: <intent のゴール>

## 論点 1: <agenda.md と同じ論点名>

- 状態: 決定 | 未決
- 決定: <ユーザーが選んだ内容。未決なら「-」>
- 理由: <ユーザーの発言に基づく理由>
- 却下案: <却下された選択肢と却下理由。なければ「なし」>
```

## 設計ウォークスルー(design フェーズ)

オーケストレーターが design.md を書き終えたら、raguel-gating の design ゲート(`evaluate_design`)を呼ぶ前に、`references/design-walkthrough.md` を Read して従う。

## 中断再開(discuss フェーズ)

- `agenda.md` が無く、`discussion.md` に「論点なし」の記録も無い → アジェンダ作成から
- `agenda.md` が無く、`discussion.md` に「論点なし」の記録がある → discuss を終え、design へ進む
- `agenda.md` があり、`discussion.md` が無い/「状態: 未決」の論点が残る → 未決論点の提示から再開
- 全論点が決定済み → 最終確認から再開

## 待機と Stop フック

ユーザーの回答を待つ前の `mark-ask` と、答えを得た後の `resume` は、`orchestrating-runs` §2.4 の共通規則に従う。
`<phase>` には、discuss の論点提示・最終確認では discuss を、design フェーズのウォークスルーの
確認待ちでは design を入れる。「discuss フェーズ: 論点 <N> の回答待ち」「design フェーズ: ウォーク
スルーの確認待ち」のように待機理由を最終メッセージで明示してから停止する。
