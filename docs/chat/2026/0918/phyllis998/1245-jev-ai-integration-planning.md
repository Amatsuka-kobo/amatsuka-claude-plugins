# Jev AI 統合戦略と役割設計

- 日付: 2026-09-18
- 参加者: phyllis998、AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: `plugins/agent-policy/README.md`、`plugins/agent-policy/references/orchestration-discipline.md`、agent-policy 現行定義
- セッション ID: de77ea61-8bcf-417b-ba59-b5dfee28af6f

---

## セッション 1: Jev AI 統合の役割割当と経路検討

# phyllis998

> 最近新しく出たJevというAIが話題です。
> これについてどんなものなのか詳しく教えてください。
> また、このリポジトリ内で使用する場合どのように使うのが最適か、仮にagent-policyに適用する場合どのような役割をあたえたらよりUXが良くなるか、考えてください。

# AI

調査と役割設計に入る。まず方針スキルを読み、並行で Jev の最新情報とこのリポの agent-policy 役割を取る。

方針スキル読了。規律と既存の役割設計を読み、Jev 調査は realtime-research へ委譲する。

規律確認。Jev 調査は realtime-research、役割設計は現行担当表と定義を突き合わせる。

推奨役割マップと現行定義を読む。Jev 調査は裏で走る。

Jev の一次情報は調査中。先に、このリポで載せる経路と役割割当の判断軸だけ置く。事実が揃い次第、製品の中身と推奨役割を足す。

---

## このリポで使う経路（Jev の正体に依存）

agent-policy は **Agent 定義を同梱しない**。モデル追加は「プラグインに焼き込む」ではなく、次のどれか。

1. **プロキシにモデルが乗る（Anthropic 互換 API）**  
   最短。`ANTHROPIC_BASE_URL` の `/v1/models` に ID が出れば、`/agent-policy:setup-agents` で役割を付けて `.claude/agents/` に定義を生やす。SessionStart が実在検証 → `custom-policy` が対応表注入。  
   今のこのリポはまさにこの形（Grok / GPT / Claude 混在）。

2. **推奨カタログへ正式追加**（`plugins/agent-policy/src/agents/policies.ts` の `MODELS` / `RECOMMENDED` / `Vendor`）  
   利用者が毎回手で選ばなくて済むようにするときだけ。テストが「10 モデル」を固定しているので、追加はパッチではなく minor 相当。ベンダーが gpt/grok/gemini/claude の外なら `Vendor` 型も拡張。

3. **別製品（Devin / Jules 型の独立エージェント）**  
   agent-policy の委譲先にならない。こちらは Claude Code のサブエージェントハーネス。別ランタイムを役割に載せる設計は、過去に API/CLI 前提で失敗している（Codiel と同じ轍）。**役割にしない。**

4. **独自役割をプロジェクト断片で足す**  
   `.claude/agent-policy/roles/` に `id` を置けば setup の選択肢に出る。17 役割の置換も可。新モデル専用の仕事が既存 RoleId に収まらないときだけ。

---

## 現行配置（このリポ）

判断軸は「能力」より **ベンダー分離** と **失敗コスト**。

- **Grok** (`claude-grok-4-6`): `explore` / `realtime-research` / `independent-review`  
  探索・調査のスループット。独立レビューは実装側（GPT）・計画側（Claude）とベンダーをずらすため。
- **GPT**: 実装一式（complex/normal/light/escalation）+ 文書 + 最終レビュー/ゲート
- **Claude**: 設計統括・計画・知識抽出・コードレビュー

`RECOMMENDED` 上の Grok は `normal-impl` / `light-impl` / `explore` / `realtime-research` / `independent-review`。このリポは実装を GPT に寄せ、Grok は読み取り帯に閉じている。

---

## 役割を決める軸（Jev が来たらここに当てる）

推奨を先に出さない。軸が埋まってから選ぶ。

- **独立性**: 実装ベンダーと違うか。違う → `independent-review` が最優先候補。今 Grok が担っている席。
- **Web/最新情報**: 強い → `realtime-research`（今 Grok）。主セッションが Grok なら、調査を別ベンダーへ移す意味が出る。
- **安・速・ツール多用**: `explore` または `light-impl`。探索実働は並列が多く、レイテンシと単価が UX に直撃する。
- **コーディング本体が強い**: `normal-impl` か `complex-impl`。ただしこのリポの実装は GPT に寄っている。載せ替えは回帰コストが大きい。
- **長文・計画**: `design-plan` / `explore-lead` は今 Claude Opus 相当。ここを動かすのは最終手段。
- **ゲート/最終レビュー**: 失敗コスト最大。新モデル初手では載せない。

Jev が「モデル」なら setup-agents で 1 役割だけ載せて観測。カタログ追加はその後。  
Jev が「独立エージェント製品」なら、このリポでは使わない（別窓・別ワークフロー）。

調査側の一次情報が返り次第、上記の軸に当てて推奨役割を1つに絞る。

調査継続中。一次情報が返り次第、Jev の中身と推奨役割を足す。

## セッション 2: Jev のリクエスト形式と運用ガイドライン

# AI

記録完了。Jev 調査は継続。一次情報が来たら本編を足す。

Jev 調査は継続。一次情報が来たら本編を足す。

調査結果到着。Jev はチャットモデルではない。公式 docs で Claude Code 組み込みと API 形を裏取りしてから、このリポでの使い方と役割を確定する。

docs を Context7 で取る。先の fetch は混線したので公式だけ見る。

前ターンの枠は捨てる。Jev は **サブエージェントの `model` に載せる物ではない**。チャットモデルでもコーディングエージェントでもない。

`★ Insight ─────────────────────────────────────`
Jev は「文章を出す LLM」ではなく、「コードが分岐するための判断関数」。Choice / Score / Noul だけ返す。agent-policy の 17 役割は全部「文章かファイルを出す」。形が合わない。
`─────────────────────────────────────────────────`

---

## Jev は何か

TypeSafe AI（SF）のフラッグシップ。**2026-09-15** ステルス解除。カテゴリ名は **System One Model**。現行 ID `jev-1.13.0`（`jev-latest`）。

公式の定義: 非構造化 state を入れ、型付きの確率的判断を出す。LLM は人間が読む文章を出す。コードが消費する判断に使うと、パースが要る。Jev はその不一致を消す。

3 primitive。1 リクエストに混在可。同じ state を並列・独立評価。

- **Choice** — 定義済み選択肢から 1 つ。`choice` / `probabilities` / `confidence`
- **Score** — 順序付きルーブリック。`score` / `probabilities` / `confidence`
- **Noul** — 命題が真か。0–1

API は `POST https://api.typesafe.ai/v1/systemone`。OpenAI Chat Completions / Anthropic Messages **非互換**。Vercel AI Gateway も `typesafe-ai/jev` を **experimental evaluate** として載せる。チャット completion では使えない。

数字（公式 models ページ）:

- 入力 **$0.042 / 1M tokens**。出力は課金しない
- リクエスト全体 **64k**。state + 最長質問 **32k**
- E2E **70–500ms**（自社測定）
- テキストのみ。画像なし。顧客 Fine-tune なし
- 英語が最も強い。CJK は「動くが同等ではない。本番前にテスト」

公式が認める弱み（jaggedness、2026-09-17）: 字義どおりに読む（意図を補完しない）、計算不可、多ホップで落ちる、巨大 state で精度低下、敵対的入力に弱い、**テキスト生成は訓練していない**。「幻覚ゼロ」は型エラーが構造上起きない、という意味。正しい型の誤答は出せる。

開発: CEO Diogo Almeida は InstructGPT（arXiv:2203.02155）第4著者。DCVC 主導 **$40M Series Seed**（2026-09-15）。Forbes の約 $200M 評価は本文未取得。早期アクセス / ウェイトリスト。GA 未発表。

日本語圏の起点は日本独自リークではない。09-15 英語圏ローンチの輸入。GIGAZINE 09-16、PC Watch 09-17。HN は取得時 1866 points。

同名ノイズ: 日本脳炎ウイルス JEV、旧 Typesafe（Scala/Akka）、Jeeva AI。今回の話題は typesafe.ai の Jev。

