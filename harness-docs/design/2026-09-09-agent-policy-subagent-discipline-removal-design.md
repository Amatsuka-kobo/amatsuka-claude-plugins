# agent-policy 規律断片の廃止と SubagentStart の対応表専用化 設計書

> **本設計書は `harness-docs/design/2026-09-09-agent-policy-profile-unification-design.md` へ統合された。単独では実施しない。**

- 作成日: 2026-09-09
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.17.1-dev` → `0.18.0-dev`(§6.9)
- 状態: 設計(実装前・第 1 版)
- 入力: `.claude/context-maps/2026-09-09-subagent-discipline-removal.md`
- 関連: `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`(帯カタログの集約。本設計が §6.2 と §6.3 を上書きする)、`2026-08-31-agent-policy-two-profile-design.md`(2 プロファイル化)、`2026-08-27-agent-policy-external-agent-model-assignment-design.md`(二段フックの採用経緯)

## 1. 上書きする決定

本設計は、既存の設計書で確定した決定のうち次を**明示的に上書きする**。既存の設計書そのものは編集しない。上書きの記録はこの節が正本である。

### 1.1 `2026-09-09-agent-policy-band-catalog-consolidation-design.md` §6.3(L252-264)

| 箇所 | 元の決定・記述 | 本設計の決定 | 根拠 |
| --- | --- | --- | --- |
| L254 | 「**決定: `references/subagent-discipline.md` L10 は変更せずに残す。**」 | ファイルごと削除する。SubagentStart は役割マーカー対応表だけを `additionalContext` として返す | §6.1 |
| L260 | 「したがって L10 を削除すると、この規律がサブエージェントへ届く経路が**完全に消える**。」 | **事実誤認として訂正する。** 「完全に消える」は成り立たない | 反証 2 点を下に示す |
| L262 | 「文言も 1 行に圧縮済み(…)であり、追加の削減余地は無い。」 | 本改修は文言の削減ではなく配布経路の一本化である。削減余地の有無は判断の対象にしない | §6.1 |
| L694(§8 影響ファイル) | `subagent-discipline.md` を「無変更」として列挙 | 削除対象として扱う | §8 |
| L768(§9.3 既存テストへの影響) | 「`subagent-start.test.ts` L230 は `references/subagent-discipline.md` の存在に依存するが、同ファイルは無変更」 | 同ファイルが消えるため、断片に依存する 13 ケースを個別に処理する | §9 |
| L778(§9.4 サイズの検証) | `wc -c` の対象に `subagent-discipline.md` を含める | 対象から外し、残る 2 本の合計で要件 8 の上限を測る | §6.8 |

**L260 への反証 1(静的経路の存在)。** `assets/roles/ja/explore-lead.md` L21 は「短命な探索実働(grep/read の反復)は、独立した範囲ごとに 1 メッセージ内で並列に再委譲する。委譲先には「ファイルを変更しない」「報告のみを返す」を明記する。」を持つ。`subagent-discipline.md` L10 と同じ規定であり、`setup-agents` が生成する `explore-lead` 役割の定義本文へ焼き込まれる。したがって少なくとも `explore-lead` 役割については、L10 を削除しても経路が残る。

**L260 への反証 2(現に届いていない実証)。** `src/hooks/__test__/subagent-start.test.ts` L465-486 は、112 定義の対応表(9,500 字超)を置いた条件で `expect(context).not.toContain("- 起動したアドバイザーに Agent tool を許可せず")` を固定し、コメントに「対応表を優先して残す設計判断の帰結であり、規律要約が落ちるのは意図された縮退である。」と書く。断片は `MAX_CONTEXT_CHARS = 9500` の切り詰めで after 側から落ちる設計であり、対応表が大きいプロジェクトでは規律行が**現に届いていない**。断片は「確実な配布チャネル」ではなく「対応表に余りがあれば載る配布チャネル」である。

**対の実装計画との関係。** `harness-docs/plans/2026-09-09-agent-policy-band-catalog-consolidation-implementation.md` は L154 / L321 で「`references/subagent-discipline.md` が無変更であること」を Done 条件に据えるが、同計画は既に完了・コミット済みである(`a01c39d`「帯カタログを共通規律へ集約し、方針スキルから担当表を削除する」、`183774d`「役割の区分を指す語を「帯」から「役割」へ改める」。`plugin.json` は `0.16.0-dev` → `0.17.0-dev` → `0.17.1-dev`)。その Done 条件は当該計画の完了時点で満たされている。本改修はその後に行う別の変更であり、遡って破らない。着手順序の調整は不要である。

### 1.2 同設計書 §6.2(L250)—— SKILL.md の所在案内 1 文

| 箇所 | 元の決定 | 現状 | 本設計の扱い |
| --- | --- | --- | --- |
| L250 | 「表の所在を指す 1 文を冒頭に置き、既存の L10「共通規律を併せて読み、これに従う」と合わせて到達性を担保する。」 | 両 SKILL.md からその 1 文が削除済み。`claude-model-policy/SKILL.md` L10 と `custom-policy/SKILL.md` L10 はいずれも「`../../references/orchestration-discipline.md` を併せて読み、これに従う。」だけである(ユーザーが自ら適用した確定事項) | **決定を上書きし、所在案内を置かない状態を正とする。** 本設計は SKILL.md の文面を変更しない |

**到達性の評価(既に適用された状態の妥当性)。** 「共通規律を併せて読み、これに従う」だけで担当表へ到達する。理由は 3 つある。

- 共通規律は全文を読ませる前提の文書である(規律 L1-3 が読者を宣言し、両 SKILL が「併せて読み、これに従う」と指示する)。節を名指しして誘導する必要がない。
- `## 担当表` は共通規律の**先頭の節**(L5)である。冒頭から読む読者は所在案内より先に表へ到達する。
- 所在案内は見出し名を写した参照であり、見出しを改名するたびに 2 つの SKILL へ追随が要る。実際、`## 役割` → `## 担当表` の改名によって両 SKILL の参照が一度壊れた。削除により参照ずれの発生源そのものが消える。

対価は、共通規律の他の節から読み始めた読者が担当表の所在を知る手掛かりを失うことだが、共通規律本文は担当表を「担当表の」という語で 12 箇所参照しており、同一文書内の検索で解決する。

## 2. 背景と目的

`references/subagent-discipline.md`(11 行 / 919 B)は SubagentStart フックが読み込み、`<!-- marker-table -->` 行を役割マーカー対応表で置換してサブエージェントへ注入する断片である。二段フック方式の採用理由は「対応表の解決がメインセッションに留まり、子・孫の再委譲で同じ role map を前提にできなかった」ことであり(`2026-08-27-agent-policy-external-agent-model-assignment-design.md` §5 L141-149)、P0 は role map の全階層伝播だった。**規律の配布は断片の主目的ではなく、対応表の配布への相乗りである。**

現在、この断片が持つ 5 条項はすべて他の文書に対応を持つ(§4.2)。断片は同じ規律の 4 つ目の写しであり、切り詰めで落ちうる不確実な写しでもある。本改修は写しを 1 つ減らし、規律の配布を「起動側が依頼文へ転記する」経路へ一本化する。対応表の配布は SubagentStart に残す。

## 3. 確定済みの要件(オーケストレーター確定。本設計はこれを前提とし、覆さない)

