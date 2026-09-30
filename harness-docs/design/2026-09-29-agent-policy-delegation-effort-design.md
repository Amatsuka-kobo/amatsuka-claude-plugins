# agent-policy 委譲体系の再編(13 役割・相談と Agent Tool の廃止・委譲基準の 5 軸化・effort の付与) 設計書

- 作成日: 2026-09-29
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.20.1-dev` → `0.21.0-dev`
- 状態: 設計(実装前・第 2 版。第 2 版で D8(全役割の Agent Tool 廃止)とレビュー指摘を反映)
- 承認: 要件(§2)はユーザー確定済み。この文書そのものへのユーザー承認は未取得
- 計画立案時の HEAD: `9ea98e90`
- 関連: `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md`(0.20 の役割再編。本設計はその advisor 基準(要件 8)と `design-plan` を撤回する)、`harness-docs/GOTCHAS.md` の GOTCHA-001

## 1. 背景と目的

0.20 系の役割は 16 種ある。そのうち 3 か所に運用上の無駄がある。

- `design-plan` は設計書を書くだけの役割である。要件と探索結果を依頼文へ詰め直す手間が、オーケストレーターが自分で書く手間を上回っている。
- `advisor` への相談は、サブエージェントがさらにサブエージェントを起こす経路を作る。起動のコストがかさむうえ、相談の結論が依頼元に戻らない。
- `final-review` と `gate-review` はどちらも Fable / gpt-astra で動く最終レビューであり、対象(実装差分か設計書か)が違うだけである。

相談を廃止すると、サブエージェントが `Agent` tool を使う用途は残らない。ユーザーは全役割で Agent Tool を否にすると決めた(D8)。

委譲先の選び方にも問題がある。実装 4 役割の振り分けは、公開インターフェースの変更やコンポーネント数といった変更量で決まっている。そのため、機械的に検証できる広い変更が `complex-impl` へ上がり、仕様が曖昧な小さい変更が `normal-impl` に残る。

生成する定義は `effort` を持たない。サブエージェントはセッションの effort を継承せず、既定の段で動く(§4.6)。役割とモデルの組ごとに適した段を指定できていない。

`realtime-research` と `design-review` は応答が遅い。出力に前置きと総評が付き、design-review は文書の全言及を照合する。

本改修は要件 D1〜D8 を実装する。

## 2. 確定要件(要件はユーザー確定済み。本設計はこれを前提とし、覆さない)

### 2.1 D1: 役割を 16 から 13 へ再編する

1. `design-plan` と `advisor` を廃止する。
2. `final-review` と `gate-review` を統合し、新役割 `complex-review` を作る。
   - 担当範囲は、重要な実装の差分と設計意図の最終レビューと、高リスク設計書の着手可否の最終レビューを合わせたものとする。
   - 属性は kind=`readonly`、tools=`Read, Grep, Glob, Bash`、default-name=`complex-reviewer`、Claude モデル=Fable とする。
   - `ROLES` 内の位置は旧 `final-review` の位置とする。label は §4.1 のとおり確定した。
3. `design-plan` の廃止後は、設計書・実装計画書をオーケストレーターが自分で書く。規律の「設計・実装計画の規律」から執筆の委譲を外す。
4. setup-agents の MCP 既定付与の列挙(`skills/setup-agents/SKILL.md:215`)から `design-plan` を外す。

### 2.2 D2: 相談を廃止し、差し戻しに一本化する

1. 全役割のサブエージェントは相談せず、オーケストレーターへ差し戻す。
2. 相談の記述を次の箇所から撤去する。
   - `assets/roles/{ja,en}/_common.md` の相談の節
   - `src/agents/vocabulary.ts` の相談の見出し
   - `src/agents/compose.ts` の相談の節の出力
   - 規律 §サブエージェントの規律 のうち advisor・Fable への相談に関わる条項
   - `light-impl.md:29` と `general.md:23` の相談への言及
3. impl 系(`light-impl` / `normal-impl`)から差し戻されたら、オーケストレーターは `complex-impl` へ再委譲する。`complex-impl` でも解けなければ `escalation` へ再委譲する。
4. オーケストレーター自身が判断軸を立てられないとき(規律 §分析 の現 70 行)は、`AskUserQuestion` でユーザーへ選択肢を示して質問する。

### 2.3 D3: 実装 4 役割を 5 軸で振り分ける

1. 委譲先は次の 5 軸で判断する。
   - 仕様確定度: 何を作るかが明確か
   - 設計新規性: 新しい設計判断が要るか
   - 変更影響度: 失敗したときの影響範囲
   - 検証困難度: テストなどで正解を容易に判定できるか
   - 分解可能性: 難しい判断の部分と単純な実装の部分を分けられるか
2. 各役割の条件は次のとおり。
   - `escalation`: 原因不明 / 前提崩壊 / 再設計 / 行き詰まりの解消(D2 の差し戻し経路で `complex-impl` でも解けないものを含む)。初回の作業を escalation へ委譲しない規則は残す。
   - `complex-impl`: 非自明な設計判断 / 複雑または曖昧な仕様 / 検証困難
   - `normal-impl`: 仕様と設計が済んだ大半の実装 / テスト作成
   - `light-impl`: 定型変更 / 一括変更 / 明確な小変更 / 機械的に検証できる
3. 変更量(コンポーネント数、公開インターフェース変更の有無)による振り分けは適用しない。現行の条件(規律 L88-91 と 4 断片の When to invoke)を置き換える。
4. 評価順(escalation → complex → normal → light の順で最初に該当したもの)は維持する。
5. 分解可能性と変更影響度の当て方は、条件付きの決定 (a)(b) として §4.4 に載せる(ユーザー採用 2026-09-29)。

### 2.4 D4: 推奨モデルと Claude 割当

`RECOMMENDED`(並び=採用順)と `ASSIGNMENTS["claude-model-policy"]` を §5.2 の表の値にする。`gpt-terra` は `MODELS` に残すが、どの役割にも推奨しない。

### 2.5 D5: 生成する定義に effort を付ける

1. setup-agents が生成する frontmatter に `effort` を足す。値は `low` / `medium` / `high` / `xhigh` / `max` のいずれかとする。位置は `model` の直後とする(§4.5)。
2. 値は §5.3 の (役割, モデル) の表で決める。表に無い組には `effort` を出さない(セッションの既定に任せる)。Haiku には常に出さない。
3. 1 定義が複数の役割を持つ(`--roles` に複数を渡した)ときは、該当する組の effort のうち最も高い段を採る。どの組も表に無ければ出さない。
4. `--merge` のとき、テンプレートに `effort` があれば上書きする。テンプレートに無く既存にだけあれば、`automaticKeep` の既定どおり残す。

### 2.6 D6: `realtime-research` と `design-review` を速くする

1. 両役割の Agent Tool 否は、D8(全役割の Agent Tool 廃止)に含まれる。
2. effort は §5.3 の値とする。
3. 出力は結果と指摘だけにし、前置きと総評を書かない。
4. `realtime-research`: 独立した検索クエリは 1 ターンにまとめて並列に投げる。問いに一次情報で答えられた時点で打ち切る。grok の追記断片(`realtime-research.grok.md`)は維持する。
5. `design-review`: 照合の対象を「記述の全言及」(`design-review.md:21`)から「誤っていれば判断が変わる記述」に絞る。

### 2.7 D7: このリポジトリの `.claude/agents/` を再生成する

既存の定義名と役割構成を保つ。ただし §5.14 の表の変更を加える。

- `general-implementer.md` は `normal-impl` 専用にし、model を `sonnet`、effort を medium にする(2026-09-29 の決定変更。当初の `claude-gpt-6-sol` は取り消し)。`RECOMMENDED` は変えない。
- `general-explore.md`・`code-reviewer.md`・`e2e-tester.md` の model は `sonnet` にする(2026-09-29 の決定変更)。`docs-reviewer.md` は `claude-gpt-6-sol` のままとする。`RECOMMENDED` は変えない。
- 全定義の tools から `Agent` を除く(D8)。
- 廃止する定義のファイル削除はユーザーの手で行う。

### 2.8 D8: 全役割で Agent Tool を否にする(ユーザー決定 2026-09-29)

1. 生成する定義の tools に `Agent` を出さない。役割による可否の判定(`SOLO_DENIED_ROLES` と `allowsAgentTool`)を削除する。
2. 担当表から「Agent Tool」列を削除する。すべての値が否になり、列の意味が無くなるためである。
3. `_common.md`(ja / en)の `## Agent tool の制約` / `## Agent tool limits` 節を削除する。
4. 規律を次のように直す。
   - L98 は「サブエージェントに Agent Tool を許可しない」の 1 文にする。
   - 再委譲を前提とする条項(§サブエージェントの規律 L110-113)と相談の条項を削除する。
   - L104 の転記義務は、残る「サブエージェントは〜」の条項にかける。
5. subagent-start フックは変えない。tools を宣言していない利用者の定義に対して、注入を続けるためである。
6. README の移行節で、`--merge` の再生成では既存定義の tools にある `Agent` が残ること、手で消すことを案内する。

### 2.9 全体

1. `plugin.json` と `package.json` を `0.21.0-dev` に揃える。役割 ID の削除という互換性のない変更を含むため、マイナーを上げる。
2. ルート `README.md` とプラグイン README を更新する。
3. `.serena/memories/` の記述と食い違えば更新する。
4. ARCHITECTURE と ADR は更新しない。ARCHITECTURE は役割 ID と規律の中身を名指ししていない(`grep -n -E "advisor|design-plan|final-review|gate-review|effort" harness-docs/ARCHITECTURE.md` が 0 件)。

## 3. 前提(実測)

### 3.1 コードの現況

