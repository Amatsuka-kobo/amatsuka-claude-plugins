# CLIProxyAPI 経由では auto mode のサーバー側分類器が働かず、分類器リクエストは従来どおり課金される

## 1. 概要

Claude Code の実行中に、auto mode の分類器リクエストを無料化する変更の対象外である旨の通知が表示されました。通知の日本語訳は次のとおりです。英語原文の全文は保存していません。

> Claude Code の自動モードを変更し、分類器リクエストの課金を停止します。ただし、このセッションは、リクエストが127.0.0.1:8317を経由するため、このアップデートと互換性がないため対象外です。問題は発生しません。自動モードは引き続き動作し、分類器リクエストは以前と同様に課金されます。修正して新しいバージョンの自動モードにアクセスするには、ゲートウェイに次の実装を依頼してください：https://code.claude.com/docs/en/auto-mode-classifier-billing

Claude Code 2.1.278 以降、auto mode の安全性チェックは、メインのモデルリクエストに相乗りするサーバー側分類器として実行できます。サーバー側で実行された分類器リクエストには課金されません。CLIProxyAPI を経由するこの環境では、必要なやり取りが Claude Code まで届かず、クライアント側分類器へフォールバックします。この場合も auto mode の動作は壊れませんが、分類器リクエストは従来どおり課金されます。

## 2. 環境

- 調査日: 2026-09-23
- 通知を見た日時、および通知時点の Claude Code・CLIProxyAPI のバージョンは記録していません。
- 調査時点のバージョン: Claude Code 2.1.280、CLIProxyAPI 7.3.15（Commit `673131f5`、BuiltAt `2026-09-23T00:56:22Z`）
- プロキシの待受先: `http://127.0.0.1:8317`。`cliproxyapi.config.yaml` の `host` / `port` で設定しています。
- 起動方法: `scripts/start-proxy.sh` から `cli-proxy-api --config ./cliproxyapi.config.yaml` を実行しています。
- Claude Code の接続先: `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`
- `scripts/install-proxy.sh` は、`ANTHROPIC_AUTH_TOKEN` と `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` をシェルのプロファイルへ書き込みます。
- 調査方法: 公式ドキュメント、CHANGELOG、関連 OSS の issue・PR・ブログを対象にした文献調査のみです。実機での再現とパケットの確認はしていません。

## 3. 症状

公式ページに掲載されている通知の冒頭は、次のとおりです。

> We're changing auto mode to no longer charge for classifier requests in Claude Code. However, this session isn't eligible.

経路上のゲートウェイを特定できた場合、通知にはゲートウェイ名が入ります。今回の通知では `127.0.0.1:8317` が示されました。

- 最初にチェック対象となるアクションの直前で、そのアクションを保留して通知が出ます。Enter で続行すると、そのセッションの残りはクライアント側分類器で動作します。
- ゲートウェイ名を含む通知を承認すると、そのマシンでは 24 時間再表示されません。Esc または Ctrl+C で取り消すと、そのアクションとターンは停止しますが、通知は記憶されません。次のチェック対象アクションで再度表示されます。
- 非対話実行の `-p` では同じ文章が標準エラー出力に出ます。`stream-json` では `system` の warning message、VS Code では会話内の notice として出ます。
- `/status` の `Auto mode server` 行で状態を確認できます。`Enabled` はサーバーが判定中、`Disabled` はクライアント側分類器へフォールバック済みであることを示します。

## 4. 調査結果

### 4-1. 変更内容と時期

公式 CHANGELOG では、短期間に既定値が反転しています。

- **2.1.273（2026-09-15）**では、Bedrock・Vertex・Foundry の既定をローカル分類器に変更し、サーバー側分類器は `CLAUDE_CODE_AUTO_MODE_SERVER=1` による opt-in でした。
- **2.1.278（2026-09-19）**では、Claude API・Enterprise の利用者、Bedrock・Vertex・Foundry・ゲートウェイの既定をサーバー側分類器へ変更しました。サーバー側で実行する分類器リクエストは課金されません。Bedrock・Vertex・Foundry・ゲートウェイでは、`CLAUDE_CODE_AUTO_MODE_SERVER=0` で opt-out できます。課金されるフォールバック時の警告と、`/status` の `Auto mode server` 行もこの変更で追加されました。
- **2.1.280（2026-09-22）**では、safety check に拒否されたアクションを無限に再試行していた問題を、1 回の deny で止めるよう修正しました。safety check が応答しない場合の連続 deny には backoff を入れ、10 回連続するとターンを停止します。

