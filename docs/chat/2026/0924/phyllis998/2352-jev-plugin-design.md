# Jev プラグイン設計セッション

- 日付: 2026-09-24
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 設計検討中
- 前提: `plugins/codiel/raguel-mcp/` (既存 MCP 判断機の参考実装)
- セッション ID: 308557f0-a02b-45b0-b51e-81939ba25089

---

## セッション 1: Jev—汎用判断機の仕様と命名検討

# phyllis998

> 新しいプラグインとして、JevというAIに様々な判断を行わせるMCPサーバーを持つものを作成したいです。
> 名前は"Jev"という単語と、神話に基づく名前の造語もしくは熟語にしたいです。

# AI

分類: 新プラグイン+新 MCP サーバー → **architectural**。設計書→実装計画書の完全経路。

探索結果: `plugins/codiel/raguel-mcp/` が既に同型(MCP サーバー + `claude -p` ヘッドレスで LLM 判定、API 不使用)。Jev は同じ機構を再利用可。

## 質問 1: 目的

Raguel は codiel の run 内で成果物(計画・設計・コード・判断)を PROCEED/ASK/STOP でゲート判定する専用機。Jev の「様々な判断」は何?

- A: Raguel を codiel から独立させ、汎用ゲート判定機として切り出す(Raguel は codiel 専用のまま残す or 移す)
- B: ゲート以外の判断(選択肢の推奨、分類、優先度付け、命名など)を任意のスキル・フックから呼ぶ汎用判断機
- C: 別物(具体的に)

呼び出し元(スキル? hook? ユーザー直接?)も一言で。

## 名前候補(仮)

「Jev」の由来次第で絞る(Judge/Evaluate/Verdict の略?)。既存は天使名系(metatron/sandalphon/raphael/raguel)。

- Jevriel / Jeviel — 天使名接尾辞 -el。系統一致
- Jevuriel — Uriel(裁きと知恵の天使)との造語
- Jevthemis — Themis(ギリシャ、法と秩序の女神)
- Jevmaat — Ma'at(エジプト、真理と裁きの秤)
- Jevmir — Mímir(北欧、知恵の泉)

Jev の由来と、天使系で揃えるか他神話でもよいか、回答を。

質問 1 の回答待ち。

## セッション 2: Jev 既存資料検索と最新情報調査の並行開始

# AI

質問 1 の回答待ち。

質問 1 の回答待ち。

# phyllis998

> C: 最近Jevという、LLMとは違い構造的なリクエストを送るとまた構造的な判断レスポンスをしてくれるAIが話題です。このプロジェクト内に、Jevについて調べたセッションのチャットファイルが残されているはずです。それを探しつつ、最新のJevの使い方や何ができるかも調べてください。特にブラウザを操作するE2Eテストを何らかの方法で行うことができれば最高です。

# AI

記録 1 件ヒット(2026-09-18「TypeSafe Jev AI 統合に向けた4分野調査」)。読解と最新情報調査を並列実行中。完了通知待ち。

調査 2 件の完了通知待ち。

## セッション 3: Jev調査完了、プラグイン設計方針確定

# AI

調査 2 件の完了通知待ち。

調査 2 件(記録読解・最新情報)の完了通知待ち。

記録読解完了。最新情報調査の完了通知待ち → 両方揃えて突き合わせ報告。

最新情報調査(realtime-researcher)の完了待ち。

## 調査結果の突き合わせ

**Jev の正体**(公式 docs.typesafe.ai、2026-09-25 取得)
- TypeSafe AI の System One モデル `jev-1.13.0`。名前は経済学者 Jevons 由来
- 入力: テキスト state(文字列/JSON)。出力: Choice / Score / Noul の型付き判断+確率のみ。文章・コード生成なし
- 呼び方: `POST api.typesafe.ai/v1/systemone` + `TYPESAFE_API_KEY`。JS SDK `@typesafe-ai/sdk`(Node 20+)。ローカル実行不可
- 料金: 入力 $0.042/1M、出力無料。無料枠 未確認。早期アクセス(GA 文言不揃い)
- レイテンシ 70〜500ms。制約: 計算不可、多ホップ不可、CJK 精度低下、敵対的テキストに弱い、画像不可

**09-18 セッションで決めたこと**(出典: docs/chat/2026/0918/…/1245-jev-ai-integration-planning.md)
- agent-policy の役割には載せない。「役割の下」で判断関数として使う
- state は名前付き JSON、1 問 = 1 判断
- Jev 単体で E2E 不可。Playwright(操作)+ Jev(判定)の分離構成なら成立

