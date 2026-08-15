`plugins/codiel/raguel-mcp` — the MCP server backing Codiel's gating (DESIGN.md: 「他の天使たちの
行いを監視する天使 Raguel」). Inspects AI-produced artifacts (decisions, designs, plans, code diffs)
and returns a machine PROCEED / ASK / STOP verdict; the only human touchpoint is ASK/STOP.

Parent plugin: `mem:codiel/core` (codiel 0.4.1-dev; no raguel/TypeScript change has landed since
codiel 0.2.1-dev — the intervening bumps were agents/skills/doc edits only). Own workspace package (`raguel-mcp`, 0.0.1-dev in `package.json`,
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
