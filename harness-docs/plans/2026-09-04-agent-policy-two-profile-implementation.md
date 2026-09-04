# agent-policy 2 プロファイル化(claude / custom)実装計画書

- 作成日: 2026-09-04
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.13.1-dev` → `0.14.0-dev`
- 設計書(正本): `harness-docs/design/2026-08-31-agent-policy-two-profile-design.md`
- context-map: `.claude/context-maps/2026-08-31-agent-policy-two-profile.md`
- 着手時の HEAD: `765e64e`
- baseline: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` はいずれも成功(153 ファイル / 1930 passed / 2 skipped)
- 版注: 第 2 版。doc-review 帯と independent-review 帯の指摘を反映し、フェーズ順序を組み替えた。主な変更は §3 の「同梱プリセット廃止を最前に移す」「`policies.ts` の再構造を単独フェーズへ隔離する」「各タスクにテストファイルのパスと共有契約を明記する」である。

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、設計判断を上書きしない。設計書と実装が食い違う事実を見つけたときは、実装を止めてユーザーへ報告する。

## 1. 実装前の実機検証

設計書 §10 のうち、実装前に確認できるものを実施した。確認できた範囲では設計どおりであり、設計書の修正は不要である。

| # | 検証項目 | 実測結果 | 判定 |
| --- | --- | --- | --- |
| 1 | dispatch の `tool_name` | `Agent`(Claude Code 2.1.260)。matcher `Task\|Agent` の exact 列挙で捕捉できる | 設計どおり |
| 2 | `additionalContext` の到達 | PreToolUse から注入した文字列が次のアシスタント応答に反映された | 設計どおり |
| 3 | matcher の解釈 | `Glob` と `Task\|Agent` は exact、`Ba.*` は Bash に、`mcp__.*` は `mcp__echo__ping` に一致 | 設計どおり(正規表現として評価される) |
| 4a | シェル環境の変数がフックへ継承されるか | SessionStart の実行環境に `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_PROJECT_DIR` が見えた | 設計どおり |
| 4b | `settings.json` の `env` へ置いた場合 | **未検証**。設計書 §10-4 は両方を求めているが、実測したのはシェル継承だけである | T17 へ回す |
| 5 | `/v1/models` の認証 | Bearer は 200。無認証は 401 `{"error":"Missing API key"}`、不正な `x-api-key` は 401 `{"error":"Invalid API key"}`。`owned_by` は 8 件すべて小文字(`anthropic` / `openai` / `xai`) | 設計どおり |
| 追加 | `agent_id` の有無 | サブエージェント側のツール呼び出しにだけ `agent_id` と `agent_type` が付く。メインセッションには無い | gate の判定フロー 3 が成立 |
| 追加 | glob 実装の手段 | Node 26 の `node:path` に `matchesGlob` がある | gate は自前実装を持たずに済む |

検証に使った一時プロジェクト(`/tmp/ap-probe`)はリポジトリ外であり、成果物は残さない。§10 の 6(旧 injection 値の移行通知)・7(hooks 追加の発火)・8(gate の deny 文言)と、上表 4b はフェーズ 6 の T17 で確認する。

## 2. 進め方の共通規律

