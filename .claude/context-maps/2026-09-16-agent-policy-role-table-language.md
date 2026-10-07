# Context Map: agent-policy 役割マーカー対応表の言語不一致

**作成日**: 2026-09-16
**作成者**: Opus 5 (1M context)(コードベース探索統括の役割)
**対象タスク**: SubagentStart が注入する役割マーカー対応表は日本語ラベルで書かれる一方、`--lang en` で生成した Agent 定義は役割を英語で書くため、生成定義が対応表を照合できない。設計判断に必要な現状を洗い出す。
**関連する設計書**: `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md` §5.11c / §10-9

> この map は事実と出典だけを記す。設計案の推奨・採否は含めない。

---

## 1. 目的・スコープ

- 対応表の生成経路、対応表の文言を縛るテスト、生成定義側の役割表記、英語出力の純度検査、README の記述、および 3 案それぞれの影響範囲を、出典つきで確定させる。
- スコープ外: 設計判断そのもの、実装、テストの修正。

## 2. 対応表の生成経路

### 2.1 `markerTable`(唯一の生成箇所)

`plugins/agent-policy/src/hooks/marker-scan.ts:214-245`。両フックが同一関数を呼ぶ。

| 要素 | 出典 | 内容 |
| --- | --- | --- |
| 導入文(1 行目) | `marker-scan.ts:235` | `次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは依頼内容に近いものを選ぶ。` |
| スコープ行(2 行目) | `marker-scan.ts:207-212`, `:236` | `SCOPE_LINES[scope]`。`claude-only` / `with-external` の 2 値 |
| 役割行(3 行目以降) | `marker-scan.ts:241` | `` lines.push(`- ${labelOf(role)}: ${names.join(" / ")}`) `` |
| 定義名 | `marker-scan.ts:226-228` | vendor があれば `名前 (vendor)`、無ければ `名前` |
| 行の並び | `marker-scan.ts:238` | `sortRoleIds()`(= `ROLES` の定義順) |
| 役割 0 件 | `marker-scan.ts:232` | `undefined` を返す |
| サイズ上限 | `subagent-start.ts:16`, `:185-203` | `MAX_CONTEXT_CHARS = 9500`。超過時は `truncateTable` が**末尾の役割行から**削り、先頭 2 行は必ず残す。なお切り詰めるのは SubagentStart のみで、SessionStart に上限は無い |

ラベル解決は `roleLabel`(`marker-scan.ts:139-174`)。`roleById` で解決できない役割 ID は `.claude/agent-policy/roles/<id>.md` と `.claude/agent-policy/roles/*/<id>.md` の frontmatter `label` を読む。`roleLabels`(`:176-187`)はメモ化ラッパ。

### 2.2 注入するフック

| | SessionStart | SubagentStart |
| --- | --- | --- |
| 実装 | `src/hooks/session-start.ts` | `src/hooks/subagent-start.ts` |
| 注入物 | 方針スキル指示 + 対応表 + 未知役割通知 + 廃止定義通知(`:224-230`) | **対応表だけ**(`:242-247`) |
| スコープ決定 | `AMATSUKA_AGENT_AUTO_INJECTION` の値と、外部モデルの実在検証の結果(`:202-231`) | `AMATSUKA_AGENT_AUTO_INJECTION` の値のみ(`:215`, `candidateScopeFor`) |
| 対応表呼び出し | `:129`(claude-only) / `:141`(with-external) | `:211-220` |
| 起動対象の把握 | しない(入力に `agent_type` が無い) | する。`resolveAgent`(`:138-162`)が project / bundled 定義から対象を特定し、`buildContext`(`:228-232`)で保持 |

**言語を知る手立ては両フックに無い。** `src/hooks/` 配下の実装に `lang` の参照は 1 件も無い(grep による確認)。フックが読む環境変数は次の 6 つのみで、言語を表すものは無い。

- `CLAUDE_PROJECT_DIR`(`marker-scan.ts:89`, `session-start.ts:120`)
- `CLAUDE_PLUGIN_ROOT`(`subagent-start.ts:206`)
- `AMATSUKA_AGENT_AUTO_INJECTION`(`session-start.ts:211`,`:215`; `subagent-start.ts:215` 経由)
- `AMATSUKA_AGENT_SUBSTART_DEBUG`(`subagent-start.ts:46`)
- `AMATSUKA_AGENT_DELEGATION_GATE` / `AMATSUKA_AGENT_PARALLEL_NUDGE`(本件と無関係)

