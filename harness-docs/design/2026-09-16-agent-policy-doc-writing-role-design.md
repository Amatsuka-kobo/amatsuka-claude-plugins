# agent-policy 役割 `doc-writing` の追加とベンダー `gemini` / ModelId `gemini-flash` の追加 設計書

- 作成日: 2026-09-16
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.18.0-dev` → `0.19.0-dev`
- 状態: 設計(実装前・第 1 版)
- context-map: `.claude/context-maps/2026-09-16-agent-policy-doc-writing-role.md`
- 関連: `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`(担当表の一本化)、`2026-08-31-agent-policy-two-profile-design.md`(2 プロファイルと `owned_by` の実測)

## 1. 背景と目的

役割 `general`(その他のタスク)は、いまドキュメント作業と定型メンテナンスの両方を抱えている。しかし AI が読む文書 —— 設計書・実装計画書・Skills・Agents 定義・Rules・CLAUDE.md・フックが注入する文 —— の執筆には、一般作業とは別の規律が要る。直訳を避ける、その言語の文法と慣用に従う、簡潔に書く、余計な背景と引用を落とす、といった規律である。これらは `general` の断片のどこにも書かれていない。

同時に、プロキシ(CLIProxyAPI)に Gemini のエイリアスを追加したため、setup-agents が Gemini のモデルを扱えるようにする必要がある。

本改修は次の 2 つを行う。

1. 17 番目の役割 `doc-writing`(文書作成)を追加し、`general` から文書の責務を移す。執筆規律を役割断片に書く。
2. ベンダー `gemini` と ModelId `gemini-flash` を追加する。

2 つは独立した改修だが、`doc-writing` の推奨モデルに `gemini-flash` を入れるため、同じバージョンでまとめて出す。

## 2. 確定要件(ユーザー承認済み 2026-09-16。本設計はこれを前提とし、覆さない)

### 2.1 役割 `doc-writing`

1. label は ja「文書作成」、en は自然な英語表記。kind は `impl`。tools は `Read, Grep, Glob, Write, Edit, Bash, Skill`。
2. Agent Tool は「否」。`SOLO_DENIED_ROLES` へ追加し、担当表の列も「否」にする。
3. `ROLES` への挿入位置は `design-plan` の直後(`explore-lead` の前)。`advisor` は末尾のまま保つ。
4. `ASSIGNMENTS`(Claude モデル)は `sonnet`。`RECOMMENDED` は **`["sonnet", "gemini-flash", "gpt-terra"]`**(並びはこの順。追加要件 E。ユーザー承認済み 2026-09-16)。`doc-writing.gpt.md` の overlay 断片は作らない(gemini と同じ判断。§4.10)。
5. `default-name` は `writer`。
6. When to invoke は、AI が読む文書の執筆(設計書・実装計画書・引継ぎ書・context-map・Skills・Agents・Rules・References・CLAUDE.md・Output Styles・フックが注入する文・プロンプト)、コードコメントの執筆、その他の文書の執筆。
   - **オーケストレーター決定(2026-09-16、レビュー指摘の採用)**: このうち設計書・実装計画書・context-map は「内容が確定した後の文章化・推敲・翻訳」に限定する。内容の決定と初稿は `design-plan` / `explore-lead` が担い、規律 L166 は変えない(§4.5)。
7. 作業手順に執筆規律を入れる。直訳せず意訳する / その言語の文脈と文法に従う / 簡潔でわかりやすく書く / 難しい言い回しと回りくどい言い回しを避ける / 過剰な引用と出典・冗長な表現・読み手を混乱させる背景と根拠を書かない。
8. 日本語の言い換えの例は ja 断片だけに載せる。en 断片には「対象言語の慣用に合わせる」という一般規律だけを書き、日本語の例は載せない。
9. 制約は「依頼された文書ファイルだけを作る」「設計内容・要件を自分で決めない」。内容の決定は `design-plan` / `explore-lead` / オーケストレーターが持つ。
10. `design-plan` と `explore-lead` の断片に「文書の文体は『文書作成』の規律に従う」旨を 1 行足す。
11. `general` 断片(ja/en)の description・When to invoke・Core Responsibilities から文書作業を外し、定型メンテナンス中心に書き換える。
12. 共通規律 `references/orchestration-discipline.md` の担当表へ 1 行足す。本文で `general` を名指しする箇所の意味が変わらないことを確認する。「設計・実装計画の規律」節への追記の要否は設計判断とする。

### 2.2 ベンダー `gemini` / ModelId `gemini-flash`

1. ModelId は `gemini-flash` だけを追加する(`gemini-pro` は載せない)。label `Gemini Flash`、defaultName `gemini-flash`、model `claude-gemini-3-8-flash`、color `green`。
2. `Vendor` 型に `gemini` を追加する。`compose.ts` の `COLORS` と `setup-agents.ts` の `VENDOR_COLORS` はともに `green`。
3. `--vendor` の検証・推定失敗の文言・SKILL.md の vendor 列挙を 4 値から 5 値へ広げる。
4. `live-models.ts` の独立した Vendor union を `fragments.ts` の `Vendor` へ統合する。`unknown` の扱いは維持する。
5. `vendorFor` は `owned_by` が `antigravity` のとき `gemini` を返す(プロキシの実測値)。`google` も受けるかは設計判断とする。
6. gemini 用の overlay 断片(`<id>.gemini.md`)は作らない。
7. README のモデル ID 表を 10 種、役割 ID 表を 17 種へ。MCP 既定付与の実装役割の列挙(README・SKILL.md)に `doc-writing` を足す。SKILL.md の `--scope custom` のモデル列挙と既定エイリアス列挙にも足す。
8. `cliproxyapi.config.example.yaml` は設定済みでありスコープ外。`docs/development/cliproxyapi-setup.md` の追随もスコープ外。

### 2.3 全体

1. バージョンは `0.18.0-dev` → `0.19.0-dev`。`plugin.json` と `package.json` を揃える。
2. 役割数 16 を固定する全テスト、`rolesFor("sonnet")`、`EXPECTED_AGENT_TOOL`、`--list-roles` の配列、defaultName、`discipline-role-table.test.ts` の `MODEL_IDS`、`vendorFor` のテストを網羅する。
3. README に移行節「0.18 系から 0.19 系へ」を追加し、ルート `README.md` を追随させる。`.serena/memories/agent_policy/core.md` は Serena 経由で更新する。
4. このリポジトリの `.claude/agents/` の定義は setup-agents の再実行で追随させる。`doc-writing` の定義は Sonnet 1 つと gemini-flash 1 つを新設する。

### 2.4 impl 役割からの `doc-writing` 再委譲(追加要件 D。ユーザー承認済み 2026-09-16)

1. **規律**: impl 役割 7 種(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan` / `explore-lead`)のサブエージェントは、`doc-writing` の When to invoke に該当する文書を書くとき、役割マーカーの対応表に「文書作成」の定義が**あれば必ず**そこへ再委譲する。**無ければ自分で書く**(差し戻さない)。
2. **Agent Tool の解禁**: `light-impl` を「可」にする(担当表の列と `SOLO_DENIED_ROLES`)。`AGENT_DENIED_MODELS` を空にし、Haiku の定義にも Agent Tool を付ける。Agent の可否は役割だけで決まる。`allowsAgentTool` の `model` 引数の扱いは設計判断とする。
3. **`_common.md`**(ja/en): 「`Agent` tool はアドバイザー相談専用」を「アドバイザー相談と、文書作成役割への再委譲の 2 用途に限る」へ改める。再委譲先へ Agent Tool を許可しない。依頼文に書く 4 点(サブエージェントであること / 役割は文書作成 / 内容は確定済みで文章化と推敲だけ / 対象ファイルのパス)を明記する。
4. **役割断片**: D1 の 1 行を 7 つの impl 断片へ個別に置くか `_common.md` へ共通で置くかは設計判断とする。`doc-writing` 断片自身の制約に「自分は再委譲しない」を書く。
5. **共通規律**: 「サブエージェントは〜」で始まる条項を 1 つ追加する。担当表の `light-impl` の Agent Tool を「可」へ。
6. **オーケストレーター側の規律**の要否は、`subagent-start.ts` の注入内容を確認して決める(設計判断)。
7. **テスト**: `EXPECTED_AGENT_TOOL`、`allowsAgentTool` のモデル関連、担当表の Agent Tool 列、`compose.test.ts` の Agent 付与、`setup-agents.test.ts` の Haiku 関連を洗い出す。
8. **README**: 移行節に D2 の挙動変化(Haiku の定義に Agent が付く。既存定義は再生成で追随)を書く。

### 2.5 オーケストレーターの文書作成規律(追加要件 F。ユーザー承認済み 2026-09-16)

1. 共通規律へオーケストレーター向けの条項を追加する。オーケストレーターは `doc-writing` の When to invoke に該当する文書を自ら書かず、担当表の「文書作成」の役割へ委譲する。委譲先の解決は §委譲先の解決 に従う(対応表 → 候補 → ビルトイン `general-purpose`)。依頼文には確定した内容・対象パス・参照すべき既存文書を渡し、内容の決定はオーケストレーターが持つ。
2. 置き場所(既存節への追加か新節か)は設計判断とする。L59「担当表の全役割はサブエージェントが担う。オーケストレーターはそのどれも自ら実行しない」との関係を明記する。
3. §4.15 の「オーケストレーター側の規律は不要」は D についての判断であり、F とは別論点であることを明記する。
4. 引継ぎ書と goal コマンドのプロンプトも対象に含め、条項の例示に入れる。
5. 「要件分析」「報告の突き合わせ」の成果は依頼文の中に書くものであり、ファイルとして残す文書ではないため対象外とする。
6. README の移行節へ 1 項追加し、Serena メモリの追随項目に含める。

## 3. 前提(実測)

### 3.1 コードの現況

