# Gemini をサブスクリプションで呼ぶ経路は無く、SOUL.md 回避策も Claude Code には効かない

## 背景

前回の調査(`2026-09-16-antigravity-false-429-system-prompt-filter.md`)で、Antigravity 経由の Gemini が Claude Code のサブエージェントから呼べないことが判明しました。その後、次の 2 点を追加調査しました。

1. `SOUL.md` による回避策の妥当性と、CLIProxyAPI issue #4696 のクローズ理由
2. 「Claude Code から Gemini モデルを使う」を、定額(サブスク型)の契約で実現できるか

本文書はその結果をまとめます。

## 1. `SOUL.md` 回避策と issue #4696

- `SOUL.md` は **CLIProxyAPI のものではありません**。Nous Research のエージェントクライアント **Hermes Agent**(`NousResearch/hermes-agent`)の概念であり、`~/.hermes/SOUL.md`(または `$HERMES_HOME/SOUL.md`)に置く persona ファイルとして、system prompt の identity slot をラッパー無しで置き換えるものです。
- **Claude Code / Claude Agent SDK に `SOUL.md` は存在しません。** サブエージェントの identity 文は SDK が必ず挿入するものであり、Agent 定義の上書きでは消せません。**この回避策は Claude Code の経路には原理的に効きません。**
- issue #4696 のクローズ状況(`gh api` で確認):
  - `state_reason` は **`completed`**、クローズしたのはメンテナーの `luispater`、日時は 2026-08-04T16:40:31Z、クローズ時コメントはありません。
  - 紐づくコミットは `42eef103`、メッセージは `feat(antigravity): obfuscate sensitive words in system instructions` です。
  - **上流のフィルタを修正したのではなく、CPA 側に opt-in のゼロ幅文字(U+200B)難読化機構 `antigravity.sensitive-words` を追加して閉じています。**
  - 初出は `v7.2.118` です。`compare 42eef103...7fac6b15` は `behind_by: 0` であり、**手元の 7.2.155 にこの機構は含まれています**。ただし既定値は空リストで、Claude Code のフレーズは同梱されていません。
- 同じメンテナーは後の issue #5848 を **`not_planned`** で閉じ、次のように述べています。

  > This is not a CLIProxyAPI translation bug, and it is also not actual Antigravity quota exhaustion. Google's Antigravity path applies an upstream content filter to system-instruction text. [...] Closing this as not planned because the existing `antigravity.sensitive-words` mechanism is the supported way to handle this upstream filter.

- **回避策の効果は不安定です。** issue #4696 のコメントでは、`SOUL.md` を書き換えた利用者が「It's working so far」と報告した一方、別の利用者は約 20 分後に「換えたあと数回使えたが、また 429 になった」と報告しています。
- **同じ 7.2.155 で `sensitive-words` が効かなかった一次報告もあります。** issue #5695 で報告者 `hungvimanh` は次のように述べています。

  > I tried adding: `antigravity.sensitive-words: ["Claude Agent SDK"]` but the issue still reproduces.
  > Main Claude Code agent + Antigravity: OK / Explorer subagent + Antigravity: 429

  この issue は**報告者ではない第三者**が `completed` として閉じており、解決の確認を経ていません。
- **規約上の位置づけ。** Google の FAQ は、第三者ソフトウェア(Claude Code を名指し)による Antigravity へのアクセスを ToS 違反とし、アカウント停止・終了の事由になりうると明記しています。**この 429 はバグではなく、意図された遮断です。**
- 他プロジェクトのメンテナーの判断も記録しておきます。oh-my-pi の `H4vC` は同種の回避策の本体同梱を拒否し、次のように述べています。

  > I will not be shipping a bypass to google blocking OMP for the simple reason that it invites escalation

  > They blocked us with a brittle string match not because they are unable to come up with something better. If I ship a bypass to the regex/substring match the next escalation is banning people's AGY accounts.

  U+200B 挿入の PR #11730 は unmerged のまま closed になっています。

## 2. 定額(サブスク)で Gemini モデルを呼べるか

**結論: 「定額シートを買えば任意の第三者クライアントから Gemini モデルを呼んでよい」という Google の商品は、確認した範囲では存在しません。**

Google の課金は **製品の利用権** と **モデルの呼び出し権** を別々に切り分けています。定額サブスクリプションは前者を売り、モデルを呼ぶ権利は従量制で売られています。

経路ごとの判定を表にまとめます。