`hooks/hooks.json` はどのフックにも追加の env を渡していない。

### 2.3 `roles.ts` の役割定義

`src/agents/roles.ts:22-27`。

```ts
export interface Role {
  id: RoleId
  label: string
  kind: RoleKind
  tools: string[]
}
```

- **英語ラベルを持つフィールドは無い。** `label` は 17 役割すべて日本語(`roles.ts:30-133`)。
- `RoleId` は 17 値の文字列ユニオン(`roles.ts:3-20`)。すべて ASCII の kebab-case。
- 英語表記は `roles.ts` には存在せず、`assets/roles/en/<id>.md` の frontmatter `label` にのみ存在する(§4.2)。

## 3. 対応表の文言を検査しているテスト

### 3.1 `src/hooks/__test__/marker-scan.test.ts`

| 行 | 何を検査しているか |
| --- | --- |
| 20-21 | `TABLE_HEADING` 定数。導入文の全文リテラル |
| 302-309 | `roleLabel()` が `ROLES` の日本語 label を返すこと(`複雑または重要な実装` / `行き詰まり時のエスカレーション` / `E2E 動作検証・ブラウザ/GUI 操作` / `重要な実装の最終レビュー` / `設計書の最終ゲートレビュー` / `設計書・実装計画書(WBS)の作成` / `コードベース探索統括`) |
| **452-459** | **対応表全体を `toBe` で完全一致照合**。`- 通常の実装: gpt-terra-general-implementer (gpt) / grok-worker (grok) / local-implementer` と `- コードレビュー: sonnet-code-reviewer` の 2 行を含む。行の形式を変えれば必ず落ちる |
| 462-465 | スコープ行の文言 2 値(`それ以外の定義は委譲先にしない` / `外部ベンダーのモデルを指定した定義も含めて選んでよい`) |
| 483-485 | `lines[0]` が導入文、`lines[1]` がスコープ行で `- ` 始まりでないこと |

### 3.2 `src/hooks/__test__/session-start.test.ts`

| 行 | 何を検査しているか |
| --- | --- |
| 22-26 | `TABLE_INTRO` / `CLAUDE_SCOPE` / `WITH_EXTERNAL_SCOPE` の定数 |
| 233, 247, 405, 426 | 導入文を `toContain` |
| 384, 539, 557 | 導入文を `not.toContain` |
| 256-259, 266-269 | 導入文の**次行**がスコープ行であること |
| 235, 308, 653-654, 706, 732-733, 747 | 日本語ラベルを `toContain` / `not.toContain`(`複雑または重要な実装` / `コードベース探索実働` / `障害の切り分け`(プロジェクト断片) / `Ersteinschatzung`(言語別ディレクトリ)) |
| **665-675** | **行順検査。`- 複雑または重要な実装:` / `- その他のタスク:` / `- リアルタイム情報調査:` を `indexOf` で探し、大小を比較。ラベル直後のコロンを前提にしている** |

### 3.3 `src/hooks/__test__/subagent-start.test.ts`

> 注: 本ファイルは別の作業者が編集中(`ROLE_IDS`:21-36 と `placeBulkyRoleTable`:65-71)。以下はその 2 箇所に依存しない項目のみ。

| 行 | 何を検査しているか |
| --- | --- |
| 18-20 | `TABLE_INTRO` / `NO_MARKERS` の定数 |
| 136, 142, 146, 191, 219, 311 | `対応表なし(このプロジェクトに役割マーカー付き定義は無い)` の固定文 |
| 181, 265, 285, 325 | 導入文を `toContain` |
| 312 | 導入文を `not.toContain` |
| 288, 298 | スコープ行の文言 |
| **205** | `markerTable()` の戻り値と注入結果を `toBe` で完全一致照合(**生成側と同じ関数を期待値にするため、行の形式を変えても落ちない**) |
| **237** | SessionStart と SubagentStart の対応表ブロックが一致すること(同上) |
| 423-428 | 切り詰め時に 9500 文字以下であること、先頭 2 行が完全に残ること、役割行が先頭から順に残ること。ヘルパー経由で `ROLE_IDS` / `placeBulkyRoleTable` を参照している |

## 4. 生成定義側の役割表記

### 4.1 共通規律断片のパス

- `plugins/agent-policy/assets/roles/ja/_common.md`
- `plugins/agent-policy/assets/roles/en/_common.md`