1. `plugins/agent-policy/references/subagent-discipline.md` を削除する。
2. `src/hooks/subagent-start.ts` を、役割マーカー対応表のみを `additionalContext` として返す形へ改める。断片の読み込み・`<!-- marker-table -->` 置換・前後セクションの合成に関わる実装を削除する。注入のスキップ条件(対象 agent の `tools` が `Agent` を含まない場合、ビルトイン `Explore` / `Plan` の場合)と `isCustomInjection` による custom 系判定は維持する。切り詰めの扱いは設計判断とする。
3. `references/orchestration-discipline.md` の条項 1(再委譲先は対応表優先)と条項 4(読み取り再委譲時の明記)を、主語「サブエージェントは」の形へ整備する。
4. 起動側(オーケストレーター、および再委譲するサブエージェント)が依頼文へサブエージェント向け規律を転記することを、規律上の義務として明示する。
5. 断片に依存するテストを個別に処理する。
6. プラグイン README とルート README の SubagentStart 記述を実体へ追随させる。
7. `plugin.json` と `package.json` のバージョンを揃えて上げる。

**採用する方針は「案 A: 断片ファイルのみ廃止し、SubagentStart フックは対応表の注入専用として残す」である。** フックごとの廃止(案 B)は不採用である(§11.1)。

## 4. 前提(実測)

### 4.1 コードの現況

| 箇所 | 内容 |
| --- | --- |
| `src/hooks/subagent-start.ts` L16 | `const MAX_CONTEXT_CHARS = 9500` |
| 同 L17 | `const MARKER_LINE = "<!-- marker-table -->"` |
| 同 L18 | `const NO_MARKERS = "対応表なし(このプロジェクトに役割マーカー付き定義は無い)"` |
| 同 L42-46 | `interface ContextSections { before, table, after }` |
| 同 L192-198 | `fragmentLines()` |
| 同 L200-222 | `composeSections()` |
| 同 L224-226 | `render()` |
| 同 L228-253 | `truncateContext()`。after → before → table の順に削り、表は先頭 2 行を残す |
| 同 L255-270 | `readFragment()`。`CLAUDE_PLUGIN_ROOT/references/subagent-discipline.md` を同期読込。失敗時 `undefined` |
| 同 L272-276 | `bundledAgentsDir()`。`CLAUDE_PLUGIN_ROOT/agents` を返す |
| 同 L298-302 | 表の生成 → 断片の読込 → 合成 → 切り詰め |
| 同 L5 / L6 | `import fs from "node:fs"` / `import path from "node:path"` |
| `src/hooks/marker-scan.ts` L188-217 | `markerTable()`。3 フック共通の正本 |
| 同 L208 | 表の冒頭行「次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは依頼内容に近いものを選ぶ。」 |
| `src/hooks/delegation-gate.ts` L355 | `if ("agent_id" in result.input) return`。サブエージェントには発火しない |
| `hooks/hooks.json` L28 | `delegation-gate` の matcher は `Edit\|Write\|NotebookEdit\|mcp__.*`。**`Agent` を含まない** |
| `hooks/hooks.json` L38 | `parallel-nudge` の matcher は `Task\|Agent`。`additionalContext` を返す |
| `plugins/agent-policy/agents/` | **空ディレクトリ**。`bundledAgentsDir` の走査は常に 0 件 |
| `.claude/agents/`(本リポジトリ) | 11 定義 |

**`fs` の使用箇所は `readFragment()` 1 箇所だけである(L262)。** `path` は `readFragment()` L263 と `bundledAgentsDir()` L275 の 2 箇所で使う。

**`plugins/agent-policy/agents/` が空である事実の評価。** `bundledAgentsDir()` と `exactMatches()` の `agent-policy:${agent.name}` 分岐は現状 0 件を返すが、`CLAUDE_PLUGIN_ROOT` の必要性はこの走査が担っており、断片の読込を消しても環境変数は不要にならない。本改修は同梱定義の走査に手を付けない。同梱定義を持たない方針は共通規律 L89「このプラグインは Agent 定義を同梱しない」と整合しており、走査の削除は別件である(§12-3)。

### 4.2 5 条項と現在の到達経路

| # | `subagent-discipline.md` の条項 | `orchestration-discipline.md` | `assets/roles/ja/` | 断片削除後の到達経路 |
| --- | --- | --- | --- | --- |
| 0 | L3「あなたはサブエージェントである」 | L47(オーケストレーターの義務として) | `_common.md` L7 | 依頼文(L47 が既に義務化)+ 生成定義 |
| 1 | L7 再委譲先は対応表の委譲先を優先 | L60(主語が「SessionStart フックが」) | 無 | 依頼文(§7.4 で主語整備)+ **`markerTable()` 冒頭行**(§6.7) |
| 2 | L8 アドバイザーは対応表 → `Fable` → 差し戻し | L55(逐語ほぼ一致) | `_common.md` L14 | 依頼文 + 生成定義 |
| 3 | L9 アドバイザーに Agent tool を許可せず「助言のみ」明記 | L57(逐語ほぼ一致) | `_common.md` L15 / L20 | 依頼文 + 生成定義 |
| 4 | L10 読み取り作業を実装役割へ再委譲するとき明記 | L51-53(主語が「オーケストレーターは」) | `explore-lead.md` L21 のみ | 依頼文(§7.3 で主語整備)+ 生成定義(explore-lead のみ) |
| 5 | L11 依頼文で指定されたスキルだけをロードする | L58 / L59(逐語一致) | `_common.md` L27-29 | 依頼文 + 生成定義 |

**対応なしの条項は無い。** 条項 1 と条項 4 だけが、現在の書き方では「サブエージェントは〜」で始まらないため転記の対象として識別できない。

### 4.3 文書の現況(変更対象行。working tree 基準)

`references/orchestration-discipline.md` には未コミット差分がある(`## 役割` → `## 担当表` の改名と表の整形)。以下は **working tree の内容**である。

| 行 | 現在の文言 |
| --- | --- |
| L3 | この文書の読者はオーケストレーターである。「サブエージェントは〜」で始まる条項は、依頼文への転記と、生成した定義の本文でサブエージェントへ届ける。 |
| L51 | - オーケストレーターは、担当表の「種別」が `readonly` の役割を `Write` / `Edit` を持つ定義へ委譲するとき、依頼文に次を明記する。合成して起動するときも同じである。 |
| L52 | &nbsp;&nbsp;- 使用してよい tools を読み取り系に限定すること(`Read` / `Grep` / `Glob`、読み取りに限った `Bash`、必要なら `WebSearch` / `WebFetch`) |
| L53 | &nbsp;&nbsp;- ファイルを変更しないこと、報告のみを返すこと |
| L54 | - オーケストレーターは、サブエージェントに方針スキルをロードさせない。必要な規律は依頼文へ転記する。 |
| L55-L59 | 「サブエージェントは、…」で始まる 5 条項 |
| L60 | - SessionStart フックが役割マーカーの対応表を注入したときは、その役割の委譲先を担当表より優先してその定義とする。同じ役割に複数あるときは依頼内容に近いものを選ぶ。 |

### 4.4 サイズの実測

| ファイル | 現状 |
| --- | --- |
| `references/orchestration-discipline.md` | 16,563 B |
| `references/context-map-guide.md` | 6,169 B |
| `references/subagent-discipline.md` | 919 B |
| 合計 | 23,651 B |

削除後は 22,732 B。§7.2-7.5 の加筆で約 +800 B(内訳は §7.5 末尾)、**約 23,530 B** となる。上限 30,720 B に対して余裕は約 7,190 B である。

### 4.5 テストの現況

`src/hooks/__test__/subagent-start.test.ts` は 5 describe / 27 の `it`・`it.each` ブロック / **展開後 38 ケース**である。

| describe | 展開後ケース数 |
| --- | --- |
| 定義照合と deny-list | 9 |
| 断片の合成 | 8 |
| 対応表の injection 判定 | 13 |
| 入力と出力 | 6 |
| 切り詰め | 2 |

`environment()`(L73-92)は `CLAUDE_PLUGIN_ROOT` に**実リポジトリの plugin root** を設定する。したがって大半のケースは実ファイル `references/subagent-discipline.md` を読む。テストが断片を自前で書き出すのは L226-240 の 1 ケースだけである。

