# CLAUDE.md

<!-- 記入ガイド
このファイルの「## Codiel」セクションは、Codiel ハーネス(`.codiel/` 配下・run の状態管理・
変更ごとの intent 文書)の置き場の地図と入口のコマンドを、対象プロジェクトの CLAUDE.md へ
常駐させるための雛形です。CLAUDE.md はセッションの最初にだけ読まれるため、ここには
最初に知っておくべき知識だけを置きます。`/codiel:init`(initializing-harness スキル)が
このセクションを対象プロジェクトの CLAUDE.md に反映します(CLAUDE.md が無ければ新規作成し、
既にある場合は同セクションが無ければ末尾に追記、あれば変更しません)。
運用の規律(文書の扱いと規則)は、対応する雛形 `plugins/codiel/assets/rules/codiel.md` から
対象プロジェクトの `.claude/rules/codiel.md`(`paths` の指定なし)に置きます。
本文は `plugins/codiel/docs/DESIGN.md` の「9. docs」の「CLAUDE.md の `## Codiel`」セクションと
対応させます。文言は変更してよいが、置き場の情報は削らないこと。
-->

## Codiel

- `docs/intents/`: 変更ごとの intent 文書。`domains/` は持続層
- `.codiel/runs/`: run の状態(codiel-state が管理)
- `.codiel/specs/`: 機能単位のテスト仕様書
- `raguel.config.yaml`: Raguel の保護パス
- 入口: `/codiel:run`・`/codiel:init`・`/codiel:test`
