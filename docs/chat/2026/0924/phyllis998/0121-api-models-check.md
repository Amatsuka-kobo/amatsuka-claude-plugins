# Anthropic API モデル一覧と版指定の不整合を検査

- 日付: 2026-09-24
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: GOTCHA-001 の版指定不整合を検出。setup-agents の再実行またはモデル定義の手動修正が必要な可能性
- 前提: GOTCHA-001(ARCHITECTURE に記載)で参照されている古いモデル ID の検証
- セッション ID: 23694bd6-2f46-4734-85a8-884882c216af

---

## セッション 1: Anthropic API モデル一覧と版指定の不整合を検査

# phyllis998

> /v1/models にリクエストを送って、結果を示してください。ANTHROPIC_API_TOKENとANTHROPIC_BASE_URLを使ってください

# AI

`ANTHROPIC_API_TOKEN`という名の変数は無い。認証トークンは`ANTHROPIC_AUTH_TOKEN`に入ってる。これで代用してリクエスト送る。

`/v1/models` 応答: 200 OK。12モデル取得。

| id | display_name | owned_by | max_input |
|---|---|---|---|
| claude-haiku-4-5-20251001 | Claude 4.5 Haiku | anthropic | 200,000 |
| claude-fable-5-1 | Claude Fable 5.1 | anthropic | 1,000,000 |
| claude-opus-5-5 | Claude Opus 5.5 | anthropic | 1,000,000 |
| claude-sonnet-5 | Claude Sonnet 5 | anthropic | 1,000,000 |
| claude-gpt-5-6-terra | GPT 5.6 Terra | openai | 921,000 |
| claude-gpt-6-astra | GPT 6.0 Astra | openai | 272,000 |
| claude-gpt-6-luna | GPT 6.0 Luna | openai | 272,000 |
| claude-gpt-6-sol | GPT 6.0 Sol | openai | 272,000 |
| claude-gemini-3-1-pro | Gemini 3.1 Pro (High) | antigravity | 1,048,576 |
| claude-gemini-3-8-flash | Gemini 3.8 Flash | antigravity | 1,048,576 |
| claude-grok-4-7 | Grok 4.7 | xai | 500,000 |
| claude-fable-5-dd-tsaf-dliub-7.4-korg | Grok 4.7 Fast | xai | 500,000 |

備考:
- `ANTHROPIC_API_TOKEN` という変数は無い → `ANTHROPIC_AUTH_TOKEN` で代用。
- `x-api-key` + `anthropic-version: 2023-06-01` ヘッダで認証成功。

GOTCHA-001 で名指しされてた `claude-grok-4-6` `claude-gpt-5-6-luna` `claude-gpt-5-6-sol` は一覧に無い → SessionStart のフォールバック警告は妥当。近い名前(`claude-grok-4-7` `claude-gpt-6-luna` `claude-gpt-6-sol`)がある → 定義側バージョン更新漏れの疑い。setup-agents 再実行 or 手動修正、判断は別途。

記録エージェント起動済み。バックグラウンド実行、完了待たずここで終える。