**期待値が断片の内容・存在・文言に依存するケースは 13 件である**(No. 2 / 3 / 4 / 8 / 10 / 11 / 13 / 14 / 16 / 29 / 30 / 35 / 38。番号は §9.1 の一覧に対応する)。

### 4.6 変えない前提

- フックは fail-open。stdin parse 失敗・`CLAUDE_PLUGIN_ROOT` 未設定でも exit 0 で spawn を止めない。
- 注入の選別は deny-list。`tools` が定義済みで `Agent` を含まない定義と、ビルトイン `Explore` / `Plan` だけを外す。未知の `agent_type`・`tools` 欄なしは注入する。
- 注入文に方針スキル名を含めない。
- stdout は改行終端の JSON 1 行のみ。stdin タイムアウト 2 秒。
- `markerTable()` の文面と、SessionStart 側の対応表の出し方。
- `src/hooks/session-start.ts` / `delegation-gate.ts` / `marker-scan.ts` / `parallel-nudge.ts` の実装。
- `assets/roles/` の全断片。`setup-agents` の挙動。
- `skills/claude-model-policy/SKILL.md` と `skills/custom-policy/SKILL.md` の文面(§1.2)。

## 5. 全体像

```
【変更前】規律がサブエージェントへ届く 3 経路
  (1) SubagentStart ─ references/subagent-discipline.md(5 条項)＋ 対応表
                       └ MAX_CONTEXT_CHARS で after 側から落ちうる
  (2) 生成定義本文 ── assets/roles/ja/_common.md(条項 0/2/3/5)
                       + explore-lead.md(条項 4)
  (3) 依頼文への転記 ─ orchestration-discipline.md L3 の宣言のみ。義務の主語が無い
                       条項 1 と条項 4 は「サブエージェントは〜」で始まらず射程外

【変更後】規律は (2)(3)、対応表は (1)
  (1) SubagentStart ─ 対応表のみ(custom 系)／「対応表なし」の固定文(それ以外)
                       └ 冒頭行が条項 1 と同内容を持つ
  (2) 生成定義本文 ── 変更なし
  (3) 依頼文への転記 ─ 5 条項すべてが「サブエージェントは〜」で始まり、
                       転記の義務がオーケストレーターと再委譲側の双方に明文である
```

## 6. 設計判断

### 6.1 廃止のスコープ —— 案 A(断片のみ廃止)

**決定: `references/subagent-discipline.md` を削除し、SubagentStart フックは対応表の注入専用として残す。**

案 B(フックごと廃止)を採らない理由は 3 つある。

- 対応表は実行時に `.claude/agents/` を走査して組み立てる**動的データ**である。文書に静的に書けないため、フックを消すと代替の配布手段が無い。
- `delegation-gate.ts` は L355 で `agent_id` を検知して return するため、サブエージェントには発火しない。`session-start.ts` はメインセッション専用である。**対応表がサブエージェントへ自動で届く経路は SubagentStart だけである。**
- フックを消すと `assets/roles/ja/_common.md` L14「対応表の「設計・計画・実装のアドバイザー」の役割の定義を使う」が参照先を持たなくなり、`assets/roles/` の改訂が連動する。案 A では連動しない。

### 6.2 非 custom 分岐の出力 —— `NO_MARKERS` の固定文を維持する

**決定: `isCustomInjection` が偽のときは、従来どおり `NO_MARKERS`「対応表なし(このプロジェクトに役割マーカー付き定義は無い)」だけを `additionalContext` として返す。注入を取りやめない。**

断片が消えると、このケースの `additionalContext` は 30 文字の固定文 1 行だけになる。無意味に見えるが、この 1 行には受け手の動きを変える働きがある。生成定義の `_common.md` L14 は「対応表の…定義を使う。プロジェクトに該当する定義があればその名前で、無ければ `model` 上書きで `Fable` を指定して起動する」と書く。「対応表なし」の固定文は、この分岐の前提を確定させ、`Fable` フォールバックへ直行させる。固定文が無ければ、サブエージェントは対応表の不在と注入の失敗を区別できない。

判断を左右する軸は「全 spawn に課金される 30 文字の固定費」対「対応表の不在を確定させる価値」である。前者は 1 spawn あたり 20 token 未満で、後者の分岐 1 回分の迷いより安い。

**注入そのものを取りやめる案は採らない。** 要件 2 が `isCustomInjection` による判定の維持を指定しており、注入の有無へ変えることは挙動変更である。またこの案は §9.1 の 6 ケース(No. 12 / 22-26)を無効化し、削除量が増える。

### 6.3 切り詰めの扱い —— 上限は維持し、実装を表専用へ縮める

**決定: `MAX_CONTEXT_CHARS = 9500` を維持する。`ContextSections` / `render()` / `truncateContext()` を廃し、表の行配列だけを扱う `truncateTable()` に置き換える。**

上限を撤廃しない理由は、対応表だけでも上限を超えうるという実測があることである。テスト L430-463 は 112 定義(14 役割 × 8)で対応表が 9,500 字を超えることを固定している。上限が無ければ、定義が多いプロジェクトでは全 spawn に数万字が載る。

`before` と `after` は常に空配列になるため、3 段の削り順(after → before → table)は表の後方行を削る 1 段へ縮む。先頭 2 行(冒頭の説明行と最初の役割行)を残す規則は維持する。上限値そのものを変える根拠は無いため据え置く。

### 6.4 条項 1 の主語整備

**決定: L60 を 2 行へ分け、オーケストレーター向けとサブエージェント向けを別々の条項にする。**

現行 L60 の主語は「SessionStart フックが」である。SessionStart はメインセッションでしか発火しないため、この文をそのままサブエージェントへ渡すと、対応表を SubagentStart から受け取ったサブエージェントには適用されないと読める。主語をフックから行為者へ移し、注入元を問わない条件文にする。

### 6.5 条項 4 の主語整備と「転記可能性」の要件

**決定: L51-53 のオーケストレーター向けブロックは維持し、サブエージェント向けの 1 行を独立して足す。参照ではなく 3 項目を書き下す。**

転記される条項は文書から切り出されて依頼文へ運ばれる。したがって**隣の箇条書きを参照する書き方はできない**。「直前の 2 項目を明記する」と書くと、転記された先で指示対象が失われる。オーケストレーター向けブロックとの重複は、この転記可能性の対価として受け入れる。

`assets/roles/ja/explore-lead.md` L21 は同等の規定を持つが、条件が「短命な探索実働」に限られ、`explore-lead` 役割の定義にしか入らない。共通規律側の条項はこれより広い(読み取りだけの作業一般)ため、両者は重複ではなく包含の関係にある。`explore-lead.md` は変更しない。

### 6.6 転記義務の明示と、対応表の転記義務

**決定 1: L3 は「サブエージェントに宛てた規律である」という範囲の宣言に留め、転記の義務は §モデル別役割の運用 の条項として書く。義務は 2 つに分ける。**

- オーケストレーター向け —— 起動するときに、その委譲に関わる「サブエージェントは〜」条項を依頼文へ転記する。
- サブエージェント向け —— 再委譲するときに、自身が受け取った「サブエージェントは〜」条項を依頼文へ転記する。

後者自体が「サブエージェントは〜」で始まるため、転記された先で自身も転記の対象になる。孫・曾孫へ規律が伝播する再帰的な性質を、追加の機構なしで得る。

既存 L54 の「必要な規律は依頼文へ転記する」は義務を述べているが、「必要な」に判断基準が無く、再委譲するサブエージェントを名指ししていない。要件 4 の言うとおり、これは新設ではなく明確化である。

**決定 2: 対応表そのものの転記義務は課さない。**

理由は 2 つある。

