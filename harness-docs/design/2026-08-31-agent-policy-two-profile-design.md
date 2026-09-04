# agent-policy 2 プロファイル化(claude / custom)設計書

- 作成日: 2026-08-31
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.13.1-dev` → `0.14.0-dev`
- 状態: 設計(実装前・第 2 版)
- 版注: 第 1 版に対する doc-review(Haiku)と独立レビュー(Grok)の指摘を反映した。主な変更: matcher 仕様の訂正(regex 可)、`agent-policy-vendor` の合成 allowlist 追随、setup CLI の policy 依存パイプラインの再設計明記、オフライン時の推奨一括生成規則、marker 走査の対象定義(roles 非空のみ)、`model` 欠落・`inherit` の扱い、SessionStart / SubagentStart の対応表を custom 系限定へ、環境変数の値域正規化、独立レビュー省略例外の一貫化、影響ファイル・テストの補完
- 関連: `harness-docs/design/2026-08-24-agent-policy-role-based-setup-design.md`(役割ベース setup)、`2026-08-25-agent-policy-setup-agents-design.md`(setup 統合)、`2026-08-27-agent-policy-external-agent-model-assignment-design.md`(外部 Agent 合成)
- context-map: `.claude/context-maps/2026-08-31-agent-policy-two-profile.md`

## 1. 背景と目的

現行の agent-policy は、ベンダー構成ごとの 4 方針(claude-model / with-codex / with-grok / codex-grok)を持ち、各方針の担当表(`src/agents/policies.ts` の `ASSIGNMENTS`)がモデルを帯へ固定している。役割マーカーによる上書き機構は存在するが、担当表の主体はあくまでベンダー別のモデル割当である。

この形には 3 つの構造的問題がある。

1. **ベンダー構成の組合せ爆発。** 新しいベンダーやモデルを足すたびに方針スキルと ASSIGNMENTS の列が増える。GPT / Grok の dispatch 節はほぼ同文の重複である。
2. **エイリアス沈黙故障。** 2026-08-24 設計 §8.3 が明記したとおり、フックはプロキシへ問い合わせないため、プロキシに無いエイリアスを既定にすると利用者は通知を受けないまま委譲時に `unknown provider for model` で失敗する。`AMATSUKA_AGENT_*_ALIAS` の既定値追随(Grok 4.5 → 4.6)も同種の痛みを繰り返す。
3. **委譲そのものの不発。** ハーネスの system prompt はサブエージェントの自動起動を抑止する方向に働き、方針スキルや output style の指示だけでは委譲が起きない。本プロジェクトの試行で効果が実証されたのは PreToolUse deny(ローカル実装 `tools/delegation_gate.py`)のみである。

本改修は次の 4 点でこれらを解消する。

1. 方針を **claude / custom の 2 プロファイル**へ再編する。custom の担当表は帯(RoleId)だけを持ち、委譲先はマーカー解決に一本化する。モデルの割当はユーザーの構成(setup 生成物)が決め、プラグインは推奨を示すに留める。
2. setup-agents のモデル選択肢を **`/v1/models` の実応答に接地**する。存在しないエイリアスが定義に書かれる経路を塞ぐ。
3. SessionStart が custom 構成のモデル実在を **起動時に検証**し、不成立なら **claude プロファイルへ全体一括フォールバック**して理由を明示する。沈黙故障を起動時の明示通知に変える。
4. 実証済みの **delegation gate を opt-in で同梱**し、PreToolUse(Task) の**並列促し**を追加する。

### ユーザー決定(2026-08-31)

- 2 プロファイル構成(claude = レガシー・モデル名担当表・role-id 無関係 / custom = role-id 担当表)。
- 故障時フォールバックは**全体一括**(帯単位は不採用)。
- `AMATSUKA_AGENT_AUTO_INJECTION` は `none` / `claude` / `custom` の 3 値へ。旧 3 値(`with-codex` / `with-grok` / `with-codex-grok`)は **custom 扱い + 移行通知**。
- delegation gate 同梱(案 A)と Task 並列促し(案 B)をスコープに含める。

## 2. 実測済みの前提

### 2.1 /v1/models(2026-08-31、CLIProxyAPI 実測)

```
GET ${ANTHROPIC_BASE_URL}/v1/models
Authorization: Bearer ${ANTHROPIC_AUTH_TOKEN}
→ {"data":[{"id":"claude-gpt-5-6-sol","owned_by":"openai",...},
           {"id":"claude-grok-4-6","owned_by":"xai",...},
           {"id":"claude-opus-5","owned_by":"anthropic",...}, ...],"object":"list"}
