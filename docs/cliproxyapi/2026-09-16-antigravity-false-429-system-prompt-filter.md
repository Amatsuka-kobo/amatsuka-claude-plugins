# antigravity 経由の Gemini がサブエージェントから常に 429 になる

## 1. 概要

Claude Code のサブエージェント経由で antigravity プロバイダーの Gemini（alias `claude-gemini-3-8-flash`）を呼び出すと、常に `429 Resource has been exhausted (e.g. check quota)` で失敗します。Antigravity 側の quota は Weekly・Five Hour ともに 100% 残っており、原因は quota ではありませんでした。実際の原因は、Google の Cloud Code エンドポイントが `systemInstruction` 内の特定の文字列を検出し、429 を偽装して返していることです。

## 2. 環境

- 日付: 2026-09-16
- CLIProxyAPI 7.2.155（Commit 7fac6b15、BuiltAt 2026-09-08）、`http://127.0.0.1:8317`
- Claude Code 2.1.273（`claude-cli/2.1.273 (external, sdk-cli)`）
- 上流: `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`、プロキシ側 User-Agent は `antigravity/hub/2.14.0 darwin/arm64`
- 認証: antigravity OAuth（Google AI Pro、個人アカウント、今回が初回利用）
- 設定: `oauth-model-alias.antigravity` に `gemini-3.8-flash-high → claude-gemini-3-8-flash`、`gemini-pro-agent → claude-gemini-3-1-pro` を設定。`request-retry: 10`、`disable-cooling: true`
- 呼び出し元: agent-policy が生成した Agent 定義 `document-writer`（model `claude-gemini-3-8-flash`）を、Claude Code の Agent tool で起動

## 3. 症状

- Claude Code 側のエラー: `API Error: Request rejected (429) · Resource has been exhausted (e.g. check quota). (error type rate_limit, HTTP 429, model sent to the API: claude-gemini-3-8-flash)`
- プロキシログ: `[warn] [conductor_execution.go:1907] 429 | 369ms | upstream execution failed: provider=antigravity model=gemini-3.8-flash-high ... err={"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}`
- エラーログ（`~/.cli-proxy-api/logs/error-v1-messages-*.log`）では上流へ 11 回連続で送信（`request-retry: 10` + 初回の 1 回）、いずれも 300〜400ms で 429 が返っていました。RetryInfo・ErrorInfo は含まれていません。各試行の Body 欄は `<empty>` で、プロキシのログ機能は上流へ送った body を残していませんでした
- ヘッドレス実行 `claude -p --model claude-gemini-3-8-flash "Reply with exactly: pong"` でも再現しました。セッションタイトル生成（`query_source: generate_session_title`）の内部リクエストでも同じ 429 が発生しました
- Antigravity の GUI では、Gemini Models の Weekly Limit Remaining・Five Hour Limit Remaining ともに 100% でした

## 4. 切り分け手順と結果

まず直接 `/v1/messages` を curl で叩き、同じ alias に対して各種パラメーターを変えて試しましたが、**すべて 200** で成功しました。

| 試行 | 結果 |
| --- | --- |
| max_tokens 32 / 8000 / 32000 | 200 |
| 本文サイズ 3KB / 30KB / 60KB | 200 |
| 並列 4 / 並列 8 / 連続 6 | 200 |
| stream / thinking adaptive / thinking enabled（budget 1024） | 200 |
| tools 1〜2 件、tool_use・tool_result のあるターン | 200 |
| output_config effort=high / xhigh / max、json_schema | 200 |
| context_management clear_thinking | 200 |
| system 16KB、cache_control ephemeral | 200 |
| Claude Code のヘッダー群（User-Agent claude-cli、X-Claude-Code-Session-Id、X-App、X-Stainless-*、anthropic-beta 全部） | 200 |
| metadata.user_id（device_id / session_id） | 200 |
| system ブロックに `x-anthropic-billing-header: ...` を含める | 200 |

次に、実際に失敗したリクエストをエラーログから取り出し、curl で再送すると **429 が再現**しました。以下の要素を 1 つずつ取り除いて確認しました。

| 取り除いた要素 | 結果 |
| --- | --- |
| tools | 429 |
| metadata | 429 |
| thinking / output_config / context_management | 429 |
| role: system のメッセージ | 429 |
| **system を差し替え** | **200** |

system は 3 つのブロックで構成されていたため、二分探索で切り分けました。

| ブロック | 内容 | 結果 |
| --- | --- | --- |
| [0] | `x-anthropic-billing-header: cc_version=...; cc_entrypoint=sdk-cli;` | 200 |
| [1] | `You are a Claude agent, built on Anthropic's Claude Agent SDK.` | **429** |
| [2] | セッションタイトル生成の指示（3KB） | 200 |

さらに、ブロック [1] の文字列自体をどこまで削れば通るかを確認しました。