- 対応表は SubagentStart が spawn ごとに注入する。依頼文へも書けば同じ内容の二重配布になり、全 spawn の固定費が倍になる。
- 対応表は実行時に走査して作る動的データである。依頼文へ書き写すと親が受け取った時点のスナップショットが固定され、注入される最新の表と食い違いうる。注入を正本とし、写しを作らない。

SubagentStart が発火しない環境(Claude Code 2.0.43 未満)では対応表が届かないが、その場合の動きは既に L55 が「対応表に無いときは `Fable` にする」として定めている。明文として足すものは無い。

### 6.7 転記漏れの検知手段 —— 本改修では置かない

**決定: `PreToolUse: Agent` の nudge を新設しない。**

まず事実の確認として、**`delegation-gate` へは相乗りできない。** 同フックの matcher は `Edit|Write|NotebookEdit|mcp__.*` であり `Agent` を含まない。さらに L355 で `agent_id` を持つ入力を return するため、再委譲するサブエージェントには構造的に発火しない。相乗り先になりうるのは `parallel-nudge.ts`(matcher `Task|Agent`、`additionalContext` を返す)だけである。

そのうえで置かないと判断した理由は 3 つある。

- **条項 1 は転記漏れしても届く。** `markerTable()` L208 の冒頭行「次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは依頼内容に近いものを選ぶ。」は条項 1 と同内容である。表そのものが条項 1 を運ぶ。残る転記漏れの実害は条項 2/3/4/5 に限られ、生成定義を持つ委譲先には `_common.md` 経由で届く。露出するのはビルトイン `general-purpose` など定義本文を持たない委譲先だけである(§10)。
- **`parallel-nudge` に相乗りさせると両方の効きが落ちる。** 同フックは並列化という別の規律を運ぶ。1 つの注入文へ 2 つの規律を束ねる変更は、`2026-08-31-agent-policy-two-profile-design.md` §2.3 が「効果なし」と記録した「スキル本文の命令形強化・最優先宣言」と同じ形、すなわち同じ場所に文言を足して効果を期待する形である。
- **§2.3 の実測は文脈が異なるため、nudge が効かない証拠にはならない。** §2.3 が測ったのは「Claude が取ろうとしている行動(直接編集)の抑止」であり、そこでは deny だけが効いた。転記は抑止ではなく、依頼文へ項目を足す加算的な指示である。§2.2 は `additionalContext` が Claude に届くことを裏取り済みであり、加算的な指示が効かないという実測は**指定文書のいずれにも明示なし**である。つまり nudge は「効かないと分かっている」のではなく「効くかどうか分かっていない」。効くかどうか不明な機構を、実害の範囲も測らないうちに全 spawn の固定費として足さない。

判断を左右する軸は「転記漏れが実際に起きる頻度」である。これは実機運用でしか測れない。まず転記方式で 1 サイクル運用し、`general-purpose` への再委譲で条項 4 の明記が落ちる事例が観測されたら、そのときに `parallel-nudge` とは別の `PreToolUse: Agent` フックとして足す。この判断は §12-1 へ残す。

### 6.8 要件 8 の上限の測り方

`subagent-discipline.md` が消えるため、以後は `orchestration-discipline.md` + `context-map-guide.md` の 2 本合計で 30,720 B 未満を測る(§4.4)。`2026-09-09-...-consolidation-design.md` L778 の `wc -c` 対象から `subagent-discipline.md` を外す。

### 6.9 バージョン —— マイナーを上げる

**決定: `0.17.1-dev` → `0.18.0-dev`。**

保護パスの規則は「通常はパッチ(n3)を上げ、変更が多いときはマイナー(n2)を上げる。自動で上げるのはマイナーまで」である。本改修は次の点でパッチの範囲を超える。

- 配布物(`references/` のファイル)を 1 本削除する。
- 全サブエージェント spawn が受け取る `additionalContext` の内容が変わる。利用者から見える挙動変更である。
- 共通規律に条項を 4 行足し、既存 2 行の主語を変える。規律は利用者が読む契約である。

パッチは実装の内部に閉じる変更に使う。メジャーは人間へ確認する範囲であり、本改修は API 互換性を壊さないためメジャーには当たらない。

## 7. 各変更の詳細

### 7.1 `references/subagent-discipline.md` —— 削除

ファイルを削除する。変更前の全文(919 B / 11 行)は次のとおりである。

```markdown
# サブエージェントの規律

あなたはサブエージェントである。

<!-- marker-table -->

- 作業を再委譲するときは、対応表にある役割の委譲先を優先する。
- アドバイザーへ相談するときは、対応表の「設計・計画・実装のアドバイザー」の役割の定義を使う。対応表に無いときは `Fable` にする。`Fable` が起動できないときは相談せず、差し戻しで解決する。
- 起動したアドバイザーに Agent tool を許可せず、依頼文に「助言のみを返し、作業はしない」と明記する。
- 読み取りの作業を実装役割の定義へ再委譲するときは、依頼文に「ファイルを変更しない」「報告のみを返す」を明記する。
- 依頼文で指定されたスキルだけをロードする。方針スキルも、指定が無ければロードしない。
```

### 7.2 `references/orchestration-discipline.md` L3 —— 範囲の宣言に留める

**変更前**

```markdown
この文書の読者はオーケストレーターである。「サブエージェントは〜」で始まる条項は、依頼文への転記と、生成した定義の本文でサブエージェントへ届ける。
```

**変更後**

```markdown
この文書の読者はオーケストレーターである。「サブエージェントは〜」で始まる条項は、サブエージェントに宛てた規律である。
```

配布の手段は §7.5 の 2 条項が義務として述べる。L3 には識別の規則だけを残す。

### 7.3 同 L54 —— 転記の義務を分離する

**変更前**

```markdown
- オーケストレーターは、サブエージェントに方針スキルをロードさせない。必要な規律は依頼文へ転記する。
```

**変更後**

```markdown
- オーケストレーターは、サブエージェントに方針スキルをロードさせない。
```

第 2 文は §7.5 の条項へ移し、「必要な」を判別できる条件へ置き換える。

### 7.4 同 L60 —— 条項 1 のオーケストレーター側

L60 を削除し、§7.3 の直後(オーケストレーター向け条項の群の末尾)へ次を置く。

**変更前**(L60)

```markdown
- SessionStart フックが役割マーカーの対応表を注入したときは、その役割の委譲先を担当表より優先してその定義とする。同じ役割に複数あるときは依頼内容に近いものを選ぶ。
```

**変更後**

```markdown
- オーケストレーターは、役割マーカーの対応表が注入されているとき、その役割の委譲先を担当表より優先してその定義とする。同じ役割に複数あるときは依頼内容に近いものを選ぶ。
```

主語をフックから行為者へ移し、「SessionStart フックが」という注入元の限定を外す。

### 7.5 同 §モデル別役割の運用 —— 4 条項の新設と並び順

現行 L55-L59 の「サブエージェントは、…」5 条項の**直前**に次の 4 行を挿入し、サブエージェント向け条項が連続したブロックになるようにする(転記する側が範囲を切り出しやすくするため)。1 行目だけはオーケストレーター向けなので §7.3 の直後、すなわち §7.4 の条項の前に置く。

**新設 1(オーケストレーター向け。§7.3 の直後)**

```markdown
- オーケストレーターは、サブエージェントを起動するとき、「サブエージェントは〜」で始まる条項のうちその委譲に関わるものを依頼文へ転記する。
```

**新設 2(サブエージェント向け。L55 の直前)**

```markdown
- サブエージェントは、再委譲するとき、自身が受け取った「サブエージェントは〜」で始まる条項を依頼文へ転記する。
```

**新設 3(条項 1 のサブエージェント側)**

```markdown
- サブエージェントは、再委譲するとき、役割マーカーの対応表にある役割の委譲先を優先する。同じ役割に複数あるときは依頼内容に近いものを選ぶ。
```

