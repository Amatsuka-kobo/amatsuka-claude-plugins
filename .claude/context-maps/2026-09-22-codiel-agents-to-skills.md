# Context Map: codiel の同梱 Agent 定義の撤去と役割マーカーによるディスパッチ

**作成日**: 2026-09-22
**作成者**: Opus 5 (1M context)(コードベース探索統括の役割)
**対象タスク**: codiel の同梱 Agent 定義 15 体を削除して指示文を Skills と参照断片へ移し、`/codiel:run` のディスパッチを「役割マーカーの対応表による役割解決」に切り替える設計のための探索。
**関連する ARCHITECTURE セクション**: レイヤー構造(`harness-docs/ARCHITECTURE.md:27-50`)、ディレクトリ構成と責務(同 `:52-84`)

---

## 1. 目的・スコープ

codiel が自前で抱えている 15 体の Agent 定義をやめ、フェーズ担当の指示内容を Skills と参照断片へ移す。ディスパッチは Agent 名の固定指定ではなく、セッションに注入された役割マーカーの対応表を引いて役割から委譲先を決める形に変える。狙いは、プロジェクト側で最適化されたモデル・MCP・本文が codiel の run にも届くようにすることである。

- スコープ内: `plugins/codiel/agents/` の撤去、Skills と `references/` への指示文の再配置、`orchestrating-runs` のディスパッチ規約の書き換え、周辺文書と metatron の登録簿の追随。
- スコープ外: 実装作業そのもの(この map は設計の入力)。Raguel MCP の変更。agent-policy への新しい RoleId の追加(必要と判定されたら §7 の論点として上げる)。`.codiel/` の state スキーマ変更。

## 2. 現在のコードベース構造

### 2.1 主要ディレクトリ構成

```
plugins/codiel/            0.8.0-dev
├── agents/                15 定義・合計 45,677 B(撤去対象)
├── skills/                17 本・合計 167,263 B(orchestrating-runs だけで 30,111 B)
├── commands/              init.md / run.md / test.md
├── hooks/hooks.json       PreToolUse×2 / SubagentStop / Stop
├── src/                   codiel-state.ts, codiel-state-cli.ts, hooks/*.ts
├── scripts/               バンドル出力(guard-bash / guard-write / stop-guard /
│                          subagent-stop / codiel-state / lib の 6 mjs + install-harness.sh)
├── raguel-mcp/            Raguel 評価 MCP(Agent 名への依存ゼロ)
└── docs/                  DESIGN.md, skill-flowcharts.md
```

`references/` と `assets/` は**まだ存在しない**。指示文の移し先として新設するなら codiel で初めての参照層になる。

### 2.2 重要なファイル一覧

| ファイルパス | 役割・内容 | 重要度 | 備考 |
|---|---|---|---|
| `plugins/codiel/skills/orchestrating-runs/SKILL.md` | ディスパッチの本体。Agent 名 31 箇所 | High | §2 フェーズ進行表 `:128-142`、§2.1 コミット規約 `:151-172`、§3 ディスパッチ規約 `:173-212`、§4 ドメインディスパッチ `:215-241` |
| `plugins/codiel/agents/*.md` | 15 定義 | High | 全定義が `model` 未宣言。撤去対象 |
| `plugins/codiel/docs/DESIGN.md` | §7 Agents(`:318-373`)・§8 Hooks(`:374-388`) | High | 権限設計の根拠が集約されている |
| `plugins/codiel/skills/{implementing,reviewing-diffs,scripting-tests,writing-test-specs,fixing-failures,running-regression-tests,fixing-review-findings,analyzing-issues,preparing-design-agendas,writing-design-docs,writing-dev-plans}/SKILL.md` | 本文に Agent 名 | Medium | 計 11 本。内訳は §5.1 |
| `plugins/codiel/src/hooks/subagent-stop.ts` | フェーズ成果物の存在検査 | Medium | `agent_type` / `agent_id` を読んでいない |
| `plugins/metatron/src/fixtures/section-reference-inventory.json` | `plugins/codiel/agents/` を 17 件登録(`:16-181`) | Medium | Agent 削除で V3 が 17 件 stale |
| `plugins/codiel/commands/test.md` | `codiel-tester` をディスパッチ(`:11`) | Medium | `/codiel:test` の単独経路 |
| `plugins/codiel/docs/skill-flowcharts.md` | フェーズ→ディスパッチ先のノード 5 箇所(`:645,647,648,649,651`) | Low | 他の `codiel-` 8 箇所は CLI 名 `codiel-state` |
| `plugins/agent-policy/src/agents/roles.ts` | RoleId 17 と既定 tools(`:1-141`) | High | 委譲先の能力の上限を決める |
| `plugins/agent-policy/references/orchestration-discipline.md` | 委譲先の候補・原本の確認の規律 | High | 24,227 B |

