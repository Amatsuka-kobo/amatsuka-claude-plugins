---
name: codex-grok-policy
description: Claude(Fable/Opus/Sonnet/Haiku)と Codex 系 GPT モデル(Sol/Terra/Luna)に加え、Grok(ローカルプロキシ経由)を独立レビュー・リアルタイム情報調査に用いる三社構成でのエージェント運用方針。`AMATSUKA_AGENT_AUTO_INJECTION` が `with-codex-grok` のときに使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude + Codex + Grok 併用)

あなたはオーケストレーターまたはそのサブエージェントである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。

## モデル別役割

| 役割                                                  | モデル                   |
| ----------------------------------------------------- | ------------------------ |
| 調査・分析                                            | `Opus`                   |
| リアルタイム情報調査(最新動向・外部エコシステム)      | `Grok Researcher`        |
| 設計書・実装計画書(WBS)の作成                         | `Opus`                   |
| コードベース探索統括                                  | `Opus`                   |
| コードベース探索実働                                  | `Grok Researcher`        |
| 複雑または重要な実装                                  | `GPT Sol`                |
| 通常の実装                                            | `GPT Terra`              |
| 軽量な実装                                            | `GPT Luna`               |
| コードレビュー                                        | `Sonnet`                 |
| 設計・計画・実装のアドバイザー                        | `Fable` / `Opus`         |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku`                  |
| 設計書・実装計画書の独立レビュー(前提検証・反証提示)  | `Grok Researcher`        |
| その他のタスク                                        | `GPT Terra`              |

- `orchestration-discipline` の「軽量な実装」の帯として扱うのは `GPT Luna` と `Haiku` である。この 2 つには Agent Tool を許可しない。
- `Grok Researcher` にも Agent Tool を許可しない。
- 「調査・分析」と「リアルタイム情報調査」は、外部の最新情報へのアクセスが主目的なら `Grok Researcher`、思考の深さが主目的なら `Opus` へ振り分ける。

## 実行帯が GPT モデルの場合の dispatch

- 定義ファイルを持つ Agents は、定義本文(frontmatter を除く)を役割定義として依頼文に同梱し、担当 GPT エージェントへ dispatch する。
- このとき `model` 上書きは使わない。
- 依頼文に「この tools のみ使用」と明記する。
- ビルトイン Agents は使わず、担当 GPT エージェントへ直接委譲する。
- GPT が利用不可なら、§実行帯の解決順 で決まる代替帯を担当表として用い、dispatch 時の `model` 上書きで実行帯を明示する。

## 実行帯が Grok の場合の dispatch

- 定義ファイルを持つ Agents は、定義本文(frontmatter を除く)を役割定義として依頼文に同梱し、`grok-researcher` エージェントへ dispatch する。
- このとき `model` 上書きは使わない。
- 依頼文の冒頭で「独立レビュー」「リアルタイム情報調査」のどちらの役割かを明示し、その役割の Output Format を指定する。

## 独立レビューの手順

設計書・実装計画書をユーザーへ提示する前に、次の順で実施する。

1. 「設計書・実装計画書のレビュー」帯(`Haiku`)のレビューを共通規律のとおり実施する。
2. `Grok Researcher` へ独立レビューを dispatch する。設計書・実装計画書の原本のみを読ませ、Haiku の指摘は渡さない。
3. 依頼文に「反証の提示までを担い、採否はオーケストレーターが判断する」と明記する。
4. オーケストレーターが両レビューの指摘の採否を判断し、補足修正を加えてからユーザーへ提示する。

## Grok が利用不可のときのフォールバック

- 独立レビュー: 省略し、Haiku レビュー+オーケストレーター補足の既存フローで進める。`Opus` では代行しない。
- リアルタイム情報調査: 「調査・分析」帯(`Opus`)+ WebSearch で代行する。
- 探索実働: `GPT Terra` / `GPT Luna` へ読み替える。

## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

GPT の帯は、次のとおり解決する。

1. プロジェクトの `.claude/agents/gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` / `gpt-researcher.md` が存在すればそれを使う。環境変数で既定と異なるエイリアスを指定したときは、SessionStart フックがここへ定義を生成する。
2. 存在しなければ、プラグイン同梱の `agent-policy:gpt-sol` / `agent-policy:gpt-terra` / `agent-policy:gpt-luna` / `agent-policy:gpt-researcher` を使う。
3. ローカルプロキシ経由で呼び出せないときは、`codex@openapi-codex` プラグイン(`/codex:rescue --model gpt-5.6-sol` / `--model gpt-5.6-terra` / `--model gpt-5.6-luna`)を使う。それも不可なら `agent-policy:claude-model-policy` の担当表へ読み替える。

Grok の帯は、次のとおり解決する。

1. プロジェクトの `.claude/agents/grok-researcher.md` が存在すればそれを使う。環境変数で既定と異なるエイリアスを指定したときは、SessionStart フックがここへ定義を生成する。
2. 存在しなければ、プラグイン同梱の `agent-policy:grok-researcher` を使う。
3. ローカルプロキシ経由で呼び出せないときは、§Grok が利用不可のときのフォールバック に従う。