**新設 4(条項 4 のサブエージェント側)**

```markdown
- サブエージェントは、読み取りだけの作業を `Write` / `Edit` を持つ定義へ再委譲するとき、依頼文に「使用してよい tools を読み取り系に限定すること(`Read` / `Grep` / `Glob`、読み取りに限った `Bash`、必要なら `WebSearch` / `WebFetch`)」「ファイルを変更しないこと」「報告のみを返すこと」を明記する。
```

新設 4 の tools 列挙は L52 と逐語で揃える。両者が食い違うと、転記された条項と文書本体で異なる制約を読むことになる。

**変更後の §モデル別役割の運用 の並び**

```
L43-L46  (無変更)各モデルは担当表に従い… / 複雑または重要な実装 / 通常の実装 / 軽量な実装
L47      (無変更)サブエージェントを起動するとき、対象に「あなたはサブエージェントである」ことを明示する。
L48-L50  (無変更)オーケストレーターは、独立したタスクが… / Agent Tool 列… / 依頼文の冒頭で…
L51-L53  (無変更)オーケストレーターは、担当表の「種別」が readonly の役割を…(＋ 2 つの子項目)
L54      (§7.3)オーケストレーターは、サブエージェントに方針スキルをロードさせない。
新設 1   (§7.5)オーケストレーターは、サブエージェントを起動するとき、…転記する。
新設(§7.4) オーケストレーターは、役割マーカーの対応表が注入されているとき、…
新設 2   (§7.5)サブエージェントは、再委譲するとき、自身が受け取った…転記する。
新設 3   (§7.5)サブエージェントは、再委譲するとき、役割マーカーの対応表にある…
新設 4   (§7.5)サブエージェントは、読み取りだけの作業を Write / Edit を持つ定義へ…
L55-L59  (無変更)サブエージェントは、アドバイザーとして… / Agent Tool が許可されて… / 自身が起動した… / 依頼文で指定されたスキル… / スキルの指定がなければ…
```

**サイズの見積り。** L3 が約 −48 B、L54 が約 −39 B、新設 4 行が約 +875 B、L60 の書き換えが約 +10 B で、差引き **約 +798 B**。`orchestration-discipline.md` は約 17,361 B、`references/` の 2 本合計は約 23,530 B となる(§4.4)。

### 7.6 `src/hooks/subagent-start.ts`

**削除するもの**

| 対象 | 行 |
| --- | --- |
| `import fs from "node:fs"` | L5 |
| `const MARKER_LINE` | L17 |
| `interface ContextSections` | L42-46 |
| `fragmentLines()` | L192-198 |
| `composeSections()` | L200-222 |
| `render()` | L224-226 |
| `readFragment()` | L255-270 |

`import path from "node:path"`(L6)は `bundledAgentsDir()` が使うため残す。

**冒頭コメント L2-3**

変更前

```ts
// SubagentStart フック: Agent tool を持つ可能性があるサブエージェントへ、
// 役割マーカー対応表とサブエージェント向け規律を注入する。
```

変更後

```ts
// SubagentStart フック: Agent tool を持つ可能性があるサブエージェントへ、
// 役割マーカー対応表を注入する。
```

**`truncateContext()`(L228-253)を `truncateTable()` へ置き換える**

変更後

```ts
function truncateTable(table: string): {
  context: string
  truncated: boolean
} {
  if (table.length <= MAX_CONTEXT_CHARS) {
    return { context: table, truncated: false }
  }

  const lines = table.split("\n")
  let context = lines.join("\n")
  while (lines.length > 2 && context.length > MAX_CONTEXT_CHARS) {
    lines.pop()
    context = lines.join("\n")
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS)
  }
  return { context, truncated: true }
}
```

`NO_MARKERS` は 1 行なので `lines.length > 2` の条件で while に入らず、最終行の `slice` だけが働く。従来の `truncateContext` と同じ縮退である。

**`buildContext()` L293-308**

変更前

```ts
  if (denyReason !== undefined) {
    debug(env, "fragment-size=skipped table-size=skipped context-size=0")
    return undefined
  }

  const table = isCustomInjection(env.AMATSUKA_AGENT_AUTO_INJECTION)
    ? (markerTable(env, projectAgents) ?? NO_MARKERS)
    : NO_MARKERS
  const fragment = readFragment(env)
  const result = truncateContext(composeSections(fragment, table))
  if (result.truncated) report("truncated")
  debug(
    env,
    `fragment-size=${fragment?.length ?? 0} table-size=${table.length} context-size=${result.context.length}`
  )
  return result.context
```

変更後

```ts
  if (denyReason !== undefined) {
    debug(env, "table-size=skipped context-size=0")
    return undefined
  }

  const table = isCustomInjection(env.AMATSUKA_AGENT_AUTO_INJECTION)
    ? (markerTable(env, projectAgents) ?? NO_MARKERS)
    : NO_MARKERS
  const result = truncateTable(table)
  if (result.truncated) report("truncated")
  debug(
    env,
    `table-size=${table.length} context-size=${result.context.length}`
  )
  return result.context
```

`AMATSUKA_AGENT_SUBSTART_DEBUG` の出力から `fragment-size=` が消える。この文字列を期待するテストは無い(§9.1)。

**維持するもの** —— `resolveAgent()` / `exactMatches()` / `suffixMatches()` / `deniedBy()` / `matchDescription()` / `bundledAgentsDir()` / `readHookInput()` / `respond()` / `main()` は変更しない。deny-list、`isCustomInjection` 判定、`MAX_CONTEXT_CHARS = 9500`、`NO_MARKERS` の文言、stdout の形式もすべて変更しない。

### 7.7 `hooks/hooks.json` L2 —— description の追随(依頼文の要件に無い随伴修正)

**変更前**

```
"description": "agent-policy の運用補助: SessionStart で方針スキルの使用指示とエージェント定義の状態を注入し、SubagentStart でサブエージェントへ役割マーカーの対応表と規律を配布し、PreToolUse で保護対象への直接編集を差し止めて委譲を促す(既定は無効。環境変数で有効化する)ことと、サブエージェント起動時に並列 dispatch を促す",
```

**変更後**

```
"description": "agent-policy の運用補助: SessionStart で方針スキルの使用指示とエージェント定義の状態を注入し、SubagentStart でサブエージェントへ役割マーカーの対応表を配布し、PreToolUse で保護対象への直接編集を差し止めて委譲を促す(既定は無効。環境変数で有効化する)ことと、サブエージェント起動時に並列 dispatch を促す",
```

`hooks` 配列は変更しない。`hooks.json` は保護パスの「変更に慎重を要するパス」に挙がっており、変更後に新しいセッションで発火することを確認する(§13)。**この 1 箇所は §3 の要件 1-7 に含まれていない。** 記述が実体と食い違うため随伴修正として提案する。採否はオーケストレーターが判断する。

### 7.8 `plugins/agent-policy/README.md`

| 行 | 扱い |
| --- | --- |
| L11 | **変更不要。**「SessionStart フックと SubagentStart フックは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。」は実体と一致する |
| L13 | 変更する(下記) |
| L150 | 変更する(下記) |
| L236 | 変更する(下記) |
| L208 の直前 | 0.18 系の移行項目を新設する(下記) |

**L13**

変更前

```markdown
SubagentStart フックはサブエージェントの起動時に発火し、役割マーカーの対応表とサブエージェント向けの規律を注入します。Claude Code 2.0.43 より前のバージョンにはこのイベントが無いため、注入は行われません。
```

変更後

```markdown
SubagentStart フックはサブエージェントの起動時に発火し、役割マーカーの対応表を注入します。Claude Code 2.0.43 より前のバージョンにはこのイベントが無いため、注入は行われません。
```

