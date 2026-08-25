# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## 前提と規律の在り処

- 技術スタック・レイヤー構造・ディレクトリ構成・ドメインマップ・コマンドは `harness-docs/ARCHITECTURE.md` にあり、SessionStart hook が全文を注入する。
- 注入が届いていないときは `harness-docs/ARCHITECTURE.md` を Read する。
- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/metatron/*.md` は直接編集せず、metatron の CLI で更新する。

## スクリプトツール

- セッション内で使用する、一時スクリプト以外のツールは `Python` で作成し、`tools/` に配置する。
- ユーザーが手動で実行するためのツールは `ShellScript` で作成し、`scripts/` に配置する。