| 対象 | 実測 |
| --- | --- |
| `src/agents/roles.ts` L3-19 | `RoleId` 16 種。L29-126 が `ROLES` 16 件 |
| 同 L132-135 | `roleOrder` は `ROLES` の添字。並び順が担当表・CSV・`--list-roles` の正本 |
| `src/agents/policies.ts` L4-13 | `ModelId` 9 種 |
| 同 L47-120 | `MODELS` 9 件。末尾は `grok`(添字 8) |
| 同 L124-146 | `ASSIGNMENTS["claude-model-policy"]` が `Record<RoleId, ModelId[]>` |
| 同 L149-166 | `RECOMMENDED` が `Record<RoleId, ModelId[]>` |
| 同 L174-181 | `SOLO_DENIED_ROLES` は非 export の `const`。6 役割 |
| 同 L183-186 | `allowsAgentTool(ids, model?)` |
| 同 L170 | `AGENT_DENIED_MODELS = ["haiku"]`。非 export |
| 同 L183-186 | `allowsAgentTool` の呼び出し元は `compose.ts` L44(`withAgent`)と L127(`describeRoles`)の 2 箇所だけ。`model` 引数を渡すのもこの 2 箇所である |
| `src/agents/compose.ts` L15 | `ComposeInput.modelId?: ModelId`。compose.ts 内での用途は上の 2 箇所の Agent 判定だけである |
| `src/setup-agents.ts` L65 / L313 / L353 / L373 | `Target.composeModelId` は `ComposeInput.modelId` を埋めるためだけに存在する |
| `src/agents/compose.ts` L44 / L79-91 | `withAgent` が偽のとき、`## アドバイザーへの相談` と `## Agent tool の制約` の両節を出力しない。前者は独立した節、後者は `## 制約` の先頭へ差し込まれる |
| `src/agents/vocabulary.ts` L15-17 / L27 | `bodyOrder` は `When to invoke` / `Core Responsibilities` / `作業手順`(en は `Procedure`)。`agentConstraintHeading` は `## Agent tool の制約` |
| `assets/roles/{ja,en}/_common.md` L18-20 | `## Agent tool の制約` 節は 1 項のみ。「`Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。」 |
| `src/hooks/subagent-start.ts` L218 / L254 | すべてのサブエージェントへ役割マーカーの対応表を `additionalContext` として注入する。対応表が無い環境では `対応表なし(…)` の文言になる(L17) |
| `src/agents/fragments.ts` L6 | `export type Vendor = "gpt" \| "grok" \| "claude" \| "none"` |
| 同 L42-57 | 断片の本文は `## ` 見出し単位で行を集める。`### ` は直前の `## ` 節の本文行として扱われる |
| `src/agents/compose.ts` L33-37 | `COLORS: Record<Vendor, string>`。`gpt:yellow / grok:red / claude:blue / none:blue` |
| `src/setup-agents.ts` L79-83 | `VENDOR_COLORS: Record<Vendor, string>`。値は `COLORS` と同じ |
| 同 L254-270 | `resolveVendor`。live 照会に成功して `unknown` のとき throw する |
| 同 L267 | 文言 `pass --vendor gpt\|grok\|claude\|none` |
| 同 L942-949 | `--vendor` の値検証。4 値以外で throw |
| `src/agents/live-models.ts` L5 / L9 | `vendors` の値型が `"gpt" \| "grok" \| "claude" \| "unknown"`。`type Vendor` はこのファイル内のローカル別名 |
| 同 L17-32 | `vendorFor`。`openai` → `gpt`、`xai` → `grok`、`anthropic` → `claude`、他は `unknown` |
| `references/orchestration-discipline.md` L5-29 | 担当表。5 列 16 行 + 列の説明 4 項 |
| 同 L115 | 「合成の対象とする役割は、担当表のうち「その他のタスク」を除く全役割とする」 |
| 同 L163-171 | §設計・実装計画の規律。執筆は `design-plan` の役割へ委譲すると書く(L166) |
| `assets/roles/ja/general.md` L4 / L12 / L17 | description・When to invoke・Core Responsibilities に文書作業がある |
| `assets/roles/en/general.md` L4 / L12 / L17 | 同上 |
| `plugins/agent-policy/README.md` | 役割 ID 表「16 種」、モデル ID 表「9 種」、MCP 既定の実装役割 7 種の列挙、移行節は新しい順 |
| `skills/setup-agents/SKILL.md` | L45(`--scope custom` の 9 件)、L100(既定エイリアス)、L163(推奨モデル ID の列挙)、L170-174 / L232 / L291 / L321(vendor 4 値)、L260(MCP 既定の実装役割 7 種) |
| `.claude-plugin/plugin.json` / `package.json` | ともに `0.18.0-dev` |
| `cliproxyapi.config.example.yaml` L10-12 | `antigravity` プロバイダに `gemini-3.8-flash` → alias `claude-gemini-3-8-flash` |

context-map の記載と実コードの食い違いは見つからなかった。ただし context-map §5 が「本文で `general` を名指しする箇所(L115)」とするのは正確ではない。現行の L115 は既に担当表への参照(「その他のタスク」を除く全役割)へ書き換え済みで、役割名の列挙は残っていない。意味は変わらない(§4.6)。

### 3.2 型が追随を強制する箇所と、しない箇所

| 変更 | 型が守る | 型が守らない |
| --- | --- | --- |
| `RoleId` の追加 | `ASSIGNMENTS` / `RECOMMENDED` の `Record<RoleId, …>` | 断片・担当表・README・SKILL.md・テストの件数リテラル |
| `Vendor` の追加 | `COLORS` / `VENDOR_COLORS` の `Record<Vendor, string>` | `--vendor` の値検証、推定失敗の文言、`vendorFor` の switch |
| `ModelId` の追加 | なし(`Record<ModelId, …>` も exhaustive switch も無い) | `MODELS` への行追加。忘れると `modelById` が `undefined` を返す |

## 4. 設計判断

### 4.1 `doc-writing` の挿入位置

**決定: `design-plan` の直後、`explore-lead` の前。**

要件で確定済みだが、副作用を確認しておく。`ROLES` の並びは担当表の行順・`--list-roles` / `--list-coverage` の順・CSV マーカーの並びにそのまま出る。文書を書く 3 役割(`design-plan` / `doc-writing` / `explore-lead`)が隣り合うため、担当表を読むオーケストレーターが 3 者の境界を見つけやすい。`advisor` は末尾に残るため `roles.test.ts` の末尾契約は壊れない。

### 4.2 Agent Tool を「否」にする影響

`SOLO_DENIED_ROLES` に入るため、`doc-writing` **だけ**を持つ定義には Agent Tool が付かない。`doc-writing` と他の役割を兼ねる定義には付く(`allowsAgentTool` は `some` で判定するため)。これは `light-impl` や `code-review` と同じ扱いであり、新しい挙動ではない。

文書の執筆は再委譲を要さず、迷ったときは相談ではなく差し戻しで解く、という方針と整合する。

### 4.3 `general` の書き換え

**決定: description・When to invoke・Core Responsibilities から文書作業を外し、定型メンテナンスと「他の役割に当てはまらない作業」の 2 本立てにする。**

`general` は担当表で唯一「合成しない」役割であり(規律 L115)、受け皿としての性格を持つ。文書作業を外しても受け皿の機能は残る。description に「文書作成を除く」と明示することで、オーケストレーターが `doc-writing` との境界を引ける。

これらの文言を検証するテストは無いため、書き換えで既存テストは落ちない。

### 4.4 `design-plan` / `explore-lead` への 1 行追加

**決定: 両断片の「作業手順」の末尾に 1 行足す。**

ja: 「文書の文体は担当表の「文書作成」の役割の規律に従う。」
en: 「Follow the writing discipline of the "Document Authoring" role for style.」

両役割は文書を自分で書き切る役割であり、`doc-writing` へ渡す想定ではない。したがって「委譲せよ」ではなく「同じ規律に従え」と書く。断片は他プラグインの名前を書かない規約に触れないし、担当表は同じセッションに載っているため参照は解決する。

### 4.5 §設計・実装計画の規律 への追記 —— 不採用

**決定: `references/orchestration-discipline.md` の §設計・実装計画の規律 に `doc-writing` を書き足さない。**

前提として、設計書・実装計画書・context-map の**内容の決定と初稿**は `design-plan` / `explore-lead` が担う。`doc-writing` がこの 3 種に関わるのは、内容が確定した後の**文章化・推敲・翻訳**に限る。この限定を `doc-writing` の断片の When to invoke に明記し(§5.7 / §5.8)、規律 L166(執筆は `design-plan` の役割へ委譲する)は変更しない。これで「設計書を誰が書くのか」の経路は 1 本のままになる。

| 案 | 評価 |
| --- | --- |
| A. 追記しない(採用) | 上の限定により、規律側に書き足すべき分岐が無い。L166 が示す経路は変わらず、`doc-writing` の出番は断片の When to invoke が定義する。`doc-writing` への到達経路は担当表の 1 行で足りる |
| B. 「文体は『文書作成』の規律に従う」を足す | 規律の読者はオーケストレーターであり、実際に文体を守るのは執筆する側である。オーケストレーターへ向けて書いても効かない。同じ 1 行は §4.4 で断片へ入れており、そちらが正しい宛先 |
| C. 委譲できる旨を足す | 委譲の可否は担当表に行があれば導ける。規律に重ねて書くと、0.17 で一本化した「同じ規律を複数の指示書に書かない」原則に反する。加えて L166 と並んだときに二重経路として読める |

運用して `doc-writing` が呼ばれない事実が観測されたら、そのとき追記を検討する(§10-4)。

### 4.6 規律本文で `general` を名指しする箇所

現行 L115 は「担当表のうち『その他のタスク』を除く全役割」と書く。`doc-writing` は `impl` の役割として自動的に合成対象へ入る。`general` の責務が変わっても、この行が指す集合の定義は変わらない。**文言の変更は不要**である。

規律本文で `general` を名指しする箇所は他に L65(「『その他のタスク』の役割へ丸投げしない」)がある。原因分析を丸投げするなという規定であり、文書責務の移動と無関係である。変更しない。

### 4.7 `live-models.ts` の Vendor union の統合

**決定: `live-models.ts` は `fragments.ts` の `Vendor` を import し、`export type LiveVendor = Exclude<Vendor, "none"> | "unknown"` とする。**

| 案 | 評価 |
| --- | --- |
| A. 統合(採用) | ベンダーを足すたびに 2 箇所を直す手間が消える。`none` は「ベンダー断片を付けない」という生成側の指定であり、プロキシの応答には現れないため `Exclude` で落とす。`LiveVendor` から `"unknown"` を除いた集合は `Vendor` の部分集合なので、`resolveVendor`(`setup-agents.ts` L263-270)の `return vendor` はそのまま通る |
| B. `Vendor \| "unknown"` にする | live 経路の型に `none` が混ざる。`vendorFor` は返さないため実害は無いが、応答から推定した値として `none` がありうるという誤った読み方を許す。採らない |
| C. 別型のまま両方へ `gemini` を足す | 変更量は同じだが、次回のベンダー追加でも同じ二重管理が残る。採らない |

**統合が強制するのは戻り値の型だけである。** `Vendor` に `gemini` を足しても `vendorFor` の switch へ case を足すことは型が強制しない。case を忘れると、live 照会が成功したときだけ `unknown` になり `resolveVendor` が throw する。テストで固定する(§7.2)ほか、レビュー項目にも入れる(§8)。