| 経路 | 課金 | 第三者クライアントから呼べるか |
| --- | --- | --- |
| AI Pro / Ultra の製品画面(Gemini アプリ、AI Studio UI、Antigravity IDE) | 定額 | 製品画面のみ。API 利用権を含まない |
| Antigravity OAuth の流用 | 定額の枠 | ToS 違反。加えてサブエージェントは偽装 429 |
| Gemini Code Assist Standard / Enterprise | 定額シート | **公式が禁止**(下記) |
| Gemini CLI の Google アカウント OAuth | シート枠 | 同上 |
| Gemini Enterprise アプリのシート | 定額シート | アプリへのサインイン権。モデル API の同梱は公式ページに無い |
| Gemini Developer API(AI Studio キー) | 従量 | **可** |
| Vertex / Agent Platform PayGo | 従量 | **可** |
| Vertex Provisioned Throughput | 容量コミット(前払い) | 可。ただし公式例のオーダーは月数万ドル |
| Pro / Ultra の GCP クレジット | サブスクリプション特典で従量を相殺 | **可。月 $10 / $40 / $100 まで** |

### Code Assist が塞がっている根拠

Gemini CLI の公式リポジトリ(`google-gemini/gemini-cli`)の `docs/resources/tos-privacy.md` に次の一文があります。

> Directly accessing the services powering Gemini CLI (for example, the Gemini Code Assist service) using third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth) is a violation of applicable terms and policies. Such actions may be grounds for suspension or termination of your account.

**例示が「第三者クライアント + Gemini CLI OAuth」そのものです。** 定額シートを正規に購入しても、その資格を Claude Code へ渡すことは対象になります。

Code Assist には、公開ドキュメント化された推論 API も見当たりません。有効化するのは `cloudaicompanion.googleapis.com` ですが公開の `generateContent` リファレンスが無く、`cloudcode-pa.googleapis.com` はセットアップ文書自身が "an internal API that provides IDE-related features" と記しています。

### CLIProxyAPI 側も対応を削除済み

- **PR #3893**「chore: remove Gemini CLI provider and related code」— 作者 `luispater`、2026-06-19 マージ。本文の理由は "now that Gemini CLI is being retired" です。`gemini_cli` executor、`internal/auth/gemini`、OAuth ログイン、translator をまとめて削除しています。
- **Issue #3797**「Gemini pro support after gemini-cli sunset」は **`not_planned`** として 2026-06-17 にクローズされています。
- 7.2.155 に残る Gemini 系の OAuth フラグは `--antigravity-login` のみです。`--gemini-login` / `--ai-studio-login` は存在しません(`--help` で確認)。

### Claude Code 側の事情

公式の LLM gateway ドキュメントには次の記述があります。

> Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway.

公式の Vertex 連携が指すのは **Vertex 上の Claude モデル**であり、Gemini は対象外です。`/v1/models` の発見も、id に `claude` / `anthropic` を含むものだけを残します。**Gemini を使うには翻訳プロキシが必要であり、その構成は Anthropic のサポート対象外です。**

## 3. AI Pro の「AI Studio の上限拡大」は API キーに効くか

**効きません。** 引き上がるのは AI Studio の Web UI(Playground / Build)の日次割り当てとモデルの選択肢だけです。

公式ドキュメント(`https://ai.google.dev/gemini-api/docs/google-ai-plans`、更新 2026-08-18 UTC)の原文です。

> **AI Studio UI only:** Google AI plan benefits for developer usage apply only within the Google AI Studio web interface. Direct use of the Gemini API (such as using API keys or external applications) is billed and managed separately.

> **Different from API billing:** Google AI plans for AI Studio are separate from Gemini API usage tiers, which cover development and production API usage.

さらに、サブスクリプションの枠を使い切ったときの案内が別系統であることも裏付けられます。

> When daily baseline subscription quotas are exhausted in AI Studio, you can continue your workflows using a Gemini API key with Cloud Billing enabled for pay-per-request usage of the Gemini API directly.

Google の公式ブログ(2026-04-20)も同じ切り分けをしています。

> While pay-per-request API keys remain the standard for production-scale launches, these subscriber benefits offer an easy entry point to developers who would like to experiment and prototype more deeply with AI Studio.

### API のレート制限が何で決まるか

**Cloud Billing の状態と累計支払額です。** 消費者向けサブスクリプションは影響しません。

| ティア | 条件 |
| --- | --- |
| Free | プロジェクトがある |
| Tier 1 | 課金アカウントをリンク |
| Tier 2 | $100 支払 + 3 日 |
| Tier 3 | $1,000 支払 + 30 日 |

> Rate limits are applied per project, not per API key.

> They [API keys] have no independent billing settings; they inherit the tier limits and billing status of the project.

**「Pro / Ultra を契約していると API の無料枠が広がる」という記述は、レート制限・課金・API キーのいずれのページにも見当たりません。**

