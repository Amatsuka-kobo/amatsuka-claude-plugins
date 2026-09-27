# 書式・規則を変更するときのチェックリスト

gh-utility が定める書式と規則を変更したときに、同じコミットで追随させる先を並べる。
この文書は gh-utility の開発時に読む。gh-utility を利用するプロジェクトの作業では読まない。

## GitHub の執筆規則と画像の載せ方(`references/github-issue-common.md`)

- [ ] 同じ Marketplace で、GitHub の Issue・PR・コメントの執筆規則を独立に持つ別プラグインの参照文書(`references/github-writing.md`)。3 文・縮退の順序の表・`--attach` の条件・可視性の記述を揃える
- [ ] `src/check-issue-env.ts` の `remoteHost` の判定条件(`github.com` と `<名前>.ghe.com`)。ホストの判定条件を変えたら両方直す
- [ ] `README.md` の「画像の載せ方」セクション。前提と縮退の要点を利用者向けに合わせる
- [ ] `skills/{issue-craft,issue-split,issue-triage}/SKILL.md` の `## 共通規律`。参照先のパスや見出し名を変えたときだけ確認する

## 文の組み立ての規律への追随

`references/github-issue-common.md` の執筆規則のセクションは、`plugins/prompt-smith/skills/prompt-smith/SKILL.md` が定める指示書の書き方(言い切り、1 文 1 義、箇条書きと散文の使い分け、強調をしない、例の置き方、最も短い文で書く)に揃えている。

- [ ] `plugins/prompt-smith/skills/prompt-smith/SKILL.md` の規律を改訂したら、執筆規則のセクションを見直す