**公式 MCP なし。コミュニティ**
- jkudish/jev-mcp(322★): 判断 10 ツール(verify/classify/decide/gate…)。ブラウザなし
- jkudish/jev-browser(259★): Playwright + Jev。Jev が次アクション Choice・目標到達 Noul、ループはコード。既存 `Page` 渡し可。v0.1、Shadow DOM/iframe 非対応
- krw82/jev-playwright-mcp: Playwright MCP の前段プロキシ。1 コミット、fail-open。基盤にならず

## 懸念 1 件

ARCHITECTURE「API 不使用で全プラグインが使える」原則と、Jev = 外部有料 API が衝突。→ 設計方針: **キー無しでもロード可、ツールは「unavailable」を返す opt-in プラグイン**。ADR 要。

## 質問 2: MCP サーバーの中身(E2E の置き方)

推奨 **B**。理由: 「最高」条件(ブラウザ E2E)を LLM 介在なしの高速ループで満たし、判断専用ツールも同居。A は既存 jev-mcp と重複。

- A: 判断専用(verify/classify/gate 等)。ブラウザは既存 `@playwright/mcp` を Claude が操作し、スナップショットを Jev ツールへ渡す。1 ステップ毎に LLM 介在 → 遅い・高い
- B: 判断ツール + **goal 駆動ブラウザツール**(`run_browser_goal(url, goal, assertions)`: Playwright 起動→a11y テキスト化→Jev が次手 Choice/到達 Noul→ループ→pass/fail+トレース返却)。サーバー内で完結、LLM 不介在。codiel の test-loop から呼べる
- C: B のうちブラウザ部を jkudish/jev-browser にライブラリ依存。自前ループ不要だが early software・Shadow DOM 非対応に縛られる

判断軸: 実行速度 / 外部依存の安定性 / 実装量。B は playwright + `@typesafe-ai/sdk` で約 200〜300 行見込み。

## 名前(仮決め)