```

- **プロキシのクライアント側エイリアスが `id` にそのまま載る。** 接地が成立する。
- **`owned_by` がベンダーを示す**(openai / anthropic / xai)。ベンダー断片の選択を自動推定できる。実測は 1 プロキシ 1 回であり、値の大小文字・欠落の分布は §10 の実機検証で補う(推定は小文字化して比較し、未知・欠落は「不明」に分類する)。
- Anthropic 公式 API の `/v1/models` も `data[].id` の同型で読める(`owned_by` は無い場合がある)。パーサは `data[].id` と任意の `owned_by` だけに依存させる。

### 2.2 PreToolUse フック(公式ドキュメント裏取り済み)

- plain stdout は PreToolUse では Claude に届かない(debug log 行き)。コンテキスト注入は `hookSpecificOutput.additionalContext` の JSON で行う。
- `permissionDecision: "deny"` の `permissionDecisionReason` は **Claude に見える**(allow の reason はユーザーにのみ見える)。
- matcher の解釈は 2 通りある: 値が英数・`_`・`-`・空白・`,`・`|` のみなら **exact 文字列の列挙**(`Edit|Write` は Edit または Write)、それ以外の文字を含むと **JavaScript 正規表現(unanchored)**として評価される。したがって `mcp__.*` は正規表現 matcher として機能する(§8.1 はこれを使う)。`Task|Agent` は exact 列挙である。
- サブエージェント dispatch のツール名は matcher `Task` で捕捉できるとされるが、名称が `Agent` の環境に備え `Task|Agent` の列挙にする(§10 実機検証)。

### 2.3 委譲対策の実証結果(プロジェクト記録)

- 効果あり: PreToolUse deny(ローカル gate)。deny reason 経由で委譲指示が届き、行動が変わる。
- 効果なし: スキル本文の命令形強化、最優先宣言。
- 不採用(再提案しない): output style への system prompt 原文引用+名指し上書き(Fable 5 安全機構が発火)、UserPromptSubmit 毎ターン注入(スラッシュコマンド問題)。

## 3. 全体像

```
AMATSUKA_AGENT_AUTO_INJECTION(trim + 小文字化して比較)
  none / 未設定 ──→ 注入なし
  claude ────────→ claude-model-policy(レガシー。Claude モデル名の担当表。マーカー無関係)
  custom ────────→ SessionStart が検証:
  (旧 3 値も       マーカー付き定義の model(enum / inherit / 欠落を除く)⊆ /v1/models ?
   custom 扱い)      ├─ 成立 → custom-policy + マーカー対応表を注入
                     └─ 不成立 / 照会失敗 / マーカー付き定義 0 件
                          → claude-model-policy を注入 + 理由明示(全体一括フォールバック)

setup-agents(custom 専用ウィザード)
  /v1/models 照会 → 選択肢 = 実在エイリアス + Claude enum 4 種
  owned_by → ベンダー推定 → ベンダー断片 + agent-policy-vendor を焼き込み
  役割(RoleId)× モデル × 名前 × tools(MCP) → .claude/agents/ へ生成

PreToolUse hooks(新設 2 エントリ)
  delegation gate(opt-in): 編集ツール × 保護 glob → deny + 委譲指示
  parallel nudge: Task|Agent → additionalContext で並列 dispatch を促す
```

## 4. プロファイル

### 4.1 claude プロファイル(既存の縮退維持)

- スキル `claude-model-policy` を維持する。担当表は現行どおり Claude モデル名(`Opus` / `Sonnet` / `Haiku` / `Fable`)で帯を固定する。
- **マーカー機構への参照をすべて削除する。**「役割マーカー付き定義の優先」節に加え、「実行帯の解決順」の手順 1(マーカー注入定義の優先)も削除する。解決順は「担当表のモデルで `model` 上書き。読み取り帯はビルトイン `Explore`、実装帯は `general-purpose`」だけになる。
- SessionStart は claude(および none)分岐でマーカー対応表・未知役割通知を**注入しない**(§6.1。現行は方針と無関係に対応表を出すため、これは挙動変更である)。
- setup 不要のゼロセットアップ経路として位置付ける。

### 4.2 custom プロファイル(新設)

スキル `custom-policy` を新設する。骨子:

- **担当表は帯(RoleId 10 種)+ 推奨モデル列のみ。** 担当モデル列は持たない。委譲先は SessionStart が注入するマーカー対応表で解決する。

  | 帯(RoleId) | 推奨モデル(参考) |
  | --- | --- |
  | 複雑または重要な実装(complex-impl) | GPT Sol |
  | 通常の実装(normal-impl) | GPT Terra |
  | 軽量な実装(light-impl) | GPT Luna |
  | その他のタスク(general) | GPT Terra |
  | コードベース探索実働(explore) | Grok |
  | リアルタイム情報調査(realtime-research) | Grok |
  | 設計書・実装計画書の独立レビュー(independent-review) | Grok |
  | 設計書・実装計画書のレビュー(doc-review) | Haiku |
  | コードレビュー(code-review) | Sonnet |
  | 設計・計画・実装のアドバイザー(advisor) | Fable / Opus |

  推奨はプラグインの参考情報であり、拘束しない。正本は `policies.ts` の `RECOMMENDED`(§5.1)。値は現行 codex-grok-policy の割当を継承する。
- **custom はモデル × 役割の組合せを制約しない。** 現行 setup の「担当表上あり得ない組合せは選べない」検証は custom では廃止する(担当表が無い以上、あり得ない組合せも存在しない)。推奨から外れる組合せは警告に留める。読み取り役割と実装役割の混在警告(kind 混在)は維持する。
- オーケストレーター専用の帯(調査・分析 / 設計書・実装計画書の作成 / コードベース探索統括)は現行どおり表に残し、サブエージェントへ委譲しない。
- **実行帯の解決順**(実務タスク着手前に一度確定し、以後はタスクごとに再判定しない):
  1. マーカー対応表にある帯は、その定義を使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。
  2. 対応表に無い帯は、`claude-model-policy` の同帯モデルへ読み替え、Claude 帯の解決(`model` 上書き + 読み取り帯 `Explore` / 実装帯 `general-purpose`)を使う。**ただし independent-review 帯だけは読み替えず、独立レビューを省略する**(同ベンダーのレビューは独立性を持たないため)。

  手順 2 は部分構成(一部の帯だけ定義した構成)を成立させるための**構成の既定**であり、故障時フォールバック(§6.2 の全体一括)とは別物である。
- **dispatch 共通節(ベンダー非依存)**: 現行の GPT 節と Grok 節を統合し、全外部エージェントに適用する。
  - 依頼文の冒頭で帯(役割)を明示し、その役割の Output Format を指定する。
  - 依頼文に「この tools のみ使用」と明記する。
  - 読み取り系の帯を `Write` / `Edit` を持つ定義へ委譲するときは、読み取り限定条項(tools 限定・ファイル変更禁止・報告のみ)を明記する。
  - 名指し dispatch の起動形態は共通規律の §委譲先の実行モデルの確定 に従う。
- **独立レビュー手順の role 化**: 「doc-review 帯のレビュー → independent-review 帯の独立レビュー(原本のみ・他レビューの指摘は渡さない) → オーケストレーター採否」。independent-review 帯が対応表に無いときは省略する(解決順 手順 2 の例外)。
- **セッション途中の不達**: 委譲先が利用不可になった帯は `claude-model-policy` の同帯へ読み替えて続行し、次セッションで SessionStart の判定に委ねる。**independent-review だけは読み替えず省略する**(解決順と同じ例外。現行 codex-grok / with-grok の「独立レビューは省略し、Opus では代行しない」を引き継ぐ)。
- SessionStart が claude-model-policy を注入したセッションでは、このスキルは読み込まれない(注入が切り替わる)。

### 4.3 廃止

- スキル `with-codex-policy` / `with-grok-policy` / `codex-grok-policy` を削除する。
- **同梱プリセット 4 定義(`agents/{gpt-sol,gpt-terra,gpt-luna,grok}.md`)と生成機構(`src/agents/presets.ts` / `build-presets.ts`、`build.ts` の該当処理)を廃止する【要承認】。** 根拠: (1) custom の実行帯の解決順から「同梱プリセットを使う」段が消える。(2) 2026-08-27 設計により合成ホストとしても使われない。(3) 残すと担当表(推奨)との一致維持という二重管理が続く。既存の名指し利用(`agent-policy:gpt-sol` 等)は壊れるため、README の移行節で告知する。代替は setup の推奨構成一括生成(§7)。
  - 波及: `rolesAcrossPolicies` と `DEFAULT_ALIASES` は参照元ごと消える。SubagentStart の同梱 `agents/` 走査は対象が空になり実質 no-op になる(コードは変更しない。挙動: 同梱プリセット名の名指しは「未知 type」として注入側に倒れるが、定義自体が無いため dispatch は成立しない)。同梱定義の存在を前提とする既存テスト(`presets.test.ts` / `build-presets` 関連 / `subagent-start.test.ts` の同梱走査ケース / `policies.test.ts` の `rolesAcrossPolicies`)は削除・書き換えの対象である(§11・§12)。
- ベンダー固有の規律は次の二層に着地する。オーケストレーター側のベンダー固有記述は残さない。
  - 受け手規律(定義本文): ベンダー別断片(`<role-id>.<vendor>.md`、既存機構)で焼き込み。例: Grok の「X 由来・ソーシャル由来の情報を未検証として明示する」。
  - 依頼側規律: §4.2 の dispatch 共通節へ一般化。

## 5. 担当表正本(`policies.ts`)の再構造

### 5.1 変更内容

```ts
export type PolicyName = "claude-model-policy" | "custom-policy"