| 対象 | 実測 |
| --- | --- |
| `src/agents/roles.ts` L3-19 / L29-126 | `RoleId` 16 種、`ROLES` 16 件。並びは complex-impl, normal-impl, light-impl, escalation, general, design-plan, explore, realtime-research, e2e-verify, design-review, knowledge-elicitation, code-review, final-review, gate-review, adversarial-review, advisor |
| 同 L28 | コメントは「並び順は設計書 §4 の表順であり、agent-policy-role の CSV の並びにも使う。」 |
| `ROLES` の並びの追随先 | 規律の担当表の行順(`discipline-role-table.test.ts` が突き合わせる)、`--list-roles` / `--list-coverage` の順(`roleOrder` / `sortRoleIds`)、CSV マーカーの並び |
| `src/agents/policies.ts` L4-13 / L47-120 | `ModelId` 9 種、`MODELS` 9 件。本改修で変えない |
| 同 L124-146 | `ASSIGNMENTS["claude-model-policy"]`(16 役割) |
| 同 L149-166 | `RECOMMENDED`(16 役割) |
| 同 L170-182 | `SOLO_DENIED_ROLES` = advisor, knowledge-elicitation, code-review, final-review, gate-review, adversarial-review。`allowsAgentTool` は役割だけで判定する。呼び出し元は `compose.ts` L43 / L126 と、テストの `policies.test.ts` / `discipline-role-table.test.ts` |
| `src/agents/vocabulary.ts` L5-7 / L16-17 / L28-29 | `advisorHeading`(ja `## アドバイザーへの相談`、en `## Consulting an advisor`)と `agentConstraintHeading`(ja `## Agent tool の制約`、en `## Agent tool limits`) |
| `src/agents/compose.ts` L12-22 | `ComposeInput`。`modelId` と `effort` を持たない |
| 同 L24-30 / L112-128 | `RolesSummary` と `describeRoles`。`agentTool` を返す。`--check` / `--write` の応答の `roles` に載る |
| 同 L43-44 / L145-163 | `withAgent` が真のとき tools に `Agent` を足す。断片の tools にある `Agent` は常に除く |
| 同 L47-63 | frontmatter の出力順は name / description / model / color / tools / disallowedTools / agent-policy-role / agent-policy-vendor |
| 同 L76-80 / L82-84 | `withAgent` が真のとき相談の節を出し、`## Agent tool の制約` の本文を `## 制約` の先頭へ束ねる |
| `src/setup-agents.ts` L69-77 | `Target` は `modelId`・`roleId?`・`roles` を持つ |
| 同 L227-240 | `defaultAgentName` |
| 同 L275-350 | `targetsFor`。`--recommended` は役割ごとに候補列を先頭から評価する |
| 同 L353-369 | `composeInputFor`。effort を渡していない |
| 同 L534-580 / L582-597 | `merge` と `automaticKeep`。テンプレートに無い既存のキー(`disallowedTools` を除く)、MCP 以外の tools、節を自動で保持する |
| 同 L774-811 / L832-868 | `coveredDefinitions` と `listCoverage`(`--list-coverage`) |
| 同 L870-1031 | `parseArgs` |
| `src/hooks/session-start.ts` L21-27 / L69-75 | `RETIRED` は廃止した**定義名**の一覧(claude-researcher など 4 件)。`retiredBlock` は定義の `name` と照合し、「次の Agent 定義は廃止済みである。…削除する: <名前>」を出す |
| 同 L49-67 | `unknownRoleBlock`。組み込みにもプロジェクト断片にも無い役割 ID を宣言した定義を「未知の役割 ID」として通知する。旧 ID のマーカーは現状この通知に載る |
| `src/hooks/subagent-start.ts` L173-183 | `deniedBy`。対象の定義が tools を宣言し、`Agent` を含まないとき、対応表の注入を止める理由を返す |
| `assets/roles/ja/_common.md` L11-20 | `## アドバイザーへの相談`(相談の条件 3 項・相談しない条件 2 項・依頼文の書き方 2 項・相談先の解決 1 項) |
| 同 L22-25 | `## Agent tool の制約` の 2 項。en も同じ構成 |
| `assets/roles/{ja,en}/` | 役割断片 16 種 + `_common.md` + `realtime-research.grok.md` |
| `assets/roles/ja/light-impl.md` L29 | 「判断に迷った場合もアドバイザーへ相談せず、その旨を報告して差し戻す」 |
| `assets/roles/ja/general.md` L23 | 「判断に迷い、アドバイザーに相談しても決められない事項は、選択肢と推奨を添えて報告する」 |
| `assets/roles/ja/design-review.md` L21 | 「文書が言及するコード・ファイルの実在と記述の整合を Read / Grep / Glob で確かめてから指摘する」 |
| `assets/roles/ja/adversarial-review.md` L14 / en L14 | When to invoke で `final-review` と比べている |
| `references/orchestration-discipline.md`(199 行、24,767B) | 担当表 L6-23(列は 役割名 / RoleId / 種別 / Agent Tool / Claude モデル)、L27 が Agent Tool 列の説明 / 委譲先の解決 L30-54 / 分析 L62-70(L70 が advisor へ諮る条項)/ 文書の執筆を委譲するとき L72-80 / モデル別役割の運用 L82-106(L85-95 が実装 4 役割と escalation、L98 が Agent Tool の許可、L104 が転記義務)/ サブエージェントの規律 L108-123(L110-113 が再委譲、L114-119 が相談)/ 委譲先の実行モデルの確定 L125-179(L139 が frontmatter のフィールドの許可一覧)/ 設計・実装計画の規律 L192-199(L195 が design-plan への委譲) |
| `skills/custom-policy/SKILL.md` | 2,421B。規律との合計は 27,188B。コスト規律の上限 30,720B までの余裕は 3,532B |
| `skills/setup-agents/SKILL.md`(285 行) | 非対話モード L37-65、ステップ 4 L163-175、ステップ 5 L177-185、ステップ 5b L187-201、ステップ 5c L203-221(L215 が MCP 既定の列挙)、ステップ 6 L223-238。`roles.agentTool` は参照していない |
| `plugins/agent-policy/README.md` | L5 に「アドバイザー運用」、L68 に `CLAUDE_CODE_SUBAGENT_MODEL` の注記、L103 に MCP 既定の列挙、L109-128 に役割一覧(16 種)、L207 以降に移行節(新しい順。先頭は「0.19 系から 0.20 系へ」で、L221 が 0.20.1 の項) |
| ルート `README.md` | L102 に「アドバイザー運用」、L106 に「全16種の役割」 |
| `.claude/agents/`(git 追跡外、15 定義) | §5.14 の表のとおり。8 定義が `disallowedTools` を持ち、9 定義の tools に `Agent` がある |
| `.serena/memories/agent_policy/core.md` | L1(バージョン)、L22-24(現行設計書)、L72(担当表の行数と列)、L96-110(役割 ID の列挙)、L122(Agent tool の用途)、L133-134(advisor 基準)、L171(design-plan)、L219-227(`RECOMMENDED` と `SOLO_DENIED_ROLES`)、L391(advisor の割当)、L404-408(Agent tool と上流フロー) |
| `.serena/memories/core.md` L170-179 | このリポジトリの定義の一覧(complex-reviewer の役割、system-planner、adviser 2 件) |

### 3.2 テストが固定している値

| ファイル:行 | 固定している値 |
| --- | --- |
| `src/agents/__test__/roles.test.ts:11-30` | 役割 ID 16 件の列挙と件数 |
| 同 `:44-58` | `design-plan` と `explore` の label・kind・tools |
| 同 `:82-124` | final-review / gate-review を含む役割の形状 |
| 同 `:170` | `roleOrder("advisor") === ROLES.length - 1`(advisor が末尾) |
| `src/agents/__test__/fragments.test.ts:57` / `:73-74` | 断片 16 件、final-review / gate-review の default-name |
| `src/agents/__test__/policies.test.ts:20-75` | `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` / `EXPECTED_AGENT_TOOL` |
| 同 `:101` / `:113` / `:226` | テスト名の「16 役割」 |
| 同 `:199-218` | `rolesFor("sonnet")` 7 件、`rolesFor("fable")` 4 件 |
| 同 `:225-252` | describe `allowsAgentTool` |
| `src/agents/__test__/compose.test.ts:109-145` | 並べ替え(`design-plan` を含む)と Agent の付与 |
| 同 `:180-188` | `describeRoles` の `agentTool: true` |
| 同 `:192-208` | 本文の節の順序(`## アドバイザーへの相談` を含む) |
| 同 `:236-257` | 相談の節の有無と `` `Agent` tool はアドバイザーへの相談だけに使う `` の文言・重複 |
| 同 `:577` | プロジェクトの `_common.md` で差し替えなかった節として相談の節が残る |
| `src/agents/__test__/discipline-role-table.test.ts:29` / `:36` / `:96-99` / `:115` / `:181-185` / `:199-222` | 表のヘッダ 5 列(`Agent Tool` を含む)、行の型の `agentTool`、4 列目の可否の解析、`allowsAgentTool` との一致、合成した表の解析(5 列の行) |
| `src/__test__/setup-agents.test.ts:52` | 応答型の `roles.agentTool` |
| 同 `:373` / `:550` / `:617` / `:1857` | 役割 16 件 |
| 同 `:471-492` | `--list-live-models` の `recommendedFor`(gpt-sol と gpt-astra) |
| 同 `:596-599` / `:608-627` / `:678-686` / `:722-723` | `--list-coverage` の advisor の models と default-name、complex-impl の models |
| 同 `:744-760` | `--list-roles` の ID 列 |
| 同 `:943` / `:969` / `:989-1019` / `:1043` | `roles.agentTool` の値(`agentToolFor` を含む) |
| 同 `:1843-1918` | `--recommended` の結果(`design-plan` を含む役割指定と先頭採用) |
| 同 `:1922-1944` | live に `claude-gpt-6-sol` だけがあるとき、`design-review` は grok を飛ばして sonnet を採る |
| 同 `:1947-1961` | 照会失敗時、`design-review` は先頭の grok を採る |
| 同 `:1967-1993` | live に `claude-grok-4-7` があるとき、`design-review` の定義の vendor が grok、color が red になる |
| `src/hooks/__test__/marker-scan.test.ts:306-308` | final-review / gate-review / design-plan の label |
| `src/hooks/__test__/subagent-start.test.ts:227` | `agent-policy-role: advisor` の定義を置き、SessionStart と対応表が一致することを見る |
| `src/hooks/__test__/session-start.test.ts:752-771` | 廃止した定義名 4 件の通知 |