| system の内容 | 結果 |
| --- | --- |
| `You are a Claude agent, built on Anthropic's Claude Agent SDK.`（完全一致） | 429 |
| 同文・末尾のピリオド無し | 429 |
| 前に別の文を足す／後に別の文を足す | 429 |
| 全て小文字化 | 200 |
| `You are a Claude agent.` | 200 |
| `built on Anthropic's Claude Agent SDK.` | 200 |
| `You are a Claude agent, built on Anthropic's` | 200 |
| `Anthropic` / `Claude` / `Claude Code` の単語のみ | 200 |
| `You are Claude Code, Anthropic's official CLI for Claude.`（メインセッションの identity 文） | 200 |
| 同じ完全一致の文を、system ではなく user メッセージに置く | 200 |

最後に、他モデル・他プロバイダーでも同じ完全一致の文を system に入れて比較しました。

| モデル（経路） | 完全一致の文を system に入れた結果 |
| --- | --- |
| `claude-gemini-3-1-pro`（antigravity） | 429 |
| `claude-gpt-5-6-terra`（codex） | 200 |

## 5. 結論

- 大文字・小文字を区別する完全一致の部分文字列 `You are a Claude agent, built on Anthropic's Claude Agent SDK` が systemInstruction に含まれると、antigravity 経路の上流が 429 RESOURCE_EXHAUSTED を返します。quota とは無関係です。
- Claude Code（Claude Agent SDK）は、サブエージェント起動時とセッションタイトル生成時に、この文を system へ必ず含めます。メインセッションの identity 文は別の文字列であり、検出されません。
- 結果として、**antigravity 経由の Gemini は、現状 Claude Code のサブエージェントとしては使えません**。メインセッションのモデルとしては問題なく動作します。
- この挙動は外部の報告と一致します。CLIProxyAPI の issue #4696（特定の identity 句で 429）、#5695（Claude Code のサブエージェントだけ 429）、#5848（Codex の instructions で偽装 429）、oh-my-pi の #11699・#12029（`<system-conventions>` 句で 429）、9router の PR #3986（`requestType: "agent"` で別枠 quota が適用される）などです。Google 側が systemInstruction に対する WAF・フィンガープリント規則を運用しており、それに該当すると偽装 429 を返している、と各所で推定されています。検出対象の句は今後も追加され続けると見られます。

## 6. 自前プロキシを作るときの教訓

1. **上流の 429 を quota 枯渇と同一視しない。** RetryInfo・ErrorInfo の有無、応答までの時間（数百 ms での即時返却は gateway による拒否の兆候）、同一 body を即時再送しても同じ結果になるか、を見て「偽装 429」かどうかを判別します。偽装であれば retry・cooling・アカウント切り替えをしても意味がなく、CLIProxyAPI は今回これで 11 回分を無駄に再送しました。
2. **エラーログに、上流へ送った body を残す。** CLIProxyAPI のエラーログは試行ごとの Body が `<empty>` で、切り分けを curl での再送でやり直す必要がありました。下流の body と上流の body の両方を（秘匿情報をマスクした上で）残すべきです。
3. **プロバイダー固有の systemInstruction 検査に対する方針を、最初に決めておく。** 選択肢は (a) 何もせず利用者に明示する、(b) 既知の句を設定可能な置換表で書き換える（oh-my-pi は U+200B の挿入を提案しましたが、メンテナーは規約リスクを理由に同梱を拒否しています）、(c) `requestType: "agent"` のような envelope フィールドを外す（9router の事例）、の 3 つです。いずれもプロバイダーの利用規約に触れる可能性があるため、自前実装では (a) を既定にし、(b)・(c) は利用者の明示的な opt-in に限定するのが安全です。
4. **クライアントの identity 文が透過して送られることを意識する。** Claude Code・Codex・oh-my-pi などの agent クライアントは、固定の identity 文を system に含めます。複数プロバイダーを跨ぐプロキシでは、どの文がどのプロバイダーで問題になるかを、継続的に記録していく必要があります。
5. **alias と上流モデル名の対応を、ログの両方に出す。** 今回、ログには上流名 `gemini-3.8-flash-high` だけが出力され、`/v1/models` の alias との突き合わせが別途必要でした。

## 7. 当面の回避（このリポジトリでの対応）

- `document-writer` の Agent 定義を、gpt-terra（`claude-gpt-5-6-terra`、codex 経路）へ差し替えます。`agent-policy` の `RECOMMENDED["doc-writing"]` に含まれるモデルです。
- antigravity の Gemini は、メインセッションのモデルとしてのみ使用します。
- この件は、agent-policy の設計書 `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md` の §10-5 に関連事項として追記します（別作業）。

## 8. 参照

- CLIProxyAPI issues: https://github.com/router-for-me/CLIProxyAPI/issues/4696 / 5695 / 5848 / 5751 / 1015
- oh-my-pi: https://github.com/can1357/oh-my-pi/issues/11699 / 11794 / 12029、PR 11730
- 9router PR: https://github.com/decolua/9router/pull/3986
- Google AI Developers Forum: https://discuss.ai.google.dev/t/antigravity-agent-still-failing-with-http-429-resource-exhausted/182129
- 本リポジトリ: `docs/development/cliproxyapi-setup.md`、`cliproxyapi.config.example.yaml`、会話記録 `docs/chat/2026/0916/phyllis998/1127-doc-writing-role-spec.md`