役割別断片は同ディレクトリの `<RoleId>.md`(17 件)と、ベンダー別の `realtime-research.grok.md`。プロジェクト側は `.claude/agent-policy/roles/`(および `<lang>/` サブディレクトリ)。

### 4.2 17 役割の `RoleId` / ja / en 3 つ組

ja 列は `roles.ts` の `label` と `assets/roles/ja/<id>.md:3` の `label` の**両方**であり、両者は 17 件すべて一致する(`compose.test.ts:312-317` が一致を強制)。en 列は `assets/roles/en/<id>.md:3` の `label`。

| RoleId | ja(`roles.ts` = `ja/*.md`) | en(`en/*.md`) |
| --- | --- | --- |
| `complex-impl` | 複雑または重要な実装 | Complex or Critical Implementation |
| `normal-impl` | 通常の実装 | Routine Implementation |
| `light-impl` | 軽量な実装 | Lightweight Implementation |
| `escalation` | 行き詰まり時のエスカレーション | Escalation for Blocked Work |
| `general` | その他のタスク | General Tasks |
| `design-plan` | 設計書・実装計画書(WBS)の作成 | Design and Implementation Plan Authoring |
| `doc-writing` | 文書作成 | Document Authoring |
| `explore-lead` | コードベース探索統括 | Codebase Exploration Lead |
| `explore` | コードベース探索実働 | Codebase Exploration |
| `realtime-research` | リアルタイム情報調査 | Real-Time Research |
| `e2e-verify` | E2E 動作検証・ブラウザ/GUI 操作 | E2E Verification and Browser/GUI Operation |
| `independent-review` | 設計書・実装計画書の独立レビュー | Independent Design and Implementation Plan Review |
| `doc-review` | 設計書・実装計画書のレビュー | Design and Implementation Plan Review |
| `code-review` | コードレビュー | Code Review |
| `final-review` | 重要な実装の最終レビュー | Final Review of Critical Implementation |
| `gate-review` | 設計書の最終ゲートレビュー | Final Gate Review of Design Documents |
| `advisor` | 設計・計画・実装のアドバイザー | Design, Planning, and Implementation Advisor |

### 4.3 対応表を参照している条項(原文)

**ja/_common.md:14**(アドバイザー相談)

> - 対応表の「設計・計画・実装のアドバイザー」の役割の定義を使う。プロジェクトに該当する定義があればその名前で、無ければ `model` 上書きで `Fable` を指定して起動する。`Fable` が起動できないときは相談せず、差し戻しで解決する。

**en/_common.md:14**

> - Use the definition for the "design, planning, and implementation advisor" band. If the project has one, call it by name; otherwise start a subagent with a `model` override of `Fable`. If `Fable` cannot be started, do not consult; resolve by handing the question back.

**ja/_common.md:21**(文書作成への再委譲)

> - **ファイルとして残す文書**を書くときは、対応表に「文書作成」の定義があればその定義へ再委譲する。無ければ自分で書く(差し戻さない)。報告の本文は対象外であり、自分で書く。

**en/_common.md:21**

> - When you need to write a **document that is saved as a file**, re-delegate to the definition for the role labelled Document Authoring in the role marker table, if the table has one. If it does not, write the document yourself — do not hand the task back. The body of a report is out of scope; write it yourself.

照合の核心: どちらの条項も「対応表の中から、指定した**役割名**に一致する行を探し、その定義名を取る」ことを命じている。ja は対応表の実際の文字列(`設計・計画・実装のアドバイザー` / `文書作成`)と一致するが、en は `design, planning, and implementation advisor` / `Document Authoring` であり、対応表のどの行とも文字列一致しない。

### 4.4 対応表に依存しない役割参照(参考)

対応表ではなく、規律文書の**担当表**を参照する条項が別にある。

- `ja/design-plan.md:31`, `ja/explore-lead.md:30`: `- 文書の文体は、担当表の「文書作成」の役割の規律に従う。`
- `en/design-plan.md:31`, `en/explore-lead.md:30`: `- Follow the writing discipline of the "Document Authoring" role for style.`

担当表は `references/orchestration-discipline.md:5-30` にあり、**既に RoleId 列を持つ**(`:7` ヘッダ `| 役割名 | RoleId | 種別 | Agent Tool | Claude モデル |`)。ただしこの文書は**日本語版のみ**で、英語版は存在しない(`references/` は `context-map-guide.md` と `orchestration-discipline.md` の 2 本のみ)。