### 4-2. 通知が出る対象

2.1.278 以降、既定でサーバー側チェックを要求する対象は、Enterprise プラン、Claude API を使うアカウント、Claude Platform on AWS、Amazon Bedrock、Google Cloud's Agent Platform、Microsoft Foundry です。permission-modes のページには、`ANTHROPIC_BASE_URL` を LLM ゲートウェイまたはプロキシへ向けた場合も含まれると記載されています。Pro・Max・Team プランでは、この通知は出ません。

今回通知が出た理由は、プロキシ経由の `ANTHROPIC_AUTH_TOKEN` が claude.ai のサブスクリプションではなく、ゲートウェイの認証情報として扱われているためと**推測されます**。この扱いを実機で確認したわけではありません。

### 4-3. フォールバックと通知の条件

サーバーが個別のアクションをチェックできなかっただけでは、通知は出ません。そのアクションだけをクライアント側分類器で処理し、次のリクエストでは改めてサーバー側チェックを試みます。

一方、サーバー側チェックがセッションの残りに届かないと判断されたときは、セッション単位でフォールバックし、通知が出ます。早ければ最初のチェック対象アクションで表示されます。

公式が多い原因として挙げているのは、経路上のゲートウェイがリクエストヘッダーを削除または書き換える、未知のリクエストフィールドを落とす、応答を編集する、というものです。応答の編集には、ID の書き換えとストリームイベントからのキー削除が含まれます。プラットフォーム、リージョン、認証情報がまだ対応していない場合もあります。

### 4-4. ゲートウェイへの要件

公式は、ゲートウェイが未知のものも含めてリクエストヘッダーと body フィールドをそのまま転送することを求めています。`safeguards` は名指しされたリクエストフィールドです。応答とストリームイベントもキーを落とさず返す必要があり、`safeguard_results` が名指しされています。tool-use ID を書き換えてはいけません。

gateway compatibility guide の feature pass-through は、次の原則を示しています。

- `anthropic-beta` と `anthropic-version` を変更せずに転送します。beta の値ごとの allowlist は作りません。
- 未知の `anthropic-*` ヘッダーと body フィールドも転送します。body フィールドと beta ヘッダーは対であり、片方だけを通すと 400 になり、両方を落とすと機能が通知なしで失われます。
- 検査が必要な場合でも、内容は書き換えません。

ストリーミングでは、応答全体をバッファせず逐次転送する必要があります。SSE の `ping` とコメント行を削除してはいけません。`ANTHROPIC_BASE_URL` の経路は、既定で 300 秒間バイトが流れないと abort します。エラー body を包み直さず、`retry-after`、`x-should-retry`、`anthropic-ratelimit-unified-*` も転送します。

公式ページには、wire format の JSON スキーマ、beta ヘッダーの値、分類器専用のエンドポイント、テスト手順は掲載されていません。分類器専用の URL はなく、通常の `/v1/messages` リクエストに情報が載ることだけが確認できます。

### 4-5. ワイヤ形式

以下は公式ドキュメントには掲載されていません。LiteLLM ブログが実トラフィックから再構成した**二次情報**です。

`anthropic-beta` の値は `dangerous-tool-use-2026-09-03` とされています。リクエストには、例えば次のフィールドが載ります。

```json
"safeguards": [{"type": "dangerous_tool_use", "classifier_context": {"v": 1, "permission_mode": "auto"}}]
```

応答の `safeguard_results` には `dangerous_tool_use` の要素が 1 つあります。その `status.type` は `available` であり、`status.tool_uses` は tool use ID をキーにします。各値の `type` は `evaluated`、`outcome` は `not_flagged` などです。このキーの ID は、応答 content 内の tool_use ID と一致している必要があります。

LiteLLM ブログによれば、ストリーミングでは最後の `message_delta` イベントの `delta` に `safeguard_results` が入ります。一方、LiteLLM PR #42288 は `message_start` と最後の `message_delta` の両方にあると説明しています。両者の記述差が意図的な仕様差かどうかは確認できていません。

