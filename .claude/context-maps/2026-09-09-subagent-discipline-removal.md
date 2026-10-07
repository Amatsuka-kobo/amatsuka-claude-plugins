# Context Map: プロファイル統合(規律断片の廃止・claude での対応表注入・委譲先解決の共通化・setup の Claude/Custom 分岐)

**作成日**: 2026-09-09
**作成者**: Claude Opus 5 (1M context)(コードベース探索統括の役割)
**最終更新**: 2026-09-09(スコープ拡大に伴う第 2 版。旧版は「断片の廃止」だけを扱っていた)
**対象タスク**: `plugins/agent-policy` について次の 4 点を同時に扱う。(1) `references/subagent-discipline.md` を廃止し規律を依頼文転記へ一本化する。(2) claude プロファイルでも役割マーカー対応表を注入し、Claude モデル以外の定義を除外する。(3) 委譲先解決を claude / custom 共通の規律にする。(4) `setup-agents` ウィザードに「Claude のみ / Custom」の分岐を置く。
**関連する設計書**: `2026-08-31-agent-policy-two-profile-design.md`(2 プロファイル化)/ `2026-08-27-agent-policy-external-agent-model-assignment-design.md`(二段フック)/ `2026-09-09-agent-policy-band-catalog-consolidation-design.md`(担当表の集約)

---

## 1. 目的・スコープ

- 4 点の改修に必要な事実(実装の分岐・データの正本・テストが固定している契約・文書の現況)を集める。
- スコープ内: 事実の収集、選択肢の提示、未解決論点の列挙。
- スコープ外: 採否判断、設計書・実装計画書の執筆、実装。

## 2. 現在のコードベース構造

### 2.1 関係する構成

```
plugins/agent-policy/
├── hooks/hooks.json               SessionStart / SubagentStart / PreToolUse×2
├── build.ts                       esbuild。entryPoints 5 本
├── references/
│   ├── orchestration-discipline.md   138 行 16,563 B。読者=オーケストレーター
│   ├── subagent-discipline.md        11 行 919 B。読者=サブエージェント(廃止候補)
│   └── context-map-guide.md          6,169 B
├── assets/roles/{ja,en}/*.md      _common.md + 役割断片 17 本ずつ
├── skills/
│   ├── claude-model-policy/SKILL.md  1,245 B(18 行)
│   ├── custom-policy/SKILL.md        3,708 B(43 行)
│   └── setup-agents/SKILL.md        29,399 B(324 行)
├── src/
│   ├── setup-agents.ts            1,038 行。CLI 本体
│   ├── agents/                    8 モジュール(下記 §3.2)
│   └── hooks/
│       ├── session-start.ts       234 行
│       ├── subagent-start.ts      337 行
│       ├── delegation-gate.ts     matcher は Edit|Write|NotebookEdit|mcp__.*
│       ├── parallel-nudge.ts      matcher は Task|Agent。additionalContext を返す
│       └── marker-scan.ts         217 行。3 フック共通
└── scripts/                       バンドル出力(手で編集しない)
```

### 2.2 重要なファイル一覧

