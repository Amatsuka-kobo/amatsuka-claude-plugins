# 書式・規則を変更するときのチェックリスト

gh-utility が定める書式と規則を変更したときに、同じコミットで追随させる先を並べる。
この文書は gh-utility の開発時に読む。gh-utility を利用するプロジェクトの作業では読まない。

## GitHub の執筆規則と画像の載せ方(`references/github-issue-common.md`)

- [ ] 同じ Marketplace で、GitHub の Issue・PR・コメントの執筆規則を独立に持つ別プラグインの参照文書(`references/github-writing.md` の 3 文と、`references/github-writing-images.md` の縮退の順序の表・`--attach` の条件・可視性の記述。PR 本文の `references/github-writing-pr.md` は写さない)。両方を揃える
- [ ] 同じ Marketplace で、人が読む文書の共通の執筆規則を独立に持つ別プラグインの参照文書(`references/readable-writing.md`)。根拠の置き場・言語を問わない書き方・翻訳・環境に固有の値の 4 つの規則の文言を揃える
- [ ] `src/check-issue-env.ts` の `remoteHost` の判定条件(`github.com` と `<名前>.ghe.com`)。ホストの判定条件を変えたら両方直す
- [ ] `README.md` の「画像の載せ方」セクション。前提と縮退の要点を利用者向けに合わせる
- [ ] `skills/{issue-craft,issue-split,issue-triage}/SKILL.md` の `## 共通規律`。参照先のパスや見出し名を変えたときだけ確認する

## 文の組み立ての規律への追随

`references/github-issue-common.md` の「## 執筆規則」の文の組み立ては、上の `references/readable-writing.md` に揃えている。何を残し何を削るかは、「## 執筆規則」の 3 文が独立に持つので、`readable-writing.md` の変更では追随させない。

- [ ] 揃える先の `references/readable-writing.md` を改訂したら、`references/github-issue-common.md` の「## 執筆規則」を見直す
