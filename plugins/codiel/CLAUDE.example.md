# CLAUDE.md

<!-- 記入ガイド
このファイルは Codiel ハーネス(docs/ARCHITECTURE.md・docs/GOTCHAS.md・.codiel/ 配下)を
正しく運用するための決まりを、対象プロジェクトの CLAUDE.md に常駐させるための雛形です。
`/codiel:init`(initializing-harness スキル)がこのファイルの「## Codiel ハーネス運用ルール」
セクションを対象プロジェクトの CLAUDE.md に反映します(CLAUDE.md がなければ新規作成し、
既にある場合は同セクションがなければ末尾に追記、あれば変更しません)。
7 項目は DESIGN.md §9 に定義された規則そのままです。文言は変更してよいが、規則の内容
(何を・いつ・どう扱うか)は削らないこと。
-->

## Codiel ハーネス運用ルール

1. **作業前に ARCHITECTURE.md を読む。GOTCHAS.md の該当エントリを確認する**
   すべてのフェーズ(init〜finalize)の作業開始前に `docs/ARCHITECTURE.md` の技術スタック・
   ドメインマップ・コマンド定義・テスト方針を確認し、これから触るファイル・フェーズに関連する
   `docs/GOTCHAS.md` のエントリを確認してから着手する。
2. **失敗したら recording-gotchas の基準に従い GOTCHAS.md に追記する**
   Raguel の STOP、test-loop/fix-loop のループ上限超過、`record_outcome(incident)`、
   レビューで発覚した設計漏れのいずれかが起きたら、`recording-gotchas` スキルの書式・基準に
   従って `docs/GOTCHAS.md` に新規エントリを追記する。既存エントリの削除・改変はしない。
3. **`.codiel/runs/**/state.json` を直接編集しない(codiel-state 経由のみ)**
   フェーズ遷移・試行カウンタの更新は同梱スクリプト `codiel-state` のみが行う。Edit / Write
   ツールによる state.json への直接変更は hooks が拒否する対象であり、それを回避する目的での
   迂回(別名でのコピー→上書き等)も禁止する。
4. **Raguel ゲートは省略しない。ASK / STOP には従う**
   各フェーズで定められた Raguel の evaluate ツール呼び出しを、確実に PROCEED しそうだから・
   前回 PROCEED だったから等の理由で省略しない。ASK が出たら人間の裁定を待ち、STOP が出たら
   run を停止して原因を記録する(2. を参照)。
5. **ARCHITECTURE.md が現実と乖離したら更新する(乖離の放置は GOTCHAS 行き)**
   実装の過程でディレクトリ構成・ドメインマップ・コマンド定義・テスト方針が
   `docs/ARCHITECTURE.md` の記述と食い違っていることに気づいたら、その場で ARCHITECTURE.md を
   更新する。更新せず気づかないふりをして進めた場合、後で発覚した際に GOTCHAS.md へ記録される
   対象になる。
6. **テスト仕様書(`.codiel/specs/`)は機能の一部。機能を変えたら仕様書とケースも更新する**
   `.codiel/specs/<unit-id>/spec.md` と `cases.md` は使い捨て成果物ではなく、プロダクトコードと
   同格の永続資産である。振る舞いを変える変更を行ったら、対応する unit の spec.md を更新し、
   cases.md を再生成し、scripts を追随させることを実装の一部として扱う。
7. **PROCEED した変更が原因で実害が出たら、必ず incident として申告し `record_outcome(incident)`
   を記録させる**
   マージ・リリース後に障害やリグレッションが発生し、その原因が Codiel が PROCEED 判定を出した
   変更にあると判明した場合、人間(または気づいたエージェント)は必ずその旨を明示的に申告する。
   incident は自動検知できない唯一の結末であり、最も価値の高い失敗判例として Raguel に還流される。
   申告を怠ると、同種の失敗が判例として蓄積されず再発を防げなくなる。
