# 書式・規則を変更するときのチェックリスト

metatron が定める書式と規則を変更したときに、同じコミットで追随させる先を並べる。
この文書は metatron の開発時に読む。metatron を利用するプロジェクトの作業では読まない。

## ARCHITECTURE の書式(`references/architecture-format.md`)

- [ ] 見出し許可リストは `src/lib/architecture.ts` の `ARCHITECTURE_HEADINGS` と `src/lib/scan.ts` の `ARCHITECTURE_SECTIONS` の 2 箇所にある。同じコミットで直す
- [ ] セクションを追加・削除したら、`docs/ARCHITECTURE.example.md` に記入例と記入ガイドを置き、`skills/capturing-architecture/SKILL.md` の起草の単位を揃える
- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §4
- [ ] codiel: `src/hooks/lib.ts` の `readDomains`、`initializing-harness` / `orchestrating-runs`、`src/check-intent-env.ts`、`references/handoff-contract.md`
- [ ] `plugins/metatron/src/lib/architecture.ts` の全文の読み直し(`rejectBrokenResult`)と、`references/cli-usage.md` の `stage-architecture` のエラーコード
- [ ] `## 技術スタック` と `## コマンド定義` の規定を変えたら、`src/lib/scan.ts` の `SOURCE_FILE_RES`(`diff-architecture` の `sources`)、`src/lib/__test__/scan.test.ts` の sources のテスト、`skills/updating-architecture/SKILL.md` の手順 2 の sources の読み方、`skills/capturing-architecture/SKILL.md` の起草の材料、`docs/ARCHITECTURE.example.md` を揃える
- [ ] 書式や執筆規律を変えたら、利用者の既存の文書は `/metatron:audit` で追随させる。README の `/metatron:audit` の説明が変更後の規定と食い違わないかを確かめる

## metatron.config.json のスキーマとパス解決規則(`references/config-schema.md`)

この規則を変更したら、次をすべて更新して 2 者比較テストを通す。

- [ ] `plugins/metatron/src/lib/config.ts`(正本の実装)
- [ ] `plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths`
- [ ] 2 者比較テスト(metatron のテスト R4 / codiel のケース 16f)

2 つのプラグインはこの規則を独立に実装している。写しが割れると、同じカレントディレクトリから別のファイルへ辿り着く。

## writing-discipline の追随(`references/writing-discipline.md`)

prompt-smith の `plugins/prompt-smith/skills/prompt-smith/SKILL.md` を改訂したら、このセクションに沿って `writing-discipline.md` を見直す。

最後に追随した prompt-smith のコミット: `e12d5736`(2026-11-12)。次の見直しでは、`git log e12d5736..HEAD -- plugins/prompt-smith/skills/prompt-smith/SKILL.md` で差分を確かめる。

- [ ] 削る基準・残す基準・書き方の基準・引くための記述の例外を、prompt-smith の現行規律に追随させる
- [ ] ARCHITECTURE 向けの特化(適用の強さ、図の基準)は変えない
- [ ] `skills/{capturing-architecture,updating-architecture}/SKILL.md` の writing-discipline への参照が、見出し名と揃っているかを確認する
- [ ] `plugins/metatron/references/writing-discipline.md` の既存の `##` 見出しの行を変えない