export const POLICIES: Policy[] = [
  { id: "claude-model-policy", label: "Claude のみ(レガシー)", injection: "claude" },
  { id: "custom-policy",       label: "カスタム(role-id)",      injection: "custom" },
]

// claude プロファイルの担当表(維持)。フォールバック先・enum 読み替え表・未割当帯の既定を兼ねる
export const ASSIGNMENTS: Record<"claude-model-policy", Record<RoleId, ModelId[]>>

// custom プロファイルの推奨(新設)。現行 codex-grok-policy の割当を継承
export const RECOMMENDED: Record<RoleId, ModelId[]>
```

- `ASSIGNMENTS` の claude-model-policy 行は現行値を維持する。**custom-policy はエントリを持たない**(担当モデルが存在しないため)。`modelsFor` / `rolesFor` など `ASSIGNMENTS[policy]` を引く経路は claude-model-policy 専用となり、custom の選択肢生成は `RECOMMENDED` と live models(§5.2)から行う(§7.1 の CLI 再設計)。
- `RECOMMENDED` は setup の推奨マークと custom-policy スキルの推奨列の正本になる。現行 `ASSIGNMENTS["codex-grok-policy"]` の値をそのまま移す(RoleId 10 種を網羅することをテストで固定する)。
- `MODELS`(8 ModelSpec)は維持する。用途は推奨の解決(ModelId → 既定エイリアス文字列・label・defaultName・color)に縮小する。
- **`aliasEnv`(`AMATSUKA_AGENT_*_ALIAS` 4 変数)と `resolveModelValue` の環境変数分岐を廃止する。** モデル値は /v1/models の実在リストから選ぶため、環境変数で既定を差し替える機構は不要になる。SessionStart は当該変数の設定を検出したら非推奨(参照されない)と通知する(§6.3)。`retiredBlock` の「`AMATSUKA_AGENT_GROK_ALIAS` を設定せよ」という案内行も廃止と矛盾するため削除する。
- `AGENT_DENIED_MODELS` / `SOLO_DENIED_ROLES` は維持し、**Agent tool 付与の判定規則を次のとおり明文化する**(setup の生成時判定。名指し dispatch 時の可否は生成済み定義の `tools` が正本であり、実行時判定はしない)。
  - 推奨モデル ID(ModelId)経由の生成(`--models` / `--model-id`): 現行どおりモデルベース(`haiku` / `gpt-luna` は不可)+ 役割ベース(`light-impl` / `advisor` 単独は不可)で判定する。
  - 自由値経由の生成(`--model` に任意エイリアス): モデルベース判定は適用できないため、役割ベース判定のみを適用する。`compose` の `modelId` はこの経路で不定になるため optional へ変更する(§11)。
- 2026-08-27 設計の「`ASSIGNMENTS` は変更しない」は本改修で上書きする(方針転換の明示)。

### 5.2 live models クライアント(新設 `src/agents/live-models.ts`)

```ts
interface LiveModels {
  ok: boolean
  baseUrl?: string          // 未設定なら ok: false, reason: "no-base-url"
  ids: string[]             // data[].id
  vendors: Record<string, "gpt" | "grok" | "claude" | "unknown">  // owned_by から推定
  reason?: string           // 失敗理由(no-base-url / http-<status> / timeout / parse-error)
}
```

- `ANTHROPIC_BASE_URL` 未設定なら照会せず `ok: false`。設定時は `GET ${base}/v1/models` を 1 回、タイムアウト 3 秒で叩く。
- 認証は `ANTHROPIC_AUTH_TOKEN` があれば `Authorization: Bearer`、無ければ `ANTHROPIC_API_KEY` があれば `x-api-key`、どちらも無ければ無認証で試行する。**どの変数も前提にしない**(CLAUDE.md 規律)。失敗はすべて `ok: false` + reason で返し、**例外を上へ投げない契約**とする(呼び出し側の fail-open 分岐を単純に保つ)。
- ベンダー推定: `owned_by` を小文字化し、`openai` → gpt、`xai` → grok、`anthropic` → claude、それ以外・欠落 → unknown(setup が聞き取りへフォールバック)。
- Node 26 標準 `fetch` を使う。新しい依存は追加しない。
- Claude enum(`sonnet` / `opus` / `haiku` / `fable`)は照会と無関係に常時有効な語彙として扱い、`ids` に含めない(呼び出し側が別枠で足す)。
- フックと CLI は Claude Code が起動した子プロセスとして環境変数を継承する想定だが、`ANTHROPIC_BASE_URL` がシェル起動時にしか無い構成では見えない可能性がある。§10 で実機検証し、README に `settings.json` の `env` へ置く案内を追記する(現行のエイリアス変数と同じパターン)。

## 6. SessionStart フックの改訂

### 6.1 injection 分岐

判定は環境変数値を trim + 小文字化してから行う。

| `AMATSUKA_AGENT_AUTO_INJECTION` | 挙動 |
| --- | --- |
| 未設定 / 空 / `none` | 方針ブロックなし。**マーカー対応表・未知役割通知も出さない**(現行からの変更) |
| `claude` | `claude-model-policy` の使用指示を注入。対応表・未知役割通知は出さない |
| `custom` | §6.2 の検証フローへ |
| `with-codex` / `with-grok` / `with-codex-grok`(旧値) | §6.2 の検証フローへ。方針ブロックの直後に「`AMATSUKA_AGENT_AUTO_INJECTION` を `custom` へ変更する」という移行通知を 1 行続ける。旧 3 値は既知の互換値であり、未知値警告の対象にしない |
| その他の未知値 | 現行どおりスキップ警告のみ |

`retiredBlock`(廃止定義の残骸通知)と §6.3 の非推奨通知は全分岐で出す。

### 6.2 custom 検証フロー(全体一括フォールバック)

1. `.claude/agents/*.md` を走査し(現行 `scanAgents`)、**`agent-policy-role` を持つ定義(roles が空でないもの)だけ**を検証対象とする。マーカーの無い定義は数えず、その `model` も検証しない。対象が **0 件**なら: `claude-model-policy` を注入し、「役割マーカー付き定義が見つからない(未作成、または読み取れない)ため claude プロファイルで動作する。`agent-policy:setup-agents` で構成を作る」と明示する。
2. 対象定義の `model` 値から、**Claude enum(`sonnet` / `opus` / `haiku` / `fable`)・`inherit`(親モデル継承の宣言)・欠落(`model` キーなし = 継承)**を除いた集合を作る。これらは存在検証が不要かつ不能であり、Claude 側で常に安全に解決される。集合が**空**(全 Claude 構成)なら照会せず成立とする。
3. 空でなければ live models(§5.2)を照会する。
   - **全値が `ids` に存在** → 成立: `custom-policy` の使用指示 + マーカー対応表(現行 `markerTable`。各行にベンダー添記 §7.1)+ 未知役割通知を注入する。
   - **1 つでも不在** → フォールバック: `claude-model-policy` を注入し、「定義 `<name>` の model `<value>` がプロキシの /v1/models に存在しないため、セッション全体を claude プロファイルへフォールバックした」と不在の定義を列挙して明示する(列挙は最大 10 件 + 「他 N 件」)。マーカー対応表は注入しない。
   - **照会失敗**(`ok: false`) → フォールバック: 同上。理由に reason を添える(例: 「プロキシへ接続できない(timeout)」「ANTHROPIC_BASE_URL 未設定」)。
4. フォールバック時も、修復手段(setup-agents の再実行・定義の `model` 修正・プロキシ起動)を 1 行添える。

- 判定は SessionStart 時点で固定する。セッション途中のプロキシ復旧・停止は検知しない(再起動で再判定)。
- fail-open は維持する。フック自体の例外は stderr + exit 0 で、注入なしのまま継続する。`scanAgents` は失敗を空配列へ畳む現行実装のため、読み取り不能と 0 件は区別できない(手順 1 の文言が両方を含意する)。

### 6.3 非推奨通知

`AMATSUKA_AGENT_GPT_SOL_ALIAS` / `GPT_TERRA` / `GPT_LUNA` / `GROK` のいずれかが設定されているとき、「このエイリアス変数は参照されなくなった。モデルは setup-agents が /v1/models から選ぶ。定義の `model` 値を変えたいときは setup を再実行する」と 1 回通知する。

### 6.4 SubagentStart の追随(対応表の custom 系限定)

- 配布機構(deny-list 選別・subagent-discipline 断片・9500 字上限・fail-open)は維持する。
- **対応表の合成だけ injection に連動させる**: `AMATSUKA_AGENT_AUTO_INJECTION` が custom 系(`custom` + 旧 3 値)のときだけマーカー対応表を合成し、それ以外(none / claude / 未知)では「対応表なし」の既存文言を使う。規律断片(サブエージェント宣言・アドバイザー規律等)は全分岐で配布を続ける。claude 運用に旧 custom 定義が残っている場合に、子がマーカー表を根拠に GPT / Grok へ再委譲して沈黙故障が復活する経路を塞ぐ。
- 既知の乖離を受容する: custom がフォールバックしたセッションでは、SubagentStart は injection 値しか見ないため子へマーカー対応表を配り続ける。親は claude 表で dispatch するため実害は限定的であり、子がマーカー表の定義へ再委譲して失敗した場合はその時点で顕在化し、親へ差し戻される。SubagentStart から /v1/models を照会する案は、spawn ごとの HTTP 往復を要するため採らない(§13 不採用案)。

## 7. setup-agents の改訂(custom 専用化)

setup-agents は custom プロファイル専用のウィザードになる。claude プロファイルは setup 不要のゼロセットアップ経路であり、Claude モデルのカスタム定義を作りたい利用者は custom で Claude enum を選ぶ。

### 7.1 CLI の変更

| 変更 | 内容 |
| --- | --- |
| `--policy` / `--list-policies` 廃止 | 方針選択が消える |
| **policy 依存パイプラインの再設計** | `requirePolicy` / `modelsFor(policy)` / `rolesFor(policy, model)` / `validateRoles` の担当表照合 / `targetsFor` の `--models` 検証 / `listCoverage` / `listModels` / `listAvailableRoles` / `defaultAgentName` はすべて `--policy` と `ASSIGNMENTS[policy]` に依存している。これらを custom 前提へ書き換える: 役割検証は「組み込み RoleId またはプロジェクト独自役割であること」だけを見る(担当表照合は廃止 §4.2)。`--list-coverage` は `RECOMMENDED` の帯集合に対する被覆へ意味を変える。`--list-models` は廃止し `--list-live-models` へ置き換える |
| `--list-live-models` 新設 | live models の照会結果を返す: `{ok, reason?, models:[{id, vendor, recommendedFor:[roleId...]}], claudeEnums:["sonnet",...]}`。`recommendedFor` は `RECOMMENDED` のモデルの既定エイリアス(`ModelSpec.model`)と `id` の一致で付ける |
| `--vendor <gpt\|grok\|claude\|none>` 再導入 | ベンダー断片と色の選択に使う。`none` は断片 overlay なし・色は `blue`。省略時は live models の推定値、それも unknown なら必須 |
| `--model <value>` の検証 | `--write` 時、値が Claude enum でも live `ids` にも無ければ `ok: false` で拒否する。**照会失敗時(`ok: false`)は検証せず警告付きで通す**(オフライン生成を殺さない) |
| `--models <csv>` の意味 | **推奨モデル ID(ModelId)**の一括指定として維持する。照会成功時は、既定エイリアスが live `ids` に無い ID を生成対象から落とし、落とした ID を応答で報告する。**照会失敗時は落とさず、全 ID を既定エイリアスで警告付き生成する**(単件 `--model` と同じ規則。オフラインでも推奨構成を作れる) |
| frontmatter 出力 | `agent-policy-vendor: <vendor>` を追加する(`none` のときは出力しない)。書くのは `compose.ts`、読むのは `marker-scan.ts`(`MarkedAgent` に vendor 欄を追加)。SessionStart のマーカー対応表の各行に `(gpt)` 等として添記する。**共通規律の合成判定(適用除外 3)の frontmatter allow-list へ `agent-policy-vendor` を追加する**(追加しないと setup 生成物がすべて合成不適格になり、2026-08-27 設計の合成が死ぬ) |

`--check` / `--write` / `--merge` / `--keep` / 翻訳断片 / MCP 付与(`--list-mcp` / `--mcp-servers` / `--mcp-deny`)の機構は変更しない。

### 7.2 ウィザードの変更(SKILL.md)

- ステップ 1(ポリシー選択)を廃止し、冒頭で `--list-live-models` を実行する。
  - `ok: true`: 選択肢 = 実在エイリアス(ベンダー推定・推奨マーク付き)+ Claude enum 4 種。
  - `ok: false`: 選択肢 = Claude enum 4 種 + 推奨モデル ID の既定エイリアス(警告付き)。「プロキシ未検出(または照会失敗: reason)のため実在確認ができない。外部モデルの定義は生成できるが、実在は保証されない」と明示して続行する。
- 推奨構成の提示: 照会成功時は `RECOMMENDED` × live の突き合わせで「推奨構成をそのまま作る」を第一候補に出す。**live に無い推奨モデルは提示から除外し、除外したことを明示する。** 照会失敗時は §7.1 の警告付き一括規則に従う。
- 非対話モード(`$ARGUMENTS` に `--yes`)は「推奨構成の一括生成」として再設計する: `--list-live-models` → `RECOMMENDED` の全 ModelId を `--models` へ渡して保持マージ生成。質問はしない。
- モデルごとにベンダーを確認する。推定値(owned_by 由来)があれば確認のみ、unknown なら選択させる(gpt / grok / claude / どれでもない)。「どれでもない」= `--vendor none`。
- 読み取り専用性の警告・差分確認・MCP 付与・報告の各ステップは現行を維持する。報告の「方針の読み込ませ方」は 3 値(`none` / `claude` / `custom`)前提の文面へ差し替える。
- スキル description の「担当表上あり得ないモデルと役割の組み合わせは選べない」は削除する(§4.2)。

## 8. delegation gate の同梱(案 A)

実証済みのローカル実装(`tools/delegation_gate.py` + `.claude/settings.json` + `scripts/direct-edit.sh`)を TypeScript で汎用化し、プラグインに同梱する。

### 8.1 構成

| 要素 | 内容 |
| --- | --- |
| hooks.json | PreToolUse エントリ追加。matcher `Edit\|Write\|NotebookEdit\|mcp__.*`(`.` と `*` を含むため**正規表現として評価**され、`mcp__` で始まる全ツールに一致する §2.2)、command `node "${CLAUDE_PLUGIN_ROOT}/scripts/delegation-gate.mjs"`、timeout 10 |
| opt-in | 環境変数 `AMATSUKA_AGENT_DELEGATION_GATE`。trim + 小文字化後、`1` / `true` / `on` のときだけ有効。**それ以外(未設定・空・その他の値)はすべて無効**(typo で有効化しない)。既定は無効 |
| 設定 | `.claude/agent-policy/delegation-gate.json`(プロジェクト側)。無ければ gate は動作せず、「delegation-gate: 有効化されているが設定ファイルが無い(<パス>)」を stderr へ 1 行出して exit 0 |
| 解除 CLI | 同じバンドルの引数モード `node .../delegation-gate.mjs --direct on\|off\|status`。フラグ `.claude/agent-policy/delegation-gate.direct` を touch / 削除。TTL は既定 7200 秒(設定 `ttlSeconds` で上書き可) |

設定ファイルのスキーマ:

```json
{
  "denyGlobs": ["plugins/*/src/**", "plugins/*/skills/**"],
  "mcpTools": {
    "mcp__serena__replace_content": { "pathParam": "relative_path", "absolute": false }
  },
  "ttlSeconds": 7200
}
```

- `denyGlobs` は必須。プロジェクトの保護対象(典型はドメインマップの impl / prompt 相当)を利用者が書く。プラグインはリポジトリ固有の glob を焼き込まない。
- `mcpTools` は任意。gate 対象に加える MCP 編集ツールと、そのパス引数の取り出し方を宣言する。`absolute: true` なら `pathParam` の値を絶対パスとして解決し、`false` ならプロジェクトルートからの相対として解決する。built-in 3 種(Edit / Write = 絶対 `file_path`、NotebookEdit = 絶対 `notebook_path`)は宣言不要で常に対象。
- プロジェクトルートは `CLAUDE_PROJECT_DIR` → hook 入力の `cwd` → `process.cwd()` の順で解決する(ローカル版と同じ)。
- 設定ファイルの作成は利用者の手作業とする(README にひな形を載せる)。setup-agents ウィザードへの組み込みは本改修ではしない。

### 8.2 判定フロー(1 コールごと)

1. 例外時は無出力で終了(fail-open)。
2. opt-in 変数が有効値でなければ終了。
3. hook 入力に `agent_id` があれば終了(サブエージェントは対象外)。
4. 設定ファイルが無い・読めない・`denyGlobs` が空なら stderr 通知して終了。
5. TTL フラグが有効なら終了(一時解除中)。
6. `tool_name` が対象(built-in 3 種 + `mcpTools` のキー)でなければ終了。
7. パスを取り出しプロジェクトルート相対へ正規化。ルート外なら終了。
8. `denyGlobs` にマッチしたら deny JSON を出力する。

deny の `permissionDecisionReason`(Claude に見える):

> delegation-gate: メインセッションでこの層のファイルは編集しない運用方針である。担当表の帯に従い Agent tool で委譲する。(マーカー対応表があれば: 委譲先候補 — `<帯>: <定義名>` を列挙)。Bash 経由の書き込みや他ツールへの切替で回避しない。直接編集が必要なときは、ユーザー自身が `--direct on` を実行して一時解除する(TTL で自動失効)。

マーカー対応表の列挙は `marker-scan.ts` の `scanAgents` / `markerTable` を再利用する(deny 経路のみで実行するため常時コストは増えない)。

### 8.3 既知の限界(ローカル版と同じ・受容)

- Bash 経由の書き込みは技術的に止められない(文言のみ)。
- AI 自身が `--direct on` を実行する迂回も技術的には可能であり、deny 文言の「ユーザー自身が実行する」への遵守に依存する。
- 正規表現 matcher(`mcp__.*`)により、有効時は MCP の読み取り呼び出しにも node 起動(数十 ms)が乗る。無効時は matcher 発火しても即終了で影響は最小。

### 8.4 このリポジトリのローカル gate との関係

本改修はプラグイン提供のみを行う。このリポジトリ自身をローカル gate(`tools/delegation_gate.py`)から同梱版へ切り替える作業(settings.json の hook 削除・設定ファイル作成・env 設定)はスコープ外とし、実装完了後に別途ユーザー判断で行う。両方が有効でも deny が二重になるだけで安全側であり、共存は害を生まない。

## 9. 並列促しフック(案 B)

- hooks.json に PreToolUse エントリを追加する。matcher `Task|Agent`(exact 列挙 §2.2)、command `node "${CLAUDE_PLUGIN_ROOT}/scripts/parallel-nudge.mjs"`、timeout 10。
- 出力は固定の `hookSpecificOutput.additionalContext`:

  > 並列 dispatch の確認: まだ着手していない独立タスクが残っているなら、後続のメッセージではなく、この dispatch と同じメッセージ内で並列に dispatch する。逐次にするのは前の出力に依存するときだけである。

- **既定は有効**とし、`AMATSUKA_AGENT_PARALLEL_NUDGE` が trim + 小文字化後 `0` / `false` / `off` のとき無効化する【要承認】。根拠: dispatch 時のみ発火(1 回あたり数十 token)でコストが小さく、プラグインの並列原則そのものであるため。効果は未実証であり、注入型ナッジの実績が弱いことは認識の上で、低コストな補助として置く。
- サブエージェント内の Agent 呼び出し(アドバイザー相談等)にも発火する(プラグイン hooks はサブエージェントにも適用される)。害は小さく受容する。

## 10. 実機検証項目(実装前)

1. PreToolUse の hook 入力で、サブエージェント dispatch の `tool_name` が `Task` か `Agent` か(matcher の確定)。
2. PreToolUse の `additionalContext` が次のアシスタント文脈に実際に届くこと(公式記載の実機裏取り)。
3. matcher の解釈の実機確認: `Task|Agent` が exact 列挙として、`mcp__.*` が正規表現として意図どおりに一致すること。
4. SessionStart フックの実行環境から `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` が見えること(シェル環境のみの構成と `settings.json` の `env` 配置の両方)。
5. `/v1/models` を `ANTHROPIC_AUTH_TOKEN` 無しで叩いたときの応答(認証必須プロキシ / 認証不要プロキシで reason が意図どおり分類されること)。`owned_by` の値のばらつきも確認する。
6. 旧 injection 値(`with-codex-grok`)で SessionStart が custom 検証 + 移行通知を出すこと(サンドボックス)。
7. hooks.json へのエントリ追加が新セッションで発火すること(保護パス規律)。
8. delegation gate の deny 文言で委譲へ切り替わること(ローカル版で実証済みだが、同梱版の文言でも 1 ケース確認)。

## 11. 影響ファイル

新規:

- `plugins/agent-policy/src/agents/live-models.ts`
- `plugins/agent-policy/src/hooks/delegation-gate.ts`(→ `scripts/delegation-gate.mjs`)
- `plugins/agent-policy/src/hooks/parallel-nudge.ts`(→ `scripts/parallel-nudge.mjs`)
- `plugins/agent-policy/skills/custom-policy/SKILL.md`
- テスト: `live-models.test.ts` / `delegation-gate.test.ts` / `parallel-nudge.test.ts`

変更:

- `src/agents/policies.ts`(POLICIES 2 件・RECOMMENDED 新設・aliasEnv / resolveModelValue / rolesAcrossPolicies 廃止)
- `src/agents/compose.ts`(`agent-policy-vendor` の出力・`vendor: none` の受理・`modelId` optional 化)
- `src/agents/fragments.ts`(Vendor 型の扱いが変わる場合の追随)
- `src/hooks/marker-scan.ts`(`MarkedAgent` へ vendor 欄追加・対応表へのベンダー添記)
- `src/hooks/session-start.ts`(§6。ALIASES / setupBlock 廃止・検証フロー・対応表の custom 系限定・retiredBlock の Grok エイリアス案内行削除)
- `src/hooks/subagent-start.ts`(対応表の custom 系限定 §6.4)
- `src/setup-agents.ts`(§7.1 の再設計)
- `hooks/hooks.json`(PreToolUse 2 エントリ)
- `build.ts`(エントリ追加・buildPresets 削除)
- `skills/claude-model-policy/SKILL.md`(マーカー節と解決順手順 1 の削除)
- `skills/setup-agents/SKILL.md`(§7.2。description の担当表制約文言の削除)
- `references/orchestration-discipline.md`(「帯モデル」の定義: claude は担当表のモデル、custom はマーカー解決定義の `model`。モデル注入起動の enum 読み替え先は claude-model-policy の同帯モデルと明文化。**合成判定の frontmatter allow-list へ `agent-policy-vendor` を追加**)
- 既存テストの追随: `policies.test.ts` / `policy-skill-assignments.test.ts`(4 方針前提の書き換え)・`session-start.test.ts` / `subagent-start.test.ts`(分岐変更・同梱プリセット前提ケースの削除)・`compose.test.ts` / `setup-agents.test.ts`
- `plugin.json` / `package.json`(0.14.0-dev)、`plugins/agent-policy/README.md`(移行節・gate ひな形・env 配置案内)、ルート `README.md`、`.claude-plugin/marketplace.json`(description)

削除:

- `skills/{with-codex-policy,with-grok-policy,codex-grok-policy}/`
- `agents/{gpt-sol,gpt-terra,gpt-luna,grok}.md`・`src/agents/presets.ts`・`src/agents/build-presets.ts` とそのテスト(§4.3【要承認】)

削除操作がクラシファイアに拒否された場合は、絶対パスを提示してユーザーの手で実行する。

## 12. テスト方針

- `policies.test.ts`: POLICIES 2 件、`RECOMMENDED` が RoleId 10 種を網羅、claude-model-policy の ASSIGNMENTS が現行値と一致、aliasEnv / rolesAcrossPolicies 参照の消滅。
- `live-models.test.ts`: `data[].id` / `owned_by` のパース(大小文字・欠落)、BASE_URL 未設定・タイムアウト・HTTP エラー・不正 JSON の reason 分類、例外を投げない契約。HTTP は `src/testing/` のフェイクサーバー(node:http)で注入し、実プロキシに依存しない。
- `session-start.test.ts`: §6.1 の分岐全網羅(none / claude / custom / 旧 3 値 / 未知 / 大小文字)、custom の成立・不在フォールバック・照会失敗フォールバック・マーカー付き定義 0 件・全 Claude 構成(照会なし)・`inherit` と `model` 欠落の除外、claude / none で対応表が出ないこと、フォールバック時に対応表が出ないこと、非推奨通知、移行通知、ファイルを書かないこと。
- `subagent-start.test.ts`: injection が custom 系のときだけ対応表が合成されること。規律断片は全分岐で出ること。同梱プリセット前提ケースの整理。
- `delegation-gate.test.ts`: opt-in 値域(有効 3 値・それ以外無効)・`agent_id` 素通し・設定なし/空 glob・TTL 解除・対象外ツール・ルート外パス・glob 一致 deny・`mcpTools` のパス取り出し(absolute 両様)・deny 文言に対応表が載ること・fail-open。`--direct on|off|status` の動作。
- `parallel-nudge.test.ts`: 固定 additionalContext の出力、opt-out 値で無出力。
- `setup-agents.test.ts`: `--policy` / `--list-policies` / `--list-models` の拒否(廃止)、`--list-live-models` の形、`--model` の実在検証(存在・不在・照会失敗時の警告つき通過)、`--models` の照会成功時の間引きと照会失敗時の警告付き全生成、`--vendor` の必須条件と `none`、`agent-policy-vendor` の出力、役割の自由割当(担当表制約の廃止)とプロジェクト独自役割の通過。
- 文書検証: custom-policy スキルの帯一覧が RoleId 10 種と一致し、推奨列が `RECOMMENDED` と一致すること(`policy-skill-assignments.test.ts` の後継)。

## 13. リスクと受容 / 不採用案

### リスク

| リスク | 受容の理由と対処 |
| --- | --- |
| SessionStart に HTTP 照会が入り、起動が最大 3 秒遅くなり得る | タイムアウト 3 秒 + fail-open。照会するのは custom かつ enum 外モデルが存在するときだけ |
| セッション途中のプロキシ状態変化を検知しない | 起動時判定で固定。custom-policy の途中不達規定(帯読み替え・独立レビューは省略)と再起動で吸収 |
| フォールバック時、SubagentStart は子へマーカー対応表を配り続ける(親子乖離) | §6.4 のとおり受容。spawn ごとの HTTP 照会は割に合わない |
| 全体一括フォールバックは、生きている定義も巻き込んで無効化する | ユーザー決定。通知が不在定義を列挙するため、修復の導線は明確 |
| 全体一括フォールバック後の独立レビューは claude-model-policy の規定(Sonnet)で走り、custom の「省略」規則より弱い独立性になる | claude プロファイル自体の仕様として受容(Claude オンリー運用固有の限界)。custom 内の途中不達・未割当では省略規則が効く |
| フックの実行環境に `ANTHROPIC_BASE_URL` が無い構成では、custom が常にフォールバックする | §10-4 で実機検証し、README に `settings.json` の `env` 配置を案内する。フォールバック通知に reason が出るため沈黙はしない |
| 同梱プリセット廃止で既存の名指し利用が壊れる | README 移行節で告知。setup の推奨構成一括生成が代替【要承認】 |
| 照会失敗時の警告付き生成は実在保証を持たない | 接地は「照会成功時に強制」という一貫規則。生成物は次回 SessionStart の検証で検出される |
| 並列促しの効果が未実証 | 低コスト(dispatch 時のみ)であり、opt-out を用意する【既定有効は要承認】 |
| gate は Bash 書き込みと AI 自身の `--direct on` を技術的に止めない | ローカル版と同じ穴。deny 文言で禁止し、遵守依存であることを README に明記 |
| hooks.json 変更は全セッションに波及 | 新セッションでの発火確認を Done 条件に含める。gate は opt-in、nudge は opt-out 可 |
| 旧 injection 値の利用者が移行通知を見落とす | custom 扱いで動作は継続するため、見落としても壊れない |
| `scanAgents` は読み取り失敗と 0 件を区別できない | 現行実装の性質。0 件通知の文言に「読み取れない場合」を含めて誤導を避ける |

### 不採用案

- **帯単位フォールバック** — ユーザー決定で全体一括。粒度は細かいが、セッション内で 2 つの担当表が混在し、判断が複雑になる。§4.2 の「未割当帯の既定」は構成の既定であり、故障時フォールバックではない(用語を分離)。
- **UserPromptSubmit での毎ターン委譲・並列指示** — 過去に試行済み・不採用(スラッシュコマンド問題)。再提案しない。
- **エイリアス文字列のパターンからのベンダー推定** — エイリアスは任意文字列であり当てにならない。`owned_by` 推定 + 聞き取りフォールバックを採る。
- **`AMATSUKA_AGENT_*_ALIAS` の維持** — /v1/models 接地後は「既定エイリアスの差し替え」という問題自体が消える。二重の真実を残さない。
- **SubagentStart での /v1/models 再照会** — spawn ごとの HTTP 往復と遅延。乖離の受容(§6.4)で足りる。
- **gate の既定有効** — 導入しただけで全プロジェクトの編集がブロックされるのは過剰。opt-in + プロジェクト設定必須とする。
- **gate 設定の setup ウィザード統合** — 書き込み先が `.claude/agent-policy/` 配下の新ファイルになり、スキルの権限設計(Edit のパス限定)の再設計を要する。本改修では手作業 + README ひな形とし、将来の拡張点に残す。
- **gate の MCP 対象を hooks.json の matcher で列挙する** — ローカル版は列挙型だが、プラグインは利用者の MCP 構成を知らないため列挙できない。正規表現 matcher(`mcp__.*`)+ スクリプト内の設定照合を採る。
- **全ツール発火の additionalContext 注入** — トークン浪費。matcher で Task|Agent に限定する。

## 14. 実施手順と Done 条件

1. 本設計書のレビュー(doc-review 帯 + independent-review 帯。実施済み・第 2 版へ反映)とユーザー承認。
2. 着手時に最新 `git status` と HEAD で対象を再確認し、lint / typecheck / test の baseline を記録する。無関係な未コミット変更を revert しない。
3. §10 の実機検証を先に行い、食い違いは設計へ反映してユーザーへ報告する。
4. テスト先行で実装する。タスク分割と順序は実装セッションが本設計書から立案する。
5. Done 条件: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。`src/` 変更に対応する `scripts/` 差分(および `agents/` の削除)が同じコミットにある。`plugin.json` / `package.json` が揃って `0.14.0-dev`。ルート README・プラグイン README(移行節)・marketplace.json 反映。hooks 追加が新セッションで発火することを確認。ARCHITECTURE への影響(同梱エージェント表・フック構成)を `/metatron:update` で追随。`.serena/memories/` の食い違い(方針スキル 4 本前提の記述)を更新。