### AI Studio の初回ポップアップについて

AI Studio を初めて開いたときに出る 2 つのダイアログの英語原文を、製品の JS から取得しました。

歓迎ダイアログ(コンポーネント名 `ms-g1-welcome-dialog`。`g1` は Google One):

> Go Further, Build Smarter: Unlock more possibilities with Google AI plans now in AI Studio
> Google AI plans provide tiered access to the latest Gemini models and AI features. Tackle your most complex projects with Google AI Pro and Ultra.

**ここでいう「tiered access」は消費者向けプランの階層(Free / Pro / Ultra)であり、Gemini API の usage tier(Free / Tier 1〜3)ではありません。** 同じ「ティア」という語が 2 つの別体系で使われており、混同しやすくなっています。公式ドキュメントが "Google AI plans for AI Studio are separate from Gemini API usage tiers" と明記しているのはこのためです。

利用規約の同意ダイアログ(`ms-tos-disclaimer`、非 EEA 向け):

> The Gemini API Additional Terms of Service and the Google Privacy Policy apply. Prompts and responses may be reviewed and used to train Google AI, so don't submit sensitive or personal information. Learn more about data use. Google AI models can make mistakes, so double-check responses before relying on, publishing, or otherwise using generated content.

この警告は **Unpaid Services の条項**に対応します。同意する時点ではまだ課金を紐付けていないため、そこで発行されるキーは Unpaid / Free Tier に位置づけられます。**Pro に加入していても、Cloud Billing を紐付けなければ Unpaid のままです。**

観測された細部として、ダイアログの「データの使用」リンクが `#data-use-paid`(有料側)を指している一方、警告文自体は無料側の内容になっています。製品の JS が地域分岐を無視して全バリアントで同じアンカーを使っているためと見られます。EEA 向けの文面(製品改善に使われない)であれば Paid 側と一致します。**公式の説明は無く、意図的な導線かアンカーのずれかは判断できませんでした。** なお Google の消費者向けページの脚注は `#unpaid-services` を指しており、非 EEA の警告と整合しています。

## 4. データの扱い

Gemini API Additional Terms of Service(発効 2026-03-23、更新 2026-04-28 UTC)からの引用です。

**Unpaid Services:**

> Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies [...] human reviewers may read, annotate, and process your API input and output. [...] Do not submit sensitive, confidential, or personal information to the Unpaid Services.

**Paid Services の定義と扱い:**

> Your access to Gemini API is a "Paid Service" only when accessing the API through a Cloud Project associated with an active billing account.

> Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products [...]

**業務のソースコードを通す場合は、Cloud Billing を紐付けた有料枠にする必要があります。** Prepay の最低額は $5 です。

EEA / スイス / 英国では、Unpaid でも Paid 側のデータ条項が適用されます。

## 5. CLIProxyAPI での設定

ローカルの 7.2.155(commit `7fac6b15`)の `config.example.yaml` で確認した内容です。

- Gemini を API キーで使う項目は **`gemini-api-key`**(`:335` 付近)です。Vertex 用は **`vertex-api-key`**(`:681` 付近)です。サービスアカウント JSON の取り込みは `--vertex-import` フラグで行います。
- トップレベルの `api-keys:` は CLIProxyAPI 自身のローカル認証キーであり、Google のキーではありません。
- 設定例(コメントアウトされています):

```yaml
# gemini-api-key:
#   - api-key: "AIzaSy...01"
#     weight: 5
#     prefix: "test"
#     base-url: "https://generativelanguage.googleapis.com"
#     models:
#       - name: "gemini-2.5-flash"
#         alias: "gemini-flash"
```

- **モデル ID の体系が OAuth 経路と異なります。** Antigravity OAuth 経路の `gemini-3.8-flash-high` / `gemini-pro-agent` に対し、Developer API は公式 ID の `gemini-3.8-flash` / `gemini-3.1-pro-preview` を使います。effort を表す `-high` 接尾辞は Antigravity 専用です。
- **`oauth-model-alias` は API キー経路に効きません。** 設定例には次の注記があります(`:710`)。

  > NOTE: Aliases do not apply to gemini-api-key, interactions-api-key, codex-api-key, xai-api-key, claude-api-key, openai-compatibility, or vertex-api-key.

  別名は各キーのエントリ内の `models: [{name, alias}]` で指定します。
- 複数キーの登録と重み付き負荷分散に対応しています。OAuth 経路との同時設定も設定上は可能ですが、同名モデルが両方から来たときの優先順位は公式に記載が無く、未検証です。