## 3. 関連モジュール・データフロー

**現行のディスパッチ経路**: `/codiel:run` → `orchestrating-runs` §2 のフェーズ進行表で担当 Agent 名を引く → §4 で「利用可能なエージェント一覧」を見て `codiel-implementer-X` / `codiel-reviewer-X` の実在を判定し、無ければ generic へ縮退 → Task ツールの `subagent_type` に `codiel-*` を固定指定 → §3 のテンプレート本文で「`<スキル名>` スキルを Skill ツールで起動」と指示 → Agent 定義の本文が「最初に `<スキル>` を読む」と重ねて命じる → スキル本文が実手順を供給する。

**移行後に想定される経路**: 役割マーカーの対応表(SessionStart / SubagentStart が注入)からフェーズ×観点に対応する RoleId の委譲先を引く → その定義名で dispatch → スキル本文を届ける(届け方は §7 論点 4)。

**hook 経路(現行・変更なし)**: 4 フックとも run state 駆動である。`guard-write` はフェーズと `run.state.domain` を根拠に `ask` を返し、ツール呼び出しの発行元 Agent を識別しない。`DESIGN.md:387` がこの設計意図を明文化している(「hooks はツール呼び出しの発行元エージェントを識別できないため、エージェント名ではなく宣言された domain を境界の根拠にする」)。`subagent-stop` は in_progress フェーズがちょうど 1 つのときだけ成果物の存在と非空を検査し、欠けていれば block する(`subagent-stop.ts:14-38`)。

**Raguel MCP と state**: `plugins/codiel/raguel-mcp/` と `plugins/codiel/src/codiel-state.ts` はいずれも Agent 名・`subagent_type` に依存しない(grep 0 件)。state が持つのはフェーズ 12・`domain?: string | null`(`codiel-state.ts:52`)・`domainMode?: "mapped" | "unscoped"`(同 `:43-47`)であり、ドメイン境界の根拠は宣言された `domain` の値である。

## 4. 既存の実装パターン・規約

- **層の位置づけ**: `agents/` は `skills/` `commands/` と同じ**指示層**である(`harness-docs/ARCHITECTURE.md:32`)。`references/` は参照層で、複数の指示から共有する規律と断片を置く(同 `:33`)。指示層は参照層を読んでよい(同 `:40`)。
- **他プラグイン名の禁止**: 指示層と参照層に他プラグインの名前を書かない。例外は `sandalphon` `codiel` `metatron` `gh-utility` の 4 者同士のみで、**agent-policy はこの例外に含まれない**(`harness-docs/ARCHITECTURE.md:50`)。
- **役割マーカーの宣言形式**: `.claude/agents/*.md` の frontmatter に `agent-policy-role: <RoleId>` を書く(例 `.claude/agents/general-explore.md:9`)。RoleId は 17 種、`kind` は `impl` / `readonly` の 2 値(`plugins/agent-policy/src/agents/roles.ts:1-27`)。
- **ツール制限がハーネスである**という設計原則。「できないことは暴走もできない」を明文の原則に置き、テスターが期待値を緩める経路・レビューアーが自分で直して自己承認する経路を権限レベルで塞いでいる(`plugins/codiel/docs/DESIGN.md:320-321, 370-372`)。
- テスト配置は `__test__/<対象>.test.ts`、プラグイン改修時は `plugin.json` と `package.json` のバージョンを揃えて上げる(リポジトリの rules)。