### 3.3 依頼文の記載と実コードの食い違い

1. **`_common.md` の相談部は L11-20 である。** 依頼文は L11-24 とするが、L22-25 は `## Agent tool の制約` という別の節である。この節は D8 で削除が決まった。
2. **`--list-coverage` は L832-868 である。** 依頼文の L774-801 は被覆の集計(`coveredDefinitions`、L774-811)に当たる。
3. **GOTCHA-001 の対策は `--mcp-deny` の明示である。** 依頼文は「`--keep key:disallowedTools` で残す」とする。どちらでも `disallowedTools` は残るが、本設計は GOTCHA-001 の記載どおり `--mcp-deny` を使う(§5.14)。
4. **保持マージは、廃止した節と既存の `Agent` を既存の定義に残す。** `automaticKeep`(`src/setup-agents.ts` L582-597)は、テンプレートに無い既存の節と、MCP 以外の既存の tools を保持する。0.20.1 で「## 文書の執筆」を消したときと同じ挙動である(プラグイン README L221)。§4.8 で扱いを決めた。
5. **規律の起動形態の判定表は、frontmatter のフィールドを許可一覧で見ている。** 規律 L139 の順 3 は、許可一覧に無いフィールドを持つ定義を「そのまま起動」にする。§4.7 で許可一覧に `effort` を足すと決めた。L139 の文言を固定するテストは無い(`grep -rln "以外のフィールド" plugins/agent-policy/src` が 0 件)。
6. **「アドバイザー運用」の語がプラグイン README L5 とルート README L102 にある。** 依頼文の README の更新範囲に含まれていなかったため、§5.12 に足した。
7. **`subagent-start.test.ts:227` が `advisor` のマーカーを使っている。** 廃止後、この ID は組み込み役割でなくなる。テストの意図は「対応表が SessionStart と一致する」ことであり、役割の中身に依存しない。残る役割の ID に差し替える(§7.1)。
8. **`session-start.ts` の `RETIRED` は定義名の一覧であり、役割 ID を照合しない。** レビュー指摘は `RETIRED` に `design-plan` / `advisor` / `final-review` / `gate-review` を足すとする。そのまま足すと、`name` がこれらの語と一致する定義だけが検出され、旧 ID のマーカーを持つ定義(例: `complex-reviewer` が `final-review` を宣言する)は検出されない。旧 ID のマーカーは、現状 `unknownRoleBlock` の「未知の役割 ID」の通知に載る。本設計は、指摘の意図(旧 ID の残る定義に廃止を案内する)を役割 ID で照合する形で実装する(§4.10)。この読み替えはオーケストレーターが採用した(2026-09-29)。

## 4. 設計判断

### 4.1 `complex-review` は旧 2 断片を対象別の節で束ねる

label は ja「重要な実装・高リスク設計書の最終レビュー」、en「Final review of critical implementations and high-risk designs」で確定した。担当表・対応表・`--list-roles` の 1 行で、実装差分と設計書の両方を扱うことが読み取れる。

tools は旧 `final-review` と同じく `Bash` を含める。旧 `gate-review` は `Bash` を持たなかったが、統合後は実装差分の検証にテスト実行が要る。

断片 `complex-review.md` は `final-review.md` を `git mv` して作り、`gate-review.md` の内容を統合する。節ごとの組み立ては次のとおりとする。

| 節 | 内容 |
| --- | --- |
| When to invoke | 2 項目。(1) 重要な実装の完了後に、差分と設計意図の整合を最終確認するとき。(2) 高リスク案件の設計書について、実装へ着手してよいかを最終判断するとき |
| Core Responsibilities | 対象の前提・受け入れ条件・根拠を検証し、判定を根拠付きで述べる(旧 2 断片の Core Responsibilities の和) |
| 作業手順(共通) | 対象の設計書・仕様書を読む。参照先のコードまたは文書を確かめてから指摘する |
| 作業手順(実装が対象) | 実装差分を読む。変更箇所の呼び出し元と関連テストを確かめる。実装が設計意図と受け入れ条件を満たすかを検証する(旧 `final-review`) |
| 作業手順(設計書が対象) | 要件・非スコープ・受け入れ条件を突き合わせる。高リスクな前提と未解決事項を確かめる。着手を妨げる事項と着手後に扱える事項を分ける(旧 `gate-review`) |
| 制約 | 成果物(ファイル)を作らず、報告のみを返す。対象を修正しない。実装には修正案を、設計書には着手に必要な修正条件を報告する |
| Output Format | 判定欄を対象ごとに分ける(下表) |

断片本文で `###` を使えないため、対象ごとの部分は箇条書きの冒頭に「実装が対象のとき」「設計書が対象のとき」を置いて書き分ける。

旧 2 断片の Output Format の項目は、次のように振り分ける。

| 旧断片 | 旧項目 | 統合後の置き場所 |
| --- | --- | --- |
| `final-review` | 完了可否 | 実装が対象のとき: 判定(採否)と差し戻しの理由 |
| `final-review` | 指摘ごとのファイルパス・行番号・問題・修正案 | 共通: 指摘ごとの根拠(ファイルパス・行番号)・問題・修正案 |
| `final-review` | 設計意図または受け入れ条件との不整合 | 実装が対象のとき |
| `final-review` | 確認できなかった事項 | 共通 |
| `gate-review` | 判定(`着手可` / `着手不可`) | 設計書が対象のとき: 判定(着手可否)と条件 |
| `gate-review` | 判定の根拠 | 共通(指摘ごとの根拠に含める) |
| `gate-review` | 着手を妨げる事項と必要な修正条件 | 設計書が対象のとき |
| `gate-review` | 着手後に扱える事項 | 設計書が対象のとき |

`adversarial-review.md`(ja/en)L14 の `final-review` との比較は `complex-review` との比較へ書き換える。

### 4.2 相談の 3 条件は差し戻しの条件として残す

相談の節を撤去しても、サブエージェントが判断に迷う状況そのものは消えない。旧 `_common.md` L13-15 の 3 条件(依頼文に無い構造上の判断 / 依頼文と実コードの食い違い / 絞れない失敗原因)は `## 制約` へ移す。移すとき、各文の述語を「相談する」から「差し戻す」に書き換える。「相談しない条件」の 2 項(L16-17。依頼文を読む・自分で確かめる・既存パターンに合わせる・範囲拡大は差し戻す)も、相談と関係なく成り立つため `## 制約` へ移す。撤去するのは、相談先の解決・依頼文の書き方・Fable への言及(L18-20)だけである。

規律 §サブエージェントの規律 は、D8 とあわせて次のように直す。

| 行 | 処置 |
| --- | --- |
| L110-113(再委譲の作法) | 削除(D8。サブエージェントは再委譲しない) |
| L114(相談の 3 条件) | 述語を「差し戻す」へ書き換える |
| L115(相談しない条件) | 残す |
| L116(advisor への依頼文) | 削除 |
| L117(相談先の解決) | 削除 |
| L118(Agent Tool 否のときの迷い) | L114 に吸収されるため削除 |
| L119(アドバイザーに Agent Tool を許可しない) | 削除 |
| L120-123(スキルと「本文に載せる」) | 残す |

差し戻しを受けた後の経路(impl 系 → `complex-impl` → `escalation`)はオーケストレーターの規律であり、§モデル別役割の運用 に置く。サブエージェント側の規律には書かない。

### 4.3 判断軸を立てられないときはユーザーへ聞く

規律 L70 は 2 つの状況で advisor を使う。レビューの指摘が対立して採否の軸を言葉にできないときと、要件確定でユーザーへ示す判断軸を立てられないときである。どちらも `AskUserQuestion` でユーザーへ選択肢を示す形に置き換える。結論をオーケストレーターが出す原則(§分析 の冒頭)は変えない。選択肢の示し方はユーザーのメモリの規律(推奨を先頭に置く)に任せ、規律には書かない。

### 4.4 5 軸の当て方(分解可能性と変更影響度は条件付きで使う)

**役割の条件(D3)**: 各役割の条件は §2.3 のとおりとし、escalation → complex → normal → light の順に評価して、最初に該当した役割へ委譲する。各役割は、列挙した条件のいずれか 1 つに当たれば該当する。変更量(コンポーネント数、公開インターフェース変更の有無)は条件に使わない。

**決定 (a) 分解可能性(ユーザー採用 2026-09-29)**: 分解できる作業は、難しい判断の部分を `complex-impl` へ、単純な部分を `normal-impl` または `light-impl` へ分けて委譲する。

- 分けてよいのは、判断部分の成果を文書に固定でき、下位の役割が追加の判断なしに実装できるときだけである。固定する形の例は、型・関数シグネチャ・ファイル配置・変更箇所の列挙である。
- 判断部分を先に完了させ、その成果を下位の役割の依頼文に渡す。
- 次のどちらかに当たるときは分けず、全体を `complex-impl` に任せる。
  - 成果を固定できない。
  - 分割で委譲の回数が増え、効果に見合わない。
- 下位の役割は、受け渡しが曖昧で迷ったら差し戻す。オーケストレーターは差し戻された作業を `complex-impl` へ再委譲する。

**決定 (b) 変更影響度(ユーザー採用 2026-09-29)**: 影響度だけでは役割を決めず、検証困難度と組み合わせて使う。

- 影響が広く、失敗を機械的に検出できない作業は `complex-impl` へ寄せる。
- 影響が広くても機械的に検証できる作業は、役割を上げない。
- 「機械的に検証できる」根拠は、着手前の `explore` への依頼に含めて調べさせる。根拠とは、変更するすべての箇所の正誤を、どの型検査・テスト・lint・grep が判定するかである。オーケストレーターはその報告で判断し、根拠を示せなければ検証困難として扱う。
- 委譲先は完了報告に、変更した各箇所を判定した検査とその結果を添える。添えられない箇所があれば差し戻し、オーケストレーターは `complex-impl` へ再委譲する。
- 次の 3 つは、検証の可否にかかわらず `light-impl` へ委譲しない。
  - 全セッションに作用する設定(hooks など)
  - 保護パス
  - データ移行

