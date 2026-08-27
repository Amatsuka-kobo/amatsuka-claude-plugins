# agent-policy 外部 Agent モデル割当・合成 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 版: 第 3 版（第 2 版へのレビュー第 2 巡: Haiku・Grok 独立・設計書突き合わせ(GPT Sol) の指摘を反映。設計書の適用除外 3 も同巡の指摘で是正済み — `color` / `agent-policy-role` を allow-list に追加）

**Goal:** 名指し dispatch された外部 Agent に対し、判定フローに基づく 3 種の起動形態（そのまま / モデル注入 / 合成）を規律として確立し、`SubagentStart` フックで marker 対応表とサブエージェント規律をすべての再委譲階層へ機械配布する。

**Architecture:** 規律の正本は `references/orchestration-discipline.md`（オーケストレーター向け）と新設の `references/subagent-discipline.md`（サブエージェント向け断片）。動的な対応表は `session-start.ts` から抽出した共通モジュールが生成し、SessionStart（メイン向け・現行維持）と新設 `subagent-start.ts`（Agent tool 保有サブエージェント向け）の両フックが同じ表を注入する。dispatch 時の判定はコードではなく規律（方針スキル + discipline）が担う。フックのコード判定は deny-list（注入先の選別）だけである。

**Tech Stack:** TypeScript 6 (strict, ESM) / Node.js 26 / vitest 4 / esbuild / pnpm workspace

**Spec:** `harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md`（第 4 版・承認済み。§8 実機検証 1〜7 は 2026-08-27 完了、食い違いなし）

## Global Constraints