LiteLLM では、native `/v1/messages` 経路が既知パラメーターの allowlist でリクエストを組み立て、`safeguards` を黙って落としていました。さらに上流が Anthropic API の場合も、未知の beta を除去するフィルタが動いていました。その結果、Anthropic はフィールドも beta も受け取れず、結果を返しませんでした。素通しする `/anthropic/v1/messages` 経路は影響を受けていませんでした。

### 4-6. 各ゲートウェイの対応状況

2026-09-23 時点で確認できた対応状況は次のとおりです。

- **CLIProxyAPI:** issue #6009 は 2026-09-21 に `not planned` としてクローズされ、コメントはありません。issue #6015 は同日に作成され、Open、コメント 0 件です。v7.3.15 のリリースノートに `safeguards`、auto mode、classifier の記載はありません。近い記載は「support Claude Code 2.1.280 feature-gated betas」ですが、pass-through を実装したとは書かれていません。
- **LiteLLM:** PR #42152 は native `/v1/messages` で `safeguards` を通す変更です。Anthropic 以外へ変換する経路では、400 を避けるため除去します。PR #42288 は Bedrock Invoke・Vertex へ beta と `safeguards` を通す変更で、Foundry は未完です。両 PR は 2026-09-21 にマージされ、2026-09-23 に v1.102.1、v1.101.1、v1.100.2、v1.99.3 のパッチとして出荷されました。
- **shunt:** PR #622 は 2026-09-20 にマージされました。PR の説明によれば、Anthropic 本番へは verbatim で転送し、GPT・Gemini などへ変換する経路ではツールごとに `unavailable` または `error` を合成して、セッション単位のフォールバックを避けます。これは公式ドキュメントにない実装方針です。
- **その他:** zai-org/feedback #785 は GLM の Anthropic 互換エンドポイントへの対応要望です。hishamkaram/claude-code-router #101 では、OpenAI 互換経路が `safeguards` に対して 501 を返しています。Portkey、Helicone、Cloudflare AI Gateway の対応表明は見つかりませんでした。

### 4-7. 将来の変更に関する伝聞

LiteLLM ブログには「Anthropic から聞いた」とする記載がありますが、公式ドキュメントと CHANGELOG にはありません。

- 2026-10-23 より後の Claude Code リリースでは、サーバー側分類器だけをサポートし、非対応のゲートウェイの背後では auto mode 自体が使えなくなる。
- 2026-09-25 から auto mode が既定の permission mode になる。

これらは**伝聞であり、確定した仕様として扱えません**。

## 5. 結論

観測できた事実は、`127.0.0.1:8317` 経由のため対象外であるという通知です。調査結果から、因果関係は次の層に分けて整理できます。

1. **直接の挙動:** サーバー側チェックの結果である `safeguard_results` が Claude Code に届かず、Claude Code がセッション単位でクライアント側分類器へ切り替えました。
2. **プロキシ側の原因候補:** CLIProxyAPI が `safeguards` フィールドまたは `dangerous-tool-use-*` beta を上流へ渡していない、応答から `safeguard_results` を落としている、あるいは tool-use ID を書き換えている可能性があります。どの段階で失われているかはソースを確認していないため、これは候補にとどまります。CLIProxyAPI 側は issue #6009 を `not planned` としています。
3. **変換経路の制約:** 上流が Anthropic ではなく GPT・Grok などへの変換経路であれば、経路上に Anthropic のサーバーがありません。この場合、Anthropic のサーバー側チェックは原理的に成立しません。

現時点で確認された影響は課金だけで、auto mode は動作します。ただし、4-7 の伝聞が事実であれば、CLIProxyAPI 経由では 2026-10-23 以降の Claude Code で auto mode を使えなくなる可能性があります。

## 6. 自前プロキシを作るときの教訓