推奨 **jevriel**(Jev + 天使名接尾辞 -el。metatron/sandalphon/raphael/raguel と系統一致、短い)。次点 jevuriel(Uriel = 裁きの天使、ただし長い)、jevmaat(Ma'at = 秤で裁く女神、天使系から外れる)。

B と jevriel でよいか、回答を。

質問 2(B / jevriel)の回答待ち。

# phyllis998

> A+Bでお願いします。肝心のJevに関連した部分は公式SDK以外の外部ツールへの依存はしないようにしたいです。(Jev部分以外は例外)
> それと、ARCHITECTUREにAPI不使用と明記されているとありますが、"Anthropic API不使用"の間違いです。これは新しい判断ではなく最初からあった規律です。(Metatronが書き間違えた...？)

> A+Bでお願いします。肝心のJevに関連した部分は公式SDK以外の外部ツールへの依存はしないようにしたいです。(Jev部分以外は例外)
> それと、ARCHITECTUREにAPI不使用と明記されているとありますが、"Anthropic API不使用"の間違いです。これは新しい判断ではなく最初からあった規律です。(Metatronが書き間違えた...？)
> それと、Jevは既に早期アクセスではなく誰でも使えるようになっています。ただ、現在はサインアップを一時的に停止しているらしい...？
> 詳しくはTypeSafeAIのXや公式サイトを探索してください。(https://x.com/typesafeai?s=20)

> Bとその他判断同梱でお願いします。肝心のJevに関連した部分は公式SDK以外の外部ツールへの依存はしないようにしたいです。(Jev部分以外は例外)
> ただ、Aにある既存のMCPツールの内容を丸パクリせず、独自のツールを構築したいです。(一部被りは致し方なし)
> それと、ARCHITECTUREにAPI不使用と明記されているとありますが、"Anthropic API不使用"の間違いです。これは新しい判断ではなく最初からあった規律です。(Metatronが書き間違えた...？)
> それと、Jevは既に早期アクセスではなく誰でも使えるようになっています。ただ、現在はサインアップを一時的に停止しているらしい...？
> 詳しくはTypeSafeAIのXや公式サイトを探索してください。(https://x.com/typesafeai?s=20)
>
> 名前についてですが、Jevrielで問題ないかと思います。

# AI

了解: B + 判断ツール同梱 / Jev 部は公式 SDK のみ / 独自ツール設計 / 名前 jevriel。

ARCHITECTURE の件: 原文は「Anthropic API を使えないユーザーも全プラグインを使える」で正しい。私の要約が「API 不使用」と略した誤り。Metatron の書き間違いではない。Jev は外部 API キー必須 → 規律違反ではないが、キー無しでも他プラグインを壊さない opt-in 設計は維持。

Jev の提供状況(GA / サインアップ停止)と公式 JS SDK の仕様を並列調査 → 設計へ。

了解: Playwright は MCP ではなく `playwright` TypeScript ライブラリを直接使用(B の前提と一致。調査依頼もライブラリ API で出している)。

調査 2 件の完了通知待ち。

調査 2 件(提供状況 / SDK・Playwright 仕様)の完了通知待ち。

## セッション 4: Jev API キー要件と実装方針(B)、プラグイン名 jevriel を決定

# phyllis998

> Jevrielに関してはJevのAPIキー必須で大丈夫です

# AI

了解: jevriel は `TYPESAFE_API_KEY` 必須。キー無し時の縮退動作は「明確なエラー返却」のみ(代替経路なし)。

調査 2 件の完了通知待ち。

調査 2 件の完了通知待ち。

調査 2 件の完了通知待ち。

調査 2 件の完了通知待ち。

## セッション 5: Jev 調査結果の設計反映、ツール設計の修正

# AI

調査 2 件の完了通知待ち。

調査 2 件の完了通知待ち。

提供状況: ユーザー認識ほぼ正。9/20 公式 X「waitlist 撤廃・誰でも可」→ 9/22「需要過多でサインアップ一時停止、既存は継続」。再開告知なし(9/25)。SDK `@typesafe-ai/sdk` 0.6.0(MIT、Node 20+)。

SDK・Playwright 仕様調査の完了通知待ち → 揃い次第、ツール設計案を提示。

SDK・Playwright 仕様調査の完了通知待ち。

調査完了。設計提示、セクション 1〜2。

## 1. 構成と配布

- `plugins/jevriel/` 新設。`.mcp.json` → `dist/server.mjs`(常駐 → dist/。raguel-mcp と同型、esbuild で単一ファイル化)
- Jev 部の依存: `@typesafe-ai/sdk` 0.6.0 のみ(zero-dep、MIT、バンドル同梱)。`TYPESAFE_API_KEY` 必須、無ければ起動時に明確なエラー
- Playwright 1.63: **バンドルせず動的 import**。解決順: 環境変数 `JEVRIEL_PLAYWRIGHT_ROOT` → 対象プロジェクトの `node_modules/playwright` → プラグイン内 `node_modules`(同梱 `scripts/setup-browser.sh` が `npm i playwright` + `npx playwright install chromium`)。未解決時はブラウザ系ツールだけ「未セットアップ」エラー、判断系は動く
- 理由: playwright-core は `__dirname` 依存でバンドル不可。Playwright 導入済みプロジェクトなら追加インストール不要
- pnpm-workspace 追加、ADR 1 本(外部有料 API 依存プラグインの位置づけ)

## 2. ツール一覧(独自設計、jev-mcp 非模倣)

**判断系**(state は名前付き JSON、1 問 = 1 判断。09-18 決定に従う)
- `jev_ask` — 生の noul/choice/score を直接投げる汎用口。唯一の被り。他ツールで足りない場合の逃げ道
- `route_task` — 作業説明+候補役割(担当表の role-id と条件文)→ Choice + confidence。orchestration-discipline の escalation/complex/normal/light 判定を 100ms で
- `triage_findings` — レビュー所見配列 → 各所見に Score(severity 4 段)+ Noul(actionable)。codiel の triage/fix-loop 向け
- `check_criteria` — 受け入れ基準配列+証拠(diff/テスト出力/文書)→ 基準ごと Noul(satisfied)。sandalphon/codiel ゲート向け
- `assess_action` — 実行予定のコマンド/差分 → Noul(destructive)+ Score(影響範囲)。PreToolUse hook からの利用を想定(hook 同梱は本設計の範囲外、ツールのみ)

**ブラウザ系**(Playwright ライブラリ直接、MCP 不使用)
- `browser_check` — URL 読込 → ariaSnapshot → assertions[] を Noul 判定。遷移なし。回帰向け
- `browser_run_goal` — URL + goal + assertions[] + inputs{} + maxSteps → Jev が次操作を Choice、到達を Noul、ループはコード。pass/fail/stuck + ステップ記録 + 失敗時スクショ/trace.zip

制約明記: Jev はテキスト生成不可 → 入力値は呼び出し側が `inputs` で全て渡す。画像判定不可。CJK は英語より精度低下 → state の instructions は英語固定、ユーザーデータはそのまま。

セクション 1〜2 承認可否 → 次: E2E ループ詳細・エラー処理・テスト。

# phyllis998

> 1について
> まずプラグインを導入した人は簡単にそのsetup-browser.shを実行できません。別のセットアップ方法を考えてください。
> 構成について、1本スキルを導入したいです。対応する判断を行う際に発火し、こういう時にこのツールを使うということを教えるものにしたいです。
>
> 2について
> 担当表はagent-policyの固有資産です。このプロジェクトのプラグインは独立運用前提の設計をするので担当表云々が出てきてはいけません。
> 同じ理由でCodiel向けという限定ツールを用意するわけにはいきません。(Codielに使えそうなツールを禁止するわけではありません)

# AI

修正版。

## 1. 構成と配布(修正)

- セットアップ用シェルスクリプト廃止。代わりに MCP ツール **`browser_setup`**: プラグイン所有のキャッシュ(`~/.cache/jevriel/`)へ固定版 `playwright` を `npm install` し `playwright install chromium` を実行。冪等、進捗と導入版を返す。Claude が実行 → 利用者の操作は許可プロンプトのみ
- Playwright 解決順: 対象プロジェクトの `node_modules/playwright` → `~/.cache/jevriel/` → 未解決ならブラウザ系ツールが「`browser_setup` を実行せよ」を返す
- スキル 1 本 **`jevriel:judging`**: 判断・分類・採点・合否確認・ブラウザ動作確認の場面で発火。どの場面でどのツールを使うか、state の組み方(名前付き JSON・1 問 1 判断・instructions は英語)、confidence の扱い、未セットアップ時の導線を教える
- 他は前回どおり(`.mcp.json` → `dist/server.mjs`、SDK 同梱、キー必須、ADR 1 本)

## 2. ツール一覧(汎用化。担当表・codiel への言及なし)

**判断系**
- `jev_ask` — 生の noul/choice/score
- `classify_items` — items[] × categories{} → 各 item に Choice + confidence。トークン予算(64k/32k)でリクエスト自動分割。1 item + 候補で「選択」にも使う
- `rank_items` — items[] + 基準 + 段階[] → 各 item に Score、降順整列。優先度付け・重要度判定
- `check_claims` — claims[] + evidence → 各 claim に Noul → 閾値で satisfied / unsatisfied / uncertain。検証・合否確認
- `assess_action` — 実行予定の操作(コマンド/差分/手順)+ 文脈 → Noul(破壊的・不可逆)+ Score(影響範囲)。安全ゲート

**ブラウザ系**
- `browser_setup` — 上記
- `browser_check` — URL → ariaSnapshot → assertions[] を Noul。遷移なし
- `browser_run_goal` — URL + goal + assertions[] + inputs{} + maxSteps → Jev が次操作 Choice・到達 Noul、ループはコード。pass/fail/stuck + 記録 + 失敗時スクショ/trace

承認可否 → 次: E2E ループ詳細・エラー処理・テスト。

セクション 1〜2 修正版の承認可否待ち。

## セッション 6: Jevriel 設計修正版セクション 1-2 の承認判定待機

# AI

セクション 1〜2 修正版の承認可否待ち。

セクション 1〜2 修正版の承認可否待ち。

# phyllis998

> 修正版の判断系ツールの中で、Codielに使えるもの、または修正前のCodiel専用ツールの中で汎用化できそうなものは、Codielとの併用時の使い方としてREADMEに記載する形にしたいです。

# AI

了解: README に「Codiel との併用」節。classify_items → 作業種別の振り分け、rank_items → レビュー所見の重要度付け、check_claims → 受け入れ基準・設計整合のゲート、assess_action → 破壊的コマンドの事前判定。ツール本体・スキル・references には codiel 名を書かない(README は docs 層なので可)。

セクション 1〜2 確定扱い。セクション 3。

## 3. E2E ループ(`browser_run_goal`)

**入力**: url / goal(英語命題)/ assertions[] / inputs{ラベル→値} / maxSteps(既定 15)/ allowedHosts(既定: 起点と同一ホスト)

**1 ステップ**
1. `page.ariaSnapshotJSON()`(1.63、JS 限定)→ 木を走査し操作可能ノード(link/button/textbox/checkbox/radio/combobox/option/tab 等)を抽出、自前 id `a1..aN` を付与。上限 200(Choice 255 制約)
2. state = `{goal, url, title, step, history[], page:{snapshot(予算内で切詰), actionables[{id,role,name}]}, inputKeys[]}`
3. Jev 1 リクエスト: `next` = Choice(a1..aN + done + stuck)、`reached` = Noul(goal 到達)
4. 実行: click / check / textbox なら inputs のどの値を入れるか Choice(+none)→ fill / combobox は選択肢を Choice → select。`waitForLoadState('load')` タイムアウト付き
5. 終了: reached ≥ 0.8 or done → assertions を Noul で一括判定 → pass/fail。stuck / maxSteps / 同一操作 3 連続 → stuck
6. 要素特定: `getByRole(role,{name,exact:true}).nth(i)`(同名重複は順序で)。`aria-ref=` は非公開契約 → 不使用

**証跡**: trace 常時開始。fail/stuck 時のみ screenshot + trace.zip を `.jevriel/runs/<ts>/` へ保存しパス返却。pass 時は破棄

**安全**: allowedHosts 外への遷移は中断(stuck)。ダイアログ自動 dismiss。ファイルアップロード非対応。ページ本文は `page` キー配下に隔離し instructions で data 扱いを明示(jaggedness により保証はない、README に明記)

## 4. エラー処理

- キー未設定: 全ツールが `TYPESAFE_API_KEY` 未設定エラー返却(サーバー自体は起動)
- SDK 例外: クラス名 + status + requestId を isError で返却。429/5xx/timeout は SDK 既定再試行(2 回)に委ねる
- トークン予算超過: 送信前に概算し classify/rank/check は自動分割、browser は snapshot 切詰
- Playwright 未解決: ブラウザ系のみ `browser_setup` 誘導エラー
- 閾値: Noul ≥ 0.8 真 / ≤ 0.2 偽 / 間は uncertain。ツール引数で上書き可

## 5. テスト

- vitest、`src/**/__test__/`。SDK は `TypeSafeClientConfig.fetch` 差替でモック(公式サポート)。ネットワーク不要
- snapshot→actionables 抽出は fixture JSON、ループはフェイク Page で。E2E テストは持たない(方針どおり)

承認可否 → 設計書執筆へ(harness-docs/、system-planner に委譲 → Haiku 理解レビュー → docs-reviewer → ユーザーレビュー)。

セクション 3〜5 の承認可否待ち。

## セッション 7: API テストツール設計でツール全 10 個確定

# AI

セクション 3〜5 の承認可否待ち。

セクション 3〜5 の承認可否待ち。

# phyllis998

> 承認します。
> それと追加のツールとして、API用のテストツールも用意したいです。様式としてはbrowser_run_goalと同じようにurlとgoalなどを渡すものになります。

# AI

承認受領。API テストツールを browser 系と対にして追加。

## 追加: API 系(Node 標準 `fetch`、依存なし)

- `api_check` — request{method,url,headers,body} を 1 回実行 → response{status,headers,body} を state に → assertions[] を Noul。`browser_check` の対
- `api_run_goal` — baseUrl + goal + **requests{名前→テンプレート}** + assertions[] + inputs{} + maxSteps。Jev が次に送る request を Choice(名前 + done + stuck)、到達を Noul。ループ・送信・履歴はコード。`browser_run_goal` の対

**設計上の制約**(Jev はテキスト生成不可)
- リクエスト本文は生成しない → テンプレートは呼び出し側が全て渡す。可変値は inputs から Jev が Choice で選ぶ
- 連鎖(作成→取得の id 受け渡し)は `{{steps.<名前>.body.<path>}}` をコードが決定的に解決。Jev は関与しない
- OpenAPI からの操作自動列挙は初版に含めない(テンプレート手書き。必要時に後続)
- allowedHosts 既定は baseUrl と同一ホスト。レスポンス本文は予算内で切詰め、`response` キー配下に隔離

ツール総数 10(判断 5 / ブラウザ 3 / API 2)。

この追加で確定 → 設計書執筆へ進む。異議なければ着手。

API 系追加案への異議有無の回答待ち。

## セッション 8: 設計書委譲・OpenAPI別設計への方針確定

# AI

API 系追加案への異議有無の回答待ち。

API 系追加案への異議有無の回答待ち。

# phyllis998

> OpenAPIからの操作自動列挙に関しても別設計をこのセッションで行います。こちらは引継ぎまでをお願いします。

# AI

設計書執筆を委譲。設計書・計画書は通常日本語で書く(原始人口調は適用しない)。

了解。セッションのゴール:

1. jevriel 初版: 設計書 → レビュー 2 段 → ユーザー承認 → 実装計画書 → 引継ぎ(handover + 実装プロンプト)
2. OpenAPI 操作自動列挙: 設計 → 同上 → 引継ぎ

初版設計書を執筆中(system-planner)。完了通知待ち。

設計書執筆の完了通知待ち。
