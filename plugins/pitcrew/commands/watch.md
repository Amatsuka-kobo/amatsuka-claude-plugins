---
description: pitcrew のターミナル TUI ビューアの起動方法を案内する
---

pitcrew のターミナル TUI ビューア(`pitcrew watch`)の起動方法を案内してください。
**Claude 自身は起動・停止のいずれも行わないこと**(TUI はキー入力を伴う
対話型ツールのため、Claude の Bash ツールでは操作できない)。

## 手順

1. `${CLAUDE_PLUGIN_ROOT}` の絶対パスを解決する。コマンド本文中の
   `${CLAUDE_PLUGIN_ROOT}` はプラグインのルートに展開されるため、
   `echo "${CLAUDE_PLUGIN_ROOT}"` を Bash ツールで実行すれば得られる。
   プロジェクトルートは `pwd` で得る

2. 解決した絶対パスを埋め込んだ次のコマンドを提示する
   (`${...}` のままではなく、必ず展開済みの絶対パスで示すこと。
   ユーザーのターミナルではこの環境変数が定義されていないため):

   ```bash
   node "<CLAUDE_PLUGIN_ROOT の絶対パス>/scripts/watch.mjs" --dir "<プロジェクトルートの絶対パス>"
   ```

3. 併せて次を伝える:
   - 「このコマンドはあなたのターミナルで直接実行してください。TUI は
     キー入力を伴う対話型ツールのため、Claude はこの中では操作できません」
   - キー操作: `j`/`k` 移動・`c` コメント(`$EDITOR` で編集)・
     `a` 承認して既読・`q` 終了
   - コメント作成には環境変数 `$EDITOR` または `$VISUAL` の設定が必要

Claude はコマンドを Bash ツールで実行しないこと(`run_in_background` でも不可)。
