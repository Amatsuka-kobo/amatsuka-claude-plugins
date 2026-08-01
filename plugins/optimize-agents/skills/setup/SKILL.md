---
name: setup
description: with-codex-policy 運用方針で使う GPT エージェント定義(gpt-sol / gpt-terra / gpt-luna)を、対話ヒアリングのうえプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「GPT エージェントをセットアップして」「optimize-agents の setup」等と明示的に依頼したときに必ず使用する。Codex 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
---

# GPT エージェント セットアップウィザード

この Skill は、`optimize-agents:with-codex-policy` 方針で使う 3 つの GPT Agent 定義(`gpt-sol` / `gpt-terra` / `gpt-luna`)を、対話ヒアリングのうえプロジェクトの `.claude/agents/` に生成する。生成するのは Markdown の Agent 定義ファイルのみであり、この Skill はプロキシや秘密値を一切管理しない。Anthropic API も使用しない。

以下の 4 ステップを順に実施する。

## ステップ 1: 前提確認

ユーザーに次を確認する(検証コマンドの実行は強制しない。確認方法の提示に留める)。

- Claude Code を、Codex 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
- そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。

確認方法の案内例(提示のみ): 「Claude Code の `/model` コマンドでモデル一覧を開き、使用予定のエイリアス(例 `claude-gpt-5-6-sol`)が候補に出るか確認してください。またはプロキシの `/v1/models` 応答に該当 id が含まれるか確認してください。」

前提が満たせない場合は「GPT Agent は起動できないため、`optimize-agents:claude-model-policy` 方針の利用を検討してください」と案内して終了できる。

## ステップ 2: エイリアス確認

3 モデルのクライアント側エイリアスをヒアリングする。次のデフォルト値を提示して確認する。

- gpt-sol → `claude-gpt-5-6-sol`
- gpt-terra → `claude-gpt-5-6-terra`
- gpt-luna → `claude-gpt-5-6-luna`

「これらはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。ユーザーが別名を使っている場合はその値を採用する。

## ステップ 3: 生成

- この Skill のベースディレクトリ配下の `assets/gpt-sol.template.md` / `assets/gpt-terra.template.md` / `assets/gpt-luna.template.md` を読み込み、本文中の `{{MODEL_ALIAS}}` を各エージェントの確定エイリアスへ置換する。
- 出力先はプロジェクトの `.claude/agents/gpt-{sol,terra,luna}.md`。`.claude/agents/` が無ければ作成する。
- 既存ファイルがある場合は、`AskUserQuestion` 等でユーザーに上書き可否を確認し、承認なしに上書きしない。ファイルごとに(または一括で)上書き / スキップを選べるようにする。既存の `gpt-*.md` が現行テンプレートと役割定義が食い違う場合(例: 本文で「設計・分析・計画は役割外」と定義しているもの、gpt-luna に「アドバイザーへの相談」節があるもの)は、上書きを推奨すると確認時に添える。

## ステップ 4: 後処理案内(自動書き込みはしない)

- `.claude/agents/` を git 追跡対象にするか gitignore するかはプロジェクト判断であることを案内する。
- CLAUDE.md への追記文例を提示のみする(自動で書き込まない):

  > エージェント運用は `optimize-agents:with-codex-policy` に従う。GPT エージェント定義は `.claude/agents/gpt-{sol,terra,luna}.md` に配置済み。

- 生成した 3 ファイルのパスと、Claude Code の再読み込みで Agent が認識される旨を報告する。