## 5. 変更の影響範囲

### 5.1 直接影響を受ける箇所

- `plugins/codiel/agents/` の 15 ファイル: 削除。
- `plugins/codiel/skills/orchestrating-runs/SKILL.md`: Agent 名 31 箇所。書き換えが集中するのは §2 フェーズ進行表の「担当エージェント」列(`:130-142`)、§2.1(`:153-154` が「Bash を持たないから」を前提にコミット責務を分配)、§3(`:176` が `subagent_type` 固定指定を規定、`:180` がテンプレート冒頭で「あなたは <エージェント名> として」と名乗らせる)、§4(`:217-219` の実在判定と generic 縮退、`:237` のドメイン非紐づけ Agent の列挙)。
- **本文に Agent 名を持つ 11 スキル**。大半は冒頭の「誰が使うスキルか」の 1 行(`analyzing-issues:10`、`preparing-design-agendas:10`、`writing-design-docs:10`、`writing-dev-plans:10`、`writing-test-specs:10,17`、`implementing:10`、`scripting-tests:10`、`running-regression-tests:10`、`fixing-failures:10`、`reviewing-diffs:10`)。実質的な記述は次の 6 箇所に限られる。
  - `writing-test-specs:87` / `implementing:62` / `scripting-tests:78`: Bash の有無でコミット責務が分かれる規律。
  - `reviewing-diffs:93`: 「観点ごとの具体的な確認項目は各 `codiel-reviewer-*` エージェント定義に記載する」— **Agent を消すと参照先が消える唯一の本文**。
  - `reviewing-diffs:72`: security 観点の severity 規律。
  - `fixing-review-findings:57`: push 後に `codiel-reviewer-*` を再ディスパッチする手順。
- **description に Agent 名を持つ 5 スキル**(全数確認済み。他に無い): `implementing:3` / `fixing-failures:3` / `reviewing-diffs:3` / `scripting-tests:3` / `running-regression-tests:3`。description の変更は発火に影響する。
- `plugins/codiel/commands/test.md:11`。
- `plugins/codiel/docs/DESIGN.md` §7 Agents 表(`:318-373`)と §8 Hooks 表(`:374-388`)。
- `plugins/codiel/docs/skill-flowcharts.md:645,647,648,649,651`。
- `plugins/metatron/src/fixtures/section-reference-inventory.json`: `plugins/codiel/agents/` のエントリ 17 件(ファイル 13 種。うち 4 種が分類 B「ドメインマップ」と分類 C「(ARCHITECTURE への言及)」の 2 件ずつ、残り 9 種が C のみ)。`codiel-test-designer.md` と `codiel-tester.md` は未登録。

### 5.2 間接的に波及する可能性がある箇所

- `plugins/metatron/src/__test__/section-reference-inventory.test.ts`: V2(`:131-145`)は実ファイルを走査して未登録の参照を検出し、V3(`:147-160`)は登録簿のエントリについてファイルの実在と参照の残存を検査する。Agent 15 ファイルの削除では**V2 は落ちず V3 が 17 件で落ちる**(`:151-153`)。`plugins/codiel/references/` に新規ファイルを置いて ARCHITECTURE の節を参照すると、走査対象が `["agents", "commands", "references"]`(`:69`)であるため**V2 が落ちる**。登録簿の自動生成コマンドは存在せず、手で編集して維持している(`plugins/metatron/package.json:6` の scripts は build のみ)。
- `plugins/codiel/src/hooks/subagent-stop.ts` と `hooks/hooks.json` の SubagentStop 行: 委譲先が汎用 Agent になっても run state 駆動なので機能は壊れないが、「どのサブエージェントの Stop か一意識別できない」ために in_progress が 2 つ以上のとき検査をスキップしている設計(`subagent-stop.ts:20-24`)の前提が、`agent_id` / `agent_type` を読めば変わりうる。
- `plugins/codiel/README.md:57,76` の説明文(「スキル/エージェント構成」「対応する Codiel エージェント」)。個別 Agent 名は無い。
- `.claude/agents/` の 14 定義。codiel の委譲先になる以上、Skill ツールの有無と MCP の有無が run の可否を左右する。

