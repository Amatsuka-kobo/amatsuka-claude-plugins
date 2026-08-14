---
name: setup-gpt
description: with-codex-policy 運用方針で使う GPT エージェント定義(gpt-sol / gpt-terra / gpt-luna)をプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「GPT エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したときに必ず使用する。通常は対話でエイリアスと上書き可否を確認し、`--yes` を渡されたときは確認せず既定エイリアスで全ファイルを上書きする。Codex 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *)
---
# GPT エージェント セットアップウィザード

生成するのは Markdown の Agent 定義ファイルのみであり、プロキシや秘密値は一切管理しない。

## 非対話モード

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従う。対話モードの手順は実施しない。

- 次のコマンドを 1 回実行する。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --profile gpt --overwrite
  ```

- ユーザーへの確認は行わず、既定エイリアスで 3 ファイルすべてを上書きする。
- `--alias` と `--check` は使わない。
- `ok: true` のときは、`agents[]` の `name` と `path` と `action` を報告して終了する。
- `ok: false` のときは、`error` をそのまま報告して終了する。

## 対話モードの手順

`$ARGUMENTS` に `--yes` が含まれないときは、以下の 4 ステップを順に実施する。

### ステップ 1: 前提確認

ユーザーに次を確認する。検証コマンドは実行させず、確認方法の提示に留める。

- Claude Code を、Codex 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
- そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。

前提が満たせない場合は「GPT Agent は起動できないため、`agent-policy:claude-model-policy` 方針の利用を検討してください」と案内し、ユーザーが続行を求めない限りステップ 2 へ進まず終了する。

### ステップ 2: エイリアス確認

3 モデルのクライアント側エイリアスをヒアリングする。次のデフォルト値を提示して確認する。

- gpt-sol → `claude-gpt-5-6-sol`
- gpt-terra → `claude-gpt-5-6-terra`
- gpt-luna → `claude-gpt-5-6-luna`

「これらはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。ユーザーが別名を使っている場合はその値を採用する。

### ステップ 3: 生成

- ステップ 2 で既定と異なるエイリアスが確定したときは、この節のすべてのコマンドに `--alias <name>=<alias>` を対象ごとに付ける。`<name>` は `gpt-sol` / `gpt-terra` / `gpt-luna` のいずれか。
- 次のコマンドで現状を取得する。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --profile gpt --check
  ```

- 出力先は git リポジトリのルート直下の `.claude/agents/`、git 管理外のディレクトリでは cwd 直下になる。この解決と `.claude/agents/` の作成はスクリプトが行う。
- `exists: true` のエージェントが 1 つも無ければ、確認を挟まず全件を書き込む。
- `exists: true` のエージェントがあるときは、`AskUserQuestion` で上書き可否を確認する。
- 上書き / スキップは、ファイルごとと一括の双方を選べるようにする。
- `upToDate: false` の既存には、現行テンプレートと内容が食い違うため上書きを推奨すると添える。
- 承認された対象だけを次のコマンドで書き込む。`<csv>` は対象の `name` をカンマ区切りで並べる。

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --profile gpt --agents <csv> --overwrite
  ```

### ステップ 4: 後処理案内

- `.claude/agents/` を git 追跡対象にするか gitignore するかはプロジェクト判断であることを案内する。
- CLAUDE.md への追記文例を提示する。自動では書き込まない。
  > - 最初に必ず `agent-policy:with-codex-policy`スキルを使用し、この規律に従う。
  >
  > - この方針は恒久的なものなので、Claude の設定を更新する。
- 生成したファイルのパスと、Claude Code の再読み込みで Agent が認識される旨を報告する。
