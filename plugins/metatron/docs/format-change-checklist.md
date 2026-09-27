# 書式・規則を変更するときのチェックリスト

metatron が定める書式と規則を変更したときに、同じコミットで追随させる先を並べる。
この文書は metatron の開発時に読む。metatron を利用するプロジェクトの作業では読まない。

## ARCHITECTURE の書式(`references/architecture-format.md`)

- [ ] 見出し許可リストは `src/lib/architecture.ts` の `ARCHITECTURE_HEADINGS` と `src/lib/scan.ts` の `ARCHITECTURE_SECTIONS` の 2 箇所にある。同じコミットで直す
- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §4
- [ ] codiel: `src/hooks/lib.ts` の `readDomains`、`initializing-harness` / `orchestrating-runs`、`src/check-intent-env.ts`、`references/handoff-contract.md`
- [ ] ADR エントリの書式はこの節ではなく「ADR の書式」の節を見る(正本は契約 §4 ではなく §6)

## ADR の書式(`references/architecture-format.md` の `## ADR 一覧`)

- [ ] `plugins/metatron/src/lib/adr.ts` の `ENTRY_HEADING_RE` / `STATUS_LINE_RE` / `STATUS_CHANGE_RE` / `ADR_SEPARATOR` / `ADR_SEPARATOR_LINE_RE` / `normalizeAdrSeparators` / `renderAdrEntryLines`
- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の **§6**(ADR の正本は §4 ではない)
- [ ] `plugins/metatron/references/architecture-format.md` の `## ADR 一覧` の節
- [ ] `plugins/metatron/docs/ARCHITECTURE.example.md` の `## ADR 一覧`(記入例は 2 件以上を保ち、区切りの見本を含める)
- [ ] metatron 設計書 `harness-docs/design/2026-08-16-metatron-design.md` §6-6 の書式の写し
- [ ] `plugins/metatron/src/lib/__test__/adr.test.ts` の固定データ(`THREE_ADRS` / `THREE_ADRS_SEPARATED`)
- [ ] `plugins/metatron/scripts/` を `pnpm run build` で再生成する

## rules の書式(`references/rules-format.md`)

- [ ] `plugins/metatron/src/lib/rules.ts` の `RULES_FILES` / `RULES_ADMIN_NOTICE` / `prepareRulesUpdate` の検証
- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §5
- [ ] `plugins/metatron/references/rules-format.md`
- [ ] `plugins/metatron/docs/RULES.example.md`
- [ ] `plugins/metatron/skills/capturing-architecture/SKILL.md` のドラフト単位
- [ ] `plugins/metatron/src/__test__/section-reference-inventory.test.ts` の検出語(rules の 3 ファイル名を含む)

## GOTCHAS の書式(`references/gotchas-format.md`)

- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §7
- [ ] `plugins/metatron/skills/capturing-architecture/SKILL.md` の GOTCHAS の承認節
- [ ] `plugins/metatron/references/cli-usage.md` の `init-gotchas` の節
- [ ] codiel: `skills/orchestrating-runs/SKILL.md` の「7. 失敗の記録」の退避エントリのキー(`append-gotcha` の入力 JSON のキーと揃える。エントリ書式の写しは持たない)
- [ ] `plugins/metatron/docs/GOTCHAS.example.md` の冒頭の記入ガイド
- [ ] `plugins/metatron/skills/recording-gotchas/SKILL.md` の `description` と `## 1. 記録の可否`
- [ ] `plugins/raphael/skills/raphael/SKILL.md` と `plugins/raphael/agents/antibody-synthesizer.md`(棲み分けの節を変えたときだけ確認する)

## metatron.config.json のスキーマとパス解決規則(`references/config-schema.md`)

この規則を変更したら、次をすべて更新して 2 者比較テストを通す。

- [ ] `plugins/metatron/src/lib/config.ts`(正本の実装)
- [ ] `plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths`
- [ ] 2 者比較テスト(metatron のテスト R4 / codiel のケース 16f)

2 つのプラグインはこの規則を独立に実装している。写しが割れると、同じカレントディレクトリから別のファイルへ辿り着く。

## writing-discipline の追随(`references/writing-discipline.md`)

prompt-smith の `plugins/prompt-smith/skills/prompt-smith/SKILL.md` を改訂したら、このセクションに沿って `writing-discipline.md` を見直す。

- [ ] 削る基準・残す基準・書き方の基準・引くための記述の例外を、prompt-smith の現行規律に追随させる
- [ ] ARCHITECTURE・GOTCHAS・ADR 向けの特化(適用の強さ、例外の範囲、GOTCHAS エントリを 1〜3 文に収めること、ADR の 3 条件、図の基準)は変えない
- [ ] 引くための記述の例外は ARCHITECTURE と rules の値を引く先のブロックにだけ当て、GOTCHAS エントリには当てない
- [ ] `skills/{capturing-architecture,updating-architecture,recording-gotchas}/SKILL.md`、`references/{gotchas-format,rules-format}.md` の writing-discipline への参照が、見出し名と揃っているかを確認する
- [ ] `plugins/metatron/references/writing-discipline.md` の既存の `##` 見出しの行を変えない

## ADR の 3 条件(`references/writing-discipline.md` の「何を ADR にするか」セクション)

- [ ] `plugins/codiel/references/intent-format.md` に置いた ADR の 3 条件の写しを追随させる

## ADR 候補の取り込み(`references/architecture-format.md` の「ADR 候補の取り込み」セクション)

`[ADR 候補]` の書式と参照形の正本は codiel にある。

- [ ] `plugins/codiel/references/intent-format.md` の「## 持続層」セクションと揃っているかを確かめる