| ファイルパス | 役割・内容 | 重要度 | 備考 |
|---|---|---|---|
| `references/subagent-discipline.md` | 廃止対象。宣言 1 行＋`<!-- marker-table -->`＋条項 5 行 | High | 唯一の読み手は `subagent-start.ts` L263 |
| `references/orchestration-discipline.md` | 規律の正本。L3 が読者宣言 | High | **working tree に未コミット差分あり**(§4.4) |
| `src/hooks/subagent-start.ts` | 断片読込・合成・9500 字切り詰め | High | 削除対象の関数群は §3.3 |
| `src/hooks/session-start.ts` | プロファイル分岐。対応表は custom 成功時のみ | High | `CLAUDE_RESOLVED_MODELS` L24-30 を持つ |
| `src/hooks/marker-scan.ts` | `MarkedAgent` / `scanAgents` / `markerTable` | High | `MarkedAgent` は `model` と `vendor` を保持済み |
| `src/agents/policies.ts` | `MODELS` / `ASSIGNMENTS` / `RECOMMENDED` / `POLICIES` | High | Claude 判定関数は明示なし |
| `src/setup-agents.ts` | CLI。`CLAUDE_ENUMS` L73 / `isClaudeEnum` L241 | High | サブコマンドは無く、mode フラグで分岐 |
| `skills/setup-agents/SKILL.md` | ウィザード本体。ステップ 0〜7 | High | `description` L3 が「custom プロファイル専用」 |
| `skills/{claude-model-policy,custom-policy}/SKILL.md` | 両方に誤った委譲先解決の記述 | High | claude L18 / custom L21 |
| `src/hooks/__test__/subagent-start.test.ts` | 5 describe / 28 ブロック / 展開 38 ケース | High | 断片依存は 13 ケース |
| `src/agents/__test__/discipline-role-table.test.ts` | 規律の担当表を検査 | High | **現に 8 failed / 5 passed**(§7.3) |
| `assets/roles/ja/_common.md` | 生成定義の共通本文。条項 0/2/3/5 相当 | High | 第 2 の到達経路 |
| `assets/roles/ja/explore-lead.md` | L21 が条項 4 相当を持つ | Medium | 他の役割断片には無い |
| `assets/roles/en/_common.md` | 英語版。ja と同じ節構成 | Medium | 用語「帯」が残る(L14) |
| `plugins/agent-policy/README.md` | L11 / L13 / L150 / L236 が SubagentStart | Medium | L210 / L214 が「「役割」節」を指す |
| `README.md`(ルート) | L113 が SubagentStart の配布 | Medium | |

## 3. 関連モジュール・コンポーネント

### 3.1 プロファイル分岐(`session-start.ts` L192-204)

```ts
const injection = env.AMATSUKA_AGENT_AUTO_INJECTION?.trim().toLowerCase() ?? ""
if (injection === "" || injection === "none")      profileBlocks = []
else if (injection === "claude")                    profileBlocks = [policyBlock("claude-model-policy")]
else if (isCustomInjection(injection))              profileBlocks = await customBlocks(env, marked, injection)
else                                                profileBlocks = [unknownInjectionBlock(injection)]
```

- **`markerTable()` の呼び出しは 1 箇所だけ**(L127、`successBlocks()` 内)。claude 分岐にも none 分岐にも無い。
- `customBlocks()`(L134-178)の流れ: 役割付き定義 0 件 → claude へフォールバック(表なし) / 外部モデル 0 件 → 成功(表あり) / 照会失敗 → claude へフォールバック(表なし) / 不在あり → claude へフォールバック(表なし)。
- claude フォールバックの 3 経路はいずれも `policyBlock("claude-model-policy")` + 説明 + `REPAIR_BLOCK` で、**対応表を出さない**。
- プロファイル分岐の後、`retiredBlock` と `deprecatedAliasesBlock` が共通で足される(L206-212)。

### 3.2 `src/agents/` の 8 モジュール(依頼文は 7 と記載。実際は `vocabulary.ts` を含めて 8)

| モジュール | 行数 | 主な export | 責務 |
|---|---:|---|---|
| `policies.ts` | 235 | `ModelId` L4 / `MODELS` L47 / `ASSIGNMENTS` L124 / `RECOMMENDED` L149 / `POLICIES` L36 / `allowsAgentTool` L183 / `modelById` L188 / `policyForInjection` L198 / `isCustomInjection` L214 / `modelsFor` L220 / `rolesFor` L229 | モデル・プロファイル・役割割当の正本 |
| `roles.ts` | 147 | `RoleId` L3 / `Role` L21 / `ROLES` L29 / `roleById` L128 / `roleOrder` L132 / `sortRoleIds` L137 / `hasMixedKinds` L144 | 16 役割のカタログ。`Role` は `id`/`label`/`kind`/`tools` のみ |
| `fragments.ts` | 307 | `Vendor` L6 / `loadFragments` L110 / `loadCommon` L158 / `fragmentDirsFor` L174 / `checkFragments` L226 / `scaffoldFragments` L273 | 役割断片の読込・ベンダー overlay・翻訳検査 |
| `compose.ts` | 185 | `ComposeInput` L12 / `compose` L40 / `describeRoles` L113 | Agent 定義 Markdown の組み立て |
| `live-models.ts` | 117 | `LiveModels` L1 / `fetchLiveModels` L34 | プロキシ `/v1/models` の照会。失敗は例外でなく `ok:false` |
| `mcp.ts` | 116 | `listMcpServers` L66 / `mcpCurrentOf` L89 / `parseMcpList` L30 / `toolPrefix` L58 | `claude mcp list` の解析 |
| `hash.ts` | 17 | `bodyHash` L5 | 翻訳断片の同期確認用ハッシュ |
| `vocabulary.ts` | 43 | `Vocabulary` L3 / `vocabularyFor` L41 | ja / en の見出し語彙 |

