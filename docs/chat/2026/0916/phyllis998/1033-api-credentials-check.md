# API 認証情報とモデル一覧

- 日付: 2026-09-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: 不明
- セッション ID: 6f0c0bdf-24cc-44bd-827e-4736499bf788

---

## セッション 1: API キー確認とモデル一覧の表示

# phyllis998

> 現在 /api/models で取得できるモデル一覧を示してください

# AI

`/v1/models` 直接呼出し不可 → `ANTHROPIC_API_KEY` 未設定、`ant` CLI 無し(認証情報ゼロ)。

代わりに claude-api スキルのキャッシュ一覧(2026-06-24 時点、実 API 取得ではない)を提示:

- Claude Fable 5.1 — `claude-fable-5-1` — 1M context — $10/$50 per MTok
- Claude Mythos 5.1(Glasswing 限定) — `claude-mythos-5-1` — 1M — $10/$50
- Claude Fable 5 — `claude-fable-5` — 1M — $10/$50
- Claude Opus 5 — `claude-opus-5` — 1M — $5/$25
- Claude Opus 4.8 — `claude-opus-4-8` — 1M — $5/$25
- Claude Opus 4.7 — `claude-opus-4-7` — 1M — $5/$25
- Claude Opus 4.6 — `claude-opus-4-6` — 1M — $5/$25
- Claude Sonnet 5 — `claude-sonnet-5` — 1M — $2/$10
- Claude Sonnet 4.6 — `claude-sonnet-4-6` — 1M — $3/$15
- Claude Haiku 4.5 — `claude-haiku-4-5` — 200K — $1/$5

実 API 反映(`client.models.list()` / `GET /v1/models`)要る時: `ANTHROPIC_API_KEY` 設定するか `ant auth login` 実行。設定あれば代わりに叩く。

記録エージェント起動済み。応答終了。

## セッション 2: プロキシ設定の API 認証情報とモデル構成確認

# AI

記録完了。ユーザー応答不要(記録関連はターン応答対象外)。

# phyllis998

> 現在設定されているANTHROPIC_BASE_URLとANTHROPIC_API_TOKENをしようしてください

# AI

プロキシ(`http://127.0.0.1:8317`, cliproxyapi)経由取得 → Anthropic 公式 API 応答ではない。複数ベンダーのモデルを `claude-*` ID で提供。

**Anthropic純正 (owned_by: anthropic)**
- `claude-haiku-4-5-20251001` — 200K/64K
- `claude-fable-5-1` — 1M/128K
- `claude-opus-5` — 1M/128K
- `claude-sonnet-5` — 1M/128K

**owned_by: antigravity(食い違いあり — 本来 anthropic 製のはずが配信元表記が antigravity)**
- `claude-opus-4-6-thinking` / `claude-sonnet-4-6` — 200K/64K

**他ベンダー(owned_by で判別、id は claude- 冠したエイリアス)**
- OpenAI: `claude-gpt-5-6-luna` / `-sol` / `-terra`(921K/128K)、`claude-gpt-6-astra`(272K/128K)
- xAI: `claude-grok-4-6`(500K/65536)
- Google(Antigravity経由、id は逆順文字列難読化 — 例 `claude-fable-5-dd-hsalf-3-inimeg` = "gemini-3-flash" 逆読み):
  GPT-OSS 120B (Medium)、Gemini 3 Flash、3.1 Flash Image/Lite、3.1 Pro (High/Low)、3.5 Flash Lite、3.6/3.7/3.8 Flash

計21件。id 難読化・owned_by 食い違いは意図的偽装の可能性あり → 実利用時は display_name と owned_by で実体確認要。

記録エージェント起動済み。

## セッション 3: owned_by=antigravity のモデル ID を一覧表示

# AI

記録完了。応答不要。

既に処理済み通知。追加対応なし。

# phyllis998

> antigravityはSonnet4.6とOpus4.6を別途配信しています。そのうえで、owned_byがantigravityのモデルidをすべて出してください

> antigravityはSonnet4.6とOpus4.6を別途配信しています。そのうえで、owned_byがantigravityのモデルidをすべて列挙してください

# AI

owned_by: antigravity 全 12 件:

- `claude-opus-4-6-thinking` (Claude Opus 4.6 Thinking)
- `claude-sonnet-4-6` (Claude Sonnet 4.6 Thinking)
- `claude-fable-5-dd-muidem-b021-sso-tpg` (GPT-OSS 120B Medium)
- `claude-fable-5-dd-hsalf-3-inimeg` (Gemini 3 Flash)
- `claude-fable-5-dd-egami-hsalf-1.3-inimeg` (Gemini 3.1 Flash Image)
- `claude-fable-5-dd-etil-hsalf-1.3-inimeg` (Gemini 3.1 Flash Lite)
- `claude-fable-5-dd-tnega-orp-inimeg` (Gemini 3.1 Pro High)
- `claude-fable-5-dd-wol-orp-1.3-inimeg` (Gemini 3.1 Pro Low)
- `claude-fable-5-dd-etil-hsalf-5.3-inimeg` (Gemini 3.5 Flash Lite)
- `claude-fable-5-dd-hgih-hsalf-6.3-inimeg` (Gemini 3.6 Flash)
- `claude-fable-5-dd-hgih-hsalf-7.3-inimeg` (Gemini 3.7 Flash)
- `claude-fable-5-dd-hgih-hsalf-8.3-inimeg` (Gemini 3.8 Flash)

Opus/Sonnet 4.6 の 2 件除く残り 10 件は非 Claude モデル(GPT-OSS・Gemini 系)を `claude-fable-5-dd-...` id で偽装。

記録エージェント起動済み。
