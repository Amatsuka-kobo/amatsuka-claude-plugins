# metatron の記録のタイミングとサブエージェントへの注入 セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`(ブランチ `intent-driven-development`)である。

---

metatron に、記録のタイミングを知らせる hook、持続層の GOTCHAS 候補の走査、サブエージェントへの注入を入れる。

## 最初に読む文書

1. `harness-docs/handover/2026-10-03-metatron-recording-timing-and-subagent-injection-handover.md`(決まったこと・改修する 4 件・未決・踏みやすい点)
2. ADR-013 と ADR-007(metatron の CLI の `get adr`)
3. `plugins/codiel/references/intent-format.md` の「GOTCHAS 候補」

引き継ぎ書の「決まったこと」は再検討しない。

## 進め方

1. 引き継ぎ書の未決(作業の完了の検出、毎ターンの抑止、SubagentStart で注入できるか、移したエントリの持続層での扱い)を調べ、案を添えてユーザーに確かめる。SubagentStart の仕様は Context7 で確かめる。
2. 設計書を `harness-docs/design/` に書き、レビューを経てユーザーの承認を得てから実装する。
3. 指示書は `prompt-smith:prompt-smith` の規律で書かせる。
4. `src/` を変えたらテストを足し、`pnpm run build` の差分を同じコミットに含める。
5. ADR が要る判断は `metatron:updating-architecture` で追加する。
6. 改修ごとに分けてコミットする。

## 制約

- バージョンを上げない。`0.4.0-dev` のリリースに含める。
- ブランチを新しく切らない。PR を作らない。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行う。
- `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/` は Edit しない。
- codiel の指示層は変えない(後続の作業は codiel の引き継ぎ書で扱う)。ただし書式の契約を変えたときの `intent-format.md` と `format-change-checklist.md` の追随は行う。
- 日本語は native-japanese の規律に従う。「節」「段」「版」を使わない。
- `docs/chat/` の未コミットの変更を本件のコミットに混ぜない。

## Done の条件

- 4 件が設計書どおりに実装され、コミットされている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通る。
- hooks.json を変えたなら、新しいセッションで hook が発火することを確かめている。
- code-reviewer の critical・high が残っていない。
