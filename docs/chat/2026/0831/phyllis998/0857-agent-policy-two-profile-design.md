# agent-policy 2プロファイル構成の設計

- 日付: 2026-08-31
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 設計書・実装計画書(未作成・セッション内で出力予定)
- 前提: agent-policy外部Agent割当設計 v4、setup-agents設計書
- セッション ID: 06217072-7080-4848-9f18-1cb92d01740a

---

## セッション 1: agent-policy 2プロファイル構成の設計推論

# phyllis998

> agent-policyの方針転換・改修を行います。
> 次の方針が可能か、価値があるのかをまずは推論してください。
> as-is: ベンダー毎のプロファイルとrole-idによって、プロジェクト定義のエージェントによる最適化方針
> to-be: Claudeオンリープロファイルと、role-idプロファイルによる2プロファイル構成。Claudeオンリープロファイルではagent-policyレガシーな、Claudeのモデル名だけを担当表に含むもの(role-id無関係)。role-idプロファイルではsetup-agentsでモデル・名前・tools・role-idがカスタマイズされた最適化エージェントを、担当表にrole-idのみを含む、ユーザーが最適か方針を決められる自由な構成。ただしプラグインとしての推奨モデルが存在する。setup-agentsは、curl /api/v1/modelsの結果のみをモデルの選択肢に出す。role-idプロファイルは、curl /api/v1/modelsの結果振り分けられたエージェントのmodelが存在しなかったらClaudeプロファイルにフォールバックする(ユーザーに明示する)。PreToolUse hookで、"可能な限りサブエージェントを並列dispatchすること"というメッセージを送る。
> goal: 調査・推論・設計・設計書の出力・/goalコマンドで実装するためのプロンプトの出力

## セッション 2: PreToolUseサブエージェント起動抑止対策・フォールバック全体一括・ベンダー固有規律の方向確定

# AI

方針転換の推論開始。まず規律スキルをロードし、現状設計を把握する。

規律読込済み。現状把握のため関連ファイルを確認する。

バージョン 0.13.1-dev — 外部 Agent 設計は実装済み。setup-agents は既に v1/models へ言及あり。現行仕様を precisely 把握する。

待機中に実装層の現状を確認(改修コスト見積り用)。

# 推論結果: 可能。価値あり。PreToolUse のみ条件付き

## 結論

- **2 プロファイル化 + /v1/models 接地 + 起動時フォールバック検知 → GO 推奨**。基盤ほぼ既存、既知の弱点を正面解消。
- **PreToolUse 並列促しメッセージ → 技術的に可能だが効果根拠薄い**。スコープ縮小(matcher `Task` 限定)か切り出し推奨。

## as-is 確認(0.13.1-dev)

- 担当表正本 = `src/agents/policies.ts` の `ASSIGNMENTS`(4 方針 × 10 role-id マトリクス)。
- 役割マーカー + SessionStart 注入は**既に「担当表より優先」**。to-be は override 機構を主機構へ昇格させる自然な完成形 — 8/24 設計から方向一貫。
- setup-agents 統合済み。ただしモデル選択肢は担当表由来。プロキシ確認は「確認方法の提示に留める」= 実照会なし。
- 8/24 設計 §8.3 が明記した既知弱点:「フックはプロキシへ問い合わせないため事前検知できない」→ `unknown provider for model` 沈黙故障。今セッション冒頭の Grok 4.6 エイリアス警告がまさにこの症状。

## Feasibility 検証結果

**① 2 プロファイル化: 可能。**
- Claude オンリー = `claude-model-policy` 既存流用。role-id プロファイル = with-codex / with-grok / codex-grok 3 本の置換。
- role-id 10 種・マーカー・注入・setup ウィザード・合成器、全部既存。主作業は方針スキル再編 + `ASSIGNMENTS` 再構造(4×10 → Claude 表 + 役割別推奨モデル表)。

