---
description: pitcrew のブラウザビューアを起動し、レビュー用 URL を表示する
---

pitcrew のブラウザビューア(ローカル HTTP サーバー)を起動してください。
以下の手順に厳密に従うこと。

## 手順

### 1. 既存サーバーの確認

`.pitcrew/serve.json` があれば読み、`pid` のプロセスが生きているか確認する
(`kill -0 <pid>` の成功で判定。Claude Code の Bash ツールは Windows でも
Git Bash / WSL 経由で `kill` が使えるため、これで統一する)。

- 生きていれば新たに起動せず、`serve.json` の `url` を「すでに起動しています」と
  ユーザーに提示して終了する
- 死んでいれば残留ファイルなので気にせず次へ進む(起動時に上書きされる)

### 2. 起動

Bash ツールで次を実行する(`run_in_background: true` を必ず使う。
フォアグラウンド実行するとセッションが止まる):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" --dir "$(pwd)"
```

- ポートは `.claude/pitcrew.local.md` の `port`(既定 7373)が使われる。
  ユーザーが引数でポートを指定した場合のみ `--port <n>` を付ける

### 3. URL の提示

起動後、`.pitcrew/serve.json` が生成されるまで待つ(1 秒間隔で最大 10 秒、
Bash の `until` ループで確認)。生成されたら `url` を読み取り、ユーザーに提示する:

- 「ブラウザで次の URL を開いてください: <url>」
- 「トークン付き URL なのでこのまま開けます。サーバーは localhost のみで待ち受けています」
- 「停止するときは `/pitcrew:serve stop` と依頼してください」

10 秒待っても `serve.json` が無い場合は、バックグラウンドタスクの出力を確認して
エラー内容(ポート使用中など)をユーザーに伝える。ポート使用中の場合は
`/pitcrew:config` でのポート変更を案内する。

### 4. 停止(ユーザーが "stop" を指定した場合)

引数に `stop` が含まれる場合は起動ではなく停止を行う:

1. `.pitcrew/serve.json` の `pid` を読み、`kill <pid>` で SIGTERM を送る
   (サーバー側が serve.json を削除して終了する)
2. `serve.json` が無い・プロセスが既に無い場合は「起動していません」と伝える