- 各タスクはテストを先に書いてから実装する(設計書 §12)。テストのパスは各タスクの表に明記する。
- `plugins/agent-policy/scripts/` と `agents/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する。
- フックは fail-open(例外時は stderr へ 1 行、exit 0、ファイルを書かない)を維持する。
- Anthropic API クライアントを追加しない。`live-models` は Node 標準 `fetch` だけを使う。
- 委譲するタスクの依頼文には、対象ファイル・テストのパス・テスト先行・使用してよい tools・報告形式・§4 の共有契約を転記する。方針スキルはロードさせない。
- 同一フェーズ内のタスクは 1 メッセージで並列に dispatch する。フェーズ間は直列とする。
- **`pnpm run typecheck` が全体で通ることを完了条件にできるのは、フェーズ 3 を除く全フェーズである。** フェーズ 3 だけは型エラーの残る中間状態を許容し、その範囲を §3 に明示する。

## 3. タスク分割

### フェーズ 0: 同梱プリセットの廃止(直列 1)

設計書 §4.3 の廃止を**最初に**行う。`presets.ts` はモジュール初期化時に `rolesAcrossPolicies()` を呼び(`src/agents/presets.ts:21-29`)、それを `session-start.ts:7` が import している。この依存を先に断たないと、後続で `rolesAcrossPolicies` を消した瞬間に、`marker-scan.test.ts:17` と `subagent-start.test.ts:13` が `session-start.ts` を子プロセス実行しているために実行時エラーで落ちる。

| ID | 内容 | 対象 | 帯 |
| --- | --- | --- | --- |
| T0 | `presets.ts` / `build-presets.ts` と `agents/*.md` 4 件を削除。`build.ts` から `buildPresets` の呼び出しと import を除去。`session-start.ts` から `setupBlock` / `ALIASES` / presets の import を削除し、`retiredBlock` の Grok エイリアス案内行も削除。`policy-skill-assignments.test.ts` の `POLICY_SKILLS` を `Partial<Record<PolicyName, string>>` にして claude-model-policy 1 件へ縮退 | `src/agents/presets.ts`(削除) / `src/agents/build-presets.ts`(削除) / `agents/`(削除) / `build.ts` / `src/hooks/session-start.ts` | 通常の実装 |

削除するテスト: `src/agents/__test__/presets.test.ts` / `src/agents/__test__/build-presets.test.ts`。
書き換えるテスト: `src/agents/__test__/policy-skill-assignments.test.ts`(4 方針前提の解消) / `src/hooks/__test__/session-start.test.ts`(`setupBlock` 前提ケースの削除) / `src/hooks/__test__/subagent-start.test.ts`(同梱 `agents/` 走査ケースの整理)。

`agents/*.md` は保護パス(バンドル出力)である。`build.ts` から `buildPresets` を外したうえで削除する。削除操作がクラシファイアに拒否された場合は、絶対パスを提示してユーザーの手で実行してもらう。

- 完了条件: `pnpm run build` の後、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` がすべて通る。`agents/` が空である。この時点でリポジトリは baseline と同じく全 green に戻る。

### フェーズ 1: 追加変更(並列 4 / 既存の挙動を壊さない)

| ID | 内容 | 対象 | テスト | 帯 |
| --- | --- | --- | --- | --- |
| T2 | live models クライアントを新設 | `src/agents/live-models.ts`(新規) | `src/agents/__test__/live-models.test.ts`(新規)、フェイクサーバーは `src/testing/fake-models-server.ts`(新規) | 通常の実装 |
| T4 | 並列促しフックを新設 | `src/hooks/parallel-nudge.ts`(新規) | `src/hooks/__test__/parallel-nudge.test.ts`(新規) | 軽量な実装 |
| T5 | `Vendor` に `none` を追加し、`agent-policy-vendor` を frontmatter へ出力。`ComposeInput.modelId` と `allowsAgentTool` の第 2 引数を optional 化 | `src/agents/fragments.ts` / `src/agents/compose.ts` / `src/agents/policies.ts`(`allowsAgentTool` のシグネチャのみ) | `src/agents/__test__/fragments.test.ts` / `src/agents/__test__/compose.test.ts` | 通常の実装 |
| T6 | `MarkedAgent` に `vendor` 欄を追加し、`markerTable` の各行へ `(gpt)` 等を添記 | `src/hooks/marker-scan.ts` | `src/hooks/__test__/marker-scan.test.ts` | 軽量な実装 |

- T2 の検証: `data[].id` と `owned_by` のパース(大小文字・欠落)、reason 分類(`no-base-url` / `http-<status>` / `timeout` / `parse-error`)、認証フォールバック(Bearer → x-api-key → 無認証)、例外を上へ投げない契約。フェイクサーバーは `server.listen(0)` で割り当てたポートを使う(vitest は `pool: "forks"` でファイル並列のため、固定ポートは衝突する)。
- T4 の検証: 固定 `additionalContext` の出力、opt-out 値(trim + 小文字化して `0` / `false` / `off`)での無出力、それ以外の値での出力。
- T5 の検証: `vendor: "none"` で overlay を読まず色が `blue` になること、`agent-policy-vendor` が `none` のとき frontmatter へ出力されないこと、`modelId` 省略時に役割ベース判定だけで `Agent` の可否が決まること。**`fragments.ts` の `Vendor` 型と `compose.ts` の `COLORS` の双方を変更する。** `loadFragments` へ `"none"` を渡さない(呼び出し側で `undefined` へ畳む)ことをテストで固定する。
- T6 の検証: `vendor` 欄の解釈、`agent-policy-vendor` を持たない既存定義で添記が出ないこと。既存の「SessionStart 注入と同一の対応表」ケース(`marker-scan.test.ts:317-341`)は `markerTable()` の戻り値との比較であり、行の形式が変わっても追随する。

- フェーズ 1 の完了条件: 4 タスクすべてのテストと、`pnpm run typecheck` / `pnpm run test` の全体が通る。

### フェーズ 2: フェーズ 1 の成果物に依存する変更(並列 2)

| ID | 内容 | 対象 | テスト | 帯 |
| --- | --- | --- | --- | --- |
| T3 | delegation gate を新設。判定フロー 8 段、`--direct on\|off\|status` の CLI モード、設定ファイル読み取り、deny JSON の生成 | `src/hooks/delegation-gate.ts`(新規) | `src/hooks/__test__/delegation-gate.test.ts`(新規) | 複雑または重要な実装 |
| T7 | 対応表の合成を injection が custom 系のときだけに限定。規律断片は全分岐で配布 | `src/hooks/subagent-start.ts` | `src/hooks/__test__/subagent-start.test.ts` | 通常の実装 |

T3 は `marker-scan.ts` の `scanAgents` / `markerTable` を再利用する(設計書 §8.2)。T6 で `markerTable` の行形式が変わるため、T3 は**固定文字列を期待値に置かず、`markerTable()` の戻り値と比較する**。

T7 の custom 系判定は §4 の共有契約 `isCustomInjection` を使う。この関数はフェーズ 3 の T1 で `policies.ts` へ置くため、**T7 は先に `subagent-start.ts` 内のローカル関数として同一仕様で実装し、T1 の完了後に `policies.ts` からの import へ差し替える**(差し替えは T1 の作業に含める)。

- T3 の検証: opt-in 値域(有効は `1` / `true` / `on` のみ)、`agent_id` があれば素通し、設定ファイルなし・`denyGlobs` 空、TTL 解除フラグ、対象外ツール、プロジェクトルート外のパス、glob 一致での deny、`mcpTools` のパス取り出し(`absolute` の true / false 両方)、deny 文言に対応表が載ること、fail-open、`--direct on|off|status` の 3 モード。glob 判定は `node:path` の `matchesGlob` を使う。
- T7 の検証: injection が `custom` と旧 3 値のときだけ対応表が合成されること、`none` / `claude` / 未知値では「対応表なし」の既存文言になること、規律断片は全分岐で配布されること、大小文字と前後空白の正規化。

- フェーズ 2 の完了条件: 2 タスクのテストと全体の `typecheck` / `test` が通る。

### フェーズ 3: 担当表正本の再構造(直列 1 / 型エラーの残る唯一のフェーズ)

| ID | 内容 | 対象 | テスト | 帯 |
| --- | --- | --- | --- | --- |
| T1 | `PolicyName` を 2 値へ、`POLICIES` を 2 件へ、`ASSIGNMENTS` を `Record<"claude-model-policy", ...>` へ。`RECOMMENDED` を新設。`aliasEnv` / `resolveModelValue` / `rolesAcrossPolicies` を廃止。`modelsFor` / `rolesFor` のシグネチャを claude-model-policy 専用へ。`isCustomInjection` を新設し、T7 のローカル実装をこの import へ差し替える | `src/agents/policies.ts` / `src/hooks/subagent-start.ts`(import 差し替えのみ) | `src/agents/__test__/policies.test.ts` | 複雑または重要な実装 |

- T1 の検証:
  - `POLICIES` が 2 件で、`injection` が `claude` と `custom` であること。
  - `RECOMMENDED` が RoleId 10 種を網羅し、**その値が現行 `ASSIGNMENTS["codex-grok-policy"]` と完全に同一であること**(設計書 §5.1 が値の継承を固定している)。
  - `ASSIGNMENTS["claude-model-policy"]` が現行値と一致すること。
  - `aliasEnv` / `resolveModelValue` / `rolesAcrossPolicies` への参照が `src/` から消えていること。
  - `isCustomInjection` が `custom` と旧 3 値を true、`claude` / `none` / 空 / 未設定 / 未知値を false にすること。前後空白と大小文字を正規化すること。
  - `allowsAgentTool` が `modelId` 省略時に役割ベース判定だけを行うこと。
- **許容する中間状態**: このタスクの完了時点で `tsc --noEmit` のエラーが `src/setup-agents.ts` と `src/hooks/session-start.ts` の 2 ファイルに限定されていること。それ以外のファイルにエラーが出た場合は、その原因を解消してから完了とする。`policies.test.ts` は通ること。他のテストは `setup-agents.test.ts` を除いて通ること。

### フェーズ 4: 消費側(並列 2)

| ID | 内容 | 対象 | テスト | 帯 |
| --- | --- | --- | --- | --- |
| T8 | SessionStart を設計書 §6 へ改訂 | `src/hooks/session-start.ts` | `src/hooks/__test__/session-start.test.ts` | 複雑または重要な実装 |
| T9 | setup-agents を custom 専用へ再設計 | `src/setup-agents.ts` | `src/__test__/setup-agents.test.ts` | 複雑または重要な実装 |

T8 の作業内容: 3 値 + 旧 3 値の分岐(trim + 小文字化)、custom 検証フロー(マーカー付き定義 0 件 / 全 Claude 構成で照会なし / 不在 / 照会失敗)、全体一括フォールバックと不在定義の列挙(最大 10 件 + 「他 N 件」)、移行通知、非推奨通知(`AMATSUKA_AGENT_*_ALIAS` の 4 変数)、対応表と未知役割通知を custom 成立時のみ出すこと。検証対象の `model` から Claude enum・`inherit`・`model` キー欠落を除外すること。

T9 の作業内容: `--policy` / `--list-policies` / `--list-models` の廃止、`--list-live-models` の新設、`--vendor <gpt|grok|claude|none>` の再導入、`--model` の実在検証、`--models` の間引きと照会失敗時の警告付き全生成、`--list-coverage` を `RECOMMENDED` の被覆へ意味変更、`requirePolicy` / `requireModel` / `validateRoles` / `targetsFor` / `defaultAgentName` / `listAvailableRoles` の custom 前提への書き換え、`agent-policy-vendor` の出力。

- T8 の検証: 設計書 §12 の分岐を全網羅する。すなわち none / claude / custom / 旧 3 値 / 未知値 / 大小文字と前後空白、custom の成立・不在フォールバック・照会失敗フォールバック・マーカー付き定義 0 件・全 Claude 構成(照会なし)・`inherit` と `model` 欠落の除外、claude と none で対応表が出ないこと、フォールバック時に対応表が出ないこと、非推奨通知、移行通知、いずれの分岐でもファイルを書かないこと。
- T9 の検証: 廃止フラグの拒否、`--list-live-models` の応答形(`{ok, reason?, models:[{id, vendor, recommendedFor}], claudeEnums}`)、`--model` の実在検証 3 分岐(存在 / 不在で `ok:false` / 照会失敗で警告付き通過)、`--models` の照会成功時の間引きと落とした ID の報告・照会失敗時の警告付き全生成、`--vendor` の必須条件と `none` の扱い、`agent-policy-vendor` の出力、役割の自由割当(担当表制約の廃止)、プロジェクト独自役割の通過。**警告は CLI 応答 JSON の `warnings` 配列で返す**(stdout の JSON が唯一の応答経路であるため)。
- **既存テストの扱い**: `setup-agents.test.ts` の `check()` ヘルパー(`:186-202`)は `--policy with-codex-policy` を固定で渡している。「既存テストをそのまま通す」ことはできない。`--policy` を外した形へ書き換えたうえで、`--check` / `--write` / `--merge` / `--keep` の差分保護の検証内容を落とさないことを完了条件とする。差分保護の機構そのもの(`parseDocument` / `merge` / `automaticKeep`)は変更対象外である。

- フェーズ 4 の完了条件: `pnpm run typecheck` と `pnpm run test` の全体が通る。

### フェーズ 5: 宣言と文書(並列 2 + オーケストレーター)

| ID | 内容 | 対象 | 担当 |
| --- | --- | --- | --- |
| T11 | hooks.json へ PreToolUse 2 エントリを追加(gate は matcher `Edit\|Write\|NotebookEdit\|mcp__.*`、nudge は `Task\|Agent`、いずれも timeout 10)。`build.ts` へ 2 エントリを追加。description を 2 プロファイル前提へ | `hooks/hooks.json` / `build.ts` | 軽量な実装 |
| T12 | `custom-policy` スキルの新設、`claude-model-policy` の改訂、`setup-agents` スキルの改訂、旧 3 スキルの削除、文書検証テストの追随 | `skills/` / `src/agents/__test__/policy-skill-assignments.test.ts` | オーケストレーター(prompt-smith 系スキルを使用) |
| T13 | 共通規律の改訂 | `references/orchestration-discipline.md` | オーケストレーター(prompt-smith 系スキルを使用) |
| T14 | バージョンを `0.14.0-dev` へ揃え、README 2 件と marketplace.json を更新 | `plugin.json` / `package.json` / `plugins/agent-policy/README.md` / ルート `README.md` / `.claude-plugin/marketplace.json` | 軽量な実装 |

T12 の内訳(設計書 §4.2 / §7.2 の要件をすべて落とす):

- `custom-policy/SKILL.md` 新設 — 帯(RoleId 10 種)+ 推奨モデル列の担当表、ベンダー非依存の dispatch 共通節、実行帯の解決順(手順 2 の未割当帯の既定と independent-review の省略例外)、独立レビュー手順の role 化、セッション途中の不達規定、モデル × 役割を制約しないこと。
- `claude-model-policy/SKILL.md` 改訂 — 「役割マーカー付き定義の優先」節の削除と、「実行帯の解決順」手順 1 の削除。
- `setup-agents/SKILL.md` 改訂 — description(4 方針の列挙と「担当表上あり得ない組み合わせは選べない」の削除)、非対話モードの推奨構成一括生成への再設計、ステップ 1(ポリシー選択)の廃止と `--list-live-models` への置換、ステップ 1b の被覆の意味変更、ステップ 3 のプロキシ前提確認の live models 照会への統合、ステップ 4 のモデル選択の実在エイリアス化、ステップ 5b へのベンダー確認の追加、ステップ 7 の報告文面の 3 値化。
- 旧 3 スキルディレクトリの削除。
- `policy-skill-assignments.test.ts` の後継 — custom-policy の帯一覧が RoleId 10 種と一致し、推奨列が `RECOMMENDED` と一致すること。claude-model-policy は現行どおり `ASSIGNMENTS` と一致すること。

T13 の内訳:

- 「帯モデル」の定義(claude プロファイルでは担当表のモデル、custom プロファイルではマーカー解決した定義の `model`)。
- モデル注入起動の enum 読み替え先が `claude-model-policy` の同帯モデルであることの明文化。
- 合成判定の適用除外 3 の frontmatter allow-list へ `agent-policy-vendor` を追加(追加しないと setup 生成物がすべて合成不適格になる)。
- §原本の確認 の「プラグイン実体の `agents/`」の記述 — 同梱プリセット廃止後は空になるため、記述を実態に合わせる。

- T11 の検証: JSON として妥当であること。`pnpm run build` で 2 つの `.mjs` が生成されること。実際の発火は T17 で確認する。
- T12 の検証: 文書検証テストが通ること。
- T13 の検証: allow-list へ `agent-policy-vendor` が入っていること(T12 の文書検証テストか、目視のいずれかで確認する)。
- T14 の検証: 4 ファイルのバージョン表記と説明文が 2 プロファイルで揃っていること。

### フェーズ 6: 全体検証と追随

| ID | 内容 | 担当 |
| --- | --- | --- |
| T15 | `pnpm run build` → `pnpm run lint` → `pnpm run typecheck` → `pnpm run test`。`scripts/` の差分が `src/` の変更に対応していること | オーケストレーター |
| T16 | 変更差分のコードレビュー | sonnet-code-reviewer |
| T17 | 実機検証(下表) | オーケストレーター |
| T18 | `/metatron:update` で ARCHITECTURE を追随。`.serena/memories/` のうち方針スキル 4 本を前提とする記述を更新 | オーケストレーター |

T17 の検証項目と成功条件:

| 項目 | 手順 | 成功条件 |
| --- | --- | --- |
| §10-4b | `/tmp` のサンドボックスプロジェクトの `.claude/settings.json` に `env` で `ANTHROPIC_BASE_URL` を置き、シェル環境からは外して `claude -p` を起動する | SessionStart フックの実行環境にその値が見える |
| §10-6 | 同サンドボックスで `AMATSUKA_AGENT_AUTO_INJECTION=with-codex-grok` を設定して起動する | 注入文に custom 系の判定結果と、`custom` への変更を促す移行通知が 1 行出る |
| §10-7 | 同サンドボックスへ 0.14.0-dev のプラグインを読ませ、編集ツールと Agent tool を 1 回ずつ呼ばせる | gate(opt-in を有効化した場合)と nudge の両フックが発火する |
| §10-8 | gate を有効にし `denyGlobs` に一致するファイルを編集させる | deny が返り、その理由に委譲先候補が載る |

このリポジトリ自身の `AMATSUKA_AGENT_AUTO_INJECTION` と `.claude/settings.json` のローカル gate は変更しない(設計書 §8.4 のとおりスコープ外)。

## 4. タスク間で共有する契約

並列実装者が推測で決めないよう、次を依頼文へ転記する。

```ts
// T2 が定義し、T8 と T9 が使う
export interface LiveModels {
  ok: boolean
  baseUrl?: string
  ids: string[]
  vendors: Record<string, "gpt" | "grok" | "claude" | "unknown">
  reason?: string
}
export function fetchLiveModels(env: NodeJS.ProcessEnv): Promise<LiveModels>

// T5 が拡張し、T9 が使う
export type Vendor = "gpt" | "grok" | "claude" | "none"
export interface ComposeInput { /* ... */ modelId?: ModelId; vendor: Vendor }
// T5 が optional 化する(T1 ではなく T5 の担当。ComposeInput.modelId の optional 化と不可分のため)
export function allowsAgentTool(ids: RoleId[], model?: ModelId): boolean

