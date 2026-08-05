---
name: with-codex-policy
description: Claude(Fable/Opus/Sonnet/Haiku)と Codex 系 GPT モデル(Sol/Terra/Luna、ローカルプロキシ経由)を併用する構成でのエージェント運用方針。`.claude/agents/` に gpt-sol.md / gpt-terra.md / gpt-luna.md が存在するプロジェクトではこちらを使い、存在しないプロジェクトでは代わりに agent-policy:claude-model-policy を使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude + Codex 併用)

あなたはオーケストレーターまたはそのサブエージェントである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。

## モデル別役割

| 役割                                                  | モデル                   |
| ----------------------------------------------------- | ------------------------ |
| 調査・分析                                            | `Opus`                   |
| 設計書・実装計画書(WBS)の作成                         | `Opus`                   |
| コードベース探索統括                                  | `Opus`                   |
| コードベース探索実働                                  | `GPT Terra` / `GPT Luna` |
| 複雑または重要な実装                                  | `GPT Sol`                |
| 通常の実装                                            | `GPT Terra`              |
| 軽量な実装                                            | `GPT Luna`               |
| コードレビュー                                        | `Sonnet`                 |
| 設計・計画・実装のアドバイザー                        | `Fable` / `Opus`         |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku`                  |
| その他のタスク                                        | `GPT Terra`              |

`orchestration-discipline` の「軽量な実装」の帯として扱うのは `GPT Luna` と `Haiku` である。この 2 つには Agent Tool を許可しない。

## 実行帯が GPT モデルの場合の dispatch

- 定義ファイルを持つ Agents は、定義本文(frontmatter を除く)を役割定義として依頼文に同梱し、担当 GPT エージェントへ dispatch する。
- このとき `model` 上書きは使わない。
- 依頼文に「この tools のみ使用」と明記する。
- ビルトイン Agents は使わず、担当 GPT エージェントへ直接委譲する。
- GPT が利用不可なら、§実行帯の解決順 で決まる代替帯を担当表として用い、dispatch 時の `model` 上書きで実行帯を明示する。

## 実行帯の解決順

実務タスク着手前に確認し、上から順に適用する。1 で解決したときはフォールバックではない。

1. `.claude/agents/gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` が存在すればそれを使う。
2. 存在しない、またはローカルプロキシ経由で呼び出せない場合は、`codex@openapi-codex` プラグインを使う: `/codex:rescue --model gpt-5.6-sol`/ `--model gpt-5.6-terra`/ `--model gpt-5.6-luna`。
3. どちらも不可なら、ユーザーへ `agent-policy:setup-gpt` の実行を案内する。生成完了(またはスキップ)までは `agent-policy:claude-model-policy` の担当表で一時的に代行する。
