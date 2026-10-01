`plugins/codiel/raguel-mcp` — the MCP server backing Codiel's gating (DESIGN.md: 「他の天使たちの
行いを監視する天使 Raguel」). Inspects AI-produced artifacts (decisions, designs, plans, code diffs)
and returns a machine PROCEED / ASK / STOP verdict; the only human touchpoint is ASK/STOP.

Parent plugin: `mem:codiel/core` (codiel 1.0.0-dev). 2026-09-29 に作り直し済み(設計書
`harness-docs/design/2026-09-28-raguel-redesign-design.md`、計画書 `harness-docs/plans/2026-09-29-raguel-redesign-plan.md`、
ADR-011)。codiel との取り決めは `plugins/codiel/docs/raguel-contract.md` が正本で、フェーズの表・ケースファイルの配置・
記録の形・裁定の組み合わせ・pass-gate の検査を持つ。`raguel-mcp/docs/DESIGN.md` も作り直しに合わせて書き直してあり、
食い違ったときは設計書と契約の文書を優先する。

Own workspace package (`raguel-mcp`, 0.0.2-dev in `package.json`; the MCP server reports the same value via
`BUILD_VERSION`, embedded by `build.ts`), but built/tested via the **root** toolchain
(`mem:suggested_commands`). `build.ts` → `dist/server.mjs`, committed and wired as the `raguel`
server in `plugins/codiel/.mcp.json`.

## Source layout (`src/`)

- `core/` — verdict computation, rule weighting, cross-rule invariants, logging; `pipeline.ts` runs
  `evaluateArtifact`. Has a golden test (`__test__/pipeline.golden.test.ts`).
- `rules/` — the gating checks by artifact type: `decision/`, `plan/`, `code/`, plus `common/`
  (secrets, injection markers, resubmission-loop detection, max-size). `registry.ts` wires rules
  per artifact type; `params.ts` は規則のパラメータの表。
- `panel/` — LLM-judge layer. パネリストは `panelists/` の adversarial・steelman・crosscheck・meta の 4 つ
  (assumption と precedent は撤去済み)。`rubrics.ts` で採点し、`runner.ts`/`prompts.ts`/`schema.ts` が進行する。
  プロバイダーは `provider.ts` の `JudgeProvider` 越しに `claudeCli.ts`(`claude -p`)か `codexCli.ts`(`codex exec`)を呼ぶ子プロセスで、
  **Anthropic API は使わない**(`mem:core` invariant)。既定は claude(`judge.provider`、パネリストごとに `panel.perPanelist.<役>.provider`/`model`)。
  隔離の引数: claude は `--setting-sources project`・`--tools ""`・`--strict-mcp-config`・`--no-session-persistence`・呼び出しごとの空の cwd
  (`--bare` と空の設定は認証を外すので使わない)。codex は `--ephemeral`・`--ignore-user-config`・`--sandbox read-only`・
  `--disable shell_tool/unified_exec/hooks`・`--output-schema`。実行ファイルは `RAGUEL_CLAUDE_BIN`・`RAGUEL_CODEX_BIN` で差し替える。
- `context/` — Jev の文脈判定(`jev.ts`・`judge.ts`)。任意で、既定は無効(`contextJudge.enabled: false`)。有効にしても
  `TYPESAFE_API_KEY` が無ければ使わない。jevriel の src は import しない。
- `precedent/` — 判例の保存と検索(`store.ts`・`retrieval.ts`・`seed/`)。判例は `<casesDir>/precedents/<projectId>/` に置く。
- `casefile/` — hash-chained, tamper-evident audit log of evaluations (`hashchain.ts`, `store.ts`, `digest.ts`).
- `subject/` — 評価対象の組み立て(`body.ts`・`code.ts`・`files.ts`)。code は baseRef から HEAD の差分を Raguel が自分で作る。
- `codiel/phases.ts` — フェーズの表。`project/root.ts` — プロジェクトルートと projectId の解決。
- `tools/` — MCP tool entry points. `evaluate_decision`・`evaluate_design`・`evaluate_plan`・`evaluate_code` の 4 本は
  `phase`・`baseRef`(code のみ)・`paths` を受ける。ほかに `record_outcome`・`list_rules`・`list_precedents`・`retire_precedent`(`shared.ts` が共通の入力)。
- `config/` — schema + loader + defaults + paths. 設定は `.codiel/config.json` の `raguel` と `testsDir`。
  `RAGUEL_CONFIG` に JSON のパスを渡すと `raguel` の代わりにそれを読む(testsDir は常にプロジェクトの `.codiel/config.json`)。
  **YAML(旧 `raguel.config.yaml`)は読まない。** 呼び出しごとに mtime で読み直す。
- `server.ts` — MCP server entry.

## ケースファイルと記録

`<casesDir>/cases/<projectId>/<runId>/<phase>/attempt-NN/` に証拠と `verdict.json` を置き、
`<casesDir>/cases/<projectId>/` 直下の `evaluations.jsonl`(評価の索引)と `outcomes.jsonl`(裁定の記録)に 1 行ずつ追記する。
`casesDir` の既定は `~/.raguel`。codiel 側の `codiel-state pass-gate` はこの索引と `verdict.json` を照合して、
記録に無い・古い・書き換えられた評価ではゲートを通さない(検査は契約の文書 §5)。

## Subproject specifics

- Tests live in `__test__/` dirs beside each module.
- 子プロセスの fake は `src/testing/fake-claude.mjs`・`fake-codex.mjs`。パネルのテストのヘルパー(`fakeProvider.ts`・`fixtures.ts`)は
  `src/panel/__test__/helpers/`。実際の claude・codex・Jev の API はテストで呼ばない。新しいパネルのコードは `provider.ts` 越しに注入できる形にする。