1. **allowlist で組み立て直さず、素通しします。** 未知の body フィールド、`anthropic-*` ヘッダー、応答キー、SSE イベントを落としません。LiteLLM でも allowlist が原因になりました。Claude Code はリリースごとに beta と body フィールドを増やすため、今日観測したキーだけに固定すると次の機能で壊れます。
2. **body フィールドと beta ヘッダーは対で扱います。** 片方だけを通すと 400 になり、両方を落とすと機能が通知なしで失われます。
3. **tool-use ID を書き換えません。** `safeguard_results` のキーは、content 内の tool_use ID と一致している必要があります。
4. **上流ごとに方針を決めます。** Anthropic 本番へは verbatim の転送で足ります。変換経路では本物のチェックができないため、(a) `safeguards` と beta を除去してセッションをフォールバックさせる、(b) 利用者に `CLAUDE_CODE_AUTO_MODE_SERVER=0` を案内する、(c) ツールごとに `unavailable` を合成する、のいずれかを選びます。(c) は shunt の方式であり、公式には掲載されていません。4-7 の伝聞が事実なら、変換経路では auto mode 自体が使えなくなる前提で設計します。
5. **検証手段を用意します。** `/status` の `Auto mode server` 行、`-p` の標準エラー出力、`stream-json` の `system` warning で、フォールバックの有無を確かめられます。
6. **ストリーミングは逐次に流します。** `ping` とコメント行を削除せず、300 秒の watchdog を回避します。エラー body とレート制限ヘッダーもそのまま返します。

## 7. 当面の対応（このリポジトリでの対応）

- auto mode 自体は壊れないため、現時点では対応しません。
- 通知だけを止める必要がある場合は、シェルまたは settings の `env` に `CLAUDE_CODE_AUTO_MODE_SERVER=0` を設定します。これは暫定的な設定であり、後のリリースで削除される可能性があります。分類器リクエストの課金は変わりません。直接 Anthropic API に接続しているときは読まれません。現時点では、このリポジトリの設定に追加しません。
- CLIProxyAPI 側の対応は期待しにくいため、4-7 の期限が公式 CHANGELOG に載るかを追います。
- agent-policy は、外部ベンダーのモデルを指定したサブエージェントを CLIProxyAPI 経由で動かしています。これは結論の第 3 層にある変換経路に当たると**推測されます**。4-7 の伝聞が事実であれば、外部モデルのサブエージェントを auto mode で動かせるかが検討課題になります。この検討は別作業とします。

## 8. 確認できなかったこと

- CLIProxyAPI のソースのどこで `safeguards` または `safeguard_results` が失われるか。GitHub のコード検索は 401 で失敗しました。
- ゲートウェイ名を含む通知の英語原文の全文。公式ページにはその形の通知がありません。
- `CLAUDE_CODE_AUTO_MODE_SERVER` に関する env-vars ページの該当行。取得が途中で切れましたが、変数の意味は billing と permission-modes の両ページで確認しました。
- 2026-10-23 の期限の真偽。公式ドキュメントと CHANGELOG にはありません。
- このセッションの分類器リクエストが実際にどの課金へ計上されるか。CLIProxyAPI の上流の認証情報側で消費されると見られますが、未確認です。
- この環境で `/status` の `Auto mode server` 行を実際に表示して確認すること。
- 公式ドキュメントの `llms.txt` 索引と Context7 に billing ページがまだ載っていなかった理由。

## 9. 参照

- 公式: https://code.claude.com/docs/en/auto-mode-classifier-billing 、https://code.claude.com/docs/en/llm-gateway-protocol#feature-pass-through 、https://code.claude.com/docs/en/permission-modes 、https://code.claude.com/docs/en/changelog 、https://code.claude.com/docs/en/llm-gateway 、https://code.claude.com/docs/en/llm-gateway-rollout
- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI/issues/6009 、https://github.com/router-for-me/CLIProxyAPI/issues/6015 、https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.3.15
- LiteLLM: https://docs.litellm.ai/blog/claude-code-server-side-auto-mode 、https://github.com/BerriAI/litellm/pull/42152 、https://github.com/BerriAI/litellm/pull/42288
- その他: https://github.com/pleaseai/shunt/pull/622 、https://github.com/zai-org/feedback/issues/785 、https://github.com/hishamkaram/claude-code-router/issues/101
- 本リポジトリ: `scripts/start-proxy.sh`、`scripts/install-proxy.sh`、`cliproxyapi.config.example.yaml`、会話記録 `docs/chat/2026/0923/phyllis998/1927-auto-mode-classifier-billing-research.md`