**② /v1/models 接地: 可能。**
- CLIProxyAPI の `/v1/models` 提供確認済み(`docs/development/cliproxyapi-setup.md:126-131`)。認証 = `Bearer $CLI_PROXY_API_KEY` = `ANTHROPIC_AUTH_TOKEN`、URL = `ANTHROPIC_BASE_URL` から再構成 → CLI 子プロセスから fetch 可。`ANTHROPIC_API_KEY` 前提にしない(規約適合)。
- `ANTHROPIC_BASE_URL` 未設定(プロキシなし)時は照会せず、Claude enum(`sonnet`/`opus`/`haiku`/`fable`)のみ選択肢に出す設計必要。enum はプロキシ無関係に常時有効。
- **要実機検証 1 点**: `/v1/models` 応答に `oauth-model-alias` のエイリアス名が載るか(実体モデル ID だけだと接地不成立)。

**③ SessionStart フォールバック検知: 可能。**
- 既存 hook の fail-open 構造にタイムアウト付き照会を追加。照会失敗 = モデル存在不明 → Claude プロファイルへフォールバック + 注入文で明示。現行の「委譲時に沈黙して死ぬ」より明確に良い故障モード。

**④ PreToolUse メッセージ: 技術的に可能(公式ドキュメントで裏取り済み)。**
- PreToolUse では **plain stdout は Claude に届かない**(debug log 行き)。JSON の `hookSpecificOutput.additionalContext` が必須。matcher で `Task` のみに絞れる。
- ただし価値に疑義 3 点:
  - `orchestration-discipline.md` に並列 dispatch 規律既存 → 重複注入。
  - 本プロジェクトの過去実績: 注入型ナッジは Fable 5 委譲問題で効果なし・不採用(PreToolUse deny だけ効いた)。対象問題は別だが、効果未実証。
  - 全ツール発火はトークン浪費。`Task` 限定なら dispatch 時のみ発火で低コスト、次ターンの並列化に効く可能性はある。

## 価値評価(軸別)

- **保守性**: 方針スキル 4→2。GPT/Grok dispatch 節の逐語重複消滅。新ベンダー追加コスト、現行「新方針スキル + ASSIGNMENTS 列 + プリセット」→ **ゼロ**(setup でエイリアス選ぶだけ)。効果大。
- **堅牢性**: エイリアス沈黙故障の起動時検知化。`AMATSUKA_AGENT_*_ALIAS` の既定値追随問題(Grok 4.5→4.6 移行痛)も消滅方向。効果大。
- **自由度**: 担当表 = 役割の意味定義 + 推奨に純化、割当はユーザー主権。狙いどおり。
- **却下案との非衝突**: external-agent v4 の却下案(割当マップ / 派生定義生成 等)の再提案には当たらない。既存マーカー機構の主流化。

## リスクと設計争点(設計フェーズで決める事項)

1. **ベンダー固有規律の行き場** — 担当表からモデル名が消える → Grok「X 由来情報を未検証と明示」・GPT dispatch 節が宿主喪失。エイリアス文字列からベンダー推定は不可(任意名)。案: setup がベンダーを聞き取り、既存のベンダー別断片機構で定義本文へ焼き込み + SessionStart 注入へ帯別 dispatch 注記。
2. **フォールバック粒度** — 「Claude プロファイルへフォールバック」を全体一括にするか帯単位にするか。帯単位なら生きている定義を使い続けられる。さらに独立レビュー帯は現行「Grok 不可なら**省略**、Opus で代行しない」— Claude 表へ落とすと独立性が消えるため、帯別のフォールバック規則上書きが必須。
3. **実装直後の churn** — 0.13.x(外部 Agent 合成・SubagentStart 配布)完了直後。共通規律の「委譲先の実行モデルの確定」判定フローは「帯モデル」概念前提 → 追随改修必要。8/24・8/25・8/27 の 3 設計分の改訂を伴う。工数は中〜大。
4. **`AMATSUKA_AGENT_AUTO_INJECTION` の値体系移行** — 3 値(with-codex 等)の廃止 or 互換受理 + 移行導線。

## 確認したい点(設計着手前)

