# CLIProxyAPI 8.0.9 経由でも Claude Code の advisor は動き、ツール定義と暗号化された助言結果は改変されずに上流へ届く

## 1. 概要

Claude Code の `advisorModel`（`/advisor`）は、メインモデルより上位のモデルに助言を求める機能です。助言はサーバー側で実行されます。この機能が CLIProxyAPI 経由で使えるかを調べました。あわせて、自前のプロキシを作る場合に何を実装すべきかも整理しました。

Claude の OAuth アップストリームへ中継する経路では、CLIProxyAPI 8.0.9 で advisor が動作します。実機のリクエストログでも、advisor のツール定義と暗号化された助言結果が書き換えられずに上流へ届くことを確認しました。一方、メインモデルを Codex や Gemini に振る経路では advisor は使えず、CLIProxyAPI のメンテナーも対応しない方針です。

## 2. 環境

- 調査日: 2026-10-02
- Claude Code: 2.1.287（ローカルバイナリ `~/.local/share/claude/versions/2.1.287`）
- CLIProxyAPI: 8.0.9（Commit `63c04b4b`、BuiltAt `2026-10-01T21:36:36Z`）
- Claude Code の接続先: `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`
- メインモデル: Opus 5.5（`claude-opus-5-5`）
- 助言役: `/advisor` で Fable 5.1 を選択しました。プロジェクトの `.claude/settings.json` に `"advisorModel": "fable"` が書き込まれます。
- 調査方法:
  - 公式ドキュメント、CHANGELOG、CLIProxyAPI のソース（main の `63c04b4`）と issue・PR を対象にした文献調査
  - このセッションで advisor を実際に呼ぶ実機確認
  - `cliproxyapi.config.yaml` に `request-log: true` を設定して取ったリクエストログの確認

## 3. 症状

不具合の調査ではなく、機能が使えるかの確認です。実機で確かめた挙動は次のとおりです。

- `/advisor` で Fable 5.1 を選ぶと、セッションのツール一覧に `advisor` が現れました。
- advisor を呼ぶと助言本文が返り、画面には `Advisor has reviewed the conversation and will apply the feedback` と表示されました。
- 助言結果を含む履歴を送り直す後続のリクエストも、400 にならずに通りました。

## 4. 調査結果

### 4-1. advisor の正体

advisor tool は Claude API のサーバーツールです。`advisorModel` を設定すると、Claude Code はこのツールを `tools` に付けて送ります。助言役の推論は、Anthropic のサーバー内で 1 回の `/v1/messages` リクエストの中に収まります。Claude Code の側では助言を実行しません。

- tool type は `advisor_20260301`、name は固定の `advisor` です。
- 必要な beta ヘッダーは `advisor-tool-2026-03-01` です。
- 認証はサブスク（OAuth）でも API キーでも使えます。
- 接続先が Anthropic API なら、プロキシを経由しても使えます。Bedrock、Google Cloud（Agent Platform）、Microsoft Foundry では使えません。
- 助言役になれるのは、Sonnet 4.6 以上で、かつメインモデルと同等以上の能力を持つモデルです。組み合わせが無効なら API は 400 を返します。

### 4-2. ワイヤ形式

Claude Code 2.1.287 が送るツール定義を、リクエストログから取り出しました。

```json
{"type":"advisor_20260301","name":"advisor","model":"claude-fable-5-1","defer_loading":true}
```

- API は `max_uses`、`max_tokens`、`caching` も受け付けますが、Claude Code は付けていません。呼び出し回数にも助言の長さにも上限がありません。

レスポンスでは、次のブロックが順に並びます。

1. `server_tool_use`（`name: "advisor"`、`input: {}`）
2. `advisor_tool_result`

`advisor_tool_result.content` は次の 3 種類のどれかです。

| 種類 | 中身 |
| --- | --- |
| `advisor_result` | 平文の `text` |
| `advisor_redacted_result` | 暗号化された `encrypted_content`。Sonnet 5.5、Fable 5 / 5.1、Opus 5 / 5.5 などが助言役のとき |
| `advisor_tool_result_error` | `error_code` |

