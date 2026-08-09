---
name: setup-grok
description: codex-grok-policy / with-grok-policy 運用方針で使う Grok エージェント定義(grok-researcher / grok-implementer)を、対話ヒアリングのうえプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「Grok エージェントをセットアップして」「setup-grok を実行して」等と明示的に依頼したとき、または各方針が定義ファイル不在時に案内したときに必ず使用する。Grok 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
---
# Grok エージェント セットアップウィザード

生成するのは Markdown の Agent 定義ファイルのみであり、プロキシや秘密値は一切管理しない。

以下の 4 ステップを順に実施する。

## ステップ 1: 前提確認

ユーザーに次を確認する。検証コマンドは実行させず、確認方法の提示に留める。

- Claude Code を、Grok 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
- そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。

前提が満たせない場合は「Grok Agent は起動できないため、Grok 帯はフォールバック運用(独立レビュー省略・リアルタイム調査は Opus 代行)になります」と案内し、ユーザーが続行を求めない限りステップ 2 へ進まず終了する。

## ステップ 2: エイリアス確認

Grok モデルのクライアント側エイリアスをヒアリングする。次のデフォルト値を提示して確認する。

- grok → `claude-grok-4-5`

「これはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。ユーザーが別名を使っている場合はその値を採用する。

確定したエイリアスは 2 つの定義ファイル双方に適用する。定義ごとには尋ねない。

## ステップ 3: 生成

- この Skill のベースディレクトリ配下の `assets/grok-researcher.template.md` と `assets/grok-implementer.template.md` を読み込み、本文中の `{{MODEL_ALIAS}}` を確定エイリアスへ置換する。
- 出力先は git リポジトリのルート直下の `.claude/agents/grok-researcher.md` と `.claude/agents/grok-implementer.md`。git 管理外のディレクトリでは cwd 直下に置く。`.claude/agents/` が無ければ作成する。
- 既存ファイルがある場合は、`AskUserQuestion` でユーザーに上書き可否を確認する。
- 上書き / スキップは、ファイルごとと一括の双方を選べるようにする。
- 既存ファイルの役割定義が現行テンプレートと食い違う場合は、上書きを推奨すると確認時に添える。

## ステップ 4: 後処理案内

- `.claude/agents/` を git 追跡対象にするか gitignore するかはプロジェクト判断であることを案内する。

CLAUDE.md への追記文例を提示する。自動では書き込まない

> - 最初に必ず `agent-policy:with-grok-policy`スキルを使用し、この規律に従う。
>
> - この方針は恒久的なものなので、Cluade の設定を更新する。 

- GPT エージェント定義がある場合は `agent-policy:codex-grok-policy`、無い場合は `agent-policy:with-grok-policy` を文例の方針名に用いる。
- GPT エージェント定義が未生成で、Codex 系モデルも使える環境の場合は、`agent-policy:setup-gpt` の実行も案内する。
- 生成した 2 ファイルのパスと、Claude Code の再読み込みで Agent が認識される旨を報告する。