1. PreToolUse メッセージ: `Task` matcher 限定で本改修に含めるか、効果未実証として切り出す(見送る)か。
2. フォールバック粒度: 帯単位(推奨)か全体一括か。独立レビュー帯の「省略」規律は維持でよいか。
3. この方向で設計フェーズ(context-map → 設計書 → Haiku/Grok レビュー → /goal プロンプト)へ進めてよいか。

推論結果は前掲のとおり。設計着手前の確認 3 点(PreToolUse の採否、フォールバック粒度、設計フェーズ進行可否)への回答待ち。

記録完了。ユーザー回答待ち継続(PreToolUse 採否 / フォールバック粒度 / 設計フェーズ進行可否)。

# phyllis998

> 1. PreToolUseの狙いは、system promptsによってサブエージェントの自動起動が抑止されている(ユーザーによる起動指示がない限り起動しない)ことへの対策です。ちなみにこれは現行output-styleでも対策を試みていますがあまり効果は無い様子。別の対策方法を模索しています。他に良さそうな方法はありますか？
> 2. 全体一括
> 3. ベンダー固有規律とサブエージェント起動抑止への対策をもう少し詰めたいです。また、AMATSUKA_AGENT_AUTO_INJECTIONは、改修後 "none" / "claude" / "custom" にすることを想定しています。

## セッション 3: delegation gate 同梱化と自動起動抑止対策の検討深化

# AI

2 論点深掘り。まず実証済み知見(delegation gate 実装と教訓メモリ)確認。

# 深掘り結果: 起動抑止対策とベンダー固有規律

## 論点 1: サブエージェント起動抑止への対策

試行済み知見(プロジェクト記録)整理:

- **効果あり(実証済み)**: PreToolUse **deny**(`tools/delegation_gate.py`)。deny の `permissionDecisionReason` は **Claude に見える**(公式確認済み。allow の reason はユーザーにしか見えない)→ 「編集しようとした瞬間」に委譲指示が文脈へ届く唯一の実証済み経路。
- **効果なし**: スキル本文の命令形強化、最優先宣言。
- **不採用(再提案しない)**: output style への system prompt 原文引用+名指し上書き(Fable 5 安全機構発火)、UserPromptSubmit 毎ターン注入(スラッシュコマンド問題)。
- **制約**: 対策はモデル非依存。`--append-system-prompt` は最終手段。

### 推奨: delegation gate の agent-policy 同梱化(opt-in)+ Task 限定 additionalContext

**案 A(推奨・主対策): gate プラグイン化。**
プロジェクトローカル実装で実証済みの構造を汎用化して同梱:

- PreToolUse hook、matcher `Edit|Write|NotebookEdit`。TypeScript 実装(規約準拠、現 Python はプロジェクトローカル暫定)。
- **opt-in**: 環境変数(例 `AMATSUKA_AGENT_DELEGATION_GATE`)未設定なら即 exit 0。hooks.json は全セッション影響のため fail-fast 必須。
- **deny 対象 glob はプロジェクト設定へ外出し**(`.claude/agent-policy/` 配下。既存のプロジェクト設定置場)。ローカル版の DENY_GLOBS はこのリポジトリのドメインマップ焼き込み → 汎用化必須。gate 対象の MCP 編集ツール(Serena 等)も同設定で追加可能にする(既定は built-in 3 種のみ)。
- サブエージェント素通し: hook 入力 `agent_id` 有無判定(実証済み)。
- 一時解除: TTL フラグ + 解除 CLI(実証済みパターン移植)。
- **deny 文言を role-id プロファイル連動に**: 現ローカル版はエージェント名ハードコード。同梱版は「担当表の帯へ委譲」+ マーカー解決済み定義名を動的列挙 → 今回の改修と自然に噛み合う。

**案 B(併用可・軽量): PreToolUse matcher `Task` 限定 additionalContext。**
発火 = dispatch 時のみ → トークン低コスト。「独立タスクは 1 メッセージで並列 dispatch」を注入。起動そのものの抑止には効かず(dispatch 済みの時点で発火)、**並列化の維持**にだけ効く。効果未実証だが害小。

**案 C(未評価の別案): UserPromptSubmit の先頭 `/` 判別変種。** メモリ上「不採用と区別された未評価案」。gate より弱い見込み。優先度低。