## 6. 実現可能な選択肢(事実の整理として)

1. **Pro / Ultra の GCP クレジットで従量を相殺する。** Google Developer Program 経由で月 $10(Pro)/ $40(Ultra 20TB)/ $100(Ultra 30TB)の Cloud クレジットが付与され、充当先として Vertex AI / Cloud Run / Gemini API が名指しされています。開発者向けドキュメントの原文です。

   > Subscribers with Google Cloud Platform (GCP) projects and Cloud Billing enabled are eligible to receive monthly Cloud credits from the Google Developer Program for Cloud services, including the Gemini API.

   受け取りは自動ではなく、Developer Program で特典を有効化し、GCP プロジェクトと Cloud Billing を用意する必要があります。定額無制限ではありません。
2. **従量の API キーを使う。** Cloud Billing を紐付けて有料枠にします。
3. **Gemini を使わない。** このリポジトリの `document-writer` は現在 `gpt-terra`(`claude-gpt-5-6-terra`、codex 経路)で動いており、実害は出ていません。

料金のオーダー: `gemini-3.8-flash` は入力 $0.75 / 出力 $3.75(1M トークンあたり、2026 年末まで。2027-01-01 から倍額)です。

## 7. このリポジトリでの対応

- `plugins/agent-policy` の `RECOMMENDED["doc-writing"]` から `gemini-flash` は外しません。agent-policy はエイリアスがどの経路で配られているかを知り得ないため、推奨から外すと Antigravity 以外の経路で Gemini を配っている構成まで巻き添えにしてしまいます。
- 代わりに `plugins/agent-policy/README.md` に注記を置きます(別作業)。

## 8. 確認できなかったこと

- Google APIs Terms of Service(親契約)の全文。プロキシ・自動化クライアントの一般禁止条項がそこに無いとは言い切れません。
- `aistudio.google.com/docs/terms` のレンダリング後本文が `ai.google.dev/gemini-api/terms` と一致するか(SPA のため未取得)。
- ダイアログの「データの使用」リンクが `#data-use-paid` を指すのが意図かアンカーのずれか。
- API キー経路でも Claude Agent SDK の identity 文で偽装 429 が出るか(Antigravity のエンドポイント固有の可能性が高いものの未検証)。
- `gemini-api-key` と Antigravity OAuth が同名モデルで衝突したときの CLIProxyAPI の実際のルーティング。
- Gemini Code Assist の現行リスト価格(公式価格ページの本文が取得できず、二次情報のみ)。
- Vertex Provisioned Throughput の 1 GSU あたりの公式価格。
- Developer API 無料枠の現行 RPM / RPD の公式数値(ダッシュボード参照のみ)。

## 9. 参照

- https://ai.google.dev/gemini-api/docs/google-ai-plans (更新 2026-08-18 UTC)
- https://ai.google.dev/gemini-api/docs/rate-limits (更新 2026-09-02 UTC)
- https://ai.google.dev/gemini-api/docs/billing (更新 2026-09-03 UTC)
- https://ai.google.dev/gemini-api/docs/api-key (更新 2026-09-02 UTC)
- https://ai.google.dev/gemini-api/docs/pricing (更新 2026-09-15 UTC)
- https://ai.google.dev/gemini-api/terms (発効 2026-03-23 / 更新 2026-04-28 UTC)
- https://blog.google/innovation-and-ai/technology/developers-tools/google-one-ai-studio/ (2026-04-20)
- https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/ (2026-01-27)
- https://one.google.com/about/google-ai-plans/
- https://developers.google.com/profile/help/benefits
- https://antigravity.google/docs/faq/
- https://antigravity.google/terms/
- https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md
- https://docs.cloud.google.com/gemini/docs/codeassist/overview
- https://docs.cloud.google.com/gemini/docs/codeassist/set-up-gemini
- https://code.claude.com/docs/en/llm-gateway
- https://code.claude.com/docs/en/google-vertex-ai
- https://github.com/router-for-me/CLIProxyAPI/issues/4696
- https://github.com/router-for-me/CLIProxyAPI/issues/5695
- https://github.com/router-for-me/CLIProxyAPI/issues/5848
- https://github.com/router-for-me/CLIProxyAPI/pull/3893
- https://github.com/router-for-me/CLIProxyAPI/issues/3797
- https://github.com/can1357/oh-my-pi/pull/11730
- https://hermes-agent.nousresearch.com/docs/user-guide/features/personality/
- https://github.com/NousResearch/hermes-agent/blob/main/agent/system_prompt.py

本リポジトリの関連文書: `docs/cliproxyapi/2026-09-16-antigravity-false-429-system-prompt-filter.md`
