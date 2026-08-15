---
name: claude-model-policy
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。`AMATSUKA_AGENT_AUTO_INJECTION` が `claude` のときに使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude のみ)

あなたはオーケストレーターまたはそのサブエージェントである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。

## モデル別役割

| 役割                                                  | モデル              |
| ----------------------------------------------------- | ------------------- |
| 調査・分析                                            | `Opus`              |
| リアルタイム情報調査(最新動向・外部エコシステム)      | `Claude Researcher` |
| 設計書・実装計画書(WBS)の作成                         | `Opus`              |
| コードベース探索統括                                  | `Opus`              |
| コードベース探索実働                                  | `Claude Researcher` |
| 複雑または重要な実装                                  | `Opus`              |
| 通常の実装                                            | `Sonnet`            |
| 軽量な実装                                            | `Haiku`             |
| コードレビュー                                        | `Sonnet`            |
| 設計・計画・実装のアドバイザー                        | `Fable` / `Opus`    |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku`             |
| 設計書・実装計画書の独立レビュー(前提検証・反証提示)  | `Claude Researcher` |
| その他のタスク                                        | `Sonnet`            |

- `Claude Researcher` と `Haiku` には Agent Tool を許可しない。
- 「調査・分析」と「リアルタイム情報調査」は、外部の最新情報へのアクセスが主目的なら `Claude Researcher`、思考の深さが主目的なら `Opus` へ振り分ける。
- `Claude Researcher` はオーケストレーターと同一ベンダーであるため、独立レビューの独立性は限定的である。文書の原本のみを読ませ、他レビューの指摘を渡さない運用でこれを補う。

## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. プロジェクトの `.claude/agents/claude-researcher.md` が存在すればそれを使う。環境変数で既定と異なるエイリアスを指定したときは、SessionStart フックがここへ定義を生成する。
2. 存在しなければ、プラグイン同梱の `agent-policy:claude-researcher` を使う。