自役割以外を名指しする箇所は他に `ja/doc-writing.md:13` / `en/doc-writing.md:13`(`design-plan` と `explore-lead` を名指し)、`ja/_common.md:20,22,23,27` / `en/_common.md:20,22,23,27`。

### 4.5 `compose.ts` の合成と言語切り替え

`src/agents/compose.ts:40-111`。

- `:41` `vocabularyFor(input.lang)` で語彙を決める。`src/agents/vocabulary.ts:14-24`(JA)/ `:26-36`(EN)/ `:41-43`(`ja` 以外はすべて EN)。
- `:42` `loadCommon(input.fragmentDirs)` で `_common.md` の節を読む。ディレクトリは `fragments.ts:174-192` の `fragmentDirsFor` が決め、`:179` で `lang === "ja" || lang === "en"` ならその言語、それ以外は `en` を同梱ソースにする。以降 `.claude/agent-policy/roles/<lang>/` → `.claude/agent-policy/roles/` の順に後勝ちで重ねる。
- `:48-64` frontmatter を組む。出力キーは `name` / `description` / `model` / `color` / `tools` / (`disallowedTools`) / `agent-policy-role` / (`agent-policy-vendor`)。**言語を示すキーは無い。**
- `:173-185` `preamble()` が `{{NAME}}` と `{{ROLE_LABELS}}` を置換する。`{{ROLE_LABELS}}` は断片の `label` を `vocabulary.quote` で装飾し `vocabulary.listSeparator` で連結したもの。したがって en 定義の冒頭には英語ラベルが入る。
- `--lang` は `setup-agents` の CLI オプション(`src/setup-agents.ts:960-961`)で、既定値は `"ja"`(`:892`)。**どこにも永続化されない。** `setup-agents.ts` が書き出すファイルは Agent 定義本体だけ(`:651-652`)。

## 5. 英語出力への日本語混入を禁じる検査

`src/agents/__test__/compose.test.ts`。**HEAD では 616-626 行**(設計書と引継ぎ書が参照する `:616` はこの HEAD の位置)。作業ツリーでは別の作業者の編集により 595-605 行へ移動している(§7 の未解決事項 2 を参照)。

```ts
it("英語で合成した定義に日本語と日本語約物が混入しない", () => {
  const document = compose({
    name: "test-agent",
    model: "sonnet",
    vendor: "claude",
    roleIds: ["complex-impl", "explore"],
    fragmentDirs: [EN],
    lang: "en"
  })
  expect(document).not.toMatch(/[぀-ゟ゠-ヿ一-龯、。「」]/)
})
```

- **検査対象は `compose()` の戻り値全体**(frontmatter + 本文)であり、特定の節ではない。
- 禁止する文字種: ひらがな(U+3040-U+309F)、カタカナ(U+30A0-U+30FF。`・` U+30FB を含む)、CJK 統合漢字(U+4E00-U+9FAF)、および `、` `。` `「` `」`。
- **`RoleId` は引っかからない。** `doc-writing` / `explore-lead` 等はすべて ASCII であり、上記のどの範囲にも属さない。
- 検査に使う役割は `complex-impl` と `explore` の 2 つのみ。ただし検査対象が文書全体であるため、`_common.md` に日本語を入れれば必ず検出される。
- 関連: `compose.test.ts:584-593` が en / ja 断片の `id` / `kind` / `tools` / `defaultName` の一致を強制する(`label` は対象外)。`compose.test.ts:312-317` が ja 断片の `label` を `ROLES[].label` に固定する。

## 6. README の既知の限界の記述

`plugins/agent-policy/README.md`。

**:152**(該当箇所。長文の一部)

> SessionStart フックはプロジェクトの `.claude/agents/` を走査し、このマーカーから「役割 → Agent 名」の対応をセッションへ注入します。**注入される役割マーカー表の役割名は日本語表記です。** `custom` と旧互換値の設定では、検証が成立した場合にすべてのマーカー付き定義を載せます。(以下略)

**:160**

> SessionStart フックは独自役割の表示名を解決するとき、`.claude/agent-policy/roles/<id>.md` に加えて `.claude/agent-policy/roles/*/<id>.md` も走査します。同じ役割 ID が複数の言語ディレクトリにある場合、フックは会話言語を知らないため、どの表示名が使われるかは決まりません。