**`src/hooks/` からの import は 3 本だけ。** `session-start.ts` → `live-models`(`fetchLiveModels`) / `policies`(`isCustomInjection`, `PolicyName`)、`subagent-start.ts` → `policies`(`isCustomInjection`)、`marker-scan.ts` → `roles`(`roleById`, `sortRoleIds`)。`compose` / `fragments` / `hash` / `mcp` / `vocabulary` はフックから使われない(setup 専用)。

### 3.3 対応表の生成経路

- 正本は `marker-scan.ts` の `markerTable(env, marked)` L189-217 の 1 本。
- `MarkedAgent`(L5-12)は `name` / `model` / `roles` / `tools` / `vendor` を持つ。`scanAgents()` L94-135 が frontmatter の `name` / `model` / `agent-policy-role` / `agent-policy-vendor` / `tools` から作る。**`model` と `vendor` を既に保持しており、Claude 判定に必要なデータは揃っている。**
- 消費者は 3 つ。`session-start.ts` L127(custom 成功時のみ)、`subagent-start.ts` L299、`delegation-gate.ts` L322(deny 文)。
- 表の冒頭行(L208)は「次の Agent は役割マーカーを宣言している。担当表の該当する役割は、これらを優先して使う。同じ役割に複数あるときは依頼内容に近いものを選ぶ。」
- `delegation-gate.ts` は L355 で `agent_id` を検知して return する。matcher も `Edit|Write|NotebookEdit|mcp__.*` で `Agent` を含まない。**サブエージェントには構造的に発火しない。**

### 3.4 Claude モデルの判定材料(3 箇所に散っている)

| 箇所 | 定義 | 用途 |
|---|---|---|
| `session-start.ts` L24-30 | `CLAUDE_RESOLVED_MODELS = new Set(["sonnet","opus","haiku","fable","inherit"])` | custom 検証で外部モデルを切り分ける(L149-155) |
| `setup-agents.ts` L73 | `CLAUDE_ENUMS = ["sonnet","opus","haiku","fable"] as const` | `isClaudeEnum` L241 / `modelIsAvailable` L268 / `resolveVendor` L256 |
| `policies.ts` L47-120 | `MODELS` の各要素が `vendor: "claude"` を持つ(先頭 4 件) | 静的カタログ |

**`isClaudeModel` に相当する共通関数は明示なし。** `Vendor` 型は `fragments.ts` L6 で `"gpt" | "grok" | "claude" | "none"`。`LiveModels.vendors` は `"gpt" | "grok" | "claude" | "unknown"`(`live-models.ts` L4)で `none` を含まない。

### 3.5 `setup-agents` ウィザード(SKILL.md)

| ステップ | 行 | ユーザーに聞くこと |
|---|---|---|
| 0 言語判定 | L65-67 | 聞かない(会話言語から推定)。ステップ 1 冒頭で変更機会を与える |
| 1 live models 照会 | L69-80 | 聞かない。`--list-live-models` を実行 |
| 1b 既存定義の被覆確認 | L82-107 | 既存定義があれば「未カバーだけ作る/すべて選び直す/中止」 |
| 2 翻訳断片の準備 | L109-126 | `ja`/`en` ならスキップ |
| 3 照会結果の確認 | L128-133 | 聞かない |
| 4 モデル値とベンダーの選択 | L135-152 | `model` 値を複数選択。unknown vendor は 4 択 |
| 5 一括確認 | L154-176 | 「全部作る/一部調整/中止」 |
| 5b 個別調整 | L178-222 | 役割・定義名・`model`・ベンダー・差分方針 |
| 5c MCP の付与 | L224-247 | サーバー選択と denylist |
| 6 生成 | L249-270 | 聞かない |
| 6b 未カバー役割の生成 | L272-300 | 役割統合・作成可否・モデル ID・定義名・MCP |
| 7 報告 | L302-324 | 聞かない。CLAUDE.md 案内は L311-320 |