**L150**

変更前(末尾 1 文)

```markdown
`custom` と旧互換値の設定では、SubagentStart フックもサブエージェントの起動時に対応表を注入します。
```

変更後(末尾 1 文を 2 文へ)

```markdown
`custom` と旧互換値の設定では、SubagentStart フックもサブエージェントの起動時に対応表を注入します。それ以外の値では、対応表が無いことを示す固定文だけを注入します。
```

断片が消えて固定文が `additionalContext` の全体になるため、非 custom 時に何が届くかを明記する。

**L236**

変更前

```markdown
12. SubagentStart フックは、サブエージェント起動時に役割マーカーの対応表とサブエージェント向けの規律を注入します。Claude Code 2.0.43 以降で動作します。
```

変更後

```markdown
12. SubagentStart フックは、サブエージェント起動時に役割マーカーの対応表を注入します。Claude Code 2.0.43 以降で動作します。
```

L236 は 0.13 系 → 0.14 系の移行項目である。当時の記述を史実として残すか、実体へ合わせるかは選択になるが、README の移行節は「移行時に確認すること」を書く場所であり、現行の挙動と食い違う記述を残すと誤読を生む。実体へ合わせる。

**移行項目の新設(§旧バージョンからの移行 の先頭、現行 L208 の直前)**

```markdown
0.17 系から 0.18 系へ移行する場合は、次を確認してください。

1. SubagentStart フックが配布していたサブエージェント向けの規律断片(`references/subagent-discipline.md`)を廃止しました。同フックが注入するのは役割マーカーの対応表だけになります。規律は、サブエージェントを起動する側が依頼文へ転記します。共通規律 `references/orchestration-discipline.md` の「サブエージェントは〜」で始まる条項がその対象です。
2. 共通規律に「サブエージェントは〜」で始まる条項を 3 つ足しました。再委譲時の転記、再委譲先を対応表から選ぶこと、読み取りだけの作業を `Write` / `Edit` を持つ定義へ再委譲するときの明記です。従来これらは規律断片またはオーケストレーター向けの条項として書かれていました。
3. 役割 ID・役割断片・生成される Agent 定義・フックの登録は変更していません。setup-agents の再実行は不要です。
```

### 7.9 ルート `README.md` L113

**変更前**(該当箇所のみ)

```markdown
サブエージェントの起動時には SubagentStart フックが同じ対応表とサブエージェント向けの規律を配布し、再委譲の階層でも役割の解決が揃います。
```

**変更後**

```markdown
サブエージェントの起動時には SubagentStart フックが同じ対応表を配布し、再委譲の階層でも役割の解決が揃います。
```

L113 の他の文(`AMATSUKA_AGENT_AUTO_INJECTION` の値、SessionStart の説明、旧値の扱い)は変更しない。

### 7.10 バージョン

| ファイル | 変更前 | 変更後 |
| --- | --- | --- |
| `plugins/agent-policy/.claude-plugin/plugin.json` の `version` | `0.17.1-dev` | `0.18.0-dev` |
| `plugins/agent-policy/package.json` の `version`(L3) | `0.17.1-dev` | `0.18.0-dev` |

`plugin.json` の `description` は変更しない。SubagentStart への言及を含まないためである。

## 8. 影響ファイル

| ファイル | 変更 | 節 |
| --- | --- | --- |
| `plugins/agent-policy/references/subagent-discipline.md` | 削除 | §7.1 |
| `plugins/agent-policy/references/orchestration-discipline.md` | L3 / L54 / L60 の書き換え、4 行の新設 | §7.2-7.5 |
| `plugins/agent-policy/src/hooks/subagent-start.ts` | 断片関連の削除、`truncateTable()` への置換 | §7.6 |
| `plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts` | 5 ケース削除、8 ケース期待値差し替え、1 ケース新設 | §9 |
| `plugins/agent-policy/hooks/hooks.json` | description の 1 語(随伴修正の提案) | §7.7 |
| `plugins/agent-policy/README.md` | L13 / L150 / L236、移行節の新設 | §7.8 |
| `README.md`(ルート) | L113 | §7.9 |
| `plugins/agent-policy/.claude-plugin/plugin.json` | `version` | §7.10 |
| `plugins/agent-policy/package.json` | `version` | §7.10 |
| `plugins/agent-policy/scripts/subagent-start.mjs` | `pnpm run build` による再生成 | §13 |

**変更しないファイル** —— `build.ts`(entryPoints は `subagent-start` を名指ししたままにする。フックは残る)、`src/hooks/marker-scan.ts`、`src/hooks/session-start.ts`、`src/hooks/delegation-gate.ts`、`src/hooks/parallel-nudge.ts`、`assets/roles/` の全断片、`skills/` の全 SKILL.md、`src/setup-agents.ts`、`.claude/agents/` の 11 定義。

## 9. テスト方針

### 9.1 `src/hooks/__test__/subagent-start.test.ts` の 38 ケースの処理

