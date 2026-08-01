# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace(`.claude-plugin/marketplace.json`)。
各プラグイン本体は `plugins/*` 配下にあります。詳細はそれぞれの `README/DESIGN` 等を参照してください。

## プラグイン開発の制約（重要）

- このリポジトリのプラグインは **Anthropic API を使用できないユーザーも使える**ことが必須要件。
- API クライアントの追加・`ANTHROPIC_API_KEY` 前提の実装・ユーザーへの CLI 直接操作の要求は、どれだけ便利に見えても採用しないこと。
- LLM が必要な処理は Claude Code の機構(メインセッション/サブエージェント)か `claude` CLI のヘッドレス実行(ユーザーの既存サブスク認証)に閉じること。
- プラグインが実行するスクリプトはTypeScriptで書くこと。ソースは `plugins/*/src/` に、バンドル出力先は `plugins/*/scripts` に、特殊な場合(server起動など) は `plugins/*/dist` にそれぞれ配置すること。
- リポジトリ運用のためのスクリプト(ルートの `scripts/`)は言語を問わない。
- バンドル出力は git 管理(プラグイン利用者はビルド不要)。ソース(`plugins/*/src/`)を変更したら `pnpm build` を実行し、生成物の差分もコミットすること。
- SKILL.md・Agents 定義の description は `optimize-agents` の `references/description-guide.md` の基準で書くこと。狙った依頼で確実に発火することを、簡潔さより優先する。
- SKILL.md の本文・その他の AI 向け指示書は `optimize-agents:prompt-smith` の基準で書くこと。

## プラグインのアップデート

- プラグインの改修を行った場合、その内容の大きさに応じて、**改修した該当プラグインの** manifest(`plugins/<plugin>/.claude-plugin/plugin.json`)のバージョンを上げるようにする（バージョンは各プラグインごとに独立）
- バージョンは `n1.n2.n3`、プレリリース時は `-alpha.n4` または `-dev` を付けた形式である。
- 自動で行うのはマイナーバージョン(n2 以降 / プレリリース番号)のアップデートのみで、変更の多さからメジャーバージョン(n1)を上げる判断をした場合は、人間に必ず確認するようにすること。

## 文書配置の運用方針

- プラグインの利用者が読まなければそのプラグインを使えない情報は `plugins/<plugin>/README.md` に置く。
- それ以外の人間向け文書(設計・背景・根拠・経緯・不採用案)は `plugins/<plugin>/docs/` に置く。
- AI が必要なときにだけ読む文書(複数のスキル・エージェントで共有する規律、参照断片)は `plugins/<plugin>/references/` に置く。

## chatファイルの運用方針

- chat-recorderエージェント / chat-readerエージェント以外は、明示されない限り `docs/chat/**/*.md` を読むことを禁止する。

## CLAUDE.md（このファイル）の運用方針

- このファイルの内容のうち `CLAUDE.example.md` にも記載がある内容を更新する場合はそちらも変更すること。
- このファイルを更新するときは必ず人間に確認をとること。

## エージェント運用方針

<!-- 記入ガイド
エージェント運用方針が記述された2つのファイルを、利用状況によってこのセクションに以下の内容をコピペしてください。
この記入ガイドは使用時には削除してください。

Claude Code only ->
- 最初に必ず `optimize-agents:claude-model-policy` スキルを使用し、この規律に従うこと。

With Codex ->
- 最初に必ず `optimize-agents:with-codex-policy` スキルを使用し、この規律に従うこと。
-->

- この方針は恒久的なものなので、Claude の設定を更新すること。

## MCPサーバー運用方針

- ライブラリやプログラミング言語などの技術スタックの調査は `Context7` を積極的に使うこと。
- リポジトリ内のファイル探索などは `Serena` を積極的に使うこと。
