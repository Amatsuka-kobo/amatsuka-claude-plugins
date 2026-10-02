# codiel:run のコスト改修 残りの改修セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`(ブランチ `intent-driven-development`)である。

---

codiel:run のコスト改修で残った 9 件の改修を、すべて完了させる。

## 最初に読む文書

1. `harness-docs/handover/2026-10-03-codiel-run-cost-followups-impl-handover.md`(現在地・決まったこと・改修する 9 件・S1〜S17 の一覧・踏みやすい点)
2. `harness-docs/design/2026-10-02-codiel-run-cost-design.md` の §1(決定 K1〜K13)
3. `plugins/codiel/skills/orchestrating-runs/SKILL.md` の §2「手順ファイルと読む契機」と §3

設計の決定 K1〜K13 は再検討しない。

## 進め方

1. バージョンを上げるかをユーザーに確かめる。
2. 9 件を、触るファイルが重ならない組に分けて委譲する。
3. 指示書は `prompt-smith:prompt-smith` の規律で書かせる。
4. description は `prompt-smith:skill-creator` の規律で書かせる。
5. 改修 2(S1〜S17)と改修 5(finalize の後の compaction)で、決め方が 1 つに定まらないものは、案を添えてユーザーに確かめてから委譲する。
6. 改修 4(ARCHITECTURE)は、`metatron:updating-architecture` を起動して行う。
7. 改修 3(`src/`)は、テストを足し、`pnpm run build` の差分を同じコミットに含める。
8. すべての改修の後、4 つのスキルに prompt-smith の評価を当て、差分を code-reviewer の役割にレビューさせる。採った所見を直す。
9. 改修ごとに分けてコミットする。

## 制約

- Issue を起票しない。
- ブランチを新しく切らない。
- PR を作らない。
- run のターン数を減らす改修は範囲外として扱い、思いついた案は完了報告に書く。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行う。
- `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/` は Edit しない。
- 日本語は native-japanese の規律に従う。「節」「段」「版」を使わない。
- `docs/chat/` の未コミットの変更を本件のコミットに混ぜない。

## Done の条件

- 9 件すべてが引き継ぎ書の内容どおりに直り、コミットされている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通る。
- prompt-smith の評価で、`orchestrating-runs`・`raguel-gating`・`reviewing-diffs`・`capturing-intent` の充足度の評点が、引き継ぎ書の基準より下がっていない。
- code-reviewer の critical・high が残っていない。
- 計画書の「別の Issue にする事項」の各項目に、直したコミットが書かれている。