### 4.8 `vendorFor` が受ける `owned_by`

**決定: 実測済みの `antigravity` だけを `gemini` へ写す。**

`antigravity` はプロキシの `/v1/models` の実測値である(ユーザーが `claude-gemini-3-8-flash | antigravity` を確認済み)。`google` を併せて受ける案は不採用とする。実測が無く、根拠のない分岐を増やすためである(§9)。

`vendorFor` は `owned_by` だけを見る。これは**プロバイダ単位の写像**であり、1 つのプロバイダが複数ベンダーのモデルを配る場合に取り違える。`antigravity` プロバイダが Gemini 以外(Claude 相当・gpt-oss 相当など)のモデルも配っていれば、それらも `gemini` と推定される。この危険は `openai` / `xai` / `anthropic` の既存 3 写像にも同じ形で存在しており、今回新しく持ち込むものではない。緩和策は SKILL.md ステップ 4 の推定値の確認である —— 推定したベンダーはユーザーに提示して確認を取り、違えば `--vendor` で上書きできる(§8)。

`gemini` という値は受けない。プロキシがモデル名をそのまま `owned_by` に入れる実装は確認されていない。

### 4.9 `MODELS` への挿入位置

**決定: 末尾(添字 9)へ追加する。**

`policies.test.ts` L139-148 は `MODELS.at(7)` と `MODELS.at(8)?.id` を固定している。末尾追加ならこの 2 つは壊れない。

**位置依存のアサーションを id ベースへ直す案は不採用とする。** 今回の改修と無関係な既存テストの書き換えであり、回帰の面を広げる割に得られるのは可読性だけである。代わりに、新しく足す検査は `MODELS.map((m) => m.id)` の全列挙と `modelById("gemini-flash")` の値比較で書き、位置依存を増やさない。

### 4.10 gemini 用の overlay 断片を作らない

現存する overlay は `realtime-research.grok.md`(ja/en)の 2 件だけで、Grok の検索特性という具体的な差分があった。Gemini に同種の差分は今のところ無い。空の overlay を置くと、断片の stale 判定と翻訳の維持対象が増えるだけである。必要になったときに足す。

### 4.11 `doc-writing` を MCP 既定付与の列挙へ入れる

