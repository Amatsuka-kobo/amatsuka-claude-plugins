# Codiel の運用の規律

## 文書の扱い

- intent 文書(`docs/intents/`)の原文のセクション(`## ASIS` / `## TOBE`)は、ユーザーが自分で
  書いた・語った言葉の記録である。要約せず、言い換えず、既存の記録を書き換えない。言葉を足すときは、
  日付・話者・出所の行を添えて末尾に追記する。
- 持続層(`docs/intents/domains/`)は要件と意図的な制約を長く残す資産であり、intent-sync フェーズの
  外では書き換えない。例外は、finalize の作業中に ADR 候補を `## 意図的な制約` へ、GOTCHAS 候補を
  `## GOTCHAS 候補` へ書き足すことだけである。
  `[ADR 候補]` の印が付いたエントリは、intent-sync フェーズの外で参照形へ縮める。そのため、
  それ以外のセッションはこのエントリを書き換えない。
- テスト仕様書(`<testsDir>/`。既定は `docs/codiel/tests`、置き場は `.codiel/config.json` の `testsDir` で
  決める)は機能の一部であり、使い捨て成果物ではない。振る舞いを変える変更を行ったら、対応する
  仕様のディレクトリの `spec.md` と `cases.md` を直し、テストコードを追随させる。
- run の文書(`agenda.md`・`discussion.md`・`design.md`・`dev-plan.md`)は `<runsDir>/<slug>/`
  (既定は `docs/codiel/runs/<slug>/`、置き場は `.codiel/config.json` の `runsDir` で決める)に置き、
  git で共有する。
- Raguel の設定(保護パスなど)は `.codiel/config.json` の `raguel` に書く。config.json は git で共有する。
- `.codiel/runs/` と `.codiel/reports/` は run の状態とレポートの置き場であり、`.gitignore` で git に
  載せない。コミットしない。

## 規則

1. **run から渡された前提を使う**
   すべてのフェーズ(intent〜finalize)の作業開始前に、run から渡された前提を使う。
2. **`.codiel/runs/**/state.json` を直接編集しない(codiel-state 経由のみ)**
   フェーズ遷移・試行カウンタの更新は同梱スクリプト `codiel-state` のみが行う。Edit / Write
   ツールによる state.json への直接変更は hooks が拒否する対象であり、それを回避する目的での
   迂回(別名でのコピー→上書き等)も禁止する。
3. **Raguel ゲートは省略しない。ASK / STOP には従う**
   各フェーズで定められた Raguel の evaluate ツール呼び出しを、確実に PROCEED しそうだから・
   前回 PROCEED だったから等の理由で省略しない。ASK が出たら人間の裁定を待ち、STOP が出たら
   run を停止する。
4. **PROCEED した変更が原因で実害が出たら、必ず incident として申告し `record_outcome(incident)`
   を記録させる**
   マージ・リリース後に障害やリグレッションが発生し、その原因が Codiel が PROCEED 判定を出した
   変更にあると判明した場合、人間(または気づいたエージェント)は必ずその旨を明示的に申告する。
   incident は自動検知できない唯一の結末であり、最も価値の高い失敗判例として Raguel に還流される。
   申告を怠ると、同種の失敗が判例として蓄積されず再発を防げなくなる。