- 対話モードの宣言は L63。**最初のユーザー入力機会は L67 の言語変更**である。新しい「Claude のみ / Custom」分岐の差し込み位置の候補は L63 と L65 の間、または L67 の直後・L69 の前。
- 候補数の共通規則(L28-31): 0 件は質問せず / 1 件は通常の確認文 / 2〜4 件は 1 回の `AskUserQuestion` / 5 件以上は 4 件ずつ分割。
- L312-316 の CLAUDE.md 案内は `AMATSUKA_AGENT_AUTO_INJECTION` の 3 値(`none` / `claude` / `custom`)＋旧値＋未知値の 5 分岐で書かれている。`claude` の項は「生成した custom 定義を担当表のマーカーで使うには、環境変数を `custom` へ変更するか、CLAUDE.md へ上の 1 行を足すよう案内する」。

### 3.6 `setup-agents.ts` の CLI(サブコマンドは無い。mode フラグで分岐)

- mode の優先順(L1000-1027): `--list-live-models` → `--list-coverage` → `--list-mcp` → `--check-fragments` → `--scaffold-fragments` → `--list-roles` → 既定(`setup()`)。
- フラグ: `--model-id` / `--models` / `--name` / `--model` / `--vendor` / `--roles` / `--dir` / `--lang` / `--mcp-servers` / `--mcp-deny` / `--check` / `--write` / `--merge` / `--keep` / 各 list 系。`--policy` / `--list-policies` / `--list-models` は受理してエラーを返す削除済みフラグ。`--yes` は CLI に無く、SKILL.md が `$ARGUMENTS` を見て非対話手順へ切り替える。
- **`claudeEnums` は `listLiveModels()`(L692-712)が `live.ok` の真偽にかかわらず常に返す。** 定義は L693 `const claudeEnums = [...CLAUDE_ENUMS]`。例外送出時のみ `main()` の catch が `claudeEnums` を含まないエラー応答を返す(L1028-1034)。
- **Claude enum は照会なしで生成まで通る。** `modelIsAvailable`(L268-270)は `isClaudeEnum(model) || live.ids.includes(model)`、`resolveVendor`(L256)は Claude enum なら live を見ずに `"claude"` を返す。`targetsFor` の一括分岐(L282-289)は `live.ok` のとき `modelIsAvailable` で絞るが、Claude enum は常に真なので落ちない。
- `model` の決定は `targetsFor()`。一括は `spec.model`(L300)、個別は `options.model === "" ? spec.model : options.model`(L310)。書き込みは `write()`(L607-637)。

## 4. 既存の実装パターン・規約

- フックは fail-open。stdin parse 失敗・断片読込失敗・環境変数未設定でも exit 0 で spawn を止めない。
- SubagentStart の注入選別は deny-list。`tools` が定義済みで `Agent` を含まない定義と、ビルトイン `Explore` / `Plan` だけを外す。未知の `agent_type`・`tools` 欄なしは注入する。
- 注入文に方針スキル名を含めない(子のオーケストレーター化を防ぐ)。
- 規律文書は「読者ごとに 1 本」。
- テストは対象と同じディレクトリの `__test__/`。vitest / node / forks / 20 秒。
- 数値・列挙の正本はコード側(`policies.ts` / `roles.ts`)に置き、文書側はテストで一致を強制する(`discipline-role-table.test.ts`)。

## 5. 変更の影響範囲

### 5.1 直接影響を受ける箇所

- `references/subagent-discipline.md` — 削除。
- `references/orchestration-discipline.md` — 条項 1 / 4 の主語整備、転記義務の明文化、委譲先解決の共通節の新設。
- `src/hooks/subagent-start.ts` — `readFragment` / `composeSections` / `fragmentLines` / `render` / `MARKER_LINE` / `ContextSections` の削除、`truncateContext` の縮小、claude 分岐の追加。`import fs` が不要になる(`fs` の使用は `readFragment` L262 の 1 箇所)。
- `src/hooks/session-start.ts` — claude 分岐とフォールバック 3 経路への対応表追加。`CLAUDE_RESOLVED_MODELS` の移設。
- `src/hooks/marker-scan.ts` — Claude 実行可能な定義だけを残すフィルタの追加。
- `src/agents/policies.ts` — Claude モデル判定の正本の新設。
- `src/setup-agents.ts` — `CLAUDE_ENUMS` を `policies.ts` 由来へ寄せる。プロファイルに応じた候補の出し分けが要るなら `listLiveModels` 周辺。
- `skills/setup-agents/SKILL.md` — ステップの新設と `description` L3 の改訂、L312-316 の案内文。
- `skills/claude-model-policy/SKILL.md` L18 / `skills/custom-policy/SKILL.md` L21 — 誤った委譲先解決の記述。
- `src/hooks/__test__/subagent-start.test.ts` — 38 ケース中 13 が断片依存。
- `src/agents/__test__/discipline-role-table.test.ts` — L41 の `/^## 役割$/m`。
- `hooks/hooks.json` L2 の description、README 2 本、`plugin.json` / `package.json` の `version`。

