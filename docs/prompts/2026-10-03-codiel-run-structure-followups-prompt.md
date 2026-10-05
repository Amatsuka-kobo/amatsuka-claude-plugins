# codiel の run の構造に関わる残りの改修 セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`(ブランチ `intent-driven-development`)である。

---

codiel の run の構造に関わる残りの 5 件を、検討・設計・実装まで進める。

## 最初に読む文書

1. `harness-docs/handover/2026-10-03-codiel-run-structure-followups-handover.md`(決まったこと・改修する 5 件・踏みやすい点)
2. ADR-006・ADR-009・ADR-013(metatron の CLI の `get adr`)
3. `plugins/codiel/skills/orchestrating-runs/SKILL.md` の §0・§1・§2「手順ファイルと読む時点」・§3

引き継ぎ書の「決まったこと」は再検討しない。

## 進め方

1. 改修 1(ブランチの 1 本化)は、論点と案を整理し、ユーザーに確かめてから設計する。改修 2 は改修 1 の結論の後に決める。
2. 改修 3 と 5 は、案を添えてユーザーに確かめる。
3. 改修 4 は、metatron の SubagentStart の注入がコミットされているかを確かめ、無ければ着手せず完了報告に書く。
4. 設計書を `harness-docs/design/` に書き、レビューを経てユーザーの承認を得てから実装する。
5. 指示書は `prompt-smith:prompt-smith` の規律で書かせる。
6. `src/` を変えたらテストを足し、`pnpm run build` の差分を同じコミットに含める。
7. ADR が要る判断は `metatron:updating-architecture` で追加する。
8. 改修ごとに分けてコミットする。

## 制約

- バージョンを上げない。codiel の 1.0.0 のリリースに含める。
- ブランチを新しく切らない。PR を作らない。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行う。
- `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/` は Edit しない。
- 日本語は native-japanese の規律に従う。「節」「段」「版」を使わない。
- `docs/chat/` の未コミットの変更を本件のコミットに混ぜない。

## Done の条件

- 5 件それぞれが、設計書どおりに実装されてコミットされているか、着手しない理由が完了報告に書かれている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通る。
- 変更したスキルに prompt-smith の評価を当て、充足度の評点が変更前より下がっていない。
- code-reviewer の critical・high が残っていない。
