# Claude Code auto mode classifier billing research

- 日付: 2026-09-23
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明(realtime-researcher への調査委譲、進行中)
- 前提: agent-policy:custom-policy、Claude Code auto mode・LLM gateway ドキュメント
- セッション ID: fe12def8-dfed-498e-a19c-d6f7a8c93283

---

## セッション 1: Auto mode classifier billing research delegation

# phyllis998

> Claude Code を実行しているとき、以下のメッセージが表示されました。(ただしこれはこちらで翻訳した文章です。原文コピーはわすれていました)
>
> ```
> Claude Code の自動モードを変更し、分類器リクエストの課金を停止します。
> ただし、このセッションは、リクエストが127.0.0.1:8317を経由するため、このアップデートと互換性がないため対象外です。
> 問題は発生しません。自動モードは引き続き動作し、分類器リクエストは以前と同様に課金されます。
> 修正して新しいバージョンの自動モードにアクセスするには、ゲートウェイに次の実装を依頼してください：https://code.claude.com/docs/en/auto-mode-classifier-billing
> ```
>
> 将来的に独自プロキシーサーバーを構築する際に役立つ情報であるかもしれないので、調査を行ってください。

> Claude Code を実行しているとき、以下のメッセージが表示されました。(ただしこれはこちらで翻訳した文章です。原文コピーはわすれていました)
>
> ```
> Claude Code の自動モードを変更し、分類器リクエストの課金を停止します。
> ただし、このセッションは、リクエストが127.0.0.1:8317を経由するため、このアップデートと互換性がないため対象外です。
> 問題は発生しません。自動モードは引き続き動作し、分類器リクエストは以前と同様に課金されます。
> 修正して新しいバージョンの自動モードにアクセスするには、ゲートウェイに次の実装を依頼してください：https://code.claude.com/docs/en/auto-mode-classifier-billing
> ```
>
> 将来的に独自プロキシーサーバーを構築する際に役立つ情報であるかもしれないので、調査を行ってください。

# AI

`agent-policy:custom-policy` の規律を適用。外部情報調査→`realtime-research` 役割→`realtime-researcher` へ委譲(model grok → 「そのまま起動」)。

調査を `realtime-researcher` へ委譲済み。バックグラウンドで実行中。

依頼した調査範囲:
1. `auto-mode-classifier-billing` ページ全文: 変更内容、ゲートウェイ側で要る実装(ヘッダー・エンドポイント・フィールド)、Claude Code が互換かどうかを判定する方法
2. 関連ドキュメント: auto mode と LLM gateway のページ
3. `127.0.0.1:8317` の正体: リポジトリ `scripts/` からプロキシソフトを特定
4. そのプロキシと LiteLLM 等の対応状況
5. Claude Code CHANGELOG の該当記載

完了通知が来たら、結果を突き合わせて独自プロキシ構築向けに整理し、報告する。

調査はまだバックグラウンドで実行中です。結果が届いたら、独自プロキシを作るときに役立つ形に整理して報告します。

## セッション 2: Auto mode 分類器課金の CLIProxyAPI 調査記録をコミット

# AI

調査はまだ実行中です。結果が届いたら整理して報告します。

調査はまだ実行中です。結果が届いたら整理して報告します。

# Claude Code auto mode の分類器課金変更: 調査結果

## 要約

- Claude Code **v2.1.278**(2026-09-19)から、auto mode の安全チェックの仕組みが変わった。メインのモデルリクエストに相乗りしてサーバー側でチェックし、その分は課金しない。
- 表示された通知の意味: 経路上の `127.0.0.1:8317`(このリポジトリで起動している **CLIProxyAPI**)が、サーバー側チェックのやり取りを通していない。そのためセッション全体が従来のクライアント側分類器(課金あり)に戻った。
- ゲートウェイ側に要る実装は「知らないフィールドも捨てずにそのまま通す」ことだけ。専用のエンドポイントは無い。
- 公式ページ(billing)と LiteLLM ブログは、私が直接取得して内容を確かめた。

## 通知が出た原因

