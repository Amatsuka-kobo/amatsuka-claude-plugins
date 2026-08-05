---
name: claude-model-policy
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。`.claude/agents/` に gpt-sol.md / gpt-terra.md / gpt-luna.md が存在しないプロジェクトではこちらを使い、存在するプロジェクトでは代わりに agent-policy:with-codex-policy を使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude のみ)

あなたはオーケストレーターまたはそのサブエージェントである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。

## モデル別役割

| 役割                                                  | モデル             |
| ----------------------------------------------------- | ------------------ |
| 調査・分析                                            | `Opus`             |
| 設計書・実装計画書(WBS)の作成                         | `Opus`             |
| コードベース探索統括                                  | `Opus`             |
| コードベース探索実働                                  | `Sonnet` / `Haiku` |
| 複雑または重要な実装                                  | `Opus`             |
| 通常の実装                                            | `Sonnet`           |
| 軽量な実装                                            | `Haiku`            |
| コードレビュー                                        | `Sonnet`           |
| 設計・計画・実装のアドバイザー                        | `Fable` / `Opus`   |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku`            |
| その他のタスク                                        | `Sonnet`           |