ストリーミングの挙動は次のとおりです。

- 助言役の推論はストリームしません。
- 推論が終わるまでは、約 30 秒ごとに `ping` だけが流れます。
- その後、結果のブロックが delta を伴わない 1 つの `content_block_start` で届きます。

トップレベルの `usage` には助言役のトークンが入りません。内訳は `usage.iterations[]` の `type: "advisor_message"` にあります。

暗号化された助言結果は、クライアントには読めません。次のターンに原文のまま送り返すと、サーバーが復号して使います。この結果は会話の並びに結び付いているため、履歴を加工すると 400 になります。

### 4-3. CLIProxyAPI のソース上の対応

Claude の OAuth アップストリームへ送る経路は、main で次のように対応しています。

- **ツール定義**: advisor 型のツールは、OAuth 用のツール名リマップ（MCP エイリアス化）の対象外です。`advisor_` で始まる型は `internal/runtime/executor/helps/claude_builtin_tools.go:27-45` の `IsClaudeServerToolType` がサーバーツールとして扱います。
- **beta ヘッダー**: 届いた値はすべて残します。ボディに advisor ツールがあれば、`advisor-tool-2026-03-01` を補います（`claude_executor_request.go:618-652`）。
- **クローキング**: 履歴に advisor の呼び出しか結果があるとき、system を `messages[]` に移さず、トップレベルの system に入れます（`claude_executor_cloaking.go:366-372, 406-415, 702-745`）。
- **レスポンス**: 応答の形式がリクエストと同じ Claude 形式なら、SSE を翻訳せずにそのまま転送します（`claude_executor_stream.go:405` 付近）。

Codex への翻訳経路（`internal/translator/codex/claude/codex_claude_request.go:341-462`）では、advisor はふつうの function ツールに変換されます。その結果、Claude Code 側で `No such tool available: advisor` になります（#5281）。Gemini の翻訳経路にも、advisor を特別に扱うコードはありません。

### 4-4. 実機のリクエストログ

確かめたログは `~/.cli-proxy-api/logs/v1-messages-2026-10-02T084416-01681292.log` です。advisor の結果を履歴に含む後続のリクエストで、Claude Code から届いたリクエストと、プロキシが上流へ送ったリクエストの両方が記録されています。

- **ツール定義**: Claude Code から届いた定義と、上流へ送った定義が一致しました。
- **beta ヘッダー**: 届いた 14 個の値はすべて残っていました。プロキシは `oauth-2025-04-20` と `extended-cache-ttl-2025-04-11` を追加しただけで、削除も書き換えもしていません。
- **暗号化された助言結果**: 履歴の `server_tool_use` と `advisor_tool_result`（`advisor_redacted_result`）は、上流へ送ったリクエストにもそのまま入っていました。両者の `encrypted_content` の MD5 も一致しています。
- **上流の応答**: `Status: 200`

### 4-5. 過去の不具合と関連 issue

| 番号 | 状態 | 内容 |
| --- | --- | --- |
| #5281 | not planned（2026-08-27） | 非 Anthropic モデルで `No such tool available: advisor` になる。メンテナーは非対応と回答した |
| #5330 | Fixed（2026-08-30） | `advisor-tool-2026-03-01` を古い値として削除し、すべてのリクエストが 400 になった |
| #5470 | Fixed（2026-09-06） | advisor を一度呼ぶと、以後のリクエストが 400 `Advisor tool result content could not be processed` になった。原因は会話の途中への system の挿入 |
| #5934 | Fixed（2026-09-18） | 呼び出し元のツール名 `advisor` を誤判定し、400 `Third-party apps now draw from your extra usage` になった |
| PR #5082 | マージ済み（2026-08-19） | `IsClaudeServerToolType` に `advisor_` を追加した |

### 4-6. Claude Code 側のフォールバック

Claude Code 2.1.280 以降は、ゲートウェイが advisor を拒否したときに自動で再試行します。