### 5.3 変更を避けるべき・最小限に留めるべき箇所

- `plugins/codiel/raguel-mcp/` と `plugins/codiel/src/codiel-state.ts`: Agent 名に依存していないので触る理由がない。
- `guard-bash` / `guard-write` / `stop-guard`: run state 駆動で Agent 非依存。ドメイン境界の根拠を `domain` 宣言に置く設計(`DESIGN.md:387`)は移行後もそのまま使える。
- `plugins/sandalphon/references/handoff-contract.md` と `plugins/sandalphon/skills/bridging-execution/SKILL.md`: codiel の Agent 名・「エージェント」の言及は**ゼロ件**。sandalphon との引き渡し契約はすでに Agent 名から切れている。
- ルート `README.md` の Codiel 節(`:68-72`)と関係節(`:143-149`): Agent 名の言及ゼロ。
- `plugins/codiel/settings.json`: `$schema` のみの実質空ファイル。

## 6. 守るべき既存契約・インターフェース

- **ツール制限がハーネスである**という契約(`DESIGN.md:320-321`)。特に「テスターは期待値とプロダクトコードを書けない」「レビューアーは Edit / Write を持たない」の 2 つは、権限レベルで利益相反経路を塞ぐという明示された設計意図である(同 `:352, 368-372`)。委譲先が汎用 Agent になると、この保証は tools 定義ではなく文面の規律に移る。
- **コミット責務の分配**(`orchestrating-runs:151-172`)。`codiel-architect` / `codiel-test-designer` / `codiel-planner` が Bash を持たないことを根拠に、文書系フェーズの成果物はオーケストレーターがコミットする。委譲先の Bash 保持状況が変われば、この分配の根拠も変わる。
- **hooks は Agent を識別しない**。`guard-write` の境界は `run.state.domain` の宣言値を根拠にする(`DESIGN.md:387`)。ただし SubagentStart / SubagentStop の stdin には `agent_id` と `agent_type` があり、`lib.ts` の戻り値型にもフィールドが存在する(`subagent-stop.ts` は読んでいない)。「識別できない」が真なのは PreToolUse であって SubagentStop ではない。
- **agent-policy 側の 2 条項**: `orchestration-discipline.md` の §委譲先の候補 が「他プラグインが同梱する定義は候補に含めない」、§原本の確認 が「dispatch に使われる実体と同一の定義を読めた確証が無いときはそのまま起動」。この 2 点により、現行の codiel 名指し dispatch にはプロジェクト最適化が届かない。
- **参照文書の 30KB 上限**。`orchestration-discipline.md:181` に「30KB を超えるものは、指定があってもロードさせず」とある(数値は「30KB」表記)。`orchestration-discipline.md` 24,227 B + `context-map-guide.md` 6,169 B = **30,396 B**、30,720 B まで**残り 324 B**。agent-policy 側へ条項を足す余地はほぼ無い。
- **parallel-nudge の注入文**(`plugins/agent-policy/src/hooks/parallel-nudge.ts:5-6`、`PreToolUse` の `matcher: "Task|Agent"` で毎回注入):
  > 並列 dispatch の確認: まだ着手していない独立タスクが残っているなら、後続のメッセージではなく、この dispatch と同じメッセージ内で並列に dispatch する。逐次にするのは前の出力に依存するときだけである。

  この文言は `plugins/agent-policy/src/hooks/__test__/parallel-nudge.test.ts:6-7` に全文がハードコードされ `:27-32` の `toEqual` で一致を検査している(二重管理)。codiel は §4 で「ドメイン別 implementer は 1 体ずつ逐次ディスパッチする」(`orchestrating-runs:238`)を要求しており、毎回の注入文と正面から衝突する。
- **Claude Code 側の仕様**(確認済み): Agent 定義 frontmatter の `skills:` は起動時にスキル本文をプリロードする。`tools` を明示列挙して `Skill` を省くと Skill ツールは使えない(プリロード分は使える)。スキル frontmatter の `context: fork` と `agent:` は agent 名を固定指定する。プロジェクト `.claude/agents/` の同名定義は plugin 同梱定義を上書きする。
- **metatron の登録簿**は A/B/C/D の 4 分類で、分類 A(節の中身に依存する参照)はゼロ件を維持する対象である(`section-reference-inventory.test.ts:122-129` の V1)。codiel の Agent エントリは B と C のみ。

