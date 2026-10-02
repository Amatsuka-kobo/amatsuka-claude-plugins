# codiel:run のコスト改修 残りの事項の起票セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`(ブランチ `intent-driven-development`)である。

---

codiel:run のコスト改修で残った 10 件の事項を、`gh-utility:issue-craft` を使って GitHub Issue に起票し終える。

## 最初に読む文書

1. `harness-docs/handover/2026-10-03-codiel-run-cost-followups-handover.md`(現在地・決まったこと・起票する事項 10 件・踏みやすい点)
2. `harness-docs/plans/2026-10-02-codiel-run-cost-plan.md` の「別の Issue にする事項」「Task 10 の結果」
3. `harness-docs/design/2026-10-02-codiel-run-cost-design.md` の §1(決定 K1〜K13)

設計の決定 K1〜K13 は再検討しない。

## 進め方

1. `gh-utility:issue-craft` を起動する。
2. 引き継ぎ書の 10 件について、まとめ方(1 件ずつか、関連するものを束ねるか)とラベルをユーザーと決める。
3. 事項 2(充足度の欠落 S1〜S17)は、引き継ぎ書の「踏みやすい点」に従って一覧を取り直してから本文を書く。
4. 各 Issue の本文に、出典(設計書・計画書・付録のセクション、ファイル:行)を書く。
5. 起票する前に、本文をユーザーに示して承認を得る。
6. 起票した Issue の番号を、計画書の「別の Issue にする事項」に書き足してコミットする。

## 制約

- 起票した Issue への対応(実装)はしない。
- ブランチを新しく切らない。PR を作らない。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行う。
- 日本語は native-japanese の規律に従う。「節」「段」「版」を使わない。
- `docs/chat/` の未コミットの変更を本件のコミットに混ぜない。

## Done の条件

- 10 件すべてが、ユーザーの承認を得た Issue に起票されている(束ねたものは、束ねた先の Issue に含まれている)。
- 計画書の「別の Issue にする事項」に、各事項の Issue 番号が書かれ、コミットされている。
