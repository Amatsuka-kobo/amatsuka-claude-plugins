# Codiel の運用の規律

## 文書の扱い

- intent 文書(`docs/intents/`)の原文のセクション(`## ASIS` / `## TOBE`)は、ユーザーが自分で
  書いた・語った言葉の記録である。記録は要約も言い換えもせず、原文のまま残す。言葉を足すときは、
  日付・話者・出所の行を添えて末尾に追記する。
- 持続層(`docs/intents/domains/`)は要件と意図的な制約を長く残す資産であり、intent-sync フェーズの
  外では書き換えない。例外は次の作業だけである。
  - finalize の作業中に、ADR 候補を `## 意図的な制約` へ、GOTCHAS 候補を `## GOTCHAS 候補` へ書き足す。
  - metatron が、ADR にした `[ADR 候補]` のエントリを参照形へ縮め、台帳へ移した `[GOTCHAS 候補]` の
    エントリを消す。
- テスト仕様書は `<testsDir>/`(既定は `docs/codiel/tests`。`.codiel/config.json` の `testsDir` で決める)に
  置く。振る舞いを変えたら、対応する仕様のディレクトリの `spec.md` と `cases.md` を直し、テストコードを
  追随させる。
- run の文書(`agenda.md`・`discussion.md`・`design.md`・`dev-plan.md`)は `<runsDir>/<slug>/`
  (既定は `docs/codiel/runs/<slug>/`、置き場は `.codiel/config.json` の `runsDir` で決める)に置き、
  git で共有する。
- Raguel の設定(保護パスなど)は `.codiel/config.json` の `raguel` に書き、git で共有する。
- `.codiel/runs/` と `.codiel/reports/` は run の状態とレポートの置き場であり、`.gitignore` で git に
  載せず、コミットしない。

## 規則

- すべてのフェーズ(intent〜finalize)で、作業を始める前に run から渡された前提を使う。
- フェーズ遷移と試行カウンタは、同梱スクリプト `codiel-state` だけで更新する。`.codiel/runs/**/state.json`
  への Edit / Write は hooks が拒否する。別名でのコピー→上書きなどで迂回せず、`codiel-state` を使う。
- 各フェーズで定められた Raguel の evaluate ツールは、PROCEED の見込みや前回の判定にかかわらず呼ぶ。
- ASK が出たら、人間の裁定を待つ。
- STOP が出たら、run を停止する。
- マージ・リリース後の障害やリグレッションの原因が、Codiel で PROCEED と判定された変更にあると
  分かったら、人間(または気づいたエージェント)は incident としてその旨を明示的に申告する。
