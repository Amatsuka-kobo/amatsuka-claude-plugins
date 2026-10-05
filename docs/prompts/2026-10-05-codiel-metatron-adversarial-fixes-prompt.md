# codiel・metatron 敵対的レビューの所見の修正 セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`(ブランチ `intent-driven-development`)である。

---

codiel と metatron の敵対的レビューで出た所見を、設計・実装まで進める。

## 最初に読む文書

1. `harness-docs/handover/2026-10-05-codiel-metatron-adversarial-fixes-handover.md`(決まったこと・未決のこと・踏みやすい点)
2. `harness-docs/design/2026-10-05-codiel-metatron-adversarial-review-findings.md`(所見一覧)
3. ADR-011・ADR-013・ADR-014(metatron の CLI の `get adr`)

引き継ぎ書の「決まったこと」は再検討しない。

## 進め方

1. 引き継ぎ書の「未決のこと」をユーザーに確かめる。今回直す所見の範囲と、ガードの保証範囲の方針を先に決める。
2. 「確認」列が「未実行」の所見のうち、今回直すものは、再現するか該当行を読んで裏を取ってから設計に入れる。再現できなかった所見は一覧の「採否」に理由を書く。
3. 設計書を `harness-docs/design/` に書く。所見一覧の「採否」列を埋め、根が同じ組をまとめて扱う。
4. 設計書は knowledge-elicitationer → docs-reviewer の順にレビューにかけ、ユーザーの承認を得てから実装する。
5. R2-01 を最初に実装する。以降は一覧の章の順に進める。
6. `src/` を変えたら、所見の再現手順を失敗するテストとして先に足してから直す。`pnpm run build` の差分を同じコミットに含める。
7. 指示書は `prompt-smith:prompt-smith` の規律で書かせる。
8. ADR が要る判断は `metatron:updating-architecture` で追加する。
9. 所見の組ごとに分けてコミットする。
10. 敵対的レビューを委譲するときは、依頼文に攻撃寄りの語を使わず、「文書が述べる保証とコードの食い違いを探す」と書く。

## 制約

- 既知の限界と重なる所見は、設計書の判断を覆さない。不採用案(metatron の hook で Bash を捕捉する案など)を再提案しない。
- codiel は 1.0.0 のリリースに含め、バージョンを上げない。metatron は規約どおりパッチを上げ、`plugin.json` と `package.json` を揃える。
- ブランチを新しく切らない。PR を作らない。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行う。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/` は Edit しない。
- 日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。
- `docs/chat/` の未コミットの変更を本件のコミットに混ぜない。

## Done の条件

- 今回直すと決めた所見が、設計書どおりに実装されてコミットされている。直さない所見は、理由が所見一覧の「採否」に書かれている。
- R2-01 の再現手順(未追跡の `.gitattributes` に `* -diff`)で、コードゲートが STOP を返す。
- 直した所見の再現手順が、それぞれテストとして失敗から成功に変わっている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通る。
- 修正した範囲に敵対的レビューを当て直し、critical・high が残っていない。
- code-reviewer の critical・high が残っていない。