### 5.2 間接的に波及する箇所

- `assets/roles/ja/_common.md` L14 — 「対応表の…」。claude でも対応表が届くようになるため、参照が両プロファイルで解決するようになる(改善)。
- `assets/roles/en/_common.md` L14 — 用語「band」が残る。日本語断片の廃止で、en 定義の子は英語 `_common` + 日本語の転記という混在になる。
- `src/hooks/delegation-gate.ts` — `markerTable` を使うが、deny 文の委譲先候補としてであり、プロファイルを見ていない。claude 運用で gate が有効なとき、除外前の全定義を候補に出す食い違いが残る。
- `.claude/agents/*.md`(11 定義) — 生成物。`setup-agents` の再実行で追随する。

### 5.3 変更を避けるべき箇所

- `markerTable()` の出力文言 — `subagent-start.test.ts` L276-293 が「SessionStart と SubagentStart で同一文面」を固定する。
- `harness-docs/` の既存設計書・実装計画書 — 履歴として残す。決定を覆すときは新しい設計書で上書きする。
- `.raphael/` — 保護パス。実行ログであり手で書き換えない。
- `plugins/agent-policy/scripts/` — バンドル出力。`src/` を変えて `pnpm run build` で再生成する。

## 6. 守るべき既存契約・インターフェース

### 6.1 5 条項と現在の到達経路

| # | `subagent-discipline.md` の条項 | `orchestration-discipline.md` | `assets/roles/ja/` |
|---|---|---|---|
| 0 | L3「あなたはサブエージェントである」 | L47(主語は起動側。「サブエージェントは〜」で始まらない) | `_common.md` L7 |
| 1 | L7 再委譲先は対応表優先 | L60(主語が「SessionStart フックが」) | **無し** |
| 2 | L8 アドバイザーは対応表 →`Fable`→ 差し戻し | L55(逐語ほぼ一致) | `_common.md` L14 |
| 3 | L9 アドバイザーに Agent tool を許可せず | L57(逐語ほぼ一致) | `_common.md` L15 / L20 |
| 4 | L10 読み取り作業の再委譲時の明記 | L51-53(主語が「オーケストレーターは」、条件は readonly 役割 → Write/Edit 持ち) | **`explore-lead.md` L21 のみ**(条件は探索実働。tools 限定を含まない) |
| 5 | L11 指定スキルだけをロード | L58 / L59(逐語一致) | `_common.md` L27-29 |

- 「対応なし」の条項は無い。条項 1 と条項 4 だけが「サブエージェントは〜」で始まらないため転記対象として識別できない。
- **条項 4 は `_common.md` に無い。** `explore-lead` 役割の定義にしか入らない。
- 条項 1 は `markerTable()` の冒頭行(L208)が同内容を持つ。ただし冒頭行が届くのは表が注入されるときだけであり、現状の claude / none プロファイルでは届かない。

### 6.2 機械的契約

- `additionalContext` は 9,500 字以内(`MAX_CONTEXT_CHARS`)。超過時は after → before → table の順に削り、表は先頭 2 行を残す。
- フックは常に exit 0。stdout は改行終端の JSON 1 行のみ。stdin タイムアウト 2 秒。
- `Explore` / `Plan` と `tools` に `Agent` を持たない定義には注入しない。
- 注入文に方針スキル名を含めない。
- `--list-live-models` の応答は `{ok, reason?, models, claudeEnums}`。`claudeEnums` は常に返る。

### 6.3 誤りとして訂正が確定している記述(ユーザー判断)

