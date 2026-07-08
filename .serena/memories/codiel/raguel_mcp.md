`raguel-mcp` is the MCP server backing Codiel's gating (`plugins/codiel/docs/DESIGN.md` calls it
"他の天使たちの行いを監視する天使 Raguel"). It inspects AI-produced artifacts (decisions, designs,
plans, code diffs) and returns a machine PROCEED / ASK / STOP verdict — no human approval gate
except when it emits ASK/STOP.

## Source layout (`src/`)

- `core/` — verdict computation, rule weighting, pipeline orchestration (`pipeline.ts` runs
  `evaluateArtifact`), cross-rule invariants.
- `rules/` — the actual gating checks, split by artifact type: `decision/`, `plan/`, `code/`,
  plus `common/` (secrets, injection markers, resubmission-loop detection, max-size). Each rule
  is a small file + colocated `.test.ts`; `rules/registry.ts` wires them up per artifact type.
- `panel/` — LLM-judge layer: `panelists/` (adversarial, assumption, crosscheck, precedent,
  steelman, meta — one file each) scored against `rubrics.ts`, invoked via `claudeCli.ts`
  (**headless `claude` CLI subprocess, not the Anthropic API** — required by `mem:core`'s
  no-API invariant) through `provider.ts`.
- `precedent/` — stores/retrieves past verdicts (`store.ts`, `retrieval.ts`, `seed/`) so the
  panel can cite precedent.
- `casefile/` — hash-chained audit log of evaluations (`hashchain.ts`, `store.ts`) — tamper-evident
  record of what Raguel decided and why.
- `tools/` — MCP tool entry points exposed to Claude Code: `evaluateDecision`, `evaluateDesign`,
  `evaluatePlan`, `evaluateCode`, `recordOutcome`, `listRules`.
- `config/` — schema + loader + defaults for project-level Raguel config.
- `server.ts` — MCP server entry (built to `dist/server.mjs`, wired via `../.mcp.json`).

## Conventions specific to this subproject

- Every rule/panelist/core module has a colocated `*.test.ts` — no separate test tree.
- `panel/testing/fakeProvider.ts` and `fake-claude.mjs` stand in for the real `claude` CLI in
  tests, so panel tests don't shell out for real.
- Build/test/typecheck commands: `mem:suggested_commands`.