---

## このリポでどう使うか

推奨を先に書く。

**推奨: agent-policy の役割カタログには載せない。公式スキルを任意依存で足し、オーケストレーター（またはフック）が判断関数として呼ぶ。**

理由: このリポの custom 構成は「プロキシの `/v1/models` に載る Anthropic 互換モデル」を `.claude/agents/` の `model` に書く。Jev はその形を満たさない。文章もツールループも出ない。`MODELS` に `jev` を足して setup-agents のラジオに出すのは、経路が違う物を同じ棚に置くことになる。

使い方の段階:

1. **試す** — 公式スキル。ホスト（Claude Code）が Jev を呼ぶ形。公式の想定どおり。
   ```bash
   claude plugin marketplace add typesafe-ai/skills
   claude plugin install typesafe@typesafe-ai
   ```
   キーは `TYPESAFE_API_KEY`（console.typesafe.ai）。ウェイトリスト前提。
2. **常設するなら** — リポ規約どおり、AI が使うなら `tools/` の Python（`typesafe-sdk`）、人が手動なら `scripts/`。フックから呼ぶなら PreToolUse の分類器。いずれも **Agent 定義の `model` ではない**。
3. **やらない**
   - `plugins/agent-policy/src/agents/policies.ts` の `MODELS` / `Vendor` に追加
   - Raguel（`evaluate_plan` / `evaluate_code` / `evaluate_decision`）の置換。Codiel は API 前提にしない
   - 未信頼の Issue 本文を無加工で state にする（注入耐性が弱い）
   - 日本語本番投入を実測なしでやる（CJK 公式警告）

このリポで効くスロット（優先順）:

- **役割ルーティング** — 公式 quickstart の「どの部署か」Choice が、担当表の RoleId 選択と同じ形。70–500ms、複数問を並列。
- **高コストレビューの間引き** — independent-review / gate-review の前に Score + confidence。高いときだけ Grok/GPT を起こす。待ち時間の体感が一番変わる。
- **分類・タグ** — raphael 抗体、metatron gotcha タグ、prompt-smith の採点。本体の文章は別モデル。

効かないスロット: 実装、設計書執筆、探索報告、コードレビュー本文、アドバイザー助言。全部テキスト成果物。

---

## agent-policy に載せるなら、どの役割か

結論: **17 役割のどれにも割り当てない。** UX が良くなる当て方は「役割の中」ではなく「役割の下」。

判断を左右する軸:

- API 形が Agent 定義（Anthropic Messages + 文章 + tools）と合うか
- 成果物がテキストか、型付き判断か
- 既存 Raguel と二重化しないか
- 日本語精度
- 速さ・単価が「呼ぶ回数を増やす」方向に効くか

案の評価:

- **`model: jev` を既存役割に付ける** — 不可。Messages 非互換。探索・レビュー・実装が全部死ぬ
- **`independent-review` 本体を置換** — 不可。成果物は反論の文章。今の Grok 配置（実装=GPT・計画=Claude とベンダーをずらす）を壊す
- **`gate-review` 本体を置換** — 不可。最終判断の説明が要る。Raguel が既に PROCEED/ASK/STOP をローカルでやる
- **`advisor` / `doc-review`** — 不可。意図補完が公式の弱み
- **`realtime-research` / `explore`** — 不可。Web もコード走査も報告文も出ない
- **新 RoleId `decision-gate` を Agent 定義として足す** — 形だけ似せる。実体はツール呼び出しなのに委譲先解決（合成・model 注入）に乗る。UX 悪化
- **オーケストレーターの下の決定レイヤ（推奨）** — 役割は今のまま。Jev は「どの役割を起こすか」「高コストレビューを起こすか」だけ返す。公式スキル / `tools/` から呼ぶ

精神的なメタファーが要るなら、一番近いのは **gate-review と independent-review の前段センサ**。役割そのものではない。

UX が上がる理由（なぜこの当て方か）:

- 今の痛みは「役割を起こすコスト」と「レビュー待ち」。Jev はそこを 70–500ms・出力無料で切る
- 今の Grok 3 席（explore / realtime-research / independent-review）はテキスト実働。Jev で置換すると報告が消える
- 公式自身が「エージェントを作るモデルではない」「次アクションを自分で選ばない」と書く。役割に置くと、その契約を破る

入れるとしてもデフォルトオフ。キーがあるときだけ。CJK は実際の計画文・PR 文で Score/Choice を実測してから。confidence 低は「わからない」として高いモデルへエスカレーション。Jev の数値を「安全です」とユーザーへ出さない。

---

前ターンで示した「プロキシに載れば setup-agents」は、**チャット互換モデル用**。Jev には当てない。

次に進むならどちらか。コードは指示があるまで触らない。

- 公式スキルを任意依存で足す面だけ設計する
- このリポの計画文で Choice/Score の質問草案を書き、CJK 実測の材料にする