- `claude-model-policy/SKILL.md` L18 と `custom-policy/SKILL.md` L21 の「担当表の『種別』が `readonly` の役割はビルトイン `Explore`、`impl` の役割は `general-purpose` へ委譲する」は誤りである。ビルトインは第一候補にならない。対応表に列挙できなかった役割は、定義されたエージェントを第一候補とし、合うものが無ければビルトインへ委譲する。

## 7. 実測値・現況

### 7.1 サイズ

| 対象 | 実測 |
|---|---|
| `references/orchestration-discipline.md` | 16,563 B |
| `references/context-map-guide.md` | 6,169 B |
| `references/subagent-discipline.md` | 919 B |
| `references/` 合計 | 23,651 B(上限 30,720 B) |
| `skills/claude-model-policy/SKILL.md` | 1,245 B |
| `skills/custom-policy/SKILL.md` | 3,708 B |
| `skills/setup-agents/SKILL.md` | 29,399 B |

### 7.2 バージョンと git

- `plugin.json` / `package.json` はいずれも `0.17.1-dev`。
- HEAD は `183774d`(「役割の区分を指す語を「帯」から「役割」へ改める」)。その前が `a01c39d`(「帯カタログを共通規律へ集約し、方針スキルから担当表を削除する」)。
- **`2026-09-09-agent-policy-band-catalog-consolidation-implementation.md` は完了・コミット済みである。** 旧版 §7-2b の「進行中と仮定」は誤りだった。バージョンは `0.16.0-dev` → `0.17.0-dev` → `0.17.1-dev` と進んでいる。同計画の Done 条件(「`subagent-discipline.md` が無変更であること」)は完了時点で満たされており、本件が遡って破ることはない。
- working tree の未コミット差分は 3 ファイル: `references/orchestration-discipline.md` / `skills/claude-model-policy/SKILL.md` / `skills/custom-policy/SKILL.md`。

### 7.3 テスト

`pnpm run test` の実測(HEAD + working tree): **Test Files 1 failed | 156 passed | 1 skipped (158)、Tests 8 failed | 2164 passed | 2 skipped (2174)**。

- 失敗はすべて `src/agents/__test__/discipline-role-table.test.ts` の describe「規律の役割」8 ケース。原因は L41 の `/^## 役割$/m` が、working tree で `## 担当表` へ改名された見出しに一致しないこと。エラーは `規律の「役割」節が見つからない`。
- 同ファイル L227-228 の `FORBIDDEN_ROLE_TABLE_HEADINGS = /^## (?:役割|役割の帯|モデル別役割|役割の帯と推奨モデル)$/m` は方針 SKILL 側の負のテストで使われ、`担当表` を含まない。
- `src/hooks/__test__/subagent-start.test.ts` は 5 describe / **28 ブロック**(`it(` 23 + `it.each(` 5)/ **展開 38 ケース**。旧版の「28 ケース中 17 が断片依存」は誤り。正しくは **38 ケース中 13 が断片依存**(No. 2/3/4/8/10/11/13/14/16/29/30/35/38)。
- describe 別の展開ケース数: 定義照合と deny-list 9 / 断片の合成 8 / 対応表の injection 判定 13 / 入力と出力 6 / 切り詰め 2。
- 切り詰めテスト L465-486 は「大きな対応表の下では断片の規律行が落ちる」ことを `not.toContain("- 起動したアドバイザーに Agent tool を許可せず")` で固定し、コメントで「対応表を優先して残す設計判断の帰結であり、規律要約が落ちるのは意図された縮退である。」と書く。**断片が確実な配布チャネルでない証拠である。**
- `environment()` L73-92 が `CLAUDE_PLUGIN_ROOT` に実リポジトリの plugin root を設定するため、大半のケースは実ファイルの断片を読む。断片を自前で書き出すのは L226-240 の 1 ケースだけ。

### 7.4 このリポジトリの 11 定義