## 7. 未解決事項・不明点

| # | 論点 | 影響度 | 上流報告先 | 現状の材料(判断はしていない) |
|---|---|---|---|---|
| 1 | 残す Agent の範囲(tester のみ / tester + test-designer / ゼロ) | High | 最上位オーケストレーター | 判断軸は「成果物が `.codiel/**` に閉じるか」「一般役割の kind と tools で表せるか」「固有 MCP が作業の本体か」。材料: `codiel-tester` は Read/Grep/Glob/Edit/Write/Bash + Playwright を要し、Playwright を持つ既定役割は無い。impl 役割の既定 tools は `Read,Grep,Glob,Write,Edit,Bash(,Skill)` で Bash を必ず含む(`roles.ts:35-77`)ため、Bash を持たない `codiel-test-designer` に合致する kind が無い。`.codiel/specs/**` への書き込み境界は `guard-write` が run state で見ており Agent 定義に依存しない |
| 2 | フェーズ × 観点 → RoleId の対応(init / discuss / design / test-spec / dev-plan / implement / test-loop A・B / review 6 観点 / fix-loop) | High | 最上位オーケストレーター | 現行の担当と tools は `orchestrating-runs:130-142` と `DESIGN.md:328-372` にある。RoleId 側は 17 種で `kind` は impl/readonly の 2 値(`roles.ts:1-27`)。review の 6 観点(frontend/backend/data/doc/security/generic)に対して review 系 RoleId は code-review / final-review / independent-review / doc-review / gate-review の 5 種あり、観点の軸(ドメイン別)と RoleId の軸(レビューの重さ・独立性)が直交していない |
| 3 | 対応表が注入されていないセッション(codiel 単体運用)での縮退先 | High | 最上位オーケストレーター | 現行の縮退は「利用可能なエージェント一覧に無ければ generic へ」(`orchestrating-runs:217-219`)。対応表は SessionStart / SubagentStart が注入するので、agent-policy 非導入の環境では表そのものが無い。§4 の実在判定は「一覧を見るだけで行い、`agents/` ディレクトリを探索しない」と明記されている |
| 4 | Skill ツールを持たない委譲先へスキル本文を届ける方法 | High | 最上位オーケストレーター | readonly 役割の既定 tools に `Skill` は無い(`roles.ts:83-131`。explore/e2e-verify/independent-review/code-review/final-review は `Read,Grep,Glob(,Bash)`、doc-review/gate-review/advisor は Bash も無い)。このリポジトリの `.claude/agents/` 14 定義でも Skill を持つのは document-writer / general-implementer / general-worker / lead-implementer / system-planner / technical-leader の 6 体のみ。選択肢として Agent frontmatter の `skills:` プリロード、ディスパッチプロンプトへの本文転記、`Read` でスキルファイルを読ませる指示がある。review フェーズは委譲先が readonly になる想定なので最も影響が大きい |
| 5 | SubagentStop hook の扱い(廃止 / `agent_type` で絞る / 維持) | Medium | 戦術オーケストレーター | 現行は run state だけで判定し `agent_type` を読まない(`subagent-stop.ts:14-38`)。in_progress が 2 つ以上のとき検査をスキップする理由が「どのサブエージェントの Stop か一意識別できない」(同 `:20-24`)。stdin には `agent_id` / `agent_type` があり `lib.ts` の型にも存在する。委譲先が汎用 Agent になると `agent_type` の値が `codiel-*` でなくなり、名前で絞る案は識別子の設計を伴う。`subagent-stop.ts` には**テストが 1 本も無い**(`src/hooks/__test__/` は guard-bash / guard-write / lib / stop-guard の 4 本のみ)ので、振る舞いを変えるなら先にテストが要る |
| 6 | 観点別・ドメイン別の内容の置き場(スキル本文へ統合 / `references/` の断片 / `assets/`) | High | 最上位オーケストレーター | 移す量は Agent 定義 45,677 B のうち固有部。`reviewing-diffs:93` が「観点ごとの具体的な確認項目は各 `codiel-reviewer-*` エージェント定義に記載する」と参照しており、削除するとこの参照先が消える。`reviewing-diffs/SKILL.md` は現在 8,525 B、6 観点分を統合すると肥大する。codiel には `references/` も `assets/` も無いため新設になる。`references/` へ置くと metatron の V2 が走査対象に含む(`section-reference-inventory.test.ts:69`)ので登録簿の追加が要る |
| 7 | codiel の指示層で agent-policy の名前を書けない制約の扱い | High | 最上位オーケストレーター | `ARCHITECTURE.md:50` が指示層・参照層での他プラグイン名を禁じ、例外は sandalphon / codiel / metatron / gh-utility の 4 者のみで agent-policy は含まれない。役割マーカーの対応表は agent-policy が注入する仕組みであり、codiel の SKILL 本文に「役割マーカーの対応表」と書けるか、書けるとしてどこまでが「名前」かの線引きが未定。ARCHITECTURE の例外に agent-policy を足す案は ARCHITECTURE 側の変更になる |
| 8 | agent-policy 側の追随(nudge 文言、優先順条項)を含めるか | Medium | 最上位オーケストレーター | parallel-nudge は `Task\|Agent` の PreToolUse で毎回注入され(`hooks.json:26,38-46`)、codiel の「implementer は 1 体ずつ逐次」(`orchestrating-runs:238`)と衝突する。文言を変えるなら `parallel-nudge.test.ts:6-7,27-32` のハードコード全文も揃える必要がある。参照文書の残量は 324 B しかないため、条項の追加は既存文の削減とセットになる |
| 9 | (探索で判明)`orchestrating-runs:218` の参照先が実体を失っている | Low | 戦術オーケストレーター | 「`initializing-harness/SKILL.md:53-55` と同型の判定を使う」とあるが、`initializing-harness/SKILL.md` の当該行は保護パスのヒアリング手順であり、同ファイル全 108 行に「利用可能なエージェント一覧」の語は 1 度も出現しない。Agent 実在判定の記述は `orchestrating-runs:217-219` の 1 箇所だけである。この設計で §4 を書き換えるなら同時に解消するか、別の対処が要る |
| 10 | (探索で判明)`DESIGN.md:387` の「hooks はエージェントを識別できない」が SubagentStop には当てはまらない | Low | 戦術オーケストレーター | PreToolUse には当てはまるが SubagentStop の stdin には `agent_id` / `agent_type` がある。論点 5 の前提に関わる |