**非推奨**: 全ツール発火の additionalContext(浪費+効果根拠なし)、description への "use PROACTIVELY" 強化(system prompt 抑止に対し弱い)、`--append-system-prompt`(環境整備要+宣言だけでは効果なしの実績)。

判断軸: 起動抑止の本質は「直接編集という代替手段の遮断」であり、注入型ナッジは全滅実績。**deny だけが行動を変えた** → 主対策は案 A、案 B は補助。

## 論点 2: ベンダー固有規律の行き場

現行のベンダー固有記述を棚卸し → **二層に分解すると orchestrator 側の固有記述はほぼ消せる**:

- **受け手規律(定義本文側)** → 既存のベンダー別断片機構(`<role-id>.<vendor>.md`)で焼き込み。Grok「X 由来情報を未検証と明示」は既にこの形。setup がモデル選択後に**ベンダーを聞き取り**(gpt / grok / claude / その他)、frontmatter へ `agent-policy-vendor` を記録。
- **依頼側規律(dispatch 時に依頼文へ書く事項)** → 現行 GPT 節と Grok 節はほぼ同文(tools 明記・役割明示・Output Format 指定・読み取り制約)。**ベンダー非依存の「外部 Agent dispatch 共通規律」へ統合**し、custom プロファイル 1 本に置く。
- **SessionStart 注入へ vendor 添記**: マーカー表の各行に `(grok)` 等を添える → オーケストレーターがベンダー特性を選択判断に使える。注入コスト微小。
- **独立レビュー手順の role 化**: 「Haiku → Grok」を「doc-review 帯 → independent-review 帯。independent-review 帯の定義が無ければ省略」へ。
- **フォールバック**: 全体一括決定によりベンダー別チェーン消滅。`codex:rescue` 経路も custom プロファイルから落とせる(フォールバック = Claude プロファイル一括、の一本化)。セッション途中のプロキシ死は「Claude プロファイルへ読み替え or 再起動」の 1 文で処理。

## AMATSUKA_AGENT_AUTO_INJECTION = none / claude / custom

- 成立する。`none` = 注入なしの明示値。
- **旧値の移行**: `with-codex` / `with-grok` / `codex-grok` は「`custom` として扱い + 移行通知を注入」を推奨。旧値ユーザー = プロキシ利用者 = custom の想定利用者であり、モデル不在なら全体一括フォールバックが受け止める → 移行が壊れない。`claude` は同値継続。

## 確認 3 点

1. 案 A(gate 同梱化・opt-in)を本改修スコープに含めるか。含める場合、deny 対象 glob の設定方式は `.claude/agent-policy/` 配下の設定ファイルで良いか。
2. 案 B(Task 限定並列促し)は含めるか、見送るか。
3. 旧環境変数値 → 「custom 扱い+移行通知」で良いか。

問題なければ設計フェーズ(context-map → 設計書 → Haiku/Grok レビュー)へ進む。

深掘り結果は前掲。確認 3 点(gate 同梱化の採否と設定方式 / Task 限定並列促しの採否 / 旧環境変数値の扱い)への回答待ち。

記録完了。確認 3 点への回答待ち継続。

# phyllis998

> 案Aのスクリプトについて、具体的に何をするのかを確認したいです

> 案Aのスクリプトについて、具体的に何をするものなのかを確認したいです

## セッション 4: 委譲ゲートスクリプトの具体動作と実装方針の確定

# AI

# 案 A スクリプトの具体動作

**一言で: 「メインセッションが実装・指示層のファイルを直接編集しようとした瞬間、そのツールコールを拒否し、拒否理由文として『担当表の帯へ委譲せよ』を Claude の文脈へ差し込む」PreToolUse hook。** 実証済みのローカル版 `tools/delegation_gate.py` の汎用化・同梱化。

## 発火と入出力

- 登録: `plugins/agent-policy/hooks/hooks.json` に PreToolUse 1 エントリ。matcher は `Edit|Write|NotebookEdit|mcp__.*`(MCP 編集ツールを設定で足せるようにするため、MCP は広く受けてスクリプト内で絞る)。
- 入力: stdin の hook JSON(`tool_name` / `tool_input` / `agent_id` / `cwd`)。
- 出力: 拒否時だけ stdout へ deny JSON。それ以外は無出力 exit 0 = 許可。

