---
name: with-grok-policy
description: Claude(Fable/Opus/Sonnet/Haiku)と Grok(ローカルプロキシ経由)を併用する構成でのエージェント運用方針。`.claude/agents/` に grok-researcher.md / grok-implementer.md が存在し、gpt-sol.md / gpt-terra.md / gpt-luna.md が存在しないプロジェクトではこちらを使う。gpt-* も揃うプロジェクトでは agent-policy:codex-grok-policy を、grok-* が無いプロジェクトでは agent-policy:with-codex-policy または agent-policy:claude-model-policy を使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude + Grok 併用)

あなたはオーケストレーターまたはそのサブエージェントである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。

## モデル別役割

| 役割                                                  | モデル             |
| ----------------------------------------------------- | ------------------ |
| 調査・分析                                            | `Opus`             |
| リアルタイム情報調査(最新動向・外部エコシステム)      | `Grok Researcher`  |
| 設計書・実装計画書(WBS)の作成                         | `Opus`             |
| コードベース探索統括                                  | `Opus`             |
| コードベース探索実働                                  | `Grok Researcher`  |
| 複雑または重要な実装                                  | `Opus`             |
| 通常の実装                                            | `Grok Implementer` |
| 軽量な実装                                            | `Grok Implementer` |
| コードレビュー                                        | `Sonnet`           |
| 設計・計画・実装のアドバイザー                        | `Fable` / `Opus`   |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku`            |
| 設計書・実装計画書の独立レビュー(前提検証・反証提示)  | `Grok Researcher`  |
| その他のタスク                                        | `Grok Implementer` |

- 通常の実装と軽量な実装はどちらも `Grok Implementer` が担い、Agent Tool の可否を分けない。`orchestration-discipline` の「軽量な実装の帯に Agent Tool を許可しない」規定は、この方針では `Grok Implementer` に適用しない。
- `Grok Researcher` と `Haiku` には Agent Tool を許可しない。
- `Grok Researcher` と `Grok Implementer` の振り分けは、ファイルを変更する作業なら Implementer、読んで報告するだけの作業なら Researcher とする。
- 「調査・分析」と「リアルタイム情報調査」は、外部の最新情報へのアクセスが主目的なら `Grok Researcher`、思考の深さが主目的なら `Opus` へ振り分ける。

## 実行帯が Grok の場合の dispatch

- 定義ファイルを持つ Agents は、定義本文(frontmatter を除く)を役割定義として依頼文に同梱し、担当 Grok エージェントへ dispatch する。
- このとき `model` 上書きは使わない。
- 依頼文に「この tools のみ使用」と明記する。
- ビルトイン Agents は使わず、担当 Grok エージェントへ直接委譲する。
- `Grok Researcher` へ dispatch するときは、依頼文の冒頭で「独立レビュー」「リアルタイム情報調査」「探索実働」のどれかを明示し、その役割の Output Format を指定する。

## 独立レビューの手順

設計書・実装計画書をユーザーへ提示する前に、次の順で実施する。

1. 「設計書・実装計画書のレビュー」帯(`Haiku`)のレビューを共通規律のとおり実施する。
2. `Grok Researcher` へ独立レビューを dispatch する。設計書・実装計画書の原本のみを読ませ、Haiku の指摘は渡さない。
3. 依頼文に「反証の提示までを担い、採否はオーケストレーターが判断する」と明記する。
4. オーケストレーターが両レビューの指摘の採否を判断し、補足修正を加えてからユーザーへ提示する。

## Grok が利用不可のときのフォールバック

- 実装帯・探索実働: `agent-policy:claude-model-policy` の担当表の同名行へ読み替える。
- 独立レビュー: 省略し、Haiku レビュー+オーケストレーター補足の既存フローで進める。`Opus` では代行しない。
- リアルタイム情報調査: 「調査・分析」帯(`Opus`)+ WebSearch で代行する。

## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. `.claude/agents/grok-researcher.md` / `grok-implementer.md` が存在すればそれを使う。
2. 存在しない、またはローカルプロキシ経由で呼び出せない場合は、ユーザーへ `agent-policy:setup-grok` の実行を案内する。生成完了(またはスキップ)までは §Grok が利用不可のときのフォールバック で運用する。