**:158**(引継ぎ書が「既知の限界」として挙げる行。実際には**別の話題**で、断片の節見出しと生成言語の一致に関する記述)

> 断片の節見出しは、生成時に選んだ言語の見出し集合と一致させてください。`--lang ja` では `## 作業手順` / `## 制約`、それ以外では `## Procedure` / `## Constraints` を使います。一致しない見出しの節は合成結果に現れません。`ja` / `en` 以外の翻訳断片でも見出しは英語のままにし、翻訳するのは本文と frontmatter の `label` / `description` です。

**README に無い事実**: `--lang en` で生成した定義の `_common.md` が英語の役割名で対応表を照合しようとして一致しないこと、およびその影響を受ける条項(アドバイザー相談・文書作成への再委譲)の名指し。

## 7. 3 案それぞれの影響範囲(事実のみ)

### (a) 対応表の各行に RoleId を併記する

想定する形: `- 文書作成 [doc-writing]: names`。`_common.md` は両言語で RoleId を参照する形にする。

**変更が要るファイルと箇所**

| ファイル:行 | 内容 |
| --- | --- |
| `src/hooks/marker-scan.ts:241` | 役割行の組み立て。唯一の生成箇所 |
| `assets/roles/en/_common.md:14` | アドバイザー照合を RoleId 参照へ |
| `assets/roles/en/_common.md:21` | 文書作成への再委譲の照合を RoleId 参照へ |
| `assets/roles/ja/_common.md:14`, `:21` | 同じ条項の ja 版(両言語で同じ参照形にする場合) |
| `README.md:152` | 対応表の行の形式の記述 |

**落ちるであろうテスト**

| ファイル:行 | 理由 |
| --- | --- |
| `src/hooks/__test__/marker-scan.test.ts:452-459` | 対応表全体の `toBe` 完全一致。期待値リテラルに RoleId が無い |
| `src/hooks/__test__/session-start.test.ts:665-675` | `- 複雑または重要な実装:` 等をラベル直後のコロンつきで `indexOf` する。ラベルとコロンの間に `[id]` が入ると 3 つとも `-1` になり、大小比較が破れる |

**落ちないテスト**(参考)

- `marker-scan.test.ts:483-485`、`session-start.test.ts:233/235/247/256-259/266-269/308/384/405/426/539/557/653-654/706/732-733/747` は導入文・スコープ行・ラベルの `toContain` であり、ラベル自体は残るため通る。
- `subagent-start.test.ts:205`, `:237` は `markerTable()` の出力自体を期待値にするため、形式を変えても通る。
- `subagent-start.test.ts:423-428` は切り詰めの構造検査。1 行あたり `RoleId` + 括弧 + 空白ぶん(概ね 10-20 文字)長くなるため、`MAX_CONTEXT_CHARS = 9500`(`subagent-start.ts:16`)に対する余裕が減る。fixture の規模次第で切り詰めの発生点が動く。

**ja 側の共通規律断片への影響**

- ja の対応表の行には日本語ラベルが残るため、`ja/_common.md:14`,`:21` は**変更しなくても動作は壊れない**。両言語で参照形を揃えるかどうかは選択になる。
- 揃えた場合、ja の条項は「対応表の `advisor` の役割の定義を使う」のような表記になり、現行の `「設計・計画・実装のアドバイザー」` という日本語の読みやすさは失われる。
- `ja/design-plan.md:31` / `ja/explore-lead.md:30`(および en 版)が参照するのは**担当表**であって対応表ではないため、この案の直接の影響は受けない。

### (b) 対応表を生成言語ごとに切り替える

**フックが生成言語を知るために必要な情報は、現状どこにも無い。** 具体的には次が欠けている。