決定 (a)(b) の置き場所は次のとおりとする。オーケストレーターの判断手順(分け方・explore への依頼・再委譲・light-impl へ委譲しない 3 つ)は規律 §モデル別役割の運用 に置く。サブエージェントの振る舞いを変える 3 点は断片にも置く。

- `normal-impl` と `light-impl` の Output Format に、変更した各箇所を判定した検査とその結果を足す。
- `light-impl` の `## 制約` に、上の 3 つに当たる作業を引き受けず差し戻すことを足す。断片は他のリポジトリでも生成されるため、「保護パス」は「プロジェクトの規約(CLAUDE.md や rules)が直接編集を禁じる、または変更の手順を定めるパス」と書き、例にバンドル出力と規約ファイルを挙げる。
- 「受け渡しが曖昧なら差し戻す」は、`_common.md` の差し戻しの条件(§4.2 の「依頼文に無い判断が要る」)で足りるため、断片には足さない。

**第三者判定の結果(jevriel `jev_ask`、jev-1.13.0、2026-09-29)**: 初版の得点は (a) 0.53、(b) 0.67 だった。条件を足した上の版では (a) 0.74〜0.69、(b) 0.70〜0.72 に上がったが、採用の閾値 0.8 には届かなかった。そのうえでユーザーが賛成し、採用した。判定が挙げた弱点と、それへの手当ては次のとおりである。

| 版 | 判定が挙げた弱点 | 手当て |
| --- | --- | --- |
| 初版 (a) | 判断部分から単純部分への受け渡しの粒度 | 成果を文書に固定できるときだけ分け、固定の形を例示した。曖昧なら差し戻す |
| 初版 (b) | テストの網羅度への依存 | 検証の根拠(どの検査が各箇所を判定するか)を着手前に `explore` で調べさせ、示せなければ検証困難として扱う |
| 最終版 | 検証の根拠が `explore` の報告品質に依存する | 委譲先に、完了報告で各箇所の検査結果を示す義務を課す。示せない箇所は差し戻して `complex-impl` へ再委譲する |

断片の When to invoke には自分の役割の条件だけを書き、評価順と決定 (a)(b) の判断手順は書かない。この方針は 0.20 の設計 §4.8 と同じである。

### 4.5 effort は `model` の直後に置き、役割とモデルの組から setup-agents が決める

`effort` はモデルの動かし方の設定であり、`model` の隣に置くと読み手が組で読める。

決める場所は setup-agents とする。`ComposeInput` は `modelId` を持たない(0.19 で除去済み)。そこで、`setup-agents.ts` の `composeInputFor` が `target.modelId` と `target.roles` から段を求め、`ComposeInput.effort` として渡す。`compose.ts` は受け取った値を出すだけにする。

表と段の選択は `policies.ts` に置く。`RECOMMENDED` と同じく (役割, モデル) を引く値であり、テストの期待値表もそこに並ぶ。形は次のとおり。

- `Effort` 型: `"low" | "medium" | "high" | "xhigh" | "max"`
- 段の順序を持つ定数: `low < medium < high < xhigh < max`
- `EFFORT`: 役割 → (ModelId → Effort) の部分表(§5.3)
- `effortFor(roleIds, modelId)`: 各役割で表を引き、得られた段のうち最も高いものを返す。1 つも得られなければ `undefined` を返す。組み込みに無い役割 ID(プロジェクト独自の役割)は、表に無い組として扱う。

個別経路で `--model` に既定と別のエイリアスを渡した場合も、段は `--model-id` の ModelId で引く。エイリアスの実体は CLI から分からないためである。

`--merge` の挙動は既存の仕組みで要件どおりになる。テンプレートに `effort` があるとき、`merge` はテンプレートの値を採り、差分は `discarded.frontmatterKeys` に出る。テンプレートに無く既存にだけあるとき、`effort` は `keysOnlyInExisting` に入り、`automaticKeep` が保持する。コードの追加は要らない。

CLI に `--effort` フラグは足さない(§9)。

### 4.6 effort の値の根拠

§5.3 の表はユーザーが確定した値である。本節はその値を支える出典を記録する。取得日はすべて 2026-09-29 である。

**Claude Code の仕様**

- subagent の frontmatter `effort` は 5 値を取り、既定はセッションの継承である。モデルが対応しない段を指定すると、指定以下で対応する最も高い段へ落ちる。環境変数 `CLAUDE_CODE_EFFORT_LEVEL` と設定 `maxEffortLevel` が frontmatter より優先する。出典: https://code.claude.com/docs/en/sub-agents 、https://code.claude.com/docs/en/model-config
- Haiku 4.5 は effort に対応しない。出典: https://platform.claude.com/docs/en/build-with-claude/effort

**実機確認(2026-09-29、CLIProxyAPI 7.3.15)**

- Claude Code は外部モデル宛てにも `thinking={"type":"adaptive"}` と `output_config.effort` を送る。CLIProxyAPI はこれを上流の `reasoning.effort` へ写す。
- grok-4.7 で `--effort low` / `high`、gpt-6-luna で frontmatter の `effort: medium` を観測した。
- サブエージェントは親の effort を継承せず、frontmatter の値で動いた。
- `--effort` を付けなくても `high` が付いた経路があり、原因は分かっていない。本改修は effort を明示するため影響しない。
- `xhigh` の写像は試していない。上流の Grok と Sol は `xhigh` を公式に持つ。

**OpenAI**