## 8. テスト戦略・既存テスト

- 既存のユニットテスト(vitest): `plugins/codiel/src/hooks/__test__/` に guard-bash / guard-write / lib / stop-guard の 4 本、`plugins/codiel/src/__test__/codiel-state.test.ts`。`subagent-stop.ts` のテストは無い。
- `plugins/codiel/src/hooks/__test__/guard-write.test.ts:337` に Agent 名がコメントとして出てくるだけで、テストの assertion は Agent 名に依存しない。
- 横断の回帰は `plugins/metatron/src/__test__/section-reference-inventory.test.ts` の V1/V2/V3 が担う。Agent 削除は V3 を 17 件で落とし、`references/` の新設は V2 を落とす。登録簿の更新をコミットに含めないと `pnpm run test` が通らない。
- `plugins/codiel/evals/` は存在せず、Agent 定義の評価セットも無い(evals を持つのは sandalphon / metatron / prompt-smith)。description を変更する 5 スキルについて、発火の回帰を測る既存の仕組みが codiel には無い。
- 追加が望ましい方向: 論点 5 で SubagentStop の振る舞いを変えるなら先に `subagent-stop.test.ts` を起こす。ディスパッチ規約は文書なので自動テストが効かず、検証は実 run に依存する。

## 9. 依存関係・リスク・制約

