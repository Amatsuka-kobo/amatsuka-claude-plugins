# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## スクリプトツール

- セッション内で使用する、一時スクリプト以外のツールは `Python` で作成し、`tools/` に配置する。
- ユーザーが手動で実行するためのツールは `ShellScript` で作成し、`scripts/` に配置する。

## git の運用

- ブランチを切らない。切る必要があると判断したときは git worktree を使い、worktree 内で `scripts/setup-workspace.sh` を使用する。