| 欠けているもの | 確認した事実 |
| --- | --- |
| 言語を伝える env 変数 | フックが読む env は `CLAUDE_PROJECT_DIR` / `CLAUDE_PLUGIN_ROOT` / `AMATSUKA_AGENT_AUTO_INJECTION` / `AMATSUKA_AGENT_SUBSTART_DEBUG` / `AMATSUKA_AGENT_DELEGATION_GATE` / `AMATSUKA_AGENT_PARALLEL_NUDGE` の 6 つのみ。`src/hooks/` に `lang` の参照は 1 件も無い |
| 言語を記録する設定ファイル | `--lang` は `setup-agents` の CLI オプション(`setup-agents.ts:960-961`、既定 `"ja"` は `:892`)。`setup-agents.ts` が書くのは Agent 定義本体だけ(`:651-652`)で、設定ファイルは作らない |
| 定義 frontmatter の言語マーカー | `compose.ts:48-64` の出力キーに言語を示すものは無い。`MarkedAgent`(`marker-scan.ts:6-13`)も `name` / `model` / `roles` / `tools` / `vendor` のみで、ファイルパスも言語も保持しない |
| `roles.ts` の英語ラベル | `Role` は `{ id, label, kind, tools }`(`roles.ts:22-27`)。英語表記は `assets/roles/en/<id>.md` の frontmatter にしか無く、`marker-scan.ts` はこのディレクトリを読まない |
| hooks.json 経由の受け渡し | `hooks/hooks.json` はどのフックにも追加の env を渡さない |

**手段があるとすれば**(事実として確認できた範囲)

- SubagentStart は起動対象の定義を特定している(`subagent-start.ts:138-162` `resolveAgent`、`:228-232`)。したがって「どの定義が起動されるか」は既知である。その定義に言語を示す情報が付いていれば、対象ごとに言語を切り替える余地はある。ただし現状その情報は frontmatter にも `MarkedAgent` にも無い。
- SessionStart は入力に `agent_type` を持たないため、この手掛かりすら無い。SessionStart と SubagentStart が同一文面であることは `subagent-start.test.ts:237` が固定している。
- `roleLabel`(`marker-scan.ts:139-174`)は `.claude/agent-policy/roles/*/<id>.md` を走査するため、プロジェクト側に言語ディレクトリがあれば複数の `label` を見つけうる。どれを選ぶかは未定義であり、README:160 がその旨を明記している。

### (c) 現状維持。README に限界を明記するだけ

**変更が要るのは README のどこか**

- `README.md:152` の「注入される役割マーカー表の役割名は日本語表記です」の直後、または `:158`-`:160` の言語に関する段落。

**現状の記述で足りない点**

1. `:152` は「表の役割名が日本語である」事実だけを述べ、**それが `--lang en` で生成した定義にとって何を意味するか**(英語の役割名では対応表の行と一致しない)を述べていない。
2. 影響を受ける条項が名指しされていない。実際に影響するのは `en/_common.md:14`(アドバイザー照合)と `en/_common.md:21`(文書作成への再委譲)の 2 箇所である。
3. `:158` は断片の節見出しと生成言語の一致の話であり、本件の限界ではない(引継ぎ書はここを参照しているが、記述内容は別の話題である)。
4. `:160` は「同じ役割 ID が複数の言語ディレクトリにあるときどの表示名になるか決まらない」というプロジェクト独自役割の話で、同梱役割のラベルが常に日本語である件は扱っていない。
5. 回避手段(依頼文で定義名を明示する等)の案内が無い。

## 8. 守るべき既存契約

| 契約 | 出典 | 内容 |
| --- | --- | --- |
| 英語出力の純度 | `compose.test.ts` HEAD:616-626 | 英語合成結果に日本語・日本語約物を含めない。設計書 §5.11c が「英語出力の品質契約であり、維持する」と明記 |
| 両フックの対応表が同一文面 | `marker-scan.ts:214`(コメント), `subagent-start.test.ts:237` | SessionStart と SubagentStart は同じ `markerTable` の出力を使う |
| 担当表と `ROLES` の一致 | `src/agents/__test__/discipline-role-table.test.ts:148-179` | `references/orchestration-discipline.md` の担当表は、行数・並び・役割名(`ROLES[].label`)・RoleId・種別が `ROLES` と一致すること |
| ja 断片の label と `ROLES` の一致 | `compose.test.ts:312-317` | `assets/roles/ja/<id>.md` の `label` は `ROLES[].label` と一致すること |
| en / ja 断片のメタ一致 | `compose.test.ts:584-593` | `id` / `kind` / `tools` / `defaultName` が一致すること(`label` は対象外) |
| SubagentStart の注入上限 | `subagent-start.ts:16`, `subagent-start.test.ts:423-428` | 9500 文字以下。切り詰め時も先頭 2 行は完全に残す |

## 9. この欠陥に関する既存の記録