- 実装は TypeScript。`plugins/agent-policy/scripts/` は編集せず `pnpm run build` で再生成し、`src/` の変更と同じコミットに含める
- **テスト先行**。各タスクは「失敗するテストを先に追加 → 実装 → 通過」の順で進める
- テストは vitest。対象ソースと同じディレクトリの `__test__/` に置き、`<対象ファイル名>.test.ts`。node / forks / タイムアウト 20 秒。**フック実行のテスト**は既存の `runTs` 慣行に従い子プロセスで実行する（stdin を要するテストは `runTs` の `input` オプションで JSON を渡す）
- 各タスクの終了時に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ること
- ブランチを切らない。`git push` に `--force` 系を付けない
- **本計画が作成・変更すると明記したファイル以外の未コミット変更・未追跡ファイルには一切触れない**（revert・削除・上書き・コミット混入のすべてを禁止。作業ツリーには本改修と無関係な変更が多数ある）
- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` を 0.12.2-dev → **0.13.0-dev** に揃えて上げる（Task 7。変更が多いためマイナー）
- フックは常に exit 0。障害時は stderr へ 1 行（既存 SessionStart と同形式: `agent-policy subagent-start: <理由>`。理由は英語 1 句で分類を示す — `stdin parse failed` / `fragment missing` / `truncated` 等）出し、無出力（または対応表のみ）で継続する。stdout には注入 JSON 以外を出さない
- **AI 向け指示書（Task 2・5・6 の references / SKILL.md / README の文面）は、規約どおり `prompt-smith:prompt-smith` を起動して確定する**（メインエージェントが Skill tool で起動し、その基準で文面を書く・点検する）。本計画のドラフト・要素列挙は入力素材であり、最終文面はスキルの基準が優先する。ただし各タスクの「必ず含める要素」「含めてはならない要素」は文面確定後も満たすこと
- 設計書の「実装計画書で確定する事項」は本計画で次のとおり確定する: 抽出シグネチャ = Task 1 / deny-list 走査 = フック実行ごと・キャッシュなし / 出力スキーマ = Task 3 / 断片サイズ = 静的部分を約 300 token（日本語 450〜600 字）目安で執筆し、実行時は全体 9,500 字を機械上限として要約側 → 表側の順で後方から切り詰める / fail 時ログ = stderr 1 行 / §4 の 1 サーバー追加専用経路 = **見送り**（提案文で既存 CLI の全集合指定を案内。将来課題）/ 注入断片の実文面 = Task 2（prompt-smith で確定）

## 環境上の注意

`tools/delegation_gate.py` が PreToolUse で編集系ツールを止める構成になっている。メインエージェントが直接 Edit / Write できない場合は、サブエージェントへ委譲するか `scripts/direct-edit.sh` で解除する。

## タスク依存

**Task 0 → 1 → 5 → 2 → 3 → 4 → 6 → 7 → 8** の順に進める（Task 2 の整合確認が Task 5 改訂後の discipline を基準にするため、Task 5 を Task 2 より前に置く。第 2 巡レビューでの是正）。

---

## ファイル構成

| ファイル | 責務 | 変更 |
| --- | --- | --- |
| `plugins/agent-policy/src/hooks/marker-scan.ts` | frontmatter parse・`.claude/agents` 走査・marker 対応表の生成(両フック共用) | Create |
| `plugins/agent-policy/src/hooks/session-start.ts` | 走査・表生成・役割ラベル解決を marker-scan へ委譲(注入文面は不変) | Modify |
| `plugins/agent-policy/src/hooks/subagent-start.ts` | SubagentStart フック本体(deny-list 判定・断片合成・注入) | Create |
| `plugins/agent-policy/references/subagent-discipline.md` | 注入断片の静的正本(宣言+規律要約) | Create |
| `plugins/agent-policy/references/orchestration-discipline.md` | 「委譲先の実行モデルの確定」節の全面改訂・読者明示・アドバイザー条項の是正 | Modify |
| `plugins/agent-policy/skills/{claude-model,with-codex,with-grok,codex-grok}-policy/SKILL.md` | 読者宣言・dispatch 節・実行帯の解決順の追随 | Modify |
| `plugins/agent-policy/skills/setup-agents/SKILL.md` | marker の意味拡張の追記 | Modify |
| `plugins/agent-policy/hooks/hooks.json` | `SubagentStart` エントリ追加・description 更新 | Modify |
| `plugins/agent-policy/build.ts` | entryPoints へ `subagent-start` 追加 | Modify |
| `plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts` | parser・走査・表生成・SessionStart との同一性 | Create |
| `plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts` | deny-list・照合・合成・fail-open | Create |
| `plugins/agent-policy/src/hooks/__test__/session-start.test.ts` | 既存回帰(無修正で全通過が原則) | Modify(必要時のみ) |
| `plugins/agent-policy/README.md` | marker 意味拡張(説明節+「旧バージョンからの移行」節への告知)・SubagentStart の説明・「動作要件」節の更新 | Modify |
| `README.md`(ルート) | agent-policy の変更反映 | Modify |
| `harness-docs/ARCHITECTURE.md` | フック構成と新レイヤー依存の追随(metatron CLI 経由。直接編集しない) | Task 4 で追随 |

---

## Task 0: 着手時の再確認

- [ ] 最新 `git status` と現行 HEAD を確認し、計画作成時 baseline（HEAD `74071e6`・lint / typecheck / test 1878 件全通過・2026-08-27 記録）からの乖離を把握する。乖離が本計画の対象ファイルに及ぶ場合は着手前にユーザーへ報告する
- [ ] `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` で baseline が再現することを確認する

## Task 1: marker 走査の共通モジュール抽出

**Files:**
- Create: `plugins/agent-policy/src/hooks/marker-scan.ts`
- Modify: `plugins/agent-policy/src/hooks/session-start.ts`
- Test: `plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts`

**Interfaces (Produces):**

```ts
export interface MarkedAgent {
  name: string
  model: string | undefined
  roles: string[]
  /** undefined = tools 欄なし・解釈不能(全ツール継承として扱う) / 値あり = 明示リスト */
  tools: string[] | undefined
}
/** raw は frontmatter の tools 値(block 配列の場合は収集済みの要素列)。解釈不能な形式は undefined */
export function parseToolsField(raw: string | string[] | undefined): string[] | undefined
/** 存在しない・読めないディレクトリは [] を返す(throw しない)。走査の fallback 動作(frontmatter 失敗時のみ skip、他は必ず積む)は現行 scan と同一 */
export function scanAgents(dir: string | undefined): MarkedAgent[]
/** 役割 ID → 表示ラベル。現行 labelOf と同一の解決(カスタム役割断片を含む)。projectDir を引数で受け、モジュールスコープのキャッシュを持たない(1 回の解決内の重複は呼び出し側の Map で保持) */
export function roleLabel(env: NodeJS.ProcessEnv, role: string): string | undefined
/** 両フックが同一文面で使う対応表。文面は現行 markerBlock と同一。marker 0 件なら undefined(固定文への変換は呼び出し側フックの責務) */
export function markerTable(env: NodeJS.ProcessEnv, marked: MarkedAgent[]): string | undefined
```

**frontmatter parser の拡張範囲(限定):**

- block 配列の収集は **`tools` キーに限定**する(`tools:` の値が空文字で、直後に `- <item>` の連続行が続く場合のみ、連続が切れるまでの行を要素として収集)。**他のキーの解釈は 1 文字も変えない**(`agent-policy-role:` の block 記法は現行どおり空値=役割なしのまま。変えると SessionStart の対応表・警告が変わる)
- flow 配列(`[Read, Agent]` / `["Read", "Agent"]`)は現行 parser の値文字列のまま取得でき、`parseToolsField` 側で解釈する(parser 本体は変更しない)

**`parseToolsField` の解釈規則:**

- カンマ区切り文字列(`Read, Agent`)→ split + trim
- flow 配列 → 先頭 `[`・末尾 `]` を除去 + split + trim + 各要素の引用符除去(`"'Read'"` → `Read`、`"\"Agent\""` → `Agent`)
- 収集済み block 要素列 → trim + 引用符除去
- 値が空文字で block 要素なし → `undefined`(**空配列 `[]` にしない**。`[]` は「Agent 無し = deny」に化ける)
- 上記のどれにも当てはまらない解釈不能な非空形式 → `undefined`(注入側へ倒す。設計 §7)
- 欄なし → `undefined`

- [ ] **Step 1(テスト先行):** 上記の全形式 + 「値空で block 無し → undefined」+ 解釈不能形式 → undefined + 引用符付き要素 + `agent-policy-role` の block 記法が現行どおり無視されること + 既存 marker/model 抽出の回帰 + **`claude-model-policy` / `codex-grok-policy` 両方の env と複数 marker 宣言の定義で、`markerTable` の出力が SessionStart 注入内の対応表ブロックと文字列一致すること**、を `marker-scan.test.ts` に失敗する状態で書く
- [ ] **Step 2:** `session-start.ts` から `frontmatter` / `scan` / `Marked` / `markerBlock` / `labelOf` を `marker-scan.ts` へ移して上記 API に整える。`LABELS` のモジュールスコープキャッシュは廃止する。`session-start.ts` 側の `unknownRoleBlock` / `setupBlock` / `retiredBlock` / `build` は import で動かし、**注入文面は 1 文字も変えない**
- [ ] **Step 3:** `marker-scan.test.ts` 全通過。`session-start.test.ts` は無修正で全通過

## Task 5: `orchestration-discipline.md` の改訂

（Task 2 より先に行う。断片の整合確認の基準になるため）

**Files:**
- Modify: `plugins/agent-policy/references/orchestration-discipline.md`

`prompt-smith:prompt-smith` を起動して文面を確定する。次を必ず含める。

- [ ] **Step 1:** 冒頭に読者を明示(正本の読者はオーケストレーター。「サブエージェントは〜」条項は生成定義の本文・SubagentStart の注入断片・依頼文への転記で届く)
- [ ] **Step 2:** 「モデル別役割の運用」節の 2 条項を是正 — 現行 L14「軽量な実装の帯以外のサブエージェントに Agent Tool を許可する」を「軽量な実装の帯と**アドバイザーの帯**以外の〜」へ(現行 L17 と整合)。現行 L15「相談する相手を `Fable` にする」を「対応表にアドバイザー帯の定義があればそれを、無ければ `Fable`(不可なら `Opus`)」へ(設計 §5・`_common.md` と一致)
- [ ] **Step 3:** 「委譲先の実行モデルの確定」節を全面書き換え — 起動形態 3 種の定義 / 判定フロー 8 行(適用除外 1〜5 → モデル注入 → 合成 2 行。適用除外 3 の allow-list は `name` / `description` / `model` / `tools` / `color` / `agent-policy-role` — 設計是正済み) / 適用除外 2 の具体手順(原本確認は project `.claude/agents/` → user `~/.claude/agents/` → プラグイン実体 `agents/` の順。dispatch に使われる実体と同一の定義を読めた確証がなければそのまま起動) / 合成手順(ホスト選定・役割冒頭明示・本文同梱・禁止条項優先・義務衝突時は合成回避)。**現行の GPT/Grok 帯「定義本文を同梱して dispatch」の手順はこの合成手順へ正本を移す** / tools 規則 2 本と読み取り overlay / 固有 MCP の序列(ユーザー提案・既存 MCP 全集合の注意・**付与が永続変更であること・サーバー単位許可は外部のツール単位 allowlist より広くなること**・自動実行禁止) /「迷ったら合成しない」/ この節の判定は名指し dispatch のたびに行う(「実行帯の解決順」の再判定不要則は役割ベース dispatch に限る旨を明記)
- [ ] **Step 4:** 「サブエージェントは、依頼文で指定されたスキルだけをロードする」に方針スキルが含まれることを明確化

## Task 2: `references/subagent-discipline.md` 新設

**Files:**
- Create: `plugins/agent-policy/references/subagent-discipline.md`

`prompt-smith:prompt-smith` を起動して文面を確定する。次を入力素材とする。

**必ず含める要素:** (1) 「あなたはサブエージェントである」宣言 / (2) 対応表挿入位置のマーカー行 `<!-- marker-table -->` / (3) 再委譲時は対応表の委譲先を担当表より優先 / (4) アドバイザー相談は対応表の「設計・計画・実装のアドバイザー」を優先、無ければ `Fable` → `Opus`。アドバイザーには Agent tool を許可せず「助言のみを返し、作業はしない」と明記 / (5) 読み取りの役割を実装帯の定義へ再委譲するときは「ファイルを変更しない・報告のみを返す」を明記 / (6) 依頼文で指定されないスキル(方針スキルを含む)をロードしない

**含めてはならない要素:** 方針スキルの使用指示 / 軽量帯への Agent tool 禁止(profile 依存 — with-grok-policy では軽量帯 = Grok に Agent が許可される。discipline と各方針スキル側に置く。設計 §5 に反映済み)

**サイズ:** マーカー行を除く静的部分が約 300 token(450〜600 字)に収まること。

- [ ] **Step 1(テスト先行の例外):** 文書のみのタスクのためテストは Task 3 側で担保する。prompt-smith 起動の上で作成し、要素の充足を確認する
- [ ] **Step 2:** Task 5 改訂後の `orchestration-discipline.md` のサブエージェント条項と文意が食い違わないことを突き合わせる

## Task 3: `subagent-start.ts` 新設

**Files:**
- Create: `plugins/agent-policy/src/hooks/subagent-start.ts`
- Test: `plugins/agent-policy/src/hooks/__test__/subagent-start.test.ts`

**入力:** stdin の JSON。最小フィクスチャ: `{"hook_event_name":"SubagentStart","agent_type":"<型名>","cwd":"<dir>"}`。**stdin は 2 秒のタイムアウト付きで読む**(EOF が来ない環境で hooks timeout の 10 秒までブロックしないため。metatron の既存実装と同型)。タイムアウト・parse 失敗 → stderr 1 行 + exit 0 無出力。**有効 JSON で `agent_type` が欠落・空の場合は未知 type として注入する**(過剰配布側)。

**プロジェクトディレクトリ解決:** **`CLAUDE_PROJECT_DIR` のみを使う**(SessionStart と同一。`cwd` フォールバックは行わない — 親子で対応表が同一になることを優先する。他プラグインの 3 段フォールバック慣行からの意図的な逸脱であり、コード内コメントではなく本計画とテストで固定する)。未設定なら project 走査なし(対応表は固定文、deny-list はビルトインと同梱のみ)。

**出力:** stdout に次の JSON のみ(DEBUG 出力は stderr)。

```json
{ "hookSpecificOutput": { "hookEventName": "SubagentStart", "additionalContext": "<断片>" } }
```

**照合規則(順序付き):**

1. **完全形一致**(大文字小文字を区別する)を先に試す — project 定義の `name` / 同梱定義の `name` と `agent-policy:<name>` / ビルトイン `Explore`・`Plan` の各完全形。一意に当たればその定義で判定する
2. 完全形で当たらないときのみ**末段一致**(末段 = 最後の `:` より後。`:` 無しは全体)で project / 同梱を引く
3. 末段一致で**複数の定義にヒットしたら、deny 判定をせず注入する**(名前解決が曖昧なため。「一意に特定できた」が deny-list 規則 1 の前提)

**deny-list(注入しない条件。それ以外はすべて注入):**

1. 照合で一意に特定できた project / 同梱定義が `tools` を持ち(`undefined` でなく)、`Agent` を含まない
2. ビルトイン `Explore` / `Plan`(完全形一致。実際の入力表記は Task 8 で確認し、不一致なら追随する)

**断片合成:** `${CLAUDE_PLUGIN_ROOT}/references/subagent-discipline.md` を読み、`<!-- marker-table -->` 行を `markerTable(env, projectAgents)` の出力で置換する。`markerTable` が `undefined` のときは**フック側で**固定文「対応表なし(このプロジェクトに役割マーカー付き定義は無い)」に変換する。対応表は **project 走査の結果だけ**から生成する(同梱定義を混ぜない。SessionStart と同一の表にするため)。マーカー行が無ければファイル全文の直後に空行 + 表を連結。ファイルが読めなければ**対応表のみ**を注入(fail-open の優先順位)。全体が 9,500 字を超えたら要約側(表以外)を後方から行単位で削り、それでも超えるなら表側も後方から行単位で削る(表の導入文 = `markerBlock` の 1 行目と先頭の役割行は残す)。

- [ ] **Step 1(テスト先行):** `runTs`(`input` で stdin JSON)による失敗テストを書く — `Agent` 無し project 定義 → 注入なし / `Agent` あり・tools 欄なし・未知 type → 注入あり / 同梱定義は `agents/*.md` 実走査結果に従う(Agent 無し同梱 → 注入なし。名前ハードコード不可) / `Explore`・`Plan`(完全形) → 注入なし / 完全形優先 → 末段一致の順序 / 末段複数ヒット → 注入 / block 配列 tools の定義が正しく deny 判定される / 注入文が宣言と対応表を含み方針スキル指示を含まない / **注入文にアドバイザーの対応表優先の行が含まれる** / marker 0 件 → 固定文入りで注入あり / 断片ファイル欠落 → 対応表のみ / 同梱ディレクトリ欠落・`CLAUDE_PLUGIN_ROOT` 未設定 → throw せず継続 / `CLAUDE_PROJECT_DIR` 未設定 → project 走査なしで注入継続 / stdin parse 失敗 → exit 0 無出力 / stdin 無入力 → 2 秒タイムアウトで exit 0(テストの実測時間で確認) / `agent_type` 欠落・空 → 注入 / 9,500 字切り詰め(表単体超過を含む) / stdout が JSON のみ / **両 policy env で SessionStart の対応表ブロックと同一の表が注入される**
- [ ] **Step 2:** 実装(stdin 読取 → 照合・deny 判定 → 合成 → 出力。全体 try/catch で exit 0)。`AMATSUKA_AGENT_SUBSTART_DEBUG=1` のときだけ判定内訳(照合結果・deny 判定・断片サイズ)をテキスト行で stderr へ出す
- [ ] **Step 3:** 全テスト通過

## Task 4: フック登録・バンドル・ARCHITECTURE 追随

**Files:**
- Modify: `plugins/agent-policy/hooks/hooks.json` / `plugins/agent-policy/build.ts`

- [ ] **Step 1:** `build.ts` の `entryPoints` に `"subagent-start": "./src/hooks/subagent-start.ts"` を追加
- [ ] **Step 2:** `hooks.json` に `SubagentStart` エントリを追加(`node "${CLAUDE_PLUGIN_ROOT}/scripts/subagent-start.mjs"`、timeout 10 — 既存 SessionStart と同値)。`description` を二段フック構成の説明へ更新
- [ ] **Step 3:** `pnpm run build`。`scripts/` 差分を同じコミットに含める
- [ ] **Step 4:** **`/metatron:update` を実行し、フック構成の変更と「配布物層が参照層を実行時に読む」新依存方向を ARCHITECTURE のレイヤー記述へ追随させる**(依存の発生と同時期に反映する。Task 8 まで遅らせない — レイヤー契約に無い方向の依存を持つ中間状態を作らないため)

## Task 6: 方針スキル・setup-agents・README の追随

**Files:**
- Modify: `skills/claude-model-policy/SKILL.md` / `skills/with-codex-policy/SKILL.md` / `skills/with-grok-policy/SKILL.md` / `skills/codex-grok-policy/SKILL.md` / `skills/setup-agents/SKILL.md` / `plugins/agent-policy/README.md` / ルート `README.md`

`prompt-smith:prompt-smith` を起動して文面を確定する。

- [ ] **Step 1:** 4 方針スキル冒頭の「あなたはオーケストレーターまたはそのサブエージェントである。」→「あなたはオーケストレーターである。」
- [ ] **Step 2:** GPT/Grok dispatch 節(with-codex / with-grok / codex-grok。codex-grok は GPT 節と Grok 節の両方)を改訂する。**「定義ファイルを持つ Agents は本文を同梱して dispatch」の手順の正本は discipline の合成手順(Task 5)へ移し**、スキル側は「合成 dispatch は共通規律の該当節に従う」への参照と、profile 固有の差分(読み取り制限の文言・Output Format 指定等)だけを残す。「このとき `model` 上書きは使わない」は「外部 Agent の enum 宣言を適用する場合を除き、`model` 上書きは使わない」へ改める。役割ベースの帯実行(marker 定義・同梱プリセットへの直接委譲)の記述は現行維持
- [ ] **Step 3:** 4 スキルの「実行帯の解決順」に「この節は役割ベース dispatch の解決順であり、名指し dispatch は共通規律の判定フローに従う」の 1 文を追加
- [ ] **Step 4:** setup-agents スキルの marker 説明と、plugin README の marker 説明節 +「旧バージョンからの移行」節に、marker の意味拡張(帯参加 + 合成ホスト候補)を追記する。移行節には「利用者の作業は不要。合成ホストにしたくない定義は marker を外す(opt-out)」を明記する。README「動作要件」節に SubagentStart フック(Node.js・発火条件)を追記。ルート README に SubagentStart 配布の 1 行を追記
- [ ] **Step 5:** 文書検証(チェックリスト) — (a) discipline・4 方針スキルを「本文を同梱」「そのまま起動」「model 上書きは使わない」で grep し、各出現箇所が新決定則(設計 §1)と整合するか 1 件ずつ判定する(旧文脈の残置 = 判定フローを経ない常時合成・無条件そのまま起動の記述が残っていないこと) / (b) 読者宣言が 4 スキルとも訂正済み / (c) 断片(Task 2)と discipline のサブエージェント条項が一致

## Task 7: バージョン・全体検証

- [ ] `plugin.json` / `package.json` を 0.13.0-dev に揃えて上げる
- [ ] `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` 全通過。`scripts/` 差分が対応する `src/` 変更と同じコミットにあること

## Task 8: 実装後検証(新セッション・実機)

- [ ] 新セッションで SubagentStart が発火し、実装帯サブエージェントに対応表が注入されることを確認(`AMATSUKA_AGENT_SUBSTART_DEBUG=1`)
- [ ] プラグイン定義の dispatch(例: chat-recorder の自動記録)で入力 `agent_type` の形式を確認し、照合実装の想定と一致することを確認(設計 §8.6 残項目)。ビルトイン `Explore` の実際の入力表記も確認し、deny-list の完全形と不一致なら追随する
- [ ] **機械契約 Agent への注入副作用の確認** — chat-recorder の自動記録が注入後も正常に完走し、記録以外の行動(再委譲・スキルロード)を始めないことを 1 回分の記録で確認する。加えて Agent tool を持たない他プラグイン定義 1 種(例: raphael の蒸留エージェント)でも同様に確認する
- [ ] 設計 §8.8: 合成 dispatch の一連(役割冒頭明示・外部本文同梱・enum 宣言値の適用・tools 規則)を代表 1 ケースで手動実測
- [ ] 設計 §8.9: 実装帯ホストからのアドバイザー再委譲で、注入された対応表の advisor が選ばれることを手動実測
- [ ] 移行期の運用条件(設計書該当節)の残存を確認し、緩和されるのは親子 map 非仮定のみであることを完了報告へ明記