| 定義 | model | vendor | roles |
|---|---|---|---|
| `astra-complex-reviewer` | `claude-gpt-6-astra` | `gpt` | `e2e-verify, final-review, gate-review` |
| `astra-tech-leader` | `claude-gpt-6-astra` | `gpt` | `escalation` |
| `code-reviewer` | `sonnet` | `claude` | `code-review` |
| `fable-adviser` | `fable` | `claude` | `advisor` |
| `gpt-luna` | `claude-gpt-5-6-luna` | `gpt` | `normal-impl, light-impl, general` |
| `gpt-sol-lead-implementer` | `claude-gpt-5-6-sol` | `gpt` | `complex-impl` |
| `gpt-terra-explorer` | `claude-gpt-5-6-terra` | `gpt` | `explore` |
| `grok-docs-reviewer` | `claude-grok-4-6` | `grok` | `independent-review` |
| `grok-researcher` | `claude-grok-4-6` | `grok` | `explore, realtime-research` |
| `haiku-reviewer` | `haiku` | `claude` | `doc-review` |
| `system-planner` | `opus` | `claude` | `design-plan, explore-lead` |

**Claude で実行できるのは 4 定義(`code-reviewer` / `fable-adviser` / `haiku-reviewer` / `system-planner`)、外部が 7 定義である。** claude プロファイルで対応表を出すと、覆われる役割は `code-review` / `advisor` / `doc-review` / `design-plan` / `explore-lead` の 5 つになる。

### 7.5 文書の現況(working tree 基準)

| 箇所 | 現在の文言 |
|---|---|
| 規律 L3 | この文書の読者はオーケストレーターである。「サブエージェントは〜」で始まる条項は、依頼文への転記と、生成した定義の本文でサブエージェントへ届ける。 |
| 規律 L5 | `## 担当表`(未コミット差分で `## 役割` から改名) |
| 規律 L51-53 | オーケストレーターは、担当表の「種別」が `readonly` の役割を `Write` / `Edit` を持つ定義へ委譲するとき、依頼文に次を明記する。＋ tools 限定 / 変更しない・報告のみ の 2 子項目 |
| 規律 L54 | オーケストレーターは、サブエージェントに方針スキルをロードさせない。必要な規律は依頼文へ転記する。 |
| 規律 L55-59 | 「サブエージェントは、…」で始まる 5 条項 |
| 規律 L60 | SessionStart フックが役割マーカーの対応表を注入したときは、その役割の委譲先を担当表より優先してその定義とする。同じ役割に複数あるときは依頼内容に近いものを選ぶ。 |
| claude SKILL L10 | `../../references/orchestration-discipline.md` を併せて読み、これに従う。 |
| claude SKILL L18 | 担当表の「Claude モデル」列のモデルを、dispatch 時の `model` 上書きで指定して起動する。担当表の「種別」が `readonly` の役割はビルトイン `Explore`、`impl` の役割は `general-purpose` へ委譲する。 |
| custom SKILL L10 | (claude SKILL L10 と同文) |
| custom SKILL L21 | 2. 対応表に無い役割は、担当表の「Claude モデル」列のモデルへ読み替える。読み替えた後は、dispatch 時の `model` 上書きで実行役割を指定し、担当表の「種別」が `readonly` の役割はビルトイン `Explore`、`impl` の役割は `general-purpose` へ委譲する。 |
| custom SKILL L23 | 手順 2 の例外は「設計書・実装計画書の独立レビュー」の役割である。この役割は読み替えず、独立レビューを省略する。他の役割で代行しない。 |

**未コミット差分には、上記の見出し改名のほかに用語変更が含まれる。** 「dispatch」→「サブエージェントの起動」(L33)、「1 メッセージ内で可能な限り並列に dispatch」→「可能な限り並列に起動」(L48)、「単一コンポーネントに閉じ」→「単一コンポーネントが対象で」(L45)、担当表と起動形態表の整形、および冒頭の定義文「以下で「担当表」とは、この文書の §役割 の表を指す。」の削除。

## 8. 未解決事項(判断はオーケストレーターが行う)

