# 規約

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

## 探索と編集

- コードベースの探索は Serena のシンボルツールで行う。0 件でも結論にせず Grep で裏を取る。
- TypeScript / JavaScript / Markdown / Python の作成と編集は Serena の編集ツールで行う。
- ライブラリ・フレームワーク・CLI・API の仕様、セットアップ手順、コード生成の方法が要るときは Context7 で取る。Web 検索より優先する。

## プラグインのバージョン

プラグインのバージョンは、以下の規則によって決定する。

- 形式は `x1.x2.x3` とし、x1はメジャーバージョン、x2はマイナーバージョン、x3はパッチバージョンと呼称する。
- 開発中のプラグインは末尾に `-dev` と付け、付けていないものはリリース済みのものである。
- プラグインを改修したときはパッチバージョンを上げ、大規模で影響範囲が広い時はマイナーバージョンを上げる。

## 文書配置

- プラグインの利用者が読まないと使えない情報は `plugins/<plugin>/README.md` に置く。
- プラグインの設計・背景・根拠・経緯・不採用案が必要な時は `plugins/<plugin>/docs/` に置く。
- 設計書と実装計画書、その他主な読者がAIである文書は `harness-docs/` に置く。
- プラグインに関わる ADR は、タイトルを `[<プラグイン名>] <タイトル>` の形にする。

## AI 向けの指示書

以下に挙げる文書は AI 向けの指示書であり、作成・編集するときは必ず `prompt-smith` プラグインを使用し、その規律にしたがう。

- `CLAUDE.md`
- `docs/prompts/`
- `harness-docs/`
- `.claude/rules/` 
- `.claude/agents/` 
- `.claude/output-styles/`
- `SKILL.md` 
- `plugins/<plugin>/references/`

## Done の条件

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通る。
- `plugins/*/src/` を変更したなら `pnpm run build` を実行し、`plugins/*/scripts/` の差分が同じコミットにある。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが揃って上がっている。
- プラグインを追加または改修したなら、ルートの `README.md` に反映されている。
- ARCHITECTURE に影響する変更をしたなら、`/metatron:update` で追随させている。
- 改修した内容が `.serena/memories/` の記述と食い違うなら、該当メモリを更新している。
- 編集内容を適切に分けて git にコミットしている。