| No. | describe | it のタイトル | 行 | 処理 | 内容 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 定義照合と deny-list | tools に Agent が無い project 定義には注入しない | L140-144 | 無変更 | `toBe("")` |
| 2 | 同 | tools に Agent を含む project 定義には注入する | L146-152 | 期待値差し替え | `toContain("あなたはサブエージェントである")` → `toContain("対応表なし")` |
| 3 | 同 | tools 欄が無い project 定義には注入する | L154-160 | 期待値差し替え | 同上 |
| 4 | 同 | 未知の agent_type には注入する | L162-166 | 期待値差し替え | 同上 |
| 5-6 | 同 | ビルトイン %s には注入しない(`Explore` / `Plan`) | L168-170 | 無変更 | `toBe("")` |
| 7 | 同 | 完全形一致を末段一致より優先する | L172-177 | 無変更 | `toBe("")` |
| 8 | 同 | 末段一致が複数の定義に当たるときは注入する | L179-186 | 期待値差し替え | No. 2 と同じ |
| 9 | 同 | block 配列の tools に Agent が無い project 定義には注入しない | L188-192 | 無変更 | `toBe("")` |
| 10 | 断片の合成 | サブエージェント宣言と対応表を含み policy スキル名を含まない | L196-206 | 期待値差し替え + 改題 | `toContain("あなたはサブエージェントである")` の 1 行を削除。`toContain(TABLE_INTRO)` / `not.toContain("agent-policy:")` / `not.toMatch(...)` は残す。タイトルを「対応表を含み policy スキル名を含まない」へ |
| 11 | 同 | アドバイザーは対応表を優先する規律を含む | L208-214 | **削除** | 期待値 `"対応表の「設計・計画・実装のアドバイザー」の役割の定義を使う"` は断片 L8 の部分文字列。断片削除で成立しない |
| 12 | 同 | custom 系で marker が 0 件なら対応表なしの固定文を含める | L216-224 | 無変更 | `toContain(NO_MARKERS)` は §6.2 の決定により成立し続ける |
| 13 | 同 | marker 行が無い断片の後ろへ空行 1 つで対応表を連結する | L226-240 | **削除** | `composeSections()` の marker 不在フォールバックを固定する。実装ごと消える |
| 14 | 同 | 断片ファイルが読めないときは対応表だけを注入する | L242-259 | 期待値維持 + fixture 簡素化 + 改題 | `expect(context).toBe(markerTable(...))` を**新仕様の中核アサーション**として残す。`CLAUDE_PLUGIN_ROOT: missingRoot` の上書きを外して既定の plugin root を使う。タイトルを「custom 系では対応表だけを注入する」へ |
| 15 | 同 | CLAUDE_PLUGIN_ROOT が未設定でも throw せず exit 0 | L261-265 | 無変更 | 検証の意味が「断片読込の失敗耐性」から「`bundledAgentsDir()` が undefined を返す経路の耐性」へ移るが、期待値 `not.toThrow()` は成立する |
| 16 | 同 | CLAUDE_PROJECT_DIR が未設定でも project 走査なしで注入を続ける | L267-274 | 期待値差し替え | `toContain("あなたはサブエージェントである")` を削除し、`toContain("対応表なし")` を `toBe(NO_MARKERS)` へ強める |
| 17 | 同 | custom 系 policy env で SessionStart と同一の対応表を注入する | L276-293 | 無変更 | `tableBlock()` が `TABLE_INTRO` から最初の空行までを切り出すため、断片の有無に依存しない。SessionStart 側の文面を変えないので成立し続ける |
| 18-21 | 対応表の injection 判定 | custom 系の %s では対応表を合成する(4 値) | L297-310 | 無変更 | `toContain(TABLE_INTRO)` |
| 22-26 | 同 | %s では対応表なしの固定文を合成する(5 値) | L312-326 | 無変更 | `toContain(NO_MARKERS)` / `not.toContain(TABLE_INTRO)`。§6.2 の決定により成立し続ける |
| 27-28 | 同 | %s を正規化して対応表を合成する(2 値) | L328-339 | 無変更 | `toContain(TABLE_INTRO)` |
| 29-30 | 同 | %s の分岐でも規律断片を配布する(`custom` / `none`) | L341-349 | **削除** | タイトルも期待値も規律断片の配布だけを対象にする。No. 18-26 が同じ 2 分岐を対応表の観点で既に覆う |
| 31 | 入力と出力 | stdin が不正な JSON なら exit 0 かつ stdout は空 | L353-355 | 無変更 | |
| 32 | 同 | stdin の JSON がオブジェクトでなければ exit 0 かつ stdout は空 | L357-359 | 無変更 | |
| 33 | 同 | EOF 済みの空入力は即座に parse 失敗として exit 0 | L361-372 | 無変更 | |
| 34 | 同 | EOF が来ないと 2 秒でタイムアウトして exit 0 | L374-405 | 無変更 | |
| 35 | 同 | agent_type が欠落または空文字なら未知の type として注入する | L407-417 | 期待値差し替え | 2 箇所の `toContain("あなたはサブエージェントである")` を `toContain("対応表なし")` へ |
| 36 | 同 | stdout には改行終端された JSON を 1 つだけ出す | L419-426 | 無変更 | `additionalContext` の内容を固定しない |
| 37 | 切り詰め | 複数役割の対応表を後方の役割行から削り先頭 2 行を完全に残す | L430-463 | 期待値維持 + fixture 簡素化 | `CLAUDE_PLUGIN_ROOT: missingRoot` の上書きを外す(断片を避ける目的の fixture が不要になる)。他のアサーションは 1 行も変えない。§6.3 の「上限を維持する」判断を固定するテストになる |
| 38 | 切り詰め | 実断片では対応表を優先して after 側の規律行を削る | L465-486 | **削除** | 「after 側」が存在しなくなるため目的が消滅する。**このケースが固定していた事実(大きな対応表の下では規律行が届かない)は、§1.1 の反証 2 として設計書へ移す。** 削除にあたり、`// 対応表を優先して残す設計判断の帰結であり、規律要約が落ちるのは意図された縮退である。` というコメントが記録していた設計意図は、対応表以外に落ちるものが無くなるため引き継ぐ先を持たない |

**集計** —— 削除 5(No. 11 / 13 / 29 / 30 / 38。ブロック数では 3)、期待値差し替え 8(No. 2 / 3 / 4 / 8 / 10 / 16 / 35 と、No. 14 の fixture 変更)、fixture のみ変更 1(No. 37)、無変更 24。変更後の展開ケース数は 38 − 5 + 1(§9.2)= **34**。

**describe 名の改題** —— 「断片の合成」は対象を失うため「注入内容の合成」へ改める。

### 9.2 断片の再混入を検出する負のテスト(新設 1 ケース)

`describe("注入内容の合成")` へ次を足す。

```ts
  it("規律断片の文言を注入しない", () => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])

    const context = additionalContext(
      invoke("marked", { AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    )
    expect(context).not.toContain("あなたはサブエージェントである")
    expect(context).not.toContain("依頼文で指定されたスキルだけをロードする")
  })
```

規律を `additionalContext` へ書き戻す変更が入ったときに落ちる。

### 9.3 共通規律の条項を固定する文書検査(推奨。採否はオーケストレーター)

`src/agents/__test__/discipline-role-table.test.ts` は `orchestration-discipline.md` を対象とする既存の文書検査テストである。ここへ、新設した 2 条項が存在することを確認するケースを足すことを推奨する。

```ts
  it("サブエージェント向けの再委譲条項を持つ", () => {
    const text = fs.readFileSync(DISCIPLINE_PATH, "utf8")
    expect(text).toContain(
      "- サブエージェントは、再委譲するとき、役割マーカーの対応表にある役割の委譲先を優先する。"
    )
    expect(text).toContain(
      "- サブエージェントは、読み取りだけの作業を `Write` / `Edit` を持つ定義へ再委譲するとき、"
    )
  })
```

判断を左右する軸は「文面の言い換えで落ちる脆さ」対「断片という機械的な保証を失った後、条項が消えても誰も気づかない状態を避けること」である。断片は実装が読むファイルだったため削除すればテストが落ちたが、共通規律の条項は人が読むだけで、消えても何も落ちない。脆さは前方一致の短い部分文字列に限ることで抑える。

### 9.4 サイズの検証

```bash
wc -c plugins/agent-policy/references/orchestration-discipline.md \
      plugins/agent-policy/references/context-map-guide.md
```

合計が 30,720 B 未満であること。`subagent-discipline.md` は対象から外す(§6.8)。

### 9.5 実装順序

1. テストを先に直す(§9.1 の削除・差し替え、§9.2 の新設)。この時点で `pnpm run test` は落ちる。
2. `src/hooks/subagent-start.ts` を §7.6 のとおり改める。テストが通る。
3. `references/subagent-discipline.md` を削除する。
4. `references/orchestration-discipline.md` を §7.2-7.5 のとおり改める。§9.3 を採るならここでテストを足す。
5. `hooks/hooks.json`(採用時)・README 2 本・バージョン 2 箇所を改める。
6. `pnpm run build` を実行し、`plugins/agent-policy/scripts/subagent-start.mjs` の差分を同じコミットへ入れる。
7. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / §9.4 を通す。

手順 1 と 2 の間でテストが落ちるのは想定内である。手順 3 を手順 2 より後に置くのは、断片が残っている間はテストが実ファイルを読んでしまい、差し替えた期待値が偶然通る/落ちる紛れを避けるためである。

## 10. リスクと受容

| # | リスク | 受容の理由・緩和 |
| --- | --- | --- |
| 1 | **ビルトイン `general-purpose` へ再委譲したとき、条項 2/3/4/5 が届かない。** 定義本文を持たないため `_common.md` 経路が無く、依頼文への転記だけが頼りになる | 断片が確実に届いていたわけではない(§1.1 反証 2)ため、失うのは「対応表に余りがあるときだけ届く」保証である。共通規律は「担当表の全役割はサブエージェントが担う」(L33)としており、`general-purpose` は担当表に定義が無い役割の受け皿にすぎない。転記の義務(§7.5 新設 1・2)を明文化することで代替する。転記漏れが実測されたら §12-1 で nudge を検討する |
| 2 | 転記は遵守依存であり、自動テストで検証できない | 実機での dispatch 検証(サブエージェントに受け取った規律を復唱させる)で確認する。過去に `docs/prompts/2026-08-27-agent-policy-subagent-start-verification-prompt.md` が同じ手法を使っている |
| 3 | 生成済みの `.claude/agents/*.md` は `_common.md` の旧文言のまま残る | 本改修は `assets/roles/` を変更しないため、生成済み定義と新規生成の定義に差は生じない |
| 4 | `hooks.json` の description を変えると全セッションの挙動が変わりうる | `hooks` 配列は変更しない。description はフックの登録内容に影響しない。変更後に新しいセッションで SubagentStart が発火することを確認する(§13) |
| 5 | 条項 1 の主語を「オーケストレーターは」へ変えたことで、注入元が SessionStart であるという情報が文面から消える | 「役割マーカーの対応表が注入されているとき」という条件は注入元を問わない。SessionStart はメインセッション、SubagentStart はサブエージェントという配布の内訳は README(§7.8 L150)と設計書が持つ |
| 6 | `MAX_CONTEXT_CHARS` に触れずに実装だけを縮めるため、上限が対応表専用の予算として妥当かを検証していない | 上限を変える根拠が無いため据え置く。表が上限を超えるのは 112 定義規模であり(テスト No. 37)、実プロジェクト(本リポジトリで 11 定義)では遠い |