## 1 コールごとの判定フロー(上から順、どれかに当たれば即「許可」)

1. **フェイルオープン** — 例外発生時は何も出さず終了。編集を妨げない。
2. **opt-in 判定** — 環境変数(例 `AMATSUKA_AGENT_DELEGATION_GATE`)未設定 → 即終了。プラグイン導入だけでは挙動が変わらない。
3. **サブエージェント素通し** — hook 入力に `agent_id` あり = サブエージェント内のコール → 許可。gate が縛るのは**メインセッションだけ**。委譲先の実装作業は一切妨げない。
4. **一時解除判定** — TTL フラグファイル(mtime が 2 時間以内)あり → 許可。ユーザーが解除 CLI(`on|off|status`)で作る。
5. **対象ツール判定** — built-in 3 種 + 設定ファイルで宣言した MCP 編集ツール以外 → 許可。
6. **対象パス判定** — `tool_input` からパス抽出(`file_path` / `notebook_path` / MCP は設定でフィールド名宣言)、プロジェクトルート相対へ正規化。ルート外 → 許可。
7. **glob 照合** — 設定ファイルの deny glob(例: `plugins/*/src/**`、`plugins/*/skills/**`)にマッチ → **拒否**。

## 拒否時に起きること

deny JSON の `permissionDecisionReason` は **Claude に見える**(公式仕様)。文言内容:

- メインセッションでこの層を編集しない方針であること
- 担当表の帯へ Agent tool で委譲すること(SessionStart が注入済みのマーカー対応表を参照させる)
- Bash 書き込みや別ツールへの切替で回避しないこと
- 解除はユーザー自身が解除 CLI を実行すること(AI は解除できない)

→ Claude は編集できず、文脈に委譲指示が入った状態で次の行動を選ぶ = 委譲に倒れる。これがローカル版で実証済みの機序。「注入で促す」のではなく「代替手段を塞いだ上で、塞いだ理由として委譲先を示す」。

## やらないこと

- ファイル変更・ネットワークアクセスは一切しない(判定と JSON 出力のみ)。
- サブエージェントの編集は止めない。
- Bash 経由の書き込みは技術的には止まらない(文言で禁止するのみ。ローカル版と同じ既知の穴)。

## ローカル版からの変更点

- deny glob・MCP ツール一覧のハードコード → `.claude/agent-policy/` 配下の設定ファイルへ外出し(このリポジトリのドメインマップ焼き込みを排除)。
- deny 文言のエージェント名ハードコード(`gpt-sol-lead-implementer` 等)→ 帯ベースの汎用文言へ。
- Python → TypeScript(`src/` → ビルドで `scripts/delegation-gate.mjs`。規約準拠)。
- 常時有効 → 環境変数 opt-in。

構造理解に有用な点 1 つ: この hook はプラグイン配布物になるため全導入プロジェクトで発火するが、opt-in 判定を最初に置くことで「hooks.json 変更 = 全セッション影響」の保護パス規律と両立させる。ローカル版が「プラグイン不変更が条件」で作られた経緯の裏返しであり、今回はプラグイン改修そのものが依頼なので同梱へ昇格できる。

確認 3 点(gate 採否と設定方式 / Task 限定並列促し / 旧環境変数値の扱い)は引き続き回答待ち。

案 A の動作説明は前掲。確認 3 点への回答待ち。

記録完了。回答待ち継続。

# phyllis998

> 1. 案Aをスコープに含める
> 2. 案Bを含む
> 3. その方針で

## セッション 5: 実装用プロンプトの prompt-smith 検証

# AI

全決定確定。設計フェーズ開始。規律に従い context-map 準備: ガイドと 0.13 実装済み設計(SubagentStart 二段フック)を先に読む。

なお、これから出力する設計書・プロンプトのファイルは通常日本語で書く(原始人口調は適用しない。希望あれば指示を)。

