# agent-policy Codex モデル定義の確認

- 日付: 2026-08-26
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: agent-policy モデル定義の確定
- 前提: agent-policy プラグインのドキュメント

---

## セッション 1: Codex モデル定義名の確認（Terra/Grok）

# AI

表示・生成、ja 使用。

GPT(Codex系)・Grok 併用ポリシー。各ベンダー前提確認:

- **GPT**: Claude Code が gpt-sol/terra/luna 配信ローカルプロキシ経由起動か。プロキシ `/v1/models` 応答に使用予定エイリアスあるか。
- **Grok**: 同様に grok 配信ローカルプロキシ経由起動か。`/v1/models` に grok エイリアスあるか。

コマンド実行不要。現況のみ確認。

全モデル既存定義なし → 全部新規。

| モデル | 定義名 | model値 | 役割 |
|---|---|---|---|
| Sonnet | sonnet-code-reviewer | sonnet | コードレビュー |
| Haiku | haiku-reviewer | haiku | 設計書・計画書レビュー |
| Fable | fable-adviser | fable | アドバイザー |
| GPT Sol | gpt-sol-lead-implementer | claude-gpt-5-6-sol | 複雑・重要実装 |
| GPT Terra | gpt-terra | claude-gpt-5-6-terra | 通常実装・その他タスク |
| GPT Luna | gpt-luna-light-implementer | claude-gpt-5-6-luna | 軽量実装 |
| Grok | grok | claude-grok-4-6 | 探索実働・リアルタイム調査・独立レビュー |

GPT Terra と Grok の定義名、自由記述で指定を。具体的にどんな名前にするか。

GPT Terra、Grok の定義名、自由記述で指定を選択。具体的な名前を教えてほしい。

- GPT Terra: 既定 `gpt-terra` の代わりに何とするか
- Grok: 既定 `grok` の代わりに何とするか

# phyllis998

> GPT Terra: gpt-terra-implementer
> Grok: grok-researcher
