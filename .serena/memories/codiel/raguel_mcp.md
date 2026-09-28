`plugins/codiel/raguel-mcp` — the MCP server backing Codiel's gating (DESIGN.md: 「他の天使たちの
行いを監視する天使 Raguel」). Inspects AI-produced artifacts (decisions, designs, plans, code diffs)
and returns a machine PROCEED / ASK / STOP verdict; the only human touchpoint is ASK/STOP.

Parent plugin: `mem:codiel/core` (codiel 1.0.0). 2026-09-28 の codiel 1.0.0(commit 08647269)で応急処置が入った
(設計書 `harness-docs/design/2026-09-27-codiel-intent-driven-design.md` の決定 83・§6.14.1):
config を呼び出しごとに mtime で読み直す(protected-paths の glob は既定と和集合、結果に `configSource`)、
common/secrets は `/` を含むトークンと diff・files の見出し行をエントロピーの対象から外し、既知の形式は常に見る、
dangerous-patterns は `.md`・テスト・コメント行を `ask` に下げる、`evaluate_plan` は steps を連結して評価する、
入力の誤りは `isError` で返す。作り直しは別セッションで設計中(`harness-docs/handover/2026-09-28-raguel-redesign-handover.md`)。
`raguel-mcp/docs/DESIGN.md` は応急処置の前の記述のままで、作り直しで改める。Own workspace package (`raguel-mcp`, 0.0.1-dev in `package.json`,
`0.1.0` as the version the MCP server reports at registration), but built/tested via the **root**
toolchain
(`mem:suggested_commands`). `build.ts` → `dist/server.mjs`, committed and wired as the `raguel`
server in `plugins/codiel/.mcp.json`. Own design doc: `raguel-mcp/docs/DESIGN.md`.

## Source layout (`src/`)

- `core/` — verdict computation, rule weighting, cross-rule invariants, logging; `pipeline.ts` runs
  `evaluateArtifact`. Has a golden test (`__test__/pipeline.golden.test.ts`).
- `rules/` — the gating checks by artifact type: `decision/`, `plan/`, `code/`, plus `common/`
  (secrets, injection markers, resubmission-loop detection, max-size). `registry.ts` wires rules
  per artifact type; `testHelpers.ts`/`util.ts` shared.
- `panel/` — LLM-judge layer: `panelists/` (adversarial, assumption, crosscheck, precedent,
  steelman, meta) scored against `rubrics.ts`, orchestrated by `runner.ts`/`prompts.ts`/`schema.ts`,
  reached through `provider.ts` → `claudeCli.ts` — a **headless `claude` CLI subprocess, never the
  Anthropic API** (`mem:core` invariant).
- `precedent/` — stores/retrieves past verdicts (`store.ts`, `retrieval.ts`, `seed/`) so the panel
  can cite precedent.
- `casefile/` — hash-chained, tamper-evident audit log of evaluations (`hashchain.ts`, `store.ts`).
- `tools/` — MCP tool entry points: `evaluateDecision`, `evaluateDesign`, `evaluatePlan`,
  `evaluateCode`, `recordOutcome`, `listRules` (+ `shared.ts`).
- `config/` — schema + loader + defaults for project-level Raguel config.
- `server.ts` — MCP server entry.

## Subproject specifics

- Tests live in `__test__/` dirs beside each module (rules, panelists, core, tools all have them).
- `panel/testing/fakeProvider.ts` + `fake-claude.mjs` stand in for the real `claude` CLI, so panel
  tests never shell out for real — keep new panel code injectable through `provider.ts`.
