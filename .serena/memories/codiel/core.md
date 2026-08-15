`plugins/codiel` (0.4.1-dev) — GitHub-issue-driven orchestrator: takes an issue and drives it
through analysis, design discussion, planning, implementation, testing, PR and review, gated by the
bundled `raguel` MCP server. The largest plugin here. Flow spec: `plugins/codiel/docs/DESIGN.md`
(§0 states the no-Anthropic-API invariant, `mem:core`); flowcharts were pulled out into
`docs/skill-flowcharts.md` (commit 86b9483). MCP internals: `mem:codiel/raguel_mcp`.

## Flow — 11 stages / 12 named phases

`init → discuss → design → (test-spec ∥ dev-plan) → implement → test-loop → pr → review →
fix-loop → triage → finalize`. `test-spec` and `dev-plan` are one parallel stage.
Raguel gates `init`, `design`, `test-spec`, `dev-plan`, `implement`, `test-loop`, `fix-loop`.

**Human touchpoints are not limited to Raguel ASK/STOP.** `discuss` is a standing human-in-the-loop
phase requiring agreement with the user; `design` has a walkthrough + user approval before the
Raguel evaluation; `triage` (filing followup issues) is always user-directed. The older note that
codiel has "no fixed human-approval checkpoints" is wrong.

## Agents (13) and domain split

`codiel-analyst`, `codiel-architect` (2 modes), `codiel-planner`, `codiel-test-designer`,
`codiel-tester`, implementers `-frontend/-backend/-data`, reviewers
`-frontend/-backend/-data/-doc/-security`.

A target project that doesn't fit the 3-domain split declares `generic` in its
`docs/ARCHITECTURE.md`. There is **no dedicated generic agent** — `codiel-implementer-backend` and
`codiel-reviewer-backend` are reused as the general-purpose pair, with doc/security reviewers still
participating.

## Skills (18) and commands (3)

Commands: `/codiel:init`, `/codiel:run`, `/codiel:test`.
Skills cover one responsibility each: `analyzing-issues`, `preparing-design-agendas`,
`facilitating-design-discussions`, `writing-design-docs`, `writing-test-specs`, `writing-dev-plans`,
`implementing`, `scripting-tests`, `running-regression-tests`, `fixing-failures`, `reviewing-diffs`,
`fixing-review-findings`, `filing-followup-issues`, `recording-gotchas`, `orchestrating-runs`,
`raguel-gating`, `initializing-harness` (+ its `raguel.config.example.yaml`).
All 18 were rewritten to the prompt-smith standard in commit 86b9483.

## Hooks — phase-scoped, ask-by-default with hard denies

`hooks/hooks.json`: `PreToolUse(Bash)` → `guard-bash.mjs`; `PreToolUse(Edit|Write)` →
`guard-write.mjs`; `SubagentStop` → `subagent-stop.mjs`; `Stop` → `stop-guard.mjs`.

- Restrictions are **phase-level, not agent-level**, and a phase mismatch yields `ask` (tolerating
  false positives) — but a set of actions is unconditionally `deny`: `rm -rf`, `curl | sh`, force
  push, push to main/master, shell writes to `state.json`, and out-of-condition PR/issue creation.
- `guard-write` treats `init`/`discuss`/`design`/`test-spec`/`dev-plan` as the document phases.
- Phase state: `src/codiel-state.ts`, with `src/codiel-state-cli.ts` split off so the CLI entry
  doesn't self-execute when esbuild inlines the library into the hooks. `src/hooks/lib.ts` holds
  the shared stdin/ask/deny/project-root/domain-config helpers.

## Assets copied into target projects

`docs/{ARCHITECTURE,GOTCHAS}.example.md` are templates; `CLAUDE.example.md` and `settings.json` sit
at the plugin root; `scripts/install-harness.sh` does the mechanical placement (hand-written, not
esbuild output). `/codiel:init` drives all of it.

## Change history note

Between 0.2.1-dev and 0.4.0-dev only three commits touched this plugin (aff7cc1, 86b9483, 8e6e3e0)
and **none of them changed TypeScript or the bundles** — it was an agents/skills rewrite plus a
`package.json` version sync.
