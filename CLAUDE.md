# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## 前提と規律の在り処

技術スタック・レイヤー構造・ディレクトリ構成・ドメインマップ・コマンドは `harness-docs/ARCHITECTURE.md` にある。metatron の SessionStart hook がセッション開始時に全文を注入する。

注入が届いていないときは `harness-docs/ARCHITECTURE.md` を Read する。

規約・保護パス・テスト方針は `.claude/rules/metatron/` にある。Claude Code が起動時に読み込むため、Read しない。

`harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/metatron/*.md` は直接編集しない。PreToolUse hook が拒否する。更新は metatron の CLI で行う。