Sources: [TypeSafe intro](https://docs.typesafe.ai/introduction) · [System One](https://docs.typesafe.ai/concepts/system-one) · [Quickstart / Claude Code plugin](https://docs.typesafe.ai/introduction/quickstart) · [Models](https://docs.typesafe.ai/models) · [Jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) · [Launch blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev) · [DCVC](https://www.dcvc.com/news-insights/typesafe-emerges-from-stealth-with-a-new-way-of-doing-ai/) · [Vercel changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway) · [GIGAZINE](https://gigazine.net/news/20260916-system-one-jev/) · [PC Watch](https://pc.watch.impress.co.jp/docs/news/2141599.html)

---

statusline 未設定。genshijin のモードバッジを出すなら `~/.claude/settings.json` に:

```json
"statusLine": { "type": "command", "command": "bash \"/home/hiro0209/.claude/plugins/cache/genshijin/genshijin/1.5.0/hooks/genshijin-statusline.sh\"" }
```

# phyllis998

> Jevを使う場合、APIを使用するしか現状は方法がないということですか？
> では、そのリクエストの形はどうするのがよいですか？

# AI

API 以外の経路があるか、リクエストの正本を公式 docs で取る。

推論そのものは **ホスト API 以外に無い**。オープンウェイト無し。ローカル推論無し。Anthropic / OpenAI のチャット互換エンドポイントも無し。

あるのは **同じ API への着地点の違い** だけ。

- 生 HTTP: `POST https://api.typesafe.ai/v1/systemone` + `Authorization: Bearer`
- 公式 SDK: Python `typesafe-sdk` / JS `@typesafe-ai/sdk`（中身は上記）
- Claude Code 公式スキル: エージェントへ「呼べ」と書くだけ。キーは `TYPESAFE_API_KEY`。推論はホストへ行く
- Vercel / Netlify AI Gateway: 課金・認証の置き場所が変わる。チャット completion ではない。evaluate
- Console / Playground: 人手確認用。このリポの実行経路ではない

このリポなら **生 curl をオーケストレーターが毎回頭で組まない**。規約どおり AI 用は `tools/` の Python が SDK を巻く。スキルは「いつ呼ぶか」だけ。Raguel / Codiel には載せない（API 前提にしない）。

`★ Insight ─────────────────────────────────────`
Jev の単位は「プロンプト1本」ではなく「state 1個 + 原子質問 n 個」。合成はモデルに書かない。コード側で confidence と閾値を見る。
`─────────────────────────────────────────────────`

---

## リクエストの形（推奨は1パターン）

公式 quickstart と同じ3キー。state は **文字列1本にしない**。名前付き JSON。質問は **1問=1判断**。instructions は対象フィールドを `` `backtick.path` `` で指す。

このリポ向け（役割ルーティング + 高コストレビューの間引き）:

```json
{
  "model": "jev-latest",
  "state": {
    "user_request": "（ユーザー発話。短く。全文ログを積まない）",
    "covered_roles": [
      "complex-impl",
      "normal-impl",
      "design-plan",
      "doc-writing",
      "explore",
      "realtime-research",
      "independent-review",
      "code-review",
      "gate-review"
    ],
    "constraints": {
      "orchestration_only": true,
      "no_raguel_replacement": true
    }
  },
  "questions": {
    "primary_role": {
      "type": "choice",
      "instructions": "Which RoleId in `covered_roles` should run first for `user_request`?",
      "criteria": {
        "complex-impl": "Architecture or multi-component coding.",
        "normal-impl": "Single-component coding, no design tradeoff.",
        "design-plan": "Write a design or WBS.",
        "doc-writing": "Write a document after content is decided.",
        "explore": "Read-only codebase search.",
        "realtime-research": "External current information.",
        "independent-review": "Adversarial review of a design/plan.",
        "code-review": "Review a code diff.",
        "gate-review": "Go/no-go on a high-risk design.",
        "none": "Orchestrator should answer without a subagent."
      }
    },
    "needs_independent_review": {
      "type": "noul",
      "instructions": "Does `user_request` require an independent review of a design or plan before implementation?"
    },
    "risk": {
      "type": "score",
      "instructions": "If this work is done wrong, how severe is the damage to the repo?",
      "criteria": [
        "None: reversible local edit.",
        "Low: one plugin, tests catch it.",
        "Medium: cross-plugin contract or hooks.",
        "High: architecture, marketplace, or user-facing policy."
      ]
    }
  }
}
```

HTTP:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

返ってくる物（公式例の形）:

- Choice → `choice` + `probabilities` + `confidence`
- Score → 連続値 `score`（例 `1.035`）+ `legend` + `confidence`
- Noul → `noul`（0–1）。boolean ではない
- `usage.input_tokens` / `output_tokens`

---

## 形を崩さない規則

公式 how-to-build の核: **数秒でできる単一判断に分解し、合成はコード**。

やる:

- state をフィールド分割。質問は `` `user_request` `` のようにパスで指す
- 独立な問いを **同じリクエストに並列**（質問を足しても遅延はほぼ増えない、が売り）
- 採否はこちら。例: `confidence < 0.6` または Choice の最大確率が僅差 → 既存の Grok/GPT へエスカレーション
- `needs_independent_review.noul` と `risk.score` をコードで AND/OR。Jev に「レビューすべきか総合判断して」と聞かない

やらない:

- 「実装しつつレビューもして、方針も決めて」を1 Choice に詰める
- state に会話全文・巨大 diff・無関係ファイルを積む（context rot、64k / 質問側 32k）
- 計算・件数・多ホップを質問にする
- 日本語の意図補完を期待する（字義どおり。CJK は公式が本番前テスト指定）
- 未信頼 Issue 本文を無加工で state にする（注入に弱い）

SDK で書くなら同じ形:

```python
response = client.system_one(state={...}, questions={
    "primary_role": Choice(instructions="...", criteria={...}),
    "needs_independent_review": Noul(instructions="..."),
    "risk": Score(instructions="...", criteria=[...]),
})
```

キー無し・429 は失敗として扱い、Jev 無しで今の担当表に倒す。必須ゲートにしない。

Sources: [API](https://docs.typesafe.ai/api) · [Quickstart](https://docs.typesafe.ai/introduction/quickstart) · [How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) · [Primitives](https://docs.typesafe.ai/primitives) · [Agent skill](https://docs.typesafe.ai/agent-skill)

（応答は上で完了。）

## セッション 3: Jev(Typesafe AI)の能力と統合設計、API形式と規則

# AI

待機。次の依頼を待つ。

次の依頼を待つ。

# phyllis998

> 一部情報で、"テキストの生成はできない"とありました。
> 要するにコーディングはできず、計算・判断のみということで合ってますか？

# AI

半分合って、半分違う。

**コードを書く**のはできない。公式どおりテキスト生成を訓練していない。パッチ・関数・説明文も出ない。

**計算もできない。** jaggedness に「Jev is not a calculator」とある。件数・日付の算術・多ホップも弱い。

できるのは **判断だけ**。既存の state を見て、Choice / Score / Noul のどれかを返す。コードを *書いて* はいけないが、渡したコードを *見て* 「この引数はスキーマに合うか」と問う用途はある。書く側は別モデル、見る側が Jev。

要するに: コーディング不可。計算も不可。判断のみ。

（応答は上で完了。）

## セッション 4: Jev の処理能力の限界確認

# AI

次の依頼を待つ。

次の依頼を待つ。

# phyllis998

> 例えば、"このスクリプトをこうしたいんだけどどうすればいい？"と投げると、"こうすればよい"という指針が構造的に返ってくる。または"このコードのレビューをしてほしい"と投げると、レビュー結果が。このような理解で合ってますか？

# AI

合っていない。その投げ方はチャットモデルの使い方。Jev は受けない。

「どうすればいい」に対して手順や指針の文章は出ない。「レビューして」に対して指摘コメントも出ない。どちらもテキスト生成。訓練していない。

Jev に渡せるのは、**こちらが先に型を決めた質問**だけ。

- 「このスクリプトをこうしたい」→ 先に選択肢を列挙する。例: Choice `{rewrite-in-place, extract-function, leave-as-is}`、Noul「要求は既存の引数だけで足りるか」、Score「変更の破壊度」。返るのは ID と確率。手順文は別モデルが書く。
- 「レビューして」→ 先にルーブリックを置く。例: Score「入力検証の強さ」、Noul「シークレットが埋まっている」、Choice `{block, comment, ok}`。返るのは数値とラベル。`path:line` の指摘文は出ない。

自然文の依頼をそのまま state に投げて答えが構造化される、ではない。**質問設計が本体**。依頼文の解釈も、成果物の文章化も、Claude / GPT / Grok 側。

（応答は上で完了。）

## セッション 5: 型指定質問による構造化応答メカニズムの確認

# phyllis998

> すみません、その投げ方で合っていないのは承知しています。ようするにそういう意味の構造的リクエストを送るとそう返ってくるのかの確認です。

# AI

その理解で合っている。**先に型を決めた質問を送ると、その型の答えが返る。**

「どう直すか」相当なら、こちらが列挙した手の中から Choice が1つ（と確率・confidence）を返す。「レビュー」相当なら、こちらが置いた軸の Score / Noul / Choice が返る。

返らないもの: 聞いていない軸、列挙していない選択肢、手順の文章、`path:line` の指摘。聞いたスロットだけが埋まる。正しい型の誤答はありうるので、confidence が低いときは別モデルへ倒す。

次の依頼を待つ。

## セッション 6: 型指定質問による構造化応答メカニズムの確認

# AI

（応答は上で完了。）

次の依頼を待つ。

次の依頼を待つ。

# phyllis998

> 公式のSDKやMCPはありますか？

# AI

公式の SDK / MCP の有無を docs で確認する。

**公式 SDK はある。公式 MCP は無い。**

公式クライアントは2つ。どちらも `POST /v1/systemone` の型付きラッパ。リトライ付き。

- Python: `pip install typesafe-sdk`（Python >= 3.10）。`TYPESAFE_API_KEY`
- JS/TS: `npm install @typesafe-ai/sdk`（Node 20+）

他言語は公式 SDK 無し。HTTP を直叩き。

エージェント向けの公式物は MCP ではなく **skill**。質問の型とパターンをエージェントに教える。推論は結局 API / SDK。

```bash
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

MCP はコミュニティ実装が複数ある（`blakestone-x/jev-mcp` 等）。`github.com/typesafe-ai` 配下には無い。このリポに載せるなら公式 Python SDK を `tools/` で巻く。コミュニティ MCP は第三者。

Sources: [Client SDKs](https://docs.typesafe.ai/sdk) · [Python](https://docs.typesafe.ai/sdk/python) · [JavaScript](https://docs.typesafe.ai/sdk/javascript) · [Agent skill](https://docs.typesafe.ai/agent-skill) · [HTTP API](https://docs.typesafe.ai/api) · [typesafe-ai org](https://github.com/orgs/typesafe-ai/repositories)

（応答は上で完了。）

## セッション 7: Jev の判断能力比較調査と公式 SDK/MCP の確認

# AI

次の依頼を待つ。

次の依頼を待つ。

# phyllis998

> Jevの判断能力が、Fable5.1,Opus5,Sonnet5,GPT 6 Astra,GPT 5.6 Sol,GPT 5.6 Terra,Grok 4.6と比べてどうなのか、調査・比較してください。

# AI

判断能力の比較は realtime-research へ委譲する。公式 evals と独立ベンチを並行で取る。非対称（Jev=型付き判断、他=生成モデル）を先に固定する。

比較調査は裏で走らせた。先に軸だけ固定する。数字は一次情報が揃ってから載せる。

比較は同じ土俵ではない。

- Jev: Choice / Score / Noul の型付き判断。文章なし。確率と confidence がネイティブ。
- 他7つ: 文章・コード・ツールを出す生成モデル。判断させるときは JSON を書かせてパースする。

公式が既に出している数字は、ユーザー指定の相手ではない。cookbook の対比相手は `claude-haiku-4-5` / `gpt-5.4-mini` / `gpt-5.5` / `claude-opus-4-8`。速度・コストの自社測定（14問ルーブリック、n=15）。Jev 111ms / $0.000043 に対し Haiku 13–16x 遅い・38–42x 高い、Opus 4.8 reasoning は 125x / 805x。精度の優劣はこの表に無い。ローンチブログの 193x / 444x は GPT-6 Astra と Fable 5.1 の平均との自社 workflow。バイアス注記あり。独立ベンチは前回調査時点で未確認。

ユーザー指定の7モデルとの判断精度は、公式・独立の一次情報を取ってから突き合わせる。

比較の一次情報は調査継続。揃い次第、7モデルとの突き合わせを返す。

## セッション 8: Jev 料金調査を並列化、公式 SDK/MCP を確認

# AI

比較調査は継続。一次情報が来たら突き合わせを返す。

比較調査は継続。一次情報が来たら突き合わせを返す。

# phyllis998

> 追加で、APIリクエストの料金体系を調べてほしいです。
> サブスクはあるのか、従量課金だけなのか、どうやって契約するのかなどお願いします。

# AI

料金・契約は公式 docs を取り、走っている調査へ範囲を足す。

# phyllis998

> 並列で別エージェントをたててほしいです

# AI

料金・契約は別エージェントで並列に立てる。比較調査には足さない。

料金調査は別エージェントで起動済み。比較側に送った料金追加は取り下げ、判断比較だけに戻す。

並列2本。

- 判断能力比較: Fable 5.1 / Opus 5 / Sonnet 5 / GPT 6 Astra / GPT 5.6 Sol / GPT 5.6 Terra / Grok 4.6。継続中
- 料金・契約: 別エージェントを新規起動。従量/サブスク、契約手順、無料枠、Gateway 経由、レート制限

先に比較側へ料金を足す指示を出していた。取り消した。料金はその別エージェントだけが返す。

揃い次第、本編に載せる。

## セッション 9: Jev セキュリティ調査を3本目として並列起動

# AI

調査2本はバックグラウンド継続。完了通知が来たら突き合わせを返す。ポーリングはしない。

# phyllis998

> また追加で、セキュリティ的にはどうなのかを並列で調べてほしいです。
> 情報の漏洩を起こすことはないのか、データが日本国外に保存されるのか、機密情報の取り扱いはどうなっているかなどを重点的に、他にも気になる観点などがあればお願いします。

# AI

セキュリティは3本目を並列で立てる。比較・料金には混ぜない。

セキュリティ調査を3本目として起動した。既存2本には足していない。

いま並列3本:

- 判断能力比較（Fable 5.1 / Opus 5 / Sonnet 5 / GPT 6 Astra / Sol / Terra / Grok 4.6）
- 料金・契約
- セキュリティ・プライバシー（学習利用、保存リージョン、機密、ZDR、認証、Gateway 経由、準拠法）

完了通知が来たものから本編に載せる。ポーリングはしない。

調査3本は継続。完了通知が来たら本編に載せる。

## セッション 10: Jevoブラウザ/E2E能力、4本目並列調査立ち上げ

# AI

調査3本は継続。完了通知が来たら本編に載せる。

調査3本は継続。完了通知が来たら本編に載せる。

# phyllis998

> 追加調査を並列でお願いします。
> Jevに対してブラウザ操作などを依頼してE2Eテストを行うことなどはできますか？
> Jev単体や、Playwrightなどを使う場合でも何でもよいですが、こちらも調べてください。

> 追加調査を並列でお願いします。
> Jevに対してブラウザ操作などを依頼してE2Eテストを行うことなどはできますか？
> Jev単体や、Playwrightなどを使う場合でも、何でもよいですが、こちらも調べてください。

> 追加調査を並列でお願いします。
> Jevに対してブラウザ操作などを依頼してE2Eテストを行うことなどはできますか？
> Jev単体や、Playwrightなどを使う場合でも、何でもよいですが、高速かつ安価にブラウザ判断を行えるかを調べてください。

# AI

ブラウザ/E2E は4本目を並列で立てる。既存3本には混ぜない。

# phyllis998

> This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.
>
> Summary:
> 1. Primary Request and Intent:
>    - Explain the newly discussed AI “Jev”: what it is, how to use it in this repo (amatsuka-claude-plugins), and if applied to agent-policy, which role would improve UX.
>    - Confirm whether using Jev requires the hosted API, and what a good request shape is.
>    - Confirm capability bounds: no text generation ⇒ no coding? only calculation + judgment?
>    - Confirm that a *structured* request meaning “how should I change this script” / “review this code” yields structured answers of that kind (not a chat throw).
>    - Confirm official SDK and official MCP existence.
>    - Compare Jev’s *judgment* ability vs Fable 5.1, Opus 5, Sonnet 5, GPT 6 Astra, GPT 5.6 Sol, GPT 5.6 Terra, Grok 4.6.
>    - Additionally (parallel separate agent): API pricing — subscription vs usage, how to contract, free tier, gateways, rate limits.
>    - Additionally (parallel separate agent): security/privacy — leakage, data location vs Japan, confidential handling, plus other notable security angles.
>    - Additionally (this turn): can Jev do browser ops / E2E (alone or with Playwright, etc.), and can browser judgment be done fast and cheap. This 4th parallel investigation was requested but not launched because the compact turn forbids tools.
>    - Session is advisory only: user did not ask to implement or edit repo files. Do not change agent-policy MODELS or Raguel.
>
> 2. Key Technical Concepts:
>    - Jev / TypeSafe AI / System One: hosted decision model, not a chat LLM, not a coding agent, not an IDE, not a harness.
>    - Launch 2026-09-15; company TypeSafe AI (SF); CEO Diogo Almeida (InstructGPT 4th author); COO Sasha Sheng; CTO Erik Gafni; DCVC $40M Series Seed; Forbes ~$200M unverified (403).
>    - Model IDs: jev-1.13.0, aliases jev-latest / jev-preview (currently same).
>    - API: POST https://api.typesafe.ai/v1/systemone, Authorization: Bearer, Content-Type application/json. Not OpenAI Chat Completions / Anthropic Messages compatible. Vercel: experimental evaluate `typesafe-ai/jev`, not chat completion.
>    - Primitives: Choice (one of predefined options + probabilities + confidence), Score (ordered rubric + continuous score + confidence), Noul (0–1 truth of a proposition; not boolean; no separate confidence in some docs). Multiple questions, same state, parallel independent evaluation.
>    - State: string | JSON object | array | null. Prefer named JSON. Instructions reference fields with backtick dot-and-index paths.
>    - Official how-to-build: atomic questions a knowledgeable person could answer in seconds; compose/weight in code, not in the model.
>    - Cannot: generate text/code, tool-loop, calculate (“Jev is not a calculator”), multi-hop, intent inference, CJK at English parity, adversarial robustness.
>    - “Zero hallucination” officially = no type errors; wrong answers of the correct type remain possible.
>    - Pricing (official models page, earlier research): input $42 / billion tokens = $0.042 / 1M; output not billed (“too cheap to meter” / FREE). Context 64k request, 32k state+longest question. 250k tok/s, 1200 RPM, 429 on exceed. Text-only. No customer fine-tune. Customer req/resp not used for training (models page); Enterprise ZDR mentioned in Legal (details pending security agent).
>    - Official clients: Python `typesafe-sdk` (Python >= 3.10, TYPESAFE_API_KEY), JS `@typesafe-ai/sdk` (Node 20+). HTTP for other languages.
>    - Official agent integration: Claude Code skill `claude plugin marketplace add typesafe-ai/skills` then `claude plugin install typesafe@typesafe-ai`. Also `npx skills add typesafe-ai/skills --skill typesafe-ai`. Teaches question design; still calls hosted API. No official MCP under github.com/typesafe-ai. Community MCPs exist (blakestone-x/jev-mcp, itsmostafa/typesafe-mcp, etc.).
>    - Console/keys: https://console.typesafe.ai/settings/keys ; early access / waitlist; GA date unannounced.
>    - agent-policy: 17 RoleIds; custom-policy resolves via .claude/agents markers; plugin does not bundle Agent defs; MODELS has 10 ids (opus/sonnet/haiku/fable/gpt-sol/terra/luna/astra/grok/gemini-flash); RECOMMENDED grok: normal-impl, light-impl, explore, realtime-research, independent-review. This repo: Grok on explore / realtime-research / independent-review; GPT on impl + doc-writing + final/gate review; Claude on design-plan, explore-lead, doc-review, code-review.
>    - Codiel/Raguel: must not become API/CLI-dependent; Raguel already returns PROCEED/ASK/STOP locally — do not replace with Jev.
>    - Repo convention: AI tools in tools/ as Python; human scripts in scripts/.
>    - Asymmetry of “judgment”: Jev native typed probs vs chat models that generate then parse.
>
> 3. Files and Code Sections:
>    - No implementation edits this session.
>    - Read (analysis only):
>      - plugins/agent-policy/skills/custom-policy (orchestration: include サブエージェントは clauses; no model override; tools-only in prompt).
>      - plugins/agent-policy/references/orchestration-discipline.md — role table, 委譲先の解決, 実行モデル 8-row flow, 分析はオーケストレーター.
>      - plugins/agent-policy/README.md — injection none/claude/custom; 17 roles; 10 recommended model IDs; gemini-flash Antigravity 429 caveat.
>      - plugins/agent-policy/src/agents/policies.ts — MODELS, ASSIGNMENTS, RECOMMENDED (lines 158–176).
>      - plugins/agent-policy/src/agents/roles.ts — RoleId, kind impl/readonly, tools per role.
>      - plugins/agent-policy/src/setup-agents.ts — recommendedRolesFor, Vendor colors.
>      - plugins/agent-policy/src/agents/fragments.ts — Vendor = gpt|grok|gemini|claude|none.
>      - plugins/agent-policy/.claude-plugin/plugin.json — version 0.19.5-dev.
>      - .claude/agents/realtime-researcher.md, general-explore.md, docs-reviewer.md — model claude-grok-4-6, vendor grok.
>      - plugins/agent-policy/assets/roles/ja/explore.md — fragment shape.
>      - Memory: agent-policy-external-agent-design.md, codex-agents-symlink.md, MEMORY.md index (Codiel no API; agent-policy no bundled agents; rejected assignment-map etc.).
>    - Example request recommended to user (not written to disk):
> ```json
> {
>   "model": "jev-latest",
>   "state": {
>     "user_request": "（短く。全文ログを積まない）",
>     "covered_roles": ["complex-impl", "normal-impl", "design-plan", "doc-writing", "explore", "realtime-research", "independent-review", "code-review", "gate-review"],
>     "constraints": { "orchestration_only": true, "no_raguel_replacement": true }
>   },
>   "questions": {
>     "primary_role": { "type": "choice", "instructions": "Which RoleId in `covered_roles` should run first for `user_request`?", "criteria": { "...": "..." } },
>     "needs_independent_review": { "type": "noul", "instructions": "Does `user_request` require an independent review of a design or plan before implementation?" },
>     "risk": { "type": "score", "instructions": "If this work is done wrong, how severe is the damage to the repo?", "criteria": ["None: ...", "Low: ...", "Medium: ...", "High: ..."] }
>   }
> }
> ```
>    - Official cookbook (Context7, not user-requested models): typesafe_noul 111ms / $0.000043 vs haiku-4-5 ~13–16x slower / ~38–42x cost, opus-4-8-reasoning 125x / 805x; n=15, 14-question rubric; accuracy not in that table.
>    - Chat recorder (internal, do not mention to user): docs/chat/2026/0918/phyllis998/1245-jev-ai-integration-planning.md sessions 1–9.
>
> 4. Errors and fixes:
>    - Early interim answer treated Jev as a possible Anthropic-compatible proxy model for setup-agents/MODELS. Retracted after researcher: Jev is not a subagent model.
>    - User’s “計算・判断のみ” — assistant corrected: calculation is also forbidden; judgment only.
>    - First reply to “how to change this script / review” assumed chat-style throw; user said they already knew that and meant structured requests. Assistant confirmed structured-slot filling only.
>    - Billing add-on was SendMessage’d to the comparison agent; user interrupted and demanded a *separate* parallel agent. Assistant spawned ad0348643c817bf7e and told comparison agent to drop billing.
>    - WebFetch of docs.typesafe.ai/models was user-rejected. Stopped.
>    - TaskOutput polling of researchers was user-rejected. Do not poll; wait for completion notifications.
>    - First docs.typesafe.ai WebFetch earlier in session appeared contaminated (returned assistant-draft-like text). Relied on Context7 + researcher primary sources instead.
>    - Comparison researcher Context7 cookbook uses older model IDs (haiku-4-5, gpt-5.4-mini, gpt-5.5, opus-4-8), not the user’s seven models — must not present those as the requested comparison.
>    - Genshijin statusline setup was suggested once (settings.json command path); not confirmed by user.
>
> 5. Problem Solving:
>    - Identified Jev vs Japanese encephalitis virus / old Typesafe (Scala) / Jeeva AI name collisions.
>    - Fit to this repo: decision layer under orchestrator, not a RoleId; official skill optional; tools/ Python SDK if standing; never Raguel replacement; CJK + waitlist gates production.
>    - UX: parallel Choice/Score/Noul in 70–500ms to route roles and skip expensive independent/gate review when confidence high; escalate on low confidence.
>    - Independence of review in this repo is vendor-diversity (Grok vs GPT impl vs Claude plan) — replacing independent-review with Jev would remove text counterarguments.
>    - Three live parallel researches (comparison, billing, security). Fourth (browser/E2E) requested, not started this turn.
>
> 6. All user messages:
>    - 「最近新しく出たJevというAIが話題です。これについてどんなものなのか詳しく教えてください。また、このリポジトリ内で使用する場合どのように使うのが最適か、仮にagent-policyに適用する場合どのような役割をあたえたらよりUXが良くなるか、考えてください。」
>    - 「Jevを使う場合、APIを使用するしか現状は方法がないということですか？では、そのリクエストの形はどうするのがよいですか？」
>    - 「一部情報で、"テキストの生成はできない"とありました。要するにコーディングはできず、計算・判断のみということで合ってますか？」
>    - 「例えば、"このスクリプトをこうしたいんだけどどうすればいい？"と投げると、"こうすればよい"という指針が構造的に返ってくる。または"このコードのレビューをしてほしい"と投げると、レビュー結果が。このような理解で合ってますか？」
>    - 「すみません、その投げ方で合っていないのは承知しています。ようするにそういう意味の構造的リクエストを送るとそう返ってくるのかの確認です。」
>    - 「公式のSDKやMCPはありますか？」
>    - 「Jevの判断能力が、Fable5.1,Opus5,Sonnet5,GPT 6 Astra,GPT 5.6 Sol,GPT 5.6 Terra,Grok 4.6と比べてどうなのか、調査・比較してください。」
>    - 「追加で、APIリクエストの料金体系を調べてほしいです。サブスクはあるのか、従量課金だけなのか、どうやって契約するのかなどお願いします。」
>    - 「並列で別エージェントをたててほしいです」 (after rejecting combined-agent / WebFetch)
>    - Implicit: do not poll TaskOutput (rejected).
>    - 「また追加で、セキュリティ的にはどうなのかを並列で調べてほしいです。情報の漏洩を起こすことはないのか、データが日本国外に保存されるのか、機密情報の取り扱いはどうなっているかなどを重点的に、他にも気になる観点などがあればお願いします。」
>    - 「追加調査を並列でお願いします。Jevに対してブラウザ操作などを依頼してE2Eテストを行うことなどはできますか？Jev単体や、Playwrightなどを使う場合でも、何でもよいですが、高速かつ安価にブラウザ判断を行えるかを調べてください。」
>    - Project/security constraints that remain in force: Codiel/Raguel は API 不使用・Claude Code 完結が必須; 未信頼 Issue 本文を無加工で Jev state にしない; agent-policy は Agent 定義を同梱しない; 却下案（割当マップ / 派生定義生成 / CLAUDE.md 焼き込み 等）を再提案しない; 既存ファイルの一括削除はユーザーの手; metatron 保護パスは CLI 経由のみ; テキスト形式ファイル生成時は genshijin 口調を自動適用せず確認.
>
> 7. Pending Tasks:
>    - Await and synthesize realtime-researcher a2f8b638d5f136ffa: Jev judgment vs Fable 5.1 / Opus 5 / Sonnet 5 / GPT 6 Astra / GPT 5.6 Sol / GPT 5.6 Terra / Grok 4.6. Do not mix official self-evals with independent benches. Do not use cookbook’s older-model table as the answer.
>    - Await and synthesize ad0348643c817bf7e: pricing, subscription vs usage, contract steps, waitlist, free tier, Vercel/Netlify billing, rate limits, Enterprise/ZDR commercial terms.
>    - Await and synthesize a046ea985f65c0981: leakage/training, data residency vs Japan, confidential handling, encryption, key RBAC, injection, subprocessors, gateway data path, governing law.
>    - Dispatch a *new* parallel realtime-researcher for browser/E2E: can Jev itself drive a browser; with Playwright or similar, can browser *judgment* be fast and cheap. Do not attach this to the three existing agents. User explicitly wants parallel separate agents.
>    - Do not implement agent-policy/MODELS/Raguel changes unless user asks.
>    - Do not poll background agents.
>
> 8. Current Work:
>    Immediately before compact, three background realtime-researchers were running and the user asked for a fourth parallel investigation on browser/E2E. Assistant had just confirmed tracks 1–3 and that results would be added when notifications arrive, without polling. Chat-recorder session 9 completed internally. The compact instruction forbade launching the 4th agent in this turn.
>    User quote: 「追加調査を並列でお願いします。Jevに対してブラウザ操作などを依頼してE2Eテストを行うことなどはできますか？Jev単体や、Playwrightなどを使う場合でも、何でもよいですが、高速かつ安価にブラウザ判断を行えるかを調べてください。」
>    Known from already-gathered Jev facts (not yet framed as the E2E answer): Jev does not choose next actions, does not generate code, has no computer-use/tool API, text-only (no images) — so Jev-alone browser E2E is almost certainly no; Playwright + Jev-as-judge on extracted text/DOM-as-state is the plausible architecture, pending the new researcher.
>
> 9. Optional Next Step:
>    After compact, dispatch a new realtime-researcher (separate from a2f8b638d5f136ffa / ad0348643c817bf7e / a046ea985f65c0981) for the user’s latest request: whether Jev can be asked to operate a browser / run E2E, alone or with Playwright, and whether browser judgment can be fast and cheap. Then wait for notifications (no TaskOutput polling). When reports arrive, synthesize for the user in Japanese with primary vs unverified sources.
>    Direct quote of where we left off: 「セキュリティ調査を3本目として起動した。既存2本には足していない。いま並列3本: 判断能力比較 / 料金・契約 / セキュリティ・プライバシー。完了通知が来たものから本編に載せる。ポーリングはしない。」 User then added: 「追加調査を並列でお願いします。Jevに対してブラウザ操作などを依頼してE2Eテストを行うことなどはできますか？」
>
> If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /home/hiro0209/.claude/projects/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins/de77ea61-8bcf-417b-ba59-b5dfee28af6f.jsonl
> Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.

# AI

4本目起動済。既存3本（判断比較 / 料金 / セキュリティ）と並列。ポーリングしない。完了通知から本編に載せる。

公式で既に確定してる範囲だけ先に書く。cookbook 有無・コミュニティ事例は調査側の一次確認待ち。

## Jev単体でブラウザ操作・E2E

不可。

根拠（公式・前調査）:
- コード生成しない
- 次アクションを自分で選ばない（not agents）
- tool / function calling / computer use なし
- テキストのみ。画像入力なし → スクリーンショット判定不可

「Playwright を叩け」「このボタンをクリック」は Jev の出力型に載らない。Choice / Score / Noul だけ。

## Playwright 等 + Jev（判断だけ）

構成としては成立する。公式が「Playwright 連携」として出してるかは未確認。

役割分割:
- Playwright（または同等）= ブラウザ起動・クリック・ナビ・DOM/a11y tree/可視テキスト抽出
- Jev = 抽出済みテキストを `state` に入れ、Choice / Noul / Score で判定
- ホスト側コード = スコア合成・リトライ・失敗時スクショ保存

向く例:
- 「この画面はログイン成功か」（Noul）
- 「エラーバナー / 正常 / 不明」（Choice）
- 「フォーム完成度」（Score）

向かない例:
- ピクセル差分・レイアウト崩れ（ビジョンなし）
- 「次に何をクリックすべきか」の自律探索（次アクション選択禁止）
- 多ホップ（ページA見て、判断して、別ページへ…を Jev 単体で回す）

## 高速・安価か

判断レイヤだけなら公式数字は速い・安い（入力 $0.042 / 1M tok、出力無料、70–500ms 帯、250k tok/s）。ブラウザ起動・ナビ・待機はホスト側コストで、Jev 料金に含まれない。

成立条件:
- アサーションがテキスト/DOM で書ける
- 1画面・原子質問
- スクショ判断が不要

不成立:
- 視覚回帰
- エージェント型 E2E（モデルがブラウザを運転する）

このリポジトリのテスト方針は「E2E 持たない」。Jev を testers の代わりに据える話ではない。

調査4本、完了したものから追記する。

記録エージェントを起動してターンを閉じる。

## セッション 11: TypeSafe Jev AI 統合検討の調査4本（料金・セキュリティ・ブラウザ・判断）を完了

# AI

調査4本は並列で継続中。完了通知から追記する。

記録側は完了。調査4本は継続中。完了通知から追記する。

調査4本は継続中。完了通知から追記する。

料金・契約の調査が返ってきた。一次情報だけ載せる。判断比較・セキュリティ・ブラウザは未着。

## 結論

従量課金。公開の Free/Pro/Team 月額シートは無い。今は early access + ウェイトリスト。単価正本は Models ページ。`/pricing` は 404。

## 公式単価（TypeSafe 第一者）

正本: https://docs.typesafe.ai/models （sitemap 2026-09-18）

- 入力 **$0.042 / 1M tok**（$42 / 10億 tok）
- 出力 **無料**（Charged per input token. Output tokens are free.）
- `jev-1.13.0` / `jev-latest` / `jev-preview` は今同じモデル → 掲載単価も同じ
- コンテキスト: 64k/request。`state`+最長 question は 32k
- テキストのみ

「too cheap to meter」は Models に無い。ローンチブログ（2026-09-15）の括弧書き。

ブログ: 補助金かどうか証明できない、長期では下がると予想。ホームページ FAQ は「現行価格で profitably serve できる」。公式同士で言い回しが違う。

## サブスク・クレジット

MCA（2026-08-27）:

- 入力ごとに Credit 消費
- Purchased Credits: Term 終了 or 購入日から 12か月の早い方で失効
- 残高ゼロ → auto-refill に opt-in してなければ Output 拒否可
- Promotional Credits は裁量。金額・付与条件は公開なし
- 換金・返金・譲渡不可。原則 USD。請求書日から 30日
- クレジットパック金額・最低チャージ・月額固定表は未確認

## 契約手順

1. https://typesafe.ai/ の Join Waitlist（`/waitlist` は 404）
2. Typeform https://typesafeai.typeform.com/to/SP0ZZxLc
3. Discord: `https://discord.com/invite/WUujKYBp8s`
4. 通ったら Console https://console.typesafe.ai
5. キー https://console.typesafe.ai/settings/keys
6. `POST https://api.typesafe.ai/v1/systemone` + `Authorization: Bearer` + env `TYPESAFE_API_KEY`

ログイン UI: Google / メールコード。パスワード欄は HTML に無い（MCA は username/password と書いて食い違い）。Stripe publishable key は配線あり。カード入力 UI 自体はログイン画面に無い。銀行振込は未確認。

Legal: MCA / ToU / Privacy / DPA。窓口 `sales@` `privacy@` `support@`。住所 SF。

早期アクセスが無料か有料か、付与クレジット額、トライアル日数 → 公式に金額なし。未確認。

## ゲートウェイ

Vercel AI Gateway（2026-09-15/16）:

- モデル `typesafe-ai/jev`
- md: $0.042/1M in、output 0。UI 表示は $0.04。表記ゆれ
- TypeSafe キー不要。課金は Vercel credits。markup なし
- per-request ZDR は Gateway 側オプション（第一者 ZDR 契約の代替かは未記載）
- free credits のドル額（よく出る $5）は取得ページに数字なし → 未検証

Netlify AI Gateway（changelog 2026-09-18）:

- キー不要。`TYPESAFE_API_KEY` 既存なら上書きしない
- 掲載 $0.04 in / $0.00 out。3エイリアス同額
- $1 USD = 180 Netlify credits
- TypeSafe は OpenRouter 経由ではなく provider 直

第一者とゲートウェイは別会計。掲載が $0.042 vs $0.04。

## レート制限

- 250,000 tok/s かつ 1,200 RPM。超過は **429**
- 予告なく変動しうる。custom/enterprise は `sales@typesafe.ai`
- 529 Overloaded あり。SDK は backoff。`Retry-After` / `retry-after-ms`
- API 表に 402 は無い。残高切れの HTTP コードは未確認
- Playground 1 QPS は公式に無い → 未検証

## Enterprise / 学習

- 顧客の req/resp で学習しない（Models + Privacy + MCA §4.1）
- Telemetry（logs, hashes, metrics）は改善に使える（MCA §4.3）
- ZDR は enterprise。`privacy@typesafe.ai`。DPA 本文に ZDR 文字列なし。技術定義・保持日数は未確認

## 未確認（公開一次に無い）

クレジットパック金額、早期アクセス実請求、ウェイトリスト所要、402、tokenizer、キャッシュ料金、第一者月額プラン。

残 3本（判断比較 / セキュリティ / ブラウザE2E）は継続中。

料金調査は反映済み。残3本（判断比較 / セキュリティ / ブラウザE2E）は継続中。

ブラウザ/E2E 調査が返ってきた。一次と二次を分ける。判断比較・セキュリティは未着。

## 結論

Jev単体でブラウザ操作・E2Eは不可。公式製品は `POST /v1/systemone` の typed 判断だけ。tool / computer use / Playwright API は docs・公式 GitHub に無い。

## Jev単体（検証済み）

- API は `state` + `questions`(Choice/Score/Noul) → `answers`。click / screenshot フィールド無し
- 公式 cookbooks 111件に browser / Playwright / Selenium / E2E / screenshot / UI test は 0
- Agent skill は Claude Code 等へ API の使い方を教えるもの。SKILL.md に playwright/browser/E2E は 0件
- Input: **Text only. No image, audio, or video**
- How to build: 「**AI-powered software, not agents**. It does not generate code or choose its own next action.」
- jaggedness: テキスト生成は訓練対象外。Choice 連鎖で無理に生成すると遅くて下手

公式の「UI」は **アプリUIに判断を埋め込む**話。UIテストではない。

## Playwright + Jev（判断だけ）

公式に「DOM/a11y を state に入れて Choice」と書いたページは無い。載るのは一般パターンだけ:

- コードが制御フロー・副作用
- モデルは狭い atomic な判断
- 非テキストは **先にテキスト/構造化へ前処理** してから `state`

だから構成としては:

1. Playwright が起動・クリック・待機
2. DOM / a11y tree / 可視テキストを抽出
3. Jev が Noul/Choice/Score
4. ホストが合成・リトライ

スクリーンショットを画像のまま送る経路は公式に無い。OCRしてテキスト化するのは「preprocess」に形式は合うが、ブラウザ用途の公式手順は未確認。

公式 verification は LLM の prompt/citation/tool-call 検証と semantic lint。Web 視覚回帰ではない。

## コミュニティ（二次・未検証）

公式非所属の `jev-browser` 群あり（Playwright が要素列挙、Jev が 1 action 選択、コードがループ）:

- jkudish/jev-browser
- Ying-Kai-Liao/jev-browser（README に非公式と明記）
- tontoko/jev-browser
- MahmoudAdelbghany/jev-browser

コミュニティ数字（~300ms/step 等）は未検証。公式対比（Claude computer use / Playwright MCP / Browser Use）は無し。

## 高速・安価か

判断レイヤの公式数字（ブラウザ専用ではない）:

- $0.042 / 1M input、output 無料
- 「about 100ms」「real-time 150ms」（SLA欄は Models に無し）
- cookbook: 1 Choice 114ms / $0.000046。13問まとめ 0.27s vs 個別 2.71s

Playwright の起動・ナビ・CI は TypeSafe 請求外。公式が「Playwright コストはホスト」と書いた文自体は無い。課金対象は input token のみ、から読み取れる範囲。

成立し得る条件（公式の一般規律）:
- 閉じた選択肢
- テキスト化した 1画面
- 原子質問を並列
- 低 confidence はエスカレーション

公式が否定:
- 画像そのまま
- モデルが次クリックを自律選択する while ループ
- セレクタ/JS 生成
- 巨大 DOM を無関係ごと積む（32k/64k、context rot）

このリポジトリのテスト方針は「E2E 持たない」。Jev を testers の代わりに据える話ではない。

残2本（判断比較 / セキュリティ）は継続中。

Raphael の蒸留を専用エージェントへ渡す。

セキュリティ調査が返ってきた。一次と未確認を分ける。判断比較は未着。

## 結論

デフォルトは **米国保存・米国処理**。学習（重み更新）はしない、と Docs / Privacy / MCA が一致。**生 Input の非保持は標準契約に無い。** ZDR は enterprise 個別（`privacy@typesafe.ai`）。日本リージョン・APPI 条項は公開文書に無い。

## 漏洩・学習

検証済み:
- 「Jev is not trained on customer requests or responses.」全アカウント同一重み。fine-tune/LoRA なし
- Input を service providers 以外の第三者に開示しない
- CCPA sell/share しない
- インシデント: DPA で認識から **遅くとも 72時間以内** 通知
- 公開の過去侵害報告は今回見つからない

抜け穴になりうる公式定義:
- MCA §4.3 **Telemetry**（logs, hashes, metrics, learnings）は制限なく Process、サービス改善にも使える
- Privacy の保持は「合理的に必要な期間」。固定 TTL なし
- MCA §10.3: Customer Data をいつでも削除可。バックアップ残留あり
- サポートが API 本文を見る手順は未確認。直接連絡の本文・添付は受領し、第三者ベンダーが通信を保存しうる

「重みを更新しない」≠「生 `state` を保持・分析しない」。後者は標準では約束されていない。

## データ所在 vs 日本

- Privacy: Services are hosted in the **U.S.** EEA/UK からも米へ移転
- ブログ: West Coast 拠点
- 実測（2026-09-18）: `api.typesafe.ai` / `console.typesafe.ai` は **AWS us-west-2（Oregon）**
- 法人: SF。MCA 準拠法 Delaware。EU SCC は Ireland/Dublin
- 日本リージョン、レジデンシー API、APPI 条項: 公開文書に無い

直叩き API は Vercel/Netlify 上ではない。Gateway を使うと先にそのホストを通る（別会計・別経路）。Netlify 経由の存在は料金調査側が一次で確認。セキュリティ側はデータ経路文書を未検出。

## 機密の扱い

明示禁止は **ITAR**、輸出管理対象者、18歳未満。秘密鍵・PII・顧客コード・PHI・マイナンバーの明示禁止条項は公開 Legal に無い。HIPAA BAA も見当たらない。

DPA は公開（Processor=TypeSafe）。SOC 2 は Trust Center（Vanta）ポータルあり、報告書本文は未取得。ISO 27001 主張なし。

ZDR: enterprise。技術範囲（ログ・バックアップ・Telemetry・Playground を含むか）は未公開。Vercel が引用する TypeSafe ZDR 英文は、TypeSafe 自身の Privacy/DPA/MCA には出てこない。Gateway オプション ≠ 直叩き標準 MCA。

暗号化アルゴリズム・鍵管理の数値は公開 Legal に無い。Privacy は「reasonable efforts」「保証しない」。

認証: Bearer API key。SSO/SAML/mTLS/IP allowlist は Docs に無い。JS SDK はブラウザ露出を既定禁止。`debug` は **body を redact しない**（顧客側ログ経路）。

## インジェクション（公式既知制限）

jaggedness（2026-09-17）: **state を敵対的と扱わない。** 注入指示・誤誘導で答えが動く。緩和は criteria 明確化と事前テスト。防御保証ではない。

このリポジトリでは未信頼 Issue 本文を無加工で Jev `state` に載せない、が既定。

## その他

- 製品は early access。Privacy 最終更新 **2025-11-19**（ローンチ 2026-09-15 より約10か月古い）
- 脆弱性テスト禁止（MCA）。窓口 `security@typesafe.ai` + PGP。バグバウンティ有無は未確認
- 責任上限: 直近12か月支払額と **$50 の大きい方**（Excluded Claims 除く）
- サブプロセッサ正本は Trust Center。表の行は今回未抽出
- Playground share URL の ACL・期限は未記載
- Website Terms はサイト用（機密を Site に出すな）。API は MCA

**警告:** 機密・個人データ・未信頼テキストを標準契約のまま `state` に載せる前提は、米国保存・非ZDR・Telemetry 無制限と両立しない。ZDR が要るなら `privacy@` の個別契約が先。早期アクセス段階。

残1本（判断能力比較）は継続中。

ブラウザ調査は反映済み。残1本は判断能力比較。継続中。

判断能力比較は継続中。完了通知から追記する。

判断能力比較は継続中。完了通知から追記する。

セキュリティ調査は反映済み。残1本は判断能力比較。継続中。

判断能力比較が返ってきた。4本すべて揃った。自己評価と独立測定を混ぜない。

## 先に結論

同じ「判断」を7モデルと並べた独立大規模ベンチは無い。LMSYS / HELM / Artificial Analysis に Jev 行は無い（AA の `/models/jev` は 404）。

あるのは:
- TypeSafe 自己 evals（Astra+Fable 5.1 がラベル。その2つは被評価行に無い。Grok 4.6 も行無し）
- kiarina 独立（相手は OpenAI Moderation。依頼7モデルではない）
- Every.to の小規模欠陥検出（Fable 5.1、一次本文ペイウォール。二次引用のみ）

「どちらが賢いか」の単一順位は出せない。製品が違う。

## 非対称（公式）

Jev: Choice / Score / Noul + 確率。テキスト・コード・説明は出さない。並列 primitive。

7モデル: テキスト生成。JSON schema で形を縛れる。校正済み option distribution API は公式に無い。

「type error 0% / can't hallucinate」はスキーマ一致の数学的保証。内容の正しさの実測ではない。ブログ原文: “Our number is not empirical. Schema matching is guaranteed.”

## TypeSafe 自己 evals（2026-09-18、evals.typesafe.ai）

4ワークフロー等重み MEAN（workflow モード）:

- Sol 74.1% / $0.0836 / 23.3s
- Opus 5 73.1% / $0.1761 / 37.8s
- Terra 67.9% / $0.0304 / 10.1s
- Sonnet 5 67.8% / $0.1174 / 78.1s
- **Jev 67.8% / $0.0004 / 0.4s**
- 以下 luna / DeepSeek / haiku 4.5

読み取り（事実だけ）:
- 平均精度は Jev ≈ Terra ≈ Sonnet 5。Sol / Opus 5 が上
- 速度・コストは自己評価上、Jev が桁違い
- ラベル = GPT-6 Astra + Claude Fable 5.1（high thinking）の平均。人間 GT ではない
- Astra / Fable 5.1 は参照ラベラー。表の被評価行ではない
- Grok 4.6 は表に無い
- ケース数 n は HTML に無し

ワークフロー差:
- Invoice: Jev 61.8% vs Sol 79.1% / Opus 78.4% / Terra 74.7% → ここが落ちる
- Customer service: Jev 76.0%（Sol 78.3% に近い）
- Security: Jev 61.7%（Opus 66.2% / Sol 62.5%）
- Agent trace: Jev 71.6%（Sol 76.6%）

見出しの 193.6× faster / 444.6× cheaper は最大比（Sonnet 78.1s / Jev 0.4s、Opus $0.1761 / Jev $0.0004）。Terra 対比は約 25× / 76×。

公式バイアス注記: 自社 capabilities team がワークフロー作成。Astra/Fable ラベルは Jev を過小評価しうる。短 state 有利。“higher end of real world gains”。

cookbook（consistency）の相手は haiku-4-5 / gpt-5.4-mini / gpt-5.5 / opus-4-8。依頼の7モデルではない。再現性のみ。正しさの比較に使わない。

## 独立測定

kiarina/labs（2026-09-17、`jev-1.13.0`）:
- 英語モデレーション 1680件: Jev ECE **0.185** vs OpenAI Moderation **0.057**（校正は OpenAI 側が良い）
- 日本語 1847件: 有害 recall Jev 0.956 vs OpenAI 0.646（取りこぼし Jev 36 vs 292）
- 危険コマンド 43件の自動実行 0。苦手は database/cloud
- 相手は依頼7モデルではない

Every.to（二次・pearpages 引用）: 欠陥検出 Jev 6/7、Fable 5.1 は 7/7。一次本文未取得。弱い。

Goedecke（意見）: 単一トークン constrained choice で速さの大半は既存 LLM でも近似できる、という反論。新ベンチではない。

## 7モデル側の公式（判断隣接）

- Fable 5.1 / Astra: TypeSafe ではラベラー。被評価スコア無し。structured outputs あり。judge 専用公式数字は未確認。Astra 発表ページは 403
- Opus 5 / Sonnet 5 / Sol / Terra: TypeSafe 被評価行あり（上記）。公式の校正/judge 数字は未確認
- Terra: ローンチブログが「intelligence の平均ピア」とデモ用に書く（自己評価）
- Grok 4.6: AA Intelligence Index 61（xAI 発表。Fable 5 Max 62 / Sol Max 61）。判断分類の同一タスク比較は無い。TypeSafe 表にも無い。xAI の「Fable 5 Max」≠ API の `claude-fable-5-1`（同一かは未確認）

## Jev が公式に捨てているもの

jaggedness（2026-09-17）: 算術・カウント・日付順序・multi-hop・巨大 state・敵対的入力・テキスト生成。CJK は英語より精度低下。Noul と Choice の確率同一性は保証しない。

---

## 4本の調査の位置づけ

料金: 従量 $0.042/1M in、出力無料。月額シート無し。early access + waitlist。

セキュリティ: 学習（重み更新）しない。生 Input 非保持は標準に無い。米国 us-west-2。日本リージョン無し。ZDR は enterprise。

ブラウザ: 単体不可。Playwright+テキスト判断は一般パターンに載るが公式 cookbook 無し。

判断: 平均帯は Terra/Sonnet 相当（自己評価）。Sol/Opus より下。独立の7モデル比較は無い。ノード用途（狭い typed 判断）と生成モデルは別物。

判断比較は反映済み。調査4本はすべて完了。

# phyllis998

> チャット記録してください

# AI

記録は chat-recorder に委譲する。手順を先に取る。

Stop フック相当で試行 ID を切り、recorder に渡す。

記録開始。既存ファイルへ追記。完了は待たない。