- 再試行の条件は、HTTP 400 か 422 のエラー本文に `Input tag 'advisor_20260301'` が含まれることです。
- 再試行は 1 回で、advisor のツール定義と beta を外して送り直します。
- 再試行の後は、プロセスが終わるまで同じ base URL への advisor を外します。
- この判定はエラー本文の文言に頼るため、エラー本文を加工するゲートウェイでは働きません。
- `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` を設定すると advisor を全面的に無効にできます。

## 5. 結論

- Claude の OAuth アップストリームへ中継する構成なら、CLIProxyAPI 8.0.9 で advisor が使えます。助言役を暗号化版を返す Fable 5.1 にした条件でも、実機で正常に動きました。
- 過去の不具合 3 件（#5330、#5470、#5934）は main で直っています。最後の修正（#5934、2026-09-18）より前のビルドには、400 になる不具合が残っています。修正とリリースのバージョンの対応は確かめていません。
- メインモデルを Codex や Gemini に振る経路では advisor は使えません。CLIProxyAPI も対応しない方針です。

## 6. 自前プロキシを作るときの教訓

advisor 自体を実装する必要はありません。求められるのは、advisor を壊さずに中継することだけです。CLIProxyAPI の過去の不具合 3 件は、どれも加工しすぎが原因でした。

Anthropic へ中継する経路では、次の 5 点を守ります。

1. `anthropic-beta` は許可リストで絞らず、受け取った値をすべて転送します。
2. `tools` にある `advisor_*` 型を、名前の付け替えや function への変換の対象にしません。
3. SSE をバイト単位でそのまま流します。アイドルタイムアウトは、`ping` の間隔である 30 秒より十分長くします。
4. 履歴にある `server_tool_use` と `advisor_tool_result` を加工しません。会話の途中への system の挿入など、メッセージの並びを変える処理もしません。
5. 上流の 400 のエラー本文を改変せずに返します。改変すると Claude Code の自動の再試行（4-6）が働かなくなります。

トークンを計量するなら、`usage.iterations[]` の `advisor_message` も合算してください。

Codex や Gemini へ翻訳する経路では、advisor を再現しようとせず、`Input tag 'advisor_20260301'` を含む 400 を返します。Claude Code が advisor を外して続行するので、実装は数行で済みます。再現しようとすると、プロキシ側にエージェントループ、助言役の呼び出し、結果ブロックの合成が必要になります。しかも暗号化版の結果はプロキシでは作れないため、完全な再現はできません。

## 7. 当面の対応（このリポジトリでの対応）

- CLIProxyAPI を 8.0.9 のまま使います。
- `request-log: true` は検証のために一時的に有効にしました。1 リクエストで約 1MB の全文を書き込み、ログには会話の全文と OAuth リクエストのヘッダーが入るため、検証が済んだら外します。

## 8. 確認できなかったこと

- advisor に初めて対応した CLIProxyAPI のバージョン。shallow clone だったため、タグとの照合をしていません。
- CLIProxyAPIPlus（派生版）の対応状況。
- 非ストリームの経路で、レスポンスがそのまま転送されるか。ソースを読んでいません。
- サブスクの OAuth をプロキシ経由で使うと、#5934 の `Third-party apps now draw from your extra usage` の判定に引っかかる条件。
- 2026-10-02 08:37 に記録された `unknown provider for model claude-sonnet-4-6` / `claude-opus-4-7` のエラー 2 件の発生元。advisor の確認には影響していません。

## 9. 参照

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
- https://code.claude.com/docs/en/advisor
- https://code.claude.com/docs/en/settings-reference
- https://code.claude.com/docs/en/llm-gateway-protocol
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- https://github.com/router-for-me/CLIProxyAPI/issues/5281
- https://github.com/router-for-me/CLIProxyAPI/issues/5330
- https://github.com/router-for-me/CLIProxyAPI/issues/5470
- https://github.com/router-for-me/CLIProxyAPI/issues/5934
- https://github.com/router-for-me/CLIProxyAPI/pull/5082