| 出典 | 内容 |
| --- | --- |
| `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md:825` | §10-9 として「英語で生成した定義が、日本語の役割マーカー対応表を照合できない」を既存の欠陥・スコープ外と記録。「既存のアドバイザー照合(`en/_common.md` L14)にも同じ欠陥がある」と明記 |
| 同 `:554` | §5.11c。日本語ラベル併記案を実装中の検出により撤回した経緯 |
| 同 `:806` | 不採用案の表。「en 断片へ日本語ラベル `文書作成` を併記して対応表の照合を助ける」を `compose.test.ts:616` との衝突により不採用 |
| `harness-docs/handover/2026-09-16-agent-policy-doc-writing-followup-handover.md:60-67` | 節 D。3 案(a)(b)(c)の提示元 |
| `harness-docs/design/2026-08-25-agent-policy-setup-agents-design.md:297-325` | §6.2 言語対応の範囲。`compose.ts` の日本語前提 4 箇所と `Vocabulary` の導入根拠。**フックの対応表は検討対象に入っていない** |

## 10. 未解決事項

| # | 内容 | 影響度 | 現状の事実 |
| --- | --- | --- | --- |
| 1 | context-map の出力先。`references/context-map-guide.md:79` は `.claude/context-maps/YYYY-MM-DD-<スラッグ>.md` を規定するが、本 map は依頼文の指定に従い `harness-docs/context-maps/` へ置いた。どちらを正とするか | Low | ガイドと依頼文が食い違っている。既存の context-map はリポジトリに 1 本も無く、先例が無い |
| 2 | `compose.test.ts` の行番号。設計書・引継ぎ書の `:616` は HEAD 基準で正しいが、作業ツリーでは別の作業者が同ファイルを編集中(29 行削除・5 行追加)で、現在は `:595-605` にある。設計書に書く行番号をどちらの基準にするか | Medium | 当該編集は git status の初期スナップショットには現れておらず、作業中に発生した |
| 3 | (a) を採るとき、ja 側の `_common.md:14`,`:21` も RoleId 参照へ揃えるか、日本語ラベル参照のまま残すか | High | ja は変更しなくても動作は壊れない。揃えると ja 定義の可読性が下がる |
| 4 | (a) を採るとき、役割行の形式を `- ラベル [id]: names` とするか、別の形(例: `- id (ラベル): names`)とするか。`session-start.test.ts:665-675` がラベル直後のコロンを前提にしているため、どの形でもこのテストの書き換えが要る | Medium | 形式の選択そのものは未確定 |
| 5 | 担当表(`references/orchestration-discipline.md:5-30`)は既に RoleId 列を持ち、`discipline-role-table.test.ts:148-179` が `ROLES` との一致を強制している。対応表側に RoleId を入れたとき、担当表側の記述(`:27` の「「RoleId」は Agent 定義の `agent-policy-role` マーカーに書く値である」)を対応表にも触れる形へ追随させるか | Medium | 現在この説明文は Agent 定義の frontmatter の話だけをしている |
| 6 | `references/orchestration-discipline.md` は日本語版のみで英語版が無い。`--lang en` で運用するプロジェクトのオーケストレーターが読む規律をどうするかは、本件の外か内か | Medium | en 定義のサブエージェントへ届く規律は `en/_common.md` と各役割断片だけである |
| 7 | (a) による 1 行あたり 10-20 文字の増加を、`MAX_CONTEXT_CHARS = 9500` の予算に対して許容するか。17 役割 × 複数定義の環境で切り詰めの発生点が前倒しになる | Low | 切り詰めは末尾の役割行から起きる(`subagent-start.ts:185-203`)ため、`ROLES` 順で後方の役割(レビュー系・advisor)が先に落ちる |
| 8 | プロジェクト独自役割(`.claude/agent-policy/roles/<id>.md`)の行にも RoleId を併記するか。`roleLabel` はプロジェクト断片も解決するため RoleId 自体は既知である | Low | `marker-scan.ts:139-174`。独自役割の `label` は任意の言語でありうる |
| 9 | (b) を将来の選択肢として残すなら、定義 frontmatter に言語マーカー(例: `agent-policy-lang`)を足すかどうか。足せば SubagentStart は対象定義の言語を知れるが、SessionStart は依然知れない | Medium | `compose.ts:48-64` に追加キーを足す変更になる。SessionStart と SubagentStart の文面一致(`subagent-start.test.ts:237`)との関係が生じる |

---

*本 map の所在を dispatch の依頼文へ載せること。API キー・トークン・パスワードなどの機密情報は記録していない。*
