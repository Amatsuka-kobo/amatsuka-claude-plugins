# 書式・規則を変更するときのチェックリスト

codiel が定める書式を変更したときに、同じコミットで追随させる先を並べる。
この文書は codiel の開発時に読む。codiel を利用するプロジェクトの作業では読まない。

## intent 文書と intent-issue の書式(`references/intent-format.md`)

- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §9・§10
- [ ] `skills/filing-followup-issues/SKILL.md` の intent-issue の書式を扱うセクション
- [ ] `skills/syncing-intents/SKILL.md` の intent-issue の書式を扱うセクションと、持続層への取り込み(`## 意図的な制約` の表を読む箇所)
- [ ] `skills/preparing-design-agendas/SKILL.md` の `## 合意済み事項の継承`
- [ ] `skills/capturing-intent/SKILL.md` の `## 意図的な制約` と `## 合意済み事項` の書き方
- [ ] gh-utility: `skills/issue-craft/SKILL.md` の `## 持ち込みモード`

写しにはマーカーと見出し名の認識に要る最小限だけを持たせる。書き方の規律・理由・例は `references/intent-format.md` にだけ置く。

## 持続層と ADR 候補の書式(`references/intent-format.md`)

- [ ] ADR の 3 条件の写しを、metatron の `references/writing-discipline.md` の「何を ADR にするか」に揃える
- [ ] `[ADR 候補]` の書式(印・候補 ID・エントリの範囲・参照形)を、metatron の `references/architecture-format.md` の写しのセクションに揃える

## GitHub の執筆規則(`references/github-writing.md`)

- [ ] gh-utility: `references/github-issue-common.md` の「## 執筆規則」。3 文・縮退の順序の表・`--attach` の条件・可視性の記述を揃える(codiel 固有のマーカー・本文ファイルの書き方・テンプレートの扱い・PR 本文は写さない)

## 人が読む文書の共通の執筆規則(`references/readable-writing.md`)

- [ ] `references/intent-writing.md` の「## 文の組み立て」
- [ ] `references/github-writing.md` の「## 文の組み立て」
- [ ] gh-utility: `references/github-issue-common.md` の「## 執筆規則」

4 つの規則(根拠の置き場・言語を問わない書き方・翻訳・環境に固有の値)の文言を揃える。何を残し何を削るかの基準は、それぞれの規則(`intent-writing.md`・`github-writing.md`・gh-utility の `## 執筆規則` の 3 文)が個別に持つので、`readable-writing.md` の変更では追随させない。