- reasoning ガイド(https://developers.openai.com/api/docs/guides/reasoning)の段の使い分けは次のとおり。
  - low: 速度を優先する検索・実行が中心の作業
  - medium: エージェント的なコーディングと調査の既定
  - high: 難しい推論・複雑なデバッグ
  - xhigh: コードレビューなど。評価で差が出たときだけ使う
- モデルページでは、gpt-6-luna の既定が medium であり、gpt-6-astra は none を持たない。
- Codex の models ページ(https://learn.chatgpt.com/docs/models)は「Sol は Medium、Luna は High、Astra は Light から始める」とする。
- 二次転記(AI Catchup 2026-09-22、https://aicatchup.com/news/openai-gpt-6-sol-luna)は次を報じている。Sol の事実誤り率は low 11.4%、medium 6.9%、high 5.1%、xhigh 4.5% である。Luna の low は長いエージェント課題で得点が崩れる。

**xAI**

- https://docs.x.ai/developers/model-capabilities/text/reasoning によれば、grok-4.7 は low / medium / high(既定)/ xhigh を持ち、max を持たない。low は遅延に敏感なエージェント向けである。
- https://x.ai/news/grok-4-7 の DeepSWE 71.0% は high の値であり、他の指標は xHigh の値である。4.7 で xhigh が high を上回ることを示す数値は公開されていない。

**ユーザー指定値との照合**

ユーザーが指定した 6 件は、上の一次情報と矛盾しない。6 件は escalation の Astra / Fable を high、complex の Opus を medium・Sol を high・Grok を xhigh、normal の Sonnet・Sol を medium・Grok を high、light の Luna を low とするものである。ただし 2 件は前提付きで採る。complex の Grok xhigh は、公開ベンチの操作点(high)より 1 段上である。light の Luna low は、長いエージェント課題で得点が崩れるという報告があるため、小変更に限る前提で成り立つ。

### 4.7 規律の起動形態の判定表の許可一覧に `effort` を足し、合成を保つ(ユーザー決定 2026-09-29)

規律 §委譲先の実行モデルの確定 の判定表(L135-144)は、上から順に評価し、最初に該当した行で確定する。順 3(L139)は、`name` / `description` / `model` / `tools` / `color` / `agent-policy-role` / `agent-policy-vendor` 以外のフィールドを持つ定義を「そのまま起動」にする。この許可一覧に `effort` を足す。`disallowedTools` は足さず、現状のままにする。

**根拠(ユーザーが示した理由)**

- 本文を同梱する規律(合成)は、専用エージェントを持つプラグインと併用することを想定して作った。
- プロジェクトで定義したエージェントは、そのプロジェクトに最適化されている。そのため、プロジェクトに最適化されていないプラグイン同梱のエージェントより優先する。

**帰結**

- `effort` だけを追加で持つ定義は、順 3 に当たらなくなる。順 7・8 まで進み、これまでどおり合成の対象になる。このリポジトリの `lead-implementer`(opus、effort medium)と `general-worker`(sonnet、effort medium)は、合成されたままになる。
- 合成したときの effort は、ホストの frontmatter の値で決まる。ホストは、役割マーカーの対応表で解決したプロジェクトの定義であり、`subagent_type` として起動されるためである。
- 外部定義に書かれた effort は持ち越さない。Agent tool の呼び出しには effort の引数が無く、持ち越す手段が無い。
- この挙動は、プロジェクトに最適化されたホストの設定を優先するという上の考え方と整合する。
- `disallowedTools` を持つ定義は、従来どおり順 3 でそのまま起動になる。外部ベンダーのモデルを指定した定義は、従来どおり順 4 でそのまま起動になる。

第 2 版は許可一覧を変えない案を採り、effort を持つ定義を非合成にしていた。この案は §9 へ移した。

### 4.8 保持マージで残る節と `Agent` は、案内で扱う

§3.3-4 のとおり、保持マージで再生成すると、既存の定義に次のものが残る。

- `## アドバイザーへの相談` / `## Consulting an advisor` の節
- `## Agent tool の制約` / `## Agent tool limits` の節
- tools にある `Agent`(D8 で全役割から外したもの)

`automaticKeep` を変えて除外する案は採らない(§9)。0.20.1 で執筆の節を消したときも、README の移行節で「手で削除するか完全上書きを選ぶ」と案内した。本改修も同じ扱いにし、移行節で案内する。このリポジトリの再生成は、保持マージを使わない手順にする(§5.14)。

### 4.9 規律のバイト数は上限に収まる見込みである

測る対象は `skills/custom-policy/SKILL.md` と `references/orchestration-discipline.md` の合計である。現在 27,188B で、上限 30,720B までの余裕は 3,532B である。

減る記述は、担当表の 3 行と Agent Tool 列、L27、L110-119 の再委譲と相談の条項の大半、L195 の執筆の委譲、L70 の advisor の条項である。増える記述は、5 軸と 4 役割の条件、決定 (a)(b)、差し戻しの経路、L139 の許可一覧への `effort` の 1 語(十数バイト)である。決定 (a)(b) は条件が多く、増分の大半を占める見込みである。

超える見込みになったときは、次の順で対処する。

1. 撤去する条項の削除が済んでいることを確かめる。
2. 足す条項を、条件の数と内容を保ったまま短くする。
3. それでも超えるときは、実装を止めてオーケストレーターへ報告する。

### 4.10 旧 ID のマーカーは、SessionStart で廃止として案内する

旧 ID(`design-plan` / `advisor` / `final-review` / `gate-review`)のマーカーを持つ定義は、更新後に対応表から消える。現状でも `unknownRoleBlock` が「未知の役割 ID」として通知するが、誤記を直す案内であり、廃止された役割であることは伝わらない。

`session-start.ts` に、廃止した役割 ID の一覧 `RETIRED_ROLES` を足す。旧 ID を宣言した定義を、既存の `retiredBlock` と同じ形式の 1 文で通知する。文は「次の Agent 定義は廃止済みの役割 ID を宣言している。…」で始め、`- <定義名>: <役割 ID>` の行を並べ、書き換え先(`final-review` / `gate-review` は `complex-review`、`design-plan` / `advisor` は削除)を添える。この 4 件は `unknownRoleBlock` の対象から外し、二重に通知しない。

既存の `RETIRED`(定義名の一覧)には足さない。定義名で照合するため、旧 ID のマーカーを検出できない(§3.3-8)。レビュー指摘の字義(`RETIRED` に足す)からのこの読み替えは、オーケストレーターが採用した(2026-09-29)。

## 5. 各変更の詳細

指示書の文面は、実装時に `prompt-smith:prompt-smith` の規律に従って書く。本節は要点だけを示す。

### 5.1 `src/agents/roles.ts`

`RoleId` から `design-plan` / `final-review` / `gate-review` / `advisor` を外し、`complex-review` を足す。`ROLES` の最終形(13 件)は次のとおり。

| 添字 | id | label | kind | tools |
| --- | --- | --- | --- | --- |
| 0 | `complex-impl` | 複雑または重要な実装 | impl | 現行どおり |
| 1 | `normal-impl` | 通常の実装 | impl | 現行どおり |
| 2 | `light-impl` | 軽量な実装 | impl | 現行どおり |
| 3 | `escalation` | 行き詰まり時のエスカレーション | impl | 現行どおり |
| 4 | `general` | その他のタスク | impl | 現行どおり |
| 5 | `explore` | コードベース探索 | readonly | 現行どおり |
| 6 | `realtime-research` | リアルタイム情報調査 | readonly | 現行どおり |
| 7 | `e2e-verify` | E2E 動作検証・ブラウザ/GUI 操作 | impl | 現行どおり |
| 8 | `design-review` | 設計書・実装計画書のレビュー | readonly | 現行どおり |
| 9 | `knowledge-elicitation` | 暗黙知の抽出・理解レビュー | readonly | 現行どおり |
| 10 | `code-review` | コードレビュー | readonly | 現行どおり |
| 11 | `complex-review` | 重要な実装・高リスク設計書の最終レビュー | readonly | `Read, Grep, Glob, Bash` |
| 12 | `adversarial-review` | 敵対的レビュー | readonly | 現行どおり |

末尾は `adversarial-review` になる。

### 5.2 `src/agents/policies.ts` の割当と推奨

`RECOMMENDED` の列は並びに意味がある。先頭から評価し、live models に実在する最初のモデルを採る。Claude のモデルは常に実在とみなすため、最初の Claude のモデルより後ろの候補は `--recommended` では採られない。

| 役割 | `ASSIGNMENTS` | `RECOMMENDED`(この順) |
| --- | --- | --- |
| `complex-impl` | opus | gpt-sol, opus, grok |
| `normal-impl` | sonnet | gpt-sol, sonnet, grok |
| `light-impl` | haiku | gpt-luna, haiku |
| `escalation` | fable | gpt-astra, fable |
| `general` | sonnet | gpt-luna, sonnet |
| `explore` | sonnet | gpt-sol, sonnet |
| `realtime-research` | sonnet | grok, sonnet |
| `e2e-verify` | sonnet | gpt-sol, sonnet |
| `design-review` | sonnet | gpt-sol, sonnet |
| `knowledge-elicitation` | haiku | haiku |
| `code-review` | sonnet | gpt-sol, sonnet |
| `complex-review` | fable | gpt-astra, fable |
| `adversarial-review` | opus | opus, gpt-sol |

`SOLO_DENIED_ROLES` と `allowsAgentTool` は削除する(D8)。

`rolesFor` の結果は次のようになる。sonnet は 7 件(normal-impl, general, explore, realtime-research, e2e-verify, design-review, code-review)で変わらない。fable は escalation, complex-review の 2 件、opus は complex-impl, adversarial-review の 2 件、haiku は light-impl, knowledge-elicitation の 2 件になる。

### 5.3 `src/agents/policies.ts` の effort

表に無い組は effort を出さない。Haiku の組は表に載せない。

| 役割 | モデル → effort |
| --- | --- |
| `escalation` | fable=high, gpt-astra=high |
| `complex-impl` | opus=medium, gpt-sol=high, grok=xhigh |
| `normal-impl` | sonnet=medium, gpt-sol=medium, grok=high |
| `light-impl` | gpt-luna=low |
| `general` | sonnet=medium, gpt-luna=medium |
| `explore` | sonnet=medium, gpt-sol=medium |
| `realtime-research` | grok=low, sonnet=low |
| `e2e-verify` | sonnet=medium, gpt-sol=medium |
| `design-review` | sonnet=medium, gpt-sol=medium |
| `knowledge-elicitation` | (なし) |
| `code-review` | sonnet=high, gpt-sol=high |
| `complex-review` | gpt-astra=high, fable=high |
| `adversarial-review` | opus=high, gpt-sol=high |

型・定数・関数の形は §4.5 のとおりとする。

### 5.4 `src/agents/vocabulary.ts` と `src/agents/compose.ts`

- `Vocabulary` から `advisorHeading` と `agentConstraintHeading` を削除する(ja / en とも)。
- `compose()` から次を削除する。
  - `withAgent` の計算(L43)と、それに依存する分岐
  - 相談の節の出力(L76-80)
  - `## Agent tool の制約` を `## 制約` へ束ねる部分(L83)
- `resolveToolsFor` は `Agent` を足す分岐(L158)を削除する。断片の tools にある `Agent` を除く処理(L155)は残す。
- `RolesSummary` から `agentTool` を削除し、`describeRoles` もそれを返さない。
- `ComposeInput` に `effort?: Effort` を足す。frontmatter では、値があるときだけ `model` の直後に `effort: <値>` を出す。

### 5.5 `src/setup-agents.ts`

- `composeInputFor` で `effort: effortFor(target.roles, target.modelId)` を渡す。個別経路と `--recommended` の両方に効く。
- `--check` / `--write` の応答の `roles` から `agentTool` が消える(`describeRoles` の変更に伴う)。SKILL.md はこのキーを読んでいない。
- それ以外(`targetsFor`、`merge`、`automaticKeep`、`parseArgs`)は変えない。

### 5.6 役割断片: 削除と新規

| ファイル | 変更 |
| --- | --- |
| `assets/roles/{ja,en}/design-plan.md` | 削除 |
| `assets/roles/{ja,en}/advisor.md` | 削除 |
| `assets/roles/{ja,en}/final-review.md` | `git mv` で `complex-review.md` にする |
| `assets/roles/{ja,en}/gate-review.md` | 内容を `complex-review.md` へ統合して削除 |
| `assets/roles/{ja,en}/complex-review.md` | §4.1 の組み立てで書く |

`complex-review.md` の frontmatter は `id: complex-review`、label(§4.1)、description(実装差分と設計意図の最終レビュー、および高リスク設計書の着手可否の最終レビュー)、`default-name: complex-reviewer`、`tools: Read, Grep, Glob, Bash`、`kind: readonly` とする。ja と en で `default-name` / `tools` / `kind` を一致させる。断片本文で `###` を使わない。

### 5.7 役割断片: 既存の書き換え

| ファイル | 変更の要点 |
| --- | --- |
| `_common.md`(ja/en) | `## アドバイザーへの相談` / `## Consulting an advisor` と `## Agent tool の制約` / `## Agent tool limits` の 2 節を削除する。旧 L13-17 の 5 項目は `## 制約` へ移し、L13-15 の述語を「相談する」から「差し戻す」に書き換える(§4.2) |
| `light-impl.md`(ja/en) | L29 の「アドバイザーへ相談せず」を外し、「判断に迷った場合は、その旨を報告して差し戻す」の趣旨にする。When to invoke と description を §2.3 の `light-impl` の条件で書き直す。`## 制約` に、全セッションに作用する設定(hooks など)・プロジェクトの規約(CLAUDE.md や rules)が直接編集を禁じる、または変更の手順を定めるパス(例: バンドル出力、規約ファイル)・データ移行に当たる作業を引き受けず差し戻す旨を足す。Output Format に、変更した各箇所を判定した検査とその結果を足す(§4.4 決定 (b)) |
| `normal-impl.md`(ja/en) | When to invoke と description を §2.3 の条件で書き直す。Output Format の「実行したコマンドと結果」を、変更した各箇所を判定した検査とその結果に広げる(§4.4 決定 (b))。他の節は変えない |
| `complex-impl.md`(ja/en) | When to invoke と description を §2.3 の条件で書き直す。description の「公開インターフェース変更・複数コンポーネント」を外す |
| `escalation.md`(ja/en) | When to invoke を §2.3 の条件で書き直す。L22 の入力の要求(試行履歴・失敗出力の原文・未解決の制約が無ければ差し戻す)は残す |
| `general.md`(ja/en) | L23 を「判断に迷う事項は、選択肢と推奨を添えて報告する」の趣旨にする(相談への言及を外す) |
| `realtime-research.md`(ja/en) | 作業手順に、独立した検索クエリを 1 ターンにまとめて並列に投げること、一次情報で答えられた時点で打ち切ることを足す。Output Format の冒頭に、結果だけを書き前置きと総評を書かない旨を足す。`realtime-research.grok.md` は変えない |
| `design-review.md`(ja/en) | L21 の照合対象を「誤っていれば判断が変わる記述」に絞る。Output Format の冒頭に、指摘だけを書き前置きと総評を書かない旨を足す |
| `adversarial-review.md`(ja/en) | L14 の `final-review` との比較を `complex-review` との比較にする |

en 断片と en の `_common.md` に日本語と日本語約物を書かない。`compose.test.ts:585-599` の英語断片の合成検査と、ja 以外の混入を見る既存の検査がこれを担保する。

### 5.8 規律 `references/orchestration-discipline.md`

| 節 | 変更の要点 |
| --- | --- |
| §担当表(L6-23) | 「Agent Tool」列を削除し、4 列(役割名 / RoleId / 種別 / Claude モデル)にする。行は §5.1 / §5.2 の 13 行。`complex-review` の Claude モデルは `Fable`。列幅は既存の桁揃えに合わせる |
| 同 L27 | Agent Tool 列の説明を削除する |
| §オーケストレーターが自ら担う作業(L58) | 設計書・実装計画書をオーケストレーターが自分で書くことを明記する |
| §分析(L70) | advisor へ諮る条項を、`AskUserQuestion` でユーザーへ選択肢を示して質問する条項に置き換える(§4.3) |
| §文書の執筆を委譲するとき(L72-80) | 変えない。`general` などへ文書を委譲する場面で引き続き効く |
| §モデル別役割の運用(L85-95) | L85-91 を 5 軸と 4 役割の条件(§2.3)、決定 (a)(b)(§4.4。explore への検証根拠の依頼、完了報告の検査結果、light-impl へ委譲しない 3 つを含む)に置き換える。評価順の記述と「条件のいずれか 1 つで該当」は残す。L93-95 の escalation の運用規律は残し、差し戻しの経路(impl 系 → `complex-impl` → `escalation`)を足す |
| 同 L98 | 「サブエージェントに Agent Tool を許可しない」の 1 文にする |
| 同 L104 | 転記義務は残す。対象は §サブエージェントの規律 に残る「サブエージェントは〜」の条項になる |
| §サブエージェントの規律(L108-123) | §4.2 の表のとおり |
| §委譲先の実行モデルの確定(L139) | 順 3 の許可一覧に `effort` を足す。`disallowedTools` は足さない(§4.7) |
| §設計・実装計画の規律(L194-195) | L195 の執筆の委譲を、オーケストレーターが自分で書く形に置き換える。L194 は「探索で確定した事実を踏まえて書く」趣旨へ直す。L196-199(レビューの順序と承認)は変えない |

### 5.9 `skills/setup-agents/SKILL.md`

| 箇所 | 変更の要点 |
| --- | --- |
| L215(ステップ 5c-3) | 既定で MCP を付ける役割の列挙を `complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` の 5 件にする |
| ステップ 4(L163-175) | 生成する定義に、役割とモデルの組に応じた `effort` が入ること、表に無い組には入らないことを 1 文で足す。値の表は SKILL.md に写さない(CLI が決めるため) |

frontmatter は変えない。

### 5.10 `src/hooks/session-start.ts`

§4.10 のとおり、廃止した役割 ID の通知を足す。`RETIRED`(定義名)と `retiredBlock` は変えない。`unknownRoleBlock` は廃止した 4 件の役割 ID を対象から外す。`subagent-start.ts` は変えない(D8-5)。

### 5.11 バージョンと Serena メモリ

- `plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.21.0-dev` にする。
- §3.1 に挙げた `.serena/memories/agent_policy/core.md` と `.serena/memories/core.md` の行を、13 役割・相談と Agent Tool の廃止・5 軸・effort・`.claude/agents/` の新しい構成に追随させる。現行設計書として本設計書を挙げる。Serena の `edit_memory` / `write_memory` で行う。

### 5.12 README

**プラグイン `README.md`**

- L5: 「アドバイザー運用」を外す。
- L68 の近く: `CLAUDE_CODE_EFFORT_LEVEL` と設定 `maxEffortLevel` が frontmatter の `effort` より優先することを書く。
- L103: MCP 既定の列挙を 5 件にする。
- L109-128: 役割一覧を 13 種にする(§5.1 の順)。
- L145 の近く: 生成した定義の frontmatter に `effort` が入る場合があることを書く。
- 「旧バージョンからの移行」の先頭に「0.20 系から 0.21 系へ」を新設する。項目は次のとおり。
  1. `design-plan` / `advisor` / `final-review` / `gate-review` を廃止し、`complex-review` を追加した。旧 ID のマーカーは組み込み役割として認識されず、対応表に出ない。SessionStart が廃止として通知する。定義を削除するか、`agent-policy-role` を書き換えるか、再生成する。
  2. サブエージェントは相談せず差し戻すようになった。
  3. 全役割で Agent Tool を否にした。生成する定義の tools に `Agent` が入らない。`--merge` の再生成では、既存定義の tools にある `Agent` が残るため、手で消す。
  4. 保持マージで再生成すると、既存の定義に `## アドバイザーへの相談` と `## Agent tool の制約` の節が残る。手で削除するか、差分方針で「完全上書き」を選ぶ。
  5. 生成する定義に `effort` を付けるようになった。表に無い組には付かない。テンプレートに無く既存の定義にだけある `effort` は、保持マージで残る。`effort` は規律の起動形態の判定で許可されたフィールドであり、名指しで起動したときの合成の可否を変えない。合成したときは、ホストの定義の `effort` で動く(§4.7)。
  6. 推奨モデル(`RECOMMENDED`)と Claude 割当を変更した。custom で採用されるモデルが変わる場合がある。
  7. 実装 4 役割の選定基準を変更した。生成済み定義の本文へ反映するには再生成する。
  8. MCP の既定付与の列挙から `design-plan` を外した。
  9. `--check` / `--write` の応答の `roles` から `agentTool` を削除した。
  10. `ja` / `en` 以外の翻訳断片を使う場合は、`_common.md` の更新に合わせて再翻訳する。削除した役割の翻訳断片(`design-plan.md` / `advisor.md` / `final-review.md` / `gate-review.md`)は、残っているとプロジェクト独自の役割として扱われるため削除する。
- 古い移行節は履歴として変えない。

**ルート `README.md`**: L102 から「アドバイザー運用」を外し、残りの文が成り立つように整える。L106 の「全16種」を「全13種」にする。他の行は変えない。

### 5.13 変更しないもの

- `harness-docs/ARCHITECTURE.md`、ADR、`harness-docs/GOTCHAS.md`、`.claude/rules/metatron/`
- `src/hooks/` のうち `session-start.ts` 以外。`subagent-start.ts` は、tools を宣言していない利用者の定義に対して注入を続けるため変えない(D8-5)。
- `src/agents/fragments.ts`、`src/agents/live-models.ts`、`src/agents/mcp.ts`
- `MODELS` と `Vendor`
- `skills/custom-policy/SKILL.md` と `skills/claude-model-policy/SKILL.md`(廃止した役割と相談に触れていない)
- 他プラグイン(旧 ID を参照していない)

### 5.14 このリポジトリの `.claude/agents/`

既存の定義名と役割構成を保つ。次の表の処置を加える。effort は §5.3 の表から CLI が決める。全定義の tools から `Agent` が外れる(D8)。

| 定義 | 現在のマーカー / model | 処置後のマーカー / model / effort |
| --- | --- | --- |
| `system-planner.md` | design-plan / opus | ユーザーが削除する |
| `independent-tech-adviser.md` | advisor / claude-gpt-6-astra | ユーザーが削除する |
| `technical-adviser.md` | advisor / fable | ユーザーが削除する |
| `complex-reviewer.md` | final-review, gate-review / claude-gpt-6-astra | complex-review / claude-gpt-6-astra / high |
| `general-implementer.md` | normal-impl, light-impl / claude-gpt-6-luna | normal-impl / sonnet / medium |
| `light-implementer.md`(新規) | — | light-impl / claude-gpt-6-luna / low |
| `general-explore.md` | explore / claude-grok-4-7 | explore / sonnet / medium |
| `docs-reviewer.md` | design-review / claude-grok-4-7 | design-review / claude-gpt-6-sol / medium |
| `code-reviewer.md` | code-review / sonnet | code-review / sonnet / high |
| `e2e-tester.md` | e2e-verify / sonnet | e2e-verify / sonnet / medium |
| `realtime-researcher.md` | realtime-research / claude-grok-4-7 | realtime-research / claude-grok-4-7 / low |
| `lead-implementer.md` | complex-impl / opus | complex-impl / opus / medium |
| `technical-leader.md` | escalation / claude-gpt-6-astra | escalation / claude-gpt-6-astra / high |
| `general-worker.md` | general / sonnet | general / sonnet / medium |
| `knowledge-elicitationer.md` | knowledge-elicitation / haiku | knowledge-elicitation / haiku / なし |
| `adversarial-reviewer.md` | adversarial-review / claude-gpt-6-sol | adversarial-review / claude-gpt-6-sol / high |

再生成は個別経路(`--model-id … --name … --roles …`)で行い、`--merge` を使わない。保持マージは、廃止した節と既存の `Agent` を残すためである(§4.8)。MCP は、事前の `--check` が返す `mcpCurrent.servers` を `--mcp-servers` に、`mcpCurrent.denyTools` を `--mcp-deny` に渡して引き継ぐ(GOTCHA-001)。`light-implementer.md` の MCP は `general-implementer.md` の現在の値に合わせる。手順の詳細(`claude mcp list` の確認、止める条件、戻し方)は実装計画書 T13 に書く。

生成の前に `.claude/agents/` を別ディレクトリへ複製する。生成後に複製と比べ、`disallowedTools` と MCP の行が消えていないことを確かめる。削除する 3 定義は、ユーザーが絶対パスで削除する。`.claude/agents` は git 追跡外のため、コミットを伴わない。

## 6. 影響ファイル

### 6.1 実装

| ファイル | 変更 |
| --- | --- |
| `src/agents/roles.ts` | `RoleId` と `ROLES`(§5.1) |
| `src/agents/policies.ts` | `ASSIGNMENTS` / `RECOMMENDED`(§5.2)、`SOLO_DENIED_ROLES` / `allowsAgentTool` の削除、`Effort` / `EFFORT` / `effortFor`(§5.3) |
| `src/agents/vocabulary.ts` | `advisorHeading` / `agentConstraintHeading` の削除 |
| `src/agents/compose.ts` | 相談の節・Agent tool の制約・`Agent` の付与・`RolesSummary.agentTool` の削除、`effort` の出力 |
| `src/setup-agents.ts` | `composeInputFor` で effort を渡す |
| `src/hooks/session-start.ts` | 廃止した役割 ID の通知(§4.10) |
| `scripts/*.mjs` | `pnpm run build` の再生成物 |

### 6.2 断片・規律・文書

| ファイル | 変更 |
| --- | --- |
| `assets/roles/{ja,en}/design-plan.md` / `advisor.md` / `gate-review.md` | 削除 |
| `assets/roles/{ja,en}/final-review.md` → `complex-review.md` | 改名と統合 |
| `assets/roles/{ja,en}/_common.md` / `light-impl.md` / `normal-impl.md` / `complex-impl.md` / `escalation.md` / `general.md` / `realtime-research.md` / `design-review.md` / `adversarial-review.md` | §5.7 |
| `references/orchestration-discipline.md` | §5.8 |
| `skills/setup-agents/SKILL.md` | §5.9 |
| `plugins/agent-policy/README.md`、ルート `README.md` | §5.12 |
| `.claude-plugin/plugin.json` / `package.json` | `0.21.0-dev` |
| `.serena/memories/agent_policy/core.md` / `.serena/memories/core.md` | Serena 経由 |

### 6.3 テスト

| ファイル | 変更 |
| --- | --- |
| `src/agents/__test__/roles.test.ts` | §7.1 |
| `src/agents/__test__/fragments.test.ts` | §7.1 |
| `src/agents/__test__/policies.test.ts` | §7.1 / §7.3 / §7.4 |
| `src/agents/__test__/compose.test.ts` | §7.1 / §7.2 / §7.3 / §7.4 |
| `src/agents/__test__/discipline-role-table.test.ts` | §7.4 |
| `src/__test__/setup-agents.test.ts` | §7.1 / §7.3 / §7.4 |
| `src/hooks/__test__/marker-scan.test.ts` | §7.1 |
| `src/hooks/__test__/subagent-start.test.ts` | §7.1 |
| `src/hooks/__test__/session-start.test.ts` | §7.5 |

## 7. テスト方針

### 7.1 役割の再編で固定値を直す検査

| ファイル:行 | 変更 |
| --- | --- |
| `roles.test.ts:11-30` | 13 件、§5.1 の並び |
| `roles.test.ts:44-58` | `design-plan` の検査を外し、`explore` の検査だけにする |
| `roles.test.ts:82-124` | final-review / gate-review の形状検査を `complex-review` の label・kind・tools の検査にする |
| `roles.test.ts:170` | `roleOrder("adversarial-review") === ROLES.length - 1` にする |
| `fragments.test.ts:57` / `:73-74` | 13 件。`complex-review` → `complex-reviewer` を検査する |
| `policies.test.ts:20-75` | `EXPECTED_CLAUDE_ASSIGNMENTS` と `EXPECTED_RECOMMENDED` を §5.2 の表にする。`EXPECTED_AGENT_TOOL` は §7.4 で削除する |
| `policies.test.ts:101` / `:113` / `:226` | テスト名を「13 役割」に |
| `policies.test.ts:211-218` | `rolesFor("fable")` を escalation, complex-review にする |
| `compose.test.ts:109-122` | 並べ替えの入力から `design-plan` を外す |
| `setup-agents.test.ts:373` / `:550` / `:617` / `:1857` | 13 件 |
| `setup-agents.test.ts:471-492` | `recommendedFor` を新しい `RECOMMENDED` に合わせる。gpt-sol は complex-impl, normal-impl, explore, e2e-verify, design-review, code-review, adversarial-review、gpt-astra は escalation, complex-review |
| `setup-agents.test.ts:596-599` / `:608-627` / `:678-686` / `:722-723` | advisor の検査を `complex-review` の検査に置き換える(custom の models は gpt-astra, fable、claude は fable、default-name は complex-reviewer)。complex-impl の models を gpt-sol, opus, grok に |
| `setup-agents.test.ts:744-760` | §5.1 の 13 件の並び |
| `setup-agents.test.ts:1882-1901` | `--roles` から `design-plan` を外し、残る役割(例: `adversarial-review` → opus)に差し替える。`design-review` の期待値を gpt-sol に |
| `setup-agents.test.ts:1922-1944` | live に `claude-gpt-6-sol` だけがあるとき、`design-review` は先頭の gpt-sol を採る。「先頭が無ければ次の Claude enum」の意図を保つには、先頭が live に無い役割の組(例: live を `claude-grok-4-7` だけにして `design-review` が sonnet を採る)に差し替える |
| `setup-agents.test.ts:1947-1961` | 照会失敗時、`design-review` の期待値を先頭の gpt-sol にする |
| `setup-agents.test.ts:1967-1993` | live に `claude-grok-4-7` だけがあるとき、`design-review` は gpt-sol が無いため sonnet を採り、vendor が claude、color が blue になる。「ModelSpec 由来の vendor と color」の意図を保つには、外部ベンダーの定義が採られる組(例: `realtime-research` の grok → vendor grok、color red)を足す |
| `marker-scan.test.ts:306-308` | 3 行を `complex-review` の label の 1 行に置き換える |
| `subagent-start.test.ts:227` | `advisor` を残る役割の ID(例: `code-review`)に差し替える |

### 7.2 相談の節の撤去

| 検査 | 内容 |
| --- | --- |
| `compose.test.ts:192-208` | 節の順序の期待値から `## アドバイザーへの相談` を外す |
| `compose.test.ts:236-238` | どの役割でも `## アドバイザーへの相談` と `## Consulting an advisor` を出さない検査にする(ja / en。全役割を合成して見る) |
| `compose.test.ts:577` | プロジェクトの `_common.md` で差し替えなかった節の例を、`## 制約` など残る節にする |
| 新規 | ja / en の全役割の合成結果に `advisor`・`design-plan`・`final-review`・`gate-review` が現れない(`compose.test.ts:222-234` の既存検査に足す) |
| 新規 | ja で合成した定義の `## 制約` に、旧 L13-15 の差し戻しの条件がある(述語が「差し戻す」) |

### 7.3 effort

| 検査 | 内容 |
| --- | --- |
| `policies.test.ts` 新規 | `EFFORT` が §5.3 の表と一致する(期待値表で固定)。haiku を値に持つ組が無い |
| `policies.test.ts` 新規 | `effortFor(["normal-impl"], "gpt-luna")` は `undefined`、`effortFor(["light-impl"], "gpt-luna")` は `low`、`effortFor(["normal-impl", "light-impl"], "gpt-luna")` は `low`、`effortFor(["general", "code-review"], "sonnet")` は `high`、`effortFor(["knowledge-elicitation"], "haiku")` は `undefined`、組み込みに無い ID を含んでも例外を投げない |
| `compose.test.ts` 新規 | `effort` を渡すと frontmatter の `model` の直後に `effort: <値>` が出る。渡さないと `effort` の行が無い |
| `setup-agents.test.ts` 新規 | `--check --recommended --scope claude` の各定義の frontmatter に、§5.3 の claude 側の値(complex-impl の opus は medium、light-impl の haiku は無し)が出る |
| `setup-agents.test.ts` 新規 | 個別経路 `--model-id sonnet --roles general,code-review` で `effort: high` が出る |
| `setup-agents.test.ts` 新規 | `--write --merge` で、既存の `effort: low` がテンプレートの値に上書きされる。テンプレートに effort が無い組(haiku)では、既存の `effort` が残る |

### 7.4 Agent Tool の廃止

| ファイル:行 | 変更 |
| --- | --- |
| `policies.test.ts:20-75` | `EXPECTED_AGENT_TOOL` を削除する |
| `policies.test.ts:225-252` | describe `allowsAgentTool` を削除する |
| `compose.test.ts:124-145` | Agent の付与の検査を、全 13 役割で tools に `Agent` が無い検査にする。断片の tools に `Agent` を書いても出ないことも見る |
| `compose.test.ts:180-188` | `describeRoles` の期待値から `agentTool` を外す |
| `compose.test.ts:240-257` | Agent tool の制約の検査を、全役割で `## Agent tool の制約` と `## Agent tool limits` が出ない検査にする |
| `discipline-role-table.test.ts:29` / `:36` / `:96-99` / `:115` | ヘッダを 4 列(役割名 / RoleId / 種別 / Claude モデル)にし、Agent Tool の解析と行の `agentTool` を削除する。Claude モデルは 4 列目(`cells[3]`)から読む |
| `discipline-role-table.test.ts:181-185` | 「Agent Tool が allowsAgentTool と一致する」を削除する |
| `discipline-role-table.test.ts:199-222` | 合成した表の行を 4 列にする |
| `setup-agents.test.ts:52` / `:943` / `:969` / `:989-1019` / `:1043` | 応答型と期待値から `roles.agentTool` を外す。`agentToolFor` の検査は、生成した定義の tools に `Agent` が無い検査に置き換えるか削除する |

### 7.5 SessionStart の廃止役割の通知

| 検査 | 内容 |
| --- | --- |
| `session-start.test.ts` 新規 | `agent-policy-role: final-review` を宣言した定義を置くと、廃止の通知に定義名と役割 ID と書き換え先(`complex-review`)が載る |
| `session-start.test.ts` 新規 | `design-plan` / `advisor` / `gate-review` のそれぞれでも同じ通知が出る(`it.each`) |
| `session-start.test.ts` 新規 | 廃止した役割 ID は「未知の役割 ID」の通知に重ねて載らない |
| `session-start.test.ts:752-771` | 変えない(定義名の `RETIRED` は維持) |

### 7.6 検証コマンド

`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build`。CLI の実挙動は次で確かめる。

- `node plugins/agent-policy/scripts/setup-agents.mjs --list-roles --lang ja --dir "$PWD"` が 13 役割を返す。
- `node plugins/agent-policy/scripts/setup-agents.mjs --check --recommended --scope claude --lang ja --dir "$(mktemp -d)"` が 13 件を返す。

外部モデルへの effort の到達は、実機確認のタスクで確かめる(実装計画書 T14)。

## 8. リスクと受容

| リスク | 対処 |
| --- | --- |
| 旧 ID のマーカーを持つ生成済み定義が組み込み役割として認識されず、対応表から消える | SessionStart が廃止として通知する(§4.10)。移行節で削除・書き換え・再生成を案内する。このリポジトリは最後のタスクで再生成する |
| 保持マージで、相談の節・Agent tool の制約の節・`Agent` が既存の定義に残る | 移行節で案内する(§4.8)。このリポジトリは保持マージを使わずに再生成する |
| Agent Tool の廃止で、生成した定義が subagent-start の注入対象から外れる(`deniedBy` が tools に `Agent` の無い定義を止める) | 仕様とする。サブエージェントは委譲しないため、対応表を要しない。tools を宣言していない利用者の定義には注入を続ける(D8-5) |
| 相談の廃止で、判断に迷ったサブエージェントの差し戻しが増え、往復が増える | 差し戻しの経路(impl 系 → complex-impl → escalation)で吸収する。差し戻しの条件を 3 つに限り、それ以外は自分で確かめる規則を残す(§4.2) |
| effort の値が `CLAUDE_CODE_EFFORT_LEVEL` や `maxEffortLevel` に上書きされ、定義の値が効かない | Claude Code の仕様である。README に書く |
| 外部モデル宛ての `xhigh` がプロキシで写像されない | 実機では未試験である(§4.6)。`xhigh` を使う組は complex-impl の grok だけで、このリポジトリの定義には無い。実機確認で low / medium / high の写像を確かめ、`xhigh` の未確認は記録に残す |
| `--effort` 無しでも `high` が付く経路がある | 原因は分かっていない。本改修は全定義で effort を明示するか意図して省くため、明示した組には影響しない。省いた組(haiku、表に無い組)では、この経路の値で動く可能性がある |
| 合成したとき、外部定義に書かれた effort が効かず、ホストの effort で動く | 仕様とする。プロジェクトに最適化されたホストの設定を優先する考え方と整合する。Agent tool の呼び出しに effort の引数が無く、持ち越せない(§4.7) |
| 5 軸の当て方がオーケストレーターの判断に依存し、振り分けが揺れる | 評価順と「条件のいずれか 1 つで該当」を残す。決定 (a)(b) で変更影響度と分解可能性の使い方を定める |
| 決定 (b) の検証の根拠が `explore` の報告品質に依存する(第三者判定の指摘) | 委譲先が完了報告で各箇所の検査結果を示す。示せない箇所は差し戻して `complex-impl` へ再委譲する(§4.4) |
| 決定 (a)(b) で explore の事前調査と差し戻しが増え、委譲の回数が増える | 分割の効果が委譲の回数に見合わないときは分けない(§4.4)。第三者判定の得点が閾値 0.8 に届かなかったことを踏まえ、運用で差し戻しが多いときは再検討の材料にする |
| en 断片に日本語が入る | 依頼文で明記する。`compose.test.ts` の英語断片の合成検査が検出する |
| 実装の途中で、このリポジトリの対応表から complex-reviewer などが消える(旧 ID のマーカーのため) | 再生成(T13)までの間、レビューは定義を名指しで起動する。T1 の後は SessionStart が廃止の通知を出すが、実装中は想定どおりの通知として扱う(実装計画書 §1) |
| 規律の合計が 30,720B を超える | §4.9 の手順 |

## 9. 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| `final-review` と `gate-review` を残し、推奨モデルだけを揃える | 2 役割は同じモデルで動き、対象が違うだけである。役割を分けても委譲先の選択は変わらない |
| `complex-review` の tools から `Bash` を外す(旧 `gate-review` に合わせる) | 実装差分の最終レビューでテストを実行できなくなる(§4.1) |
| 相談の 3 条件ごと撤去する | 迷う状況そのものは残る。条件が無いと、迷ったまま推測で作業を続けるか、何でも差し戻すかのどちらかに振れる(§4.2) |
| `## Agent tool の制約` の用途を「タスクの再委譲」に書き換える、または許可しない 1 項だけを残す | ユーザーが全役割で Agent Tool を否にすると決めた(D8) |
| Agent Tool の廃止に合わせて subagent-start フックを変える | tools を宣言していない利用者の定義に対して、注入を続ける必要がある(D8-5) |
| 担当表の「Agent Tool」列を残し、すべて否にする | 列の意味が無くなる(D8-2) |
| `automaticKeep` を変え、廃止した節と外した `Agent` を保持の対象から除く | 既存の保持の仕組みに役割の知識を持ち込む。0.20.1 の節の削除と同じく、案内で足りる(§4.8) |
| 廃止した役割 ID を `RETIRED`(定義名の一覧)に足す | 定義名で照合するため、旧 ID のマーカーを検出できない(§3.3-8、§4.10) |
| effort を `compose.ts` で決める | `ComposeInput` に `modelId` を戻すことになる。0.19 で除去した依存を復活させる(§4.5) |
| CLI に `--effort` フラグを足し、利用者が段を上書きできるようにする | 要件に無い。表に無い段が要る利用者は、生成後に frontmatter を編集すれば保持マージで残る |
| effort を `--list-coverage` や `--check` の応答に項目として足す | 要件に無い。差分は `frontmatter.changed` と生成物で確かめられる |
| 規律の起動形態の判定表の許可一覧を変えず、`effort` を持つ定義を非合成にする(第 2 版の案) | 生成した Claude のモデルの定義が合成の対象から外れる。合成は専用エージェントを持つプラグインとの併用を想定したもので、プロジェクトに最適化された定義を優先する考え方に反する(ユーザー決定 2026-09-29。§4.7) |
| 許可一覧に `disallowedTools` も足す | 要件に無い。現状のままとする(§4.7) |
| 表に無い組に既定の段(例: medium)を出す | 要件は「表に無い組は出さない」である。セッションの既定に任せる |
| 複数役割の定義で最も低い段を採る | 要件は最も高い段である。重い役割の作業で段が足りなくなる |
| 5 軸に変更量の基準を併存させる | 要件で変更量による振り分けを適用しないと決まっている |
| このリポジトリの再生成に保持マージを使い、生成後に tools と節を手で直す | 0.20 の T16 で手直しが要った(0.20 の実装計画書 §7-4)。保持マージを使わなければ手直しが要らない |

## 10. 未解決事項

1. **en 断片の文言。** ja と同じ要点を満たす範囲で、実装時に prompt-smith の規律で決める。この事項は実装時に決めるものであり、着手を止めない。

`complex-review` の label(§4.1)、廃止した役割 ID の通知の形(§4.10。`RETIRED_ROLES` を足す)、effort の frontmatter の位置(§4.5)、`## Agent tool の制約` の扱い(D8)は確定した。

## 11. Done 条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が対応する `src/` の変更と同じコミットにある。
- `plugin.json` と `package.json` がともに `0.21.0-dev` である。
- `ROLES` が 13 件で §5.1 の並びになり、担当表も 4 列 13 行で一致し、`discipline-role-table.test.ts` が通る。
- `assets/roles/{ja,en}/` に `complex-review.md` があり、`design-plan.md` / `advisor.md` / `final-review.md` / `gate-review.md` が無い。
- `src/` に `SOLO_DENIED_ROLES`・`allowsAgentTool`・`advisorHeading`・`agentConstraintHeading` が無い。生成したどの定義の tools にも `Agent` が無い。
- 検証の grep(実装計画書 T9)の結果が、テストの否定の検査と README の移行節だけである。
- `RECOMMENDED` / `ASSIGNMENTS` / `EFFORT` が §5.2 / §5.3 の表と一致する。
- 生成した定義の frontmatter で、`effort` が `model` の直後にあり、表に無い組と haiku の組には無い。複数役割の定義は最も高い段を持つ。
- 規律の起動形態の判定表の順 3 の許可一覧に `effort` があり、`disallowedTools` が無い。
- 規律に 5 軸と 4 役割の条件、決定 (a)(b)、差し戻しの経路、`AskUserQuestion` で聞く条項、「サブエージェントに Agent Tool を許可しない」の 1 文があり、advisor・design-plan・再委譲への言及が無い。
- `normal-impl` と `light-impl` の断片(ja / en)の Output Format に各箇所の検査結果があり、`light-impl` の `## 制約` に委譲しない 3 つがある。
- SessionStart が、廃止した役割 ID を宣言した定義を通知する。
- `wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計が 30,720B 以下である。
- プラグイン README に 13 種の役割表、5 件の MCP 既定列挙、effort の注記、移行節「0.20 系から 0.21 系へ」がある。ルート `README.md` の役割数が 13 種で、「アドバイザー運用」が無い。
- `.serena/memories/` が 0.21 の内容に追随している。
- このリポジトリの `.claude/agents/` が §5.14 の表どおりで、旧 ID のマーカーと tools の `Agent` が残っておらず、再生成の前後で `disallowedTools` と MCP の行が失われていない。
- 実機確認で、生成した外部モデルの定義の effort(low と medium)が、プロキシから上流へ `reasoning.effort` として届くことを確かめた記録がある。`xhigh` が未確認であることも記録されている。
- 変更を実装計画書の方針で分けてコミットしている。