| # | 論点 | 影響度 |
|---|---|---|
| 1 | Claude 判定の正本をどこへ置くか。`CLAUDE_RESOLVED_MODELS`(session-start L24-30)・`CLAUDE_ENUMS`(setup-agents L73)・`MODELS` の `vendor: "claude"`(policies L47-)の 3 箇所が並存する。`inherit` を含めるかで集合が変わる | High |
| 2 | 対応表からの除外を `model` だけで決めるか、`agent-policy-vendor` も見るか。`vendor: none` と未宣言と未知値の扱い | High |
| 3 | custom がフォールバックしたセッションで、SessionStart は claude 用の対応表を出すか。出すなら 3 経路(markerless / missing / queryFailure)すべてか | High |
| 4 | SubagentStart はプロキシを照会しないため、custom フォールバック時に親(claude 表)と子(custom 表)が食い違う既存の乖離は残る。`two-profile-design` §6.4 L224 が受容済み。本改修で扱うか | Medium |
| 5 | 転記の射程。「関わる条項」か「全条項」か。転記量と確実性のトレードオフ | High |
| 6 | 条項 4 の条件を「読み取りだけの作業を Write/Edit 持ちへ」へ広げるか。断片 L10・規律 L51・`explore-lead.md` L21 の 3 者が異なる条件を持つ | Medium |
| 7 | `explore-lead.md` L21 は tools 限定を含まない。共通規律との二重基準を残すか | Medium |
| 8 | `assets/roles/en/_common.md` の言語経路。日本語断片の廃止後、en 定義の子は英語本文 + 日本語の転記になる | Low |
| 9 | `delegation-gate.ts` の deny 文の委譲先候補が、claude 運用でも除外前の全定義を出す食い違い | Low |
| 10 | 転記のコストは spawn 回数 × 親履歴に効く。`references/` の合計サイズでは測れない | Medium |
| 11 | `discipline-role-table.test.ts` L227-228 の `FORBIDDEN_ROLE_TABLE_HEADINGS` に `担当表` を足すか | Low |
| 12 | `plugins/agent-policy/README.md` L210 / L214 が共通規律の節を「「役割」節」と呼ぶ食い違い | Low |
| 13 | 規律 L58 と L59 が同じ規律を 2 通りに述べている。転記量を増やす | Low |
| 14 | `.claude/agents/grok-researcher.md` が廃止済みとされながら残り、`session-start.ts` L16-22 の残骸検知にも列挙されている | Low |

## 9. 依存関係・リスク・制約

- Claude Code 2.0.43 未満には SubagentStart イベントが無く、その環境では注入されない。**転記だけが唯一の経路である運用環境が既に存在する。**
- `esbuild` バンドル。`references/*.md` はバンドルされず実行時読み。`src/` を変えたら `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分を同じコミットに含める。
- 断片＋対応表は目安 300 token + 表サイズ。全 spawn に課金される。廃止すると spawn あたりの固定費が減る一方、依頼文が長くなり親側の出力トークンが増える。**コストの発生点が「フック(全 spawn 一律)」から「親の出力(spawn 回数 × 親履歴に累積)」へ移る。**
- claude プロファイルで対応表を出すと、これまで対応表を持たなかったセッションに新たな固定費が乗る(このリポジトリでは 4 定義 5 役割 = 6 行)。
- `two-profile-design` §2.3 の実測: 自動委譲の抑止について「スキル本文の命令形強化・最優先宣言・output style は効果なし。効果が確認されたのは PreToolUse deny のみ」。ただしこれは抑止の文脈であり、依頼文へ項目を足す加算的な指示に同じ結論が当たる実測は明示なし。
- 過去に却下済みで再提案しない配布案: `CLAUDE.md` 焼き込み、反転注入、サイドカー割当マップ、派生定義生成、`UserPromptSubmit` 毎ターン注入、system prompt 原文引用＋名指し上書き、SubagentStart の fail-closed、allow-list 選別、SubagentStart からの `/v1/models` 照会。

## 10. 補足

- 二段フックの採用理由は「対応表の解決がメインセッションに留まり、子・孫の再委譲で同じ role map を前提にできなかった」こと(`2026-08-27` 設計 §5 L141-149)。P0 は role map の全階層伝播であり、**規律の配布は断片の主目的ではなく相乗りである。**
- `plugins/agent-policy/agents/` は空。`subagent-start.ts` の `bundledAgentsDir` 走査は常に 0 件を返す。規律 L89「このプラグインは Agent 定義を同梱しない」と整合する。
- `parallel-nudge.ts` は `PreToolUse: Task|Agent` に登録され `additionalContext` を返す。オーケストレーターにもサブエージェントにも発火する。転記 nudge を足すなら相乗り先はここだけである。README L204 は「効果は未実証であり、dispatch 時だけ動く低コストな補助として置いています」と書く。
- `docs/chat/2026/0909/phyllis998/0831-custom-policy-recommended-model-analysis.md:233` は本日別セッションで「対象文書は SubagentStart の配布物として残す」と結論している。
