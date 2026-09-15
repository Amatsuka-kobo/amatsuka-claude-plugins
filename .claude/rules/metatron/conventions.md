# 規約

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

## 探索と編集

- コードベースの探索は Serena のシンボルツールで行う。0 件でも結論にせず Grep で裏を取る。
- TypeScript / JavaScript / Markdown / Python の作成と編集は Serena の編集ツールで行う。
- ライブラリ・フレームワーク・CLI・API の仕様、セットアップ手順、コード生成の方法が要るときは Context7 で取る。Web 検索より優先する。

## プラグイン開発

- Anthropic API のクライアントを追加しない。`ANTHROPIC_API_KEY` を前提にした実装をしない。ユーザーに CLI の直接操作を要求しない。LLM が必要な処理は Claude Code の機構か `claude` CLI のヘッドレス実行で行う。
- プラグインが実行するスクリプトは TypeScript で書く。
- Agents 定義は `prompt-smith:agent-creator` で作る。
- Skills は `prompt-smith:skill-creator` で作る。
- その他の AI 向け指示書は `prompt-smith:prompt-smith` で作る。
- プラグインを追加するときは `.claude-plugin/marketplace.json` に登録し、`plugins/<plugin>/.claude-plugin/plugin.json` を作る。スクリプトを持つプラグインは `pnpm-workspace.yaml` の `packages` に追記する。
- プラグインは他プラグインの存在を前提とせず、単体で使えるようにする。skills / agents / commands / references に他プラグインの名前を書かない。

## 文書配置

- 利用者が読まないと使えない情報は `plugins/<plugin>/README.md` に置く。
- 設計・背景・根拠・経緯・不採用案が必要な時は `plugins/<plugin>/docs/` に置く。
- 複数のスキルとエージェントで共有する規律と参照断片は `plugins/<plugin>/references/` に置く。
- 設計書と実装計画書は `harness-docs/` に置く。
- プラグインに関わる ADR は、タイトルを `[<プラグイン名>] <タイトル>` の形にする。

## Done の条件

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通る。
- `plugins/*/src/` を変更したなら `pnpm run build` を実行し、`plugins/*/scripts/` の差分が同じコミットにある。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが揃って上がっている。
- プラグインを追加または改修したなら、ルートの `README.md` に反映されている。
- ARCHITECTURE に影響する変更をしたなら、`/metatron:update` で追随させている。
- 改修した内容が `.serena/memories/` の記述と食い違うなら、該当メモリを更新している。