// T6 が拡張し、T8 と T3 が使う
export interface MarkedAgent { name: string; model: string | undefined; roles: string[]; tools: string[] | undefined; vendor: string | undefined }

// T1 が定義し、T7 と T8 が使う(T7 は先行してローカルに同一仕様で持つ)
export function isCustomInjection(value: string | undefined): boolean
export const RECOMMENDED: Record<RoleId, ModelId[]>
export const ASSIGNMENTS: Record<"claude-model-policy", Record<RoleId, ModelId[]>>
```

## 5. 依存関係

```
T0 ─┬─ T2 ─┐
    ├─ T4 ─┤
    ├─ T5 ─┼─ T3 ─┐
    └─ T6 ─┴─ T7 ─┴─ T1 ─┬─ T8 ─┬─ T11 ─┬─ T15 ─ T16 ─ T17 ─ T18
                          └─ T9 ─┤  T12 ─┤
                                 │  T13 ─┤
                                 └─ T14 ─┘
```

- T0 を通すまで、後続のどのタスクも着手しない。T0 が `rolesAcrossPolicies` の利用者をゼロにする。
- T3 は T6 の `markerTable` を、T7 は T6 の表形式を前提にする。
- T1 は `setup-agents.ts` と `session-start.ts` の型を壊す。この 2 ファイルは T8 / T9 が直す。
- T11 は T3 / T4 のバンドル出力を前提にする。

## 6. 委譲先

セッションに注入された役割マーカー対応表に従う。

| 帯 | 委譲先 | 割り当てるタスク |
| --- | --- | --- |
| 複雑または重要な実装 | `gpt-sol-lead-implementer` | T3 / T1 / T8 / T9 |
| 通常の実装 | `gpt-terra-general-implementer` | T0 / T2 / T5 / T7 |
| 軽量な実装 | `gpt-luna-light-implementer` | T4 / T6 / T11 / T14 |
| コードレビュー | `sonnet-code-reviewer` | T16 |

`gpt-luna-light-implementer` には Agent tool を許可しない。委譲時は依頼文に「この tools のみ使用」と、迷いは相談ではなく差し戻しで解決することを明記する。

## 7. リスクと対処

| リスク | 対処 |
| --- | --- |
| モジュール初期化時の依存で、無関係なテストが子プロセス経由で落ちる | T0 で `presets.ts` の依存を先に断つ。フェーズ 1 以降は全体の test を各フェーズの完了条件に含める |
| フェーズ 3 で型エラーの残る中間状態が生じる | 許容する範囲を `setup-agents.ts` と `session-start.ts` の 2 ファイルに限定し、それ以外にエラーが出たら解消してから完了とする |
| `markerTable` の行形式変更で、gate のテストが後から落ちる | T3 のテストは固定文字列ではなく `markerTable()` の戻り値と比較する |
| フェイクサーバーの固定ポートが並列実行で衝突する | `listen(0)` でエフェメラルポートを使う |
| `isCustomInjection` の判定が T7 と T8 でずれる | T7 は先行してローカルに同一仕様で実装し、T1 の完了時に共通実装へ差し替える |
| `setup-agents.test.ts` の書き換えで差分保護の検証が痩せる | `--merge` / `--keep` の検証内容を落とさないことを T9 の完了条件に含める |
| 並列 dispatch した実装が同じファイルへ書き込む | 同一フェーズ内のタスクは対象ファイルが重ならないように分割済み。依頼文で対象ファイルを明示する |
| 同梱プリセット削除がクラシファイアに拒否される | 絶対パスを提示してユーザーの手で実行してもらう |
| hooks.json の変更が全セッションへ波及する | gate は opt-in、nudge は opt-out 可。T17 で新セッションの発火を確認する |
| 本改修と無関係な未コミット変更(raphael 抗体・会話記録)を巻き込む | コミット対象を `plugins/agent-policy/` と関連文書に限定し、既存の未追跡ファイルは触らない |

## 8. Done 条件

設計書 §14-5 と同一である。

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `src/` の変更に対応する `scripts/` の差分と `agents/` の削除が同じコミットにある。
- `plugin.json` と `package.json` が揃って `0.14.0-dev` である。
- ルート README・プラグイン README(移行節)・`.claude-plugin/marketplace.json` に反映済みである。
- hooks.json の追加エントリが新セッションで発火することを確認済みである。
- `/metatron:update` で ARCHITECTURE を追随させている。
- `.serena/memories/` のうち方針スキル 4 本を前提とする記述を更新している。