- **権限保証の後退**: tools による構造的ハーネス(`DESIGN.md:320-321, 370-372`)が文面の規律に置き換わる。特に「tester が期待値を書けない」「reviewer が Edit / Write を持たない」は、汎用 impl 役割へ委譲すると tools レベルでは成立しなくなる。
- **Skill ツールの不在**(論点 4)は、review フェーズのスキル本文が委譲先に届かない形での失敗になりうる。プリロードも転記も使わない設計は成立しない。
- **ビルドは影響を受けない**。`plugins/codiel/build.ts:5-14` のエントリは 6 つ(guard-bash / guard-write / stop-guard / subagent-stop / codiel-state / lib)で、`agents/` はバンドル対象外。
- **バージョン**: codiel 0.8.0-dev。影響範囲が広いのでマイナーを上げる判断になる可能性がある(`plugin.json` と `package.json` を揃える)。
- **技術的負債**: 論点 9 の dangling reference。`harness-docs/GOTCHAS.md` は全 2 件(GOTCHA-001 / GOTCHA-002)で、codiel の dispatch や Agent 定義に関するエントリは無い。
- `.claude/context-maps` は `.gitignore:13` で追跡対象外。

## 10. 推奨アプローチ(高レベル)

1. 論点 1(残す Agent)と論点 2(RoleId 対応)を先に確定させる。この 2 つが決まらないと、指示文の移し先も縮退設計も書けない。
2. 論点 4(スキル本文の配送)は review フェーズで最初に破綻するので、対応表の設計より先に配送方式を決める。
3. 指示文の移設は「観点・ドメインの内容」と「ディスパッチ規約」を分けて扱う。前者は置き場(論点 6)、後者は `orchestrating-runs` の §2/§3/§4 に閉じる。
4. metatron の登録簿と V2/V3 は同一コミットで追随させる。削除と新設が同時に起きるため、片方だけ直すと必ず落ちる。
5. 論点 3(対応表が無いセッション)の縮退先を決めるまで、既存の generic 縮退を消さない。

## 11. 補足・暗黙知の可能性が高いポイント

- `codiel-` という接頭辞は Agent 名だけでなく同梱 CLI の `codiel-state` とも共有している。grep での棚卸しでは両者が混ざる(`skill-flowcharts.md` の `codiel-` 13 件のうち 8 件は CLI 名)。
- Agent 定義を消しても run の骨格は state と hooks に残る。壊れるのは「誰に投げるか」と「観点の中身をどこから読むか」の 2 点に限られ、ゲート・ドメイン境界・成果物検査は動き続ける。
- 15 定義すべてが `model` 未宣言であるため、現行でもモデルは親から継承している。移行で変わるのはモデルそのものより、プロジェクト側の定義本文と MCP 構成が届くかどうかである。
- 参照元として所在だけを挙げる 3 文書(要約は各 3 行以内):
  - `docs/chat/2026/0910/phyllis998/1155-codiel-agent-policy-compatibility.md`: 所見 F1〜F7 は `:31-37`(見出し `:29`)、案 A〜D は `:45`(`:47` に推奨 A+B+D)。役割経路と名指し経路の非互換、SubagentStop、転記条項、parallel-nudge の衝突、優先順未定義を扱う。
  - `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md`: §2.3 は `:66`(確定済みの前提。サブ項目 4 は `:71-75` で Agents→Skills の将来設計を予告)、§8 は `:311`(将来設計との関係)。独立した「§2.4」見出しは無い。
  - `harness-docs/design/2026-09-15-codiel-domain-map-decoupling-design.md`: §5.5 の見出しは `:297`「決定: 汎用担当エージェントを新設し、backend の兼任を解く」。「Skills 化のときに何が残り、何が消えるか」は節見出しではなく本文中の太字リード(`:322`)で、担当範囲と観点は Skill へ移り、消えるのは frontmatter と `subagent_type` による選択機構だとする。

---

**次のステップ提案**:

- この Context Map を基に設計書を作成してよいか。
- 特に確認してほしいのは論点 1・2・4・7 である。この 4 つが決まらないと設計の骨格が定まらない。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。API キー・トークン・パスワードなどの機密情報を記録しないこと。*