MCP の付与単位は役割ではなく定義であり、README と SKILL.md の列挙は文書側の既定にすぎない。`doc-writing` は `impl` の役割であり、文書を書くときに Context7 や Serena を使う場面がある。既存の `impl` 役割 7 種(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan` / `explore-lead`)と揃えて列挙へ入れ、8 種にする。

### 4.12 ja 断片で `###` 見出しを使わない

断片の本文は `## ` 見出し単位で行が集められ、合成時に複数役割の同じ見出しの行が連結される(`fragments.ts` L42-57、`compose.ts`)。`### ` は直前の `## ` 節の本文行として扱われるため、他の役割と合成したときに箇条書きの途中へ小見出しが紛れ込む。日本語の言い換えの例は、1 つの箇条書き項目の下にネストした子項目として書く。

### 4.13 `allowsAgentTool` の `model` 引数 —— 削除する

`AGENT_DENIED_MODELS` が空になると、`model` 引数は判定に一切使われなくなる。

| 案 | 評価 |
| --- | --- |
| A. 引数ごと削除する(採用) | 使われない引数は読み手を誤らせる。残すと `allowsAgentTool(["explore"], "haiku")` がモデルで何かが決まるように読め、Agent の可否は役割だけで決まるという D2 の趣旨が壊れる。`allowsAgentTool` はプラグイン内部の関数であり、呼び出しは `compose.ts` の 2 箇所だけである。公開 API ではないため後方互換を保つ意味が無い。削除すればコンパイラが漏れを全部見つける |
| B. 引数を残して無視する | 呼び出し側を触らずに済むが、死んだ引数と `AGENT_DENIED_MODELS` の残骸が残る。次に読む者が「なぜモデルを渡すのか」を調べ直す |
| C. 引数を残し `AGENT_DENIED_MODELS` を空配列のまま置く | B と同じ問題に加え、空配列がいつか埋まる前提に見える。D2 は「役割だけで決める」という決定であり、空配列は決定を表現していない |

**`ComposeInput.modelId` と `Target.composeModelId` の除去はスコープ外とする。** この 2 つは Agent 判定のためだけに存在する配管だが(§3.1)、除去すると `compose.test.ts` の共通ヘルパー(L35 ほか多数の `modelId: "gpt-terra"`)と `setup-agents.ts` の 3 箇所へ波及し、差分が広がる。本改修の目的は `allowsAgentTool` の判定を役割だけにすることであり、それは A で達成される。配管の除去は振る舞いを変えないクリーンアップとして別に行う(§10-6)。`ComposeInput.modelId` にはコメントで「Agent の可否には使わない」と書く。

**この残置は型でも lint でも検出されない。** 読まれないオブジェクトのフィールドは型エラーにならず、biome の未使用検査にも掛からない。コメントだけが手掛かりになるため、§10-6 に残す。

### 4.14 D1 の規律をどこに置くか —— `_common.md` の `## Agent tool の制約` 節

| 案 | 評価 |
| --- | --- |
| A. `_common.md` の `## Agent tool の制約` 節へ 1 項として置く(採用) | 同じ規律を 7 役割 × 2 言語の 14 ファイルへ複製しない。`compose.ts` L84 のとおりこの節は `withAgent` が真のときだけ出力されるため、Agent Tool が「否」の役割(`doc-writing` 自身、`doc-review` / `code-review` / `final-review` / `gate-review` / `advisor`)には出ない。D2 で `light-impl` が「可」になるため、impl 7 種はすべて「可」になり全員に届く。将来 impl 役割が増えても追随が要らない |
| B. 7 つの impl 断片の「作業手順」へ 1 行ずつ置く | 対象が正確になるが 14 ファイルの複製になり、役割が増えるたびに追随が要る。0.17 で一本化した原則に反する |
| C. `## 制約` 節(`withAgent` に関わらず出る)へ置く | Agent Tool を持たない役割にも「再委譲せよ」と出る。実行できない指示を渡すことになる |

**A で Agent Tool が「可」の readonly 役割にも条項が出る。** 単独では `explore` / `realtime-research` / `e2e-verify` / `independent-review` の 4 種である。加えて**混成定義**でも出る。`allowsAgentTool` は `some` で判定するため、Agent 否の役割だけを集めた定義(このリポジトリの `complex-reviewer.md` = `e2e-verify` + `final-review` + `gate-review`)でも、`e2e-verify` が可であるかぎり定義全体が「可」になる。impl と readonly の混成定義でも同じである。

これは過剰包含だが害が無い。条項は「**ファイルとして残す文書**を書くとき」を条件にし、「報告の本文は対象外」と明記する(採用した独立レビューの指摘 1)。readonly 役割は `Write` / `Edit` を持たないため、報告を書くだけでは条件が成立しない。正確さのために 14 ファイルを複製する費用に見合わない。

**§4.4 との衝突の解消。** §4.4 で `design-plan` / `explore-lead` の断片に「文体は『文書作成』の規律に従う」と書くが、条項だけを読むと「文書を書くなら常に再委譲せよ」と読め、初稿まで投げかねない。条項に「『設計書・実装計画書(WBS)の作成』『コードベース探索統括』の役割を担うときは初稿を自分で書き、内容が確定した後の文章化・推敲・翻訳だけを再委譲する」を入れて境界を固定する。これは §4.5 で定めた限定と同じ線である。

**条項には例外を 1 つ書く。** 自分が「文書作成」の役割を持つときは再委譲せず自分で書く。これを書かないと、`doc-writing` と impl 役割を兼ねる合成定義(Agent Tool は「可」になる)が自分自身の役割を他へ投げることになる。

### 4.15 オーケストレーター側の規律 —— 追加しない

`src/hooks/subagent-start.ts` は、**Agent tool を持ちうるサブエージェントへ役割マーカーの対応表を `additionalContext` として注入する**(同ファイル L2 の定義文、L218 / L254)。Agent Tool が「否」の役割には注入されないが、D1 の条項が出るのも Agent Tool が「可」の定義だけである(§4.14)。条項が出る定義には必ず対応表も届く、という対応が取れている。したがってサブエージェントは依頼文を待たずに「文書作成」の定義名を知れる。オーケストレーターに「依頼文へ定義名を含めよ」と課す必要は無い。

対応表が注入されない環境(`AMATSUKA_AGENT_AUTO_INJECTION` が `none` または未設定)では、条項の「対応表にあれば」が成立せず、サブエージェントは自分で書く。D1 が定めた縮退どおりであり、壊れない。

**この節は D についての判断である。** ここで「不要」としているのは、**サブエージェントが再委譲するときに必要な定義名を、オーケストレーターが依頼文で伝える**という規律である。オーケストレーター自身が文書を書かずに委譲するという規律(追加要件 F)は別の論点であり、そちらは §4.16 のとおり共通規律へ足す。2 つを混同しない。

### 4.16 F1 の置き場所 —— §オーケストレーターが自ら担う作業 へ足す

**決定: 新節を作らず、`references/orchestration-discipline.md` の §オーケストレーターが自ら担う作業 の末尾(分析の 3 項目の直後)へ 3 項として足す。**

| 案 | 評価 |
| --- | --- |
| A. §オーケストレーターが自ら担う作業 へ足す(採用) | F1 は L59「担当表の全役割はサブエージェントが担う。オーケストレーターはそのどれも自ら実行しない」の**具体化**であり、同じ節に置くのが素直である。加えてこの節は既に「分析は実働を委譲してよいが結論はオーケストレーターが出す」という**同じ形の分担**を書いている(L61-65)。F1(執筆は委譲、内容の決定は自分)と F5(要件分析の成果は依頼文に書くもので対象外)はその対になる。並べて置くと 2 つが同じ原理の適用例として読める |
| B. 新節「文書作成の規律」を §設計・実装計画の規律 と並べて置く | 見つけやすくはなるが、「誰が設計書を書くのか」を語る場所が §設計・実装計画の規律(L166)と新節の 2 つになる。§4.5 で避けた二重経路が別の形で戻る。節が 1 つ増える分だけ規律も膨らむ |
| C. §モデル別役割の運用 の「オーケストレーターは〜」の並びへ足す | あの並びは dispatch の作法(Agent Tool の可否、依頼文の書き方、並列化)を集めたものであり、「何を自分でやらないか」の規定とは層が違う |

**個別に書く理由。** L59 は全役割を包括しているので、原理上は F1 を書かなくても導ける。それでも書くのは、**文書が「自分で書けそうな作業」として見落とされやすい**ためである。設計書の執筆については既に L166 が個別に釘を刺している。同じ理由が他の文書(引継ぎ書・プロンプト・Skills・Rules)にも当てはまる。

**例示にパスを書くことについて。** `harness-docs/handover/` と `docs/prompts/` はこのリポジトリの規約であり、プラグインは他プロジェクトへも配布される。ただし同梱断片 `assets/roles/ja/design-plan.md` L22 が既に `harness-docs/design/` を書いており、前例がある。条項では「引継ぎ書」「goal コマンドのプロンプト」を主に置き、パスは括弧内の例示にとどめる。

## 5. 各変更の詳細

### 5.1 `src/agents/roles.ts`

`RoleId` の `"design-plan"` の直後へ `| "doc-writing"` を足す。`ROLES` の `design-plan` の要素の直後へ次を挿入する。

```ts
  {
    id: "doc-writing",
    label: "文書作成",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
```

### 5.2 `src/agents/policies.ts`

`ModelId` の末尾へ `| "gemini-flash"` を足す。`MODELS` の末尾(`grok` の後)へ次を足す。

```ts
  {
    id: "gemini-flash",
    vendor: "gemini",
    label: "Gemini Flash",
    defaultName: "gemini-flash",
    model: "claude-gemini-3-8-flash",
    color: "green"
  }
```

`ASSIGNMENTS["claude-model-policy"]` の `"design-plan": ["opus"],` の直後へ `"doc-writing": ["sonnet"],` を足す。
`RECOMMENDED` の同じ位置へ `"doc-writing": ["sonnet", "gemini-flash", "gpt-terra"],` を足す(並びはこの順)。
`SOLO_DENIED_ROLES` から `"light-impl"` を**削除**し、`"doc-writing"` を**配列の末尾**へ足す(D2 / D1)。結果は次のとおり。現行の並びは `ROLES` の順ではないため、並びを揃える意味が無い。順序は `includes` の判定に影響しない。

```ts
const SOLO_DENIED_ROLES: readonly RoleId[] = [
  "advisor",
  "doc-review",
  "code-review",
  "final-review",
  "gate-review",
  "doc-writing"
]
```

`AGENT_DENIED_MODELS`(L170)とそのコメントを削除し、`allowsAgentTool` から `model` 引数を落とす(§4.13)。

```ts
// Agent の可否は役割だけで決まる。モデルによる除外は持たない。
export function allowsAgentTool(ids: RoleId[]): boolean {
  return ids.some((id) => !SOLO_DENIED_ROLES.includes(id))
}
```

### 5.3 `src/agents/fragments.ts`

```ts
export type Vendor = "gpt" | "grok" | "gemini" | "claude" | "none"
```

overlay の探索(`endsWith(".${vendor}.md")`)は値を列挙しないため、追加の変更は要らない。

### 5.4 `src/agents/compose.ts`

```ts
const COLORS: Record<Vendor, string> = {
  gpt: "yellow",
  grok: "red",
  gemini: "green",
  claude: "blue",
  none: "blue"
}
```

あわせて `allowsAgentTool` の呼び出し 2 箇所(L44 の `withAgent`、L127 の `describeRoles`)から第 2 引数を落とす(§4.13)。`ComposeInput.modelId`(L15)はフィールドとして残し、「Agent の可否には使わない」とコメントを付ける。

### 5.5 `src/agents/live-models.ts`

```ts
import type { Vendor } from "./fragments"

// プロキシ応答から推定したベンダー。"none" は生成側の指定でありプロキシ応答には現れないため除く。
export type LiveVendor = Exclude<Vendor, "none"> | "unknown"

export interface LiveModels {
  ok: boolean
  baseUrl?: string
  ids: string[]
  vendors: Record<string, LiveVendor>
  reason?: string
}
```

ローカルの `type Vendor = LiveModels["vendors"][string]`(L9)は削除し、`vendorFor` の戻り値型を `LiveVendor` にする。switch へ次を足す(`case` の追加は型が強制しないため、足し忘れに注意する。§4.7)。

```ts
    case "antigravity":
      return "gemini"
```

### 5.6 `src/setup-agents.ts`

- `VENDOR_COLORS` へ `gemini: "green"` を足す(`COLORS` と同じ並び)。
- `--vendor` の検証(L942-949)を 5 値にする。エラー文言は `"vendor: must be gpt, grok, gemini, claude or none"`。
- 推定失敗の文言(L267)を `pass --vendor gpt|grok|gemini|claude|none` にする。

### 5.7 役割断片 `assets/roles/ja/doc-writing.md`(新規)

```markdown
---
id: doc-writing
label: 文書作成
description: AI が読む文書・コードコメント・その他の文書を、依頼された範囲で執筆する
default-name: writer
tools: Read, Grep, Glob, Write, Edit, Bash, Skill
kind: impl
---

## When to invoke

- **AI が読む文書の執筆。** 引継ぎ書・Skills・Agents 定義・Rules・References・CLAUDE.md・Output Styles・フックが注入する文・プロンプトを書く、または書き直すとき。
- **確定した内容の文章化。** 設計書・実装計画書・context-map については、内容が確定した後の文章化・推敲・翻訳だけを担う。内容の決定と初稿は「設計書・実装計画書(WBS)の作成」「コードベース探索統括」の役割が担う。
- **コードコメントの執筆。** コードに残すコメントを書く、または書き直すとき。
- **その他の文書の執筆。** 上記以外の文書を書くとき。

## Core Responsibilities

- 依頼された文書を、読み手に伝わる文章として執筆する。内容の決定は依頼元が持ち、こちらは執筆と文体を担う。

## 作業手順

- 英語以外の言語で書くときは、英語からの直訳ではなく意訳にする。
- 使用する言語の正しい文脈と文法に従う。訳語がその文脈に合うかを語ごとに確かめる。
- 極力簡潔でわかりやすい文章にする。
- 難しい言い回しと回りくどい言い回しを避ける。
- 引用と出典は必要な分だけに絞る。冗長な表現と、読み手を混乱させる背景や根拠を書かない。
- 日本語では次のように言い換える。
  - Version を単に「版」としない。「確定版」「新しいバージョン」のように文脈で使い分ける。
  - テスト結果の Green / Red を「緑」「赤」としない。「パス」「失敗」と書く。
  - Frozen Document を「凍結文書」としない。「確定版の文書」と書く。
  - Ledger を単に「台帳」としない。網羅的に集めたものは「一覧」、状態の更新を伴うものは「管理表」、時系列の記録は「ログ」と書く。
- 同じ種類の文書が既にあるときは、その章立て・用語・文体に倣う。

## 制約

- **文書作成として依頼されたときは**、依頼された文書ファイルだけを作る。他のファイルに手を付けない。
- 設計内容・要件・仕様を自分で決めない。決まっていない事項は書かず、依頼元へ差し戻す。
- 確認できない事実を書かない。確認できない箇所は依頼元へ問い合わせる。
- 文書の執筆を他の役割へ再委譲しない。この役割が執筆を担う。

## Output Format

- 書いた文書のパスを冒頭に一文で
- 文書の構成(節の一覧)と各節の要旨
- 依頼元の判断が要る事項の一覧
```

### 5.8 役割断片 `assets/roles/en/doc-writing.md`(新規)

```markdown
---
id: doc-writing
label: Document Authoring
description: write documents that AI reads, code comments, and other requested documents
default-name: writer
tools: Read, Grep, Glob, Write, Edit, Bash, Skill
kind: impl
---

## When to invoke

- **Authoring documents that AI reads.** Use to write or rewrite handover notes, skills, agent definitions, rules, references, CLAUDE.md, output styles, text injected by hooks, and prompts.
- **Writing up decided content.** For design documents, implementation plans, and context-maps, handle only the writing, revision, and translation that follows once the content is decided. The "Design and Implementation Plan Authoring" and "Codebase Exploration Lead" roles decide the content and produce the first draft.
- **Authoring code comments.** Use to write or rewrite comments left in code.
- **Authoring other documents.** Use for any other document that needs to be written.

## Core Responsibilities

- Write the requested document so that its readers understand it. The requester decides the content; this role handles the writing and the style.

## Procedure

- When writing in a language other than English, convey the meaning rather than translating word for word.
- Follow the grammar and idiom of the language you write in. Check each term against the conventional usage of that language instead of transliterating it.
- Keep the text as short and as plain as it can be.
- Avoid difficult phrasing and roundabout phrasing.
- Keep quotations and citations to what is needed. Do not add verbose expressions, or background and rationale that would confuse the reader.
- Where a document of the same kind already exists, follow its section structure, terminology, and style.

## Constraints

- **When invoked for document authoring**, produce only the requested document files. Do not touch other files.
- Do not decide design content, requirements, or specifications yourself. Leave undecided matters unwritten and send them back to the requester.
- Do not write facts you cannot verify. Ask the requester about anything you cannot confirm.
- Do not re-delegate the writing to another role. This role does the writing.

## Output Format

- Open with one sentence stating the path of the document written.
- Summarize the document structure (the list of sections) and each section.
- List matters that need the requester's decision.
```

### 5.9 `assets/roles/ja/general.md`

| 行 | 変更前 | 変更後 |
| --- | --- | --- |
| L4 | `description: ドキュメント作成、定型メンテナンスなど、レビュー・設計を除く一般作業` | `description: 定型メンテナンスなど、レビュー・設計・文書作成を除く一般作業` |
| L12 | `- **ドキュメント作業。** README・手順書の作成や更新、既存ドキュメントの整合性チェックが必要なとき。` | `- **他の役割に当てはまらない作業。** レビュー・設計・文書作成のいずれでもなく、専門性を要さない作業が必要なとき。` |
| L13 | (変更なし) | `- **定型メンテナンス。** 単発では終わらないが専門性を要さない、リポジトリ内の一般作業が必要なとき。` |
| L17 | `- ドキュメント作成・定型メンテナンスを、既存のリポジトリ規約(ファイル配置・命名・文体)に合わせて遂行する。` | `- 定型メンテナンスを、既存のリポジトリ規約(ファイル配置・命名)に合わせて遂行する。` |

L12 と L13 は順序を入れ替えず、L12 を差し替えるだけとする(L13 の定型メンテナンスが先に来る並びにはしない)。他の行は変更しない。

### 5.10 `assets/roles/en/general.md`

| 行 | 変更後 |
| --- | --- |
| L4 | `description: general work excluding review, design, and document authoring, such as routine maintenance` |
| L12 | `- **Work that fits no other role.** Use for work that is neither review, design, nor document authoring and needs no specialized expertise.` |
| L17 | `- Perform routine maintenance according to existing repository conventions for file placement and naming.` |

L13 は変更しない。

### 5.11 `assets/roles/{ja,en}/design-plan.md` と `explore-lead.md`

「作業手順」(en は `## Procedure`)の末尾へ 1 行足す。

- ja: `- 文書の文体は、担当表の「文書作成」の役割の規律に従う。`
- en: `- Follow the writing discipline of the "Document Authoring" role for style.`

4 ファイルとも他の行は変更しない。

### 5.11b `assets/roles/ja/_common.md` の `## Agent tool の制約`(D3 / D4)

変更前(L18-20):

```markdown
## Agent tool の制約

- `Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。
```

変更後:

```markdown
## Agent tool の制約

- `Agent` tool を使うのは、アドバイザーへの相談と、文書作成の役割への再委譲の 2 つだけである。それ以外の作業委譲(再オーケストレーション)には使わない。自身が起動したサブエージェントに `Agent` tool を許可しない。
- **ファイルとして残す文書**を書くときは、対応表に「文書作成」の定義があればその定義へ再委譲する。無ければ自分で書く(差し戻さない)。報告の本文は対象外であり、自分で書く。
- 自分が「文書作成」の役割を持つときは再委譲せず自分で書く。
- 「設計書・実装計画書(WBS)の作成」「コードベース探索統括」の役割を担うときは、初稿を自分で書く。再委譲してよいのは、内容が確定した後の文章化・推敲・翻訳だけである。
- 対象になるのは、AI が読む文書(Skills・Agents 定義・Rules・References・CLAUDE.md・Output Styles・フックが注入する文・プロンプト)、引継ぎ書と goal コマンドのプロンプト、内容が確定した後の設計書・実装計画書・context-map の文章化、コードコメント、その他ファイルとして残す文書である。
- 再委譲の依頼文には次を書く。
  - あなたはサブエージェントである
  - 役割は「文書作成」である
  - 内容は確定済みであり、文章化と推敲だけを担う
  - 対象ファイルのパス
  - `Agent` tool を使わないこと
```

### 5.11c `assets/roles/en/_common.md` の `## Agent tool limits`

```markdown
## Agent tool limits

- Use the `Agent` tool for two things only: consulting an advisor, and re-delegating to the document authoring role. Do not use it for any other delegation of work (re-orchestration). Do not grant the `Agent` tool to any subagent you start.
- When you need to write a **document that is saved as a file**, re-delegate to the "Document Authoring" definition if the role marker table has one. If it does not, write the document yourself — do not hand the task back. The body of a report is out of scope; write it yourself.
- If you hold the "Document Authoring" role yourself, write it yourself instead of re-delegating.
- When you act as "Design and Implementation Plan Authoring" or "Codebase Exploration Lead", write the first draft yourself. Re-delegate only the writing, revision, and translation that follows once the content is decided.
- This covers documents that AI reads (skills, agent definitions, rules, references, CLAUDE.md, output styles, text injected by hooks, prompts), handover notes and goal-command prompts, writing up design documents, implementation plans, and context-maps once their content is decided, code comments, and other documents saved as files.
- State the following in the re-delegation request.
  - that the delegate is a subagent
  - that the role is "Document Authoring"
  - that the content is already decided and only the writing and revision are delegated
  - the paths of the target files
  - that the delegate must not use the `Agent` tool
```

**日本語ラベルは併記しない(実装中の検出を受けた訂正。2026-09-16)。** 役割マーカーの対応表は役割名を日本語で載せるため(`marker-scan.ts` が `ROLES[].label` を使う)、当初は英語断片へ `文書作成 (Document Authoring)` と併記して照合を助ける案を採っていた。しかし `compose.test.ts:616`「英語で合成した定義に日本語と日本語約物が混入しない」がこれを弾く。**この検査は英語出力の品質契約であり、維持する。** 併記は撤回し、en 断片には `"Document Authoring"` だけを書く。対応表の照合の問題は既存の欠陥として残し、スコープ外とする(§10-9)。

この節は `compose.ts` L84 のとおり `withAgent` が真のときだけ出力される。Agent Tool が「否」の役割には出ない(§4.14)。

### 5.12 `references/orchestration-discipline.md`

1. 担当表の `design-plan` の行の直後へ 1 行を挿入する。列の幅は既存の桁揃えに合わせる。

```markdown
| 文書作成                         | `doc-writing`        | `impl`     | 否         | `Sonnet`      |
```

2. 担当表の `light-impl` の行の「Agent Tool」列を `否` → `可` にする(D2)。

3. §モデル別役割の運用 の「サブエージェントは〜」で始まる条項の並びへ 1 項を足す(D5)。位置は「サブエージェントは、アドバイザーとして相談する相手を…」の直前とし、再委譲に関する条項がまとまる並びにする。

```markdown
- サブエージェントは、ファイルとして残す文書を書くとき、役割マーカーの対応表に「文書作成」の定義があればその定義へ再委譲する。無ければ自分で書き、差し戻さない。報告の本文は対象外である。自分が「文書作成」の役割を持つときは再委譲せず自分で書く。「設計書・実装計画書(WBS)の作成」「コードベース探索統括」の役割を担うときは初稿を自分で書き、内容が確定した後の文章化・推敲・翻訳だけを再委譲する。再委譲の依頼文には「あなたはサブエージェントである」「役割は『文書作成』である」「内容は確定済みであり、文章化と推敲だけを担う」「対象ファイルのパス」「`Agent` tool を使わないこと」を書く。
```

4. §オーケストレーターが自ら担う作業 の末尾(分析の 3 項目の直後)へ、追加要件 F の 3 項を足す(§4.16)。

```markdown
- オーケストレーターは、ファイルとして残す文書を自ら書かず、担当表の「文書作成」の役割へ委譲する。対象は、AI が読む文書(Skills・Agents 定義・Rules・References・CLAUDE.md・Output Styles・フックが注入する文・プロンプト)、引継ぎ書と goal コマンドのプロンプト(`harness-docs/handover/`・`docs/prompts/` など)、内容が確定した後の設計書・実装計画書・context-map の文章化、コードコメント、その他ファイルとして残す文書である。委譲先の解決は §委譲先の解決 に従う。
- 依頼文には、確定した内容・対象ファイルのパス・参照すべき既存文書を渡す。内容の決定はオーケストレーターが持ち、委譲するのは執筆と文体だけである。
- 要件分析と報告の突き合わせの成果(要件と受け入れ基準の箇条書き、判断のメモ)は依頼文の中に書くものであり、ファイルとして残す文書ではない。この規律の対象外である。
```

この 3 項は L59「担当表の全役割はサブエージェントが担う。オーケストレーターはそのどれも自ら実行しない」の具体化である。**L166(設計書・実装計画書の執筆は「設計書・実装計画書(WBS)の作成」の役割へ委譲する)とは衝突しない。** 設計書と実装計画書の執筆は引き続き `design-plan` の役割が担い、F1 が「文書作成」へ回すのは内容が確定した後の文章化だけである。§4.5 で引いた線と同じである。

**3 の条項(D1)**はオーケストレーターが依頼文へ転記する(規律 L81)。生成済みの定義へは `_common.md`(§5.11b / §5.11c)経由で届く。**4 の 3 項(F1)**は読者がオーケストレーター自身であり、転記も生成物への埋め込みも要らない。2 つの経路があるのは、規律を読むのがオーケストレーター、`_common.md` を読むのがサブエージェント本人であり、読者集合が交わらないためである(0.17 の「同じ規律を複数の指示書に書かない」原則の射程外)。

**整合の確認。** L75「担当表の『Agent Tool』列が『可』の役割のサブエージェントにだけ Agent Tool を許可する」は表を参照しているため、`light-impl` を「可」にすれば自動的に追随する。L72(既存パターンの機械的な反復は「軽量な実装」とする)は Agent Tool と無関係であり変更しない。§4.6 のとおり L115 も変更しない。

### 5.13 `plugins/agent-policy/README.md`

1. 「MCP の付与単位は役割ではなく定義です」の段落の実装役割の列挙へ `doc-writing` を足す。並びは `design-plan` の後、`explore-lead` の前。
2. 「組み込みの役割 ID は次の 16 種です。」→ `17 種`。表の `design-plan` の行の直後へ `| `doc-writing` | 文書作成 |` を挿入する。
3. 「setup-agents が扱う推奨モデル ID は次の 9 種です。」→ `10 種`。表の末尾へ `| `gemini-flash` | Gemini Flash | `claude-gemini-3-8-flash` |` を足す。
4. 移行節の先頭(「0.17 系から 0.18 系へ」の直前)へ次を足す。

```markdown
0.18 系から 0.19 系へ移行する場合は、次を確認してください。

1. 役割 ID に `doc-writing`(文書作成)を追加しました。AI が読む文書 —— 引継ぎ書・Skills・Agents 定義・Rules・CLAUDE.md・フックが注入する文 —— とコードコメントの執筆を担う役割です。断片には、直訳を避ける・その言語の文法と慣用に従う・簡潔に書く・過剰な引用と冗長な表現を避ける、という執筆規律が入っています。設計書・実装計画書・context-map については、内容が確定した後の文章化・推敲・翻訳だけを担います。内容の決定と初稿は従来どおり `design-plan` と `explore-lead` の役割が担います。
2. `general`(その他のタスク)から文書の責務を外しました。定型メンテナンスと、他の役割に当てはまらない作業が担当範囲になります。生成済みの定義の本文は自動では変わりません。文言を追随させるには `agent-policy:setup-agents` を再実行してください。
3. `doc-writing` の Agent Tool は「否」です。この役割だけを持つ定義には Agent Tool が付きません。
4. custom プロファイルで、生成済みの定義に `doc-writing` のマーカーが無い場合は、担当表の「Claude モデル」列(`Sonnet`)へ読み替えられます。委譲先を定義で固定したい場合は `agent-policy:setup-agents` を再実行してください。
5. 推奨モデル ID に `gemini-flash`(`claude-gemini-3-8-flash`)を、ベンダーに `gemini` を追加しました。`--vendor` は `gpt` / `grok` / `gemini` / `claude` / `none` の 5 値になります。`gemini` の色は green です。
6. **impl 役割のサブエージェントは、ファイルとして残す文書を書くときに「文書作成」の定義があればそこへ再委譲するようになりました。** 対応表に無ければ自分で書きます。報告の本文は対象外です。生成する定義の共通部分(`_common.md`)で、`Agent` tool の用途を「アドバイザーへの相談」と「文書作成への再委譲」の 2 つに広げています。**`doc-writing` は単独の定義として作ることを勧めます。** 実装役割と兼ねた定義は Agent Tool が「可」になり、名指しで起動したときに再委譲を frontmatter の段階では止められません。
7. **`light-impl`(軽量な実装)の Agent Tool を「可」にしました。** あわせてモデルによる Agent Tool の除外を廃止したため、**Haiku を指定した定義でも、Agent Tool が「可」の役割を持つものには Agent tool が付きます**(従来はモデルが Haiku というだけで外れていました)。Agent の可否は役割だけで決まります。既存の生成済み定義は自動では変わりません。`agent-policy:setup-agents` を再実行してください。
8. **オーケストレーターも、ファイルとして残す文書を自ら書かず「文書作成」の役割へ委譲するようになりました。** 対象は AI が読む文書・引継ぎ書・goal コマンドのプロンプト・内容が確定した後の設計書や実装計画書の文章化・コードコメントです。要件や判断の箇条書きを依頼文の中に書くことは対象外です。
9. プロキシの `/v1/models` が返す `owned_by` が `antigravity` のモデルを `gemini` と判定します。`antigravity` のプロバイダで Gemini 以外のモデルも配っている場合、それらも `gemini` と推定されます。ウィザードは推定値を提示して確認を取るため、違うときはその場で選び直すか `--vendor` で上書きしてください。プロキシ側で Gemini のエイリアスを設定していない場合、この追加による影響はありません。
```

### 5.14 `skills/setup-agents/SKILL.md`

| 箇所 | 変更 |
| --- | --- |
| L45 | `--scope custom` の推奨モデル ID を 10 件にする。列挙の末尾へ `gemini-flash` を足す |
| L100 | 既定エイリアスの列挙へ `gemini-flash` = `claude-gemini-3-8-flash` を足す |
| L163 | 一括生成で渡す推奨モデル ID の列挙へ `gemini-flash` を足す |
| L170 / L171 / L172 | vendor の選択肢を `gpt` / `grok` / `gemini` / `claude`(および `none`)へ広げる |
| L174 / L232 / L291 / L321 | `--vendor <gpt\|grok\|claude\|none>` を `--vendor <gpt\|grok\|gemini\|claude\|none>` にする |
| L260 | MCP 既定付与の実装役割の列挙へ `doc-writing` を足す(`design-plan` の後、`explore-lead` の前) |

frontmatter の `description` は変更しない(役割数もベンダー名も書いていない)。

### 5.15 ルート `README.md`

- **L112**「全16種の役割を定義し」→「全17種の役割を定義し」。
- **L114** の「(推奨モデルとして GPT と Grok をサポート)」→「(推奨モデルとして GPT・Grok・Gemini をサポート)」。

他の行と `.claude-plugin/marketplace.json` は変更しない。

### 5.16 バージョン

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` をともに `0.19.0-dev` にする。

### 5.17 `.serena/memories/agent_policy/core.md`

役割数(16 → 17)と役割 ID の列挙、`RECOMMENDED` の値、`ModelId` / `Vendor` の集合、バージョンを追随させる。あわせて Agent Tool の規定の変更(`light-impl` が「可」、モデルによる除外の廃止)と、共通規律に加わった 2 種の条項(D1 のサブエージェント向け再委譲、F1 のオーケストレーター向け執筆委譲)を書く。保護パスであり、Serena の `edit_memory` / `write_memory` でのみ変更する。

### 5.18 このリポジトリの `.claude/agents/`

`doc-writing` を持つ定義が無いため、追加しないと役割が未被覆になる。setup-agents で 2 つ作る。

| 定義名(案) | model | vendor | roles |
| --- | --- | --- | --- |
| `doc-writer` | `sonnet` | `claude` | `doc-writing` |
| `gemini-doc-writer` | `claude-gemini-3-8-flash` | `gemini` | `doc-writing` |

`RECOMMENDED` には `gpt-terra` も入るため、ウィザードは 3 つ目の候補として提示する。作るかは利用者が決める(§10-7)。

**実施結果(2026-09-16)。** 上表は案であり、実際に作ったのは **`document-writer` の 1 件だけ**である。初版は `gemini-flash`(`claude-gemini-3-8-flash`)で作ったが、同日 `gpt-terra`(`claude-gpt-5-6-terra`、codex 経路)へ差し替えた。antigravity 経由の Gemini はサブエージェントとして起動できないためである(§10-5)。`sonnet` の定義は作っていない。

`doc-writing` は**単独の役割を持つ定義**として作る。実装役割と兼ねると Agent Tool が「可」になり、名指しで起動したときに再委譲を frontmatter で止められない(§8)。

あわせて `general-worker.md` と `general-implementer.md` を再生成し、焼き込まれた「ドキュメント作成」の文言を追随させる。**再生成が 13 定義すべてに及ぶ主な理由は `_common.md` の Agent tool の節の改訂であり、次いで `general` の文言である。** Agent tool の付与が実際に変わるのは `light-impl` を持つ `general-implementer.md` だけである。**「Haiku の定義に Agent が付く」はこのリポジトリでは起こらない。** 唯一の Haiku 定義 `knowledge-elicitationer.md` は `doc-review` のみを持ち、役割として Agent 否のままである。

**再生成の前に、既存 13 定義の `disallowedTools` と MCP の付与を一覧化する。** 7 定義が `disallowedTools` を持つ(`complex-reviewer` / `general-explore` / `docs-reviewer` / `code-reviewer` / `realtime-researcher` / `technical-adviser` / `independent-tech-adviser`)。ウィザードで同じ `--mcp-deny` を指定して復元し、`independent-tech-adviser.md` のプレフィックス無しの別名(`write_memory` 等)は CLI が生成しないため手で戻す。再生成後に 7 定義の `disallowedTools` が残っていることを確認する。

定義名はウィザードで利用者が決めるため、上表は案である。

## 6. 影響ファイル

### 6.1 実装

| ファイル | 変更 |
| --- | --- |
| `src/agents/roles.ts` | `RoleId` と `ROLES` へ `doc-writing` |
| `src/agents/policies.ts` | `ModelId` / `MODELS` / `ASSIGNMENTS` / `RECOMMENDED` / `SOLO_DENIED_ROLES` / `AGENT_DENIED_MODELS` の削除 / `allowsAgentTool` のシグネチャ |
| `src/agents/fragments.ts` | `Vendor` へ `gemini` |
| `src/agents/compose.ts` | `COLORS` へ `gemini`。`allowsAgentTool` の呼び出し 2 箇所から第 2 引数を落とす |
| `src/agents/live-models.ts` | `LiveVendor` の新設と `Vendor` の import、`vendorFor` の 2 case |
| `src/setup-agents.ts` | `VENDOR_COLORS`、`--vendor` の検証、推定失敗の文言 |

### 6.2 断片・規律・文書

| ファイル | 変更 |
| --- | --- |
| `assets/roles/ja/doc-writing.md` | 新規 |
| `assets/roles/en/doc-writing.md` | 新規 |
| `assets/roles/ja/general.md` / `en/general.md` | 文書責務の削除 |
| `assets/roles/{ja,en}/design-plan.md` | 文体の 1 行 |
| `assets/roles/{ja,en}/explore-lead.md` | 文体の 1 行 |
| `assets/roles/ja/_common.md` / `en/_common.md` | `## Agent tool の制約` / `## Agent tool limits` 節の改訂(§5.11b / §5.11c) |
| `references/orchestration-discipline.md` | 担当表に 1 行、`light-impl` の Agent Tool 列、「サブエージェントは〜」の条項 1 つ(D1)、§オーケストレーターが自ら担う作業 へ 3 項(F1) |
| `README.md`(プラグイン) | 役割表・モデル表・MCP 既定・移行節 |
| `skills/setup-agents/SKILL.md` | §5.14 の 6 箇所 |
| ルート `README.md` | L111 / L112 |
| `.claude-plugin/plugin.json` / `package.json` | `0.19.0-dev` |
| `scripts/*.mjs` | `pnpm run build` の再生成物 |
| `.serena/memories/agent_policy/core.md` | Serena 経由 |

### 6.3 変更しないもの

- `src/hooks/*`。`session-start.ts` と `subagent-start.ts` は `Vendor` を使わず、外部判定は `runsOnClaude(model)` で行う。
- `src/hooks/marker-scan.ts` の `CLAUDE_VENDORS = {"claude","none"}`。`gemini` を claude 構成から除外するのは正しい挙動である。
- `assets/context-map-template.md`、`references/context-map-guide.md`。
- `src/agents/vocabulary.ts`。`agentConstraintHeading` の見出し文字列は変えないため、`_common.md` の節名も変えない。
- `cliproxyapi.config.example.yaml`、`docs/development/cliproxyapi-setup.md`(§10-1)。
- 他プラグイン。`Vendor` / `ModelId` を import していない。

## 7. テスト方針

### 7.1 役割数 16 を固定している検査(必ず直す)

| ファイル:行 | 変更 |
| --- | --- |
| `src/agents/__test__/roles.test.ts:11` | テスト名「16 件」→「17 件」 |
| 同 `:12-29` | ID 配列へ `"doc-writing"` を `"design-plan"` の直後へ |
| 同 `:30` | `size).toBe(16)` → `17` |
| 同 `:33-` | 既存の「追加した 2 役割の label・kind・tools」に倣い、`doc-writing` の label `文書作成` / kind `impl` / tools 7 件を固定する検査を足す |
| `src/agents/__test__/fragments.test.ts:57` | `fragments.size).toBe(16)` → `17` |
| 同 `:61-69` | `defaultName` の固定へ `doc-writing` → `writer` を足す |
| `src/agents/__test__/policies.test.ts:19-36` | `EXPECTED_CLAUDE_ASSIGNMENTS` へ `"doc-writing": ["sonnet"]` |
| 同 `:38-55` | `EXPECTED_RECOMMENDED` へ `"doc-writing": ["sonnet", "gemini-flash", "gpt-terra"]` |
| 同 `:57-74` | `EXPECTED_AGENT_TOOL` へ `"doc-writing": false`。**`"light-impl"` を `false` → `true` へ**(D2) |
| 同 `:100` / `:112` / `:207` | テスト名の「16 役割」→「17 役割」 |
| 同 `:180-189` | `rolesFor("sonnet")` を 8 件へ。並びは `normal-impl, general, doc-writing, explore, realtime-research, e2e-verify, independent-review, code-review` |
| `src/__test__/setup-agents.test.ts:543` | `--list-coverage` の `toHaveLength(16)` → `17` |
| 同 `:610` | 同上 |
| 同 `:737-754` | `--list-roles` の ID 配列へ `doc-writing` を挿入 |

`rolesFor("fable")` は変わらない。`discipline-role-table.test.ts:154` の行数検査は `ROLES.length` を使うため、担当表に 1 行足せば自動で通る。

### 7.2 ModelId / Vendor の追加に伴う検査

| ファイル:行 | 変更 |
| --- | --- |
| `src/agents/__test__/policies.test.ts:119-120` | `MODELS).toHaveLength(9)` → `10` |
| 同 `:139-148` | `MODELS.at(7)` / `at(8)` は**変更しない**(末尾追加のため無傷)。新たに `MODELS.map((m) => m.id)` の全 10 件の順序検査と、`modelById("gemini-flash")` の値検査を足す |
| 同 `color` の検査 | `green` は既に許可リストにあるため変更不要 |
| `src/agents/__test__/compose.test.ts:85-112` | ベンダー別の色の検査へ `gemini` → `green` を足す。vendor marker の `for` ループの配列へ `"gemini"` を足す |
| `src/agents/__test__/discipline-role-table.test.ts:17-27` | `MODEL_IDS` へ `"Gemini Flash": "gemini-flash"` を足す |
| `src/agents/__test__/live-models.test.ts:47-68` | 正常応答の検査へ `{ id: "claude-gemini-3-8-flash", owned_by: "antigravity" }` を足し、`vendors` の期待値へ `gemini` を入れる。`owned_by: "google"` は `unknown` のままである(§4.8)。未知の `owned_by` が `unknown` になる検査が既にあればそれで足りる |
| `src/__test__/setup-agents.test.ts:129` | `LiveModelsResult` の `vendor` union へ `"gemini"` |
| 同 `:1778-1783` | `--vendor` の `it.each` へ `["gemini", "green", "gemini"]` を足す |
| 同 `:1915` | 推定失敗の文言を `pass --vendor gpt\|grok\|gemini\|claude\|none` へ |

`--vendor` の不正値で throw する検査があれば、`gemini` が通ることを確認する(現行の `it.each` が実質その役割を果たす)。

### 7.2b Agent Tool の規定の変更に伴う検査(D7)

| ファイル:行 | 変更 |
| --- | --- |
| `src/agents/__test__/policies.test.ts:206-215` | `allowsAgentTool([role.id], model)` の第 2 引数を落とし、ループを `ROLES` だけで回す形にする |
| 同 `:217-225` | `allowsAgentTool(["light-impl"], "grok")` を `true` へ。第 2 引数を全行から落とす。`["light-impl", "complex-impl"]` は `true` のまま |
| 同 `:232-235` | **it「モデル側の除外を適用する」を削除する。** `AGENT_DENIED_MODELS` が無くなり検査対象が消滅する |
| 同 `:237-241` | it「GPT Luna はモデル側の除外を受けず役割の規定だけに従う」を削除するか、モデル引数を落として役割だけの検査へ縮約する。`["light-impl"]` は `true` になる |
| 同 `:243-246` | 引数 1 つの呼び出し。`["light-impl"]` を `true` へ |
| `src/agents/__test__/compose.test.ts:140-155` | it「Agent の付与が役割とモデルで決まる」→ 役割だけで決まる形へ。`light-impl` を `toContain("Agent")` へ、`explore` + `modelId: "haiku"` を `toContain("Agent")` へ。テスト名も直す |
| 同 `:157-167` | it「model ID が無いときは役割だけで Agent の有無を決める」の `light-impl` を `toContain("Agent")` へ |
| 同 `:169-173` | **it「model ID があるときは Haiku の Agent 除外を維持する」を削除する** |
| 同 `:237-239` | it「Agent が付かないとき「アドバイザーへの相談」節を出さない」が `light-impl` を使っている。`light-impl` が「可」になるため**Agent 否の役割へ差し替える**(`code-review` を使う) |
| 同 `:241` / `:247` / `:253-257` | `_common.md` の文言を検査する 3 箇所。`` `Agent` tool はアドバイザー相談専用 `` は改訂後の本文に存在しないため、新しい文言(例: `` `Agent` tool を使うのは `` )へ差し替える。`:253-257` の重複検査(1 回だけ出ること)の正規表現も同じ語で作り直す |
| `src/__test__/setup-agents.test.ts:966-986` | it「Agent tool の可否を役割から返す」が `light-impl` に `agentTool: false` を期待している。**Agent 否の役割へ差し替える**(`code-review` 等) |
| 同 `:988-1015` | it「Agent tool の可否へ model-id を反映する」→ 役割だけで決まる形へ。`agentToolFor("grok", "light-impl")` を `true` へ。テスト名も直す |
| 同 `:1016-` | it「自由モデル値ではモデル制約を外して役割制約だけを使う」は、モデル制約そのものが無くなるため名前が実体と合わなくなる。結果は変わらないので、名前を直すか削除するかを実装時に判断する |
| `src/agents/__test__/discipline-role-table.test.ts:181-184` | 担当表の Agent Tool 列と `allowsAgentTool` の突き合わせ。**担当表の `light-impl` を「可」にすれば自動で通る**(§5.12-2) |

`_common.md` の本文を検査しているのは `compose.test.ts` の 3 箇所だけである。`fragments.test.ts` は `_common.md` の本文を見ない。

### 7.3 自動で追随する検査

- `compose.test.ts:318-367` —— ja/en 断片のファイル名・id・label・tools・kind が `ROLES` と一致し、en の `default-name` / tools / kind が ja と一致することを検査する。`doc-writing.md` を ja/en 両方に作れば通る。片方だけだと落ちる。
- `compose.test.ts:594-608` —— 全役割が en で合成できること。
- `discipline-role-table.test.ts` —— 担当表の行と `ROLES` / `allowsAgentTool` / `ASSIGNMENTS` の突き合わせ。表に 1 行足せば通る。

### 7.4 検証コマンド

`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build`。テストの実行環境は node、プロセス分離は forks、タイムアウト 20 秒(プロジェクトのテスト方針)。

## 8. リスクと受容

| リスク | 対処 |
| --- | --- |
| `MODELS` へ行を足し忘れても型エラーが出ず、`modelById("gemini-flash")` が `undefined` になる | §7.2 の全 10 件の順序検査と値検査で捕まえる |
| `Vendor` に `gemini` を足しても `vendorFor` の case 追加は型が強制しない。足し忘れると live 照会成功時だけ `unknown` になり `resolveVendor` が throw する | §7.2 の `live-models.test.ts` の検査で固定する。レビュー(計画書 T14)の項目に「`vendorFor` に `antigravity` の case があること」を入れる |
| `vendorFor` の `owned_by` が実際には `antigravity` でなく、live 照会成功時に `unknown` で throw する | ユーザーが `/v1/models` で `claude-gemini-3-8-flash \| antigravity` を確認済み。外れた場合の症状(非対話モードが `ok: false` で止まる)と、`--vendor gemini` を明示すれば回避できることを移行節に書く |
| `antigravity` プロバイダが Gemini 以外のモデル(Claude 相当・gpt-oss 相当など)も配っていると、それらも `gemini` と推定される | `vendorFor` は `owned_by` だけを見るプロバイダ単位の写像であり、既存の `openai` / `xai` / `anthropic` にも同じ性質がある。緩和策は SKILL.md ステップ 4 の推定値の確認である。推定したベンダーはユーザーへ提示して確認を取り、違えば `--vendor` で上書きできる。移行節にも書く(§5.13-6) |
| ja 断片だけ作って en を忘れ、`compose.test.ts` が落ちる | 同じタスクで ja/en を対にして作る。計画の完了条件に両ファイルの存在を入れる |
| 生成済みの `general-worker.md` / `general-implementer.md` の本文に「ドキュメント作成」が残り、`doc-writing` と担当が重なって見える | 移行節へ「setup-agents の再実行で追随する」と書き、このリポジトリでは計画の最終ステップで再生成する |
| `doc-writing` と `design-plan` の境界が運用で曖昧になる | `doc-writing` の制約に「設計内容・要件を自分で決めない」を、`design-plan` の作業手順に「文体は文書作成の規律に従う」を置き、双方向から境界を書く |
| 断片の文言が長くなり、合成した定義の本文が膨らむ | `doc-writing` の断片は他の `impl` 役割の断片と同程度の分量に収める。日本語の言い換えの例は 4 項目に限る |
| **D2 で Haiku の定義に Agent tool が付き、Haiku のサブエージェントが再委譲を始める。** サブエージェントの多段起動はコストと制御性の面で以前に問題になった経緯がある | 用途を `_common.md` で 2 つ(アドバイザー相談と文書作成への再委譲)に限定し、それ以外の再委譲を明示的に禁じている。再委譲先には Agent Tool を許可しないため、段数は 1 段しか増えない |
| **D1 の再委譲が連鎖する。** `doc-writing` を持つ定義が impl 役割も兼ねると、自分自身へ投げ続ける | 条項に「自分が『文書作成』の役割を持つときは再委譲せず自分で書く」という例外を置いた(§4.14)。`doc-writing` 断片の制約にも「他の役割へ再委譲しない」を書いた |
| 対応表が注入されない環境(`AMATSUKA_AGENT_AUTO_INJECTION` が `none` / 未設定)で、条項が空振りする | 条項は「あれば再委譲、無ければ自分で書く」であり、差し戻しを起こさない。縮退しても作業は進む(§4.15) |
| Agent Tool が「可」の readonly 役割 4 種にも D1 の条項が出る | 条項が「文書を書くとき」を条件にしており、readonly 役割は `Write` / `Edit` を持たないため発火しない(§4.14) |
| `AGENT_DENIED_MODELS` の削除で `ComposeInput.modelId` と `Target.composeModelId` が完全に死んだ配管になる | スコープ外とし、コメントで用途が無いことを明記する。除去は別の改修で行う(§4.13 / §10-6) |
| **対応表の「文書作成」が impl 役割との兼務定義しか無いとき、その定義は Agent Tool が「可」になる。** 名指しで起動すると frontmatter の `tools` に `Agent` が残り、再委譲の連鎖を止められない | 止めるのは依頼文の「`Agent` tool を使わないこと」だけである(§5.11b / §5.11c)。`doc-writing` を単独で持つ定義を作れば frontmatter の段階で防げるため、README の移行節で分離を勧める(§5.13-6)。`setup-agents` は混成定義を `mixedKinds` として検出する仕組みを既に持つが、役割の組合せに対する分離提案は持たない |
| **F1 でオーケストレーターの委譲先が無い環境では、ビルトイン `general-purpose` へ文書の執筆が回る。** 役割断片の執筆規律が届かないため、文体の規律が効かない | §委譲先の解決 の順 3 はもともと最後の受け皿である。オーケストレーターは依頼文へ確定した内容と対象パスを渡すため、内容の正しさは保たれる。文体まで担保したい環境では `doc-writing` の定義を作る。README の移行節でその案内をする |
| F1 と D1 が指す文書範囲がずれ、オーケストレーターとサブエージェントで扱いが変わる | 両条項の対象の列挙を同じ文言で書く(§5.11b / §5.12)。**唯一の差はパスの例示(`harness-docs/handover/`・`docs/prompts/` など)であり、これは F1 側にだけ置く。** オーケストレーター向けの具体化であって範囲を広げも狭めもしない。実装計画の最終突き合わせ(T16)の項目に入れる |
| **再生成で既存定義の `disallowedTools` と MCP の付与が失われる。** このリポジトリの 13 定義のうち 7 定義が `disallowedTools` を持ち、`independent-tech-adviser.md` はプレフィックスの無い別名(`write_memory` 等)で書かれている | 再生成の前に 7 定義の `disallowedTools` と MCP の付与を一覧化し、ウィザードで同じ `--mcp-deny` を指定する。プレフィックス無しの別名は CLI が生成しないため手で復元する(§5.18)。再生成後に保持を確認する |
| `LiveVendor` が `none` を受け入れる形になり、プロキシ応答に現れない値が型に混ざる | 型のコメントで非対称を明記する。`vendorFor` が `none` を返さないことは switch を読めば分かる |

## 9. 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| `doc-writing` を `ROLES` の末尾へ置く | `roles.test.ts:130` の「`advisor` は末尾」という契約を壊す |
| `doc-writing` を `readonly` にする | 文書ファイルを書く役割であり `Write` / `Edit` が要る |
| `doc-writing` に Agent Tool を許可する | 文書の執筆に再委譲は要らない。迷いは差し戻しで解く |
| `gemini-pro` も同時に追加する | 要件で除外された。使うモデルが決まってから足す |
| gemini 用の overlay 断片を作る | 現時点で Gemini 固有の差分が無い(§4.10) |
| `live-models.ts` の Vendor union を別型のまま維持する | 二重管理が残る(§4.7) |
| `LiveVendor` を `Vendor \| "unknown"` にする | `none` が live 経路の型へ混ざり、応答から推定した値として `none` がありうると読める(§4.7) |
| `vendorFor` で `owned_by: "google"` も `gemini` へ写す | 実測が無い。`antigravity` 経由で Gemini 以外のモデルが来る可能性を既に抱えており、プロバイダ単位の写像を根拠なく広げる理由が無い(§4.8) |
| モデル id に `gemini` を含むものだけ `gemini` へ写す | `vendorFor` が `owned_by` だけを見るという現行契約を崩し、`openai` / `xai` / `anthropic` の 3 写像と非対称になる |
| `allowsAgentTool` の `model` 引数を残して無視する | 使われない引数が残り、モデルで何かが決まるように読める(§4.13) |
| `AGENT_DENIED_MODELS` を空配列のまま残す | 「いつか埋まる」前提に見え、「Agent の可否は役割だけで決まる」という決定を表現しない(§4.13) |
| D1 の規律を 7 つの impl 断片へ個別に書く | 14 ファイルの複製になり、役割が増えるたびに追随が要る(§4.14) |
| D1 の規律を `_common.md` の `## 制約` 節へ置く | Agent Tool を持たない役割にも「再委譲せよ」と出る(§4.14) |
| en 断片へ日本語ラベル `文書作成` を併記して対応表の照合を助ける | `compose.test.ts:616`「英語で合成した定義に日本語と日本語約物が混入しない」と衝突する。この検査は英語出力の品質契約であり維持する(§5.11c / §10-9。実装中の検出を受けた訂正) |
| F1 を新節「文書作成の規律」として独立させる | 「誰が設計書を書くのか」を語る場所が L166 と新節の 2 つになる(§4.16) |
| F1 を §モデル別役割の運用 の「オーケストレーターは〜」の並びへ足す | あの並びは dispatch の作法であり、「何を自分でやらないか」とは層が違う(§4.16) |
| オーケストレーターに「依頼文へ文書作成の定義名を含めよ」と課す | SubagentStart がすべてのサブエージェントへ対応表を注入するため不要(§4.15) |
| `doc-writing.gpt.md` の overlay 断片を作る | gemini と同じ判断。GPT 固有の執筆上の差分が現時点で無い(§4.10。追加要件 E-3) |
| `MODELS.at(7)` / `at(8)` の位置依存アサーションを id ベースへ直す | 今回と無関係な既存テストの書き換えであり、回帰の面を広げる(§4.9) |
| §設計・実装計画の規律 へ `doc-writing` の委譲を書く | 設計書を誰が書くのかが 2 通りに読める(§4.5) |
| ja 断片で `###` の小見出しを使う | 合成時に他役割の箇条書きへ紛れ込む(§4.12) |

## 10. 未解決事項

1. `docs/development/cliproxyapi-setup.md` が `cliproxyapi.config.example.yaml` の `antigravity` / Gemini に追随していない。要件でスコープ外と確定しているが、追随の必要そのものは残る。別タスクとして起票するかはオーケストレーターが決める。
2. `src/hooks/__test__/subagent-start.test.ts:21-36` の `ROLE_IDS` フィクスチャが 14 件のままで、`design-plan` / `explore-lead` が欠けている。件数検査ではないため落ちないが、現行の `ROLES` とずれている。本改修で `doc-writing` を足すとずれが 3 件になる。修正はスコープ外とするが、直すかどうかは判断が要る。
3. このリポジトリの `.claude/agents/` に作る 2 定義の名前(§5.18 の案)。ウィザードで利用者が決める。
4. `doc-writing` が運用で実際に呼ばれるか。呼ばれない場合、§4.5 で不採用とした「§設計・実装計画の規律 への追記」を再検討する余地がある。運用後に観測して判断する。
5. `RECOMMENDED["doc-writing"]` に入れた `gemini-flash` と `gpt-terra` が日本語の文書執筆でどの程度の品質を出すかは未検証である。運用で不足が分かれば推奨を見直す。

   **2026-09-16 の初運用で判明した事実。** `gemini-flash`(antigravity 経由)の `document-writer` は、品質を評価する前に**可用性で失敗した**。Claude Code / Agent SDK はサブエージェントの起動時に system へ identity 文 `You are a Claude agent, built on Anthropic's Claude Agent SDK.` を入れる。antigravity の上流(Cloud Code エンドポイント)がこれを検出し、quota が 100% 残っていても `429 RESOURCE_EXHAUSTED` を偽装して返す。直の curl では同じ alias が全パターンで 200 を返し、メインセッションの identity 文は検出されない。詳細は `docs/cliproxyapi/2026-09-16-antigravity-false-429-system-prompt-filter.md` にある。

   帰結として、**antigravity 経由の Gemini は現状 Claude Code のサブエージェントとして使えない。** `RECOMMENDED["doc-writing"]` に `gemini-flash` を残すかは別途判断が要る。agent-policy はプロキシの経路を知らないため、選べるのは「推奨から外す」か「README に『antigravity 経由はサブエージェントとして使えない』と注記する」かである。このリポジトリの `document-writer` は同日 `gpt-terra`(`claude-gpt-5-6-terra`、codex 経路)へ差し替えた。
6. `ComposeInput.modelId` と `Target.composeModelId` の除去(§4.13)。本改修では死んだ配管として残す。**型でも lint でも検出されないため、放置すると「`modelId` に Haiku を載せても何も起きない」状態が合図なしに残り続ける。** 別の改修で除去するかを決める。
7. このリポジトリで `gpt-terra` の `doc-writing` 定義を作るかどうか(追加要件 E-2)。`RECOMMENDED` に入ったため setup-agents が推奨構成として提示する。作るかはウィザードでユーザーが決める。
8. D2 で Agent Tool の対象が広がるが、`light-impl` や Haiku のサブエージェントが実際に妥当な再委譲をするかは未検証である。運用で観測し、問題があれば `AGENT_DENIED_MODELS` の復活ではなく役割側の規定で絞る。
9. **英語で生成した定義が、日本語の役割マーカー対応表を照合できない。** 対応表は `ROLES[].label`(日本語)で役割名を載せるため、英語の `_common.md` が英語の役割名だけを書くと突き合わせられない。既存のアドバイザー照合(`en/_common.md` L14)にも同じ欠陥がある。**緩和策として検討した日本語ラベルの併記は、英語合成の純度検査(`compose.test.ts:616`)と衝突するため不採用とした**(§5.11c)。既存の欠陥のままスコープ外とし、対応表そのものの多言語化を含めて別に扱う。
10. `setup-agents` が `doc-writing` と実装役割の兼務を検出して分離を勧めるか(§8)。現行は `mixedKinds`(impl と readonly の混成)しか検出しない。README で分離を勧めるにとどめ、CLI の変更はスコープ外とする。

## 11. Done 条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が同じコミットに入っている。
- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` がともに `0.19.0-dev` である。
- `assets/roles/ja/doc-writing.md` と `assets/roles/en/doc-writing.md` が両方存在し、`compose.test.ts` の断片整合検査を通る。
- 担当表が 17 行になり、`light-impl` の Agent Tool が「可」で、`discipline-role-table.test.ts` が通る。
- `AGENT_DENIED_MODELS` が削除され、`allowsAgentTool` が `ids` だけを受ける。`grep -rn "AGENT_DENIED_MODELS" plugins/agent-policy/src` が 0 件である。
- `_common.md`(ja/en)の Agent tool の節が改訂され、`compose.test.ts` の文言検査が新しい文言で通る。
- 共通規律に D1 の「サブエージェントは〜」条項と、F1 の 3 項(§オーケストレーターが自ら担う作業)がある。D1 と F1 が同じ文書範囲を指している。
- `plugins/agent-policy/README.md` の役割表が 17 種、モデル表が 10 種、MCP 既定の列挙に `doc-writing` があり、移行節「0.18 系から 0.19 系へ」がある。
- `skills/setup-agents/SKILL.md` の vendor 列挙が 5 値、モデル列挙が 10 件、MCP 既定の列挙に `doc-writing` がある。
- ルート `README.md` が 17 種と Gemini に追随している。
- `.serena/memories/agent_policy/core.md` が更新されている。
- このリポジトリの `.claude/agents/` に `doc-writing` を持つ定義が 2 つあり、`--list-coverage` で未被覆の役割が無い。
- ARCHITECTURE への影響の有無を確認した記録がある。影響があれば `/metatron:update` で追随している。
- 変更を適切に分けてコミットしている。