## 11. 不採用案

### 11.1 案 B: SubagentStart フックごと廃止

断片・フック・テスト・`hooks.json` の SubagentStart ブロック・`build.ts` の entryPoint をまとめて落とす案。プラグインの表面積は最も小さくなる。

**不採用の理由。**

- 対応表は実行時に `.claude/agents/` を走査して組み立てる動的データであり、文書に静的に書けない。
- `delegation-gate.ts` は `agent_id` を持つ入力で return するためサブエージェントに発火せず、`session-start.ts` はメインセッション専用である。対応表がサブエージェントへ届く自動経路は SubagentStart だけである。
- 二段フックの P0 は「role map の全階層伝播」だった(`2026-08-27-...-model-assignment-design.md` §5 L141-149)。案 B はその P0 を放棄する。規律の配布は相乗りにすぎず、相乗りをやめることと本体をやめることは別である。
- `assets/roles/ja/_common.md` L14 が参照先を失い、`assets/roles/` の改訂が連動する。

### 11.2 案 C: 現状維持 + 主語整備のみ

条項 1 と条項 4 の主語を「サブエージェントは」へ揃え、断片は残す案。`2026-09-09-...-consolidation-design.md` §6.3 の決定と衝突しない。

**不採用の理由。** 同じ規律の写しが 4 つ(共通規律・断片・`_common.md`・`explore-lead.md`)のまま残る。うち断片は切り詰めで落ちうる不確実な写しであり、写しの数を減らさなければ「どれが正本か」という問いが残り続ける。オーケストレーターが案 A を確定させている。

### 11.3 非 custom 分岐で注入そのものを取りやめる

`isCustomInjection` が偽のとき `undefined` を返し、`additionalContext` を出さない案。

**不採用の理由。** §6.2 のとおり、`NO_MARKERS` は `_common.md` L14 の分岐を確定させる働きを持つ。取りやめると対応表の不在と注入の失敗を区別できない。要件 2 が `isCustomInjection` 判定の維持を指定しており、注入の有無へ変えることは挙動変更である。

### 11.4 `PreToolUse: Agent` の転記 nudge を同時に足す

§6.7 のとおり。`delegation-gate` へは matcher の都合で相乗りできず、`parallel-nudge` へ相乗りさせると 2 つの規律が 1 つの注入文に同居する。効果が未検証の機構を、実害の範囲を測る前に全 spawn の固定費として足さない。**この案は「効かないから不採用」ではなく「効くか不明なので先送り」である。**§12-1 に残す。

### 11.5 対応表そのものを依頼文へ転記させる

§6.6 決定 2 のとおり。二重配布による固定費の倍増と、スナップショットの陳腐化を招く。

### 11.6 過去に却下済みで再提案しない配布案

`CLAUDE.md` への焼き込み、反転注入、サイドカー割当マップ、派生定義の生成、`UserPromptSubmit` の毎ターン注入、system prompt の原文引用と名指し上書き、SubagentStart の fail-closed、allow-list による選別。いずれも過去の設計で却下済みである。

## 12. 未解決事項

1. **転記漏れの検知手段を後から足すかどうかの判断時期と基準。** §6.7 は「実機運用で 1 サイクル回し、`general-purpose` への再委譲で条項 4 の明記が落ちる事例が観測されたら検討する」としたが、何サイクルを観測期間とするか、誰がその観測を担うかを決めていない。
2. **`hooks/hooks.json` L2 の description 修正(§7.7)の採否。** §3 の要件 1-7 に含まれていない随伴修正である。実体と食い違う記述を残すか、同じコミットで直すかはオーケストレーターの判断とする。
3. **`bundledAgentsDir()` と `exactMatches()` の `agent-policy:` 分岐を残すかどうか。** `plugins/agent-policy/agents/` は空であり、共通規律 L89 は「このプラグインは Agent 定義を同梱しない」と書く。走査は常に 0 件を返す死んだ経路だが、削除すると将来の同梱定義に備えた設計が消える。本改修では触れないと決めたが、別件として起票するかは未決である。
4. **`plugins/agent-policy/README.md` L210 / L214 が共通規律の節を「「役割」節」と呼ぶ食い違い。** working tree の未コミット差分で見出しが `## 役割` → `## 担当表` へ改名されたことによる。本件が原因ではなく、本件のスコープ外である。同じ README を触るため随伴修正の候補になるが、§3 の要件に無いため決めない。
5. **`references/orchestration-discipline.md` L58 と L59 の重複。** L58「サブエージェントは、依頼文で指定されたスキルだけをロードする。方針スキルも、指定が無ければロードしない。」と L59「サブエージェントは、スキルの指定がなければどのスキルもロードせず、依頼文の記述だけで作業する。」は同じ規律を 2 通りに述べている。転記量を増やす要因だが、本件の要件に無いため統合しない。
6. **`.claude/agents/grok-researcher.md` が廃止済みとされながら定義として残り、対応表に出続けている件。** 本件のスコープ外である。
7. **`docs/chat/2026/0909/phyllis998/0831-custom-policy-recommended-model-analysis.md:233` が本日別セッションで「対象文書は SubagentStart の配布物として残す」と結論している。** 会話記録は履歴であり書き換えないが、本設計がこの結論を上書きしたことを記録に残すかは未決である。

## 13. 実施手順と Done 条件

§9.5 の順で実施する。Done 条件は次のとおりである。

- [ ] `plugins/agent-policy/references/subagent-discipline.md` が存在しない。
- [ ] SubagentStart が対応表(custom 系)または `NO_MARKERS` の固定文(それ以外)だけを `additionalContext` として返す。
- [ ] スキップ条件が従前どおり働く(`tools` に `Agent` が無い定義、ビルトイン `Explore` / `Plan`)。テスト No. 1 / 5-7 / 9 が無変更で通ることで確認する。
- [ ] `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` がすべて通る。
- [ ] `git diff --stat plugins/agent-policy/scripts` に `subagent-start.mjs` の差分があり、同じコミットに含まれている。
- [ ] `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` の `version` がともに `0.18.0-dev` である。
- [ ] `wc -c` で `references/` の 2 本合計が 30,720 B 未満である(§9.4)。
- [ ] `plugins/agent-policy/README.md` L13 / L150 / L236 と移行節、ルート `README.md` L113 が実体と一致する。
- [ ] `hooks.json` を変更した場合、新しいセッションで SubagentStart フックが発火し、対応表だけが注入されることを確認した。
- [ ] 実機での dispatch 検証で、依頼文へ転記した「サブエージェントは〜」条項がサブエージェントへ届いていることを確認した(リスク 2)。
- [ ] ARCHITECTURE に影響する変更があれば `/metatron:update` で追随させた。
- [ ] `.serena/memories/` の記述と食い違う箇所があれば更新した。
