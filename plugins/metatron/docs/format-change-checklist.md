# 書式・規則を変更するときのチェックリスト

metatron が定める書式と規則を変更したときに、同じコミットで追随させる先を並べる。
この文書は metatron の開発時に読む。metatron を利用するプロジェクトの作業では読まない。

## ARCHITECTURE の書式(`references/architecture-format.md`)

- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §4
- [ ] codiel: `src/hooks/lib.ts` の `readDomains`、`initializing-harness` / `orchestrating-runs`
- [ ] sandalphon: `src/check-intent-env.ts`、`references/handoff-contract.md`

## GOTCHAS の書式(`references/gotchas-format.md`)

- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §6
- [ ] codiel: `skills/recording-gotchas/SKILL.md` の書式の写し

## metatron.config.json のスキーマとパス解決規則(`references/config-schema.md`)

この規則を変更したら、次をすべて更新して 3 者比較テストを通す。

- [ ] `plugins/metatron/src/lib/config.ts`(正本の実装)
- [ ] `plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths`
- [ ] `plugins/sandalphon/src/check-intent-env.ts`
- [ ] 3 者比較テスト(metatron のテスト R4 / sandalphon のケース 16f)

3 つのプラグインはこの規則を独立に実装している。写しが割れると、同じカレントディレクトリから別のファイルへ辿り着く。