context-map 作成開始。探索実働を委譲(同梱 `agent-policy:grok`。廃止済み `grok-researcher` は使わない)。並行して 0.13 設計書を自分で読む。

探索完了。context-map 作成 → 設計書執筆へ。テンプレート取得 + `/v1/models` 応答形状の実機確認(設計の前提固め。トークンは出力しない)。

context-map 完成: `.claude/context-maps/2026-08-31-agent-policy-two-profile.md`。設計書執筆。

レビュー実行中。並行して /goal 用実装プロンプトを起草(設計書パス参照型のため、レビュー反映後も内容は安定)。

プロンプト起草完了。レビュー結果待ち。

Haiku レビュー受領(重大矛盾なし・詳細化要求 4+6 件)。Grok 独立レビュー待ち。

Grok レビュー継続中(実装との突き合わせ進行中)。再待機。

# 設計フェーズ完了 — 設計書第 2 版・レビュー反映済み。承認待ち

## 成果物

- **設計書(第 2 版)**: `harness-docs/design/2026-08-31-agent-policy-two-profile-design.md`
- **context-map**: `.claude/context-maps/2026-08-31-agent-policy-two-profile.md`
- **/goal 用実装プロンプト**: `docs/prompts/2026-08-31-agent-policy-two-profile-implementation-prompt.md`

## 設計中の実測で確定した重要事実

- `/v1/models` 実測成功: プロキシの**エイリアス名が id にそのまま載る** → 接地成立。さらに `owned_by`(openai/xai/anthropic)で**ベンダー自動推定可能** → setup の聞き取り大幅簡素化。
- PreToolUse: plain stdout は Claude に届かない → `additionalContext` JSON 必須。deny reason は Claude に見える(gate の機序の裏付け)。

## レビュー結果と反映

Haiku(理解+暗黙知)と Grok(独立・前提検証)を並列実施。**重大な前提誤りなし、ただし Grok が実装契約を壊す見落とし 22 件を検出** → 第 2 版で全採用。主な是正:

- **matcher 仕様の自己矛盾**: `mcp__.*` は正規表現として有効(exact 列挙と regex の 2 様式)。§2.2 訂正。
- **`agent-policy-vendor` frontmatter が 0.13 の合成 allowlist を壊す** → allowlist へ追加を明記(見逃すと外部 Agent 合成が全滅する致命傷だった)。
- **setup CLI の policy 依存パイプライン**(requirePolicy/modelsFor 等 9 箇所)の再設計を明記。custom はモデル×役割の組合せ制約自体を廃止。
- **オフライン時に推奨一括生成が空になる穴** → 照会失敗時は警告付きで既定エイリアス生成(接地は「照会成功時に強制」の一貫規則)。
- **マーカー無し定義の model で誤フォールバックする穴** → 検証対象は roles 非空の定義のみ、`model` 欠落・`inherit`・enum は対象外。
- **claude 運用でも SubagentStart が対応表を配る不整合** → 対応表合成を custom 系 injection 限定に。
- 独立レビュー省略例外を起動時・途中不達で一貫化。env 値域の正規化規則。旧 3 値は既知互換値扱い。

## 要承認 2 点(設計書内【要承認】)

1. **同梱プリセット 4 定義(gpt-sol/terra/luna/grok)の廃止** — custom では解決順から外れ、二重管理だけ残るため。既存の名指し利用は壊れる(README 移行節で告知)。
2. **並列促し hook の既定有効**(opt-out env あり) — 低コストだが効果未実証。

## 次の手順

この 2 点の判断(または修正指示)+設計承認 → `docs/prompts/2026-08-31-agent-policy-two-profile-implementation-prompt.md` を /goal へ入力して実装セッション起動。実装セッションが実機検証 §10 → 実装計画 → テスト先行実装を運ぶ。

設計フェーズの報告は前掲。要承認 2 点(プリセット廃止 / 並列促し既定有効)+設計承認の回答待ち。

記録完了。要承認 2 点+設計承認の回答待ち継続。

# phyllis998

> 実装用プロンプトはprompt-smithを通しましたか？
