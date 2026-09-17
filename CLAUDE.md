# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## スクリプトツール

- セッション内で使用する、一時スクリプト以外のツールは `Python` で作成し、`tools/` に配置する。
- ユーザーが手動で実行するためのツールは `ShellScript` で作成し、`scripts/` に配置する。

## git の運用

- ブランチを切らない。切る必要があると判断したときは git worktree を使い、worktree 内で `scripts/setup-workspace.sh` を使用する。

## goal コマンド

- goal コマンドとは、Claude Code の公式スラッシュコマンドである。
- 引数としてそのセッションにおけるゴールを設定し、それが達成するまで動き続ける。
- 渡せるプロンプトは4000文字までである。

## セッションの引継ぎ

- ユーザーから引継ぎを行う趣旨の発話があった場合は、引継ぎ資料と goal コマンドによる実装プロンプトを出力する。
- 引継ぎ資料は `harness-docs/handover/` に、実装プロンプトは `docs/prompts/` に作成する。
- 2つの文書の形式は既にあるものに合わせる。

## モデルの通信エラーが起きた時

- 起動したサブエージェントが失敗したときなど、Claude CodeのAPI通信やモデルに関する問題が起きた時はどのような場合でもまずCLIProxyAPIを疑い、調査を行う。
- 調査結果を `docs/cliproxyapi/` にまとめ、`docs/cliproxyapi/README.md` の表に追記する。