1. **観測したこと**: 「127.0.0.1:8317 経由のため対象外」という通知が出た。
2. **層 1**: サーバー側チェックの結果(`safeguard_results`)が Claude Code に返ってこない。そのため Claude Code は、残りのセッションをクライアント側分類器に切り替えた。
   - アクション 1 件だけが失敗した場合は通知を出さず、次のリクエストでまたサーバー側チェックを試す。
   - 通知が出るのは、セッション単位で見切ったときだけ。
3. **層 2**: CLIProxyAPI が次のどちらかをしている。
   - リクエストの `safeguards` フィールドや `anthropic-beta` の値を上流へ渡していない
   - 応答から `safeguard_results` を落としている、または tool-use ID を書き換えている

   CLIProxyAPI 側に対応の予定は無い(issue #6009 は not planned でクローズ、#6015 は放置)。どの段階で落としているかは、ソースを見ていないので確認していない。
4. **層 3(経路によっては)**: 上流が GPT や Grok への変換経路なら、そもそも Anthropic のサーバーが経路上にいない。この場合、サーバー側チェックは原理的に成り立たない。

補足: 公式によると、Pro / Max / Team プランではこの通知は出ない。今回出たということは、プロキシ経由の `ANTHROPIC_AUTH_TOKEN` が API アカウントとして扱われていると考えられる(推測)。

## 独自プロキシを作るときの要件

### 公式に書かれていること

- リクエストの body は、知らないフィールドも捨てずにそのまま通す。特に **`safeguards`**。
- 応答と SSE イベントのキーを捨てない。特に **`safeguard_results`**。
- **tool-use ID を書き換えない**。
- `anthropic-beta` と `anthropic-version` は verbatim で通す。値ごとの allowlist は作らない。
- body フィールドと beta ヘッダーはセットで意味を持つ。片方だけ通すと 400 になり、両方落とすと機能が黙って消える。
- ストリームをバッファしない。`ping` やコメント行も削らない(300 秒間バイトが流れないと abort される)。
- エラーの body を包み直さない。`retry-after`、`x-should-retry`、`anthropic-ratelimit-unified-*` はそのまま通す。
- 確認方法: `/status` の `Auto mode server` 行が `Enabled` なら通っている。`Disabled` ならフォールバックしている。

### 公式には無いワイヤ形式(LiteLLM による再構成)

- beta の値: `dangerous-tool-use-2026-09-03`
- リクエスト:
  ```json
  "safeguards": [{"type":"dangerous_tool_use","classifier_context":{"v":1,"permission_mode":"auto"}}]
  ```
- 応答: `safeguard_results[].status.tool_uses` のキーが tool_use ID になっている。各値は `{"type":"evaluated","outcome":"not_flagged"}` の形。
- ストリームの場合は、最後の `message_delta` の `delta` に入る。

### 上流の種類ごとの設計

| 上流 | 取れる対応 |
|---|---|
| Anthropic API そのもの | 何も書き換えずに素通しすれば対応が済む |
| 変換経路(GPT / Grok など) | 本物のチェックはできない。`safeguards` と beta を落としてフォールバックさせる、または利用者側で `CLAUDE_CODE_AUTO_MODE_SERVER=0` を設定する |

変換経路については、shunt(OSS)が「ツールごとに `unavailable` を合成して返すと、セッション単位のフォールバックを避けられる」と報告している。公式の資料には無い(二次情報)。

## 今の環境への影響(要注意)

- **伝聞**: LiteLLM ブログは「Anthropic から聞いた」として次のように書いている。
  - 2026-10-23 より後の Claude Code リリースは、サーバー側分類器だけをサポートする。
  - 対応していないゲートウェイの背後では auto mode 自体が使えなくなる。

  公式の docs と CHANGELOG にこの日付は無い。ただし事実なら、今の CLIProxyAPI 環境にそのまま影響する。
- 同じブログは、auto mode が 9/25 から既定の permission mode になるとも伝えている(伝聞)。
- 当面の影響は、分類器の分が課金されることだけで、動作は壊れない。通知を止めたいだけなら、`CLAUDE_CODE_AUTO_MODE_SERVER=0` を設定すればよい(暫定の設定で、課金は変わらない)。

## 確認できていないこと

- CLIProxyAPI のソース上で、どこで落としているか(GitHub のコード検索が 401 で失敗した)。
- env-vars ページの `CLAUDE_CODE_AUTO_MODE_SERVER` の行(ページ取得が途中で切れた)。
- 10-23 の期限が公式情報かどうか。
- 課金が実際にどこに付くか。CLIProxyAPI の上流の認証情報側で消費されるはずだが、確認していない。

`★ Insight ─────────────────────────────────────`
- 今回の不具合の根本は、プロキシが「知っているフィールドだけ組み立て直して送る」作りだったこと。LiteLLM も同じ理由で踏んだ。Claude Code はリリースごとに beta と body フィールドを増やすので、独自プロキシの設計原則は「allowlist ではなく素通し。中身を見るなら改変しない」になる。
- auto mode の分類器が「別リクエスト」から「メインリクエストへの相乗り」に変わった。これで、プロキシの透過性が課金と機能の両方を左右するようになった。
- agent-policy は外部ベンダーのモデルへ委譲するので、その経路は変換経路になる。10-23 の伝聞が事実なら、外部モデルのサブエージェントを auto mode で動かせるかどうかが設計上の論点になる(推測)。
`─────────────────────────────────────────────────`

要点はメモリ(`auto-mode-server-classifier-gateway.md`)に保存しました。将来プロキシを設計するときの参照用に、`harness-docs/` の文書や共有できるページとしてまとめることもできます。必要なら言ってください。

出典:
- https://code.claude.com/docs/en/auto-mode-classifier-billing
- https://code.claude.com/docs/en/llm-gateway-protocol#feature-pass-through
- https://code.claude.com/docs/en/changelog
- https://docs.litellm.ai/blog/claude-code-server-side-auto-mode
- https://github.com/router-for-me/CLIProxyAPI/issues/6009
- https://github.com/router-for-me/CLIProxyAPI/issues/6015
- https://github.com/BerriAI/litellm/pull/42152
- https://github.com/pleaseai/shunt/pull/622

# phyllis998

> メモリではなく、docs/cliproxyapi/ に、形式に沿って記録しておいてください。

# AI

`docs/cliproxyapi/` の既存 2 本の形式を確認しました。これに沿って書く作業は文書作成役割の `document-writer` に委譲し、並行してメモリを撤去します。

Review the output before committing.

Record reviewed: matches the confirmed facts. Committing only the two `docs/cliproxyapi/` files.

調査記録を `docs/cliproxyapi/` に書いてコミットしました(`8c8458f`)。メモリに入れていた内容は削除しました。

## 追加したもの
- `docs/cliproxyapi/2026-09-23-auto-mode-server-classifier-not-passed.md`
  - 既存の 2026-09-16 の記録と同じ章立てです: 概要 → 環境 → 症状 → 調査結果 → 結論 → 自前プロキシを作るときの教訓 → 当面の対応 → 確認できなかったこと → 参照。
  - 事実と推測を分けて書き、公式に無い情報(ワイヤ形式、10-23 の期限)は二次情報・伝聞と明記しました。
- `docs/cliproxyapi/README.md` の記録一覧に 1 行追加しました。
- 変更は文書だけなので、lint・typecheck・test は走らせていません。

## 気づいたこと(どれも手を付けていません)
- **README の記録一覧に `2026-09-17-gemini-subscription-and-api-key-routes.md` の行がありません。** 以前の抜けです。追記が要るなら言ってください。
- **`cliproxyapi.config.example.yaml` に、覚えのない変更がありました。** `oauth-excluded-models` に `"claude-opus-5"` が 1 行増えています(19:32 更新)。私と委譲先が触ったファイルではないので、あなたの編集と判断してコミットから外しました。
- `docs/chat/` の差分は、いつもどおり会話記録用のコミットに回すためにそのまま残しています。

前回の報告に付け加えることはありません。調査記録はコミット `8c8458f` に入っています。
